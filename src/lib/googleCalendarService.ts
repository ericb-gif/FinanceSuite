import { laIn, monthEnd, wcIn } from './lookaheadEngine';
import { mLabel, pfMoney } from './profitForecastEngine';
import type { PfForecastResult, PfLookaheadResult, PfState } from '../types/profitForecast';

export interface GoogleCalendarEntry {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
  backgroundColor?: string;
  timeZone?: string;
}

export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  status?: string;
  start: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  end: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
}

export interface NewCalendarEventInput {
  summary: string;
  description?: string;
  location?: string;
  date: string; // YYYY-MM-DD (all-day milestone) or ISO start
  endDate?: string; // YYYY-MM-DD (exclusive for all-day, defaults to date + 1 day)
  startTime?: string; // HH:MM optional timed event
  endTime?: string; // HH:MM optional timed event
}

export interface SuggestedMilestone {
  id: string;
  category: 'Cash & LOC' | 'Bank & Bonding' | 'Job Finish' | 'Billing & Tax';
  title: string;
  date: string; // YYYY-MM-DD
  description: string;
  amount?: number;
}

async function calendarFetch<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (res.status === 204) return {} as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `Google Calendar API request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export async function listUserCalendars(token: string): Promise<GoogleCalendarEntry[]> {
  const data = await calendarFetch<{ items?: GoogleCalendarEntry[] }>(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader',
    token
  );
  const items = data.items || [];
  return items.sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));
}

export async function listCalendarEvents(
  token: string,
  calendarId: string,
  timeMinIso: string,
  timeMaxIso: string
): Promise<GoogleCalendarEvent[]> {
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '100',
    timeMin: timeMinIso,
    timeMax: timeMaxIso,
  });
  const data = await calendarFetch<{ items?: GoogleCalendarEvent[] }>(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId
    )}/events?${params.toString()}`,
    token
  );
  return data.items || [];
}

function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + days));
  return dt.toISOString().slice(0, 10);
}

function buildEventPayload(input: NewCalendarEventInput) {
  if (input.startTime && input.endTime) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
    return {
      summary: input.summary,
      description: input.description || '',
      location: input.location || '',
      start: {
        dateTime: `${input.date}T${input.startTime}:00`,
        timeZone: tz,
      },
      end: {
        dateTime: `${input.date}T${input.endTime}:00`,
        timeZone: tz,
      },
    };
  }
  return {
    summary: input.summary,
    description: input.description || '',
    location: input.location || '',
    start: { date: input.date },
    end: { date: input.endDate || addDaysIso(input.date, 1) },
  };
}

export async function createCalendarEvent(
  token: string,
  calendarId: string,
  input: NewCalendarEventInput
): Promise<GoogleCalendarEvent> {
  return calendarFetch<GoogleCalendarEvent>(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    token,
    {
      method: 'POST',
      body: JSON.stringify(buildEventPayload(input)),
    }
  );
}

export async function updateCalendarEvent(
  token: string,
  calendarId: string,
  eventId: string,
  input: NewCalendarEventInput
): Promise<GoogleCalendarEvent> {
  return calendarFetch<GoogleCalendarEvent>(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId
    )}/events/${encodeURIComponent(eventId)}`,
    token,
    {
      method: 'PATCH',
      body: JSON.stringify(buildEventPayload(input)),
    }
  );
}

export async function deleteCalendarEvent(
  token: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  await calendarFetch<Record<string, never>>(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId
    )}/events/${encodeURIComponent(eventId)}`,
    token,
    { method: 'DELETE' }
  );
}

export function buildFinancialMilestones(
  pfState: PfState,
  pfForecast: PfForecastResult | null,
  pfLookahead: PfLookaheadResult | null
): SuggestedMilestone[] {
  const milestones: SuggestedMilestone[] = [];
  const wc = wcIn(pfState);
  const la = laIn(pfState);

  if (wc.renew && /^\d{4}-\d{2}-\d{2}$/.test(wc.renew)) {
    milestones.push({
      id: `loc-renew-${wc.renew}`,
      category: 'Bank & Bonding',
      title: 'JRT Line of Credit Renewal',
      date: wc.renew,
      description: `Revolving LOC facility (${pfMoney(wc.limit)}) renewal target. Current balance: ${pfMoney(wc.locAsOf)}.`,
      amount: wc.limit,
    });
  }

  if (wc.capAmt > 0 && wc.capMonth && /^\d{4}-\d{2}$/.test(wc.capMonth)) {
    milestones.push({
      id: `cap-draw-${wc.capMonth}`,
      category: 'Bank & Bonding',
      title: 'Equipment / CapEx Loan Draw',
      date: `${wc.capMonth}-15`,
      description: `Planned capital equipment financing event (${pfMoney(wc.capAmt)}).`,
      amount: wc.capAmt,
    });
  }

  if (pfLookahead) {
    let peakIdx = 0;
    for (let i = 1; i < pfLookahead.line.length; i++) {
      if (pfLookahead.line[i] > pfLookahead.line[peakIdx]) peakIdx = i;
    }
    const peakWeek = pfLookahead.W[peakIdx];
    if (peakWeek && /^\d{4}-\d{2}-\d{2}$/.test(peakWeek)) {
      milestones.push({
        id: `loc-peak-${peakWeek}`,
        category: 'Cash & LOC',
        title: `Projected Peak LOC Balance (${pfMoney(pfLookahead.peak)})`,
        date: peakWeek,
        description: `28-week lookahead projected LOC peak vs. ${pfMoney(la.limit)} limit.`,
        amount: pfLookahead.peak,
      });
    }
  }

  if (la.q1 && /^\d{4}-\d{2}-\d{2}$/.test(la.q1) && la.quarterly > 0) {
    milestones.push({
      id: `qtax-1-${la.q1}`,
      category: 'Billing & Tax',
      title: `Quarterly Estimate / Tax Outflow (${pfMoney(la.quarterly)})`,
      date: la.q1,
      description: 'Scheduled quarterly tax / distribution outflow from 28-week cash drivers.',
      amount: la.quarterly,
    });
  }

  if (la.q2 && /^\d{4}-\d{2}-\d{2}$/.test(la.q2) && la.quarterly > 0) {
    milestones.push({
      id: `qtax-2-${la.q2}`,
      category: 'Billing & Tax',
      title: `Quarterly Estimate / Tax Outflow (${pfMoney(la.quarterly)})`,
      date: la.q2,
      description: 'Scheduled quarterly tax / distribution outflow from 28-week cash drivers.',
      amount: la.quarterly,
    });
  }

  if (la.matchDate && /^\d{4}-\d{2}-\d{2}$/.test(la.matchDate) && la.match > 0) {
    milestones.push({
      id: `match-${la.matchDate}`,
      category: 'Cash & LOC',
      title: `Annual 401(k) Match Funding (${pfMoney(la.match)})`,
      date: la.matchDate,
      description: 'Scheduled retirement plan match cash outflow.',
      amount: la.match,
    });
  }

  for (let i = 0; i < (la.retention || []).length; i++) {
    const r = la.retention[i];
    if (r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.amt > 0) {
      milestones.push({
        id: `ret-${i}-${r.date}`,
        category: 'Cash & LOC',
        title: `Retention Release: ${r.name}`,
        date: r.date,
        description: `Expected retention collection of ${pfMoney(r.amt)}.`,
        amount: r.amt,
      });
    }
  }

  for (let i = 0; i < (la.oneOff || []).length; i++) {
    const o = la.oneOff[i];
    if (o.date && /^\d{4}-\d{2}-\d{2}$/.test(o.date) && Math.abs(o.amt) > 0) {
      milestones.push({
        id: `oneoff-${i}-${o.date}`,
        category: 'Cash & LOC',
        title: `Scheduled Cash Item: ${o.name}`,
        date: o.date,
        description: `One-off cash event (${pfMoney(o.amt)}).`,
        amount: o.amt,
      });
    }
  }

  // Monthly WIP Billing Cutoffs & Job Finish Months
  if (pfForecast) {
    const billDay = pfState.settings.cash?.billDay || 20;
    for (const k of pfForecast.M.months.slice(0, 6)) {
      const [y, m] = k.split('-').map(Number);
      const dayStr = String(Math.min(billDay, 28)).padStart(2, '0');
      const dStr = `${y}-${String(m).padStart(2, '0')}-${dayStr}`;
      milestones.push({
        id: `bill-cutoff-${k}`,
        category: 'Billing & Tax',
        title: `JRT Progress Billing Cutoff (${mLabel(k)})`,
        date: dStr,
        description: `Monthly progress billing submission deadline for ${mLabel(k)}.`,
      });
    }

    for (const j of pfForecast.jobs) {
      if (j.finish && /^\d{4}-\d{2}$/.test(j.finish) && j.C >= 250000) {
        const endIso = monthEnd(j.finish);
        milestones.push({
          id: `finish-${j.key}-${j.finish}`,
          category: 'Job Finish',
          title: `Target Job Finish: ${j.job.job} ${j.job.name}`,
          date: endIso,
          description: `Contract ${pfMoney(j.C)} · Remaining cost ${pfMoney(j.remaining)} · Projected GP% ${
            j.gpNow !== null ? `${(j.gpNow * 100).toFixed(1)}%` : 'N/A'
          }.`,
          amount: j.C,
        });
      }
    }
  }

  return milestones.sort((a, b) => a.date.localeCompare(b.date));
}
