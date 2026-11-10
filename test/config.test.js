import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiUrlOf, integerIn, normalizeConfig, parseBoards } from '../src/config.js';
import { DEFAULT_API_URL, MAX_BOARDS, READ_INTERVAL } from '../src/constants.js';

test('boards: codes, a calling-at filter, a name; upper-cased; duplicates once', () => {
  const { boards, invalid } = parseBoards(' pad , RDG > PAD : To work\nrdg>pad, KGX');
  assert.deepEqual(invalid, []);
  assert.deepEqual(boards, [
    { id: 'PAD', from: 'PAD', to: null, name: null },
    { id: 'RDG-PAD', from: 'RDG', to: 'PAD', name: 'To work' },
    { id: 'KGX', from: 'KGX', to: null, name: null },
  ]);
});

test('boards: an entry not understood is told by its position, never kept', () => {
  const { boards, invalid } = parseBoards(
    'PADD, P4D, PAD>PAD, PAD>RDG>OXF, OXF:\u0007bell, EUS:' + 'x'.repeat(41) + ', EUS',
  );
  assert.deepEqual(invalid, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(
    boards.map((b) => b.id),
    ['EUS'],
  );
  const config = normalizeConfig({ api_key: 'abcdefgh1234', boards: 'PADD' });
  assert.deepEqual(config.invalidBoards, [1]);
  assert.ok(!JSON.stringify(config).includes('PADD'));
});

test('boards: at most MAX_BOARDS, the rest told', () => {
  const codes = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'HHH'];
  const { boards, tooMany } = parseBoards(codes.join(','));
  assert.equal(boards.length, MAX_BOARDS);
  assert.equal(tooMany, true);
  assert.equal(parseBoards(undefined).boards.length, 0);
  assert.equal(parseBoards(42).boards.length, 0);
});

test('the key: missing, invalid (spaces, CR/LF, controls), ok', () => {
  assert.equal(normalizeConfig({}).keyState, 'missing');
  assert.equal(normalizeConfig({ api_key: '   ' }).keyState, 'missing');
  for (const bad of [
    'abc def ghi',
    'abcdefgh\r\nX-Evil: 1',
    'abcdefgh\u0000',
    'short',
    'é'.repeat(10),
  ]) {
    const config = normalizeConfig({ api_key: bad });
    assert.equal(config.keyState, 'invalid', JSON.stringify(bad));
    assert.equal(config.apiKey, '');
  }
  const ok = normalizeConfig({ api_key: '  AbC123-def_456.ghi  ' });
  assert.equal(ok.keyState, 'ok');
  assert.equal(ok.apiKey, 'AbC123-def_456.ghi');
});

test('the API address: https on a raildata.org.uk host only, else the default', () => {
  assert.deepEqual(apiUrlOf(undefined), { url: DEFAULT_API_URL, valid: true });
  assert.deepEqual(apiUrlOf(''), { url: DEFAULT_API_URL, valid: true });
  assert.deepEqual(apiUrlOf('https://api2.raildata.org.uk/x/y/'), {
    url: 'https://api2.raildata.org.uk/x/y',
    valid: true,
  });
  for (const bad of [
    'http://api1.raildata.org.uk/x',
    'https://raildata.org.uk.evil.com/x',
    'https://evilraildata.org.uk/x',
    'https://user:pw@api1.raildata.org.uk/x',
    'https://api1.raildata.org.uk/x?key=1',
    'https://api1.raildata.org.uk:8443/x',
    'https://api1.raildata.org.uk/x\r\n',
    'not a url',
    42,
  ]) {
    assert.deepEqual(apiUrlOf(bad), { url: DEFAULT_API_URL, valid: false }, String(bad));
  }
});

test('numbers: an integer of the range, else the default; never a decimal, an empty value', () => {
  assert.equal(integerIn(undefined, READ_INTERVAL), 120);
  assert.equal(integerIn('', READ_INTERVAL), 120);
  assert.equal(integerIn('90', READ_INTERVAL), 90);
  assert.equal(integerIn(90.5, READ_INTERVAL), 120);
  assert.equal(integerIn('1e3', READ_INTERVAL), 120);
  assert.equal(integerIn(5, READ_INTERVAL), 60);
  assert.equal(integerIn(99999, READ_INTERVAL), 3600);
  assert.equal(normalizeConfig({ language: 'fr' }).language, 'fr');
  assert.equal(normalizeConfig({ language: 'de' }).language, 'en');
  assert.equal(normalizeConfig(null).keyState, 'missing');
});
