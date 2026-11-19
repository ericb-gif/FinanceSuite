export type DivisionCode = '00' | '01' | '02' | '03';

export type WorkspaceTab =
  | 'import'
  | 'wip'
  | 'gains-losses'
  | 'forecasts-fades'
  | 'cash-lookahead'
  | 'job-scorecard'
  | 'bank-bonding'
  | 'profit-forecast'
  | 'calendar';

export interface WipRawRecord {
  id: string;
  name: string;
  contract: number;
  cost: number;
  actualCost: number;
  billed: number;
}

export interface HoursRecord {
  hours: number;
  actualHours: number;
}

export interface JoinedJob extends WipRawRecord, HoursRecord {
  division: DivisionCode | '';
  missingHours: boolean;
  manualDivision: boolean;
  allowZero: boolean;
  selected: boolean;
}

export interface CalculatedJob extends JoinedJob {
  projectedProfit: number;
  projectedGpPct: number;
  projectedProfitPerHr: number;
  pctComplete: number;
  earnedRevenue: number;
  earnedProfit: number;
  actualGpPct: number;
  actualProfitPerHr: number;
  hoursToComplete: number;
  underBillings: number;
  overBillings: number;
  backlog: number;
  backlogProfitPerHr: number;
  costToComplete: number;
  remainingProfit: number;
}

export interface PriorJobSnapshot {
  id: string;
  name: string;
  division: string;
  contract: number;
  cost: number;
  projectedProfit: number;
  projectedGpPct: number;
  actualCost: number;
  billed: number;
  earnedRevenue: number;
  earnedProfit: number;
  hours: number;
  actualHours: number;
}

export interface ForecastOverride {
  adjustedCost?: number;
  pmNote: string;
  fadeReason: string;
}

export interface GainsLossesRow {
  job: CalculatedJob;
  prior?: PriorJobSnapshot;
  hasPrior: boolean;
  contractDelta: number;
  costDelta: number;
  profitGainLoss: number;
  gpPctDelta: number;
  profitPerHrVariance: number;
  earnedVsBidGpDelta: number;
  classification: 'Gain' | 'Fade' | 'Loss Job' | 'On Plan';
}

export interface ForecastFadeRow {
  job: CalculatedJob;
  pctHoursSpent: number;
  pctCostSpent: number;
  burnRatio: number;
  trendedEacCost: number;
  effectiveEacCost: number;
  trendedFinalProfit: number;
  projectedFadeAmount: number;
  trendedGpPct: number;
  fadeRisk: 'High' | 'Watch' | 'Healthy';
  override?: ForecastOverride;
}

export interface CashAssumptions {
  startingCash: number;
  retainagePct: number;
  arCollectionDays: number;
  apPaymentDays: number;
  weeklyOverhead: number;
  locLimit: number;
  locDrawn: number;
}

export interface CashWeekRow {
  weekNumber: number;
  label: string;
  backlogBurnRevenue: number;
  underbillingCollection: number;
  scheduledBillings: number;
  directJobOutflows: number;
  overheadOutflow: number;
  netCashFlow: number;
  endingCash: number;
  availableLiquidity: number;
}

export interface JobCashPosition {
  job: CalculatedJob;
  netBillingPosition: number;
  estimatedRetainageHeld: number;
  remainingCostOutflow: number;
  netFutureCashFlow: number;
}

export type HealthTier = 'Strong' | 'Watch' | 'Action Required' | 'Loss Job';

export interface JobScorecardRow {
  job: CalculatedJob;
  divisionBenchmarkGp: number;
  gpSpreadVsBenchmark: number;
  profitPerHrDelta: number;
  billingPosture: 'Underbilled' | 'Balanced' | 'Overbilled';
  billingRatioPct: number;
  fadeRisk: 'High' | 'Watch' | 'Healthy';
  healthTier: HealthTier;
  primaryDriver: string;
  pmNote: string;
}

export interface BondingAssumptions {
  cashAndEquivalents: number;
  accountsReceivable: number;
  otherCurrentAssets: number;
  accountsPayable: number;
  accruedLiabilities: number;
  lineOfCreditBalance: number;
  netWorthEquity: number;
  suretySingleLimit: number;
  suretyAggregateLimit: number;
}

export interface BankBondingReport {
  totalContracts: number;
  totalProjectedCost: number;
  totalProjectedProfit: number;
  totalActualCost: number;
  totalEarnedRevenue: number;
  totalEarnedProfit: number;
  totalBilled: number;
  totalUnderBillings: number;
  totalOverBillings: number;
  netOverUnderBilling: number;
  totalBacklog: number;
  profitInBacklog: number;
  lossJobReserve: number;
  adjustedWorkingCapital: number;
  currentAssets: number;
  currentLiabilities: number;
  currentRatio: number;
  backlogToWorkingCapital: number;
  backlogToEquity: number;
  availableAggregateCapacity: number;
  largestSingleBacklogJob: CalculatedJob | null;
  singleLimitUtilizationPct: number;
  divisionBreakdown: Array<{
    division: DivisionCode;
    name: string;
    jobCount: number;
    contract: number;
    earnedRevenue: number;
    billed: number;
    underBillings: number;
    overBillings: number;
    backlog: number;
    projectedProfit: number;
    gpPct: number;
  }>;
  topBacklogJobs: CalculatedJob[];
  materialUnderbilledJobs: CalculatedJob[];
  lossJobs: CalculatedJob[];
}

export interface LinkedSheetInfo {
  spreadsheetId: string;
  title: string;
  url: string;
  sheetNames: string[];
  lastSyncedAt?: string;
}

export interface DriveSpreadsheetItem {
  id: string;
  name: string;
  modifiedTime?: string;
  webViewLink?: string;
}
