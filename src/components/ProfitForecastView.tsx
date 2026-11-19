import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { linePath, wcIn } from '../lib/lookaheadEngine';
import {
  DEPT_ORDER,
  DEPTS,
  gutDollars,
  gutLabel,
  gutOf,
  mLabel,
  mLong,
  modeText,
  pfMoney,
  pfPct,
  sumRow,
} from '../lib/profitForecastEngine';
import type {
  PfCashResult,
  PfCostMap,
  PfDivMonthOverride,
  PfDivOverride,
  PfDrillItem,
  PfForecastJob,
  PfForecastResult,
  PfLikelyJob,
  PfSettings,
  PfState,
} from '../types/profitForecast';

interface ProfitForecastViewProps {
  pfState: PfState;
  forecast: PfForecastResult | null;
  cash: PfCashResult | null;
  onUpdateGlobal: (patch: Partial<PfSettings>) => void;
  onUpdateDivOverride: (
    code: string,
    overridesPatch: PfDivOverride | null,
    monthOvPatch?: PfDivMonthOverride | null
  ) => void;
  onUpdateLikely: (likely: PfLikelyJob[]) => void;
  onUpdateCostMap: (map: PfCostMap, asOfOverride?: string | null) => void;
  onUpdateWipMonth: (asOf: string | null) => void;
  onUpdateAgingMonth: (kind: 'ar' | 'ap', asOf: string | null) => void;
  onUploadFiles: (files: FileList | File[]) => Promise<void>;
  onReloadSnapshot: () => Promise<void>;
  onEditJob: (key: string) => void;
  onOpenDrill: (title: string, items: PfDrillItem[], note?: string) => void;
}

export const ProfitForecastView: React.FC<ProfitForecastViewProps> = ({
  pfState,
  forecast,
  cash,
  onUpdateGlobal,
  onUpdateDivOverride,
  onUpdateLikely,
  onUpdateCostMap,
  onUpdateWipMonth,
  onUpdateAgingMonth,
  onUploadFiles,
  onReloadSnapshot,
  onEditJob,
  onOpenDrill,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [mMonth, setMMonth] = useState<string>('');
  const [mDiv, setMDiv] = useState<string>('proj');
  const [mSort, setMSort] = useState<{ key: string; dir: number }>({ key: 'gp', dir: 1 });

  const [jobDiv, setJobDiv] = useState<string>('all');
  const [metric, setMetric] = useState<'cost' | 'rev' | 'gp'>('cost');
  const [showDone, setShowDone] = useState<boolean>(false);
  const [q, setQ] = useState<string>('');
  const [jobSort, setJobSort] = useState<{ key: string; dir: number }>({ key: 'm0', dir: -1 });
  const [isReloading, setIsReloading] = useState(false);

  const settings = pfState.settings;
  const activeMonth = useMemo(() => {
    if (!forecast) return '';
    const M = forecast.M.months;
    if (mMonth && M.includes(mMonth)) return mMonth;
    return M[forecast.M.actual ? 1 : 0] || M[0] || '';
  }, [forecast, mMonth]);

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) {
      await onUploadFiles(e.dataTransfer.files);
    }
  };

  const handleReload = async () => {
    setIsReloading(true);
    try {
      await onReloadSnapshot();
    } finally {
      setIsReloading(false);
    }
  };

  const costOpts = useMemo(() => {
    if (!pfState.cost) return [];
    const s = new Set<number>();
    pfState.cost.rows.forEach((r) => Object.keys(r.vals).forEach((k) => s.add(Number(k))));
    return [...s].sort((a, b) => a - b);
  }, [pfState.cost]);

  // Division P&L YTD + Year End calcs
  const summaryStats = useMemo(() => {
    if (!forecast) return null;
    const P = pfState.pnl ? pfState.pnl.depts : {};
    const pm = pfState.pnl?.asOf || null;
    const yr = pm ? pm.slice(0, 4) : null;
    const yeIdx = pm
      ? forecast.M.months
          .map((k, i) => (k > pm && k <= `${yr}-12` ? i : -1))
          .filter((i) => i >= 0)
      : [];
    const lastShown = forecast.M.months[forecast.M.months.length - 1];
    const yePartial = Boolean(pm && lastShown < `${yr}-12` && pm < `${yr}-12`);
    const hasYtd =
      Boolean(pm) &&
      DEPT_ORDER.some(
        (c) => P[c] && P[c].ytdRevenue !== undefined && P[c].ytdRevenue !== null
      );
    const ytdOf = (c: string) => {
      const d = P[c];
      if (!d) return { rev: 0, gp: 0, oh: 0, net: 0 };
      const gp = d.ytdGP || 0;
      const oh = d.ytdOverhead || 0;
      return {
        rev: d.ytdRevenue || 0,
        gp,
        oh,
        net: d.ytdNet !== null && d.ytdNet !== undefined ? d.ytdNet : gp - oh,
      };
    };
    const tot = { rev: 0, gp: 0, oh: 0, net: 0 };
    for (const c of DEPT_ORDER) {
      const y = ytdOf(c);
      tot.rev += y.rev;
      tot.gp += y.gp;
      tot.oh += y.oh;
      tot.net += y.net;
    }
    return { pm, yr, yeIdx, lastShown, yePartial, hasYtd, ytdOf, tot };
  }, [forecast, pfState.pnl]);

  // Month Detail rows
  const monthDetail = useMemo(() => {
    if (!forecast || !activeMonth) return null;
    const i = forecast.M.months.indexOf(activeMonth);
    const inDiv = (d: string) => (mDiv === 'proj' ? d === '00' || d === '01' : d === mDiv);
    interface MonthRow {
      key: string | null;
      job: string;
      name: string;
      rev: number;
      cost: number;
      gp: number;
      pct: number | null;
      done: number | null;
      gut: ReturnType<typeof gutOf>;
      likely?: boolean;
    }
    const rows: MonthRow[] = forecast.jobs
      .filter((f) => inDiv(f.job.dept))
      .map((f) => {
        const m = f.months[i];
        return {
          key: f.key,
          job: f.job.job,
          name: f.job.name,
          rev: m.rev,
          cost: m.cost,
          gp: m.gp,
          pct: m.rev > 0 ? m.gp / m.rev : null,
          done: m.pct,
          gut: gutOf(f, settings),
        };
      })
      .filter((r) => Math.abs(r.rev) > 100 || Math.abs(r.cost) > 100 || Math.abs(r.gp) > 100);

    if (settings.includeLikely !== false) {
      for (const L of settings.likely || []) {
        if (!inDiv(L.dept)) continue;
        const rv = Number((L.rev || {})[activeMonth]) || 0;
        if (!rv) continue;
        const gp = rv * (Number(L.gp) || 0);
        rows.push({
          key: null,
          job: 'Likely',
          name: L.name || 'Likely job',
          rev: rv,
          cost: rv - gp,
          gp,
          pct: Number(L.gp) || 0,
          done: null,
          gut: null,
          likely: true,
        });
      }
    }

    const kv = (r: MonthRow) => {
      if (mSort.key === 'name') return r.name.toLowerCase();
      if (mSort.key === 'job') return r.job;
      if (mSort.key === 'rev') return r.rev;
      if (mSort.key === 'cost') return r.cost;
      if (mSort.key === 'gp') return r.gp;
      if (mSort.key === 'pct') return r.pct === null ? -1e12 : r.pct;
      if (mSort.key === 'done') return r.done === null ? -1e12 : r.done;
      return r.gp;
    };
    rows.sort((a, b) => {
      const x = kv(a);
      const y = kv(b);
      return (x < y ? -1 : x > y ? 1 : 0) * mSort.dir;
    });

    const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.gp)));
    const tot = rows.reduce(
      (a, r) => ({ rev: a.rev + r.rev, cost: a.cost + r.cost, gp: a.gp + r.gp }),
      { rev: 0, cost: 0, gp: 0 }
    );
    const neg = rows.filter((r) => r.gp < -1);
    const negSum = neg.reduce((a, r) => a + r.gp, 0);
    const svc =
      (mDiv === '02' || mDiv === '03') && forecast.div[mDiv] && forecast.div[mDiv].runRate;
    return { rows, maxAbs, tot, negCount: neg.length, negSum, svc };
  }, [forecast, activeMonth, mDiv, mSort, settings]);

  // Watch List
  const watchLists = useMemo(() => {
    if (!forecast) return null;
    const J = forecast.jobs;
    const over = J.filter((f) => f.flags.some((x) => x.type === 'over'))
      .map((f) => ({ f, amt: f.flags.find((x) => x.type === 'over')?.amt || 0 }))
      .sort((a, b) => b.amt - a.amt);
    const loss = J.filter((f) => f.flags.some((x) => x.type === 'loss') && f.remaining > 1)
      .map((f) => ({ f, amt: f.flags.find((x) => x.type === 'loss')?.amt || 0 }))
      .sort((a, b) => a.amt - b.amt);
    const nofin = J.filter((f) => f.flags.some((x) => x.type === 'nofinish')).sort(
      (a, b) => b.C - a.C
    );
    const late = J.filter(
      (f) =>
        f.C >= 250000 &&
        (f.pctStart || 0) >= 0.75 &&
        f.remaining > Math.max(25000, 0.02 * f.C) &&
        f.target === null
    )
      .map((f) => ({
        f,
        pt: f.C * 0.01 * Math.min(1, f.months[0]?.pct || 0),
      }))
      .sort((a, b) => b.pt - a.pt)
      .slice(0, 8);
    return { over, loss, nofin, late };
  }, [forecast]);

  // All Jobs table
  const filteredJobs = useMemo(() => {
    if (!forecast) return [];
    const ql = q.trim().toLowerCase();
    const list = forecast.jobs.filter(
      (f) =>
        (jobDiv === 'all' || f.job.dept === jobDiv) &&
        (showDone || f.active) &&
        (!ql || `${f.job.job} ${f.job.name}`.toLowerCase().includes(ql))
    );
    const valOf = (m: PfForecastJob['months'][number]) => m[metric];
    const kf = (f: PfForecastJob): string | number => {
      const sk = jobSort.key;
      if (sk.startsWith('m') && /^m\d+$/.test(sk)) {
        const mm = f.months[+sk.slice(1)];
        return mm ? valOf(mm) : 0;
      }
      if (sk === 'job') return f.job.job;
      if (sk === 'name') return f.job.name.toLowerCase();
      if (sk === 'contract') return f.C;
      if (sk === 'gp') return f.gpNow === null ? -9 : f.gpNow;
      if (sk === 'done') return f.pctStart ?? -1;
      if (sk === 'total') return sumRow(f.months.map(valOf));
      if (sk === 'gut') {
        const g = gutOf(f, settings);
        return !g ? -999 : g.dir === 'gain' ? g.pts : g.dir === 'fade' ? -g.pts : 0;
      }
      if (sk === 'gutd') return gutDollars(f, settings);
      if (sk === 'co') return f.coRev;
      return f.C;
    };
    list.sort((a, b) => {
      const x = kf(a);
      const y = kf(b);
      return (x < y ? -1 : x > y ? 1 : 0) * jobSort.dir || b.C - a.C;
    });
    return list;
  }, [forecast, jobDiv, showDone, q, metric, jobSort, settings]);

  // Monthly Cash LOC line path (strictly monthly model, no weekly balances)
  const monthlyCashModel = useMemo(() => {
    if (!cash || !forecast) return null;
    const w = { ...wcIn(pfState), knownV1: 0, knownV2: 0 };
    const adj = w.dep - w.principal - w.draws;
    const lp = linePath(forecast.M.months, cash, w, adj);
    const sortedJobs = cash.jobs
      .filter(
        (x) => x.f.active || Math.abs(x.pos0) > 1000 || x.arOpen > 0 || x.apOpen > 0
      )
      .sort((a, b) => a.pos0 - a.target0 - (b.pos0 - b.target0));
    return { w, adj, lp, sortedJobs };
  }, [cash, forecast, pfState]);

  const basisNote = useMemo(() => {
    if (!forecast || !pfState.wip?.asOf) return '';
    const M = forecast.M;
    let note = `Starts from the ${mLong(pfState.wip.asOf)} WIP. `;
    if (M.actual) {
      note += `${mLong(M.actual)} uses actual cost from the job cost report${
        pfState.pnl && pfState.pnl.asOf === M.actual ? " and that month's P&L" : ''
      }; the months after it are forecast.`;
    } else {
      note += "Drop a job cost report to lock in the current month's actual cost.";
    }
    if (pfState.cost && !M.actual) {
      note += " (The loaded job cost report isn't newer than the WIP, so it isn't used.)";
    }
    return note;
  }, [forecast, pfState]);

  const cashSettings = {
    collectDays: 55,
    billDay: 20,
    subsPWP: true,
    matsPWP: 0.85,
    obHold: 0,
    ...(settings.cash || {}),
  };

  const toggleMSort = (key: string) => {
    setMSort((prev) =>
      prev.key === key
        ? { key, dir: -prev.dir }
        : {
            key,
            dir: key === 'gp' || key === 'pct' || key === 'job' || key === 'name' ? 1 : -1,
          }
    );
  };

  const toggleJobSort = (key: string) => {
    const textKey = key === 'job' || key === 'name';
    setJobSort((prev) =>
      prev.key === key ? { key, dir: -prev.dir } : { key, dir: textKey ? 1 : -1 }
    );
  };

  const openMonthlyCashDrill = (field: 'cin' | 'cout', k: string) => {
    if (!cash) return;
    const its: PfDrillItem[] = cash.items
      .filter((x) => x.k === k && x.field === field)
      .map((x) => ({
        key: x.key,
        label: x.label,
        amt: field === 'cout' ? -x.amt : x.amt,
      }));
    onOpenDrill(
      `${field === 'cin' ? 'Collected on jobs' : 'Paid on jobs'} · ${mLong(k)}`,
      its,
      'From the profit forecast, AR/AP agings, and collection settings'
    );
  };

  return (
    <div
      className="space-y-6"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      {/* Header & Controls */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-wider text-[#B55C2C] uppercase">
            07. Multi-Month P&amp;L &amp; Job Gut-Check Engine
          </p>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900">
            Profit Forecast
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            {basisNote ||
              'Drop your Spectrum WIP, Job Cost Report, P&L Budget Comparison, and AR/AP agings (.xlsx) to model multi-month divisional net income.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".xls,.xlsx"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void onUploadFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Upload className="h-3.5 w-3.5" />
            Drop / Upload Reports
          </button>
          <button
            type="button"
            onClick={handleReload}
            disabled={isReloading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isReloading ? 'animate-spin' : ''}`} />
            Reload JRT 2026 Snapshot
          </button>
        </div>
      </div>

      {/* Drag Overlay Notice */}
      {dragging && (
        <div className="rounded-xl border-2 border-dashed border-[#0F293A] bg-slate-100 p-6 text-center text-xs font-semibold text-[#0F293A]">
          Drop Spectrum Excel files (WIP, Job Cost, P&amp;L, AR Aging, AP Aging) anywhere here…
        </div>
      )}

      {/* Collapsible Source Reports Bar */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <button
          type="button"
          onClick={() => setShowSources((v) => !v)}
          className="flex w-full items-center justify-between px-5 py-3 text-left text-xs font-semibold text-slate-800 hover:bg-slate-50/70"
        >
          <div className="flex items-center gap-2">
            {showSources ? (
              <ChevronDown className="h-4 w-4 text-slate-400" />
            ) : (
              <ChevronRight className="h-4 w-4 text-slate-400" />
            )}
            <span>
              Source Workbooks ({[pfState.wip, pfState.cost, pfState.pnl, pfState.ar, pfState.ap].filter(Boolean).length}/5 loaded)
            </span>
          </div>
          <span className="font-normal text-slate-500">
            {pfState.wip?.asOf ? `WIP ${mLong(pfState.wip.asOf)}` : 'No WIP'}
            {pfState.cost ? ` · Cost ${mLabel(pfState.cost.asOfOverride || pfState.cost.asOf || '')}` : ''}
            {pfState.pnl?.asOf ? ` · P&L ${mLabel(pfState.pnl.asOf)}` : ''}
            {pfState.ar?.asOf ? ` · AR/AP ${mLabel(pfState.ar.asOf)}` : ''}
          </span>
        </button>

        {showSources && (
          <div className="grid grid-cols-1 gap-3 border-t border-slate-200 p-4 sm:grid-cols-2 xl:grid-cols-5 text-xs">
            {/* WIP Card */}
            <div
              className={`rounded-lg border p-3 ${
                pfState.wip ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 bg-slate-50'
              }`}
            >
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                WIP
              </div>
              <div className="mt-1 font-semibold text-slate-900 truncate">
                {pfState.wip ? pfState.wip.file : 'Not loaded'}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-600">
                {pfState.wip
                  ? `${pfState.wip.jobs.length} jobs · ${
                      pfState.wip.asOf ? mLong(pfState.wip.asOf) : 'month unknown'
                    }`
                  : 'Your WIP workbook (.xlsx)'}
              </div>
              {pfState.wip && (
                <label className="mt-2 block text-[11px] text-slate-600">
                  WIP month
                  <input
                    type="month"
                    value={pfState.wip.asOf || ''}
                    onChange={(e) => onUpdateWipMonth(e.target.value || null)}
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                  />
                </label>
              )}
            </div>

            {/* Job Cost Card */}
            <div
              className={`rounded-lg border p-3 ${
                pfState.cost ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 bg-slate-50'
              }`}
            >
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Job cost report
              </div>
              <div className="mt-1 font-semibold text-slate-900 truncate">
                {pfState.cost ? pfState.cost.file : 'Optional'}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-600">
                {pfState.cost
                  ? `${pfState.cost.rows.length} jobs · through ${
                      pfState.cost.asOfOverride || pfState.cost.asOf
                        ? mLong((pfState.cost.asOfOverride || pfState.cost.asOf) as string)
                        : 'unknown'
                    }`
                  : 'Spectrum Job Summary Cost Report'}
              </div>
              {pfState.cost && (
                <div className="mt-2 space-y-1.5 text-[11px]">
                  <label className="block text-slate-600">
                    Month cost
                    <select
                      value={pfState.cost.map?.mtd ?? ''}
                      onChange={(e) =>
                        pfState.cost &&
                        onUpdateCostMap({
                          ...(pfState.cost.map || { mtd: 0, jtd: 0, how: 'manual' }),
                          mtd: Number(e.target.value),
                          how: 'manual',
                        })
                      }
                      className="mt-0.5 w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px]"
                    >
                      {costOpts.map((o) => (
                        <option key={o} value={o}>
                          {(pfState.cost?.header[o] || `Col ${o + 1}`).slice(-26)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-slate-600">
                    JTD cost
                    <select
                      value={pfState.cost.map?.jtd ?? ''}
                      onChange={(e) =>
                        pfState.cost &&
                        onUpdateCostMap({
                          ...(pfState.cost.map || { mtd: 0, jtd: 0, how: 'manual' }),
                          jtd: Number(e.target.value),
                          how: 'manual',
                        })
                      }
                      className="mt-0.5 w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px]"
                    >
                      {costOpts.map((o) => (
                        <option key={o} value={o}>
                          {(pfState.cost?.header[o] || `Col ${o + 1}`).slice(-26)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-slate-600">
                    Cost month
                    <input
                      type="month"
                      value={pfState.cost.asOfOverride || pfState.cost.asOf || ''}
                      onChange={(e) =>
                        pfState.cost?.map &&
                        onUpdateCostMap(pfState.cost.map, e.target.value || null)
                      }
                      className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-[11px]"
                    />
                  </label>
                </div>
              )}
            </div>

            {/* P&L Card */}
            <div
              className={`rounded-lg border p-3 ${
                pfState.pnl ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 bg-slate-50'
              }`}
            >
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                P&amp;L budget comparison
              </div>
              <div className="mt-1 font-semibold text-slate-900 truncate">
                {pfState.pnl ? pfState.pnl.file : 'Not loaded'}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-600">
                {pfState.pnl
                  ? `YTD monthly averages through ${
                      pfState.pnl.asOf ? mLong(pfState.pnl.asOf) : '?'
                    }`
                  : 'Overhead & service run rates by division'}
              </div>
            </div>

            {/* AR & AP Cards */}
            {(['ar', 'ap'] as const).map((kind) => {
              const rep = pfState[kind];
              const jobCount = rep ? Object.keys(rep.jobs).length : 0;
              const tot = rep ? Object.values(rep.jobs).reduce((a, b) => a + b, 0) : 0;
              return (
                <div
                  key={kind}
                  className={`rounded-lg border p-3 ${
                    rep ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    {kind.toUpperCase()} aging
                  </div>
                  <div className="mt-1 font-semibold text-slate-900 truncate">
                    {rep ? rep.file : 'Optional'}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-600">
                    {rep
                      ? `${pfMoney(tot)} open on ${jobCount} jobs`
                      : `Spectrum ${kind.toUpperCase()} Aged Open Items`}
                  </div>
                  {rep && (
                    <label className="mt-2 block text-[11px] text-slate-600">
                      Month
                      <input
                        type="month"
                        value={rep.asOf || ''}
                        onChange={(e) => onUpdateAgingMonth(kind, e.target.value || null)}
                        className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-[11px]"
                      />
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {!forecast || !summaryStats ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-xs text-slate-500">
          Load a WIP workbook (with WIP month) or click <strong>Reload JRT 2026 Snapshot</strong> to
          generate the profit forecast.
        </div>
      ) : (
        <>
          {/* Global Forecast Controls */}
          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white px-5 py-3.5 text-xs">
            <label className="flex items-center gap-2 font-medium text-slate-700">
              <span>Forecast months</span>
              <select
                value={settings.horizon || 6}
                onChange={(e) => onUpdateGlobal({ horizon: Number(e.target.value) })}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
              >
                <option value={3}>3 months</option>
                <option value={6}>6 months</option>
                <option value={12}>12 months</option>
              </select>
            </label>

            <label className="flex items-center gap-2 font-medium text-slate-700">
              <span>Large-job threshold $</span>
              <input
                type="number"
                step="100000"
                value={settings.threshold || 1000000}
                onChange={(e) =>
                  onUpdateGlobal({ threshold: Number(e.target.value) || 1000000 })
                }
                className="w-28 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums"
              />
            </label>

            <label className="flex items-center gap-2 font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.includeLikely !== false}
                onChange={(e) => onUpdateGlobal({ includeLikely: e.target.checked })}
                className="rounded border-slate-300 text-[#0F293A]"
              />
              <span>Include likely jobs</span>
            </label>
          </div>

          {/* Headline Net Profit KPI Strip */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
            {summaryStats.hasYtd && (
              <div className="rounded-xl border border-slate-300 bg-[#0F293A] p-4 text-white">
                <div className="text-[11px] font-medium text-slate-300">
                  Year end {summaryStats.yr}
                  {summaryStats.yePartial
                    ? ` (thru ${mLabel(summaryStats.lastShown)})`
                    : ''}
                </div>
                {(() => {
                  const yeNet =
                    summaryStats.tot.net +
                    sumRow(summaryStats.yeIdx.map((i) => forecast.total[i]?.net || 0));
                  return (
                    <div
                      className={`mt-1.5 font-mono text-xl font-bold tabular-nums ${
                        yeNet < -0.5 ? 'text-red-300' : 'text-white'
                      }`}
                    >
                      {pfMoney(yeNet)}
                    </div>
                  );
                })()}
                <div className="mt-1 text-[11px] text-slate-300 tabular-nums">
                  net · YTD {pfMoney(summaryStats.tot.net)} + fcst
                </div>
              </div>
            )}

            {forecast.M.months.map((k, i) => {
              const t = forecast.total[i];
              const gpPct = t.rev ? t.gp / t.rev : null;
              return (
                <div key={k} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="text-[11px] font-medium text-slate-500">
                    {mLong(k)}
                    {forecast.M.actual && i === 0 ? ' · actual cost' : ''}
                  </div>
                  <div
                    className={`mt-1.5 font-mono text-xl font-bold tabular-nums ${
                      t.net < -0.5 ? 'text-red-700' : 'text-slate-900'
                    }`}
                  >
                    {pfMoney(t.net)}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500 tabular-nums">
                    net · GP {pfPct(gpPct)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Summary by Division */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Summary by division</h2>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-slate-100 text-slate-700">
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2.5 font-semibold min-w-[180px]" />
                    {forecast.M.months.map((k, i) => (
                      <th key={k} className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">
                        {mLabel(k)}
                        {forecast.M.actual && i === 0 && (
                          <div className="text-[10px] font-normal text-emerald-700">actual cost</div>
                        )}
                      </th>
                    ))}
                    <th className="px-3 py-2.5 text-right font-semibold bg-slate-200/60">Total</th>
                    {summaryStats.hasYtd && summaryStats.pm && (
                      <>
                        <th className="px-3 py-2.5 text-right font-semibold bg-slate-50 whitespace-nowrap">
                          YTD thru {mLabel(summaryStats.pm)}
                          <div className="text-[10px] font-normal text-slate-500">actual</div>
                        </th>
                        <th className="px-3 py-2.5 text-right font-semibold bg-slate-100 whitespace-nowrap">
                          Year end {summaryStats.yr}
                          <div className="text-[10px] font-normal text-slate-500">
                            {summaryStats.yePartial
                              ? `thru ${mLabel(summaryStats.lastShown)}`
                              : 'YTD + forecast'}
                          </div>
                        </th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[
                    ...DEPT_ORDER.filter((c) => forecast.div[c]).map((c) => ({
                      title: DEPTS[c],
                      months: forecast.div[c].months,
                      ytd: summaryStats.ytdOf(c),
                      isCo: false,
                    })),
                    {
                      title: 'Company',
                      months: forecast.total.map((t) => ({ ...t, likelyGP: t.likelyGP })),
                      ytd: summaryStats.tot,
                      isCo: true,
                    },
                  ].map((blk) => {
                    const rev = blk.months.map((m) => m.rev);
                    const gp = blk.months.map((m) => m.gp);
                    const oh = blk.months.map((m) => -m.oh);
                    const net = blk.months.map((m) => m.net);
                    const hasLikely =
                      !blk.isCo && blk.months.some((m) => Math.abs(m.likelyGP) > 0.5);
                    const likelyGP = blk.months.map((m) => m.likelyGP);

                    const renderRow = (
                      label: string,
                      vals: number[],
                      opts?: {
                        isPct?: boolean;
                        totPct?: number | null;
                        ytdVal?: number | null;
                        yeVal?: number | null;
                        rowCls?: string;
                      }
                    ) => {
                      const tot = opts?.isPct ? opts.totPct ?? null : sumRow(vals);
                      const colSpanVal =
                        1 +
                        forecast.M.months.length +
                        1 +
                        (summaryStats.hasYtd ? 2 : 0);
                      void colSpanVal;
                      return (
                        <tr key={`${blk.title}-${label}`} className={opts?.rowCls || ''}>
                          <td className="px-3 py-1.5 text-slate-700">{label}</td>
                          {vals.map((v, idx) => (
                            <td
                              key={idx}
                              className={`px-3 py-1.5 text-right font-mono tabular-nums ${
                                !opts?.isPct && v < -0.5 ? 'text-red-700' : ''
                              }`}
                            >
                              {opts?.isPct ? pfPct(v) : pfMoney(v)}
                            </td>
                          ))}
                          <td
                            className={`px-3 py-1.5 text-right font-mono font-semibold bg-slate-50/70 tabular-nums ${
                              !opts?.isPct && (tot || 0) < -0.5 ? 'text-red-700' : ''
                            }`}
                          >
                            {opts?.isPct ? pfPct(tot) : pfMoney(tot)}
                          </td>
                          {summaryStats.hasYtd && (
                            <>
                              <td
                                className={`px-3 py-1.5 text-right font-mono bg-slate-50/40 tabular-nums ${
                                  !opts?.isPct && (opts?.ytdVal || 0) < -0.5 ? 'text-red-700' : ''
                                }`}
                              >
                                {opts?.ytdVal === undefined
                                  ? ''
                                  : opts.isPct
                                  ? pfPct(opts.ytdVal)
                                  : pfMoney(opts.ytdVal)}
                              </td>
                              <td
                                className={`px-3 py-1.5 text-right font-mono font-semibold bg-slate-100/50 tabular-nums ${
                                  !opts?.isPct && (opts?.yeVal || 0) < -0.5 ? 'text-red-700' : ''
                                }`}
                              >
                                {opts?.yeVal === undefined
                                  ? ''
                                  : opts.isPct
                                  ? pfPct(opts.yeVal)
                                  : pfMoney(opts.yeVal)}
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    };

                    const yeRev =
                      blk.ytd.rev + sumRow(summaryStats.yeIdx.map((idx) => rev[idx] || 0));
                    const yeGP =
                      blk.ytd.gp + sumRow(summaryStats.yeIdx.map((idx) => gp[idx] || 0));
                    const yeOH =
                      -blk.ytd.oh + sumRow(summaryStats.yeIdx.map((idx) => oh[idx] || 0));
                    const yeNet =
                      blk.ytd.net + sumRow(summaryStats.yeIdx.map((idx) => net[idx] || 0));

                    const totRev = sumRow(rev);
                    const totGP = sumRow(gp);

                    return (
                      <React.Fragment key={blk.title}>
                        <tr
                          className={
                            blk.isCo
                              ? 'bg-[#0F293A] text-white font-semibold'
                              : 'bg-slate-100 text-slate-900 font-semibold'
                          }
                        >
                          <td
                            colSpan={
                              2 + forecast.M.months.length + (summaryStats.hasYtd ? 2 : 0)
                            }
                            className="px-3 py-2"
                          >
                            {blk.title}
                          </td>
                        </tr>
                        {renderRow('Revenue', rev, { ytdVal: blk.ytd.rev, yeVal: yeRev })}
                        {hasLikely &&
                          renderRow('Likely jobs GP', likelyGP, {
                            rowCls: 'text-slate-500 bg-slate-50/40',
                          })}
                        {renderRow('Gross profit', gp, {
                          ytdVal: blk.ytd.gp,
                          yeVal: yeGP,
                          rowCls: 'font-semibold',
                        })}
                        {renderRow(
                          'GP %',
                          blk.months.map((m) => (m.rev ? m.gp / m.rev : 0)),
                          {
                            isPct: true,
                            totPct: totRev ? totGP / totRev : null,
                            ytdVal: blk.ytd.rev ? blk.ytd.gp / blk.ytd.rev : null,
                            yeVal: yeRev ? yeGP / yeRev : null,
                            rowCls: 'text-slate-500',
                          }
                        )}
                        {renderRow('Overhead', oh, { ytdVal: -blk.ytd.oh, yeVal: yeOH })}
                        {renderRow('Net', net, {
                          ytdVal: blk.ytd.net,
                          yeVal: yeNet,
                          rowCls: blk.isCo
                            ? 'bg-slate-200/70 font-bold'
                            : 'bg-slate-50 font-bold',
                        })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Month Detail Panel */}
          {monthDetail && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-900">Month detail</h2>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="inline-flex flex-wrap rounded-lg bg-slate-100 p-1">
                    {forecast.M.months.map((k, idx) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setMMonth(k)}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                          activeMonth === k
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {mLabel(k)}
                        {forecast.M.actual && idx === 0 ? ' (actual)' : ''}
                      </button>
                    ))}
                  </div>

                  <div className="inline-flex flex-wrap rounded-lg bg-slate-100 p-1">
                    {[
                      ['proj', 'All projects'],
                      ['00', DEPTS['00']],
                      ['01', DEPTS['01']],
                      ['02', DEPTS['02']],
                      ['03', DEPTS['03']],
                    ].map(([c, n]) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setMDiv(c)}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                          mDiv === c
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="text-xs text-slate-600 tabular-nums">
                {mLong(activeMonth)}: {monthDetail.rows.length} jobs · revenue{' '}
                {pfMoney(monthDetail.tot.rev)} · profit {pfMoney(monthDetail.tot.gp)} (
                {pfPct(
                  monthDetail.tot.rev ? monthDetail.tot.gp / monthDetail.tot.rev : null
                )}
                )
                {monthDetail.negCount > 0 && (
                  <span className="text-red-700 font-medium">
                    {' '}
                    · {monthDetail.negCount} jobs losing {pfMoney(monthDetail.negSum)}
                  </span>
                )}
                {monthDetail.svc &&
                  ' · Service totals use the run rate; these are just the service contract jobs.'}
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-[420px]">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 bg-slate-100 text-slate-700">
                    <tr className="border-b border-slate-200">
                      {(
                        [
                          ['job', 'Job', 'left'],
                          ['name', 'Name', 'left'],
                          ['rev', 'Revenue', 'right'],
                          ['cost', 'Cost', 'right'],
                          ['gp', 'Profit', 'right'],
                          ['pct', 'Profit %', 'right'],
                          ['done', 'Done', 'right'],
                        ] as const
                      ).map(([k, label, align]) => (
                        <th
                          key={k}
                          onClick={() => toggleMSort(k)}
                          className={`cursor-pointer select-none px-3 py-2.5 font-semibold hover:text-slate-900 ${
                            align === 'right' ? 'text-right' : ''
                          }`}
                        >
                          {label}
                          {mSort.key === k ? (mSort.dir < 0 ? ' ▼' : ' ▲') : ''}
                        </th>
                      ))}
                      <th className="px-3 py-2.5 font-semibold">Sven&apos;s gut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {monthDetail.rows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                          No activity this month.
                        </td>
                      </tr>
                    ) : (
                      monthDetail.rows.map((r, rIdx) => {
                        const a = Math.min(1, Math.abs(r.gp) / monthDetail.maxAbs);
                        const gpStyle: React.CSSProperties | undefined =
                          Math.abs(r.gp) < 1
                            ? undefined
                            : r.gp < 0
                            ? {
                                backgroundColor: `rgba(185, 28, 28, ${(0.1 + 0.45 * a).toFixed(2)})`,
                                color: a > 0.55 ? '#fff' : '#7f1d1d',
                              }
                            : {
                                backgroundColor: `rgba(21, 128, 61, ${(0.08 + 0.4 * a).toFixed(2)})`,
                                color: a > 0.6 ? '#fff' : '#14532d',
                              };
                        const pctTint =
                          r.pct === null
                            ? ''
                            : r.pct < 0
                            ? 'bg-red-50 text-red-800'
                            : r.pct < 0.1
                            ? 'bg-amber-50 text-amber-800'
                            : '';

                        return (
                          <tr
                            key={`${r.job}-${rIdx}`}
                            onClick={() => r.key && onEditJob(r.key)}
                            className={r.key ? 'cursor-pointer hover:bg-slate-50' : 'bg-slate-50/40'}
                          >
                            <td className="px-3 py-2 font-mono font-semibold text-slate-900 tabular-nums">
                              {r.job}
                            </td>
                            <td className="px-3 py-2 text-slate-800 max-w-[240px] truncate">
                              {r.name}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">
                              {pfMoney(r.rev)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">
                              {pfMoney(r.cost)}
                            </td>
                            <td
                              style={gpStyle}
                              className="px-3 py-2 text-right font-mono font-medium tabular-nums"
                            >
                              {pfMoney(r.gp)}
                            </td>
                            <td
                              className={`px-3 py-2 text-right font-mono tabular-nums ${pctTint}`}
                            >
                              {r.pct === null ? '—' : pfPct(r.pct)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-slate-500 tabular-nums">
                              {r.done === null ? '' : pfPct(r.done, 0)}
                            </td>
                            <td
                              className={`px-3 py-2 whitespace-nowrap font-medium ${
                                r.gut?.dir === 'gain'
                                  ? 'text-emerald-700'
                                  : r.gut?.dir === 'fade'
                                  ? 'text-red-700'
                                  : 'text-slate-600'
                              }`}
                            >
                              {r.gut ? gutLabel(r.gut) : ''}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold">
                    <tr>
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2">Total</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {pfMoney(monthDetail.tot.rev)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {pfMoney(monthDetail.tot.cost)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono tabular-nums ${
                          monthDetail.tot.gp < -0.5 ? 'text-red-700' : 'text-slate-900'
                        }`}
                      >
                        {pfMoney(monthDetail.tot.gp)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {pfPct(
                          monthDetail.tot.rev ? monthDetail.tot.gp / monthDetail.tot.rev : null
                        )}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Watch List */}
          {watchLists &&
            (watchLists.over.length > 0 ||
              watchLists.loss.length > 0 ||
              watchLists.late.length > 0 ||
              watchLists.nofin.length > 0) && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {watchLists.over.length > 0 && (
                  <div className="rounded-xl border border-red-200 bg-white p-4">
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-red-800">
                      <AlertTriangle className="h-4 w-4" />
                      Cost already past the estimate
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Cost to date is higher than projected total cost. Each fades in{' '}
                      {mLong(forecast.M.months[0])} unless contract goes up.
                    </p>
                    <ul className="mt-3 divide-y divide-slate-100 text-xs">
                      {watchLists.over.map(({ f, amt }) => (
                        <li
                          key={f.key}
                          className="flex items-center justify-between gap-2 py-1.5"
                        >
                          <button
                            type="button"
                            onClick={() => onEditJob(f.key)}
                            className="text-left font-medium text-[#0F293A] hover:underline truncate"
                          >
                            {f.job.job} {f.job.name}
                          </button>
                          <span className="font-mono font-semibold text-red-700 tabular-nums shrink-0">
                            {pfMoney(-amt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {watchLists.loss.length > 0 && (
                  <div className="rounded-xl border border-red-200 bg-white p-4">
                    <div className="text-sm font-semibold text-red-800">
                      Loss jobs still running
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Full projected loss is already booked. Any more overrun lands in the month it
                      happens.
                    </p>
                    <ul className="mt-3 divide-y divide-slate-100 text-xs">
                      {watchLists.loss.map(({ f, amt }) => (
                        <li
                          key={f.key}
                          className="flex items-center justify-between gap-2 py-1.5"
                        >
                          <button
                            type="button"
                            onClick={() => onEditJob(f.key)}
                            className="text-left font-medium text-[#0F293A] hover:underline truncate"
                          >
                            {f.job.job} {f.job.name}
                          </button>
                          <span className="font-mono font-semibold text-red-700 tabular-nums shrink-0">
                            {pfMoney(amt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {watchLists.late.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-white p-4">
                    <div className="text-sm font-semibold text-amber-800">
                      Late-stage jobs where fade hurts most
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      What 1 point of fade would cost in the month it&apos;s booked.
                    </p>
                    <ul className="mt-3 divide-y divide-slate-100 text-xs">
                      {watchLists.late.map(({ f, pt }) => (
                        <li
                          key={f.key}
                          className="flex items-center justify-between gap-2 py-1.5"
                        >
                          <button
                            type="button"
                            onClick={() => onEditJob(f.key)}
                            className="text-left font-medium text-[#0F293A] hover:underline truncate"
                          >
                            {f.job.job} {f.job.name}{' '}
                            <span className="text-slate-500 font-normal">
                              ({pfPct(f.pctStart, 0)} done)
                            </span>
                          </button>
                          <span className="font-mono font-semibold text-slate-800 tabular-nums shrink-0">
                            {pfMoney(pt)} / pt
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {watchLists.nofin.length > 0 && (
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="text-sm font-semibold text-slate-900">
                      Jobs over {pfMoney(settings.threshold || 1000000)} with no finish month
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Using last month&apos;s pace until a finish month is set.
                    </p>
                    <ul className="mt-3 divide-y divide-slate-100 text-xs">
                      {watchLists.nofin.map((f) => (
                        <li
                          key={f.key}
                          className="flex items-center justify-between gap-2 py-1.5"
                        >
                          <button
                            type="button"
                            onClick={() => onEditJob(f.key)}
                            className="text-left font-medium text-[#0F293A] hover:underline truncate"
                          >
                            {f.job.job} {f.job.name}
                          </button>
                          <span className="font-mono text-slate-700 tabular-nums shrink-0">
                            {pfMoney(f.remaining)} left
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

          {/* Jobs Forecast Schedule */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Jobs forecast schedule</h2>
                <p className="text-[11px] text-slate-500">
                  {metric === 'cost'
                    ? 'Cost each month'
                    : metric === 'rev'
                    ? 'Revenue earned each month'
                    : 'Gross profit booked each month'}{' '}
                  · click any job to edit pace, finish month, Sven&apos;s gut check, or change
                  orders
                </p>
              </div>
              <div className="inline-flex rounded-lg bg-slate-100 p-1">
                {(
                  [
                    ['cost', 'Cost'],
                    ['rev', 'Revenue'],
                    ['gp', 'Gross profit'],
                  ] as const
                ).map(([mKey, label]) => (
                  <button
                    key={mKey}
                    type="button"
                    onClick={() => setMetric(mKey)}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      metric === mKey
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex flex-wrap rounded-lg bg-slate-100 p-1">
                {[
                  ['all', 'All'],
                  ...DEPT_ORDER.map((c) => [c, DEPTS[c]]),
                ].map(([c, n]) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setJobDiv(c)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                      jobDiv === c
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>

              <div className="relative flex-1 min-w-[190px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Filter by job # or name…"
                  className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 focus:border-[#0F293A] focus:outline-none"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={showDone}
                  onChange={(e) => setShowDone(e.target.checked)}
                  className="rounded border-slate-300"
                />
                <span>Show finished jobs</span>
              </label>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-[520px]">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
                  <tr className="border-b border-slate-200">
                    {(
                      [
                        ['job', 'Job', 'left'],
                        ['name', 'Name', 'left'],
                        ['contract', 'Contract', 'right'],
                        ['gp', 'Current GP%', 'right'],
                        ['gut', "Sven's gut", 'left'],
                        ['gutd', 'Gut $', 'right'],
                        ['co', 'Adjustments', 'right'],
                        ['done', 'Done', 'right'],
                      ] as const
                    ).map(([sk, label, align]) => (
                      <th
                        key={sk}
                        onClick={() => toggleJobSort(sk)}
                        className={`cursor-pointer select-none px-2.5 py-2.5 font-semibold whitespace-nowrap ${
                          align === 'right' ? 'text-right' : ''
                        }`}
                      >
                        {label}
                        {jobSort.key === sk ? (jobSort.dir < 0 ? ' ▼' : ' ▲') : ''}
                      </th>
                    ))}
                    <th className="px-2.5 py-2.5 font-semibold whitespace-nowrap">Cost spread</th>
                    {forecast.M.months.map((mk, idx) => (
                      <th
                        key={mk}
                        onClick={() => toggleJobSort(`m${idx}`)}
                        className="cursor-pointer select-none px-2.5 py-2.5 text-right font-semibold whitespace-nowrap"
                      >
                        {mLabel(mk)}
                        {forecast.M.actual && idx === 0 && (
                          <div className="text-[10px] font-normal text-emerald-700">actual</div>
                        )}
                        {jobSort.key === `m${idx}` ? (jobSort.dir < 0 ? ' ▼' : ' ▲') : ''}
                      </th>
                    ))}
                    <th
                      onClick={() => toggleJobSort('total')}
                      className="cursor-pointer select-none px-2.5 py-2.5 text-right font-semibold bg-slate-200/70 whitespace-nowrap"
                    >
                      Total{jobSort.key === 'total' ? (jobSort.dir < 0 ? ' ▼' : ' ▲') : ''}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredJobs.length === 0 ? (
                    <tr>
                      <td
                        colSpan={forecast.M.months.length + 10}
                        className="px-3 py-6 text-center text-slate-500"
                      >
                        No jobs match.
                      </td>
                    </tr>
                  ) : (
                    filteredJobs.map((f) => {
                      const g = gutOf(f, settings);
                      const gd = gutDollars(f, settings);
                      const tot = sumRow(f.months.map((m) => m[metric]));
                      const isOverOrLoss = f.flags.some(
                        (x) => x.type === 'over' || x.type === 'loss'
                      );
                      const isNoFinish = f.flags.some((x) => x.type === 'nofinish');

                      return (
                        <tr
                          key={f.key}
                          onClick={() => onEditJob(f.key)}
                          className="cursor-pointer hover:bg-slate-50"
                        >
                          <td className="px-2.5 py-2 font-mono font-semibold text-slate-900 whitespace-nowrap tabular-nums">
                            {isOverOrLoss && (
                              <span
                                className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-red-600"
                                title="Over estimate or loss"
                              />
                            )}
                            {!isOverOrLoss && isNoFinish && (
                              <span
                                className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-amber-500"
                                title="No finish month"
                              />
                            )}
                            {f.job.job}
                          </td>
                          <td className="px-2.5 py-2 text-slate-800 max-w-[210px] truncate">
                            {f.job.name}
                          </td>
                          <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                            {pfMoney(f.C)}
                          </td>
                          <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                            {pfPct(f.gpNow)}
                          </td>
                          <td
                            className={`px-2.5 py-2 whitespace-nowrap font-medium ${
                              g?.dir === 'gain'
                                ? 'text-emerald-700'
                                : g?.dir === 'fade'
                                ? 'text-red-700'
                                : 'text-slate-600'
                            }`}
                          >
                            {gutLabel(g)}
                          </td>
                          <td
                            className={`px-2.5 py-2 text-right font-mono tabular-nums ${
                              gd < -0.5
                                ? 'text-red-700'
                                : gd > 0.5
                                ? 'text-emerald-700'
                                : ''
                            }`}
                          >
                            {g ? pfMoney(gd) : ''}
                          </td>
                          <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                            {f.coCount ? pfMoney(f.coRev) : ''}
                          </td>
                          <td className="px-2.5 py-2 text-right font-mono text-slate-600 tabular-nums">
                            {pfPct(f.pctStart, 0)}
                          </td>
                          <td className="px-2.5 py-2 text-slate-600 whitespace-nowrap">
                            {modeText(f, settings)}
                          </td>
                          {f.months.map((m) => {
                            const v = m[metric];
                            return (
                              <td
                                key={m.k}
                                className={`px-2.5 py-2 text-right font-mono tabular-nums ${
                                  v < -0.5 ? 'text-red-700' : ''
                                }`}
                              >
                                {pfMoney(v)}
                              </td>
                            );
                          })}
                          <td
                            className={`px-2.5 py-2 text-right font-mono font-semibold bg-slate-50/70 tabular-nums ${
                              tot < -0.5 ? 'text-red-700' : 'text-slate-900'
                            }`}
                          >
                            {pfMoney(tot)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {filteredJobs.length > 0 && (
                  <tfoot className="sticky bottom-0 border-t border-slate-200 bg-slate-100 font-semibold">
                    {(() => {
                      const monthTotals = forecast.M.months.map((_, i) =>
                        sumRow(filteredJobs.map((f) => f.months[i][metric]))
                      );
                      const gutChecked = filteredJobs.filter((f) => gutOf(f, settings)).length;
                      const gutSum = sumRow(
                        filteredJobs.map((f) => gutDollars(f, settings))
                      );
                      const grandTot = sumRow(monthTotals);
                      return (
                        <tr>
                          <td className="px-2.5 py-2" />
                          <td className="px-2.5 py-2">{filteredJobs.length} jobs</td>
                          <td colSpan={2} />
                          <td className="px-2.5 py-2 text-slate-600 whitespace-nowrap">
                            {gutChecked} of {filteredJobs.length} checked
                          </td>
                          <td
                            className={`px-2.5 py-2 text-right font-mono tabular-nums ${
                              gutSum < -0.5 ? 'text-red-700' : ''
                            }`}
                          >
                            {pfMoney(gutSum)}
                          </td>
                          <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                            {pfMoney(filteredJobs.reduce((x, f) => x + f.coRev, 0))}
                          </td>
                          <td colSpan={2} />
                          {monthTotals.map((v, idx) => (
                            <td
                              key={idx}
                              className={`px-2.5 py-2 text-right font-mono tabular-nums ${
                                v < -0.5 ? 'text-red-700' : ''
                              }`}
                            >
                              {pfMoney(v)}
                            </td>
                          ))}
                          <td
                            className={`px-2.5 py-2 text-right font-mono tabular-nums ${
                              grandTot < -0.5 ? 'text-red-700' : 'text-slate-900'
                            }`}
                          >
                            {pfMoney(grandTot)}
                          </td>
                        </tr>
                      );
                    })()}
                  </tfoot>
                )}
              </table>
            </div>

            {forecast.notOnWip.length > 0 && (
              <p className="text-[11px] text-slate-500">
                {forecast.notOnWip.length} jobs on the cost report aren&apos;t on the WIP (work
                orders, new jobs) and aren&apos;t in contract-job profit:{' '}
                {forecast.notOnWip
                  .map((x) => `${x.job} ${x.name} ${pfMoney(x.mtd)}`)
                  .join(', ')}
                .
              </p>
            )}
          </div>

          {/* Likely Jobs Editor */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Likely jobs</h2>
                <p className="text-[11px] text-slate-500">
                  Add work expected to start that is not yet on the WIP. Automatically feeds division
                  profit and Cash Lookahead collections.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const nextItem: PfLikelyJob = {
                    id: `l${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`,
                    at: Date.now(),
                    name: '',
                    dept: '00',
                    gp: 0.2,
                    rev: {},
                  };
                  onUpdateLikely([...(settings.likely || []), nextItem]);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Plus className="h-3.5 w-3.5" />
                Add likely job
              </button>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-slate-100 text-slate-700">
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2 font-semibold">Job</th>
                    <th className="px-3 py-2 font-semibold">Division</th>
                    <th className="px-3 py-2 text-right font-semibold">GP %</th>
                    {forecast.M.months.map((k) => (
                      <th key={k} className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                        {mLabel(k)} revenue
                      </th>
                    ))}
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(settings.likely || []).length === 0 ? (
                    <tr>
                      <td
                        colSpan={forecast.M.months.length + 4}
                        className="px-3 py-5 text-center text-slate-500"
                      >
                        No likely jobs yet. Add work you expect to start that isn&apos;t on the WIP.
                      </td>
                    </tr>
                  ) : (
                    (settings.likely || []).map((L, idx) => (
                      <tr key={L.id || idx}>
                        <td className="px-3 py-1.5">
                          <input
                            type="text"
                            value={L.name || ''}
                            placeholder="Job name (e.g. 01540 Piping Rock)"
                            onChange={(e) => {
                              const next = (settings.likely || []).map((row, rIdx) =>
                                rIdx === idx ? { ...row, name: e.target.value } : row
                              );
                              onUpdateLikely(next);
                            }}
                            className="w-44 rounded border border-slate-300 px-2 py-1 text-xs"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <select
                            value={L.dept}
                            onChange={(e) => {
                              const next = (settings.likely || []).map((row, rIdx) =>
                                rIdx === idx ? { ...row, dept: e.target.value } : row
                              );
                              onUpdateLikely(next);
                            }}
                            className="rounded border border-slate-300 px-2 py-1 text-xs"
                          >
                            {DEPT_ORDER.map((c) => (
                              <option key={c} value={c}>
                                {DEPTS[c]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <input
                            type="number"
                            step="0.1"
                            value={
                              L.gp !== undefined && L.gp !== ''
                                ? +(Number(L.gp) * 100).toFixed(2)
                                : ''
                            }
                            placeholder="GP %"
                            onChange={(e) => {
                              const val: number | '' =
                                e.target.value === '' ? '' : Number(e.target.value) / 100;
                              const next = (settings.likely || []).map((row, rIdx) =>
                                rIdx === idx ? { ...row, gp: val } : row
                              );
                              onUpdateLikely(next);
                            }}
                            className="w-20 rounded border border-slate-300 px-2 py-1 text-right font-mono text-xs tabular-nums"
                          />
                        </td>
                        {forecast.M.months.map((k) => (
                          <td key={k} className="px-3 py-1.5 text-right">
                            <input
                              type="number"
                              step="1000"
                              value={L.rev && L.rev[k] !== undefined ? L.rev[k] : ''}
                              onChange={(e) => {
                                const nextRev = { ...(L.rev || {}) };
                                if (e.target.value === '') delete nextRev[k];
                                else nextRev[k] = Number(e.target.value);
                                const next = (settings.likely || []).map((row, rIdx) =>
                                  rIdx === idx ? { ...row, rev: nextRev } : row
                                );
                                onUpdateLikely(next);
                              }}
                              className="w-24 rounded border border-slate-300 px-2 py-1 text-right font-mono text-xs tabular-nums"
                            />
                          </td>
                        ))}
                        <td className="px-2 py-1.5 text-right">
                          <button
                            type="button"
                            aria-label="Remove likely job"
                            onClick={() =>
                              onUpdateLikely(
                                (settings.likely || []).filter((_, rIdx) => rIdx !== idx)
                              )
                            }
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-700"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Overhead and Service */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <h2 className="text-sm font-semibold text-slate-900">Overhead and service</h2>
            <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.serviceRunRate !== false}
                onChange={(e) => onUpdateGlobal({ serviceRunRate: e.target.checked })}
                className="mt-0.5 rounded border-slate-300"
              />
              <span>
                Forecast service from a monthly run rate (revenue × GP %) instead of WIP jobs.
                Service jobs are short, so the run rate is steadier. Service jobs still show in the
                job list, but don&apos;t add to service totals or monthly cash.
              </span>
            </label>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-slate-100 text-slate-700">
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2 font-semibold min-w-[200px]" />
                    <th className="px-3 py-2 text-right font-semibold">Every month</th>
                    {forecast.M.months.map((k) => (
                      <th key={k} className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                        {mLabel(k)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {DEPT_ORDER.map((c) => {
                    const d = forecast.div[c];
                    const p = pfState.pnl?.depts?.[c];
                    const ov = settings.overrides?.[c] || {};
                    const mo = settings.monthOv?.[c] || {};
                    const svc = d.runRate;
                    const hasWo =
                      svc ||
                      (p?.woRevenue || 0) !== 0 ||
                      ov.woRevenue !== undefined ||
                      Boolean(mo.woRevenue);
                    const fields: Array<{
                      f: 'overhead' | 'woRevenue' | 'woPct';
                      label: string;
                      mk: 'oh' | 'woRev' | 'woPct';
                      isPct: boolean;
                    }> = [
                      { f: 'overhead', label: 'Overhead', mk: 'oh', isPct: false },
                      ...(hasWo
                        ? [
                            {
                              f: 'woRevenue' as const,
                              label: svc
                                ? 'Service revenue (jobs + work orders)'
                                : 'Work order revenue',
                              mk: 'woRev' as const,
                              isPct: false,
                            },
                            {
                              f: 'woPct' as const,
                              label: svc ? 'Service GP %' : 'Work order GP %',
                              mk: 'woPct' as const,
                              isPct: true,
                            },
                          ]
                        : []),
                    ];

                    return (
                      <React.Fragment key={c}>
                        <tr className="bg-slate-100 font-semibold text-slate-900">
                          <td colSpan={forecast.M.months.length + 2} className="px-3 py-2">
                            {DEPTS[c]}
                          </td>
                        </tr>
                        {fields.map(({ f, label, mk, isPct }) => {
                          const base = ov[f] !== undefined ? ov[f] : '';
                          const avgRev =
                            svc && p?.totRevenue !== undefined ? p.totRevenue : p?.woRevenue;
                          const avgGP =
                            svc && p?.totGP !== undefined ? p.totGP : p?.woProfit;
                          const avgPlaceholder =
                            f === 'woPct'
                              ? +((avgRev ? (avgGP || 0) / avgRev : 0) * 100).toFixed(1)
                              : f === 'woRevenue'
                              ? Math.round(avgRev || 0)
                              : Math.round(p?.overhead || 0);

                          return (
                            <tr key={`${c}-${f}`}>
                              <td className="px-3 py-1.5 text-slate-700">{label}</td>
                              <td className="px-3 py-1.5 text-right">
                                <input
                                  type="number"
                                  step={isPct ? 0.1 : 1000}
                                  value={
                                    base === '' || base === undefined
                                      ? ''
                                      : isPct
                                      ? +(Number(base) * 100).toFixed(2)
                                      : base
                                  }
                                  placeholder={String(avgPlaceholder)}
                                  onChange={(e) => {
                                    const nextVal =
                                      e.target.value === ''
                                        ? undefined
                                        : isPct
                                        ? Number(e.target.value) / 100
                                        : Number(e.target.value);
                                    const nextOv: PfDivOverride = { ...ov };
                                    if (nextVal === undefined) delete nextOv[f];
                                    else nextOv[f] = nextVal;
                                    onUpdateDivOverride(
                                      c,
                                      Object.keys(nextOv).length ? nextOv : null,
                                      null
                                    );
                                  }}
                                  className="w-24 rounded border border-slate-300 bg-white px-2 py-1 text-right font-mono text-xs tabular-nums"
                                />
                              </td>
                              {forecast.M.months.map((k, idx) => {
                                const mMap = mo[f] || {};
                                const v = mMap[k];
                                const used = d.months[idx]?.[mk] || 0;
                                const ph = isPct
                                  ? (used * 100).toFixed(1)
                                  : Math.round(used);
                                return (
                                  <td key={k} className="px-3 py-1.5 text-right">
                                    <input
                                      type="number"
                                      step={isPct ? 0.1 : 1000}
                                      value={
                                        v === undefined
                                          ? ''
                                          : isPct
                                          ? +(Number(v) * 100).toFixed(2)
                                          : v
                                      }
                                      placeholder={String(ph)}
                                      title={
                                        d.months[idx]?.fromMtd && v === undefined
                                          ? 'Actual from the P&L'
                                          : undefined
                                      }
                                      onChange={(e) => {
                                        const nextVal =
                                          e.target.value === ''
                                            ? undefined
                                            : isPct
                                            ? Number(e.target.value) / 100
                                            : Number(e.target.value);
                                        const nextMo: PfDivMonthOverride = { ...mo };
                                        const nextFieldMap = { ...(nextMo[f] || {}) };
                                        if (nextVal === undefined) delete nextFieldMap[k];
                                        else nextFieldMap[k] = nextVal;
                                        if (Object.keys(nextFieldMap).length) {
                                          nextMo[f] = nextFieldMap;
                                        } else {
                                          delete nextMo[f];
                                        }
                                        onUpdateDivOverride(
                                          c,
                                          null,
                                          Object.keys(nextMo).length ? nextMo : {}
                                        );
                                      }}
                                      className={`w-24 rounded border px-2 py-1 text-right font-mono text-xs tabular-nums ${
                                        v !== undefined
                                          ? 'border-[#0F293A] bg-slate-50 font-semibold'
                                          : 'border-slate-300 bg-white'
                                      }`}
                                    />
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                        {hasWo && (
                          <tr className="bg-slate-50/70 text-slate-600">
                            <td className="px-3 py-1.5">
                              {svc ? 'Service GP' : 'Work order GP'}
                            </td>
                            <td />
                            {d.months.map((m, idx) => (
                              <td
                                key={idx}
                                className="px-3 py-1.5 text-right font-mono tabular-nums"
                              >
                                {pfMoney(m.woGP)}
                              </td>
                            ))}
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Monthly Cash Engine & Job Cash Position */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Monthly cash &amp; job billing model
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {cash
                  ? cash.anchorOk
                    ? `Cash positions start from AR and AP as of ${mLong(cash.anchor)}. Click any "Collected on jobs" or "Paid on jobs" cell to inspect invoice & pay-app details.`
                    : `AR/AP month (${mLong(cash.anchor)}) differs from the WIP month; verify AR/AP dates above.`
                  : 'Drop AR aging and AP aging workbooks to model monthly job cash & line of credit.'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 text-xs">
              <label className="block">
                <span className="block text-[11px] font-medium text-slate-600">
                  Owners pay in (days)
                </span>
                <input
                  type="number"
                  value={cashSettings.collectDays ?? 55}
                  onChange={(e) =>
                    onUpdateGlobal({
                      cash: {
                        ...cashSettings,
                        collectDays: Math.max(0, Number(e.target.value) || 55),
                      },
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs tabular-nums"
                />
              </label>

              <label className="block">
                <span className="block text-[11px] font-medium text-slate-600">
                  Billed on day
                </span>
                <input
                  type="number"
                  min="1"
                  max="28"
                  value={cashSettings.billDay ?? 20}
                  onChange={(e) =>
                    onUpdateGlobal({
                      cash: {
                        ...cashSettings,
                        billDay: Math.min(28, Math.max(1, Number(e.target.value) || 20)),
                      },
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs tabular-nums"
                />
              </label>

              <label className="block">
                <span className="block text-[11px] font-medium text-slate-600">
                  Billed-ahead hold (% comp)
                </span>
                <input
                  type="number"
                  min="0"
                  max="95"
                  step="5"
                  value={Math.round((Number(cashSettings.obHold) || 0) * 100)}
                  onChange={(e) =>
                    onUpdateGlobal({
                      cash: {
                        ...cashSettings,
                        obHold:
                          Math.min(95, Math.max(0, Number(e.target.value) || 0)) / 100,
                      },
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs tabular-nums"
                />
              </label>

              <label className="block">
                <span className="block text-[11px] font-medium text-slate-600">
                  Materials held (% PWP)
                </span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="5"
                  value={Math.round((Number(cashSettings.matsPWP) || 0) * 100)}
                  onChange={(e) =>
                    onUpdateGlobal({
                      cash: {
                        ...cashSettings,
                        matsPWP:
                          Math.min(100, Math.max(0, Number(e.target.value) || 0)) / 100,
                      },
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs tabular-nums"
                />
              </label>

              <label className="block">
                <span className="block text-[11px] font-medium text-slate-600">
                  Bank at AR/AP date ($)
                </span>
                <input
                  type="number"
                  step="1000"
                  value={cashSettings.bank === undefined ? '' : cashSettings.bank}
                  placeholder="neg = LOC drawn"
                  onChange={(e) =>
                    onUpdateGlobal({
                      cash: {
                        ...cashSettings,
                        bank: e.target.value === '' ? '' : Number(e.target.value),
                      },
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs tabular-nums"
                />
              </label>

              <label className="flex items-center gap-2 pt-5 font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cashSettings.subsPWP !== false}
                  onChange={(e) =>
                    onUpdateGlobal({
                      cash: { ...cashSettings, subsPWP: e.target.checked },
                    })
                  }
                  className="rounded border-slate-300"
                />
                <span>Subs paid when paid</span>
              </label>
            </div>

            {cash && monthlyCashModel && (
              <>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr className="border-b border-slate-200">
                        <th className="px-3 py-2 font-semibold">Monthly Cash Summary</th>
                        {cash.months.map((k) => (
                          <th key={k} className="px-3 py-2 text-right font-semibold">
                            {mLabel(k)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      <tr>
                        <td className="px-3 py-2 text-slate-700">Collected on jobs</td>
                        {cash.company.map((x) => (
                          <td
                            key={x.k}
                            onClick={() => openMonthlyCashDrill('cin', x.k)}
                            title="Inspect collected invoices and pay apps"
                            className="cursor-pointer px-3 py-2 text-right font-mono text-[#0F293A] underline decoration-dotted hover:bg-slate-50 tabular-nums"
                          >
                            {pfMoney(x.jobsIn)}
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td className="px-3 py-2 text-slate-700">Paid on jobs</td>
                        {cash.company.map((x) => (
                          <td
                            key={x.k}
                            onClick={() => openMonthlyCashDrill('cout', x.k)}
                            title="Inspect vendor & labor disbursements"
                            className="cursor-pointer px-3 py-2 text-right font-mono text-[#0F293A] underline decoration-dotted hover:bg-slate-50 tabular-nums"
                          >
                            {pfMoney(-x.jobsOut)}
                          </td>
                        ))}
                      </tr>
                      <tr className="text-slate-500">
                        <td className="px-3 py-1.5">Work order and likely job profit</td>
                        {cash.company.map((x) => (
                          <td key={x.k} className="px-3 py-1.5 text-right font-mono tabular-nums">
                            {pfMoney(x.wo)}
                          </td>
                        ))}
                      </tr>
                      <tr className="text-slate-500">
                        <td className="px-3 py-1.5">Overhead (from the P&amp;L)</td>
                        {cash.company.map((x) => (
                          <td key={x.k} className="px-3 py-1.5 text-right font-mono tabular-nums">
                            {pfMoney(-x.oh)}
                          </td>
                        ))}
                      </tr>
                      <tr className="text-slate-500">
                        <td className="px-3 py-1.5">Depreciation added back (not cash)</td>
                        {cash.months.map((k) => (
                          <td key={k} className="px-3 py-1.5 text-right font-mono tabular-nums">
                            {pfMoney(monthlyCashModel.w.dep)}
                          </td>
                        ))}
                      </tr>
                      <tr className="text-slate-500">
                        <td className="px-3 py-1.5">Vehicle loan principal</td>
                        {cash.months.map((k) => (
                          <td key={k} className="px-3 py-1.5 text-right font-mono tabular-nums">
                            {pfMoney(-monthlyCashModel.w.principal)}
                          </td>
                        ))}
                      </tr>
                      {monthlyCashModel.lp && (
                        <tr className="text-slate-500">
                          <td className="px-3 py-1.5">
                            Interest at current balances, beyond P&amp;L
                          </td>
                          {cash.months.map((k) => {
                            const intV = -(monthlyCashModel.lp?.interest[k] || 0);
                            return (
                              <td
                                key={k}
                                className="px-3 py-1.5 text-right font-mono tabular-nums"
                              >
                                {pfMoney(intV)}
                              </td>
                            );
                          })}
                        </tr>
                      )}
                      <tr className="bg-slate-50 font-semibold">
                        <td className="px-3 py-2 text-slate-900">Net cash for the month</td>
                        {cash.company.map((x) => {
                          const net =
                            x.net +
                            monthlyCashModel.adj -
                            (monthlyCashModel.lp?.interest[x.k] || 0);
                          return (
                            <td
                              key={x.k}
                              className={`px-3 py-2 text-right font-mono tabular-nums ${
                                net < -0.5 ? 'text-red-700' : 'text-slate-900'
                              }`}
                            >
                              {pfMoney(net)}
                            </td>
                          );
                        })}
                      </tr>
                      {monthlyCashModel.lp && (
                        <>
                          <tr className="bg-[#0F293A] text-white font-semibold">
                            <td className="px-3 py-2">Line of credit balance</td>
                            {cash.months.map((k) => {
                              const idx = forecast.M.months.indexOf(k);
                              const v = idx >= 0 ? monthlyCashModel.lp?.vals[idx] ?? null : null;
                              return (
                                <td
                                  key={k}
                                  className="px-3 py-2 text-right font-mono tabular-nums"
                                >
                                  {v === null ? '—' : pfMoney(v)}
                                </td>
                              );
                            })}
                          </tr>
                          <tr className="font-semibold">
                            <td className="px-3 py-2 text-slate-700">
                              Available on the {pfMoney(monthlyCashModel.w.limit)} line
                            </td>
                            {cash.months.map((k) => {
                              const idx = forecast.M.months.indexOf(k);
                              const v = idx >= 0 ? monthlyCashModel.lp?.vals[idx] ?? null : null;
                              const av = v === null ? null : monthlyCashModel.w.limit - v;
                              return (
                                <td
                                  key={k}
                                  className={`px-3 py-2 text-right font-mono tabular-nums ${
                                    av !== null && av < 0 ? 'text-red-700' : 'text-slate-900'
                                  }`}
                                >
                                  {av === null ? '' : pfMoney(av)}
                                </td>
                              );
                            })}
                          </tr>
                        </>
                      )}
                      <tr className="text-slate-500">
                        <td className="px-3 py-1.5">Net overbilled at month end</td>
                        {cash.months.map((k, idx) => {
                          const ouSum = cash.jobs.reduce(
                            (a, x) => a + (x.months[idx]?.ou || 0),
                            0
                          );
                          return (
                            <td
                              key={k}
                              className={`px-3 py-1.5 text-right font-mono tabular-nums ${
                                ouSum < -0.5 ? 'text-red-700' : ''
                              }`}
                            >
                              {pfMoney(ouSum)}
                            </td>
                          );
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Cash Position by Job */}
                <div>
                  <h3 className="mb-1 text-xs font-semibold text-slate-900">
                    Cash position by job
                  </h3>
                  <p className="mb-2 text-[11px] text-slate-500">
                    Cash in minus cash out, matching Spectrum&apos;s &quot;Net cash flow&quot;.
                    Target is profit earned so far (% complete × profit). Worst gap first.
                  </p>
                  <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-[380px]">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead className="sticky top-0 bg-slate-100 text-slate-700">
                        <tr className="border-b border-slate-200">
                          <th className="px-2.5 py-2 font-semibold">Job</th>
                          <th className="px-2.5 py-2 font-semibold">Name</th>
                          <th className="px-2.5 py-2 text-right font-semibold">Done</th>
                          <th className="px-2.5 py-2 text-right font-semibold whitespace-nowrap">
                            Cash at {cash.anchor ? `${mLabel(cash.anchor)} end` : 'start'}
                          </th>
                          <th className="px-2.5 py-2 text-right font-semibold">Target</th>
                          <th className="px-2.5 py-2 text-right font-semibold">Gap</th>
                          <th className="px-2.5 py-2 text-right font-semibold">Open AR</th>
                          <th className="px-2.5 py-2 text-right font-semibold">Open AP</th>
                          {cash.months.map((k) => (
                            <th
                              key={k}
                              className="px-2.5 py-2 text-right font-semibold whitespace-nowrap"
                            >
                              {mLabel(k)}
                            </th>
                          ))}
                          <th className="px-2.5 py-2 text-right font-semibold bg-slate-200/60">
                            End of job
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {monthlyCashModel.sortedJobs.map((x) => {
                          const gap = x.pos0 - x.target0;
                          return (
                            <tr
                              key={x.key}
                              onClick={() => onEditJob(x.key)}
                              className="cursor-pointer hover:bg-slate-50"
                            >
                              <td className="px-2.5 py-2 font-mono font-semibold text-slate-900 tabular-nums">
                                {x.f.job.job}
                              </td>
                              <td className="px-2.5 py-2 text-slate-800 max-w-[200px] truncate">
                                {x.f.job.name}
                              </td>
                              <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                                {pfPct(x.f.pctStart, 0)}
                              </td>
                              <td
                                className={`px-2.5 py-2 text-right font-mono tabular-nums ${
                                  x.pos0 < -0.5 ? 'text-red-700' : ''
                                }`}
                              >
                                {pfMoney(x.pos0)}
                              </td>
                              <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                                {pfMoney(x.target0)}
                              </td>
                              <td
                                className={`px-2.5 py-2 text-right font-mono font-medium tabular-nums ${
                                  gap < -0.5 ? 'text-red-700' : ''
                                }`}
                              >
                                {pfMoney(gap)}
                              </td>
                              <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                                {pfMoney(x.arOpen)}
                              </td>
                              <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                                {pfMoney(x.apOpen)}
                              </td>
                              {x.months.map((m) => (
                                <td
                                  key={m.k}
                                  className={`px-2.5 py-2 text-right font-mono tabular-nums ${
                                    m.pos < -0.5 ? 'text-red-700' : ''
                                  }`}
                                >
                                  {pfMoney(m.pos)}
                                </td>
                              ))}
                              <td
                                className={`px-2.5 py-2 text-right font-mono font-semibold bg-slate-50/70 tabular-nums ${
                                  x.endProfit < -0.5 ? 'text-red-700' : ''
                                }`}
                              >
                                {pfMoney(x.endProfit)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};
