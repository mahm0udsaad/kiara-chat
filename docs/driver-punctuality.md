# Driver punctuality

For each visit: when should the driver reach the specialist, when did the
client actually get reached, and — only when the visit was late — which stage
lost the time.

## What is planned

`driver_orders.arrival_at` is the appointment. The drive from the specialist's
saved pickup point to the client's pin is subtracted from it, together with the
pickup buffer (10 min), to give the time the driver should reach the
specialist. The driver's first GPS fix after accepting the ride adds the time
he should have set off.

The plan is recalculated if the appointment, the client pin or the specialist
changes, until the specialist is picked up; after that it is frozen.

Pins are read from Google Maps links (`?q=`, `query=`, `/@lat,lng`,
`!3d…!4d…`), bare `lat, lng`, and short `maps.app.goo.gl` / `goo.gl/maps`
links, which the server resolves with one redirect. Orders with only a text
address, or no pin at all, are not planned.

Specialist pickup points are set in the roster: paste a Maps link or
coordinates into "رابط خرائط Google لمقر الأخصائية".

## How a visit is judged

Evidence, best first:

| Milestone | GPS | Fallback |
|---|---|---|
| Driver reached specialist | within the 125 m fence | the driver's "arrived" tap |
| Client reached | within the 125 m fence | the service-start tap |

A fix whose accuracy is worse than the fence cannot trigger it.

1. Client reached within the 5-minute grace → **on time**. An early slip that
   was made up on the road is not a late visit and asks no one for a reason.
2. Late → blamed on the first stage that slipped: driver late to the
   specialist, specialist left late (beyond buffer + grace), or the drive to
   the client. The last is marked *uncertain* when it rests on the
   service-start tap, since the client may have kept the team waiting.
3. No evidence past the deadline → **uncertain**, with why (`missing_gps`,
   `stale_gps`, `missing_milestone`).

Late visits ask the driver or specialist for a reason and a note.

## New orders only

`punctuality_settings.tracking_starts_at` is stamped once by the migration.
Only orders **created** at or after it are planned, tracked or judged; visits
already running are untouched. Set it to `null` to switch the feature off, or
to a later time to start later.

## Driver GPS (Android)

After the driver accepts the ride, the app starts a foreground service (a
"كيارا — رحلة جارية" notification) that sends a fix every ~20 s while he
navigates in Google Maps. It uses the ordinary "while using the app"
permission. It stops when the server says the trip is over (client fence,
service start, cancellation, reassignment) or after 4 hours.

The service needs `expo-task-manager`, a native module: it only runs on
builds made from this change onward. Older builds (and iOS) fall back to a
watcher that runs while the order screen is open; the step-tap fallbacks keep
their verdicts meaningful either way. The JS checks for the native module
before loading it, so an OTA update cannot crash an older build.

Precise points live only in `driver_trip_locations`, behind RLS with no
`anon`/`authenticated` access. Field users see a summary, never raw points.

## Routing

Without `OSRM_BASE_URL`, drive times are straight-line distance × 1.25 at
28 km/h, labelled "تقدير احتياطي". To use real roads, run OSRM with
`infra/osrm/` on a private host and set `OSRM_BASE_URL`.

## Release order

1. Apply `20260919120000_punctuality_new_orders_only.sql` (the earlier
   `20260915120922` tables are already in production). This sets the start
   time — orders from that moment on are tracked.
2. Deploy the web/API.
3. Save pickup links for the specialists in the roster.
4. Build and install the new Android APK on drivers' phones.
