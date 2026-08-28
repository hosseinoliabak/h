/* Aggregate page-view collection.
 *
 * A page is counted once per browser tab session. Page-view writes use App
 * Check, and both metric calls apply network and global quotas. No reader
 * identifier is stored. Local previews and noncanonical hosts never send data.
 */
(function () {
  'use strict';

  var PRODUCTION_ORIGIN = 'https://h.oliabak.com';
  var SESSION_PREFIX = 'site-metric-viewed:';
  var dashboardRequest = null;

  function production() {
    return window.location.origin === PRODUCTION_ORIGIN;
  }

  function normalizedPath() {
    var path = window.location.pathname || '/';
    if (path === '/index.html') return '/';
    if (/\/index\.html$/.test(path)) return path.slice(0, -10) + '/';
    if (path !== '/' && !path.endsWith('/') && !path.endsWith('.html')) return path + '.html';
    return path;
  }

  function validPath(path) {
    return typeof path === 'string'
      && path.length <= 320
      && (path === '/' || /^\/[A-Za-z0-9/_-]+(?:\.html|\/)$/.test(path))
      && !path.includes('//')
      && !path.includes('..');
  }

  function sessionHas(key) {
    try { return window.sessionStorage.getItem(key) === '1'; } catch (error) { return false; }
  }

  function markSession(key) {
    try { window.sessionStorage.setItem(key, '1'); } catch (error) {}
  }

  function functionsService(method) {
    if (!window.siteAuth || typeof window.siteAuth[method] !== 'function') {
      return Promise.reject(new Error('Firebase runtime is unavailable'));
    }
    return window.siteAuth[method]();
  }

  function record() {
    if (!production()) return;
    var path = normalizedPath();
    if (!validPath(path)) return;
    var key = SESSION_PREFIX + path;
    if (sessionHas(key)) return;
    markSession(key);
    functionsService('firebaseFunctions').then(function (functions) {
      var callable = functions.httpsCallable('recordSitePageView', {
        timeout: 15000,
        limitedUseAppCheckTokens: true
      });
      return callable({ path: path });
    }).catch(function () {
      /* Metrics must never interrupt reading. A failed call is intentionally
         not retried during this tab session, which also bounds failure load. */
    });
  }

  function dashboard() {
    if (!production()) return Promise.reject(new Error('Traffic data is available on the published site'));
    if (dashboardRequest) return dashboardRequest;
    dashboardRequest = functionsService('publicFirebaseFunctions').then(function (functions) {
      var callable = functions.httpsCallable('getSiteMetrics', { timeout: 15000 });
      return callable({});
    }).then(function (result) {
      return result.data;
    }).catch(function (error) {
      dashboardRequest = null;
      throw error;
    });
    return dashboardRequest;
  }

  window.siteMetrics = { dashboard: dashboard };

  function start() {
    window.setTimeout(record, 900);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
