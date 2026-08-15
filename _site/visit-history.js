(function () {
  // Tracks the last 3 distinct content pages the visitor read, in this browser
  // only (localStorage, no server). Renders "Continue Where You Left Off" on
  // the home page. Same eligible-page rules as resume-reading.js: skip the
  // home page itself and the /tools/ utility pages (nothing to "continue" there).

  var STORAGE_KEY = "visit-history";
  var MAX_ENTRIES = 3;

  function isHome(path) {
    return path === "/" || path === "/index.html";
  }

  function shouldTrack(path) {
    if (isHome(path)) return false;
    if (path.match(/\/tools\//)) return false;
    return true;
  }

  function getPageTitle() {
    var titleEl = document.querySelector("h1.title, .quarto-title h1, h1");
    if (titleEl) return titleEl.textContent.trim();
    return document.title.replace(" - H's Notes", "").trim();
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function save(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      // Storage full or unavailable — silently fail
    }
  }

  function recordVisit() {
    var path = window.location.pathname;
    if (!shouldTrack(path)) return;

    var list = load().filter(function (e) {
      return e.path !== path;
    });
    list.unshift({ path: path, title: getPageTitle(), timestamp: Date.now() });
    save(list.slice(0, MAX_ENTRIES));
    cloudSave();
  }

  /* ---------------------------- cloud mirror ----------------------------
     Local storage stays the primary copy. When a reader is signed in the same
     short list is mirrored under their own account, so "Continue Where You
     Left Off" follows them between devices. */

  var signedIn = false;

  function cloudRef() {
    if (!signedIn || !window.siteAuth || !window.siteAuth.ref) return null;
    return window.siteAuth.ref('reading/history');
  }

  function cloudSave() {
    var ref = cloudRef();
    if (!ref) return;
    // Shape and limits mirror the database rules exactly.
    var rows = load().slice(0, MAX_ENTRIES).map(function (e) {
      return {
        path: String(e.path).slice(0, 300),
        title: String(e.title || '').slice(0, 200),
        timestamp: e.timestamp || Date.now()
      };
    });
    ref.set(rows)['catch'](function () {});
  }

  /* Union of both copies, newest entry per path, capped at MAX_ENTRIES.
     Merging rather than overwriting means reading on a phone and a laptop
     produces one combined list instead of whichever device synced last. */
  function mergeLists(a, b) {
    var byPath = {};
    a.concat(b).forEach(function (e) {
      if (!e || !e.path) return;
      var cur = byPath[e.path];
      if (!cur || (e.timestamp || 0) > (cur.timestamp || 0)) byPath[e.path] = e;
    });
    return Object.keys(byPath)
      .map(function (k) { return byPath[k]; })
      .sort(function (x, y) { return (y.timestamp || 0) - (x.timestamp || 0); })
      .slice(0, MAX_ENTRIES);
  }

  function timeAgo(ts) {
    var diff = Date.now() - ts;
    var min = Math.floor(diff / 60000);
    if (min < 1) return "just now";
    if (min < 60) return min + (min === 1 ? " minute ago" : " minutes ago");
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + (hr === 1 ? " hour ago" : " hours ago");
    var day = Math.floor(hr / 24);
    return day + (day === 1 ? " day ago" : " days ago");
  }

  function renderOnHome() {
    var container = document.getElementById("continue-reading-section");
    if (!container) return;

    var list = load().slice(0, MAX_ENTRIES);
    if (list.length === 0) {
      container.innerHTML = '<p class="empty-state">Pages you read will show up here.</p>';
      return;
    }

    var ul = document.createElement("ul");
    ul.className = "visit-history-list";
    list.forEach(function (entry) {
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = entry.path;
      a.textContent = entry.title;
      var time = document.createElement("span");
      time.className = "visit-history-time";
      time.textContent = timeAgo(entry.timestamp);
      li.appendChild(a);
      li.appendChild(time);
      ul.appendChild(li);
    });
    container.innerHTML = "";
    container.appendChild(ul);
  }

  document.addEventListener("DOMContentLoaded", function () {
    recordVisit();
    if (isHome(window.location.pathname)) renderOnHome();

    /* Sign-in settles after this point, if at all. Nothing above waits for it. */
    if (window.siteAuth) {
      window.siteAuth.onChange(function (user) {
        signedIn = !!user;
        var ref = cloudRef();
        if (!ref) return;
        ref.once("value").then(function (snap) {
          var remote = snap.val();
          if (!Array.isArray(remote)) remote = remote ? Object.keys(remote).map(function (k) { return remote[k]; }) : [];
          var merged = mergeLists(load(), remote);
          save(merged);
          cloudSave();
          if (isHome(window.location.pathname)) renderOnHome();
        })["catch"](function () {});
      });
    }
  });
})();
