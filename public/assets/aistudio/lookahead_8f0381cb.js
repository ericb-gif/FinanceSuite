
// ---------- 6-month cash lookahead ----------
// Weekly cash and line of credit from today through May. The near weeks come from the weekly cash
// sheet (what the office already has scheduled); later weeks are built from drivers that each have a
// stated source, so anyone can update them. Every driver is editable in the Drivers panel.
const LA_DEFAULTS = {
  start: '2026-11-16', line0: 3768244, weeks: 28,
  limit: 4500000, cushion: 350000, rate: 0.07,
  schedInThru: '2026-12-28', schedOutThru: '2026-12-14',
  schedIn: { '2026-11-16': 803912, '2026-11-23': 2272975, '2026-11-30': 1028842, '2026-12-07': 713309, '2026-12-14': 1589339, '2026-12-21': 620548, '2026-12-28': 307337 },
  schedOut: { '2026-11-16': 825917, '2026-11-23': 1547198, '2026-11-30': 186510, '2026-12-07': 326167, '2026-12-14': 213190 },
  payroll: 506000, baseHours: 3742, fixedGross: 182093, fieldRate: 54.76, health: 120000,
  hours: { '2026-11-09': 3742, '2026-11-16': 3820, '2026-11-23': 3510, '2026-11-30': 3607, '2026-12-07': 3630, '2026-12-14': 3659, '2026-12-21': 3679, '2026-12-28': 3748,
    '2027-01-04': 4136, '2027-01-11': 4213, '2027-01-18': 3760, '2027-01-25': 3640, '2027-02-01': 3343, '2027-02-08': 3662, '2027-02-15': 3528, '2027-02-22': 3388,
    '2027-03-01': 3410, '2027-03-08': 3329, '2027-03-15': 3169, '2027-03-22': 3242, '2027-03-29': 3401, '2027-04-05': 3321, '2027-04-12': 3601, '2027-04-19': 3879,
    '2027-04-26': 3752, '2027-05-03': 3618, '2027-05-10': 3538 },
  days: 45, jobDays: { '1595': 80, '1540': 15 },
  pwp: 0.40, matsLater: 0.07, likelyNonLabor: 0.53, svcDays: 30,
  lanae: 50000, usbank: 15000, comdata: 110000, dor: 38000, auto: 41700, draws: 10000,
  quarterly: 256500, q1: '2027-01-29', q2: '2027-04-30', match: 120000, matchDate: '2027-05-14',
  retention: [
    { name: 'Westwood PDX6 (112905)', amt: 22332, date: '2027-01-20' },
    { name: 'Trend Capital TI (01597)', amt: 59578, date: '2027-02-05' },
    { name: 'Cairnspring (01587)', amt: 40163, date: '2027-02-19' },
  ],
  oneOff: [{ name: 'WA DOR (due the 25th)', amt: 38000, date: '2026-11-25' }],
};
const dIso = d => d.toISOString().slice(0, 10);
const dAdd = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return dIso(d); };
const monOf = iso => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return dIso(d); };
const dShort = iso => { const [y, m, d] = iso.split('-').map(Number); return `${m}/${d}`; };
const monthEnd = k => { const [y, m] = k.split('-').map(Number); return dIso(new Date(Date.UTC(y, m, 0, 12))); };
function laIn() {
  const s = state.settings.lookahead || {};
  const o = Object.assign({}, LA_DEFAULTS, s);
  if (s.days === undefined) { const cd = Number((state.settings.cash || {}).collectDays); if (cd) o.days = cd; }
  return o;
}
function laSave(patch) {
  state.settings.lookahead = Object.assign({}, state.settings.lookahead || {}, patch);
  saveGlobal(); renderLook();
}

function buildLookahead() {
  const S = laIn();
  const W = Array.from({ length: S.weeks }, (_, i) => dAdd(S.start, 7 * i));
  const n = W.length, last = W[n - 1];
  const idx = iso => { const m = monOf(iso); if (m < W[0]) return -1; const i = Math.round((new Date(m) - new Date(W[0])) / 6048e5); return i < n ? i : n; };
  // forecast and billing model long enough to cover the window
  const R1 = runForecast(Object.assign({}, state, { settings: Object.assign({}, state.settings, { horizon: 1 }) }));
  const endK = dAdd(last, 6).slice(0, 7);
  const h = Math.max(1, mDiff(endK, R1.M.months[0]) + 1);
  const RR = runForecast(Object.assign({}, state, { settings: Object.assign({}, state.settings, { horizon: h }) }));
  let C = null; try { if (state.ar || state.ap) C = runCash(state, RR); } catch (e) { C = null; }
  const z = () => new Array(n).fill(0);
  const cin = { sched: z(), jobs: z(), svc: z(), likely: z(), ret: z() };
  const cout = { pay: z(), health: z(), sched: z(), pwp: z(), mats: z(), lanae: z(), cards: z(), fuel: z(), tax: z(), loans: z(), interest: z(), draws: z(), other: z() };
  for (const k in cin) cin[k]._n = 'in:' + k; for (const k in cout) cout[k]._n = 'out:' + k;
  const items = {};
  const rec = (o, i, v, label, key) => { if (Math.abs(v) > 0.5) (items[o._n] || (items[o._n] = [])).push({ i, key: key || null, label: label || '', amt: v }); };
  const setW = (o, i, v, label, key) => { o[i] += v; rec(o, i, v, label, key); };
  const put = (o, iso, v, label, key) => { const i = idx(iso); if (i >= 0 && i < n) { o[i] += v; rec(o, i, v, label, key); } };
  // "days to pay" is the average: spread each payment a quarter the week before, half that week, a quarter the week after
  const SPREAD = S.spread || [[-7, 0.25], [0, 0.5], [7, 0.25]];
  const putS = (o, iso, v, onlyAfter, label, key) => { for (const [d, w] of SPREAD) { const day = dAdd(iso, d); if (onlyAfter && monOf(day) <= onlyAfter) continue; if (day >= S.start || monOf(day) >= W[0]) put(o, day, v * w, `${label} (${Math.round(w * 100)}% of ${money(v)}, expected about ${dShort(iso)})`, key); } };
  const daysFor = key => Number((S.jobDays || {})[key]) || S.days;
  const afterOut = i => W[i] > S.schedOutThru, afterIn = i => W[i] > S.schedInThru;
  const hoursOf = wk => { const hrs = S.hours || {}; if (hrs[wk] !== undefined && hrs[wk] !== '') return Number(hrs[wk]); const ks = Object.keys(hrs).filter(k => k <= wk).sort(); return ks.length ? Number(hrs[ks[ks.length - 1]]) : S.baseHours; };
  const base = S.fixedGross + S.fieldRate * S.baseHours;
  for (let i = 0; i < n; i++) {
    // payroll paid this Friday covers the week before
    const hw = dAdd(W[i], -7), hrs = hoursOf(hw);
    setW(cout.pay, i, S.payroll * (S.fixedGross + S.fieldRate * hrs) / base, `Payday ${dShort(dAdd(W[i], 4))}: week of ${dShort(hw)} at ${Math.round(hrs).toLocaleString()} board hours`);
    setW(cout.health, i, S.health, `Health claims, week of ${dShort(W[i])}`);
    if (!afterIn(i)) setW(cin.sched, i, Number((S.schedIn || {})[W[i]]) || 0, `Weekly cash sheet: estimated in from AR, week of ${dShort(W[i])}`);
    if (!afterOut(i)) setW(cout.sched, i, Number((S.schedOut || {})[W[i]]) || 0, `Weekly cash sheet: check runs, week of ${dShort(W[i])}`);
    else { setW(cout.lanae, i, S.lanae, `Lanae's check run, week of ${dShort(W[i])}`); setW(cout.cards, i, S.usbank, `US Bank, week of ${dShort(W[i])}`); }
  }
  // collections on contract jobs: open invoices not already in the scheduled weeks, plus new billings
  if (state.ar) for (const x of state.ar.invoices || []) {
    if (!x.date) continue; const exp = dAdd(x.date, daysFor(x.key));
    putS(cin.jobs, exp, x.amt, S.schedInThru, `Open invoice${x.inv ? ' ' + x.inv : ''} dated ${dShort(x.date)} (+${daysFor(x.key)} days)`, x.key);
  }
  if (C) for (const b of C.bills) { const exp = dAdd(b.date, daysFor(b.key)); if (b.date >= dAdd(S.start, -31)) putS(cin.jobs, exp, b.amt, null, `${mLong(b.k)} pay app (+${daysFor(b.key)} days)`, b.key); }
  // service and work orders: each month's revenue collected svcDays after month end
  RR.M.months.forEach((k, j) => {
    if (k < S.start.slice(0, 7)) return;
    let rev = 0; for (const code in RR.div) rev += RR.div[code].months[j].woRev || 0;
    // the start month: only what's billed after today (the rest is on the AR the cash sheet already counts)
    if (k === S.start.slice(0, 7)) { const dm = +monthEnd(k).slice(8); rev *= Math.max(0, dm - (+S.start.slice(8)) + 1) / dm; }
    putS(cin.svc, dAdd(monthEnd(k), S.svcDays), rev, null, `${mLong(k)} service and work order revenue (+${S.svcDays} days after month end)`);
  });
  // likely jobs (Piping Rock and others): billed the 20th, collected after the usual days; their vendors paid when paid
  if (state.settings.includeLikely !== false) for (const L of state.settings.likely || []) for (const [k, v] of Object.entries(L.rev || {})) {
    const r = Number(v) || 0; if (!r) continue;
    const lk = jobKey((String(L.name || '').match(/^\s*(\d{4,6})/) || [])[1] || '');
    const exp = dAdd(k + '-20', (lk && Number((S.jobDays || {})[lk])) || S.days); if (exp < S.start) continue;
    putS(cin.likely, exp, r, null, `${L.name}: ${mLong(k)} billing`, lk || L.name);
    putS(cout.pwp, exp, r * (1 - (Number(L.gp) || 0)) * S.likelyNonLabor, null, `${L.name}: vendors on the ${mLong(k)} billing`, lk || L.name);
  }
  for (const r of S.retention || []) if (r.date && r.amt) put(cin.ret, r.date, Number(r.amt), `Retention: ${r.name}`);
  // vendors and subs paid when the owner pays, once the scheduled check runs end
  for (let i = 0; i < n; i++) if (afterOut(i)) setW(cout.pwp, i, S.pwp * (cin.jobs[i] + cin.sched[i]), `${Math.round(S.pwp * 100)}% of ${money(cin.jobs[i] + cin.sched[i])} collected on jobs, week of ${dShort(W[i])}`);
  // the share of materials not held: paid mid-month after the cost
  RR.M.months.forEach((k, j) => {
    const due = mAdd(k, 1) + '-15'; if (monOf(due) <= S.schedOutThru || due < S.start) return;
    let cost = 0; for (const f of RR.jobs) { const d = RR.div[f.job.dept]; if (d && d.runRate) continue; cost += f.months[j].cost || 0; }
    put(cout.mats, due, cost * S.matsLater, `${mLong(k)} job cost ${money(cost)} × ${(S.matsLater * 100).toFixed(1)}%`);
  });
  // recurring monthly items, after the scheduled weeks
  const months = []; for (let k = S.start.slice(0, 7); k <= last.slice(0, 7); k = mAdd(k, 1)) months.push(k);
  for (const k of months) {
    const on = (day, o, v, label) => { const iso = `${k}-${String(day).padStart(2, '0')}`; if (iso >= S.start && monOf(iso) > S.schedOutThru) put(o, iso, v, `${label}, ${dShort(iso)}`); };
    on(5, cout.fuel, S.comdata, 'Comdata'); on(25, cout.tax, S.dor, 'WA DOR'); on(1, cout.loans, S.auto / 2, 'Truck loans (half)'); on(15, cout.loans, S.auto / 2, 'Truck loans (half)'); on(1, cout.draws, S.draws, 'Owner draws');
  }
  for (const q of [S.q1, S.q2]) if (q) put(cout.tax, q, S.quarterly, `Quarterly payroll taxes due ${dShort(q)}`);
  if (S.matchDate) put(cout.other, S.matchDate, S.match, '401k match (office)');
  for (const o of S.oneOff || []) if (o.date && o.amt) put(cout.other, o.date, Number(o.amt), o.name || 'One-time payment');
  // run the line week by week; interest accrues on the balance
  let bal = S.line0; const line = [], tin = [], tout = [];
  for (let i = 0; i < n; i++) {
    cout.interest[i] = Math.max(0, bal) * S.rate / 52; rec(cout.interest, i, cout.interest[i], `${(S.rate * 100).toFixed(1)}% on ${money(bal)} for the week of ${dShort(W[i])}`);
    const a = Object.values(cin).reduce((s, o) => s + o[i], 0), b = Object.values(cout).reduce((s, o) => s + o[i], 0);
    bal = bal + b - a; line.push(bal); tin.push(a); tout.push(b);
  }
  // months: a week belongs to the month its Friday falls in
  const mOf = i => dAdd(W[i], 4).slice(0, 7);
  const mlist = [...new Set(W.map((_, i) => mOf(i)))];
  const sumM = (o, k) => W.reduce((s, _, i) => s + (mOf(i) === k ? o[i] : 0), 0);
  const M = mlist.map(k => {
    const ii = W.map((_, i) => i).filter(i => mOf(i) === k);
    const hi = ii.reduce((a, i) => line[i] > line[a] ? i : a, ii[0]);
    return { k, ii, end: line[ii[ii.length - 1]], high: line[hi], highWk: W[hi], partial: k === mlist[0] && S.start.slice(8) > '07' };
  });
  const peak = line.reduce((a, v, i) => v > line[a] ? i : a, 0);
  const need = Math.max(0, line[peak] + S.cushion - S.limit);
  // health trend: overbillings and working capital by month from the forecast
  let ouBy = {}; if (C) C.months.forEach((k, i) => ouBy[k] = C.jobs.reduce((a, x) => a + (x.months[i] ? x.months[i].ou : 0), 0));
  let wcBy = {};
  try { const B = buildReport(h); const L = buildLiquidity(B); L.rows.forEach(r => wcBy[r.k] = r.wc); } catch (e) { wcBy = {}; }
  return { S, W, n, cin, cout, line, tin, tout, M, peak, need, sumM, ouBy, wcBy, items, mOf, hasModel: !!C };
}

const LA_IN = [['sched', 'Collections scheduled on the weekly cash sheet'], ['jobs', 'Contract job collections (forecast)'], ['svc', 'Service and work order collections'], ['likely', 'New jobs (Piping Rock and other likely jobs)'], ['ret', 'Retention released']];
const LA_OUT = [['pay', 'Payroll, payroll taxes and 401k'], ['health', 'Health insurance claims'], ['sched', 'Vendor payments scheduled on the weekly cash sheet'], ['pwp', 'Job vendors and subs, paid when the owner pays'], ['mats', 'Materials paid the month after (not held)'],
  ['lanae', 'Non-job check run (Lanae)'], ['cards', 'US Bank cards'], ['fuel', 'Comdata fuel'], ['tax', 'WA DOR and quarterly payroll taxes'], ['loans', 'Truck loans'], ['interest', 'Line of credit interest'], ['draws', 'Owner draws'], ['other', 'One-time items (401k match, etc.)']];

function laChart(A) {
  const w = 1080, h = 230, pl = 64, pr = 12, pt = 14, pb = 28;
  const vals = A.line, S = A.S;
  const hiV = Math.max(S.limit, ...vals) * 1.05, loV = Math.min(0, ...vals);
  const x = i => pl + (w - pl - pr) * i / Math.max(1, A.n - 1), y = v => pt + (h - pt - pb) * (1 - (v - loV) / (hiV - loV));
  const path = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const ticks = []; for (let v = 0; v <= hiV; v += 1000000) ticks.push(v);
  const months = A.M.map(m => { const i = m.ii[0]; return `<text x="${x(i)}" y="${h - 8}" font-size="11" fill="#6b736f">${MON[+m.k.slice(5) - 1]}</text>`; }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" class="lachart" role="img" aria-label="Weekly line of credit balance">
    ${ticks.map(v => `<line x1="${pl}" x2="${w - pr}" y1="${y(v)}" y2="${y(v)}" stroke="#ece9e1"/><text x="${pl - 8}" y="${y(v) + 4}" font-size="11" text-anchor="end" fill="#6b736f">$${v / 1e6}M</text>`).join('')}
    <rect x="${pl}" y="${y(hiV)}" width="${w - pl - pr}" height="${Math.max(0, y(S.limit) - y(hiV))}" fill="#f9e2e0" opacity=".6"/>
    <rect x="${pl}" y="${y(S.limit)}" width="${w - pl - pr}" height="${y(S.limit - S.cushion) - y(S.limit)}" fill="#fbeedb" opacity=".8"/>
    <line x1="${pl}" x2="${w - pr}" y1="${y(S.limit)}" y2="${y(S.limit)}" stroke="#b3261e" stroke-dasharray="4 3"/>
    <text x="${w - pr}" y="${y(S.limit) - 4}" font-size="11" text-anchor="end" fill="#b3261e">Limit ${money(S.limit)}</text>
    <text x="${w - pr}" y="${y(S.limit - S.cushion) + 12}" font-size="11" text-anchor="end" fill="#a76a00">Cushion</text>
    <path d="${path}" fill="none" stroke="#1f5c4f" stroke-width="2.4"/>
    ${vals.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="2.6" fill="#1f5c4f"><title>Week of ${dShort(A.W[i])}: ${money(v)}</title></circle>`).join('')}
    <circle cx="${x(A.peak)}" cy="${y(vals[A.peak])}" r="5" fill="none" stroke="#b3261e" stroke-width="2"/>
    ${months}</svg>`;
}

function laSrc(S) {
  const jd = Object.entries(S.jobDays || {}).map(([k, v]) => `${k}: ${v}`).join(', ');
  const cb = (state.settings.cash || {}).billDay || 20;
  return {
    'in:sched': `Copied from the cash sheet's "Estimated in from AR", weeks through ${dShort(S.schedInThru)}.`,
    'in:jobs': `Open 10/31 invoices not already on the cash sheet, plus each month's pay app (Sven's % complete × contract, plus billed-ahead backing off), billed the ${cb}th and collected ${S.days} days later on average${jd ? ` (${jd})` : ''}.`,
    'in:svc': `Service and work order run rate from the Overhead and service section, collected ${S.svcDays} days after month end.`,
    'in:likely': 'Likely jobs\' monthly revenue (Likely jobs section), billed the 20th.',
    'in:ret': 'The retention releases and dates listed in the drivers.',
    'out:pay': `Cash sheet payroll + taxes + 401k (${money(S.payroll)} a week at ${S.baseHours.toLocaleString()} board hours), moved up or down with manpower board hours. Paid Fridays for the week before.`,
    'out:health': `${money(S.health)} a week.`,
    'out:sched': `Copied from the cash sheet's check runs, weeks through ${dShort(S.schedOutThru)}.`,
    'out:pwp': `After ${dShort(S.schedOutThru)}: ${Math.round(S.pwp * 100)}% of every job collection goes back out to that job's vendors and subs (materials and subs paid when paid).`,
    'out:mats': `Materials not held: ${(S.matsLater * 100).toFixed(1)}% of each month's job cost, paid the 15th of the next month.`,
    'out:lanae': `${money(S.lanae)} a week, after ${dShort(S.schedOutThru)}.`, 'out:cards': `${money(S.usbank)} a week, after ${dShort(S.schedOutThru)}.`,
    'out:fuel': `${money(S.comdata)} on the 5th of each month.`, 'out:tax': `WA DOR ${money(S.dor)} on the 25th; quarterly payroll taxes ${money(S.quarterly)}.`,
    'out:loans': `${money(S.auto)} a month (principal + interest).`, 'out:interest': `${(S.rate * 100).toFixed(1)}% on the line balance each week.`,
    'out:draws': `${money(S.draws)} a month.`, 'out:other': '401k match and other one-time items in the drivers.',
  };
}
function renderLook() {
  const el = $('#lookdoc'); if (!el) return;
  if (!state.wip) { el.innerHTML = '<p>Load the WIP first.</p>'; return; }
  let A; try { A = buildLookahead(); } catch (e) { el.innerHTML = `<p class="neg">Couldn't build the lookahead: ${esc(e.message)}</p>`; return; }
  const S = A.S, f$ = money;
  const pk = A.peak, lowAvail = S.limit - A.line[pk];
  const lastI = A.n - 1;
  const kp = (l, v, s, bad) => `<div class="kpi ${bad ? 'bad' : ''}"><div class="kl">${l}</div><div class="kv ${bad ? 'neg' : ''}">${v}</div><div class="ks">${s}</div></div>`;
  const kpis = kp('Line today', f$(S.line0), `${f$(S.limit - S.line0)} available on ${f$(S.limit)}`) +
    kp('Tightest week', f$(A.line[pk]), `week of ${dShort(A.W[pk])} · ${f$(lowAvail)} available`, lowAvail < S.cushion) +
    kp(`Line at end of ${MON[+A.M[A.M.length - 1].k.slice(5) - 1]}`, f$(A.line[lastI]), `${A.line[lastI] < S.line0 ? f$(S.line0 - A.line[lastI]) + ' lower than today' : f$(A.line[lastI] - S.line0) + ' higher than today'}`, A.line[lastI] > S.line0) +
    kp('Cash needed to keep the cushion', f$(A.need), A.need > 0.5 ? `to keep ${f$(S.cushion)} free at the tightest week` : `${f$(S.cushion)} cushion holds every week`, A.need > 0.5);
  // monthly table
  const Mh = A.M.map(m => `<th class="n">${MON[+m.k.slice(5) - 1]} ${m.k.slice(2, 4)}${m.partial ? `<span class="tag">from ${dShort(S.start)}</span>` : ''}</th>`).join('');
  const SRC = laSrc(S);
  const r = (label, vals, c = '', fmt = f$, drill) => `<tr class="${c}"><td>${label}${drill && SRC[drill] ? `<div class="rsrc">${esc(SRC[drill])}</div>` : ''}</td>${vals.map((v, j) => `<td class="n ${typeof v === 'number' ? cls(v) : ''} ${drill && v ? 'drillc' : ''}" ${drill && v ? `data-ladrill="${drill}" data-m="${A.M[j].k}" title="See what's in this number"` : ''}>${v === null || v === undefined ? '' : fmt(v)}</td>`).join('')}</tr>`;
  const live = (o) => A.M.some(m => Math.abs(A.sumM(o, m.k)) > 0.5);
  let body = `<tr class="grp"><td colspan="${A.M.length + 1}">Cash in</td></tr>`;
  for (const [k, lab] of LA_IN) if (live(A.cin[k])) body += r(lab, A.M.map(m => A.sumM(A.cin[k], m.k)), '', f$, 'in:' + k);
  body += r('Total cash in', A.M.map(m => A.sumM(A.tin, m.k)), 'b');
  body += `<tr class="grp"><td colspan="${A.M.length + 1}">Cash out</td></tr>`;
  for (const [k, lab] of LA_OUT) if (live(A.cout[k])) body += r(lab, A.M.map(m => -A.sumM(A.cout[k], m.k)), '', f$, 'out:' + k);
  body += r('Total cash out', A.M.map(m => -A.sumM(A.tout, m.k)), 'b');
  body += r('Net cash for the month', A.M.map(m => A.sumM(A.tin, m.k) - A.sumM(A.tout, m.k)), 'net');
  body += `<tr class="grp co"><td colspan="${A.M.length + 1}">Line of credit (${f$(S.limit)} limit)</td></tr>`;
  body += r('Balance at month end', A.M.map(m => m.end), 'b');
  body += r('Highest balance during the month', A.M.map(m => m.high), '');
  body += r('Available at the tightest week', A.M.map(m => S.limit - m.high), 'b');
  body += `<tr class="grp"><td colspan="${A.M.length + 1}">Health of the company</td></tr>`;
  body += r('Net overbilled at month end', A.M.map(m => A.ouBy[m.k] !== undefined ? A.ouBy[m.k] : null), 'sub');
  body += r('Working capital at month end', A.M.map(m => A.wcBy[m.k] !== undefined ? A.wcBy[m.k] : null), 'sub');
  // weekly detail
  const wk = A.W.map((d, i) => `<tr><td>${dShort(d)}</td><td class="n">${f$(A.tin[i])}</td><td class="n">${f$(-A.tout[i])}</td><td class="n ${cls(A.tin[i] - A.tout[i])}">${f$(A.tin[i] - A.tout[i])}</td><td class="n b">${f$(A.line[i])}</td><td class="n ${S.limit - A.line[i] < S.cushion ? 'neg' : ''}">${f$(S.limit - A.line[i])}</td><td class="muted">${[d <= S.schedInThru ? 'collections from cash sheet' : '', d <= S.schedOutThru ? 'vendor payments from cash sheet' : ''].filter(Boolean).join(' · ') || 'drivers'}</td></tr>`).join('');
  window._la = A;
  el.innerHTML = `
    <div id="laKpis" class="lakpis">${kpis}</div>
    <div class="scroll lachartbox">${laChart(A)}</div>
    <h2>By month</h2>
    <div class="sub">Weeks count in the month their Friday falls in. Click Drivers below to see where each line comes from.</div>
    <div class="scroll"><table class="grid latab"><thead><tr><th></th>${Mh}</tr></thead><tbody>${body}</tbody></table></div>
    <details class="lawk"><summary>Week by week</summary><div class="scroll tall"><table class="grid"><thead><tr><th>Week of</th><th class="n">Cash in</th><th class="n">Cash out</th><th class="n">Net</th><th class="n">Line balance</th><th class="n">Available</th><th>Based on</th></tr></thead><tbody>${wk}</tbody></table></div></details>
    ${laDriversHtml(A)}`;
  bindLook();
}

function laDriversHtml(A) {
  const S = A.S;
  const num = (k, label, src, opt = {}) => `<div class="drv"><label>${label}<input type="${opt.date ? 'date' : 'number'}" data-la="${k}" ${opt.pct ? 'data-pct="1"' : ''} step="${opt.step || 1000}" value="${opt.pct ? +(S[k] * 100).toFixed(2) : S[k]}"></label><div class="src">${src}</div></div>`;
  const schedRows = A.W.filter(d => d <= S.schedInThru || d <= S.schedOutThru).map(d => `<tr><td>${dShort(d)}</td><td><input type="number" step="1000" data-lamap="schedIn" data-k="${d}" value="${(S.schedIn || {})[d] ?? ''}" ${d > S.schedInThru ? 'disabled' : ''}></td><td><input type="number" step="1000" data-lamap="schedOut" data-k="${d}" value="${(S.schedOut || {})[d] ?? ''}" ${d > S.schedOutThru ? 'disabled' : ''}></td></tr>`).join('');
  const hk = Object.keys(S.hours || {}).sort();
  const hourRows = hk.map(k => `<label class="hr">${dShort(k)}<input type="number" step="10" data-lamap="hours" data-k="${k}" value="${S.hours[k]}"></label>`).join('');
  const jd = Object.entries(S.jobDays || {}).map(([k, v]) => `<tr><td>${esc(k)}</td><td><input type="number" step="5" data-lamap="jobDays" data-k="${esc(k)}" value="${v}"></td><td><button class="ghost sm" data-ladel="jobDays" data-k="${esc(k)}">Remove</button></td></tr>`).join('');
  const list = (name, items) => items.map((x, i) => `<tr><td><input data-lalist="${name}" data-i="${i}" data-f="name" value="${esc(x.name || '')}" style="width:220px"></td><td><input type="number" step="1000" data-lalist="${name}" data-i="${i}" data-f="amt" value="${x.amt || ''}"></td><td><input type="date" data-lalist="${name}" data-i="${i}" data-f="date" value="${x.date || ''}"></td><td><button class="ghost sm" data-lalistdel="${name}" data-i="${i}">Remove</button></td></tr>`).join('');
  return `<h2>Drivers</h2>
  <div class="sub">What each line is built from, where the number comes from, and when to update it. Changes save for everyone.</div>
  <div class="drvwrap">
    <section class="drvg"><h3>Starting point · update every Monday</h3>
      ${num('start', 'Week starting (Monday)', 'The first week of the lookahead. Move it forward each Monday.', { date: 1 })}
      ${num('line0', 'Line of credit balance at the start', 'From the weekly cash sheet (Current LOC balance) or the bank.')}
      ${num('limit', 'Line limit', 'Pacific West line; renews 4/1/27 on the same terms.', { step: 50000 })}
      ${num('cushion', 'Cushion to keep available', 'Room kept free for swings inside a week (check runs, a late payment).', { step: 50000 })}
      ${num('rate', 'Line interest rate %', 'Bank rate on the line.', { pct: 1, step: 0.25 })}
    </section>
    <section class="drvg"><h3>Weeks taken from the weekly cash sheet · update every Monday</h3>
      ${num('schedInThru', 'Use the sheet\'s collections through the week of', 'The weeks the office has "Estimated in from AR" filled in.', { date: 1 })}
      ${num('schedOutThru', 'Use the sheet\'s vendor payments through the week of', 'The weeks with job check runs scheduled (September and October invoices, Comdata, Lanae).', { date: 1 })}
      <table class="grid mini"><thead><tr><th>Week of</th><th>Collections</th><th>Vendor payments (subtotal, plus truck loans)</th></tr></thead><tbody>${schedRows}</tbody></table>
      <div class="src">Payroll and health claims are not taken from the sheet. They come from the manpower boards below, so they grow with the crews.</div>
    </section>
    <section class="drvg"><h3>Payroll · update when the boards change</h3>
      ${num('payroll', 'Payroll, taxes and 401k per week at today\'s crews', 'Weekly cash sheet: net payroll + federal and Oregon taxes + 401k (prevailing wage and deferrals). Last week: $387k gross, $425k with employer taxes.')}
      ${num('baseHours', 'Field hours behind that payroll', 'Manpower board hours for the week that payroll covered.', { step: 10 })}
      ${num('fixedGross', 'Support, service and office gross per week', 'Time Card History by Department: CAD, PM/PA, service and work order, indirect, office and officers. Stays the same week to week.')}
      ${num('fieldRate', 'Field gross per manpower board hour', 'Field direct gross ÷ board hours ($204,894 ÷ 3,742 last week). Covers overtime and crews not on the board.', { step: 0.5 })}
      ${num('health', 'Health insurance claims per week', 'Weekly cash sheet.')}
      <div class="src">Payroll paid each Friday covers the week before. Weekly payroll = payroll at today's crews × (support gross + field rate × that week's board hours) ÷ (support gross + field rate × ${S.baseHours} hours).</div>
      <details><summary>Manpower board hours by week (all jobs)</summary><div class="hrs">${hourRows}</div></details>
    </section>
    <section class="drvg"><h3>Collections · update monthly</h3>
      ${num('days', 'Days owners take to pay (usual)', 'From payment history; the cash section\'s "Owners pay in" setting.', { step: 5 })}
      <table class="grid mini"><thead><tr><th>Job</th><th>Days to pay</th><th></th></tr></thead><tbody>${jd}</tbody></table>
      <div class="row2"><input id="laNewJob" placeholder="Job # (e.g. 1614)" style="width:130px"><input id="laNewDays" type="number" placeholder="days" style="width:80px"><button class="ghost sm" id="laAddJob">Add slow or fast payer</button></div>
      ${num('svcDays', 'Service: days after month end to collect', 'Service and work orders, using the monthly run rate from the Overhead and service section.', { step: 5 })}
      <div class="src">Contract jobs: each invoice on the 10/31 AR aging is collected that many days after its date (unless it falls in the weeks taken from the cash sheet). New billings follow the profit forecast, billed on the ${(state.settings.cash || {}).billDay || 20}th. Piping Rock and the other likely jobs bill their monthly revenue on the 20th.</div>
      <h3 style="margin-top:12px">Retention releases</h3>
      <table class="grid mini"><thead><tr><th>Job</th><th>Amount</th><th>Expected</th><th></th></tr></thead><tbody>${list('retention', S.retention || [])}</tbody></table>
      <button class="ghost sm" data-laadd="retention">+ Add retention</button>
    </section>
    <section class="drvg"><h3>Job vendors and subs · check quarterly</h3>
      ${num('pwp', 'Share of each owner payment that goes to that job\'s vendors and subs', 'Paid when paid: subs (6% of job cost) plus 85% of materials (47% of job cost), on about 80% cost of revenue ≈ 37%; the 10/31 AP ÷ AR on jobs is 47%. Using 40%.', { pct: 1, step: 1 })}
      ${num('matsLater', 'Materials not held, as a share of job cost (paid the next month)', '15% of materials × 47% of job cost.', { pct: 1, step: 0.5 })}
      ${num('likelyNonLabor', 'New jobs: share of cost that is materials and subs', 'Job Summary Cost Report: materials 47% + subs 6%. Labor is already in payroll.', { pct: 1, step: 1 })}
    </section>
    <section class="drvg"><h3>Recurring payments · check quarterly</h3>
      ${num('lanae', 'Non-job check run (Lanae), per week', 'Weekly cash sheet. Assumed to cover rent, insurance, utilities and service-department vendors.')}
      ${num('usbank', 'US Bank cards, per week', 'Weekly cash sheet.')}
      ${num('comdata', 'Comdata fuel, per month (5th)', 'Weekly cash sheet.')}
      ${num('dor', 'WA DOR, per month (25th)', 'Weekly cash sheet (upcoming payments).')}
      ${num('auto', 'Truck loans, per month (1st and 15th)', 'Debt schedule: $37,632 principal + 5.5% interest.')}
      ${num('draws', 'Owner draws, per month', 'Owners: small items only, about $10k a month in total.')}
      ${num('quarterly', 'Quarterly payroll taxes (each quarter)', 'Weekly cash sheet: WA paid medical leave $85k, L&I $90k, WA unemployment $80k, FUTA/OR $1.5k.')}
      ${num('q1', 'First quarterly due', '', { date: 1 })}${num('q2', 'Second quarterly due', '', { date: 1 })}
      ${num('match', '401k match (office)', 'Once a year, around May.')}${num('matchDate', '401k match paid', '', { date: 1 })}
      <h3 style="margin-top:12px">Other one-time payments</h3>
      <table class="grid mini"><thead><tr><th>What</th><th>Amount</th><th>Date</th><th></th></tr></thead><tbody>${list('oneOff', S.oneOff || [])}</tbody></table>
      <button class="ghost sm" data-laadd="oneOff">+ Add a payment</button>
    </section>
  </div>
  <div class="foot"><button class="ghost" id="laReset">Reset all drivers to the starting values</button></div>`;
}

function bindLook() {
  const root = $('#lookdoc');
  root.querySelectorAll('[data-ladrill]').forEach(el => el.onclick = () => {
    const A = window._la, cat = el.dataset.ladrill, m = el.dataset.m;
    const lab = [...LA_IN, ...LA_OUT].find(([k]) => cat.endsWith(':' + k));
    const its = (A.items[cat] || []).filter(x => A.mOf(x.i) === m).map(x => ({ key: x.key, label: x.label, amt: cat.startsWith('out') ? -x.amt : x.amt, week: A.W[x.i] }));
    showDrill(`${lab ? lab[1] : cat} · ${mLong(m)}`, its, 'Weeks count in the month their Friday falls in.');
  });
  root.querySelectorAll('[data-la]').forEach(el => el.onchange = () => {
    const k = el.dataset.la; let v = el.value;
    if (el.type === 'date') { if (!v) return; if (k === 'start' || k === 'schedInThru' || k === 'schedOutThru') v = monOf(v); }
    else v = el.dataset.pct ? Number(v) / 100 : Number(v);
    laSave({ [k]: v });
  });
  root.querySelectorAll('[data-lamap]').forEach(el => el.onchange = () => {
    const S = laIn(), m = el.dataset.lamap, o = Object.assign({}, S[m] || {});
    if (el.value === '') delete o[el.dataset.k]; else o[el.dataset.k] = Number(el.value);
    laSave({ [m]: o });
  });
  root.querySelectorAll('[data-ladel]').forEach(el => el.onclick = () => { const S = laIn(), m = el.dataset.ladel, o = Object.assign({}, S[m] || {}); delete o[el.dataset.k]; laSave({ [m]: o }); });
  root.querySelectorAll('[data-lalist]').forEach(el => el.onchange = () => {
    const S = laIn(), m = el.dataset.lalist, arr = (S[m] || []).map(x => Object.assign({}, x)), i = +el.dataset.i, f = el.dataset.f;
    arr[i][f] = f === 'amt' ? Number(el.value) : el.value; laSave({ [m]: arr });
  });
  root.querySelectorAll('[data-lalistdel]').forEach(el => el.onclick = () => { const S = laIn(), m = el.dataset.lalistdel, arr = (S[m] || []).slice(); arr.splice(+el.dataset.i, 1); laSave({ [m]: arr }); });
  root.querySelectorAll('[data-laadd]').forEach(el => el.onclick = () => { const S = laIn(), m = el.dataset.laadd; laSave({ [m]: [...(S[m] || []), { name: '', amt: 0, date: '' }] }); });
  const add = $('#laAddJob'); if (add) add.onclick = () => { const k = jobKey($('#laNewJob').value), d = Number($('#laNewDays').value); if (!k || !d) return; const S = laIn(); laSave({ jobDays: Object.assign({}, S.jobDays || {}, { [k]: d }) }); };
  const rs = $('#laReset'); if (rs) rs.onclick = () => { if (confirmReset()) { state.settings.lookahead = {}; saveGlobal(); renderLook(); } };
}
function confirmReset() { const b = $('#laReset'); if (b.dataset.armed) return true; b.dataset.armed = '1'; b.textContent = 'Click again to reset every driver'; setTimeout(() => { b.textContent = 'Reset all drivers to the starting values'; delete b.dataset.armed; }, 4000); return false; }

// ---------- views: forecast · cash lookahead · bank & bonding report ----------
function setView(v) {
  ui.report = v === 'report'; ui.look = v === 'look'; ui.score = v === 'score';
  document.body.classList.toggle('rep', ui.report); document.body.classList.toggle('la', ui.look); document.body.classList.toggle('sc', ui.score);
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  try { history.replaceState(null, '', v === 'main' ? location.pathname + location.search : '#' + v); } catch (e) {}
  window.scrollTo(0, 0);
  render();
}
function openReport(on) { setView(on ? 'report' : 'main'); }
function bindViews() {
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));
  if (location.hash === '#look') setView('look'); if (location.hash === '#score') setView('score');
}

boot();
