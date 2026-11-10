// -----------------------------------------------------------------------------
// The numbers of the integration, in one place (the tests and the manifest
// test read them from here).
// -----------------------------------------------------------------------------

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

/**
 * The Live Departure Board of the Rail Data Marketplace (RDM), where National
 * Rail now sends the developers (the OpenLDBWS registration page answered 404
 * on 2026-11-10; the SOAP service still runs for the old tokens). One product, one
 * operation: the departures of a station with their details, as JSON, the
 * consumer key of the user in the `x-apikey` header.
 */
export const DEFAULT_API_URL =
  'https://api1.raildata.org.uk/1010-live-departure-board-dep1_2/LDBWS/api/20220120';
/** The only hosts the key is ever sent to (an API address typed by hand included). */
export const API_HOST = /^(?:[a-z0-9-]+\.)*raildata\.org\.uk$/;
/** The operation read, appended to the API address, then the station code. */
export const OPERATION = 'GetDepBoardWithDetails';

/** The departures of the next two hours (the most Darwin gives without an offset). */
export const TIME_WINDOW_MINUTES = 120;
/** Rows asked for: Darwin gives up to 10 on a public board. */
export const NUM_ROWS = 10;

/** One read of every board per interval (seconds). Darwin itself moves continuously. */
export const READ_INTERVAL = { min: 60, max: 3600, default: 120 };
/** Departures exposed as features, per board. */
export const MAX_DEPARTURES = { min: 1, max: 5, default: 3 };
/** Boards watched at most (one request each per interval). */
export const MAX_BOARDS = 6;

/** A request never lasts longer than this, the body read included. */
export const REQUEST_TIMEOUT = 10 * SECOND;
/** A larger answer is cut and not read (10 services with their calling points weigh ~100 KB). */
export const MAX_BODY_BYTES = 1024 * 1024;

/** A 429 pauses every read: never shorter, never longer. */
export const PAUSE_MIN = MINUTE;
export const PAUSE_MAX = 6 * HOUR;
/** A board failing (5xx, timeout, network) is read again later and later, up to this. */
export const BACKOFF_MAX = HOUR;

/** The test button never reads more often than this, whatever the clicks. */
export const TEST_SPACING = 30 * SECOND;
/** The test button answers within this (the action waits 60 s at most). */
export const TEST_BUDGET = 45 * SECOND;

/** /data: read again on this timer while unreadable; a save waited at most this long. */
export const STORE_RETRY = 10 * SECOND;
export const SAVE_WAIT = 2 * SECOND;
/** After this many failed loads, the reads go on without /data (nothing overwritten). */
export const STORE_LOADS_BEFORE_MEMORY = 3;

/** `connected` reads the configuration again on failure, later and later, up to this. */
export const CONFIG_RETRY_MIN = 5 * SECOND;
export const CONFIG_RETRY_MAX = 5 * MINUTE;

/** The countdown of "no train in the next two hours": above any real one. */
export const NO_TRAIN_MINUTES = 999;
/** A text feature never carries more than this. */
export const MAX_TEXT = 500;

/** The delays, in minutes, a scene can wait for (scene trigger `train_delayed`). */
export const DELAY_THRESHOLDS = [5, 10, 15, 30];
/** Scene events: at most this many a minute (the core admits 300 for the integration). */
export const MAX_EVENTS_PER_MINUTE = 60;
/** Services remembered for the scene events (fired once each), and for how long. */
export const MAX_REMEMBERED_SERVICES = 300;
export const REMEMBER_SERVICE = 6 * HOUR;

/** The time zone of every time Darwin gives. */
export const TIME_ZONE = 'Europe/London';
