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
cp apps/api/.env.example apps/api/.env   # fill in the database URL, JWT_SECRET, ADMIN_TOKEN, SMS_WEBHOOK_TOKEN, SMS_CALLBACK_SECRET, SEED_*
npm run db:migrate -w @laafia/api        # creates the database if it does not exist
npm run seed -w @laafia/api              # the district, the SMS gateway and the first district admin
npm run api                             # prints its URLs: localhost for this machine, the LAN one for phones
```

Check it from a phone's browser: `<LAN URL>/health` returns `{"ok":true}`.

`npm run seed` creates only what the dashboard cannot: the district (`SEED_DISTRICT_CODE`, `SEED_DISTRICT_NAME`) and its first admin (`SEED_ADMIN_*`). Re-running it never changes a password. Then sign in to the dashboard as that admin and set up the district:

1. **Facilities**: the CHPS compounds, and the health centres and hospitals that receive referrals, each with the phone number referral SMS go to.
2. **Nurses**: each nurse under her facility, and under Facility phones one phone per receiving facility. Each gets an 8-digit activation code.
3. On each phone, open Laafia and enter the code and the phone's own number.

For a ready-made demo district instead (Savelugu, sample clients and fixed activation codes), run `npm run seed:demo -w @laafia/api`. It resets that demo data every time, so never run it against a real database.

## 3. Web dashboard

```bash
cp apps/web/.env.example apps/web/.env   # API_URL, the API the dashboard proxies to under /api
npm run web                              # prints Local and Network URLs
```

Demo accounts (password `Laafia-demo-2026` for all), created by `seed:demo`:

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

Each phone is activated once with internet, with the code from the dashboard's Nurses page. With `seed:demo`, these fixed codes work:

| Code | Device | Mode |
| --- | --- | --- |
| 26100001 | D001 Abiba Sulemana | CHO |
| 26100003 | F001 Kanshegu CHPS | Facility |
| 26100004 | F002 Pong-Tamale Health Centre | Facility |
| 26100005 | F003 Savelugu Municipal Hospital | Facility |
| 26100006 | D002 Mariama Abdulai, Nabogu CHPS (no clients yet: enrol them on the phone) | CHO |

Enter the phone's real number at activation; acknowledgements and status SMS go to it. A facility phone becomes the number CHO phones text referrals to.

Then on every phone: More, Phone setup checks, and resolve every item. An APK installed outside the Play Store cannot get SMS permission until it is unlocked once: App info, the ⋮ menu, Allow restricted settings, then Permissions, SMS, Allow. On Samsung also remove Laafia from Sleeping apps and Deep sleeping apps (Settings, Battery, Background usage limits).

## 6. End-to-end check

Two phones: CHO (D001) and hospital (F003).

1. CHO: Today, open Baby of Amina, Start visit checklist.
2. Answer No to "Is the baby feeding well?". Refer now appears with the rule. Send referral.
3. Hospital phone rings with the referral, even with the app closed. Open it: danger signs, origin CHO, buttons.
4. CHO phone shows Facility received it.
5. Hospital: Arrived, Treated, Discharged. The CHO phone follows each step; after discharge the baby is back on the CHO's Today list with a follow-up.

Booking: register a client's phone at enrolment (or on her client screen via a booking from an unknown number), text the CHO phone from that number, and open Booking requests on Today. Choose a day: the client gets a confirmation now and a reminder the day before, and she is on Today that day.

Monthly report: More, Monthly report, Print or save as PDF.

The instant booking alert with the app closed and printing are native changes: rebuild the development build (section 4) once. An older build still picks up booking texts every minute while the app runs.

Signing out and unlocking: More, Sign out of this phone removes the register and returns the phone to activation (a new code from the Nurses page brings it back); it refuses while anything is still waiting to upload or send. Fingerprint or face unlock appears on the PIN screen once the development build includes `expo-local-authentication` (rebuild, section 4); More has the switch to turn it off.

Facility alarm: it rings only on a phone activated as a facility phone. On the dashboard, Phones, Facility phones, give the hospital's phone a code and activate it with the SIM that the facility's referral number belongs to; then in Laafia, More, Phone setup checks, allow notifications and the alarm over the lock screen. A referral sent to that number rings it, even with the app closed; an emergency rings until it is opened.

Delivery: on a pregnant client, Record the delivery. She becomes after delivery and each baby is enrolled as a newborn at the top of Today (visit within 48 hours); a stillbirth enrols no baby.

Duplicates: the phone warns before enrolling someone already on its register; across phones, the dashboard's Possible duplicates lists matches by phone number or by name, type and community, and Keep this one merges the rest into it (visits and referrals move across; phones update on their next sync).

Guides: More, How to use Laafia on each phone (CHO and facility versions); Guide in the dashboard menu, a tab per role.

Slip code (the SMS never arrived): the CHO's referral screen shows an eight-group slip code to write on the referral note. On the hospital phone, Incoming referrals, Slip code, type it in: the same referral opens as if the SMS had come, and the CHO is texted that it was received.

Offline variants: put the CHO phone in airplane mode with mobile signal only (no data), or with no signal at all; the SMS queues and sends when signal returns.

## 7. Tests

```bash
npm test    # core, api, mobile and web
```

## 8. Deploy

The API and the dashboard go online; the phones keep working offline and sync when they reach the API.

**API on Render** (Web Service, Node, repository root as the root directory):

- Database: a Neon (or Render) PostgreSQL; set its pooled URL as `DATABASE_URL`.
- Build command: `npm ci --include=dev && npm run db:migrate -w @laafia/api` (`tsx` and the Prisma CLI are dev dependencies)
- Start command: `npm start -w @laafia/api`
- Environment: `NODE_ENV=production`, `TRUST_PROXY=1`, `DATABASE_URL`, `JWT_SECRET` (32+ characters), `ADMIN_TOKEN` and `SMS_WEBHOOK_TOKEN` (24+ characters), and the Frog variables if the server should send SMS. Render sets `PORT`.
- Seed once from this machine, pointing at the production database (Neon's direct, non-pooled URL works best for migrations); the shell's `DATABASE_URL` wins over the one in `.env`:

  ```bash
  DATABASE_URL='<neon direct url>' npm run db:migrate -w @laafia/api
  DATABASE_URL='<neon direct url>' SEED_ADMIN_NAME='...' SEED_ADMIN_EMAIL='...' SEED_ADMIN_PASSWORD='...' \
    SEED_DISTRICT_CODE='SAV' SEED_DISTRICT_NAME='Savelugu Municipal' npm run seed -w @laafia/api
  ```

  Then create the facilities and phones from the dashboard.
- Render's free plan sleeps after 15 idle minutes, so the first sync afterwards waits for it to wake.

**Dashboard on Vercel** (root directory `apps/web`): set `API_URL` to the Render URL. The dashboard proxies `/api` to it, so sign-in cookies stay on the dashboard's own domain.

**Standalone APK** (runs without the development machine). Set `EXPO_PUBLIC_API_URL` to the Render URL under the profile's `env` in `apps/mobile/eas.json`, then:

```bash
cd apps/mobile
npx eas-cli build --platform android --profile preview
```

Install the APK from the build page on any Android phone (allow installing unknown apps) and activate it with a code from the dashboard's Nurses page. Each new version is a new APK to install.
