/* Charts for the Chess Tournament analysis view.
 *
 * Every figure is inline SVG built with createElementNS and textContent, so
 * no markup is ever assembled from a string and no plotting library is
 * loaded. The numbers come from ChessTournament.analysis(); nothing here
 * computes a statistic.
 *
 * Colors are set as CSS custom properties rather than literal hex, so a
 * figure follows the reader's palette and dark mode with no redraw. The
 * tokens live in chess-tournament.css:
 *   --ct-series-1  the one data hue (blue)
 *   --ct-series-2  the second hue, only where two things are contrasted
 *   --ct-neutral   the neutral midpoint of the White/draw/Black bar
 *   --ct-dim       de-emphasized context marks
 *   --ct-grid      hairline gridlines and axes
 *
 * Every chart ships a table underneath with the same numbers, so nothing is
 * reachable only by hovering.
 *
 * Exposed as window.ChessTournamentCharts.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module && module.exports) module.exports = factory();
  else root.ChessTournamentCharts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  /* A chart drawn wider than this is not more readable, only larger. */
  var MAX_WIDTH = 720;
  /* The confidence-interval figure gets one row per player, so it is capped
     and the table below carries everyone. */
  var MAX_RATING_ROWS = 30;
  var MAX_PROGRESSION_LINES = 40;
  /* Pointer targets are widened to this, well past the mark itself. */
  var HIT_MIN = 24;

  function el(name, attrs, styles) {
    var node = document.createElementNS(NS, name);
    if (attrs) Object.keys(attrs).forEach(function (key) { node.setAttribute(key, String(attrs[key])); });
    if (styles) Object.keys(styles).forEach(function (key) { node.style.setProperty(key, styles[key]); });
    return node;
  }

  function html(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function text(x, y, value, options) {
    var o = options || {};
    var node = el('text', {
      x: x, y: y,
      'text-anchor': o.anchor || 'start',
      'dominant-baseline': o.baseline || 'auto',
      'font-size': o.size || 11
    }, { fill: o.color || 'var(--ct-ink-muted)' });
    if (o.weight) node.style.setProperty('font-weight', o.weight);
    node.textContent = String(value);
    return node;
  }

  function frame(width, height) {
    var svg = el('svg', {
      viewBox: '0 0 ' + width + ' ' + height,
      role: 'img',
      preserveAspectRatio: 'xMidYMid meet'
    }, { width: '100%', height: 'auto', 'max-width': MAX_WIDTH + 'px', display: 'block', overflow: 'visible' });
    return svg;
  }

  function gridLine(x1, y1, x2, y2) {
    return el('line', { x1: x1, y1: y1, x2: x2, y2: y2, 'stroke-width': 1 }, { stroke: 'var(--ct-grid)' });
  }

  function niceStep(span, target) {
    var raw = span / Math.max(1, target);
    var mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    var norm = raw / mag;
    var step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return step * mag;
  }

  function fmt(n, digits) {
    if (!Number.isFinite(n)) return '';
    var d = digits === undefined ? 0 : digits;
    return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function percent(n, digits) { return fmt(n * 100, digits === undefined ? 1 : digits) + '%'; }

  function points(n) {
    if (!Number.isFinite(n)) return '';
    var whole = Math.floor(n);
    var half = n - whole >= 0.5;
    if (whole === 0 && half) return '½';
    return String(whole) + (half ? '½' : '');
  }

  function label(p) { return p.tag ? p.name + ' (' + p.tag + ')' : p.name; }

  /* ------------------------------ tooltip ------------------------------ */

  /* One tooltip element per chart card, shown on pointer and on keyboard
     focus so the two reach the same content. */
  function tooltipFor(container) {
    var tip = html('div', 'ct-tip');
    tip.hidden = true;
    container.appendChild(tip);
    return {
      show: function (node, lines) {
        tip.replaceChildren();
        lines.forEach(function (line) { tip.appendChild(html('div', null, line)); });
        tip.hidden = false;
        var box = node.getBoundingClientRect();
        var host = container.getBoundingClientRect();
        var left = box.left - host.left + box.width / 2;
        tip.style.left = Math.max(4, Math.min(host.width - 4, left)) + 'px';
        tip.style.top = Math.max(0, box.top - host.top - 8) + 'px';
      },
      hide: function () { tip.hidden = true; }
    };
  }

  /* An invisible rectangle that carries the pointer and keyboard target, so
     a thin bar or a small dot is still comfortable to reach. */
  function hit(svg, tip, rect, lines, describe) {
    var node = el('rect', {
      x: rect.x, y: rect.y,
      width: Math.max(HIT_MIN, rect.width),
      height: Math.max(HIT_MIN, rect.height),
      tabindex: 0, role: 'img'
    }, { fill: 'transparent', outline: 'none', cursor: 'default' });
    node.appendChild(el('title')).textContent = describe;
    node.addEventListener('pointerenter', function () { tip.show(node, lines); });
    node.addEventListener('pointerleave', function () { tip.hide(); });
    node.addEventListener('focus', function () { tip.show(node, lines); });
    node.addEventListener('blur', function () { tip.hide(); });
    svg.appendChild(node);
    return node;
  }

  /* ------------------------------ card parts ------------------------------ */

  function legend(items) {
    var box = html('div', 'ct-legend');
    items.forEach(function (item) {
      var entry = html('span', 'ct-legend-item');
      var swatch = html('span', 'ct-legend-swatch');
      swatch.style.background = item.color;
      if (item.line) {
        swatch.style.height = '2px';
        swatch.style.borderRadius = '0';
      }
      entry.appendChild(swatch);
      entry.appendChild(html('span', null, item.text));
      box.appendChild(entry);
    });
    return box;
  }

  /* The table twin every figure carries. */
  function tableView(caption, headers, rows, aligns) {
    var box = html('details', 'ct-table-view');
    box.appendChild(html('summary', null, caption));
    var wrap = html('div', 'ct-table-wrap');
    var table = html('table', 'ct-table');
    var head = document.createElement('tr');
    headers.forEach(function (headText, i) {
      var th = html('th', (aligns && aligns[i] === 'num') ? 'ct-num' : null, headText);
      head.appendChild(th);
    });
    var thead = document.createElement('thead');
    thead.appendChild(head);
    table.appendChild(thead);
    var body = document.createElement('tbody');
    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      row.forEach(function (cell, i) {
        tr.appendChild(html('td', (aligns && aligns[i] === 'num') ? 'ct-num' : null, cell));
      });
      body.appendChild(tr);
    });
    table.appendChild(body);
    wrap.appendChild(table);
    box.appendChild(wrap);
    return box;
  }

  function note(textValue) { return html('p', 'tool-note', textValue); }

  function empty(container, message) {
    container.replaceChildren(note(message));
  }

  /* ------------------------------ stat tiles ------------------------------ */

  function statTiles(container, tiles) {
    container.replaceChildren();
    var row = html('div', 'ct-tiles');
    tiles.forEach(function (tile) {
      var box = html('div', 'ct-tile');
      box.appendChild(html('div', 'ct-tile-label', tile.label));
      box.appendChild(html('div', 'ct-tile-value', tile.value));
      if (tile.note) box.appendChild(html('div', 'ct-tile-note', tile.note));
      row.appendChild(box);
    });
    container.appendChild(row);
  }

  /* ------------------------------ score distribution ------------------------------ */

  /* Columns of how many players finished on each score, with a thin
     reference curve for the spread chance alone would produce. */
  function scoreDistribution(container, data) {
    container.replaceChildren();
    var bins = data.histogram.bins;
    /* Before a round is played every player sits on zero, which is a chart
       of nothing. */
    if (!data.histogram.players || bins.length < 2 || !data.games.rated) {
      empty(container, 'No results yet.');
      return;
    }
    var tip = tooltipFor(container);
    var W = 720;
    var H = 260;
    var pad = { top: 16, right: 16, bottom: 42, left: 44 };
    var plotW = W - pad.left - pad.right;
    var plotH = H - pad.top - pad.bottom;
    var svg = frame(W, H);
    svg.setAttribute('aria-label', 'How many players finished on each score');

    var maxCount = bins.reduce(function (a, b) { return Math.max(a, b.count); }, 0);
    var chance = data.spread;
    var curve = [];
    if (chance && chance.chanceSd > 0) {
      var mean = data.histogram.mean;
      var sd = chance.chanceSd;
      for (var i = 0; i < bins.length; i += 1) {
        var s = bins[i].score;
        var density = Math.exp(-0.5 * Math.pow((s - mean) / sd, 2)) / (sd * Math.sqrt(2 * Math.PI));
        curve.push(density * 0.5 * data.histogram.players);
      }
      maxCount = Math.max(maxCount, curve.reduce(function (a, b) { return Math.max(a, b); }, 0));
    }
    var top = Math.max(1, Math.ceil(maxCount));
    /* Players are counted, so the axis steps in whole players; a half-step
       would print the same label twice. */
    var step = Math.max(1, Math.round(niceStep(top, 4)));
    var yMax = Math.ceil(top / step) * step;
    var y = function (v) { return pad.top + plotH - (v / yMax) * plotH; };
    var band = plotW / bins.length;
    var barW = Math.min(24, band - 4);

    for (var g = 0; g <= yMax + 1e-9; g += step) {
      svg.appendChild(gridLine(pad.left, y(g), pad.left + plotW, y(g)));
      svg.appendChild(text(pad.left - 8, y(g), fmt(g), { anchor: 'end', baseline: 'middle' }));
    }
    var yTitle = text(0, 0, 'Players', { anchor: 'middle', baseline: 'middle' });
    yTitle.setAttribute('transform', 'translate(13,' + (pad.top + plotH / 2) + ') rotate(-90)');
    svg.appendChild(yTitle);

    bins.forEach(function (bin, i) {
      var cx = pad.left + band * i + band / 2;
      if (bin.count > 0) {
        var height = (bin.count / yMax) * plotH;
        svg.appendChild(el('rect', {
          x: cx - barW / 2, y: y(bin.count), width: barW, height: height,
          rx: Math.min(4, barW / 2), ry: Math.min(4, height)
        }, { fill: 'var(--ct-series-1)' }));
        /* The rounded end belongs at the top only, so the baseline stays
           square: a second rectangle squares off the bottom. */
        if (height > 4) {
          svg.appendChild(el('rect', { x: cx - barW / 2, y: y(bin.count) + 4, width: barW, height: height - 4 }, { fill: 'var(--ct-series-1)' }));
        }
      }
      if (bins.length <= 24 || i % 2 === 0) {
        svg.appendChild(text(cx, pad.top + plotH + 16, points(bin.score), { anchor: 'middle' }));
      }
      hit(svg, tip, { x: cx - band / 2, y: pad.top, width: band, height: plotH },
        [points(bin.score) + (bin.score === 1 ? ' point' : ' points'), bin.count + (bin.count === 1 ? ' player' : ' players')],
        bin.count + ' players on ' + points(bin.score));
    });

    if (curve.length) {
      var path = curve.map(function (v, i) {
        return (i ? 'L' : 'M') + (pad.left + band * i + band / 2).toFixed(1) + ' ' + y(v).toFixed(1);
      }).join(' ');
      svg.appendChild(el('path', { d: path, fill: 'none', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, { stroke: 'var(--ct-neutral)' }));
    }

    svg.appendChild(gridLine(pad.left, pad.top + plotH, pad.left + plotW, pad.top + plotH));
    svg.appendChild(text(pad.left + plotW / 2, H - 6, 'Final score', { anchor: 'middle' }));
    container.appendChild(svg);

    if (curve.length) {
      container.appendChild(legend([
        { color: 'var(--ct-series-1)', text: 'Players on that score' },
        { color: 'var(--ct-neutral)', text: 'Spread chance alone would give', line: true }
      ]));
    }
    container.appendChild(tableView('Score distribution as a table',
      ['Score', 'Players'],
      bins.filter(function (b) { return b.count > 0; }).map(function (b) { return [points(b.score), String(b.count)]; }),
      [null, 'num']));
  }

  /* ------------------------------ rating intervals ------------------------------ */

  /* One row per player: the fitted rating as a dot, the replay range as a
     line through it. The point of the figure is how wide those lines are. */
  function ratingIntervals(container, data, options) {
    container.replaceChildren();
    var all = data.ratings.filter(function (r) { return r.games > 0 && r.se !== null; });
    if (all.length < 2) {
      empty(container, 'At least two players need a rated game before ratings can be estimated.');
      return;
    }
    var rows = all.slice(0, MAX_RATING_ROWS);
    var tip = tooltipFor(container);
    var W = 720;
    var rowH = 20;
    var pad = { top: 28, right: 54, bottom: 34, left: 150 };
    var plotH = rows.length * rowH;
    var H = pad.top + plotH + pad.bottom;
    var plotW = W - pad.left - pad.right;
    var svg = frame(W, H);
    svg.setAttribute('aria-label', 'Fitted rating and its replay range for each player');

    var lo = Math.min.apply(null, rows.map(function (r) { return r.low; }));
    var hi = Math.max.apply(null, rows.map(function (r) { return r.high; }));
    var pad10 = Math.max(20, (hi - lo) * 0.05);
    lo -= pad10;
    hi += pad10;
    var step = niceStep(hi - lo, 5);
    var first = Math.ceil(lo / step) * step;
    var x = function (v) { return pad.left + ((v - lo) / (hi - lo)) * plotW; };

    for (var g = first; g <= hi; g += step) {
      svg.appendChild(gridLine(x(g), pad.top - 6, x(g), pad.top + plotH));
      svg.appendChild(text(x(g), pad.top - 10, fmt(g), { anchor: 'middle' }));
    }

    rows.forEach(function (row, i) {
      var cy = pad.top + i * rowH + rowH / 2;
      svg.appendChild(text(pad.left - 10, cy, label(row), { anchor: 'end', baseline: 'middle', color: 'var(--ct-ink)' }));
      svg.appendChild(el('line', {
        x1: x(row.low), y1: cy, x2: x(row.high), y2: cy,
        'stroke-width': 2, 'stroke-linecap': 'round'
      }, { stroke: 'var(--ct-series-1)', opacity: 0.45 }));
      svg.appendChild(el('circle', { cx: x(row.value), cy: cy, r: 4.5, 'stroke-width': 2 }, { fill: 'var(--ct-series-1)', stroke: 'var(--ct-surface)' }));
      svg.appendChild(text(pad.left + plotW + 8, cy, fmt(row.value), { baseline: 'middle', color: 'var(--ct-ink)' }));
      hit(svg, tip, { x: pad.left, y: cy - rowH / 2, width: plotW, height: rowH }, [
        label(row),
        'Rating ' + fmt(row.value) + ', give or take ' + fmt(1.96 * row.se),
        'Replay range ' + fmt(row.low) + ' to ' + fmt(row.high),
        row.games + (row.games === 1 ? ' rated game' : ' rated games')
      ], label(row) + ': rating ' + fmt(row.value) + ', replay range ' + fmt(row.low) + ' to ' + fmt(row.high));
    });

    svg.appendChild(text(pad.left + plotW / 2, H - 6, options && options.axisLabel ? options.axisLabel : 'Rating', { anchor: 'middle' }));
    container.appendChild(svg);
    if (all.length > rows.length) {
      container.appendChild(note('Showing the top ' + rows.length + ' of ' + all.length + ' players. The table has everyone.'));
    }
    container.appendChild(tableView('Ratings and replay ranges as a table',
      ['Player', 'Rating', 'Give or take', 'Low', 'High', 'Games'],
      all.map(function (r) {
        return [label(r), fmt(r.value), '±' + fmt(1.96 * r.se), fmt(r.low), fmt(r.high), String(r.games)];
      }),
      [null, 'num', 'num', 'num', 'num', 'num']));
  }

  /* ------------------------------ colour balance ------------------------------ */

  /* A single bar split White wins / draws / Black wins. The draw is the
     neutral middle, so the two ends read as the two opposite outcomes. */
  function colorBalance(container, color) {
    container.replaceChildren();
    if (!color || !color.games) {
      empty(container, 'No rated games yet.');
      return;
    }
    var tip = tooltipFor(container);
    var W = 720;
    var H = 96;
    var pad = { left: 0, right: 0, top: 26 };
    var barH = 28;
    var svg = frame(W, H);
    svg.setAttribute('aria-label', 'How the rated games finished, by colour');
    var segments = [
      { n: color.whiteWins, text: 'White wins', fill: 'var(--ct-series-1)' },
      { n: color.draws, text: 'Draws', fill: 'var(--ct-neutral)' },
      { n: color.blackWins, text: 'Black wins', fill: 'var(--ct-series-2)' }
    ];
    var x = 0;
    segments.forEach(function (segment, i) {
      var w = (segment.n / color.games) * W;
      if (w > 0) {
        /* A 2px gap in the surface colour separates the segments; no stroke
           is drawn around them. */
        var drawW = Math.max(0, w - (i < segments.length - 1 ? 2 : 0));
        svg.appendChild(el('rect', { x: x, y: pad.top, width: drawW, height: barH, rx: 2 }, { fill: segment.fill }));
      }
      hit(svg, tip, { x: x, y: pad.top, width: Math.max(1, w), height: barH },
        [segment.text, segment.n + (segment.n === 1 ? ' game' : ' games'), percent(segment.n / color.games)],
        segment.text + ': ' + segment.n + ' games');
      x += w;
    });
    /* The shares are written above the bar rather than inside the fills. A
       label on a saturated fill cannot clear text contrast at this size in
       both palettes, and the number matters more than the placement. */
    var share = function (segment) { return segment.text + ' ' + percent(segment.n / color.games, 0); };
    svg.appendChild(text(0, 14, share(segments[0]), { color: 'var(--ct-ink)', weight: 600 }));
    svg.appendChild(text(W / 2, 14, share(segments[1]), { anchor: 'middle', color: 'var(--ct-ink)', weight: 600 }));
    svg.appendChild(text(W, 14, share(segments[2]), { anchor: 'end', color: 'var(--ct-ink)', weight: 600 }));
    container.appendChild(svg);
    container.appendChild(tableView('Results by colour as a table',
      ['Outcome', 'Games', 'Share'],
      segments.map(function (s) { return [s.text, String(s.n), percent(s.n / color.games)]; }),
      [null, 'num', 'num']));
  }

  /* ------------------------------ calibration ------------------------------ */

  /* For each band of rating difference, what the stronger player was
     predicted to score against what they did score. */
  function calibration(container, buckets) {
    container.replaceChildren();
    var rows = buckets.filter(function (b) { return b.games >= 5; });
    if (rows.length < 2) {
      empty(container, 'Not enough games yet. This figure needs at least two bands of rating difference with five games each.');
      return;
    }
    var tip = tooltipFor(container);
    var W = 720;
    var H = 288;
    var pad = { top: 16, right: 16, bottom: 74, left: 46 };
    var plotW = W - pad.left - pad.right;
    var plotH = H - pad.top - pad.bottom;
    var svg = frame(W, H);
    svg.setAttribute('aria-label', 'Predicted against actual score for the stronger player, by rating difference');
    /* The scale follows the data rather than starting at a fixed floor, so a
       band where the stronger player did badly is still on the chart. */
    var lowest = rows.reduce(function (a, b) { return Math.min(a, b.observed, b.expected); }, 1);
    var base = Math.max(0, Math.min(0.4, Math.floor((lowest - 0.05) * 10) / 10));
    var y = function (v) { return pad.top + plotH - ((v - base) / (1 - base)) * plotH; };
    for (var g = base; g <= 1.0001; g += 0.1) {
      svg.appendChild(gridLine(pad.left, y(g), pad.left + plotW, y(g)));
      svg.appendChild(text(pad.left - 8, y(g), percent(g, 0), { anchor: 'end', baseline: 'middle' }));
    }
    var band = plotW / rows.length;
    var predicted = [];
    rows.forEach(function (row, i) {
      var cx = pad.left + band * i + band / 2;
      predicted.push([cx, y(row.expected)]);
      svg.appendChild(text(cx, pad.top + plotH + 16, row.label, { anchor: 'middle' }));
      svg.appendChild(text(cx, pad.top + plotH + 30, row.games + (row.games === 1 ? ' game' : ' games'), { anchor: 'middle' }));
      var oy = y(row.observed);
      svg.appendChild(el('circle', { cx: cx, cy: oy, r: 5, 'stroke-width': 2 }, { fill: 'var(--ct-series-1)', stroke: 'var(--ct-surface)' }));
      hit(svg, tip, { x: cx - band / 2, y: pad.top, width: band, height: plotH }, [
        'Rating difference ' + row.label,
        'Predicted ' + percent(row.expected),
        'Actual ' + percent(row.observed),
        row.games + (row.games === 1 ? ' game' : ' games')
      ], 'Difference ' + row.label + ': predicted ' + percent(row.expected) + ', actual ' + percent(row.observed));
    });
    var line = predicted.map(function (pt, i) { return (i ? 'L' : 'M') + pt[0].toFixed(1) + ' ' + pt[1].toFixed(1); }).join(' ');
    svg.appendChild(el('path', { d: line, fill: 'none', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, { stroke: 'var(--ct-neutral)' }));
    predicted.forEach(function (pt) {
      svg.appendChild(el('circle', { cx: pt[0], cy: pt[1], r: 4, 'stroke-width': 2 }, { fill: 'var(--ct-neutral)', stroke: 'var(--ct-surface)' }));
    });
    svg.appendChild(gridLine(pad.left, pad.top + plotH, pad.left + plotW, pad.top + plotH));
    svg.appendChild(text(pad.left + plotW / 2, H - 8, 'Rating difference between the two players', { anchor: 'middle' }));
    container.appendChild(svg);
    container.appendChild(legend([
      { color: 'var(--ct-series-1)', text: 'What the stronger player actually scored' },
      { color: 'var(--ct-neutral)', text: 'What the rating gap predicted', line: true }
    ]));
    container.appendChild(tableView('Prediction against result as a table',
      ['Rating difference', 'Games', 'Predicted', 'Actual'],
      rows.map(function (r) { return [r.label, String(r.games), percent(r.expected), percent(r.observed)]; }),
      [null, 'num', 'num', 'num']));
  }

  /* ------------------------------ progression ------------------------------ */

  /* Every player's running rating round by round. One player is drawn in
     the data hue and the rest recede, so a single line can be followed. */
  function progression(container, data, selectedId) {
    container.replaceChildren();
    var lines = data.progression.filter(function (line) { return line.values.length > 1; });
    if (!lines.length || data.rounds < 1) {
      empty(container, 'No rounds have been played yet.');
      return;
    }
    var tip = tooltipFor(container);
    var W = 720;
    var H = 280;
    var pad = { top: 16, right: 96, bottom: 40, left: 52 };
    var plotW = W - pad.left - pad.right;
    var plotH = H - pad.top - pad.bottom;
    var svg = frame(W, H);
    svg.setAttribute('aria-label', 'Running rating of each player after every round');
    var shown = lines.slice(0, MAX_PROGRESSION_LINES);
    var selected = shown.filter(function (line) { return line.id === selectedId; })[0] || null;
    var all = [];
    shown.forEach(function (line) { line.values.forEach(function (v) { all.push(v); }); });
    var lo = Math.min.apply(null, all);
    var hi = Math.max.apply(null, all);
    if (hi - lo < 20) { lo -= 10; hi += 10; }
    var margin = (hi - lo) * 0.08;
    lo -= margin;
    hi += margin;
    var step = niceStep(hi - lo, 4);
    var y = function (v) { return pad.top + plotH - ((v - lo) / (hi - lo)) * plotH; };
    var x = function (r) { return pad.left + (r / data.rounds) * plotW; };

    for (var g = Math.ceil(lo / step) * step; g <= hi; g += step) {
      svg.appendChild(gridLine(pad.left, y(g), pad.left + plotW, y(g)));
      svg.appendChild(text(pad.left - 8, y(g), fmt(g), { anchor: 'end', baseline: 'middle' }));
    }
    for (var r = 0; r <= data.rounds; r += 1) {
      svg.appendChild(text(x(r), pad.top + plotH + 16, r === 0 ? 'Start' : String(r), { anchor: 'middle' }));
    }

    function pathFor(line) {
      return line.values.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join(' ');
    }

    shown.forEach(function (line) {
      if (selected && line.id === selected.id) return;
      svg.appendChild(el('path', {
        d: pathFor(line), fill: 'none', 'stroke-width': selected ? 1.5 : 2,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round'
      }, { stroke: selected ? 'var(--ct-dim)' : 'var(--ct-series-1)', opacity: selected ? 0.6 : 0.55 }));
    });
    if (selected) {
      svg.appendChild(el('path', {
        d: pathFor(selected), fill: 'none', 'stroke-width': 2,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round'
      }, { stroke: 'var(--ct-series-1)' }));
      var last = selected.values[selected.values.length - 1];
      svg.appendChild(el('circle', { cx: x(data.rounds), cy: y(last), r: 4.5, 'stroke-width': 2 }, { fill: 'var(--ct-series-1)', stroke: 'var(--ct-surface)' }));
      svg.appendChild(text(x(data.rounds) + 10, y(last), fmt(last), { baseline: 'middle', color: 'var(--ct-ink)', weight: 600 }));
      svg.appendChild(text(x(data.rounds) + 10, y(last) + 13, label(selected), { baseline: 'middle' }));
      selected.values.forEach(function (v, i) {
        hit(svg, tip, { x: x(i) - 12, y: y(v) - 12, width: 24, height: 24 }, [
          label(selected),
          i === 0 ? 'Start' : 'After round ' + i,
          'Rating ' + fmt(v)
        ], label(selected) + (i === 0 ? ' start ' : ' after round ' + i + ' ') + fmt(v));
      });
    }
    svg.appendChild(gridLine(pad.left, pad.top + plotH, pad.left + plotW, pad.top + plotH));
    svg.appendChild(text(pad.left + plotW / 2, H - 4, 'Round', { anchor: 'middle' }));
    container.appendChild(svg);
    if (lines.length > shown.length) {
      container.appendChild(note('Showing ' + shown.length + ' of ' + lines.length + ' players.'));
    }
    var headers = ['Player', 'Start'];
    for (var h = 1; h <= data.rounds; h += 1) headers.push('R' + h);
    container.appendChild(tableView('Ratings round by round as a table', headers,
      shown.map(function (line) { return [label(line)].concat(line.values.map(function (v) { return fmt(v); })); }),
      headers.map(function (_, i) { return i === 0 ? null : 'num'; })));
  }

  return {
    MAX_RATING_ROWS: MAX_RATING_ROWS,
    statTiles: statTiles,
    scoreDistribution: scoreDistribution,
    ratingIntervals: ratingIntervals,
    colorBalance: colorBalance,
    calibration: calibration,
    progression: progression
  };
});
