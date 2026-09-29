/* CISSP Exam Simulator page.
 *
 * Draws what cissp-exam-engine.js decides. Trust boundaries:
 *   - The question bank is read from the database path `cissp-pool`, which
 *     the rules open to the site owner's account alone. It is validated by
 *     the engine before use, rendered only through textContent, and never
 *     written to this device, so a shared computer keeps no copy.
 *   - A session in progress and the last results are kept in localStorage.
 *     They hold question ids and numbers only, no question text, and a saved
 *     session is re-checked against the loaded bank before it is resumed.
 *   - Nothing is written to the database.
 */
(function () {
  'use strict';

  var CE = window.CisspExam;
  var POOL_PATH = 'cissp-pool';
  var SESSION_KEY = 'cissp-exam-session';
  var HISTORY_KEY = 'cissp-exam-history';
  var HISTORY_MAX = 20;
  var MODE_NAMES = { exam: 'Exam simulation', drill: 'Mastery drill', practice: 'Random practice' };

  var $ = function (id) { return document.getElementById(id); };
  var ui = {
    accessMessage: $('cx-access-message'), auth: $('cx-auth'), access: $('cx-access'),
    signinGithub: $('cx-signin-github'), signinGoogle: $('cx-signin-google'),
    home: $('cx-home'), resume: $('cx-resume'), resumeText: $('cx-resume-text'),
    resumeGo: $('cx-resume-go'), resumeDiscard: $('cx-resume-discard'),
    startExam: $('cx-start-exam'), startDrill: $('cx-start-drill'), startPractice: $('cx-start-practice'),
    drillDomains: $('cx-drill-domains'), practiceDomains: $('cx-practice-domains'),
    count: $('cx-count'), other: $('cx-other'), history: $('cx-history'),
    question: $('cx-question'), progress: $('cx-progress'), meta: $('cx-meta'), timer: $('cx-timer'),
    stem: $('cx-stem'), choices: $('cx-choices'), feedback: $('cx-feedback'),
    verdict: $('cx-verdict'), answer: $('cx-answer'), why: $('cx-why'),
    questionStatus: $('cx-question-status'), submit: $('cx-submit'), next: $('cx-next'),
    reveal: $('cx-reveal'), selfRight: $('cx-self-right'), selfWrong: $('cx-self-wrong'), stop: $('cx-stop'),
    result: $('cx-result'), resultTitle: $('cx-result-title'), resultHeadline: $('cx-result-headline'),
    resultNote: $('cx-result-note'), resultTable: $('cx-result-table'), standingHead: $('cx-standing-head'),
    reviewTitle: $('cx-review-title'), review: $('cx-review'), homeButton: $('cx-home-button')
  };

  var state = {
    user: null, pool: null, session: null, loading: false,
    selected: null, awaitingNext: false, timer: null
  };

  /* ------------------------------ small helpers ------------------------------ */

  function h(tag, props, children) {
    var el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        if (k === 'text') el.textContent = props[k];
        else if (k === 'className') el.className = props[k];
        else el.setAttribute(k, props[k]);
      });
    }
    (children || []).forEach(function (c) { if (c) el.appendChild(c); });
    return el;
  }

  function show(el, on) { el.hidden = !on; }

  function setStatus(el, text, tone) {
    el.textContent = text || '';
    if (tone) el.setAttribute('data-tone', tone);
    else el.removeAttribute('data-tone');
  }

  function rng() {
    var a = new Uint32Array(1);
    window.crypto.getRandomValues(a);
    return a[0] / 4294967296;
  }

  function lsGet(key) {
    try { var v = window.localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function lsSet(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode or full: the session simply is not kept */ }
  }
  function lsDel(key) { try { window.localStorage.removeItem(key); } catch (e) { /* nothing to clear */ } }

  function letter(i) { return String.fromCharCode(65 + i); }
  function percent(a, b) { return b ? Math.round((100 * a) / b) + '%' : 'n/a'; }
  function clock(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var hh = Math.floor(s / 3600);
    var mm = Math.floor((s % 3600) / 60);
    var ss = s % 60;
    return hh + ':' + (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
  }
  function when(ms) {
    try { return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return ''; }
  }

  /* ------------------------------ access ------------------------------ */

  function renderAccess(text, tone, offerSignIn) {
    setStatus(ui.accessMessage, text, tone);
    show(ui.auth, Boolean(offerSignIn));
  }

  function onIdentity(user) {
    state.user = user;
    if (!user) {
      state.pool = null;
      stopTimer();
      showView('none');
      renderAccess('Sign in to open the question bank. It is private, so it opens only for the account it belongs to.', '', true);
      return;
    }
    if (state.pool) return;
    loadPool();
  }

  function loadPool() {
    if (state.loading) return;
    var db = window.siteAuth && typeof window.siteAuth.db === 'function' ? window.siteAuth.db() : null;
    if (!db) { renderAccess('The question bank cannot be reached right now. Reload the page to try again.', 'error', false); return; }
    state.loading = true;
    renderAccess('Loading the question bank.', '', false);
    db.ref(POOL_PATH).once('value').then(function (snap) {
      state.pool = CE.validatePool(snap.val());
      var n = state.pool.questions.length;
      renderAccess('Question bank loaded: ' + n.toLocaleString() + ' questions.', 'ok', false);
      buildDomainPickers();
      goHome();
    }).catch(function (error) {
      var denied = error && /permission|denied/i.test(String(error.code || error.message || ''));
      renderAccess(denied
        ? 'This account does not have access to the question bank. It is private to the site owner.'
        : (error && error.message && /question/i.test(error.message) ? error.message : 'The question bank could not be loaded. Check the connection and reload the page.'), 'error', false);
    }).then(function () { state.loading = false; });
  }

  function signIn(provider, trigger) {
    if (!window.siteAuth) return;
    trigger.disabled = true;
    window.siteAuth.signIn(provider).catch(function () { trigger.disabled = false; });
  }

  /* ------------------------------ home ------------------------------ */

  function buildDomainPickers() {
    var counts = CE.counts(state.pool);
    [ui.drillDomains, ui.practiceDomains].forEach(function (fs) {
      var legend = fs.querySelector('legend');
      fs.replaceChildren(legend);
      Object.keys(CE.DOMAINS).forEach(function (d) {
        var box = h('input', { type: 'checkbox', value: d });
        box.checked = true;
        fs.appendChild(h('label', null, [box, document.createTextNode(' ' + d + '. ' + CE.DOMAINS[d] + ' (' + counts[d] + ')')]));
      });
    });
  }

  function chosenDomains(fs) {
    return Array.prototype.slice.call(fs.querySelectorAll('input:checked')).map(function (b) { return Number(b.value); });
  }

  function showView(which) {
    show(ui.access, which !== 'question');
    show(ui.home, which === 'home');
    show(ui.question, which === 'question');
    show(ui.result, which === 'result');
  }

  function goHome() {
    stopTimer();
    state.session = null;
    var saved = lsGet(SESSION_KEY);
    if (saved && !CE.validSession(state.pool, saved)) { lsDel(SESSION_KEY); saved = null; }
    show(ui.resume, Boolean(saved));
    if (saved) {
      var answered = saved.responses.length;
      ui.resumeText.textContent = MODE_NAMES[saved.mode] + ' started ' + when(saved.startedAt) + ', ' + answered + ' answered so far.' +
        (saved.mode === 'exam' ? ' The exam clock kept running while you were away.' : '');
    }
    renderHistory();
    showView('home');
  }

  function renderHistory() {
    var list = lsGet(HISTORY_KEY) || [];
    ui.history.replaceChildren();
    if (!Array.isArray(list) || !list.length) {
      ui.history.appendChild(h('li', { className: 'tool-note', text: 'No finished sessions in this browser yet.' }));
      return;
    }
    list.forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      var li = h('li');
      var head = h('div', { className: 'tool-list-head' });
      head.appendChild(h('span', { className: 'tool-list-title', text: String(item.title || '') }));
      head.appendChild(h('span', { className: 'tool-list-meta', text: when(Number(item.at) || 0) }));
      li.appendChild(head);
      li.appendChild(h('div', { className: 'tool-list-meta', text: String(item.detail || '') }));
      ui.history.appendChild(li);
    });
  }

  function remember(title, detail) {
    var list = lsGet(HISTORY_KEY);
    if (!Array.isArray(list)) list = [];
    list.unshift({ at: Date.now(), title: title, detail: detail });
    lsSet(HISTORY_KEY, list.slice(0, HISTORY_MAX));
  }

  /* ------------------------------ sessions ------------------------------ */

  function begin(session) {
    state.session = session;
    save();
    nextQuestion();
  }

  function save() {
    if (state.session && !state.session.finishedAt) lsSet(SESSION_KEY, state.session);
    else lsDel(SESSION_KEY);
  }

  function engineNext() {
    var s = state.session;
    if (s.mode === 'exam') return CE.examNext(state.pool, s, rng);
    if (s.mode === 'drill') return CE.drillNext(state.pool, s, rng);
    return CE.practiceNext(state.pool, s);
  }

  function engineAnswer(choice) {
    var s = state.session;
    var now = Date.now();
    if (s.mode === 'exam') return CE.examAnswer(state.pool, s, choice, now);
    if (s.mode === 'drill') return CE.drillAnswer(state.pool, s, choice);
    return CE.practiceAnswer(state.pool, s, choice, now);
  }

  function nextQuestion() {
    var s = state.session;
    if (s.mode === 'exam' && CE.examTick(state.pool, s, Date.now())) { finish(); return; }
    var id = engineNext();
    save();
    if (!id) { if (!s.finishedAt) s.finishedAt = Date.now(); finish(); return; }
    renderQuestion(state.pool.byId[id]);
    if (s.mode === 'exam') startTimer();
  }

  /* ------------------------------ question view ------------------------------ */

  function renderQuestion(q) {
    var s = state.session;
    state.selected = null;
    state.awaitingNext = false;
    showView('question');
    var n = s.responses.length + 1;
    ui.progress.textContent = s.mode === 'practice' ? 'Question ' + n + ' of ' + s.order.length
      : (s.mode === 'exam' ? 'Question ' + n + ' (100 to 150)' : 'Question ' + n + (s.currentIsRetry ? ' (retry)' : ''));
    ui.meta.textContent = s.mode === 'exam' ? MODE_NAMES.exam
      : 'Domain ' + q.domain + ' · Level ' + q.level + ' ' + CE.LEVELS[q.level];
    show(ui.timer, s.mode === 'exam');
    ui.stem.textContent = q.stem;
    var legend = ui.choices.querySelector('legend');
    ui.choices.replaceChildren(legend);
    show(ui.feedback, false);
    setStatus(ui.questionStatus, '');
    var selfGraded = q.format !== 'mcq';
    if (!selfGraded) {
      q.options.forEach(function (text, i) {
        var input = h('input', { type: 'radio', name: 'cx-choice', value: String(i), id: 'cx-choice-' + i });
        input.addEventListener('change', function () { state.selected = i; ui.submit.disabled = false; });
        var label = h('label', { className: 'cx-choice', for: 'cx-choice-' + i }, [
          input, h('span', { className: 'cx-letter', text: letter(i) }), h('span', { className: 'cx-choice-text', text: text })
        ]);
        ui.choices.appendChild(label);
      });
    } else {
      ui.choices.appendChild(h('p', { className: 'tool-note', text: 'Work out your answer, then show the correct one and mark yourself.' }));
    }
    show(ui.choices, true);
    show(ui.submit, !selfGraded);
    ui.submit.disabled = true;
    show(ui.reveal, selfGraded);
    show(ui.selfRight, false);
    show(ui.selfWrong, false);
    show(ui.next, false);
    ui.stop.textContent = s.mode === 'exam' ? 'End the exam now' : 'End session';
    var first = ui.choices.querySelector('input');
    if (first) first.focus({ preventScroll: true });
  }

  function lockChoices(q, choice) {
    Array.prototype.forEach.call(ui.choices.querySelectorAll('input'), function (input) { input.disabled = true; });
    if (q.format !== 'mcq') return;
    Array.prototype.forEach.call(ui.choices.querySelectorAll('.cx-choice'), function (label, i) {
      if (i === q.answer) label.classList.add('cx-right');
      else if (i === choice) label.classList.add('cx-wrong');
    });
  }

  function showFeedback(q, correct) {
    ui.verdict.textContent = correct ? 'Correct.' : 'Not quite.';
    ui.verdict.className = 'cx-verdict ' + (correct ? 'cx-verdict-right' : 'cx-verdict-wrong');
    ui.answer.textContent = q.format === 'mcq' ? 'Answer ' + letter(q.answer) + '. ' + q.options[q.answer] : 'Answer: ' + q.answer;
    ui.why.textContent = q.justification;
    show(ui.feedback, true);
  }

  function submit(choice) {
    var s = state.session;
    if (!s || state.awaitingNext) return;
    var q = state.pool.byId[s.current];
    var result;
    try { result = engineAnswer(choice); } catch (e) { setStatus(ui.questionStatus, e.message, 'error'); return; }
    save();
    var immediate = s.mode === 'drill' || (s.mode === 'practice' && s.feedback);
    if (s.mode === 'exam' || !immediate) {
      if (s.finishedAt) finish(); else nextQuestion();
      return;
    }
    state.awaitingNext = true;
    lockChoices(q, choice);
    if (q.format === 'mcq') showFeedback(q, result.correct);
    show(ui.submit, false);
    show(ui.reveal, false);
    show(ui.selfRight, false);
    show(ui.selfWrong, false);
    show(ui.next, true);
    ui.next.textContent = s.finishedAt ? 'See the results' : 'Next question';
    ui.next.focus({ preventScroll: true });
  }

  function reveal() {
    var q = state.pool.byId[state.session.current];
    ui.verdict.textContent = '';
    ui.verdict.className = 'cx-verdict';
    ui.answer.textContent = 'Answer: ' + q.answer;
    ui.why.textContent = q.justification;
    show(ui.feedback, true);
    show(ui.reveal, false);
    show(ui.selfRight, true);
    show(ui.selfWrong, true);
  }

  /* ------------------------------ timer ------------------------------ */

  function startTimer() {
    stopTimer();
    tick();
    state.timer = window.setInterval(tick, 1000);
  }
  function stopTimer() {
    if (state.timer) window.clearInterval(state.timer);
    state.timer = null;
  }
  function tick() {
    var s = state.session;
    if (!s || s.mode !== 'exam') { stopTimer(); return; }
    var left = CE.LIMITS.examMinutes * 60000 - (Date.now() - s.startedAt);
    ui.timer.textContent = clock(left) + ' left';
    if (CE.examTick(state.pool, s, Date.now())) { save(); finish(); }
  }

  /* ------------------------------ results ------------------------------ */

  function finish() {
    stopTimer();
    var s = state.session;
    if (!s) return;
    if (!s.finishedAt) s.finishedAt = Date.now();
    lsDel(SESSION_KEY);
    showView('result');
    var tbody = ui.resultTable.querySelector('tbody');
    tbody.replaceChildren();
    var review = [];
    if (s.mode === 'exam') {
      var r = CE.examResult(state.pool, s);
      ui.resultTitle.textContent = 'Exam result';
      ui.resultHeadline.textContent = (r.pass ? 'Pass' : 'Fail') + ' (estimate). Scaled score ' + r.score + ' of 1000, pass line 700.';
      ui.resultHeadline.className = 'cx-result-headline ' + (r.pass ? 'cx-verdict-right' : 'cx-verdict-wrong');
      var reasons = {
        confident: 'The exam ended once the result was clear.',
        maximum: 'The exam reached the 150-question limit.',
        time: r.shortOfMinimum ? 'Time ran out before question 100, which counts as a fail on the real exam.' : 'Time ran out.',
        bank: 'The question bank ran out of unused questions.',
        stopped: 'You ended the exam early.'
      };
      ui.resultNote.textContent = r.items + ' questions, ' + r.correct + ' correct, ' + r.minutes + ' minutes. ' + (reasons[r.reason] || '') +
        ' The score is this simulator\'s own scale, anchored so that 700 means about 70 percent on a domain-weighted mix of this bank, not the ISC2 scale.';
      ui.standingHead.textContent = 'Standing';
      fillTable(tbody, r.byDomain, true);
      review = r.missed;
      remember('Exam simulation: ' + (r.pass ? 'pass' : 'fail') + ', ' + r.score, r.items + ' questions, ' + percent(r.correct, r.items) + ' correct, ' + r.minutes + ' min');
    } else if (s.mode === 'drill') {
      var d = CE.drillResult(state.pool, s);
      ui.resultTitle.textContent = 'Drill summary';
      ui.resultHeadline.textContent = d.unique + ' questions, ' + percent(d.firstTimeCorrect, d.unique) + ' right the first time, ' + d.mastered + ' mastered on retry.';
      ui.resultHeadline.className = 'cx-result-headline';
      ui.resultNote.textContent = d.outstanding.length ? d.outstanding.length + ' missed question' + (d.outstanding.length === 1 ? ' is' : 's are') + ' still outstanding and listed below.' : 'Every missed question was answered correctly on a retry.';
      ui.standingHead.textContent = 'Level reached';
      fillTable(tbody, d.byDomain, false, d.level);
      review = d.outstanding;
      remember('Mastery drill', d.unique + ' questions, ' + percent(d.firstTimeCorrect, d.unique) + ' first time, ' + d.mastered + ' mastered');
    } else {
      var p = CE.practiceResult(state.pool, s);
      ui.resultTitle.textContent = 'Practice result';
      ui.resultHeadline.textContent = p.correct + ' of ' + p.answered + ' correct (' + percent(p.correct, p.answered) + ').';
      ui.resultHeadline.className = 'cx-result-headline';
      ui.resultNote.textContent = p.answered < p.planned ? 'You ended the session after ' + p.answered + ' of ' + p.planned + ' questions.' : '';
      ui.standingHead.textContent = 'Score';
      fillTable(tbody, p.byDomain, false);
      review = s.feedback ? p.missed : s.responses.map(function (x) { return x.id; });
      remember('Random practice', p.correct + ' of ' + p.answered + ' correct (' + percent(p.correct, p.answered) + ')');
    }
    renderReview(review, s);
    state.session = null;
    ui.homeButton.focus({ preventScroll: true });
  }

  function fillTable(tbody, byDomain, standing, levels) {
    Object.keys(CE.DOMAINS).forEach(function (d) {
      var row = byDomain[d];
      if (!row || (!row.asked && !(levels && levels[d]))) return;
      var last = standing ? { above: 'Above the line', near: 'Near the line', below: 'Below the line', 'not tested': 'Not tested' }[row.standing]
        : (levels ? CE.LEVELS[levels[d]] + ' (' + levels[d] + ')' : percent(row.correct, row.asked));
      tbody.appendChild(h('tr', null, [
        h('th', { scope: 'row', text: d + '. ' + CE.DOMAINS[d] }),
        h('td', { text: String(row.asked) }), h('td', { text: String(row.correct) }), h('td', { text: last })
      ]));
    });
  }

  function renderReview(ids, s) {
    ui.review.replaceChildren();
    var answers = {};
    s.responses.forEach(function (r) { answers[r.id] = r.choice; });
    show(ui.reviewTitle, ids.length > 0);
    ids.forEach(function (id, n) {
      var q = state.pool.byId[id];
      if (!q) return;
      var box = h('details', { className: 'cx-review-item' });
      box.appendChild(h('summary', { text: (n + 1) + '. ' + (q.stem.length > 140 ? q.stem.slice(0, 137) + '...' : q.stem) }));
      box.appendChild(h('p', { className: 'cx-stem', text: q.stem }));
      if (q.format === 'mcq') {
        var list = h('ol', { className: 'cx-review-options', type: 'A' });
        q.options.forEach(function (text, i) {
          var cls = i === q.answer ? 'cx-right' : (i === answers[id] ? 'cx-wrong' : '');
          list.appendChild(h('li', { className: cls, text: text + (i === answers[id] ? '  (your answer)' : '') }));
        });
        box.appendChild(list);
      }
      box.appendChild(h('p', { className: 'cx-answer', text: q.format === 'mcq' ? 'Answer ' + letter(q.answer) + '. ' + q.options[q.answer] : 'Answer: ' + q.answer }));
      box.appendChild(h('p', { className: 'cx-why', text: q.justification }));
      box.appendChild(h('p', { className: 'tool-note', text: 'Domain ' + q.domain + ' · ' + CE.DOMAINS[q.domain] + ' · Level ' + q.level }));
      ui.review.appendChild(box);
    });
  }

  function endEarly() {
    var s = state.session;
    if (!s) return;
    var sure = window.confirm(s.mode === 'exam' ? 'End the exam now? It will be scored on the questions answered so far.' : 'End this session and see the summary?');
    if (!sure) return;
    s.current = null;
    s.finishedAt = Date.now();
    if (s.mode === 'exam') s.finishReason = 'stopped';
    finish();
  }

  /* ------------------------------ wiring ------------------------------ */

  ui.signinGithub.addEventListener('click', function () { signIn('github', ui.signinGithub); });
  ui.signinGoogle.addEventListener('click', function () { signIn('google', ui.signinGoogle); });

  ui.startExam.addEventListener('click', function () {
    begin(CE.createExam(state.pool, Date.now()));
  });
  ui.startDrill.addEventListener('click', function () {
    var domains = chosenDomains(ui.drillDomains);
    if (!domains.length) { window.alert('Choose at least one domain.'); return; }
    begin(CE.createDrill(state.pool, domains, Date.now()));
  });
  ui.startPractice.addEventListener('click', function () {
    var domains = chosenDomains(ui.practiceDomains);
    if (!domains.length) { window.alert('Choose at least one domain.'); return; }
    var feedback = document.querySelector('input[name="cx-feedback"]:checked');
    begin(CE.createPractice(state.pool, {
      count: ui.count.value, domains: domains,
      feedback: feedback ? feedback.value : 'each', includeOtherFormats: ui.other.checked
    }, rng, Date.now()));
  });
  ui.resumeGo.addEventListener('click', function () {
    var saved = lsGet(SESSION_KEY);
    if (!saved || !CE.validSession(state.pool, saved)) { lsDel(SESSION_KEY); goHome(); return; }
    state.session = saved;
    nextQuestion();
  });
  ui.resumeDiscard.addEventListener('click', function () { lsDel(SESSION_KEY); goHome(); });

  ui.submit.addEventListener('click', function () { if (state.selected !== null) submit(state.selected); });
  ui.next.addEventListener('click', function () {
    if (!state.session) return;
    if (state.session.finishedAt) finish(); else nextQuestion();
  });
  ui.reveal.addEventListener('click', reveal);
  ui.selfRight.addEventListener('click', function () { submit(true); });
  ui.selfWrong.addEventListener('click', function () { submit(false); });
  ui.stop.addEventListener('click', endEarly);
  ui.homeButton.addEventListener('click', goHome);

  /* A to H or 1 to 8 picks a choice, Enter submits or moves on. */
  document.addEventListener('keydown', function (e) {
    if (ui.question.hidden || e.altKey || e.ctrlKey || e.metaKey) return;
    var target = e.target;
    if (target && (target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && target.type === 'number'))) return;
    if (e.key === 'Enter') {
      if (!ui.next.hidden) { e.preventDefault(); ui.next.click(); }
      else if (!ui.submit.hidden && !ui.submit.disabled) { e.preventDefault(); ui.submit.click(); }
      return;
    }
    if (state.awaitingNext) return;
    var k = e.key.toUpperCase();
    var index = /^[A-H]$/.test(k) ? k.charCodeAt(0) - 65 : (/^[1-8]$/.test(k) ? Number(k) - 1 : -1);
    var input = index >= 0 ? $('cx-choice-' + index) : null;
    if (input && !input.disabled) { input.checked = true; input.dispatchEvent(new Event('change')); }
  });

  window.addEventListener('pagehide', save);

  if (!CE) { renderAccess('The simulator failed to load. Reload the page to try again.', 'error', false); return; }
  if (!window.siteAuth) { renderAccess('Sign-in is not available on this page, so the private question bank cannot be opened.', 'error', false); return; }
  window.siteAuth.ready().catch(function () { return null; }).then(function () {
    window.siteAuth.onChange(onIdentity);
  });
})();
