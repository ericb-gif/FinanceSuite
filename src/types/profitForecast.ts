export type PfDivisionCode = '00' | '01' | '02' | '03';

export interface PfWipJob {
  dept: string;
  job: string;
  key: string;
  name: string;
  contract: number;
  pcost: number;
  act: number;
  profit: number;
  billed: number;
}

export interface PfWipReport {
  asOf: string | null;
  jobs: PfWipJob[];
  file: string;
  sheet?: string;
}

export interface PfCostRow {
  job: string;
  key: string;
  name: string;
  vals: Record<number, number>;
}

export interface PfCostGroups {
  labJ?: number;
  matJ?: number;
  subJ?: number;
}

export interface PfCostMap {
  mtd: number;
  jtd: number;
  how: 'matched' | 'layout' | 'header' | 'manual';
  score?: number;
}

export interface PfCostReport {
  asOf: string | null;
  asOfOverride?: string | null;
  rows: PfCostRow[];
  header: string[];
  groups: PfCostGroups | null;
  file: string;
  map: PfCostMap | null;
}

export interface PfPnlDept {
  name: string;
  mtdOverhead: number;
  mtdWoProfit: number;
  mtdWoRevenue: number;
  mtdTotRevenue: number;
  mtdTotGP: number;
  totRevenue: number;
  totGP: number;
  overhead: number;
  woProfit: number;
  woRevenue: number;
  ytdNet: number | null;
  ytdRevenue: number | null;
  ytdGP: number | null;
  ytdOverhead: number | null;
  depAvg?: number;
  depYtd?: number;
  intAvg?: number;
  intYtd?: number;
}

export interface PfPnlReport {
  asOf: string | null;
  depts: Record<string, PfPnlDept>;
  file: string;
}

export interface PfAgingInvoice {
  key: string;
  date: string | null;
  amt: number;
  inv: string;
}

export interface PfAgingReport {
  kind: 'ar' | 'ap';
  file: string;
  asOf: string | null;
  lastDate?: string | null;
  jobs: Record<string, number>;
  invoices: PfAgingInvoice[];
  noJob: number;
  map: Record<string, number> | null;
}

export interface PfEstJob {
  job: string;
  name: string;
  div: string;
  orig: number;
  rev: number;
  gpEst: number;
  gpProj: number;
  pEst: number;
  pProj: number;
  pct: number | null;
  est: string;
  pm: string;
  sup: string;
}

export interface PfEstReport {
  asOf: string;
  kind?: string;
  file: string;
  jobs: Record<string, PfEstJob>;
}

export interface PfClosedJob {
  job: string;
  name: string;
  div: string;
  est: string;
  pm: string;
  cust: string;
  done: string;
  rev: number;
  ec: number;
  ac: number;
  hrs: [number, number];
  c: Record<string, [number, number]>;
}

export interface PfClosedReport {
  kind?: string;
  asOf?: string;
  file: string;
  jobs: PfClosedJob[];
}

export interface PfAdjustment {
  id: string;
  desc: string;
  value: number | '';
  cost: number | '';
  month: string;
  status?: string;
  doneMonth?: string;
  addCost?: boolean;
  at?: number;
}

export interface PfJobSetting {
  finish?: string | null;
  mode?: 'auto' | 'even' | 'peak' | 'tm' | null;
  rate?: number | null;
  gut?: 'gain' | 'flat' | 'fade' | null;
  gutAt?: string | null;
  gutBase?: number | null;
  gutNote?: string | null;
  targetGP?: number | null;
  fadeMode?: 'once' | 'gradual' | null;
  fadeMonth?: string | null;
  tm?: boolean | null;
  tmPct?: number | null;
  pct?: Record<string, number> | null;
  cos?: PfAdjustment[];
}

export interface PfLikelyJob {
  id: string;
  at?: number;
  name: string;
  dept: string;
  gp: number | '';
  rev: Record<string, number>;
}

export interface PfDivOverride {
  overhead?: number | '';
  woRevenue?: number | '';
  woProfit?: number | '';
  woPct?: number | '';
}

export interface PfDivMonthOverride {
  overhead?: Record<string, number>;
  woRevenue?: Record<string, number>;
  woProfit?: Record<string, number>;
  woPct?: Record<string, number>;
}

export interface PfCashSettings {
  collectDays?: number;
  billDay?: number;
  subsPWP?: boolean;
  matsPWP?: number;
  obHold?: number;
  bank?: number | '';
}

export interface PfRetentionItem {
  name: string;
  amt: number;
  date: string;
}

export interface PfLookaheadSettings {
  start: string;
  line0: number;
  weeks: number;
  limit: number;
  cushion: number;
  rate: number;
  schedInThru: string;
  schedOutThru: string;
  schedIn: Record<string, number>;
  schedOut: Record<string, number>;
  payroll: number;
  baseHours: number;
  fixedGross: number;
  fieldRate: number;
  health: number;
  hours: Record<string, number>;
  days: number;
  jobDays: Record<string, number>;
  pwp: number;
  matsLater: number;
  likelyNonLabor: number;
  svcDays: number;
  lanae: number;
  usbank: number;
  comdata: number;
  dor: number;
  auto: number;
  draws: number;
  quarterly: number;
  q1: string;
  q2: string;
  match: number;
  matchDate: string;
  retention: PfRetentionItem[];
  oneOff: PfRetentionItem[];
  spread?: Array<[number, number]>;
}

export interface PfWcSettings {
  asOf: string;
  ca: number;
  cl: number;
  locAsOf: number;
  limit: number;
  renew: string;
  rate: number;
  dep: number;
  principal: number;
  draws: number;
  cushion: number;
  slowDays: number;
  pwpShare: number;
  histInterest: number;
  vehBal: number;
  vehRate: number;
  capAmt: number;
  capMonth: string;
  thru: string;
  contDesc: string;
  contAmt: number;
  knownM1: string;
  knownV1: number;
  knownM2: string;
  knownV2: number;
  lineStart?: number | null;
}

export interface PfReportSettings {
  by?: string;
  notes?: string;
  span?: string;
  detail?: 'all' | 'gp' | 'rev' | 'none';
  wc?: Partial<PfWcSettings>;
}

export interface PfScorecardSettings {
  names: Record<string, string>;
  band: number;
  filter: 'all' | 'half' | 'done';
  who: string;
  st: string;
  clYears: string;
  clDiv: string;
  clBy: 'est' | 'pm' | 'cust' | 'div';
  clWho: string;
  clSt: string;
}

export interface PfSettings {
  horizon: number;
  threshold: number;
  includeLikely: boolean;
  serviceRunRate: boolean;
  jobs: Record<string, PfJobSetting>;
  likely: PfLikelyJob[];
  overrides: Record<string, PfDivOverride>;
  monthOv: Record<string, PfDivMonthOverride>;
  cash?: PfCashSettings;
  lookahead?: Partial<PfLookaheadSettings>;
  report?: PfReportSettings;
  scorecard?: Partial<PfScorecardSettings>;
}

export interface PfState {
  wip: PfWipReport | null;
  cost: PfCostReport | null;
  pnl: PfPnlReport | null;
  ar: PfAgingReport | null;
  ap: PfAgingReport | null;
  est: PfEstReport | null;
  closed: PfClosedReport | null;
  settings: PfSettings;
}

export interface PfMonthsWindow {
  months: string[];
  actual: string | null;
  first: string;
  gap: number;
}

export interface PfJobFlag {
  type: 'over' | 'loss' | 'nofinish' | 'pastfinish' | 'norate';
  amt?: number;
}

export interface PfJobMonth {
  k: string;
  cost: number;
  rev: number;
  gp: number;
  pct: number | null;
  est: number;
  cumGP: number;
  earned: number;
  actual: boolean;
  pctOv: number | null;
}

export interface PfForecastJob {
  key: string;
  job: PfWipJob;
  months: PfJobMonth[];
  flags: PfJobFlag[];
  tm?: boolean;
  tmPct?: number;
  tmHist?: number;
  rate: number | null;
  finish: string | null;
  mode: 'auto' | 'even' | 'peak' | 'tm';
  modeSet: string;
  C: number;
  Cfinal: number;
  Cbill: number;
  Pbase: number;
  finalCost: number;
  jtdStart: number;
  earned0: number;
  gpNow: number | null;
  gpWip: number | null;
  gpFinal: number | null;
  pctStart: number | null;
  remaining: number;
  target: number | null;
  coRev: number;
  coCost: number;
  coCount: number;
  active: boolean;
}

export interface PfDivMonth {
  rev: number;
  gp: number;
  jobRev: number;
  jobGP: number;
  woRev: number;
  woGP: number;
  woPct?: number;
  likelyRev: number;
  likelyGP: number;
  oh: number;
  net: number;
  fromMtd?: boolean;
}

export interface PfDivForecast {
  months: PfDivMonth[];
  oh: number;
  woGP: number;
  woRev: number;
  basePct: number;
  runRate: boolean;
}

export interface PfTotalMonth {
  rev: number;
  gp: number;
  oh: number;
  net: number;
  jobGP: number;
  woGP: number;
  likelyGP: number;
}

export interface PfNotOnWip {
  key: string;
  job: string;
  name: string;
  mtd: number;
}

export interface PfForecastResult {
  M: PfMonthsWindow;
  jobs: PfForecastJob[];
  div: Record<string, PfDivForecast>;
  total: PfTotalMonth[];
  notOnWip: PfNotOnWip[];
}

export interface PfCashItem {
  k: string;
  field: 'cin' | 'cout';
  key: string;
  label: string;
  amt: number;
}

export interface PfCashJobMonth {
  k: string;
  cin: number;
  cout: number;
  pos: number;
  target: number;
  ou: number;
}

export interface PfCashJobResult {
  key: string;
  f: PfForecastJob;
  arOpen: number;
  apOpen: number;
  billed: number;
  cashIn0: number;
  cashOut0: number;
  pos0: number;
  target0: number;
  ou0: number;
  months: PfCashJobMonth[];
  later: number;
  endProfit: number;
}

export interface PfCashResult {
  anchor: string;
  anchorOk: boolean;
  months: string[];
  jobs: PfCashJobResult[];
  tot: Array<{ cin: number; cout: number; net: number }>;
  pos0: number;
  target0: number;
  bills: Array<{ key: string; k: string; date: string; amt: number; cost: number }>;
  items: PfCashItem[];
  company: Array<{ k: string; jobsIn: number; jobsOut: number; wo: number; oh: number; net: number }>;
  startI: number;
}

export interface PfDrillItem {
  key: string | null;
  label: string;
  amt: number;
  week?: string;
  group?: string;
}

export interface PfLookaheadMonthSummary {
  k: string;
  ii: number[];
  end: number;
  high: number;
  highWk: string;
  partial: boolean;
}

export interface PfLookaheadResult {
  S: PfLookaheadSettings;
  W: string[];
  n: number;
  cin: Record<string, number[]>;
  cout: Record<string, number[]>;
  line: number[];
  tin: number[];
  tout: number[];
  M: PfLookaheadMonthSummary[];
  peak: number;
  need: number;
  sumM: (arr: number[], k: string) => number;
  ouBy: Record<string, number>;
  wcBy: Record<string, number>;
  items: Record<string, Array<{ i: number; key: string | null; label: string; amt: number }>>;
  mOf: (i: number) => string;
  hasModel: boolean;
}
