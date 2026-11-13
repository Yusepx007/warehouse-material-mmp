'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

type DOStatus =
  | 'draft'
  | 'loading'
  | 'on_the_way'
  | 'at_location'
  | 'delivered'
  | 'returned';

interface DoItem {
  id: string;
  material_id: string;
  part: string;
  name: string;
  qty_ordered: number;
  qty_loaded: number;
  status: 'pending' | 'loaded';
  scanned_at: string | null;
}

interface Armada {
  id: string;
  name: string;
  driver_name: string;
  plate: string;
}

interface Client {
  id: string;
  name: string;
  code: string;
}

interface DeliveryOrder {
  id: string;
  do_number: string;
  client_id: string;
  armada_id: string;
  status: DOStatus;
  notes: string | null;
  created_at: string;
  dispatched_at: string | null;
  arrived_at: string | null;
  delivered_at: string | null;
  returned_at: string | null;
  do_items: DoItem[];
  armada: Armada | null;
  clients: Client | null;
}

interface GpsLocation {
  lat: number;
  lng: number;
  recorded_at: string;
}

type View = 'login' | 'dashboard' | 'detail';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<DOStatus, string> = {
  draft: 'Draft',
  loading: 'Loading',
  on_the_way: 'Dalam Perjalanan',
  at_location: 'Di Lokasi',
  delivered: 'Diterima',
  returned: 'Dikembalikan',
};

const STATUS_COLOR: Record<DOStatus, string> = {
  draft: '#6b7280',
  loading: '#d97706',
  on_the_way: '#2563eb',
  at_location: '#f59e0b',
  delivered: '#16a34a',
  returned: '#dc2626',
};

const ACTIVE_STATUSES: DOStatus[] = ['loading', 'on_the_way', 'at_location'];
const HISTORY_STATUSES: DOStatus[] = ['delivered', 'returned'];
const TIMELINE_STEPS: { status: DOStatus; label: string }[] = [
  { status: 'draft', label: 'Draft' },
  { status: 'loading', label: 'Loading' },
  { status: 'on_the_way', label: 'Dalam Perjalanan' },
  { status: 'at_location', label: 'Di Lokasi' },
  { status: 'delivered', label: 'Diterima ✅' },
];

function fmt(dt: string | null) {
  if (!dt) return '-';
  return new Date(dt).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Leaflet loader ───────────────────────────────────────────────────────────

function loadLeaflet(): Promise<void> {
  return new Promise((resolve) => {
    if ((window as unknown as Record<string, unknown>)['L']) {
      resolve();
      return;
    }
    // CSS
    if (!document.querySelector('link[href*="leaflet"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    // JS
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => resolve();
    document.head.appendChild(script);
  });
}

// ─── Map Component ────────────────────────────────────────────────────────────

function LiveMap({ doId, initialGps }: { doId: string; initialGps: GpsLocation | null }) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const updateMarker = useCallback((lat: number, lng: number) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const L = (window as any).L;
    if (!L || !mapRef.current) return;
    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng]);
    } else {
      markerRef.current = L.marker([lat, lng]).addTo(mapRef.current).bindPopup('🚛 Posisi Armada');
    }
    mapRef.current.setView([lat, lng], 15);
  }, []);

  useEffect(() => {
    let alive = true;

    loadLeaflet().then(() => {
      if (!alive || !mapContainerRef.current) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const L = (window as any).L;

      if (!mapRef.current) {
        mapRef.current = L.map(mapContainerRef.current).setView(
          initialGps ? [initialGps.lat, initialGps.lng] : [-6.2, 106.8],
          initialGps ? 15 : 5
        );
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors',
        }).addTo(mapRef.current);
      }

      if (initialGps) updateMarker(initialGps.lat, initialGps.lng);

      // Realtime via Supabase
      channelRef.current = supabase
        .channel('gps-' + doId)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'gps_locations', filter: `do_id=eq.${doId}` },
          (payload) => {
            const { lat, lng } = payload.new as { lat: number; lng: number };
            updateMarker(lat, lng);
          }
        )
        .subscribe();

      // Polling fallback every 10 s
      pollRef.current = setInterval(async () => {
        const { data } = await supabase
          .from('gps_locations')
          .select('*')
          .eq('do_id', doId)
          .order('recorded_at', { ascending: false })
          .limit(1)
          .single();
        if (data) updateMarker(data.lat, data.lng);
      }, 10000);
    });

    return () => {
      alive = false;
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doId]);

  return (
    <div
      ref={mapContainerRef}
      style={{ height: 320, width: '100%', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}
    />
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ClientPortalPage() {
  // Auth
  const [view, setView] = useState<View>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Client data
  const [clientData, setClientData] = useState<Client | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // DOs
  const [activeDOs, setActiveDOs] = useState<DeliveryOrder[]>([]);
  const [historyDOs, setHistoryDOs] = useState<DeliveryOrder[]>([]);
  const [dosLoading, setDosLoading] = useState(false);
  const [arrivalNotice, setArrivalNotice] = useState('');

  // Detail
  const [selectedDO, setSelectedDO] = useState<DeliveryOrder | null>(null);
  const [initialGps, setInitialGps] = useState<GpsLocation | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmSuccess, setConfirmSuccess] = useState(false);

  // ── Check session on mount ────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        setUserId(session.user.id);
        await loadClientData(session.user.id);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setView('login');
        setClientData(null);
        setUserId(null);
        setActiveDOs([]);
        setHistoryDOs([]);
        setSelectedDO(null);
      }
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load client record ────────────────────────────────────────────────────
  const loadClientData = async (uid: string) => {
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .eq('user_id', uid)
      .eq('active', true)
      .single();

    if (error || !data) {
      setAuthError('Akun ini tidak terdaftar sebagai client.');
      await supabase.auth.signOut();
      return;
    }
    setClientData(data);
    setView('dashboard');
    await loadDOs(data.id);
  };

  // ── Load DOs ──────────────────────────────────────────────────────────────
  const loadDOs = useCallback(async (clientId: string) => {
    setDosLoading(true);
    const { data, error } = await supabase
      .from('delivery_orders')
      .select('*, do_items(*), armada(*), clients(*)')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });

    if (!error && data) {
      const orders = data as DeliveryOrder[];
      setActiveDOs(orders.filter((d) => ACTIVE_STATUSES.includes(d.status)));
      setHistoryDOs(orders.filter((d) => HISTORY_STATUSES.includes(d.status)));
      setSelectedDO((current) => current ? orders.find((d) => d.id === current.id) ?? current : current);
    }
    setDosLoading(false);
  }, []);

  useEffect(() => {
    if (!clientData) return;
    const channel = supabase.channel(`client-do-${clientData.id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'delivery_orders', filter: `client_id=eq.${clientData.id}`,
      }, (payload) => {
        const updated = payload.new as DeliveryOrder;
        if (updated.status === 'at_location') {
          setArrivalNotice(`Armada sudah di lokasi PT ${clientData.name} · DO ${updated.do_number}`);
        }
        setSelectedDO((current) => current?.id === updated.id ? { ...current, ...updated } : current);
        void loadDOs(clientData.id);
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [clientData, loadDOs]);

  // ── Login ─────────────────────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setLoginLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setAuthError(error.message);
      setLoginLoading(false);
      return;
    }
    if (data.user) {
      setUserId(data.user.id);
      await loadClientData(data.user.id);
    }
    setLoginLoading(false);
  };

  // ── Logout ────────────────────────────────────────────────────────────────
  const handleLogout = async () => {
    await supabase.auth.signOut();
    setView('login');
    setClientData(null);
    setActiveDOs([]);
    setHistoryDOs([]);
    setSelectedDO(null);
  };

  // ── Open DO detail ────────────────────────────────────────────────────────
  const openDetail = async (doItem: DeliveryOrder) => {
    setSelectedDO(doItem);
    setConfirmSuccess(false);
    setView('detail');

    // Load latest GPS
    if (doItem.status === 'on_the_way' || doItem.status === 'at_location') {
      const { data } = await supabase
        .from('gps_locations')
        .select('*')
        .eq('do_id', doItem.id)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .single();
      setInitialGps(data as GpsLocation | null);
    } else {
      setInitialGps(null);
    }
  };

  // ── Konfirmasi Barang Diterima ─────────────────────────────────────────────
  const handleConfirmReceived = async () => {
    if (!selectedDO) return;
    setConfirmLoading(true);
    const { error } = await supabase.rpc('confirm_delivery_received', { p_do_id: selectedDO.id });

    if (!error) {
      setConfirmSuccess(true);
      const updated: DeliveryOrder = { ...selectedDO, status: 'delivered', delivered_at: new Date().toISOString() };
      setSelectedDO(updated);
      // Refresh lists
      if (clientData) await loadDOs(clientData.id);
    } else window.alert('Gagal mengonfirmasi penerimaan: ' + error.message);
    setConfirmLoading(false);
  };

  // ─── Renders ──────────────────────────────────────────────────────────────

  if (view === 'login') {
    return (
      <div style={styles.loginBg}>
        <div style={styles.loginCard}>
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={styles.logoBox}>📦</div>
            <h1 style={styles.loginTitle}>Client Portal</h1>
            <p style={styles.loginSub}>Sistem Pelacakan Pengiriman MMP</p>
          </div>

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: 16 }}>
              <label style={styles.label}>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@perusahaan.com"
                required
                style={styles.input}
              />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={styles.label}>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                style={styles.input}
              />
            </div>

            {authError && (
              <div style={styles.errorBox}>{authError}</div>
            )}

            <button type="submit" disabled={loginLoading} style={styles.btnPrimary}>
              {loginLoading ? 'Masuk...' : 'Masuk ke Portal'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (view === 'detail' && selectedDO) {
    const showMap = selectedDO.status === 'on_the_way' || selectedDO.status === 'at_location';
    const showBanner = selectedDO.status === 'at_location';
    const showConfirm = selectedDO.status === 'at_location' && !confirmSuccess;
    const totalItems = selectedDO.do_items?.length ?? 0;
    const loadedItems = selectedDO.do_items?.filter((i) => i.status === 'loaded').length ?? 0;
    const allItemsLoaded = totalItems > 0 && selectedDO.do_items.every((i) => i.status === 'loaded' && i.qty_loaded >= i.qty_ordered);
    const progressPct = totalItems > 0 ? Math.round((loadedItems / totalItems) * 100) : 0;

    return (
      <div style={styles.appBg}>
        {/* Header */}
        <div style={styles.header}>
          <button onClick={() => { setView('dashboard'); setSelectedDO(null); }} style={styles.backBtn}>
            ← Kembali
          </button>
          <span style={styles.headerTitle}>Detail Pengiriman</span>
          <button onClick={handleLogout} style={styles.logoutBtn}>Keluar</button>
        </div>

        <div style={styles.content}>
          {/* Banner at_location */}
          {showBanner && (
            <div style={styles.banner}>
              🚚 Armada sudah di lokasi PT {selectedDO.clients?.name ?? clientData?.name ?? ''}
            </div>
          )}

          {/* Confirm success */}
          {confirmSuccess && (
            <div style={styles.bannerSuccess}>
              ✅ Konfirmasi penerimaan berhasil dicatat!
            </div>
          )}

          {/* DO Info */}
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Informasi DO</h2>
            <div style={styles.infoGrid}>
              <InfoRow label="Nomor DO" value={selectedDO.do_number} />
              <InfoRow label="Tanggal" value={fmt(selectedDO.created_at)} />
              <InfoRow label="Armada" value={selectedDO.armada?.name ?? '-'} />
              <InfoRow label="Driver" value={selectedDO.armada?.driver_name ?? '-'} />
              <InfoRow label="Plat" value={selectedDO.armada?.plate ?? '-'} />
              <InfoRow
                label="Status"
                value={
                  <span
                    style={{
                      ...styles.badge,
                      background: STATUS_COLOR[selectedDO.status] + '22',
                      color: STATUS_COLOR[selectedDO.status],
                      border: `1px solid ${STATUS_COLOR[selectedDO.status]}44`,
                    }}
                  >
                    {STATUS_LABEL[selectedDO.status]}
                  </span>
                }
              />
              {selectedDO.dispatched_at && (
                <InfoRow label="Berangkat" value={fmt(selectedDO.dispatched_at)} />
              )}
              {selectedDO.arrived_at && (
                <InfoRow label="Tiba" value={fmt(selectedDO.arrived_at)} />
              )}
              {selectedDO.delivered_at && (
                <InfoRow label="Diterima" value={fmt(selectedDO.delivered_at)} />
              )}
            </div>
          </div>

          {/* Timeline */}
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Status Timeline</h2>
            <Timeline status={selectedDO.status} />
          </div>

          {/* Material Progress */}
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Progress Material</h2>
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                <span>{loadedItems} / {totalItems} item dimuat</span>
                <span style={{ fontWeight: 600 }}>{progressPct}%</span>
              </div>
              <div style={styles.progressTrack}>
                <div style={{ ...styles.progressFill, width: `${progressPct}%` }} />
              </div>
            </div>
            {selectedDO.do_items?.map((item) => (
              <div key={item.id} style={styles.itemRow}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>{item.name}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{item.part}</div>
                </div>
                <div style={{ textAlign: 'right', marginLeft: 12 }}>
                  <div style={{ fontSize: 13 }}>{item.qty_loaded}/{item.qty_ordered}</div>
                  <span
                    style={{
                      ...styles.badgeSm,
                      background: item.status === 'loaded' ? '#dcfce7' : '#fef9c3',
                      color: item.status === 'loaded' ? '#16a34a' : '#92400e',
                    }}
                  >
                    {item.status === 'loaded' ? 'Dimuat' : 'Pending'}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Live Map */}
          {showMap && (
            <div style={styles.card}>
              <h2 style={styles.cardTitle}>Live Tracking 🗺️</h2>
              <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
                Posisi armada diperbarui otomatis setiap 10 detik
              </p>
              <LiveMap doId={selectedDO.id} initialGps={initialGps} />
            </div>
          )}

          {/* Konfirmasi Terima */}
          {showConfirm && (
            <div style={{ marginBottom: 20 }}>
              {!allItemsLoaded && <p style={styles.notice}>Penerimaan bisa dikonfirmasi setelah semua item ditandai selesai dimuat oleh gudang.</p>}
              <button
                onClick={handleConfirmReceived}
                disabled={confirmLoading || !allItemsLoaded}
                style={{ ...styles.btnPrimary, background: allItemsLoaded ? '#16a34a' : '#94a3b8', marginBottom: 20, cursor: allItemsLoaded ? 'pointer' : 'not-allowed' }}
              >
                {confirmLoading ? 'Memproses...' : '✅ Konfirmasi Barang Diterima'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Dashboard
  return (
    <div style={styles.appBg}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <div style={styles.headerTitle}>Client Portal</div>
          <div style={{ fontSize: 12, color: '#93c5fd' }}>{clientData?.name ?? ''}</div>
        </div>
        <button onClick={handleLogout} style={styles.logoutBtn}>Keluar</button>
      </div>

      <div style={styles.content}>
        {arrivalNotice && <div style={styles.banner}>{arrivalNotice}<button onClick={() => setArrivalNotice('')} style={{ float: 'right', border: 0, background: 'transparent', color: 'white', fontSize: 18, cursor: 'pointer' }} aria-label="Tutup notifikasi">×</button></div>}
        {dosLoading ? (
          <div style={styles.loadingBox}>Memuat data pengiriman...</div>
        ) : (
          <>
            {/* Active DOs */}
            <Section title={`🚚 Pengiriman Aktif (${activeDOs.length})`}>
              {activeDOs.length === 0 ? (
                <EmptyState text="Tidak ada pengiriman aktif" />
              ) : (
                activeDOs.map((d) => (
                  <DOCard key={d.id} do_={d} onClick={() => openDetail(d)} />
                ))
              )}
            </Section>

            {/* History DOs */}
            <Section title={`📋 Riwayat Pengiriman (${historyDOs.length})`}>
              {historyDOs.length === 0 ? (
                <EmptyState text="Belum ada riwayat pengiriman" />
              ) : (
                historyDOs.map((d) => (
                  <DOCard key={d.id} do_={d} onClick={() => openDetail(d)} />
                ))
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: '#1e3a5f', marginBottom: 12 }}>{title}</h2>
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '24px 0', color: '#9ca3af', fontSize: 14 }}>
      {text}
    </div>
  );
}

function DOCard({ do_, onClick }: { do_: DeliveryOrder; onClick: () => void }) {
  const totalItems = do_.do_items?.length ?? 0;
  const loadedItems = do_.do_items?.filter((i) => i.status === 'loaded').length ?? 0;
  return (
    <div onClick={onClick} style={styles.doCard}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: '#1e3a5f' }}>{do_.do_number}</span>
        <span
          style={{
            ...styles.badge,
            background: STATUS_COLOR[do_.status] + '22',
            color: STATUS_COLOR[do_.status],
            border: `1px solid ${STATUS_COLOR[do_.status]}44`,
          }}
        >
          {STATUS_LABEL[do_.status]}
        </span>
      </div>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>
        {do_.armada?.name ?? 'Belum ada armada'} • {do_.armada?.driver_name ?? '-'}
      </div>
      <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 10 }}>
        {fmt(do_.created_at)}
      </div>
      {/* Mini progress */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ ...styles.progressTrack, flex: 1, height: 6 }}>
          <div
            style={{
              ...styles.progressFill,
              width: totalItems > 0 ? `${Math.round((loadedItems / totalItems) * 100)}%` : '0%',
              height: '100%',
            }}
          />
        </div>
        <span style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap' }}>
          {loadedItems}/{totalItems} item
        </span>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
      <span style={{ width: 110, fontSize: 13, color: '#6b7280', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{value}</span>
    </div>
  );
}

function Timeline({ status }: { status: DOStatus }) {
  const isReturned = status === 'returned';
  const steps = isReturned
    ? [
        { status: 'draft' as DOStatus, label: 'Draft' },
        { status: 'loading' as DOStatus, label: 'Loading' },
        { status: 'on_the_way' as DOStatus, label: 'Dalam Perjalanan' },
        { status: 'at_location' as DOStatus, label: 'Di Lokasi' },
        { status: 'returned' as DOStatus, label: 'Dikembalikan ❌' },
      ]
    : TIMELINE_STEPS;

  const currentIdx = steps.findIndex((s) => s.status === status);

  return (
    <div style={{ display: 'flex', alignItems: 'center', overflowX: 'auto', paddingBottom: 4 }}>
      {steps.map((step, idx) => {
        const done = idx <= currentIdx;
        const isActive = idx === currentIdx;
        return (
          <div key={step.status} style={{ display: 'flex', alignItems: 'center', flex: idx < steps.length - 1 ? 1 : 'initial' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 60 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: isActive ? '#1769f6' : done ? '#1769f6' : '#e5e7eb',
                  border: isActive ? '3px solid #93c5fd' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  color: done ? '#fff' : '#9ca3af',
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {done ? '✓' : idx + 1}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: isActive ? '#1769f6' : done ? '#374151' : '#9ca3af',
                  fontWeight: isActive ? 700 : 400,
                  textAlign: 'center',
                  marginTop: 4,
                  maxWidth: 60,
                  lineHeight: 1.3,
                }}
              >
                {step.label}
              </div>
            </div>
            {idx < steps.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: 3,
                  background: idx < currentIdx ? '#1769f6' : '#e5e7eb',
                  margin: '0 4px',
                  marginBottom: 20,
                  minWidth: 20,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  loginBg: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #0f1d3a 0%, #1769f6 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  loginCard: {
    background: '#fff',
    borderRadius: 20,
    padding: '40px 32px',
    width: '100%',
    maxWidth: 400,
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  },
  logoBox: {
    fontSize: 40,
    display: 'inline-block',
    background: '#eff6ff',
    borderRadius: 16,
    padding: '12px 16px',
    marginBottom: 16,
  },
  loginTitle: {
    fontSize: 24,
    fontWeight: 800,
    color: '#0f1d3a',
    margin: '0 0 4px',
  },
  loginSub: {
    fontSize: 14,
    color: '#6b7280',
    margin: 0,
  },
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: '#374151',
    marginBottom: 6,
  },
  input: {
    width: '100%',
    padding: '10px 14px',
    border: '1.5px solid #e5e7eb',
    borderRadius: 10,
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border 0.2s',
  },
  errorBox: {
    background: '#fef2f2',
    border: '1px solid #fca5a5',
    color: '#dc2626',
    borderRadius: 8,
    padding: '10px 14px',
    fontSize: 13,
    marginBottom: 16,
  },
  notice: {
    background: '#fffbeb',
    color: '#92400e',
    border: '1px solid #fde68a',
    borderRadius: 8,
    padding: '10px 14px',
    fontSize: 13,
    lineHeight: 1.5,
    marginBottom: 10,
  },
  btnPrimary: {
    width: '100%',
    padding: '12px 20px',
    background: '#1769f6',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'background 0.2s',
  },
  appBg: {
    minHeight: '100vh',
    background: '#f3f6fb',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    background: 'linear-gradient(135deg, #0f1d3a 0%, #1769f6 100%)',
    color: '#fff',
    padding: '16px 20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'sticky' as const,
    top: 0,
    zIndex: 100,
    boxShadow: '0 2px 12px rgba(0,0,0,0.2)',
  },
  headerTitle: {
    fontWeight: 700,
    fontSize: 16,
    color: '#fff',
  },
  backBtn: {
    background: 'rgba(255,255,255,0.15)',
    border: 'none',
    color: '#fff',
    padding: '6px 12px',
    borderRadius: 8,
    fontSize: 13,
    cursor: 'pointer',
    fontWeight: 600,
  },
  logoutBtn: {
    background: 'rgba(255,255,255,0.15)',
    border: 'none',
    color: '#fff',
    padding: '6px 12px',
    borderRadius: 8,
    fontSize: 13,
    cursor: 'pointer',
    fontWeight: 600,
  },
  content: {
    maxWidth: 640,
    margin: '0 auto',
    padding: '20px 16px',
  },
  loadingBox: {
    textAlign: 'center',
    padding: '60px 0',
    color: '#6b7280',
    fontSize: 15,
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: '#1e3a5f',
    margin: '0 0 14px',
  },
  doCard: {
    background: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
    cursor: 'pointer',
    transition: 'box-shadow 0.2s',
    border: '1px solid #e5e7eb',
  },
  badge: {
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 700,
  },
  badgeSm: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 600,
  },
  infoGrid: {
    display: 'flex',
    flexDirection: 'column' as const,
  },
  progressTrack: {
    background: '#e5e7eb',
    borderRadius: 99,
    height: 10,
    overflow: 'hidden',
  },
  progressFill: {
    background: '#1769f6',
    height: '100%',
    borderRadius: 99,
    transition: 'width 0.5s ease',
  },
  itemRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 0',
    borderBottom: '1px solid #f3f4f6',
  },
  banner: {
    background: 'linear-gradient(135deg, #16a34a, #15803d)',
    color: '#fff',
    borderRadius: 14,
    padding: '18px 20px',
    marginBottom: 16,
    fontSize: 16,
    fontWeight: 700,
    textAlign: 'center' as const,
    boxShadow: '0 4px 20px rgba(22,163,74,0.4)',
    animation: 'pulse 2s infinite',
  },
  bannerSuccess: {
    background: '#eff6ff',
    color: '#1769f6',
    borderRadius: 14,
    padding: '14px 20px',
    marginBottom: 16,
    fontSize: 14,
    fontWeight: 600,
    textAlign: 'center' as const,
    border: '1px solid #bfdbfe',
  },
};
