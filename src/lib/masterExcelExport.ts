import * as XLSX from 'xlsx';
import { buildProfitForecastRows } from './googleSheetsService';
import { DIVISIONS, WIP_HEADERS, calcWipArray, calcWipTotals } from './wipEngine';
import type { PfForecastResult, PfPnlReport, PfSettings } from '../types/profitForecast';
import type {
  BankBondingReport,
  BondingAssumptions,
  CalculatedJob,
  CashAssumptions,
  CashWeekRow,
  DivisionCode,
  ForecastFadeRow,
  GainsLossesRow,
  JobCashPosition,
  JobScorecardRow,
} from '../types/wip';

export function exportMasterSuiteXlsx(params: {
  period: string;
  jobs: CalculatedJob[];
  gainsLosses: GainsLossesRow[];
  forecastsFades: ForecastFadeRow[];
  cashAssumptions: CashAssumptions;
  cashWeeks: CashWeekRow[];
  jobCashPositions: JobCashPosition[];
  scorecard: JobScorecardRow[];
  bondingAssumptions: BondingAssumptions;
  bondingReport: BankBondingReport;
  profitForecast?: PfForecastResult | null;
  pfPnl?: PfPnlReport | null;
  pfSettings?: PfSettings | null;
}): Uint8Array {
  const wb = XLSX.utils.book_new();

  // 1. WIP Master
  const wipRows: (string | number)[][] = [
    [`JRT Mechanical WIP Master — Period Ending ${params.period || 'Current'}`],
    [...WIP_HEADERS],
  ];
  const divSubtotals: (string | number)[][] = [];
  for (const [div, name] of Object.entries(DIVISIONS) as Array<[DivisionCode, string]>) {
    const dJobs = params.jobs
      .filter((j) => j.division === div)
      .sort((a, b) => a.id.localeCompare(b.id));
    if (!dJobs.length) continue;
    wipRows.push([`${div} ${name}`]);
    const vals = dJobs.map(calcWipArray);
    vals.forEach((v) => wipRows.push(v));
    const tot = calcWipTotals(vals);
    tot[0] = `${name} Total`;
    tot[1] = '';
    tot[2] = '';
    wipRows.push(tot);
    divSubtotals.push(tot);
  }
  const grand = calcWipTotals(divSubtotals);
  grand[0] = 'Grand Total';
  grand[1] = '';
  grand[2] = '';
  grand[22] = Number(grand[19] || 0) - Number(grand[18] || 0);
  wipRows.push([]);
  wipRows.push(grand);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wipRows), 'WIP Master');

  // 2. Gains & Losses
  const glRows: (string | number)[][] = [
    [
      'Division',
      'Job #',
      'Job Name',
      'Classification',
      'Prior Contract',
      'Current Contract',
      'Prior Profit',
      'Current Profit',
      'Profit Gain/(Loss)',
      'GP% Delta',
      'Bid $/Hr',
      'Actual $/Hr',
      '$/Hr Variance',
    ],
    ...params.gainsLosses.map((g) => [
      `${g.job.division} ${DIVISIONS[g.job.division as DivisionCode] || ''}`,
      g.job.id,
      g.job.name,
      g.classification,
      g.prior?.contract ?? 0,
      g.job.contract,
      g.prior?.projectedProfit ?? g.job.projectedProfit,
      g.job.projectedProfit,
      g.profitGainLoss,
      g.gpPctDelta,
      g.job.projectedProfitPerHr,
      g.job.actualProfitPerHr,
      g.profitPerHrVariance,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(glRows), 'Gains & Losses');

  // 3. Forecasts & Fades
  const ffRows: (string | number)[][] = [
    [
      'Division',
      'Job #',
      'Job Name',
      'Contract',
      'Current Cost',
      '% Cost Spent',
      '% Hrs Spent',
      'Burn Ratio',
      'Trended EAC Cost',
      'Effective EAC Cost',
      'Trended Final Profit',
      'Projected Fade/(Gain)',
      'Fade Risk',
      'Fade Reason',
      'PM Note',
    ],
    ...params.forecastsFades.map((f) => [
      `${f.job.division} ${DIVISIONS[f.job.division as DivisionCode] || ''}`,
      f.job.id,
      f.job.name,
      f.job.contract,
      f.job.cost,
      f.pctCostSpent,
      f.pctHoursSpent,
      f.burnRatio,
      Math.round(f.trendedEacCost),
      Math.round(f.effectiveEacCost),
      Math.round(f.trendedFinalProfit),
      Math.round(f.projectedFadeAmount),
      f.fadeRisk,
      f.override?.fadeReason || '',
      f.override?.pmNote || '',
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ffRows), 'Forecasts & Fades');

  // 4. Cash Lookahead
  const cashRows: (string | number)[][] = [
    ['13-Week Rolling Cash Lookahead'],
    [
      'Week',
      'Backlog Revenue Burn',
      'Underbilling Collections',
      'Total Cash Inflows',
      'Direct Cost Outflows',
      'Weekly Overhead',
      'Net Cash Flow',
      'Ending Cash',
      'Available Liquidity',
    ],
    ...params.cashWeeks.map((w) => [
      w.label,
      Math.round(w.backlogBurnRevenue),
      Math.round(w.underbillingCollection),
      Math.round(w.scheduledBillings),
      Math.round(w.directJobOutflows),
      Math.round(w.overheadOutflow),
      Math.round(w.netCashFlow),
      Math.round(w.endingCash),
      Math.round(w.availableLiquidity),
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cashRows), 'Cash Lookahead');

  // 5. Job Scorecard
  const scRows: (string | number)[][] = [
    [
      'Division',
      'Job #',
      'Job Name',
      'Health Tier',
      'Contract',
      'Projected GP%',
      'Div Benchmark GP%',
      'GP Spread',
      'Billing Posture',
      'Fade Risk',
      'Primary Driver',
      'PM Note',
    ],
    ...params.scorecard.map((s) => [
      `${s.job.division} ${DIVISIONS[s.job.division as DivisionCode] || ''}`,
      s.job.id,
      s.job.name,
      s.healthTier,
      s.job.contract,
      s.job.projectedGpPct,
      s.divisionBenchmarkGp,
      s.gpSpreadVsBenchmark,
      s.billingPosture,
      s.fadeRisk,
      s.primaryDriver,
      s.pmNote,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(scRows), 'Job Scorecard');

  // 6. Bank & Bonding
  const bbRows: (string | number)[][] = [
    ['Bank & Surety Bonding Report', `Period Ending ${params.period || 'Current'}`],
    ['Metric', 'Value'],
    ['Total Active Contracts', params.bondingReport.totalContracts],
    ['Cost & Estimated Earnings (Earned Rev)', params.bondingReport.totalEarnedRevenue],
    ['Billings to Date', params.bondingReport.totalBilled],
    ['Underbillings (Asset)', params.bondingReport.totalUnderBillings],
    ['Overbillings (Liability)', params.bondingReport.totalOverBillings],
    ['Net Over/(Under) Billing', params.bondingReport.netOverUnderBilling],
    ['Remaining Backlog', params.bondingReport.totalBacklog],
    ['Gross Profit in Backlog', params.bondingReport.profitInBacklog],
    ['Loss Job Reserve', params.bondingReport.lossJobReserve],
    ['Adjusted Working Capital', params.bondingReport.adjustedWorkingCapital],
    ['Current Ratio', params.bondingReport.currentRatio],
    ['Backlog / Working Capital', params.bondingReport.backlogToWorkingCapital],
    ['Backlog / Net Worth', params.bondingReport.backlogToEquity],
    ['Available Aggregate Bonding Capacity', params.bondingReport.availableAggregateCapacity],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(bbRows), 'Bank & Bonding');

  // 7. Profit Forecast
  const pfBuilt = buildProfitForecastRows(
    params.profitForecast,
    params.pfPnl,
    params.pfSettings
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pfBuilt.values), 'Profit Forecast');

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Uint8Array(buf);
}
