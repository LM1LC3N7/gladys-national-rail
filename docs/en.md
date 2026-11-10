# National Rail for Gladys Assistant

Live departures of British trains in Gladys: the next trains of your stations, their platform, their delay,
the cancellations and the National Rail disruption messages, from Darwin, the official real-time train
information engine of Great Britain.

Unofficial integration, not affiliated with National Rail, National Rail Enquiries nor the Rail Delivery
Group. Powered by National Rail Enquiries. **Never tested with a real key**: written from the official
documentation of the Live Departure Board web service (LDBWS) and its schema, and tested against a simulated
service.

## What you need

A free key of the **Rail Data Marketplace** (RDM), the platform where National Rail now publishes Darwin for
developers:

1. Create an account on [raildata.org.uk](https://raildata.org.uk/).
2. Find the **Live Departure Board** product (Darwin, free) and subscribe to it.
3. Open your subscription and copy its **consumer key**.

The old OpenLDBWS registration page no longer answers (checked on 10 November 2026): its tokens are not used
by this integration.

## Configuration

| Field                  | What to type                                                                                                                                                                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consumer key           | The consumer key of the subscription. Kept by Gladys in its database, never shown again, sent only to the Rail Data Marketplace.                                                                                                                                                    |
| Boards                 | Station codes (three letters: PAD for London Paddington, RDG for Reading…, shown on every station page of nationalrail.co.uk), separated by commas. `RDG>PAD`: only the trains from Reading that call at London Paddington. `:My name` at the end names the device. Up to 6 boards. |
| Refresh interval       | How often each board is read, 120 s by default (60 to 3600).                                                                                                                                                                                                                        |
| Trains per board       | How many upcoming trains are exposed as features (3 by default, 1 to 5).                                                                                                                                                                                                            |
| Language of the values | English or French, for the feature names and the texts.                                                                                                                                                                                                                             |
| API address            | Leave it as it is, unless the Rail Data Marketplace moves the product. Only an `https://…raildata.org.uk` address is accepted: the key is sent nowhere else.                                                                                                                        |

Example: `PAD, RDG>PAD:Train to work`.

Save, then open the **Discover** tab and add the boards. Only the boards added as devices are read on their own. The
**Test the connection** button reads the first board (at most once every 30 s; a board read less than an
interval ago is answered from that read).

## Devices

One device per board, read-only. For each of the next trains that will run with a known time:

- **Next train**, **Train 2**…: minutes until it leaves (from its expected time). `999` means no train in the
  next two hours.
- **Next train details**…: `18:15 Reading · platform 4 · 5 min late (expected 18:20)`.

And for the whole board:

- **Departure board**: every service, cancelled and delayed ones included:
  `18:15 Reading (+5) · 18:22 Oxford (on time) · 18:30 Didcot (cancelled)`.
- **Disruption messages**: the National Rail messages of the station, without their HTML.

A cancelled train, or a train Darwin only calls “Delayed” without a time, gets no countdown: it is told in the
departure board text, never given a made-up time. Times are UK times (GMT in winter, BST in summer), changes of
time and midnight included. No feature keeps a history.

## Scenes

- **Train delayed** (trigger): a train of a watched board is now late by at least 5, 10, 15 or 30 minutes.
  Once per train and threshold (a train 12 min late fires the 5 and 10 min thresholds, then 15 if it gets
  later). Variables: station, destination, scheduled and expected time, delay, platform, operator, reason.
- **Train cancelled** (trigger): once per train, with the reason when Darwin gives one.
- **Read the next trains** (action): the next trains of a board, read again if the last read is older than the
  interval. Outputs: minutes to the next and the following one, destination, times, delay, platform, details,
  departure board, number of trains. Without a train, the outputs of a train are empty.

The events already fired are kept in `/data`: a restart does not fire them again. At most 60 events a minute
are sent, the rest at the next reads.

## Reads, pauses and errors

- Each board is read once per interval, one request at a time. The time of each attempt is written to `/data`
  before the request (when `/data` can be written): a restart, a reconnection, a saved form or the Discover tab never read sooner.
- **Key refused** (401 or 403 with the error of the Rail Data Marketplace gateway): no automatic retry. The
  status says so; saving a different key, or a successful press of **Test the connection**, lifts it (a
  key changed while the integration was stopped shares the tag of the refused one once in 256: the button
  then lifts it). Only a
  tag of 8 bits of a salted hash is kept in `/data`, never the key. An unreadable 401/403 is not taken for a
  refusal.
- **429 (too many requests)**: every board waits, `Retry-After` if given, else 1 min doubling, between 1 min and
  6 h; the pause is kept in `/data`.
- **One board failing** (server error, no answer within 10 s, unknown station code): it is read again later
  and later (the interval doubling, up to 1 h); the other boards go on.
- Answers larger than 1 MB are cut before they are read, and a board generated more than 15 min before it was
  served is not used.
- `/data` unreadable: never written over; the integration reads it again every 10 s and, within 30 s, goes on
  with the pauses and the refusal in memory (the status says so).

## Privacy

The integration sends the station codes and your key to the Rail Data Marketplace only, with its own
User-Agent (`gladys-national-rail/<version>`). Nothing else leaves your Gladys.

## Data and licence

Train data: National Rail Enquiries (Darwin), through the Rail Data Marketplace, under the terms you accept
when you subscribe. Powered by National Rail Enquiries. The code of the integration is Apache-2.0.
