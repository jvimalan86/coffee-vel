import { useState, useMemo, useEffect, useCallback } from "react";

/* ═══════════════════════════════════════════════════════════════
   COFFEE VEL INTERNATIONAL — Accounting System v4
   Supabase · Multi-user · Daybook → Ledger · Stock · P&L
═══════════════════════════════════════════════════════════════ */

// ── SUPABASE CONFIG ───────────────────────────────────────────────
const SB_URL  = "https://tinwfojihvqzjfxeghkg.supabase.co";
const SB_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpbndmb2ppaHZxempmeGVnaGtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1MDQ5MDAsImV4cCI6MjA5NTA4MDkwMH0.zZlbstfQBfk04m8b92pAB1WhU1XhLam1_uUz3q1fKdQ";
const SB_HDR  = {
  "Content-Type":  "application/json",
  "apikey":        SB_KEY,
  "Authorization": `Bearer ${SB_KEY}`,
  "Prefer":        "return=representation",
};

async function sb(method, table, { body, q="" } = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}${q}`, {
    method, headers: SB_HDR,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const e = await res.json().catch(()=>({}));
    throw new Error(e.message || `DB error ${res.status} on ${table}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── DATABASE API ──────────────────────────────────────────────────
const db = {
  // USERS
  login:       (u,p)    => sb("GET","cv_users",{q:`?username=eq.${encodeURIComponent(u)}&password=eq.${encodeURIComponent(p)}&select=*`}).then(r=>r?.[0]||null),
  getUsers:    ()       => sb("GET","cv_users",{q:"?select=*&order=created_at.asc"}),
  addUser:     (d)      => sb("POST","cv_users",{body:d}),
  editUser:    (id,d)   => sb("PATCH","cv_users",{body:d,q:`?id=eq.${id}`}),
  deleteUser:  (id)     => sb("DELETE","cv_users",{q:`?id=eq.${id}`}),

  // ACCOUNTS
  getAccounts: ()       => sb("GET","cv_accounts",{q:"?select=*&order=group.asc,name.asc"}),
  addAccount:  (d)      => sb("POST","cv_accounts",{body:d}),
  patchBalance:(id,bal) => sb("PATCH","cv_accounts",{body:{balance:bal},q:`?id=eq.${id}`}),

  // PARTIES
  getParties:  ()       => sb("GET","cv_parties",{q:"?select=*&order=name.asc"}),
  addParty:    (d)      => sb("POST","cv_parties",{body:d}),
  editParty:   (id,d)   => sb("PATCH","cv_parties",{body:d,q:`?id=eq.${id}`}),

  // VOUCHERS
  getVouchers: ()       => sb("GET","cv_vouchers",{q:"?select=*&order=posted_at.desc"}),
  addVoucher:  (d)      => sb("POST","cv_vouchers",{body:d}),
  patchVoucher:(id,d)   => sb("PATCH","cv_vouchers",{body:d,q:`?id=eq.${id}`}),
  deleteVoucher:(id)    => sb("DELETE","cv_vouchers",{q:`?id=eq.${id}`}),
  getSeq:      (vt)     => sb("GET","cv_voucher_seq",{q:`?voucher_type=eq.${vt}&select=next_no`}).then(r=>r?.[0]?.next_no||1),
  incSeq:      (vt,n)   => sb("PATCH","cv_voucher_seq",{body:{next_no:n+1},q:`?voucher_type=eq.${vt}`}),

  // STOCK ITEMS
  getStockItems:()      => sb("GET","cv_stock_items",{q:"?select=name&order=name.asc"}).then(r=>r?.map(x=>x.name)||[]),
  addStockItem: (name)  => sb("POST","cv_stock_items",{body:{name}}),
  renameStockItem:(o,n) => sb("PATCH","cv_stock_items",{body:{name:n},q:`?name=eq.${encodeURIComponent(o)}`}),
  deleteStockItem:(name)=> sb("DELETE","cv_stock_items",{q:`?name=eq.${encodeURIComponent(name)}`}),

  // GRNs
  getGRNs:     ()       => sb("GET","cv_grns",{q:"?select=*&order=created_at.desc"}),
  addGRN:      (d)      => sb("POST","cv_grns",{body:d}),
  editGRN:     (id,d)   => sb("PATCH","cv_grns",{body:d,q:`?id=eq.${id}`}),
  addQuality:  (id,qr)  => sb("PATCH","cv_grns",{body:{qualityReport:qr},q:`?id=eq.${id}`}),
  deleteGRN:   (id)     => sb("DELETE","cv_grns",{q:`?id=eq.${id}`}),
  getGRNSeq:   ()       => sb("GET","cv_grn_seq",{q:"?id=eq.1&select=next_no"}).then(r=>r?.[0]?.next_no||1),
  incGRNSeq:   (n)      => sb("PATCH","cv_grn_seq",{body:{next_no:n+1},q:"?id=eq.1"}),

  // Apply double-entry balance changes
  async applyEntries(accounts, entries, sign) {
    for (const e of entries) {
      let acc = accounts[e.accountId];
      // If not in state (e.g. newly created party account), fetch from DB
      if (!acc) {
        const rows = await sb("GET","cv_accounts",{q:`?id=eq.${e.accountId}&select=id,balance,type`});
        acc = rows?.[0];
      }
      if (!acc) continue;
      const dr = parseFloat(e.dr||0) * sign;
      const cr = parseFloat(e.cr||0) * sign;
      const delta = ["asset","expense"].includes(acc.type) ? dr-cr : cr-dr;
      const newBal = parseFloat(acc.balance||0) + delta;
      await db.patchBalance(e.accountId, newBal);
    }
  },

  // MASTERS
  getWarehouses:    ()      => sb("GET","cv_warehouses",{q:"?select=*&order=name.asc"}),
  addWarehouse:     (name)  => sb("POST","cv_warehouses",{body:{name}}),
  editWarehouse:    (id,name)=> sb("PATCH","cv_warehouses",{body:{name},q:`?id=eq.${id}`}),
  deleteWarehouse:  (id)    => sb("DELETE","cv_warehouses",{q:`?id=eq.${id}`}),

  getLocations:     ()      => sb("GET","cv_locations",{q:"?select=*&order=name.asc"}),
  addLocation:      (name)  => sb("POST","cv_locations",{body:{name}}),
  editLocation:     (id,name)=> sb("PATCH","cv_locations",{body:{name},q:`?id=eq.${id}`}),
  deleteLocation:   (id)    => sb("DELETE","cv_locations",{q:`?id=eq.${id}`}),

  getCoffeeTypes:   ()      => sb("GET","cv_coffee_types",{q:"?select=*&order=name.asc"}),
  addCoffeeType:    (name)  => sb("POST","cv_coffee_types",{body:{name}}),
  editCoffeeType:   (id,name)=> sb("PATCH","cv_coffee_types",{body:{name},q:`?id=eq.${id}`}),
  deleteCoffeeType: (id)    => sb("DELETE","cv_coffee_types",{q:`?id=eq.${id}`}),

  // SAFE DELETE - check usage first
  deleteAccount: async (id, vouchers, grns) => {
    const usedInVouchers = vouchers.some(v => v.entries?.some(e => e.accountId === id));
    if (usedInVouchers) throw new Error("Cannot delete — account has transactions");
    return sb("DELETE","cv_accounts",{q:`?id=eq.${id}`});
  },
  deleteParty: async (id, vouchers, grns) => {
    const usedInVouchers = vouchers.some(v => v.entries?.some(e => e.accountId === id));
    const usedInGRNs = grns.some(g => g.partyId === id);
    if (usedInVouchers || usedInGRNs) throw new Error("Cannot delete — party has transactions or GRNs");
    await sb("DELETE","cv_parties",{q:`?id=eq.${id}`});
    return sb("DELETE","cv_accounts",{q:`?id=eq.${id}`});
  },

  // DRYING JOBS
  getDryingJobs:  ()     => sb("GET","cv_drying_jobs",{q:"?select=*&order=created_at.desc"}),
  addDryingJob:   (d)    => sb("POST","cv_drying_jobs",{body:d}),
  deleteDryingJob:(id)   => sb("DELETE","cv_drying_jobs",{q:`?id=eq.${id}`}),
  getDryingSeq:   ()     => sb("GET","cv_drying_seq",{q:"?id=eq.1&select=next_no"}).then(r=>r?.[0]?.next_no||1),
  incDryingSeq:   (n)    => sb("PATCH","cv_drying_seq",{body:{next_no:n+1},q:"?id=eq.1"}),

  // STORAGE LOTS
  getStorageLots:     ()     => sb("GET","cv_storage_lots",{q:"?select=*&order=created_at.desc"}),
  addStorageLot:      (d)    => sb("POST","cv_storage_lots",{body:d}),
  updateStorageStatus:(id,s) => sb("PATCH","cv_storage_lots",{body:{status:s},q:`?id=eq.${id}`}),
  deleteStorageLot:   (id)   => sb("DELETE","cv_storage_lots",{q:`?id=eq.${id}`}),
  getStorageSeq:      ()     => sb("GET","cv_storage_seq",{q:"?id=eq.1&select=next_no"}).then(r=>r?.[0]?.next_no||1),
  incStorageSeq:      (n)    => sb("PATCH","cv_storage_seq",{body:{next_no:n+1},q:"?id=eq.1"}),
  getStorageReleases: ()     => sb("GET","cv_storage_releases",{q:"?select=*&order=created_at.desc"}),
  addStorageRelease:  (d)    => sb("POST","cv_storage_releases",{body:d}),

  // STOCK TRANSFERS
  getTransfers:    ()    => sb("GET","cv_stock_transfers",{q:"?select=*&order=created_at.desc"}),
  addTransfer:     (d)   => sb("POST","cv_stock_transfers",{body:d}),
  updateTransfer:  (id,d)=> sb("PATCH","cv_stock_transfers",{body:d,q:`?id=eq.${id}`}),
  getTransferSeq:  ()    => sb("GET","cv_transfer_seq",{q:"?id=eq.1&select=next_no"}).then(r=>r?.[0]?.next_no||1),
  incTransferSeq:  (n)   => sb("PATCH","cv_transfer_seq",{body:{next_no:n+1},q:"?id=eq.1"}),

  // HULLING
  getHullingJobs: ()    => sb("GET","cv_hulling_jobs",{q:"?select=*&order=created_at.desc"}),
  addHullingJob:  (d)   => sb("POST","cv_hulling_jobs",{body:d}),
  deleteHullingJob:(id) => sb("DELETE","cv_hulling_jobs",{q:`?id=eq.${id}`}),
  getHullingSeq:  ()    => sb("GET","cv_hulling_seq",{q:"?id=eq.1&select=next_no"}).then(r=>r?.[0]?.next_no||1),
  incHullingSeq:  (n)   => sb("PATCH","cv_hulling_seq",{body:{next_no:n+1},q:"?id=eq.1"}),

  // YERCAUD PAYMENTS
  getYercaudPayments: () => sb("GET","cv_yercaud_payments",{q:"?select=*&order=created_at.desc"}),
  addYercaudPayment:  (d) => sb("POST","cv_yercaud_payments",{body:d}),
  deleteYercaudPayment:(id)=> sb("DELETE","cv_yercaud_payments",{q:`?id=eq.${id}`}),
  getYercaudSeq:  ()    => sb("GET","cv_yercaud_seq",{q:"?id=eq.1&select=next_no"}).then(r=>r?.[0]?.next_no||1),
  incYercaudSeq:  (n)   => sb("PATCH","cv_yercaud_seq",{body:{next_no:n+1},q:"?id=eq.1"}),

  // SALES
  getSales:     ()    => sb("GET","cv_sales",{q:"?select=*&order=created_at.desc"}),
  addSale:      (d)   => sb("POST","cv_sales",{body:d}),
  deleteSale:   (id)  => sb("DELETE","cv_sales",{q:`?id=eq.${id}`}),
  getSalesSeq:  ()    => sb("GET","cv_sales_seq",{q:"?id=eq.1&select=next_no"}).then(r=>r?.[0]?.next_no||1),
  incSalesSeq:  (n)   => sb("PATCH","cv_sales_seq",{body:{next_no:n+1},q:"?id=eq.1"}),

  // LOADMAN CHARGES
  getLoadmanCharges:  ()    => sb("GET","cv_loadman_charges",{q:"?select=*&order=created_at.desc"}),
  addLoadmanCharge:   (d)   => sb("POST","cv_loadman_charges",{body:d}),
  deleteLoadmanCharge:(id)  => sb("DELETE","cv_loadman_charges",{q:`?id=eq.${id}`}),
  getLoadmanSeq:      ()    => sb("GET","cv_loadman_seq",{q:"?id=eq.1&select=next_no"}).then(r=>r?.[0]?.next_no||1),
  incLoadmanSeq:      (n)   => sb("PATCH","cv_loadman_seq",{body:{next_no:n+1},q:"?id=eq.1"}),
  getLoadmanRates:    ()    => sb("GET","cv_loadman_rates",{q:"?select=*"}),
  saveLoadmanRate:    (d)   => sb("POST","cv_loadman_rates",{body:d}),
  updateLoadmanRate:  (id,d)=> sb("PATCH","cv_loadman_rates",{body:d,q:`?id=eq.${id}`}),

  // LORRY OWNERS
  getLorryOwners:   ()      => sb("GET","cv_lorry_owners",{q:"?select=*&order=name.asc"}),
  addLorryOwner:    (d)     => sb("POST","cv_lorry_owners",{body:d}),
  editLorryOwner:   (id,d)  => sb("PATCH","cv_lorry_owners",{body:d,q:`?id=eq.${id}`}),
  deleteLorryOwner: (id)    => sb("DELETE","cv_lorry_owners",{q:`?id=eq.${id}`}),

  // LORRY RENTALS
  getLorryRentals:   ()     => sb("GET","cv_lorry_rentals",{q:"?select=*&order=created_at.desc"}),
  addLorryRental:    (d)    => sb("POST","cv_lorry_rentals",{body:d}),
  deleteLorryRental: (id)   => sb("DELETE","cv_lorry_rentals",{q:`?id=eq.${id}`}),
  getLorrySeq:       ()     => sb("GET","cv_lorry_seq",{q:"?id=eq.1&select=next_no"}).then(r=>r?.[0]?.next_no||1),
  incLorrySeq:       (n)    => sb("PATCH","cv_lorry_seq",{body:{next_no:n+1},q:"?id=eq.1"}),
  getLorryPayments:  ()     => sb("GET","cv_lorry_payments",{q:"?select=*&order=created_at.desc"}),
  addLorryPayment:   (d)    => sb("POST","cv_lorry_payments",{body:d}),
  deleteLorryPayment:(id)   => sb("DELETE","cv_lorry_payments",{q:`?id=eq.${id}`}),
  getLorryPaySeq:    ()     => sb("GET","cv_lorry_pay_seq",{q:"?id=eq.1&select=next_no"}).then(r=>r?.[0]?.next_no||1),
  incLorryPaySeq:    (n)    => sb("PATCH","cv_lorry_pay_seq",{body:{next_no:n+1},q:"?id=eq.1"}),

};


// ── CONSTANTS ────────────────────────────────────────────────────
const DEFAULT_COFFEE_ITEMS = [
  "Wet Parchment","Parchment","Dry Cherry","Cherry",
  "Coffee Rice (Bulk)","Grade AA","Grade A","Grade B",
  "Grade C","Grade PB","Grade BBB",
];

const PRESET_ACCOUNTS = [
  { id:"cash",      name:"Cash in Hand",      group:"Cash & Bank", type:"asset"     },
  { id:"sales",     name:"Sales Account",       group:"Income",      type:"income"    },
  { id:"purchases", name:"Purchase Account",    group:"Expenses",    type:"expense"   },
  { id:"curing",         name:"Curing Income",   group:"Income",   type:"income"  },
  { id:"curing_expense", name:"Curing Expense",  group:"Expenses", type:"expense" },
  { id:"drying",         name:"Drying Income",   group:"Income",   type:"income"  },
  { id:"drying_expense", name:"Drying Expense",  group:"Expenses", type:"expense" },
  { id:"loadman_payable", name:"Loadman Payable", group:"Creditors", type:"liability" },
  { id:"loadman_expense", name:"Loadman Expense", group:"Expenses",  type:"expense"  },
  { id:"lorry_expense",   name:"Lorry Expense",   group:"Expenses",  type:"expense"  },
  { id:"transport", name:"Transport Expenses",  group:"Expenses",    type:"expense"   },
  { id:"salary",    name:"Salary & Wages",      group:"Expenses",    type:"expense"   },
  { id:"capital",   name:"Capital Account",     group:"Capital",     type:"liability" },
];

const VOUCHER_TYPES = [
  { id:"RV",  label:"Receipt",  color:"#22c55e", icon:"↓" },
  { id:"PV",  label:"Payment",  color:"#ef4444", icon:"↑" },
  { id:"CV",  label:"Contra",   color:"#8b5cf6", icon:"⇄" },
  { id:"JV",  label:"Journal",  color:"#f59e0b", icon:"✎" },
  { id:"SV",  label:"Sales",    color:"#3b82f6", icon:"🏷" },
];

const ROLES = {
  admin:      { label:"Admin",           canDelete:true,  canPost:true,  canViewReports:true,  isBranch:false },
  accountant: { label:"Accountant",      canDelete:false, canPost:true,  canViewReports:true,  isBranch:false },
  viewer:     { label:"View Only",       canDelete:false, canPost:false, canViewReports:true,  isBranch:false },
  branch:     { label:"Branch (Yercaud)",canDelete:false, canPost:true,  canViewReports:false, isBranch:true  },
};

// ── DESIGN ────────────────────────────────────────────────────────
const C = {
  bg:"#faf6f0", surface:"#ffffff", border:"#e8ddd0",
  text:"#2c1a0e", muted:"#8c7560", accent:"#6b3f1a",
  green:"#15803d", red:"#b91c1c", blue:"#1d4ed8",
  gold:"#92400e", cream:"#fdf8f2",
};
const sh = {
  input:{ border:`1px solid ${C.border}`, borderRadius:6, padding:"7px 10px", fontSize:13, background:C.cream, color:C.text, outline:"none", fontFamily:"inherit", width:"100%", boxSizing:"border-box" },
  label:{ fontSize:11, fontWeight:700, color:C.muted, letterSpacing:0.5, textTransform:"uppercase", display:"block", marginBottom:3 },
  card:{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:"18px 20px", boxShadow:"0 1px 4px #00000012" },
  th:{ textAlign:"left", padding:"8px 12px", fontSize:11, color:C.muted, fontWeight:700, letterSpacing:0.5, textTransform:"uppercase", borderBottom:`2px solid ${C.border}`, whiteSpace:"nowrap" },
  td:{ padding:"9px 12px", fontSize:13, color:C.text, borderBottom:`1px solid #f0e8e0` },
};

// ── HELPERS ───────────────────────────────────────────────────────
const fmt  = n => "₹"+Math.abs(Number(n)||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtQ = n => Number(n).toLocaleString("en-IN",{maximumFractionDigits:3});
const today= ()=> new Date().toISOString().slice(0,10);
const vInfo= id=> VOUCHER_TYPES.find(v=>v.id===id)||{};

// Trial balance Dr/Cr direction
const tbDr = a => ["asset","expense"].includes(a.type) ? (a.balance>0?a.balance:0) : (a.balance<0?Math.abs(a.balance):0);
const tbCr = a => ["liability","income","capital"].includes(a.type) ? (a.balance>0?a.balance:0) : (a.balance<0?Math.abs(a.balance):0);
const balLabel = a => tbDr(a)>0 ? "Dr" : "Cr";
const balColor = a => tbDr(a)>0 ? C.green : C.red;

// ── SHARED UI ─────────────────────────────────────────────────────
function Field({ label, children, style }) {
  return <div style={{display:"flex",flexDirection:"column",gap:3,...style}}><label style={sh.label}>{label}</label>{children}</div>;
}
function Btn({ children, onClick, variant="primary", size="md", disabled }) {
  const bg={primary:C.accent,success:"#15803d",danger:"#b91c1c",ghost:"transparent",outline:"transparent"}[variant];
  const cl={primary:"#fff",success:"#fff",danger:"#fff",ghost:C.muted,outline:C.accent}[variant];
  const br={ghost:`1px solid ${C.border}`,outline:`1px solid ${C.accent}`}[variant]||"none";
  const pd={sm:"4px 10px",md:"7px 16px",lg:"10px 24px"}[size];
  return <button onClick={onClick} disabled={disabled} style={{background:bg,color:cl,border:br,borderRadius:6,padding:pd,fontSize:size==="sm"?12:13,fontWeight:600,cursor:disabled?"not-allowed":"pointer",fontFamily:"inherit",opacity:disabled?0.5:1}}>{children}</button>;
}
function VBadge({ type }) {
  const v=vInfo(type);
  return <span style={{background:(v.color||"#888")+"18",color:v.color||"#888",border:`1px solid ${(v.color||"#888")}33`,padding:"2px 8px",borderRadius:20,fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{v.icon} {v.label}</span>;
}
function Modal({ title, children, onClose }) {
  return (
    <div style={{position:"fixed",inset:0,background:"#00000066",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{...sh.card,width:"100%",maxWidth:480,maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontWeight:800,fontSize:16,color:C.accent}}>{title}</div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:C.muted}}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}


// ── VOUCHER FORM ──────────────────────────────────────────────────
function blankEntries(type, firstBankId=""){
  if(type==="RV")  return [{accountId:"cash",     dr:"",cr:"",narration:""},{accountId:"",dr:"",cr:"",narration:""}];
  if(type==="PV")  return [{accountId:"",         dr:"",cr:"",narration:""},{accountId:"cash",dr:"",cr:"",narration:""}];
  if(type==="CV")  return [{accountId:firstBankId,dr:"",cr:"",narration:""},{accountId:"cash",dr:"",cr:"",narration:""}];
  if(type==="PuV") return [{accountId:"purchases",dr:"",cr:"",narration:""},{accountId:"",dr:"",cr:"",narration:""}];
  if(type==="SV")  return [{accountId:"",         dr:"",cr:"",narration:""},{accountId:"sales",dr:"",cr:"",narration:""}];
  return [{accountId:"",dr:"",cr:"",narration:""},{accountId:"",dr:"",cr:"",narration:""}];
}

function ItemRows({ items, onChange, voucherType, stockItems }) {
  const add=()=>onChange([...items,{itemName:"",customItem:"",qty:"",unit:"kg",rate:"",amount:0}]);
  const remove=i=>items.length>1&&onChange(items.filter((_,idx)=>idx!==i));
  const update=(i,field,val)=>{
    const updated=items.map((it,idx)=>{
      if(idx!==i) return it;
      const next={...it,[field]:val};
      if(field==="qty"||field==="rate") next.amount=parseFloat(next.qty||0)*parseFloat(next.rate||0);
      return next;
    });
    onChange(updated);
  };
  const total=items.reduce((s,it)=>s+(parseFloat(it.amount)||0),0);
  return (
    <div style={{border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
      <div style={{background:"#f5ede4",padding:"8px 12px",fontSize:12,fontWeight:700,color:C.accent}}>
        📦 {voucherType==="PuV"?"Purchase":"Sales"} Items
      </div>
      <table style={{width:"100%",borderCollapse:"collapse"}}>
        <thead><tr style={{background:"#fdf5ee"}}>
          <th style={sh.th}>Item</th>
          <th style={{...sh.th,width:80}}>Qty</th>
          <th style={{...sh.th,width:70}}>Unit</th>
          <th style={{...sh.th,width:100,textAlign:"right"}}>Rate (₹)</th>
          <th style={{...sh.th,width:110,textAlign:"right"}}>Amount (₹)</th>
          <th style={{...sh.th,width:30}}></th>
        </tr></thead>
        <tbody>
          {items.map((it,i)=>(
            <tr key={i}>
              <td style={{padding:"5px 8px",borderBottom:`1px solid ${C.border}`}}>
                <select value={it.itemName==="__custom__"?"__custom__":it.itemName}
                  onChange={e=>update(i,"itemName",e.target.value)} style={sh.input}>
                  <option value="">— Select Item —</option>
                  {stockItems.map(c=><option key={c} value={c}>{c}</option>)}
                  <option value="__custom__">✏ Custom Item…</option>
                </select>
                {it.itemName==="__custom__"&&<input placeholder="Type item name" value={it.customItem||""} onChange={e=>update(i,"customItem",e.target.value)} style={{...sh.input,marginTop:4}}/>}
              </td>
              <td style={{padding:"5px 8px",borderBottom:`1px solid ${C.border}`}}>
                <input type="number" placeholder="0" value={it.qty} onChange={e=>update(i,"qty",e.target.value)} style={{...sh.input,textAlign:"right"}}/>
              </td>
              <td style={{padding:"5px 8px",borderBottom:`1px solid ${C.border}`}}>
                <select value={it.unit} onChange={e=>update(i,"unit",e.target.value)} style={sh.input}>
                  <option value="kg">kg</option><option value="units">units</option>
                  <option value="paka">paka</option><option value="bags">bags</option><option value="MT">MT</option>
                </select>
              </td>
              <td style={{padding:"5px 8px",borderBottom:`1px solid ${C.border}`}}>
                <input type="number" placeholder="0.00" value={it.rate} onChange={e=>update(i,"rate",e.target.value)} style={{...sh.input,textAlign:"right"}}/>
              </td>
              <td style={{padding:"5px 8px",borderBottom:`1px solid ${C.border}`,textAlign:"right",fontFamily:"monospace",fontWeight:700,color:C.accent}}>{fmt(it.amount||0)}</td>
              <td style={{padding:"5px 8px",borderBottom:`1px solid ${C.border}`,textAlign:"center"}}>
                <button onClick={()=>remove(i)} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:16}}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr style={{background:"#f5ede4"}}>
          <td style={{padding:"8px 12px"}}><button onClick={add} style={{background:"none",border:"none",color:C.accent,cursor:"pointer",fontWeight:700,fontSize:13,fontFamily:"inherit"}}>+ Add Item</button></td>
          <td colSpan={3} style={{padding:"8px 12px",textAlign:"right",fontWeight:700,color:C.muted,fontSize:12}}>TOTAL</td>
          <td style={{padding:"8px 12px",textAlign:"right",fontFamily:"monospace",fontWeight:800,color:C.accent}}>{fmt(total)}</td>
          <td></td>
        </tr></tfoot>
      </table>
    </div>
  );
}

function VoucherForm({ state, dispatch, initial, onDone, editId }) {
  const [vType,setVType]       = useState(initial?.voucherType||"RV");
  const [date,setDate]         = useState(initial?.date||today());
  const [narration,setNarration]= useState(initial?.narration||"");
  const [reference,setReference]= useState(initial?.reference||"");
  const [entries,setEntries]   = useState(initial?.entries||blankEntries(initial?.voucherType||"RV",""));
  const [items,setItems]       = useState(initial?.items||[{itemName:"",customItem:"",qty:"",unit:"kg",rate:"",amount:0}]);
  const [formError,setFormError]= useState("");

  const isSV=vType==="SV", isPuV=vType==="PuV", hasItems=isSV||isPuV;
  const allAccounts=Object.values(state.accounts).sort((a,b)=>a.name.localeCompare(b.name));
  const firstBankId=allAccounts.find(a=>a.group==="Cash & Bank"&&a.id!=="cash")?.id||"";
  const groups=["Cash & Bank","Debtors","Creditors","Income","Expenses","Capital","Other"];

  const AccSelect=({value,onChange})=>(
    <select value={value} onChange={onChange} style={sh.input}>
      <option value="">— Select Account —</option>
      {groups.map(grp=>{
        const accs=allAccounts.filter(a=>(a.group||"Other")===grp);
        if(!accs.length) return null;
        return <optgroup key={grp} label={grp}>{accs.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>;
      })}
    </select>
  );

  const itemTotal=items.reduce((s,it)=>s+(parseFloat(it.amount)||0),0);
  const syncedEntries=useMemo(()=>{
    if(!hasItems||itemTotal===0) return entries;
    return entries.map((e,i)=>{
      if(isPuV) return i===0?{...e,dr:itemTotal.toFixed(2)}:{...e,cr:itemTotal.toFixed(2)};
      if(isSV)  return i===0?{...e,dr:itemTotal.toFixed(2)}:{...e,cr:itemTotal.toFixed(2)};
      return e;
    });
  },[entries,itemTotal,hasItems,isPuV,isSV]);

  const totalDr=syncedEntries.reduce((s,e)=>s+parseFloat(e.dr||0),0);
  const totalCr=syncedEntries.reduce((s,e)=>s+parseFloat(e.cr||0),0);
  const balanced=Math.abs(totalDr-totalCr)<0.01&&totalDr>0;

  const updateEntry=(i,field,val)=>setEntries(entries.map((e,idx)=>idx===i?{...e,[field]:val}:e));
  const addRow=()=>setEntries([...entries,{accountId:"",dr:"",cr:"",narration:""}]);
  const removeRow=i=>entries.length>2&&setEntries(entries.filter((_,idx)=>idx!==i));
  const switchType=t=>{setVType(t);setEntries(blankEntries(t,firstBankId));setItems([{itemName:"",customItem:"",qty:"",unit:"kg",rate:"",amount:0}]);};

  const post=()=>{
    if(!balanced){ setFormError("Voucher not balanced! Dr must equal Cr."); return; }
    setFormError("");
    const validEntries=syncedEntries.filter(e=>e.accountId&&(parseFloat(e.dr||0)>0||parseFloat(e.cr||0)>0));
    if(validEntries.length<2){ setFormError("At least 2 account entries required."); return; }
    const resolvedItems=hasItems?items.filter(it=>(it.itemName||it.customItem)&&parseFloat(it.qty||0)>0)
      .map(it=>({...it,itemName:it.itemName==="__custom__"?(it.customItem||"Custom"):it.itemName})):[];
    const data={voucherType:vType,date,narration,reference,entries:validEntries,items:resolvedItems};
    if(editId) dispatch({type:"EDIT_VOUCHER",id:editId,data});
    else       dispatch({type:"POST_VOUCHER",data});
    onDone();
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        {VOUCHER_TYPES.map(v=>(
          <button key={v.id} onClick={()=>switchType(v.id)} style={{padding:"5px 12px",borderRadius:20,border:`2px solid ${vType===v.id?v.color:C.border}`,background:vType===v.id?v.color+"18":"transparent",color:vType===v.id?v.color:C.muted,fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>{v.icon} {v.label}</button>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:12}}>
        <Field label="Date"><input type="date" value={date} onChange={e=>setDate(e.target.value)} style={sh.input}/></Field>
        <Field label="Ref / Cheque No."><input value={reference} onChange={e=>setReference(e.target.value)} placeholder="Optional" style={sh.input}/></Field>
        <Field label="Narration" style={{gridColumn:"span 2"}}><input value={narration} onChange={e=>setNarration(e.target.value)} placeholder="Description" style={sh.input}/></Field>
      </div>
      {hasItems&&<ItemRows items={items} onChange={setItems} voucherType={vType}
        stockItems={[
          ...(state.coffeeTypes?.map(c=>c.name)||[]),
          "Grade AA","Grade A","Grade B","Grade C","Grade PB","Grade BBB","Bits","Coffee Rice (Bulk)",
        ].filter((v,i,a)=>a.indexOf(v)===i)}
      />}
      <div style={{border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
        <div style={{background:"#f5ede4",padding:"8px 12px",fontSize:12,fontWeight:700,color:C.accent}}>
          📒 Accounting Entries {hasItems&&itemTotal>0&&<span style={{color:C.muted,fontWeight:400,marginLeft:8}}>(amounts auto-filled)</span>}
        </div>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr style={{background:"#fdf5ee"}}>
            <th style={sh.th}>Account</th>
            <th style={{...sh.th,width:110,textAlign:"right"}}>Dr (₹)</th>
            <th style={{...sh.th,width:110,textAlign:"right"}}>Cr (₹)</th>
            <th style={sh.th}>Line Narration</th>
            <th style={{...sh.th,width:30}}></th>
          </tr></thead>
          <tbody>
            {syncedEntries.map((e,i)=>(
              <tr key={i}>
                <td style={{padding:"5px 8px",borderBottom:`1px solid ${C.border}`}}><AccSelect value={e.accountId} onChange={ev=>updateEntry(i,"accountId",ev.target.value)}/></td>
                <td style={{padding:"5px 8px",borderBottom:`1px solid ${C.border}`}}>
                  <input type="number" placeholder="0.00" value={e.dr} readOnly={hasItems} onChange={ev=>!hasItems&&updateEntry(i,"dr",ev.target.value)} style={{...sh.input,textAlign:"right",color:C.blue,background:hasItems&&e.dr?"#eff6ff":C.cream}}/>
                </td>
                <td style={{padding:"5px 8px",borderBottom:`1px solid ${C.border}`}}>
                  <input type="number" placeholder="0.00" value={e.cr} readOnly={hasItems} onChange={ev=>!hasItems&&updateEntry(i,"cr",ev.target.value)} style={{...sh.input,textAlign:"right",color:C.red,background:hasItems&&e.cr?"#fef2f2":C.cream}}/>
                </td>
                <td style={{padding:"5px 8px",borderBottom:`1px solid ${C.border}`}}>
                  <input placeholder="Note…" value={e.narration} onChange={ev=>updateEntry(i,"narration",ev.target.value)} style={sh.input}/>
                </td>
                <td style={{padding:"5px 8px",borderBottom:`1px solid ${C.border}`,textAlign:"center"}}>
                  <button onClick={()=>removeRow(i)} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:16}}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr style={{background:"#f5ede4"}}>
            <td style={{padding:"8px 12px"}}>
              {!hasItems&&<button onClick={addRow} style={{background:"none",border:"none",color:C.accent,cursor:"pointer",fontWeight:700,fontSize:13,fontFamily:"inherit"}}>+ Add Row</button>}
            </td>
            <td style={{padding:"8px 12px",textAlign:"right",fontWeight:700,color:C.blue,fontFamily:"monospace"}}>{fmt(totalDr)}</td>
            <td style={{padding:"8px 12px",textAlign:"right",fontWeight:700,color:C.red,fontFamily:"monospace"}}>{fmt(totalCr)}</td>
            <td colSpan={2} style={{padding:"8px 12px"}}>
              {totalDr>0&&<span style={{fontSize:12,fontWeight:700,color:balanced?C.green:C.red}}>{balanced?"✓ Balanced":`⚠ Diff: ${fmt(Math.abs(totalDr-totalCr))}`}</span>}
            </td>
          </tr></tfoot>
        </table>
      </div>
      <div style={{display:"flex",gap:10}}>
        <Btn onClick={post} variant="success" size="lg" disabled={!balanced}>{editId?"✓ Save Changes":"✓ Post Voucher"}</Btn>
        <Btn onClick={onDone} variant="ghost">Cancel</Btn>
      </div>
      {formError&&<div style={{color:C.red,fontWeight:700,fontSize:13,padding:"8px 12px",background:"#fee2e2",borderRadius:6}}>{formError}</div>}
    </div>
  );
}

// ── DAYBOOK ───────────────────────────────────────────────────────
function Daybook({ state, dispatch, role }) {
  const [showForm,setShowForm]   = useState(false);
  const [defaultType,setDefaultType]= useState("RV");
  const [editVoucher,setEditVoucher]= useState(null);
  const [filterDate,setFilterDate]  = useState("");
  const [filterType,setFilterType]  = useState("all");
  const [expandedId,setExpandedId]  = useState(null);
  const [confirmDeleteId,setConfirmDeleteId] = useState(null);

  const canPost=ROLES[role]?.canPost;
  const canDelete=ROLES[role]?.canDelete;

  const vouchers=useMemo(()=>state.vouchers.filter(v=>{
    if(filterType!=="all"&&v.voucherType!==filterType) return false;
    if(filterDate&&v.date!==filterDate) return false;
    return true;
  }),[state.vouchers,filterType,filterDate]);

  const openNew=t=>{setEditVoucher(null);setDefaultType(t);setShowForm(true);};
  const openEdit=v=>{setEditVoucher(v);setShowForm(true);setExpandedId(null);};
  const closeForm=()=>{setShowForm(false);setEditVoucher(null);};
  const doDelete=id=>setConfirmDeleteId(id);
  const confirmDelete=()=>{dispatch({type:"DELETE_VOUCHER",id:confirmDeleteId});setConfirmDeleteId(null);setExpandedId(null);};

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
        <div>
          <h2 style={{margin:0,color:C.text,fontSize:22,fontWeight:800}}>📓 Day Book</h2>
          <p style={{margin:"2px 0 0",color:C.muted,fontSize:13}}>Coffee Vel International · All Voucher Entries</p>
        </div>
        {canPost&&(
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {VOUCHER_TYPES.map(v=>(
              <button key={v.id} onClick={()=>openNew(v.id)} style={{padding:"6px 12px",borderRadius:6,border:`1px solid ${v.color}`,background:v.color+"12",color:v.color,fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>{v.icon} {v.label}</button>
            ))}
          </div>
        )}
      </div>

      {confirmDeleteId&&(
        <div style={{position:"fixed",inset:0,background:"#00000066",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:C.surface,borderRadius:14,padding:"28px 32px",maxWidth:380,width:"100%",boxShadow:"0 20px 60px #00000044",textAlign:"center"}}>
            <div style={{fontSize:36,marginBottom:12}}>🗑</div>
            <div style={{fontWeight:800,fontSize:17,color:C.text,marginBottom:8}}>Delete Voucher?</div>
            <div style={{fontSize:13,color:C.muted,marginBottom:20}}>This will permanently reverse all accounting entries for <strong>{confirmDeleteId}</strong>.</div>
            <div style={{display:"flex",gap:10,justifyContent:"center"}}>
              <Btn variant="danger" onClick={confirmDelete}>Yes, Delete</Btn>
              <Btn variant="ghost" onClick={()=>setConfirmDeleteId(null)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      {showForm&&(
        <div style={{...sh.card,border:`2px solid ${C.accent}44`}}>
          <div style={{fontWeight:800,color:C.accent,marginBottom:14,fontSize:15}}>{editVoucher?`✏ Edit — ${editVoucher.id}`:"New Voucher Entry"}</div>
          <VoucherForm state={state} dispatch={dispatch} initial={editVoucher?{...editVoucher}:{voucherType:defaultType}} editId={editVoucher?.id} onDone={closeForm}/>
        </div>
      )}

      <div style={{display:"flex",gap:12,alignItems:"flex-end",flexWrap:"wrap"}}>
        <Field label="Filter by Date"><input type="date" value={filterDate} onChange={e=>setFilterDate(e.target.value)} style={{...sh.input,width:160}}/></Field>
        <Field label="Voucher Type">
          <select value={filterType} onChange={e=>setFilterType(e.target.value)} style={{...sh.input,width:150}}>
            <option value="all">All Types</option>
            {VOUCHER_TYPES.map(v=><option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </Field>
        {(filterDate||filterType!=="all")&&<Btn variant="ghost" size="sm" onClick={()=>{setFilterDate("");setFilterType("all");}}>✕ Clear</Btn>}
        <span style={{marginLeft:"auto",color:C.muted,fontSize:13,alignSelf:"flex-end"}}>{vouchers.length} voucher{vouchers.length!==1?"s":""}</span>
      </div>

      {vouchers.length===0?(
        <div style={{...sh.card,textAlign:"center",color:C.muted,padding:48}}>
          <div style={{fontSize:36,marginBottom:8}}>📓</div>No entries yet.
        </div>
      ):vouchers.map(v=>{
        const expanded=expandedId===v.id;
        const totalDr=v.entries.reduce((s,e)=>s+parseFloat(e.dr||0),0);
        return (
          <div key={v.id} style={{...sh.card,padding:0,overflow:"hidden"}}>
            <div onClick={()=>setExpandedId(expanded?null:v.id)} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 16px",cursor:"pointer",background:expanded?"#fdf0e8":C.surface,flexWrap:"wrap"}}>
              <VBadge type={v.voucherType}/>
              <span style={{fontWeight:800,color:C.accent,fontSize:13,fontFamily:"monospace",minWidth:90}}>{v.id}</span>
              <span style={{fontSize:13,color:C.muted,minWidth:90}}>{v.date}</span>
              <span style={{flex:1,fontSize:13,color:C.text}}>{v.narration||"—"}</span>
              {v.reference&&<span style={{fontSize:11,color:C.muted,background:"#f0e8de",padding:"2px 8px",borderRadius:4}}>Ref: {v.reference}</span>}
              {v.editedAt&&<span style={{fontSize:10,color:C.muted,fontStyle:"italic"}}>edited</span>}
              <span style={{fontFamily:"monospace",fontWeight:800,color:C.accent,fontSize:14}}>{fmt(totalDr)}</span>
              <span style={{color:C.muted}}>{expanded?"▲":"▼"}</span>
            </div>
            {expanded&&(
              <div style={{borderTop:`1px solid ${C.border}`}}>
                {v.items&&v.items.length>0&&(
                  <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`}}>
                    <div style={{fontSize:11,fontWeight:700,color:C.accent,marginBottom:8,textTransform:"uppercase"}}>Items</div>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                      <thead><tr style={{background:"#fdf5ee"}}>
                        <th style={sh.th}>Item</th><th style={{...sh.th,textAlign:"right"}}>Qty</th>
                        <th style={sh.th}>Unit</th><th style={{...sh.th,textAlign:"right"}}>Rate</th><th style={{...sh.th,textAlign:"right"}}>Amount</th>
                      </tr></thead>
                      <tbody>{v.items.map((it,i)=>(
                        <tr key={i}>
                          <td style={sh.td}>{it.itemName}</td>
                          <td style={{...sh.td,textAlign:"right",fontFamily:"monospace"}}>{fmtQ(it.qty)}</td>
                          <td style={sh.td}>{it.unit}</td>
                          <td style={{...sh.td,textAlign:"right",fontFamily:"monospace"}}>{fmt(it.rate)}</td>
                          <td style={{...sh.td,textAlign:"right",fontFamily:"monospace",fontWeight:700}}>{fmt(it.amount)}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead><tr style={{background:"#fdf5ee"}}>
                    <th style={sh.th}>Account</th><th style={{...sh.th,textAlign:"right"}}>Dr</th>
                    <th style={{...sh.th,textAlign:"right"}}>Cr</th><th style={sh.th}>Narration</th>
                  </tr></thead>
                  <tbody>{v.entries.map((e,i)=>{
                    const acc=state.accounts[e.accountId];
                    return(
                      <tr key={i}>
                        <td style={sh.td}>{acc?.name||e.accountId}</td>
                        <td style={{...sh.td,textAlign:"right",fontFamily:"monospace",color:C.blue}}>{parseFloat(e.dr||0)>0?fmt(e.dr):"—"}</td>
                        <td style={{...sh.td,textAlign:"right",fontFamily:"monospace",color:C.red}}>{parseFloat(e.cr||0)>0?fmt(e.cr):"—"}</td>
                        <td style={{...sh.td,color:C.muted,fontStyle:"italic"}}>{e.narration||"—"}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
                <div style={{padding:"10px 16px",display:"flex",gap:8,justifyContent:"flex-end",background:"#fdf8f4"}}>
                  {canPost&&<Btn size="sm" variant="outline" onClick={()=>openEdit(v)}>✏ Edit</Btn>}
                  {canDelete&&<Btn size="sm" variant="danger" onClick={()=>doDelete(v.id)}>🗑 Delete</Btn>}
                  {!canPost&&!canDelete&&<span style={{fontSize:12,color:C.muted}}>View only</span>}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── LEDGER ────────────────────────────────────────────────────────
function LedgerView({ state }) {
  const [selectedAcc,setSelectedAcc]=useState("");
  const [fromDate, setFromDate]=useState("");
  const [toDate,   setToDate]  =useState("");
  const allAccounts=Object.values(state.accounts).sort((a,b)=>a.name.localeCompare(b.name));
  const account=selectedAcc?state.accounts[selectedAcc]:null;
  const groups=["Cash & Bank","Debtors","Creditors","Income","Expenses","Capital","Other"];

  const ledgerEntries=useMemo(()=>{
    if(!selectedAcc) return [];
    const lines=[];
    const sorted=[...state.vouchers].sort((a,b)=>{
      const dateComp = (a.date||"").localeCompare(b.date||"");
      if (dateComp!==0) return dateComp;
      return (a.postedAt||a.posted_at||"").localeCompare(b.postedAt||b.posted_at||"");
    });
    const acc=state.accounts[selectedAcc];
    const isDebitNormal = ["asset","expense"].includes(acc?.type);
    let balance=0;
    sorted.forEach(v=>{
      v.entries.forEach(e=>{
        if(e.accountId!==selectedAcc) return;
        const dr=parseFloat(e.dr||0), cr=parseFloat(e.cr||0);
        balance += isDebitNormal ? dr-cr : cr-dr;
        lines.push({
          voucherId:v.id,
          voucherType:v.voucherType||v.voucher_type,
          date:v.date,
          narration:e.narration||v.narration||"",
          dr, cr, balance
        });
      });
    });
    return lines;
  },[selectedAcc,state.vouchers,state.accounts]);

  // Filter entries by date range for display (but closing balance uses all)
  const filteredEntries = useMemo(()=>{
    if (!fromDate && !toDate) return ledgerEntries;
    return ledgerEntries.filter(e=>{
      if (fromDate && e.date < fromDate) return false;
      if (toDate   && e.date > toDate)   return false;
      return true;
    });
  },[ledgerEntries, fromDate, toDate]);

  // Use computed closing balance from filtered entries
  const computedBalance = filteredEntries.length>0 ? filteredEntries[filteredEntries.length-1].balance : 0;

  return (
    <div style={{display:"flex",gap:20}}>
      <div style={{width:230,flexShrink:0}}>
        <div style={{...sh.card,padding:0,overflow:"hidden"}}>
          <div style={{padding:"12px 16px",background:C.accent,color:"#fff",fontWeight:800,fontSize:14}}>📂 Accounts</div>
          <div style={{overflowY:"auto",maxHeight:"72vh"}}>
            {groups.map(grp=>{
              const accs=allAccounts.filter(a=>(a.group||"Other")===grp);
              if(!accs.length) return null;
              return(
                <div key={grp}>
                  <div style={{padding:"5px 14px",background:"#f5ede4",fontSize:10,fontWeight:800,color:C.muted,letterSpacing:1,textTransform:"uppercase"}}>{grp}</div>
                  {accs.map(a=>(
                    <div key={a.id} onClick={()=>setSelectedAcc(a.id)} style={{padding:"8px 16px",cursor:"pointer",borderBottom:`1px solid ${C.border}`,background:selectedAcc===a.id?"#fdf0e8":"transparent",borderLeft:selectedAcc===a.id?`3px solid ${C.accent}`:"3px solid transparent"}}>
                      <div style={{fontSize:13,fontWeight:600,color:selectedAcc===a.id?C.accent:C.text}}>{a.name}</div>
                      <div style={{fontSize:11,color:balColor(a),fontFamily:"monospace",marginTop:1}}>{fmt(Math.abs(a.balance))} {balLabel(a)}</div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div style={{flex:1}}>
        {!account?(
          <div style={{...sh.card,textAlign:"center",color:C.muted,padding:60}}><div style={{fontSize:36,marginBottom:8}}>👈</div>Select an account</div>
        ):(
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{...sh.card,background:C.accent,color:"#fff"}}>
              <div style={{fontSize:20,fontWeight:800}}>{account.name}</div>
              <div style={{display:"flex",gap:24,marginTop:8,flexWrap:"wrap"}}>
                {[["Group",account.group],["Type",account.type],["Entries",filteredEntries.length]].map(([l,v])=>(
                  <div key={l}><div style={{fontSize:10,opacity:0.7,textTransform:"uppercase",letterSpacing:1}}>{l}</div><div style={{fontWeight:700,textTransform:"capitalize"}}>{v}</div></div>
                ))}
                <div><div style={{fontSize:10,opacity:0.7,textTransform:"uppercase",letterSpacing:1}}>Closing Balance</div>
                <div style={{fontWeight:800,fontFamily:"monospace",fontSize:18}}>{fmt(Math.abs(computedBalance))} {getBalLabel(account, computedBalance)}</div></div>
              </div>
            </div>
            {/* Date filter + Print */}
            <div style={{display:"flex",gap:10,alignItems:"flex-end",flexWrap:"wrap"}}>
              <Field label="From Date"><input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)} style={{...sh.input,width:150}}/></Field>
              <Field label="To Date"><input type="date" value={toDate} onChange={e=>setToDate(e.target.value)} style={{...sh.input,width:150}}/></Field>
              {(fromDate||toDate)&&<Btn variant="ghost" size="sm" onClick={()=>{setFromDate("");setToDate("");}}>✕ Clear</Btn>}
              <div style={{marginLeft:"auto"}}>
                <Btn variant="outline" size="sm" onClick={()=>printLedger(account, filteredEntries, fromDate, toDate)}>🖨 Print Statement</Btn>
              </div>
            </div>
            <div style={{...sh.card,padding:0,overflow:"hidden"}}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead><tr style={{background:"#f5ede4"}}>
                  <th style={sh.th}>Date</th><th style={sh.th}>Voucher</th><th style={sh.th}>Particulars</th>
                  <th style={{...sh.th,textAlign:"right"}}>Dr</th><th style={{...sh.th,textAlign:"right"}}>Cr</th><th style={{...sh.th,textAlign:"right"}}>Balance</th>
                </tr></thead>
                <tbody>
                  {filteredEntries.length===0?(
                    <tr><td colSpan={6} style={{...sh.td,textAlign:"center",color:C.muted,padding:30}}>No transactions{(fromDate||toDate)?" in selected period":""}</td></tr>
                  ):filteredEntries.map((e,i)=>(
                    <tr key={i} style={{background:i%2===0?C.surface:C.cream}}>
                      <td style={sh.td}>{e.date}</td>
                      <td style={sh.td}>
                        <div style={{display:"flex",flexDirection:"column",gap:2}}>
                          <VBadge type={e.voucherType}/>
                          <span style={{fontSize:10,color:C.muted,fontFamily:"monospace"}}>{e.voucherId}</span>
                        </div>
                      </td>
                      <td style={sh.td}>{e.narration||"—"}</td>
                      <td style={{...sh.td,textAlign:"right",fontFamily:"monospace",color:C.blue,fontWeight:600}}>{e.dr>0?fmt(e.dr):"—"}</td>
                      <td style={{...sh.td,textAlign:"right",fontFamily:"monospace",color:C.red,fontWeight:600}}>{e.cr>0?fmt(e.cr):"—"}</td>
                      <td style={{...sh.td,textAlign:"right",fontFamily:"monospace",fontWeight:700,color:e.balance>=0?C.green:C.red}}>
                        {fmt(Math.abs(e.balance))} {getBalLabel(account, e.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr style={{background:"#f5ede4"}}>
                  <td colSpan={3} style={{padding:"10px 12px",fontWeight:800}}>Closing Balance</td>
                  <td style={{padding:"10px 12px",textAlign:"right",fontFamily:"monospace",fontWeight:800,color:C.blue}}>{fmt(filteredEntries.reduce((s,e)=>s+e.dr,0))}</td>
                  <td style={{padding:"10px 12px",textAlign:"right",fontFamily:"monospace",fontWeight:800,color:C.red}}>{fmt(filteredEntries.reduce((s,e)=>s+e.cr,0))}</td>
                  <td style={{padding:"10px 12px",textAlign:"right",fontFamily:"monospace",fontWeight:800,color:computedBalance>=0?C.green:C.red}}>{fmt(Math.abs(computedBalance))} {getBalLabel(account, computedBalance)}</td>
                </tr></tfoot>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── PROFIT & LOSS ─────────────────────────────────────────────────
function ProfitLoss({ state }) {
  const [fromDate,setFromDate]=useState("");
  const [toDate,setToDate]=useState("");

  const filteredVouchers=useMemo(()=>state.vouchers.filter(v=>{
    if(fromDate&&v.date<fromDate) return false;
    if(toDate&&v.date>toDate) return false;
    return true;
  }),[state.vouchers,fromDate,toDate]);

  // Compute account balances only from filtered vouchers
  const filteredBalances=useMemo(()=>{
    const balances={};
    Object.values(state.accounts).forEach(a=>{balances[a.id]={...a,balance:0};});
    filteredVouchers.forEach(v=>{
      v.entries.forEach(e=>{
        if(!balances[e.accountId]) return;
        const acc=balances[e.accountId];
        const dr=parseFloat(e.dr||0),cr=parseFloat(e.cr||0);
        const delta=["asset","expense"].includes(acc.type)?dr-cr:cr-dr;
        balances[e.accountId]={...acc,balance:acc.balance+delta};
      });
    });
    return balances;
  },[filteredVouchers,state.accounts]);

  const incomeAccounts=Object.values(filteredBalances).filter(a=>a.type==="income"&&a.balance!==0);
  const expenseAccounts=Object.values(filteredBalances).filter(a=>a.type==="expense"&&a.balance!==0);
  const totalIncome=incomeAccounts.reduce((s,a)=>s+a.balance,0);
  const totalExpense=expenseAccounts.reduce((s,a)=>s+a.balance,0);
  const netProfit=totalIncome-totalExpense;

  const SectionRow=({label,value,indent,bold,color})=>(
    <tr>
      <td style={{padding:"8px 16px",paddingLeft:indent?32:16,color:color||(bold?C.text:C.text),fontWeight:bold?800:400,fontSize:bold?14:13}}>{label}</td>
      <td style={{padding:"8px 16px",textAlign:"right",fontFamily:"monospace",fontWeight:bold?800:600,color:color||(bold?C.text:C.muted),fontSize:bold?14:13}}>{fmt(value)}</td>
    </tr>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
        <div>
          <h2 style={{margin:0,color:C.text,fontSize:22,fontWeight:800}}>📈 Profit & Loss</h2>
          <p style={{margin:"2px 0 0",color:C.muted,fontSize:13}}>Coffee Vel International</p>
        </div>
        <div style={{display:"flex",gap:12,alignItems:"flex-end",flexWrap:"wrap"}}>
          <Field label="From Date"><input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)} style={{...sh.input,width:150}}/></Field>
          <Field label="To Date"><input type="date" value={toDate} onChange={e=>setToDate(e.target.value)} style={{...sh.input,width:150}}/></Field>
          {(fromDate||toDate)&&<Btn variant="ghost" size="sm" onClick={()=>{setFromDate("");setToDate("");}}>✕ All</Btn>}
        </div>
      </div>

      {/* Summary cards */}
      <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
        {[
          {label:"Total Income",value:totalIncome,color:C.green,icon:"📥"},
          {label:"Total Expenses",value:totalExpense,color:C.red,icon:"📤"},
          {label:netProfit>=0?"Net Profit":"Net Loss",value:Math.abs(netProfit),color:netProfit>=0?C.green:C.red,icon:netProfit>=0?"✅":"⚠️"},
        ].map(s=>(
          <div key={s.label} style={{...sh.card,flex:1,minWidth:180}}>
            <div style={{fontSize:22,marginBottom:4}}>{s.icon}</div>
            <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:0.5}}>{s.label}</div>
            <div style={{fontFamily:"monospace",fontWeight:800,fontSize:22,color:s.color,marginTop:4}}>{fmt(s.value)}</div>
          </div>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
        {/* Income */}
        <div style={{...sh.card,padding:0,overflow:"hidden"}}>
          <div style={{background:C.green,color:"#fff",padding:"12px 16px",fontWeight:800,fontSize:14}}>📥 Income</div>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <tbody>
              {incomeAccounts.length===0?(
                <tr><td colSpan={2} style={{...sh.td,textAlign:"center",color:C.muted,padding:24}}>No income entries</td></tr>
              ):incomeAccounts.map(a=>(
                <SectionRow key={a.id} label={a.name} value={a.balance} indent/>
              ))}
            </tbody>
            <tfoot><tr style={{background:"#f0fdf4"}}>
              <td style={{padding:"10px 16px",fontWeight:800,color:C.green}}>Total Income</td>
              <td style={{padding:"10px 16px",textAlign:"right",fontFamily:"monospace",fontWeight:800,color:C.green}}>{fmt(totalIncome)}</td>
            </tr></tfoot>
          </table>
        </div>

        {/* Expenses */}
        <div style={{...sh.card,padding:0,overflow:"hidden"}}>
          <div style={{background:C.red,color:"#fff",padding:"12px 16px",fontWeight:800,fontSize:14}}>📤 Expenses</div>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <tbody>
              {expenseAccounts.length===0?(
                <tr><td colSpan={2} style={{...sh.td,textAlign:"center",color:C.muted,padding:24}}>No expense entries</td></tr>
              ):expenseAccounts.map(a=>(
                <SectionRow key={a.id} label={a.name} value={a.balance} indent/>
              ))}
            </tbody>
            <tfoot><tr style={{background:"#fff1f2"}}>
              <td style={{padding:"10px 16px",fontWeight:800,color:C.red}}>Total Expenses</td>
              <td style={{padding:"10px 16px",textAlign:"right",fontFamily:"monospace",fontWeight:800,color:C.red}}>{fmt(totalExpense)}</td>
            </tr></tfoot>
          </table>
        </div>
      </div>

      {/* Net result */}
      <div style={{...sh.card,background:netProfit>=0?"#f0fdf4":"#fff1f2",border:`2px solid ${netProfit>=0?C.green:C.red}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontSize:18,fontWeight:800,color:netProfit>=0?C.green:C.red}}>{netProfit>=0?"✅ Net Profit":"⚠️ Net Loss"}</div>
            <div style={{fontSize:13,color:C.muted,marginTop:2}}>Income {fmt(totalIncome)} − Expenses {fmt(totalExpense)}</div>
          </div>
          <div style={{fontFamily:"monospace",fontWeight:800,fontSize:28,color:netProfit>=0?C.green:C.red}}>{fmt(Math.abs(netProfit))}</div>
        </div>
      </div>
    </div>
  );
}

// ── PARTIES ───────────────────────────────────────────────────────
function Parties({ state, dispatch }) {
  const [form,setForm]=useState({name:"",partyType:"supplier",phone:"",address:""});
  const [editId,setEditId]=useState(null);
  const [editForm,setEditForm]=useState(null);
  const [partyError,setPartyError]=useState("");
  const parties=Object.values(state.parties);

  const add=()=>{
    if(!form.name.trim()){ setPartyError("Enter party name"); return; } setPartyError("");
    dispatch({type:"ADD_PARTY",data:{...form,name:form.name.trim()}});
    setForm(f=>({...f,name:"",phone:"",address:""}));
  };
  const startEdit=p=>{setEditId(p.id);setEditForm({name:p.name,partyType:p.partyType,phone:p.phone||"",address:p.address||""});};
  const saveEdit=()=>{
    if(!editForm.name.trim()) return;
    dispatch({type:"EDIT_PARTY",id:editId,data:editForm});
    setEditId(null);setEditForm(null);
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <h2 style={{margin:0,color:C.text,fontSize:22,fontWeight:800}}>👥 Party Accounts</h2>
      <div style={sh.card}>
        <div style={{fontWeight:700,color:C.accent,marginBottom:12}}>Add New Party</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:12}}>
          <Field label="Party Name"><input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Planter / Trader / Buyer" style={sh.input}/></Field>
          <Field label="Type">
            <select value={form.partyType} onChange={e=>setForm(f=>({...f,partyType:e.target.value}))} style={sh.input}>
              <option value="supplier">Supplier (Planter / Trader)</option>
              <option value="customer">Customer (Buyer)</option>
            </select>
          </Field>
          <Field label="Phone"><input value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} placeholder="Optional" style={sh.input}/></Field>
          <Field label="Address"><input value={form.address} onChange={e=>setForm(f=>({...f,address:e.target.value}))} placeholder="Optional" style={sh.input}/></Field>
        </div>
        <div style={{marginTop:14,display:"flex",alignItems:"center",gap:12}}>
          <Btn onClick={add} variant="success">+ Add Party</Btn>
          {partyError&&<span style={{color:C.red,fontSize:13,fontWeight:600}}>{partyError}</span>}
        </div>
      </div>

      {editId&&editForm&&(
        <Modal title="✏ Edit Party" onClose={()=>{setEditId(null);setEditForm(null);}}>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <Field label="Party Name"><input value={editForm.name} onChange={e=>setEditForm(f=>({...f,name:e.target.value}))} style={sh.input}/></Field>
            <Field label="Type">
              <select value={editForm.partyType} onChange={e=>setEditForm(f=>({...f,partyType:e.target.value}))} style={sh.input}>
                <option value="supplier">Supplier</option><option value="customer">Customer</option>
              </select>
            </Field>
            <Field label="Phone"><input value={editForm.phone} onChange={e=>setEditForm(f=>({...f,phone:e.target.value}))} style={sh.input}/></Field>
            <Field label="Address"><input value={editForm.address} onChange={e=>setEditForm(f=>({...f,address:e.target.value}))} style={sh.input}/></Field>
            <div style={{display:"flex",gap:8,marginTop:4}}><Btn onClick={saveEdit} variant="success">✓ Save</Btn><Btn onClick={()=>{setEditId(null);setEditForm(null);}} variant="ghost">Cancel</Btn></div>
          </div>
        </Modal>
      )}

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(290px,1fr))",gap:14}}>
        {parties.length===0?(
          <div style={{...sh.card,color:C.muted,textAlign:"center",padding:40}}>No parties added yet</div>
        ):parties.map(p=>{
          const acc=state.accounts[p.id];
          const bal=acc?.balance||0;
          const txnCount=state.vouchers.filter(v=>v.entries.some(e=>e.accountId===p.id)).length;
          return(
            <div key={p.id} style={sh.card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div style={{flex:1}}>
                  <div style={{fontWeight:800,fontSize:16}}>{p.name}</div>
                  <span style={{fontSize:11,fontWeight:700,color:p.partyType==="customer"?C.blue:C.gold,textTransform:"uppercase"}}>{p.partyType}</span>
                  {p.phone&&<div style={{fontSize:12,color:C.muted,marginTop:4}}>📞 {p.phone}</div>}
                  {p.address&&<div style={{fontSize:12,color:C.muted}}>📍 {p.address}</div>}
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontFamily:"monospace",fontWeight:800,fontSize:18,color:balColor(acc||{type:"asset",balance:bal})}}>{fmt(Math.abs(bal))}</div>
                  <div style={{fontSize:11,color:C.muted}}>{bal>0?"🟢 Dr":"🔴 Cr"}</div>
                </div>
              </div>
              <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:12,color:C.muted}}>{txnCount} voucher{txnCount!==1?"s":""}</span>
                <div style={{display:"flex",gap:6}}>
                  <Btn size="sm" variant="outline" onClick={()=>startEdit(p)}>✏ Edit</Btn>
                  <Btn size="sm" variant="danger" onClick={async()=>{
                    try { await dispatch({type:"DELETE_PARTY",id:p.id}); }
                    catch(e) { setPartyError(e.message); }
                  }}>🗑</Btn>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── STOCK ITEMS MASTER ────────────────────────────────────────────
function StockView({ state, dispatch }) {
  const [newItem,setNewItem]=useState("");
  const [editName,setEditName]=useState(null);
  const [editVal,setEditVal]=useState("");
  const stockItems=state.stockItems||DEFAULT_COFFEE_ITEMS;

  const addItem=()=>{
    if(!newItem.trim()) return;
    dispatch({type:"ADD_STOCK_ITEM",name:newItem.trim()});
    setNewItem("");
  };
  const saveEdit=()=>{
    if(!editVal.trim()) return;
    dispatch({type:"EDIT_STOCK_ITEM",oldName:editName,newName:editVal.trim()});
    setEditName(null);setEditVal("");
  };

  const stockBalances = state.stock || {};
  // Combine: stock items master + coffee types from Masters + grades + actual stock
  const masterItems = [
    ...(state.coffeeTypes?.map(c=>c.name)||[]),
    "Grade AA","Grade A","Grade B","Grade C","Grade PB","Grade BBB","Bits","Coffee Rice (Bulk)",
  ];
  const allItems = new Set([
    ...masterItems,
    ...Object.keys(stockBalances).filter(k => (stockBalances[k]||0) > 0),
  ]);
  const itemsWithStock = [...allItems].sort();

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <h2 style={{margin:0,color:C.text,fontSize:22,fontWeight:800}}>☕ Stock</h2>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,alignItems:"start"}}>

        {/* Stock Register */}
        <div style={{...sh.card,padding:0,overflow:"hidden"}}>
          <div style={{background:C.accent,color:"#fff",padding:"12px 16px",fontWeight:800,fontSize:14}}>📦 Stock Register</div>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr style={{background:"#f5ede4"}}>
              <th style={sh.th}>Item / Grade</th>
              <th style={{...sh.th,textAlign:"right"}}>On Hand</th>
              <th style={{...sh.th,textAlign:"right"}}>In (GRN+Purchase)</th>
              <th style={{...sh.th,textAlign:"right"}}>Out (Sales)</th>
            </tr></thead>
            <tbody>
              {itemsWithStock.length===0?(
                <tr><td colSpan={4} style={{...sh.td,textAlign:"center",color:C.muted,padding:30}}>No stock movements yet</td></tr>
              ):itemsWithStock.map(item=>{
                const qty = stockBalances[item] || 0;
                const DRYING_OUT = {"Wet Parchment":"Parchment","Raw Cherry":"Dry Cherry","wet parchment":"Parchment","raw cherry":"Dry Cherry"};
                const hulledGrnIds = new Set((state.hullingJobs||[]).map(h=>h.grnId).filter(Boolean));
                const grnIn = (state.grns||[]).reduce((s,g)=>{
                  const dryKg  = parseFloat(g.dryKg||0);
                  const hasDry = g.hasDrying===true||g.hasDrying==="true"||g.hasDrying===1;
                  const ct     = (g.coffeeType||"").trim();
                  if (hasDry && dryKg>0) {
                    const outputType = g.outputType?.trim()||DRYING_OUT[ct]||ct;
                    // If this GRN has been hulled, don't count parchment in stock
                    if (hulledGrnIds.has(g.id)) return s;
                    if (outputType===item) return s+dryKg;
                    return s;
                  } else {
                    // If this GRN has been hulled, don't count in stock
                    if (hulledGrnIds.has(g.id)) return s;
                    if (ct===item) return s+parseFloat(g.netWeight||0);
                    return s;
                  }
                },0);
                const purIn = state.vouchers.filter(v=>(v.voucherType||v.voucher_type)==="PuV").flatMap(v=>v.items||[]).filter(it=>it.itemName===item).reduce((s,it)=>s+parseFloat(it.qty||0),0);
                const sold = state.vouchers.filter(v=>(v.voucherType||v.voucher_type)==="SV").flatMap(v=>v.items||[]).filter(it=>it.itemName===item).reduce((s,it)=>s+parseFloat(it.qty||0),0);
                const totalIn = grnIn + purIn;
                // Only show rows with actual movements
                if (totalIn===0 && sold===0 && qty===0) return null;
                return(
                  <tr key={item}>
                    <td style={{...sh.td,fontWeight:700}}>{item}</td>
                    <td style={{...sh.td,textAlign:"right",fontFamily:"monospace",fontWeight:800,color:qty>0?C.green:qty<0?C.red:C.muted}}>{fmtQ(qty)} kg</td>
                    <td style={{...sh.td,textAlign:"right",fontFamily:"monospace",color:C.blue}}>{fmtQ(totalIn)} kg</td>
                    <td style={{...sh.td,textAlign:"right",fontFamily:"monospace",color:C.red}}>{fmtQ(sold)} kg</td>
                  </tr>
                );
              }).filter(Boolean)}
            </tbody>
          </table>
        </div>

        {/* Items Master */}
        <div style={{...sh.card,padding:0,overflow:"hidden"}}>
          <div style={{background:C.accent,color:"#fff",padding:"12px 16px",fontWeight:800,fontSize:14}}>🗂 Manage Stock Items</div>
          <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",gap:8}}>
            <input value={newItem} onChange={e=>setNewItem(e.target.value)} placeholder="New item name" style={{...sh.input,flex:1}}
              onKeyDown={e=>e.key==="Enter"&&addItem()}/>
            <Btn onClick={addItem} variant="success" size="sm">+ Add</Btn>
          </div>
          <div style={{overflowY:"auto",maxHeight:400}}>
            {stockItems.map(item=>(
              <div key={item} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 16px",borderBottom:`1px solid ${C.border}`}}>
                {editName===item?(
                  <>
                    <input value={editVal} onChange={e=>setEditVal(e.target.value)} style={{...sh.input,flex:1}} autoFocus onKeyDown={e=>{if(e.key==="Enter")saveEdit();if(e.key==="Escape"){setEditName(null);setEditVal("");}}}/>
                    <Btn size="sm" variant="success" onClick={saveEdit}>✓</Btn>
                    <Btn size="sm" variant="ghost" onClick={()=>{setEditName(null);setEditVal("");}}>✕</Btn>
                  </>
                ):(
                  <>
                    <span style={{flex:1,fontSize:13,color:C.text}}>{item}</span>
                    <span style={{fontSize:11,fontFamily:"monospace",color:C.muted}}>{fmtQ(stockBalances[item]||0)} kg</span>
                    <button onClick={()=>{setEditName(item);setEditVal(item);}} style={{background:"none",border:"none",cursor:"pointer",color:C.blue,fontSize:13,fontFamily:"inherit",fontWeight:600}}>✏</button>
                    <button onClick={()=>dispatch({type:"DELETE_STOCK_ITEM",name:item})} style={{background:"none",border:"none",cursor:"pointer",color:C.red,fontSize:13}}>🗑</button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ACCOUNTS MASTER ───────────────────────────────────────────────
function AccountsMaster({ state, dispatch }) {
  const [form,setForm]=useState({name:"",group:"Expenses",type:"expense"});
  const [bankForm,setBankForm]=useState({name:"",accountNo:"",ifsc:"",branch:""});
  const [bankError,setBankError]=useState("");
  const groups=["Cash & Bank","Debtors","Creditors","Income","Expenses","Capital","Other"];
  const typeMap={"Cash & Bank":"asset",Debtors:"asset",Creditors:"liability",Income:"income",Expenses:"expense",Capital:"liability",Other:"asset"};

  const addBank=()=>{
    if(!bankForm.name.trim()){ setBankError("Enter bank account name"); return; }
    setBankError("");
    const id="bank_"+Date.now();
    dispatch({type:"ADD_ACCOUNT",data:{
      name:bankForm.name.trim(),group:"Cash & Bank",type:"asset",
      isBankAccount:true,
      accountNo:bankForm.accountNo,ifsc:bankForm.ifsc,branch:bankForm.branch,
    }});
    setBankForm({name:"",accountNo:"",ifsc:"",branch:""});
  };

  const add=()=>{
    if(!form.name.trim()) return;
    dispatch({type:"ADD_ACCOUNT",data:{...form,name:form.name.trim()}});
    setForm(f=>({...f,name:""}));
  };

  const allAccounts=Object.values(state.accounts).filter(a=>!a.isParty)
    .sort((a,b)=>(a.group||"").localeCompare(b.group||"")||a.name.localeCompare(b.name));
  const bankAccounts=allAccounts.filter(a=>a.group==="Cash & Bank");

  return(
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <h2 style={{margin:0,color:C.text,fontSize:22,fontWeight:800}}>🗂 Chart of Accounts</h2>

      {/* Bank accounts section */}
      <div style={sh.card}>
        <div style={{fontWeight:800,color:C.accent,marginBottom:14,fontSize:15}}>🏦 Add Bank Account</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:12}}>
          <Field label="Bank Account Name"><input value={bankForm.name} onChange={e=>setBankForm(f=>({...f,name:e.target.value}))} placeholder="e.g. SBI Current A/C" style={sh.input}/></Field>
          <Field label="Account Number"><input value={bankForm.accountNo} onChange={e=>setBankForm(f=>({...f,accountNo:e.target.value}))} placeholder="Optional" style={sh.input}/></Field>
          <Field label="IFSC Code"><input value={bankForm.ifsc} onChange={e=>setBankForm(f=>({...f,ifsc:e.target.value}))} placeholder="Optional" style={sh.input}/></Field>
          <Field label="Branch"><input value={bankForm.branch} onChange={e=>setBankForm(f=>({...f,branch:e.target.value}))} placeholder="Optional" style={sh.input}/></Field>
        </div>
        <div style={{marginTop:14,display:"flex",alignItems:"center",gap:12}}>
          <Btn onClick={addBank} variant="success">+ Add Bank Account</Btn>
          {bankError&&<span style={{color:C.red,fontSize:13,fontWeight:600}}>{bankError}</span>}
        </div>
      </div>

      {/* Bank accounts list */}
      {bankAccounts.length>0&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:12}}>
          {bankAccounts.map(a=>(
            <div key={a.id} style={{...sh.card,borderLeft:`4px solid ${C.blue}`}}>
              <div style={{fontSize:20,marginBottom:4}}>{a.id==="cash"?"💵":"🏦"}</div>
              <div style={{fontWeight:800,fontSize:15,color:C.text}}>{a.name}</div>
              {a.accountNo&&<div style={{fontSize:12,color:C.muted,marginTop:2}}>A/C: {a.accountNo}</div>}
              {a.ifsc&&<div style={{fontSize:12,color:C.muted}}>IFSC: {a.ifsc}</div>}
              {a.branch&&<div style={{fontSize:12,color:C.muted}}>Branch: {a.branch}</div>}
              <div style={{marginTop:8,fontFamily:"monospace",fontWeight:800,fontSize:17,color:balColor(a)}}>{fmt(Math.abs(a.balance))} {balLabel(a)}</div>
              {a.id!=="cash"&&(
                <div style={{marginTop:8}}>
                  <Btn size="sm" variant="danger" onClick={async()=>{
                    try { await dispatch({type:"DELETE_ACCOUNT",id:a.id}); }
                    catch(e) { setBankError(e.message); }
                  }}>🗑 Delete</Btn>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* General ledger account add */}
      <div style={sh.card}>
        <div style={{fontWeight:800,color:C.accent,marginBottom:12,fontSize:15}}>➕ Add Other Account</div>
        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr auto",gap:12,alignItems:"flex-end"}}>
          <Field label="Account Name"><input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Office Rent" style={sh.input}/></Field>
          <Field label="Group"><select value={form.group} onChange={e=>setForm(f=>({...f,group:e.target.value,type:typeMap[e.target.value]||"asset"}))} style={sh.input}>{groups.map(g=><option key={g} value={g}>{g}</option>)}</select></Field>
          <Field label="Type"><select value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))} style={sh.input}><option value="asset">Asset</option><option value="liability">Liability</option><option value="income">Income</option><option value="expense">Expense</option></select></Field>
          <Btn onClick={add} variant="success">+ Add</Btn>
        </div>
      </div>

      {/* Full accounts table */}
      <div style={{...sh.card,padding:0,overflow:"hidden"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr style={{background:"#f5ede4"}}>
            <th style={sh.th}>Account Name</th><th style={sh.th}>Group</th>
            <th style={sh.th}>Details</th><th style={sh.th}>Type</th>
            <th style={{...sh.th,textAlign:"right"}}>Balance</th>
          </tr></thead>
          <tbody>{allAccounts.map(a=>(
            <tr key={a.id}>
              <td style={{...sh.td,fontWeight:600}}>{a.name}</td>
              <td style={sh.td}><span style={{background:"#f0e8de",padding:"2px 8px",borderRadius:4,fontSize:11,fontWeight:700,color:C.muted}}>{a.group}</span></td>
              <td style={{...sh.td,fontSize:12,color:C.muted}}>{a.accountNo?`A/C: ${a.accountNo}`:""}{a.ifsc?` · ${a.ifsc}`:""}</td>
              <td style={{...sh.td,textTransform:"capitalize",fontSize:12,color:C.muted}}>{a.type}</td>
              <td style={{...sh.td,textAlign:"right",fontFamily:"monospace",fontWeight:700,color:balColor(a)}}>{fmt(Math.abs(a.balance))} {balLabel(a)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

// ── TRIAL BALANCE ─────────────────────────────────────────────────
function TrialBalance({ state }) {
  // Compute balances fresh from vouchers — don't rely on DB balance
  const computedBalances = useMemo(() => {
    const bal = {};
    state.vouchers.forEach(v => {
      (v.entries||[]).forEach(e => {
        if (!e.accountId) return;
        const acc = state.accounts[e.accountId];
        if (!acc) return; // account not loaded yet
        const dr = parseFloat(e.dr||0), cr = parseFloat(e.cr||0);
        const isDebitNormal = ["asset","expense"].includes(acc.type);
        const delta = isDebitNormal ? dr-cr : cr-dr;
        bal[e.accountId] = (bal[e.accountId]||0) + delta;
      });
    });
    return bal;
  }, [state.vouchers, state.accounts]);

  // Build accounts list — include ALL accounts with non-zero computed balance
  // Also include accounts that exist in state.accounts regardless (to catch any missed)
  const allAccountMap = { ...state.accounts };
  const accounts = Object.values(allAccountMap)
    .map(a => ({ ...a, computedBalance: computedBalances[a.id]||0 }))
    .filter(a => a.computedBalance !== 0)
    .sort((a,b) => (a.group||"").localeCompare(b.group||"")||a.name.localeCompare(b.name));

  const tbDrC = a => {
    // For asset/expense: positive balance = Dr
    // For liability/income/capital: negative balance = Dr (abnormal)
    const isDebitNormal = ["asset","expense"].includes(a.type);
    return isDebitNormal
      ? (a.computedBalance>0 ? a.computedBalance : 0)
      : (a.computedBalance<0 ? Math.abs(a.computedBalance) : 0);
  };
  const tbCrC = a => {
    // For liability/income/capital: positive balance = Cr
    // For asset/expense: negative balance = Cr (abnormal)
    const isDebitNormal = ["asset","expense"].includes(a.type);
    return isDebitNormal
      ? (a.computedBalance<0 ? Math.abs(a.computedBalance) : 0)
      : (a.computedBalance>0 ? a.computedBalance : 0);
  };

  const totalDr = accounts.reduce((s,a)=>s+tbDrC(a),0);
  const totalCr = accounts.reduce((s,a)=>s+tbCrC(a),0);
  const balanced = Math.abs(totalDr-totalCr)<0.01;

  return(
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
        <h2 style={{margin:0,color:C.text,fontSize:22,fontWeight:800}}>⚖️ Trial Balance</h2>
        <span style={{fontWeight:800,fontSize:13,color:balanced?C.green:C.red,background:balanced?"#dcfce7":"#fee2e2",padding:"4px 14px",borderRadius:20}}>
          {balanced?"✓ Books Balanced":"⚠ Out of Balance"}
        </span>
      </div>
      <div style={{...sh.card,padding:0,overflow:"hidden"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr style={{background:"#f5ede4"}}>
            <th style={sh.th}>Account</th>
            <th style={sh.th}>Group</th>
            <th style={{...sh.th,textAlign:"right"}}>Debit (₹)</th>
            <th style={{...sh.th,textAlign:"right"}}>Credit (₹)</th>
          </tr></thead>
          <tbody>
            {accounts.length===0?(
              <tr><td colSpan={4} style={{...sh.td,textAlign:"center",color:C.muted,padding:40}}>No transactions posted yet</td></tr>
            ):accounts.map(a=>{
              const dr=tbDrC(a), cr=tbCrC(a);
              return(
                <tr key={a.id}>
                  <td style={{...sh.td,fontWeight:600}}>{a.name}</td>
                  <td style={{...sh.td,fontSize:12,color:C.muted}}>{a.group}</td>
                  <td style={{...sh.td,textAlign:"right",fontFamily:"monospace",color:C.blue,fontWeight:600}}>{dr>0?fmt(dr):"—"}</td>
                  <td style={{...sh.td,textAlign:"right",fontFamily:"monospace",color:C.red,fontWeight:600}}>{cr>0?fmt(cr):"—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr style={{background:"#f5ede4"}}>
            <td colSpan={2} style={{padding:"10px 12px",fontWeight:800}}>TOTAL</td>
            <td style={{padding:"10px 12px",textAlign:"right",fontFamily:"monospace",fontWeight:800,color:C.blue}}>{fmt(totalDr)}</td>
            <td style={{padding:"10px 12px",textAlign:"right",fontFamily:"monospace",fontWeight:800,color:C.red}}>{fmt(totalCr)}</td>
          </tr></tfoot>
        </table>
      </div>
    </div>
  );
}

// ── USER MANAGEMENT ───────────────────────────────────────────────
function UserManagement({ state, dispatch, currentUser }) {
  const [form,setForm]=useState({username:"",password:"",name:"",role:"accountant",location:"hq",branchName:"Head Office"});
  const [editId,setEditId]=useState(null);
  const [editForm,setEditForm]=useState(null);
  const [userError,setUserError]=useState("");

  const add=()=>{
    if(!form.username.trim()||!form.password.trim()||!form.name.trim()){ setUserError("Fill all fields"); return; }
    if(state.users.find(u=>u.username===form.username.trim())){ setUserError("Username already exists"); return; }
    dispatch({type:"ADD_USER",data:{...form,username:form.username.trim(),name:form.name.trim()}});
    setForm({username:"",password:"",name:"",role:"accountant"});
  };
  const startEdit=u=>{setEditId(u.id);setEditForm({name:u.name,password:u.password,role:u.role});};
  const saveEdit=()=>{dispatch({type:"EDIT_USER",id:editId,data:editForm});setEditId(null);setEditForm(null);};
  const deleteUser=id=>{
    if(id===currentUser.id) return;
    dispatch({type:"DELETE_USER",id});
  };

  return(
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <h2 style={{margin:0,color:C.text,fontSize:22,fontWeight:800}}>👤 User Management</h2>
      <div style={sh.card}>
        <div style={{fontWeight:700,color:C.accent,marginBottom:12}}>Add New User</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:12}}>
          <Field label="Full Name"><input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Rajan Kumar" style={sh.input}/></Field>
          <Field label="Username"><input value={form.username} onChange={e=>setForm(f=>({...f,username:e.target.value}))} placeholder="e.g. rajan" style={sh.input}/></Field>
          <Field label="Password"><input type="password" value={form.password} onChange={e=>setForm(f=>({...f,password:e.target.value}))} placeholder="••••••" style={sh.input}/></Field>
          <Field label="Role">
            <select value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value,location:e.target.value==="branch"?"yercaud":"hq",branchName:e.target.value==="branch"?"Yercaud":"Head Office"}))} style={sh.input}>
              <option value="admin">Admin (Full Access)</option>
              <option value="accountant">Accountant (No Delete)</option>
              <option value="viewer">View Only</option>
              <option value="branch">Branch — Yercaud</option>
            </select>
          </Field>
          {form.role==="branch"&&(
            <Field label="Branch Name">
              <input value={form.branchName} onChange={e=>setForm(f=>({...f,branchName:e.target.value}))} placeholder="e.g. Yercaud" style={sh.input}/>
            </Field>
          )}
        </div>
        <div style={{marginTop:14,display:"flex",alignItems:"center",gap:12}}>
          <Btn onClick={add} variant="success">+ Add User</Btn>
          {userError&&<span style={{color:C.red,fontSize:13,fontWeight:600}}>{userError}</span>}
        </div>
      </div>

      {editId&&editForm&&(
        <Modal title="✏ Edit User" onClose={()=>{setEditId(null);setEditForm(null);}}>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <Field label="Full Name"><input value={editForm.name} onChange={e=>setEditForm(f=>({...f,name:e.target.value}))} style={sh.input}/></Field>
            <Field label="New Password"><input type="password" value={editForm.password} onChange={e=>setEditForm(f=>({...f,password:e.target.value}))} style={sh.input}/></Field>
            <Field label="Role">
              <select value={editForm.role} onChange={e=>setEditForm(f=>({...f,role:e.target.value}))} style={sh.input}>
                <option value="admin">Admin</option><option value="accountant">Accountant</option><option value="viewer">View Only</option><option value="branch">Branch — Yercaud</option>
              </select>
            </Field>
            <div style={{display:"flex",gap:8,marginTop:4}}><Btn onClick={saveEdit} variant="success">✓ Save</Btn><Btn onClick={()=>{setEditId(null);setEditForm(null);}} variant="ghost">Cancel</Btn></div>
          </div>
        </Modal>
      )}

      <div style={{...sh.card,padding:0,overflow:"hidden"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr style={{background:"#f5ede4"}}><th style={sh.th}>Name</th><th style={sh.th}>Username</th><th style={sh.th}>Role</th><th style={sh.th}>Actions</th></tr></thead>
          <tbody>{state.users.map(u=>(
            <tr key={u.id} style={{background:u.id===currentUser.id?"#fdf0e8":C.surface}}>
              <td style={{...sh.td,fontWeight:600}}>{u.name} {u.id===currentUser.id&&<span style={{fontSize:11,color:C.accent,fontWeight:700}}>(you)</span>}</td>
              <td style={sh.td}><span style={{fontFamily:"monospace",fontSize:12}}>{u.username}</span></td>
              <td style={sh.td}><span style={{background:u.role==="admin"?C.accent+"22":u.role==="accountant"?"#eff6ff":"#f0fdf4",color:u.role==="admin"?C.accent:u.role==="accountant"?C.blue:C.green,padding:"2px 10px",borderRadius:20,fontSize:11,fontWeight:700}}>{ROLES[u.role]?.label}</span></td>
              <td style={sh.td}>
                <div style={{display:"flex",gap:6}}>
                  <Btn size="sm" variant="outline" onClick={()=>startEdit(u)}>✏ Edit</Btn>
                  {u.id!==currentUser.id&&<Btn size="sm" variant="danger" onClick={()=>deleteUser(u.id)}>🗑</Btn>}
                </div>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

// ── OUTSTANDING REPORT ────────────────────────────────────────────
function OutstandingReport({ state }) {
  const [activeTab, setActiveTab]   = useState("suppliers");
  const [filterStatus, setFilterStatus] = useState("all");
  const [expandedId, setExpandedId] = useState(null);

  const supplierData = useMemo(() => {
    return Object.values(state.parties).filter(p=>p.partyType==="supplier").map(p=>{
      const acc=state.accounts[p.id];
      const rawBal=acc?.balance||0;
      const outstanding=rawBal>0?rawBal:0;
      const partyGRNs=state.grns.filter(g=>g.partyId===p.id&&(g.grnType==="purchase"||g.grnType==="both"));
      const purchased=state.vouchers.filter(v=>v.voucherType==="PuV"&&v.entries?.some(e=>e.accountId===p.id)).reduce((s,v)=>s+v.entries.filter(e=>e.accountId===p.id).reduce((t,e)=>t+parseFloat(e.cr||0),0),0);
      const paid=state.vouchers.filter(v=>(v.voucherType==="PV"||v.voucherType==="RV")&&v.entries?.some(e=>e.accountId===p.id&&parseFloat(e.dr||0)>0)).reduce((s,v)=>s+v.entries.filter(e=>e.accountId===p.id).reduce((t,e)=>t+parseFloat(e.dr||0),0),0);
      const unpaidGRNs=partyGRNs.filter(g=>!g.ratePending&&parseFloat(g.purchaseValue||0)>0);
      const oldestDate=unpaidGRNs.length>0?unpaidGRNs.reduce((o,g)=>g.date<o?g.date:o,unpaidGRNs[0].date):null;
      const daysOut=oldestDate?daysDiff(oldestDate):0;
      const grnBreakdown=partyGRNs.map(g=>{
        const grnPurchased=parseFloat(g.purchaseValue||0);
        const grnPaid=state.vouchers.filter(v=>v.reference===g.id&&(v.voucherType==="PV"||v.voucherType==="RV")).reduce((s,v)=>s+v.entries.filter(e=>e.accountId===p.id).reduce((t,e)=>t+parseFloat(e.dr||0),0),0);
        return {...g,grnPurchased,grnPaid,grnOutstanding:Math.max(0,grnPurchased-grnPaid),days:daysDiff(g.date)};
      });
      return {...p,outstanding,purchased,paid,daysOut,oldestDate,grnBreakdown,statusBadge:statusBadge(outstanding,purchased)};
    }).filter(p=>p.purchased>0||p.outstanding>0);
  },[state.parties,state.accounts,state.grns,state.vouchers]);

  const buyerData = useMemo(()=>{
    return Object.values(state.parties).filter(p=>p.partyType==="customer").map(p=>{
      const acc=state.accounts[p.id];
      const rawBal=acc?.balance||0;
      const outstanding=rawBal>0?rawBal:0;
      const partySales=(state.sales||[]).filter(s=>s.buyerId===p.id);
      const sold=state.vouchers.filter(v=>v.voucherType==="SV"&&v.entries?.some(e=>e.accountId===p.id)).reduce((s,v)=>s+v.entries.filter(e=>e.accountId===p.id).reduce((t,e)=>t+parseFloat(e.dr||0),0),0);
      const received=state.vouchers.filter(v=>v.voucherType==="RV"&&v.entries?.some(e=>e.accountId===p.id&&parseFloat(e.cr||0)>0)).reduce((s,v)=>s+v.entries.filter(e=>e.accountId===p.id).reduce((t,e)=>t+parseFloat(e.cr||0),0),0);
      const oldestDate=partySales.length>0?partySales.reduce((o,s)=>s.date<o?s.date:o,partySales[0].date):null;
      const daysOut=oldestDate&&outstanding>0?daysDiff(oldestDate):0;
      const saleBreakdown=partySales.map(s=>{
        const salePaid=state.vouchers.filter(v=>v.reference===s.id&&v.voucherType==="RV").reduce((t,v)=>t+v.entries.filter(e=>e.accountId===p.id).reduce((x,e)=>x+parseFloat(e.cr||0),0),0);
        return {...s,salePaid,saleOutstanding:Math.max(0,parseFloat(s.totalAmount||0)-salePaid),days:daysDiff(s.date)};
      });
      return {...p,outstanding,sold,received,daysOut,oldestDate,saleBreakdown,statusBadge:statusBadge(outstanding,sold)};
    }).filter(p=>p.sold>0||p.outstanding>0);
  },[state.parties,state.accounts,state.sales,state.vouchers]);

  const filterFn = p => {
    if(filterStatus==="unpaid")  return p.statusBadge.label==="Unpaid";
    if(filterStatus==="partial") return p.statusBadge.label==="Partial";
    if(filterStatus==="paid")    return p.statusBadge.label==="Paid";
    return true;
  };
  const filteredSuppliers=supplierData.filter(filterFn);
  const filteredBuyers=buyerData.filter(filterFn);

  const AgeChip=({days})=>{const b=ageingBucket(days);return <span style={{background:b.bg,color:b.color,padding:"2px 8px",borderRadius:12,fontSize:11,fontWeight:700}}>{b.label}</span>;};
  const StatusChip=({sb})=><span style={{background:sb.bg,color:sb.color,padding:"2px 8px",borderRadius:12,fontSize:11,fontWeight:700}}>{sb.label}</span>;

  const totalPayable    = supplierData.reduce((s,p)=>s+p.outstanding,0);
  const totalPurchased  = supplierData.reduce((s,p)=>s+p.purchased,0);
  const totalPaid       = supplierData.reduce((s,p)=>s+p.paid,0);
  const totalReceivable = buyerData.reduce((s,p)=>s+p.outstanding,0);
  const totalSold       = buyerData.reduce((s,p)=>s+p.sold,0);
  const totalReceived   = buyerData.reduce((s,p)=>s+p.received,0);

  return(
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div>
        <h2 style={{margin:0,color:C.text,fontSize:22,fontWeight:800}}>📊 Outstanding Report</h2>
        <p style={{margin:"2px 0 0",color:C.muted,fontSize:13}}>Ageing analysis · Suppliers & Buyers</p>
      </div>
      {/* Tabs */}
      <div style={{display:"flex",gap:0,borderBottom:`2px solid ${C.border}`}}>
        {[["suppliers","📤 Supplier Payables"],["buyers","📥 Buyer Receivables"]].map(([id,label])=>(
          <button key={id} onClick={()=>{setActiveTab(id);setExpandedId(null);setFilterStatus("all");}} style={{padding:"9px 20px",border:"none",borderBottom:`3px solid ${activeTab===id?C.accent:"transparent"}`,background:"transparent",color:activeTab===id?C.accent:C.muted,fontWeight:activeTab===id?700:500,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>{label}</button>
        ))}
      </div>
      {/* Summary Cards */}
      {activeTab==="suppliers"?(
        <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
          {[{icon:"📤",label:"Total Payable",value:fmt(totalPayable),color:C.red},{icon:"🛒",label:"Total Purchased",value:fmt(totalPurchased),color:C.text},{icon:"✅",label:"Total Paid",value:fmt(totalPaid),color:C.green},{icon:"⚠️",label:"Unpaid Suppliers",value:supplierData.filter(p=>p.statusBadge.label!=="Paid").length,color:C.red}].map(s=>(
            <div key={s.label} style={{...sh.card,flex:1,minWidth:150}}>
              <div style={{fontSize:18,marginBottom:4}}>{s.icon}</div>
              <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase"}}>{s.label}</div>
              <div style={{fontFamily:"monospace",fontWeight:800,fontSize:18,color:s.color,marginTop:4}}>{s.value}</div>
            </div>
          ))}
        </div>
      ):(
        <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
          {[{icon:"📥",label:"Total Receivable",value:fmt(totalReceivable),color:C.blue},{icon:"🏷",label:"Total Sold",value:fmt(totalSold),color:C.text},{icon:"✅",label:"Total Received",value:fmt(totalReceived),color:C.green},{icon:"⚠️",label:"Unpaid Buyers",value:buyerData.filter(p=>p.statusBadge.label!=="Paid").length,color:C.red}].map(s=>(
            <div key={s.label} style={{...sh.card,flex:1,minWidth:150}}>
              <div style={{fontSize:18,marginBottom:4}}>{s.icon}</div>
              <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase"}}>{s.label}</div>
              <div style={{fontFamily:"monospace",fontWeight:800,fontSize:18,color:s.color,marginTop:4}}>{s.value}</div>
            </div>
          ))}
        </div>
      )}
      {/* Filter */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
        <span style={{fontSize:12,color:C.muted,fontWeight:700}}>Filter:</span>
        {[["all","All"],["unpaid","Unpaid"],["partial","Partial"],["paid","Paid"]].map(([v,l])=>(
          <button key={v} onClick={()=>setFilterStatus(v)} style={{padding:"4px 14px",borderRadius:20,border:`1px solid ${filterStatus===v?C.accent:C.border}`,background:filterStatus===v?C.accent:"transparent",color:filterStatus===v?"#fff":C.muted,fontWeight:600,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>{l}</button>
        ))}
        <span style={{marginLeft:"auto",fontSize:12,color:C.muted}}>{activeTab==="suppliers"?filteredSuppliers.length:filteredBuyers.length} parties</span>
      </div>
      {/* Supplier Table */}
      {activeTab==="suppliers"&&(
        <div style={{...sh.card,padding:0,overflow:"hidden"}}>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",minWidth:700}}>
              <thead><tr style={{background:"#f5ede4"}}>
                <th style={sh.th}>Supplier</th><th style={{...sh.th,textAlign:"right"}}>Purchased</th><th style={{...sh.th,textAlign:"right"}}>Paid</th><th style={{...sh.th,textAlign:"right"}}>Outstanding</th><th style={sh.th}>Status</th><th style={sh.th}>Ageing</th><th style={sh.th}>GRNs</th>
              </tr></thead>
              <tbody>
                {filteredSuppliers.length===0?<tr><td colSpan={7} style={{...sh.td,textAlign:"center",color:C.muted,padding:32}}>No records found</td></tr>
                :filteredSuppliers.sort((a,b)=>b.outstanding-a.outstanding).map(p=>(
                  <React.Fragment key={p.id}>
                    <tr onClick={()=>setExpandedId(expandedId===p.id?null:p.id)} style={{cursor:"pointer",background:expandedId===p.id?"#fdf0e8":C.surface}}>
                      <td style={{...sh.td,fontWeight:700}}>{p.name}{p.phone&&<div style={{fontSize:11,color:C.muted,fontWeight:400}}>📞 {p.phone}</div>}</td>
                      <td style={{...sh.td,textAlign:"right",fontFamily:"monospace"}}>{fmt(p.purchased)}</td>
                      <td style={{...sh.td,textAlign:"right",fontFamily:"monospace",color:C.green}}>{fmt(p.paid)}</td>
                      <td style={{...sh.td,textAlign:"right",fontFamily:"monospace",fontWeight:800,color:p.outstanding>0?C.red:C.green}}>{fmt(p.outstanding)}</td>
                      <td style={sh.td}><StatusChip sb={p.statusBadge}/></td>
                      <td style={sh.td}>{p.outstanding>0&&p.daysOut>0?<AgeChip days={p.daysOut}/>:<span style={{color:C.muted,fontSize:12}}>—</span>}</td>
                      <td style={{...sh.td,color:C.muted,fontSize:12}}>{p.grnBreakdown.length} GRNs {expandedId===p.id?"▲":"▼"}</td>
                    </tr>
                    {expandedId===p.id&&(
                      <tr><td colSpan={7} style={{padding:0,background:"#fdf8f4"}}>
                        <div style={{padding:"12px 20px"}}>
                          <div style={{fontSize:11,fontWeight:800,color:C.accent,textTransform:"uppercase",marginBottom:8}}>GRN Breakdown — {p.name}</div>
                          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                            <thead><tr style={{background:"#f5ede4"}}>
                              <th style={{...sh.th,fontSize:11}}>GRN</th><th style={{...sh.th,fontSize:11}}>Date</th><th style={{...sh.th,fontSize:11}}>Type</th><th style={{...sh.th,fontSize:11,textAlign:"right"}}>Value</th><th style={{...sh.th,fontSize:11,textAlign:"right"}}>Paid</th><th style={{...sh.th,fontSize:11,textAlign:"right"}}>Outstanding</th><th style={{...sh.th,fontSize:11}}>Ageing</th>
                            </tr></thead>
                            <tbody>
                              {p.grnBreakdown.map(g=>(
                                <tr key={g.id} style={{borderBottom:`1px solid ${C.border}`}}>
                                  <td style={{padding:"6px 12px",fontFamily:"monospace",fontWeight:700,color:C.accent}}>{g.id}</td>
                                  <td style={{padding:"6px 12px",color:C.muted}}>{g.date}</td>
                                  <td style={{padding:"6px 12px"}}>{g.coffeeType}</td>
                                  <td style={{padding:"6px 12px",textAlign:"right",fontFamily:"monospace"}}>{g.ratePending?<span style={{color:"#92400e",fontSize:11}}>Rate Pending</span>:fmt(g.grnPurchased)}</td>
                                  <td style={{padding:"6px 12px",textAlign:"right",fontFamily:"monospace",color:C.green}}>{fmt(g.grnPaid)}</td>
                                  <td style={{padding:"6px 12px",textAlign:"right",fontFamily:"monospace",fontWeight:700,color:g.grnOutstanding>0?C.red:C.green}}>{fmt(g.grnOutstanding)}</td>
                                  <td style={{padding:"6px 12px"}}>{g.grnOutstanding>0?<AgeChip days={g.days}/>:<span style={{color:C.green,fontSize:11}}>✓ Paid</span>}</td>
                                </tr>
                              ))}
                              {p.grnBreakdown.length===0&&<tr><td colSpan={7} style={{padding:"12px",color:C.muted,textAlign:"center"}}>No GRNs</td></tr>}
                            </tbody>
                          </table>
                        </div>
                      </td></tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
              <tfoot><tr style={{background:"#f5ede4"}}>
                <td style={{padding:"10px 12px",fontWeight:800}}>TOTAL</td>
                <td style={{padding:"10px 12px",textAlign:"right",fontFamily:"monospace",fontWeight:800}}>{fmt(filteredSuppliers.reduce((s,p)=>s+p.purchased,0))}</td>
                <td style={{padding:"10px 12px",textAlign:"right",fontFamily:"monospace",fontWeight:800,color:C.green}}>{fmt(filteredSuppliers.reduce((s,p)=>s+p.paid,0))}</td>
                <td style={{padding:"10px 12px",textAlign:"right",fontFamily:"monospace",fontWeight:800,color:C.red}}>{fmt(filteredSuppliers.reduce((s,p)=>s+p.outstanding,0))}</td>
                <td colSpan={3}></td>
              </tr></tfoot>
            </table>
          </div>
        </div>
      )}
      {/* Buyer Table */}
      {activeTab==="buyers"&&(
        <div style={{...sh.card,padding:0,overflow:"hidden"}}>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",minWidth:700}}>
              <thead><tr style={{background:"#f5ede4"}}>
                <th style={sh.th}>Buyer</th><th style={{...sh.th,textAlign:"right"}}>Total Sales</th><th style={{...sh.th,textAlign:"right"}}>Received</th><th style={{...sh.th,textAlign:"right"}}>Outstanding</th><th style={sh.th}>Status</th><th style={sh.th}>Ageing</th><th style={sh.th}>Sales</th>
              </tr></thead>
              <tbody>
                {filteredBuyers.length===0?<tr><td colSpan={7} style={{...sh.td,textAlign:"center",color:C.muted,padding:32}}>No records found</td></tr>
                :filteredBuyers.sort((a,b)=>b.outstanding-a.outstanding).map(p=>(
                  <React.Fragment key={p.id}>
                    <tr onClick={()=>setExpandedId(expandedId===p.id?null:p.id)} style={{cursor:"pointer",background:expandedId===p.id?"#eff6ff":C.surface}}>
                      <td style={{...sh.td,fontWeight:700}}>{p.name}{p.phone&&<div style={{fontSize:11,color:C.muted,fontWeight:400}}>📞 {p.phone}</div>}</td>
                      <td style={{...sh.td,textAlign:"right",fontFamily:"monospace"}}>{fmt(p.sold)}</td>
                      <td style={{...sh.td,textAlign:"right",fontFamily:"monospace",color:C.green}}>{fmt(p.received)}</td>
                      <td style={{...sh.td,textAlign:"right",fontFamily:"monospace",fontWeight:800,color:p.outstanding>0?C.blue:C.green}}>{fmt(p.outstanding)}</td>
                      <td style={sh.td}><StatusChip sb={p.statusBadge}/></td>
                      <td style={sh.td}>{p.outstanding>0&&p.daysOut>0?<AgeChip days={p.daysOut}/>:<span style={{color:C.muted,fontSize:12}}>—</span>}</td>
                      <td style={{...sh.td,color:C.muted,fontSize:12}}>{p.saleBreakdown.length} sales {expandedId===p.id?"▲":"▼"}</td>
                    </tr>
                    {expandedId===p.id&&(
                      <tr><td colSpan={7} style={{padding:0,background:"#eff6ff22"}}>
                        <div style={{padding:"12px 20px"}}>
                          <div style={{fontSize:11,fontWeight:800,color:C.blue,textTransform:"uppercase",marginBottom:8}}>Sale Breakdown — {p.name}</div>
                          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                            <thead><tr style={{background:"#eff6ff"}}>
                              <th style={{...sh.th,fontSize:11}}>Sale ID</th><th style={{...sh.th,fontSize:11}}>Date</th><th style={{...sh.th,fontSize:11,textAlign:"right"}}>Amount</th><th style={{...sh.th,fontSize:11,textAlign:"right"}}>Received</th><th style={{...sh.th,fontSize:11,textAlign:"right"}}>Outstanding</th><th style={{...sh.th,fontSize:11}}>Ageing</th>
                            </tr></thead>
                            <tbody>
                              {p.saleBreakdown.map(s=>(
                                <tr key={s.id} style={{borderBottom:`1px solid ${C.border}`}}>
                                  <td style={{padding:"6px 12px",fontFamily:"monospace",fontWeight:700,color:C.blue}}>{s.id}</td>
                                  <td style={{padding:"6px 12px",color:C.muted}}>{s.date}</td>
                                  <td style={{padding:"6px 12px",textAlign:"right",fontFamily:"monospace"}}>{fmt(s.totalAmount)}</td>
                                  <td style={{padding:"6px 12px",textAlign:"right",fontFamily:"monospace",color:C.green}}>{fmt(s.salePaid)}</td>
                                  <td style={{padding:"6px 12px",textAlign:"right",fontFamily:"monospace",fontWeight:700,color:s.saleOutstanding>0?C.blue:C.green}}>{fmt(s.saleOutstanding)}</td>
                                  <td style={{padding:"6px 12px"}}>{s.saleOutstanding>0?<AgeChip days={s.days}/>:<span style={{color:C.green,fontSize:11}}>✓ Paid</span>}</td>
                                </tr>
                              ))}
                              {p.saleBreakdown.length===0&&<tr><td colSpan={6} style={{padding:"12px",color:C.muted,textAlign:"center"}}>No sales</td></tr>}
                            </tbody>
                          </table>
                        </div>
                      </td></tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
              <tfoot><tr style={{background:"#f5ede4"}}>
                <td style={{padding:"10px 12px",fontWeight:800}}>TOTAL</td>
                <td style={{padding:"10px 12px",textAlign:"right",fontFamily:"monospace",fontWeight:800}}>{fmt(filteredBuyers.reduce((s,p)=>s+p.sold,0))}</td>
                <td style={{padding:"10px 12px",textAlign:"right",fontFamily:"monospace",fontWeight:800,color:C.green}}>{fmt(filteredBuyers.reduce((s,p)=>s+p.received,0))}</td>
                <td style={{padding:"10px 12px",textAlign:"right",fontFamily:"monospace",fontWeight:800,color:C.blue}}>{fmt(filteredBuyers.reduce((s,p)=>s+p.outstanding,0))}</td>
                <td colSpan={3}></td>
              </tr></tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── DASHBOARD ─────────────────────────────────────────────────────
// ── HELPERS: AGEING ──────────────────────────────────────────────
const daysDiff = (dateStr) => {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  const now = new Date();
  return Math.floor((now - d) / (1000 * 60 * 60 * 24));
};
const ageingBucket = (days) => {
  if (days <= 30)  return { label:"0–30 days",  color:"#15803d", bg:"#dcfce7" };
  if (days <= 60)  return { label:"31–60 days", color:"#92400e", bg:"#fef3c7" };
  if (days <= 90)  return { label:"61–90 days", color:"#c2410c", bg:"#ffedd5" };
  return             { label:"90+ days",   color:"#b91c1c", bg:"#fee2e2" };
};
const statusBadge = (outstanding, purchased) => {
  if (outstanding <= 0)                           return { label:"Paid",    color:"#15803d", bg:"#dcfce7" };
  if (outstanding < purchased && outstanding > 0) return { label:"Partial", color:"#92400e", bg:"#fef3c7" };
  return                                                 { label:"Unpaid",  color:"#b91c1c", bg:"#fee2e2" };
};

function Dashboard({ state, setTab }) {
  const cash=state.accounts["cash"]?.balance||0;
  const bankAccounts=Object.values(state.accounts).filter(a=>a.group==="Cash & Bank"&&a.id!=="cash");
  const totalBank=bankAccounts.reduce((s,a)=>s+a.balance,0);
  const parties=Object.values(state.parties);
  const todayVouchers=state.vouchers.filter(v=>v.date===today());
  const stockItems=Object.entries(state.stock||{}).filter(([,q])=>q>0);
  const incomeAccs=Object.values(state.accounts).filter(a=>a.type==="income");
  const expenseAccs=Object.values(state.accounts).filter(a=>a.type==="expense");
  const totalIncome=incomeAccs.reduce((s,a)=>s+a.balance,0);
  const totalExpense=expenseAccs.reduce((s,a)=>s+a.balance,0);
  const netProfit=totalIncome-totalExpense;

  // Pending alerts
  const ratePending   = state.grns.filter(g=>g.ratePending&&(g.grnType==="purchase"||g.grnType==="both")).length;
  const dryingPending = state.grns.filter(g=>(g.hasDrying===true||g.hasDrying==="true")&&!g.dryKg).length;
  const qcPending     = state.grns.filter(g=>needsQualityForGRN(g)&&!g.qualityReport).length;

  // Supplier payables
  const topPayables = useMemo(()=>
    Object.values(state.parties).filter(p=>p.partyType==="supplier").map(p=>{
      const bal=state.accounts[p.id]?.balance||0;
      const outstanding = bal>0?bal:0;
      const oldestGRN = state.grns.filter(g=>g.partyId===p.id&&!g.ratePending&&parseFloat(g.purchaseValue||0)>0).sort((a,b)=>a.date.localeCompare(b.date))[0];
      return {...p, outstanding, days:oldestGRN?daysDiff(oldestGRN.date):0};
    }).filter(p=>p.outstanding>0).sort((a,b)=>b.outstanding-a.outstanding).slice(0,5)
  ,[state.parties,state.accounts,state.grns]);

  // Buyer receivables
  const topReceivables = useMemo(()=>
    Object.values(state.parties).filter(p=>p.partyType==="customer").map(p=>{
      const bal=state.accounts[p.id]?.balance||0;
      const outstanding = bal>0?bal:0;
      const oldestSale=(state.sales||[]).filter(s=>s.buyerId===p.id).sort((a,b)=>a.date.localeCompare(b.date))[0];
      return {...p, outstanding, days:oldestSale&&outstanding>0?daysDiff(oldestSale.date):0};
    }).filter(p=>p.outstanding>0).sort((a,b)=>b.outstanding-a.outstanding).slice(0,5)
  ,[state.parties,state.accounts,state.sales]);

  // Monthly trend
  const monthlyTrend = useMemo(()=>{
    const months=[];
    const now=new Date();
    for(let i=5;i>=0;i--){
      const d=new Date(now.getFullYear(),now.getMonth()-i,1);
      const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      const label=d.toLocaleString("en-IN",{month:"short",year:"2-digit"});
      const purchased=state.vouchers.filter(v=>v.voucherType==="PuV"&&(v.date||"").startsWith(key)).reduce((s,v)=>s+v.entries.filter(e=>e.accountId==="purchases").reduce((t,e)=>t+parseFloat(e.dr||0),0),0);
      const sales=state.vouchers.filter(v=>v.voucherType==="SV"&&(v.date||"").startsWith(key)).reduce((s,v)=>s+v.entries.filter(e=>e.accountId==="sales").reduce((t,e)=>t+parseFloat(e.cr||0),0),0);
      months.push({key,label,purchased,sales});
    }
    return months;
  },[state.vouchers]);
  const maxVal=Math.max(...monthlyTrend.map(m=>Math.max(m.purchased,m.sales)),1);
  const thisMonth=new Date().toISOString().slice(0,7);
  const grnsThisMonth=state.grns.filter(g=>(g.date||"").startsWith(thisMonth)).length;
  const salesThisMonth=(state.sales||[]).filter(s=>(s.date||"").startsWith(thisMonth)).length;

  const totalPayable=Object.values(state.parties).filter(p=>p.partyType==="supplier").reduce((s,p)=>{const b=state.accounts[p.id]?.balance||0;return b>0?s+b:s;},0);
  const totalReceivable=Object.values(state.parties).filter(p=>p.partyType==="customer").reduce((s,p)=>{const b=state.accounts[p.id]?.balance||0;return b>0?s+b:s;},0);

  const Stat=({icon,label,value,color,sub})=>(
    <div style={{...sh.card,flex:1,minWidth:140}}>
      <div style={{fontSize:20,marginBottom:4}}>{icon}</div>
      <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:0.5}}>{label}</div>
      <div style={{fontFamily:"monospace",fontWeight:800,fontSize:18,color:color||C.text,marginTop:4}}>{value}</div>
      {sub&&<div style={{fontSize:11,color:C.muted,marginTop:2}}>{sub}</div>}
    </div>
  );

  return(
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8}}>
        <div>
          <h2 style={{margin:0,color:C.text,fontSize:24,fontWeight:800}}>☕ Coffee Vel International</h2>
          <p style={{margin:"3px 0 0",color:C.muted,fontSize:13}}>Pattiveeranpatti · {today()}</p>
        </div>
        <div style={{fontSize:12,color:C.muted}}>This month: <strong style={{color:C.text}}>{grnsThisMonth} GRNs</strong> · <strong style={{color:C.text}}>{salesThisMonth} Sales</strong></div>
      </div>
      {/* Alerts */}
      {(ratePending>0||dryingPending>0||qcPending>0)&&(
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          {ratePending>0&&<div onClick={()=>setTab&&setTab("grn")} style={{...sh.card,flex:1,minWidth:160,cursor:"pointer",borderLeft:`4px solid ${C.red}`,padding:"12px 16px"}}>
            <div style={{fontSize:11,fontWeight:700,color:C.red,textTransform:"uppercase"}}>⚠️ Rate Pending</div>
            <div style={{fontFamily:"monospace",fontWeight:800,fontSize:22,color:C.red}}>{ratePending}</div>
            <div style={{fontSize:11,color:C.muted}}>GRNs awaiting rate confirmation</div>
          </div>}
          {dryingPending>0&&<div onClick={()=>setTab&&setTab("grn")} style={{...sh.card,flex:1,minWidth:160,cursor:"pointer",borderLeft:"4px solid #f97316",padding:"12px 16px"}}>
            <div style={{fontSize:11,fontWeight:700,color:"#c2410c",textTransform:"uppercase"}}>⏳ Drying Pending</div>
            <div style={{fontFamily:"monospace",fontWeight:800,fontSize:22,color:"#c2410c"}}>{dryingPending}</div>
            <div style={{fontSize:11,color:C.muted}}>GRNs awaiting dry weight</div>
          </div>}
          {qcPending>0&&<div onClick={()=>setTab&&setTab("grn")} style={{...sh.card,flex:1,minWidth:160,cursor:"pointer",borderLeft:"4px solid #92400e",padding:"12px 16px"}}>
            <div style={{fontSize:11,fontWeight:700,color:"#92400e",textTransform:"uppercase"}}>🔬 QC Pending</div>
            <div style={{fontFamily:"monospace",fontWeight:800,fontSize:22,color:"#92400e"}}>{qcPending}</div>
            <div style={{fontSize:11,color:C.muted}}>GRNs awaiting quality report</div>
          </div>}
        </div>
      )}
      <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
        <Stat icon="💵" label="Cash in Hand"  value={fmt(cash)}            color={cash>=0?C.green:C.red}/>
        <Stat icon="🏦" label="Bank Balance"  value={fmt(totalBank)}       color={totalBank>=0?C.green:C.red} sub={bankAccounts.length>1?`${bankAccounts.length} accounts`:bankAccounts[0]?.name||"No bank added"}/>
        <Stat icon="📤" label="Payable"       value={fmt(totalPayable)}    color={C.red}  sub="We owe suppliers"/>
        <Stat icon="📥" label="Receivable"    value={fmt(totalReceivable)} color={C.blue} sub="Customers owe us"/>
        <Stat icon={netProfit>=0?"✅":"⚠️"} label={netProfit>=0?"Net Profit":"Net Loss"} value={fmt(Math.abs(netProfit))} color={netProfit>=0?C.green:C.red}/>
        <Stat icon="📓" label="Vouchers"      value={state.vouchers.length} sub={`${todayVouchers.length} today`}/>
      </div>
      {bankAccounts.length>0&&(
        <div style={sh.card}>
          <div style={{fontWeight:800,marginBottom:10}}>🏦 Bank Accounts</div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            {bankAccounts.map(a=>(
              <div key={a.id} style={{background:C.cream,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 16px",minWidth:180}}>
                <div style={{fontSize:12,fontWeight:700,color:C.muted}}>{a.name}</div>
                {a.accountNo&&<div style={{fontSize:11,color:C.muted}}>A/C: {a.accountNo}</div>}
                <div style={{fontFamily:"monospace",fontWeight:800,fontSize:16,color:balColor(a),marginTop:4}}>{fmt(Math.abs(a.balance))} {balLabel(a)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Monthly Trend Chart */}
      <div style={sh.card}>
        <div style={{fontWeight:800,marginBottom:14}}>📈 Monthly Trend (Last 6 Months)</div>
        <div style={{display:"flex",gap:4,alignItems:"flex-end",height:120}}>
          {monthlyTrend.map(m=>(
            <div key={m.key} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
              <div style={{width:"100%",display:"flex",gap:2,alignItems:"flex-end",height:90}}>
                <div title={`Purchases: ${fmt(m.purchased)}`} style={{flex:1,background:C.red+"88",borderRadius:"3px 3px 0 0",height:`${Math.max(2,(m.purchased/maxVal)*90)}px`}}/>
                <div title={`Sales: ${fmt(m.sales)}`}         style={{flex:1,background:C.green+"88",borderRadius:"3px 3px 0 0",height:`${Math.max(2,(m.sales/maxVal)*90)}px`}}/>
              </div>
              <div style={{fontSize:10,color:C.muted,textAlign:"center",whiteSpace:"nowrap"}}>{m.label}</div>
            </div>
          ))}
        </div>
        <div style={{display:"flex",gap:16,marginTop:8}}>
          <span style={{fontSize:11,color:C.muted,display:"flex",alignItems:"center",gap:4}}><span style={{width:10,height:10,background:C.red+"88",borderRadius:2,display:"inline-block"}}></span>Purchases</span>
          <span style={{fontSize:11,color:C.muted,display:"flex",alignItems:"center",gap:4}}><span style={{width:10,height:10,background:C.green+"88",borderRadius:2,display:"inline-block"}}></span>Sales</span>
        </div>
      </div>
      {/* Top Payables & Receivables */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <div style={{...sh.card,padding:0,overflow:"hidden"}}>
          <div style={{background:"#fee2e2",padding:"10px 16px",fontWeight:800,fontSize:13,color:C.red,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>📤 Top Payables</span>
            {setTab&&<button onClick={()=>setTab("outstanding")} style={{background:"none",border:`1px solid ${C.red}`,color:C.red,borderRadius:6,padding:"2px 10px",fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:700}}>View All</button>}
          </div>
          {topPayables.length===0?<div style={{padding:20,textAlign:"center",color:C.muted,fontSize:13}}>No pending payables</div>
          :topPayables.map(p=>(
            <div key={p.id} style={{padding:"10px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontWeight:700,fontSize:13}}>{p.name}</div>
                {p.days>0&&<span style={{fontSize:10,...ageingBucket(p.days),padding:"1px 6px",borderRadius:8,fontWeight:700}}>{ageingBucket(p.days).label}</span>}
              </div>
              <div style={{fontFamily:"monospace",fontWeight:800,color:C.red,fontSize:14}}>{fmt(p.outstanding)}</div>
            </div>
          ))}
        </div>
        <div style={{...sh.card,padding:0,overflow:"hidden"}}>
          <div style={{background:"#eff6ff",padding:"10px 16px",fontWeight:800,fontSize:13,color:C.blue,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>📥 Top Receivables</span>
            {setTab&&<button onClick={()=>setTab("outstanding")} style={{background:"none",border:`1px solid ${C.blue}`,color:C.blue,borderRadius:6,padding:"2px 10px",fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:700}}>View All</button>}
          </div>
          {topReceivables.length===0?<div style={{padding:20,textAlign:"center",color:C.muted,fontSize:13}}>No pending receivables</div>
          :topReceivables.map(p=>(
            <div key={p.id} style={{padding:"10px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontWeight:700,fontSize:13}}>{p.name}</div>
                {p.days>0&&<span style={{fontSize:10,...ageingBucket(p.days),padding:"1px 6px",borderRadius:8,fontWeight:700}}>{ageingBucket(p.days).label}</span>}
              </div>
              <div style={{fontFamily:"monospace",fontWeight:800,color:C.blue,fontSize:14}}>{fmt(p.outstanding)}</div>
            </div>
          ))}
        </div>
      </div>
      {stockItems.length>0&&(
        <div style={sh.card}>
          <div style={{fontWeight:800,marginBottom:10}}>☕ Stock on Hand</div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            {stockItems.map(([item,qty])=>(
              <div key={item} style={{background:C.cream,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 14px"}}>
                <div style={{fontSize:12,fontWeight:700,color:C.accent}}>{item}</div>
                <div style={{fontFamily:"monospace",fontWeight:800,color:C.green}}>{fmtQ(qty)} kg</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {todayVouchers.length>0&&(
        <div style={sh.card}>
          <div style={{fontWeight:800,marginBottom:10}}>📅 Today's Entries</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {todayVouchers.map(v=>{
              const amt=v.entries.reduce((s,e)=>s+parseFloat(e.dr||0),0);
              return(<div key={v.id} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 10px",background:C.cream,borderRadius:8,flexWrap:"wrap"}}>
                <VBadge type={v.voucherType}/>
                <span style={{fontSize:12,color:C.muted,minWidth:90}}>{v.id}</span>
                <span style={{flex:1,fontSize:13}}>{v.narration||"—"}</span>
                <span style={{fontFamily:"monospace",fontWeight:700,color:C.accent}}>{fmt(amt)}</span>
              </div>);
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── LOGIN ─────────────────────────────────────────────────────────
function LoginForm({ onLogin, loading, error }) {
  const [username,setUsername]=useState("");
  const [password,setPassword]=useState("");

  const login=()=>onLogin(username,password);

  return(
      <div style={{background:C.surface,borderRadius:16,padding:"40px 36px",width:"100%",maxWidth:380,boxShadow:"0 20px 60px #00000044"}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{fontSize:48,marginBottom:8}}>☕</div>
          <div style={{fontSize:22,fontWeight:800,color:C.accent}}>Coffee Vel International</div>
          <div style={{fontSize:12,color:C.muted,marginTop:4,letterSpacing:1,textTransform:"uppercase"}}>Accounting System</div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <Field label="Username">
            <input value={username} onChange={e=>setUsername(e.target.value)} placeholder="Enter username" style={sh.input} onKeyDown={e=>e.key==="Enter"&&login()} autoFocus/>
          </Field>
          <Field label="Password">
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Enter password" style={sh.input} onKeyDown={e=>e.key==="Enter"&&login()}/>
          </Field>
          {error&&<div style={{color:C.red,fontSize:13,fontWeight:600,textAlign:"center",background:"#fee2e2",padding:"8px",borderRadius:6}}>{error}</div>}
          <Btn onClick={login} variant="primary" size="lg" disabled={loading}>{loading?"Signing in…":"Sign In →"}</Btn>
        </div>
      </div>
  );
}

// ── GRN MODULE ────────────────────────────────────────────────────
const COFFEE_TYPES_GRN = [
  "AP Raw","Wet Parchment","Parchment","Dry Cherry","Cherry",
  "Clean Coffee","AB Raw","PB Raw","Robusta",
];
const LOCATIONS = ["Pattiveeranpatti","Yercaud"];
const WAREHOUSES = ["Own Yard","Mechanical Dryer","LDC Kushalnagar","LDC Koppa","Other"];

// ── COFFEE TYPE HELPERS ───────────────────────────────────────────

// unit/paka display helper
const fmtUnits = (units, paka) => {
  const u = parseInt(units||0), p = parseInt(paka||0);
  if (!u && !p) return "—";
  if (!p) return `${u} units`;
  return `${u} units ${p} paka`;
};

// ── GRN FORM ──────────────────────────────────────────────────────
// ── GRN CONSTANTS ─────────────────────────────────────────────────
const GRN_COFFEE_TYPES = [
  "Wet Parchment",
  "Raw Cherry",
  "Parchment",
  "Dry Cherry",
  "Others",
];
const UNIT_MEASURE_TYPES = ["Wet Parchment","Raw Cherry"]; // can be kg or units+paka
const DRYING_TYPES       = ["Wet Parchment","Raw Cherry"]; // drying enabled
const QUALITY_TYPES      = ["Parchment","Dry Cherry","Others"]; // quality report required
const OUTPUT_MAP         = { "Wet Parchment":"Parchment", "Raw Cherry":"Dry Cherry" };

const isUnitType  = ct => UNIT_MEASURE_TYPES.includes(ct);
const needsDrying = ct => DRYING_TYPES.includes(ct);
const needsQuality = ct => QUALITY_TYPES.includes(ct);
const needsQualityForGRN = (g) => {
  if (QUALITY_TYPES.includes(g.coffeeType)) return true;
  if ((g.hasDrying===true||g.hasDrying==="true") && parseFloat(g.dryKg||0)>0) return true;
  return false;
};

// ── GRN FORM ──────────────────────────────────────────────────────
function GRNForm({ state, dispatch, onDone, initial, editId }) {
  const locationsList  = state.locations?.length  ? state.locations.map(l=>l.name)  : ["Pattiveeranpatti","Yercaud"];
  const warehousesList = state.warehouses?.length ? state.warehouses.map(w=>w.name) : ["Own Yard","Mechanical Dryer"];
  const suppliers      = Object.values(state.parties).filter(p=>p.partyType==="supplier");

  const blank = {
    date:today(), partyId:"", coffeeType:"Wet Parchment",
    totalBags:"",                  // MANDATORY
    bagType:"PP Bags",
    // unit measure (wet parchment / raw cherry only)
    inputMode:"kg",                // "kg" | "unit"
    noOfUnits:"", noOfPaka:"",
    // weight bridge
    firstWeight:"", secondWeight:"", rejectedBags:"",
    // location
    location:locationsList[0]||"Pattiveeranpatti",
    warehouse:warehousesList[0]||"Own Yard",
    warehouseZone:"", stockNo:"", truckNo:"", cropSeason:"25/26",
    remarks:"", narration:"",
    // grn type
    grnType:"purchase",            // "purchase" | "storage" | "both"
    // drying (wet parchment / raw cherry only)
    hasDrying:false,
    dryingMethod:"Yard",
    dryKg:"",
    priceBasis:"wet",              // "wet"=price on wet, "dry"=price on dry
    dryingRate:"", dryingCharge:"",
    // purchase rate
    rateType:"per_kg",             // "per_kg" | "per_paka"
    rate:"", ratePending:false,
    // split: purchase + storage portions
    purchaseQtyKg:"", storageQtyKg:"",
  };

  const [form, setForm] = useState(() => {
    if (!initial) return blank;
    return { ...blank, ...initial,
      totalBags:    initial.totalBags    || initial.noOfBags || "",
      inputMode:    initial.inputMode    || "kg",
      noOfUnits:    initial.noOfUnits    || "",
      noOfPaka:     initial.noOfPaka     || "",
      hasDrying:    initial.hasDrying    || false,
      priceBasis:   initial.priceBasis   || "wet",
      grnType:      initial.grnType      || "purchase",
    };
  });
  const [err, setErr] = useState("");

  const set = (f, v) => setForm(p => {
    const next = { ...p, [f]: v };
    // Auto-set dryingMethod based on warehouse
    if (f==="warehouse" && v==="Mechanical Dryer") next.dryingMethod = "Mechanical";
    // Auto-reset inputMode when coffee type changes
    if (f==="coffeeType" && !isUnitType(v)) next.inputMode = "kg";
    // Auto-calc drying charge
    if (["dryKg","dryingRate"].includes(f)) {
      next.dryingCharge = (parseFloat(f==="dryKg"?v:next.dryKg)||0) * (parseFloat(f==="dryingRate"?v:next.dryingRate)||0);
    }
    return next;
  });

  // Derived weights
  const fw    = parseFloat(form.firstWeight||0);
  const sw    = parseFloat(form.secondWeight||0);
  const rej   = parseFloat(form.rejectedBags||0);
  const gross = fw>0&&sw>0 ? fw-sw : 0;
  const netWt = gross>0 ? gross-rej : 0;

  // Unit/paka helpers
  const totalPaka = parseInt(form.noOfUnits||0)*21 + parseInt(form.noOfPaka||0);

  // Purchase value — use purchaseQtyKg if set, otherwise full netWt
  const purchaseKg    = parseFloat(form.purchaseQtyKg||0) > 0 ? parseFloat(form.purchaseQtyKg||0) : netWt;
  const effectiveQty  = purchaseKg;
  const pricingQty    = form.priceBasis==="dry" ? parseFloat(form.dryKg||0) : effectiveQty;
  const rate          = parseFloat(form.rate||0);
  const purchaseValue = form.ratePending ? 0 :
    form.rateType==="per_paka" ? totalPaka * rate : pricingQty * rate;

  const showDrying    = needsDrying(form.coffeeType) && form.hasDrying;

  const submit = () => {
    if (!form.partyId)    { setErr("Party is mandatory"); return; }
    if (!form.totalBags||parseFloat(form.totalBags)<=0) { setErr("Total bags is mandatory"); return; }
    if (netWt <= 0)       { setErr("Enter weight bridge readings — net weight must be > 0"); return; }
    if (!form.truckNo.trim()) { setErr("Truck number is required"); return; }
    const purQty = parseFloat(form.purchaseQtyKg||0);
    const storQty= parseFloat(form.storageQtyKg||0);
    if (purQty>0 && storQty>0 && Math.abs(purQty+storQty-netWt)>0.5) {
      setErr(`Purchase (${purQty}kg) + Storage (${storQty}kg) must equal Net Wt (${netWt.toFixed(2)}kg)`); return;
    }
    if (!form.ratePending && !form.rate) { setErr("Enter rate or tick 'Rate Pending'"); return; }
    setErr("");
    const grnType = purQty>0&&storQty>0?"both":storQty>0&&purQty===0?"storage":"purchase";
    const data = {
      ...form, grnType,
      grossWeight:gross.toFixed(2), netWeight:netWt.toFixed(2),
      totalPaka, purchaseValue,
      outputType: showDrying ? OUTPUT_MAP[form.coffeeType]||"" : "",
      dryingCharge: showDrying ? parseFloat(form.dryKg||0)*parseFloat(form.dryingRate||0) : 0,
    };
    if (editId) dispatch({type:"EDIT_GRN", id:editId, data});
    else        dispatch({type:"ADD_GRN",  data});
    onDone();
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>

      {/* ── SECTION 1: HEADER ── */}
      <div style={{border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
        <div style={{background:"#f5ede4",padding:"8px 14px",fontWeight:800,fontSize:12,color:C.accent}}>📋 GRN DETAILS</div>
        <div style={{padding:"14px 16px",display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(175px,1fr))",gap:12}}>
          <Field label="Date *"><input type="date" value={form.date} onChange={e=>set("date",e.target.value)} style={sh.input}/></Field>
          <Field label="Party (Supplier) *">
            <select value={form.partyId} onChange={e=>set("partyId",e.target.value)} style={{...sh.input,borderColor:!form.partyId?"#f97316":C.border}}>
              <option value="">— Select Party —</option>
              {suppliers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Coffee Type *">
            <select value={form.coffeeType} onChange={e=>set("coffeeType",e.target.value)} style={sh.input}>
              {GRN_COFFEE_TYPES.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Truck Number *"><input value={form.truckNo} onChange={e=>set("truckNo",e.target.value)} placeholder="TN-XX-X-XXXX" style={sh.input}/></Field>
          <Field label="Crop Season"><input value={form.cropSeason} onChange={e=>set("cropSeason",e.target.value)} placeholder="25/26" style={sh.input}/></Field>
          <Field label="Total Bags *">
            <input type="number" value={form.totalBags} onChange={e=>set("totalBags",e.target.value)} placeholder="0" style={{...sh.input,borderColor:!form.totalBags?"#f97316":C.border}}/>
          </Field>
          <Field label="Bag Type">
            <select value={form.bagType} onChange={e=>set("bagType",e.target.value)} style={sh.input}>
              <option>PP Bags</option><option>Jute Bags</option><option>Both</option>
            </select>
          </Field>
          <Field label="Location">
            <select value={form.location} onChange={e=>set("location",e.target.value)} style={sh.input}>
              {locationsList.map(l=><option key={l} value={l}>{l}</option>)}
            </select>
          </Field>
          <Field label="Narration"><input value={form.narration} onChange={e=>set("narration",e.target.value)} placeholder="Optional" style={sh.input}/></Field>
        </div>
      </div>

      {/* ── SECTION 2: UNIT MEASURE (wet parchment / raw cherry only) ── */}
      {isUnitType(form.coffeeType)&&(
        <div style={{border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
          <div style={{background:"#fdf4ff",padding:"8px 14px",display:"flex",gap:12,alignItems:"center"}}>
            <span style={{fontWeight:800,fontSize:12,color:"#7c3aed"}}>📦 UNIT OF MEASUREMENT</span>
            <div style={{display:"flex",gap:6}}>
              {[["kg","KG (weighbridge)"],["unit","Units + Paka"]].map(([v,l])=>(
                <button key={v} onClick={()=>set("inputMode",v)} style={{padding:"3px 12px",borderRadius:20,border:`1px solid ${form.inputMode===v?"#7c3aed":C.border}`,background:form.inputMode===v?"#7c3aed":"transparent",color:form.inputMode===v?"#fff":C.muted,fontWeight:600,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>{l}</button>
              ))}
            </div>
          </div>
          {form.inputMode==="unit"&&(
            <div style={{padding:"12px 16px",display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:12}}>
              <Field label="No. of Units"><input type="number" value={form.noOfUnits} onChange={e=>set("noOfUnits",e.target.value)} placeholder="0" style={sh.input}/></Field>
              <Field label="Extra Paka"><input type="number" value={form.noOfPaka} onChange={e=>set("noOfPaka",e.target.value)} placeholder="0" style={sh.input}/></Field>
              {totalPaka>0&&(
                <div style={{padding:"10px 14px",background:"#f5f0ff",borderRadius:6,alignSelf:"flex-end"}}>
                  <div style={{fontSize:11,color:"#7c3aed"}}>Total Paka</div>
                  <div style={{fontFamily:"monospace",fontWeight:800,fontSize:20,color:"#7c3aed"}}>{totalPaka}</div>
                  <div style={{fontSize:10,color:C.muted}}>{form.noOfUnits||0} × 21 + {form.noOfPaka||0}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── SECTION 3: WEIGHT BRIDGE ── */}
      <div style={{border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
        <div style={{background:"#f5ede4",padding:"8px 14px",fontWeight:800,fontSize:12,color:C.accent}}>⚖️ WEIGHT BRIDGE (always in kg)</div>
        <div style={{padding:"14px 16px",display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:12}}>
          <Field label="1st Weight Loaded (kg)"><input type="number" value={form.firstWeight} onChange={e=>set("firstWeight",e.target.value)} placeholder="0" style={sh.input}/></Field>
          <Field label="2nd Weight Empty (kg)"><input type="number" value={form.secondWeight} onChange={e=>set("secondWeight",e.target.value)} placeholder="0" style={sh.input}/></Field>
          <Field label="Gross Weight (kg)"><input value={gross>0?gross.toFixed(2):""} readOnly style={{...sh.input,background:"#f0f9ff",fontWeight:700,color:C.blue}}/></Field>
          <Field label="Deductions (kg)"><input type="number" value={form.rejectedBags} onChange={e=>set("rejectedBags",e.target.value)} placeholder="0" style={sh.input}/></Field>
          <Field label="Net Weight (kg)">
            <input value={netWt>0?netWt.toFixed(2):""} readOnly style={{...sh.input,background:"#dcfce7",fontWeight:800,fontSize:15,color:C.green}}/>
          </Field>
        </div>
      </div>

      {/* ── SECTION 4: DRYING (wet parchment / raw cherry only) ── */}
      {needsDrying(form.coffeeType)&&(
        <div style={{border:`2px solid ${form.hasDrying?"#f97316":"#e8ddd0"}`,borderRadius:8,overflow:"hidden"}}>
          <div style={{background:form.hasDrying?"#fff7ed":"#f5ede4",padding:"8px 14px",display:"flex",gap:12,alignItems:"center"}}>
            <span style={{fontWeight:800,fontSize:12,color:form.hasDrying?"#c2410c":C.muted}}>🌡 DRYING</span>
            <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:13}}>
              <input type="checkbox" checked={form.hasDrying} onChange={e=>set("hasDrying",e.target.checked)} style={{width:16,height:16}}/>
              <span style={{color:form.hasDrying?"#c2410c":C.muted,fontWeight:600}}>{form.hasDrying?"Drying enabled":"Enable drying for this GRN"}</span>
            </label>
            {form.hasDrying&&<span style={{fontSize:11,color:"#c2410c",background:"#ffedd5",padding:"2px 8px",borderRadius:10,fontWeight:600}}>→ Converts to {OUTPUT_MAP[form.coffeeType]}</span>}
          </div>
          {form.hasDrying&&(
            <div style={{padding:"14px 16px",display:"flex",flexDirection:"column",gap:14}}>
              <div style={{padding:"10px 14px",background:"#fff7ed",borderRadius:8,fontSize:13,color:"#c2410c",fontWeight:600}}>
                ⏳ Drying takes time — dry quantity will be entered separately after drying is complete.
                <div style={{fontWeight:400,color:"#92400e",marginTop:4,fontSize:12}}>Purchase rate, split, and drying charges will all be calculated on <strong>dry kg</strong>.</div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(175px,1fr))",gap:12}}>
                <Field label="Drying Method">
                  <select value={form.dryingMethod} onChange={e=>set("dryingMethod",e.target.value)} style={sh.input}>
                    <option value="Yard">Yard Drying</option>
                    <option value="Mechanical">Mechanical Dryer</option>
                  </select>
                </Field>
                <Field label="Drying Rate (₹/kg dry)">
                  <input type="number" value={form.dryingRate} onChange={e=>set("dryingRate",e.target.value)} placeholder="0.00" style={sh.input}/>
                </Field>
                <Field label="Price Basis">
                  <select value={form.priceBasis} onChange={e=>set("priceBasis",e.target.value)} style={sh.input}>
                    <option value="wet">On Wet Weight — Drying = Company Expense</option>
                    <option value="dry">On Dry Weight — Drying = Billed to Party</option>
                  </select>
                </Field>
              </div>
              <div style={{fontSize:12,color:"#c2410c",background:"#ffedd5",padding:"8px 12px",borderRadius:6}}>
                {form.priceBasis==="wet"
                  ? "🔴 Price on WET → Drying charge (dry kg × rate) = COMPANY EXPENSE (Dr Drying A/c, Cr Drying Income)"
                  : "🟢 Price on DRY → Drying charge (dry kg × rate) = BILLED TO PARTY (Dr Party, Cr Drying Income)"}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── SECTION 5: PURCHASE RATE ── */}
      <div style={{border:`2px solid #22c55e44`,borderRadius:8,overflow:"hidden"}}>
        <div style={{background:"#f0fdf4",padding:"8px 14px",fontWeight:800,fontSize:12,color:C.green}}>🛒 PURCHASE & STORAGE SPLIT</div>
        <div style={{padding:"14px 16px",display:"flex",flexDirection:"column",gap:12}}>

          {/* Basis qty info */}
          {form.hasDrying&&(
            <div style={{padding:"8px 12px",background:"#fff7ed",borderRadius:6,fontSize:12,color:"#c2410c",fontWeight:600}}>
              ⚠ Drying enabled — Purchase/storage split and rate will be applied on <strong>dry kg</strong> (entered after drying). Leave split at 0 for now.
            </div>
          )}

          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(175px,1fr))",gap:12}}>
            <Field label={`Purchase Qty (kg)${form.hasDrying?" — after drying":""} — Company Owns`}>
              <input type="number" value={form.purchaseQtyKg} onChange={e=>set("purchaseQtyKg",e.target.value)}
                placeholder={form.hasDrying?"Enter after drying":"0 = full qty"} style={{...sh.input,borderColor:"#22c55e"}}
                disabled={form.hasDrying}/>
            </Field>
            <Field label={`Storage Qty (kg)${form.hasDrying?" — after drying":""} — Party Owns`}>
              <input type="number" value={form.storageQtyKg} onChange={e=>set("storageQtyKg",e.target.value)}
                placeholder={form.hasDrying?"Enter after drying":"0 = none"} style={{...sh.input,borderColor:C.blue}}
                disabled={form.hasDrying}/>
            </Field>
            {!form.hasDrying&&netWt>0&&(
              <div style={{padding:"10px 14px",background:C.cream,borderRadius:6,alignSelf:"flex-end",fontSize:12}}>
                <div style={{color:C.muted}}>Net Weight</div>
                <div style={{fontFamily:"monospace",fontWeight:800,fontSize:16,color:C.green}}>{netWt.toFixed(2)} kg</div>
                {(parseFloat(form.purchaseQtyKg||0)+parseFloat(form.storageQtyKg||0))>0&&(
                  <div style={{color:Math.abs((parseFloat(form.purchaseQtyKg||0)+parseFloat(form.storageQtyKg||0))-netWt)<0.5?C.green:C.red,fontWeight:600,fontSize:11}}>
                    Split: {parseFloat(form.purchaseQtyKg||0)+parseFloat(form.storageQtyKg||0)} kg {Math.abs((parseFloat(form.purchaseQtyKg||0)+parseFloat(form.storageQtyKg||0))-netWt)<0.5?"✓":"⚠ must = net wt"}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Rate */}
          <div style={{borderTop:`1px solid ${C.border}`,paddingTop:12}}>
            <div style={{fontSize:12,fontWeight:700,color:C.green,marginBottom:10}}>
              💰 Purchase Rate {form.hasDrying&&<span style={{color:"#c2410c",fontWeight:400}}>(applied on dry kg after drying)</span>}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(175px,1fr))",gap:12}}>
              <Field label="Rate Type">
                <select value={form.rateType} onChange={e=>set("rateType",e.target.value)} style={sh.input} disabled={form.ratePending}>
                  <option value="per_kg">Per KG (₹/kg)</option>
                  {isUnitType(form.coffeeType)&&<option value="per_paka">Per Paka (₹/paka)</option>}
                </select>
              </Field>
              <Field label={form.rateType==="per_paka"?"Rate per Paka (₹)":"Rate per KG (₹)"}>
                <input type="number" value={form.rate} onChange={e=>set("rate",e.target.value)} placeholder="0.00"
                  style={{...sh.input,opacity:form.ratePending?0.4:1}} disabled={form.ratePending}/>
              </Field>
            </div>
            <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",marginTop:10}}>
              <input type="checkbox" checked={form.ratePending} onChange={e=>set("ratePending",e.target.checked)} style={{width:16,height:16}}/>
              <span style={{fontSize:13,color:C.muted,fontWeight:600}}>Rate Pending — fix & bill later</span>
            </label>
            {!form.ratePending&&rate>0&&!form.hasDrying&&pricingQty>0&&(
              <div style={{padding:"12px 16px",background:"#f0fdf4",borderRadius:8,display:"flex",gap:24,alignItems:"center",flexWrap:"wrap",marginTop:10}}>
                <div>
                  <div style={{fontSize:11,color:C.muted}}>Purchase Value</div>
                  <div style={{fontFamily:"monospace",fontWeight:800,fontSize:22,color:C.green}}>{fmt(purchaseValue)}</div>
                </div>
                <div style={{fontSize:12,color:C.muted}}>
                  {form.rateType==="per_paka"?`${totalPaka} paka × ₹${rate}`:`${pricingQty.toFixed(2)} kg × ₹${rate}`}
                </div>
                <div style={{fontSize:11,background:"#dcfce7",color:C.green,padding:"4px 10px",borderRadius:8,fontWeight:600}}>
                  → Auto-posts Purchase voucher to party account
                </div>
              </div>
            )}
            {form.hasDrying&&rate>0&&(
              <div style={{padding:"10px 14px",background:"#fff7ed",borderRadius:8,marginTop:10,fontSize:12,color:"#c2410c"}}>
                Rate ₹{rate}/kg will be applied on dry kg when you enter dry quantity after drying
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── SECTION 6: STORAGE ── */}
      <div style={{border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
        <div style={{background:"#f5ede4",padding:"8px 14px",fontWeight:800,fontSize:12,color:C.accent}}>🏭 STORAGE</div>
        <div style={{padding:"14px 16px",display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:12}}>
          <Field label="Warehouse">
            <select value={form.warehouse} onChange={e=>set("warehouse",e.target.value)} style={sh.input}>
              {warehousesList.map(w=><option key={w} value={w}>{w}</option>)}
            </select>
          </Field>
          <Field label="Zone"><input value={form.warehouseZone} onChange={e=>set("warehouseZone",e.target.value)} placeholder="e.g. Zone 2" style={sh.input}/></Field>
          <Field label="Stock No."><input value={form.stockNo} onChange={e=>set("stockNo",e.target.value)} placeholder="Optional" style={sh.input}/></Field>
          <Field label="Remarks"><input value={form.remarks} onChange={e=>set("remarks",e.target.value)} placeholder="Optional" style={sh.input}/></Field>
        </div>
      </div>

      {err&&<div style={{color:C.red,fontWeight:700,fontSize:13,padding:"8px 12px",background:"#fee2e2",borderRadius:6}}>{err}</div>}
      <div style={{display:"flex",gap:10}}>
        <Btn onClick={submit} variant="success" size="lg">{editId?"✓ Save Changes":"✓ Save GRN"}</Btn>
        <Btn onClick={onDone} variant="ghost">Cancel</Btn>
      </div>
    </div>
  );
}

// ── QUALITY REPORT ────────────────────────────────────────────────
function QRow({ label, value, onChange, color }) {
  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${C.border}`}}>
      <span style={{fontSize:13,color:color||C.text,fontWeight:color?700:400}}>{label}</span>
      <div style={{display:"flex",alignItems:"center",gap:6}}>
        <input type="number" value={value||""} onChange={onChange} style={{...sh.input,width:80,textAlign:"right"}} placeholder="0"/>
        <span style={{color:C.muted,fontSize:12,width:14}}>%</span>
      </div>
    </div>
  );
}

function QualityForm({ grnId, existing, dispatch, onDone }) {
  const empty = {moisture:"",outturn:"",sc19AAA:"",sc18AA:"",sc17A:"",sc15B:"",sc14C:"",sc13up:"",pb:"",bits:"",bbb:"",idb:"",foreignMatter:"",huskMoisture:"",triage:"",blacks:"",brows:"",comments:""};
  const [form,setForm] = useState(existing||empty);
  const set = (f,v) => setForm(p=>({...p,[f]:v}));
  const totalGrades = ["sc19AAA","sc18AA","sc17A","sc15B","sc14C","sc13up","pb","bits","bbb","idb"].reduce((s,k)=>s+parseFloat(form[k]||0),0);
  const submit = () => { dispatch({type:"ADD_QUALITY_REPORT",grnId,report:{...form,savedAt:new Date().toISOString()}}); onDone(); };
  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <div style={sh.card}>
          <div style={{fontWeight:800,color:C.accent,marginBottom:12}}>📊 Humid & Yield</div>
          <QRow label="Moisture %"     value={form.moisture}     onChange={e=>set("moisture",e.target.value)}     color={C.blue}/>
          <QRow label="Outturn %"      value={form.outturn}      onChange={e=>set("outturn",e.target.value)}      color={C.green}/>
          <QRow label="Husk Moisture %" value={form.huskMoisture} onChange={e=>set("huskMoisture",e.target.value)}/>
        </div>
        <div style={sh.card}>
          <div style={{fontWeight:800,color:C.accent,marginBottom:12}}>⚠️ Imperfections</div>
          <QRow label="Triage"         value={form.triage}        onChange={e=>set("triage",e.target.value)}/>
          <QRow label="Blacks"         value={form.blacks}        onChange={e=>set("blacks",e.target.value)}/>
          <QRow label="Brows"          value={form.brows}         onChange={e=>set("brows",e.target.value)}/>
          <QRow label="IDB"            value={form.idb}           onChange={e=>set("idb",e.target.value)}/>
          <QRow label="Foreign Matter" value={form.foreignMatter} onChange={e=>set("foreignMatter",e.target.value)}/>
        </div>
      </div>
      <div style={sh.card}>
        <div style={{fontWeight:800,color:C.accent,marginBottom:4}}>
          🔢 Screen / Grades
          <span style={{float:"right",fontSize:12,fontWeight:600,color:Math.abs(totalGrades-100)<0.5?C.green:C.muted}}>Total: {totalGrades.toFixed(1)}% {Math.abs(totalGrades-100)<0.5?"✓":""}</span>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 24px"}}>
          <QRow label="Sc.19 AAA"          value={form.sc19AAA} onChange={e=>set("sc19AAA",e.target.value)} color="#15803d"/>
          <QRow label="Sc.18 AA"           value={form.sc18AA}  onChange={e=>set("sc18AA",e.target.value)}  color="#15803d"/>
          <QRow label="Sc.17 A"            value={form.sc17A}   onChange={e=>set("sc17A",e.target.value)}   color="#1d4ed8"/>
          <QRow label="Sc.15 B"            value={form.sc15B}   onChange={e=>set("sc15B",e.target.value)}   color="#1d4ed8"/>
          <QRow label="Sc.14 C"            value={form.sc14C}   onChange={e=>set("sc14C",e.target.value)}   color="#92400e"/>
          <QRow label="Sc.13 up"           value={form.sc13up}  onChange={e=>set("sc13up",e.target.value)}  color="#92400e"/>
          <QRow label="PB (Peaberry)"      value={form.pb}      onChange={e=>set("pb",e.target.value)}      color="#8b5cf6"/>
          <QRow label="Bits (below Sc.13)" value={form.bits}    onChange={e=>set("bits",e.target.value)}    color="#ef4444"/>
          <QRow label="BBB"                value={form.bbb}     onChange={e=>set("bbb",e.target.value)}     color="#ef4444"/>
          <QRow label="IDB"                value={form.idb}     onChange={e=>set("idb",e.target.value)}     color="#f97316"/>
        </div>
      </div>
      <Field label="Quality Comments"><textarea value={form.comments} onChange={e=>set("comments",e.target.value)} rows={2} placeholder="Remarks…" style={{...sh.input,resize:"vertical"}}/></Field>
      <div style={{display:"flex",gap:10}}><Btn onClick={submit} variant="success" size="lg">✓ Save Quality Report</Btn><Btn onClick={onDone} variant="ghost">Cancel</Btn></div>
    </div>
  );
}

// ── PRINT GRN SLIP ────────────────────────────────────────────────
function printGRN(grn, party) {
  const dryKg   = parseFloat(grn.dryKg||0);
  const netWt   = parseFloat(grn.netWeight||0);
  const hasDry  = grn.hasDrying===true||grn.hasDrying==="true"||grn.hasDrying===1;
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>GRN Slip - ${grn.id}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=DM+Sans:wght@400;600;700&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'DM Sans',sans-serif; color:#2c1a0e; background:#fff; padding:20px; font-size:13px; }
  .header { text-align:center; border-bottom:2px solid #6b3f1a; padding-bottom:12px; margin-bottom:16px; }
  .company { font-family:'Libre Baskerville',serif; font-size:20px; font-weight:700; color:#6b3f1a; }
  .sub { font-size:11px; color:#8c7560; letter-spacing:1px; text-transform:uppercase; margin-top:2px; }
  .grn-title { font-size:15px; font-weight:700; color:#6b3f1a; margin-top:6px; }
  .meta { display:flex; justify-content:space-between; margin-bottom:14px; background:#fdf8f2; border:1px solid #e8ddd0; border-radius:6px; padding:10px 14px; flex-wrap:wrap; gap:8px; }
  .meta-item { display:flex; flex-direction:column; gap:2px; }
  .meta-label { font-size:10px; font-weight:700; color:#8c7560; text-transform:uppercase; letter-spacing:0.5px; }
  .meta-value { font-size:13px; font-weight:600; color:#2c1a0e; }
  .section { margin-bottom:14px; }
  .section-title { font-size:11px; font-weight:700; color:#6b3f1a; text-transform:uppercase; letter-spacing:0.5px; border-bottom:1px solid #e8ddd0; padding-bottom:4px; margin-bottom:8px; }
  table { width:100%; border-collapse:collapse; }
  td { padding:5px 8px; font-size:13px; border-bottom:1px solid #f0e8e0; }
  td:first-child { color:#8c7560; width:45%; }
  td:last-child { font-weight:600; }
  .highlight { background:#f0fdf4; }
  .highlight td:last-child { color:#15803d; font-weight:800; font-size:14px; }
  .drying-box { background:#fff7ed; border:1px solid #fed7aa; border-radius:6px; padding:10px 14px; margin-bottom:14px; }
  .drying-title { font-size:11px; font-weight:700; color:#c2410c; text-transform:uppercase; margin-bottom:6px; }
  .purchase-box { background:#f0fdf4; border:1px solid #86efac; border-radius:6px; padding:10px 14px; margin-bottom:14px; }
  .purchase-title { font-size:11px; font-weight:700; color:#15803d; text-transform:uppercase; margin-bottom:6px; }
  .rate-pending { background:#fef9c3; border:1px solid #fde047; border-radius:6px; padding:8px 14px; color:#92400e; font-weight:600; font-size:12px; }
  .footer { border-top:1px solid #e8ddd0; margin-top:16px; padding-top:10px; display:flex; justify-content:space-between; font-size:11px; color:#8c7560; }
  .sig-box { text-align:center; border-top:1px solid #8c7560; padding-top:4px; margin-top:40px; font-size:11px; color:#8c7560; min-width:120px; }
  .sigs { display:flex; justify-content:space-between; margin-top:24px; }
  @media print { body { padding:10px; } }
</style>
</head>
<body>
<div class="header">
  <div class="company">☕ Coffee Vel International</div>
  <div class="sub">Pattiveeranpatti · Yercaud · Coffee Processing & Trading</div>
  <div class="grn-title">Goods Receipt Note</div>
</div>

<div class="meta">
  <div class="meta-item"><span class="meta-label">GRN No.</span><span class="meta-value">${grn.id}</span></div>
  <div class="meta-item"><span class="meta-label">Date</span><span class="meta-value">${grn.date}</span></div>
  <div class="meta-item"><span class="meta-label">Party</span><span class="meta-value">${party?.name||"—"}</span></div>
  <div class="meta-item"><span class="meta-label">Truck No.</span><span class="meta-value">${grn.truckNo||"—"}</span></div>
  <div class="meta-item"><span class="meta-label">Crop Season</span><span class="meta-value">${grn.cropSeason||"—"}</span></div>
  <div class="meta-item"><span class="meta-label">Type</span><span class="meta-value">${grn.coffeeType}</span></div>
</div>

<div class="section">
  <div class="section-title">⚖️ Weight Details</div>
  <table>
    <tr><td>Total Bags</td><td>${grn.totalBags||grn.noOfBags||"—"} bags (${grn.bagType||"PP"})</td></tr>
    ${grn.inputMode==="unit"?`<tr><td>Units / Paka</td><td>${grn.noOfUnits||0} units ${grn.noOfPaka||0} paka = ${grn.totalPaka||0} paka</td></tr>`:""}
    <tr><td>1st Weight (Loaded)</td><td>${grn.firstWeight||0} kg</td></tr>
    <tr><td>2nd Weight (Empty)</td><td>${grn.secondWeight||0} kg</td></tr>
    <tr><td>Gross Weight</td><td>${grn.grossWeight||0} kg</td></tr>
    <tr><td>Deductions</td><td>${grn.rejectedBags||0} kg</td></tr>
    <tr class="highlight"><td>Net Weight</td><td>${netWt.toLocaleString("en-IN",{maximumFractionDigits:2})} kg</td></tr>
  </table>
</div>

<div class="section">
  <div class="section-title">🏭 Storage Details</div>
  <table>
    <tr><td>Location</td><td>${grn.location||"—"}</td></tr>
    <tr><td>Warehouse</td><td>${grn.warehouse||"—"}</td></tr>
    ${grn.warehouseZone?`<tr><td>Zone</td><td>${grn.warehouseZone}</td></tr>`:""}
    ${grn.stockNo?`<tr><td>Stock No.</td><td>${grn.stockNo}</td></tr>`:""}
    <tr><td>GRN Type</td><td style="text-transform:capitalize">${grn.grnType||"purchase"}</td></tr>
  </table>
</div>

${hasDry?`
<div class="drying-box">
  <div class="drying-title">🌡 Drying Information</div>
  <table>
    <tr><td>Method</td><td>${grn.dryingMethod||"Yard"} Drying</td></tr>
    <tr><td>Output Type</td><td>${grn.outputType||"—"}</td></tr>
    ${dryKg>0?`<tr><td>Dry Weight</td><td style="font-weight:800;color:#c2410c">${dryKg.toLocaleString("en-IN",{maximumFractionDigits:2})} kg</td></tr>`:"<tr><td>Dry Weight</td><td style='color:#c2410c'>⏳ Pending</td></tr>"}
    ${dryKg>0&&netWt>0?`<tr><td>Moisture Loss</td><td>${((netWt-dryKg)/netWt*100).toFixed(1)}%</td></tr>`:""}
    <tr><td>Price Basis</td><td>${grn.priceBasis==="wet"?"On Wet Weight":"On Dry Weight"}</td></tr>
    ${parseFloat(grn.dryingRate||0)>0?`<tr><td>Drying Rate</td><td>₹${grn.dryingRate}/kg</td></tr>`:""}
    ${parseFloat(grn.dryingCharge||0)>0?`<tr><td>Drying Charge</td><td>₹${parseFloat(grn.dryingCharge).toLocaleString("en-IN",{minimumFractionDigits:2})}</td></tr>`:""}
  </table>
</div>`:""}

${grn.grnType==="purchase"||grn.grnType==="both"?`
<div class="purchase-box">
  <div class="purchase-title">💰 Purchase Details</div>
  ${grn.ratePending?`<div class="rate-pending">⚠️ Rate Pending — to be confirmed</div>`:`
  <table>
    <tr><td>Rate</td><td>₹${grn.rate||0} ${grn.rateType==="per_paka"?"per paka":"per kg"}</td></tr>
    <tr class="highlight"><td>Purchase Value</td><td>₹${parseFloat(grn.purchaseValue||0).toLocaleString("en-IN",{minimumFractionDigits:2})}</td></tr>
  </table>`}
</div>`:""}

${grn.remarks||grn.narration?`<div class="section"><div class="section-title">📝 Remarks</div><div style="padding:6px 8px;font-size:13px;color:#8c7560">${grn.remarks||grn.narration}</div></div>`:""}

<div class="sigs">
  <div class="sig-box">Received By</div>
  <div class="sig-box">Weigh Bridge Operator</div>
  <div class="sig-box">Authorised Signatory</div>
</div>

<div class="footer">
  <span>Coffee Vel International · Pattiveeranpatti</span>
  <span>Printed: ${new Date().toLocaleDateString("en-IN")} ${new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</span>
</div>
</body>
</html>`;

  const w = window.open("","_blank","width=800,height=900");
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(()=>w.print(), 400);
}

// ── PRINT SUPPLIER LEDGER ─────────────────────────────────────────
function printLedger(account, entries, fromDate, toDate) {
  const totalDr = entries.reduce((s,e)=>s+e.dr,0);
  const totalCr = entries.reduce((s,e)=>s+e.cr,0);
  const closing  = entries.length>0 ? entries[entries.length-1].balance : 0;
  const isDebitNormal = ["asset","expense"].includes(account?.type);
  const closingLabel = isDebitNormal ? (closing>=0?"Dr":"Cr") : (closing>=0?"Cr":"Dr");
  const fmtAmt = n => "₹"+Math.abs(Number(n)||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});

  const VOUCHER_COLORS = {RV:"#22c55e",PV:"#ef4444",CV:"#8b5cf6",JV:"#f59e0b",SV:"#3b82f6",PuV:"#0ea5e9"};

  const rows = entries.map((e,i) => `
    <tr style="background:${i%2===0?"#fff":"#fdf8f2"}">
      <td>${e.date}</td>
      <td><span style="background:${(VOUCHER_COLORS[e.voucherType]||"#888")}18;color:${VOUCHER_COLORS[e.voucherType]||"#888"};padding:1px 6px;border-radius:4px;font-size:11px;font-weight:700">${e.voucherType}</span><br><span style="font-size:10px;color:#8c7560">${e.voucherId}</span></td>
      <td>${e.narration||"—"}</td>
      <td style="text-align:right;font-family:monospace;color:#1d4ed8">${e.dr>0?fmtAmt(e.dr):"—"}</td>
      <td style="text-align:right;font-family:monospace;color:#b91c1c">${e.cr>0?fmtAmt(e.cr):"—"}</td>
      <td style="text-align:right;font-family:monospace;font-weight:700;color:${e.balance>=0?"#15803d":"#b91c1c"}">${fmtAmt(Math.abs(e.balance))} ${isDebitNormal?(e.balance>=0?"Dr":"Cr"):(e.balance>=0?"Cr":"Dr")}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Ledger - ${account?.name}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=DM+Sans:wght@400;600;700&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'DM Sans',sans-serif; color:#2c1a0e; background:#fff; padding:20px; font-size:12px; }
  .header { text-align:center; border-bottom:2px solid #6b3f1a; padding-bottom:12px; margin-bottom:16px; }
  .company { font-family:'Libre Baskerville',serif; font-size:20px; font-weight:700; color:#6b3f1a; }
  .sub { font-size:11px; color:#8c7560; letter-spacing:1px; text-transform:uppercase; margin-top:2px; }
  .acc-header { background:#6b3f1a; color:#fff; border-radius:8px; padding:12px 16px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; }
  .acc-name { font-family:'Libre Baskerville',serif; font-size:17px; font-weight:700; }
  .acc-meta { font-size:11px; opacity:0.8; margin-top:2px; }
  .closing { font-family:monospace; font-weight:800; font-size:18px; }
  table { width:100%; border-collapse:collapse; }
  th { background:#f5ede4; padding:7px 10px; font-size:11px; color:#8c7560; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; border-bottom:2px solid #e8ddd0; text-align:left; }
  th.r, td.r { text-align:right; }
  td { padding:6px 10px; font-size:12px; border-bottom:1px solid #f0e8e0; vertical-align:middle; }
  tfoot td { background:#f5ede4; font-weight:800; padding:8px 10px; }
  .footer { border-top:1px solid #e8ddd0; margin-top:16px; padding-top:8px; display:flex; justify-content:space-between; font-size:11px; color:#8c7560; }
  .period { background:#eff6ff; border:1px solid #bfdbfe; border-radius:6px; padding:6px 12px; margin-bottom:12px; font-size:12px; color:#1d4ed8; }
  @media print { body { padding:8px; } }
</style>
</head>
<body>
<div class="header">
  <div class="company">☕ Coffee Vel International</div>
  <div class="sub">Account Statement · Ledger</div>
</div>

<div class="acc-header">
  <div>
    <div class="acc-name">${account?.name||"Account"}</div>
    <div class="acc-meta">${account?.group||""} · ${account?.type||""}</div>
  </div>
  <div style="text-align:right">
    <div style="font-size:11px;opacity:0.8">Closing Balance</div>
    <div class="closing">${fmtAmt(Math.abs(closing))} ${closingLabel}</div>
  </div>
</div>

${fromDate||toDate?`<div class="period">📅 Period: ${fromDate||"Beginning"} → ${toDate||"Today"} · ${entries.length} transactions</div>`:`<div class="period">📅 All Transactions · ${entries.length} entries</div>`}

<table>
  <thead>
    <tr>
      <th style="width:90px">Date</th>
      <th style="width:80px">Voucher</th>
      <th>Particulars</th>
      <th class="r" style="width:110px">Debit (₹)</th>
      <th class="r" style="width:110px">Credit (₹)</th>
      <th class="r" style="width:130px">Balance</th>
    </tr>
  </thead>
  <tbody>
    ${entries.length===0?`<tr><td colspan="6" style="text-align:center;padding:30px;color:#8c7560">No transactions in this period</td></tr>`:rows}
  </tbody>
  <tfoot>
    <tr>
      <td colspan="3">Total / Closing Balance</td>
      <td class="r" style="font-family:monospace;color:#1d4ed8">${fmtAmt(totalDr)}</td>
      <td class="r" style="font-family:monospace;color:#b91c1c">${fmtAmt(totalCr)}</td>
      <td class="r" style="font-family:monospace;color:${closing>=0?"#15803d":"#b91c1c"}">${fmtAmt(Math.abs(closing))} ${closingLabel}</td>
    </tr>
  </tfoot>
</table>

<div class="footer">
  <span>Coffee Vel International · Pattiveeranpatti</span>
  <span>Printed: ${new Date().toLocaleDateString("en-IN")} ${new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</span>
</div>
</body>
</html>`;

  const w = window.open("","_blank","width=900,height=700");
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(()=>w.print(), 400);
}

// ── GRN MODULE ────────────────────────────────────────────────────
function GRNModule({ state, dispatch, role }) {
  const [showForm,setShowForm]               = useState(false);
  const [editGRN,setEditGRN]                 = useState(null);
  const [showQuality,setShowQuality]         = useState(null);
  const [showDryModal, setShowDryModal]   = useState(null);
  const [dryForm, setDryForm]             = useState({dryKg:"", purchaseQtyKg:"", storageQtyKg:""});
  const [showRateModal,setShowRateModal]  = useState(null);
  const [rateForm,setRateForm]            = useState({rateType:"per_kg",rate:""});
  const [expandedId,setExpandedId]           = useState(null);
  const [confirmDeleteId,setConfirmDeleteId] = useState(null);
  const [filterParty,setFilterParty]         = useState("all");
  const [filterType,setFilterType]           = useState("all");
  const [search,setSearch]                   = useState("");

  const canPost   = ROLES[role]?.canPost;
  const canDelete = ROLES[role]?.canDelete;

  const grns = useMemo(()=>state.grns.filter(g=>{
    if(filterParty!=="all"&&g.partyId!==filterParty) return false;
    if(filterType!=="all"&&g.grnType!==filterType) return false;
    if(search&&!g.id?.toLowerCase().includes(search.toLowerCase())&&
      !(state.parties[g.partyId]?.name||"").toLowerCase().includes(search.toLowerCase())&&
      !(g.truckNo||"").toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }),[state.grns,filterParty,filterType,search]);

  const pendingRate = state.grns.filter(g=>g.ratePending&&(g.grnType==="purchase"||g.grnType==="both")).length;
  const pendingQC = state.grns.filter(g=>needsQualityForGRN(g)&&!g.qualityReport).length;

  const grnBadge = (type) => {
    const m={purchase:{bg:"#f0fdf4",c:C.green,l:"🛒 Purchase"},storage:{bg:"#eff6ff",c:C.blue,l:"🏭 Storage"},both:{bg:"#fdf4ff",c:"#7c3aed",l:"↔ Both"}};
    const s=m[type]||m.purchase;
    return <span style={{background:s.bg,color:s.c,padding:"2px 8px",borderRadius:10,fontSize:11,fontWeight:700}}>{s.l}</span>;
  };

  const submitRate = async (grnId) => {
    const g = state.grns.find(x=>x.id===grnId);
    if(!g||!rateForm.rate) return;
    // Use dry kg if drying enabled, otherwise net wet weight
    const billingQty = g.hasDrying && parseFloat(g.dryKg||0)>0
      ? parseFloat(g.dryKg)
      : parseFloat(g.netWeight||0);
    const purchaseValue = rateForm.rateType==="per_paka"
      ? (parseFloat(g.totalPaka||0)*parseFloat(rateForm.rate))
      : (billingQty*parseFloat(rateForm.rate));
    await dispatch({type:"EDIT_GRN",id:grnId,data:{
      ...g,
      rateType:rateForm.rateType,
      rate:rateForm.rate,
      ratePending:false,
      purchaseValue,
    }});
    setShowRateModal(null);
    setRateForm({rateType:"per_kg",rate:""});
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>

      {/* Confirm delete */}
      {confirmDeleteId&&(
        <div style={{position:"fixed",inset:0,background:"#00000066",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:C.surface,borderRadius:14,padding:"28px 32px",maxWidth:380,width:"100%",boxShadow:"0 20px 60px #00000044",textAlign:"center"}}>
            <div style={{fontSize:36,marginBottom:12}}>🗑</div>
            <div style={{fontWeight:800,fontSize:17,marginBottom:8}}>Delete GRN?</div>
            <div style={{fontSize:13,color:C.muted,marginBottom:20}}>Stock and any linked purchase voucher for <strong>{confirmDeleteId}</strong> will be reversed.</div>
            <div style={{display:"flex",gap:10,justifyContent:"center"}}>
              <Btn variant="danger" onClick={()=>{dispatch({type:"DELETE_GRN",id:confirmDeleteId});setConfirmDeleteId(null);setExpandedId(null);}}>Yes, Delete</Btn>
              <Btn variant="ghost" onClick={()=>setConfirmDeleteId(null)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Dry Quantity Modal */}
      {showDryModal&&(()=>{
        const g = state.grns.find(x=>x.id===showDryModal);
        if(!g) return null;
        const dryKg   = parseFloat(dryForm.dryKg||0);
        const purQty  = parseFloat(dryForm.purchaseQtyKg||0);
        const storQty = parseFloat(dryForm.storageQtyKg||0);
        const splitOk = purQty>0||storQty>0 ? Math.abs(purQty+storQty-dryKg)<0.5 : true;
        const purchaseQty = purQty>0 ? purQty : dryKg;
        const dryingCharge = dryKg * parseFloat(g.dryingRate||0);
        const purchaseValue= parseFloat(g.rate||0) * (g.rateType==="per_paka"?parseFloat(g.totalPaka||0):purchaseQty);
        return(
          <div style={{position:"fixed",inset:0,background:"#00000066",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
            <div style={{background:C.surface,borderRadius:14,padding:"24px",width:"100%",maxWidth:500,boxShadow:"0 20px 60px #00000044"}}>
              <div style={{fontWeight:800,color:"#c2410c",marginBottom:4,fontSize:16}}>🌡 Enter Dry Quantity</div>
              <div style={{color:C.muted,fontSize:13,marginBottom:16}}>{g.id} · {g.coffeeType} → {OUTPUT_MAP[g.coffeeType]} · Wet: {g.netWeight} kg</div>
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                <Field label={`Dry Weight Out (${OUTPUT_MAP[g.coffeeType]}) kg`}>
                  <input type="number" value={dryForm.dryKg} onChange={e=>setDryForm(f=>({...f,dryKg:e.target.value}))} placeholder="0" style={sh.input} autoFocus/>
                </Field>
                {dryKg>0&&(
                  <div style={{padding:"8px 12px",background:"#fff7ed",borderRadius:6,fontSize:12}}>
                    Moisture loss: <strong>{((parseFloat(g.netWeight||0)-dryKg)/parseFloat(g.netWeight||1)*100).toFixed(1)}%</strong>
                    {g.dryingRate>0&&<span style={{marginLeft:16}}>Drying charge: <strong style={{color:g.priceBasis==="wet"?C.red:C.green}}>{fmt(dryingCharge)}</strong> ({dryKg}kg × ₹{g.dryingRate})</span>}
                  </div>
                )}
                {dryKg>0&&(
                  <>
                    <div style={{fontWeight:700,color:C.accent,fontSize:13,marginTop:4}}>Split dry quantity (or leave 0 for full purchase):</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                      <Field label="Purchase Qty (kg) — Company">
                        <input type="number" value={dryForm.purchaseQtyKg} onChange={e=>setDryForm(f=>({...f,purchaseQtyKg:e.target.value}))} placeholder={`0 = all ${dryKg} kg`} style={sh.input}/>
                      </Field>
                      <Field label="Storage Qty (kg) — Party">
                        <input type="number" value={dryForm.storageQtyKg} onChange={e=>setDryForm(f=>({...f,storageQtyKg:e.target.value}))} placeholder="0 = none" style={sh.input}/>
                      </Field>
                    </div>
                    {(purQty>0||storQty>0)&&(
                      <div style={{fontSize:12,color:splitOk?C.green:C.red,fontWeight:600}}>
                        {splitOk?`✓ Split OK: ${purQty}+${storQty}=${purQty+storQty} kg`:`⚠ ${purQty}+${storQty}=${purQty+storQty} kg must equal ${dryKg} kg`}
                      </div>
                    )}
                    {!g.ratePending&&g.rate>0&&(
                      <div style={{padding:"10px 14px",background:"#f0fdf4",borderRadius:6,fontSize:12}}>
                        Purchase value: <strong style={{color:C.green,fontFamily:"monospace"}}>{fmt(purchaseValue)}</strong>
                        <span style={{color:C.muted,marginLeft:8}}>{purchaseQty}kg × ₹{g.rate}</span>
                        <div style={{color:C.green,fontSize:11,marginTop:2}}>→ Auto-posts Purchase voucher to party account</div>
                      </div>
                    )}
                  </>
                )}
              </div>
              <div style={{display:"flex",gap:10,marginTop:16}}>
                <Btn onClick={async()=>{
                  if(!dryKg||dryKg<=0) return;
                  if((purQty>0||storQty>0)&&!splitOk) return;
                  await dispatch({type:"EDIT_GRN",id:g.id,data:{
                    ...g,
                    dryKg:dryKg,
                    purchaseQtyKg:purQty||dryKg,
                    storageQtyKg:storQty||0,
                    dryingCharge: dryKg * parseFloat(g.dryingRate||0), // recalculate fresh
                    purchaseValue:purchaseValue,
                    grnType:storQty>0&&purQty>0?"both":storQty>0&&purQty===0?"storage":"purchase",
                  }});
                  setShowDryModal(null);
                  setDryForm({dryKg:"",purchaseQtyKg:"",storageQtyKg:""});
                }} variant="success" disabled={!dryKg||dryKg<=0||((purQty>0||storQty>0)&&!splitOk)}>
                  ✓ Confirm Dry Weight
                </Btn>
                <Btn onClick={()=>{setShowDryModal(null);setDryForm({dryKg:"",purchaseQtyKg:"",storageQtyKg:""}); }} variant="ghost">Cancel</Btn>
              </div>
            </div>
          </div>
        );
      })()}
      {/* Rate modal */}
      {showRateModal&&(()=>{
        const g=state.grns.find(x=>x.id===showRateModal);
        // Use dry kg if drying done, otherwise net wet weight
        const billingQty = g?.hasDrying && parseFloat(g?.dryKg||0)>0
          ? parseFloat(g.dryKg)
          : parseFloat(g?.netWeight||0);
        const qty=rateForm.rateType==="per_paka"?parseFloat(g?.totalPaka||0):billingQty;
        const val=qty*parseFloat(rateForm.rate||0);
        return(
          <div style={{position:"fixed",inset:0,background:"#00000066",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <div style={{background:C.surface,borderRadius:14,padding:"28px 32px",maxWidth:420,width:"100%",boxShadow:"0 20px 60px #00000044"}}>
              <div style={{fontWeight:800,color:C.accent,marginBottom:4,fontSize:16}}>💰 Enter Purchase Rate</div>
              <div style={{color:C.muted,fontSize:13,marginBottom:16}}>
                {g?.id} · {g?.coffeeType}
                {g?.hasDrying && parseFloat(g?.dryKg||0)>0
                  ? <span> · <strong style={{color:"#c2410c"}}>Billing on Dry: {g.dryKg} kg</strong> (Wet: {g?.netWeight} kg)</span>
                  : <span> · Net: {g?.netWeight} kg{g?.totalPaka?` · ${g.totalPaka} paka`:""}</span>}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                <Field label="Rate Type">
                  <select value={rateForm.rateType} onChange={e=>setRateForm(f=>({...f,rateType:e.target.value}))} style={sh.input}>
                    <option value="per_kg">Per KG (₹/kg)</option>
                    {isUnitType(g?.coffeeType||"")&&<option value="per_paka">Per Paka (₹/paka)</option>}
                  </select>
                </Field>
                <Field label={rateForm.rateType==="per_paka"?"Rate per Paka (₹)":"Rate per KG (₹)"}>
                  <input type="number" value={rateForm.rate} onChange={e=>setRateForm(f=>({...f,rate:e.target.value}))} placeholder="0.00" style={sh.input} autoFocus/>
                </Field>
                {val>0&&<div style={{padding:"10px 14px",background:"#f0fdf4",borderRadius:6}}>
                  <div style={{fontSize:12,color:C.muted}}>Purchase Value</div>
                  <div style={{fontFamily:"monospace",fontWeight:800,fontSize:20,color:C.green}}>{fmt(val)}</div>
                  <div style={{fontSize:11,color:C.muted,marginTop:2}}>→ Auto-posts Purchase voucher to party ledger</div>
                </div>}
              </div>
              <div style={{display:"flex",gap:10,marginTop:16}}>
                <Btn onClick={()=>submitRate(showRateModal)} variant="success" disabled={!rateForm.rate}>✓ Confirm & Post</Btn>
                <Btn onClick={()=>setShowRateModal(null)} variant="ghost">Cancel</Btn>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
        <div>
          <h2 style={{margin:0,color:C.text,fontSize:22,fontWeight:800}}>📋 GRN Register</h2>
          <p style={{margin:"2px 0 0",color:C.muted,fontSize:13}}>Goods Receipt Notes · Coffee Vel International</p>
        </div>
        {canPost&&<Btn onClick={()=>{setEditGRN(null);setShowForm(true);}} variant="success" size="lg">+ New GRN</Btn>}
      </div>

      {/* Summary cards */}
      <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
        {[
          {icon:"📋",label:"Total GRNs",    value:state.grns.length},
          {icon:"🛒",label:"Purchase",       value:state.grns.filter(g=>g.grnType==="purchase"||g.grnType==="both").length, color:C.green},
          {icon:"🏭",label:"Storage",        value:state.grns.filter(g=>g.grnType==="storage"||g.grnType==="both").length,  color:C.blue},
          {icon:"⚖️",label:"Total Net (kg)", value:state.grns.reduce((s,g)=>s+parseFloat(g.netWeight||0),0).toLocaleString("en-IN",{maximumFractionDigits:0})},
          {icon:"⏳",label:"Drying Pending",value:state.grns.filter(g=>g.hasDrying&&!g.dryKg).length,color:state.grns.filter(g=>g.hasDrying&&!g.dryKg).length>0?"#c2410c":C.muted},
          {icon:"⚠️",label:"Rate Pending",   value:pendingRate, color:pendingRate>0?C.red:C.muted},
          {icon:"🔬",label:"QC Pending",     value:pendingQC,   color:pendingQC>0?"#92400e":C.muted},
        ].map(s=>(
          <div key={s.label} style={{...sh.card,flex:1,minWidth:120}}>
            <div style={{fontSize:18,marginBottom:4}}>{s.icon}</div>
            <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:0.5}}>{s.label}</div>
            <div style={{fontFamily:"monospace",fontWeight:800,fontSize:18,color:s.color||C.accent,marginTop:4}}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm&&(
        <div style={{...sh.card,border:`2px solid ${C.accent}44`}}>
          <div style={{fontWeight:800,color:C.accent,marginBottom:16,fontSize:16}}>{editGRN?`✏ Edit GRN — ${editGRN.id}`:"📋 New Goods Receipt Note"}</div>
          <GRNForm state={state} dispatch={dispatch} initial={editGRN||undefined} editId={editGRN?.id} onDone={()=>{setShowForm(false);setEditGRN(null);}}/>
        </div>
      )}

      {/* Filters */}
      <div style={{display:"flex",gap:12,alignItems:"flex-end",flexWrap:"wrap"}}>
        <Field label="Search"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="GRN / Party / Truck…" style={{...sh.input,width:200}}/></Field>
        <Field label="Party">
          <select value={filterParty} onChange={e=>setFilterParty(e.target.value)} style={{...sh.input,width:160}}>
            <option value="all">All Parties</option>
            {Object.values(state.parties).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Type">
          <select value={filterType} onChange={e=>setFilterType(e.target.value)} style={{...sh.input,width:140}}>
            <option value="all">All</option><option value="purchase">Purchase</option>
            <option value="storage">Storage</option><option value="both">Both</option>
          </select>
        </Field>
        {(filterParty!=="all"||filterType!=="all"||search)&&<Btn variant="ghost" size="sm" onClick={()=>{setFilterParty("all");setFilterType("all");setSearch("");}}>✕ Clear</Btn>}
        <span style={{marginLeft:"auto",color:C.muted,fontSize:13,alignSelf:"flex-end"}}>{grns.length} GRN{grns.length!==1?"s":""}</span>
      </div>

      {/* Quality modal */}
      {showQuality&&(
        <div style={{position:"fixed",inset:0,background:"#00000066",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div style={{background:C.surface,borderRadius:14,padding:"24px",width:"100%",maxWidth:720,maxHeight:"90vh",overflowY:"auto",boxShadow:"0 20px 60px #00000044"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{fontWeight:800,fontSize:16,color:C.accent}}>🔬 Quality Analysis — {showQuality}</div>
              <button onClick={()=>setShowQuality(null)} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:C.muted}}>×</button>
            </div>
            <QualityForm grnId={showQuality} existing={state.grns.find(g=>g.id===showQuality)?.qualityReport} dispatch={dispatch} onDone={()=>setShowQuality(null)}/>
          </div>
        </div>
      )}

      {/* GRN List */}
      {grns.length===0?(
        <div style={{...sh.card,textAlign:"center",color:C.muted,padding:48}}>
          <div style={{fontSize:40,marginBottom:8}}>📋</div>No GRNs yet.
        </div>
      ):grns.map(g=>{
        const party   = state.parties[g.partyId];
        const expanded= expandedId===g.id;
        const hasQR   = !!g.qualityReport;
        const netWt   = parseFloat(g.netWeight||0);
        const needsQC = needsQualityForGRN(g);
        const dryDone = (g.hasDrying===true||g.hasDrying==="true") && parseFloat(g.dryKg||0)>0;
        const showQCBtn = needsQuality(g.coffeeType) || dryDone;
        const hasDry  = g.hasDrying;
        return(
          <div key={g.id} style={{...sh.card,padding:0,overflow:"hidden"}}>
            <div onClick={()=>setExpandedId(expanded?null:g.id)} style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",cursor:"pointer",background:expanded?"#fdf0e8":C.surface,flexWrap:"wrap"}}>
              <div style={{background:C.accent+"18",color:C.accent,border:`1px solid ${C.accent}33`,padding:"2px 10px",borderRadius:20,fontSize:11,fontWeight:800}}>{g.id}</div>
              <span style={{fontSize:13,color:C.muted,minWidth:90}}>{g.date}</span>
              <span style={{fontWeight:700,color:C.text,flex:1}}>{party?.name||"Unknown"}</span>
              {grnBadge(g.grnType)}
              <span style={{fontSize:12,background:"#fdf4ff",color:"#7c3aed",padding:"2px 8px",borderRadius:4,fontWeight:600}}>{g.coffeeType}</span>
              {g.inputMode==="unit"&&g.noOfUnits&&<span style={{fontSize:11,color:C.muted}}>{g.noOfUnits}u {g.noOfPaka||0}p</span>}
              <span style={{fontFamily:"monospace",fontWeight:800,color:C.green,fontSize:13}}>{netWt.toLocaleString("en-IN",{maximumFractionDigits:2})} kg</span>
              {hasDry&&!g.dryKg&&<span style={{fontSize:11,background:"#fff7ed",color:"#c2410c",padding:"2px 8px",borderRadius:10,fontWeight:700}}>⏳ Drying Pending</span>}
              {hasDry&&g.dryKg>0&&<span style={{fontSize:11,background:"#fff7ed",color:"#c2410c",padding:"2px 8px",borderRadius:10,fontWeight:700}}>🌡 {g.dryKg} kg dry</span>}
              {g.ratePending&&<span style={{fontSize:11,background:"#fef9c3",color:"#92400e",padding:"2px 8px",borderRadius:10,fontWeight:700}}>⚠ Rate Pending</span>}
              {showQCBtn&&!hasQR&&<span style={{fontSize:11,background:"#fef9c3",color:"#92400e",padding:"2px 8px",borderRadius:10,fontWeight:700}}>⚠ QC Pending</span>}
              {showQCBtn&&hasQR&&<span style={{fontSize:11,background:"#dcfce7",color:C.green,padding:"2px 8px",borderRadius:10,fontWeight:700}}>✓ QC Done</span>}
              <span style={{color:C.muted}}>{expanded?"▲":"▼"}</span>
            </div>

            {expanded&&(
              <div style={{borderTop:`1px solid ${C.border}`}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:0}}>
                  <div style={{padding:"14px 18px",borderRight:`1px solid ${C.border}`}}>
                    <div style={{fontWeight:800,color:C.accent,fontSize:12,marginBottom:8,textTransform:"uppercase"}}>⚖️ Weight</div>
                    {[["Bags",g.totalBags||g.noOfBags||"—"],["1st Wt",(g.firstWeight||0)+" kg"],["2nd Wt",(g.secondWeight||0)+" kg"],["Gross",(g.grossWeight||0)+" kg"],["Deduction",(g.rejectedBags||0)+" kg"],["Net Wt",netWt+" kg"]].map(([l,v])=>(
                      <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:`1px solid #f5ede4`,fontSize:13}}>
                        <span style={{color:C.muted}}>{l}</span>
                        <span style={{fontFamily:"monospace",fontWeight:l==="Net Wt"?800:500,color:l==="Net Wt"?C.green:C.text}}>{v}</span>
                      </div>
                    ))}
                    {g.inputMode==="unit"&&<div style={{marginTop:6,fontSize:12,color:"#7c3aed"}}>{g.noOfUnits||0} units {g.noOfPaka||0} paka = {g.totalPaka||0} paka total</div>}
                  </div>
                  <div style={{padding:"14px 18px"}}>
                    <div style={{fontWeight:800,color:C.accent,fontSize:12,marginBottom:8,textTransform:"uppercase"}}>📦 Details</div>
                    {[["Truck",g.truckNo],["Crop",g.cropSeason],["Location",g.location],["Warehouse",g.warehouse],["Zone",g.warehouseZone||"—"],["Stock No",g.stockNo||"—"]].map(([l,v])=>(
                      <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:`1px solid #f5ede4`,fontSize:13}}>
                        <span style={{color:C.muted}}>{l}</span><span>{v}</span>
                      </div>
                    ))}
                    {hasDry&&(
                      <div style={{marginTop:8,padding:"8px 10px",background:"#fff7ed",borderRadius:6}}>
                        <div style={{fontWeight:700,color:"#c2410c",fontSize:12}}>🌡 Drying → {g.outputType}</div>
                        <div style={{fontSize:12,marginTop:2}}>Dry Wt: <strong>{g.dryKg} kg</strong> · {g.dryingMethod}</div>
                        <div style={{fontSize:12}}>Price basis: <strong>{g.priceBasis==="wet"?"Wet weight":"Dry weight"}</strong></div>
                        {g.dryingCharge>0&&<div style={{fontSize:12,color:g.priceBasis==="wet"?C.red:C.green,fontWeight:600}}>
                          Drying: {g.dryKg}kg × ₹{g.dryingRate} = {fmt(g.dryingCharge)} → {g.priceBasis==="wet"?"Dr Drying A/c (company expense)":"Dr Party (billed to party)"}
                        </div>}
                      </div>
                    )}
                    {(g.grnType==="purchase"||g.grnType==="both")&&(
                      <div style={{marginTop:8,padding:"8px 10px",background:g.ratePending?"#fef9c3":"#f0fdf4",borderRadius:6}}>
                        {g.ratePending
                          ?<div style={{fontSize:12,color:"#92400e",fontWeight:700}}>⚠ Rate not yet fixed</div>
                          :<div style={{fontSize:12,color:C.green}}>₹{g.rate} {g.rateType==="per_paka"?"per paka":"per kg"} → <strong>{fmt(g.purchaseValue||0)}</strong></div>}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{padding:"10px 16px",display:"flex",gap:8,justifyContent:"flex-end",background:"#fdf8f4",flexWrap:"wrap"}}>
                  {canPost&&g.hasDrying&&!g.dryKg&&(
                    <Btn size="sm" variant="success" onClick={()=>{setShowDryModal(g.id);setDryForm({dryKg:"",purchaseQtyKg:"",storageQtyKg:""});}}>🌡 Enter Dry Quantity</Btn>
                  )}
                  {canPost&&g.ratePending&&(g.grnType==="purchase"||g.grnType==="both")&&(
                    <Btn size="sm" variant="success" onClick={()=>{setShowRateModal(g.id);setRateForm({rateType:g.rateType||"per_kg",rate:""});}}>💰 Enter Rate</Btn>
                  )}
                  {canPost&&<Btn size="sm" variant="outline" onClick={()=>{setEditGRN(g);setShowForm(true);setExpandedId(null);}}>✏ Edit</Btn>}
                  {showQCBtn&&<Btn size="sm" variant="outline" onClick={()=>setShowQuality(g.id)}>{hasQR?"🔬 Edit QC":"🔬 Add QC"}</Btn>}
                  <Btn size="sm" variant="ghost" onClick={()=>printGRN(g, state.parties[g.partyId])}>🖨 Print</Btn>
                  {canDelete&&<Btn size="sm" variant="danger" onClick={()=>setConfirmDeleteId(g.id)}>🗑 Delete</Btn>}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}


// ── MASTERS MODULE ────────────────────────────────────────────────
function MasterList({ title, icon, items, onAdd, onEdit, onDelete, usageCheck }) {
  const [newName, setNewName] = useState("");
  const [editId, setEditId]   = useState(null);
  const [editVal, setEditVal] = useState("");
  const [err, setErr]         = useState("");

  const add = async () => {
    if (!newName.trim()) return;
    setErr("");
    try { await onAdd(newName.trim()); setNewName(""); }
    catch(e) { setErr(e.message); }
  };
  const save = async () => {
    if (!editVal.trim()) return;
    try { await onEdit(editId, editVal.trim()); setEditId(null); setEditVal(""); }
    catch(e) { setErr(e.message); }
  };
  const del = async (item) => {
    const count = usageCheck ? usageCheck(item) : 0;
    if (count > 0) { setErr(`Cannot delete "${item.name}" — used in ${count} record(s)`); return; }
    setErr("");
    try { await onDelete(item.id); }
    catch(e) { setErr(e.message); }
  };

  return (
    <div style={sh.card}>
      <div style={{fontWeight:800,color:C.accent,marginBottom:14,fontSize:15}}>{icon} {title}</div>
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder={`Add new ${title.toLowerCase()}…`}
          style={{...sh.input,flex:1}} onKeyDown={e=>e.key==="Enter"&&add()}/>
        <Btn onClick={add} variant="success" size="sm">+ Add</Btn>
      </div>
      {err&&<div style={{color:C.red,fontSize:12,marginBottom:8,fontWeight:600}}>{err}</div>}
      <div style={{display:"flex",flexDirection:"column",gap:4}}>
        {items.map(item=>(
          <div key={item.id} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",background:C.cream,borderRadius:6}}>
            {editId===item.id ? (
              <>
                <input value={editVal} onChange={e=>setEditVal(e.target.value)} style={{...sh.input,flex:1}}
                  autoFocus onKeyDown={e=>{if(e.key==="Enter")save();if(e.key==="Escape"){setEditId(null);setEditVal("");}}}/>
                <Btn size="sm" variant="success" onClick={save}>✓</Btn>
                <Btn size="sm" variant="ghost" onClick={()=>{setEditId(null);setEditVal("");}}>✕</Btn>
              </>
            ) : (
              <>
                <span style={{flex:1,fontSize:13,color:C.text}}>{item.name}</span>
                <button onClick={()=>{setEditId(item.id);setEditVal(item.name);}} style={{background:"none",border:"none",cursor:"pointer",color:C.blue,fontSize:12,fontWeight:600}}>✏ Edit</button>
                <button onClick={()=>del(item)} style={{background:"none",border:"none",cursor:"pointer",color:C.red,fontSize:12,fontWeight:600}}>🗑</button>
              </>
            )}
          </div>
        ))}
        {items.length===0&&<div style={{color:C.muted,fontSize:13,textAlign:"center",padding:12}}>No items yet</div>}
      </div>
    </div>
  );
}

function MastersModule({ state, dispatch }) {
  const { warehouses, locations, coffeeTypes, grns } = state;

  const grnWarehouseCount = (item) => grns.filter(g=>g.warehouse===item.name).length;
  const grnLocationCount  = (item) => grns.filter(g=>g.location===item.name).length;
  const grnCoffeeCount    = (item) => grns.filter(g=>g.coffeeType===item.name).length;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <h2 style={{margin:0,color:C.text,fontSize:22,fontWeight:800}}>🗂 Masters</h2>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))",gap:20}}>
        <MasterList title="Warehouses" icon="🏭" items={warehouses}
          onAdd={async n=>{await dispatch({type:"ADD_WAREHOUSE",name:n});}}
          onEdit={async (id,n)=>{await dispatch({type:"EDIT_WAREHOUSE",id,name:n});}}
          onDelete={async id=>{await dispatch({type:"DELETE_WAREHOUSE",id});}}
          usageCheck={grnWarehouseCount}/>
        <MasterList title="Locations" icon="📍" items={locations}
          onAdd={async n=>{await dispatch({type:"ADD_LOCATION",name:n});}}
          onEdit={async (id,n)=>{await dispatch({type:"EDIT_LOCATION",id,name:n});}}
          onDelete={async id=>{await dispatch({type:"DELETE_LOCATION",id});}}
          usageCheck={grnLocationCount}/>
        <MasterList title="Coffee Types" icon="☕" items={coffeeTypes}
          onAdd={async n=>{await dispatch({type:"ADD_COFFEE_TYPE",name:n});}}
          onEdit={async (id,n)=>{await dispatch({type:"EDIT_COFFEE_TYPE",id,name:n});}}
          onDelete={async id=>{await dispatch({type:"DELETE_COFFEE_TYPE",id});}}
          usageCheck={grnCoffeeCount}/>
      </div>
    </div>
  );
}

// ── DRYING MODULE ─────────────────────────────────────────────────
function DryingModule({ state, dispatch, role }) {
  const [showForm, setShowForm] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [form, setForm] = useState({
    date:today(), partyId:"", coffeeType:"", dryingMethod:"Yard",
    wetWeight:"", dryWeight:"", ratePerKg:"", location:"", narration:"",
  });
  const [formErr, setFormErr] = useState("");

  const parties    = Object.values(state.parties).filter(p=>p.partyType==="supplier");
  const coffeeTypes= state.coffeeTypes.map(c=>c.name);
  const locations  = state.locations.map(l=>l.name);

  const set = (f,v) => setForm(p=>({...p,[f]:v}));

  const moistureLoss = () => {
    const w = parseFloat(form.wetWeight||0), d = parseFloat(form.dryWeight||0);
    return w > 0 ? ((w-d)/w*100).toFixed(1) : "0.0";
  };
  const totalCharge = () => (parseFloat(form.dryWeight||0) * parseFloat(form.ratePerKg||0)).toFixed(2);

  const submit = async () => {
    if (!form.partyId)    { setFormErr("Select a party"); return; }
    if (!form.coffeeType) { setFormErr("Select coffee type"); return; }
    if (!form.dryWeight || parseFloat(form.dryWeight)<=0) { setFormErr("Enter dry weight"); return; }
    setFormErr("");
    await dispatch({ type:"ADD_DRYING_JOB", data:{
      ...form,
      moistureLoss: parseFloat(moistureLoss()),
      totalCharge: parseFloat(totalCharge()),
    }});
    setShowForm(false);
    setForm({date:today(),partyId:"",coffeeType:"",dryingMethod:"Yard",wetWeight:"",dryWeight:"",ratePerKg:"",location:"",narration:""});
  };

  const canPost = ROLES[role]?.canPost;
  const canDelete = ROLES[role]?.canDelete;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
        <div>
          <h2 style={{margin:0,color:C.text,fontSize:22,fontWeight:800}}>🌡 Drying Register</h2>
          <p style={{margin:"2px 0 0",color:C.muted,fontSize:13}}>Yard & Mechanical Drying Jobs</p>
        </div>
        {canPost&&<Btn onClick={()=>setShowForm(true)} variant="success" size="lg">+ New Drying Job</Btn>}
      </div>

      {/* Summary */}
      <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
        {[
          {icon:"🌡",label:"Total Jobs",    value:state.dryingJobs.length},
          {icon:"💧",label:"Total Wet Wt",  value:state.dryingJobs.reduce((s,d)=>s+parseFloat(d.wetWeight||0),0).toLocaleString("en-IN",{maximumFractionDigits:1})+" kg"},
          {icon:"☀️",label:"Total Dry Wt",  value:state.dryingJobs.reduce((s,d)=>s+parseFloat(d.dryWeight||0),0).toLocaleString("en-IN",{maximumFractionDigits:1})+" kg"},
          {icon:"💰",label:"Total Charges", value:fmt(state.dryingJobs.reduce((s,d)=>s+parseFloat(d.totalCharge||0),0))},
        ].map(s=>(
          <div key={s.label} style={{...sh.card,flex:1,minWidth:140}}>
            <div style={{fontSize:20,marginBottom:4}}>{s.icon}</div>
            <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:0.5}}>{s.label}</div>
            <div style={{fontFamily:"monospace",fontWeight:800,fontSize:18,color:C.accent,marginTop:4}}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Confirm delete */}
      {confirmId&&(
        <div style={{position:"fixed",inset:0,background:"#00000066",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:C.surface,borderRadius:14,padding:"28px 32px",maxWidth:380,width:"100%",textAlign:"center",boxShadow:"0 20px 60px #00000044"}}>
            <div style={{fontSize:36,marginBottom:12}}>🗑</div>
            <div style={{fontWeight:800,fontSize:16,marginBottom:8}}>Delete Drying Job?</div>
            <div style={{fontSize:13,color:C.muted,marginBottom:20}}>The linked voucher entries will remain. Delete job record only.</div>
            <div style={{display:"flex",gap:10,justifyContent:"center"}}>
              <Btn variant="danger" onClick={async()=>{await dispatch({type:"DELETE_DRYING_JOB",id:confirmId});setConfirmId(null);}}>Yes, Delete</Btn>
              <Btn variant="ghost" onClick={()=>setConfirmId(null)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      {/* New job form */}
      {showForm&&(
        <div style={{...sh.card,border:`2px solid ${C.accent}44`}}>
          <div style={{fontWeight:800,color:C.accent,marginBottom:14,fontSize:15}}>🌡 New Drying Job</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:12}}>
            <Field label="Date"><input type="date" value={form.date} onChange={e=>set("date",e.target.value)} style={sh.input}/></Field>
            <Field label="Party">
              <select value={form.partyId} onChange={e=>set("partyId",e.target.value)} style={sh.input}>
                <option value="">— Select Party —</option>
                {parties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Coffee Type">
              <select value={form.coffeeType} onChange={e=>set("coffeeType",e.target.value)} style={sh.input}>
                <option value="">— Select Type —</option>
                {coffeeTypes.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Drying Method">
              <select value={form.dryingMethod} onChange={e=>set("dryingMethod",e.target.value)} style={sh.input}>
                <option value="Yard">Yard Drying</option>
                <option value="Mechanical">Mechanical Dryer</option>
              </select>
            </Field>
            <Field label="Location">
              <select value={form.location} onChange={e=>set("location",e.target.value)} style={sh.input}>
                <option value="">— Select Location —</option>
                {locations.map(l=><option key={l} value={l}>{l}</option>)}
              </select>
            </Field>
            <Field label="Wet Weight (kg)"><input type="number" value={form.wetWeight} onChange={e=>set("wetWeight",e.target.value)} placeholder="0" style={sh.input}/></Field>
            <Field label="Dry Weight (kg)"><input type="number" value={form.dryWeight} onChange={e=>set("dryWeight",e.target.value)} placeholder="0" style={sh.input}/></Field>
            <Field label="Rate per kg (₹)"><input type="number" value={form.ratePerKg} onChange={e=>set("ratePerKg",e.target.value)} placeholder="0.00" style={sh.input}/></Field>
            <Field label="Narration"><input value={form.narration} onChange={e=>set("narration",e.target.value)} placeholder="Optional" style={sh.input}/></Field>
          </div>
          {/* Computed fields */}
          {form.wetWeight&&form.dryWeight&&(
            <div style={{display:"flex",gap:16,marginTop:14,padding:"12px 16px",background:C.cream,borderRadius:8,flexWrap:"wrap"}}>
              <div><span style={{fontSize:12,color:C.muted}}>Moisture Loss: </span><strong>{moistureLoss()}%</strong></div>
              <div><span style={{fontSize:12,color:C.muted}}>Total Charge: </span><strong style={{color:C.green,fontFamily:"monospace"}}>{fmt(totalCharge())}</strong></div>
              <div style={{fontSize:12,color:C.muted}}>→ Auto-creates receipt voucher for drying charges</div>
            </div>
          )}
          {formErr&&<div style={{color:C.red,fontSize:13,fontWeight:600,marginTop:10,padding:"8px",background:"#fee2e2",borderRadius:6}}>{formErr}</div>}
          <div style={{display:"flex",gap:10,marginTop:14}}>
            <Btn onClick={submit} variant="success" size="lg">✓ Save Drying Job</Btn>
            <Btn onClick={()=>{setShowForm(false);setFormErr("");}} variant="ghost">Cancel</Btn>
          </div>
        </div>
      )}

      {/* Jobs list */}
      {state.dryingJobs.length===0?(
        <div style={{...sh.card,textAlign:"center",color:C.muted,padding:48}}>
          <div style={{fontSize:36,marginBottom:8}}>🌡</div>No drying jobs recorded yet.
        </div>
      ):state.dryingJobs.map(job=>{
        const party = state.parties[job.partyId];
        return(
          <div key={job.id} style={{...sh.card}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8}}>
              <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
                <span style={{background:C.accent+"18",color:C.accent,border:`1px solid ${C.accent}33`,padding:"2px 10px",borderRadius:20,fontSize:11,fontWeight:800}}>{job.id}</span>
                <span style={{fontSize:13,color:C.muted}}>{job.date}</span>
                <span style={{fontWeight:700,color:C.text}}>{party?.name||"—"}</span>
                <span style={{fontSize:12,background:"#eff6ff",color:C.blue,padding:"2px 8px",borderRadius:4}}>{job.coffeeType}</span>
                <span style={{fontSize:12,color:C.muted}}>{job.dryingMethod} Drying</span>
                {job.location&&<span style={{fontSize:12,color:C.muted}}>📍 {job.location}</span>}
              </div>
              <div style={{display:"flex",gap:16,alignItems:"center"}}>
                <div style={{textAlign:"right"}}>
                  <div style={{fontFamily:"monospace",fontWeight:800,fontSize:18,color:C.green}}>{fmt(job.totalCharge||0)}</div>
                  <div style={{fontSize:11,color:C.muted}}>Drying Charges</div>
                </div>
                {canDelete&&<Btn size="sm" variant="danger" onClick={()=>setConfirmId(job.id)}>🗑</Btn>}
              </div>
            </div>
            <div style={{display:"flex",gap:24,marginTop:12,padding:"10px 0",borderTop:`1px solid ${C.border}`,flexWrap:"wrap"}}>
              {[
                ["Wet Weight", (job.wetWeight||0)+" kg"],
                ["Dry Weight", (job.dryWeight||0)+" kg"],
                ["Moisture Loss", (job.moistureLoss||0)+"%"],
                ["Rate/kg", fmt(job.ratePerKg||0)],
              ].map(([l,v])=>(
                <div key={l}><div style={{fontSize:11,color:C.muted}}>{l}</div><div style={{fontWeight:700,fontSize:13}}>{v}</div></div>
              ))}
            </div>
            {job.narration&&<div style={{fontSize:12,color:C.muted,marginTop:6,fontStyle:"italic"}}>{job.narration}</div>}
          </div>
        );
      })}
    </div>
  );
}

// ── STORAGE MODULE ────────────────────────────────────────────────
function StorageModule({ state, dispatch, role }) {
  const [showForm, setShowForm]       = useState(false);
  const [showRelease, setShowRelease] = useState(null); // lotId
  const [confirmId, setConfirmId]     = useState(null);
  const [filter, setFilter]           = useState("all"); // all | stored | released
  const [form, setForm] = useState({
    date:today(), partyId:"", coffeeType:"", quantity:"", unit:"kg",
    location:"", warehouse:"", stockNo:"", narration:"",
  });
  const [releaseForm, setReleaseForm] = useState({
    date:today(), quantityReleased:"", storageChargePerKg:"", dryingChargePerKg:"", narration:"",
  });
  const [formErr, setFormErr] = useState("");

  const parties    = Object.values(state.parties);
  const coffeeTypes= state.coffeeTypes.map(c=>c.name);
  const locations  = state.locations.map(l=>l.name);
  const warehouses = state.warehouses.map(w=>w.name);

  const set  = (f,v)=>setForm(p=>({...p,[f]:v}));
  const setR = (f,v)=>setReleaseForm(p=>({...p,[f]:v}));

  const canPost   = ROLES[role]?.canPost;
  const canDelete = ROLES[role]?.canDelete;

  const filteredLots = state.storageLots.filter(l=>filter==="all"||l.status===filter);

  const getLotReleased = (lotId) => state.storageReleases.filter(r=>r.lotId===lotId).reduce((s,r)=>s+parseFloat(r.quantityReleased||0),0);

  const submitLot = async () => {
    if (!form.partyId)  { setFormErr("Select a party"); return; }
    if (!form.coffeeType){ setFormErr("Select coffee type"); return; }
    if (!form.quantity || parseFloat(form.quantity)<=0) { setFormErr("Enter quantity"); return; }
    setFormErr("");
    await dispatch({ type:"ADD_STORAGE_LOT", data:{ ...form, status:"stored" } });
    setShowForm(false);
    setForm({date:today(),partyId:"",coffeeType:"",quantity:"",unit:"kg",location:"",warehouse:"",stockNo:"",narration:""});
  };

  const submitRelease = async (lot) => {
    const qty = parseFloat(releaseForm.quantityReleased||0);
    if (qty<=0) { setFormErr("Enter quantity to release"); return; }
    const remaining = parseFloat(lot.quantity||0) - getLotReleased(lot.id);
    if (qty > remaining) { setFormErr(`Cannot release more than remaining ${remaining} kg`); return; }
    const storCharge = qty * parseFloat(releaseForm.storageChargePerKg||0);
    const dryCharge  = qty * parseFloat(releaseForm.dryingChargePerKg||0);
    const totalCharge = storCharge + dryCharge;
    setFormErr("");
    await dispatch({ type:"RELEASE_STORAGE", data:{
      lotId:lot.id, partyId:lot.partyId, date:releaseForm.date,
      quantityReleased:qty, storageChargePerKg:parseFloat(releaseForm.storageChargePerKg||0),
      dryingChargePerKg:parseFloat(releaseForm.dryingChargePerKg||0), totalCharge,
      narration:releaseForm.narration,
    }});
    setShowRelease(null);
    setReleaseForm({date:today(),quantityReleased:"",storageChargePerKg:"",dryingChargePerKg:"",narration:""});
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
        <div>
          <h2 style={{margin:0,color:C.text,fontSize:22,fontWeight:800}}>🏭 Party Storage Register</h2>
          <p style={{margin:"2px 0 0",color:C.muted,fontSize:13}}>Coffee received for storage & drying on behalf of parties</p>
        </div>
        {canPost&&<Btn onClick={()=>setShowForm(true)} variant="success" size="lg">+ New Storage Lot</Btn>}
      </div>

      {/* Summary */}
      <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
        {[
          {icon:"🏭",label:"Total Lots",   value:state.storageLots.length},
          {icon:"📦",label:"Stored",        value:state.storageLots.filter(l=>l.status==="stored").length,        color:C.blue},
          {icon:"⚡",label:"Part. Released",value:state.storageLots.filter(l=>l.status==="partially_released").length, color:C.gold},
          {icon:"✅",label:"Released",      value:state.storageLots.filter(l=>l.status==="released").length,      color:C.green},
        ].map(s=>(
          <div key={s.label} style={{...sh.card,flex:1,minWidth:130}}>
            <div style={{fontSize:20,marginBottom:4}}>{s.icon}</div>
            <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:0.5}}>{s.label}</div>
            <div style={{fontFamily:"monospace",fontWeight:800,fontSize:20,color:s.color||C.accent,marginTop:4}}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Confirm delete */}
      {confirmId&&(
        <div style={{position:"fixed",inset:0,background:"#00000066",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:C.surface,borderRadius:14,padding:"28px 32px",maxWidth:380,width:"100%",textAlign:"center",boxShadow:"0 20px 60px #00000044"}}>
            <div style={{fontSize:36,marginBottom:12}}>🗑</div>
            <div style={{fontWeight:800,fontSize:16,marginBottom:8}}>Delete Storage Lot?</div>
            <div style={{fontSize:13,color:C.muted,marginBottom:20}}>This will remove the lot record. Release records will remain.</div>
            <div style={{display:"flex",gap:10,justifyContent:"center"}}>
              <Btn variant="danger" onClick={async()=>{await dispatch({type:"DELETE_STORAGE_LOT",id:confirmId});setConfirmId(null);}}>Yes, Delete</Btn>
              <Btn variant="ghost" onClick={()=>setConfirmId(null)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Release modal */}
      {showRelease&&(()=>{
        const lot = state.storageLots.find(l=>l.id===showRelease);
        if(!lot) return null;
        const released = getLotReleased(lot.id);
        const remaining = parseFloat(lot.quantity||0) - released;
        const party = state.parties[lot.partyId];
        const qty = parseFloat(releaseForm.quantityReleased||0);
        const totalCharge = qty*(parseFloat(releaseForm.storageChargePerKg||0)+parseFloat(releaseForm.dryingChargePerKg||0));
        return(
          <div style={{position:"fixed",inset:0,background:"#00000066",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
            <div style={{background:C.surface,borderRadius:14,padding:"24px",width:"100%",maxWidth:480,boxShadow:"0 20px 60px #00000044"}}>
              <div style={{fontWeight:800,color:C.accent,marginBottom:4,fontSize:16}}>📤 Release Coffee — {lot.id}</div>
              <div style={{color:C.muted,fontSize:13,marginBottom:16}}>{party?.name} · {lot.coffeeType} · Remaining: <strong>{remaining} kg</strong></div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <Field label="Release Date"><input type="date" value={releaseForm.date} onChange={e=>setR("date",e.target.value)} style={sh.input}/></Field>
                <Field label={`Qty to Release (max ${remaining} kg)`}><input type="number" value={releaseForm.quantityReleased} onChange={e=>setR("quantityReleased",e.target.value)} placeholder="0" style={sh.input}/></Field>
                <Field label="Storage Charge/kg (₹)"><input type="number" value={releaseForm.storageChargePerKg} onChange={e=>setR("storageChargePerKg",e.target.value)} placeholder="0.00" style={sh.input}/></Field>
                <Field label="Drying Charge/kg (₹)"><input type="number" value={releaseForm.dryingChargePerKg} onChange={e=>setR("dryingChargePerKg",e.target.value)} placeholder="0.00" style={sh.input}/></Field>
                <Field label="Narration" style={{gridColumn:"span 2"}}><input value={releaseForm.narration} onChange={e=>setR("narration",e.target.value)} placeholder="Optional" style={sh.input}/></Field>
              </div>
              {qty>0&&<div style={{marginTop:12,padding:"10px 14px",background:C.cream,borderRadius:8,fontSize:13}}>
                Total Charges: <strong style={{color:C.green,fontFamily:"monospace"}}>{fmt(totalCharge)}</strong>
                {totalCharge>0&&<span style={{color:C.muted,marginLeft:8}}>→ Auto-creates receipt voucher</span>}
              </div>}
              {formErr&&<div style={{color:C.red,fontSize:13,fontWeight:600,marginTop:8,padding:"8px",background:"#fee2e2",borderRadius:6}}>{formErr}</div>}
              <div style={{display:"flex",gap:10,marginTop:16}}>
                <Btn onClick={()=>submitRelease(lot)} variant="success">✓ Release</Btn>
                <Btn onClick={()=>{setShowRelease(null);setFormErr("");}} variant="ghost">Cancel</Btn>
              </div>
            </div>
          </div>
        );
      })()}

      {/* New lot form */}
      {showForm&&(
        <div style={{...sh.card,border:`2px solid ${C.accent}44`}}>
          <div style={{fontWeight:800,color:C.accent,marginBottom:14,fontSize:15}}>🏭 New Storage Lot</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:12}}>
            <Field label="Date"><input type="date" value={form.date} onChange={e=>set("date",e.target.value)} style={sh.input}/></Field>
            <Field label="Party">
              <select value={form.partyId} onChange={e=>set("partyId",e.target.value)} style={sh.input}>
                <option value="">— Select Party —</option>
                {parties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Coffee Type">
              <select value={form.coffeeType} onChange={e=>set("coffeeType",e.target.value)} style={sh.input}>
                <option value="">— Select Type —</option>
                {coffeeTypes.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Quantity (kg)"><input type="number" value={form.quantity} onChange={e=>set("quantity",e.target.value)} placeholder="0" style={sh.input}/></Field>
            <Field label="Location">
              <select value={form.location} onChange={e=>set("location",e.target.value)} style={sh.input}>
                <option value="">— Select Location —</option>
                {locations.map(l=><option key={l} value={l}>{l}</option>)}
              </select>
            </Field>
            <Field label="Warehouse">
              <select value={form.warehouse} onChange={e=>set("warehouse",e.target.value)} style={sh.input}>
                <option value="">— Select Warehouse —</option>
                {warehouses.map(w=><option key={w} value={w}>{w}</option>)}
              </select>
            </Field>
            <Field label="Stock No."><input value={form.stockNo} onChange={e=>set("stockNo",e.target.value)} placeholder="Optional" style={sh.input}/></Field>
            <Field label="Narration"><input value={form.narration} onChange={e=>set("narration",e.target.value)} placeholder="Optional" style={sh.input}/></Field>
          </div>
          {formErr&&<div style={{color:C.red,fontSize:13,fontWeight:600,marginTop:10,padding:"8px",background:"#fee2e2",borderRadius:6}}>{formErr}</div>}
          <div style={{display:"flex",gap:10,marginTop:14}}>
            <Btn onClick={submitLot} variant="success" size="lg">✓ Save Storage Lot</Btn>
            <Btn onClick={()=>{setShowForm(false);setFormErr("");}} variant="ghost">Cancel</Btn>
          </div>
        </div>
      )}

      {/* Filter */}
      <div style={{display:"flex",gap:8}}>
        {[["all","All"],["stored","Stored"],["partially_released","Part. Released"],["released","Released"]].map(([v,l])=>(
          <button key={v} onClick={()=>setFilter(v)} style={{padding:"5px 14px",borderRadius:20,border:`1px solid ${filter===v?C.accent:C.border}`,background:filter===v?C.accent:"transparent",color:filter===v?"#fff":C.muted,fontWeight:600,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>{l}</button>
        ))}
        <span style={{marginLeft:"auto",color:C.muted,fontSize:13,alignSelf:"center"}}>{filteredLots.length} lot{filteredLots.length!==1?"s":""}</span>
      </div>

      {/* Lots list */}
      {filteredLots.length===0?(
        <div style={{...sh.card,textAlign:"center",color:C.muted,padding:48}}>
          <div style={{fontSize:36,marginBottom:8}}>🏭</div>No storage lots yet.
        </div>
      ):filteredLots.map(lot=>{
        const party    = state.parties[lot.partyId];
        const released = getLotReleased(lot.id);
        const remaining= parseFloat(lot.quantity||0) - released;
        const releases = state.storageReleases.filter(r=>r.lotId===lot.id);
        const statusColors = {stored:"#3b82f6",partially_released:"#f59e0b",released:"#15803d"};
        const statusLabels = {stored:"🔵 Stored",partially_released:"🟡 Part. Released",released:"✅ Released"};
        return(
          <div key={lot.id} style={{...sh.card}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8}}>
              <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
                <span style={{background:C.accent+"18",color:C.accent,border:`1px solid ${C.accent}33`,padding:"2px 10px",borderRadius:20,fontSize:11,fontWeight:800}}>{lot.id}</span>
                <span style={{fontSize:13,color:C.muted}}>{lot.date}</span>
                <span style={{fontWeight:700,color:C.text}}>{party?.name||"—"}</span>
                <span style={{fontSize:12,background:"#eff6ff",color:C.blue,padding:"2px 8px",borderRadius:4}}>{lot.coffeeType}</span>
                <span style={{fontSize:11,color:statusColors[lot.status],fontWeight:700}}>{statusLabels[lot.status]}</span>
              </div>
              <div style={{display:"flex",gap:12,alignItems:"center"}}>
                <div style={{textAlign:"right"}}>
                  <div style={{fontFamily:"monospace",fontWeight:800,fontSize:16,color:C.accent}}>{parseFloat(lot.quantity||0).toLocaleString("en-IN")} kg</div>
                  <div style={{fontSize:11,color:C.muted}}>Remaining: <strong style={{color:remaining>0?C.blue:C.green}}>{remaining.toLocaleString("en-IN")} kg</strong></div>
                </div>
                {canPost&&lot.status!=="released"&&<Btn size="sm" variant="outline" onClick={()=>{setShowRelease(lot.id);setFormErr("");}}>📤 Release</Btn>}
                {canDelete&&<Btn size="sm" variant="danger" onClick={()=>setConfirmId(lot.id)}>🗑</Btn>}
              </div>
            </div>
            <div style={{display:"flex",gap:16,marginTop:8,fontSize:12,color:C.muted,flexWrap:"wrap"}}>
              {lot.warehouse&&<span>🏭 {lot.warehouse}</span>}
              {lot.location&&<span>📍 {lot.location}</span>}
              {lot.stockNo&&<span>Stock: {lot.stockNo}</span>}
            </div>
            {releases.length>0&&(
              <div style={{marginTop:12,borderTop:`1px solid ${C.border}`,paddingTop:10}}>
                <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:6,textTransform:"uppercase"}}>Release History</div>
                {releases.map(r=>(
                  <div key={r.id} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid #f5ede4`,fontSize:12}}>
                    <span style={{color:C.muted}}>{r.date} · {r.id}</span>
                    <span>{parseFloat(r.quantityReleased||0)} kg</span>
                    <span style={{color:C.green,fontFamily:"monospace",fontWeight:700}}>{fmt(r.totalCharge||0)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── HULLING & GRADING MODULE ──────────────────────────────────────
// Grade keys: outturn (bulk), then individual grades, then husk is auto
const HULL_GRADES = ["gradeAAA","gradeAA","gradeA","gradeB","gradeC","gradePB","gradeBBB","gradeBits","gradeIDB"];
const HULL_GRADE_LABELS = {
  gradeAAA:"Sc.19 AAA", gradeAA:"Sc.18 AA", gradeA:"Sc.17 A",
  gradeB:"Sc.15 B",   gradeC:"Sc.14 C",  gradePB:"PB (Peaberry)",
  gradeBBB:"BBB",     gradeBits:"Bits",   gradeIDB:"IDB",
};
// Stock item names for grades
const HULL_GRADE_STOCK = {
  gradeAAA:"Grade AAA", gradeAA:"Grade AA", gradeA:"Grade A",
  gradeB:"Grade B",     gradeC:"Grade C",   gradePB:"Grade PB",
  gradeBBB:"Grade BBB", gradeBits:"Bits",   gradeIDB:"Grade IDB",
};

function HullingModule({ state, dispatch, role }) {
  const [showForm, setShowForm]   = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [form, setForm] = useState({
    date:today(), grnId:"", partyId:"", coffeeType:"Parchment",
    inputQty:"", outturnPct:"", curingRate:"", ownership:"own",
    gradeAAA:"", gradeAA:"", gradeA:"", gradeB:"", gradeC:"",
    gradePB:"", gradeBBB:"", gradeBits:"", gradeIDB:"",
    narration:"",
  });
  const [err, setErr] = useState("");

  const canPost   = ROLES[role]?.canPost;
  const canDelete = ROLES[role]?.canDelete;
  const set = (f,v) => setForm(p=>({...p,[f]:v}));

  // GRNs eligible for hulling
  const eligibleGRNs = state.grns.filter(g => {
    const isDryOutput = (g.hasDrying===true||g.hasDrying==="true") && parseFloat(g.dryKg||0)>0;
    if (isDryOutput && (g.outputType==="Parchment"||g.outputType==="Dry Cherry")) return true;
    if (g.coffeeType==="Parchment"||g.coffeeType==="Dry Cherry") return true;
    return false;
  });

  const selectedGRN   = state.grns.find(g=>g.id===form.grnId);
  const alreadyHulled = state.hullingJobs.filter(h=>h.grnId===form.grnId).reduce((s,h)=>s+parseFloat(h.inputQty||0),0);
  const availableQty  = selectedGRN
    ? (parseFloat(selectedGRN.dryKg||0)>0 ? parseFloat(selectedGRN.dryKg) : parseFloat(selectedGRN.netWeight||0)) - alreadyHulled
    : 0;

  const inputQty     = parseFloat(form.inputQty||0);
  const outturnPct   = parseFloat(form.outturnPct||0);
  const bulkKg       = inputQty>0&&outturnPct>0 ? +(inputQty*outturnPct/100).toFixed(2) : 0;
  const huskKg       = inputQty>0&&bulkKg>0 ? +(inputQty-bulkKg).toFixed(2) : 0;
  const curingCharge = +(inputQty * parseFloat(form.curingRate||0)).toFixed(2);
  const gradeTotal   = HULL_GRADES.reduce((s,g)=>s+parseFloat(form[g]||0),0);
  const gradeOk      = bulkKg>0 && Math.abs(gradeTotal-bulkKg)<1;

  // QC predicted outturn for comparison
  const qcOutturn = selectedGRN?.qualityReport?.outturn;

  const submit = () => {
    if (!form.grnId)       { setErr("Select a GRN"); return; }
    if (!inputQty||inputQty<=0)     { setErr("Enter input quantity"); return; }
    if (inputQty > availableQty+0.5){ setErr(`Only ${availableQty.toFixed(2)} kg available from this GRN`); return; }
    if (!outturnPct||outturnPct<=0) { setErr("Enter outturn %"); return; }
    if (outturnPct>100)             { setErr("Outturn % cannot exceed 100"); return; }
    if (!gradeOk)                   { setErr(`Grade total (${gradeTotal.toFixed(2)} kg) must equal bulk/outturn (${bulkKg} kg)`); return; }
    if (form.ownership==="party"&&!form.partyId) { setErr("Select party"); return; }
    setErr("");
    dispatch({type:"ADD_HULLING_JOB", data:{
      ...form,
      coffeeType: selectedGRN?.outputType||selectedGRN?.coffeeType||form.coffeeType,
      inputQty, outturnPct, bulkKg, huskKg, curingCharge,
      gradeAAA:parseFloat(form.gradeAAA||0), gradeAA:parseFloat(form.gradeAA||0),
      gradeA:parseFloat(form.gradeA||0),   gradeB:parseFloat(form.gradeB||0),
      gradeC:parseFloat(form.gradeC||0),   gradePB:parseFloat(form.gradePB||0),
      gradeBBB:parseFloat(form.gradeBBB||0),gradeBits:parseFloat(form.gradeBits||0),
      gradeIDB:parseFloat(form.gradeIDB||0),totalOutput:gradeTotal,
    }});
    setShowForm(false);
    setForm({date:today(),grnId:"",partyId:"",coffeeType:"Parchment",inputQty:"",outturnPct:"",curingRate:"",ownership:"own",gradeAAA:"",gradeAA:"",gradeA:"",gradeB:"",gradeC:"",gradePB:"",gradeBBB:"",gradeBits:"",gradeIDB:"",narration:""});
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      {confirmId&&(
        <div style={{position:"fixed",inset:0,background:"#00000066",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:C.surface,borderRadius:14,padding:"28px 32px",maxWidth:380,width:"100%",textAlign:"center",boxShadow:"0 20px 60px #00000044"}}>
            <div style={{fontSize:36,marginBottom:12}}>🗑</div>
            <div style={{fontWeight:800,fontSize:17,marginBottom:8}}>Delete Hulling Job?</div>
            <div style={{fontSize:13,color:C.muted,marginBottom:20}}>Stock and curing entries will be reversed.</div>
            <div style={{display:"flex",gap:10,justifyContent:"center"}}>
              <Btn variant="danger" onClick={()=>{dispatch({type:"DELETE_HULLING_JOB",id:confirmId});setConfirmId(null);}}>Yes, Delete</Btn>
              <Btn variant="ghost" onClick={()=>setConfirmId(null)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
        <div>
          <h2 style={{margin:0,color:C.text,fontSize:22,fontWeight:800}}>⚙️ Hulling & Grading</h2>
          <p style={{margin:"2px 0 0",color:C.muted,fontSize:13}}>Parchment / Dry Cherry → Outturn → Coffee Grades</p>
        </div>
        {canPost&&<Btn onClick={()=>setShowForm(true)} variant="success" size="lg">+ New Hulling Job</Btn>}
      </div>

      {/* Summary */}
      <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
        {[
          {icon:"⚙️",label:"Total Jobs",  value:state.hullingJobs.length},
          {icon:"📦",label:"Total Input", value:state.hullingJobs.reduce((s,h)=>s+parseFloat(h.inputQty||0),0).toLocaleString("en-IN",{maximumFractionDigits:0})+" kg"},
          {icon:"☕",label:"Total Bulk",  value:state.hullingJobs.reduce((s,h)=>s+parseFloat(h.bulkKg||0),0).toLocaleString("en-IN",{maximumFractionDigits:0})+" kg"},
          {icon:"💰",label:"Curing Income",value:fmt(state.hullingJobs.reduce((s,h)=>s+parseFloat(h.curingCharge||0),0))},
        ].map(s=>(
          <div key={s.label} style={{...sh.card,flex:1,minWidth:130}}>
            <div style={{fontSize:18,marginBottom:4}}>{s.icon}</div>
            <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:0.5}}>{s.label}</div>
            <div style={{fontFamily:"monospace",fontWeight:800,fontSize:18,color:s.color||C.accent,marginTop:4}}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm&&(
        <div style={{...sh.card,border:`2px solid ${C.accent}44`}}>
          <div style={{fontWeight:800,color:C.accent,marginBottom:16,fontSize:16}}>⚙️ New Hulling Job</div>
          <div style={{display:"flex",flexDirection:"column",gap:16}}>

            {/* Header */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:12}}>
              <Field label="Date"><input type="date" value={form.date} onChange={e=>set("date",e.target.value)} style={sh.input}/></Field>
              <Field label="Select GRN *">
                <select value={form.grnId} onChange={e=>{
                  const g=state.grns.find(x=>x.id===e.target.value);
                  set("grnId",e.target.value);
                  if(g){set("partyId",g.partyId);set("coffeeType",g.outputType||g.coffeeType);}
                }} style={{...sh.input,borderColor:!form.grnId?"#f97316":C.border}}>
                  <option value="">— Select GRN —</option>
                  {eligibleGRNs.map(g=>{
                    const party=state.parties[g.partyId];
                    const ct=g.outputType||g.coffeeType;
                    const avail=(parseFloat(g.dryKg||0)>0?parseFloat(g.dryKg):parseFloat(g.netWeight||0))-
                      state.hullingJobs.filter(h=>h.grnId===g.id).reduce((s,h)=>s+parseFloat(h.inputQty||0),0);
                    if(avail<=0) return null;
                    return <option key={g.id} value={g.id}>{g.id} · {party?.name||"?"} · {ct} · {avail.toFixed(0)} kg</option>;
                  }).filter(Boolean)}
                </select>
              </Field>
              <Field label="Ownership">
                <select value={form.ownership} onChange={e=>set("ownership",e.target.value)} style={sh.input}>
                  <option value="own">Our Coffee → Dr Curing Expense, Cr Curing Income</option>
                  <option value="party">Party Coffee → Dr Party, Cr Curing Income</option>
                </select>
              </Field>
              {form.ownership==="party"&&(
                <Field label="Party">
                  <select value={form.partyId} onChange={e=>set("partyId",e.target.value)} style={sh.input}>
                    <option value="">— Select —</option>
                    {Object.values(state.parties).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Narration"><input value={form.narration} onChange={e=>set("narration",e.target.value)} placeholder="Optional" style={sh.input}/></Field>
            </div>

            {/* Input, Outturn, Curing */}
            {form.grnId&&(
              <div style={{border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
                <div style={{background:"#f5ede4",padding:"8px 14px",fontWeight:800,fontSize:12,color:C.accent}}>📦 INPUT & OUTTURN</div>
                <div style={{padding:"14px 16px",display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:12}}>
                  <Field label={`Input Qty (kg) — max ${availableQty.toFixed(2)} kg`}>
                    <input type="number" value={form.inputQty} onChange={e=>set("inputQty",e.target.value)}
                      placeholder="0" style={{...sh.input,borderColor:inputQty>availableQty?C.red:C.border}}/>
                  </Field>
                  <Field label="Outturn % (Bulk)">
                    <input type="number" value={form.outturnPct} onChange={e=>set("outturnPct",e.target.value)} placeholder="0.0" style={sh.input}/>
                  </Field>
                  {/* QC comparison */}
                  {qcOutturn&&outturnPct>0&&(
                    <div style={{padding:"10px 14px",background:Math.abs(outturnPct-parseFloat(qcOutturn))<2?"#f0fdf4":"#fef9c3",borderRadius:6,alignSelf:"flex-end"}}>
                      <div style={{fontSize:11,color:C.muted}}>QC Predicted Outturn</div>
                      <div style={{fontFamily:"monospace",fontWeight:800,fontSize:16,color:C.accent}}>{qcOutturn}%</div>
                      <div style={{fontSize:11,fontWeight:600,color:Math.abs(outturnPct-parseFloat(qcOutturn))<2?C.green:C.red}}>
                        Actual: {outturnPct}% ({outturnPct>parseFloat(qcOutturn)?"+":""}{(outturnPct-parseFloat(qcOutturn)).toFixed(1)}%)
                      </div>
                    </div>
                  )}
                  {bulkKg>0&&(
                    <div style={{padding:"10px 14px",background:"#f0fdf4",borderRadius:6,alignSelf:"flex-end"}}>
                      <div style={{fontSize:11,color:C.muted}}>Bulk (Coffee Rice)</div>
                      <div style={{fontFamily:"monospace",fontWeight:800,fontSize:18,color:C.green}}>{bulkKg} kg</div>
                      <div style={{fontSize:11,color:C.muted}}>Husk/Waste: {huskKg} kg</div>
                    </div>
                  )}
                  <Field label="Curing Rate (₹/kg input)">
                    <input type="number" value={form.curingRate} onChange={e=>set("curingRate",e.target.value)} placeholder="0.00" style={sh.input}/>
                  </Field>
                  {curingCharge>0&&(
                    <div style={{padding:"10px 14px",background:form.ownership==="party"?"#eff6ff":"#f0fdf4",borderRadius:6,alignSelf:"flex-end"}}>
                      <div style={{fontSize:11,color:C.muted}}>Curing Charge</div>
                      <div style={{fontFamily:"monospace",fontWeight:800,fontSize:16,color:form.ownership==="party"?C.blue:C.green}}>{fmt(curingCharge)}</div>
                      <div style={{fontSize:10,color:C.muted,marginTop:2}}>
                        {form.ownership==="party"?"Dr Party, Cr Curing Income":"Dr Curing Expense, Cr Curing Income"}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Grade outputs */}
            {bulkKg>0&&(
              <div style={{border:`2px solid ${gradeOk?"#22c55e":"#e8ddd0"}`,borderRadius:8,overflow:"hidden"}}>
                <div style={{background:"#f5ede4",padding:"8px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontWeight:800,fontSize:12,color:C.accent}}>🏷 GRADE OUTPUTS (must total {bulkKg} kg)</span>
                  <span style={{fontSize:12,fontWeight:700,color:gradeOk?C.green:C.red}}>
                    {gradeTotal.toFixed(2)} / {bulkKg} kg {gradeOk?"✓":"⚠"}
                  </span>
                </div>
                <div style={{padding:"14px 16px",display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:10}}>
                  {HULL_GRADES.map(g=>{
                    const qcKey = {gradeAAA:"sc19AAA",gradeAA:"sc18AA",gradeA:"sc17A",gradeB:"sc15B",gradeC:"sc14C",gradePB:"pb",gradeBBB:"bbb",gradeBits:"bits",gradeIDB:"idb"}[g];
                    const qcPct = selectedGRN?.qualityReport?.[qcKey];
                    const qcKg  = qcPct&&bulkKg ? (parseFloat(qcPct)/100*bulkKg).toFixed(1) : null;
                    return(
                      <Field key={g} label={HULL_GRADE_LABELS[g]}>
                        <input type="number" value={form[g]} onChange={e=>set(g,e.target.value)} placeholder="0"
                          style={{...sh.input,borderColor:parseFloat(form[g]||0)>0?C.accent:C.border}}/>
                        {qcKg&&<div style={{fontSize:10,color:C.muted,marginTop:2}}>QC predicted: {qcKg} kg ({qcPct}%)</div>}
                      </Field>
                    );
                  })}
                </div>
                {/* Auto husk */}
                <div style={{padding:"8px 16px 12px",background:"#fdf8f4",fontSize:12,color:C.muted}}>
                  Husk/Waste: <strong>{huskKg} kg</strong> (auto = input {inputQty} kg − bulk {bulkKg} kg) — not graded
                </div>
              </div>
            )}

            {err&&<div style={{color:C.red,fontWeight:700,fontSize:13,padding:"8px 12px",background:"#fee2e2",borderRadius:6}}>{err}</div>}
            <div style={{display:"flex",gap:10}}>
              <Btn onClick={submit} variant="success" size="lg">✓ Save Hulling Job</Btn>
              <Btn onClick={()=>{setShowForm(false);setErr("");}} variant="ghost">Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Jobs list */}
      {state.hullingJobs.length===0?(
        <div style={{...sh.card,textAlign:"center",color:C.muted,padding:48}}>
          <div style={{fontSize:40,marginBottom:8}}>⚙️</div>No hulling jobs yet.
        </div>
      ):state.hullingJobs.map(h=>{
        const party=state.parties[h.partyId];
        const grn=state.grns.find(g=>g.id===h.grnId);
        return(
          <div key={h.id} style={{...sh.card}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8}}>
              <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                <span style={{background:C.accent+"18",color:C.accent,border:`1px solid ${C.accent}33`,padding:"2px 10px",borderRadius:20,fontSize:11,fontWeight:800}}>{h.id}</span>
                <span style={{fontSize:13,color:C.muted}}>{h.date}</span>
                <span style={{fontWeight:700,color:C.text}}>{h.ownership==="party"?party?.name:"Own Coffee"}</span>
                <span style={{fontSize:12,background:"#fdf4ff",color:"#7c3aed",padding:"2px 8px",borderRadius:4,fontWeight:600}}>{h.coffeeType}</span>
                {h.grnId&&<span style={{fontSize:11,color:C.muted}}>← {h.grnId}</span>}
              </div>
              <div style={{display:"flex",gap:16,alignItems:"center"}}>
                <div style={{textAlign:"right"}}>
                  <div style={{fontFamily:"monospace",fontWeight:800,color:C.accent}}>{parseFloat(h.inputQty||0).toLocaleString("en-IN")} kg in → {parseFloat(h.bulkKg||0).toLocaleString("en-IN")} kg bulk ({h.outturnPct}%)</div>
                  <div style={{fontSize:12,color:C.muted}}>Husk: {parseFloat(h.huskKg||0).toLocaleString("en-IN")} kg · Curing: {fmt(h.curingCharge||0)}</div>
                </div>
                {canDelete&&<Btn size="sm" variant="danger" onClick={()=>setConfirmId(h.id)}>🗑</Btn>}
              </div>
            </div>
            {/* Grade summary */}
            <div style={{marginTop:10,display:"flex",gap:6,flexWrap:"wrap",paddingTop:8,borderTop:`1px solid ${C.border}`}}>
              {HULL_GRADES.map(g=>{
                const qty=parseFloat(h[g]||0);
                if(!qty) return null;
                return(
                  <div key={g} style={{background:C.cream,border:`1px solid ${C.border}`,borderRadius:6,padding:"4px 10px",textAlign:"center"}}>
                    <div style={{fontSize:10,fontWeight:700,color:C.accent}}>{HULL_GRADE_LABELS[g]}</div>
                    <div style={{fontFamily:"monospace",fontWeight:800,fontSize:12,color:C.green}}>{qty.toLocaleString("en-IN",{maximumFractionDigits:1})} kg</div>
                  </div>
                );
              }).filter(Boolean)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── SALES MODULE ──────────────────────────────────────────────────
function SalesModule({ state, dispatch, role }) {
  const [showForm, setShowForm]     = useState(false);
  const [confirmId, setConfirmId]   = useState(null);
  const [form, setForm] = useState({
    date:today(), buyerId:"", sourceType:"hulling", sourceId:"",
    narration:"", items:[],
  });
  const [err, setErr] = useState("");
  const canPost   = ROLES[role]?.canPost;
  const canDelete = ROLES[role]?.canDelete;
  const set = (f,v) => setForm(p=>({...p,[f]:v}));

  // Buyers = customer type parties
  const buyers = Object.values(state.parties).filter(p=>p.partyType==="customer");

  // Sources: hulling jobs or GRNs with available stock
  const hullingSources = state.hullingJobs.map(h => {
    const party = state.parties[h.partyId];
    const alreadySold = (state.sales||[]).filter(s=>s.sourceId===h.id)
      .flatMap(s=>s.items||[])
      .reduce((acc,it)=>{ acc[it.grade]=(acc[it.grade]||0)+parseFloat(it.qty||0); return acc; },{});
    const available = {};
    HULL_GRADES.forEach(g => {
      const total = parseFloat(h[g]||0);
      const sold  = alreadySold[HULL_GRADE_LABELS[g]]||0;
      if (total-sold > 0) available[HULL_GRADE_LABELS[g]] = +(total-sold).toFixed(2);
    });
    return { id:h.id, label:`${h.id} · ${party?.name||"?"} · ${h.coffeeType}`, available, type:"hulling" };
  }).filter(s=>Object.keys(s.available).length>0);

  const grnSources = state.grns.filter(g => {
    const ct = g.coffeeType;
    const isDry = (g.hasDrying===true||g.hasDrying==="true") && parseFloat(g.dryKg||0)>0;
    const isHulled = state.hullingJobs.some(h=>h.grnId===g.id);
    if (isHulled) return false; // hulled GRNs use hulling source
    if (isDry) return true; // dried output
    if (ct==="Parchment"||ct==="Dry Cherry"||ct==="Others") return true;
    return false;
  }).map(g => {
    const party = state.parties[g.partyId];
    const ct = g.outputType||g.coffeeType;
    const totalQty = parseFloat(g.dryKg||0)>0 ? parseFloat(g.dryKg) : parseFloat(g.netWeight||0);
    const soldQty = (state.sales||[]).filter(s=>s.sourceId===g.id)
      .flatMap(s=>s.items||[]).reduce((t,it)=>t+parseFloat(it.qty||0),0);
    const available = { [ct]: +(totalQty-soldQty).toFixed(2) };
    return { id:g.id, label:`${g.id} · ${party?.name||"?"} · ${ct}`, available, type:"grn" };
  }).filter(s=>Object.values(s.available).some(v=>v>0));

  const allSources = [...hullingSources, ...grnSources];
  const selectedSource = allSources.find(s=>s.id===form.sourceId);

  // Add item row
  const addItem = () => setForm(p=>({...p, items:[...p.items,{grade:"",qty:"",rateType:"per_kg",rate:"",amount:""}]}));
  const setItem = (i,f,v) => setForm(p=>({...p, items:p.items.map((it,idx)=>{
    if(idx!==i) return it;
    const upd = {...it,[f]:v};
    if (f==="qty"||f==="rate") upd.amount = (parseFloat(f==="qty"?v:upd.qty)||0)*(parseFloat(f==="rate"?v:upd.rate)||0);
    if (f==="amount"&&upd.rateType==="total") upd.rate="";
    return upd;
  })}));
  const removeItem = (i) => setForm(p=>({...p,items:p.items.filter((_,idx)=>idx!==i)}));

  const totalAmount = form.items.reduce((s,it)=>s+parseFloat(it.amount||0),0);

  const submit = () => {
    if (!form.buyerId)   { setErr("Select a buyer"); return; }
    if (!form.sourceId)  { setErr("Select source (hulling job or GRN)"); return; }
    if (!form.items.length){ setErr("Add at least one item"); return; }
    for (const it of form.items) {
      if (!it.grade)     { setErr("Select grade/type for all items"); return; }
      if (!it.qty||parseFloat(it.qty)<=0){ setErr("Enter qty for all items"); return; }
      if (!it.amount||parseFloat(it.amount)<=0){ setErr("Enter amount for all items"); return; }
      const avail = selectedSource?.available[it.grade]||0;
      if (parseFloat(it.qty)>avail+0.5){ setErr(`${it.grade}: only ${avail} kg available`); return; }
    }
    setErr("");
    dispatch({type:"ADD_SALE",data:{
      ...form,
      sourceType: selectedSource?.type||"hulling",
      totalAmount,
      items: form.items.map(it=>({...it,qty:parseFloat(it.qty),amount:parseFloat(it.amount),rate:parseFloat(it.rate||0)})),
    }});
    setShowForm(false);
    setForm({date:today(),buyerId:"",sourceType:"hulling",sourceId:"",narration:"",items:[]});
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      {confirmId&&(
        <div style={{position:"fixed",inset:0,background:"#00000066",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:C.surface,borderRadius:14,padding:"28px 32px",maxWidth:380,width:"100%",textAlign:"center",boxShadow:"0 20px 60px #00000044"}}>
            <div style={{fontSize:36,marginBottom:12}}>🗑</div>
            <div style={{fontWeight:800,fontSize:17,marginBottom:8}}>Delete Sale?</div>
            <div style={{fontSize:13,color:C.muted,marginBottom:20}}>Buyer account and sales voucher will be reversed.</div>
            <div style={{display:"flex",gap:10,justifyContent:"center"}}>
              <Btn variant="danger" onClick={()=>{dispatch({type:"DELETE_SALE",id:confirmId});setConfirmId(null);}}>Yes, Delete</Btn>
              <Btn variant="ghost" onClick={()=>setConfirmId(null)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
        <div>
          <h2 style={{margin:0,color:C.text,fontSize:22,fontWeight:800}}>🏷 Sales</h2>
          <p style={{margin:"2px 0 0",color:C.muted,fontSize:13}}>Traceable sales linked to Hulling Jobs / GRNs</p>
        </div>
        {canPost&&<Btn onClick={()=>setShowForm(true)} variant="success" size="lg">+ New Sale</Btn>}
      </div>

      {/* Summary */}
      <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
        {[
          {icon:"🏷",label:"Total Sales",   value:(state.sales||[]).length},
          {icon:"💰",label:"Total Value",   value:fmt((state.sales||[]).reduce((s,x)=>s+parseFloat(x.totalAmount||0),0))},
          {icon:"📦",label:"Total Qty",     value:(state.sales||[]).reduce((s,x)=>(x.items||[]).reduce((t,it)=>t+parseFloat(it.qty||0),s),0).toLocaleString("en-IN",{maximumFractionDigits:0})+" kg"},
        ].map(s=>(
          <div key={s.label} style={{...sh.card,flex:1,minWidth:150}}>
            <div style={{fontSize:18,marginBottom:4}}>{s.icon}</div>
            <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:0.5}}>{s.label}</div>
            <div style={{fontFamily:"monospace",fontWeight:800,fontSize:20,color:C.accent,marginTop:4}}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm&&(
        <div style={{...sh.card,border:`2px solid ${C.accent}44`}}>
          <div style={{fontWeight:800,color:C.accent,marginBottom:16,fontSize:16}}>🏷 New Sale</div>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:12}}>
              <Field label="Date"><input type="date" value={form.date} onChange={e=>set("date",e.target.value)} style={sh.input}/></Field>
              <Field label="Buyer *">
                <select value={form.buyerId} onChange={e=>set("buyerId",e.target.value)} style={{...sh.input,borderColor:!form.buyerId?"#f97316":C.border}}>
                  <option value="">— Select Buyer —</option>
                  {buyers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                  {buyers.length===0&&<option disabled>No customers — add in Parties tab</option>}
                </select>
              </Field>
              <Field label="Source (Hulling Job / GRN) *">
                <select value={form.sourceId} onChange={e=>{set("sourceId",e.target.value);set("items",[]);}} style={{...sh.input,borderColor:!form.sourceId?"#f97316":C.border}}>
                  <option value="">— Select Source —</option>
                  {hullingSources.length>0&&<optgroup label="⚙️ Hulling Jobs">
                    {hullingSources.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}
                  </optgroup>}
                  {grnSources.length>0&&<optgroup label="📋 GRNs (direct)">
                    {grnSources.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}
                  </optgroup>}
                </select>
              </Field>
              <Field label="Narration"><input value={form.narration} onChange={e=>set("narration",e.target.value)} placeholder="Optional" style={sh.input}/></Field>
            </div>

            {/* Available stock from source */}
            {selectedSource&&(
              <div style={{padding:"10px 14px",background:"#f0fdf4",borderRadius:8,fontSize:12}}>
                <div style={{fontWeight:700,color:C.green,marginBottom:6}}>Available stock from {form.sourceId}:</div>
                <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                  {Object.entries(selectedSource.available).map(([grade,qty])=>(
                    <span key={grade} style={{background:"#dcfce7",color:C.green,padding:"3px 10px",borderRadius:10,fontFamily:"monospace",fontWeight:700}}>
                      {grade}: {qty.toLocaleString("en-IN")} kg
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Items */}
            {selectedSource&&(
              <div style={{border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
                <div style={{background:"#f5ede4",padding:"8px 14px",fontWeight:800,fontSize:12,color:C.accent}}>🏷 SALE ITEMS</div>
                <div style={{padding:"12px 14px",display:"flex",flexDirection:"column",gap:8}}>
                  {form.items.map((it,i)=>(
                    <div key={i} style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr auto",gap:8,alignItems:"end"}}>
                      <Field label={i===0?"Grade / Type":""}>
                        <select value={it.grade} onChange={e=>setItem(i,"grade",e.target.value)} style={sh.input}>
                          <option value="">— Select —</option>
                          {Object.entries(selectedSource.available).map(([g,avail])=>(
                            <option key={g} value={g}>{g} ({avail} kg avail)</option>
                          ))}
                        </select>
                      </Field>
                      <Field label={i===0?"Qty (kg)":""}>
                        <input type="number" value={it.qty} onChange={e=>setItem(i,"qty",e.target.value)} placeholder="0" style={sh.input}/>
                      </Field>
                      <Field label={i===0?"Rate Type":""}>
                        <select value={it.rateType} onChange={e=>setItem(i,"rateType",e.target.value)} style={sh.input}>
                          <option value="per_kg">Per kg</option>
                          <option value="total">Total value</option>
                        </select>
                      </Field>
                      <Field label={i===0?"Rate (₹)":""}>
                        <input type="number" value={it.rate} onChange={e=>setItem(i,"rate",e.target.value)} placeholder="0.00" style={sh.input} disabled={it.rateType==="total"}/>
                      </Field>
                      <Field label={i===0?"Amount (₹)":""}>
                        <input type="number" value={it.amount} onChange={e=>setItem(i,"amount",e.target.value)} placeholder="0.00" style={sh.input}/>
                      </Field>
                      <button onClick={()=>removeItem(i)} style={{background:C.red,color:"#fff",border:"none",borderRadius:6,padding:"8px 10px",cursor:"pointer",alignSelf:"flex-end",marginBottom:1}}>✕</button>
                    </div>
                  ))}
                  <Btn onClick={addItem} variant="outline" size="sm">+ Add Item</Btn>
                  {form.items.length>0&&(
                    <div style={{padding:"10px 14px",background:"#f0fdf4",borderRadius:6,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span style={{fontWeight:700}}>Total Sale Value</span>
                      <span style={{fontFamily:"monospace",fontWeight:800,fontSize:18,color:C.green}}>{fmt(totalAmount)}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {err&&<div style={{color:C.red,fontWeight:700,fontSize:13,padding:"8px 12px",background:"#fee2e2",borderRadius:6}}>{err}</div>}
            <div style={{display:"flex",gap:10}}>
              <Btn onClick={submit} variant="success" size="lg">✓ Save Sale</Btn>
              <Btn onClick={()=>{setShowForm(false);setErr("");}} variant="ghost">Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Sales list */}
      {(state.sales||[]).length===0?(
        <div style={{...sh.card,textAlign:"center",color:C.muted,padding:48}}>
          <div style={{fontSize:40,marginBottom:8}}>🏷</div>No sales recorded yet.
        </div>
      ):(state.sales||[]).map(sale=>{
        const buyer  = state.parties[sale.buyerId];
        const source = allSources.find(s=>s.id===sale.sourceId)||{label:sale.sourceId};
        return(
          <div key={sale.id} style={{...sh.card}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8}}>
              <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                <span style={{background:C.accent+"18",color:C.accent,border:`1px solid ${C.accent}33`,padding:"2px 10px",borderRadius:20,fontSize:11,fontWeight:800}}>{sale.id}</span>
                <span style={{fontSize:13,color:C.muted}}>{sale.date}</span>
                <span style={{fontWeight:700,color:C.text}}>{buyer?.name||"Unknown"}</span>
                <span style={{fontSize:11,color:C.muted}}>← {sale.sourceId}</span>
                {sale.narration&&<span style={{fontSize:12,color:C.muted,fontStyle:"italic"}}>{sale.narration}</span>}
              </div>
              <div style={{display:"flex",gap:12,alignItems:"center"}}>
                <div style={{textAlign:"right"}}>
                  <div style={{fontFamily:"monospace",fontWeight:800,fontSize:18,color:C.green}}>{fmt(sale.totalAmount||0)}</div>
                  <div style={{fontSize:11,color:C.muted}}>{(sale.items||[]).reduce((s,it)=>s+parseFloat(it.qty||0),0).toLocaleString("en-IN")} kg total</div>
                </div>
                {canDelete&&<Btn size="sm" variant="danger" onClick={()=>setConfirmId(sale.id)}>🗑</Btn>}
              </div>
            </div>
            <div style={{marginTop:10,display:"flex",gap:6,flexWrap:"wrap",paddingTop:8,borderTop:`1px solid ${C.border}`}}>
              {(sale.items||[]).map((it,i)=>(
                <div key={i} style={{background:C.cream,border:`1px solid ${C.border}`,borderRadius:6,padding:"4px 12px",fontSize:12}}>
                  <span style={{fontWeight:700,color:C.accent}}>{it.grade}</span>
                  <span style={{color:C.muted,margin:"0 4px"}}>·</span>
                  <span style={{fontFamily:"monospace",fontWeight:600}}>{parseFloat(it.qty||0).toLocaleString("en-IN")} kg</span>
                  {it.rate>0&&<span style={{color:C.muted,marginLeft:4}}>@ ₹{it.rate}/kg</span>}
                  <span style={{color:C.green,marginLeft:4,fontFamily:"monospace",fontWeight:700}}>{fmt(it.amount||0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── STOCK TRANSFER MODULE ─────────────────────────────────────────
function StockTransferModule({ state, dispatch, role, currentUser }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState({date:today(),grnId:"",qty:"",bags:"",narration:""});
  const [err, setErr]           = useState("");
  const isBranch   = role==="branch";
  const userLoc    = currentUser?.location||"hq";
  const canPost    = ROLES[role]?.canPost;
  const canDelete  = ROLES[role]?.canDelete;
  const set = (f,v) => setForm(p=>({...p,[f]:v}));

  // Branch sees GRNs from their location not yet transferred
  const transferredGrnIds = new Set((state.transfers||[]).map(t=>t.grnId));
  const eligibleGRNs = state.grns.filter(g => {
    if (isBranch && (g.location||"hq")!==userLoc) return false;
    if (transferredGrnIds.has(g.id)) return false;
    return true;
  });

  const selectedGRN   = state.grns.find(g=>g.id===form.grnId);
  const maxQty        = selectedGRN ? parseFloat(selectedGRN.dryKg||selectedGRN.netWeight||0) : 0;

  const submit = () => {
    if (!form.grnId)               { setErr("Select a GRN"); return; }
    if (!form.qty||parseFloat(form.qty)<=0){ setErr("Enter transfer weight (kg)"); return; }
    if (parseFloat(form.qty)>maxQty+0.5){ setErr(`Only ${maxQty} kg available`); return; }
    setErr("");
    dispatch({type:"ADD_TRANSFER",data:{
      date:form.date,
      grnId:form.grnId,
      fromLocation:userLoc,
      toLocation:"hq",
      coffeeType:selectedGRN?.outputType||selectedGRN?.coffeeType,
      weightKg:parseFloat(form.qty),
      bags:parseInt(form.bags||0),
      narration:form.narration,
      raisedBy:currentUser?.name,
    }});
    setShowForm(false);
    setForm({date:today(),grnId:"",qty:"",bags:"",narration:""});
  };

  const pending  = (state.transfers||[]).filter(t=>t.status==="pending");
  const accepted = (state.transfers||[]).filter(t=>t.status==="accepted");

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
        <div>
          <h2 style={{margin:0,color:C.text,fontSize:22,fontWeight:800}}>🚛 Stock Transfer</h2>
          <p style={{margin:"2px 0 0",color:C.muted,fontSize:13}}>
            {isBranch?"Yercaud → Pattiveeranpatti":"Receive stock from Yercaud branch"}
          </p>
        </div>
        {isBranch&&canPost&&<Btn onClick={()=>setShowForm(true)} variant="success" size="lg">+ Raise Transfer</Btn>}
      </div>

      {/* Summary */}
      <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
        {[
          {icon:"⏳",label:"Pending",    value:pending.length,  color:"#d97706"},
          {icon:"✅",label:"Accepted",   value:accepted.length, color:C.green},
          {icon:"📦",label:"Total kg",   value:(state.transfers||[]).reduce((s,t)=>s+parseFloat(t.weightKg||0),0).toLocaleString("en-IN",{maximumFractionDigits:0})+" kg"},
        ].map(s=>(
          <div key={s.label} style={{...sh.card,flex:1,minWidth:120}}>
            <div style={{fontSize:18,marginBottom:4}}>{s.icon}</div>
            <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase"}}>{s.label}</div>
            <div style={{fontFamily:"monospace",fontWeight:800,fontSize:20,color:s.color||C.accent,marginTop:4}}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* New transfer form */}
      {showForm&&(
        <div style={{...sh.card,border:`2px solid ${C.accent}44`}}>
          <div style={{fontWeight:800,color:C.accent,marginBottom:14,fontSize:15}}>🚛 Raise Stock Transfer — Yercaud → HQ</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:12,marginBottom:14}}>
            <Field label="Date"><input type="date" value={form.date} onChange={e=>set("date",e.target.value)} style={sh.input}/></Field>
            <Field label="Select GRN *">
              <select value={form.grnId} onChange={e=>set("grnId",e.target.value)} style={{...sh.input,borderColor:!form.grnId?"#f97316":C.border}}>
                <option value="">— Select GRN —</option>
                {eligibleGRNs.map(g=>{
                  const party=state.parties[g.partyId];
                  const qty=parseFloat(g.dryKg||g.netWeight||0);
                  return <option key={g.id} value={g.id}>{g.id} · {party?.name||"?"} · {g.coffeeType} · {qty}kg</option>;
                })}
              </select>
            </Field>
            <Field label={`Weight kg (max ${maxQty} kg)`}>
              <input type="number" value={form.qty} onChange={e=>set("qty",e.target.value)} placeholder="0" style={sh.input}/>
            </Field>
            <Field label="No of bags">
              <input type="number" value={form.bags} onChange={e=>set("bags",e.target.value)} placeholder="0" style={sh.input}/>
            </Field>
            <Field label="Narration">
              <input value={form.narration} onChange={e=>set("narration",e.target.value)} placeholder="Vehicle no, driver..." style={sh.input}/>
            </Field>
          </div>
          {selectedGRN&&(
            <div style={{padding:"10px 14px",background:"#f0fdf4",borderRadius:6,marginBottom:12,fontSize:12}}>
              <strong>{selectedGRN.id}</strong> · {selectedGRN.coffeeType} · {state.parties[selectedGRN.partyId]?.name} · {maxQty} kg available
            </div>
          )}
          {err&&<div style={{color:C.red,fontWeight:700,fontSize:13,padding:"8px 12px",background:"#fee2e2",borderRadius:6,marginBottom:10}}>{err}</div>}
          <div style={{display:"flex",gap:10}}>
            <Btn onClick={submit} variant="success">✓ Raise Transfer</Btn>
            <Btn onClick={()=>{setShowForm(false);setErr("");}} variant="ghost">Cancel</Btn>
          </div>
        </div>
      )}

      {/* Pending transfers — HQ can accept */}
      {pending.length>0&&(
        <div>
          <div style={{fontWeight:800,color:"#d97706",marginBottom:10,fontSize:15}}>⏳ Pending Acceptance</div>
          {pending.map(t=>{
            const grn=state.grns.find(g=>g.id===t.grnId);
            const party=state.parties[grn?.partyId];
            return(
              <div key={t.id} style={{...sh.card,border:"2px solid #fde68a",marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:10}}>
                  <div>
                    <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:6}}>
                      <span style={{background:"#fef3c7",color:"#92400e",padding:"2px 10px",borderRadius:20,fontSize:11,fontWeight:800}}>{t.id}</span>
                      <span style={{fontSize:13,color:C.muted}}>{t.date}</span>
                      <span style={{fontWeight:700}}>{party?.name||"?"}</span>
                      <span style={{fontSize:12,color:C.muted}}>{t.coffeeType}</span>
                      <span style={{fontSize:11,color:C.muted}}>from {t.fromLocation}</span>
                    </div>
                    <div style={{fontSize:13}}>
                      <strong>{parseFloat(t.weightKg||0).toLocaleString("en-IN")} kg</strong>
                      {t.bags>0&&<span style={{color:C.muted,marginLeft:8}}>{t.bags} bags</span>}
                      {t.narration&&<span style={{color:C.muted,marginLeft:8,fontStyle:"italic"}}>{t.narration}</span>}
                    </div>
                    <div style={{fontSize:11,color:C.muted,marginTop:4}}>Raised by: {t.raisedBy} · GRN: {t.grnId}</div>
                  </div>
                  {!isBranch&&(
                    <Btn variant="success" onClick={()=>dispatch({type:"ACCEPT_TRANSFER",id:t.id,acceptedBy:currentUser?.name})}>
                      ✓ Accept Stock
                    </Btn>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Accepted transfers */}
      {accepted.length>0&&(
        <div>
          <div style={{fontWeight:800,color:C.green,marginBottom:10,fontSize:15}}>✅ Accepted Transfers</div>
          {accepted.map(t=>{
            const grn=state.grns.find(g=>g.id===t.grnId);
            const party=state.parties[grn?.partyId];
            return(
              <div key={t.id} style={{...sh.card,borderLeft:`3px solid ${C.green}`,marginBottom:8}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                  <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                    <span style={{background:"#dcfce7",color:C.green,padding:"2px 10px",borderRadius:20,fontSize:11,fontWeight:800}}>{t.id}</span>
                    <span style={{fontSize:13,color:C.muted}}>{t.date}</span>
                    <span style={{fontWeight:700}}>{party?.name||"?"}</span>
                    <span style={{fontSize:12,background:"#f0fdf4",color:C.green,padding:"2px 8px",borderRadius:4}}>{t.coffeeType}</span>
                    <span style={{fontFamily:"monospace",fontWeight:700}}>{parseFloat(t.weightKg||0).toLocaleString("en-IN")} kg</span>
                  </div>
                  <div style={{fontSize:11,color:C.muted}}>Accepted by {t.acceptedBy}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(state.transfers||[]).length===0&&(
        <div style={{...sh.card,textAlign:"center",color:C.muted,padding:48}}>
          <div style={{fontSize:40,marginBottom:8}}>🚛</div>
          {isBranch?"No transfers raised yet. Click + Raise Transfer to begin.":"No transfers received from branch yet."}
        </div>
      )}
    </div>
  );
}

// ── YERCAUD PAYMENTS MODULE ───────────────────────────────────────
const YERCAUD_CASH_ID = "yercaud_cash";

function YercaudModule({ state, dispatch, role }) {
  const mobile = typeof window !== "undefined" && window.innerWidth < 768;
  const [showForm,   setShowForm]   = useState(false);
  const [showFund,   setShowFund]   = useState(false);
  const [confirmId,  setConfirmId]  = useState(null);
  const [filterParty,setFilterParty]= useState("all");
  const [filterMonth,setFilterMonth]= useState("");

  // Payment form
  const [pForm, setPForm] = useState({
    date: today(), partyId:"", amount:"", paymentMode:"cash", narration:"", reference:"",
  });
  // Fund transfer form (top up Yercaud cash)
  const [fForm, setFForm] = useState({
    date: today(), fromAccount:"cash", amount:"", narration:"",
  });
  const [pErr, setPErr] = useState("");
  const [fErr, setFErr] = useState("");

  const canPost   = ROLES[role]?.canPost;
  const canDelete = ROLES[role]?.canDelete;

  const suppliers = Object.values(state.parties).filter(p=>p.partyType==="supplier");
  const yercaudCash = state.accounts[YERCAUD_CASH_ID];
  const yercaudBal  = yercaudCash?.balance || 0;

  // Cash & Bank accounts (excluding Yercaud cash itself) for funding
  const fundSources = Object.values(state.accounts).filter(a=>
    a.group==="Cash & Bank" && a.id!==YERCAUD_CASH_ID
  );

  const payments = (state.yercaudPayments||[]);

  // Filtered payments
  const filtered = payments.filter(p => {
    if (filterParty!=="all" && p.partyId!==filterParty) return false;
    if (filterMonth && !(p.date||"").startsWith(filterMonth)) return false;
    return true;
  });

  // Summary stats
  const totalPaid     = filtered.reduce((s,p)=>s+parseFloat(p.amount||0),0);
  const uniqueParties = new Set(filtered.map(p=>p.partyId)).size;

  // Per-party summary (unpaid advances = payments not yet matched to a GRN purchase voucher)
  const partyAdvances = useMemo(()=>{
    const map = {};
    payments.forEach(p => {
      if (!map[p.partyId]) map[p.partyId] = 0;
      map[p.partyId] += parseFloat(p.amount||0);
    });
    return map;
  }, [payments]);

  const submitPayment = async () => {
    if (!pForm.partyId)              { setPErr("Select a supplier"); return; }
    if (!pForm.amount||parseFloat(pForm.amount)<=0) { setPErr("Enter amount"); return; }
    if (parseFloat(pForm.amount) > yercaudBal && pForm.paymentMode==="cash") {
      setPErr(`Insufficient Yercaud Cash balance (₹${fmt(yercaudBal)} available)`); return;
    }
    setPErr("");
    await dispatch({ type:"ADD_YERCAUD_PAYMENT", data:{ ...pForm, amount:parseFloat(pForm.amount) }});
    setShowForm(false);
    setPForm({date:today(),partyId:"",amount:"",paymentMode:"cash",narration:"",reference:""});
  };

  const submitFund = async () => {
    if (!fForm.fromAccount)              { setFErr("Select source account"); return; }
    if (!fForm.amount||parseFloat(fForm.amount)<=0) { setFErr("Enter amount"); return; }
    const src = state.accounts[fForm.fromAccount];
    if (src && parseFloat(fForm.amount) > src.balance) {
      setFErr(`Insufficient balance in ${src.name}`); return;
    }
    setFErr("");
    await dispatch({ type:"FUND_YERCAUD_CASH", data:{ ...fForm, amount:parseFloat(fForm.amount) }});
    setShowFund(false);
    setFForm({date:today(),fromAccount:"cash",amount:"",narration:""});
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>

      {/* Confirm delete */}
      {confirmId&&(
        <div style={{position:"fixed",inset:0,background:"#00000066",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div style={{background:C.surface,borderRadius:14,padding:"28px 24px",maxWidth:380,width:"100%",textAlign:"center",boxShadow:"0 20px 60px #00000044"}}>
            <div style={{fontSize:36,marginBottom:12}}>🗑</div>
            <div style={{fontWeight:800,fontSize:17,marginBottom:8}}>Delete Payment?</div>
            <div style={{fontSize:13,color:C.muted,marginBottom:20}}>This will reverse the accounting entries and restore balances.</div>
            <div style={{display:"flex",gap:10,justifyContent:"center"}}>
              <Btn variant="danger" onClick={async()=>{await dispatch({type:"DELETE_YERCAUD_PAYMENT",id:confirmId});setConfirmId(null);}}>Yes, Delete</Btn>
              <Btn variant="ghost" onClick={()=>setConfirmId(null)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:12}}>
        <div>
          <h2 style={{margin:0,color:C.text,fontSize:20,fontWeight:800}}>🌿 Yercaud Payments</h2>
          <p style={{margin:"2px 0 0",color:C.muted,fontSize:13}}>Advance payments to suppliers at Yercaud</p>
        </div>
        {canPost&&(
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <Btn onClick={()=>setShowFund(true)} variant="outline" size="md">💰 Fund Yercaud Cash</Btn>
            <Btn onClick={()=>setShowForm(true)} variant="success" size="lg">+ New Payment</Btn>
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        {/* Yercaud Cash Balance */}
        <div style={{...sh.card,flex:"1 1 200px",borderLeft:`4px solid ${yercaudBal>=0?C.green:C.red}`}}>
          <div style={{fontSize:18,marginBottom:4}}>🌿</div>
          <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:0.5}}>Yercaud Cash Balance</div>
          <div style={{fontFamily:"monospace",fontWeight:800,fontSize:22,color:yercaudBal>=0?C.green:C.red,marginTop:4}}>{fmt(yercaudBal)}</div>
          <div style={{fontSize:11,color:C.muted,marginTop:2}}>Available to pay suppliers</div>
        </div>
        <div style={{...sh.card,flex:"1 1 140px"}}>
          <div style={{fontSize:18,marginBottom:4}}>📤</div>
          <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:0.5}}>Total Paid (filtered)</div>
          <div style={{fontFamily:"monospace",fontWeight:800,fontSize:20,color:C.accent,marginTop:4}}>{fmt(totalPaid)}</div>
        </div>
        <div style={{...sh.card,flex:"1 1 140px"}}>
          <div style={{fontSize:18,marginBottom:4}}>👥</div>
          <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:0.5}}>Suppliers Paid</div>
          <div style={{fontFamily:"monospace",fontWeight:800,fontSize:20,color:C.accent,marginTop:4}}>{uniqueParties}</div>
        </div>
        <div style={{...sh.card,flex:"1 1 140px"}}>
          <div style={{fontSize:18,marginBottom:4}}>📋</div>
          <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:0.5}}>Total Payments</div>
          <div style={{fontFamily:"monospace",fontWeight:800,fontSize:20,color:C.accent,marginTop:4}}>{filtered.length}</div>
        </div>
      </div>

      {/* Fund Yercaud Cash form */}
      {showFund&&(
        <div style={{...sh.card,border:`2px solid ${C.blue}44`,background:"#f0f9ff"}}>
          <div style={{fontWeight:800,color:C.blue,marginBottom:14,fontSize:15}}>💰 Fund Yercaud Cash</div>
          <div style={{fontSize:13,color:C.muted,marginBottom:14,padding:"8px 12px",background:"#dbeafe",borderRadius:6}}>
            Transfer money from main Cash or Bank → Yercaud Cash account. Use this whenever someone carries cash to Yercaud or withdraws from bank for Yercaud operations.
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:12}}>
            <Field label="Date"><input type="date" value={fForm.date} onChange={e=>setFForm(f=>({...f,date:e.target.value}))} style={sh.input}/></Field>
            <Field label="From Account (Source)">
              <select value={fForm.fromAccount} onChange={e=>setFForm(f=>({...f,fromAccount:e.target.value}))} style={sh.input}>
                {fundSources.map(a=>(
                  <option key={a.id} value={a.id}>{a.name} ({fmt(a.balance)})</option>
                ))}
              </select>
            </Field>
            <Field label="Amount (₹)">
              <input type="number" value={fForm.amount} onChange={e=>setFForm(f=>({...f,amount:e.target.value}))} placeholder="0.00" style={sh.input} autoFocus/>
            </Field>
            <Field label="Narration">
              <input value={fForm.narration} onChange={e=>setFForm(f=>({...f,narration:e.target.value}))} placeholder="e.g. Cash sent with driver" style={sh.input}/>
            </Field>
          </div>
          {parseFloat(fForm.amount||0)>0&&(
            <div style={{marginTop:12,padding:"10px 14px",background:"#dbeafe",borderRadius:8,fontSize:13}}>
              <strong>{state.accounts[fForm.fromAccount]?.name}</strong> → <strong>Yercaud Cash</strong>: <span style={{fontFamily:"monospace",fontWeight:800,color:C.blue}}>{fmt(fForm.amount)}</span>
              <span style={{color:C.muted,marginLeft:8,fontSize:12}}>Contra entry (CV)</span>
            </div>
          )}
          {fErr&&<div style={{color:C.red,fontSize:13,fontWeight:600,marginTop:10,padding:"8px",background:"#fee2e2",borderRadius:6}}>{fErr}</div>}
          <div style={{display:"flex",gap:10,marginTop:14}}>
            <Btn onClick={submitFund} variant="primary" size="lg">✓ Transfer Funds</Btn>
            <Btn onClick={()=>{setShowFund(false);setFErr("");}} variant="ghost">Cancel</Btn>
          </div>
        </div>
      )}

      {/* New Payment form */}
      {showForm&&(
        <div style={{...sh.card,border:`2px solid ${C.green}44`}}>
          <div style={{fontWeight:800,color:C.green,marginBottom:14,fontSize:15}}>🌿 New Yercaud Payment</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:12}}>
            <Field label="Date"><input type="date" value={pForm.date} onChange={e=>setPForm(f=>({...f,date:e.target.value}))} style={sh.input}/></Field>
            <Field label="Supplier *">
              <select value={pForm.partyId} onChange={e=>setPForm(f=>({...f,partyId:e.target.value}))} style={{...sh.input,borderColor:!pForm.partyId?"#f97316":C.border}}>
                <option value="">— Select Supplier —</option>
                {suppliers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Amount (₹) *">
              <input type="number" value={pForm.amount} onChange={e=>setPForm(f=>({...f,amount:e.target.value}))} placeholder="0.00" style={sh.input}/>
            </Field>
            <Field label="Payment Mode">
              <select value={pForm.paymentMode} onChange={e=>setPForm(f=>({...f,paymentMode:e.target.value}))} style={sh.input}>
                <option value="cash">Yercaud Cash</option>
                <option value="bank_transfer">Bank Transfer / UPI</option>
                <option value="cheque">Cheque</option>
              </select>
            </Field>
            <Field label="Reference / UPI / Cheque No.">
              <input value={pForm.reference} onChange={e=>setPForm(f=>({...f,reference:e.target.value}))} placeholder="Optional" style={sh.input}/>
            </Field>
            <Field label="Narration">
              <input value={pForm.narration} onChange={e=>setPForm(f=>({...f,narration:e.target.value}))} placeholder="e.g. Advance for wet parchment" style={sh.input}/>
            </Field>
          </div>

          {/* Preview */}
          {pForm.partyId&&parseFloat(pForm.amount||0)>0&&(()=>{
            const party = state.parties[pForm.partyId];
            const partyAcc = state.accounts[pForm.partyId];
            const currentBalance = partyAcc?.balance||0;
            const afterBalance = currentBalance - parseFloat(pForm.amount);
            return (
              <div style={{marginTop:14,padding:"12px 16px",background:"#f0fdf4",borderRadius:8,fontSize:13}}>
                <div style={{fontWeight:700,color:C.green,marginBottom:6}}>Accounting Entry Preview</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <div style={{padding:"8px 12px",background:C.cream,borderRadius:6}}>
                    <div style={{fontSize:11,color:C.muted}}>Dr (Debit)</div>
                    <div style={{fontWeight:700}}>{party?.name}</div>
                    <div style={{fontFamily:"monospace",fontWeight:800,color:C.blue}}>{fmt(pForm.amount)}</div>
                    <div style={{fontSize:11,color:C.muted,marginTop:2}}>Reduces payable to supplier</div>
                  </div>
                  <div style={{padding:"8px 12px",background:C.cream,borderRadius:6}}>
                    <div style={{fontSize:11,color:C.muted}}>Cr (Credit)</div>
                    <div style={{fontWeight:700}}>{pForm.paymentMode==="cash"?"Yercaud Cash":"Bank Account"}</div>
                    <div style={{fontFamily:"monospace",fontWeight:800,color:C.red}}>{fmt(pForm.amount)}</div>
                    <div style={{fontSize:11,color:C.muted,marginTop:2}}>Cash paid out</div>
                  </div>
                </div>
                <div style={{marginTop:10,fontSize:12,color:C.muted}}>
                  {party?.name} balance: <span style={{fontFamily:"monospace",fontWeight:700,color:C.muted}}>{fmt(Math.abs(currentBalance))} {currentBalance>=0?"Dr":"Cr"}</span>
                  {" → "}<span style={{fontFamily:"monospace",fontWeight:700,color:afterBalance>0?C.red:C.green}}>{fmt(Math.abs(afterBalance))} {afterBalance>=0?"Dr":"Cr"}</span>
                  {currentBalance===0&&<span style={{color:C.muted}}> (advance — GRN not yet created)</span>}
                </div>
              </div>
            );
          })()}

          {pErr&&<div style={{color:C.red,fontSize:13,fontWeight:600,marginTop:10,padding:"8px",background:"#fee2e2",borderRadius:6}}>{pErr}</div>}
          <div style={{display:"flex",gap:10,marginTop:14}}>
            <Btn onClick={submitPayment} variant="success" size="lg">✓ Record Payment</Btn>
            <Btn onClick={()=>{setShowForm(false);setPErr("");}} variant="ghost">Cancel</Btn>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{display:"flex",gap:10,alignItems:"flex-end",flexWrap:"wrap"}}>
        <Field label="Party">
          <select value={filterParty} onChange={e=>setFilterParty(e.target.value)} style={{...sh.input,width:160}}>
            <option value="all">All Suppliers</option>
            {suppliers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Month">
          <input type="month" value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} style={{...sh.input,width:150}}/>
        </Field>
        {(filterParty!=="all"||filterMonth)&&<Btn variant="ghost" size="sm" onClick={()=>{setFilterParty("all");setFilterMonth("");}}>✕ Clear</Btn>}
        <span style={{marginLeft:"auto",color:C.muted,fontSize:13,alignSelf:"flex-end"}}>{filtered.length} payment{filtered.length!==1?"s":""} · {fmt(totalPaid)}</span>
      </div>

      {/* Per-party advance summary */}
      {filterParty==="all"&&Object.keys(partyAdvances).length>0&&(
        <div style={sh.card}>
          <div style={{fontWeight:800,marginBottom:12,color:C.accent}}>📊 Advance Summary by Supplier</div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            {Object.entries(partyAdvances).map(([partyId,total])=>{
              const party=state.parties[partyId];
              const partyBal=state.accounts[partyId]?.balance||0;
              if(!party) return null;
              return(
                <div key={partyId} style={{background:C.cream,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 16px",minWidth:180}}>
                  <div style={{fontWeight:700,fontSize:13,color:C.text}}>{party.name}</div>
                  <div style={{fontFamily:"monospace",fontWeight:800,fontSize:16,color:C.green,marginTop:2}}>{fmt(total)}</div>
                  <div style={{fontSize:11,color:C.muted}}>total paid at Yercaud</div>
                  <div style={{fontSize:11,marginTop:4,color:partyBal<0?C.green:partyBal>0?C.red:C.muted,fontWeight:600}}>
                    Party balance: {fmt(Math.abs(partyBal))} {partyBal<0?"(credit — overpaid)":partyBal>0?"(still payable)":"(settled)"}
                  </div>
                </div>
              );
            }).filter(Boolean)}
          </div>
        </div>
      )}

      {/* Payments list */}
      {filtered.length===0?(
        <div style={{...sh.card,textAlign:"center",color:C.muted,padding:48}}>
          <div style={{fontSize:40,marginBottom:8}}>🌿</div>
          No Yercaud payments recorded yet.
        </div>
      ):(
        <div style={{...sh.card,padding:0,overflow:"hidden"}}>
          <div style={{background:"#f5ede4",padding:"10px 16px",fontWeight:800,fontSize:13,color:C.accent,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>🌿 Yercaud Payment Register</span>
            <span style={{fontFamily:"monospace",fontWeight:700,color:C.green}}>{fmt(totalPaid)}</span>
          </div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",minWidth:500}}>
              <thead><tr style={{background:"#fdf5ee"}}>
                <th style={sh.th}>ID</th>
                <th style={sh.th}>Date</th>
                <th style={sh.th}>Supplier</th>
                <th style={sh.th}>Mode</th>
                <th style={sh.th}>Reference</th>
                <th style={sh.th}>Narration</th>
                <th style={{...sh.th,textAlign:"right"}}>Amount (₹)</th>
                {canDelete&&<th style={{...sh.th,width:40}}></th>}
              </tr></thead>
              <tbody>
                {filtered.map((p,i)=>{
                  const party=state.parties[p.partyId];
                  const modeLabel={cash:"🌿 Yercaud Cash",bank_transfer:"🏦 Bank/UPI",cheque:"📄 Cheque"}[p.paymentMode]||p.paymentMode;
                  return(
                    <tr key={p.id} style={{background:i%2===0?C.surface:C.cream}}>
                      <td style={{...sh.td,fontFamily:"monospace",fontSize:11,fontWeight:700,color:C.accent}}>{p.id}</td>
                      <td style={sh.td}>{p.date}</td>
                      <td style={{...sh.td,fontWeight:600}}>{party?.name||"—"}</td>
                      <td style={sh.td}><span style={{fontSize:11,fontWeight:600,color:C.muted}}>{modeLabel}</span></td>
                      <td style={{...sh.td,fontSize:12,color:C.muted}}>{p.reference||"—"}</td>
                      <td style={{...sh.td,fontSize:12,color:C.muted,fontStyle:"italic"}}>{p.narration||"—"}</td>
                      <td style={{...sh.td,textAlign:"right",fontFamily:"monospace",fontWeight:800,color:C.green}}>{fmt(p.amount)}</td>
                      {canDelete&&<td style={{...sh.td,textAlign:"center"}}>
                        <button onClick={()=>setConfirmId(p.id)} style={{background:"none",border:"none",color:C.red,cursor:"pointer",fontSize:14}}>🗑</button>
                      </td>}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr style={{background:"#f5ede4"}}>
                <td colSpan={6} style={{padding:"10px 16px",fontWeight:800,color:C.accent}}>Total</td>
                <td style={{padding:"10px 16px",textAlign:"right",fontFamily:"monospace",fontWeight:800,color:C.green}}>{fmt(totalPaid)}</td>
                {canDelete&&<td></td>}
              </tr></tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}


// ── OPENING BALANCE MODULE ────────────────────────────────────────
function OpeningBalanceModule({ state, dispatch }) {
  const [date, setDate]     = useState(today());
  const [balances, setBalances] = useState({});
  const [saving, setSavingOB]   = useState(false);
  const [done, setDone]         = useState(false);
  const [err, setErr]           = useState("");

  const set = (id, val) => setBalances(b => ({...b, [id]: val}));

  // Group accounts
  const cashBank   = Object.values(state.accounts).filter(a=>a.group==="Cash & Bank"&&!a.isParty);
  const suppliers  = Object.values(state.parties).filter(p=>p.partyType==="supplier");
  const customers  = Object.values(state.parties).filter(p=>p.partyType==="customer");
  const otherAccs  = Object.values(state.accounts).filter(a=>!a.isParty&&a.group!=="Cash & Bank"&&a.id!=="opening_balance_equity");

  const post = async () => {
    setSavingOB(true); setErr("");
    try {
      await dispatch({ type:"POST_OPENING_BALANCES", date, balances });
      setDone(true);
    } catch(e) { setErr(e.message); }
    setSavingOB(false);
  };

  const SectionHeader = ({title, sub}) => (
    <div style={{background:"#f5ede4",padding:"10px 16px",fontWeight:800,fontSize:13,color:C.accent,borderBottom:`1px solid ${C.border}`}}>
      {title} {sub&&<span style={{fontWeight:400,fontSize:12,color:C.muted,marginLeft:6}}>{sub}</span>}
    </div>
  );

  const BalRow = ({id, label, sub, direction="asset"}) => (
    <div style={{display:"flex",alignItems:"center",gap:12,padding:"10px 16px",borderBottom:`1px solid ${C.border}`,flexWrap:"wrap"}}>
      <div style={{flex:1,minWidth:160}}>
        <div style={{fontSize:13,fontWeight:600,color:C.text}}>{label}</div>
        {sub&&<div style={{fontSize:11,color:C.muted}}>{sub}</div>}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <span style={{fontSize:12,color:C.muted,minWidth:80,textAlign:"right"}}>
          {direction==="asset"?"Balance (₹)":direction==="we_owe"?"We Owe (₹)":"They Owe Us (₹)"}
        </span>
        <input type="number" value={balances[id]||""} onChange={e=>set(id,e.target.value)}
          placeholder="0.00"
          style={{...sh.input,width:130,textAlign:"right",
            borderColor:parseFloat(balances[id]||0)>0?"#22c55e":C.border}}/>
      </div>
    </div>
  );

  if (done) return (
    <div style={{...sh.card,textAlign:"center",padding:48}}>
      <div style={{fontSize:48,marginBottom:12}}>✅</div>
      <div style={{fontWeight:800,fontSize:20,color:C.green,marginBottom:8}}>Opening Balances Posted!</div>
      <div style={{color:C.muted,fontSize:13,marginBottom:20}}>A Journal Voucher has been created for {date}. You can view it in Day Book.</div>
      <Btn onClick={()=>setDone(false)} variant="outline">Enter More / Edit</Btn>
    </div>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div>
        <h2 style={{margin:0,color:C.text,fontSize:20,fontWeight:800}}>🏦 Opening Balances</h2>
        <p style={{margin:"2px 0 0",color:C.muted,fontSize:13}}>Enter balances as of your go-live date — no accounting knowledge needed</p>
      </div>

      <div style={{...sh.card,background:"#fffbeb",border:`1px solid #fcd34d`}}>
        <div style={{fontWeight:700,color:"#92400e",marginBottom:4}}>⚠️ Do this only once</div>
        <div style={{fontSize:13,color:"#78350f"}}>Post opening balances once when you start using the system. After posting, use regular vouchers for all transactions. Re-posting will create duplicate entries.</div>
      </div>

      <div style={{...sh.card,padding:0,overflow:"hidden"}}>
        <SectionHeader title="📅 Go-Live Date"/>
        <div style={{padding:"14px 16px"}}>
          <Field label="Opening Balance Date">
            <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{...sh.input,maxWidth:200}}/>
          </Field>
          <div style={{fontSize:12,color:C.muted,marginTop:6}}>All balances will be posted as of this date</div>
        </div>
      </div>

      {/* Cash & Bank */}
      <div style={{...sh.card,padding:0,overflow:"hidden"}}>
        <SectionHeader title="💵 Cash & Bank" sub="Enter balance on go-live date"/>
        {cashBank.length===0
          ? <div style={{padding:20,color:C.muted,fontSize:13}}>No cash/bank accounts found. Add them in Accounts first.</div>
          : cashBank.map(a=><BalRow key={a.id} id={a.id} label={a.name} direction="asset"/>)
        }
      </div>

      {/* Suppliers — we owe them */}
      <div style={{...sh.card,padding:0,overflow:"hidden"}}>
        <SectionHeader title="📤 Suppliers" sub="Amount you owe each supplier on go-live date"/>
        {suppliers.length===0
          ? <div style={{padding:20,color:C.muted,fontSize:13}}>No suppliers found. Add them in Parties first.</div>
          : suppliers.map(p=><BalRow key={p.id} id={`sup_${p.id}`} label={p.name} sub="Supplier" direction="we_owe"/>)
        }
      </div>

      {/* Customers — they owe us */}
      <div style={{...sh.card,padding:0,overflow:"hidden"}}>
        <SectionHeader title="📥 Buyers / Customers" sub="Amount each buyer owes you on go-live date"/>
        {customers.length===0
          ? <div style={{padding:20,color:C.muted,fontSize:13}}>No customers found. Add them in Parties first.</div>
          : customers.map(p=><BalRow key={p.id} id={`cus_${p.id}`} label={p.name} sub="Customer" direction="they_owe"/>)
        }
      </div>

      {/* Other accounts */}
      {otherAccs.length>0&&(
        <div style={{...sh.card,padding:0,overflow:"hidden"}}>
          <SectionHeader title="🗂 Other Accounts" sub="Capital, loans, payables etc."/>
          {otherAccs.map(a=>(
            <div key={a.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 16px",borderBottom:`1px solid ${C.border}`,flexWrap:"wrap"}}>
              <div style={{flex:1,minWidth:160}}>
                <div style={{fontSize:13,fontWeight:600,color:C.text}}>{a.name}</div>
                <div style={{fontSize:11,color:C.muted}}>{a.group} · {a.type}</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <select value={balances[`dir_${a.id}`]||"normal"} onChange={e=>set(`dir_${a.id}`,e.target.value)} style={{...sh.input,width:130}}>
                  <option value="normal">{["asset","expense"].includes(a.type)?"We are owed":"We owe"}</option>
                  <option value="reverse">{["asset","expense"].includes(a.type)?"We owe":"We are owed"}</option>
                </select>
                <input type="number" value={balances[a.id]||""} onChange={e=>set(a.id,e.target.value)}
                  placeholder="0.00" style={{...sh.input,width:130,textAlign:"right",borderColor:parseFloat(balances[a.id]||0)>0?"#22c55e":C.border}}/>
              </div>
            </div>
          ))}
        </div>
      )}

      {err&&<div style={{color:C.red,fontWeight:700,fontSize:13,padding:"10px 14px",background:"#fee2e2",borderRadius:6}}>{err}</div>}

      <div style={{display:"flex",gap:10,alignItems:"center"}}>
        <Btn onClick={post} variant="success" size="lg" disabled={saving}>
          {saving?"⏳ Posting...":"✓ Post Opening Balances"}
        </Btn>
        <span style={{fontSize:12,color:C.muted}}>Creates a Journal Voucher dated {date}</span>
      </div>
    </div>
  );
}

// ── LOADMAN MODULE ────────────────────────────────────────────────
const LOADMAN_SERVICES = [
  "Unloading from Vehicle",
  "Taking Delivery from Party",
  "Inter-Company Transfer",
  "Bulking & Packing",
  "Loading to Vehicle",
];
const LOADMAN_PAYABLE_ID = "loadman_payable";
const LOADMAN_EXPENSE_ID = "loadman_expense";

function LoadmanModule({ state, dispatch, role }) {
  const [activeTab, setActiveTab] = useState("charges"); // charges | rates | payments
  const [showForm,  setShowForm]  = useState(false);
  const [showPay,   setShowPay]   = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [filterService, setFilterService] = useState("all");
  const [filterMonth,   setFilterMonth]   = useState("");

  // Charge form
  const [form, setForm] = useState({
    date:today(), serviceType:LOADMAN_SERVICES[0], linkedTo:"standalone",
    linkedId:"", bags:"", weightKg:"", unit:"bags",
    rate:"", amount:"", whoBearsIt:"company",
    partyId:"", narration:"",
  });
  // Payment form
  const [payForm, setPayForm] = useState({
    date:today(), amount:"", paymentAccount:"cash", narration:"",
  });
  const [formErr, setFormErr] = useState("");
  const [payErr,  setPayErr]  = useState("");

  const canPost   = ROLES[role]?.canPost;
  const canDelete = ROLES[role]?.canDelete;
  const set = (f,v) => setForm(p => {
    const next = {...p,[f]:v};
    if (f==="bags"||f==="rate"||f==="weightKg") {
      const qty = next.unit==="bags" ? parseFloat(next.bags||0) : parseFloat(next.weightKg||0);
      next.amount = (qty * parseFloat(next.rate||0)).toFixed(2);
    }
    if (f==="unit") {
      const qty = v==="bags" ? parseFloat(next.bags||0) : parseFloat(next.weightKg||0);
      next.amount = (qty * parseFloat(next.rate||0)).toFixed(2);
    }
    return next;
  });

  const rates    = state.loadmanRates||[];
  const charges  = state.loadmanCharges||[];
  const parties  = Object.values(state.parties);
  const cashBankAccounts = Object.values(state.accounts).filter(a=>a.group==="Cash & Bank");
  const loadmanPayable   = state.accounts[LOADMAN_PAYABLE_ID];
  const pendingBalance   = loadmanPayable?.balance || 0;

  // Prefill rate when service changes
  const prefillRate = (service) => {
    const r = rates.find(r=>r.serviceType===service);
    if (r) set("rate", r.rate);
  };

  const filtered = charges.filter(c=>{
    if (filterService!=="all" && c.serviceType!==filterService) return false;
    if (filterMonth && !(c.date||"").startsWith(filterMonth)) return false;
    return true;
  });

  const submitCharge = async () => {
    if (!form.amount||parseFloat(form.amount)<=0) { setFormErr("Enter quantity and rate to calculate amount"); return; }
    if (form.whoBearsIt==="party"&&!form.partyId) { setFormErr("Select a party"); return; }
    setFormErr("");
    await dispatch({type:"ADD_LOADMAN_CHARGE", data:{...form, amount:parseFloat(form.amount)}});
    setShowForm(false);
    setForm({date:today(),serviceType:LOADMAN_SERVICES[0],linkedTo:"standalone",linkedId:"",bags:"",weightKg:"",unit:"bags",rate:"",amount:"",whoBearsIt:"company",partyId:"",narration:""});
  };

  const submitPayment = async () => {
    if (!payForm.amount||parseFloat(payForm.amount)<=0) { setPayErr("Enter amount"); return; }
    if (parseFloat(payForm.amount) > pendingBalance) { setPayErr(`Cannot pay more than pending balance ${fmt(pendingBalance)}`); return; }
    setPayErr("");
    await dispatch({type:"PAY_LOADMAN", data:{...payForm, amount:parseFloat(payForm.amount)}});
    setShowPay(false);
    setPayForm({date:today(),amount:"",paymentAccount:"cash",narration:""});
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>

      {confirmId&&(
        <div style={{position:"fixed",inset:0,background:"#00000066",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div style={{background:C.surface,borderRadius:14,padding:"28px 24px",maxWidth:380,width:"100%",textAlign:"center",boxShadow:"0 20px 60px #00000044"}}>
            <div style={{fontSize:36,marginBottom:12}}>🗑</div>
            <div style={{fontWeight:800,fontSize:17,marginBottom:8}}>Delete Charge?</div>
            <div style={{fontSize:13,color:C.muted,marginBottom:20}}>Accounting entries will be reversed.</div>
            <div style={{display:"flex",gap:10,justifyContent:"center"}}>
              <Btn variant="danger" onClick={async()=>{await dispatch({type:"DELETE_LOADMAN_CHARGE",id:confirmId});setConfirmId(null);}}>Yes, Delete</Btn>
              <Btn variant="ghost" onClick={()=>setConfirmId(null)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:12}}>
        <div>
          <h2 style={{margin:0,color:C.text,fontSize:20,fontWeight:800}}>👷 Loadman Charges</h2>
          <p style={{margin:"2px 0 0",color:C.muted,fontSize:13}}>Labour charges for loading, unloading & handling</p>
        </div>
        {canPost&&(
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <Btn onClick={()=>setShowPay(true)} variant="outline">💵 Pay Loadman</Btn>
            <Btn onClick={()=>setShowForm(true)} variant="success" size="lg">+ New Charge</Btn>
          </div>
        )}
      </div>

      {/* Summary */}
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        <div style={{...sh.card,flex:"1 1 180px",borderLeft:`4px solid ${C.red}`}}>
          <div style={{fontSize:16,marginBottom:3}}>⏳</div>
          <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase"}}>Pending Payment</div>
          <div style={{fontFamily:"monospace",fontWeight:800,fontSize:20,color:pendingBalance>0?C.red:C.green,marginTop:3}}>{fmt(pendingBalance)}</div>
          <div style={{fontSize:11,color:C.muted}}>owed to loadman</div>
        </div>
        <div style={{...sh.card,flex:"1 1 130px"}}>
          <div style={{fontSize:16,marginBottom:3}}>📋</div>
          <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase"}}>Total Charges</div>
          <div style={{fontFamily:"monospace",fontWeight:800,fontSize:18,color:C.accent,marginTop:3}}>{fmt(filtered.reduce((s,c)=>s+parseFloat(c.amount||0),0))}</div>
        </div>
        <div style={{...sh.card,flex:"1 1 130px"}}>
          <div style={{fontSize:16,marginBottom:3}}>🏢</div>
          <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase"}}>Company Bears</div>
          <div style={{fontFamily:"monospace",fontWeight:800,fontSize:18,color:C.accent,marginTop:3}}>{fmt(filtered.filter(c=>c.whoBearsIt==="company").reduce((s,c)=>s+parseFloat(c.amount||0),0))}</div>
        </div>
        <div style={{...sh.card,flex:"1 1 130px"}}>
          <div style={{fontSize:16,marginBottom:3}}>👥</div>
          <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase"}}>Party Bears</div>
          <div style={{fontFamily:"monospace",fontWeight:800,fontSize:18,color:C.accent,marginTop:3}}>{fmt(filtered.filter(c=>c.whoBearsIt==="party").reduce((s,c)=>s+parseFloat(c.amount||0),0))}</div>
        </div>
      </div>

      {/* Sub-tabs */}
      <div style={{display:"flex",gap:6,borderBottom:`2px solid ${C.border}`,paddingBottom:0}}>
        {[["charges","📋 Charges"],["rates","⚙️ Rates Master"],["payments","💵 Payments"]].map(([id,label])=>(
          <button key={id} onClick={()=>setActiveTab(id)} style={{padding:"8px 16px",border:"none",borderBottom:`3px solid ${activeTab===id?C.accent:"transparent"}`,background:"transparent",color:activeTab===id?C.accent:C.muted,fontWeight:activeTab===id?700:500,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>{label}</button>
        ))}
      </div>

      {/* ── RATES MASTER TAB ── */}
      {activeTab==="rates"&&(
        <div style={sh.card}>
          <div style={{fontWeight:800,color:C.accent,marginBottom:14,fontSize:15}}>⚙️ Service Rates Master</div>
          <div style={{fontSize:13,color:C.muted,marginBottom:14}}>Set default rates per service. These prefill when creating a charge but can be overridden per entry.</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {LOADMAN_SERVICES.map(svc=>{
              const existing = rates.find(r=>r.serviceType===svc);
              return <LoadmanRateRow key={svc} service={svc} existing={existing} dispatch={dispatch}/>;
            })}
          </div>
        </div>
      )}

      {/* ── PAYMENTS TAB ── */}
      {activeTab==="payments"&&(
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {showPay&&(
            <div style={{...sh.card,border:`2px solid ${C.green}44`}}>
              <div style={{fontWeight:800,color:C.green,marginBottom:12,fontSize:15}}>💵 Pay Loadman</div>
              <div style={{padding:"8px 12px",background:"#f0fdf4",borderRadius:6,fontSize:13,marginBottom:12}}>
                Pending balance: <strong style={{fontFamily:"monospace",color:C.red}}>{fmt(pendingBalance)}</strong>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:12}}>
                <Field label="Date"><input type="date" value={payForm.date} onChange={e=>setPayForm(f=>({...f,date:e.target.value}))} style={sh.input}/></Field>
                <Field label="Amount (₹)"><input type="number" value={payForm.amount} onChange={e=>setPayForm(f=>({...f,amount:e.target.value}))} placeholder="0.00" style={sh.input} autoFocus/></Field>
                <Field label="Pay From">
                  <select value={payForm.paymentAccount} onChange={e=>setPayForm(f=>({...f,paymentAccount:e.target.value}))} style={sh.input}>
                    {cashBankAccounts.map(a=><option key={a.id} value={a.id}>{a.name} ({fmt(a.balance)})</option>)}
                  </select>
                </Field>
                <Field label="Narration"><input value={payForm.narration} onChange={e=>setPayForm(f=>({...f,narration:e.target.value}))} placeholder="Optional" style={sh.input}/></Field>
              </div>
              {payErr&&<div style={{color:C.red,fontSize:13,fontWeight:600,marginTop:10,padding:"8px",background:"#fee2e2",borderRadius:6}}>{payErr}</div>}
              <div style={{display:"flex",gap:10,marginTop:14}}>
                <Btn onClick={submitPayment} variant="success" size="lg">✓ Record Payment</Btn>
                <Btn onClick={()=>{setShowPay(false);setPayErr("");}} variant="ghost">Cancel</Btn>
              </div>
            </div>
          )}
          {/* Payments list from vouchers */}
          <div style={{...sh.card,padding:0,overflow:"hidden"}}>
            <div style={{background:"#f5ede4",padding:"10px 16px",fontWeight:800,fontSize:13,color:C.accent}}>Payment History</div>
            {(()=>{
              const payVouchers = state.vouchers.filter(v=>v.entries?.some(e=>e.accountId===LOADMAN_PAYABLE_ID&&parseFloat(e.dr||0)>0)&&v.voucherType==="PV");
              if(!payVouchers.length) return <div style={{padding:24,color:C.muted,textAlign:"center",fontSize:13}}>No payments made yet</div>;
              return (
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",minWidth:420}}>
                    <thead><tr style={{background:"#fdf5ee"}}>
                      <th style={sh.th}>Date</th><th style={sh.th}>Voucher</th>
                      <th style={sh.th}>Narration</th><th style={{...sh.th,textAlign:"right"}}>Amount (₹)</th>
                    </tr></thead>
                    <tbody>{payVouchers.map((v,i)=>{
                      const amt=v.entries.filter(e=>e.accountId===LOADMAN_PAYABLE_ID&&parseFloat(e.dr||0)>0).reduce((s,e)=>s+parseFloat(e.dr||0),0);
                      return(<tr key={v.id} style={{background:i%2===0?C.surface:C.cream}}>
                        <td style={sh.td}>{v.date}</td>
                        <td style={{...sh.td,fontFamily:"monospace",fontSize:11}}>{v.id}</td>
                        <td style={{...sh.td,color:C.muted}}>{v.narration||"—"}</td>
                        <td style={{...sh.td,textAlign:"right",fontFamily:"monospace",fontWeight:700,color:C.green}}>{fmt(amt)}</td>
                      </tr>);
                    })}</tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── CHARGES TAB ── */}
      {activeTab==="charges"&&(
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          {showForm&&(
            <div style={{...sh.card,border:`2px solid ${C.accent}44`}}>
              <div style={{fontWeight:800,color:C.accent,marginBottom:14,fontSize:15}}>👷 New Loadman Charge</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:12}}>
                <Field label="Date"><input type="date" value={form.date} onChange={e=>set("date",e.target.value)} style={sh.input}/></Field>
                <Field label="Service Type">
                  <select value={form.serviceType} onChange={e=>{set("serviceType",e.target.value);prefillRate(e.target.value);}} style={sh.input}>
                    {LOADMAN_SERVICES.map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Unit">
                  <select value={form.unit} onChange={e=>set("unit",e.target.value)} style={sh.input}>
                    <option value="bags">Bags</option>
                    <option value="kg">KG</option>
                  </select>
                </Field>
                <Field label={form.unit==="bags"?"No. of Bags":"Weight (kg)"}>
                  <input type="number" value={form.unit==="bags"?form.bags:form.weightKg}
                    onChange={e=>set(form.unit==="bags"?"bags":"weightKg",e.target.value)}
                    placeholder="0" style={sh.input}/>
                </Field>
                <Field label="Rate (₹ per unit)">
                  <input type="number" value={form.rate} onChange={e=>set("rate",e.target.value)} placeholder="0.00" style={sh.input}/>
                </Field>
                <Field label="Amount (₹)">
                  <input value={form.amount} readOnly style={{...sh.input,background:"#f0fdf4",fontWeight:800,color:C.green}}/>
                </Field>
                <Field label="Linked To">
                  <select value={form.linkedTo} onChange={e=>set("linkedTo",e.target.value)} style={sh.input}>
                    <option value="standalone">Standalone</option>
                    <option value="grn">GRN</option>
                    <option value="sale">Sale</option>
                    <option value="transfer">Transfer</option>
                  </select>
                </Field>
                {form.linkedTo!=="standalone"&&(
                  <Field label={`${form.linkedTo.toUpperCase()} ID`}>
                    <input value={form.linkedId} onChange={e=>set("linkedId",e.target.value)} placeholder={`e.g. GRN-0001`} style={sh.input}/>
                  </Field>
                )}
                <Field label="Who Bears This Cost?">
                  <select value={form.whoBearsIt} onChange={e=>set("whoBearsIt",e.target.value)} style={sh.input}>
                    <option value="company">Company (our expense)</option>
                    <option value="party">Party (charge to party)</option>
                  </select>
                </Field>
                {form.whoBearsIt==="party"&&(
                  <Field label="Party">
                    <select value={form.partyId} onChange={e=>set("partyId",e.target.value)} style={{...sh.input,borderColor:!form.partyId?"#f97316":C.border}}>
                      <option value="">— Select Party —</option>
                      {Object.values(state.parties).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </Field>
                )}
                <Field label="Narration"><input value={form.narration} onChange={e=>set("narration",e.target.value)} placeholder="Optional" style={sh.input}/></Field>
              </div>
              {form.amount>0&&(
                <div style={{marginTop:12,padding:"10px 14px",background:"#f5ede4",borderRadius:8,fontSize:12}}>
                  <strong>Entry: </strong>
                  {form.whoBearsIt==="company"
                    ? <>Dr <strong>Loadman Expense</strong> → Cr <strong>Loadman Payable</strong> · {fmt(form.amount)}</>
                    : <>Dr <strong>{state.parties[form.partyId]?.name||"Party"}</strong> → Cr <strong>Loadman Payable</strong> · {fmt(form.amount)}</>}
                </div>
              )}
              {formErr&&<div style={{color:C.red,fontSize:13,fontWeight:600,marginTop:10,padding:"8px",background:"#fee2e2",borderRadius:6}}>{formErr}</div>}
              <div style={{display:"flex",gap:10,marginTop:14}}>
                <Btn onClick={submitCharge} variant="success" size="lg">✓ Save Charge</Btn>
                <Btn onClick={()=>{setShowForm(false);setFormErr("");}} variant="ghost">Cancel</Btn>
              </div>
            </div>
          )}

          {/* Filters */}
          <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end"}}>
            <Field label="Service">
              <select value={filterService} onChange={e=>setFilterService(e.target.value)} style={{...sh.input,width:180}}>
                <option value="all">All Services</option>
                {LOADMAN_SERVICES.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Month"><input type="month" value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} style={{...sh.input,width:150}}/></Field>
            {(filterService!=="all"||filterMonth)&&<Btn variant="ghost" size="sm" onClick={()=>{setFilterService("all");setFilterMonth("");}}>✕</Btn>}
            <span style={{marginLeft:"auto",color:C.muted,fontSize:13,alignSelf:"flex-end"}}>{filtered.length} entries</span>
          </div>

          {filtered.length===0?(
            <div style={{...sh.card,textAlign:"center",color:C.muted,padding:48}}>
              <div style={{fontSize:40,marginBottom:8}}>👷</div>No loadman charges yet.
            </div>
          ):(
            <div style={{...sh.card,padding:0,overflow:"hidden"}}>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",minWidth:560}}>
                  <thead><tr style={{background:"#f5ede4"}}>
                    <th style={sh.th}>ID</th><th style={sh.th}>Date</th><th style={sh.th}>Service</th>
                    <th style={sh.th}>Qty</th><th style={sh.th}>Linked</th>
                    <th style={sh.th}>Bears</th><th style={{...sh.th,textAlign:"right"}}>Amount</th>
                    {canDelete&&<th style={{...sh.th,width:36}}></th>}
                  </tr></thead>
                  <tbody>{filtered.map((c,i)=>{
                    const party=state.parties[c.partyId];
                    return(
                      <tr key={c.id} style={{background:i%2===0?C.surface:C.cream}}>
                        <td style={{...sh.td,fontFamily:"monospace",fontSize:11,fontWeight:700,color:C.accent}}>{c.id}</td>
                        <td style={sh.td}>{c.date}</td>
                        <td style={{...sh.td,fontWeight:600,fontSize:12}}>{c.serviceType}</td>
                        <td style={{...sh.td,fontSize:12,fontFamily:"monospace"}}>{c.unit==="bags"?`${c.bags} bags`:`${c.weightKg} kg`}</td>
                        <td style={{...sh.td,fontSize:11,color:C.muted}}>{c.linkedTo!=="standalone"?`${c.linkedTo.toUpperCase()} ${c.linkedId}`:"—"}</td>
                        <td style={sh.td}>
                          {c.whoBearsIt==="company"
                            ? <span style={{fontSize:11,background:"#fef3c7",color:"#92400e",padding:"2px 8px",borderRadius:10,fontWeight:600}}>Company</span>
                            : <span style={{fontSize:11,background:"#eff6ff",color:C.blue,padding:"2px 8px",borderRadius:10,fontWeight:600}}>{party?.name||"Party"}</span>}
                        </td>
                        <td style={{...sh.td,textAlign:"right",fontFamily:"monospace",fontWeight:800,color:C.accent}}>{fmt(c.amount)}</td>
                        {canDelete&&<td style={{...sh.td,textAlign:"center"}}>
                          <button onClick={()=>setConfirmId(c.id)} style={{background:"none",border:"none",color:C.red,cursor:"pointer",fontSize:14}}>🗑</button>
                        </td>}
                      </tr>
                    );
                  })}</tbody>
                  <tfoot><tr style={{background:"#f5ede4"}}>
                    <td colSpan={6} style={{padding:"10px 16px",fontWeight:800}}>Total</td>
                    <td style={{padding:"10px 16px",textAlign:"right",fontFamily:"monospace",fontWeight:800,color:C.accent}}>{fmt(filtered.reduce((s,c)=>s+parseFloat(c.amount||0),0))}</td>
                    {canDelete&&<td></td>}
                  </tr></tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LoadmanRateRow({ service, existing, dispatch }) {
  const [editing, setEditing] = useState(false);
  const [rate,    setRate]    = useState(existing?.rate||"");
  const [unit,    setUnit]    = useState(existing?.unit||"bags");
  const save = async () => {
    await dispatch({type:"SAVE_LOADMAN_RATE", data:{serviceType:service, rate:parseFloat(rate||0), unit, id:existing?.id}});
    setEditing(false);
  };
  return (
    <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:C.cream,borderRadius:8,flexWrap:"wrap"}}>
      <span style={{flex:1,fontSize:13,fontWeight:600,color:C.text}}>{service}</span>
      {editing?(
        <>
          <select value={unit} onChange={e=>setUnit(e.target.value)} style={{...sh.input,width:90}}>
            <option value="bags">per bag</option><option value="kg">per kg</option>
          </select>
          <input type="number" value={rate} onChange={e=>setRate(e.target.value)} placeholder="0.00" style={{...sh.input,width:100,textAlign:"right"}} autoFocus/>
          <Btn size="sm" variant="success" onClick={save}>✓ Save</Btn>
          <Btn size="sm" variant="ghost" onClick={()=>setEditing(false)}>Cancel</Btn>
        </>
      ):(
        <>
          <span style={{fontFamily:"monospace",fontWeight:700,color:existing?C.green:C.muted,fontSize:13}}>
            {existing?`₹${existing.rate}/${existing.unit==="bags"?"bag":"kg"}`:"Not set"}
          </span>
          <Btn size="sm" variant="outline" onClick={()=>setEditing(true)}>✏ Edit</Btn>
        </>
      )}
    </div>
  );
}

// ── LORRY MODULE ──────────────────────────────────────────────────
const LORRY_PAYABLE_PREFIX = "lorry_";
const LORRY_EXPENSE_ID     = "lorry_expense";

function LorryModule({ state, dispatch, role }) {
  const [activeTab, setActiveTab] = useState("rentals"); // rentals | owners | payments
  const [showForm,  setShowForm]  = useState(false);
  const [showOwnerForm, setShowOwnerForm] = useState(false);
  const [editOwner, setEditOwner] = useState(null);
  const [showPay,   setShowPay]   = useState(null); // ownerId
  const [confirmRentalId, setConfirmRentalId] = useState(null);

  // Rental form
  const [form, setForm] = useState({
    date:today(), lorryOwnerId:"", vehicleNo:"",
    fromLocation:"", toLocation:"", linkedTo:"standalone", linkedId:"",
    bags:"", weightKg:"", unit:"trip", rate:"", amount:"",
    whoBearsIt:"company", partyId:"", narration:"",
  });
  // Owner form
  const [ownerForm, setOwnerForm] = useState({name:"", phone:"", vehicles:""});
  // Payment form
  const [payForm, setPayForm] = useState({
    date:today(), ownerId:"", amount:"", paymentMode:"cash",
    paymentAccount:"cash", narration:"",
  });
  const [formErr, setFormErr] = useState("");
  const [payErr,  setPayErr]  = useState("");

  const canPost   = ROLES[role]?.canPost;
  const canDelete = ROLES[role]?.canDelete;

  const lorryOwners  = state.lorryOwners||[];
  const lorryRentals = state.lorryRentals||[];
  const lorryPayments= state.lorryPayments||[];
  const parties      = Object.values(state.parties);
  const cashBankAccounts = Object.values(state.accounts).filter(a=>a.group==="Cash & Bank");

  const setF = (f,v) => setForm(p=>{
    const next={...p,[f]:v};
    if(["rate","bags","weightKg"].includes(f)) {
      const qty = next.unit==="trip"?1:next.unit==="bags"?parseFloat(next.bags||0):parseFloat(next.weightKg||0);
      next.amount = (qty * parseFloat(next.rate||0)).toFixed(2);
    }
    return next;
  });

  // Per owner pending balance from accounts
  const ownerBalance = (ownerId) => {
    const accId = LORRY_PAYABLE_PREFIX + ownerId;
    return state.accounts[accId]?.balance || 0;
  };

  const totalPending = lorryOwners.reduce((s,o)=>s+ownerBalance(o.id),0);

  const submitRental = async () => {
    if (!form.lorryOwnerId)    { setFormErr("Select lorry owner"); return; }
    if (!form.vehicleNo.trim()){ setFormErr("Enter vehicle number"); return; }
    if (!form.amount||parseFloat(form.amount)<=0) { setFormErr("Enter rate/amount"); return; }
    if (form.whoBearsIt==="party"&&!form.partyId) { setFormErr("Select a party"); return; }
    setFormErr("");
    await dispatch({type:"ADD_LORRY_RENTAL", data:{...form, amount:parseFloat(form.amount)}});
    setShowForm(false);
    setForm({date:today(),lorryOwnerId:"",vehicleNo:"",fromLocation:"",toLocation:"",linkedTo:"standalone",linkedId:"",bags:"",weightKg:"",unit:"trip",rate:"",amount:"",whoBearsIt:"company",partyId:"",narration:""});
  };

  const submitOwner = async () => {
    if (!ownerForm.name.trim()) { setFormErr("Enter owner name"); return; }
    setFormErr("");
    if (editOwner) {
      await dispatch({type:"EDIT_LORRY_OWNER", id:editOwner.id, data:ownerForm});
      setEditOwner(null);
    } else {
      await dispatch({type:"ADD_LORRY_OWNER", data:ownerForm});
      setShowOwnerForm(false);
    }
    setOwnerForm({name:"",phone:"",vehicles:""});
  };

  const submitPayment = async () => {
    if (!payForm.ownerId)             { setPayErr("Select lorry owner"); return; }
    if (!payForm.amount||parseFloat(payForm.amount)<=0) { setPayErr("Enter amount"); return; }
    const pending = ownerBalance(payForm.ownerId);
    if (parseFloat(payForm.amount) > pending) { setPayErr(`Cannot pay more than pending balance ${fmt(pending)}`); return; }
    setPayErr("");
    await dispatch({type:"PAY_LORRY_OWNER", data:{...payForm, amount:parseFloat(payForm.amount)}});
    setShowPay(null);
    setPayForm({date:today(),ownerId:"",amount:"",paymentMode:"cash",paymentAccount:"cash",narration:""});
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>

      {confirmRentalId&&(
        <div style={{position:"fixed",inset:0,background:"#00000066",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div style={{background:C.surface,borderRadius:14,padding:"28px 24px",maxWidth:380,width:"100%",textAlign:"center",boxShadow:"0 20px 60px #00000044"}}>
            <div style={{fontSize:36,marginBottom:12}}>🗑</div>
            <div style={{fontWeight:800,fontSize:17,marginBottom:8}}>Delete Rental?</div>
            <div style={{fontSize:13,color:C.muted,marginBottom:20}}>Accounting entries will be reversed.</div>
            <div style={{display:"flex",gap:10,justifyContent:"center"}}>
              <Btn variant="danger" onClick={async()=>{await dispatch({type:"DELETE_LORRY_RENTAL",id:confirmRentalId});setConfirmRentalId(null);}}>Yes, Delete</Btn>
              <Btn variant="ghost" onClick={()=>setConfirmRentalId(null)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:12}}>
        <div>
          <h2 style={{margin:0,color:C.text,fontSize:20,fontWeight:800}}>🚛 Lorry Rental</h2>
          <p style={{margin:"2px 0 0",color:C.muted,fontSize:13}}>Lorry hire charges — per owner running account</p>
        </div>
        {canPost&&(
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {activeTab==="owners"&&<Btn onClick={()=>setShowOwnerForm(true)} variant="success" size="lg">+ Add Owner</Btn>}
            {activeTab==="rentals"&&<Btn onClick={()=>setShowForm(true)} variant="success" size="lg">+ New Rental</Btn>}
            {activeTab==="payments"&&<Btn onClick={()=>setShowPay("new")} variant="success" size="lg">+ Pay Owner</Btn>}
          </div>
        )}
      </div>

      {/* Summary */}
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        <div style={{...sh.card,flex:"1 1 180px",borderLeft:`4px solid ${C.red}`}}>
          <div style={{fontSize:16,marginBottom:3}}>⏳</div>
          <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase"}}>Total Pending</div>
          <div style={{fontFamily:"monospace",fontWeight:800,fontSize:20,color:totalPending>0?C.red:C.green,marginTop:3}}>{fmt(totalPending)}</div>
          <div style={{fontSize:11,color:C.muted}}>across all owners</div>
        </div>
        <div style={{...sh.card,flex:"1 1 130px"}}>
          <div style={{fontSize:16,marginBottom:3}}>🚛</div>
          <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase"}}>Total Rentals</div>
          <div style={{fontFamily:"monospace",fontWeight:800,fontSize:18,color:C.accent,marginTop:3}}>{lorryRentals.length}</div>
        </div>
        <div style={{...sh.card,flex:"1 1 130px"}}>
          <div style={{fontSize:16,marginBottom:3}}>👤</div>
          <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase"}}>Lorry Owners</div>
          <div style={{fontFamily:"monospace",fontWeight:800,fontSize:18,color:C.accent,marginTop:3}}>{lorryOwners.length}</div>
        </div>
      </div>

      {/* Sub-tabs */}
      <div style={{display:"flex",gap:6,borderBottom:`2px solid ${C.border}`}}>
        {[["rentals","🚛 Rentals"],["owners","👤 Owners"],["payments","💵 Payments"]].map(([id,label])=>(
          <button key={id} onClick={()=>setActiveTab(id)} style={{padding:"8px 16px",border:"none",borderBottom:`3px solid ${activeTab===id?C.accent:"transparent"}`,background:"transparent",color:activeTab===id?C.accent:C.muted,fontWeight:activeTab===id?700:500,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>{label}</button>
        ))}
      </div>

      {/* ── OWNERS TAB ── */}
      {activeTab==="owners"&&(
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {(showOwnerForm||editOwner)&&(
            <div style={{...sh.card,border:`2px solid ${C.accent}44`}}>
              <div style={{fontWeight:800,color:C.accent,marginBottom:12,fontSize:15}}>{editOwner?"✏ Edit Owner":"👤 New Lorry Owner"}</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:12}}>
                <Field label="Owner Name *"><input value={ownerForm.name} onChange={e=>setOwnerForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Murugan" style={sh.input} autoFocus/></Field>
                <Field label="Phone"><input value={ownerForm.phone} onChange={e=>setOwnerForm(f=>({...f,phone:e.target.value}))} placeholder="Optional" style={sh.input}/></Field>
                <Field label="Vehicle Numbers"><input value={ownerForm.vehicles} onChange={e=>setOwnerForm(f=>({...f,vehicles:e.target.value}))} placeholder="e.g. TN33 AB 1234, TN33 CD 5678" style={sh.input}/></Field>
              </div>
              {formErr&&<div style={{color:C.red,fontSize:13,fontWeight:600,marginTop:10,padding:"8px",background:"#fee2e2",borderRadius:6}}>{formErr}</div>}
              <div style={{display:"flex",gap:10,marginTop:14}}>
                <Btn onClick={submitOwner} variant="success" size="lg">✓ {editOwner?"Save Changes":"Add Owner"}</Btn>
                <Btn onClick={()=>{setShowOwnerForm(false);setEditOwner(null);setOwnerForm({name:"",phone:"",vehicles:""});setFormErr("");}} variant="ghost">Cancel</Btn>
              </div>
            </div>
          )}
          {lorryOwners.length===0?(
            <div style={{...sh.card,textAlign:"center",color:C.muted,padding:48}}><div style={{fontSize:40,marginBottom:8}}>👤</div>No lorry owners added yet.</div>
          ):lorryOwners.map(o=>{
            const pending = ownerBalance(o.id);
            const tripCount = lorryRentals.filter(r=>r.lorryOwnerId===o.id).length;
            return(
              <div key={o.id} style={sh.card}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8}}>
                  <div>
                    <div style={{fontWeight:800,fontSize:15,color:C.text}}>{o.name}</div>
                    {o.phone&&<div style={{fontSize:12,color:C.muted,marginTop:2}}>📞 {o.phone}</div>}
                    {o.vehicles&&<div style={{fontSize:12,color:C.muted}}>🚛 {o.vehicles}</div>}
                    <div style={{fontSize:12,color:C.muted,marginTop:4}}>{tripCount} trip{tripCount!==1?"s":""}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontFamily:"monospace",fontWeight:800,fontSize:18,color:pending>0?C.red:C.green}}>{fmt(pending)}</div>
                    <div style={{fontSize:11,color:C.muted}}>pending payment</div>
                    <div style={{display:"flex",gap:6,marginTop:8,justifyContent:"flex-end"}}>
                      {canPost&&pending>0&&<Btn size="sm" variant="success" onClick={()=>{setPayForm(f=>({...f,ownerId:o.id}));setShowPay("new");setActiveTab("payments");}}>💵 Pay</Btn>}
                      {canPost&&<Btn size="sm" variant="outline" onClick={()=>{setEditOwner(o);setOwnerForm({name:o.name,phone:o.phone||"",vehicles:o.vehicles||""});}}>✏ Edit</Btn>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── PAYMENTS TAB ── */}
      {activeTab==="payments"&&(
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {(showPay==="new")&&(
            <div style={{...sh.card,border:`2px solid ${C.green}44`}}>
              <div style={{fontWeight:800,color:C.green,marginBottom:12,fontSize:15}}>💵 Pay Lorry Owner</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:12}}>
                <Field label="Date"><input type="date" value={payForm.date} onChange={e=>setPayForm(f=>({...f,date:e.target.value}))} style={sh.input}/></Field>
                <Field label="Lorry Owner *">
                  <select value={payForm.ownerId} onChange={e=>{setPayForm(f=>({...f,ownerId:e.target.value}));}} style={{...sh.input,borderColor:!payForm.ownerId?"#f97316":C.border}}>
                    <option value="">— Select Owner —</option>
                    {lorryOwners.map(o=><option key={o.id} value={o.id}>{o.name} (Pending: {fmt(ownerBalance(o.id))})</option>)}
                  </select>
                </Field>
                <Field label="Amount (₹)">
                  <input type="number" value={payForm.amount} onChange={e=>setPayForm(f=>({...f,amount:e.target.value}))} placeholder="0.00" style={sh.input} autoFocus/>
                </Field>
                <Field label="Payment Mode">
                  <select value={payForm.paymentMode} onChange={e=>setPayForm(f=>({...f,paymentMode:e.target.value}))} style={sh.input}>
                    <option value="cash">Cash</option>
                    <option value="yercaud_cash">Yercaud Cash</option>
                    <option value="bank">Bank / UPI</option>
                  </select>
                </Field>
                <Field label="Pay From Account">
                  <select value={payForm.paymentAccount} onChange={e=>setPayForm(f=>({...f,paymentAccount:e.target.value}))} style={sh.input}>
                    {cashBankAccounts.map(a=><option key={a.id} value={a.id}>{a.name} ({fmt(a.balance)})</option>)}
                  </select>
                </Field>
                <Field label="Narration"><input value={payForm.narration} onChange={e=>setPayForm(f=>({...f,narration:e.target.value}))} placeholder="Optional" style={sh.input}/></Field>
              </div>
              {payErr&&<div style={{color:C.red,fontSize:13,fontWeight:600,marginTop:10,padding:"8px",background:"#fee2e2",borderRadius:6}}>{payErr}</div>}
              <div style={{display:"flex",gap:10,marginTop:14}}>
                <Btn onClick={submitPayment} variant="success" size="lg">✓ Record Payment</Btn>
                <Btn onClick={()=>{setShowPay(null);setPayErr("");}} variant="ghost">Cancel</Btn>
              </div>
            </div>
          )}
          {/* Payment history */}
          {lorryPayments.length===0?(
            <div style={{...sh.card,textAlign:"center",color:C.muted,padding:32}}><div style={{fontSize:32,marginBottom:8}}>💵</div>No payments made yet.</div>
          ):lorryPayments.map((p,i)=>{
            const owner=lorryOwners.find(o=>o.id===p.ownerId);
            return(
              <div key={p.id} style={{...sh.card,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                <div>
                  <div style={{fontWeight:700,fontSize:14}}>{owner?.name||"—"}</div>
                  <div style={{fontSize:12,color:C.muted}}>{p.date} · {p.paymentMode} · {p.narration||""}</div>
                </div>
                <div style={{fontFamily:"monospace",fontWeight:800,fontSize:16,color:C.green}}>{fmt(p.amount)}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── RENTALS TAB ── */}
      {activeTab==="rentals"&&(
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          {showForm&&(
            <div style={{...sh.card,border:`2px solid ${C.accent}44`}}>
              <div style={{fontWeight:800,color:C.accent,marginBottom:14,fontSize:15}}>🚛 New Lorry Rental</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:12}}>
                <Field label="Date"><input type="date" value={form.date} onChange={e=>setF("date",e.target.value)} style={sh.input}/></Field>
                <Field label="Lorry Owner *">
                  <select value={form.lorryOwnerId} onChange={e=>{setF("lorryOwnerId",e.target.value);const o=lorryOwners.find(x=>x.id===e.target.value);if(o?.vehicles){const v=o.vehicles.split(",")[0].trim();setF("vehicleNo",v);}}} style={{...sh.input,borderColor:!form.lorryOwnerId?"#f97316":C.border}}>
                    <option value="">— Select Owner —</option>
                    {lorryOwners.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </Field>
                <Field label="Vehicle Number *"><input value={form.vehicleNo} onChange={e=>setF("vehicleNo",e.target.value)} placeholder="TN-XX-X-XXXX" style={sh.input}/></Field>
                <Field label="From"><input value={form.fromLocation} onChange={e=>setF("fromLocation",e.target.value)} placeholder="e.g. Yercaud" style={sh.input}/></Field>
                <Field label="To"><input value={form.toLocation} onChange={e=>setF("toLocation",e.target.value)} placeholder="e.g. Pattiveeranpatti" style={sh.input}/></Field>
                <Field label="Rate Basis">
                  <select value={form.unit} onChange={e=>setF("unit",e.target.value)} style={sh.input}>
                    <option value="trip">Per Trip (flat)</option>
                    <option value="bags">Per Bag</option>
                    <option value="kg">Per KG</option>
                  </select>
                </Field>
                {form.unit==="bags"&&<Field label="No. of Bags"><input type="number" value={form.bags} onChange={e=>setF("bags",e.target.value)} placeholder="0" style={sh.input}/></Field>}
                {form.unit==="kg"&&<Field label="Weight (KG)"><input type="number" value={form.weightKg} onChange={e=>setF("weightKg",e.target.value)} placeholder="0" style={sh.input}/></Field>}
                <Field label="Rate (₹)"><input type="number" value={form.rate} onChange={e=>setF("rate",e.target.value)} placeholder="0.00" style={sh.input}/></Field>
                <Field label="Amount (₹)"><input value={form.amount} readOnly style={{...sh.input,background:"#f0fdf4",fontWeight:800,color:C.green}}/></Field>
                <Field label="Linked To">
                  <select value={form.linkedTo} onChange={e=>setF("linkedTo",e.target.value)} style={sh.input}>
                    <option value="standalone">Standalone</option>
                    <option value="grn">GRN</option>
                    <option value="sale">Sale</option>
                    <option value="transfer">Transfer</option>
                  </select>
                </Field>
                {form.linkedTo!=="standalone"&&<Field label={`${form.linkedTo.toUpperCase()} ID`}><input value={form.linkedId} onChange={e=>setF("linkedId",e.target.value)} placeholder="e.g. GRN-0001" style={sh.input}/></Field>}
                <Field label="Who Bears Cost?">
                  <select value={form.whoBearsIt} onChange={e=>setF("whoBearsIt",e.target.value)} style={sh.input}>
                    <option value="company">Company</option>
                    <option value="party">Party</option>
                  </select>
                </Field>
                {form.whoBearsIt==="party"&&(
                  <Field label="Party">
                    <select value={form.partyId} onChange={e=>setF("partyId",e.target.value)} style={{...sh.input,borderColor:!form.partyId?"#f97316":C.border}}>
                      <option value="">— Select Party —</option>
                      {parties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </Field>
                )}
                <Field label="Narration"><input value={form.narration} onChange={e=>setF("narration",e.target.value)} placeholder="Optional" style={sh.input}/></Field>
              </div>
              {parseFloat(form.amount||0)>0&&(
                <div style={{marginTop:12,padding:"10px 14px",background:"#f5ede4",borderRadius:8,fontSize:12}}>
                  <strong>Entry: </strong>
                  {form.whoBearsIt==="company"
                    ? <>Dr <strong>Lorry Expense</strong> → Cr <strong>{lorryOwners.find(o=>o.id===form.lorryOwnerId)?.name||"Owner"} Payable</strong> · {fmt(form.amount)}</>
                    : <>Dr <strong>{state.parties[form.partyId]?.name||"Party"}</strong> → Cr <strong>{lorryOwners.find(o=>o.id===form.lorryOwnerId)?.name||"Owner"} Payable</strong> · {fmt(form.amount)}</>}
                </div>
              )}
              {formErr&&<div style={{color:C.red,fontSize:13,fontWeight:600,marginTop:10,padding:"8px",background:"#fee2e2",borderRadius:6}}>{formErr}</div>}
              <div style={{display:"flex",gap:10,marginTop:14}}>
                <Btn onClick={submitRental} variant="success" size="lg">✓ Save Rental</Btn>
                <Btn onClick={()=>{setShowForm(false);setFormErr("");}} variant="ghost">Cancel</Btn>
              </div>
            </div>
          )}

          {lorryRentals.length===0?(
            <div style={{...sh.card,textAlign:"center",color:C.muted,padding:48}}><div style={{fontSize:40,marginBottom:8}}>🚛</div>No lorry rentals recorded yet.</div>
          ):(
            <div style={{...sh.card,padding:0,overflow:"hidden"}}>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",minWidth:600}}>
                  <thead><tr style={{background:"#f5ede4"}}>
                    <th style={sh.th}>ID</th><th style={sh.th}>Date</th><th style={sh.th}>Owner</th>
                    <th style={sh.th}>Vehicle</th><th style={sh.th}>Route</th>
                    <th style={sh.th}>Linked</th><th style={sh.th}>Bears</th>
                    <th style={{...sh.th,textAlign:"right"}}>Amount</th>
                    {canDelete&&<th style={{...sh.th,width:36}}></th>}
                  </tr></thead>
                  <tbody>{lorryRentals.map((r,i)=>{
                    const owner=lorryOwners.find(o=>o.id===r.lorryOwnerId);
                    const party=state.parties[r.partyId];
                    return(
                      <tr key={r.id} style={{background:i%2===0?C.surface:C.cream}}>
                        <td style={{...sh.td,fontFamily:"monospace",fontSize:11,fontWeight:700,color:C.accent}}>{r.id}</td>
                        <td style={sh.td}>{r.date}</td>
                        <td style={{...sh.td,fontWeight:600}}>{owner?.name||"—"}</td>
                        <td style={{...sh.td,fontSize:12,fontFamily:"monospace"}}>{r.vehicleNo}</td>
                        <td style={{...sh.td,fontSize:12,color:C.muted}}>{r.fromLocation&&r.toLocation?`${r.fromLocation} → ${r.toLocation}`:"—"}</td>
                        <td style={{...sh.td,fontSize:11,color:C.muted}}>{r.linkedTo!=="standalone"?`${r.linkedTo.toUpperCase()} ${r.linkedId}`:"—"}</td>
                        <td style={sh.td}>
                          {r.whoBearsIt==="company"
                            ? <span style={{fontSize:11,background:"#fef3c7",color:"#92400e",padding:"2px 8px",borderRadius:10,fontWeight:600}}>Company</span>
                            : <span style={{fontSize:11,background:"#eff6ff",color:C.blue,padding:"2px 8px",borderRadius:10,fontWeight:600}}>{party?.name||"Party"}</span>}
                        </td>
                        <td style={{...sh.td,textAlign:"right",fontFamily:"monospace",fontWeight:800,color:C.accent}}>{fmt(r.amount)}</td>
                        {canDelete&&<td style={{...sh.td,textAlign:"center"}}>
                          <button onClick={()=>setConfirmRentalId(r.id)} style={{background:"none",border:"none",color:C.red,cursor:"pointer",fontSize:14}}>🗑</button>
                        </td>}
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── APP ───────────────────────────────────────────────────────────
const NAV=[
  {id:"dashboard", label:"Dashboard",    icon:"🏠"},
  {id:"grn",       label:"Purchase GRN", icon:"📋"},
  {id:"yercaud",   label:"Yercaud Payments",icon:"🌿"},
  {id:"loadman",   label:"Loadman Charges", icon:"👷"},
  {id:"lorry",     label:"Lorry Rental",    icon:"🚛"},
  {id:"transfer",  label:"Stock Transfer",  icon:"↔️", branchVisible:true},
  {id:"drying",    label:"Drying",       icon:"🌡️",  branchHidden:true},
  {id:"hulling",   label:"Hulling",      icon:"⚙️",  branchHidden:true},
  {id:"sales",     label:"Sales",        icon:"🏷",   branchHidden:true},
  {id:"storage",   label:"Party Storage",icon:"🏭",   branchHidden:true},
  {id:"daybook",   label:"Day Book",     icon:"📓",   branchHidden:true},
  {id:"ledger",    label:"Ledger",       icon:"📒",   branchHidden:true},
  {id:"pl",        label:"Profit & Loss",icon:"📈", adminOnly:true},
  {id:"trial",     label:"Trial Balance",icon:"⚖️",   branchHidden:true},
  {id:"outstanding",label:"Outstanding", icon:"📊",   branchHidden:true},
  {id:"stock",     label:"Stock",        icon:"☕"},
  {id:"parties",   label:"Parties",      icon:"👥"},
  {id:"accounts",  label:"Accounts",     icon:"🗂",   branchHidden:true},
  {id:"opening",   label:"Opening Balance",icon:"🏦", adminOnly:true},
  {id:"masters",   label:"Masters",      icon:"🗂️", adminOnly:true},
  {id:"users",     label:"Users",        icon:"👤", adminOnly:true},
];

export default function App() {
  const [tab, setTab]               = useState("dashboard");
  const [currentUser, setCurrentUser] = useState(()=>{
    try { const u=localStorage.getItem("cv_user"); return u?JSON.parse(u):null; } catch{ return null; }
  });
  const [loading, setLoading]       = useState(false);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState("");

  // ── ALL DATA FROM SUPABASE ───────────────────────────────────
  const [accounts,   setAccounts]   = useState({});
  const [parties,    setParties]    = useState({});
  const [vouchers,   setVouchers]   = useState([]);
  const [stockItems, setStockItems] = useState([]);
  const [grns,       setGRNs]       = useState([]);
  const [users,      setUsers]      = useState([]);
  const [warehouses,   setWarehouses]   = useState([]);
  const [locations,    setLocations]    = useState([]);
  const [coffeeTypes,  setCoffeeTypes]  = useState([]);
  const [dryingJobs,   setDryingJobs]   = useState([]);
  const [storageLots,  setStorageLots]  = useState([]);
  const [storageReleases, setStorageReleases] = useState([]);
  const [hullingJobs,  setHullingJobs]  = useState([]);
  const [sales,        setSales]        = useState([]);
  const [transfers,    setTransfers]    = useState([]);
  const [yercaudPayments, setYercaudPayments] = useState([]);
  const [loadmanCharges, setLoadmanCharges]   = useState([]);
  const [loadmanRates,   setLoadmanRates]     = useState([]);
  const [lorryOwners,    setLorryOwners]      = useState([]);
  const [lorryRentals,   setLorryRentals]     = useState([]);
  const [lorryPayments,  setLorryPayments]    = useState([]);

  // Compute stock from vouchers (no separate stock table needed)
  const stock = useMemo(() => {
    const s = {};
    // GRN IDs that have drying OR hulling — their PuV vouchers should NOT add to stock
    const dryingGrnRefs = new Set(
      grns.filter(g => (g.hasDrying===true||g.hasDrying==="true") && parseFloat(g.dryKg||0)>0)
          .map(g => g.id)
    );
    const hulledGrnRefs = new Set(
      (hullingJobs||[]).map(h => h.grnId).filter(Boolean)
    );

    // From purchase vouchers only (SV handled by sales records below)
    vouchers.forEach(v => {
      const items = v.items || [];
      const vt = v.voucherType || v.voucher_type;
      if (vt !== "PuV") return; // Only PuV adds stock here
      if (v.reference && (dryingGrnRefs.has(v.reference)||hulledGrnRefs.has(v.reference))) return;
      items.forEach(it => {
        if (!it.itemName) return;
        s[it.itemName] = (s[it.itemName]||0) + parseFloat(it.qty||0);
      });
    });


    // From GRNs — net weight into stock, handle drying/hulling
    const DRYING_OUTPUT = {"Wet Parchment":"Parchment","Raw Cherry":"Dry Cherry"};
    const hulledGrnSet  = new Set((hullingJobs||[]).map(h=>h.grnId).filter(Boolean));
    grns.forEach(g => {
      if (!g.coffeeType || !g.netWeight) return;
      // If fully hulled, skip — hulling job handles stock
      if (hulledGrnSet.has(g.id)) return;
      const netWt  = parseFloat(g.netWeight||0);
      const dryKg  = parseFloat(g.dryKg||0);
      const hasDry = g.hasDrying===true || g.hasDrying==="true" || g.hasDrying===1;
      const ct     = (g.coffeeType||"").trim();
      if (hasDry && dryKg>0) {
        const outputType = (g.outputType||"").trim() || DRYING_OUTPUT[ct] || ct;
        s[outputType] = (s[outputType]||0) + dryKg;
      } else if (hasDry && !dryKg) {
        s[ct] = (s[ct]||0) + netWt;
      } else {
        s[ct] = (s[ct]||0) + netWt;
      }
    });
    // From Hulling jobs — input out, grades in
    (hullingJobs||[]).forEach(h => {
      if (!h.coffeeType || !h.inputQty) return;
      // Input coffee type goes OUT
      s[h.coffeeType] = (s[h.coffeeType]||0) - parseFloat(h.inputQty||0);
      // Husk is waste — not in stock
      // Grades come IN
      const grades = {
        "Grade AAA": parseFloat(h.gradeAAA||0),
        "Grade AA":  parseFloat(h.gradeAA||0),
        "Grade A":   parseFloat(h.gradeA||0),
        "Grade B":   parseFloat(h.gradeB||0),
        "Grade C":   parseFloat(h.gradeC||0),
        "Grade PB":  parseFloat(h.gradePB||0),
        "Grade BBB": parseFloat(h.gradeBBB||0),
        "Bits":      parseFloat(h.gradeBits||0),
        "Grade IDB": parseFloat(h.gradeIDB||0),
      };
      Object.entries(grades).forEach(([grade,qty])=>{
        if (qty>0) s[grade] = (s[grade]||0) + qty;
      });
    });
    // From Sales records — reduce stock for each sold item
    (sales||[]).forEach(sale => {
      (sale.items||[]).forEach(it => {
        if (!it.grade || !it.qty) return;
        s[it.grade] = (s[it.grade]||0) - parseFloat(it.qty||0);
      });
    });

    return s;
  }, [vouchers, grns, hullingJobs, sales]);

  // ── LOAD ALL DATA ON LOGIN ────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [accs, parts, vouchs, sitems, grnList, userList, whs, locs, ctypes, dryList, storList, relList, hullList, salesList, transferList, yercaudList, ldCharges, ldRates, lorryOwnerList, lorryRentalList, lorryPayList] = await Promise.all([
        db.getAccounts(), db.getParties(), db.getVouchers(), db.getStockItems(),
        db.getGRNs(), db.getUsers(), db.getWarehouses(), db.getLocations(),
        db.getCoffeeTypes(), db.getDryingJobs(), db.getStorageLots(),
        db.getStorageReleases(), db.getHullingJobs(), db.getSales(), db.getTransfers(),
        db.getYercaudPayments(), db.getLoadmanCharges(), db.getLoadmanRates(),
        db.getLorryOwners(), db.getLorryRentals(), db.getLorryPayments(),
      ]);
      // Columns are now camelCase in DB after migration
      const accsObj = {};
      (accs||[]).forEach(a => {
        accsObj[a.id] = {
          ...a,
          isParty:       a.isParty       ?? a.is_party       ?? false,
          isBankAccount: a.isBankAccount ?? a.is_bank_account ?? false,
          accountNo:     a.accountNo     || a.account_no     || "",
        };
      });
      setAccounts(accsObj);
      const partsObj = {};
      (parts||[]).forEach(p => { partsObj[p.id] = p; });
      setParties(partsObj);
      const normalized = (vouchs||[]).map(v=>({
        ...v,
        entries:  v.entries||[],
        items:    v.items||[],
        postedAt: v.posted_at,
        editedAt: v.edited_at,
      }));
      setVouchers(normalized);
      setStockItems(sitems||[]);
      // GRNs - all columns are camelCase in DB
      setGRNs(grnList||[]);
      setUsers(userList||[]);
      setWarehouses(whs||[]);
      setLocations(locs||[]);
      setCoffeeTypes(ctypes||[]);
      setDryingJobs(dryList||[]);
      setStorageLots(storList||[]);
      setStorageReleases(relList||[]);
      setHullingJobs(hullList||[]);
      setSales(salesList||[]);
      setTransfers(transferList||[]);
      setYercaudPayments(yercaudList||[]);
      setLoadmanCharges(ldCharges||[]);
      setLoadmanRates(ldRates||[]);
      setLorryOwners(lorryOwnerList||[]);
      setLorryRentals(lorryRentalList||[]);
      setLorryPayments(lorryPayList||[]);
    } catch(e) {
      setError("Failed to load data: " + e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (currentUser) loadAll(); }, [currentUser, loadAll]);

  // ── COMPUTE ACCURATE BALANCES FROM VOUCHERS ──────────────────
  const accurateAccounts = useMemo(() => {
    const bal = {};
    vouchers.forEach(v => {
      (v.entries||[]).forEach(e => {
        if (!e.accountId || !accounts[e.accountId]) return;
        const acc = accounts[e.accountId];
        const dr = parseFloat(e.dr||0), cr = parseFloat(e.cr||0);
        const isDebitNormal = ["asset","expense"].includes(acc.type);
        bal[e.accountId] = (bal[e.accountId]||0) + (isDebitNormal ? dr-cr : cr-dr);
      });
    });
    // Return accounts map with computed balance overriding DB balance
    const result = {};
    Object.values(accounts).forEach(a => {
      result[a.id] = { ...a, balance: bal[a.id]||0 };
    });
    return result;
  }, [accounts, vouchers]);

  // ── BUILD STATE SHAPE compatible with all existing components ─
  const state = {
    accounts: accurateAccounts, parties, vouchers, stockItems, grns, users, stock,
    warehouses, locations, coffeeTypes, dryingJobs, storageLots, storageReleases,
    hullingJobs, sales, transfers, yercaudPayments,
    loadmanCharges, loadmanRates, lorryOwners, lorryRentals, lorryPayments,
    nextVoucherNo:{RV:1,PV:1,CV:1,JV:1,SV:1,PuV:1},
    nextId:1, nextGRN:1,
  };

  // ── DISPATCH — now async, calls Supabase then refreshes ───────
  const dispatch = useCallback(async (action) => {
    setSaving(true);
    setError("");
    try {
      switch(action.type) {

        // ── MASTERS ────────────────────────────────────────────
        case "ADD_WAREHOUSE":    await db.addWarehouse(action.name);              break;
        case "EDIT_WAREHOUSE":   await db.editWarehouse(action.id, action.name);  break;
        case "DELETE_WAREHOUSE": await db.deleteWarehouse(action.id);             break;
        case "ADD_LOCATION":     await db.addLocation(action.name);               break;
        case "EDIT_LOCATION":    await db.editLocation(action.id, action.name);   break;
        case "DELETE_LOCATION":  await db.deleteLocation(action.id);              break;
        case "ADD_COFFEE_TYPE":  await db.addCoffeeType(action.name);             break;
        case "EDIT_COFFEE_TYPE": await db.editCoffeeType(action.id, action.name); break;
        case "DELETE_COFFEE_TYPE":await db.deleteCoffeeType(action.id);           break;

        // ── SAFE DELETE ─────────────────────────────────────────
        case "DELETE_PARTY":   await db.deleteParty(action.id, vouchers, grns);   break;
        case "DELETE_ACCOUNT": await db.deleteAccount(action.id, vouchers, grns); break;

        // ── DRYING JOBS ─────────────────────────────────────────
        case "ADD_DRYING_JOB": {
          const seq = await db.getDryingSeq();
          const id = `DRY-${String(seq).padStart(4,"0")}`;
          await db.incDryingSeq(seq);
          await db.addDryingJob({ id, ...action.data });
          // Auto-post receipt voucher for drying charges if party selected
          if (action.data.partyId && parseFloat(action.data.totalCharge||0) > 0) {
            const vSeq = await db.getSeq("RV");
            const vId = `RV-${String(vSeq).padStart(4,"0")}`;
            await db.incSeq("RV", vSeq);
            const entries = [
              { accountId: action.data.partyId, dr: action.data.totalCharge, cr: 0, narration: `Drying charges - ${id}` },
              { accountId: "drying",             dr: 0, cr: action.data.totalCharge, narration: `Drying charges - ${id}` },
            ];
            await db.addVoucher({ id:vId, voucherType:"RV", date:action.data.date, narration:`Drying charges for ${id}`, reference:id, entries, items:[] });
            await db.applyEntries(accounts, entries, 1);
          }
          break;
        }
        case "DELETE_DRYING_JOB": await db.deleteDryingJob(action.id); break;

        // ── STORAGE LOTS ────────────────────────────────────────
        case "ADD_STORAGE_LOT": {
          const seq = await db.getStorageSeq();
          const id = `STR-${String(seq).padStart(4,"0")}`;
          await db.incStorageSeq(seq);
          await db.addStorageLot({ id, ...action.data });
          break;
        }
        case "DELETE_STORAGE_LOT": await db.deleteStorageLot(action.id); break;
        case "RELEASE_STORAGE": {
          const seq = await db.getStorageSeq();
          const id = `REL-${String(seq).padStart(4,"0")}`;
          await db.incStorageSeq(seq);
          // Check if lot fully released
          const lot = storageLots.find(l=>l.id===action.data.lotId);
          const prevReleased = storageReleases.filter(r=>r.lotId===action.data.lotId).reduce((s,r)=>s+parseFloat(r.quantityReleased||0),0);
          const totalReleased = prevReleased + parseFloat(action.data.quantityReleased||0);
          const newStatus = totalReleased >= parseFloat(lot?.quantity||0) ? "released" : "partially_released";
          await db.addStorageRelease({ id, ...action.data });
          await db.updateStorageStatus(action.data.lotId, newStatus);
          // Post charge voucher if applicable
          if (parseFloat(action.data.totalCharge||0) > 0 && action.data.partyId) {
            const vSeq = await db.getSeq("RV");
            const vId = `RV-${String(vSeq).padStart(4,"0")}`;
            await db.incSeq("RV", vSeq);
            const entries = [
              { accountId: action.data.partyId, dr: action.data.totalCharge, cr: 0, narration: `Storage/drying charges - ${id}` },
              { accountId: "drying",             dr: 0, cr: action.data.totalCharge, narration: `Storage charges - ${id}` },
            ];
            await db.addVoucher({ id:vId, voucherType:"RV", date:action.data.date, narration:`Storage charges for ${id}`, reference:id, entries, items:[] });
            await db.applyEntries(accounts, entries, 1);
          }
          break;
        }
        case "ADD_USER": {
          const d = action.data;
          // cv_users.id is UUID — must use gen_random_uuid() via RPC or insert without id (let DB default)
          await sb("POST","cv_users",{body:{
            username:  d.username,
            password:  d.password,
            name:      d.name,
            role:      d.role,
            location:  d.role==="branch" ? "yercaud" : "hq",
            branchName: d.branchName || (d.role==="branch" ? "Yercaud" : "Head Office"),
          }});
          break;
        }
        case "EDIT_USER":   await db.editUser(action.id, action.data); break;
        case "DELETE_USER": await db.deleteUser(action.id);  break;

        // ── HULLING JOBS ────────────────────────────────────────
        case "ADD_HULLING_JOB": {
          const seq = await db.getHullingSeq();
          const id = `HUL-${String(seq).padStart(4,"0")}`;
          await db.incHullingSeq(seq);
          const d = action.data;
          await db.addHullingJob({ id, ...d });
          if (parseFloat(d.curingCharge||0)>0) {
            const vSeq = await db.getSeq("JV");
            const vId = `JV-${String(vSeq).padStart(4,"0")}`;
            await db.incSeq("JV", vSeq);
            let entries;
            if (d.ownership==="party") {
              // Party coffee → Dr Party, Cr Curing Income
              entries = [
                {accountId:d.partyId,       dr:d.curingCharge, cr:0,             narration:`Curing charges - ${id}`},
                {accountId:"curing",         dr:0,              cr:d.curingCharge, narration:`Curing income - ${id}`},
              ];
            } else {
              // Our coffee → Dr Curing Expense, Cr Curing Income
              entries = [
                {accountId:"curing_expense", dr:d.curingCharge, cr:0,             narration:`Curing expense - ${id}`},
                {accountId:"curing",         dr:0,              cr:d.curingCharge, narration:`Curing income - ${id}`},
              ];
            }
            await db.addVoucher({id:vId,voucherType:"JV",date:d.date,narration:`Curing charges ${id} (${d.inputQty}kg × ₹${d.curingRate})`,reference:id,entries,items:[]});
            await db.applyEntries(accounts,entries,1);
          }
          break;
        }
        case "DELETE_HULLING_JOB": await db.deleteHullingJob(action.id); break;

        // ── SALES ────────────────────────────────────────────────
        case "ADD_SALE": {
          const seq = await db.getSalesSeq();
          const id = `SAL-${String(seq).padStart(4,"0")}`;
          await db.incSalesSeq(seq);
          const d = action.data;
          await db.addSale({ id, ...d });
          // Post Sales voucher: Dr Buyer, Cr Sales
          const vSeq = await db.getSeq("SV");
          const vId = `SV-${String(vSeq).padStart(4,"0")}`;
          await db.incSeq("SV", vSeq);
          const entries = [
            {accountId:d.buyerId, dr:d.totalAmount, cr:0,           narration:`Sales - ${id}`},
            {accountId:"sales",   dr:0,             cr:d.totalAmount, narration:`Sales - ${id}`},
          ];
          const items = d.items.map(it=>({itemName:it.grade,qty:it.qty,unit:"kg",rate:it.rate||0,amount:it.amount}));
          await db.addVoucher({id:vId,voucherType:"SV",date:d.date,narration:`Sales ${id}${d.narration?` - ${d.narration}`:""}`,reference:id,entries,items});
          await db.applyEntries(accounts,entries,1);
          break;
        }
        case "DELETE_SALE": await db.deleteSale(action.id); break;

        // ── STOCK TRANSFERS ──────────────────────────────────────
        case "ADD_TRANSFER": {
          const seq = await db.getTransferSeq();
          const id = `TRF-${String(seq).padStart(4,"0")}`;
          await db.incTransferSeq(seq);
          await db.addTransfer({ id, ...action.data, status:"pending" });
          break;
        }
        case "ACCEPT_TRANSFER": {
          await db.updateTransfer(action.id, {
            status:"accepted",
            acceptedBy: action.acceptedBy,
            acceptedAt: new Date().toISOString(),
          });
          break;
        }

        // ── ACCOUNTS ───────────────────────────────────────────
        case "ADD_ACCOUNT": {
          const id = "acc_" + Date.now();
          await db.addAccount({ id, ...action.data, balance:0 });
          break;
        }

        // ── PARTIES ────────────────────────────────────────────
        case "ADD_PARTY": {
          const id = "party_" + Date.now();
          const isCustomer = action.data.partyType === "customer";
          await db.addParty({ id, ...action.data });
          try {
            await db.addAccount({
              id,
              name:    action.data.name,
              balance: 0,
              isParty: true,
              "group": isCustomer ? "Debtors" : "Creditors",
              type:    isCustomer ? "asset"   : "liability",
            });
          } catch(e) {
            console.error("Party account creation failed:", e.message);
            // Try alternate insert with explicit group key
            await sb("POST","cv_accounts",{body:{
              id,
              name:    action.data.name,
              balance: 0,
              isParty: true,
              group:   isCustomer ? "Debtors" : "Creditors",
              type:    isCustomer ? "asset"   : "liability",
            }});
          }
          break;
        }
        case "EDIT_PARTY": {
          const isCustomer = action.data.partyType === "customer";
          await db.editParty(action.id, action.data);
          await db.patchBalance(action.id, accounts[action.id]?.balance||0); // keep balance
          // Update account group/type too
          await sb("PATCH","cv_accounts",{
            body:{
              name: action.data.name,
              group: isCustomer?"Debtors":"Creditors",
              type:  isCustomer?"asset":"liability",
            },
            q:`?id=eq.${action.id}`
          });
          break;
        }

        // ── STOCK ITEMS ────────────────────────────────────────
        case "ADD_STOCK_ITEM":
          await db.addStockItem(action.name); break;
        case "EDIT_STOCK_ITEM":
          await db.renameStockItem(action.oldName, action.newName); break;
        case "DELETE_STOCK_ITEM":
          await db.deleteStockItem(action.name); break;

        // ── VOUCHERS ───────────────────────────────────────────
        case "POST_VOUCHER": {
          const vt = action.data.voucherType;
          const nextNo = await db.getSeq(vt);
          const id = `${vt}-${String(nextNo).padStart(4,"0")}`;
          await db.incSeq(vt, nextNo);
          await db.addVoucher({
            id,
            voucherType: vt,
            date: action.data.date,
            narration: action.data.narration||"",
            reference: action.data.reference||"",
            entries: action.data.entries||[],
            items: action.data.items||[],
          });
          await db.applyEntries(accounts, action.data.entries||[], 1);
          break;
        }
        case "DELETE_VOUCHER": {
          const v = vouchers.find(x=>x.id===action.id);
          if (!v) break;
          await db.applyEntries(accounts, v.entries||[], -1);
          await db.deleteVoucher(action.id);
          break;
        }
        case "EDIT_VOUCHER": {
          const old = vouchers.find(x=>x.id===action.id);
          if (!old) break;
          await db.applyEntries(accounts, old.entries||[], -1);
          await db.applyEntries(accounts, action.data.entries||[], 1);
          await db.patchVoucher(action.id, {
            voucherType: action.data.voucherType,
            date: action.data.date,
            narration: action.data.narration||"",
            reference: action.data.reference||"",
            entries: action.data.entries||[],
            items: action.data.items||[],
            edited_at: new Date().toISOString(),
          });
          break;
        }

        // ── GRNs ───────────────────────────────────────────────
        case "ADD_GRN": {
          const nextNo = await db.getGRNSeq();
          const id = `GRN-${String(nextNo).padStart(4,"0")}`;
          await db.incGRNSeq(nextNo);
          const d = action.data;
          await db.addGRN({
            id,
            date:d.date, partyId:d.partyId, truckNo:d.truckNo,
            coffeeType:d.coffeeType, cropSeason:d.cropSeason,
            totalBags:parseFloat(d.totalBags||0),
            noOfBags:parseFloat(d.totalBags||0),
            noOfUnits:parseFloat(d.noOfUnits||0),
            noOfPaka:parseFloat(d.noOfPaka||0),
            totalPaka:parseFloat(d.totalPaka||0),
            bagType:d.bagType, inputMode:d.inputMode||"kg",
            location:d.location,
            firstWeight:parseFloat(d.firstWeight||0),
            secondWeight:parseFloat(d.secondWeight||0),
            grossWeight:parseFloat(d.grossWeight||0),
            rejectedBags:parseFloat(d.rejectedBags||0),
            netWeight:parseFloat(d.netWeight||0),
            warehouse:d.warehouse, warehouseZone:d.warehouseZone||"",
            stockNo:d.stockNo||"", remarks:d.remarks||"", narration:d.narration||"",
            grnType:d.grnType||"purchase",
            purchaseQtyKg:parseFloat(d.purchaseQtyKg||0),
            storageQtyKg:parseFloat(d.storageQtyKg||0),
            rateType:d.rateType||"per_kg",
            rate:parseFloat(d.rate||0),
            ratePending:d.ratePending||false,
            purchaseValue:parseFloat(d.purchaseValue||0),
            hasDrying:d.hasDrying||false,
            dryingMethod:d.dryingMethod||"Yard",
            dryKg:parseFloat(d.dryKg||0),
            outputType:d.outputType||"",
            priceBasis:d.priceBasis||"wet",
            dryingRate:parseFloat(d.dryingRate||0),
            dryingCharge:parseFloat(d.dryingCharge||0),
          });

          // Auto-post purchase voucher if rate known
          if (!d.ratePending && parseFloat(d.purchaseValue||0)>0 && d.partyId && (d.grnType==="purchase"||d.grnType==="both")) {
            const vSeq = await db.getSeq("PuV");
            const vId = `PuV-${String(vSeq).padStart(4,"0")}`;
            await db.incSeq("PuV", vSeq);
            const entries = [
              {accountId:"purchases", dr:d.purchaseValue, cr:0, narration:`Purchase - ${id}`},
              {accountId:d.partyId,   dr:0, cr:d.purchaseValue, narration:`Purchase - ${id}`},
            ];
            await db.addVoucher({id:vId,voucherType:"PuV",date:d.date,narration:`Purchase GRN ${id}`,reference:id,entries,items:[{itemName:d.coffeeType,qty:d.netWeight,unit:"kg",rate:d.rate,amount:d.purchaseValue}]});
            await db.applyEntries(accounts,entries,1);
          }

          // Drying charge handling - always on dry kg
          if (d.hasDrying && parseFloat(d.dryingCharge||0)>0) {
            const vSeq = await db.getSeq("JV");
            const vId = `JV-${String(vSeq).padStart(4,"0")}`;
            await db.incSeq("JV", vSeq);
            let entries;
            if (d.priceBasis==="wet") {
              // Company expense — Dr Drying Expense, Cr Drying Income
              entries = [
                {accountId:"drying",  dr:d.dryingCharge, cr:0, narration:`Drying expense (wet basis) - ${id}`},
                {accountId:"drying",  dr:0, cr:d.dryingCharge, narration:`Drying income - ${id}`},
              ];
            } else {
              // Bill to party — Dr Party, Cr Drying Income
              entries = [
                {accountId:d.partyId, dr:d.dryingCharge, cr:0, narration:`Drying charge billed - ${id}`},
                {accountId:"drying",  dr:0, cr:d.dryingCharge, narration:`Drying income - ${id}`},
              ];
            }
            await db.addVoucher({id:vId,voucherType:"JV",date:d.date,narration:`Drying charges GRN ${id} (${d.dryKg}kg × ₹${d.dryingRate})`,reference:id,entries,items:[]});
            await db.applyEntries(accounts,entries,1);
          }
          break;
        }

        case "EDIT_GRN": {
          const old = grns.find(x=>x.id===action.id);
          const d = action.data;
          const wasRatePending = old?.ratePending;
          const nowRateSet = !d.ratePending && d.rate && parseFloat(d.rate)>0;
          await db.editGRN(action.id, {
            date:d.date, partyId:d.partyId, truckNo:d.truckNo,
            coffeeType:d.coffeeType, cropSeason:d.cropSeason,
            totalBags:parseFloat(d.totalBags||0),
            noOfBags:parseFloat(d.totalBags||0),
            noOfUnits:parseFloat(d.noOfUnits||0),
            noOfPaka:parseFloat(d.noOfPaka||0),
            totalPaka:parseFloat(d.totalPaka||0),
            bagType:d.bagType, inputMode:d.inputMode||"kg",
            location:d.location,
            firstWeight:parseFloat(d.firstWeight||0),
            secondWeight:parseFloat(d.secondWeight||0),
            grossWeight:parseFloat(d.grossWeight||0),
            rejectedBags:parseFloat(d.rejectedBags||0),
            netWeight:parseFloat(d.netWeight||0),
            warehouse:d.warehouse, warehouseZone:d.warehouseZone||"",
            stockNo:d.stockNo||"", remarks:d.remarks||"", narration:d.narration||"",
            grnType:d.grnType||"purchase",
            purchaseQtyKg:parseFloat(d.purchaseQtyKg||0),
            storageQtyKg:parseFloat(d.storageQtyKg||0),
            rateType:d.rateType||"per_kg", rate:parseFloat(d.rate||0),
            ratePending:d.ratePending||false,
            purchaseValue:parseFloat(d.purchaseValue||0),
            hasDrying:d.hasDrying||false,
            dryingMethod:d.dryingMethod||"Yard",
            dryKg:parseFloat(d.dryKg||0),
            outputType:d.outputType||"",
            priceBasis:d.priceBasis||"wet",
            dryingRate:parseFloat(d.dryingRate||0),
            dryingCharge:parseFloat(d.dryingCharge||0),
          });
          // Post purchase voucher when rate confirmed from pending
          if (wasRatePending && nowRateSet && d.partyId && parseFloat(d.purchaseValue||0)>0) {
            const vSeq = await db.getSeq("PuV");
            const vId = `PuV-${String(vSeq).padStart(4,"0")}`;
            await db.incSeq("PuV", vSeq);
            // Use dry kg as billing qty if drying enabled
            const billingQty = d.hasDrying && parseFloat(d.dryKg||0)>0 ? d.dryKg : d.netWeight;
            const entries = [
              {accountId:"purchases", dr:d.purchaseValue, cr:0, narration:`Purchase - ${action.id}`},
              {accountId:d.partyId,   dr:0, cr:d.purchaseValue, narration:`Purchase - ${action.id}`},
            ];
            await db.addVoucher({id:vId,voucherType:"PuV",date:d.date,narration:`Purchase GRN ${action.id}`,reference:action.id,entries,items:[{itemName:d.coffeeType,qty:billingQty,unit:"kg",rate:d.rate,amount:d.purchaseValue}]});
            await db.applyEntries(accounts,entries,1);
          }

          // Post drying voucher if dryKg is set, drying charge > 0, and no drying voucher exists yet
          const newDryKg = parseFloat(d.dryKg||0);
          const dryingChargeAmt = parseFloat(d.dryingCharge||0);
          const dryingVoucherExists = vouchers.some(v => v.reference===action.id && v.voucherType==="JV");
          if (newDryKg>0 && d.hasDrying && dryingChargeAmt>0 && d.partyId && !dryingVoucherExists) {
            const vSeq = await db.getSeq("JV");
            const vId = `JV-${String(vSeq).padStart(4,"0")}`;
            await db.incSeq("JV", vSeq);
            let entries;
            if (d.priceBasis==="wet") {
              entries = [
                {accountId:"drying", dr:dryingChargeAmt, cr:0, narration:`Drying expense (wet basis) - ${action.id}`},
                {accountId:"drying", dr:0, cr:dryingChargeAmt, narration:`Drying income - ${action.id}`},
              ];
            } else {
              entries = [
                {accountId:d.partyId, dr:dryingChargeAmt, cr:0, narration:`Drying charge - ${action.id}`},
                {accountId:"drying",  dr:0, cr:dryingChargeAmt, narration:`Drying income - ${action.id}`},
              ];
            }
            await db.addVoucher({id:vId,voucherType:"JV",date:d.date,narration:`Drying charges GRN ${action.id} (${newDryKg}kg × ₹${d.dryingRate})`,reference:action.id,entries,items:[]});
            await db.applyEntries(accounts,entries,1);
          }
          break;
        }

        // ── OPENING BALANCES ───────────────────────────────────────
        case "POST_OPENING_BALANCES": {
          const { date, balances } = action;
          const entries = [];
          // Collect all balance entries
          Object.entries(balances).forEach(([key, val]) => {
            const amount = parseFloat(val||0);
            if (!amount) return;
            if (key.startsWith("sup_")) {
              // Supplier — we owe them → Cr Supplier (liability increases)
              const partyId = key.replace("sup_","");
              entries.push({accountId: partyId, dr:0, cr:amount, narration:"Opening balance"});
            } else if (key.startsWith("cus_")) {
              // Customer — they owe us → Dr Customer (asset increases)
              const partyId = key.replace("cus_","");
              entries.push({accountId: partyId, dr:amount, cr:0, narration:"Opening balance"});
            } else if (!key.startsWith("dir_")) {
              // Regular account
              const acc = accounts[key];
              if (!acc) return;
              const dir = balances[`dir_${key}`]||"normal";
              const isDebitNormal = ["asset","expense"].includes(acc.type);
              const isDebit = (isDebitNormal && dir==="normal") || (!isDebitNormal && dir==="reverse");
              entries.push({accountId: key, dr:isDebit?amount:0, cr:isDebit?0:amount, narration:"Opening balance"});
            }
          });
          if (!entries.length) break;
          // Balancing entry — Opening Balance Equity
          const totalDr = entries.reduce((s,e)=>s+parseFloat(e.dr||0),0);
          const totalCr = entries.reduce((s,e)=>s+parseFloat(e.cr||0),0);
          const diff = totalDr - totalCr;
          if (Math.abs(diff)>0.01) {
            // Ensure opening equity account exists
            const eqId = "opening_balance_equity";
            if (!accounts[eqId]) {
              await db.addAccount({id:eqId, name:"Opening Balance Equity", group:"Capital", type:"liability", balance:0});
            }
            entries.push({accountId:eqId, dr:diff<0?Math.abs(diff):0, cr:diff>0?diff:0, narration:"Opening balance equity"});
          }
          const vSeq = await db.getSeq("JV");
          const vId = `JV-${String(vSeq).padStart(4,"0")}`;
          await db.incSeq("JV", vSeq);
          await db.addVoucher({id:vId, voucherType:"JV", date, narration:"Opening Balances", reference:"OPENING", entries, items:[]});
          await db.applyEntries(accounts, entries, 1);
          break;
        }

        // ── LOADMAN ────────────────────────────────────────────────
        case "SAVE_LOADMAN_RATE": {
          const d = action.data;
          if (d.id) {
            await db.updateLoadmanRate(d.id, {serviceType:d.serviceType, rate:d.rate, unit:d.unit});
          } else {
            await db.saveLoadmanRate({id:"rate_"+Date.now(), serviceType:d.serviceType, rate:d.rate, unit:d.unit});
          }
          break;
        }
        case "ADD_LOADMAN_CHARGE": {
          const d = action.data;
          const seq = await db.getLoadmanSeq().catch(()=>1);
          const id = `LDM-${String(seq).padStart(4,"0")}`;
          await db.incLoadmanSeq(seq).catch(()=>{});
          await db.addLoadmanCharge({id, ...d});
          // Ensure accounts exist
          if (!accounts[LOADMAN_PAYABLE_ID]) {
            await db.addAccount({id:LOADMAN_PAYABLE_ID, name:"Loadman Payable", group:"Creditors", type:"liability", balance:0});
          }
          if (d.whoBearsIt==="company" && !accounts[LOADMAN_EXPENSE_ID]) {
            await db.addAccount({id:LOADMAN_EXPENSE_ID, name:"Loadman Expense", group:"Expenses", type:"expense", balance:0});
          }
          const vSeq = await db.getSeq("JV");
          const vId = `JV-${String(vSeq).padStart(4,"0")}`;
          await db.incSeq("JV", vSeq);
          let entries;
          if (d.whoBearsIt==="company") {
            entries = [
              {accountId:LOADMAN_EXPENSE_ID, dr:d.amount, cr:0, narration:`Loadman - ${d.serviceType} - ${id}`},
              {accountId:LOADMAN_PAYABLE_ID, dr:0, cr:d.amount, narration:`Loadman payable - ${id}`},
            ];
          } else {
            entries = [
              {accountId:d.partyId,          dr:d.amount, cr:0, narration:`Loadman charges - ${d.serviceType} - ${id}`},
              {accountId:LOADMAN_PAYABLE_ID, dr:0, cr:d.amount, narration:`Loadman payable - ${id}`},
            ];
          }
          await db.addVoucher({id:vId, voucherType:"JV", date:d.date, narration:`Loadman - ${d.serviceType}${d.linkedId?` (${d.linkedId})`:""}`, reference:id, entries, items:[]});
          await db.applyEntries(accounts, entries, 1);
          break;
        }
        case "DELETE_LOADMAN_CHARGE": {
          const linked = vouchers.find(v=>v.reference===action.id&&v.voucherType==="JV");
          if (linked) { await db.applyEntries(accounts, linked.entries||[], -1); await db.deleteVoucher(linked.id); }
          await db.deleteLoadmanCharge(action.id);
          break;
        }
        case "PAY_LOADMAN": {
          const d = action.data;
          if (!accounts[LOADMAN_PAYABLE_ID]) {
            await db.addAccount({id:LOADMAN_PAYABLE_ID, name:"Loadman Payable", group:"Creditors", type:"liability", balance:0});
          }
          const vSeq = await db.getSeq("PV");
          const vId = `PV-${String(vSeq).padStart(4,"0")}`;
          await db.incSeq("PV", vSeq);
          const entries = [
            {accountId:LOADMAN_PAYABLE_ID,  dr:d.amount, cr:0,        narration:`Loadman payment`},
            {accountId:d.paymentAccount,    dr:0,        cr:d.amount, narration:`Loadman payment`},
          ];
          await db.addVoucher({id:vId, voucherType:"PV", date:d.date, narration:`Loadman payment - ${d.narration||""}`, reference:"", entries, items:[]});
          await db.applyEntries(accounts, entries, 1);
          break;
        }

        // ── LORRY OWNERS ───────────────────────────────────────────
        case "ADD_LORRY_OWNER": {
          const id = "lorry_owner_"+Date.now();
          await db.addLorryOwner({id, ...action.data});
          // Create payable account for this owner
          const accId = LORRY_PAYABLE_PREFIX + id;
          await db.addAccount({id:accId, name:`${action.data.name} (Lorry Payable)`, group:"Creditors", type:"liability", balance:0});
          break;
        }
        case "EDIT_LORRY_OWNER": {
          await db.editLorryOwner(action.id, action.data);
          // Update account name
          const accId = LORRY_PAYABLE_PREFIX + action.id;
          if (accounts[accId]) {
            await sb("PATCH","cv_accounts",{body:{name:`${action.data.name} (Lorry Payable)`},q:`?id=eq.${accId}`});
          }
          break;
        }

        // ── LORRY RENTALS ──────────────────────────────────────────
        case "ADD_LORRY_RENTAL": {
          const d = action.data;
          const seq = await db.getLorrySeq().catch(()=>1);
          const id = `LRY-${String(seq).padStart(4,"0")}`;
          await db.incLorrySeq(seq).catch(()=>{});
          await db.addLorryRental({id, ...d});
          // Ensure lorry expense account exists
          if (!accounts[LORRY_EXPENSE_ID]) {
            await db.addAccount({id:LORRY_EXPENSE_ID, name:"Lorry Expense", group:"Expenses", type:"expense", balance:0});
          }
          const ownerAccId = LORRY_PAYABLE_PREFIX + d.lorryOwnerId;
          const vSeq = await db.getSeq("JV");
          const vId = `JV-${String(vSeq).padStart(4,"0")}`;
          await db.incSeq("JV", vSeq);
          let entries;
          const ownerName = state.lorryOwners?.find(o=>o.id===d.lorryOwnerId)?.name||"Lorry Owner";
          if (d.whoBearsIt==="company") {
            entries = [
              {accountId:LORRY_EXPENSE_ID, dr:d.amount, cr:0,        narration:`Lorry rental - ${d.vehicleNo} - ${id}`},
              {accountId:ownerAccId,       dr:0,        cr:d.amount, narration:`${ownerName} payable - ${id}`},
            ];
          } else {
            entries = [
              {accountId:d.partyId,  dr:d.amount, cr:0,        narration:`Lorry rental charged - ${d.vehicleNo} - ${id}`},
              {accountId:ownerAccId, dr:0,        cr:d.amount, narration:`${ownerName} payable - ${id}`},
            ];
          }
          await db.addVoucher({id:vId, voucherType:"JV", date:d.date, narration:`Lorry rental ${d.vehicleNo}${d.linkedId?` (${d.linkedId})`:""}`, reference:id, entries, items:[]});
          await db.applyEntries(accounts, entries, 1);
          break;
        }
        case "DELETE_LORRY_RENTAL": {
          const linked = vouchers.find(v=>v.reference===action.id&&v.voucherType==="JV");
          if (linked) { await db.applyEntries(accounts, linked.entries||[], -1); await db.deleteVoucher(linked.id); }
          await db.deleteLorryRental(action.id);
          break;
        }
        case "PAY_LORRY_OWNER": {
          const d = action.data;
          const ownerAccId = LORRY_PAYABLE_PREFIX + d.ownerId;
          const seq = await db.getLorryPaySeq().catch(()=>1);
          const id = `LPY-${String(seq).padStart(4,"0")}`;
          await db.incLorryPaySeq(seq).catch(()=>{});
          await db.addLorryPayment({id, ...d});
          const vSeq = await db.getSeq("PV");
          const vId = `PV-${String(vSeq).padStart(4,"0")}`;
          await db.incSeq("PV", vSeq);
          const entries = [
            {accountId:ownerAccId,       dr:d.amount, cr:0,        narration:`Lorry payment - ${id}`},
            {accountId:d.paymentAccount, dr:0,        cr:d.amount, narration:`Lorry payment - ${id}`},
          ];
          await db.addVoucher({id:vId, voucherType:"PV", date:d.date, narration:`Lorry payment to ${state.lorryOwners?.find(o=>o.id===d.ownerId)?.name||d.ownerId}`, reference:id, entries, items:[]});
          await db.applyEntries(accounts, entries, 1);
          break;
        }

        case "ADD_QUALITY_REPORT":
          await db.addQuality(action.grnId, action.report); break;
        case "DELETE_GRN":
          await db.deleteGRN(action.id); break;

        // ── YERCAUD PAYMENTS ────────────────────────────────────
        case "FUND_YERCAUD_CASH": {
          // Contra: Dr Yercaud Cash, Cr Source Account
          const d = action.data;
          const vSeq = await db.getSeq("CV");
          const vId = `CV-${String(vSeq).padStart(4,"0")}`;
          await db.incSeq("CV", vSeq);
          // Ensure Yercaud Cash account exists
          const yercaudExists = accounts[YERCAUD_CASH_ID];
          if (!yercaudExists) {
            await db.addAccount({
              id: YERCAUD_CASH_ID, name:"Yercaud Cash",
              group:"Cash & Bank", type:"asset", balance:0,
              isBankAccount:false,
            });
          }
          const entries = [
            { accountId: YERCAUD_CASH_ID,   dr: d.amount, cr: 0,        narration: d.narration||"Yercaud cash funding" },
            { accountId: d.fromAccount,      dr: 0,        cr: d.amount, narration: d.narration||"Yercaud cash funding" },
          ];
          await db.addVoucher({ id:vId, voucherType:"CV", date:d.date, narration: d.narration||`Funds transferred to Yercaud Cash`, reference:"", entries, items:[] });
          await db.applyEntries(accounts, entries, 1);
          break;
        }

        case "ADD_YERCAUD_PAYMENT": {
          const d = action.data;
          // Get sequence
          let seq;
          try { seq = await db.getYercaudSeq(); }
          catch(e) { seq = (yercaudPayments.length||0) + 1; }
          const id = `YPV-${String(seq).padStart(4,"0")}`;
          try { await db.incYercaudSeq(seq); } catch(e) {}

          // Ensure Yercaud Cash account exists
          const yercaudExists = accounts[YERCAUD_CASH_ID];
          if (!yercaudExists) {
            await db.addAccount({
              id: YERCAUD_CASH_ID, name:"Yercaud Cash",
              group:"Cash & Bank", type:"asset", balance:0,
              isBankAccount:false,
            });
          }

          await db.addYercaudPayment({ id, ...d });

          // Post payment voucher: Dr Supplier (reduces payable), Cr Yercaud Cash
          const creditAccount = d.paymentMode==="cash" ? YERCAUD_CASH_ID : (d.bankAccountId||"cash");
          const vSeq = await db.getSeq("PV");
          const vId = `PV-${String(vSeq).padStart(4,"0")}`;
          await db.incSeq("PV", vSeq);
          const entries = [
            { accountId: d.partyId,       dr: d.amount, cr: 0,        narration: d.narration||`Yercaud advance - ${id}` },
            { accountId: creditAccount,   dr: 0,        cr: d.amount, narration: d.narration||`Yercaud advance - ${id}` },
          ];
          await db.addVoucher({ id:vId, voucherType:"PV", date:d.date, narration:`Yercaud payment to ${state.parties[d.partyId]?.name||d.partyId} - ${id}`, reference:id, entries, items:[] });
          await db.applyEntries(accounts, entries, 1);
          break;
        }

        case "DELETE_YERCAUD_PAYMENT": {
          // Find and reverse the linked PV voucher
          const linkedVoucher = vouchers.find(v => v.reference===action.id && v.voucherType==="PV");
          if (linkedVoucher) {
            await db.applyEntries(accounts, linkedVoucher.entries||[], -1);
            await db.deleteVoucher(linkedVoucher.id);
          }
          await db.deleteYercaudPayment(action.id);
          break;
        }
      }
      // Refresh all data after every action
      await loadAll();
    } catch(e) {
      setError("Error: " + e.message);
    }
    setSaving(false);
  }, [accounts, vouchers, loadAll]);

  // ── LOGIN ─────────────────────────────────────────────────────
  if (!currentUser) {
    return (
      <div style={{minHeight:"100vh",background:`linear-gradient(135deg,${C.accent} 0%,#3d2010 100%)`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Lora',Georgia,serif"}}>
        <LoginForm onLogin={async (u,p)=>{
          setLoading(true);
          setError("");
          try {
            const user = await db.login(u,p);
            if (!user) { setError("Invalid username or password"); setLoading(false); return; }
            setCurrentUser(user);
            try { localStorage.setItem("cv_user", JSON.stringify(user)); } catch{}
          } catch(e) {
            setError("Connection error: " + e.message);
            setLoading(false);
          }
        }} loading={loading} error={error}/>
      </div>
    );
  }

  // ── LOADING SCREEN ────────────────────────────────────────────
  if (loading) return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16,fontFamily:"'Lora',Georgia,serif"}}>
      <div style={{fontSize:48}}>☕</div>
      <div style={{fontWeight:700,color:C.accent,fontSize:18}}>Loading Coffee Vel...</div>
      <div style={{color:C.muted,fontSize:13}}>Connecting to database</div>
    </div>
  );

  const role       = currentUser.role;
  const isBranch   = role === "branch";
  const userLoc    = currentUser.location || "hq";
  const visibleNav = NAV.filter(n => {
    if (n.adminOnly && role !== "admin") return false;
    if (n.branchHidden && isBranch) return false;
    return true;
  });

  return(
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'Lora',Georgia,serif"}}>
      <style>{`
        .cv-layout{display:flex;min-height:100vh;}
        .cv-sidebar{width:215px;background:${C.accent};display:flex;flex-direction:column;flex-shrink:0;position:sticky;top:0;height:100vh;z-index:50;}
        .cv-topbar{display:none;background:${C.accent};padding:10px 16px;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100;}
        .cv-main{flex:1;padding:24px 28px;overflow-y:auto;min-width:0;}
        @media(max-width:768px){
          .cv-layout{flex-direction:column;}
          .cv-sidebar{position:fixed;top:0;left:-220px;height:100vh;width:220px;transition:left 0.25s;box-shadow:4px 0 20px #00000033;}
          .cv-sidebar.open{left:0;}
          .cv-topbar{display:flex;}
          .cv-main{padding:16px;margin-top:0;}
          .cv-overlay{display:none;position:fixed;inset:0;background:#00000044;z-index:49;}
          .cv-overlay.open{display:block;}
        }
      `}</style>
      {/* Mobile top bar */}
      <div className="cv-topbar">
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:18,fontWeight:800,color:"#fff"}}>☕</span>
          <span style={{fontSize:15,fontWeight:800,color:"#fff"}}>Coffee Vel</span>
          {isBranch&&<span style={{fontSize:11,background:"#ffffff33",color:"#fff",padding:"2px 8px",borderRadius:10,fontWeight:700}}>🌿 {currentUser.branchName||"Branch"}</span>}
        </div>
        <button onClick={()=>{document.getElementById("cv-sb").classList.toggle("open");document.getElementById("cv-ov").classList.toggle("open");}} style={{background:"none",border:"none",color:"#fff",fontSize:24,cursor:"pointer",lineHeight:1}}>☰</button>
      </div>
      {/* Overlay for mobile */}
      <div id="cv-ov" className="cv-overlay" onClick={()=>{document.getElementById("cv-sb").classList.remove("open");document.getElementById("cv-ov").classList.remove("open");}}/>
      <div className="cv-layout">
      {/* Sidebar */}
      <div id="cv-sb" className="cv-sidebar">
        <div style={{padding:"18px 16px 14px",borderBottom:"1px solid #ffffff22"}}>
          <div style={{fontSize:16,fontWeight:800,color:"#fff"}}>☕ Coffee Vel</div>
          <div style={{fontSize:10,color:"#ffffff88",marginTop:2,letterSpacing:1,textTransform:"uppercase"}}>International · Accounts</div>
          {isBranch&&<div style={{marginTop:6,fontSize:11,background:"#ffffff33",color:"#fff",padding:"2px 8px",borderRadius:10,display:"inline-block",fontWeight:700}}>🌿 {currentUser.branchName||"Yercaud"}</div>}
        </div>
        <nav style={{flex:1,padding:"10px 8px",overflowY:"auto"}}>
          {visibleNav.map(n=>(
            <button key={n.id} onClick={()=>{setTab(n.id);document.getElementById("cv-sb").classList.remove("open");document.getElementById("cv-ov").classList.remove("open");}} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"9px 14px",borderRadius:8,border:"none",cursor:"pointer",background:tab===n.id?"#ffffff22":"transparent",color:tab===n.id?"#fff":"#ffffff88",fontWeight:tab===n.id?700:500,fontSize:13,fontFamily:"inherit",marginBottom:2,textAlign:"left"}}>
              <span style={{width:20}}>{n.icon}</span>{n.label}
            </button>
          ))}
        </nav>
        <div style={{padding:"10px 16px",borderTop:"1px solid #ffffff22"}}>
          {saving&&<div style={{color:"#fcd34d",fontSize:11,marginBottom:6,textAlign:"center"}}>⏳ Saving...</div>}
          <div style={{color:"#ffffffcc",fontSize:12,fontWeight:600}}>{currentUser.name}</div>
          <div style={{color:"#ffffff66",fontSize:10,textTransform:"uppercase",letterSpacing:0.5}}>{ROLES[role]?.label}</div>
          <button onClick={()=>{setCurrentUser(null);try{localStorage.removeItem("cv_user");}catch{}}} style={{marginTop:8,background:"#ffffff22",border:"none",color:"#fff",padding:"5px 12px",borderRadius:6,cursor:"pointer",fontSize:12,fontFamily:"inherit",width:"100%"}}>Sign Out</button>
        </div>
      </div>
      {/* Main content */}
      <div className="cv-main">
        {error&&(
          <div style={{marginBottom:16,padding:"10px 16px",background:"#fee2e2",border:"1px solid #fca5a5",borderRadius:8,color:C.red,fontSize:13,fontWeight:600,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            {error}
            <button onClick={()=>setError("")} style={{background:"none",border:"none",cursor:"pointer",color:C.red,fontSize:18}}>×</button>
          </div>
        )}
        {tab==="dashboard" && <Dashboard      state={state} dispatch={dispatch} setTab={setTab}/>}
        {tab==="grn"       && <GRNModule      state={{...state, grns: isBranch ? state.grns.filter(g=>g.location===userLoc||!g.location) : state.grns}} dispatch={dispatch} role={role} currentUser={currentUser}/>}
        {tab==="yercaud"   && <YercaudModule  state={state} dispatch={dispatch} role={role}/>}
        {tab==="loadman"   && <LoadmanModule  state={state} dispatch={dispatch} role={role}/>}
        {tab==="lorry"     && <LorryModule    state={state} dispatch={dispatch} role={role}/>}
        {tab==="opening"   && <OpeningBalanceModule state={state} dispatch={dispatch}/>}
        {tab==="transfer"  && <StockTransferModule state={state} dispatch={dispatch} role={role} currentUser={currentUser}/>}
        {tab==="drying"    && <DryingModule  state={state} dispatch={dispatch} role={role}/>}
        {tab==="hulling"   && <HullingModule  state={state} dispatch={dispatch} role={role}/>}
        {tab==="sales"     && <SalesModule    state={state} dispatch={dispatch} role={role}/>}
        {tab==="storage"   && <StorageModule  state={state} dispatch={dispatch} role={role}/>}
        {tab==="daybook"   && <Daybook        state={state} dispatch={dispatch} role={role}/>}
        {tab==="ledger"    && <LedgerView     state={state}/>}
        {tab==="pl"        && <ProfitLoss     state={state}/>}
        {tab==="trial"     && <TrialBalance   state={state}/>}
        {tab==="outstanding"&& <OutstandingReport state={state}/>}
        {tab==="stock"     && <StockView      state={state} dispatch={dispatch}/>}
        {tab==="parties"   && <Parties        state={state} dispatch={dispatch}/>}
        {tab==="accounts"  && <AccountsMaster state={state} dispatch={dispatch}/>}
        {tab==="masters"   && role==="admin" && <MastersModule state={state} dispatch={dispatch}/>}
        {tab==="users"     && role==="admin" && <UserManagement state={state} dispatch={dispatch} currentUser={currentUser}/>}
      </div>
      </div>
    </div>
  );
}

