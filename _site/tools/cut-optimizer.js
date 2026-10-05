/* Cut Optimizer page.
 *
 * Reads the stock and part rows, asks CutOptimizer (cut-optimizer-engine.js)
 * for a layout, and draws it. Every element is built with createElement,
 * createElementNS, and textContent; no reader text reaches an HTML sink.
 * Lengths are kept in millimeters and only converted for display, so
 * switching units never rounds a stored value.
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

  /* The script runs before the input panels are parsed (see the .qmd), so
     the elements are looked up in init(), once the document is complete. */
  var el = null;
  function collectElements() {
    return {
      unit: document.getElementById('co-unit'),
      precision: document.getElementById('co-precision'),
      precisionWrap: document.getElementById('co-precision-wrap'),
      stocks: document.getElementById('co-stocks'),
      parts: document.getElementById('co-parts'),
      stockPreset: document.getElementById('co-stock-preset'),
      partPreset: document.getElementById('co-part-preset'),
      addStock: document.getElementById('co-add-stock'),
      addPart: document.getElementById('co-add-part'),
      kerf: document.getElementById('co-kerf'),
      kerfPreset: document.getElementById('co-kerf-preset'),
      trim: document.getElementById('co-trim'),
      showCuts: document.getElementById('co-show-cuts'),
      print: document.getElementById('co-print'),
      example: document.getElementById('co-example'),
      clear: document.getElementById('co-clear'),
      status: document.getElementById('co-status'),
      summary: document.getElementById('co-summary'),
      unplaced: document.getElementById('co-unplaced'),
      sheets: document.getElementById('co-sheets')
    };
  }

  function defaultUnit() {
    var lang = (navigator.language || '').toLowerCase();
    return /^en-(us|lr)$/.test(lang) ? 'in' : 'mm';
  }

  var state = null;
  var lastResult = null;
  var lastProblem = null;

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

  /* ---------- storage (a per-device convenience, never required) ---------- */

  function isText(v) { return typeof v === 'string' && v.length <= LIMITS.maxText; }
  function isMm(v, max) { return v === null || (typeof v === 'number' && isFinite(v) && v >= 0 && v <= max); }
  function isQty(v, allowNull) { return (allowNull && v === null) || (Number.isInteger(v) && v >= 1 && v <= LIMITS.maxQuantity); }

  function validStored(s) {
    if (!s || typeof s !== 'object' || s.v !== 1) return false;
    if (s.mode !== 'wood' && s.mode !== 'paper') return false;
    if (['mm', 'cm', 'in'].indexOf(s.unit) === -1) return false;
    if (['8', '16', '32', 'decimal'].indexOf(s.precision) === -1) return false;
    if (typeof s.showCuts !== 'boolean') return false;
    if (!isMm(s.kerf, LIMITS.maxKerfMm) || !isMm(s.trim, LIMITS.maxTrimMm)) return false;
    if (!Array.isArray(s.stocks) || s.stocks.length > LIMITS.maxStockRows) return false;
    if (!Array.isArray(s.parts) || s.parts.length > LIMITS.maxPartRows) return false;
    var okStocks = s.stocks.every(function (r) {
      return r && isText(r.name) && isMm(r.width, LIMITS.maxLengthMm) && isMm(r.length, LIMITS.maxLengthMm) && isQty(r.quantity, true) && typeof r.grain === 'boolean';
    });
    var okParts = s.parts.every(function (r) {
      return r && isText(r.label) && isMm(r.width, LIMITS.maxLengthMm) && isMm(r.length, LIMITS.maxLengthMm) && isQty(r.quantity, false) && typeof r.grain === 'boolean';
    });
    return okStocks && okParts;
  }

  function pick(row, keys) {
    var out = {};
    keys.forEach(function (k) { out[k] = row[k]; });
    return out;
  }

  function load() {
    try {
      var text = window.localStorage.getItem(STORAGE_KEY);
      if (!text || text.length > 200000) return null;
      var s = JSON.parse(text);
      if (!validStored(s)) return null;
      return {
        mode: s.mode, unit: s.unit, precision: s.precision, showCuts: s.showCuts, kerf: s.kerf, trim: s.trim,
        stocks: s.stocks.map(function (r) { return pick(r, ['name', 'width', 'length', 'quantity', 'grain']); }),
        parts: s.parts.map(function (r) { return pick(r, ['label', 'width', 'length', 'quantity', 'grain']); })
      };
    } catch (e) {
      return null;
    }
  }

  var saveTimer = 0;
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        var s = Object.assign({ v: 1 }, state);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
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

  function unitLabel() {
    return state.unit === 'in' ? 'in' : state.unit;
  }

  /* A length for reading, with the unit, and an approximate mark when the
     shown value is rounded. */
  function show(mm, withExact) {
    var f = fmt(mm);
    var text = (f.approx ? '≈ ' : '') + f.text + ' ' + unitLabel();
    if (withExact && f.approx && state.unit === 'in') text += ' (' + CO.formatLength(mm, 'in', 'decimal').text + ')';
    return text;
  }

  function inputText(mm) {
    if (mm === null || mm === undefined || !isFinite(mm)) return '';
    var f = state.unit === 'in' ? CO.formatLength(mm, 'in', 'decimal') : CO.formatLength(mm, state.unit);
    /* Show fractions when they are exact at 1/32, decimals otherwise. */
    if (state.unit === 'in') {
      var frac = CO.formatLength(mm, 'in', '32');
      if (!frac.approx) return frac.text;
    }
    return f.text;
  }

  function areaText(mm2) {
    if (state.unit === 'in') return (mm2 / (304.8 * 304.8)).toFixed(1) + ' ft²';
    return (mm2 / 1e6).toFixed(2) + ' m²';
  }

  function longText(mm) {
    if (state.unit === 'in') return (mm / 304.8).toFixed(1) + ' ft';
    return (mm / 1000).toFixed(1) + ' m';
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
    var qty = textInput('co-qty', row.quantity === null ? '' : String(row.quantity), noun + ' ' + (index + 1) + ' quantity', 4);
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
    if (kind === 'part') {
      var swatch = make('span', 'co-swatch');
      swatch.style.background = PALETTE[index % PALETTE.length];
      line.appendChild(swatch);
    }
    [name, width, length, qty, grainWrap, remove].forEach(function (n) { line.appendChild(n); });
    return line;
  }

  function renderRows() {
    el.stocks.replaceChildren.apply(el.stocks, state.stocks.map(function (r, i) { return buildRow('stock', r, i); }));
    el.parts.replaceChildren.apply(el.parts, state.parts.map(function (r, i) { return buildRow('part', r, i); }));
    el.addStock.disabled = state.stocks.length >= LIMITS.maxStockRows;
    el.addPart.disabled = state.parts.length >= LIMITS.maxPartRows;
    el.stockPreset.disabled = el.addStock.disabled;
    el.partPreset.disabled = el.addPart.disabled;
  }

  function renderSettings() {
    root.dataset.mode = state.mode;
    root.querySelectorAll('.co-segment-button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.mode === state.mode ? 'true' : 'false');
    });
    el.unit.value = state.unit;
    el.precision.value = state.precision;
    el.precisionWrap.hidden = state.unit !== 'in';
    el.showCuts.checked = state.showCuts;
    el.kerf.value = inputText(state.kerf);
    el.trim.value = inputText(state.trim);
    el.kerf.removeAttribute('aria-invalid');
    el.trim.removeAttribute('aria-invalid');
    fillPresetSelect(el.stockPreset, STOCK_PRESETS[state.mode]);
    fillPresetSelect(el.partPreset, PART_PRESETS);
    el.partPreset.hidden = state.mode !== 'paper';
    var kerfOptions = [make('option', '', 'Typical values')];
    kerfOptions[0].value = '';
    KERF_PRESETS[state.mode].forEach(function (k, i) {
      var o = make('option', '', k.name);
      o.value = String(i);
      kerfOptions.push(o);
    });
    el.kerfPreset.replaceChildren.apply(el.kerfPreset, kerfOptions);
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
      var allowEmpty = kind === 'stock';
      if (!t && allowEmpty) { row.quantity = null; delete errs.quantity; target.removeAttribute('aria-invalid'); }
      else if (/^\d{1,3}$/.test(t) && Number(t) >= 1) { row.quantity = Number(t); delete errs.quantity; target.removeAttribute('aria-invalid'); }
      else { errs.quantity = true; target.setAttribute('aria-invalid', 'true'); }
    } else if (field === 'width' || field === 'length') {
      var r = readLength(target, true);
      if (r.ok && r.mm > 0 && r.mm <= LIMITS.maxLengthMm) { row[field] = r.mm; delete errs[field]; }
      else { errs[field] = true; target.setAttribute('aria-invalid', 'true'); }
    }
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
    changed();
  }

  /* ---------- solving ---------- */

  var solveTimer = 0;
  function changed() {
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
        var e = rowErrors[kind][i];
        var fields = Object.keys(e);
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
      setStatus(problems.join(' ') + ' The layout below is from the last readable input.', true);
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
    lastResult = result;
    lastProblem = problem;
    var s = result.stats;
    var msg = 'Laid out ' + s.placed + ' of ' + s.pieces + ' parts on ' + s.sheets + (s.sheets === 1 ? ' sheet' : ' sheets') + ', after trying ' + s.runs + ' layouts.';
    if (s.placed < s.pieces) msg += ' Some parts did not fit, as listed below.';
    msg += incompleteNote();
    setStatus(msg, s.placed < s.pieces);
    renderResults();
  }

  function clearResults() {
    lastResult = null;
    lastProblem = null;
    el.summary.querySelectorAll('[data-stat]').forEach(function (n) { n.textContent = '–'; });
    el.unplaced.hidden = true;
    el.unplaced.replaceChildren();
    el.sheets.replaceChildren();
  }

  /* ---------- drawing ---------- */

  function svg(tag, attrs) {
    var n = document.createElementNS(SVG_NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, String(attrs[k])); });
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
      var head = make('p', 'co-unplaced-head', 'Parts that were not placed');
      var list = make('ul', 'tool-list');
      r.unplaced.forEach(function (u) {
        var why = u.reason === 'size' ? 'larger than every stock sheet after trim' + (lastProblem.parts[u.part].grain ? ', with the grain direction kept' : '') : 'no stock sheets left; raise a sheet quantity or leave it empty for unlimited';
        list.appendChild(make('li', '', u.count + ' × ' + partName(u.part) + ' (' + show(lastProblem.parts[u.part].width) + ' by ' + show(lastProblem.parts[u.part].length) + '), ' + why + '.'));
      });
      el.unplaced.replaceChildren(head, list);
      el.unplaced.hidden = false;
    } else {
      el.unplaced.hidden = true;
      el.unplaced.replaceChildren();
    }

    var width = Math.max(240, el.sheets.clientWidth - 2);
    var nodes = r.groups.map(function (g, gi) { return renderGroup(g, gi, width); });
    el.sheets.replaceChildren.apply(el.sheets, nodes);
  }

  function renderGroup(group, gi, width) {
    var sh = lastResult.sheets[group.sheets[0]];
    var figure = make('figure', 'co-sheet');
    var count = group.sheets.length;
    var first = group.sheets[0] + 1;
    var title = count > 1 ? 'Sheets ' + first + ' to ' + (group.sheets[count - 1] + 1) + ' (' + count + ' identical)' : 'Sheet ' + first;
    var used = (sh.partArea / sh.area * 100).toFixed(1);
    var caption = make('figcaption', 'co-sheet-caption');
    caption.appendChild(make('strong', '', title));
    caption.appendChild(document.createTextNode(' · ' + stockName(sh.stock) + ', ' + show(sh.width) + ' by ' + show(sh.length) + ' · ' + sh.placements.length + (sh.placements.length === 1 ? ' part' : ' parts') + ' · ' + used + '% used'));
    figure.appendChild(caption);
    figure.appendChild(drawSheet(sh, gi, width));
    figure.appendChild(cutTable(sh));
    return figure;
  }

  function drawSheet(sh, gi, pxWidth) {
    var L = sh.length;
    var W = sh.width;
    var scale = pxWidth / L;
    var maxH = 900;
    if (W * scale > maxH) scale = maxH / W;
    var fs = 12 / scale;
    var out = svg('svg', { viewBox: '0 0 ' + L + ' ' + W, class: 'co-svg', role: 'img', width: Math.round(L * scale), height: Math.round(W * scale) });
    out.setAttribute('aria-label', 'Layout of sheet ' + (gi + 1) + ', ' + sh.placements.length + ' parts on ' + show(sh.width) + ' by ' + show(sh.length));
    var defs = svg('defs');
    var hatchId = 'co-hatch-' + gi;
    var step = 7 / scale;
    var pattern = svg('pattern', { id: hatchId, patternUnits: 'userSpaceOnUse', width: step, height: step, patternTransform: 'rotate(45)' });
    pattern.appendChild(svg('line', { x1: 0, y1: 0, x2: 0, y2: step, class: 'co-hatch-line', 'vector-effect': 'non-scaling-stroke' }));
    defs.appendChild(pattern);
    out.appendChild(defs);

    out.appendChild(svg('rect', { x: 0, y: 0, width: L, height: W, class: 'co-sheet-bg', 'vector-effect': 'non-scaling-stroke' }));
    var trim = lastProblem.trim;
    if (trim > 0) {
      var t = svg('path', {
        d: 'M0 0H' + L + 'V' + W + 'H0Z M' + trim + ' ' + trim + 'V' + (W - trim) + 'H' + (L - trim) + 'V' + trim + 'Z',
        fill: 'url(#' + hatchId + ')', 'fill-rule': 'evenodd', class: 'co-trim'
      });
      out.appendChild(t);
    }
    var bigEnough = Math.min(L, W) * 0.04;
    sh.offcuts.forEach(function (o) {
      out.appendChild(svg('rect', { x: o.x, y: o.y, width: o.w, height: o.h, fill: 'url(#' + hatchId + ')', class: 'co-offcut' }));
      if (o.w > bigEnough && o.h > bigEnough) label(out, o.x, o.y, o.w, o.h, ['Offcut', fmt(o.h).text + ' × ' + fmt(o.w).text], fs * 0.9, 'co-offcut-text');
    });

    sh.placements.forEach(function (p) {
      var g = svg('g', { class: 'co-part' });
      var tip = svg('title');
      tip.textContent = partName(p.part) + ', ' + show(p.width) + ' by ' + show(p.length) + (p.rotated ? ', turned' : '');
      g.appendChild(tip);
      g.appendChild(svg('rect', { x: p.x, y: p.y, width: p.w, height: p.h, fill: partColor(p.part), class: 'co-part-rect', 'vector-effect': 'non-scaling-stroke' }));
      var dims = fmt(p.width).text + ' × ' + fmt(p.length).text;
      label(g, p.x, p.y, p.w, p.h, [partName(p.part), dims], fs, 'co-part-text');
      out.appendChild(g);
    });

    if (state.showCuts) {
      var k = lastProblem.kerf;
      sh.cuts.forEach(function (c, ci) {
        var mid = c.blade + k / 2;
        var line = c.axis === 'x'
          ? { x1: mid, y1: c.span[0], x2: mid, y2: c.span[1] }
          : { x1: c.span[0], y1: mid, x2: c.span[1], y2: mid };
        line.class = 'co-cut-line';
        line['vector-effect'] = 'non-scaling-stroke';
        out.appendChild(svg('line', line));
      });
      sh.cuts.forEach(function (c, ci) {
        var mid = c.blade + k / 2;
        var along = (c.span[0] + c.span[1]) / 2;
        var cx = c.axis === 'x' ? mid : along;
        var cy = c.axis === 'x' ? along : mid;
        var r = 8 / scale;
        cx = Math.min(Math.max(cx, r), L - r);
        cy = Math.min(Math.max(cy, r), W - r);
        var g = svg('g', { class: 'co-cut-mark' });
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
     estimate uses 0.6 em per character, which suits Sora at this size. */
  function label(parent, x, y, w, h, lines, fs, cls) {
    var pad = fs * 0.4;
    function widest(n, size) {
      var m = 0;
      for (var i = 0; i < n; i += 1) m = Math.max(m, lines[i].length * size * 0.6);
      return m;
    }
    var tries = [
      { n: 2, rot: false }, { n: 1, rot: false }, { n: 2, rot: true }, { n: 1, rot: true }
    ];
    for (var t = 0; t < tries.length; t += 1) {
      var n = Math.min(tries[t].n, lines.length);
      var along = tries[t].rot ? h : w;
      var across = tries[t].rot ? w : h;
      if (widest(n, fs) + 2 * pad <= along && n * fs * 1.25 + pad <= across) {
        var cx = x + w / 2;
        var cy = y + h / 2;
        var text = svg('text', { x: cx, y: cy, 'font-size': fs, 'text-anchor': 'middle', class: cls });
        if (tries[t].rot) text.setAttribute('transform', 'rotate(-90 ' + cx + ' ' + cy + ')');
        for (var i = 0; i < n; i += 1) {
          var span = svg('tspan', { x: cx, dy: i === 0 ? (-(n - 1) * 0.625 + 0.35) + 'em' : '1.25em' });
          if (i > 0) span.setAttribute('class', 'co-dim');
          span.textContent = lines[i];
          text.appendChild(span);
        }
        parent.appendChild(text);
        return;
      }
    }
  }

  function cutTable(sh) {
    var details = make('details', 'co-cuts');
    details.appendChild(make('summary', '', 'Cut sequence, ' + sh.cuts.length + (sh.cuts.length === 1 ? ' cut' : ' cuts')));
    var table = make('table', 'co-cut-table');
    var thead = make('thead');
    var hr = make('tr');
    ['#', 'Cut', 'Fence', 'Length of cut'].forEach(function (h) { hr.appendChild(make('th', '', h)); });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = make('tbody');
    sh.cuts.forEach(function (c, i) {
      var tr = make('tr');
      var kind = c.kind === 'trim' ? 'Trim ' + (c.axis === 'y' ? 'rip' : 'cross cut') : c.kind === 'rip' ? 'Rip' : 'Cross cut';
      tr.appendChild(make('td', '', String(i + 1)));
      tr.appendChild(make('td', '', kind));
      tr.appendChild(make('td', '', show(c.fence, true)));
      tr.appendChild(make('td', '', show(Math.max(0, c.length))));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    details.appendChild(table);
    return details;
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
        rowErrors = { stock: {}, part: {} };
        settingErrors = [];
        renderSettings();
        renderRows();
        changed();
      });
    });

    el.unit.addEventListener('change', function () {
      if (['mm', 'cm', 'in'].indexOf(el.unit.value) === -1) return;
      /* Display only. Stored millimeters are never touched. */
      state.unit = el.unit.value;
      rowErrors = { stock: {}, part: {} };
      settingErrors = [];
      renderSettings();
      renderRows();
      changed();
    });

    el.precision.addEventListener('change', function () {
      if (['8', '16', '32', 'decimal'].indexOf(el.precision.value) === -1) return;
      state.precision = el.precision.value;
      saveSoon();
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
      changed();
    });

    el.showCuts.addEventListener('change', function () {
      state.showCuts = el.showCuts.checked;
      saveSoon();
      if (lastResult) renderResults();
    });

    el.print.addEventListener('click', function () {
      root.querySelectorAll('details.co-cuts').forEach(function (d) { d.open = true; });
      window.print();
    });

    el.example.addEventListener('click', function () {
      var keep = { unit: state.unit, precision: state.precision, showCuts: state.showCuts };
      state = Object.assign(freshState(state.mode, state.unit), keep);
      rowErrors = { stock: {}, part: {} };
      settingErrors = [];
      renderSettings();
      renderRows();
      changed();
    });

    el.clear.addEventListener('click', function () {
      state.stocks = [];
      state.parts = [];
      rowErrors = { stock: {}, part: {} };
      settingErrors = [];
      forget();
      renderRows();
      clearResults();
      clearTimeout(saveTimer);
      setStatus('Cleared. Add a stock sheet and a part to start, or load the example.', false);
    });

    var lastWidth = el.sheets.clientWidth;
    var pending = 0;
    function onResize() {
      if (pending) return;
      pending = requestAnimationFrame(function () {
        pending = 0;
        var w = el.sheets.clientWidth;
        if (Math.abs(w - lastWidth) > 4 && lastResult) {
          lastWidth = w;
          renderResults();
        }
      });
    }
    if (typeof ResizeObserver === 'function') new ResizeObserver(onResize).observe(el.sheets);
    else window.addEventListener('resize', onResize);

    run();
  }

  /* Runs at once, before the input panels below this script are parsed and
     painted. It applies the saved settings to the toolbar above and holds
     the height of the saved number of rows, so the rows that init() builds
     move nothing. */
  function prepare(initial) {
    root.dataset.mode = initial.mode;
    root.querySelectorAll('.co-segment-button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.mode === initial.mode ? 'true' : 'false');
    });
    var unit = document.getElementById('co-unit');
    var wrap = document.getElementById('co-precision-wrap');
    if (unit) unit.value = initial.unit;
    if (wrap) wrap.hidden = initial.unit !== 'in';
    root.style.setProperty('--co-stock-rows', String(initial.stocks.length));
    root.style.setProperty('--co-part-rows', String(initial.parts.length));
  }

  var initial = load() || freshState('wood', defaultUnit());
  prepare(initial);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(initial); });
  else init(initial);
})();
