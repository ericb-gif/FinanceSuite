import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  Calendar,
  CheckCircle2,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FolderSync,
  Landmark,
  LineChart,
  Menu,
  Scale,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { BankBondingView } from './components/BankBondingView';
import { CashLookaheadView } from './components/CashLookaheadView';
import { DrillModal } from './components/DrillModal';
import { FinancialCalendarView } from './components/FinancialCalendarView';
import { ForecastsFadesView } from './components/ForecastsFadesView';
import { GainsLossesView } from './components/GainsLossesView';
import { GoogleSignInButton } from './components/GoogleSignInButton';
import { ImportSourcesView, type SourceStatusState } from './components/ImportSourcesView';
import { JobForecastDrawer } from './components/JobForecastDrawer';
import { JobScorecardView } from './components/JobScorecardView';
import { ProfitForecastView } from './components/ProfitForecastView';
import { SheetSyncModal } from './components/SheetSyncModal';
import { WipMasterView } from './components/WipMasterView';
import {
  DEFAULT_BONDING_ASSUMPTIONS,
  DEFAULT_CASH_ASSUMPTIONS,
  buildBankBondingReport,
  buildCashLookahead,
  buildForecastsFades,
  buildGainsLosses,
  buildJobScorecard,
} from './lib/financialAnalytics';
import { getAccessToken, googleSignIn, initAuth, logout } from './lib/googleAuth';
import {
  createMasterSpreadsheet,
  getSpreadsheetMetadata,
  listManagedSpreadsheets,
  loadBaselineFromMasterSheet,
  parseSpreadsheetId,
  syncMasterWorkbookToGoogleSheet,
} from './lib/googleSheetsService';
import {
  buildLiquidity,
  buildLookahead,
  buildReport,
} from './lib/lookaheadEngine';
import { exportMasterSuiteXlsx } from './lib/masterExcelExport';
import {
  createDefaultPfSettings,
  detectCostColumns,
  identifyPfWorkbook,
  jobKey,
  joinedJobsToPfWip,
  loadJrtSnapshotFromAssets,
  parsePfAging,
  parsePfCost,
  parsePfPNL,
  parsePfWIP,
  pfWipToJoinedJobs,
  readExcelWorkbookSheets,
  runCash,
  runForecast,
} from './lib/profitForecastEngine';
import { buildClosed, buildScore, scIn } from './lib/scorecardEngine';
import {
  buildPriorSnapshotFromWip,
  createSampleSpectrumDataset,
  exportSingleWipXlsx,
  extractSheetRows,
  isJobBlocked,
  joinSources,
  parseActiveJobsPdf,
  parseActiveJobsTable,
  parseHoursWorkbook,
  parseWipWorkbook,
  toCalculatedJob,
} from './lib/wipEngine';
import type {
  PfCostMap,
  PfDivMonthOverride,
  PfDivOverride,
  PfDrillItem,
  PfJobSetting,
  PfLikelyJob,
  PfLookaheadSettings,
  PfReportSettings,
  PfScorecardSettings,
  PfSettings,
  PfState,
} from './types/profitForecast';
import type {
  BondingAssumptions,
  CashAssumptions,
  DivisionCode,
  DriveSpreadsheetItem,
  ForecastOverride,
  HoursRecord,
  JoinedJob,
  LinkedSheetInfo,
  PriorJobSnapshot,
  WipRawRecord,
  WorkspaceTab,
} from './types/wip';

interface NavItem {
  id: WorkspaceTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'import', label: 'Import & Sync', icon: FolderSync },
  { id: 'wip', label: '01. WIP Master', icon: FileSpreadsheet },
  { id: 'gains-losses', label: '02. Gains & Losses', icon: TrendingUp },
  { id: 'forecasts-fades', label: '03. Forecasts & Fades', icon: Activity },
  { id: 'cash-lookahead', label: '04. Cash Lookahead', icon: Wallet },
  { id: 'job-scorecard', label: '05. Job Scorecard', icon: BarChart3 },
  { id: 'bank-bonding', label: '06. Bank & Bonding', icon: Landmark },
  { id: 'profit-forecast', label: '07. Profit Forecast', icon: LineChart },
  { id: 'calendar', label: '08. Calendar', icon: Calendar },
];

const PF_REPORTS_STORAGE_KEY = 'pf.reports';
const PF_SETTINGS_STORAGE_KEY = 'pf.settings';

function persistPfState(next: PfState): void {
  try {
    localStorage.setItem(PF_SETTINGS_STORAGE_KEY, JSON.stringify(next.settings));
  } catch {
    // Ignore storage quota errors for settings
  }

  try {
    // Store reports without large static closed-jobs dump so we stay well below 5 MB quota
    const compactReports = {
      wip: next.wip,
      cost: next.cost,
      pnl: next.pnl,
      ar: next.ar,
      ap: next.ap,
      est: next.est,
    };
    localStorage.setItem(PF_REPORTS_STORAGE_KEY, JSON.stringify(compactReports));
  } catch {
    try {
      const strippedReports = {
        wip: next.wip,
        cost: next.cost,
        pnl: next.pnl,
        ar: next.ar ? { ...next.ar, invoices: [] } : null,
        ap: next.ap ? { ...next.ap, invoices: [] } : null,
        est: next.est,
      };
      localStorage.setItem(PF_REPORTS_STORAGE_KEY, JSON.stringify(strippedReports));
    } catch {
      // Ignore quota exceeded
    }
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('import');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Parsed source stores
  const wipSourceRef = useRef<{ map: Map<string, WipRawRecord>; period: string } | null>(null);
  const hoursSourceRef = useRef<{ map: Map<string, HoursRecord>; period: string } | null>(null);
  const jobsMapRef = useRef<Map<string, DivisionCode> | null>(null);
  const uploadVersionsRef = useRef<Record<string, number>>({});

  const [sourceStatus, setSourceStatus] = useState<SourceStatusState>({
    wip: { status: 'Loading JRT 2026 Snapshot…', loaded: false, count: 0 },
    hours: { status: 'Choose a report', loaded: false, count: 0 },
    jobs: { status: 'Choose a job list', loaded: false, count: 0 },
    priorWip: { status: 'Optional prior WIP', loaded: false, count: 0 },
  });

  const [jobs, setJobs] = useState<JoinedJob[]>([]);
  const [period, setPeriod] = useState('');
  const [priorPeriod, setPriorPeriod] = useState('');
  const [priorMap, setPriorMap] = useState<Map<string, PriorJobSnapshot>>(new Map());
  const [isUsingSample, setIsUsingSample] = useState(false);
  const [statusMessage, setStatusMessage] = useState(
    'Loading live JRT 2026 Snapshot across all 7 financial modules…'
  );

  // Profit Forecast & Integrated Financial Engines State (Tab 07 + Tabs 04/05/06)
  const [pfState, setPfState] = useState<PfState>(() => ({
    wip: null,
    cost: null,
    pnl: null,
    ar: null,
    ap: null,
    est: null,
    closed: null,
    settings: createDefaultPfSettings(),
  }));

  // Drawers & Modals for Profit Forecast / Cash Drill
  const [editingPfJobKey, setEditingPfJobKey] = useState<string | null>(null);
  const [drillState, setDrillState] = useState<{
    open: boolean;
    title: string;
    note?: string;
    items: PfDrillItem[];
  }>({ open: false, title: '', items: [] });

  // Editable modeling inputs across legacy subsheets 01-06
  const [overrides, setOverrides] = useState<Record<string, ForecastOverride>>({});
  const [cashAssumptions, setCashAssumptions] = useState<CashAssumptions>(
    DEFAULT_CASH_ASSUMPTIONS
  );
  const [bondingAssumptions, setBondingAssumptions] = useState<BondingAssumptions>(
    DEFAULT_BONDING_ASSUMPTIONS
  );

  // Google Auth & Master Sheet state
  const [user, setUser] = useState<User | null>(null);
  const [hasAccessToken, setHasAccessToken] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [linkedSheet, setLinkedSheet] = useState<LinkedSheetInfo | null>(null);
  const [driveSheets, setDriveSheets] = useState<DriveSpreadsheetItem[]>([]);
  const [isLoadingDrive, setIsLoadingDrive] = useState(false);

  // Explicit Sync Confirmation Modal state
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [pendingNewTitle, setPendingNewTitle] = useState<string | undefined>(undefined);
  const [isSyncingSheet, setIsSyncingSheet] = useState(false);
  const [bannerNotice, setBannerNotice] = useState<{
    type: 'success' | 'error';
    text: string;
    url?: string;
  } | null>(null);

  const updatePfState = useCallback((updater: (prev: PfState) => PfState) => {
    setPfState((prev) => {
      const next = updater(prev);
      persistPfState(next);
      return next;
    });
  }, []);

  const updatePfSettings = useCallback(
    (updater: (prevSettings: PfSettings) => PfSettings) => {
      updatePfState((prev) => ({
        ...prev,
        settings: updater(prev.settings),
      }));
    },
    [updatePfState]
  );

  const syncLegacyFromPfWip = useCallback((state: PfState, sourceTag: string) => {
    const bridged = pfWipToJoinedJobs(state.wip, state.est);
    if (!bridged.jobs.length) return;
    setJobs(bridged.jobs);
    if (bridged.period) setPeriod(bridged.period);
    setIsUsingSample(false);
    setSourceStatus({
      wip: {
        status: `${bridged.jobs.length} jobs loaded · ${state.wip?.file || sourceTag}`,
        loaded: true,
        count: bridged.jobs.length,
        fileName: state.wip?.file || sourceTag,
      },
      hours: {
        status: `${bridged.jobs.length} jobs (derived from ${sourceTag})`,
        loaded: true,
        count: bridged.jobs.length,
      },
      jobs: {
        status: `${bridged.jobs.length} divisions mapped`,
        loaded: true,
        count: bridged.jobs.length,
      },
      priorWip: { status: 'Optional prior WIP', loaded: false, count: 0 },
    });
    setStatusMessage(
      `${sourceTag} active: ${bridged.jobs.length} WIP jobs ready across all 7 financial subsheets.`
    );
  }, []);

  // Hydrate from localStorage or JRT 2026 Snapshot assets on initial mount
  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      let savedSettings: PfSettings | null = null;
      let savedReports: Partial<PfState> | null = null;

      try {
        const rawS = localStorage.getItem(PF_SETTINGS_STORAGE_KEY);
        if (rawS) {
          savedSettings = {
            ...createDefaultPfSettings(),
            ...(JSON.parse(rawS) as Partial<PfSettings>),
          };
        }
      } catch {
        savedSettings = null;
      }

      try {
        const rawR = localStorage.getItem(PF_REPORTS_STORAGE_KEY);
        if (rawR) {
          savedReports = JSON.parse(rawR) as Partial<PfState>;
        }
      } catch {
        savedReports = null;
      }

      if (savedReports?.wip?.jobs?.length) {
        const hydrated: PfState = {
          wip: savedReports.wip || null,
          cost: savedReports.cost || null,
          pnl: savedReports.pnl || null,
          ar: savedReports.ar || null,
          ap: savedReports.ap || null,
          est: savedReports.est || null,
          closed: savedReports.closed || null,
          settings: savedSettings || createDefaultPfSettings(),
        };

        if (!cancelled) {
          setPfState(hydrated);
          syncLegacyFromPfWip(hydrated, 'Saved Session');
        }

        // Fill static closed-jobs / est track-record data if omitted from localStorage
        if (!hydrated.closed || !hydrated.est) {
          const snap = await loadJrtSnapshotFromAssets();
          if (!cancelled && snap) {
            setPfState((prev) => ({
              ...prev,
              est: prev.est || snap.est,
              closed: prev.closed || snap.closed,
            }));
          }
        }
        return;
      }

      // First visit: auto-load JRT 2026 Snapshot
      const snap = await loadJrtSnapshotFromAssets();
      if (cancelled) return;

      if (snap) {
        const merged: PfState = {
          ...snap,
          settings: savedSettings || snap.settings,
        };
        setPfState(merged);
        persistPfState(merged);
        syncLegacyFromPfWip(merged, 'JRT 2026 Snapshot');
      } else {
        setSourceStatus((prev) => ({
          ...prev,
          wip: { status: 'Choose a report', loaded: false, count: 0 },
        }));
        setStatusMessage(
          'Upload all three Spectrum sources (or load the sample dataset) to begin.'
        );
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [syncLegacyFromPfWip]);

  const refreshDriveSheetsWithToken = useCallback(async (token: string) => {
    setIsLoadingDrive(true);
    try {
      const list = await listManagedSpreadsheets(token);
      setDriveSheets(list);
    } catch {
      // Token may lack drive list or expired; handled on user action
    } finally {
      setIsLoadingDrive(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = initAuth(
      (authedUser, token) => {
        setUser(authedUser);
        setHasAccessToken(Boolean(token));
        void refreshDriveSheetsWithToken(token);
      },
      (maybeUser) => {
        setUser(maybeUser);
        setHasAccessToken(false);
      }
    );
    return () => unsubscribe();
  }, [refreshDriveSheetsWithToken]);

  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    setBannerNotice(null);
    try {
      const res = await googleSignIn();
      setUser(res.user);
      setHasAccessToken(true);
      await refreshDriveSheetsWithToken(res.accessToken);
      setBannerNotice({
        type: 'success',
        text: `Connected to Google as ${res.user.email}. You can now create or update your Master Google Sheet.`,
      });
    } catch (err) {
      setBannerNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Google Sign-In failed.',
      });
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGoogleLogout = async () => {
    await logout();
    setUser(null);
    setHasAccessToken(false);
    setDriveSheets([]);
    setLinkedSheet(null);
  };

  const handleFileSelected = async (
    type: 'wip' | 'hours' | 'jobs' | 'priorWip',
    file: File | null
  ) => {
    const ver = (uploadVersionsRef.current[type] || 0) + 1;
    uploadVersionsRef.current[type] = ver;

    if (!file) {
      if (type === 'wip') wipSourceRef.current = null;
      if (type === 'hours') hoursSourceRef.current = null;
      if (type === 'jobs') jobsMapRef.current = null;
      if (type !== 'priorWip') setJobs([]);
      setSourceStatus((prev) => ({
        ...prev,
        [type]: {
          status: type === 'priorWip' ? 'Optional prior WIP' : 'Choose a file',
          loaded: false,
          count: 0,
        },
      }));
      return;
    }

    setSourceStatus((prev) => ({
      ...prev,
      [type]: { status: 'Reading…', loaded: false, count: 0, fileName: file.name },
    }));
    setStatusMessage(`Reading ${file.name}…`);

    try {
      if (file.size > 30 * 1024 * 1024) {
        throw new Error('File exceeds the 30 MB limit.');
      }

      const buffer = await file.arrayBuffer();
      if (uploadVersionsRef.current[type] !== ver) return;

      if (type === 'priorWip') {
        const parsedPrior = parseWipWorkbook(extractSheetRows(buffer));
        const snap = buildPriorSnapshotFromWip(parsedPrior);
        setPriorMap(snap);
        setPriorPeriod(parsedPrior.period || file.name);
        setSourceStatus((prev) => ({
          ...prev,
          priorWip: {
            status: `${snap.size} prior jobs · ${file.name}`,
            loaded: true,
            count: snap.size,
            fileName: file.name,
          },
        }));
        setStatusMessage(`Prior period baseline loaded (${snap.size} jobs).`);
        return;
      }

      let count = 0;
      if (type === 'wip') {
        const parsed = parseWipWorkbook(extractSheetRows(buffer));
        wipSourceRef.current = parsed;
        count = parsed.map.size;
      } else if (type === 'hours') {
        const parsed = parseHoursWorkbook(extractSheetRows(buffer));
        hoursSourceRef.current = parsed;
        count = parsed.map.size;
      } else {
        const parsed = /\.pdf$/i.test(file.name)
          ? await parseActiveJobsPdf(buffer)
          : parseActiveJobsTable(extractSheetRows(buffer));
        jobsMapRef.current = parsed;
        count = parsed.size;
      }

      if (uploadVersionsRef.current[type] !== ver) return;

      setIsUsingSample(false);
      setSourceStatus((prev) => ({
        ...prev,
        [type]: {
          status: `${count} jobs loaded · ${file.name}`,
          loaded: true,
          count,
          fileName: file.name,
        },
      }));

      const w = wipSourceRef.current;
      const h = hoursSourceRef.current;
      const j = jobsMapRef.current;

      if (w && h && j) {
        const joined = joinSources(w, h, j);
        const nextPeriod = w.period || h.period || '';
        setJobs(joined);
        setPeriod(nextPeriod);
        // Bi-directional sync into Profit Forecast state
        updatePfState((prev) => ({
          ...prev,
          wip: joinedJobsToPfWip(joined, nextPeriod, file.name),
        }));
        const extra = [...j.keys()].filter((k) => !w.map.has(k)).length;
        setStatusMessage(
          `Sources loaded. ${joined.length} WIP jobs matched for review. ${extra} active jobs have no WIP row and are excluded.`
        );
      } else {
        setStatusMessage('Upload the remaining Spectrum source files to assemble the WIP schedule.');
      }
    } catch (err) {
      if (uploadVersionsRef.current[type] !== ver) return;
      if (type === 'wip') wipSourceRef.current = null;
      if (type === 'hours') hoursSourceRef.current = null;
      if (type === 'jobs') jobsMapRef.current = null;
      if (type !== 'priorWip') setJobs([]);
      const msg = err instanceof Error ? err.message : 'Unable to parse file.';
      setSourceStatus((prev) => ({
        ...prev,
        [type]: { status: 'Could not load', loaded: false, count: 0 },
      }));
      setStatusMessage(msg);
    }
  };

  const handleLoadSample = () => {
    const sample = createSampleSpectrumDataset();
    setJobs(sample.jobs);
    setPeriod(sample.period);
    setPriorPeriod(sample.priorPeriod);
    setPriorMap(sample.priorMap);
    setIsUsingSample(true);
    updatePfState((prev) => ({
      ...prev,
      wip: joinedJobsToPfWip(sample.jobs, sample.period, 'Sample WIP Dataset'),
    }));
    setSourceStatus({
      wip: { status: `${sample.jobs.length} sample jobs loaded`, loaded: true, count: sample.jobs.length },
      hours: { status: `${sample.jobs.length - 1} hours subtotals loaded`, loaded: true, count: sample.jobs.length - 1 },
      jobs: { status: `${sample.jobs.length - 1} active jobs loaded`, loaded: true, count: sample.jobs.length - 1 },
      priorWip: { status: `${sample.priorMap.size} prior jobs loaded`, loaded: true, count: sample.priorMap.size },
    });
    setStatusMessage(
      `Sample JRT Mechanical dataset loaded (${sample.jobs.length} jobs; job 113368 requires manual review just like your Spectrum sample).`
    );
  };

  const handleUpdateJob = (index: number, patch: Partial<JoinedJob>) => {
    setJobs((prev) => {
      const next = prev.map((item, idx) => (idx === index ? { ...item, ...patch } : item));
      updatePfState((pfPrev) => ({
        ...pfPrev,
        wip: joinedJobsToPfWip(next, period, pfPrev.wip?.file || 'WIP Schedule'),
      }));
      return next;
    });
  };

  const syncJobsSelection = useCallback(
    (nextJobs: JoinedJob[]) => {
      updatePfState((pfPrev) => ({
        ...pfPrev,
        wip: joinedJobsToPfWip(nextJobs, period, pfPrev.wip?.file || 'WIP Schedule'),
      }));
    },
    [period, updatePfState]
  );

  const handleUpdateOverride = (jobId: string, patch: Partial<ForecastOverride>) => {
    setOverrides((prev) => ({
      ...prev,
      [jobId]: {
        pmNote: prev[jobId]?.pmNote || '',
        fadeReason: prev[jobId]?.fadeReason || '',
        adjustedCost: prev[jobId]?.adjustedCost,
        ...patch,
      },
    }));
  };

  // ---- Profit Forecast File Upload & Snapshot Reload ----
  const handlePfUploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (!list.length) return;

      const parsedKinds: string[] = [];
      const errors: string[] = [];

      let nextState = { ...pfState };
      let wipUpdated = false;

      for (const file of list) {
        try {
          const sheets = await readExcelWorkbookSheets(file);
          const kind = identifyPfWorkbook(sheets);
          if (!kind) {
            errors.push(`${file.name}: unrecognized Spectrum report format`);
            continue;
          }
          if (kind === 'wip') {
            nextState.wip = parsePfWIP(sheets, file.name);
            wipUpdated = true;
            parsedKinds.push(`WIP (${nextState.wip.jobs.length} jobs)`);
          } else if (kind === 'cost') {
            const c = parsePfCost(sheets, file.name);
            c.map = detectCostColumns(c, nextState.wip);
            nextState.cost = c;
            parsedKinds.push(`Job Cost (${c.rows.length} rows)`);
          } else if (kind === 'pnl') {
            nextState.pnl = parsePfPNL(sheets, file.name);
            parsedKinds.push('P&L');
          } else if (kind === 'ar') {
            nextState.ar = parsePfAging(sheets, file.name, 'ar');
            parsedKinds.push(`AR (${Object.keys(nextState.ar.jobs).length} jobs)`);
          } else if (kind === 'ap') {
            nextState.ap = parsePfAging(sheets, file.name, 'ap');
            parsedKinds.push(`AP (${Object.keys(nextState.ap.jobs).length} jobs)`);
          }
        } catch (err) {
          errors.push(
            `${file.name}: ${err instanceof Error ? err.message : 'failed to parse workbook'}`
          );
        }
      }

      if (nextState.cost && nextState.wip && nextState.cost.map?.how !== 'manual') {
        nextState.cost = {
          ...nextState.cost,
          map: detectCostColumns(nextState.cost, nextState.wip),
        };
      }

      setPfState(nextState);
      persistPfState(nextState);

      if (wipUpdated) {
        syncLegacyFromPfWip(nextState, 'Profit Forecast Upload');
      }

      if (errors.length) {
        setBannerNotice({
          type: 'error',
          text: `${parsedKinds.length ? `Loaded ${parsedKinds.join(', ')}. ` : ''}${errors.join('; ')}`,
        });
      } else if (parsedKinds.length) {
        setBannerNotice({
          type: 'success',
          text: `Loaded ${parsedKinds.join(', ')} into Profit Forecast & synced workbook state.`,
        });
      }
    },
    [pfState, syncLegacyFromPfWip]
  );

  const handleReloadSnapshot = useCallback(async () => {
    setBannerNotice(null);
    const snap = await loadJrtSnapshotFromAssets();
    if (!snap) {
      setBannerNotice({
        type: 'error',
        text: 'Could not reload JRT 2026 Snapshot files from assets.',
      });
      return;
    }
    setPfState(snap);
    persistPfState(snap);
    syncLegacyFromPfWip(snap, 'JRT 2026 Snapshot');
    setBannerNotice({
      type: 'success',
      text: `Reloaded live JRT 2026 Snapshot (${snap.wip?.jobs.length || 0} active WIP jobs, P&L, AR/AP, and 2020–2026 Closed Jobs).`,
    });
  }, [syncLegacyFromPfWip]);

  // Derived calculated data for legacy WIP & Subsheets 01-06
  const selectedValidJobs = useMemo(
    () => jobs.filter((j) => j.selected && !isJobBlocked(j)).map(toCalculatedJob),
    [jobs]
  );

  const exportReady = useMemo(() => {
    const selected = jobs.filter((j) => j.selected);
    return selected.length > 0 && selected.every((j) => !isJobBlocked(j));
  }, [jobs]);

  const gainsLossesRows = useMemo(
    () => buildGainsLosses(selectedValidJobs, priorMap),
    [selectedValidJobs, priorMap]
  );

  const forecastsFadesRows = useMemo(
    () => buildForecastsFades(selectedValidJobs, overrides),
    [selectedValidJobs, overrides]
  );

  const cashLookaheadData = useMemo(
    () => buildCashLookahead(selectedValidJobs, cashAssumptions),
    [selectedValidJobs, cashAssumptions]
  );

  const scorecardRows = useMemo(
    () => buildJobScorecard(selectedValidJobs, forecastsFadesRows, overrides),
    [selectedValidJobs, forecastsFadesRows, overrides]
  );

  const bankBondingReport = useMemo(
    () => buildBankBondingReport(selectedValidJobs, bondingAssumptions),
    [selectedValidJobs, bondingAssumptions]
  );

  // Derived Profit Forecast / Lookahead / Report / Scorecard Engines
  const pfForecast = useMemo(() => runForecast(pfState), [pfState]);

  const pfCash = useMemo(
    () => (pfForecast ? runCash(pfState, pfForecast) : null),
    [pfState, pfForecast]
  );

  const pfLookahead = useMemo(() => buildLookahead(pfState), [pfState]);

  const pfBuiltReport = useMemo(() => buildReport(pfState), [pfState]);

  const pfLiquidity = useMemo(
    () => (pfBuiltReport ? buildLiquidity(pfState, pfBuiltReport) : null),
    [pfState, pfBuiltReport]
  );

  const pfScorecard = useMemo(() => buildScore(pfState), [pfState]);

  const pfClosedTrack = useMemo(
    () => buildClosed(pfState, scIn(pfState)),
    [pfState]
  );

  const pfJobNameLookup = useCallback(
    (k: string): string => {
      const nKey = jobKey(k);
      const fMatch = pfForecast?.jobs.find((j) => j.key === nKey);
      if (fMatch) return `${fMatch.job.job} · ${fMatch.job.name}`;
      const wMatch = pfState.wip?.jobs.find((j) => j.key === nKey);
      if (wMatch) return `${wMatch.job} · ${wMatch.name}`;
      return `Job ${k}`;
    },
    [pfForecast, pfState.wip]
  );

  // Handlers for Profit Forecast & Upgraded Tabs
  const handleUpdateDivOverride = useCallback(
    (
      code: string,
      overridesPatch: PfDivOverride | null,
      monthOvPatch?: PfDivMonthOverride | null
    ) => {
      updatePfSettings((s) => {
        const nextOverrides = { ...s.overrides };
        const nextMonthOv = { ...s.monthOv };

        if (monthOvPatch === undefined || monthOvPatch === null) {
          if (overridesPatch === null) {
            delete nextOverrides[code];
          } else {
            nextOverrides[code] = overridesPatch;
          }
        } else {
          if (Object.keys(monthOvPatch).length === 0) {
            delete nextMonthOv[code];
          } else {
            nextMonthOv[code] = monthOvPatch;
          }
        }

        return {
          ...s,
          overrides: nextOverrides,
          monthOv: nextMonthOv,
        };
      });
    },
    [updatePfSettings]
  );

  const handleUpdateJobSetting = useCallback(
    (key: string, patch: Partial<PfJobSetting>) => {
      updatePfSettings((s) => ({
        ...s,
        jobs: {
          ...s.jobs,
          [key]: {
            ...(s.jobs[key] || {}),
            ...patch,
          },
        },
      }));
    },
    [updatePfSettings]
  );

  const handleResetJobSetting = useCallback(
    (key: string) => {
      updatePfSettings((s) => {
        const nextJobs = { ...s.jobs };
        delete nextJobs[key];
        return {
          ...s,
          jobs: nextJobs,
        };
      });
    },
    [updatePfSettings]
  );

  const handleUpdateLookahead = useCallback(
    (patch: Partial<PfLookaheadSettings>, resetAll?: boolean) => {
      updatePfSettings((s) => ({
        ...s,
        lookahead: resetAll ? {} : { ...(s.lookahead || {}), ...patch },
      }));
    },
    [updatePfSettings]
  );

  const handleUpdateScorecard = useCallback(
    (patch: Partial<PfScorecardSettings>) => {
      updatePfSettings((s) => ({
        ...s,
        scorecard: { ...(s.scorecard || {}), ...patch },
      }));
    },
    [updatePfSettings]
  );

  const handleUpdateReportSettings = useCallback(
    (patch: Partial<PfReportSettings>) => {
      updatePfSettings((s) => ({
        ...s,
        report: { ...(s.report || {}), ...patch },
      }));
    },
    [updatePfSettings]
  );

  const handleOpenDrill = useCallback(
    (title: string, items: PfDrillItem[], note?: string) => {
      setDrillState({ open: true, title, items, note });
    },
    []
  );

  const triggerDownload = (bytes: Uint8Array, filename: string) => {
    const bufferCopy = new Uint8Array(bytes).buffer;
    const url = URL.createObjectURL(
      new Blob([bufferCopy], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };

  const handleDownloadLegacyWip = async () => {
    try {
      const bytes = await exportSingleWipXlsx(jobs);
      triggerDownload(bytes, `JRT-WIP-${(period || 'report').replace(/\//g, '-')}.xlsx`);
      setBannerNotice({
        type: 'success',
        text: 'Original formula-based WIP Excel workbook downloaded.',
      });
    } catch (err) {
      setBannerNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Excel export failed.',
      });
    }
  };

  const handleDownloadMasterSuite = () => {
    try {
      const bytes = exportMasterSuiteXlsx({
        period,
        jobs: selectedValidJobs,
        gainsLosses: gainsLossesRows,
        forecastsFades: forecastsFadesRows,
        cashAssumptions,
        cashWeeks: cashLookaheadData.weeks,
        jobCashPositions: cashLookaheadData.jobPositions,
        scorecard: scorecardRows,
        bondingAssumptions,
        bondingReport: bankBondingReport,
        profitForecast: pfForecast,
        pfPnl: pfState.pnl,
        pfSettings: pfState.settings,
      });
      triggerDownload(
        bytes,
        `JRT-Financial-Suite-${(period || 'report').replace(/\//g, '-')}.xlsx`
      );
      setBannerNotice({
        type: 'success',
        text: '7-subsheet Master Excel workbook downloaded.',
      });
    } catch (err) {
      setBannerNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Master Excel export failed.',
      });
    }
  };

  const requireToken = async (): Promise<string> => {
    const existing = getAccessToken();
    if (existing) return existing;
    const res = await googleSignIn();
    setUser(res.user);
    setHasAccessToken(true);
    return res.accessToken;
  };

  const handleLinkSheet = async (spreadsheetId: string) => {
    const token = await requireToken();
    const meta = await getSpreadsheetMetadata(token, spreadsheetId);
    setLinkedSheet(meta);
    setBannerNotice({
      type: 'success',
      text: `Linked Master Google Sheet "${meta.title}".`,
      url: meta.url,
    });
  };

  const handleLinkSheetByInput = async (urlOrId: string) => {
    const id = parseSpreadsheetId(urlOrId);
    await handleLinkSheet(id);
  };

  const handlePullBaselineFromSheet = async () => {
    if (!linkedSheet) return;
    try {
      const token = await requireToken();
      const loaded = await loadBaselineFromMasterSheet(
        token,
        linkedSheet.spreadsheetId,
        linkedSheet.sheetNames
      );
      if (loaded.priorMap.size > 0) {
        setPriorMap(loaded.priorMap);
        setPriorPeriod(loaded.priorPeriod || 'Master Sheet Prior');
        setSourceStatus((prev) => ({
          ...prev,
          priorWip: {
            status: `${loaded.priorMap.size} jobs pulled from Master Sheet`,
            loaded: true,
            count: loaded.priorMap.size,
          },
        }));
      }
      if (Object.keys(loaded.overrides).length > 0) {
        setOverrides((prev) => ({ ...loaded.overrides, ...prev }));
      }
      if (loaded.cashAssumptions) {
        setCashAssumptions((prev) => ({ ...prev, ...loaded.cashAssumptions }));
      }
      if (loaded.bondingAssumptions) {
        setBondingAssumptions((prev) => ({ ...prev, ...loaded.bondingAssumptions }));
      }
      setBannerNotice({
        type: 'success',
        text: `Pulled ${loaded.priorMap.size} prior jobs, PM notes, and balance sheet assumptions from "${linkedSheet.title}".`,
      });
    } catch (err) {
      setBannerNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not read baseline from Google Sheet.',
      });
    }
  };

  const handleRequestCreateSheet = (title: string) => {
    setPendingNewTitle(title);
    setSyncModalOpen(true);
  };

  const handleRequestGoogleSync = () => {
    setPendingNewTitle(undefined);
    setSyncModalOpen(true);
  };

  const handleConfirmSync = async () => {
    setIsSyncingSheet(true);
    setBannerNotice(null);
    try {
      const token = await requireToken();
      let targetSheet = linkedSheet;
      if (!targetSheet || pendingNewTitle) {
        targetSheet = await createMasterSpreadsheet(
          token,
          pendingNewTitle || `JRT Mechanical Master WIP — ${period || 'Current'}`
        );
      }

      const updated = await syncMasterWorkbookToGoogleSheet(token, targetSheet.spreadsheetId, {
        period,
        jobs: selectedValidJobs,
        gainsLosses: gainsLossesRows,
        forecastsFades: forecastsFadesRows,
        cashAssumptions,
        cashWeeks: cashLookaheadData.weeks,
        jobCashPositions: cashLookaheadData.jobPositions,
        scorecard: scorecardRows,
        bondingAssumptions,
        bondingReport: bankBondingReport,
        profitForecast: pfForecast,
        pfPnl: pfState.pnl,
        pfSettings: pfState.settings,
      });

      setLinkedSheet(updated);
      setPendingNewTitle(undefined);
      setSyncModalOpen(false);
      await refreshDriveSheetsWithToken(token);
      setBannerNotice({
        type: 'success',
        text: `Updated all 7 subsheets in "${updated.title}" with live formulas and formatting.`,
        url: updated.url,
      });
    } catch (err) {
      setBannerNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Google Sheet update failed.',
      });
      setSyncModalOpen(false);
    } finally {
      setIsSyncingSheet(false);
    }
  };

  const currentNavLabel = NAV_ITEMS.find((n) => n.id === activeTab)?.label || 'Workspace';

  const renderNoDataState = (tabTitle: string) => (
    <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
        <Scale className="h-6 w-6" />
      </div>
      <h2 className="mt-4 text-base font-semibold text-slate-900">
        Load Spectrum Sources to View {tabTitle}
      </h2>
      <p className="mx-auto mt-1.5 max-w-md text-xs text-slate-500">
        Import your Spectrum WIP, Hours, and Active Jobs files—or reload the live JRT 2026 Snapshot
        to explore all seven financial modules right away.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => setActiveTab('import')}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
        >
          Go to Import Sources
        </button>
        <button
          type="button"
          onClick={() => void handleReloadSnapshot()}
          className="rounded-lg bg-[#0F293A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#173b52] whitespace-nowrap shrink-0"
        >
          Load JRT 2026 Snapshot
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-8 border-b border-slate-200 bg-white px-4 sm:px-6 no-print">
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setMobileNavOpen((v) => !v)}
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden"
            aria-label="Toggle navigation"
          >
            {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('import');
            }}
            className="font-display text-lg font-extrabold tracking-tight text-[#0F293A] whitespace-nowrap shrink-0"
          >
            JRT Mechanical
          </a>
        </div>

        <nav className="hidden md:flex items-center gap-2 text-xs font-medium text-slate-500 min-w-0">
          <span className="whitespace-nowrap shrink-0">Financial Suite</span>
          <span aria-hidden="true">/</span>
          <span className="text-slate-900 font-semibold truncate">{currentNavLabel}</span>
          {period && (
            <>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums whitespace-nowrap shrink-0">
                Period {period}
              </span>
            </>
          )}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          {!user || !hasAccessToken ? (
            <GoogleSignInButton
              onClick={handleGoogleLogin}
              disabled={isLoggingIn}
              label={isLoggingIn ? 'Signing in…' : 'Sign in with Google'}
            />
          ) : linkedSheet ? (
            <button
              type="button"
              onClick={handleRequestGoogleSync}
              disabled={!exportReady}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F293A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#173b52] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Sync Master Sheet
            </button>
          ) : (
            <button
              type="button"
              onClick={handleDownloadMasterSuite}
              disabled={!exportReady}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F293A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#173b52] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              Export 7-Tab Workbook
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-1">
        {/* Desktop Sidebar Navigation */}
        <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-slate-200 lg:bg-white lg:px-4 lg:py-6 shrink-0 no-print">
          <div className="mb-2 px-3 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
            Workbook Modules
          </div>
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-[#0F293A] text-white'
                      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Linked Master Sheet Summary */}
          <div className="mt-auto pt-6 border-t border-slate-100">
            <div className="px-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Master Sheet Target
            </div>
            {linkedSheet ? (
              <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                <div className="font-semibold text-slate-900 truncate" title={linkedSheet.title}>
                  {linkedSheet.title}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  {linkedSheet.lastSyncedAt
                    ? `Synced ${linkedSheet.lastSyncedAt}`
                    : 'Ready to sync 7 tabs'}
                </div>
                <a
                  href={linkedSheet.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-[#0F293A] hover:underline"
                >
                  Open in Google Sheets
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ) : (
              <div className="mt-2 px-2 text-xs text-slate-500">
                No Google Sheet linked. Connect on Import &amp; Sync.
              </div>
            )}
          </div>
        </aside>

        {/* Mobile Navigation Drawer */}
        {mobileNavOpen && (
          <div className="fixed inset-0 top-16 z-40 bg-slate-900/40 lg:hidden no-print">
            <div className="w-64 h-full bg-white border-r border-slate-200 p-4 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileNavOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs font-medium ${
                      isActive ? 'bg-[#0F293A] text-white' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Main Viewport */}
        <main className="flex-1 min-w-0 px-4 py-6 sm:px-8 max-w-[1440px]">
          {bannerNotice && (
            <div
              role="status"
              className={`mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-xs no-print ${
                bannerNotice.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-red-200 bg-red-50 text-red-900'
              }`}
            >
              <div className="flex items-center gap-2">
                {bannerNotice.type === 'success' && (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
                )}
                <span>{bannerNotice.text}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {bannerNotice.url && (
                  <a
                    href={bannerNotice.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-semibold underline"
                  >
                    Open Sheet
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setBannerNotice(null)}
                  className="text-slate-500 hover:text-slate-800"
                  aria-label="Dismiss message"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {activeTab === 'import' && (
            <ImportSourcesView
              sourceStatus={sourceStatus}
              period={period}
              priorPeriod={priorPeriod}
              isUsingSample={isUsingSample}
              statusMessage={statusMessage}
              user={user}
              hasAccessToken={hasAccessToken}
              isLoggingIn={isLoggingIn}
              linkedSheet={linkedSheet}
              driveSheets={driveSheets}
              isLoadingDrive={isLoadingDrive}
              onGoogleLogin={handleGoogleLogin}
              onGoogleLogout={handleGoogleLogout}
              onFileSelected={handleFileSelected}
              onLoadSample={handleLoadSample}
              onLinkSheetByInput={handleLinkSheetByInput}
              onSelectDriveSheet={handleLinkSheet}
              onRefreshDriveSheets={async () => {
                const t = getAccessToken();
                if (t) await refreshDriveSheetsWithToken(t);
              }}
              onRequestCreateSheet={handleRequestCreateSheet}
              onPullBaselineFromSheet={handlePullBaselineFromSheet}
              onNavigateToWip={() => setActiveTab('wip')}
            />
          )}

          {activeTab === 'wip' &&
            (jobs.length === 0 ? (
              renderNoDataState('WIP Master')
            ) : (
              <WipMasterView
                jobs={jobs}
                period={period}
                onUpdateJob={handleUpdateJob}
                onSelectAll={() =>
                  setJobs((prev) => {
                    const next = prev.map((j) => ({ ...j, selected: true }));
                    syncJobsSelection(next);
                    return next;
                  })
                }
                onClearAll={() =>
                  setJobs((prev) => {
                    const next = prev.map((j) => ({ ...j, selected: false }));
                    syncJobsSelection(next);
                    return next;
                  })
                }
                onSelectVisible={(indices) => {
                  const setIdx = new Set(indices);
                  setJobs((prev) => {
                    const next = prev.map((j, idx) =>
                      setIdx.has(idx) ? { ...j, selected: true } : j
                    );
                    syncJobsSelection(next);
                    return next;
                  });
                }}
                onDownloadLegacyWip={handleDownloadLegacyWip}
                onDownloadMasterSuite={handleDownloadMasterSuite}
                onRequestGoogleSync={handleRequestGoogleSync}
                canSyncGoogle={Boolean(user && hasAccessToken && linkedSheet)}
              />
            ))}

          {activeTab === 'gains-losses' &&
            (selectedValidJobs.length === 0 ? (
              renderNoDataState('Gains & Losses')
            ) : (
              <GainsLossesView
                rows={gainsLossesRows}
                period={period}
                priorPeriod={priorPeriod}
              />
            ))}

          {activeTab === 'forecasts-fades' &&
            (selectedValidJobs.length === 0 ? (
              renderNoDataState('Forecasts & Fades')
            ) : (
              <ForecastsFadesView
                rows={forecastsFadesRows}
                period={period}
                onUpdateOverride={handleUpdateOverride}
              />
            ))}

          {activeTab === 'cash-lookahead' &&
            (selectedValidJobs.length === 0 && !pfLookahead ? (
              renderNoDataState('Cash Lookahead')
            ) : (
              <CashLookaheadView
                assumptions={cashAssumptions}
                weeks={cashLookaheadData.weeks}
                jobPositions={cashLookaheadData.jobPositions}
                period={period}
                onUpdateAssumptions={(patch) =>
                  setCashAssumptions((prev) => ({ ...prev, ...patch }))
                }
                pfState={pfState}
                lookahead={pfLookahead}
                onUpdateLookahead={handleUpdateLookahead}
                onOpenDrill={handleOpenDrill}
              />
            ))}

          {activeTab === 'job-scorecard' &&
            (selectedValidJobs.length === 0 && !pfState.est && !pfState.closed ? (
              renderNoDataState('Job Scorecard')
            ) : (
              <JobScorecardView
                rows={scorecardRows}
                period={period}
                onUpdateNote={handleUpdateOverride}
                pfState={pfState}
                scoreResult={pfScorecard}
                closedResult={pfClosedTrack}
                onUpdateScorecard={handleUpdateScorecard}
                onOpenJob={(key) => setEditingPfJobKey(key)}
              />
            ))}

          {activeTab === 'bank-bonding' &&
            (selectedValidJobs.length === 0 && !pfBuiltReport ? (
              renderNoDataState('Bank & Bonding Report')
            ) : (
              <BankBondingView
                assumptions={bondingAssumptions}
                report={bankBondingReport}
                period={period}
                onUpdateAssumptions={(patch) =>
                  setBondingAssumptions((prev) => ({ ...prev, ...patch }))
                }
                pfState={pfState}
                builtReport={pfBuiltReport}
                liquidity={pfLiquidity}
                onUpdateReportSettings={handleUpdateReportSettings}
                onNotice={(type, text) => setBannerNotice({ type, text })}
              />
            ))}

          {activeTab === 'profit-forecast' && (
            <ProfitForecastView
              pfState={pfState}
              forecast={pfForecast}
              cash={pfCash}
              onUpdateGlobal={(patch) => updatePfSettings((s) => ({ ...s, ...patch }))}
              onUpdateDivOverride={handleUpdateDivOverride}
              onUpdateLikely={(likely: PfLikelyJob[]) =>
                updatePfSettings((s) => ({ ...s, likely }))
              }
              onUpdateCostMap={(map: PfCostMap, asOfOverride?: string | null) =>
                updatePfState((prev) => ({
                  ...prev,
                  cost: prev.cost
                    ? {
                        ...prev.cost,
                        map,
                        asOfOverride:
                          asOfOverride === undefined ? prev.cost.asOfOverride : asOfOverride,
                      }
                    : null,
                }))
              }
              onUpdateWipMonth={(asOf: string | null) => {
                updatePfState((prev) => ({
                  ...prev,
                  wip: prev.wip ? { ...prev.wip, asOf } : null,
                }));
              }}
              onUpdateAgingMonth={(kind: 'ar' | 'ap', asOf: string | null) => {
                updatePfState((prev) => ({
                  ...prev,
                  [kind]: prev[kind] ? { ...prev[kind], asOf } : null,
                }));
              }}
              onUploadFiles={handlePfUploadFiles}
              onReloadSnapshot={handleReloadSnapshot}
              onEditJob={(key: string) => setEditingPfJobKey(key)}
              onOpenDrill={handleOpenDrill}
            />
          )}

          {activeTab === 'calendar' && (
            <FinancialCalendarView
              user={user}
              hasAccessToken={hasAccessToken}
              isLoggingIn={isLoggingIn}
              onGoogleLogin={handleGoogleLogin}
              pfState={pfState}
              pfForecast={pfForecast}
              pfLookahead={pfLookahead}
              onNotice={(type, text) => setBannerNotice({ type, text })}
            />
          )}
        </main>
      </div>

      <JobForecastDrawer
        jobKey={editingPfJobKey}
        state={pfState}
        forecast={pfForecast}
        cash={pfCash}
        onClose={() => setEditingPfJobKey(null)}
        onUpdateJobSetting={handleUpdateJobSetting}
        onResetJobSetting={handleResetJobSetting}
      />

      <DrillModal
        open={drillState.open}
        title={drillState.title}
        note={drillState.note}
        items={drillState.items}
        jobNameLookup={pfJobNameLookup}
        onClose={() => setDrillState((prev) => ({ ...prev, open: false }))}
        onOpenJob={(key) => {
          setDrillState((prev) => ({ ...prev, open: false }));
          setEditingPfJobKey(key);
        }}
      />

      <SheetSyncModal
        open={syncModalOpen}
        linkedSheet={pendingNewTitle ? null : linkedSheet}
        pendingNewTitle={pendingNewTitle}
        period={period}
        jobCount={selectedValidJobs.length}
        isSyncing={isSyncingSheet}
        onCancel={() => {
          setSyncModalOpen(false);
          setPendingNewTitle(undefined);
        }}
        onConfirm={handleConfirmSync}
      />
    </div>
  );
}
