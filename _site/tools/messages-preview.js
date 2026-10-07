/* Quarto renders authored pages at build time. Private chat source arrives
   after sign-in, so this runtime preview uses an isolated local document.
   The frame has an opaque origin and receives only the selected text. */
(function () {
  'use strict';
  function text(delta) { return delta.ops.map(function (op) { return op.insert; }).join(''); }
  function isSource(delta) {
    if (delta.ops.some(function (op) { return op.attributes && Object.keys(op.attributes).length; })) return false;
    return /(^|\n)\s{0,3}(?:#{1,6}\s|```|~~~|>\s|[-*+]\s|\d+\.\s|\|)|\*\*[^\n]+\*\*|\$[^\n$]+\$|\\\(|\\\[/.test(text(delta));
  }
  function mount(container, initialText) {
    var frame = document.createElement('iframe');
    frame.title = 'Rendered message preview'; frame.className = 'msg-render-frame';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.src = 'messages-preview-assets/public/frame.html?v=' + encodeURIComponent(window.MessagePreviewVersion || '1');
    var note = document.createElement('p'); note.className = 'tool-note'; note.textContent = 'Loading local preview…'; note.setAttribute('role', 'status'); note.setAttribute('aria-live', 'polite');
    var ready = false, disposed = false, source = initialText, request = 0, timer;
    function fail() {
      if (disposed) return;
      disposed = true; window.clearTimeout(timer); window.removeEventListener('message', receive); frame.remove();
      note.classList.remove('visually-hidden');
      note.textContent = 'Preview could not load. The original text is still available in the conversation.';
    }
    function send() {
      if (!ready || disposed) return;
      request++;
      window.clearTimeout(timer); timer = window.setTimeout(fail, 12000);
      // An opaque sandbox cannot have a concrete targetOrigin. This message
      // goes only to this exact frame WindowProxy, never a broadcast channel.
      frame.contentWindow.postMessage({ type: 'render-message', request: request, text: source, dark: document.body.classList.contains('quarto-dark') }, '*');
    }
    function receive(event) {
      if (disposed || event.source !== frame.contentWindow || event.origin !== 'null' || !event.data) return;
      if (event.data.type === 'preview-ready') { ready = true; send(); }
      if (event.data.type === 'preview-done' && event.data.request === request) { window.clearTimeout(timer); note.classList.add('visually-hidden'); note.textContent = 'Preview ready.'; }
    }
    window.addEventListener('message', receive);
    frame.addEventListener('error', fail);
    timer = window.setTimeout(fail, 12000);
    container.append(note, frame);
    return {
      update: function (value) { source = value; send(); },
      dispose: function () { disposed = true; window.clearTimeout(timer); window.removeEventListener('message', receive); frame.remove(); }
    };
  }
  window.MessagePreview = { text: text, isSource: isSource, mount: mount };
}());
