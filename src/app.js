// -----------------------------------------------------------------------------
// The integration itself: the boards of the configuration read from the Live
// Departure Board of the Rail Data Marketplace, one after the other (one
// request in flight for the key), each at most once per interval, published
// on the devices the user created, the scene events fired once per service,
// the pauses, the failures and the refused key kept in /data. index.js only
// wires the SDK handlers to it. Read-only: nothing is ever sent but GET
// requests.
//
// The pace survives everything: a reconnection, a save of the form, the test
// button, the Discover tab, a device created, a restart of the container (the
// time of each attempt is written to /data before the request). A 429 pauses
// every read (Retry-After, else 1 min doubling, between 1 min and 6 h); a
// board failing otherwise (5xx, timeout, unknown station) is read again
// later and later (the interval doubling up to 1 h) without slowing the
// others. A key refused by the gateway stops every automatic read until the
// key changes or the test button reads with success.
//
// A read belongs to its configuration: when it changes, a late answer of the
// old one publishes nothing and sets no status (generation checked after
// every await).
//
// Two clocks: `now` (wall clock) only dates what /data keeps; `monotonic`
// paces the reads, the pauses and the freshness, so that a wall clock set back
// or forward never stops nor hurries them. One read of a clock per decision.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import {
  BACKOFF_MAX,
  CONFIG_RETRY_MAX,
  CONFIG_RETRY_MIN,
  DELAY_THRESHOLDS,
  MAX_EVENTS_PER_MINUTE,
  MAX_REMEMBERED_SERVICES,
  MINUTE,
  PAUSE_MAX,
  PAUSE_MIN,
  REMEMBER_SERVICE,
  REQUEST_TIMEOUT,
  SAVE_WAIT,
  STORE_LOADS_BEFORE_MEMORY,
  STORE_RETRY,
  TEST_BUDGET,
  TEST_SPACING,
} from './constants.js';
import { DarwinError, fetchBoard } from './darwin.js';
import { parseBoard, STALE_AFTER } from './board.js';
import {
  buildDevice,
  FEATURE,
  idsOf,
  serviceText,
  statesOf,
  summaryText,
  upcoming,
} from './devices.js';
import { boardError, SCENE_ERRORS, STATUS, TEST, WORDS } from './i18n.js';
import { createFileStore } from './store.js';
import { londonTime } from './time.js';

const defaultTimers = { setTimeout, clearTimeout };
const BOARD_ID = /^[A-Z]{3}(?:-[A-Z]{3})?$/;
const FIRED_KEY = /^[A-Z]{3}(?:-[A-Z]{3})?\|[0-9a-f]{16}$/;
const MAX_STATUS = 1000;
const SCENE_BUDGET = 20_000;

/** The end of a pause, rounded up to the minute: never told earlier than it is. */
const pauseEnd = (until) => londonTime(Math.ceil(until / 60_000) * 60_000);

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * The tag of a refused key: 8 bits of a salted hash, never more (the key
 * cannot be found back from /data). Two keys share it once in 256: the test
 * button then reads anyway, and a key changed while the integration runs is
 * compared in full (in memory only).
 */
export const tagOf = (salt, key) =>
  createHash('sha256').update(`${salt}\u0000${key}`, 'utf8').digest()[0];

/** The key of a service in the memory of the scene events (no text of the board in /data). */
const firedKey = (board, service) =>
  `${board.id}|${createHash('sha256').update(service.id, 'utf8').digest('hex').slice(0, 16)}`;

const join = (messages) => ({
  en: messages
    .map((m) => m.en)
    .join(' ')
    .slice(0, MAX_STATUS),
  fr: messages
    .map((m) => m.fr)
    .join(' ')
    .slice(0, MAX_STATUS),
});

export class App {
  /**
   * @param {{
   *   gladys: object, version: string, fetchImpl?: typeof fetch, now?: () => number,
   *   monotonic?: () => number, timers?: object, store?: object, logger?: object,
   *   random?: (size: number) => Buffer,
   * }} options
   */
  constructor({
    gladys,
    version,
    fetchImpl = (...args) => fetch(...args),
    now = Date.now,
    monotonic = () => performance.now(),
    timers = defaultTimers,
    store = createFileStore(),
    logger = createLogger({ name: 'national-rail' }),
    random = randomBytes,
    requestTimeout = REQUEST_TIMEOUT,
  }) {
    Object.assign(this, {
      gladys,
      version,
      fetchImpl,
      now,
      monotonic,
      timers,
      store,
      logger,
      random,
    });
    this.requestTimeout = requestTimeout;
    this.config = normalizeConfig({});
    this.generation = 0;
    this.running = false;
    this.linked = false;
    this.storeState = 'pending';
    this.loadFailures = 0;
    this.loading = false;
    this.storeTimer = null;
    this.memoryTimer = null;
    this.tickTimer = null;
    this.pause = null;
    this.refused = null;
    this.boards = new Map();
    this.kept = Object.create(null);
    this.fired = new Map();
    this.events = [];
    this.chain = Promise.resolve();
    this.inflight = null;
    this.reading = false;
    this.lastStatus = null;
    this.lastTest = null;
    this.connectSeq = 0;
    this.saveFailed = false;
    this.configTimer = null;
  }

  // --- Lifecycle -------------------------------------------------------------

  /** Start with a raw configuration; /data is read on its own timer. */
  start(rawConfig) {
    this.running = true;
    this.applyConfig(rawConfig);
    // /data that never answers: after a while, the reads go on in memory.
    this.memoryTimer = this.timers.setTimeout(() => {
      this.memoryTimer = null;
      if (this.storeState === 'pending') {
        this.logger.warn('/data did not answer: going on with the state in memory');
        this.storeState = 'memory';
        this.schedule();
        this.reportStatus();
      }
    }, STORE_RETRY * STORE_LOADS_BEFORE_MEMORY);
    this.loadStore();
  }

  async stop() {
    this.running = false;
    this.generation += 1;
    this.connectSeq += 1;
    for (const name of ['tickTimer', 'storeTimer', 'memoryTimer', 'configTimer']) {
      if (this[name] !== null) {
        this.timers.clearTimeout(this[name]);
        this[name] = null;
      }
    }
    this.inflight?.abort();
    // The read in flight ends within REQUEST_TIMEOUT (aborted now): waited
    // at most 2 s, on a real timer that never keeps the process alive.
    let timer;
    await Promise.race([
      this.chain,
      new Promise((resolve) => {
        timer = setTimeout(resolve, 2000);
        timer.unref?.();
      }),
    ]);
    clearTimeout(timer);
  }

  /** Gladys reachable or not: no read is spent while nothing can be published. */
  setLinked(linked) {
    this.linked = linked;
    if (linked) {
      this.gladys.forgetPublishedStates?.();
      this.lastStatus = null;
    }
    this.schedule();
  }

  /**
   * `connected`: read the configuration, retried later and later without
   * end, the status saying so; then apply it, publish the devices and the
   * status. A newer `connected` cancels an older loop.
   */
  async onConnected() {
    const seq = (this.connectSeq += 1);
    let wait = CONFIG_RETRY_MIN;
    for (;;) {
      try {
        const raw = await this.gladys.getConfig();
        if (seq !== this.connectSeq) {
          return;
        }
        if (!this.running) {
          this.start(raw);
        } else {
          this.applyConfig(raw);
        }
        this.setLinked(true);
        await this.publishDevices();
        await this.reportStatus(true);
        return;
      } catch (err) {
        if (seq !== this.connectSeq) {
          return;
        }
        this.logger.warn(`Reading the configuration failed: ${err?.message ?? err}`);
        await this.gladys.setConnectionStatus(false, STATUS.configRetry).catch(() => {});
        this.lastStatus = null;
        await new Promise((resolve) => {
          this.configTimer = this.timers.setTimeout(() => {
            this.configTimer = null;
            resolve();
          }, wait);
        });
        if (seq !== this.connectSeq) {
          return;
        }
        wait = Math.min(CONFIG_RETRY_MAX, wait * 2);
      }
    }
  }

  /** A new configuration (the form saved). */
  async onConfigUpdated(raw) {
    this.applyConfig(raw);
    await this.publishDevices();
    await this.reportStatus();
  }

  applyConfig(raw) {
    const previous = this.config;
    const next = normalizeConfig(raw);
    this.config = next;
    if (next.apiKey !== previous.apiKey) {
      this.generation += 1;
      this.inflight?.abort();
      // A new key is always tried: compared in full when it was refused in
      // this run, by its tag when the refusal comes from /data.
      if (this.refused && !this.refusalMatches(next.apiKey)) {
        this.logger.info('The key changed: the refusal is lifted');
        this.refused = null;
        this.saveSoon();
      }
      // A new key is tried at once on the boards that failed with the old one
      // (the read queue keeps one request at a time).
      for (const rt of this.boards.values()) {
        if (rt.failures > 0 || rt.lastError) {
          rt.failures = 0;
          rt.lastError = null;
          rt.lastDetail = null;
          rt.nextDue = -Infinity;
        }
      }
    } else if (next.apiUrl !== previous.apiUrl) {
      this.generation += 1;
      this.inflight?.abort();
    }
    const ids = new Set(next.boards.map((board) => board.id));
    for (const id of this.boards.keys()) {
      if (!ids.has(id)) {
        this.boards.delete(id);
      }
    }
    this.lastTest = null;
    this.schedule();
  }

  refusalMatches(key) {
    if (!this.refused || !key) {
      return false;
    }
    return this.refused.key !== undefined
      ? this.refused.key === key
      : tagOf(this.refused.salt, key) === this.refused.tag;
  }

  // --- /data -----------------------------------------------------------------

  async loadStore() {
    if (this.loading || !this.running) {
      return;
    }
    this.loading = true;
    try {
      const data = await this.store.load();
      if (!this.running) {
        return;
      }
      this.restore(data);
      const wasMemory = this.storeState === 'memory';
      this.storeState = 'ok';
      this.loadFailures = 0;
      if (wasMemory) {
        this.saveSoon();
      }
    } catch (err) {
      this.loadFailures += 1;
      this.logger.warn(`/data unreadable (${err?.message ?? err}): read again in 10 s`);
      if (this.storeState === 'pending' && this.loadFailures >= STORE_LOADS_BEFORE_MEMORY) {
        this.storeState = 'memory';
      }
      if (this.running) {
        this.storeTimer = this.timers.setTimeout(() => {
          this.storeTimer = null;
          return this.loadStore();
        }, STORE_RETRY);
      }
    } finally {
      this.loading = false;
    }
    if (this.storeState !== 'pending' && this.memoryTimer !== null) {
      this.timers.clearTimeout(this.memoryTimer);
      this.memoryTimer = null;
    }
    this.schedule();
    await this.reportStatus();
  }

  /** Take what /data keeps, the stricter of it and of memory, every value checked. */
  restore(data) {
    const now = this.now();
    const mono = this.monotonic();
    const pause = data?.pause;
    if (
      pause &&
      finite(pause.until) &&
      Number.isInteger(pause.count) &&
      pause.count >= 1 &&
      pause.count <= 32
    ) {
      const left = Math.min(Math.max(0, pause.until - now), PAUSE_MAX);
      if (left > 0 && (!this.pause || mono + left > this.pause.due)) {
        this.pause = { until: now + left, due: mono + left, count: pause.count };
      }
    }
    const refused = data?.refused;
    if (
      !this.refused &&
      refused &&
      typeof refused.salt === 'string' &&
      /^[0-9a-f]{32}$/.test(refused.salt) &&
      Number.isInteger(refused.tag) &&
      refused.tag >= 0 &&
      refused.tag < 256 &&
      (refused.status === 401 || refused.status === 403)
    ) {
      const candidate = { salt: refused.salt, tag: refused.tag, status: refused.status };
      if (!this.config.apiKey || tagOf(candidate.salt, this.config.apiKey) === candidate.tag) {
        this.refused = candidate;
      }
    }
    const boards = data?.boards;
    if (boards && typeof boards === 'object' && !Array.isArray(boards)) {
      for (const [id, entry] of Object.entries(boards)) {
        if (
          !BOARD_ID.test(id) ||
          !entry ||
          !finite(entry.at) ||
          entry.at > now + MINUTE ||
          !Number.isInteger(entry.failures) ||
          entry.failures < 0 ||
          entry.failures > 20
        ) {
          continue;
        }
        const current = this.kept[id];
        if (current && current.at >= entry.at) {
          continue;
        }
        this.kept[id] = { at: entry.at, failures: entry.failures };
        const rt = this.runtime(id);
        if (rt.attemptMono === null) {
          rt.failures = entry.failures;
          const wait = this.waitAfter(entry.failures);
          rt.nextDue = mono + Math.min(wait, Math.max(0, entry.at + wait - now));
        }
      }
    }
    const fired = data?.fired;
    if (fired && typeof fired === 'object' && !Array.isArray(fired)) {
      for (const [key, entry] of Object.entries(fired)) {
        if (
          !FIRED_KEY.test(key) ||
          !entry ||
          !finite(entry.at) ||
          entry.at > now + MINUTE ||
          now - entry.at > REMEMBER_SERVICE ||
          !Array.isArray(entry.delays) ||
          !entry.delays.every((d) => DELAY_THRESHOLDS.includes(d)) ||
          typeof entry.cancelled !== 'boolean' ||
          this.fired.has(key)
        ) {
          continue;
        }
        this.fired.set(key, {
          at: entry.at,
          delays: [...new Set(entry.delays)],
          cancelled: entry.cancelled,
        });
      }
      this.pruneFired(now);
    }
  }

  snapshot() {
    const boards = {};
    for (const [id, entry] of Object.entries(this.kept)) {
      boards[id] = entry;
    }
    const fired = {};
    for (const [key, entry] of this.fired) {
      fired[key] = entry;
    }
    return {
      version: 1,
      pause: this.pause ? { until: this.pause.until, count: this.pause.count } : null,
      refused: this.refused
        ? { salt: this.refused.salt, tag: this.refused.tag, status: this.refused.status }
        : null,
      boards,
      fired,
    };
  }

  /** Save, waited at most SAVE_WAIT; never over a /data that could not be read. */
  async save() {
    if (this.storeState !== 'ok') {
      return false;
    }
    let timer;
    try {
      const saved = await Promise.race([
        this.store.save(this.snapshot()).then(() => true),
        new Promise((resolve) => {
          timer = this.timers.setTimeout(() => resolve(false), SAVE_WAIT);
        }),
      ]);
      this.saveFailed = !saved;
      return saved;
    } catch (err) {
      this.logger.warn(`/data not written: ${err?.message ?? err}`);
      this.saveFailed = true;
      return false;
    } finally {
      this.timers.clearTimeout(timer);
    }
  }

  saveSoon() {
    this.save().catch(() => {});
  }

  // --- Pace ------------------------------------------------------------------

  interval() {
    return this.config.readInterval * 1000;
  }

  /** The wait after an attempt: the interval, doubled per failure up to BACKOFF_MAX. */
  waitAfter(failures) {
    const interval = this.interval();
    if (failures <= 0) {
      return interval;
    }
    return Math.max(interval, Math.min(BACKOFF_MAX, interval * 2 ** (failures - 1)));
  }

  runtime(id) {
    let rt = this.boards.get(id);
    if (!rt) {
      rt = {
        nextDue: -Infinity,
        failures: 0,
        lastError: null,
        lastStatus: null,
        lastDetail: null,
        staleShown: false,
        attemptMono: null,
        reading: null,
        readingMono: null,
      };
      this.boards.set(id, rt);
    }
    return rt;
  }

  isCreated(board) {
    const id = idsOf(this.gladys, board).device;
    return (this.gladys.devices ?? []).some((device) => device?.external_id === id);
  }

  pausedAt(mono) {
    return this.pause !== null && mono < this.pause.due;
  }

  /** The reasons no automatic read may start now, else null. */
  blockedAt(mono) {
    if (!this.running || !this.linked) return 'stopped';
    if (this.storeState === 'pending') return 'store';
    if (this.config.keyState !== 'ok') return 'key';
    if (this.refused) return 'refused';
    if (this.pausedAt(mono)) return 'paused';
    return null;
  }

  schedule() {
    if (this.tickTimer !== null) {
      this.timers.clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    if (!this.running || this.reading) {
      return;
    }
    const mono = this.monotonic();
    const blocked = this.blockedAt(mono);
    let due;
    if (blocked === 'paused') {
      due = this.pause.due;
    } else if (blocked) {
      return;
    } else {
      due = Infinity;
      for (const board of this.config.boards) {
        if (this.isCreated(board)) {
          due = Math.min(due, this.runtime(board.id).nextDue);
        }
      }
      if (due === Infinity) {
        return;
      }
    }
    this.tickTimer = this.timers.setTimeout(
      () => {
        this.tickTimer = null;
        return this.tick();
      },
      Math.max(0, due - mono),
    );
  }

  /** Read the board most overdue, then schedule the next one. */
  tick() {
    const mono = this.monotonic();
    if (this.blockedAt(mono) || this.reading) {
      this.schedule();
      return Promise.resolve();
    }
    let next = null;
    for (const board of this.config.boards) {
      const rt = this.runtime(board.id);
      if (this.isCreated(board) && rt.nextDue <= mono && (!next || rt.nextDue < next.rt.nextDue)) {
        next = { board, rt };
      }
    }
    if (!next) {
      this.schedule();
      return Promise.resolve();
    }
    return this.exclusive(() => this.readBoard(next.board));
  }

  /** One read at a time for the key, whoever asks (the loop, the button, a scene). */
  exclusive(fn) {
    const job = this.chain.then(async () => {
      this.reading = true;
      try {
        return await fn();
      } finally {
        this.reading = false;
        // Whoever read (the loop, the button, a scene), the next read is
        // scheduled from what this one changed.
        this.schedule();
      }
    });
    this.chain = job.catch(() => {});
    return job;
  }

  // --- One read --------------------------------------------------------------

  /**
   * Read one board now. `force`: the test button, which may read with a key
   * refused before (never during a pause).
   * @returns {Promise<{ ok: true, reading: object } | { ok: false, code: string, status?: number }>}
   */
  async readBoard(board, { force = false } = {}) {
    const generation = this.generation;
    const mono = this.monotonic();
    const blocked = this.blockedAt(mono);
    if (blocked && !(force && blocked === 'refused')) {
      return { ok: false, code: blocked };
    }
    const rt = this.runtime(board.id);
    rt.attemptMono = mono;
    // A read overtaken by a new key or API address: the board is read again
    // at once under the new configuration (the queue keeps one at a time).
    const overtaken = () => {
      rt.nextDue = -Infinity;
      return { ok: false, code: 'stale' };
    };
    rt.nextDue = mono + this.waitAfter(rt.failures);
    const attemptAt = this.now();
    this.kept[board.id] = { at: attemptAt, failures: rt.failures };
    // The attempt is in /data before the request: a restart never reads sooner.
    await this.save();
    if (generation !== this.generation) {
      return overtaken();
    }
    const again = this.monotonic();
    const still = this.blockedAt(again);
    if (still && !(force && still === 'refused')) {
      return { ok: false, code: still };
    }
    const controller = new AbortController();
    this.inflight = controller;
    try {
      const { json, date } = await fetchBoard(
        {
          apiUrl: this.config.apiUrl,
          apiKey: this.config.apiKey,
          version: this.version,
          fetchImpl: this.fetchImpl,
          signal: controller.signal,
          timeoutMs: this.requestTimeout,
        },
        board,
      );
      if (generation !== this.generation) {
        return overtaken();
      }
      const reading = parseBoard(json, { date, now: this.now() });
      if (reading.unreadableMessages) {
        this.logger.warn(`Board ${board.id}: disruption messages present, their text not read`);
      }
      rt.reading = reading;
      rt.readingMono = this.monotonic();
      rt.failures = 0;
      rt.lastError = null;
      rt.lastStatus = null;
      rt.lastDetail = null;
      rt.staleShown = false;
      rt.nextDue = mono + this.interval();
      this.kept[board.id] = { at: attemptAt, failures: 0 };
      if (this.refused) {
        this.logger.info('The key was accepted: the refusal is lifted');
      }
      this.refused = null;
      this.pause = null;
      this.saveSoon();
      await this.publishBoard(board);
      if (generation !== this.generation) {
        return { ok: true, reading };
      }
      await this.fireEvents(board, reading);
      return { ok: true, reading };
    } catch (err) {
      if (generation !== this.generation) {
        return overtaken();
      }
      return this.failed(board, rt, err, mono);
    } finally {
      if (this.inflight === controller) {
        this.inflight = null;
      }
      if (generation === this.generation) {
        await this.reportStatus();
      }
    }
  }

  failed(board, rt, err, mono) {
    const code = typeof err?.code === 'string' ? err.code : 'unreadable';
    const status = err instanceof DarwinError ? err.status : null;
    this.logger.warn(`Board ${board.id}: ${err instanceof Error ? err.message : code}`);
    this.markStale(board, rt).catch(() => {});
    if (code === 'refused') {
      const salt = this.random(16).toString('hex');
      this.refused = {
        salt,
        tag: tagOf(salt, this.config.apiKey),
        status,
        key: this.config.apiKey,
      };
      this.saveSoon();
      return { ok: false, code, status };
    }
    if (code === 'rate_limited') {
      const count = Math.min(32, (this.pause?.count ?? 0) + 1);
      const seconds = err.retryAfter ?? 60 * 2 ** (count - 1);
      const wait = Math.min(PAUSE_MAX, Math.max(PAUSE_MIN, seconds * 1000));
      // From the instant of the decision, read once.
      const at = this.monotonic();
      this.pause = { until: this.now() + wait, due: at + wait, count };
      this.saveSoon();
      return { ok: false, code, status };
    }
    rt.failures = Math.min(20, rt.failures + 1);
    rt.lastError = code;
    rt.lastStatus = status;
    rt.lastDetail = typeof err?.detail === 'string' && err.detail ? err.detail : null;
    rt.nextDue = mono + this.waitAfter(rt.failures);
    this.kept[board.id] = { at: this.kept[board.id]?.at ?? this.now(), failures: rt.failures };
    this.saveSoon();
    return { ok: false, code, status };
  }

  // --- Publication -----------------------------------------------------------

  /** The clock of a reading: its generation instant plus the time elapsed since it arrived. */
  sourceNow(rt) {
    return rt.reading.generatedAt + (this.monotonic() - rt.readingMono);
  }

  /**
   * No good read for STALE_AFTER: the texts say so (the countdowns cannot be
   * unpublished; their date in Gladys tells their age). Once per outage.
   */
  async markStale(board, rt) {
    if (
      !rt.reading ||
      rt.staleShown ||
      this.monotonic() - rt.readingMono <= STALE_AFTER ||
      !this.isCreated(board) ||
      !this.linked
    ) {
      return;
    }
    rt.staleShown = true;
    const ids = idsOf(this.gladys, board);
    const text = WORDS[this.config.language].noRecent;
    const states = [{ device_feature_external_id: ids.feature(FEATURE.summary), text }];
    for (let rank = 1; rank <= this.config.maxDepartures; rank += 1) {
      states.push({ device_feature_external_id: ids.feature(FEATURE.info(rank)), text });
    }
    try {
      await this.gladys.publishChangedStates(states);
    } catch (err) {
      this.logger.warn(`Board ${board.id}: states not published (${err?.message ?? err})`);
    }
  }

  async publishBoard(board) {
    const rt = this.runtime(board.id);
    if (!rt.reading || !this.isCreated(board) || !this.linked) {
      return;
    }
    const states = statesOf(this.gladys, board, this.config, rt.reading, this.sourceNow(rt));
    try {
      await this.gladys.publishChangedStates(states);
    } catch (err) {
      this.logger.warn(`Board ${board.id}: states not published (${err?.message ?? err})`);
    }
  }

  /** The devices of the configuration, in the Discover tab. */
  async publishDevices() {
    const devices = this.config.boards.map((board) =>
      buildDevice(this.gladys, board, this.config, this.boards.get(board.id)?.reading?.station),
    );
    try {
      await this.gladys.publishDiscoveredDevices(devices);
    } catch (err) {
      this.logger.warn(`Devices not published: ${err?.message ?? err}`);
    }
  }

  /**
   * A device was created or updated: publish what is known if it is fresh
   * (read less than an interval ago), else read it when due — never sooner.
   */
  async onDeviceChanged() {
    const mono = this.monotonic();
    for (const board of this.config.boards) {
      const rt = this.boards.get(board.id);
      if (rt?.reading && mono - rt.readingMono < this.interval() && this.isCreated(board)) {
        this.gladys.forgetPublishedStates?.(idsOf(this.gladys, board).device);
        await this.publishBoard(board);
      }
    }
    this.schedule();
    await this.reportStatus();
  }

  // --- Scene events ----------------------------------------------------------

  allowEvent(mono) {
    this.events = this.events.filter((at) => mono - at < MINUTE);
    return this.events.length < MAX_EVENTS_PER_MINUTE;
  }

  async sendEvent(key, data) {
    const mono = this.monotonic();
    if (!this.allowEvent(mono)) {
      return false;
    }
    this.events.push(mono);
    try {
      await this.gladys.publishSceneEvent(key, data);
      return true;
    } catch (err) {
      this.logger.warn(`Scene event ${key} not sent: ${err?.message ?? err}`);
      return false;
    }
  }

  /** Each service of a created board: "cancelled" once, each delay threshold once. */
  async fireEvents(board, reading) {
    if (!this.isCreated(board)) {
      return;
    }
    const now = this.now();
    const device = idsOf(this.gladys, board).device;
    let changed = false;
    for (const service of reading.services) {
      const key = firedKey(board, service);
      const entry = this.fired.get(key) ?? { at: now, delays: [], cancelled: false };
      const base = {
        board: device,
        station: reading.station,
        destination: service.destination,
        scheduled: service.std,
        expected: service.expectedAt === null ? null : londonTime(service.expectedAt),
        delay: service.delay,
        platform: service.platform || null,
        operator: service.operator || null,
        reason: service.reason || null,
      };
      if (service.status === 'cancelled' && !entry.cancelled) {
        if (await this.sendEvent('train_cancelled', base)) {
          entry.cancelled = true;
          changed = true;
        }
      }
      if (service.delay !== null) {
        for (const threshold of DELAY_THRESHOLDS) {
          if (service.delay >= threshold && !entry.delays.includes(threshold)) {
            if (await this.sendEvent('train_delayed', { ...base, threshold: String(threshold) })) {
              entry.delays.push(threshold);
              changed = true;
            }
          }
        }
      }
      if (entry.cancelled || entry.delays.length > 0) {
        entry.at = now;
        this.fired.set(key, entry);
      }
    }
    if (this.pruneFired(now) || changed) {
      this.saveSoon();
    }
  }

  pruneFired(now) {
    let pruned = false;
    for (const [key, entry] of this.fired) {
      if (now - entry.at > REMEMBER_SERVICE) {
        this.fired.delete(key);
        pruned = true;
      }
    }
    while (this.fired.size > MAX_REMEMBERED_SERVICES) {
      let oldest = null;
      for (const [key, entry] of this.fired) {
        if (!oldest || entry.at < oldest.at) oldest = { key, at: entry.at };
      }
      this.fired.delete(oldest.key);
      pruned = true;
    }
    return pruned;
  }

  // --- Status ----------------------------------------------------------------

  describe() {
    const config = this.config;
    const notes = [];
    if (!config.apiUrlValid) notes.push(STATUS.invalidUrl);
    if (config.invalidBoards.length > 0) notes.push(STATUS.invalidBoards(config.invalidBoards));
    if (config.tooManyBoards) notes.push(STATUS.tooManyBoards(config.boards.length));
    if (this.storeState === 'memory') notes.push(STATUS.storeUnreadable);
    else if (this.saveFailed) notes.push(STATUS.storeUnwritable);
    const result = (connected, first) => ({ connected, message: join([first, ...notes]) });

    if (config.keyState === 'missing') return result(false, STATUS.noKey);
    if (config.keyState === 'invalid') return result(false, STATUS.invalidKey);
    if (config.boards.length === 0) return result(false, STATUS.noBoard);
    if (this.refused) return result(false, STATUS.refused(this.refused.status ?? 401));
    const mono = this.monotonic();
    if (this.pausedAt(mono)) return result(false, STATUS.paused(pauseEnd(this.pause.until)));
    const created = config.boards.filter((board) => this.isCreated(board));
    if (created.length === 0) return result(true, STATUS.notCreated);
    if (this.storeState === 'pending') return result(true, STATUS.starting);
    const errors = [];
    let read = 0;
    let last = null;
    for (const board of created) {
      const rt = this.runtime(board.id);
      if (rt.lastError) {
        const reason = boardError(rt.lastError, rt.lastStatus, rt.lastDetail);
        const label = rt.reading?.station ?? board.from;
        errors.push({ en: `${label}: ${reason.en}.`, fr: `${label} : ${reason.fr}.` });
      } else if (rt.reading) {
        read += 1;
        last = Math.max(last ?? -Infinity, rt.readingMono);
      }
    }
    notes.unshift(...errors);
    if (read === 0 && errors.length === created.length) {
      return result(false, STATUS.allFailed);
    }
    if (read === 0) return result(true, STATUS.waiting);
    const at = londonTime(Math.round((this.now() - (mono - last)) / 1000) * 1000);
    return result(true, STATUS.ok(read, at));
  }

  /** Tell Gladys, once per state (an unchanged status is not sent again). */
  async reportStatus(force = false) {
    if (!this.running || !this.linked) {
      return;
    }
    const { connected, message } = this.describe();
    const key = JSON.stringify([connected, message]);
    if (!force && key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    try {
      await this.gladys.setConnectionStatus(connected, message);
    } catch (err) {
      this.lastStatus = null;
      this.logger.warn(`Status not sent: ${err?.message ?? err}`);
    }
  }

  // --- Buttons and scenes ----------------------------------------------------

  /** Run `fn` in the read queue, given up (never started) past `budget`. */
  async queued(fn, budget) {
    let expired = false;
    let timer;
    const job = this.exclusive(() => (expired ? { ok: false, code: 'busy' } : fn()));
    const late = new Promise((resolve) => {
      timer = this.timers.setTimeout(() => {
        expired = true;
        resolve({ ok: false, code: 'busy' });
      }, budget);
    });
    try {
      return await Promise.race([job, late]);
    } finally {
      this.timers.clearTimeout(timer);
    }
  }

  /** The "Test the connection" button: one read of the first board, at most every 30 s. */
  async testConnection() {
    const config = this.config;
    if (config.keyState === 'missing') return TEST.noKey;
    if (config.keyState === 'invalid') return TEST.invalidKey;
    if (config.boards.length === 0) return TEST.noBoard;
    const mono = this.monotonic();
    if (this.pausedAt(mono)) return TEST.paused(pauseEnd(this.pause.until));
    if (this.lastTest && mono - this.lastTest.mono < TEST_SPACING) {
      return this.lastTest.message;
    }
    const board = config.boards[0];
    const rt = this.runtime(board.id);
    let outcome;
    if (!this.refused && rt.attemptMono !== null && mono - rt.attemptMono < this.interval()) {
      // Read less than an interval ago: its result, without a request (a
      // refused key excepted: the button is the way to try it again).
      outcome =
        rt.reading && rt.lastError === null
          ? { ok: true, reading: rt.reading }
          : { ok: false, code: 'recent', reason: rt.lastError };
    } else {
      if (this.storeState === 'pending') return TEST.busy;
      outcome = await this.queued(() => this.readBoard(board, { force: true }), TEST_BUDGET);
    }
    const message = this.testMessage(outcome, board);
    if (outcome.code !== 'busy' && outcome.code !== 'stale') {
      this.lastTest = { mono, message };
    }
    await this.reportStatus();
    return message;
  }

  testMessage(outcome, board) {
    if (outcome.ok) {
      const rt = this.runtime(board.id);
      const count = upcoming(outcome.reading, this.sourceNow(rt)).length;
      return TEST.ok(outcome.reading.station, count);
    }
    switch (outcome.code) {
      case 'refused':
        return TEST.refused(outcome.status ?? 401);
      case 'paused':
      case 'rate_limited':
        return TEST.paused(pauseEnd(this.pause?.until ?? this.now()));
      case 'busy':
      case 'stale':
      case 'store':
      case 'stopped':
        return TEST.busy;
      case 'key':
        return TEST.invalidKey;
      case 'recent': {
        const rt = this.runtime(board.id);
        return TEST.recent(boardError(outcome.reason, rt.lastStatus, rt.lastDetail));
      }
      default:
        return TEST.failed(
          boardError(outcome.code, outcome.status, this.runtime(board.id).lastDetail),
        );
    }
  }

  /** Scene action: the next departures of one board, fresh (read now when due). */
  async nextDepartures(fields) {
    const board = this.config.boards.find(
      (candidate) => idsOf(this.gladys, candidate).device === fields?.board,
    );
    if (!board) {
      throw new Error(SCENE_ERRORS.unknownBoard);
    }
    const rt = this.runtime(board.id);
    const mono = this.monotonic();
    const due = rt.attemptMono === null || mono - rt.attemptMono >= this.interval();
    if (due && !this.blockedAt(mono)) {
      await this.queued(() => {
        // Another read may have come first while this one waited.
        const at = this.monotonic();
        return rt.attemptMono === null || at - rt.attemptMono >= this.interval()
          ? this.readBoard(board)
          : { ok: true };
      }, SCENE_BUDGET);
    }
    if (!rt.reading || this.monotonic() - rt.readingMono > STALE_AFTER) {
      throw new Error(SCENE_ERRORS.noFresh);
    }
    const trains = upcoming(rt.reading, this.sourceNow(rt));
    const first = trains[0];
    const second = trains[1];
    const language = this.config.language;
    // Unknown stays unknown: without a train, the outputs of a train are null
    // (the scene sees them missing), never 0.
    return {
      minutes: first ? first.minutes : null,
      following_minutes: second ? second.minutes : null,
      destination: first ? first.destination : null,
      scheduled: first ? first.std : null,
      expected: first ? londonTime(first.expectedAt) : null,
      delay: first ? first.delay : null,
      platform: first?.platform || null,
      details: first ? serviceText(first, language) : null,
      summary: summaryText(rt.reading.services, language),
      count: trains.length,
    };
  }
}
