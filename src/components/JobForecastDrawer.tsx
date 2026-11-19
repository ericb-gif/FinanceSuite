import React, { useEffect } from 'react';
import { AlertTriangle, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import {
  DEPTS,
  defaultMode,
  gutDollars,
  gutOf,
  mLabel,
  mLong,
  pfMoney,
  pfPct,
} from '../lib/profitForecastEngine';
import type {
  PfAdjustment,
  PfCashResult,
  PfForecastResult,
  PfJobSetting,
  PfState,
} from '../types/profitForecast';

interface JobForecastDrawerProps {
  jobKey: string | null;
  state: PfState;
  forecast: PfForecastResult | null;
  cash: PfCashResult | null;
  onClose: () => void;
  onUpdateJobSetting: (key: string, patch: Partial<PfJobSetting>) => void;
  onResetJobSetting: (key: string) => void;
}

export const JobForecastDrawer: React.FC<JobForecastDrawerProps> = ({
  jobKey,
  state,
  forecast,
  cash,
  onClose,
  onUpdateJobSetting,
  onResetJobSetting,
}) => {
  useEffect(() => {
    if (!jobKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [jobKey, onClose]);

  if (!jobKey || !forecast || !state.wip) return null;

  const f = forecast.jobs.find((x) => x.key === jobKey);
  if (!f) return null;

  const j = f.job;
  const s: PfJobSetting = state.settings.jobs[f.key] || {};
  const defMode = defaultMode(j, state.settings);
  const mode = s.mode && s.mode !== 'tm' ? s.mode : defMode;
  const months = forecast.M.months;
  const g = gutOf(f, state.settings);
  const gutDir = s.gut || (g ? g.dir : '');
  const gutPts = g ? g.pts : 0;
  const gutDollar = gutDollars(f, state.settings);
  const finalGpPct =
    f.gpNow === null
      ? null
      : f.gpNow + ((gutDir === 'gain' ? 1 : gutDir === 'fade' ? -1 : 0) * gutPts) / 100;

  const wipGP = j.contract - j.pcost;
  const fGP = f.Cfinal - f.finalCost;

  const stampDate = () =>
    new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const setGut = (dir: 'gain' | 'flat' | 'fade', pts: number) => {
    if (f.gpNow === null) {
      onUpdateJobSetting(f.key, { gut: dir });
      return;
    }
    if (dir === 'flat') {
      onUpdateJobSetting(f.key, {
        gut: 'flat',
        targetGP: null,
        gutAt: stampDate(),
        gutBase: f.gpNow,
      });
      return;
    }
    const p = Math.max(0, Number(pts) || 0);
    onUpdateJobSetting(f.key, {
      gut: dir,
      targetGP: p ? f.gpNow + ((dir === 'gain' ? 1 : -1) * p) / 100 : null,
      gutAt: stampDate(),
      gutBase: f.gpNow,
    });
  };

  const cos: PfAdjustment[] = Array.isArray(s.cos) ? s.cos : [];
  const updateCos = (next: PfAdjustment[]) => {
    onUpdateJobSetting(f.key, { cos: next.length ? next : undefined });
  };

  const cashJob = cash?.jobs.find((x) => x.key === f.key) || null;
  const anchorText =
    state.ar?.asOf || state.ap?.asOf
      ? `${mLong((state.ar?.asOf || state.ap?.asOf) as string)} end`
      : 'the AR/AP date';

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40"
      role="dialog"
      aria-modal="true"
      aria-label={`${j.job} ${j.name}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full w-full max-w-3xl flex-col border-l border-slate-200 bg-white shadow-2xl">
        {/* Drawer Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <div className="text-base font-bold text-slate-900">
              {j.job} · {j.name}
            </div>
            <div className="mt-0.5 text-xs text-slate-500 tabular-nums">
              {DEPTS[j.dept] || j.dept} · Contract {pfMoney(j.contract)} · Cost to date{' '}
              {pfMoney(f.jtdStart)} · {f.tm ? 'T&M' : `${pfPct(f.pctStart, 1)} complete`}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close job forecast editor"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 text-xs">
          {/* Diagnostic Flags */}
          {f.flags.length > 0 && (
            <div className="space-y-2">
              {f.flags.map((fl, idx) => {
                const isRed = fl.type === 'over' || fl.type === 'loss';
                let text = '';
                if (fl.type === 'over') {
                  text = `Cost to date is ${pfMoney(fl.amt)} past the WIP's projected total cost. The estimate is raised to at least cost to date, which books that fade in ${mLong(months[0])}.`;
                } else if (fl.type === 'loss') {
                  text = `Projected loss of ${pfMoney(-(fl.amt || 0))} on this job.`;
                } else if (fl.type === 'nofinish') {
                  text = "No finish month set, so it's using last month's pace for now.";
                } else if (fl.type === 'pastfinish') {
                  text = 'The finish month has passed but cost is left; it all lands in the first forecast month.';
                } else if (fl.type === 'norate') {
                  text = 'No recent cost to set a pace, so the remaining cost is spread over 3 months.';
                }
                return (
                  <div
                    key={idx}
                    className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 ${
                      isRed
                        ? 'border-red-200 bg-red-50 text-red-900'
                        : 'border-amber-200 bg-amber-50 text-amber-900'
                    }`}
                  >
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{text}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Contract Type */}
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Contract Type
            </div>
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
              <button
                type="button"
                onClick={() => onUpdateJobSetting(f.key, { tm: null })}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  !f.tm ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Fixed price
              </button>
              <button
                type="button"
                onClick={() => onUpdateJobSetting(f.key, { tm: true })}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  f.tm ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                T&amp;M
              </button>
            </div>
          </div>

          {f.tm ? (
            <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <div className="text-[11px] text-slate-500">
                    Earned to date ({state.wip.asOf ? mLabel(state.wip.asOf) : ''} WIP)
                  </div>
                  <div className="mt-0.5 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                    {pfMoney(f.earned0)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">JTD profit %</div>
                  <div className="mt-0.5 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                    {pfPct(f.tmHist)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Profit % used</div>
                  <div className="mt-0.5 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                    {pfPct(f.tmPct)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Monthly cost</div>
                  <div className="mt-0.5 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                    {pfMoney(f.rate)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="block text-[11px] font-medium text-slate-600">Profit %</span>
                  <input
                    type="number"
                    step="0.5"
                    value={
                      s.tmPct !== undefined && s.tmPct !== null ? +(s.tmPct * 100).toFixed(2) : ''
                    }
                    placeholder={((f.tmHist || 0) * 100).toFixed(1)}
                    onChange={(e) =>
                      onUpdateJobSetting(f.key, {
                        tmPct: e.target.value === '' ? null : Number(e.target.value) / 100,
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums"
                  />
                </label>
                <label className="block">
                  <span className="block text-[11px] font-medium text-slate-600">Monthly cost</span>
                  <input
                    type="number"
                    step="1000"
                    value={s.rate !== undefined && s.rate !== null ? s.rate : ''}
                    placeholder={String(Math.round(f.rate || 0))}
                    onChange={(e) =>
                      onUpdateJobSetting(f.key, {
                        rate: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums"
                  />
                </label>
                <label className="block">
                  <span className="block text-[11px] font-medium text-slate-600">Ends</span>
                  <input
                    type="month"
                    value={s.finish || ''}
                    onChange={(e) => onUpdateJobSetting(f.key, { finish: e.target.value || null })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                </label>
              </div>
              <p className="text-[11px] text-slate-500">
                T&amp;M: every dollar of cost earns revenue at the profit %, so there is no fixed
                contract, % complete or fade. Leave Ends blank if work keeps going.
              </p>
            </div>
          ) : (
            <>
              {/* On WIP vs Forecast */}
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr className="border-b border-slate-200">
                      <th className="px-3 py-2 font-semibold">Contract Summary</th>
                      <th className="px-3 py-2 text-right font-semibold">On the WIP</th>
                      <th className="px-3 py-2 text-right font-semibold">Forecast</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr>
                      <td className="px-3 py-2 text-slate-600">Contract</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {pfMoney(j.contract)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-medium tabular-nums">
                        {pfMoney(f.Cfinal)}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-slate-600">Projected cost</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {pfMoney(j.pcost)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-medium tabular-nums">
                        {pfMoney(f.finalCost)}
                      </td>
                    </tr>
                    <tr className="bg-slate-50/70 font-semibold">
                      <td className="px-3 py-2 text-slate-900">Gross profit</td>
                      <td
                        className={`px-3 py-2 text-right font-mono tabular-nums ${
                          wipGP < -0.5 ? 'text-red-700' : 'text-slate-900'
                        }`}
                      >
                        {pfMoney(wipGP)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono tabular-nums ${
                          fGP < -0.5 ? 'text-red-700' : 'text-slate-900'
                        }`}
                      >
                        {pfMoney(fGP)}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-slate-600">GP %</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {pfPct(f.gpWip)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-medium tabular-nums">
                        {pfPct(f.gpFinal)}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-slate-500">Cost left</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-500 tabular-nums">
                        {pfMoney(Math.max(0, j.pcost - f.jtdStart))}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-600 tabular-nums">
                        {pfMoney(f.remaining)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {f.coCount > 0 && (
                <p className="text-[11px] text-slate-600">
                  Forecast includes adjustments not on the WIP: {pfMoney(f.coRev)} of revenue and{' '}
                  {pfMoney(f.coCost)} of cost.
                </p>
              )}

              {/* Cost Spread Controls */}
              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  How cost lands each month
                </div>
                <div className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-slate-100 p-0.5">
                  {(
                    [
                      ['auto', "Last month's pace"],
                      ['even', 'Even to finish'],
                      ['peak', 'Peak to finish'],
                    ] as const
                  ).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() =>
                        onUpdateJobSetting(f.key, {
                          mode: val === defMode && !s.mode ? null : val,
                        })
                      }
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        mode === val
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="block text-[11px] font-medium text-slate-600">
                      Finish month
                    </span>
                    <input
                      type="month"
                      value={s.finish || ''}
                      onChange={(e) => onUpdateJobSetting(f.key, { finish: e.target.value || null })}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[11px] font-medium text-slate-600">
                      Monthly pace ($)
                    </span>
                    <input
                      type="number"
                      step="1000"
                      value={s.rate !== undefined && s.rate !== null ? s.rate : ''}
                      placeholder={
                        f.rate !== null && f.rate !== undefined
                          ? String(Math.round(f.rate))
                          : 'none'
                      }
                      onChange={(e) =>
                        onUpdateJobSetting(f.key, {
                          rate: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums"
                    />
                  </label>
                </div>
                <p className="text-[11px] text-slate-500">
                  {mode === 'peak'
                    ? 'Peak puts cost on an S-curve: it ramps up to the middle of the job and tails off at the end, starting from where the job is now.'
                    : mode === 'even'
                    ? 'Even splits the cost left equally through the finish month.'
                    : "Pace repeats last month's cost until the cost left is used up. Type a monthly pace to override it."}
                </p>
              </div>

              {/* Sven's Gut Check */}
              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Sven&apos;s gut check
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <div>
                    <div className="text-[11px] text-slate-500">Current job profit %</div>
                    <div className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
                      {pfPct(f.gpNow)}
                    </div>
                  </div>
                  <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
                    {(
                      [
                        ['gain', '▲ Gain'],
                        ['flat', '– Flat'],
                        ['fade', '▼ Fade'],
                      ] as const
                    ).map(([dirVal, label]) => (
                      <button
                        key={dirVal}
                        type="button"
                        onClick={() =>
                          setGut(dirVal, g && g.dir !== 'flat' ? g.pts : 0)
                        }
                        className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                          gutDir === dirVal
                            ? dirVal === 'gain'
                              ? 'bg-emerald-700 text-white'
                              : dirVal === 'fade'
                              ? 'bg-red-700 text-white'
                              : 'bg-slate-800 text-white'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <label className={gutDir === 'gain' || gutDir === 'fade' ? '' : 'opacity-40'}>
                    <span className="mr-1.5 text-[11px] font-medium text-slate-600">by pts</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      disabled={gutDir !== 'gain' && gutDir !== 'fade'}
                      value={
                        gutDir === 'gain' || gutDir === 'fade' ? +gutPts.toFixed(2) : ''
                      }
                      onChange={(e) =>
                        setGut(
                          gutDir === 'gain' || gutDir === 'fade' ? gutDir : 'fade',
                          Number(e.target.value)
                        )
                      }
                      className="w-20 rounded-lg border border-slate-300 bg-white px-2 py-1 font-mono text-xs tabular-nums"
                    />
                  </label>
                  <div>
                    <div className="text-[11px] text-slate-500">Final GP %</div>
                    <div className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
                      {pfPct(finalGpPct)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Profit change</div>
                    <div
                      className={`font-mono text-sm font-semibold tabular-nums ${
                        gutDollar < -0.5
                          ? 'text-red-700'
                          : gutDollar > 0.5
                          ? 'text-emerald-700'
                          : 'text-slate-900'
                      }`}
                    >
                      {pfMoney(gutDollar)}
                    </div>
                  </div>
                </div>

                <label className="block">
                  <span className="block text-[11px] font-medium text-slate-600">Why</span>
                  <input
                    type="text"
                    value={s.gutNote || ''}
                    placeholder="What Sven is seeing on the job"
                    onChange={(e) => onUpdateJobSetting(f.key, { gutNote: e.target.value || null })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                </label>

                {s.gutAt && (
                  <p className="text-[11px] text-slate-500">
                    Last set {s.gutAt}
                    {s.gutBase !== undefined && s.gutBase !== null
                      ? `, when the WIP had this job at ${pfPct(s.gutBase)}`
                      : ''}
                    . The final GP % is saved as a target number, so when next month&apos;s WIP
                    catches up, the points shrink instead of double-counting fade.
                  </p>
                )}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="block text-[11px] font-medium text-slate-600">Booked</span>
                    <select
                      value={s.fadeMode === 'gradual' ? 'gradual' : 'once'}
                      onChange={(e) =>
                        onUpdateJobSetting(f.key, {
                          fadeMode: e.target.value === 'once' ? null : 'gradual',
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                    >
                      <option value="once">All at once in</option>
                      <option value="gradual">
                        Gradually through {s.finish ? mLong(s.finish) : 'the last month shown'}
                      </option>
                    </select>
                  </label>
                  <label className={s.fadeMode === 'gradual' ? 'opacity-40' : ''}>
                    <span className="block text-[11px] font-medium text-slate-600">Month</span>
                    <select
                      disabled={s.fadeMode === 'gradual'}
                      value={s.fadeMonth || months[0]}
                      onChange={(e) => onUpdateJobSetting(f.key, { fadeMonth: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                    >
                      {months.map((mk) => (
                        <option key={mk} value={mk}>
                          {mLong(mk)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              {/* Change Orders & Scope Adjustments */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Adjustments to final revenue and cost
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      Change orders, scope updates, or estimate changes added from the selected book
                      month. Remove once incorporated in Spectrum WIP.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      updateCos([
                        ...cos,
                        {
                          id: `co${Date.now().toString(36)}`,
                          desc: '',
                          value: '',
                          cost: '',
                          month: months[0],
                        },
                      ])
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add adjustment
                  </button>
                </div>

                {cos.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead className="bg-slate-100 text-slate-700">
                        <tr className="border-b border-slate-200">
                          <th className="px-2.5 py-2 font-semibold">Adjustment</th>
                          <th className="px-2.5 py-2 text-right font-semibold">Revenue</th>
                          <th className="px-2.5 py-2 text-right font-semibold">Cost</th>
                          <th className="px-2.5 py-2 text-right font-semibold">Profit</th>
                          <th className="px-2.5 py-2 font-semibold">Book in</th>
                          <th className="px-2 py-2" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {cos.map((c, idx) => {
                          const pVal = (Number(c.value) || 0) - (Number(c.cost) || 0);
                          return (
                            <tr key={c.id || idx}>
                              <td className="px-2.5 py-1.5">
                                <input
                                  type="text"
                                  value={c.desc || ''}
                                  placeholder="Change order / scope update"
                                  onChange={(e) => {
                                    const next = cos.map((row, rIdx) =>
                                      rIdx === idx ? { ...row, desc: e.target.value } : row
                                    );
                                    updateCos(next);
                                  }}
                                  className="w-44 rounded border border-slate-300 px-2 py-1 text-xs"
                                />
                              </td>
                              <td className="px-2.5 py-1.5 text-right">
                                <input
                                  type="number"
                                  step="1000"
                                  value={c.value === '' ? '' : c.value}
                                  placeholder="0"
                                  onChange={(e) => {
                                    const val: number | '' =
                                      e.target.value === '' ? '' : Number(e.target.value);
                                    const next = cos.map((row, rIdx) =>
                                      rIdx === idx ? { ...row, value: val } : row
                                    );
                                    updateCos(next);
                                  }}
                                  className="w-24 rounded border border-slate-300 px-2 py-1 text-right font-mono text-xs tabular-nums"
                                />
                              </td>
                              <td className="px-2.5 py-1.5 text-right">
                                <input
                                  type="number"
                                  step="1000"
                                  value={c.cost === '' ? '' : c.cost}
                                  placeholder="0"
                                  onChange={(e) => {
                                    const val: number | '' =
                                      e.target.value === '' ? '' : Number(e.target.value);
                                    const next = cos.map((row, rIdx) =>
                                      rIdx === idx ? { ...row, cost: val } : row
                                    );
                                    updateCos(next);
                                  }}
                                  className="w-24 rounded border border-slate-300 px-2 py-1 text-right font-mono text-xs tabular-nums"
                                />
                              </td>
                              <td
                                className={`px-2.5 py-1.5 text-right font-mono tabular-nums ${
                                  pVal < -0.5 ? 'text-red-700' : 'text-slate-900'
                                }`}
                              >
                                {pfMoney(pVal)}
                              </td>
                              <td className="px-2.5 py-1.5">
                                <select
                                  value={c.month && months.includes(c.month) ? c.month : months[0]}
                                  onChange={(e) => {
                                    const next = cos.map((row, rIdx) =>
                                      rIdx === idx ? { ...row, month: e.target.value } : row
                                    );
                                    updateCos(next);
                                  }}
                                  className="rounded border border-slate-300 px-2 py-1 text-xs"
                                >
                                  {months.map((mk) => (
                                    <option key={mk} value={mk}>
                                      {mLabel(mk)}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-2 py-1.5 text-right">
                                <button
                                  type="button"
                                  aria-label="Remove adjustment"
                                  onClick={() => updateCos(cos.filter((_, rIdx) => rIdx !== idx))}
                                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-700"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold">
                        <tr>
                          <td className="px-2.5 py-1.5">Total</td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                            {pfMoney(f.coRev)}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                            {pfMoney(f.coCost)}
                          </td>
                          <td
                            className={`px-2.5 py-1.5 text-right font-mono tabular-nums ${
                              f.coRev - f.coCost < -0.5 ? 'text-red-700' : 'text-slate-900'
                            }`}
                          >
                            {pfMoney(f.coRev - f.coCost)}
                          </td>
                          <td colSpan={2} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}

          {/* By Month Projection Table */}
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              By month
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-slate-100 text-slate-700">
                  <tr className="border-b border-slate-200">
                    <th className="px-2.5 py-2 font-semibold">Month</th>
                    <th className="px-2.5 py-2 text-right font-semibold">% complete</th>
                    <th className="px-2.5 py-2 text-right font-semibold">Earned to date</th>
                    <th className="px-2.5 py-2 text-right font-semibold">Revenue</th>
                    <th className="px-2.5 py-2 text-right font-semibold">Cost</th>
                    <th className="px-2.5 py-2 text-right font-semibold">Profit</th>
                    <th className="px-2.5 py-2 text-right font-semibold">GP %</th>
                    <th className="px-2.5 py-2 text-right font-semibold">1 pt fade</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr className="bg-slate-50 text-slate-600">
                    <td className="px-2.5 py-2 font-medium">
                      {state.wip.asOf ? mLong(state.wip.asOf) : ''} WIP
                    </td>
                    <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                      {pfPct(j.pcost > 0 ? j.act / j.pcost : null)}
                    </td>
                    <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                      {pfMoney(f.earned0)}
                    </td>
                    <td colSpan={5} />
                  </tr>
                  {f.months.map((m) => (
                    <tr key={m.k} className="hover:bg-slate-50/70">
                      <td className="px-2.5 py-2 font-medium text-slate-900">
                        {mLong(m.k)}
                        {m.actual && (
                          <span className="ml-1.5 text-[10px] font-medium text-emerald-700">
                            actual
                          </span>
                        )}
                      </td>
                      <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                        {f.tm ? (
                          <span className="text-slate-400">—</span>
                        ) : m.actual ? (
                          <span className="text-slate-600">{pfPct(m.pct)}</span>
                        ) : (
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            max="100"
                            value={m.pctOv !== null ? +(m.pctOv * 100).toFixed(2) : ''}
                            placeholder={m.pct !== null ? (m.pct * 100).toFixed(1) : ''}
                            onChange={(e) => {
                              const nextPct = { ...(s.pct || {}) };
                              if (e.target.value === '') delete nextPct[m.k];
                              else nextPct[m.k] = Number(e.target.value) / 100;
                              onUpdateJobSetting(f.key, {
                                pct: Object.keys(nextPct).length ? nextPct : null,
                              });
                            }}
                            className="w-16 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-right font-mono text-xs tabular-nums"
                          />
                        )}
                      </td>
                      <td className="px-2.5 py-2 text-right font-mono text-slate-500 tabular-nums">
                        {pfMoney(m.earned)}
                      </td>
                      <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                        {pfMoney(m.rev)}
                      </td>
                      <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                        {pfMoney(m.cost)}
                      </td>
                      <td
                        className={`px-2.5 py-2 text-right font-mono font-semibold tabular-nums ${
                          m.gp < -0.5 ? 'text-red-700' : 'text-slate-900'
                        }`}
                      >
                        {pfMoney(m.gp)}
                      </td>
                      <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                        {m.rev > 0 ? pfPct(m.gp / m.rev) : '—'}
                      </td>
                      <td className="px-2.5 py-2 text-right font-mono text-slate-500 tabular-nums">
                        {f.tm ? '—' : pfMoney(j.contract * 0.01 * Math.min(1, m.pct || 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Job Cash Schedule */}
          {cashJob && (
            <div className="space-y-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Cash Position &amp; Collection Curve
              </div>
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 sm:grid-cols-4">
                <div>
                  <div className="text-[11px] text-slate-500">Cash at {anchorText}</div>
                  <div
                    className={`font-mono text-sm font-semibold tabular-nums ${
                      cashJob.pos0 < -0.5 ? 'text-red-700' : 'text-slate-900'
                    }`}
                  >
                    {pfMoney(cashJob.pos0)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Profit earned (target)</div>
                  <div className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
                    {pfMoney(cashJob.target0)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Open AR</div>
                  <div className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
                    {pfMoney(cashJob.arOpen)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Open AP</div>
                  <div className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
                    {pfMoney(cashJob.apOpen)}
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr className="border-b border-slate-200">
                      <th className="px-2.5 py-2 font-semibold">Month</th>
                      <th className="px-2.5 py-2 text-right font-semibold">Collected</th>
                      <th className="px-2.5 py-2 text-right font-semibold">Paid</th>
                      <th className="px-2.5 py-2 text-right font-semibold">Cash position</th>
                      <th className="px-2.5 py-2 text-right font-semibold">Target</th>
                      <th className="px-2.5 py-2 text-right font-semibold">Over/(under) billed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {cashJob.months.map((m) => (
                      <tr key={m.k} className="hover:bg-slate-50/70">
                        <td className="px-2.5 py-1.5 font-medium">{mLong(m.k)}</td>
                        <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                          {pfMoney(m.cin)}
                        </td>
                        <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                          {pfMoney(-m.cout)}
                        </td>
                        <td
                          className={`px-2.5 py-1.5 text-right font-mono font-medium tabular-nums ${
                            m.pos < -0.5 ? 'text-red-700' : 'text-slate-900'
                          }`}
                        >
                          {pfMoney(m.pos)}
                        </td>
                        <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                          {pfMoney(m.target)}
                        </td>
                        <td
                          className={`px-2.5 py-1.5 text-right font-mono tabular-nums ${
                            m.ou < -0.5 ? 'text-red-700' : 'text-slate-900'
                          }`}
                        >
                          {pfMoney(m.ou)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-slate-500">
                Cash at the end of the job equals the job&apos;s profit:{' '}
                {pfMoney(cashJob.endProfit)}.
                {cashJob.later > 1
                  ? ` ${pfMoney(cashJob.later)} more nets in after the last month shown.`
                  : ''}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-3.5">
          <button
            type="button"
            onClick={() => onResetJobSetting(f.key)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset this job
          </button>
          <span className="text-xs text-slate-500">Changes save automatically</span>
        </div>
      </div>
    </div>
  );
};
