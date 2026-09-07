/* Chess Tournament tool.
 *
 * This file draws the page and keeps the tournament. Every decision about a
 * pairing, a score, or a rating is made by chess-tournament-engine.js, which
 * has no DOM and is tested on its own.
 *
 * The tournament lives in this browser (localStorage) while the organizer
 * works. A signed-in reader can also save it to their account, which is the
 * per-user store the rest of the site uses; the database rules bound the
 * record size, the number of slots, and how often a slot can be written.
 * Nothing here is an authorization boundary.
 *
 * Every string that came from a file, a paste, or the account store is
 * written with textContent or into an input's value. Files are checked by
 * signature and size before they are read, and an Excel workbook is only
 * handed to the spreadsheet reader after its container passes the same
 * checks the Randomizer applies.
 */
(function () {
  'use strict';

  var CT = window.ChessTournament;
  var root = document.getElementById('chess-tournament');
  if (!root || !CT) return;

  var LOCAL_KEY = 'chess-tournament:current';
  var LOCAL_SLOT_KEY = 'chess-tournament:slot';
  var LOCAL_BASE_KEY = 'chess-tournament:default-base';
  var SLOTS = 10;
  var MAX_ROSTER_FILE_BYTES = 2 * 1024 * 1024;
  /* Site-wide upload ceiling for a saved tournament file. */
  var MAX_SAVE_FILE_BYTES = 7 * 1024 * 1024;
  /* Project default: a download URL stays alive this long before it is
     revoked, so the browser has time to start the download. */
  var DOWNLOAD_URL_LIFETIME_MS = 30000;
  var CLOUD_SAVE_DELAY_MS = 8000;
  /* Matches the database rule: two writes to a slot are five seconds apart. */
  var CLOUD_MIN_INTERVAL_MS = 5000;
  var CLOUD_TIMEOUT_MS = 15000;
  var FEEDBACK_MS = 2000;
  var XLSX_SCRIPT = 'randomizer-assets/xlsx.mini.min.js';
  var XLSX_LOAD_TIMEOUT_MS = 15000;
  /* Same container limits as the Randomizer, which vendors the reader. */
  var XLSX_LIMITS = { maxExpandedBytes: 8 * 1024 * 1024, maxEntryBytes: 4 * 1024 * 1024, maxCompressionRatio: 250, maxZipEntries: 256 };

  function $(id) { return document.getElementById(id); }

  var ui = {
    message: $('ct-message'),
    accountMessage: $('ct-account-message'),
    auth: $('ct-auth'),
    signInGithub: $('ct-signin-github'),
    signInGoogle: $('ct-signin-google'),
    saved: $('ct-saved'),
    savedRefresh: $('ct-saved-refresh'),
    newButton: $('ct-new'),
    openFile: $('ct-open-file'),
    openInput: $('ct-open-input'),
    work: $('ct-work'),
    settingsForm: $('ct-settings-form'),
    name: $('ct-name'),
    tc: $('ct-tc'),
    rounds: $('ct-rounds'),
    bye: $('ct-bye'),
    byeSchedule: $('ct-bye-schedule'),
    k: $('ct-k'),
    wa: $('ct-wa'),
    defaultBase: $('ct-default-base'),
    settingsNote: $('ct-settings-note'),
    sections: $('ct-sections'),
    sectionName: $('ct-section-name'),
    addSection: $('ct-add-section'),
    sectionStatus: $('ct-section-status'),
    saveAccount: $('ct-save-account'),
    exportButton: $('ct-export'),
    deleteAccount: $('ct-delete-account'),
    close: $('ct-close'),
    saveStatus: $('ct-save-status'),
    setup: $('ct-setup'),
    roster: $('ct-roster'),
    rosterDrop: $('ct-roster-drop'),
    rosterBrowse: $('ct-roster-browse'),
    rosterFile: $('ct-roster-file'),
    rosterStatus: $('ct-roster-status'),
    rosterErrors: $('ct-roster-errors'),
    rosterAdd: $('ct-roster-add'),
    symbols: $('ct-symbols'),
    playerCount: $('ct-player-count'),
    playersEmpty: $('ct-players-empty'),
    playersSetup: $('ct-players-setup'),
    start: $('ct-start'),
    removeSection: $('ct-remove-section'),
    running: $('ct-running'),
    views: {
      pairings: { tab: $('ct-view-pairings'), panel: $('ct-pairings-view') },
      standings: { tab: $('ct-view-standings'), panel: $('ct-standings-view') },
      players: { tab: $('ct-view-players'), panel: $('ct-players-view') },
      crosstable: { tab: $('ct-view-crosstable'), panel: $('ct-crosstable-view') }
    },
    attendance: $('ct-attendance'),
    attendanceHeading: $('ct-attendance-heading'),
    attendanceCount: $('ct-attendance-count'),
    absentFilter: $('ct-absent-filter'),
    absentList: $('ct-absent-list'),
    oddByeRow: $('ct-odd-bye-row'),
    oddBye: $('ct-odd-bye'),
    pair: $('ct-pair'),
    finish: $('ct-finish'),
    moreRounds: $('ct-more-rounds'),
    roundSelect: $('ct-round-select'),
    warnings: $('ct-warnings'),
    pairings: $('ct-pairings'),
    byes: $('ct-byes'),
    printPairings: $('ct-print-pairings'),
    copyPairings: $('ct-copy-pairings'),
    allForfeit: $('ct-all-forfeit'),
    undo: $('ct-undo'),
    standings: $('ct-standings'),
    printStandings: $('ct-print-standings'),
    copyStandings: $('ct-copy-standings'),
    csvStandings: $('ct-csv-standings'),
    final: $('ct-final'),
    finalNote: $('ct-final-note'),
    finalSymbols: $('ct-final-symbols'),
    anchorForm: $('ct-anchor-form'),
    anchorSymbol: $('ct-anchor-symbol'),
    anchorPlayer: $('ct-anchor-player'),
    anchorRating: $('ct-anchor-rating'),
    anchorClear: $('ct-anchor-clear'),
    reopen: $('ct-reopen'),
    lateForm: $('ct-late-form'),
    lateName: $('ct-late-name'),
    lateTag: $('ct-late-tag'),
    lateBase: $('ct-late-base'),
    lateFide: $('ct-late-fide'),
    playersList: $('ct-players-list'),
    crosstable: $('ct-crosstable'),
    copyBox: $('ct-copy-box'),
    copyFallback: $('ct-copy-fallback'),
    print: $('ct-print')
  };

  var state = {
    event: null,
    section: 0,
    slot: null,
    user: null,
    saved: [],
    view: 'pairings',
    round: null,
    absent: {},
    openHistory: {},
    busy: false,
    cloudTimer: null,
    lastCloudSave: 0,
    fileRequest: 0,
    xlsxLoading: null,
    downloadUrls: []
  };

  /* ------------------------------ helpers ------------------------------ */

  function show(node, visible) { if (node) node.hidden = !visible; }

  function setStatus(node, text, tone) {
    if (!node) return;
    node.textContent = text || '';
    if (tone) node.setAttribute('data-tone', tone);
    else node.removeAttribute('data-tone');
  }

  function message(text, tone) { setStatus(ui.message, text, tone); }

  function errorText(error) {
    if (error && error.name === 'AbortError') return 'The request took too long. Check your connection and try again.';
    if (error && error.message === 'signed-out') return 'You are signed out. Sign in and try again.';
    if (error && /PERMISSION_DENIED|permission/i.test(String(error.message || error.code || ''))) {
      return 'The account store refused the save. Wait a few seconds and try again; if it keeps failing, check that your device clock is right.';
    }
    if (error && typeof error.message === 'string' && error.message) return error.message;
    return 'Something went wrong. Try again.';
  }

  /* Builds an element. Only fixed property names are ever passed here;
     every user-provided value goes through `text` or an input value. */
  function h(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (key) {
        var value = props[key];
        if (key === 'className') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'dataset') Object.keys(value).forEach(function (d) { node.dataset[d] = value[d]; });
        else if (key === 'attrs') Object.keys(value).forEach(function (a) { node.setAttribute(a, value[a]); });
        else if (key === 'on') Object.keys(value).forEach(function (e) { node.addEventListener(e, value[e]); });
        else if (key in node) node[key] = value;
        else node.setAttribute(key, value);
      });
    }
    (children || []).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function button(label, onClick, className) {
    return h('button', { type: 'button', className: 'tool-button' + (className ? ' ' + className : ''), text: label, on: { click: onClick } });
  }

  function flash(node, label) {
    var original = node.textContent;
    node.textContent = label;
    node.disabled = true;
    window.setTimeout(function () {
      node.textContent = original;
      node.disabled = false;
    }, FEEDBACK_MS);
  }

  function formatDateTime(stamp) {
    if (!Number.isFinite(stamp) || stamp <= 0) return '';
    try { return new Date(stamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
    catch (error) { return ''; }
  }

  function formatTime(stamp) {
    try { return new Date(stamp).toLocaleTimeString(undefined, { timeStyle: 'short' }); }
    catch (error) { return ''; }
  }

  function points(n) {
    if (!Number.isFinite(n)) return '';
    var whole = Math.floor(n);
    var half = n - whole >= 0.5;
    if (whole === 0 && half) return '½';
    return String(whole) + (half ? '½' : '');
  }

  function playerLabel(p) { return p.tag ? p.name + ' (' + p.tag + ')' : p.name; }

  function startLabel(p) {
    if (Number.isInteger(p.fide)) return 'FIDE ' + p.fide;
    return CT.isNumericBase(p.base) ? p.base : p.base;
  }

  function slug(text) {
    var clean = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return clean || 'tournament';
  }

  function lsGet(key) { try { return window.localStorage.getItem(key); } catch (error) { return null; } }
  function lsSet(key, value) { try { window.localStorage.setItem(key, value); return true; } catch (error) { return false; } }
  function lsDel(key) { try { window.localStorage.removeItem(key); } catch (error) {} }

  function current() { return state.event ? state.event.sections[state.section] : null; }

  function defaultBase() {
    var value = ui.defaultBase.value.trim() || lsGet(LOCAL_BASE_KEY) || 'A';
    var base = CT.normalizeBase(value);
    return base ? base.base : 'A';
  }

  /* ------------------------------ persistence ------------------------------ */

  function saveLocal() {
    if (!state.event) {
      lsDel(LOCAL_KEY);
      lsDel(LOCAL_SLOT_KEY);
      return;
    }
    try {
      if (!lsSet(LOCAL_KEY, CT.serialize(state.event))) message('This browser is not keeping the tournament between visits. Save it as a file or to your account.', 'error');
      lsSet(LOCAL_SLOT_KEY, state.slot === null ? '' : String(state.slot));
    } catch (error) {
      message(errorText(error), 'error');
    }
  }

  function restoreLocal() {
    var json = lsGet(LOCAL_KEY);
    if (!json) return false;
    try {
      state.event = CT.parseEvent(json);
      var slot = lsGet(LOCAL_SLOT_KEY);
      state.slot = slot !== null && /^[0-9]$/.test(slot) ? parseInt(slot, 10) : null;
      return true;
    } catch (error) {
      lsDel(LOCAL_KEY);
      lsDel(LOCAL_SLOT_KEY);
      return false;
    }
  }

  /* Every change goes through here: keep it in the browser, queue the
     account save when the tournament has a slot, and redraw. */
  function commit(note, tone) {
    saveLocal();
    scheduleCloudSave();
    render();
    if (note) message(note, tone || 'ok');
  }

  function cloud() {
    var user = window.siteAuth && window.siteAuth.user();
    var db = window.siteAuth && typeof window.siteAuth.db === 'function' ? window.siteAuth.db() : null;
    if (!user || !db || typeof db.ref !== 'function') return null;
    return { db: db, uid: user.uid };
  }

  function withTimeout(promise) {
    return new Promise(function (resolve, reject) {
      var timer = window.setTimeout(function () {
        var error = new Error('timeout');
        error.name = 'AbortError';
        reject(error);
      }, CLOUD_TIMEOUT_MS);
      Promise.resolve(promise).then(function (value) { window.clearTimeout(timer); resolve(value); }, function (error) { window.clearTimeout(timer); reject(error); });
    });
  }

  function cloudList() {
    var c = cloud();
    if (!c) return Promise.resolve([]);
    return withTimeout(c.db.ref('users/' + c.uid + '/tournament-index').once('value')).then(function (snapshot) {
      var value = snapshot && typeof snapshot.val === 'function' ? snapshot.val() : null;
      var list = [];
      if (value && typeof value === 'object') {
        Object.keys(value).forEach(function (key) {
          if (!/^[0-9]$/.test(key)) return;
          var entry = value[key];
          if (!entry || typeof entry !== 'object') return;
          list.push({
            slot: parseInt(key, 10),
            id: typeof entry.id === 'string' ? entry.id : '',
            name: typeof entry.name === 'string' ? entry.name : 'Tournament',
            players: Number(entry.players) || 0,
            sections: Number(entry.sections) || 0,
            round: Number(entry.round) || 0,
            rounds: Number(entry.rounds) || 0,
            status: typeof entry.status === 'string' ? entry.status : '',
            updatedAt: Number(entry.updatedAt) || 0
          });
        });
      }
      list.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
      return list;
    });
  }

  function cloudSave(slot) {
    var c = cloud();
    if (!c) return Promise.reject(new Error('signed-out'));
    var json = CT.serialize(state.event);
    var now = Date.now();
    var summary = CT.eventSummary(state.event);
    summary.updatedAt = now;
    var changes = {};
    changes['tournaments/' + slot] = { id: state.event.id, data: json, updatedAt: now };
    changes['tournament-index/' + slot] = summary;
    return withTimeout(c.db.ref('users/' + c.uid).update(changes)).then(function () {
      state.lastCloudSave = now;
      return now;
    });
  }

  function cloudLoad(slot) {
    var c = cloud();
    if (!c) return Promise.reject(new Error('signed-out'));
    return withTimeout(c.db.ref('users/' + c.uid + '/tournaments/' + slot).once('value')).then(function (snapshot) {
      var value = snapshot && typeof snapshot.val === 'function' ? snapshot.val() : null;
      if (!value || typeof value !== 'object' || typeof value.data !== 'string') throw new Error('That slot holds no tournament.');
      return CT.parseEvent(value.data);
    });
  }

  function cloudDelete(slot) {
    var c = cloud();
    if (!c) return Promise.reject(new Error('signed-out'));
    var changes = {};
    changes['tournaments/' + slot] = null;
    changes['tournament-index/' + slot] = null;
    return withTimeout(c.db.ref('users/' + c.uid).update(changes));
  }

  function scheduleCloudSave() {
    if (state.slot === null || !state.event || !cloud()) return;
    if (state.cloudTimer) window.clearTimeout(state.cloudTimer);
    var wait = Math.max(CLOUD_SAVE_DELAY_MS, state.lastCloudSave + CLOUD_MIN_INTERVAL_MS - Date.now());
    state.cloudTimer = window.setTimeout(function () {
      state.cloudTimer = null;
      if (state.slot === null || !state.event) return;
      runCloudSave(state.slot, true);
    }, wait);
    setStatus(ui.saveStatus, 'Kept in this browser. Saving to your account shortly.', '');
  }

  function runCloudSave(slot, quiet) {
    if (!state.event) return Promise.resolve();
    var remaining = state.lastCloudSave + CLOUD_MIN_INTERVAL_MS - Date.now();
    if (remaining > 0) {
      return new Promise(function (resolve) { window.setTimeout(resolve, remaining); }).then(function () { return runCloudSave(slot, quiet); });
    }
    setStatus(ui.saveStatus, 'Saving to your account.', '');
    return cloudSave(slot).then(function (now) {
      state.slot = slot;
      lsSet(LOCAL_SLOT_KEY, String(slot));
      setStatus(ui.saveStatus, 'Saved to your account at ' + formatTime(now) + '.', 'ok');
      if (!quiet) message('Saved to your account.', 'ok');
      return refreshSaved();
    }).catch(function (error) {
      setStatus(ui.saveStatus, 'Kept in this browser. The account save failed: ' + errorText(error), 'error');
    });
  }

  function saveToAccount() {
    if (!state.event) return;
    if (!cloud()) { message('Sign in to save to your account.', 'error'); return; }
    if (state.busy) return;
    var slot = state.slot;
    if (slot === null) {
      var used = {};
      state.saved.forEach(function (entry) { used[entry.slot] = true; });
      for (var i = 0; i < SLOTS; i += 1) if (!used[i]) { slot = i; break; }
      if (slot === null) { message('Your account already holds ' + SLOTS + ' tournaments. Delete one from the list first.', 'error'); return; }
    }
    state.busy = true;
    ui.saveAccount.disabled = true;
    runCloudSave(slot, false).finally(function () {
      state.busy = false;
      ui.saveAccount.disabled = false;
      render();
    });
  }

  function refreshSaved() {
    if (!cloud()) { state.saved = []; renderSaved(); return Promise.resolve(); }
    ui.savedRefresh.disabled = true;
    return cloudList().then(function (list) {
      state.saved = list;
      renderSaved();
    }).catch(function (error) {
      setStatus(ui.accountMessage, 'Could not read your saved tournaments: ' + errorText(error), 'error');
    }).finally(function () { ui.savedRefresh.disabled = false; });
  }

  /* ------------------------------ account panel ------------------------------ */

  function renderAccount() {
    if (!window.siteAuth) {
      setStatus(ui.accountMessage, 'Sign-in is not available on this page. Tournaments stay in this browser and can be saved as files.', '');
      show(ui.auth, false);
      show(ui.savedRefresh, false);
      show(ui.saveAccount, false);
      show(ui.deleteAccount, false);
      return;
    }
    if (!state.user) {
      setStatus(ui.accountMessage, 'Sign in to keep up to ' + SLOTS + ' tournaments in your account. Without signing in, a tournament stays in this browser and can be saved as a file.', '');
      show(ui.auth, true);
      show(ui.savedRefresh, false);
      ui.saved.replaceChildren();
      show(ui.saveAccount, false);
      show(ui.deleteAccount, false);
      return;
    }
    var handle = window.siteAuth.handle && window.siteAuth.handle();
    setStatus(ui.accountMessage, (handle ? 'Signed in as ' + handle + '.' : 'Signed in.') + ' Tournaments saved to your account are listed here.', 'ok');
    show(ui.auth, false);
    show(ui.savedRefresh, true);
    show(ui.saveAccount, Boolean(state.event));
    show(ui.deleteAccount, Boolean(state.event) && state.slot !== null);
  }

  function renderSaved() {
    ui.saved.replaceChildren();
    if (!state.user) return;
    if (!state.saved.length) {
      ui.saved.appendChild(h('li', { className: 'tool-note', text: 'No tournaments saved to your account yet.' }));
      return;
    }
    state.saved.forEach(function (entry) {
      var li = h('li');
      var head = h('div', { className: 'tool-list-head' });
      head.appendChild(h('span', { className: 'tool-list-title', text: entry.name }));
      var actions = h('div', { className: 'tool-list-actions' });
      actions.appendChild(button(state.event && state.slot === entry.slot ? 'Open again' : 'Open', function () { openFromAccount(entry); }));
      var remove = button('Delete', function () { deleteFromAccount(entry, remove); }, 'tool-button-danger');
      actions.appendChild(remove);
      head.appendChild(actions);
      li.appendChild(head);
      var parts = [];
      parts.push(entry.players + (entry.players === 1 ? ' player' : ' players'));
      if (entry.sections > 1) parts.push(entry.sections + ' sections');
      parts.push(entry.status === 'setup' ? 'not started' : 'round ' + entry.round + ' of ' + entry.rounds + (entry.status === 'finished' ? ', finished' : ''));
      var when = formatDateTime(entry.updatedAt);
      if (when) parts.push('saved ' + when);
      parts.push('slot ' + (entry.slot + 1));
      li.appendChild(h('div', { className: 'tool-list-meta', text: parts.join(' · ') }));
      ui.saved.appendChild(li);
    });
  }

  function openFromAccount(entry) {
    if (state.busy) return;
    if (state.event && state.slot !== entry.slot && !window.confirm('Open "' + entry.name + '"? The tournament open now stays in your account only if it was saved there, so save it as a file first if you need a copy.')) return;
    state.busy = true;
    message('Opening ' + entry.name + '.', '');
    cloudLoad(entry.slot).then(function (event) {
      if (state.cloudTimer) { window.clearTimeout(state.cloudTimer); state.cloudTimer = null; }
      state.event = event;
      state.slot = entry.slot;
      state.section = 0;
      state.view = 'pairings';
      state.round = null;
      state.absent = {};
      state.openHistory = {};
      saveLocal();
      render();
      setStatus(ui.saveStatus, 'Opened from your account. Changes are saved back automatically.', 'ok');
      message('Opened ' + event.name + '.', 'ok');
    }).catch(function (error) {
      message(errorText(error), 'error');
    }).finally(function () { state.busy = false; });
  }

  function deleteFromAccount(entry, trigger) {
    if (!window.confirm('Delete "' + entry.name + '" from your account? A copy open in a browser or saved as a file is not affected.')) return;
    trigger.disabled = true;
    cloudDelete(entry.slot).then(function () {
      if (state.slot === entry.slot) {
        state.slot = null;
        lsSet(LOCAL_SLOT_KEY, '');
        setStatus(ui.saveStatus, 'Kept in this browser only.', '');
      }
      message('Deleted ' + entry.name + ' from your account.', 'ok');
      return refreshSaved().then(render);
    }).catch(function (error) {
      trigger.disabled = false;
      message(errorText(error), 'error');
    });
  }

  function signIn(provider, trigger) {
    if (!window.siteAuth) return;
    trigger.disabled = true;
    window.siteAuth.signIn(provider).catch(function () { trigger.disabled = false; });
  }

  /* ------------------------------ files ------------------------------ */

  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime });
    var url;
    try { url = URL.createObjectURL(blob); } catch (error) { message('This browser could not prepare the download.', 'error'); return; }
    var anchor = h('a', { href: url, download: name });
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    state.downloadUrls.push(url);
    window.setTimeout(function () { releaseDownload(url); }, DOWNLOAD_URL_LIFETIME_MS);
  }

  function releaseDownload(url) {
    var index = state.downloadUrls.indexOf(url);
    if (index < 0) return;
    state.downloadUrls.splice(index, 1);
    try { URL.revokeObjectURL(url); } catch (error) {}
  }

  function exportFile() {
    if (!state.event) return;
    try {
      download(slug(state.event.name) + '.chess-tournament.json', CT.serialize(state.event), 'application/json');
      message('The tournament file is downloading.', 'ok');
    } catch (error) {
      message(errorText(error), 'error');
    }
  }

  function openFile(file) {
    if (!file) return;
    if (file.size < 2) { message('The selected file is empty.', 'error'); return; }
    if (file.size > MAX_SAVE_FILE_BYTES) { message('Choose a file smaller than 7 MB.', 'error'); return; }
    var request = state.fileRequest + 1;
    state.fileRequest = request;
    file.arrayBuffer().then(function (buffer) {
      if (request !== state.fileRequest) return;
      var text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(buffer)); }
      catch (error) { throw new Error('The file is not UTF-8 text.'); }
      var event = CT.parseEvent(text);
      if (state.cloudTimer) { window.clearTimeout(state.cloudTimer); state.cloudTimer = null; }
      state.event = event;
      state.slot = null;
      state.section = 0;
      state.view = 'pairings';
      state.round = null;
      state.absent = {};
      state.openHistory = {};
      saveLocal();
      render();
      setStatus(ui.saveStatus, 'Opened from a file and kept in this browser.', 'ok');
      message('Opened ' + event.name + '.', 'ok');
    }).catch(function (error) {
      message(errorText(error), 'error');
    });
  }

  /* ------------------------------ spreadsheet reader ------------------------------ */

  function readUint16(view, offset) { return view.getUint16(offset, true); }
  function readUint32(view, offset) { return view.getUint32(offset, true); }

  function isZipSignature(bytes) {
    return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  }

  /* Copied from the Randomizer's validateXlsxZip so both tools accept the
     same containers. Keep the two in step when one changes. */
  function validateXlsxZip(arrayBuffer) {
    var view = new DataView(arrayBuffer);
    var bytes = new Uint8Array(arrayBuffer);
    if (bytes.length < 22 || readUint32(view, 0) !== 0x04034b50) throw new Error('The Excel file does not have a valid XLSX container.');
    var scanStart = Math.max(0, bytes.length - 65557);
    var eocd = -1;
    for (var i = bytes.length - 22; i >= scanStart; i -= 1) {
      if (readUint32(view, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('The Excel file is incomplete or malformed.');
    var diskNumber = readUint16(view, eocd + 4);
    var centralDisk = readUint16(view, eocd + 6);
    var diskEntries = readUint16(view, eocd + 8);
    var totalEntries = readUint16(view, eocd + 10);
    var centralSize = readUint32(view, eocd + 12);
    var centralOffset = readUint32(view, eocd + 16);
    var commentLength = readUint16(view, eocd + 20);
    if (eocd + 22 + commentLength !== bytes.length) throw new Error('The Excel file has unsupported trailing data.');
    if (diskNumber !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) throw new Error('Multi-part Excel files are not supported.');
    if (totalEntries < 3 || totalEntries > XLSX_LIMITS.maxZipEntries || totalEntries === 0xffff) throw new Error('The Excel workbook has an unsupported number of internal files.');
    if (centralOffset === 0xffffffff || centralSize === 0xffffffff || centralOffset + centralSize > eocd) throw new Error('ZIP64 and malformed Excel containers are not supported.');
    var decoder = new TextDecoder('utf-8', { fatal: true });
    var cursor = centralOffset;
    var expandedTotal = 0;
    var names = new Set();
    var hasContentTypes = false;
    var hasWorkbook = false;
    var hasWorksheet = false;
    for (var entry = 0; entry < totalEntries; entry += 1) {
      if (cursor + 46 > eocd || readUint32(view, cursor) !== 0x02014b50) throw new Error('The Excel file has a malformed directory.');
      var flags = readUint16(view, cursor + 8);
      var compression = readUint16(view, cursor + 10);
      var compressedSize = readUint32(view, cursor + 20);
      var expandedSize = readUint32(view, cursor + 24);
      var nameLength = readUint16(view, cursor + 28);
      var extraLength = readUint16(view, cursor + 30);
      var entryCommentLength = readUint16(view, cursor + 32);
      var entryDisk = readUint16(view, cursor + 34);
      var localOffset = readUint32(view, cursor + 42);
      var next = cursor + 46 + nameLength + extraLength + entryCommentLength;
      if ((flags & 1) !== 0) throw new Error('Encrypted Excel files are not supported.');
      if (compression !== 0 && compression !== 8) throw new Error('The Excel file uses an unsupported compression method.');
      if (entryDisk !== 0 || compressedSize === 0xffffffff || expandedSize === 0xffffffff || localOffset === 0xffffffff) throw new Error('ZIP64 and multi-part Excel files are not supported.');
      if (next > eocd || localOffset + 30 > centralOffset || readUint32(view, localOffset) !== 0x04034b50) throw new Error('The Excel file has an invalid internal entry.');
      if (expandedSize > XLSX_LIMITS.maxEntryBytes) throw new Error('An internal workbook part is too large.');
      if (expandedSize > 0 && compressedSize === 0) throw new Error('The Excel file has an invalid compression ratio.');
      if (compressedSize > 0 && expandedSize / compressedSize > XLSX_LIMITS.maxCompressionRatio) throw new Error('The Excel file expands too much to process safely.');
      expandedTotal += expandedSize;
      if (expandedTotal > XLSX_LIMITS.maxExpandedBytes) throw new Error('The expanded Excel workbook is too large.');
      var name;
      try { name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)); }
      catch (error) { throw new Error('The Excel file has an invalid internal filename.'); }
      if (!name || name.charAt(0) === '/' || name.indexOf('\\') >= 0 || name.split('/').indexOf('..') >= 0) throw new Error('The Excel file has an unsafe internal path.');
      if (names.has(name)) throw new Error('The Excel file has duplicate internal paths.');
      names.add(name);
      if (name === '[Content_Types].xml') hasContentTypes = true;
      if (name === 'xl/workbook.xml') hasWorkbook = true;
      if (/^xl\/worksheets\/sheet[^/]*\.xml$/i.test(name)) hasWorksheet = true;
      cursor = next;
    }
    if (cursor !== centralOffset + centralSize) throw new Error('The Excel file has an unsupported directory layout.');
    if (!hasContentTypes || !hasWorkbook || !hasWorksheet) throw new Error('The selected file is not a supported XLSX workbook.');
  }

  /* The spreadsheet reader is 400 KB, so it is fetched from this site only
     when someone actually drops a workbook. */
  function loadSpreadsheetReader() {
    if (window.XLSX && typeof window.XLSX.read === 'function') return Promise.resolve();
    if (state.xlsxLoading) return state.xlsxLoading;
    state.xlsxLoading = new Promise(function (resolve, reject) {
      var failure = new Error('The spreadsheet reader did not load. Save the file as CSV and try again.');
      var script = document.createElement('script');
      var timer = window.setTimeout(function () { reject(failure); }, XLSX_LOAD_TIMEOUT_MS);
      script.src = XLSX_SCRIPT;
      script.addEventListener('load', function () {
        window.clearTimeout(timer);
        if (window.XLSX && typeof window.XLSX.read === 'function') resolve();
        else reject(failure);
      });
      script.addEventListener('error', function () { window.clearTimeout(timer); reject(failure); });
      document.head.appendChild(script);
    });
    state.xlsxLoading.catch(function () { state.xlsxLoading = null; });
    return state.xlsxLoading;
  }

  function rowsFromWorkbook(arrayBuffer) {
    var workbook = window.XLSX.read(arrayBuffer, {
      dense: true,
      sheetRows: CT.LIMITS.maxRosterRows + 1,
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      bookVBA: false,
      bookDeps: false,
      bookFiles: false,
      bookProps: false
    });
    for (var i = 0; i < workbook.SheetNames.length; i += 1) {
      var sheet = workbook.Sheets[workbook.SheetNames[i]];
      var matrix = window.XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, raw: false, defval: '' });
      var rows = [];
      for (var r = 0; r < matrix.length && r < CT.LIMITS.maxRosterRows; r += 1) {
        var source = Array.isArray(matrix[r]) ? matrix[r] : [matrix[r]];
        var row = [];
        var hasValue = false;
        for (var c = 0; c < source.length && c < CT.LIMITS.maxRosterColumns; c += 1) {
          var value = source[c] === null || source[c] === undefined ? '' : String(source[c]);
          row.push(value);
          if (value.trim()) hasValue = true;
        }
        if (hasValue) rows.push(row);
      }
      if (rows.length) return rows;
    }
    throw new Error('No populated worksheet was found.');
  }

  function readRosterFile(file) {
    if (!file) return;
    if (file.size < 1) { setStatus(ui.rosterStatus, 'The selected file is empty.', 'error'); return; }
    if (file.size > MAX_ROSTER_FILE_BYTES) { setStatus(ui.rosterStatus, 'Choose a roster file smaller than 2 MB.', 'error'); return; }
    var request = state.fileRequest + 1;
    state.fileRequest = request;
    ui.rosterAdd.disabled = true;
    setStatus(ui.rosterStatus, 'Reading ' + file.name + ' in this browser.', '');
    file.arrayBuffer().then(function (buffer) {
      if (request !== state.fileRequest) return;
      var bytes = new Uint8Array(buffer);
      if (isZipSignature(bytes)) {
        validateXlsxZip(buffer);
        return loadSpreadsheetReader().then(function () {
          if (request !== state.fileRequest) return;
          addPlayersFromRows(rowsFromWorkbook(buffer), file.name);
        });
      }
      var text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch (error) { throw new Error('The file is neither an Excel workbook nor UTF-8 text.'); }
      addPlayersFromText(text, file.name);
    }).catch(function (error) {
      setStatus(ui.rosterStatus, errorText(error), 'error');
    }).finally(function () {
      if (request === state.fileRequest) ui.rosterAdd.disabled = false;
    });
  }

  /* ------------------------------ roster ------------------------------ */

  function showRosterErrors(errors) {
    ui.rosterErrors.replaceChildren();
    var shown = errors.slice(0, 20);
    shown.forEach(function (text) { ui.rosterErrors.appendChild(h('li', { text: text })); });
    if (errors.length > shown.length) ui.rosterErrors.appendChild(h('li', { text: 'And ' + (errors.length - shown.length) + ' more.' }));
    show(ui.rosterErrors, errors.length > 0);
  }

  function addParsed(parsed, source) {
    var t = current();
    if (!t || t.status !== 'setup') { setStatus(ui.rosterStatus, 'This section has started. Add late players from the Players view.', 'error'); return; }
    var result = CT.importPlayers(state.event, parsed.players, state.section);
    var errors = parsed.errors.concat(result.errors);
    showRosterErrors(errors);
    var note = 'Added ' + result.added + (result.added === 1 ? ' player' : ' players') + (source ? ' from ' + source : '') + '.';
    if (errors.length) note += ' ' + errors.length + (errors.length === 1 ? ' row was' : ' rows were') + ' skipped.';
    setStatus(ui.rosterStatus, note, errors.length ? 'error' : 'ok');
    if (result.added) ui.roster.value = '';
    commit();
  }

  function addPlayersFromText(text, source) {
    addParsed(CT.parseRoster(text, { defaultBase: defaultBase() }), source);
  }

  function addPlayersFromRows(rows, source) {
    addParsed(CT.parseRosterRows(rows, { defaultBase: defaultBase() }), source);
  }

  /* ------------------------------ settings and sections ------------------------------ */

  function pointsLabel(n) { return n === 1 ? '1' : (n === 0.5 ? '½' : '0'); }

  /* One select per planned round with the points a requested bye scores. */
  function renderByeSchedule(event) {
    ui.byeSchedule.replaceChildren();
    var rounds = Math.max(event.settings.plannedRounds, 1);
    for (var r = 0; r < rounds; r += 1) {
      var value = CT.requestedByePoints(event.settings, r);
      var select = h('select', { className: 'tool-input', dataset: { round: String(r) }, attrs: { 'aria-label': 'Requested bye points in round ' + (r + 1) } });
      [0.5, 0, 1].forEach(function (n) {
        var option = h('option', { value: String(n), text: pointsLabel(n) });
        if (n === value) option.selected = true;
        select.appendChild(option);
      });
      ui.byeSchedule.appendChild(h('label', {}, [h('span', { text: 'R' + (r + 1) }), select]));
    }
  }

  function readByeSchedule() {
    var out = [];
    ui.byeSchedule.querySelectorAll('select[data-round]').forEach(function (select) {
      out[parseInt(select.dataset.round, 10)] = parseFloat(select.value);
    });
    return out;
  }

  function renderSettings() {
    var event = state.event;
    var locked = CT.eventStatus(event) !== 'setup';
    if (document.activeElement !== ui.name) ui.name.value = event.name;
    if (document.activeElement !== ui.tc) ui.tc.value = event.tc;
    ui.rounds.value = String(event.settings.plannedRounds);
    ui.bye.value = String(event.settings.byePoints);
    ui.k.value = String(event.settings.k);
    ui.wa.value = String(event.settings.whiteAdvantage);
    ui.bye.disabled = locked;
    ui.k.disabled = locked;
    ui.wa.disabled = locked;
    renderByeSchedule(event);
    ui.settingsNote.textContent = locked
      ? 'A section has started, so only the name, the time control, the number of rounds, and the requested-bye points can still change.'
      : 'Settings apply to every section and can change until a section starts. The number of rounds and the requested-bye points can change at any time.';
  }

  function applySettingsForm() {
    var event = state.event;
    if (!event) return;
    try {
      var name = ui.name.value.trim();
      event.name = name.slice(0, CT.LIMITS.maxTitleLength) || event.name;
      event.tc = ui.tc.value.trim().slice(0, CT.LIMITS.maxTimeControlLength);
      var schedule = readByeSchedule();
      var rounds = parseInt(ui.rounds.value, 10);
      /* A new round takes the last round's value, so a schedule that ends
         in zero-point byes keeps ending that way. */
      if (Number.isInteger(rounds)) {
        while (schedule.length < rounds) schedule.push(schedule.length ? schedule[schedule.length - 1] : 0.5);
      }
      CT.applySettings(event, {
        plannedRounds: ui.rounds.value,
        byePoints: ui.bye.value,
        requestedByePoints: schedule,
        k: ui.k.value,
        whiteAdvantage: ui.wa.value
      });
      var base = CT.normalizeBase(ui.defaultBase.value);
      if (base) { ui.defaultBase.value = base.base; lsSet(LOCAL_BASE_KEY, base.base); }
      else ui.defaultBase.value = defaultBase();
      commit();
    } catch (error) {
      message(errorText(error), 'error');
      render();
    }
  }

  function renderSectionTabs() {
    var event = state.event;
    ui.sections.replaceChildren();
    event.sections.forEach(function (section, index) {
      var label = section.name + ' (' + section.players.length + ')';
      var tab = button(label, function () {
        state.section = index;
        state.view = 'pairings';
        state.round = null;
        render();
      });
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', index === state.section ? 'true' : 'false');
      ui.sections.appendChild(tab);
    });
    var t = current();
    var parts = [t.name, t.players.length + (t.players.length === 1 ? ' player' : ' players')];
    if (t.status === 'setup') parts.push('not started');
    else parts.push('round ' + t.rounds.length + ' of ' + t.plannedRounds + (t.status === 'finished' ? ', finished' : ''));
    if (event.tc) parts.push(event.tc);
    setStatus(ui.sectionStatus, parts.join(' · '), '');
  }

  function addSectionFromForm() {
    var name = ui.sectionName.value.trim();
    if (!name) { message('Give the new section a name.', 'error'); ui.sectionName.focus(); return; }
    try {
      CT.addSection(state.event, name);
      ui.sectionName.value = '';
      state.section = state.event.sections.length - 1;
      commit('Added the section ' + name + '.');
    } catch (error) {
      message(errorText(error), 'error');
    }
  }

  function removeCurrentSection() {
    var t = current();
    if (!window.confirm('Remove the section ' + t.name + ' and its ' + t.players.length + ' players?')) return;
    try {
      CT.removeSection(state.event, state.section);
      state.section = 0;
      commit('Removed the section.');
    } catch (error) {
      message(errorText(error), 'error');
    }
  }

  function renderSaveStatus() {
    if (!state.event) { setStatus(ui.saveStatus, '', ''); return; }
    if (ui.saveStatus.textContent) return;
    setStatus(ui.saveStatus, state.slot === null ? 'Kept in this browser only.' : 'Saved to your account.', '');
  }

  /* ------------------------------ setup view ------------------------------ */

  function renderSymbols(t) {
    ui.symbols.replaceChildren();
    var symbols = Object.keys(t.symbols).sort();
    if (!symbols.length) {
      ui.symbols.appendChild(h('span', { className: 'tool-note', text: 'Every player in this section starts from a known number.' }));
      return;
    }
    symbols.forEach(function (symbol) {
      var input = h('input', { className: 'tool-input', type: 'number', min: CT.LIMITS.minRating, max: CT.LIMITS.maxRating, step: 1, inputMode: 'numeric', placeholder: 'unknown' });
      input.value = Number.isFinite(t.symbols[symbol]) ? String(t.symbols[symbol]) : '';
      input.addEventListener('change', function () {
        try {
          CT.setSymbolValue(t, symbol, input.value.trim() === '' ? null : input.value);
          commit();
        } catch (error) {
          message(errorText(error), 'error');
          render();
        }
      });
      var count = t.players.filter(function (p) { return p.base === symbol && !CT.knownStart(p); }).length;
      ui.symbols.appendChild(h('label', {}, [h('strong', { text: symbol }), h('span', { className: 'ct-dim', text: '(' + count + ')' }), input]));
    });
  }

  function renderSetupPlayers(t) {
    var event = state.event;
    ui.playerCount.textContent = t.players.length + ' of ' + CT.LIMITS.maxPlayers + ' in the whole tournament: ' + CT.eventPlayerCount(event);
    show(ui.playersEmpty, t.players.length === 0);
    ui.playersSetup.replaceChildren();
    ui.start.disabled = t.players.length < 2;
    if (!t.players.length) return;
    var table = h('table', { className: 'ct-table' });
    var head = h('tr', {}, [
      h('th', { text: '#' }), h('th', { text: 'Name' }), h('th', { text: 'Tag' }), h('th', { text: 'Company' }), h('th', { text: 'FIDE' }), h('th', { text: 'Byes' }),
      event.sections.length > 1 ? h('th', { text: 'Section' }) : null, h('th', { text: '' })
    ]);
    table.appendChild(h('thead', {}, [head]));
    var body = h('tbody');
    t.players.forEach(function (p, index) {
      var row = h('tr', { dataset: { id: String(p.id) } });
      row.appendChild(h('td', { className: 'ct-num ct-dim', text: String(index + 1) }));
      row.appendChild(h('td', { className: 'ct-cell-name' }, [h('input', { className: 'tool-input', type: 'text', maxLength: CT.LIMITS.maxNameLength, value: p.name, dataset: { field: 'name' }, attrs: { 'aria-label': 'Name' } })]));
      row.appendChild(h('td', { className: 'ct-cell-short' }, [h('input', { className: 'tool-input', type: 'text', maxLength: CT.LIMITS.maxTagLength, value: p.tag, dataset: { field: 'tag' }, attrs: { 'aria-label': 'Tag' } })]));
      row.appendChild(h('td', { className: 'ct-cell-short' }, [h('input', { className: 'tool-input', type: 'text', maxLength: CT.LIMITS.maxBaseLength, value: p.base, dataset: { field: 'base' }, attrs: { 'aria-label': 'Company rating' } })]));
      row.appendChild(h('td', { className: 'ct-cell-short' }, [h('input', { className: 'tool-input', type: 'number', min: CT.LIMITS.minRating, max: CT.LIMITS.maxRating, step: 1, value: Number.isInteger(p.fide) ? String(p.fide) : '', dataset: { field: 'fide' }, attrs: { 'aria-label': 'FIDE rating' } })]));
      row.appendChild(h('td', { className: 'ct-cell-short' }, [h('input', { className: 'tool-input', type: 'text', maxLength: 80, value: (p.byes || []).join(', '), placeholder: 'e.g. 3, 7', dataset: { field: 'byes' }, attrs: { 'aria-label': 'Rounds the player will miss' } })]));
      if (event.sections.length > 1) {
        var select = h('select', { className: 'tool-input', dataset: { field: 'section' }, attrs: { 'aria-label': 'Section' } });
        event.sections.forEach(function (section, si) {
          var option = h('option', { value: String(si), text: section.name });
          if (si === state.section) option.selected = true;
          if (section.status !== 'setup') option.disabled = true;
          select.appendChild(option);
        });
        row.appendChild(h('td', {}, [select]));
      }
      row.appendChild(h('td', {}, [h('button', { type: 'button', className: 'tool-button tool-button-danger', text: 'Remove', dataset: { action: 'remove' } })]));
      body.appendChild(row);
    });
    table.appendChild(body);
    ui.playersSetup.appendChild(table);
  }

  function onSetupTableChange(event) {
    var target = event.target;
    var row = target.closest('tr');
    var t = current();
    if (!row || !t || !target.dataset.field) return;
    var id = parseInt(row.dataset.id, 10);
    try {
      if (target.dataset.field === 'section') {
        var to = parseInt(target.value, 10);
        if (to !== state.section) {
          CT.moveToSection(state.event, state.section, id, to);
          commit('Moved the player to ' + state.event.sections[to].name + '.');
        }
        return;
      }
      var changes = {};
      changes[target.dataset.field] = target.value;
      CT.updatePlayer(t, id, changes);
      commit();
    } catch (error) {
      message(errorText(error), 'error');
      render();
    }
  }

  function onSetupTableClick(event) {
    var target = event.target.closest('button[data-action]');
    var row = target && target.closest('tr');
    var t = current();
    if (!target || !row || !t) return;
    if (target.dataset.action === 'remove') {
      try {
        CT.removePlayer(t, parseInt(row.dataset.id, 10));
        commit();
      } catch (error) {
        message(errorText(error), 'error');
      }
    }
  }

  function startSection() {
    var t = current();
    try {
      CT.start(t);
      state.view = 'pairings';
      state.round = null;
      commit('Started ' + t.name + '. Pair the first round when everyone is present.');
    } catch (error) {
      message(errorText(error), 'error');
    }
  }

  function renderSetup(t) {
    renderSymbols(t);
    renderSetupPlayers(t);
  }

  /* ------------------------------ running view ------------------------------ */

  function setView(view) {
    state.view = view;
    render();
  }

  function renderViewTabs(t) {
    Object.keys(ui.views).forEach(function (key) {
      var entry = ui.views[key];
      entry.tab.setAttribute('aria-selected', key === state.view ? 'true' : 'false');
      show(entry.panel, key === state.view);
    });
  }

  function selectedRoundIndex(t) {
    if (!t.rounds.length) return -1;
    if (state.round === null || state.round >= t.rounds.length || state.round < 0) return t.rounds.length - 1;
    return state.round;
  }

  /* The byes ticked for the next round of the current section. Seeded from
     the byes players asked for in advance the first time a round is shown,
     then kept as the organizer leaves it until the round is paired. */
  function byeSelection(t) {
    var next = t.rounds.length + 1;
    var entry = state.absent[state.section];
    if (!entry || entry.round !== next) {
      entry = { round: next, ids: {}, byeTo: null };
      CT.requestedFor(t, next, {}).forEach(function (id) { entry.ids[id] = true; });
      state.absent[state.section] = entry;
    }
    return entry;
  }

  function renderAttendance(t) {
    var canPair = t.status === 'running' && (!t.rounds.length || CT.roundComplete(t, t.rounds.length - 1));
    show(ui.attendance, canPair);
    if (!canPair) return;
    var next = t.rounds.length + 1;
    var full = t.rounds.length >= t.plannedRounds;
    ui.attendanceHeading.textContent = full ? 'Before the next round' : 'Byes for round ' + next;
    ui.pair.disabled = full;
    ui.pair.textContent = full ? 'All ' + t.plannedRounds + ' rounds are paired' : 'Pair round ' + next;
    show(ui.moreRounds, full);
    show(ui.finish, t.rounds.length > 0);
    renderAbsentList(t);
    renderAttendanceCount(t);
  }

  function renderAbsentList(t) {
    var next = t.rounds.length + 1;
    var filter = ui.absentFilter.value.trim().toLowerCase();
    var selection = byeSelection(t);
    ui.absentList.replaceChildren();
    var shown = 0;
    t.players.forEach(function (p) {
      if (p.status !== 'active' || p.joined > next) return;
      var label = playerLabel(p);
      if (filter && label.toLowerCase().indexOf(filter) < 0) return;
      shown += 1;
      var box = h('input', { type: 'checkbox', dataset: { id: String(p.id) } });
      box.checked = Boolean(selection.ids[p.id]);
      var asked = (p.byes || []).indexOf(next) >= 0;
      ui.absentList.appendChild(h('li', {}, [h('label', {}, [box, h('span', { text: label + (asked ? ' (asked)' : '') })])]));
    });
    if (!shown) ui.absentList.appendChild(h('li', { className: 'tool-note', text: filter ? 'No player matches.' : 'No active players.' }));
  }

  /* Says how many will be paired, and when that is odd, offers the choice
     of who sits out. */
  function renderAttendanceCount(t) {
    var next = t.rounds.length + 1;
    var selection = byeSelection(t);
    var playing = t.players.filter(function (p) { return p.status === 'active' && p.joined <= next && !selection.ids[p.id]; });
    var requested = Object.keys(selection.ids).length;
    var odd = playing.length % 2 === 1;
    var text = playing.length + (playing.length === 1 ? ' player' : ' players') + ' to pair';
    if (requested) text += ', ' + requested + ' on a requested bye (' + pointsLabel(CT.requestedByePoints(t, next - 1)) + ' point' + (CT.requestedByePoints(t, next - 1) === 1 ? '' : 's') + ')';
    if (odd) text += '. The number is odd, so one more sits out with the bye (' + pointsLabel(t.byePoints) + ' point' + (t.byePoints === 1 ? '' : 's') + ').';
    else text += '.';
    setStatus(ui.attendanceCount, text, '');
    show(ui.oddByeRow, odd);
    if (!odd) { selection.byeTo = null; return; }
    var state0 = CT.playerState(t);
    var rank = {};
    t.players.forEach(function (p) { rank[p.id] = p.rank; });
    var sorted = playing.slice().sort(function (a, b) { return state0[a.id].score - state0[b.id].score || rank[b.id] - rank[a.id]; });
    ui.oddBye.replaceChildren(h('option', { value: '', text: 'Automatic: the lowest-placed player who has not had a bye' }));
    sorted.forEach(function (p) {
      var option = h('option', { value: String(p.id), text: playerLabel(p) + ' (' + points(state0[p.id].score) + (state0[p.id].hadBye ? ', had a bye' : '') + ')' });
      if (selection.byeTo === p.id) option.selected = true;
      ui.oddBye.appendChild(option);
    });
    if (selection.byeTo !== null && !playing.some(function (p) { return p.id === selection.byeTo; })) selection.byeTo = null;
  }

  function onAbsentChange(event) {
    var box = event.target;
    if (!box || box.type !== 'checkbox' || !box.dataset.id) return;
    var t = current();
    var selection = byeSelection(t);
    var id = parseInt(box.dataset.id, 10);
    if (box.checked) selection.ids[id] = true;
    else delete selection.ids[id];
    renderAttendanceCount(t);
  }

  function onOddByeChange() {
    var t = current();
    var selection = byeSelection(t);
    selection.byeTo = ui.oddBye.value ? parseInt(ui.oddBye.value, 10) : null;
  }

  function pairNext() {
    var t = current();
    var selection = byeSelection(t);
    var absent = Object.keys(selection.ids).map(function (id) { return parseInt(id, 10); });
    try {
      var round = CT.pairNextRound(t, { absent: absent, byeTo: selection.byeTo });
      delete state.absent[state.section];
      state.round = t.rounds.length - 1;
      state.view = 'pairings';
      commit('Round ' + round.n + ' is paired: ' + round.pairings.length + (round.pairings.length === 1 ? ' board' : ' boards') + '.');
    } catch (error) {
      message(errorText(error), 'error');
    }
  }

  function addRound() {
    var t = current();
    try {
      CT.setPlannedRounds(t, t.plannedRounds + 1);
      state.event.settings.plannedRounds = Math.max(state.event.settings.plannedRounds, t.plannedRounds);
      commit('This section now has ' + t.plannedRounds + ' rounds.');
    } catch (error) {
      message(errorText(error), 'error');
    }
  }

  function finishSection() {
    var t = current();
    if (!window.confirm('Finish ' + t.name + ' after ' + t.rounds.length + (t.rounds.length === 1 ? ' round' : ' rounds') + '? Results can still be corrected after reopening it.')) return;
    try {
      CT.finish(t);
      state.view = 'standings';
      commit(t.name + ' is finished. The fitted ratings are in the Standings view.');
    } catch (error) {
      message(errorText(error), 'error');
    }
  }

  function reopenSection() {
    var t = current();
    try {
      CT.reopen(t);
      state.view = 'pairings';
      commit('Reopened ' + t.name + '.');
    } catch (error) {
      message(errorText(error), 'error');
    }
  }

  function renderRoundSelect(t) {
    ui.roundSelect.replaceChildren();
    var index = selectedRoundIndex(t);
    show(ui.roundSelect, t.rounds.length > 0);
    t.rounds.forEach(function (round, i) {
      var option = h('option', { value: String(i), text: 'Round ' + round.n + (i === t.rounds.length - 1 ? ' (current)' : '') });
      if (i === index) option.selected = true;
      ui.roundSelect.appendChild(option);
    });
  }

  function resultSelect(t, roundIndex, board, value, disabled) {
    var select = h('select', { className: 'tool-input', dataset: { board: String(board) }, attrs: { 'aria-label': 'Result on board ' + (board + 1) } });
    [''].concat(CT.RESULTS).forEach(function (code) {
      var option = h('option', { value: code, text: (code ? code + '  ' : '') + CT.RESULT_LABELS[code] });
      if (code === value) option.selected = true;
      select.appendChild(option);
    });
    select.disabled = disabled;
    return select;
  }

  function renderPairings(t) {
    var index = selectedRoundIndex(t);
    renderRoundSelect(t);
    ui.pairings.replaceChildren();
    ui.warnings.replaceChildren();
    show(ui.warnings, false);
    ui.byes.textContent = '';
    if (index < 0) {
      ui.pairings.appendChild(h('p', { className: 'tool-note', text: 'No round has been paired yet.' }));
      show(ui.printPairings, false);
      show(ui.copyPairings, false);
      show(ui.allForfeit, false);
      show(ui.undo, false);
      return;
    }
    var round = t.rounds[index];
    var players = {};
    t.players.forEach(function (p) { players[p.id] = p; });
    var before = CT.playerState(t, index);
    if (round.warnings.length) {
      round.warnings.forEach(function (text) { ui.warnings.appendChild(h('li', { text: text })); });
      show(ui.warnings, true);
    }
    var table = h('table', { className: 'ct-table' });
    table.appendChild(h('thead', {}, [h('tr', {}, [h('th', { className: 'ct-num', text: 'Board' }), h('th', { text: 'White' }), h('th', { className: 'ct-num', text: 'Pts' }), h('th', { text: 'Black' }), h('th', { className: 'ct-num', text: 'Pts' }), h('th', { text: 'Result' })])]));
    var body = h('tbody');
    var editable = t.status !== 'finished';
    round.pairings.forEach(function (pair, board) {
      var w = players[pair[0]];
      var b = players[pair[1]];
      body.appendChild(h('tr', {}, [
        h('td', { className: 'ct-num', text: String(board + 1) }),
        h('td', { text: w ? playerLabel(w) : '?' }),
        h('td', { className: 'ct-num ct-dim', text: points(before[pair[0]] ? before[pair[0]].score : 0) }),
        h('td', { text: b ? playerLabel(b) : '?' }),
        h('td', { className: 'ct-num ct-dim', text: points(before[pair[1]] ? before[pair[1]].score : 0) }),
        h('td', {}, [resultSelect(t, index, board, pair[2], !editable)])
      ]));
    });
    table.appendChild(body);
    ui.pairings.appendChild(table);
    ui.byes.textContent = byesText(t, index, round, players);
    var last = index === t.rounds.length - 1;
    var hasResults = round.pairings.some(function (pair) { return Boolean(pair[2]); });
    var hasOpen = round.pairings.some(function (pair) { return !pair[2]; });
    show(ui.printPairings, true);
    show(ui.copyPairings, true);
    show(ui.allForfeit, editable && hasOpen);
    show(ui.undo, editable && last && !hasResults);
  }

  function onResultChange(event) {
    var select = event.target;
    if (!select || select.tagName !== 'SELECT' || !select.dataset.board) return;
    var t = current();
    var index = selectedRoundIndex(t);
    try {
      CT.setResult(t, index, parseInt(select.dataset.board, 10), select.value);
      saveLocal();
      scheduleCloudSave();
      renderAttendance(t);
      var round = t.rounds[index];
      var last = index === t.rounds.length - 1;
      var hasResults = round.pairings.some(function (pair) { return Boolean(pair[2]); });
      var hasOpen = round.pairings.some(function (pair) { return !pair[2]; });
      show(ui.allForfeit, hasOpen);
      show(ui.undo, last && !hasResults);
      if (!last) message('Result changed in an earlier round. Standings are recomputed; the pairings already made stay as they are.', 'ok');
      else if (!hasOpen) message('Every result of round ' + round.n + ' is in.', 'ok');
    } catch (error) {
      message(errorText(error), 'error');
      render();
    }
  }

  function markUnplayed() {
    var t = current();
    var index = selectedRoundIndex(t);
    if (index < 0) return;
    var round = t.rounds[index];
    var open = round.pairings.filter(function (pair) { return !pair[2]; }).length;
    if (!open) return;
    if (!window.confirm('Mark ' + open + (open === 1 ? ' unplayed game' : ' unplayed games') + ' of round ' + round.n + ' as both absent? Neither player scores.')) return;
    try {
      round.pairings.forEach(function (pair, board) { if (!pair[2]) CT.setResult(t, index, board, '-/-'); });
      commit('Round ' + round.n + ' is complete.');
    } catch (error) {
      message(errorText(error), 'error');
    }
  }

  function undoPairing() {
    var t = current();
    if (!window.confirm('Undo the pairing of round ' + t.rounds.length + '? You can pair it again afterwards.')) return;
    try {
      CT.undoLastRound(t);
      state.round = null;
      commit('The pairing was undone.');
    } catch (error) {
      message(errorText(error), 'error');
    }
  }

  /* "Sits out with the bye (1): X. Requested byes (½): Y, Z." */
  function byesText(t, index, round, players) {
    var sat = [];
    var asked = [];
    round.byes.forEach(function (bye) {
      var p = players[bye[0]];
      if (!p) return;
      if (bye[1] === 'bye') sat.push(playerLabel(p));
      else asked.push(playerLabel(p));
    });
    var parts = [];
    if (sat.length) parts.push('Sits out with the bye (' + points(t.byePoints) + '): ' + sat.join(', ') + '.');
    if (asked.length) parts.push('Requested byes (' + points(CT.requestedByePoints(t, index)) + '): ' + asked.join(', ') + '.');
    return parts.join(' ');
  }

  function pairingsText(t, index) {
    var round = t.rounds[index];
    var players = {};
    t.players.forEach(function (p) { players[p.id] = p; });
    var lines = [state.event.name + ' · ' + t.name + ' · Round ' + round.n];
    round.pairings.forEach(function (pair, board) {
      var w = players[pair[0]];
      var b = players[pair[1]];
      lines.push((board + 1) + '. ' + (w ? playerLabel(w) : '?') + ' vs ' + (b ? playerLabel(b) : '?') + (pair[2] ? '  ' + pair[2] : ''));
    });
    var byes = byesText(t, index, round, players);
    if (byes) lines.push(byes);
    return lines.join('\n');
  }

  function printPairingsSheet() {
    var t = current();
    var index = selectedRoundIndex(t);
    if (index < 0) return;
    var round = t.rounds[index];
    var players = {};
    t.players.forEach(function (p) { players[p.id] = p; });
    var table = h('table');
    table.appendChild(h('thead', {}, [h('tr', {}, [h('th', { text: 'Board' }), h('th', { text: 'White' }), h('th', { text: 'Black' }), h('th', { text: 'Result' })])]));
    var body = h('tbody');
    round.pairings.forEach(function (pair, board) {
      var w = players[pair[0]];
      var b = players[pair[1]];
      body.appendChild(h('tr', {}, [h('td', { text: String(board + 1) }), h('td', { text: w ? playerLabel(w) : '?' }), h('td', { text: b ? playerLabel(b) : '?' }), h('td', { text: pair[2] || '' })]));
    });
    table.appendChild(body);
    printSheet(state.event.name + ' · ' + t.name + ' · Round ' + round.n, [state.event.tc, byesText(t, index, round, players)].filter(Boolean).join(' · '), table);
  }

  function printSheet(title, subtitle, table) {
    ui.print.replaceChildren(h('h1', { text: title }), subtitle ? h('p', { text: subtitle }) : null, table);
    document.body.classList.add('ct-printing');
    var cleanup = function () {
      document.body.classList.remove('ct-printing');
      ui.print.replaceChildren();
    };
    window.addEventListener('afterprint', cleanup, { once: true });
    try { window.print(); }
    catch (error) { cleanup(); message('Printing is not available in this browser.', 'error'); return; }
    window.setTimeout(cleanup, 1000);
  }

  /* ------------------------------ standings view ------------------------------ */

  function standingsRows(t) {
    var rows = CT.standings(t);
    var sets = CT.ratings(t);
    rows.forEach(function (row) {
      row.rating = CT.formatRating(t, row.id, sets.running);
      row.final = sets.fitted ? CT.formatRating(t, row.id, sets.fitted) : '';
    });
    return { rows: rows, sets: sets };
  }

  function renderStandings(t) {
    var data = standingsRows(t);
    ui.standings.replaceChildren();
    if (!t.players.length) return;
    var finished = t.status === 'finished';
    var table = h('table', { className: 'ct-table' });
    var headCells = [h('th', { className: 'ct-num', text: '#' }), h('th', { text: 'Player' }), h('th', { text: 'Start' }), h('th', { className: 'ct-num', text: 'Pts' }), h('th', { className: 'ct-num', text: 'BH1' }), h('th', { className: 'ct-num', text: 'BH' }), h('th', { className: 'ct-num', text: 'SB' }), h('th', { className: 'ct-num', text: 'Games' }), h('th', { text: 'Rating' })];
    if (finished) headCells.push(h('th', { text: 'Final' }));
    table.appendChild(h('thead', {}, [h('tr', {}, headCells)]));
    var body = h('tbody');
    data.rows.forEach(function (row) {
      var cells = [
        h('td', { className: 'ct-num', text: String(row.place) }),
        h('td', { className: row.status === 'withdrawn' ? 'ct-withdrawn' : '', text: playerLabel(row) + (row.status === 'withdrawn' ? ' (withdrawn)' : '') }),
        h('td', { className: 'ct-dim', text: startLabel(row) }),
        h('td', { className: 'ct-num', text: points(row.points) }),
        h('td', { className: 'ct-num ct-dim', text: String(row.bh1) }),
        h('td', { className: 'ct-num ct-dim', text: String(row.bh) }),
        h('td', { className: 'ct-num ct-dim', text: String(row.sb) }),
        h('td', { className: 'ct-num ct-dim', text: String(row.games) }),
        h('td', { text: row.rating })
      ];
      if (finished) cells.push(h('td', { text: row.final }));
      body.appendChild(h('tr', {}, cells));
    });
    table.appendChild(body);
    ui.standings.appendChild(table);
    renderFinal(t, data.sets);
  }

  function standingsText(t, separator) {
    var data = standingsRows(t);
    var finished = t.status === 'finished';
    var head = ['Place', 'Name', 'Tag', 'Start', 'Points', 'Buchholz cut 1', 'Buchholz', 'Sonneborn-Berger', 'Games', 'Rating'];
    if (finished) head.push('Final rating');
    var lines = [head];
    data.rows.forEach(function (row) {
      var line = [String(row.place), row.name, row.tag, startLabel(row), String(row.points), String(row.bh1), String(row.bh), String(row.sb), String(row.games), row.rating];
      if (finished) line.push(row.final);
      lines.push(line);
    });
    return lines.map(function (line) {
      return line.map(function (cell) { return separator === ',' ? csvCell(cell) : String(cell).replace(/\t/g, ' '); }).join(separator);
    }).join(separator === ',' ? '\r\n' : '\n');
  }

  /* A spreadsheet treats a leading =, +, -, or @ as a formula, so a cell
     that starts with one is prefixed with an apostrophe. */
  function csvCell(value) {
    var text = String(value === null || value === undefined ? '' : value);
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function printStandingsSheet() {
    var t = current();
    var data = standingsRows(t);
    var finished = t.status === 'finished';
    var table = h('table');
    var headCells = [h('th', { text: '#' }), h('th', { text: 'Player' }), h('th', { text: 'Pts' }), h('th', { text: 'BH1' }), h('th', { text: 'BH' }), h('th', { text: 'SB' }), h('th', { text: 'Rating' })];
    if (finished) headCells.push(h('th', { text: 'Final' }));
    table.appendChild(h('thead', {}, [h('tr', {}, headCells)]));
    var body = h('tbody');
    data.rows.forEach(function (row) {
      var cells = [h('td', { text: String(row.place) }), h('td', { text: playerLabel(row) }), h('td', { text: points(row.points) }), h('td', { text: String(row.bh1) }), h('td', { text: String(row.bh) }), h('td', { text: String(row.sb) }), h('td', { text: row.rating })];
      if (finished) cells.push(h('td', { text: row.final }));
      body.appendChild(h('tr', {}, cells));
    });
    table.appendChild(body);
    printSheet(state.event.name + ' · ' + t.name + ' · Standings after round ' + t.rounds.length, state.event.tc, table);
  }

  function renderFinal(t, sets) {
    var finished = t.status === 'finished';
    show(ui.final, finished);
    if (!finished) return;
    var fitted = sets.fitted;
    ui.finalNote.textContent = fitted.known
      ? 'This section holds players with known ratings, so each label now has an estimated value on the FIDE scale, shown in parentheses after every offset.'
      : 'Nobody in this section started from a known rating, so every label is an unknown point on the scale and offsets are measured from the average of that label’s players. Pin a label below if you learn one player’s FIDE rating.';
    ui.finalSymbols.replaceChildren();
    Object.keys(fitted.symbols).sort().forEach(function (symbol) {
      var info = fitted.symbols[symbol];
      var resolved = CT.resolvedSymbolValue(t, symbol, fitted);
      var text;
      if (t.anchor && t.anchor.symbol === symbol) text = symbol + ' = ' + resolved + ' (pinned)';
      else if (info.source === 'declared') text = symbol + ' = ' + Math.round(info.value) + ' (given)';
      else if (info.source === 'estimated') text = symbol + ' ≈ ' + Math.round(info.value) + ' (estimated)';
      else text = symbol + ': unknown';
      ui.finalSymbols.appendChild(h('span', { text: text }));
    });
    var symbols = Object.keys(t.symbols).filter(function (symbol) { return !Number.isFinite(t.symbols[symbol]); }).sort();
    ui.anchorSymbol.replaceChildren();
    symbols.forEach(function (symbol) {
      var option = h('option', { value: symbol, text: symbol });
      if (t.anchor && t.anchor.symbol === symbol) option.selected = true;
      ui.anchorSymbol.appendChild(option);
    });
    renderAnchorPlayers(t);
    if (t.anchor) ui.anchorRating.value = String(t.anchor.rating);
    show(ui.anchorForm, symbols.length > 0);
  }

  function renderAnchorPlayers(t) {
    var symbol = ui.anchorSymbol.value;
    ui.anchorPlayer.replaceChildren();
    t.players.filter(function (p) { return p.base === symbol && !CT.knownStart(p); }).forEach(function (p) {
      var option = h('option', { value: String(p.id), text: playerLabel(p) });
      if (t.anchor && t.anchor.playerId === p.id) option.selected = true;
      ui.anchorPlayer.appendChild(option);
    });
  }

  function applyAnchor(event) {
    event.preventDefault();
    var t = current();
    try {
      CT.setAnchor(t, ui.anchorSymbol.value, parseInt(ui.anchorPlayer.value, 10), ui.anchorRating.value);
      commit('Pinned ' + ui.anchorSymbol.value + '.');
    } catch (error) {
      message(errorText(error), 'error');
    }
  }

  function clearAnchor() {
    var t = current();
    CT.setAnchor(t, null);
    ui.anchorRating.value = '';
    commit('The pin was removed.');
  }

  /* ------------------------------ players view ------------------------------ */

  function renderPlayersList(t) {
    ui.playersList.replaceChildren();
    var rows = CT.standings(t);
    var sets = CT.ratings(t);
    var open = state.openHistory[state.section] || {};
    var table = h('table', { className: 'ct-table' });
    table.appendChild(h('thead', {}, [h('tr', {}, [h('th', { className: 'ct-num', text: 'Rank' }), h('th', { text: 'Player' }), h('th', { text: 'Start' }), h('th', { className: 'ct-num', text: 'Pts' }), h('th', { text: 'Rating' }), h('th', { text: 'Byes' }), h('th', { text: 'Status' }), h('th', { text: '' })])]));
    var body = h('tbody');
    rows.sort(function (a, b) { return a.rank - b.rank; });
    rows.forEach(function (row) {
      var p = t.players.filter(function (entry) { return entry.id === row.id; })[0];
      var withdrawn = p.status === 'withdrawn';
      var actions = h('div', { className: 'tool-actions' }, [
        h('button', { type: 'button', className: 'tool-button', text: open[p.id] ? 'Hide games' : 'Games', dataset: { action: 'history', id: String(p.id) } }),
        t.status !== 'finished' ? h('button', { type: 'button', className: 'tool-button' + (withdrawn ? '' : ' tool-button-danger'), text: withdrawn ? 'Reinstate' : 'Withdraw', dataset: { action: withdrawn ? 'reinstate' : 'withdraw', id: String(p.id) } }) : null
      ]);
      actions.style.margin = '0';
      var byesInput = h('input', { className: 'tool-input', type: 'text', maxLength: 80, value: (p.byes || []).join(', '), placeholder: 'e.g. 3, 7', dataset: { field: 'byes', id: String(p.id) }, attrs: { 'aria-label': 'Rounds ' + p.name + ' will miss' } });
      byesInput.disabled = t.status === 'finished';
      body.appendChild(h('tr', {}, [
        h('td', { className: 'ct-num ct-dim', text: String(p.rank) }),
        h('td', { className: withdrawn ? 'ct-withdrawn' : '', text: playerLabel(p) }),
        h('td', { className: 'ct-dim', text: startLabel(p) }),
        h('td', { className: 'ct-num', text: points(row.points) }),
        h('td', { text: CT.formatRating(t, p.id, sets.running) }),
        h('td', { className: 'ct-cell-short' }, [byesInput]),
        h('td', { className: 'ct-dim', text: withdrawn ? 'Withdrawn' : (p.joined > 1 ? 'Joined round ' + p.joined : 'Active') }),
        h('td', {}, [actions])
      ]));
      if (open[p.id]) {
        var list = h('ul', { className: 'ct-history' });
        var games = CT.history(t, p.id);
        if (!games.length) list.appendChild(h('li', { text: 'No rounds yet.' }));
        games.forEach(function (g) {
          var text = 'Round ' + g.round + ': ';
          if (g.opponent) text += (g.color === 'w' ? 'White vs ' : 'Black vs ') + g.opponent + (g.result ? ', ' + g.result + ' (' + points(g.points) + ')' : ', not played yet');
          else text += g.note + (g.points ? ' (' + points(g.points) + ')' : '');
          list.appendChild(h('li', { text: text }));
        });
        var cell = h('td', { attrs: { colspan: '8' } }, [list]);
        body.appendChild(h('tr', {}, [cell]));
      }
    });
    table.appendChild(body);
    ui.playersList.appendChild(table);
  }

  function onPlayersListChange(event) {
    var input = event.target;
    if (!input || input.dataset.field !== 'byes' || !input.dataset.id) return;
    var t = current();
    try {
      CT.updatePlayer(t, parseInt(input.dataset.id, 10), { byes: input.value });
      delete state.absent[state.section];
      commit('Byes saved.');
    } catch (error) {
      message(errorText(error), 'error');
      renderPlayersList(t);
    }
  }

  function onPlayersListClick(event) {
    var target = event.target.closest('button[data-action]');
    if (!target) return;
    var t = current();
    var id = parseInt(target.dataset.id, 10);
    try {
      if (target.dataset.action === 'history') {
        if (!state.openHistory[state.section]) state.openHistory[state.section] = {};
        if (state.openHistory[state.section][id]) delete state.openHistory[state.section][id];
        else state.openHistory[state.section][id] = true;
        renderPlayersList(t);
        return;
      }
      var p = t.players.filter(function (entry) { return entry.id === id; })[0];
      if (target.dataset.action === 'withdraw') {
        if (!window.confirm('Withdraw ' + (p ? p.name : 'this player') + ' from the rest of the section?')) return;
        CT.withdraw(t, id);
        commit((p ? p.name : 'The player') + ' is withdrawn.');
      } else if (target.dataset.action === 'reinstate') {
        CT.reinstate(t, id);
        commit((p ? p.name : 'The player') + ' is back in the section.');
      }
    } catch (error) {
      message(errorText(error), 'error');
    }
  }

  function addLatePlayer(event) {
    event.preventDefault();
    var t = current();
    try {
      if (CT.eventPlayerCount(state.event) >= CT.LIMITS.maxPlayers) throw new Error('The tournament already holds ' + CT.LIMITS.maxPlayers + ' players.');
      var p = CT.addPlayer(t, { name: ui.lateName.value, tag: ui.lateTag.value, base: ui.lateBase.value || defaultBase(), fide: ui.lateFide.value });
      ui.lateForm.reset();
      commit('Added ' + p.name + '. They join from round ' + p.joined + '.');
    } catch (error) {
      message(errorText(error), 'error');
    }
  }

  /* ------------------------------ crosstable view ------------------------------ */

  function renderCrosstable(t) {
    ui.crosstable.replaceChildren();
    var rows = CT.standings(t);
    var cells = CT.crosstable(t);
    var table = h('table', { className: 'ct-table ct-crosstable' });
    var head = [h('th', { className: 'ct-num', text: '#' }), h('th', { text: 'Player' })];
    rows.forEach(function (row) { head.push(h('th', { className: 'ct-num', text: String(row.place) })); });
    head.push(h('th', { className: 'ct-num', text: 'Pts' }));
    table.appendChild(h('thead', {}, [h('tr', {}, head)]));
    var body = h('tbody');
    rows.forEach(function (row) {
      var line = [h('td', { className: 'ct-num', text: String(row.place) }), h('td', { text: playerLabel(row) })];
      rows.forEach(function (column) {
        if (column.id === row.id) { line.push(h('td', { className: 'ct-self' })); return; }
        var value = cells[row.id][column.id];
        line.push(h('td', { className: 'ct-num', text: value === undefined ? '' : (value === 0.5 ? '½' : String(value)) }));
      });
      line.push(h('td', { className: 'ct-num', text: points(row.points) }));
      body.appendChild(h('tr', {}, line));
    });
    table.appendChild(body);
    ui.crosstable.appendChild(table);
  }

  /* ------------------------------ clipboard ------------------------------ */

  function selectForManualCopy(text) {
    ui.copyFallback.value = text;
    show(ui.copyBox, true);
    ui.copyFallback.focus();
    ui.copyFallback.select();
    message('Copying is blocked in this browser. The text is selected below, so press Command + C or Ctrl + C to copy it.', 'error');
  }

  function copyText(text, trigger) {
    if (!window.isSecureContext || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      selectForManualCopy(text);
      return;
    }
    navigator.clipboard.writeText(text).then(function () {
      show(ui.copyBox, false);
      flash(trigger, 'Copied');
    }, function () {
      selectForManualCopy(text);
    });
  }

  /* ------------------------------ top level ------------------------------ */

  function renderRunning(t) {
    renderViewTabs(t);
    if (state.view === 'pairings') {
      renderAttendance(t);
      renderPairings(t);
    } else if (state.view === 'standings') {
      renderStandings(t);
    } else if (state.view === 'players') {
      show(ui.lateForm, t.status === 'running');
      renderPlayersList(t);
    } else if (state.view === 'crosstable') {
      renderCrosstable(t);
    }
  }

  function render() {
    var event = state.event;
    show(ui.work, Boolean(event));
    renderAccount();
    if (!event) return;
    if (state.section >= event.sections.length) state.section = 0;
    renderSettings();
    renderSectionTabs();
    renderSaveStatus();
    var t = current();
    var setup = t.status === 'setup';
    show(ui.setup, setup);
    show(ui.running, !setup);
    show(ui.removeSection, setup && event.sections.length > 1);
    if (setup) renderSetup(t);
    else renderRunning(t);
  }

  function newTournament() {
    if (state.event && !window.confirm('Start a new tournament? The one open now stays in your account only if it was saved there; save it as a file first if you need a copy.')) return;
    if (state.cloudTimer) { window.clearTimeout(state.cloudTimer); state.cloudTimer = null; }
    state.event = CT.createEvent({ name: 'Chess tournament', plannedRounds: 9 });
    state.slot = null;
    state.section = 0;
    state.view = 'pairings';
    state.round = null;
    state.absent = {};
    state.openHistory = {};
    setStatus(ui.saveStatus, 'Kept in this browser only.', '');
    commit('New tournament. Name it, add players, and start the section.');
    ui.name.focus();
    ui.name.select();
  }

  function closeTournament() {
    if (!state.event) return;
    var warning = state.slot === null
      ? 'Close this tournament? It is not saved to your account, so it will be gone from this browser unless you saved it as a file.'
      : 'Close this tournament? It stays in your account and can be opened again from the list.';
    if (!window.confirm(warning)) return;
    if (state.cloudTimer) { window.clearTimeout(state.cloudTimer); state.cloudTimer = null; }
    state.event = null;
    state.slot = null;
    saveLocal();
    setStatus(ui.saveStatus, '', '');
    render();
    message('Closed.', 'ok');
  }

  /* ------------------------------ wiring ------------------------------ */

  ui.newButton.addEventListener('click', newTournament);
  ui.openFile.addEventListener('click', function () { ui.openInput.value = ''; ui.openInput.click(); });
  ui.openInput.addEventListener('change', function () { openFile(ui.openInput.files && ui.openInput.files[0]); });
  ui.savedRefresh.addEventListener('click', function () { refreshSaved(); });
  ui.signInGithub.addEventListener('click', function () { signIn('github.com', ui.signInGithub); });
  ui.signInGoogle.addEventListener('click', function () { signIn('google.com', ui.signInGoogle); });

  ui.settingsForm.addEventListener('submit', function (event) { event.preventDefault(); applySettingsForm(); });
  ui.settingsForm.addEventListener('change', applySettingsForm);
  ui.addSection.addEventListener('click', addSectionFromForm);
  ui.sectionName.addEventListener('keydown', function (event) { if (event.key === 'Enter') { event.preventDefault(); addSectionFromForm(); } });
  ui.saveAccount.addEventListener('click', saveToAccount);
  ui.exportButton.addEventListener('click', exportFile);
  ui.deleteAccount.addEventListener('click', function () {
    var entry = state.saved.filter(function (e) { return e.slot === state.slot; })[0] || { slot: state.slot, name: state.event ? state.event.name : '' };
    deleteFromAccount(entry, ui.deleteAccount);
  });
  ui.close.addEventListener('click', closeTournament);

  ui.rosterAdd.addEventListener('click', function () {
    var text = ui.roster.value;
    if (!text.trim()) { setStatus(ui.rosterStatus, 'Paste at least one name first.', 'error'); ui.roster.focus(); return; }
    addPlayersFromText(text, '');
  });
  ui.rosterBrowse.addEventListener('click', function () { ui.rosterFile.value = ''; ui.rosterFile.click(); });
  ui.rosterFile.addEventListener('change', function () { readRosterFile(ui.rosterFile.files && ui.rosterFile.files[0]); });
  ['dragenter', 'dragover'].forEach(function (name) {
    ui.rosterDrop.addEventListener(name, function (event) { event.preventDefault(); ui.rosterDrop.setAttribute('data-active', 'true'); });
  });
  ['dragleave', 'drop'].forEach(function (name) {
    ui.rosterDrop.addEventListener(name, function (event) { event.preventDefault(); ui.rosterDrop.removeAttribute('data-active'); });
  });
  ui.rosterDrop.addEventListener('drop', function (event) {
    var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) readRosterFile(file);
  });
  ui.playersSetup.addEventListener('change', onSetupTableChange);
  ui.playersSetup.addEventListener('click', onSetupTableClick);
  ui.start.addEventListener('click', startSection);
  ui.removeSection.addEventListener('click', removeCurrentSection);

  Object.keys(ui.views).forEach(function (key) {
    ui.views[key].tab.addEventListener('click', function () { setView(key); });
  });
  ui.absentFilter.addEventListener('input', function () { var t = current(); if (t) renderAbsentList(t); });
  ui.absentList.addEventListener('change', onAbsentChange);
  ui.oddBye.addEventListener('change', onOddByeChange);
  ui.playersList.addEventListener('change', onPlayersListChange);
  ui.pair.addEventListener('click', pairNext);
  ui.moreRounds.addEventListener('click', addRound);
  ui.finish.addEventListener('click', finishSection);
  ui.roundSelect.addEventListener('change', function () { state.round = parseInt(ui.roundSelect.value, 10); var t = current(); if (t) renderPairings(t); });
  ui.pairings.addEventListener('change', onResultChange);
  ui.printPairings.addEventListener('click', printPairingsSheet);
  ui.copyPairings.addEventListener('click', function () { var t = current(); var i = selectedRoundIndex(t); if (i >= 0) copyText(pairingsText(t, i), ui.copyPairings); });
  ui.allForfeit.addEventListener('click', markUnplayed);
  ui.undo.addEventListener('click', undoPairing);
  ui.printStandings.addEventListener('click', printStandingsSheet);
  ui.copyStandings.addEventListener('click', function () { copyText(standingsText(current(), '\t'), ui.copyStandings); });
  ui.csvStandings.addEventListener('click', function () {
    var t = current();
    download(slug(state.event.name) + '-' + slug(t.name) + '-standings.csv', standingsText(t, ','), 'text/csv');
  });
  ui.anchorForm.addEventListener('submit', applyAnchor);
  ui.anchorSymbol.addEventListener('change', function () { renderAnchorPlayers(current()); });
  ui.anchorClear.addEventListener('click', clearAnchor);
  ui.reopen.addEventListener('click', reopenSection);
  ui.lateForm.addEventListener('submit', addLatePlayer);
  ui.playersList.addEventListener('click', onPlayersListClick);

  window.addEventListener('pagehide', function () {
    state.downloadUrls.slice().forEach(releaseDownload);
  });

  ui.defaultBase.value = defaultBase();
  restoreLocal();
  render();

  if (!window.siteAuth) {
    renderAccount();
    return;
  }

  function onIdentity(user) {
    var previous = state.user;
    state.user = user;
    renderAccount();
    if (!user) { state.saved = []; renderSaved(); return; }
    if (previous && previous.uid === user.uid) return;
    refreshSaved();
  }

  window.siteAuth.ready().catch(function () { return null; }).then(function () {
    window.siteAuth.onChange(onIdentity);
  });
})();
