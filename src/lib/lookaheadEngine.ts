import type {
  PfLookaheadResult,
  PfLookaheadSettings,
  PfState,
  PfWcSettings,
} from '../types/profitForecast';
import {
  DEPTS,
  mAdd,
  mDiff,
  mLabel,
  mLong,
  pfMoney,
  runCash,
  runForecast,
  sumRow,
  jobKey,
} from './profitForecastEngine';

export const LA_DEFAULTS: PfLookaheadSettings = {
  start: '2026-11-16',
  line0: 3768244,
  weeks: 28,
  limit: 4500000,
  cushion: 350000,
  rate: 0.07,
  schedInThru: '2026-12-28',
  schedOutThru: '2026-12-14',
  schedIn: {
    '2026-11-16': 803912,
    '2026-11-23': 2272975,
    '2026-11-30': 1028842,
    '2026-12-07': 713309,
    '2026-12-14': 1589339,
    '2026-12-21': 620548,
    '2026-12-28': 307337,
  },
  schedOut: {
    '2026-11-16': 825917,
    '2026-11-23': 1547198,
    '2026-11-30': 186510,
    '2026-12-07': 326167,
    '2026-12-14': 213190,
  },
  payroll: 506000,
  baseHours: 3742,
  fixedGross: 182093,
  fieldRate: 54.76,
  health: 120000,
  hours: {
    '2026-11-09': 3742,
    '2026-11-16': 3820,
    '2026-11-23': 3510,
    '2026-11-30': 3607,
    '2026-12-07': 3630,
    '2026-12-14': 3659,
    '2026-12-21': 3679,
    '2026-12-28': 3748,
    '2027-01-04': 4136,
    '2027-01-11': 4213,
    '2027-01-18': 3760,
    '2027-01-25': 3640,
    '2027-02-01': 3343,
    '2027-02-08': 3662,
    '2027-02-15': 3528,
    '2027-02-22': 3388,
    '2027-03-01': 3410,
    '2027-03-08': 3329,
    '2027-03-15': 3169,
    '2027-03-22': 3242,
    '2027-03-29': 3401,
    '2027-04-05': 3321,
    '2027-04-12': 3601,
    '2027-04-19': 3879,
    '2027-04-26': 3752,
    '2027-05-03': 3618,
    '2027-05-10': 3538,
  },
  days: 45,
  jobDays: { '1595': 80, '1540': 15 },
  pwp: 0.4,
  matsLater: 0.07,
  likelyNonLabor: 0.53,
  svcDays: 30,
  lanae: 50000,
  usbank: 15000,
  comdata: 110000,
  dor: 38000,
  auto: 41700,
  draws: 10000,
  quarterly: 256500,
  q1: '2027-01-29',
  q2: '2027-04-30',
  match: 120000,
  matchDate: '2027-05-14',
  retention: [
    { name: 'Westwood PDX6 (112905)', amt: 22332, date: '2027-01-20' },
    { name: 'Trend Capital TI (01597)', amt: 59578, date: '2027-02-05' },
    { name: 'Cairnspring (01587)', amt: 40163, date: '2027-02-19' },
  ],
  oneOff: [{ name: 'WA DOR (due the 25th)', amt: 38000, date: '2026-11-25' }],
};

export const LA_IN: Array<[string, string]> = [
  ['sched', 'Collections scheduled on the weekly cash sheet'],
  ['jobs', 'Contract job collections (forecast)'],
  ['svc', 'Service and work order collections'],
  ['likely', 'New jobs (Piping Rock and other likely jobs)'],
  ['ret', 'Retention released'],
];

export const LA_OUT: Array<[string, string]> = [
  ['pay', 'Payroll, payroll taxes and 401k'],
  ['health', 'Health insurance claims'],
  ['sched', 'Vendor payments scheduled on the weekly cash sheet'],
  ['pwp', 'Job vendors and subs, paid when the owner pays'],
  ['mats', 'Materials paid the month after (not held)'],
  ['lanae', 'Non-job check run (Lanae)'],
  ['cards', 'US Bank cards'],
  ['fuel', 'Comdata fuel'],
  ['tax', 'WA DOR and quarterly payroll taxes'],
  ['loans', 'Truck loans'],
  ['interest', 'Line of credit interest'],
  ['draws', 'Owner draws'],
  ['other', 'One-time items (401k match, etc.)'],
];

export const WC_DEFAULTS: PfWcSettings = {
  asOf: '2026-09',
  ca: 13995554,
  cl: 16092338,
  locAsOf: 3254985,
  limit: 4500000,
  renew: '2027-04',
  rate: 0.07,
  dep: 74558,
  principal: 37632,
  draws: 0,
  cushion: 350000,
  slowDays: 10,
  pwpShare: 0.46,
  histInterest: 16058,
  vehBal: 877105,
  vehRate: 0.055,
  capAmt: 0,
  capMonth: '2027-01',
  thru: '2027-07',
  contDesc: '',
  contAmt: 0,
  knownM1: '2026-11',
  knownV1: 4316291,
  knownM2: '2026-12',
  knownV2: 3982333,
};

export const RDIVS = [
  { id: 'bgp', name: 'BG Projects', codes: ['00'] },
  { id: 'tc', name: 'TC Projects & Service', codes: ['01', '03'] },
  { id: 'bgs', name: 'BG Service', codes: ['02'] },
];

export const COMPANY_NAME = 'JRT Mechanical, Inc.';

export const PNL_DA_FALLBACK: Record<
  string,
  Record<string, { depAvg: number; depYtd: number; intAvg: number; intYtd: number }>
> = {
  '2026-09': {
    '00': { depAvg: 42216.79, depYtd: 379951.1, intAvg: 8488.91, intYtd: 76400.21 },
    '01': { depAvg: 22273.08, depYtd: 200457.73, intAvg: 5341.34, intYtd: 48072.07 },
    '02': { depAvg: 7703.49, depYtd: 69331.38, intAvg: 1818.95, intYtd: 16370.59 },
    '03': { depAvg: 2363.86, depYtd: 21274.77, intAvg: 408.74, intYtd: 3678.65 },
  },
};

export function dIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function dAdd(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return dIso(d);
}

export function monOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return dIso(d);
}

export function dShort(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}/${d}`;
}

export function monthEnd(k: string): string {
  const [y, m] = k.split('-').map(Number);
  return dIso(new Date(Date.UTC(y, m, 0, 12)));
}

export function daOf(state: PfState, code: string) {
  const d = (state.pnl && state.pnl.depts && state.pnl.depts[code]) || null;
  if (d && d.depAvg !== undefined) {
    return {
      depAvg: d.depAvg || 0,
      depYtd: d.depYtd || 0,
      intAvg: d.intAvg || 0,
      intYtd: d.intYtd || 0,
    };
  }
  const fb = (state.pnl?.asOf && PNL_DA_FALLBACK[state.pnl.asOf]) || {};
  return fb[code] || { depAvg: 0, depYtd: 0, intAvg: 0, intYtd: 0 };
}

export function laIn(state: PfState): PfLookaheadSettings {
  const s = state.settings.lookahead || {};
  const o: PfLookaheadSettings = Object.assign({}, LA_DEFAULTS, s, {
    schedIn: Object.assign({}, LA_DEFAULTS.schedIn, s.schedIn || {}),
    schedOut: Object.assign({}, LA_DEFAULTS.schedOut, s.schedOut || {}),
    hours: Object.assign({}, LA_DEFAULTS.hours, s.hours || {}),
    jobDays: Object.assign({}, LA_DEFAULTS.jobDays, s.jobDays || {}),
    retention: s.retention ? s.retention.map((x) => ({ ...x })) : LA_DEFAULTS.retention.map((x) => ({ ...x })),
    oneOff: s.oneOff ? s.oneOff.map((x) => ({ ...x })) : LA_DEFAULTS.oneOff.map((x) => ({ ...x })),
  });
  if (s.days === undefined) {
    const cd = Number((state.settings.cash || {}).collectDays);
    if (cd) o.days = cd;
  }
  return o;
}

export function wcIn(state: PfState): PfWcSettings {
  const rs = state.settings.report || {};
  const w: PfWcSettings = Object.assign({}, WC_DEFAULTS, rs.wc || {});
  if (w.lineStart === undefined || w.lineStart === null) {
    const b = (state.settings.cash || {}).bank;
    w.lineStart = typeof b === 'number' && b < 0 ? -b : null;
  }
  const numKeys: Array<keyof PfWcSettings> = [
    'ca',
    'cl',
    'locAsOf',
    'limit',
    'rate',
    'dep',
    'principal',
    'draws',
    'cushion',
    'slowDays',
    'pwpShare',
    'histInterest',
    'vehBal',
    'vehRate',
    'capAmt',
    'contAmt',
    'knownV1',
    'knownV2',
  ];
  for (const k of numKeys) {
    const raw = w[k];
    if (raw !== undefined && raw !== null && String(raw) !== '') {
      (w as unknown as Record<string, number>)[k] = Number(raw);
    }
  }
  if (w.lineStart !== undefined && w.lineStart !== null) {
    w.lineStart = Number(w.lineStart);
  }
  return w;
}

export interface ReportMonthVal {
  rev: number;
  cost: number;
  gp: number;
  oh: number;
  net: number;
  ebitda: number;
}

export interface ReportJobLine {
  kind: 'job' | 'line';
  small?: boolean;
  key?: string;
  job?: string;
  name: string;
  names?: string[];
  contract?: number | null;
  tm?: boolean;
  done?: number | null;
  vals: Array<{ rev: number; gp: number; cost: number }>;
  estP?: number | null;
  projP?: number | null;
  estRev?: number;
  projC?: number;
}

export interface ReportDivision {
  id: string;
  name: string;
  codes: string[];
  months: ReportMonthVal[];
  lines: ReportJobLine[];
  ytd: ReportMonthVal;
  backlog: { rev: number; gp: number; jobs: number };
}

export interface BuiltReport {
  RR: NonNullable<ReturnType<typeof runForecast>>;
  M: string[];
  n: number;
  divs: ReportDivision[];
  co: {
    name: string;
    months: ReportMonthVal[];
    ytd: ReportMonthVal;
    backlog: { rev: number; gp: number; jobs: number };
  };
  hasYtd: boolean;
  pm: string | null;
  yr: string;
  yeIdx: number[];
  ye: (d: { ytd: ReportMonthVal; months: ReportMonthVal[] }, f: keyof ReportMonthVal) => number;
  yeComplete: boolean;
  ny: string;
  nyIdx: number[];
  y2: (d: { months: ReportMonthVal[] }, f: keyof ReportMonthVal) => number;
  actual: string | null;
  span: string;
}

export function buildReport(state: PfState, forceH?: number): BuiltReport | null {
  const span = state.settings.report?.span || 'ye';
  const R1 = runForecast({
    ...state,
    settings: { ...state.settings, horizon: 1 },
  });
  if (!R1) return null;
  const first = R1.M.months[0];
  let h = 6;
  if (forceH) h = forceH;
  else if (span === 'ye') h = Math.max(1, mDiff(`${first.slice(0, 4)}-12`, first) + (R1.M.actual ? 0 : 1));
  else h = +span || 6;

  const RR = runForecast({
    ...state,
    settings: { ...state.settings, horizon: h },
  });
  if (!RR) return null;

  const M = RR.M.months;
  const n = M.length;
  const P = state.pnl ? state.pnl.depts : {};
  const pm = state.pnl && state.pnl.asOf ? state.pnl.asOf : null;
  const yr = pm ? pm.slice(0, 4) : first.slice(0, 4);
  const yeIdx = M.map((k, i) => ((!pm || k > pm) && k <= `${yr}-12` ? i : -1)).filter((i) => i >= 0);
  const hasYtd =
    Boolean(pm) &&
    Object.values(P).some((d) => d && d.ytdRevenue !== undefined && d.ytdRevenue !== null);

  const zero = (): ReportMonthVal[] =>
    M.map(() => ({ rev: 0, cost: 0, gp: 0, oh: 0, net: 0, ebitda: 0 }));

  const divs: ReportDivision[] = RDIVS.map((D) => ({
    id: D.id,
    name: D.name,
    codes: D.codes,
    months: zero(),
    lines: [],
    ytd: { rev: 0, cost: 0, gp: 0, oh: 0, net: 0, ebitda: 0 },
    backlog: { rev: 0, gp: 0, jobs: 0 },
  }));

  const known = new Set(RDIVS.flatMap((D) => D.codes));
  const unknownCodes = Object.keys(RR.div).filter(
    (c) => !known.has(c) && RR.div[c].months.some((m) => Math.abs(m.rev) > 1 || Math.abs(m.oh) > 1)
  );
  if (unknownCodes.length) {
    divs.push({
      id: 'oth',
      name: 'Other',
      codes: unknownCodes,
      months: zero(),
      lines: [],
      ytd: { rev: 0, cost: 0, gp: 0, oh: 0, net: 0, ebitda: 0 },
      backlog: { rev: 0, gp: 0, jobs: 0 },
    });
  }

  const divOf = (code: string) => divs.find((d) => d.codes.includes(code)) || null;

  for (const d of divs) {
    for (const c of d.codes) {
      const x = RR.div[c];
      if (!x) continue;
      const da = daOf(state, c);
      x.months.forEach((m, i) => {
        const t = d.months[i];
        t.rev += m.rev;
        t.gp += m.gp;
        t.cost += m.rev - m.gp;
        t.oh += m.oh;
        t.net += m.net;
        t.ebitda += m.net + (da.depAvg || 0) + (da.intAvg || 0);
      });
      const y = P[c];
      if (y) {
        d.ytd.rev += y.ytdRevenue || 0;
        d.ytd.gp += y.ytdGP || 0;
        d.ytd.oh += y.ytdOverhead || 0;
        const yNet =
          y.ytdNet !== null && y.ytdNet !== undefined ? y.ytdNet : (y.ytdGP || 0) - (y.ytdOverhead || 0);
        d.ytd.net += yNet;
        d.ytd.ebitda += yNet + (da.depYtd || 0) + (da.intYtd || 0);
      }
    }
    d.ytd.cost = d.ytd.rev - d.ytd.gp;
  }

  for (const f of RR.jobs) {
    const code = f.job.dept;
    const d = divOf(DEPTS[code] ? code : 'other');
    if (!d) continue;
    if (RR.div[code] && RR.div[code].runRate) continue;
    const vals = f.months.map((m) => ({ rev: m.rev, gp: m.gp, cost: m.rev - m.gp }));
    if (!vals.some((v) => Math.abs(v.rev) > 0.5 || Math.abs(v.cost) > 0.5)) continue;
    const ex = state.est && state.est.jobs ? state.est.jobs[f.job.key] : null;
    const estP = ex && ex.rev > 0 && ex.pEst > 0 && ex.pEst < 95 ? ex.pEst / 100 : null;
    const projP = !f.tm && f.C > 0 ? (f.C - f.finalCost) / f.C : null;
    d.lines.push({
      kind: 'job',
      key: f.job.key,
      job: f.job.job,
      name: f.job.name,
      contract: f.tm ? null : f.job.contract,
      tm: Boolean(f.tm),
      done: f.tm ? null : f.pctStart,
      vals,
      estP,
      projP,
      estRev: ex ? ex.rev : 0,
      projC: f.C || 0,
    });
    if (!f.tm && f.job.contract > 0) {
      const left = Math.max(0, f.job.contract - (f.earned0 || 0));
      if (left > 1) {
        const fLeft = Math.max(1, f.C - (f.earned0 || 0));
        const gpLeft = f.C - f.finalCost - ((f.earned0 || 0) - (f.job.act || 0));
        d.backlog.rev += left;
        d.backlog.gp += gpLeft * Math.min(1, left / fLeft);
        d.backlog.jobs++;
      }
    }
  }

  for (const d of divs) {
    const small = d.lines.filter(
      (L) =>
        L.kind === 'job' &&
        Math.abs(sumRow(L.vals.map((v) => v.rev))) < 10000 &&
        Math.abs(sumRow(L.vals.map((v) => v.gp))) < 10000 &&
        L.vals.every((v) => Math.abs(v.rev) < 10000 && Math.abs(v.gp) < 10000)
    );
    if (small.length > 1) {
      d.lines = d.lines.filter((L) => !small.includes(L));
      d.lines.push({
        kind: 'line',
        small: true,
        name: `Smaller and completed jobs (${small.length})`,
        names: small.map((L) => `${L.job || ''} ${L.name}`),
        vals: M.map((_, i) => ({
          rev: sumRow(small.map((L) => L.vals[i].rev)),
          gp: sumRow(small.map((L) => L.vals[i].gp)),
          cost: sumRow(small.map((L) => L.vals[i].cost)),
        })),
      });
    }
    d.lines.sort(
      (a, b) =>
        (a.small ? 1 : 0) - (b.small ? 1 : 0) ||
        sumRow(b.vals.map((v) => v.rev)) - sumRow(a.vals.map((v) => v.rev))
    );
    for (const c of d.codes) {
      const x = RR.div[c];
      if (!x) continue;
      const lab = DEPTS[c] || 'Other';
      const wo = x.months.map((m) => ({
        rev: m.woRev || 0,
        gp: m.woGP || 0,
        cost: (m.woRev || 0) - (m.woGP || 0),
      }));
      if (wo.some((v) => Math.abs(v.rev) > 0.5)) {
        d.lines.push({
          kind: 'line',
          name: x.runRate ? `${lab} work (monthly run rate)` : `${lab} work orders`,
          vals: wo,
        });
      }
      const lk = x.months.map((m) => ({
        rev: m.likelyRev || 0,
        gp: m.likelyGP || 0,
        cost: (m.likelyRev || 0) - (m.likelyGP || 0),
      }));
      if (lk.some((v) => Math.abs(v.rev) > 0.5)) {
        d.lines.push({
          kind: 'line',
          name: `${lab}: expected new work, not yet on the WIP`,
          vals: lk,
        });
      }
    }
  }

  const co = {
    name: 'Company total',
    months: zero(),
    ytd: { rev: 0, cost: 0, gp: 0, oh: 0, net: 0, ebitda: 0 },
    backlog: { rev: 0, gp: 0, jobs: 0 },
  };
  for (const d of divs) {
    d.months.forEach((m, i) => {
      co.months[i].rev += m.rev;
      co.months[i].cost += m.cost;
      co.months[i].gp += m.gp;
      co.months[i].oh += m.oh;
      co.months[i].net += m.net;
      co.months[i].ebitda += m.ebitda;
    });
    co.ytd.rev += d.ytd.rev;
    co.ytd.cost += d.ytd.cost;
    co.ytd.gp += d.ytd.gp;
    co.ytd.oh += d.ytd.oh;
    co.ytd.net += d.ytd.net;
    co.ytd.ebitda += d.ytd.ebitda;
    co.backlog.rev += d.backlog.rev;
    co.backlog.gp += d.backlog.gp;
    co.backlog.jobs += d.backlog.jobs;
  }

  const ye = (
    d: { ytd: ReportMonthVal; months: ReportMonthVal[] },
    f: keyof ReportMonthVal
  ) => (hasYtd ? d.ytd[f] : 0) + sumRow(yeIdx.map((i) => d.months[i][f]));
  const yeComplete = M.includes(`${yr}-12`);
  const ny = String(+yr + 1);
  const nyIdx = M.map((k, i) => (k.slice(0, 4) === ny ? i : -1)).filter((i) => i >= 0);
  const y2 = (d: { months: ReportMonthVal[] }, f: keyof ReportMonthVal) =>
    sumRow(nyIdx.map((i) => d.months[i][f]));

  return {
    RR,
    M,
    n,
    divs,
    co,
    hasYtd,
    pm,
    yr,
    yeIdx,
    ye,
    yeComplete,
    ny,
    nyIdx,
    y2,
    actual: RR.M.actual,
    span,
  };
}

export function linePath(
  months: string[],
  C: ReturnType<typeof runCash>,
  w: PfWcSettings,
  adj: number
) {
  if (!C || w.lineStart === null || w.lineStart === undefined) return null;
  const coBy: Record<string, (typeof C.company)[number]> = {};
  C.company.forEach((c) => {
    coBy[c.k] = c;
  });
  let line: number | null = null;
  const known = new Set<string>();
  const interest: Record<string, number> = {};
  const vals = months.map((k) => {
    const kv =
      k === w.knownM1 && w.knownV1
        ? w.knownV1
        : k === w.knownM2 && w.knownV2
        ? w.knownV2
        : null;
    if (k === C.anchor) line = kv !== null ? kv : (w.lineStart as number);
    else if (k > C.anchor && line !== null) {
      const c = coBy[k];
      const veh = Math.max(0, w.vehBal - w.principal * Math.max(0, mDiff(k, w.asOf)));
      const intTrue = (Math.max(0, line) * w.rate) / 12 + (veh * w.vehRate) / 12 - w.histInterest;
      interest[k] = intTrue;
      line = kv !== null ? kv : c ? line - (c.net + adj) + intTrue : null;
    }
    if (kv !== null && k >= C.anchor) known.add(k);
    if (line !== null && w.capAmt > 0 && k === w.capMonth) line -= w.capAmt;
    return k >= C.anchor ? line : null;
  });
  return { vals, known, interest };
}

export interface LiquidityRow {
  k: string;
  line: number | null;
  avail: number | null;
  need: number | null;
  lineS: number | null;
  needS: number | null;
  wc: number;
  ou: number | null;
}

export interface LiquidityResult {
  B: BuiltReport;
  w: PfWcSettings;
  rows: LiquidityRow[];
  peak: LiquidityRow | null;
  peakS: LiquidityRow | null;
  need: number;
  needS: number;
  needAt: string | null;
  needAtS: string | null;
  known: Set<string>;
  hasCash: boolean;
  wc0: number;
}

export function buildLiquidity(state: PfState, B0: BuiltReport): LiquidityResult {
  const w = wcIn(state);
  const last = B0.M[B0.M.length - 1];
  const end = w.thru && w.thru > w.renew ? w.thru : w.renew;
  const extra = mDiff(end, last);
  const B =
    extra > 0 ? buildReport(state, B0.M.length - (B0.actual ? 1 : 0) + extra) || B0 : B0;
  const adj = w.dep - w.principal - w.draws;
  let C: ReturnType<typeof runCash> = null;
  try {
    if (state.ar || state.ap) C = runCash(state, B.RR);
  } catch {
    C = null;
  }
  const P = linePath(B.M, C, w, adj);
  let PS: { vals: Array<number | null> } | null = null;
  if (P && C && w.slowDays > 0) {
    const lastKnown = [...P.known].sort().pop() || C.anchor;
    const inBy: Record<string, number> = {};
    C.company.forEach((c) => {
      inBy[c.k] = c.jobsIn;
    });
    const fr = Math.min(1, w.slowDays / 30);
    const costRatio = (k: string) => {
      const i = B.M.indexOf(k);
      const m = B.co.months[i];
      return m && m.rev > 0 ? Math.min(1, m.cost / m.rev) : 0.8;
    };
    const slip = (k: string) =>
      k > lastKnown ? fr * (inBy[k] || 0) * (1 - w.pwpShare * costRatio(k)) : 0;
    PS = { vals: P.vals.map((v, i) => (v === null ? null : v + slip(B.M[i]))) };
  }

  let wc = w.ca - w.cl;
  const need = (v: number | null | undefined) =>
    v === null || v === undefined ? null : Math.max(0, v + w.cushion - w.limit);
  let runMax = 0;
  let runMaxS = 0;
  const rows: LiquidityRow[] = B.M.map((k, i) => {
    if (k > w.asOf) {
      wc +=
        B.co.months[i].net +
        adj -
        (P && P.interest[k] ? P.interest[k] : 0) +
        (w.capAmt > 0 && k === w.capMonth ? w.capAmt : 0);
    }
    const line = P ? P.vals[i] : null;
    const lineS = PS ? PS.vals[i] : null;
    const nVal = need(line);
    const nsVal = need(lineS);
    if (nVal !== null) runMax = Math.max(runMax, nVal);
    if (nsVal !== null) runMaxS = Math.max(runMaxS, nsVal);
    return {
      k,
      line,
      avail: line === null ? null : w.limit - line,
      need: nVal,
      lineS,
      needS: nsVal,
      wc,
      ou: null,
    };
  });

  const withLine = rows.filter((x) => x.line !== null);
  const peak = withLine.reduce<LiquidityRow | null>(
    (a, x) => (!a || (x.line as number) > (a.line as number) ? x : a),
    null
  );
  const peakS = rows
    .filter((x) => x.lineS !== null)
    .reduce<LiquidityRow | null>(
      (a, x) => (!a || (x.lineS as number) > (a.lineS as number) ? x : a),
      null
    );
  const firstNeed = (kind: 'base' | 'stress') => {
    const r = rows.find((x) => ((kind === 'stress' ? x.needS : x.need) || 0) > 0.5);
    return r ? r.k : null;
  };

  const ouBy: Record<string, number> = {};
  if (C) {
    C.months.forEach((k, i) => {
      ouBy[k] = C.jobs.reduce((a, x) => a + (x.months[i] ? x.months[i].ou : 0), 0);
    });
  }
  rows.forEach((r) => {
    r.ou = ouBy[r.k] !== undefined ? ouBy[r.k] : null;
  });

  return {
    B,
    w,
    rows,
    peak,
    peakS,
    need: runMax,
    needS: runMaxS,
    needAt: firstNeed('base'),
    needAtS: firstNeed('stress'),
    known: P ? P.known : new Set(),
    hasCash: Boolean(P),
    wc0: w.ca - w.cl,
  };
}

export function buildReportSheets(state: PfState, B: BuiltReport) {
  const head = [
    '',
    ...(B.hasYtd && B.pm ? [`YTD thru ${mLabel(B.pm)}`] : []),
    ...B.M.map((k, i) => mLabel(k) + (B.actual && i === 0 ? ' (prelim.)' : ' (forecast)')),
    B.yeComplete ? `Year end ${B.yr}` : `Total thru ${mLabel(B.M[B.M.length - 1])}`,
    ...(B.nyIdx.length ? [`${B.ny} YTD thru ${mLabel(B.M[B.nyIdx[B.nyIdx.length - 1]])}`] : []),
  ];
  const S: (string | number)[][] = [
    [COMPANY_NAME],
    ['Profit forecast by division'],
    [
      `Actual through ${B.pm ? mLong(B.pm) : '—'} · forecast ${mLong(B.M[0])} – ${mLong(
        B.M[B.M.length - 1]
      )}`,
    ],
    [],
    head,
  ];
  const r0 = (v: number) => Math.round(v);
  for (const d of [...B.divs, B.co]) {
    S.push([d.name]);
    const spec: Array<[string, keyof ReportMonthVal | 'pct:gp' | 'pct:oh' | 'pct:net']> = [
      ['Revenue', 'rev'],
      ['Cost of revenue', 'cost'],
      ['Gross profit', 'gp'],
      ['Gross margin', 'pct:gp'],
      ['Overhead', 'oh'],
      ['Overhead %', 'pct:oh'],
      ['Net income', 'net'],
      ['Net margin', 'pct:net'],
      ['EBITDA', 'ebitda'],
    ];
    for (const [lab, f] of spec) {
      if (f.startsWith('pct:')) {
        const k = f.slice(4) as keyof ReportMonthVal;
        const q = (nVal: number, rVal: number) => (rVal ? +(nVal / rVal).toFixed(4) : '');
        S.push([
          lab,
          ...(B.hasYtd ? [q(d.ytd[k], d.ytd.rev)] : []),
          ...d.months.map((m) => q(m[k], m.rev)),
          q(B.ye(d, k), B.ye(d, 'rev')),
          ...(B.nyIdx.length ? [q(B.y2(d, k), B.y2(d, 'rev'))] : []),
        ]);
        continue;
      }
      const fk = f as keyof ReportMonthVal;
      const sg = fk === 'oh' ? -1 : 1;
      S.push([
        lab,
        ...(B.hasYtd ? [r0(sg * d.ytd[fk])] : []),
        ...d.months.map((m) => r0(sg * m[fk])),
        r0(sg * B.ye(d, fk)),
        ...(B.nyIdx.length ? [r0(sg * B.y2(d, fk))] : []),
      ]);
    }
    S.push([]);
  }

  const J: (string | number)[][] = [
    [
      'Division',
      'Job',
      'Name',
      'Contract',
      'Complete',
      'Est. GP %',
      'Proj. GP %',
      'Line',
      ...B.M.map(mLabel),
      'Total',
    ],
  ];
  for (const d of B.divs) {
    for (const L of d.lines) {
      for (const [lab, f] of [
        ['Revenue', 'rev'],
        ['Cost', 'cost'],
        ['Profit', 'gp'],
      ] as const) {
        const vals = L.vals.map((v) => r0(v[f]));
        J.push([
          d.name,
          L.job || '',
          L.name,
          L.kind === 'job' ? (L.tm ? 'T&M' : r0(L.contract || 0)) : '',
          L.done !== null && L.done !== undefined ? +L.done.toFixed(3) : '',
          L.estP != null ? +L.estP.toFixed(3) : '',
          L.projP != null ? +L.projP.toFixed(3) : '',
          lab,
          ...vals,
          sumRow(vals),
        ]);
      }
    }
  }
  const Bk: (string | number)[][] = [
    ['Division', 'Jobs', 'Contract left to earn', 'Gross profit to earn'],
    ...[...B.divs, B.co].map((d) => [d.name, d.backlog.jobs, r0(d.backlog.rev), r0(d.backlog.gp)]),
  ];
  const LQ = buildLiquidity(state, B);
  const w = LQ.w;
  const Lq: (string | number)[][] = [
    ['', `${mLabel(w.asOf)} (balance sheet)`, ...LQ.B.M.map(mLabel)],
  ];
  const cell = (v: number | null) => (v === null || v === undefined ? '' : r0(v));
  if (LQ.hasCash) {
    Lq.push([
      'Line of credit balance',
      w.locAsOf,
      ...LQ.rows.map((x) => cell(x.line)),
    ]);
    Lq.push([
      `Available on the line (limit ${w.limit})`,
      w.limit - w.locAsOf,
      ...LQ.rows.map((x) => cell(x.avail)),
    ]);
  }
  Lq.push(['Net overbilled', '', ...LQ.rows.map((x) => cell(x.ou))]);
  Lq.push(['Working capital', LQ.wc0, ...LQ.rows.map((x) => r0(x.wc))]);
  return { Summary: S, Liquidity: Lq, Jobs: J, Backlog: Bk };
}

export function buildLookahead(state: PfState): PfLookaheadResult | null {
  if (!state.wip || !state.wip.asOf) return null;
  const S = laIn(state);
  const W = Array.from({ length: S.weeks }, (_, i) => dAdd(S.start, 7 * i));
  const n = W.length;
  const last = W[n - 1];
  const idx = (iso: string) => {
    const m = monOf(iso);
    if (m < W[0]) return -1;
    const i = Math.round((new Date(m).getTime() - new Date(W[0]).getTime()) / 6048e5);
    return i < n ? i : n;
  };

  const R1 = runForecast({
    ...state,
    settings: { ...state.settings, horizon: 1 },
  });
  if (!R1) return null;
  const endK = dAdd(last, 6).slice(0, 7);
  const h = Math.max(1, mDiff(endK, R1.M.months[0]) + 1);
  const RR = runForecast({
    ...state,
    settings: { ...state.settings, horizon: h },
  });
  if (!RR) return null;

  let C: ReturnType<typeof runCash> = null;
  try {
    if (state.ar || state.ap) C = runCash(state, RR);
  } catch {
    C = null;
  }

  const z = () => new Array<number>(n).fill(0);
  const cin: Record<string, number[]> = {
    sched: z(),
    jobs: z(),
    svc: z(),
    likely: z(),
    ret: z(),
  };
  const cout: Record<string, number[]> = {
    pay: z(),
    health: z(),
    sched: z(),
    pwp: z(),
    mats: z(),
    lanae: z(),
    cards: z(),
    fuel: z(),
    tax: z(),
    loans: z(),
    interest: z(),
    draws: z(),
    other: z(),
  };
  const items: Record<
    string,
    Array<{ i: number; key: string | null; label: string; amt: number }>
  > = {};

  const rec = (tag: string, i: number, v: number, label: string, key?: string | null) => {
    if (Math.abs(v) > 0.5) {
      if (!items[tag]) items[tag] = [];
      items[tag].push({ i, key: key || null, label: label || '', amt: v });
    }
  };
  const setW = (o: number[], tag: string, i: number, v: number, label: string, key?: string | null) => {
    o[i] += v;
    rec(tag, i, v, label, key);
  };
  const put = (o: number[], tag: string, iso: string, v: number, label: string, key?: string | null) => {
    const i = idx(iso);
    if (i >= 0 && i < n) {
      o[i] += v;
      rec(tag, i, v, label, key);
    }
  };
  const SPREAD: Array<[number, number]> = S.spread || [
    [-7, 0.25],
    [0, 0.5],
    [7, 0.25],
  ];
  const putS = (
    o: number[],
    tag: string,
    iso: string,
    v: number,
    onlyAfter: string | null,
    label: string,
    key?: string | null
  ) => {
    for (const [d, w] of SPREAD) {
      const day = dAdd(iso, d);
      if (onlyAfter && monOf(day) <= onlyAfter) continue;
      if (day >= S.start || monOf(day) >= W[0]) {
        put(
          o,
          tag,
          day,
          v * w,
          `${label} (${Math.round(w * 100)}% of ${pfMoney(v)}, expected about ${dShort(iso)})`,
          key
        );
      }
    }
  };

  const daysFor = (key: string) => Number((S.jobDays || {})[key]) || S.days;
  const afterOut = (i: number) => W[i] > S.schedOutThru;
  const afterIn = (i: number) => W[i] > S.schedInThru;
  const hoursOf = (wk: string) => {
    const hrs = S.hours || {};
    if (hrs[wk] !== undefined) return Number(hrs[wk]);
    const ks = Object.keys(hrs)
      .filter((k) => k <= wk)
      .sort();
    return ks.length ? Number(hrs[ks[ks.length - 1]]) : S.baseHours;
  };
  const base = S.fixedGross + S.fieldRate * S.baseHours;

  for (let i = 0; i < n; i++) {
    const hw = dAdd(W[i], -7);
    const hrs = hoursOf(hw);
    setW(
      cout.pay,
      'out:pay',
      i,
      (S.payroll * (S.fixedGross + S.fieldRate * hrs)) / base,
      `Payday ${dShort(dAdd(W[i], 4))}: week of ${dShort(hw)} at ${Math.round(hrs).toLocaleString()} board hours`
    );
    setW(cout.health, 'out:health', i, S.health, `Health claims, week of ${dShort(W[i])}`);
    if (!afterIn(i)) {
      setW(
        cin.sched,
        'in:sched',
        i,
        Number((S.schedIn || {})[W[i]]) || 0,
        `Weekly cash sheet: estimated in from AR, week of ${dShort(W[i])}`
      );
    }
    if (!afterOut(i)) {
      setW(
        cout.sched,
        'out:sched',
        i,
        Number((S.schedOut || {})[W[i]]) || 0,
        `Weekly cash sheet: check runs, week of ${dShort(W[i])}`
      );
    } else {
      setW(cout.lanae, 'out:lanae', i, S.lanae, `Lanae's check run, week of ${dShort(W[i])}`);
      setW(cout.cards, 'out:cards', i, S.usbank, `US Bank, week of ${dShort(W[i])}`);
    }
  }

  if (state.ar) {
    for (const x of state.ar.invoices || []) {
      if (!x.date) continue;
      const exp = dAdd(x.date, daysFor(x.key));
      putS(
        cin.jobs,
        'in:jobs',
        exp,
        x.amt,
        S.schedInThru,
        `Open invoice${x.inv ? ' ' + x.inv : ''} dated ${dShort(x.date)} (+${daysFor(x.key)} days)`,
        x.key
      );
    }
  }

  if (C) {
    for (const b of C.bills) {
      const exp = dAdd(b.date, daysFor(b.key));
      if (b.date >= dAdd(S.start, -31)) {
        putS(
          cin.jobs,
          'in:jobs',
          exp,
          b.amt,
          null,
          `${mLong(b.k)} pay app (+${daysFor(b.key)} days)`,
          b.key
        );
      }
    }
  }

  RR.M.months.forEach((k, j) => {
    if (k < S.start.slice(0, 7)) return;
    let rev = 0;
    for (const code of Object.keys(RR.div)) rev += RR.div[code].months[j].woRev || 0;
    if (k === S.start.slice(0, 7)) {
      const dm = +monthEnd(k).slice(8);
      rev *= Math.max(0, dm - +S.start.slice(8) + 1) / dm;
    }
    putS(
      cin.svc,
      'in:svc',
      dAdd(monthEnd(k), S.svcDays),
      rev,
      null,
      `${mLong(k)} service and work order revenue (+${S.svcDays} days after month end)`
    );
  });

  if (state.settings.includeLikely !== false) {
    for (const L of state.settings.likely || []) {
      for (const [k, v] of Object.entries(L.rev || {})) {
        const r = Number(v) || 0;
        if (!r) continue;
        const lk = jobKey((String(L.name || '').match(/^\s*(\d{4,6})/) || [])[1] || '');
        const exp = dAdd(`${k}-20`, (lk && Number((S.jobDays || {})[lk])) || S.days);
        if (exp < S.start) continue;
        putS(cin.likely, 'in:likely', exp, r, null, `${L.name}: ${mLong(k)} billing`, lk || L.name);
        putS(
          cout.pwp,
          'out:pwp',
          exp,
          r * (1 - (Number(L.gp) || 0)) * S.likelyNonLabor,
          null,
          `${L.name}: vendors on the ${mLong(k)} billing`,
          lk || L.name
        );
      }
    }
  }

  for (const r of S.retention || []) {
    if (r.date && r.amt) put(cin.ret, 'in:ret', r.date, Number(r.amt), `Retention: ${r.name}`);
  }

  for (let i = 0; i < n; i++) {
    if (afterOut(i)) {
      setW(
        cout.pwp,
        'out:pwp',
        i,
        S.pwp * (cin.jobs[i] + cin.sched[i]),
        `${Math.round(S.pwp * 100)}% of ${pfMoney(cin.jobs[i] + cin.sched[i])} collected on jobs, week of ${dShort(W[i])}`
      );
    }
  }

  RR.M.months.forEach((k, j) => {
    const due = `${mAdd(k, 1)}-15`;
    if (monOf(due) <= S.schedOutThru || due < S.start) return;
    let cost = 0;
    for (const f of RR.jobs) {
      const d = RR.div[f.job.dept];
      if (d && d.runRate) continue;
      cost += f.months[j].cost || 0;
    }
    put(
      cout.mats,
      'out:mats',
      due,
      cost * S.matsLater,
      `${mLong(k)} job cost ${pfMoney(cost)} × ${(S.matsLater * 100).toFixed(1)}%`
    );
  });

  const months: string[] = [];
  for (let k = S.start.slice(0, 7); k <= last.slice(0, 7); k = mAdd(k, 1)) months.push(k);
  for (const k of months) {
    const on = (day: number, o: number[], tag: string, v: number, label: string) => {
      const iso = `${k}-${String(day).padStart(2, '0')}`;
      if (iso >= S.start && monOf(iso) > S.schedOutThru) {
        put(o, tag, iso, v, `${label}, ${dShort(iso)}`);
      }
    };
    on(5, cout.fuel, 'out:fuel', S.comdata, 'Comdata');
    on(25, cout.tax, 'out:tax', S.dor, 'WA DOR');
    on(1, cout.loans, 'out:loans', S.auto / 2, 'Truck loans (half)');
    on(15, cout.loans, 'out:loans', S.auto / 2, 'Truck loans (half)');
    on(1, cout.draws, 'out:draws', S.draws, 'Owner draws');
  }

  for (const q of [S.q1, S.q2]) {
    if (q) put(cout.tax, 'out:tax', q, S.quarterly, `Quarterly payroll taxes due ${dShort(q)}`);
  }
  if (S.matchDate) put(cout.other, 'out:other', S.matchDate, S.match, '401k match (office)');
  for (const o of S.oneOff || []) {
    if (o.date && o.amt) put(cout.other, 'out:other', o.date, Number(o.amt), o.name || 'One-time payment');
  }

  let bal = S.line0;
  const line: number[] = [];
  const tin: number[] = [];
  const tout: number[] = [];
  for (let i = 0; i < n; i++) {
    cout.interest[i] = (Math.max(0, bal) * S.rate) / 52;
    rec(
      'out:interest',
      i,
      cout.interest[i],
      `${(S.rate * 100).toFixed(1)}% on ${pfMoney(bal)} for the week of ${dShort(W[i])}`
    );
    const a = Object.values(cin).reduce((s, o) => s + o[i], 0);
    const b = Object.values(cout).reduce((s, o) => s + o[i], 0);
    bal = bal + b - a;
    line.push(bal);
    tin.push(a);
    tout.push(b);
  }

  const mOf = (i: number) => dAdd(W[i], 4).slice(0, 7);
  const mlist = [...new Set(W.map((_, i) => mOf(i)))];
  const sumM = (o: number[], k: string) =>
    W.reduce((s, _, i) => s + (mOf(i) === k ? o[i] : 0), 0);
  const M = mlist.map((k) => {
    const ii = W.map((_, i) => i).filter((i) => mOf(i) === k);
    const hi = ii.reduce((a, i) => (line[i] > line[a] ? i : a), ii[0]);
    return {
      k,
      ii,
      end: line[ii[ii.length - 1]],
      high: line[hi],
      highWk: W[hi],
      partial: k === mlist[0] && S.start.slice(8) > '07',
    };
  });

  const peak = line.reduce((a, v, i) => (v > line[a] ? i : a), 0);
  const need = Math.max(0, line[peak] + S.cushion - S.limit);

  const ouBy: Record<string, number> = {};
  if (C) {
    C.months.forEach((k, i) => {
      ouBy[k] = C.jobs.reduce((a, x) => a + (x.months[i] ? x.months[i].ou : 0), 0);
    });
  }
  const wcBy: Record<string, number> = {};
  try {
    const B = buildReport(state, h);
    if (B) {
      const L = buildLiquidity(state, B);
      L.rows.forEach((r) => {
        wcBy[r.k] = r.wc;
      });
    }
  } catch {
    // ignore
  }

  return {
    S,
    W,
    n,
    cin,
    cout,
    line,
    tin,
    tout,
    M,
    peak,
    need,
    sumM,
    ouBy,
    wcBy,
    items,
    mOf,
    hasModel: Boolean(C),
  };
}

export function laSrc(S: PfLookaheadSettings, billDay = 20): Record<string, string> {
  const jd = Object.entries(S.jobDays || {})
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  return {
    'in:sched': `Copied from the cash sheet's "Estimated in from AR", weeks through ${dShort(S.schedInThru)}.`,
    'in:jobs': `Open 10/31 invoices not already on the cash sheet, plus each month's pay app (Sven's % complete × contract, plus billed-ahead backing off), billed the ${billDay}th and collected ${S.days} days later on average${jd ? ` (${jd})` : ''}.`,
    'in:svc': `Service and work order run rate from the Overhead and service section, collected ${S.svcDays} days after month end.`,
    'in:likely': "Likely jobs' monthly revenue (Likely jobs section), billed the 20th.",
    'in:ret': 'The retention releases and dates listed in the drivers.',
    'out:pay': `Cash sheet payroll + taxes + 401k (${pfMoney(S.payroll)} a week at ${S.baseHours.toLocaleString()} board hours), moved up or down with manpower board hours. Paid Fridays for the week before.`,
    'out:health': `${pfMoney(S.health)} a week.`,
    'out:sched': `Copied from the cash sheet's check runs, weeks through ${dShort(S.schedOutThru)}.`,
    'out:pwp': `After ${dShort(S.schedOutThru)}: ${Math.round(S.pwp * 100)}% of every job collection goes back out to that job's vendors and subs (materials and subs paid when paid).`,
    'out:mats': `Materials not held: ${(S.matsLater * 100).toFixed(1)}% of each month's job cost, paid the 15th of the next month.`,
    'out:lanae': `${pfMoney(S.lanae)} a week, after ${dShort(S.schedOutThru)}.`,
    'out:cards': `${pfMoney(S.usbank)} a week, after ${dShort(S.schedOutThru)}.`,
    'out:fuel': `${pfMoney(S.comdata)} on the 5th of each month.`,
    'out:tax': `WA DOR ${pfMoney(S.dor)} on the 25th; quarterly payroll taxes ${pfMoney(S.quarterly)}.`,
    'out:loans': `${pfMoney(S.auto)} a month (principal + interest).`,
    'out:interest': `${(S.rate * 100).toFixed(1)}% on the line balance each week.`,
    'out:draws': `${pfMoney(S.draws)} a month.`,
    'out:other': '401k match and other one-time items in the drivers.',
  };
}
