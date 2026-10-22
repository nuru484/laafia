-- Server-assigned sync cursor, which Prisma cannot express: a global sequence
-- and a BEFORE INSERT OR UPDATE trigger on every synced table that sets
-- "seq" to the next value. /sync/pull pages on it (docs/API.md). Prisma
-- ignores sequences, functions and triggers, so later migrations leave this alone.
CREATE SEQUENCE IF NOT EXISTS sync_seq;

CREATE OR REPLACE FUNCTION bump_seq() RETURNS trigger AS $$
BEGIN
  NEW.seq := nextval('sync_seq');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['facilities','devices','households','clients','visits','referrals','referral_events','transport_providers','transport_requests'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION bump_seq()', t || '_bump_seq', t);
  END LOOP;
END $$;
