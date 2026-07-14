(function () {
  // Builds a breadcrumb path (e.g. Math › Linear Algebra › Current Page) into the
  // title metadata block, next to Published / Reading Time / Difficulty.
  // Labels come from the navbar so acronyms stay correct (CCDE, PCA, ...), with a
  // title-cased fallback for anything the navbar does not name. When the trail is
  // too wide for one line it collapses to: first › … › second-last › last.

  document.addEventListener("DOMContentLoaded", function () {
    var meta = document.querySelector(".quarto-title-meta");
    if (!meta) return;

    // --- Resolve any href to a root-relative "dir/dir/file.html" path -----------
    function normPath(href) {
      if (!href) return null;
      try {
        return new URL(href, window.location.href).pathname.replace(/^\/+/, "");
      } catch (e) {
        return null;
      }
    }

    // --- Label lookups built from the navbar -----------------------------------
    var pathToText = {};   // "machine-learning/.../index.html" -> "Advanced Learning Algorithms"
    var topSegToText = {}; // "machine-learning"                -> "Machine Learning"

    document.querySelectorAll(".navbar a[href]").forEach(function (a) {
      var href = a.getAttribute("href");
      // Dropdown toggles use href="#", which resolves to the current page and
      // would clobber that page's real label. Skip fragment-only links.
      if (!href || href.charAt(0) === "#") return;
      var p = normPath(href);
      var t = (a.textContent || "").trim();
      if (p && t) pathToText[p] = t;
    });

    document.querySelectorAll(".navbar .dropdown, .navbar .nav-item.dropdown")
      .forEach(function (dd) {
        var toggle = dd.querySelector(".dropdown-toggle");
        var label = toggle ? (toggle.textContent || "").trim() : "";
        if (!label) return;
        dd.querySelectorAll(".dropdown-menu a[href]").forEach(function (a) {
          var p = normPath(a.getAttribute("href"));
          if (!p) return;
          var seg = p.split("/")[0];
          if (seg && !topSegToText[seg]) topSegToText[seg] = label;
        });
      });

    function titleCase(slug) {
      return slug.replace(/-/g, " ").replace(/\b\w/g, function (c) {
        return c.toUpperCase();
      });
    }

    // --- Work out the crumbs from the current URL ------------------------------
    var parts = window.location.pathname.replace(/^\/+/, "").split("/");
    var file = parts.pop() || "";
    var dirs = parts.filter(Boolean);
    if (dirs.length === 0) return; // top-level page: nothing to trail

    var isIndex = /^index\.html?$/.test(file) || file === "";

    var crumbs = [];
    dirs.forEach(function (dir, i) {
      var indexPath = dirs.slice(0, i + 1).join("/") + "/index.html";
      var label = i === 0
        ? (topSegToText[dir] || pathToText[indexPath] || titleCase(dir))
        : (pathToText[indexPath] || titleCase(dir));
      crumbs.push({ label: label, href: "/" + indexPath });
    });

    // Final crumb: the current page (no link).
    if (isIndex) {
      // Section landing page: the last dir already is this page, drop its link.
      crumbs[crumbs.length - 1].href = null;
    } else {
      var h1 = document.querySelector("h1.title, .quarto-title h1, #title-block-header h1");
      var pageLabel = h1 ? (h1.textContent || "").trim() : (document.title || "").split("–")[0].trim();
      if (pageLabel) crumbs.push({ label: pageLabel, href: null });
    }

    if (crumbs.length < 2) return;

    // --- Build the DOM ----------------------------------------------------------
    var wrap = document.createElement("div");
    wrap.className = "crumb-path-item";

    var nav = document.createElement("nav");
    nav.className = "crumb-path";
    nav.setAttribute("aria-label", "breadcrumb");
    wrap.appendChild(nav);

    function makeSep() {
      var s = document.createElement("span");
      s.className = "crumb-sep";
      s.setAttribute("aria-hidden", "true");
      s.textContent = "›";
      return s;
    }

    function makeCrumb(c) {
      if (c.ellipsis) {
        var e = document.createElement("span");
        e.className = "crumb-ellipsis";
        e.textContent = "…";
        return e;
      }
      var el = document.createElement(c.href ? "a" : "span");
      el.className = "crumb" + (c.href ? "" : " crumb-current");
      el.textContent = c.label;
      if (c.href) el.setAttribute("href", c.href);
      else el.setAttribute("aria-current", "page");
      return el;
    }

    function render(collapsed) {
      nav.innerHTML = "";
      var items = crumbs;
      if (collapsed && crumbs.length > 3) {
        items = [crumbs[0], { ellipsis: true },
                 crumbs[crumbs.length - 2], crumbs[crumbs.length - 1]];
      }
      items.forEach(function (c, i) {
        if (i > 0) nav.appendChild(makeSep());
        nav.appendChild(makeCrumb(c));
      });
    }

    function fit() {
      render(false);
      if (nav.scrollWidth > nav.clientWidth + 1) render(true);
    }

    // Place the trail just above the meta grid, as its own full-width row.
    meta.parentNode.insertBefore(wrap, meta);
    fit();

    var t;
    window.addEventListener("resize", function () {
      clearTimeout(t);
      t = setTimeout(fit, 150);
    });
  });
})();
