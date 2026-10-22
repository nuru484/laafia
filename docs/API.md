# Laafia API

Express + Prisma + PostgreSQL backend in `apps/api`. This is the contract the mobile app and web dashboard are written against.

## Run

```
cp apps/api/.env.example apps/api/.env      # set DATABASE_URL (Prisma needs a user: postgresql://<user>@localhost/laafia?host=/var/run/postgresql)
createdb laafia && createdb laafia_api_test
npm run db:migrate -w @laafia/api           # prisma migrate deploy (db:migrate:dev runs prisma migrate dev)
npm run seed -w @laafia/api                 # district, SMS gateway and first admin from SEED_* (seed:demo loads the demo district)
npm run dev -w @laafia/api                  # http://localhost:4000
npm test -w @laafia/api                     # migrates TEST_DATABASE_URL (laafia_api_test) and clears its rows per test
```

Configuration is validated at boot (`src/config/env.ts`). The server refuses to start without `DATABASE_URL`, and in production without `JWT_SECRET` (32+ chars), `ADMIN_TOKEN` and `SMS_WEBHOOK_TOKEN` (24+ chars). Secrets live only in `apps/api/.env`. Logs never contain secrets, SMS bodies or full phone numbers.

Demo activation codes (fixed, valid 7 days, single use; `npm run seed:demo` resets them):

| Code | Device | Role | Facility |
| --- | --- | --- | --- |
| 26100001 | D001 | cho | SAV-CHPS-01 |
| 26100003 | F001 | facility | SAV-CHPS-01 |
| 26100004 | F002 | facility | PTA-HC-01 |
| 26100005 | F003 | facility | SAV-HOSP-01 |
| 26100006 | D002 | cho | SAV-CHPS-02 |

Seeded devices keep the deterministic `key_hex` from `generateSeed`, so phones and server agree offline. Seeded districts: `SAV` (Savelugu, facilities 1-3) and `TML` (Tamale, `TTH-HOSP-01`).

## Conventions

- JSON in and out. Timestamps are epoch milliseconds (numbers). Booleans are `true`/`false` (push also accepts `0`/`1`). JSON columns (`capabilities`, `prior_complications`, `risk_flags`, `danger_signs`, `answers`) are native JSON arrays/objects, not strings.
- Auth: phones send `Authorization: Bearer <jwt>`. Dashboard users sign in (`POST /web/login`) and send the `laafia_session` cookie plus `X-CSRF-Token` on mutations (see Dashboard accounts). Scripts may send `x-admin-token: <ADMIN_TOKEN>`, which is unscoped. A route admits phones only when it names their roles. Credentials are never accepted in the query string; SSE uses a ticket (see `/events/ticket`).
- Scope: a `facility_staff` user acts for one facility, a `district_admin` or `supervisor` for every facility in one district. A user whose role needs a facility or district that is not set is refused (`403`), never widened.
- Errors, every route:

```json
{ "status": 401, "code": "deactivated", "message": "This device has been deactivated" }
```

Validation errors add `details: [{ "path": "records.0.table", "message": "..." }]`. `429` responses carry a `Retry-After` header (seconds).

| code | status | meaning |
| --- | --- | --- |
| `invalid_request` | 400 | body, query or form fields failed validation |
| `invalid_json` | 400 | body is not JSON |
| `invalid_code` | 400 | activation code unknown, used or expired |
| `invalid_credentials` | 401 | dashboard sign-in failed (same answer for unknown, inactive and wrong password) |
| `csrf` | 403 | dashboard mutation without the right `X-CSRF-Token` |
| `unauthenticated` | 401 | no token, or bad webhook token |
| `invalid_token` | 401 | bad or expired JWT; re-activate |
| `invalid_ticket` | 401 | SSE ticket missing, used or expired |
| `deactivated` | 401 | device deactivated: wipe local data (spec 18.2) |
| `forbidden` | 403 | role or facility not allowed |
| `device_mismatch` | 403 | push `device_id` differs from the token |
| `not_found` | 404 | unknown route, referral, facility, device or user |
| `conflict` | 409 | duplicate name, code or id |
| `batch_too_large` | 413 | more than 200 push records |
| `too_large` | 413 | request body over its limit |
| `rate_limited` | 429 | too many attempts (activation, sign-in) |
| `internal` | 500 | server bug |

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
                  "lat": 9.603, "lng": -0.805, "capabilities": [], "district_id": "dist-sav",
                  "updated_at": 1792628325516, "device_id": "seed", "deleted": false }
  },
  "keys": { "D001": "hex", "V001": "hex", "F001": "hex", "GW01": "hex" }
}
```

`keys` is the key directory, by device id, for verifying SMS:

- `facility`: every active device's key (to verify LFR from CHOs, and onward LFR from other facilities);
- `cho`: the facility devices of its district plus the gateway `GW01` (to verify LFS);

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
- Pushable tables: `households`, `clients`, `visits`, `referrals`, `referral_events`. `facilities` and `devices` are server-owned (pull only). Unknown keys (e.g. `synced`) are ignored. The server stamps `facility_id` from the pushing device on insert; a row belonging to another facility is `forbidden`.
- Referral authority:
  - A new referral (or a stub created by an event) is accepted only from its `origin_device_id`. Another device (a facility that received it by SMS) must include `lfr`: the origin's signed LFR string for the same `(origin_device_id, short_id)`.
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
- After the first sync, every change in the catchment is sent, active or not (including soft deletes).
- `keys` is the device's full current key directory (same rules as at activation): replace the local one, which drops deactivated devices.

## Dashboard accounts

Web users have accounts with a role and a scope:

| role | scope | may |
| --- | --- | --- |
| `district_admin` | `district_id` | everything below for their district |
| `supervisor` | `district_id` | read the referral board and reports |
| `facility_staff` | `facility_id` | the live inbox and facility actions for their facility |

The web app should proxy `/api/*` to the API (Next.js rewrite), so the cookies are first-party and no CORS is needed. Cookies: `laafia_session` (opaque, httpOnly, 7 days absolute and 12 h idle) and `laafia_csrf` (readable), both `Path=/; SameSite=Lax`, `Secure` in production. Every POST, PATCH or DELETE made with the session cookie must send `X-CSRF-Token: <laafia_csrf>`; GETs need nothing. Sessions are stored hashed server-side, so logout, password reset and deactivation end them at once.

`ADMIN_TOKEN` (header `x-admin-token`) is kept for scripts only, such as seeding and smoke checks. It acts unscoped as the admin; dashboard users never use it.

### POST /web/login

`{ "login": "admin@laafia.demo" | "0240000001", "password": "..." }` → `200 { "user": User, "csrf_token": "..." }` and sets both cookies. `401 invalid_credentials`; `429 rate_limited` after 5 attempts per IP or per login in 15 minutes.

```json
User = { "id": "usr-0001", "name": "Alhassan Yakubu", "email": "admin@laafia.demo", "phone": null, "role": "district_admin",
  "facility_id": null, "district_id": "dist-sav", "active": true, "last_login_at": 1792628325516, "created_at": 1792628325516,
  "facility": { "id": "fac-0003", "code": "SAV-HOSP-01", "name": "Savelugu Municipal Hospital" } | null,
  "district": { "id": "dist-sav", "code": "SAV", "name": "Savelugu Municipal" } | null }
```

### POST /web/logout

Idempotent. Revokes the session if there is one and clears both cookies. `200 { "ok": true }`.

### GET /web/me

`200 { "user": User }`; `401 unauthenticated` when signed out or the session ended.

## Referrals: inbox and board

### ReferralView

The wire shape of a referral in lists, chains and SSE:

```ts
type ReferralView = {
  id: string; updated_at: number; device_id: string | null; deleted: boolean
  facility_id: string | null            // origin catchment
  origin_device_id: string; short_id: string
  client_id: string | null; visit_id: string | null; client_code: string | null
  client_type: 'pregnant' | 'postpartum' | 'newborn' | 'child' | null
  context: string | null                 // e.g. PP3, GA34, AGE14M
  urgency: 1 | 2 | 3 | null
  danger_signs: string[]                 // sign names; plain-language text from core PROTOCOLS[...].signs[name].text_en
  destination_facility_id: string | null; next_of_kin: string | null
  status: 'created' | 'sent' | 'received' | 'arrived' | 'treated' | 'closed' | 'cancelled'
  delivered_via: 'sms' | 'https' | null
  parent_referral_id: string | null; onward_referral_id: string | null; onward_status: ReferralView['status'] | null
  events: { id: string; updated_at: number; device_id: string | null; deleted: boolean; referral_id: string
            status: ReferralView['status']; at: number; source_device_id: string; via: 'sms' | 'https' | 'local' }[]  // by `at`
}
```

`source_device_id` is a device id, `web:<user id>` for a dashboard user, `WEB` for the script token, or `GW01` for the server gateway.

### GET /referrals?facility=<code>&status=<status>&urgency=<1-3>

Facility phone, `facility_staff`, `district_admin` or `supervisor`. `facility` is optional for district users (then every facility in their district) and must be in scope (`403` otherwise). Response `200 { "referrals": [ReferralView] }`: referrals to or from those facilities, highest urgency first then newest, at most 200 (no paging; filter by status or urgency).

### GET /referrals/:id

Facility and CHO phones, `facility_staff`, `district_admin`, `supervisor`. Returns the referral and its refer-onward chain, root first: `{ "referral": ReferralView, "chain": [ReferralView, ...] }`. A CHO phone sees only chains it started (`403` otherwise); others see chains touching their scope (`404` otherwise).

### POST /referrals/:id/status

Facility phone that may act on it, `facility_staff` (referrals from or to their facility), `district_admin`. `{ "status": "received" | "arrived" | "treated" | "closed" | "cancelled" }` → `{ "referral": ReferralView }`. Writes a `referral_events` row (`via: "https"`), recomputes status (forward only, so web and phone actions merge whichever arrives first), publishes to SSE, and texts the origin CHO an `LFS` through Frog, once per (referral, status): if that status was already recorded (for example by the facility phone) or already texted, no second SMS is sent. `404` outside scope.

### POST /referrals/:id/onward

`facility_staff` at the referral's destination, or `district_admin`. `{ "destination_facility_code": "SAV-HOSP-01", "urgency"?: 3 }` → `201 { "referral": ReferralView }`. Creates the onward referral server-side: origin `GW01`, a new short id, the client and danger signs copied, `parent_referral_id` set, a `sent` event. If the destination has a phone in facility mode, the server texts it the LFR (signed with the gateway key) at the facility's phone number; its devices also receive it on their next sync. Otherwise the server acknowledges for it. The parent shows the hop in `onward_referral_id` / `onward_status`. `403` when the patient is not at the actor's facility; `400` for the same destination.

### GET /referrals/:id/client

`facility_staff` or `district_admin`, for a referral from or to their scope. `{ "client": clients row | null, "household": { "community", "head_name", "landmark", "lat", "lng" } | null, "visits": [visits row] }` (latest 5 visits). The client is found by `client_id`, else by `client_code` in the origin catchment.

### POST /events/ticket

Facility phone (own facility), `facility_staff` (own facility), `district_admin` or `supervisor` (a facility in their district). Request `{ "facility": "SAV-HOSP-01" }` (send `X-CSRF-Token` from the dashboard). Response `200 { "ticket": "base64url", "expires_at": 1792628385516 }`. The ticket is single use, valid 60 s, bound to that facility. `403` outside scope.

### GET /events?ticket=<ticket>

Server-sent events (`new EventSource('/api/events?ticket=...')`). Get a fresh ticket for every (re)connect. Events:

```
event: ready
data: {"facility":"SAV-HOSP-01"}

event: referral
data: <ReferralView JSON>
```

`referral` fires after any change to a referral from or to that facility (push, SMS, status button, onward). A `: ping` comment every 25 s keeps proxies open. Load the initial list with `GET /referrals`.

## Reports

### GET /dashboard/overview

`district_admin`, `supervisor` (their district), `facility_staff` (referrals to their facility; no device health).

```json
{ "scope": { "district": { "id": "dist-sav", "code": "SAV", "name": "Savelugu Municipal" } } | { "facility_id": "fac-0003" },
  "today": { "total": 3, "by_status": { "created": 0, "sent": 1, "received": 1, "arrived": 1, "treated": 0, "closed": 0, "cancelled": 0 } },
  "overdue_acknowledgements": [Brief], "did_not_arrive": [Brief],
  "completion_rate_30d": 0.67, "median_ack_minutes_30d": 9,
  "devices_not_synced_3d": [{ "id": "D002", "role": "cho", "user_name": "Mariama Abdulai", "facility_id": "fac-0001", "last_sync_at": 1792200000000 | null }] }
Brief = { "id", "short_id", "client_code", "urgency", "status", "destination_facility_id", "made_at" }
```

`today` counts referrals whose first event is today (UTC). Overdue and did-not-arrive use core `referralAlert`: no acknowledgement within 10 min / 30 min / 2 h for urgency 3 / 2 / 1; acknowledged but not arrived within 6 h / 24 h / 72 h. Rates cover referrals made in the last 30 days; completion is treated or closed out of those not cancelled.

### GET /dashboard/summary?days=30

Same roles. `{ district, facility, window_days, total, by_status, time_to_ack_minutes: { median, p90, count }, completion_rate, per_facility: [{ facility: { id, code, name, level }, referred_from, received, open, median_ack_minutes, completion_rate }], daily: [{ day: "2026-10-22", referrals, completed }] }`. District users get their district (`facility: null`); facility staff their facility's history (`district: null`). The script token passes `district=<code>`.

## SMS gateway

The server gateway is Frog by Wigal, and it is the fallback path: phones text each other from their own SIMs. The server sends SMS only for:

- `LFS` status from the web inbox (`POST /referrals/:id/status`);
- the `LFS ... R` acknowledgement for a referral that reaches a facility by HTTPS push or inbound SMS while that facility has no active device in facility mode (the server records the `received` event for it);
- the onward LFR when facility staff refer onward from the dashboard (`POST /referrals/:id/onward`).

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
{ "ok": false, "error": "not_laafia" | "unknown_signer" | "bad_signature" | "conflict" | "forbidden" }
```

- Verified with `packages/core` `decode`, key looked up by the `signer` device id (never the sender number). Deactivated devices are `unknown_signer`.
- `LFR`: upserts the referral by `(signer, short_id)`. If the destination has no phone in facility mode, the server adds the `received` event and replies `LFS ... R` to the sender, signed by the gateway device `GW01`. A repeat of the same content is a confirmation (`duplicate: true`, ack resent); different content for the same key is `conflict`.
- `LFS`: applied with the signer's authority: the signer must be an active device that may act on the referral (its origin, the current destination facility, or an earlier hop), else `forbidden`. An LFS for a referral the server has not seen is `forbidden` (no stub).

## Admin (`district_admin`, or the script token)

All admin routes accept the `district_admin` session cookie (with `X-CSRF-Token` on mutations) or the script token, and are scoped to the admin's district; a facility, device or user outside it is `403` (or `404` for an id). Every change is written to the audit log.

### Users

- `GET /admin/users` → `{ "users": [User without facility/district objects] }`, by role then name.
- `POST /admin/users` `{ "name", "email"?, "phone"?, "password" (10+ chars), "role", "facility_code"? (required for facility_staff), "district_code"? (script token only) }` → `201 { "user": User }`. `409` if the email or phone has an account.
- `POST /admin/users/:id/password` `{ "password" }` → `{ "user": User }`. Ends all of that user's sessions.
- `POST /admin/users/:id/deactivate` / `POST /admin/users/:id/activate` → `{ "user": User }`. Deactivation ends their sessions; an admin cannot deactivate themselves (`400`).

### Devices

- `GET /admin/devices` → `{ "devices": [Device] }`, by id. `Device = { "id", "role", "user_name", "phone_number", "facility_id", "facility_code", "facility_name", "active", "activated_at", "updated_at", "device_id", "deleted", "last_sync_at": number | null, "app_version": string | null, "activation_pending_until": number | null }`. Never includes keys or codes. `last_sync_at` and `app_version` (header `X-App-Version` on sync) come from the phone's last push or pull.
- `POST /admin/devices` `{ "role": "cho"|"facility", "user_name": "...", "facility_code": "SAV-CHPS-01", "phone_number"?: "...", "id"?: "D002" }` → `201 { "device": Device, "activation_code": "12345678", "expires_at": 1792801125516 }` (48 h).
- `POST /admin/devices/:id/code` → `{ "device", "activation_code", "expires_at" }`: a fresh code for a new or replacement phone; older unused codes stop working; a deactivated device is reactivated.
- `POST /admin/devices/:id/deactivate` → `{ "device": Device }`. Its next request gets `401 deactivated`; facility phones drop its key on their next pull; its SMS become `unknown_signer`.

### Facilities

- `GET /admin/facilities` (every dashboard role, within scope) → `{ "facilities": [facilities row + "district_code"] }`.
- `POST /admin/facilities` `{ "code": "SAV-CHPS-02", "name", "level": "chps"|"health_centre"|"hospital", "phone"?, "lat", "lng", "capabilities": ["cemonc"], "district_code"? (script token only) }` → `201 { "facility": row }`. `409` if the code exists.
- `PATCH /admin/facilities/:id` with any of `name, level, phone, lat, lng, capabilities` → `{ "facility": row }`. Phones receive facility changes on their next pull.

### SMS gateway panel

- `GET /admin/sms/balance` → `{ "configured": true, "balance": 42.5, "currency": "GHS", "sms_units": 1250 }` from Frog `GET /api/v3/balance` (`cashbalance` and `bundles.SMS`, as in dms-backend). Without Frog credentials: `{ "configured": false, "balance": null, "currency": null, "sms_units": null }`, not an error. `502 sms_balance_unavailable` if Frog cannot be reached.
- `GET /admin/sms/log?limit=50&before=<ms>` → `{ "messages": [{ "id": "42", "at": 1792628325516, "to_masked": "*******001", "kind": "ack" | "status" | "referral", "status": "queued" | "sent" | "delivered" | "failed", "attempts": 1, "error": string | null, "delivered_at": number | null }], "next_before": number | null }`, newest first, for the admin's district. Page by passing `next_before` as `before`. `kind`: `ack` is the server's acknowledgement for a facility without a phone, `status` an LFS from the web, `driver` a pickup SMS, `referral` an onward LFR. `status` combines the send and Frog's delivery receipt. Bodies and full numbers are never returned.

### Checklists

`GET /protocols` (every dashboard role) → `{ "protocols": [Protocol] }`: each protocol exactly as phones run it (from `packages/core`), with `id`, `version`, `clinical_review`, `questions`, `rules` (with thresholds), `signs`, `actions` and `destination`. Read-only.

### Audit log

`GET /admin/audit?limit=50&before=<at>&target_type=<type>` → `{ "events": [{ "id", "at", "actor_kind": "user"|"device"|"script", "actor_id", "actor_name", "action", "target_type", "target_id", "details" }], "next_before": number | null }`, newest first. Page by passing `next_before` as `before`. Actions: `user.create|password_reset|deactivate|activate`, `device.create|code_reissue|deactivate`, `facility.create|update`, `referral.refer_onward`.

## Sync row format

Every row has the sync columns:

| field | type | notes |
| --- | --- | --- |
| `id` | string (≤64) | UUID v4 for phone-made rows; seed rows use `hh-0001` style ids |
| `updated_at` | int ms | LWW clock, set by the writer |
| `device_id` | string or null | last writer; defaults to the pushing device |
| `deleted` | boolean | soft delete |

Pulled rows also carry `facility_id` (the catchment, server-set; ignored on push). `seq` is never sent. `?` marks nullable fields; send `null` (or omit) for them.

**facilities** (pull only): `code`, `name`, `level` (`chps`|`health_centre`|`hospital`), `phone?`, `lat`, `lng`, `capabilities: string[]`, `district_id?`

**devices** (pull only): `role` (`cho`|`facility`|`gateway`), `user_name`, `phone_number?`, `facility_id?`, `active: boolean`, `activated_at?`. Used to show the origin CHO's name and phone on a referral card.

**households**: `community`, `head_name`, `landmark` (default `""`), `lat?`, `lng?`, `consent_at?`

**clients**: `household_id`, `code` (e.g. `CL-D001001`), `type` (`pregnant`|`postpartum`|`newborn`|`child`), `name`, `sex?` (`f`|`m`), `dob?`, `edd?`, `delivery_date?`, `parity?`, `prior_complications: string[]`, `birth_weight_g?`, `nhis_active: boolean`, `risk_flags: string[]`.

**visits**: `client_id`, `protocol_id`, `visited_at`, `answers: object`, `outcome` (`routine`|`followup`|`refer`), `rule_id`, `followup_due?`, `notes?`, `muac_mm?`

**referrals**: `origin_device_id` (device id that created and signed it, `^[A-Z0-9]{2,8}$`), `short_id` (8 base32 chars from `shortIdFromBytes`), `client_id?`, `visit_id?`, `client_code?`, `client_type?` (full name, e.g. `newborn`), `context?` (e.g. `PP3`), `urgency?` (1-3), `danger_signs: string[]` (sign names, e.g. `["bleeding"]`), `destination_facility_id?`, `next_of_kin?`, `delivered_via?` (`sms`|`https`), `parent_referral_id?` (refer onward: the referral this one continues), on pull only `onward_referral_id?` and `onward_status?` (latest onward hop, server-maintained), push only: `lfr?` (origin's signed LFR, required when the pusher is not the origin and the server has not seen the referral; not stored), and on pull `status`.

- `status` is ignored on push. The server derives it from `referral_events` with core `deriveStatus` (forward only). Push the events.
- Identity is `(origin_device_id, short_id)`. **Phones must upsert pulled referrals by that pair, not only by `id`**, and adopt the pulled `id`: a referral the server first saw by SMS has a server UUID until the origin phone pushes its own row, at which point the server re-keys it to the origin phone's `id` (its events follow). A facility phone that created a local row from an SMS receives the canonical `id` on pull.

**referral_events** (append-only): `referral_id`, `origin_device_id`, `short_id` (the referral's key, so the server can find it even if it knows it under another id), `status` (`created`|`sent`|`received`|`arrived`|`treated`|`closed`|`cancelled`), `at`, `source_device_id`, `via` (`sms`|`https`|`local`). Pulled events carry the server's canonical `referral_id` and do not include `origin_device_id` / `short_id`.

Not synced (phone-local): `risk_scores`, `outbox`, `inbox`.

## Not built

- SSE tickets and the rate limits are held in memory, so they assume one API process.
