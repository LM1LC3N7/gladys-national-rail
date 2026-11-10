# Third-party notices

## Code

The code of this integration is original (Apache-2.0, see `LICENSE`). It ports no third-party code.

- It was written from the official documentation of the Darwin Live Departure Board web service (LDBWS):
  the documentation page and the XML schemas published by National Rail Enquiries at
  `https://lite.realtime.nationalrail.co.uk/OpenLDBWS/` (field names `std`, `etd`, `platform`,
  `isCancelled`, `cancelReason`, `delayReason`, `nrccMessages`, `trainServices`…), and the endpoint of the
  Live Departure Board product of the Rail Data Marketplace.
- `jfparis/homeassistant_nationalrail` (Home Assistant) was looked at as an example of what users expect; it
  has no LICENSE file, so **none of its code was read for porting nor copied**.
- Runtime dependency: `@gladysassistant/integration-sdk` (Apache-2.0) and its dependency `ws` (MIT).

## Data

Train running information: **Darwin**, National Rail Enquiries, served by the Rail Data Marketplace (Rail
Delivery Group) under the terms each user accepts when subscribing to the product with their own key.
Attribution as asked by National Rail Enquiries: **Powered by National Rail Enquiries**. National Rail and
National Rail Enquiries are trade marks of their owners; this integration is not affiliated with them and does
not use their logos.
