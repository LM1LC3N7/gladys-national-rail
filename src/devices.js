// -----------------------------------------------------------------------------
// One Gladys device per board (a station, optionally the trains calling at a
// second one). Read-only. Features, for each of the N next trains that will
// run with a known time (N = `max_departures`):
//   - "Next train" / "Train n"   : minutes until it leaves (duration);
//   - "Next train details" ...   : "21:15 Reading · platform 4 · on time" (text);
// plus "Departure board" (every service of the board, cancelled and delayed
// ones included) and "Disruption messages" (the National Rail messages of the
// station). None keeps an history: a countdown read every two minutes is
// worth nothing tomorrow.
//
// A cancelled train, or one Darwin only calls "Delayed" (no time known), has
// no countdown: it is told in the board text, never given a made-up time.
// No train in the next two hours: the countdowns say 999 (above any real one,
// so a "less than 10 min" scene never fires) and the details are empty.
//
// External ids: `ext:<selector>:board:<CRS>[-<CRS>]:<feature>`, from the
// codes typed (fixed; the name of the device never enters them).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { MAX_TEXT, MINUTE, NO_TRAIN_MINUTES } from './constants.js';
import { FEATURE_NAMES, WORDS } from './i18n.js';
import { cleanText } from './board.js';
import { londonTime } from './time.js';

export const DEVICE_TYPE = 'board';
export const FEATURE = {
  departure: (rank) => `departure_${rank}`,
  info: (rank) => `departure_${rank}_info`,
  summary: 'summary',
  messages: 'messages',
};

export const idsOf = (gladys, board) => gladys.externalIds(DEVICE_TYPE, board.id);

/** The name of a board device: the one typed, else "National Rail – PAD" / "– RDG → PAD". */
export function deviceName(board, station = null) {
  if (board.name) {
    return board.name;
  }
  const place = station ? `${station} (${board.from})` : board.from;
  return `National Rail – ${place}${board.to ? ` → ${board.to}` : ''}`;
}

const textFeature = (name, externalId) => ({
  name,
  external_id: externalId,
  category: DEVICE_FEATURE_CATEGORIES.TEXT,
  type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
  min: 0,
  max: 0,
  read_only: true,
  has_feedback: false,
  keep_history: false,
});

/** The device of a board, as published in the Discover tab. */
export function buildDevice(gladys, board, config, station = null) {
  const ids = idsOf(gladys, board);
  const names = FEATURE_NAMES[config.language];
  const features = [];
  for (let rank = 1; rank <= config.maxDepartures; rank += 1) {
    features.push({
      name: names.departure(rank),
      external_id: ids.feature(FEATURE.departure(rank)),
      category: DEVICE_FEATURE_CATEGORIES.DURATION,
      type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
      unit: DEVICE_FEATURE_UNITS.MINUTES,
      min: 0,
      max: NO_TRAIN_MINUTES,
      read_only: true,
      has_feedback: false,
      keep_history: false,
    });
    features.push(textFeature(names.info(rank), ids.feature(FEATURE.info(rank))));
  }
  features.push(textFeature(names.summary, ids.feature(FEATURE.summary)));
  features.push(textFeature(names.messages, ids.feature(FEATURE.messages)));
  return {
    name: deviceName(board, station),
    external_id: ids.device,
    params: [
      { name: 'station', value: board.from },
      { name: 'calling_at', value: board.to ?? '' },
    ],
    features,
  };
}

/** The status word of a service: "on time", "5 min late (expected 21:20)", "cancelled"… */
export function statusText(service, language) {
  const words = WORDS[language];
  switch (service.status) {
    case 'on_time':
      return words.onTime;
    case 'late':
      return words.late(service.delay, londonTime(service.expectedAt));
    case 'delayed':
      return words.delayed;
    case 'cancelled':
      return words.cancelled;
    default:
      return words.unknown;
  }
}

/** "21:15 Reading · platform 4 · on time" */
export function serviceText(service, language) {
  const words = WORDS[language];
  const parts = [`${service.std} ${service.destination}`];
  if (service.platform) {
    parts.push(words.platform(service.platform));
  }
  parts.push(statusText(service, language));
  return cleanText(parts.join(' · '), MAX_TEXT);
}

/** "21:15 Reading (on time) · 21:22 Oxford (+5) · 21:30 Didcot (cancelled)" */
export function summaryText(services, language) {
  const words = WORDS[language];
  if (services.length === 0) {
    return words.noTrain;
  }
  const short = (service) =>
    service.status === 'late' ? words.lateShort(service.delay) : statusText(service, language);
  return cleanText(
    services
      .map((service) => `${service.std} ${service.destination} (${short(service)})`)
      .join(' · '),
    MAX_TEXT,
  );
}

/**
 * The trains that will run, with a known time, not gone yet at `sourceNow`
 * (the clock of the board: its `generatedAt` plus the time elapsed since),
 * soonest first, each with its countdown.
 */
export function upcoming(reading, sourceClock) {
  // Darwin counts in whole minutes: the clock is taken to the second, so that
  // a train due in 10 min read a millisecond later is not told 9.
  const sourceNow = Math.floor(sourceClock / 1000) * 1000;
  return reading.services
    .filter((service) => service.expectedAt !== null && service.expectedAt >= sourceNow - MINUTE)
    .map((service) => ({
      ...service,
      minutes: Math.min(
        NO_TRAIN_MINUTES,
        Math.max(0, Math.floor((service.expectedAt - sourceNow) / MINUTE)),
      ),
    }))
    .sort((a, b) => a.expectedAt - b.expectedAt);
}

/** The states of a board device for a reading. */
export function statesOf(gladys, board, config, reading, sourceNow) {
  const ids = idsOf(gladys, board);
  const trains = upcoming(reading, sourceNow);
  const states = [];
  for (let rank = 1; rank <= config.maxDepartures; rank += 1) {
    const train = trains[rank - 1];
    states.push({
      device_feature_external_id: ids.feature(FEATURE.departure(rank)),
      state: train ? train.minutes : NO_TRAIN_MINUTES,
    });
    states.push({
      device_feature_external_id: ids.feature(FEATURE.info(rank)),
      text: train ? serviceText(train, config.language) : '',
    });
  }
  states.push({
    device_feature_external_id: ids.feature(FEATURE.summary),
    text: summaryText(reading.services, config.language),
  });
  states.push({
    device_feature_external_id: ids.feature(FEATURE.messages),
    text:
      reading.messages.length > 0
        ? cleanText(reading.messages.join(' | '), MAX_TEXT)
        : WORDS[config.language].noMessage,
  });
  return states;
}
