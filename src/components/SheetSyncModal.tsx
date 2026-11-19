import React from 'react';
import { AlertTriangle, FileSpreadsheet, X } from 'lucide-react';
import { MASTER_SUBSHEET_NAMES } from '../lib/googleSheetsService';
import type { LinkedSheetInfo } from '../types/wip';

interface SheetSyncModalProps {
  open: boolean;
  linkedSheet: LinkedSheetInfo | null;
  pendingNewTitle?: string;
  period: string;
  jobCount: number;
  isSyncing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const SheetSyncModal: React.FC<SheetSyncModalProps> = ({
  open,
  linkedSheet,
  pendingNewTitle,
  period,
  jobCount,
  isSyncing,
  onCancel,
  onConfirm,
}) => {
  if (!open) return null;

  const isCreating = !linkedSheet && Boolean(pendingNewTitle);
  const targetTitle = linkedSheet?.title || pendingNewTitle || 'JRT Master WIP Workbook';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sync-modal-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-900">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h3 id="sync-modal-title" className="text-base font-semibold text-slate-900">
                {isCreating ? 'Create & Populate Master Google Sheet' : 'Confirm Master Google Sheet Update'}
              </h3>
              <p className="text-xs text-slate-500">
                {period ? `Period ending ${period}` : 'Current WIP run'} · {jobCount} selected jobs
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isSyncing}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close confirmation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5 text-sm text-slate-700">
          <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-900 flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-700" />
            <div>
              {isCreating ? (
                <span>
                  This will create a new Google Sheet named <strong>{targetTitle}</strong> in your Google
                  Drive and populate all 7 reporting subsheets with formulas and formatting.
                </span>
              ) : (
                <span>
                  This will clear and overwrite existing rows across all 7 subsheets in{' '}
                  <strong>{targetTitle}</strong>. Review the affected subsheets below before
                  proceeding.
                </span>
              )}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-slate-500">
              Affected subsheets ({MASTER_SUBSHEET_NAMES.length})
            </div>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {MASTER_SUBSHEET_NAMES.map((sheetName) => {
                const exists = linkedSheet?.sheetNames.includes(sheetName);
                const detail =
                  sheetName === 'WIP Master'
                    ? `${jobCount} jobs + division & grand totals`
                    : sheetName === 'Cash Lookahead'
                    ? '13-week rolling forecast + job cash positions'
                    : sheetName === 'Bank & Bonding'
                    ? 'Balance sheet covenants + surety capacity + top 10 backlog'
                    : sheetName === 'Profit Forecast'
                    ? 'Division P&L & multi-month job forecast'
                    : `${jobCount} job records`;
                return (
                  <div
                    key={sheetName}
                    className="flex items-center justify-between px-3.5 py-2 text-xs"
                  >
                    <span className="font-medium text-slate-900">{sheetName}</span>
                    <span className="text-slate-500">
                      {detail} · {isCreating || !exists ? 'Create tab' : 'Overwrite tab'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSyncing}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSyncing}
            className="rounded-lg bg-[#0F293A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#173b52] disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            {isSyncing
              ? 'Updating Google Sheet…'
              : isCreating
              ? 'Create & Populate Sheet'
              : 'Confirm & Update Sheet'}
          </button>
        </div>
      </div>
    </div>
  );
};
