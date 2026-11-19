import {
  DIVISIONS,
  WIP_HEADERS,
  calcWipArray,
  calcWipTotals,
  parseNumber,
} from './wipEngine';
import {
  DEPT_ORDER,
  DEPTS,
  gutDollars,
  gutLabel,
  gutOf,
  mLabel,
  modeText,
} from './profitForecastEngine';
import type { PfForecastResult, PfPnlReport, PfSettings } from '../types/profitForecast';
import type {
  BankBondingReport,
  BondingAssumptions,
  CalculatedJob,
  CashAssumptions,
  CashWeekRow,
  DivisionCode,
  DriveSpreadsheetItem,
  ForecastFadeRow,
  ForecastOverride,
  GainsLossesRow,
  JobCashPosition,
  JobScorecardRow,
  LinkedSheetInfo,
  PriorJobSnapshot,
} from '../types/wip';

export const MASTER_SUBSHEET_NAMES = [
  'WIP Master',
  'Gains & Losses',
  'Forecasts & Fades',
  'Cash Lookahead',
  'Job Scorecard',
  'Bank & Bonding',
  'Profit Forecast',
] as const;

export function parseSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
  throw new Error('Enter a valid Google Sheets URL or Spreadsheet ID.');
}

async function googleFetch<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `Google API request failed (${res.status})`;
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data as T;
}

export async function listManagedSpreadsheets(token: string): Promise<DriveSpreadsheetItem[]> {
  const params = new URLSearchParams({
    q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    orderBy: 'modifiedTime desc',
    pageSize: '20',
    fields: 'files(id,name,modifiedTime,webViewLink)',
  });
  const data = await googleFetch<{ files?: DriveSpreadsheetItem[] }>(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    token
  );
  return data.files || [];
}

export async function getSpreadsheetMetadata(
  token: string,
  spreadsheetId: string
): Promise<LinkedSheetInfo> {
  const data = await googleFetch<{
    spreadsheetId: string;
    spreadsheetUrl: string;
    properties: { title: string };
    sheets: Array<{ properties: { sheetId: number; title: string } }>;
  }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(sheetId,title)`,
    token
  );

  return {
    spreadsheetId: data.spreadsheetId,
    title: data.properties.title,
    url: data.spreadsheetUrl,
    sheetNames: data.sheets.map((s) => s.properties.title),
  };
}

export async function createMasterSpreadsheet(
  token: string,
  title: string
): Promise<LinkedSheetInfo> {
  const body = {
    properties: { title },
    sheets: MASTER_SUBSHEET_NAMES.map((name, idx) => ({
      properties: {
        title: name,
        index: idx,
        gridProperties: { frozenRowCount: name === 'WIP Master' ? 2 : 1 },
      },
    })),
  };

  const created = await googleFetch<{
    spreadsheetId: string;
    spreadsheetUrl: string;
    properties: { title: string };
    sheets: Array<{ properties: { title: string } }>;
  }>('https://sheets.googleapis.com/v4/spreadsheets', token, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  return {
    spreadsheetId: created.spreadsheetId,
    title: created.properties.title,
    url: created.spreadsheetUrl,
    sheetNames: created.sheets.map((s) => s.properties.title),
  };
}

export interface LoadedMasterBaseline {
  priorMap: Map<string, PriorJobSnapshot>;
  priorPeriod: string;
  overrides: Record<string, ForecastOverride>;
  cashAssumptions?: Partial<CashAssumptions>;
  bondingAssumptions?: Partial<BondingAssumptions>;
}

export async function loadBaselineFromMasterSheet(
  token: string,
  spreadsheetId: string,
  existingSheetNames: string[]
): Promise<LoadedMasterBaseline> {
  const priorMap = new Map<string, PriorJobSnapshot>();
  let priorPeriod = '';
  const overrides: Record<string, ForecastOverride> = {};
  const cashAssumptions: Partial<CashAssumptions> = {};
  const bondingAssumptions: Partial<BondingAssumptions> = {};

  const ranges: string[] = [];
  if (existingSheetNames.includes('WIP Master')) ranges.push("'WIP Master'!A1:W500");
  if (existingSheetNames.includes('Forecasts & Fades')) ranges.push("'Forecasts & Fades'!A1:L500");
  if (existingSheetNames.includes('Cash Lookahead')) ranges.push("'Cash Lookahead'!A1:D20");
  if (existingSheetNames.includes('Bank & Bonding')) ranges.push("'Bank & Bonding'!A1:D30");

  if (!ranges.length) {
    return { priorMap, priorPeriod, overrides };
  }

  const query = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
  const batch = await googleFetch<{
    valueRanges?: Array<{ range: string; values?: unknown[][] }>;
  }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values:batchGet?${query}&valueRenderOption=UNFORMATTED_VALUE`,
    token
  );

  for (const vr of batch.valueRanges || []) {
    const rows = vr.values || [];
    if (vr.range.includes('WIP Master')) {
      for (const row of rows) {
        const first = String(row[0] ?? '').trim();
        if (first.startsWith('Period Ending:')) {
          priorPeriod = first.replace('Period Ending:', '').trim();
        }
        const div = String(row[0] ?? '').trim();
        const jobId = String(row[1] ?? '').trim();
        const jobName = String(row[2] ?? '').trim();
        if (/^0[0-3]$/.test(div) && jobId && jobName) {
          try {
            const contract = parseNumber(row[3]);
            const cost = parseNumber(row[4]);
            const hours = parseNumber(row[5]);
            const projectedProfit = contract - cost;
            const actualCost = parseNumber(row[11]);
            const actualHours = parseNumber(row[12]);
            const earnedRevenue = parseNumber(row[10]);
            const earnedProfit = earnedRevenue - actualCost;
            const billed = parseNumber(row[17]);
            priorMap.set(jobId, {
              id: jobId,
              name: jobName,
              division: div,
              contract,
              cost,
              projectedProfit,
              projectedGpPct: contract > 0 ? projectedProfit / contract : 0,
              actualCost,
              billed,
              earnedRevenue,
              earnedProfit,
              hours,
              actualHours,
            });
          } catch {
            // Skip malformed historical row
          }
        }
      }
    } else if (vr.range.includes('Forecasts & Fades')) {
      for (const row of rows.slice(1)) {
        const jobId = String(row[1] ?? '').trim();
        if (!jobId) continue;
        const overrideCostVal = row[9];
        const fadeReason = String(row[10] ?? '').trim();
        const pmNote = String(row[11] ?? '').trim();
        if (fadeReason || pmNote || (overrideCostVal !== '' && overrideCostVal !== undefined)) {
          const parsedCost =
            overrideCostVal !== '' && overrideCostVal !== undefined && !Number.isNaN(Number(overrideCostVal))
              ? Number(overrideCostVal)
              : undefined;
          overrides[jobId] = {
            adjustedCost: parsedCost,
            fadeReason,
            pmNote,
          };
        }
      }
    } else if (vr.range.includes('Cash Lookahead')) {
      for (const row of rows) {
        const key = String(row[0] ?? '').trim();
        const val = row[1];
        if (typeof val !== 'number') continue;
        if (key === 'Starting Cash on Hand') cashAssumptions.startingCash = val;
        if (key === 'Retainage Held (%)') cashAssumptions.retainagePct = val;
        if (key === 'AR Collection Cycle (Days)') cashAssumptions.arCollectionDays = val;
        if (key === 'Weekly Overhead Burn') cashAssumptions.weeklyOverhead = val;
        if (key === 'Line of Credit Limit') cashAssumptions.locLimit = val;
        if (key === 'Line of Credit Drawn') cashAssumptions.locDrawn = val;
      }
    } else if (vr.range.includes('Bank & Bonding')) {
      for (const row of rows) {
        const key = String(row[0] ?? '').trim();
        const val = row[1];
        if (typeof val !== 'number') continue;
        if (key === 'Cash & Equivalents') bondingAssumptions.cashAndEquivalents = val;
        if (key === 'Accounts Receivable') bondingAssumptions.accountsReceivable = val;
        if (key === 'Other Current Assets') bondingAssumptions.otherCurrentAssets = val;
        if (key === 'Accounts Payable') bondingAssumptions.accountsPayable = val;
        if (key === 'Accrued Liabilities') bondingAssumptions.accruedLiabilities = val;
        if (key === 'Line of Credit Balance') bondingAssumptions.lineOfCreditBalance = val;
        if (key === 'Net Worth / Equity') bondingAssumptions.netWorthEquity = val;
        if (key === 'Surety Single Job Limit') bondingAssumptions.suretySingleLimit = val;
        if (key === 'Surety Aggregate Limit') bondingAssumptions.suretyAggregateLimit = val;
      }
    }
  }

  return {
    priorMap,
    priorPeriod,
    overrides,
    cashAssumptions: Object.keys(cashAssumptions).length ? cashAssumptions : undefined,
    bondingAssumptions: Object.keys(bondingAssumptions).length ? bondingAssumptions : undefined,
  };
}

export interface SyncMasterPayload {
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
}

const colLetter = (index: number): string => {
  let n = index;
  let s = '';
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
};

function buildWipMasterRows(jobs: CalculatedJob[], period: string): {
  values: (string | number)[][];
  totalRowIndices: number[];
  grandTotalRowIndex: number;
} {
  const rows: (string | number)[][] = [];
  const totalRowIndices: number[] = [];

  rows.push([
    `Period Ending: ${period || 'Not Provided'}`,
    '',
    'JRT Mechanical — Master WIP Schedule',
    'Projected',
    '',
    '',
    '',
    '',
    '',
    '',
    'Actual',
    '',
    '',
    '',
    '',
    '',
    '',
    'Billings & Backlog',
    '',
    '',
    '',
    '',
    'Net Over/(Under)',
  ]);

  const divTotalExcelRows: number[] = [];

  for (const [div, name] of Object.entries(DIVISIONS) as Array<[DivisionCode, string]>) {
    const divJobs = jobs
      .filter((j) => j.division === div)
      .sort((a, b) => a.id.localeCompare(b.id));
    if (!divJobs.length) continue;

    rows.push([`${div} ${name}`, '', '', 'Projected', '', '', '', '', '', '', 'Actual']);
    rows.push([...WIP_HEADERS]);

    const startExcelRow = rows.length + 1;
    const divValues: (string | number)[][] = [];

    for (const job of divJobs) {
      const r = rows.length + 1;
      const arr = calcWipArray(job);
      divValues.push(arr);
      rows.push([
        job.division,
        job.id,
        job.name,
        job.contract,
        job.cost,
        job.hours,
        `=IF(F${r}>0,H${r}/F${r},0)`,
        `=D${r}-E${r}`,
        `=IF(D${r}>0,H${r}/D${r},0)`,
        `=IF(E${r}>0,L${r}/E${r},0)`,
        `=IF(H${r}>0,J${r}*D${r},L${r}+H${r})`,
        job.actualCost,
        job.actualHours,
        `=IF(M${r}>0,P${r}/M${r},G${r})`,
        `=F${r}-M${r}`,
        `=K${r}-L${r}`,
        `=IFERROR(P${r}/K${r},I${r})`,
        job.billed,
        `=IF(R${r}<K${r},K${r}-R${r},0)`,
        `=IF(R${r}>K${r},R${r}-K${r},0)`,
        `=D${r}-R${r}`,
        `=IFERROR((H${r}-P${r})/O${r},N${r})`,
      ]);
    }

    const endExcelRow = rows.length;
    const totalExcelRow = rows.length + 1;
    const additiveCols = [3, 4, 5, 7, 10, 11, 12, 14, 15, 17, 18, 19, 20];
    const totalRow: (string | number)[] = Array(22).fill('');
    totalRow[0] = `${name} Total`;
    additiveCols.forEach((c) => {
      const l = colLetter(c);
      totalRow[c] = `=SUM(${l}${startExcelRow}:${l}${endExcelRow})`;
    });
    totalRow[6] = `=IFERROR(H${totalExcelRow}/F${totalExcelRow},"N/A")`;
    totalRow[8] = `=IFERROR(H${totalExcelRow}/D${totalExcelRow},"N/A")`;
    totalRow[9] = `=IFERROR(L${totalExcelRow}/E${totalExcelRow},"N/A")`;
    totalRow[13] = `=IFERROR(P${totalExcelRow}/M${totalExcelRow},"N/A")`;
    totalRow[16] = `=IFERROR(P${totalExcelRow}/K${totalExcelRow},I${totalExcelRow})`;
    totalRow[21] = `=IFERROR((H${totalExcelRow}-P${totalExcelRow})/O${totalExcelRow},"N/A")`;

    // Verify numeric sanity
    calcWipTotals(divValues);
    rows.push(totalRow);
    totalRowIndices.push(rows.length - 1);
    divTotalExcelRows.push(totalExcelRow);
  }

  rows.push([]);
  const grandExcelRow = rows.length + 1;
  const grandRow: (string | number)[] = Array(23).fill('');
  grandRow[0] = 'Grand Total';
  const additiveCols = [3, 4, 5, 7, 10, 11, 12, 14, 15, 17, 18, 19, 20];
  additiveCols.forEach((c) => {
    const l = colLetter(c);
    grandRow[c] = `=SUM(${divTotalExcelRows.map((r) => `${l}${r}`).join(',')})`;
  });
  grandRow[6] = `=IFERROR(H${grandExcelRow}/F${grandExcelRow},"N/A")`;
  grandRow[8] = `=IFERROR(H${grandExcelRow}/D${grandExcelRow},"N/A")`;
  grandRow[9] = `=IFERROR(L${grandExcelRow}/E${grandExcelRow},"N/A")`;
  grandRow[13] = `=IFERROR(P${grandExcelRow}/M${grandExcelRow},"N/A")`;
  grandRow[16] = `=IFERROR(P${grandExcelRow}/K${grandExcelRow},I${grandExcelRow})`;
  grandRow[21] = `=IFERROR((H${grandExcelRow}-P${grandExcelRow})/O${grandExcelRow},"N/A")`;
  grandRow[22] = `=T${grandExcelRow}-S${grandExcelRow}`;
  rows.push(grandRow);

  return {
    values: rows,
    totalRowIndices,
    grandTotalRowIndex: rows.length - 1,
  };
}

function buildGainsLossesRows(rowsData: GainsLossesRow[], period: string): (string | number)[][] {
  const out: (string | number)[][] = [
    [
      'Division',
      'Job #',
      'Job Name',
      'Classification',
      'Prior Contract',
      'Current Contract',
      'Prior Projected Profit',
      'Current Projected Profit',
      'Profit Gain / (Loss)',
      'Prior GP%',
      'Current GP%',
      'GP% Delta',
      'Bid $/Hr',
      'Actual $/Hr',
      '$/Hr Variance',
      `Period: ${period || 'Current'}`,
    ],
  ];

  for (const item of rowsData) {
    const r = out.length + 1;
    out.push([
      `${item.job.division} ${DIVISIONS[item.job.division as DivisionCode] || ''}`.trim(),
      item.job.id,
      item.job.name,
      item.classification,
      item.prior ? item.prior.contract : 0,
      item.job.contract,
      item.prior ? item.prior.projectedProfit : item.job.projectedProfit,
      item.job.projectedProfit,
      `=H${r}-G${r}`,
      item.prior ? item.prior.projectedGpPct : item.job.projectedGpPct,
      item.job.projectedGpPct,
      `=K${r}-J${r}`,
      item.job.projectedProfitPerHr,
      item.job.actualProfitPerHr,
      `=N${r}-M${r}`,
      item.hasPrior ? 'Matched Prior' : 'New / No Prior',
    ]);
  }

  if (rowsData.length > 0) {
    const end = out.length;
    const tr = end + 1;
    out.push([
      'Totals',
      '',
      `${rowsData.length} Jobs`,
      '',
      `=SUM(E2:E${end})`,
      `=SUM(F2:F${end})`,
      `=SUM(G2:G${end})`,
      `=SUM(H2:H${end})`,
      `=SUM(I2:I${end})`,
      `=IFERROR(G${tr}/E${tr},0)`,
      `=IFERROR(H${tr}/F${tr},0)`,
      `=K${tr}-J${tr}`,
      '',
      '',
      '',
      '',
    ]);
  }

  return out;
}

function buildForecastsFadesRows(rowsData: ForecastFadeRow[]): (string | number)[][] {
  const out: (string | number)[][] = [
    [
      'Division',
      'Job #',
      'Job Name',
      'Contract',
      'Current Projected Cost',
      '% Cost Spent',
      '% Hours Spent',
      'Burn Ratio (Hrs/Cost)',
      'Trended EAC Cost',
      'Manual Cost Override',
      'Fade Reason',
      'PM Action Notes',
      'Trended Final Profit',
      'Projected Fade / (Gain)',
      'Fade Risk',
    ],
  ];

  for (const item of rowsData) {
    const r = out.length + 1;
    const effectiveCostFormula = `IF(ISNUMBER(J${r}),J${r},I${r})`;
    out.push([
      `${item.job.division} ${DIVISIONS[item.job.division as DivisionCode] || ''}`.trim(),
      item.job.id,
      item.job.name,
      item.job.contract,
      item.job.cost,
      item.pctCostSpent,
      item.pctHoursSpent,
      `=IFERROR(G${r}/F${r},1)`,
      Math.round(item.trendedEacCost),
      item.override?.adjustedCost ?? '',
      item.override?.fadeReason ?? '',
      item.override?.pmNote ?? '',
      `=D${r}-${effectiveCostFormula}`,
      `=M${r}-(D${r}-E${r})`,
      item.fadeRisk,
    ]);
  }

  if (rowsData.length > 0) {
    const end = out.length;
    out.push([
      'Totals',
      '',
      `${rowsData.length} Jobs`,
      `=SUM(D2:D${end})`,
      `=SUM(E2:E${end})`,
      '',
      '',
      '',
      `=SUM(I2:I${end})`,
      '',
      '',
      '',
      `=SUM(M2:M${end})`,
      `=SUM(N2:N${end})`,
      '',
    ]);
  }

  return out;
}

function buildCashLookaheadRows(
  assumptions: CashAssumptions,
  weeks: CashWeekRow[],
  positions: JobCashPosition[]
): (string | number)[][] {
  const out: (string | number)[][] = [
    ['Cash Lookahead Assumptions', 'Value', 'Notes'],
    ['Starting Cash on Hand', assumptions.startingCash, 'Operating cash balance'],
    ['Retainage Held (%)', assumptions.retainagePct, 'Percent retained on billings'],
    ['AR Collection Cycle (Days)', assumptions.arCollectionDays, 'Average days to collect receivables'],
    ['Weekly Overhead Burn', assumptions.weeklyOverhead, 'Fixed G&A + indirect weekly outflow'],
    ['Line of Credit Limit', assumptions.locLimit, 'Committed revolving facility'],
    ['Line of Credit Drawn', assumptions.locDrawn, 'Current drawn balance'],
    [],
    [
      '13-Week Rolling Cash Projection',
      'Backlog Revenue Burn',
      'Underbilling Collections',
      'Projected Cash Inflows',
      'Direct Job Cost Outflows',
      'Overhead Outflow',
      'Net Weekly Cash Flow',
      'Ending Operating Cash',
      'Available Liquidity',
    ],
  ];

  const weekStartRow = out.length + 1;
  for (let idx = 0; idx < weeks.length; idx++) {
    const w = weeks[idx];
    const r = out.length + 1;
    const prevEndingRef = idx === 0 ? '$B$2' : `H${r - 1}`;
    out.push([
      w.label,
      Math.round(w.backlogBurnRevenue),
      Math.round(w.underbillingCollection),
      Math.round(w.scheduledBillings),
      Math.round(w.directJobOutflows),
      `=$B$5`,
      `=D${r}-E${r}-F${r}`,
      `=${prevEndingRef}+G${r}`,
      `=H${r}+($B$6-$B$7)`,
    ]);
  }

  const weekEndRow = out.length;
  out.push([
    '13-Week Total',
    `=SUM(B${weekStartRow}:B${weekEndRow})`,
    `=SUM(C${weekStartRow}:C${weekEndRow})`,
    `=SUM(D${weekStartRow}:D${weekEndRow})`,
    `=SUM(E${weekStartRow}:E${weekEndRow})`,
    `=SUM(F${weekStartRow}:F${weekEndRow})`,
    `=SUM(G${weekStartRow}:G${weekEndRow})`,
    `=H${weekEndRow}`,
    `=I${weekEndRow}`,
  ]);

  out.push([]);
  out.push([
    'Job Cash Position Detail',
    'Job #',
    'Job Name',
    'Contract',
    'Billed to Date',
    'Underbillings (Future Cash)',
    'Overbillings (Liability)',
    'Remaining Backlog',
    'Est. Retainage Held',
  ]);

  for (const p of positions) {
    out.push([
      p.job.division,
      p.job.id,
      p.job.name,
      p.job.contract,
      p.job.billed,
      p.job.underBillings,
      p.job.overBillings,
      p.job.backlog,
      Math.round(p.estimatedRetainageHeld),
    ]);
  }

  return out;
}

function buildJobScorecardRows(rowsData: JobScorecardRow[]): (string | number)[][] {
  const out: (string | number)[][] = [
    [
      'Division',
      'Job #',
      'Job Name',
      'Health Tier',
      'Contract',
      'Projected GP%',
      'Div Benchmark GP%',
      'GP Spread',
      'Bid $/Hr',
      'Actual $/Hr',
      'Billing Posture',
      'Fade Risk',
      'Primary Driver',
      'PM Action Note',
    ],
  ];

  for (const row of rowsData) {
    const r = out.length + 1;
    out.push([
      `${row.job.division} ${DIVISIONS[row.job.division as DivisionCode] || ''}`.trim(),
      row.job.id,
      row.job.name,
      row.healthTier,
      row.job.contract,
      row.job.projectedGpPct,
      row.divisionBenchmarkGp,
      `=F${r}-G${r}`,
      row.job.projectedProfitPerHr,
      row.job.actualProfitPerHr,
      row.billingPosture,
      row.fadeRisk,
      row.primaryDriver,
      row.pmNote,
    ]);
  }

  return out;
}

function buildBankBondingRows(
  assumptions: BondingAssumptions,
  report: BankBondingReport,
  period: string
): (string | number)[][] {
  const out: (string | number)[][] = [
    ['JRT Mechanical — Bank & Surety Bonding Report', '', `Period Ending: ${period || 'Current'}`],
    [],
    ['Balance Sheet & Surety Inputs', 'Amount', 'Surety / Covenant Summary', 'Value'],
    [
      'Cash & Equivalents',
      assumptions.cashAndEquivalents,
      'Total Active Contracts',
      report.totalContracts,
    ],
    [
      'Accounts Receivable',
      assumptions.accountsReceivable,
      'Cost & Estimated Earnings',
      report.totalEarnedRevenue,
    ],
    [
      'Other Current Assets',
      assumptions.otherCurrentAssets,
      'Billings to Date',
      report.totalBilled,
    ],
    [
      'Costs in Excess of Billings (Underbillings)',
      report.totalUnderBillings,
      'Net Over/(Under) Billing',
      report.netOverUnderBilling,
    ],
    [
      'Total Current Assets',
      '=SUM(B4:B7)',
      'Total Uncompleted Backlog',
      report.totalBacklog,
    ],
    [
      'Accounts Payable',
      assumptions.accountsPayable,
      'Gross Profit in Backlog',
      report.profitInBacklog,
    ],
    [
      'Accrued Liabilities',
      assumptions.accruedLiabilities,
      'Loss Job Reserve (100%)',
      report.lossJobReserve,
    ],
    [
      'Line of Credit Balance',
      assumptions.lineOfCreditBalance,
      'Adjusted Working Capital',
      '=B8-B14',
    ],
    [
      'Billings in Excess of Costs (Overbillings)',
      report.totalOverBillings,
      'Current Ratio',
      '=IFERROR(B8/B14,0)',
    ],
    [
      'Loss Job Reserve Liability',
      report.lossJobReserve,
      'Backlog / Working Capital',
      '=IFERROR(D8/D11,0)',
    ],
    [
      'Total Current Liabilities',
      '=SUM(B9:B13)',
      'Backlog / Net Worth Ratio',
      '=IFERROR(D8/B15,0)',
    ],
    [
      'Net Worth / Equity',
      assumptions.netWorthEquity,
      'Available Aggregate Capacity',
      '=MAX(0,B17-D8)',
    ],
    ['Surety Single Job Limit', assumptions.suretySingleLimit, '', ''],
    ['Surety Aggregate Limit', assumptions.suretyAggregateLimit, '', ''],
    [],
    [
      'Division Exposure Summary',
      'Jobs',
      'Contracts',
      'Earned Revenue',
      'Billed',
      'Underbillings',
      'Overbillings',
      'Remaining Backlog',
      'Projected GP%',
    ],
  ];

  for (const d of report.divisionBreakdown) {
    out.push([
      `${d.division} · ${d.name}`,
      d.jobCount,
      d.contract,
      d.earnedRevenue,
      d.billed,
      d.underBillings,
      d.overBillings,
      d.backlog,
      d.gpPct,
    ]);
  }

  out.push([]);
  out.push([
    'Top 10 Open Contracts by Backlog',
    'Job #',
    'Job Name',
    'Contract',
    'Earned Revenue',
    'Billed',
    'Underbillings',
    'Overbillings',
    'Remaining Backlog',
  ]);

  for (const job of report.topBacklogJobs) {
    out.push([
      job.division,
      job.id,
      job.name,
      job.contract,
      job.earnedRevenue,
      job.billed,
      job.underBillings,
      job.overBillings,
      job.backlog,
    ]);
  }

  return out;
}

export function buildProfitForecastRows(
  forecast: PfForecastResult | null | undefined,
  pnl: PfPnlReport | null | undefined,
  settings: PfSettings | null | undefined
): {
  values: (string | number)[][];
  divHeaderRow: number;
  jobHeaderRow: number;
  monthCount: number;
  hasYtd: boolean;
} {
  const months = forecast?.M?.months || [];
  if (!forecast || !months.length) {
    return {
      values: [
        ['JRT Mechanical — Profit Forecast'],
        ['No active WIP or Profit Forecast snapshot loaded yet.'],
      ],
      divHeaderRow: 0,
      jobHeaderRow: 0,
      monthCount: 0,
      hasYtd: false,
    };
  }

  const monthLabels = months.map((k) => mLabel(k));
  const pnlDepts = pnl?.depts || {};
  const hasYtd = Object.values(pnlDepts).some((d) => d.ytdNet !== null && d.ytdNet !== undefined);
  const asOfKey = forecast.M.actual || forecast.M.first;

  const divHeader = [
    'Division',
    'Line Item',
    ...monthLabels,
    'Forecast Total',
    ...(hasYtd ? ['YTD Actual', 'Projected Year End'] : []),
  ];

  const out: (string | number)[][] = [
    [
      'JRT Mechanical — Multi-Month Profit Forecast & P&L',
      asOfKey ? `As of ${mLabel(asOfKey)}` : 'Current Forecast',
      `Horizon: ${months.length} Months`,
    ],
    [],
    divHeader,
  ];
  const divHeaderRow = 2;

  const divKeys = [...DEPT_ORDER, 'total'] as const;
  for (const code of divKeys) {
    const dvMonths = code === 'total' ? forecast.total : forecast.div[code]?.months;
    if (!dvMonths || !dvMonths.length) continue;
    const label = code === 'total' ? 'Company Total' : `${code} ${DEPTS[code] || code}`;
    const pDept =
      code === 'total'
        ? Object.values(pnlDepts)
        : pnlDepts[code]
        ? [pnlDepts[code]]
        : [];
    const ytdRev = pDept.reduce((s, d) => s + (d.ytdRevenue || 0), 0);
    const ytdGP = pDept.reduce((s, d) => s + (d.ytdGP || 0), 0);
    const ytdOH = pDept.reduce((s, d) => s + (d.ytdOverhead || 0), 0);
    const ytdNet = pDept.reduce((s, d) => s + (d.ytdNet || 0), 0);

    const revTot = dvMonths.reduce((s, m) => s + Math.round(m.rev), 0);
    const likelyTot = dvMonths.reduce((s, m) => s + Math.round(m.likelyGP), 0);
    const gpTot = dvMonths.reduce((s, m) => s + Math.round(m.gp), 0);
    const ohTot = dvMonths.reduce((s, m) => s + Math.round(m.oh), 0);
    const netTot = dvMonths.reduce((s, m) => s + Math.round(m.net), 0);

    out.push([
      label,
      'Projected Revenue',
      ...dvMonths.map((m) => Math.round(m.rev)),
      revTot,
      ...(hasYtd ? [Math.round(ytdRev), Math.round(ytdRev + revTot)] : []),
    ]);
    out.push([
      label,
      'Likely Jobs GP',
      ...dvMonths.map((m) => Math.round(m.likelyGP)),
      likelyTot,
      ...(hasYtd ? [0, likelyTot] : []),
    ]);
    out.push([
      label,
      'Total Gross Profit',
      ...dvMonths.map((m) => Math.round(m.gp)),
      gpTot,
      ...(hasYtd ? [Math.round(ytdGP), Math.round(ytdGP + gpTot)] : []),
    ]);
    out.push([
      label,
      'Gross Margin %',
      ...dvMonths.map((m) => (m.rev > 0 ? m.gp / m.rev : 0)),
      revTot > 0 ? gpTot / revTot : 0,
      ...(hasYtd
        ? [
            ytdRev > 0 ? ytdGP / ytdRev : 0,
            ytdRev + revTot > 0 ? (ytdGP + gpTot) / (ytdRev + revTot) : 0,
          ]
        : []),
    ]);
    out.push([
      label,
      'Overhead Cost',
      ...dvMonths.map((m) => Math.round(m.oh)),
      ohTot,
      ...(hasYtd ? [Math.round(ytdOH), Math.round(ytdOH + ohTot)] : []),
    ]);
    out.push([
      label,
      'Net Income / (Loss)',
      ...dvMonths.map((m) => Math.round(m.net)),
      netTot,
      ...(hasYtd ? [Math.round(ytdNet), Math.round(ytdNet + netTot)] : []),
    ]);
  }

  out.push([]);
  const jobHeaderRow = out.length;
  out.push([
    'Job #',
    'Job Name',
    'Div',
    'Contract',
    'Current GP%',
    "Sven's Gut",
    'Gut $',
    'Adjustments',
    '% Done',
    'Cost Spread',
    ...monthLabels,
    'Forecast GP Total',
  ]);

  const effectiveSettings = settings;
  for (const job of forecast.jobs) {
    const gLabel = effectiveSettings ? gutLabel(gutOf(job, effectiveSettings)) : '';
    const gDol = effectiveSettings ? Math.round(gutDollars(job, effectiveSettings)) : 0;
    const adjTot = Math.round((job.coRev || 0) - (job.coCost || 0));
    const pctDone = job.pctStart ?? (job.finalCost > 0 ? job.jtdStart / job.finalCost : 0);
    const spreadTxt = effectiveSettings ? modeText(job, effectiveSettings) : job.mode;
    const monthGps = job.months.map((m) => Math.round(m.gp));
    const totalGp = monthGps.reduce((s, v) => s + v, 0);
    out.push([
      job.job.job,
      job.job.name,
      job.job.dept,
      Math.round(job.C),
      job.gpNow ?? 0,
      gLabel || '—',
      gDol,
      adjTot,
      pctDone,
      spreadTxt,
      ...monthGps,
      totalGp,
    ]);
  }

  return {
    values: out,
    divHeaderRow,
    jobHeaderRow,
    monthCount: months.length,
    hasYtd,
  };
}

export async function syncMasterWorkbookToGoogleSheet(
  token: string,
  spreadsheetId: string,
  payload: SyncMasterPayload
): Promise<LinkedSheetInfo> {
  // 1. Inspect existing spreadsheet tabs
  const meta = await googleFetch<{
    spreadsheetId: string;
    spreadsheetUrl: string;
    properties: { title: string };
    sheets: Array<{ properties: { sheetId: number; title: string } }>;
  }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(sheetId,title)`,
    token
  );

  const existingByName = new Map<string, number>(
    meta.sheets.map((s) => [s.properties.title, s.properties.sheetId])
  );

  // 2. Create any missing subsheets
  const addSheetRequests = MASTER_SUBSHEET_NAMES.filter((name) => !existingByName.has(name)).map(
    (name) => ({
      addSheet: {
        properties: {
          title: name,
          gridProperties: { frozenRowCount: name === 'WIP Master' ? 2 : 1 },
        },
      },
    })
  );

  if (addSheetRequests.length > 0) {
    const addRes = await googleFetch<{
      replies: Array<{ addSheet?: { properties: { sheetId: number; title: string } } }>;
    }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId
      )}:batchUpdate`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({ requests: addSheetRequests }),
      }
    );
    for (const rep of addRes.replies || []) {
      if (rep.addSheet?.properties) {
        existingByName.set(rep.addSheet.properties.title, rep.addSheet.properties.sheetId);
      }
    }
  }

  // 3. Clear existing content in all 7 subsheets
  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values:batchClear`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        ranges: MASTER_SUBSHEET_NAMES.map((name) => `'${name}'!A1:AD1000`),
      }),
    }
  );

  // 4. Build values & formulas for all 7 subsheets
  const wipBuilt = buildWipMasterRows(payload.jobs, payload.period);
  const gainsRows = buildGainsLossesRows(payload.gainsLosses, payload.period);
  const forecastRows = buildForecastsFadesRows(payload.forecastsFades);
  const cashRows = buildCashLookaheadRows(
    payload.cashAssumptions,
    payload.cashWeeks,
    payload.jobCashPositions
  );
  const scorecardRows = buildJobScorecardRows(payload.scorecard);
  const bondingRows = buildBankBondingRows(
    payload.bondingAssumptions,
    payload.bondingReport,
    payload.period
  );
  const profitBuilt = buildProfitForecastRows(
    payload.profitForecast,
    payload.pfPnl,
    payload.pfSettings
  );

  // 5. Write values via values:batchUpdate (USER_ENTERED so formulas evaluate natively!)
  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values:batchUpdate`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: "'WIP Master'!A1", values: wipBuilt.values },
          { range: "'Gains & Losses'!A1", values: gainsRows },
          { range: "'Forecasts & Fades'!A1", values: forecastRows },
          { range: "'Cash Lookahead'!A1", values: cashRows },
          { range: "'Job Scorecard'!A1", values: scorecardRows },
          { range: "'Bank & Bonding'!A1", values: bondingRows },
          { range: "'Profit Forecast'!A1", values: profitBuilt.values },
        ],
      }),
    }
  );

  // 6. Apply executive formatting across all 6 subsheets
  const formatRequests: unknown[] = [];

  const styleHeaderRow = (sheetId: number, rowIndex: number, colCount: number) => {
    formatRequests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: rowIndex,
          endRowIndex: rowIndex + 1,
          startColumnIndex: 0,
          endColumnIndex: colCount,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.06, green: 0.16, blue: 0.23 },
            textFormat: {
              foregroundColor: { red: 1, green: 1, blue: 1 },
              bold: true,
              fontSize: 9,
            },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'WRAP',
          },
        },
        fields:
          'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
      },
    });
  };

  const applyCurrencyFormat = (
    sheetId: number,
    startRow: number,
    endRow: number,
    startCol: number,
    endCol: number
  ) => {
    formatRequests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: startRow,
          endRowIndex: endRow,
          startColumnIndex: startCol,
          endColumnIndex: endCol,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'CURRENCY', pattern: '$#,##0;($#,##0);"-"' },
          },
        },
        fields: 'userEnteredFormat.numberFormat',
      },
    });
  };

  const applyPercentFormat = (
    sheetId: number,
    startRow: number,
    endRow: number,
    startCol: number,
    endCol: number
  ) => {
    formatRequests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: startRow,
          endRowIndex: endRow,
          startColumnIndex: startCol,
          endColumnIndex: endCol,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'PERCENT', pattern: '0.00%' },
          },
        },
        fields: 'userEnteredFormat.numberFormat',
      },
    });
  };

  const wipSheetId = existingByName.get('WIP Master');
  if (wipSheetId !== undefined) {
    styleHeaderRow(wipSheetId, 0, 23);
    applyCurrencyFormat(wipSheetId, 1, wipBuilt.values.length, 3, 23);
    applyPercentFormat(wipSheetId, 1, wipBuilt.values.length, 8, 10);
    applyPercentFormat(wipSheetId, 1, wipBuilt.values.length, 16, 17);

    // Highlight division totals in soft sage green and Grand Total Net Billing in emerald
    for (const rowIdx of [...wipBuilt.totalRowIndices, wipBuilt.grandTotalRowIndex]) {
      formatRequests.push({
        repeatCell: {
          range: {
            sheetId: wipSheetId,
            startRowIndex: rowIdx,
            endRowIndex: rowIdx + 1,
            startColumnIndex: 0,
            endColumnIndex: 22,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.78, green: 0.88, blue: 0.71 },
              textFormat: { bold: true },
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat)',
        },
      });
    }
    formatRequests.push({
      repeatCell: {
        range: {
          sheetId: wipSheetId,
          startRowIndex: wipBuilt.grandTotalRowIndex,
          endRowIndex: wipBuilt.grandTotalRowIndex + 1,
          startColumnIndex: 22,
          endColumnIndex: 23,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.44, green: 0.68, blue: 0.28 },
            textFormat: { bold: true },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
      },
    });
  }

  const gainsId = existingByName.get('Gains & Losses');
  if (gainsId !== undefined) {
    styleHeaderRow(gainsId, 0, 16);
    applyCurrencyFormat(gainsId, 1, gainsRows.length, 4, 9);
    applyPercentFormat(gainsId, 1, gainsRows.length, 9, 12);
    applyCurrencyFormat(gainsId, 1, gainsRows.length, 12, 15);
  }

  const forecastId = existingByName.get('Forecasts & Fades');
  if (forecastId !== undefined) {
    styleHeaderRow(forecastId, 0, 15);
    applyCurrencyFormat(forecastId, 1, forecastRows.length, 3, 5);
    applyPercentFormat(forecastId, 1, forecastRows.length, 5, 7);
    applyCurrencyFormat(forecastId, 1, forecastRows.length, 8, 10);
    applyCurrencyFormat(forecastId, 1, forecastRows.length, 12, 14);
  }

  const cashId = existingByName.get('Cash Lookahead');
  if (cashId !== undefined) {
    styleHeaderRow(cashId, 0, 3);
    styleHeaderRow(cashId, 8, 9);
    applyCurrencyFormat(cashId, 1, 2, 1, 2);
    applyCurrencyFormat(cashId, 4, 7, 1, 2);
    applyCurrencyFormat(cashId, 9, cashRows.length, 1, 9);
  }

  const scorecardId = existingByName.get('Job Scorecard');
  if (scorecardId !== undefined) {
    styleHeaderRow(scorecardId, 0, 14);
    applyCurrencyFormat(scorecardId, 1, scorecardRows.length, 4, 5);
    applyPercentFormat(scorecardId, 1, scorecardRows.length, 5, 8);
    applyCurrencyFormat(scorecardId, 1, scorecardRows.length, 8, 10);
  }

  const bondingId = existingByName.get('Bank & Bonding');
  if (bondingId !== undefined) {
    styleHeaderRow(bondingId, 0, 4);
    styleHeaderRow(bondingId, 2, 4);
    styleHeaderRow(bondingId, 18, 9);
    applyCurrencyFormat(bondingId, 3, 17, 1, 2);
    applyCurrencyFormat(bondingId, 3, 11, 3, 4);
    applyCurrencyFormat(bondingId, 14, 15, 3, 4);
    applyCurrencyFormat(bondingId, 19, bondingRows.length, 2, 8);
  }

  const profitId = existingByName.get('Profit Forecast');
  if (profitId !== undefined && profitBuilt.monthCount > 0) {
    const divCols = 2 + profitBuilt.monthCount + 1 + (profitBuilt.hasYtd ? 2 : 0);
    const jobCols = 10 + profitBuilt.monthCount + 1;
    styleHeaderRow(profitId, 0, Math.min(divCols, 28));
    styleHeaderRow(profitId, profitBuilt.divHeaderRow, Math.min(divCols, 28));
    styleHeaderRow(profitId, profitBuilt.jobHeaderRow, Math.min(jobCols, 28));

    // Division rows currency & Gross Margin % rows
    for (let r = profitBuilt.divHeaderRow + 1; r < profitBuilt.jobHeaderRow - 1; r++) {
      const label = String(profitBuilt.values[r]?.[1] ?? '');
      if (label === 'Gross Margin %') {
        applyPercentFormat(profitId, r, r + 1, 2, divCols);
      } else {
        applyCurrencyFormat(profitId, r, r + 1, 2, divCols);
      }
    }

    // Job schedule currency & percentage columns
    const jobStart = profitBuilt.jobHeaderRow + 1;
    const jobEnd = profitBuilt.values.length;
    if (jobEnd > jobStart) {
      applyCurrencyFormat(profitId, jobStart, jobEnd, 3, 4);
      applyPercentFormat(profitId, jobStart, jobEnd, 4, 5);
      applyCurrencyFormat(profitId, jobStart, jobEnd, 6, 8);
      applyPercentFormat(profitId, jobStart, jobEnd, 8, 9);
      applyCurrencyFormat(profitId, jobStart, jobEnd, 10, Math.min(jobCols, 28));
    }
  }

  // Auto-resize columns on all 7 sheets
  for (const name of MASTER_SUBSHEET_NAMES) {
    const sid = existingByName.get(name);
    if (sid !== undefined) {
      formatRequests.push({
        autoResizeDimensions: {
          dimensions: {
            sheetId: sid,
            dimension: 'COLUMNS',
            startIndex: 0,
            endIndex: name === 'Profit Forecast' ? 28 : 23,
          },
        },
      });
    }
  }

  if (formatRequests.length > 0) {
    await googleFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId
      )}:batchUpdate`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({ requests: formatRequests }),
      }
    );
  }

  return {
    spreadsheetId: meta.spreadsheetId,
    title: meta.properties.title,
    url: meta.spreadsheetUrl,
    sheetNames: [...MASTER_SUBSHEET_NAMES],
    lastSyncedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };
}
