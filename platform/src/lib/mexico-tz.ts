import { startOfWeek as _startOfWeek } from 'date-fns';

const MEXICO_TZ = 'America/Mexico_City';

/**
 * Returns a Date whose local-time methods (getHours, getDay, etc.)
 * reflect Mexico City wall-clock time. Used with date-fns functions
 * that operate on local time. Convert back with toUtc() before SQL use.
 */
function mexicoLocal(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: MEXICO_TZ }));
}

/** Offset in ms: realUtc - mexicoLocal. Add to a mexicoLocal Date to get real UTC. */
function utcOffset(): number {
  return Date.now() - mexicoLocal().getTime();
}

/** Start of current week (Monday 00:00) in Mexico City, as real UTC Date. */
export function startOfWeekMexico(): Date {
  const monday = _startOfWeek(mexicoLocal(), { weekStartsOn: 1 });
  return new Date(monday.getTime() + utcOffset());
}

/** Start of today (00:00) in Mexico City, as real UTC Date. */
export function startOfTodayMexico(): Date {
  const today = mexicoLocal();
  today.setHours(0, 0, 0, 0);
  return new Date(today.getTime() + utcOffset());
}

/** Start of tomorrow (00:00) in Mexico City, as real UTC Date. */
export function startOfTomorrowMexico(): Date {
  const tomorrow = mexicoLocal();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return new Date(tomorrow.getTime() + utcOffset());
}

/** Start of yesterday (00:00) in Mexico City, as real UTC Date. */
export function startOfYesterdayMexico(): Date {
  const yesterday = mexicoLocal();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  return new Date(yesterday.getTime() + utcOffset());
}

/** Current hour (0-23) in Mexico City. */
export function currentMexicoHour(): number {
  return mexicoLocal().getHours();
}

/** Current day of week in Mexico City (0 = Sunday, 6 = Saturday). */
export function currentMexicoDayOfWeek(): number {
  return mexicoLocal().getDay();
}
