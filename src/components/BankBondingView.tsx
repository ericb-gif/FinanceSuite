import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Printer,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { fmtMoney, fmtPct, fmtRatio } from '../lib/formatters';
import {
  COMPANY_NAME,
  buildReportSheets,
  type BuiltReport,
  type LiquidityResult,
  type ReportMonthVal,
} from '../lib/lookaheadEngine';
import { mLabel, mLong, pfMoney, pfPct, sumRow } from '../lib/profitForecastEngine';
import type {
  PfReportSettings,
  PfState,
  PfWcSettings,
} from '../types/profitForecast';
import type { BankBondingReport, BondingAssumptions } from '../types/wip';

interface BankBondingViewProps {
  assumptions: BondingAssumptions;
  report: BankBondingReport;
  period: string;
  onUpdateAssumptions: (patch: Partial<BondingAssumptions>) => void;
  pfState?: PfState | null;
  builtReport?: BuiltReport | null;
  liquidity?: LiquidityResult | null;
  onUpdateReportSettings?: (patch: Partial<PfReportSettings>) => void;
  onNotice?: (type: 'success' | 'error', text: string) => void;
}

export const BankBondingView: React.FC<BankBondingViewProps> = ({
  assumptions,
  report,
  period,
  onUpdateAssumptions,
  pfState,
  builtReport,
  liquidity,
  onUpdateReportSettings,
  onNotice,
}) => {
  const hasExecutive = Boolean(builtReport && pfState);
  const [subView, setSubView] = useState<'executive' | 'covenants'>(
    hasExecutive ? 'executive' : 'covenants'
  );
  const [showWcInputs, setShowWcInputs] = useState(false);

  const currentRatioHealthy = report.currentRatio >= 1.25;
  const backlogWcHealthy =
    report.adjustedWorkingCapital > 0 && report.backlogToWorkingCapital <= 10;

  const rs = pfState?.settings.report || {};
  const detail = rs.detail || 'all';
  const span = rs.span || 'ye';

  const handleCopyExcel = async () => {
    if (!pfState || !builtReport) return;
    try {
      const sh = buildReportSheets(pfState, builtReport);
      const tsv = [
        ...sh.Summary,
        [],
        ['JOB SCHEDULE'],
        ...sh.Jobs,
        [],
        ['BACKLOG'],
        ...sh.Backlog,
      ]
        .map((r) => r.join('\t'))
        .join('\n');
      await navigator.clipboard.writeText(tsv);
      onNotice?.('success', 'Executive report copied to clipboard. Paste into Excel.');
    } catch {
      onNotice?.('error', 'Clipboard copy was blocked by the browser. Use Download Excel instead.');
    }
  };

  const handleDownloadReportXlsx = () => {
    if (!pfState || !builtReport) return;
    try {
      const wb = XLSX.utils.book_new();
      const sh = buildReportSheets(pfState, builtReport);
      for (const [name, aoa] of Object.entries(sh)) {
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        const refRow = aoa[aoa.length > 5 ? 5 : 0] || [];
        ws['!cols'] = refRow.map((_, i) => ({
          wch: i === 0 ? 28 : i === 2 && name === 'Jobs' ? 34 : 14,
        }));
        XLSX.utils.book_append_sheet(wb, ws, name);
      }
      const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const buf = new Uint8Array(data).buffer;
      const url = URL.createObjectURL(
        new Blob([buf], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `JRT-Bank-Bonding-Forecast-${builtReport.M[0] || 'report'}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      onNotice?.('success', 'Executive Bank & Bonding Excel workbook downloaded.');
    } catch {
      onNotice?.('error', 'Unable to download Excel workbook.');
    }
  };

  const handlePrint = () => {
    const t0 = Date.now();
    try {
      window.print();
    } catch {
      // handled below
    }
    setTimeout(() => {
      if (Date.now() - t0 < 300) {
        onNotice?.(
          'success',
          'If browser print dialog is suppressed inside preview, open in a dedicated tab or use Download Excel.'
        );
      }
    }, 350);
  };

  const updateWc = (key: keyof PfWcSettings, val: string | number | null, isPct = false) => {
    const nextWc: Partial<PfWcSettings> = { ...(rs.wc || {}) };
    if (val === '' || val === null) {
      delete nextWc[key];
    } else if (typeof val === 'string' && !isPct) {
      (nextWc as Record<string, string | number>)[key] = val;
    } else {
      (nextWc as Record<string, string | number>)[key] = isPct
        ? Number(val) / 100
        : Number(val);
    }
    onUpdateReportSettings?.({ wc: nextWc });
  };

  const renderExecutivePackage = () => {
    if (!builtReport || !liquidity || !pfState) return null;
    const B = builtReport;
    const L = liquidity;
    const w = L.w;
    const showYe = B.yeIdx.length > 0 || B.hasYtd;
    const showNy = B.nyIdx.length > 0;
    const yeLabel = B.yeComplete
      ? `${B.yr} projected`
      : `${B.yr} thru ${mLabel(B.M[B.M.length - 1])}`;

    const jobMetricRows: Array<{ f: 'rev' | 'cost' | 'gp'; lab: string }> =
      detail === 'all'
        ? [
            { f: 'rev', lab: 'Revenue' },
            { f: 'cost', lab: 'Cost' },
            { f: 'gp', lab: 'Profit' },
          ]
        : detail === 'gp'
        ? [{ f: 'gp', lab: 'Profit' }]
        : detail === 'rev'
        ? [{ f: 'rev', lab: 'Revenue' }]
        : [];

    const hasEstJobs = Boolean(pfState.est && pfState.est.jobs);

    const basisList = [
      `Year-to-date figures are actual results from the ${B.pm ? mLong(B.pm) : ''} P&L.${
        B.actual ? ` ${mLong(B.actual)} is preliminary.` : ''
      }`,
      'Contract revenue is recognized by percent complete. Projected losses are recorded in full when identified.',
      'Service is forecast at its recent monthly run rate; overhead at the year-to-date monthly average.',
      'Forecast months include signed backlog and identified new work only.',
      'EBITDA = net income + interest + depreciation from the P&L (YTD actual; forecast months use YTD monthly average). No tax add-back; JRT is a pass-through.',
    ];

    const lowLocAfterPeak = L.peak
      ? L.rows
          .filter((x) => x.line !== null && x.k > L.peak!.k)
          .reduce<typeof L.peak | null>(
            (a, x) => (!a || (x.line as number) < (a.line as number) ? x : a),
            null
          )
      : null;

    return (
      <div className="space-y-6">
        {/* Controls & Export Toolbar (hidden in print) */}
        <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3.5 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 font-medium text-slate-700">
              <span>Forecast through</span>
              <select
                value={span}
                onChange={(e) => onUpdateReportSettings?.({ span: e.target.value })}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="ye">Year end</option>
                <option value="3">3 months</option>
                <option value="6">6 months</option>
                <option value="12">12 months</option>
              </select>
            </label>

            <label className="flex items-center gap-2 font-medium text-slate-700">
              <span>Job detail</span>
              <select
                value={detail}
                onChange={(e) =>
                  onUpdateReportSettings?.({
                    detail: e.target.value as PfReportSettings['detail'],
                  })
                }
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="all">Revenue, cost &amp; profit</option>
                <option value="gp">Profit only</option>
                <option value="rev">Revenue only</option>
                <option value="none">Hide job schedule</option>
              </select>
            </label>

            <label className="flex items-center gap-2 font-medium text-slate-700">
              <span>Prepared by</span>
              <input
                type="text"
                value={rs.by || ''}
                placeholder="Name"
                onChange={(e) => onUpdateReportSettings?.({ by: e.target.value })}
                className="w-36 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopyExcel}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy for Excel
            </button>
            <button
              type="button"
              onClick={handleDownloadReportXlsx}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" />
              Download Excel
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F293A] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#173b52]"
            >
              <Printer className="h-3.5 w-3.5" />
              Print / Save PDF
            </button>
          </div>
        </div>

        {/* Report Document */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-6">
          {/* Executive Masthead */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
            <div className="flex items-center gap-4">
              <img
                src="/assets/aistudio/logo_17c0f7dc.jpg"
                alt={COMPANY_NAME}
                className="h-14 w-auto object-contain rounded"
              />
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {COMPANY_NAME}
                </div>
                <h2 className="text-xl font-bold text-slate-900">Profit forecast by division</h2>
                <div className="text-xs text-slate-500">
                  Actual through {B.pm ? mLong(B.pm) : '—'} · Forecast {mLong(B.M[0])} –{' '}
                  {mLong(B.M[B.M.length - 1])}
                </div>
              </div>
            </div>
            <div className="text-right text-xs text-slate-500">
              <div>
                Prepared{' '}
                {new Date().toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </div>
              {rs.by && <div className="font-medium text-slate-700">by {rs.by}</div>}
              <div>Unaudited · management forecast</div>
            </div>
          </div>

          {/* Headline KPIs */}
          <div className="grid grid-cols-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-slate-50/40 lg:grid-cols-4 lg:divide-x lg:divide-y-0">
            <div className="p-4">
              <div className="text-xs font-medium text-slate-500">Revenue, {yeLabel}</div>
              <div className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                {pfMoney(B.ye(B.co, 'rev'))}
              </div>
              <div className="mt-1 text-xs text-slate-500 tabular-nums">
                {B.hasYtd ? `YTD ${pfMoney(B.co.ytd.rev)} + forecast` : 'forecast'}
              </div>
            </div>

            <div className="p-4">
              <div className="text-xs font-medium text-slate-500">Gross profit, {yeLabel}</div>
              <div className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                {pfMoney(B.ye(B.co, 'gp'))}
              </div>
              <div className="mt-1 text-xs text-slate-500 tabular-nums">
                {pfPct(B.ye(B.co, 'rev') ? B.ye(B.co, 'gp') / B.ye(B.co, 'rev') : null)} margin
              </div>
            </div>

            <div className="p-4">
              <div className="text-xs font-medium text-slate-500">Net income, {yeLabel}</div>
              <div
                className={`mt-1.5 font-mono text-2xl font-semibold tabular-nums ${
                  B.ye(B.co, 'net') < -0.5 ? 'text-red-700' : 'text-slate-900'
                }`}
              >
                {pfMoney(B.ye(B.co, 'net'))}
              </div>
              <div className="mt-1 text-xs text-slate-500 tabular-nums">
                {B.hasYtd ? `YTD ${pfMoney(B.co.ytd.net)}` : ''}
              </div>
            </div>

            <div className="p-4">
              <div className="text-xs font-medium text-slate-500">Contract backlog</div>
              <div className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                {pfMoney(B.co.backlog.rev)}
              </div>
              <div className="mt-1 text-xs text-slate-500 tabular-nums">
                {B.co.backlog.jobs} jobs · {pfMoney(B.co.backlog.gp)} GP left
              </div>
            </div>
          </div>

          {/* Summary by Division */}
          <div className="space-y-2.5">
            <h3 className="text-sm font-semibold text-slate-900">Summary by division</h3>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-slate-100 text-slate-700">
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2 font-semibold min-w-[170px]" />
                    {B.hasYtd && B.pm && (
                      <th className="px-3 py-2 text-right font-semibold bg-slate-50 whitespace-nowrap">
                        YTD thru {mLabel(B.pm)}
                        <div className="text-[10px] font-normal text-slate-500">actual</div>
                      </th>
                    )}
                    {B.M.map((k, idx) => (
                      <th key={k} className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                        {mLabel(k)}
                        <div className="text-[10px] font-normal text-slate-500">
                          {B.actual && idx === 0 ? 'prelim.' : 'forecast'}
                        </div>
                      </th>
                    ))}
                    {showYe && (
                      <th className="px-3 py-2 text-right font-semibold bg-slate-200/70 whitespace-nowrap">
                        {B.yeComplete
                          ? `Year end ${B.yr}`
                          : `Total ${B.yr} thru ${mLabel(B.M[B.M.length - 1])}`}
                        <div className="text-[10px] font-normal text-slate-500">
                          {B.hasYtd ? 'actual + forecast' : 'forecast'}
                        </div>
                      </th>
                    )}
                    {showNy && (
                      <th className="px-3 py-2 text-right font-semibold bg-slate-200/70 whitespace-nowrap">
                        {B.ny} YTD thru {mLabel(B.M[B.nyIdx[B.nyIdx.length - 1]])}
                        <div className="text-[10px] font-normal text-slate-500">forecast</div>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...B.divs, B.co].map((d) => {
                    const isCo = d === B.co;
                    const rowSpec: Array<{
                      label: string;
                      key: keyof ReportMonthVal;
                      pctOfRev?: boolean;
                      negOh?: boolean;
                      cls?: string;
                    }> = [
                      { label: 'Revenue', key: 'rev' },
                      { label: 'Cost of revenue', key: 'cost', cls: 'text-slate-500' },
                      { label: 'Gross profit', key: 'gp', cls: 'font-semibold' },
                      { label: 'Gross margin', key: 'gp', pctOfRev: true, cls: 'text-slate-500' },
                      { label: 'Overhead', key: 'oh', negOh: true, cls: 'text-slate-500' },
                      { label: 'Overhead %', key: 'oh', pctOfRev: true, cls: 'text-slate-500' },
                      { label: 'Net income', key: 'net', cls: 'bg-slate-50 font-semibold' },
                      { label: 'Net margin', key: 'net', pctOfRev: true, cls: 'text-slate-500' },
                      { label: 'EBITDA', key: 'ebitda', cls: 'font-medium text-slate-700' },
                    ];

                    const colSpan =
                      1 + (B.hasYtd ? 1 : 0) + B.n + (showYe ? 1 : 0) + (showNy ? 1 : 0);

                    return (
                      <React.Fragment key={d.name}>
                        <tr
                          className={
                            isCo
                              ? 'bg-[#0F293A] text-white font-semibold'
                              : 'bg-slate-100 font-semibold text-slate-900'
                          }
                        >
                          <td colSpan={colSpan} className="px-3 py-2">
                            {d.name}
                          </td>
                        </tr>
                        {rowSpec.map((r) => {
                          const formatCell = (numV: number, revV: number) => {
                            if (r.pctOfRev) return pfPct(revV ? numV / revV : null);
                            return pfMoney(r.negOh ? -numV : numV);
                          };
                          const cellNeg = (numV: number, revV: number) => {
                            if (r.pctOfRev) return r.key === 'net' && revV && numV / revV < 0;
                            const val = r.negOh ? -numV : numV;
                            return val < -0.5;
                          };

                          return (
                            <tr key={`${d.name}-${r.label}`} className={r.cls || ''}>
                              <td className="px-3 py-1.5">{r.label}</td>
                              {B.hasYtd && (
                                <td
                                  className={`px-3 py-1.5 text-right font-mono bg-slate-50/40 tabular-nums ${
                                    cellNeg(d.ytd[r.key], d.ytd.rev) ? 'text-red-700' : ''
                                  }`}
                                >
                                  {formatCell(d.ytd[r.key], d.ytd.rev)}
                                </td>
                              )}
                              {d.months.map((m, idx) => (
                                <td
                                  key={idx}
                                  className={`px-3 py-1.5 text-right font-mono tabular-nums ${
                                    cellNeg(m[r.key], m.rev) ? 'text-red-700' : ''
                                  }`}
                                >
                                  {formatCell(m[r.key], m.rev)}
                                </td>
                              ))}
                              {showYe && (
                                <td
                                  className={`px-3 py-1.5 text-right font-mono font-semibold bg-slate-100/50 tabular-nums ${
                                    cellNeg(B.ye(d, r.key), B.ye(d, 'rev')) ? 'text-red-700' : ''
                                  }`}
                                >
                                  {formatCell(B.ye(d, r.key), B.ye(d, 'rev'))}
                                </td>
                              )}
                              {showNy && (
                                <td
                                  className={`px-3 py-1.5 text-right font-mono font-semibold bg-slate-100/50 tabular-nums ${
                                    cellNeg(B.y2(d, r.key), B.y2(d, 'rev')) ? 'text-red-700' : ''
                                  }`}
                                >
                                  {formatCell(B.y2(d, r.key), B.y2(d, 'rev'))}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Liquidity and Working Capital */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Liquidity and working capital</h3>
            <ul className="list-disc pl-5 text-xs text-slate-600 space-y-1">
              {L.hasCash && L.peak && (
                <li>
                  <strong>Line of credit:</strong> highest month-end balance {pfMoney(L.peak.line)}{' '}
                  ({mLong(L.peak.k)}), within the {pfMoney(w.limit)} limit.
                </li>
              )}
              {L.hasCash && L.peak && lowLocAfterPeak && (lowLocAfterPeak.line as number) < (L.peak.line as number) - 1 && (
                <li>
                  <strong>Paydown:</strong> {pfMoney(lowLocAfterPeak.line)} by{' '}
                  {mLong(lowLocAfterPeak.k)} as the larger jobs bill out.
                </li>
              )}
              <li>
                <strong>Working capital</strong> starts from the {mLong(w.asOf)} balance sheet and
                moves with net income, plus depreciation, less loan principal
                {w.capAmt > 0 ? ', plus owner capital' : ''}.
              </li>
            </ul>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-slate-100 text-slate-700">
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2 font-semibold" />
                    <th className="px-3 py-2 text-right font-semibold bg-slate-50">
                      {mLabel(w.asOf)}
                      <div className="text-[10px] font-normal text-slate-500">balance sheet</div>
                    </th>
                    {L.B.M.map((k, idx) => (
                      <th key={k} className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                        {mLabel(k)}
                        <div className="text-[10px] font-normal text-slate-500">
                          {L.B.actual && idx === 0 ? 'prelim.' : 'forecast'}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {L.hasCash && (
                    <>
                      <tr className="bg-slate-100 font-semibold text-slate-900">
                        <td colSpan={L.B.n + 2} className="px-3 py-2">
                          Line of credit · {pfMoney(w.limit)} limit · {(w.rate * 100).toFixed(1)}% ·
                          renews {mLong(w.renew)}
                        </td>
                      </tr>
                      <tr>
                        <td className="px-3 py-1.5">Balance at month end</td>
                        <td className="px-3 py-1.5 text-right font-mono bg-slate-50/40 tabular-nums">
                          {pfMoney(w.locAsOf)}
                        </td>
                        {L.rows.map((x) => (
                          <td key={x.k} className="px-3 py-1.5 text-right font-mono tabular-nums">
                            {pfMoney(x.line)}
                          </td>
                        ))}
                      </tr>
                      {w.capAmt > 0 && (
                        <tr>
                          <td className="px-3 py-1.5">Owner capital in (property sale)</td>
                          <td className="px-3 py-1.5 bg-slate-50/40" />
                          {L.B.M.map((k) => (
                            <td key={k} className="px-3 py-1.5 text-right font-mono tabular-nums">
                              {k === w.capMonth ? pfMoney(w.capAmt) : ''}
                            </td>
                          ))}
                        </tr>
                      )}
                      <tr className="font-semibold">
                        <td className="px-3 py-1.5">Available on the line</td>
                        <td className="px-3 py-1.5 text-right font-mono bg-slate-50/40 tabular-nums">
                          {pfMoney(w.limit - w.locAsOf)}
                        </td>
                        {L.rows.map((x) => (
                          <td
                            key={x.k}
                            className={`px-3 py-1.5 text-right font-mono tabular-nums ${
                              (x.avail ?? 0) < -0.5 ? 'text-red-700' : ''
                            }`}
                          >
                            {pfMoney(x.avail)}
                          </td>
                        ))}
                      </tr>
                      <tr className="text-slate-600">
                        <td className="px-3 py-1.5">Net overbilled</td>
                        <td className="px-3 py-1.5 bg-slate-50/40" />
                        {L.rows.map((x) => (
                          <td key={x.k} className="px-3 py-1.5 text-right font-mono tabular-nums">
                            {pfMoney(x.ou)}
                          </td>
                        ))}
                      </tr>
                    </>
                  )}

                  <tr className="bg-slate-100 font-semibold text-slate-900">
                    <td colSpan={L.B.n + 2} className="px-3 py-2">
                      Working capital (current assets − current liabilities)
                    </td>
                  </tr>
                  <tr className="font-semibold">
                    <td className="px-3 py-1.5">Working capital</td>
                    <td
                      className={`px-3 py-1.5 text-right font-mono bg-slate-50/40 tabular-nums ${
                        L.wc0 < -0.5 ? 'text-red-700' : ''
                      }`}
                    >
                      {pfMoney(L.wc0)}
                    </td>
                    {L.rows.map((x) => (
                      <td
                        key={x.k}
                        className={`px-3 py-1.5 text-right font-mono tabular-nums ${
                          x.wc < -0.5 ? 'text-red-700' : ''
                        }`}
                      >
                        {pfMoney(x.wc)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            {(w.contDesc || w.contAmt > 0) && (
              <p className="text-xs text-slate-600">
                <strong>Backup source of cash, not counted above:</strong>{' '}
                {w.contDesc || 'Owner assets'}
                {w.contAmt ? ` (about ${pfMoney(w.contAmt)})` : ''}.
              </p>
            )}

            {/* Collapsible Balance Sheet & Liquidity Assumptions Editor */}
            <div className="no-print rounded-lg border border-slate-200 bg-slate-50/50">
              <button
                type="button"
                onClick={() => setShowWcInputs((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100/60"
              >
                <div className="flex items-center gap-1.5">
                  {showWcInputs ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                  <span>Edit Balance Sheet &amp; Liquidity Assumptions</span>
                </div>
                <span className="font-normal text-slate-500">
                  {mLong(w.asOf)} CA {pfMoney(w.ca)} / CL {pfMoney(w.cl)}
                </span>
              </button>

              {showWcInputs && (
                <div className="grid grid-cols-2 gap-3 border-t border-slate-200 p-4 sm:grid-cols-3 lg:grid-cols-5 text-xs">
                  {(
                    [
                      ['asOf', 'Balance sheet month', 'month', false],
                      ['ca', 'Current assets ($)', 'number', false],
                      ['cl', 'Current liabilities ($)', 'number', false],
                      ['locAsOf', 'LOC balance at BS month ($)', 'number', false],
                      ['limit', 'LOC limit ($)', 'number', false],
                      ['renew', 'LOC renewal month', 'month', false],
                      ['rate', 'LOC interest rate %', 'number', true],
                      ['dep', 'Monthly depreciation ($)', 'number', false],
                      ['principal', 'Monthly truck loan principal ($)', 'number', false],
                      ['cushion', 'LOC Cushion ($)', 'number', false],
                      ['knownM1', 'Weekly sheet month 1', 'month', false],
                      ['knownV1', 'Weekly sheet LOC balance 1 ($)', 'number', false],
                      ['knownM2', 'Weekly sheet month 2', 'month', false],
                      ['knownV2', 'Weekly sheet LOC balance 2 ($)', 'number', false],
                      ['capAmt', 'Owner capital injection ($)', 'number', false],
                      ['capMonth', 'Capital injection month', 'month', false],
                      ['thru', 'Liquidity horizon through', 'month', false],
                    ] as const
                  ).map(([k, lab, type, isPct]) => {
                    const val = w[k];
                    const displayVal =
                      val === undefined || val === null
                        ? ''
                        : isPct
                        ? +(Number(val) * 100).toFixed(3)
                        : val;
                    return (
                      <label key={k} className="block">
                        <span className="font-medium text-slate-600">{lab}</span>
                        <input
                          type={type}
                          step={isPct ? '0.25' : type === 'number' ? '1000' : undefined}
                          value={displayVal}
                          onChange={(e) => updateWc(k, e.target.value, isPct)}
                          className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs tabular-nums"
                        />
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Job Schedule */}
          {jobMetricRows.length > 0 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Job schedule</h3>
                <p className="text-xs text-slate-500">
                  Contract and % complete are as of the{' '}
                  {pfState.wip?.asOf ? mLong(pfState.wip.asOf) : ''} WIP.
                  {hasEstJobs &&
                    ' Est. GP % is the Spectrum estimate (bid + CO budgets); Proj. GP % is where the job is projected to finish.'}
                </p>
              </div>

              {B.divs.map((d) => {
                if (!d.lines.length) return null;
                const both = d.lines.filter(
                  (L) =>
                    L.kind === 'job' &&
                    L.estP !== null &&
                    L.estP !== undefined &&
                    L.projP !== null &&
                    L.projP !== undefined
                );
                const dEst = both.length
                  ? sumRow(both.map((L) => (L.estP || 0) * (L.estRev || 0))) /
                    Math.max(1, sumRow(both.map((L) => L.estRev || 0)))
                  : null;
                const dProj = both.length
                  ? sumRow(both.map((L) => (L.projP || 0) * (L.projC || 0))) /
                    Math.max(1, sumRow(both.map((L) => L.projC || 0)))
                  : null;

                return (
                  <div key={d.id} className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                      {d.name}
                    </h4>
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full border-collapse text-left text-xs">
                        <thead className="bg-slate-100 text-slate-700">
                          <tr className="border-b border-slate-200">
                            <th className="px-2.5 py-2 font-semibold">Job</th>
                            <th className="px-2.5 py-2 font-semibold">Name</th>
                            <th className="px-2.5 py-2 text-right font-semibold">Contract</th>
                            <th className="px-2.5 py-2 text-right font-semibold">Complete</th>
                            {hasEstJobs && (
                              <>
                                <th className="px-2.5 py-2 text-right font-semibold">Est. GP%</th>
                                <th className="px-2.5 py-2 text-right font-semibold">Proj. GP%</th>
                              </>
                            )}
                            {jobMetricRows.length > 1 && <th className="px-2.5 py-2" />}
                            {B.M.map((k) => (
                              <th
                                key={k}
                                className="px-2.5 py-2 text-right font-semibold whitespace-nowrap"
                              >
                                {mLabel(k)}
                              </th>
                            ))}
                            <th className="px-2.5 py-2 text-right font-semibold bg-slate-200/70">
                              Total
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {d.lines.map((L, lIdx) =>
                            jobMetricRows.map((mr, jIdx) => {
                              const vals = L.vals.map((v) => v[mr.f]);
                              const tot = sumRow(vals);
                              const projColor =
                                L.estP != null && L.projP != null
                                  ? L.projP < L.estP - 0.005
                                    ? 'text-red-700'
                                    : L.projP > L.estP + 0.005
                                    ? 'text-emerald-700'
                                    : ''
                                  : '';

                              return (
                                <tr
                                  key={`${d.id}-${lIdx}-${mr.f}`}
                                  className={
                                    mr.f === 'gp' && jobMetricRows.length > 1
                                      ? 'font-semibold bg-slate-50/40'
                                      : ''
                                  }
                                >
                                  {jIdx === 0 && (
                                    <>
                                      <td
                                        rowSpan={jobMetricRows.length}
                                        className="px-2.5 py-1.5 align-top font-mono font-semibold text-slate-900"
                                      >
                                        {L.job || ''}
                                      </td>
                                      <td
                                        rowSpan={jobMetricRows.length}
                                        title={L.names?.join(', ')}
                                        className="px-2.5 py-1.5 align-top text-slate-800 max-w-[200px]"
                                      >
                                        {L.name}
                                      </td>
                                      <td
                                        rowSpan={jobMetricRows.length}
                                        className="px-2.5 py-1.5 align-top text-right font-mono tabular-nums"
                                      >
                                        {L.kind === 'job'
                                          ? L.tm
                                            ? 'T&M'
                                            : pfMoney(L.contract)
                                          : ''}
                                      </td>
                                      <td
                                        rowSpan={jobMetricRows.length}
                                        className="px-2.5 py-1.5 align-top text-right font-mono tabular-nums"
                                      >
                                        {L.kind === 'job' && L.done !== null && L.done !== undefined
                                          ? pfPct(L.done, 0)
                                          : ''}
                                      </td>
                                      {hasEstJobs && (
                                        <>
                                          <td
                                            rowSpan={jobMetricRows.length}
                                            className="px-2.5 py-1.5 align-top text-right font-mono tabular-nums"
                                          >
                                            {L.kind === 'job' ? pfPct(L.estP) : ''}
                                          </td>
                                          <td
                                            rowSpan={jobMetricRows.length}
                                            className={`px-2.5 py-1.5 align-top text-right font-mono tabular-nums ${projColor}`}
                                          >
                                            {L.kind === 'job' ? pfPct(L.projP) : ''}
                                          </td>
                                        </>
                                      )}
                                    </>
                                  )}
                                  {jobMetricRows.length > 1 && (
                                    <td className="px-2.5 py-1.5 text-slate-500">{mr.lab}</td>
                                  )}
                                  {vals.map((v, vIdx) => (
                                    <td
                                      key={vIdx}
                                      className={`px-2.5 py-1.5 text-right font-mono tabular-nums ${
                                        v < -0.5 ? 'text-red-700' : ''
                                      }`}
                                    >
                                      {pfMoney(v)}
                                    </td>
                                  ))}
                                  <td
                                    className={`px-2.5 py-1.5 text-right font-mono font-semibold bg-slate-50/70 tabular-nums ${
                                      tot < -0.5 ? 'text-red-700' : ''
                                    }`}
                                  >
                                    {pfMoney(tot)}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                          {jobMetricRows.map((mr, jIdx) => {
                            const vals = d.months.map((m) => m[mr.f]);
                            const tot = sumRow(vals);
                            return (
                              <tr
                                key={`${d.id}-sub-${mr.f}`}
                                className="bg-slate-100 font-semibold"
                              >
                                {jIdx === 0 && (
                                  <>
                                    <td colSpan={4} rowSpan={jobMetricRows.length} className="px-2.5 py-2 align-top">
                                      {d.name} total
                                    </td>
                                    {hasEstJobs && (
                                      <>
                                        <td
                                          rowSpan={jobMetricRows.length}
                                          className="px-2.5 py-2 align-top text-right font-mono tabular-nums"
                                        >
                                          {pfPct(dEst)}
                                        </td>
                                        <td
                                          rowSpan={jobMetricRows.length}
                                          className="px-2.5 py-2 align-top text-right font-mono tabular-nums"
                                        >
                                          {pfPct(dProj)}
                                        </td>
                                      </>
                                    )}
                                  </>
                                )}
                                {jobMetricRows.length > 1 && (
                                  <td className="px-2.5 py-1.5">{mr.lab}</td>
                                )}
                                {vals.map((v, vIdx) => (
                                  <td
                                    key={vIdx}
                                    className={`px-2.5 py-1.5 text-right font-mono tabular-nums ${
                                      v < -0.5 ? 'text-red-700' : ''
                                    }`}
                                  >
                                    {pfMoney(v)}
                                  </td>
                                ))}
                                <td
                                  className={`px-2.5 py-1.5 text-right font-mono tabular-nums ${
                                    tot < -0.5 ? 'text-red-700' : ''
                                  }`}
                                >
                                  {pfMoney(tot)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Contract Backlog */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">Contract backlog</h3>
            <p className="text-xs text-slate-500">
              Signed contract not yet earned as of the{' '}
              {pfState.wip?.asOf ? mLong(pfState.wip.asOf) : ''} WIP, and gross profit forecast
              remaining on that work.
            </p>
            <div className="overflow-x-auto rounded-lg border border-slate-200 max-w-2xl">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-slate-100 text-slate-700">
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2 font-semibold">Division</th>
                    <th className="px-3 py-2 text-right font-semibold">Jobs</th>
                    <th className="px-3 py-2 text-right font-semibold">Contract left to earn</th>
                    <th className="px-3 py-2 text-right font-semibold">Gross profit to earn</th>
                    <th className="px-3 py-2 text-right font-semibold">Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...B.divs.filter((d) => d.backlog.jobs > 0), B.co].map((d) => {
                    const isCo = d === B.co;
                    return (
                      <tr
                        key={d.name}
                        className={isCo ? 'bg-slate-100 font-bold text-slate-900' : ''}
                      >
                        <td className="px-3 py-2">{d.name}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {d.backlog.jobs}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {pfMoney(d.backlog.rev)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {pfMoney(d.backlog.gp)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {pfPct(d.backlog.rev ? d.backlog.gp / d.backlog.rev : null)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Basis & Management Notes */}
          <div className="space-y-2.5 border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold text-slate-900">Basis of this forecast</h3>
            <ul className="list-disc pl-5 text-xs text-slate-600 space-y-1">
              {basisList.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
            {rs.notes && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 whitespace-pre-wrap">
                {rs.notes}
              </div>
            )}
            <div className="no-print pt-2">
              <label className="block text-xs">
                <span className="font-medium text-slate-700">
                  Management notes for bank &amp; surety package
                </span>
                <textarea
                  rows={3}
                  value={rs.notes || ''}
                  placeholder="Optional commentary added below Basis of this forecast when exported or printed…"
                  onChange={(e) => onUpdateReportSettings?.({ notes: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
                />
              </label>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            06. Bank &amp; Surety Bonding Report
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Period ending {period || 'Current'} · Executive P&amp;L &amp; LOC Liquidity Package
            plus Construction GAAP WIP Reconciliation &amp; Bonding Covenants
          </p>
        </div>

        {hasExecutive && (
          <div className="inline-flex rounded-lg bg-slate-100 p-1 shrink-0">
            <button
              type="button"
              onClick={() => setSubView('executive')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                subView === 'executive'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Executive P&amp;L &amp; Liquidity Package
            </button>
            <button
              type="button"
              onClick={() => setSubView('covenants')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                subView === 'covenants'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Surety Capacity &amp; Balance Sheet
            </button>
          </div>
        )}
      </div>

      {subView === 'executive' && hasExecutive ? (
        renderExecutivePackage()
      ) : (
        <div className="space-y-6">
          {/* Surety & Bank Covenant KPI Strip */}
          <div className="grid grid-cols-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white lg:grid-cols-4 lg:divide-x lg:divide-y-0">
            <div className="p-4">
              <div className="text-xs font-medium text-slate-500">Adjusted Working Capital</div>
              <div className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                {fmtMoney.format(report.adjustedWorkingCapital)}
              </div>
              <div className="mt-1 text-xs text-slate-500 tabular-nums">
                Current Ratio {fmtRatio(report.currentRatio)} ·{' '}
                <span className={currentRatioHealthy ? 'text-emerald-700' : 'text-amber-700'}>
                  {currentRatioHealthy ? 'Above 1.25x min' : 'Below 1.25x'}
                </span>
              </div>
            </div>

            <div className="p-4">
              <div className="text-xs font-medium text-slate-500">
                Net Over / (Under) Billing
              </div>
              <div
                className={`mt-1.5 font-mono text-2xl font-semibold tabular-nums ${
                  report.netOverUnderBilling >= 0 ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {report.netOverUnderBilling >= 0
                  ? fmtMoney.format(report.netOverUnderBilling)
                  : `(${fmtMoney.format(Math.abs(report.netOverUnderBilling))})`}
              </div>
              <div className="mt-1 text-xs text-slate-500 tabular-nums">
                Over {fmtMoney.format(report.totalOverBillings)} · Under{' '}
                {fmtMoney.format(report.totalUnderBillings)}
              </div>
            </div>

            <div className="p-4">
              <div className="text-xs font-medium text-slate-500">Backlog / Working Capital</div>
              <div className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                {fmtRatio(report.backlogToWorkingCapital)}
              </div>
              <div className="mt-1 flex items-center gap-1 text-xs">
                {backlogWcHealthy ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Within 10.0x surety guideline
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-amber-700">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Elevated backlog leverage
                  </span>
                )}
              </div>
            </div>

            <div className="p-4">
              <div className="text-xs font-medium text-slate-500">
                Available Aggregate Capacity
              </div>
              <div className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                {fmtMoney.format(report.availableAggregateCapacity)}
              </div>
              <div className="mt-1 text-xs text-slate-500 tabular-nums">
                Open Backlog {fmtMoney.format(report.totalBacklog)} of{' '}
                {fmtMoney.format(assumptions.suretyAggregateLimit)}
              </div>
            </div>
          </div>

          {/* Balance Sheet & Surety Inputs + Reconciliation */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-1 text-sm font-semibold text-slate-900">
                Balance Sheet &amp; Surety Facility Inputs
              </h2>
              <p className="mb-4 text-xs text-slate-500">
                Update month-end GL balances below. WIP Underbillings, Overbillings, and Loss
                Reserves flow automatically into Current Assets &amp; Liabilities.
              </p>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(
                  [
                    { key: 'cashAndEquivalents', label: 'Cash & Equivalents ($)' },
                    { key: 'accountsReceivable', label: 'Accounts Receivable ($)' },
                    { key: 'otherCurrentAssets', label: 'Other Current Assets ($)' },
                    { key: 'accountsPayable', label: 'Accounts Payable ($)' },
                    { key: 'accruedLiabilities', label: 'Accrued Liabilities ($)' },
                    { key: 'lineOfCreditBalance', label: 'Line of Credit Drawn ($)' },
                    { key: 'netWorthEquity', label: 'Stockholders Equity / Net Worth ($)' },
                    { key: 'suretySingleLimit', label: 'Surety Single Job Limit ($)' },
                    { key: 'suretyAggregateLimit', label: 'Surety Aggregate Limit ($)' },
                  ] as const
                ).map((field) => (
                  <label key={field.key} className="block">
                    <span className="block text-[11px] font-medium text-slate-600">
                      {field.label}
                    </span>
                    <input
                      type="number"
                      value={assumptions[field.key]}
                      onChange={(e) =>
                        onUpdateAssumptions({ [field.key]: Number(e.target.value) || 0 })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 tabular-nums focus:border-[#0F293A] focus:outline-none"
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
                WIP-to-Balance-Sheet &amp; Covenant Summary
              </h2>
              <div className="divide-y divide-slate-100 text-xs">
                {[
                  ['Total Active Contracts', fmtMoney.format(report.totalContracts)],
                  ['Costs & Estimated Earnings (Earned Rev)', fmtMoney.format(report.totalEarnedRevenue)],
                  ['Billings to Date on Active Contracts', fmtMoney.format(report.totalBilled)],
                  ['Costs in Excess of Billings (Asset)', fmtMoney.format(report.totalUnderBillings)],
                  ['Billings in Excess of Costs (Liability)', fmtMoney.format(report.totalOverBillings)],
                  ['100% Loss Job Reserve Provision', fmtMoney.format(report.lossJobReserve)],
                  ['Total Uncompleted Backlog', fmtMoney.format(report.totalBacklog)],
                  ['Gross Profit Remaining in Backlog', fmtMoney.format(report.profitInBacklog)],
                  ['Total Current Assets (incl. Underbillings)', fmtMoney.format(report.currentAssets)],
                  [
                    'Total Current Liabilities (incl. Overbillings & Reserve)',
                    fmtMoney.format(report.currentLiabilities),
                  ],
                  ['Backlog / Net Worth Ratio', fmtRatio(report.backlogToEquity)],
                  [
                    'Largest Single Contract vs. Single Limit',
                    report.largestSingleBacklogJob
                      ? `${fmtPct(report.singleLimitUtilizationPct)} (${report.largestSingleBacklogJob.id})`
                      : '—',
                  ],
                ].map(([label, val]) => (
                  <div key={label} className="flex items-center justify-between py-2">
                    <span className="text-slate-600">{label}</span>
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">{val}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Division Exposure Breakdown */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">
              Division Backlog &amp; Billing Exposure
            </h2>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-slate-100 text-slate-700">
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2.5 font-semibold">Division</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Jobs</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Contracts</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Earned Rev.</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Billed</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Underbillings</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Overbillings</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Remaining Backlog</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Proj. GP%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.divisionBreakdown.map((d) => (
                    <tr key={d.division} className="hover:bg-slate-50/70">
                      <td className="px-3 py-2 font-medium text-slate-900">
                        {d.division} · {d.name}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{d.jobCount}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {fmtMoney.format(d.contract)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {fmtMoney.format(d.earnedRevenue)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {fmtMoney.format(d.billed)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-amber-700 tabular-nums">
                        {fmtMoney.format(d.underBillings)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-emerald-700 tabular-nums">
                        {fmtMoney.format(d.overBillings)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900 tabular-nums">
                        {fmtMoney.format(d.backlog)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {fmtPct(d.gpPct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Top 10 Open Contracts */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">
              Top 10 Open Contracts by Remaining Backlog
            </h2>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-slate-100 text-slate-700">
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2.5 font-semibold">Job</th>
                    <th className="px-3 py-2.5 font-semibold">Div</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Contract</th>
                    <th className="px-3 py-2.5 text-right font-semibold">% Comp</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Earned Rev.</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Billed</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Under / (Over)</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Backlog</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.topBacklogJobs.map((job) => {
                    const netUnderOver = job.underBillings - job.overBillings;
                    return (
                      <tr key={job.id} className="hover:bg-slate-50/70">
                        <td className="px-3 py-2">
                          <div className="font-semibold text-slate-900 tabular-nums">{job.id}</div>
                          <div className="text-[11px] text-slate-500 max-w-[240px] truncate">
                            {job.name}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-600">{job.division}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {fmtMoney.format(job.contract)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {fmtPct(job.pctComplete)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {fmtMoney.format(job.earnedRevenue)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {fmtMoney.format(job.billed)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right font-mono tabular-nums ${
                            netUnderOver > 0
                              ? 'text-amber-700'
                              : netUnderOver < 0
                              ? 'text-emerald-700'
                              : 'text-slate-500'
                          }`}
                        >
                          {netUnderOver === 0
                            ? '$0'
                            : netUnderOver > 0
                            ? fmtMoney.format(netUnderOver)
                            : `(${fmtMoney.format(Math.abs(netUnderOver))})`}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900 tabular-nums">
                          {fmtMoney.format(job.backlog)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
