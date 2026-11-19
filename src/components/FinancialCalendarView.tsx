import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  CheckSquare,
  ExternalLink,
  Pencil,
  Plus,
  RefreshCw,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { GoogleSignInButton } from './GoogleSignInButton';
import { getAccessToken } from '../lib/googleAuth';
import {
  buildFinancialMilestones,
  createCalendarEvent,
  deleteCalendarEvent,
  listCalendarEvents,
  listUserCalendars,
  updateCalendarEvent,
  type GoogleCalendarEntry,
  type GoogleCalendarEvent,
  type NewCalendarEventInput,
  type SuggestedMilestone,
} from '../lib/googleCalendarService';
import { pfMoney } from '../lib/profitForecastEngine';
import type { PfForecastResult, PfLookaheadResult, PfState } from '../types/profitForecast';

interface FinancialCalendarViewProps {
  user: User | null;
  hasAccessToken: boolean;
  isLoggingIn: boolean;
  onGoogleLogin: () => void;
  pfState: PfState;
  pfForecast: PfForecastResult | null;
  pfLookahead: PfLookaheadResult | null;
  onNotice: (type: 'success' | 'error', text: string) => void;
}

type PendingAction =
  | { kind: 'create'; event: NewCalendarEventInput }
  | { kind: 'update'; eventId: string; event: NewCalendarEventInput }
  | { kind: 'delete'; event: GoogleCalendarEvent }
  | { kind: 'bulkCreate'; milestones: SuggestedMilestone[] };

function formatEventWhen(ev: GoogleCalendarEvent): string {
  if (ev.start.date) {
    return `${ev.start.date} · All day`;
  }
  if (ev.start.dateTime) {
    const startDt = new Date(ev.start.dateTime);
    const endDt = ev.end.dateTime ? new Date(ev.end.dateTime) : null;
    const dateStr = startDt.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const startTime = startDt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const endTime = endDt
      ? endDt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : '';
    return `${dateStr} · ${startTime}${endTime ? ` – ${endTime}` : ''}`;
  }
  return 'Scheduled';
}

export const FinancialCalendarView: React.FC<FinancialCalendarViewProps> = ({
  user,
  hasAccessToken,
  isLoggingIn,
  onGoogleLogin,
  pfState,
  pfForecast,
  pfLookahead,
  onNotice,
}) => {
  const [calendars, setCalendars] = useState<GoogleCalendarEntry[]>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>('primary');
  const [rangeDays, setRangeDays] = useState<number>(90);
  const [events, setEvents] = useState<GoogleCalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  // Milestones selection
  const milestones = useMemo(
    () => buildFinancialMilestones(pfState, pfForecast, pfLookahead),
    [pfState, pfForecast, pfLookahead]
  );
  const [selectedMilestoneIds, setSelectedMilestoneIds] = useState<Record<string, boolean>>({});
  const [catFilter, setCatFilter] = useState<string>('all');

  // Create / Edit event modal
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [formSummary, setFormSummary] = useState('');
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formStartTime, setFormStartTime] = useState('');
  const [formEndTime, setFormEndTime] = useState('');
  const [formLocation, setFormLocation] = useState('');
  const [formDesc, setFormDesc] = useState('');

  // Mandatory explicit confirmation state before any write/delete
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [isMutating, setIsMutating] = useState(false);

  const selectedCalendar = useMemo(
    () => calendars.find((c) => c.id === selectedCalendarId) || null,
    [calendars, selectedCalendarId]
  );

  const loadCalendarData = useCallback(async () => {
    const token = getAccessToken();
    if (!token) return;
    setIsLoading(true);
    setLoadError('');
    try {
      const cals = await listUserCalendars(token);
      setCalendars(cals);
      const effectiveId =
        selectedCalendarId === 'primary' || cals.some((c) => c.id === selectedCalendarId)
          ? selectedCalendarId
          : cals[0]?.id || 'primary';
      if (effectiveId !== selectedCalendarId) setSelectedCalendarId(effectiveId);

      const now = new Date();
      const start = new Date(now.getTime() - 7 * 86400000);
      const end = new Date(now.getTime() + rangeDays * 86400000);
      const evs = await listCalendarEvents(
        token,
        effectiveId,
        start.toISOString(),
        end.toISOString()
      );
      setEvents(evs);
    } catch (err) {
      setLoadError(
        err instanceof Error
          ? err.message
          : 'Could not read Google Calendar. Try signing in again to refresh calendar permissions.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [rangeDays, selectedCalendarId]);

  useEffect(() => {
    if (user && hasAccessToken) {
      void loadCalendarData();
    } else {
      setCalendars([]);
      setEvents([]);
    }
  }, [user, hasAccessToken, loadCalendarData]);

  const filteredMilestones = useMemo(
    () =>
      catFilter === 'all' ? milestones : milestones.filter((m) => m.category === catFilter),
    [milestones, catFilter]
  );

  const selectedMilestones = useMemo(
    () => milestones.filter((m) => selectedMilestoneIds[m.id]),
    [milestones, selectedMilestoneIds]
  );

  const openNewEventModal = () => {
    setEditingEventId(null);
    setFormSummary('');
    setFormDate(new Date().toISOString().slice(0, 10));
    setFormStartTime('');
    setFormEndTime('');
    setFormLocation('');
    setFormDesc('');
    setComposerOpen(true);
  };

  const openEditEventModal = (ev: GoogleCalendarEvent) => {
    setEditingEventId(ev.id);
    setFormSummary(ev.summary || '');
    if (ev.start.date) {
      setFormDate(ev.start.date);
      setFormStartTime('');
      setFormEndTime('');
    } else if (ev.start.dateTime) {
      const sd = new Date(ev.start.dateTime);
      setFormDate(sd.toISOString().slice(0, 10));
      setFormStartTime(sd.toTimeString().slice(0, 5));
      if (ev.end.dateTime) {
        const ed = new Date(ev.end.dateTime);
        setFormEndTime(ed.toTimeString().slice(0, 5));
      } else {
        setFormEndTime('');
      }
    }
    setFormLocation(ev.location || '');
    setFormDesc(ev.description || '');
    setComposerOpen(true);
  };

  const handleComposerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formSummary.trim() || !formDate) return;
    const payload: NewCalendarEventInput = {
      summary: formSummary.trim(),
      date: formDate,
      startTime: formStartTime || undefined,
      endTime: formEndTime || formStartTime || undefined,
      location: formLocation.trim() || undefined,
      description: formDesc.trim() || undefined,
    };
    setComposerOpen(false);
    if (editingEventId) {
      setPendingAction({ kind: 'update', eventId: editingEventId, event: payload });
    } else {
      setPendingAction({ kind: 'create', event: payload });
    }
  };

  const handleConfirmMutation = async () => {
    if (!pendingAction) return;
    const token = getAccessToken();
    if (!token) {
      onNotice('error', 'Please sign in with Google to update your calendar.');
      setPendingAction(null);
      return;
    }

    setIsMutating(true);
    try {
      if (pendingAction.kind === 'create') {
        await createCalendarEvent(token, selectedCalendarId, pendingAction.event);
        onNotice('success', `Scheduled "${pendingAction.event.summary}" to Google Calendar.`);
      } else if (pendingAction.kind === 'update') {
        await updateCalendarEvent(
          token,
          selectedCalendarId,
          pendingAction.eventId,
          pendingAction.event
        );
        onNotice('success', `Updated "${pendingAction.event.summary}" in Google Calendar.`);
      } else if (pendingAction.kind === 'delete') {
        await deleteCalendarEvent(token, selectedCalendarId, pendingAction.event.id);
        onNotice('success', `Deleted "${pendingAction.event.summary}" from Google Calendar.`);
      } else if (pendingAction.kind === 'bulkCreate') {
        for (const m of pendingAction.milestones) {
          await createCalendarEvent(token, selectedCalendarId, {
            summary: m.title,
            date: m.date,
            description: m.description,
          });
        }
        setSelectedMilestoneIds({});
        onNotice(
          'success',
          `Scheduled ${pendingAction.milestones.length} JRT financial milestone(s) to Google Calendar.`
        );
      }
      setPendingAction(null);
      await loadCalendarData();
    } catch (err) {
      onNotice(
        'error',
        err instanceof Error ? err.message : 'Google Calendar operation failed.'
      );
      setPendingAction(null);
    } finally {
      setIsMutating(false);
    }
  };

  const targetCalLabel = selectedCalendar?.summary || 'Primary Calendar';

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-wider text-[#B55C2C] uppercase">
            Schedule &amp; Cash Deadlines
          </p>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl text-balance">
            Financial Calendar &amp; Milestone Sync
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-slate-600">
            View upcoming events on your Google Calendar and publish JRT Mechanical billing cutoffs,
            LOC renewals, quarterly tax outflows, retention releases, and target job finish dates.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {user && hasAccessToken ? (
            <>
              <button
                type="button"
                onClick={() => void loadCalendarData()}
                disabled={isLoading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh Calendar
              </button>
              <button
                type="button"
                onClick={openNewEventModal}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F293A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#173b52] whitespace-nowrap shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                New Calendar Event
              </button>
            </>
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
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-[#0F293A]">
            <CalendarIcon className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-base font-semibold text-slate-900">
            Connect Google Calendar to View &amp; Schedule Milestones
          </h2>
          <p className="mx-auto mt-1.5 max-w-lg text-xs text-slate-500">
            Sign in with Google above to browse your calendars and schedule JRT Mechanical LOC
            renewals, monthly progress billing cutoffs, retention releases, and project finish dates.
          </p>
          <div className="mt-5 flex justify-center">
            <GoogleSignInButton
              onClick={onGoogleLogin}
              disabled={isLoggingIn}
              label={isLoggingIn ? 'Connecting…' : 'Sign in with Google'}
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          {/* Left: Google Calendar Upcoming Events */}
          <section className="xl:col-span-6 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Google Calendar Events</h2>
                <p className="text-xs text-slate-500">
                  Signed in as {user.email}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Target calendar"
                  value={selectedCalendarId}
                  onChange={(e) => setSelectedCalendarId(e.target.value)}
                  className="max-w-[200px] rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
                >
                  {calendars.length === 0 && <option value="primary">Primary Calendar</option>}
                  {calendars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.summary}
                      {c.primary ? ' (Primary)' : ''}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Date horizon"
                  value={rangeDays}
                  onChange={(e) => setRangeDays(Number(e.target.value))}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
                >
                  <option value={30}>Next 30 days</option>
                  <option value={90}>Next 90 days</option>
                  <option value={180}>Next 6 months</option>
                </select>
              </div>
            </div>

            {loadError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
                {loadError}
              </div>
            )}

            {isLoading ? (
              <div className="py-10 text-center text-xs text-slate-500">
                Loading calendar events…
              </div>
            ) : events.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 py-10 text-center text-xs text-slate-500">
                No events found on <strong>{targetCalLabel}</strong> for the selected window.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-[560px] overflow-y-auto">
                {events.map((ev) => (
                  <div
                    key={ev.id}
                    className="flex items-start justify-between gap-3 py-3 text-xs"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="font-semibold text-slate-900 truncate">
                        {ev.summary || '(No title)'}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                        {formatEventWhen(ev)}
                        {ev.location ? ` · ${ev.location}` : ''}
                      </div>
                      {ev.description && (
                        <p className="text-[11px] text-slate-600 line-clamp-2">{ev.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {ev.htmlLink && (
                        <a
                          href={ev.htmlLink}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          title="Open in Google Calendar"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => openEditEventModal(ev)}
                        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        title="Edit event"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingAction({ kind: 'delete', event: ev })}
                        className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-700"
                        title="Delete event"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Right: JRT Financial Milestones Ready to Push */}
          <section className="xl:col-span-6 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  JRT Financial Milestones ({milestones.length})
                </h2>
                <p className="text-xs text-slate-500">
                  Generated from your 28-week Cash Lookahead, Bank &amp; Bonding, and Profit Forecast
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  aria-label="Filter milestones"
                  value={catFilter}
                  onChange={(e) => setCatFilter(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
                >
                  <option value="all">All categories</option>
                  <option value="Cash & LOC">Cash &amp; LOC</option>
                  <option value="Bank & Bonding">Bank &amp; Bonding</option>
                  <option value="Billing & Tax">Billing &amp; Tax</option>
                  <option value="Job Finish">Job Finish</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const next: Record<string, boolean> = { ...selectedMilestoneIds };
                    filteredMilestones.forEach((m) => {
                      next[m.id] = true;
                    });
                    setSelectedMilestoneIds(next);
                  }}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Select visible ({filteredMilestones.length})
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedMilestoneIds({})}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600 hover:bg-slate-50"
                >
                  Clear
                </button>
              </div>

              <button
                type="button"
                disabled={selectedMilestones.length === 0}
                onClick={() =>
                  setPendingAction({ kind: 'bulkCreate', milestones: selectedMilestones })
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F293A] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#173b52] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <CalendarIcon className="h-3.5 w-3.5" />
                Schedule Selected ({selectedMilestones.length})
              </button>
            </div>

            {filteredMilestones.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 py-10 text-center text-xs text-slate-500">
                No financial milestones match this filter.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
                {filteredMilestones.map((m) => {
                  const checked = Boolean(selectedMilestoneIds[m.id]);
                  return (
                    <div
                      key={m.id}
                      onClick={() =>
                        setSelectedMilestoneIds((prev) => ({
                          ...prev,
                          [m.id]: !prev[m.id],
                        }))
                      }
                      className={`flex cursor-pointer items-start justify-between gap-3 py-2.5 px-2 rounded-md transition-colors text-xs ${
                        checked ? 'bg-slate-50' : 'hover:bg-slate-50/60'
                      }`}
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <span className="mt-0.5 text-[#0F293A] shrink-0">
                          {checked ? (
                            <CheckSquare className="h-4 w-4" />
                          ) : (
                            <Square className="h-4 w-4 text-slate-400" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900">{m.title}</div>
                          <div className="mt-0.5 text-[11px] text-slate-500">{m.description}</div>
                        </div>
                      </div>
                      <div className="text-right shrink-0 space-y-0.5">
                        <div className="font-mono font-medium text-slate-800 tabular-nums">
                          {m.date}
                        </div>
                        <div className="text-[11px] text-slate-500">{m.category}</div>
                        {m.amount !== undefined && (
                          <div className="font-mono text-[11px] text-slate-700 tabular-nums">
                            {pfMoney(m.amount)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Create / Edit Event Modal */}
      {composerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleComposerSubmit}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-900">
                {editingEventId ? 'Edit Calendar Event' : 'New Google Calendar Event'}
              </h3>
              <button
                type="button"
                onClick={() => setComposerOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3.5 px-5 py-4 text-xs">
              <label className="block">
                <span className="font-medium text-slate-700">Event Title</span>
                <input
                  type="text"
                  required
                  value={formSummary}
                  onChange={(e) => setFormSummary(e.target.value)}
                  placeholder="e.g., Bank LOC Renewal Review"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-[#0F293A] focus:outline-none"
                />
              </label>

              <div className="grid grid-cols-3 gap-2.5">
                <label className="block col-span-1">
                  <span className="font-medium text-slate-700">Date</span>
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-slate-900"
                  />
                </label>
                <label className="block col-span-1">
                  <span className="font-medium text-slate-700">Start (opt)</span>
                  <input
                    type="time"
                    value={formStartTime}
                    onChange={(e) => setFormStartTime(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-slate-900"
                  />
                </label>
                <label className="block col-span-1">
                  <span className="font-medium text-slate-700">End (opt)</span>
                  <input
                    type="time"
                    value={formEndTime}
                    onChange={(e) => setFormEndTime(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-slate-900"
                  />
                </label>
              </div>

              <label className="block">
                <span className="font-medium text-slate-700">Location (optional)</span>
                <input
                  type="text"
                  value={formLocation}
                  onChange={(e) => setFormLocation(e.target.value)}
                  placeholder="Office or video link"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                />
              </label>

              <label className="block">
                <span className="font-medium text-slate-700">Notes</span>
                <textarea
                  rows={3}
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2.5 border-t border-slate-200 px-5 py-3.5">
              <button
                type="button"
                onClick={() => setComposerOpen(false)}
                className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-[#0F293A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#173b52]"
              >
                Review &amp; Confirm
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Mandatory Explicit Confirmation Modal for Any Calendar Mutation */}
      {pendingAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
                <h3 className="text-base font-semibold text-slate-900">
                  {pendingAction.kind === 'delete'
                    ? 'Delete Google Calendar Event?'
                    : pendingAction.kind === 'update'
                    ? 'Update Google Calendar Event?'
                    : pendingAction.kind === 'bulkCreate'
                    ? `Schedule ${pendingAction.milestones.length} Events to Google Calendar?`
                    : 'Create Google Calendar Event?'}
                </h3>
              </div>
              <button
                type="button"
                disabled={isMutating}
                onClick={() => setPendingAction(null)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 px-5 py-4 text-xs text-slate-700">
              <div>
                Target Calendar: <strong className="text-slate-900">{targetCalLabel}</strong>
              </div>

              {pendingAction.kind === 'delete' && (
                <div className="rounded-lg border border-red-200 bg-red-50/70 p-3 text-red-900">
                  This will permanently remove <strong>{pendingAction.event.summary}</strong> (
                  {formatEventWhen(pendingAction.event)}) from your Google Calendar.
                </div>
              )}

              {(pendingAction.kind === 'create' || pendingAction.kind === 'update') && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1">
                  <div className="font-semibold text-slate-900">{pendingAction.event.summary}</div>
                  <div className="font-mono text-slate-600">
                    {pendingAction.event.date}
                    {pendingAction.event.startTime
                      ? ` · ${pendingAction.event.startTime}–${pendingAction.event.endTime}`
                      : ' · All day'}
                  </div>
                </div>
              )}

              {pendingAction.kind === 'bulkCreate' && (
                <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {pendingAction.milestones.map((m) => (
                    <div key={m.id} className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className="font-medium text-slate-900 truncate">{m.title}</span>
                      <span className="font-mono text-slate-500 shrink-0">{m.date}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 border-t border-slate-200 px-5 py-3.5">
              <button
                type="button"
                disabled={isMutating}
                onClick={() => setPendingAction(null)}
                className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isMutating}
                onClick={() => void handleConfirmMutation()}
                className={`rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 ${
                  pendingAction.kind === 'delete'
                    ? 'bg-red-700 hover:bg-red-800'
                    : 'bg-[#0F293A] hover:bg-[#173b52]'
                }`}
              >
                {isMutating
                  ? 'Saving…'
                  : pendingAction.kind === 'delete'
                  ? 'Confirm Delete'
                  : 'Confirm & Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
