import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BoardError,
  cleanText,
  messageText,
  parseBoard,
  parseService,
  STALE_AFTER,
} from '../src/board.js';
import { statesOf, summaryText, upcoming } from '../src/devices.js';
import { normalizeConfig } from '../src/config.js';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { NOW, MINUTE, board, service, F } from './helpers/world.js';

const parse = (json, date = null) => parseBoard(json, { date, now: NOW });

test('on time, late, delayed (unknown), cancelled: never a made-up delay', () => {
  const reading = parse(
    board({
      services: [
        service({ inMin: 5, etd: 'On time', dest: 'Reading' }),
        service({ inMin: 10, etd: '18:17', dest: 'Oxford' }),
        service({ inMin: 15, etd: 'Delayed', dest: 'Didcot' }),
        service({ inMin: 20, etd: 'Cancelled', dest: 'Bath', cancelReason: 'a broken down train' }),
        service({ inMin: 25, etd: 'On time', dest: 'Bristol', isCancelled: true }),
        service({ inMin: 30, etd: '', dest: 'Swindon' }),
      ],
    }),
  );
  const by = Object.fromEntries(reading.services.map((s) => [s.destination, s]));
  assert.deepEqual([by.Reading.status, by.Reading.delay], ['on_time', 0]);
  assert.deepEqual([by.Oxford.status, by.Oxford.delay], ['late', 7]);
  assert.deepEqual(
    [by.Didcot.status, by.Didcot.delay, by.Didcot.expectedAt],
    ['delayed', null, null],
  );
  assert.deepEqual(
    [by.Bath.status, by.Bath.delay, by.Bath.reason],
    ['cancelled', null, 'a broken down train'],
  );
  assert.equal(by.Bristol.status, 'cancelled');
  assert.deepEqual([by.Swindon.status, by.Swindon.delay], ['unknown', null]);
  // Only the trains with a known time get a countdown.
  assert.deepEqual(
    upcoming(reading, NOW).map((s) => [s.destination, s.minutes]),
    [
      ['Reading', 5],
      ['Oxford', 17],
    ],
  );
  const text = summaryText(reading.services, 'en');
  assert.match(text, /18:15 Didcot \(delayed\)/);
  assert.match(text, /18:20 Bath \(cancelled\)/);
  assert.match(text, /18:10 Oxford \(\+7\)/);
});

test('late across midnight: 23:50 expected 00:20 is 30 min late', () => {
  const at = Date.UTC(2026, 10, 10, 23, 45);
  const reading = parseBoard(
    board({ at, services: [{ std: '23:50', etd: '00:20', destination: [] }] }),
    {
      now: at,
    },
  );
  assert.equal(reading.services[0].delay, 30);
  assert.equal(reading.services[0].destination, '?');
  assert.equal(upcoming(reading, at)[0].minutes, 35);
  // The expected time is placed near the scheduled one, not near the board:
  // even read far from it, 23:50 expected 00:20 stays 30 min late.
  const far = parseService({ std: '23:50', etd: '00:20' }, Date.UTC(2026, 10, 10, 8, 0));
  assert.equal(far.delay, 30);
});

test('the night of the change to winter time: no made-up delay, the train counted', () => {
  const at = Date.UTC(2026, 9, 25, 1, 20); // 01:20 GMT, the second 01:20 of the night
  const reading = parseBoard(
    board({
      at,
      services: [
        { std: '01:50', etd: '02:05', serviceID: 'a', destination: [] },
        { std: '01:50', etd: 'On time', serviceID: 'b', destination: [] },
      ],
    }),
    { now: at },
  );
  assert.deepEqual(
    reading.services.map((s) => s.delay),
    [15, 0],
  );
  assert.deepEqual(
    upcoming(reading, at).map((s) => s.minutes),
    [30, 45],
  );
});

test('lists wrapped or single, every text cleaned; HTML of the messages removed', () => {
  const reading = parse({
    generatedAt: new Date(NOW).toISOString(),
    locationName: 'London\u0000 Paddington\n',
    trainServices: {
      service: {
        std: '18:30',
        etd: 'On time',
        platform: '1‮',
        destination: {
          location: [{ locationName: 'Reading', via: 'via Slough' }, { locationName: 'Oxford' }],
        },
      },
    },
    nrccMessages: {
      message: [
        '<p>Disruption between <a href="https://x">Reading &amp; Didcot</a>.</p>',
        { value: 'Lifts out of order' },
        { Value: 'x'.repeat(30_000) },
        null,
      ],
    },
  });
  assert.equal(reading.station, 'London Paddington');
  assert.equal(reading.services[0].destination, 'Reading via Slough & Oxford');
  assert.deepEqual(reading.messages, [
    'Disruption between Reading & Didcot .',
    'Lifts out of order',
  ]);
  assert.equal(messageText('<b>' + 'y'.repeat(400) + '</b>').length, 300);
  assert.equal(cleanText({ toString: () => 'x' }), '');
});

test('not a board: no station, an array, a board served long after it was made', () => {
  for (const bad of [null, [], 'text', { trainServices: [] }]) {
    assert.throws(() => parse(bad), BoardError);
  }
  const old = board({ at: NOW - STALE_AFTER - MINUTE });
  assert.throws(() => parse(old, new Date(NOW).toUTCString()), /old board/);
  // Without generatedAt: the Date header, else the wall clock.
  const undated = { locationName: 'Reading', trainServices: [service({ inMin: 3 })] };
  assert.equal(parse(undated, new Date(NOW).toUTCString()).generatedAt, NOW);
  assert.equal(parse(undated).generatedAt, NOW);
  // An empty board: no train.
  assert.deepEqual(parse({ locationName: 'Reading', trainServices: null }).services, []);
});

test('states: countdowns, the 999 of "no train", texts never a measure', () => {
  const gladys = createFakeGladys({ selector: 'national-rail' });
  const config = normalizeConfig({ api_key: 'abcdefgh1234', boards: 'PAD', max_departures: 2 });
  const reading = parse(board({ services: [service({ inMin: 4, etd: '18:06' })] }));
  const states = statesOf(gladys, config.boards[0], config, reading, NOW + 30_000);
  const by = Object.fromEntries(states.map((s) => [s.device_feature_external_id, s]));
  assert.equal(by[F('PAD', 'departure_1')].state, 5);
  assert.equal(
    by[F('PAD', 'departure_1_info')].text,
    '18:04 Reading · platform 4 · 2 min late (expected 18:06)',
  );
  assert.equal(by[F('PAD', 'departure_2')].state, 999);
  assert.equal(by[F('PAD', 'departure_2_info')].text, '');
  assert.equal(by[F('PAD', 'messages')].text, 'No disruption message');
  for (const s of states) {
    assert.ok(
      'text' in s ? typeof s.text === 'string' && !('state' in s) : Number.isInteger(s.state),
    );
  }
  const fr = statesOf(gladys, config.boards[0], { ...config, language: 'fr' }, reading, NOW);
  assert.match(
    fr.find((s) => s.device_feature_external_id === F('PAD', 'departure_1_info')).text,
    /voie 4 · retard 2 min/,
  );
  // A train gone more than a minute ago is no longer counted.
  assert.equal(upcoming(reading, NOW + 8 * MINUTE).length, 0);
});
