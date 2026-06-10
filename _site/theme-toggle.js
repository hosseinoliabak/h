(function() {
  // Apply saved theme on load (before paint)
  var saved = localStorage.getItem('site-theme');
  if (saved === 'warm') {
    document.documentElement.classList.add('theme-warm');
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
      var isWarm = document.documentElement.classList.toggle('theme-warm');
      localStorage.setItem('site-theme', isWarm ? 'warm' : 'default');
    });

    document.body.appendChild(btn);
  });
})();
