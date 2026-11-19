import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { WIP_STYLES_XML } from './wipStylesTemplate';
import type {
  CalculatedJob,
  DivisionCode,
  HoursRecord,
  JoinedJob,
  PriorJobSnapshot,
  WipRawRecord,
} from '../types/wip';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export const DIVISIONS: Record<DivisionCode, string> = {
  '00': 'Main Division',
  '01': 'Tri-Cities Division',
  '02': 'Service Division',
  '03': 'Tri-Cities Service',
};

export const WIP_HEADERS = [
  'Department',
  'Job #',
  'Job Name',
  'Contract',
  'Projected Cost',
  'Man Hrs.',
  'Profit Per Man Hr.',
  'Profit',
  'GP%',
  '% Complete',
  'Earned Revenue',
  'Act. Cost',
  'Man Hrs.',
  'Profit Per Man Hr.',
  'Hrs. to Complete',
  'Profit',
  'GP%',
  'Billed',
  'Under Billings',
  'Over Billings',
  'Backlog',
  'Profit Per Man Hr. Backlog',
];

const ADDITIVE_COLS = [3, 4, 5, 7, 10, 11, 12, 14, 15, 17, 18, 19, 20];

const normalizeId = (v: unknown): string => String(v ?? '').trim().replace(/\s+/g, ' ');

export function parseNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const t = normalizeId(v)
    .replace(/[$,\s]/g, '')
    .replace(/^\((.*)\)$/, '-$1');
  if (t === '') return 0;
  if (!/^-?\d*\.?\d+$/.test(t)) {
    throw new Error(`Invalid number: ${String(v)}`);
  }
  return Number(t);
}

export function extractSheetRows(data: ArrayBuffer): unknown[][] {
  const wb = XLSX.read(data, { type: 'array' });
  const firstSheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(firstSheet, {
    header: 1,
    defval: '',
    raw: true,
  }) as unknown[][];
}

export function extractPeriodDate(rows: unknown[][]): string {
  const match = rows
    .flat()
    .join(' ')
    .match(/Period End Date:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  return match ? match[1] : '';
}

function setUnique<T>(map: Map<string, T>, key: string, value: T): void {
  if (map.has(key)) {
    throw new Error(`Duplicate job ${key}`);
  }
  map.set(key, value);
}

export function parseWipWorkbook(rows: unknown[][]): {
  map: Map<string, WipRawRecord>;
  period: string;
} {
  const headerIdx = rows.findIndex((r) => normalizeId(r[0]) === 'Job Number');
  if (
    headerIdx < 0 ||
    normalizeId(rows[headerIdx][7]) !== 'Revised Contract' ||
    normalizeId(rows[headerIdx][13]) !== 'Actual Cost'
  ) {
    throw new Error(
      'Expected the original Spectrum WIP export with Revised Contract and Actual Cost columns.'
    );
  }

  const map = new Map<string, WipRawRecord>();
  for (const r of rows.slice(headerIdx + 1)) {
    const k = normalizeId(r[0]);
    if (!/^(?:\d{4,}|[A-Z]+[A-Z0-9]*)$/.test(k) || !normalizeId(r[1])) continue;
    const requiredCols = [7, 8, 13, 16];
    if (requiredCols.some((c) => normalizeId(r[c]) === '')) {
      throw new Error(`Job ${k} has a missing financial amount.`);
    }
    setUnique(map, k, {
      id: k,
      name: normalizeId(r[1]),
      contract: parseNumber(r[7]),
      cost: parseNumber(r[8]),
      actualCost: parseNumber(r[13]),
      billed: parseNumber(r[16]),
    });
  }

  if (!map.size) {
    throw new Error('No WIP jobs found.');
  }

  return { map, period: extractPeriodDate(rows) };
}

export function parseHoursWorkbook(rows: unknown[][]): {
  map: Map<string, HoursRecord>;
  period: string;
} {
  const map = new Map<string, HoursRecord>();
  for (const r of rows) {
    const m = normalizeId(r[0]).match(/^Subtotal for job:\s*(\S+)/i);
    if (m) {
      setUnique(map, m[1], {
        hours: parseNumber(r[6]),
        actualHours: parseNumber(r[4]),
      });
    }
  }
  if (!map.size) {
    throw new Error('No job subtotals found in the hours report.');
  }
  return { map, period: extractPeriodDate(rows) };
}

export async function parseActiveJobsPdf(data: ArrayBuffer): Promise<Map<string, DivisionCode>> {
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(data),
    disableFontFace: true,
    useSystemFonts: true,
  } as Parameters<typeof pdfjsLib.getDocument>[0]).promise;

  const map = new Map<string, DivisionCode>();
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const lines: Array<{ y: number; items: Array<{ str: string; transform: number[] }> }> = [];

      for (const item of content.items) {
        if (!('str' in item) || !('transform' in item)) continue;
        const y = item.transform[5];
        let line = lines.find((l) => Math.abs(l.y - y) < 2);
        if (!line) {
          line = { y, items: [] };
          lines.push(line);
        }
        line.items.push(item as { str: string; transform: number[] });
      }

      for (const l of lines) {
        const txt = l.items
          .sort((a, b) => a.transform[4] - b.transform[4])
          .map((t) => t.str)
          .join(' ')
          .trim();
        const m = txt.match(/^([A-Za-z0-9]+)\s+(0[0-3])\s+/);
        if (m) {
          const div = m[2] as DivisionCode;
          if (map.has(m[1]) && map.get(m[1]) !== div) {
            throw new Error(`Conflicting divisions for ${m[1]}`);
          }
          map.set(m[1], div);
        }
      }
    }
  } finally {
    await (doc as unknown as { destroy?: () => Promise<void> }).destroy?.();
  }

  if (!map.size) {
    throw new Error('No jobs found. Upload a text-based Spectrum active-job PDF.');
  }
  return map;
}

export function parseActiveJobsTable(rows: unknown[][]): Map<string, DivisionCode> {
  const headerIdx = rows.findIndex(
    (r) =>
      r.some((v) => /^(job number|job #|job|job code)$/i.test(normalizeId(v))) &&
      r.some((v) => /^(division|department)$/i.test(normalizeId(v)))
  );
  if (headerIdx < 0) {
    throw new Error('Job list needs Job Number and Division columns.');
  }

  const h = rows[headerIdx];
  const jobCol = h.findIndex((v) => /^(job number|job #|job|job code)$/i.test(normalizeId(v)));
  const divCol = h.findIndex((v) => /^(division|department)$/i.test(normalizeId(v)));
  const map = new Map<string, DivisionCode>();

  for (const r of rows.slice(headerIdx + 1)) {
    const jobId = normalizeId(r[jobCol]);
    if (!jobId) continue;
    const d = normalizeId(r[divCol]).padStart(2, '0') as DivisionCode;
    if (!DIVISIONS[d]) {
      throw new Error(`Unknown division for ${jobId}`);
    }
    setUnique(map, jobId, d);
  }

  if (!map.size) {
    throw new Error('No active jobs found.');
  }
  return map;
}

export function joinSources(
  wipData: { map: Map<string, WipRawRecord>; period: string },
  hoursData: { map: Map<string, HoursRecord>; period: string },
  jobsMap: Map<string, DivisionCode>
): JoinedJob[] {
  if (wipData.period && hoursData.period && wipData.period !== hoursData.period) {
    throw new Error(
      `WIP and hours period dates differ: ${wipData.period} / ${hoursData.period}`
    );
  }

  return [...wipData.map.values()].map((r) => {
    const hrs = hoursData.map.get(r.id) || { hours: 0, actualHours: 0 };
    const div = jobsMap.get(r.id) || '';
    return {
      ...r,
      ...hrs,
      division: div,
      missingHours: !hoursData.map.has(r.id),
      manualDivision: !jobsMap.has(r.id),
      allowZero: false,
      selected: jobsMap.has(r.id) && hoursData.map.has(r.id),
    };
  });
}

export function isJobBlocked(job: JoinedJob): boolean {
  return !job.division || (job.missingHours && !job.allowZero);
}

export function calcWipArray(r: JoinedJob): (string | number)[] {
  const d = r.contract;
  const e = r.cost;
  const f = r.hours;
  const l = r.actualCost;
  const m = r.actualHours;
  const b = r.billed;
  const h = d - e;
  const i = d > 0 ? h / d : 0;
  const j = e > 0 ? l / e : 0;
  const k = h > 0 ? j * d : l + h;
  const p = k - l;
  const g = f > 0 ? h / f : 0;
  const n = m > 0 ? p / m : g;
  const o = f - m;
  const q = k !== 0 ? p / k : i;
  const underBillings = b < k ? k - b : 0;
  const overBillings = b > k ? b - k : 0;
  const backlog = d - b;
  const backlogProfitPerHr = o !== 0 ? (h - p) / o : n;

  return [
    r.division,
    r.id,
    r.name,
    d,
    e,
    f,
    g,
    h,
    i,
    j,
    k,
    l,
    m,
    n,
    o,
    p,
    q,
    b,
    underBillings,
    overBillings,
    backlog,
    backlogProfitPerHr,
  ];
}

export function toCalculatedJob(r: JoinedJob): CalculatedJob {
  const arr = calcWipArray(r);
  const projectedCost = Number(arr[4]);
  const projectedProfit = Number(arr[7]);
  const earnedProfit = Number(arr[15]);
  return {
    ...r,
    projectedProfit,
    projectedGpPct: Number(arr[8]),
    projectedProfitPerHr: Number(arr[6]),
    pctComplete: Number(arr[9]),
    earnedRevenue: Number(arr[10]),
    earnedProfit,
    actualGpPct: Number(arr[16]),
    actualProfitPerHr: Number(arr[13]),
    hoursToComplete: Number(arr[14]),
    underBillings: Number(arr[18]),
    overBillings: Number(arr[19]),
    backlog: Number(arr[20]),
    backlogProfitPerHr: Number(arr[21]),
    costToComplete: Math.max(0, projectedCost - r.actualCost),
    remainingProfit: projectedProfit - earnedProfit,
  };
}

export function calcWipTotals(values: (string | number)[][]): (string | number)[] {
  const v: (string | number)[] = Array(22).fill(0);
  ADDITIVE_COLS.forEach((c) => {
    v[c] = values.reduce((s, row) => s + Number(row[c] || 0), 0);
  });
  const ratio = (a: number, b: number): number | string => (b ? a / b : 'N/A');
  v[6] = ratio(Number(v[7]), Number(v[5]));
  v[8] = ratio(Number(v[7]), Number(v[3]));
  v[9] = ratio(Number(v[11]), Number(v[4]));
  v[13] = ratio(Number(v[15]), Number(v[12]));
  v[16] = Number(v[10]) ? Number(v[15]) / Number(v[10]) : v[8];
  v[21] = ratio(Number(v[7]) - Number(v[15]), Number(v[14]));
  return v;
}

function rowFormulas(r: number): Record<number, string> {
  return {
    6: `SUM(IF(F${r}>0,H${r}/F${r},0))`,
    7: `D${r}-E${r}`,
    8: `IF(D${r}>0,H${r}/D${r},0)`,
    9: `IF(E${r}>0,L${r}/E${r},0)`,
    10: `IF(H${r}>0,J${r}*D${r},L${r}+H${r})`,
    13: `SUM(IF(M${r}>0,P${r}/M${r},G${r}))`,
    14: `SUM(F${r}-M${r})`,
    15: `K${r}-L${r}`,
    16: `IFERROR((P${r}/K${r}),(I${r}))`,
    18: `IF(R${r}<K${r},(K${r}-R${r}),0)`,
    19: `IF(R${r}>K${r},(R${r}-K${r}),0)`,
    20: `SUM(D${r}-R${r})`,
    21: `IFERROR((H${r}-P${r})/O${r},N${r})`,
  };
}

const xmlEscape = (v: unknown): string =>
  String(v).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] || c)
  );

export async function exportSingleWipXlsx(records: JoinedJob[]): Promise<Uint8Array> {
  const selected = records.filter((r) => r.selected);
  if (!selected.length) throw new Error('Select at least one job.');
  if (selected.some((r) => !r.division || !DIVISIONS[r.division] || (r.missingHours && !r.allowZero))) {
    throw new Error('Resolve missing division or hours for selected jobs.');
  }

  const lines: string[] = [];
  const merges: string[] = [];
  let row = 0;
  const subrows: number[] = [];
  const subvals: (string | number)[][] = [];

  function add(
    vals: (string | number)[],
    fs: Record<number, string> = {},
    kind: 'data' | 'header' | 'title' | 'total' = 'data'
  ): number {
    row++;
    const cells = vals
      .map((v, c) => {
        let style =
          kind === 'header'
            ? 2
            : kind === 'title'
            ? 1
            : c < 3
            ? kind === 'total'
              ? 12
              : c === 1
              ? 4
              : 3
            : [6, 13, 21].includes(c)
            ? kind === 'total'
              ? 8
              : 7
            : [8, 9, 16].includes(c)
            ? kind === 'total'
              ? 10
              : 9
            : kind === 'total'
            ? 6
            : 5;
        if (kind === 'title' && ((c >= 3 && c <= 8) || (c >= 10 && c <= 16))) style = 13;
        if (kind === 'total' && c === 22) style = 14;
        const a = String.fromCharCode(65 + c) + row;
        if (fs[c]) {
          return `<c r="${a}" s="${style}"${
            typeof v === 'string' ? ' t="str"' : ''
          }><f>${xmlEscape(fs[c])}</f><v>${xmlEscape(v)}</v></c>`;
        }
        return typeof v === 'number'
          ? `<c r="${a}" s="${style}"><v>${v}</v></c>`
          : `<c r="${a}" s="${style}" t="inlineStr"><is><t>${xmlEscape(v)}</t></is></c>`;
      })
      .join('');
    lines.push(
      `<row r="${row}" ht="${
        kind === 'header' ? 30 : kind === 'total' ? 14 : 12.75
      }" customHeight="1">${cells}</row>`
    );
    return row;
  }

  function totalFormula(refs: Array<number | [number, number]>): Record<number, string> {
    const f: Record<number, string> = {};
    ADDITIVE_COLS.forEach((c) => {
      const letter = String.fromCharCode(65 + c);
      f[c] =
        'SUM(' +
        refs.map((r) => (Array.isArray(r) ? `${letter}${r[0]}:${letter}${r[1]}` : `${letter}${r}`)).join(',') +
        ')';
    });
    Object.assign(f, {
      6: `IFERROR(H${row + 1}/F${row + 1},"N/A")`,
      8: `IFERROR(H${row + 1}/D${row + 1},"N/A")`,
      9: `IFERROR(L${row + 1}/E${row + 1},"N/A")`,
      13: `IFERROR(P${row + 1}/M${row + 1},"N/A")`,
      16: `IFERROR(P${row + 1}/K${row + 1},I${row + 1})`,
      21: `IFERROR((H${row + 1}-P${row + 1})/O${row + 1},"N/A")`,
    });
    return f;
  }

  for (const [div, name] of Object.entries(DIVISIONS) as Array<[DivisionCode, string]>) {
    const divJobs = selected
      .filter((r) => r.division === div)
      .sort((a, b) => a.id.localeCompare(b.id));
    if (!divJobs.length) continue;

    const title = Array(22).fill('') as string[];
    title[0] = `${div} ${name}`;
    title[3] = 'Projected';
    title[10] = 'Actual';
    add(title, {}, 'title');
    merges.push(`A${row}:C${row}`, `D${row}:I${row}`, `K${row}:Q${row}`);
    add(WIP_HEADERS, {}, 'header');

    const start = row + 1;
    const values = divJobs.map(calcWipArray);
    values.forEach((v) => add(v, rowFormulas(row + 1)));

    const t = calcWipTotals(values);
    t[0] = `${name} Total`;
    t[1] = '';
    t[2] = '';
    const f = totalFormula([[start, row]]);
    add(t, f, 'total');
    merges.push(`A${row}:C${row}`);
    subrows.push(row);
    subvals.push(t);
  }

  add([]);
  const grand = calcWipTotals(subvals);
  grand[0] = 'Grand Total';
  grand[1] = '';
  grand[2] = '';
  grand[22] = Number(grand[19] || 0) - Number(grand[18] || 0);
  const grandFormulas = totalFormula(subrows);
  grandFormulas[22] = `SUM(T${row + 1}-S${row + 1})`;
  add(grand, grandFormulas, 'total');
  merges.push(`A${row}:C${row}`);

  const z = new JSZip();
  z.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-officedocument.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'
  );
  z.file(
    '_rels/.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
  );
  z.file(
    'xl/workbook.xml',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="WIP Report" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>'
  );
  z.file(
    'xl/_rels/workbook.xml.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
  );
  z.file('xl/styles.xml', WIP_STYLES_XML);
  z.file(
    'xl/worksheets/sheet1.xml',
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:W${row}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="12.75"/><cols><col min="1" max="1" width="11" customWidth="1"/><col min="2" max="2" width="10" customWidth="1"/><col min="3" max="3" width="30" customWidth="1"/><col min="4" max="4" width="13" customWidth="1"/><col min="5" max="5" width="13" customWidth="1"/><col min="6" max="6" width="11" customWidth="1"/><col min="7" max="7" width="12" customWidth="1"/><col min="8" max="8" width="12" customWidth="1"/><col min="9" max="9" width="9" customWidth="1"/><col min="10" max="10" width="10" customWidth="1"/><col min="11" max="11" width="13" customWidth="1"/><col min="12" max="12" width="13" customWidth="1"/><col min="13" max="13" width="11" customWidth="1"/><col min="14" max="14" width="12" customWidth="1"/><col min="15" max="15" width="12" customWidth="1"/><col min="16" max="16" width="12" customWidth="1"/><col min="17" max="17" width="9" customWidth="1"/><col min="18" max="18" width="13" customWidth="1"/><col min="19" max="19" width="12" customWidth="1"/><col min="20" max="20" width="12" customWidth="1"/><col min="21" max="21" width="13" customWidth="1"/><col min="22" max="22" width="15" customWidth="1"/><col min="23" max="23" width="17" customWidth="1"/></cols><sheetData>${lines.join('')}</sheetData><mergeCells count="${merges.length}">${merges
      .map((m) => `<mergeCell ref="${m}"/>`)
      .join('')}</mergeCells><pageSetup orientation="landscape" paperSize="8"/></worksheet>`
  );

  return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export function buildPriorSnapshotFromWip(
  wipData: { map: Map<string, WipRawRecord>; period: string },
  hoursData?: { map: Map<string, HoursRecord>; period: string },
  jobsMap?: Map<string, DivisionCode>
): Map<string, PriorJobSnapshot> {
  const out = new Map<string, PriorJobSnapshot>();
  for (const r of wipData.map.values()) {
    const hrs = hoursData?.map.get(r.id) || { hours: 0, actualHours: 0 };
    const h = r.contract - r.cost;
    const i = r.contract > 0 ? h / r.contract : 0;
    const j = r.cost > 0 ? r.actualCost / r.cost : 0;
    const k = h > 0 ? j * r.contract : r.actualCost + h;
    const p = k - r.actualCost;
    out.set(r.id, {
      id: r.id,
      name: r.name,
      division: jobsMap?.get(r.id) || '',
      contract: r.contract,
      cost: r.cost,
      projectedProfit: h,
      projectedGpPct: i,
      actualCost: r.actualCost,
      billed: r.billed,
      earnedRevenue: k,
      earnedProfit: p,
      hours: hrs.hours,
      actualHours: hrs.actualHours,
    });
  }
  return out;
}

// Sample Spectrum dataset for quick evaluation and verification of all 6 subsheets
export function createSampleSpectrumDataset(): {
  jobs: JoinedJob[];
  period: string;
  priorPeriod: string;
  priorMap: Map<string, PriorJobSnapshot>;
} {
  const sampleJobs: JoinedJob[] = [
    {
      id: '112804',
      name: 'Kadlec Regional Med Center Chiller Plant Upgrade',
      division: '01',
      contract: 2480000,
      cost: 1920000,
      hours: 9400,
      actualCost: 1465000,
      actualHours: 6950,
      billed: 1790000,
      missingHours: false,
      manualDivision: false,
      allowZero: false,
      selected: true,
    },
    {
      id: '112915',
      name: 'Hanford Vit Plant HVAC Piping Phase 3',
      division: '01',
      contract: 1840000,
      cost: 1510000,
      hours: 7200,
      actualCost: 1185000,
      actualHours: 6180,
      billed: 1320000,
      missingHours: false,
      manualDivision: false,
      allowZero: false,
      selected: true,
    },
    {
      id: '113042',
      name: 'Yakima Valley Memorial Tower Mechanical',
      division: '00',
      contract: 3650000,
      cost: 2890000,
      hours: 13800,
      actualCost: 1980000,
      actualHours: 8920,
      billed: 2680000,
      missingHours: false,
      manualDivision: false,
      allowZero: false,
      selected: true,
    },
    {
      id: '113118',
      name: 'Richland School District High School Boiler Retrofit',
      division: '01',
      contract: 945000,
      cost: 760000,
      hours: 3450,
      actualCost: 428000,
      actualHours: 1840,
      billed: 465000,
      missingHours: false,
      manualDivision: false,
      allowZero: false,
      selected: true,
    },
    {
      id: '113189',
      name: 'Providence Sacred Heart ICU Air Handler Replacement',
      division: '00',
      contract: 1290000,
      cost: 1345000,
      hours: 5100,
      actualCost: 995000,
      actualHours: 4280,
      billed: 920000,
      missingHours: false,
      manualDivision: false,
      allowZero: false,
      selected: true,
    },
    {
      id: '113210',
      name: 'Spokane Cold Storage Ammonia Refrigeration',
      division: '00',
      contract: 1620000,
      cost: 1270000,
      hours: 5900,
      actualCost: 540000,
      actualHours: 2390,
      billed: 790000,
      missingHours: false,
      manualDivision: false,
      allowZero: false,
      selected: true,
    },
    {
      id: '113290',
      name: 'Lamb Weston Pasco Steam Line Expansion',
      division: '03',
      contract: 685000,
      cost: 512000,
      hours: 2450,
      actualCost: 398000,
      actualHours: 2040,
      billed: 545000,
      missingHours: false,
      manualDivision: false,
      allowZero: false,
      selected: true,
    },
    {
      id: '113305',
      name: 'Cascade Medical Clinic VRF Controls & Piping',
      division: '02',
      contract: 420000,
      cost: 318000,
      hours: 1580,
      actualCost: 235000,
      actualHours: 1120,
      billed: 295000,
      missingHours: false,
      manualDivision: false,
      allowZero: false,
      selected: true,
    },
    {
      id: '113344',
      name: 'Columbia Basin College Lab Exhaust & Ductwork',
      division: '01',
      contract: 780000,
      cost: 635000,
      hours: 3100,
      actualCost: 215000,
      actualHours: 1180,
      billed: 240000,
      missingHours: false,
      manualDivision: false,
      allowZero: false,
      selected: true,
    },
    {
      id: '113368',
      name: 'UPS Bathroom Remodel TI',
      division: '',
      contract: 0,
      cost: 0,
      hours: 0,
      actualCost: 0,
      actualHours: 0,
      billed: 0,
      missingHours: true,
      manualDivision: true,
      allowZero: false,
      selected: false,
    },
    {
      id: '113391',
      name: 'Kennewick Civic Center Rooftop Unit Replacement',
      division: '03',
      contract: 315000,
      cost: 229000,
      hours: 1080,
      actualCost: 112000,
      actualHours: 510,
      billed: 185000,
      missingHours: false,
      manualDivision: false,
      allowZero: false,
      selected: true,
    },
    {
      id: '113412',
      name: 'MultiCare Deaconess Surgical Suite Humidification',
      division: '02',
      contract: 540000,
      cost: 412000,
      hours: 1960,
      actualCost: 186000,
      actualHours: 840,
      billed: 210000,
      missingHours: false,
      manualDivision: false,
      allowZero: false,
      selected: true,
    },
  ];

  // Prior month snapshot showing realistic profit gains, fades, and new jobs
  const priorMap = new Map<string, PriorJobSnapshot>([
    [
      '112804',
      {
        id: '112804',
        name: 'Kadlec Regional Med Center Chiller Plant Upgrade',
        division: '01',
        contract: 2420000,
        cost: 1910000,
        projectedProfit: 510000,
        projectedGpPct: 510000 / 2420000,
        actualCost: 1210000,
        billed: 1520000,
        earnedRevenue: (1210000 / 1910000) * 2420000,
        earnedProfit: (1210000 / 1910000) * 2420000 - 1210000,
        hours: 9250,
        actualHours: 5820,
      },
    ],
    [
      '112915',
      {
        id: '112915',
        name: 'Hanford Vit Plant HVAC Piping Phase 3',
        division: '01',
        contract: 1840000,
        cost: 1435000,
        projectedProfit: 405000,
        projectedGpPct: 405000 / 1840000,
        actualCost: 980000,
        billed: 1180000,
        earnedRevenue: (980000 / 1435000) * 1840000,
        earnedProfit: (980000 / 1435000) * 1840000 - 980000,
        hours: 7200,
        actualHours: 5100,
      },
    ],
    [
      '113042',
      {
        id: '113042',
        name: 'Yakima Valley Memorial Tower Mechanical',
        division: '00',
        contract: 3650000,
        cost: 2940000,
        projectedProfit: 710000,
        projectedGpPct: 710000 / 3650000,
        actualCost: 1620000,
        billed: 2290000,
        earnedRevenue: (1620000 / 2940000) * 3650000,
        earnedProfit: (1620000 / 2940000) * 3650000 - 1620000,
        hours: 13800,
        actualHours: 7400,
      },
    ],
    [
      '113118',
      {
        id: '113118',
        name: 'Richland School District High School Boiler Retrofit',
        division: '01',
        contract: 945000,
        cost: 760000,
        projectedProfit: 185000,
        projectedGpPct: 185000 / 945000,
        actualCost: 310000,
        billed: 380000,
        earnedRevenue: (310000 / 760000) * 945000,
        earnedProfit: (310000 / 760000) * 945000 - 310000,
        hours: 3450,
        actualHours: 1410,
      },
    ],
    [
      '113189',
      {
        id: '113189',
        name: 'Providence Sacred Heart ICU Air Handler Replacement',
        division: '00',
        contract: 1290000,
        cost: 1240000,
        projectedProfit: 50000,
        projectedGpPct: 50000 / 1290000,
        actualCost: 820000,
        billed: 840000,
        earnedRevenue: (820000 / 1240000) * 1290000,
        earnedProfit: (820000 / 1240000) * 1290000 - 820000,
        hours: 5100,
        actualHours: 3450,
      },
    ],
    [
      '113290',
      {
        id: '113290',
        name: 'Lamb Weston Pasco Steam Line Expansion',
        division: '03',
        contract: 685000,
        cost: 495000,
        projectedProfit: 190000,
        projectedGpPct: 190000 / 685000,
        actualCost: 295000,
        billed: 450000,
        earnedRevenue: (295000 / 495000) * 685000,
        earnedProfit: (295000 / 495000) * 685000 - 295000,
        hours: 2450,
        actualHours: 1490,
      },
    ],
  ]);

  return {
    jobs: sampleJobs,
    period: '10/31/2026',
    priorPeriod: '09/30/2026',
    priorMap,
  };
}
