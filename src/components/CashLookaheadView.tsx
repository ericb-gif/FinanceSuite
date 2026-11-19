import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { fmtMoney } from '../lib/formatters';
import { LA_IN, LA_OUT, dShort, laIn, laSrc, monOf } from '../lib/lookaheadEngine';
import { MON_NAMES, jobKey, mLong, pfMoney } from '../lib/profitForecastEngine';
import type {
  PfDrillItem,
  PfLookaheadResult,
  PfLookaheadSettings,
  PfState,
} from '../types/profitForecast';
import type { CashAssumptions, CashWeekRow, JobCashPosition } from '../types/wip';

interface CashLookaheadViewProps {
  assumptions: CashAssumptions;
  weeks: CashWeekRow[];
  jobPositions: JobCashPosition[];
  period: string;
  onUpdateAssumptions: (patch: Partial<CashAssumptions>) => void;
  pfState?: PfState | null;
  lookahead?: PfLookaheadResult | null;
  onUpdateLookahead?: (patch: Partial<PfLookaheadSettings>, resetAll?: boolean) => void;
  onOpenDrill?: (title: string, items: PfDrillItem[], note?: string) => void;
}

export const CashLookaheadView: React.FC<CashLookaheadViewProps> = ({
  assumptions,
  weeks,
  jobPositions,
  period,
  onUpdateAssumptions,
  pfState,
  lookahead,
  onUpdateLookahead,
  onOpenDrill,
}) => {
  const has28Week = Boolean(lookahead);
  const [subView, setSubView] = useState<'loc28' | 'wip13'>(has28Week ? 'loc28' : 'wip13');
  const [showWeeklyDetail, setShowWeeklyDetail] = useState(false);
  const [showBoardHours, setShowBoardHours] = useState(false);
  const [newJobNum, setNewJobNum] = useState('');
  const [newJobDays, setNewJobDays] = useState('');
  const [resetArmed, setResetArmed] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!lookahead && subView === 'loc28') setSubView('wip13');
  }, [lookahead, subView]);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    };
  }, []);

  const endingWeek13 = weeks[weeks.length - 1]?.endingCash ?? assumptions.startingCash;
  const totalInflows = weeks.reduce((s, w) => s + w.scheduledBillings, 0);
  const totalOutflows = weeks.reduce((s, w) => s + w.directJobOutflows + w.overheadOutflow, 0);
  const totalUnderbillings = jobPositions.reduce((s, p) => s + p.job.underBillings, 0);

  const minCash = Math.min(...weeks.map((w) => w.endingCash), assumptions.startingCash);
  const maxCash = Math.max(...weeks.map((w) => w.endingCash), assumptions.startingCash, 1);
  const span = Math.max(1, maxCash - Math.min(0, minCash));

  const render28WeekLookahead = () => {
    if (!lookahead || !pfState) return null;
    const A = lookahead;
    const S = A.S;
    const pk = A.peak;
    const lowAvail = S.limit - A.line[pk];
    const lastI = A.n - 1;
    const lastMonthName = MON_NAMES[+A.M[A.M.length - 1].k.slice(5) - 1] || '';
    const billDay = (pfState.settings.cash || {}).billDay || 20;
    const SRC = laSrc(S, billDay);

    const w = 1080;
    const h = 230;
    const pl = 64;
    const pr = 12;
    const pt = 14;
    const pb = 28;
    const hiV = Math.max(S.limit, ...A.line) * 1.05;
    const loV = Math.min(0, ...A.line);
    const xPos = (i: number) => pl + ((w - pl - pr) * i) / Math.max(1, A.n - 1);
    const yPos = (v: number) => pt + (h - pt - pb) * (1 - (v - loV) / Math.max(1, hiV - loV));
    const pathD = A.line
      .map((v, i) => `${i ? 'L' : 'M'}${xPos(i).toFixed(1)},${yPos(v).toFixed(1)}`)
      .join('');
    const ticks: number[] = [];
    for (let v = 0; v <= hiV; v += 1000000) ticks.push(v);

    const openLaDrill = (cat: string, mKey: string) => {
      if (!onOpenDrill) return;
      const lab = [...LA_IN, ...LA_OUT].find(([k]) => cat.endsWith(`:${k}`));
      const rawItems = A.items[cat] || [];
      const its: PfDrillItem[] = rawItems
        .filter((x) => A.mOf(x.i) === mKey)
        .map((x) => ({
          key: x.key,
          label: x.label,
          amt: cat.startsWith('out') ? -x.amt : x.amt,
          week: A.W[x.i],
        }));
      onOpenDrill(
        `${lab ? lab[1] : cat} · ${mLong(mKey)}`,
        its,
        'Weeks count in the month their Friday falls in.'
      );
    };

    const live = (arr: number[]) => A.M.some((m) => Math.abs(A.sumM(arr, m.k)) > 0.5);
    const schedWeeks = A.W.filter((d) => d <= S.schedInThru || d <= S.schedOutThru);
    const hourKeys = Object.keys(S.hours || {}).sort();

    const savePatch = (patch: Partial<PfLookaheadSettings>) => {
      onUpdateLookahead?.(patch, false);
    };

    const updateNumMap = (
      mapName: 'schedIn' | 'schedOut' | 'hours' | 'jobDays',
      k: string,
      valStr: string
    ) => {
      const baseMap = { ...(laIn(pfState)[mapName] || {}) };
      if (valStr === '') delete baseMap[k];
      else baseMap[k] = Number(valStr);
      savePatch({ [mapName]: baseMap });
    };

    const updateList = (
      listName: 'retention' | 'oneOff',
      idx: number,
      field: 'name' | 'amt' | 'date',
      val: string
    ) => {
      const next = (S[listName] || []).map((item, rIdx) =>
        rIdx === idx ? { ...item, [field]: field === 'amt' ? Number(val) : val } : item
      );
      savePatch({ [listName]: next });
    };

    return (
      <div className="space-y-6">
        {/* 4 KPI Strip */}
        <div className="grid grid-cols-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white lg:grid-cols-4 lg:divide-x lg:divide-y-0">
          <div className="p-4">
            <div className="text-xs font-medium text-slate-500">Line today</div>
            <div className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {pfMoney(S.line0)}
            </div>
            <div className="mt-1 text-xs text-slate-500 tabular-nums">
              {pfMoney(S.limit - S.line0)} available on {pfMoney(S.limit)}
            </div>
          </div>

          <div className="p-4">
            <div className="text-xs font-medium text-slate-500">Tightest week</div>
            <div
              className={`mt-1.5 font-mono text-2xl font-semibold tabular-nums ${
                lowAvail < S.cushion ? 'text-red-700' : 'text-slate-900'
              }`}
            >
              {pfMoney(A.line[pk])}
            </div>
            <div className="mt-1 text-xs text-slate-500 tabular-nums">
              week of {dShort(A.W[pk])} · {pfMoney(lowAvail)} available
            </div>
          </div>

          <div className="p-4">
            <div className="text-xs font-medium text-slate-500">
              Line at end of {lastMonthName}
            </div>
            <div
              className={`mt-1.5 font-mono text-2xl font-semibold tabular-nums ${
                A.line[lastI] > S.line0 ? 'text-red-700' : 'text-emerald-700'
              }`}
            >
              {pfMoney(A.line[lastI])}
            </div>
            <div className="mt-1 text-xs text-slate-500 tabular-nums">
              {A.line[lastI] < S.line0
                ? `${pfMoney(S.line0 - A.line[lastI])} lower than today`
                : `${pfMoney(A.line[lastI] - S.line0)} higher than today`}
            </div>
          </div>

          <div className="p-4">
            <div className="text-xs font-medium text-slate-500">Cash needed to keep cushion</div>
            <div
              className={`mt-1.5 font-mono text-2xl font-semibold tabular-nums ${
                A.need > 0.5 ? 'text-red-700' : 'text-emerald-700'
              }`}
            >
              {pfMoney(A.need)}
            </div>
            <div className="mt-1 text-xs text-slate-500 tabular-nums">
              {A.need > 0.5
                ? `to keep ${pfMoney(S.cushion)} free at tightest week`
                : `${pfMoney(S.cushion)} cushion holds every week`}
            </div>
          </div>
        </div>

        {/* Weekly Line of Credit SVG Chart */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                28-Week Line of Credit Trajectory
              </h2>
              <p className="text-xs text-slate-500">
                Hover any week point for exact balance · dashed red line marks {pfMoney(S.limit)}{' '}
                limit · amber band marks {pfMoney(S.cushion)} safety cushion
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <svg
              viewBox={`0 0 ${w} ${h}`}
              className="w-full min-w-[720px] h-56"
              role="img"
              aria-label="Weekly line of credit balance"
            >
              {ticks.map((v) => (
                <g key={v}>
                  <line
                    x1={pl}
                    x2={w - pr}
                    y1={yPos(v)}
                    y2={yPos(v)}
                    stroke="#e2e8f0"
                    strokeWidth="1"
                  />
                  <text
                    x={pl - 8}
                    y={yPos(v) + 4}
                    fontSize="11"
                    textAnchor="end"
                    fill="#64748b"
                  >
                    ${v / 1e6}M
                  </text>
                </g>
              ))}

              <rect
                x={pl}
                y={yPos(hiV)}
                width={w - pl - pr}
                height={Math.max(0, yPos(S.limit) - yPos(hiV))}
                fill="#fee2e2"
                opacity="0.65"
              />
              <rect
                x={pl}
                y={yPos(S.limit)}
                width={w - pl - pr}
                height={Math.max(0, yPos(S.limit - S.cushion) - yPos(S.limit))}
                fill="#fef3c7"
                opacity="0.75"
              />
              <line
                x1={pl}
                x2={w - pr}
                y1={yPos(S.limit)}
                y2={yPos(S.limit)}
                stroke="#b91c1c"
                strokeDasharray="4 3"
                strokeWidth="1.5"
              />
              <text
                x={w - pr}
                y={yPos(S.limit) - 4}
                fontSize="11"
                textAnchor="end"
                fill="#b91c1c"
              >
                Limit {pfMoney(S.limit)}
              </text>
              <text
                x={w - pr}
                y={yPos(S.limit - S.cushion) + 12}
                fontSize="11"
                textAnchor="end"
                fill="#b45309"
              >
                Cushion ({pfMoney(S.cushion)})
              </text>

              <path d={pathD} fill="none" stroke="#0F293A" strokeWidth="2.5" />

              {A.line.map((v, i) => (
                <circle key={i} cx={xPos(i)} cy={yPos(v)} r="3.2" fill="#0F293A">
                  <title>{`Week of ${dShort(A.W[i])}: ${pfMoney(v)}`}</title>
                </circle>
              ))}
              <circle
                cx={xPos(pk)}
                cy={yPos(A.line[pk])}
                r="6"
                fill="none"
                stroke="#b91c1c"
                strokeWidth="2"
              />

              {A.M.map((m) => {
                const i = m.ii[0];
                return (
                  <text
                    key={m.k}
                    x={xPos(i)}
                    y={h - 6}
                    fontSize="11"
                    fill="#64748b"
                  >
                    {MON_NAMES[+m.k.slice(5) - 1]}
                  </text>
                );
              })}
            </svg>
          </div>
        </div>

        {/* By Month Table */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">By month</h2>
            <p className="text-xs text-slate-500">
              Weeks count in the month their Friday falls in. Click any collection or outflow cell
              to inspect exact invoices, pay apps, payroll hours, or vendor rules.
            </p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-slate-100 text-slate-700">
                <tr className="border-b border-slate-200">
                  <th className="px-3 py-2.5 font-semibold min-w-[260px]" />
                  {A.M.map((m) => (
                    <th key={m.k} className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">
                      {MON_NAMES[+m.k.slice(5) - 1]} {m.k.slice(2, 4)}
                      {m.partial && (
                        <div className="text-[10px] font-normal text-slate-500">
                          from {dShort(S.start)}
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr className="bg-slate-100 font-semibold text-slate-900">
                  <td colSpan={A.M.length + 1} className="px-3 py-2">
                    Cash in
                  </td>
                </tr>
                {LA_IN.filter(([k]) => live(A.cin[k])).map(([k, lab]) => (
                  <tr key={`in:${k}`} className="hover:bg-slate-50/70">
                    <td className="px-3 py-2">
                      <div className="text-slate-800">{lab}</div>
                      {SRC[`in:${k}`] && (
                        <div className="text-[11px] text-slate-400">{SRC[`in:${k}`]}</div>
                      )}
                    </td>
                    {A.M.map((m) => {
                      const v = A.sumM(A.cin[k], m.k);
                      return (
                        <td
                          key={m.k}
                          onClick={() => Math.abs(v) > 0.5 && openLaDrill(`in:${k}`, m.k)}
                          className={`px-3 py-2 text-right font-mono tabular-nums ${
                            Math.abs(v) > 0.5
                              ? 'cursor-pointer text-[#0F293A] underline decoration-dotted hover:bg-slate-100'
                              : 'text-slate-400'
                          }`}
                        >
                          {pfMoney(v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <td className="px-3 py-2">Total cash in</td>
                  {A.M.map((m) => (
                    <td
                      key={m.k}
                      className="px-3 py-2 text-right font-mono text-emerald-700 tabular-nums"
                    >
                      {pfMoney(A.sumM(A.tin, m.k))}
                    </td>
                  ))}
                </tr>

                <tr className="bg-slate-100 font-semibold text-slate-900">
                  <td colSpan={A.M.length + 1} className="px-3 py-2">
                    Cash out
                  </td>
                </tr>
                {LA_OUT.filter(([k]) => live(A.cout[k])).map(([k, lab]) => (
                  <tr key={`out:${k}`} className="hover:bg-slate-50/70">
                    <td className="px-3 py-2">
                      <div className="text-slate-800">{lab}</div>
                      {SRC[`out:${k}`] && (
                        <div className="text-[11px] text-slate-400">{SRC[`out:${k}`]}</div>
                      )}
                    </td>
                    {A.M.map((m) => {
                      const v = -A.sumM(A.cout[k], m.k);
                      return (
                        <td
                          key={m.k}
                          onClick={() => Math.abs(v) > 0.5 && openLaDrill(`out:${k}`, m.k)}
                          className={`px-3 py-2 text-right font-mono tabular-nums ${
                            Math.abs(v) > 0.5
                              ? 'cursor-pointer text-red-700 underline decoration-dotted hover:bg-slate-100'
                              : 'text-slate-400'
                          }`}
                        >
                          {pfMoney(v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <td className="px-3 py-2">Total cash out</td>
                  {A.M.map((m) => (
                    <td
                      key={m.k}
                      className="px-3 py-2 text-right font-mono text-red-700 tabular-nums"
                    >
                      {pfMoney(-A.sumM(A.tout, m.k))}
                    </td>
                  ))}
                </tr>

                <tr className="bg-slate-100 font-bold">
                  <td className="px-3 py-2 text-slate-900">Net cash for the month</td>
                  {A.M.map((m) => {
                    const net = A.sumM(A.tin, m.k) - A.sumM(A.tout, m.k);
                    return (
                      <td
                        key={m.k}
                        className={`px-3 py-2 text-right font-mono tabular-nums ${
                          net < -0.5 ? 'text-red-700' : 'text-emerald-700'
                        }`}
                      >
                        {pfMoney(net)}
                      </td>
                    );
                  })}
                </tr>

                <tr className="bg-[#0F293A] text-white font-semibold">
                  <td colSpan={A.M.length + 1} className="px-3 py-2">
                    Line of credit ({pfMoney(S.limit)} limit)
                  </td>
                </tr>
                <tr className="font-semibold">
                  <td className="px-3 py-2">Balance at month end</td>
                  {A.M.map((m) => (
                    <td key={m.k} className="px-3 py-2 text-right font-mono tabular-nums">
                      {pfMoney(m.end)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-3 py-2 text-slate-600">Highest balance during the month</td>
                  {A.M.map((m) => (
                    <td key={m.k} className="px-3 py-2 text-right font-mono tabular-nums">
                      {pfMoney(m.high)}
                    </td>
                  ))}
                </tr>
                <tr className="bg-slate-50 font-semibold">
                  <td className="px-3 py-2">Available at the tightest week</td>
                  {A.M.map((m) => {
                    const avail = S.limit - m.high;
                    return (
                      <td
                        key={m.k}
                        className={`px-3 py-2 text-right font-mono tabular-nums ${
                          avail < S.cushion ? 'text-red-700' : 'text-slate-900'
                        }`}
                      >
                        {pfMoney(avail)}
                      </td>
                    );
                  })}
                </tr>

                <tr className="bg-slate-100 font-semibold text-slate-900">
                  <td colSpan={A.M.length + 1} className="px-3 py-2">
                    Health of the company
                  </td>
                </tr>
                <tr className="text-slate-600">
                  <td className="px-3 py-2">Net overbilled at month end</td>
                  {A.M.map((m) => (
                    <td key={m.k} className="px-3 py-2 text-right font-mono tabular-nums">
                      {A.ouBy[m.k] !== undefined ? pfMoney(A.ouBy[m.k]) : ''}
                    </td>
                  ))}
                </tr>
                <tr className="text-slate-600">
                  <td className="px-3 py-2">Working capital at month end</td>
                  {A.M.map((m) => (
                    <td
                      key={m.k}
                      className={`px-3 py-2 text-right font-mono tabular-nums ${
                        (A.wcBy[m.k] || 0) < -0.5 ? 'text-red-700' : ''
                      }`}
                    >
                      {A.wcBy[m.k] !== undefined ? pfMoney(A.wcBy[m.k]) : ''}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Collapsible Week-by-Week Table */}
        <div className="rounded-xl border border-slate-200 bg-white">
          <button
            type="button"
            onClick={() => setShowWeeklyDetail((v) => !v)}
            className="flex w-full items-center justify-between px-5 py-3 text-left text-xs font-semibold text-slate-900 hover:bg-slate-50"
          >
            <div className="flex items-center gap-2">
              {showWeeklyDetail ? (
                <ChevronDown className="h-4 w-4 text-slate-400" />
              ) : (
                <ChevronRight className="h-4 w-4 text-slate-400" />
              )}
              <span>Week by week schedule ({A.W.length} weeks)</span>
            </div>
            <span className="font-normal text-slate-500">
              {dShort(A.W[0])} – {dShort(A.W[A.W.length - 1])}
            </span>
          </button>

          {showWeeklyDetail && (
            <div className="border-t border-slate-200 p-4">
              <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-[420px]">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 bg-slate-100 text-slate-700">
                    <tr className="border-b border-slate-200">
                      <th className="px-3 py-2 font-semibold">Week of</th>
                      <th className="px-3 py-2 text-right font-semibold">Cash in</th>
                      <th className="px-3 py-2 text-right font-semibold">Cash out</th>
                      <th className="px-3 py-2 text-right font-semibold">Net</th>
                      <th className="px-3 py-2 text-right font-semibold">Line balance</th>
                      <th className="px-3 py-2 text-right font-semibold">Available</th>
                      <th className="px-3 py-2 font-semibold">Based on</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {A.W.map((d, i) => {
                      const net = A.tin[i] - A.tout[i];
                      const avail = S.limit - A.line[i];
                      const basis = [
                        d <= S.schedInThru ? 'collections from cash sheet' : '',
                        d <= S.schedOutThru ? 'vendor payments from cash sheet' : '',
                      ]
                        .filter(Boolean)
                        .join(' · ');
                      return (
                        <tr key={d} className="hover:bg-slate-50/70">
                          <td className="px-3 py-1.5 font-mono">{dShort(d)}</td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                            {pfMoney(A.tin[i])}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                            {pfMoney(-A.tout[i])}
                          </td>
                          <td
                            className={`px-3 py-1.5 text-right font-mono tabular-nums ${
                              net < -0.5 ? 'text-red-700' : 'text-emerald-700'
                            }`}
                          >
                            {pfMoney(net)}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">
                            {pfMoney(A.line[i])}
                          </td>
                          <td
                            className={`px-3 py-1.5 text-right font-mono tabular-nums ${
                              avail < S.cushion ? 'text-red-700 font-semibold' : ''
                            }`}
                          >
                            {pfMoney(avail)}
                          </td>
                          <td className="px-3 py-1.5 text-slate-500">{basis || 'drivers'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* 6-Panel Editable Drivers */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Drivers</h2>
              <p className="text-xs text-slate-500">
                What each line is built from, where the number comes from, and when to update it.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                if (resetArmed) {
                  setResetArmed(false);
                  if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
                  onUpdateLookahead?.({}, true);
                } else {
                  setResetArmed(true);
                  resetTimerRef.current = window.setTimeout(() => setResetArmed(false), 4000);
                }
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${
                resetArmed
                  ? 'border-red-300 bg-red-50 text-red-800'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {resetArmed
                ? 'Click again to reset every driver'
                : 'Reset all drivers to starting values'}
            </button>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 text-xs">
            {/* Panel 1: Starting point */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 space-y-3">
              <h3 className="font-semibold text-slate-900">
                Starting point · update every Monday
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="font-medium text-slate-700">Week starting (Monday)</span>
                  <input
                    type="date"
                    value={S.start}
                    onChange={(e) => e.target.value && savePatch({ start: monOf(e.target.value) })}
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                </label>
                <label className="block">
                  <span className="font-medium text-slate-700">LOC balance at start ($)</span>
                  <input
                    type="number"
                    step="1000"
                    value={S.line0}
                    onChange={(e) => savePatch({ line0: Number(e.target.value) || 0 })}
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums"
                  />
                </label>
                <label className="block">
                  <span className="font-medium text-slate-700">Line limit ($)</span>
                  <input
                    type="number"
                    step="50000"
                    value={S.limit}
                    onChange={(e) => savePatch({ limit: Number(e.target.value) || 0 })}
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums"
                  />
                </label>
                <label className="block">
                  <span className="font-medium text-slate-700">Cushion to keep available ($)</span>
                  <input
                    type="number"
                    step="50000"
                    value={S.cushion}
                    onChange={(e) => savePatch({ cushion: Number(e.target.value) || 0 })}
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums"
                  />
                </label>
                <label className="block">
                  <span className="font-medium text-slate-700">Line interest rate %</span>
                  <input
                    type="number"
                    step="0.25"
                    value={+(S.rate * 100).toFixed(2)}
                    onChange={(e) => savePatch({ rate: (Number(e.target.value) || 0) / 100 })}
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums"
                  />
                </label>
              </div>
            </div>

            {/* Panel 2: Weekly Cash Sheet */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 space-y-3">
              <h3 className="font-semibold text-slate-900">
                Weeks taken from weekly cash sheet · update every Monday
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="font-medium text-slate-700">Collections through week of</span>
                  <input
                    type="date"
                    value={S.schedInThru}
                    onChange={(e) =>
                      e.target.value && savePatch({ schedInThru: monOf(e.target.value) })
                    }
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                </label>
                <label className="block">
                  <span className="font-medium text-slate-700">
                    Vendor payments through week of
                  </span>
                  <input
                    type="date"
                    value={S.schedOutThru}
                    onChange={(e) =>
                      e.target.value && savePatch({ schedOutThru: monOf(e.target.value) })
                    }
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                </label>
              </div>
              <div className="overflow-x-auto rounded border border-slate-200 bg-white max-h-48">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="bg-slate-100">
                    <tr>
                      <th className="px-2.5 py-1.5 font-semibold">Week of</th>
                      <th className="px-2.5 py-1.5 text-right font-semibold">Collections ($)</th>
                      <th className="px-2.5 py-1.5 text-right font-semibold">
                        Vendor checks ($)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {schedWeeks.map((d) => (
                      <tr key={d}>
                        <td className="px-2.5 py-1 font-mono">{dShort(d)}</td>
                        <td className="px-2.5 py-1 text-right">
                          <input
                            type="number"
                            step="1000"
                            disabled={d > S.schedInThru}
                            value={(S.schedIn || {})[d] ?? ''}
                            onChange={(e) => updateNumMap('schedIn', d, e.target.value)}
                            className="w-28 rounded border border-slate-300 px-2 py-0.5 text-right font-mono tabular-nums disabled:opacity-40"
                          />
                        </td>
                        <td className="px-2.5 py-1 text-right">
                          <input
                            type="number"
                            step="1000"
                            disabled={d > S.schedOutThru}
                            value={(S.schedOut || {})[d] ?? ''}
                            onChange={(e) => updateNumMap('schedOut', d, e.target.value)}
                            className="w-28 rounded border border-slate-300 px-2 py-0.5 text-right font-mono tabular-nums disabled:opacity-40"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Panel 3: Payroll & Manpower Board */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 space-y-3">
              <h3 className="font-semibold text-slate-900">
                Payroll · update when the manpower boards change
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(
                  [
                    ['payroll', 'Payroll + taxes + 401k / week ($)', 1000],
                    ['baseHours', 'Base field hours behind payroll', 10],
                    ['fixedGross', 'Support & office gross / week ($)', 1000],
                    ['fieldRate', 'Field gross / board hour ($)', 0.5],
                    ['health', 'Health insurance claims / week ($)', 1000],
                  ] as const
                ).map(([k, lab, step]) => (
                  <label key={k} className="block">
                    <span className="font-medium text-slate-700">{lab}</span>
                    <input
                      type="number"
                      step={step}
                      value={S[k]}
                      onChange={(e) => savePatch({ [k]: Number(e.target.value) || 0 })}
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums"
                    />
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setShowBoardHours((v) => !v)}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#0F293A] hover:underline"
              >
                {showBoardHours ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                Manpower board hours by week ({hourKeys.length} weeks)
              </button>
              {showBoardHours && (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {hourKeys.map((k) => (
                    <label key={k} className="block text-[11px]">
                      <span className="text-slate-500">{dShort(k)}</span>
                      <input
                        type="number"
                        step="10"
                        value={S.hours[k]}
                        onChange={(e) => updateNumMap('hours', k, e.target.value)}
                        className="mt-0.5 w-full rounded border border-slate-300 bg-white px-1.5 py-1 font-mono text-xs tabular-nums"
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Panel 4: Collections & Retention */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 space-y-3">
              <h3 className="font-semibold text-slate-900">Collections · update monthly</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="font-medium text-slate-700">Usual owner days to pay</span>
                  <input
                    type="number"
                    step="5"
                    value={S.days}
                    onChange={(e) => savePatch({ days: Number(e.target.value) || 0 })}
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums"
                  />
                </label>
                <label className="block">
                  <span className="font-medium text-slate-700">
                    Service days after month end
                  </span>
                  <input
                    type="number"
                    step="5"
                    value={S.svcDays}
                    onChange={(e) => savePatch({ svcDays: Number(e.target.value) || 0 })}
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums"
                  />
                </label>
              </div>

              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold text-slate-600">
                  Slow or fast paying jobs
                </div>
                {Object.entries(S.jobDays || {}).map(([jk, dv]) => (
                  <div key={jk} className="flex items-center gap-2">
                    <span className="w-24 font-mono text-slate-800">{jk}</span>
                    <input
                      type="number"
                      step="5"
                      value={dv}
                      onChange={(e) => updateNumMap('jobDays', jk, e.target.value)}
                      className="w-20 rounded border border-slate-300 bg-white px-2 py-1 text-right font-mono tabular-nums"
                    />
                    <span className="text-slate-500">days</span>
                    <button
                      type="button"
                      onClick={() => updateNumMap('jobDays', jk, '')}
                      className="text-slate-400 hover:text-red-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <input
                    type="text"
                    placeholder="Job # (e.g. 1614)"
                    value={newJobNum}
                    onChange={(e) => setNewJobNum(e.target.value)}
                    className="w-32 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                  />
                  <input
                    type="number"
                    placeholder="Days"
                    value={newJobDays}
                    onChange={(e) => setNewJobDays(e.target.value)}
                    className="w-20 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs tabular-nums"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const k = jobKey(newJobNum);
                      const d = Number(newJobDays);
                      if (!k || !d) return;
                      savePatch({ jobDays: { ...(S.jobDays || {}), [k]: d } });
                      setNewJobNum('');
                      setNewJobDays('');
                    }}
                    className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Add override
                  </button>
                </div>
              </div>

              <div className="space-y-1.5 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-600">
                    Retention releases
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      savePatch({
                        retention: [...(S.retention || []), { name: '', amt: 0, date: '' }],
                      })
                    }
                    className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium hover:bg-slate-100"
                  >
                    <Plus className="h-3 w-3" /> Add retention
                  </button>
                </div>
                {(S.retention || []).map((r, idx) => (
                  <div key={idx} className="flex flex-wrap items-center gap-1.5">
                    <input
                      type="text"
                      value={r.name}
                      placeholder="Job name"
                      onChange={(e) => updateList('retention', idx, 'name', e.target.value)}
                      className="flex-1 min-w-[140px] rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                    />
                    <input
                      type="number"
                      step="1000"
                      value={r.amt || ''}
                      onChange={(e) => updateList('retention', idx, 'amt', e.target.value)}
                      className="w-24 rounded border border-slate-300 bg-white px-2 py-1 text-right font-mono text-xs tabular-nums"
                    />
                    <input
                      type="date"
                      value={r.date}
                      onChange={(e) => updateList('retention', idx, 'date', e.target.value)}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        savePatch({
                          retention: (S.retention || []).filter((_, rIdx) => rIdx !== idx),
                        })
                      }
                      className="text-slate-400 hover:text-red-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Panel 5: Job Vendors & Subs */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 space-y-3">
              <h3 className="font-semibold text-slate-900">
                Job vendors and subs · check quarterly
              </h3>
              <label className="block">
                <span className="font-medium text-slate-700">
                  Paid-when-paid share of owner collections (%)
                </span>
                <input
                  type="number"
                  step="1"
                  value={+(S.pwp * 100).toFixed(2)}
                  onChange={(e) => savePatch({ pwp: (Number(e.target.value) || 0) / 100 })}
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums"
                />
              </label>
              <label className="block">
                <span className="font-medium text-slate-700">
                  Materials not held (% of job cost paid next month)
                </span>
                <input
                  type="number"
                  step="0.5"
                  value={+(S.matsLater * 100).toFixed(2)}
                  onChange={(e) => savePatch({ matsLater: (Number(e.target.value) || 0) / 100 })}
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums"
                />
              </label>
              <label className="block">
                <span className="font-medium text-slate-700">
                  New/likely jobs: non-labor share of cost (%)
                </span>
                <input
                  type="number"
                  step="1"
                  value={+(S.likelyNonLabor * 100).toFixed(2)}
                  onChange={(e) =>
                    savePatch({ likelyNonLabor: (Number(e.target.value) || 0) / 100 })
                  }
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums"
                />
              </label>
            </div>

            {/* Panel 6: Recurring & One-Time Payments */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 space-y-3">
              <h3 className="font-semibold text-slate-900">
                Recurring &amp; one-time payments · check quarterly
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    ['lanae', "Lanae's non-job check run / wk ($)"],
                    ['usbank', 'US Bank cards / wk ($)'],
                    ['comdata', 'Comdata fuel (5th) / mo ($)'],
                    ['dor', 'WA DOR (25th) / mo ($)'],
                    ['auto', 'Truck loans (1st & 15th) / mo ($)'],
                    ['draws', 'Owner draws / mo ($)'],
                    ['quarterly', 'Quarterly payroll tax ($)'],
                    ['match', 'Annual 401k match ($)'],
                  ] as const
                ).map(([k, lab]) => (
                  <label key={k} className="block">
                    <span className="font-medium text-slate-700">{lab}</span>
                    <input
                      type="number"
                      step="1000"
                      value={S[k]}
                      onChange={(e) => savePatch({ [k]: Number(e.target.value) || 0 })}
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums"
                    />
                  </label>
                ))}
                <label className="block">
                  <span className="font-medium text-slate-700">Q1 tax due</span>
                  <input
                    type="date"
                    value={S.q1}
                    onChange={(e) => savePatch({ q1: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                </label>
                <label className="block">
                  <span className="font-medium text-slate-700">Q2 tax due</span>
                  <input
                    type="date"
                    value={S.q2}
                    onChange={(e) => savePatch({ q2: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                </label>
                <label className="block">
                  <span className="font-medium text-slate-700">401k match date</span>
                  <input
                    type="date"
                    value={S.matchDate}
                    onChange={(e) => savePatch({ matchDate: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                </label>
              </div>

              <div className="space-y-1.5 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-600">
                    Other one-time payments
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      savePatch({
                        oneOff: [...(S.oneOff || []), { name: '', amt: 0, date: '' }],
                      })
                    }
                    className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium hover:bg-slate-100"
                  >
                    <Plus className="h-3 w-3" /> Add payment
                  </button>
                </div>
                {(S.oneOff || []).map((o, idx) => (
                  <div key={idx} className="flex flex-wrap items-center gap-1.5">
                    <input
                      type="text"
                      value={o.name}
                      placeholder="Description"
                      onChange={(e) => updateList('oneOff', idx, 'name', e.target.value)}
                      className="flex-1 min-w-[140px] rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                    />
                    <input
                      type="number"
                      step="1000"
                      value={o.amt || ''}
                      onChange={(e) => updateList('oneOff', idx, 'amt', e.target.value)}
                      className="w-24 rounded border border-slate-300 bg-white px-2 py-1 text-right font-mono text-xs tabular-nums"
                    />
                    <input
                      type="date"
                      value={o.date}
                      onChange={(e) => updateList('oneOff', idx, 'date', e.target.value)}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        savePatch({
                          oneOff: (S.oneOff || []).filter((_, rIdx) => rIdx !== idx),
                        })
                      }
                      className="text-slate-400 hover:text-red-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">04. Cash Lookahead</h1>
          <p className="mt-1 text-xs text-slate-500">
            Period ending {period || 'Current'} · 28-week weekly LOC model synced with Profit
            Forecast drivers plus 13-week WIP backlog burn &amp; retainage view
          </p>
        </div>

        {has28Week && (
          <div className="inline-flex rounded-lg bg-slate-100 p-1 shrink-0">
            <button
              type="button"
              onClick={() => setSubView('loc28')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                subView === 'loc28'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              28-Week LOC &amp; Drivers
            </button>
            <button
              type="button"
              onClick={() => setSubView('wip13')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                subView === 'wip13'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              13-Week WIP Burn &amp; Retainage
            </button>
          </div>
        )}
      </div>

      {subView === 'loc28' && lookahead ? (
        render28WeekLookahead()
      ) : (
        <div className="space-y-6">
          {/* 13-Week WIP Burn & Retainage View */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Cash Model Assumptions</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {(
                [
                  { key: 'startingCash', label: 'Starting Cash ($)' },
                  { key: 'retainagePct', label: 'Retainage (%)' },
                  { key: 'arCollectionDays', label: 'AR Cycle (Days)' },
                  { key: 'weeklyOverhead', label: 'Weekly Overhead ($)' },
                  { key: 'locLimit', label: 'LOC Limit ($)' },
                  { key: 'locDrawn', label: 'LOC Drawn ($)' },
                ] as const
              ).map((field) => (
                <label key={field.key} className="block">
                  <span className="block text-[11px] font-medium text-slate-500">
                    {field.label}
                  </span>
                  <input
                    type="number"
                    value={assumptions[field.key]}
                    onChange={(e) =>
                      onUpdateAssumptions({ [field.key]: Number(e.target.value) || 0 })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 tabular-nums focus:border-[#0F293A] focus:outline-none"
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white lg:grid-cols-4 lg:divide-x lg:divide-y-0">
            <div className="p-4">
              <div className="text-xs font-medium text-slate-500">13-Wk Projected Inflows</div>
              <div className="mt-1.5 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
                {fmtMoney.format(totalInflows)}
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs font-medium text-slate-500">13-Wk Projected Outflows</div>
              <div className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                {fmtMoney.format(totalOutflows)}
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs font-medium text-slate-500">Week 13 Ending Cash</div>
              <div
                className={`mt-1.5 font-mono text-2xl font-semibold tabular-nums ${
                  endingWeek13 >= 0 ? 'text-slate-900' : 'text-red-700'
                }`}
              >
                {fmtMoney.format(endingWeek13)}
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs font-medium text-slate-500">Unbilled WIP Receivable</div>
              <div className="mt-1.5 font-mono text-2xl font-semibold text-amber-700 tabular-nums">
                {fmtMoney.format(totalUnderbillings)}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                Weekly Ending Operating Cash Trajectory
              </h2>
              <span className="text-xs text-slate-500 tabular-nums">
                LOC Headroom: {fmtMoney.format(Math.max(0, assumptions.locLimit - assumptions.locDrawn))}
              </span>
            </div>

            <div className="grid grid-cols-13 gap-2 items-end h-44 pt-4 border-b border-slate-200 pb-2">
              {weeks.map((w) => {
                const normalized = Math.max(
                  4,
                  Math.round(((w.endingCash - Math.min(0, minCash)) / span) * 100)
                );
                const isNegative = w.endingCash < 0;
                return (
                  <div
                    key={w.weekNumber}
                    className="flex flex-col items-center justify-end h-full gap-1.5"
                  >
                    <div className="text-[10px] font-mono text-slate-500 tabular-nums hidden xl:block">
                      {fmtMoney.format(w.endingCash / 1000)}k
                    </div>
                    <div
                      title={`${w.label}: ${fmtMoney.format(w.endingCash)}`}
                      style={{ height: `${normalized}%` }}
                      className={`w-full max-w-[36px] rounded-t transition-all ${
                        isNegative ? 'bg-red-600' : 'bg-[#0F293A]'
                      }`}
                    />
                    <span className="text-[11px] font-medium text-slate-600 tabular-nums">
                      W{w.weekNumber}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">13-Week Cash Waterfall</h2>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-slate-100 text-slate-700">
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2.5 font-semibold">Period</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Backlog Burn</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Underbilling Coll.</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Total Inflows</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Direct Cost Out</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Overhead</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Net Cash Flow</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Ending Cash</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Total Liquidity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {weeks.map((w) => (
                    <tr key={w.weekNumber} className="hover:bg-slate-50/70">
                      <td className="px-3 py-2 font-medium text-slate-900">{w.label}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {fmtMoney.format(w.backlogBurnRevenue)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {fmtMoney.format(w.underbillingCollection)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-medium text-emerald-700 tabular-nums">
                        {fmtMoney.format(w.scheduledBillings)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {fmtMoney.format(w.directJobOutflows)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {fmtMoney.format(w.overheadOutflow)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${
                          w.netCashFlow >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {w.netCashFlow >= 0 ? '+' : ''}
                        {fmtMoney.format(w.netCashFlow)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900 tabular-nums">
                        {fmtMoney.format(w.endingCash)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-600 tabular-nums">
                        {fmtMoney.format(w.availableLiquidity)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">
              Job-Level Billing &amp; Retainage Position
            </h2>
            <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-[380px]">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-slate-100 text-slate-700">
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2.5 font-semibold">Job</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Contract</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Billed</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Underbillings</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Overbillings</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Remaining Backlog</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Cost to Complete</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Est. Retainage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {jobPositions.map((p) => (
                    <tr key={p.job.id} className="hover:bg-slate-50/70">
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-900 tabular-nums">{p.job.id}</div>
                        <div className="text-[11px] text-slate-500 max-w-[240px] truncate">
                          {p.job.name}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {fmtMoney.format(p.job.contract)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {fmtMoney.format(p.job.billed)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-amber-700">
                        {p.job.underBillings > 0 ? fmtMoney.format(p.job.underBillings) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-emerald-700">
                        {p.job.overBillings > 0 ? fmtMoney.format(p.job.overBillings) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {fmtMoney.format(p.job.backlog)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {fmtMoney.format(p.remainingCostOutflow)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-600">
                        {fmtMoney.format(p.estimatedRetainageHeld)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
