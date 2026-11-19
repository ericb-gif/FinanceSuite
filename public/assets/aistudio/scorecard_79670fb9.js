
// ---------- job scorecard: estimated vs projected profit, by estimator and PM ----------
function scIn() { return Object.assign({ names: {}, band: 1, filter: 'all', who: '', st: '', clYears: 'all', clDiv: 'all', clBy: 'est', clWho: '', clSt: '' }, state.settings.scorecard || {}); }
function scSave(p) { state.settings.scorecard = Object.assign({}, state.settings.scorecard || {}, p); saveGlobal(); persistLocal && persistLocal(); renderScore(); }
function buildScore() {
  const S = scIn(), E = state.est && state.est.jobs ? state.est.jobs : {};
  const fc = {};
  if (state.wip) { try { const R = runForecast(state); for (const f of R.jobs) if (!f.tm && f.C > 0) fc[f.job.key] = (f.C - f.finalCost) / f.C; } catch (e) {} }
  const jobs = [];
  for (const [k, x] of Object.entries(E)) {
    if (!(x.rev > 0 && x.pEst > 0 && x.pEst < 95)) continue; // no real cost budget: nothing to compare
    const estP = x.pEst / 100, fromApp = fc[k] !== undefined;
    const projP = fromApp ? fc[k] : x.pProj / 100;
    const pts = (projP - estP) * 100, chg = (projP - estP) * x.rev;
    const st = pts > S.band ? 'beat' : pts < -S.band ? 'slip' : 'on';
    jobs.push({ k, job: x.job, name: x.name.replace(/^\*/, ''), div: x.div, est: x.est || '', pm: x.pm || '', rev: x.rev, done: x.pct, estP, projP, pts, chg, st, fromApp });
  }
  const keep = j => S.filter === 'half' ? (j.done || 0) >= 50 : S.filter === 'done' ? (j.done || 0) >= 95 : true;
  const J = jobs.filter(keep);
  const roll = field => {
    const m = {};
    for (const j of J) { const c = j[field] || '(none)'; const r = m[c] || (m[c] = { code: c, n: 0, beat: 0, on: 0, slip: 0, rev: 0, estGP: 0, chg: 0 }); r.n++; r[j.st]++; r.rev += j.rev; r.estGP += j.estP * j.rev; r.chg += j.chg; }
    return Object.values(m).sort((a, b) => a.chg - b.chg);
  };
  const tot = { n: J.length, beat: 0, on: 0, slip: 0, beat$: 0, slip$: 0, chg: 0 };
  for (const j of J) { tot[j.st]++; tot.chg += j.chg; if (j.st === 'beat') tot.beat$ += j.chg; if (j.st === 'slip') tot.slip$ += j.chg; }
  return { S, jobs: J, all: jobs.length, byEst: roll('est'), byPm: roll('pm'), tot };
}
let clFetch = null;
function loadClosedFile() {
  if (clFetch || (state.closed && state.closed.jobs)) return;
  clFetch = fetch('closed.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(d => { if (d && d.jobs && !(state.closed && state.closed.jobs)) { state.closed = d; if (ui.score) renderScore(); } }).catch(() => {});
}
function renderScore() {
  const el = $('#scoredoc'); if (!el) return;
  loadClosedFile();
  if (!state.est || !state.est.jobs) { el.innerHTML = '<p>Load the Spectrum Job Overview report to see estimated vs projected profit.</p>'; return; }
  const B = buildScore(), S = B.S, T = B.tot, f$ = money;
  const nm = c => c && c !== '(none)' ? (S.names[c] ? `${esc(S.names[c])} <span class="muted">${esc(c)}</span>` : esc(c)) : '<span class="muted">not set</span>';
  const p1 = v => (v * 100).toFixed(1) + '%';
  const sg = (v, f) => `<span class="${v > 0.5 ? 'pos' : v < -0.5 ? 'neg' : ''}">${v > 0.5 ? '+' : ''}${f(v)}</span>`;
  const kp = (l, v, s, cls, st) => `<div class="kpi ${cls || ''}${st ? ' sck' : ''}${st && S.st === st ? ' on' : ''}"${st ? ` data-st="${st}" title="Show these jobs"` : ''}><div class="kl">${l}</div><div class="kv">${v}</div><div class="ks">${s}</div></div>`;
  const kpis = kp('Beat the estimate', `<span class="pos">${T.beat}</span>`, `${sg(T.beat$, f$)} more profit than bid`, '', 'beat') +
    kp('On target', T.on, `within ${S.band} point of the estimate`, '', 'on') +
    kp('Slipped', `<span class="neg">${T.slip}</span>`, `${sg(T.slip$, f$)} less profit than bid`, T.slip ? 'bad' : '', 'slip') +
    kp('Net vs estimate', sg(T.chg, f$), `${T.n} jobs compared`);
  const ptab = (title, rows) => `<div class="wbox scbox"><h3>${title}</h3><table class="grid sct"><thead><tr><th></th><th class="n">Jobs</th><th class="n">Beat</th><th class="n">On</th><th class="n">Slipped</th><th class="n">Est. GP %</th><th class="n">Proj. GP %</th><th class="n">Profit vs estimate</th></tr></thead><tbody>${rows.map(r => `<tr class="scp${S.who === title[0] + ':' + r.code ? ' sel' : ''}" data-who="${esc(title[0] + ':' + r.code)}"><td>${nm(r.code)}</td><td class="n">${r.n}</td>${['beat', 'on', 'slip'].map(k => `<td class="n ${k === 'beat' ? 'pos' : k === 'slip' ? 'neg' : ''}${r[k] ? ' scc' : ''}"${r[k] ? ` data-cst="${k}" title="Show these jobs"` : ''}>${r[k] || ''}</td>`).join('')}<td class="n">${p1(r.estGP / r.rev)}</td><td class="n">${p1((r.estGP + r.chg) / r.rev)}</td><td class="n">${sg(r.chg, f$)}</td></tr>`).join('')}</tbody></table></div>`;
  const who = S.who ? S.who.split(':') : null;
  const list = B.jobs.filter(j => (!who || (who[0] === 'E' ? (j.est || '(none)') : (j.pm || '(none)')) === who[1]) && (!S.st || j.st === S.st)).sort((a, b) => a.chg - b.chg);
  const lab = { beat: '<span class="scb pos">Beat</span>', on: '<span class="scb">On target</span>', slip: '<span class="scb neg">Slipped</span>' };
  const jt = `<table class="grid sct scj"><thead><tr><th>Job</th><th>Name</th><th>Div</th><th>Estimator</th><th>PM</th><th class="n">Contract</th><th class="n">% done</th><th class="n">Est. GP %</th><th class="n">Proj. GP %</th><th class="n">Points</th><th class="n">Profit vs estimate</th><th></th></tr></thead><tbody>${list.map(j => `<tr><td class="jn">${esc(j.job)}</td><td>${esc(j.name)}${j.fromApp ? '' : ' <span class="muted" title="Not on the WIP; projection is Spectrum\'s">·S</span>'}</td><td>${esc(j.div)}</td><td>${nm(j.est)}</td><td>${nm(j.pm)}</td><td class="n">${f$(j.rev)}</td><td class="n">${j.done == null ? '' : Math.round(j.done) + '%'}</td><td class="n">${p1(j.estP)}</td><td class="n">${p1(j.projP)}</td><td class="n">${sg(j.pts, v => v.toFixed(1))}</td><td class="n">${sg(j.chg, f$)}</td><td>${lab[j.st]}</td></tr>`).join('')}</tbody></table>`;
  const codes = [...new Set(B.jobs.flatMap(j => [j.est, j.pm]).concat(state.closed && state.closed.jobs ? state.closed.jobs.flatMap(j => [j.est, j.pm]) : []).filter(Boolean))].sort();
  el.innerHTML = `<div class="sctool"><label>Jobs <select id="scFilter"><option value="all">All active jobs</option><option value="half">Over half done</option><option value="done">95%+ done</option></select></label>
    <label>On target if within <input id="scBand" type="number" step="0.5" min="0" value="${S.band}" style="width:60px"> points</label>
    <span class="sub">Est. = Spectrum estimate with change-order budgets (${esc(state.est.asOf || '')}). Proj. = where the job is projected to finish, with Sven's calls. ·S = job not on the WIP, Spectrum's projection.</span></div>
    <div class="lakpis">${kpis}</div>
    <div class="scgrid">${ptab('Estimator', B.byEst)}${ptab('Project manager', B.byPm)}</div>
    <div class="wbox"><h3 id="scList">${who || S.st ? `${S.st ? { beat: 'Jobs that beat the estimate', on: 'Jobs on target', slip: 'Jobs that slipped' }[S.st] : 'Jobs'}${who ? ` for ${nm(who[1])}` : ''} <span class="muted">(${list.length})</span> <button class="ghost" id="scAll">Show all jobs</button>` : 'Every job, biggest slip first'}</h3><div class="scroll" style="border:0">${jt}</div></div>
    ${closedHtml(S, nm, sg, p1)}
    <details class="wbox scnames"><summary>Names for the Spectrum codes</summary><p class="sub">Type a name once and it shows everywhere on this tab.</p><div class="scng">${codes.map(c => `<label><span>${esc(c)}</span><input data-scname="${esc(c)}" value="${esc(S.names[c] || '')}"></label>`).join('')}</div></details>`;
  $('#scFilter').value = S.filter;
  $('#scFilter').onchange = e => scSave({ filter: e.target.value });
  $('#scBand').onchange = e => scSave({ band: Math.max(0, Number(e.target.value) || 0) });
  const jump = () => { const h = $('#scList'); if (h) h.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  el.querySelectorAll('[data-who]').forEach(r => r.onclick = e => { const c = e.target.closest('[data-cst]'); if (c) { scSave({ who: r.dataset.who, st: c.dataset.cst }); jump(); return; } scSave({ who: S.who === r.dataset.who ? '' : r.dataset.who, st: '' }); });
  el.querySelectorAll('[data-st]').forEach(t => t.onclick = () => { scSave({ st: S.st === t.dataset.st ? '' : t.dataset.st, who: '' }); if (scIn().st) jump(); });
  const all = $('#scAll'); if (all) all.onclick = () => scSave({ who: '', st: '' });
  bindClosed(S);
  el.querySelectorAll('[data-scname]').forEach(i => i.onchange = () => { const n = Object.assign({}, scIn().names); const v = i.value.trim(); if (v) n[i.dataset.scname] = v; else delete n[i.dataset.scname]; scSave({ names: n }); });
}

// ---------- closed jobs: estimator track record ----------
const CL_GROUPS = { est: 'Estimator', pm: 'Project manager', cust: 'Customer', div: 'Division' };
const CL_COST = [['lab', 'Labor, burden & fringe'], ['mat', 'Material'], ['sub', 'Subs'], ['trv', 'Travel (meals, per diem, hotels, fuel)'], ['rnt', 'Rentals & equipment'], ['tmp', 'Temp labor'], ['oth', 'Tools, permits & other']];
const DIVN = { '00': 'BG Projects', '01': 'TC Projects', '02': 'BG Service', '03': 'TC Service' };
function clc(j, k, i) { return ((j.c || {})[k] || [0, 0])[i] || 0; }
function clYear(j) { const m = /(\d{4})$/.exec(j.done || ''); return m ? +m[1] : null; }
function buildClosed(S) {
  const C = state.closed && state.closed.jobs ? state.closed.jobs : [];
  const ok = C.filter(j => j.rev >= 25000 && j.ec > 0 && j.ac >= 0.3 * j.ec && j.ec / j.rev > 0.3 && j.ec / j.rev < 1.25);
  const yr = S.clYears === 'all' ? 0 : +S.clYears;
  const J = ok.filter(j => (!yr || (clYear(j) || 0) >= yr) && (S.clDiv === 'all' || j.div === S.clDiv)).map(j => {
    const estP = (j.rev - j.ec) / j.rev, actP = (j.rev - j.ac) / j.rev, d = actP - estP;
    return Object.assign({}, j, { estP, actP, vs: j.ec - j.ac, st: d * 100 > S.band ? 'beat' : d * 100 < -S.band ? 'slip' : 'on', yr: clYear(j) });
  });
  const roll = g => { const r = { n: g.length, rev: 0, ec: 0, ac: 0, beat: 0, on: 0, slip: 0, loss: 0, h: 0, he: 0, trv: 0, tre: 0 }; for (const j of g) { r.rev += j.rev; r.ec += j.ec; r.ac += j.ac; r[j.st]++; if (j.actP < 0) r.loss++; r.h += j.hrs[0]; r.he += j.hrs[1]; r.trv += clc(j, 'trv', 0); r.tre += clc(j, 'trv', 1); } r.vs = r.ec - r.ac; return r; };
  const key = j => S.clBy === 'div' ? (DIVN[j.div] || j.div) : (j[S.clBy] || '(none)');
  const m = {}; for (const j of J) (m[key(j)] = m[key(j)] || []).push(j);
  const rows = Object.entries(m).map(([k, g]) => Object.assign({ code: k }, roll(g))).sort((a, b) => a.vs - b.vs);
  const cost = CL_COST.map(([k, l]) => ({ k, l, a: J.reduce((s, j) => s + clc(j, k, 0), 0), e: J.reduce((s, j) => s + clc(j, k, 1), 0) }));
  return { J, rows, tot: roll(J), cost, all: ok.length };
}
function closedHtml(S, nm, sg, p1) {
  if (!state.closed || !state.closed.jobs) return `<div class="wbox"><h3>Closed jobs track record</h3><p class="sub">Send me Spectrum's Job Overview report for completed jobs and the estimator track record will show here.</p></div>`;
  const B = buildClosed(S), T = B.tot, f$ = money;
  const hp = (h, e) => e ? Math.round(h / e * 100) + '%' : '';
  const name = c => S.clBy === 'est' || S.clBy === 'pm' ? nm(c) : esc(c);
  const sel = S.clWho;
  const list = (sel ? B.J.filter(j => (S.clBy === 'div' ? (DIVN[j.div] || j.div) : (j[S.clBy] || '(none)')) === sel) : B.J).filter(j => !S.clSt || j.st === S.clSt).sort((a, b) => a.vs - b.vs);
  const opt = (v, cur, l) => `<option value="${v}"${String(cur) === String(v) ? ' selected' : ''}>${l}</option>`;
    const kp = (l, v, s, st) => `<div class="kpi${st ? ' sck' : ''}${st && S.clSt === st ? ' on' : ''}"${st ? ` data-clst="${st}" title="Show these jobs"` : ''}><div class="kl">${l}</div><div class="kv">${v}</div><div class="ks">${s}</div></div>`;
  const tiles = kp('Closed jobs', T.n, `${f$(T.rev)} revenue`) +
    kp('Estimated vs actual GP', `${p1((T.rev - T.ec) / T.rev)} → ${p1((T.rev - T.ac) / T.rev)}`, `${sg(T.vs, f$)} vs estimate`) +
    kp('Beat the estimate', `<span class="pos">${T.beat}</span>`, `${T.on} on target · click to list`, 'beat') +
    kp('Slipped', `<span class="neg">${T.slip}</span>`, `${T.loss} lost money · click to list`, 'slip') +
    kp('Labor hours vs estimate', hp(T.h, T.he), `${Math.round(T.h - T.he).toLocaleString()} hours ${T.h > T.he ? 'over' : 'under'}`);
  const rt = `<table class="grid sct"><thead><tr><th>${CL_GROUPS[S.clBy]}</th><th class="n">Jobs</th><th class="n">Revenue</th><th class="n">Beat</th><th class="n">On</th><th class="n">Slipped</th><th class="n">Lost money</th><th class="n">Est. GP %</th><th class="n">Actual GP %</th><th class="n">vs estimate</th><th class="n">Labor hrs vs est.</th><th class="n">Travel vs budget</th></tr></thead><tbody>${B.rows.map(r => `<tr class="scp${sel === r.code ? ' sel' : ''}" data-clwho="${esc(r.code)}"><td>${name(r.code)}</td><td class="n">${r.n}</td><td class="n">${f$(r.rev)}</td>${['beat', 'on', 'slip'].map(k => `<td class="n ${k === 'beat' ? 'pos' : k === 'slip' ? 'neg' : ''}${r[k] ? ' scc' : ''}"${r[k] ? ` data-clcst="${k}"` : ''}>${r[k] || ''}</td>`).join('')}<td class="n">${r.loss || ''}</td><td class="n">${p1((r.rev - r.ec) / r.rev)}</td><td class="n">${p1((r.rev - r.ac) / r.rev)}</td><td class="n">${sg(r.vs, f$)}</td><td class="n${r.he && r.h / r.he > 1.1 ? ' neg' : ''}">${hp(r.h, r.he)}</td><td class="n">${r.trv - r.tre > 1000 ? `<span class="neg">${f$(r.trv - r.tre)} over</span>` : ''}</td></tr>`).join('')}</tbody></table>`;
  const ct = `<table class="grid sct"><thead><tr><th>Cost type</th><th class="n">Actual</th><th class="n">Estimate</th><th class="n">Over / (under)</th><th class="n">Points of revenue</th></tr></thead><tbody>${B.cost.map(c => `<tr><td>${c.l}</td><td class="n">${f$(c.a)}</td><td class="n">${f$(c.e)}</td><td class="n ${c.a - c.e > 1000 ? 'neg' : c.a - c.e < -1000 ? 'pos' : ''}">${f$(c.a - c.e)}</td><td class="n">${T.rev ? ((c.a - c.e) / T.rev * 100).toFixed(1) : ''}</td></tr>`).join('')}</tbody></table>`;
  const lab = { beat: '<span class="scb pos">Beat</span>', on: '<span class="scb">On target</span>', slip: '<span class="scb neg">Slipped</span>' };
  const jt = `<table class="grid sct scj"><thead><tr><th>Job</th><th>Name</th><th>Div</th><th>Estimator</th><th>PM</th><th>Customer</th><th>Done</th><th class="n">Contract</th><th class="n">Est. GP %</th><th class="n">Actual GP %</th><th class="n">vs estimate</th><th class="n">Labor hrs</th><th></th></tr></thead><tbody>${list.map(j => `<tr><td class="jn">${esc(j.job)}</td><td>${esc(j.name)}</td><td>${esc(j.div)}</td><td>${nm(j.est)}</td><td>${nm(j.pm)}</td><td class="scu">${esc(j.cust)}</td><td>${esc(j.done)}</td><td class="n">${f$(j.rev)}</td><td class="n">${p1(j.estP)}</td><td class="n">${p1(j.actP)}</td><td class="n">${sg(j.vs, f$)}</td><td class="n${j.hrs[1] && j.hrs[0] / j.hrs[1] > 1.1 ? ' neg' : ''}">${hp(j.hrs[0], j.hrs[1])}</td><td>${lab[j.st]}</td></tr>`).join('')}</tbody></table>`;
  const heading = `${S.clSt ? { beat: 'Closed jobs that beat the estimate', on: 'Closed jobs on target', slip: 'Closed jobs that slipped' }[S.clSt] : 'Closed jobs'}${sel ? ` for ${name(sel)}` : ''} <span class="muted">(${list.length})</span>${sel || S.clSt ? ' <button class="ghost" id="clAll">Show all</button>' : ', biggest slip first'}`;
  return `<h2 class="clh">Closed jobs track record</h2>
    <div class="sctool"><label>Completed <select id="clYears">${opt('all', S.clYears, 'All years')}${[2026, 2025, 2024, 2023].map(y => opt(y, S.clYears, y + ' and later')).join('')}</select></label>
    <label>Division <select id="clDiv">${opt('all', S.clDiv, 'All')}${Object.entries(DIVN).map(([k, v]) => opt(k, S.clDiv, v)).join('')}</select></label>
    <label>Group by <select id="clBy">${Object.entries(CL_GROUPS).map(([k, v]) => opt(k, S.clBy, v)).join('')}</select></label>
    <span class="sub">${esc(state.closed.file || '')}. ${B.all} jobs of $25k or more with an estimate and costs booked. Est. = Spectrum estimate including change-order budgets; Actual = final cost. Labor hours over 110% of estimate show red.</span></div>
    <div class="lakpis cl5">${tiles}</div>
    <div class="wbox scbox"><h3>By ${CL_GROUPS[S.clBy].toLowerCase()}, biggest slip first</h3>${rt}</div>
    <div class="wbox scbox" style="margin-top:12px"><h3>Where the money went <span class="muted">(estimate vs actual, every job in this view)</span></h3>${ct}</div>
    <div class="wbox" style="margin-top:12px"><h3 id="clList">${heading}</h3><div class="scroll" style="border:0">${jt}</div></div>`;
}
function bindClosed(S) {
  const el = $('#scoredoc'), go = () => { const h = $('#clList'); if (h) h.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const on = (id, f) => { const x = $(id); if (x) x.onchange = f; };
  on('#clYears', e => scSave({ clYears: e.target.value }));
  on('#clDiv', e => scSave({ clDiv: e.target.value, clWho: S.clBy === 'div' ? '' : S.clWho }));
  on('#clBy', e => scSave({ clBy: e.target.value, clWho: '' }));
  el.querySelectorAll('[data-clwho]').forEach(r => r.onclick = e => { const c = e.target.closest('[data-clcst]'); if (c) { scSave({ clWho: r.dataset.clwho, clSt: c.dataset.clcst }); go(); return; } scSave({ clWho: S.clWho === r.dataset.clwho ? '' : r.dataset.clwho, clSt: '' }); go(); });
  el.querySelectorAll('[data-clst]').forEach(t => t.onclick = () => { scSave({ clSt: S.clSt === t.dataset.clst ? '' : t.dataset.clst }); go(); });
  const a = $('#clAll'); if (a) a.onclick = () => scSave({ clWho: '', clSt: '' });
}
