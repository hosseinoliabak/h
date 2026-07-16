// Colors activation-function names in code blocks site-wide.
// Scheme (defined in styles.css): ReLU = cyan (.tok-relu),
// sigmoid = magenta (.tok-sigmoid), softmax = amber (.tok-softmax),
// linear = purple (.tok-linear).
// Matches only quoted tokens like "relu" / 'softmax', so prose words and
// identifiers such as np.linspace are never touched.
(function () {
  const CLASS_FOR = {
    relu: "tok-relu",
    sigmoid: "tok-sigmoid",
    softmax: "tok-softmax",
    linear: "tok-linear",
  };
  const TOKEN_RE = /(["'])(relu|sigmoid|softmax|linear)\1/g;

  function colorize() {
    document.querySelectorAll("code").forEach((code) => {
      // Skip blocks already colored manually with tok- spans
      const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      const textNodes = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.parentElement.closest('[class*="tok-"]')) continue;
        textNodes.push(node);
      }
      textNodes.forEach((node) => {
        const text = node.nodeValue;
        TOKEN_RE.lastIndex = 0;
        if (!TOKEN_RE.test(text)) return;
        TOKEN_RE.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let last = 0;
        let m;
        while ((m = TOKEN_RE.exec(text)) !== null) {
          frag.appendChild(document.createTextNode(text.slice(last, m.index)));
          const span = document.createElement("span");
          span.className = CLASS_FOR[m[2]];
          span.textContent = m[0];
          frag.appendChild(span);
          last = m.index + m[0].length;
        }
        frag.appendChild(document.createTextNode(text.slice(last)));
        node.parentNode.replaceChild(frag, node);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", colorize);
  } else {
    colorize();
  }
})();
