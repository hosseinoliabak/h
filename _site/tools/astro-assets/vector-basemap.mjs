/* Vector base map for the eclipse atlas.

   The atlas paints its base map as raster pixels, because every projection
   other than Mercator warps those pixels through a mesh. CARTO served that
   raster until August 2026, when it began watermarking keyless requests and
   announced that the raster endpoint is being retired. This module replaces
   the two CARTO themes without giving up the raster contract. MapLibre draws
   OpenFreeMap vector tiles into an offscreen canvas, and astro-core samples
   that canvas exactly as it sampled a mosaic of PNG tiles.

   The point of the change is ownership rather than price. All three styles
   are vendored beside this file, so light, dark, and names-off are decisions
   this repository makes rather than a vendor's product line, and the single
   remote origin below is the one URL to repoint if OpenFreeMap ever stops.

   MapLibre GL JS 6.6.0, 3-Clause BSD, vendored beside this file rather than
   loaded from a CDN. It needs WebGL2. Where that is missing the module never
   registers, drawTiles reports that it painted nothing, and the page falls
   back to its bundled outlines exactly as it does offline. */

import { Map as MapLibreMap } from './maplibre-gl.mjs';

/* Every URL all three vendored styles resolve to, checked by origin below.
   Sprites, glyphs, the Natural Earth underlay and the planet tiles are all
   published here, so one exact origin covers the whole style. */
const TILE_ORIGIN = 'https://tiles.openfreemap.org';

const STYLE_FILES = {
  positron: 'basemap-positron.json',
  dark: 'basemap-dark.json',
  liberty: 'basemap-liberty.json'
};

/* An offscreen render can wait on the network, so a request that never
   settles must not strand the queue. Whatever is on the canvas at this point
   is drawn instead, which is normally the coarser zoom already in hand. */
const IDLE_TIMEOUT_MS = 4000;

/* The canvas handed back to the warp mesh. Larger costs memory and readback
   time on every settled frame, and buys detail the mesh cannot show. */
const MAX_OUTPUT_PX = 3072;

function styleUrl(name) {
  return new URL('./' + STYLE_FILES[name], import.meta.url).href;
}

/* Defense in depth for a style file that is already fixed and vendored.
   Only the tile origin and this site's own origin can be reached, and no
   request carries credentials. A blocked URL fails its own fetch and leaves
   the rest of the style working. */
function guardRequest(url) {
  let parsed;
  try {
    parsed = new URL(url, location.href);
  } catch (err) {
    return { url: '' };
  }
  if (parsed.origin !== TILE_ORIGIN && parsed.origin !== location.origin) {
    return { url: '' };
  }
  return { url: parsed.href, credentials: 'omit' };
}

function hasWebGL2() {
  try {
    const probe = document.createElement('canvas');
    return !!probe.getContext('webgl2');
  } catch (err) {
    return false;
  }
}

/* Inverse Web Mercator, matching the mercV used by astro-core. v is the
   world fraction measured down from the north edge. */
function latOfV(v) {
  const t = Math.PI * (1 - 2 * v);
  return (2 * Math.atan(Math.exp(t)) - Math.PI / 2) * 180 / Math.PI;
}

const renderer = {
  map: null,
  container: null,
  styleName: '',
  labels: null,
  ready: false,
  inFlight: false,
  pending: null,
  /* Everyone still waiting to hear that a render finished. A single slot
     here starved whichever caller asked first whenever a second view asked
     while its render was in flight, which is exactly what happens when the
     page redraws while another canvas is being tested. */
  waiters: [],
  /* The most recent finished render, kept with the ground it covers so a
     frame whose own render is still running has something correctly placed
     to draw. This is what keeps the map on screen through a pan, and it is
     the vector equivalent of the coarse raster stand-in. */
  last: null,
  out: null,
  outCtx: null
};

function ensureMap() {
  if (renderer.map) return renderer.map;
  const container = document.createElement('div');
  container.setAttribute('aria-hidden', 'true');
  container.style.cssText =
    'position:absolute;left:-10000px;top:0;width:64px;height:64px;' +
    'pointer-events:none;visibility:hidden;';
  document.body.appendChild(container);
  renderer.container = container;
  renderer.map = new MapLibreMap({
    container: container,
    style: styleUrl('positron'),
    center: [0, 0],
    zoom: 0,
    interactive: false,
    attributionControl: false,
    maplibreLogo: false,
    trackResize: false,
    renderWorldCopies: true,
    // No cross-fade, because a settled frame is read back the moment it lands
    fadeDuration: 0,
    /* Reading the drawing buffer after the frame is what this whole module
       does, so the buffer has to survive the frame that drew it. */
    canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
    transformRequest: guardRequest,
    maxZoom: 22
  });
  renderer.styleName = 'positron';
  return renderer.map;
}

function waitForStyle(map) {
  return new Promise(function (resolve) {
    if (map.isStyleLoaded()) { resolve(); return; }
    map.once('styledata', function () { resolve(); });
  });
}

function waitForIdle(map) {
  return new Promise(function (resolve) {
    let done = false;
    const finish = function () {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, IDLE_TIMEOUT_MS);
    map.once('idle', finish);
  });
}

/* Names are a variant of the same style rather than a separate download, so
   turning them off is hiding the symbol layers. Terrain in the raster themes
   bakes its names into the imagery and cannot do this, which is the whole
   reason the page carries a bakedLabels flag. */
function applyLabels(map, labels) {
  const style = map.getStyle();
  if (!style || !style.layers) return;
  for (const layer of style.layers) {
    if (layer.type !== 'symbol') continue;
    map.setLayoutProperty(layer.id, 'visibility', labels ? 'visible' : 'none');
  }
  renderer.labels = labels;
}

async function useStyle(map, styleName, labels) {
  if (renderer.styleName !== styleName) {
    map.setStyle(styleUrl(styleName));
    renderer.styleName = styleName;
    renderer.labels = null;
    await waitForStyle(map);
  } else if (!map.isStyleLoaded()) {
    await waitForStyle(map);
  }
  if (renderer.labels !== labels) applyLabels(map, labels);
}

/* MapLibre measures zoom in CSS pixels against a 512 pixel tile, while the
   caller asks in canvas pixels. Sizing the container in CSS pixels and
   setting the pixel ratio separately is what keeps type and road widths at
   their intended size on a supersampled canvas, instead of shrinking every
   label by the supersampling factor. */
function sizeTo(map, w, h, ratio) {
  const cssW = Math.max(1, Math.round(w / ratio));
  const cssH = Math.max(1, Math.round(h / ratio));
  const style = renderer.container.style;
  if (style.width !== cssW + 'px' || style.height !== cssH + 'px') {
    style.width = cssW + 'px';
    style.height = cssH + 'px';
    map.resize();
  }
  if (map.getPixelRatio() !== ratio) map.setPixelRatio(ratio);
}

async function runRender(req) {
  const map = ensureMap();
  await useStyle(map, req.style, req.labels);
  sizeTo(map, req.cw, req.ch, req.ratio);

  // World width in CSS pixels, against MapLibre's 512 pixel tile
  const worldCss = req.n * req.cell / req.ratio;
  const zoom = Math.max(0, Math.min(22, Math.log2(worldCss / 512)));
  const uCenter = (req.ix0 + req.ix1 + 1) / 2 / req.n;
  const vCenter = (req.iy0 + req.iy1 + 1) / 2 / req.n;
  map.jumpTo({ center: [uCenter * 360 - 180, latOfV(vCenter)], zoom: zoom });
  await waitForIdle(map);

  if (!renderer.out) {
    renderer.out = document.createElement('canvas');
    renderer.outCtx = renderer.out.getContext('2d');
  }
  const out = renderer.out;
  if (out.width !== req.cw || out.height !== req.ch) {
    out.width = req.cw;
    out.height = req.ch;
  } else {
    renderer.outCtx.clearRect(0, 0, req.cw, req.ch);
  }
  /* Rounding the container to whole CSS pixels can leave the drawing buffer
     a pixel off the requested size. Scaling it into the exact canvas keeps
     the georeference below true, at the cost of a subpixel resample. */
  renderer.outCtx.drawImage(map.getCanvas(), 0, 0, req.cw, req.ch);

  renderer.last = {
    key: req.key,
    canvas: out,
    n: req.n,
    ix0: req.ix0,
    iy0: req.iy0,
    cw: req.cw,
    ch: req.ch,
    cell: req.cell
  };
}

function pump() {
  if (renderer.inFlight || !renderer.pending) return;
  renderer.inFlight = true;
  const req = renderer.pending;
  renderer.pending = null;
  runRender(req).then(function () {
    renderer.inFlight = false;
    /* A newer view arrived while this one was drawing; start it before
       waking anyone, so a waiter's immediate re-request finds the queue
       already busy instead of starting a duplicate. */
    if (renderer.pending) pump();
    /* Wake every waiter after every finished render, not only the last
       requester. A waiter whose own view has not been drawn yet simply
       asks again and lands back in the queue, which converges. */
    var woken = renderer.waiters;
    renderer.waiters = [];
    for (var i = 0; i < woken.length; i++) woken[i]();
  }).catch(function (err) {
    renderer.inFlight = false;
    console.warn('Vector base map render failed', err);
  });
}

/* Called by astro-core once per frame that wants tiles. Returns whatever is
   correctly georeferenced right now, which is the finished render for this
   view or the previous one, and starts the render for this view when the
   caller is willing to fetch. Returning the older render rather than null is
   what keeps a pan smooth. */
function request(req, onReady) {
  if (renderer.last && renderer.last.key === req.key) return renderer.last;
  if (req.noFetch) return renderer.last;
  if (renderer.waiters.indexOf(onReady) < 0) renderer.waiters.push(onReady);
  renderer.pending = req;
  pump();
  return renderer.last;
}

/* The page has already drawn itself once by the time this module runs, since
   a module is deferred and astro-core is not. Registering therefore has to
   announce itself, or a vector theme would sit on the bundled outlines until
   the reader happened to touch a control. */
if (hasWebGL2() && window.Astro) {
  window.Astro.vectorBasemap = {
    request: request,
    maxOutputPx: MAX_OUTPUT_PX
  };
  window.dispatchEvent(new CustomEvent('astro-vector-basemap-ready'));
}
