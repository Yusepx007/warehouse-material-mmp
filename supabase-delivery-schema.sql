-- ============================================================
-- SCHEMA PENGIRIMAN & CLIENT TRACKING
-- Jalankan di Supabase SQL Editor
-- ============================================================

-- 1. Tabel clients (data perusahaan client)
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  code TEXT UNIQUE NOT NULL,          -- kode unik misal: CLT-001
  name TEXT NOT NULL,                 -- nama perusahaan
  address TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  pic TEXT DEFAULT '',                -- nama PIC / contact person
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabel armada (kendaraan & driver)
CREATE TABLE IF NOT EXISTS armada (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                 -- misal: Armada 1
  driver_name TEXT NOT NULL,
  plate TEXT NOT NULL,                -- nomor plat
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Tabel delivery_orders (surat jalan)
CREATE TABLE IF NOT EXISTS delivery_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  do_number TEXT UNIQUE NOT NULL,     -- misal: DO-20261113-001
  client_id UUID NOT NULL REFERENCES clients(id),
  armada_id UUID REFERENCES armada(id),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','loading','on_the_way','at_location','delivered','returned')),
  notes TEXT DEFAULT '',
  driver_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  dispatched_at TIMESTAMPTZ,
  arrived_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  returned_at TIMESTAMPTZ
);

-- 4. Tabel do_items (item dalam surat jalan)
CREATE TABLE IF NOT EXISTS do_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  do_id UUID NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  material_id UUID REFERENCES materials(id),
  part TEXT NOT NULL,
  name TEXT NOT NULL,
  qty_ordered INTEGER NOT NULL DEFAULT 1,
  qty_loaded INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','loaded')),
  scanned_at TIMESTAMPTZ,
  scanned_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Tabel gps_locations (tracking real-time)
CREATE TABLE IF NOT EXISTS gps_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  do_id UUID NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  armada_id UUID REFERENCES armada(id),
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE armada ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE do_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE gps_locations ENABLE ROW LEVEL SECURITY;

-- Closed until supabase-delivery-security.sql installs scoped policies.
CREATE POLICY "clients_closed_until_hardening" ON clients FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY "armada_closed_until_hardening" ON armada FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY "do_closed_until_hardening" ON delivery_orders FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY "do_items_closed_until_hardening" ON do_items FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY "gps_closed_until_hardening" ON gps_locations FOR ALL USING (false) WITH CHECK (false);

-- ============================================================
-- REALTIME (untuk GPS live tracking)
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE gps_locations;
ALTER PUBLICATION supabase_realtime ADD TABLE delivery_orders;

-- ============================================================
-- INDEX untuk performa
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_do_client ON delivery_orders(client_id);
CREATE INDEX IF NOT EXISTS idx_do_status ON delivery_orders(status);
CREATE INDEX IF NOT EXISTS idx_do_token ON delivery_orders(driver_token);
CREATE INDEX IF NOT EXISTS idx_do_items_do ON do_items(do_id);
CREATE INDEX IF NOT EXISTS idx_gps_do ON gps_locations(do_id);
CREATE INDEX IF NOT EXISTS idx_gps_recorded ON gps_locations(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_clients_user ON clients(user_id);
