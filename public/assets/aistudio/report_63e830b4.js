
// ---------- bank & bonding report ----------
// A clean, read-only view of the same forecast: no gut checks, adjustments or inputs.
// TC Projects (01) and TC Service (03) are reported together as one division.
const RDIVS = [
  { id: 'bgp', name: 'BG Projects', codes: ['00'] },
  { id: 'tc', name: 'TC Projects & Service', codes: ['01', '03'] },
  { id: 'bgs', name: 'BG Service', codes: ['02'] },
];
const COMPANY = 'JRT Mechanical, Inc.';
// Depreciation and interest expense by department from the Sep 2026 P&L, for a P&L loaded before the app read them
const PNL_DA_FALLBACK = { '2026-09': {"00":{"depAvg":42216.79,"depYtd":379951.1,"intAvg":8488.91,"intYtd":76400.21},"01":{"depAvg":22273.08,"depYtd":200457.73,"intAvg":5341.34,"intYtd":48072.07},"02":{"depAvg":7703.49,"depYtd":69331.38,"intAvg":1818.95,"intYtd":16370.59},"03":{"depAvg":2363.86,"depYtd":21274.77,"intAvg":408.74,"intYtd":3678.65}} };
function daOf(code) {
  const d = state.pnl && state.pnl.depts && state.pnl.depts[code] || {};
  if (d.depAvg !== undefined) return d;
  const fb = PNL_DA_FALLBACK[state.pnl && state.pnl.asOf] || {};
  return fb[code] || { depAvg: 0, depYtd: 0, intAvg: 0, intYtd: 0 };
}
function rget(k, d) { const v = localGet('r.' + k); return v === null ? d : v; }
function rset(k, v) { localSet('r.' + k, v); }
function reportSettings() { return state.settings.report || {}; }

function buildReport(forceH) {
  const span = rget('span', 'ye');
  let h = 6;
  const R1 = runForecast(Object.assign({}, state, { settings: Object.assign({}, state.settings, { horizon: 1 }) }));
  if (!R1) return null;
  const first = R1.M.months[0];
  if (forceH) h = forceH;
  else if (span === 'ye') h = Math.max(1, mDiff(first.slice(0, 4) + '-12', first) + (R1.M.actual ? 0 : 1));
  else h = +span || 6;
  const RR = runForecast(Object.assign({}, state, { settings: Object.assign({}, state.settings, { horizon: h }) }));
  const M = RR.M.months, n = M.length;
  const P = state.pnl ? state.pnl.depts : {};
  const pm = state.pnl && state.pnl.asOf;
  const yr = pm ? pm.slice(0, 4) : (first.slice(0, 4));
  const yeIdx = M.map((k, i) => (!pm || k > pm) && k <= yr + '-12' ? i : -1).filter(i => i >= 0);
  const hasYtd = !!pm && Object.values(P).some(d => d && d.ytdRevenue !== undefined && d.ytdRevenue !== null);
  const zero = () => M.map(() => ({ rev: 0, cost: 0, gp: 0, oh: 0, net: 0, ebitda: 0 }));
  const divs = RDIVS.map(D => ({ id: D.id, name: D.name, codes: D.codes, months: zero(), lines: [], ytd: { rev: 0, cost: 0, gp: 0, oh: 0, net: 0, ebitda: 0 }, backlog: { rev: 0, gp: 0, jobs: 0 } }));
  const known = new Set(RDIVS.flatMap(D => D.codes));
  if (Object.keys(RR.div).some(c => !known.has(c) && RR.div[c].months.some(m => Math.abs(m.rev) > 1 || Math.abs(m.oh) > 1)))
    divs.push({ id: 'oth', name: 'Other', codes: Object.keys(RR.div).filter(c => !known.has(c)), months: zero(), lines: [], ytd: { rev: 0, cost: 0, gp: 0, oh: 0, net: 0, ebitda: 0 }, backlog: { rev: 0, gp: 0, jobs: 0 } });
  const divOf = code => divs.find(d => d.codes.includes(code)) || null;
  // division totals straight from the forecast
  for (const d of divs) for (const c of d.codes) {
    const x = RR.div[c]; if (!x) continue;
    const da = daOf(c);
    x.months.forEach((m, i) => { const t = d.months[i]; t.rev += m.rev; t.gp += m.gp; t.cost += m.rev - m.gp; t.oh += m.oh; t.net += m.net; t.ebitda += m.net + (da.depAvg || 0) + (da.intAvg || 0); });
    const y = P[c] || {};
    d.ytd.rev += y.ytdRevenue || 0; d.ytd.gp += y.ytdGP || 0; d.ytd.oh += y.ytdOverhead || 0;
    d.ytd.net += (y.ytdNet !== null && y.ytdNet !== undefined) ? y.ytdNet : (y.ytdGP || 0) - (y.ytdOverhead || 0);
    { const da = daOf(c); d.ytd.ebitda += ((y.ytdNet !== null && y.ytdNet !== undefined) ? y.ytdNet : (y.ytdGP || 0) - (y.ytdOverhead || 0)) + (da.depYtd || 0) + (da.intYtd || 0); }
  }
  for (const d of divs) d.ytd.cost = d.ytd.rev - d.ytd.gp;
  // job lines
  for (const f of RR.jobs) {
    const code = f.job.dept;
    const d = divOf(DEPTS[code] ? code : 'other'); if (!d) continue;
    if (RR.div[code] && RR.div[code].runRate) continue; // service run rate replaces its jobs
    const vals = f.months.map(m => ({ rev: m.rev, gp: m.gp, cost: m.rev - m.gp }));
    if (!vals.some(v => Math.abs(v.rev) > 0.5 || Math.abs(v.cost) > 0.5)) continue;
    const ex = state.est && state.est.jobs ? state.est.jobs[f.job.key] : null;
    const estP = ex && ex.rev > 0 && ex.pEst > 0 && ex.pEst < 95 ? ex.pEst / 100 : null; // jobs with no cost budget show 100%: leave blank
    const projP = !f.tm && f.C > 0 ? (f.C - f.finalCost) / f.C : null;
    d.lines.push({ kind: 'job', key: f.job.key, job: f.job.job, name: f.job.name, contract: f.tm ? null : f.job.contract, tm: !!f.tm, done: f.tm ? null : f.pctStart, vals, estP, projP, estRev: ex ? ex.rev : 0, projC: f.C || 0 });
    if (!f.tm && f.job.contract > 0) {
      const left = Math.max(0, f.job.contract - (f.earned0 || 0));
      if (left > 1) {
        const fLeft = Math.max(1, f.C - (f.earned0 || 0));
        const gpLeft = (f.C - f.finalCost) - ((f.earned0 || 0) - (f.job.act || 0));
        d.backlog.rev += left; d.backlog.gp += gpLeft * Math.min(1, left / fLeft); d.backlog.jobs++;
      }
    }
  }
  for (const d of divs) {
    // jobs with under $10k of revenue and profit in the whole period go into one line, so the schedule shows the jobs that matter
    const small = d.lines.filter(L => L.kind === 'job' && Math.abs(sumRow(L.vals.map(v => v.rev))) < 10000 && Math.abs(sumRow(L.vals.map(v => v.gp))) < 10000 && L.vals.every(v => Math.abs(v.rev) < 10000 && Math.abs(v.gp) < 10000));
    if (small.length > 1) {
      d.lines = d.lines.filter(L => !small.includes(L));
      d.lines.push({ kind: 'line', small: true, name: `Smaller and completed jobs (${small.length})`, names: small.map(L => `${L.job} ${L.name}`), vals: M.map((_, i) => ({ rev: sumRow(small.map(L => L.vals[i].rev)), gp: sumRow(small.map(L => L.vals[i].gp)), cost: sumRow(small.map(L => L.vals[i].cost)) })) });
    }
    d.lines.sort((a, b) => (a.small ? 1 : 0) - (b.small ? 1 : 0) || sumRow(b.vals.map(v => v.rev)) - sumRow(a.vals.map(v => v.rev)));
    for (const c of d.codes) {
      const x = RR.div[c]; if (!x) continue;
      const lab = DEPTS[c] || 'Other';
      const wo = x.months.map(m => ({ rev: m.woRev || 0, gp: m.woGP || 0, cost: (m.woRev || 0) - (m.woGP || 0) }));
      if (wo.some(v => Math.abs(v.rev) > 0.5)) d.lines.push({ kind: 'line', name: x.runRate ? `${lab} work (monthly run rate)` : `${lab} work orders`, vals: wo });
      const lk = x.months.map(m => ({ rev: m.likelyRev || 0, gp: m.likelyGP || 0, cost: (m.likelyRev || 0) - (m.likelyGP || 0) }));
      if (lk.some(v => Math.abs(v.rev) > 0.5)) d.lines.push({ kind: 'line', name: `${lab}: expected new work, not yet on the WIP`, vals: lk });
    }
  }
  const co = { name: 'Company total', months: zero(), ytd: { rev: 0, cost: 0, gp: 0, oh: 0, net: 0, ebitda: 0 }, backlog: { rev: 0, gp: 0, jobs: 0 } };
  for (const d of divs) {
    d.months.forEach((m, i) => { for (const k in m) co.months[i][k] += m[k]; });
    for (const k in d.ytd) co.ytd[k] += d.ytd[k];
    for (const k in d.backlog) co.backlog[k] += d.backlog[k];
  }
  const ye = (d, f) => (hasYtd ? d.ytd[f] : 0) + sumRow(yeIdx.map(i => d.months[i][f]));
  const yeComplete = M.includes(yr + '-12');
  // next year to date: the months shown that fall in the following year
  const ny = String(+yr + 1), nyIdx = M.map((k, i) => k.slice(0, 4) === ny ? i : -1).filter(i => i >= 0);
  const y2 = (d, f) => sumRow(nyIdx.map(i => d.months[i][f]));
  return { RR, M, n, divs, co, hasYtd, pm, yr, yeIdx, ye, yeComplete, ny, nyIdx, y2, actual: RR.M.actual, span };
}

// ---------- liquidity: line of credit and working capital ----------
// The line renews at the same terms. Shows whether the line stays under its limit with a cushion
// for swings inside the month, and how much cash would have to go in if it doesn't.
const WC_DEFAULTS = { asOf: '2026-09', ca: 13995554, cl: 16092338, locAsOf: 3254985, limit: 4500000, renew: '2027-04', rate: 0.07,
  dep: 74558, principal: 37632, draws: 0, cushion: 350000, slowDays: 10, pwpShare: 0.46,
  histInterest: 16058, vehBal: 877105, vehRate: 0.055, capAmt: 0, capMonth: '2027-01', thru: '2027-07', contDesc: '', contAmt: 0,
  knownM1: '2026-11', knownV1: 4316291, knownM2: '2026-12', knownV2: 3982333 };
function wcIn() {
  const w = Object.assign({}, WC_DEFAULTS, (reportSettings().wc || {}));
  if (w.lineStart === undefined || w.lineStart === '' || w.lineStart === null) { const b = (state.settings.cash || {}).bank; w.lineStart = typeof b === 'number' && b < 0 ? -b : null; }
  for (const k of ['ca', 'cl', 'locAsOf', 'limit', 'rate', 'dep', 'principal', 'draws', 'cushion', 'slowDays', 'pwpShare', 'histInterest', 'vehBal', 'vehRate', 'capAmt', 'contAmt', 'lineStart', 'knownV1', 'knownV2']) if (w[k] !== null && w[k] !== '') w[k] = Number(w[k]);
  return w;
}
function linePath(B, C, w, adj, extraFn) {
  if (!C || w.lineStart === null) return null;
  const coBy = {}; C.company.forEach(c => coBy[c.k] = c);
  let line = null, prev = null; const known = new Set(), interest = {};
  const vals = B.M.map((k, i) => {
    const kv = k === w.knownM1 && w.knownV1 ? w.knownV1 : k === w.knownM2 && w.knownV2 ? w.knownV2 : null;
    if (k === C.anchor) line = kv !== null ? kv : w.lineStart;
    else if (k > C.anchor && line !== null) {
      const c = coBy[k];
      // interest at today's balances, less what the P&L overhead already carries
      const veh = Math.max(0, w.vehBal - w.principal * Math.max(0, mDiff(k, w.asOf)));
      const intTrue = Math.max(0, line) * w.rate / 12 + veh * w.vehRate / 12 - w.histInterest;
      interest[k] = intTrue;
      line = kv !== null ? kv : c ? line - (c.net + adj) + intTrue : null;
    }
    if (kv !== null && k >= C.anchor) known.add(k);
    if (line !== null && w.capAmt > 0 && k === w.capMonth) line -= w.capAmt;
    let v = k >= C.anchor ? line : null;
    if (v !== null && extraFn) v += extraFn(k);
    return v;
  });
  return { vals, known, interest };
}
function buildLiquidity(B0) {
  const w = wcIn();
  // always run through the line's renewal month so the squeeze before it shows
  const last = B0.M[B0.M.length - 1], end = (w.thru && w.thru > w.renew) ? w.thru : w.renew, extra = mDiff(end, last);
  const B = extra > 0 ? buildReport(B0.M.length - (B0.actual ? 1 : 0) + extra) : B0;
  const adj = w.dep - w.principal - w.draws;
  let C = null;
  try { if (state.ar || state.ap) C = runCash(state, B.RR); } catch (e) { C = null; }
  const P = linePath(B, C, w, adj);
  // Stress: after the weekly plan, every month's collections arrive slowDays later. The cash that
  // slips past month end (slowDays/30 of that month's collections) sits on the line meanwhile.
  // Paid-when-paid subs would slip with it, so this is on the cautious side.
  let PS = null;
  if (P && w.slowDays > 0) {
    const lastKnown = [...P.known].sort().pop() || C.anchor, inBy = {};
    C.company.forEach(c => inBy[c.k] = c.jobsIn);
    const fr = Math.min(1, w.slowDays / 30);
    // bills paid when the owner pays (materials and subs) slip with the collections, so only the rest sits on the line
    const costRatio = k => { const i = B.M.indexOf(k), m = B.co.months[i]; return m && m.rev > 0 ? Math.min(1, m.cost / m.rev) : 0.8; };
    const slip = k => k > lastKnown ? fr * (inBy[k] || 0) * (1 - w.pwpShare * costRatio(k)) : 0;
    PS = { vals: P.vals.map((v, i) => v === null ? null : v + slip(B.M[i])) };
  }
  let wc = w.ca - w.cl;
  const need = v => v === null || v === undefined ? null : Math.max(0, v + w.cushion - w.limit);
  let runMax = 0, runMaxS = 0;
  const rows = B.M.map((k, i) => {
    if (k > w.asOf) wc += B.co.months[i].net + adj - (P && P.interest[k] ? P.interest[k] : 0) + (w.capAmt > 0 && k === w.capMonth ? w.capAmt : 0);
    const line = P ? P.vals[i] : null, lineS = PS ? PS.vals[i] : null;
    if (line !== null) runMax = Math.max(runMax, need(line));
    if (lineS !== null) runMaxS = Math.max(runMaxS, need(lineS));
    // each month's own shortfall against the cushion (blank when there's room); the totals keep the largest
    return { k, line, avail: line === null ? null : w.limit - line, need: line === null ? null : need(line), lineS, needS: lineS === null ? null : need(lineS), wc };
  });
  const withLine = rows.filter(x => x.line !== null);
  const peak = withLine.reduce((a, x) => !a || x.line > a.line ? x : a, null);
  const peakS = rows.filter(x => x.lineS !== null).reduce((a, x) => !a || x.lineS > a.lineS ? x : a, null);
  const firstNeed = arr => { const r = rows.find(x => (arr === 'S' ? x.needS : x.need) > 0.5); return r ? r.k : null; };
  const ouBy = {};
  if (C) C.months.forEach((k, i) => ouBy[k] = C.jobs.reduce((a, x) => a + (x.months[i] ? x.months[i].ou : 0), 0));
  rows.forEach(r => r.ou = ouBy[r.k] !== undefined ? ouBy[r.k] : null);
  return { B, w, rows, peak, peakS, need: runMax, needS: runMaxS, needAt: firstNeed(''), needAtS: firstNeed('S'), known: P ? P.known : new Set(), hasCash: !!P, wc0: w.ca - w.cl };
}
function liquidityHtml(B0) {
  const L = buildLiquidity(B0), w = L.w, f$ = money, B = L.B;
  const head = `<tr><th></th><th class="n ytd">${mLabel(w.asOf)}<span class="rt2">balance sheet</span></th>${rMonthHead(B)}</tr>`;
  const row = (label, first, vals, c = '', neg = false, tag = null) => `<tr class="${c}"><td>${label}</td><td class="n ytd ${neg ? cls(first) : ''}">${first === null || first === undefined ? '' : f$(first)}</td>${vals.map((v, i) => `<td class="n ${neg ? cls(v) : ''}">${v === null || v === undefined ? '' : f$(v)}${tag && tag(i) ? `<span class="rt2">${tag(i)}</span>` : ''}</td>`).join('')}</tr>`;
  const negNeed = v => v === null || v < 0.5 ? null : -v;
  const cols = B.n + 2;
  let body = '';
  if (L.hasCash) {
    body += `<tr class="rg"><td colspan="${cols}">Line of credit · ${f$(w.limit)} limit · ${(w.rate * 100).toFixed(1)}% · renews ${mLong(w.renew)} on the same terms</td></tr>`;
    body += row('Balance at month end', w.locAsOf, L.rows.map(x => x.line));
    if (w.capAmt > 0) body += row('Owner capital in (property sale)', null, L.B.M.map(k => k === w.capMonth ? w.capAmt : null));
    body += row('Available on the line', w.limit - w.locAsOf, L.rows.map(x => x.avail), 'b', true);
    body += row('Net overbilled', null, L.rows.map(x => x.ou));
  }
  body += `<tr class="rg"><td colspan="${cols}">Working capital (current assets − current liabilities)</td></tr>`;
  body += row('Working capital', L.wc0, L.rows.map(x => x.wc), 'b', true);
  const pts = [];
  if (L.hasCash && L.peak) {
    pts.push(`<b>Line of credit:</b> highest month-end balance ${f$(L.peak.line)} (${mLong(L.peak.k)}), within the ${f$(w.limit)} limit.`);
    const after = L.rows.filter(x => x.line !== null && x.k > L.peak.k);
    const low = after.reduce((a, x) => !a || x.line < a.line ? x : a, null);
    if (low && low.line < L.peak.line - 1) pts.push(`<b>Paydown:</b> ${f$(low.line)} by ${mLong(low.k)} as the larger jobs bill out.`);
  }
  pts.push(`<b>Working capital</b> starts from the ${mLong(w.asOf)} balance sheet and moves with net income, plus depreciation, less loan principal${w.capAmt > 0 ? ', plus owner capital' : ''}.`);
  const backup = (w.contDesc || w.contAmt) ? `<p class="rnote rbackup"><b>Backup source of cash, not counted above:</b> ${esc(w.contDesc || 'Owner assets')}${w.contAmt ? ` (about ${f$(w.contAmt)})` : ''}, which the owners can sell and put into the company if it's ever needed.</p>` : '';
  const tail = '';
  return { html: `<section class="rsec liqsec"><h2>Liquidity and working capital</h2><ul class="rbasis lq">${pts.map(p => `<li>${p}</li>`).join('')}</ul><table class="rtab liq">${head}<tbody>${body}</tbody></table>${backup}${tail}</section>`, L };
}
function bindWcInputs() {
  const w = wcIn();
  document.querySelectorAll('[data-wc]').forEach(el => {
    const k = el.dataset.wc, pctK = el.dataset.wcpct === '1';
    const v = w[k];
    el.value = v === null || v === undefined ? '' : pctK ? +(v * 100).toFixed(3) : v;
    el.onchange = () => {
      const rs = (state.settings.report = Object.assign({}, state.settings.report || {}));
      const cur = Object.assign({}, rs.wc || {});
      if (el.value === '') delete cur[k]; else cur[k] = el.type === 'month' || el.type === 'text' ? el.value : pctK ? Number(el.value) / 100 : Number(el.value);
      rs.wc = cur; saveGlobal(); renderReport();
    };
  });
}

function rMonthHead(B) {
  return B.M.map((k, i) => `<th class="n">${mLabel(k)}<span class="rt2">${B.actual && i === 0 ? 'prelim.' : 'forecast'}</span></th>`).join('');
}
function renderReport() {
  const B = buildReport();
  const el = $('#rdoc');
  if (!B) { el.innerHTML = '<p>Load the WIP first.</p>'; return; }
  window._lastReport = B;
  const rs = reportSettings();
  bindWcInputs();
  const ae = document.activeElement;
  if (ae !== $('#rNotes')) $('#rNotes').value = rs.notes || '';
  if (ae !== $('#rBy')) $('#rBy').value = rs.by || '';
  const detail = rget('detail', 'all');
  $('#rSpan').value = B.span; $('#rDetail').value = detail;
  const f$ = v => money(v);
  const ytdH = B.hasYtd ? `<th class="n ytd">YTD thru ${mLabel(B.pm)}<span class="rt2">actual</span></th>` : '';
  const yeH = `<th class="n ye">${B.yeComplete ? 'Year end ' + B.yr : 'Total ' + B.yr + ' thru ' + mLabel(B.M[B.M.length - 1])}<span class="rt2">${B.hasYtd ? 'actual + forecast' : 'forecast'}</span></th>`;
  const showYe = B.yeIdx.length > 0 || B.hasYtd;
  const showNy = B.nyIdx.length > 0;
  const nyH = showNy ? `<th class="n ye">${B.ny} YTD thru ${mLabel(B.M[B.nyIdx[B.nyIdx.length - 1]])}<span class="rt2">forecast</span></th>` : '';
  // summary
  const sumRows = [];
  // percent rows: share of revenue; net margin can go negative, so it keeps its color
  const PCT = { pct: 'gp', ohpct: 'oh', netpct: 'net' };
  const sline = (label, d, f, c = '') => {
    const pf = PCT[f], isPct = !!pf;
    const ratio = (num, rev) => rev ? num / rev : null;
    const v = (m) => isPct ? ratio(m[pf], m.rev) : (f === 'oh' ? -m.oh : m[f]);
    const fmt = x => isPct ? pct(x) : f$(x);
    const tot = (get) => isPct ? ratio(get(pf), get('rev')) : (f === 'oh' ? -get('oh') : get(f));
    const yv = tot(k => d.ytd[k]), yev = tot(k => B.ye(d, k)), nyv = tot(k => B.y2(d, k));
    const cc = x => isPct && f !== 'netpct' ? '' : cls(x);
    sumRows.push(`<tr class="${c}"><td>${label}</td>${B.hasYtd ? `<td class="n ytd ${cc(yv)}">${fmt(yv)}</td>` : ''}${d.months.map(m => `<td class="n ${cc(v(m))}">${fmt(v(m))}</td>`).join('')}${showYe ? `<td class="n ye ${cc(yev)}">${fmt(yev)}</td>` : ''}${showNy ? `<td class="n ye ${cc(nyv)}">${fmt(nyv)}</td>` : ''}</tr>`);
  };
  const cols = 1 + (B.hasYtd ? 1 : 0) + B.n + (showYe ? 1 : 0) + (showNy ? 1 : 0);
  for (const d of [...B.divs, B.co]) {
    const isCo = d === B.co;
    sumRows.push(`</tbody><tbody class="jb"><tr class="rg ${isCo ? 'co' : ''}"><td colspan="${cols}">${esc(d.name)}</td></tr>`);
    sline('Revenue', d, 'rev'); sline('Cost of revenue', d, 'cost', 'mut'); sline('Gross profit', d, 'gp', 'b'); sline('Gross margin', d, 'pct', 'mut');
    sline('Overhead', d, 'oh', 'mut'); sline('Overhead %', d, 'ohpct', 'mut'); sline('Net income', d, 'net', 'ni'); sline('Net margin', d, 'netpct', 'mut'); sline('EBITDA', d, 'ebitda', 'mut eb');
  }
  // KPIs
  const kp = (l, v, s) => `<div class="rk"><div class="rkl">${l}</div><div class="rkv ${cls(v)}">${v === null ? '—' : f$(v)}</div><div class="rks">${s}</div></div>`;
  const yeLabel = B.yeComplete ? `${B.yr} projected` : `${B.yr} thru ${mLabel(B.M[B.M.length - 1])}`;
  const kpis = kp(`Revenue, ${yeLabel}`, B.ye(B.co, 'rev'), B.hasYtd ? `YTD ${f$(B.co.ytd.rev)} + forecast` : 'forecast') +
    kp(`Gross profit, ${yeLabel}`, B.ye(B.co, 'gp'), `${pct(B.ye(B.co, 'rev') ? B.ye(B.co, 'gp') / B.ye(B.co, 'rev') : null)} margin`) +
    kp(`Net income, ${yeLabel}`, B.ye(B.co, 'net'), B.hasYtd ? `YTD ${f$(B.co.ytd.net)}` : '') +
    kp('Contract backlog', B.co.backlog.rev, `${B.co.backlog.jobs} jobs · ${f$(B.co.backlog.gp)} gross profit still to earn`);
  // job schedule
  const which = detail === 'all' ? [['rev', 'Revenue'], ['cost', 'Cost'], ['gp', 'Profit']] : detail === 'gp' ? [['gp', 'Profit']] : detail === 'rev' ? [['rev', 'Revenue']] : [];
  let jobsHtml = '';
  if (which.length) {
    const hasEst = !!(state.est && state.est.jobs);
    const ec = hasEst ? 2 : 0;
    const jcols = 4 + ec + (which.length > 1 ? 1 : 0) + B.n + 1;
    const head = `<tr><th>Job</th><th>Name</th><th class="n">Contract</th><th class="n">Complete</th>${hasEst ? '<th class="n">Est.<span class="rt2">GP %</span></th><th class="n">Proj.<span class="rt2">GP %</span></th>' : ''}${which.length > 1 ? '<th></th>' : ''}${rMonthHead(B)}<th class="n tot">Total</th></tr>`;
    const gpCell = (v, base) => v === null || v === undefined ? '' : `<span class="${base !== null && base !== undefined && v < base - 0.005 ? 'neg' : base !== null && base !== undefined && v > base + 0.005 ? 'pos' : ''}">${pct(v)}</span>`;
    const tables = B.divs.map(d => {
      if (!d.lines.length) return '';
      const body = d.lines.map(L => {
        const first = which.map(([f, lab], j) => {
          const vals = L.vals.map(v => v[f]); const t = sumRow(vals);
          const lead = j === 0 ? `<td class="jn" rowspan="${which.length}">${esc(L.job || '')}</td><td class="nm" rowspan="${which.length}"${L.names ? ` title="${esc(L.names.join(', '))}"` : ''}>${esc(L.name)}</td><td class="n" rowspan="${which.length}">${L.kind === 'job' ? (L.tm ? 'T&amp;M' : f$(L.contract)) : ''}</td><td class="n" rowspan="${which.length}">${L.kind === 'job' && L.done !== null ? pct(L.done, 0) : ''}</td>${hasEst ? `<td class="n gpc" rowspan="${which.length}">${L.kind === 'job' ? gpCell(L.estP) : ''}</td><td class="n gpc" rowspan="${which.length}">${L.kind === 'job' ? gpCell(L.projP, L.estP) : ''}</td>` : ''}` : '';
          return `<tr class="${j === which.length - 1 ? 'jl' : ''} ${f === 'gp' && which.length > 1 ? 'b' : ''}">${lead}${which.length > 1 ? `<td class="ml">${lab}</td>` : ''}${vals.map(v => `<td class="n ${cls(v)}">${f$(v)}</td>`).join('')}<td class="n tot ${cls(t)}">${f$(t)}</td></tr>`;
        }).join('');
        return `<tbody class="jb">${first}</tbody>`;
      }).join('');
      // division margin: estimate vs projected, weighted by contract, on jobs that have both
      const both = d.lines.filter(L => L.kind === 'job' && L.estP !== null && L.estP !== undefined && L.projP !== null);
      const dEst = both.length ? sumRow(both.map(L => L.estP * L.estRev)) / Math.max(1, sumRow(both.map(L => L.estRev))) : null;
      const dProj = both.length ? sumRow(both.map(L => L.projP * L.projC)) / Math.max(1, sumRow(both.map(L => L.projC))) : null;
      const sub = which.map(([f, lab], j) => { const vals = d.months.map(m => m[f]); const t = sumRow(vals); return `<tr class="st">${j === 0 ? `<td colspan="4" rowspan="${which.length}">${esc(d.name)} total</td>${hasEst ? `<td class="n gpc" rowspan="${which.length}">${gpCell(dEst)}</td><td class="n gpc" rowspan="${which.length}">${gpCell(dProj, dEst)}</td>` : ''}` : ''}${which.length > 1 ? `<td class="ml">${lab}</td>` : ''}${vals.map(v => `<td class="n ${cls(v)}">${f$(v)}</td>`).join('')}<td class="n tot ${cls(t)}">${f$(t)}</td></tr>`; }).join('');
      return `<h3 class="rh3">${esc(d.name)}</h3><table class="rtab jobsr"><thead>${head}</thead>${body}<tbody class="jb">${sub}</tbody></table>`;
    }).join('');
    jobsHtml = `<section class="rsec jobsec"><h2>Job schedule</h2><p class="rnote">${which.length > 1 ? 'Revenue earned, cost of revenue and gross profit' : which[0][1] === 'Profit' ? 'Gross profit' : 'Revenue earned'} by month for each job, grouped by division. Contract and percent complete are as of the ${mLong(state.wip.asOf)} WIP.${state.est && state.est.jobs ? ' Est. GP % is the Spectrum estimate (bid plus change-order budgets); Proj. GP % is where the job is projected to finish.' : ''}</p>${tables}</section>`;
  }
  // backlog
  const bl = [...B.divs.filter(d => d.backlog.jobs), B.co].map(d => `<tr class="${d === B.co ? 'b tt' : ''}"><td>${esc(d.name)}</td><td class="n">${d.backlog.jobs}</td><td class="n">${f$(d.backlog.rev)}</td><td class="n">${f$(d.backlog.gp)}</td><td class="n">${pct(d.backlog.rev ? d.backlog.gp / d.backlog.rev : null)}</td></tr>`).join('');
  // notes
  const basis = [];
  basis.push(`Year-to-date figures are actual results from the ${B.pm ? mLong(B.pm) : ''} P&L.${B.actual ? ` ${mLong(B.actual)} is preliminary.` : ''}`);
  basis.push('Contract revenue is recognized by percent complete. Projected losses are recorded in full when identified.');
  basis.push('Service is forecast at its recent monthly run rate; overhead at the year-to-date monthly average.');
  basis.push('Forecast months include signed backlog and identified new work only.');
  basis.push('EBITDA = net income + interest + depreciation from the P&L (YTD actual; forecast months use the YTD monthly average). No tax add-back; JRT is a pass-through.');
  const LQ = liquidityHtml(B);
  const notes = rs.notes || '';
  el.innerHTML = `
    <div class="rhead"><img src="data:image/jpeg;base64,${LOGO}" alt="${COMPANY}"><div><div class="rco">${COMPANY}</div><div class="rtitle">Profit forecast by division</div>
      <div class="rsubt">Actual through ${B.pm ? mLong(B.pm) : '—'} · Forecast ${mLong(B.M[0])} – ${mLong(B.M[B.M.length - 1])}</div></div>
      <div class="rmeta">Prepared ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}${rs.by ? '<br>by ' + esc(rs.by) : ''}<br>Unaudited · management forecast</div></div>
    <div class="rkpis">${kpis}</div>
    <section class="rsec"><h2>Summary by division</h2><table class="rtab sumtab"><thead><tr><th></th>${ytdH}${rMonthHead(B)}${showYe ? yeH : ''}${nyH}</tr></thead>${sumRows.join('').replace(/^<\/tbody>/, '')}</tbody></table></section>
    ${LQ.html}
    ${jobsHtml}
    <section class="rsec avoid backsec"><h2>Contract backlog</h2><p class="rnote">Signed contract not yet earned, as of the ${mLong(state.wip.asOf)} WIP, and the gross profit forecast on that work.</p>
      <table class="rtab narrow"><thead><tr><th>Division</th><th class="n">Jobs</th><th class="n">Contract left to earn</th><th class="n">Gross profit to earn</th><th class="n">Margin</th></tr></thead><tbody>${bl}</tbody></table></section>
    <section class="rsec avoid"><h2>Basis of this forecast</h2><ul class="rbasis">${basis.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
      ${notes ? `<div class="rnotes">${esc(notes).replace(/\n/g, '<br>')}</div>` : ''}</section>`;
}

function reportSheets(B) {
  const head = ['', ...(B.hasYtd ? ['YTD thru ' + mLabel(B.pm)] : []), ...B.M.map((k, i) => mLabel(k) + (B.actual && i === 0 ? ' (prelim.)' : ' (forecast)')), B.yeComplete ? 'Year end ' + B.yr : 'Total thru ' + mLabel(B.M[B.M.length - 1]), ...(B.nyIdx.length ? [B.ny + ' YTD thru ' + mLabel(B.M[B.nyIdx[B.nyIdx.length - 1]])] : [])];
  const S = [[COMPANY], ['Profit forecast by division'], [`Actual through ${B.pm ? mLong(B.pm) : '—'} · forecast ${mLong(B.M[0])} – ${mLong(B.M[B.M.length - 1])}`], [], head];
  const r0 = v => Math.round(v);
  for (const d of [...B.divs, B.co]) {
    S.push([d.name]);
    for (const [lab, f] of [['Revenue', 'rev'], ['Cost of revenue', 'cost'], ['Gross profit', 'gp'], ['Gross margin', 'pct:gp'], ['Overhead', 'oh'], ['Overhead %', 'pct:oh'], ['Net income', 'net'], ['Net margin', 'pct:net'], ['EBITDA', 'ebitda']]) {
      if (f.startsWith('pct:')) { const k = f.slice(4), q = (n, r) => r ? +(n / r).toFixed(4) : ''; S.push([lab, ...(B.hasYtd ? [q(d.ytd[k], d.ytd.rev)] : []), ...d.months.map(m => q(m[k], m.rev)), q(B.ye(d, k), B.ye(d, 'rev')), ...(B.nyIdx.length ? [q(B.y2(d, k), B.y2(d, 'rev'))] : [])]); continue; }
      const sg = f === 'oh' ? -1 : 1;
      S.push([lab, ...(B.hasYtd ? [r0(sg * d.ytd[f])] : []), ...d.months.map(m => r0(sg * m[f])), r0(sg * B.ye(d, f)), ...(B.nyIdx.length ? [r0(sg * B.y2(d, f))] : [])]);
    }
    S.push([]);
  }
  const J = [['Division', 'Job', 'Name', 'Contract', 'Complete', 'Est. GP %', 'Proj. GP %', 'Line', ...B.M.map(mLabel), 'Total']];
  for (const d of B.divs) for (const L of d.lines) for (const [lab, f] of [['Revenue', 'rev'], ['Cost', 'cost'], ['Profit', 'gp']]) {
    const vals = L.vals.map(v => r0(v[f]));
    J.push([d.name, L.job || '', L.name, L.kind === 'job' ? (L.tm ? 'T&M' : r0(L.contract || 0)) : '', L.done !== null && L.done !== undefined ? +L.done.toFixed(3) : '', L.estP != null ? +L.estP.toFixed(3) : '', L.projP != null ? +L.projP.toFixed(3) : '', lab, ...vals, sumRow(vals)]);
  }
  const Bk = [['Division', 'Jobs', 'Contract left to earn', 'Gross profit to earn'], ...[...B.divs, B.co].map(d => [d.name, d.backlog.jobs, r0(d.backlog.rev), r0(d.backlog.gp)])];
  const LQ = buildLiquidity(B), w = LQ.w;
  const Lq = [['', mLabel(w.asOf) + ' (balance sheet)', ...LQ.B.M.map(mLabel)]];
  const cell = v => v === null || v === undefined ? '' : r0(v);
  if (LQ.hasCash) {
    Lq.push(['Line of credit balance', w.locAsOf, ...LQ.rows.map(x => cell(x.line))]);
    Lq.push(['Available on the line (limit ' + w.limit + ')', w.limit - w.locAsOf, ...LQ.rows.map(x => cell(x.avail))]);
  }
  Lq.push(['Net overbilled', '', ...LQ.rows.map(x => cell(x.ou))]);
  Lq.push(['Working capital', LQ.wc0, ...LQ.rows.map(x => r0(x.wc))]);
  return { Summary: S, Liquidity: Lq, Jobs: J, Backlog: Bk };
}
async function saveFile(filename, data, mime) {
  try { const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null; if (dl) { await dl.save({ filename, data }); return true; } } catch (e) { if (e && /declin|cancel/i.test(String(e.message || e.code))) return true; }
  try {
    const url = URL.createObjectURL(new Blob([data], { type: mime }));
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000); return true;
  } catch (e) { return false; }
}
function reportFileBase() { const B = window._lastReport; return `JRT Profit Forecast ${B ? B.M[0] : ''}`.trim(); }
async function exportExcel() {
  const B = window._lastReport; if (!B || !window.XLSX) return toast('Excel export is still loading. Try again in a moment.');
  const wb = XLSX.utils.book_new(); const sh = reportSheets(B);
  for (const [n, aoa] of Object.entries(sh)) { const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = aoa[aoa.length > 5 ? 5 : 0].map((_, i) => ({ wch: i === 0 ? 26 : i === 2 && n === 'Jobs' ? 34 : 14 })); XLSX.utils.book_append_sheet(wb, ws, n); }
  const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  if (!await saveFile(reportFileBase() + '.xlsx', new Uint8Array(data), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) toast('This browser blocked the download. Use "Copy for Excel" and paste into a blank workbook.');
}
async function copyReport() {
  const B = window._lastReport; if (!B) return;
  const sh = reportSheets(B);
  const tsv = [...sh.Summary, [], ['JOB SCHEDULE'], ...sh.Jobs, [], ['BACKLOG'], ...sh.Backlog].map(r => r.join('\t')).join('\n');
  try { await navigator.clipboard.writeText(tsv); toast('Copied. Paste into a blank Excel sheet.'); }
  catch (e) { const t = document.createElement('textarea'); t.value = tsv; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); toast(ok ? 'Copied. Paste into a blank Excel sheet.' : 'Copy was blocked by the browser.'); }
}
function printReport() {
  // Inside Claude the print window is blocked without an error, so always say what to do if nothing opened.
  const t0 = Date.now();
  try { window.print(); } catch (e) {}
  setTimeout(() => { if (Date.now() - t0 < 1500) toast('No print window? Printing is blocked inside Claude. Open this app in its own browser tab and press Ctrl+P (Cmd+P on a Mac), or ask Claude for the PDF.', 9000); }, 300);
}
function bindReport() {
  $('#rBack').onclick = () => setView('main');
  $('#rSpan').onchange = e => { rset('span', e.target.value); renderReport(); };
  $('#rDetail').onchange = e => { rset('detail', e.target.value); renderReport(); };
  $('#rPrint').onclick = printReport;
  $('#rXlsx').onclick = exportExcel;
  $('#rCopy').onclick = copyReport;
  const rs = () => (state.settings.report = Object.assign({}, state.settings.report || {}));
  $('#rNotes').value = reportSettings().notes || ''; $('#rBy').value = reportSettings().by || '';
  $('#rNotes').oninput = e => { rs().notes = e.target.value; saveGlobal(); clearTimeout(bindReport._t); bindReport._t = setTimeout(renderReport, 400); };
  $('#rBy').oninput = e => { rs().by = e.target.value; saveGlobal(); clearTimeout(bindReport._t); bindReport._t = setTimeout(renderReport, 400); };
  bindWcInputs();
  if (location.hash === '#report') setView('report');
}
