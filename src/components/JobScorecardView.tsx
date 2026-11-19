import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { fmtMoney, fmtMoney2, fmtPct } from '../lib/formatters';
import { pfMoney } from '../lib/profitForecastEngine';
import {
  CL_GROUPS,
  DIVN,
  type ClosedTrackResult,
  type ScorecardResult,
} from '../lib/scorecardEngine';
import { DIVISIONS } from '../lib/wipEngine';
import type { PfScorecardSettings, PfState } from '../types/profitForecast';
import type {
  DivisionCode,
  ForecastOverride,
  HealthTier,
  JobScorecardRow,
} from '../types/wip';

interface JobScorecardViewProps {
  rows: JobScorecardRow[];
  period: string;
  onUpdateNote: (jobId: string, patch: Partial<ForecastOverride>) => void;
  pfState?: PfState | null;
  scoreResult?: ScorecardResult | null;
  closedResult?: ClosedTrackResult | null;
  onUpdateScorecard?: (patch: Partial<PfScorecardSettings>) => void;
  onOpenJob?: (key: string) => void;
}

export const JobScorecardView: React.FC<JobScorecardViewProps> = ({
  rows,
  period,
  onUpdateNote,
  pfState,
  scoreResult,
  closedResult,
  onUpdateScorecard,
  onOpenJob,
}) => {
  const hasEst = Boolean(pfState?.est?.jobs && scoreResult);
  const hasClosed = Boolean(pfState?.closed?.jobs && closedResult);
  const [subView, setSubView] = useState<'active-est' | 'closed' | 'wip-tiers'>(
    hasEst ? 'active-est' : 'wip-tiers'
  );
  const [showNamesEditor, setShowNamesEditor] = useState(false);

  const [tierFilter, setTierFilter] = useState<'all' | HealthTier>('all');
  const [divisionFilter, setDivisionFilter] = useState('');
  const [search, setSearch] = useState('');

  const activeListRef = useRef<HTMLDivElement | null>(null);
  const closedListRef = useRef<HTMLDivElement | null>(null);

  const counts = useMemo(
    () => ({
      Strong: rows.filter((r) => r.healthTier === 'Strong').length,
      Watch: rows.filter((r) => r.healthTier === 'Watch').length,
      'Action Required': rows.filter((r) => r.healthTier === 'Action Required').length,
      'Loss Job': rows.filter((r) => r.healthTier === 'Loss Job').length,
    }),
    [rows]
  );

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const okTier = tierFilter === 'all' || r.healthTier === tierFilter;
      const okDiv = !divisionFilter || r.job.division === divisionFilter;
      const okQ = !q || `${r.job.id} ${r.job.name}`.toLowerCase().includes(q);
      return okTier && okDiv && okQ;
    });
  }, [rows, tierFilter, divisionFilter, search]);

  const S = scoreResult?.S;
  const codeName = (c: string) => {
    if (!c || c === '(none)') return <span className="text-slate-400">not set</span>;
    const mapped = S?.names?.[c];
    return mapped ? (
      <span>
        {mapped} <span className="text-[11px] font-mono text-slate-400">{c}</span>
      </span>
    ) : (
      <span className="font-mono">{c}</span>
    );
  };

  const p1 = (v: number) => `${(v * 100).toFixed(1)}%`;
  const signedVal = (v: number, fn: (n: number) => string) => (
    <span className={v > 0.5 ? 'text-emerald-700' : v < -0.5 ? 'text-red-700' : ''}>
      {v > 0.5 ? '+' : ''}
      {fn(v)}
    </span>
  );

  const allSpectrumCodes = useMemo(() => {
    const s = new Set<string>();
    scoreResult?.jobs.forEach((j) => {
      if (j.est) s.add(j.est);
      if (j.pm) s.add(j.pm);
    });
    pfState?.closed?.jobs.forEach((j) => {
      if (j.est) s.add(j.est);
      if (j.pm) s.add(j.pm);
    });
    return [...s].sort();
  }, [scoreResult, pfState?.closed]);

  const renderStatusBadge = (st: 'beat' | 'on' | 'slip') => {
    if (st === 'beat') {
      return <span className="text-xs font-semibold text-emerald-700">Beat</span>;
    }
    if (st === 'slip') {
      return <span className="text-xs font-semibold text-red-700">Slipped</span>;
    }
    return <span className="text-xs font-medium text-slate-600">On target</span>;
  };

  const renderActiveEstimateView = () => {
    if (!scoreResult || !S) return null;
    const T = scoreResult.tot;
    const whoParts = S.who ? S.who.split(':') : null;
    const filteredList = scoreResult.jobs
      .filter(
        (j) =>
          (!whoParts ||
            (whoParts[0] === 'E' ? j.est || '(none)' : j.pm || '(none)') === whoParts[1]) &&
          (!S.st || j.st === S.st)
      )
      .sort((a, b) => a.chg - b.chg);

    const renderRollupTable = (title: string, rollRows: ScorecardResult['byEst']) => (
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-slate-100 text-slate-700">
              <tr className="border-b border-slate-200">
                <th className="px-2.5 py-2 font-semibold">{title}</th>
                <th className="px-2.5 py-2 text-right font-semibold">Jobs</th>
                <th className="px-2.5 py-2 text-right font-semibold">Beat</th>
                <th className="px-2.5 py-2 text-right font-semibold">On</th>
                <th className="px-2.5 py-2 text-right font-semibold">Slip</th>
                <th className="px-2.5 py-2 text-right font-semibold">Est. GP%</th>
                <th className="px-2.5 py-2 text-right font-semibold">Proj. GP%</th>
                <th className="px-2.5 py-2 text-right font-semibold">vs Est.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rollRows.map((r) => {
                const whoKey = `${title[0]}:${r.code}`;
                const selected = S.who === whoKey;
                return (
                  <tr
                    key={r.code}
                    onClick={() =>
                      onUpdateScorecard?.({
                        who: selected ? '' : whoKey,
                        st: '',
                      })
                    }
                    className={`cursor-pointer hover:bg-slate-50 ${
                      selected ? 'bg-slate-100 font-semibold' : ''
                    }`}
                  >
                    <td className="px-2.5 py-2">{codeName(r.code)}</td>
                    <td className="px-2.5 py-2 text-right font-mono tabular-nums">{r.n}</td>
                    {(['beat', 'on', 'slip'] as const).map((stKey) => (
                      <td
                        key={stKey}
                        onClick={(e) => {
                          if (!r[stKey]) return;
                          e.stopPropagation();
                          onUpdateScorecard?.({ who: whoKey, st: stKey });
                          activeListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }}
                        className={`px-2.5 py-2 text-right font-mono tabular-nums ${
                          stKey === 'beat'
                            ? 'text-emerald-700'
                            : stKey === 'slip'
                            ? 'text-red-700'
                            : 'text-slate-600'
                        } ${r[stKey] ? 'underline decoration-dotted' : ''}`}
                      >
                        {r[stKey] || ''}
                      </td>
                    ))}
                    <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                      {r.rev ? p1(r.estGP / r.rev) : '—'}
                    </td>
                    <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                      {r.rev ? p1((r.estGP + r.chg) / r.rev) : '—'}
                    </td>
                    <td className="px-2.5 py-2 text-right font-mono font-medium tabular-nums">
                      {signedVal(r.chg, pfMoney)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );

    return (
      <div className="space-y-6">
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white px-5 py-3.5 text-xs">
          <label className="flex items-center gap-2 font-medium text-slate-700">
            <span>Jobs</span>
            <select
              value={S.filter}
              onChange={(e) =>
                onUpdateScorecard?.({ filter: e.target.value as PfScorecardSettings['filter'] })
              }
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
            >
              <option value="all">All active jobs</option>
              <option value="half">Over half done</option>
              <option value="done">95%+ done</option>
            </select>
          </label>

          <label className="flex items-center gap-2 font-medium text-slate-700">
            <span>On target within</span>
            <input
              type="number"
              step="0.5"
              min="0"
              value={S.band}
              onChange={(e) =>
                onUpdateScorecard?.({ band: Math.max(0, Number(e.target.value) || 0) })
              }
              className="w-16 rounded-lg border border-slate-300 bg-white px-2 py-1 text-right font-mono text-xs tabular-nums"
            />
            <span>points</span>
          </label>

          <span className="text-slate-500">
            Est. = Spectrum estimate with CO budgets ({pfState?.est?.asOf || ''}). Proj. = Profit
            Forecast final projection (including Sven&apos;s calls). ·S = Spectrum projection.
          </span>
        </div>

        {/* 4 Interactive KPI Cards */}
        <div className="grid grid-cols-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white lg:grid-cols-4 lg:divide-x lg:divide-y-0">
          <button
            type="button"
            onClick={() =>
              onUpdateScorecard?.({ st: S.st === 'beat' ? '' : 'beat', who: '' })
            }
            className={`p-4 text-left transition-colors ${
              S.st === 'beat' ? 'bg-emerald-50/60' : 'hover:bg-slate-50'
            }`}
          >
            <div className="text-xs font-medium text-slate-500">Beat the estimate</div>
            <div className="mt-1.5 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
              {T.beat}
            </div>
            <div className="mt-1 text-xs text-slate-500 tabular-nums">
              {signedVal(T.beat$, pfMoney)} more profit than bid
            </div>
          </button>

          <button
            type="button"
            onClick={() => onUpdateScorecard?.({ st: S.st === 'on' ? '' : 'on', who: '' })}
            className={`p-4 text-left transition-colors ${
              S.st === 'on' ? 'bg-slate-100' : 'hover:bg-slate-50'
            }`}
          >
            <div className="text-xs font-medium text-slate-500">On target</div>
            <div className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {T.on}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              within {S.band} pt of estimate
            </div>
          </button>

          <button
            type="button"
            onClick={() =>
              onUpdateScorecard?.({ st: S.st === 'slip' ? '' : 'slip', who: '' })
            }
            className={`p-4 text-left transition-colors ${
              S.st === 'slip' ? 'bg-red-50/70' : 'hover:bg-slate-50'
            }`}
          >
            <div className="text-xs font-medium text-slate-500">Slipped</div>
            <div className="mt-1.5 font-mono text-2xl font-semibold text-red-700 tabular-nums">
              {T.slip}
            </div>
            <div className="mt-1 text-xs text-slate-500 tabular-nums">
              {signedVal(T.slip$, pfMoney)} less profit than bid
            </div>
          </button>

          <div className="p-4">
            <div className="text-xs font-medium text-slate-500">Net vs estimate</div>
            <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums">
              {signedVal(T.chg, pfMoney)}
            </div>
            <div className="mt-1 text-xs text-slate-500 tabular-nums">{T.n} jobs compared</div>
          </div>
        </div>

        {/* Estimator & PM Rollups */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {renderRollupTable('Estimator', scoreResult.byEst)}
          {renderRollupTable('Project manager', scoreResult.byPm)}
        </div>

        {/* Active Jobs Estimate Comparison Table */}
        <div ref={activeListRef} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">
              {whoParts || S.st
                ? `${
                    S.st
                      ? {
                          beat: 'Jobs that beat the estimate',
                          on: 'Jobs on target',
                          slip: 'Jobs that slipped',
                        }[S.st]
                      : 'Jobs'
                  }${whoParts ? ` for ${S.names[whoParts[1]] || whoParts[1]}` : ''} (${
                    filteredList.length
                  })`
                : 'Every active job vs. estimate (biggest slip first)'}
            </h3>
            {(whoParts || S.st) && (
              <button
                type="button"
                onClick={() => onUpdateScorecard?.({ who: '', st: '' })}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Show all jobs
              </button>
            )}
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-[460px]">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-slate-100 text-slate-700">
                <tr className="border-b border-slate-200">
                  <th className="px-2.5 py-2.5 font-semibold">Job</th>
                  <th className="px-2.5 py-2.5 font-semibold">Name</th>
                  <th className="px-2.5 py-2.5 font-semibold">Div</th>
                  <th className="px-2.5 py-2.5 font-semibold">Estimator</th>
                  <th className="px-2.5 py-2.5 font-semibold">PM</th>
                  <th className="px-2.5 py-2.5 text-right font-semibold">Contract</th>
                  <th className="px-2.5 py-2.5 text-right font-semibold">% done</th>
                  <th className="px-2.5 py-2.5 text-right font-semibold">Est. GP%</th>
                  <th className="px-2.5 py-2.5 text-right font-semibold">Proj. GP%</th>
                  <th className="px-2.5 py-2.5 text-right font-semibold">Points</th>
                  <th className="px-2.5 py-2.5 text-right font-semibold">Profit vs est.</th>
                  <th className="px-2.5 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredList.map((j) => (
                  <tr
                    key={j.k}
                    onClick={() => j.fromApp && onOpenJob?.(j.k)}
                    className={j.fromApp && onOpenJob ? 'cursor-pointer hover:bg-slate-50' : ''}
                  >
                    <td className="px-2.5 py-2 font-mono font-semibold text-slate-900 tabular-nums">
                      {j.job}
                    </td>
                    <td className="px-2.5 py-2 text-slate-800 max-w-[200px] truncate">
                      {j.name}
                      {!j.fromApp && (
                        <span
                          className="ml-1 text-[11px] text-slate-400"
                          title="Not on the WIP; projection is Spectrum's"
                        >
                          ·S
                        </span>
                      )}
                    </td>
                    <td className="px-2.5 py-2 font-mono text-slate-600">{j.div}</td>
                    <td className="px-2.5 py-2">{codeName(j.est)}</td>
                    <td className="px-2.5 py-2">{codeName(j.pm)}</td>
                    <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                      {pfMoney(j.rev)}
                    </td>
                    <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                      {j.done == null ? '' : `${Math.round(j.done)}%`}
                    </td>
                    <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                      {p1(j.estP)}
                    </td>
                    <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                      {p1(j.projP)}
                    </td>
                    <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                      {signedVal(j.pts, (v) => v.toFixed(1))}
                    </td>
                    <td className="px-2.5 py-2 text-right font-mono font-semibold tabular-nums">
                      {signedVal(j.chg, pfMoney)}
                    </td>
                    <td className="px-2.5 py-2">{renderStatusBadge(j.st)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const renderClosedTrackView = () => {
    if (!closedResult || !S) return null;
    const B = closedResult;
    const T = B.tot;
    const hp = (h: number, e: number) => (e ? `${Math.round((h / e) * 100)}%` : '');
    const nameOf = (c: string) =>
      S.clBy === 'est' || S.clBy === 'pm' ? codeName(c) : <span>{c}</span>;
    const list = (
      S.clWho
        ? B.J.filter(
            (j) =>
              (S.clBy === 'div' ? DIVN[j.div] || j.div : j[S.clBy] || '(none)') === S.clWho
          )
        : B.J
    )
      .filter((j) => !S.clSt || j.st === S.clSt)
      .sort((a, b) => a.vs - b.vs);

    return (
      <div className="space-y-6">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white px-5 py-3.5 text-xs">
          <label className="flex items-center gap-2 font-medium text-slate-700">
            <span>Completed</span>
            <select
              value={S.clYears}
              onChange={(e) => onUpdateScorecard?.({ clYears: e.target.value })}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
            >
              <option value="all">All years</option>
              {[2026, 2025, 2024, 2023].map((yr) => (
                <option key={yr} value={String(yr)}>
                  {yr} and later
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 font-medium text-slate-700">
            <span>Division</span>
            <select
              value={S.clDiv}
              onChange={(e) =>
                onUpdateScorecard?.({
                  clDiv: e.target.value,
                  clWho: S.clBy === 'div' ? '' : S.clWho,
                })
              }
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
            >
              <option value="all">All</option>
              {Object.entries(DIVN).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 font-medium text-slate-700">
            <span>Group by</span>
            <select
              value={S.clBy}
              onChange={(e) =>
                onUpdateScorecard?.({
                  clBy: e.target.value as PfScorecardSettings['clBy'],
                  clWho: '',
                })
              }
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
            >
              {Object.entries(CL_GROUPS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>

          <span className="text-slate-500">
            {pfState?.closed?.file || ''} · {B.all} jobs ≥ $25k with estimates &amp; final costs.
          </span>
        </div>

        {/* 5 KPI Cards */}
        <div className="grid grid-cols-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white lg:grid-cols-5 lg:divide-x lg:divide-y-0">
          <div className="p-4">
            <div className="text-xs font-medium text-slate-500">Closed jobs</div>
            <div className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {T.n}
            </div>
            <div className="mt-1 text-xs text-slate-500 tabular-nums">
              {pfMoney(T.rev)} revenue
            </div>
          </div>

          <div className="p-4">
            <div className="text-xs font-medium text-slate-500">Est. vs actual GP</div>
            <div className="mt-1.5 font-mono text-lg font-semibold text-slate-900 tabular-nums">
              {T.rev ? `${p1((T.rev - T.ec) / T.rev)} → ${p1((T.rev - T.ac) / T.rev)}` : '—'}
            </div>
            <div className="mt-1 text-xs text-slate-500 tabular-nums">
              {signedVal(T.vs, pfMoney)} vs estimate
            </div>
          </div>

          <button
            type="button"
            onClick={() =>
              onUpdateScorecard?.({ clSt: S.clSt === 'beat' ? '' : 'beat' })
            }
            className={`p-4 text-left transition-colors ${
              S.clSt === 'beat' ? 'bg-emerald-50/60' : 'hover:bg-slate-50'
            }`}
          >
            <div className="text-xs font-medium text-slate-500">Beat estimate</div>
            <div className="mt-1.5 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
              {T.beat}
            </div>
            <div className="mt-1 text-xs text-slate-500">{T.on} on target</div>
          </button>

          <button
            type="button"
            onClick={() =>
              onUpdateScorecard?.({ clSt: S.clSt === 'slip' ? '' : 'slip' })
            }
            className={`p-4 text-left transition-colors ${
              S.clSt === 'slip' ? 'bg-red-50/70' : 'hover:bg-slate-50'
            }`}
          >
            <div className="text-xs font-medium text-slate-500">Slipped</div>
            <div className="mt-1.5 font-mono text-2xl font-semibold text-red-700 tabular-nums">
              {T.slip}
            </div>
            <div className="mt-1 text-xs text-slate-500">{T.loss} lost money</div>
          </button>

          <div className="p-4">
            <div className="text-xs font-medium text-slate-500">Labor hrs vs estimate</div>
            <div className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {hp(T.h, T.he) || '—'}
            </div>
            <div className="mt-1 text-xs text-slate-500 tabular-nums">
              {Math.round(Math.abs(T.h - T.he)).toLocaleString()} hrs{' '}
              {T.h > T.he ? 'over' : 'under'}
            </div>
          </div>
        </div>

        {/* Group Rollup + Cost Bucket Variance */}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="xl:col-span-2 rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
            <h3 className="text-sm font-semibold text-slate-900">
              By {CL_GROUPS[S.clBy].toLowerCase()}, biggest slip first
            </h3>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-slate-100 text-slate-700">
                  <tr className="border-b border-slate-200">
                    <th className="px-2.5 py-2 font-semibold">{CL_GROUPS[S.clBy]}</th>
                    <th className="px-2.5 py-2 text-right font-semibold">Jobs</th>
                    <th className="px-2.5 py-2 text-right font-semibold">Revenue</th>
                    <th className="px-2.5 py-2 text-right font-semibold">Beat</th>
                    <th className="px-2.5 py-2 text-right font-semibold">Slip</th>
                    <th className="px-2.5 py-2 text-right font-semibold">Est. GP%</th>
                    <th className="px-2.5 py-2 text-right font-semibold">Act. GP%</th>
                    <th className="px-2.5 py-2 text-right font-semibold">vs Est.</th>
                    <th className="px-2.5 py-2 text-right font-semibold">Hrs %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {B.rows.map((r) => (
                    <tr
                      key={r.code}
                      onClick={() => {
                        onUpdateScorecard?.({
                          clWho: S.clWho === r.code ? '' : r.code,
                          clSt: '',
                        });
                        closedListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                      className={`cursor-pointer hover:bg-slate-50 ${
                        S.clWho === r.code ? 'bg-slate-100 font-semibold' : ''
                      }`}
                    >
                      <td className="px-2.5 py-2">{nameOf(r.code)}</td>
                      <td className="px-2.5 py-2 text-right font-mono tabular-nums">{r.n}</td>
                      <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                        {pfMoney(r.rev)}
                      </td>
                      <td className="px-2.5 py-2 text-right font-mono text-emerald-700 tabular-nums">
                        {r.beat || ''}
                      </td>
                      <td className="px-2.5 py-2 text-right font-mono text-red-700 tabular-nums">
                        {r.slip || ''}
                      </td>
                      <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                        {r.rev ? p1((r.rev - r.ec) / r.rev) : '—'}
                      </td>
                      <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                        {r.rev ? p1((r.rev - r.ac) / r.rev) : '—'}
                      </td>
                      <td className="px-2.5 py-2 text-right font-mono font-medium tabular-nums">
                        {signedVal(r.vs, pfMoney)}
                      </td>
                      <td
                        className={`px-2.5 py-2 text-right font-mono tabular-nums ${
                          r.he && r.h / r.he > 1.1 ? 'text-red-700 font-semibold' : ''
                        }`}
                      >
                        {hp(r.h, r.he)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
            <h3 className="text-sm font-semibold text-slate-900">Where the money went</h3>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-slate-100 text-slate-700">
                  <tr className="border-b border-slate-200">
                    <th className="px-2.5 py-2 font-semibold">Cost type</th>
                    <th className="px-2.5 py-2 text-right font-semibold">Actual</th>
                    <th className="px-2.5 py-2 text-right font-semibold">Estimate</th>
                    <th className="px-2.5 py-2 text-right font-semibold">Over/(under)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {B.cost.map((c) => {
                    const diff = c.a - c.e;
                    return (
                      <tr key={c.k}>
                        <td className="px-2.5 py-2 text-slate-700">{c.l}</td>
                        <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                          {pfMoney(c.a)}
                        </td>
                        <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                          {pfMoney(c.e)}
                        </td>
                        <td
                          className={`px-2.5 py-2 text-right font-mono font-medium tabular-nums ${
                            diff > 1000
                              ? 'text-red-700'
                              : diff < -1000
                              ? 'text-emerald-700'
                              : ''
                          }`}
                        >
                          {pfMoney(diff)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Closed Jobs List */}
        <div ref={closedListRef} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">
              {S.clSt
                ? {
                    beat: 'Closed jobs that beat estimate',
                    on: 'Closed jobs on target',
                    slip: 'Closed jobs that slipped',
                  }[S.clSt]
                : 'Closed jobs'}{' '}
              ({list.length})
            </h3>
            {(S.clWho || S.clSt) && (
              <button
                type="button"
                onClick={() => onUpdateScorecard?.({ clWho: '', clSt: '' })}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Show all
              </button>
            )}
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-[460px]">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-slate-100 text-slate-700">
                <tr className="border-b border-slate-200">
                  <th className="px-2.5 py-2 font-semibold">Job</th>
                  <th className="px-2.5 py-2 font-semibold">Name</th>
                  <th className="px-2.5 py-2 font-semibold">Est.</th>
                  <th className="px-2.5 py-2 font-semibold">PM</th>
                  <th className="px-2.5 py-2 font-semibold">Customer</th>
                  <th className="px-2.5 py-2 font-semibold">Done</th>
                  <th className="px-2.5 py-2 text-right font-semibold">Contract</th>
                  <th className="px-2.5 py-2 text-right font-semibold">Est GP%</th>
                  <th className="px-2.5 py-2 text-right font-semibold">Act GP%</th>
                  <th className="px-2.5 py-2 text-right font-semibold">vs Est.</th>
                  <th className="px-2.5 py-2 text-right font-semibold">Labor hrs</th>
                  <th className="px-2.5 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((j) => (
                  <tr key={j.job} className="hover:bg-slate-50/70">
                    <td className="px-2.5 py-1.5 font-mono font-semibold text-slate-900 tabular-nums">
                      {j.job}
                    </td>
                    <td className="px-2.5 py-1.5 text-slate-800 max-w-[180px] truncate">
                      {j.name}
                    </td>
                    <td className="px-2.5 py-1.5">{codeName(j.est)}</td>
                    <td className="px-2.5 py-1.5">{codeName(j.pm)}</td>
                    <td className="px-2.5 py-1.5 text-slate-600 max-w-[150px] truncate">
                      {j.cust}
                    </td>
                    <td className="px-2.5 py-1.5 font-mono text-slate-500">{j.done}</td>
                    <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                      {pfMoney(j.rev)}
                    </td>
                    <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                      {p1(j.estP)}
                    </td>
                    <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                      {p1(j.actP)}
                    </td>
                    <td className="px-2.5 py-1.5 text-right font-mono font-medium tabular-nums">
                      {signedVal(j.vs, pfMoney)}
                    </td>
                    <td
                      className={`px-2.5 py-1.5 text-right font-mono tabular-nums ${
                        j.hrs[1] && j.hrs[0] / j.hrs[1] > 1.1 ? 'text-red-700 font-semibold' : ''
                      }`}
                    >
                      {hp(j.hrs[0], j.hrs[1])}
                    </td>
                    <td className="px-2.5 py-1.5">{renderStatusBadge(j.st)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">05. Job Scorecard</h1>
          <p className="mt-1 text-xs text-slate-500">
            Period ending {period || 'Current'} · Estimator &amp; PM track record (active vs.
            Spectrum estimate + 2020–2026 closed jobs) paired with WIP Health Tiers
          </p>
        </div>

        {(hasEst || hasClosed) && (
          <div className="inline-flex flex-wrap rounded-lg bg-slate-100 p-1 shrink-0">
            {hasEst && (
              <button
                type="button"
                onClick={() => setSubView('active-est')}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  subView === 'active-est'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Active vs. Estimate (PM &amp; Estimator)
              </button>
            )}
            {hasClosed && (
              <button
                type="button"
                onClick={() => setSubView('closed')}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  subView === 'closed'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Closed Jobs (2020–2026)
              </button>
            )}
            <button
              type="button"
              onClick={() => setSubView('wip-tiers')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                subView === 'wip-tiers'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              WIP Health Tiers
            </button>
          </div>
        )}
      </div>

      {subView === 'active-est' && hasEst ? (
        renderActiveEstimateView()
      ) : subView === 'closed' && hasClosed ? (
        renderClosedTrackView()
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white lg:grid-cols-4 lg:divide-x lg:divide-y-0">
            <div className="p-4">
              <div className="text-xs font-medium text-slate-500">Strong Execution</div>
              <div className="mt-1.5 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
                {counts.Strong}
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs font-medium text-slate-500">Watch List</div>
              <div className="mt-1.5 font-mono text-2xl font-semibold text-amber-700 tabular-nums">
                {counts.Watch}
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs font-medium text-slate-500">Action Required</div>
              <div className="mt-1.5 font-mono text-2xl font-semibold text-red-700 tabular-nums">
                {counts['Action Required']}
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs font-medium text-slate-500">Loss Jobs</div>
              <div className="mt-1.5 font-mono text-2xl font-semibold text-red-800 tabular-nums">
                {counts['Loss Job']}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
                {(['all', 'Strong', 'Watch', 'Action Required', 'Loss Job'] as const).map(
                  (tier) => (
                    <button
                      key={tier}
                      type="button"
                      onClick={() => setTierFilter(tier)}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        tierFilter === tier
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {tier === 'all' ? `All (${rows.length})` : tier}
                    </button>
                  )
                )}
              </div>

              <div className="relative flex-1 min-w-[200px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search job…"
                  aria-label="Search job scorecard"
                  className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-9 pr-3 text-xs text-slate-900 focus:border-[#0F293A] focus:outline-none"
                />
              </div>

              <select
                value={divisionFilter}
                onChange={(e) => setDivisionFilter(e.target.value)}
                aria-label="Filter division"
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900"
              >
                <option value="">All divisions</option>
                {(Object.entries(DIVISIONS) as Array<[DivisionCode, string]>).map(
                  ([code, name]) => (
                    <option key={code} value={code}>
                      {code} · {name}
                    </option>
                  )
                )}
              </select>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-slate-100 text-slate-700">
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2.5 font-semibold">Job</th>
                    <th className="px-3 py-2.5 font-semibold">Health Tier</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Contract</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Job GP%</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Div Avg</th>
                    <th className="px-3 py-2.5 text-right font-semibold">GP Spread</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Bid $/Hr</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Act. $/Hr</th>
                    <th className="px-3 py-2.5 font-semibold">Billing Posture</th>
                    <th className="px-3 py-2.5 font-semibold">Primary Driver</th>
                    <th className="px-3 py-2.5 font-semibold min-w-[170px]">PM Action Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleRows.map((row) => (
                    <tr key={row.job.id} className="hover:bg-slate-50/70">
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-slate-900 tabular-nums">{row.job.id}</div>
                        <div className="text-[11px] text-slate-500 max-w-[200px] truncate">
                          {row.job.name}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {row.healthTier === 'Strong' && (
                          <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Strong
                          </span>
                        )}
                        {row.healthTier === 'Watch' && (
                          <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Watch
                          </span>
                        )}
                        {(row.healthTier === 'Action Required' ||
                          row.healthTier === 'Loss Job') && (
                          <span className="inline-flex items-center gap-1 font-medium text-red-700">
                            <ShieldAlert className="h-3.5 w-3.5" />
                            {row.healthTier}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {fmtMoney.format(row.job.contract)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {fmtPct(row.job.projectedGpPct)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-500 tabular-nums">
                        {fmtPct(row.divisionBenchmarkGp)}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                          row.gpSpreadVsBenchmark >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {row.gpSpreadVsBenchmark >= 0 ? '+' : ''}
                        {fmtPct(row.gpSpreadVsBenchmark)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {fmtMoney2.format(row.job.projectedProfitPerHr)}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                          row.profitPerHrDelta >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {fmtMoney2.format(row.job.actualProfitPerHr)}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-700">
                        {row.billingPosture}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 max-w-[200px]">
                        {row.primaryDriver}
                      </td>
                      <td className="px-3 py-2.5">
                        <input
                          type="text"
                          value={row.pmNote}
                          onChange={(e) => onUpdateNote(row.job.id, { pmNote: e.target.value })}
                          placeholder="Add PM action…"
                          aria-label={`PM scorecard note for ${row.job.id}`}
                          className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:border-[#0F293A] focus:outline-none"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Spectrum Code Names Editor (used across Active & Closed Scorecards) */}
      {(hasEst || hasClosed) && allSpectrumCodes.length > 0 && S && (
        <div className="rounded-xl border border-slate-200 bg-white">
          <button
            type="button"
            onClick={() => setShowNamesEditor((v) => !v)}
            className="flex w-full items-center justify-between px-5 py-3 text-left text-xs font-semibold text-slate-800 hover:bg-slate-50"
          >
            <div className="flex items-center gap-2">
              {showNamesEditor ? (
                <ChevronDown className="h-4 w-4 text-slate-400" />
              ) : (
                <ChevronRight className="h-4 w-4 text-slate-400" />
              )}
              <span>Names for Spectrum Estimator &amp; PM codes ({allSpectrumCodes.length})</span>
            </div>
            <span className="font-normal text-slate-500">
              Type a name once and it displays across Estimator &amp; PM scorecards
            </span>
          </button>

          {showNamesEditor && (
            <div className="grid grid-cols-2 gap-3 border-t border-slate-200 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 text-xs">
              {allSpectrumCodes.map((c) => (
                <label key={c} className="block">
                  <span className="font-mono text-[11px] font-semibold text-slate-500">{c}</span>
                  <input
                    type="text"
                    value={S.names[c] || ''}
                    placeholder="Full name"
                    onChange={(e) => {
                      const nextNames = { ...(S.names || {}) };
                      const v = e.target.value.trim();
                      if (v) nextNames[c] = v;
                      else delete nextNames[c];
                      onUpdateScorecard?.({ names: nextNames });
                    }}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs"
                  />
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
