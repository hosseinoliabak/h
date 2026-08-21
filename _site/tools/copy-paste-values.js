/* Copy Paste Values tool */
(function () {
  "use strict";

  const MAX_INPUT_CHARACTERS = 2 * 1024 * 1024;
  const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);
  const DROP_ENTIRELY = new Set([
    "APPLET", "AUDIO", "BASE", "BUTTON", "CANVAS", "EMBED", "FORM", "FRAME",
    "FRAMESET", "IFRAME", "INPUT", "LINK", "MATH", "META", "NOSCRIPT",
    "OBJECT", "PICTURE", "SCRIPT", "SELECT", "SOURCE", "STYLE", "SVG",
    "TEMPLATE", "TEXTAREA", "VIDEO"
  ]);
  const TAG_MAP = new Map([
    ["A", "a"], ["B", "strong"], ["BLOCKQUOTE", "blockquote"], ["BR", "br"],
    ["CODE", "code"], ["DEL", "s"], ["DIV", "div"], ["EM", "em"],
    ["H1", "h1"], ["H2", "h2"], ["H3", "h3"], ["H4", "h4"],
    ["H5", "h5"], ["H6", "h6"], ["HR", "hr"], ["I", "em"],
    ["LI", "li"], ["OL", "ol"], ["P", "p"], ["PRE", "pre"],
    ["S", "s"], ["STRIKE", "s"], ["STRONG", "strong"], ["TABLE", "table"],
    ["TBODY", "tbody"], ["TD", "td"], ["TFOOT", "tfoot"], ["TH", "th"],
    ["THEAD", "thead"], ["TR", "tr"], ["U", "u"], ["UL", "ul"]
  ]);
  const BLOCK_TAGS = new Set([
    "BLOCKQUOTE", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "P", "PRE",
    "TABLE", "TBODY", "TFOOT", "THEAD", "TR", "UL", "OL"
  ]);
  const VOID_TAGS = new Set(["br", "hr"]);

  const editor = document.getElementById("hc-input");
  const status = document.getElementById("hc-status");
  const outputIds = [
    "hc-text", "hc-urls-in-text", "hc-text-and-urls", "hc-link-list", "hc-html", "hc-markdown"
  ];

  if (!editor || !status || outputIds.some(function (id) { return !document.getElementById(id); })) {
    return;
  }

  function setStatus(message, kind) {
    status.textContent = message;
    status.classList.toggle("hc-error", kind === "error");
    status.classList.toggle("hc-success", kind === "success");
  }

  function cleanUnicode(value) {
    const input = String(value || "");
    const wellFormed = typeof input.toWellFormed === "function"
      ? input.toWellFormed()
      : input.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, function (match, prefix) {
          return (prefix || "") + "\uFFFD";
        });
    return wellFormed.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  }

  function safeHref(rawHref) {
    const href = cleanUnicode(rawHref).trim();
    if (!href || /[\u0000-\u001F\u007F]/.test(href)) return "";
    if (/^(?:#|\?|\.\.\/|\.\/|\/)/.test(href)) return href;
    try {
      const parsed = new URL(href);
      if (parsed.username || parsed.password) return "";
      return SAFE_SCHEMES.has(parsed.protocol) ? href : "";
    } catch (error) {
      return "";
    }
  }

  function sanitizeNode(sourceNode, report) {
    if (sourceNode.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(cleanUnicode(sourceNode.nodeValue));
    }
    if (sourceNode.nodeType !== Node.ELEMENT_NODE) return null;

    const sourceElement = sourceNode;
    const sourceTag = sourceElement.tagName.toUpperCase();
    if (DROP_ENTIRELY.has(sourceTag)) return null;

    const targetTag = TAG_MAP.get(sourceTag);
    if (!targetTag) {
      const unwrapped = document.createDocumentFragment();
      Array.from(sourceElement.childNodes).forEach(function (child) {
        const safeChild = sanitizeNode(child, report);
        if (safeChild) unwrapped.appendChild(safeChild);
      });
      return unwrapped;
    }

    const target = document.createElement(targetTag);
    if (targetTag === "a") {
      const href = safeHref(sourceElement.getAttribute("href"));
      if (href) {
        target.setAttribute("href", href);
      } else {
        report.removedLinks += 1;
      }
    }

    Array.from(sourceElement.childNodes).forEach(function (child) {
      const safeChild = sanitizeNode(child, report);
      if (safeChild) target.appendChild(safeChild);
    });

    if (targetTag === "a" && !target.hasAttribute("href")) {
      const unwrappedLink = document.createDocumentFragment();
      while (target.firstChild) unwrappedLink.appendChild(target.firstChild);
      return unwrappedLink;
    }
    return target;
  }

  function sanitizeRoot(sourceRoot) {
    const safeRoot = document.createElement("div");
    const report = { removedLinks: 0 };
    Array.from(sourceRoot.childNodes).forEach(function (child) {
      const safeChild = sanitizeNode(child, report);
      if (safeChild) safeRoot.appendChild(safeChild);
    });
    return { root: safeRoot, report: report };
  }

  function rootFromClipboard(html, plainText) {
    if (html) {
      const parsed = new DOMParser().parseFromString(html, "text/html");
      return sanitizeRoot(parsed.body);
    }
    const root = document.createElement("div");
    root.appendChild(document.createTextNode(cleanUnicode(plainText)));
    return { root: root, report: { removedLinks: 0 } };
  }

  function appendText(state, text) {
    if (!text) return;
    state.value += text;
  }

  function appendNewline(state) {
    state.value = state.value.replace(/[ \t]+$/g, "");
    if (!state.value.endsWith("\n")) state.value += "\n";
  }

  function plainTextFrom(root, linkMode) {
    const state = { value: "" };

    function walk(node, inPre) {
      if (node.nodeType === Node.TEXT_NODE) {
        const value = cleanUnicode(node.nodeValue);
        appendText(state, inPre ? value : value.replace(/[\t\r\n ]+/g, " "));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const element = node;
      const tag = element.tagName.toUpperCase();
      if (tag === "BR") {
        appendNewline(state);
        return;
      }
      if (tag === "HR") {
        appendNewline(state);
        appendText(state, "---");
        appendNewline(state);
        return;
      }
      if (tag === "A") {
        const href = element.getAttribute("href") || "";
        const label = plainTextFrom(element, "label").trim();
        if (linkMode === "url") appendText(state, href || label);
        else if (linkMode === "both" && href && label !== href) appendText(state, label + " (" + href + ")");
        else appendText(state, label || href);
        return;
      }
      if (tag === "LI") {
        appendNewline(state);
        const parent = element.parentElement;
        let marker = "• ";
        if (parent && parent.tagName === "OL") {
          marker = String(Array.from(parent.children).indexOf(element) + 1) + ". ";
        }
        appendText(state, marker);
      } else if (BLOCK_TAGS.has(tag)) {
        appendNewline(state);
      }

      Array.from(element.childNodes).forEach(function (child) { walk(child, inPre || tag === "PRE"); });
      if (tag === "TD" || tag === "TH") appendText(state, "\t");
      if (tag === "LI" || BLOCK_TAGS.has(tag)) appendNewline(state);
    }

    Array.from(root.childNodes).forEach(function (child) { walk(child, false); });
    return state.value
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function escapeHtml(value, attribute) {
    let escaped = cleanUnicode(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    if (attribute) escaped = escaped.replace(/"/g, "&quot;");
    return escaped;
  }

  function htmlFrom(root) {
    function serialize(node) {
      if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.nodeValue, false);
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const tag = TAG_MAP.get(node.tagName.toUpperCase());
      if (!tag) return Array.from(node.childNodes).map(serialize).join("");
      const href = tag === "a" ? safeHref(node.getAttribute("href")) : "";
      const attribute = href ? " href=\"" + escapeHtml(href, true) + "\"" : "";
      if (VOID_TAGS.has(tag)) return "<" + tag + ">";
      return "<" + tag + attribute + ">" + Array.from(node.childNodes).map(serialize).join("") + "</" + tag + ">";
    }
    return Array.from(root.childNodes).map(serialize).join("").trim();
  }

  function escapeMarkdownText(value) {
    return cleanUnicode(value).replace(/([\\`*_[\]<>])/g, "\\$1");
  }

  function markdownFrom(root) {
    function inline(node) {
      if (node.nodeType === Node.TEXT_NODE) return escapeMarkdownText(node.nodeValue.replace(/[\t\r\n ]+/g, " "));
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const tag = node.tagName.toUpperCase();
      const content = Array.from(node.childNodes).map(inline).join("");
      if (tag === "A") {
        const href = safeHref(node.getAttribute("href"));
        const label = content || escapeMarkdownText(href);
        return href ? "[" + label + "](" + href.replace(/[()\\]/g, "\\$&") + ")" : label;
      }
      if (tag === "STRONG" || tag === "B") return "**" + content + "**";
      if (tag === "EM" || tag === "I") return "*" + content + "*";
      if (tag === "S" || tag === "DEL" || tag === "STRIKE") return "~~" + content + "~~";
      if (tag === "CODE") {
        const ticks = content.includes("`") ? "``" : "`";
        return ticks + content + ticks;
      }
      if (tag === "BR") return "  \n";
      return content;
    }

    function block(node, depth) {
      if (node.nodeType === Node.TEXT_NODE) return escapeMarkdownText(node.nodeValue.replace(/[\t\r\n ]+/g, " "));
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const tag = node.tagName.toUpperCase();
      if (/^H[1-6]$/.test(tag)) return "#".repeat(Number(tag.slice(1))) + " " + Array.from(node.childNodes).map(inline).join("").trim() + "\n\n";
      if (tag === "P" || tag === "DIV") return Array.from(node.childNodes).map(function (child) { return block(child, depth); }).join("").trim() + "\n\n";
      if (tag === "BLOCKQUOTE") {
        const quote = Array.from(node.childNodes).map(function (child) { return block(child, depth); }).join("").trim();
        return quote.split("\n").map(function (line) { return "> " + line; }).join("\n") + "\n\n";
      }
      if (tag === "PRE") return "```\n" + cleanUnicode(node.textContent).trimEnd() + "\n```\n\n";
      if (tag === "HR") return "---\n\n";
      if (tag === "UL" || tag === "OL") {
        return Array.from(node.children).filter(function (child) { return child.tagName === "LI"; }).map(function (item, index) {
          const marker = tag === "OL" ? String(index + 1) + ". " : "- ";
          const body = Array.from(item.childNodes).map(function (child) {
            return child.nodeType === Node.ELEMENT_NODE && (child.tagName === "UL" || child.tagName === "OL")
              ? "\n" + block(child, depth + 1).trimEnd()
              : inline(child);
          }).join("").trim();
          const indent = "  ".repeat(depth);
          return indent + marker + body.replace(/\n/g, "\n" + indent + "  ");
        }).join("\n") + "\n\n";
      }
      if (tag === "TABLE") {
        return Array.from(node.querySelectorAll("tr")).map(function (row) {
          return "| " + Array.from(row.children).map(function (cell) {
            return plainTextFrom(cell, "label").replace(/\|/g, "\\|").trim();
          }).join(" | ") + " |";
        }).join("\n") + "\n\n";
      }
      if (tag === "BR") return "  \n";
      if (tag === "A" || tag === "STRONG" || tag === "B" || tag === "EM" || tag === "I" || tag === "S" || tag === "DEL" || tag === "STRIKE" || tag === "CODE" || tag === "U") return inline(node);
      return Array.from(node.childNodes).map(function (child) { return block(child, depth); }).join("");
    }

    return Array.from(root.childNodes).map(function (node) { return block(node, 0); }).join("")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function linkListFrom(root) {
    const seen = new Set();
    return Array.from(root.querySelectorAll("a[href]")).map(function (link) {
      return safeHref(link.getAttribute("href"));
    }).filter(function (href) {
      if (!href || seen.has(href)) return false;
      seen.add(href);
      return true;
    }).join("\n");
  }

  function updateResults(optionalMessage) {
    const sanitized = sanitizeRoot(editor);
    const safeRoot = sanitized.root;
    const links = safeRoot.querySelectorAll("a[href]").length;
    document.getElementById("hc-text").value = plainTextFrom(safeRoot, "label");
    document.getElementById("hc-urls-in-text").value = plainTextFrom(safeRoot, "url");
    document.getElementById("hc-text-and-urls").value = plainTextFrom(safeRoot, "both");
    document.getElementById("hc-link-list").value = linkListFrom(safeRoot);
    document.getElementById("hc-html").value = htmlFrom(safeRoot);
    document.getElementById("hc-markdown").value = markdownFrom(safeRoot);

    if (optionalMessage) {
      setStatus(optionalMessage, "success");
    } else if (!plainTextFrom(safeRoot, "label")) {
      setStatus("No content yet.", "");
    } else {
      setStatus(links + (links === 1 ? " hyperlink found." : " hyperlinks found."), "");
    }
  }

  editor.addEventListener("paste", function (event) {
    event.preventDefault();
    if (!event.clipboardData) {
      setStatus("The browser did not provide clipboard data. Use a supported browser and try again.", "error");
      return;
    }
    const html = event.clipboardData.getData("text/html");
    const plainText = event.clipboardData.getData("text/plain");
    const sourceLength = html ? html.length : plainText.length;
    if (sourceLength > MAX_INPUT_CHARACTERS) {
      setStatus("This paste is larger than the 2 MB text limit. Paste a smaller selection.", "error");
      return;
    }

    const converted = rootFromClipboard(html, plainText);
    editor.replaceChildren.apply(editor, Array.from(converted.root.childNodes));
    updateResults(converted.report.removedLinks
      ? "Pasted locally. " + converted.report.removedLinks + " unsafe or invalid link " + (converted.report.removedLinks === 1 ? "was" : "were") + " removed."
      : "Pasted locally. All results are ready.");
  });

  editor.addEventListener("input", function () {
    if (editor.textContent.length > MAX_INPUT_CHARACTERS) {
      editor.textContent = editor.textContent.slice(0, MAX_INPUT_CHARACTERS);
      setStatus("Input was shortened to the 2 MB text limit.", "error");
    }
    updateResults();
  });

  editor.addEventListener("drop", function (event) {
    event.preventDefault();
    setStatus("Use Command + V to paste rich text. File and drag-and-drop input is not accepted.", "error");
  });

  editor.addEventListener("click", function (event) {
    if (event.target.closest("a")) event.preventDefault();
  });

  document.getElementById("hc-clear").addEventListener("click", function () {
    editor.replaceChildren();
    updateResults();
    editor.focus();
  });

  document.getElementById("hc-example").addEventListener("click", function () {
    const paragraph = document.createElement("p");
    paragraph.appendChild(document.createTextNode("Read the "));
    const guide = document.createElement("a");
    guide.href = "https://quarto.org/docs/guide/";
    guide.textContent = "Quarto guide";
    paragraph.appendChild(guide);
    paragraph.appendChild(document.createTextNode(" and visit "));
    const mdn = document.createElement("a");
    mdn.href = "https://developer.mozilla.org/";
    mdn.textContent = "MDN Web Docs";
    paragraph.appendChild(mdn);
    paragraph.appendChild(document.createTextNode(" for browser references."));
    editor.replaceChildren(paragraph);
    updateResults("Example loaded. All results are ready.");
  });

  document.getElementById("hc-results").addEventListener("click", async function (event) {
    const button = event.target.closest(".hc-copy");
    if (!button) return;
    const output = document.getElementById(button.dataset.output);
    if (!output) return;

    if (!window.isSecureContext || !navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
      output.focus();
      output.select();
      setStatus("Automatic copy is unavailable here. Press Command + C to copy the selected result.", "error");
      return;
    }

    try {
      await navigator.clipboard.writeText(output.value);
      setStatus("Copied " + button.closest(".hc-result-card").querySelector("h3").textContent + ".", "success");
    } catch (error) {
      output.focus();
      output.select();
      setStatus("The browser blocked automatic copy. Press Command + C to copy the selected result.", "error");
    }
  });

  updateResults();

  window.CopyPasteValuesTest = Object.freeze({
    rootFromClipboard: rootFromClipboard,
    sanitizeRoot: sanitizeRoot,
    plainTextFrom: plainTextFrom,
    htmlFrom: htmlFrom,
    markdownFrom: markdownFrom,
    linkListFrom: linkListFrom,
    safeHref: safeHref
  });
}());
