// Auto-number review questions throughout each page
document.addEventListener("DOMContentLoaded", function() {
  var counter = 0;
  // Find all <strong> elements that start with a number followed by a dot
  var strongs = document.querySelectorAll("p > strong");
  for (var i = 0; i < strongs.length; i++) {
    var strong = strongs[i];
    var match = strong.textContent.match(/^(\d+)\.\s/);
    if (!match) continue;

    counter++;
    var newPrefix = counter + ". ";

    // Replace only the leading number in the first text node.
    // Do NOT use strong.textContent = ... — that strips child elements like <code>.
    for (var j = 0; j < strong.childNodes.length; j++) {
      var node = strong.childNodes[j];
      if (node.nodeType === Node.TEXT_NODE && /^\d+\.\s/.test(node.textContent)) {
        node.textContent = node.textContent.replace(/^\d+\.\s/, newPrefix);
        break;
      }
    }
  }
});