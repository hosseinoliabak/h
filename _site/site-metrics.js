/* Aggregate page-view collection.
 *
 * A page is counted once per browser tab session. Page-view writes use App
 * Check, and both metric calls apply network and global quotas. No reader
 * account identifier or raw network address is stored. The backend temporarily
 * keeps a keyed daily network token only to enforce fair-use limits. Local
 * previews and noncanonical hosts never send data.
 */
(function () {
  'use strict';

  var PRODUCTION_ORIGIN = 'https://h.oliabak.com';
  var SESSION_PREFIX = 'site-metric-viewed:';
  var DASHBOARD_CACHE_KEY = 'site-metric-dashboard:v1';
  var DASHBOARD_CACHE_TTL_MS = 10 * 60 * 1000;
  var MAX_DASHBOARD_CACHE_CHARS = 512 * 1024;
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

  function clearDashboardCache() {
    try { window.sessionStorage.removeItem(DASHBOARD_CACHE_KEY); } catch (error) {}
  }

  function readDashboardCache() {
    var source;
    try { source = window.sessionStorage.getItem(DASHBOARD_CACHE_KEY); } catch (error) { return null; }
    if (!source) return null;
    if (source.length > MAX_DASHBOARD_CACHE_CHARS) {
      clearDashboardCache();
      return null;
    }
    try {
      var envelope = JSON.parse(source);
      if (!envelope || !Number.isSafeInteger(envelope.cachedAt)
          || !envelope.data || typeof envelope.data !== 'object' || Array.isArray(envelope.data)
          || envelope.data.schemaVersion !== 1) {
        clearDashboardCache();
        return null;
      }
      var age = Date.now() - envelope.cachedAt;
      if (age < 0 || age > DASHBOARD_CACHE_TTL_MS) {
        clearDashboardCache();
        return null;
      }
      return envelope.data;
    } catch (error) {
      clearDashboardCache();
      return null;
    }
  }

  function writeDashboardCache(data) {
    try {
      var source = JSON.stringify({ cachedAt: Date.now(), data: data });
      if (source.length <= MAX_DASHBOARD_CACHE_CHARS) {
        window.sessionStorage.setItem(DASHBOARD_CACHE_KEY, source);
      }
    } catch (error) {}
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
    var cached = readDashboardCache();
    if (cached) return Promise.resolve(cached);
    if (dashboardRequest) return dashboardRequest;
    dashboardRequest = functionsService('publicFirebaseFunctions').then(function (functions) {
      var callable = functions.httpsCallable('getSiteMetrics', { timeout: 15000 });
      return callable({});
    }).then(function (result) {
      writeDashboardCache(result.data);
      dashboardRequest = null;
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
