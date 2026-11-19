import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import { fmtMoney, fmtPct, fmtRatio } from '../lib/formatters';
import type { ForecastFadeRow, ForecastOverride } from '../types/wip';

interface ForecastsFadesViewProps {
  rows: ForecastFadeRow[];
  period: string;
  onUpdateOverride: (jobId: string, patch: Partial<ForecastOverride>) => void;
}

export const ForecastsFadesView: React.FC<ForecastsFadesViewProps> = ({
  rows,
  period,
  onUpdateOverride,
}) => {
  const [riskFilter, setRiskFilter] = useState<'all' | ForecastFadeRow['fadeRisk']>('all');

  const totalCurrentProfit = rows.reduce((s, r) => s + r.job.projectedProfit, 0);
  const totalTrendedProfit = rows.reduce((s, r) => s + r.trendedFinalProfit, 0);
  const netProjectedFade = totalTrendedProfit - totalCurrentProfit;
  const highRiskCount = rows.filter((r) => r.fadeRisk === 'High').length;

  const visibleRows = useMemo(
    () => rows.filter((r) => riskFilter === 'all' || r.fadeRisk === riskFilter),
    [rows, riskFilter]
  );

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-5">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">
          03. Forecasts &amp; Margin Fades
        </h1>
        <p className="mt-1 text-xs text-slate-500">
          Period ending {period || 'Current'} · Compares labor hours burn against cost % complete
          to surface Estimate-at-Completion (EAC) fade risk. Enter PM cost overrides or notes below
          before syncing.
        </p>
      </div>

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white lg:grid-cols-4 lg:divide-x lg:divide-y-0">
        <div className="p-4">
          <div className="text-xs font-medium text-slate-500">WIP Booked Profit</div>
          <div className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {fmtMoney.format(totalCurrentProfit)}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs font-medium text-slate-500">Trended Final Profit</div>
          <div className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {fmtMoney.format(totalTrendedProfit)}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs font-medium text-slate-500">Projected Fade / (Expansion)</div>
          <div
            className={`mt-1.5 font-mono text-2xl font-semibold tabular-nums ${
              netProjectedFade < 0 ? 'text-red-700' : 'text-emerald-700'
            }`}
          >
            {netProjectedFade >= 0 ? '+' : ''}
            {fmtMoney.format(netProjectedFade)}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs font-medium text-slate-500">High Fade-Risk Jobs</div>
          <div
            className={`mt-1.5 font-mono text-2xl font-semibold tabular-nums ${
              highRiskCount > 0 ? 'text-red-700' : 'text-emerald-700'
            }`}
          >
            {highRiskCount}
          </div>
        </div>
      </div>

      {/* Forecast Table */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
            {(['all', 'High', 'Watch', 'Healthy'] as const).map((tier) => (
              <button
                key={tier}
                type="button"
                onClick={() => setRiskFilter(tier)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  riskFilter === tier
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tier === 'all' ? `All Jobs (${rows.length})` : `${tier} Risk`}
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-500">
            Manual EAC overrides &amp; PM notes persist to your Master Google Sheet
          </span>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-slate-100 text-slate-700">
              <tr className="border-b border-slate-200">
                <th className="px-3 py-2.5 font-semibold">Job</th>
                <th className="px-3 py-2.5 font-semibold">Risk</th>
                <th className="px-3 py-2.5 text-right font-semibold">% Cost</th>
                <th className="px-3 py-2.5 text-right font-semibold">% Hrs</th>
                <th className="px-3 py-2.5 text-right font-semibold">Burn Ratio</th>
                <th className="px-3 py-2.5 text-right font-semibold">Current Cost</th>
                <th className="px-3 py-2.5 text-right font-semibold">Trended EAC</th>
                <th className="px-3 py-2.5 text-right font-semibold">EAC Override ($)</th>
                <th className="px-3 py-2.5 text-right font-semibold">Proj. Fade</th>
                <th className="px-3 py-2.5 font-semibold min-w-[150px]">Fade Reason</th>
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
                    {row.fadeRisk === 'High' && (
                      <span className="inline-flex items-center gap-1 font-medium text-red-700">
                        <ShieldAlert className="h-3.5 w-3.5" />
                        High
                      </span>
                    )}
                    {row.fadeRisk === 'Watch' && (
                      <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Watch
                      </span>
                    )}
                    {row.fadeRisk === 'Healthy' && (
                      <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Healthy
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                    {fmtPct(row.pctCostSpent)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                    {fmtPct(row.pctHoursSpent)}
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                      row.burnRatio >= 1.1
                        ? 'text-red-700 font-semibold'
                        : row.burnRatio >= 1.04
                        ? 'text-amber-700'
                        : 'text-slate-700'
                    }`}
                  >
                    {fmtRatio(row.burnRatio)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                    {fmtMoney.format(row.job.cost)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                    {fmtMoney.format(row.trendedEacCost)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <input
                      type="number"
                      value={row.override?.adjustedCost ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        onUpdateOverride(row.job.id, {
                          adjustedCost: raw === '' ? undefined : Number(raw),
                        });
                      }}
                      placeholder={String(Math.round(row.trendedEacCost))}
                      aria-label={`EAC cost override for ${row.job.id}`}
                      className="w-28 rounded border border-slate-300 bg-white px-2 py-1 text-right font-mono text-xs text-slate-900 tabular-nums focus:border-[#0F293A] focus:outline-none"
                    />
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right font-mono font-semibold tabular-nums ${
                      row.projectedFadeAmount < 0
                        ? 'text-red-700'
                        : row.projectedFadeAmount > 0
                        ? 'text-emerald-700'
                        : 'text-slate-500'
                    }`}
                  >
                    {row.projectedFadeAmount >= 0 ? '+' : ''}
                    {fmtMoney.format(row.projectedFadeAmount)}
                  </td>
                  <td className="px-3 py-2.5">
                    <select
                      value={row.override?.fadeReason ?? ''}
                      onChange={(e) =>
                        onUpdateOverride(row.job.id, { fadeReason: e.target.value })
                      }
                      aria-label={`Fade reason for ${row.job.id}`}
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
                    >
                      <option value="">Select reason…</option>
                      <option value="Labor Productivity">Labor Productivity</option>
                      <option value="Material / Sub Escalation">Material / Sub Escalation</option>
                      <option value="Unapproved Change Order">Unapproved Change Order</option>
                      <option value="Schedule Compression / OT">Schedule Compression / OT</option>
                      <option value="Buyout / Scope Savings">Buyout / Scope Savings</option>
                    </select>
                  </td>
                  <td className="px-3 py-2.5">
                    <input
                      type="text"
                      value={row.override?.pmNote ?? ''}
                      onChange={(e) => onUpdateOverride(row.job.id, { pmNote: e.target.value })}
                      placeholder="Enter PM action note…"
                      aria-label={`PM note for ${row.job.id}`}
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
  );
};
