# gladys-national-rail

External integration for [Gladys Assistant](https://gladysassistant.com): live departures, delays and
cancellations of British trains, from National Rail Darwin through the official Live Departure Board of the
[Rail Data Marketplace](https://raildata.org.uk/) (free key of the user).

Unofficial, not affiliated with National Rail, National Rail Enquiries nor the Rail Delivery Group. Powered
by National Rail Enquiries. Never tested with a real key.

- One read-only device per board (a station, optionally the trains calling at a second one): the next trains
  (minutes, details), the departure board, the disruption messages.
- Scene triggers “Train delayed” (5, 10, 15, 30 min) and “Train cancelled”, scene action “Read the next
  trains”, a “Test the connection” button.
- One request at a time, each board once per interval (120 s by default), 429 and refused keys honoured and
  kept in `/data`.

Documentation: [English](docs/en.md), [français](docs/fr.md).

## Development

```bash
npm ci
npm test            # node --test, no network
npm run lint
npm run format:check
npm run mutants     # mutation check of the guards (scripts/mutants.json), use memcap
```

Licence: Apache-2.0 (see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
