/* Explains the second sign-in above the comment box.
 *
 * Comments run on GitHub Discussions through giscus, which is an iframe served
 * from giscus.app. Its GitHub session lives on that origin, so a reader who has
 * already signed in to this site still has to sign in to giscus once. There is
 * no way around it: the browser's same-origin policy is what keeps the two
 * sessions apart, and giscus exposes no API to hand a session in.
 *
 * Without a word of explanation that reads as broken ("I just signed in, why is
 * it asking again?"). One sentence turns it into an understood boundary. Shown
 * only to signed-in readers, since nobody else has a reason to wonder.
 *
 * The script also owns where the widget lands in the page grid. See fix 3
 * below and COMMENTS ROW in styles.css.
 */
(function () {
  'use strict';

  /* ---------------------------------------------------------------------
     The initialization fixes below must run at parse time, not on
     DOMContentLoaded.
     Quarto calls loadGiscus() inline at the end of <body>, which is before
     DOMContentLoaded fires but after this script (injected at the top of
     <body>) has already executed.
     --------------------------------------------------------------------- */

  /* 1. One page, one thread.
     GitHub Pages serves an index page at both /x/ and /x/index.html. Comments
     are keyed by pathname, so the same page could collect two separate
     threads depending on which URL the reader arrived through. Collapsing to
     the directory form makes the key single-valued. Relative links are
     unaffected: /x/index.html and /x/ resolve against the same base. */
  var p = window.location.pathname;
  if (/\/index\.html$/.test(p) && window.history && history.replaceState) {
    try {
      history.replaceState(null, '',
        p.replace(/index\.html$/, '') + window.location.search + window.location.hash);
    } catch (e) {}
  }

  /* 2. Exact thread matching and initial theme.
     By default giscus resolves a thread through the GitHub search API, which
     matches partially, so pages with similar paths can surface each other's
     comments. Strict mode keys on a hash of the term instead. Quarto's giscus
     config is a closed schema with no "strict" option, so the flag is set on
     the script element on its way into the document. Quarto also creates its
     giscus theme inputs after theme-toggle.js runs, so the saved theme URL is
     applied to that same script element before the iframe loads. The patch
     removes itself after the one element it is looking for. */
  var appendChild = Node.prototype.appendChild;

  /* 3. A grid row of its own.
     Quarto appends the giscus script to #quarto-content, which is the page's
     CSS grid, and giscus inserts its container right after the script. That
     leaves the comments as a direct grid child with no row of their own. The
     grid's explicit rows end at page-bottom and both sidebars span content-top
     to page-bottom, so the browser drops the comments into an implicit row
     after the sidebars end. On a page short enough to fit the viewport the
     sidebars stop above the comments and the widget sits in a full-width band
     below the framed body. The script goes into a wrapper instead, and
     styles.css gives that wrapper the explicit comments row. The wrapper takes
     the id that the reading-mode and app-mode rules already hide. */
  function commentsHost(parent) {
    var host = document.getElementById('quarto-comments');
    if (host) return host;
    if (!parent || parent.nodeType !== 1) return parent;
    host = document.createElement('div');
    host.id = 'quarto-comments';
    host.className = 'quarto-comments';
    appendChild.call(parent, host);
    return host;
  }

  Node.prototype.appendChild = function (node) {
    if (node && node.tagName === 'SCRIPT' && /giscus\.app\/client\.js/.test(node.src || '')) {
      node.dataset.strict = '1';
      if (window.siteChrome && typeof window.siteChrome.getGiscusThemeUrl === 'function') {
        node.dataset.theme = window.siteChrome.getGiscusThemeUrl();
      }
      Node.prototype.appendChild = appendChild;
      return appendChild.call(commentsHost(this), node);
    }
    return appendChild.call(this, node);
  };

  var NOTE_ID = 'giscus-signin-note';
  var TEXT = 'Comments are hosted on GitHub Discussions, which keeps its own separate '
           + 'GitHub sign-in. Signing in to this site does not carry over.';

  function removeNote() {
    var existing = document.getElementById(NOTE_ID);
    if (existing) existing.remove();
  }

  function insertNote(giscusEl) {
    if (document.getElementById(NOTE_ID)) return;
    var p = document.createElement('p');
    p.id = NOTE_ID;
    p.className = 'giscus-note';
    p.textContent = TEXT;
    giscusEl.parentNode.insertBefore(p, giscusEl);
  }

  /* giscus injects its container well after this script runs, and only on pages
     that have comments enabled, so wait for it rather than assuming it exists. */
  function whenGiscus(cb) {
    var found = document.querySelector('.giscus');
    if (found) { cb(found); return; }
    if (!document.body) return;
    var obs = new MutationObserver(function () {
      var el = document.querySelector('.giscus');
      if (el) { obs.disconnect(); cb(el); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () { obs.disconnect(); }, 20000);
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!window.siteAuth) return;
    window.siteAuth.onChange(function (user) {
      if (!user) { removeNote(); return; }
      whenGiscus(insertNote);
    });
  });
})();
