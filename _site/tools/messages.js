/* Private content is fetched after authentication. Never render stored HTML.
   Quill is only an input surface; canonical text-only Delta is validated again
   on the server, and stored messages are drawn using DOM nodes and textContent. */
(function () {
  'use strict';
  if (!document.getElementById('messages')) return;
  var format = window.MessageFormat;
  var state = { user: null, epoch: 0, owner: false, thread: null, threadId: null, editing: null, busy: false, subscriptions: [], threadRef: null, threadCallback: null, expiryTimer: null, urls: new Set(), feedFresh: false, autoOpened: false, panel: null, panelOpen: false, groupDraft: [] };
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
  function when(time) {
    return new Date(time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }
  function toggle(panelId, toggleId, open) {
    $(panelId).hidden = !open;
    $(toggleId).setAttribute('aria-expanded', String(open));
  }
  function markCurrent() {
    document.querySelectorAll('#msg-inbox button').forEach(function (b) { b.setAttribute('aria-current', String(b.dataset.thread === state.threadId)); });
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
    $('send').textContent = 'Send';
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
  async function downloadFile(fileId, encrypted) {
    if (encrypted && !$('file-pass').value) {
      toggle('files', 'attach-toggle', true); $('file-pass').focus();
      status('Enter the file passphrase, then choose Download file again.'); return;
    }
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
    $('file').value = ''; $('file-pass').value = ''; $('file-encrypt').checked = true; toggle('files', 'attach-toggle', false);
    $('feed').replaceChildren(); $('feed').dataset.empty = 'Choose a conversation from the list.';
    $('thread-title').textContent = 'Select a conversation';
    $('expiry').textContent = '';
    $('compose').hidden = true; $('delete').hidden = true; $('confirm-delete').hidden = true;
    markCurrent();
    state.panel = null; closePanel(); drawPanel(null);
    $('agent').hidden = true; $('agent-ask').hidden = true; $('agent-info').textContent = ''; $('agent-client').textContent = ''; $('agent-limit').value = '5';
    resetEditor();
  }
  function checkFile(messageId, message) {
    if (!/^[a-f0-9]{32}$/.test(messageId) || typeof message.author !== 'string' || !Number.isSafeInteger(message.bytes) || message.bytes < 1 || message.bytes > 1048576 || typeof message.encrypted !== 'boolean') throw new Error('Invalid attachment.');
  }
  function checkMessage(messageId, message) {
    if (!/^[a-f0-9]{32}$/.test(messageId) || !message || typeof message.body !== 'string' || message.body.length > 48000
        || !Number.isSafeInteger(message.revision) || !Number.isFinite(message.createdAt) || typeof message.author !== 'string'
        || !['message', 'document', 'agent'].includes(message.kind)) throw new Error('Invalid message.');
  }
  function fileText(message) {
    return Math.ceil(message.bytes / 1024) + ' KiB · ' + (message.encrypted ? 'needs its passphrase to download' : 'readable by conversation members');
  }
  // Authors delete their own messages and files; the site owner any of them.
  // The server applies the same rule. The guide goes only with the conversation.
  function canDelete(message) {
    return message.kind !== 'document' && (state.owner || (message.kind !== 'agent' && message.author === state.user.uid));
  }
  function deleteButton(messageId) {
    var armed = null, result = button('Delete', function () {
      if (state.busy) return;
      if (!armed) {
        result.textContent = 'Confirm delete'; result.classList.add('msg-armed');
        armed = window.setTimeout(function () { armed = null; result.textContent = 'Delete'; result.classList.remove('msg-armed'); }, 4000);
        return;
      }
      window.clearTimeout(armed); armed = null;
      if (state.editing && state.editing.messageId === messageId) resetEditor();
      var threadId = state.threadId;
      run(function () { return call({ action: 'remove', threadId: threadId, messageId: messageId }); }, function () { status('Message deleted.'); });
    });
    result.classList.add('msg-delete');
    return result;
  }
  function fileActions(messageId, message) {
    var actions = node('span', undefined, 'msg-card-actions');
    actions.appendChild(button('Download file', function () { if (!state.busy) downloadFile(messageId, message.encrypted); }));
    if (canDelete(message)) actions.appendChild(deleteButton(messageId));
    return actions;
  }
  // Headings, lists, quotes, code blocks or long text read better as a page.
  function isLong(body) {
    var ops = format.normalize(JSON.parse(body)).ops, length = 0;
    return ops.some(function (op) { length += op.insert.length; var a = op.attributes || {}; return a.header || a['code-block'] || a.blockquote || a.list; }) || length > 1200;
  }
  function startEdit(messageId, message) {
    if (!editor || state.busy) return;
    editor.setContents(format.normalize(JSON.parse(message.body)));
    state.editing = { messageId: messageId, revision: message.revision };
    $('editing').textContent = message.kind === 'document' ? 'Edit the shared guide' : 'Edit your message';
    $('send').textContent = 'Save changes'; $('cancel').hidden = false;
    $('agent-ask').hidden = true;
    editor.focus(); $('compose').scrollIntoView({ block: 'nearest' });
  }
  // The preview panel is always present beside the chat on wide screens.
  // On narrow screens it covers the chat only after the reader opens it.
  function showPanel(panel) { state.panel = panel; state.panelOpen = true; if (state.thread) drawPanel(state.thread); }
  function closePanel() { state.panelOpen = false; $('workspace').classList.remove('msg-panel-open'); }
  function drawPanel(thread) {
    var entries = Object.entries(thread && thread.messages || {});
    var guide = entries.find(function (e) { return e[1] && e[1].kind === 'document'; });
    var files = entries.filter(function (e) { return e[1] && e[1].kind === 'file'; }).sort(function (a, b) { return a[1].createdAt - b[1].createdAt; });
    var panel = state.panel;
    if (panel && panel.mode === 'guide' && !guide) panel = null;
    if (panel && panel.mode === 'files' && !files.length) panel = null;
    if (panel && panel.mode === 'message' && !(thread.messages || {})[panel.id]) panel = null;
    var group = !!thread && thread.kind === 'group';
    if (panel && panel.mode === 'members' && !group) panel = null;
    // Without a choice, show the guide, the members, the files, or a note.
    if (!panel) panel = guide ? { mode: 'guide' } : group ? { mode: 'members' } : files.length ? { mode: 'files' } : null;
    state.panel = panel;
    $('workspace').classList.toggle('msg-panel-open', !!state.panelOpen && !!thread);
    $('tab-guide').hidden = !guide; $('tab-files').hidden = !files.length; $('tab-members').hidden = !group;
    if (group) $('tab-members').textContent = 'Members (' + Object.keys(thread.members).length + ')';
    $('tab-members').setAttribute('aria-pressed', String(!!panel && panel.mode === 'members'));
    $('tab-files').textContent = 'Files (' + files.length + ')';
    $('tab-guide').setAttribute('aria-pressed', String(!!panel && panel.mode === 'guide'));
    $('tab-files').setAttribute('aria-pressed', String(!!panel && panel.mode === 'files'));
    var actions = $('panel-actions'), body = $('panel-body');
    actions.replaceChildren(); body.replaceChildren();
    if (!panel) {
      $('panel-title').textContent = 'Preview';
      if (thread) body.appendChild(node('p', 'The shared guide, files, and long messages open here.', 'tool-note msg-panel-empty'));
      return;
    }
    try {
      if (panel.mode === 'members') { drawMembers(thread, body); return; }
      if (panel.mode === 'files') {
        $('panel-title').textContent = 'Files';
        var list = node('ul', undefined, 'msg-file-list');
        files.forEach(function (entry) {
          checkFile(entry[0], entry[1]);
          var item = node('li'), author = thread.names[entry[1].author];
          item.appendChild(node('strong', (entry[1].encrypted ? 'Encrypted file' : 'File') + ' from ' + (typeof author === 'string' ? author.slice(0, 80) : 'Member')));
          item.appendChild(node('span', fileText(entry[1]) + ' · ' + when(entry[1].createdAt), 'tool-note'));
          item.appendChild(fileActions(entry[0], entry[1]));
          list.appendChild(item);
        });
        body.appendChild(list); return;
      }
      var id = panel.mode === 'guide' ? guide[0] : panel.id, message = thread.messages[id];
      checkMessage(id, message);
      var name = thread.names[message.author];
      $('panel-title').textContent = panel.mode === 'guide' ? 'Shared guide' : message.kind === 'agent' ? 'Assistant reply' : 'Message from ' + (typeof name === 'string' ? name.slice(0, 80) : 'Member');
      if (message.kind !== 'agent' && (message.kind === 'document' || message.author === state.user.uid)) actions.appendChild(button('Edit', function () { startEdit(id, message); }));
      actions.appendChild(button('Download', function () {
        var text = format.normalize(JSON.parse(message.body)).ops.map(function (op) { return op.insert; }).join('');
        downloadBytes(new TextEncoder().encode(text), panel.mode === 'guide' ? 'research-guide.txt' : 'message.txt');
      }));
      body.appendChild(node('p', (message.revision > 1 ? 'Edited ' + when(message.updatedAt || message.createdAt) : when(message.createdAt)), 'tool-note'));
      body.appendChild(renderRich(message.body));
    } catch (error) {
      body.replaceChildren(node('p', 'This item contains unsupported formatting.', 'tool-note'));
    }
  }
  function confirmButton(label, confirmLabel, action) {
    var armed = null, result = button(label, function () {
      if (state.busy) return;
      if (!armed) {
        result.textContent = confirmLabel; result.classList.add('msg-armed');
        armed = window.setTimeout(function () { armed = null; result.textContent = label; result.classList.remove('msg-armed'); }, 4000);
        return;
      }
      window.clearTimeout(armed); armed = null; action();
    });
    return result;
  }
  function groupCall(input, done) {
    var threadId = state.threadId;
    run(function () { return call(Object.assign({ threadId: threadId }, input)); }, done);
  }
  function drawMembers(thread, body) {
    var creator = thread.createdBy === state.user.uid;
    $('panel-title').textContent = 'Members';
    var list = node('ul', undefined, 'msg-member-list');
    Object.keys(thread.members).sort(function (a, b) { return (a === thread.createdBy ? -1 : 0) - (b === thread.createdBy ? -1 : 0); }).forEach(function (uid) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) return;
      var item = node('li'), name = thread.names[uid];
      item.appendChild(node('span', (typeof name === 'string' ? name.slice(0, 80) : 'Member') + (uid === state.user.uid ? ' (you)' : '')));
      if (uid === thread.createdBy) item.appendChild(node('span', 'creator', 'tool-note'));
      else if (creator) item.appendChild(confirmButton('Remove', 'Confirm remove', function () { groupCall({ action: 'kick', peerUid: uid }, function () { status('Removed from the group.'); }); }));
      list.appendChild(item);
    });
    body.appendChild(list);
    if (creator) {
      var add = node('form', undefined, 'msg-group-manage');
      add.appendChild(node('label', 'Add someone by exact email or username', 'tool-label'));
      var row = node('div', undefined, 'tool-input-row'), input = node('input', undefined, 'tool-input');
      input.maxLength = 254; input.autocomplete = 'off'; input.dir = 'ltr'; input.setAttribute('aria-label', 'Email or username to add');
      var go = node('button', 'Add', 'tool-button'); go.type = 'submit';
      row.appendChild(input); row.appendChild(go); add.appendChild(row);
      add.addEventListener('submit', function (event) {
        event.preventDefault();
        var query = input.value.trim(), threadId = state.threadId;
        if (!query) return;
        run(async function () {
          var found = await call({ action: 'find', query: query });
          if (!Array.isArray(found.users) || !found.users.length) return { missing: true };
          var person = found.users[0];
          if (!person || !/^[A-Za-z0-9_-]{1,128}$/.test(person.uid || '')) throw new Error('Invalid person.');
          return call({ action: 'add', threadId: threadId, peerUid: person.uid });
        }, function (result) { status(result && result.missing ? 'No exact match.' : 'Added to the group.'); });
      });
      body.appendChild(add);
      var rename = node('form', undefined, 'msg-group-manage');
      rename.appendChild(node('label', 'Group name', 'tool-label'));
      var row2 = node('div', undefined, 'tool-input-row'), title = node('input', undefined, 'tool-input');
      title.maxLength = 80; title.value = thread.title; title.dir = 'auto'; title.setAttribute('aria-label', 'Group name');
      var save = node('button', 'Rename', 'tool-button'); save.type = 'submit';
      row2.appendChild(title); row2.appendChild(save); rename.appendChild(row2);
      rename.addEventListener('submit', function (event) {
        event.preventDefault();
        if (title.value.trim()) groupCall({ action: 'rename', title: title.value.trim() }, function () { status('Group renamed.'); });
      });
      body.appendChild(rename);
      body.appendChild(node('p', 'Up to 10 members. To close the group for everyone, use Delete.', 'tool-note'));
    } else {
      var leave = confirmButton('Leave group', 'Confirm leave', function () { groupCall({ action: 'leave' }, function () { status('You left the group.'); }); });
      leave.classList.add('msg-leave'); body.appendChild(leave);
    }
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
        checkFile(messageId, message);
        var attachment = node('article', undefined, 'msg-card msg-file' + (message.author === state.user.uid ? ' msg-mine' : ''));
        var fileHead = node('header');
        fileHead.appendChild(node('strong', message.encrypted ? 'Encrypted file' : 'File'));
        fileHead.appendChild(fileActions(messageId, message));
        attachment.appendChild(fileHead);
        attachment.appendChild(node('p', fileText(message)));
        feed.appendChild(attachment); return;
      }
      checkMessage(messageId, message);
      var mine = message.author === state.user.uid;
      if (message.kind === 'document') {
        // The guide reads in the side panel; the chat shows a card that opens it.
        format.normalize(JSON.parse(message.body));
        var chip = node('article', undefined, 'msg-card msg-chip');
        chip.appendChild(node('strong', 'Shared guide'));
        chip.appendChild(button('Open guide', function () { showPanel({ mode: 'guide' }); }));
        feed.appendChild(chip); return;
      }
      var card = node('article', undefined, 'msg-card' + (mine ? ' msg-mine' : ''));
      var head = node('header');
      var author = thread.names[message.author];
      head.appendChild(node('strong', message.kind === 'agent' ? 'Hossein’s assistant · AI' : typeof author === 'string' ? author.slice(0, 80) : 'Member'));
      var time = node('time', when(message.createdAt));
      time.dateTime = new Date(message.createdAt).toISOString(); head.appendChild(time);
      if (message.revision > 1) head.appendChild(node('span', 'edited'));
      var actions = node('span', undefined, 'msg-card-actions');
      if (isLong(message.body)) actions.appendChild(button('Open', function () { showPanel({ mode: 'message', id: messageId }); }));
      if (message.kind !== 'agent' && mine) actions.appendChild(button('Edit', function () { startEdit(messageId, message); }));
      if (canDelete(message)) actions.appendChild(deleteButton(messageId));
      if (actions.childNodes.length) head.appendChild(actions);
      card.appendChild(head); card.appendChild(renderRich(message.body)); feed.appendChild(card);
      } catch (error) {
        feed.appendChild(node('article', 'This message contains unsupported formatting. Other messages and conversation controls remain available.', 'msg-card'));
      }
    });
    state.thread = thread;
    var maximum = Number.isSafeInteger(thread.agentRequestLimit) && thread.agentRequestLimit >= 1 && thread.agentRequestLimit <= 50 ? thread.agentRequestLimit : 5;
    // The assistant line appears only once an assistant is connected.
    $('agent').hidden = !thread.agentReady;
    $('agent-owner').hidden = !state.owner;
    if (document.activeElement !== $('agent-limit')) $('agent-limit').value = String(maximum);
    $('agent-title').textContent = 'Research assistant · ' + (thread.agentReady ? 'connected' : 'not connected');
    $('agent-info').textContent = (thread.agentReady ? 'Connected. ' : 'An assistant has not been connected yet. ') + 'Maximum ' + maximum + ' requests per person in any three hours. Requests expire after 24 hours. When event delivery is connected, notifications may take five minutes.';
    $('agent-revoke').hidden = !thread.agentGrantId;
    $('agent-ask').hidden = !thread.agentReady || !!state.editing;
    showAgentApproval();
    drawPanel(thread);
    $('thread-title').textContent = thread.title;
    $('expiry').textContent = 'Expires ' + new Date(thread.expiresAt).toLocaleDateString([], { dateStyle: 'medium' });
    // Keep the newest message in view unless the reader has scrolled up.
    var list = $('feed'), stick = state.feedFresh || list.scrollHeight - list.scrollTop - list.clientHeight < 60, kept = list.scrollTop;
    list.replaceChildren(feed); list.dataset.empty = 'No messages yet.';
    list.scrollTop = stick ? list.scrollHeight : kept;
    state.feedFresh = false;
    $('compose').hidden = !editor;
    $('attach-toggle').hidden = !window.MessageFiles;
    if (!editor && window.MessageFiles) $('files').hidden = false;
    $('delete').hidden = !state.owner && thread.createdBy !== state.user.uid;
    window.clearTimeout(state.expiryTimer);
    state.expiryTimer = window.setTimeout(function () {
      if (state.thread && state.thread.expiresAt <= Date.now()) { clearThread(); status('This conversation has expired.'); }
      else if (state.thread) drawThread(state.thread);
    }, Math.min(2147483647, Math.max(1, thread.expiresAt - Date.now())));
  }
  function openThread(threadId) {
    if (state.busy || !/^[a-f0-9]{32}$/.test(threadId) || !state.user) return;
    clearThread(); state.threadId = threadId; state.feedFresh = true; markCurrent();
    var epoch = state.epoch;
    var ref = window.siteAuth.db().ref('private-message-threads/' + threadId);
    state.threadRef = ref;
    state.threadCallback = function (snapshot) {
      if (epoch !== state.epoch || state.threadId !== threadId) return;
      try { drawThread(snapshot.val()); }
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
      var count = 0, newest = null;
      // Newest conversation first, like a chat history.
      Object.entries(values).sort(function (a, b) { return b[1].createdAt - a[1].createdAt; }).forEach(function (entry) {
        var item = entry[1];
        if (!/^[a-f0-9]{32}$/.test(entry[0]) || !item || item.expiresAt <= Date.now() || typeof item.title !== 'string' || typeof item.peer !== 'string') return;
        var li = node('li'), open = node('button');
        open.type = 'button'; open.dataset.thread = entry[0];
        open.appendChild(node('span', item.peer.slice(0, 80), 'msg-inbox-peer'));
        open.appendChild(node('span', item.group === true ? 'Group' : item.title.slice(0, 120), 'msg-inbox-title'));
        open.querySelectorAll('span').forEach(function (span) { span.dir = 'auto'; });
        open.addEventListener('click', function () { openThread(entry[0]); });
        li.appendChild(open); $('inbox').appendChild(li); count += 1;
        if (!newest) newest = entry[0];
      });
      $('empty').hidden = count > 0;
      markCurrent();
      if (state.threadId && !values[state.threadId]) clearThread();
      // Open the newest conversation on arrival. An assistant approval waits
      // for the owner to pick the conversation deliberately.
      if (newest && !state.threadId && !state.autoOpened && !state.busy && !agentNonce) { state.autoOpened = true; openThread(newest); }
    };
    ref.on('value', callback, function () { if (epoch === state.epoch) status('Your conversation list could not be loaded.'); });
    state.subscriptions.push(function () { ref.off('value', callback); });
  }
  function profileSummary() {
    var name = $('name').value.trim();
    $('profile-summary').textContent = name || 'Your profile';
  }
  async function onUser(user) {
    if (user && state.user && user.uid === state.user.uid) return;
    state.epoch += 1;
    state.subscriptions.forEach(function (off) { off(); }); state.subscriptions = [];
    clearThread(); state.user = user; state.owner = false; state.busy = false; state.autoOpened = false;
    agentApproval = null;
    $('inbox').replaceChildren(); $('people').replaceChildren(); $('name').value = ''; $('identity').textContent = ''; $('find').value = '';
    document.querySelectorAll('#messages button').forEach(function (b) { b.disabled = false; });
    $('login').hidden = !!user; $('workspace').hidden = true; toggle('owner', 'new', false); $('profile').hidden = true; $('profile').open = false;
    if (!user) { status(''); return; }
    status('Loading…');
    await run(function () { return call({ action: 'bootstrap' }); }, function (data) {
      if (typeof data.isOwner !== 'boolean' || !data.profile || data.profile.uid !== state.user.uid || typeof data.profile.name !== 'string' || typeof data.profile.email !== 'string' || typeof data.profile.handle !== 'string') throw new Error('Invalid profile.');
      state.owner = data.isOwner;
      $('profile').hidden = false; $('workspace').hidden = false;
      $('guide-label').hidden = !state.owner; $('guide').checked = state.owner;
      $('name').value = data.profile.name.slice(0, 80);
      $('identity').textContent = [data.profile.handle, data.profile.email].filter(Boolean).join(' · ');
      profileSummary();
      status(''); watchInbox();
      if (state.owner && agentNonce) loadAgentApproval();
    });
  }
  try {
    if (!window.Quill || !format) throw new Error('Editor unavailable.');
    editor = new window.Quill('#msg-editor', {
      theme: 'snow', placeholder: 'Write a message…',
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
  $('profile-form').addEventListener('submit', function (event) { event.preventDefault(); run(function () { return call({ action: 'profile', name: $('name').value }); }, function () { profileSummary(); status('Your messaging name was saved.'); }); });
  $('find-form').addEventListener('submit', function (event) {
    event.preventDefault(); $('people').replaceChildren();
    run(function () { return call({ action: 'find', query: $('find').value.trim() }); }, function (data) {
      if (!Array.isArray(data.users) || data.users.length > 5) throw new Error('Invalid search results.');
      data.users.forEach(function (person) {
        if (!person || typeof person.uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(person.uid) || typeof person.name !== 'string' || typeof person.email !== 'string' || typeof person.handle !== 'string') throw new Error('Invalid person.');
        var li = node('li');
        li.appendChild(node('span', [person.name.slice(0, 80), person.handle.slice(0, 20), person.email.slice(0, 254)].filter(Boolean).join(' · ')));
        var buttons = node('span', undefined, 'msg-person-actions');
        buttons.appendChild(button('Chat', function () {
          run(function () { return call({ action: 'create', peerUid: person.uid, guide: $('guide').checked }); }, function (response) {
            if (!/^[a-f0-9]{32}$/.test(response.threadId || '')) throw new Error('Invalid conversation.');
            // run restores controls before accepting another action.
            window.setTimeout(function () { if (state.user) openThread(response.threadId); }, 0);
            status(response.existing ? 'Opened your existing conversation.' : 'Conversation created.'); $('people').replaceChildren(); $('find').value = ''; toggle('owner', 'new', false);
          });
        }));
        buttons.appendChild(button('Add to group', function () {
          if (!state.groupDraft.some(function (p) { return p.uid === person.uid; }) && state.groupDraft.length < 9) state.groupDraft.push({ uid: person.uid, label: (person.handle || person.name).slice(0, 80) });
          drawGroupDraft(); $('people').replaceChildren(); $('find').value = ''; $('find').focus();
        }));
        li.appendChild(buttons);
        $('people').appendChild(li);
      });
      status(data.users.length ? '' : 'No exact match.');
    });
  });
  // A group is drafted from search results: each Add to group lands here.
  function drawGroupDraft() {
    $('group-form').hidden = !state.groupDraft.length;
    $('group-people').replaceChildren();
    state.groupDraft.forEach(function (person) {
      var chip = node('li', undefined, 'msg-chip-person');
      chip.appendChild(node('span', person.label));
      var x = button('×', function () { state.groupDraft = state.groupDraft.filter(function (p) { return p.uid !== person.uid; }); drawGroupDraft(); });
      x.setAttribute('aria-label', 'Remove ' + person.label); chip.appendChild(x);
      $('group-people').appendChild(chip);
    });
  }
  $('group-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var title = $('group-title').value.trim();
    if (!title) { status('Name the group first.'); $('group-title').focus(); return; }
    var peerUids = state.groupDraft.map(function (p) { return p.uid; });
    run(function () { return call({ action: 'group', title: title, peerUids: peerUids }); }, function (response) {
      if (!/^[a-f0-9]{32}$/.test(response.threadId || '')) throw new Error('Invalid conversation.');
      state.groupDraft = []; drawGroupDraft(); $('group-title').value = ''; toggle('owner', 'new', false);
      window.setTimeout(function () { if (state.user) openThread(response.threadId); }, 0);
      status('Group created.');
    });
  });
  // Top-bar popovers close on an outside click, like a menu.
  document.addEventListener('click', function (event) {
    document.querySelectorAll('#messages .msg-pop[open]').forEach(function (pop) { if (!pop.contains(event.target)) pop.open = false; });
  });
  $('format').addEventListener('click', function () {
    var on = !$('compose').classList.contains('msg-formatting');
    $('compose').classList.toggle('msg-formatting', on); $('format').setAttribute('aria-pressed', String(on));
  });
  $('panel-close').addEventListener('click', closePanel);
  $('tab-guide').addEventListener('click', function () { showPanel({ mode: 'guide' }); });
  $('tab-files').addEventListener('click', function () { showPanel({ mode: 'files' }); });
  $('tab-members').addEventListener('click', function () { showPanel({ mode: 'members' }); });
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && state.panelOpen && !state.editing) closePanel(); });
  // Drag or arrow keys move the split between the chat and the preview.
  // The share is a per-viewer convenience kept in this browser only.
  var split = $('split'), SPLIT_KEY = 'messages-preview-share';
  function setShare(share, save) {
    share = Math.min(0.75, Math.max(0.25, share));
    $('workspace').style.setProperty('--msg-preview-share', String(share));
    split.setAttribute('aria-valuenow', String(Math.round(share * 100)));
    if (save) { try { window.localStorage.setItem(SPLIT_KEY, String(share)); } catch (error) { /* storage unavailable */ } }
  }
  try { var saved = Number(window.localStorage.getItem(SPLIT_KEY)); if (saved) setShare(saved, false); } catch (error) { /* storage unavailable */ }
  split.addEventListener('pointerdown', function (event) {
    event.preventDefault(); split.setPointerCapture(event.pointerId); split.classList.add('msg-dragging');
  });
  split.addEventListener('pointermove', function (event) {
    if (!split.hasPointerCapture(event.pointerId)) return;
    var left = $('workspace').querySelector('.msg-conversation').getBoundingClientRect().left, right = $('panel').getBoundingClientRect().right;
    setShare((right - event.clientX) / (right - left), false);
  });
  function endDrag(event) {
    if (!split.hasPointerCapture(event.pointerId)) return;
    split.releasePointerCapture(event.pointerId); split.classList.remove('msg-dragging');
    setShare(Number(split.getAttribute('aria-valuenow')) / 100, true);
  }
  split.addEventListener('pointerup', endDrag); split.addEventListener('pointercancel', endDrag);
  split.addEventListener('keydown', function (event) {
    var now = Number(split.getAttribute('aria-valuenow')) / 100;
    if (event.key === 'ArrowLeft') { event.preventDefault(); setShare(now + 0.05, true); }
    if (event.key === 'ArrowRight') { event.preventDefault(); setShare(now - 0.05, true); }
  });
  $('new').addEventListener('click', function () { var open = $('owner').hidden; toggle('owner', 'new', open); if (open) $('find').focus(); });
  $('attach-toggle').addEventListener('click', function () { var open = $('files').hidden; toggle('files', 'attach-toggle', open); if (open) $('file').focus(); });
  $('delete').addEventListener('click', function () { $('confirm-delete').hidden = false; });
  $('delete-no').addEventListener('click', function () { $('confirm-delete').hidden = true; });
  $('delete-yes').addEventListener('click', function () { if (!state.threadId) return; run(function () { return call({ action: 'delete', threadId: state.threadId }); }, function () { clearThread(); status('Conversation deleted.'); }); });
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
