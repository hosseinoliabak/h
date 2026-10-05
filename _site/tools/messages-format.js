/* Shared, bounded text-only Delta schema. Copied unchanged to the browser. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MessageFormat = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var COLORS = ['#b45309', '#15803d', '#1d4ed8', '#be123c', '#7e22ce'];
  var BACKGROUNDS = ['#fef3c7', '#dcfce7', '#dbeafe', '#ffe4e6', '#f3e8ff'];
  function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
  function normalize(value) {
    if (!object(value) || Object.keys(value).some(function (k) { return k !== 'ops'; })
        || !Array.isArray(value.ops) || !value.ops.length || value.ops.length > 512) throw new Error('Invalid rich text.');
    var length = 0;
    var ops = value.ops.map(function (op) {
      if (!object(op) || Object.keys(op).some(function (k) { return k !== 'insert' && k !== 'attributes'; })
          || typeof op.insert !== 'string' || !op.insert.length) throw new Error('Only text is supported.');
      length += op.insert.length;
      if (length > 16000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(op.insert)
          || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(op.insert)) throw new Error('Text is too large or contains invalid characters.');
      var clean = { insert: op.insert };
      if (op.attributes !== undefined) {
        if (!object(op.attributes)) throw new Error('Invalid formatting.');
        var attrs = {};
        Object.keys(op.attributes).forEach(function (key) {
          var v = op.attributes[key];
          var valid = key === 'code-block' ? v === true || v === 'plain'
            : ['bold', 'italic', 'underline', 'code', 'blockquote'].indexOf(key) >= 0 ? v === true
            : key === 'header' ? v === 2 || v === 3
            : key === 'list' ? v === 'ordered' || v === 'bullet'
            : key === 'direction' ? v === 'rtl'
            : key === 'align' ? ['right', 'center', 'justify'].indexOf(v) >= 0
            : key === 'color' ? COLORS.indexOf(v) >= 0
            : key === 'background' ? BACKGROUNDS.indexOf(v) >= 0 : false;
          if (!valid) throw new Error('Unsupported formatting.');
          attrs[key] = key === 'code-block' ? true : v;
        });
        if (Object.keys(attrs).length) clean.attributes = attrs;
      }
      return clean;
    });
    if (!ops.map(function (o) { return o.insert; }).join('').trim()) throw new Error('Write a message first.');
    if (!ops[ops.length - 1].insert.endsWith('\n')) {
      if (length >= 16000) throw new Error('Text is too large.');
      // Extend the last string rather than adding an operation beyond the cap.
      ops[ops.length - 1].insert += '\n';
    }
    var result = { ops: ops };
    if (JSON.stringify(result).length > 48000) throw new Error('Formatting is too large.');
    return result;
  }
  return { normalize: normalize, COLORS: COLORS, BACKGROUNDS: BACKGROUNDS };
}));
