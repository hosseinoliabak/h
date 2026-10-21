/* QR Code tool: live codes in several versions, single-code PNG and SVG
   downloads, and a print sheet that repeats one code in a chosen grid.
   Every element is built with createElement or createElementNS, and user
   text only ever reaches textContent, an input value, or the QR encoder. */
(function () {
  'use strict';

  var grid = document.getElementById('qr-grid');
  if (typeof QRCode === 'undefined' || typeof QRCode.create !== 'function') {
    grid.replaceChildren(emptyNote('Failed to load the QR library. Try refreshing.', true));
    return;
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var XLINK_NS = 'http://www.w3.org/1999/xlink';
  var RENDER_SIZE = 300;
  var QUIET_ZONE = 4;                 // modules of white border, as the QR standard asks
  var DOWNLOAD_URL_LIFETIME_MS = 30000;
  var LABEL_FONT = 'Helvetica, Arial, sans-serif';

  // Paper sizes in millimeters, portrait.
  var PAPERS = {
    a4: { name: 'A4', w: 210, h: 297 },
    letter: { name: 'Letter', w: 215.9, h: 279.4 },
    legal: { name: 'Legal', w: 215.9, h: 355.6 },
    a3: { name: 'A3', w: 297, h: 420 },
    a5: { name: 'A5', w: 148, h: 210 }
  };
  var LIMITS = {
    cells: { min: 1, max: 20 },
    paper: { min: 50, max: 1200 },
    margin: { min: 0, max: 50 },
    gap: { min: 0, max: 30 },
    label: 80
  };

  var formatSelect = document.getElementById('qr-format');
  var allFields = document.querySelectorAll('.format-fields');

  function emptyNote(text, isError) {
    var note = document.createElement('div');
    note.id = 'qr-empty';
    note.textContent = text;
    if (isError) note.style.color = '#dc3545';
    return note;
  }

  formatSelect.addEventListener('change', function () {
    allFields.forEach(function (f) { f.classList.remove('active'); });
    document.getElementById('fields-' + formatSelect.value).classList.add('active');
  });

  function value(id) { return document.getElementById(id).value; }

  function getPayload() {
    switch (formatSelect.value) {
      case 'text':
        return value('input-text');
      case 'wifi': {
        var ssid = value('wifi-ssid');
        if (!ssid) return '';
        var hidden = document.getElementById('wifi-hidden').checked;
        return 'WIFI:T:' + value('wifi-enc') + ';S:' + ssid + ';P:' + value('wifi-pass') + ';H:' + (hidden ? 'true' : 'false') + ';;';
      }
      case 'vcard': {
        var name = value('vcard-name'), phone = value('vcard-phone'), email = value('vcard-email');
        var org = value('vcard-org'), url = value('vcard-url');
        if (!name && !phone && !email) return '';
        var vcard = 'BEGIN:VCARD\nVERSION:3.0\n';
        if (name) vcard += 'FN:' + name + '\n';
        if (phone) vcard += 'TEL:' + phone + '\n';
        if (email) vcard += 'EMAIL:' + email + '\n';
        if (org) vcard += 'ORG:' + org + '\n';
        if (url) vcard += 'URL:' + url + '\n';
        return vcard + 'END:VCARD';
      }
      case 'email': {
        var to = value('email-to');
        if (!to) return '';
        var params = [];
        if (value('email-subject')) params.push('subject=' + encodeURIComponent(value('email-subject')));
        if (value('email-body')) params.push('body=' + encodeURIComponent(value('email-body')));
        return 'mailto:' + to + (params.length ? '?' + params.join('&') : '');
      }
      case 'sms': {
        var number = value('sms-number');
        if (!number) return '';
        return 'smsto:' + number + ':' + value('sms-body');
      }
      case 'phone': {
        var num = value('phone-number');
        return num ? 'tel:' + num : '';
      }
      default:
        return '';
    }
  }

  function getECL() {
    var checked = document.querySelector('input[name="ecl"]:checked');
    return checked ? checked.value : 'M';
  }

  function getVersion() {
    var checked = document.querySelector('input[name="ver"]:checked');
    return checked ? checked.value : 'auto';
  }

  // Encodes the payload, or returns null when it does not fit the version.
  function encode(payload, ecl, version) {
    var opts = { errorCorrectionLevel: ecl };
    if (version !== 'auto') opts.version = parseInt(version, 10);
    try {
      return QRCode.create(payload, opts);
    } catch (e) {
      return null;
    }
  }

  // One SVG path for the dark modules in module units, with each row's
  // horizontal runs merged so adjacent modules never show a hairline seam.
  function modulePath(qr) {
    var size = qr.modules.size, data = qr.modules.data, d = [];
    for (var r = 0; r < size; r++) {
      var c = 0;
      while (c < size) {
        if (!data[r * size + c]) { c++; continue; }
        var start = c;
        while (c < size && data[r * size + c]) c++;
        d.push('M' + (start + QUIET_ZONE) + ' ' + (r + QUIET_ZONE) + 'h' + (c - start) + 'v1h-' + (c - start) + 'z');
      }
    }
    return d.join('');
  }

  function svgEl(name, attrs) {
    var el = document.createElementNS(SVG_NS, name);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, String(attrs[k])); });
    return el;
  }

  function serialize(svg) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
  }

  // Filenames come only from fixed words and validated numbers.
  function safeSlug(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'qrcode';
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.download = safeSlug(filename.replace(/\.[a-z]+$/, '')) + filename.match(/\.[a-z]+$/)[0];
    link.href = url;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, DOWNLOAD_URL_LIFETIME_MS);
  }

  // A single code as a standalone SVG, 1 module = 1 unit, sized in millimeters.
  function singleSvg(qr, moduleMm) {
    var n = qr.modules.size + 2 * QUIET_ZONE;
    var svg = svgEl('svg', {
      xmlns: SVG_NS, version: '1.1',
      width: round(n * moduleMm) + 'mm', height: round(n * moduleMm) + 'mm',
      viewBox: '0 0 ' + n + ' ' + n
    });
    svg.appendChild(svgEl('rect', { width: n, height: n, fill: '#ffffff' }));
    svg.appendChild(svgEl('path', { d: modulePath(qr), fill: '#000000' }));
    return svg;
  }

  function round(x) { return Math.round(x * 1000) / 1000; }

  /* ---- Live cards ------------------------------------------------------ */

  function makeCard(payload, ecl, version, title, info) {
    var card = document.createElement('div');
    card.className = 'qr-card';

    var titleEl = document.createElement('div');
    titleEl.className = 'card-title';
    titleEl.textContent = title;
    var infoEl = document.createElement('div');
    infoEl.className = 'card-info';
    infoEl.textContent = info;
    var canvas = document.createElement('canvas');
    card.append(titleEl, infoEl, canvas);

    // Created first, because the encoder can report an error synchronously.
    var links = document.createElement('div');
    links.className = 'card-links';

    var opts = { width: RENDER_SIZE, errorCorrectionLevel: ecl, margin: 2 };
    if (version !== 'auto') opts.version = parseInt(version, 10);

    QRCode.toCanvas(canvas, payload, opts, function (error) {
      if (error) {
        infoEl.textContent = 'Data too large for this version';
        infoEl.style.color = '#dc3545';
        canvas.style.display = 'none';
        links.hidden = true;
      }
    });

    var png = document.createElement('a');
    png.className = 'download-link';
    png.textContent = 'Download PNG';
    png.href = '#';
    png.addEventListener('click', function (e) {
      e.preventDefault();
      canvas.toBlob(function (blob) {
        if (blob) downloadBlob(blob, 'qrcode-v' + version + '-' + ecl + '.png');
      }, 'image/png');
    });
    var svgLink = document.createElement('a');
    svgLink.className = 'download-link';
    svgLink.textContent = 'Download SVG';
    svgLink.href = '#';
    svgLink.addEventListener('click', function (e) {
      e.preventDefault();
      var qr = encode(payload, ecl, version);
      if (!qr) return;
      // 0.5 mm modules print a version 1 code at about 14.5 mm; scale freely.
      var text = serialize(singleSvg(qr, 0.5));
      downloadBlob(new Blob([text], { type: 'image/svg+xml' }), 'qrcode-v' + version + '-' + ecl + '.svg');
    });
    links.append(png, svgLink);
    card.appendChild(links);
    return card;
  }

  function generateAll() {
    var payload = getPayload();
    if (!payload || !payload.trim()) {
      grid.replaceChildren(emptyNote('Start typing to generate QR codes'));
      return;
    }
    var ecl = getECL();
    var chosen = getVersion();
    var cards = [makeCard(payload, ecl, 'auto', 'Auto (smallest fit)', 'Minimum version for this data')];
    if (chosen !== 'auto') {
      var side = 17 + 4 * parseInt(chosen, 10);
      cards.push(makeCard(payload, ecl, chosen, 'Version ' + chosen, 'Grid: ' + side + 'x' + side + ' modules'));
    }
    grid.replaceChildren.apply(grid, cards);
  }

  /* ---- Print sheet ----------------------------------------------------- */

  var sheet = {
    paper: document.getElementById('sheet-paper'),
    customW: document.getElementById('sheet-custom'),
    customH: document.getElementById('sheet-custom-h'),
    width: document.getElementById('sheet-width'),
    height: document.getElementById('sheet-height'),
    cols: document.getElementById('sheet-cols'),
    rows: document.getElementById('sheet-rows'),
    margin: document.getElementById('sheet-margin'),
    gap: document.getElementById('sheet-gap'),
    label: document.getElementById('sheet-label'),
    guides: document.getElementById('sheet-guides'),
    status: document.getElementById('sheet-status'),
    download: document.getElementById('sheet-download'),
    print: document.getElementById('sheet-print'),
    preview: document.getElementById('sheet-preview'),
    img: document.getElementById('sheet-preview-img')
  };

  // Default paper. A choice the reader made earlier wins; otherwise the
  // region of the browser language decides, using the US-Letter territories
  // from Unicode CLDR supplementalData.xml (checked 2026-10-21). Nothing is
  // sent anywhere, and every other region gets A4.
  var PAPER_KEY = 'qr-sheet-paper';
  var LETTER_REGIONS = ['BZ', 'CA', 'CL', 'CO', 'CR', 'GT', 'MX', 'NI', 'PA', 'PH', 'PR', 'SV', 'US', 'VE'];

  function browserRegion() {
    var langs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language];
    for (var i = 0; i < langs.length; i++) {
      try {
        var loc = new Intl.Locale(langs[i]);
        if (loc.region) return loc.region;
      } catch (e) { /* skip a malformed tag */ }
    }
    try {
      return new Intl.Locale(langs[0]).maximize().region || '';
    } catch (e) {
      return '';
    }
  }

  function defaultPaper() {
    try {
      var saved = localStorage.getItem(PAPER_KEY);
      if (saved && (saved === 'custom' || PAPERS[saved])) return saved;
    } catch (e) { /* storage blocked */ }
    return LETTER_REGIONS.indexOf(browserRegion()) >= 0 ? 'letter' : 'a4';
  }

  sheet.paper.value = defaultPaper();
  sheet.paper.addEventListener('change', function () {
    try { localStorage.setItem(PAPER_KEY, sheet.paper.value); } catch (e) { /* storage blocked */ }
  });

  var current = null;       // { text, layout } for the sheet now on screen
  var previewUrl = null;    // owned by setPreview and revokePreview

  function revokePreview() {
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  }

  function readNumber(input, range, isInteger) {
    var raw = input.value.trim();
    if (raw === '') return null;
    var n = Number(raw);
    if (!isFinite(n) || n < range.min || n > range.max) return null;
    if (isInteger && Math.floor(n) !== n) return null;
    return n;
  }

  // Strips characters that XML 1.0 cannot carry, including lone surrogates.
  function xmlSafe(text) {
    var out = '';
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) {
        var next = text.charCodeAt(i + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) { out += text.charAt(i) + text.charAt(i + 1); i++; }
        continue;
      }
      if (c >= 0xDC00 && c <= 0xDFFF) continue;
      if ((c < 0x20 && c !== 0x09 && c !== 0x0A && c !== 0x0D) || c === 0xFFFE || c === 0xFFFF) continue;
      out += text.charAt(i);
    }
    return out;
  }

  function readLayout() {
    var isCustom = sheet.paper.value === 'custom';
    var w, h, paperName;
    if (isCustom) {
      w = readNumber(sheet.width, LIMITS.paper, false);
      h = readNumber(sheet.height, LIMITS.paper, false);
      if (w === null || h === null) return { error: 'Paper width and height must be between ' + LIMITS.paper.min + ' and ' + LIMITS.paper.max + ' mm.' };
      paperName = 'custom';
    } else {
      var p = PAPERS[sheet.paper.value] || PAPERS.a4;
      w = p.w; h = p.h; paperName = p.name;
    }
    var landscape = document.querySelector('input[name="sheet-orient"]:checked').value === 'landscape';
    if (landscape !== (w > h)) { var t = w; w = h; h = t; }

    var cols = readNumber(sheet.cols, LIMITS.cells, true);
    var rows = readNumber(sheet.rows, LIMITS.cells, true);
    if (cols === null || rows === null) return { error: 'Columns and rows must be whole numbers from ' + LIMITS.cells.min + ' to ' + LIMITS.cells.max + '.' };
    var margin = readNumber(sheet.margin, LIMITS.margin, false);
    if (margin === null) return { error: 'The page margin must be between 0 and ' + LIMITS.margin.max + ' mm.' };
    var gap = readNumber(sheet.gap, LIMITS.gap, false);
    if (gap === null) return { error: 'The gap must be between 0 and ' + LIMITS.gap.max + ' mm.' };

    var cellW = (w - 2 * margin - (cols - 1) * gap) / cols;
    var cellH = (h - 2 * margin - (rows - 1) * gap) / rows;
    if (!(cellW >= 5 && cellH >= 5)) return { error: 'The codes do not fit. Use fewer columns or rows, or a smaller margin or gap.' };

    return {
      w: w, h: h, paperName: paperName, landscape: landscape,
      cols: cols, rows: rows, margin: margin, gap: gap, cellW: cellW, cellH: cellH,
      label: xmlSafe(sheet.label.value.trim()).slice(0, LIMITS.label),
      guides: sheet.guides.checked
    };
  }

  var measureCtx = null;
  function textWidthMm(text, sizeMm) {
    if (!measureCtx) {
      var c = document.createElement('canvas');
      measureCtx = c.getContext('2d');
    }
    if (!measureCtx) return text.length * sizeMm * 0.6;   // rough average glyph width
    measureCtx.font = '100px ' + LABEL_FONT;
    return measureCtx.measureText(text).width / 100 * sizeMm;
  }

  function buildSheet(qr, L) {
    var svg = svgEl('svg', {
      xmlns: SVG_NS, version: '1.1',
      width: round(L.w) + 'mm', height: round(L.h) + 'mm',
      viewBox: '0 0 ' + round(L.w) + ' ' + round(L.h)
    });
    svg.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:xlink', XLINK_NS);
    var title = svgEl('title');
    title.textContent = 'QR code sheet, ' + L.cols + ' x ' + L.rows;
    svg.appendChild(title);

    var n = qr.modules.size + 2 * QUIET_ZONE;
    var defs = svgEl('defs');
    var code = svgEl('g', { id: 'qr' });
    code.appendChild(svgEl('rect', { width: n, height: n, fill: '#ffffff' }));
    code.appendChild(svgEl('path', { d: modulePath(qr), fill: '#000000' }));
    defs.appendChild(code);
    svg.appendChild(defs);
    svg.appendChild(svgEl('rect', { width: round(L.w), height: round(L.h), fill: '#ffffff' }));

    // Label size follows the cell, then shrinks until the text fits its width.
    // Text still too wide at the smallest size is compressed to the cell.
    var labelSize = 0, labelBlock = 0, squeeze = false, labelWidth = L.cellW * 0.94;
    if (L.label) {
      labelSize = Math.min(6, Math.max(2.2, L.cellW * 0.07));
      var fit = labelWidth / textWidthMm(L.label, labelSize);
      if (fit < 1) labelSize = Math.max(1.2, labelSize * fit);
      squeeze = textWidthMm(L.label, labelSize) > labelWidth;
      labelBlock = labelSize * 1.6;
    }
    var side = Math.min(L.cellW, L.cellH - labelBlock);
    if (side < 5) return null;
    var scale = side / n;

    var guides = svgEl('g', { fill: 'none', stroke: '#9a9a9a', 'stroke-width': 0.2, 'stroke-dasharray': '1.2 1' });
    var codes = svgEl('g');
    var labels = svgEl('g', {
      'font-family': LABEL_FONT, 'font-size': round(labelSize), 'text-anchor': 'middle', fill: '#000000'
    });

    for (var r = 0; r < L.rows; r++) {
      for (var c = 0; c < L.cols; c++) {
        var x = L.margin + c * (L.cellW + L.gap);
        var y = L.margin + r * (L.cellH + L.gap);
        if (L.guides) guides.appendChild(svgEl('rect', { x: round(x), y: round(y), width: round(L.cellW), height: round(L.cellH) }));
        var top = y + (L.cellH - side - labelBlock) / 2;
        var left = x + (L.cellW - side) / 2;
        var use = svgEl('use', { href: '#qr', transform: 'translate(' + round(left) + ' ' + round(top) + ') scale(' + round(scale * 1000) / 1000 + ')' });
        use.setAttributeNS(XLINK_NS, 'xlink:href', '#qr');
        codes.appendChild(use);
        if (L.label) {
          var text = svgEl('text', { x: round(x + L.cellW / 2), y: round(top + side + labelSize * 1.15) });
          if (squeeze) {
            text.setAttribute('textLength', String(round(labelWidth)));
            text.setAttribute('lengthAdjust', 'spacingAndGlyphs');
          }
          text.textContent = L.label;
          labels.appendChild(text);
        }
      }
    }
    if (L.guides) svg.appendChild(guides);
    svg.appendChild(codes);
    if (L.label) svg.appendChild(labels);
    return { svg: svg, side: side, moduleMm: scale };
  }

  function setSheetState(message, isError, ready) {
    sheet.status.textContent = message;
    sheet.status.classList.toggle('is-error', !!isError);
    sheet.download.disabled = !ready;
    sheet.print.disabled = !ready;
    if (!ready) {
      current = null;
      revokePreview();
      sheet.img.removeAttribute('src');
      sheet.img.hidden = true;
    }
  }

  function updateSheet() {
    var custom = sheet.paper.value === 'custom';
    sheet.customW.hidden = !custom;
    sheet.customH.hidden = !custom;

    var payload = getPayload();
    if (!payload || !payload.trim()) { setSheetState('Enter content above to build a sheet.', false, false); return; }
    var L = readLayout();
    if (L.error) { setSheetState(L.error, true, false); return; }
    var version = getVersion();
    var qr = encode(payload, getECL(), version);
    if (!qr) { setSheetState('The content is too large for version ' + version + '. Choose a higher version or Auto.', true, false); return; }
    var built = buildSheet(qr, L);
    if (!built) { setSheetState('The label leaves no room for the codes. Use fewer rows or a shorter label.', true, false); return; }

    var text = serialize(built.svg);
    revokePreview();
    previewUrl = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    sheet.img.src = previewUrl;
    sheet.img.hidden = false;
    sheet.preview.style.aspectRatio = L.w + ' / ' + L.h;
    current = { text: text, layout: L };

    var count = L.cols * L.rows;
    var msg = count + (count === 1 ? ' code' : ' codes') + ' on ' + (L.paperName === 'custom' ? round(L.w) + ' x ' + round(L.h) + ' mm' : L.paperName) +
      ' (' + (L.landscape ? 'landscape' : 'portrait') + '), each ' + built.side.toFixed(1) + ' mm square including its white border. Version ' +
      qr.version + ', ' + qr.modules.size + 'x' + qr.modules.size + ' modules of ' + built.moduleMm.toFixed(2) + ' mm.';
    var small = built.moduleMm < 0.33;
    if (small) msg += ' The modules are very small, so phones may struggle to scan them. Use fewer codes or a lower version.';
    setSheetState(msg, small, true);
  }

  var pending = 0;
  function scheduleSheet() {
    if (pending) return;
    pending = requestAnimationFrame(function () { pending = 0; updateSheet(); });
  }

  sheet.download.addEventListener('click', function () {
    if (!current) return;
    var L = current.layout;
    downloadBlob(new Blob([current.text], { type: 'image/svg+xml' }),
      'qr-sheet-' + L.paperName + '-' + L.cols + 'x' + L.rows + '.svg');
  });

  // Printing shows only the sheet, on a page sized exactly to the paper.
  var printArea = document.createElement('div');
  printArea.id = 'qr-print-area';
  var printImg = document.createElement('img');
  printImg.alt = '';
  printArea.appendChild(printImg);
  document.body.appendChild(printArea);
  var pageRule = document.createElement('style');
  pageRule.id = 'qr-print-page';

  function endPrint() {
    document.body.classList.remove('qr-printing');
    pageRule.remove();
  }
  window.addEventListener('afterprint', endPrint);

  sheet.print.addEventListener('click', function () {
    if (!current || !previewUrl) return;
    var L = current.layout;
    var w = round(L.w), h = round(L.h);
    pageRule.textContent = '@page { size: ' + w + 'mm ' + h + 'mm; margin: 0; }';
    document.head.appendChild(pageRule);
    printArea.style.width = w + 'mm';
    printArea.style.height = h + 'mm';
    printImg.src = previewUrl;
    sheet.print.disabled = true;
    var ready = typeof printImg.decode === 'function' ? printImg.decode() : Promise.resolve();
    ready.then(function () {
      document.body.classList.add('qr-printing');
      window.print();
    }, function () {
      sheet.status.textContent = 'The sheet could not be prepared for printing. Download the SVG and print that instead.';
      sheet.status.classList.add('is-error');
      endPrint();
    }).then(function () {
      sheet.print.disabled = !current;
    });
  });

  /* ---- Wiring ---------------------------------------------------------- */

  function refresh() { generateAll(); scheduleSheet(); }
  document.querySelector('.qr-container').addEventListener('input', refresh);
  document.querySelector('.qr-container').addEventListener('change', refresh);
  sheet.preview.parentElement.addEventListener('input', scheduleSheet);
  sheet.preview.parentElement.addEventListener('change', scheduleSheet);
  refresh();
})();
