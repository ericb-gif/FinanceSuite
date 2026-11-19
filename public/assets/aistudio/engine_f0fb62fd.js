// ===== Forecast engine and report parsers (no DOM) =====
const DEPTS = {
  '00': 'BG Projects',
  '01': 'TC Projects',
  '02': 'BG Service',
  '03': 'TC Service',
};
const DEPT_ORDER = ['00', '01', '02', '03'];

function jobKey(j) {
  if (j === null || j === undefined) return '';
  return String(j).trim().replace(/^0+(?=\d)/, '').toUpperCase();
}
function num(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (v === null || v === undefined || v === '') return 0;
  let s = String(v).trim();
  let neg = /^\(.*\)$/.test(s) || /-$/.test(s);
  s = s.replace(/[$,()\s]/g, '').replace(/-$/, '');
  const n = parseFloat(s);
  if (!isFinite(n)) return 0;
  return neg ? -Math.abs(n) : n;
}
function isNumLike(v) {
  if (typeof v === 'number') return isFinite(v);
  if (typeof v !== 'string') return false;
  return /^\(?-?\$?[\d,]+(\.\d+)?\)?-?$/.test(v.trim()) && /\d/.test(v);
}
function txt(v) { return v === null || v === undefined ? '' : String(v).trim(); }

// ---- months ----
function mkey(y, m) { // m 1..12, may overflow
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}
function mAdd(k, n) { const [y, m] = k.split('-').map(Number); return mkey(y, m + n); }
function mDiff(a, b) { // a - b in months
  const [ya, ma] = a.split('-').map(Number), [yb, mb] = b.split('-').map(Number);
  return (ya - yb) * 12 + (ma - mb);
}
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function mLabel(k) { const [y, m] = k.split('-').map(Number); return MON[m - 1] + ' ' + String(y).slice(2); }
function mLong(k) { const [y, m] = k.split('-').map(Number); return MON[m - 1] + ' ' + y; }

function monthFromText(s) {
  // returns YYYY-MM from things like 26.09.30, 9/30/26, 2026-09-30
  if (!s) return null;
  s = String(s);
  let m = s.match(/(\d{2})\.(\d{2})\.(\d{2})/);
  if (m) return '20' + m[1] + '-' + m[2];
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + String(m[1]).padStart(2, '0'); }
  m = s.match(/(20\d{2})-(\d{2})-\d{2}/);
  if (m) return m[1] + '-' + m[2];
  return null;
}
function monthFromDate(v) {
  if (v instanceof Date && !isNaN(v)) return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0');
  if (typeof v === 'number' && v > 30000 && v < 80000) { // excel serial
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
  }
  return monthFromText(v);
}

// ---- identify file ----
function identify(sheets) { // sheets: [{name, rows}]
  const sample = sheets.slice(0, 8).map(s => s.rows.slice(0, 60).map(r => r.map(txt).join('|')).join('\n')).join('\n').toLowerCase();
  if (/job #/.test(sample) && /projected cost/.test(sample)) return 'wip';
  if (/comparative income statement|total overhead costs/.test(sample)) return 'pnl';
  if (/labor ct:|subcontract ct:|job summary cost/.test(sample)) return 'cost';
  if (/a\/r|receivable|aged open items/.test(sample)) return 'ar';
  if (/invoice/.test(sample) && /non-?\s*retention/.test(sample)) { if (/\bcustomer\b|salesperson/.test(sample)) return 'ar'; if (/vendor/.test(sample)) return 'ap'; }
  if (/a\/p|payable/.test(sample)) return 'ap';
  if (/job summary cost report|month to|job to/.test(sample)) return 'cost';
  if (sheets.some(s => /^0[0-3]\s/.test(s.name))) return 'pnl';
  return null;
}

// ---- WIP ----
function parseWIP(sheets, filename) {
  const sh = sheets.find(s => s.rows.some(r => r.some(c => txt(c) === 'Job #'))) || sheets[0];
  const jobs = [];
  let H = null;
  for (const r of sh.rows) {
    const cells = r.map(txt);
    if (cells.includes('Job #')) {
      const find = (name, occ = 0) => { let n = -1; for (let i = 0; i < cells.length; i++) if (cells[i].toLowerCase() === name.toLowerCase() && ++n === occ) return i; return -1; };
      H = {
        dept: find('Department'), job: find('Job #'), name: find('Job Name'), contract: find('Contract'),
        pcost: find('Projected Cost'), act: find('Act. Cost'), billed: find('Billed'),
        pprofit: find('Profit', 0), profit: find('Profit', 1), earned: find('Earned Revenue'),
      };
      continue;
    }
    if (!H || H.job < 0) continue;
    const job = txt(r[H.job]);
    const dept = txt(r[H.dept]);
    if (!job || /total/i.test(dept) || /total/i.test(job)) continue;
    let d = dept;
    if (/^\d+$/.test(d)) d = d.padStart(2, '0');
    jobs.push({
      dept: d, job, key: jobKey(job), name: txt(r[H.name]),
      contract: num(r[H.contract]), pcost: num(r[H.pcost]), act: num(r[H.act]),
      profit: H.profit >= 0 ? num(r[H.profit]) : 0, billed: H.billed >= 0 ? num(r[H.billed]) : 0,
    });
  }
  const asOf = monthFromText(sh.name) || monthFromText(filename);
  return { asOf, jobs, file: filename, sheet: sh.name };
}

// ---- Job cost report ----
const JOB_RE = /^[A-Z]{0,8}\d{4,6}$|^[A-Z]{4,10}$/;
function parseCost(sheets, filename) {
  const sh = sheets[0];
  let asOf = null, period = null, year = null;
  const all = sheets.flatMap(s => s.rows);
  for (const r of all.slice(0, 40)) for (let i = 0; i < r.length; i++) {
    const c = txt(r[i]);
    let m = c.match(/through period end date:?\s*(\S+)/i);
    if (m) asOf = monthFromText(m[1]) || monthFromDate(r[i + 1]);
    else if (/through period end date/i.test(c)) asOf = monthFromDate(r[i + 1]) || monthFromDate(r[i + 2]);
    m = c.match(/^period:?\s*(\d{1,2})$/i); if (m) period = +m[1];
    if (/^period:?$/i.test(c) && isNumLike(r[i + 1])) period = num(r[i + 1]);
    m = c.match(/^year:?\s*(\d{2,4})$/i); if (m) year = +m[1];
    if (/^year:?$/i.test(c) && isNumLike(r[i + 1])) year = num(r[i + 1]);
  }
  if (!asOf && period && year) asOf = mkey(year < 100 ? 2000 + year : year, period);
  // find job column
  let best = { col: -1, n: 0 };
  for (let c = 0; c < 4; c++) {
    let n = 0;
    for (const r of sh.rows) if (JOB_RE.test(txt(r[c]).toUpperCase()) && /\d/.test(txt(r[c]))) n++;
    if (n > best.n) best = { col: c, n };
  }
  const jc = best.col;
  // header text per column (join of header rows)
  const header = [];
  const rows = [];
  for (const r of sh.rows) {
    const j = txt(r[jc]);
    if (jc >= 0 && JOB_RE.test(j.toUpperCase()) && (/\d/.test(j) || /[A-Z]{4,}/.test(j)) && !/^(job|report|year|period)$/i.test(j)) {
      const vals = {}; let name = '';
      for (let i = 0; i < r.length; i++) {
        if (i === jc) continue;
        if (isNumLike(r[i])) vals[i] = num(r[i]);
        else if (!name && txt(r[i]) && i <= jc + 2) name = txt(r[i]);
      }
      if (Object.keys(vals).length) rows.push({ job: j, key: jobKey(j), name, vals });
    } else if (!rows.length) {
      r.forEach((c, i) => { const t = txt(c); if (t) header[i] = (header[i] ? header[i] + ' ' : '') + t; });
    }
  }
  const groups = {};
  const gStart = name => header.findIndex(h => h && new RegExp(name, 'i').test(h));
  const lab = gStart('labor'), mat = gStart('material'), sub = gStart('subcontract');
  const numCols = [...new Set(rows.flatMap(r => Object.keys(r.vals).map(Number)))].sort((a, b) => a - b);
  const jtdIn = st => { if (st < 0) return undefined; const cs = header.map((h, i) => i).filter(i => i >= st && /job to/i.test(header[i] || '')); return cs.length ? cs[0] : undefined; };
  groups.labJ = jtdIn(lab); groups.matJ = jtdIn(mat); groups.subJ = jtdIn(sub);
  if (groups.labJ === undefined && numCols.length === 12) { groups.labJ = numCols[1]; groups.matJ = numCols[4]; groups.subJ = numCols[7]; } // Spectrum export with no headings: labor, material, sub, totals × (month, to date, estimate)
  return { asOf, rows, header, groups: (groups.labJ !== undefined ? groups : null), file: filename, map: null };
}
// choose month-cost / to-date-cost columns
function detectCostColumns(cost, wip) {
  const cols = new Set();
  cost.rows.forEach(r => Object.keys(r.vals).forEach(k => cols.add(+k)));
  const list = [...cols].sort((a, b) => a - b);
  if (wip && wip.jobs.length) {
    const act = new Map(wip.jobs.map(j => [j.key, j.act]));
    let best = null;
    for (const a of list) for (const b of list) {
      if (a === b) continue;
      let score = 0, active = 0;
      for (const r of cost.rows) {
        if (!act.has(r.key)) continue;
        const mtd = r.vals[a] || 0, jtd = r.vals[b] || 0;
        if (Math.abs(jtd - mtd - act.get(r.key)) <= 2) { score++; if (Math.abs(mtd) > 0) active++; }
      }
      const s = score * 1000 + active * 10 + b; // prefer more matches, more activity, rightmost
      if (!best || s > best.s) best = { s, mtd: a, jtd: b, score, active };
    }
    if (best && best.score >= 3 && best.active >= 1) return { mtd: best.mtd, jtd: best.jtd, how: 'matched', score: best.score };
  }
  // Spectrum export with no headings: 4 groups of (month, to date, estimate); totals are the last group
  if (list.length === 12 && !cost.header.some(h => /estimate/i.test(h || ''))) return { mtd: list[9], jtd: list[10], how: 'layout' };
  // header fallback: last "Estimate" column, JTD and MTD to its left
  let est = -1;
  cost.header.forEach((h, i) => { if (/estimate/i.test(h || '')) est = i; });
  const left = list.filter(c => est < 0 || c < est);
  if (left.length >= 2) return { mtd: left[left.length - 2], jtd: left[left.length - 1], how: 'header' };
  return null;
}

// ---- P&L ----
function parsePNL(sheets, filename) {
  const depts = {};
  let asOf = null;
  for (const sh of sheets) {
    const m = sh.name.match(/^(\d{2})\b/);
    if (!m) continue;
    const code = m[1];
    let avgCol = -1, ytdCol = -1, mtdCol = -1;
    const vals = {};
    for (const r of sh.rows) {
      for (let i = 0; i < r.length; i++) {
        const t = txt(r[i]);
        if (/^ytd monthly averages$/i.test(t)) avgCol = i;
        if (/^ytd activity as of/i.test(t)) ytdCol = i;
        if (/^mtd activity as of/i.test(t)) mtdCol = i;
        if (/^financials through:?$/i.test(t) && !asOf) asOf = monthFromDate(r[i + 1]);
      }
    }
    for (const r of sh.rows) {
      for (let i = 0; i < r.length; i++) {
        const t = txt(r[i]);
        if ((['Total Overhead Costs', 'WO Profit', 'Work Order Revenue', 'Total Revenue', 'Total Gross Profit', 'Net Income/(Net Loss) for the Year', 'Interest Expense'].includes(t) || /^Depreciation/i.test(t)) && !(t in vals)) {
          vals[t] = { avg: avgCol >= 0 ? num(r[avgCol]) : null, ytd: ytdCol >= 0 ? num(r[ytdCol]) : null, mtd: mtdCol >= 0 ? num(r[mtdCol]) : null };
        }
      }
    }
    const months = asOf ? +asOf.split('-')[1] : null;
    const avg = k => { const v = vals[k]; if (!v) return 0; if (v.avg !== null && avgCol >= 0) return v.avg; return months ? v.ytd / months : 0; };
    const mtd = k => vals[k] && vals[k].mtd !== null ? vals[k].mtd : 0;
    // depreciation and interest expense, for EBITDA
    const sumL = (re, f) => Object.entries(vals).filter(([k]) => re.test(k)).reduce((a, [, v]) => a + (f === 'avg' ? (v.avg !== null && avgCol >= 0 ? v.avg : (months ? (v.ytd || 0) / months : 0)) : (v.ytd || 0)), 0);
    const da = { depAvg: sumL(/^depreciation/i, 'avg'), depYtd: sumL(/^depreciation/i, 'ytd'), intAvg: -sumL(/^interest expense$/i, 'avg'), intYtd: -sumL(/^interest expense$/i, 'ytd') };
    depts[code] = Object.assign(da, {
      mtdOverhead: mtd('Total Overhead Costs'), mtdWoProfit: mtd('WO Profit'), mtdWoRevenue: mtd('Work Order Revenue'),
      mtdTotRevenue: mtd('Total Revenue'), mtdTotGP: mtd('Total Gross Profit'), totRevenue: avg('Total Revenue'), totGP: avg('Total Gross Profit'),
      name: sh.name.replace(/^\d{2}\s*/, ''),
      overhead: avg('Total Overhead Costs'),
      woProfit: avg('WO Profit'),
      woRevenue: avg('Work Order Revenue'),
      ytdNet: vals['Net Income/(Net Loss) for the Year'] ? vals['Net Income/(Net Loss) for the Year'].ytd : null,
      ytdRevenue: vals['Total Revenue'] ? vals['Total Revenue'].ytd : null,
      ytdGP: vals['Total Gross Profit'] ? vals['Total Gross Profit'].ytd : null,
      ytdOverhead: vals['Total Overhead Costs'] ? vals['Total Overhead Costs'].ytd : null,
    });
  }
  return { asOf, depts, file: filename };
}

// ---- forecast ----
function S(t) { t = Math.min(1, Math.max(0, t)); return 3 * t * t - 2 * t * t * t; }
function Sinv(p) { p = Math.min(1, Math.max(0, p)); let lo = 0, hi = 1; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (S(m) < p) lo = m; else hi = m; } return (lo + hi) / 2; }

function buildMonths(state) {
  const wip = state.wip;
  if (!wip || !wip.asOf) return null;
  const first = mAdd(wip.asOf, 1);
  let actual = null;
  const cost = state.cost;
  const costMonth = cost && (cost.asOfOverride || cost.asOf);
  if (cost && cost.map && costMonth && mDiff(costMonth, wip.asOf) >= 1) actual = costMonth;
  const horizon = state.settings.horizon || 3;
  const months = [];
  const start = actual || first;
  if (actual) months.push(actual);
  for (let i = 0; i < horizon; i++) months.push(mAdd(start, actual ? i + 1 : i));
  return { months, actual, first, gap: actual ? mDiff(actual, wip.asOf) : 1 };
}

function defaultMode(job, settings) {
  return job.contract >= (settings.threshold || 1000000) ? 'even' : 'auto';
}

// T&M jobs: every dollar of cost earns revenue at the job's profit % (job-to-date unless overridden)
function forecastTM(job, s, M, settings, x) {
  const { hasActual, actualCost, jtd0, jtdStart, costRec, out } = x;
  const months = M.months;
  const earned0 = jtd0 + job.profit;
  const hist = earned0 > 0 ? job.profit / earned0 : 0;
  const m = (s.tmPct !== undefined && s.tmPct !== null && s.tmPct !== '') ? Number(s.tmPct) : hist;
  let rate = (s.rate !== undefined && s.rate !== null && s.rate !== '') ? Number(s.rate) : null;
  if (rate === null) rate = hasActual ? Math.max(0, actualCost) : Math.max(0, (costRec && costRec.mtd) || 0);
  const finish = s.finish || null;
  let cum = jtd0, earned = earned0, cumGP = job.profit;
  months.forEach((k, i) => {
    const isActual = hasActual && i === 0;
    let cost = isActual ? actualCost : (finish && mDiff(k, finish) > 0 ? 0 : rate);
    const rev = m < 1 ? cost / (1 - m) : cost;
    const gp = rev - cost;
    cum += cost; earned += rev; cumGP += gp;
    out.months.push({ k, cost, rev, gp, pct: null, est: cum, cumGP, earned, actual: isActual, pctOv: null });
  });
  Object.assign(out, {
    tm: true, tmPct: m, tmHist: hist, rate, finish, mode: 'tm', modeSet: 'tm',
    C: earned, Cfinal: earned, Cbill: Infinity, Pbase: cum, finalCost: cum, jtdStart, earned0,
    gpNow: m, gpWip: job.contract > 0 && job.pcost > 0 ? (job.contract - job.pcost) / job.contract : null, gpFinal: m,
    pctStart: null, remaining: 0, target: null, coRev: 0, coCost: 0, coCount: 0,
  });
  out.active = out.months.some(mm => Math.abs(mm.cost) > 1);
  return out;
}
function forecastJob(job, costRec, M, settings) {
  const s = (settings.jobs && settings.jobs[job.key]) || {};
  const months = M.months;
  const out = { key: job.key, months: [], flags: [] };
  const hasActual = !!M.actual;
  const jtd0 = job.act;
  const actualCost = hasActual ? (costRec ? costRec.jtd - jtd0 : 0) : null;
  const jtdStart = hasActual ? jtd0 + actualCost : jtd0;
  if (s.tm) return forecastTM(job, s, M, settings, { hasActual, actualCost, jtd0, jtdStart, costRec, out });
  // adjustments to final revenue and cost (change orders, scope, estimate updates), each booked from a chosen month
  const cos = Array.isArray(s.cos) ? s.cos : [];
  const coRev = cos.reduce((a, c) => a + (Number(c.value) || 0), 0);
  const coCost = cos.reduce((a, c) => a + (Number(c.cost) || 0), 0);
  const booked = (c, k) => !c.month || mDiff(k, c.month) >= 0;
  const revAt = k => cos.reduce((a, c) => a + (booked(c, k) ? (Number(c.value) || 0) : 0), 0);
  const unbookedCostAt = k => cos.reduce((a, c) => a + (booked(c, k) ? 0 : (Number(c.cost) || 0)), 0);
  const C = job.contract + coRev;
  const Pbase = Math.max(job.pcost + coCost, jtdStart);
  const noContract = job.contract <= 0 || job.pcost <= 0;
  const target = (s.targetGP !== undefined && s.targetGP !== null && s.targetGP !== '' && C > 0) ? Number(s.targetGP) : null;
  const finalCost = target !== null ? Math.max(C * (1 - target), jtdStart) : Pbase;
  let mode = s.mode || defaultMode(job, settings);
  const finish = s.finish || null;
  out.modeSet = mode;
  if ((mode === 'even' || mode === 'peak') && !finish) {
    mode = 'auto';
    if (finalCost - jtdStart > Math.max(25000, 0.02 * C)) out.flags.push({ type: 'nofinish' });
  }
  out.mode = mode;
  const fcFirst = hasActual ? 1 : 0; // index of first forecast month
  const fcStartKey = months[fcFirst];
  // pace
  let rate = (s.rate !== undefined && s.rate !== null && s.rate !== '') ? Number(s.rate) : null;
  if (rate === null) {
    if (costRec && hasActual) rate = Math.max(0, actualCost);
    else if (!hasActual && costRec) rate = Math.max(0, costRec.mtd || 0);
    else rate = null;
  }
  out.rate = rate;
  // peak weights
  let weights = null, nLeft = finish && fcStartKey ? mDiff(finish, fcStartKey) + 1 : 0;
  if (mode === 'peak' && nLeft > 0) {
    const t0 = Sinv(finalCost > 0 ? jtdStart / finalCost : 1);
    weights = [];
    for (let i = 0; i < nLeft; i++) weights.push(S(t0 + (1 - t0) * (i + 1) / nLeft) - S(t0 + (1 - t0) * i / nLeft));
  }
  // estimate schedule (fade timing)
  const fadeMode = s.fadeMode || 'once';
  const fadeMonth = s.fadeMonth || months[0];
  const gradEnd = finish || months[months.length - 1];
  const gradN = Math.max(1, mDiff(gradEnd, months[0]) + 1);
  const estAt = (k, i) => {
    if (target === null) return Pbase;
    if (fadeMode === 'gradual') return Pbase + (finalCost - Pbase) * Math.min(1, (i + 1) / gradN);
    return mDiff(k, fadeMonth) >= 0 ? finalCost : Pbase;
  };
  const gpOf = (cum, est, Ck) => {
    if (noContract || est <= 0) return 0;
    if (Ck < est) return Ck - est;
    return (Ck - est) * Math.min(1, cum / est);
  };
  let cum = jtd0, gpPrev = job.profit;
  if (noContract) gpPrev = 0;
  for (let i = 0; i < months.length; i++) {
    const k = months[i];
    let cost;
    const isActual = hasActual && i === 0;
    const pctOv = s.pct && s.pct[k] !== undefined && s.pct[k] !== null && s.pct[k] !== '' ? Number(s.pct[k]) : null;
    if (isActual) cost = actualCost;
    else if (pctOv !== null) cost = Math.max(0, Math.min(1, pctOv) * finalCost - cum);
    else {
      const remaining = Math.max(0, finalCost - cum);
      if (mode === 'auto') {
        cost = rate === null ? remaining / 3 : Math.min(rate, remaining);
        if (rate === null && remaining > 1 && i === fcFirst) out.flags.push({ type: 'norate' });
      } else if (mode === 'even') {
        const left = mDiff(finish, k) + 1;
        cost = left <= 1 ? remaining : remaining / left;
        if (mDiff(finish, k) < 0) cost = remaining;
      } else { // peak
        const idx = mDiff(k, fcStartKey);
        if (!weights || idx >= weights.length) cost = remaining;
        else { const rest = weights.slice(idx).reduce((a, b) => a + b, 0); cost = rest > 0 ? remaining * weights[idx] / rest : remaining; }
      }
    }
    cum += cost;
    let est = Math.max(estAt(k, i) - unbookedCostAt(k), cum);
    let Ck = job.contract + revAt(k);
    if (finalCost > 0 && cum >= finalCost - 0.5) est = cum; // job is complete: final cost is known, so stay at 100% (adjustments still land in their booked month)
    const gp = gpOf(cum, est, Ck);
    const gpM = gp - gpPrev;
    const rev = gpM + cost;
    const pct = est > 0 ? cum / est : 0;
    out.months.push({ k, cost, rev, gp: gpM, pct, est, cumGP: gp, earned: cum + gp, actual: isActual, pctOv });
    gpPrev = gp;
  }
  out.earned0 = noContract ? jtd0 : jtd0 + job.profit;
  out.C = C; out.Pbase = Pbase; out.finalCost = finalCost; out.jtdStart = jtdStart;
  out.gpNow = C > 0 ? (C - Pbase) / C : null;
  out.gpWip = job.contract > 0 && job.pcost > 0 ? (job.contract - job.pcost) / job.contract : null;
  out.coRev = coRev; out.coCost = coCost; out.coCount = cos.length;
  out.Cfinal = C; out.Cbill = C;
  out.gpFinal = C > 0 ? (C - finalCost) / C : null;
  out.pctStart = Pbase > 0 ? jtdStart / Pbase : 0;
  out.remaining = Math.max(0, finalCost - jtdStart);
  out.target = target; out.finish = finish;
  // flags
  if (job.pcost > 0 && jtdStart > job.pcost + 1) out.flags.push({ type: 'over', amt: jtdStart - job.pcost });
  if (!noContract && finalCost > C) out.flags.push({ type: 'loss', amt: C - finalCost });
  if (finish && fcStartKey && mDiff(finish, fcStartKey) < 0 && out.remaining > 1) out.flags.push({ type: 'pastfinish' });
  const tot = out.months.reduce((a, m) => a + Math.abs(m.cost) + Math.abs(m.gp), 0);
  out.active = out.remaining > 1 || tot > 1;
  return out;
}

function runForecast(state) {
  const M = buildMonths(state);
  if (!M) return null;
  const costMap = new Map();
  if (state.cost && state.cost.map) {
    const { mtd, jtd } = state.cost.map;
    for (const r of state.cost.rows) costMap.set(r.key, { mtd: r.vals[mtd] || 0, jtd: r.vals[jtd] || 0 });
  }
  const wipKeys = new Set();
  const jobs = state.wip.jobs.map(j => {
    wipKeys.add(j.key);
    let rec = costMap.get(j.key);
    if (!rec && M.actual) rec = { mtd: 0, jtd: j.act };
    const f = forecastJob(j, rec, M, state.settings);
    f.job = j;
    return f;
  });
  const notOnWip = [];
  if (state.cost && state.cost.map) {
    const names = new Map(state.cost.rows.map(r => [r.key, r]));
    for (const [k, v] of costMap) if (!wipKeys.has(k) && Math.abs(v.mtd) > 0) notOnWip.push({ key: k, job: names.get(k).job, name: names.get(k).name, mtd: v.mtd });
  }
  // divisions
  const div = {};
  const ensure = d => div[d] || (div[d] = { months: M.months.map(() => ({ rev: 0, gp: 0, jobRev: 0, jobGP: 0, woRev: 0, woGP: 0, likelyRev: 0, likelyGP: 0, oh: 0 })) });
  DEPT_ORDER.forEach(ensure);
  for (const f of jobs) {
    const d = ensure(DEPTS[f.job.dept] ? f.job.dept : 'other');
    f.months.forEach((m, i) => { d.months[i].jobRev += m.rev; d.months[i].jobGP += m.gp; });
  }
  const pnl = state.pnl ? state.pnl.depts : {};
  const ov = state.settings.overrides || {};
  for (const code of Object.keys(div)) {
    const p = pnl[code] || {};
    const o = ov[code] || {};
    const oh = o.overhead !== undefined && o.overhead !== '' ? Number(o.overhead) : (p.overhead || 0);
    const woGP = p.woProfit || 0;
    const woRev = o.woRevenue !== undefined && o.woRevenue !== '' ? Number(o.woRevenue) : (p.woRevenue || 0);
    div[code].oh = oh; div[code].woGP = woGP; div[code].woRev = woRev;
    const useMtd = state.pnl && M.actual && state.pnl.asOf === M.actual;
    const mo = (state.settings.monthOv || {})[code] || {};
    const mv = (field, k) => { const v = mo[field] && mo[field][k]; return v !== undefined && v !== null && v !== '' ? Number(v) : null; };
    const everyPct = o.woPct !== undefined && o.woPct !== '' ? Number(o.woPct) : null;
    const avgPct = woRev > 0 ? woGP / woRev : 0;
    div[code].basePct = everyPct !== null ? everyPct : avgPct;
    const svc = (code === '02' || code === '03') && state.settings.serviceRunRate !== false;
    div[code].runRate = svc;
    if (svc) {
      const tRev = p.totRevenue !== undefined ? p.totRevenue : woRev;
      const tGP = p.totGP !== undefined ? p.totGP : woGP;
      const ev = (f) => o[f] !== undefined && o[f] !== '' ? Number(o[f]) : null;
      const baseRev = ev('woRevenue') !== null ? ev('woRevenue') : tRev;
      const basePct = ev('woPct') !== null ? ev('woPct') : (tRev > 0 ? tGP / tRev : 0);
      div[code].basePct = basePct;
      div[code].months.forEach((m, i) => {
        const k = M.months[i];
        const act = i === 0 && useMtd && p.mtdTotRevenue !== undefined;
        let rev = act ? p.mtdTotRevenue : baseRev;
        let pc = act ? (p.mtdTotRevenue ? p.mtdTotGP / p.mtdTotRevenue : 0) : basePct;
        let ohv = act ? (p.mtdOverhead || 0) : oh;
        if (mv('woRevenue', k) !== null) rev = mv('woRevenue', k);
        if (mv('woPct', k) !== null) pc = mv('woPct', k);
        if (mv('overhead', k) !== null) ohv = mv('overhead', k);
        m.jobRev = 0; m.jobGP = 0;
        m.oh = ohv; m.woRev = rev; m.woPct = pc; m.woGP = rev * pc; m.fromMtd = act;
      });
      continue;
    }
    div[code].months.forEach((m, i) => {
      const k = M.months[i];
      const act = i === 0 && useMtd;
      let rev = act ? (p.mtdWoRevenue || 0) : woRev;
      let pc = act ? ((p.mtdWoRevenue || 0) > 0 ? (p.mtdWoProfit || 0) / p.mtdWoRevenue : 0) : div[code].basePct;
      let ohv = act ? (p.mtdOverhead || 0) : oh;
      if (mv('woRevenue', k) !== null) rev = mv('woRevenue', k);
      if (mv('woPct', k) !== null) pc = mv('woPct', k);
      if (mv('overhead', k) !== null) ohv = mv('overhead', k);
      m.oh = ohv; m.woRev = rev; m.woPct = pc; m.woGP = rev * pc; m.fromMtd = act;
    });
  }
  if (state.settings.includeLikely !== false) {
    for (const L of (state.settings.likely || [])) {
      const d = ensure(DEPTS[L.dept] ? L.dept : 'other');
      M.months.forEach((k, i) => { const r = Number((L.rev || {})[k]) || 0; d.months[i].likelyRev += r; d.months[i].likelyGP += r * (Number(L.gp) || 0); });
    }
  }
  const total = M.months.map(() => ({ rev: 0, gp: 0, oh: 0, net: 0, jobGP: 0, woGP: 0, likelyGP: 0 }));
  for (const code of Object.keys(div)) div[code].months.forEach((m, i) => {
    m.rev = m.jobRev + m.woRev + m.likelyRev;
    m.gp = m.jobGP + m.woGP + m.likelyGP;
    m.net = m.gp - m.oh;
    const t = total[i]; t.rev += m.rev; t.gp += m.gp; t.oh += m.oh; t.net += m.net; t.jobGP += m.jobGP; t.woGP += m.woGP; t.likelyGP += m.likelyGP;
  });
  return { M, jobs, div, total, notOnWip };
}


// ---- AR / AP aging ----
function dateOf(v) {
  if (v instanceof Date && !isNaN(v)) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  if (typeof v === 'number' && v > 30000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000);
  const m = txt(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) return new Date(Date.UTC(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1] - 1, +m[2]));
  return null;
}
function iso(d) { return d ? d.toISOString().slice(0, 10) : null; }
function findHeader(rows, tests) {
  // returns {row, cols:{name:index}} for first row where most tests match
  for (let r = 0; r < Math.min(rows.length, 60); r++) {
    const cells = rows[r].map(c => txt(c).replace(/\s+/g, ' ').toLowerCase());
    const cols = {}; let hits = 0;
    for (const [name, re0, avoid] of tests) {
      let idx = -1;
      for (const re of (Array.isArray(re0) ? re0 : [re0])) { cells.forEach((c, i) => { if (idx < 0 && re.test(c) && !(avoid && avoid.test(c))) idx = i; }); if (idx >= 0) break; }
      if (idx >= 0) { cols[name] = idx; hits++; }
    }
    if (hits >= 2 && (cols.amount !== undefined)) return { row: r, cols };
  }
  return null;
}
function jobFrom(s) {
  s = txt(s).toUpperCase();
  let m = s.match(/JOB:?\s*#?\s*([0-9]{5,6})/); if (m) return m[1];
  m = s.match(/^([0-9]{5,6})(?=[A-Z*\-\s]|$)/); if (m) return m[1];
  return null;
}
function reportMonth(sheets) {
  for (const sh of sheets) for (const r of [...sh.rows.slice(0, 15), ...sh.rows.slice(-6)]) for (let i = 0; i < r.length; i++) {
    const t = txt(r[i]);
    let m = t.match(/(?:through|as of|ending|thru)[^0-9]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    if (m) return monthFromText(m[1]);
    if (/^(as of|through|aging date|period end)/i.test(t) && dateOf(r[i + 1])) return iso(dateOf(r[i + 1])).slice(0, 7);
  }
  return null;
}
function parseAging(sheets, filename, kind) {
  const sh = sheets[0];
  const H = findHeader(sh.rows, [
    ['job', /^job( (no|number|#|code))?\.?$/],
    ['invoice', /invoice( (no|number|#))?$|^inv(oice)? ?#/],
    ['date', /invoice date|inv\.? date|^date$/],
    ['amount', [/non-?retention/, /^(total|balance|open|amount due|balance due|open amount|total due|total open)$/]],
    ['ret', /^retention$|ret(ainage|ention) (due|amount)/, /non/],
  ]);
  const out = { kind, file: filename, asOf: reportMonth(sheets), jobs: {}, invoices: [], noJob: 0, map: H ? H.cols : null };
  if (!H) return out;
  const c = H.cols;
  const isDate = v => v instanceof Date || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(txt(v));
  const dataRows = sh.rows.slice(H.row + 1).filter(row => isNumLike(row[c.amount])).slice(0, 40);
  // the invoice date column is sometimes unlabeled: use the first column that holds dates
  if (c.date === undefined || !dataRows.some(row => isDate(row[c.date]))) {
    const w = Math.max(...dataRows.map(r => r.length), 0);
    for (let i = 0; i < w; i++) if (dataRows.filter(row => isDate(row[i])).length >= dataRows.length * 0.6) { c.date = i; break; }
  }
  // Some Spectrum exports put the numbers one column off from their headings. Find the true
  // non-retention column: it equals the sum of the five aging buckets to its right.
  if (H.row !== undefined && sh.rows[H.row] && /non-?\s*retention/i.test(txt(sh.rows[H.row][c.amount]))) {
    const cn = c.amount; let best = 0, bestScore = -1;
    const body = sh.rows.slice(H.row + 1, H.row + 400).filter(row => !/total/i.test(row.map(txt).join(' ')));
    for (const d of [0, 1, -1, 2]) {
      let sc = 0;
      for (const row of body) {
        const v = row[cn + d]; if (typeof v !== 'number' || Math.abs(v) < 0.01) continue;
        let b = 0; for (let k = 1; k <= 5; k++) b += typeof row[cn + d + k] === 'number' ? row[cn + d + k] : 0;
        if (Math.abs(v - b) < 0.02) sc++;
      }
      if (sc > bestScore) { bestScore = sc; best = d; }
    }
    if (best) { c.amount = cn + best; if (c.ret !== undefined) c.ret += best; }
  }
  let group = null;
  for (let r = H.row + 1; r < sh.rows.length; r++) {
    const row = sh.rows[r];
    const first = txt(row[0]);
    const joined = row.map(txt).join(' ');
    if (/^(customer|vendor|no job)\b/i.test(first) && !/total/i.test(first)) { group = null; continue; }
    if (/total/i.test(joined) && !/^\d/.test(first)) { continue; }
    const g = first.match(/^job:?\s*#?\s*([A-Za-z0-9-]+)/i) || (c.job === undefined ? null : joined.match(/job:?\s*#?\s*([0-9]{5,6})/i));
    if (g) { group = g[1]; if (!isNumLike(row[c.amount])) continue; }
    if (/no job/i.test(joined) && c.job !== undefined && /no job/i.test(txt(row[c.job]))) { out.noJob += num(row[c.amount]); continue; }
    if (!isNumLike(row[c.amount])) continue;
    let job;
    if (c.job !== undefined) {
      const jc = txt(row[c.job]);
      job = jobFrom(jc) || (/^\d{5,6}$/.test(jc) ? jc : null) || group;
    } else job = group || (c.invoice !== undefined ? jobFrom(row[c.invoice]) : null) || jobFrom(row[0]);
    const amt = num(row[c.amount]);
    if (!job) { out.noJob += amt; continue; }
    const key = jobKey(job);
    out.jobs[key] = (out.jobs[key] || 0) + amt;
    const dIso = c.date !== undefined ? iso(dateOf(row[c.date])) : null;
    if (dIso && (!out.lastDate || dIso > out.lastDate)) out.lastDate = dIso;
    if (kind === 'ar') out.invoices.push({ key, date: dIso, amt, inv: txt(row[0]) });
  }
  // A report run "as of" a past month end is stamped with the day it was printed. If no invoice
  // is dated after an earlier month, the report is as of that month.
  if (out.lastDate && (!out.asOf || out.lastDate.slice(0, 7) < out.asOf)) out.asOf = out.lastDate.slice(0, 7);
  return out;
}

// ---- cash ----
function daysToMonth(dateIso, days) {
  const d = new Date(dateIso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 7);
}
function costMix(state, key) {
  const c = state.cost;
  if (!c || !c.groups) return null;
  const r = c.rows.find(x => x.key === key);
  if (!r) return null;
  const g = c.groups, v = i => (i === undefined ? 0 : (r.vals[i] || 0));
  const lab = v(g.labJ), mat = v(g.matJ), sub = v(g.subJ), tot = v(c.map.jtd);
  if (tot <= 0) return null;
  return { lab: Math.max(0, lab / tot), sub: Math.max(0, sub / tot), other: Math.max(0, 1 - lab / tot - sub / tot) };
}
function runCash(state, R) {
  const ar = state.ar, ap = state.ap;
  if (!ar && !ap) return null;
  const cs = Object.assign({ collectDays: 55, billDay: 20, subsPWP: true, matsPWP: 0.85, obHold: 0 }, state.settings.cash || {});
  const obHold = Math.min(0.95, Math.max(0, Number(cs.obHold) || 0));
  // slow and fast payers: the same list the cash lookahead uses
  const jobDays = Object.assign({}, (typeof LA_DEFAULTS !== 'undefined' ? LA_DEFAULTS.jobDays : {}), ((state.settings.lookahead || {}).jobDays) || {});
  const daysFor = key => Number(jobDays[key]) || Number(cs.collectDays) || 55;
  const matShare = Math.min(1, Math.max(0, Number(cs.matsPWP) || 0));
  const M = R.M;
  // anchor: AR/AP month should equal the WIP month or the actual (cost report) month
  const anchor = (ar && ar.asOf) || (ap && ap.asOf) || M.actual || state.wip.asOf;
  const anchorIdx = M.actual && anchor === M.actual ? 0 : (anchor === state.wip.asOf ? -1 : null);
  const months = M.months;
  const startI = anchorIdx === null ? 0 : anchorIdx + 1; // first month whose cash we forecast
  const fmonths = months.slice(startI);
  const tail = [];
  const lastM = months[months.length - 1];
  const res = { anchor, anchorOk: anchorIdx !== null, months: fmonths, jobs: [], tot: fmonths.map(() => ({ cin: 0, cout: 0, net: 0 })), pos0: 0, target0: 0, bills: [], items: [] };
  const defMix = { lab: 0.4, sub: 0.15, other: 0.45 };
  for (const f of R.jobs) {
    const j = f.job, key = f.key;
    if (R.div[j.dept] && R.div[j.dept].runRate) continue;
    const arOpen = ar ? (ar.jobs[key] || 0) : 0;
    const apOpen = ap ? (ap.jobs[key] || 0) : 0;
    // billed and cost at anchor
    let billed = j.billed, costA = j.act, cumGP = j.profit;
    if (anchorIdx === 0) {
      const m0 = f.months[0];
      costA = j.act + m0.cost; cumGP = m0.cumGP;
      if (ar) billed += ar.invoices.filter(x => x.key === key && x.date && x.date.slice(0, 7) === anchor).reduce((a, x) => a + x.amt, 0);
    }
    const cashIn0 = billed - arOpen, cashOut0 = costA - apOpen;
    const pos0 = cashIn0 - cashOut0;
    const C = j.contract;
    const earnedA = costA + cumGP;
    const ou0 = billed - earnedA;
    const finalCost = f.finalCost;
    const rem0 = Math.max(1, finalCost - costA);
    // billed ahead of physical progress at the start
    const ouB0 = billed - (finalCost > 0 && C > 0 ? Math.min(1, costA / finalCost) * f.Cbill : earnedA);
    const mix = costMix(state, key) || defMix;
    // schedule in a map month -> {cin, cout}
    const flow = {};
    const add = (k, field, v, label) => { (flow[k] || (flow[k] = { cin: 0, cout: 0 }))[field] += v; if (Math.abs(v) > 0.5) res.items.push({ k, field, key, label: label || '', amt: v }); };
    // opening AR
    let arByMonth = {};
    const invs = ar ? ar.invoices.filter(x => x.key === key) : [];
    const firstF = fmonths[0];
    if (invs.length && invs.every(x => x.date)) {
      for (const x of invs) { let k = daysToMonth(x.date, daysFor(key)); if (mDiff(k, firstF) < 0) k = firstF; add(k, 'cin', x.amt, `Open invoice${x.inv ? ' ' + x.inv : ''} dated ${x.date}, on the ${mLong(anchor)} AR aging (+${daysFor(key)} days)`); arByMonth[k] = (arByMonth[k] || 0) + x.amt; }
    } else if (arOpen) { add(firstF, 'cin', arOpen / 2, 'Open AR (no invoice dates), half this month'); add(mAdd(firstF, 1), 'cin', arOpen / 2, 'Open AR (no invoice dates), half next month'); arByMonth[firstF] = arOpen / 2; arByMonth[mAdd(firstF, 1)] = arOpen / 2; }
    // opening AP: paid when paid, in step with opening AR collections
    if (apOpen) {
      if (arOpen > 0) for (const k in arByMonth) add(k, 'cout', apOpen * arByMonth[k] / arOpen, `Open AP on the ${mLong(anchor)} aging, paid as the owner pays`);
      else add(firstF, 'cout', apOpen, `Open AP on the ${mLong(anchor)} aging`);
    }
    // forward months
    let billedCum = billed, cum = costA;
    const pos = []; const target = []; const ouList = [];
    for (let i = startI; i < months.length; i++) {
      const m = f.months[i];
      cum += m.cost;
      const earned = cum + m.cumGP;
      const remaining = Math.max(0, finalCost - cum);
      const ou = f.tm ? ou0 : Math.max(0, ou0) * (remaining / rem0) + Math.min(0, ou0) * (remaining / rem0);
      // billing follows physical % complete (cost to date ÷ projected final cost, which is what Sven's % sets),
      // the way the PMs bill, and the amount billed ahead of that backs off as the remaining cost runs down
      const physical = !f.tm && C > 0 && finalCost > 0;
      const basis = physical ? Math.min(1, cum / finalCost) * f.Cbill : earned;
      // front-loaded jobs: the billed-ahead amount holds until the job passes obHold complete, then backs off to zero at the finish
      let ouB = ou;
      if (physical) {
        const holdCost = obHold * finalCost;
        ouB = cum < holdCost ? ouB0 : ouB0 * (remaining / Math.max(1, finalCost - Math.max(costA, holdCost)));
        if (costA >= holdCost) ouB = ouB0 * (remaining / rem0);
      }
      let billTo = basis + ouB;
      if (C > 0) billTo = Math.min(billTo, f.Cbill);
      if (remaining <= 1 && C > 0 && !f.tm) billTo = f.Cbill;
      const bill = Math.max(0, billTo - billedCum);
      billedCum += bill;
      const billDate = m.k + '-' + String(cs.billDay).padStart(2, '0');
      if (bill > 0.5) res.bills.push({ key, k: m.k, date: billDate, amt: bill, cost: m.cost });
      const collectK = daysToMonth(billDate, daysFor(key));
      if (bill) add(collectK, 'cin', bill, `${mLong(m.k)} pay app, billed the ${cs.billDay}th (+${daysFor(key)} days)`);
      const c = m.cost;
      add(m.k, 'cout', c * mix.lab, `${mLong(m.k)} labor (${Math.round(mix.lab * 100)}% of the month's job cost), paid with payroll`);
      // materials: the share held until the owner pays goes out with the collection, the rest the next month
      add(collectK, 'cout', c * mix.other * matShare, `${mLong(m.k)} materials held until the owner pays (${Math.round(matShare * 100)}%)`);
      add(mAdd(m.k, 1), 'cout', c * mix.other * (1 - matShare), `${mLong(m.k)} materials paid the next month (${Math.round((1 - matShare) * 100)}%)`);
      add(cs.subsPWP ? collectK : mAdd(m.k, 1), 'cout', c * mix.sub, `${mLong(m.k)} subcontractors${cs.subsPWP ? ', paid when the owner pays' : ', paid the next month'}`);
      ouList.push(billedCum - earned);
    }
    let p = pos0;
    const jm = fmonths.map((k, idx) => {
      const fl = flow[k] || { cin: 0, cout: 0 };
      p += fl.cin - fl.cout;
      const m = f.months[startI + idx];
      res.tot[idx].cin += fl.cin; res.tot[idx].cout += fl.cout; res.tot[idx].net += fl.cin - fl.cout;
      return { k, cin: fl.cin, cout: fl.cout, pos: p, target: m.cumGP, ou: ouList[idx] };
    });
    // money still to come after the window
    let later = 0; for (const k in flow) if (mDiff(k, lastM) > 0) later += flow[k].cin - flow[k].cout;
    const target0 = anchorIdx === 0 ? f.months[0].cumGP : j.profit;
    res.pos0 += pos0; res.target0 += target0;
    res.jobs.push({ key, f, arOpen, apOpen, billed, cashIn0, cashOut0, pos0, target0, ou0, months: jm, later, endProfit: f.tm ? f.months[f.months.length - 1].cumGP : (C > 0 ? f.Cfinal - finalCost : 0) });
  }
  // company: overhead and work orders by month (cash ~ P&L)
  res.company = fmonths.map((k, idx) => {
    const i = startI + idx;
    let oh = 0, wo = 0;
    for (const code in R.div) { oh += R.div[code].months[i].oh; wo += R.div[code].months[i].woGP + R.div[code].months[i].likelyGP; }
    const jobs = res.tot[idx];
    return { k, jobsIn: jobs.cin, jobsOut: jobs.cout, wo, oh, net: jobs.net + wo - oh };
  });
  res.startI = startI;
  return res;
}

if (typeof module !== 'undefined') module.exports = { parseAging, runCash, parseWIP, parseCost, parsePNL, detectCostColumns, identify, runForecast, forecastJob, buildMonths, mLabel, mLong, mAdd, mDiff, DEPTS, DEPT_ORDER, jobKey };
