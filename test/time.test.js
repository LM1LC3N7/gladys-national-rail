import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instantOf, londonInstant, londonTime, minutesUntil } from '../src/time.js';

const MIN = 60_000;
const utc = (...args) => Date.UTC(...args);

test('winter (GMT) and summer (BST): the right instant of a London time', () => {
  assert.equal(londonInstant(2026, 11, 10, 18, 15), utc(2026, 10, 10, 18, 15));
  assert.equal(londonInstant(2026, 7, 1, 18, 15), utc(2026, 6, 1, 17, 15));
  assert.equal(londonTime(utc(2026, 6, 1, 17, 15)), '18:15');
  assert.equal(londonTime(utc(2026, 10, 10, 18, 15)), '18:15');
});

test('midnight: 23:58 read at 00:03 is yesterday, 00:10 read at 23:55 tomorrow', () => {
  const justAfter = utc(2026, 10, 11, 0, 3);
  assert.equal(instantOf('23:58', justAfter), utc(2026, 10, 10, 23, 58));
  const justBefore = utc(2026, 10, 10, 23, 55);
  assert.equal(instantOf('00:10', justBefore), utc(2026, 10, 11, 0, 10));
  // A past time weighs double: 16:00 read at 23:59 is today, 12:00 tomorrow.
  assert.equal(instantOf('16:00', utc(2026, 10, 10, 23, 59)), utc(2026, 10, 10, 16, 0));
  assert.equal(instantOf('12:00', utc(2026, 10, 10, 23, 59)), utc(2026, 10, 11, 12, 0));
});

test('midnight in summer: London is an hour ahead of UTC', () => {
  // 23:30 UTC on 1 July is 00:30 on 2 July in London.
  const reference = utc(2026, 6, 1, 23, 30);
  assert.equal(instantOf('00:40', reference), utc(2026, 6, 1, 23, 40));
  assert.equal(instantOf('23:50', reference), utc(2026, 6, 1, 22, 50));
});

test('spring forward (29 March 2026): 00:50 then 03:10 is 80 min, not 140', () => {
  const before = instantOf('00:50', utc(2026, 2, 29, 0, 40));
  const after = instantOf('03:10', utc(2026, 2, 29, 0, 40));
  assert.equal(before, utc(2026, 2, 29, 0, 50));
  assert.equal(after, utc(2026, 2, 29, 2, 10));
  assert.equal((after - before) / MIN, 80);
});

test('fall back (25 October 2026): 01:30 is the first one, 02:30 after the change', () => {
  assert.equal(londonInstant(2026, 10, 25, 1, 30), utc(2026, 9, 25, 0, 30));
  assert.equal(londonInstant(2026, 10, 25, 2, 30), utc(2026, 9, 25, 2, 30));
  assert.equal(londonInstant(2026, 10, 25, 0, 30), utc(2026, 9, 24, 23, 30));
});

test('not a time: null; minutes rounded down, never below 0', () => {
  for (const text of ['On time', 'Delayed', '24:00', '7:05', '', null, 12]) {
    assert.equal(instantOf(text, utc(2026, 10, 10)), null, String(text));
  }
  assert.equal(instantOf('10:00', NaN), null);
  assert.equal(minutesUntil(10 * MIN - 1, 0), 9);
  assert.equal(minutesUntil(0, MIN), 0);
});

test('the hour repeated in autumn: the reading nearest to the board, a past one counting double', () => {
  // 25 October 2026: 01:00-02:00 comes twice (BST 00:00-01:00 UTC, then GMT 01:00-02:00 UTC).
  const second = utc(2026, 9, 25, 1, 20); // 01:20 GMT, second pass
  assert.equal(instantOf('01:50', second), utc(2026, 9, 25, 1, 50));
  assert.equal(instantOf('02:05', second), utc(2026, 9, 25, 2, 5));
  const first = utc(2026, 9, 25, 0, 20); // 01:20 BST, first pass
  assert.equal(instantOf('01:50', first), utc(2026, 9, 25, 0, 50));
  // Expected times placed near the scheduled one.
  const std = instantOf('01:50', second);
  assert.equal((instantOf('01:55', std) - std) / MIN, 5);
  assert.equal((instantOf('02:05', std) - std) / MIN, 15);
  // A train just gone in the first pass, read in the second.
  assert.equal(instantOf('01:58', utc(2026, 9, 25, 1, 0)), utc(2026, 9, 25, 0, 58));
});
