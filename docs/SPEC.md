# Laafia: Technical Specification

Offline-first referral and visit-planning system for Community Health Officers (CHOs) in Northern Ghana.
This document is the build brief. It states the problem, the solution for every part of it, the stack, and how each feature works technically. It contains no business strategy and no schedule.

Acronyms are expanded on first use. A glossary is at the end.

---

## 1. The problem

Maternal, newborn and under-five deaths in Northern Ghana are driven less by what health workers know and more by what happens after they know it. A CHO (Community Health Officer, the Ghana Health Service staff member posted to a CHPS compound; CHPS = Community-based Health Planning and Services, Ghana's community health programme) visits households, identifies danger signs, and refers. The referral is verbal, on paper, or never arrives. Nobody at the receiving facility knows a patient is coming. Nobody knows whether she arrived, and after discharge nobody follows up. Records are on paper and copied again for the monthly report.

The specific failures Laafia addresses, each mapped to a solution part below:

| # | Failure in the field | Laafia part |
| --- | --- | --- |
| P1 | The CHO has no systematic way to decide who most needs a visit today | Ranked visit list (section 6) |
| P2 | Finding households and planning a walkable route is by memory | Household GPS, landmarks, route order, directions in the phone's map app (section 10) |
| P3 | Assessments vary from nurse to nurse | WHO protocol checklists, the same questions every time (section 7) |
| P4 | Danger-sign recognition depends on memory of the protocol | Rules engine with deterministic outcomes (section 7) |
| P5 | The referral does not reach the facility, or reaches it unreadable | Signed SMS, with internet sync when available (sections 11, 12) |
| P6 | The facility does not know the patient is coming and cannot prepare | Facility mode auto-receives, replies, prepares (section 12) |
| P7 | Nobody knows whether the patient arrived or was treated | Referral status loop over the same relay (section 14) |
| P9 | Follow-up cases are forgotten | Follow-up scheduling feeds the ranked list (section 6) |
| P11 | Phones have no data most of the time; the compound has no server | Offline-first architecture; sync is opportunistic (sections 4, 16) |
| P12 | Patient data on a personal phone is a privacy risk | Encrypted database, PIN, signed messages, codes not names on the wire (section 18) |

Non-goals: Laafia does not diagnose, does not replace the CHO's judgement, does not talk to caregivers without a worker present, and does not replace DHIMS2. Importing from or reporting to DHIMS2 is out of scope until Ghana Health Service authorises it.

---

## 2. Roles and devices

| Role | Device | App mode | Responsibilities |
| --- | --- | --- | --- |
| CHO | Android phone (own or GHS-issued) | `cho` | Register, ranked list, checklists, referrals, follow-ups |
| CHPS compound | One Android phone kept at the compound | `facility` | Auto-receive referrals by SMS, acknowledge, refer onward, mark arrived and treated |
| Health centre and district hospital | Android phone in facility mode; web dashboard where internet exists | `facility` + web | Same as compound, plus the web inbox |
| District admin and supervisor | Web dashboard | web | Nurses' phones, facilities, the referral board and its status |

The same mobile app serves `cho` and `facility`; the mode is set at activation and controls which screens and permissions are active.

---

## 3. Stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Mobile | React Native with Expo (latest SDK), TypeScript, Expo Router | Built as a **development build**, see 3.1 |
| Local database | `expo-sqlite` with the SQLCipher option enabled in the config plugin; Drizzle ORM for typed schema, queries and migrations | If the installed SDK's `expo-sqlite` does not expose SQLCipher, use `@op-engineering/op-sqlite` with its SQLCipher build. Verify against the current Expo docs before choosing. |
| Native SMS | A local Expo Module in Kotlin (`modules/laafia-sms`) wrapping `SmsManager` and an `SMS_RECEIVED` BroadcastReceiver | Section 11 |
| Location | `expo-location` for the house GPS fix; a `geo:` link opens the phone's own map app | Section 10 |
| Secure storage | `expo-secure-store` for keys and PIN hash | Section 18 |
| Crypto | `@noble/hashes` (HMAC-SHA256, PBKDF2), `expo-crypto` for random bytes | Pure JS, works offline |
| Connectivity | `@react-native-community/netinfo` | Sync triggers |
| Backend | Node 22+, Express, TypeScript, Prisma ORM (driver adapter `@prisma/adapter-pg`), PostgreSQL 16+ | Section 16 |
| Web | Next.js (App Router), server-sent events for the live inbox | Section 12.4 |
| Shared code | `packages/core`: rules engine, scorer, payload codec, HMAC, types. Used by mobile, backend and web | Single source of truth for anything that must behave identically on both ends |
| Model training | Python 3, scikit-learn, exports `risk_model.json` | Section 6 |
| Tests | Vitest for `packages/core` and backend; Jest-Expo for mobile units; Playwright for web | Section 20 |

### 3.1 Development build versus Expo Go

Expo Go is the Expo sandbox app installed from the Play Store. It contains only the native libraries Expo ships by default. It cannot load custom native code, so it cannot run the SMS module or SQLCipher. A **development build** is Laafia's own APK, compiled with those native modules included, produced by `npx expo run:android` on a machine with the Android SDK, or by EAS Build in the cloud. Everything in this spec assumes a development build. The APK is sideloaded onto phones; it is not distributed through the Play Store (which would also refuse the SMS permissions).

### 3.2 Repository layout

```
laafia/
  apps/
    mobile/          Expo app (cho and facility modes)
      modules/laafia-sms/   local Expo Module, Kotlin
      assets/protocols/*.json
      assets/model/risk_model.json
    api/             Express backend
    web/             Next.js facility inbox and supervisor dashboard
  packages/
    core/            rules engine, scorer, codec, hmac, types, seed generators
  model/             Python training script and synthetic data generator
  docs/              this spec and the API reference
```

---

## 4. Architecture

```
CHO phone (offline-first)                 Transports                 Receivers
+------------------------------+          +------------+          +------------------------+
| SQLite (SQLCipher)           |   ---->  | SMS (2G)   |  ---->   | Facility phone         |
| Rules engine (core)          |   ---->  | HTTPS sync |  ---->   |   facility mode app    |
| Scorer (core)                |          +------------+          | Backend (Express+PG)   |
| Outbox / inbox tables        |                                  |   -> web inbox (SSE)   |
|                              |                                  +------------------------+
+------------------------------+
```

Principles:

1. Every screen works with zero connectivity. No screen blocks on a network call.
2. Every mutation is a local write first. Sync is a background process that reads the outbox.
3. Every message that leaves the phone (SMS, HTTPS) carries the same referral id, so receivers deduplicate.
4. Clinical outcomes come only from the rules engine. The scorer ranks; it never classifies a patient.
5. Shared logic lives in `packages/core` and runs identically on phone, server and web.

---

## 5. Data model

All tables carry the sync columns: `id TEXT PRIMARY KEY` (UUID v4), `updated_at INTEGER` (epoch ms), `device_id TEXT`, `synced INTEGER DEFAULT 0`, `deleted INTEGER DEFAULT 0`.

| Table | Purpose | Key columns |
| --- | --- | --- |
| `facilities` | Compounds, health centres, hospitals | `code` (e.g. `TAM-CHPS-04`), `name`, `level` (`chps`, `health_centre`, `hospital`), `phone`, `lat`, `lng`, `capabilities` JSON (e.g. `["cemonc","theatre"]`) |
| `devices` | Known devices and their roles | `role`, `user_name`, `phone_number`, `facility_id`, `key_hash`, `active` |
| `households` | One row per compound/house | `community`, `head_name`, `landmark`, `lat`, `lng`, `consent_at` |
| `clients` | Pregnant women, newborns, under-fives | `household_id`, `code` (short human code, e.g. `CL-0417`), `type` (`pregnant`, `postpartum`, `newborn`, `child`), `name`, `sex`, `dob`, `edd`, `delivery_date`, `parity`, `prior_complications` JSON, `birth_weight_g`, `nhis_active`, `risk_flags` JSON |
| `visits` | One per completed assessment | `client_id`, `protocol_id`, `visited_at`, `answers` JSON, `outcome` (`routine`, `followup`, `refer`), `rule_id`, `followup_due`, `notes`, `muac_mm` |
| `referrals` | One per refer outcome | `client_id`, `visit_id`, `urgency` (1 to 3), `danger_signs` JSON, `destination_facility_id`, `status` (`created`, `sent`, `received`, `arrived`, `treated`, `closed`), `delivered_via` (`sms`, `https`), `short_id` (first 6 hex chars of id) |
| `referral_events` | Status history | `referral_id`, `status`, `at`, `source_device_id`, `via` |
| `risk_scores` | Recomputed at app start and after any visit | `client_id`, `score`, `reasons` JSON, `computed_at` |
| `outbox` | Everything that must leave the phone | `kind` (`sms`, `https`), `to`, `payload`, `ref_table`, `ref_id`, `attempts`, `last_error`, `status` (`pending`, `sent`, `delivered`, `failed`) |
| `inbox` | Raw received messages | `from`, `body`, `received_at`, `parsed` (0/1), `result` JSON |

Indexes: `clients(household_id)`, `visits(client_id, visited_at)`, `referrals(status)`, `outbox(status)`, every table on `(synced)`.

---

## 6. Ranked visit list (P1, P9)

### 6.1 What it produces

A list of clients ordered by priority for today, each with a score in [0, 1] and up to three plain-language reasons, grouped into a walkable route.

### 6.2 Features

Computed in `packages/core/scorer.ts` from the client's record, today's date, and visit history.

| Feature | Type | Source |
| --- | --- | --- |
| `anc_overdue_days` | number | For pregnant: days since the next ANC (antenatal care) contact was due, from `edd` and the Ghana ANC schedule table |
| `days_postpartum` | number | `today - delivery_date` for postpartum and newborn |
| `pnc_visits_done` | number | Count of PNC (postnatal care) visits in `visits` |
| `prior_complications` | 0/1 | Non-empty `prior_complications` |
| `low_birth_weight` | 0/1 | `birth_weight_g < 2500` |
| `muac_class` | 0/1/2 | Last `muac_mm`: >=125 green, 115 to 124 yellow, <115 red |
| `followup_due_days` | number | `today - followup_due` of the latest visit, clamped at 0 |
| `days_since_last_visit` | number | |
| `age_months` | number | For children |
| `first_pregnancy` | 0/1 | `parity == 0` |

### 6.3 Model

Logistic regression. Weights live in `assets/model/risk_model.json`:

```json
{ "version": 1, "intercept": -2.1,
  "weights": { "anc_overdue_days": 0.08, "days_postpartum_lt7": 1.4, "pnc_visits_done": -0.6, "prior_complications": 1.1, "low_birth_weight": 0.9, "muac_class": 0.8, "followup_due_days": 0.12, "first_pregnancy": 0.3 },
  "reason_templates": { "days_postpartum_lt7": "{days} days after delivery", "pnc_visits_done": "no postnatal visit recorded", "prior_complications": "previous {complication}", "anc_overdue_days": "ANC contact {days} days overdue", "low_birth_weight": "low birth weight", "muac_class": "MUAC {colour}", "followup_due_days": "follow-up due {days} days ago" } }
```

Scoring: `score = sigmoid(intercept + sum(w_i * x_i))`. Reasons: the three largest positive `w_i * x_i` terms, rendered through `reason_templates`. The CHO can drag to reorder; a reorder writes a `manual_rank` override for the day and an `override` row for later retraining.

### 6.4 Training

`model/train.py` generates a synthetic dataset from published risk-factor odds ratios, fits `sklearn.linear_model.LogisticRegression`, and writes `risk_model.json`. The pilot replaces the synthetic data with real visit outcomes. The app never trains; it only scores.

### 6.5 Hard rules on top of the score

Regardless of score: a client with an open referral whose status is not `closed` appears pinned at the top with the status; a `followup_due <= today` client is lifted to at least 0.3 plus a tenth of its own score (`FOLLOWUP_FLOOR` in the scorer), above the routine list and in its own risk order. These are not model features; they are list rules applied after scoring.

### 6.6 Route grouping

After ranking, take the top N (default 12). Order them by nearest-neighbour starting from the CHPS compound coordinates, using haversine distance. Households in the same `community` are kept adjacent. Output is the list shown on the home screen and the pins on the map.

---

## 7. Protocol checklists and rules engine (P3, P4)

### 7.1 Protocols

Three protocols, each a JSON decision table in `assets/protocols/`:

| File | Applies to | Basis |
| --- | --- | --- |
| `maternal.json` | `pregnant`, `postpartum` | WHO (World Health Organization) maternal danger signs, pregnancy and postpartum |
| `young_infant.json` | `newborn`, children under 2 months | IMNCI (Integrated Management of Neonatal and Childhood Illness) |
| `child.json` | children 2 to 59 months | IMCI (Integrated Management of Childhood Illness) plus MUAC (mid-upper arm circumference) classification |

The app picks the protocol from `client.type` and age.

### 7.2 Protocol file shape

```json
{
  "id": "young_infant", "version": 1, "lang_default": "dag",
  "questions": [
    { "id": "yi_feeding", "type": "yesno", "text_en": "Is the baby able to feed?", "next": "yi_convulsions" },
    { "id": "yi_convulsions", "type": "yesno", "text_en": "Has the baby had convulsions?", "next": "yi_breaths" },
    { "id": "yi_breaths", "type": "number", "unit": "breaths/min", "text_en": "Count breaths for one minute", "next": "yi_temp" },
    { "id": "yi_temp", "type": "select", "options": ["cold", "normal", "hot"], "next": null }
  ],
  "rules": [
    { "id": "YI-R1", "when": { "yi_feeding": false }, "outcome": "refer", "urgency": 3, "danger_sign": "not_feeding", "actions": ["keep_warm", "breastfeed_attempt", "go_now"], "stop": true },
    { "id": "YI-R2", "when": { "yi_convulsions": true }, "outcome": "refer", "urgency": 3, "danger_sign": "convulsions", "actions": ["keep_warm", "go_now"], "stop": true },
    { "id": "YI-R3", "when": { "yi_breaths": { "gte": 60 } }, "outcome": "refer", "urgency": 2, "danger_sign": "fast_breathing", "actions": ["keep_warm", "go_today"] },
    { "id": "YI-F1", "when": { "yi_temp": "cold" }, "outcome": "followup", "followup_days": 1, "actions": ["skin_to_skin"] },
    { "id": "YI-DEFAULT", "when": {}, "outcome": "routine", "actions": ["counsel_feeding"] }
  ],
  "actions": { "keep_warm": { "text_en": "Keep the baby warm, skin to skin" }, "go_now": { "text_en": "Go to the facility now, do not wait" } },
  "destination": { "default": "nearest:chps", "by_danger_sign": { "convulsions": "nearest:health_centre", "bleeding_heavy": "nearest:capability:cemonc" } }
}
```

### 7.3 Engine

`packages/core/rules.ts`:

- `next(protocol, answers)` returns the next unanswered question in order, or null.
- `evaluate(protocol, answers)` runs rules in order; the first rule whose `when` matches and has `stop: true` short-circuits (danger sign); otherwise the highest-urgency `refer` wins, then `followup`, then `routine`. Returns `{ outcome, rule_id, urgency, danger_signs[], actions[], followup_days, destination_query }`.
- Danger-sign short-circuit also runs **after every answer**, so a red flag shows immediately without finishing the checklist. The CHO may continue the checklist for completeness; the outcome cannot be downgraded.
- `when` supports equality, `gte`, `lte`, `in`, and `all`/`any` composition. Keep it small; no expressions.
- Deterministic and pure; 100% unit-test coverage of every rule with a table of example answers.

### 7.4 Destination selection

`destination_query` resolves against `facilities`: `nearest:chps` picks the nearest facility of that level by haversine; `nearest:capability:cemonc` picks the nearest with that capability. The CHO can change it.

---

## 8. Local-language audio

Out of scope. The nurse reads the checklist questions herself; spoken prompts were removed to keep the app light to use.

---

## 9. Enrolment (P2, P12)

- Household: name of head, community, landmark line, GPS fix via `expo-location` (`getCurrentPositionAsync` with high accuracy, 15 s timeout; if no fix, allow manual save and flag `lat/lng` null), consent checkbox with timestamp.
- Client: type, names, dates (dob or edd), parity, prior complications (multi-select), birth weight, NHIS (National Health Insurance Scheme) status.
- A short client `code` is generated: `CL-` + zero-padded sequence per device prefix. Codes, not names, go on the wire.
- Clients come from the nurse's own enrolment and assessments. Seeding from a facility register or DHIMS2 is out of scope until authorised.

---

## 10. Location and route (P2)

- One GPS fix per household at enrolment, or later from the client screen ("Capture house position"), plus a free-text landmark.
- Route order: the day's list (section 6.6) is walked nearest-neighbour from the CHPS compound using those fixes.
- Directions: the client screen opens the house in the phone's own map app through a `geo:` link. Offline maps there (Google Maps, OsmAnd) work without signal. Laafia ships no map tiles.
- Phone GPS is satellite and works with no SIM and no data.

---

## 11. SMS: sending, receiving, queueing (P5, P6)

### 11.1 Native module `laafia-sms` (Kotlin, Expo Modules API)

Functions exposed to JS:

- `send(to: string, body: string, outboxId: string): Promise<void>` uses `SmsManager.getDefault()`. If `body` exceeds one segment, `divideMessage` + `sendMultipartTextMessage`. Two `PendingIntent`s per message: `SENT` and `DELIVERED`, each carrying `outboxId`. Their broadcast results are emitted to JS as events `smsSent {outboxId, ok, error}` and `smsDelivered {outboxId}`.
- `getInbox(sinceMs: number): Promise<RawSms[]>` queries `content://sms/inbox` for messages received while the app was closed.
- Event `smsReceived {from, body, receivedAt}` from a `BroadcastReceiver` registered for `android.provider.Telephony.SMS_RECEIVED` (works without being the default SMS app).
- Permissions in `app.json` via the module's config plugin: `SEND_SMS`, `RECEIVE_SMS`, `READ_SMS`. Requested at activation in `cho` and `facility` modes.

Fallback when the module is unavailable (e.g. a test device without the build): `expo-sms` opens the system composer pre-filled. The outbox row is marked `sent_via_composer` on return.

### 11.2 Outbox worker (mobile)

A single worker started at app launch and on foreground:

1. Select `outbox` rows with `status = 'pending'` ordered by `created_at`.
2. For `kind = 'sms'`: call `send`. On `smsSent ok` set `status = 'sent'`; on `smsDelivered` set `delivered`. On error set `attempts += 1`, `last_error`, and retry with backoff 30 s, 2 min, 10 min, 1 h; after 8 attempts mark `failed` and surface a banner.
3. For `kind = 'https'`: handled by the sync worker (section 16), not here.
4. The worker is idempotent: a row is never sent twice unless its status is still `pending` after a failed attempt.

When there is no signal, `SmsManager` itself queues on the device and the `SENT` intent fires later; the outbox row stays `sent` pending `delivered`.

### 11.3 Wire format

All Laafia SMS are ASCII, pipe-delimited, prefixed with a 3-letter type. Fields never contain `|`. One GSM-7 segment is 160 characters; the referral format is designed to fit in one.

Referral (`LFR`):

```
LFR|1|a3f9c2|CL-0417|3|NB|PP3|nf,cv|TAM-CHPS-04|0241234567|k7Qm2Zp9
 |  |   |      |     |  |   |   |      |            |          └ signature (8 chars, base32 of HMAC-SHA256 prefix)
 |  |   |      |     |  |   |   |      |            └ next of kin phone
 |  |   |      |     |  |   |   |      └ destination facility code
 |  |   |      |     |  |   |   └ danger sign codes
 |  |   |      |     |  |   └ context: PP3 = postpartum day 3; or GA34 = gestation week 34; or AGE14M
 |  |   |      |     |  └ client type: PW pregnant, PP postpartum, NB newborn, CH child
 |  |   |      |     └ urgency 1..3
 |  |   |      └ client code
 |  |   └ referral short id (first 6 hex of UUID)
 |  └ format version
 └ type
```

Status (`LFS`): `LFS|1|a3f9c2|A|k7Qm2Zp9` where status is `R` received, `A` arrived, `T` treated, `C` closed. Sent by facility phones back to the originating CHO number, and onward by the CHO phone to the compound if the CHO referred from a health centre.

Sync-by-SMS is **not** supported; records sync over HTTPS only.

### 11.4 Signing and verification

- Each device gets a 32-byte `device_key` at activation (section 18). Facility devices receive, at activation and on every sync, the `device_key` of every CHO device in their catchment (`devices` table, `key_hash` stored on the server, raw key delivered over TLS to facility devices only).
- Signature = base32(HMAC-SHA256(device_key, canonical_payload))[0:8], where `canonical_payload` is the message with the signature field empty.
- Receiver: look up the sender phone number in `devices`; if unknown, reject and log. Recompute the signature with that device's key; if mismatch, reject and log. Then parse.
- Replay: a referral short id already present with the same content is a confirmation; with different content it is rejected and flagged.

### 11.5 Receiving (facility mode and CHO mode)

On `smsReceived` or on `getInbox` after launch:

1. Insert into `inbox`.
2. If the body starts with `LFR` or `LFS`, parse; otherwise ignore (ordinary SMS). A CHO phone ignores an `LFR` it did not sign; only facilities take in referrals.
3. Verify (11.4). On failure, store `result = {error}` and stop.
4. `LFR`: upsert `referrals` by short id with `status = 'received'`, `delivered_via = 'sms'`; write `referral_events`; re-run `evaluate()` with the danger-sign codes to reconstruct the assessment summary for display; show a full-screen card with sound; enqueue an `LFS ... R` acknowledgement to the sender in `outbox`.
5. `LFS`: update the referral's status and events; notify the CHO.
6. All of this works with the screen locked; the receiver is a broadcast receiver, so the app is started if needed.

---

## 12. Facility mode (P6)

### 12.1 Screens

- Inbox: cards ordered by urgency then time; unacknowledged cards pulse. Card shows client code, type and context, danger signs with their plain-language names, urgency, origin CHO and phone, delivered via, and buttons: Acknowledge, Arrived, Treated, Close, Refer onward.
- Register view: read-only lookup of clients by code for the catchment, so the facility can resolve a code to a name locally.

### 12.2 Acknowledge and status

Every button writes `referral_events` and enqueues an `LFS` message to the originating CHO number and, when the referral was forwarded, to the forwarding facility. Status also syncs over HTTPS when available, so the web inbox and the CHO phone converge by whichever path arrives first.

### 12.3 Refer onward

Uses the same referral record: destination changes, a `referral_events` row records the hop, and a new `LFR` is sent from the facility phone to the next facility with the facility device's own key. The chain is visible on the card.

### 12.4 Web inbox

Next.js page at `/inbox/[facilityCode]`, authenticated. Subscribes to `GET /events?facility=...` (server-sent events). The backend publishes on every referral upsert or status change. Cards mirror the facility-mode screen. Status buttons call the API, which writes events and enqueues an `LFS` SMS through the gateway (section 16.4) so the CHO phone learns the status even if it never syncs.

---

## 13. QR hand-carry and record sync

Out of scope. Referrals travel by SMS, with HTTPS sync when there is internet; volunteers and QR hand-carry were removed.

---

## 14. Referral status loop (P7)

States and allowed transitions:

```
created -> sent -> received -> arrived -> treated -> closed
   \         \        \
    \         +-> (refer onward: destination changes, stays 'received' at the new hop)
     +-> cancelled
```

- `sent`: at least one transport reported ok.
- `received`: a facility acknowledged (SMS or web).
- `arrived`, `treated`: set at the facility.
- `closed`: discharge; the app creates a `visits` row stub with `followup_due = today + 3` (configurable per protocol) so the client returns to the ranked list.
- Timers on the CHO phone: if `sent` and not `received` after 2 h, banner "no acknowledgement, call facility"; if `received` and not `arrived` after a window by urgency (3: 6 h, 2: 24 h, 1: 72 h), the client is pinned to the top of the list with "did not arrive, visit".
- Every transition writes `referral_events` and is itself a message (`LFS` by SMS, row by HTTPS).

---

## 15. Transport requests

Out of scope. The referral screen keeps a call button for the facility and for the National Ambulance Service (112).

---

## 16. Backend and HTTPS sync (P10, P11)

### 16.1 Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/activate` | `{activation_code, phone_number, device_info}` → `{device_id, device_key, jwt, profile, catchment}` |
| POST | `/auth/refresh` | JWT refresh |
| POST | `/sync/push` | `{device_id, records: [{table, row}]}` → `{accepted: [ids], rejected: [{id, reason}]}` |
| GET | `/sync/pull?since=<cursor>` | Rows for this device's catchment changed since cursor → `{records, cursor}` |
| GET | `/events?facility=<code>` | Server-sent events stream for the web inbox |
| POST | `/referrals/:id/status` | Web inbox status buttons |
| POST | `/sms/inbound` | Gateway webhook (16.4) |
| GET | `/admin/devices`, POST `/admin/devices/:id/deactivate` | Device registry |

### 16.2 Push

- Idempotent: for each row, `INSERT ... ON CONFLICT (id) DO UPDATE WHERE excluded.updated_at > existing.updated_at`. Rows with older `updated_at` are accepted as no-ops. Response lists accepted ids; the phone sets `synced = 1` for those.
- Batches of up to 200 rows. The phone retries failed batches with backoff; a 4xx on a specific row marks that row `sync_error` and continues.
- Referral and status rows pushed over HTTPS trigger the same inbox publishing and `LFS` gateway send as SMS-received ones, so the receiving facility gets the referral by whichever path arrives first.

### 16.3 Pull and conflict rule

- The phone stores a `cursor` (server `updated_at` watermark). Pull returns rows in the device's catchment (its facility and its households) with `updated_at > cursor`.
- Conflict: last-writer-wins by `updated_at`, on both phone and server. One CHO owns one catchment and two people rarely edit the same household, so this is sufficient; the `referral_events` table is append-only and never conflicts.
- Trigger points on the phone: app foreground, `netinfo` reports internet reachable, manual "Sync now", and every 15 minutes while foregrounded and online. Background sync via Expo background tasks is optional.

### 16.4 SMS gateway (facilities without an Android phone)

- Frog by Wigal sends the server's SMS (fallback path only; phones text each other directly) and posts delivery receipts to `/sms/delivery`. Any forwarder of received SMS can post `{from, text}` to `/sms/inbound`; the backend verifies and processes it exactly as the phone does (same `packages/core` code) and publishes to the web inbox.
- The backend also uses the gateway to send `LFS` status messages originating from the web inbox.

### 16.5 Backend layout

Express with Zod schemas on every route; Prisma schema and migrations (`apps/api/prisma`), feature modules under `apps/api/src/modules`; `packages/core` for parsing, verification and rules; an in-process event bus feeding SSE; a `jobs` table for gateway sends with the same backoff rules as the phone outbox.

---

## 17. DHIS2 import and export

Out of scope until Ghana Health Service authorises access. When it does, register import and DHIMS2 reporting attach to the server; the phones do not change.

---

## 18. Authentication, keys, encryption (P12)

### 18.1 Activation

1. District admin creates a user on the web dashboard; the system issues a one-time activation code (8 digits, 48 h expiry).
2. The CHO installs the APK, opens the app at the facility with internet, enters the code and her phone number.
3. `/auth/activate` returns `device_id`, `device_key` (32 random bytes), a JWT, the profile (role, facility, catchment), and the initial catchment data.
4. The app stores `device_key` and a freshly generated 32-byte `db_key` in `expo-secure-store` (hardware-backed keystore where available).
5. The CHO sets a 6-digit PIN. `pin_hash = PBKDF2-SHA256(pin, salt, 100k)` is stored in secure store; the PIN is never stored.
6. The SQLite database is opened with `PRAGMA key` from `db_key` (SQLCipher).

### 18.2 Daily use

- App launch shows the PIN screen; 5 wrong attempts triggers a 15-minute lockout; 10 wipes the local database (records already synced are on the server).
- The PIN gate is local; no server call. The JWT is refreshed opportunistically when online and is needed only for HTTPS sync.
- Deactivation: an admin flag; the next sync returns 401 with `deactivated`, and the app wipes local data. Facility devices drop the device's key from their registry on their next pull, so its SMS are rejected from then on.

### 18.3 Data minimisation

- The wire (SMS) carries client codes, not names.
- Facility devices hold names only for their own catchment.
- Logs never contain message bodies.
- Consent timestamp per household; Ghana Data Protection Act, 2012 (Act 843) as the reference framework; the district or GHS is the data controller.

---

## 19. Seed data for development and demo

`packages/core/seed/` generates a deterministic catchment: one CHPS compound, three communities, 40 households, about 60 clients across all four types, GPS points scattered along two road lines near a chosen district town, Dagomba names, delivery and EDD dates spread so the ranking is visibly sensible, one health centre and one hospital with capabilities. The same generator seeds the backend and the mobile app so demos on two phones share codes.

---

## 20. Testing

- `packages/core`: unit tests for every protocol rule (table-driven), scorer monotonicity and reason rendering, wire codec round-trips including multipart boundaries, HMAC verify/reject cases.
- Mobile: outbox worker state machine with a mocked SMS module; inbox parsing from raw broadcasts; PIN lockout.
- Backend: push idempotency (same batch twice), LWW conflicts, pull cursor correctness, gateway webhook end to end.
- Manual end-to-end script (two phones, airplane mode): enrol, rank, assess to refer, send by SMS, acknowledge on phone B, watch A update, sync A, see the web inbox card, mark arrived and treated on web, see A close and schedule follow-up.

---

## 21. Glossary

- **ANC**: antenatal care, visits during pregnancy.
- **CHO**: Community Health Officer, Ghana Health Service staff at a CHPS compound.
- **CHPS**: Community-based Health Planning and Services, Ghana's community health programme.
- **DHIS2 / DHIMS2**: District Health Information Software 2 / District Health Information Management System, Ghana's deployment of it.
- **EDD**: expected delivery date.
- **GHS**: Ghana Health Service.
- **HMAC**: hash-based message authentication code, a signature using a shared secret.
- **IMCI / IMNCI**: Integrated Management of (Neonatal and) Childhood Illness, WHO protocols.
- **LWW**: last-writer-wins conflict resolution.
- **MUAC**: mid-upper arm circumference, a tape measurement for malnutrition.
- **NHIS**: National Health Insurance Scheme.
- **PNC**: postnatal care, visits after birth.
- **SSE**: server-sent events, one-way live updates from server to browser.
- **WHO**: World Health Organization.
