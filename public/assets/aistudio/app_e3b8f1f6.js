// ===== UI =====
const $ = s => document.querySelector(s);
const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = v => { if (v === null || v === undefined || isNaN(v)) return '—'; const r = Math.round(v); if (r === 0) return '$0'; const s = '$' + Math.abs(r).toLocaleString('en-US'); return r < 0 ? '(' + s + ')' : s; };
const pct = (v, d = 1) => (v === null || v === undefined || !isFinite(v)) ? '—' : (v * 100).toFixed(d) + '%';
const cls = v => v < -0.5 ? 'neg' : '';

let state = { wip: null, cost: null, pnl: null, ar: null, ap: null, settings: { horizon: 3, threshold: 1000000, jobs: {}, likely: [], overrides: {}, includeLikely: true } };
let R = null;
let ui = { mdiv: 'proj', mmonth: null, msort: { key: 'gp', dir: 1 }, div: 'all', q: '', showDone: false, editing: null, metric: 'cost', sort: { key: 'm0', dir: -1 } };
let db = null, saveTimers = {}, storeMode = 'none', pendingRender = false, starterTried = false;
const pending = new Set();
const KINDS = ['wip', 'cost', 'pnl', 'ar', 'ap', 'est', 'closed'];
const GLOBAL_KEYS = ['threshold', 'includeLikely', 'serviceRunRate', 'cash', 'report', 'lookahead', 'scorecard'];

// ---------- storage ----------
// Each report, job, division and likely job is saved as its own record, so two people editing
// different things never overwrite each other. Open screens update live.
function localGet(k) { try { const v = localStorage.getItem('pf.' + k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function localSet(k, v) { try { localStorage.setItem('pf.' + k, JSON.stringify(v)); } catch (e) {} }
const clone = x => JSON.parse(JSON.stringify(x === undefined ? null : x));
const safeId = k => String(k).replace(/[^A-Za-z0-9_.~:@+-]/g, '_') || '_';
function globals() { const g = {}; GLOBAL_KEYS.forEach(k => { if (state.settings[k] !== undefined) g[k] = state.settings[k]; }); return g; }
function persistLocal() { localSet('reports', { wip: state.wip, cost: state.cost, pnl: state.pnl, ar: state.ar, ap: state.ap, est: state.est, closed: state.closed }); localSet('settings', { settings: state.settings }); }
function queue(key, fn, ms = 500) {
  pending.add(key);
  clearTimeout(saveTimers[key]);
  saveTimers[key] = setTimeout(async () => {
    persistLocal();
    if (!db) { pending.delete(key); setSaved('Saved in this browser'); return; }
    try { await fn(); setSaved('Saved'); }
    catch (e) { setSaved(e && e.code === 'quota_exceeded' ? 'Not saved: storage is full' : 'Not saved to your account. Check your connection and reload'); }
    pending.delete(key);
  }, ms);
}
function saveReport(kind) { queue('r-' + kind, () => state[kind] ? db.doc('reports/' + kind).set(clone({ data: state[kind] })) : db.doc('reports/' + kind).delete(), 50); }
function saveGlobal() { queue('g', () => db.doc('forecast/settings').set(clone({ v: 2, settings: globals() }))); }
function saveJob(key) { queue('j-' + key, () => { const v = state.settings.jobs[key]; return v && Object.keys(v).length ? db.doc('jobs/' + safeId(key)).set(clone({ key, s: v })) : db.doc('jobs/' + safeId(key)).delete(); }); }
function saveDiv(code) { queue('d-' + code, () => db.doc('divisions/' + safeId(code)).set(clone({ code, overrides: (state.settings.overrides || {})[code] || {}, monthOv: (state.settings.monthOv || {})[code] || {} }))); }
function saveLikely(L) { if (!L.id) { L.id = 'l' + Date.now().toString(36) + Math.floor(Math.random() * 1e4); L.at = Date.now(); } queue('l-' + L.id, () => db.doc('likely/' + L.id).set(clone(L))); }
function deleteLikely(id) { queue('l-' + id, () => db.doc('likely/' + id).delete(), 50); }
function setSaved(t) { const el = $('#saved'); if (el) el.textContent = t; }
function scheduleRender() {
  const a = document.activeElement;
  if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && a.id !== 'q') { pendingRender = true; return; }
  render();
}
document.addEventListener('focusout', () => setTimeout(() => { if (pendingRender) { pendingRender = false; render(); } }, 0));
// A blank number box shows the forecast's value in grey. Fill it in before the arrows step, so ▲▼ start from that value instead of zero.
function primeNumber(e) {
  const el = e.target;
  if (!el || el.tagName !== 'INPUT' || el.type !== 'number' || el.value !== '' || el.disabled) return;
  const ph = (el.placeholder || '').replace(/[^0-9.\-]/g, '');
  if (ph !== '' && !isNaN(Number(ph))) el.value = ph;
}
document.addEventListener('pointerdown', primeNumber, true);
document.addEventListener('focusin', primeNumber, true);
document.addEventListener('keydown', e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') primeNumber(e); }, true);

async function loadStarter() {
  try {
    const res = await fetch('seed.json', { cache: 'no-store' });
    if (!res.ok) return false;
    const d = await res.json();
    if (!d || !d.wip) return false;
    for (const k of KINDS) { state[k] = d[k] || null; if (d[k]) saveReport(k); }
    toast('Loaded your 9/30 WIP, October job costs and September P&L. Drop newer reports any time.');
    return true;
  } catch (e) { return false; }
}
async function refreshPnlFromStarter() {
  try {
    if (!state.pnl || !state.pnl.depts || !state.pnl.depts['02'] || (state.pnl.depts['02'].totRevenue !== undefined && state.pnl.depts['02'].ytdRevenue !== undefined)) return false;
    const res = await fetch('seed.json', { cache: 'no-store' }); if (!res.ok) return false;
    const d = await res.json();
    if (!d.pnl || d.pnl.file !== state.pnl.file) return false;
    state.pnl = d.pnl; saveReport('pnl'); return true;
  } catch (e) { return false; }
}
// one-time move from the old single records (forecast/reports, forecast/settings) to separate records
async function migrate() {
  const [oldR, oldS, jq, rq] = await Promise.all([db.doc('forecast/reports').get(), db.doc('forecast/settings').get(), db.collection('jobs').limit(1).get(), db.collection('reports').limit(1).get()]);
  if (oldR.exists && rq.empty) { const d = clone(oldR.data()); for (const k of KINDS) if (d[k]) await db.doc('reports/' + k).set({ data: d[k] }); }
  if (oldS.exists && oldS.data().v !== 2) {
    const st = clone(oldS.data().settings || {});
    if (jq.empty) {
      for (const [k, v] of Object.entries(st.jobs || {})) await db.doc('jobs/' + safeId(k)).set({ key: k, s: v });
      const codes = new Set([...Object.keys(st.overrides || {}), ...Object.keys(st.monthOv || {})]);
      for (const c of codes) await db.doc('divisions/' + safeId(c)).set({ code: c, overrides: (st.overrides || {})[c] || {}, monthOv: (st.monthOv || {})[c] || {} });
      let i = 0; for (const L of (st.likely || [])) { const id = 'l' + Date.now().toString(36) + (i++); await db.doc('likely/' + id).set(Object.assign({}, L, { id, at: Date.now() + i })); }
    }
    const g = {}; GLOBAL_KEYS.forEach(k => { if (st[k] !== undefined) g[k] = st[k]; });
    await db.doc('forecast/settings').set({ v: 2, settings: g });
  }
}
function subscribe() {
  const onErr = () => setSaved('Live updates stopped. Reload the page to reconnect');
  db.collection('reports').onSnapshot(q => {
    q.docs.forEach(d => { if (KINDS.includes(d.id) && !pending.has('r-' + d.id)) state[d.id] = clone(d.data().data); });
    if (!q.metadata.fromCache && !starterTried) {
      starterTried = true;
      (state.wip ? refreshPnlFromStarter() : loadStarter()).then(ok => { if (ok) scheduleRender(); });
    }
    scheduleRender();
  }, onErr);
  db.doc('forecast/settings').onSnapshot(s => {
    if (s.exists && !pending.has('g')) { const g = clone(s.data().settings || {}); GLOBAL_KEYS.forEach(k => { if (g[k] !== undefined) state.settings[k] = g[k]; else delete state.settings[k]; }); }
    scheduleRender();
  }, onErr);
  db.collection('jobs').onSnapshot(q => {
    const o = {};
    q.docs.forEach(d => { const v = d.data(); if (v && v.key) o[v.key] = clone(v.s || {}); });
    for (const k of Object.keys(state.settings.jobs || {})) if (pending.has('j-' + k)) o[k] = state.settings.jobs[k];
    state.settings.jobs = o; scheduleRender();
  }, onErr);
  db.collection('divisions').onSnapshot(q => {
    const ov = {}, mo = {};
    q.docs.forEach(d => { const v = d.data(); if (!v || !v.code) return; ov[v.code] = clone(v.overrides || {}); mo[v.code] = clone(v.monthOv || {}); });
    for (const c of Object.keys(Object.assign({}, state.settings.overrides, state.settings.monthOv))) if (pending.has('d-' + c)) { ov[c] = (state.settings.overrides || {})[c]; mo[c] = (state.settings.monthOv || {})[c]; }
    state.settings.overrides = ov; state.settings.monthOv = mo; scheduleRender();
  }, onErr);
  db.collection('likely').onSnapshot(q => {
    const list = q.docs.map(d => clone(d.data())).filter(x => x && x.id);
    for (const L of (state.settings.likely || [])) if (L.id && pending.has('l-' + L.id) && !list.find(x => x.id === L.id)) list.push(L);
    list.forEach((x, i) => { const local = (state.settings.likely || []).find(y => y.id === x.id); if (local && pending.has('l-' + x.id)) list[i] = local; });
    list.sort((a, b) => (a.at || 0) - (b.at || 0));
    state.settings.likely = list; scheduleRender();
  }, onErr);
}
async function initStore() {
  let timer = setTimeout(() => { if (!db) { setSaved('Saved in this browser only'); } }, 10000);
  try {
    if (!window.claude || !window.claude.use) throw 0;
    db = await window.claude.use('db');
  } catch (e) { db = null; }
  clearTimeout(timer);
  if (!db) { storeMode = 'local'; setSaved('Saved in this browser only'); if (!state.wip ? await loadStarter() : await refreshPnlFromStarter()) render(); return; }
  storeMode = 'db';
  try { await migrate(); } catch (e) {}
  try { subscribe(); setSaved('Saved to your account · updates live'); } catch (e) { setSaved('Could not reach saved data'); }
}

// ---------- files ----------
function readFile(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const wb = XLSX.read(new Uint8Array(fr.result), { type: 'array', cellDates: true });
        res(wb.SheetNames.map(n => ({ name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }) })));
      } catch (e) { rej(e); }
    };
    fr.onerror = rej;
    fr.readAsArrayBuffer(file);
  });
}
async function handleFiles(files) {
  const msgs = [];
  for (const f of files) {
    if (/\.pdf$/i.test(f.name)) { msgs.push(`${f.name}: PDFs can't be read here. Export it from Spectrum to Excel and drop that.`); continue; }
    let sheets;
    try { sheets = await readFile(f); } catch (e) { msgs.push(`${f.name}: couldn't open this file.`); continue; }
    const kind = identify(sheets);
    if (kind === 'wip') {
      const w = parseWIP(sheets, f.name);
      if (!w.jobs.length) { msgs.push(`${f.name}: looked like a WIP but no jobs were found.`); continue; }
      state.wip = w; saveReport('wip');
      if (state.cost) { state.cost.map = detectCostColumns(state.cost, state.wip); saveReport('cost'); }
      msgs.push(`WIP loaded: ${w.jobs.length} jobs${w.asOf ? ' as of ' + mLong(w.asOf) : ''}.`);
    } else if (kind === 'cost') {
      const c = parseCost(sheets, f.name);
      if (!c.rows.length) { msgs.push(`${f.name}: looked like a cost report but no job rows were found.`); continue; }
      c.map = detectCostColumns(c, state.wip);
      state.cost = c; saveReport('cost');
      msgs.push(`Job cost report loaded: ${c.rows.length} jobs${c.asOf ? ' through ' + mLong(c.asOf) : ''}.`);
    } else if (kind === 'pnl') {
      const p = parsePNL(sheets, f.name);
      if (!Object.keys(p.depts).length) { msgs.push(`${f.name}: looked like a P&L but no department tabs (00, 01, 02, 03) were found.`); continue; }
      state.pnl = p; saveReport('pnl');
      msgs.push(`P&L loaded${p.asOf ? ' through ' + mLong(p.asOf) : ''}.`);
    } else if (kind === 'ar' || kind === 'ap') {
      const a = parseAging(sheets, f.name, kind);
      const n = Object.keys(a.jobs).length;
      if (!a.map || !n) { msgs.push(`${f.name}: looked like an ${kind.toUpperCase()} aging report, but I couldn't find the job and amount columns. Send it to Claude in the chat so the reader can be adjusted.`); continue; }
      state[kind] = a; saveReport(kind);
      const tot = Object.values(a.jobs).reduce((x, y) => x + y, 0);
      msgs.push(`${kind === 'ar' ? 'AR' : 'AP'} loaded: ${money(tot)} open on ${n} jobs${a.asOf ? ' as of ' + mLong(a.asOf) : ''}.`);
    } else msgs.push(`${f.name}: not recognized as a WIP, job cost report, P&L, AR aging or AP aging.`);
  }
  toast(msgs.join(' '));
  render();
}
function toast(t, ms) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), ms || 7000); }

// ---------- settings helpers ----------
function js(key) { return state.settings.jobs[key] || (state.settings.jobs[key] = {}); }
function setJob(key, patch) {
  const s = js(key);
  for (const k in patch) { if (patch[k] === null || patch[k] === '' || patch[k] === undefined) delete s[k]; else s[k] = patch[k]; }
  if (!Object.keys(s).length) delete state.settings.jobs[key];
  saveJob(key); render();
}

// ---------- render ----------
function render() {
  renderReports();
  const ready = state.wip && state.wip.asOf;
  $('#main').style.display = ready ? '' : 'none';
  $('#empty').style.display = ready ? 'none' : '';
  if (!ready) return;
  if (ui.report) { renderReport(); return; }
  if (ui.look) { renderLook(); return; }
  if (ui.score) { renderScore(); return; }
  R = runForecast(state);
  if (!R) return;
  renderControls();
  renderSummary();
  renderMonth();
  renderCash();
  renderWatch();
  renderJobs();
  renderLikely();
  renderOverhead();
  if (ui.editing) renderEditor();
}

function renderReports() {
  const w = state.wip, c = state.cost, p = state.pnl;
  const card = (title, ok, line1, line2, extra = '') => `<div class="rcard ${ok ? 'ok' : ''}"><div class="rt">${title}</div><div class="r1">${line1}</div><div class="r2">${line2}</div>${extra}</div>`;
  let costExtra = '';
  if (c) {
    const opts = Object.keys(c.rows.reduce((a, r) => (Object.keys(r.vals).forEach(k => a[k] = 1), a), {})).map(Number).sort((a, b) => a - b);
    const sel = (field) => `<select data-costmap="${field}">${opts.map(o => `<option value="${o}" ${c.map && c.map[field] === o ? 'selected' : ''}>${esc((c.header[o] || 'Column ' + (o + 1)).slice(-28))}</option>`).join('')}</select>`;
    const how = c.map ? (c.map.how === 'matched' ? `Columns matched to the WIP on ${c.map.score} jobs.` : 'Columns picked from the report headings; check below.') : 'Pick the columns below.';
    costExtra = `<details class="rdet" ${c.map && c.map.how === 'matched' ? '' : 'open'}><summary>${how}</summary>
      <label>Month cost ${sel('mtd')}</label><label>Job-to-date cost ${sel('jtd')}</label>
      <label>Cost month <input type="month" data-costmonth value="${esc(c.asOfOverride || c.asOf || '')}"></label></details>`;
  }
  let wipExtra = w ? `<details class="rdet" ${w.asOf ? '' : 'open'}><summary>${w.asOf ? 'WIP date read from the file name.' : 'Set the WIP month.'}</summary><label>WIP month <input type="month" data-wipmonth value="${esc(w.asOf || '')}"></label></details>` : '';
  $('#reports').innerHTML =
    card('WIP', !!w, w ? esc(w.file) : 'Not loaded', w ? `${w.jobs.length} jobs · ${w.asOf ? mLong(w.asOf) : 'month unknown'}` : 'Your WIP workbook (.xlsx)', wipExtra) +
    card('Job cost report', !!c, c ? esc(c.file) : 'Optional', c ? `${c.rows.length} jobs · costs through ${c.asOfOverride || c.asOf ? mLong(c.asOfOverride || c.asOf) : 'unknown month'}` : 'Spectrum Job Summary Cost Report, exported to Excel. Gives this month\'s actual cost before the WIP is done.', costExtra) +
    card('P&L budget comparison', !!p, p ? esc(p.file) : 'Not loaded', p ? `Year-to-date monthly averages through ${p.asOf ? mLong(p.asOf) : '?'}` : 'Gives overhead and service work order profit by department.') +
    agingCard('AR aging', state.ar, 'Detail A/R Aged Open Items, in Excel. Gives cash collected and when open invoices come in.') +
    agingCard('AP aging', state.ap, 'Aged Payables by job, in Excel. Uses the non-retention column.');
  document.querySelectorAll('[data-agemonth]').forEach(el => el.onchange = () => { state[el.dataset.agemonth].asOf = el.value || null; saveReport(el.dataset.agemonth); render(); });
  document.querySelectorAll('[data-costmap]').forEach(el => el.onchange = () => { state.cost.map = Object.assign({}, state.cost.map || {}, { [el.dataset.costmap]: +el.value, how: 'manual' }); saveReport('cost'); render(); });
  const cm = document.querySelector('[data-costmonth]'); if (cm) cm.onchange = () => { state.cost.asOfOverride = cm.value || null; saveReport('cost'); render(); };
  const wm = document.querySelector('[data-wipmonth]'); if (wm) wm.onchange = () => { state.wip.asOf = wm.value || null; saveReport('wip'); render(); };
}

function agingCard(title, a, help) {
  if (!a) return `<div class="rcard"><div class="rt">${title}</div><div class="r1">Optional</div><div class="r2">${help}</div></div>`;
  const n = Object.keys(a.jobs).length, tot = Object.values(a.jobs).reduce((x, y) => x + y, 0);
  return `<div class="rcard ok"><div class="rt">${title}</div><div class="r1">${esc(a.file)}</div><div class="r2">${money(tot)} open on ${n} jobs${a.noJob ? ' · ' + money(a.noJob) + ' no job' : ''}</div>
    <details class="rdet" ${a.asOf ? '' : 'open'}><summary>${a.asOf ? 'As of ' + mLong(a.asOf) : 'Set the report month.'}</summary><label>Month <input type="month" data-agemonth="${a.kind}" value="${esc(a.asOf || '')}"></label></details></div>`;
}
function renderControls() {
  const s = state.settings;
  $('#horizon').value = String(s.horizon || 3);
  $('#threshold').value = s.threshold || 1000000;
  $('#incLikely').checked = s.includeLikely !== false;
  const M = R.M;
  let note = `Starts from the ${mLong(state.wip.asOf)} WIP. `;
  if (M.actual) note += `${mLong(M.actual)} uses actual cost from the job cost report${state.pnl && state.pnl.asOf === M.actual ? ' and that month\'s P&L' : ''}; the months after it are forecast.`;
  else note += 'Drop a job cost report to lock in the current month\'s actual cost.';
  if (state.cost && !M.actual) note += ' (The job cost report loaded isn\'t newer than the WIP, so it isn\'t used.)';
  $('#basis').textContent = note;
}

function monthHead(withTotal = true) {
  return R.M.months.map((k, i) => `<th class="n">${mLabel(k)}${R.M.actual && i === 0 ? '<span class="tag">actual cost</span>' : ''}</th>`).join('') + (withTotal ? '<th class="n tot">Total</th>' : '');
}
function sumRow(arr) { return arr.reduce((a, b) => a + b, 0); }

function renderSummary() {
  const rows = [];
  const P = state.pnl ? state.pnl.depts : {};
  const pm = state.pnl && state.pnl.asOf;
  const yr = pm ? pm.slice(0, 4) : null;
  const yeIdx = pm ? R.M.months.map((k, i) => (k > pm && k <= yr + '-12') ? i : -1).filter(i => i >= 0) : [];
  const lastShown = R.M.months[R.M.months.length - 1];
  const yePartial = pm && lastShown < yr + '-12' && pm < yr + '-12';
  const hasYtd = !!pm && DEPT_ORDER.some(c => P[c] && P[c].ytdRevenue !== undefined && P[c].ytdRevenue !== null);
  const ytdOf = c => { const d = P[c] || {}; return { rev: d.ytdRevenue || 0, gp: d.ytdGP || 0, oh: d.ytdOverhead || 0, net: d.ytdNet !== null && d.ytdNet !== undefined ? d.ytdNet : (d.ytdGP || 0) - (d.ytdOverhead || 0) }; };
  const extraCells = (ex, isPct) => !hasYtd ? '' : !ex ? '<td class="n ytd"></td><td class="n ytd ye"></td>' :
    `<td class="n ytd ${isPct ? '' : cls(ex[0])}">${isPct ? pct(ex[0]) : money(ex[0])}</td><td class="n ytd ye ${isPct ? '' : cls(ex[1])}">${isPct ? pct(ex[1]) : money(ex[1])}</td>`;
  const line = (label, vals, opts = {}) => {
    const total = opts.pct ? null : sumRow(vals);
    const cells = vals.map(v => `<td class="n ${opts.pct ? '' : cls(v)}">${opts.pct ? pct(v) : money(v)}</td>`).join('');
    const tcell = opts.pct ? `<td class="n tot">${pct(opts.totPct)}</td>` : `<td class="n tot ${cls(total)}">${money(total)}</td>`;
    rows.push(`<tr class="${opts.cls || ''}"><td>${label}</td>${cells}${tcell}${extraCells(opts.ex, opts.pct)}</tr>`);
  };
  const ye = (ytdVal, vals) => [ytdVal, ytdVal + sumRow(yeIdx.map(i => vals[i]))];
  const span = R.M.months.length + 2 + (hasYtd ? 2 : 0);
  const block = (title, m, y, co) => {
    rows.push(`<tr class="grp ${co ? 'co' : ''}"><td colspan="${span}">${title}</td></tr>`);
    const rev = m.map(x => x.rev), gp = m.map(x => x.gp), oh = m.map(x => -x.oh), net = m.map(x => x.net);
    const eRev = ye(y.rev, rev), eGP = ye(y.gp, gp), eOH = ye(-y.oh, oh), eNet = ye(y.net, net);
    line('Revenue', rev, { ex: eRev });
    if (!co) {
      const code = title.code;
      if (m.some(x => x.likelyGP)) line('&nbsp;&nbsp;Likely jobs GP', m.map(x => x.likelyGP), { cls: 'sub' });
    }
    line('Gross profit', gp, { cls: 'b', ex: eGP });
    const tr = sumRow(rev), tg = sumRow(gp);
    line('GP %', m.map(x => x.rev ? x.gp / x.rev : null), { pct: true, totPct: tr ? tg / tr : null, cls: 'sub', ex: [eRev[0] ? eGP[0] / eRev[0] : null, eRev[1] ? eGP[1] / eRev[1] : null] });
    line('Overhead', oh, { ex: eOH });
    line('Net', net, { cls: 'net' + (co ? ' co' : ''), ex: eNet });
  };
  const tot = { rev: 0, gp: 0, oh: 0, net: 0 };
  for (const code of DEPT_ORDER) {
    const d = R.div[code]; if (!d) continue;
    const y = ytdOf(code); tot.rev += y.rev; tot.gp += y.gp; tot.oh += y.oh; tot.net += y.net;
    block(DEPTS[code], d.months, y, false);
  }
  block('Company', R.total, tot, true);
  const ytdHead = hasYtd ? `<th class="n ytd">YTD thru ${mLabel(pm)}<span class="tag">actual</span></th><th class="n ytd ye">Year end ${yr}<span class="tag">${yePartial ? 'thru ' + mLabel(lastShown) : 'YTD + forecast'}</span></th>` : '';
  $('#summary').innerHTML = `<table class="grid"><thead><tr><th></th>${monthHead()}${ytdHead}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
  // headline
  const T = R.total;
  const nets = T.map(x => x.net);
  const yeNet = hasYtd ? tot.net + sumRow(yeIdx.map(i => nets[i])) : null;
  $('#headline').innerHTML = (hasYtd ? `<div class="kpi yek"><div class="kl">Year end ${yr}${yePartial ? ' (thru ' + mLabel(lastShown) + ')' : ''}</div><div class="kv ${cls(yeNet)}">${money(yeNet)}</div><div class="ks">net · YTD ${money(tot.net)} + forecast</div></div>` : '') +
    R.M.months.map((k, i) => `<div class="kpi"><div class="kl">${mLong(k)}${R.M.actual && i === 0 ? ' · actual cost' : ''}</div><div class="kv ${cls(nets[i])}">${money(nets[i])}</div><div class="ks">net · GP ${pct(T[i].rev ? T[i].gp / T[i].rev : null)}</div></div>`).join('');
}

function renderMonth() {
  const M = R.M.months;
  if (!ui.mmonth || !M.includes(ui.mmonth)) ui.mmonth = M[R.M.actual ? 1 : 0] || M[0];
  const i = M.indexOf(ui.mmonth);
  $('#mmonths').innerHTML = M.map((k, j) => `<button class="tab ${k === ui.mmonth ? 'on' : ''}" data-mm="${k}">${mLabel(k)}${R.M.actual && j === 0 ? ' (actual cost)' : ''}</button>`).join('');
  const divs = [['proj', 'All projects'], ['00', DEPTS['00']], ['01', DEPTS['01']], ['02', DEPTS['02']], ['03', DEPTS['03']]];
  $('#mdivs').innerHTML = divs.map(([c, n]) => `<button data-md="${c}" class="${ui.mdiv === c ? 'on' : ''}">${n}</button>`).join('');
  document.querySelectorAll('[data-mm]').forEach(b => b.onclick = () => { ui.mmonth = b.dataset.mm; renderMonth(); });
  document.querySelectorAll('[data-md]').forEach(b => b.onclick = () => { ui.mdiv = b.dataset.md; renderMonth(); });
  const inDiv = d => ui.mdiv === 'proj' ? (d === '00' || d === '01') : d === ui.mdiv;
  let rows = R.jobs.filter(f => inDiv(f.job.dept)).map(f => { const m = f.months[i]; return { key: f.key, job: f.job.job, name: f.job.name, rev: m.rev, cost: m.cost, gp: m.gp, pct: m.rev > 0 ? m.gp / m.rev : null, done: m.pct, gut: gutOf(f), f }; })
    .filter(r => Math.abs(r.rev) > 100 || Math.abs(r.cost) > 100 || Math.abs(r.gp) > 100);
  if (state.settings.includeLikely !== false) for (const L of (state.settings.likely || [])) {
    if (!inDiv(L.dept)) continue; const rv = Number((L.rev || {})[ui.mmonth]) || 0; if (!rv) continue;
    const gp = rv * (Number(L.gp) || 0); rows.push({ key: null, job: 'Likely', name: L.name || 'Likely job', rev: rv, cost: rv - gp, gp, pct: L.gp || 0, done: null, likely: true });
  }
  const svc = (ui.mdiv === '02' || ui.mdiv === '03') && R.div[ui.mdiv] && R.div[ui.mdiv].runRate;
  const k = ui.msort.key, dir = ui.msort.dir;
  const kv = r => k === 'name' ? r.name.toLowerCase() : k === 'job' ? r.job : (r[k] === null ? -1e12 : r[k]);
  rows.sort((a, b) => { const x = kv(a), y = kv(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  const maxAbs = Math.max(1, ...rows.map(r => Math.abs(r.gp)));
  const shade = v => { if (Math.abs(v) < 1) return ''; const a = Math.min(1, Math.abs(v) / maxAbs); return v < 0 ? `background:rgba(179,38,30,${(0.12 + 0.55 * a).toFixed(2)});${a > 0.5 ? 'color:#fff' : ''}` : `background:rgba(31,92,79,${(0.10 + 0.5 * a).toFixed(2)});${a > 0.55 ? 'color:#fff' : ''}`; };
  const pshade = p => p === null ? '' : p < 0 ? 'background:rgba(179,38,30,.18)' : p < 0.10 ? 'background:rgba(224,161,0,.18)' : '';
  const T = rows.reduce((a, r) => ({ rev: a.rev + r.rev, cost: a.cost + r.cost, gp: a.gp + r.gp }), { rev: 0, cost: 0, gp: 0 });
  const arrow = key => ui.msort.key === key ? (ui.msort.dir < 0 ? ' ▼' : ' ▲') : '';
  const th = (key, label, c = '') => `<th class="${c} sortable ${ui.msort.key === key ? 'sorted' : ''}" data-ms="${key}">${label}${arrow(key)}</th>`;
  const body = rows.map(r => `<tr class="${r.key ? 'click' : ''}" ${r.key ? `data-edit="${esc(r.key)}"` : ''}><td class="job">${esc(r.job)}</td><td class="nm">${esc(r.name)}</td><td class="n">${money(r.rev)}</td><td class="n">${money(r.cost)}</td><td class="n" style="${shade(r.gp)}">${money(r.gp)}</td><td class="n" style="${pshade(r.pct)}">${r.pct === null ? '—' : pct(r.pct)}</td><td class="n muted">${r.done === null ? '' : pct(r.done, 0)}</td><td class="gut ${r.gut ? r.gut.dir : ''}">${r.gut ? gutLabel(r.gut) : ''}</td></tr>`).join('');
  const neg = rows.filter(r => r.gp < -1), negSum = neg.reduce((a, r) => a + r.gp, 0);
  $('#mnote').innerHTML = `${mLong(ui.mmonth)}: ${rows.length} jobs · revenue ${money(T.rev)} · profit ${money(T.gp)} (${pct(T.rev ? T.gp / T.rev : null)})${neg.length ? ` · <span class="neg">${neg.length} jobs losing ${money(negSum)}</span>` : ''}${svc ? ' · Service totals use the run rate; these are just the service contract jobs.' : ''}`;
  $('#month').innerHTML = `<table class="grid jobs mtab"><thead><tr>${th('job', 'Job')}${th('name', 'Name')}${th('rev', 'Revenue', 'n')}${th('cost', 'Cost', 'n')}${th('gp', 'Profit', 'n')}${th('pct', 'Profit %', 'n')}${th('done', 'Done', 'n')}<th>Sven's gut</th></tr></thead><tbody>${body || '<tr><td colspan="8" class="muted">No activity this month.</td></tr>'}</tbody><tfoot><tr class="ft"><td></td><td>Total</td><td class="n">${money(T.rev)}</td><td class="n">${money(T.cost)}</td><td class="n ${cls(T.gp)}">${money(T.gp)}</td><td class="n">${pct(T.rev ? T.gp / T.rev : null)}</td><td></td><td></td></tr></tfoot></table>`;
  document.querySelectorAll('#month [data-ms]').forEach(h => h.onclick = () => { const key = h.dataset.ms; if (ui.msort.key === key) ui.msort.dir = -ui.msort.dir; else ui.msort = { key, dir: key === 'gp' || key === 'pct' ? 1 : (key === 'job' || key === 'name' ? 1 : -1) }; renderMonth(); });
  bindEdit($('#month'));
}

let C$ = null;
function renderCash() {
  C$ = runCash(state, R);
  const el = $('#cash');
  const cs = Object.assign({ collectDays: 55, billDay: 20, subsPWP: true, matsPWP: 0.85, obHold: 0 }, state.settings.cash || {});
  const ctl = `<div class="controls">
    <label>Owners pay in <input type="number" id="cDays" value="${cs.collectDays}" style="width:60px"> days</label>
    <label>Billed on the <input type="number" id="cBill" value="${cs.billDay}" min="1" max="28" style="width:52px">th</label>
    <label><input type="checkbox" id="cPwp" ${cs.subsPWP ? 'checked' : ''}> Subs paid when paid</label>
    <label>Billed-ahead holds until <input type="number" id="cHold" value="${Math.round((Number(cs.obHold) || 0) * 100)}" min="0" max="95" step="5" style="width:56px">% complete</label>
    <label>Material bills held until paid <input type="number" id="cMat" value="${Math.round((Number(cs.matsPWP) || 0) * 100)}" min="0" max="100" step="5" style="width:60px">%</label>
    <label>Bank balance at the AR/AP date $<input type="number" id="cBank" step="1000" value="${cs.bank !== undefined ? cs.bank : ''}" placeholder="negative = drawn on line" style="width:130px"></label></div>`;
  if (!C$) { el.innerHTML = `<div class="sub">Drop your AR aging and AP aging reports to see cash. ${ctl}</div>`; bindCash(); return; }
  const F = C$.months;
  const head = `<th></th>${F.map(k => `<th class="n">${mLabel(k)}</th>`).join('')}`;
  let cum = cs.bank !== undefined && cs.bank !== '' ? Number(cs.bank) : null, run = 0;
  const co = C$.company;
  const rowH = (label, vals, c = '') => `<tr class="${c}"><td>${label}</td>${vals.map(v => `<td class="n ${cls(v)}">${v === null ? '' : money(v)}</td>`).join('')}</tr>`;
  const cumVals = co.map(x => (run += x.net, run));
  // same line-of-credit math as the bank report: weekly-plan balances for the near months, then the
  // forecast, with depreciation added back, vehicle loan principal paid and interest at today's balances
  // monthly model only: no weekly-plan balances mixed in, so every column adds up (the Cash lookahead tab follows the weekly sheet)
  const w = Object.assign({}, wcIn(), { knownV1: null, knownV2: null }), adj = w.dep - w.principal - w.draws;
  const LP = linePath({ M: R.M.months }, C$, w, adj);
  const at = k => { const i = R.M.months.indexOf(k); return LP && i >= 0 ? LP.vals[i] : null; };
  const ou = F.map((k, i) => C$.jobs.reduce((a, x) => a + (x.months[i] ? x.months[i].ou : 0), 0));
  window._cashC = C$;
  const rowD = (label, vals, field) => `<tr><td>${label}</td>${vals.map((v, i) => `<td class="n ${cls(v)} drillc" data-cdrill="${field}" data-k="${F[i]}" title="See what's in this number">${money(v)}</td>`).join('')}</tr>`;
  let rows = rowD('Collected on jobs', co.map(x => x.jobsIn), 'cin') + rowD('Paid on jobs', co.map(x => -x.jobsOut), 'cout') + rowH('Work order and likely job profit', co.map(x => x.wo), 'sub') + rowH('Overhead (from the P&amp;L)', co.map(x => -x.oh), 'sub');
  rows += rowH('Depreciation added back (not cash)', co.map(() => w.dep), 'sub') + rowH('Vehicle loan principal', co.map(() => -w.principal), 'sub');
  if (LP) rows += rowH('Interest at today\'s balances, beyond the P&amp;L', F.map(k => -(LP.interest[k] || 0)), 'sub');
  rows += rowH('Net cash for the month', co.map((x, i) => x.net + adj - (LP ? (LP.interest[F[i]] || 0) : 0)), 'b');
  if (LP) rows += `<tr class="net co"><td>Line of credit balance</td>${F.map(k => { const v = at(k); return `<td class="n">${v === null ? '—' : money(v)}${LP.known.has(k) ? '<span class="tag">weekly cash plan</span>' : ''}</td>`; }).join('')}</tr>` +
    rowH(`Available on the ${money(w.limit)} line`, F.map(k => at(k) === null ? null : w.limit - at(k)), 'b');
  rows += rowH('Net overbilled at month end', ou, 'sub');
  const anchorNote = C$.anchorOk ? `Cash positions start from AR and AP as of ${mLong(C$.anchor)}.` : `<span class="neg">The AR/AP month (${mLong(C$.anchor)}) doesn't match the WIP or cost report month, so cash positions may be off.</span>`;
  // jobs table
  const J = C$.jobs.filter(x => x.f.active || Math.abs(x.pos0) > 1000 || x.arOpen || x.apOpen);
  J.sort((a, b) => (a.pos0 - a.target0) - (b.pos0 - b.target0));
  const last = F.length - 1;
  const jrows = J.map(x => {
    const gap = x.pos0 - x.target0, endGap = x.months[last].pos - x.months[last].target;
    return `<tr class="click" data-edit="${esc(x.key)}"><td class="job">${esc(x.f.job.job)}</td><td class="nm">${esc(x.f.job.name)}</td><td class="n">${pct(x.f.pctStart, 0)}</td><td class="n ${cls(x.pos0)}">${money(x.pos0)}</td><td class="n">${money(x.target0)}</td><td class="n ${cls(gap)}">${money(gap)}</td><td class="n">${money(x.arOpen)}</td><td class="n">${money(x.apOpen)}</td>${x.months.map(m => `<td class="n ${cls(m.pos)}">${money(m.pos)}</td>`).join('')}<td class="n tot ${cls(x.endProfit)}">${money(x.endProfit)}</td></tr>`;
  }).join('');
  const sum = f => J.reduce((a, x) => a + f(x), 0);
  const jfoot = `<tr class="ft"><td></td><td>${J.length} jobs</td><td></td><td class="n ${cls(sum(x => x.pos0))}">${money(sum(x => x.pos0))}</td><td class="n">${money(sum(x => x.target0))}</td><td class="n ${cls(sum(x => x.pos0 - x.target0))}">${money(sum(x => x.pos0 - x.target0))}</td><td class="n">${money(sum(x => x.arOpen))}</td><td class="n">${money(sum(x => x.apOpen))}</td>${F.map((k, i) => `<td class="n">${money(sum(x => x.months[i].pos))}</td>`).join('')}<td class="n tot">${money(sum(x => x.endProfit))}</td></tr>`;
  el.innerHTML = `${ctl}<div class="sub" style="margin:6px 0 10px">${anchorNote} Overhead comes from the P&amp;L; depreciation is added back because it isn't cash. Month by month from this forecast; for the next few weeks, use the Cash lookahead, which follows the weekly cash sheet. Overbillings shrink as each job's remaining cost runs down, which uses cash even in profitable months.</div>
    <div class="scroll"><table class="grid"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>
    <h3>Cash position by job</h3><div class="sub">Cash in minus cash out, the same as Spectrum's "Net cash flow". Target is the profit earned so far (% complete × profit). Worst gap first.</div>
    <div class="scroll"><table class="grid jobs"><thead><tr><th>Job</th><th>Name</th><th class="n">Done</th><th class="n">Cash at ${C$.anchor ? mLabel(C$.anchor) + ' end' : 'start'}</th><th class="n">Profit earned (target)</th><th class="n">Gap</th><th class="n">Open AR</th><th class="n">Open AP</th>${F.map(k => `<th class="n">${mLabel(k)}</th>`).join('')}<th class="n tot">End of job</th></tr></thead><tbody>${jrows}</tbody><tfoot>${jfoot}</tfoot></table></div>`;
  bindCash(); bindEdit(el);
}
function bindCash() {
  const set = (k, v) => { state.settings.cash = Object.assign({}, state.settings.cash || {}); if (v === '' || v === null) delete state.settings.cash[k]; else state.settings.cash[k] = v; saveGlobal(); render(); };
  const d = $('#cDays'); if (d) d.onchange = e => set('collectDays', Math.max(0, Number(e.target.value) || 55));
  const b = $('#cBill'); if (b) b.onchange = e => set('billDay', Math.min(28, Math.max(1, Number(e.target.value) || 20)));
  const p = $('#cPwp'); if (p) p.onchange = e => set('subsPWP', e.target.checked);
  $('#cash').querySelectorAll('[data-cdrill]').forEach(td => td.onclick = () => {
    const field = td.dataset.cdrill, k = td.dataset.k, C$ = window._cashC;
    const its = C$.items.filter(x => x.k === k && x.field === field).map(x => ({ key: x.key, label: x.label, amt: field === 'cout' ? -x.amt : x.amt }));
    showDrill(`${field === 'cin' ? 'Collected on jobs' : 'Paid on jobs'} · ${mLong(k)}`, its, 'From the profit forecast, the AR and AP agings, and the cash settings above');
  });
  const ho = $('#cHold'); if (ho) ho.onchange = e => set('obHold', Math.min(95, Math.max(0, Number(e.target.value) || 0)) / 100);
  const mt = $('#cMat'); if (mt) mt.onchange = e => set('matsPWP', Math.min(100, Math.max(0, Number(e.target.value) || 0)) / 100);
  const k = $('#cBank'); if (k) k.onchange = e => set('bank', e.target.value === '' ? '' : Number(e.target.value));
}

function jobLink(f) { return `<a href="#" data-edit="${esc(f.key)}">${esc(f.job.job)} ${esc(f.job.name)}</a>`; }
function renderWatch() {
  const J = R.jobs;
  const first = R.M.months[0];
  const over = J.filter(f => f.flags.some(x => x.type === 'over')).map(f => ({ f, amt: f.flags.find(x => x.type === 'over').amt })).sort((a, b) => b.amt - a.amt);
  const loss = J.filter(f => f.flags.some(x => x.type === 'loss') && f.remaining > 1).map(f => ({ f, amt: f.flags.find(x => x.type === 'loss').amt })).sort((a, b) => a.amt - b.amt);
  const nofin = J.filter(f => f.flags.some(x => x.type === 'nofinish')).sort((a, b) => b.C - a.C);
  const late = J.filter(f => f.C >= 250000 && f.pctStart >= 0.75 && f.remaining > Math.max(25000, 0.02 * f.C) && f.target === null).map(f => ({ f, pt: f.C * 0.01 * Math.min(1, f.months[0].pct) })).sort((a, b) => b.pt - a.pt).slice(0, 8);
  const box = (title, sub, items) => items.length ? `<div class="wbox"><div class="wt">${title}</div><div class="ws">${sub}</div><ul>${items.join('')}</ul></div>` : '';
  $('#watch').innerHTML =
    box('Cost already past the estimate', `Cost to date is higher than the WIP's projected total cost. Each of these fades in ${mLong(first)} unless the contract goes up.`, over.map(o => `<li>${jobLink(o.f)}<span class="neg">${money(-o.amt)}</span></li>`)) +
    box('Loss jobs still running', 'The full projected loss is already booked. Any more overrun lands in the month it happens.', loss.map(o => `<li>${jobLink(o.f)}<span class="neg">${money(o.amt)}</span></li>`)) +
    box('Late-stage jobs where fade hurts most', 'What 1 point of fade would cost in the month it\'s booked.', late.map(o => `<li>${jobLink(o.f)} <em>${pct(o.f.pctStart, 0)} done</em><span>${money(o.pt)} / pt</span></li>`)) +
    box(`Jobs over ${money(state.settings.threshold)} with no finish month`, 'These use last month\'s pace until you set a finish month.', nofin.map(f => `<li>${jobLink(f)}<span>${money(f.remaining)} left</span></li>`));
  bindEdit($('#watch'));
}

// Sven's gut check: derived from the saved final GP % vs. current WIP GP %
function gutOf(f) {
  if (f.tm) return null;
  const s = state.settings.jobs[f.key] || {};
  if (s.gut === 'flat') return { dir: 'flat', pts: 0 };
  if (s.targetGP === undefined || s.targetGP === null || f.gpNow === null) return s.gut ? { dir: s.gut, pts: 0 } : null;
  const pts = (s.targetGP - f.gpNow) * 100;
  return { dir: Math.abs(pts) < 0.05 ? 'flat' : pts > 0 ? 'gain' : 'fade', pts: Math.abs(pts) };
}
function gutLabel(g) { if (!g) return ''; if (g.dir === 'flat') return '– Flat'; return (g.dir === 'gain' ? '▲ Gain ' : '▼ Fade ') + g.pts.toFixed(1) + ' pts'; }
function gutDollars(f) { const g = gutOf(f); if (!g || g.dir === 'flat' || f.gpNow === null) return 0; return f.C * (g.dir === 'gain' ? 1 : -1) * g.pts / 100; }
function modeText(f) {
  if (f.tm) return 'T&M at ' + pct(f.tmPct);
  const s = state.settings.jobs[f.key] || {};
  const anyPct = s.pct && Object.keys(s.pct).length;
  let t = f.mode === 'auto' ? 'Last month\'s pace' : f.mode === 'even' ? 'Even to ' + mLabel(f.finish) : 'Peak to ' + mLabel(f.finish);
  if (f.modeSet !== f.mode) t = 'Pace (no finish set)';
  if (anyPct) t += ' · % set';
  return t;
}
function renderJobs() {
  const tabs = [['all', 'All'], ...DEPT_ORDER.map(c => [c, DEPTS[c]])];
  $('#jobtabs').innerHTML = tabs.map(([c, n]) => `<button class="tab ${ui.div === c ? 'on' : ''}" data-div="${c}">${n}</button>`).join('');
  document.querySelectorAll('[data-div]').forEach(b => b.onclick = () => { ui.div = b.dataset.div; renderJobs(); });
  const metrics = [['cost', 'Cost'], ['rev', 'Revenue'], ['gp', 'Gross profit']];
  $('#metric').innerHTML = metrics.map(([v, t]) => `<button data-metric="${v}" class="${ui.metric === v ? 'on' : ''}">${t}</button>`).join('');
  document.querySelectorAll('[data-metric]').forEach(b => b.onclick = () => { ui.metric = b.dataset.metric; renderJobs(); });
  const q = ui.q.toLowerCase();
  let list = R.jobs.filter(f => (ui.div === 'all' || f.job.dept === ui.div) && (ui.showDone || f.active) && (!q || (f.job.job + ' ' + f.job.name).toLowerCase().includes(q)));
  const val = (m) => m[ui.metric];
  const keyFn = {
    job: f => f.job.job, name: f => f.job.name.toLowerCase(), contract: f => f.C, gp: f => f.gpNow === null ? -9 : f.gpNow, done: f => f.pctStart,
    total: f => sumRow(f.months.map(val)),
    gut: f => { const g = gutOf(f); return !g ? -999 : g.dir === 'gain' ? g.pts : g.dir === 'fade' ? -g.pts : 0; },
    gutd: f => gutDollars(f),
    co: f => f.coRev,
  };
  const sk = ui.sort.key;
  const kf = sk[0] === 'm' && /^m\d+$/.test(sk) ? (f => { const m = f.months[+sk.slice(1)]; return m ? val(m) : 0; }) : (keyFn[sk] || keyFn.contract);
  list.sort((a, b) => { const x = kf(a), y = kf(b); return (x < y ? -1 : x > y ? 1 : 0) * ui.sort.dir || b.C - a.C; });
  const n = R.M.months.length;
  const arrow = k => ui.sort.key === k ? (ui.sort.dir < 0 ? ' ▼' : ' ▲') : '';
  const th = (k, label, c = '') => `<th class="${c} sortable ${ui.sort.key === k ? 'sorted' : ''}" data-sort="${k}">${label}${arrow(k)}</th>`;
  const body = list.map(f => {
    const cells = f.months.map(m => `<td class="n ${cls(val(m))}">${money(val(m))}</td>`).join('');
    const tot = sumRow(f.months.map(val));
    const flag = f.flags.some(x => x.type === 'over' || x.type === 'loss') ? '<span class="dot r" title="Over estimate or loss"></span>' : f.flags.some(x => x.type === 'nofinish') ? '<span class="dot a" title="No finish month"></span>' : '';
    return `<tr class="click" data-edit="${esc(f.key)}"><td class="job">${flag}${esc(f.job.job)}</td><td class="nm">${esc(f.job.name)}</td><td class="n">${money(f.C)}</td><td class="n">${pct(f.gpNow)}</td><td class="gut ${(gutOf(f) || {}).dir || ''}">${gutLabel(gutOf(f))}</td><td class="n ${cls(gutDollars(f))}">${gutOf(f) ? money(gutDollars(f)) : ''}</td><td class="n">${f.coCount ? money(f.coRev) : ''}</td><td class="n">${pct(f.pctStart, 0)}</td><td class="md">${esc(modeText(f))}</td>${cells}<td class="n tot ${cls(tot)}">${money(tot)}</td></tr>`;
  }).join('');
  const totals = R.M.months.map((k, i) => sumRow(list.map(f => val(f.months[i]))));
  const gutDone = list.filter(f => gutOf(f)).length, gutSum = sumRow(list.map(gutDollars));
  const foot = `<tr class="ft"><td></td><td>${list.length} jobs</td><td colspan="2"></td><td class="muted">${gutDone} of ${list.length} checked</td><td class="n ${cls(gutSum)}">${money(gutSum)}</td><td class="n">${money(list.reduce((x, f) => x + f.coRev, 0))}</td><td colspan="2"></td>${totals.map(v => `<td class="n ${cls(v)}">${money(v)}</td>`).join('')}<td class="n tot ${cls(sumRow(totals))}">${money(sumRow(totals))}</td></tr>`;
  const mh = R.M.months.map((k, i) => th('m' + i, `${mLabel(k)}${R.M.actual && i === 0 ? '<span class="tag">actual cost</span>' : ''}`, 'n')).join('') + th('total', 'Total', 'n tot');
  const what = { cost: 'Cost each month', rev: 'Revenue earned each month', gp: 'Gross profit booked each month' }[ui.metric];
  $('#jobcap').textContent = what + ' · click a month to sort by it · scroll sideways for more months';
  $('#jobs').innerHTML = `<table class="grid jobs"><thead><tr>${th('job', 'Job')}${th('name', 'Name')}${th('contract', 'Contract', 'n')}${th('gp', 'Current GP%', 'n')}${th('gut', "Sven's gut")}${th('gutd', 'Gut $', 'n')}${th('co', 'Adjustments', 'n')}${th('done', 'Done', 'n')}<th>Cost spread</th>${mh}</tr></thead><tbody>${body || `<tr><td colspan="${n + 10}" class="muted">No jobs match.</td></tr>`}</tbody><tfoot>${foot}</tfoot></table>`;
  document.querySelectorAll('#jobs [data-sort]').forEach(h => h.onclick = () => {
    const k = h.dataset.sort;
    const textKey = k === 'job' || k === 'name';
    if (ui.sort.key === k) ui.sort.dir = -ui.sort.dir; else ui.sort = { key: k, dir: textKey ? 1 : -1 };
    renderJobs();
  });
  bindEdit($('#jobs'));
  if (R.notOnWip.length) $('#notwip').innerHTML = `${R.notOnWip.length} jobs on the cost report aren't on the WIP (work orders, new jobs) and aren't in contract-job profit: ${R.notOnWip.map(x => esc(x.job + ' ' + x.name) + ' ' + money(x.mtd)).join(', ')}.`;
  else $('#notwip').textContent = '';
}
function bindEdit(root) { root.querySelectorAll('[data-edit]').forEach(el => el.onclick = e => { e.preventDefault(); ui.editing = el.dataset.edit; renderEditor(); $('#editor').classList.add('open'); }); }

function renderEditor() {
  const f = R.jobs.find(x => x.key === ui.editing);
  if (!f) { closeEditor(); return; }
  const s = state.settings.jobs[f.key] || {};
  const j = f.job;
  const mode = s.mode || defaultMode(j, state.settings);
  const M = R.M.months;
  const fcMonths = R.M.actual ? M.slice(1) : M;
  const monthOpts = (sel) => M.map(k => `<option value="${k}" ${sel === k ? 'selected' : ''}>${mLong(k)}</option>`).join('');
  const rows = f.months.map((m, i) => {
    const isAct = m.actual;
    const input = f.tm ? '<span class="muted">—</span>' : isAct ? `<span class="muted">${pct(m.pct)}</span>` : `<input class="pin" type="number" step="0.1" min="0" max="100" data-pct="${m.k}" value="${m.pctOv !== null ? +(m.pctOv * 100).toFixed(2) : ''}" placeholder="${(m.pct * 100).toFixed(1)}">`;
    return `<tr><td>${mLong(m.k)}${isAct ? ' <span class="tag">actual</span>' : ''}</td><td class="n">${input}</td><td class="n muted">${money(m.earned)}</td><td class="n">${money(m.rev)}</td><td class="n">${money(m.cost)}</td><td class="n ${cls(m.gp)}">${money(m.gp)}</td><td class="n">${m.rev > 0 ? pct(m.gp / m.rev) : '—'}</td><td class="n muted">${f.tm ? '—' : money(j.contract * 0.01 * Math.min(1, m.pct))}</td></tr>`;
  }).join('');
  const flags = f.flags.map(x => x.type === 'over' ? `<div class="fl r">Cost to date is ${money(x.amt)} past the WIP's projected total cost. The estimate is raised to at least cost to date, which books that fade in ${mLong(M[0])}.</div>` : x.type === 'loss' ? `<div class="fl r">Projected loss of ${money(-x.amt)} on this job.</div>` : x.type === 'nofinish' ? `<div class="fl a">No finish month set, so it's using last month's pace for now.</div>` : x.type === 'pastfinish' ? `<div class="fl a">The finish month has passed but cost is left; it all lands in the first forecast month.</div>` : x.type === 'norate' ? `<div class="fl a">No recent cost to set a pace, so the remaining cost is spread over 3 months.</div>` : '').join('');
  $('#editor .panel').innerHTML = `
    <div class="ph"><div><div class="pt">${esc(j.job)} · ${esc(j.name)}</div><div class="ps">${DEPTS[j.dept] || j.dept} · contract ${money(j.contract)} · cost to date ${money(f.jtdStart)} · ${f.tm ? 'T&amp;M' : pct(f.pctStart, 1) + ' complete'}</div></div><button class="x" id="closeEd" aria-label="Close">×</button></div>
    ${flags}
    <div class="sect">Contract type</div>
    <div class="seg"><button data-tm="0" class="${f.tm ? '' : 'on'}">Fixed price</button><button data-tm="1" class="${f.tm ? 'on' : ''}">T&amp;M</button></div>
    ${f.tm ? tmBlock(f, s) : `
    ${contractPanel(f)}
    <div class="sect">How cost lands each month</div>
    <div class="seg">${[['auto', 'Last month\'s pace'], ['even', 'Even to finish'], ['peak', 'Peak to finish']].map(([v, t]) => `<button data-mode="${v}" class="${mode === v ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div class="row2">
      <label>Finish month <input type="month" id="edFinish" value="${esc(s.finish || '')}"></label>
      <label>Monthly pace <input type="number" id="edRate" step="1000" value="${s.rate !== undefined ? s.rate : ''}" placeholder="${f.rate !== null && f.rate !== undefined ? Math.round(f.rate) : 'none'}"></label>
    </div>
    <div class="hint">${mode === 'peak' ? 'Peak puts cost on an S-curve: it ramps up to the middle of the job and tails off at the end, starting from where the job is now.' : mode === 'even' ? 'Even splits the cost left equally through the finish month.' : 'Pace repeats last month\'s cost until the cost left is used up. Type a monthly pace to override it.'} Typing a % complete in any month below overrides the spread for that month.</div>
    <div class="sect">Sven's gut check</div>
    ${(() => { const g = gutOf(f); const dir = s.gut || (g ? g.dir : ''); const pts = g ? g.pts : 0; const fin = f.gpNow === null ? null : f.gpNow + (dir === 'gain' ? 1 : dir === 'fade' ? -1 : 0) * pts / 100;
      return `<div class="gutrow"><div><span class="muted">Current job profit %</span><b>${pct(f.gpNow)}</b></div>
      <div class="seg">${[['gain', '▲ Gain'], ['flat', '– Flat'], ['fade', '▼ Fade']].map(([v, t]) => `<button data-gut="${v}" class="${dir === v ? 'on ' + v : ''}">${t}</button>`).join('')}</div>
      <label class="${dir === 'gain' || dir === 'fade' ? '' : 'dim'}">by <input type="number" id="edPts" step="0.5" min="0" value="${dir === 'gain' || dir === 'fade' ? +pts.toFixed(2) : ''}" placeholder="0" ${dir === 'gain' || dir === 'fade' ? '' : 'disabled'} style="width:70px"> points</label>
      <div><span class="muted">Final GP %</span><b>${pct(fin)}</b></div>
      <div><span class="muted">Profit change</span><b class="${cls(gutDollars(f))}">${money(gutDollars(f))}</b></div></div>
      <div class="row2"><label style="flex:1">Why <input id="edGutNote" value="${esc(s.gutNote || '')}" placeholder="What Sven is seeing on the job" style="width:100%"></label></div>
      ${s.gutAt ? `<div class="hint">Last set ${esc(s.gutAt)}${s.gutBase !== undefined ? `, when the WIP had this job at ${pct(s.gutBase)}` : ''}. The final GP % is saved as a number, so when next month's WIP catches up, the points shown here shrink instead of counting the fade twice.</div>` : ''}`; })()}
    <div class="row2">
      <label>Booked <select id="edFadeMode"><option value="once" ${s.fadeMode !== 'gradual' ? 'selected' : ''}>All at once in</option><option value="gradual" ${s.fadeMode === 'gradual' ? 'selected' : ''}>Gradually through ${s.finish ? mLong(s.finish) : 'the last month shown'}</option></select></label>
      <label class="${s.fadeMode === 'gradual' ? 'dim' : ''}">Month <select id="edFadeMonth" ${s.fadeMode === 'gradual' ? 'disabled' : ''}>${monthOpts(s.fadeMonth || M[0])}</select></label>
    </div>
    ${coBlock(f)}
    `}
    <div class="sect">By month</div>
    <table class="grid ed"><thead><tr><th>Month</th><th class="n">% complete</th><th class="n">Earned to date</th><th class="n">Revenue</th><th class="n">Cost</th><th class="n">Profit</th><th class="n">GP %</th><th class="n">1 pt fade</th></tr></thead><tbody><tr class="sub"><td>${mLong(state.wip.asOf)} WIP</td><td class="n">${pct(j.pcost > 0 ? j.act / j.pcost : null)}</td><td class="n muted">${money(f.earned0)}</td><td colspan="5"></td></tr>${rows}</tbody></table>
    ${cashBlock(f.key)}
    <div class="foot"><button class="ghost" id="edReset">Reset this job</button><span class="muted">Changes save automatically.</span></div>`;
  $('#closeEd').onclick = closeEditor;
  document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => setJob(f.key, { mode: b.dataset.mode === defaultMode(j, state.settings) && !s.mode ? null : b.dataset.mode }));
  ($('#edFinish') || {}).onchange = e => setJob(f.key, { finish: e.target.value || null });
  ($('#edRate') || {}).onchange = e => setJob(f.key, { rate: e.target.value === '' ? null : Number(e.target.value) });
  const stamp = () => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const setGut = (dir, pts) => {
    if (f.gpNow === null) { setJob(f.key, { gut: dir }); return; }
    if (dir === 'flat') { setJob(f.key, { gut: 'flat', targetGP: null, gutAt: stamp(), gutBase: f.gpNow }); return; }
    const p = Math.max(0, Number(pts) || 0);
    setJob(f.key, { gut: dir, targetGP: p ? f.gpNow + (dir === 'gain' ? 1 : -1) * p / 100 : null, gutAt: stamp(), gutBase: f.gpNow });
  };
  document.querySelectorAll('[data-gut]').forEach(b => b.onclick = () => { const cur = gutOf(f); setGut(b.dataset.gut, cur && cur.dir !== 'flat' ? cur.pts : 0); });
  const ptsEl = $('#edPts'); if (ptsEl) ptsEl.onchange = e => setGut(js(f.key).gut || (gutOf(f) || {}).dir || 'fade', e.target.value);
  ($('#edGutNote') || {}).onchange = e => setJob(f.key, { gutNote: e.target.value || null });
  ($('#edFadeMode') || {}).onchange = e => setJob(f.key, { fadeMode: e.target.value === 'once' ? null : e.target.value });
  ($('#edFadeMonth') || {}).onchange = e => setJob(f.key, { fadeMonth: e.target.value });
  document.querySelectorAll('#editor [data-pct]').forEach(el => el.onchange = () => {
    const p = Object.assign({}, js(f.key).pct || {});
    if (el.value === '') delete p[el.dataset.pct]; else p[el.dataset.pct] = Number(el.value) / 100;
    setJob(f.key, { pct: Object.keys(p).length ? p : null });
  });
  $('#edReset').onclick = () => { delete state.settings.jobs[f.key]; saveJob(f.key); render(); };
  bindCos(f);
  document.querySelectorAll('#editor [data-tm]').forEach(b => b.onclick = () => setJob(f.key, { tm: b.dataset.tm === '1' ? true : null }));
  const tp = $('#edTmPct'); if (tp) tp.onchange = e => setJob(f.key, { tmPct: e.target.value === '' ? null : Number(e.target.value) / 100 });
}
function cashBlock(key) {
  if (!C$) return '';
  const x = C$.jobs.find(y => y.key === key); if (!x) return '';
  return `<div class="sect">Cash</div><div class="stats"><div><span>Cash at ${anchorLabel()}</span><b class="${cls(x.pos0)}">${money(x.pos0)}</b></div><div><span>Profit earned (target)</span><b>${money(x.target0)}</b></div><div><span>Open AR</span><b>${money(x.arOpen)}</b></div><div><span>Open AP</span><b>${money(x.apOpen)}</b></div></div>
  <table class="grid ed" style="margin-top:8px"><thead><tr><th>Month</th><th class="n">Collected</th><th class="n">Paid</th><th class="n">Cash position</th><th class="n">Target</th><th class="n">Over/(under) billed</th></tr></thead><tbody>${x.months.map(m => `<tr><td>${mLong(m.k)}</td><td class="n">${money(m.cin)}</td><td class="n">${money(-m.cout)}</td><td class="n ${cls(m.pos)}">${money(m.pos)}</td><td class="n">${money(m.target)}</td><td class="n ${cls(m.ou)}">${money(m.ou)}</td></tr>`).join('')}</tbody></table>
  <div class="hint">Cash at the end of the job equals the job's profit: ${money(x.endProfit)}.${x.later > 1 ? ' ' + money(x.later) + ' more nets in after the last month shown.' : ''}</div>`;
}
const thisMonth = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
function contractPanel(f) {
  const j = f.job, wipGP = j.contract - j.pcost, fGP = f.Cfinal - f.finalCost;
  const coNote = f.coCount ? `<div class="hint">Forecast includes adjustments not on the WIP: ${money(f.coRev)} of revenue and ${money(f.coCost)} of cost.</div>` : '';
  const row = (label, a, b, c = '') => `<tr class="${c}"><td>${label}</td><td class="n">${a}</td><td class="n">${b}</td></tr>`;
  return `<table class="grid cpanel"><thead><tr><th></th><th class="n">On the WIP</th><th class="n">Forecast</th></tr></thead><tbody>
    ${row('Contract', money(j.contract), money(f.Cfinal))}
    ${row('Projected cost', money(j.pcost), money(f.finalCost))}
    ${row('Gross profit', `<span class="${cls(wipGP)}">${money(wipGP)}</span>`, `<span class="${cls(fGP)}">${money(fGP)}</span>`, 'b')}
    ${row('GP %', pct(f.gpWip), pct(f.gpFinal))}
    ${row('Cost left', money(Math.max(0, j.pcost - f.jtdStart)), money(f.remaining), 'sub')}
  </tbody></table>${coNote}
  <div class="hint">Forecast includes Sven's gut call and any change orders. A fade raises projected cost and leaves the contract alone; if cost passes the contract, the full loss is booked right away.</div>`;
}
function tmBlock(f, s) {
  return `<div class="stats"><div><span>Earned to date (${mLabel(state.wip.asOf)} WIP)</span><b>${money(f.earned0)}</b></div><div><span>Job-to-date profit %</span><b>${pct(f.tmHist)}</b></div><div><span>Profit % used</span><b>${pct(f.tmPct)}</b></div><div><span>Monthly cost</span><b>${money(f.rate)}</b></div></div>
  <div class="row2">
    <label>Profit % <input type="number" id="edTmPct" step="0.5" value="${s.tmPct !== undefined ? +(s.tmPct * 100).toFixed(2) : ''}" placeholder="${(f.tmHist * 100).toFixed(1)}" style="width:90px"></label>
    <label>Monthly cost <input type="number" id="edRate" step="1000" value="${s.rate !== undefined ? s.rate : ''}" placeholder="${Math.round(f.rate || 0)}"></label>
    <label>Ends <input type="month" id="edFinish" value="${esc(s.finish || '')}"></label>
  </div>
  <div class="hint">T&amp;M: every dollar of cost earns revenue at the profit %, so there's no fixed contract, % complete or fade. Profit % starts at what the job has earned to date; monthly cost starts at last month's cost. Leave Ends blank if the work keeps going.</div>`;
}
function coBlock(f) {
  const s = state.settings.jobs[f.key] || {}, cos = s.cos || [];
  const M = R.M.months;
  const mopts = sel => M.map(k => `<option value="${k}" ${sel === k ? 'selected' : ''}>${mLabel(k)}</option>`).join('');
  const rows = cos.map((c, i) => `<tr>
      <td><input data-co="${i}" data-f="desc" value="${esc(c.desc || '')}" placeholder="Change order, scope, estimate update" style="width:200px"></td>
      <td class="n"><input class="mid" type="number" step="1000" data-co="${i}" data-f="value" value="${c.value ?? ''}" placeholder="0"></td>
      <td class="n"><input class="mid" type="number" step="1000" data-co="${i}" data-f="cost" value="${c.cost ?? ''}" placeholder="0"></td>
      <td class="n ${cls((Number(c.value) || 0) - (Number(c.cost) || 0))}">${money((Number(c.value) || 0) - (Number(c.cost) || 0))}</td>
      <td><select data-co="${i}" data-f="month">${mopts(c.month && M.includes(c.month) ? c.month : M[0])}</select></td>
      <td><button class="ghost sm" data-codel="${i}" aria-label="Remove">×</button></td></tr>`).join('');
  return `<div class="sect">Adjustments to final revenue and cost</div>
    <div class="hint" style="margin-top:0">For change orders, scope changes, or any update to where you think the job will finish. Each one is added to the contract and projected cost above from the month you book it in. If an adjustment turns the job into a loss, the whole loss lands that month. Remove it once it shows up on the WIP.</div>
    ${cos.length ? `<div style="overflow-x:auto"><table class="grid ed cotab"><thead><tr><th>Adjustment</th><th class="n">Revenue</th><th class="n">Cost</th><th class="n">Profit</th><th>Book in</th><th></th></tr></thead><tbody>${rows}</tbody><tfoot><tr class="ft"><td>Total</td><td class="n">${money(f.coRev)}</td><td class="n">${money(f.coCost)}</td><td class="n ${cls(f.coRev - f.coCost)}">${money(f.coRev - f.coCost)}</td><td></td><td></td></tr></tfoot></table></div>` : ''}
    <button class="ghost" id="coAdd" style="margin-top:8px">+ Add adjustment</button>`;
}
function bindCos(f) {
  const upd = (fn) => { const s = js(f.key); s.cos = (s.cos || []).map(c => Object.assign({}, c)); fn(s.cos); if (!s.cos.length) delete s.cos; saveJob(f.key); render(); };
  const add = $('#coAdd'); if (add) add.onclick = () => upd(cos => cos.push({ id: 'co' + Date.now().toString(36), desc: '', value: '', cost: '', month: R.M.months[0] }));
  document.querySelectorAll('#editor [data-co]').forEach(el => el.onchange = () => upd(cos => {
    const c = cos[+el.dataset.co], fld = el.dataset.f;
    if (fld === 'addCost') c.addCost = el.checked;
    else if (fld === 'value' || fld === 'cost') c[fld] = el.value === '' ? '' : Number(el.value);
    else c[fld] = el.value;
  }));
  document.querySelectorAll('#editor [data-codel]').forEach(b => b.onclick = () => upd(cos => cos.splice(+b.dataset.codel, 1)));
}
function closeEditor() { ui.editing = null; $('#editor').classList.remove('open'); }

function renderLikely() {
  const L = state.settings.likely || (state.settings.likely = []);
  const M = R.M.months;
  const rows = L.map((x, i) => `<tr><td><input data-l="${i}" data-f="name" value="${esc(x.name || '')}" placeholder="Job name"></td>
    <td><select data-l="${i}" data-f="dept">${DEPT_ORDER.map(c => `<option value="${c}" ${x.dept === c ? 'selected' : ''}>${DEPTS[c]}</option>`).join('')}</select></td>
    <td class="n"><input class="sm" type="number" step="0.1" data-l="${i}" data-f="gp" value="${x.gp !== undefined && x.gp !== '' ? +(x.gp * 100).toFixed(2) : ''}" placeholder="GP %"></td>
    ${M.map(k => `<td class="n"><input class="mid" type="number" step="1000" data-l="${i}" data-m="${k}" value="${x.rev && x.rev[k] !== undefined ? x.rev[k] : ''}"></td>`).join('')}
    <td><button class="ghost sm" data-ldel="${i}" aria-label="Remove">×</button></td></tr>`).join('');
  $('#likely').innerHTML = `<table class="grid"><thead><tr><th>Job</th><th>Division</th><th class="n">GP %</th>${M.map(k => `<th class="n">${mLabel(k)} revenue</th>`).join('')}<th></th></tr></thead><tbody>${rows || `<tr><td colspan="${M.length + 4}" class="muted">No likely jobs yet. Add work you expect to start that isn't on the WIP.</td></tr>`}</tbody></table>`;
  document.querySelectorAll('[data-l]').forEach(el => el.onchange = () => {
    const x = L[+el.dataset.l];
    if (el.dataset.m) { x.rev = x.rev || {}; if (el.value === '') delete x.rev[el.dataset.m]; else x.rev[el.dataset.m] = Number(el.value); }
    else if (el.dataset.f === 'gp') x.gp = el.value === '' ? '' : Number(el.value) / 100;
    else x[el.dataset.f] = el.value;
    saveLikely(x); render();
  });
  document.querySelectorAll('[data-ldel]').forEach(b => b.onclick = () => { const x = L[+b.dataset.ldel]; L.splice(+b.dataset.ldel, 1); if (x && x.id) deleteLikely(x.id); else persistLocal(); render(); });
}

function renderOverhead() {
  const p = state.pnl ? state.pnl.depts : {};
  const ov = state.settings.overrides || (state.settings.overrides = {});
  const mo = state.settings.monthOv || (state.settings.monthOv = {});
  const M = R.M.months;
  // fields: [key, label, monthField, isPct]
  const fields = [['overhead', 'Overhead', 'oh', false], ['woRevenue', 'Work order revenue', 'woRev', false], ['woPct', 'Work order GP %', 'woPct', true]];
  const show = (v, isPct) => v === '' || v === undefined || v === null ? '' : (isPct ? +(Number(v) * 100).toFixed(2) : v);
  let rows = '';
  for (const c of DEPT_ORDER) {
    const d = R.div[c];
    const svc = d.runRate;
    const pc = p[c] || {};
    const hasWo = svc || (pc.woRevenue || 0) !== 0 || (ov[c] && (ov[c].woRevenue !== undefined)) || (mo[c] && mo[c].woRevenue);
    const flds = hasWo ? fields.map(x => svc ? [x[0], { woRevenue: 'Service revenue (jobs + work orders)', woPct: 'Service GP %' }[x[0]] || x[1], x[2], x[3]] : x) : fields.slice(0, 1);
    rows += `<tr class="grp"><td colspan="${M.length + 2}">${DEPTS[c]}</td></tr>`;
    for (const [f, label, mk, isPct] of flds) {
      const base = ov[c] && ov[c][f] !== undefined ? ov[c][f] : '';
      const avgRev = svc && pc.totRevenue !== undefined ? pc.totRevenue : pc.woRevenue, avgGP = svc && pc.totGP !== undefined ? pc.totGP : pc.woProfit;
      const avg = f === 'woPct' ? +((avgRev ? avgGP / avgRev : 0) * 100).toFixed(1) : f === 'woRevenue' ? Math.round(avgRev || 0) : Math.round(pc[f] || 0);
      const cells = M.map((k, i) => {
        const v = mo[c] && mo[c][f] && mo[c][f][k] !== undefined ? mo[c][f][k] : '';
        const used = d.months[i][mk] || 0;
        const ph = isPct ? (used * 100).toFixed(1) : Math.round(used);
        return `<td class="n"><input class="${isPct ? 'sm' : 'mid'} ${v !== '' ? 'set' : ''}" type="number" step="${isPct ? 0.1 : 1000}" data-mo="${c}" data-f="${f}" data-k="${k}" data-ispct="${isPct ? 1 : ''}" value="${show(v, isPct)}" placeholder="${ph}" title="${d.months[i].fromMtd && v === '' ? 'Actual from the P&L' : ''}"></td>`;
      }).join('');
      rows += `<tr><td>${label}</td><td class="n"><input class="${isPct ? 'sm' : 'mid'} ${base !== '' ? 'set' : ''}" type="number" step="${isPct ? 0.1 : 1000}" data-ov="${c}" data-f="${f}" data-ispct="${isPct ? 1 : ''}" value="${show(base, isPct)}" placeholder="${avg}"></td>${cells}</tr>`;
    }
    if (hasWo) rows += `<tr class="sub"><td>${svc ? 'Service GP' : 'Work order GP'}</td><td></td>${M.map((k, i) => `<td class="n">${money(d.months[i].woGP)}</td>`).join('')}</tr>`;
  }
  const actualNote = state.pnl && R.M.actual && state.pnl.asOf === R.M.actual ? ` ${mLong(R.M.actual)} shows that month's actual P&L figures unless you type over them.` : '';
  const rr = state.settings.serviceRunRate !== false;
  $('#overhead').innerHTML = `<label class="sub" style="display:block;padding:10px"><input type="checkbox" id="runRate" ${rr ? 'checked' : ''}> Forecast service from a monthly run rate (revenue × GP %) instead of WIP jobs. Service jobs are short, so the run rate is steadier. Service jobs still show in the job list, but they don't add to the service totals or the cash section.</label><table class="grid"><thead><tr><th></th><th class="n">Every month</th>${M.map(k => `<th class="n">${mLabel(k)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
  <p class="muted" style="padding:0 10px">GP = revenue × GP %. Service defaults to the P&L's year-to-date monthly average of total revenue and gross profit for that division. Grey numbers are what the forecast is using. "Every month" starts from the year-to-date monthly average in the P&L${state.pnl && state.pnl.asOf ? ' through ' + mLong(state.pnl.asOf) : ''}; type there to change all months, or in one month to change just that month. Clear a box to go back.${actualNote} Overhead is the P&L's Total Overhead Costs, net of other income.</p>`;
  $('#runRate').onchange = e => { state.settings.serviceRunRate = e.target.checked; saveGlobal(); render(); };
  const valOf = el => el.value === '' ? null : (el.dataset.ispct ? Number(el.value) / 100 : Number(el.value));
  document.querySelectorAll('#overhead [data-ov]').forEach(el => el.onchange = () => {
    const c = el.dataset.ov, f = el.dataset.f, v = valOf(el);
    ov[c] = ov[c] || {};
    if (v === null) delete ov[c][f]; else ov[c][f] = v;
    if (!Object.keys(ov[c]).length) delete ov[c];
    saveDiv(c); render();
  });
  document.querySelectorAll('#overhead [data-mo]').forEach(el => el.onchange = () => {
    const c = el.dataset.mo, f = el.dataset.f, k = el.dataset.k, v = valOf(el);
    mo[c] = mo[c] || {}; mo[c][f] = mo[c][f] || {};
    if (v === null) delete mo[c][f][k]; else mo[c][f][k] = v;
    if (!Object.keys(mo[c][f]).length) delete mo[c][f];
    if (!Object.keys(mo[c]).length) delete mo[c];
    saveDiv(c); render();
  });
}

// ---------- boot ----------
function boot() {
  const fi = $('#file');
  $('#pick').onclick = () => fi.click();
  $('#pick2').onclick = () => fi.click();
  fi.onchange = () => { if (fi.files.length) handleFiles([...fi.files]); fi.value = ''; };
  let depth = 0;
  window.addEventListener('dragenter', e => { e.preventDefault(); depth++; document.body.classList.add('drag'); });
  window.addEventListener('dragleave', e => { depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove('drag'); });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => { e.preventDefault(); depth = 0; document.body.classList.remove('drag'); if (e.dataTransfer.files.length) handleFiles([...e.dataTransfer.files]); });
  $('#horizon').onchange = e => { state.settings.horizon = +e.target.value; localSet('horizon', state.settings.horizon); render(); };
  $('#threshold').onchange = e => { state.settings.threshold = Number(e.target.value) || 1000000; saveGlobal(); render(); };
  $('#incLikely').onchange = e => { state.settings.includeLikely = e.target.checked; saveGlobal(); render(); };
  $('#q').oninput = e => { ui.q = e.target.value; renderJobs(); };
  $('#showDone').onchange = e => { ui.showDone = e.target.checked; renderJobs(); };
  $('#addLikely').onclick = () => { const L = { name: '', dept: '00', gp: 0.2, rev: {} }; (state.settings.likely = state.settings.likely || []).push(L); saveLikely(L); render(); };
  $('#editor').addEventListener('click', e => { if (e.target.id === 'editor') closeEditor(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.editing) closeEditor(); });
  const lr = localGet('reports'), ls = localGet('settings');
  if (lr) { state.wip = lr.wip; state.cost = lr.cost; state.pnl = lr.pnl; state.ar = lr.ar || null; state.ap = lr.ap || null; state.est = lr.est || null; state.closed = lr.closed || null; }
  if (ls && ls.settings) state.settings = Object.assign(state.settings, ls.settings);
  const h = localGet('horizon'); state.settings.horizon = h || 6;
  bindReport();
  bindViews();
  render();
  initStore();
}


function anchorLabel() { const a = state.ar && state.ar.asOf || state.ap && state.ap.asOf; return a ? mLong(a) + ' end' : 'the AR/AP date'; }

// ---------- click-through: what's inside a cash number ----------
function jobNameOf(key) { const j = state.wip && state.wip.jobs.find(x => x.key === key); return j ? `${j.job} ${j.name}` : key; }
function showDrill(title, items, note) {
  let el = $('#drill'); if (!el) { el = document.createElement('div'); el.id = 'drill'; document.body.appendChild(el); }
  const groups = {};
  for (const it of items) { const g = it.key ? jobNameOf(it.key) : (it.group || 'Other'); (groups[g] || (groups[g] = { name: g, key: it.key, tot: 0, rows: [] })); groups[g].tot += it.amt; groups[g].rows.push(it); }
  const G = Object.values(groups).sort((a, b) => Math.abs(b.tot) - Math.abs(a.tot));
  const total = G.reduce((a, g) => a + g.tot, 0);
  const one = G.length === 1 && !G[0].key;
  const body = one ? G[0].rows.map(r => `<tr><td class="lbl">${esc(r.label)}</td><td class="n ${cls(r.amt)}">${money(r.amt)}</td></tr>`).join('')
    : G.map(g => `<tr class="dg ${g.rows.length > 1 || g.key ? 'click' : ''}" data-g="${esc(g.name)}"><td>${g.key ? `<span class="arr">▸</span>` : ''}${esc(g.name)}${g.key ? ` <a class="jl" data-edit="${esc(g.key)}">open job</a>` : ''}</td><td class="n ${cls(g.tot)}">${money(g.tot)}</td></tr>` +
      g.rows.map(r => `<tr class="dr" data-p="${esc(g.name)}" hidden><td class="lbl">${esc(r.label)}</td><td class="n ${cls(r.amt)}">${money(r.amt)}</td></tr>`).join('')).join('');
  el.innerHTML = `<div class="dbox" role="dialog" aria-label="${esc(title)}"><div class="dhead"><div><div class="dtitle">${esc(title)}</div><div class="dsub">${G.length} ${one ? 'items' : 'sources'} · total ${money(total)}${note ? ' · ' + esc(note) : ''}</div></div><button class="ghost" id="dClose">Close</button></div>
    <div class="dscroll"><table class="grid"><tbody>${body || '<tr><td>Nothing in this number.</td></tr>'}</tbody><tfoot><tr class="ft"><td>Total</td><td class="n">${money(total)}</td></tr></tfoot></table></div></div>`;
  el.hidden = false;
  const close = () => { el.hidden = true; document.removeEventListener('keydown', esc1); };
  const esc1 = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc1);
  $('#dClose').onclick = close; el.onclick = e => { if (e.target === el) close(); };
  el.querySelectorAll('tr.dg').forEach(tr => tr.onclick = e => { if (e.target.closest('a.jl')) return; const open = tr.classList.toggle('open'); el.querySelectorAll(`tr.dr[data-p="${CSS.escape(tr.dataset.g)}"]`).forEach(r => r.hidden = !open); });
  el.querySelectorAll('a.jl').forEach(a => a.onclick = e => { e.stopPropagation(); close(); if (typeof setView === 'function' && (ui.look || ui.report)) setView('main'); setTimeout(() => openEditor(a.dataset.edit), 50); });
}
function openEditor(key) { ui.editing = key; renderEditor(); $('#editor').classList.add('open'); }
