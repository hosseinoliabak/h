(function() {
  // Field Notes site chrome.
  //
  // One theme. Quarto still owns the light/dark switch and its `quarto-light` /
  // `quarto-dark` body classes, and this file still relocates that native
  // control into the display rail rather than reimplementing it. What this file
  // owns is the rail itself, reading mode, the event theme, and the share
  // control that replaced the per-page QR block.
  //
  // Retired settings are cleared on load so a returning reader is not left with
  // a saved preference that no longer has any code behind it.
  var RETIRED = ['quarto-reader-mode', 'site-theme', 'site-font',
                 'site-dark-image-notice-dismissed-v1'];
  RETIRED.forEach(function(k) {
    try { localStorage.removeItem(k); } catch (e) {}
  });

  var READING_KEY = 'site-reading-mode';
  var READING_TOC_KEY = 'site-reading-toc';
  var EVENT_KEY = 'site-event';
  var CUSTOM_KEY = 'site-font-custom';

  var root = document.documentElement;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function isDarkMode() {
    return !!(document.body && document.body.classList.contains('quarto-dark'));
  }

  // --- Event themes --------------------------------------------------------
  // One mechanism, eight occasions, accent swap only. Neutrals, type and layout
  // never move, so no page can become unreadable because of a festival.
  //
  // Iranian occasions follow the solar Hijri calendar, so their Gregorian dates
  // shift by a day from year to year and cannot be a fixed month-and-day pair.
  // Each entry therefore carries the candidate days it can fall on, and the
  // window is measured from whichever of those days the current year uses.
  // The equinox-anchored ones (Nowruz, Sizdah Bedar) are derived from the
  // March equinox, which is what the calendar itself is anchored to.
  var EVENTS = [
    // id,                 month, day(s),        window in days
    { id: 'nowruz',            m: 3,  d: [20, 21], len: 5, equinox: 0 },
    { id: 'sizdah-bedar',      m: 4,  d: [1, 2],   len: 1, equinox: 12 },
    { id: 'chaharshanbe-suri', m: 3,  d: [14, 15], len: 1, equinox: -5 },
    { id: 'sepandarmazgan',    m: 2,  d: [17, 18], len: 1 },
    { id: 'tirgan',            m: 7,  d: [1, 2],   len: 1 },
    { id: 'jashn-e-sadeh',     m: 1,  d: [30, 31], len: 1 },
    { id: 'mehregan',          m: 10, d: [2, 3],   len: 1 },
    { id: 'yalda',             m: 12, d: [20, 21], len: 1 }
  ];
  var EVENT_IDS = EVENTS.map(function(e) { return e.id; });

  // The March equinox to the nearest day, good from 1900 to 2099. Meeus's
  // simplified expression. Nowruz is the day the equinox falls on in Tehran,
  // and the two occasions tied to it are counted from there.
  function marchEquinoxDay(year) {
    var y = (year - 2000) / 1000;
    var jde = 2451623.80984 + 365242.37404 * y + 0.05169 * y * y
              - 0.00411 * y * y * y - 0.00057 * y * y * y * y;
    // Julian day to a UTC date, then shift to Tehran (UTC+3:30).
    var ms = (jde - 2440587.5) * 86400000 + 3.5 * 3600000;
    return new Date(ms);
  }

  function activeEventFor(now) {
    var year = now.getFullYear();
    for (var i = 0; i < EVENTS.length; i++) {
      var e = EVENTS[i];
      var start;
      if (typeof e.equinox === 'number') {
        start = marchEquinoxDay(year);
        start = new Date(start.getFullYear(), start.getMonth(), start.getDate() + e.equinox);
      } else {
        start = new Date(year, e.m - 1, e.d[0]);
      }
      var end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + e.len);
      var day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (day >= new Date(start.getFullYear(), start.getMonth(), start.getDate()) && day < end) {
        return e.id;
      }
    }
    return null;
  }

  // Manual override wins over the date. 'auto' returns to the calendar, and
  // 'off' means plain Field Notes whatever the date is.
  function resolveEvent() {
    var saved = lsGet(EVENT_KEY) || 'auto';
    if (saved === 'off') return null;
    if (saved !== 'auto' && EVENT_IDS.indexOf(saved) !== -1) return saved;
    return activeEventFor(new Date());
  }

  function applyEvent() {
    var id = resolveEvent();
    if (id) root.setAttribute('data-event', id);
    else root.removeAttribute('data-event');
    return id;
  }

  applyEvent();

  // --- Reading mode --------------------------------------------------------
  // A toggle in the display rail, not a fourth system. It hides the navbar,
  // both sidebars, the table of contents, the share control and comments, and
  // keeps the metadata line. Code, math and tables still break out full width,
  // because a narrow measure must never clip an equation.
  function isToolPage() {
    // app-mode.css owns layout on the eight page-layout: custom tool pages.
    return !!document.querySelector('link[href$="app-mode.css"]') ||
           document.body.classList.contains('quarto-app-mode');
  }

  function readingOn() { return root.getAttribute('data-reading') === 'on'; }

  function applyReading(on, persist) {
    if (on) {
      root.setAttribute('data-reading', 'on');
      if (lsGet(READING_TOC_KEY) === 'on') root.setAttribute('data-reading-toc', 'on');
    } else {
      root.removeAttribute('data-reading');
      root.removeAttribute('data-reading-toc');
    }
    if (persist) {
      if (on) lsSet(READING_KEY, 'on'); else lsDel(READING_KEY);
    }
    if (readingButton) {
      readingButton.setAttribute('aria-pressed', on ? 'true' : 'false');
      readingButton.title = on ? 'Leave reading mode (Esc)' : 'Reading mode';
      readingButton.setAttribute('aria-label', readingButton.title);
    }
  }

  // Applied before paint so a reader who left reading mode on does not see the
  // full chrome flash first.
  if (lsGet(READING_KEY) === 'on') root.setAttribute('data-reading', 'on');

  // --- Custom font from the typography tool --------------------------------
  // The three built-in font settings are gone. This is not one of them. It is
  // how tools/typography.qmd previews a typeface across the whole site, it
  // lives in localStorage and nowhere else, and nothing is sent to a server.
  var customMonoStyle = null;

  function readCustomFont() {
    try {
      var raw = localStorage.getItem(CUSTOM_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function hasCustomFont() { return !!readCustomFont(); }
  function head() { return document.head || document.documentElement; }

  function applyCustomFont(cfg) {
    if (!cfg) return;
    if (cfg.body) root.style.setProperty('--site-font-body', cfg.body);
    if (cfg.heading) root.style.setProperty('--site-font-heading', cfg.heading);
    if (cfg.size) root.style.setProperty('--site-font-size', cfg.size);
    if (cfg.lead) root.style.setProperty('--site-line-height', cfg.lead);
    if (cfg.mono) {
      root.style.setProperty('--site-font-mono', cfg.mono);
      if (!customMonoStyle) {
        customMonoStyle = document.createElement('style');
        customMonoStyle.setAttribute('data-site-font', 'mono');
        customMonoStyle.textContent = 'code, pre, kbd, samp { font-family: var(--site-font-mono) !important; }';
        head().appendChild(customMonoStyle);
      }
    }
    (cfg.links || []).forEach(function(href) {
      if (document.querySelector('link[data-site-font][href="' + href + '"]')) return;
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.setAttribute('data-site-font', 'family');
      head().appendChild(link);
    });
  }

  function clearCustomFont(forget) {
    ['--site-font-body', '--site-font-heading', '--site-font-size',
     '--site-line-height', '--site-font-mono']
      .forEach(function(prop) { root.style.removeProperty(prop); });
    var stale = document.querySelectorAll('link[data-site-font], style[data-site-font]');
    for (var i = 0; i < stale.length; i++) {
      if (stale[i].parentNode) stale[i].parentNode.removeChild(stale[i]);
    }
    customMonoStyle = null;
    if (forget) lsDel(CUSTOM_KEY);
  }

  applyCustomFont(readCustomFont());

  function announce(kind) {
    try {
      document.dispatchEvent(new CustomEvent('sitechrome:change', { detail: { kind: kind } }));
    } catch (e) {}
  }

  // --- Print ---------------------------------------------------------------
  // Paper keeps the house style. The event accent and any custom font are
  // screen choices, so both come off for the duration of the print job.
  var printRestore = null;

  function enterPrint() {
    if (printRestore) return;
    printRestore = { event: root.getAttribute('data-event'), custom: readCustomFont() };
    root.removeAttribute('data-event');
    clearCustomFont(false);
  }

  function exitPrint() {
    if (!printRestore) return;
    if (printRestore.event) root.setAttribute('data-event', printRestore.event);
    applyCustomFont(printRestore.custom);
    printRestore = null;
  }

  window.addEventListener('beforeprint', enterPrint);
  window.addEventListener('afterprint', exitPrint);

  if (window.matchMedia) {
    var printQuery = window.matchMedia('print');
    var onPrintChange = function(e) { if (e.matches) enterPrint(); else exitPrint(); };
    if (printQuery.addEventListener) printQuery.addEventListener('change', onPrintChange);
    else if (printQuery.addListener) printQuery.addListener(onPrintChange);
  }

  // --- giscus --------------------------------------------------------------
  // Two stylesheets now, one per color mode. The iframe cannot read the page's
  // custom properties, so it gets a first-party URL instead.
  function getGiscusThemeUrl() {
    var base = 'https://h.oliabak.com';
    return base + (isDarkMode() ? '/giscus-theme-dark.css' : '/giscus-theme.css');
  }

  function setGiscusTheme() {
    var iframe = document.querySelector('iframe.giscus-frame');
    if (iframe) {
      iframe.contentWindow.postMessage(
        { giscus: { setConfig: { theme: getGiscusThemeUrl() } } },
        'https://giscus.app'
      );
    }
  }

  window.addEventListener('message', function(event) {
    if (event.origin === 'https://giscus.app') setGiscusTheme();
  });

  // --- Display rail --------------------------------------------------------
  var darkModeButton = null;
  var readingButton = null;
  var shareButton = null;
  var sharePanel = null;

  function control(id, cls, label, text) {
    var b = document.createElement('button');
    b.id = id;
    b.type = 'button';
    b.className = 'site-display-control ' + cls;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.textContent = text;
    return b;
  }

  function syncColorMode() {
    setGiscusTheme();
    if (darkModeButton) {
      var dark = isDarkMode();
      var lbl = dark ? 'Switch to light mode' : 'Switch to dark mode';
      darkModeButton.title = lbl;
      darkModeButton.setAttribute('aria-label', lbl);
      darkModeButton.setAttribute('aria-pressed', dark ? 'true' : 'false');
    }
  }

  // --- Share control -------------------------------------------------------
  // The QR used to sit in every page's margin, which also meant every page
  // loaded a QR library it almost never needed. It is now behind this control
  // and the library is fetched on first open.
  var QR_SRC = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js';
  var qrLoading = null;

  function loadQr() {
    if (window.QRCode) return Promise.resolve(window.QRCode);
    if (qrLoading) return qrLoading;
    qrLoading = new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = QR_SRC;
      s.crossOrigin = 'anonymous';
      s.referrerPolicy = 'no-referrer';
      s.onload = function() { resolve(window.QRCode); };
      s.onerror = function() { qrLoading = null; reject(new Error('qr load failed')); };
      head().appendChild(s);
    });
    return qrLoading;
  }

  function buildSharePanel() {
    var panel = document.createElement('div');
    panel.id = 'site-share-panel';
    panel.className = 'site-share-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Share this page');

    var img = document.createElement('img');
    img.id = 'site-share-qr';
    img.width = 148;
    img.height = 148;
    img.alt = 'QR code for this page';
    img.hidden = true;

    var caption = document.createElement('p');
    caption.className = 'site-share-caption';
    caption.textContent = 'Scan to open on mobile';

    var copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'site-share-copy';
    copy.textContent = 'Copy link';
    copy.addEventListener('click', function() {
      var done = function() {
        copy.textContent = 'Copied';
        window.setTimeout(function() { copy.textContent = 'Copy link'; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(window.location.href).then(done, function() {});
      }
    });

    var fallback = document.createElement('p');
    fallback.className = 'site-share-fallback';
    fallback.hidden = true;
    fallback.textContent = 'The QR image could not be loaded. The link still copies.';

    panel.appendChild(img);
    panel.appendChild(caption);
    panel.appendChild(copy);
    panel.appendChild(fallback);
    panel._img = img;
    panel._caption = caption;
    panel._fallback = fallback;
    return panel;
  }

  function openShare() {
    if (!sharePanel) return;
    sharePanel.hidden = false;
    shareButton.setAttribute('aria-expanded', 'true');
    if (sharePanel._img.src) return;
    loadQr().then(function(QR) {
      QR.toDataURL(window.location.href, { width: 148, errorCorrectionLevel: 'M', margin: 1 },
        function(err, dataUrl) {
          if (err) { sharePanel._fallback.hidden = false; return; }
          sharePanel._img.src = dataUrl;
          sharePanel._img.hidden = false;
        });
    }).catch(function() {
      sharePanel._caption.hidden = true;
      sharePanel._fallback.hidden = false;
    });
  }

  function closeShare() {
    if (!sharePanel) return;
    sharePanel.hidden = true;
    if (shareButton) shareButton.setAttribute('aria-expanded', 'false');
  }

  document.addEventListener('DOMContentLoaded', function() {
    // Older rendered pages can retain retired controls until the next render.
    document.querySelectorAll('.quarto-reader-toggle, #page-qr').forEach(function(el) {
      el.remove();
    });

    if (isToolPage()) document.body.classList.add('quarto-app-mode');

    var controls = document.createElement('div');
    controls.id = 'site-display-controls';
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', 'Display settings');

    // Reading mode. Not offered on a tool page.
    if (!isToolPage()) {
      readingButton = control('site-reading-mode', 'site-reading-control', 'Reading mode', '☰');
      readingButton.setAttribute('aria-pressed', 'false');
      readingButton.addEventListener('click', function() {
        applyReading(!readingOn(), true);
        announce('reading');
      });
      controls.appendChild(readingButton);
    }

    // Quarto's own dark-mode element is moved, never copied or reimplemented.
    var darkToggle = document.querySelector('.quarto-color-scheme-toggle');
    if (darkToggle) {
      darkToggle.classList.add('site-display-control', 'site-dark-control');
      darkToggle.classList.remove('px-1');
      darkToggle.setAttribute('role', 'button');
      darkToggle.addEventListener('keydown', function(event) {
        if (event.key === ' ') { event.preventDefault(); darkToggle.click(); }
      });
      darkModeButton = darkToggle;
      controls.appendChild(darkToggle);
    }

    // Share.
    shareButton = control('site-share', 'site-share-control', 'Share this page', '⇗');
    shareButton.setAttribute('aria-expanded', 'false');
    shareButton.setAttribute('aria-controls', 'site-share-panel');
    shareButton.addEventListener('click', function() {
      if (sharePanel && sharePanel.hidden) openShare(); else closeShare();
    });
    controls.appendChild(shareButton);

    var header = document.getElementById('quarto-header');
    if (header && header.parentNode) header.parentNode.insertBefore(controls, header.nextSibling);
    else document.body.appendChild(controls);

    sharePanel = buildSharePanel();
    controls.appendChild(sharePanel);

    // Floating control that brings the table of contents back inside reading
    // mode, so a long page is still navigable without leaving it.
    var tocBtn = document.createElement('button');
    tocBtn.id = 'site-reading-toc';
    tocBtn.type = 'button';
    tocBtn.textContent = 'Contents';
    tocBtn.setAttribute('aria-pressed', 'false');
    tocBtn.addEventListener('click', function() {
      var on = root.getAttribute('data-reading-toc') === 'on';
      if (on) { root.removeAttribute('data-reading-toc'); lsDel(READING_TOC_KEY); }
      else { root.setAttribute('data-reading-toc', 'on'); lsSet(READING_TOC_KEY, 'on'); }
      tocBtn.setAttribute('aria-pressed', on ? 'false' : 'true');
    });
    document.body.appendChild(tocBtn);

    applyReading(readingOn(), false);

    // Quarto changes the body class when its native control is used.
    new MutationObserver(syncColorMode)
      .observe(document.body, { attributes: true, attributeFilter: ['class'] });
    syncColorMode();

    document.addEventListener('keydown', function(e) {
      if (e.key !== 'Escape') return;
      if (sharePanel && !sharePanel.hidden) { closeShare(); return; }
      if (readingOn()) applyReading(false, true);
    });

    document.addEventListener('click', function(e) {
      if (!sharePanel || sharePanel.hidden) return;
      if (controls.contains(e.target)) return;
      closeShare();
    });
  });

  // --- Public API ----------------------------------------------------------
  // tools/typography.qmd and giscus-note.js drive the site chrome through this,
  // so the storage keys and the theme attributes keep a single owner.
  window.siteChrome = {
    isDarkMode: isDarkMode,
    getGiscusThemeUrl: getGiscusThemeUrl,

    events: EVENT_IDS,
    getEvent: function() { return lsGet(EVENT_KEY) || 'auto'; },
    // 'auto' follows the calendar, 'off' forces plain Field Notes, or name one.
    setEvent: function(id) {
      if (id === 'auto') lsDel(EVENT_KEY);
      else lsSet(EVENT_KEY, id);
      var applied = applyEvent();
      announce('event');
      return applied;
    },

    // tools/typography.qmd drives the accent through these two names. The
    // three light palettes they used to select are gone, and the event theme
    // is the surviving "pick an accent" concept, so they map onto it. Keeping
    // the names means that page does not have to be rewritten to keep working.
    getTheme: function() { return lsGet(EVENT_KEY) || 'auto'; },
    setTheme: function(id, persist) {
      if (persist === false) {
        // Preview on this page only, leaving the saved preference alone.
        if (id && id !== 'auto' && id !== 'off' && EVENT_IDS.indexOf(id) !== -1) {
          root.setAttribute('data-event', id);
        } else if (id === 'off') {
          root.removeAttribute('data-event');
        } else {
          applyEvent();
        }
        return;
      }
      window.siteChrome.setEvent(id);
    },

    isReadingMode: readingOn,
    setReadingMode: function(on) { applyReading(!!on, true); announce('reading'); },

    hasCustomFont: hasCustomFont,
    readCustomFont: readCustomFont,
    applyCustomFont: applyCustomFont,
    saveCustomFont: function(cfg) {
      lsSet(CUSTOM_KEY, JSON.stringify(cfg));
      applyCustomFont(cfg);
    },
    clearCustomFont: function(forget) { clearCustomFont(forget !== false); }
  };
})();
