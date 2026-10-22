# Laafia build plan

Build brief: `docs/SPEC.md`. Demo due 23 October 2026, 09:20, HOPin Academy, Tamale.

## Scope

In: CHO, volunteer and facility modes on one Android app; Express API with sync; web facility inbox; SMS, QR and HTTPS relay; ranked visit list; WHO checklists with audio.
Out (non-goals): diagnosis, a caregiver chatbot, iOS, Play Store distribution (SMS permissions are refused there; the APK is sideloaded from EAS), a server at the CHPS compound.

## Decisions (settled)

- Express + Zod + Drizzle + PostgreSQL; Expo SDK 58 development build via EAS cloud (`eas build`), as the wastle apps do.
- npm workspaces monorepo; `packages/core` is the single source for codec, signing, rules, scorer, status and seed.
- Wire format is `packages/core/src/codec.ts`, which supersedes spec 11.3: `LFR` carries the signer device id; keys are looked up by signer, never by sender number; short ids are 8 base32 chars scoped per origin device.
- Referral status is derived from `referral_events` and only moves forward.
- Acknowledgement timeout by urgency: 10 min (3), 30 min (2), 2 h (1); then the backup number and a call button.
- Mobile uses raw SQL over `expo-sqlite` with SQLCipher (no Drizzle on the phone; a dozen tables do not need it).
- Protocol tables await review by the team clinician before any field use.

## Rule for the demo

Every feature in the spec works live in front of the judges. Nothing is shown as a placeholder or described as coming later.

Inputs only the team can supply: three Android phones with SIMs and airtime; a Dagbani speaker to record the clips (about 80, recorded in the app); a Khaya API key; a clinician's review of `packages/core/protocols`.

## Open risks

- SQLCipher and the SMS receiver only run in a development build, so nothing is proven until the first EAS build reaches a phone.
- Transsion phones (Tecno, Infinix) kill background apps; onboarding must request the autostart and battery exemptions.
- MTN may delay multipart SMS; every Laafia message is designed for one segment.
- HMAC with shared keys means a stolen facility phone could forge CHO messages; Ed25519 is the upgrade path.

## Domain invariants

1. A referral is identified by (origin device, short id); every copy on any path merges onto one record.
2. A message whose signature does not verify against its signer's key is stored as rejected and never changes state.
3. Status never regresses, whatever order the events arrive in.
4. Clinical outcomes come only from the rules engine; the scorer ranks and never classifies.
5. The wire carries client codes, never names.

## Acceptance criteria

- A day-old newborn without a postnatal visit is pinned at the top of the ranked list with the reason shown.
- Answering "not feeding" shows refer now, the rule id, the first-aid actions and the destination before the checklist ends.
- Refer now sends one signed SMS of 160 characters or fewer; in airplane mode it queues and sends when signal returns.
- The facility phone, with the app closed, raises a full-screen alert for a valid referral, ignores ordinary SMS, and rejects a tampered or unknown-signer message.
- The facility acknowledges and the CHO phone shows "received"; with no acknowledgement within the urgency timeout the CHO sees the escalation.
- A referral scanned by QR on a third phone verifies, is forwarded, and arrives once (no duplicate).
- A driver's reply "1" marks the transport request coming; "2" or silence offers the next driver.
- Pushing the same sync batch twice changes nothing; a deactivated device gets 401.

## Milestones

| # | Milestone | Owner | Evidence | State |
| --- | --- | --- | --- | --- |
| M0 | `packages/core`: codec, signing, rules + 3 protocols, scorer, route, destination, status, seed | lead | 44 Vitest tests passing | done |
| M1 | API: schema, seed, activation, sync push/pull, referral merge, inbound SMS, SSE | subagent, branch `api` | API tests incl. idempotency, merge, bad signature, 401 | in progress |
| M2 | Mobile slice: SMS native module, encrypted DB, seeded register, ranked list, checklist with audio, refer now by SMS, facility receive + acknowledge | lead | Two phones on an EAS build, airplane-mode script from spec 20 | next |
| M3 | QR hop, driver SMS and replies, escalation timers | lead | Three-phone run | |
| M4 | Mobile sync to the API; web facility inbox | lead | Push from phone appears live in the web inbox | |
| M5 | Offline map with route, DHIS2 export, in-app clip recorder + Dagbani clips, `model/train.py` writing `risk_model.json`, Khaya transcription, CSV register import | lead + team inputs | Every spec feature shown live in the demo script | |
