/* One bounded JSON fetch, shared by the data files the chess page loads on
   demand (the opening tables and the pattern references).

   These files ship with the site, so the bounds are not here because the origin
   is untrusted. They are here so a hung connection, a truncated proxy response,
   or a file that grew by accident cannot leave the board waiting forever or
   hand the parser something enormous. Every failure resolves to null, because
   the board has to keep working when a side file does not arrive. */

export const DEFAULT_TIMEOUT_MS = 15000;
export const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

export function fetchJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const abort = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = abort ? setTimeout(() => abort.abort(), timeoutMs) : null;
  return fetch(url, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: abort ? abort.signal : undefined,
  })
    .then(response => {
      if (!response.ok) throw new Error('http ' + response.status);
      const announced = Number(response.headers.get('content-length'));
      if (Number.isFinite(announced) && announced > maxBytes) throw new Error('announced size over the cap');
      return response.text();
    })
    .then(text => {
      if (text.length > maxBytes) throw new Error('body over the cap');
      return JSON.parse(text);
    })
    .catch(() => null)
    .then(result => { if (timer) clearTimeout(timer); return result; });
}
