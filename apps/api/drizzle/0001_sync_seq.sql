-- Server-assigned sync cursor: every insert or update of a synced row takes the next value.
CREATE SEQUENCE IF NOT EXISTS sync_seq;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION bump_seq() RETURNS trigger AS $$
BEGIN
  NEW.seq := nextval('sync_seq');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['facilities','devices','households','clients','visits','referrals','referral_events','transport_providers','transport_requests'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION bump_seq()', t || '_bump_seq', t);
  END LOOP;
END $$;
