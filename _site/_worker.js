/* Short links for oliabak.com.
 *
 * This is the site's Cloudflare Pages Worker in advanced mode. The post-render
 * hook tools/short_links_deploy.py copies it to _site/_worker.js and writes the
 * _site/_routes.json that keeps every real page and asset away from it, so the
 * Worker only ever sees paths that are not part of the static site.
 *
 * Two jobs:
 *
 *   GET /<code>        look the code up and answer with a 307 to its target.
 *                      An unknown code is handed back to the static site, which
 *                      serves the normal 404 page. Appending "+" to a short link
 *                      shows the target as plain text instead of redirecting.
 *
 *   /api/short-links   the JSON API behind tools/short-links.qmd. Every call
 *                      carries a Firebase ID token from the site's Google or
 *                      GitHub sign-in. The token is verified here against
 *                      Google's published keys; nothing about the caller is
 *                      taken on trust from the browser.
 *
 * Who may create links: the owner (SHORT_LINK_OWNER_UID) and the accounts the
 * owner has added to the allowlist. Everyone else can only open links.
 *
 * Storage is one Workers KV namespace bound as SHORT_LINKS:
 *   link:<code>            { url, owner, createdAt }   metadata: same, url truncated
 *   owner:<uid>:<code>     "1"                          metadata: { url, createdAt }
 *   allow:<uid>            { handle, grantedAt, grantedBy }
 *   rate:user:<uid>:<day>  counter, expires after two days
 *   rate:global:<day>      counter, expires after two days
 *
 * Bindings and variables (set in the Pages project, never in this file):
 *   SHORT_LINKS            KV namespace binding (required)
 *   SHORT_LINK_OWNER_UID   Firebase uid of the site owner (required)
 *   SHORT_LINK_ORIGIN      accepted origin for state-changing calls
 *                          (optional, defaults to https://oliabak.com)
 *
 * Until the binding and the owner uid exist, the redirect path passes every
 * request through untouched and the API reports "not configured".
 */

const SITE_ORIGIN_DEFAULT = 'https://oliabak.com';
const FIREBASE_PROJECT = 'oliabak-paste';
const TOKEN_ISSUER = 'https://securetoken.google.com/' + FIREBASE_PROJECT;
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const SIGN_IN_PROVIDERS = new Set(['google.com', 'github.com']);

const API_ROOT = '/api/short-links';
const MAX_TOKEN_LENGTH = 8192;
const MAX_BODY_BYTES = 8192;
const MAX_URL_LENGTH = 2048;
const MAX_HANDLE_LENGTH = 20;
const METADATA_URL_LENGTH = 700;
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const RANDOM_CODE_LENGTH = 6;
/* No 0, o, 1, l, or i, so a code read aloud or from paper is unambiguous. */
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const ALIAS_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;
const LOOKUP_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const CONTROL_OR_SPACE = /[\u0000-\u0020\u007f]/;
const MAX_LINKS_PER_USER = 200;
const DAILY_CREATES_PER_USER = 50;
const DAILY_CREATES_GLOBAL = 500;
const RATE_TTL_SECONDS = 2 * 24 * 60 * 60;
const CLOCK_SKEW_SECONDS = 300;
const JWKS_MAX_AGE_SECONDS = 60 * 60;
const JWKS_REFRESH_FLOOR_SECONDS = 5 * 60;
const JWKS_TIMEOUT_MS = 10000;
const MAX_JWKS_BYTES = 64 * 1024;

/* Names that can never be a short code, whatever the static site contains.
   The deploy hook replaces BUILD_RESERVED with every top-level file and
   directory of the rendered site, and the API also asks the static site
   whether an alias already resolves, so this list is the floor, not the
   whole check. */
const STATIC_RESERVED = [
  'api', 'admin', 'login', 'logout', 'signin', 'signout', 'account', 'settings',
  'static', 'assets', 'cdn-cgi', 'functions', 'robots.txt', 'sitemap.xml',
  'favicon.ico', 'index', 'index.html', '404', '404.html', 'null', 'undefined'
];
const BUILD_RESERVED = ["404", "404.html", "about", "about.html", "activation-colors.js", "ai", "app-mode.css", "auth.js", "cybersecurity", "dashboard.js", "deep-learning", "fonts", "giscus-note.js", "giscus-theme-dark.css", "giscus-theme-lion.css", "giscus-theme.css", "index", "index.html", "infrastructure", "listings.json", "machine-learning", "math", "media", "nav-columns.js", "networking", "resume-reading.js", "review-numbering.js", "robots.txt", "search-scope.js", "search.json", "sidebar-active.js", "site-metric-pages.json", "site-metrics.js", "site_libs", "sitemap.xml", "styles.css", "theme-toggle.js", "tools", "visit-history.js"];
const RESERVED = new Set(STATIC_RESERVED.concat(BUILD_RESERVED).map(function (name) {
  return String(name).toLowerCase();
}));

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/* ------------------------------ small helpers ------------------------------ */

/* Nothing this Worker answers may be cached at the edge. A cached redirect
   would outlive its deletion, and a cached "not found" for a code would hide
   a link created a minute later. Cache-Control alone is not enough: a zone
   cache rule that overrides origin headers was observed caching these
   responses, so the Cloudflare-specific directives are sent as well. */
function markUncacheable(headers) {
  headers.set('Cache-Control', 'no-store');
  headers.set('CDN-Cache-Control', 'no-store');
  headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
  return headers;
}

function noStoreHeaders(extra) {
  const headers = markUncacheable(new Headers(extra || {}));
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Robots-Tag', 'noindex');
  return headers;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: noStoreHeaders({ 'Content-Type': 'application/json; charset=utf-8' })
  });
}

function text(status, body) {
  return new Response(body, {
    status: status,
    headers: noStoreHeaders({ 'Content-Type': 'text/plain; charset=utf-8' })
  });
}

function utcDay(now) {
  return new Date(now).toISOString().slice(0, 10).replace(/-/g, '');
}

function siteOrigin(env) {
  const configured = env && typeof env.SHORT_LINK_ORIGIN === 'string' ? env.SHORT_LINK_ORIGIN.trim() : '';
  if (!configured) return SITE_ORIGIN_DEFAULT;
  try {
    const parsed = new URL(configured);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return SITE_ORIGIN_DEFAULT;
    return parsed.origin;
  } catch (error) {
    return SITE_ORIGIN_DEFAULT;
  }
}

function isConfigured(env) {
  return Boolean(env && env.SHORT_LINKS && typeof env.SHORT_LINKS.get === 'function'
    && typeof env.SHORT_LINK_OWNER_UID === 'string' && UID_PATTERN.test(env.SHORT_LINK_OWNER_UID));
}

function base64UrlToBytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('Invalid base64url');
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice(0, (4 - value.length % 4) % 4);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function decodeJsonSegment(segment) {
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(base64UrlToBytes(segment));
  const value = JSON.parse(decoded);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Segment is not an object');
  return value;
}

/* ------------------------------ ID token check ------------------------------ */

let jwksCache = { keys: null, fetchedAt: 0, maxAge: JWKS_MAX_AGE_SECONDS };

function parseMaxAge(header) {
  const match = /max-age=(\d{1,7})/i.exec(String(header || ''));
  if (!match) return JWKS_MAX_AGE_SECONDS;
  return Math.min(Math.max(Number(match[1]), JWKS_REFRESH_FLOOR_SECONDS), 24 * 60 * 60);
}

async function fetchJwks() {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, JWKS_TIMEOUT_MS);
  try {
    const response = await fetch(JWKS_URL, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error('JWKS status ' + response.status);
    const announced = Number(response.headers.get('content-length') || 0);
    if (announced > MAX_JWKS_BYTES) throw new Error('JWKS too large');
    const body = await response.text();
    if (body.length > MAX_JWKS_BYTES) throw new Error('JWKS too large');
    const parsed = JSON.parse(body);
    if (!parsed || !Array.isArray(parsed.keys)) throw new Error('JWKS malformed');
    const keys = new Map();
    for (const key of parsed.keys) {
      if (!key || typeof key !== 'object') continue;
      if (key.kty !== 'RSA' || (key.alg && key.alg !== 'RS256') || (key.use && key.use !== 'sig')) continue;
      if (typeof key.kid !== 'string' || typeof key.n !== 'string' || typeof key.e !== 'string') continue;
      keys.set(key.kid, { kty: 'RSA', n: key.n, e: key.e, alg: 'RS256', ext: true });
    }
    if (keys.size === 0) throw new Error('JWKS has no usable keys');
    return { keys: keys, fetchedAt: Date.now(), maxAge: parseMaxAge(response.headers.get('cache-control')) };
  } finally {
    clearTimeout(timer);
  }
}

async function signingKey(kid, now) {
  const fresh = jwksCache.keys && (now - jwksCache.fetchedAt) < jwksCache.maxAge * 1000;
  if (fresh && jwksCache.keys.has(kid)) return jwksCache.keys.get(kid);
  /* An unknown kid usually means Google rotated its keys. Refetch, but not
     more often than every few minutes, so a flood of bad tokens cannot turn
     into a flood of upstream requests. */
  const recentlyFetched = jwksCache.keys && (now - jwksCache.fetchedAt) < JWKS_REFRESH_FLOOR_SECONDS * 1000;
  if (!fresh || !recentlyFetched) jwksCache = await fetchJwks();
  return jwksCache.keys.get(kid) || null;
}

/* Verifies a Firebase ID token the way the Admin SDK does. Returns { uid,
   provider } or throws an ApiError. Signature, issuer, audience, expiry,
   issue time, subject, and sign-in provider are all checked. */
async function verifyIdToken(token, now) {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
  }
  const parts = token.split('.');
  if (parts.length !== 3) throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
  let header;
  let payload;
  let signature;
  try {
    header = decodeJsonSegment(parts[0]);
    payload = decodeJsonSegment(parts[1]);
    signature = base64UrlToBytes(parts[2]);
  } catch (error) {
    throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length === 0 || header.kid.length > 128) {
    throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
  }
  const nowSeconds = Math.floor(now / 1000);
  const uid = payload.sub;
  const validClaims = payload.iss === TOKEN_ISSUER
    && payload.aud === FIREBASE_PROJECT
    && typeof uid === 'string' && UID_PATTERN.test(uid)
    && (payload.user_id === undefined || payload.user_id === uid)
    && Number.isFinite(payload.exp) && payload.exp > nowSeconds
    && Number.isFinite(payload.iat) && payload.iat <= nowSeconds + CLOCK_SKEW_SECONDS
    && (payload.auth_time === undefined || (Number.isFinite(payload.auth_time) && payload.auth_time <= nowSeconds + CLOCK_SKEW_SECONDS));
  if (!validClaims) throw new ApiError(401, 'unauthenticated', 'Your sign-in has expired. Sign in again.');
  const firebaseClaim = payload.firebase;
  const provider = firebaseClaim && typeof firebaseClaim === 'object' ? firebaseClaim.sign_in_provider : null;
  if (typeof provider !== 'string' || !SIGN_IN_PROVIDERS.has(provider)) {
    throw new ApiError(403, 'provider-not-allowed', 'Sign in with Google or GitHub to use short links.');
  }
  let jwk;
  try {
    jwk = await signingKey(header.kid, now);
  } catch (error) {
    throw new ApiError(503, 'verification-unavailable', 'Sign-in could not be verified right now. Try again in a minute.');
  }
  if (!jwk) throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
  let verified = false;
  try {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const signed = new TextEncoder().encode(parts[0] + '.' + parts[1]);
    verified = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signed);
  } catch (error) {
    verified = false;
  }
  if (!verified) throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
  return { uid: uid, provider: provider };
}

/* ------------------------------ validation ------------------------------ */

/* Returns the canonical target URL or throws. Only http and https, no embedded
   credentials, bounded length, and never a path on this site that could
   itself be a short code, which is the only way to build a redirect loop. */
function normalizeTarget(value, origin) {
  if (typeof value !== 'string') throw new ApiError(400, 'invalid-url', 'Enter the address to shorten.');
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new ApiError(400, 'invalid-url', 'Enter the address to shorten.');
  if (trimmed.length > MAX_URL_LENGTH) throw new ApiError(400, 'invalid-url', 'The address is longer than ' + MAX_URL_LENGTH + ' characters.');
  if (CONTROL_OR_SPACE.test(trimmed)) throw new ApiError(400, 'invalid-url', 'The address contains spaces or control characters.');
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (error) {
    throw new ApiError(400, 'invalid-url', 'Enter a complete address that starts with https:// or http://.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ApiError(400, 'invalid-url', 'Only https:// and http:// addresses can be shortened.');
  }
  if (parsed.username || parsed.password) throw new ApiError(400, 'invalid-url', 'Addresses with a user name or password are not accepted.');
  if (!parsed.hostname || parsed.hostname === 'localhost' || /^[0-9.]+$/.test(parsed.hostname) || parsed.hostname.startsWith('[')) {
    throw new ApiError(400, 'invalid-url', 'Enter an address with a public host name.');
  }
  if (parsed.origin === origin && /^\/[^/]*\+?\/?$/.test(parsed.pathname) && !/\.html?$/i.test(parsed.pathname)) {
    throw new ApiError(400, 'invalid-url', 'A short link cannot point at another short link.');
  }
  if (parsed.href.length > MAX_URL_LENGTH) throw new ApiError(400, 'invalid-url', 'The address is longer than ' + MAX_URL_LENGTH + ' characters.');
  return parsed.href;
}

function normalizeAlias(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new ApiError(400, 'invalid-alias', 'The custom ending must be text.');
  const alias = value.trim().toLowerCase();
  if (alias.length === 0) return null;
  if (!ALIAS_PATTERN.test(alias)) {
    throw new ApiError(400, 'invalid-alias', 'A custom ending is 3 to 32 letters, digits, or dashes, and starts and ends with a letter or digit.');
  }
  if (RESERVED.has(alias)) throw new ApiError(409, 'alias-taken', 'That ending is already used by a page on this site.');
  return alias;
}

function normalizeHandle(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return '';
  return value.replace(/[^A-Za-z0-9 -]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_HANDLE_LENGTH);
}

function randomCode() {
  const bytes = new Uint8Array(RANDOM_CODE_LENGTH * 4);
  let code = '';
  while (code.length < RANDOM_CODE_LENGTH) {
    crypto.getRandomValues(bytes);
    for (let index = 0; index < bytes.length && code.length < RANDOM_CODE_LENGTH; index += 1) {
      /* 248 is the largest multiple of 31 below 256, so rejecting the top
         eight values keeps every symbol equally likely. */
      if (bytes[index] < 248) code += CODE_ALPHABET[bytes[index] % CODE_ALPHABET.length];
    }
  }
  return code;
}

/* Asks the static site whether a path already exists there. A real page
   answers 200 or a redirect, a missing one answers 404. Any failure counts as
   taken, because the safe mistake is refusing an alias, not shadowing a page. */
async function staticPathExists(env, origin, code) {
  if (!env || !env.ASSETS || typeof env.ASSETS.fetch !== 'function') return false;
  try {
    const probe = await env.ASSETS.fetch(new Request(origin + '/' + code, { method: 'HEAD' }));
    return probe.status !== 404;
  } catch (error) {
    return true;
  }
}

/* ------------------------------ request guards ------------------------------ */

function requireSameOrigin(request, origin) {
  const method = request.method.toUpperCase();
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') {
    throw new ApiError(403, 'origin-not-allowed', 'This request origin is not allowed.');
  }
  if (method === 'GET' || method === 'HEAD') return;
  if (request.headers.get('origin') !== origin) {
    throw new ApiError(403, 'origin-not-allowed', 'This request origin is not allowed.');
  }
}

function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : '';
}

async function readJsonBody(request) {
  const type = (request.headers.get('content-type') || '').toLowerCase();
  if (type.indexOf('application/json') !== 0) throw new ApiError(415, 'unsupported-media-type', 'Send JSON.');
  const announced = Number(request.headers.get('content-length') || 0);
  if (announced > MAX_BODY_BYTES) throw new ApiError(413, 'payload-too-large', 'The request is too large.');
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) throw new ApiError(413, 'payload-too-large', 'The request is too large.');
  let body;
  try {
    body = JSON.parse(raw);
  } catch (error) {
    throw new ApiError(400, 'invalid-json', 'The request body is not valid JSON.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'invalid-json', 'The request body must be an object.');
  return body;
}

async function callerRole(env, uid) {
  if (uid === env.SHORT_LINK_OWNER_UID) return 'owner';
  const allowed = await env.SHORT_LINKS.get('allow:' + uid);
  return allowed ? 'member' : 'none';
}

function requireCreator(role) {
  if (role !== 'owner' && role !== 'member') {
    throw new ApiError(403, 'not-invited', 'Short links are by invitation. Ask the site owner to enable them for your account.');
  }
}

function requireOwner(role) {
  if (role !== 'owner') throw new ApiError(403, 'owner-only', 'Only the site owner can manage access.');
}

function metadataUrl(url) {
  return url.length > METADATA_URL_LENGTH ? url.slice(0, METADATA_URL_LENGTH) : url;
}

function linkSummary(code, meta, extra) {
  const url = meta && typeof meta.url === 'string' ? meta.url : '';
  const summary = {
    code: code,
    url: url,
    truncated: Boolean(meta && meta.truncated),
    createdAt: meta && Number.isFinite(meta.createdAt) ? meta.createdAt : null
  };
  if (extra) Object.assign(summary, extra);
  return summary;
}

async function listByPrefix(env, prefix, cursor) {
  const options = { prefix: prefix, limit: 1000 };
  if (typeof cursor === 'string' && /^[A-Za-z0-9_=-]{1,512}$/.test(cursor)) options.cursor = cursor;
  const page = await env.SHORT_LINKS.list(options);
  return {
    keys: Array.isArray(page.keys) ? page.keys : [],
    cursor: page.list_complete ? null : (page.cursor || null)
  };
}

async function consumeQuota(env, key, maximum) {
  const current = Number(await env.SHORT_LINKS.get(key)) || 0;
  if (current >= maximum) return false;
  await env.SHORT_LINKS.put(key, String(current + 1), { expirationTtl: RATE_TTL_SECONDS });
  return true;
}

/* ------------------------------ API handlers ------------------------------ */

async function handleStatus(env, caller, role, origin) {
  const prefix = 'owner:' + caller.uid + ':';
  const mine = await listByPrefix(env, prefix);
  const links = mine.keys.map(function (key) {
    return linkSummary(key.name.slice(prefix.length), key.metadata);
  });
  links.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  return json(200, {
    configured: true,
    uid: caller.uid,
    role: role,
    origin: origin,
    limits: { maxLinks: MAX_LINKS_PER_USER, dailyCreates: DAILY_CREATES_PER_USER },
    links: links
  });
}

async function handleCreate(request, env, caller, role, origin, now) {
  requireCreator(role);
  const body = await readJsonBody(request);
  const url = normalizeTarget(body.url, origin);
  const alias = normalizeAlias(body.alias);

  const mine = await listByPrefix(env, 'owner:' + caller.uid + ':');
  if (mine.cursor || mine.keys.length >= MAX_LINKS_PER_USER) {
    throw new ApiError(429, 'too-many-links', 'You have reached the limit of ' + MAX_LINKS_PER_USER + ' links. Delete one to make room.');
  }

  let code = alias;
  if (alias) {
    if (await env.SHORT_LINKS.get('link:' + alias) || await staticPathExists(env, origin, alias)) {
      throw new ApiError(409, 'alias-taken', 'That ending is already in use.');
    }
  } else {
    code = null;
    for (let attempt = 0; attempt < 5 && !code; attempt += 1) {
      const candidate = randomCode();
      if (RESERVED.has(candidate)) continue;
      if (!(await env.SHORT_LINKS.get('link:' + candidate))) code = candidate;
    }
    if (!code) throw new ApiError(503, 'code-unavailable', 'A free code could not be found. Try again.');
  }

  const day = utcDay(now);
  if (!(await consumeQuota(env, 'rate:user:' + caller.uid + ':' + day, DAILY_CREATES_PER_USER))) {
    throw new ApiError(429, 'daily-limit', 'You have created ' + DAILY_CREATES_PER_USER + ' links today. Try again tomorrow.');
  }
  if (!(await consumeQuota(env, 'rate:global:' + day, DAILY_CREATES_GLOBAL))) {
    throw new ApiError(429, 'daily-limit', 'The site has reached its daily limit for new links. Try again tomorrow.');
  }

  const record = { url: url, owner: caller.uid, createdAt: now };
  const meta = { url: metadataUrl(url), truncated: url.length > METADATA_URL_LENGTH, createdAt: now };
  await env.SHORT_LINKS.put('link:' + code, JSON.stringify(record), { metadata: Object.assign({ owner: caller.uid }, meta) });
  await env.SHORT_LINKS.put('owner:' + caller.uid + ':' + code, '1', { metadata: meta });
  return json(201, { code: code, url: url, shortUrl: origin + '/' + code, createdAt: now });
}

async function handleDelete(env, caller, role, code) {
  requireCreator(role);
  const normalized = String(code || '').toLowerCase();
  if (!LOOKUP_PATTERN.test(normalized)) throw new ApiError(400, 'invalid-code', 'That short link code is not valid.');
  const record = await env.SHORT_LINKS.get('link:' + normalized, 'json');
  if (!record || typeof record !== 'object') throw new ApiError(404, 'not-found', 'That short link does not exist.');
  if (record.owner !== caller.uid && role !== 'owner') throw new ApiError(403, 'not-yours', 'You can only delete your own links.');
  await env.SHORT_LINKS.delete('link:' + normalized);
  if (typeof record.owner === 'string' && UID_PATTERN.test(record.owner)) {
    await env.SHORT_LINKS.delete('owner:' + record.owner + ':' + normalized);
  }
  return json(200, { deleted: true, code: normalized });
}

async function handleAccessList(env, role) {
  requireOwner(role);
  const page = await listByPrefix(env, 'allow:');
  const members = [];
  for (const key of page.keys) {
    const uid = key.name.slice('allow:'.length);
    const record = await env.SHORT_LINKS.get(key.name, 'json');
    members.push({
      uid: uid,
      handle: record && typeof record.handle === 'string' ? record.handle : '',
      grantedAt: record && Number.isFinite(record.grantedAt) ? record.grantedAt : null
    });
  }
  members.sort(function (a, b) { return (b.grantedAt || 0) - (a.grantedAt || 0); });
  return json(200, { members: members });
}

async function handleAccessGrant(request, env, caller, role, now) {
  requireOwner(role);
  const body = await readJsonBody(request);
  const uid = typeof body.uid === 'string' ? body.uid.trim() : '';
  if (!UID_PATTERN.test(uid)) throw new ApiError(400, 'invalid-uid', 'Enter a valid account id.');
  if (uid === env.SHORT_LINK_OWNER_UID) throw new ApiError(400, 'invalid-uid', 'The owner already has access.');
  const handle = normalizeHandle(body.handle);
  const record = { handle: handle, grantedAt: now, grantedBy: caller.uid };
  await env.SHORT_LINKS.put('allow:' + uid, JSON.stringify(record));
  return json(200, { granted: true, uid: uid, handle: handle, grantedAt: now });
}

async function handleAccessRevoke(env, role, uid) {
  requireOwner(role);
  const normalized = String(uid || '');
  if (!UID_PATTERN.test(normalized)) throw new ApiError(400, 'invalid-uid', 'Enter a valid account id.');
  await env.SHORT_LINKS.delete('allow:' + normalized);
  return json(200, { revoked: true, uid: normalized });
}

async function handleAllLinks(env, role, cursor) {
  requireOwner(role);
  const page = await listByPrefix(env, 'link:', cursor);
  const links = page.keys.map(function (key) {
    const meta = key.metadata || {};
    return linkSummary(key.name.slice('link:'.length), meta, {
      owner: typeof meta.owner === 'string' ? meta.owner : ''
    });
  });
  links.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  return json(200, { links: links, cursor: page.cursor });
}

async function handleApi(request, env, url, now) {
  const origin = siteOrigin(env);
  const method = request.method.toUpperCase();
  const rest = url.pathname.slice(API_ROOT.length);
  const segments = rest.split('/').filter(Boolean);
  if (rest !== '' && rest[0] !== '/') return json(404, { error: 'not-found', message: 'Unknown endpoint.' });
  if (segments.length > 2) return json(404, { error: 'not-found', message: 'Unknown endpoint.' });

  try {
    requireSameOrigin(request, origin);
    const caller = await verifyIdToken(bearerToken(request), now);
    if (!isConfigured(env)) {
      if (method === 'GET' && segments.length === 0) {
        return json(200, { configured: false, uid: caller.uid, role: 'none', origin: origin, links: [] });
      }
      throw new ApiError(503, 'not-configured', 'Short links are not set up on this site yet.');
    }
    const role = await callerRole(env, caller.uid);

    if (segments.length === 0) {
      if (method === 'GET') return await handleStatus(env, caller, role, origin);
      if (method === 'POST') return await handleCreate(request, env, caller, role, origin, now);
      throw new ApiError(405, 'method-not-allowed', 'Method not allowed.');
    }
    if (segments[0] === 'access') {
      if (segments.length === 1 && method === 'GET') return await handleAccessList(env, role);
      if (segments.length === 1 && method === 'POST') return await handleAccessGrant(request, env, caller, role, now);
      if (segments.length === 2 && method === 'DELETE') return await handleAccessRevoke(env, role, segments[1]);
      throw new ApiError(405, 'method-not-allowed', 'Method not allowed.');
    }
    if (segments[0] === 'all') {
      if (segments.length === 1 && method === 'GET') return await handleAllLinks(env, role, url.searchParams.get('cursor'));
      throw new ApiError(405, 'method-not-allowed', 'Method not allowed.');
    }
    if (segments.length === 1 && method === 'DELETE') return await handleDelete(env, caller, role, segments[0]);
    throw new ApiError(404, 'not-found', 'Unknown endpoint.');
  } catch (error) {
    if (error instanceof ApiError) return json(error.status, { error: error.code, message: error.message });
    return json(500, { error: 'internal', message: 'Something went wrong. Try again.' });
  }
}

/* ------------------------------ redirects ------------------------------ */

function passthrough(request, env) {
  if (env && env.ASSETS && typeof env.ASSETS.fetch === 'function') return env.ASSETS.fetch(request);
  return text(404, 'Not found');
}

/* A short-link path is one segment, optionally followed by "+" and a slash.
   Everything else belongs to the static site. */
function parseShortPath(pathname) {
  const match = /^\/([^/]+?)(\+)?\/?$/.exec(pathname);
  if (!match) return null;
  const code = match[1].toLowerCase();
  if (!LOOKUP_PATTERN.test(code) || RESERVED.has(code)) return null;
  return { code: code, preview: Boolean(match[2]) };
}

/* The static 404 for a code-shaped path is served through the Worker with the
   cache directives added, because that exact URL may become a live short link
   a moment later and a cached 404 would hide it. Every other passthrough is
   the static site's own business and keeps its own headers. */
async function uncacheablePassthrough(request, env) {
  const response = await passthrough(request, env);
  const headers = markUncacheable(new Headers(response.headers));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: headers });
}

async function handleShortLink(request, env, url) {
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return passthrough(request, env);
  const short = parseShortPath(url.pathname);
  if (!short) return passthrough(request, env);
  if (!isConfigured(env)) return uncacheablePassthrough(request, env);
  let record = null;
  try {
    record = await env.SHORT_LINKS.get('link:' + short.code, 'json');
  } catch (error) {
    record = null;
  }
  if (!record || typeof record !== 'object' || typeof record.url !== 'string') return uncacheablePassthrough(request, env);
  let target;
  try {
    target = new URL(record.url);
  } catch (error) {
    return uncacheablePassthrough(request, env);
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return uncacheablePassthrough(request, env);
  if (short.preview) {
    return text(200, url.host + '/' + short.code + ' points to\n' + target.href + '\n');
  }
  /* 307, not 302. Both are temporary redirects, and browsers and crawlers
     treat them alike for GET. The difference is that Cloudflare's edge caches
     302 responses by default and never caches 307, so a deleted link stops
     working at once instead of living on in the cache. */
  return new Response(null, {
    status: 307,
    headers: noStoreHeaders({ Location: target.href })
  });
}

async function handleRequest(request, env, now) {
  const url = new URL(request.url);
  if (url.pathname === API_ROOT || url.pathname.indexOf(API_ROOT + '/') === 0) {
    return handleApi(request, env, url, now);
  }
  if (url.pathname.indexOf('/api/') === 0 || url.pathname === '/api') {
    return json(404, { error: 'not-found', message: 'Unknown endpoint.' });
  }
  try {
    return await handleShortLink(request, env, url);
  } catch (error) {
    return passthrough(request, env);
  }
}

export {
  ApiError,
  RESERVED,
  handleRequest,
  normalizeAlias,
  normalizeHandle,
  normalizeTarget,
  parseShortPath,
  randomCode,
  siteOrigin,
  verifyIdToken
};

export default {
  async fetch(request, env) {
    return handleRequest(request, env, Date.now());
  }
};
