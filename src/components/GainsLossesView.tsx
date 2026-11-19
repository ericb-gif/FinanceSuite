import React, { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { fmtMoney, fmtMoney2, fmtPct } from '../lib/formatters';
import { DIVISIONS } from '../lib/wipEngine';
import type { DivisionCode, GainsLossesRow } from '../types/wip';

interface GainsLossesViewProps {
  rows: GainsLossesRow[];
  period: string;
  priorPeriod: string;
}

export const GainsLossesView: React.FC<GainsLossesViewProps> = ({
  rows,
  period,
  priorPeriod,
}) => {
  const [filterClass, setFilterClass] = useState<'all' | GainsLossesRow['classification']>('all');
  const [divisionFilter, setDivisionFilter] = useState('');

  const matchedCount = useMemo(() => rows.filter((r) => r.hasPrior).length, [rows]);

  const totalGain = useMemo(
    () =>
      rows
        .filter((r) => r.profitGainLoss > 0)
        .reduce((s, r) => s + r.profitGainLoss, 0),
    [rows]
  );

  const totalLoss = useMemo(
    () =>
      rows
        .filter((r) => r.profitGainLoss < 0)
        .reduce((s, r) => s + r.profitGainLoss, 0),
    [rows]
  );

  const netProfitMovement = totalGain + totalLoss;
  const totalCurrentProfit = rows.reduce((s, r) => s + r.job.projectedProfit, 0);

  const topGains = useMemo(
    () =>
      [...rows]
        .filter((r) => (matchedCount > 0 ? r.profitGainLoss > 0 : r.profitPerHrVariance > 0))
        .sort((a, b) =>
          matchedCount > 0
            ? b.profitGainLoss - a.profitGainLoss
            : b.profitPerHrVariance - a.profitPerHrVariance
        )
        .slice(0, 5),
    [rows, matchedCount]
  );

  const topLosses = useMemo(
    () =>
      [...rows]
        .filter((r) =>
          matchedCount > 0
            ? r.profitGainLoss < 0 || r.classification === 'Loss Job'
            : r.profitPerHrVariance < 0 || r.classification === 'Loss Job'
        )
        .sort((a, b) =>
          matchedCount > 0
            ? a.profitGainLoss - b.profitGainLoss
            : a.profitPerHrVariance - b.profitPerHrVariance
        )
        .slice(0, 5),
    [rows, matchedCount]
  );

  const visibleRows = useMemo(() => {
    return rows.filter((r) => {
      const okClass = filterClass === 'all' || r.classification === filterClass;
      const okDiv = !divisionFilter || r.job.division === divisionFilter;
      return okClass && okDiv;
    });
  }, [rows, filterClass, divisionFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            02. Gains &amp; Losses Analysis
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Period ending {period || 'Current'}
            {priorPeriod ? ` vs. Prior baseline ${priorPeriod}` : ' · No prior period loaded yet'}
            {' · '}
            {matchedCount} of {rows.length} active jobs matched to prior baseline
          </p>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white lg:grid-cols-4 lg:divide-x lg:divide-y-0">
        <div className="p-4">
          <div className="text-xs font-medium text-slate-500">Period Profit Gains</div>
          <div className="mt-1.5 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
            +{fmtMoney.format(totalGain)}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs font-medium text-slate-500">Period Profit Fades / Losses</div>
          <div className="mt-1.5 font-mono text-2xl font-semibold text-red-700 tabular-nums">
            {fmtMoney.format(totalLoss)}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs font-medium text-slate-500">Net Margin Movement</div>
          <div
            className={`mt-1.5 font-mono text-2xl font-semibold tabular-nums ${
              netProfitMovement >= 0 ? 'text-emerald-700' : 'text-red-700'
            }`}
          >
            {netProfitMovement >= 0 ? '+' : ''}
            {fmtMoney.format(netProfitMovement)}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs font-medium text-slate-500">Total Projected Profit</div>
          <div className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {fmtMoney.format(totalCurrentProfit)}
          </div>
        </div>
      </div>

      {/* Top Movers Side-by-Side */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
            <TrendingUp className="h-4 w-4 text-emerald-700" />
            Top Profit Gains
          </div>
          {topGains.length === 0 ? (
            <p className="text-xs text-slate-500">
              No positive profit movements detected. Upload a prior WIP or pull baseline from your
              Master Google Sheet to compare periods.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {topGains.map((g) => (
                <div
                  key={g.job.id}
                  className="flex items-center justify-between gap-3 py-2.5 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">
                      {g.job.id} · {g.job.name}
                    </div>
                    <div className="text-slate-500">
                      GP% {fmtPct(g.job.projectedGpPct)} · Actual {fmtMoney2.format(g.job.actualProfitPerHr)}/hr
                    </div>
                  </div>
                  <div className="text-right font-mono font-semibold text-emerald-700 tabular-nums shrink-0">
                    {matchedCount > 0
                      ? `+${fmtMoney.format(g.profitGainLoss)}`
                      : `+${fmtMoney2.format(g.profitPerHrVariance)}/hr`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
            <TrendingDown className="h-4 w-4 text-red-700" />
            Top Profit Fades &amp; Loss Jobs
          </div>
          {topLosses.length === 0 ? (
            <p className="text-xs text-slate-500">No profit erosion or loss-making jobs flagged.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {topLosses.map((g) => (
                <div
                  key={g.job.id}
                  className="flex items-center justify-between gap-3 py-2.5 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">
                      {g.job.id} · {g.job.name}
                    </div>
                    <div className="text-slate-500">
                      GP% {fmtPct(g.job.projectedGpPct)} · Actual {fmtMoney2.format(g.job.actualProfitPerHr)}/hr
                    </div>
                  </div>
                  <div className="text-right font-mono font-semibold text-red-700 tabular-nums shrink-0">
                    {matchedCount > 0
                      ? fmtMoney.format(g.profitGainLoss)
                      : `${fmtMoney2.format(g.profitPerHrVariance)}/hr`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Full Gains & Losses Table */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
            {(['all', 'Gain', 'Fade', 'Loss Job', 'On Plan'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilterClass(tab)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  filterClass === tab
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab === 'all' ? `All (${rows.length})` : tab}
              </button>
            ))}
          </div>

          <select
            value={divisionFilter}
            onChange={(e) => setDivisionFilter(e.target.value)}
            aria-label="Filter Gains & Losses division"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900"
          >
            <option value="">All divisions</option>
            {(Object.entries(DIVISIONS) as Array<[DivisionCode, string]>).map(([code, name]) => (
              <option key={code} value={code}>
                {code} · {name}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-slate-100 text-slate-700">
              <tr className="border-b border-slate-200">
                <th className="px-3 py-2.5 font-semibold">Job</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-3 py-2.5 text-right font-semibold">Prior Contract</th>
                <th className="px-3 py-2.5 text-right font-semibold">Curr. Contract</th>
                <th className="px-3 py-2.5 text-right font-semibold">Prior Profit</th>
                <th className="px-3 py-2.5 text-right font-semibold">Curr. Profit</th>
                <th className="px-3 py-2.5 text-right font-semibold">Gain / (Loss)</th>
                <th className="px-3 py-2.5 text-right font-semibold">GP% Delta</th>
                <th className="px-3 py-2.5 text-right font-semibold">Bid $/Hr</th>
                <th className="px-3 py-2.5 text-right font-semibold">Act. $/Hr</th>
                <th className="px-3 py-2.5 text-right font-semibold">$/Hr Var</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleRows.map((item) => {
                const statusColor =
                  item.classification === 'Gain'
                    ? 'text-emerald-700'
                    : item.classification === 'Fade'
                    ? 'text-amber-700'
                    : item.classification === 'Loss Job'
                    ? 'text-red-700'
                    : 'text-slate-600';
                return (
                  <tr key={item.job.id} className="hover:bg-slate-50/70">
                    <td className="px-3 py-2.5">
                      <div className="font-semibold text-slate-900 tabular-nums">{item.job.id}</div>
                      <div className="text-[11px] text-slate-500 max-w-[230px] truncate">
                        {item.job.name}
                      </div>
                    </td>
                    <td className={`px-3 py-2.5 font-medium whitespace-nowrap ${statusColor}`}>
                      <span className="inline-flex items-center gap-1">
                        {item.classification === 'Gain' && <ArrowUpRight className="h-3.5 w-3.5" />}
                        {(item.classification === 'Fade' || item.classification === 'Loss Job') && (
                          <ArrowDownRight className="h-3.5 w-3.5" />
                        )}
                        {item.classification === 'On Plan' && <Minus className="h-3.5 w-3.5" />}
                        {item.classification}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-500">
                      {item.prior ? fmtMoney.format(item.prior.contract) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {fmtMoney.format(item.job.contract)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-500">
                      {item.prior ? fmtMoney.format(item.prior.projectedProfit) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {fmtMoney.format(item.job.projectedProfit)}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right font-mono font-semibold tabular-nums ${
                        item.profitGainLoss > 0
                          ? 'text-emerald-700'
                          : item.profitGainLoss < 0
                          ? 'text-red-700'
                          : 'text-slate-500'
                      }`}
                    >
                      {item.hasPrior
                        ? `${item.profitGainLoss > 0 ? '+' : ''}${fmtMoney.format(item.profitGainLoss)}`
                        : '—'}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                        item.gpPctDelta > 0
                          ? 'text-emerald-700'
                          : item.gpPctDelta < 0
                          ? 'text-red-700'
                          : 'text-slate-500'
                      }`}
                    >
                      {item.hasPrior
                        ? `${item.gpPctDelta > 0 ? '+' : ''}${fmtPct(item.gpPctDelta)}`
                        : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {fmtMoney2.format(item.job.projectedProfitPerHr)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {fmtMoney2.format(item.job.actualProfitPerHr)}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                        item.profitPerHrVariance >= 0 ? 'text-emerald-700' : 'text-red-700'
                      }`}
                    >
                      {item.profitPerHrVariance >= 0 ? '+' : ''}
                      {fmtMoney2.format(item.profitPerHrVariance)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
