import type {
  PfClosedJob,
  PfScorecardSettings,
  PfState,
} from '../types/profitForecast';
import { runForecast } from './profitForecastEngine';

export const CL_GROUPS: Record<'est' | 'pm' | 'cust' | 'div', string> = {
  est: 'Estimator',
  pm: 'Project manager',
  cust: 'Customer',
  div: 'Division',
};

export const CL_COST: Array<[string, string]> = [
  ['lab', 'Labor, burden & fringe'],
  ['mat', 'Material'],
  ['sub', 'Subs'],
  ['trv', 'Travel (meals, per diem, hotels, fuel)'],
  ['rnt', 'Rentals & equipment'],
  ['tmp', 'Temp labor'],
  ['oth', 'Tools, permits & other'],
];

export const DIVN: Record<string, string> = {
  '00': 'BG Projects',
  '01': 'TC Projects',
  '02': 'BG Service',
  '03': 'TC Service',
};

export function scIn(state: PfState): PfScorecardSettings {
  return Object.assign(
    {
      names: {},
      band: 1,
      filter: 'all' as const,
      who: '',
      st: '',
      clYears: 'all',
      clDiv: 'all',
      clBy: 'est' as const,
      clWho: '',
      clSt: '',
    },
    state.settings.scorecard || {}
  );
}

export interface ScoreJobItem {
  k: string;
  job: string;
  name: string;
  div: string;
  est: string;
  pm: string;
  rev: number;
  done: number | null;
  estP: number;
  projP: number;
  pts: number;
  chg: number;
  st: 'beat' | 'on' | 'slip';
  fromApp: boolean;
}

export interface ScoreRollRow {
  code: string;
  n: number;
  beat: number;
  on: number;
  slip: number;
  rev: number;
  estGP: number;
  chg: number;
}

export interface ScorecardResult {
  S: PfScorecardSettings;
  jobs: ScoreJobItem[];
  all: number;
  byEst: ScoreRollRow[];
  byPm: ScoreRollRow[];
  tot: {
    n: number;
    beat: number;
    on: number;
    slip: number;
    beat$: number;
    slip$: number;
    chg: number;
  };
}

export function buildScore(state: PfState): ScorecardResult {
  const S = scIn(state);
  const E = state.est && state.est.jobs ? state.est.jobs : {};
  const fc: Record<string, number> = {};
  if (state.wip) {
    try {
      const R = runForecast(state);
      if (R) {
        for (const f of R.jobs) {
          if (!f.tm && f.C > 0) fc[f.job.key] = (f.C - f.finalCost) / f.C;
        }
      }
    } catch {
      // ignore
    }
  }

  const jobs: ScoreJobItem[] = [];
  for (const [k, x] of Object.entries(E)) {
    if (!(x.rev > 0 && x.pEst > 0 && x.pEst < 95)) continue;
    const estP = x.pEst / 100;
    const fromApp = fc[k] !== undefined;
    const projP = fromApp ? fc[k] : x.pProj / 100;
    const pts = (projP - estP) * 100;
    const chg = (projP - estP) * x.rev;
    const st: 'beat' | 'on' | 'slip' =
      pts > S.band ? 'beat' : pts < -S.band ? 'slip' : 'on';
    jobs.push({
      k,
      job: x.job,
      name: x.name.replace(/^\*/, ''),
      div: x.div,
      est: x.est || '',
      pm: x.pm || '',
      rev: x.rev,
      done: x.pct,
      estP,
      projP,
      pts,
      chg,
      st,
      fromApp,
    });
  }

  const keep = (j: ScoreJobItem) =>
    S.filter === 'half'
      ? (j.done || 0) >= 50
      : S.filter === 'done'
      ? (j.done || 0) >= 95
      : true;
  const J = jobs.filter(keep);

  const roll = (field: 'est' | 'pm'): ScoreRollRow[] => {
    const m: Record<string, ScoreRollRow> = {};
    for (const j of J) {
      const c = j[field] || '(none)';
      if (!m[c]) {
        m[c] = { code: c, n: 0, beat: 0, on: 0, slip: 0, rev: 0, estGP: 0, chg: 0 };
      }
      const r = m[c];
      r.n++;
      r[j.st]++;
      r.rev += j.rev;
      r.estGP += j.estP * j.rev;
      r.chg += j.chg;
    }
    return Object.values(m).sort((a, b) => a.chg - b.chg);
  };

  const tot = { n: J.length, beat: 0, on: 0, slip: 0, beat$: 0, slip$: 0, chg: 0 };
  for (const j of J) {
    tot[j.st]++;
    tot.chg += j.chg;
    if (j.st === 'beat') tot.beat$ += j.chg;
    if (j.st === 'slip') tot.slip$ += j.chg;
  }

  return {
    S,
    jobs: J,
    all: jobs.length,
    byEst: roll('est'),
    byPm: roll('pm'),
    tot,
  };
}

function clc(j: PfClosedJob, k: string, i: number): number {
  return ((j.c || {})[k] || [0, 0])[i] || 0;
}

function clYear(j: PfClosedJob): number | null {
  const m = /(\d{4})$/.exec(j.done || '');
  return m ? +m[1] : null;
}

export interface ClosedJobAnalyzed extends PfClosedJob {
  estP: number;
  actP: number;
  vs: number;
  st: 'beat' | 'on' | 'slip';
  yr: number | null;
}

export interface ClosedRollRow {
  code: string;
  n: number;
  rev: number;
  ec: number;
  ac: number;
  beat: number;
  on: number;
  slip: number;
  loss: number;
  h: number;
  he: number;
  trv: number;
  tre: number;
  vs: number;
}

export interface ClosedTrackResult {
  J: ClosedJobAnalyzed[];
  rows: ClosedRollRow[];
  tot: Omit<ClosedRollRow, 'code'>;
  cost: Array<{ k: string; l: string; a: number; e: number }>;
  all: number;
}

export function buildClosed(state: PfState, S: PfScorecardSettings): ClosedTrackResult {
  const C = state.closed && state.closed.jobs ? state.closed.jobs : [];
  const ok = C.filter(
    (j) =>
      j.rev >= 25000 &&
      j.ec > 0 &&
      j.ac >= 0.3 * j.ec &&
      j.ec / j.rev > 0.3 &&
      j.ec / j.rev < 1.25
  );
  const yr = S.clYears === 'all' ? 0 : +S.clYears;
  const J: ClosedJobAnalyzed[] = ok
    .filter(
      (j) =>
        (!yr || (clYear(j) || 0) >= yr) && (S.clDiv === 'all' || j.div === S.clDiv)
    )
    .map((j) => {
      const estP = (j.rev - j.ec) / j.rev;
      const actP = (j.rev - j.ac) / j.rev;
      const d = actP - estP;
      return {
        ...j,
        estP,
        actP,
        vs: j.ec - j.ac,
        st: d * 100 > S.band ? 'beat' : d * 100 < -S.band ? 'slip' : 'on',
        yr: clYear(j),
      };
    });

  const roll = (g: ClosedJobAnalyzed[]) => {
    const r = {
      n: g.length,
      rev: 0,
      ec: 0,
      ac: 0,
      beat: 0,
      on: 0,
      slip: 0,
      loss: 0,
      h: 0,
      he: 0,
      trv: 0,
      tre: 0,
      vs: 0,
    };
    for (const j of g) {
      r.rev += j.rev;
      r.ec += j.ec;
      r.ac += j.ac;
      r[j.st]++;
      if (j.actP < 0) r.loss++;
      r.h += j.hrs[0];
      r.he += j.hrs[1];
      r.trv += clc(j, 'trv', 0);
      r.tre += clc(j, 'trv', 1);
    }
    r.vs = r.ec - r.ac;
    return r;
  };

  const keyFn = (j: ClosedJobAnalyzed) =>
    S.clBy === 'div' ? DIVN[j.div] || j.div : j[S.clBy] || '(none)';
  const m: Record<string, ClosedJobAnalyzed[]> = {};
  for (const j of J) {
    const k = keyFn(j);
    if (!m[k]) m[k] = [];
    m[k].push(j);
  }
  const rows: ClosedRollRow[] = Object.entries(m)
    .map(([k, g]) => ({ code: k, ...roll(g) }))
    .sort((a, b) => a.vs - b.vs);
  const cost = CL_COST.map(([k, l]) => ({
    k,
    l,
    a: J.reduce((s, j) => s + clc(j, k, 0), 0),
    e: J.reduce((s, j) => s + clc(j, k, 1), 0),
  }));

  return { J, rows, tot: roll(J), cost, all: ok.length };
}
