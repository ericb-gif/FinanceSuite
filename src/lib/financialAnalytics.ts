import { DIVISIONS } from './wipEngine';
import type {
  BankBondingReport,
  BondingAssumptions,
  CalculatedJob,
  CashAssumptions,
  CashWeekRow,
  DivisionCode,
  ForecastFadeRow,
  ForecastOverride,
  GainsLossesRow,
  HealthTier,
  JobCashPosition,
  JobScorecardRow,
  PriorJobSnapshot,
} from '../types/wip';

export const DEFAULT_CASH_ASSUMPTIONS: CashAssumptions = {
  startingCash: 1450000,
  retainagePct: 10,
  arCollectionDays: 45,
  apPaymentDays: 30,
  weeklyOverhead: 68000,
  locLimit: 2500000,
  locDrawn: 0,
};

export const DEFAULT_BONDING_ASSUMPTIONS: BondingAssumptions = {
  cashAndEquivalents: 1450000,
  accountsReceivable: 3280000,
  otherCurrentAssets: 420000,
  accountsPayable: 1680000,
  accruedLiabilities: 540000,
  lineOfCreditBalance: 0,
  netWorthEquity: 4650000,
  suretySingleLimit: 10000000,
  suretyAggregateLimit: 35000000,
};

export function buildGainsLosses(
  jobs: CalculatedJob[],
  priorMap: Map<string, PriorJobSnapshot>
): GainsLossesRow[] {
  return jobs.map((job) => {
    const prior = priorMap.get(job.id);
    const hasPrior = Boolean(prior);
    const contractDelta = prior ? job.contract - prior.contract : 0;
    const costDelta = prior ? job.cost - prior.cost : 0;
    const profitGainLoss = prior ? job.projectedProfit - prior.projectedProfit : 0;
    const gpPctDelta = prior ? job.projectedGpPct - prior.projectedGpPct : 0;
    const profitPerHrVariance = job.actualProfitPerHr - job.projectedProfitPerHr;
    const earnedVsBidGpDelta = job.actualGpPct - job.projectedGpPct;

    let classification: GainsLossesRow['classification'] = 'On Plan';
    if (job.projectedProfit < 0) {
      classification = 'Loss Job';
    } else if (hasPrior) {
      if (profitGainLoss >= 2500 || gpPctDelta >= 0.005) {
        classification = 'Gain';
      } else if (profitGainLoss <= -2500 || gpPctDelta <= -0.005) {
        classification = 'Fade';
      }
    } else if (profitPerHrVariance >= 5) {
      classification = 'Gain';
    } else if (profitPerHrVariance <= -5) {
      classification = 'Fade';
    }

    return {
      job,
      prior,
      hasPrior,
      contractDelta,
      costDelta,
      profitGainLoss,
      gpPctDelta,
      profitPerHrVariance,
      earnedVsBidGpDelta,
      classification,
    };
  });
}

export function buildForecastsFades(
  jobs: CalculatedJob[],
  overrides: Record<string, ForecastOverride>
): ForecastFadeRow[] {
  return jobs.map((job) => {
    const pctHoursSpent = job.hours > 0 ? job.actualHours / job.hours : 0;
    const pctCostSpent = job.cost > 0 ? job.actualCost / job.cost : 0;
    const burnRatio = pctCostSpent > 0 ? pctHoursSpent / pctCostSpent : 1;

    // Trended EAC Cost: if hours are burning faster than cost (or earned $/hr is trailing bid $/hr),
    // project remaining cost based on actual cost-per-hour efficiency when significant hours exist.
    let trendedEacCost = job.cost;
    if (job.actualHours >= 100 && job.hoursToComplete > 0 && job.actualCost > 0) {
      const laborEfficiencyFactor =
        pctCostSpent > 0.05 && pctHoursSpent > 0.05
          ? Math.max(0.85, Math.min(1.35, pctHoursSpent / pctCostSpent))
          : 1;
      trendedEacCost = job.actualCost + job.costToComplete * laborEfficiencyFactor;
    }

    const override = overrides[job.id];
    const effectiveEacCost =
      override?.adjustedCost !== undefined && Number.isFinite(override.adjustedCost)
        ? override.adjustedCost
        : trendedEacCost;

    const trendedFinalProfit = job.contract - effectiveEacCost;
    const projectedFadeAmount = trendedFinalProfit - job.projectedProfit;
    const trendedGpPct = job.contract > 0 ? trendedFinalProfit / job.contract : 0;

    let fadeRisk: ForecastFadeRow['fadeRisk'] = 'Healthy';
    if (
      job.projectedProfit < 0 ||
      projectedFadeAmount <= -25000 ||
      (job.contract > 0 && projectedFadeAmount / job.contract <= -0.025) ||
      burnRatio >= 1.15
    ) {
      fadeRisk = 'High';
    } else if (
      projectedFadeAmount <= -5000 ||
      (job.contract > 0 && projectedFadeAmount / job.contract <= -0.01) ||
      burnRatio >= 1.06
    ) {
      fadeRisk = 'Watch';
    }

    return {
      job,
      pctHoursSpent,
      pctCostSpent,
      burnRatio,
      trendedEacCost,
      effectiveEacCost,
      trendedFinalProfit,
      projectedFadeAmount,
      trendedGpPct,
      fadeRisk,
      override,
    };
  });
}

export function buildCashLookahead(
  jobs: CalculatedJob[],
  assumptions: CashAssumptions
): { weeks: CashWeekRow[]; jobPositions: JobCashPosition[] } {
  const totalBacklog = jobs.reduce((s, j) => s + Math.max(0, j.backlog), 0);
  const totalUnderbillings = jobs.reduce((s, j) => s + j.underBillings, 0);
  const totalCostToComplete = jobs.reduce((s, j) => s + j.costToComplete, 0);

  // Average GP% across backlog determines cost ratio on future billings
  const totalContract = jobs.reduce((s, j) => s + j.contract, 0);
  const totalCost = jobs.reduce((s, j) => s + j.cost, 0);
  const avgCostRatio = totalContract > 0 ? Math.min(1.05, totalCost / totalContract) : 0.78;

  // Model 13-week rolling backlog burn (~1 quarter = ~38% of active backlog depending on collection cycle)
  const retentionMultiplier = Math.max(0, 1 - assumptions.retainagePct / 100);
  const collectionLagWeeks = Math.max(1, Math.round(assumptions.arCollectionDays / 7));

  // Weekly pace: distribute ~45% of current backlog & 85% of current underbillings over 13 weeks
  const weeklyBacklogBurn = (totalBacklog * 0.45) / 13;
  const weeklyUnderbillingInflow = (totalUnderbillings * 0.85) / Math.max(4, collectionLagWeeks + 2);
  const weeklyDirectCostBase = (totalCostToComplete * 0.45) / 13;

  const weeks: CashWeekRow[] = [];
  let runningCash = assumptions.startingCash;

  for (let w = 1; w <= 13; w++) {
    // Slight front-loaded seasonal curve for weeks 2-8
    const pacingFactor = w <= 4 ? 1.04 : w <= 9 ? 1.0 : 0.94;
    const backlogBurnRevenue = weeklyBacklogBurn * pacingFactor;
    const underbillingCollection = w <= collectionLagWeeks + 4 ? weeklyUnderbillingInflow : weeklyUnderbillingInflow * 0.3;

    // Collection delay shifts new backlog billings out by ~AR collection weeks (partial cash from prior AR)
    const arReleaseFactor = w <= collectionLagWeeks ? 0.72 : 1.0;
    const scheduledBillings = backlogBurnRevenue * retentionMultiplier * arReleaseFactor + underbillingCollection;
    const directJobOutflows =
      weeklyDirectCostBase > 0 ? weeklyDirectCostBase * pacingFactor : backlogBurnRevenue * avgCostRatio;
    const overheadOutflow = assumptions.weeklyOverhead;
    const netCashFlow = scheduledBillings - directJobOutflows - overheadOutflow;
    runningCash += netCashFlow;

    const availableLiquidity = runningCash + Math.max(0, assumptions.locLimit - assumptions.locDrawn);

    weeks.push({
      weekNumber: w,
      label: `Week ${w}`,
      backlogBurnRevenue,
      underbillingCollection,
      scheduledBillings,
      directJobOutflows,
      overheadOutflow,
      netCashFlow,
      endingCash: runningCash,
      availableLiquidity,
    });
  }

  const jobPositions: JobCashPosition[] = jobs.map((job) => {
    const netBillingPosition = job.overBillings - job.underBillings;
    const estimatedRetainageHeld = job.billed * (assumptions.retainagePct / 100);
    const remainingCostOutflow = job.costToComplete;
    const netFutureCashFlow = job.backlog - remainingCostOutflow + estimatedRetainageHeld;
    return {
      job,
      netBillingPosition,
      estimatedRetainageHeld,
      remainingCostOutflow,
      netFutureCashFlow,
    };
  });

  return { weeks, jobPositions };
}

export function buildJobScorecard(
  jobs: CalculatedJob[],
  forecasts: ForecastFadeRow[],
  overrides: Record<string, ForecastOverride>
): JobScorecardRow[] {
  const forecastMap = new Map(forecasts.map((f) => [f.job.id, f]));

  // Compute division benchmark GP% (weighted by contract)
  const divBenchmarks: Record<string, number> = {};
  for (const div of Object.keys(DIVISIONS)) {
    const dJobs = jobs.filter((j) => j.division === div);
    const c = dJobs.reduce((s, j) => s + j.contract, 0);
    const p = dJobs.reduce((s, j) => s + j.projectedProfit, 0);
    divBenchmarks[div] = c > 0 ? p / c : 0.2;
  }

  return jobs.map((job) => {
    const forecast = forecastMap.get(job.id);
    const divisionBenchmarkGp = divBenchmarks[job.division] ?? 0.2;
    const gpSpreadVsBenchmark = job.projectedGpPct - divisionBenchmarkGp;
    const profitPerHrDelta = job.actualProfitPerHr - job.projectedProfitPerHr;

    const billingRatioPct =
      job.contract > 0 ? (job.overBillings - job.underBillings) / job.contract : 0;
    const billingPosture: JobScorecardRow['billingPosture'] =
      job.underBillings > Math.max(10000, job.contract * 0.03)
        ? 'Underbilled'
        : job.overBillings > Math.max(10000, job.contract * 0.03)
        ? 'Overbilled'
        : 'Balanced';

    const fadeRisk = forecast?.fadeRisk ?? 'Healthy';

    let healthTier: HealthTier = 'Strong';
    let primaryDriver = 'Margin & labor pace on target';

    if (job.projectedProfit < 0) {
      healthTier = 'Loss Job';
      primaryDriver = 'Negative projected margin';
    } else if (fadeRisk === 'High' || profitPerHrDelta <= -12) {
      healthTier = 'Action Required';
      primaryDriver =
        fadeRisk === 'High'
          ? 'Labor burn outpacing cost % complete'
          : 'Actual $/man-hr trailing bid';
    } else if (
      fadeRisk === 'Watch' ||
      (billingPosture === 'Underbilled' && job.underBillings > 50000) ||
      gpSpreadVsBenchmark < -0.05
    ) {
      healthTier = 'Watch';
      primaryDriver =
        billingPosture === 'Underbilled' && job.underBillings > 50000
          ? 'Significant unbilled WIP'
          : gpSpreadVsBenchmark < -0.05
          ? 'GP% below division average'
          : 'Mild hours burn variance';
    }

    return {
      job,
      divisionBenchmarkGp,
      gpSpreadVsBenchmark,
      profitPerHrDelta,
      billingPosture,
      billingRatioPct,
      fadeRisk,
      healthTier,
      primaryDriver,
      pmNote: overrides[job.id]?.pmNote || '',
    };
  });
}

export function buildBankBondingReport(
  jobs: CalculatedJob[],
  assumptions: BondingAssumptions
): BankBondingReport {
  const totalContracts = jobs.reduce((s, j) => s + j.contract, 0);
  const totalProjectedCost = jobs.reduce((s, j) => s + j.cost, 0);
  const totalProjectedProfit = jobs.reduce((s, j) => s + j.projectedProfit, 0);
  const totalActualCost = jobs.reduce((s, j) => s + j.actualCost, 0);
  const totalEarnedRevenue = jobs.reduce((s, j) => s + j.earnedRevenue, 0);
  const totalEarnedProfit = jobs.reduce((s, j) => s + j.earnedProfit, 0);
  const totalBilled = jobs.reduce((s, j) => s + j.billed, 0);
  const totalUnderBillings = jobs.reduce((s, j) => s + j.underBillings, 0);
  const totalOverBillings = jobs.reduce((s, j) => s + j.overBillings, 0);
  const netOverUnderBilling = totalOverBillings - totalUnderBillings;
  const totalBacklog = jobs.reduce((s, j) => s + j.backlog, 0);
  const profitInBacklog = jobs.reduce((s, j) => s + j.remainingProfit, 0);

  const lossJobs = jobs.filter((j) => j.projectedProfit < 0);
  const lossJobReserve = lossJobs.reduce((s, j) => s + Math.abs(j.projectedProfit), 0);

  // Construction GAAP / Surety Working Capital includes Costs in Excess of Billings (Underbillings) in Current Assets
  // and Billings in Excess of Costs (Overbillings) in Current Liabilities.
  const currentAssets =
    assumptions.cashAndEquivalents +
    assumptions.accountsReceivable +
    assumptions.otherCurrentAssets +
    totalUnderBillings;
  const currentLiabilities =
    assumptions.accountsPayable +
    assumptions.accruedLiabilities +
    assumptions.lineOfCreditBalance +
    totalOverBillings +
    lossJobReserve;

  const adjustedWorkingCapital = currentAssets - currentLiabilities;
  const currentRatio = currentLiabilities > 0 ? currentAssets / currentLiabilities : 0;
  const backlogToWorkingCapital =
    adjustedWorkingCapital > 0 ? totalBacklog / adjustedWorkingCapital : 0;
  const backlogToEquity =
    assumptions.netWorthEquity > 0 ? totalBacklog / assumptions.netWorthEquity : 0;
  const availableAggregateCapacity = Math.max(0, assumptions.suretyAggregateLimit - totalBacklog);

  const largestSingleBacklogJob =
    [...jobs].sort((a, b) => b.backlog - a.backlog)[0] || null;
  const singleLimitUtilizationPct =
    largestSingleBacklogJob && assumptions.suretySingleLimit > 0
      ? largestSingleBacklogJob.contract / assumptions.suretySingleLimit
      : 0;

  const divisionBreakdown = (Object.entries(DIVISIONS) as Array<[DivisionCode, string]>).map(
    ([division, name]) => {
      const dJobs = jobs.filter((j) => j.division === division);
      const contract = dJobs.reduce((s, j) => s + j.contract, 0);
      const projectedProfit = dJobs.reduce((s, j) => s + j.projectedProfit, 0);
      return {
        division,
        name,
        jobCount: dJobs.length,
        contract,
        earnedRevenue: dJobs.reduce((s, j) => s + j.earnedRevenue, 0),
        billed: dJobs.reduce((s, j) => s + j.billed, 0),
        underBillings: dJobs.reduce((s, j) => s + j.underBillings, 0),
        overBillings: dJobs.reduce((s, j) => s + j.overBillings, 0),
        backlog: dJobs.reduce((s, j) => s + j.backlog, 0),
        projectedProfit,
        gpPct: contract > 0 ? projectedProfit / contract : 0,
      };
    }
  );

  const topBacklogJobs = [...jobs].sort((a, b) => b.backlog - a.backlog).slice(0, 10);
  const materialUnderbilledJobs = jobs
    .filter((j) => j.underBillings > 0)
    .sort((a, b) => b.underBillings - a.underBillings)
    .slice(0, 10);

  return {
    totalContracts,
    totalProjectedCost,
    totalProjectedProfit,
    totalActualCost,
    totalEarnedRevenue,
    totalEarnedProfit,
    totalBilled,
    totalUnderBillings,
    totalOverBillings,
    netOverUnderBilling,
    totalBacklog,
    profitInBacklog,
    lossJobReserve,
    adjustedWorkingCapital,
    currentAssets,
    currentLiabilities,
    currentRatio,
    backlogToWorkingCapital,
    backlogToEquity,
    availableAggregateCapacity,
    largestSingleBacklogJob,
    singleLimitUtilizationPct,
    divisionBreakdown,
    topBacklogJobs,
    materialUnderbilledJobs,
    lossJobs,
  };
}
