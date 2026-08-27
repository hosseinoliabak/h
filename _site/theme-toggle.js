(function() {
  // The custom control owns only the light palettes. Quarto owns the separate
  // Flatly/Darkly switch and its `quarto-light` / `quarto-dark` body classes.
  // Reader Mode is retired. Clearing its old preference prevents Quarto from
  // applying a saved reader layout after the project control is removed.
  try { localStorage.removeItem('quarto-reader-mode'); } catch (e) {}

  var themes = ['lion', 'red', 'default'];
  var themeClasses = ['theme-lion', 'theme-red'];
  var legacyDark = false;

  function normalizeTheme(id) {
    if (id === 'flatly') return 'red';
    if (id === 'warm') return 'lion';
    if (id === 'midnight') {
      legacyDark = true;
      return 'default';
    }
    return themes.indexOf(id) === -1 ? 'lion' : id;
  }

  function readTheme() {
    var stored = 'lion';
    try { stored = localStorage.getItem('site-theme') || 'lion'; } catch (e) {}
    var normalized = normalizeTheme(stored);
    if (normalized !== stored) {
      try { localStorage.setItem('site-theme', normalized); } catch (e) {}
    }
    return normalized;
  }

  function writeTheme(id) {
    var normalized = normalizeTheme(id);
    try { localStorage.setItem('site-theme', normalized); } catch (e) {}
    return normalized;
  }

  var saved = readTheme();

  function isDarkMode() {
    return !!(document.body && document.body.classList.contains('quarto-dark'));
  }

  function applyTheme(id) {
    id = normalizeTheme(id);
    var root = document.documentElement;
    for (var i = 0; i < themeClasses.length; i++) root.classList.remove(themeClasses[i]);
    if (!isDarkMode() && id !== 'default' && themes.indexOf(id) !== -1) {
      root.classList.add('theme-' + id);
    }
    return id;
  }

  // Apply saved theme on load (before paint)
  applyTheme(saved);

  // Font cycle: default -> reader -> garamond -> default
  var fonts = [
    { id: 'default',  cls: null,             label: 'Aa', title: 'Font: Default (Nunito + PT Sans)' },
    { id: 'reader',   cls: 'font-reader',    label: 'Aa', title: 'Font: Reader (Inter + Literata)' },
    { id: 'garamond', cls: 'font-garamond',  label: 'Aa', title: 'Font: Garamond' }
  ];
  var savedFont = localStorage.getItem('site-font') || 'default';

  function applyFont(id) {
    var root = document.documentElement;
    root.classList.remove('font-reader', 'font-garamond');
    for (var i = 0; i < fonts.length; i++) {
      if (fonts[i].id === id && fonts[i].cls) root.classList.add(fonts[i].cls);
    }
  }

  function fontMeta(id) {
    for (var i = 0; i < fonts.length; i++) {
      if (fonts[i].id === id) return fonts[i];
    }
    return fonts[0];
  }

  applyFont(savedFont);

  // --- Custom font theme -------------------------------------------------
  // The typography tool (tools/typography.qmd) can write a set of family
  // stacks plus the two scale knobs here, which then applies to every page.
  // It lives in localStorage and nowhere else. Nothing is sent to a server,
  // so it does not follow the reader to another browser. Picking any of the
  // three built-in font themes with the Aa button throws it away.
  var CUSTOM_KEY = 'site-font-custom';
  var customMonoStyle = null;

  function readCustomFont() {
    try {
      var raw = localStorage.getItem(CUSTOM_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function hasCustomFont() {
    return !!readCustomFont();
  }

  function head() {
    return document.head || document.documentElement;
  }

  function applyCustomFont(cfg) {
    if (!cfg) return;
    var root = document.documentElement;
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
    // The chosen families are usually not among the ones styles.css imports,
    // so each page has to pull them in for itself.
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
    var root = document.documentElement;
    ['--site-font-body', '--site-font-heading', '--site-font-size', '--site-line-height', '--site-font-mono']
      .forEach(function(prop) { root.style.removeProperty(prop); });
    var stale = document.querySelectorAll('link[data-site-font], style[data-site-font]');
    for (var i = 0; i < stale.length; i++) {
      if (stale[i].parentNode) stale[i].parentNode.removeChild(stale[i]);
    }
    customMonoStyle = null;
    if (forget) {
      try { localStorage.removeItem(CUSTOM_KEY); } catch (e) {}
    }
  }

  applyCustomFont(readCustomFont());

  // Anything on the page that mirrors these settings, such as the typography
  // tool, listens for this so it can re-read them after a corner button has
  // changed them underneath it.
  function announce(kind) {
    try {
      document.dispatchEvent(new CustomEvent('sitechrome:change', { detail: { kind: kind } }));
    } catch (e) {}
  }

  // Printing always uses the light surface and the Garamond font theme.
  // The palette class comes off for the duration of the print job, then the
  // saved light palette returns afterwards.
  var printRestore = null;

  function enterPrint() {
    if (printRestore) return;
    var root = document.documentElement;
    printRestore = {
      theme: readTheme(),
      font: localStorage.getItem('site-font') || 'default',
      custom: readCustomFont()
    };
    applyTheme('default');
    root.classList.remove('font-reader', 'font-garamond');
    // A custom font theme is a screen choice. Print keeps the house style.
    clearCustomFont(false);
  }

  function exitPrint() {
    if (!printRestore) return;
    var root = document.documentElement;
    applyTheme(printRestore.theme);
    if (printRestore.font === 'reader') root.classList.add('font-reader');
    else if (printRestore.font === 'garamond') root.classList.add('font-garamond');
    applyCustomFont(printRestore.custom);
    printRestore = null;
  }

  window.addEventListener('beforeprint', enterPrint);
  window.addEventListener('afterprint', exitPrint);

  // Safari and some headless renderers drive printing through the media
  // query rather than the events, so listen to both.
  if (window.matchMedia) {
    var printQuery = window.matchMedia('print');
    var onPrintChange = function(e) { if (e.matches) enterPrint(); else exitPrint(); };
    if (printQuery.addEventListener) printQuery.addEventListener('change', onPrintChange);
    else if (printQuery.addListener) printQuery.addListener(onPrintChange);
  }

  // Map theme names to giscus theme URLs
  function getGiscusTheme(theme) {
    var base = 'https://h.oliabak.com';
    if (isDarkMode()) return base + '/giscus-theme-dark.css';
    theme = normalizeTheme(theme);
    if (theme === 'lion') return base + '/giscus-theme-lion.css';
    if (theme === 'red') return base + '/giscus-theme-red.css';
    return base + '/giscus-theme.css';
  }

  // Send theme to giscus iframe (for live toggling)
  function setGiscusTheme(theme) {
    var iframe = document.querySelector('iframe.giscus-frame');
    if (iframe) {
      iframe.contentWindow.postMessage(
        { giscus: { setConfig: { theme: getGiscusTheme(theme) } } },
        'https://giscus.app'
      );
    }
  }

  // Once giscus iframe loads, send it the correct theme immediately
  window.addEventListener('message', function(event) {
    if (event.origin === 'https://giscus.app') {
      var current = readTheme();
      setGiscusTheme(current);
    }
  });

  // Small corner badge showing the 1-based position in the cycle, so you
  // can tell how far you are from wrapping back to theme/font 1.
  function makeBadge(text) {
    var badge = document.createElement('span');
    badge.className = 'site-display-badge';
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = text;
    return badge;
  }

  // The two corner badges are created below but also updated from the
  // exposed API, so they live at module scope.
  var themeBadge = null;
  var fontBadge = null;
  var themeButton = null;
  var darkModeButton = null;
  var darkImageNotice = null;
  var colorModeWasDark = null;
  var colorModeChangeFromControl = false;
  var colorModeChangeReset = null;

  // Earlier versions remembered dismissal permanently. The notice now returns
  // on every intentional switch to dark mode, so remove that retired setting.
  try { localStorage.removeItem('site-dark-image-notice-dismissed-v1'); } catch (e) {}

  // Quarto provides the native color-mode switch, but it has no contextual
  // notice for content whose raster images retain light backgrounds. Keep this
  // small enhancement beside the native control. Closing it applies only to
  // the current visit to dark mode.
  function hideDarkImageNotice() {
    if (darkImageNotice) darkImageNotice.hidden = true;
  }

  function showDarkImageNotice() {
    if (!darkImageNotice) return;
    darkImageNotice.hidden = false;
  }

  function markColorModeControlUse() {
    colorModeChangeFromControl = true;
    if (colorModeChangeReset) window.clearTimeout(colorModeChangeReset);
    colorModeChangeReset = window.setTimeout(function() {
      colorModeChangeFromControl = false;
      colorModeChangeReset = null;
    }, 1000);
  }

  function makeDarkImageNotice() {
    var notice = document.createElement('aside');
    notice.id = 'site-dark-image-notice';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    notice.setAttribute('aria-atomic', 'true');
    notice.hidden = true;

    var icon = document.createElement('span');
    icon.className = 'site-dark-image-notice-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = 'i';

    var copy = document.createElement('div');
    copy.className = 'site-dark-image-notice-copy';

    var title = document.createElement('strong');
    title.textContent = 'Image brightness';

    var message = document.createElement('p');
    message.textContent = 'Some pages contain images with light backgrounds. They may appear bright while you use dark mode.';

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'site-dark-image-notice-close';
    close.setAttribute('aria-label', 'Dismiss dark mode image notice');
    close.textContent = '\u00d7';
    close.addEventListener('click', hideDarkImageNotice);

    copy.appendChild(title);
    copy.appendChild(message);
    notice.appendChild(icon);
    notice.appendChild(copy);
    notice.appendChild(close);
    return notice;
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
      var darkModeLabel = dark ? 'Switch to light mode' : 'Switch to dark mode';
      darkModeButton.title = darkModeLabel;
      darkModeButton.setAttribute('aria-label', darkModeLabel);
      darkModeButton.setAttribute('aria-pressed', dark ? 'true' : 'false');
    }
    if (colorModeWasDark === false && dark && colorModeChangeFromControl) {
      showDarkImageNotice();
    } else if (!dark) {
      hideDarkImageNotice();
    }
    if (colorModeWasDark !== dark) {
      colorModeChangeFromControl = false;
    }
    colorModeWasDark = dark;
  }

  // Create toggle button after DOM loads
  document.addEventListener('DOMContentLoaded', function() {
    // Older rendered pages can retain the retired Quarto control until the
    // next full render. Remove that stale interface as soon as the DOM exists.
    var retiredReaderToggles = document.querySelectorAll('.quarto-reader-toggle');
    for (var ri = 0; ri < retiredReaderToggles.length; ri++) {
      retiredReaderToggles[ri].remove();
    }

    var controls = document.createElement('div');
    controls.id = 'site-display-controls';
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', 'Display settings');

    var btn = document.createElement('button');
    btn.id = 'theme-toggle';
    btn.type = 'button';
    btn.className = 'site-display-control site-palette-control';
    btn.title = 'Switch light color palette';
    btn.setAttribute('aria-label', 'Switch light color palette');
    btn.textContent = '🎨';

    themeBadge = makeBadge(String(themes.indexOf(readTheme()) + 1));
    btn.appendChild(themeBadge);

    btn.addEventListener('click', function() {
      var current = readTheme();
      var idx = themes.indexOf(current);
      var next = themes[(idx + 1) % themes.length];

      applyTheme(next);
      writeTheme(next);
      setGiscusTheme(next);
      themeBadge.textContent = String(themes.indexOf(next) + 1);
      announce('theme');
    });

    themeButton = btn;

    // Quarto changes the body class whenever its native dark-mode control is
    // used. Suppress the saved light palette in Darkly, then restore it when
    // the reader returns to light mode. This observes Quarto's documented
    // public class contract instead of reimplementing its switch.
    colorModeWasDark = isDarkMode();
    var modeObserver = new MutationObserver(syncColorMode);
    modeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    if (legacyDark && !isDarkMode() && typeof window.quartoToggleColorScheme === 'function') {
      window.quartoToggleColorScheme();
    }
    syncColorMode();

    // Font, Quarto dark mode, and the light-palette cycle share one dedicated
    // rail. The native dark-mode element is moved, not copied or reimplemented.
    var fbtn = document.createElement('button');
    fbtn.id = 'font-toggle';
    fbtn.type = 'button';
    fbtn.className = 'site-display-control site-font-control';
    fbtn.textContent = 'Aa';
    fbtn.title = fontMeta(savedFont).title;
    fbtn.setAttribute('aria-label', fontMeta(savedFont).title);

    var savedFontIdx = 0;
    for (var fi = 0; fi < fonts.length; fi++) {
      if (fonts[fi].id === (localStorage.getItem('site-font') || 'default')) savedFontIdx = fi;
    }
    fontBadge = makeBadge(String(savedFontIdx + 1));
    fbtn.appendChild(fontBadge);

    fbtn.addEventListener('click', function() {
      // Choosing one of the built-in font themes is how a reader gets out
      // of a custom one set by the typography tool.
      clearCustomFont(true);
      var current = localStorage.getItem('site-font') || 'default';
      var idx = -1;
      for (var i = 0; i < fonts.length; i++) {
        if (fonts[i].id === current) idx = i;
      }
      var next = fonts[(idx + 1) % fonts.length];

      applyFont(next.id);
      localStorage.setItem('site-font', next.id);
      fbtn.title = next.title;
      fbtn.setAttribute('aria-label', next.title);
      fontBadge.textContent = String((idx + 1) % fonts.length + 1);
      announce('font');
    });

    controls.appendChild(fbtn);

    var darkToggle = document.querySelector('.quarto-color-scheme-toggle');
    if (darkToggle) {
      darkToggle.classList.add('site-display-control', 'site-dark-control');
      darkToggle.classList.remove('px-1');
      darkToggle.setAttribute('role', 'button');
      darkToggle.setAttribute('aria-controls', 'site-dark-image-notice');
      darkToggle.addEventListener('click', markColorModeControlUse, true);
      darkToggle.addEventListener('keydown', function(event) {
        if (event.key === ' ') {
          event.preventDefault();
          darkToggle.click();
        }
      });
      darkModeButton = darkToggle;
      controls.appendChild(darkToggle);
    }

    controls.appendChild(btn);
    var header = document.getElementById('quarto-header');
    if (header && header.parentNode) header.parentNode.insertBefore(controls, header.nextSibling);
    else document.body.appendChild(controls);
    darkImageNotice = makeDarkImageNotice();
    if (controls.parentNode) {
      if (controls.nextSibling) controls.parentNode.insertBefore(darkImageNotice, controls.nextSibling);
      else controls.parentNode.appendChild(darkImageNotice);
    }
    syncColorMode();
  });

  // --- Public API --------------------------------------------------------
  // The typography tool drives the site chrome through this, so the theme
  // classes, the badges, the giscus theme, and the storage keys keep a
  // single owner. Everything here is localStorage only.
  window.siteChrome = {
    themes: themes,

    getTheme: function() {
      return readTheme();
    },

    isDarkMode: isDarkMode,

    // giscus-note.js applies this fixed, first-party URL when Quarto creates
    // the iframe script. The iframe cannot inherit the page's CSS variables.
    getGiscusThemeUrl: function() {
      return getGiscusTheme(readTheme());
    },

    // persist false previews a theme on this page only, leaving the saved
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

    hasCustomFont: hasCustomFont,
    readCustomFont: readCustomFont,
    applyCustomFont: applyCustomFont,

    saveCustomFont: function(cfg) {
      try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(cfg)); } catch (e) {}
      applyCustomFont(cfg);
    },

    // forget false drops the styling but keeps the stored choice, which is
    // what a page-scoped undo needs when a site-wide choice is also saved.
    clearCustomFont: function(forget) {
      clearCustomFont(forget !== false);
      applyFont(localStorage.getItem('site-font') || 'default');
    }
  };
})();
