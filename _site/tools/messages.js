/* Private content is fetched after authentication. Never render stored HTML.
   Quill is only an input surface; canonical text-only Delta is validated again
   on the server, and stored messages are drawn using DOM nodes and textContent. */
(function () {
  'use strict';
  if (!document.getElementById('messages')) return;
  var format = window.MessageFormat;
  var state = { user: null, epoch: 0, owner: false, thread: null, threadId: null, editing: null, busy: false, subscriptions: [], threadRef: null, threadCallback: null, expiryTimer: null, urls: new Set(), feedFresh: false, autoOpened: false, panel: null, panelOpen: false, groupDraft: [] };
  var editor;
  var researchTasks = window.MessageTasks ? window.MessageTasks.init({ context: function () { return state; }, call: call, run: run, status: status, update: function (task) { if (state.thread) { state.thread.researchTasks ||= {}; state.thread.researchTasks[task.taskId] = task; drawThread(state.thread); } } }) : null;
  var preview = null, previewTimer = null;
  function disposePreview() {
    window.clearTimeout(previewTimer);
    if (preview) preview.dispose();
    preview = null;
  }
  function sourceBody(body) { return format.normalize(typeof body === 'string' ? JSON.parse(body) : body); }
  function isSource(body) { return !!window.MessagePreview && window.MessagePreview.isSource(sourceBody(body)); }
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
    if (code.indexOf('permission') >= 0 && error.details && error.details.reason === 'recent-login-required') return 'Your owner sign-in is more than ten minutes old. Use Sign in again above with the same owner account, then approve the connection.';
    if (code.indexOf('permission') >= 0 || code.indexOf('unauthenticated') >= 0) return 'This action is not permitted for your current account or session. If you belong to this conversation, sign in again. Otherwise sign in to the invited account.';
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
    assistantMode();
    if (state.panel && state.panel.mode === 'draft') { state.panel = null; drawPanel(state.thread); }
  }
  function downloadBytes(bytes, name) {
    var url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    state.urls.add(url);
    var link = node('a'); link.href = url; link.download = window.MessageFiles.filename(name);
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); state.urls.delete(url); }, 10000);
  }
  async function downloadFile(fileId, encrypted, previewOnly) {
    if (encrypted && !$('file-pass').value) {
      toggle('files', 'attach-toggle', true); $('file-pass').focus();
      status('Enter the file passphrase, then choose Preview text or Download file again.'); return;
    }
    var epoch = state.epoch, threadId = state.threadId;
    var password = $('file-pass').value; $('file-pass').value = '';
    await run(async function () {
      var response = await call({ action: 'download', threadId: threadId, fileId: fileId });
      var decoded;
      try { decoded = await window.MessageFiles.decrypt(response.envelope, password, threadId); }
      catch (error) { error.code = 'file-client'; throw error; }
      try {
        if (epoch === state.epoch && threadId === state.threadId) {
          if (previewOnly) {
            var text;
            try {
              if (decoded.bytes.length > 64000) throw new Error('limit');
              text = new TextDecoder('utf-8', { fatal: true }).decode(decoded.bytes);
              if (text.length > 16000 || !text.trim()) throw new Error('limit');
              sourceBody({ ops: [{ insert: text }] });
            } catch (error) { var invalid = new Error('Preview supports UTF-8 text up to 16,000 characters. Download other file formats to view them.'); invalid.code = 'file-client'; throw invalid; }
            showPanel({ mode: 'file-text', id: fileId, text: text });
          } else downloadBytes(decoded.bytes, decoded.name);
        }
      }
      finally { decoded.bytes.fill(0); }
    }, function () { status(previewOnly ? 'Text preview opened locally.' : 'Download started.'); });
  }
  function clearThread() {
    $('assistant-mode').checked = false;
    $('assistant-mode-label').hidden = true; $('assistant-hint').hidden = true;
    if (state.threadRef) state.threadRef.off('value', state.threadCallback);
    window.clearTimeout(state.expiryTimer);
    state.threadRef = null; state.threadCallback = null;
    state.thread = null; state.threadId = null;
    state.urls.forEach(function (url) { URL.revokeObjectURL(url); }); state.urls.clear();
    $('file').value = ''; $('file-pass').value = ''; $('file-encrypt').checked = true; toggle('files', 'attach-toggle', false);
    $('feed').replaceChildren(); $('feed').dataset.empty = 'Choose a conversation from the list.';
    $('bill').replaceChildren(); $('bill').hidden = true;
    $('thread-title').textContent = 'Select a conversation';
    $('expiry').textContent = '';
    $('compose').hidden = true; $('delete').hidden = true; $('confirm-delete').hidden = true;
    markCurrent();
    state.panel = null; closePanel(); drawPanel(null);
    $('private-access').hidden = true; $('private-connections').replaceChildren();
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
    var open = button('Preview text', function () {
      if (state.busy) return;
      if (state.panel && state.panel.mode === 'file-text' && state.panel.id === messageId) closePanel();
      else downloadFile(messageId, message.encrypted, true);
    });
    open.dataset.previewId = messageId; open.dataset.previewMode = 'file-text'; open.dataset.previewLabel = 'Preview text';
    open.setAttribute('aria-expanded', 'false'); open.setAttribute('aria-controls', 'msg-panel');
    actions.appendChild(open);
    actions.appendChild(button('Download file', function () { if (!state.busy) downloadFile(messageId, message.encrypted); }));
    if (canDelete(message)) actions.appendChild(deleteButton(messageId));
    return actions;
  }
  function startEdit(messageId, message) {
    if (!editor || state.busy) return;
    editor.setContents(format.normalize(JSON.parse(message.body)));
    state.editing = { messageId: messageId, revision: message.revision };
    $('editing').textContent = message.kind === 'document' ? 'Edit the shared guide' : 'Edit your message';
    $('send').textContent = 'Save changes'; $('cancel').hidden = false;
    $('agent-ask').hidden = true;
    assistantMode();
    editor.focus(); $('compose').scrollIntoView({ block: 'nearest' });
  }
  // The preview panel is always present beside the chat on wide screens.
  // On narrow screens it covers the chat only after the reader opens it.
  function showPanel(panel) { state.panel = panel; state.panelOpen = true; if (state.thread) drawPanel(state.thread); }
  function closePanel() {
    state.panel = null; state.panelOpen = false;
    $('workspace').classList.remove('msg-panel-open'); disposePreview();
    if (state.thread) drawPanel(state.thread);
    syncPreviewToggles();
  }
  function togglePreview(mode, id) {
    if (state.panel && state.panel.mode === mode && state.panel.id === id) closePanel();
    else showPanel({ mode: mode, id: id });
  }
  function syncPreviewToggles() {
    $('preview').setAttribute('aria-pressed', String(!!state.panel && state.panel.mode === 'draft'));
    document.querySelectorAll('#msg-feed [data-preview-id]').forEach(function (control) {
      var selected = !!state.panel && state.panel.id === control.dataset.previewId && state.panel.mode === control.dataset.previewMode;
      control.setAttribute('aria-expanded', String(selected));
      control.setAttribute('aria-label', selected ? 'Close preview' : control.dataset.previewLabel || (control.dataset.previewMode === 'guide' ? 'Open guide' : 'Open'));
      var label = control.querySelector('.msg-preview-label');
      if (label) label.textContent = selected ? 'Close preview' : 'Open preview';
      control.closest('.msg-card').classList.toggle('msg-preview-selected', selected);
    });
  }
  function previewToggle(mode, id, text) {
    var control = button('', function () { togglePreview(mode, id); });
    control.className = 'msg-message-preview'; control.dataset.previewId = id; control.dataset.previewMode = mode;
    control.setAttribute('aria-controls', 'msg-panel'); control.setAttribute('aria-expanded', 'false');
    control.setAttribute('aria-label', mode === 'guide' ? 'Open guide' : 'Open');
    control.appendChild(node('span', text, 'msg-preview-summary'));
    control.appendChild(node('span', 'Open preview', 'msg-preview-label'));
    return control;
  }
  function drawPanel(thread) {
    var entries = Object.entries(thread && thread.messages || {});
    var guide = entries.find(function (e) { return e[1] && e[1].kind === 'document'; });
    var files = entries.filter(function (e) { return e[1] && e[1].kind === 'file'; }).sort(function (a, b) { return a[1].createdAt - b[1].createdAt; });
    var panel = state.panel;
    if (panel && panel.mode === 'guide' && !guide) panel = null;
    if (panel && panel.mode === 'guide' && guide) panel.id = guide[0];
    if (panel && panel.mode === 'files' && !files.length) panel = null;
    if (panel && panel.mode === 'message' && !(thread.messages || {})[panel.id]) panel = null;
    if (panel && panel.mode === 'file-text' && !(thread.messages || {})[panel.id]) panel = null;
    var group = !!thread && thread.kind === 'group';
    if (panel && panel.mode === 'members' && !group) panel = null;
    // Messages and guides stay collapsed until the reader chooses one.
    if (!panel) panel = group ? { mode: 'members' } : null;
    state.panel = panel;
    syncPreviewToggles();
    $('workspace').classList.toggle('msg-panel-open', !!state.panelOpen && !!thread);
    $('tab-files').hidden = !files.length; $('tab-members').hidden = !group;
    if (group) $('tab-members').textContent = 'Members (' + Object.keys(thread.members).length + ')';
    $('tab-members').setAttribute('aria-pressed', String(!!panel && panel.mode === 'members'));
    $('tab-files').textContent = 'Files (' + files.length + ')';
    $('tab-files').setAttribute('aria-pressed', String(!!panel && panel.mode === 'files'));
    var actions = $('panel-actions'), body = $('panel-body');
    $('panel-meta').textContent = '';
    disposePreview();
    actions.replaceChildren(); body.replaceChildren();
    if (!panel) {
      $('panel-title').textContent = 'Preview';
      if (thread) body.appendChild(node('p', 'Click a message to open its preview here. Click it again to close it.', 'tool-note msg-panel-empty'));
      return;
    }
    try {
      if (panel.mode === 'file-text') {
        $('panel-title').textContent = 'Text file preview';
        if (window.MessagePreview) preview = window.MessagePreview.mount(body, panel.text);
        else body.appendChild(node('pre', panel.text));
        return;
      }
      if (panel.mode === 'draft') {
        $('panel-title').textContent = 'Draft preview';
        if (!editor || !editor.getText().trim()) { body.appendChild(node('p', 'Write or paste a message to preview it.', 'tool-note')); return; }
        var draft = sourceBody(editor.getContents());
        if (window.MessagePreview && !draft.ops.some(function (op) { return op.attributes && Object.keys(op.attributes).length; })) preview = window.MessagePreview.mount(body, window.MessagePreview.text(draft));
        else body.appendChild(renderRich(draft));
        return;
      }
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
        downloadBytes(new TextEncoder().encode(text), isSource(message.body) ? 'message.md' : panel.mode === 'guide' ? 'research-guide.txt' : 'message.txt');
      }));
      $('panel-meta').textContent = message.revision > 1 ? 'Edited ' + when(message.updatedAt || message.createdAt) : when(message.createdAt);
      if (isSource(message.body)) preview = window.MessagePreview.mount(body, window.MessagePreview.text(sourceBody(message.body)));
      else body.appendChild(renderRich(message.body));
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
    var entries = Object.entries(thread.messages || {}).concat(Object.entries(thread.researchTasks || {}).slice(0, 20).map(function (e) { return [e[0], { createdAt: e[1].createdAt, record: e[1] }, true]; }));
    entries.sort(function (a, b) {
      return (a[1].kind === 'document' ? 0 : 1) - (b[1].kind === 'document' ? 0 : 1) || a[1].createdAt - b[1].createdAt;
    }).forEach(function (entry) {
      try {
      var messageId = entry[0], message = entry[1];
      if (entry[2] === true) { if (researchTasks && message.record.taskId === messageId) { var taskCard = researchTasks.card(message.record, thread); if (taskCard) feed.appendChild(taskCard); } return; }
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
        chip.appendChild(previewToggle('guide', messageId, 'Research guide'));
        feed.appendChild(chip); return;
      }
      var card = node('article', undefined, 'msg-card' + (mine ? ' msg-mine' : '') + (message.kind === 'agent' ? ' msg-assistant' : ''));
      var head = node('header');
      var author = thread.names[message.author];
      head.appendChild(node('strong', message.kind === 'agent' ? 'Hossein’s assistant · AI' : typeof author === 'string' ? author.slice(0, 80) : 'Member'));
      var time = node('time', when(message.createdAt));
      time.dateTime = new Date(message.createdAt).toISOString(); head.appendChild(time);
      if (message.revision > 1) head.appendChild(node('span', 'edited'));
      var actions = node('span', undefined, 'msg-card-actions');
      if (message.kind !== 'agent' && mine) actions.appendChild(button('Edit', function () { startEdit(messageId, message); }));
      if (canDelete(message)) actions.appendChild(deleteButton(messageId));
      if (actions.childNodes.length) head.appendChild(actions);
      var text = sourceBody(message.body).ops.map(function (op) { return op.insert; }).join('').trim();
      var summary = text.length > 240 ? text.slice(0, 240) + '…' : text;
      card.appendChild(head); card.appendChild(previewToggle('message', messageId, summary)); feed.appendChild(card);
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
    $('private-access').hidden = !state.owner || thread.kind === 'group';
    $('agent-info').textContent = (thread.agentReady ? 'Connected. ' : 'An assistant has not been connected yet. ') + 'Maximum ' + maximum + ' requests per person in any three hours. New requests expire after 48 hours. When event delivery is connected, notifications may take five minutes. You can also ask the connected assistant to process pending requests.';
    $('agent-revoke').hidden = !thread.agentGrantId;
    $('agent-ask').hidden = !thread.agentReady || !!state.editing;
    $('assistant-mode-label').hidden = !thread.agentReady || thread.kind === 'group';
    if (!thread.agentReady) $('assistant-mode').checked = false;
    assistantMode();
    showAgentApproval();
    drawPanel(thread);
    $('thread-title').textContent = thread.title;
    $('expiry').textContent = 'Expires ' + new Date(thread.expiresAt).toLocaleDateString([], { dateStyle: 'medium' });
    // Keep the newest message in view unless the reader has scrolled up.
    var list = $('feed'), stick = state.feedFresh || list.scrollHeight - list.scrollTop - list.clientHeight < 60, kept = list.scrollTop;
    list.replaceChildren(feed); list.dataset.empty = 'No messages yet.';
    syncPreviewToggles();
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
    var composing = false, compositionEnding = false;
    editor.root.addEventListener('compositionstart', function () { composing = true; });
    editor.root.addEventListener('compositionend', function () {
      composing = false; compositionEnding = true;
      // Some input methods end composition before the confirming keydown.
      window.setTimeout(function () { compositionEnding = false; }, 0);
    });
    editor.root.setAttribute('aria-describedby', 'msg-compose-hint');
    // Capture Enter before Quill handles paragraph, list, and code breaks.
    // Shift+Enter retains the editor newline behavior. Submission reuses the
    // same validation, command routing, and busy guard as the Send button.
    editor.root.addEventListener('keydown', function (event) {
      if (composing || compositionEnding || event.isComposing) return;
      if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!event.repeat) $('compose').requestSubmit();
      }
      if (event.key === 'Escape' && state.editing) { event.preventDefault(); resetEditor(); }
    }, true);
    editor.on('text-change', function () {
      if (!state.panel || state.panel.mode !== 'draft') return;
      window.clearTimeout(previewTimer);
      previewTimer = window.setTimeout(function () {
        if (!state.thread || !state.panel || state.panel.mode !== 'draft') return;
        try {
          var draft = sourceBody(editor.getContents());
          var plain = !draft.ops.some(function (op) { return op.attributes && Object.keys(op.attributes).length; });
          if (preview && plain) preview.update(window.MessagePreview.text(draft));
          else drawPanel(state.thread);
        } catch (error) { drawPanel(state.thread); }
      }, 300);
    });
    document.querySelectorAll('#messages .ql-toolbar button').forEach(function (b) { var label = b.className.replace(/ql-/g, '').trim() + (b.value ? ' ' + b.value : ''); b.setAttribute('aria-label', label); b.title = label; });
    document.querySelectorAll('#messages .ql-toolbar select').forEach(function (s) { s.setAttribute('aria-label', s.className.replace(/ql-/g, '')); });
  } catch (error) { status('The editor could not load. You can still read your conversations.'); }
  function billCommand() {
    return !state.editing && editor && editor.getText().trim().toLowerCase() === '/bill'
      && editor.getContents().ops.every(function (op) { return !op.attributes || !Object.keys(op.attributes).length; });
  }
  function showBill(result) {
    var content = document.createDocumentFragment();
    var head = node('header');
    head.appendChild(node('strong', 'Research costs · /bill'));
    head.appendChild(button('Close', function () { $('bill').hidden = true; $('bill').replaceChildren(); }));
    content.appendChild(head);
    if (result.available === false) {
      content.appendChild(node('p', 'A research cost report has not been linked to this conversation. Ask the site owner to connect it. No amount is available yet.'));
    } else {
      // Never render remote markup or treat a missing amount as zero.
      var amount = /^-?(?:0|[1-9]\d{0,6})(?:\.\d{1,10})?$/;
      if (result.available !== true || typeof result.project !== 'string' || result.project.length > 80
          || typeof result.totalUsd !== 'string' || !amount.test(result.totalUsd)
          || !Number.isSafeInteger(result.updatedAt) || typeof result.estimated !== 'boolean' || typeof result.stale !== 'boolean'
          || !/^\d{4}-\d{2}-\d{2}$/.test(result.start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(result.end || '')
          || !Array.isArray(result.services) || result.services.length > 40) throw new Error('Invalid cost report.');
      function money(usd) {
        var n = Number(usd);
        return n > 0 && n < 0.0001 ? '< $0.0001' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n);
      }
      content.appendChild(node('p', result.project + ' · Total reported cost ' + money(result.totalUsd)));
      content.appendChild(node('p', 'Period ' + result.start + ' through ' + result.end + ' (end date excluded, UTC). Updated ' + when(result.updatedAt) + '.', 'tool-note'));
      var list = node('ul');
      result.services.forEach(function (service) {
        if (!service || typeof service.name !== 'string' || service.name.length > 100 || typeof service.usd !== 'string' || !amount.test(service.usd)) throw new Error('Invalid cost report.');
        list.appendChild(node('li', service.name + ' · ' + money(service.usd)));
      });
      content.appendChild(list);
      content.appendChild(node('p', (result.stale ? 'This report is older than 36 hours. ' : '') + (result.estimated ? 'AWS marks these charges as estimated. ' : '') + 'Billing can lag by 24 hours or more. Costs exclude credits, refunds, and tax. This is not a final invoice or an amount you owe.', 'tool-note'));
    }
    $('bill').replaceChildren(content); $('bill').hidden = false;
  }
  function requestBill() {
    var threadId = state.threadId, epoch = state.epoch;
    $('bill').replaceChildren(); $('bill').hidden = true;
    // A successful command reads the cached report; it never refreshes AWS.
    // Only the authenticated billing action runs. No message, AI request, or
    // AWS API request is created by typing this command.
    run(function () { return call({ action: 'bill', threadId: threadId }); }, function (result) {
      if (epoch !== state.epoch || state.threadId !== threadId) return;
      showBill(result); resetEditor(); status('Research costs loaded. Every conversation member can use /bill.');
    });
  }
  $('compose').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!editor || !state.threadId || !state.user || state.busy) return;
    if (billCommand()) { requestBill(); return; }
    if (!state.editing && $('assistant-mode').checked) { askAssistant(); return; }
    var body;
    try { body = format.normalize(editor.getContents()); }
    catch (error) { status(error.message); return; }
    var input = { action: state.editing ? 'edit' : 'send', threadId: state.threadId, body: body };
    if (state.editing) { input.messageId = state.editing.messageId; input.revision = state.editing.revision; }
    run(function () { return call(input); }, function () { resetEditor(); status('Saved.'); });
  });
  $('cancel').addEventListener('click', resetEditor);
  $('preview').addEventListener('click', function () {
    if (state.busy) return;
    if (state.panel && state.panel.mode === 'draft') closePanel();
    else showPanel({ mode: 'draft' });
  });
  function showAgentApproval() {
    $('agent-approval').hidden = !state.owner || !agentApproval || !state.thread;
    $('agent-reauth').hidden = !state.owner || !agentApproval || agentApproval.capability === 'research';
    $('agent-description').textContent = agentApproval && agentApproval.capability !== 'research' ? (agentApproval.capability === 'owner-runner' ? 'Approve this owner-only Mac runner to claim and finish published knowledge jobs. It cannot create jobs or read chat messages. ' : 'Approve this owner-only client to queue published knowledge searches and read their results. It cannot claim jobs or read chat messages. ') + 'This is separate from research chat access. Selected published text passes through Cloudflare to your agent. The private index, filesystem, reviewers and credentials are excluded. Sign in within the last ten minutes. Both connections must use the same selected conversation. Revoke access under Owner private tool connections.' : 'Approve access only for this selected conversation. The connection can read pending research requests and bounded text context, then post one AI reply per request. It cannot read attachments or manage accounts. Access lasts up to 30 days. Client names are supplied by the app, so check its callback host.';
    if (agentApproval && agentApproval.capability === 'research-runner') $('agent-description').textContent = 'Approve this separate Mac execution runner for this conversation. It can claim explicitly approved typed research tasks and publish their results. It cannot read chat context, create proposals, or approve tasks. Known incremental exposure under $5 requires requester approval. Unknown exposure, $5 or more, and the BTC pilot require the owner. Existing archive quotas and private pilot approval gates still apply. Jobs wait when the Mac is offline. Sign in within the last ten minutes and revoke this connection under Owner private tool connections.';
    $('agent-approve').textContent = agentApproval && agentApproval.capability !== 'research' ? 'Approve owner private connection' : 'Connect to this conversation';
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
      var scopeText = Array.isArray(data.scopes) ? data.scopes.slice().sort().join(' ') : '';
      data.capability = scopeText === 'research.read research.reply' ? 'research' : scopeText === 'owner.jobs' ? 'owner-tools' : scopeText === 'owner.runner' ? 'owner-runner' : scopeText === 'research.runner' ? 'research-runner' : null;
      if (!data.capability) throw new Error('Unknown connection capability.');
      agentApproval = data; showAgentApproval();
      status('Select the conversation the connecting assistant may access, then approve inside that conversation.');
    } catch { if (epoch === state.epoch) status('The assistant connection request is unavailable or expired. Start connecting again from your agent app.'); }
  }
  $('private-refresh').addEventListener('click', function () {
    if (!state.owner || !state.threadId) return;
    var threadId = state.threadId, epoch = state.epoch;
    run(function () { return call({ action: 'private-list', threadId: threadId }, 'messageAgents'); }, function (data) {
      if (epoch !== state.epoch || threadId !== state.threadId) return;
      if (!Array.isArray(data.connections) || data.connections.length > 40) throw new Error('Invalid connections.');
      $('private-connections').replaceChildren();
      data.connections.forEach(function (connection) {
        if (!/^[a-f0-9]{32}$/.test(connection.grantId || '') || !['owner-tools', 'owner-runner', 'research-runner'].includes(connection.capability) || !Number.isSafeInteger(connection.expiresAt)) throw new Error('Invalid connection.');
        var li = node('li', connection.capability + ' · expires ' + new Date(connection.expiresAt).toLocaleString());
        li.appendChild(button('Revoke', function () {
          if (epoch !== state.epoch || threadId !== state.threadId) return;
          run(function () { return call({ action: 'private-revoke', threadId: threadId, grantId: connection.grantId }, 'messageAgents'); }, function (answer) { if (answer.revoked !== true) throw new Error('Revocation failed.'); li.remove(); status('Private connection revoked.'); });
        }));
        $('private-connections').appendChild(li);
      });
      status(data.connections.length ? 'Private connections loaded.' : 'No active private connections.');
    });
  });
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
  ['google', 'github'].forEach(function (provider) {
    $('agent-' + provider).addEventListener('click', function () {
      if (!state.owner || !agentApproval || agentApproval.capability === 'research' || state.busy) return;
      var uid = state.user.uid, control = $('agent-' + provider);
      control.disabled = true;
      // Call directly from the click so the existing popup flow retains the
      // browser user gesture. Sign-in never approves a connection automatically.
      try {
        window.siteAuth.signIn(provider + '.com').then(function () {
          if (state.user && state.user.uid === uid) status('Sign-in refreshed. Select the same conversation and approve the private connection.');
        }).catch(function (error) { status(error.message || 'Sign-in failed. Please try again.'); }).finally(function () { control.disabled = false; });
      } catch { control.disabled = false; status('Sign-in is unavailable. Reload the page and try again.'); }
    });
  });
  $('agent-approve').addEventListener('click', function () {
    if (!state.owner || !state.threadId || !agentApproval || agentApproval.expiresAt <= Date.now()) return;
    var approval = agentApproval, threadId = state.threadId, epoch = state.epoch;
    run(async function () {
      var ticket = await call({ action: 'connect', threadId: threadId, nonce: agentNonce, clientId: approval.clientId, capability: approval.capability }, 'messageAgents');
      if (epoch !== state.epoch || threadId !== state.threadId || !/^[a-f0-9]{32}\.[a-f0-9]{64}$/.test(ticket.ticket || '')) throw new Error('Invalid connection.');
      return workerJson('/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nonce: agentNonce, ticket: ticket.ticket }) });
    }, function (data) {
      var redirect = new URL(data.redirectTo);
      if (redirect.host !== approval.redirectHost || redirect.username || redirect.password || redirect.hash || !(redirect.protocol === 'https:' || redirect.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname))) throw new Error('Invalid callback.');
      window.location.assign(redirect.href);
    });
  });
  function assistantMode() {
    var on = $('assistant-mode').checked && !!state.thread?.agentReady && !state.editing;
    $('send').textContent = state.editing ? 'Save changes' : on ? 'Send to assistant' : 'Send';
    $('assistant-hint').hidden = !on;
    if (on) $('assistant-hint').textContent = 'Queues a request with the shared guide and up to six recent messages. Approval appears here before an action. ' + (state.thread.agentRequestLimit || 5) + ' requests per person in three hours. Processing waits for the connected assistant.';
  }
  $('assistant-mode').addEventListener('change', assistantMode);
  function askAssistant() {
    if (!editor || !state.threadId || !state.user || state.editing || !state.thread?.agentReady) return;
    if (billCommand()) { requestBill(); return; }
    var text = editor.getText().trim();
    if (!text || text.length > 4000) { status('Write a research question of up to 4,000 characters.'); return; }
    if (!agentRequest || agentRequest.text !== text || agentRequest.threadId !== state.threadId) agentRequest = { text: text, threadId: state.threadId, requestId: Array.from(window.crypto.getRandomValues(new Uint8Array(16)), function (b) { return b.toString(16).padStart(2, '0'); }).join('') };
    var input = Object.assign({ action: 'request' }, agentRequest);
    run(function () { return call(input, 'messageAgents'); }, function (data) { if (data.queued !== true) throw new Error('Request not queued.'); resetEditor(); status('Research request queued. The connected assistant will reply when available.'); });
  }
  $('agent-ask').addEventListener('click', askAssistant);
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
  $('tab-files').addEventListener('click', function () { showPanel({ mode: 'files' }); });
  $('tab-members').addEventListener('click', function () { showPanel({ mode: 'members' }); });
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && state.panelOpen && !state.editing) closePanel(); });
  // Drag or arrow keys move the split between the chat and the preview.
  // The share is a per-viewer convenience kept in this browser only.
  // Version 3 starts with the wider default instead of restoring the old narrow split.
  var split = $('split'), SPLIT_KEY = 'messages-preview-share-v3';
  function setShare(share, save) {
    if (!Number.isFinite(share)) return;
    var available = $('workspace').clientWidth - 287.5;
    var minimum = available >= 720 ? Math.max(0.25, 360 / available) : 0.25;
    var maximum = available >= 720 ? Math.min(0.9, 1 - 360 / available) : 0.9;
    share = Math.min(maximum, Math.max(minimum, share));
    split.setAttribute('aria-valuemin', String(Math.round(minimum * 100)));
    split.setAttribute('aria-valuemax', String(Math.round(maximum * 100)));
    $('workspace').style.setProperty('--msg-preview-width', 'clamp(360px, calc((100% - 287.5px) * ' + share + '), calc(100% - 647.5px))');
    split.setAttribute('aria-valuenow', String(Math.round(share * 100)));
    if (save) { try { window.localStorage.setItem(SPLIT_KEY, String(share)); } catch (error) { /* storage unavailable */ } }
  }
  try { var saved = Number(window.localStorage.getItem(SPLIT_KEY)); if (saved) setShare(saved, false); } catch (error) { /* storage unavailable */ }
  split.addEventListener('pointerdown', function (event) {
    var left = $('workspace').querySelector('.msg-conversation').getBoundingClientRect().left, right = $('panel').getBoundingClientRect().right;
    setShare($('panel').getBoundingClientRect().width / (right - left - 7), false);
    event.preventDefault(); split.setPointerCapture(event.pointerId); split.classList.add('msg-dragging');
  });
  split.addEventListener('pointermove', function (event) {
    if (!split.hasPointerCapture(event.pointerId)) return;
    var left = $('workspace').querySelector('.msg-conversation').getBoundingClientRect().left, right = $('panel').getBoundingClientRect().right;
    setShare((right - event.clientX) / (right - left - 7), false);
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
