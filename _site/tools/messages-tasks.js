(function () {
  'use strict';
  window.MessageTasks = { init: function (adapter) {
    var panel = document.getElementById('msg-tasks'), list = document.getElementById('msg-task-list');
    var current = null, proposal = null;
    function node(tag, text) { var n = document.createElement(tag); if (text !== undefined) n.textContent = text; return n; }
    function send(input, done) {
      var context = adapter.context();
      if (!context.user || !context.threadId || !current) return;
      adapter.run(function () { return adapter.call(Object.assign({ threadId: context.threadId }, input), 'messageAgents'); }, function (result) {
        var latest = adapter.context();
        if (latest.threadId !== context.threadId || latest.epoch !== context.epoch) return;
        if (!result.task || !/^[a-f0-9]{32}$/.test(result.task.taskId || '')) throw new Error('Invalid task response.');
        if (done) done(); adapter.status('Task ' + result.task.state + '.');
      });
    }
    function action(text, input) {
      var control = node('button', text); control.type = 'button'; control.className = 'tool-button';
      control.addEventListener('click', function () { send(input); }); return control;
    }
    document.getElementById('msg-task-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var tool = document.getElementById('msg-task-tool').value, plan = { tool: tool };
      if (['archive_list', 'archive_head', 'archive_sample'].includes(tool)) plan.path = document.getElementById('msg-task-path').value.trim();
      if (tool === 'archive_list') plan.maxKeys = 20;
      var key = JSON.stringify([adapter.context().threadId, plan]);
      if (!proposal || proposal.key !== key) proposal = { key: key, taskId: Array.from(window.crypto.getRandomValues(new Uint8Array(16)), function (b) { return b.toString(16).padStart(2, '0'); }).join('') };
      send({ action: 'task-propose', taskId: proposal.taskId, plan: plan }, function () { proposal = null; panel.open = true; });
    });
    return {
      reset: function () { current = null; proposal = null; panel.hidden = true; panel.open = false; list.replaceChildren(); document.getElementById('msg-task-path').value = ''; },
      open: function () { if (current) { panel.open = true; panel.scrollIntoView({ block: 'nearest' }); } },
      draw: function (thread) {
        current = thread; var context = adapter.context(); panel.hidden = !thread || thread.kind === 'group';
        list.replaceChildren(); if (panel.hidden) return;
        Object.values(thread.researchTasks || {}).slice(0, 20).sort(function (a, b) { return b.createdAt - a.createdAt; }).forEach(function (job) {
          if (!job || !/^[a-f0-9]{32}$/.test(job.taskId || '') || !/^[a-f0-9]{64}$/.test(job.digest || '') || !job.plan || !job.plan.quote || !job.plan.limits || typeof job.plan.tool !== 'string' || job.plan.tool.length > 80) return;
          var li = node('li'), quote = job.plan.quote.maximumCents;
          var amount = Number.isSafeInteger(quote) && quote >= 0 ? 'up to $' + (quote / 100).toFixed(2) + ' incremental allowance' : 'unknown maximum cost';
          li.appendChild(node('strong', job.plan.tool + ' · ' + job.state));
          if (typeof job.plan.path === 'string') li.appendChild(node('pre', job.plan.path.slice(0, 2048)));
          li.appendChild(node('p', amount + '. Approval by ' + job.plan.approvalRole + '.'));
          li.appendChild(node('p', 'Limits ' + job.plan.limits.sourceBytes + ' source bytes, ' + job.plan.limits.requests + ' S3 requests, ' + job.plan.limits.runtimeSeconds + ' seconds.'));
          var fingerprint = node('details'); fingerprint.appendChild(node('summary', 'Exact plan fingerprint')); fingerprint.appendChild(node('code', job.digest)); li.appendChild(fingerprint);
          var expired = !Number.isSafeInteger(job.expiresAt) || job.expiresAt <= Date.now();
          if (job.state === 'awaiting-approval' && !expired && (context.owner || job.plan.approvalRole === 'researcher' && job.requester === context.user.uid)) li.appendChild(action('Approve exact task · ' + amount, { action: 'task-approve', taskId: job.taskId, digest: job.digest }));
          if (['awaiting-approval', 'approved', 'running'].includes(job.state) && !expired && (context.owner || job.requester === context.user.uid)) li.appendChild(action('Cancel task', { action: 'task-cancel', taskId: job.taskId }));
          if (typeof job.result === 'string') li.appendChild(node('pre', job.result.slice(0, 7500)));
          list.appendChild(li);
        });
        if (!list.childNodes.length) list.appendChild(node('li', 'No tasks proposed yet.'));
      }
    };
  } };
}());
