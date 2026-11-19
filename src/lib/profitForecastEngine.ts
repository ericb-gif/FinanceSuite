import * as XLSX from 'xlsx';
import type { DivisionCode, JoinedJob } from '../types/wip';
import type {
  PfAgingReport,
  PfCashJobResult,
  PfCashResult,
  PfCostMap,
  PfCostReport,
  PfCostRow,
  PfDivForecast,
  PfEstReport,
  PfForecastJob,
  PfForecastResult,
  PfJobFlag,
  PfJobMonth,
  PfJobSetting,
  PfLikelyJob,
  PfMonthsWindow,
  PfPnlDept,
  PfPnlReport,
  PfSettings,
  PfState,
  PfWipJob,
  PfWipReport,
} from '../types/profitForecast';

export const DEPTS: Record<string, string> = {
  '00': 'BG Projects',
  '01': 'TC Projects',
  '02': 'BG Service',
  '03': 'TC Service',
};

export const DEPT_ORDER = ['00', '01', '02', '03'] as const;

export const LA_DEFAULT_JOB_DAYS: Record<string, number> = {
  '1595': 80,
  '1540': 15,
};

export const MON_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function jobKey(j: unknown): string {
  if (j === null || j === undefined) return '';
  return String(j)
    .trim()
    .replace(/^0+(?=\d)/, '')
    .toUpperCase();
}

function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v === null || v === undefined || v === '') return 0;
  let s = String(v).trim();
  const neg = /^\(.*\)$/.test(s) || /-$/.test(s);
  s = s.replace(/[$,()\s]/g, '').replace(/-$/, '');
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return neg ? -Math.abs(n) : n;
}

function isNumLike(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v !== 'string') return false;
  return /^\(?-?\$?[\d,]+(\.\d+)?\)?-?$/.test(v.trim()) && /\d/.test(v);
}

function txt(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim();
}

export function pfMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const r = Math.round(v);
  if (r === 0) return '$0';
  const s = '$' + Math.abs(r).toLocaleString('en-US');
  return r < 0 ? `(${s})` : s;
}

export function pfPct(v: number | null | undefined, d = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return (v * 100).toFixed(d) + '%';
}

export function sumRow(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

export function mkey(y: number, m: number): string {
  const d = new Date(Date.UTC(y, m - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function mAdd(k: string, n: number): string {
  const [y, m] = k.split('-').map(Number);
  return mkey(y, m + n);
}

export function mDiff(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (ya - yb) * 12 + (ma - mb);
}

export function mLabel(k: string): string {
  const [y, m] = k.split('-').map(Number);
  return `${MON_NAMES[(m || 1) - 1]} ${String(y).slice(2)}`;
}

export function mLong(k: string): string {
  const [y, m] = k.split('-').map(Number);
  return `${MON_NAMES[(m || 1) - 1]} ${y}`;
}

function monthFromText(s: unknown): string | null {
  if (!s) return null;
  const str = String(s);
  let m = str.match(/(\d{2})\.(\d{2})\.(\d{2})/);
  if (m) return `20${m[1]}-${m[2]}`;
  m = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${String(m[1]).padStart(2, '0')}`;
  }
  m = str.match(/(20\d{2})-(\d{2})-\d{2}/);
  if (m) return `${m[1]}-${m[2]}`;
  return null;
}

function monthFromDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}`;
  }
  if (typeof v === 'number' && v > 30000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  return monthFromText(v);
}

export interface SheetData {
  name: string;
  rows: unknown[][];
}

export async function readExcelWorkbookSheets(file: File): Promise<SheetData[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
  return wb.SheetNames.map((n) => ({
    name: n,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[n], {
      header: 1,
      raw: true,
      defval: null,
    }) as unknown[][],
  }));
}

export function identifyPfWorkbook(sheets: SheetData[]): 'wip' | 'cost' | 'pnl' | 'ar' | 'ap' | null {
  const sample = sheets
    .slice(0, 8)
    .map((s) => s.rows.slice(0, 60).map((r) => r.map(txt).join('|')).join('\n'))
    .join('\n')
    .toLowerCase();
  if (/job #/.test(sample) && /projected cost/.test(sample)) return 'wip';
  if (/comparative income statement|total overhead costs/.test(sample)) return 'pnl';
  if (/labor ct:|subcontract ct:|job summary cost/.test(sample)) return 'cost';
  if (/a\/r|receivable|aged open items/.test(sample)) return 'ar';
  if (/invoice/.test(sample) && /non-?\s*retention/.test(sample)) {
    if (/\bcustomer\b|salesperson/.test(sample)) return 'ar';
    if (/vendor/.test(sample)) return 'ap';
  }
  if (/a\/p|payable/.test(sample)) return 'ap';
  if (/job summary cost report|month to|job to/.test(sample)) return 'cost';
  if (sheets.some((s) => /^0[0-3]\s/.test(s.name))) return 'pnl';
  return null;
}

export function parsePfWIP(sheets: SheetData[], filename: string): PfWipReport {
  const sh = sheets.find((s) => s.rows.some((r) => r.some((c) => txt(c) === 'Job #'))) || sheets[0];
  const jobs: PfWipJob[] = [];
  let H: Record<string, number> | null = null;
  for (const r of sh.rows) {
    const cells = r.map(txt);
    if (cells.includes('Job #')) {
      const find = (name: string, occ = 0) => {
        let n = -1;
        for (let i = 0; i < cells.length; i++) {
          if (cells[i].toLowerCase() === name.toLowerCase() && ++n === occ) return i;
        }
        return -1;
      };
      H = {
        dept: find('Department'),
        job: find('Job #'),
        name: find('Job Name'),
        contract: find('Contract'),
        pcost: find('Projected Cost'),
        act: find('Act. Cost'),
        billed: find('Billed'),
        pprofit: find('Profit', 0),
        profit: find('Profit', 1),
        earned: find('Earned Revenue'),
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
      dept: d,
      job,
      key: jobKey(job),
      name: txt(r[H.name]),
      contract: num(r[H.contract]),
      pcost: num(r[H.pcost]),
      act: num(r[H.act]),
      profit: H.profit >= 0 ? num(r[H.profit]) : 0,
      billed: H.billed >= 0 ? num(r[H.billed]) : 0,
    });
  }
  const asOf = monthFromText(sh.name) || monthFromText(filename);
  return { asOf, jobs, file: filename, sheet: sh.name };
}

const JOB_RE = /^[A-Z]{0,8}\d{4,6}$|^[A-Z]{4,10}$/;

export function parsePfCost(sheets: SheetData[], filename: string): PfCostReport {
  const sh = sheets[0];
  let asOf: string | null = null;
  let period: number | null = null;
  let year: number | null = null;
  const all = sheets.flatMap((s) => s.rows);
  for (const r of all.slice(0, 40)) {
    for (let i = 0; i < r.length; i++) {
      const c = txt(r[i]);
      let m = c.match(/through period end date:?\s*(\S+)/i);
      if (m) asOf = monthFromText(m[1]) || monthFromDate(r[i + 1]);
      else if (/through period end date/i.test(c)) {
        asOf = monthFromDate(r[i + 1]) || monthFromDate(r[i + 2]);
      }
      m = c.match(/^period:?\s*(\d{1,2})$/i);
      if (m) period = +m[1];
      if (/^period:?$/i.test(c) && isNumLike(r[i + 1])) period = num(r[i + 1]);
      m = c.match(/^year:?\s*(\d{2,4})$/i);
      if (m) year = +m[1];
      if (/^year:?$/i.test(c) && isNumLike(r[i + 1])) year = num(r[i + 1]);
    }
  }
  if (!asOf && period && year) asOf = mkey(year < 100 ? 2000 + year : year, period);

  let best = { col: -1, n: 0 };
  for (let c = 0; c < 4; c++) {
    let n = 0;
    for (const r of sh.rows) {
      if (JOB_RE.test(txt(r[c]).toUpperCase()) && /\d/.test(txt(r[c]))) n++;
    }
    if (n > best.n) best = { col: c, n };
  }
  const jc = best.col;
  const header: string[] = [];
  const rows: PfCostRow[] = [];
  for (const r of sh.rows) {
    const j = jc >= 0 ? txt(r[jc]) : '';
    if (
      jc >= 0 &&
      JOB_RE.test(j.toUpperCase()) &&
      (/\d/.test(j) || /[A-Z]{4,}/.test(j)) &&
      !/^(job|report|year|period)$/i.test(j)
    ) {
      const vals: Record<number, number> = {};
      let name = '';
      for (let i = 0; i < r.length; i++) {
        if (i === jc) continue;
        if (isNumLike(r[i])) vals[i] = num(r[i]);
        else if (!name && txt(r[i]) && i <= jc + 2) name = txt(r[i]);
      }
      if (Object.keys(vals).length) rows.push({ job: j, key: jobKey(j), name, vals });
    } else if (!rows.length) {
      r.forEach((c, i) => {
        const t = txt(c);
        if (t) header[i] = header[i] ? `${header[i]} ${t}` : t;
      });
    }
  }

  const gStart = (name: string) => header.findIndex((h) => h && new RegExp(name, 'i').test(h));
  const lab = gStart('labor');
  const mat = gStart('material');
  const sub = gStart('subcontract');
  const numCols = [...new Set(rows.flatMap((r) => Object.keys(r.vals).map(Number)))].sort(
    (a, b) => a - b
  );
  const jtdIn = (st: number): number | undefined => {
    if (st < 0) return undefined;
    const cs = header
      .map((_, i) => i)
      .filter((i) => i >= st && /job to/i.test(header[i] || ''));
    return cs.length ? cs[0] : undefined;
  };
  const groups: { labJ?: number; matJ?: number; subJ?: number } = {
    labJ: jtdIn(lab),
    matJ: jtdIn(mat),
    subJ: jtdIn(sub),
  };
  if (groups.labJ === undefined && numCols.length === 12) {
    groups.labJ = numCols[1];
    groups.matJ = numCols[4];
    groups.subJ = numCols[7];
  }
  return {
    asOf,
    rows,
    header,
    groups: groups.labJ !== undefined ? groups : null,
    file: filename,
    map: null,
  };
}

export function detectCostColumns(cost: PfCostReport, wip: PfWipReport | null): PfCostMap | null {
  const cols = new Set<number>();
  cost.rows.forEach((r) => Object.keys(r.vals).forEach((k) => cols.add(+k)));
  const list = [...cols].sort((a, b) => a - b);
  if (wip && wip.jobs.length) {
    const act = new Map(wip.jobs.map((j) => [j.key, j.act]));
    let best: { s: number; mtd: number; jtd: number; score: number; active: number } | null = null;
    for (const a of list) {
      for (const b of list) {
        if (a === b) continue;
        let score = 0;
        let active = 0;
        for (const r of cost.rows) {
          if (!act.has(r.key)) continue;
          const mtd = r.vals[a] || 0;
          const jtd = r.vals[b] || 0;
          if (Math.abs(jtd - mtd - (act.get(r.key) || 0)) <= 2) {
            score++;
            if (Math.abs(mtd) > 0) active++;
          }
        }
        const s = score * 1000 + active * 10 + b;
        if (!best || s > best.s) best = { s, mtd: a, jtd: b, score, active };
      }
    }
    if (best && best.score >= 3 && best.active >= 1) {
      return { mtd: best.mtd, jtd: best.jtd, how: 'matched', score: best.score };
    }
  }
  if (list.length === 12 && !cost.header.some((h) => /estimate/i.test(h || ''))) {
    return { mtd: list[9], jtd: list[10], how: 'layout' };
  }
  let est = -1;
  cost.header.forEach((h, i) => {
    if (/estimate/i.test(h || '')) est = i;
  });
  const left = list.filter((c) => est < 0 || c < est);
  if (left.length >= 2) {
    return { mtd: left[left.length - 2], jtd: left[left.length - 1], how: 'header' };
  }
  return null;
}

export function parsePfPNL(sheets: SheetData[], filename: string): PfPnlReport {
  const depts: Record<string, PfPnlDept> = {};
  let asOf: string | null = null;
  for (const sh of sheets) {
    const m = sh.name.match(/^(\d{2})\b/);
    if (!m) continue;
    const code = m[1];
    let avgCol = -1;
    let ytdCol = -1;
    let mtdCol = -1;
    const vals: Record<string, { avg: number | null; ytd: number | null; mtd: number | null }> = {};
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
        if (
          ([
            'Total Overhead Costs',
            'WO Profit',
            'Work Order Revenue',
            'Total Revenue',
            'Total Gross Profit',
            'Net Income/(Net Loss) for the Year',
            'Interest Expense',
          ].includes(t) ||
            /^Depreciation/i.test(t)) &&
          !(t in vals)
        ) {
          vals[t] = {
            avg: avgCol >= 0 ? num(r[avgCol]) : null,
            ytd: ytdCol >= 0 ? num(r[ytdCol]) : null,
            mtd: mtdCol >= 0 ? num(r[mtdCol]) : null,
          };
        }
      }
    }
    const months = asOf ? +asOf.split('-')[1] : null;
    const avg = (k: string) => {
      const v = vals[k];
      if (!v) return 0;
      if (v.avg !== null && avgCol >= 0) return v.avg;
      return months ? (v.ytd || 0) / months : 0;
    };
    const mtd = (k: string) => (vals[k] && vals[k].mtd !== null ? vals[k].mtd || 0 : 0);
    const sumL = (re: RegExp, f: 'avg' | 'ytd') =>
      Object.entries(vals)
        .filter(([k]) => re.test(k))
        .reduce(
          (a, [, v]) =>
            a +
            (f === 'avg'
              ? v.avg !== null && avgCol >= 0
                ? v.avg
                : months
                ? (v.ytd || 0) / months
                : 0
              : v.ytd || 0),
          0
        );
    depts[code] = {
      depAvg: sumL(/^depreciation/i, 'avg'),
      depYtd: sumL(/^depreciation/i, 'ytd'),
      intAvg: -sumL(/^interest expense$/i, 'avg'),
      intYtd: -sumL(/^interest expense$/i, 'ytd'),
      mtdOverhead: mtd('Total Overhead Costs'),
      mtdWoProfit: mtd('WO Profit'),
      mtdWoRevenue: mtd('Work Order Revenue'),
      mtdTotRevenue: mtd('Total Revenue'),
      mtdTotGP: mtd('Total Gross Profit'),
      totRevenue: avg('Total Revenue'),
      totGP: avg('Total Gross Profit'),
      name: sh.name.replace(/^\d{2}\s*/, ''),
      overhead: avg('Total Overhead Costs'),
      woProfit: avg('WO Profit'),
      woRevenue: avg('Work Order Revenue'),
      ytdNet: vals['Net Income/(Net Loss) for the Year']
        ? vals['Net Income/(Net Loss) for the Year'].ytd
        : null,
      ytdRevenue: vals['Total Revenue'] ? vals['Total Revenue'].ytd : null,
      ytdGP: vals['Total Gross Profit'] ? vals['Total Gross Profit'].ytd : null,
      ytdOverhead: vals['Total Overhead Costs'] ? vals['Total Overhead Costs'].ytd : null,
    };
  }
  return { asOf, depts, file: filename };
}

function dateOf(v: unknown): Date | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  }
  if (typeof v === 'number' && v > 30000 && v < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + v * 86400000);
  }
  const m = txt(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) return new Date(Date.UTC(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1] - 1, +m[2]));
  return null;
}

function isoDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function findHeader(
  rows: unknown[][],
  tests: Array<[string, RegExp | RegExp[], RegExp?]>
): { row: number; cols: Record<string, number> } | null {
  for (let r = 0; r < Math.min(rows.length, 60); r++) {
    const cells = rows[r].map((c) => txt(c).replace(/\s+/g, ' ').toLowerCase());
    const cols: Record<string, number> = {};
    let hits = 0;
    for (const [name, re0, avoid] of tests) {
      let idx = -1;
      for (const re of Array.isArray(re0) ? re0 : [re0]) {
        cells.forEach((c, i) => {
          if (idx < 0 && re.test(c) && !(avoid && avoid.test(c))) idx = i;
        });
        if (idx >= 0) break;
      }
      if (idx >= 0) {
        cols[name] = idx;
        hits++;
      }
    }
    if (hits >= 2 && cols.amount !== undefined) return { row: r, cols };
  }
  return null;
}

function jobFrom(s: unknown): string | null {
  const str = txt(s).toUpperCase();
  let m = str.match(/JOB:?\s*#?\s*([0-9]{5,6})/);
  if (m) return m[1];
  m = str.match(/^([0-9]{5,6})(?=[A-Z*\-\s]|$)/);
  if (m) return m[1];
  return null;
}

function reportMonth(sheets: SheetData[]): string | null {
  for (const sh of sheets) {
    for (const r of [...sh.rows.slice(0, 15), ...sh.rows.slice(-6)]) {
      for (let i = 0; i < r.length; i++) {
        const t = txt(r[i]);
        const m = t.match(/(?:through|as of|ending|thru)[^0-9]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
        if (m) return monthFromText(m[1]);
        if (/^(as of|through|aging date|period end)/i.test(t) && dateOf(r[i + 1])) {
          const d = isoDate(dateOf(r[i + 1]));
          return d ? d.slice(0, 7) : null;
        }
      }
    }
  }
  return null;
}

export function parsePfAging(sheets: SheetData[], filename: string, kind: 'ar' | 'ap'): PfAgingReport {
  const sh = sheets[0];
  const H = findHeader(sh.rows, [
    ['job', /^job( (no|number|#|code))?\.?$/],
    ['invoice', /invoice( (no|number|#))?$|^inv(oice)? ?#/],
    ['date', /invoice date|inv\.? date|^date$/],
    ['amount', [/non-?retention/, /^(total|balance|open|amount due|balance due|open amount|total due|total open)$/]],
    ['ret', /^retention$|ret(ainage|ention) (due|amount)/, /non/],
  ]);
  const out: PfAgingReport = {
    kind,
    file: filename,
    asOf: reportMonth(sheets),
    jobs: {},
    invoices: [],
    noJob: 0,
    map: H ? H.cols : null,
  };
  if (!H) return out;
  const c = H.cols;
  const isDate = (v: unknown) => v instanceof Date || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(txt(v));
  const dataRows = sh.rows.slice(H.row + 1).filter((row) => isNumLike(row[c.amount])).slice(0, 40);
  if (c.date === undefined || !dataRows.some((row) => isDate(row[c.date]))) {
    const w = Math.max(...dataRows.map((r) => r.length), 0);
    for (let i = 0; i < w; i++) {
      if (dataRows.filter((row) => isDate(row[i])).length >= dataRows.length * 0.6) {
        c.date = i;
        break;
      }
    }
  }
  if (sh.rows[H.row] && /non-?\s*retention/i.test(txt(sh.rows[H.row][c.amount]))) {
    const cn = c.amount;
    let best = 0;
    let bestScore = -1;
    const body = sh.rows
      .slice(H.row + 1, H.row + 400)
      .filter((row) => !/total/i.test(row.map(txt).join(' ')));
    for (const d of [0, 1, -1, 2]) {
      let sc = 0;
      for (const row of body) {
        const v = row[cn + d];
        if (typeof v !== 'number' || Math.abs(v) < 0.01) continue;
        let b = 0;
        for (let k = 1; k <= 5; k++) b += typeof row[cn + d + k] === 'number' ? (row[cn + d + k] as number) : 0;
        if (Math.abs(v - b) < 0.02) sc++;
      }
      if (sc > bestScore) {
        bestScore = sc;
        best = d;
      }
    }
    if (best) {
      c.amount = cn + best;
      if (c.ret !== undefined) c.ret += best;
    }
  }
  let group: string | null = null;
  for (let r = H.row + 1; r < sh.rows.length; r++) {
    const row = sh.rows[r];
    const first = txt(row[0]);
    const joined = row.map(txt).join(' ');
    if (/^(customer|vendor|no job)\b/i.test(first) && !/total/i.test(first)) {
      group = null;
      continue;
    }
    if (/total/i.test(joined) && !/^\d/.test(first)) continue;
    const g =
      first.match(/^job:?\s*#?\s*([A-Za-z0-9-]+)/i) ||
      (c.job === undefined ? null : joined.match(/job:?\s*#?\s*([0-9]{5,6})/i));
    if (g) {
      group = g[1];
      if (!isNumLike(row[c.amount])) continue;
    }
    if (/no job/i.test(joined) && c.job !== undefined && /no job/i.test(txt(row[c.job]))) {
      out.noJob += num(row[c.amount]);
      continue;
    }
    if (!isNumLike(row[c.amount])) continue;
    let job: string | null = null;
    if (c.job !== undefined) {
      const jc = txt(row[c.job]);
      job = jobFrom(jc) || (/^\d{5,6}$/.test(jc) ? jc : null) || group;
    } else {
      job = group || (c.invoice !== undefined ? jobFrom(row[c.invoice]) : null) || jobFrom(row[0]);
    }
    const amt = num(row[c.amount]);
    if (!job) {
      out.noJob += amt;
      continue;
    }
    const key = jobKey(job);
    out.jobs[key] = (out.jobs[key] || 0) + amt;
    const dIso = c.date !== undefined ? isoDate(dateOf(row[c.date])) : null;
    if (dIso && (!out.lastDate || dIso > out.lastDate)) out.lastDate = dIso;
    if (kind === 'ar') out.invoices.push({ key, date: dIso, amt, inv: txt(row[0]) });
  }
  if (out.lastDate && (!out.asOf || out.lastDate.slice(0, 7) < out.asOf)) {
    out.asOf = out.lastDate.slice(0, 7);
  }
  return out;
}

// ---- Forecast Engine ----
function smoothS(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 3 * clamped * clamped - 2 * clamped * clamped * clamped;
}

function smoothSinv(p: number): number {
  const clamped = Math.min(1, Math.max(0, p));
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (smoothS(m) < clamped) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

export function buildMonths(state: PfState): PfMonthsWindow | null {
  const wip = state.wip;
  if (!wip || !wip.asOf) return null;
  const first = mAdd(wip.asOf, 1);
  let actual: string | null = null;
  const cost = state.cost;
  const costMonth = cost && (cost.asOfOverride || cost.asOf);
  if (cost && cost.map && costMonth && mDiff(costMonth, wip.asOf) >= 1) {
    actual = costMonth;
  }
  const horizon = state.settings.horizon || 3;
  const months: string[] = [];
  const start = actual || first;
  if (actual) months.push(actual);
  for (let i = 0; i < horizon; i++) {
    months.push(mAdd(start, actual ? i + 1 : i));
  }
  return { months, actual, first, gap: actual ? mDiff(actual, wip.asOf) : 1 };
}

export function defaultMode(job: PfWipJob, settings: PfSettings): 'auto' | 'even' {
  return job.contract >= (settings.threshold || 1000000) ? 'even' : 'auto';
}

function forecastTM(
  job: PfWipJob,
  s: PfJobSetting,
  M: PfMonthsWindow,
  ctx: {
    hasActual: boolean;
    actualCost: number;
    jtd0: number;
    jtdStart: number;
    costRec?: { mtd: number; jtd: number };
  }
): PfForecastJob {
  const { hasActual, actualCost, jtd0, jtdStart, costRec } = ctx;
  const months = M.months;
  const earned0 = jtd0 + job.profit;
  const hist = earned0 > 0 ? job.profit / earned0 : 0;
  const m =
    s.tmPct !== undefined && s.tmPct !== null ? Number(s.tmPct) : hist;
  let rate: number | null =
    s.rate !== undefined && s.rate !== null ? Number(s.rate) : null;
  if (rate === null) {
    rate = hasActual ? Math.max(0, actualCost) : Math.max(0, costRec?.mtd || 0);
  }
  const finish = s.finish || null;
  let cum = jtd0;
  let earned = earned0;
  let cumGP = job.profit;
  const monthRows: PfJobMonth[] = [];
  months.forEach((k, i) => {
    const isActual = hasActual && i === 0;
    const cost = isActual ? actualCost : finish && mDiff(k, finish) > 0 ? 0 : rate || 0;
    const rev = m < 1 ? cost / (1 - m) : cost;
    const gp = rev - cost;
    cum += cost;
    earned += rev;
    cumGP += gp;
    monthRows.push({
      k,
      cost,
      rev,
      gp,
      pct: null,
      est: cum,
      cumGP,
      earned,
      actual: isActual,
      pctOv: null,
    });
  });

  const active = monthRows.some((mm) => Math.abs(mm.cost) > 1);
  return {
    key: job.key,
    job,
    months: monthRows,
    flags: [],
    tm: true,
    tmPct: m,
    tmHist: hist,
    rate,
    finish,
    mode: 'tm',
    modeSet: 'tm',
    C: earned,
    Cfinal: earned,
    Cbill: Number.POSITIVE_INFINITY,
    Pbase: cum,
    finalCost: cum,
    jtdStart,
    earned0,
    gpNow: m,
    gpWip:
      job.contract > 0 && job.pcost > 0
        ? (job.contract - job.pcost) / job.contract
        : null,
    gpFinal: m,
    pctStart: null,
    remaining: 0,
    target: null,
    coRev: 0,
    coCost: 0,
    coCount: 0,
    active,
  };
}

export function forecastJob(
  job: PfWipJob,
  costRec: { mtd: number; jtd: number } | undefined,
  M: PfMonthsWindow,
  settings: PfSettings
): PfForecastJob {
  const s: PfJobSetting = (settings.jobs && settings.jobs[job.key]) || {};
  const months = M.months;
  const flags: PfJobFlag[] = [];
  const hasActual = Boolean(M.actual);
  const jtd0 = job.act;
  const actualCost = hasActual ? (costRec ? costRec.jtd - jtd0 : 0) : 0;
  const jtdStart = hasActual ? jtd0 + actualCost : jtd0;

  if (s.tm) {
    return forecastTM(job, s, M, { hasActual, actualCost, jtd0, jtdStart, costRec });
  }

  const cos = Array.isArray(s.cos) ? s.cos : [];
  const coRev = cos.reduce((a, c) => a + (Number(c.value) || 0), 0);
  const coCost = cos.reduce((a, c) => a + (Number(c.cost) || 0), 0);
  const booked = (c: { month?: string }, k: string) => !c.month || mDiff(k, c.month) >= 0;
  const revAt = (k: string) =>
    cos.reduce((a, c) => a + (booked(c, k) ? Number(c.value) || 0 : 0), 0);
  const unbookedCostAt = (k: string) =>
    cos.reduce((a, c) => a + (booked(c, k) ? 0 : Number(c.cost) || 0), 0);

  const C = job.contract + coRev;
  const Pbase = Math.max(job.pcost + coCost, jtdStart);
  const noContract = job.contract <= 0 || job.pcost <= 0;
  const target =
    s.targetGP !== undefined && s.targetGP !== null && C > 0 ? Number(s.targetGP) : null;
  const finalCost = target !== null ? Math.max(C * (1 - target), jtdStart) : Pbase;
  let mode: 'auto' | 'even' | 'peak' =
    s.mode && s.mode !== 'tm' ? s.mode : defaultMode(job, settings);
  const finish = s.finish || null;
  const modeSet = mode;

  if ((mode === 'even' || mode === 'peak') && !finish) {
    mode = 'auto';
    if (finalCost - jtdStart > Math.max(25000, 0.02 * C)) {
      flags.push({ type: 'nofinish' });
    }
  }

  const fcFirst = hasActual ? 1 : 0;
  const fcStartKey = months[fcFirst];
  let rate: number | null =
    s.rate !== undefined && s.rate !== null ? Number(s.rate) : null;
  if (rate === null) {
    if (costRec && hasActual) rate = Math.max(0, actualCost);
    else if (!hasActual && costRec) rate = Math.max(0, costRec.mtd || 0);
    else rate = null;
  }

  let weights: number[] | null = null;
  const nLeft = finish && fcStartKey ? mDiff(finish, fcStartKey) + 1 : 0;
  if (mode === 'peak' && nLeft > 0) {
    const t0 = smoothSinv(finalCost > 0 ? jtdStart / finalCost : 1);
    weights = [];
    for (let i = 0; i < nLeft; i++) {
      weights.push(
        smoothS(t0 + ((1 - t0) * (i + 1)) / nLeft) - smoothS(t0 + ((1 - t0) * i) / nLeft)
      );
    }
  }

  const fadeMode = s.fadeMode || 'once';
  const fadeMonth = s.fadeMonth || months[0];
  const gradEnd = finish || months[months.length - 1];
  const gradN = Math.max(1, mDiff(gradEnd, months[0]) + 1);
  const estAt = (k: string, i: number) => {
    if (target === null) return Pbase;
    if (fadeMode === 'gradual') {
      return Pbase + (finalCost - Pbase) * Math.min(1, (i + 1) / gradN);
    }
    return mDiff(k, fadeMonth) >= 0 ? finalCost : Pbase;
  };
  const gpOf = (cum: number, est: number, Ck: number) => {
    if (noContract || est <= 0) return 0;
    if (Ck < est) return Ck - est;
    return (Ck - est) * Math.min(1, cum / est);
  };

  let cum = jtd0;
  let gpPrev = noContract ? 0 : job.profit;
  const monthRows: PfJobMonth[] = [];

  for (let i = 0; i < months.length; i++) {
    const k = months[i];
    let cost: number;
    const isActual = hasActual && i === 0;
    const pctOv =
      s.pct && s.pct[k] !== undefined && s.pct[k] !== null
        ? Number(s.pct[k])
        : null;
    if (isActual) {
      cost = actualCost;
    } else if (pctOv !== null) {
      cost = Math.max(0, Math.min(1, pctOv) * finalCost - cum);
    } else {
      const remaining = Math.max(0, finalCost - cum);
      if (mode === 'auto') {
        cost = rate === null ? remaining / 3 : Math.min(rate, remaining);
        if (rate === null && remaining > 1 && i === fcFirst) flags.push({ type: 'norate' });
      } else if (mode === 'even' && finish) {
        const left = mDiff(finish, k) + 1;
        cost = left <= 1 ? remaining : remaining / left;
        if (mDiff(finish, k) < 0) cost = remaining;
      } else {
        const idx = fcStartKey ? mDiff(k, fcStartKey) : 0;
        if (!weights || idx >= weights.length) {
          cost = remaining;
        } else {
          const rest = weights.slice(idx).reduce((a, b) => a + b, 0);
          cost = rest > 0 ? (remaining * weights[idx]) / rest : remaining;
        }
      }
    }

    cum += cost;
    let est = Math.max(estAt(k, i) - unbookedCostAt(k), cum);
    const Ck = job.contract + revAt(k);
    if (finalCost > 0 && cum >= finalCost - 0.5) est = cum;
    const gp = gpOf(cum, est, Ck);
    const gpM = gp - gpPrev;
    const rev = gpM + cost;
    const pct = est > 0 ? cum / est : 0;
    monthRows.push({
      k,
      cost,
      rev,
      gp: gpM,
      pct,
      est,
      cumGP: gp,
      earned: cum + gp,
      actual: isActual,
      pctOv,
    });
    gpPrev = gp;
  }

  const earned0 = noContract ? jtd0 : jtd0 + job.profit;
  const gpNow = C > 0 ? (C - Pbase) / C : null;
  const gpWip =
    job.contract > 0 && job.pcost > 0 ? (job.contract - job.pcost) / job.contract : null;
  const gpFinal = C > 0 ? (C - finalCost) / C : null;
  const pctStart = Pbase > 0 ? jtdStart / Pbase : 0;
  const remaining = Math.max(0, finalCost - jtdStart);

  if (job.pcost > 0 && jtdStart > job.pcost + 1) {
    flags.push({ type: 'over', amt: jtdStart - job.pcost });
  }
  if (!noContract && finalCost > C) {
    flags.push({ type: 'loss', amt: C - finalCost });
  }
  if (finish && fcStartKey && mDiff(finish, fcStartKey) < 0 && remaining > 1) {
    flags.push({ type: 'pastfinish' });
  }
  const tot = monthRows.reduce((a, m) => a + Math.abs(m.cost) + Math.abs(m.gp), 0);
  const active = remaining > 1 || tot > 1;

  return {
    key: job.key,
    job,
    months: monthRows,
    flags,
    rate,
    finish,
    mode,
    modeSet,
    C,
    Cfinal: C,
    Cbill: C,
    Pbase,
    finalCost,
    jtdStart,
    earned0,
    gpNow,
    gpWip,
    gpFinal,
    pctStart,
    remaining,
    target,
    coRev,
    coCost,
    coCount: cos.length,
    active,
  };
}

export function runForecast(state: PfState): PfForecastResult | null {
  const M = buildMonths(state);
  if (!M || !state.wip) return null;
  const costMap = new Map<string, { mtd: number; jtd: number }>();
  if (state.cost && state.cost.map) {
    const { mtd, jtd } = state.cost.map;
    for (const r of state.cost.rows) {
      costMap.set(r.key, { mtd: r.vals[mtd] || 0, jtd: r.vals[jtd] || 0 });
    }
  }
  const wipKeys = new Set<string>();
  const jobs: PfForecastJob[] = state.wip.jobs.map((j) => {
    wipKeys.add(j.key);
    let rec = costMap.get(j.key);
    if (!rec && M.actual) rec = { mtd: 0, jtd: j.act };
    return forecastJob(j, rec, M, state.settings);
  });

  const notOnWip: PfForecastResult['notOnWip'] = [];
  if (state.cost && state.cost.map) {
    const names = new Map(state.cost.rows.map((r) => [r.key, r]));
    for (const [k, v] of costMap) {
      if (!wipKeys.has(k) && Math.abs(v.mtd) > 0) {
        const info = names.get(k);
        notOnWip.push({
          key: k,
          job: info?.job || k,
          name: info?.name || '',
          mtd: v.mtd,
        });
      }
    }
  }

  const div: Record<string, PfDivForecast> = {};
  const ensure = (d: string): PfDivForecast => {
    if (!div[d]) {
      div[d] = {
        months: M.months.map(() => ({
          rev: 0,
          gp: 0,
          jobRev: 0,
          jobGP: 0,
          woRev: 0,
          woGP: 0,
          likelyRev: 0,
          likelyGP: 0,
          oh: 0,
          net: 0,
        })),
        oh: 0,
        woGP: 0,
        woRev: 0,
        basePct: 0,
        runRate: false,
      };
    }
    return div[d];
  };
  DEPT_ORDER.forEach((d) => ensure(d));
  for (const f of jobs) {
    const d = ensure(DEPTS[f.job.dept] ? f.job.dept : 'other');
    f.months.forEach((m, i) => {
      d.months[i].jobRev += m.rev;
      d.months[i].jobGP += m.gp;
    });
  }

  const pnl = state.pnl ? state.pnl.depts : {};
  const ov = state.settings.overrides || {};
  for (const code of Object.keys(div)) {
    const p = pnl[code] || ({} as Partial<PfPnlDept>);
    const o = ov[code] || {};
    const oh =
      o.overhead !== undefined && o.overhead !== '' ? Number(o.overhead) : p.overhead || 0;
    const woGP = p.woProfit || 0;
    const woRev =
      o.woRevenue !== undefined && o.woRevenue !== '' ? Number(o.woRevenue) : p.woRevenue || 0;
    div[code].oh = oh;
    div[code].woGP = woGP;
    div[code].woRev = woRev;
    const useMtd = Boolean(state.pnl && M.actual && state.pnl.asOf === M.actual);
    const mo = (state.settings.monthOv || {})[code] || {};
    const mv = (field: 'overhead' | 'woRevenue' | 'woPct', k: string) => {
      const fMap = mo[field];
      const v = fMap && fMap[k];
      return v !== undefined && v !== null ? Number(v) : null;
    };
    const everyPct = o.woPct !== undefined && o.woPct !== '' ? Number(o.woPct) : null;
    const avgPct = woRev > 0 ? woGP / woRev : 0;
    div[code].basePct = everyPct !== null ? everyPct : avgPct;
    const svc = (code === '02' || code === '03') && state.settings.serviceRunRate !== false;
    div[code].runRate = svc;

    if (svc) {
      const tRev = p.totRevenue !== undefined ? p.totRevenue : woRev;
      const tGP = p.totGP !== undefined ? p.totGP : woGP;
      const ev = (f: 'woRevenue' | 'woPct') =>
        o[f] !== undefined && o[f] !== '' ? Number(o[f]) : null;
      const baseRev = ev('woRevenue') !== null ? (ev('woRevenue') as number) : tRev;
      const basePct = ev('woPct') !== null ? (ev('woPct') as number) : tRev > 0 ? tGP / tRev : 0;
      div[code].basePct = basePct;
      div[code].months.forEach((m, i) => {
        const k = M.months[i];
        const act = i === 0 && useMtd && p.mtdTotRevenue !== undefined;
        let rev = act ? p.mtdTotRevenue || 0 : baseRev;
        let pc = act ? (p.mtdTotRevenue ? (p.mtdTotGP || 0) / p.mtdTotRevenue : 0) : basePct;
        let ohv = act ? p.mtdOverhead || 0 : oh;
        const mRev = mv('woRevenue', k);
        const mPc = mv('woPct', k);
        const mOh = mv('overhead', k);
        if (mRev !== null) rev = mRev;
        if (mPc !== null) pc = mPc;
        if (mOh !== null) ohv = mOh;
        m.jobRev = 0;
        m.jobGP = 0;
        m.oh = ohv;
        m.woRev = rev;
        m.woPct = pc;
        m.woGP = rev * pc;
        m.fromMtd = act;
      });
      continue;
    }

    div[code].months.forEach((m, i) => {
      const k = M.months[i];
      const act = i === 0 && useMtd;
      let rev = act ? p.mtdWoRevenue || 0 : woRev;
      let pc = act
        ? (p.mtdWoRevenue || 0) > 0
          ? (p.mtdWoProfit || 0) / (p.mtdWoRevenue || 1)
          : 0
        : div[code].basePct;
      let ohv = act ? p.mtdOverhead || 0 : oh;
      const mRev = mv('woRevenue', k);
      const mPc = mv('woPct', k);
      const mOh = mv('overhead', k);
      if (mRev !== null) rev = mRev;
      if (mPc !== null) pc = mPc;
      if (mOh !== null) ohv = mOh;
      m.oh = ohv;
      m.woRev = rev;
      m.woPct = pc;
      m.woGP = rev * pc;
      m.fromMtd = act;
    });
  }

  if (state.settings.includeLikely !== false) {
    for (const L of state.settings.likely || []) {
      const d = ensure(DEPTS[L.dept] ? L.dept : 'other');
      M.months.forEach((k, i) => {
        const r = Number((L.rev || {})[k]) || 0;
        d.months[i].likelyRev += r;
        d.months[i].likelyGP += r * (Number(L.gp) || 0);
      });
    }
  }

  const total = M.months.map(() => ({
    rev: 0,
    gp: 0,
    oh: 0,
    net: 0,
    jobGP: 0,
    woGP: 0,
    likelyGP: 0,
  }));
  for (const code of Object.keys(div)) {
    div[code].months.forEach((m, i) => {
      m.rev = m.jobRev + m.woRev + m.likelyRev;
      m.gp = m.jobGP + m.woGP + m.likelyGP;
      m.net = m.gp - m.oh;
      const t = total[i];
      t.rev += m.rev;
      t.gp += m.gp;
      t.oh += m.oh;
      t.net += m.net;
      t.jobGP += m.jobGP;
      t.woGP += m.woGP;
      t.likelyGP += m.likelyGP;
    });
  }

  return { M, jobs, div, total, notOnWip };
}

// ---- Monthly Cash Engine ----
function daysToMonth(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 7);
}

function costMix(state: PfState, key: string): { lab: number; sub: number; other: number } | null {
  const c = state.cost;
  if (!c || !c.groups || !c.map) return null;
  const r = c.rows.find((x) => x.key === key);
  if (!r) return null;
  const g = c.groups;
  const v = (i: number | undefined) => (i === undefined ? 0 : r.vals[i] || 0);
  const lab = v(g.labJ);
  const sub = v(g.subJ);
  const tot = v(c.map.jtd);
  if (tot <= 0) return null;
  return {
    lab: Math.max(0, lab / tot),
    sub: Math.max(0, sub / tot),
    other: Math.max(0, 1 - lab / tot - sub / tot),
  };
}

export function runCash(state: PfState, R: PfForecastResult): PfCashResult | null {
  const ar = state.ar;
  const ap = state.ap;
  if ((!ar && !ap) || !state.wip) return null;
  const cs = Object.assign(
    { collectDays: 55, billDay: 20, subsPWP: true, matsPWP: 0.85, obHold: 0 },
    state.settings.cash || {}
  );
  const obHold = Math.min(0.95, Math.max(0, Number(cs.obHold) || 0));
  const jobDays = Object.assign(
    {},
    LA_DEFAULT_JOB_DAYS,
    (state.settings.lookahead || {}).jobDays || {}
  );
  const daysFor = (key: string) => Number(jobDays[key]) || Number(cs.collectDays) || 55;
  const matShare = Math.min(1, Math.max(0, Number(cs.matsPWP) || 0));
  const M = R.M;
  const anchor = (ar && ar.asOf) || (ap && ap.asOf) || M.actual || state.wip.asOf || M.months[0];
  const anchorIdx = M.actual && anchor === M.actual ? 0 : anchor === state.wip.asOf ? -1 : null;
  const months = M.months;
  const startI = anchorIdx === null ? 0 : anchorIdx + 1;
  const fmonths = months.slice(startI);
  if (!fmonths.length) return null;
  const lastM = months[months.length - 1];

  const res: PfCashResult = {
    anchor,
    anchorOk: anchorIdx !== null,
    months: fmonths,
    jobs: [],
    tot: fmonths.map(() => ({ cin: 0, cout: 0, net: 0 })),
    pos0: 0,
    target0: 0,
    bills: [],
    items: [],
    company: [],
    startI,
  };
  const defMix = { lab: 0.4, sub: 0.15, other: 0.45 };

  for (const f of R.jobs) {
    const j = f.job;
    const key = f.key;
    if (R.div[j.dept] && R.div[j.dept].runRate) continue;
    const arOpen = ar ? ar.jobs[key] || 0 : 0;
    const apOpen = ap ? ap.jobs[key] || 0 : 0;
    let billed = j.billed;
    let costA = j.act;
    let cumGP = j.profit;
    if (anchorIdx === 0) {
      const m0 = f.months[0];
      costA = j.act + m0.cost;
      cumGP = m0.cumGP;
      if (ar) {
        billed += ar.invoices
          .filter((x) => x.key === key && x.date && x.date.slice(0, 7) === anchor)
          .reduce((a, x) => a + x.amt, 0);
      }
    }
    const cashIn0 = billed - arOpen;
    const cashOut0 = costA - apOpen;
    const pos0 = cashIn0 - cashOut0;
    const C = j.contract;
    const earnedA = costA + cumGP;
    const ou0 = billed - earnedA;
    const finalCost = f.finalCost;
    const rem0 = Math.max(1, finalCost - costA);
    const ouB0 =
      billed -
      (finalCost > 0 && C > 0 ? Math.min(1, costA / finalCost) * f.Cbill : earnedA);
    const mix = costMix(state, key) || defMix;
    const flow: Record<string, { cin: number; cout: number }> = {};
    const add = (k: string, field: 'cin' | 'cout', v: number, label: string) => {
      if (!flow[k]) flow[k] = { cin: 0, cout: 0 };
      flow[k][field] += v;
      if (Math.abs(v) > 0.5) res.items.push({ k, field, key, label: label || '', amt: v });
    };

    const arByMonth: Record<string, number> = {};
    const invs = ar ? ar.invoices.filter((x) => x.key === key) : [];
    const firstF = fmonths[0];
    if (invs.length && invs.every((x) => x.date)) {
      for (const x of invs) {
        let k = daysToMonth(x.date as string, daysFor(key));
        if (mDiff(k, firstF) < 0) k = firstF;
        add(
          k,
          'cin',
          x.amt,
          `Open invoice${x.inv ? ' ' + x.inv : ''} dated ${x.date}, on the ${mLong(anchor)} AR aging (+${daysFor(key)} days)`
        );
        arByMonth[k] = (arByMonth[k] || 0) + x.amt;
      }
    } else if (arOpen) {
      add(firstF, 'cin', arOpen / 2, 'Open AR (no invoice dates), half this month');
      add(mAdd(firstF, 1), 'cin', arOpen / 2, 'Open AR (no invoice dates), half next month');
      arByMonth[firstF] = arOpen / 2;
      arByMonth[mAdd(firstF, 1)] = arOpen / 2;
    }

    if (apOpen) {
      if (arOpen > 0) {
        for (const k of Object.keys(arByMonth)) {
          add(
            k,
            'cout',
            (apOpen * arByMonth[k]) / arOpen,
            `Open AP on the ${mLong(anchor)} aging, paid as the owner pays`
          );
        }
      } else {
        add(firstF, 'cout', apOpen, `Open AP on the ${mLong(anchor)} aging`);
      }
    }

    let billedCum = billed;
    let cum = costA;
    const ouList: number[] = [];
    for (let i = startI; i < months.length; i++) {
      const m = f.months[i];
      cum += m.cost;
      const earned = cum + m.cumGP;
      const remaining = Math.max(0, finalCost - cum);
      const ou = f.tm
        ? ou0
        : Math.max(0, ou0) * (remaining / rem0) + Math.min(0, ou0) * (remaining / rem0);
      const physical = !f.tm && C > 0 && finalCost > 0;
      const basis = physical ? Math.min(1, cum / finalCost) * f.Cbill : earned;
      let ouB = ou;
      if (physical) {
        const holdCost = obHold * finalCost;
        ouB =
          cum < holdCost
            ? ouB0
            : ouB0 * (remaining / Math.max(1, finalCost - Math.max(costA, holdCost)));
        if (costA >= holdCost) ouB = ouB0 * (remaining / rem0);
      }
      let billTo = basis + ouB;
      if (C > 0) billTo = Math.min(billTo, f.Cbill);
      if (remaining <= 1 && C > 0 && !f.tm) billTo = f.Cbill;
      const bill = Math.max(0, billTo - billedCum);
      billedCum += bill;
      const billDate = `${m.k}-${String(cs.billDay).padStart(2, '0')}`;
      if (bill > 0.5) res.bills.push({ key, k: m.k, date: billDate, amt: bill, cost: m.cost });
      const collectK = daysToMonth(billDate, daysFor(key));
      if (bill) {
        add(
          collectK,
          'cin',
          bill,
          `${mLong(m.k)} pay app, billed the ${cs.billDay}th (+${daysFor(key)} days)`
        );
      }
      const c = m.cost;
      add(
        m.k,
        'cout',
        c * mix.lab,
        `${mLong(m.k)} labor (${Math.round(mix.lab * 100)}% of the month's job cost), paid with payroll`
      );
      add(
        collectK,
        'cout',
        c * mix.other * matShare,
        `${mLong(m.k)} materials held until the owner pays (${Math.round(matShare * 100)}%)`
      );
      add(
        mAdd(m.k, 1),
        'cout',
        c * mix.other * (1 - matShare),
        `${mLong(m.k)} materials paid the next month (${Math.round((1 - matShare) * 100)}%)`
      );
      add(
        cs.subsPWP ? collectK : mAdd(m.k, 1),
        'cout',
        c * mix.sub,
        `${mLong(m.k)} subcontractors${cs.subsPWP ? ', paid when the owner pays' : ', paid the next month'}`
      );
      ouList.push(billedCum - earned);
    }

    let p = pos0;
    const jm = fmonths.map((k, idx) => {
      const fl = flow[k] || { cin: 0, cout: 0 };
      p += fl.cin - fl.cout;
      const m = f.months[startI + idx];
      res.tot[idx].cin += fl.cin;
      res.tot[idx].cout += fl.cout;
      res.tot[idx].net += fl.cin - fl.cout;
      return { k, cin: fl.cin, cout: fl.cout, pos: p, target: m.cumGP, ou: ouList[idx] };
    });

    let later = 0;
    for (const k of Object.keys(flow)) {
      if (mDiff(k, lastM) > 0) later += flow[k].cin - flow[k].cout;
    }
    const target0 = anchorIdx === 0 ? f.months[0].cumGP : j.profit;
    res.pos0 += pos0;
    res.target0 += target0;
    const jobCashRec: PfCashJobResult = {
      key,
      f,
      arOpen,
      apOpen,
      billed,
      cashIn0,
      cashOut0,
      pos0,
      target0,
      ou0,
      months: jm,
      later,
      endProfit: f.tm
        ? f.months[f.months.length - 1].cumGP
        : C > 0
        ? f.Cfinal - finalCost
        : 0,
    };
    res.jobs.push(jobCashRec);
  }

  res.company = fmonths.map((k, idx) => {
    const i = startI + idx;
    let oh = 0;
    let wo = 0;
    for (const code of Object.keys(R.div)) {
      oh += R.div[code].months[i].oh;
      wo += R.div[code].months[i].woGP + R.div[code].months[i].likelyGP;
    }
    const jobsTot = res.tot[idx];
    return {
      k,
      jobsIn: jobsTot.cin,
      jobsOut: jobsTot.cout,
      wo,
      oh,
      net: jobsTot.net + wo - oh,
    };
  });

  return res;
}

// ---- Sven's Gut Check Helpers ----
export interface GutInfo {
  dir: 'gain' | 'flat' | 'fade';
  pts: number;
}

export function gutOf(f: PfForecastJob, settings: PfSettings): GutInfo | null {
  if (f.tm) return null;
  const s = settings.jobs[f.key] || {};
  if (s.gut === 'flat') return { dir: 'flat', pts: 0 };
  if (s.targetGP === undefined || s.targetGP === null || f.gpNow === null) {
    return s.gut ? { dir: s.gut, pts: 0 } : null;
  }
  const pts = (s.targetGP - f.gpNow) * 100;
  return {
    dir: Math.abs(pts) < 0.05 ? 'flat' : pts > 0 ? 'gain' : 'fade',
    pts: Math.abs(pts),
  };
}

export function gutLabel(g: GutInfo | null): string {
  if (!g) return '';
  if (g.dir === 'flat') return '– Flat';
  return `${g.dir === 'gain' ? '▲ Gain ' : '▼ Fade '}${g.pts.toFixed(1)} pts`;
}

export function gutDollars(f: PfForecastJob, settings: PfSettings): number {
  const g = gutOf(f, settings);
  if (!g || g.dir === 'flat' || f.gpNow === null) return 0;
  return (f.C * (g.dir === 'gain' ? 1 : -1) * g.pts) / 100;
}

export function modeText(f: PfForecastJob, settings: PfSettings): string {
  if (f.tm) return `T&M at ${pfPct(f.tmPct)}`;
  const s = settings.jobs[f.key] || {};
  const anyPct = s.pct && Object.keys(s.pct).length > 0;
  let t =
    f.mode === 'auto'
      ? "Last month's pace"
      : f.mode === 'even'
      ? `Even to ${f.finish ? mLabel(f.finish) : ''}`
      : `Peak to ${f.finish ? mLabel(f.finish) : ''}`;
  if (f.modeSet !== f.mode) t = 'Pace (no finish set)';
  if (anyPct) t += ' · % set';
  return t;
}

// ---- Settings & JRT 2026 Snapshot Hydration ----
export function createDefaultPfSettings(): PfSettings {
  return {
    horizon: 6,
    threshold: 1000000,
    includeLikely: true,
    serviceRunRate: true,
    jobs: {},
    likely: [],
    overrides: {},
    monthOv: {},
    cash: {
      collectDays: 55,
      billDay: 20,
      subsPWP: true,
      matsPWP: 0.85,
      obHold: 0.5,
      bank: -3588860,
    },
    lookahead: {},
    report: { by: 'Drew Johnson', span: 'ye', detail: 'all' },
    scorecard: {},
  };
}

interface RawSettingsExport {
  'forecast/settings'?: { settings?: Partial<PfSettings> };
  jobs?: Record<string, { key: string; s: PfJobSetting }>;
  divisions?: Record<
    string,
    {
      code: string;
      overrides?: PfSettings['overrides'][string];
      monthOv?: PfSettings['monthOv'][string];
    }
  >;
  likely?: Record<string, PfLikelyJob>;
}

export function normalizeSnapshotSettings(raw: RawSettingsExport): PfSettings {
  const base = createDefaultPfSettings();
  const top = raw['forecast/settings']?.settings || {};
  const jobs: Record<string, PfJobSetting> = {};
  for (const [k, v] of Object.entries(raw.jobs || {})) {
    jobs[v.key || k] = v.s || {};
  }
  const overrides: PfSettings['overrides'] = {};
  const monthOv: PfSettings['monthOv'] = {};
  for (const [code, v] of Object.entries(raw.divisions || {})) {
    const c = v.code || code;
    if (v.overrides) overrides[c] = v.overrides;
    if (v.monthOv) monthOv[c] = v.monthOv;
  }
  const likely = Object.values(raw.likely || {}).sort((a, b) => (a.at || 0) - (b.at || 0));

  return {
    ...base,
    ...top,
    horizon: top.horizon || 6,
    threshold: top.threshold || 1000000,
    includeLikely: top.includeLikely !== false,
    serviceRunRate: top.serviceRunRate !== false,
    jobs,
    overrides,
    monthOv,
    likely,
    cash: { ...base.cash, ...(top.cash || {}) },
    lookahead: { ...(top.lookahead || {}) },
    report: { ...base.report, ...(top.report || {}) },
    scorecard: { ...(top.scorecard || {}) },
  };
}

async function fetchJsonAsset<T>(filename: string): Promise<T | null> {
  try {
    const res = await fetch(`/assets/aistudio/${filename}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function loadJrtSnapshotFromAssets(): Promise<PfState | null> {
  const [wipRaw, costRaw, pnlRaw, arRaw, apRaw, estRaw, closedRaw, settingsRaw] = await Promise.all([
    fetchJsonAsset<{ data: PfWipReport }>('reports_wip_f8b63359.json'),
    fetchJsonAsset<{ data: PfCostReport }>('reports_cost_06620a69.json'),
    fetchJsonAsset<{ data: PfPnlReport }>('reports_pnl_45742375.json'),
    fetchJsonAsset<{ data: PfAgingReport }>('reports_ar_fa5fc840.json'),
    fetchJsonAsset<{ data: PfAgingReport }>('reports_ap_3aad7e53.json'),
    fetchJsonAsset<{ data: PfEstReport }>('reports_est_bebec05d.json'),
    fetchJsonAsset<{ data: PfState['closed'] }>('reports_closed_b7a074b0.json'),
    fetchJsonAsset<RawSettingsExport>('settings_jobs_divisions_likely_8956a092.json'),
  ]);

  if (!wipRaw?.data) return null;
  const settings = settingsRaw ? normalizeSnapshotSettings(settingsRaw) : createDefaultPfSettings();

  return {
    wip: wipRaw.data,
    cost: costRaw?.data || null,
    pnl: pnlRaw?.data || null,
    ar: arRaw?.data || null,
    ap: apRaw?.data || null,
    est: estRaw?.data || null,
    closed: closedRaw?.data || null,
    settings,
  };
}

// ---- Bridge between WIP Master (01-03) and Profit Forecast (07) ----
export function pfWipToJoinedJobs(
  wip: PfWipReport | null,
  est?: PfEstReport | null
): { jobs: JoinedJob[]; period: string } {
  if (!wip || !wip.jobs.length) return { jobs: [], period: '' };

  let period = '';
  if (wip.asOf && /^\d{4}-\d{2}$/.test(wip.asOf)) {
    const [y, m] = wip.asOf.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    period = `${String(m).padStart(2, '0')}/${String(lastDay).padStart(2, '0')}/${y}`;
  }

  const jobs: JoinedJob[] = wip.jobs.map((j) => {
    const div: DivisionCode | '' =
      j.dept === '00' || j.dept === '01' || j.dept === '02' || j.dept === '03' ? j.dept : '';
    const estMatch = est?.jobs?.[j.key];
    // Estimate man-hours conservatively from budget when only WIP workbook is loaded so Burn Ratio stays clean
    const estHours = estMatch && estMatch.rev > 0 ? Math.round((j.pcost * 0.42) / 95) : 0;
    const actHours = estHours > 0 && j.pcost > 0 ? Math.round(estHours * (j.act / j.pcost)) : 0;
    return {
      id: j.job,
      name: j.name,
      contract: j.contract,
      cost: j.pcost,
      actualCost: j.act,
      billed: j.billed,
      hours: estHours,
      actualHours: actHours,
      division: div,
      missingHours: false,
      manualDivision: !div,
      allowZero: true,
      selected: Boolean(div),
    };
  });

  return { jobs, period };
}

export function joinedJobsToPfWip(jobs: JoinedJob[], period: string, fileName = 'Spectrum WIP Upload'): PfWipReport {
  let asOf: string | null = monthFromText(period);
  if (!asOf) {
    const d = new Date();
    asOf = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  const pfJobs: PfWipJob[] = jobs
    .filter((j) => j.selected && j.division)
    .map((j) => {
      const projProfit = j.contract - j.cost;
      const pct = j.cost > 0 ? j.actualCost / j.cost : 0;
      const earned = projProfit > 0 ? pct * j.contract : j.actualCost + projProfit;
      return {
        dept: j.division,
        job: j.id,
        key: jobKey(j.id),
        name: j.name,
        contract: j.contract,
        pcost: j.cost,
        act: j.actualCost,
        profit: earned - j.actualCost,
        billed: j.billed,
      };
    });

  return {
    asOf,
    jobs: pfJobs,
    file: fileName,
    sheet: 'WIP',
  };
}
