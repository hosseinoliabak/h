(function () {
  // Tracks the last 5 distinct content pages the visitor read, in this browser
  // only (localStorage, no server). Renders "Continue Where You Left Off" on
  // the home page. Same eligible-page rules as resume-reading.js: skip the
  // home page itself and the /tools/ utility pages (nothing to "continue" there).

  var STORAGE_KEY = "visit-history";
  var MAX_ENTRIES = 5;

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
    return document.title.replace(" - Hossein's Notes", "").trim();
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

    var list = load();
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
  });
})();
