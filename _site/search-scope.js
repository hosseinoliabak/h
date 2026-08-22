(function() {
  'use strict';

  // Search scopes are derived from the navbar at load time.
  // One scope can cover several content roots.
  var SCOPES = [{ label: 'All', prefixes: [] }];

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

  // Only a directory or index link establishes a subject scope. Regular
  // pages remain inside their parent courses instead of becoming subjects.
  function toScopePrefix(path) {
    if (!path) return null;
    if (path.charAt(path.length - 1) === '/') return path;

    var slash = path.lastIndexOf('/');
    var filename = slash === -1 ? path : path.slice(slash + 1);
    if (/^index\.(?:html?|qmd)$/i.test(filename)) {
      return slash === -1 ? null : path.slice(0, slash + 1);
    }

    return null;
  }

  // Remove duplicates and descendants already covered by a directory root.
  function compactPrefixes(prefixes) {
    var sorted = prefixes.slice().sort(function(a, b) {
      return a.length - b.length || a.localeCompare(b);
    });
    var compacted = [];

    sorted.forEach(function(prefix) {
      var covered = compacted.some(function(existing) {
        return existing === prefix ||
          (existing.charAt(existing.length - 1) === '/' && prefix.startsWith(existing));
      });
      if (!covered) compacted.push(prefix);
    });

    return compacted;
  }

  function pathMatchesPrefix(path, prefix) {
    if (prefix.charAt(prefix.length - 1) === '/') {
      return path.startsWith(prefix);
    }
    return path === prefix;
  }

  // Derive one chip per top-level menu that has a section index. Every
  // directory represented by that menu becomes part of the same scope.
  function buildScopes() {
    var scopes = [{ label: 'All', prefixes: [] }];

    document.querySelectorAll('.navbar .navbar-nav > li.nav-item').forEach(function(li) {
      var toggle = li.querySelector('.nav-link');
      if (!toggle) return;
      var label = toggle.textContent.trim();
      if (!label) return;

      var links = li.querySelectorAll('.dropdown-menu a[href]');
      if (links.length === 0) links = [toggle];

      var prefixes = [];
      var hasDirectoryRoot = false;
      links.forEach(function(a) {
        var path = toSitePath(a.getAttribute('data-original-href') || a.getAttribute('href'));
        if (path === null) return;
        var prefix = toScopePrefix(path);
        if (prefix === null) return;
        prefixes.push(prefix);
        if (prefix.charAt(prefix.length - 1) === '/') hasDirectoryRoot = true;
      });

      // Utility menus without a section index, such as About, stay unscoped.
      if (hasDirectoryRoot) {
        scopes.push({ label: label, prefixes: compactPrefixes(prefixes) });
      }
    });

    return scopes;
  }

  // Active scope indexes. An empty array means All with no filtering.
  var activeScopeIndexes = [];

  // Detect the current section from the URL and default to it
  function detectCurrentSection() {
    var path = window.location.pathname.replace(/^\//, '');
    var bestScopeIndex = -1;
    var bestPrefixLength = -1;

    for (var i = 1; i < SCOPES.length; i++) {
      SCOPES[i].prefixes.forEach(function(prefix) {
        if (pathMatchesPrefix(path, prefix) && prefix.length > bestPrefixLength) {
          bestScopeIndex = i;
          bestPrefixLength = prefix.length;
        }
      });
    }

    return bestScopeIndex === -1 ? [] : [bestScopeIndex];
  }

  // Create the scope filter bar
  function createScopeBar() {
    var bar = document.createElement('div');
    bar.id = 'search-scope-bar';

    SCOPES.forEach(function(scope, scopeIndex) {
      var pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'search-scope-pill';
      pill.textContent = scope.label;
      pill.dataset.scopeIndex = String(scopeIndex);

      // Set initial active state
      if (scopeIndex === 0 && activeScopeIndexes.length === 0) {
        pill.classList.add('active');
        pill.setAttribute('aria-pressed', 'true');
      } else if (activeScopeIndexes.indexOf(scopeIndex) !== -1) {
        pill.classList.add('active');
        pill.setAttribute('aria-pressed', 'true');
      } else {
        pill.setAttribute('aria-pressed', 'false');
      }

      pill.addEventListener('click', function() {
        if (scopeIndex === 0) {
          // "All" clears all other selections
          activeScopeIndexes = [];
        } else {
          // Toggle this scope
          var idx = activeScopeIndexes.indexOf(scopeIndex);
          if (idx !== -1) {
            activeScopeIndexes.splice(idx, 1);
          } else {
            activeScopeIndexes.push(scopeIndex);
          }
        }

        // Update pill states
        bar.querySelectorAll('.search-scope-pill').forEach(function(p) {
          var index = Number(p.dataset.scopeIndex);
          var active = index === 0
            ? activeScopeIndexes.length === 0
            : activeScopeIndexes.indexOf(index) !== -1;
          p.classList.toggle('active', active);
          p.setAttribute('aria-pressed', String(active));
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
    if (activeScopeIndexes.length === 0) {
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

      var matches = activeScopeIndexes.some(function(scopeIndex) {
        return SCOPES[scopeIndex].prefixes.some(function(prefix) {
          return pathMatchesPrefix(normalized, prefix);
        });
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
      if (injected && activeScopeIndexes.length > 0) {
        filterResults();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Initialize
  document.addEventListener('DOMContentLoaded', function() {
    SCOPES = buildScopes();
    activeScopeIndexes = detectCurrentSection();
    injectScopeBar();
  });
})();
