# CLAUDE.md

Guidance for Claude Code (and any contributor) working in this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one Docker container) for the
live departures of British trains: National Rail Darwin, read from the **Live Departure Board** product of
the Rail Data Marketplace with the user's free consumer key. Read-only. Unofficial; "Powered by National Rail
Enquiries" must stay in the docs and notices.

## Layout

```
index.js            SDK wiring only (handlers in src/handlers.js)
src/app.js          the integration: pace, pauses, refused key, /data, publication, scenes, status
src/darwin.js       one HTTP request to the RDM and what each answer means
src/board.js        the LDBWS JSON -> services (status, delay, expected time), cleaned texts
src/time.js         Darwin "HH:MM" (London time) -> instants, midnight and changes of time
src/devices.js      the device of a board, its states, its texts
src/config.js       the form, checked (key, boards, API address restricted to raildata.org.uk)
src/store.js        /data (missing / read / unreadable told apart)
src/i18n.js         every text, en + fr
scripts/            cover generator, mutation check (mutants.json)
```

## Rules that must hold

- The key never appears in logs, statuses, `/data`, error messages; it is sent only to a raildata.org.uk host.
- One request in flight; each board at most once per interval, the attempt time in `/data` before the request.
- A refused key (gateway fault on 401/403) stops automatic reads until a new key or a successful test.
- 429: global pause 1 min to 6 h (Retry-After), in `/data`. Other failures: per-board backoff up to 1 h.
- Unknown stays unknown: no countdown for a cancelled train or a "Delayed" one; 999 only for "no train".
- Decisions on the monotonic clock; the wall clock only dates `/data`.

## Commands

```bash
npm ci
gi test / gi ci                      # on the VM (tests on Node 22 and 24, Docker, validator)
npm test                             # node --test --test-timeout=60000
npm run lint && npm run format:check
memcap node scripts/mutants.mjs      # mutation check, one mutant at a time
```
