// -----------------------------------------------------------------------------
// One request to the Live Departure Board of the Rail Data Marketplace: the
// departures of one station, the key of the user in `x-apikey`, the
// User-Agent of the integration, JSON asked for explicitly. The answer is cut
// past MAX_BODY_BYTES and the whole exchange past REQUEST_TIMEOUT.
//
// What an answer means:
//   - 200 + a readable board              -> the board;
//   - 401/403 + the fault of the gateway  -> 'refused' (the key, or its
//     subscription to the product): no automatic retry;
//   - 401/403 unreadable, cut, not JSON   -> 'unreadable' (never a refusal);
//   - 429                                 -> 'rate_limited' (+ Retry-After);
//   - 400/404                             -> 'bad_request' (the station code);
//   - 5xx, network, timeout, too large    -> transient, read again later.
// No error message carries the key, the body, nor any text of the answer but
// the code of a gateway fault (checked: letters, digits, dots).
// -----------------------------------------------------------------------------

import {
  MAX_BODY_BYTES,
  NUM_ROWS,
  OPERATION,
  REQUEST_TIMEOUT,
  TIME_WINDOW_MINUTES,
} from './constants.js';

export const USER_AGENT_BASE = 'gladys-national-rail';
export const REPO_URL = 'https://github.com/LM1LC3N7/gladys-national-rail';

export class DarwinError extends Error {
  /**
   * @param {string} code
   * @param {{ status?: number, retryAfter?: number | null, fault?: string | null }} [details]
   */
  constructor(code, { status = null, retryAfter = null, fault = null } = {}) {
    super(status ? `${code} (HTTP ${status}${fault ? `, ${fault}` : ''})` : code);
    this.name = 'DarwinError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
    this.fault = fault;
  }
}

/** The URL of the board of `board` (never with the key). */
export function boardUrl(apiUrl, board) {
  const url = new URL(`${apiUrl}/${OPERATION}/${board.from}`);
  url.searchParams.set('numRows', String(NUM_ROWS));
  url.searchParams.set('timeWindow', String(TIME_WINDOW_MINUTES));
  url.searchParams.set('timeOffset', '0');
  if (board.to) {
    url.searchParams.set('filterCrs', board.to);
    url.searchParams.set('filterType', 'to');
  }
  return url.toString();
}

/**
 * Seconds to wait from a Retry-After header: a number of seconds, or a date
 * compared to the Date header of the same answer (never to the local clock:
 * the container may be set wrong). Null when unreadable.
 */
export function retryAfterSeconds(header, dateHeader) {
  if (typeof header !== 'string' || header.trim() === '') {
    return null;
  }
  const text = header.trim();
  if (/^\d{1,9}$/.test(text)) {
    return Number(text);
  }
  const at = Date.parse(text);
  const now = Date.parse(dateHeader ?? '');
  if (!Number.isFinite(at) || !Number.isFinite(now)) {
    return null;
  }
  return Math.max(0, Math.ceil((at - now) / 1000));
}

/** The body as text, cut (and refused) past `max` bytes, before reading it all. */
async function boundedText(response, max) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    await response.body?.cancel().catch(() => {});
    throw new DarwinError('too_large', { status: response.status });
  }
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new DarwinError('too_large', { status: response.status });
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The code of a fault of the API gateway (`{ fault: { detail: { errorcode } } }`), or null. */
export function faultCode(json) {
  const code = json?.fault?.detail?.errorcode;
  return typeof code === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(code) ? code : null;
}

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/**
 * Read the board of one station.
 * @param {{ apiUrl: string, apiKey: string, version: string, fetchImpl?: typeof fetch, signal?: AbortSignal, timeoutMs?: number }} options
 * @param {{ from: string, to: string | null }} board
 * @returns {Promise<{ json: object, date: string | null }>}
 */
export async function fetchBoard(
  { apiUrl, apiKey, version, fetchImpl = fetch, signal, timeoutMs = REQUEST_TIMEOUT },
  board,
) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try {
    response = await fetchImpl(boardUrl(apiUrl, board), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'user-agent': `${USER_AGENT_BASE}/${version} (+${REPO_URL})`,
        'x-apikey': apiKey,
      },
      redirect: 'error',
      signal: combined,
    });
  } catch (err) {
    throw new DarwinError(timeout.aborted || err?.name === 'TimeoutError' ? 'timeout' : 'network');
  }
  const { status } = response;
  let text;
  try {
    text = await boundedText(response, MAX_BODY_BYTES);
  } catch (err) {
    if (err instanceof DarwinError) {
      throw err;
    }
    throw new DarwinError(timeout.aborted ? 'timeout' : 'network', { status });
  }
  if (status === 401 || status === 403) {
    const fault = faultCode(parseJson(text));
    // Only a fault of the gateway says the key was looked at and refused.
    throw new DarwinError(fault ? 'refused' : 'unreadable', { status, fault });
  }
  if (status === 429) {
    throw new DarwinError('rate_limited', {
      status,
      retryAfter: retryAfterSeconds(
        response.headers.get('retry-after'),
        response.headers.get('date'),
      ),
    });
  }
  if (status === 400 || status === 404) {
    throw new DarwinError('bad_request', { status, fault: faultCode(parseJson(text)) });
  }
  if (status >= 500) {
    throw new DarwinError('server', { status });
  }
  if (status !== 200) {
    throw new DarwinError('unreadable', { status });
  }
  const json = parseJson(text);
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new DarwinError('unreadable', { status });
  }
  return { json, date: response.headers.get('date') };
}
