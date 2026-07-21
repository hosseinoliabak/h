(function() {
  'use strict';

  // Search scopes, derived from the navbar at load time (see buildScopes)
  var SCOPES = [{ label: 'All', prefix: '' }];

  // Resolve an href to a site-root-relative path, or null if external.
  // Handles relative links on deep pages and Quarto's rewriting of navbar
  // hrefs to absolute URLs.
  function toSitePath(href) {
    if (!href || href.charAt(0) === '#') return null;
    try {
      var url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return null;
      return url.pathname.replace(/^\//, '');
    } catch (e) {
      return null;
    }
  }

  // Derive scopes from the navbar: one chip per top-level menu whose links
  // predominantly live under a single directory (label = menu title,
  // prefix = that directory). Tracks _quarto.yml automatically.
  function buildScopes() {
    var scopes = [{ label: 'All', prefix: '' }];

    document.querySelectorAll('.navbar .navbar-nav > li.nav-item').forEach(function(li) {
      var toggle = li.querySelector('.nav-link');
      if (!toggle) return;
      var label = toggle.textContent.trim();
      if (!label) return;

      var links = li.querySelectorAll('.dropdown-menu a[href]');
      if (links.length === 0) links = [toggle];

      var counts = {};
      var totalInternal = 0;
      links.forEach(function(a) {
        var path = toSitePath(a.getAttribute('data-original-href') || a.getAttribute('href'));
        if (path === null) return;
        totalInternal++;
        var slash = path.indexOf('/');
        if (slash === -1) return;
        var dir = path.slice(0, slash + 1);
        counts[dir] = (counts[dir] || 0) + 1;
      });

      var best = null;
      var bestCount = 0;
      Object.keys(counts).forEach(function(dir) {
        if (counts[dir] > bestCount) { best = dir; bestCount = counts[dir]; }
      });

      // Skip mixed menus (e.g. About) where no directory holds a majority
      if (best && bestCount * 2 > totalInternal) {
        scopes.push({ label: label, prefix: best });
      }
    });

    return scopes;
  }

  // Active scopes — empty array means "All" (no filtering)
  var activeScopes = [];

  // Detect the current section from the URL and default to it
  function detectCurrentSection() {
    var path = window.location.pathname.replace(/^\//, '');
    for (var i = 1; i < SCOPES.length; i++) {
      if (path.startsWith(SCOPES[i].prefix)) {
        return [SCOPES[i].prefix];
      }
    }
    return [];
  }

  // Create the scope filter bar
  function createScopeBar() {
    var bar = document.createElement('div');
    bar.id = 'search-scope-bar';

    SCOPES.forEach(function(scope) {
      var pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'search-scope-pill';
      pill.textContent = scope.label;
      pill.dataset.prefix = scope.prefix;

      // Set initial active state
      if (scope.prefix === '' && activeScopes.length === 0) {
        pill.classList.add('active');
      } else if (activeScopes.indexOf(scope.prefix) !== -1) {
        pill.classList.add('active');
      }

      pill.addEventListener('click', function() {
        if (scope.prefix === '') {
          // "All" clears all other selections
          activeScopes = [];
        } else {
          // Toggle this scope
          var idx = activeScopes.indexOf(scope.prefix);
          if (idx !== -1) {
            activeScopes.splice(idx, 1);
          } else {
            activeScopes.push(scope.prefix);
          }
        }

        // Update pill states
        bar.querySelectorAll('.search-scope-pill').forEach(function(p) {
          var prefix = p.dataset.prefix;
          if (prefix === '') {
            p.classList.toggle('active', activeScopes.length === 0);
          } else {
            p.classList.toggle('active', activeScopes.indexOf(prefix) !== -1);
          }
        });

        filterResults();
      });

      bar.appendChild(pill);
    });

    return bar;
  }

  // Filter visible search results based on active scopes
  function filterResults() {
    // No filtering when "All" is active
    if (activeScopes.length === 0) {
      document.querySelectorAll('.aa-Item').forEach(function(item) {
        item.style.display = '';
      });
      return;
    }

    document.querySelectorAll('.aa-Item').forEach(function(item) {
      var link = item.querySelector('a[href]');
      if (!link) {
        item.style.display = '';
        return;
      }

      var normalized = toSitePath(link.getAttribute('href'));
      if (normalized === null) {
        item.style.display = '';
        return;
      }

      var matches = activeScopes.some(function(prefix) {
        return normalized.startsWith(prefix);
      });

      item.style.display = matches ? '' : 'none';
    });
  }

  // Inject the scope bar into the search panel when it opens (only once)
  function injectScopeBar() {
    var injected = false;

    var observer = new MutationObserver(function() {
      // Look for the detached search overlay (Quarto uses overlay mode)
      var detachedContainer = document.querySelector('.aa-DetachedContainer');
      if (detachedContainer && !detachedContainer.querySelector('#search-scope-bar')) {
        // Find the form inside
        var form = detachedContainer.querySelector('.aa-Form');
        if (form && form.parentNode) {
          var bar = createScopeBar();
          form.parentNode.insertBefore(bar, form.nextSibling);
          injected = true;
        }
      }

      // Filter results whenever they update
      if (injected && activeScopes.length > 0) {
        filterResults();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Initialize
  document.addEventListener('DOMContentLoaded', function() {
    SCOPES = buildScopes();
    activeScopes = detectCurrentSection();
    injectScopeBar();
  });
})();
