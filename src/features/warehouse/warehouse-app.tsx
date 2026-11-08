'use client';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import jsQR from 'jsqr';

type Material={id:string;part:string;name:string;qty:number;min:number;description:string;active:boolean;updated:string;image?:string};
type Tx={id:string;materialId:string;part:string;name:string;type:'in'|'out'|'adjustment';qty:number;before:number;after:number;user:string;time:string;note?:string};
type Page='dashboard'|'material'|'scan'|'logs'|'detail';
type Dialog={kind:'add'|'edit'|'reset'|'transaction'|'deactivate'|'logout'|'qrcode';item?:Material;qty?:number;type?:'in'|'out'}|null;

const fmt=(n:number)=>new Intl.NumberFormat('id-ID').format(n),
  time=(s:string)=>new Date(s).toLocaleString('id-ID',{dateStyle:'short',timeStyle:'short'}),
  dateKey=(s:string)=>{const d=new Date(s);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`},
  processName=(t:Tx['type'])=>t==='in'?'Material Masuk':t==='out'?'Material Keluar':'Penyesuaian';

export default function WarehouseApp(){
  const [materials,setMaterials]=useState<Material[]>([]);
  const [logs,setLogs]=useState<Tx[]>([]);
  const [user,setUser]=useState('');
  const [ready,setReady]=useState(false);
  const [page,setPage]=useState<Page>('dashboard');
  const [search,setSearch]=useState('');
  const [code,setCode]=useState('');
  const [dialog,setDialog]=useState<Dialog>(null);
  const [detailId,setDetailId]=useState('');
  const [toast,setToast]=useState('');
  const [loading,setLoading]=useState(false);

  // ── Load session & data ──────────────────────────────────────
  useEffect(()=>{
    supabase.auth.getSession().then(async({data:{session}})=>{
      if(session?.user?.email){
        setUser(session.user.email);
        await loadAll();
      }
      setReady(true);
    });
    const {data:{subscription}}=supabase.auth.onAuthStateChange(async(_event,session)=>{
      if(session?.user?.email){setUser(session.user.email);await loadAll();}
      else{setUser('');setMaterials([]);setLogs([]);}
    });
    return ()=>subscription.unsubscribe();
  },[]);

  const loadAll=useCallback(async()=>{
    const[matRes,txRes]=await Promise.all([
      supabase.from('materials').select('*').eq('active',true).order('updated_at',{ascending:false}),
      supabase.from('transactions').select('*').order('created_at',{ascending:false}).limit(500),
    ]);
    if(matRes.data)setMaterials(matRes.data.map(m=>({
      id:m.id,part:m.part,name:m.name,qty:m.qty,min:m.min,
      description:m.description||'',active:m.active,
      updated:m.updated_at,image:m.image||undefined,
    })));
    if(txRes.data)setLogs(txRes.data.map(t=>({
      id:t.id,materialId:t.material_id||'',part:t.part,name:t.name,
      type:t.type,qty:t.qty,before:t.before,after:t.after,
      user:t.user_email,time:t.created_at,note:t.note||undefined,
    })));
  },[]);

  // ── Load all materials incl inactive for internal lookup ─────
  const [allMaterials,setAllMaterials]=useState<Material[]>([]);
  useEffect(()=>{
    if(!user)return;
    supabase.from('materials').select('*').order('updated_at',{ascending:false})
      .then(({data})=>{
        if(data)setAllMaterials(data.map(m=>({
          id:m.id,part:m.part,name:m.name,qty:m.qty,min:m.min,
          description:m.description||'',active:m.active,
          updated:m.updated_at,image:m.image||undefined,
        })));
      });
  },[user,materials]);

  const active=useMemo(()=>materials.filter(m=>m.active),[materials]);
  const isAdmin=user==='admin@mmp.local';
  const notify=(s:string)=>{setToast(s);window.setTimeout(()=>setToast(''),2600)};
  const go=(p:Page)=>{setPage(p);setSearch('')};

  // ── addLog ───────────────────────────────────────────────────
  const addLog=useCallback(async(m:Material,type:Tx['type'],qty:number,before:number,after:number,note?:string)=>{
    await supabase.from('transactions').insert({
      material_id:m.id,part:m.part,name:m.name,type,qty,before,after,
      user_email:user||'admin',note:note||null,
    });
  },[user]);

  // ── submitMaterial ───────────────────────────────────────────
  async function submitMaterial(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!dialog)return;
    setLoading(true);
    const f=new FormData(e.currentTarget),item=dialog.item;
    const part=String(f.get('part')||'').trim(),name=String(f.get('name')||'').trim();
    const min=Number(f.get('min')||0);
    const imgEl=e.currentTarget.querySelector('#material-image') as HTMLInputElement|null;
    const newImage=imgEl?.dataset.preview||undefined;
    if(active.some(m=>m.id!==item?.id&&m.part.toLowerCase()===part.toLowerCase())){
      notify('Part Number sudah digunakan.');setLoading(false);return;
    }
    if(item){
      const{error}=await supabase.from('materials').update({
        part,name,min,description:String(f.get('description')||''),
        updated_at:new Date().toISOString(),
        ...(newImage!==undefined?{image:newImage||null}:{}),
      }).eq('id',item.id);
      if(!error){await addLog(item,'adjustment',0,item.qty,item.qty,'Data material diperbarui');await loadAll();notify('Material diperbarui.');}
      else notify('Gagal menyimpan: '+error.message);
    } else {
      const qty=Math.max(0,Number(f.get('qty')||0));
      const{data,error}=await supabase.from('materials').insert({
        part,name,qty,min,description:String(f.get('description')||''),
        active:true,image:newImage||null,
      }).select().single();
      if(!error&&data){
        const m:Material={id:data.id,part,name,qty,min,description:String(f.get('description')||''),active:true,updated:data.updated_at,image:newImage};
        await addLog(m,'adjustment',qty,0,qty,'Material ditambahkan');
        await loadAll();notify('Material ditambahkan.');
      } else notify('Gagal menambah: '+(error?.message||''));
    }
    setDialog(null);setLoading(false);
  }

  // ── resetQty ─────────────────────────────────────────────────
  async function resetQty(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setLoading(true);
    const f=new FormData(e.currentTarget);
    const m=materials.find(x=>x.id===String(f.get('id')));
    const qty=Number(f.get('qty'));
    const reason=String(f.get('reason')||'').trim();
    if(!m||reason.length<10||qty<0||!Number.isInteger(qty)){
      notify('Alasan minimal 10 karakter; quantity harus valid.');setLoading(false);return;
    }
    const{error}=await supabase.from('materials').update({qty,updated_at:new Date().toISOString()}).eq('id',m.id);
    if(!error){await addLog(m,'adjustment',Math.abs(qty-m.qty),m.qty,qty,reason);await loadAll();notify('Quantity berhasil direset.');}
    else notify('Gagal: '+error.message);
    setDialog(null);setLoading(false);
  }

  // ── saveTx ───────────────────────────────────────────────────
  async function saveTx(){
    if(dialog?.kind!=='transaction'||!dialog.item)return;
    setLoading(true);
    const m=materials.find(x=>x.id===dialog.item!.id);
    if(!m){setLoading(false);return;}
    const qty=dialog.qty||0,type=dialog.type||'in';
    if(qty<1||qty>100000||!Number.isInteger(qty)||(type==='out'&&qty>m.qty)){
      setDialog(null);notify('Quantity harus 1–100.000 dan stok harus cukup.');setLoading(false);return;
    }
    const after=type==='in'?m.qty+qty:m.qty-qty;
    const{error}=await supabase.from('materials').update({qty:after,updated_at:new Date().toISOString()}).eq('id',m.id);
    if(!error){await addLog(m,type,qty,m.qty,after);await loadAll();notify('Transaksi berhasil disimpan.');}
    else notify('Gagal: '+error.message);
    setDialog(null);setCode('');setLoading(false);
  }

  // ── deactivate ───────────────────────────────────────────────
  async function deactivate(m:Material){
    setLoading(true);
    const{error}=await supabase.from('materials').update({active:false,updated_at:new Date().toISOString()}).eq('id',m.id);
    if(!error){await addLog(m,'adjustment',0,m.qty,m.qty,'Material dinonaktifkan');await loadAll();notify('Material dinonaktifkan.');}
    else notify('Gagal: '+error.message);
    setDialog(null);setLoading(false);
  }

  // ── lookup ───────────────────────────────────────────────────
  function lookup(raw:string){
    const value=raw.replace(/[\u0000-\u001f\u007f]/g,'').trim();
    setCode(value);if(!value)return;
    const found=allMaterials.find(m=>m.part.trim().toLowerCase()===value.toLowerCase());
    if(!found)notify('Material tidak ditemukan.');
    else if(!found.active)notify('Material nonaktif. Transaksi tidak dapat dibuat.');
  }

  if(!ready)return <div className="loading-screen">Memuat Warehouse Material MMP…</div>;
  if(!user)return <Login onLogin={async(email,password)=>{
    // Cek apakah URL Supabase valid (bukan placeholder)
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL||'https://qfjzkgofdgmywaarutvl.supabase.co';
    if(url.includes('placeholder')){
      return 'Konfigurasi server belum selesai. Hubungi administrator.';
    }
    try{
      const{error}=await supabase.auth.signInWithPassword({email,password});
      if(error)return error.message;
      return null;
    }catch(ex:unknown){
      const msg=ex instanceof Error?ex.message:String(ex);
      return 'Error: '+msg;
    }
  }}/>;

  const titles:Record<Page,string>={dashboard:'Dashboard',material:'Data Material',scan:'Scan QR / Barcode',logs:'Log Aktivitas',detail:'Detail Material'};
  const subs:Record<Page,string>={dashboard:'Ringkasan data material dan aktivitas gudang',material:'Kelola data material gudang',scan:'Pindai kode material untuk input atau pengecekan stok',logs:'Riwayat transaksi dan perubahan data material',detail:'Material  ›  Detail'};
  const selected=allMaterials.find(m=>m.part.toLowerCase()===code.trim().toLowerCase()&&m.active);

  return <div className="shell"><aside className="sidebar"><div className="mobile-menu-head"><button className="close" onClick={()=>document.querySelector('.sidebar')?.classList.remove('open')}>×</button></div><div className="brand">MMP<small>Warehouse Material</small></div><nav className="nav">{([['dashboard','▦'],['material','▤'],['scan','⌗'],['logs','☷']] as [Page,string][]).map(([p,i])=><button key={p} onClick={()=>go(p)} className={page===p||(page==='detail'&&p==='material')?'active':''}><span className="ico">{i}</span>{titles[p]}</button>)}</nav><div className="aside-bottom"><button className="logout" onClick={()=>setDialog({kind:'logout'})}>⇥　Logout</button><div className="profile"><div className="avatar">{isAdmin?'AD':'OP'}</div><div><b>{isAdmin?'Administrator':'Operator'}</b><small>{user}</small></div></div></div></aside>
  <main className="main"><header className="topline"><button className="hamb" onClick={()=>document.querySelector('.sidebar')?.classList.add('open')}>☰</button><div className="heading"><h1>{titles[page]}</h1><p>{subs[page]}</p></div><div className="date">{new Date().toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'})}</div></header>
  {page==='dashboard'&&<Dashboard materials={active} logs={logs} navigate={go}/>}
  {page==='material'&&<Materials items={active.filter(m=>(m.part+' '+m.name).toLowerCase().includes(search.toLowerCase()))} search={search} setSearch={setSearch} isAdmin={isAdmin} onAdd={()=>setDialog({kind:'add'})} onEdit={m=>setDialog({kind:'edit',item:m})} onDelete={m=>setDialog({kind:'deactivate',item:m})} onDetail={m=>{setDetailId(m.id);setPage('detail')}} onReset={()=>setDialog({kind:'reset'})} onExcel={()=>exportExcel(active,logs)} onQr={m=>setDialog({kind:'qrcode',item:m})} />}
  {page==='scan'&&<Scan items={allMaterials} code={code} setCode={setCode} selected={selected} isAdmin={isAdmin} onAdd={()=>setDialog({kind:'add'})} onHistory={()=>go('logs')} onLookup={lookup} onTransaction={(m,q,t)=>setDialog({kind:'transaction',item:m,qty:q,type:t})} />}
  {page==='logs'&&<Logs rows={logs.filter(t=>(t.part+' '+t.name).toLowerCase().includes(search.toLowerCase()))} search={search} setSearch={setSearch} onExcel={()=>exportExcel(active,logs)} />}
  {page==='detail'&&<Detail item={allMaterials.find(m=>m.id===detailId)} logs={logs.filter(t=>t.materialId===detailId)} isAdmin={isAdmin} onBack={()=>go('material')} onEdit={m=>setDialog({kind:'edit',item:m})} onQr={m=>setDialog({kind:'qrcode',item:m})}/>}
  </main><nav className="mobile-nav">{([['dashboard','▦','Home'],['material','▤','Material'],['scan','⌗','Scan'],['logs','☷','Log']] as [Page,string,string][]).map(([p,i,l])=><button key={p} className={page===p?'active':''} onClick={()=>go(p)}><span>{i}</span>{l}</button>)}</nav>
  {dialog&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setDialog(null)}}><div className="modal">
  {dialog.kind==='add'||dialog.kind==='edit'?<><div className="modal-head"><h2>{dialog.kind==='edit'?'Edit':'Tambah'} Material</h2><button className="close" onClick={()=>setDialog(null)}>×</button></div><form onSubmit={submitMaterial}><div className="field"><label className="form-label" htmlFor="material-part">Part Number</label><input id="material-part" name="part" required defaultValue={dialog.item?.part||''}/></div><div className="field"><label className="form-label" htmlFor="material-name">Nama Material</label><input id="material-name" name="name" required defaultValue={dialog.item?.name||''}/></div>{dialog.kind==='add'&&<div className="field"><label className="form-label" htmlFor="material-qty">Quantity Awal</label><input id="material-qty" name="qty" type="number" min="0" defaultValue="0"/></div>}<div className="field"><label className="form-label" htmlFor="material-min">Stok Minimum</label><input id="material-min" name="min" type="number" min="0" defaultValue={dialog.item?.min||''}/></div><div className="field"><label className="form-label" htmlFor="material-description">Deskripsi</label><textarea id="material-description" name="description" defaultValue={dialog.item?.description||''}/></div><div className="field"><label className="form-label">Foto Material</label><ImageUploader defaultImage={dialog.item?.image} onImage={(img,el)=>{if(el)el.dataset.preview=img}} inputId="material-image"/></div>{dialog.kind==='edit'&&<small>Quantity diubah melalui transaksi atau Reset Quantity.</small>}<div className="modal-actions"><button type="button" className="btn" onClick={()=>setDialog(null)}>Batal</button><button className="btn primary" disabled={loading}>{loading?'Menyimpan…':'Simpan'}</button></div></form></>
  :dialog.kind==='reset'?<><div className="modal-head"><h2>Reset Quantity</h2><button className="close" onClick={()=>setDialog(null)}>×</button></div><form onSubmit={resetQty}><div className="field"><label className="form-label" htmlFor="reset-material">Material</label><select id="reset-material" name="id">{active.map(m=><option key={m.id} value={m.id}>{m.part} — {m.name}</option>)}</select></div><div className="field"><label className="form-label" htmlFor="reset-qty">Quantity Baru</label><input id="reset-qty" name="qty" type="number" min="0" required/></div><div className="field"><label className="form-label" htmlFor="reset-reason">Alasan (min. 10 karakter)</label><textarea id="reset-reason" name="reason" minLength={10} required/></div><div className="modal-actions"><button type="button" className="btn" onClick={()=>setDialog(null)}>Batal</button><button className="btn primary" disabled={loading}>{loading?'Menyimpan…':'Simpan Penyesuaian'}</button></div></form></>
  :dialog.kind==='transaction'?<><div className="modal-head"><h2>Konfirmasi Transaksi</h2><button className="close" onClick={()=>setDialog(null)}>×</button></div><div className="notice">{dialog.item?.part} · {dialog.item?.name}<br/>{dialog.type==='in'?'Material Masuk':'Material Keluar'} · {fmt(dialog.qty||0)} unit<br/>Stok {fmt(dialog.item?.qty||0)} → {fmt(dialog.type==='in'?(dialog.item?.qty||0)+(dialog.qty||0):(dialog.item?.qty||0)-(dialog.qty||0))}</div><div className="modal-actions"><button className="btn" onClick={()=>setDialog(null)}>Batal</button><button className="btn primary" onClick={saveTx} disabled={loading}>{loading?'Menyimpan…':'Simpan Transaksi'}</button></div></>
  :dialog.kind==='logout'?<><div className="modal-head"><h2>Keluar dari aplikasi?</h2><button className="close" onClick={()=>setDialog(null)}>×</button></div><p>Sesi akan diakhiri.</p><div className="modal-actions"><button className="btn" onClick={()=>setDialog(null)}>Batal</button><button className="btn primary" onClick={async()=>{await supabase.auth.signOut();setDialog(null);}}>Logout</button></div></>
  :dialog.kind==='qrcode'&&dialog.item?<PartCardDialog material={dialog.item} onClose={()=>setDialog(null)}/>
  :<><div className="modal-head"><h2>Nonaktifkan Material?</h2><button className="close" onClick={()=>setDialog(null)}>×</button></div><p>Material {dialog.item?.part} akan dinonaktifkan. Riwayatnya tetap disimpan.</p><div className="modal-actions"><button className="btn" onClick={()=>setDialog(null)}>Batal</button><button className="btn danger" disabled={loading} onClick={()=>dialog.item&&deactivate(dialog.item)}>{loading?'Memproses…':'Nonaktifkan'}</button></div></>}
  </div></div>}
  <div id="toast" className={toast?'show':''} role="status">{toast}</div></div>;
}

// ── Login ────────────────────────────────────────────────────────
function Login({onLogin}:{onLogin:(email:string,password:string)=>Promise<string|null>}){
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[showPw,setShowPw]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function submit(e:FormEvent){
    e.preventDefault();setBusy(true);setError('');
    try{
      const err=await onLogin(email,password);
      if(err){
        // Tampilkan error asli agar mudah diagnosa
        if(err.toLowerCase().includes('invalid login credentials')||err.toLowerCase().includes('invalid email or password')){
          setError('Email atau password salah. Periksa kembali.');
        } else if(err.toLowerCase().includes('email not confirmed')){
          setError('Email belum dikonfirmasi. Cek inbox atau hubungi admin untuk konfirmasi akun.');
        } else {
          setError(err); // Tampilkan error asli dari Supabase
        }
      }
    }catch(ex:unknown){
      const msg=ex instanceof Error?ex.message:String(ex);
      setError('Exception: '+msg);
    }
    setBusy(false);
  }
  return <div className="login-page"><section className="login-side" aria-hidden="true"/>
   <form className="login-card" onSubmit={submit} autoComplete="on"><div className="cube">⬡</div><h1>Warehouse Material MMP</h1><p>Sistem Manajemen Material Gudang</p><div className="field"><label className="form-label" htmlFor="login-email">Email</label><input id="login-email" name="email" type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="contoh@email.com"/></div><div className="field"><label className="form-label" htmlFor="login-password">Password</label><div style={{position:'relative'}}><input id="login-password" name="password" type={showPw?'text':'password'} autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} style={{paddingRight:'48px',width:'100%',boxSizing:'border-box'}} placeholder="Masukkan password"/><button type="button" aria-label={showPw?'Sembunyikan password':'Tampilkan password'} onClick={()=>setShowPw(v=>!v)} style={{position:'absolute',right:'8px',top:'50%',transform:'translateY(-50%)',background:'transparent',border:'none',cursor:'pointer',padding:'6px',lineHeight:0,color:showPw?'#1769f6':'#94a3b8',display:'flex',alignItems:'center',justifyContent:'center',borderRadius:'4px'}}>
{showPw
  ?<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
  :<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
}
</button></div></div>{error&&<div className="error">{error}</div>}<button className="btn primary" disabled={busy}>{busy?'Masuk…':'Login'}</button><div className="demo-access"><b>Akun demo</b><button type="button" className="demo-btn" onClick={()=>{setEmail('admin@mmp.local')}}>Admin: admin@mmp.local</button><button type="button" className="demo-btn" onClick={()=>{setEmail('operator@mmp.local')}}>Operator: operator@mmp.local</button></div><div className="login-foot">© 2026 MMP Warehouse. All rights reserved.</div></form>
  </div>
}

// ── Dashboard ────────────────────────────────────────────────────
function Dashboard({materials,logs,navigate}:{materials:Material[];logs:Tx[];navigate:(p:Page)=>void}){
  const low=materials.filter(m=>m.min>0&&m.qty<=m.min),sum=materials.reduce((a,m)=>a+m.qty,0),today=logs.filter(t=>new Date(t.time).toDateString()===new Date().toDateString()),inToday=today.filter(t=>t.type==='in').length,outToday=today.filter(t=>t.type==='out').length;
  return <><section className="stats"><Stat icon="◇" color="blue-bg" title="Total Material" value={fmt(materials.length)} note="Jenis material"/><Stat icon="▱" color="green-bg" title="Total Quantity" value={fmt(sum)} note="Unit tersedia"/><Stat icon="⇄" color="orange-bg" title="Transaksi Hari Ini" value={fmt(inToday+outToday)} note={`Masuk ${inToday} · Keluar ${outToday}`}/><Stat icon="♙" color="purple-bg" title="Stok Rendah" value={fmt(low.length)} note="Material di bawah minimum"/></section>
   <section className="grid-two"><div className="card panel"><ActivityChartPanel logs={logs}/></div><div className="card panel"><div className="panel-head"><h2>Material Stok Rendah</h2><button className="link" onClick={()=>navigate('material')}>Lihat Semua →</button></div><div className="table-wrap"><table><thead><tr><th>Part Number</th><th>Nama Material</th><th>Qty</th></tr></thead><tbody>{low.length?low.slice(0,5).map(m=><tr key={m.id}><td>{m.part}</td><td>{m.name}</td><td className="low">{fmt(m.qty)}</td></tr>):<tr><td colSpan={3} className="empty">Semua stok aman</td></tr>}</tbody></table></div></div></section>
   <section className="card panel"><div className="panel-head"><h2>Aktivitas Terbaru</h2><button className="link" onClick={()=>navigate('logs')}>Buka Log →</button></div>{logs.length?<TxTable rows={logs.slice(0,5)} compact/>:<div className="empty">▤<strong>Belum ada transaksi</strong>Aktivitas gudang akan muncul di sini.</div>}</section>
  </>
}
function ActivityChartPanel({logs}:{logs:Tx[]}){
  const [mode,setMode]=useState<'7d'|'30d'|'12m'>('7d');
  return <><div className="panel-head"><h2>{mode==='7d'?'Aktivitas 7 Hari Terakhir':mode==='30d'?'Aktivitas 30 Hari Terakhir':'Aktivitas 12 Bulan Terakhir'}</h2><div style={{display:'flex',alignItems:'center',gap:'8px'}}><div className="legend"><span><i className="dot"/>Masuk</span><span><i className="dot out"/>Keluar</span></div><div className="chart-tabs"><button className={'chart-tab'+(mode==='7d'?' active':'')} onClick={()=>setMode('7d')}>Harian</button><button className={'chart-tab'+(mode==='30d'?' active':'')} onClick={()=>setMode('30d')}>Bulanan</button><button className={'chart-tab'+(mode==='12m'?' active':'')} onClick={()=>setMode('12m')}>Tahunan</button></div></div></div><ActivityChart logs={logs} mode={mode}/></>;
}
function ActivityChart({logs,mode='7d'}:{logs:Tx[];mode?:'7d'|'30d'|'12m'}){
  const points=useMemo(()=>{
   if(mode==='7d'){return Array.from({length:7},(_,i)=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-6+i);const rows=logs.filter(t=>new Date(t.time).toDateString()===d.toDateString());return{label:d.toLocaleDateString('id-ID',{day:'numeric',month:'short'}),incoming:rows.filter(t=>t.type==='in').reduce((n,t)=>n+t.qty,0),outgoing:rows.filter(t=>t.type==='out').reduce((n,t)=>n+t.qty,0)}});}
   if(mode==='30d'){return Array.from({length:30},(_,i)=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-29+i);const rows=logs.filter(t=>new Date(t.time).toDateString()===d.toDateString());return{label:i%5===0||i===29?d.toLocaleDateString('id-ID',{day:'numeric',month:'short'}):'',incoming:rows.filter(t=>t.type==='in').reduce((n,t)=>n+t.qty,0),outgoing:rows.filter(t=>t.type==='out').reduce((n,t)=>n+t.qty,0)}});}
   return Array.from({length:12},(_,i)=>{const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-11+i);const rows=logs.filter(t=>{const lt=new Date(t.time);return lt.getFullYear()===d.getFullYear()&&lt.getMonth()===d.getMonth()});return{label:d.toLocaleDateString('id-ID',{month:'short',year:'2-digit'}),incoming:rows.filter(t=>t.type==='in').reduce((n,t)=>n+t.qty,0),outgoing:rows.filter(t=>t.type==='out').reduce((n,t)=>n+t.qty,0)};});
  },[logs,mode]);
  const count=points.length,max=Math.max(5,...points.flatMap(d=>[d.incoming,d.outgoing]));
  const W=680,H=160,padL=48,padR=10,padT=10,padB=30;
  const vw=W-padL-padR,x=(i:number)=>padL+i*(vw/(count-1||1)),y=(v:number)=>padT+H-(v/max*H),path=(key:'incoming'|'outgoing')=>points.map((d,i)=>`${i?'L':'M'} ${x(i)} ${y(d[key])}`).join(' ');
  const totalW=720,totalH=padT+H+padB+20;
  return <div className="activity-chart"><svg viewBox={`0 0 ${totalW} ${totalH}`} role="img" aria-label="Grafik aktivitas">{[0,1,2,3,4].map(i=><g key={i}><line x1={padL} x2={padL+vw} y1={padT+i*(H/4)} y2={padT+i*(H/4)} stroke="#e8edf4"/><text x="4" y={padT+4+i*(H/4)} className="chart-label">{Math.round(max*(4-i)/4)}</text></g>)}<path d={path('incoming')} fill="none" stroke="#1769f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/><path d={path('outgoing')} fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>{points.map((d,i)=><g key={i}><circle cx={x(i)} cy={y(d.incoming)} r="3.5" fill="#1769f6"/><circle cx={x(i)} cy={y(d.outgoing)} r="3.5" fill="#f59e0b"/>{d.label&&<text x={x(i)} y={totalH-4} textAnchor="middle" className="chart-label">{d.label}</text>}</g>)}</svg></div>
}
function Stat({icon,color,title,value,note}:{icon:string;color:string;title:string;value:string;note:string}){return <div className="card stat"><div className={'stat-icon '+color}>{icon}</div><div><span>{title}</span><strong>{value}</strong><small>{note}</small></div></div>}

// ── Materials ────────────────────────────────────────────────────
function Materials({items,search,setSearch,isAdmin,onAdd,onEdit,onDelete,onDetail,onReset,onExcel,onQr}:{items:Material[];search:string;setSearch:(s:string)=>void;isAdmin:boolean;onAdd:()=>void;onEdit:(m:Material)=>void;onDelete:(m:Material)=>void;onDetail:(m:Material)=>void;onReset:()=>void;onExcel:()=>void;onQr:(m:Material)=>void}){const [size,setSize]=useState(10),[page,setPage]=useState(1);useEffect(()=>setPage(1),[search,size]);const pages=Math.max(1,Math.ceil(items.length/size)),shown=items.slice((page-1)*size,page*size);return <section className="card page-card"><div className="toolbar"><div className="search"><input placeholder="Cari part number atau nama material…" value={search} onChange={e=>setSearch(e.target.value)}/></div>{isAdmin&&<><button className="btn primary" onClick={onAdd}>＋ Tambah Material</button><button className="btn" onClick={onReset}>↻ Reset Quantity</button></>}<button className="btn" onClick={onExcel}>⇩ Export Excel</button></div><div className="table-wrap"><table><thead><tr><th>No</th><th>Part Number</th><th>Nama Material</th><th>Quantity</th><th>Last Update</th><th>Aksi</th></tr></thead><tbody>{shown.length?shown.map((m,i)=><tr key={m.id}><td>{(page-1)*size+i+1}</td><td><b>{m.part}</b></td><td>{m.name}</td><td>{fmt(m.qty)}</td><td>{time(m.updated)}</td><td><div className="actions"><button className="btn sm" onClick={()=>onDetail(m)}>Detail</button><button className="btn sm" style={{background:'#7c3aed',color:'#fff'}} onClick={()=>onQr(m)}>⊞ Part Card</button>{isAdmin&&<><button className="btn sm warning" onClick={()=>onEdit(m)}>Edit</button><button className="btn sm danger" onClick={()=>onDelete(m)}>Hapus</button></>}</div></td></tr>):<tr><td colSpan={6} className="empty">Material tidak ditemukan.</td></tr>}</tbody></table></div><div className="toolbar page-controls"><small>{items.length} material</small><label>Tampilkan <select value={size} onChange={e=>setSize(Number(e.target.value))}><option>10</option><option>25</option><option>50</option></select> data</label><div className="actions"><button className="btn sm" disabled={page<=1} onClick={()=>setPage(page-1)}>‹</button><span>{page} / {pages}</span><button className="btn sm" disabled={page>=pages} onClick={()=>setPage(page+1)}>›</button></div></div></section>}

// ── Scan ─────────────────────────────────────────────────────────
function Scan({items,code,setCode,selected,isAdmin,onAdd,onHistory,onLookup,onTransaction}:{items:Material[];code:string;setCode:(s:string)=>void;selected?:Material;isAdmin:boolean;onAdd:()=>void;onHistory:()=>void;onLookup:(s:string)=>void;onTransaction:(m:Material,q:number,t:'in'|'out')=>void}){
  const [mode,setMode]=useState<'camera'|'hid'>('camera'),[type,setType]=useState<'in'|'out'>('in'),[error,setError]=useState(''),[live,setLive]=useState(false),[facing,setFacing]=useState<'environment'|'user'>('environment'),[lastScanned,setLastScanned]=useState('');
  const video=useRef<HTMLVideoElement>(null),canvas=useRef<HTMLCanvasElement>(null),stream=useRef<MediaStream|null>(null),hid=useRef<HTMLInputElement>(null),loop=useRef(false),lastHit=useRef({code:'',at:0});
  useEffect(()=>{if(mode==='hid')hid.current?.focus()},[mode]);
  useEffect(()=>()=>{loop.current=false;stream.current?.getTracks().forEach(t=>t.stop())},[]);
  async function start(camera=facing){
    setError('');
    // Cek apakah browser mendukung getUserMedia
    if(!navigator?.mediaDevices?.getUserMedia){
      setError('Browser tidak mendukung akses kamera. Gunakan Chrome/Edge versi terbaru, atau gunakan scanner fisik.');
      return;
    }
    try{
      stream.current=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:camera},width:{ideal:1280},height:{ideal:720}},audio:false});
      if(video.current){video.current.srcObject=stream.current;await video.current.play();}
      setLive(true);loop.current=true;setError('');
      const tick=()=>{
        if(!loop.current||!video.current||!canvas.current)return;
        const v=video.current,c=canvas.current,ctx=c.getContext('2d');
        if(v.readyState===v.HAVE_ENOUGH_DATA&&ctx){
          c.width=v.videoWidth;c.height=v.videoHeight;
          ctx.drawImage(v,0,0,c.width,c.height);
          const img=ctx.getImageData(0,0,c.width,c.height);
          const result=jsQR(img.data,img.width,img.height,{inversionAttempts:'dontInvert'});
          if(result?.data){
            const value=result.data.trim(),now=Date.now();
            if(value&&(value!==lastHit.current.code||now-lastHit.current.at>2000)){
              onLookup(value);setLastScanned(value);lastHit.current={code:value,at:now};
            }
          }
        }
        if(loop.current)requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }catch(e:unknown){
      const err=e instanceof Error?e:new Error(String(e));
      if(err.name==='NotAllowedError'||err.name==='PermissionDeniedError'){
        setError('Izin kamera ditolak. Klik ikon kunci/kamera di address bar browser → izinkan akses kamera → refresh halaman.');
      }else if(err.name==='NotFoundError'||err.name==='DevicesNotFoundError'){
        setError('Kamera tidak ditemukan di perangkat ini. Gunakan scanner fisik atau input manual.');
      }else if(err.name==='NotReadableError'||err.name==='TrackStartError'){
        setError('Kamera sedang dipakai aplikasi lain. Tutup aplikasi kamera lain lalu coba lagi.');
      }else{
        setError('Gagal membuka kamera. Pastikan halaman dibuka via HTTPS atau localhost, lalu izinkan akses kamera.');
      }
      stream.current?.getTracks().forEach(t=>t.stop());setLive(false);
    }
  }
  function switchCamera(){const next=facing==='environment'?'user':'environment';loop.current=false;stream.current?.getTracks().forEach(t=>t.stop());setLive(false);setFacing(next);void start(next)}
  const inactive=items.some(m=>m.part.trim().toLowerCase()===code.trim().toLowerCase()&&!m.active);
  return <section className="scan-layout"><div className="card panel"><div className="scan-panel-head"><div className="tabs"><button className={'tab '+(mode==='camera'?'active':'')} onClick={()=>setMode('camera')}>◉ Kamera</button><button className={'tab '+(mode==='hid'?'active':'')} onClick={()=>setMode('hid')}>⌗ Scanner Fisik (Bluetooth)</button></div><button className="btn" onClick={onHistory}>Riwayat Scan</button></div>
   {mode==='camera'?<><div className="scan-stage"><video ref={video} playsInline muted style={{display:live?'block':'none',width:'100%',height:'100%',objectFit:'cover'}}/><canvas ref={canvas} style={{display:'none'}}/><div className="scan-stage-inner"><div className="scan-symbol">▣</div><p>{live?'Arahkan kamera ke QR Code':'Klik tombol di bawah untuk mengaktifkan kamera'}</p><div className="scan-stage-actions"><button className="btn" onClick={()=>live?switchCamera():void start()}>{live?'Ganti Kamera':'Aktifkan Kamera'}</button>{live&&<button className="btn" onClick={()=>{loop.current=false;stream.current?.getTracks().forEach(t=>t.stop());setLive(false)}}>Matikan Kamera</button>}</div>{!live&&!error&&<p className="scan-help">Mendukung semua browser modern. Izinkan akses kamera saat diminta.</p>}</div></div>{error&&<div className="notice camera-notice">{error}</div>}{lastScanned&&<div className="scan-success">✓ Kode terbaca: {lastScanned}</div>}</>:<><div className="notice">Scanner fisik mengirim kode seperti keyboard. Akhiri scan dengan Enter atau Tab.</div><label className="form-label" htmlFor="hid">Siap menerima scan</label><input ref={hid} id="hid" className="scanner-input" placeholder="Scan barcode di sini…" onKeyDown={e=>{if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();const value=e.currentTarget.value.trim();if(value){onLookup(value);setLastScanned(value)}e.currentTarget.value='';e.currentTarget.focus()}}}/>{lastScanned&&<div className="scan-success">✓ Kode diterima: {lastScanned}</div>}<button className="btn" onClick={()=>hid.current?.focus()}>Fokus ulang</button></>}
   <div className="field"><label className="form-label" htmlFor="manual-part">Atau masukkan Part Number</label><div className="toolbar" style={{margin:0}}><input id="manual-part" value={code} onChange={e=>setCode(e.target.value)} onKeyDown={e=>e.key==='Enter'&&onLookup(code)} placeholder="Contoh: 43155-KYZ-9000-M"/><button className="btn primary" onClick={()=>onLookup(code)}>Cari Material</button></div></div>
  </div><div className="card result-card"><h3>Hasil Scan</h3><div className="line"/>{code?selected?<><div className="result-code">{selected.part}</div><div>{selected.name}</div><div className="line"/><span className="hint">Stok saat ini</span><div className="stock-big">{fmt(selected.qty)} <small>unit</small></div><div className="field"><label className="form-label" htmlFor="scan-process">Pilih Proses</label><select id="scan-process" value={type} onChange={e=>setType(e.target.value as 'in'|'out')}><option value="in">Material Masuk</option><option value="out">Material Keluar</option></select></div><div className="field"><label className="form-label" htmlFor="scanQty">Quantity</label><input id="scanQty" type="number" min="1" max="100000" defaultValue="1"/></div><button className="btn primary full-width" onClick={()=>{const q=Number((document.querySelector('#scanQty') as HTMLInputElement)?.value);onTransaction(selected,q,type)}}>Lanjut ke Konfirmasi</button></>:<div className="error">{inactive?`Material ${code} nonaktif. Transaksi tidak dapat dibuat.`:`Kode '${code}' tidak terdaftar.`}{isAdmin&&!inactive&&<button className="btn" onClick={onAdd}>Tambah Material</button>}</div>:<div className="empty">⌗<strong>Belum ada hasil scan</strong>Pindai kode atau masukkan Part Number.</div>}</div></section>
}

// ── Logs ─────────────────────────────────────────────────────────
function Logs({rows,search,setSearch,onExcel}:{rows:Tx[];search:string;setSearch:(s:string)=>void;onExcel:()=>void}){
  const [process,setProcess]=useState('all'),[userFilter,setUserFilter]=useState('all'),[from,setFrom]=useState(''),[to,setTo]=useState(''),[size,setSize]=useState(10),[page,setPage]=useState(1),[selected,setSelected]=useState<Tx>();
  const users=Array.from(new Set(rows.map(r=>r.user))),filtered=rows.filter(r=>(!from||dateKey(r.time)>=from)&&(!to||dateKey(r.time)<=to)&&(process==='all'||r.type===process)&&(userFilter==='all'||r.user===userFilter)),pages=Math.max(1,Math.ceil(filtered.length/size)),shown=filtered.slice((page-1)*size,page*size);
  useEffect(()=>setPage(1),[search,process,userFilter,from,to,size]);
  return <section className="card page-card"><div className="toolbar"><div className="search"><input placeholder="Cari part number atau nama material…" value={search} onChange={e=>setSearch(e.target.value)}/></div><button className="btn" onClick={onExcel}>⇩ Export Excel</button><button className="btn" onClick={()=>exportCsv(filtered)}>↓ Unduh CSV</button></div><div className="toolbar log-filters"><label>Dari <input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Sampai <input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label><label>Proses <select value={process} onChange={e=>setProcess(e.target.value)}><option value="all">Semua</option><option value="in">Masuk</option><option value="out">Keluar</option><option value="adjustment">Penyesuaian</option></select></label><label>User <select value={userFilter} onChange={e=>setUserFilter(e.target.value)}><option value="all">Semua</option>{users.map(u=><option key={u}>{u}</option>)}</select></label></div>
   {shown.length?<TxTable rows={shown} onSelect={setSelected}/>:<div className="empty">▤<strong>Belum ada aktivitas</strong>Tidak ada aktivitas sesuai filter.</div>}
   <div className="toolbar page-controls"><small>{filtered.length} aktivitas</small><label>Tampilkan <select value={size} onChange={e=>setSize(Number(e.target.value))}><option>10</option><option>25</option><option>50</option></select> data</label><div className="actions"><button className="btn sm" disabled={page<=1} onClick={()=>setPage(page-1)}>‹</button><span>{page} / {pages}</span><button className="btn sm" disabled={page>=pages} onClick={()=>setPage(page+1)}>›</button></div></div>
   {selected&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setSelected(undefined)}}><div className="modal"><div className="modal-head"><h2>Detail Aktivitas</h2><button className="close" onClick={()=>setSelected(undefined)}>×</button></div><div className="detail-grid">{[['Waktu',time(selected.time)],['Proses',processName(selected.type)],['Part Number',selected.part],['Nama Material',selected.name],['Quantity',fmt(selected.qty)],['Stok Sebelum',fmt(selected.before)],['Stok Sesudah',fmt(selected.after)],['User',selected.user],['Status','Berhasil'],['Catatan',selected.note||'—']].map(([label,value])=><div className="detail-item" key={label}><small>{label}</small><strong>{value}</strong></div>)}</div></div></div>}
  </section>
}

// ── ImageUploader ────────────────────────────────────────────────
function ImageUploader({defaultImage,onImage,inputId}:{defaultImage?:string;onImage:(img:string,el:HTMLInputElement|null)=>void;inputId:string}){
  const [preview,setPreview]=useState(defaultImage||'');
  const inputRef=useRef<HTMLInputElement>(null);
  function handleFile(file:File){if(!file.type.startsWith('image/'))return;const r=new FileReader();r.onload=e=>{const src=String(e.target?.result||'');setPreview(src);if(inputRef.current){inputRef.current.dataset.preview=src;onImage(src,inputRef.current);}};r.readAsDataURL(file);}
  return <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
   <div style={{border:'2px dashed #cbd5e1',borderRadius:'10px',padding:'12px',textAlign:'center',cursor:'pointer',background:'#f8fafc',position:'relative'}} onClick={()=>document.getElementById(inputId+'_file')?.click()}>
    {preview?<img src={preview} alt="preview" style={{maxHeight:'140px',maxWidth:'100%',borderRadius:'8px',objectFit:'contain'}}/>:<div style={{color:'#94a3b8',fontSize:'13px',padding:'16px 0'}}>📷 Klik untuk upload foto material<br/><small>JPG, PNG, WEBP</small></div>}
    <input id={inputId+'_file'} type="file" accept="image/*" style={{display:'none'}} onChange={e=>{const f=e.target.files?.[0];if(f)handleFile(f);}} />
    <input ref={inputRef} id={inputId} type="hidden"/>
   </div>
   {preview&&<button type="button" className="btn sm" style={{alignSelf:'flex-start'}} onClick={()=>{setPreview('');if(inputRef.current){inputRef.current.dataset.preview=''}}}>✕ Hapus Foto</button>}
  </div>;
}

// ── Detail ───────────────────────────────────────────────────────
function Detail({item,logs,isAdmin,onBack,onEdit,onQr}:{item?:Material;logs:Tx[];isAdmin:boolean;onBack:()=>void;onEdit:(m:Material)=>void;onQr:(m:Material)=>void}){
  if(!item)return <div className="card empty">Material tidak ditemukan<button className="btn" onClick={onBack}>Kembali</button></div>;
  return <section className="card panel">
   <div className="panel-head"><div><button className="link" onClick={onBack}>Material ‹ Detail</button><h2>Detail Material</h2></div><div style={{display:'flex',gap:'8px'}}><button className="btn" style={{background:'#7c3aed',color:'#fff'}} onClick={()=>onQr(item)}>⊞ Part Card</button>{isAdmin&&<button className="btn warning" onClick={()=>onEdit(item)}>✎ Edit</button>}</div></div>
   <div style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:'24px',alignItems:'start',marginBottom:'16px'}}>
    {item.image?<img src={item.image} alt={item.name} style={{width:'160px',height:'160px',objectFit:'cover',borderRadius:'12px',border:'2px solid #e2e8f0',flexShrink:0}}/>:<div style={{width:'160px',height:'160px',borderRadius:'12px',border:'2px dashed #e2e8f0',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',color:'#cbd5e1',fontSize:'13px',gap:'8px',flexShrink:0}}><span style={{fontSize:'32px'}}>📷</span><span>Belum ada foto</span></div>}
    <div className="detail-grid" style={{margin:0}}>{[['Part Number',item.part],['Nama Material',item.name],['Quantity',fmt(item.qty)+' unit'],['Stok Minimum',fmt(item.min)+' unit'],['Last Update',time(item.updated)],['Deskripsi',item.description||'—']].map(([a,b])=><div className="detail-item" key={a}><small>{a}</small><strong>{b}</strong></div>)}</div>
   </div>
   <div className="line"/>
   <h2 className="section-title">10 Transaksi Terakhir</h2>
   {logs.length?<TxTable rows={logs.slice(0,10)}/>:<div className="empty">Belum ada transaksi untuk material ini.</div>}
  </section>;
}

// ── TxTable ──────────────────────────────────────────────────────
function TxTable({rows,compact=false,onSelect}:{rows:Tx[];compact?:boolean;onSelect?:(row:Tx)=>void}){return <div className="table-wrap"><table><thead><tr><th>No</th><th>Waktu</th><th>Proses</th><th>Part Number</th><th>Nama Material</th><th>Quantity</th>{!compact&&<><th>Stok Sebelum</th><th>Stok Sesudah</th></>}<th>User</th><th>Status</th></tr></thead><tbody>{rows.map((t,i)=><tr key={t.id} className={onSelect?'clickable-row':''} onClick={()=>onSelect?.(t)}><td>{i+1}</td><td>{time(t.time)}</td><td><span className={'badge '+t.type}>{processName(t.type)}</span></td><td>{t.part}</td><td>{t.name}</td><td>{fmt(t.qty)}</td>{!compact&&<><td>{fmt(t.before)}</td><td>{fmt(t.after)}</td></>}<td>{t.user}</td><td><span className="badge neutral">Berhasil</span></td></tr>)}</tbody></table></div>}

// ── QRCanvas ─────────────────────────────────────────────────────
function QRCanvas({value,size=180}:{value:string;size?:number}){
  const ref=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
   const canvas=ref.current;if(!canvas)return;
   import('qrcode').then(QRCode=>{QRCode.toCanvas(canvas,value,{width:size,margin:2,color:{dark:'#1e293b',light:'#ffffff'}},()=>{});});
  },[value,size]);
  return <canvas ref={ref} width={size} height={size} style={{display:'block'}}/>;
}

// ── PartCard ─────────────────────────────────────────────────────
function PartCard({material}:{material:Material}){
  const updated=new Date(material.updated).toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'});
  return(
   <div style={{width:'280px',border:'2px solid #1769f6',borderRadius:'12px',overflow:'hidden',fontFamily:'sans-serif',background:'#fff',boxShadow:'0 2px 8px rgba(0,0,0,.12)'}}>
    <div style={{background:'#1769f6',color:'#fff',padding:'10px 14px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
     <div><div style={{fontSize:'11px',opacity:.8,letterSpacing:'1px'}}>MMP WAREHOUSE</div><div style={{fontSize:'13px',fontWeight:700}}>PART CARD</div></div>
     <div style={{fontSize:'20px'}}>⬡</div>
    </div>
    <div style={{padding:'12px 14px',display:'flex',gap:'12px',alignItems:'center'}}>
     <div style={{flexShrink:0,border:'1px solid #e2e8f0',borderRadius:'8px',padding:'4px',background:'#f8fafc'}}><QRCanvas value={material.part} size={110}/></div>
     <div style={{flex:1,minWidth:0}}>
      <div style={{fontSize:'10px',color:'#64748b',marginBottom:'2px'}}>PART NUMBER</div>
      <div style={{fontSize:'13px',fontWeight:700,color:'#1769f6',wordBreak:'break-all',lineHeight:1.3}}>{material.part}</div>
      <div style={{marginTop:'8px',fontSize:'10px',color:'#64748b'}}>NAMA MATERIAL</div>
      <div style={{fontSize:'12px',fontWeight:600,color:'#1e293b',lineHeight:1.3}}>{material.name}</div>
      <div style={{marginTop:'8px',fontSize:'10px',color:'#64748b'}}>STOK MINIMUM</div>
      <div style={{fontSize:'13px',fontWeight:700,color:'#f59e0b'}}>{new Intl.NumberFormat('id-ID').format(material.min)} unit</div>
     </div>
    </div>
    <div style={{borderTop:'1px solid #e2e8f0',padding:'10px 14px'}}>
     <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
      <div><div style={{fontSize:'10px',color:'#64748b',marginBottom:'4px'}}>STOK FISIK</div><div style={{borderBottom:'2px solid #1e293b',height:'28px'}}/><div style={{fontSize:'9px',color:'#94a3b8',marginTop:'2px',textAlign:'center'}}>( diisi petugas )</div></div>
      <div><div style={{fontSize:'10px',color:'#64748b',marginBottom:'4px'}}>TANGGAL CEK</div><div style={{borderBottom:'2px solid #1e293b',height:'28px'}}/><div style={{fontSize:'9px',color:'#94a3b8',marginTop:'2px',textAlign:'center'}}>( diisi petugas )</div></div>
     </div>
    </div>
    <div style={{borderTop:'1px solid #e2e8f0',padding:'10px 14px 14px'}}><div style={{fontSize:'10px',color:'#64748b',marginBottom:'32px'}}>TANDA TANGAN PETUGAS</div><div style={{borderBottom:'2px solid #1e293b',marginBottom:'4px'}}/><div style={{fontSize:'9px',color:'#94a3b8',textAlign:'center'}}>( nama &amp; tanda tangan )</div></div>
    <div style={{background:'#f8fafc',borderTop:'1px solid #e2e8f0',padding:'6px 14px',display:'flex',justifyContent:'space-between'}}>
     <div style={{fontSize:'9px',color:'#94a3b8'}}>Diterbitkan: {updated}</div>
     <div style={{fontSize:'9px',color:'#94a3b8'}}>MMP Warehouse</div>
    </div>
   </div>
  );
}

// ── PartCardDialog ───────────────────────────────────────────────
function PartCardDialog({material,onClose}:{material:Material;onClose:()=>void}){
  function doPrint(){
   const el=document.getElementById('part-card-print');
   if(!el)return;
   const clone=el.cloneNode(true) as HTMLElement;
   const canvases=el.querySelectorAll('canvas');
   const imgs=clone.querySelectorAll('canvas');
   canvases.forEach((c,i)=>{const img=document.createElement('img');img.src=c.toDataURL();img.width=c.width;img.height=c.height;img.style.cssText=c.style.cssText||'display:block';imgs[i]?.parentNode?.replaceChild(img,imgs[i]);});
   const w=window.open('','_blank','width=400,height=600');
   if(!w)return;
   w.document.write(`<!DOCTYPE html><html><head><title>Part Card - ${material.part}</title><style>*{margin:0;padding:0;box-sizing:border-box;}body{padding:20px;display:flex;justify-content:center;}@media print{body{padding:0;}}</style></head><body>${clone.innerHTML}<script>window.onload=()=>{window.print();}<\/script></body></html>`);
   w.document.close();
  }
  return <>
   <div className="modal-head"><h2>Part Card Material</h2><button className="close" onClick={onClose}>×</button></div>
   <div style={{display:'flex',justifyContent:'center',padding:'20px 0'}} id="part-card-print"><PartCard material={material}/></div>
   <div style={{background:'#f8fafc',borderRadius:'8px',padding:'10px 14px',margin:'0 0 12px',fontSize:'13px',color:'#64748b'}}>💡 Cetak kartu ini dan tempel di rak/tempat penyimpanan. Scan QR Code untuk akses langsung ke material ini.</div>
   <div className="modal-actions"><button className="btn" onClick={onClose}>Tutup</button><button className="btn primary" onClick={doPrint}>🖨 Cetak Part Card</button></div>
  </>;
}

// ── Export utils ──────────────────────────────────────────────────
function exportCsv(rows:Tx[]){const data=[['Waktu','Proses','Part Number','Nama Material','Quantity','Stok Sebelum','Stok Sesudah','User'],...rows.map(t=>[time(t.time),processName(t.type),t.part,t.name,t.qty,t.before,t.after,t.user])];const csv=data.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n');download(new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'}),'log-aktivitas-mmp.csv')}
function exportExcel(materials:Material[],logs:Tx[]){const sheets:[string,(string|number)[][]][]=[['Data Material',[['Part Number','Nama Material','Quantity','Stok Minimum','Status','Last Update'],...materials.map(m=>[m.part,m.name,m.qty,m.min,'Aktif',time(m.updated)])]],['Log Aktivitas',[['Waktu','Proses','Part Number','Nama Material','Quantity','Stok Sebelum','Stok Sesudah','User'],...logs.map(t=>[time(t.time),processName(t.type),t.part,t.name,t.qty,t.before,t.after,t.user])]]];download(makeXlsx(sheets),'warehouse-mmp.xlsx')}
function download(blob:Blob,name:string){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function makeXlsx(sheets:[string,(string|number)[][]][]):Blob{const esc=(v:string|number)=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');const col=(n:number)=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s};const sheet=(rows:(string|number)[][])=>'<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+rows.map((r,ri)=>'<row r="'+(ri+1)+'">'+r.map((v,ci)=>typeof v==='number'?'<c r="'+col(ci)+(ri+1)+'"><v>'+v+'</v></c>':'<c r="'+col(ci)+(ri+1)+'" t="inlineStr"><is><t xml:space="preserve">'+esc(v)+'</t></is></c>').join('')+'</row>').join('')+'</sheetData></worksheet>';const files:[string,string][]=[['[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+sheets.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>'],['_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],['xl/workbook.xml','<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+sheets.map((s,i)=>'<sheet name="'+esc(s[0])+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets></workbook>'],['xl/_rels/workbook.xml.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+sheets.map((_,i)=>'<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+'</Relationships>']];sheets.forEach((s,i)=>files.push(['xl/worksheets/sheet'+(i+1)+'.xml',sheet(s[1])]));const enc=new TextEncoder(),table=Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0}),crc=(d:Uint8Array)=>{let c=0xffffffff;for(const b of d)c=table[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0},u16=(v:number)=>[v&255,(v>>>8)&255],u32=(v:number)=>[v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255];let local:Uint8Array[]=[],central:Uint8Array[]=[],offset=0;for(const[name,content]of files){const n=enc.encode(name),d=enc.encode(content),c=crc(d),h=new Uint8Array([...u32(0x04034b50),...u16(20),...u16(0x0800),...u16(0),...u16(0),...u16(0),...u32(c),...u32(d.length),...u32(d.length),...u16(n.length),...u16(0)]);local.push(h,n,d);central.push(new Uint8Array([...u32(0x02014b50),...u16(20),...u16(20),...u16(0x0800),...u16(0),...u16(0),...u16(0),...u32(c),...u32(d.length),...u32(d.length),...u16(n.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(offset)]),n);offset+=h.length+n.length+d.length}const size=central.reduce((a,x)=>a+x.length,0),end=new Uint8Array([...u32(0x06054b50),...u16(0),...u16(0),...u16(files.length),...u16(files.length),...u32(size),...u32(offset),...u16(0)]),parts=[...local,...central,end].map(chunk=>{const copy=new Uint8Array(chunk.length);copy.set(chunk);return copy.buffer});return new Blob(parts,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})}
