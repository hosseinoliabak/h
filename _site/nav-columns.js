// Multi-column navbar dropdowns.
// Any navbar dropdown with two or more category headers is laid out as a
// grid on desktop, one column per category. Items before the first header
// (e.g. Overview) span all columns. Below the lg breakpoint the menu falls
// back to Bootstrap's normal list.
(function () {
  function isToolsMenu(menu) {
    var toggle = menu.parentElement && menu.parentElement.querySelector(".dropdown-toggle");
    return !!toggle && toggle.textContent.trim() === "Tools";
  }

  function addToolsSearch(menu) {
    if (!isToolsMenu(menu) || menu.querySelector(".tools-menu-search")) return;

    var overview = menu.querySelector(".dropdown-item");
    if (!overview) return;

    var item = document.createElement("li");
    item.className = "tools-menu-search";
    var icon = document.createElement("span");
    icon.className = "tools-menu-search-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = '<svg viewBox="0 0 16 16" focusable="false"><path d="m11.74 10.6 3.04 3.04-1.14 1.14-3.04-3.04a6 6 0 1 1 1.14-1.14ZM6.5 11A4.5 4.5 0 1 0 6.5 2a4.5 4.5 0 0 0 0 9Z"/></svg>';
    var input = document.createElement("input");
    input.type = "search";
    input.className = "tools-menu-search-input";
    input.placeholder = "Search tools";
    input.setAttribute("aria-label", "Search tools");
    input.autocomplete = "off";
    item.appendChild(icon);
    item.appendChild(input);
    overview.closest("li").insertAdjacentElement("afterend", item);

    var empty = document.createElement("li");
    empty.className = "tools-menu-empty";
    empty.textContent = "No matching tools";
    empty.hidden = true;
    item.insertAdjacentElement("afterend", empty);

    function filterTools() {
      var query = input.value.trim().toLowerCase();
      var groups = [];
      var current = null;
      Array.from(menu.children).forEach(function (li) {
        if (li.classList.contains("dropdown-header")) {
          current = { header: li, label: li.textContent.toLowerCase(), items: [] };
          groups.push(current);
        } else if (current && li.querySelector(".dropdown-item")) {
          current.items.push(li);
        }
      });

      var matches = 0;
      groups.forEach(function (group) {
        var groupMatches = 0;
        group.items.forEach(function (li) {
          var label = group.label + " " + li.textContent.toLowerCase();
          var visible = !query || label.indexOf(query) !== -1;
          li.hidden = !visible;
          if (visible) groupMatches++;
        });
        group.header.hidden = groupMatches === 0;
        matches += groupMatches;
      });
      empty.hidden = !query || matches !== 0;
    }

    // Bootstrap normally closes a menu after a click within it. Typing in the
    // filter is an interaction with the menu, not a request to dismiss it.
    ["click", "mousedown", "keydown"].forEach(function (eventName) {
      input.addEventListener(eventName, function (event) { event.stopPropagation(); });
    });
    input.addEventListener("input", filterTools);
    input.addEventListener("search", filterTools);
  }

  function apply() {
    document.querySelectorAll(".navbar .dropdown-menu").forEach(function (menu) {
      addToolsSearch(menu);
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
        if (li.classList.contains("tools-menu-search")) {
          li.style.gridColumn = "-2 / -1";
          li.style.gridRow = "1";
          return;
        }
        if (li.classList.contains("tools-menu-empty")) {
          li.style.gridColumn = "1 / -1";
          li.style.gridRow = "2";
          return;
        }
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
