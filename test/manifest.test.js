// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here. The version is
// never pinned: only its form and its agreement everywhere.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/config.js';
import { DELAY_THRESHOLDS, MAX_DEPARTURES, READ_INTERVAL } from '../src/constants.js';
import { buildDevice } from '../src/devices.js';
import { ACTIONS, SCENE_ACTIONS, SCENE_TRIGGERS } from '../src/handlers.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) yield* texts(entry, `${path}[${i}]`);
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) yield* texts(value, `${path}.${key}`);
  }
}

test('the store basics; the same semver version in the four places', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.gladys_version, '>=5.1.0');
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-national-rail:${manifest.version}`);
  assert.equal(pkg.name, 'gladys-national-rail');
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/LM1LC3N7/gladys-national-rail/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.deepEqual(manifest.categories, ['transport']);
  assert.equal(manifest.keywords, undefined);
  assert.equal(manifest.countries, undefined);
  assert.equal(pkg.scripts.test, 'node --test --test-timeout=60000');
  assert.match(pkg.dependencies['@gladysassistant/integration-sdk'], /^\^\d+\.\d+\.\d+$/);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`);
    assert.ok(docs.length >= 300, `docs/${lang}.md is too short for the store`);
    assert.match(
      docs,
      /not\s+affiliated\s+with\s+National\s+Rail|sans\s+lien\s+avec\s+National\s+Rail/i,
    );
    assert.match(docs, /never\s+tested\s+with\s+a\s+real|jamais\s+testé\s+avec\s+une?\s+vra/i);
    assert.match(docs, /Powered by National Rail Enquiries/);
  }
  assert.match(fields.intro.description.en, /Never tested with a real key/);
  assert.match(fields.intro.description.fr, /Jamais testé avec une vraie clé/);
});

test('every text is in English and French; placeholders too', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
  }
  for (const field of manifest.config_schema.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', `${field.key}: placeholder`);
  }
});

test('the key: a secret, no default, described as kept by Gladys; no key prefixed gladys_', () => {
  assert.equal(fields.api_key.type, 'secret');
  assert.equal(fields.api_key.default, undefined);
  assert.equal(fields.api_key.placeholder, undefined);
  assert.match(
    fields.api_key.description.en,
    /Kept by Gladys in its database, never shown again, sent only to the Rail Data Marketplace/,
  );
  assert.match(
    fields.api_key.description.fr,
    /Gardée par Gladys dans sa base, jamais réaffichée, envoyée seulement au Rail Data Marketplace/,
  );
  for (const field of manifest.config_schema) {
    assert.ok(!field.key.startsWith('gladys_'), field.key);
    if (field.type === 'secret') assert.equal(field.default, undefined, field.key);
  }
  assert.equal(manifest.containers, undefined);
  assert.equal(manifest.location, undefined);
});

test('the configuration matches the code', () => {
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    assert.deepEqual(fields[key].default, value, key);
  }
  for (const field of manifest.config_schema.filter((f) => f.default !== undefined)) {
    assert.ok(field.key in DEFAULT_CONFIG, `${field.key} has no default in the code`);
  }
  assert.deepEqual(
    [fields.read_interval.min, fields.read_interval.max, fields.read_interval.default],
    [READ_INTERVAL.min, READ_INTERVAL.max, READ_INTERVAL.default],
  );
  assert.deepEqual(
    [fields.max_departures.min, fields.max_departures.max, fields.max_departures.default],
    [MAX_DEPARTURES.min, MAX_DEPARTURES.max, MAX_DEPARTURES.default],
  );
  assert.deepEqual(fields.language.options.map((o) => o.value).sort(), ['en', 'fr']);
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    for (const lang of ['en', 'fr']) {
      assert.ok(section.description[lang].length <= 1000, `${section.key}.${lang}`);
    }
    assert.ok((section.links ?? []).every((l) => l.url.startsWith('https://')));
  }
});

test('the actions, scene triggers and scene actions are the ones the code handles', () => {
  assert.deepEqual(
    manifest.actions.map((a) => a.key),
    Object.values(ACTIONS),
  );
  assert.deepEqual(
    manifest.scene_triggers.map((a) => a.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key),
    Object.values(SCENE_ACTIONS),
  );
  for (const action of [...manifest.actions, ...manifest.scene_actions]) {
    assert.ok(action.timeout_seconds >= 30 && action.timeout_seconds <= 120, action.key);
  }
  const delayed = manifest.scene_triggers.find((t) => t.key === SCENE_TRIGGERS.delayed);
  assert.deepEqual(
    delayed.fields.find((f) => f.key === 'threshold').options.map((o) => o.value),
    DELAY_THRESHOLDS.map(String),
  );
  // The variables are the keys the code sends (src/app.js fireEvents).
  const app = read('src/app.js');
  for (const trigger of manifest.scene_triggers) {
    for (const variable of trigger.variables) {
      assert.match(app, new RegExp(`\\b${variable.key}:`), `${trigger.key}.${variable.key}`);
    }
  }
  const outputs = manifest.scene_actions[0].outputs.map((o) => o.key);
  for (const key of outputs) assert.match(app, new RegExp(`\\b${key}:`), key);
  assert.equal(manifest.widgets, undefined);
});

test('published devices: supported_options follow the rules of the core (none here); units of the category', () => {
  const gladys = createFakeGladys({ selector: 'national-rail' });
  const config = normalizeConfig({
    api_key: 'abcdefgh1234',
    boards: 'PAD, RDG>PAD',
    max_departures: 5,
  });
  const require = createRequire(import.meta.url);
  const core = '/home/claude/code/Gladys/server/utils/constants.js';
  const constants = existsSync(core) ? require(core) : null;
  for (const board of config.boards) {
    const device = buildDevice(gladys, board, config);
    assert.ok(device.external_id.startsWith('ext:national-rail:board:'));
    for (const feature of device.features) {
      assert.equal(feature.read_only, true, feature.external_id);
      assert.equal(feature.supported_options, undefined, feature.external_id);
      assert.notEqual(feature.category, 'switch');
      assert.notEqual(feature.type, 'binary');
      assert.equal(typeof feature.name, 'string');
      if (constants && feature.unit) {
        assert.ok(
          constants.DEVICE_FEATURE_UNITS_BY_CATEGORY[feature.category].includes(feature.unit),
          `${feature.category} ${feature.unit}`,
        );
      }
    }
  }
});
