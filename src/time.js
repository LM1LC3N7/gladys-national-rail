// -----------------------------------------------------------------------------
// Darwin gives its times as "HH:MM", in the time of Great Britain
// (Europe/London, GMT in winter, BST in summer), without a date. A time is
// placed on the day that puts it nearest to the instant of the board (within
// twelve hours): 23:58 read at 00:03 is yesterday, 00:10 read at 23:55 is
// tomorrow. The instant of a local time comes from the zone rules of the
// runtime (Intl), changes of time included.
// -----------------------------------------------------------------------------

import { HOUR, MINUTE, TIME_ZONE } from './constants.js';

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** The wall clock of London at an instant: `{ y, m, d, h, min, s }`. */
export function londonParts(instant) {
  const out = {};
  for (const { type, value } of parts.formatToParts(new Date(instant))) {
    out[type] = Number(value);
  }
  return { y: out.year, m: out.month, d: out.day, h: out.hour, min: out.minute, s: out.second };
}

/** The offset of London from UTC at an instant, in milliseconds (0 or 1 h). */
export function londonOffset(instant) {
  const p = londonParts(instant);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant of a London wall-clock time on a London date. In the hour that
 * does not exist (spring), the time is read with the offset before the
 * change; in the hour that comes twice (autumn), the first one.
 */
export function londonInstant(y, m, d, h, min) {
  const asUtc = Date.UTC(y, m - 1, d, h, min);
  const before = asUtc - londonOffset(asUtc - 3 * HOUR);
  const after = asUtc - londonOffset(asUtc + 3 * HOUR);
  // The earlier reading whose wall clock is the one asked for, else the
  // reading with the offset that was in force before.
  for (const candidate of [before, after].sort((a, b) => a - b)) {
    const p = londonParts(candidate);
    if (p.h === h && p.min === min && p.d === d) {
      return candidate;
    }
  }
  return before;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * The instant of a Darwin "HH:MM" nearest to `reference` (an instant, ms),
 * or null when the text is not a time.
 */
export function instantOf(text, reference) {
  const match = typeof text === 'string' ? HHMM.exec(text.trim()) : null;
  if (!match || !Number.isFinite(reference)) {
    return null;
  }
  const h = Number(match[1]);
  const min = Number(match[2]);
  const day = londonParts(reference);
  const today = londonInstant(day.y, day.m, day.d, h, min);
  const gap = today - reference;
  if (gap < -12 * HOUR) {
    const next = londonParts(reference + 24 * HOUR);
    return londonInstant(next.y, next.m, next.d, h, min);
  }
  if (gap > 12 * HOUR) {
    const previous = londonParts(reference - 24 * HOUR);
    return londonInstant(previous.y, previous.m, previous.d, h, min);
  }
  return today;
}

/** Whole minutes from `from` to `to`, rounded down, never below 0. */
export function minutesUntil(to, from) {
  return Math.max(0, Math.floor((to - from) / MINUTE));
}

/** "HH:MM" of an instant, in London. */
export function londonTime(instant) {
  const p = londonParts(instant);
  return `${String(p.h).padStart(2, '0')}:${String(p.min).padStart(2, '0')}`;
}
