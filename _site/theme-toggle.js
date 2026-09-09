(function() {
  // Site chrome.
  //
  // Lion and Sun is the light palette, alongside Quarto's native dark mode.
  // Quarto owns the light/dark switch and its `quarto-light` and
  // `quarto-dark` body classes; this file relocates that native control into
  // the display rail rather than reimplementing it. With one palette left
  // there is nothing to cycle, so the reader has a single control.
  //
  // Retired settings are cleared on load so a returning reader is not left
  // holding a preference that no longer has any code behind it.
  ['quarto-reader-mode', 'site-font', 'site-event',
   'site-dark-image-notice-dismissed-v1'].forEach(function(k) {
    try { localStorage.removeItem(k); } catch (e) {}
  });

  var THEME_KEY = 'site-theme';
  var READING_KEY = 'site-reading-mode';
  var READING_TOC_KEY = 'site-reading-toc';
  var CUSTOM_KEY = 'site-font-custom';

  var root = document.documentElement;
  var THEME = 'lion';
  var themes = [THEME];
  var legacyDark = false;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  // The palette choice is retired along with the deep navy and Canadian Red
  // palettes. Every saved id resolves to Lion and Sun, so the preference is
  // read once and then cleared rather than migrated. The one stored value that
  // still carries information is `midnight`, which asked for a dark surface
  // rather than for a light palette, and is honored below.
  function readTheme() { return THEME; }

  (function retireStoredTheme() {
    var stored = lsGet(THEME_KEY);
    if (stored === null) return;
    if (stored === 'midnight') legacyDark = true;
    lsDel(THEME_KEY);
  })();

  function isDarkMode() {
    return !!(document.body && document.body.classList.contains('quarto-dark'));
  }

  function applyTheme() {
    // Darkly owns the dark surface, so the light palette is suppressed there
    // and returns when the reader switches back.
    if (isDarkMode()) root.classList.remove('theme-' + THEME);
    else root.classList.add('theme-' + THEME);
    return THEME;
  }

  applyTheme();

  // --- Reading mode --------------------------------------------------------
  // A toggle in the display rail, not a separate system. It hides the navbar,
  // both sidebars, the table of contents and comments, and keeps the metadata
  // line. Code, math and tables still break out to the full column.
  // Every page under /tools/ is a tool page, not only the eight that use the
  // full-viewport app shell. The path test also works before <body> exists,
  // which matters because the saved reading preference is applied before paint.
  function isToolPage() {
    if (/\/tools\//.test(window.location.pathname)) return true;
    if (document.querySelector('link[href$="app-mode.css"]')) return true;
    return !!(document.body && document.body.classList.contains('quarto-app-mode'));
  }

  function readingOn() { return root.getAttribute('data-reading') === 'on'; }

  var readingButton = null;

  function applyReading(on, persist) {
    if (on) {
      root.setAttribute('data-reading', 'on');
      if (lsGet(READING_TOC_KEY) === 'on') root.setAttribute('data-reading-toc', 'on');
    } else {
      root.removeAttribute('data-reading');
      root.removeAttribute('data-reading-toc');
    }
    if (persist) { if (on) lsSet(READING_KEY, 'on'); else lsDel(READING_KEY); }
    if (readingButton) {
      readingButton.setAttribute('aria-pressed', on ? 'true' : 'false');
      readingButton.title = on ? 'Leave reading mode (Esc)' : 'Reading mode';
      readingButton.setAttribute('aria-label', readingButton.title);
    }
  }

  // Applied before paint so a reader who left reading mode on does not see the
  // full chrome flash first. Skipped on tool pages, without clearing the stored
  // value, so the choice survives a detour through the tools.
  if (lsGet(READING_KEY) === 'on' && !isToolPage()) {
    root.setAttribute('data-reading', 'on');
  }

  // --- Custom font from the typography tool --------------------------------
  // tools/typography.qmd previews a typeface across the whole site through
  // this. It lives in localStorage and nowhere else, and nothing is sent to a
  // server, so it does not follow the reader to another browser.
  var customMonoStyle = null;

  function readCustomFont() {
    try { var raw = localStorage.getItem(CUSTOM_KEY); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
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
      link.rel = 'stylesheet'; link.href = href;
      link.setAttribute('data-site-font', 'family');
      head().appendChild(link);
    });
  }

  function clearCustomFont(forget) {
    ['--site-font-body', '--site-font-heading', '--site-font-size',
     '--site-line-height', '--site-font-mono']
      .forEach(function(p) { root.style.removeProperty(p); });
    var stale = document.querySelectorAll('link[data-site-font], style[data-site-font]');
    for (var i = 0; i < stale.length; i++) {
      if (stale[i].parentNode) stale[i].parentNode.removeChild(stale[i]);
    }
    customMonoStyle = null;
    if (forget) lsDel(CUSTOM_KEY);
  }

  applyCustomFont(readCustomFont());

  function announce(kind) {
    try { document.dispatchEvent(new CustomEvent('sitechrome:change', { detail: { kind: kind } })); }
    catch (e) {}
  }

  // --- Print ---------------------------------------------------------------
  // Paper keeps the house style. A custom font is a screen choice, so it comes
  // off for the duration of the print job. The palette is not cleared here.
  // The PRINT, FINAL OVERRIDES block at the end of styles.css already resets
  // every branded surface at the palette's own specificity, and removing the
  // class instead would hand paper the parked deep navy rules.
  var printRestore = null;

  function enterPrint() {
    if (printRestore) return;
    printRestore = {
      custom: readCustomFont(),
      reading: root.getAttribute('data-reading'),
      readingToc: root.getAttribute('data-reading-toc')
    };
    clearCustomFont(false);
    // Reading mode is a screen choice. Left on, its 18.5px/1.70 typography
    // overrode the print type scale, and an open reading TOC forced the table
    // of contents and the margin rail back to display: block !important on
    // paper. Both come off for the duration of the job.
    root.removeAttribute('data-reading');
    root.removeAttribute('data-reading-toc');
  }

  function exitPrint() {
    if (!printRestore) return;
    applyCustomFont(printRestore.custom);
    if (printRestore.reading) root.setAttribute('data-reading', printRestore.reading);
    if (printRestore.readingToc) root.setAttribute('data-reading-toc', printRestore.readingToc);
    printRestore = null;
  }

  window.addEventListener('beforeprint', enterPrint);
  window.addEventListener('afterprint', exitPrint);

  // Safari and some headless renderers drive printing through the media query
  // rather than the events, so listen to both.
  if (window.matchMedia) {
    var pq = window.matchMedia('print');
    var onPrint = function(e) { if (e.matches) enterPrint(); else exitPrint(); };
    // addEventListener only. MediaQueryList.addListener is deprecated, and
    // .kiro/steering/web-tool-security.md forbids deprecated APIs in
    // first-party code even as a compatibility fallback. Every engine this
    // site supports has the modern form, and beforeprint/afterprint above
    // already cover anything that does not.
    if (pq.addEventListener) pq.addEventListener('change', onPrint);
  }

  // --- giscus --------------------------------------------------------------
  // The iframe cannot read the page's custom properties, so it gets a fixed
  // first-party stylesheet URL instead.
  function getGiscusThemeUrl() {
    var base = 'https://oliabak.com';
    return isDarkMode()
      ? base + '/giscus-theme-dark.css'
      : base + '/giscus-theme-lion.css';
  }

  function setGiscusTheme() {
    var iframe = document.querySelector('iframe.giscus-frame');
    if (iframe) {
      iframe.contentWindow.postMessage(
        { giscus: { setConfig: { theme: getGiscusThemeUrl() } } },
        'https://giscus.app');
    }
  }

  window.addEventListener('message', function(event) {
    if (event.origin === 'https://giscus.app') setGiscusTheme();
  });

  // --- Display rail --------------------------------------------------------
  var darkModeButton = null;

  function syncColorMode() {
    var dark = isDarkMode();
    applyTheme();
    setGiscusTheme();
    if (darkModeButton) {
      var lbl = dark ? 'Switch to light mode' : 'Switch to dark mode';
      darkModeButton.title = lbl;
      darkModeButton.setAttribute('aria-label', lbl);
      darkModeButton.setAttribute('aria-pressed', dark ? 'true' : 'false');
    }
  }

  document.addEventListener('DOMContentLoaded', function() {
    // Older rendered pages can retain retired interface until the next render.
    // #page-qr is NOT in this list on purpose: the retired margin-template QR
    // is gone from every rendered page, and pastebin now owns a #page-qr block
    // of its own that must survive.
    document.querySelectorAll('.quarto-reader-toggle, #font-toggle')
      .forEach(function(el) { el.remove(); });

    if (isToolPage()) document.body.classList.add('quarto-app-mode');

    var controls = document.createElement('div');
    controls.id = 'site-display-controls';
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', 'Display settings');

    // Reading mode. Not offered on a tool page, where app-mode.css owns layout.
    if (!isToolPage()) {
      readingButton = document.createElement('button');
      readingButton.id = 'site-reading-mode';
      readingButton.type = 'button';
      readingButton.className = 'site-display-control site-reading-control';
      readingButton.textContent = '☰';
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
      darkToggle.addEventListener('keydown', function(e) {
        if (e.key === ' ') { e.preventDefault(); darkToggle.click(); }
      });
      darkModeButton = darkToggle;
      controls.appendChild(darkToggle);
    }

    var header = document.getElementById('quarto-header');
    if (header && header.parentNode) header.parentNode.insertBefore(controls, header.nextSibling);
    else document.body.appendChild(controls);

    // Floating control that brings the table of contents back inside reading
    // mode, so a long page stays navigable without leaving it.
    var tocBtn = document.createElement('button');
    tocBtn.id = 'site-reading-toc';
    tocBtn.type = 'button';
    tocBtn.textContent = 'Contents';
    tocBtn.setAttribute('aria-pressed',
      root.getAttribute('data-reading-toc') === 'on' ? 'true' : 'false');
    tocBtn.addEventListener('click', function() {
      var on = root.getAttribute('data-reading-toc') === 'on';
      if (on) { root.removeAttribute('data-reading-toc'); lsDel(READING_TOC_KEY); }
      else { root.setAttribute('data-reading-toc', 'on'); lsSet(READING_TOC_KEY, 'on'); }
      tocBtn.setAttribute('aria-pressed', on ? 'false' : 'true');
    });
    document.body.appendChild(tocBtn);

    applyReading(readingOn(), false);

    // Quarto changes the body class whenever its native control is used.
    new MutationObserver(syncColorMode)
      .observe(document.body, { attributes: true, attributeFilter: ['class'] });

    if (legacyDark && !isDarkMode() && typeof window.quartoToggleColorScheme === 'function') {
      window.quartoToggleColorScheme();
    }
    syncColorMode();

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && readingOn()) applyReading(false, true);
    });
  });

  // --- Public API ----------------------------------------------------------
  // tools/typography.qmd and giscus-note.js drive the site chrome through
  // this, so the theme classes, the badge and the storage keys keep one owner.
  window.siteChrome = {
    themes: themes,
    getTheme: readTheme,
    isDarkMode: isDarkMode,
    getGiscusThemeUrl: getGiscusThemeUrl,

    // Kept so a page still holding the older typography tool in its cache does
    // not throw. There is one light palette, so this reapplies it.
    setTheme: function() { applyTheme(); setGiscusTheme(); },

    isReadingMode: readingOn,
    setReadingMode: function(on) { applyReading(!!on, true); announce('reading'); },

    hasCustomFont: hasCustomFont,
    readCustomFont: readCustomFont,
    applyCustomFont: applyCustomFont,
    saveCustomFont: function(cfg) { lsSet(CUSTOM_KEY, JSON.stringify(cfg)); applyCustomFont(cfg); },
    clearCustomFont: function(forget) { clearCustomFont(forget !== false); }
  };
})();
