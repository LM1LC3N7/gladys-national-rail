# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Changed

- Declared for the United Kingdom only (`countries: ["GB"]`): the Gladys catalog of an
  instance located elsewhere no longer lists it in its browse views (the
  search still finds it). Requires Gladys 5.3.0 or later.

## [0.1.1] - 2026-11-10

### Added

- First version: live departures of British trains from National Rail Darwin, through the Live Departure
  Board of the Rail Data Marketplace (consumer key of the user).
- One read-only device per board (station, optional calling-at filter): the next trains (minutes, details),
  the departure board, the disruption messages.
- Scene triggers “Train delayed” and “Train cancelled”, scene action “Read the next trains”, “Test the
  connection” button.
- Pace kept across restarts, 429 pauses, refused key and fired events kept in `/data`.

### Fixed

- Review r1: the hour repeated in October, `areServicesAvailable: false` (unknown, never “no train”), the
  countdown counted from the time the board was served, the test button within the interval, a new key
  reading the failed boards at once, “No recent data” after 15 min, unreadable messages, `/data` not
  writable and an out-of-date API address told.
- Review r2: the test button waits for a read in flight instead of telling a failure, forgets the result of
  the old key; “No recent data” also during a 429 pause or with a refused key; an old copy of a board told
  as such.

[Unreleased]: https://github.com/LM1LC3N7/gladys-national-rail/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-national-rail/releases/tag/v0.1.1
