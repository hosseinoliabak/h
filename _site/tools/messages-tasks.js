/* Approval cards are created only from authenticated server plan records.
   Message text is never parsed into a plan, control, identity, or digest. */
(function () {
  'use strict';
  window.MessageTasks = { init: function (adapter) {
    function node(tag, text, className) { var n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; }
    function action(text, input) {
      var control = node('button', text, 'tool-button'); control.type = 'button';
      control.addEventListener('click', function () {
        var context = adapter.context(), threadId = context.threadId, epoch = context.epoch;
        if (!context.user || !threadId) return;
        adapter.run(function () { return adapter.call(Object.assign({ threadId: threadId }, input), 'messageAgents'); }, function (result) {
          var latest = adapter.context();
          if (latest.threadId !== threadId || latest.epoch !== epoch) return;
          if (!result.task || result.task.taskId !== input.taskId || result.task.digest !== input.digest) throw new Error('Invalid approval response.');
          adapter.update(result.task);
          adapter.status('Research action ' + result.task.state + '.', true);
        });
      });
      return control;
    }
    return { card: function (job, thread) {
      var context = adapter.context();
      if (!job || !/^[a-f0-9]{32}$/.test(job.taskId || '') || !/^[a-f0-9]{64}$/.test(job.digest || '') || !job.plan || !job.plan.quote || !job.plan.limits || typeof job.plan.tool !== 'string' || job.plan.tool.length > 80) return null;
      var card = node('article', undefined, 'msg-card msg-task-card'); card.dataset.taskId = job.taskId;
      var quote = job.plan.quote.maximumCents;
      var amount = Number.isSafeInteger(quote) && quote >= 0 ? 'up to $' + (quote / 100).toFixed(2) + ' incremental allowance' : 'unknown maximum cost';
      var labels = { archive_status: 'Check archive quota', archive_list: 'List archive entries', archive_head: 'Inspect object metadata', archive_sample: 'Download one small sample', btc_pilot_august_2025: 'August 2025 BTC pilot' };
      var expired = !Number.isSafeInteger(job.expiresAt) || job.expiresAt <= Date.now();
      var pending = ['awaiting-approval', 'approved', 'running'].includes(job.state);
      var head = node('header'); head.appendChild(node('strong', job.state === 'awaiting-approval' && !expired ? 'Action approval' : 'Research action')); head.appendChild(node('span', pending && expired ? 'expired' : job.state)); card.appendChild(head);
      card.appendChild(node('strong', labels[job.plan.tool] || job.plan.tool));
      var requester = thread.names[job.requester];
      card.appendChild(node('p', 'Requested by ' + (typeof requester === 'string' ? requester.slice(0, 80) : 'Member') + '. ' + amount + '.'));
      if (typeof job.plan.path === 'string') card.appendChild(node('pre', job.plan.path.slice(0, 2048)));
      var details = node('details'); details.appendChild(node('summary', 'Plan and limits'));
      details.appendChild(node('p', 'Approval by ' + job.plan.approvalRole + '. Limits ' + job.plan.limits.sourceBytes + ' source bytes, ' + job.plan.limits.outputBytes + ' output bytes, ' + job.plan.limits.requests + ' S3 requests, ' + job.plan.limits.runtimeSeconds + ' seconds.' + (Number.isSafeInteger(job.plan.maxKeys) ? ' At most ' + job.plan.maxKeys + ' list entries.' : '')));
      details.appendChild(node('pre', JSON.stringify(job.plan, null, 2)));
      details.appendChild(node('code', job.digest));
      details.appendChild(node('p', 'Known incremental costs under $5 need requester or owner approval. Unknown costs, $5 or more, and the pilot need the owner. Existing permissions and quotas still apply. Do not split work to avoid approval. These allowances are not invoices or account-wide spending caps.'));
      details.appendChild(node('p', 'Approved actions wait for the connected Mac runner. Cancellation stops future steps after the next authorization check. Sent requests may still incur costs. Failed execution is not retried automatically.'));
      card.appendChild(details);
      if (job.plan.tool === 'btc_pilot_august_2025') card.appendChild(node('p', 'Owner approval here does not replace private execution approval, verified output retention, source-schema checks, or the approved network-cap change.'));
      var currentQuote = Number.isSafeInteger(job.plan.quote.expiresAt) && job.plan.quote.expiresAt > Date.now();
      if (job.state === 'awaiting-approval' && !expired && !currentQuote && !context.owner) card.appendChild(node('p', 'The cost allowance expired. Owner approval is required.'));
      if (job.state === 'awaiting-approval' && !expired && (context.owner || currentQuote && job.plan.approvalRole === 'researcher' && job.requester === context.user.uid)) card.appendChild(action('Approve action · ' + amount, { action: 'task-approve', taskId: job.taskId, digest: job.digest }));
      if (['awaiting-approval', 'approved', 'running'].includes(job.state) && !expired && (context.owner || job.requester === context.user.uid)) card.appendChild(action('Cancel action', { action: 'task-cancel', taskId: job.taskId, digest: job.digest }));
      if (typeof job.result === 'string') card.appendChild(node('pre', job.result.slice(0, 7500)));
      return card;
    } };
  } };
}());
