/* Private content is fetched after authentication. Never render stored HTML.
   Quill is only an input surface; canonical text-only Delta is validated again
   on the server, and stored messages are drawn using DOM nodes and textContent. */
(function () {
  'use strict';
  if (!document.getElementById('messages')) return;
  var format = window.MessageFormat;
  var state = { user: null, epoch: 0, owner: false, thread: null, threadId: null, editing: null, busy: false, subscriptions: [], threadRef: null, threadCallback: null, expiryTimer: null, urls: new Set(), feedFresh: false, autoOpened: false, panel: null, panelOpen: false, groupDraft: [] };
  // Quarto cannot render authenticated live monitoring state. Keep the
  // existing chat callable as the sole browser data boundary.
  var healthTimer = null, healthGeneration = 0, healthKey = '', healthBusy = false;
  var HEALTH_INTERVAL = 120000;
  function clearHealth() {
    window.clearTimeout(healthTimer); healthTimer = null; healthGeneration++;
    healthKey = ''; healthBusy = false;
    $('assistant-health').hidden = true;
    $('assistant-health-refresh').disabled = false;
    ['detail', 'activity', 'checked'].forEach(function (part) { $('assistant-health-' + part).textContent = ''; });
  }
  function drawHealth(data) {
    var title, detail;
    if (data.access === 'not_connected') { title = 'not connected'; detail = 'The owner must connect an assistant to this conversation.'; }
    else if (data.access === 'authorization_pending') { title = 'authorization pending'; detail = 'Connection approval has not finished.'; }
    else if (data.access === 'reconnect_required') { title = 'reconnect required'; detail = 'Assistant access has expired or was revoked. The owner must reconnect it.'; }
    else if (data.monitoring === 'callback_setup_required') { title = 'setup incomplete'; detail = 'Access is authorized, but the notification receiver is missing or no longer approved. Automatic replies are not active. The site owner must finish receiver setup.'; }
    else if (data.monitoring === 'subscription_required') { title = 'monitoring not active'; detail = 'Access is authorized, but no current verified monitoring subscription exists. The owner must set up monitoring in ChatGPT once. A disconnected or expired subscription needs setup again.'; }
    else if (data.monitoring === 'subscribed' && !(Date.parse(data.subscriptionExpiresAt) > Date.now())) { title = 'monitoring expired'; detail = 'The monitoring subscription has expired. The owner must set up monitoring again in ChatGPT.'; }
    else if (data.monitoring === 'subscribed' && data.pendingDeliveryFailures > 0) { title = 'delivery failed'; detail = 'Monitoring is registered, but notifications for ' + data.pendingDeliveryFailures + ' pending request(s) exhausted their delivery attempts. The owner must investigate delivery.'; }
    else if (data.monitoring === 'subscribed' && (!data.dispatchCheckedAt || Date.now() - Date.parse(data.dispatchCheckedAt) > 900000)) { title = 'delivery check overdue'; detail = 'Monitoring is registered, but no completed delivery check was recorded in the last 15 minutes. Automatic processing is not confirmed.'; }
    else if (data.monitoring === 'subscribed' && Date.parse(data.subscriptionExpiresAt) > Date.now()) { title = 'monitoring active'; detail = 'A verified subscription is registered. New assistant requests can notify ChatGPT automatically. Replies still depend on successful delivery and processing.'; }
    else { title = 'status unavailable'; detail = 'Monitoring could not be verified. Refresh status to check again. An earlier success is not confirmation of current health.'; }
    $('assistant-health-title').textContent = 'Automatic replies · ' + title;
    if (data.changedRequests) detail += ' ' + data.changedRequests + ' earlier request(s) belong to a previous connection and are not in the current queue. Send them again only if still needed.';
    $('assistant-health-detail').textContent = detail;
    var activity = [];
    if (Number.isSafeInteger(data.pendingRequests)) activity.push('Current queue ' + data.pendingRequests);
    if (data.lastSubscriptionAttemptAt) {
      var setupLabels = { received: 'request received; setup not confirmed', callback_origin_not_configured: 'receiver approval required', invalid_callback: 'invalid receiver address', challenge_failed: 'verification or authorization failed', subscribed: 'subscription registered' };
      activity.push('Last monitoring setup ' + when(Date.parse(data.lastSubscriptionAttemptAt)) + ' (' + (setupLabels[data.subscriptionSetupOutcome] || 'outcome unavailable') + ')');
    } else if (data.access === 'authorized') activity.push('No monitoring setup request recorded in the last 48 hours. Setup diagnostics began October 8, 2026; earlier attempts are not recorded.');
    [['lastDeliveryAttemptAt', 'Last notification attempt'], ['lastDeliveryAcceptedAt', 'Last notification accepted'], ['dispatchCheckedAt', 'Last delivery check'], ['subscriptionExpiresAt', 'Subscription expires'], ['lastReadAt', 'Last request opened'], ['lastReplyAt', 'Last AI reply in this chat']].forEach(function (entry) {
      if (data[entry[0]]) activity.push(entry[1] + ' ' + when(typeof data[entry[0]] === 'number' ? data[entry[0]] : Date.parse(data[entry[0]])));
    });
    $('assistant-health-activity').textContent = activity.join(' · ');
    $('assistant-health-checked').textContent = 'Last checked ' + when(Date.now()) + '. Times use your device time zone.';
  }
  async function refreshHealth() {
    if (healthBusy || document.hidden || !state.user || !state.threadId || !state.thread || state.thread.kind === 'group') return;
    window.clearTimeout(healthTimer); healthTimer = null;
    var generation = healthGeneration, epoch = state.epoch, threadId = state.threadId;
    healthBusy = true; $('assistant-health-refresh').disabled = true;
    $('assistant-health-title').textContent = 'Automatic replies · checking';
    $('assistant-health-detail').textContent = 'Checking access, monitoring, and delivery.';
    $('assistant-health-activity').textContent = ''; $('assistant-health-checked').textContent = '';
    try {
      var data = await call({ action: 'connection-status', threadId: threadId }, 'messageAgents');
      if (generation === healthGeneration && epoch === state.epoch && threadId === state.threadId) drawHealth(data);
    } catch (error) {
      if (generation === healthGeneration && epoch === state.epoch && threadId === state.threadId) drawHealth({ monitoring: 'unavailable' });
    } finally {
      if (generation === healthGeneration && epoch === state.epoch && threadId === state.threadId) {
        healthBusy = false; $('assistant-health-refresh').disabled = false;
        if (!document.hidden) healthTimer = window.setTimeout(refreshHealth, HEALTH_INTERVAL);
      }
    }
  }
  function syncHealth(thread) {
    if (thread.kind === 'group') { clearHealth(); return; }
    var key = state.threadId + '/' + (thread.agentGrantId || '') + '/' + Boolean(thread.agentReady);
    if (key === healthKey) return;
    clearHealth(); healthKey = key; $('assistant-health').hidden = false;
    $('assistant-health-title').textContent = 'Automatic replies · checking';
    refreshHealth();
  }
  $('assistant-health-refresh').addEventListener('click', refreshHealth);
  document.addEventListener('visibilitychange', function () {
    window.clearTimeout(healthTimer); healthTimer = null;
    if (!document.hidden) refreshHealth();
  });
  var editor;
  var stagedFile = null;
  // Reactions release 2026-10-08. Shared counts require authenticated live
  // data, beyond Quarto's static rendering. The picker uses native disclosure
  // and buttons. Keep these six IDs in sync with the server allowlist.
  var REACTIONS = [
    ['thumbs-up', '👍', 'Thumbs up'], ['star', '⭐', 'Star'],
    ['heart', '❤️', 'Heart'], ['laugh', '😂', 'Laugh'],
    ['celebrate', '🎉', 'Celebrate'], ['eyes', '👀', 'Eyes']
  ];
  function reactionControls(thread, messageId, message) {
    var row = node('div', undefined, 'msg-reactions'); row.dataset.messageId = messageId;
    var picker = node('details', undefined, 'msg-reaction-picker');
    var summary = node('summary', 'React'); summary.dataset.reaction = 'picker';
    summary.title = 'Choose one reaction. Select it again to remove it. Reactions do not approve jobs.';
    picker.appendChild(summary);
    var choices = node('div', undefined, 'msg-reaction-choices');
    REACTIONS.forEach(function (reaction) {
      var people = Object.keys(thread.members).filter(function (uid) { return thread.members[uid] === true && message.reactions && message.reactions[uid] === reaction[0]; }).slice(0, 10);
      var selected = people.includes(state.user.uid);
      function control(count) {
        var result = node('button', undefined, 'msg-reaction'); result.type = 'button';
        result.dataset.reaction = reaction[0]; result.setAttribute('aria-label', reaction[2]);
        result.setAttribute('aria-pressed', String(selected));
        var emoji = node('span', reaction[1]); emoji.setAttribute('aria-hidden', 'true'); result.appendChild(emoji);
        if (count) {
          result.appendChild(node('span', String(people.length), 'msg-reaction-count'));
          result.setAttribute('aria-label', reaction[2] + ', ' + people.length + (people.length === 1 ? ' reaction' : ' reactions'));
          result.title = people.map(function (uid) { return typeof thread.names[uid] === 'string' ? thread.names[uid].slice(0, 80) : 'Member'; }).join(', ');
        } else result.title = reaction[2];
        return result;
      }
      if (people.length) row.appendChild(control(true));
      choices.appendChild(control(false));
    });
    picker.appendChild(choices); row.appendChild(picker);
    return row;
  }
  // One listener survives feed redraws. The server derives the participant
  // from the session and applies an explicit, idempotent choice or removal.
  $('feed').addEventListener('click', function (event) {
    var control = event.target.closest('button[data-reaction]');
    if (!control || !state.user || !state.thread || state.busy) return;
    var row = control.closest('.msg-reactions'), threadId = state.threadId;
    if (!row || !row.isConnected || !$('feed').contains(row)) return;
    var messageId = row.dataset.messageId, message = state.thread.messages && state.thread.messages[messageId];
    if (!message || !/^[a-f0-9]{32}$/.test(messageId) || !REACTIONS.some(function (r) { return r[0] === control.dataset.reaction; })) return;
    var reaction = message.reactions && message.reactions[state.user.uid] === control.dataset.reaction ? null : control.dataset.reaction;
    row.querySelector('details').open = false;
    run(function () { return call({ action: 'react', threadId: threadId, messageId: messageId, reaction: reaction }); }, function () {
      status(reaction === null ? 'Reaction removed.' : 'Reaction saved.', true);
      var current = $('feed').querySelector('[data-message-id="' + messageId + '"]');
      var focus = current && (reaction && current.querySelector('button[data-reaction="' + reaction + '"]') || current.querySelector('summary'));
      if (focus) focus.focus({ preventScroll: true });
    }, 'Saving reaction.', 'The reaction could not be saved. Please try again.');
  });
  function clearFile() {
    status('');
    stagedFile = null; $('file').value = '';
    $('file-name').textContent = ''; $('file-staged').hidden = true;
  }
  function stageFile(file, pasted) {
    if (!state.threadId || !state.user || state.busy) return;
    if (!file || file.size < 1 || file.size > window.MessageFileFormat.MAX_BYTES) {
      clearFile(); status('Choose a file between 1 byte and 7 MiB.'); return;
    }
    status('');
    stagedFile = file;
    // Treat images as opaque downloadable files. No uploaded image is decoded
    // or injected into Quill, HTML, or a preview based on its claimed MIME.
    $('file-name').textContent = window.MessageFiles.filename(file.name) + ' · ' + Math.ceil(file.size / 1024) + ' KiB';
    $('file-staged').hidden = false;
    toggle('files', 'attach-toggle', true);
    if (pasted) {
      $('file').value = '';
      status('Image ready to attach. Choose encryption and Attach to send it.');
      if ($('file-encrypt').checked) $('file-pass').focus();
    }
  }
  var push = window.MessagePush ? window.MessagePush.init({ call: call }) : null;
  var inboxValues = {}, notificationReady = false, knownUnread = new Set(), noticeThread = null, noticeTimer = null;
  var seenMessages = new Set(), unseenIncoming = new Set();
  var pageTitle = document.title, readTimer = null, readGeneration = 0, readPending = false, readAttempt = '';
  function feedAtEnd() {
    var feed = $('feed');
    return feed.scrollHeight - feed.scrollTop - feed.clientHeight < 60;
  }
  function showNewMessages() {
    var count = unseenIncoming.size;
    $('new-messages').textContent = count ? count + (count === 1 ? ' new message' : ' new messages') + ' · Jump to latest' : '';
    $('new-messages').hidden = !count;
  }
  function jumpToLatest() {
    unseenIncoming.clear(); showNewMessages();
    $('feed').scrollTop = $('feed').scrollHeight; queueRead();
  }
  function unreadIds(item) {
    var values = item && item.unreadMessages;
    if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length > 100) return [];
    return Object.keys(values).filter(function (id) { return /^[a-f0-9]{32}$/.test(id) && Number.isSafeInteger(values[id]) && values[id] > 0 && values[id] <= Date.now() + 300000; });
  }
  function readingThread(threadId) {
    return state.threadId === threadId && state.thread && !document.hidden && document.hasFocus() && feedAtEnd();
  }
  function dismissNotice() {
    window.clearTimeout(noticeTimer); noticeTimer = null; noticeThread = null;
    $('notice').hidden = true; $('notice-text').textContent = '';
  }
  function updateUnread(values) {
    var next = new Set(), unreadChats = 0, newest = null, newestAt = 0;
    Object.entries(values).forEach(function (entry) {
      var id = entry[0], item = entry[1];
      if (!/^[a-f0-9]{32}$/.test(id) || !item || item.expiresAt <= Date.now()) return;
      var ids = unreadIds(item); if (ids.length) unreadChats++;
      ids.forEach(function (messageId) {
        var key = id + '/' + messageId; next.add(key);
        if (notificationReady && !knownUnread.has(key) && !readingThread(id) && item.unreadMessages[messageId] > newestAt) { newest = id; newestAt = item.unreadMessages[messageId]; }
      });
    });
    knownUnread = next; notificationReady = true;
    $('unread-total').textContent = unreadChats + (unreadChats === 1 ? ' unread chat' : ' unread chats');
    $('unread-total').hidden = unreadChats === 0;
    document.title = (unreadChats ? '(' + unreadChats + ') ' : '') + pageTitle;
    if (noticeThread && (!values[noticeThread] || !unreadIds(values[noticeThread]).length)) dismissNotice();
    if (newest) {
      noticeThread = newest; $('notice-text').textContent = 'New message'; $('notice').hidden = false;
      window.clearTimeout(noticeTimer); noticeTimer = window.setTimeout(dismissNotice, 10000);
    }
    queueRead();
  }
  function queueRead() {
    window.clearTimeout(readTimer);
    if (!state.user || !readingThread(state.threadId)) return;
    readTimer = window.setTimeout(markRead, 300);
  }
  async function markRead() {
    if (!state.user || readPending || !readingThread(state.threadId)) return;
    var ids = unreadIds(inboxValues[state.threadId]).filter(function (id) {
      var message = state.thread.messages && state.thread.messages[id];
      return message && (message.kind === 'agent' || message.author !== state.user.uid);
    }).sort();
    var signature = ids.join(',');
    if (!ids.length || signature === readAttempt) return;
    var epoch = state.epoch, threadId = state.threadId, generation = readGeneration;
    readAttempt = signature; readPending = true;
    try { await call({ action: 'read', threadId: threadId, messageIds: ids }); }
    catch (error) {
      if (epoch === state.epoch && generation === readGeneration && threadId === state.threadId) status('Messages could not be marked read. Reopen this chat to try again.');
    } finally { if (epoch === state.epoch && generation === readGeneration) { readPending = false; queueRead(); } }
  }
  $('notice-dismiss').addEventListener('click', dismissNotice);
  $('notice-open').addEventListener('click', function () {
    if (!noticeThread || state.busy) return;
    var threadId = noticeThread;
    if (state.threadId === threadId) jumpToLatest();
    else openThread(threadId);
    dismissNotice();
  });
  $('new-messages').addEventListener('click', jumpToLatest);
  $('feed').addEventListener('scroll', function () {
    if (feedAtEnd() && unseenIncoming.size) jumpToLatest();
    else queueRead();
  }, { passive: true });
  window.addEventListener('focus', queueRead);
  document.addEventListener('visibilitychange', queueRead);
  var billEpoch = 0, billVersion = 0, billObservedVersion = 0, billLoading = false;
  function closeBill() {
    billEpoch += 1; billVersion = 0; billObservedVersion = 0; billLoading = false;
    $('bill').replaceChildren(); $('bill').hidden = true;
  }
  var researchTasks = window.MessageTasks ? window.MessageTasks.init({ context: function () { return state; }, call: call, run: run, status: status, update: function (task) { if (state.thread) { state.thread.researchTasks ||= {}; state.thread.researchTasks[task.taskId] = task; drawThread(state.thread); } } }) : null;
  var preview = null, previewTimer = null;
  function disposePreview() {
    window.clearTimeout(previewTimer);
    if (preview) preview.dispose();
    preview = null;
  }
  function sourceBody(body) { return format.normalize(typeof body === 'string' ? JSON.parse(body) : body); }
  function isSource(body) { return !!window.MessagePreview && window.MessagePreview.isSource(sourceBody(body)); }
  var agentApproval = null, agentRequest = null, agentApprovalTimer = null, agentNeedsReauth = false, agentReauthPending = false;
  var privateConnectionTimer = null;
  var statusTimer = null;
  var agentNonce = new URL(window.location.href).searchParams.get('mcp_request');
  if (!/^[a-f0-9]{32}$/.test(agentNonce || '')) agentNonce = null;
  function $(id) { return document.getElementById('msg-' + id); }
  function node(tag, text, className) {
    var element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function status(text, transient) {
    window.clearTimeout(statusTimer);
    $('status').textContent = text;
    // Receipts expire; failures and instructions remain until resolved or the
    // context changes. A newer status always cancels the previous timer.
    if (text && transient === true) statusTimer = window.setTimeout(function () { $('status').textContent = ''; }, 8000);
  }
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
  function readableError(error, fallback) {
    var code = error && error.code || '';
    if (code === 'file-client') return error.message;
    if (code.indexOf('permission') >= 0 && error.details && error.details.reason === 'recent-login-required') return 'Your owner sign-in is more than ten minutes old. Use Sign in again above with the same owner account, then approve the connection.';
    if (code.indexOf('permission') >= 0 || code.indexOf('unauthenticated') >= 0) return 'This action is not permitted for your current account or session. If you belong to this conversation, sign in again. Otherwise sign in to the invited account.';
    if (code.indexOf('not-found') >= 0 || code.indexOf('unimplemented') >= 0) return 'Messaging is not available yet. The site owner needs to finish setup.';
    if (code.indexOf('resource-exhausted') >= 0) return 'A messaging limit was reached. Please try later or contact the site owner.';
    if (code.indexOf('aborted') >= 0) return 'This text changed while you were editing. Cancel and reopen the latest version.';
    return fallback || 'The request failed. Your unsent text is still here. Please try again.';
  }
  async function call(input, serviceName) {
    var epoch = state.epoch;
    var service = await window.siteAuth.firebaseFunctions();
    if (epoch !== state.epoch || !state.user) throw new Error('Session changed.');
    var result = await service.httpsCallable(serviceName || 'privateMessages', { timeout: ['upload', 'download'].includes(input.action) ? 120000 : 30000, limitedUseAppCheckTokens: true })(input);
    if (epoch !== state.epoch || !state.user) throw new Error('Session changed.');
    if (!result || !result.data || typeof result.data !== 'object') throw new Error('Invalid response.');
    return result.data;
  }
  async function run(action, success, progress, failureText) {
    if (state.busy) return;
    var epoch = state.epoch, threadId = state.threadId;
    state.busy = true;
    status(progress || '');
    $('file').disabled = true;
    // Notification controls have their own asynchronous state machine. Do not
    // overwrite their disabled state when an unrelated chat operation ends.
    var controls = new Map();
    document.querySelectorAll('#messages button:not(#msg-push-toggle):not(#msg-push-all)').forEach(function (b) { controls.set(b, b.disabled); b.disabled = true; });
    try {
      var result = await action();
      if (epoch === state.epoch && threadId === state.threadId && success) success(result);
    }
    catch (error) {
      if (epoch === state.epoch && threadId === state.threadId) {
        if (error && error.details && error.details.reason === 'recent-login-required' && agentApproval) { agentNeedsReauth = true; showAgentApproval(); }
        status(readableError(error, failureText));
      }
    }
    finally {
      if (epoch === state.epoch) {
        state.busy = false;
        $('file').disabled = false;
        controls.forEach(function (disabled, b) { if (b.isConnected) b.disabled = disabled; });
        showAgentApproval();
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
    }, function () { status(previewOnly ? 'Text preview opened locally.' : 'Download started.', true); });
  }
  function clearThread() {
    clearHealth();
    status('');
    seenMessages.clear(); unseenIncoming.clear(); showNewMessages();
    window.clearTimeout(readTimer); readGeneration += 1; readPending = false; readAttempt = '';
    $('assistant-mode').checked = false;
    $('assistant-mode-label').hidden = true; $('assistant-hint').hidden = true;
    if (state.threadRef) state.threadRef.off('value', state.threadCallback);
    window.clearTimeout(state.expiryTimer);
    state.threadRef = null; state.threadCallback = null;
    state.thread = null; state.threadId = null;
    state.urls.forEach(function (url) { URL.revokeObjectURL(url); }); state.urls.clear();
    clearFile(); $('file').disabled = false; $('file-pass').value = ''; $('file-encrypt').checked = true; toggle('files', 'attach-toggle', false);
    $('feed').replaceChildren(); $('feed').dataset.empty = 'Choose a conversation from the list.';
    closeBill();
    $('thread-title').textContent = 'Select a conversation';
    $('expiry').textContent = '';
    $('compose').hidden = true; $('delete').hidden = true; $('confirm-delete').hidden = true;
    markCurrent();
    state.panel = null; closePanel(); drawPanel(null);
    window.clearTimeout(privateConnectionTimer);
    $('private-access').hidden = true; $('private-access').open = false; $('private-connections').replaceChildren();
    $('agent').hidden = true; $('agent-ask').hidden = true; $('agent-info').textContent = ''; $('agent-client').textContent = ''; $('agent-limit').value = '5';
    showAgentApproval();
    resetEditor();
  }
  function checkFile(messageId, message) {
    if (!/^[a-f0-9]{32}$/.test(messageId) || typeof message.author !== 'string' || !Number.isSafeInteger(message.bytes) || message.bytes < 1 || message.bytes > window.MessageFileFormat.MAX_BYTES || typeof message.encrypted !== 'boolean') throw new Error('Invalid attachment.');
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
      run(function () { return call({ action: 'remove', threadId: threadId, messageId: messageId }); }, function () { status('Message deleted.', true); });
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
      else if (creator) item.appendChild(confirmButton('Remove', 'Confirm remove', function () { groupCall({ action: 'kick', peerUid: uid }, function () { status('Removed from the group.', true); }); }));
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
        }, function (result) { status(result && result.missing ? 'No exact match.' : 'Added to the group.', true); });
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
        if (title.value.trim()) groupCall({ action: 'rename', title: title.value.trim() }, function () { status('Group renamed.', true); });
      });
      body.appendChild(rename);
      body.appendChild(node('p', 'Up to 10 members. To close the group for everyone, use Delete.', 'tool-note'));
    } else {
      var leave = confirmButton('Leave group', 'Confirm leave', function () { groupCall({ action: 'leave' }, function () { status('You left the group.', true); }); });
      leave.classList.add('msg-leave'); body.appendChild(leave);
    }
  }
  // Quarto renders the shell. Private request receipts depend on the current
  // authenticated conversation and therefore use this existing controller.
  function requestReceipt(thread, messageId, message) {
    var job = thread.agentJobs && thread.agentJobs[messageId], now = Date.now();
    if ((!job && message.assistantRequest !== true) || message.kind !== 'message') return null;
    var text;
    if (!job && Number.isSafeInteger(message.assistantAnsweredAt) && message.assistantAnsweredAt >= message.createdAt) text = 'Answered in this conversation.';
    else if (!job) text = 'Assistant request expired. Send a new request if you still need help.';
    else if (job.requester !== message.author || !Number.isSafeInteger(job.createdAt) || !Number.isSafeInteger(job.expiresAt) || !['pending', 'done'].includes(job.state)) text = 'Assistant request status is unavailable.';
    else if (job.state === 'done') text = 'Answered in this conversation.';
    else if (job.expiresAt <= now) text = 'Assistant request expired. Send a new request if you still need help.';
    else if (!thread.agentReady || job.grantId !== thread.agentGrantId) text = 'Assistant connection changed. Ask the owner to reconnect before sending a new request.';
    else if (Number.isSafeInteger(job.firstReadAt) && job.firstReadAt >= job.createdAt) text = 'Opened by the assistant ' + when(job.firstReadAt) + '. Awaiting a reply here.';
    else text = 'Received. Your request is queued for the assistant. Updates will appear here when it responds.';
    var receipt = node('p', text, 'msg-request-status');
    receipt.setAttribute('role', 'status');
    return receipt;
  }
  function drawThread(thread) {
    if (!thread || !thread.members || thread.members[state.user.uid] !== true || !Number.isFinite(thread.expiresAt) || thread.expiresAt <= Date.now()
        || typeof thread.title !== 'string' || thread.title.length > 120 || !thread.names || Object.keys(thread.messages || {}).length > 100) throw new Error('Invalid conversation.');
    // Capture the reader's position before assistant hints, previews, or
    // receipts change the available feed height.
    var list = $('feed'), stick = state.feedFresh || feedAtEnd(), kept = list.scrollTop;
    var openReactions = Array.from(list.querySelectorAll('.msg-reaction-picker[open]')).map(function (picker) { return picker.parentElement.dataset.messageId; });
    var activeReaction = document.activeElement && document.activeElement.closest('.msg-reactions');
    var reactionFocus = activeReaction && { messageId: activeReaction.dataset.messageId, choice: document.activeElement.dataset.reaction };
    var messages = thread.messages || {};
    Object.entries(messages).forEach(function (entry) {
      var id = entry[0], message = entry[1];
      if (!state.feedFresh && !stick && !seenMessages.has(id) && /^[a-f0-9]{32}$/.test(id) && message
          && ['message', 'file', 'agent'].includes(message.kind) && (message.kind === 'agent' || message.author !== state.user.uid)) unseenIncoming.add(id);
    });
    seenMessages = new Set(Object.keys(messages));
    unseenIncoming.forEach(function (id) { if (!messages[id]) unseenIncoming.delete(id); });
    if (stick) unseenIncoming.clear();
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
        attachment.appendChild(reactionControls(thread, messageId, message));
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
      card.appendChild(head); card.appendChild(previewToggle('message', messageId, summary));
      card.appendChild(reactionControls(thread, messageId, message));
      var receipt = requestReceipt(thread, messageId, message);
      if (receipt) card.appendChild(receipt);
      feed.appendChild(card);
      } catch (error) {
        feed.appendChild(node('article', 'This message contains unsupported formatting. Other messages and conversation controls remain available.', 'msg-card'));
      }
    });
    state.thread = thread;
    syncHealth(thread);
    refreshOpenBill();
    var maximum = Number.isSafeInteger(thread.agentRequestLimit) && thread.agentRequestLimit >= 1 && thread.agentRequestLimit <= 50 ? thread.agentRequestLimit : 5;
    // The assistant line appears only once an assistant is connected.
    $('agent').hidden = !thread.agentReady;
    $('agent-owner').hidden = !state.owner;
    if (document.activeElement !== $('agent-limit')) $('agent-limit').value = String(maximum);
    $('agent-title').textContent = 'Research assistant · ' + (thread.agentReady ? 'connected' : 'not connected');
    $('private-access').hidden = !state.owner || thread.kind === 'group';
    $('agent-info').textContent = (thread.agentReady ? 'Connected. ' : 'An assistant has not been connected yet. ') + 'Maximum ' + maximum + ' requests per person in any three hours. Requests expire after 48 hours. Each request shows its receipt and answer status in the chat. A connection alone does not start automatic processing. See Automatic replies for current monitoring and delivery status.';
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
    list.replaceChildren(feed); list.dataset.empty = 'No messages yet.';
    list.querySelectorAll('.msg-reactions').forEach(function (row) {
      row.querySelector('details').open = openReactions.includes(row.dataset.messageId);
      if (reactionFocus && reactionFocus.messageId === row.dataset.messageId) {
        var focused = Array.from(row.querySelectorAll('[data-reaction]')).find(function (control) { return control.dataset.reaction === reactionFocus.choice; });
        if (focused) focused.focus({ preventScroll: true });
      }
    });
    syncPreviewToggles();
    // Thread arrivals drive this persistent control directly. Delayed inbox
    // notifications must not be required to discover a new peer request.
    showNewMessages();
    list.scrollTop = stick ? list.scrollHeight : kept;
    state.feedFresh = false; queueRead();
    $('compose').hidden = !editor;
    $('attach-toggle').hidden = !window.MessageFiles;
    if (!editor && window.MessageFiles) $('files').hidden = false;
    $('delete').hidden = !state.owner && thread.createdBy !== state.user.uid;
    window.clearTimeout(state.expiryTimer);
    var nextExpiry = Object.values(thread.researchTasks || {}).reduce(function (next, job) {
      return [job.expiresAt, job.plan && job.plan.quote && job.plan.quote.expiresAt].reduce(function (time, expiry) { return Number.isSafeInteger(expiry) && expiry > Date.now() ? Math.min(time, expiry) : time; }, next);
    }, thread.expiresAt);
    Object.values(thread.agentJobs || {}).forEach(function (job) {
      if (job.state === 'pending' && Number.isSafeInteger(job.expiresAt) && job.expiresAt > Date.now()) nextExpiry = Math.min(nextExpiry, job.expiresAt);
    });
    state.expiryTimer = window.setTimeout(function () {
      if (state.thread && state.thread.expiresAt <= Date.now()) { clearThread(); status('This conversation has expired.'); }
      else if (state.thread) drawThread(state.thread);
    }, Math.min(2147483647, Math.max(1, nextExpiry - Date.now())));
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
      inboxValues = values;
      updateUnread(values);
      var count = 0, newest = null;
      // Newest conversation first, like a chat history.
      Object.entries(values).sort(function (a, b) { return b[1].createdAt - a[1].createdAt; }).forEach(function (entry) {
        var item = entry[1];
        if (!/^[a-f0-9]{32}$/.test(entry[0]) || !item || item.expiresAt <= Date.now() || typeof item.title !== 'string' || typeof item.peer !== 'string') return;
        var li = node('li'), open = node('button');
        open.type = 'button'; open.dataset.thread = entry[0];
        var peerRow = node('span', undefined, 'msg-inbox-peer-row');
        peerRow.appendChild(node('span', item.peer.slice(0, 80), 'msg-inbox-peer'));
        var unread = unreadIds(item).length;
        if (unread) { var badge = node('span', String(unread), 'msg-unread-badge'); badge.setAttribute('aria-label', unread + ' unread messages'); peerRow.appendChild(badge); }
        open.appendChild(peerRow);
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
    inboxValues = {}; notificationReady = false; knownUnread.clear(); dismissNotice(); document.title = pageTitle; $('unread-total').hidden = true;
    clearThread(); state.user = user; state.owner = false; state.busy = false; state.autoOpened = false;
    if (push) push.onUser(user);
    agentApproval = null; agentNeedsReauth = false; agentReauthPending = false; window.clearTimeout(agentApprovalTimer); showAgentApproval();
    $('inbox').replaceChildren(); $('people').replaceChildren(); $('name').value = ''; $('identity').textContent = ''; $('find').value = '';
    document.querySelectorAll('#messages button:not(#msg-push-toggle):not(#msg-push-all)').forEach(function (b) { b.disabled = false; });
    $('login').hidden = !!user; $('workspace').hidden = true; toggle('owner', 'new', false); $('profile').hidden = true; $('profile').open = false;
    if (!user) { status(''); return; }
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
    }, 'Loading…');
  }
  try {
    if (!window.Quill || !format) throw new Error('Editor unavailable.');
    editor = new window.Quill('#msg-editor', {
      theme: 'snow', placeholder: 'Write a message…',
      formats: ['bold', 'italic', 'underline', 'code', 'header', 'list', 'blockquote', 'code-block', 'direction', 'align', 'color', 'background'],
      modules: { toolbar: [[{ header: [2, 3, false] }], ['bold', 'italic', 'underline', 'code'], [{ color: format.COLORS }, { background: format.BACKGROUNDS }], [{ list: 'ordered' }, { list: 'bullet' }], ['blockquote', 'code-block'], [{ direction: 'rtl' }, { align: [] }], ['clean']] }
    });
    editor.root.setAttribute('aria-label', 'Message rich-text editor'); editor.root.setAttribute('role', 'textbox'); editor.root.setAttribute('aria-multiline', 'true');
    // Text paste stays plain. Clipboard images are staged as attachments only
    // after the user's paste gesture. HTML never enters Quill's import path.
    editor.root.addEventListener('paste', function (event) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!state.user || !state.threadId || state.busy) return;
      var images = event.clipboardData ? Array.from(event.clipboardData.items || []).filter(function (item) { return item.kind === 'file' && /^image\//.test(item.type); }) : [];
      if (images.length) {
        if (images.length !== 1) { status('Paste one image at a time.'); return; }
        var image = images[0].getAsFile();
        if (!image) { status('The clipboard image is unavailable. Use Attach a file instead.'); return; }
        stageFile(image, true); return;
      }
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
    head.appendChild(button('Close', closeBill));
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
      content.appendChild(node('p', 'Period ' + result.start + ' through ' + result.end + ' (end date excluded, UTC). Checked ' + when(result.updatedAt) + '.', 'tool-note'));
      if (result.refresh != null) {
        if (!Number.isSafeInteger(result.refresh.nextRefreshAt) || result.refresh.nextRefreshAt <= 0
            || result.refresh.nextRefreshAt > Date.now() + 2 * 86400000 || result.refresh.timeZone !== 'UTC' || result.refresh.dailyAtUTC !== '12:00') throw new Error('Invalid refresh schedule.');
        var next = new Intl.DateTimeFormat([], { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(result.refresh.nextRefreshAt));
        var time = node('time', next); time.dateTime = new Date(result.refresh.nextRefreshAt).toISOString();
        var schedule = node('p', 'Next refresh, estimated: ', 'tool-note msg-bill-next-refresh');
        schedule.appendChild(time); schedule.appendChild(document.createTextNode('. Checked daily at 12:00 UTC, even when your computer is off. New reports appear automatically here.'));
        content.appendChild(schedule);
      } else content.appendChild(node('p', 'Automatic refresh is not active for this linked report.', 'tool-note'));
      var list = node('ul');
      result.services.forEach(function (service) {
        if (!service || typeof service.name !== 'string' || service.name.length > 100 || typeof service.usd !== 'string' || !amount.test(service.usd)) throw new Error('Invalid cost report.');
        list.appendChild(node('li', service.name + ' · ' + money(service.usd)));
      });
      content.appendChild(list);
      content.appendChild(node('p', (result.stale ? 'This report is older than 36 hours. ' : '') + (result.estimated ? 'AWS marks these charges as estimated. ' : '') + 'Billing can lag by 24 hours or more. Costs exclude credits, refunds, and tax. This is not a final invoice or an amount you owe.', 'tool-note'));
    }
    $('bill').replaceChildren(content); $('bill').hidden = false;
    billVersion = result.available === true ? result.updatedAt : 0;
  }
  async function refreshOpenBill() {
    var version = state.thread && state.thread.billingUpdatedAt;
    if (!state.user || !state.threadId || $('bill').hidden || document.hidden || billLoading
        || !Number.isSafeInteger(version) || version <= Math.max(billVersion, billObservedVersion) || version > Date.now() + 300000) return;
    var threadId = state.threadId, epoch = state.epoch, generation = billEpoch;
    billObservedVersion = version; billLoading = true;
    try {
      var result = await call({ action: 'bill', threadId: threadId });
      if (epoch !== state.epoch || threadId !== state.threadId || generation !== billEpoch || $('bill').hidden) return;
      showBill(result);
    } catch (error) {
      if (epoch !== state.epoch || threadId !== state.threadId || generation !== billEpoch || $('bill').hidden) return;
      var code = error && error.code || '';
      if (/permission|unauthenticated/.test(code)) { closeBill(); status(readableError(error)); }
      else if (!$('bill').querySelector('.msg-bill-refresh-error')) $('bill').appendChild(node('p', 'The latest report could not be loaded. The previous check time still applies. Use /bill to try again.', 'tool-note msg-bill-refresh-error'));
    } finally { if (generation === billEpoch) { billLoading = false; refreshOpenBill(); } }
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshOpenBill(); });
  function requestBill() {
    var threadId = state.threadId, epoch = state.epoch;
    closeBill();
    var generation = billEpoch;
    // A successful command reads the cached report; it never refreshes AWS.
    // Only the authenticated billing action runs. No message, AI request, or
    // AWS API request is created by typing this command.
    run(function () { return call({ action: 'bill', threadId: threadId }); }, function (result) {
      if (epoch !== state.epoch || state.threadId !== threadId || generation !== billEpoch) return;
      showBill(result); resetEditor(); status('Research costs loaded. Every conversation member can use /bill.', true);
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
    run(function () { return call(input); }, function () { resetEditor(); status('Saved.', true); });
  });
  $('cancel').addEventListener('click', function () { resetEditor(); status(''); });
  $('preview').addEventListener('click', function () {
    if (state.busy) return;
    if (state.panel && state.panel.mode === 'draft') closePanel();
    else showPanel({ mode: 'draft' });
  });
  function showAgentApproval() {
    ['google', 'github'].forEach(function (provider) { $('agent-' + provider).disabled = state.busy || agentReauthPending; });
    $('agent-approve').disabled = state.busy || agentReauthPending;
    $('agent-approval').hidden = !state.owner || !agentApproval || !state.thread;
    $('agent-reauth').hidden = !state.owner || !agentApproval || !agentNeedsReauth || agentApproval.capability === 'research';
    $('agent-description').textContent = agentApproval && agentApproval.capability !== 'research' ? (agentApproval.capability === 'owner-runner' ? 'Approve this owner-only Mac runner to claim and finish published knowledge jobs. It cannot create jobs or read chat messages. ' : 'Approve this owner-only client to queue published knowledge searches and read their results. It cannot claim jobs or read chat messages. ') + 'This is separate from research chat access. Selected published text passes through Cloudflare to your agent. The private index, filesystem, reviewers and credentials are excluded. Sign in within the last ten minutes. Both connections must use the same selected conversation. Revoke access under Owner private tool connections.' : 'Approve access only for this selected conversation. The connection can read pending research requests and bounded text context, then post one AI reply per request. It cannot read attachments or manage accounts. Access lasts up to 30 days. Client names are supplied by the app, so check its callback host.';
    if (agentApproval && agentApproval.capability === 'research-runner') $('agent-description').textContent = 'Approve this separate Mac execution runner for this conversation. It can claim explicitly approved typed research tasks and publish their results. It cannot read chat context, create proposals, or approve tasks. Known incremental exposure under $5 requires requester approval. Unknown exposure, $5 or more, and the BTC pilot require the owner. Existing archive quotas and private pilot approval gates still apply. Jobs wait when the Mac is offline. Sign in within the last ten minutes and revoke this connection under Owner private tool connections.';
    $('agent-approve').textContent = agentApproval && agentApproval.capability !== 'research' ? 'Approve owner private connection' : 'Connect to this conversation';
    $('agent-client').textContent = agentApproval ? 'Connecting app: ' + agentApproval.clientName + '. Callback host: ' + agentApproval.redirectHost + '. Check the selected conversation before approving.' : '';
  }
  function finishAgentApproval() {
    window.clearTimeout(agentApprovalTimer);
    agentApproval = null; agentNonce = null; agentNeedsReauth = false; showAgentApproval();
    var url = new URL(window.location.href); url.searchParams.delete('mcp_request');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
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
    var epoch = state.epoch, nonce = agentNonce;
    try {
      var data = await workerJson('/approval-info?request=' + nonce);
      if (epoch !== state.epoch || !state.user || !state.owner || nonce !== agentNonce) return;
      if (data.nonce !== agentNonce || typeof data.clientId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(data.clientId) || typeof data.clientName !== 'string' || data.clientName.length > 100 || typeof data.redirectHost !== 'string' || data.redirectHost.length > 255 || !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= Date.now()) throw new Error('Invalid connection.');
      var scopeText = Array.isArray(data.scopes) ? data.scopes.slice().sort().join(' ') : '';
      data.capability = scopeText === 'research.read research.reply' ? 'research' : scopeText === 'owner.jobs' ? 'owner-tools' : scopeText === 'owner.runner' ? 'owner-runner' : scopeText === 'research.runner' ? 'research-runner' : null;
      if (!data.capability) throw new Error('Unknown connection capability.');
      agentApproval = data; showAgentApproval();
      window.clearTimeout(agentApprovalTimer);
      agentApprovalTimer = window.setTimeout(function () {
        if (epoch !== state.epoch || agentApproval !== data) return;
        finishAgentApproval(); status('The connection request expired. Start connecting again from your agent app.');
      }, Math.min(2147483647, Math.max(1, data.expiresAt - Date.now())));
      status('Select the conversation the connecting assistant may access, then approve inside that conversation.');
    } catch { if (epoch === state.epoch && nonce === agentNonce) { finishAgentApproval(); status('The assistant connection request is unavailable or expired. Start connecting again from your agent app.'); } }
  }
  $('private-refresh').addEventListener('click', function () {
    if (!state.owner || !state.threadId) return;
    var threadId = state.threadId, epoch = state.epoch;
    run(function () { return call({ action: 'private-list', threadId: threadId }, 'messageAgents'); }, function (data) {
      if (epoch !== state.epoch || threadId !== state.threadId) return;
      if (!Array.isArray(data.connections) || data.connections.length > 40 || data.connections.some(function (connection) { return !/^[a-f0-9]{32}$/.test(connection.grantId || '') || !['owner-tools', 'owner-runner', 'research-runner'].includes(connection.capability) || !Number.isSafeInteger(connection.expiresAt); })) throw new Error('Invalid connections.');
      $('private-connections').replaceChildren();
      data.connections.forEach(function (connection) {
        if (connection.expiresAt <= Date.now()) return;
        var li = node('li', connection.capability + ' · expires ' + new Date(connection.expiresAt).toLocaleString());
        li.dataset.expiresAt = String(connection.expiresAt);
        li.appendChild(button('Revoke', function () {
          if (epoch !== state.epoch || threadId !== state.threadId) return;
          run(function () { return call({ action: 'private-revoke', threadId: threadId, grantId: connection.grantId }, 'messageAgents'); }, function (answer) { if (answer.revoked !== true) throw new Error('Revocation failed.'); li.remove(); status('Private connection revoked.', true); });
        }));
        $('private-connections').appendChild(li);
      });
      expirePrivateConnections();
      status(data.connections.length ? 'Private connections loaded.' : 'No active private connections.', true);
    });
  });
  function expirePrivateConnections() {
    window.clearTimeout(privateConnectionTimer);
    var next = Infinity;
    $('private-connections').querySelectorAll('li[data-expires-at]').forEach(function (li) {
      var expiry = Number(li.dataset.expiresAt);
      if (expiry <= Date.now()) li.remove(); else next = Math.min(next, expiry);
    });
    if (Number.isFinite(next)) privateConnectionTimer = window.setTimeout(expirePrivateConnections, Math.min(2147483647, Math.max(1, next - Date.now())));
  }
  $('agent-limit-save').addEventListener('click', function () {
    if (!state.owner || !state.threadId) return;
    var maximum = Number($('agent-limit').value);
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 50) { status('Choose a limit from 1 to 50.'); return; }
    run(function () { return call({ action: 'limit', threadId: state.threadId, maximum: maximum }, 'messageAgents'); }, function (data) { if (data.saved !== true) throw new Error('The limit was not saved.'); status('Assistant limit saved for this conversation.', true); });
  });
  $('agent-revoke').addEventListener('click', function () {
    if (!state.owner || !state.threadId) return;
    run(function () { return call({ action: 'revoke', threadId: state.threadId }, 'messageAgents'); }, function (data) { if (data.revoked !== true) throw new Error('Revocation failed.'); status('Assistant access disconnected.', true); });
  });
  $('agent-deny').addEventListener('click', function () { finishAgentApproval(); status('Assistant connection canceled.', true); });
  ['google', 'github'].forEach(function (provider) {
    $('agent-' + provider).addEventListener('click', function () {
      if (!state.owner || !agentApproval || agentApproval.capability === 'research' || state.busy || agentReauthPending) return;
      var uid = state.user.uid, epoch = state.epoch, approval = agentApproval;
      agentReauthPending = true; showAgentApproval();
      // Call directly from the click so the existing popup flow retains the
      // browser user gesture. Sign-in never approves a connection automatically.
      try {
        window.siteAuth.signIn(provider + '.com').then(function () {
          if (epoch === state.epoch && state.user && state.user.uid === uid && agentApproval === approval) { agentNeedsReauth = false; showAgentApproval(); status('Sign-in refreshed. Select the same conversation and approve the private connection.'); }
        }).catch(function (error) { if (epoch === state.epoch && agentApproval === approval) status(error.message || 'Sign-in failed. Please try again.'); }).finally(function () { if (epoch === state.epoch) { agentReauthPending = false; showAgentApproval(); } });
      } catch { agentReauthPending = false; showAgentApproval(); status('Sign-in is unavailable. Reload the page and try again.'); }
    });
  });
  $('agent-approve').addEventListener('click', function () {
    if (!state.owner || !state.threadId || !agentApproval || agentApproval.expiresAt <= Date.now()) return;
    var approval = agentApproval, nonce = agentNonce, threadId = state.threadId, epoch = state.epoch;
    run(async function () {
      var ticket = await call({ action: 'connect', threadId: threadId, nonce: nonce, clientId: approval.clientId, capability: approval.capability }, 'messageAgents');
      if (epoch !== state.epoch || threadId !== state.threadId || agentApproval !== approval) return;
      if (!/^[a-f0-9]{32}\.[a-f0-9]{64}$/.test(ticket.ticket || '')) throw new Error('Invalid connection.');
      return workerJson('/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nonce: nonce, ticket: ticket.ticket }) });
    }, function (data) {
      if (epoch !== state.epoch || threadId !== state.threadId || agentApproval !== approval) return;
      var redirect = new URL(data.redirectTo);
      if (redirect.host !== approval.redirectHost || redirect.username || redirect.password || redirect.hash || !(redirect.protocol === 'https:' || redirect.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname))) throw new Error('Invalid callback.');
      finishAgentApproval(); status('Authorization accepted. Returning to the connecting app.', true);
      window.location.assign(redirect.href);
    });
  });
  function assistantMode() {
    var stick = feedAtEnd();
    var on = $('assistant-mode').checked && !!state.thread?.agentReady && !state.editing;
    $('send').textContent = state.editing ? 'Save changes' : on ? 'Send to assistant' : 'Send';
    $('assistant-hint').hidden = !on;
    if (on) $('assistant-hint').textContent = 'Queues a shared request with the shared guide and up to six recent messages. Everyone in this conversation can read it. Approval appears here before an action. ' + (state.thread.agentRequestLimit || 5) + ' requests per person in three hours. Processing waits for the connected assistant.';
    if (stick && state.thread) $('feed').scrollTop = $('feed').scrollHeight;
  }
  $('assistant-mode').addEventListener('change', assistantMode);
  function askAssistant() {
    if (!editor || !state.threadId || !state.user || state.editing || !state.thread?.agentReady) return;
    if (billCommand()) { requestBill(); return; }
    var text = editor.getText().trim();
    if (!text || text.length > 4000) { status('Write a research question of up to 4,000 characters.'); return; }
    if (!agentRequest || agentRequest.text !== text || agentRequest.threadId !== state.threadId) agentRequest = { text: text, threadId: state.threadId, requestId: Array.from(window.crypto.getRandomValues(new Uint8Array(16)), function (b) { return b.toString(16).padStart(2, '0'); }).join('') };
    var input = Object.assign({ action: 'request' }, agentRequest);
    run(function () { return call(input, 'messageAgents'); }, function (data) { if (data.queued !== true) throw new Error('Request not queued.'); resetEditor(); status('Research request queued. The connected assistant will reply when available.', true); });
  }
  $('agent-ask').addEventListener('click', askAssistant);
  $('file').addEventListener('change', function () { stageFile($('file').files[0], false); });
  $('file-clear').addEventListener('click', clearFile);
  $('upload-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!state.threadId || !state.user || state.busy) return;
    var file = stagedFile || $('file').files[0], password = $('file-pass').value, encrypted = $('file-encrypt').checked;
    var threadId = state.threadId, epoch = state.epoch;
    $('file-pass').value = '';
    run(async function () {
      var payload;
      try { payload = encrypted ? await window.MessageFiles.encrypt(file, password, threadId) : await window.MessageFiles.plain(file); }
      catch (error) { error.code = 'file-client'; throw error; }
      if (epoch !== state.epoch || threadId !== state.threadId) throw new Error('Session changed.');
      return call({ action: 'upload', threadId: threadId, envelope: payload, bytes: file.size });
    }, function () { clearFile(); status(encrypted ? 'Encrypted file attached. Share the passphrase separately.' : 'File attached without file encryption.', true); });
  });
  $('profile-form').addEventListener('submit', function (event) { event.preventDefault(); run(function () { return call({ action: 'profile', name: $('name').value }); }, function () { profileSummary(); status('Your messaging name was saved.', true); }); });
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
            status(response.existing ? 'Opened your existing conversation.' : 'Conversation created.', true); $('people').replaceChildren(); $('find').value = ''; toggle('owner', 'new', false);
          });
        }));
        buttons.appendChild(button('Add to group', function () {
          if (!state.groupDraft.some(function (p) { return p.uid === person.uid; }) && state.groupDraft.length < 9) state.groupDraft.push({ uid: person.uid, label: (person.handle || person.name).slice(0, 80) });
          drawGroupDraft(); $('people').replaceChildren(); $('find').value = ''; $('find').focus();
        }));
        li.appendChild(buttons);
        $('people').appendChild(li);
      });
      status(data.users.length ? '' : 'No exact match.', true);
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
      status('Group created.', true);
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
  $('delete-yes').addEventListener('click', function () { if (!state.threadId) return; run(function () { return call({ action: 'delete', threadId: state.threadId }); }, function () { clearThread(); status('Conversation deleted.', true); }); });
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
