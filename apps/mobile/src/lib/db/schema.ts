import type { Db } from './db'

/*
 * Local schema (spec section 5). Synced tables carry updated_at, device_id,
 * synced and deleted. JSON columns are TEXT. Each migration runs once, tracked
 * by PRAGMA user_version.
 *
 * Foreign keys are declared for documentation but not enforced (SQLite's
 * default): sync pages arrive in server order, so a visit can land before its
 * client, and a referral first seen by SMS is re-keyed to the server's id.
 */
const SYNC = `updated_at INTEGER NOT NULL, device_id TEXT NOT NULL, synced INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0`

export const MIGRATIONS: string[] = [
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE facilities (
    id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, level TEXT NOT NULL,
    phone TEXT, lat REAL NOT NULL, lng REAL NOT NULL, capabilities TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE devices (
    id TEXT PRIMARY KEY, role TEXT NOT NULL, user_name TEXT NOT NULL, phone_number TEXT NOT NULL,
    facility_code TEXT, key_hex TEXT, active INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX devices_phone ON devices(phone_number);

  CREATE TABLE households (
    id TEXT PRIMARY KEY, community TEXT NOT NULL, head_name TEXT NOT NULL, landmark TEXT NOT NULL,
    lat REAL, lng REAL, consent_at INTEGER, ${SYNC}
  );

  CREATE TABLE clients (
    id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id), code TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL, name TEXT NOT NULL, sex TEXT, dob INTEGER, edd INTEGER, delivery_date INTEGER,
    parity INTEGER, prior_complications TEXT NOT NULL DEFAULT '[]', birth_weight_g INTEGER,
    nhis_active INTEGER NOT NULL DEFAULT 0, next_of_kin TEXT, ${SYNC}
  );
  CREATE INDEX clients_household ON clients(household_id);

  CREATE TABLE visits (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), protocol_id TEXT NOT NULL,
    protocol_version INTEGER NOT NULL, visited_at INTEGER NOT NULL, answers TEXT NOT NULL, outcome TEXT NOT NULL,
    rule_id TEXT NOT NULL, followup_due INTEGER, muac_mm INTEGER, notes TEXT, ${SYNC}
  );
  CREATE INDEX visits_client ON visits(client_id, visited_at);

  CREATE TABLE referrals (
    id TEXT PRIMARY KEY, origin_device_id TEXT NOT NULL, short_id TEXT NOT NULL,
    client_id TEXT, client_code TEXT NOT NULL, client_type TEXT NOT NULL, context TEXT NOT NULL,
    urgency INTEGER NOT NULL, sign_codes TEXT NOT NULL, destination_code TEXT NOT NULL, next_of_kin TEXT,
    visit_id TEXT, wire TEXT NOT NULL, created_at INTEGER NOT NULL, ${SYNC},
    UNIQUE (origin_device_id, short_id)
  );

  CREATE TABLE referral_events (
    id TEXT PRIMARY KEY, referral_id TEXT NOT NULL REFERENCES referrals(id), status TEXT NOT NULL,
    at INTEGER NOT NULL, source_device_id TEXT NOT NULL, via TEXT NOT NULL, ${SYNC},
    UNIQUE (referral_id, status, source_device_id)
  );
  CREATE INDEX referral_events_referral ON referral_events(referral_id);

  CREATE TABLE transport_providers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL, vehicle TEXT NOT NULL, community TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1, ${SYNC}
  );

  CREATE TABLE transport_requests (
    id TEXT PRIMARY KEY, referral_id TEXT, client_id TEXT, provider_id TEXT NOT NULL REFERENCES transport_providers(id),
    status TEXT NOT NULL, scheduled_for INTEGER, requested_at INTEGER NOT NULL, ${SYNC}
  );
  CREATE INDEX transport_requests_open ON transport_requests(status);

  CREATE TABLE outbox (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, recipient TEXT NOT NULL, body TEXT NOT NULL,
    ref_table TEXT, ref_id TEXT, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT, next_attempt_at INTEGER NOT NULL, sending_since INTEGER, sim_index INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX outbox_due ON outbox(status, next_attempt_at);

  CREATE TABLE inbox (
    id TEXT PRIMARY KEY, sender TEXT NOT NULL, body TEXT NOT NULL, received_at INTEGER NOT NULL,
    via TEXT NOT NULL, result TEXT, UNIQUE (sender, body, received_at)
  );

  CREATE TABLE overrides (
    id TEXT PRIMARY KEY, day TEXT NOT NULL, client_id TEXT NOT NULL, manual_rank INTEGER NOT NULL, ${SYNC}
  );

  CREATE TABLE audio_clips (
    prompt_id TEXT NOT NULL, lang TEXT NOT NULL, uri TEXT NOT NULL, recorded_at INTEGER NOT NULL,
    PRIMARY KEY (prompt_id, lang)
  );
  `,
  // Recorded clips travel to the server and back (lib/content.ts).
  `
  ALTER TABLE audio_clips ADD COLUMN uploaded_sha TEXT;
  ALTER TABLE audio_clips ADD COLUMN source TEXT NOT NULL DEFAULT 'local';
  `,
  // Refer onward: the facility's own referral points back at the one it received.
  `ALTER TABLE referrals ADD COLUMN parent_referral_id TEXT;`,
  // Spoken prompts were removed from the app.
  `DROP TABLE audio_clips;`,
  // Drivers and transport requests were removed from the app.
  `DROP TABLE transport_requests; DROP TABLE transport_providers;`,
]

export async function migrate(db: Db): Promise<void> {
  const row = await db.get<{ user_version: number }>('PRAGMA user_version')
  for (let v = row?.user_version ?? 0; v < MIGRATIONS.length; v++) {
    await db.tx(async () => {
      await db.exec(MIGRATIONS[v]!)
      await db.exec(`PRAGMA user_version = ${v + 1}`)
    })
  }
}
