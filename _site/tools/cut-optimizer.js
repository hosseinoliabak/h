/* Cut Optimizer page.
 *
 * Reads the stock and part rows, asks CutOptimizer (cut-optimizer-engine.js)
 * for a layout, and draws it in the preview, one sheet group at a time.
 * Every element is built with createElement, createElementNS, and
 * textContent; no reader text reaches an HTML sink. Lengths are kept in
 * millimeters and only converted for display, so switching units never
 * rounds a stored value.
 *
 * Downloads are made on the device. The SVG is rebuilt from the layout with
 * createElementNS and serialized with XMLSerializer, after reader text has
 * had XML-illegal characters replaced. The PNG rasterizes that same SVG
 * through a Blob URL onto a bounded canvas. CSV cells are guarded against
 * formula injection. A project file is checked by the same schema as local
 * storage before anything in it is used. File names are fixed ASCII.
 */
(function () {
  'use strict';

  var CO = window.CutOptimizer;
  var root = document.getElementById('cut-optimizer');
  if (!CO || !root) return;

  var STORAGE_KEY = 'cut-optimizer-v1';
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var IN = 25.4;
  var LIMITS = CO.LIMITS;

  /* Nominal sizes. Imperial entries are exact inches, metric entries exact
     millimeters; each preset keeps its own unit so no conversion rounds it. */
  var STOCK_PRESETS = {
    wood: [
      { group: 'North American sheet goods (inches)', items: [
        { name: 'Plywood 4 x 8 ft', w: 48, l: 96, unit: 'in', grain: true },
        { name: 'Plywood 4 x 10 ft', w: 48, l: 120, unit: 'in', grain: true },
        { name: 'Plywood 5 x 5 ft (Baltic birch)', w: 60, l: 60, unit: 'in', grain: true },
        { name: 'Half sheet 4 x 4 ft', w: 48, l: 48, unit: 'in', grain: true },
        { name: 'Project panel 2 x 4 ft', w: 24, l: 48, unit: 'in', grain: true },
        { name: 'MDF 4 x 8 ft', w: 48, l: 96, unit: 'in', grain: false },
        { name: 'MDF oversize 49 x 97 in', w: 49, l: 97, unit: 'in', grain: false },
        { name: 'OSB 4 x 8 ft', w: 48, l: 96, unit: 'in', grain: false },
        { name: 'Hardboard 4 x 8 ft', w: 48, l: 96, unit: 'in', grain: false }
      ] },
      { group: 'Metric sheet goods (millimeters)', items: [
        { name: 'Plywood 1220 x 2440', w: 1220, l: 2440, unit: 'mm', grain: true },
        { name: 'Plywood 1250 x 2500', w: 1250, l: 2500, unit: 'mm', grain: true },
        { name: 'Birch plywood 1525 x 1525', w: 1525, l: 1525, unit: 'mm', grain: true },
        { name: 'MDF 1220 x 2440', w: 1220, l: 2440, unit: 'mm', grain: false },
        { name: 'MDF 2070 x 2800', w: 2070, l: 2800, unit: 'mm', grain: false },
        { name: 'Particleboard or melamine 2070 x 2800', w: 2070, l: 2800, unit: 'mm', grain: false },
        { name: 'OSB 1250 x 2500', w: 1250, l: 2500, unit: 'mm', grain: false }
      ] }
    ],
    paper: [
      { group: 'North American (inches)', items: [
        { name: 'Letter (ANSI A)', w: 8.5, l: 11, unit: 'in' },
        { name: 'Legal', w: 8.5, l: 14, unit: 'in' },
        { name: 'Tabloid or Ledger (ANSI B)', w: 11, l: 17, unit: 'in' },
        { name: 'ANSI C', w: 17, l: 22, unit: 'in' },
        { name: 'ANSI D', w: 22, l: 34, unit: 'in' },
        { name: 'ANSI E', w: 34, l: 44, unit: 'in' },
        { name: 'ARCH A', w: 9, l: 12, unit: 'in' },
        { name: 'ARCH B', w: 12, l: 18, unit: 'in' },
        { name: 'ARCH C', w: 18, l: 24, unit: 'in' },
        { name: 'ARCH D', w: 24, l: 36, unit: 'in' },
        { name: 'ARCH E', w: 36, l: 48, unit: 'in' },
        { name: 'Press sheet 12 x 18 in', w: 12, l: 18, unit: 'in' },
        { name: 'Press sheet 13 x 19 in', w: 13, l: 19, unit: 'in' },
        { name: 'Press sheet 19 x 25 in', w: 19, l: 25, unit: 'in' },
        { name: 'Press sheet 23 x 35 in', w: 23, l: 35, unit: 'in' },
        { name: 'Press sheet 25 x 38 in', w: 25, l: 38, unit: 'in' }
      ] },
      { group: 'ISO 216 and press sheets (millimeters)', items: [
        { name: 'A6', w: 105, l: 148, unit: 'mm' },
        { name: 'A5', w: 148, l: 210, unit: 'mm' },
        { name: 'A4', w: 210, l: 297, unit: 'mm' },
        { name: 'A3', w: 297, l: 420, unit: 'mm' },
        { name: 'A2', w: 420, l: 594, unit: 'mm' },
        { name: 'A1', w: 594, l: 841, unit: 'mm' },
        { name: 'A0', w: 841, l: 1189, unit: 'mm' },
        { name: 'B3', w: 353, l: 500, unit: 'mm' },
        { name: 'B2', w: 500, l: 707, unit: 'mm' },
        { name: 'B1', w: 707, l: 1000, unit: 'mm' },
        { name: 'SRA3', w: 320, l: 450, unit: 'mm' },
        { name: 'SRA2', w: 450, l: 640, unit: 'mm' },
        { name: 'SRA1', w: 640, l: 900, unit: 'mm' },
        { name: 'SRA0', w: 900, l: 1280, unit: 'mm' },
        { name: 'Press sheet 70 x 100 cm', w: 700, l: 1000, unit: 'mm' }
      ] }
    ]
  };

  var PART_PRESETS = [
    { group: 'Inches', items: [
      { name: 'Business card', w: 2, l: 3.5, unit: 'in' },
      { name: 'Index card', w: 3, l: 5, unit: 'in' },
      { name: 'Postcard', w: 4, l: 6, unit: 'in' },
      { name: 'Photo 5 x 7', w: 5, l: 7, unit: 'in' },
      { name: 'Half letter', w: 5.5, l: 8.5, unit: 'in' },
      { name: 'Letter', w: 8.5, l: 11, unit: 'in' }
    ] },
    { group: 'Millimeters', items: [
      { name: 'Business card', w: 55, l: 85, unit: 'mm' },
      { name: 'Business card (ISO 7810)', w: 53.98, l: 85.6, unit: 'mm' },
      { name: 'A7', w: 74, l: 105, unit: 'mm' },
      { name: 'A6 postcard', w: 105, l: 148, unit: 'mm' },
      { name: 'DL', w: 99, l: 210, unit: 'mm' },
      { name: 'A5', w: 148, l: 210, unit: 'mm' },
      { name: 'A4', w: 210, l: 297, unit: 'mm' }
    ] }
  ];

  var KERF_PRESETS = {
    wood: [
      { name: 'Thin-kerf table saw blade, 3/32 in', mm: 3 / 32 * IN },
      { name: 'Full-kerf table saw blade, 1/8 in', mm: 1 / 8 * IN },
      { name: 'Track saw, about 2.2 mm', mm: 2.2 },
      { name: 'Panel or beam saw, about 4.4 mm', mm: 4.4 },
      { name: 'CNC router, 1/4 in bit', mm: 1 / 4 * IN },
      { name: 'CNC router, 6 mm bit', mm: 6 },
      { name: 'No kerf', mm: 0 }
    ],
    paper: [
      { name: 'Guillotine or rotary trimmer, none', mm: 0 },
      { name: 'Laser, about 0.2 mm', mm: 0.2 },
      { name: 'Double cut between items, 1/8 in', mm: 1 / 8 * IN },
      { name: 'Double cut between items, 3 mm', mm: 3 }
    ]
  };

  /* Meaning colors for part types. Light fills with dark text read in both
     color modes, so they are fixed rather than themed. */
  var PALETTE = ['#8ecae6', '#ffc94d', '#9ccc7a', '#f4a3a8', '#cdb4db', '#76c7c0', '#f8a75e', '#a3c4f3', '#e9c46a', '#b5e48c', '#ffadad', '#bdb2ff'];

  function examples(mode, unit) {
    var imperial = unit === 'in';
    function L(v) { return imperial ? v * IN : v; }
    if (mode === 'paper') {
      return imperial ? {
        kerf: 0, trim: L(0.25),
        stocks: [{ name: 'Press sheet 12 x 18 in', width: L(12), length: L(18), quantity: null, grain: false }],
        parts: [
          { label: 'Business card', width: L(2), length: L(3.5), quantity: 100, grain: false },
          { label: 'Postcard', width: L(4), length: L(6), quantity: 6, grain: false }
        ]
      } : {
        kerf: 0, trim: 5,
        stocks: [{ name: 'SRA3', width: 320, length: 450, quantity: null, grain: false }],
        parts: [
          { label: 'Business card', width: 55, length: 85, quantity: 100, grain: false },
          { label: 'A6 postcard', width: 105, length: 148, quantity: 6, grain: false }
        ]
      };
    }
    return imperial ? {
      kerf: 1 / 8 * IN, trim: L(0.25),
      stocks: [{ name: 'Plywood 4 x 8 ft', width: L(48), length: L(96), quantity: null, grain: true }],
      parts: [
        { label: 'Side', width: L(15.5), length: L(30), quantity: 2, grain: true },
        { label: 'Top and bottom', width: L(15.5), length: L(34.5), quantity: 2, grain: true },
        { label: 'Shelf', width: L(11.25), length: L(33.75), quantity: 2, grain: true },
        { label: 'Door', width: L(17.375), length: L(29.75), quantity: 2, grain: true }
      ]
    } : {
      kerf: 3.2, trim: 10,
      stocks: [{ name: 'Plywood 1220 x 2440', width: 1220, length: 2440, quantity: null, grain: true }],
      parts: [
        { label: 'Side', width: 390, length: 760, quantity: 2, grain: true },
        { label: 'Top and bottom', width: 390, length: 864, quantity: 2, grain: true },
        { label: 'Shelf', width: 280, length: 846, quantity: 2, grain: true },
        { label: 'Door', width: 438, length: 754, quantity: 2, grain: true }
      ]
    };
  }

  /* ---------- state ---------- */

  /* Downloads keep their object URL alive for the project default of 30
     seconds, because revoking it at once can race the browser download. */
  var DOWNLOAD_URL_LIFETIME_MS = 30000;
  /* A project file holds at most 50 sheet rows and 200 part rows of short
     text, well under 64 KB. 256 KB is a stricter ceiling than the site's
     7 MB upload limit and leaves room for formatting. */
  var PROJECT_MAX_BYTES = 256 * 1024;
  /* The PNG is a picture for sharing, not a scale drawing. Its long side is
     capped well inside the site raster limits (8,192 px edge, 40 MP). */
  var PNG_LONG_SIDE = 2400;

  /* The script runs before the step panels are parsed (see the .qmd), so
     the elements are looked up in init(), once the document is complete. */
  var el = null;
  function collectElements() {
    var ids = {
      unit: 'co-unit', precision: 'co-precision', stocks: 'co-stocks', parts: 'co-parts',
      stockPreset: 'co-stock-preset', partPreset: 'co-part-preset', addStock: 'co-add-stock', addPart: 'co-add-part',
      kerf: 'co-kerf', kerfPreset: 'co-kerf-preset', trim: 'co-trim', showCuts: 'co-show-cuts',
      example: 'co-example', clear: 'co-clear', status: 'co-status', summary: 'co-summary', unplaced: 'co-unplaced',
      sheets: 'co-sheets', prev: 'co-prev', next: 'co-next', pagerLabel: 'co-pager-label', cutList: 'co-cut-list',
      printView: 'co-print-view', downloadSvg: 'co-download-svg',
      svgSheet: 'co-svg-sheet', svgAll: 'co-svg-all', png: 'co-png', csvParts: 'co-csv-parts', csvCuts: 'co-csv-cuts',
      saveProject: 'co-save-project', openProject: 'co-open-project', projectFile: 'co-project-file',
      sumMaterial: 'co-sum-material', sumStock: 'co-sum-stock', sumParts: 'co-sum-parts', sumSaw: 'co-sum-saw', sumCuts: 'co-sum-cuts'
    };
    var out = {};
    Object.keys(ids).forEach(function (k) { out[k] = document.getElementById(ids[k]); });
    out.printButtons = Array.prototype.slice.call(root.querySelectorAll('[data-print]'));
    return out;
  }

  function defaultUnit() {
    var lang = (navigator.language || '').toLowerCase();
    return /^en-(us|lr)$/.test(lang) ? 'in' : 'mm';
  }

  var state = null;
  var lastResult = null;
  var lastProblem = null;
  var currentGroup = 0;

  function freshState(mode, unit) {
    var ex = examples(mode, unit);
    return {
      mode: mode,
      unit: unit,
      precision: '16',
      showCuts: true,
      kerf: ex.kerf,
      trim: ex.trim,
      stocks: ex.stocks.map(function (s) { return Object.assign({}, s); }),
      parts: ex.parts.map(function (p) { return Object.assign({}, p); })
    };
  }

  /* ---------- storage and project files ---------- */

  function isText(v) { return typeof v === 'string' && v.length <= LIMITS.maxText; }
  function isMm(v, max) { return v === null || (typeof v === 'number' && isFinite(v) && v >= 0 && v <= max); }
  function isQty(v, allowNull) { return (allowNull && v === null) || (Number.isInteger(v) && v >= 1 && v <= LIMITS.maxQuantity); }

  /* The one schema check for anything read back, from local storage or
     from a project file a reader opens. */
  function validStored(s) {
    if (!s || typeof s !== 'object' || Array.isArray(s) || s.v !== 1) return false;
    if (s.app !== undefined && s.app !== 'cut-optimizer') return false;
    if (s.mode !== 'wood' && s.mode !== 'paper') return false;
    if (['mm', 'cm', 'in'].indexOf(s.unit) === -1) return false;
    if (['8', '16', '32', 'decimal'].indexOf(s.precision) === -1) return false;
    if (typeof s.showCuts !== 'boolean') return false;
    if (!isMm(s.kerf, LIMITS.maxKerfMm) || !isMm(s.trim, LIMITS.maxTrimMm)) return false;
    if (!Array.isArray(s.stocks) || s.stocks.length > LIMITS.maxStockRows) return false;
    if (!Array.isArray(s.parts) || s.parts.length > LIMITS.maxPartRows) return false;
    var okStocks = s.stocks.every(function (r) {
      return r && typeof r === 'object' && isText(r.name) && isMm(r.width, LIMITS.maxLengthMm) && isMm(r.length, LIMITS.maxLengthMm) && isQty(r.quantity, true) && typeof r.grain === 'boolean';
    });
    var okParts = s.parts.every(function (r) {
      return r && typeof r === 'object' && isText(r.label) && isMm(r.width, LIMITS.maxLengthMm) && isMm(r.length, LIMITS.maxLengthMm) && isQty(r.quantity, false) && typeof r.grain === 'boolean';
    });
    return okStocks && okParts;
  }

  function pick(row, keys) {
    var out = {};
    keys.forEach(function (k) { out[k] = row[k]; });
    return out;
  }

  /* Copies only the known fields of a checked object. */
  function fromStored(s) {
    return {
      mode: s.mode, unit: s.unit, precision: s.precision, showCuts: s.showCuts, kerf: s.kerf, trim: s.trim,
      stocks: s.stocks.map(function (r) { return pick(r, ['name', 'width', 'length', 'quantity', 'grain']); }),
      parts: s.parts.map(function (r) { return pick(r, ['label', 'width', 'length', 'quantity', 'grain']); })
    };
  }

  function toStored() {
    return Object.assign({ app: 'cut-optimizer', v: 1 }, fromStored(Object.assign({ v: 1 }, state)));
  }

  function load() {
    try {
      var text = window.localStorage.getItem(STORAGE_KEY);
      if (!text || text.length > PROJECT_MAX_BYTES) return null;
      var s = JSON.parse(text);
      return validStored(s) ? fromStored(s) : null;
    } catch (e) {
      return null;
    }
  }

  var saveTimer = 0;
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(toStored()));
      } catch (e) {
        /* Storage blocked or full. The page keeps working without it. */
      }
    }, 400);
  }

  function forget() {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* nothing to remove */ }
  }

  /* ---------- formatting ---------- */

  function fmt(mm) {
    return CO.formatLength(mm, state.unit, state.precision);
  }

  /* A length for reading, with the unit, and an approximate mark when the
     shown value is rounded. */
  function show(mm, withExact) {
    var f = fmt(mm);
    var text = (f.approx ? '≈ ' : '') + f.text + ' ' + state.unit;
    if (withExact && f.approx && state.unit === 'in') text += ' (' + CO.formatLength(mm, 'in', 'decimal').text + ')';
    return text;
  }

  function inputText(mm) {
    if (mm === null || mm === undefined || !isFinite(mm)) return '';
    if (state.unit === 'in') {
      var frac = CO.formatLength(mm, 'in', '32');
      if (!frac.approx) return frac.text;
      return CO.formatLength(mm, 'in', 'decimal').text;
    }
    return CO.formatLength(mm, state.unit).text;
  }

  /* A plain decimal in the chosen unit, for spreadsheets. */
  function decimal(mm) {
    var digits = state.unit === 'mm' ? 2 : state.unit === 'cm' ? 3 : 4;
    var v = mm / CO.MM_PER[state.unit];
    return String(Number(v.toFixed(digits)));
  }

  function areaText(mm2) {
    if (state.unit === 'in') return (mm2 / (304.8 * 304.8)).toFixed(1) + ' ft²';
    return (mm2 / 1e6).toFixed(2) + ' m²';
  }

  function longText(mm) {
    if (state.unit === 'in') return (mm / 304.8).toFixed(1) + ' ft';
    return (mm / 1000).toFixed(1) + ' m';
  }

  /* Replaces characters XML 1.0 cannot hold (C0 controls other than tab,
     line feed, and carriage return, U+FFFE, U+FFFF, and lone surrogates)
     with U+FFFD, for text that goes into an exported file. */
  function cleanText(s) {
    return String(s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '�')
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '�')
      .replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1�');
  }

  /* ---------- building rows ---------- */

  function make(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function textInput(cls, value, label, maxLength) {
    var input = make('input', 'tool-input ' + cls);
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.maxLength = maxLength || LIMITS.maxInputChars;
    input.value = value;
    input.setAttribute('aria-label', label);
    return input;
  }

  function buildRow(kind, row, index) {
    var noun = kind === 'stock' ? 'Sheet' : 'Part';
    var line = make('div', 'co-row');
    line.dataset.index = String(index);
    var nameKey = kind === 'stock' ? 'name' : 'label';
    var name = textInput('co-name', row[nameKey], noun + ' ' + (index + 1) + ' name', LIMITS.maxText);
    name.dataset.field = nameKey;
    var width = textInput('co-length', inputText(row.width), noun + ' ' + (index + 1) + ' width');
    width.dataset.field = 'width';
    var length = textInput('co-length', inputText(row.length), noun + ' ' + (index + 1) + ' length');
    length.dataset.field = 'length';
    var qty = textInput('co-qty', row.quantity === null ? '' : String(row.quantity), noun + ' ' + (index + 1) + ' quantity', 3);
    qty.dataset.field = 'quantity';
    qty.inputMode = 'numeric';
    if (kind === 'stock') qty.placeholder = 'any';
    var grainWrap = make('label', 'co-grain');
    var grain = make('input');
    grain.type = 'checkbox';
    grain.checked = !!row.grain;
    grain.dataset.field = 'grain';
    grain.setAttribute('aria-label', noun + ' ' + (index + 1) + ' has grain');
    grainWrap.appendChild(grain);
    grainWrap.appendChild(make('span', 'co-grain-text', 'Grain'));
    var remove = make('button', 'tool-button co-remove', '×');
    remove.type = 'button';
    remove.dataset.action = 'remove';
    remove.setAttribute('aria-label', 'Remove ' + noun.toLowerCase() + ' ' + (index + 1));
    name.placeholder = kind === 'stock' ? 'Sheet name' : 'Part label';
    width.placeholder = 'Width';
    length.placeholder = 'Length';
    if (kind === 'part') name.style.borderLeftColor = PALETTE[index % PALETTE.length];
    var times = make('span', 'co-times', '\u00d7');
    times.setAttribute('aria-hidden', 'true');
    [name, width, times, length, qty, grainWrap, remove].forEach(function (n) { line.appendChild(n); });
    return line;
  }

  function renderRows() {
    el.stocks.replaceChildren.apply(el.stocks, state.stocks.map(function (r, i) { return buildRow('stock', r, i); }));
    el.parts.replaceChildren.apply(el.parts, state.parts.map(function (r, i) { return buildRow('part', r, i); }));
    root.style.setProperty('--co-stock-rows', String(state.stocks.length));
    root.style.setProperty('--co-part-rows', String(state.parts.length));
    el.addStock.disabled = state.stocks.length >= LIMITS.maxStockRows;
    el.addPart.disabled = state.parts.length >= LIMITS.maxPartRows;
    el.stockPreset.disabled = el.addStock.disabled;
    el.partPreset.disabled = el.addPart.disabled;
    renderSummaries();
  }

  function renderSettings() {
    root.dataset.mode = state.mode;
    root.querySelectorAll('.co-segment-button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.mode === state.mode ? 'true' : 'false');
    });
    el.unit.value = state.unit;
    el.precision.value = state.precision;
    el.precision.disabled = state.unit !== 'in';
    el.showCuts.checked = state.showCuts;
    el.kerf.value = inputText(state.kerf);
    el.trim.value = inputText(state.trim);
    el.kerf.removeAttribute('aria-invalid');
    el.trim.removeAttribute('aria-invalid');
    fillPresetSelect(el.stockPreset, STOCK_PRESETS[state.mode]);
    fillPresetSelect(el.partPreset, PART_PRESETS);
    /* Hidden but still holding its space, so the row below never moves. */
    el.partPreset.classList.toggle('co-hold', state.mode !== 'paper');
    el.partPreset.setAttribute('aria-hidden', state.mode !== 'paper' ? 'true' : 'false');
    el.partPreset.tabIndex = state.mode === 'paper' ? 0 : -1;
    var kerfOptions = [make('option', '', 'Typical values')];
    kerfOptions[0].value = '';
    KERF_PRESETS[state.mode].forEach(function (k, i) {
      var o = make('option', '', k.name);
      o.value = String(i);
      kerfOptions.push(o);
    });
    el.kerfPreset.replaceChildren.apply(el.kerfPreset, kerfOptions);
    renderSummaries();
  }

  function renderSummaries() {
    if (!el) return;
    var pieces = state.parts.reduce(function (a, p) { return a + (p.quantity || 0); }, 0);
    el.sumMaterial.textContent = (state.mode === 'paper' ? 'Paper' : 'Wood panels') + ', ' + state.unit;
    el.sumStock.textContent = state.stocks.length + (state.stocks.length === 1 ? ' size' : ' sizes');
    el.sumParts.textContent = pieces + (pieces === 1 ? ' part' : ' parts');
    el.sumSaw.textContent = 'Kerf ' + fmt(state.kerf).text + ', trim ' + fmt(state.trim).text + ' ' + state.unit;
  }

  function fillPresetSelect(select, groups) {
    var first = make('option', '', 'Add a standard size');
    first.value = '';
    var nodes = [first];
    groups.forEach(function (g, gi) {
      var og = make('optgroup');
      og.label = g.group;
      g.items.forEach(function (it, ii) {
        var o = make('option', '', it.name);
        o.value = gi + ':' + ii;
        og.appendChild(o);
      });
      nodes.push(og);
    });
    select.replaceChildren.apply(select, nodes);
  }

  function presetAt(groups, value) {
    var m = /^(\d+):(\d+)$/.exec(value);
    if (!m) return null;
    var g = groups[Number(m[1])];
    return g ? g.items[Number(m[2])] || null : null;
  }

  /* ---------- reading input ---------- */

  var rowErrors = { stock: {}, part: {} };
  var settingErrors = [];

  function readLength(input, required) {
    var text = input.value;
    if (!text.trim()) {
      if (required) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
      return { ok: !required, mm: null };
    }
    var r = CO.parseLength(text, state.unit);
    if (r.ok) input.removeAttribute('aria-invalid');
    else input.setAttribute('aria-invalid', 'true');
    return r;
  }

  function onRowInput(kind, target) {
    var line = target.closest('.co-row');
    if (!line) return;
    var index = Number(line.dataset.index);
    var list = kind === 'stock' ? state.stocks : state.parts;
    var row = list[index];
    if (!row) return;
    var field = target.dataset.field;
    var errs = rowErrors[kind][index] || (rowErrors[kind][index] = {});
    if (field === 'name' || field === 'label') {
      row[field] = target.value.slice(0, LIMITS.maxText);
    } else if (field === 'grain') {
      row.grain = target.checked;
    } else if (field === 'quantity') {
      var t = target.value.trim();
      if (!t && kind === 'stock') { row.quantity = null; delete errs.quantity; target.removeAttribute('aria-invalid'); }
      else if (/^\d{1,3}$/.test(t) && Number(t) >= 1) { row.quantity = Number(t); delete errs.quantity; target.removeAttribute('aria-invalid'); }
      else { errs.quantity = true; target.setAttribute('aria-invalid', 'true'); }
    } else if (field === 'width' || field === 'length') {
      var r = readLength(target, true);
      if (r.ok && r.mm > 0 && r.mm <= LIMITS.maxLengthMm) { row[field] = r.mm; delete errs[field]; }
      else { errs[field] = true; target.setAttribute('aria-invalid', 'true'); }
    }
    renderSummaries();
    changed();
  }

  function onSettingInput(which) {
    var input = which === 'kerf' ? el.kerf : el.trim;
    var max = which === 'kerf' ? LIMITS.maxKerfMm : LIMITS.maxTrimMm;
    var r = readLength(input, false);
    var mm = r.ok ? (r.mm === null ? 0 : r.mm) : NaN;
    var i = settingErrors.indexOf(which);
    if (r.ok && mm <= max) {
      state[which] = mm;
      if (i !== -1) settingErrors.splice(i, 1);
    } else {
      input.setAttribute('aria-invalid', 'true');
      if (i === -1) settingErrors.push(which);
    }
    renderSummaries();
    changed();
  }

  /* ---------- solving ---------- */

  var solveTimer = 0;
  function changed() {
    importRequest += 1;
    saveSoon();
    clearTimeout(solveTimer);
    solveTimer = setTimeout(run, 200);
  }

  function rowProblems() {
    var msgs = [];
    settingErrors.forEach(function (w) {
      var max = w === 'kerf' ? LIMITS.maxKerfMm : LIMITS.maxTrimMm;
      msgs.push((w === 'kerf' ? 'Kerf' : 'Edge trim') + ' is not a length from 0 to ' + max + ' mm.');
    });
    ['stock', 'part'].forEach(function (kind) {
      Object.keys(rowErrors[kind]).forEach(function (i) {
        var fields = Object.keys(rowErrors[kind][i]);
        if (fields.length) msgs.push((kind === 'stock' ? 'Sheet ' : 'Part ') + (Number(i) + 1) + ' has an unreadable ' + fields.join(' and ') + '.');
      });
    });
    return msgs;
  }

  function complete(r) {
    return typeof r.width === 'number' && typeof r.length === 'number';
  }

  /* Rows still missing a width or a length (a row just added) are left out
     of the layout rather than stopping it. `row` keeps each entry's position
     in the lists so colors and names follow the row on screen. */
  function buildProblem() {
    var stocks = [];
    var parts = [];
    state.stocks.forEach(function (s, i) {
      if (complete(s)) stocks.push({ name: s.name, width: s.width, length: s.length, quantity: s.quantity, grain: s.grain, row: i });
    });
    state.parts.forEach(function (p, i) {
      if (complete(p)) parts.push({ label: p.label, width: p.width, length: p.length, quantity: p.quantity, grain: p.grain, row: i });
    });
    return { kerf: state.kerf, trim: state.trim, stocks: stocks, parts: parts };
  }

  function incompleteNote() {
    var n = state.stocks.filter(function (r) { return !complete(r); }).length + state.parts.filter(function (r) { return !complete(r); }).length;
    return n ? ' ' + n + (n === 1 ? ' row is' : ' rows are') + ' still missing a width or a length and ' + (n === 1 ? 'is' : 'are') + ' left out.' : '';
  }

  function setStatus(text, isError) {
    el.status.textContent = text;
    el.status.classList.toggle('co-status-error', !!isError);
  }

  function run() {
    var problems = rowProblems();
    if (problems.length) {
      setStatus(problems.join(' ') + ' The layout shown is from the last readable input.', true);
      return;
    }
    var problem = buildProblem();
    var errors = CO.validateProblem(problem);
    if (errors.length) {
      setStatus(errors.join(' ') + incompleteNote(), true);
      clearResults();
      return;
    }
    var result;
    try {
      result = CO.solve(problem);
    } catch (e) {
      setStatus('The layout could not be worked out for this input.', true);
      clearResults();
      return;
    }
    if (!result.ok) {
      setStatus(result.errors.join(' '), true);
      clearResults();
      return;
    }
    generation += 1;
    lastResult = result;
    lastProblem = problem;
    if (currentGroup >= result.groups.length) currentGroup = result.groups.length - 1;
    if (currentGroup < 0) currentGroup = 0;
    var s = result.stats;
    var msg = 'Laid out ' + s.placed + ' of ' + s.pieces + ' parts on ' + s.sheets + (s.sheets === 1 ? ' sheet' : ' sheets') + ', after trying ' + s.runs + ' layouts.';
    if (s.placed < s.pieces) msg += ' Some parts did not fit, as listed below.';
    msg += incompleteNote();
    setStatus(msg, s.placed < s.pieces);
    renderResults();
  }

  function clearResults() {
    generation += 1;
    lastResult = null;
    lastProblem = null;
    currentGroup = 0;
    el.summary.querySelectorAll('[data-stat]').forEach(function (n) { n.textContent = '–'; });
    el.unplaced.hidden = true;
    el.unplaced.replaceChildren();
    el.sheets.replaceChildren();
    el.cutList.replaceChildren();
    el.pagerLabel.textContent = 'No layout';
    el.sumCuts.textContent = '–';
    el.prev.disabled = true;
    el.next.disabled = true;
    setExportsEnabled(false);
  }

  function setExportsEnabled(on) {
    [el.downloadSvg, el.svgSheet, el.svgAll, el.png, el.csvParts, el.csvCuts].concat(el.printButtons).forEach(function (b) { b.disabled = !on; });
  }

  /* ---------- drawing ---------- */

  /* Numbers are written to four decimals, which keeps floating point noise
     such as 721.5999999999997 out of the drawings and the SVG files. */
  function svg(tag, attrs) {
    var n = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        n.setAttribute(k, typeof v === 'number' ? String(Number(v.toFixed(4))) : String(v));
      });
    }
    return n;
  }

  function stockName(i) {
    var s = lastProblem.stocks[i];
    return s.name && s.name.trim() ? s.name.trim() : 'Sheet ' + (s.row + 1);
  }

  function partName(i) {
    var p = lastProblem.parts[i];
    return p.label && p.label.trim() ? p.label.trim() : 'Part ' + (p.row + 1);
  }

  function partColor(i) {
    return PALETTE[lastProblem.parts[i].row % PALETTE.length];
  }

  function groupTitle(group) {
    var count = group.sheets.length;
    var first = group.sheets[0] + 1;
    return count > 1 ? 'Sheets ' + first + ' to ' + (group.sheets[count - 1] + 1) + ' (' + count + ' identical)' : 'Sheet ' + first;
  }

  function groupDetail(sh) {
    return stockName(sh.stock) + ', ' + show(sh.width) + ' by ' + show(sh.length) + ', ' + (sh.partArea / sh.area * 100).toFixed(1) + '% used';
  }

  function renderResults() {
    var r = lastResult;
    var s = r.stats;
    var values = {
      sheets: String(s.sheets),
      yield: (s.yield * 100).toFixed(1) + '%',
      waste: areaText(s.stockArea - s.partArea),
      cuts: String(s.cuts),
      cutLength: longText(s.cutLength),
      placed: s.placed + ' of ' + s.pieces
    };
    el.summary.querySelectorAll('[data-stat]').forEach(function (n) { n.textContent = values[n.dataset.stat]; });

    if (r.unplaced.length) {
      var list = make('ul', 'co-unplaced-list');
      r.unplaced.forEach(function (u) {
        var part = lastProblem.parts[u.part];
        var why = u.reason === 'size' ? 'larger than every stock sheet after trim' + (part.grain ? ', with the grain kept' : '') : 'no stock sheets left; raise a sheet quantity or leave it empty for unlimited';
        list.appendChild(make('li', '', u.count + ' × ' + partName(u.part) + ' (' + show(part.width) + ' by ' + show(part.length) + '), ' + why + '.'));
      });
      el.unplaced.replaceChildren(make('strong', '', 'Not placed'), list);
      el.unplaced.hidden = false;
    } else {
      el.unplaced.hidden = true;
      el.unplaced.replaceChildren();
    }
    setExportsEnabled(true);
    renderPreview();
  }

  /* Draws the current sheet group into the preview, sized to fit both the
     width and the height of the preview area. */
  function renderPreview() {
    if (!lastResult) return;
    var groups = lastResult.groups;
    var group = groups[currentGroup];
    var sh = lastResult.sheets[group.sheets[0]];
    var box = el.sheets.getBoundingClientRect();
    var cw = Math.max(200, box.width - 8);
    var ch = Math.max(160, box.height - 8);
    var scale = Math.min(cw / sh.length, ch / sh.width);
    var drawing = drawSheet(sh, 'p' + currentGroup, scale, state.showCuts);
    drawing.setAttribute('aria-label', groupTitle(group) + ', ' + groupDetail(sh) + ', ' + sh.placements.length + ' parts');
    el.sheets.replaceChildren(drawing);
    el.pagerLabel.textContent = groupTitle(group) + ' of ' + lastResult.sheets.length + ' · ' + groupDetail(sh);
    el.prev.disabled = currentGroup === 0;
    el.next.disabled = currentGroup >= groups.length - 1;
    el.sumCuts.textContent = sh.cuts.length + (sh.cuts.length === 1 ? ' cut' : ' cuts') + ', ' + groupTitle(group).toLowerCase();
    el.cutList.replaceChildren(cutTable(sh, true));
  }

  /* One sheet as an inline SVG for the page (preview and print). `scale` is
     screen pixels per millimeter, used to size text and marks. */
  function drawSheet(sh, key, scale, numbers) {
    var L = sh.length;
    var W = sh.width;
    var fs = 12 / scale;
    var out = svg('svg', { viewBox: '0 0 ' + L + ' ' + W, class: 'co-svg', role: 'img', width: Math.round(L * scale), height: Math.round(W * scale) });
    var defs = svg('defs');
    var hatchId = 'co-hatch-' + key;
    var step = 7 / scale;
    var pattern = svg('pattern', { id: hatchId, patternUnits: 'userSpaceOnUse', width: step, height: step, patternTransform: 'rotate(45)' });
    pattern.appendChild(svg('line', { x1: 0, y1: 0, x2: 0, y2: step, class: 'co-hatch-line', 'vector-effect': 'non-scaling-stroke' }));
    defs.appendChild(pattern);
    out.appendChild(defs);
    out.appendChild(svg('rect', { x: 0, y: 0, width: L, height: W, class: 'co-sheet-bg', 'vector-effect': 'non-scaling-stroke' }));
    var trim = lastProblem.trim;
    if (trim > 0) {
      out.appendChild(svg('path', {
        d: 'M0 0H' + L + 'V' + W + 'H0Z M' + trim + ' ' + trim + 'V' + (W - trim) + 'H' + (L - trim) + 'V' + trim + 'Z',
        fill: 'url(#' + hatchId + ')', 'fill-rule': 'evenodd', class: 'co-trim'
      }));
    }
    var bigEnough = Math.min(L, W) * 0.04;
    sh.offcuts.forEach(function (o) {
      out.appendChild(svg('rect', { x: o.x, y: o.y, width: o.w, height: o.h, fill: 'url(#' + hatchId + ')', class: 'co-offcut' }));
      if (o.w > bigEnough && o.h > bigEnough) label(out, o.x, o.y, o.w, o.h, ['Offcut', fmt(o.h).text + ' × ' + fmt(o.w).text], fs * 0.9, { class: 'co-offcut-text' });
    });
    sh.placements.forEach(function (p) {
      var g = svg('g', { class: 'co-part' });
      var tip = svg('title');
      tip.textContent = partName(p.part) + ', ' + show(p.width) + ' by ' + show(p.length) + (p.rotated ? ', turned' : '');
      g.appendChild(tip);
      g.appendChild(svg('rect', { x: p.x, y: p.y, width: p.w, height: p.h, fill: partColor(p.part), class: 'co-part-rect', 'vector-effect': 'non-scaling-stroke' }));
      label(g, p.x, p.y, p.w, p.h, [partName(p.part), fmt(p.width).text + ' × ' + fmt(p.length).text], fs, { class: 'co-part-text' });
      out.appendChild(g);
    });
    var k = lastProblem.kerf;
    sh.cuts.forEach(function (c, ci) {
      var mid = c.blade + k / 2;
      var line = c.axis === 'x'
        ? { x1: mid, y1: c.span[0], x2: mid, y2: c.span[1] }
        : { x1: c.span[0], y1: mid, x2: c.span[1], y2: mid };
      line.class = 'co-cut-line';
      line['vector-effect'] = 'non-scaling-stroke';
      line['data-cut'] = ci;
      out.appendChild(svg('line', line));
    });
    if (numbers) {
      sh.cuts.forEach(function (c, ci) {
        var mid = c.blade + k / 2;
        var along = (c.span[0] + c.span[1]) / 2;
        var r = 8 / scale;
        var cx = Math.min(Math.max(c.axis === 'x' ? mid : along, r), L - r);
        var cy = Math.min(Math.max(c.axis === 'x' ? along : mid, r), W - r);
        var g = svg('g', { class: 'co-cut-mark', 'data-cut': ci });
        g.appendChild(svg('circle', { cx: cx, cy: cy, r: r, class: 'co-cut-dot', 'vector-effect': 'non-scaling-stroke' }));
        var tx = svg('text', { x: cx, y: cy, 'font-size': fs * 0.8, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'co-cut-num' });
        tx.textContent = String(ci + 1);
        g.appendChild(tx);
        out.appendChild(g);
      });
    }
    return out;
  }

  /* Writes up to two lines of text in a box, turning them when the box is
     tall and narrow, and leaving them out when they would not fit. The
     estimate uses 0.6 em per character, which suits Sora and Helvetica. */
  function label(parent, x, y, w, h, lines, fs, attrs) {
    var pad = fs * 0.4;
    function widest(n) {
      var m = 0;
      for (var i = 0; i < n; i += 1) m = Math.max(m, lines[i].length * fs * 0.6);
      return m;
    }
    var tries = [{ n: 2, rot: false }, { n: 1, rot: false }, { n: 2, rot: true }, { n: 1, rot: true }];
    for (var t = 0; t < tries.length; t += 1) {
      var n = Math.min(tries[t].n, lines.length);
      var along = tries[t].rot ? h : w;
      var across = tries[t].rot ? w : h;
      if (widest(n) + 2 * pad <= along && n * fs * 1.25 + pad <= across) {
        var cx = x + w / 2;
        var cy = y + h / 2;
        var text = svg('text', Object.assign({ x: cx, y: cy, 'font-size': fs, 'text-anchor': 'middle' }, attrs || {}));
        if (tries[t].rot) text.setAttribute('transform', 'rotate(-90 ' + cx + ' ' + cy + ')');
        for (var i = 0; i < n; i += 1) {
          var span = svg('tspan', { x: cx, dy: i === 0 ? (-(n - 1) * 0.625 + 0.35) + 'em' : '1.25em' });
          if (i > 0) span.setAttribute('font-weight', '400');
          span.textContent = lines[i];
          text.appendChild(span);
        }
        parent.appendChild(text);
        return;
      }
    }
  }

  function cutKind(c) {
    return c.kind === 'trim' ? 'Trim ' + (c.axis === 'y' ? 'rip' : 'cross cut') : c.kind === 'rip' ? 'Rip' : 'Cross cut';
  }

  function cutTable(sh, interactive) {
    var table = make('table', 'co-cut-table');
    var thead = make('thead');
    var hr = make('tr');
    ['#', 'Cut', 'Fence', 'Length of cut'].forEach(function (h) { hr.appendChild(make('th', '', h)); });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = make('tbody');
    sh.cuts.forEach(function (c, i) {
      var tr = make('tr');
      tr.dataset.cut = String(i);
      if (interactive) tr.tabIndex = 0;
      tr.appendChild(make('td', '', String(i + 1)));
      tr.appendChild(make('td', '', cutKind(c)));
      tr.appendChild(make('td', '', show(c.fence, true)));
      tr.appendChild(make('td', '', show(Math.max(0, c.length))));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  function highlightCut(index) {
    el.sheets.querySelectorAll('.co-cut-hot').forEach(function (n) { n.classList.remove('co-cut-hot'); });
    if (index === null) return;
    el.sheets.querySelectorAll('[data-cut="' + index + '"]').forEach(function (n) { n.classList.add('co-cut-hot'); });
  }

  /* Every sheet group with its cut table, for printing or saving as PDF. */
  function buildPrintView() {
    if (!lastResult) { el.printView.replaceChildren(); return; }
    var nodes = [];
    var head = make('div', 'co-print-head');
    head.appendChild(make('h2', '', 'Cutting layout'));
    head.appendChild(make('p', '', lastResult.stats.sheets + (lastResult.stats.sheets === 1 ? ' sheet' : ' sheets') + ', ' + (lastResult.stats.yield * 100).toFixed(1) + '% of the material used, ' + lastResult.stats.cuts + ' cuts. Kerf ' + show(lastProblem.kerf) + ', edge trim ' + show(lastProblem.trim) + '.'));
    nodes.push(head);
    lastResult.groups.forEach(function (g, gi) {
      var sh = lastResult.sheets[g.sheets[0]];
      var page = make('section', 'co-print-sheet');
      page.appendChild(make('h3', '', groupTitle(g) + ' · ' + groupDetail(sh)));
      var drawing = drawSheet(sh, 'print' + gi, 1000 / sh.length, true);
      drawing.removeAttribute('width');
      drawing.removeAttribute('height');
      page.appendChild(drawing);
      page.appendChild(cutTable(sh, false));
      nodes.push(page);
    });
    el.printView.replaceChildren.apply(el.printView, nodes);
  }

  /* ---------- downloads ---------- */

  function stamp() {
    var d = new Date();
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate());
  }

  /* File names are fixed ASCII built here, never from reader text. */
  function fileName(suffix, ext) {
    return 'cut-layout-' + stamp() + (suffix ? '-' + suffix : '') + '.' + ext;
  }

  /* Owns one download URL. A successful click keeps it alive for the
     project default lifetime; a failure releases it at once and rethrows so
     the caller can report it. Cleanup is idempotent. */
  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var released = false;
    function release() {
      if (released) return;
      released = true;
      URL.revokeObjectURL(url);
    }
    var a = document.createElement('a');
    try {
      a.href = url;
      a.download = name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
    } catch (e) {
      release();
      throw e;
    } finally {
      a.remove();
    }
    setTimeout(release, DOWNLOAD_URL_LIFETIME_MS);
  }

  /* Bumped by anything that replaces the layout or the project (a new
     solve, Clear all, Restore example, opening a file, changing mode), so
     an export or file read that finishes late can tell it is stale. */
  var generation = 0;

  /* Each project-file read gets its own number. Opening another file, any
     edit, and every reset take a new one, so only the latest import, and
     only if nothing was changed while it was read, is applied. */
  var importRequest = 0;

  /* One sheet group as a standalone SVG element at true scale. Colors are
     attributes, not classes, so the file looks the same anywhere. */
  function exportSheet(parent, sh, offsetY, caption) {
    var L = sh.length;
    var W = sh.width;
    var fs = Math.max(4, Math.min(L, W) / 45);
    var g = svg('g', { transform: 'translate(0 ' + offsetY + ')' });
    if (caption) {
      var cap = svg('text', { x: 0, y: -fs * 0.8, 'font-size': fs * 1.3, 'font-weight': '700', fill: '#222' });
      cap.textContent = cleanText(caption);
      g.appendChild(cap);
    }
    var sheet = svg('g', { id: 'sheet-' + (offsetY ? Math.round(offsetY) : 0) });
    sheet.appendChild(svg('rect', { x: 0, y: 0, width: L, height: W, fill: '#f6eedc', stroke: '#8a6d3b', 'stroke-width': 0.8 }));
    var trim = lastProblem.trim;
    if (trim > 0) sheet.appendChild(svg('rect', { x: trim, y: trim, width: L - 2 * trim, height: W - 2 * trim, fill: 'none', stroke: '#8a6d3b', 'stroke-width': 0.4, 'stroke-dasharray': '6 4' }));
    g.appendChild(sheet);
    var offcuts = svg('g', { 'data-layer': 'offcuts' });
    sh.offcuts.forEach(function (o) {
      offcuts.appendChild(svg('rect', { x: o.x, y: o.y, width: o.w, height: o.h, fill: 'none', stroke: '#9a9a9a', 'stroke-width': 0.4, 'stroke-dasharray': '3 3' }));
    });
    g.appendChild(offcuts);
    var parts = svg('g', { 'data-layer': 'parts' });
    sh.placements.forEach(function (p) {
      var pg = svg('g');
      var t = svg('title');
      t.textContent = cleanText(partName(p.part)) + ', ' + show(p.width) + ' by ' + show(p.length);
      pg.appendChild(t);
      pg.appendChild(svg('rect', { x: p.x, y: p.y, width: p.w, height: p.h, fill: partColor(p.part), stroke: '#333333', 'stroke-width': 0.5 }));
      label(pg, p.x, p.y, p.w, p.h, [cleanText(partName(p.part)), fmt(p.width).text + ' × ' + fmt(p.length).text], fs, { fill: '#1b1b1b', 'font-weight': '700' });
      parts.appendChild(pg);
    });
    g.appendChild(parts);
    var cuts = svg('g', { 'data-layer': 'cuts', stroke: '#c0392b', 'stroke-width': 0.5, 'stroke-dasharray': '5 3' });
    var k = lastProblem.kerf;
    sh.cuts.forEach(function (c) {
      var mid = c.blade + k / 2;
      cuts.appendChild(svg('line', c.axis === 'x' ? { x1: mid, y1: c.span[0], x2: mid, y2: c.span[1] } : { x1: c.span[0], y1: mid, x2: c.span[1], y2: mid }));
    });
    g.appendChild(cuts);
    parent.appendChild(g);
  }

  /* Builds the SVG document for some sheet groups, at true scale when
     `pixels` is not given, otherwise sized in pixels for the PNG. */
  function exportSvg(groupIndexes, pixels) {
    var sheets = groupIndexes.map(function (gi) { return lastResult.sheets[lastResult.groups[gi].sheets[0]]; });
    var L = Math.max.apply(null, sheets.map(function (s) { return s.length; }));
    var multi = sheets.length > 1;
    var gap = multi ? Math.max(60, L * 0.06) : 0;
    var heights = sheets.map(function (s) { return s.width; });
    var H = heights.reduce(function (a, b) { return a + b; }, 0) + gap * sheets.length;
    var top = multi ? gap : 0;
    var doc = svg('svg', { xmlns: SVG_NS, viewBox: '0 0 ' + L + ' ' + (multi ? H : sheets[0].width), 'font-family': 'Helvetica, Arial, sans-serif' });
    var u = state.unit === 'in' ? 'in' : 'mm';
    var factor = u === 'in' ? 1 / 25.4 : 1;
    var totalH = multi ? H : sheets[0].width;
    if (pixels) {
      var k = pixels / Math.max(L, totalH);
      doc.setAttribute('width', String(Math.round(L * k)));
      doc.setAttribute('height', String(Math.round(totalH * k)));
    } else {
      doc.setAttribute('width', Number((L * factor).toFixed(4)) + u);
      doc.setAttribute('height', Number((totalH * factor).toFixed(4)) + u);
    }
    var title = svg('title');
    title.textContent = 'Cutting layout from oliabak.com Cut Optimizer';
    doc.appendChild(title);
    var desc = svg('desc');
    desc.textContent = 'Units are millimeters in the drawing. Kerf ' + show(lastProblem.kerf) + ', edge trim ' + show(lastProblem.trim) + '. Red dashed lines are blade centerlines.';
    doc.appendChild(desc);
    if (pixels) doc.appendChild(svg('rect', { x: 0, y: 0, width: L, height: totalH, fill: '#ffffff' }));
    var y = top;
    groupIndexes.forEach(function (gi, i) {
      var g = lastResult.groups[gi];
      var sh = sheets[i];
      exportSheet(doc, sh, y, multi ? groupTitle(g) + ', ' + groupDetail(sh) : null);
      y += sh.width + gap;
    });
    return doc;
  }

  function serialize(doc) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(doc);
  }

  function downloadSvg(all) {
    if (!lastResult) return;
    try {
      var indexes = all ? lastResult.groups.map(function (g, i) { return i; }) : [currentGroup];
      var text = serialize(exportSvg(indexes));
      download(new Blob([text], { type: 'image/svg+xml' }), fileName(all ? 'all-sheets' : 'sheet-' + (lastResult.groups[currentGroup].sheets[0] + 1), 'svg'));
      setStatus('SVG saved to your downloads at true scale.', false);
    } catch (e) {
      setStatus('The SVG could not be made in this browser.', true);
    }
  }

  /* Rasterizes the sheet in the preview. The sheet, its file name, and the
     generation are fixed when the export starts, so a layout change or Clear
     all while the image is being encoded cannot mislabel or break it; a
     stale export releases its URL and reports nothing. */
  function downloadPng() {
    if (!lastResult) return;
    var btn = el.png;
    var started = generation;
    var name = fileName('sheet-' + (lastResult.groups[currentGroup].sheets[0] + 1), 'png');
    var url = null;
    var finished = false;
    function finish(message, isError) {
      if (finished) return;
      finished = true;
      if (url) { URL.revokeObjectURL(url); url = null; }
      btn.disabled = !lastResult;
      if (started === generation) setStatus(message, isError);
    }
    btn.disabled = true;
    try {
      var doc = exportSvg([currentGroup], PNG_LONG_SIDE);
      var w = Number(doc.getAttribute('width'));
      var h = Number(doc.getAttribute('height'));
      if (!(w > 0 && h > 0 && w <= 8192 && h <= 8192 && w * h <= 40e6)) { finish('The picture would be too large to make.', true); return; }
      url = URL.createObjectURL(new Blob([serialize(doc)], { type: 'image/svg+xml' }));
      var img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext('2d');
          if (!ctx) { finish('This browser could not draw the picture.', true); return; }
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob(function (blob) {
            try {
              if (started !== generation) { finish('', false); return; }
              if (!blob) { finish('This browser could not save the picture.', true); return; }
              download(blob, name);
              finish('PNG saved to your downloads.', false);
            } catch (e) {
              finish('This browser could not save the picture.', true);
            }
          }, 'image/png');
        } catch (e) {
          finish('This browser could not draw the picture.', true);
        }
      };
      img.onerror = function () { finish('This browser could not draw the picture.', true); };
      img.src = url;
    } catch (e) {
      finish('This browser could not draw the picture.', true);
    }
  }

  /* A spreadsheet cell. Text that a spreadsheet would read as a formula
     gets a leading apostrophe, and cells with separators are quoted. */
  function csvCell(v) {
    var s = cleanText(v === null || v === undefined ? '' : String(v));
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function csvText(rows) {
    return '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  function downloadCsv(kind) {
    if (!lastResult) return;
    var u = state.unit;
    var rows;
    if (kind === 'parts') {
      rows = [['Sheet', 'Stock', 'Part', 'Width (' + u + ')', 'Length (' + u + ')', 'X (' + u + ')', 'Y (' + u + ')', 'Turned']];
      lastResult.sheets.forEach(function (sh, si) {
        sh.placements.forEach(function (p) {
          rows.push([si + 1, stockName(sh.stock), partName(p.part), decimal(p.width), decimal(p.length), decimal(p.x), decimal(p.y), p.rotated ? 'yes' : 'no']);
        });
      });
      lastResult.unplaced.forEach(function (un) {
        var part = lastProblem.parts[un.part];
        for (var i = 0; i < un.count; i += 1) rows.push(['not placed', '', partName(un.part), decimal(part.width), decimal(part.length), '', '', '']);
      });
    } else {
      rows = [['Sheet', 'Cut', 'Type', 'Fence (' + u + ')', 'Length of cut (' + u + ')', 'Blade at (' + u + ' from sheet edge)', 'Direction']];
      lastResult.sheets.forEach(function (sh, si) {
        sh.cuts.forEach(function (c, ci) {
          rows.push([si + 1, ci + 1, cutKind(c), decimal(c.fence), decimal(Math.max(0, c.length)), decimal(Math.max(0, c.blade)), c.axis === 'y' ? 'along the length' : 'at right angles to the length']);
        });
      });
    }
    try {
      download(new Blob([csvText(rows)], { type: 'text/csv;charset=utf-8' }), fileName(kind === 'parts' ? 'cut-list' : 'cut-sequence', 'csv'));
      setStatus('CSV saved to your downloads.', false);
    } catch (e) {
      setStatus('The CSV file could not be saved in this browser.', true);
    }
  }

  function saveProject() {
    try {
      var text = JSON.stringify(toStored(), null, 2);
      download(new Blob([text], { type: 'application/json' }), 'cut-project-' + stamp() + '.json');
      setStatus('Project saved to your downloads.', false);
    } catch (e) {
      setStatus('The project file could not be saved in this browser.', true);
    }
  }

  function openProject(file) {
    if (!file) return;
    /* A new choice cancels any earlier read, even one this file fails. */
    importRequest += 1;
    var request = importRequest;
    if (file.size > PROJECT_MAX_BYTES) { setStatus('That file is too large to be a Cut Optimizer project.', true); return; }
    var reading = typeof file.text === 'function' ? file.text() : Promise.reject(new Error('unsupported'));
    reading.then(function (text) {
      /* Anything the reader did while the file was read wins. */
      if (request !== importRequest) return;
      var data;
      try { data = JSON.parse(text); } catch (e) { data = null; }
      if (!validStored(data)) { setStatus('That file is not a Cut Optimizer project, or it is damaged.', true); return; }
      generation += 1;
      state = fromStored(data);
      rowErrors = { stock: {}, part: {} };
      settingErrors = [];
      currentGroup = 0;
      renderSettings();
      renderRows();
      setStatus('Project opened.', false);
      changed();
    }, function () {
      if (request === importRequest) setStatus('The file could not be read.', true);
    });
  }

  /* ---------- events ---------- */

  function bindRows(container, kind) {
    container.addEventListener('input', function (e) {
      if (e.target.dataset && e.target.dataset.field) onRowInput(kind, e.target);
    });
    container.addEventListener('change', function (e) {
      if (e.target.type === 'checkbox') onRowInput(kind, e.target);
    });
    container.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action="remove"]');
      if (!btn) return;
      var line = btn.closest('.co-row');
      var list = kind === 'stock' ? state.stocks : state.parts;
      list.splice(Number(line.dataset.index), 1);
      rowErrors[kind] = {};
      renderRows();
      changed();
    });
    /* Re-show a readable length in the chosen unit once the field is left. */
    container.addEventListener('focusout', function (e) {
      var t = e.target;
      if (!t.dataset || (t.dataset.field !== 'width' && t.dataset.field !== 'length')) return;
      var line = t.closest('.co-row');
      var list = kind === 'stock' ? state.stocks : state.parts;
      var row = list[Number(line.dataset.index)];
      var errs = rowErrors[kind][line.dataset.index];
      if (row && !(errs && errs[t.dataset.field])) t.value = inputText(row[t.dataset.field]);
    });
  }

  function addRow(kind, row) {
    var list = kind === 'stock' ? state.stocks : state.parts;
    var max = kind === 'stock' ? LIMITS.maxStockRows : LIMITS.maxPartRows;
    if (list.length >= max) return;
    list.push(row);
    renderRows();
    var rows = (kind === 'stock' ? el.stocks : el.parts).querySelectorAll('.co-row');
    var last = rows[rows.length - 1];
    if (last) last.querySelector('input').focus();
    changed();
  }

  function isExample() {
    var ex = freshState(state.mode, state.unit);
    return JSON.stringify([state.kerf, state.trim, state.stocks, state.parts]) === JSON.stringify([ex.kerf, ex.trim, ex.stocks, ex.parts]);
  }

  function resetInputs() {
    generation += 1;
    rowErrors = { stock: {}, part: {} };
    settingErrors = [];
    renderSettings();
    renderRows();
    changed();
  }

  function printLayout() {
    if (!lastResult) return;
    buildPrintView();
    window.print();
  }

  function init(initial) {
    el = collectElements();
    state = initial;
    renderSettings();
    renderRows();

    bindRows(el.stocks, 'stock');
    bindRows(el.parts, 'part');

    root.querySelectorAll('.co-segment-button').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.mode === state.mode) return;
        var swap = isExample();
        var oldDefault = examples(state.mode, state.unit).kerf;
        var mode = b.dataset.mode;
        if (swap) {
          var keep = { unit: state.unit, precision: state.precision, showCuts: state.showCuts };
          state = Object.assign(freshState(mode, state.unit), keep);
        } else {
          state.mode = mode;
          if (Math.abs(state.kerf - oldDefault) < 1e-9) state.kerf = examples(mode, state.unit).kerf;
        }
        currentGroup = 0;
        resetInputs();
      });
    });

    el.unit.addEventListener('change', function () {
      if (['mm', 'cm', 'in'].indexOf(el.unit.value) === -1) return;
      /* Display only. Stored millimeters are never touched. */
      state.unit = el.unit.value;
      resetInputs();
    });

    el.precision.addEventListener('change', function () {
      if (['8', '16', '32', 'decimal'].indexOf(el.precision.value) === -1) return;
      state.precision = el.precision.value;
      saveSoon();
      renderSummaries();
      if (lastResult) renderResults();
    });

    el.stockPreset.addEventListener('change', function () {
      var p = presetAt(STOCK_PRESETS[state.mode], el.stockPreset.value);
      el.stockPreset.value = '';
      if (!p) return;
      var f = CO.MM_PER[p.unit];
      addRow('stock', { name: p.name, width: p.w * f, length: p.l * f, quantity: null, grain: !!p.grain });
    });

    el.partPreset.addEventListener('change', function () {
      var p = presetAt(PART_PRESETS, el.partPreset.value);
      el.partPreset.value = '';
      if (!p) return;
      var f = CO.MM_PER[p.unit];
      addRow('part', { label: p.name, width: p.w * f, length: p.l * f, quantity: 1, grain: false });
    });

    el.addStock.addEventListener('click', function () {
      var last = state.stocks[state.stocks.length - 1];
      addRow('stock', { name: '', width: last ? last.width : null, length: last ? last.length : null, quantity: null, grain: state.mode === 'wood' });
    });

    el.addPart.addEventListener('click', function () {
      addRow('part', { label: '', width: null, length: null, quantity: 1, grain: false });
    });

    el.kerf.addEventListener('input', function () { onSettingInput('kerf'); });
    el.trim.addEventListener('input', function () { onSettingInput('trim'); });
    el.kerfPreset.addEventListener('change', function () {
      var k = el.kerfPreset.value === '' ? null : KERF_PRESETS[state.mode][Number(el.kerfPreset.value)];
      el.kerfPreset.value = '';
      if (!k) return;
      state.kerf = k.mm;
      var i = settingErrors.indexOf('kerf');
      if (i !== -1) settingErrors.splice(i, 1);
      el.kerf.value = inputText(k.mm);
      el.kerf.removeAttribute('aria-invalid');
      renderSummaries();
      changed();
    });

    el.showCuts.addEventListener('change', function () {
      state.showCuts = el.showCuts.checked;
      saveSoon();
      renderPreview();
    });

    el.prev.addEventListener('click', function () {
      if (currentGroup > 0) { currentGroup -= 1; renderPreview(); }
    });
    el.next.addEventListener('click', function () {
      if (lastResult && currentGroup < lastResult.groups.length - 1) { currentGroup += 1; renderPreview(); }
    });

    el.cutList.addEventListener('mouseover', function (e) {
      var tr = e.target.closest('tr[data-cut]');
      highlightCut(tr ? tr.dataset.cut : null);
    });
    el.cutList.addEventListener('mouseleave', function () { highlightCut(null); });
    el.cutList.addEventListener('focusin', function (e) {
      var tr = e.target.closest('tr[data-cut]');
      highlightCut(tr ? tr.dataset.cut : null);
    });
    el.cutList.addEventListener('focusout', function () { highlightCut(null); });

    el.printButtons.forEach(function (b) { b.addEventListener('click', printLayout); });
    window.addEventListener('beforeprint', buildPrintView);

    el.downloadSvg.addEventListener('click', function () { downloadSvg(false); });
    el.svgSheet.addEventListener('click', function () { downloadSvg(false); });
    el.svgAll.addEventListener('click', function () { downloadSvg(true); });
    el.png.addEventListener('click', downloadPng);
    el.csvParts.addEventListener('click', function () { downloadCsv('parts'); });
    el.csvCuts.addEventListener('click', function () { downloadCsv('cuts'); });
    el.saveProject.addEventListener('click', saveProject);
    el.openProject.addEventListener('click', function () { el.projectFile.click(); });
    el.projectFile.addEventListener('change', function () {
      var file = el.projectFile.files && el.projectFile.files[0];
      el.projectFile.value = '';
      openProject(file);
    });

    el.example.addEventListener('click', function () {
      var keep = { unit: state.unit, precision: state.precision, showCuts: state.showCuts };
      state = Object.assign(freshState(state.mode, state.unit), keep);
      currentGroup = 0;
      resetInputs();
    });

    el.clear.addEventListener('click', function () {
      state.stocks = [];
      state.parts = [];
      rowErrors = { stock: {}, part: {} };
      settingErrors = [];
      forget();
      importRequest += 1;
      renderRows();
      clearResults();
      clearTimeout(saveTimer);
      setStatus('Cleared. Add a stock sheet and a part to start, or restore the example.', false);
    });

    var lastSize = '';
    var pending = 0;
    function onResize() {
      if (pending) return;
      pending = requestAnimationFrame(function () {
        pending = 0;
        var r = el.sheets.getBoundingClientRect();
        var size = Math.round(r.width) + 'x' + Math.round(r.height);
        if (size !== lastSize) {
          lastSize = size;
          renderPreview();
        }
      });
    }
    if (typeof ResizeObserver === 'function') new ResizeObserver(onResize).observe(el.sheets);
    else window.addEventListener('resize', onResize);

    run();
  }

  /* Runs at once, before the step panels below this script are parsed and
     painted. It applies the saved mode and holds the height of the saved
     number of rows, so the rows that init() builds move nothing. */
  function prepare(initial) {
    root.dataset.mode = initial.mode;
    root.style.setProperty('--co-stock-rows', String(initial.stocks.length));
    root.style.setProperty('--co-part-rows', String(initial.parts.length));
  }

  var initial = load() || freshState('wood', defaultUnit());
  prepare(initial);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(initial); });
  else init(initial);
})();
