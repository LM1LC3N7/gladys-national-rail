// -----------------------------------------------------------------------------
// The configuration typed by the user, checked and normalized. Nothing here is
// ever logged as is: the key is a secret, and an entry that is not understood
// is told by its position, never shown back.
//
// Boards: "PAD, RDG>PAD:To work" — a station code (CRS, three letters, on
// every National Rail station page), optionally `>` and the code of a station
// the trains must call at, optionally `:` and the name of the device.
// -----------------------------------------------------------------------------

import {
  API_HOST,
  DEFAULT_API_URL,
  MAX_BOARDS,
  MAX_DEPARTURES,
  READ_INTERVAL,
} from './constants.js';

export const DEFAULT_CONFIG = Object.freeze({
  read_interval: READ_INTERVAL.default,
  max_departures: MAX_DEPARTURES.default,
  language: 'en',
  api_url: DEFAULT_API_URL,
});

const CRS = /^[A-Z]{3}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
/** An RDM consumer key: letters, digits and a few signs, nothing that could break a header. */
const KEY = /^[A-Za-z0-9._~+/=-]{8,128}$/;
const MAX_NAME = 40;

/** An integer of the range, else the default (a decimal, a text or an empty value is not one). */
export function integerIn(value, { min, max, default: fallback }) {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\s*\d+\s*$/.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isInteger(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

/**
 * The boards of the configuration: `{ boards, invalid }`, `invalid` the
 * 1-based positions of the entries not understood (never their text).
 * @param {unknown} text
 */
export function parseBoards(text) {
  const boards = [];
  const invalid = [];
  let tooMany = false;
  if (typeof text !== 'string') {
    return { boards, invalid, tooMany };
  }
  const entries = text
    .split(/[,;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const [index, entry] of entries.entries()) {
    const colon = entry.indexOf(':');
    const codes = (colon === -1 ? entry : entry.slice(0, colon)).replace(/\s+/g, '').toUpperCase();
    const rawName = colon === -1 ? '' : entry.slice(colon + 1).trim();
    const [from, to, extra] = codes.split('>');
    if (
      !CRS.test(from ?? '') ||
      (to !== undefined && !CRS.test(to)) ||
      extra !== undefined ||
      to === from ||
      CONTROL.test(rawName) ||
      rawName.length > MAX_NAME
    ) {
      invalid.push(index + 1);
      continue;
    }
    const id = to ? `${from}-${to}` : from;
    if (boards.some((board) => board.id === id)) {
      continue;
    }
    if (boards.length >= MAX_BOARDS) {
      tooMany = true;
      continue;
    }
    boards.push({ id, from, to: to ?? null, name: rawName || null });
  }
  return { boards, invalid, tooMany };
}

/**
 * The API address: https, a Rail Data Marketplace host, no credentials, no
 * query; anything else falls back to the default (the key is never sent
 * elsewhere).
 */
export function apiUrlOf(value) {
  if (typeof value !== 'string' || value.trim() === '' || CONTROL.test(value)) {
    return { url: DEFAULT_API_URL, valid: value === undefined || value === null || value === '' };
  }
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== 'https:' ||
      !API_HOST.test(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.port && url.port !== '443')
    ) {
      return { url: DEFAULT_API_URL, valid: false };
    }
    return { url: `${url.origin}${url.pathname.replace(/\/+$/, '')}`, valid: true };
  } catch {
    return { url: DEFAULT_API_URL, valid: false };
  }
}

/**
 * The normalized configuration.
 * `keyState`: 'missing' | 'invalid' | 'ok'.
 */
export function normalizeConfig(raw = {}) {
  const config = raw && typeof raw === 'object' ? raw : {};
  const key = typeof config.api_key === 'string' ? config.api_key.trim() : '';
  const keyState = key === '' ? 'missing' : KEY.test(key) ? 'ok' : 'invalid';
  const { boards, invalid, tooMany } = parseBoards(config.boards);
  const api = apiUrlOf(config.api_url);
  return {
    apiKey: keyState === 'ok' ? key : '',
    keyState,
    boards,
    invalidBoards: invalid,
    tooManyBoards: tooMany,
    apiUrl: api.url,
    apiUrlValid: api.valid,
    readInterval: integerIn(config.read_interval, READ_INTERVAL),
    maxDepartures: integerIn(config.max_departures, MAX_DEPARTURES),
    language: config.language === 'fr' ? 'fr' : 'en',
  };
}
