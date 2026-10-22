# Laafia build plan

Build brief: `docs/SPEC.md`. Demo due 23 October 2026, 09:20, HOPin Academy, Tamale.

## Scope

Two problems, nothing else:

1. Risk before crisis: a local model ranks who needs a visit today from the nurse's own assessments, and anyone scheduled for today always appears.
2. The last-mile follow-up: a referral travels by signed SMS, every step (received, arrived, treated, discharged) comes back by SMS, and discharge schedules the follow-up visit.

In: CHO and facility modes on one Android app; WHO checklists; SMS relay with HTTPS sync; ranked visit list with route order; Express API; admin dashboard (nurses' phones, facilities, referral board).
Out (non-goals): diagnosis, spoken prompts, volunteers and QR hand-carry, transport booking, in-app maps, DHIMS2 import and export (until GHS authorises it), a caregiver chatbot, iOS, Play Store distribution (SMS permissions are refused there; the APK is sideloaded from EAS), a server at the CHPS compound.

## Decisions (settled)

- Express + Zod + Prisma + PostgreSQL (owner, 22 Oct: Prisma replaces Drizzle, the house standard); Expo SDK 58 development build via EAS cloud (`eas build`), as the wastle apps do.
- npm workspaces monorepo; `packages/core` is the single source for codec, signing, rules, scorer, status and seed.
- Wire format is `packages/core/src/codec.ts`, which supersedes spec 11.3: `LFR` carries the signer device id; keys are looked up by signer, never by sender number; short ids are 8 base32 chars scoped per origin device.
- Referral status is derived from `referral_events` and only moves forward.
- Acknowledgement timeout by urgency: 10 min (3), 30 min (2), 2 h (1); then the backup number and a call button.
- Mobile uses raw SQL over `expo-sqlite` with SQLCipher (no Drizzle on the phone; a dozen tables do not need it).
- Low-end Android first: minSdk 24, Hermes, arm64-v8a and armeabi-v7a only, virtualised lists, no map tiles (directions open the phone's own map app).
- Background survival: a manifest SMS receiver; at every launch a catch-up scan of the SMS inbox for anything missed while the app was force-stopped; in facility mode a foreground service. Onboarding opens the right battery and autostart screen for the manufacturer (Samsung sleeping apps, Transsion, Xiaomi) and checks that the setting took effect.
- WHO checklists ship inside the app bundle (`packages/core/protocols`), fully offline. Every visit stores the protocol id and version. Protocol updates go out by EAS Update.
- Clients come from the nurse's enrolment and assessments. Devices pull only their catchment's active clients and 12 months of visits, paged and resumable.
- Secrets (Frog, JWT) live only in server env.
- iOS cannot read or send SMS from an app, so iPhones are out of scope.
- Protocol tables await review by the team clinician before any field use.

## Rule for the demo

Every feature in the spec works live in front of the judges. Nothing is shown as a placeholder or described as coming later.

Inputs only the team can supply: Android phones with SIMs and airtime; a clinician's review of `packages/core/protocols`.

## Open risks

- SQLCipher and the SMS receiver only run in a development build, so nothing is proven until the first EAS build reaches a phone.
- Transsion phones (Tecno, Infinix) kill background apps; onboarding must request the autostart and battery exemptions.
- MTN may delay multipart SMS; every Laafia message is designed for one segment.
- HMAC with shared keys means a stolen facility phone could forge CHO messages; Ed25519 is the upgrade path.

## Web dashboard

Roles: district admin (everything for the district), supervisor (reports and referral board, read-only), facility staff (live inbox for their own facility only; health centres and hospitals with a computer, CHPS compounds use the phone).
Screens: overview, live referral board (which CHPS referred whom to which facility, and its status), users, nurses' phones with activation codes, facilities, checklist review, SMS gateway balance and log, audit log.

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
- Pushing the same sync batch twice changes nothing; a deactivated device gets 401.

## Milestones

| # | Milestone | State |
| --- | --- | --- |
| M0 to M5 | Core, API, mobile, sync, web inbox and dashboard | done |
| M6 | Trim to the two problems: remove spoken prompts, DHIS2 import and export, transport, volunteers and QR, in-app maps | done |
| M7 | Scheduled clients always on Today; clients book by texting the nurse; printable monthly report | next |
| M8 | UI overhaul, phone and dashboard | |
