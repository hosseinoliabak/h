/* Temporary, bounded pdfTeX worker. No authenticated SDK enters the worker. */
(() => {
  'use strict';
  const MAX_PDF = 7 * 1024 * 1024;
  let worker = null, rejectActive = null, timer = null;
  function cancel() {
    if (worker) worker.terminate();
    worker = null; clearTimeout(timer); timer = null;
    if (rejectActive) rejectActive(new Error('Compilation cancelled.'));
    rejectActive = null;
  }
  async function compile(files, progress) {
    cancel();
    const current = new Worker(new URL('thesis-tex-assets/worker.js', document.currentScript?.src || location.href));
    worker = current;
    let wait = null;
    const exchange = message => new Promise((resolve, reject) => {
      wait = { resolve, reject }; rejectActive = reject;
      if (message) current.postMessage(message);
    });
    current.onmessage = event => {
      const pending = wait; wait = null;
      if (pending) pending.resolve(event.data);
    };
    current.onerror = () => { if (wait) wait.reject(new Error('The compiler could not start or stopped unexpectedly.')); };
    timer = setTimeout(() => {
      if (wait) wait.reject(new Error('Compilation exceeded two minutes. Simplify the source and try again.'));
      current.terminate();
    }, 120000);
    try {
      progress('Loading the browser compiler.');
      const ready = await exchange();
      if (ready.result !== 'ok') throw new Error('The browser compiler could not start.');
      const folders = new Set();
      for (const file of files) {
        const parts = file.path.split('/'); parts.pop(); let path = '';
        for (const part of parts) {
          path = path ? path + '/' + part : part;
          if (!folders.has(path)) {
            const result = await exchange({ cmd: 'mkdir', url: path });
            if (result.result !== 'ok') throw new Error('A chapter folder could not be created.');
            folders.add(path);
          }
        }
        const result = await exchange({ cmd: 'writefile', url: file.path, src: file.content });
        if (result.result !== 'ok') throw new Error('A source file could not be loaded.');
      }
      current.postMessage({ cmd: 'setmainfile', url: 'main.tex' });
      let report;
      for (let pass = 1; pass <= 3; pass++) {
        progress('Compiling PDF, pass ' + pass + ' of 3.');
        report = await exchange({ cmd: 'compilelatex' });
        if (report.result !== 'ok' || !(report.pdf instanceof ArrayBuffer)) {
          const error = new Error('LaTeX could not compile this source. Check the compiler log.');
          error.log = typeof report.log === 'string' ? report.log.slice(-24000) : 'No compiler log was returned.';
          throw error;
        }
      }
      const bytes = new Uint8Array(report.pdf);
      if (bytes.byteLength < 5 || bytes.byteLength > MAX_PDF || String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') throw new Error('The compiler did not return a supported PDF under 7 MiB.');
      return { bytes, log: String(report.log || '').slice(-24000) };
    } finally {
      current.terminate();
      if (worker === current) { worker = null; rejectActive = null; clearTimeout(timer); timer = null; }
    }
  }
  window.thesisCompiler = Object.freeze({ compile, cancel });
})();
