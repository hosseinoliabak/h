// Auto-number review questions throughout each page
document.addEventListener("DOMContentLoaded", function() {
  var counter = 0;
  // Find all <strong> elements that start with a number followed by a dot
  var strongs = document.querySelectorAll("p > strong");
  for (var i = 0; i < strongs.length; i++) {
    var text = strongs[i].textContent;
    var match = text.match(/^(\d+)\.\s/);
    if (match) {
      counter++;
      strongs[i].textContent = text.replace(/^\d+\.\s/, counter + ". ");
    }
  }
});
