(function () {
  "use strict";

  function revealActiveLink(sidebar) {
    var activeLink = sidebar.querySelector(
      ".sidebar-link.active, .sidebar-link[aria-current='page']"
    );

    if (!activeLink || sidebar.clientHeight <= 0) return;
    if (sidebar.scrollHeight <= sidebar.clientHeight) return;

    var sidebarRect = sidebar.getBoundingClientRect();
    var activeRect = activeLink.getBoundingClientRect();
    var visibleTop = Math.max(sidebarRect.top, 0);
    var visibleBottom = Math.min(sidebarRect.bottom, window.innerHeight);
    var progress = document.getElementById("section-progress-widget");

    if (progress && progress.parentElement === sidebar) {
      var progressRect = progress.getBoundingClientRect();
      var overlapsSidebar =
        progressRect.height > 0 &&
        progressRect.top < visibleBottom &&
        progressRect.bottom > visibleTop;

      if (overlapsSidebar) {
        visibleBottom = Math.min(visibleBottom, progressRect.top);
      }
    }

    var visibleHeight = visibleBottom - visibleTop;
    if (visibleHeight <= 0) return;

    var isVisible =
      activeRect.top >= visibleTop &&
      activeRect.bottom <= visibleBottom;

    if (isVisible) return;

    var centeredTop =
      sidebar.scrollTop +
      activeRect.top -
      visibleTop -
      (visibleHeight - activeRect.height) / 2;
    var maxScrollTop = sidebar.scrollHeight - sidebar.clientHeight;

    sidebar.scrollTop = Math.max(0, Math.min(centeredTop, maxScrollTop));
  }

  function queueReveal(sidebar) {
    window.setTimeout(function () {
      revealActiveLink(sidebar);
    }, 0);
  }

  function initialize() {
    var sidebar = document.getElementById("quarto-sidebar");
    if (!sidebar) return;

    // Run after every DOMContentLoaded listener has finished. The reading-time
    // filter moves its sticky progress widget into the sidebar during that event.
    queueReveal(sidebar);

    // Quarto resolves the fixed header after initial layout. Watching the sidebar
    // catches that height change without relying on a matching timeout.
    if (window.ResizeObserver) {
      var resizeObserver = new window.ResizeObserver(function () {
        revealActiveLink(sidebar);
      });
      resizeObserver.observe(sidebar);
    } else {
      window.setTimeout(function () {
        revealActiveLink(sidebar);
      }, 350);
    }

    // Bootstrap fires this after the collapsed mobile sidebar becomes measurable.
    sidebar.addEventListener("shown.bs.collapse", function (event) {
      if (event.target !== sidebar) return;
      revealActiveLink(sidebar);
    });

    window.addEventListener("pageshow", function () {
      queueReveal(sidebar);
    });

    var windowResizeTimer;
    window.addEventListener("resize", function () {
      window.clearTimeout(windowResizeTimer);
      windowResizeTimer = window.setTimeout(function () {
        revealActiveLink(sidebar);
      }, 100);
    });

    document.addEventListener("sitechrome:change", function () {
      queueReveal(sidebar);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
