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

  // Create toggle button after DOM loads
  document.addEventListener('DOMContentLoaded', function() {
    var btn = document.createElement('button');
    btn.id = 'theme-toggle';
    btn.title = 'Switch theme';
    btn.innerHTML = '🎨';
    btn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;width:42px;height:42px;border-radius:50%;border:2px solid #ccc;background:#fff;font-size:20px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.15);transition:all 0.2s;';

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
  });
})();
