# Running Laafia

## Requirements

- Node 24 (`.nvmrc`), npm
- PostgreSQL 16 or newer
- An Expo account with EAS access (cloud builds; no Android Studio needed)
- Android phones with SIM cards and airtime; all on the same Wi-Fi as the development machine while developing

## 1. Install

```bash
npm install
```

## 2. API

```bash
cp apps/api/.env.example apps/api/.env   # fill in the database URL, JWT_SECRET, ADMIN_TOKEN, SMS_WEBHOOK_TOKEN, SMS_CALLBACK_SECRET
npm run db:migrate -w @laafia/api        # creates the database if it does not exist
npm run seed -w @laafia/api              # prints one activation code per demo device
npm run api                             # http://<machine LAN IP>:4000
```

Check it from a phone's browser: `http://<machine LAN IP>:4000/health` returns `{"ok":true}`.

Re-running the seed resets the demo data and the activation codes.

Upload the offline map for a district once (Savelugu shown; about 7 MB):

```bash
ADMIN_TOKEN=<from apps/api/.env> scripts/district-map.sh SAV -1.05,9.35,-0.55,9.85
```

Phones download it on their next sync with internet.

## 3. Mobile app

The phone runs a development build (the app with the native SMS module) that loads JavaScript from the machine.

1. Point the app at the API: in `apps/mobile/.env` set `EXPO_PUBLIC_API_URL=http://<machine LAN IP>:4000`.
2. Start the bundler:

   ```bash
   cd apps/mobile
   npx expo start --dev-client --lan
   ```

3. Install the development build on each phone. Build it once, or again after any native change:

   ```bash
   cd apps/mobile
   npx eas-cli build --platform android --profile development
   ```

   Open the APK link from the build page on the phone and allow installing unknown apps.
4. Open Laafia on the phone, choose Enter URL manually, and enter `http://<machine LAN IP>:8081`.

## 4. Activate the phones

Each phone is activated once with internet. Use the codes the seed printed:

| Code | Device | Mode |
| --- | --- | --- |
| 26100001 | D001 Abiba Sulemana | CHO |
| 26100002 | V001 Iddrisu Mahama | Volunteer |
| 26100003 | F001 Kanshegu CHPS | Facility |
| 26100004 | F002 Pong-Tamale Health Centre | Facility |
| 26100005 | F003 Savelugu Municipal Hospital | Facility |

Enter the phone's real number at activation; acknowledgements and status SMS go to it. A facility phone becomes the number CHO phones text referrals to.

Then on every phone: More, Phone setup checks, and resolve every item. On Samsung also remove Laafia from Sleeping apps and Deep sleeping apps (Settings, Battery, Background usage limits).

## 5. End-to-end check

Two phones: CHO (D001) and hospital (F003).

1. CHO: Today, open Baby of Amina, Start visit checklist.
2. Answer No to "Is the baby feeding well?". Refer now appears with the rule. Send referral.
3. Hospital phone rings with the referral, even with the app closed. Open it: danger signs, origin CHO, buttons.
4. CHO phone shows Facility received it.
5. Hospital: Arrived, Treated, Discharged. The CHO phone follows each step; after discharge the baby is back on the CHO's Today list with a follow-up.

Offline variants: put the CHO phone in airplane mode with mobile signal only (no data), or with no signal at all; the SMS queues and sends when signal returns. QR hop: on the referral, Show QR code; scan it from the volunteer phone (More, Scan a referral QR), which forwards it by SMS.

## 6. Tests

```bash
npm test -w @laafia/core
npm test -w @laafia/mobile
npm test -w @laafia/api
```

## 7. Standalone APK

For phones that should run without the development machine, set the API URL for the profile in `apps/mobile/eas.json` (`env.EXPO_PUBLIC_API_URL`) and build:

```bash
cd apps/mobile
npx eas-cli build --platform android --profile preview
```
