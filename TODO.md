# TODO

## Decisions

- 2026-11-10: **Rail Data Marketplace, not OpenLDBWS.** The OpenLDBWS SOAP service still answers, but its
  registration page answers 404 and nationalrail.co.uk/developers sends developers to the Rail Data
  Marketplace: a new user can only get a key there. v1 reads the RDM Live Departure Board
  (`GetDepBoardWithDetails`, JSON, `x-apikey`); the API address is a setting (raildata.org.uk hosts only)
  in case the product moves. The JSON field names follow the official LDBWS schema; the REST answer itself
  was never seen with a real key (401 without one): checked by a user before the release.
- 2026-11-10: version 0.1.0 by hand (package.json, lock, manifest, `docker_image`).
- 2026-11-10: categories `transport` only; no `keywords` nor `countries` in the manifest (store rule): the
  country is UK.
- 2026-11-10: read-only (lot 21 rule). No widget in v1.
- 2026-11-10: no train in the next two hours = countdown 999 (above any real one, as the sister transit
  integrations), never 0; cancelled trains and "Delayed" without a time get no countdown.
- 2026-11-10: a refused key is a 401/403 carrying the fault of the Apigee gateway of the RDM; any other
  401/403 is "unreadable" (retried with the backoff of the board).
- 2026-11-10: `poll_frequency` not used: the integration paces itself (one request at a time for the key).
- 2026-11-10: jfparis/homeassistant_nationalrail has no LICENSE: written from the official documentation only.

## Next

- Check the JSON of the RDM product with a real key (field names, `nrccMessages` shape, error codes for an
  unknown station: 400, 404 or 500?).
- A dashboard widget of the next trains.
- Station search by name (the CRS list of NaPTAN, OGL) instead of typing the code.
- Arrivals board, and the OpenLDBWS SOAP service for the users who still hold a token.
