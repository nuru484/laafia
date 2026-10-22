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
| 26100003 | F001 Kanshegu CHPS | Facility |
| 26100004 | F002 Pong-Tamale Health Centre | Facility |
| 26100005 | F003 Savelugu Municipal Hospital | Facility |
| 26100006 | D002 Mariama Abdulai, Nabogu CHPS (no clients yet: enrol them on the phone) | CHO |

Enter the phone's real number at activation; acknowledgements and status SMS go to it. A facility phone becomes the number CHO phones text referrals to.

Then on every phone: More, Phone setup checks, and resolve every item. On Samsung also remove Laafia from Sleeping apps and Deep sleeping apps (Settings, Battery, Background usage limits).

## 6. End-to-end check

Two phones: CHO (D001) and hospital (F003).

1. CHO: Today, open Baby of Amina, Start visit checklist.
2. Answer No to "Is the baby feeding well?". Refer now appears with the rule. Send referral.
3. Hospital phone rings with the referral, even with the app closed. Open it: danger signs, origin CHO, buttons.
4. CHO phone shows Facility received it.
5. Hospital: Arrived, Treated, Discharged. The CHO phone follows each step; after discharge the baby is back on the CHO's Today list with a follow-up.

Offline variants: put the CHO phone in airplane mode with mobile signal only (no data), or with no signal at all; the SMS queues and sends when signal returns.

## 7. Tests

```bash
npm test    # core, api, mobile and web
```

## 8. Deploy

The API and the dashboard go online; the phones keep working offline and sync when they reach the API.

**API on Render** (Web Service, Node, repository root as the root directory):

- Database: a Render or Neon PostgreSQL; set its URL as `DATABASE_URL`.
- Build command: `npm ci --include=dev && npm run db:migrate -w @laafia/api` (`tsx` and the Prisma CLI are dev dependencies)
- Start command: `npm start -w @laafia/api`
- Environment: `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET` (32+ characters), `ADMIN_TOKEN` and `SMS_WEBHOOK_TOKEN` (24+ characters), and the Frog variables if the server should send SMS. Render sets `PORT`.
- Seed once from a shell with the production `DATABASE_URL`: `npm run seed -w @laafia/api`.
- Render's free plan sleeps after 15 idle minutes, so the first sync afterwards waits for it to wake.

**Dashboard on Vercel** (root directory `apps/web`): set `API_URL` to the Render URL. The dashboard proxies `/api` to it, so sign-in cookies stay on the dashboard's own domain.

**Standalone APK** (runs without the development machine). Set `EXPO_PUBLIC_API_URL` to the Render URL under the profile's `env` in `apps/mobile/eas.json`, then:

```bash
cd apps/mobile
npx eas-cli build --platform android --profile preview
```

Install the APK from the build page on any Android phone (allow installing unknown apps) and activate it with a code from the dashboard's Phones page. Each new version is a new APK to install.
