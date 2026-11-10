// -----------------------------------------------------------------------------
// The app on the fake Gladys of the SDK, a scripted Rail Data Marketplace and
// a virtual clock that moves: the pace, the pauses, the refused key, /data,
// the generations, the publications and the statuses.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { App, tagOf } from '../src/app.js';
import { createMemoryStore } from '../src/store.js';
import { PAUSE_MAX } from '../src/constants.js';
import {
  CONFIG,
  D,
  F,
  HOUR,
  KEY,
  MINUTE,
  NOW,
  SECOND,
  board,
  createdDevices,
  fault,
  hhmm,
  json,
  service,
  setup,
  until,
} from './helpers/world.js';

const status = (env) => env.gladys.fake.connectionStatus;
const text = (env) => status(env)?.message?.en ?? '';
const said = (ack) => ack.data?.message?.en ?? ack.data?.en ?? String(ack.data ?? ack.error);

test('first read at once for each created board, then once per interval, never sooner', async (t) => {
  const env = await setup();
  t.after(() => env.app.stop());
  assert.equal(env.net.count('PAD'), 1);
  assert.equal(env.net.count('RDG'), 1);
  assert.equal(env.gladys.fake.lastState(F('PAD', 'departure_1')), 10);
  assert.match(text(env), /Connected: 2 board\(s\) read, last at 18:00/);
  await env.wait(2 * MINUTE - SECOND);
  assert.equal(env.net.count(), 2);
  await env.wait(2 * SECOND);
  assert.equal(env.net.count(), 4);
  await env.wait(10 * MINUTE);
  assert.equal(env.net.count('PAD'), 7);
});

test('only the boards whose device exists are read; the Discover tab lists them all', async (t) => {
  const env = await setup({ devices: [] });
  t.after(() => env.app.stop());
  assert.equal(env.net.count(), 0);
  assert.match(text(env), /Discover/);
  assert.deepEqual(
    env.gladys.fake.discoveredDevices.map((d) => [d.external_id, d.name]),
    [
      [D('PAD'), 'National Rail – PAD'],
      [D('RDG-PAD'), 'To work'],
    ],
  );
  await env.gladys.fake.deviceCreated(createdDevices()[0]);
  await env.wait(0);
  assert.equal(env.net.count('PAD'), 1);
  assert.equal(env.net.count('RDG'), 0);
  assert.equal(env.gladys.fake.lastState(F('PAD', 'departure_1')), 10);
});

test('a board without its device is never read, even when the others are', async (t) => {
  const env = await setup({ devices: [createdDevices()[1]] });
  t.after(() => env.app.stop());
  await env.wait(10 * MINUTE);
  assert.equal(env.net.count('PAD'), 0);
  assert.ok(env.net.count('RDG') >= 5);
});

test('a device created after a read gets the countdown of now, from that read', async (t) => {
  const env = await setup({ devices: [] });
  t.after(() => env.app.stop());
  const ack = await env.gladys.fake.action('test_connection');
  assert.match(said(ack), /It works/);
  assert.equal(env.net.count('PAD'), 1);
  await env.wait(MINUTE);
  await env.gladys.fake.deviceCreated(createdDevices()[0]);
  await env.wait(0);
  assert.equal(env.net.count('PAD'), 1, 'no new read: the last one is fresh');
  assert.equal(env.gladys.fake.lastState(F('PAD', 'departure_1')), 9);
});

test('nothing reads faster than the interval: save, reconnection, Discover, device created, test button', async (t) => {
  const env = await setup();
  t.after(() => env.app.stop());
  assert.equal(env.net.count(), 2);
  await env.gladys.fake.configUpdated({ ...CONFIG });
  await env.gladys.fake.scanRequest();
  await env.app.onConnected();
  await env.gladys.fake.deviceCreated(createdDevices()[1]);
  const ack = await env.gladys.fake.action('test_connection');
  await env.wait(30 * SECOND);
  assert.equal(env.net.count(), 2);
  assert.match(said(ack) ?? ack.data, /It works: London Paddington/);
});

test('a restart reads no sooner than the interval: the attempt is in /data before the request', async (t) => {
  const store = createMemoryStore();
  const first = await setup({ store });
  let savedBefore = null;
  first.net.world = () => {
    savedBefore ??= store.data?.boards?.PAD?.at;
  };
  await first.wait(2 * MINUTE + SECOND);
  assert.ok(
    Math.abs(savedBefore - (first.clock.now - SECOND - MINUTE * 0)) < 2 * SECOND,
    String(savedBefore - NOW),
  );
  await first.app.stop();
  // The container restarts 30 s after the last reads.
  const env = await setup({ store, now: first.clock.now + 30 * SECOND });
  t.after(() => env.app.stop());
  assert.equal(env.net.count(), 0);
  await env.wait(90 * SECOND - 2 * SECOND);
  assert.equal(env.net.count(), 0);
  await env.wait(3 * SECOND);
  assert.equal(env.net.count(), 2);
});

test('a date in the future in /data is ignored', async (t) => {
  const store = createMemoryStore({ boards: { PAD: { at: NOW + 3 * HOUR, failures: 0 } } });
  const env = await setup({ store });
  t.after(() => env.app.stop());
  assert.equal(env.net.count('PAD'), 1);
});

test('a refused key: no automatic retry, kept across a restart, lifted by a new key', async (t) => {
  const store = createMemoryStore();
  const env = await setup({ store });
  env.net.world = () => fault(401);
  await env.wait(2 * MINUTE + SECOND);
  const after = env.net.count();
  assert.match(text(env), /refused the key \(HTTP 401\)/);
  assert.equal(status(env).connected, false);
  await env.wait(3 * HOUR);
  assert.equal(env.net.count(), after);
  assert.ok(store.data.refused);
  assert.ok(!JSON.stringify(store.data).includes(KEY));
  await env.app.stop();

  const again = await setup({ store, now: env.clock.now });
  t.after(() => again.app.stop());
  await again.wait(HOUR);
  assert.equal(again.net.count(), 0, 'refused after the restart too');
  again.net.world = () => undefined;
  await again.gladys.fake.configUpdated({ ...CONFIG, api_key: 'AnotherKey987654321' });
  await again.wait(0);
  assert.equal(again.net.count(), 2);
  assert.equal(again.net.calls[0].init.headers['x-apikey'], 'AnotherKey987654321');
  assert.match(text(again), /Connected/);
  assert.equal(store.data.refused, null);
});

test('a refused key: the same key saved again is not retried; the test button tries and lifts it', async (t) => {
  const env = await setup();
  t.after(() => env.app.stop());
  env.net.world = () => fault(403, 'keymanagement.service.app_not_approved');
  await env.wait(2 * MINUTE + SECOND);
  const after = env.net.count();
  await env.gladys.fake.configUpdated({ ...CONFIG });
  await env.wait(HOUR);
  assert.equal(env.net.count(), after);
  const refused = await env.gladys.fake.action('test_connection');
  assert.match(said(refused), /refused the key \(HTTP 403\)/);
  assert.equal(env.net.count(), after + 1);
  // Clicks within 30 s: the same answer, no request.
  await env.gladys.fake.action('test_connection');
  assert.equal(env.net.count(), after + 1);
  env.net.world = () => undefined;
  await env.wait(31 * SECOND);
  const ok = await env.gladys.fake.action('test_connection');
  assert.match(said(ok), /It works/);
  await env.wait(0);
  assert.match(text(env), /Connected/);
  assert.ok(env.net.count('RDG') > 1, 'the other boards read again');
});

test('a refusal kept in /data under another key does not stop a new key (tag differs)', async (t) => {
  const salt = '0'.repeat(32);
  let other = 'OldKey00000000001';
  for (let i = 2; tagOf(salt, other) === tagOf(salt, KEY); i += 1) other = `OldKey0000000000${i}`;
  const store = createMemoryStore({ refused: { salt, tag: tagOf(salt, other), status: 401 } });
  const env = await setup({ store });
  t.after(() => env.app.stop());
  assert.equal(env.net.count(), 2);
});

test('a 401/403 without the fault of the gateway is not a refusal', async (t) => {
  const env = await setup();
  t.after(() => env.app.stop());
  env.net.world = () => new Response('<html>Forbidden</html>', { status: 403 });
  await env.wait(2 * MINUTE + SECOND);
  assert.doesNotMatch(text(env), /refused/);
  env.net.world = () => undefined;
  await until(env, () => env.net.count('PAD') >= 3);
  assert.match(text(env), /Connected/);
});

test('429: every board paused (Retry-After, bounded), kept in /data across a restart', async (t) => {
  const store = createMemoryStore();
  const env = await setup({ store });
  env.net.world = () => json({}, 429, { 'retry-after': '600' });
  await env.wait(2 * MINUTE + SECOND);
  const after = env.net.count();
  assert.equal(after, 3, 'the second board waits for the pause');
  assert.match(text(env), /paused until 18:12/);
  assert.ok(Math.abs(store.data.pause.until - (NOW + 12 * MINUTE)) < 10);
  await env.wait(9 * MINUTE);
  assert.equal(env.net.count(), after);
  const ack = await env.gladys.fake.action('test_connection');
  assert.match(said(ack), /paused until/);
  assert.equal(env.net.count(), after);
  await env.app.stop();

  const again = await setup({ store, now: env.clock.now });
  t.after(() => again.app.stop());
  assert.equal(again.net.count(), 0);
  await again.wait(2 * MINUTE);
  assert.equal(again.net.count(), 2);
  assert.equal(store.data.pause, null);
});

test('429: without Retry-After, 1 min doubling; never longer than 6 h, never shorter than 1 min', async (t) => {
  const env = await setup();
  t.after(() => env.app.stop());
  env.net.world = () => json({}, 429);
  await env.wait(2 * MINUTE + SECOND);
  assert.ok(Math.abs(env.app.pause.until - env.net.calls.at(-1).at - MINUTE) < 10);
  await until(env, () => env.app.pause?.count === 2);
  assert.ok(Math.abs(env.app.pause.until - env.net.calls.at(-1).at - 2 * MINUTE) < 10);
  env.net.world = () => json({}, 429, { 'retry-after': '999999' });
  await until(env, () => env.app.pause?.count === 3);
  assert.ok(env.app.pause.until - env.app.now() <= PAUSE_MAX);
  env.app.pause = null;
  env.app.schedule();
  env.net.world = () => json({}, 429, { 'retry-after': '0' });
  await until(env, () => env.app.pause !== null);
  assert.ok(env.app.pause.until - env.net.calls.at(-1).at >= MINUTE - 10);
});

test('a board failing (5xx, unknown station) is read later and later; the others go on', async (t) => {
  const env = await setup();
  t.after(() => env.app.stop());
  env.net.world = ({ crs }) => (crs === 'RDG' ? json({}, 503) : undefined);
  await env.wait(HOUR);
  // PAD every 2 min; RDG at 2, 4, 8, 16, 32 min… after the first good read.
  assert.ok(env.net.count('PAD') >= 30, `PAD ${env.net.count('PAD')}`);
  assert.ok(env.net.count('RDG') <= 7, `RDG ${env.net.count('RDG')}`);
  assert.match(text(env), /Reading: the service answered with an error/);
  assert.equal(status(env).connected, true);
  env.net.world = ({ crs }) => (crs === 'RDG' ? json({}, 400) : undefined);
  await env.wait(2 * HOUR);
  assert.match(text(env), /station code not found/);
});

test('every board failing: not "Connected"', async (t) => {
  const env = await setup({ connect: false });
  t.after(() => env.app.stop());
  env.net.world = () => json({}, 500);
  await env.gladys.connect();
  await env.wait(0);
  assert.equal(status(env).connected, false);
  assert.match(text(env), /No board could be read/);
});

test('a request that hangs is cut; the next board is not starved', async (t) => {
  const env = await setup({ connect: false, requestTimeout: 30 });
  t.after(() => env.app.stop());
  env.net.world = ({ crs }) => (crs === 'PAD' ? 'hang' : undefined);
  await env.gladys.connect();
  await env.wait(0);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await env.wait(0);
  assert.equal(env.net.count('RDG'), 1);
  assert.match(text(env), /London Paddington|PAD: no answer in time/);
});

test('/data unreadable: never written over; reads go on in memory after 3 loads; read again on a timer', async (t) => {
  const store = createMemoryStore({ boards: {} });
  store.failLoad = 4;
  const env = await setup({ store });
  t.after(() => env.app.stop());
  assert.equal(env.net.count(), 0, 'not before /data is read or given up');
  await env.wait(20 * SECOND + 1);
  assert.equal(env.net.count(), 2);
  assert.match(text(env), /\/data cannot be read/);
  assert.equal(store.saves, 0);
  await env.wait(10 * SECOND);
  assert.equal(store.failLoad, 0);
  assert.match(text(env), /\/data cannot be read/);
  await env.wait(10 * SECOND);
  assert.doesNotMatch(text(env), /\/data cannot be read/);
  await env.wait(0);
  assert.ok(store.saves >= 1, 'written once read');
  assert.ok(store.data.boards.PAD);
});

test('/data that never answers: reads start after 30 s, a save never blocks a read for long', async (t) => {
  const store = createMemoryStore();
  store.load = () => new Promise(() => {});
  const env = await setup({ store });
  t.after(() => env.app.stop());
  assert.equal(env.net.count(), 0);
  await env.wait(30 * SECOND + 1);
  assert.equal(env.net.count(), 2);
  // /data read at last, then writes that hang: still read on time.
  const slow = createMemoryStore();
  slow.save = () => new Promise(() => {});
  const env2 = await setup({ store: slow });
  t.after(() => env2.app.stop());
  await env2.wait(5 * SECOND);
  assert.equal(env2.net.count(), 2);
});

test('/data broken: invalid values ignored, no prototype key taken', async (t) => {
  const store = createMemoryStore({
    pause: { until: 'soon', count: 1 },
    refused: { salt: 'x', tag: 999, status: 401 },
    boards: {
      __proto__: { at: NOW, failures: 0 },
      pad: { at: NOW },
      PAD: { at: NOW, failures: -1 },
    },
    fired: { 'PAD|zz': { at: NOW, delays: [5], cancelled: false } },
  });
  const env = await setup({ store });
  t.after(() => env.app.stop());
  assert.equal(env.net.count(), 2);
  assert.equal({}.at, undefined);
});

test('getConfig failing in "connected": retried later and later, status told, then recovered', async (t) => {
  const env = await setup({ connect: false });
  t.after(() => env.app.stop());
  const real = env.gladys.getConfig.bind(env.gladys);
  let failures = 2;
  let calls = 0;
  env.gladys.getConfig = async () => {
    calls += 1;
    // The first call is the SDK's own resynchronization in connect().
    if (calls > 1 && failures > 0) {
      failures -= 1;
      throw new Error('Gladys busy');
    }
    return real();
  };
  await env.gladys.connect();
  await env.wait(0);
  assert.match(text(env), /could not be read from Gladys/);
  assert.equal(env.net.count(), 0);
  await env.wait(5 * SECOND);
  assert.equal(failures, 0);
  assert.equal(env.net.count(), 0);
  await env.wait(10 * SECOND);
  assert.equal(env.net.count(), 2);
  assert.match(text(env), /Connected/);
});

test('a late board of the old key publishes nothing', async (t) => {
  const env = await setup({ connect: false });
  t.after(() => env.app.stop());
  const held = [];
  env.net.world = ({ init }) =>
    init.headers['x-apikey'] === KEY ? new Promise((resolve) => held.push(resolve)) : undefined;
  await env.gladys.connect();
  await env.wait(0);
  await env.gladys.fake.configUpdated({ ...CONFIG, api_key: 'NewKey1234567890' });
  for (const resolve of held) resolve(json(board({ services: [service({ dest: 'OLDKEY' })] })));
  await env.wait(2 * MINUTE + SECOND);
  assert.ok(!JSON.stringify(env.gladys.fake.states).includes('OLDKEY'));
  assert.match(
    env.gladys.fake.lastState(F('PAD', 'departure_1_info')),
    /Reading · platform 4 · on time/,
  );
});

test('a late answer of the old key publishes nothing and sets no status', async (t) => {
  const env = await setup({ connect: false });
  t.after(() => env.app.stop());
  let release;
  env.net.world = ({ init }) =>
    init.headers['x-apikey'] === KEY ? new Promise((resolve) => (release = resolve)) : undefined;
  await env.gladys.connect();
  await env.wait(0);
  const before = env.gladys.fake.states.length;
  await env.gladys.fake.configUpdated({ ...CONFIG, api_key: 'NewKey1234567890' });
  release?.(fault(401));
  await env.wait(0);
  assert.equal(env.app.refused, null);
  assert.doesNotMatch(text(env), /refused/);
  assert.ok(env.gladys.fake.states.length >= before);
  assert.ok(env.net.calls.some((c) => c.init.headers['x-apikey'] === 'NewKey1234567890'));
});

test('no read while Gladys is disconnected; unchanged states not sent again; reconnection publishes from a read', async (t) => {
  const env = await setup();
  t.after(() => env.app.stop());
  env.net.world = ({ at }) => board({ at, services: [service({ at: NOW, inMin: 30 })] });
  await env.wait(2 * MINUTE + SECOND);
  const published = env.gladys.fake.states.length;
  await env.wait(2 * MINUTE);
  // Same board two minutes later: only the countdowns moved.
  const moved = env.gladys.fake.states.slice(published).map((s) => s.device_feature_external_id);
  assert.ok(
    moved.every((id) => /departure_\d$/.test(id)),
    moved.join(),
  );
  env.app.setLinked(false);
  const count = env.net.count();
  await env.wait(HOUR);
  assert.equal(env.net.count(), count);
});

test('scene events: each threshold once per train, cancelled once, kept across a restart, bounded', async (t) => {
  const store = createMemoryStore();
  const late =
    (minutes) =>
    ({ at }) =>
      board({
        at,
        services: [
          service({ inMin: 5, etd: `18:${String(5 + minutes).padStart(2, '0')}`, id: 'late-1' }),
          service({
            inMin: 20,
            etd: 'Cancelled',
            id: 'gone-1',
            cancelReason: 'a signalling fault',
          }),
        ],
      });
  const env = await setup({ store, connect: false });
  env.net.world = late(12);
  await env.gladys.connect();
  await env.wait(0);
  const events = env.gladys.fake.sceneEvents;
  const pad = events.filter((e) => e.data.board === D('PAD'));
  assert.deepEqual(
    pad.map((e) => [e.key, e.data.threshold ?? null]),
    [
      ['train_delayed', '5'],
      ['train_delayed', '10'],
      ['train_cancelled', null],
    ],
  );
  assert.equal(pad[2].data.reason, 'a signalling fault');
  assert.equal(pad[0].data.delay, 12);
  assert.equal(pad[0].data.expected, '18:17');
  for (const e of events) {
    assert.ok(
      Object.values(e.data).every(
        (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v),
      ),
    );
  }
  env.net.world = late(16);
  await env.wait(2 * MINUTE + SECOND);
  const pad2 = env.gladys.fake.sceneEvents.filter((e) => e.data.board === D('PAD'));
  assert.deepEqual(
    pad2.slice(3).map((e) => e.data.threshold),
    ['15'],
  );
  await env.app.stop();
  const again = await setup({ store, now: env.clock.now + 3 * MINUTE, connect: false });
  t.after(() => again.app.stop());
  again.net.world = late(16);
  await again.gladys.connect();
  await again.wait(0);
  assert.equal(again.gladys.fake.sceneEvents.length, 0, 'nothing fired again after a restart');
});

test('scene events: at most 60 a minute, the rest sent later', async (t) => {
  const many = () =>
    board({
      services: Array.from({ length: 10 }, (_, i) =>
        service({ inMin: i + 1, etd: hhmm(NOW + (i + 41) * MINUTE), id: `late${i}` }),
      ),
    });
  const config = { api_key: KEY, boards: 'AAA, BBB, CCC, DDD, EEE, FFF', read_interval: 60 };
  const env = await setup({ config, connect: false });
  t.after(() => env.app.stop());
  env.net.world = () => many();
  await env.gladys.connect();
  await env.wait(0);
  // 6 boards x 10 trains x 4 thresholds = 240 events due: 60 a minute.
  assert.equal(env.gladys.fake.sceneEvents.length, 60);
  await env.wait(61 * SECOND);
  assert.equal(env.gladys.fake.sceneEvents.length, 120);
  await env.wait(3 * MINUTE);
  assert.equal(env.gladys.fake.sceneEvents.length, 240);
  const keys = env.gladys.fake.sceneEvents.map(
    (e) => `${e.data.board}|${e.data.scheduled}|${e.data.threshold}`,
  );
  assert.equal(new Set(keys).size, 240, 'each one once');
});

test('states: at most 300 a minute, whatever the configuration', async (t) => {
  const config = {
    api_key: KEY,
    boards: 'AAA, BBB, CCC, DDD, EEE, FFF',
    read_interval: 60,
    max_departures: 5,
  };
  const env = await setup({ config });
  t.after(() => env.app.stop());
  const start = env.gladys.fake.states.length;
  env.net.world = ({ at }) =>
    board({
      at,
      services: [service({ at: NOW, inMin: 100, etd: `${19 + (Math.floor(at / MINUTE) % 4)}:40` })],
    });
  await env.wait(MINUTE + SECOND);
  assert.ok(env.gladys.fake.states.length - start <= 300);
});

test('scene action: the next trains, fresh; read again only when due; unknown values null', async (t) => {
  const env = await setup();
  t.after(() => env.app.stop());
  const ack = await env.gladys.fake.sceneAction('get_next_departures', { board: D('PAD') });
  assert.equal(ack.success, true);
  assert.equal(env.net.count('PAD'), 1);
  assert.equal(ack.data.minutes ?? ack.data.outputs?.minutes, 10);
  env.net.world = () => board({ services: [] });
  await env.wait(2 * MINUTE + SECOND);
  const empty = await env.gladys.fake.sceneAction('get_next_departures', { board: D('PAD') });
  const out = empty.data.outputs ?? empty.data;
  assert.equal(out.count, 0);
  assert.equal(out.minutes, null);
  assert.equal(out.delay, null);
  assert.equal(out.summary, 'No train in the next two hours');
  const unknown = await env.gladys.fake.sceneAction('get_next_departures', { board: D('XXX') });
  assert.equal(unknown.success, false);
});

test('the key never appears in the logs, /data, the statuses nor the states', async (t) => {
  const store = createMemoryStore();
  const env = await setup({ store });
  t.after(() => env.app.stop());
  env.net.world = ({ crs }) => (crs === 'PAD' ? fault(401) : json({}, 503));
  await env.wait(3 * MINUTE);
  await env.gladys.fake.action('test_connection');
  const everything = JSON.stringify([
    env.lines,
    store.data,
    env.gladys.fake.connectionStatuses,
    env.gladys.fake.states,
    env.gladys.fake.sceneEvents,
  ]);
  assert.ok(!everything.includes(KEY));
  assert.ok(!everything.includes(KEY.slice(0, 12)));
});

test('statuses: no key, invalid key, no board, an entry not understood, a bad API address', async (t) => {
  const env = await setup({ config: {} });
  t.after(() => env.app.stop());
  assert.match(text(env), /Paste your Rail Data Marketplace consumer key/);
  await env.gladys.fake.configUpdated({ api_key: 'bad key with spaces' });
  assert.match(text(env), /characters a Rail Data Marketplace key never has/);
  await env.gladys.fake.configUpdated({ api_key: KEY });
  assert.match(text(env), /Type at least one station code/);
  await env.gladys.fake.configUpdated({
    api_key: KEY,
    boards: 'PAD, NOPE',
    api_url: 'https://evil.example/x',
  });
  assert.match(text(env), /Entry 2 of “Boards” is not understood/);
  assert.match(text(env), /not a Rail Data Marketplace address/);
  assert.doesNotMatch(text(env), /NOPE|evil/);
  const ack = await env.gladys.fake.action('test_connection');
  assert.match(said(ack), /It works/);
  assert.equal(env.net.calls.at(-1).url.host, 'api1.raildata.org.uk');
});

test('one status per state: an unchanged status is not sent again', async (t) => {
  const env = await setup();
  t.after(() => env.app.stop());
  const sent = env.gladys.fake.connectionStatuses.length;
  await env.wait(2 * MINUTE + SECOND);
  // Same minute shown? A new time is a new status; but never twice the same.
  const statuses = env.gladys.fake.connectionStatuses.slice(sent).map((s) => JSON.stringify(s));
  for (let i = 1; i < statuses.length; i += 1) assert.notEqual(statuses[i], statuses[i - 1]);
});

test('stop: no timer left, no request after it', async () => {
  const env = await setup();
  await env.app.stop();
  const count = env.net.count();
  assert.equal(env.pending.size, 0, `${env.pending.size} timers left`);
  await env.wait(HOUR);
  assert.equal(env.net.count(), count);
  assert.ok(env.app instanceof App);
});

// --- Review r1 ---------------------------------------------------------------

test('r1 I2: Darwin without services for the station: unknown, never "no train"', async (t) => {
  const env = await setup();
  t.after(() => env.app.stop());
  assert.equal(env.gladys.fake.lastState(F('PAD', 'departure_1')), 10);
  env.net.world = ({ at }) => ({
    ...board({ at, services: [], messages: ['<p>Train information is unavailable.</p>'] }),
    areServicesAvailable: false,
    trainServices: null,
  });
  await env.wait(2 * MINUTE + SECOND);
  assert.notEqual(env.gladys.fake.lastState(F('PAD', 'departure_1')), 999);
  assert.notEqual(env.gladys.fake.lastState(F('PAD', 'summary')), 'No train in the next two hours');
  assert.match(
    text(env),
    /Darwin gives no train information for this station now — “Train information is unavailable\.”/,
  );
});

test('r1 I3: the countdown counts from when the board was served (Date), an old copy refused', async (t) => {
  const env = await setup({ connect: false });
  t.after(() => env.app.stop());
  // Served now, generated 3 min before: the train of now + 20 min is in 20 min.
  env.net.world = ({ at }) =>
    json({ ...board({ at: at - 3 * MINUTE, services: [service({ at, inMin: 20 })] }) }, 200, {
      date: new Date(at).toUTCString(),
    });
  await env.gladys.connect();
  await env.wait(0);
  assert.equal(env.gladys.fake.lastState(F('PAD', 'departure_1')), 20);
  // Generated 10 min before it was served: not used.
  env.net.world = ({ at }) =>
    json({ ...board({ at: at - 10 * MINUTE, services: [service({ at, inMin: 5 })] }) }, 200, {
      date: new Date(at).toUTCString(),
    });
  await env.wait(2 * MINUTE + SECOND);
  assert.notEqual(env.gladys.fake.lastState(F('PAD', 'departure_1')), 5);
  assert.match(text(env), /answer not understood/);
});

test('r1 I4: one request at a time, whoever asks (loop, button, scene, six boards)', async (t) => {
  const config = { api_key: KEY, boards: 'AAA, BBB, CCC, DDD, EEE, FFF', read_interval: 60 };
  const env = await setup({ config, connect: false });
  t.after(() => env.app.stop());
  let open = 0;
  let peak = 0;
  env.net.world = async ({ at, crs }) => {
    open += 1;
    peak = Math.max(peak, open);
    await new Promise((resolve) => setTimeout(resolve, 5));
    open -= 1;
    return board({ at, crs });
  };
  await env.gladys.connect();
  const jobs = [
    env.gladys.fake.action('test_connection'),
    env.gladys.fake.sceneAction('get_next_departures', { board: D('BBB') }),
    env.gladys.fake.sceneAction('get_next_departures', { board: D('CCC') }),
  ];
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3));
    await env.wait(0);
  }
  await Promise.all(jobs);
  await env.wait(61 * SECOND);
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3));
    await env.wait(0);
  }
  assert.ok(env.net.count() >= 12, `${env.net.count()} requests`);
  assert.equal(peak, 1);
});

test('r1 I4: the scene action never answers from a reading older than 15 min', async (t) => {
  const env = await setup();
  t.after(() => env.app.stop());
  env.net.world = () => json({}, 503);
  await env.wait(20 * MINUTE);
  const ack = await env.gladys.fake.sceneAction('get_next_departures', { board: D('PAD') });
  assert.equal(ack.success, false);
  assert.match(ack.error, /No fresh departures/);
});

test('r1 I4: a key changed while the attempt is being saved: that read never leaves', async (t) => {
  const store = createMemoryStore();
  const env = await setup({ store, connect: false });
  t.after(() => env.app.stop());
  const realSave = store.save;
  let release;
  let held = 0;
  store.save = (data) => {
    held += 1;
    if (held === 1) return new Promise((resolve) => (release = () => resolve(realSave(data))));
    return realSave(data);
  };
  await env.gladys.connect();
  await env.wait(0);
  assert.equal(typeof release, 'function', 'the first save is held');
  assert.equal(env.net.count(), 0);
  await env.gladys.fake.configUpdated({ ...CONFIG, api_key: 'NewKey1234567890' });
  release();
  await env.wait(0);
  // The overtaken read never left; the board is read once, at once, with the new key.
  assert.equal(env.net.count('PAD'), 1);
  assert.ok(env.net.calls.every((c) => c.init.headers['x-apikey'] === 'NewKey1234567890'));
  assert.equal(env.net.count('RDG'), 1);
});

test('r1 M1: the test button never reads again within the interval after a failure', async (t) => {
  const env = await setup();
  t.after(() => env.app.stop());
  env.net.world = () => json({}, 503);
  await env.wait(2 * MINUTE + SECOND);
  const count = env.net.count('PAD');
  await env.wait(31 * SECOND);
  const ack = await env.gladys.fake.action('test_connection');
  assert.match(
    said(ack),
    /Read less than an interval ago, and it failed: the service answered with an error \(HTTP 503\)/,
  );
  assert.equal(env.net.count('PAD'), count);
});

test('r1 M3: a new key reads at once the boards that failed with the old one', async (t) => {
  const env = await setup();
  t.after(() => env.app.stop());
  env.net.world = () => new Response('denied', { status: 401 });
  await env.wait(20 * MINUTE);
  const count = env.net.count();
  env.net.world = () => undefined;
  await env.gladys.fake.configUpdated({ ...CONFIG, api_key: 'NewKey1234567890' });
  await env.wait(0);
  assert.equal(env.net.count(), count + 2);
  assert.match(text(env), /Connected: 2 board/);
});

test('r1 M4: after 15 min without a good read, the texts say there is no recent data', async (t) => {
  const env = await setup();
  t.after(() => env.app.stop());
  env.net.world = () => json({}, 500);
  await env.wait(10 * MINUTE);
  assert.match(env.gladys.fake.lastState(F('PAD', 'summary')), /Reading/);
  await env.wait(30 * MINUTE);
  assert.equal(
    env.gladys.fake.lastState(F('PAD', 'summary')),
    'No recent data (see the status of the integration)',
  );
  assert.equal(
    env.gladys.fake.lastState(F('PAD', 'departure_1_info')),
    'No recent data (see the status of the integration)',
  );
});

test('r1 M6: messages there but unreadable: said so, never "no message"', async (t) => {
  const env = await setup({ connect: false });
  t.after(() => env.app.stop());
  env.net.world = ({ at }) => ({ ...board({ at }), nrccMessages: [{ xhtmlMessage: '<p>x</p>' }] });
  await env.gladys.connect();
  await env.wait(0);
  assert.equal(
    env.gladys.fake.lastState(F('PAD', 'messages')),
    'A disruption message is there, but its text could not be read',
  );
  assert.ok(env.lines.some((l) => /disruption messages present/.test(l)));
});

test('r1 M7: /data not writable: told in the status', async (t) => {
  const store = createMemoryStore();
  store.failSave = true;
  const env = await setup({ store });
  t.after(() => env.app.stop());
  assert.match(text(env), /\/data cannot be written/);
  store.failSave = false;
  await env.wait(2 * MINUTE + SECOND);
  assert.doesNotMatch(text(env), /\/data cannot be written/);
});
