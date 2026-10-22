# Laafia API

Express + Prisma + PostgreSQL backend in `apps/api`. This is the contract the mobile app and web dashboard are written against.

## Run

```
cp apps/api/.env.example apps/api/.env      # set DATABASE_URL (Prisma needs a user: postgresql://<user>@localhost/laafia?host=/var/run/postgresql)
createdb laafia && createdb laafia_api_test
npm run db:migrate -w @laafia/api           # prisma migrate deploy (db:migrate:dev runs prisma migrate dev)
npm run seed -w @laafia/api                 # prints demo activation codes
npm run dev -w @laafia/api                  # http://localhost:4000
npm test -w @laafia/api                     # migrates TEST_DATABASE_URL (laafia_api_test) and clears its rows per test
DHIS2_PLAY=1 npm test -w @laafia/api        # also runs import and export against the public DHIS2 play demo
```

Configuration is validated at boot (`src/config/env.ts`). The server refuses to start without `DATABASE_URL`, and in production without `JWT_SECRET` (32+ chars), `ADMIN_TOKEN` and `SMS_WEBHOOK_TOKEN` (24+ chars). Secrets live only in `apps/api/.env`. Logs never contain secrets, SMS bodies or full phone numbers.

Demo activation codes (fixed, valid 7 days, single use; `npm run seed` resets them):

| Code | Device | Role | Facility |
| --- | --- | --- | --- |
| 26100001 | D001 | cho | SAV-CHPS-01 |
| 26100002 | V001 | volunteer | SAV-CHPS-01 |
| 26100003 | F001 | facility | SAV-CHPS-01 |
| 26100004 | F002 | facility | PTA-HC-01 |
| 26100005 | F003 | facility | SAV-HOSP-01 |

Seeded devices keep the deterministic `key_hex` from `generateSeed`, so phones and server agree offline. Seeded districts: `SAV` (Savelugu, facilities 1-3) and `TML` (Tamale, `TTH-HOSP-01`), both `languages: ["dag"]`.

## Conventions

- JSON in and out unless stated (uploads are `multipart/form-data`). Timestamps are epoch milliseconds (numbers). Booleans are `true`/`false` (push also accepts `0`/`1`). JSON columns (`capabilities`, `languages`, `prior_complications`, `risk_flags`, `danger_signs`, `answers`) are native JSON arrays/objects, not strings.
- Auth: devices send `Authorization: Bearer <jwt>`. The web dashboard and `/admin/*` send header `x-admin-token: <ADMIN_TOKEN>`. Credentials are never accepted in the query string; SSE uses a ticket (see `/events/ticket`).
- Errors, every route:

```json
{ "status": 401, "code": "deactivated", "message": "This device has been deactivated" }
```

Validation errors add `details: [{ "path": "records.0.table", "message": "..." }]`. `429` responses carry a `Retry-After` header (seconds).

| code | status | meaning |
| --- | --- | --- |
| `invalid_request` | 400 | body, query or form fields failed validation |
| `invalid_json` | 400 | body is not JSON |
| `invalid_upload` | 400 | malformed multipart upload |
| `invalid_code` | 400 | activation code unknown, used or expired |
| `audio_too_long` | 400 | voice clip over 10 s |
| `unauthenticated` | 401 | no token, or bad webhook token |
| `invalid_token` | 401 | bad or expired JWT; re-activate |
| `invalid_ticket` | 401 | SSE ticket missing, used or expired |
| `deactivated` | 401 | device deactivated: wipe local data (spec 18.2) |
| `forbidden` | 403 | role or facility not allowed |
| `device_mismatch` | 403 | push `device_id` differs from the token |
| `not_found` | 404 | unknown route, referral, facility, device, batch, template or pack |
| `conflict` | 409 | duplicate name/id/version, or batch in the wrong state |
| `batch_too_large` | 413 | more than 200 push records |
| `too_large` | 413 | upload or import over its limit |
| `unsupported_audio` | 415 | audio is not m4a or WAV (voice), or not m4a (clips) |
| `unsupported_file` | 415 | register upload is not CSV or XLSX |
| `rate_limited` | 429 | per-device limit hit (voice: 20 per hour) |
| `internal` | 500 | server bug |
| `khaya_error`, `dhis2_error` | 502 | upstream service failed |
| `khaya_unconfigured`, `dhis2_unconfigured` | 503 | server has no key / credentials for it |

## Device endpoints

### GET /health

`200 { "ok": true, "time": 1792628325516 }` (500 if the database is down). No auth.

### POST /auth/activate

No auth. Request:

```json
{ "activation_code": "26100001", "phone_number": "+233 24 000 0001", "device_info": { "model": "optional, any object" } }
```

`phone_number` is normalised to `0XXXXXXXXX` and stored; gateway status SMS (LFS) for this device's referrals go to it.

Response `200`:

```json
{
  "device_id": "D001",
  "device_key": "0101...01 (64 hex chars, 32 bytes)",
  "jwt": "eyJ...",
  "profile": {
    "device_id": "D001", "role": "cho", "user_name": "Abiba Sulemana", "phone_number": "0240000001",
    "facility": { "id": "fac-0001", "code": "SAV-CHPS-01", "name": "Kanshegu CHPS", "level": "chps", "phone": "0200000001",
                  "lat": 9.603, "lng": -0.805, "capabilities": [], "district_id": "dist-sav", "languages": ["dag"],
                  "updated_at": 1792628325516, "device_id": "seed", "deleted": false }
  },
  "keys": { "D001": "hex", "V001": "hex", "F001": "hex", "GW01": "hex" }
}
```

`keys` is the key directory, by device id, for verifying SMS:

- `facility`: every active device's key (to verify LFR from CHOs and volunteers, and onward LFR from other facilities);
- `cho`: the facility devices of its district plus the gateway `GW01` (to verify LFS);
- `volunteer`: no `keys` field. Volunteers carry scanned referrals unverified; the receiving facility verifies them.

Activating a `facility` device also sets its facility's `phone` to this `phone_number` (the most recent facility activation wins); phones receive the updated facility row on their next pull. Then run the first sync: `GET /sync/pull` without `since`.

### POST /auth/refresh

Header `Authorization: Bearer <current or expired jwt>`. No body. Tokens live 30 days; refresh accepts a token up to 60 days past expiry. Response `200 { "jwt": "eyJ..." }`. A deactivated device gets `401 deactivated`.

### POST /sync/push

Request (at most 200 records):

```json
{
  "device_id": "D001",
  "records": [
    { "table": "households", "row": { "id": "...", "updated_at": 1792628325516, "...": "..." } },
    { "table": "referral_events", "row": { "...": "..." } }
  ]
}
```

`device_id` is optional; if present it must match the token. Records are applied in order, each independently (one savepoint per row).

Response `200`:

```json
{ "accepted": ["id1", "id2"], "rejected": [{ "id": "id3", "table": "clients", "reason": "invalid: type Invalid option" }] }
```

- Set `synced = 1` for every accepted id. Accepted includes no-ops (an older or equal `updated_at` than the server's copy), so pushing the same batch twice is safe.
- Rejected reasons:
  - `unknown_referral`: an event for a referral the server has not seen, from a device that is not its origin, or an onward referral whose `parent_referral_id` the server has not seen. **Keep the row pending and retry on the next sync** (it succeeds once the referral has arrived by any path).
  - `server_error`: retry later.
  - `unknown_table`, `invalid: <field> <message>`, `forbidden`, `key_mismatch` (a referral id already bound to a different `(origin_device_id, short_id)`): permanent, mark the row `sync_error`.
- Rows are last-writer-wins on `id` by `updated_at` (strictly greater wins). Send full rows: a missing nullable field is stored as `null`.
- Pushable tables: `households`, `clients`, `visits`, `referrals`, `referral_events`, `transport_providers`, `transport_requests`. `facilities` and `devices` are server-owned (pull only). Unknown keys (e.g. `synced`) are ignored. The server stamps `facility_id` from the pushing device on insert; a row belonging to another facility is `forbidden`.
- Referral authority:
  - A new referral (or a stub created by an event) is accepted only from its `origin_device_id`. Another device (a volunteer carrying a QR referral, a facility that received it by SMS) must include `lfr`: the origin's signed LFR string for the same `(origin_device_id, short_id)`.
  - Updates to a referral and new events are accepted from the origin device, a device of the current destination facility, or a facility device whose facility already wrote an event on it (an earlier hop, e.g. after refer onward). The origin's own catchment facility alone is not enough.
  - Refer onward: the facility creates a new referral (its own device as `origin_device_id`, a new `short_id`, signed with its key) with `parent_referral_id` set to the referral it continues. It must be allowed to act on that parent (`forbidden` otherwise). The parent link cannot be changed later.
  - A referral pushed to a facility with no device in facility mode is acknowledged by the server: it adds the `received` event and texts `LFS ... R` to the origin phone.

### GET /sync/pull?since=<cursor>&limit=<n>

`since`: the opaque `cursor` string from the previous pull; omit it (or send empty) for the first sync. `limit` defaults to 500 (max 1000).

Response `200`:

```json
{
  "records": [ { "table": "clients", "row": { "id": "cl-0001", "...": "..." } } ],
  "cursor": "1834.1790",
  "more": false,
  "keys": { "D001": "hex" }
}
```

- Store `cursor` after every page (it is a string; do not parse it). While `more` is `true`, pull again with the new cursor. A first sync can stop at any page and resume later with the last stored cursor.
- Records are ordered by a server sequence. Upsert each by `id` (referrals: see the merge rule below). A row with `deleted: true` is deleted locally.
- The first sync is lean; it sends only:
  - `facilities`: every facility in the device's district (destinations).
  - `devices`: devices of facilities in the district (names and phones for referral cards; never keys).
  - `clients` of the device's facility that are active: pregnant; postpartum up to 42 days after delivery; newborn and child under 60 months; or with an open referral, or whose latest visit has a `followup_due`.
  - `visits` from the last 12 months of those clients; `households` that have an active client or no clients yet.
  - `referrals` from or to the device's facility that are open or had an event in the last 30 days, and their `referral_events`.
  - active `transport_providers`; `transport_requests` that are `requested` or `coming`.
- After the first sync, every change in the catchment is sent, active or not (including soft deletes from an undone import).
- `keys` is the device's full current key directory (same rules as at activation; absent for volunteers): replace the local one, which drops deactivated devices.

### GET /content/manifest

Device JWT. The district map tiles this device should hold (latest version), and the languages of its facility and district (plus `en`), which name the clip sets to fetch.

```json
{
  "languages": ["dag", "en"],
  "packs": [
    { "id": "uuid", "kind": "tiles", "language": null, "district_code": "SAV", "version": 1, "size": 41234567,
      "sha256": "hex", "content_type": "application/vnd.pmtiles", "url": "/content/packs/uuid", "created_at": 1792628325516 }
  ]
}
```

Download when the local `(district, version)` differs. Verify `sha256` after download.

### GET /content/packs/:id

Device JWT. Streams the file. Supports `Range: bytes=<start>-<end>` (answers `206` with `Content-Range`), so the phone downloads tiles in 1 MB ranges and resumes after an interruption. Also sends `ETag`, `Last-Modified` and `X-Content-SHA256`.

### POST /content/clips

Device JWT, role `cho` or `facility`. Records one prompt clip (the app's Dagbani recorder). `multipart/form-data`: file field `audio` (m4a/AAC, at most 300 KB), fields `prompt_id` (`^[a-z0-9_]{1,64}$`, e.g. `yi_feeding`) and `lang` (`^[a-z]{2,3}$`, e.g. `dag`).

Response `201 { "id": "uuid", "sha256": "hex", "size": 18234 }`. The newest recording per `(lang, prompt_id)` replaces the previous one (new `id`, the old file is removed). `415 unsupported_audio` if the file is not m4a; `413 too_large` over 300 KB.

### GET /content/clips?lang=<code>

Device JWT. The current clip per prompt (all languages when `lang` is omitted):

```json
{ "clips": [{ "id": "uuid", "prompt_id": "yi_feeding", "lang": "dag", "sha256": "hex", "size": 18234, "recorded_at": 1792628325516, "url": "/content/clips/uuid/file" }] }
```

Fetch a clip when its `sha256` differs from the local copy.

### GET /content/clips/:id/file

Device JWT. Streams the clip (`audio/mp4`), with `Range` support and `X-Content-SHA256`.

### POST /voice/transcribe?lang=<code>

Device JWT. `multipart/form-data` with file field `audio`: m4a/AAC (what Android's recorder produces) or WAV (PCM), at most 500 KB and 10 s. m4a is decoded server-side to 16 kHz mono PCM WAV (ffmpeg) and the 10 s limit is checked on the decoded audio. `lang` (query or form field) is a Khaya ASR code, default `dag`; accepted: `dag eng twi atw fat ewe gaa gur gjn dga kus maw bwu xsm hau nzi ada wlx xon_likoonli xon_likpakpaanl`. Rate limit 20 per device per hour.

Response `200 { "text": "...", "language": "dag", "seconds": 3.2 }`. The server calls Khaya ASR v3 (`POST /asr/v3/transcribe`) with its own key; the key never reaches the phone. The transcript never affects the rules engine.

### Transport (device JWT)

Providers are the same rows as the `transport_providers` sync table (a pushed row is also fine); these endpoints let a phone register and edit them directly. Rows are scoped to the device's facility.

- `GET /transport/providers` → `{ "providers": [transport_providers row] }`, by name.
- `POST /transport/providers` (role `cho` or `facility`) `{ "id"?: "uuid", "name": "Fuseini Abukari", "phone": "0240000101", "vehicle"?: "tricycle", "community"?: "Kanshegu", "active"?: true }` → `201 { "provider": row }`. `phone` is normalised to `0XXXXXXXXX`.
- `PATCH /transport/providers/:id` (role `cho` or `facility`) with any of those fields → `{ "provider": row }`; `404` outside the device's facility.
- `POST /transport/requests` (role `cho`) `{ "id"?: "uuid", "referral_id": "uuid", "provider_id": "tp-0001", "scheduled_for"?: 1792628325516 }` → `201 { "transport_request": transport_requests row }` with `status: "requested"`. The server texts the driver the pickup message (core `transportRequestText`: urgency, household landmark and map link, destination, CHO phone, reply 1/2, referral short id). A scheduled pickup is texted 18 h before `scheduled_for`. The driver's reply to the gateway sets `coming` or `declined`. `404` for an unknown referral or provider.

## Facility and web inbox

### GET /referrals?facility=<code>

Facility device (own facility only) or admin token. Response `200 { "referrals": [ReferralView] }`, open first by urgency, max 200. `ReferralView` is a `referrals` row plus `events: [referral_events row]` ordered by `at`.

### GET /referrals/:id

Any device on the chain (origin device, or a device whose facility is a referral's origin catchment or destination) or the admin token; `404` otherwise. Returns the referral and its refer-onward chain, root first:

```json
{ "referral": ReferralView, "chain": [ReferralView, ReferralView] }
```

A parent shows its latest onward hop in `onward_referral_id` and `onward_status`.

### POST /referrals/:id/status

Facility device allowed to act on the referral (see referral authority) or admin token (web inbox).

```json
{ "status": "received" | "arrived" | "treated" | "closed" | "cancelled" }
```

Writes a `referral_events` row (`via: "https"`, `source_device_id`: the device id, or `"WEB"` for the admin token), recomputes status, publishes to SSE, and queues an `LFS` SMS to the origin device's phone (none for `cancelled`). Response `200 { "referral": ReferralView }`. Status only moves forward: a `received` after `treated` is recorded but `status` stays `treated`.

### POST /events/ticket

Facility device (own facility only) or admin token. Request `{ "facility": "SAV-HOSP-01" }`. Response `200 { "ticket": "base64url", "expires_at": 1792628385516 }`. The ticket is single use, valid 60 s, bound to that facility.

### GET /events?ticket=<ticket>

Server-sent events (`new EventSource('/events?ticket=...')`). Get a fresh ticket for every (re)connect. Events:

```
event: ready
data: {"facility":"SAV-HOSP-01"}

event: referral
data: <ReferralView JSON>
```

`referral` fires after any change to a referral from or to that facility (push, SMS, status button). A `: ping` comment every 25 s keeps proxies open. Load the initial list with `GET /referrals`.

## SMS gateway

The server gateway is Frog by Wigal, and it is the fallback path: phones text each other from their own SIMs. The server sends SMS only for:

- `LFS` status from the web inbox (`POST /referrals/:id/status`);
- the `LFS ... R` acknowledgement for a referral that reaches a facility by HTTPS push or inbound SMS while that facility has no active device in facility mode (the server records the `received` event for it);
- driver messages when a CHO requests transport online (`POST /transport/requests`).

Outgoing SMS go through a `jobs` table (retry at 30 s, 2 min, 10 min, then hourly; failed after 8 attempts) to Frog `POST https://frogapi.wigal.com.gh/api/v3/sms/send` with `API-KEY` / `USERNAME` headers. Each send carries `msgid` `LF_<job id>_<ms>`. Without `FROG_API_KEY`, `FROG_USERNAME` and `FROG_SENDER_ID` the message is only logged (masked number and length, never the body).

### POST /sms/delivery

Frog delivery receipts. Guarded by `SMS_CALLBACK_SECRET` (header `x-callback-token`, or `?token=` in the callback URL configured at Frog), compared in constant time; fails closed (`401`) when the secret is unset. Body: a JSON array of receipts, or an object keyed by index:

```json
[{ "msgid": "LF_42_1792628325516", "status": "DELIVRD", "reason": "Delivered", "destination": "233240000001", "statusdate": "2026-10-22 10:00:00" }]
```

Each receipt is validated on its own; malformed or unknown ones are skipped. Always `200 { "received": 3, "applied": 1 }`. `DELIVRD`/`ANSWERED` mark the job delivered; `UNDELIV`, `REJECTD`, `FAILED`, `EXPIRED`, `DELETED`, `UNKNOWN` failed; `ACCEPTD`, `WAITING`, `BUSY` pending.

### POST /sms/inbound

Frog has no inbound (mobile-originated) SMS in the house integration, so this endpoint is provider-neutral: anything that forwards a received SMS can post to it. Guarded by `SMS_WEBHOOK_TOKEN` (header `x-webhook-token` or `?token=`), compared in constant time. Required in production; open only in development when unset.

Body `{ "from": "+233240000001", "text": "LFR|1|..." }` (also accepts `sender` / `message`, JSON or form-encoded). Always `200` unless the token is wrong (`401`):

```json
{ "ok": true, "kind": "referral", "referral_id": "uuid", "duplicate": false }
{ "ok": true, "kind": "status", "referral_id": "uuid", "status": "arrived" }
{ "ok": true, "kind": "driver_reply", "transport_request_id": "...", "status": "coming" }
{ "ok": false, "error": "not_laafia" | "unknown_signer" | "bad_signature" | "conflict" | "forbidden" }
```

- Verified with `packages/core` `decode`, key looked up by the `signer` device id (never the sender number). Deactivated devices are `unknown_signer`.
- `LFR`: upserts the referral by `(signer, short_id)`. If the destination has no phone in facility mode, the server adds the `received` event and replies `LFS ... R` to the sender, signed by the gateway device `GW01`. A repeat of the same content is a confirmation (`duplicate: true`, ack resent); different content for the same key is `conflict`.
- `LFS`: applied with the signer's authority: the signer must be an active device that may act on the referral (its origin, the current destination facility, or an earlier hop), else `forbidden`. An LFS for a referral the server has not seen is `forbidden` (no stub).
- Anything else from a number with a `requested` transport request: a leading `1`/`2` sets it to `coming`/`declined`.

## Admin (header `x-admin-token`)

### Devices

- `GET /admin/devices` → `{ "devices": [{ "id", "role", "user_name", "phone_number", "facility_id", "active", "activated_at", "updated_at", "device_id", "deleted" }] }`
- `POST /admin/devices` `{ "role": "cho"|"volunteer"|"facility", "user_name": "...", "facility_code": "SAV-CHPS-01", "phone_number"?: "...", "id"?: "D002" }` → `201 { "device": {...}, "activation_code": "12345678", "expires_at": 1792801125516 }` (48 h).
- `POST /admin/devices/:id/deactivate` → `{ "device": {...} }`. Its next request gets `401 deactivated`; facility phones drop its key on their next pull; its SMS become `unknown_signer`.

### Content

- `POST /admin/content/packs`, `multipart/form-data`: file field `file` (max 1 GB), fields `kind` (`tiles`), `district_code` (e.g. `SAV`), optional `version` (default: latest + 1). The server computes size and sha256. → `201 { "pack": Pack }` (shape as in the manifest). `409` if that version exists. Audio is not a pack; it travels as clips.
- `GET /admin/content/packs` → `{ "packs": [Pack] }`, newest first.
- `GET /admin/content/clips` → `{ "clips": [Clip & { "device_id": "D001" }] }`, newest first.
- `DELETE /admin/content/clips/:id` → `{ "deleted": "uuid" }`; `404` if unknown.

### DHIS2 export (spec 17)

- `GET /export/dhis2?facility=<code>&period=YYYYMM` → `{ "tracker": { "trackedEntities": [...] }, "dataValueSet": {...} }`. Built by a pure function (`apps/api/src/modules/dhis2/dhis2.export.ts`) with the mapping in `docs/dhis2-mapping.json` (override with `DHIS2_MAPPING_FILE`). Each client with a visit or referral in the month becomes a tracked entity (attributes: first name, last name, sex, client code; UID from `dhis2_uid` or derived from the client id), enrolled in the program for its type, with one event per visit and per referral (a summary data element). UIDs are derived from Laafia ids, so re-exporting updates instead of duplicating. The `dataValueSet` holds the month's ANC contacts, PNC visits within 48 h of delivery, referrals made and referrals completed (treated or closed). `400` for a bad period or a facility with no mapped orgUnit.
- `POST /export/dhis2` `{ "facility": "SAV-CHPS-01", "period": "202610", "dry_run"?: true }` pushes to `DHIS2_BASE_URL` (`POST /api/tracker` and `POST /api/dataValueSets` with `importStrategy=CREATE_AND_UPDATE` and DHIS2's own `dryRun`, default true, so nothing is written there):

```json
{ "dry_run": true, "tracked_entities": 28,
  "tracker": { "status": "OK", "stats": { "created": 0, "updated": 84, "ignored": 0, "total": 84 }, "errors": [] },
  "aggregate": { "status": "SUCCESS", "import_count": { "imported": 0, "updated": 4, "ignored": 0 }, "conflicts": [] } }
```

`503 dhis2_unconfigured` without credentials; `502 dhis2_error` if DHIS2 cannot be reached.

### Register import

Flow: create a mapping template once per national register form → upload a file (or pull from DHIS2) to get a **preview batch** (dry run, nothing written) → show counts, errors and duplicates → **commit** (one transaction) → optionally **undo**.

Target fields a template can fill:

| field | notes |
| --- | --- |
| `name` | required |
| `type` | required: `pregnant`/`anc`/`pw`, `postpartum`/`pnc`/`pp`, `newborn`/`nb`, `child`/`cwc`/`ch`/`under5` (case-insensitive). Usually a constant per register. |
| `community` | required |
| `head_name` | household head; defaults to the client's name |
| `household_ref` | register household number; rows sharing it form one household |
| `landmark`, `lat`, `lng` | |
| `sex` | `f`/`female`/`girl`, `m`/`male`/`boy` |
| `dob`, `edd`, `delivery_date` | `15/02/2027` (day first), `2027-02-15`, Excel dates or serials. `edd` required for pregnant, `delivery_date` for postpartum, `dob` for newborn and child. |
| `parity` | integer |
| `nhis_active` | `yes`/`y`/`true`/`1`/`active` is true, anything else false |
| `dhis2_uid` | DHIS2 sources default it to the tracked entity UID |

Households are matched by `household_ref` within the file, else by community + head name (also against existing households of the facility). Duplicates: same DHIS2 UID as an existing client; else same name + dob + household as an existing client of the facility; else the same person earlier in the file. Imported clients get codes `RG-0001`, `RG-0002`, ... (a prefix phones never generate).

#### POST /admin/import/templates

```json
{
  "name": "GHS ANC register",
  "source": "tabular",
  "mapping": { "name": "Client Name", "community": "Community", "head_name": "Household Head", "edd": "EDD", "parity": "Parity", "nhis_active": "NHIS", "sex": "Sex" },
  "constants": { "type": "pregnant" }
}
```

`source`: `tabular` (CSV and XLSX) or `dhis2`. `mapping`: target field → source column header (matched case-insensitively) or, for DHIS2, attribute UID or display name. `"First name+Last name"` joins several columns with a space. DHIS2 records also expose `@trackedEntity`, `@orgUnit` and `@enrolledAt` (first enrollment date). `constants`: target field → fixed value, used when the mapping gives nothing. → `201 { "template": { "id", "name", "source", "mapping", "constants", "created_at" } }`; `409` if the name exists.

#### GET /admin/import/templates

→ `{ "templates": [Template] }`

#### POST /admin/import/preview

`multipart/form-data`: file field `file` (`.csv` or `.xlsx`, max 10 MB, 20,000 rows; first row is the header; first sheet for XLSX), fields `template_id` (tabular template), `facility_code`. → `201 { "batch": Batch }`.

#### POST /admin/import/dhis2/preview

```json
{ "template_id": "uuid", "facility_code": "SAV-CHPS-01", "org_unit": "DiszpKrYNg8", "program": "IpHINAT79UW", "tracked_entity_type": "optional", "max_pages": 50 }
```

Pulls `GET {DHIS2_BASE_URL}/api/tracker/trackedEntities?orgUnits=...&program=...` (2.41+ Tracker API, 200 per page, basic auth from `DHIS2_USERNAME` / `DHIS2_PASSWORD`) and runs the same pipeline. Give `program` or `tracked_entity_type`. → `201 { "batch": Batch }`; `503 dhis2_unconfigured` without credentials; `502 dhis2_error` if DHIS2 fails.

#### Batch

```json
{
  "id": "uuid", "facility_id": "fac-0001", "template_id": "uuid", "source": "csv" | "xlsx" | "dhis2", "filename": "anc.csv",
  "status": "preview" | "committed" | "undone",
  "counts": { "rows": 6, "valid": 2, "errors": 2, "duplicates": 2, "households": 2,
              "clients_created": 2, "households_created": 2, "duplicates_at_commit": 0 },
  "issues": [
    { "row": 3, "kind": "error", "field": "name", "message": "required" },
    { "row": 5, "kind": "duplicate", "message": "same person as row 1 in this file" },
    { "row": 6, "kind": "duplicate", "message": "same name, date of birth and household as an existing client", "match_id": "cl-0004" }
  ],
  "sample": [
    { "row": 1,
      "household": { "key": "kanshegu|mba iddrisu", "community": "Kanshegu", "head_name": "Mba Iddrisu", "landmark": "near the borehole", "lat": null, "lng": null },
      "client": { "name": "Asana Iddrisu", "type": "pregnant", "sex": "f", "dob": null, "edd": 1802649600000, "delivery_date": null, "parity": 1, "nhis_active": true, "dhis2_uid": null } }
  ],
  "created_at": 1792628325516, "committed_at": null, "undone_at": null
}
```

`row` is the 1-based data row (the header is not counted). `valid` rows are what commit will write; `sample` is the first 20 of them. The `*_created` and `duplicates_at_commit` counts appear after commit. `issues` holds at most 2,000 entries.

#### GET /admin/import/batches?facility=<code>

→ `{ "batches": [Batch without issues and sample] }`, newest first, max 100.

#### GET /admin/import/batches/:id

→ `{ "batch": Batch }`

#### POST /admin/import/batches/:id/commit

Only from `preview` (else `409`). Re-checks duplicates, writes all households and clients in one transaction. → `{ "batch": Batch }`. Phones receive the new rows on their next pull.

#### POST /admin/import/batches/:id/undo

Only from `committed` (else `409`). Soft-deletes the clients and households the batch created, except rows edited since the import and households that gained other clients. → `{ "batch": Batch, "undone": { "clients": 2, "households": 2 }, "kept": { "clients": 0, "households": 0 } }`. Phones receive the deletes on their next pull.

## Sync row format

Every row has the sync columns:

| field | type | notes |
| --- | --- | --- |
| `id` | string (≤64) | UUID v4 for phone-made rows; seed rows use `hh-0001` style ids |
| `updated_at` | int ms | LWW clock, set by the writer |
| `device_id` | string or null | last writer; defaults to the pushing device (`import` for imported rows) |
| `deleted` | boolean | soft delete |

Pulled rows also carry `facility_id` (the catchment, server-set; ignored on push). `seq` is never sent. `?` marks nullable fields; send `null` (or omit) for them.

**facilities** (pull only): `code`, `name`, `level` (`chps`|`health_centre`|`hospital`), `phone?`, `lat`, `lng`, `capabilities: string[]`, `district_id?`, `languages: string[]`

**devices** (pull only): `role` (`cho`|`volunteer`|`facility`|`gateway`), `user_name`, `phone_number?`, `facility_id?`, `active: boolean`, `activated_at?`. Used to show the origin CHO's name and phone on a referral card.

**households**: `community`, `head_name`, `landmark` (default `""`), `lat?`, `lng?`, `consent_at?`

**clients**: `household_id`, `code` (e.g. `CL-0417`; imported: `RG-0001`), `type` (`pregnant`|`postpartum`|`newborn`|`child`), `name`, `sex?` (`f`|`m`), `dob?`, `edd?`, `delivery_date?`, `parity?`, `prior_complications: string[]`, `birth_weight_g?`, `nhis_active: boolean`, `risk_flags: string[]`. Pulled rows also carry `dhis2_uid?` (server-owned; a push never changes it).

**visits**: `client_id`, `protocol_id`, `visited_at`, `answers: object`, `outcome` (`routine`|`followup`|`refer`), `rule_id`, `followup_due?`, `notes?`, `muac_mm?`

**referrals**: `origin_device_id` (device id that created and signed it, `^[A-Z0-9]{2,8}$`), `short_id` (8 base32 chars from `shortIdFromBytes`), `client_id?`, `visit_id?`, `client_code?`, `client_type?` (full name, e.g. `newborn`), `context?` (e.g. `PP3`), `urgency?` (1-3), `danger_signs: string[]` (sign names, e.g. `["bleeding"]`), `destination_facility_id?`, `next_of_kin?`, `delivered_via?` (`sms`|`qr`|`https`), `parent_referral_id?` (refer onward: the referral this one continues), on pull only `onward_referral_id?` and `onward_status?` (latest onward hop, server-maintained), push only: `lfr?` (origin's signed LFR, required when the pusher is not the origin and the server has not seen the referral; not stored), and on pull `status`.

- `status` is ignored on push. The server derives it from `referral_events` with core `deriveStatus` (forward only). Push the events.
- Identity is `(origin_device_id, short_id)`. **Phones must upsert pulled referrals by that pair, not only by `id`**, and adopt the pulled `id`: a referral the server first saw by SMS has a server UUID until the origin phone pushes its own row, at which point the server re-keys it to the origin phone's `id` (its events follow). A facility phone that created a local row from an SMS receives the canonical `id` on pull.

**referral_events** (append-only): `referral_id`, `origin_device_id`, `short_id` (the referral's key, so the server can find it even if it knows it under another id), `status` (`created`|`carrying`|`sent`|`received`|`arrived`|`treated`|`closed`|`cancelled`), `at`, `source_device_id`, `via` (`sms`|`qr`|`https`|`local`). Pulled events carry the server's canonical `referral_id` and do not include `origin_device_id` / `short_id`.

**transport_providers**: `name`, `phone`, `vehicle` (default `""`), `community` (default `""`), `active: boolean`

**transport_requests**: `referral_id?`, `provider_id`, `status` (`requested`|`coming`|`declined`|`done`), `scheduled_for?`. Driver SMS replies to the gateway update `status`.

Not synced (phone-local): `risk_scores`, `outbox`, `inbox`, `audio_prompts`.

## Not built

- SSE tickets and the rate limits are held in memory, so they assume one API process.
