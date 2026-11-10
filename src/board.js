// -----------------------------------------------------------------------------
// A Darwin departure board (the JSON of GetDepBoardWithDetails, the field
// names of the official LDBWS schema) turned into what the integration
// publishes. Read defensively: a list may come as an array or wrapped
// (`{ service: [...] }`), any field may be missing, every text is cleaned
// (no control character, no HTML, bounded). A board without its station
// (`locationName` or `crs`) is not a board.
//
// The expected time of a service:
//   - etd "On time"   -> the scheduled time, 0 min late;
//   - etd "HH:MM"     -> that time, late by the difference;
//   - etd "Delayed"   -> unknown (Darwin does not know when): no countdown;
//   - "Cancelled" or isCancelled -> cancelled: no countdown;
//   - anything else   -> unknown.
// A delay is never made up: unknown stays unknown (null).
// -----------------------------------------------------------------------------

import { MINUTE } from './constants.js';
import { instantOf } from './time.js';

export class BoardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BoardError';
    this.code = 'unreadable';
  }
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;
const MAX_SERVICES = 20;
const MAX_MESSAGES = 5;
/** A board served more than this after it was generated is not used. */
export const STALE_AFTER = 15 * MINUTE;

/** A clean single-line text of at most `max` characters, or '' (never another type). */
export function cleanText(value, max = 80) {
  if (typeof value !== 'string') {
    return '';
  }
  const text = value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** The text of an NRCC message: tags removed, the usual entities decoded, bounded. */
export function messageText(value) {
  const raw =
    typeof value === 'string'
      ? value
      : typeof value?.Value === 'string'
        ? value.Value
        : typeof value?.value === 'string'
          ? value.value
          : '';
  if (raw.length > 20_000) {
    return '';
  }
  const text = raw
    .replace(/<[^>]{0,2000}>/g, ' ')
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_, name) => ENTITIES[name]);
  return cleanText(text, 300);
}

/** A list that may come as an array, wrapped under `key`, or as a single object. */
function listOf(value, key) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === 'object') {
    const inner = value[key];
    if (Array.isArray(inner)) {
      return inner;
    }
    if (inner && typeof inner === 'object') {
      return [inner];
    }
  }
  return [];
}

/** "London Paddington" — or "Reading & Oxford" for a train that splits. */
function placesOf(value) {
  const names = listOf(value, 'location')
    .filter((location) => location && typeof location === 'object')
    .map((location) => {
      const name = cleanText(location.locationName, 40);
      const via = cleanText(location.via, 40);
      return name && via ? `${name} ${via}` : name;
    })
    .filter(Boolean);
  return cleanText(names.join(' & '), 80);
}

/**
 * One service of the board.
 * @param {object} raw
 * @param {number} reference the instant of the board (ms)
 */
export function parseService(raw, reference) {
  const std = cleanText(raw?.std, 5);
  const etd = cleanText(raw?.etd, 20);
  const scheduledAt = instantOf(std, reference);
  if (scheduledAt === null) {
    return null;
  }
  let status = 'unknown';
  let expectedAt = null;
  let delay = null;
  if (raw.isCancelled === true || /^cancel+ed$/i.test(etd)) {
    status = 'cancelled';
  } else if (/^on time$/i.test(etd)) {
    status = 'on_time';
    expectedAt = scheduledAt;
    delay = 0;
  } else if (/^delayed$/i.test(etd)) {
    status = 'delayed';
  } else {
    const at = instantOf(etd, reference);
    if (at !== null) {
      // The nearest day to the scheduled time, not to the board: a train due
      // 23:50 expected 00:20 is 30 min late, never 23 h 30 early.
      const expected = instantOf(etd, scheduledAt);
      expectedAt = expected;
      delay = Math.max(0, Math.round((expected - scheduledAt) / MINUTE));
      status = delay > 0 ? 'late' : 'on_time';
    }
  }
  const id = cleanText(raw.serviceID, 64);
  return {
    id: id || `${std}|${placesOf(raw.destination)}`,
    std,
    etd,
    scheduledAt,
    expectedAt,
    delay,
    status,
    platform: cleanText(raw.platform, 6),
    destination: placesOf(raw.destination) || '?',
    operator: cleanText(raw.operator, 40),
    reason: cleanText(status === 'cancelled' ? raw.cancelReason : raw.delayReason, 160),
  };
}

/**
 * The board: `{ generatedAt, station, filter, services, messages }`, the
 * services in the order of the board (by scheduled time).
 * @param {object} json
 * @param {{ date?: string | null, now: number }} context the Date header, the wall clock
 */
export function parseBoard(json, { date = null, now }) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new BoardError('not a board');
  }
  const station = cleanText(json.locationName, 60);
  const crs = cleanText(json.crs, 3);
  if (!station && !crs) {
    throw new BoardError('a board without its station');
  }
  const generated = Date.parse(typeof json.generatedAt === 'string' ? json.generatedAt : '');
  const dated = Date.parse(date ?? '');
  // A board generated long before it was served is an old copy: no countdown
  // is computed from it.
  if (Number.isFinite(generated) && Number.isFinite(dated) && dated - generated > STALE_AFTER) {
    throw new BoardError('an old board');
  }
  const reference = Number.isFinite(generated) ? generated : Number.isFinite(dated) ? dated : now;
  const services = listOf(json.trainServices, 'service')
    .slice(0, MAX_SERVICES)
    .filter((raw) => raw && typeof raw === 'object')
    .map((raw) => parseService(raw, reference))
    .filter(Boolean);
  const messages = listOf(json.nrccMessages, 'message')
    .slice(0, MAX_MESSAGES)
    .map(messageText)
    .filter(Boolean);
  return {
    generatedAt: reference,
    station: station || crs,
    filter: cleanText(json.filterLocationName, 60) || null,
    services,
    messages,
  };
}
