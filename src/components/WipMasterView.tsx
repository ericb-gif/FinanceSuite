import React, { useMemo, useState } from 'react';
import { AlertCircle, Check, Download, FileSpreadsheet, Search } from 'lucide-react';
import { fmtMoney, fmtNum, fmtPct } from '../lib/formatters';
import { DIVISIONS, isJobBlocked, toCalculatedJob } from '../lib/wipEngine';
import type { DivisionCode, JoinedJob } from '../types/wip';

interface WipMasterViewProps {
  jobs: JoinedJob[];
  period: string;
  onUpdateJob: (index: number, patch: Partial<JoinedJob>) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onSelectVisible: (visibleIndices: number[]) => void;
  onDownloadLegacyWip: () => void;
  onDownloadMasterSuite: () => void;
  onRequestGoogleSync: () => void;
  canSyncGoogle: boolean;
}

export const WipMasterView: React.FC<WipMasterViewProps> = ({
  jobs,
  period,
  onUpdateJob,
  onSelectAll,
  onClearAll,
  onSelectVisible,
  onDownloadLegacyWip,
  onDownloadMasterSuite,
  onRequestGoogleSync,
  canSyncGoogle,
}) => {
  const [search, setSearch] = useState('');
  const [divisionFilter, setDivisionFilter] = useState('');

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs
      .map((job, index) => ({ job, index, calc: toCalculatedJob(job) }))
      .filter(({ job }) => {
        const matchesQuery = !q || `${job.id} ${job.name}`.toLowerCase().includes(q);
        const matchesDiv =
          !divisionFilter ||
          (divisionFilter === 'missing' ? !job.division : job.division === divisionFilter);
        return matchesQuery && matchesDiv;
      });
  }, [jobs, search, divisionFilter]);

  const selectedJobs = useMemo(() => jobs.filter((j) => j.selected), [jobs]);
  const blockedSelected = useMemo(() => selectedJobs.filter(isJobBlocked), [selectedJobs]);
  const totalBlocked = useMemo(() => jobs.filter(isJobBlocked).length, [jobs]);

  const totalContract = selectedJobs.reduce((s, r) => s + r.contract, 0);
  const totalProfit = selectedJobs.reduce((s, r) => s + (r.contract - r.cost), 0);
  const exportReady = selectedJobs.length > 0 && blockedSelected.length === 0;

  return (
    <div className="space-y-6">
      {/* Header & Primary Export Controls */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            01. WIP Master Schedule
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            {period ? `Period ending ${period}` : 'Current Spectrum import'} · {jobs.length} total
            WIP rows · Resolve missing divisions or hours before exporting or syncing
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            disabled={!exportReady}
            onClick={onDownloadLegacyWip}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            Original WIP (.xlsx)
          </button>
          <button
            type="button"
            disabled={!exportReady}
            onClick={onDownloadMasterSuite}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            6-Tab Suite (.xlsx)
          </button>
          <button
            type="button"
            disabled={!exportReady || !canSyncGoogle}
            onClick={onRequestGoogleSync}
            title={
              !canSyncGoogle
                ? 'Sign in and link or create a Master Google Sheet on the Import & Sync tab'
                : 'Update all 6 tabs in your Master Google Sheet'
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F293A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#173b52] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Sync to Master Google Sheet
          </button>
        </div>
      </div>

      {/* 4-Column Flat KPI Strip */}
      <div className="grid grid-cols-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white lg:grid-cols-4 lg:divide-x lg:divide-y-0">
        <div className="p-4">
          <div className="text-xs font-medium text-slate-500">Selected Jobs</div>
          <div className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {selectedJobs.length}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs font-medium text-slate-500">Total Contract</div>
          <div className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {fmtMoney.format(totalContract)}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs font-medium text-slate-500">Projected Profit</div>
          <div className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {fmtMoney.format(totalProfit)}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs font-medium text-slate-500">Needs Review</div>
          <div
            className={`mt-1.5 font-mono text-2xl font-semibold tabular-nums ${
              totalBlocked > 0 ? 'text-amber-700' : 'text-emerald-700'
            }`}
          >
            {totalBlocked}
          </div>
        </div>
      </div>

      {/* Filter & Bulk Selection Toolbar */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search job number or name…"
              aria-label="Search jobs"
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs text-slate-900 focus:border-[#0F293A] focus:outline-none"
            />
          </div>

          <select
            value={divisionFilter}
            onChange={(e) => setDivisionFilter(e.target.value)}
            aria-label="Filter division"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#0F293A] focus:outline-none"
          >
            <option value="">All divisions</option>
            {(Object.entries(DIVISIONS) as Array<[DivisionCode, string]>).map(([code, name]) => (
              <option key={code} value={code}>
                {code} · {name}
              </option>
            ))}
            <option value="missing">Missing division</option>
          </select>

          <button
            type="button"
            onClick={onSelectAll}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={onClearAll}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={() => onSelectVisible(filteredEntries.map((e) => e.index))}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            Select filtered jobs
          </button>
        </div>

        <p className="mt-2.5 text-xs text-slate-500">
          {blockedSelected.length > 0
            ? `${blockedSelected.length} selected job(s) require a division assignment or explicit zero-hours approval before exporting.`
            : `${selectedJobs.length} jobs verified and ready across all 6 reporting subsheets.`}
        </p>

        {/* High-Density WIP Data Grid */}
        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 max-h-[540px]">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
              <tr className="border-b border-slate-200">
                <th className="px-3 py-2.5 font-semibold">Include</th>
                <th className="px-3 py-2.5 font-semibold min-w-[230px]">Job / Name</th>
                <th className="px-3 py-2.5 font-semibold">Division</th>
                <th className="px-3 py-2.5 text-right font-semibold">Contract</th>
                <th className="px-3 py-2.5 text-right font-semibold">Proj. Cost</th>
                <th className="px-3 py-2.5 text-right font-semibold">GP%</th>
                <th className="px-3 py-2.5 text-right font-semibold">% Comp</th>
                <th className="px-3 py-2.5 text-right font-semibold">Proj. Hrs</th>
                <th className="px-3 py-2.5 text-right font-semibold">Act. Hrs</th>
                <th className="px-3 py-2.5 text-right font-semibold">Under / (Over)</th>
                <th className="px-3 py-2.5 font-semibold">Review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-slate-500">
                    No jobs match this search or division filter.
                  </td>
                </tr>
              ) : (
                filteredEntries.map(({ job, index, calc }) => {
                  const blocked = isJobBlocked(job);
                  const netUnderOver = calc.underBillings - calc.overBillings;
                  return (
                    <tr
                      key={job.id}
                      className={
                        blocked
                          ? 'bg-amber-50/70 text-slate-900'
                          : 'bg-white text-slate-800 hover:bg-slate-50/80'
                      }
                    >
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={job.selected}
                          onChange={(e) => onUpdateJob(index, { selected: e.target.checked })}
                          aria-label={`Include ${job.id}`}
                          className="h-4 w-4 rounded border-slate-300 accent-[#0F293A]"
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-slate-900 tabular-nums">{job.id}</div>
                        <div className="text-[11px] text-slate-500 leading-snug">{job.name}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        {job.manualDivision ? (
                          <select
                            value={job.division}
                            onChange={(e) =>
                              onUpdateJob(index, {
                                division: e.target.value as DivisionCode | '',
                              })
                            }
                            aria-label={`Division for ${job.id}`}
                            className="rounded border border-amber-300 bg-white px-2 py-1 text-xs text-slate-900"
                          >
                            <option value="">Choose division</option>
                            {(Object.entries(DIVISIONS) as Array<[DivisionCode, string]>).map(
                              ([d, n]) => (
                                <option key={d} value={d}>
                                  {d} · {n}
                                </option>
                              )
                            )}
                          </select>
                        ) : (
                          <span className="text-slate-700 whitespace-nowrap">
                            {job.division} · {DIVISIONS[job.division as DivisionCode]}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {fmtMoney.format(job.contract)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {fmtMoney.format(job.cost)}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                          calc.projectedProfit < 0 ? 'text-red-700 font-semibold' : ''
                        }`}
                      >
                        {fmtPct(calc.projectedGpPct)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {fmtPct(calc.pctComplete)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {job.missingHours ? '—' : fmtNum.format(job.hours)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {job.missingHours ? '—' : fmtNum.format(job.actualHours)}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-mono tabular-nums ${
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
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {job.missingHours ? (
                          <label className="inline-flex items-center gap-1.5 text-xs text-amber-900">
                            <input
                              type="checkbox"
                              checked={job.allowZero}
                              onChange={(e) => onUpdateJob(index, { allowZero: e.target.checked })}
                              className="h-3.5 w-3.5 accent-[#0F293A]"
                            />
                            Use zero hours
                          </label>
                        ) : job.manualDivision ? (
                          <span className="inline-flex items-center gap-1 text-amber-800">
                            <AlertCircle className="h-3.5 w-3.5" />
                            Manual division
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-emerald-700">
                            <Check className="h-3.5 w-3.5" />
                            Matched
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
