/* Private reading views. Quarto cannot render source that arrives after login.
   Both readers use opaque-origin frames with scripts only and no site auth. */
(() => {
  'use strict';
  function mount(container, payload, completed, rejected) {
    const isPdf = payload.kind === 'pdf';
    const frame = document.createElement('iframe');
    frame.className = 'th-reading-frame'; frame.title = isPdf ? 'Compiled thesis PDF' : 'Rendered research document';
    frame.setAttribute('sandbox', 'allow-scripts'); frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.src = 'thesis-preview-assets/public/' + (isPdf ? 'pdf' : 'document') + '.html?v=' + encodeURIComponent(window.ThesisPreviewVersion || '1');
    const note = document.createElement('p'); note.className = 'tool-note'; note.setAttribute('role', 'status'); note.textContent = 'Opening reading view.';
    let disposed = false, sent = false, timer = null;
    function dispose() { if (disposed) return; disposed = true; clearTimeout(timer); window.removeEventListener('message', receive); frame.remove(); }
    function fail() { dispose(); note.hidden = false; note.textContent = 'The reading view could not load. Edit source or download the file to continue.'; if (rejected) rejected(new Error('The bibliography formatter could not load.')); }
    function watch() { clearTimeout(timer); timer = setTimeout(fail, 20000); }
    function receive(event) {
      if (disposed || event.source !== frame.contentWindow || event.origin !== 'null' || !event.data) return;
      const type = event.data.type;
      if (type === (isPdf ? 'pdf-ready' : 'preview-ready') && !sent) {
        sent = true; watch();
        if (isPdf) { const bytes = payload.bytes.slice(0); frame.contentWindow.postMessage({ type: 'render-pdf', bytes }, '*', [bytes]); }
        else frame.contentWindow.postMessage({ type: payload.kind === 'bibliography-tex' ? 'format-bibliography' : 'render-message', request: 1, text: payload.text, kind: payload.kind, dark: document.body.classList.contains('quarto-dark') }, '*');
      }
      if (sent && payload.kind === 'bibliography-tex' && type === 'bibliography-done' && event.data.request === 1) {
        clearTimeout(timer);
        if (!event.data.error && typeof event.data.tex === 'string' && event.data.tex.length <= 1048576) completed(event.data.tex);
        else rejected(new Error('APA 6 bibliography formatting failed. Check references.bib and its citation keys.'));
      }
      if (isPdf && type === 'pdf-busy') watch();
      if (sent && (isPdf ? type === 'pdf-done' : type === 'preview-done' && event.data.request === 1)) {
        clearTimeout(timer); note.hidden = !event.data.error;
        note.textContent = event.data.error ? 'Some content could not be rendered. Your source is preserved; use Edit source to inspect it.' : 'Reading view ready.';
      }
    }
    window.addEventListener('message', receive); frame.addEventListener('error', fail); watch(); container.append(note, frame);
    return Object.freeze({ dispose });
  }
  function formatBibliography(text) {
    const container = document.createElement('div'); container.hidden = true; document.getElementById('thesis-workspace').append(container);
    let reader, reject;
    const promise = new Promise((resolve, failure) => { reject = failure; reader = mount(container, { kind: 'bibliography-tex', text }, resolve, failure); }).finally(() => { reader.dispose(); container.remove(); });
    return { promise, cancel() { reader.dispose(); container.remove(); reject(new Error('Compilation cancelled.')); } };
  }
  window.ThesisPreview = Object.freeze({ mount, formatBibliography });
})();
