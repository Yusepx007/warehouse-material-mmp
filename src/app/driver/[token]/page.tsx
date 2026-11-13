'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Icon } from '@/components/icon';

type DriverOrder = {
  id: string; do_number: string; status: string; notes: string | null;
  client: { name: string; address: string };
  armada: { name: string; driver_name: string; plate: string } | null;
  items: { id: string; part: string; name: string; qty_ordered: number; qty_loaded: number; status: string }[];
};

const labels: Record<string, string> = {
  draft: 'Draft', loading: 'Loading', on_the_way: 'Dalam Perjalanan', at_location: 'Di Lokasi',
  delivered: 'Diterima', returned: 'Dikembalikan',
};

export default function DriverPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [order, setOrder] = useState<DriverOrder | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [gpsMessage, setGpsMessage] = useState('');

  const refresh = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('driver_get_do', { p_token: token });
    if (rpcError || !data) { setError('Link driver tidak valid atau DO tidak ditemukan.'); return; }
    setError(''); setOrder(data as DriverOrder);
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!order?.id) return;
    const channel = supabase.channel(`driver-do-${order.id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'delivery_orders', filter: `id=eq.${order.id}`,
      }, () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [order?.id, refresh]);

  useEffect(() => {
    if (!order || order.status !== 'on_the_way' || !navigator.geolocation) return;
    let active = true;
    const sendLocation = () => navigator.geolocation.getCurrentPosition(async (position) => {
      if (!active) return;
      const { error: gpsError } = await supabase.rpc('driver_add_gps', {
        p_token: token, p_lat: position.coords.latitude, p_lng: position.coords.longitude,
        p_accuracy: position.coords.accuracy,
      });
      if (active) setGpsMessage(gpsError ? 'GPS belum terkirim. Cek izin lokasi dan jaringan.' : 'Lokasi terakhir berhasil dikirim.');
    }, () => { if (active) setGpsMessage('Izinkan akses lokasi untuk membagikan posisi armada.'); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 });
    sendLocation();
    const timer = window.setInterval(sendLocation, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [order?.status, token, order]);

  async function setStatus(status: 'on_the_way' | 'at_location' | 'returned') {
    setBusy(true);
    const { data, error: rpcError } = await supabase.rpc('driver_set_status', { p_token: token, p_status: status });
    if (rpcError) setError(rpcError.message);
    else { setError(''); setOrder(data as DriverOrder); }
    setBusy(false);
  }

  if (error && !order) return <main style={styles.wrap}><section style={styles.card}><h1>Link tidak tersedia</h1><p>{error}</p></section></main>;
  if (!order) return <main style={styles.wrap}><section style={styles.card}>Memuat surat jalan…</section></main>;

  return <main style={styles.wrap}>
    <header style={styles.header}><div style={{ fontSize: 12, opacity: .8 }}>MMP · HALAMAN DRIVER</div><h1 style={{ margin: '6px 0 0', fontSize: 23 }}>{order.do_number}</h1></header>
    <section style={styles.card}>
      <div style={styles.status}>{labels[order.status] || order.status}</div>
      <h2 style={{ margin: '16px 0 4px', fontSize: 20 }}>{order.client.name}</h2>
      <p style={styles.muted}>{order.client.address || 'Alamat belum dicantumkan'}</p>
      {order.armada && <p style={styles.muted}>{order.armada.name} · {order.armada.driver_name} · {order.armada.plate}</p>}
      {order.status === 'loading' && <button disabled={busy} style={styles.primary} onClick={() => void setStatus('on_the_way')}><Icon name="arrow-right" size={16} style={{display:"inline-block",verticalAlign:"middle",marginRight:8}}/>Berangkat</button>}
      {order.status === 'on_the_way' && <><p style={styles.notice}>GPS aktif saat perjalanan. Tekan tiba sebelum masuk area perusahaan.</p><p style={styles.muted}>{gpsMessage}</p><button disabled={busy} style={styles.primary} onClick={() => void setStatus('at_location')}><Icon name="map-pin" size={16} style={{display:"inline-block",verticalAlign:"middle",marginRight:8}}/>Tiba di Lokasi</button></>}
      {order.status === 'at_location' && <><div style={{...styles.arrived,display:"flex",alignItems:"center",gap:8}}><Icon name="map-pin"/>Armada sudah di lokasi PT {order.client.name}</div><p style={styles.notice}>Kalau tidak bisa masuk, keluar dari area terlebih dulu. Tandai dikembalikan setelah barang kembali ke gudang.</p><button disabled={busy} style={styles.danger} onClick={() => { if (window.confirm('Pastikan barang sudah kembali ke gudang. Tandai DO sebagai dikembalikan?')) void setStatus('returned'); }}><Icon name="undo" size={16} style={{display:"inline-block",verticalAlign:"middle",marginRight:8}}/>Barang Sudah Kembali ke Gudang</button></>}
      {order.status === 'delivered' && <div style={{...styles.arrived,display:"flex",alignItems:"center",gap:8}}><Icon name="check"/>Penerimaan barang sudah dikonfirmasi.</div>}
      {order.status === 'returned' && <div style={styles.notice}>DO dikembalikan. Stok gudang belum dikurangi.</div>}
      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
    </section>
    <section style={styles.card}><h2 style={styles.cardTitle}>Barang dalam DO</h2>{order.items.map(item => <div key={item.id} style={styles.item}><div><b>{item.name}</b><div style={styles.muted}>{item.part}</div></div><b>{item.qty_loaded || item.qty_ordered}</b></div>)}</section>
  </main>;
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { minHeight: '100vh', background: '#f3f6fb', padding: '20px 14px', fontFamily: 'system-ui, sans-serif', color: '#172033' },
  header: { maxWidth: 620, margin: '0 auto 16px', padding: 20, background: 'linear-gradient(135deg,#0f1d3a,#1769f6)', color: 'white', borderRadius: 16 },
  card: { maxWidth: 620, margin: '0 auto 14px', background: 'white', borderRadius: 16, padding: 20, boxShadow: '0 2px 12px #0f1d3a0d' },
  status: { display: 'inline-block', borderRadius: 30, background: '#eff6ff', color: '#1769f6', padding: '6px 12px', fontWeight: 700, fontSize: 13 },
  cardTitle: { fontSize: 16, margin: '0 0 10px' },
  muted: { color: '#64748b', fontSize: 13, margin: '6px 0' },
  notice: { background: '#fffbeb', color: '#92400e', padding: 12, borderRadius: 10, fontSize: 13, lineHeight: 1.5 },
  arrived: { background: '#ecfdf5', color: '#047857', padding: 14, borderRadius: 10, fontWeight: 700, margin: '14px 0' },
  primary: { width: '100%', padding: 14, marginTop: 14, background: '#1769f6', border: 0, borderRadius: 10, color: 'white', fontWeight: 700, fontSize: 15, cursor: 'pointer' },
  danger: { width: '100%', padding: 14, marginTop: 8, background: '#fff', border: '1px solid #dc2626', borderRadius: 10, color: '#b91c1c', fontWeight: 700, fontSize: 14, cursor: 'pointer' },
  item: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #eef2f7' },
};
