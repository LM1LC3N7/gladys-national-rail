# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- First version: live departures of British trains from National Rail Darwin, through the Live Departure
  Board of the Rail Data Marketplace (consumer key of the user).
- One read-only device per board (station, optional calling-at filter): the next trains (minutes, details),
  the departure board, the disruption messages.
- Scene triggers “Train delayed” and “Train cancelled”, scene action “Read the next trains”, “Test the
  connection” button.
- Pace kept across restarts, 429 pauses, refused key and fired events kept in `/data`.
