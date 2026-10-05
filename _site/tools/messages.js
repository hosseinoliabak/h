/* Private content is fetched after authentication. Never render stored HTML.
   Quill is only an input surface; canonical text-only Delta is validated again
   on the server, and stored messages are drawn using DOM nodes and textContent. */
(function () {
  'use strict';
  if (!document.getElementById('messages')) return;
  var format = window.MessageFormat;
  var state = { user: null, epoch: 0, owner: false, thread: null, threadId: null, editing: null, busy: false, subscriptions: [], threadRef: null, threadCallback: null, expiryTimer: null, urls: new Set() };
  var editor;
  var agentApproval = null, agentRequest = null;
  var agentNonce = new URL(window.location.href).searchParams.get('mcp_request');
  if (!/^[a-f0-9]{32}$/.test(agentNonce || '')) agentNonce = null;
  function $(id) { return document.getElementById('msg-' + id); }
  function node(tag, text, className) {
    var element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function status(text) { $('status').textContent = text; }
  function button(text, action) {
    var result = node('button', text, 'tool-button');
    result.type = 'button';
    result.addEventListener('click', action);
    return result;
  }
  function readableError(error) {
    var code = error && error.code || '';
    if (code === 'file-client') return error.message;
    if (code.indexOf('permission') >= 0 || code.indexOf('unauthenticated') >= 0) return 'You do not have access to this conversation. Sign in to the invited account.';
    if (code.indexOf('not-found') >= 0 || code.indexOf('unimplemented') >= 0) return 'Messaging is not available yet. The site owner needs to finish setup.';
    if (code.indexOf('resource-exhausted') >= 0) return 'A messaging limit was reached. Please try later or contact the site owner.';
    if (code.indexOf('aborted') >= 0) return 'This text changed while you were editing. Cancel and reopen the latest version.';
    return 'The request failed. Your unsent text is still here. Please try again.';
  }
  async function call(input, serviceName) {
    var epoch = state.epoch;
    var service = await window.siteAuth.firebaseFunctions();
    if (epoch !== state.epoch || !state.user) throw new Error('Session changed.');
    var result = await service.httpsCallable(serviceName || 'privateMessages', { timeout: 30000, limitedUseAppCheckTokens: true })(input);
    if (epoch !== state.epoch || !state.user) throw new Error('Session changed.');
    if (!result || !result.data || typeof result.data !== 'object') throw new Error('Invalid response.');
    return result.data;
  }
  async function run(action, success) {
    if (state.busy) return;
    var epoch = state.epoch;
    state.busy = true;
    document.querySelectorAll('#messages button').forEach(function (b) { b.disabled = true; });
    try { var result = await action(); if (epoch === state.epoch) { if (success) success(result); } }
    catch (error) { if (epoch === state.epoch) status(readableError(error)); }
    finally {
      if (epoch === state.epoch) {
        state.busy = false;
        document.querySelectorAll('#messages button').forEach(function (b) { b.disabled = false; });
      }
    }
  }
  function renderRich(body) {
    var delta = format.normalize(typeof body === 'string' ? JSON.parse(body) : body);
    var container = node('div', undefined, 'msg-rich');
    var spans = [], lineText = '', previousList = null, previousListType = null;
    function endLine(attrs) {
      var block;
      if (attrs['code-block']) block = node('pre');
      else if (attrs.header) block = node(attrs.header === 2 ? 'h3' : 'h4');
      else if (attrs.blockquote) block = node('blockquote');
      else if (attrs.list) block = node('li');
      else block = node('p');
      block.dir = attrs['code-block'] ? 'ltr' : attrs.direction === 'rtl' || /[\u0590-\u08ff]/.test(lineText) ? 'rtl' : 'auto';
      if (attrs.align && !attrs['code-block']) block.style.textAlign = attrs.align;
      spans.forEach(function (span) { block.appendChild(span); });
      if (!spans.length) block.appendChild(node('br'));
      if (attrs.list) {
        if (!previousList || previousListType !== attrs.list) {
          previousList = node(attrs.list === 'ordered' ? 'ol' : 'ul');
          previousList.dir = block.dir;
          previousListType = attrs.list;
          container.appendChild(previousList);
        }
        previousList.appendChild(block);
      } else { previousList = null; previousListType = null; container.appendChild(block); }
      spans = []; lineText = '';
    }
    delta.ops.forEach(function (op) {
      var attrs = op.attributes || {};
      op.insert.split('\n').forEach(function (part, index, parts) {
        if (part) {
          var span = node(attrs.code ? 'code' : 'span', part);
          if (attrs.bold) span.style.fontWeight = '700';
          if (attrs.italic) span.style.fontStyle = 'italic';
          if (attrs.underline) span.style.textDecoration = 'underline';
          if (attrs.background) { span.style.backgroundColor = attrs.background; span.style.color = '#1f2937'; }
          if (attrs.color) { span.style.color = attrs.color; if (!attrs.background) span.style.backgroundColor = '#ffffff'; }
          spans.push(span); lineText += part;
        }
        if (index < parts.length - 1) endLine(attrs);
      });
    });
    return container;
  }
  function resetEditor() {
    state.editing = null;
    agentRequest = null;
    if (editor) { editor.setText(''); editor.history.clear(); }
    $('editing').textContent = 'Write a message';
    $('send').textContent = 'Send message';
    $('cancel').hidden = true;
    $('agent-ask').hidden = !state.thread || !state.thread.agentReady;
  }
  function downloadBytes(bytes, name) {
    var url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    state.urls.add(url);
    var link = node('a'); link.href = url; link.download = window.MessageFiles.filename(name);
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); state.urls.delete(url); }, 10000);
  }
  async function downloadFile(fileId) {
    var epoch = state.epoch, threadId = state.threadId;
    var password = $('file-pass').value; $('file-pass').value = '';
    await run(async function () {
      var response = await call({ action: 'download', threadId: threadId, fileId: fileId });
      var decoded;
      try { decoded = await window.MessageFiles.decrypt(response.envelope, password, threadId); }
      catch (error) { error.code = 'file-client'; throw error; }
      try { if (epoch === state.epoch && threadId === state.threadId) downloadBytes(decoded.bytes, decoded.name); }
      finally { decoded.bytes.fill(0); }
    }, function () { status('Download started.'); });
  }
  function clearThread() {
    if (state.threadRef) state.threadRef.off('value', state.threadCallback);
    window.clearTimeout(state.expiryTimer);
    state.threadRef = null; state.threadCallback = null;
    state.thread = null; state.threadId = null;
    state.urls.forEach(function (url) { URL.revokeObjectURL(url); }); state.urls.clear();
    $('file').value = ''; $('file-pass').value = ''; $('file-encrypt').checked = true; $('files').hidden = true;
    $('feed').replaceChildren();
    $('thread-title').textContent = 'Select a conversation';
    $('expiry').textContent = '';
    $('compose').hidden = true; $('delete').hidden = true; $('confirm-delete').hidden = true;
    $('agent').hidden = true; $('agent-ask').hidden = true; $('agent-info').textContent = ''; $('agent-client').textContent = ''; $('agent-limit').value = '5';
    resetEditor();
  }
  function drawThread(thread) {
    if (!thread || !thread.members || thread.members[state.user.uid] !== true || !Number.isFinite(thread.expiresAt) || thread.expiresAt <= Date.now()
        || typeof thread.title !== 'string' || thread.title.length > 120 || !thread.names || Object.keys(thread.messages || {}).length > 100) throw new Error('Invalid conversation.');
    var feed = document.createDocumentFragment();
    Object.entries(thread.messages || {}).sort(function (a, b) {
      return (a[1].kind === 'document' ? 0 : 1) - (b[1].kind === 'document' ? 0 : 1) || a[1].createdAt - b[1].createdAt;
    }).forEach(function (entry) {
      try {
      var messageId = entry[0], message = entry[1];
      if (message && message.kind === 'file') {
        if (!/^[a-f0-9]{32}$/.test(messageId) || typeof message.author !== 'string' || !Number.isSafeInteger(message.bytes) || message.bytes < 1 || message.bytes > 1048576 || typeof message.encrypted !== 'boolean') throw new Error('Invalid attachment.');
        var attachment = node('article', undefined, 'msg-card' + (message.author === state.user.uid ? ' msg-mine' : ''));
        attachment.appendChild(node('strong', message.encrypted ? 'Password-encrypted attachment' : 'Attachment without file encryption'));
        attachment.appendChild(node('p', Math.ceil(message.bytes / 1024) + ' KiB' + (message.encrypted ? ' · Enter its passphrase below, then download.' : ' · Available to conversation members.')));
        attachment.appendChild(button('Download file', function () { if (!state.busy) downloadFile(messageId); }));
        feed.appendChild(attachment); return;
      }
      if (!/^[a-f0-9]{32}$/.test(messageId) || !message || typeof message.body !== 'string' || message.body.length > 48000
          || !Number.isSafeInteger(message.revision) || !Number.isFinite(message.createdAt) || typeof message.author !== 'string'
          || !['message', 'document', 'agent'].includes(message.kind)) throw new Error('Invalid message.');
      var mine = message.author === state.user.uid;
      var card = node('article', undefined, 'msg-card' + (mine ? ' msg-mine' : '') + (message.kind === 'document' ? ' msg-document' : ''));
      var head = node('header');
      var author = thread.names[message.author];
      head.appendChild(node('strong', message.kind === 'agent' ? 'Hossein’s assistant · AI' : message.kind === 'document' ? 'Shared guide · راهنمای مشترک' : typeof author === 'string' ? author.slice(0, 80) : 'Member'));
      var time = node('time', new Date(message.createdAt).toLocaleString());
      time.dateTime = new Date(message.createdAt).toISOString(); head.appendChild(time);
      if (message.revision > 1) head.appendChild(node('span', 'Edited · revision ' + message.revision));
      if (message.kind !== 'agent' && (mine || message.kind === 'document')) head.appendChild(button('Edit', function () {
        if (!editor || state.busy) return;
        editor.setContents(format.normalize(JSON.parse(message.body)));
        state.editing = { messageId: messageId, revision: message.revision };
        $('editing').textContent = message.kind === 'document' ? 'Edit the shared guide' : 'Edit your message';
        $('send').textContent = 'Save changes'; $('cancel').hidden = false;
        $('agent-ask').hidden = true;
        editor.focus(); $('compose').scrollIntoView({ block: 'nearest' });
      }));
      if (message.kind === 'document') head.appendChild(button('Download guide', function () {
        var text = format.normalize(JSON.parse(message.body)).ops.map(function (op) { return op.insert; }).join('');
        downloadBytes(new TextEncoder().encode(text), 'research-guide.txt');
      }));
      card.appendChild(head); card.appendChild(renderRich(message.body)); feed.appendChild(card);
      } catch (error) {
        feed.appendChild(node('article', 'This message contains unsupported formatting. Other messages and conversation controls remain available.', 'msg-card'));
      }
    });
    state.thread = thread;
    var maximum = Number.isSafeInteger(thread.agentRequestLimit) && thread.agentRequestLimit >= 1 && thread.agentRequestLimit <= 50 ? thread.agentRequestLimit : 5;
    $('agent').hidden = !state.owner && !thread.agentReady;
    $('agent-owner').hidden = !state.owner;
    if (document.activeElement !== $('agent-limit')) $('agent-limit').value = String(maximum);
    $('agent-info').textContent = (thread.agentReady ? 'Connected. ' : 'An assistant has not been connected yet. ') + 'Maximum ' + maximum + ' requests per person in any three hours. Requests expire after 24 hours. When event delivery is connected, notifications may take five minutes.';
    $('agent-revoke').hidden = !thread.agentGrantId;
    $('agent-ask').hidden = !thread.agentReady || !!state.editing;
    showAgentApproval();
    $('thread-title').textContent = thread.title;
    $('expiry').textContent = 'Available until ' + new Date(thread.expiresAt).toLocaleDateString() + '. Both members can edit the shared guide.';
    $('feed').replaceChildren(feed);
    $('compose').hidden = !editor;
    $('files').hidden = !window.MessageFiles;
    $('delete').hidden = !state.owner && thread.createdBy !== state.user.uid;
    window.clearTimeout(state.expiryTimer);
    state.expiryTimer = window.setTimeout(function () {
      if (state.thread && state.thread.expiresAt <= Date.now()) { clearThread(); status('This conversation has expired.'); }
      else if (state.thread) drawThread(state.thread);
    }, Math.min(2147483647, Math.max(1, thread.expiresAt - Date.now())));
  }
  function openThread(threadId) {
    if (state.busy || !/^[a-f0-9]{32}$/.test(threadId) || !state.user) return;
    clearThread(); state.threadId = threadId;
    var epoch = state.epoch;
    var ref = window.siteAuth.db().ref('private-message-threads/' + threadId);
    state.threadRef = ref;
    state.threadCallback = function (snapshot) {
      if (epoch !== state.epoch || state.threadId !== threadId) return;
      try { drawThread(snapshot.val()); status('Private conversation. Only its members can open it.'); }
      catch (error) { clearThread(); status('This conversation is unavailable or contains unsupported formatting.'); }
    };
    ref.on('value', state.threadCallback, function () {
      if (epoch !== state.epoch || state.threadId !== threadId) return;
      clearThread(); status('You do not have access to this conversation.');
    });
  }
  function watchInbox() {
    var epoch = state.epoch;
    var ref = window.siteAuth.db().ref('private-message-inboxes/' + state.user.uid);
    var callback = function (snapshot) {
      if (epoch !== state.epoch) return;
      var values = snapshot.val() || {};
      $('inbox').replaceChildren();
      if (typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length > 20) { status('The conversation list is invalid.'); return; }
      var count = 0;
      Object.entries(values).sort(function (a, b) { return b[1].createdAt - a[1].createdAt; }).forEach(function (entry) {
        var item = entry[1];
        if (!/^[a-f0-9]{32}$/.test(entry[0]) || !item || item.expiresAt <= Date.now() || typeof item.title !== 'string' || typeof item.peer !== 'string') return;
        var li = node('li');
        li.appendChild(button(item.peer.slice(0, 80) + ' · ' + item.title.slice(0, 120), function () { openThread(entry[0]); }));
        $('inbox').appendChild(li); count += 1;
      });
      $('empty').hidden = count > 0;
      if (state.threadId && !values[state.threadId]) clearThread();
    };
    ref.on('value', callback, function () { if (epoch === state.epoch) status('Your conversation list could not be loaded.'); });
    state.subscriptions.push(function () { ref.off('value', callback); });
  }
  async function onUser(user) {
    if (user && state.user && user.uid === state.user.uid) return;
    state.epoch += 1;
    state.subscriptions.forEach(function (off) { off(); }); state.subscriptions = [];
    clearThread(); state.user = user; state.owner = false; state.busy = false;
    agentApproval = null;
    $('inbox').replaceChildren(); $('people').replaceChildren(); $('name').value = ''; $('identity').textContent = ''; $('find').value = '';
    document.querySelectorAll('#messages button').forEach(function (b) { b.disabled = false; });
    $('login').hidden = !!user; $('workspace').hidden = true; $('owner').hidden = true; $('profile').hidden = true;
    if (!user) { status('Sign in to see conversations shared with you.'); return; }
    status('Loading your private messages.');
    await run(function () { return call({ action: 'bootstrap' }); }, function (data) {
      if (typeof data.isOwner !== 'boolean' || !data.profile || data.profile.uid !== state.user.uid || typeof data.profile.name !== 'string' || typeof data.profile.email !== 'string' || typeof data.profile.handle !== 'string') throw new Error('Invalid profile.');
      state.owner = data.isOwner;
      $('profile').hidden = false; $('workspace').hidden = false; $('owner').hidden = false;
      $('guide-label').hidden = !state.owner; $('guide').checked = state.owner;
      Array.from($('find-mode').options).forEach(function (option) { option.hidden = !state.owner && option.value !== 'email'; option.disabled = option.hidden; });
      $('find-mode').value = 'email';
      $('name').value = data.profile.name.slice(0, 80);
      $('identity').textContent = [data.profile.handle, data.profile.email].filter(Boolean).join(' · ');
      status('Ready. Choose a conversation.'); watchInbox();
      if (state.owner && agentNonce) loadAgentApproval();
    });
  }
  try {
    if (!window.Quill || !format) throw new Error('Editor unavailable.');
    editor = new window.Quill('#msg-editor', {
      theme: 'snow', placeholder: 'Write in Persian or English…',
      formats: ['bold', 'italic', 'underline', 'code', 'header', 'list', 'blockquote', 'code-block', 'direction', 'align', 'color', 'background'],
      modules: { toolbar: [[{ header: [2, 3, false] }], ['bold', 'italic', 'underline', 'code'], [{ color: format.COLORS }, { background: format.BACKGROUNDS }], [{ list: 'ordered' }, { list: 'bullet' }], ['blockquote', 'code-block'], [{ direction: 'rtl' }, { align: [] }], ['clean']] }
    });
    editor.root.setAttribute('aria-label', 'Message rich-text editor'); editor.root.setAttribute('role', 'textbox'); editor.root.setAttribute('aria-multiline', 'true');
    // External paste is plain text. Formatting is applied with this toolbar;
    // clipboard HTML and embeds never enter Quill's HTML import pipeline.
    editor.root.addEventListener('paste', function (event) {
      event.preventDefault(); event.stopImmediatePropagation();
      var pasted = event.clipboardData ? event.clipboardData.getData('text/plain') : '';
      if (pasted.length + editor.getLength() > 16000) { status('The pasted text exceeds the 16,000 character limit.'); return; }
      var range = editor.getSelection(true) || { index: editor.getLength() - 1, length: 0 };
      editor.deleteText(range.index, range.length, 'user');
      editor.insertText(range.index, pasted, 'user');
      editor.setSelection(range.index + pasted.length, 0);
    }, true);
    editor.root.addEventListener('drop', function (event) { event.preventDefault(); event.stopImmediatePropagation(); status('Files and HTML drops are not supported. Paste plain text instead.'); }, true);
    ['copy', 'cut'].forEach(function (type) {
      editor.root.addEventListener(type, function (event) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!event.clipboardData) return;
        var range = editor.getSelection();
        if (!range) return;
        event.clipboardData.setData('text/plain', editor.getText(range.index, range.length));
        if (type === 'cut') editor.deleteText(range.index, range.length, 'user');
      }, true);
    });
    editor.root.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); $('compose').requestSubmit(); }
      if (event.key === 'Escape' && state.editing) { event.preventDefault(); resetEditor(); }
    });
    document.querySelectorAll('#messages .ql-toolbar button').forEach(function (b) { var label = b.className.replace(/ql-/g, '').trim() + (b.value ? ' ' + b.value : ''); b.setAttribute('aria-label', label); b.title = label; });
    document.querySelectorAll('#messages .ql-toolbar select').forEach(function (s) { s.setAttribute('aria-label', s.className.replace(/ql-/g, '')); });
  } catch (error) { status('The editor could not load. You can still read your conversations.'); }
  $('compose').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!editor || !state.threadId || !state.user || state.busy) return;
    var body;
    try { body = format.normalize(editor.getContents()); }
    catch (error) { status(error.message); return; }
    var input = { action: state.editing ? 'edit' : 'send', threadId: state.threadId, body: body };
    if (state.editing) { input.messageId = state.editing.messageId; input.revision = state.editing.revision; }
    run(function () { return call(input); }, function () { resetEditor(); status('Saved.'); });
  });
  $('cancel').addEventListener('click', resetEditor);
  function showAgentApproval() {
    $('agent-approval').hidden = !state.owner || !agentApproval || !state.thread;
    $('agent-client').textContent = agentApproval ? 'Connecting app: ' + agentApproval.clientName + '. Callback host: ' + agentApproval.redirectHost + '. Check the selected conversation before approving.' : '';
  }
  async function workerJson(path, options) {
    var controller = new AbortController(), timer = window.setTimeout(function () { controller.abort(); }, 15000);
    try {
      var response = await fetch('https://mcp.oliabak.com' + path, Object.assign({ credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: controller.signal }, options || {}));
      if (new URL(response.url).origin !== 'https://mcp.oliabak.com' || !response.ok || Number(response.headers.get('content-length') || 0) > 8000 || !/^application\/json\b/i.test(response.headers.get('content-type') || '')) throw new Error('Connection failed.');
      var reader = response.body.getReader(), chunks = [], size = 0;
      try { for (;;) { var part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 8000) throw new Error('Invalid response.'); chunks.push(part.value); } }
      catch (error) { await reader.cancel(); throw error; }
      finally { reader.releaseLock(); }
      var bytes = new Uint8Array(size), at = 0;
      chunks.forEach(function (chunk) { bytes.set(chunk, at); at += chunk.length; });
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } finally { window.clearTimeout(timer); }
  }
  async function loadAgentApproval() {
    var epoch = state.epoch;
    try {
      var data = await workerJson('/approval-info?request=' + agentNonce);
      if (epoch !== state.epoch || !state.user || !state.owner) return;
      if (data.nonce !== agentNonce || typeof data.clientId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(data.clientId) || typeof data.clientName !== 'string' || data.clientName.length > 100 || typeof data.redirectHost !== 'string' || data.redirectHost.length > 255 || !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= Date.now()) throw new Error('Invalid connection.');
      agentApproval = data; showAgentApproval();
      status('Select the conversation the connecting assistant may access, then approve inside that conversation.');
    } catch { if (epoch === state.epoch) status('The assistant connection request is unavailable or expired. Start connecting again from your agent app.'); }
  }
  $('agent-limit-save').addEventListener('click', function () {
    if (!state.owner || !state.threadId) return;
    var maximum = Number($('agent-limit').value);
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 50) { status('Choose a limit from 1 to 50.'); return; }
    run(function () { return call({ action: 'limit', threadId: state.threadId, maximum: maximum }, 'messageAgents'); }, function (data) { if (data.saved !== true) throw new Error('The limit was not saved.'); status('Assistant limit saved for this conversation.'); });
  });
  $('agent-revoke').addEventListener('click', function () {
    if (!state.owner || !state.threadId) return;
    run(function () { return call({ action: 'revoke', threadId: state.threadId }, 'messageAgents'); }, function (data) { if (data.revoked !== true) throw new Error('Revocation failed.'); status('Assistant access disconnected.'); });
  });
  $('agent-deny').addEventListener('click', function () { agentApproval = null; agentNonce = null; showAgentApproval(); window.history.replaceState(null, '', window.location.pathname); status('Assistant connection canceled.'); });
  $('agent-approve').addEventListener('click', function () {
    if (!state.owner || !state.threadId || !agentApproval || agentApproval.expiresAt <= Date.now()) return;
    var approval = agentApproval, threadId = state.threadId, epoch = state.epoch;
    run(async function () {
      var ticket = await call({ action: 'connect', threadId: threadId, nonce: agentNonce, clientId: approval.clientId }, 'messageAgents');
      if (epoch !== state.epoch || threadId !== state.threadId || !/^[a-f0-9]{32}\.[a-f0-9]{64}$/.test(ticket.ticket || '')) throw new Error('Invalid connection.');
      return workerJson('/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nonce: agentNonce, ticket: ticket.ticket }) });
    }, function (data) {
      var redirect = new URL(data.redirectTo);
      if (redirect.host !== approval.redirectHost || redirect.username || redirect.password || redirect.hash || !(redirect.protocol === 'https:' || redirect.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname))) throw new Error('Invalid callback.');
      window.location.assign(redirect.href);
    });
  });
  $('agent-ask').addEventListener('click', function () {
    if (!editor || !state.threadId || !state.user || state.editing || !state.thread?.agentReady) return;
    var text = editor.getText().trim();
    if (!text || text.length > 4000) { status('Write a research question of up to 4,000 characters.'); return; }
    if (!agentRequest || agentRequest.text !== text || agentRequest.threadId !== state.threadId) agentRequest = { text: text, threadId: state.threadId, requestId: Array.from(window.crypto.getRandomValues(new Uint8Array(16)), function (b) { return b.toString(16).padStart(2, '0'); }).join('') };
    var input = Object.assign({ action: 'request' }, agentRequest);
    run(function () { return call(input, 'messageAgents'); }, function (data) { if (data.queued !== true) throw new Error('Request not queued.'); resetEditor(); status('Research request queued. The connected assistant will reply when available.'); });
  });
  $('upload-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!state.threadId || !state.user || state.busy) return;
    var file = $('file').files[0], password = $('file-pass').value, encrypted = $('file-encrypt').checked;
    var threadId = state.threadId, epoch = state.epoch;
    $('file-pass').value = '';
    run(async function () {
      var payload;
      try { payload = encrypted ? await window.MessageFiles.encrypt(file, password, threadId) : await window.MessageFiles.plain(file); }
      catch (error) { error.code = 'file-client'; throw error; }
      if (epoch !== state.epoch || threadId !== state.threadId) throw new Error('Session changed.');
      return call({ action: 'upload', threadId: threadId, envelope: payload, bytes: file.size });
    }, function () { $('file').value = ''; status(encrypted ? 'Encrypted file attached. Share the passphrase separately.' : 'File attached without file encryption.'); });
  });
  $('profile-form').addEventListener('submit', function (event) { event.preventDefault(); run(function () { return call({ action: 'profile', name: $('name').value }); }, function () { status('Your messaging name was saved.'); }); });
  $('find-form').addEventListener('submit', function (event) {
    event.preventDefault(); $('people').replaceChildren();
    run(function () { return call({ action: 'find', mode: $('find-mode').value, query: $('find').value }); }, function (data) {
      if (!Array.isArray(data.users) || data.users.length > 5) throw new Error('Invalid search results.');
      data.users.forEach(function (person) {
        if (!person || typeof person.uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(person.uid) || typeof person.name !== 'string' || typeof person.email !== 'string' || typeof person.handle !== 'string') throw new Error('Invalid person.');
        var li = node('li');
        li.appendChild(node('span', [person.name.slice(0, 80), person.handle.slice(0, 20), person.email.slice(0, 254)].filter(Boolean).join(' · ')));
        li.appendChild(button('Start conversation', function () {
          run(function () { return call({ action: 'create', peerUid: person.uid, guide: $('guide').checked }); }, function (response) {
            if (!/^[a-f0-9]{32}$/.test(response.threadId || '')) throw new Error('Invalid conversation.');
            // run restores controls before accepting another action.
            window.setTimeout(function () { if (state.user) openThread(response.threadId); }, 0);
            status('Conversation created.'); $('people').replaceChildren();
          });
        }));
        $('people').appendChild(li);
      });
      status(data.users.length ? 'Choose the correct account before starting a conversation.' : 'No matching account. Ask them to sign in and confirm their email or username.');
    });
  });
  $('delete').addEventListener('click', function () { $('confirm-delete').hidden = false; });
  $('delete-no').addEventListener('click', function () { $('confirm-delete').hidden = true; });
  $('delete-yes').addEventListener('click', function () { if (!state.threadId) return; run(function () { return call({ action: 'delete', threadId: state.threadId }); }, function () { clearThread(); status('Conversation deleted for both members.'); }); });
  ['google', 'github'].forEach(function (provider) {
    $('' + provider).addEventListener('click', function () {
      window.siteAuth.signIn(provider + '.com').catch(function (error) { status(error.message || 'Sign-in failed. Please try again.'); });
    });
  });
  function boot() {
    if (!window.siteAuth) { status('Sign-in is unavailable. Reload the page to try again.'); return; }
    window.siteAuth.onChange(onUser);
    window.siteAuth.ready().catch(function () { status('Your sign-in could not be restored. Please sign in again.'); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
}());
