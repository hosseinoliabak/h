(function() {
  // Theme cycle: default -> warm -> midnight -> default
  var themes = ['default', 'warm', 'midnight'];
  var saved = localStorage.getItem('site-theme') || 'default';

  // Apply saved theme on load (before paint)
  if (saved === 'warm') {
    document.documentElement.classList.add('theme-warm');
  } else if (saved === 'midnight') {
    document.documentElement.classList.add('theme-midnight');
  }

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
      font: localStorage.getItem('site-font') || 'default'
    };
    root.classList.remove('theme-warm', 'theme-midnight');
    root.classList.remove('font-reader', 'font-garamond');
  }

  function exitPrint() {
    if (!printRestore) return;
    var root = document.documentElement;
    if (printRestore.theme === 'warm') root.classList.add('theme-warm');
    else if (printRestore.theme === 'midnight') root.classList.add('theme-midnight');
    if (printRestore.font === 'reader') root.classList.add('font-reader');
    else if (printRestore.font === 'garamond') root.classList.add('font-garamond');
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

    btn.addEventListener('click', function() {
      var current = localStorage.getItem('site-theme') || 'default';
      var idx = themes.indexOf(current);
      var next = themes[(idx + 1) % themes.length];

      // Remove all theme classes
      document.documentElement.classList.remove('theme-warm', 'theme-midnight');

      // Apply next theme
      if (next === 'warm') {
        document.documentElement.classList.add('theme-warm');
      } else if (next === 'midnight') {
        document.documentElement.classList.add('theme-midnight');
      }

      localStorage.setItem('site-theme', next);
      setGiscusTheme(next);
    });

    document.body.appendChild(btn);

    // Font toggle, stacked directly above the color toggle
    var fbtn = document.createElement('button');
    fbtn.id = 'font-toggle';
    fbtn.innerHTML = 'Aa';
    fbtn.style.cssText = 'position:fixed;bottom:72px;right:20px;z-index:9999;width:42px;height:42px;border-radius:50%;border:2px solid var(--site-accent);background:var(--bs-body-bg,#fff);color:var(--site-accent);font-size:17px;font-weight:600;line-height:1;font-family:var(--site-font-heading);cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.15);transition:all 0.2s;';
    fbtn.title = fontMeta(savedFont).title;

    fbtn.addEventListener('mouseenter', function() {
      fbtn.style.transform = 'scale(1.1)';
    });
    fbtn.addEventListener('mouseleave', function() {
      fbtn.style.transform = 'scale(1)';
    });

    fbtn.addEventListener('click', function() {
      var current = localStorage.getItem('site-font') || 'default';
      var idx = -1;
      for (var i = 0; i < fonts.length; i++) {
        if (fonts[i].id === current) idx = i;
      }
      var next = fonts[(idx + 1) % fonts.length];

      applyFont(next.id);
      localStorage.setItem('site-font', next.id);
      fbtn.title = next.title;
    });

    document.body.appendChild(fbtn);
  });
})();
