(function() {
  // Theme cycle: default -> flatly -> warm -> midnight -> default
  var themes = ['default', 'flatly', 'warm', 'midnight'];
  var themeClasses = ['theme-flatly', 'theme-warm', 'theme-midnight'];
  var saved = localStorage.getItem('site-theme') || 'default';

  function applyTheme(id) {
    var root = document.documentElement;
    for (var i = 0; i < themeClasses.length; i++) root.classList.remove(themeClasses[i]);
    if (id !== 'default' && themes.indexOf(id) !== -1) root.classList.add('theme-' + id);
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
  // The .theme-warm / .theme-midnight rules hardcode colors at a higher
  // specificity than the accent tokens, so the class itself has to come
  // off for the duration of the print job, then go back afterwards.
  var printRestore = null;

  function enterPrint() {
    if (printRestore) return;
    var root = document.documentElement;
    printRestore = {
      theme: localStorage.getItem('site-theme') || 'default',
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
    if (theme === 'midnight') return base + '/giscus-theme-midnight.css';
    if (theme === 'warm') return base + '/giscus-theme-warm.css';
    if (theme === 'flatly') return base + '/giscus-theme-flatly.css';
    return base + '/giscus-theme.css';
  }

  // Override giscus hidden inputs so it loads with the correct theme
  // This must run before loadGiscus() reads the value
  var baseInput = document.getElementById('giscus-base-theme');
  var altInput = document.getElementById('giscus-alt-theme');
  if (baseInput) baseInput.value = getGiscusTheme(saved);
  if (altInput) altInput.value = getGiscusTheme(saved);

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
      var current = localStorage.getItem('site-theme') || 'default';
      setGiscusTheme(current);
    }
  });

  // Small corner badge showing the 1-based position in the cycle, so you
  // can tell how far you are from wrapping back to theme/font 1.
  function makeBadge(text) {
    var badge = document.createElement('span');
    badge.style.cssText = 'position:absolute;top:-5px;right:-5px;box-sizing:border-box;min-width:16px;height:16px;line-height:13px;border-radius:8px;border:1.5px solid var(--site-accent);background:var(--bs-body-bg,#fff);color:var(--site-accent);font-size:10px;font-weight:700;font-family:sans-serif;text-align:center;pointer-events:none;';
    badge.textContent = text;
    return badge;
  }

  // The two corner badges are created below but also updated from the
  // exposed API, so they live at module scope.
  var themeBadge = null;
  var fontBadge = null;

  // Create toggle button after DOM loads
  document.addEventListener('DOMContentLoaded', function() {
    var btn = document.createElement('button');
    btn.id = 'theme-toggle';
    btn.title = 'Switch theme';
    btn.innerHTML = '🎨';
    btn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;width:42px;height:42px;border-radius:50%;border:2px solid var(--site-accent);background:var(--bs-body-bg,#fff);color:var(--site-accent);font-size:20px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.15);transition:all 0.2s;';

    btn.addEventListener('mouseenter', function() {
      btn.style.transform = 'scale(1.1)';
    });
    btn.addEventListener('mouseleave', function() {
      btn.style.transform = 'scale(1)';
    });

    themeBadge = makeBadge(String(themes.indexOf(localStorage.getItem('site-theme') || 'default') + 1));
    btn.appendChild(themeBadge);

    btn.addEventListener('click', function() {
      var current = localStorage.getItem('site-theme') || 'default';
      var idx = themes.indexOf(current);
      var next = themes[(idx + 1) % themes.length];

      applyTheme(next);
      localStorage.setItem('site-theme', next);
      setGiscusTheme(next);
      themeBadge.textContent = String(themes.indexOf(next) + 1);
      announce('theme');
    });

    document.body.appendChild(btn);

    // Font toggle, stacked directly above the color toggle
    var fbtn = document.createElement('button');
    fbtn.id = 'font-toggle';
    fbtn.innerHTML = 'Aa';
    fbtn.style.cssText = 'position:fixed;bottom:72px;right:20px;z-index:9999;width:42px;height:42px;border-radius:50%;border:2px solid var(--site-accent);background:var(--bs-body-bg,#fff);color:var(--site-accent);font-size:17px;font-weight:600;line-height:1;font-family:var(--site-font-heading);cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.15);transition:all 0.2s;';
    fbtn.title = fontMeta(savedFont).title;

    var savedFontIdx = 0;
    for (var fi = 0; fi < fonts.length; fi++) {
      if (fonts[fi].id === (localStorage.getItem('site-font') || 'default')) savedFontIdx = fi;
    }
    fontBadge = makeBadge(String(savedFontIdx + 1));
    fbtn.appendChild(fontBadge);

    fbtn.addEventListener('mouseenter', function() {
      fbtn.style.transform = 'scale(1.1)';
    });
    fbtn.addEventListener('mouseleave', function() {
      fbtn.style.transform = 'scale(1)';
    });

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
      fontBadge.textContent = String((idx + 1) % fonts.length + 1);
      announce('font');
    });

    document.body.appendChild(fbtn);
  });

  // --- Public API --------------------------------------------------------
  // The typography tool drives the site chrome through this, so the theme
  // classes, the badges, the giscus theme, and the storage keys keep a
  // single owner. Everything here is localStorage only.
  window.siteChrome = {
    themes: themes,

    getTheme: function() {
      try { return localStorage.getItem('site-theme') || 'default'; } catch (e) { return 'default'; }
    },

    // persist false previews a theme on this page only, leaving the saved
    // preference alone so the corner button still restores it.
    setTheme: function(id, persist) {
      applyTheme(id);
      setGiscusTheme(id);
      if (persist) {
        try { localStorage.setItem('site-theme', id); } catch (e) {}
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
