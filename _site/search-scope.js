(function() {
  'use strict';

  // Define search scopes based on site sections
  var SCOPES = [
    { label: 'All',           prefix: '' },
    { label: 'Math',          prefix: 'math/' },
    { label: 'AI',            prefix: 'ai/' },
    { label: 'Networking',    prefix: 'networking/' },
    { label: 'Tools',         prefix: 'tools/' }
  ];

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

      var href = link.getAttribute('href');
      // Normalize: remove leading ./ or / or ../
      var normalized = href.replace(/^(\.\.\/)*/, '').replace(/^\.?\//, '');

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
    activeScopes = detectCurrentSection();
    injectScopeBar();
  });
})();
