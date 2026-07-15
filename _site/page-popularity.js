(function () {
  // Tracks view counts for "first child" pages only — the ones linked
  // directly from a navbar dropdown menu (section landing pages like
  // Advanced Learning Algorithms or Calculus, and flat pages like the Tools).
  // Deep lesson pages are never counted, so the Firebase SDK never loads
  // there either — this script is a no-op on ~85% of pages.
  //
  // The site's Firebase Realtime Database enforces App Check (verified by a
  // 401 on a bare, unauthenticated REST call), so a plain fetch() cannot
  // write or read here. The compat SDK + App Check must be loaded, same as
  // tools/pastebin.qmd, and only on the pages that actually need it.

  var FIREBASE_CONFIG = {
    apiKey: "AIzaSyDpRFBtX8LUmZmEX7VcIeMxQKQOtLVdf-A",
    authDomain: "oliabak-paste.firebaseapp.com",
    databaseURL: "https://oliabak-paste-default-rtdb.firebaseio.com",
    projectId: "oliabak-paste",
    storageBucket: "oliabak-paste.firebasestorage.app",
    messagingSenderId: "968986695208",
    appId: "1:968986695208:web:fc5f3d37911810b2e0471d"
  };
  var RECAPTCHA_SITE_KEY = "6LdhmdosAAAAAGh4ojYqXCU0JOeVo3X-R1qmMaZq";
  var FIREBASE_SCRIPTS = [
    "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js",
    "https://www.gstatic.com/firebasejs/10.12.0/firebase-database-compat.js",
    "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check-compat.js"
  ];
  var TOP_N = 5;

  function normPath(href) {
    if (!href) return null;
    try {
      return new URL(href, window.location.href).pathname.replace(/^\/+/, "");
    } catch (e) {
      return null;
    }
  }

  // Collapse a path to a Firebase-safe key: strip index.html/trailing slash,
  // strip extension, then replace directory separators.
  //   "machine-learning/advanced-learning-algorithms/index.html" -> "machine-learning--advanced-learning-algorithms"
  //   "tools/pastebin.html"                                      -> "tools--pastebin"
  function toKey(path) {
    var p = path.replace(/index\.html?$/, "").replace(/\/+$/, "").replace(/\.html?$/, "");
    return p.replace(/\//g, "--");
  }

  // Build { key: { label, href } } from every navbar dropdown link, so this
  // stays automatic as sections are added or renamed — no hardcoded list.
  function collectTrackablePages() {
    var map = {};
    document.querySelectorAll(".navbar .dropdown, .navbar .nav-item.dropdown").forEach(function (dd) {
      var toggle = dd.querySelector(".dropdown-toggle");
      var dropdownLabel = toggle ? (toggle.textContent || "").trim() : "";
      dd.querySelectorAll(".dropdown-menu a[href]").forEach(function (a) {
        var href = a.getAttribute("href");
        if (!href || href.charAt(0) === "#") return;
        var url;
        try {
          url = new URL(href, window.location.href);
        } catch (e) {
          return;
        }
        if (url.hostname !== window.location.hostname) return; // skip external (e.g. Sponsor)
        var path = normPath(href);
        if (!path || !/\.html?$/.test(path)) return; // skip pages not yet rendered (unresolved .qmd links)
        var text = (a.textContent || "").trim();
        if (!text) return;
        // "Overview" is ambiguous out of context; use the dropdown's own label instead.
        var label = /^overview$/i.test(text) ? dropdownLabel : text;
        var key = toKey(path);
        if (key) map[key] = { label: label, href: "/" + path };
      });
    });
    return map;
  }

  function loadScriptsThen(callback) {
    var i = 0;
    function next() {
      if (i >= FIREBASE_SCRIPTS.length) return callback();
      var s = document.createElement("script");
      s.src = FIREBASE_SCRIPTS[i];
      s.onload = function () {
        i++;
        next();
      };
      s.onerror = function () {
        // Network/adblock failure — fail silently, no counting/rendering this visit.
      };
      document.head.appendChild(s);
    }
    next();
  }

  function initFirebase() {
    firebase.initializeApp(FIREBASE_CONFIG);
    var appCheck = firebase.appCheck();
    appCheck.activate(RECAPTCHA_SITE_KEY, true);
    return firebase.database();
  }

  function recordView(db, key) {
    var guard = "pv-tracked-" + key;
    try {
      if (sessionStorage.getItem(guard)) return;
    } catch (e) {
      // sessionStorage unavailable — fall through and attempt the write anyway.
    }
    db.ref("pageviews/" + key).set(firebase.database.ServerValue.increment(1))
      .then(function () {
        try { sessionStorage.setItem(guard, "1"); } catch (e) {}
      })
      .catch(function (err) {
        // Only set the guard on success, so a failed write (rules not yet
        // published, App Check hiccup, ...) gets retried on the next visit
        // instead of being silently locked out for the rest of the session.
        console.error("page-popularity: failed to record view for", key, err);
      });
  }

  function renderTopPages(db, pageMap) {
    var container = document.getElementById("top-pages-section");
    if (!container) return;

    db.ref("pageviews").once("value").then(function (snap) {
      var counts = snap.val() || {};
      var ranked = Object.keys(counts)
        .filter(function (key) { return pageMap[key]; })
        .map(function (key) { return { key: key, count: counts[key], info: pageMap[key] }; })
        .sort(function (a, b) { return b.count - a.count; })
        .slice(0, TOP_N);

      if (ranked.length === 0) {
        container.innerHTML = '<p class="empty-state">No views recorded yet.</p>';
        return;
      }

      var ul = document.createElement("ul");
      ul.className = "top-pages-list";
      ranked.forEach(function (item) {
        var li = document.createElement("li");
        var a = document.createElement("a");
        a.href = item.info.href;
        a.textContent = item.info.label;
        var count = document.createElement("span");
        count.className = "top-pages-count";
        count.textContent = item.count + (item.count === 1 ? " view" : " views");
        li.appendChild(a);
        li.appendChild(count);
        ul.appendChild(li);
      });
      container.innerHTML = "";
      container.appendChild(ul);
    }).catch(function () {
      container.innerHTML = '<p class="empty-state">Couldn’t load top pages right now.</p>';
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var pageMap = collectTrackablePages();
    var currentKey = toKey(window.location.pathname.replace(/^\/+/, ""));
    var isHome = window.location.pathname === "/" || window.location.pathname === "/index.html";

    var needsWrite = !isHome && !!pageMap[currentKey];
    var needsRead = isHome && !!document.getElementById("top-pages-section");
    if (!needsWrite && !needsRead) return; // no-op on deep lesson pages

    loadScriptsThen(function () {
      var db = initFirebase();
      if (needsWrite) recordView(db, currentKey);
      if (needsRead) renderTopPages(db, pageMap);
    });
  });
})();
