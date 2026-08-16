// Multi-column navbar dropdowns.
// Any navbar dropdown with two or more category headers is laid out as a
// grid on desktop, one column per category. Items before the first header
// (e.g. Overview) span all columns. Below the lg breakpoint the menu falls
// back to Bootstrap's normal list.
(function () {
  function addClientInfoLink(menu) {
    var toggle = menu.parentElement && menu.parentElement.querySelector(".dropdown-toggle");
    if (!toggle || toggle.textContent.trim() !== "Tools") return;
    if (menu.querySelector('a[href$="/tools/client-info.html"], a[href="tools/client-info.html"], a[href="../tools/client-info.html"]')) return;

    var networkingHeader = Array.from(menu.querySelectorAll(".dropdown-header")).find(function (header) {
      return header.textContent.trim() === "Networking";
    });
    if (!networkingHeader) return;

    var item = document.createElement("li");
    var link = document.createElement("a");
    var text = document.createElement("span");
    item.className = "nav-item";
    link.className = "dropdown-item";
    link.href = "/tools/client-info.html";
    text.className = "dropdown-text";
    text.textContent = "Client Info";
    link.appendChild(text);
    item.appendChild(link);
    networkingHeader.insertAdjacentElement("afterend", item);
  }

  function apply() {
    document.querySelectorAll(".navbar .dropdown-menu").forEach(function (menu) {
      addClientInfoLink(menu);
      if (menu.classList.contains("dropdown-multicol")) return;
      if (menu.querySelectorAll(".dropdown-header").length < 2) return;

      var leading = [];
      var groups = [];
      var current = null;
      Array.from(menu.children).forEach(function (li) {
        if (li.querySelector("hr.dropdown-divider")) {
          li.classList.add("dd-divider-hidden");
          return;
        }
        if (li.classList.contains("dropdown-header")) {
          current = { header: li, items: [] };
          groups.push(current);
        } else if (current) {
          current.items.push(li);
        } else {
          leading.push(li);
        }
      });
      if (groups.length < 2) return;

      var row = 1;
      leading.forEach(function (li) {
        li.style.gridColumn = "1 / -1";
        li.style.gridRow = row++;
      });
      var firstGroupRow = row;
      groups.forEach(function (g, c) {
        var r = firstGroupRow;
        g.header.style.gridColumn = c + 1;
        g.header.style.gridRow = r++;
        g.items.forEach(function (li) {
          li.style.gridColumn = c + 1;
          li.style.gridRow = r++;
        });
      });

      menu.classList.add("dropdown-multicol");
      menu.style.setProperty("--dd-cols", groups.length);

      // Keep the widened menu inside the viewport on narrower desktops.
      menu.parentElement.addEventListener("shown.bs.dropdown", function () {
        menu.style.transform = "";
        var rect = menu.getBoundingClientRect();
        var overflow = rect.right - (window.innerWidth - 8);
        if (overflow > 0) {
          menu.style.transform =
            "translateX(-" + Math.min(overflow, Math.max(rect.left - 8, 0)) + "px)";
        }
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply);
  } else {
    apply();
  }
})();
