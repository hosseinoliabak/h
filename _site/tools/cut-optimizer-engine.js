/* Cut Optimizer engine.
 *
 * Everything that reads a length, lays out parts, or checks a layout lives
 * here, with no DOM and no network, so the same file runs in the page and
 * under node's test runner. The page (cut-optimizer.js) only draws what this
 * returns.
 *
 * Lengths are millimeters everywhere inside the engine. A sheet is drawn
 * with its length along x and its width along y. A sheet that has grain runs
 * it along its length, and a part marked "grain" keeps its own length along
 * the sheet length, so it may not rotate on such a sheet.
 *
 * Layouts are guillotine layouts. Every cut runs straight through the piece
 * it is made on, from one edge to the opposite edge, which is all a table
 * saw, panel saw, track saw, or paper guillotine can do. The packer is the guillotine family from Jukka
 * Jylanki, "A Thousand Ways to Pack the Bin" (2010), without the optional
 * free-rectangle merge. Each free rectangle is therefore a physical piece
 * that earlier recorded cuts produced, so the order in which the splits were
 * recorded is a valid cutting order.
 *
 * Kerf model. Each part is inflated by the kerf in both directions, and so is
 * the usable sheet (the sheet less the edge trim on each side). A part that
 * ends against the usable edge then pays no kerf, and every other part pays
 * exactly one kerf on its far side, which is where the blade passes. Free
 * rectangles carry the same inflation, so a free rectangle w wide is a
 * physical piece w - kerf wide.
 *
 * The result is a heuristic. A portfolio of sort orders, fit rules, and split
 * rules runs first, then seeded random restarts until an iteration or time
 * budget is spent. The seed comes from the input, so the same input gives
 * the same layout. Candidates are ranked by unplaced parts, then sheets
 * used, then cuts, then stock area, then how full the last sheet is (a fuller
 * last sheet is worse, because the offcut left over is smaller).
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module && module.exports) module.exports = factory();
  else root.CutOptimizer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MM_PER = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
  var EPS = 1e-7;

  /* Every bound the page and the engine apply, in one place. */
  var LIMITS = {
    maxStockRows: 50,
    maxPartRows: 200,
    maxPieces: 2000,
    maxQuantity: 999,
    maxLengthMm: 100000,
    maxKerfMm: 20,
    maxTrimMm: 500,
    maxText: 40,
    maxInputChars: 40,
    timeBudgetMs: 150,
    workBudget: 6000000
  };

  /* ---------- reading and writing lengths ---------- */

  var UNIT_WORDS = {
    mm: 'mm', millimeter: 'mm', millimeters: 'mm',
    cm: 'cm', centimeter: 'cm', centimeters: 'cm',
    m: 'm', meter: 'm', meters: 'm',
    in: 'in', inch: 'in', inches: 'in', '"': 'in', '″': 'in', "''": 'in',
    ft: 'ft', foot: 'ft', feet: 'ft', "'": 'ft', '′': 'ft'
  };

  /* One quantity is a fraction (3/4), a mixed number (23 3/4 or 23-3/4), or a
     decimal (23.75), followed by an optional unit. */
  var SEGMENT = /^\s*(?:(\d+)\s*\/\s*(\d+)|(\d+(?:\.\d*)?|\.\d+)(?:(?:\s+|\s*-\s*)(\d+)\s*\/\s*(\d+))?)\s*(millimeters|millimeter|mm|centimeters|centimeter|cm|meters|meter|m|inches|inch|in|''|"|″|feet|foot|ft|'|′)?/i;

  function segmentValue(m) {
    if (m[1] !== undefined) {
      var den = Number(m[2]);
      if (den === 0) return NaN;
      return Number(m[1]) / den;
    }
    var whole = Number(m[3]);
    if (m[4] !== undefined) {
      if (!/^\d+$/.test(m[3])) return NaN;
      var d = Number(m[5]);
      if (d === 0) return NaN;
      return whole + Number(m[4]) / d;
    }
    return whole;
  }

  /* Reads a length typed by a reader. `unit` is the unit a bare number is
     in. Returns { ok: true, mm } or { ok: false, error }. Accepts at most
     two quantities, which must be feet then inches, as in 4' 6 1/2". */
  function parseLength(text, unit) {
    if (typeof text !== 'string') return { ok: false, error: 'missing' };
    if (text.length > LIMITS.maxInputChars) return { ok: false, error: 'too long' };
    var s = text.trim().replace(/(\d),(\d)/g, '$1.$2');
    if (!s) return { ok: false, error: 'empty' };
    var parts = [];
    while (s.length && parts.length < 3) {
      var m = SEGMENT.exec(s);
      if (!m || !m[0].trim()) return { ok: false, error: 'not a length' };
      var v = segmentValue(m);
      if (!isFinite(v)) return { ok: false, error: 'not a length' };
      parts.push({ value: v, unit: m[6] ? UNIT_WORDS[m[6].toLowerCase()] : null });
      s = s.slice(m[0].length);
    }
    if (s.trim().length) return { ok: false, error: 'not a length' };
    var mm;
    if (parts.length === 1) {
      var u = parts[0].unit || unit;
      if (!MM_PER[u]) return { ok: false, error: 'unknown unit' };
      mm = parts[0].value * MM_PER[u];
    } else if (parts.length === 2 && parts[0].unit === 'ft' && (parts[1].unit === null || parts[1].unit === 'in')) {
      mm = parts[0].value * MM_PER.ft + parts[1].value * MM_PER.in;
    } else {
      return { ok: false, error: 'not a length' };
    }
    if (!isFinite(mm) || mm < 0) return { ok: false, error: 'not a length' };
    return { ok: true, mm: mm };
  }

  function trimZeros(text) {
    return text.indexOf('.') === -1 ? text : text.replace(/\.?0+$/, '');
  }

  function gcd(a, b) {
    while (b) { var t = a % b; a = b; b = t; }
    return a;
  }

  /* Writes a length in `unit`. Imperial output rounds to 1/precision of an
     inch, or three decimals when precision is 'decimal'. `approx` is true
     when the text is not the exact value. */
  function formatLength(mm, unit, precision) {
    var v = mm / (MM_PER[unit] || 1);
    var text;
    var shown;
    if (unit === 'in' && precision !== 'decimal') {
      var den = Number(precision) || 16;
      var n = Math.round(v * den);
      shown = n / den;
      var whole = Math.floor(n / den);
      var rem = n - whole * den;
      if (rem === 0) {
        text = String(whole);
      } else {
        var g = gcd(rem, den);
        var frac = (rem / g) + '/' + (den / g);
        text = whole ? whole + ' ' + frac : frac;
      }
    } else {
      var digits = unit === 'mm' ? 1 : unit === 'cm' ? 2 : 3;
      text = trimZeros(v.toFixed(digits));
      shown = Number(text);
    }
    return { text: text, approx: Math.abs(shown - v) > 1e-6 * Math.max(1, Math.abs(v)) };
  }

  /* ---------- seeded random numbers ---------- */

  function hashString(text) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- input checking ---------- */

  function isLength(v, max) {
    return typeof v === 'number' && isFinite(v) && v > 0 && v <= max;
  }

  /* Checks a problem and returns a list of messages, empty when it can be
     solved. Rows are checked by the page as they are typed; this is the
     engine's own boundary. */
  function validateProblem(p) {
    var errors = [];
    if (!p || typeof p !== 'object') return ['No input.'];
    if (!(typeof p.kerf === 'number' && isFinite(p.kerf) && p.kerf >= 0 && p.kerf <= LIMITS.maxKerfMm)) errors.push('Kerf must be between 0 and ' + LIMITS.maxKerfMm + ' mm.');
    if (!(typeof p.trim === 'number' && isFinite(p.trim) && p.trim >= 0 && p.trim <= LIMITS.maxTrimMm)) errors.push('Edge trim must be between 0 and ' + LIMITS.maxTrimMm + ' mm.');
    if (!Array.isArray(p.stocks) || !p.stocks.length) errors.push('Add at least one stock sheet.');
    else if (p.stocks.length > LIMITS.maxStockRows) errors.push('At most ' + LIMITS.maxStockRows + ' stock sheet rows.');
    if (!Array.isArray(p.parts) || !p.parts.length) errors.push('Add at least one part.');
    else if (p.parts.length > LIMITS.maxPartRows) errors.push('At most ' + LIMITS.maxPartRows + ' part rows.');
    if (errors.length) return errors;
    p.stocks.forEach(function (s, i) {
      if (!isLength(s.width, LIMITS.maxLengthMm) || !isLength(s.length, LIMITS.maxLengthMm)) errors.push('Sheet ' + (i + 1) + ' needs a width and a length.');
      if (s.quantity !== null && !(Number.isInteger(s.quantity) && s.quantity >= 1 && s.quantity <= LIMITS.maxQuantity)) errors.push('Sheet ' + (i + 1) + ' quantity must be a whole number from 1 to ' + LIMITS.maxQuantity + ', or empty for unlimited.');
    });
    var pieces = 0;
    p.parts.forEach(function (q, i) {
      if (!isLength(q.width, LIMITS.maxLengthMm) || !isLength(q.length, LIMITS.maxLengthMm)) errors.push('Part ' + (i + 1) + ' needs a width and a length.');
      if (!(Number.isInteger(q.quantity) && q.quantity >= 1 && q.quantity <= LIMITS.maxQuantity)) errors.push('Part ' + (i + 1) + ' quantity must be a whole number from 1 to ' + LIMITS.maxQuantity + '.');
      else pieces += q.quantity;
    });
    if (pieces > LIMITS.maxPieces) errors.push('At most ' + LIMITS.maxPieces + ' parts in total; this list has ' + pieces + '.');
    return errors;
  }

  /* ---------- packing ---------- */

  var SORTS = {
    area: function (a, b) { return b.len * b.wid - a.len * a.wid; },
    long: function (a, b) { return Math.max(b.len, b.wid) - Math.max(a.len, a.wid) || Math.min(b.len, b.wid) - Math.min(a.len, a.wid); },
    short: function (a, b) { return Math.min(b.len, b.wid) - Math.min(a.len, a.wid) || Math.max(b.len, b.wid) - Math.max(a.len, a.wid); },
    perimeter: function (a, b) { return (b.len + b.wid) - (a.len + a.wid); },
    length: function (a, b) { return b.len - a.len || b.wid - a.wid; },
    width: function (a, b) { return b.wid - a.wid || b.len - a.len; }
  };
  var FITS = ['baf', 'bssf', 'blsf'];
  var SPLITS = ['sla', 'lla', 'maxa', 'mina'];
  var SHEET_RULES = ['best', 'first'];
  var STOCK_RULES = ['fill', 'small', 'large'];

  function fitScore(rule, r, a, b) {
    var dw = r.w - a;
    var dh = r.h - b;
    if (rule === 'bssf') return Math.min(dw, dh) * 1e6 + Math.max(dw, dh);
    if (rule === 'blsf') return Math.max(dw, dh) * 1e6 + Math.min(dw, dh);
    return (r.w * r.h - a * b) * 1e3 + Math.min(dw, dh);
  }

  /* A stock type prepared for packing. ux, uy are the inflated usable
     length and width. */
  function prepareStock(s, index, kerf, trim) {
    return {
      index: index,
      length: s.length,
      width: s.width,
      grain: !!s.grain,
      ux: s.length - 2 * trim + kerf,
      uy: s.width - 2 * trim + kerf,
      area: s.length * s.width
    };
  }

  /* The orientations a part may take on a stock type, as inflated
     [x extent, y extent, rotated]. */
  function orientations(item, st, kerf) {
    var out = [[item.len + kerf, item.wid + kerf, false]];
    if (!(item.grain && st.grain) && Math.abs(item.len - item.wid) > EPS) out.push([item.wid + kerf, item.len + kerf, true]);
    return out;
  }

  function fitsStock(item, st, kerf) {
    if (st.ux <= kerf + EPS || st.uy <= kerf + EPS) return false;
    return orientations(item, st, kerf).some(function (o) { return o[0] <= st.ux + EPS && o[1] <= st.uy + EPS; });
  }

  function newSheet(st) {
    return { stock: st, free: [{ x: 0, y: 0, w: st.ux, h: st.uy }], scrap: [], placed: [], cuts: [], partArea: 0 };
  }

  /* Best spot for an item on one sheet, or null. */
  function bestSpot(sheet, item, kerf, fitRule, minSide, counter) {
    var best = null;
    var opts = orientations(item, sheet.stock, kerf);
    for (var i = 0; i < sheet.free.length; i += 1) {
      var r = sheet.free[i];
      counter.work += 1;
      for (var j = 0; j < opts.length; j += 1) {
        var a = opts[j][0];
        var b = opts[j][1];
        if (a <= r.w + EPS && b <= r.h + EPS) {
          var score = fitScore(fitRule, r, a, b);
          if (!best || score < best.score - EPS) best = { index: i, a: a, b: b, rotated: opts[j][2], score: score };
        }
      }
    }
    return best;
  }

  function keepFree(sheet, r, minSide) {
    if (r.w <= EPS || r.h <= EPS) return;
    if (r.w + EPS < minSide || r.h + EPS < minSide) sheet.scrap.push(r);
    else sheet.free.push(r);
  }

  /* Places an item at the corner of free rectangle spot.index and records
     the cuts that free it. A rip runs along the sheet length (a line of
     constant y); a cross cut runs at right angles to it (a line of
     constant x). */
  function place(sheet, item, spot, splitRule, kerf, minSide) {
    var r = sheet.free[spot.index];
    sheet.free.splice(spot.index, 1);
    var a = spot.a;
    var b = spot.b;
    var dw = r.w - a;
    var dh = r.h - b;
    var ripFirst;
    if (splitRule === 'sla') ripFirst = dw <= dh;
    else if (splitRule === 'lla') ripFirst = dw > dh;
    else if (splitRule === 'maxa') ripFirst = a * dh > dw * b;
    else ripFirst = a * dh <= dw * b;
    sheet.placed.push({ part: item.part, x: r.x, y: r.y, a: a, b: b, rotated: spot.rotated });
    sheet.partArea += item.len * item.wid;
    if (ripFirst) {
      if (dh > EPS) sheet.cuts.push({ kind: 'rip', at: r.y + b, from: r.x, to: r.x + r.w, origin: r.y });
      if (dw > EPS) sheet.cuts.push({ kind: 'cross', at: r.x + a, from: r.y, to: r.y + b, origin: r.x });
      keepFree(sheet, { x: r.x, y: r.y + b, w: r.w, h: dh }, minSide);
      keepFree(sheet, { x: r.x + a, y: r.y, w: dw, h: b }, minSide);
    } else {
      if (dw > EPS) sheet.cuts.push({ kind: 'cross', at: r.x + a, from: r.y, to: r.y + r.h, origin: r.x });
      if (dh > EPS) sheet.cuts.push({ kind: 'rip', at: r.y + b, from: r.x, to: r.x + a, origin: r.y });
      keepFree(sheet, { x: r.x + a, y: r.y, w: dw, h: r.h }, minSide);
      keepFree(sheet, { x: r.x, y: r.y + b, w: a, h: dh }, minSide);
    }
  }

  /* Packs items[from..] onto one fresh sheet of a stock type and returns
     the part area placed. Used to compare stock types. */
  function trialFill(items, from, st, h, ctx) {
    var sheet = newSheet(st);
    for (var i = from; i < items.length; i += 1) {
      var spot = bestSpot(sheet, items[i], ctx.kerf, h.fit, ctx.minSide, ctx.counter);
      if (spot) place(sheet, items[i], spot, h.split, ctx.kerf, ctx.minSide);
    }
    return sheet.partArea;
  }

  function chooseStock(items, i, h, ctx, remaining) {
    var item = items[i];
    var choice = null;
    var bestValue = -Infinity;
    ctx.stocks.forEach(function (st) {
      if (remaining[st.index] === 0 || !fitsStock(item, st, ctx.kerf)) return;
      var value;
      if (h.stock === 'small') value = -st.area;
      else if (h.stock === 'large') value = st.area;
      else value = ctx.stocks.length > 1 ? trialFill(items, i, st, h, ctx) / st.area : 0;
      if (value > bestValue + EPS) { bestValue = value; choice = st; }
    });
    return choice;
  }

  /* One packing run for one ordering of the items and one heuristic. */
  function packRun(items, h, ctx) {
    var sheets = [];
    var unplaced = [];
    var remaining = ctx.stocks.map(function (st) { return ctx.quantities[st.index]; });
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      var target = null;
      var spot = null;
      for (var s = 0; s < sheets.length; s += 1) {
        var found = bestSpot(sheets[s], item, ctx.kerf, h.fit, ctx.minSide, ctx.counter);
        if (found && (!spot || found.score < spot.score - EPS)) {
          spot = found;
          target = sheets[s];
          if (h.sheet === 'first') break;
        }
      }
      if (!spot) {
        var st = chooseStock(items, i, h, ctx, remaining);
        if (st) {
          if (remaining[st.index] !== null) remaining[st.index] -= 1;
          target = newSheet(st);
          sheets.push(target);
          spot = bestSpot(target, item, ctx.kerf, h.fit, ctx.minSide, ctx.counter);
        }
      }
      if (spot) place(target, item, spot, h.split, ctx.kerf, ctx.minSide);
      else unplaced.push(item);
    }
    return { sheets: sheets, unplaced: unplaced, heuristic: h };
  }

  function trimCutCount(sheet, trim) {
    return trim > EPS ? 4 : 0;
  }

  function rank(run, trim) {
    var cuts = 0;
    var area = 0;
    run.sheets.forEach(function (sh) {
      cuts += sh.cuts.length + trimCutCount(sh, trim);
      area += sh.stock.area;
    });
    var last = run.sheets.length ? run.sheets[run.sheets.length - 1] : null;
    return [run.unplaced.length, run.sheets.length, cuts, area, last ? last.partArea / last.stock.area : 0];
  }

  function better(a, b) {
    for (var i = 0; i < a.length; i += 1) {
      var tol = 1e-9 * Math.max(1, Math.abs(a[i]), Math.abs(b[i]));
      if (a[i] < b[i] - tol) return true;
      if (a[i] > b[i] + tol) return false;
    }
    return false;
  }

  function now() {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  }

  /* Turns the packer's inflated coordinates into physical millimeters on the
     sheet, measured from its corner. */
  function physicalSheet(sheet, kerf, trim, problem) {
    var st = sheet.stock;
    var placements = sheet.placed.map(function (p) {
      var part = problem.parts[p.part];
      return {
        part: p.part,
        x: trim + p.x,
        y: trim + p.y,
        w: p.a - kerf,
        h: p.b - kerf,
        rotated: p.rotated,
        length: part.length,
        width: part.width
      };
    });
    var cuts = [];
    if (trim > EPS) {
      cuts.push({ kind: 'trim', axis: 'y', blade: trim - kerf, span: [0, st.length], fence: trim, length: st.length });
      cuts.push({ kind: 'trim', axis: 'y', blade: st.width - trim, span: [0, st.length], fence: trim, length: st.length });
      cuts.push({ kind: 'trim', axis: 'x', blade: trim - kerf, span: [trim, st.width - trim], fence: trim, length: st.width - 2 * trim });
      cuts.push({ kind: 'trim', axis: 'x', blade: st.length - trim, span: [trim, st.width - trim], fence: trim, length: st.width - 2 * trim });
    }
    sheet.cuts.forEach(function (c) {
      var axis = c.kind === 'rip' ? 'y' : 'x';
      cuts.push({
        kind: c.kind,
        axis: axis,
        blade: trim + c.at - kerf,
        span: [trim + c.from, trim + c.to - kerf],
        fence: c.at - kerf - c.origin,
        length: c.to - c.from - kerf
      });
    });
    var waste = [];
    sheet.free.concat(sheet.scrap).forEach(function (r) {
      var w = r.w - kerf;
      var h = r.h - kerf;
      if (w > EPS && h > EPS) waste.push({ x: trim + r.x, y: trim + r.y, w: w, h: h });
    });
    waste.sort(function (a, b) { return b.w * b.h - a.w * a.h; });
    return {
      stock: st.index,
      length: st.length,
      width: st.width,
      placements: placements,
      cuts: cuts,
      offcuts: waste,
      partArea: sheet.partArea,
      area: st.area
    };
  }

  function signature(sheet) {
    return sheet.stock + '|' + sheet.placements.map(function (p) {
      return [p.part, p.x.toFixed(3), p.y.toFixed(3), p.rotated ? 1 : 0].join(',');
    }).join(';');
  }

  /* Solves a problem.
     problem = {
       stocks: [{ name, width, length, quantity (null = unlimited), grain }],
       parts:  [{ label, width, length, quantity, grain }],
       kerf, trim                   (mm)
     }
     options = { timeBudgetMs, workBudget } (optional)
     Returns { ok, errors } on bad input, otherwise
     { ok: true, sheets, groups, unplaced, stats }. */
  function solve(problem, options) {
    var errors = validateProblem(problem);
    if (errors.length) return { ok: false, errors: errors };
    options = options || {};
    var budgetMs = options.timeBudgetMs === undefined ? LIMITS.timeBudgetMs : options.timeBudgetMs;
    var workBudget = options.workBudget || LIMITS.workBudget;
    var kerf = problem.kerf;
    var trim = problem.trim;
    var stocks = problem.stocks.map(function (s, i) { return prepareStock(s, i, kerf, trim); });
    var quantities = problem.stocks.map(function (s) { return s.quantity === null ? null : s.quantity; });

    var base = [];
    var minSide = Infinity;
    problem.parts.forEach(function (q, pi) {
      for (var n = 0; n < q.quantity; n += 1) base.push({ part: pi, len: q.length, wid: q.width, grain: !!q.grain, seq: base.length });
      minSide = Math.min(minSide, Math.min(q.length, q.width) + kerf);
    });

    var counter = { work: 0 };
    var ctx = { stocks: stocks, quantities: quantities, kerf: kerf, minSide: minSide, counter: counter };
    var started = now();
    function spent() {
      return counter.work > workBudget || (budgetMs > 0 && now() - started > budgetMs);
    }

    var stockRules = stocks.length > 1 ? STOCK_RULES : ['fill'];
    var plan = [];
    Object.keys(SORTS).forEach(function (sortName) {
      FITS.forEach(function (fit) {
        SPLITS.forEach(function (split) {
          SHEET_RULES.forEach(function (sheetRule) {
            stockRules.forEach(function (stock) {
              plan.push({ sort: sortName, fit: fit, split: split, sheet: sheetRule, stock: stock });
            });
          });
        });
      });
    });

    var orders = {};
    function ordered(sortName) {
      if (!orders[sortName]) {
        var cmp = SORTS[sortName];
        orders[sortName] = base.slice().sort(function (a, b) { return cmp(a, b) || a.seq - b.seq; });
      }
      return orders[sortName];
    }

    var best = null;
    var bestRank = null;
    var runs = 0;
    function consider(run) {
      runs += 1;
      var r = rank(run, trim);
      if (!best || better(r, bestRank)) { best = run; bestRank = r; }
    }

    for (var k = 0; k < plan.length; k += 1) {
      if (k > 0 && spent()) break;
      consider(packRun(ordered(plan[k].sort), plan[k], ctx));
    }

    /* Seeded restarts. Each one perturbs the best ordering found so far by
       jittering the sort key, and tries a random heuristic. */
    var rng = mulberry32(hashString(JSON.stringify([problem.stocks, problem.parts, kerf, trim])));
    var restarts = 0;
    while (!spent() && restarts < 400 && base.length > 1) {
      restarts += 1;
      var h = {
        sort: best.heuristic.sort,
        fit: FITS[Math.floor(rng() * FITS.length)],
        split: SPLITS[Math.floor(rng() * SPLITS.length)],
        sheet: SHEET_RULES[Math.floor(rng() * SHEET_RULES.length)],
        stock: stockRules[Math.floor(rng() * stockRules.length)]
      };
      var jitter = 0.05 + rng() * 0.4;
      var keyed = ordered(h.sort).map(function (item, idx) {
        return { item: item, key: idx + (rng() - 0.5) * jitter * base.length * 0.25 };
      });
      keyed.sort(function (a, b) { return a.key - b.key; });
      consider(packRun(keyed.map(function (e) { return e.item; }), h, ctx));
    }

    var sheets = best.sheets.map(function (sh) { return physicalSheet(sh, kerf, trim, problem); });

    /* Identical sheets are drawn once with a count. */
    var groups = [];
    var bySig = {};
    sheets.forEach(function (sh, i) {
      var sig = signature(sh);
      if (bySig[sig] !== undefined) groups[bySig[sig]].sheets.push(i);
      else { bySig[sig] = groups.length; groups.push({ sheets: [i] }); }
    });

    var unplacedCount = {};
    best.unplaced.forEach(function (it) { unplacedCount[it.part] = (unplacedCount[it.part] || 0) + 1; });
    var unplaced = Object.keys(unplacedCount).map(function (pi) {
      pi = Number(pi);
      var item = { len: problem.parts[pi].length, wid: problem.parts[pi].width, grain: !!problem.parts[pi].grain };
      var fitsAny = stocks.some(function (st) { return fitsStock(item, st, kerf); });
      return { part: pi, count: unplacedCount[pi], reason: fitsAny ? 'stock' : 'size' };
    });

    var stockArea = 0;
    var partArea = 0;
    var cutCount = 0;
    var cutLength = 0;
    var perStock = problem.stocks.map(function () { return 0; });
    sheets.forEach(function (sh) {
      stockArea += sh.area;
      partArea += sh.partArea;
      perStock[sh.stock] += 1;
      sh.cuts.forEach(function (c) { cutCount += 1; cutLength += Math.max(0, c.length); });
    });

    return {
      ok: true,
      sheets: sheets,
      groups: groups,
      unplaced: unplaced,
      stats: {
        sheets: sheets.length,
        perStock: perStock,
        stockArea: stockArea,
        partArea: partArea,
        yield: stockArea ? partArea / stockArea : 0,
        cuts: cutCount,
        cutLength: cutLength,
        placed: base.length - best.unplaced.length,
        pieces: base.length,
        runs: runs,
        elapsedMs: now() - started
      }
    };
  }

  /* ---------- independent checking ---------- */

  /* Checks a solved layout against its problem without trusting the packer.
     It checks that parts sit inside the usable area, that no two parts are
     closer than one kerf, that grain is kept and counts are right, and it
     replays the cut list piece by piece, so that every cut spans a whole
     current piece and every part ends as a piece of exactly its size.
     Returns a list of problems, empty when the layout is sound. */
  function verify(problem, result) {
    var out = [];
    var kerf = problem.kerf;
    var trim = problem.trim;
    var tol = 1e-6;
    var counts = problem.parts.map(function () { return 0; });
    result.sheets.forEach(function (sh, si) {
      var stock = problem.stocks[sh.stock];
      sh.placements.forEach(function (p, i) {
        counts[p.part] += 1;
        var part = problem.parts[p.part];
        var expectW = p.rotated ? part.width : part.length;
        var expectH = p.rotated ? part.length : part.width;
        if (Math.abs(p.w - expectW) > tol || Math.abs(p.h - expectH) > tol) out.push('sheet ' + si + ' part ' + i + ' has the wrong size');
        if (p.rotated && part.grain && stock.grain) out.push('sheet ' + si + ' part ' + i + ' breaks the grain');
        if (p.x < trim - tol || p.y < trim - tol || p.x + p.w > stock.length - trim + tol || p.y + p.h > stock.width - trim + tol) out.push('sheet ' + si + ' part ' + i + ' is outside the usable area');
        for (var j = 0; j < i; j += 1) {
          var q = sh.placements[j];
          var gapX = Math.max(q.x - (p.x + p.w), p.x - (q.x + q.w));
          var gapY = Math.max(q.y - (p.y + p.h), p.y - (q.y + q.h));
          if (gapX < kerf - tol && gapY < kerf - tol) out.push('sheet ' + si + ' parts ' + j + ' and ' + i + ' are closer than one kerf');
        }
      });

      /* Replay. A piece is [x0, y0, x1, y1]. */
      var pieces = [[0, 0, stock.length, stock.width]];
      sh.cuts.forEach(function (c, ci) {
        var lo = c.span[0];
        var hi = c.span[1];
        var found = -1;
        for (var k = 0; k < pieces.length; k += 1) {
          var pc = pieces[k];
          var along0 = c.axis === 'y' ? pc[0] : pc[1];
          var along1 = c.axis === 'y' ? pc[2] : pc[3];
          var across0 = c.axis === 'y' ? pc[1] : pc[0];
          var across1 = c.axis === 'y' ? pc[3] : pc[2];
          if (Math.abs(along0 - lo) < tol && Math.abs(along1 - hi) < tol && c.blade + kerf > across0 + tol && c.blade < across1 - tol) { found = k; break; }
        }
        if (found === -1) { out.push('sheet ' + si + ' cut ' + ci + ' does not span a whole piece'); return; }
        var p0 = pieces[found];
        pieces.splice(found, 1);
        var a;
        var b;
        if (c.axis === 'y') {
          a = [p0[0], p0[1], p0[2], Math.min(p0[3], c.blade)];
          b = [p0[0], Math.max(p0[1], c.blade + kerf), p0[2], p0[3]];
        } else {
          a = [p0[0], p0[1], Math.min(p0[2], c.blade), p0[3]];
          b = [Math.max(p0[0], c.blade + kerf), p0[1], p0[2], p0[3]];
        }
        [a, b].forEach(function (pc) { if (pc[2] - pc[0] > tol && pc[3] - pc[1] > tol) pieces.push(pc); });
        sh.placements.forEach(function (p, pi) {
          var bx0 = c.axis === 'x' ? c.blade : lo;
          var bx1 = c.axis === 'x' ? c.blade + kerf : hi;
          var by0 = c.axis === 'y' ? c.blade : lo;
          var by1 = c.axis === 'y' ? c.blade + kerf : hi;
          if (bx0 < p.x + p.w - tol && bx1 > p.x + tol && by0 < p.y + p.h - tol && by1 > p.y + tol) out.push('sheet ' + si + ' cut ' + ci + ' runs through part ' + pi);
        });
      });
      sh.placements.forEach(function (p, pi) {
        var match = pieces.some(function (pc) {
          return Math.abs(pc[0] - p.x) < tol && Math.abs(pc[1] - p.y) < tol && Math.abs(pc[2] - (p.x + p.w)) < tol && Math.abs(pc[3] - (p.y + p.h)) < tol;
        });
        if (!match) out.push('sheet ' + si + ' part ' + pi + ' is not a separate piece after the cuts');
      });
    });
    var unplaced = problem.parts.map(function () { return 0; });
    result.unplaced.forEach(function (u) { unplaced[u.part] += u.count; });
    problem.parts.forEach(function (q, i) {
      if (counts[i] + unplaced[i] !== q.quantity) out.push('part ' + i + ' count is ' + counts[i] + ' placed plus ' + unplaced[i] + ' unplaced, expected ' + q.quantity);
    });
    var perStock = problem.stocks.map(function () { return 0; });
    result.sheets.forEach(function (sh) { perStock[sh.stock] += 1; });
    problem.stocks.forEach(function (s, i) {
      if (s.quantity !== null && perStock[i] > s.quantity) out.push('stock ' + i + ' used ' + perStock[i] + ' times, only ' + s.quantity + ' available');
    });
    return out;
  }

  return {
    LIMITS: LIMITS,
    MM_PER: MM_PER,
    parseLength: parseLength,
    formatLength: formatLength,
    validateProblem: validateProblem,
    solve: solve,
    verify: verify
  };
});
