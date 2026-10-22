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
npm run api                             # prints its URLs: localhost for this machine, the LAN one for phones
```

Check it from a phone's browser: `<LAN URL>/health` returns `{"ok":true}`.

Re-running the seed resets the demo data and the activation codes.

Install the map cutter once per machine (the API runs it from `apps/api/bin`):

```bash
scripts/get-pmtiles.sh
```

Then make each district's offline map from the dashboard: **Maps → Make the map**. Phones download it on their next sync with internet.

## 3. Web dashboard

```bash
cp apps/web/.env.example apps/web/.env   # API_URL, the API the dashboard proxies to under /api
npm run web                              # prints Local and Network URLs
```

Demo accounts (password `Laafia-demo-2026` for all), created by the seed:

| Login | Role | Sees |
| --- | --- | --- |
| admin@laafia.demo | District admin | Everything for Savelugu district |
| supervisor@laafia.demo | Supervisor | Overview, referrals and checklists, read only |
| hospital@laafia.demo | Facility staff | Savelugu Municipal Hospital's inbox and actions |
| healthcentre@laafia.demo | Facility staff | Pong-Tamale Health Centre's inbox and actions |

## 4. Mobile app

The phone runs a development build (the app with the native SMS module) that loads JavaScript from the machine.

1. Start the bundler (leave `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` empty: the app then uses the API on the same machine):

   ```bash
   cd apps/mobile
   npx expo start --dev-client --lan
   ```

2. Install the development build on each phone. Build it once, or again after any native change:

   ```bash
   cd apps/mobile
   npx eas-cli build --platform android --profile development
   ```

   Open the APK link from the build page on the phone and allow installing unknown apps.
3. Open Laafia on the phone, choose Enter URL manually, and enter `http://<machine LAN IP>:8081` (the IP from the API's Network URL). If the laptop changes Wi-Fi, restart the three servers and enter the new IP.

## 5. Activate the phones

Each phone is activated once with internet. Use the codes the seed printed:

| Code | Device | Mode |
| --- | --- | --- |
| 26100001 | D001 Abiba Sulemana | CHO |
| 26100002 | V001 Iddrisu Mahama | Volunteer |
| 26100003 | F001 Kanshegu CHPS | Facility |
| 26100004 | F002 Pong-Tamale Health Centre | Facility |
| 26100005 | F003 Savelugu Municipal Hospital | Facility |
| 26100006 | D002 Mariama Abdulai, Nabogu CHPS (no catchment until the register is imported) | CHO |

Enter the phone's real number at activation; acknowledgements and status SMS go to it. A facility phone becomes the number CHO phones text referrals to.

Then on every phone: More, Phone setup checks, and resolve every item. On Samsung also remove Laafia from Sleeping apps and Deep sleeping apps (Settings, Battery, Background usage limits).

## 6. End-to-end check

Two phones: CHO (D001) and hospital (F003).

1. CHO: Today, open Baby of Amina, Start visit checklist.
2. Answer No to "Is the baby feeding well?". Refer now appears with the rule. Send referral.
3. Hospital phone rings with the referral, even with the app closed. Open it: danger signs, origin CHO, buttons.
4. CHO phone shows Facility received it.
5. Hospital: Arrived, Treated, Discharged. The CHO phone follows each step; after discharge the baby is back on the CHO's Today list with a follow-up.

Offline variants: put the CHO phone in airplane mode with mobile signal only (no data), or with no signal at all; the SMS queues and sends when signal returns. QR hop: on the referral, Show QR code; scan it from the volunteer phone (More, Scan a referral QR), which forwards it by SMS.

## 7. Demo: onboard a CHPS and DHIMS2

DHIMS2 runs here against DHIS2's public demo server (Sierra Leone sample data), set in `apps/api/.env`. The live DHIMS2 needs Ghana Health Service authorisation; only the URL, the login and `docs/dhis2-mapping.json` change.

Before the demo (the demo server resets now and then):

```bash
scripts/dhis2-demo-setup.sh               # loads the Laafia CHPS programme onto the DHIS2 server; safe to re-run
```

1. **Import the register.** Dashboard as admin, Import, From a file: template *CHPS client register*, facility *Nabogu CHPS*, file `docs/demo/nabogu-chps-register.csv`. The preview shows 28 people in 13 households ready, row 29 rejected (ANC without an EDD) and row 30 a duplicate. Confirm the import.
2. **Map the new area.** Maps, Make the map: the suggested area now takes in Nabogu, Gushie and Dipale.
3. **CHO phone.** Activate with `26100006`. The first sync brings Nabogu's 28 clients, ranked, and the map. A phone already activated as another device needs its app data cleared first (Android Settings, Apps, Laafia, Storage).
4. **Pull from DHIMS2.** Import, DHIMS2: template *DHIS2 Child Programme*, any facility, org unit `DiszpKrYNg8`, programme `IpHINAT79UW`. The preview lists the server's children; leave it unconfirmed.
5. **Report to DHIMS2.** DHIMS2 export: *Kanshegu CHPS*, this month, Check with DHIMS2. DHIS2 validates the people, visits, referrals and monthly totals and saves nothing.

To run it again, Undo the Nabogu import on the Import page.

## 8. Tests

```bash
npm test    # core, api, mobile and web
```

## 9. Standalone APK

For phones that should run without the development machine, set the API URL for the profile in `apps/mobile/eas.json` (`env.EXPO_PUBLIC_API_URL`) and build:

```bash
cd apps/mobile
npx eas-cli build --platform android --profile preview
cd apps/mobile && npx expo start --dev-client --lan
```
