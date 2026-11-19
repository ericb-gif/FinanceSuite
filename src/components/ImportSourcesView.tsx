import React, { useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  FolderOpen,
  Link2,
  Plus,
  RefreshCw,
  Upload,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { GoogleSignInButton } from './GoogleSignInButton';
import type { DriveSpreadsheetItem, LinkedSheetInfo } from '../types/wip';

export interface SourceStatusState {
  wip: { status: string; loaded: boolean; count: number; fileName?: string };
  hours: { status: string; loaded: boolean; count: number; fileName?: string };
  jobs: { status: string; loaded: boolean; count: number; fileName?: string };
  priorWip: { status: string; loaded: boolean; count: number; fileName?: string };
}

interface ImportSourcesViewProps {
  sourceStatus: SourceStatusState;
  period: string;
  priorPeriod: string;
  isUsingSample: boolean;
  statusMessage: string;
  user: User | null;
  hasAccessToken: boolean;
  isLoggingIn: boolean;
  linkedSheet: LinkedSheetInfo | null;
  driveSheets: DriveSpreadsheetItem[];
  isLoadingDrive: boolean;
  onGoogleLogin: () => void;
  onGoogleLogout: () => void;
  onFileSelected: (type: 'wip' | 'hours' | 'jobs' | 'priorWip', file: File | null) => void;
  onLoadSample: () => void;
  onLinkSheetByInput: (urlOrId: string) => Promise<void>;
  onSelectDriveSheet: (spreadsheetId: string) => Promise<void>;
  onRefreshDriveSheets: () => Promise<void>;
  onRequestCreateSheet: (title: string) => void;
  onPullBaselineFromSheet: () => Promise<void>;
  onNavigateToWip: () => void;
}

export const ImportSourcesView: React.FC<ImportSourcesViewProps> = ({
  sourceStatus,
  period,
  priorPeriod,
  isUsingSample,
  statusMessage,
  user,
  hasAccessToken,
  isLoggingIn,
  linkedSheet,
  driveSheets,
  isLoadingDrive,
  onGoogleLogin,
  onGoogleLogout,
  onFileSelected,
  onLoadSample,
  onLinkSheetByInput,
  onSelectDriveSheet,
  onRefreshDriveSheets,
  onRequestCreateSheet,
  onPullBaselineFromSheet,
  onNavigateToWip,
}) => {
  const [sheetInput, setSheetInput] = useState('');
  const [newSheetTitle, setNewSheetTitle] = useState(
    `JRT Mechanical Master WIP — ${new Date().getFullYear()}`
  );
  const [sheetActionError, setSheetActionError] = useState('');
  const [isLinking, setIsLinking] = useState(false);

  const allCoreLoaded =
    sourceStatus.wip.loaded && sourceStatus.hours.loaded && sourceStatus.jobs.loaded;

  const handleLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sheetInput.trim()) return;
    setSheetActionError('');
    setIsLinking(true);
    try {
      await onLinkSheetByInput(sheetInput);
      setSheetInput('');
    } catch (err) {
      setSheetActionError(err instanceof Error ? err.message : 'Unable to open Google Sheet.');
    } finally {
      setIsLinking(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Intro & Quick Action Banner */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-wider text-[#B55C2C] uppercase">
            Finance · Work in Progress
          </p>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl text-balance">
            Spectrum WIP Import &amp; Master Google Sheet Hub
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-slate-600">
            Upload your Spectrum exports, review job divisions and hours, and sync all seven
            financial subsheets directly into your master Google Sheet.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onLoadSample}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            Load Sample Dataset
          </button>
          {allCoreLoaded && (
            <button
              type="button"
              onClick={onNavigateToWip}
              className="rounded-lg bg-[#0F293A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#173b52] whitespace-nowrap shrink-0"
            >
              Review WIP Master
            </button>
          )}
        </div>
      </div>

      {/* Status Notice */}
      <div
        role="status"
        aria-live="polite"
        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700"
      >
        <span>{statusMessage}</span>
        {(period || isUsingSample) && (
          <span className="text-xs text-slate-500 tabular-nums">
            {isUsingSample ? 'Sample dataset active' : 'Spectrum upload'}
            {period ? ` · Period ending ${period}` : ''}
            {priorPeriod ? ` · Prior baseline ${priorPeriod}` : ''}
          </span>
        )}
      </div>

      {/* Section 01: Spectrum Exports */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              01. Import Spectrum Source Reports
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Files are parsed locally in browser memory. Maximum 30 MB per workbook or PDF.
            </p>
          </div>
          {allCoreLoaded && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              All 3 core sources ready
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {(
            [
              {
                key: 'wip' as const,
                title: 'Current WIP Report',
                subtitle: 'Original Spectrum export · XLS or XLSX',
                accept: '.xls,.xlsx',
                required: true,
              },
              {
                key: 'hours' as const,
                title: 'Hours Report',
                subtitle: 'Job subtotal report · XLS or XLSX',
                accept: '.xls,.xlsx',
                required: true,
              },
              {
                key: 'jobs' as const,
                title: 'Active Jobs List',
                subtitle: 'Spectrum export · PDF, CSV, XLS or XLSX',
                accept: '.pdf,.csv,.xls,.xlsx',
                required: true,
              },
              {
                key: 'priorWip' as const,
                title: 'Prior Period WIP (Optional)',
                subtitle: 'Prior month export for Gains & Losses',
                accept: '.xls,.xlsx',
                required: false,
              },
            ] as const
          ).map((slot) => {
            const st = sourceStatus[slot.key];
            return (
              <label
                key={slot.key}
                className={`flex cursor-pointer flex-col justify-between rounded-lg border border-dashed p-4 transition-colors ${
                  st.loaded
                    ? 'border-emerald-300 bg-emerald-50/30'
                    : 'border-slate-300 bg-slate-50/70 hover:border-slate-400 hover:bg-slate-50'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900">{slot.title}</span>
                    <Upload className="h-4 w-4 text-slate-400 shrink-0" />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{slot.subtitle}</p>
                </div>

                <div className="mt-4">
                  <input
                    type="file"
                    accept={slot.accept}
                    onChange={(e) => onFileSelected(slot.key, e.target.files?.[0] || null)}
                    className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-100"
                  />
                  <div
                    className={`mt-2.5 text-xs ${
                      st.loaded ? 'font-medium text-emerald-700' : 'text-slate-500'
                    }`}
                  >
                    {st.status}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </section>

      {/* Section 02: Google Sheets Connection */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              02. Master Google Sheet Connection
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Connect your Google account to create a 7-subsheet master workbook or update an
              existing spreadsheet.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {user && hasAccessToken ? (
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-600">
                  Signed in as <strong className="text-slate-900">{user.email}</strong>
                </span>
                <button
                  type="button"
                  onClick={onGoogleLogout}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <GoogleSignInButton
                onClick={onGoogleLogin}
                disabled={isLoggingIn}
                label={isLoggingIn ? 'Connecting…' : 'Sign in with Google'}
              />
            )}
          </div>
        </div>

        {!user || !hasAccessToken ? (
          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
            Sign in with Google above to create a new 7-tab Master Google Sheet (`WIP Master`, `Gains
            &amp; Losses`, `Forecasts &amp; Fades`, `Cash Lookahead`, `Job Scorecard`, `Bank &amp;
            Bonding`, `Profit Forecast`), or link an existing Master Google Sheet to pull prior
            period balances and push updates.
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Left: Linked Sheet Status OR Create New */}
            <div className="space-y-4">
              {linkedSheet ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-medium text-emerald-800">
                        Active Master Workbook
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">
                        {linkedSheet.title}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        Tabs detected: {linkedSheet.sheetNames.join(' · ')}
                      </div>
                      {linkedSheet.lastSyncedAt && (
                        <div className="mt-1 text-xs text-slate-500">
                          Last updated at {linkedSheet.lastSyncedAt}
                        </div>
                      )}
                    </div>
                    <a
                      href={linkedSheet.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                    >
                      Open Sheet
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={onPullBaselineFromSheet}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                    >
                      Pull Prior Baseline &amp; Assumptions
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-medium text-slate-700">
                    No Master Google Sheet linked yet
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Create a new 7-subsheet master spreadsheet below, or paste an existing Google
                    Sheet URL on the right.
                  </p>
                </div>
              )}

              {/* Create New Master Spreadsheet */}
              <div className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                  <Plus className="h-4 w-4 text-[#B55C2C]" />
                  Create New 7-Subsheet Master Google Sheet
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={newSheetTitle}
                    onChange={(e) => setNewSheetTitle(e.target.value)}
                    placeholder="Spreadsheet title"
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-[#0F293A] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => onRequestCreateSheet(newSheetTitle.trim() || 'JRT Master WIP')}
                    disabled={!allCoreLoaded}
                    title={
                      allCoreLoaded
                        ? 'Create and populate new 7-tab Google Sheet'
                        : 'Load all 3 Spectrum sources first'
                    }
                    className="rounded-lg bg-[#0F293A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#173b52] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    Create &amp; Populate
                  </button>
                </div>
                {!allCoreLoaded && (
                  <p className="mt-2 text-xs text-slate-500">
                    Load your Spectrum files (or Sample Dataset) first to populate the new workbook.
                  </p>
                )}
              </div>
            </div>

            {/* Right: Paste URL or Pick Recent Sheet */}
            <div className="space-y-4">
              <form onSubmit={handleLinkSubmit} className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                  <Link2 className="h-4 w-4 text-slate-500" />
                  Link Existing Google Sheet by URL or ID
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={sheetInput}
                    onChange={(e) => setSheetInput(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-[#0F293A] focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={isLinking || !sheetInput.trim()}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {isLinking ? 'Connecting…' : 'Link Sheet'}
                  </button>
                </div>
                {sheetActionError && (
                  <p className="mt-2 text-xs text-red-600">{sheetActionError}</p>
                )}
              </form>

              <div className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                    <FolderOpen className="h-4 w-4 text-slate-500" />
                    Recent Workbooks Managed by This App
                  </div>
                  <button
                    type="button"
                    onClick={onRefreshDriveSheets}
                    disabled={isLoadingDrive}
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isLoadingDrive ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>

                {driveSheets.length === 0 ? (
                  <p className="mt-3 text-xs text-slate-500">
                    No spreadsheets created with this app yet. Create a new Master Sheet on the left
                    or paste an existing Google Sheet URL above.
                  </p>
                ) : (
                  <div className="mt-3 divide-y divide-slate-100 max-h-44 overflow-y-auto">
                    {driveSheets.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-3 py-2 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-700" />
                          <span className="truncate font-medium text-slate-800">{item.name}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => onSelectDriveSheet(item.id)}
                          className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                        >
                          {linkedSheet?.spreadsheetId === item.id ? 'Linked' : 'Select'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
