(function() {
  // Site chrome.
  //
  // Two light palettes the reader picks between, plus Quarto's native dark
  // mode. Quarto owns the light/dark switch and its `quarto-light` and
  // `quarto-dark` body classes; this file relocates that native control into
  // the display rail rather than reimplementing it.
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
  var themes = ['default', 'lion'];
  var themeClasses = ['theme-lion'];
  var legacyDark = false;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  // Canadian Red is retired. A reader holding it, or one of the older ids,
  // lands on the default palette instead of on nothing.
  function normalizeTheme(id) {
    if (id === 'warm') return 'lion';
    if (id === 'red' || id === 'flatly') return 'default';
    if (id === 'midnight') { legacyDark = true; return 'default'; }
    return themes.indexOf(id) === -1 ? 'default' : id;
  }

  function readTheme() {
    var stored = lsGet(THEME_KEY) || 'default';
    var normalized = normalizeTheme(stored);
    if (normalized !== stored) lsSet(THEME_KEY, normalized);
    return normalized;
  }

  function writeTheme(id) {
    var normalized = normalizeTheme(id);
    lsSet(THEME_KEY, normalized);
    return normalized;
  }

  function isDarkMode() {
    return !!(document.body && document.body.classList.contains('quarto-dark'));
  }

  function applyTheme(id) {
    id = normalizeTheme(id);
    for (var i = 0; i < themeClasses.length; i++) root.classList.remove(themeClasses[i]);
    // Darkly owns the dark surface, so a light palette is suppressed there and
    // returns when the reader switches back.
    if (!isDarkMode() && id !== 'default' && themes.indexOf(id) !== -1) {
      root.classList.add('theme-' + id);
    }
    return id;
  }

  applyTheme(readTheme());

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
  // Paper keeps the house style. The chosen palette and any custom font are
  // screen choices, so both come off for the duration of the print job.
  var printRestore = null;

  function enterPrint() {
    if (printRestore) return;
    printRestore = {
      theme: readTheme(),
      custom: readCustomFont(),
      reading: root.getAttribute('data-reading'),
      readingToc: root.getAttribute('data-reading-toc')
    };
    applyTheme('default');
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
    applyTheme(printRestore.theme);
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
  function getGiscusThemeUrl(theme) {
    var base = 'https://h.oliabak.com';
    if (isDarkMode()) return base + '/giscus-theme-dark.css';
    return normalizeTheme(theme || readTheme()) === 'lion'
      ? base + '/giscus-theme-lion.css'
      : base + '/giscus-theme.css';
  }

  function setGiscusTheme(theme) {
    var iframe = document.querySelector('iframe.giscus-frame');
    if (iframe) {
      iframe.contentWindow.postMessage(
        { giscus: { setConfig: { theme: getGiscusThemeUrl(theme) } } },
        'https://giscus.app');
    }
  }

  window.addEventListener('message', function(event) {
    if (event.origin === 'https://giscus.app') setGiscusTheme(readTheme());
  });

  // --- Display rail --------------------------------------------------------
  var themeBadge = null, themeButton = null, darkModeButton = null;

  function makeBadge(text) {
    var b = document.createElement('span');
    b.className = 'site-display-badge';
    b.setAttribute('aria-hidden', 'true');
    b.textContent = text;
    return b;
  }

  function syncColorMode() {
    var current = readTheme();
    var dark = isDarkMode();
    applyTheme(current);
    setGiscusTheme(current);
    if (themeButton) {
      themeButton.disabled = dark;
      themeButton.style.opacity = dark ? '0.55' : '1';
      themeButton.style.cursor = dark ? 'not-allowed' : 'pointer';
      themeButton.title = dark
        ? 'Switch to light mode to change the color palette'
        : 'Switch light color palette';
    }
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

    // The two light palettes. Disabled while Quarto's dark mode is active.
    themeButton = document.createElement('button');
    themeButton.id = 'theme-toggle';
    themeButton.type = 'button';
    themeButton.className = 'site-display-control site-palette-control';
    themeButton.title = 'Switch light color palette';
    themeButton.setAttribute('aria-label', 'Switch light color palette');
    themeButton.textContent = '🎨';
    themeBadge = makeBadge(String(themes.indexOf(readTheme()) + 1));
    themeButton.appendChild(themeBadge);
    themeButton.addEventListener('click', function() {
      var next = themes[(themes.indexOf(readTheme()) + 1) % themes.length];
      applyTheme(next);
      writeTheme(next);
      setGiscusTheme(next);
      themeBadge.textContent = String(themes.indexOf(next) + 1);
      announce('theme');
    });
    controls.appendChild(themeButton);

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
    getGiscusThemeUrl: function() { return getGiscusThemeUrl(readTheme()); },

    // persist false previews a palette on this page only, leaving the saved
    // preference alone so the corner button still restores it.
    setTheme: function(id, persist) {
      id = normalizeTheme(id);
      applyTheme(id);
      setGiscusTheme(id);
      if (persist) {
        writeTheme(id);
        if (themeBadge) themeBadge.textContent = String(themes.indexOf(id) + 1);
      }
    },

    isReadingMode: readingOn,
    setReadingMode: function(on) { applyReading(!!on, true); announce('reading'); },

    hasCustomFont: hasCustomFont,
    readCustomFont: readCustomFont,
    applyCustomFont: applyCustomFont,
    saveCustomFont: function(cfg) { lsSet(CUSTOM_KEY, JSON.stringify(cfg)); applyCustomFont(cfg); },
    clearCustomFont: function(forget) { clearCustomFont(forget !== false); }
  };
})();
