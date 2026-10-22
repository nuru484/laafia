# Laafia

Offline-first app for Community Health Officers in Northern Ghana: a ranked list of who to visit today, and referrals tracked by SMS until the patient is discharged and followed up.
Built for the UNICEF StartUp Lab AI for Nurturing Care Hackathon, Tamale, October 2026.

- `apps/mobile` Expo app (CHO and facility modes)
- `apps/api` Express backend
- `apps/web` Next.js admin dashboard: nurses' phones, facilities, referral board
- `packages/core` rules engine, scorer, SMS codec, signing, shared types
- `model` ranking model training
- `docs/SPEC.md` technical specification
