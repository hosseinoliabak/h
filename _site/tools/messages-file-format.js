(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MessageFileFormat = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Shared chat default matches Pastebin at 7 MiB. One base64 envelope is
  // below the 10 MB callable request budget and the database string limit.
  var MAX_BYTES = 7 * 1024 * 1024;
  function base64(value, maximum) {
    if (typeof value !== 'string' || value.length < 4 || value.length > maximum || value.length % 4 !== 0) return false;
    var padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
    // A flat scan avoids repeated-group regex stack growth on large files.
    return !/[^A-Za-z0-9+/]/.test(value.slice(0, value.length - padding))
      && value.slice(value.length - padding) === '='.repeat(padding);
  }
  function envelope(value) {
    if (value && value.v === 0) {
      if (Object.keys(value).sort().join(',') !== 'data,name,v' || typeof value.name !== 'string'
          || value.name.length < 1 || value.name.length > 120 || /[^\p{L}\p{N} ._()-]/u.test(value.name)
          || !base64(value.data, Math.ceil(MAX_BYTES / 3) * 4)) throw new Error('Invalid attachment.');
      var size = value.data.length / 4 * 3 - (value.data.endsWith('==') ? 2 : value.data.endsWith('=') ? 1 : 0);
      if (size < 1 || size > MAX_BYTES) throw new Error('Invalid attachment.');
      return { v: 0, name: value.name, data: value.data };
    }
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'cipher,iv,salt,v'
        || value.v !== 1 || typeof value.salt !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(value.salt)
        || typeof value.iv !== 'string' || !/^[A-Za-z0-9+/]{16}$/.test(value.iv)
        || !base64(value.cipher, Math.ceil((MAX_BYTES + 1044) / 3) * 4) || value.cipher.length < 28) throw new Error('Invalid encrypted file.');
    return { v: 1, salt: value.salt, iv: value.iv, cipher: value.cipher };
  }
  return { MAX_BYTES: MAX_BYTES, envelope: envelope };
}));
