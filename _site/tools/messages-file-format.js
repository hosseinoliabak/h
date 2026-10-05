(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MessageFileFormat = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var MAX_BYTES = 1048576;
  function base64(value, maximum) {
    return typeof value === 'string' && value.length > 0 && value.length <= maximum
      && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
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
