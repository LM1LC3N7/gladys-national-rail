// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys, a scripted Rail Data Marketplace and
// a virtual clock (the monotonic clock moves 1 µs per read, so that a
// decision reading it twice is caught).
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { App } from '../../src/app.js';
import { buildDevice } from '../../src/devices.js';
import { normalizeConfig } from '../../src/config.js';
import { registerHandlers } from '../../src/handlers.js';
import { createMemoryStore } from '../../src/store.js';
import { createFakeClock } from './fakeTimers.js';

export const SELECTOR = 'national-rail';
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
/** 2026-11-10 18:00:00 GMT (London is on GMT in November). */
export const NOW = Date.UTC(2026, 10, 10, 18, 0, 0);
export const KEY = 'TestKey0123456789abcdefABCDEF';
export const CONFIG = { api_key: KEY, boards: 'PAD, RDG>PAD:To work' };
export const F = (board, feature) => `ext:${SELECTOR}:board:${board}:${feature}`;
export const D = (board) => `ext:${SELECTOR}:board:${board}`;

const pad = (n) => String(n).padStart(2, '0');
/** "HH:MM" in London of an instant (GMT here, unless a test says otherwise). */
export const hhmm = (instant) => {
  const d = new Date(instant);
  const offset = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);
  return offset || `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

/** A service, `in` minutes after `at`, with its etd. */
export function service({
  at = NOW,
  inMin = 10,
  etd = 'On time',
  dest = 'Reading',
  id,
  platform = '4',
  ...rest
} = {}) {
  return {
    std: hhmm(at + inMin * MINUTE),
    etd,
    platform,
    operator: 'Great Western Railway',
    operatorCode: 'GW',
    serviceID: id ?? `svc-${inMin}-${dest}`,
    destination: [{ locationName: dest, crs: 'RDG' }],
    origin: [{ locationName: 'London Paddington', crs: 'PAD' }],
    ...rest,
  };
}

/** A board of the LDBWS JSON. */
export function board({ at = NOW, crs = 'PAD', services = [service({ at })], messages = [] } = {}) {
  return {
    generatedAt: new Date(at).toISOString().replace('Z', '+00:00'),
    locationName: crs === 'PAD' ? 'London Paddington' : crs === 'RDG' ? 'Reading' : crs,
    crs,
    platformAvailable: true,
    nrccMessages: messages.map((Value) => ({ Value })),
    trainServices: services,
  };
}

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', date: new Date(NOW).toUTCString(), ...headers },
  });

export const fault = (status = 401, errorcode = 'oauth.v2.InvalidApiKey') =>
  json({ fault: { faultstring: 'Invalid ApiKey', detail: { errorcode } } }, status);

/**
 * The Rail Data Marketplace: `world(request, clock)` -> a Response, a body
 * (JSON 200), 'hang' (never answers, until aborted) or undefined (a default
 * board for the station of the path).
 */
export function createNet(clock) {
  const net = {
    calls: [],
    world: () => undefined,
    async fetch(url, init = {}) {
      const parsed = new URL(url);
      const crs = parsed.pathname.split('/').pop();
      const call = { url: parsed, crs, init, at: clock.now };
      net.calls.push(call);
      const answer = await net.world(call, clock);
      if (answer === 'hang') {
        return new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        });
      }
      if (answer instanceof Response) return answer;
      if (answer instanceof Error) throw answer;
      return json(answer ?? board({ at: clock.now, crs }), 200, {
        date: new Date(clock.now).toUTCString(),
      });
    },
    count: (crs) => net.calls.filter((c) => !crs || c.crs === crs).length,
  };
  return net;
}

/** The devices of the configuration, as the user created them. */
export function createdDevices(config = CONFIG) {
  const gladys = createFakeGladys({ selector: SELECTOR });
  const normalized = normalizeConfig(config);
  return normalized.boards.map((b) => buildDevice(gladys, b, normalized));
}

export async function setup({
  config = CONFIG,
  devices = createdDevices(config),
  store = createMemoryStore(),
  now = NOW,
  wall = { offset: 0 },
  connect = true,
  requestTimeout = 50,
} = {}) {
  const gladys = createFakeGladys({ selector: SELECTOR, config, devices });
  const { clock, timers, advance, pending } = createFakeClock(now);
  let drift = 0;
  const net = createNet(clock);
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  const app = new App({
    gladys,
    version: '0.1.0',
    fetchImpl: (...args) => net.fetch(...args),
    now: () => clock.now + wall.offset,
    monotonic: () => clock.now + (drift += 0.001),
    timers,
    store,
    logger: { lines, info: log, warn: log, error: log, debug: log },
    requestTimeout,
  });
  registerHandlers(gladys, app);
  const flush = async () => {
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
  };
  const dueNow = () => [...pending.values()].some((timer) => timer.at <= clock.now);
  const wait = async (ms = 0) => {
    await flush();
    await advance(ms);
    await flush();
    // What a read started on the way schedules at once (the next board).
    for (let i = 0; i < 50 && dueNow(); i += 1) {
      await advance(0);
      await flush();
    }
  };
  if (connect) {
    await gladys.connect();
    await wait(0);
  }
  return { app, gladys, clock, net, store, wait, flush, advance, lines, pending, wall };
}

/** Wait (virtual time) until `predicate()` or fail after `max` ms. */
export async function until(env, predicate, { step = SECOND, max = 2 * HOUR } = {}) {
  for (let spent = 0; spent <= max; spent += step) {
    if (predicate()) return spent;
    await env.wait(step);
  }
  throw new Error('until: never true');
}
