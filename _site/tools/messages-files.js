/* Optional password-encrypted file transport. Encrypted filenames and bytes
   are authenticated together. Plaintext is sent only when selected. */
(function () {
  'use strict';
  var schema = window.MessageFileFormat;
  function cryptoReady() {
    if (!window.isSecureContext || !window.crypto || !window.crypto.subtle) throw new Error('Encrypted files need a secure browser connection.');
  }
  function base64(bytes) {
    var parts = [];
    for (var i = 0; i < bytes.length; i += 8192) parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)));
    return btoa(parts.join(''));
  }
  function decode(value) { return Uint8Array.from(atob(value), function (c) { return c.charCodeAt(0); }); }
  function filename(value) {
    var clean = String(value).replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 120).replace(/^\.+/, '');
    return clean.trim() || 'download.bin';
  }
  async function key(password, salt) {
    cryptoReady();
    if (typeof password !== 'string' || password.length < 16 || password.length > 256) throw new Error('Use a unique passphrase of 16 to 256 characters.');
    var material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: 600000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  function associated(threadId) {
    if (!/^[a-f0-9]{32}$/.test(threadId)) throw new Error('Invalid conversation.');
    return new TextEncoder().encode('oliabak-messages-file:v1:' + threadId);
  }
  async function encrypt(file, password, threadId) {
    cryptoReady();
    if (!file || file.size < 1 || file.size > schema.MAX_BYTES) throw new Error('Choose a file between 1 byte and 7 MiB.');
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var derived = await key(password, salt);
    var bytes = new Uint8Array(await file.arrayBuffer());
    var metadata = new TextEncoder().encode(JSON.stringify({ name: filename(file.name) }));
    var packed = new Uint8Array(4 + metadata.length + bytes.length);
    new DataView(packed.buffer).setUint32(0, metadata.length);
    packed.set(metadata, 4); packed.set(bytes, 4 + metadata.length);
    try {
      var cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: associated(threadId), tagLength: 128 }, derived, packed);
      return schema.envelope({ v: 1, salt: base64(salt), iv: base64(iv), cipher: base64(new Uint8Array(cipher)) });
    } finally { bytes.fill(0); packed.fill(0); }
  }
  async function decrypt(value, password, threadId) {
    var input = schema.envelope(value);
    if (input.v === 0) return { name: filename(input.name), bytes: decode(input.data) };
    cryptoReady();
    var derived = await key(password, decode(input.salt));
    var packed;
    try { packed = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(input.iv), additionalData: associated(threadId), tagLength: 128 }, derived, decode(input.cipher))); }
    catch (error) { throw new Error('The passphrase is wrong or the encrypted file was changed.'); }
    try {
      if (packed.length < 5) throw new Error('Invalid encrypted file.');
      var length = new DataView(packed.buffer).getUint32(0);
      if (length < 1 || length > 1024 || length + 4 >= packed.length || packed.length - length - 4 > schema.MAX_BYTES) throw new Error('Invalid encrypted file.');
      var metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(packed.subarray(4, 4 + length)));
      if (!metadata || typeof metadata.name !== 'string' || metadata.name.length > 120) throw new Error('Invalid encrypted file.');
      return { name: filename(metadata.name), bytes: packed.slice(4 + length) };
    } catch (error) { throw new Error('Invalid encrypted file.'); }
    finally { packed.fill(0); }
  }
  async function plain(file) {
    if (!file || file.size < 1 || file.size > schema.MAX_BYTES) throw new Error('Choose a file between 1 byte and 7 MiB.');
    var bytes = new Uint8Array(await file.arrayBuffer());
    try { return schema.envelope({ v: 0, name: filename(file.name), data: base64(bytes) }); }
    finally { bytes.fill(0); }
  }
  window.MessageFiles = { encrypt: encrypt, plain: plain, decrypt: decrypt, filename: filename };
}());
