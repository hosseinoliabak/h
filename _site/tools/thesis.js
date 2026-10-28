(() => {
  'use strict';
  const el = id => document.getElementById('th-' + id);
  const encoder = new TextEncoder();
  const pathPattern = /^(?:[a-z0-9][a-z0-9_-]{0,39}\/){0,2}[a-z0-9][a-z0-9_-]{0,59}\.(?:tex|qmd|bib|sty|cls|yml|md)$/;
  let project = null, selected = 'plan.qmd', dirty = false, generation = 0, session = 0, currentUid = null, saving = false, compiling = false;
  let pdf = null, compiledGeneration = -1, urls = new Set();
  const message = text => { el('status').textContent = text; };
  function stopCompiler() { if (window.thesisCompiler) window.thesisCompiler.cancel(); }
  function release() { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); }
  function clear() {
    session++; stopCompiler(); release(); pdf = null; project = null; dirty = false; saving = false; compiling = false;
    el('source').value = ''; el('files').replaceChildren(); el('history').replaceChildren(); el('log').textContent = '';
    el('project').hidden = true; el('pdf').disabled = true; el('cancel').hidden = true; el('compile').disabled = false; el('save').disabled = false; el('delete').disabled = false;
    el('compile-status').textContent = 'Ready to compile.'; el('delete-confirm').value = ''; el('new-path').value = ''; el('import').value = '';
    el('filename').textContent = 'Source'; el('revision').textContent = '';
  }
  async function call(data) {
    const functions = await window.siteAuth.firebaseFunctions();
    if (!functions) throw new Error('Sign in again to open your workspace.');
    return (await functions.httpsCallable('thesisWorkspace', { limitedUseAppCheckTokens: true })(data)).data;
  }
  function validFiles(files) {
    if (!Array.isArray(files) || files.length < 1 || files.length > 64) throw new Error('Keep between 1 and 64 source files.');
    let size = 0; const seen = new Set();
    for (const file of files) {
      if (!file || Object.keys(file).sort().join() !== 'content,path' || typeof file.path !== 'string' || !pathPattern.test(file.path) || seen.has(file.path) || typeof file.content !== 'string') throw new Error('The project contains an unsupported file.');
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(file.content) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(file.content)) throw new Error('Source files must contain valid UTF-8 text.');
      const bytes = encoder.encode(file.content).length; size += bytes;
      if (bytes > 262144 || size > 1048576) throw new Error('A file may contain 256 KiB and the project may contain 1 MiB of text.');
      seen.add(file.path);
    }
    if (!seen.has('main.tex') || !seen.has('plan.qmd')) throw new Error('Keep main.tex and plan.qmd in the project.');
    return files;
  }
  function revision() { el('revision').textContent = 'Revision ' + project.revision + (dirty ? ' · Unsaved edits' : ' · Saved ' + new Date(project.updatedAt).toLocaleString()); }
  function changed() {
    dirty = true; generation++; revision();
    if (pdf && compiledGeneration !== generation) el('compile-status').textContent = 'Source changed since the last PDF. Compile again to update it.';
  }
  function select(path) {
    selected = path; el('filename').textContent = path; el('source').value = project.files.find(file => file.path === path).content;
    el('remove').disabled = ['main.tex', 'plan.qmd'].includes(path);
    for (const button of el('files').children) button.setAttribute('aria-current', String(button.dataset.path === path));
  }
  function display() {
    const buttons = project.files.map(file => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'tool-button'; button.dataset.path = file.path; button.textContent = file.path;
      button.addEventListener('click', () => select(file.path)); return button;
    });
    el('files').replaceChildren(...buttons);
    if (!project.files.some(file => file.path === selected)) selected = 'plan.qmd';
    select(selected); revision();
    const history = (project.history || []).map(item => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'tool-button';
      button.textContent = 'Open revision ' + item.revision + ' · ' + new Date(item.updatedAt).toLocaleString();
      button.addEventListener('click', () => {
        if (dirty && !window.confirm('Replace the unsaved edits in this tab with this earlier revision?')) return;
        try { validFiles(item.files); project.files = structuredClone(item.files); changed(); display(); message('Earlier revision opened as unsaved edits. Review it before saving.'); }
        catch (error) { message(error.message); }
      }); return button;
    });
    el('history').replaceChildren(...history); el('project').hidden = false;
  }
  async function load() {
    const expected = session; const initialGeneration = generation;
    message('Opening your private workspace.'); el('retry').hidden = true;
    try {
      const result = await call({ action: 'load' });
      if (expected !== session) return;
      if (generation !== initialGeneration && dirty) { message('Edits changed while reloading. Export them before reloading again.'); return; }
      validFiles(result.files); project = result; dirty = false; display(); message('Private workspace ready.');
    } catch (error) { if (expected === session) { message(error.message || 'The workspace could not be opened.'); el('retry').hidden = false; } }
  }
  async function save() {
    if (!project || saving) return;
    const expected = session, savedGeneration = generation; saving = true; el('save').disabled = true;
    try {
      validFiles(project.files); message('Saving your revision.');
      const result = await call({ action: 'save', revision: project.revision, files: structuredClone(project.files) });
      if (expected !== session) return;
      validFiles(result.files);
      if (generation === savedGeneration) { project = result; dirty = false; }
      else { project.revision = result.revision; project.updatedAt = result.updatedAt; project.history = result.history; }
      display(); message(dirty ? 'Revision saved. Newer edits in this tab still need saving.' : 'Revision saved.');
    } catch (error) { if (expected === session) message(error.message || 'Saving failed. Your edits remain in this tab.'); }
    finally { if (expected === session) { saving = false; el('save').disabled = false; } }
  }
  function download(blob, filename) {
    while (urls.size >= 8) { const oldest = urls.values().next().value; URL.revokeObjectURL(oldest); urls.delete(oldest); }
    const url = URL.createObjectURL(blob); urls.add(url);
    const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
    setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 30000);
  }
  el('source').addEventListener('input', () => {
    if (!project) return;
    project.files.find(file => file.path === selected).content = el('source').value; changed();
  });
  el('save').addEventListener('click', save);
  el('reload').addEventListener('click', () => { if (!saving && (!dirty || window.confirm('Discard the unsaved edits in this tab and reload the saved project?'))) load(); });
  el('retry').addEventListener('click', load);
  el('github').addEventListener('click', () => window.siteAuth.signIn('github.com').catch(error => message(error.message)));
  el('google').addEventListener('click', () => window.siteAuth.signIn('google.com').catch(error => message(error.message)));
  el('add-form').addEventListener('submit', event => {
    event.preventDefault(); if (!project) return;
    const path = el('new-path').value.trim();
    try { const files = [...project.files, { path, content: '' }]; validFiles(files); project.files = files; selected = path; changed(); display(); el('new-path').value = ''; }
    catch (error) { message(error.message); }
  });
  el('remove').addEventListener('click', () => {
    if (!project || ['main.tex', 'plan.qmd'].includes(selected) || !window.confirm('Remove ' + selected + ' from this project?')) return;
    project.files = project.files.filter(file => file.path !== selected); selected = 'plan.qmd'; changed(); display();
  });
  el('download').addEventListener('click', () => { if (project) download(new Blob([el('source').value], { type: 'text/plain;charset=utf-8' }), selected.split('/').pop()); });
  el('export').addEventListener('click', () => { if (project) download(new Blob([JSON.stringify({ schema: 1, files: project.files }, null, 2)], { type: 'application/json' }), 'thesis-project.json'); });
  el('import').addEventListener('change', async () => {
    const file = el('import').files[0], expected = session;
    if (!file || !project) return;
    try {
      if (file.size > 3 * 1048576) throw new Error('Import a project JSON file under 3 MiB.');
      const parsed = JSON.parse(await file.text());
      if (expected !== session || !project) return;
      if (!parsed || parsed.schema !== 1 || Object.keys(parsed).sort().join() !== 'files,schema') throw new Error('Import an exported thesis project.');
      validFiles(parsed.files);
      if (!window.confirm('Replace the current files in this tab with this imported project? Review it before saving.')) return;
      project.files = parsed.files; changed(); display(); message('Project imported as unsaved edits.');
    } catch (error) { if (expected === session) message(error.message || 'Import failed.'); }
    finally { el('import').value = ''; }
  });
  el('compile').addEventListener('click', async () => {
    if (!project || compiling) return;
    const expected = session, sourceGeneration = generation; compiling = true; el('compile').disabled = true; el('cancel').hidden = false;
    pdf = null; el('pdf').disabled = true; el('log').textContent = '';
    try {
      validFiles(project.files);
      if (!window.thesisCompiler) throw new Error('The PDF compiler is unavailable. Reload the page to try again. Your source files remain editable.');
      const result = await window.thesisCompiler.compile(structuredClone(project.files), text => { if (expected === session) el('compile-status').textContent = text; });
      if (expected !== session) return;
      pdf = new Blob([result.bytes], { type: 'application/pdf' }); compiledGeneration = sourceGeneration;
      el('log').textContent = result.log; el('pdf').disabled = false;
      el('compile-status').textContent = generation === sourceGeneration ? 'PDF ready to download. Compiled from the current source.' : 'PDF ready. Source changed during compilation; compile again for the latest edits.';
    } catch (error) { if (expected === session) { el('compile-status').textContent = error.message; el('log').textContent = error.log || ''; } }
    finally { if (expected === session) { compiling = false; el('compile').disabled = false; el('cancel').hidden = true; } }
  });
  el('cancel').addEventListener('click', stopCompiler);
  el('pdf').addEventListener('click', () => { if (pdf) download(pdf, 'thesis.pdf'); });
  el('delete').addEventListener('click', async () => {
    if (!project || saving) return;
    if (el('delete-confirm').value !== 'DELETE') { message('Type DELETE to remove the workspace and its saved history.'); return; }
    const expected = session; saving = true; el('delete').disabled = true;
    try {
      await call({ action: 'delete', revision: project.revision, confirmation: 'DELETE' });
      if (expected === session) { clear(); message('Workspace deleted.'); }
    } catch (error) { if (expected === session) message(error.message || 'Deletion failed.'); }
    finally { if (expected === session) { saving = false; el('delete').disabled = false; } }
  });
  window.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && project) { event.preventDefault(); save(); } });
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('pagehide', () => { stopCompiler(); release(); });
  function connect() {
    if (!window.siteAuth) { message('Sign-in is unavailable. Reload this page to try again.'); return; }
    window.siteAuth.onChange(user => {
      if ((user?.uid || null) === currentUid && (project || currentUid)) return;
      currentUid = user?.uid || null; clear(); el('signin').hidden = Boolean(user); el('retry').hidden = true;
      if (user) load(); else message('Sign in with the account that owns this private workspace.');
    });
  }
  if (document.readyState === 'complete') connect(); else window.addEventListener('load', connect, { once: true });
})();
