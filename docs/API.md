# Laafia API

Express + Drizzle + PostgreSQL backend in `apps/api`. This is the contract the mobile app and web inbox are written against.

## Run

```
cp apps/api/.env.example apps/api/.env      # defaults work with a local socket Postgres
createdb laafia && createdb laafia_test
npm run db:migrate -w @laafia/api
npm run seed -w @laafia/api                 # prints demo activation codes
npm run dev -w @laafia/api                  # http://localhost:4000
npm test -w @laafia/api                     # uses TEST_DATABASE_URL (laafia_test), truncates it
```

Demo activation codes (fixed, valid 7 days, single use; `npm run seed` resets them):

| Code | Device | Role | Facility |
| --- | --- | --- | --- |
| 26100001 | D001 | cho | SAV-CHPS-01 |
| 26100002 | V001 | volunteer | SAV-CHPS-01 |
| 26100003 | F001 | facility | SAV-CHPS-01 |
| 26100004 | F002 | facility | PTA-HC-01 |
| 26100005 | F003 | facility | SAV-HOSP-01 |

Seeded devices keep the deterministic `key_hex` from `generateSeed`, so phones and server agree offline.

## Conventions

- JSON in and out. Timestamps are epoch milliseconds (numbers). Booleans are `true`/`false` (push also accepts `0`/`1`). JSON columns (`capabilities`, `prior_complications`, `risk_flags`, `danger_signs`, `answers`) are native JSON arrays/objects, not strings.
- Auth: `Authorization: Bearer <jwt>` for devices. Admin and web inbox: header `x-admin-token: <ADMIN_TOKEN>`. Where a header cannot be set (EventSource), pass either as `?token=`.
- Errors, every route:

```json
{ "status": 401, "code": "deactivated", "message": "This device has been deactivated" }
```

Validation errors add `details: [{ "path": "records.0.table", "message": "..." }]`.

| code | status | meaning |
| --- | --- | --- |
| `invalid_request` | 400 | body or query failed validation |
| `invalid_json` | 400 | body is not JSON |
| `invalid_code` | 400 | activation code unknown, used or expired |
| `unauthenticated` | 401 | no token |
| `invalid_token` | 401 | bad or expired JWT; re-activate |
| `deactivated` | 401 | device deactivated: wipe local data (spec 18.2) |
| `forbidden` | 403 | role or facility not allowed |
| `device_mismatch` | 403 | push `device_id` differs from the token |
| `not_found` | 404 | unknown route, referral, facility or device |
| `conflict` | 409 | admin: device id exists |
| `batch_too_large` | 413 | more than 200 push records |
| `internal` | 500 | server bug |

## Endpoints

### GET /health

`200 { "ok": true, "time": 1792628325516 }` (fails with 500 if the database is down).

### POST /auth/activate

Request:

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
                  "lat": 9.603, "lng": -0.805, "capabilities": [], "updated_at": 1792628325516, "device_id": "seed", "deleted": false }
  },
  "keys": { "D001": "hex", "V001": "hex", "F001": "hex", "GW01": "hex" }
}
```

`keys` is present only for `role: "facility"`: the HMAC keys of every active device, by device id, for verifying LFR/LFS. Other roles get no `keys` field (they only hold their own `device_key`). The initial catchment data comes from `GET /sync/pull?since=0`.

### POST /auth/refresh

Header `Authorization: Bearer <current or expired jwt>`. No body. Tokens live 30 days; refresh accepts a token up to 60 days past expiry.
Response `200 { "jwt": "eyJ..." }`. A deactivated device gets `401 deactivated`.

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

`device_id` is optional; if present it must match the token. Records are applied in order, each independently.

Response `200`:

```json
{ "accepted": ["id1", "id2"], "rejected": [{ "id": "id3", "table": "clients", "reason": "invalid: type Invalid option" }] }
```

- Set `synced = 1` for every accepted id. Accepted includes no-ops (an older or equal `updated_at` than the server's copy), so pushing the same batch twice is safe.
- Rejected reasons: `unknown_table`, `invalid: <field> <message>`, `forbidden` (row belongs to another catchment), `key_mismatch` (a referral id already bound to a different `(origin_device_id, short_id)`), `server_error`. Mark those rows `sync_error`; retrying will not help except for `server_error`.
- Rows are last-writer-wins on `id` by `updated_at` (strictly greater wins). Send full rows: a missing nullable field is stored as `null`.
- Pushable tables: `households`, `clients`, `visits`, `referrals`, `referral_events`, `transport_providers`, `transport_requests`. `facilities` and `devices` are server-owned (pull only). Unknown keys in a row (e.g. `synced`) are ignored. The server stamps `facility_id` from the pushing device on insert.

### GET /sync/pull?since=<cursor>&limit=<n>

`since` defaults to `0` (everything), `limit` defaults to 500 (max 1000).

Response `200`:

```json
{
  "records": [ { "table": "clients", "row": { "id": "cl-0001", "...": "..." } } ],
  "cursor": 1834,
  "more": false,
  "keys": { "D001": "hex" }
}
```

- `cursor` is a server sequence number, not a time. Store it and send it back as `since`. While `more` is `true`, pull again immediately with the new cursor.
- Records are ordered by the server sequence. Upsert each by `id` (referrals: see the merge rule below). A row with `deleted: true` is deleted locally.
- Scope: `facilities` and `devices` (all, without keys); `households`, `clients`, `visits`, `transport_providers`, `transport_requests` of the device's facility; `referrals` from or to the device's facility, and their `referral_events`.
- `keys` (facility devices only) is the full current key registry: replace the local one, which drops deactivated devices.

### GET /referrals?facility=<code>

Facility device (own facility only) or admin token. Response `200 { "referrals": [ReferralView] }`, open first by urgency, max 200. `ReferralView` is a `referrals` row plus `events: [referral_events row]` ordered by `at`.

### POST /referrals/:id/status

Facility device (referrals from or to its facility) or admin token (web inbox).

```json
{ "status": "received" | "arrived" | "treated" | "closed" | "cancelled" }
```

Writes a `referral_events` row (`via: "https"`, `source_device_id`: the device id, or `"WEB"` for the admin token), recomputes status, publishes to SSE, and queues an `LFS` SMS to the origin device's phone (none for `cancelled`). Response `200 { "referral": ReferralView }`. Status only moves forward: a `received` after `treated` is recorded but `status` stays `treated`.

### GET /events?facility=<code>&token=<jwt or admin token>

Server-sent events. Events:

```
event: ready
data: {"facility":"SAV-HOSP-01"}

event: referral
data: <ReferralView JSON>
```

`referral` fires after any change to a referral from or to that facility (push, SMS, status button). A `: ping` comment every 25 s keeps proxies open. Load the initial list with `GET /referrals`.

### POST /sms/inbound[?token=<SMS_WEBHOOK_TOKEN>]

Gateway webhook. Body `{ "from": "+233240000001", "text": "LFR|1|..." }` (also accepts `sender` / `message`, JSON or form-encoded). Always `200` unless the token is wrong (`401`):

```json
{ "ok": true, "kind": "referral", "referral_id": "uuid", "duplicate": false }
{ "ok": true, "kind": "status", "referral_id": "uuid", "status": "arrived" }
{ "ok": true, "kind": "driver_reply", "transport_request_id": "...", "status": "coming" }
{ "ok": false, "error": "not_laafia" | "unknown_signer" | "bad_signature" | "conflict" }
```

- Verified with `packages/core` `decode`, key looked up by the `signer` device id (never the sender number). Deactivated devices are `unknown_signer`.
- `LFR`: upserts the referral by `(signer, short_id)`, adds a `received` event, and replies `LFS ... R` to the sender, signed by the destination facility's phone key (else the gateway device `GW01`). A repeat of the same content is a confirmation (`duplicate: true`, ack resent); different content for the same key is `conflict`.
- `LFS`: adds the event for `(origin, short_id)`. An LFS for an unknown referral creates a stub row that the later push fills in.
- Anything else from a number with a `requested` transport request: a leading `1`/`2` sets it to `coming`/`declined`.

### Admin (header `x-admin-token`)

- `GET /admin/devices` → `{ "devices": [{ "id", "role", "user_name", "phone_number", "facility_id", "active", "activated_at", "updated_at", "device_id", "deleted" }] }`
- `POST /admin/devices` `{ "role": "cho"|"volunteer"|"facility", "user_name": "...", "facility_code": "SAV-CHPS-01", "phone_number"?: "...", "id"?: "D002" }` → `201 { "device": {...}, "activation_code": "12345678", "expires_at": 1792801125516 }` (48 h).
- `POST /admin/devices/:id/deactivate` → `{ "device": {...} }`. Its next request gets `401 deactivated`; facility phones drop its key on their next pull; its SMS become `unknown_signer`.

## Sync row format

Every row has the sync columns:

| field | type | notes |
| --- | --- | --- |
| `id` | string (≤64) | UUID v4 for phone-made rows; seed rows use `hh-0001` style ids |
| `updated_at` | int ms | LWW clock, set by the writer |
| `device_id` | string or null | last writer; defaults to the pushing device |
| `deleted` | boolean | soft delete |

Pulled rows also carry `facility_id` (the catchment, server-set; ignored on push). `seq` is never sent. `?` marks nullable fields; send `null` (or omit) for them.

**facilities** (pull only): `code`, `name`, `level` (`chps`|`health_centre`|`hospital`), `phone?`, `lat`, `lng`, `capabilities: string[]`

**devices** (pull only): `role` (`cho`|`volunteer`|`facility`|`gateway`), `user_name`, `phone_number?`, `facility_id?`, `active: boolean`, `activated_at?`. Used to show the origin CHO's name and phone on a referral card.

**households**: `community`, `head_name`, `landmark` (default `""`), `lat?`, `lng?`, `consent_at?`

**clients**: `household_id`, `code` (e.g. `CL-0417`), `type` (`pregnant`|`postpartum`|`newborn`|`child`), `name`, `sex?` (`f`|`m`), `dob?`, `edd?`, `delivery_date?`, `parity?`, `prior_complications: string[]`, `birth_weight_g?`, `nhis_active: boolean`, `risk_flags: string[]`

**visits**: `client_id`, `protocol_id`, `visited_at`, `answers: object`, `outcome` (`routine`|`followup`|`refer`), `rule_id`, `followup_due?`, `notes?`, `muac_mm?`

**referrals**: `origin_device_id` (device id that created and signed it, `^[A-Z0-9]{2,8}$`), `short_id` (8 base32 chars from `shortIdFromBytes`), `client_id?`, `visit_id?`, `client_code?`, `client_type?` (full name, e.g. `newborn`), `context?` (e.g. `PP3`), `urgency?` (1-3), `danger_signs: string[]` (sign names, e.g. `["bleeding"]`), `destination_facility_id?`, `next_of_kin?`, `delivered_via?` (`sms`|`qr`|`https`), and on pull `status`.

- `status` is ignored on push. The server derives it from `referral_events` with core `deriveStatus` (forward only). Push the events.
- Identity is `(origin_device_id, short_id)`. **Phones must upsert pulled referrals by that pair, not only by `id`**, and adopt the pulled `id`: a referral the server first saw by SMS has a server UUID until the origin phone pushes its own row, at which point the server re-keys it to the origin phone's `id` (its events follow). A facility phone that created a local row from an SMS will receive the canonical `id` on pull.

**referral_events** (append-only): `referral_id`, `origin_device_id`, `short_id` (the referral's key, so the server can find it even if it knows it under another id), `status` (`created`|`carrying`|`sent`|`received`|`arrived`|`treated`|`closed`|`cancelled`), `at`, `source_device_id`, `via` (`sms`|`qr`|`https`|`local`). Pushing an event for an unknown referral creates a stub referral. Pulled events carry the server's canonical `referral_id` and do not include `origin_device_id` / `short_id`.

**transport_providers**: `name`, `phone`, `vehicle` (default `""`), `community` (default `""`), `active: boolean`

**transport_requests**: `referral_id?`, `provider_id`, `status` (`requested`|`coming`|`declined`|`done`), `scheduled_for?`. Driver SMS replies to the gateway update `status`.

Not synced (phone-local): `risk_scores`, `outbox`, `inbox`, `audio_prompts`.

## Not built

- `GET /export/dhis2` (spec 17) and `POST /admin/import/register` (CSV) are not implemented.
- Pushed status events do not trigger a gateway LFS; facility phones send their own LFS by SMS. Only `POST /referrals/:id/status` and inbound LFR (ack) send SMS from the server.
