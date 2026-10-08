-- ====================================================================
-- MINECARE REALTIME PUBLICATION — ENSURE SUPABASE REALTIME REPLICATION
-- ====================================================================
-- Ensures that the supabase_realtime publication includes telemetry, helmets,
-- alerts, and zone_assignments tables for realtime change broadcast.
-- ====================================================================

DO $$
BEGIN
    -- Ensure publication exists
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;

    -- Add tables to publication if not already included
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'telemetry') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE telemetry;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'helmets') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE helmets;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'alerts') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE alerts;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'zone_assignments') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE zone_assignments;
    END IF;
END $$;
