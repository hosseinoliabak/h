/* Classic worker bootstrap. Only pinned same-origin runtime assets can be requested. */
'use strict';
importScripts('asset-map.js');
const root = new URL('.', self.location.href);
const sizes = new Map(Object.entries(self.thesisAssetMap).map(([path, size]) => [new URL('texlive/' + path, root).href, size]));
sizes.set(new URL('swiftlatexpdftex.wasm', root).href, 1772266);
const rawFetch = self.fetch.bind(self);
const NativeXHR = self.XMLHttpRequest;
function approved(value) {
  const url = new URL(typeof value === 'string' ? value : value.url, root);
  if (url.origin !== root.origin || !sizes.has(url.href)) throw new Error('Unsupported compiler asset.');
  return url.href;
}
self.fetch = async value => {
  const url = approved(value), limit = sizes.get(url);
  const response = await rawFetch(url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok || response.headers.get('content-length') && Number(response.headers.get('content-length')) > limit) throw new Error('Compiler asset unavailable.');
  const reader = response.body.getReader(); const parts = []; let bytes = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > limit) throw new Error('Compiler asset is too large.'); parts.push(part.value); }
  } catch (error) { await reader.cancel(); throw error; }
  if (bytes !== limit) throw new Error('Compiler asset is incomplete.');
  return new Response(new Blob(parts), { headers: { 'Content-Type': 'application/wasm' } });
};
self.XMLHttpRequest = class extends NativeXHR {
  open(method, value, async = true) {
    if (method !== 'GET') throw new Error('Only compiler asset reads are supported.');
    if (async !== false) throw new Error('Only the vendor synchronous asset path is supported.');
    try { this.approvedURL = approved(value); }
    catch { this.missing = true; return; }
    super.open('GET', this.approvedURL, async); this.timeout = 20000;
  }
  get status() { return this.missing ? 404 : super.status; }
  send() {
    if (this.missing) return;
    if (this.responseType !== 'arraybuffer') throw new Error('Only binary compiler assets are supported.');
    this.timeout = 20000;
    super.send(null);
    if (this.readyState === 4 && this.status === 200 && (this.responseURL !== this.approvedURL || this.response?.byteLength !== sizes.get(this.approvedURL))) throw new Error('Compiler asset does not match its declared size.');
  }
};
// TeX diagnostics can contain manuscript text. Keep them in the bounded result,
// never the browser console. A runaway log terminates the worker through onerror.
for (const key of ['log', 'error', 'warn', 'info', 'debug']) console[key] = () => {};
let log = '';
Object.defineProperty(self, 'memlog', { configurable: true, get: () => log, set: value => { if (typeof value !== 'string' || value.length > 262144) throw new Error('Compiler log limit exceeded.'); log = value; } });
importScripts('swiftlatexpdftex.js');
self.importScripts = () => { throw new Error('The compiler cannot import additional scripts.'); };
// The APA 6 formatter supplies main.bbl before the first LaTeX pass. Do not
// let the vendor's automatic BibTeX run replace it between subsequent passes.
// Other projects keep the original BibTeX behavior. The vendor bytes stay pinned.
let preparedBibliography = false;
const engineBibtex = self._compileBibtex;
self._compileBibtex = () => preparedBibliography ? 0 : engineBibtex();
const engineMessage = self.onmessage;
self.onmessage = event => {
  const data = event.data;
  if (!data || !['mkdir', 'writefile', 'setmainfile', 'compilelatex'].includes(data.cmd)) throw new Error('Unsupported compiler command.');
  if (data.cmd === 'setmainfile' && data.url !== 'main.tex') throw new Error('Unsupported entry file.');
  if (['mkdir', 'writefile'].includes(data.cmd) && (typeof data.url !== 'string' || data.url.length > 180 || !/^[a-z0-9][a-z0-9_./-]*$/.test(data.url) || data.url.includes('..') || data.url.endsWith('/'))) throw new Error('Invalid compiler path.');
  if (data.cmd === 'writefile' && (typeof data.src !== 'string' || new TextEncoder().encode(data.src).length > 262144)) throw new Error('Invalid source file.');
  if (data.cmd === 'writefile' && data.url === 'main.bbl') preparedBibliography = true;
  engineMessage(event);
};
