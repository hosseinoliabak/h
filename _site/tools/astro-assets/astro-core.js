/* Shared machinery for the Astronomy tools.
   Depends on astronomy.browser.js being loaded first (window.Astronomy).

   Provides:
     Astro.ready            promise resolving once world outlines are loaded
     Astro.palette(el)      reads the monochrome palette from CSS custom props
     Astro.equirect / ortho map projections with a common interface
     Astro.drawMap          land outlines, graticule, frame
     Astro.contour          marching squares over a lon/lat window
     Astro.shadow           Moon shadow cone geometry for solar eclipses
     Astro.fmt              formatting helpers
*/
(function (global) {
  'use strict';

  var A = global.Astronomy;
  var DEG = Math.PI / 180;
  var RAD = 180 / Math.PI;

  var EARTH_A = 6378.137;                       // equatorial radius, km
  var FLAT = 1 - 1 / 298.257223563;             // polar / equatorial radius
  var SUN_R = 695700;                           // km
  var MOON_R = 1737.4;                          // km
  var KM_AU = A.KM_PER_AU;

  // ---------------------------------------------------------------- assets

  var land = [], borders = [], cities = [], countries = [];

  function grab(file, apply) {
    return fetch('astro-assets/' + file)
      .then(function (r) { return r.json(); })
      .then(apply)
      .catch(function () { /* a missing overlay must not break the tool */ });
  }

  var ready = Promise.all([
    grab('land.json', function (d) { land = d; }),
    grab('borders.json', function (d) { borders = d; }),
    grab('cities.json', function (d) { cities = d; }),
    grab('countries.json', function (d) { countries = d; })
  ]);

  /* Finer outlines, fetched only once the reader zooms far enough to see the
     difference. The world view is served by the small 110m files so the page
     paints immediately; the 2 MB of 50m data is never downloaded by someone
     who only ever looks at the whole Earth. */
  var detail = { loaded: false, loading: false, land: [], lakes: [], rivers: [], borders: [] };

  function loadDetail(onDone) {
    if (detail.loaded || detail.loading) return;
    detail.loading = true;
    Promise.all([
      grab('land-50m.json', function (d) { detail.land = d; }),
      grab('lakes-50m.json', function (d) { detail.lakes = d; }),
      grab('rivers-50m.json', function (d) { detail.rivers = d; }),
      grab('borders-50m.json', function (d) { detail.borders = d; })
    ]).then(function () {
      detail.loaded = true;
      detail.loading = false;
      if (onDone) onDone();
    });
  }

  /* Finer place names, towns down to five thousand people, fetched with the
     same lazy pattern once the reader is close enough for them to qualify.
     The label loop stops early on its population-sorted list, and the bundled
     file ends with small-population capitals, so a plain concatenation would
     be cut off right at the seam; the merge re-sorts to restore the order the
     early stop depends on. */
  var places = { loaded: false, loading: false, merged: null };

  function loadPlaces(onDone) {
    if (places.loaded || places.loading) return;
    places.loading = true;
    grab('cities-5k.json', function (d) {
      places.merged = cities.concat(d).sort(function (a, b) { return b[3] - a[3]; });
    }).then(function () {
      places.loaded = true;
      places.loading = false;
      if (onDone) onDone();
    });
  }

  // --------------------------------------------------------------- palette

  function palette(el) {
    var cs = getComputedStyle(el);
    function v(name, fallback) {
      var s = cs.getPropertyValue(name);
      return (s && s.trim()) || fallback;
    }
    return {
      sky: v('--sky', '#ffffff'),
      ink: v('--ink', '#000000'),
      soft: v('--ink-soft', '#6b6b6b'),
      faint: v('--ink-faint', '#c9c9c9'),
      hair: v('--ink-hair', '#e6e6e6'),
      shade: v('--shade', 'rgba(0,0,0,0.10)'),
      band: v('--band', 'rgba(0,0,0,0.30)'),
      sun: v('--sun', '#e07b00'),
      moon: v('--moon', '#76839a'),
      // The phase disc: sunlit side and shadowed side of the Moon mark
      moonLit: v('--moon-lit', '#f2c94c'),
      moonDark: v('--moon-dark', '#8a94a4')
    };
  }

  // ----------------------------------------------------------- sky graphics

  /* One place on the site where a planet decides what it looks like. Both the
     planetarium and the eclipse atlas draw the same bodies, and a Mars that
     is rust on one page and green on the other is two tools rather than one,
     so the colors, the sizes and the glyphs all live here.

      is identification, the one meaning a monochrome chart cannot
     carry, so these are hardcoded rather than themed. Red mode is the
     exception and overrides the lot, because preserving dark adaptation is
     that mode's entire point and no hue survives it. */
  var BODY_TINT = {
    Sun: '#d69a1e', Moon: '#8f93a8', Mercury: '#8a7d6d', Venus: '#bb8f2d',
    Earth: '#3a7abf', Mars: '#c1440e', Jupiter: '#a8732c', Saturn: '#b19238',
    Uranus: '#2b9d9d', Neptune: '#4560cc', Pluto: '#8d6e63'
  };

  /* open is the star atlas name for what this file calls a cluster; both
     spellings resolve, so a page keeps whichever word it already used. */
  var DSO_TINT = {
    galaxy: '#9550c8', irregular: '#9550c8', nebula: '#c34a4a',
    cluster: '#2f6fc4', open: '#2f6fc4', glob: '#b57f1f'
  };

  // Lowercase index, so a caller keying its own list by 'mars' still lands
  var BODY_TINT_LC = {};
  Object.keys(BODY_TINT).forEach(function (k) {
    BODY_TINT_LC[k.toLowerCase()] = BODY_TINT[k];
  });

  /* Equatorial radii in kilometres, for working out how large each body
     actually appears. */
  var BODY_RADIUS_KM = {
    Sun: 695700, Moon: 1737.4, Mercury: 2439.7, Venus: 6051.8, Mars: 3396.2,
    Jupiter: 71492, Saturn: 60268, Uranus: 25559, Neptune: 24764, Pluto: 1188.3
  };

  function bodyTint(name, pal, mode) {
    if (mode === 'red') return pal.ink;
    return BODY_TINT[name] || BODY_TINT_LC[String(name).toLowerCase()] || pal.ink;
  }

  function dsoTint(kind, pal, mode) {
    if (mode === 'red') return pal.ink;
    return DSO_TINT[kind] || pal.ink;
  }

  /* Mixes a hex color toward black or white, for the shadowed half of a
     phase and for the darker belts on a banded planet. */
  function shade(hex, f) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return hex;
    var n = parseInt(m[1], 16);
    var to = f < 0 ? 0 : 255, a = Math.abs(f);
    function mix(c) { return Math.round(c + (to - c) * a); }
    return 'rgb(' + mix((n >> 16) & 255) + ',' + mix((n >> 8) & 255) + ',' +
      mix(n & 255) + ')';
  }

  /* Apparent diameter in arcseconds, as seen from the Earth right now. */
  function apparentDiam(body, t) {
    var r = BODY_RADIUS_KM[body];
    if (!r) return 0;
    var v = (body === 'Moon') ? A.GeoMoon(t) : A.GeoVector(A.Body[body], t, false);
    var d = Math.hypot(v.x, v.y, v.z) * KM_AU;
    return d > 0 ? 2 * Math.atan(r / d) * RAD * 3600 : 0;
  }

  /* Pixels for a body's disc. Real diameters run from half a degree for the
     Sun and the Moon down to two arcseconds for Neptune, a range of eight
     hundred to one, and drawn to scale everything but the Sun and the Moon
     would vanish. The scale is logarithmic instead, so the ranking a
     telescope would show survives while the smallest disc stays findable. */
  function markRadius(diamArcsec, k) {
    return (6.2 + 3.1 * Math.log10(Math.max(1, diamArcsec))) * (k || 1);
  }

  /* Fraction of the disc that is lit, as the signed half-width of the
     terminator ellipse. Positive is a crescent, negative a gibbous, and the
     sign convention follows the Moon's elongation so that new is +1 and full
     is -1. Every other body reaches the same number through its phase angle,
     which runs the opposite way. */
  function phaseFactor(body, t) {
    if (body === 'Moon') return Math.cos(A.MoonPhase(t) * DEG);
    try {
      return -Math.cos(A.Illumination(A.Body[body], t).phase_angle * DEG);
    } catch (err) {
      return -1;
    }
  }

  /* How wide open Saturn's rings stand, in radians, from the angle between
     its pole and the line of sight. Near zero they are edge on and draw as a
     line through the disc, which is what they really did in 2025. */
  function ringOpening(t) {
    try {
      var n = A.RotationAxis(A.Body.Saturn, t).north;
      var v = A.GeoVector(A.Body.Saturn, t, false);
      var d = Math.hypot(v.x, v.y, v.z);
      if (!d) return 0.4;
      return Math.asin(Math.min(1, Math.abs(
        (n.x * v.x + n.y * v.y + n.z * v.z) / d)));
    } catch (err) {
      return 0.4;
    }
  }

  /* One body, drawn as itself. opts carries:
       name    body name, which picks the color and the markings
       r       disc radius in canvas pixels
       pal     palette, for the halo and the shadowed side
       mode    chart mode, so red can flatten the colors
       phase   terminator half-width, or null for a body drawn full
       sunAng  screen direction of the Sun, which the lit limb faces
       time    needed only by Saturn, for the ring opening */
  function drawBody(ctx, x, y, opts) {
    var o = opts || {};
    var pal = o.pal, r = o.r || 10, name = o.name;
    var col = bodyTint(name, pal, o.mode);
    var lit = (name === 'Moon') ? pal.moonLit : shade(col, 0.35);
    var dark = (name === 'Moon') ? pal.moonDark : shade(col, -0.55);

    ctx.save();
    ctx.translate(x, y);

    // The Sun keeps the corona that has always marked it on these charts
    if (name === 'Sun') {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, 2 * Math.PI);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.strokeStyle = pal.sky;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = col;
      ctx.lineWidth = r * 0.22;
      for (var i = 0; i < 8; i++) {
        var a = i * Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 1.45, Math.sin(a) * r * 1.45);
        ctx.lineTo(Math.cos(a) * r * 2.2, Math.sin(a) * r * 2.2);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }

    // Rings go behind the globe first, then in front of it, so the planet
    // sits inside them the way it does in any photograph
    var ring = null;
    if (name === 'Saturn') {
      ring = { rx: r * 2.15, ry: Math.max(r * 0.06, r * 2.15 * Math.sin(ringOpening(o.time))) };
      ctx.save();
      ctx.rotate(-0.35);
      ctx.beginPath();
      ctx.ellipse(0, 0, ring.rx, ring.ry, 0, Math.PI, 2 * Math.PI);
      ctx.strokeStyle = shade(col, 0.25);
      ctx.lineWidth = Math.max(1.6, r * 0.22);
      ctx.stroke();
      ctx.restore();
    }

    // Halo, so a disc keeps its edge over coastlines and imagery
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 2 * Math.PI);
    ctx.strokeStyle = pal.sky;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = (o.phase === null || o.phase === undefined) ? col : dark;
    ctx.fill();

    if (o.phase !== null && o.phase !== undefined) {
      /* The classic terminator: the semicircle facing the Sun, closed by an
         ellipse whose half-width is the phase. Sweeping it toward the Sun
         carves a crescent, away from it a gibbous. */
      ctx.save();
      ctx.rotate(o.sunAng || 0);
      ctx.beginPath();
      ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
      ctx.ellipse(0, 0, Math.max(0.01, Math.abs(o.phase) * r), r, 0,
                  Math.PI / 2, -Math.PI / 2, o.phase > 0);
      ctx.fillStyle = lit;
      ctx.fill();
      ctx.restore();
    }

    // Belts on the two banded giants, clipped to the disc
    if (name === 'Jupiter' || name === 'Saturn') {
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, 2 * Math.PI);
      ctx.clip();
      ctx.fillStyle = shade(col, -0.3);
      var bands = (name === 'Jupiter') ? [-0.45, 0.1] : [-0.2];
      bands.forEach(function (b) {
        ctx.fillRect(-r, b * r, 2 * r, r * 0.32);
      });
      ctx.restore();
    }

    if (ring) {
      ctx.save();
      ctx.rotate(-0.35);
      ctx.beginPath();
      ctx.ellipse(0, 0, ring.rx, ring.ry, 0, 0, Math.PI);
      ctx.strokeStyle = shade(col, 0.25);
      ctx.lineWidth = Math.max(1.6, r * 0.22);
      ctx.stroke();
      ctx.restore();
    }

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 2 * Math.PI);
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }

  /* Deep sky objects drawn as the thing rather than as a symbol. A galaxy is
     a tilted ellipse with a bright core, a nebula a soft lobed cloud, a
     cluster a scatter of stars, and an irregular galaxy a lopsided version of
     the first. Each shape is a caricature of the real object, enough that the
     reader recognizes which one they are looking at. */
  var CLUSTER_STARS = [[0, -0.75], [-0.62, -0.3], [0.58, -0.38], [-0.3, 0.28],
                       [0.36, 0.3], [0, 0.72], [-0.78, 0.62], [0.75, 0.68]];

  // Radii around the circle, giving the cloud its uneven edge
  var CLOUD_R = [1.0, 0.78, 1.06, 0.84, 0.96, 1.12, 0.8, 1.02, 0.86, 1.08];

  /* Closed lumpy outline, smoothed by running the curve through the midpoints
     between neighbouring radii so there are no corners. */
  function cloudPath(ctx, r) {
    var n = CLOUD_R.length, pts = [];
    for (var i = 0; i < n; i++) {
      var a = i / n * 2 * Math.PI;
      pts.push([Math.cos(a) * CLOUD_R[i] * r, Math.sin(a) * CLOUD_R[i] * r]);
    }
    ctx.beginPath();
    var mid = function (p, q) { return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; };
    var start = mid(pts[n - 1], pts[0]);
    ctx.moveTo(start[0], start[1]);
    for (i = 0; i < n; i++) {
      var m = mid(pts[i], pts[(i + 1) % n]);
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
    }
    ctx.closePath();
  }

  function drawDeepSky(ctx, x, y, opts) {
    var o = opts || {};
    var pal = o.pal, r = o.r || 13;
    var col = dsoTint(o.kind, pal, o.mode);
    var tilt = o.tilt || 0;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);

    if (o.kind === 'galaxy' || o.kind === 'irregular') {
      var ax = o.kind === 'galaxy' ? 1.6 : 1.25;
      var ay = o.kind === 'galaxy' ? 0.55 : 0.85;
      // Halo first, so the shape reads over a busy base map
      ctx.beginPath();
      ctx.ellipse(0, 0, r * ax, r * ay, 0, 0, 2 * Math.PI);
      ctx.strokeStyle = pal.sky;
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = col;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      // Core
      ctx.beginPath();
      ctx.ellipse(o.kind === 'galaxy' ? 0 : -r * 0.2, 0,
                  r * 0.42, r * 0.34, 0, 0, 2 * Math.PI);
      ctx.fillStyle = col;
      ctx.fill();
    } else if (o.kind === 'cluster') {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, 2 * Math.PI);
      ctx.strokeStyle = pal.sky;
      ctx.lineWidth = 3.5;
      ctx.setLineDash([4, 5]);
      ctx.stroke();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col;
      CLUSTER_STARS.forEach(function (s, i) {
        ctx.beginPath();
        ctx.arc(s[0] * r * 0.78, s[1] * r * 0.78, i < 3 ? r * 0.17 : r * 0.12,
                0, 2 * Math.PI);
        ctx.fill();
      });
    } else {
      /* One lumpy closed outline rather than a ring of circles, so the edge
         reads as nebulosity instead of as overlapping bubbles. The radii are
         a fixed pattern, not random, so the same object keeps the same shape
         from frame to frame. */
      cloudPath(ctx, r);
      ctx.strokeStyle = pal.sky;
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = col;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.7;
      ctx.stroke();
      // A brighter heart, which is what actually shows in a photograph
      ctx.globalAlpha = 0.45;
      cloudPath(ctx, r * 0.45);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // ----------------------------------------------------------- projections

  /* Every projection exposes:
       fwd(lon, lat) -> [x, y]        always returns a point
       vis(lon, lat) -> boolean       whether the point faces the viewer
       inv(x, y)     -> [lon, lat] | null
       clipPath(ctx) -> void          restricts drawing to the globe

     center is always the geographic [longitude, latitude] at the middle of
     the view. Orthographic projections also expose canvasCenter for the
     globe disc's center in canvas pixels. Keeping those coordinate spaces
     separate prevents degree values from being used in pixel geometry. */

  /* view is {zoom, lon, lat}: magnification, and the lon/lat held at the
     center of the canvas. Zoom of 1 shows the whole world. */
  function equirect(w, h, view) {
    view = view || {};
    var k = view.zoom || 1;
    var lonC = view.lon || 0, latC = view.lat || 0;
    var sx = w / 360 * k, sy = h / 180 * k;
    var worldW = w * k;
    return {
      kind: 'equirect', flat: true, repeats: true,
      width: w,
      height: h,
      zoom: k,
      worldWidth: worldW,
      center: [lonC, latC],
      clampLat: function (lat) {
        var lim = Math.max(0, 90 - 90 / k);
        return Math.max(-lim, Math.min(lim, lat));
      },
      fwd: function (lon, lat) {
        var dl = ((lon - lonC + 180) % 360 + 360) % 360 - 180;
        return [w / 2 + dl * sx, h / 2 - (lat - latC) * sy];
      },
      fwdOffset: function (dl, lat) {
        return [w / 2 + dl * sx, h / 2 - (lat - latC) * sy];
      },
      vis: function () { return true; },
      inv: function (x, y) {
        var lat = latC - (y - h / 2) / sy;
        if (lat > 90 || lat < -90) return null;
        return [wrapLon(lonC + (x - w / 2) / sx), lat];
      },
      clipPath: function (ctx) {
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
      }
    };
  }

  /* Runs a drawing callback once per horizontally repeated copy of the world,
     so that geography straddling the antimeridian is drawn on both edges
     rather than being cut in half. Only the cylindrical projections tile;
     Robinson has a curved boundary and is meant to end where it ends. */
  function withRepeats(ctx, proj, fn) {
    // Past the fully zoomed out view the visible span is under 360 degrees,
    // so the neighbouring world copies cannot reach the screen and drawing
    // them is pure waste.
    if (!proj.repeats || proj.zoom > 1.05) { fn(); return; }
    var offsets = [-proj.worldWidth, 0, proj.worldWidth];
    for (var i = 0; i < offsets.length; i++) {
      ctx.save();
      ctx.translate(offsets[i], 0);
      fn();
      ctx.restore();
    }
  }

  function rectClip(w, h) {
    return function (ctx) { ctx.beginPath(); ctx.rect(0, 0, w, h); };
  }

  /* Mercator. Rhumb lines, the courses a ship or aircraft holds at a constant
     compass bearing, are straight on this projection and on no other, which
     is why it is the navigator's map. The cost is area: it cannot show the
     poles at all and it inflates high latitudes badly. */
  function mercator(w, h, view) {
    view = view || {};
    var k = view.zoom || 1;
    var lonC = view.lon || 0, latC = view.lat || 0;
    var LAT_MAX = 85.051129;
    function my(lat) {
      lat = Math.max(-LAT_MAX, Math.min(LAT_MAX, lat));
      return Math.log(Math.tan(Math.PI / 4 + lat * DEG / 2));
    }
    var worldW = w * k;
    var sx = worldW / 360;
    var sy = worldW / (2 * Math.PI);
    var yC = my(latC);
    var yEdge = my(LAT_MAX);

    return {
      kind: 'mercator', flat: true, repeats: true,
      width: w, height: h, zoom: k, worldWidth: worldW, center: [lonC, latC],
      fwd: function (lon, lat) {
        var dl = ((lon - lonC + 180) % 360 + 360) % 360 - 180;
        return [w / 2 + dl * sx, h / 2 - (my(lat) - yC) * sy];
      },
      fwdOffset: function (dl, lat) {
        return [w / 2 + dl * sx, h / 2 - (my(lat) - yC) * sy];
      },
      vis: function () { return true; },
      inv: function (x, y) {
        var yy = yC - (y - h / 2) / sy;
        if (Math.abs(yy) > yEdge) return null;
        return [wrapLon(lonC + (x - w / 2) / sx),
                (2 * Math.atan(Math.exp(yy)) - Math.PI / 2) * RAD];
      },
      /* Keeps the visible band inside the map rather than scrolling off the
         top of the world into blank space. */
      clampLat: function (lat) {
        var half = (h / 2) / sy;
        var limY = Math.max(0, yEdge - half);
        var yy = Math.max(-limY, Math.min(limY, my(lat)));
        return (2 * Math.atan(Math.exp(yy)) - Math.PI / 2) * RAD;
      },
      clipPath: rectClip(w, h)
    };
  }

  /* Robinson. Neither equal area nor conformal, tuned by eye so that the whole
     world simply looks right, which is why atlases reach for it. Latitudes are
     straight lines but their spacing and length come from a lookup table. */
  var ROB_X = [1.0000, 0.9986, 0.9954, 0.9900, 0.9822, 0.9730, 0.9600, 0.9427,
               0.9216, 0.8962, 0.8679, 0.8350, 0.7986, 0.7597, 0.7186, 0.6732,
               0.6213, 0.5722, 0.5322];
  var ROB_Y = [0.0000, 0.0620, 0.1240, 0.1860, 0.2480, 0.3100, 0.3720, 0.4340,
               0.4958, 0.5571, 0.6176, 0.6769, 0.7346, 0.7903, 0.8435, 0.8936,
               0.9394, 0.9761, 1.0000];

  function robLookup(tbl, latAbs) {
    var t = Math.min(18, latAbs / 5), i = Math.floor(t);
    if (i >= 18) return tbl[18];
    return tbl[i] + (tbl[i + 1] - tbl[i]) * (t - i);
  }

  function robInvertY(yAbs) {
    // ROB_Y rises monotonically, so a scan then a linear step is enough
    for (var i = 0; i < 18; i++) {
      if (yAbs <= ROB_Y[i + 1]) {
        var span = ROB_Y[i + 1] - ROB_Y[i];
        return (i + (span > 0 ? (yAbs - ROB_Y[i]) / span : 0)) * 5;
      }
    }
    return 90;
  }

  function robinson(w, h, view) {
    view = view || {};
    var k = view.zoom || 1;
    var lonC = view.lon || 0, latC = view.lat || 0;
    var S = w * k / (2 * 0.8487 * Math.PI);
    var kx = 0.8487 * S, ky = 1.3523 * S;

    function ry(lat) {
      return (lat < 0 ? -1 : 1) * robLookup(ROB_Y, Math.abs(lat)) * ky;
    }
    var yC = ry(latC);

    /* Takes the longitude offset directly. The public fwd wraps offsets into
       plus or minus 180, which would fold the two vertical edges of the map
       onto each other and collapse the outline to a line. */
    function project(dl, lat) {
      return [w / 2 + kx * robLookup(ROB_X, Math.abs(lat)) * dl * DEG,
              h / 2 - (ry(lat) - yC)];
    }

    function outline(ctx) {
      ctx.beginPath();
      var lat, p;
      for (lat = -90; lat <= 90; lat += 2) {
        p = project(180, lat);
        if (lat === -90) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
      }
      for (lat = 90; lat >= -90; lat -= 2) {
        p = project(-180, lat);
        ctx.lineTo(p[0], p[1]);
      }
      ctx.closePath();
    }

    function fwd(lon, lat) {
      return project(((lon - lonC + 180) % 360 + 360) % 360 - 180, lat);
    }

    return {
      kind: 'robinson', flat: true, repeats: false,
      width: w, height: h, zoom: k, worldWidth: w * k, center: [lonC, latC],
      fwd: fwd,
      fwdOffset: project,
      vis: function () { return true; },
      inv: function (x, y) {
        var yy = yC - (y - h / 2);
        var latAbs = robInvertY(Math.min(1, Math.abs(yy) / ky));
        var lat = (yy < 0 ? -1 : 1) * latAbs;
        if (latAbs > 90) return null;
        var xs = kx * robLookup(ROB_X, latAbs);
        if (xs <= 0) return null;
        var dl = ((x - w / 2) / xs) * RAD;
        // Outside the rounded edge of the map there is no place to point at
        if (Math.abs(dl) > 180) return null;
        return [wrapLon(lonC + dl), lat];
      },
      clampLat: function (lat) {
        var limY = Math.max(0, ky - h / 2);
        var yy = Math.max(-limY, Math.min(limY, ry(lat)));
        var la = robInvertY(Math.min(1, Math.abs(yy) / ky));
        return (yy < 0 ? -1 : 1) * la;
      },
      clipPath: outline
    };
  }

  function ortho(w, h, view, radius) {
    view = view || {};
    var lon0 = view.lon || 0, lat0 = view.lat || 0;
    var k = view.zoom || 1;
    var cx = w / 2, cy = h / 2;
    var R = (radius || Math.min(w, h) / 2 - 2) * k;
    var sinL0 = Math.sin(lat0 * DEG), cosL0 = Math.cos(lat0 * DEG);
    var cosLo0 = Math.cos(lon0 * DEG), sinLo0 = Math.sin(lon0 * DEG);

    // Orthonormal frame: view direction out of the screen, then screen east
    // and screen north. Screen y is negated at draw time because canvas y
    // grows downward.
    var view3 = [cosL0 * cosLo0, cosL0 * sinLo0, sinL0];
    var eastV = [-sinLo0, cosLo0, 0];
    var northV = [-sinL0 * cosLo0, -sinL0 * sinLo0, cosL0];

    function cosc(lon, lat) {
      var la = lat * DEG, dl = (lon - lon0) * DEG;
      return sinL0 * Math.sin(la) + cosL0 * Math.cos(la) * Math.cos(dl);
    }

    return {
      view: view3,
      east: eastV,
      north: northV,
      kind: 'ortho',
      width: w,
      height: h,
      zoom: k,
      radius: R,
      canvasCenter: [cx, cy],
      center: [lon0, lat0],
      lon0: lon0,
      lat0: lat0,
      fwd: function (lon, lat) {
        var la = lat * DEG, dl = (lon - lon0) * DEG;
        var x = R * Math.cos(la) * Math.sin(dl);
        var y = -R * (cosL0 * Math.sin(la) - sinL0 * Math.cos(la) * Math.cos(dl));
        // Points on the far side fold back over the disc, which would draw
        // mirrored geometry. Push them out to the limb instead so that
        // polygons straddling the horizon still fill correctly under the clip.
        if (cosc(lon, lat) < 0) {
          var m = Math.hypot(x, y) || 1;
          x = x / m * R; y = y / m * R;
        }
        return [cx + x, cy + y];
      },
      vis: function (lon, lat) { return cosc(lon, lat) >= 0; },
      inv: function (x, y) {
        var dx = x - cx, dy = y - cy;
        var rho = Math.hypot(dx, dy);
        if (rho > R) return null;
        var c = Math.asin(Math.min(1, rho / R));
        var sc = Math.sin(c), cc = Math.cos(c);
        if (rho === 0) return [lon0, lat0];
        var lat = Math.asin(cc * sinL0 + dy * -1 * sc * cosL0 / rho) * RAD;
        var lon = lon0 + Math.atan2(dx * sc, rho * cosL0 * cc + dy * sinL0 * sc) * RAD;
        return [wrapLon(lon), lat];
      },
      clipPath: function (ctx) {
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
      }
    };
  }

  function wrapLon(lon) {
    lon = ((lon + 180) % 360 + 360) % 360 - 180;
    return lon;
  }

  // -------------------------------------------------------------- map draw

  /* Draws a lon/lat ring, splitting it wherever it wraps the antimeridian so
     that equirectangular maps do not grow a horizontal streak across the
     whole width. */
  /* The wrap seam of a flat map sits opposite the view center, not at the
     prime meridian, and it moves as the reader pans. Splitting on the raw
     longitude difference is therefore only correct for an unpanned map: two
     neighbouring coastline vertices either side of the seam differ by a
     fraction of a degree yet project to opposite edges of the canvas, and the
     segment between them is drawn as a line straight across the world.
     Comparing offsets from the view center is what actually detects the jump. */
  function ringPath(ctx, proj, ring) {
    var started = false, prevDl = null;
    var c0 = (proj.center && proj.center[0]) || 0;
    for (var i = 0; i < ring.length; i++) {
      var lon = ring[i][0], lat = ring[i][1];
      var dl = proj.flat ? wrapLon(lon - c0) : 0;
      if (proj.flat && prevDl !== null && Math.abs(dl - prevDl) > 180) {
        started = false;
      }
      var p = proj.fwd(lon, lat);
      if (!started) { ctx.moveTo(p[0], p[1]); started = true; }
      else ctx.lineTo(p[0], p[1]);
      prevDl = dl;
    }
  }

  /* Bounding box per ring, computed once per data set and kept alive with the
     array itself. A ring that straddles the antimeridian gets a box spanning
     every longitude, which is conservative: it is never culled, only never
     wrongly culled. */
  var bboxCache = new WeakMap();

  function ringBoxes(rings) {
    var got = bboxCache.get(rings);
    if (got) return got;
    var out = new Float64Array(rings.length * 4);
    for (var i = 0; i < rings.length; i++) {
      var r = rings[i], lo = 180, hi = -180, la0 = 90, la1 = -90;
      for (var j = 0; j < r.length; j++) {
        var x = r[j][0], y = r[j][1];
        if (x < lo) lo = x;
        if (x > hi) hi = x;
        if (y < la0) la0 = y;
        if (y > la1) la1 = y;
      }
      out[i * 4] = lo; out[i * 4 + 1] = hi; out[i * 4 + 2] = la0; out[i * 4 + 3] = la1;
    }
    bboxCache.set(rings, out);
    return out;
  }

  /* Latitude and longitude actually on screen, read back through the inverse
     projection so it is right for all four of them. Cached against the
     projection instance, which is rebuilt each frame. */
  var windowCache = new WeakMap();

  function gridPad(span) {
    return Math.min(1, Math.max(Math.abs(span) * 0.06, 1e-7));
  }

  function viewWindow(proj) {
    var got = windowCache.get(proj);
    if (got !== undefined) return got;
    var N = 8, c0 = (proj.center && proj.center[0]) || 0;
    var latLo = 90, latHi = -90, dlLo = 180, dlHi = -180, any = false;
    for (var i = 0; i <= N; i++) {
      for (var j = 0; j <= N; j++) {
        var ll = proj.inv(i / N * proj.width, j / N * proj.height);
        if (!ll) continue;
        any = true;
        if (ll[1] < latLo) latLo = ll[1];
        if (ll[1] > latHi) latHi = ll[1];
        var dl = wrapLon(ll[0] - c0);
        if (dl < dlLo) dlLo = dl;
        if (dl > dlHi) dlHi = dl;
      }
    }
    /* Margin for what the coarse sampling grid above may have missed between
       its samples. That error scales with the window, so the margin has to
       as well: a flat degree is right at world scale and absurd at street
       scale, where the whole view is a thousandth of one and the padding
       would then decide the tile zoom all by itself. */
    var win = any ? {
      lat0: latLo - gridPad(latHi - latLo), lat1: latHi + gridPad(latHi - latLo),
      lon0: c0 + dlLo - gridPad(dlHi - dlLo), lon1: c0 + dlHi + gridPad(dlHi - dlLo)
    } : null;
    windowCache.set(proj, win);
    return win;
  }

  function boxVisible(bb, i, win) {
    if (bb[i * 4 + 3] < win.lat0 || bb[i * 4 + 2] > win.lat1) return false;
    var lo = bb[i * 4], hi = bb[i * 4 + 1];
    for (var s = -360; s <= 360; s += 360) {
      if (lo + s <= win.lon1 && hi + s >= win.lon0) return true;
    }
    return false;
  }

  function strokeRings(ctx, proj, rings, style, width) {
    var win = viewWindow(proj);
    var bb = win ? ringBoxes(rings) : null;
    ctx.save();
    proj.clipPath(ctx);
    ctx.clip();
    withRepeats(ctx, proj, function () {
      ctx.beginPath();
      for (var i = 0; i < rings.length; i++) {
        // Skip anything whose bounding box cannot reach the screen. Without
        // this every coastline in the world is projected on every frame, no
        // matter how far in the reader has zoomed.
        if (bb && !boxVisible(bb, i, win)) continue;
        ringPath(ctx, proj, rings[i]);
      }
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawLand(ctx, proj, pal, opts) {
    opts = opts || {};
    var rings = (detail.loaded && detail.land.length) ? detail.land : land;
    strokeRings(ctx, proj, rings, opts.stroke || pal.soft, opts.lineWidth || 0.7);
  }

  /* Country outlines, drawn lighter than the coastline so the two read as
     separate layers rather than one busy tangle. */
  function drawBorders(ctx, proj, pal, opts) {
    opts = opts || {};
    var rings = (detail.loaded && detail.borders.length) ? detail.borders : borders;
    strokeRings(ctx, proj, rings, opts.stroke || pal.hair, opts.lineWidth || 0.6);
  }

  /* Lakes and rivers, available only once the detail set has loaded. Rivers
     are the single most useful layer for recognizing where you are on the
     ground, which is why they are worth the bytes. */
  function drawWater(ctx, proj, pal, opts) {
    if (!detail.loaded) return;
    opts = opts || {};
    if (detail.lakes.length) {
      strokeRings(ctx, proj, detail.lakes, opts.stroke || pal.faint, opts.lineWidth || 0.8);
    }
    if (detail.rivers.length) {
      strokeRings(ctx, proj, detail.rivers, opts.stroke || pal.faint, opts.lineWidth || 0.7);
    }
  }

  /* Meridians and parallels every `step` degrees, restricted to the part of
     the sphere actually on screen.

     Walking the whole globe would be simpler, but it fixes the cost at
     360/step lines whatever the view, which puts any sub-degree spacing out
     of reach. Deeply zoomed in that is exactly the spacing wanted, and all
     but a handful of those lines would fall outside the canvas anyway.
     Clipping to the window first makes the count depend on the view rather
     than on the step, so a tenth of a degree costs no more than thirty. */
  function drawGraticule(ctx, proj, pal, step) {
    step = step || 30;
    var lat0 = -90, lat1 = 90, lon0 = -180, lon1 = 180;
    // Parallels stop short of the poles, which are points rather than circles
    var pLat0 = -60, pLat1 = 60;

    if (step < 1) {
      var win = viewWindow(proj);
      if (!win) return;
      /* viewWindow pads by a whole degree on behalf of the tile code, which
         is wider than this entire window, so the pad is taken back off and
         replaced with a proportional one. */
      lat0 = win.lat0 + 1; lat1 = win.lat1 - 1;
      lon0 = win.lon0 + 1; lon1 = win.lon1 - 1;
      if (lat1 <= lat0 || lon1 <= lon0) return;
      var padLat = (lat1 - lat0) * 0.05, padLon = (lon1 - lon0) * 0.05;
      lat0 = Math.max(-90, lat0 - padLat); lat1 = Math.min(90, lat1 + padLat);
      lon0 -= padLon; lon1 += padLon;
      pLat0 = Math.max(-85, lat0); pLat1 = Math.min(85, lat1);
    }

    // Follow each line finely enough that a curved projection stays curved
    var dLat = Math.min(2, (lat1 - lat0) / 48);
    var dLon = Math.min(2, (lon1 - lon0) / 48);
    var snap = function (v) { return Math.ceil(v / step) * step; };

    ctx.save();
    proj.clipPath(ctx);
    ctx.clip();
    withRepeats(ctx, proj, function () {
      ctx.beginPath();
      var lon, lat, first, p;
      for (lon = snap(lon0); lon <= lon1; lon += step) {
        first = true;
        for (lat = lat0; lat <= lat1 + dLat / 2; lat += dLat) {
          p = proj.fwd(lon, Math.min(lat1, lat));
          if (first) { ctx.moveTo(p[0], p[1]); first = false; } else ctx.lineTo(p[0], p[1]);
        }
      }
      /* The equator gets its own dashed line, so drawing it here too would
         leave a solid and a dashed line a pixel apart. */
      for (lat = snap(pLat0); lat <= pLat1; lat += step) {
        if (Math.abs(lat) < step / 1000) continue;
        first = true;
        for (lon = lon0; lon <= lon1 + dLon / 2; lon += dLon) {
          p = proj.fwd(Math.min(lon1, lon), lat);
          if (first) { ctx.moveTo(p[0], p[1]); first = false; } else ctx.lineTo(p[0], p[1]);
        }
      }
      ctx.strokeStyle = pal.hair;
      ctx.lineWidth = 0.5;
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawEquator(ctx, proj, pal) {
    ctx.save();
    proj.clipPath(ctx);
    ctx.clip();
    withRepeats(ctx, proj, function () {
      ctx.beginPath();
      for (var lon = -180; lon <= 180; lon += 2) {
        var p = proj.fwd(lon, 0);
        if (lon === -180) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
      }
      ctx.strokeStyle = pal.faint;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    });
    ctx.restore();
  }

  // ------------------------------------------------------------ spherical caps

  /* Boundary of a spherical cap as a single unwrapped polygon.

     Filling a cap on an equirectangular map is the classic trap: a cap that
     crosses the antimeridian, or that swallows a pole, is not a simple polygon
     in lon/lat and naive filling produces wedges. Scanning by latitude avoids
     that. For each row the set of longitudes inside the cap is one interval
     about the center meridian, in closed form, so the boundary comes out as a
     left edge going up and a right edge coming back down. Rows that lie wholly
     inside get the full 360 degrees, which closes the polygon over the pole.

     Longitudes are left unwrapped, in [lon0-180, lon0+180]. Callers draw the
     result three times at one map width apart to cover the wrap. */
  function capPolygon(lat0, radiusDeg, step) {
    step = step || 0.5;
    var cr = Math.cos(radiusDeg * DEG);
    var s0 = Math.sin(lat0 * DEG), c0 = Math.cos(lat0 * DEG);
    var left = [], right = [], lat, d;
    for (lat = -90; lat <= 90.0001; lat += step) {
      if (lat > 90) lat = 90;
      var sl = Math.sin(lat * DEG), cl = Math.cos(lat * DEG);
      if (Math.abs(c0) < 1e-9) {
        // Cap centred on a pole: membership depends on latitude alone.
        d = (Math.abs(lat - lat0) <= radiusDeg) ? 180 : null;
      } else if (Math.abs(cl) < 1e-9) {
        d = (s0 * sl >= cr) ? 180 : null;
      } else {
        var K = (cr - s0 * sl) / (c0 * cl);
        if (K <= -1) d = 180;
        else if (K >= 1) d = null;
        else d = Math.acos(K) * RAD;
      }
      if (d === null) continue;
      left.push([-d, lat]);
      right.push([d, lat]);
      if (lat === 90) break;
    }
    if (!left.length) return [];
    return left.concat(right.reverse());
  }

  function unitVec(lat, lon) {
    var la = lat * DEG, lo = lon * DEG, c = Math.cos(la);
    return [c * Math.cos(lo), c * Math.sin(lo), Math.sin(la)];
  }
  function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  /* Boundary of a cap as unit vectors. */
  function capRing3(center, radiusDeg, n) {
    var out = [];
    // any vector not parallel to the center gives a starting basis
    var t = (Math.abs(center[2]) < 0.9) ? [0, 0, 1] : [1, 0, 0];
    var ax = [center[1] * t[2] - center[2] * t[1],
              center[2] * t[0] - center[0] * t[2],
              center[0] * t[1] - center[1] * t[0]];
    var am = Math.hypot(ax[0], ax[1], ax[2]);
    ax = [ax[0] / am, ax[1] / am, ax[2] / am];
    var by = [center[1] * ax[2] - center[2] * ax[1],
              center[2] * ax[0] - center[0] * ax[2],
              center[0] * ax[1] - center[1] * ax[0]];
    var cr = Math.cos(radiusDeg * DEG), sr = Math.sin(radiusDeg * DEG);
    for (var i = 0; i < n; i++) {
      var th = i / n * 2 * Math.PI, ct = Math.cos(th), st = Math.sin(th);
      out.push([
        cr * center[0] + sr * (ct * ax[0] + st * by[0]),
        cr * center[1] + sr * (ct * ax[1] + st * by[1]),
        cr * center[2] + sr * (ct * ax[2] + st * by[2])
      ]);
    }
    return out;
  }

  /* Fills a spherical cap correctly under either projection.

     Equirectangular uses the scanline polygon above, drawn three times a map
     width apart so the antimeridian wrap needs no special case.

     Orthographic is harder, because the part of the cap on the far side of the
     globe must be discarded rather than folded onto the near side. The cap
     boundary is walked in three dimensions, the run of points facing the
     viewer is kept, and the region is closed along the limb between the two
     crossings. The cap and the visible hemisphere are both convex, so there is
     exactly one such run and one limb arc to add. */
  function fillCap(ctx, proj, lat0, lon0, radiusDeg, style) {
    ctx.save();
    proj.clipPath(ctx);
    ctx.clip();
    ctx.fillStyle = style;
    if (proj.kind !== 'ortho') {
      var pts = capPolygon(lat0, radiusDeg);
      /* Offsets are measured from the cap center and then shifted to the
         projection center, so a cap covering every longitude keeps running
         past plus or minus 180 instead of being folded back on itself. */
      var base = wrapLon(lon0 - proj.center[0]);
      var step2 = proj.fwdOffset ? proj.fwdOffset
        : function (dl, lat) { return proj.fwd(proj.center[0] + dl, lat); };
      if (pts.length) {
        withRepeats(ctx, proj, function () {
          ctx.beginPath();
          for (var i = 0; i < pts.length; i++) {
            var p = step2(base + pts[i][0], pts[i][1]);
            if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
          }
          ctx.closePath();
          ctx.fill();
        });
      }
    } else {
      fillCapOrtho(ctx, proj, lat0, lon0, radiusDeg);
    }
    ctx.restore();
  }

  function fillCapOrtho(ctx, proj, lat0, lon0, radiusDeg) {
    var N = 512;
    var c = unitVec(lat0, lon0);
    var cr = Math.cos(radiusDeg * DEG);
    var v = proj.view, ex = proj.east, ey = proj.north;
    var cx = proj.canvasCenter[0], cy = proj.canvasCenter[1], R = proj.radius;

    function screen(p) {
      return [cx + R * dot3(p, ex), cy - R * dot3(p, ey)];
    }
    function discPath() {
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, 2 * Math.PI);
      ctx.fill();
    }

    var ring = capRing3(c, radiusDeg, N);
    var vis = ring.map(function (p) { return dot3(p, v) >= 0; });
    var nVis = vis.reduce(function (s, b) { return s + (b ? 1 : 0); }, 0);

    if (nVis === 0) {
      // Either the cap is wholly hidden, or it swallows the whole near side.
      if (dot3(v, c) >= cr) discPath();
      return;
    }
    if (nVis === N) {
      ctx.beginPath();
      ring.forEach(function (p, i) {
        var s = screen(p);
        if (i === 0) ctx.moveTo(s[0], s[1]); else ctx.lineTo(s[0], s[1]);
      });
      ctx.closePath();
      ctx.fill();
      return;
    }

    // Start of the single visible run
    var start = -1, i2;
    for (i2 = 0; i2 < N; i2++) {
      if (vis[i2] && !vis[(i2 - 1 + N) % N]) { start = i2; break; }
    }
    if (start < 0) return;

    var run = [];
    for (i2 = 0; i2 < N; i2++) {
      var idx = (start + i2) % N;
      if (!vis[idx]) break;
      run.push(ring[idx]);
    }

    // Screen angles where the boundary meets the limb, measured with y up
    function limbAngle(p) {
      var s = screen(p);
      return Math.atan2(-(s[1] - cy), s[0] - cx);
    }
    var aEnter = limbAngle(run[0]);
    var aExit = limbAngle(run[run.length - 1]);

    // Pick the limb direction whose midpoint lies inside the cap
    function limbPoint(a) {
      return [Math.cos(a) * ex[0] + Math.sin(a) * ey[0],
              Math.cos(a) * ex[1] + Math.sin(a) * ey[1],
              Math.cos(a) * ex[2] + Math.sin(a) * ey[2]];
    }
    var span = aEnter - aExit;
    while (span <= 0) span += 2 * Math.PI;
    var mid = aExit + span / 2;
    if (dot3(limbPoint(mid), c) < cr) span -= 2 * Math.PI;

    ctx.beginPath();
    run.forEach(function (p, i) {
      var s = screen(p);
      if (i === 0) ctx.moveTo(s[0], s[1]); else ctx.lineTo(s[0], s[1]);
    });
    var steps = Math.max(8, Math.ceil(Math.abs(span) / (2 * Math.PI) * 256));
    for (var j = 1; j <= steps; j++) {
      var a = aExit + span * (j / steps);
      ctx.lineTo(cx + R * Math.cos(a), cy - R * Math.sin(a));
    }
    ctx.closePath();
    ctx.fill();
  }

  // ------------------------------------------------------ marching squares

  /* Extracts the zero contour of f over a lon/lat window and stitches the
     resulting segments into closed or open polylines.
     Returns an array of [lon, lat] arrays. */
  function contour(f, lonMin, lonMax, latMin, latMax, nx, ny) {
    var dx = (lonMax - lonMin) / nx;
    var dy = (latMax - latMin) / ny;
    var vals = new Float64Array((nx + 1) * (ny + 1));
    var i, j;
    for (j = 0; j <= ny; j++) {
      for (i = 0; i <= nx; i++) {
        vals[j * (nx + 1) + i] = f(lonMin + i * dx, latMin + j * dy);
      }
    }

    var segs = [];
    function interp(x1, y1, v1, x2, y2, v2) {
      var t = v1 / (v1 - v2);
      return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
    }

    for (j = 0; j < ny; j++) {
      for (i = 0; i < nx; i++) {
        var x0 = lonMin + i * dx, x1 = x0 + dx;
        var y0 = latMin + j * dy, y1 = y0 + dy;
        var v00 = vals[j * (nx + 1) + i];
        var v10 = vals[j * (nx + 1) + i + 1];
        var v11 = vals[(j + 1) * (nx + 1) + i + 1];
        var v01 = vals[(j + 1) * (nx + 1) + i];
        if (!isFinite(v00) || !isFinite(v10) || !isFinite(v11) || !isFinite(v01)) continue;
        var idx = (v00 > 0 ? 1 : 0) | (v10 > 0 ? 2 : 0) | (v11 > 0 ? 4 : 0) | (v01 > 0 ? 8 : 0);
        if (idx === 0 || idx === 15) continue;
        var B = (v00 * v10 <= 0) ? interp(x0, y0, v00, x1, y0, v10) : null; // bottom
        var R = (v10 * v11 <= 0) ? interp(x1, y0, v10, x1, y1, v11) : null; // right
        var T = (v01 * v11 <= 0) ? interp(x0, y1, v01, x1, y1, v11) : null; // top
        var L = (v00 * v01 <= 0) ? interp(x0, y0, v00, x0, y1, v01) : null; // left
        var pairs;
        switch (idx) {
          case 1: case 14: pairs = [[L, B]]; break;
          case 2: case 13: pairs = [[B, R]]; break;
          case 3: case 12: pairs = [[L, R]]; break;
          case 4: case 11: pairs = [[R, T]]; break;
          case 6: case 9:  pairs = [[B, T]]; break;
          case 7: case 8:  pairs = [[L, T]]; break;
          case 5:          pairs = [[L, T], [B, R]]; break;
          case 10:         pairs = [[L, B], [R, T]]; break;
          default: pairs = [];
        }
        for (var k = 0; k < pairs.length; k++) {
          if (pairs[k][0] && pairs[k][1]) segs.push(pairs[k]);
        }
      }
    }
    return stitch(segs, Math.min(dx, dy) * 0.5);
  }

  function stitch(segs, tol) {
    var key = function (p) {
      return Math.round(p[0] / tol) + ',' + Math.round(p[1] / tol);
    };
    var map = new Map();
    segs.forEach(function (s, i) {
      [key(s[0]), key(s[1])].forEach(function (k) {
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(i);
      });
    });
    var used = new Array(segs.length).fill(false);
    var lines = [];
    for (var i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      var line = [segs[i][0], segs[i][1]];
      // extend forward, then backward
      for (var dir = 0; dir < 2; dir++) {
        for (;;) {
          var end = line[line.length - 1];
          var cand = map.get(key(end)) || [];
          var next = -1;
          for (var c = 0; c < cand.length; c++) {
            if (!used[cand[c]]) { next = cand[c]; break; }
          }
          if (next < 0) break;
          used[next] = true;
          var s = segs[next];
          line.push(key(s[0]) === key(end) ? s[1] : s[0]);
        }
        line.reverse();
      }
      if (line.length > 2) lines.push(line);
    }
    return lines;
  }

  // ---------------------------------------------------------- solar shadow

  /* Builds the Moon shadow geometry for one instant, in equator-of-date
     kilometres. The z axis is dilated by the flattening ratio so that the
     Earth becomes a sphere, which is what makes the axis intersection a
     plain quadratic (Montenbruck and Pfleger, second edition, p 184).

     Validated against Astronomy Engine's own SearchGlobalSolarEclipse to
     sub-meter agreement on five consecutive central eclipses. */
  function shadow(time) {
    var S = A.GeoVector(A.Body.Sun, time, true);   // light-time and aberration
    var M = A.GeoMoon(time);
    var rot = A.Rotation_EQJ_EQD(time);

    var vv = A.RotateVector(rot, new A.Vector(M.x - S.x, M.y - S.y, M.z - S.z, time));
    var mm = A.RotateVector(rot, new A.Vector(M.x, M.y, M.z, time));
    var ss = A.RotateVector(rot, new A.Vector(S.x, S.y, S.z, time));

    // Sun to Moon vector and unit axis, in km
    var vx = vv.x * KM_AU, vy = vv.y * KM_AU, vz = vv.z * KM_AU;
    var dsm = Math.hypot(vx, vy, vz);
    var ax = vx / dsm, ay = vy / dsm, az = vz / dsm;

    var mx = mm.x * KM_AU, my = mm.y * KM_AU, mz = mm.z * KM_AU;
    var sx = ss.x * KM_AU, sy = ss.y * KM_AU, sz = ss.z * KM_AU;

    var tanUmbra = (SUN_R - MOON_R) / dsm;
    var tanPen = (SUN_R + MOON_R) / dsm;

    // Axis intersection with the geoid, in the dilated frame
    var Vz = vz / FLAT, Ez = -mz / FLAT;           // lunacentric Earth = -Moon
    var Ex = -mx, Ey = -my;
    var qa = vx * vx + vy * vy + Vz * Vz;
    var qb = -2 * (vx * Ex + vy * Ey + Vz * Ez);
    var qc = Ex * Ex + Ey * Ey + Ez * Ez - EARTH_A * EARTH_A;
    var radic = qb * qb - 4 * qa * qc;

    var axis = null;
    if (radic > 0) {
      var u = (-qb - Math.sqrt(radic)) / (2 * qa);
      var px = u * vx - Ex, py = u * vy - Ey, pz = (u * Vz - Ez) * FLAT;
      var obs = A.VectorObserver(new A.Vector(px / KM_AU, py / KM_AU, pz / KM_AU, time), true);
      axis = { lat: obs.latitude, lon: obs.longitude };
    }

    /* Signed shadow depth at a point on the Earth's surface, in km.
         > 0  inside the umbra (or antumbra, when the cone has crossed its apex)

       The result is the smaller of two distances, the margin inside the
       shadow cone and the margin inside the sunlit hemisphere. Taking the
       minimum means the zero contour is the shadow boundary clipped at the
       terminator, and stays a single smooth closed curve, which is what lets
       the region be filled rather than only stroked. A hard mask would leave
       the contour open wherever the shadow runs off the day side. */
    function depth(lat, lon, which) {
      var o = A.ObserverVector(time, new A.Observer(lat, lon, 0), true);
      var qx = o.x * KM_AU, qy = o.y * KM_AU, qz = o.z * KM_AU;

      // Geodetic normal at the surface point
      var nx = qx / (EARTH_A * EARTH_A);
      var ny = qy / (EARTH_A * EARTH_A);
      var nz = qz / (EARTH_A * FLAT * EARTH_A * FLAT);
      var nm = Math.hypot(nx, ny, nz);

      // Sun altitude as an arc distance from the terminator, in km
      var ux = sx - qx, uy = sy - qy, uz = sz - qz;
      var um = Math.hypot(ux, uy, uz);
      var sinAlt = (ux * nx + uy * ny + uz * nz) / (nm * um);
      var sunMargin = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * EARTH_A;

      var rx = qx - mx, ry = qy - my, rz = qz - mz;
      var t = rx * ax + ry * ay + rz * az;
      var perp = Math.hypot(rx - t * ax, ry - t * ay, rz - t * az);
      var r = (which === 'penumbra')
        ? MOON_R + t * tanPen
        : Math.abs(MOON_R - t * tanUmbra);
      return Math.min(r - perp, sunMargin);
    }

    /* Sub-solar point. The vector has to be scaled down to roughly the Earth's
       radius first: VectorObserver inverts the geodetic latitude iteratively
       and that iteration does not converge for a point an astronomical unit
       away. Only the direction matters here, so the scale is free to change. */
    var sm = Math.hypot(sx, sy, sz) / EARTH_A;
    var sub = A.VectorObserver(
      new A.Vector(sx / sm / KM_AU, sy / sm / KM_AU, sz / sm / KM_AU, time), true);

    /* Does the penumbral cone touch the Earth at all? Compare the Earth's
       center distance from the shadow axis against the penumbral radius
       there, plus the Earth's own radius. This is the cheap analytic test the
       time-range search runs thousands of times, so it avoids any grid. */
    var tc = -(mx * ax + my * ay + mz * az);
    var cxp = mx + tc * ax, cyp = my + tc * ay, czp = mz + tc * az;
    var axisDist = Math.hypot(cxp, cyp, czp);
    var penAtEarth = MOON_R + tc * tanPen;
    var reaches = tc > 0 && axisDist <= EARTH_A + penAtEarth;

    return {
      time: time,
      axis: axis,
      depth: depth,
      reachesEarth: reaches,
      subsolar: { lat: sub.latitude, lon: sub.longitude },
      // umbral radius at the axis intersection, negative when annular
      axisUmbraRadius: (function () {
        if (!axis) return null;
        var o = A.ObserverVector(time, new A.Observer(axis.lat, axis.lon, 0), true);
        var t = (o.x * KM_AU - mx) * ax + (o.y * KM_AU - my) * ay + (o.z * KM_AU - mz) * az;
        return MOON_R - t * tanUmbra;
      })()
    };
  }

  // ----------------------------------------------------------------- tiles

  /* Optional street-level basemap from Web Mercator raster tiles.

     This is the only part of the toolkit that talks to the network. Raster
     tiles exist solely in Web Mercator, so under the Mercator projection they
     are blitted straight to the canvas. Every other projection, the globe
     included, gets the imagery warped on the fly: the visible tiles are
     assembled into an offscreen Mercator mosaic, the screen is divided into
     small cells, and each cell samples the mosaic under the affine map implied
     by the projection's inverse at its corners. At cell size the warp is
     indistinguishable from an exact reprojection.

     The style is deliberately the gray, label-free CARTO basemap: it sits
     quietly under a monochrome chart, and leaving the labels off means the
     tool's own place names are the only ones on screen. */
  var tileCache = new Map();
  var tileCachePixels = 0;
  /* Raster tiles are decoded images, not just their small network payloads.
     Bound both their count and their estimated decoded pixels: 24 million
     RGBA pixels are about 96 MiB, whether they came from ordinary or retina
     artwork. The count keeps a long trail of small tiles from accumulating,
     while the pixel budget stops 200 doubled tiles from quietly reaching
     about 200 MiB. Revisiting an older area simply asks for its tiles again. */
  var TILE_CACHE_MAX = 200;
  var TILE_CACHE_PIXEL_MAX = 24 * 1024 * 1024;
  var LAT_MAX_MERC = 85.051129;

  function estimatedTilePixels(url) {
    return url.indexOf('@2x') >= 0 ? 512 * 512 : 256 * 256;
  }

  function trimTileCache() {
    while (tileCache.size > TILE_CACHE_MAX || tileCachePixels > TILE_CACHE_PIXEL_MAX) {
      var oldest = tileCache.keys().next().value;
      var img = tileCache.get(oldest);
      tileCache.delete(oldest);
      tileCachePixels -= img._astroTilePixels || 0;
    }
    if (tileCachePixels < 0) tileCachePixels = 0;
  }

  /* Map preserves insertion order. Moving a hit to the end makes the bounded
     cache least-recently-used, so the tiles under the current view survive a
     long pan instead of being evicted merely because they arrived first. */
  function cachedTile(key) {
    var img = tileCache.get(key);
    if (img !== undefined) {
      tileCache.delete(key);
      tileCache.set(key, img);
    }
    return img;
  }

  function mercV(lat) {
    lat = Math.max(-LAT_MAX_MERC, Math.min(LAT_MAX_MERC, lat));
    return 0.5 - Math.log(Math.tan(Math.PI / 4 + lat * DEG / 2)) / (2 * Math.PI);
  }

  /* Base map themes. Every source below is free to use and sends
     Access-Control-Allow-Origin, which the canvas needs to draw the tiles
     without tainting itself. Labels cost nothing extra: they are simply a
     different variant of the same tile set, so the choice is editorial
     rather than commercial. Each theme carries the attribution its license
     requires, and its own deepest useful zoom. */
  function cartoUrl(variant, hi, z, x, y) {
    return 'https://' + 'abcd'[(x + y) % 4] + '.basemaps.cartocdn.com/' +
      variant + '/' + z + '/' + x + '/' + y + (hi ? '@2x' : '') + '.png';
  }

  var TILE_THEMES = {
    // Quiet gray wash, the one that disappears under a monochrome chart
    plain: {
      label: 'Plain',
      maxZoom: 19,
      retina: true,
      credit: '© OpenStreetMap contributors, © CARTO',
      tiles: function (dark, labels, hi, z, x, y) {
        return cartoUrl((dark ? 'dark' : 'light') + (labels ? '_all' : '_nolabels'),
          hi, z, x, y);
      }
    },
    // CARTO Voyager: colored land, blue water, green parks, drawn roads
    streets: {
      label: 'Streets',
      maxZoom: 19,
      retina: true,
      credit: '© OpenStreetMap contributors, © CARTO',
      tiles: function (dark, labels, hi, z, x, y) {
        return cartoUrl('rastertiles/voyager' + (labels ? '' : '_nolabels'), hi, z, x, y);
      }
    },
    /* OpenTopoMap: contour lines and hill shading. Its labels are painted
       into the imagery, so the labels switch cannot remove them; the page
       keeps its own names off instead, which is the same result. */
    terrain: {
      label: 'Terrain',
      maxZoom: 17,
      bakedLabels: true,
      credit: '© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)',
      tiles: function (dark, labels, hi, z, x, y) {
        return 'https://' + 'abc'[(x + y) % 3] + '.tile.opentopomap.org/' +
          z + '/' + x + '/' + y + '.png';
      }
    },
    /* Esri World Imagery, aerial and satellite photography. Its labels come
       as a separate transparent layer drawn over the top, which is why this
       theme is the one with an overlay. */
    satellite: {
      label: 'Satellite',
      maxZoom: 19,
      credit: 'Imagery © Esri, Maxar, Earthstar Geographics',
      tiles: function (dark, labels, hi, z, x, y) {
        return 'https://server.arcgisonline.com/ArcGIS/rest/services/' +
          'World_Imagery/MapServer/tile/' + z + '/' + y + '/' + x;
      },
      overlay: function (hi, z, x, y) {
        return 'https://server.arcgisonline.com/ArcGIS/rest/services/' +
          'Reference/World_Boundaries_and_Places/MapServer/tile/' + z + '/' + y + '/' + x;
      }
    }
  };

  /* Resolves the caller's request into the layers to draw, deepest zoom, and
     credit line. A bare 'light' or 'dark' string still works, so callers
     that predate themes need no change. */
  /* pixelRatio is how many canvas pixels the caller packs into one CSS pixel.
     It matters because tile artwork is drawn for CSS pixels: type, road
     widths and symbols are all sized for a 256 pixel tile shown at 256 CSS
     pixels. Choosing the zoom level from raw canvas pixels instead would
     shrink every label by that same ratio, which is what makes a
     supersampled map look like it is wearing the wrong glasses. So a tile
     always occupies 256 CSS pixels, and where the provider serves retina
     artwork the doubled image fills those pixels at full sharpness. */
  function tileSpec(opts) {
    if (typeof opts === 'string') opts = { dark: opts === 'dark' };
    opts = opts || {};
    var th = TILE_THEMES[opts.theme] || TILE_THEMES.plain;
    var dark = !!opts.dark, labels = !!opts.labels;
    var ratio = Math.max(1, Math.min(3, opts.pixelRatio || 1));
    /* Retina artwork costs four times the pixels to hold in memory, and it
       is worth that only on a display able to resolve it. The deciding
       number is the screen's own pixel ratio, not the canvas supersampling:
       the chart supersamples at one and a half whatever the display, so
       reading the ratio off the canvas asked every ordinary monitor to carry
       doubled tiles it then threw away on the way to the screen. A caller
       that does not say gets the old behavior, which is to follow the
       canvas. */
    var screen = Math.max(1, Math.min(3, opts.screenRatio || ratio));
    var hi = screen >= 1.5 && !!th.retina;
    var layers = [function (z, x, y) { return th.tiles(dark, labels, hi, z, x, y); }];
    if (labels && th.overlay) {
      layers.push(function (z, x, y) { return th.overlay(hi, z, x, y); });
    }
    return {
      layers: layers,
      maxZoom: th.maxZoom,
      credit: th.credit,
      // Canvas pixels one tile covers, so its artwork lands at its own size
      tilePx: 256 * ratio,
      // Native pixels held by one source tile, before canvas supersampling
      sourcePx: hi ? 512 : 256,
      // Whether the imagery carries names of its own no matter the switch
      bakedLabels: !!th.bakedLabels,
      // Draw from what is already held, request nothing new
      noFetch: !!opts.noFetch,
      // A coarser but still screen-accurate mesh while the view is moving
      moving: !!opts.moving,
      /* Everything about the request that decides which artwork comes back,
         so the mosaic below can tell one theme's tiles from another's. */
      id: (opts.theme || 'plain') + (dark ? '/d' : '/l') + (labels ? '+n' : '') +
        (hi ? '@2' : '') + '/' + Math.round(256 * ratio)
    };
  }

  function tileMaxZoom(theme) {
    var th = TILE_THEMES[theme] || TILE_THEMES.plain;
    return th.maxZoom;
  }

  /* Counts tiles that have arrived. The mosaic below keeps its pixels between
     frames, and a tile landing is the one thing that can change them without
     the view having moved, so it stamps this and rebuilds when the stamp
     moves on. */
  var tilesArrived = 0;

  function getTile(urlFn, z, x, y, onLoad, noFetch) {
    var key = urlFn(z, x, y);
    var img = cachedTile(key);
    if (img === undefined) {
      /* A zoom in flight asks for nothing. Every level the animation sweeps
         through would otherwise pull a full screen of tiles that is on
         display for a few frames and then never wanted again, which was the
         largest single source of wasted fetching on the page. The levels
         already in hand cover the view meanwhile, through coarseTile below. */
      if (noFetch) return null;
      img = new Image();
      img.crossOrigin = 'anonymous';
      img._astroTilePixels = estimatedTilePixels(key);
      img.onload = function () {
        /* A tile can finish after a long pan or a theme change evicted it.
           It no longer affects the active bounded cache, so it must not
           invalidate the current mosaic or schedule an unrelated redraw. */
        if (tileCache.get(key) !== img) return;
        /* Providers normally match the estimate above. Reading the delivered
           dimensions also keeps the bound honest for a provider variant or a
           test fixture with a different native size. */
        var actual = img.naturalWidth * img.naturalHeight;
        tileCachePixels += actual - img._astroTilePixels;
        img._astroTilePixels = actual;
        trimTileCache();
        if (tileCache.get(key) !== img) return;
        tilesArrived++;
        onLoad();
      };
      img.onerror = function () {
        /* A failed image has no decoded pixel allocation. Keep the small
           failed entry so an offline animation does not retry it every frame,
           but release the conservative reservation from the pixel budget. */
        if (tileCache.get(key) !== img) return;
        tileCachePixels -= img._astroTilePixels;
        img._astroTilePixels = 0;
        if (tileCachePixels < 0) tileCachePixels = 0;
      };
      tileCache.set(key, img);
      tileCachePixels += img._astroTilePixels;
      trimTileCache();
      img.src = key;
    }
    return (img.complete && img.naturalWidth) ? img : null;
  }

  /* The same ground from a shallower level, for a tile that has not arrived.
     One tile at zoom z sits inside one tile at z-1, a quarter of it, and so
     on up, so any ancestor already in the cache can stand in by drawing the
     matching quarter of a quarter stretched to fill. Slightly soft, and far
     better than the hole it replaces: without this a zoom drops the whole
     base map back to bundled outlines until the new level lands. Five levels
     up is a thirty-two fold stretch, past which the substitute says nothing.

     Returns the source rectangle to lift out of the ancestor, in that
     image's own pixels. */
  function coarseTile(urlFn, z, x, y) {
    for (var dz = 1; dz <= 5 && z - dz >= 0; dz++) {
      var span = 1 << dz;
      var img = cachedTile(urlFn(z - dz, Math.floor(x / span), Math.floor(y / span)));
      if (!img || !img.complete || !img.naturalWidth) continue;
      var part = img.naturalWidth / span;
      return { img: img, sx: (x % span) * part, sy: (y % span) * part, s: part };
    }
    return null;
  }

  /* Draws a tile, or the best stand-in for it, into a destination square.
     Reports whether anything was painted so the caller can tell an empty map
     from a soft one. */
  function paintTile(ctx, urlFn, z, x, y, onLoad, noFetch, dx, dy, dw, dh) {
    var img = getTile(urlFn, z, x, y, onLoad, noFetch);
    if (img) {
      ctx.drawImage(img, dx, dy, dw, dh);
      return true;
    }
    var c = coarseTile(urlFn, z, x, y);
    if (!c) return false;
    ctx.drawImage(c.img, c.sx, c.sy, c.s, c.s, dx, dy, dw, dh);
    return true;
  }

  /* opts is {theme, dark, labels}, or the legacy 'light' / 'dark' string. */
  function drawTiles(ctx, proj, onLoad, opts) {
    var spec = tileSpec(opts);
    if (proj.kind === 'mercator') {
      releaseTileMosaic();
      return drawTilesMerc(ctx, proj, onLoad, spec);
    }
    return drawTilesWarp(ctx, proj, onLoad, spec);
  }

  function drawTilesMerc(ctx, proj, onLoad, spec) {
    var worldW = proj.worldWidth;
    var z = Math.max(0, Math.min(spec.maxZoom,
      Math.round(Math.log2(worldW / spec.tilePx))));
    var n = Math.pow(2, z);
    var size = worldW / n;

    var uC = (proj.center[0] + 180) / 360, vC = mercV(proj.center[1]);
    var W = proj.width, H = proj.height;
    var ix0 = Math.floor((uC - (W / 2) / worldW) * n);
    var ix1 = Math.floor((uC + (W / 2) / worldW) * n);
    var iy0 = Math.max(0, Math.floor((vC - (H / 2) / worldW) * n));
    var iy1 = Math.min(n - 1, Math.floor((vC + (H / 2) / worldW) * n));

    var any = false;
    ctx.save();
    proj.clipPath(ctx);
    ctx.clip();
    for (var iy = iy0; iy <= iy1; iy++) {
      for (var ix = ix0; ix <= ix1; ix++) {
        for (var L = 0; L < spec.layers.length; L++) {
          // The extra pixel hides the hairline seams between neighbours
          var drew = paintTile(ctx, spec.layers[L], z, ((ix % n) + n) % n, iy,
            onLoad, spec.noFetch,
            W / 2 + (ix / n - uC) * worldW,
            H / 2 + (iy / n - vC) * worldW,
            size + 1, size + 1);
          if (drew && L === 0) any = true;
        }
      }
    }
    ctx.restore();
    // Nothing on screen yet (first load, or offline) leaves the caller free
    // to draw the bundled outlines instead of a blank map
    return any;
  }

  /* Offscreen mosaic of the tiles covering the visible window, in native
     tile-pixel coordinates. Source x is the global Mercator tile position
     minus ix0, multiplied by the mosaic's 256 or 512 pixel cell.

     The canvas and its contents both survive between frames. What the mosaic
     holds depends on nothing but the tile theme, the zoom level and the block
     of tile indices covering the window, so those make its key, and a frame
     that asks for the same key again is handed the same pixels back. That is
     the difference between a running animation and a stalled one: the shadow
     moves every frame while the map underneath it does not, and rebuilding a
     mosaic nobody changed was costing more than everything else the warp does
     put together. */
  var mosaic = { canvas: null, ctx: null, key: '', arrived: -1, out: null };

  /* Mercator draws source tiles directly and has no use for the projection
     mosaic. Collapse its backing store when switching back to Mercator so a
     visit to Globe does not leave tens of megabytes resident indefinitely. */
  function releaseTileMosaic() {
    if (!mosaic.canvas) return;
    if (mosaic.canvas.width !== 1 || mosaic.canvas.height !== 1) {
      mosaic.canvas.width = 1;
      mosaic.canvas.height = 1;
    }
    mosaic.key = '';
    mosaic.arrived = -1;
    mosaic.out = null;
  }

  function tileMosaic(proj, onLoad, spec) {
    var win = viewWindow(proj);
    if (!win) return null;

    /* The coarse sampling grid behind viewWindow underestimates the globe:
       the extreme longitudes and latitudes of a hemisphere sit exactly on the
       limb, and a pole inside the disc swings the longitudes through the full
       circle. Walking the limb, and testing the poles directly, closes both
       gaps; only limb points actually on screen count, so a zoomed-in view
       keeps its tight window. */
    if (proj.kind === 'ortho') {
      var c0v = proj.center[0];
      var canvasCenter = proj.canvasCenter;
      var dlLo = wrapLon(win.lon0 - c0v), dlHi = wrapLon(win.lon1 - c0v);
      for (var q = 0; q < 64; q++) {
        var th = q / 64 * 2 * Math.PI;
        var lx = canvasCenter[0] + Math.cos(th) * (proj.radius - 0.5);
        var ly = canvasCenter[1] + Math.sin(th) * (proj.radius - 0.5);
        if (lx < 0 || lx > proj.width || ly < 0 || ly > proj.height) continue;
        var lm = proj.inv(lx, ly);
        if (!lm) continue;
        if (lm[1] < win.lat0) win.lat0 = lm[1];
        if (lm[1] > win.lat1) win.lat1 = lm[1];
        var dq = wrapLon(lm[0] - c0v);
        if (dq < dlLo) dlLo = dq;
        if (dq > dlHi) dlHi = dq;
      }
      win.lon0 = c0v + dlLo - gridPad(dlHi - dlLo);
      win.lon1 = c0v + dlHi + gridPad(dlHi - dlLo);
      [90, -90].forEach(function (plat) {
        if (!proj.vis(0, plat)) return;
        var pp = proj.fwd(0, plat);
        if (pp[0] < 0 || pp[0] > proj.width || pp[1] < 0 || pp[1] > proj.height) return;
        if (plat > 0) win.lat1 = 90; else win.lat0 = -90;
        win.lon0 = c0v - 181;
        win.lon1 = c0v + 181;
      });
    }

    var lat0 = Math.max(-LAT_MAX_MERC, win.lat0);
    var lat1 = Math.min(LAT_MAX_MERC, win.lat1);
    if (lat1 <= lat0) return null;

    /* Tile zoom from the on-screen pixel size of a full world. The globe's
       equivalent is its circumference in canvas pixels. The level backs off
       until the visible window needs a sane number of tiles, which matters
       when a whole hemisphere is on screen. */
    var worldW = (proj.kind === 'ortho') ? proj.radius * 2 * Math.PI : proj.worldWidth;
    var z = Math.max(0, Math.min(spec.maxZoom,
      Math.round(Math.log2(worldW / spec.tilePx))));
    var n, ix0, ix1, iy0, iy1;
    for (;;) {
      n = Math.pow(2, z);
      ix0 = Math.floor((win.lon0 + 180) / 360 * n);
      ix1 = Math.floor((win.lon1 + 180) / 360 * n);
      iy0 = Math.max(0, Math.floor(mercV(lat1) * n));
      iy1 = Math.min(n - 1, Math.floor(mercV(lat0) * n));
      /* Include the two seam columns and every imagery layer in the working
         set bound. This guarantees that the active view fits inside both
         cache limits, including retina tiles, instead of endlessly evicting
         and requesting its own oldest tiles on a tall or polar view. */
      var mosaicTiles = (ix1 - ix0 + 3) * (iy1 - iy0 + 1);
      var requestedTiles = mosaicTiles * spec.layers.length;
      var requestedPixels = requestedTiles * spec.sourcePx * spec.sourcePx;
      if (z === 0 || (mosaicTiles <= 96 &&
          requestedTiles <= TILE_CACHE_MAX && requestedPixels <= TILE_CACHE_PIXEL_MAX)) break;
      z--;
    }
    // One spare column each side so cells straddling the wrap seam still
    // find their pixels
    ix0--; ix1++;

    /* Keep the mosaic at the artwork's native resolution. Its coordinate
       scale is independent of the number of backing pixels the tile covers,
       so inflating a 256 pixel source to 384 or 640 pixels here added memory
       and sampling work without adding detail. Retina sources stay at 512. */
    var cell = spec.sourcePx;
    var cw = (ix1 - ix0 + 1) * cell, ch = (iy1 - iy0 + 1) * cell;

    /* Nothing about this frame differs from the last one that built the
       mosaic, so the pixels already on the canvas are the answer. */
    /* A mosaic built while requests were held back must not satisfy a later
       frame that is allowed to fetch, or the zoom would settle on the soft
       stand-in and never ask for the sharp tiles. */
    var key = spec.id + '/' + z + '/' + ix0 + ',' + ix1 + ',' + iy0 + ',' + iy1 +
      (spec.noFetch ? '/held' : '');
    if (mosaic.out && mosaic.key === key && mosaic.arrived === tilesArrived) {
      return mosaic.out;
    }
    mosaic.key = key;
    mosaic.arrived = tilesArrived;
    mosaic.out = null;

    if (!mosaic.canvas) {
      mosaic.canvas = document.createElement('canvas');
      mosaic.ctx = mosaic.canvas.getContext('2d');
    }
    /* Sized to the window rather than to the largest window ever seen, so a
       session that opened on the whole globe does not carry its canvas around
       for the rest of the afternoon. Resizing clears the canvas by itself;
       only a rebuild that happens to want the same dimensions has to ask. */
    if (mosaic.canvas.width !== cw || mosaic.canvas.height !== ch) {
      mosaic.canvas.width = cw;
      mosaic.canvas.height = ch;
    } else {
      mosaic.ctx.clearRect(0, 0, cw, ch);
    }
    var any = false;
    for (var iy = iy0; iy <= iy1; iy++) {
      for (var ix = ix0; ix <= ix1; ix++) {
        for (var L = 0; L < spec.layers.length; L++) {
          var drew = paintTile(mosaic.ctx, spec.layers[L], z, ((ix % n) + n) % n, iy,
            onLoad, spec.noFetch,
            (ix - ix0) * cell, (iy - iy0) * cell, cell, cell);
          if (drew && L === 0) any = true;
        }
      }
    }
    if (!any) return null;
    mosaic.out = { canvas: mosaic.canvas, n: n, ix0: ix0, iy0: iy0,
                   cw: cw, ch: ch, cell: cell };
    return mosaic.out;
  }

  /* Inverse projection with a fallback for points just off the mapped area,
     found by stepping toward the canvas center until the inverse works. Used
     for mesh corners at the globe's limb and outside Robinson's boundary, so
     the last row of cells still gets imagery; the overdraw lands outside the
     projection's clip path and is never seen. */
  function invNear(proj, x, y) {
    var got = proj.inv(x, y);
    if (got) return got;
    var cx = proj.width / 2, cy = proj.height / 2;
    for (var t = 0.02; t < 1; t += 0.07) {
      got = proj.inv(x + (cx - x) * t, y + (cy - y) * t);
      if (got) return got;
    }
    return null;
  }

  function drawTilesWarp(ctx, proj, onLoad, spec) {
    var m = tileMosaic(proj, onLoad, spec);
    if (!m) return false;
    var Wp = proj.width, Hp = proj.height;
    var c0 = (proj.center && proj.center[0]) || 0;
    /* The visual error belongs in CSS pixels, not backing-store pixels.
       Scaling the mesh with the canvas pixel ratio preserves the same
       48-pixel perceived accuracy on every display instead of multiplying
       the number of cells on supersampled and retina canvases. */
    var cssCell = spec.moving ? 64 : 48;
    var CELL = Math.max(24, Math.round(cssCell * spec.tilePx / 256));
    var cols = Math.ceil(Wp / CELL), rows = Math.ceil(Hp / CELL);
    var nxg = cols + 1;
    var n256 = m.n * m.cell;

    var grid = new Array(nxg * (rows + 1));
    for (var j = 0; j <= rows; j++) {
      for (var i = 0; i <= cols; i++) {
        grid[j * nxg + i] = invNear(proj, Math.min(Wp, i * CELL), Math.min(Hp, j * CELL));
      }
    }

    function srcOf(ll, lonBase, sx0) {
      return [sx0 + wrapLon(ll[0] - lonBase) / 360 * n256,
              (mercV(ll[1]) * m.n - m.iy0) * m.cell];
    }

    ctx.save();
    proj.clipPath(ctx);
    ctx.clip();
    var any = false;
    for (j = 0; j < rows; j++) {
      for (i = 0; i < cols; i++) {
        var x = i * CELL, y = j * CELL;
        var xr = Math.min(Wp, x + CELL), yb = Math.min(Hp, y + CELL);
        var w = xr - x, h = yb - y;
        if (w <= 0 || h <= 0) continue;

        // Cells that cannot touch the globe's disc are skipped outright
        if (proj.kind === 'ortho') {
          var qx = Math.max(x, Math.min(proj.canvasCenter[0], xr)) - proj.canvasCenter[0];
          var qy = Math.max(y, Math.min(proj.canvasCenter[1], yb)) - proj.canvasCenter[1];
          if (qx * qx + qy * qy > proj.radius * proj.radius) continue;
        }

        var ll00 = grid[j * nxg + i], ll10 = grid[j * nxg + i + 1];
        var ll01 = grid[(j + 1) * nxg + i], ll11 = grid[(j + 1) * nxg + i + 1];
        if (!ll00 || !ll10 || !ll01) continue;

        // No tiles exist past 85 degrees; leave the chart background there
        var latLo = Math.min(ll00[1], ll10[1], ll01[1]);
        var latHi = Math.max(ll00[1], ll10[1], ll01[1]);
        if (ll11) {
          latLo = Math.min(latLo, ll11[1]);
          latHi = Math.max(latHi, ll11[1]);
        }
        if (latLo > LAT_MAX_MERC || latHi < -LAT_MAX_MERC) continue;

        /* Source coordinates in the mosaic. Longitudes unwrap relative to the
           cell's own first corner, so a cell sitting on the antimeridian seam
           stays contiguous instead of jumping a world width. */
        var lonBase = c0 + wrapLon(ll00[0] - c0);
        var sx0 = ((lonBase + 180) / 360 * m.n - m.ix0) * m.cell;
        var s00 = srcOf(ll00, lonBase, sx0), s10 = srcOf(ll10, lonBase, sx0);
        var s01 = srcOf(ll01, lonBase, sx0);
        var s11 = ll11 ? srcOf(ll11, lonBase, sx0)
          : [s10[0] + s01[0] - s00[0], s10[1] + s01[1] - s00[1]];

        var ux = s10[0] - s00[0], uy = s10[1] - s00[1];
        var vx = s01[0] - s00[0], vy = s01[1] - s00[1];
        var det = ux * vy - uy * vx;
        if (!det) continue;

        // Affine taking mosaic coordinates to this screen cell
        var a = w * vy / det, b = -h * uy / det;
        var c2 = -w * vx / det, d = h * ux / det;
        var e = x - (a * s00[0] + c2 * s00[1]);
        var f = y - (b * s00[0] + d * s00[1]);

        /* The corners bound the sources only approximately: a nudged boundary
           corner sits short of where the cell's affine actually reaches, so
           the padding scales with the cell's own source span rather than
           being a fixed sliver. */
        var pad = 8 + Math.max(Math.abs(ux), Math.abs(uy), Math.abs(vx), Math.abs(vy));
        var bx0 = Math.max(0, Math.min(s00[0], s10[0], s01[0], s11[0]) - pad);
        var by0 = Math.max(0, Math.min(s00[1], s10[1], s01[1], s11[1]) - pad);
        var bx1 = Math.min(m.cw, Math.max(s00[0], s10[0], s01[0], s11[0]) + pad);
        var by1 = Math.min(m.ch, Math.max(s00[1], s10[1], s01[1], s11[1]) + pad);
        if (bx1 <= bx0 || by1 <= by0) continue;

        ctx.save();
        ctx.beginPath();
        // Half a pixel of overlap hides the hairline seams between cells
        ctx.rect(x - 0.5, y - 0.5, w + 1, h + 1);
        ctx.clip();
        ctx.setTransform(a, b, c2, d, e, f);
        ctx.drawImage(m.canvas, bx0, by0, bx1 - bx0, by1 - by0,
          bx0, by0, bx1 - bx0, by1 - by0);
        any = true;
        ctx.restore();
      }
    }
    ctx.restore();
    return any;
  }

  /* Attribution for whichever theme is on screen, since each source asks for
     its own wording. */
  function drawTileCredit(ctx, proj, pal, opts) {
    var text = tileSpec(opts).credit;
    ctx.save();
    ctx.font = '20px system-ui, -apple-system, sans-serif';
    var w = ctx.measureText(text).width;
    // Sits above the zoom control, which occupies the very corner
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = pal.sky;
    ctx.fillRect(proj.width - w - 20, proj.height - 130, w + 16, 26);
    ctx.globalAlpha = 1;
    ctx.fillStyle = pal.soft;
    ctx.textBaseline = 'top';
    ctx.fillText(text, proj.width - w - 12, proj.height - 126);
    ctx.restore();
  }

  // ---------------------------------------------------------------- labels

  /* Place names, thinned by zoom and by collision.

     Two rules keep the map readable. What qualifies for a label depends on
     zoom, so a world view shows only the largest cities and a close view fills
     in smaller ones. What actually gets drawn depends on whether its box
     overlaps something already placed, tested against a list of occupied
     rectangles. Candidates are sorted by importance first, so when two labels
     collide the more significant one wins. */
  function labelPlacer(ctx, proj, pal) {
    var taken = [];
    var W = proj.width, H = proj.height;

    function free(x, y, w, h) {
      if (x < 2 || y < 2 || x + w > W - 2 || y + h > H - 2) return false;
      for (var i = 0; i < taken.length; i++) {
        var t = taken[i];
        if (x < t[2] && x + w > t[0] && y < t[3] && y + h > t[1]) return false;
      }
      return true;
    }

    return {
      /* Reserves a box without drawing, so existing marks push labels aside. */
      block: function (x, y, w, h) { taken.push([x, y, x + w, y + h]); },

      text: function (lon, lat, str, opts) {
        opts = opts || {};
        if (!proj.vis(lon, lat)) return false;
        var p = proj.fwd(lon, lat);
        ctx.font = opts.font || '22px system-ui, -apple-system, sans-serif';
        var m = ctx.measureText(str);
        var tw = m.width, th = opts.size || 22;
        var dx = opts.dot ? 12 : -tw / 2;
        var x = p[0] + dx, y = p[1] - th / 2 + (opts.dy || 0);
        if (!free(x - 3, y - 2, tw + 6, th + 4)) return false;
        taken.push([x - 3, y - 2, x + tw + 3, y + th + 2]);

        if (opts.dot) {
          ctx.beginPath();
          ctx.arc(p[0], p[1], opts.dotSize || 3.2, 0, 2 * Math.PI);
          ctx.fillStyle = opts.color || pal.ink;
          ctx.fill();
        }
        // Halo so names stay legible over coastlines and shading
        ctx.lineWidth = 4;
        ctx.strokeStyle = pal.sky;
        ctx.textBaseline = 'top';
        ctx.strokeText(str, x, y);
        ctx.fillStyle = opts.color || pal.ink;
        ctx.fillText(str, x, y);
        return true;
      }
    };
  }

  /* Draws country names then city names, biggest first. Thresholds are tuned
     so the count stays roughly constant as you zoom rather than exploding. */
  function drawPlaceLabels(ctx, proj, pal, opts) {
    opts = opts || {};
    var k = proj.zoom || 1;
    var placer = opts.placer || labelPlacer(ctx, proj, pal);
    var i, drawn = 0;

    ctx.save();
    proj.clipPath(ctx);
    ctx.clip();

    if (opts.countries !== false) {
      var areaMin = 260 / (k * k);
      for (i = 0; i < countries.length && drawn < 40; i++) {
        var c = countries[i];
        if (c[3] < areaMin) break;               // sorted by area, so stop
        if (placer.text(c[2], c[1], c[0].toUpperCase(), {
          font: '20px system-ui, -apple-system, sans-serif',
          size: 20, color: pal.soft
        })) drawn++;
      }
    }

    if (opts.cities !== false) {
      // The floor falls away once the detail towns are in, so any place in
      // the data can eventually earn a label.
      var popMin = Math.max(places.merged ? 300 : 40000, 9e6 / Math.pow(k, 1.75));
      var placed = 0, cap = opts.maxCities || 110;
      var list = places.merged || cities;
      // Zoomed in, the population floor bottoms out and the loop would walk
      // every place in the data measuring text for each. Rejecting the ones
      // that are not on screen first turns that into a handful.
      var win = viewWindow(proj);
      for (i = 0; i < list.length && placed < cap; i++) {
        var ct = list[i];
        if (ct[3] < popMin && !ct[4]) continue;
        if (ct[3] < popMin * 0.15) break;        // sorted by population
        if (win && (ct[1] < win.lat0 || ct[1] > win.lat1 ||
            !boxVisible([ct[2], ct[2], ct[1], ct[1]], 0, win))) continue;
        if (placer.text(ct[2], ct[1], ct[0], {
          dot: true, size: 22,
          dotSize: ct[4] ? 4.2 : 3.2,
          color: pal.ink
        })) placed++;
      }
    }
    ctx.restore();
    return placer;
  }

  // ------------------------------------------------------------- time zones

  /* Civil local time at a place, using the tz-lookup table when it is loaded.
     Falls back to local mean time from the longitude, which is what an
     eclipse observer actually experiences even where no zone is defined. */
  function zoneAt(lat, lon) {
    if (typeof global.tzlookup === 'function') {
      try { return global.tzlookup(lat, lon); } catch (e) { /* fall through */ }
    }
    return null;
  }

  function formatInZone(date, zone) {
    try {
      var f = new Intl.DateTimeFormat('en-GB', {
        timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false, timeZoneName: 'short'
      });
      return f.format(date);
    } catch (e) {
      return null;
    }
  }

  /* Minutes to add to UTC to get the wall clock in a named zone at a given
     instant. Read back out of Intl rather than from a table, so daylight
     saving and historical rule changes are accounted for without shipping
     any of those rules. */
  /* Building a DateTimeFormat is the expensive half of the offset lookup, and
     the scrub asks for the same zone every frame, so the formatters are kept. */
  var offsetFmt = new Map();

  function zoneOffset(date, zone) {
    try {
      var f = offsetFmt.get(zone);
      if (!f) {
        f = new Intl.DateTimeFormat('en-GB', {
          timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
        });
        offsetFmt.set(zone, f);
      }
      var p = {};
      f.formatToParts(date).forEach(function (q) { p[q.type] = q.value; });
      var asUTC = Date.UTC(+p.year, +p.month - 1, +p.day,
        +p.hour, +p.minute, +p.second);
      return Math.round((asUTC - date.getTime()) / 60000);
    } catch (e) {
      return null;
    }
  }

  /* Local mean time, the Sun's own clock: noon when the Sun crosses the
     meridian. Used when no named zone applies. */
  function lmt(date, lon) {
    var ms = date.getTime() + lon / 15 * 3600 * 1000;
    var d = new Date(ms);
    return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' +
      pad(d.getUTCSeconds()) + ' LMT';
  }

  // --------------------------------------------------------- obscuration

  /* Fraction of the Sun's disc hidden by the Moon, from the angular radii of
     the two discs and the angle between their centers. This is area overlap,
     not the more commonly quoted magnitude, which measures how far across the
     Sun's diameter the Moon has traveled. The two differ a lot: at 50 per
     cent magnitude only about 39 per cent of the light is gone. */
  function discOverlap(d, rs, rm) {
    if (d >= rs + rm) return 0;
    if (d <= rm - rs) return 1;                       // total
    if (d <= rs - rm) return (rm * rm) / (rs * rs);   // annular
    var a = (d * d + rs * rs - rm * rm) / (2 * d * rs);
    var b = (d * d + rm * rm - rs * rs) / (2 * d * rm);
    a = Math.max(-1, Math.min(1, a));
    b = Math.max(-1, Math.min(1, b));
    var t = (-d + rs + rm) * (d + rs - rm) * (d - rs + rm) * (d + rs + rm);
    var area = rs * rs * Math.acos(a) + rm * rm * Math.acos(b)
      - 0.5 * Math.sqrt(Math.max(0, t));
    return area / (Math.PI * rs * rs);
  }

  /* Sun and Moon in the Earth-fixed frame for one instant, so that a fixed
     grid of surface points can be reused across many time steps without
     converting each point every time. */
  function eclipseField(time) {
    var S = A.GeoVector(A.Body.Sun, time, true);
    var M = A.GeoMoon(time);
    var rot = A.Rotation_EQJ_EQD(time);
    var s = A.RotateVector(rot, S), m = A.RotateVector(rot, M);
    var g = A.SiderealTime(time) * 15 * DEG;
    var cg = Math.cos(g), sg = Math.sin(g);
    function toEcef(v) {
      var x = v.x * KM_AU, y = v.y * KM_AU, z = v.z * KM_AU;
      return [x * cg + y * sg, -x * sg + y * cg, z];
    }
    var sun = toEcef(s), moon = toEcef(m);
    var bb = EARTH_A * FLAT;

    return {
      sun: sun,
      moon: moon,
      obsc: function (px, py, pz) {
        var ux = sun[0] - px, uy = sun[1] - py, uz = sun[2] - pz;
        var um = Math.hypot(ux, uy, uz);
        var nx = px / (EARTH_A * EARTH_A), ny = py / (EARTH_A * EARTH_A), nz = pz / (bb * bb);
        var nm = Math.hypot(nx, ny, nz);
        if ((ux * nx + uy * ny + uz * nz) / (nm * um) <= 0) return 0;
        var vx = moon[0] - px, vy = moon[1] - py, vz = moon[2] - pz;
        var vm = Math.hypot(vx, vy, vz);
        var cosd = (ux * vx + uy * vy + uz * vz) / (um * vm);
        var d = Math.acos(Math.max(-1, Math.min(1, cosd)));
        return discOverlap(d, Math.asin(SUN_R / um), Math.asin(MOON_R / vm));
      }
    };
  }

  /* Geodetic surface point in the Earth-fixed frame, in km. */
  function surfacePoint(latDeg, lonDeg) {
    var lat = latDeg * DEG, lon = lonDeg * DEG;
    var e2 = 1 - FLAT * FLAT;
    var N = EARTH_A / Math.sqrt(1 - e2 * Math.sin(lat) * Math.sin(lat));
    var cl = Math.cos(lat);
    return [N * cl * Math.cos(lon), N * cl * Math.sin(lon),
            N * (1 - e2) * Math.sin(lat)];
  }

  // ------------------------------------------------------------ formatting

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  var fmt = {
    utc: function (date) {
      return date.getUTCFullYear() + '-' + pad(date.getUTCMonth() + 1) + '-' +
        pad(date.getUTCDate()) + ' ' + pad(date.getUTCHours()) + ':' +
        pad(date.getUTCMinutes()) + ':' + pad(date.getUTCSeconds()) + ' UT';
    },
    hm: function (date) {
      return pad(date.getUTCHours()) + ':' + pad(date.getUTCMinutes()) + ':' +
        pad(date.getUTCSeconds());
    },
    day: function (date) {
      return date.getUTCFullYear() + '-' + pad(date.getUTCMonth() + 1) + '-' +
        pad(date.getUTCDate());
    },
    /* Duration in seconds as m:ss, or h:mm:ss past an hour. */
    dur: function (sec) {
      sec = Math.round(sec);
      var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
      if (h > 0) return h + 'h ' + pad(m) + 'm ' + pad(s) + 's';
      if (m > 0) return m + 'm ' + pad(s) + 's';
      return s + 's';
    },
    latlon: function (lat, lon) {
      return Math.abs(lat).toFixed(2) + (lat >= 0 ? ' N' : ' S') + ', ' +
        Math.abs(lon).toFixed(2) + (lon >= 0 ? ' E' : ' W');
    }
  };

  global.Astro = {
    ready: ready,
    get land() { return land; },
    get cities() { return cities; },
    get countries() { return countries; },
    palette: palette,
    equirect: equirect,
    mercator: mercator,
    robinson: robinson,
    ortho: ortho,
    withRepeats: withRepeats,
    wrapLon: wrapLon,
    drawLand: drawLand,
    drawBorders: drawBorders,
    drawWater: drawWater,
    loadDetail: loadDetail,
    get detailReady() { return detail.loaded; },
    loadPlaces: loadPlaces,
    get placesReady() { return places.loaded; },
    bodyTint: bodyTint,
    dsoTint: dsoTint,
    bodyTints: BODY_TINT,
    dsoTints: DSO_TINT,
    shade: shade,
    apparentDiam: apparentDiam,
    markRadius: markRadius,
    phaseFactor: phaseFactor,
    ringOpening: ringOpening,
    drawBody: drawBody,
    drawDeepSky: drawDeepSky,
    drawTiles: drawTiles,
    drawTileCredit: drawTileCredit,
    tileThemes: TILE_THEMES,
    tileMaxZoom: tileMaxZoom,
    tileBakedLabels: function (theme) {
      return !!(TILE_THEMES[theme] || TILE_THEMES.plain).bakedLabels;
    },
    drawGraticule: drawGraticule,
    drawEquator: drawEquator,
    labelPlacer: labelPlacer,
    drawPlaceLabels: drawPlaceLabels,
    zoneAt: zoneAt,
    formatInZone: formatInZone,
    zoneOffset: zoneOffset,
    lmt: lmt,
    capPolygon: capPolygon,
    fillCap: fillCap,
    contour: contour,
    eclipseField: eclipseField,
    surfacePoint: surfacePoint,
    discOverlap: discOverlap,
    shadow: shadow,
    fmt: fmt,
    EARTH_A: EARTH_A,
    DEG: DEG,
    RAD: RAD
  };
})(window);
