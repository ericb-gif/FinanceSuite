import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, X } from 'lucide-react';
import { pfMoney } from '../lib/profitForecastEngine';
import type { PfDrillItem } from '../types/profitForecast';

interface DrillModalProps {
  open: boolean;
  title: string;
  note?: string;
  items: PfDrillItem[];
  jobNameLookup: (key: string) => string;
  onClose: () => void;
  onOpenJob?: (key: string) => void;
}

interface DrillGroup {
  name: string;
  key: string | null;
  tot: number;
  rows: PfDrillItem[];
}

export const DrillModal: React.FC<DrillModalProps> = ({
  open,
  title,
  note,
  items,
  jobNameLookup,
  onClose,
  onOpenJob,
}) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setExpanded({});
  }, [open, title]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const { groups, total, singleUngrouped } = useMemo(() => {
    const map: Record<string, DrillGroup> = {};
    for (const it of items) {
      const gName = it.key ? jobNameLookup(it.key) : it.group || 'Other';
      if (!map[gName]) {
        map[gName] = { name: gName, key: it.key, tot: 0, rows: [] };
      }
      map[gName].tot += it.amt;
      map[gName].rows.push(it);
    }
    const list = Object.values(map).sort((a, b) => Math.abs(b.tot) - Math.abs(a.tot));
    const tot = list.reduce((s, g) => s + g.tot, 0);
    const single = list.length === 1 && !list[0].key;
    return { groups: list, total: tot, singleUngrouped: single };
  }, [items, jobNameLookup]);

  if (!open) return null;

  const toggleGroup = (name: string) => {
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900 truncate">{title}</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {groups.length} {singleUngrouped ? 'items' : 'sources'} · Total{' '}
              <span className="font-mono font-semibold text-slate-800 tabular-nums">
                {pfMoney(total)}
              </span>
              {note ? ` · ${note}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drill-down"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-slate-100 text-slate-700">
                <tr className="border-b border-slate-200">
                  <th className="px-3 py-2 font-semibold">Source / Detail</th>
                  <th className="px-3 py-2 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {groups.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-3 py-6 text-center text-slate-500">
                      Nothing in this number.
                    </td>
                  </tr>
                ) : singleUngrouped ? (
                  groups[0].rows.map((r, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/70">
                      <td className="px-3 py-2 text-slate-700">{r.label}</td>
                      <td
                        className={`px-3 py-2 text-right font-mono tabular-nums ${
                          r.amt < -0.5 ? 'text-red-700' : 'text-slate-900'
                        }`}
                      >
                        {pfMoney(r.amt)}
                      </td>
                    </tr>
                  ))
                ) : (
                  groups.map((g) => {
                    const isOpen = Boolean(expanded[g.name]);
                    const hasDetail = g.rows.length > 1 || Boolean(g.key);
                    return (
                      <React.Fragment key={g.name}>
                        <tr
                          onClick={() => hasDetail && toggleGroup(g.name)}
                          className={`bg-white ${
                            hasDetail ? 'cursor-pointer hover:bg-slate-50' : ''
                          }`}
                        >
                          <td className="px-3 py-2.5 font-medium text-slate-900">
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-1.5 min-w-0">
                                {hasDetail &&
                                  (isOpen ? (
                                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                  ) : (
                                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                  ))}
                                <span className="truncate">{g.name}</span>
                              </div>
                              {g.key && onOpenJob && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onClose();
                                    onOpenJob(g.key as string);
                                  }}
                                  className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-[#0F293A] hover:bg-slate-100 shrink-0"
                                >
                                  Open job
                                  <ExternalLink className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </td>
                          <td
                            className={`px-3 py-2.5 text-right font-mono font-semibold tabular-nums ${
                              g.tot < -0.5 ? 'text-red-700' : 'text-slate-900'
                            }`}
                          >
                            {pfMoney(g.tot)}
                          </td>
                        </tr>
                        {isOpen &&
                          g.rows.map((r, rIdx) => (
                            <tr key={rIdx} className="bg-slate-50/70">
                              <td className="py-1.5 pl-8 pr-3 text-[11px] text-slate-600">
                                {r.label}
                              </td>
                              <td
                                className={`px-3 py-1.5 text-right font-mono text-[11px] tabular-nums ${
                                  r.amt < -0.5 ? 'text-red-700' : 'text-slate-700'
                                }`}
                              >
                                {pfMoney(r.amt)}
                              </td>
                            </tr>
                          ))}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
              <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold">
                <tr>
                  <td className="px-3 py-2.5 text-slate-900">Total</td>
                  <td
                    className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                      total < -0.5 ? 'text-red-700' : 'text-slate-900'
                    }`}
                  >
                    {pfMoney(total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
