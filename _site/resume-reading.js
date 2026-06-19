(function() {
  'use strict';

  var STORAGE_KEY = 'resume-reading';
  var SCROLL_DEBOUNCE_MS = 1000;
  var MIN_SCROLL_PERCENT = 5; // Don't save if barely scrolled

  // Pages to ignore (home page, index pages, tool pages)
  function shouldTrack() {
    var path = window.location.pathname;
    if (path === '/' || path === '/index.html') return false;
    if (path.match(/\/tools\//)) return false;
    return true;
  }

  // Get a readable title for the current page
  function getPageTitle() {
    var titleEl = document.querySelector('h1.title, .quarto-title h1, h1');
    if (titleEl) return titleEl.textContent.trim();
    return document.title.replace(" - Hossein's Notes", '').trim();
  }

  // Get scroll percentage
  function getScrollPercent() {
    var scrollTop = window.scrollY || document.documentElement.scrollTop;
    var docHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (docHeight <= 0) return 0;
    return Math.round((scrollTop / docHeight) * 100);
  }

  // Save progress
  function saveProgress() {
    if (!shouldTrack()) return;
    var percent = getScrollPercent();
    if (percent < MIN_SCROLL_PERCENT) return;

    var data = {
      path: window.location.pathname,
      title: getPageTitle(),
      scrollPercent: percent,
      scrollY: window.scrollY,
      timestamp: Date.now()
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      // Storage full or unavailable — silently fail
    }
  }

  // Load saved progress
  function loadProgress() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  // Check if saved page is the current page
  function isCurrentPage(data) {
    return data && data.path === window.location.pathname;
  }

  // Debounce helper
  function debounce(fn, ms) {
    var timer;
    return function() {
      clearTimeout(timer);
      timer = setTimeout(fn, ms);
    };
  }

  // Truncate title for display
  function truncateTitle(title, maxLen) {
    if (title.length <= maxLen) return title;
    return title.substring(0, maxLen - 1) + '…';
  }

  // Build the resume reading button and insert it in the navbar
  function createResumeButton(data) {
    // Don't show button if we're already on that page
    if (isCurrentPage(data)) return;

    // Don't show if the data is older than 30 days
    var thirtyDays = 30 * 24 * 60 * 60 * 1000;
    if (Date.now() - data.timestamp > thirtyDays) return;

    var container = document.createElement('div');
    container.id = 'resume-reading-container';

    var btn = document.createElement('a');
    btn.href = data.path;
    btn.id = 'resume-reading-btn';
    btn.title = 'Resume: ' + data.title + ' (' + data.scrollPercent + '% read)';
    btn.innerHTML = '📖 Resume: <strong>' + truncateTitle(data.title, 25) + '</strong> <small>(' + data.scrollPercent + '%)</small>';
    btn.style.cssText = 'text-decoration:none;';

    btn.addEventListener('mouseenter', function() {
      btn.style.opacity = '1';
    });
    btn.addEventListener('mouseleave', function() {
      btn.style.opacity = '';
    });

    // Dismiss button
    var dismiss = document.createElement('span');
    dismiss.innerHTML = '&times;';
    dismiss.title = 'Dismiss';
    dismiss.style.cssText = [
      'margin-left:6px',
      'cursor:pointer',
      'font-size:1rem',
      'line-height:1',
      'opacity:0.7'
    ].join(';');
    dismiss.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      container.remove();
      localStorage.removeItem(STORAGE_KEY);
    });

    btn.appendChild(dismiss);
    container.appendChild(btn);

    // Insert into the navbar-tools area (far right of navbar)
    var navTools = document.querySelector('.quarto-navbar-tools');
    if (navTools) {
      navTools.insertBefore(container, navTools.firstChild);
    } else {
      // Fallback: append to navbar container
      var navbar = document.querySelector('.navbar-container');
      if (navbar) navbar.appendChild(container);
    }
  }

  // On click, navigate and restore scroll position
  function handleResume(data) {
    // Store scroll target for after page load
    if (isCurrentPage(data)) {
      window.scrollTo({ top: data.scrollY, behavior: 'smooth' });
    }
  }

  // Restore scroll if we just navigated to the saved page
  function restoreScroll() {
    var data = loadProgress();
    if (data && isCurrentPage(data)) {
      // Small delay to let the page render
      setTimeout(function() {
        window.scrollTo({ top: data.scrollY, behavior: 'smooth' });
      }, 300);
    }
  }

  // Initialize
  document.addEventListener('DOMContentLoaded', function() {
    var data = loadProgress();

    // Show resume button if there's saved progress for a different page
    if (data && !isCurrentPage(data)) {
      createResumeButton(data);
    }

    // Restore scroll if on the saved page
    if (data && isCurrentPage(data)) {
      restoreScroll();
    }

    // Track scroll on content pages
    if (shouldTrack()) {
      window.addEventListener('scroll', debounce(saveProgress, SCROLL_DEBOUNCE_MS));
      // Also save on page unload
      window.addEventListener('beforeunload', saveProgress);
    }
  });
})();
