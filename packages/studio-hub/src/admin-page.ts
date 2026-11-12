/**
 * The admin page (docs/studio-hub.md §12): one HTML file, served by the Worker at `GET /`, with
 * inline CSS and JS and no external resources. It is a plain client of the `/v1/admin/*` API: the
 * operator's token lives in sessionStorage, every piece of data is rendered with textContent (never
 * innerHTML), and the look uses the companion's neutral grey tokens.
 */

export const ADMIN_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Synon Studio · 管理</title>
<style>
  :root {
    --bg: #F6F6F7; --card: #FFFFFF; --bar: #FFFFFF; --text: #1D1D1F; --text2: #5D5D63; --text3: #737379;
    --hairline: rgba(0,0,0,0.09); --hairline-strong: rgba(0,0,0,0.16); --sunken: rgba(0,0,0,0.045);
    --primary: #1D1D1F; --on-primary: #FFFFFF; --ok: #2E8550; --warn: #94600F; --error: #B3352E; --info: #2F64D0;
    --shadow: 0 1px 2px rgba(0,0,0,0.04), 0 6px 18px rgba(0,0,0,0.05);
    --radius: 12px; --radius-s: 8px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #1E1E21; --card: #2A2A2E; --bar: #19191B; --text: #ECECEE; --text2: #A8A8AE; --text3: #8B8B92;
      --hairline: rgba(255,255,255,0.075); --hairline-strong: rgba(255,255,255,0.14); --sunken: rgba(255,255,255,0.06);
      --primary: #ECECEE; --on-primary: #1E1E21; --ok: #6CC48F; --warn: #E2B45C; --error: #F08A80; --info: #86AAF2;
      --shadow: none;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: var(--bg); color: var(--text);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  button, input, select { font: inherit; color: inherit; }
  code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  h1 { font-size: 20px; line-height: 1.3; margin: 0; letter-spacing: -0.01em; }
  h2 { font-size: 14px; font-weight: 600; margin: 0; letter-spacing: 0.01em; }
  p { margin: 0; }
  .muted { color: var(--text2); }
  .small { font-size: 12px; }
  .error { color: var(--error); }
  .empty { color: var(--text3); padding: 14px 0; }

  .bar { background: var(--bar); border-bottom: 1px solid var(--hairline); }
  .bar-in { max-width: 1040px; margin: 0 auto; padding: 12px 22px; display: flex; align-items: center; gap: 12px; }
  .brand { font-weight: 650; letter-spacing: -0.01em; font-size: 15px; }
  .brand span { color: var(--text2); font-weight: 500; }
  .bar-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }

  .wrap { max-width: 1040px; margin: 0 auto; padding: 24px 22px 80px; }
  .card { background: var(--card); border: 1px solid var(--hairline); border-radius: var(--radius); padding: 18px; box-shadow: var(--shadow); margin-bottom: 16px; }
  .auth { max-width: 460px; margin: 44px auto; }
  .auth h1 { margin-bottom: 6px; }
  .auth .row { margin-top: 14px; }

  .row { display: flex; align-items: center; gap: 10px; }
  .row.tight { gap: 7px; }
  .row.space { justify-content: space-between; align-items: flex-start; }
  .wrapping { flex-wrap: wrap; }
  .row.compact { gap: 8px; flex-wrap: wrap; }
  .grow { flex: 1 1 auto; min-width: 0; }
  .section-head { display: flex; align-items: center; gap: 12px; justify-content: space-between; margin-bottom: 12px; flex-wrap: wrap; }
  .detail-head { display: flex; align-items: center; gap: 16px; justify-content: space-between; margin: 4px 0 16px; flex-wrap: wrap; }

  .btn {
    appearance: none; border: 1px solid var(--hairline-strong); background: var(--card);
    border-radius: var(--radius-s); padding: 7px 13px; cursor: pointer; white-space: nowrap;
    transition: background 0.12s ease, border-color 0.12s ease, opacity 0.12s ease;
  }
  .btn:hover { background: var(--sunken); }
  .btn:active { opacity: 0.7; }
  .btn.primary { background: var(--primary); color: var(--on-primary); border-color: var(--primary); }
  .btn.primary:hover { opacity: 0.88; background: var(--primary); }
  .btn.danger { color: var(--error); border-color: var(--hairline); }
  .btn.danger:hover { background: color-mix(in srgb, var(--error) 8%, transparent); }
  .btn.small { padding: 4px 10px; font-size: 12px; }
  .btn.tiny { padding: 2px 8px; font-size: 12px; border-radius: 6px; }
  .btn:disabled { opacity: 0.45; cursor: default; }

  .input {
    appearance: none; border: 1px solid var(--hairline); background: var(--sunken);
    border-radius: var(--radius-s); padding: 8px 10px; min-width: 0;
  }
  .input:focus { outline: none; border-color: var(--hairline-strong); background: var(--card); }
  .input.grow { flex: 1 1 220px; }
  .tiny-input { padding: 3px 7px; font-size: 12px; max-width: 180px; }
  .invite-project { max-width: 190px; }

  .studio-list { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
  .studio {
    appearance: none; border: 1px solid var(--hairline); background: var(--card); border-radius: 10px;
    padding: 10px 14px; cursor: pointer; text-align: left; min-width: 190px; box-shadow: var(--shadow);
  }
  .studio:hover { background: var(--sunken); }
  .studio.current { border-color: var(--text2); }
  .studio-name { display: block; font-weight: 600; }
  .studio-meta { display: block; color: var(--text3); font-size: 11px; font-family: ui-monospace, Menlo, monospace; margin-top: 2px; }

  .item { display: flex; gap: 12px; align-items: flex-start; padding: 12px 0; border-top: 1px solid var(--hairline); }
  .item:first-of-type { border-top: 0; }
  .item.stack { flex-direction: column; align-items: stretch; gap: 8px; }
  .item.stack > .row { width: 100%; align-self: flex-start; }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; background: var(--text3); flex: 0 0 auto; }
  .dot.ok { background: var(--ok); }
  .dot.error { background: var(--error); }
  .badge { font-size: 11px; padding: 2px 7px; border-radius: 999px; border: 1px solid var(--hairline); color: var(--text2); }
  .badge.ok { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 35%, transparent); background: color-mix(in srgb, var(--ok) 9%, transparent); }
  .badge.error { color: var(--error); border-color: color-mix(in srgb, var(--error) 35%, transparent); background: color-mix(in srgb, var(--error) 8%, transparent); }

  .code-card { border-style: dashed; }
  .code-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 6px 0 8px; }
  .big-code { font-size: 24px; font-weight: 600; letter-spacing: 0.14em; padding: 6px 0; }
  .mono { font-size: 12px; color: var(--text2); word-break: break-all; }
  .mono.block { display: block; margin-top: 4px; padding: 8px 10px; background: var(--sunken); border-radius: var(--radius-s); }

  .chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .chip { display: inline-flex; align-items: center; gap: 4px; background: var(--sunken); border-radius: 999px; padding: 3px 4px 3px 10px; font-size: 12px; }
  .chip-x { appearance: none; border: 0; background: transparent; color: var(--text3); cursor: pointer; padding: 0 5px; border-radius: 999px; line-height: 1.2; }
  .chip-x:hover { color: var(--error); background: color-mix(in srgb, var(--error) 10%, transparent); }
  .chip-add { display: inline-flex; align-items: center; gap: 5px; }
  .link-row { margin-top: 2px; padding: 8px 10px; background: var(--sunken); border-radius: var(--radius-s); }
  .label { color: var(--text2); font-size: 12px; }

  .toast {
    position: fixed; left: 50%; bottom: 26px; transform: translate(-50%, 16px); opacity: 0; pointer-events: none;
    background: var(--primary); color: var(--on-primary); padding: 10px 16px; border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0,0,0,0.18); font-size: 13px; transition: opacity 0.18s ease, transform 0.18s ease;
    max-width: min(560px, calc(100vw - 40px));
  }
  .toast.show { opacity: 1; transform: translate(-50%, 0); }
  .toast.error { background: var(--error); color: #fff; }

  @media (max-width: 640px) {
    .wrap { padding: 16px 14px 70px; }
    .bar-in { padding: 10px 14px; }
    .detail-head { align-items: flex-start; }
    .item { flex-direction: column; }
    .big-code { font-size: 20px; }
  }
</style>
</head>
<body>
<header class="bar">
  <div class="bar-in">
    <div class="brand">Synon <span>Studio</span></div>
    <div class="bar-right">
      <span id="who" class="muted small"></span>
      <button id="change" class="btn small" type="button" hidden>换令牌</button>
    </div>
  </div>
</header>
<main class="wrap">
  <section id="auth" class="card auth" hidden>
    <h1>运营者令牌</h1>
    <p class="muted">管理页只给运营者。令牌是 Worker 的 <code class="mono">OPERATOR_TOKEN</code>。</p>
    <form id="auth-form" class="row">
      <input id="token" class="input grow" type="password" autocomplete="current-password" placeholder="OPERATOR_TOKEN" autofocus>
      <button class="btn primary" type="submit">进入</button>
    </form>
  </section>

  <section id="app" hidden>
    <div class="section-head">
      <h1>工作室</h1>
      <form id="new-studio" class="row compact">
        <input id="studio-name" class="input" type="text" placeholder="工作室名字" maxlength="200" required>
        <button class="btn primary" type="submit">新建工作室</button>
      </form>
    </div>
    <div id="studios" class="studio-list"></div>
    <div id="code-slot"></div>
    <div id="detail"></div>
  </section>
</main>
<div id="toast" class="toast" role="status" aria-live="polite"></div>
<script>
(function () {
  'use strict';

  var STORE_KEY = 'synon.studio.operator';
  var state = { token: sessionStorage.getItem(STORE_KEY) || '', studio: '', studios: [], detail: null, code: null, links: {}, pending: [] };
  var toastTimer = null;

  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, kids) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (key) {
      var value = attrs[key];
      if (value === undefined || value === null) return;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'onclick') node.addEventListener('click', value);
      else if (key === 'disabled') node.disabled = true;
      else node.setAttribute(key, value);
    });
    (kids || []).forEach(function (kid) {
      if (kid === null || kid === undefined) return;
      node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    });
    return node;
  }

  function button(label, kind, fn) {
    return el('button', { class: 'btn ' + (kind || ''), type: 'button', onclick: fn, text: label });
  }

  function time(ms) {
    if (!ms) return '';
    try { return new Date(ms).toLocaleString('zh-CN', { hour12: false }); } catch (e) { return ''; }
  }

  function toast(text, kind) {
    var node = $('toast');
    node.textContent = text;
    node.className = 'toast show ' + (kind || '');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.className = 'toast'; }, 4200);
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('已复制', 'ok'); }, function () { window.prompt('复制', text); });
    } else {
      window.prompt('复制', text);
    }
  }

  async function api(method, path, body) {
    var headers = { authorization: 'Bearer ' + state.token };
    var init = { method: method, headers: headers };
    if (body !== undefined) { headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    var res = await fetch(path, init);
    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (res.status === 401) { signOut(); throw new Error('令牌不对或已失效'); }
    if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
    return data;
  }

  async function withBusy(work) {
    try { await work(); } catch (e) { toast(e && e.message ? e.message : String(e), 'error'); }
  }

  function showAuth() {
    $('auth').hidden = false;
    $('app').hidden = true;
    $('change').hidden = true;
    $('who').textContent = '';
    $('token').value = '';
    $('token').focus();
  }

  function signOut() {
    state.token = '';
    state.studio = '';
    state.detail = null;
    state.studios = [];
    state.links = {};
    state.pending = [];
    sessionStorage.removeItem(STORE_KEY);
    $('detail').replaceChildren();
    $('studios').replaceChildren();
    showAuth();
  }

  function signIn(event) {
    if (event) event.preventDefault();
    var value = $('token').value.trim();
    if (!value) return;
    state.token = value;
    sessionStorage.setItem(STORE_KEY, value);
    $('auth').hidden = true;
    $('app').hidden = false;
    $('change').hidden = false;
    withBusy(function () { return loadStudios(); });
  }

  async function loadStudios() {
    var data = await api('GET', '/v1/admin/studios');
    state.studios = (data && data.studios) || [];
    renderStudios();
  }

  function renderStudios() {
    var list = $('studios');
    list.replaceChildren();
    if (!state.studios.length) {
      list.append(el('p', { class: 'empty', text: '还没有工作室。上面建一个。' }));
      return;
    }
    state.studios.forEach(function (s) {
      list.append(el('button', {
        class: 'studio' + (state.studio === s.id ? ' current' : ''),
        type: 'button',
        onclick: function () { withBusy(function () { return openStudio(s.id); }); },
      }, [
        el('span', { class: 'studio-name', text: s.name }),
        el('span', { class: 'studio-meta', text: s.id }),
      ]));
    });
  }

  function createStudio(event) {
    if (event) event.preventDefault();
    var name = $('studio-name').value.trim();
    if (!name) return;
    withBusy(async function () {
      var data = await api('POST', '/v1/admin/studios', { name: name });
      $('studio-name').value = '';
      state.code = data.linkCode;
      state.studio = data.studio.id;
      await loadStudios();
      await openStudio(data.studio.id);
      renderCode();
    });
  }

  async function openStudio(id) {
    state.studio = id;
    state.detail = await api('GET', '/v1/admin/studios/' + id);
    // A customer just invited and then put in a project is in the detail; stop showing the local copy.
    state.pending = state.pending.filter(function (c) {
      return !(state.detail.customers || []).some(function (x) { return x.id === c.id; });
    });
    renderStudios();
    renderDetail();
  }

  function customersFor(d) {
    var list = (d.customers || []).slice();
    state.pending.forEach(function (c) {
      if (!list.some(function (x) { return x.id === c.id; })) list.push({ ...c, projectIds: [] });
    });
    return list;
  }

  function refreshStudio() {
    withBusy(async function () {
      await loadStudios();
      if (state.studio) await openStudio(state.studio);
    });
  }

  function issueCode() {
    if (!state.studio) return;
    withBusy(async function () {
      var data = await api('POST', '/v1/admin/studios/' + state.studio + '/link-codes');
      state.code = { code: data.code, expiresAt: data.expiresAt };
      renderCode();
      toast('新的绑定码已签发，之前没用的已作废', 'ok');
    });
  }

  function renderCode() {
    var slot = $('code-slot');
    slot.replaceChildren();
    if (!state.code) return;
    var code = state.code.code;
    var usage = 'beluga studio link ' + code + ' --hub ' + location.origin;
    slot.append(el('section', { class: 'card code-card' }, [
      el('div', { class: 'section-head' }, [
        el('h2', { text: '一次性绑定码' }),
        button('收起', 'small', function () { state.code = null; renderCode(); }),
      ]),
      el('div', { class: 'code-row' }, [
        el('code', { class: 'big-code', text: code }),
        button('复制', 'small', function () { copy(code); }),
      ]),
      el('p', { class: 'muted small', text: '15 分钟内有效，只能用一次。' + (state.code.expiresAt ? ' 到 ' + time(state.code.expiresAt) + '。' : '') }),
      el('p', { class: 'muted small', text: '在 daemon 上运行：' }),
      el('div', { class: 'code-row' }, [
        el('code', { class: 'mono grow', text: usage }),
        button('复制命令', 'small', function () { copy(usage); }),
      ]),
    ]));
  }

  function daemonState(d) {
    if (d.revokedAt) return { label: '已吊销', kind: 'error', dot: 'error' };
    if (d.online) return { label: '在线', kind: 'ok', dot: 'ok' };
    var stale = d.lastSeenAt && (Date.now() - d.lastSeenAt) > 15 * 60000;
    return { label: stale ? '离线超过 15 分钟' : '离线', kind: stale ? 'error' : 'muted', dot: stale ? 'error' : 'muted' };
  }

  function findProject(d, id) {
    return (d.projects || []).filter(function (p) { return p.id === id; })[0];
  }
  function findCustomer(d, id) {
    return (d.customers || []).filter(function (c) { return c.id === id; })[0];
  }
  function daemonName(d, id) {
    var dm = (d.daemons || []).filter(function (x) { return x.id === id; })[0];
    return dm ? dm.name : id;
  }

  function renderDetail() {
    var root = $('detail');
    root.replaceChildren();
    var d = state.detail;
    if (!d) {
      root.append(el('p', { class: 'empty', text: '选一个工作室，或者新建一个。' }));
      return;
    }
    root.append(el('div', { class: 'detail-head' }, [
      el('div', {}, [
        el('h1', { text: d.studio.name }),
        el('p', { class: 'muted small' }, [el('code', { class: 'mono', text: d.studio.id })]),
      ]),
      el('div', { class: 'row tight' }, [button('刷新', '', refreshStudio), button('新绑定码', '', issueCode)]),
    ]));
    root.append(renderDaemons(d));
    root.append(renderProjects(d));
    root.append(renderCustomers(d));
    var outbox = renderOutbox(d);
    if (outbox) root.append(outbox);
    var alerts = renderAlerts(d);
    if (alerts) root.append(alerts);
  }

  function renderDaemons(d) {
    var section = el('section', { class: 'card' }, [
      el('div', { class: 'section-head' }, [el('h2', { text: '已连接的 daemon' }), button('新绑定码', 'small', issueCode)]),
    ]);
    var daemons = d.daemons || [];
    if (!daemons.length) {
      section.append(el('p', { class: 'empty', text: '还没有 daemon。点“新绑定码”，在 daemon 上运行命令：beluga studio link <code> --hub ' + location.origin + '。' }));
      return section;
    }
    daemons.forEach(function (dm) {
      var s = daemonState(dm);
      section.append(el('div', { class: 'item' }, [
        el('div', { class: 'grow' }, [
          el('div', { class: 'row tight' }, [el('span', { class: 'dot ' + s.dot }), el('strong', { text: dm.name }), el('span', { class: 'badge ' + s.kind, text: s.label })]),
          el('div', { class: 'muted small' }, [
            el('code', { class: 'mono', text: dm.id }),
            el('span', { text: dm.lastSeenAt ? ' · 最后在线 ' + time(dm.lastSeenAt) : ' · 还没连过' }),
          ]),
        ]),
        dm.revokedAt ? null : button('吊销', 'danger small', function () { revokeDaemon(dm); }),
      ]));
    });
    return section;
  }

  function revokeDaemon(dm) {
    if (!window.confirm('吊销 ' + dm.name + '？它之后不能再连接。')) return;
    withBusy(async function () {
      await api('DELETE', '/v1/admin/daemons/' + dm.id);
      toast('已吊销', 'ok');
      await openStudio(state.studio);
    });
  }

  function newProjectForm() {
    var name = el('input', { class: 'input', type: 'text', placeholder: '项目名字', maxlength: '200', required: 'required' });
    var form = el('form', { class: 'row compact' }, [name, el('button', { class: 'btn small primary', type: 'submit', text: '新建项目' })]);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var value = name.value.trim();
      if (!value) return;
      withBusy(async function () {
        await api('POST', '/v1/admin/studios/' + state.studio + '/projects', { name: value });
        toast('项目已建', 'ok');
        await openStudio(state.studio);
      });
    });
    return form;
  }

  function renderProjects(d) {
    var section = el('section', { class: 'card' }, [
      el('div', { class: 'section-head' }, [el('h2', { text: '项目' }), newProjectForm()]),
    ]);
    var projects = d.projects || [];
    if (!projects.length) {
      section.append(el('p', { class: 'empty', text: '还没有项目。建一个，再把它映射到 daemon 的项目。' }));
      return section;
    }
    projects.forEach(function (p) { section.append(projectRow(d, p)); });
    return section;
  }

  function mappingSelect(d, p) {
    var options = [];
    (d.daemons || []).filter(function (x) { return !x.revokedAt; }).forEach(function (dm) {
      (d.daemonProjects || []).forEach(function (rp) {
        if (rp.daemonId !== dm.id) return;
        options.push({ value: dm.id + '::' + rp.projectId, label: dm.name + ' · ' + rp.name + ' (' + rp.projectId + ')' });
      });
    });
    if (!options.length) return null;
    var select = el('select', { class: 'input grow' }, [el('option', { value: '', text: '选择 daemon 项目…' })]);
    options.forEach(function (o) { select.append(el('option', { value: o.value, text: o.label })); });
    return select;
  }

  function memberSelect(d, p) {
    var list = customersFor(d).filter(function (c) {
      return c.status !== 'removed' && (p.memberIds || []).indexOf(c.id) < 0;
    });
    if (!list.length) return null;
    var select = el('select', { class: 'input tiny-input' }, [el('option', { value: '', text: '加客户…' })]);
    list.forEach(function (c) { select.append(el('option', { value: c.id, text: c.name || c.email })); });
    return select;
  }

  function projectRow(d, p) {
    var row = el('div', { class: 'item stack' }, [
      el('div', { class: 'row space' }, [
        el('div', { class: 'grow' }, [
          el('strong', { text: p.name }),
          el('div', { class: 'muted small' }, [el('code', { class: 'mono', text: p.id })]),
        ]),
        p.daemonId ? button('解绑', 'small', function () { unbindProject(p); }) : null,
      ]),
    ]);
    if (p.daemonId) {
      row.append(el('div', { class: 'muted small', text: '映射到 ' + daemonName(d, p.daemonId) + ' · ' + p.daemonProjectId + '（换绑要先解绑）' }));
    } else {
      row.append(el('div', { class: 'muted small', text: '还没映射到 daemon 的项目' }));
    }
    if (!p.daemonId) {
      var select = mappingSelect(d, p);
      if (select) {
        row.append(el('div', { class: 'row tight' }, [select, button('绑定', 'small primary', function () { bindProject(p, select.value); })]));
      } else {
        row.append(el('p', { class: 'muted small', text: 'daemon 连上并上报项目后，这里才有可选项。' }));
      }
    }

    var chips = el('div', { class: 'chips' });
    (p.memberIds || []).forEach(function (cid) {
      var c = findCustomer(d, cid);
      chips.append(el('span', { class: 'chip' }, [
        el('span', { text: c ? (c.name || c.email) : cid }),
        el('button', { class: 'chip-x', type: 'button', title: '移出项目', text: '×', onclick: function () { removeMember(p, cid); } }),
      ]));
    });
    var add = memberSelect(d, p);
    if (add) chips.append(el('span', { class: 'chip-add' }, [add, button('加入', 'tiny', function () { addMember(p, add.value); })]));
    row.append(el('div', { class: 'row tight wrapping' }, [el('span', { class: 'label', text: '客户：' }), chips]));
    return row;
  }

  function bindProject(p, value) {
    if (!value) { toast('先选一个 daemon 项目', 'error'); return; }
    var parts = value.split('::');
    withBusy(async function () {
      await api('PUT', '/v1/admin/projects/' + p.id + '/daemon', { daemonId: parts[0], daemonProjectId: parts[1] });
      toast('已绑定', 'ok');
      await openStudio(state.studio);
    });
  }

  function unbindProject(p) {
    withBusy(async function () {
      await api('DELETE', '/v1/admin/projects/' + p.id + '/daemon');
      toast('已解绑', 'ok');
      await openStudio(state.studio);
    });
  }

  function addMember(p, cid) {
    if (!cid) { toast('先选一个客户', 'error'); return; }
    withBusy(async function () {
      await api('PUT', '/v1/admin/projects/' + p.id + '/members/' + cid);
      toast('已加入项目', 'ok');
      await openStudio(state.studio);
    });
  }

  function removeMember(p, cid) {
    withBusy(async function () {
      await api('DELETE', '/v1/admin/projects/' + p.id + '/members/' + cid);
      toast('已移出项目', 'ok');
      await openStudio(state.studio);
    });
  }

  function inviteForm(d) {
    var email = el('input', { class: 'input', type: 'email', placeholder: '客户邮箱', required: 'required' });
    var name = el('input', { class: 'input', type: 'text', placeholder: '名字（可选）' });
    var project = el('select', { class: 'input invite-project' }, [el('option', { value: '', text: '先不加项目' })]);
    (d.projects || []).forEach(function (p) { project.append(el('option', { value: p.id, text: p.name })); });
    var form = el('form', { class: 'row compact' }, [email, name, project, el('button', { class: 'btn small primary', type: 'submit', text: '邀请' })]);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var value = email.value.trim();
      if (!value) return;
      withBusy(async function () {
        var data = await api('POST', '/v1/admin/customers', { email: value, name: name.value.trim() });
        if (project.value) {
          await api('PUT', '/v1/admin/projects/' + project.value + '/members/' + data.customer.id);
        } else {
          // Not in any project yet, so the server's studio detail can't list the account; keep it
          // here until the operator puts it in one (an invite with no project is only this session).
          state.pending.push(data.customer);
        }
        toast(project.value ? '已邀请并加入项目' : '已邀请。接下来把他加进项目。', 'ok');
        await openStudio(state.studio);
      });
    });
    return form;
  }

  function renderCustomers(d) {
    var section = el('section', { class: 'card' }, [
      el('div', { class: 'section-head' }, [el('h2', { text: '客户' }), inviteForm(d)]),
    ]);
    var customers = customersFor(d);
    if (!customers.length) {
      section.append(el('p', { class: 'empty', text: '还没有客户。邀请一个邮箱，再把他加进项目。' }));
      return section;
    }
    customers.forEach(function (c) {
      var status = c.status === 'active' ? { label: '已登录', kind: 'ok' } : c.status === 'invited' ? { label: '已邀请', kind: 'muted' } : { label: '已移除', kind: 'error' };
      var row = el('div', { class: 'item stack' }, [
        el('div', { class: 'row space' }, [
          el('div', { class: 'grow' }, [
            el('div', { class: 'row tight' }, [el('strong', { text: c.email }), el('span', { class: 'badge ' + status.kind, text: status.label })]),
            c.name ? el('div', { class: 'muted small', text: c.name }) : null,
            el('div', { class: 'muted small', text: (c.projectIds || []).map(function (pid) { var p = findProject(d, pid); return p ? p.name : pid; }).join('、') || '不在任何项目里' }),
          ]),
          el('div', { class: 'row tight' }, [
            c.status === 'removed' ? null : button('登录链接', 'small', function () { loginLink(c); }),
            c.status === 'removed' ? null : button('移除', 'danger small', function () { removeCustomer(c); }),
          ]),
        ]),
      ]);
      if (state.links[c.id]) {
        row.append(el('div', { class: 'row tight link-row' }, [
          el('code', { class: 'mono grow', text: state.links[c.id] }),
          button('复制', 'tiny', function () { copy(state.links[c.id]); }),
        ]));
      }
      section.append(row);
    });
    return section;
  }

  function loginLink(c) {
    withBusy(async function () {
      var data = await api('POST', '/v1/admin/customers/' + c.id + '/login-link');
      state.links[c.id] = data.link;
      renderDetail();
      toast('登录链接已生成，15 分钟内有效', 'ok');
    });
  }

  function removeCustomer(c) {
    if (!window.confirm('移除 ' + c.email + '？他的会话会立刻失效。')) return;
    withBusy(async function () {
      await api('DELETE', '/v1/admin/customers/' + c.id);
      toast('已移除', 'ok');
      await openStudio(state.studio);
    });
  }

  function renderOutbox(d) {
    var list = d.outbox || [];
    if (!list.length) return null;
    var section = el('section', { class: 'card' }, [
      el('h2', { text: '待转发的登录链接' }),
      el('p', { class: 'muted small', text: '邮件没有真的发出去：把下面的链接发给客户，15 分钟内有效。' }),
    ]);
    list.forEach(function (o) {
      section.append(el('div', { class: 'item' }, [
        el('div', { class: 'grow' }, [
          el('strong', { text: o.email }),
          el('div', { class: 'muted small', text: time(o.createdAt) + ' · 到 ' + time(o.expiresAt) }),
          el('code', { class: 'mono block', text: o.link }),
        ]),
        button('复制', 'small', function () { copy(o.link); }),
      ]));
    });
    return section;
  }

  var ALERT_TEXT = {
    'bad-view': '视图没通过校验',
    'unmapped-project': 'daemon 推送了未映射的项目',
    'bad-frame': '无法解析的帧',
    'bad-receipt': '无效的动作回执',
    'patched-early': '收到尚不支持的增量帧',
  };

  function renderAlerts(d) {
    var list = d.alerts || [];
    if (!list.length) return null;
    var section = el('section', { class: 'card' }, [el('h2', { text: '告警' })]);
    list.slice(0, 10).forEach(function (a) {
      var dm = (d.daemons || []).filter(function (x) { return x.id === a.daemonId; })[0];
      section.append(el('div', { class: 'item' }, [
        el('div', { class: 'grow' }, [
          el('div', { text: ALERT_TEXT[a.what] || a.what }),
          el('div', { class: 'muted small', text: (dm ? dm.name : a.daemonId || '工作室') + ' · ' + time(a.at) }),
        ]),
        el('code', { class: 'mono small', text: a.what }),
      ]));
    });
    return section;
  }

  $('auth-form').addEventListener('submit', signIn);
  $('change').addEventListener('click', signOut);
  $('new-studio').addEventListener('submit', createStudio);

  if (state.token) {
    $('auth').hidden = true;
    $('app').hidden = false;
    $('change').hidden = false;
    $('who').textContent = '运营者';
    withBusy(function () { return loadStudios(); });
  } else {
    showAuth();
  }
})();
</script>
</body>
</html>
`;
