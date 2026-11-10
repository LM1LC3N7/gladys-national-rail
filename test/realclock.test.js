// -----------------------------------------------------------------------------
// The app on a REAL moving clock (performance.now, Date.now, setTimeout) and a
// real local HTTP server playing the Rail Data Marketplace: the reads of a
// board really start, at 0, the interval and twice the interval, with a bounded
// number of timers. Time sped up 100 times (60 s of interval are 600 ms).
// Everything is stopped in t.after, so a failure never leaves a timer alive.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { App } from '../src/app.js';
import { createMemoryStore } from '../src/store.js';
import { createdDevices, board } from './helpers/world.js';

const SPEED = 100;
const INTERVAL = 60_000;

test('real clock: reads at 0, the interval and twice the interval; timers bounded', async (t) => {
  const reads = [];
  const server = createServer((req, res) => {
    reads.push(performance.now() * SPEED);
    res.writeHead(200, { 'content-type': 'application/json', date: new Date().toUTCString() });
    res.end(JSON.stringify(board({ at: Date.now() })));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  let timersSet = 0;
  const timers = {
    setTimeout(fn, ms) {
      timersSet += 1;
      return setTimeout(fn, Math.max(0, ms) / SPEED);
    },
    clearTimeout: (id) => clearTimeout(id),
  };
  const config = { api_key: 'abcdefgh12345678', boards: 'PAD', read_interval: 60 };
  const gladys = createFakeGladys({
    selector: 'national-rail',
    config,
    devices: createdDevices(config),
  });
  const quiet = () => {};
  const app = new App({
    gladys,
    version: '0.1.0',
    // The requests of the app, sent to the local server instead.
    fetchImpl: (url, init) => {
      const local = new URL(url);
      return fetch(`http://127.0.0.1:${port}${local.pathname}${local.search}`, init);
    },
    now: () => Date.now() * SPEED,
    monotonic: () => performance.now() * SPEED,
    timers,
    store: createMemoryStore(),
    logger: { info: quiet, warn: quiet, error: quiet, debug: quiet },
    requestTimeout: 2000,
  });
  t.after(() => app.stop());
  // The decisions, not the requests: the latency of a cold fetch (tens of real
  // ms, times SPEED) would blur the gaps seen by the server.
  const decided = [];
  const readBoard = app.readBoard.bind(app);
  app.readBoard = (...args) => {
    decided.push(performance.now() * SPEED);
    return readBoard(...args);
  };
  await gladys.connect();
  const started = performance.now() * SPEED;
  await app.onConnected();
  const deadline = started + INTERVAL;
  while (reads.length === 0 && performance.now() * SPEED < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  const end = (reads[0] ?? started) + 2.5 * INTERVAL;
  while (performance.now() * SPEED < end) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await app.stop();
  const at = reads.map((r) => Math.round(r - started));
  assert.equal(reads.length, 3, `reads at ${at}`);
  assert.ok(reads[0] - started < INTERVAL / 2, `the first read at once: ${at}`);
  assert.equal(decided.length, 3, `decided at ${decided.map((r) => Math.round(r - started))}`);
  for (let i = 1; i < decided.length; i += 1) {
    const gap = decided[i] - decided[i - 1];
    assert.ok(gap >= 0.9 * INTERVAL, `never sooner than the interval: ${at}`);
    assert.ok(gap < 1.5 * INTERVAL, `on time: ${at}`);
  }
  assert.ok(timersSet <= 20, `${timersSet} timers`);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(typeof gladys.fake.lastState('ext:national-rail:board:PAD:departure_1'), 'number');
});
