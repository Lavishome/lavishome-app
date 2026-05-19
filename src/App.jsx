import { useState, useEffect, useRef, useMemo } from "react";
import { db } from "./firebase";
import {
  collection, doc,
  onSnapshot, setDoc, deleteDoc, getDoc,
} from "firebase/firestore";
import {
  getAuth, GoogleAuthProvider,
  signInWithPopup, signOut, onAuthStateChanged,
} from "firebase/auth";


// ── Colour tokens ────────────────────────────────────────────────────────
const G = {
  bg:"#f5f1eb", surf:"#ffffff", surf2:"#ede8e0", bdr:"#ddd4c4",
  gold:"#8a6820", goldL:"#6a4e10", cream:"#1c1814", muted:"#7a6e62",
  danger:"#b83232", warn:"#b86010", ok:"#1a6e3a", info:"#1660a0",
};

// ── Firebase Auth instance ───────────────────────────────────────────────
const auth = getAuth();
const googleProvider = new GoogleAuthProvider();


// ── APPROVED EMAIL ADDRESSES ─────────────────────────────────────────────
// Add your team's Google email addresses here.
// Only these emails can log in. Anyone else sees "Access Denied".
const APPROVED_EMAILS = [
  "rohit@lavishome.ca",       // ← replace with your real emails
  "team1@lavishome.ca",
  "team2@lavishome.ca",
  "team3@lavishome.ca",
];

const CATS     = ["Sofas","Beds","Executive Desk","Coffee Tables","Consoles"];
const SERVICE_CAT = "Services & Add-ons";
const ALL_CATS_INV = ["All",...CATS];  // Inventory — no services
const ALL_CATS_CAT = ["All",...CATS,SERVICE_CAT]; // Catalog — includes services
// ALL_CATS defined per context above (ALL_CATS_INV and ALL_CATS_CAT)

const TXN_TYPES = {
  "Sale – Cash":          {cash: 1,debtor: 0,creditor: 0,equity: 1, color:"#1a6e3a",icon:"💰",group:"Revenue"},
  "Sale – Credit":        {cash: 0,debtor: 1,creditor: 0,equity: 1, color:"#2e9e5a",icon:"📋",group:"Revenue"},
  "Purchase – Cash":      {cash:-1,debtor: 0,creditor: 0,equity:-1, color:"#b83232",icon:"🛒",group:"Expense"},
  "Purchase – Credit":    {cash: 0,debtor: 0,creditor: 1,equity:-1, color:"#8a2020",icon:"📦",group:"Expense"},
  "Receive from Debtor":  {cash: 1,debtor:-1,creditor: 0,equity: 0, color:"#1a6e3a",icon:"✅",group:"Settlement"},
  "Pay Creditor":         {cash:-1,debtor: 0,creditor:-1,equity: 0, color:"#b86010",icon:"🏦",group:"Settlement"},
  "Partner Contribution": {cash: 1,debtor: 0,creditor: 0,equity: 1, color:"#6030a0",icon:"🤝",group:"Capital"},
  "Return of Capital":    {cash:-1,debtor: 0,creditor: 0,equity:-1, color:"#8040b0",icon:"↩️",group:"Capital"},
  "Expense":              {cash:-1,debtor: 0,creditor: 0,equity:-1, color:"#b83232",icon:"🧾",group:"Expense"},
  "Other Income":         {cash: 1,debtor: 0,creditor: 0,equity: 1, color:"#1660a0",icon:"💵",group:"Revenue"},
};
const TXN_KEYS = Object.keys(TXN_TYPES);

const STATUS_META = {
  Pending:  {color:"#b86010",bg:"#b8601018",border:"#b8601044",label:"⏳ Pending"},
  Accepted: {color:"#1a6e3a",bg:"#1a6e3a18",border:"#1a6e3a44",label:"✅ Accepted"},
  Declined: {color:"#7a6e62",bg:"#7a6e6218",border:"#7a6e6244",label:"❌ Declined"},
};

// ── Helpers ──────────────────────────────────────────────────────────────
function gid(){return"LH-"+Math.random().toString(36).substr(2,6).toUpperCase();}
function fmt(n){return(n<0?"-":"")+new Intl.NumberFormat("en-CA",{style:"currency",currency:"CAD",minimumFractionDigits:2}).format(Math.abs(n));}
function fmtDate(d){return new Date(d+"T00:00:00").toLocaleDateString("en-CA",{year:"numeric",month:"short",day:"numeric"});}
function fmtTs(ts){return new Date(ts).toLocaleDateString("en-CA",{year:"numeric",month:"short",day:"numeric"});}
function calcMargin(p,c){if(!c||c<=0||!p||p<=0)return null;return((p-c)/p*100).toFixed(1);}
function marginColor(m){if(m===null)return G.muted;if(m>=40)return G.ok;if(m>=20)return G.warn;return G.danger;}
function todayStr(){return new Date().toISOString().split("T")[0];}
function addDays(ds,d){const dt=new Date(ds+"T00:00:00");dt.setDate(dt.getDate()+d);return dt.toLocaleDateString("en-CA",{year:"numeric",month:"long",day:"numeric"});}
function makeRef(){return"QT-"+Date.now().toString().slice(-6);}

// ── Photo compression ────────────────────────────────────────────────────
// Resizes and compresses photos to max 600px wide, 70% JPEG quality
// Reduces a typical phone photo from ~400KB to ~30KB (13x smaller)
function compressPhoto(dataUrl, maxWidth=600, quality=0.7){
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{
      const ratio=Math.min(maxWidth/img.width,1);
      const canvas=document.createElement("canvas");
      canvas.width=Math.round(img.width*ratio);
      canvas.height=Math.round(img.height*ratio);
      canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);
      resolve(canvas.toDataURL("image/jpeg",quality));
    };
    img.onerror=()=>resolve(dataUrl); // fallback: keep original if error
    img.src=dataUrl;
  });
}

// ── Quote expiry helpers ─────────────────────────────────────────────────
function getExpiryStatus(quoteDate, status){
  if(status !== "Pending") return null; // Only pending quotes expire
  const created = new Date(quoteDate + "T00:00:00");
  const expiry  = new Date(created);
  expiry.setDate(expiry.getDate() + 7);
  const now     = new Date();
  const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
  if(daysLeft < 0)  return { label: "Expired",        color: G.danger, bg: G.danger+"18", border: G.danger+"44", days: daysLeft };
  if(daysLeft <= 2) return { label: `Expires in ${daysLeft}d`, color: G.warn, bg: G.warn+"18", border: G.warn+"44", days: daysLeft };
  return null; // Fine — no flag needed
}

// ── Firebase save with retry ─────────────────────────────────────────────
// Tries up to 3 times with a 1s gap before giving up
async function saveWithRetry(ref, data, attempts=3){
  for(let i=0;i<attempts;i++){
    try{
      await setDoc(ref,data);
      return true;
    }catch(e){
      if(i<attempts-1) await new Promise(r=>setTimeout(r,1000));
    }
  }
  return false;
}

// ── Mobile hook ──────────────────────────────────────────────────────────
function useIsMobile(){
  const [m,setM]=useState(()=>window.innerWidth<768);
  useEffect(()=>{const h=()=>setM(window.innerWidth<768);window.addEventListener("resize",h);return()=>window.removeEventListener("resize",h);},[]);
  return m;
}

// ── Sample data ──────────────────────────────────────────────────────────
const SAMPLE_INV=[
  {id:gid(),code:"LH-A001",name:"Velvet Chesterfield Sofa",  cat:"Sofas",         price:2499,costPrice:1400,stock:4,minStock:3,desc:"3-seater in deep burgundy velvet",     dims:{w:"220",h:"85",d:"95" },photo:null,ts:Date.now()},
  {id:gid(),code:"LH-B002",name:"Marble & Brass Coffee Table",cat:"Coffee Tables", price:1299,costPrice:680, stock:8,minStock:5,desc:"Italian Carrara marble top",           dims:{w:"120",h:"45",d:"60" },photo:null,ts:Date.now()},
  {id:gid(),code:"LH-E005",name:"Executive Oak Desk",         cat:"Executive Desk",price:1890,costPrice:950, stock:5,minStock:3,desc:"Solid oak, cable management included",dims:{w:"160",h:"75",d:"80" },photo:null,ts:Date.now()},
  {id:gid(),code:"LH-F006",name:"King Platform Bed",          cat:"Beds",          price:3299,costPrice:1800,stock:2,minStock:2,desc:"Solid white oak, natural oil finish",  dims:{w:"193",h:"120",d:"210"},photo:null,ts:Date.now()},
  {id:gid(),code:"LH-H008",name:"Marble Entry Console",       cat:"Consoles",      price:1450,costPrice:720, stock:3,minStock:2,desc:"Brushed brass legs, Arabescato top",  dims:{w:"140",h:"80",d:"38" },photo:null,ts:Date.now()},
];
const SAMPLE_TXN=[
  {id:gid(),date:"2026-03-05",type:"Partner Contribution",party:"Rohit – Partner",       desc:"Initial capital injection",        amount:50000,ref:"CAP-001",notes:"",ts:Date.now()},
  {id:gid(),date:"2026-03-10",type:"Purchase – Cash",     party:"Milano Imports",         desc:"Initial inventory purchase",       amount:28000,ref:"PO-001", notes:"Sofas & beds",ts:Date.now()},
  {id:gid(),date:"2026-03-18",type:"Sale – Cash",         party:"Sarah Thompson",         desc:"Velvet Chesterfield Sofa × 1",     amount: 2499,ref:"INV-001",notes:"",ts:Date.now()},
  {id:gid(),date:"2026-03-22",type:"Sale – Credit",       party:"Meridian Design Studio", desc:"Office desks × 3 + consoles × 2", amount: 8570,ref:"INV-002",notes:"Net 30 terms",ts:Date.now()},
  {id:gid(),date:"2026-03-28",type:"Expense",             party:"Lavishome Operations",   desc:"Showroom rent – March",            amount: 3200,ref:"EXP-001",notes:"",ts:Date.now()},
  {id:gid(),date:"2026-04-01",type:"Receive from Debtor", party:"Meridian Design Studio", desc:"Partial payment – INV-002",        amount: 5000,ref:"REC-001",notes:"Balance $3,570 outstanding",ts:Date.now()},
];

// ── Shared style atoms ───────────────────────────────────────────────────
const lbl={fontSize:10,fontWeight:700,letterSpacing:"0.1em",color:G.muted,textTransform:"uppercase",display:"block",marginBottom:5};
const inp={background:"#fff",border:`1px solid ${G.bdr}`,borderRadius:8,color:G.cream,padding:"9px 14px",fontSize:13,outline:"none",fontFamily:"inherit",width:"100%"};

// ── Global responsive CSS ────────────────────────────────────────────────
const GLOBAL_CSS=`
  *{box-sizing:border-box}
  @media(max-width:767px){
    .lh-stats{grid-template-columns:repeat(2,1fr)!important}
    .lh-pgrid{grid-template-columns:1fr!important}
    .lh-cgrid{grid-template-columns:1fr!important}
    .lh-fin2{grid-template-columns:1fr!important}
    .lh-fin4{grid-template-columns:repeat(2,1fr)!important}
    .lh-modal-pad{padding:18px 16px!important}
    .lh-grid2{grid-template-columns:1fr!important}
    .lh-grid3{grid-template-columns:1fr 1fr!important}
    .lh-sticky{left:12px!important;right:12px!important;transform:none!important;border-radius:14px!important;padding:12px 16px!important;flex-wrap:wrap;gap:10px!important}
    .lh-q-row{flex-direction:column!important;align-items:stretch!important;gap:10px!important}
    .lh-q-actions{flex-direction:row!important;flex-wrap:wrap!important}
  }
  @media(max-width:480px){
    .lh-hdr-inner{flex-wrap:wrap;height:auto!important;padding:10px 12px!important;gap:8px}
    .lh-hdr-tabs{order:3;width:100%;justify-content:stretch!important}
    .lh-hdr-tabs button{flex:1!important;font-size:10px!important;padding:6px 4px!important}
    .lh-logo{flex:1}
  }
`;

// ══════════════════════════════════════════════════════════════════════════
//  SET NAME MODAL — shown once on first login
// ══════════════════════════════════════════════════════════════════════════
function SetNameModal({user, onSave}){
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave(){
    if(!name.trim()) return alert("Please enter your name.");
    setSaving(true);
    await saveWithRetry(doc(db,"lavishome_users",user.uid),{
      uid: user.uid,
      email: user.email,
      displayName: name.trim(),
      createdAt: Date.now(),
    });
    onSave(name.trim());
  }

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(28,24,20,0.6)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:24,fontFamily:"'DM Sans',sans-serif"}}>
      <div style={{background:"#fff",border:`1px solid ${G.bdr}`,borderRadius:20,padding:"40px 36px",maxWidth:380,width:"100%",boxShadow:"0 8px 48px rgba(0,0,0,0.12)",textAlign:"center"}}>
        <div style={{fontSize:40,marginBottom:16}}>👋</div>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:700,color:G.goldL,marginBottom:8}}>Welcome to Lavishome</div>
        <div style={{fontSize:13,color:G.muted,marginBottom:6,lineHeight:1.6}}>Signed in as <strong style={{color:G.cream}}>{user.email}</strong></div>
        <div style={{fontSize:13,color:G.muted,marginBottom:28,lineHeight:1.6}}>To personalise your activity records, please enter your name. This only needs to be done once.</div>
        <div style={{marginBottom:20,textAlign:"left"}}>
          <label style={{...{fontSize:10,fontWeight:700,letterSpacing:"0.1em",color:G.muted,textTransform:"uppercase",display:"block",marginBottom:5}}}>Your Name</label>
          <input
            autoFocus
            style={{background:"#fff",border:`1px solid ${G.bdr}`,borderRadius:8,color:G.cream,padding:"11px 14px",fontSize:15,outline:"none",fontFamily:"inherit",width:"100%"}}
            value={name}
            onChange={e=>setName(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&handleSave()}
            placeholder="e.g. Rohit"
          />
        </div>
        <button
          onClick={handleSave}
          disabled={saving||!name.trim()}
          style={{width:"100%",background:saving||!name.trim()?G.muted:G.goldL,border:"none",color:"#fff",borderRadius:10,padding:"13px 20px",fontSize:14,fontWeight:700,cursor:saving?"not-allowed":"pointer",fontFamily:"'DM Sans',sans-serif"}}>
          {saving?"Saving…":"Save & Continue →"}
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  LOGIN SCREEN
// ══════════════════════════════════════════════════════════════════════════
function LoginScreen({onLogin, loading, error}){
  return(
    <div style={{minHeight:"100vh",background:G.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans',sans-serif",padding:24}}>
      <div style={{background:G.surf,border:`1px solid ${G.bdr}`,borderRadius:20,padding:"48px 40px",maxWidth:400,width:"100%",boxShadow:"0 8px 48px rgba(0,0,0,0.10)",textAlign:"center"}}>
        {/* Logo */}
        <div style={{width:56,height:56,background:G.goldL,borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,margin:"0 auto 20px"}}>🏠</div>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:26,fontWeight:700,color:G.goldL,letterSpacing:"0.04em",marginBottom:6}}>Lavishome</div>
        <div style={{fontSize:11,color:G.muted,letterSpacing:"0.16em",textTransform:"uppercase",marginBottom:32}}>Business Manager</div>
        <div style={{fontSize:14,color:G.muted,marginBottom:32,lineHeight:1.6}}>Sign in with your Google account to access the Lavishome business portal.</div>
        {error&&<div style={{background:G.danger+"10",border:`1px solid ${G.danger}33`,borderRadius:10,padding:"10px 16px",marginBottom:20,fontSize:13,color:G.danger,fontWeight:600}}>{error}</div>}
        <button
          onClick={onLogin}
          disabled={loading}
          style={{width:"100%",background:loading?"#ccc":G.goldL,border:"none",color:"#fff",borderRadius:10,padding:"14px 20px",fontSize:14,fontWeight:700,cursor:loading?"not-allowed":"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:10,fontFamily:"'DM Sans',sans-serif",transition:"background 0.14s"}}>
          {loading
            ? <span>Signing in…</span>
            : <><span style={{fontSize:18}}>G</span><span>Sign in with Google</span></>
          }
        </button>
        <div style={{fontSize:11,color:G.muted,marginTop:20}}>Access is restricted to approved Lavishome team members only.</div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  ACCESS DENIED SCREEN
// ══════════════════════════════════════════════════════════════════════════
function AccessDeniedScreen({user, onSignOut}){
  return(
    <div style={{minHeight:"100vh",background:G.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans',sans-serif",padding:24}}>
      <div style={{background:G.surf,border:`1px solid ${G.bdr}`,borderRadius:20,padding:"48px 40px",maxWidth:400,width:"100%",boxShadow:"0 8px 48px rgba(0,0,0,0.10)",textAlign:"center"}}>
        <div style={{fontSize:48,marginBottom:16}}>🚫</div>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:700,color:G.cream,marginBottom:12}}>Access Denied</div>
        <div style={{fontSize:13,color:G.muted,marginBottom:8,lineHeight:1.6}}>
          The account <strong style={{color:G.cream}}>{user?.email}</strong> is not authorised to access this portal.
        </div>
        <div style={{fontSize:13,color:G.muted,marginBottom:32,lineHeight:1.6}}>
          Please contact Rohit to request access, or sign in with a different Google account.
        </div>
        <button onClick={onSignOut} style={{width:"100%",background:G.goldL,border:"none",color:"#fff",borderRadius:10,padding:"12px 20px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
          Sign Out & Try Again
        </button>
      </div>
    </div>
  );
}

// ── Modal wrapper ────────────────────────────────────────────────────────
function ModalWrap({onClose,children,maxW=540}){
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(28,24,20,0.55)",zIndex:300,display:"flex",alignItems:"flex-end",justifyContent:"center",padding:"0"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:G.surf,border:`1px solid ${G.bdr}`,borderRadius:"16px 16px 0 0",width:"100%",maxWidth:maxW,maxHeight:"94vh",overflow:"auto",boxShadow:"0 -4px 40px rgba(0,0,0,0.18)"}}>
        {children}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  QUOTE PAGE GENERATOR
// ══════════════════════════════════════════════════════════════════════════
function generateQuotePage(selectedProds,quoteInfo,existingRef=null){
  const{clientName,clientPhone,clientEmail,clientAddress,preparedBy,notes,discountType,discountValue,quoteDate}=quoteInfo;
  const quoteRef=existingRef||makeRef();
  const subtotal=selectedProds.reduce((s,p)=>s+p.price*(p.qty||1),0);
  const discAmt=discountType==="%"?subtotal*(parseFloat(discountValue)||0)/100:parseFloat(discountValue)||0;
  const total=Math.max(0,subtotal-discAmt);
  const validUntil=addDays(quoteDate,7);
  const productRows=selectedProds.map(p=>{
    const photoHtml=p.photo?`<img src="${p.photo}" style="width:80px;height:65px;object-fit:cover;border-radius:8px;border:1px solid #ddd4c4;">`:`<div style="width:80px;height:65px;background:#ede8e0;border-radius:8px;border:1px solid #ddd4c4;display:flex;align-items:center;justify-content:center;font-size:28px">🏠</div>`;
    const isService=p.cat==="Services & Add-ons";
    const dimsStr=!isService&&p.dims&&(p.dims.w||p.dims.h||p.dims.d)?`W${p.dims.w||"–"} × H${p.dims.h||"–"} × D${p.dims.d||"–"} cm`:"";
    return`<tr><td style="padding:14px 12px;vertical-align:middle">${photoHtml}</td><td style="padding:14px 12px;vertical-align:middle"><div style="font-family:'Playfair Display',serif;font-size:15px;font-weight:600;color:#1c1814;margin-bottom:3px">${p.name}</div><div style="font-size:11px;color:#8a6820;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:2px">${isService?"🔧 "+p.cat:p.cat}</div>${p.desc?`<div style="font-size:12px;color:#7a6e62;margin-bottom:2px">${p.desc}</div>`:""}${dimsStr?`<div style="font-size:11px;color:#7a6e62;font-family:monospace">📐 ${dimsStr}</div>`:""}</td><td style="padding:14px 12px;vertical-align:middle;text-align:center;font-size:13px;color:#1c1814;font-weight:600">${p.qty||1}</td><td style="padding:14px 12px;vertical-align:middle;text-align:right;font-size:14px;font-weight:700;color:#6a4e10;font-family:'Playfair Display',serif">${fmt(p.price)}</td><td style="padding:14px 12px;vertical-align:middle;text-align:right;font-size:14px;font-weight:700;color:#1c1814;font-family:'Playfair Display',serif">${fmt(p.price*(p.qty||1))}</td></tr>`;
  }).join("");
  const discountRow=discAmt>0?`<tr><td colspan="4" style="padding:10px 12px;text-align:right;color:#b86010;font-weight:600;font-size:13px">Discount ${discountType==="%"?`(${discountValue}%)`:"(Fixed)"}</td><td style="padding:10px 12px;text-align:right;color:#b86010;font-weight:700;font-size:14px">−${fmt(discAmt)}</td></tr>`:"";
  const html=`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lavishome Quote — ${clientName}</title><link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet"><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'DM Sans',sans-serif;background:#f5f1eb;color:#1c1814;padding:24px 16px}.page{max-width:860px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 4px 32px rgba(0,0,0,0.10);overflow:hidden}.print-btn{position:fixed;bottom:20px;right:20px;background:#ba5f33;color:#fff;border:none;border-radius:999px;padding:12px 24px;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,0.18);z-index:100}table{width:100%;border-collapse:collapse}tbody tr{border-bottom:1px solid #ede8e0}@media print{@page{margin:0.8cm;size:A4}body{background:#fff;padding:0}.page{box-shadow:none;border-radius:0}.print-btn{display:none}}@media(max-width:600px){.hdr-flex{flex-direction:column!important;gap:12px!important;text-align:center!important}.info-grid{grid-template-columns:1fr!important}}</style></head><body>
<button class="print-btn" onclick="window.print()">🖨️ Print / Save as PDF</button>
<div class="page">
<div style="background:#ba5f33;padding:28px 32px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px" class="hdr-flex"><div><div style="font-family:'Playfair Display',serif;font-size:26px;font-weight:700;color:#fff;letter-spacing:0.04em">LAVISHOME</div><div style="font-size:10px;color:#e8c27a;letter-spacing:0.2em;text-transform:uppercase;margin-top:3px">Luxury Furniture</div></div><div style="text-align:right"><div style="font-family:'Playfair Display',serif;font-size:20px;font-weight:600;color:#fff">Quote / Estimate</div><div style="font-size:12px;color:#e8c27a;margin-top:3px;font-family:monospace">${quoteRef}</div></div></div>
<div style="padding:24px 32px;display:grid;grid-template-columns:1fr 1fr;gap:24px;border-bottom:1px solid #ede8e0" class="info-grid"><div>
  <div style="font-size:10px;color:#7a6e62;text-transform:uppercase;letter-spacing:0.12em;font-weight:700;margin-bottom:6px">Prepared For</div>
  <div style="font-family:'Playfair Display',serif;font-size:20px;font-weight:600;color:#1c1814;margin-bottom:6px">${clientName}</div>
  ${clientPhone?`<div style="font-size:12px;color:#7a6e62;margin-bottom:3px">📞 ${clientPhone}</div>`:""}
  ${clientEmail?`<div style="font-size:12px;color:#7a6e62;margin-bottom:3px">✉️ ${clientEmail}</div>`:""}
  ${clientAddress?`<div style="font-size:12px;color:#7a6e62;">📍 ${clientAddress}</div>`:""}
</div><div style="text-align:right"><div style="margin-bottom:6px"><span style="font-size:10px;color:#7a6e62;text-transform:uppercase;letter-spacing:0.1em">Date: </span><span style="font-size:13px;color:#1c1814;font-weight:600">${fmtDate(quoteDate)}</span></div><div style="margin-bottom:6px"><span style="font-size:10px;color:#7a6e62;text-transform:uppercase;letter-spacing:0.1em">Prepared By: </span><span style="font-size:13px;color:#1c1814;font-weight:600">${preparedBy||"Lavishome Team"}</span></div><div style="background:#fff8e8;border:1px solid #e8c27a44;border-radius:8px;padding:6px 12px;display:inline-block;margin-top:2px"><span style="font-size:11px;color:#8a6820;font-weight:700">⏱ Valid until ${validUntil} or while stocks last</span></div></div></div>
<div style="padding:0 32px"><table><thead><tr style="border-bottom:2px solid #ddd4c4"><th style="padding:12px;text-align:left;font-size:10px;color:#7a6e62;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;width:100px">Photo</th><th style="padding:12px;text-align:left;font-size:10px;color:#7a6e62;text-transform:uppercase;letter-spacing:0.1em;font-weight:700">Product</th><th style="padding:12px;text-align:center;font-size:10px;color:#7a6e62;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;width:60px">Qty</th><th style="padding:12px;text-align:right;font-size:10px;color:#7a6e62;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;width:110px">Unit Price</th><th style="padding:12px;text-align:right;font-size:10px;color:#7a6e62;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;width:110px">Total</th></tr></thead><tbody>${productRows}</tbody></table></div>
<div style="padding:20px 32px;border-top:2px solid #ede8e0;margin-top:6px"><table style="max-width:320px;margin-left:auto"><tbody><tr><td style="padding:7px 12px;color:#7a6e62;font-size:13px">Subtotal</td><td style="padding:7px 12px;text-align:right;font-size:13px;font-weight:600;color:#1c1814">${fmt(subtotal)}</td></tr>${discountRow}<tr style="border-top:2px solid #ddd4c4"><td style="padding:12px;font-family:'Playfair Display',serif;font-size:16px;font-weight:700;color:#6a4e10">Total (CAD)</td><td style="padding:12px;text-align:right;font-family:'Playfair Display',serif;font-size:20px;font-weight:700;color:#6a4e10">${fmt(total)}</td></tr></tbody></table></div>
${notes?`<div style="padding:18px 32px;border-top:1px solid #ede8e0;background:#faf8f5"><div style="font-size:10px;color:#7a6e62;text-transform:uppercase;letter-spacing:0.12em;font-weight:700;margin-bottom:6px">Notes</div><div style="font-size:13px;color:#1c1814;line-height:1.7">${notes}</div></div>`:""}
<div style="padding:18px 32px;border-top:1px solid #ede8e0;background:#faf8f5"><div style="font-size:10px;color:#7a6e62;text-transform:uppercase;letter-spacing:0.12em;font-weight:700;margin-bottom:6px">Terms &amp; Conditions</div><div style="font-size:12px;color:#7a6e62;line-height:1.7">• This quote is valid for 7 days from the date of issue or while stocks last, whichever comes first.<br>• Prices are in Canadian Dollars (CAD) and do not include applicable taxes.<br>• Delivery timelines and terms to be confirmed upon order confirmation.<br>• A deposit may be required to confirm your order.</div></div>
<div style="background:#ba5f33;padding:20px 32px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px"><div style="font-family:'Playfair Display',serif;font-size:15px;color:#fff;font-weight:600">Lavishome</div><div style="font-size:11px;color:#e8c27a;text-align:center">405 Britannia Rd E, Unit 111, Mississauga, ON L4Z 3E6</div><div style="font-size:11px;color:#e8c27a">Toronto: +1 (437) 984-8055 &nbsp;|&nbsp; Montreal: +1 (514) 577-1029</div></div>
</div></body></html>`;
  const w=window.open("","_blank");
  w.document.write(html);
  w.document.close();
}

// ══════════════════════════════════════════════════════════════════════════
//  PRODUCT DETAIL MODAL
// ══════════════════════════════════════════════════════════════════════════
function ProductDetailModal({product,onClose,onSelectForQuote,isSelected}){
  const isMobile=useIsMobile();
  const d=product.dims,hasDims=d&&(d.w||d.h||d.d);
  const isLow=product.stock<=product.minStock&&product.stock>0,isOut=product.stock===0;
  return(
    <ModalWrap onClose={onClose} maxW={620}>
      <div className="lh-modal-pad" style={{padding:"24px 26px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:18}}>
          <div style={{flex:1,paddingRight:12}}>
            <div style={{fontSize:9,color:G.gold,fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:5}}>{product.cat}</div>
            <h2 style={{color:G.goldL,fontFamily:"'Playfair Display',serif",fontSize:isMobile?18:22,fontWeight:700,lineHeight:1.2}}>{product.name}</h2>
            <div style={{fontSize:11,color:G.muted,fontFamily:"monospace",marginTop:3}}>{product.code}</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:G.muted,fontSize:24,cursor:"pointer",lineHeight:1,flexShrink:0}}>×</button>
        </div>
        <div style={{height:isMobile?180:240,background:G.surf2,borderRadius:12,overflow:"hidden",marginBottom:16,display:"flex",alignItems:"center",justifyContent:"center",border:`1px solid ${G.bdr}`}}>
          {product.photo?<img src={product.photo} style={{width:"100%",height:"100%",objectFit:"cover"}} alt={product.name}/>:<div style={{fontSize:isMobile?48:64,opacity:0.3}}>🏠</div>}
        </div>
        <div className="lh-grid2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
          <div style={{background:G.surf2,border:`1px solid ${G.bdr}`,borderRadius:10,padding:"12px 14px"}}>
            <div style={{fontSize:10,color:G.muted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:5}}>Selling Price</div>
            <div style={{fontSize:isMobile?20:24,fontWeight:700,color:G.goldL,fontFamily:"'Playfair Display',serif"}}>${product.price.toLocaleString("en-CA",{minimumFractionDigits:2})}</div>
          </div>
          <div style={{background:product.cat===SERVICE_CAT?"#ba5f3310":isOut?G.danger+"10":isLow?G.warn+"10":G.ok+"10",border:`1px solid ${product.cat===SERVICE_CAT?"#ba5f3344":isOut?G.danger:isLow?G.warn:G.ok}44`,borderRadius:10,padding:"12px 14px"}}>
            <div style={{fontSize:10,color:G.muted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:5}}>{product.cat===SERVICE_CAT?"Type":"Availability"}</div>
            <div style={{fontSize:isMobile?15:18,fontWeight:700,color:product.cat===SERVICE_CAT?"#ba5f33":isOut?G.danger:isLow?G.warn:G.ok,fontFamily:"'Playfair Display',serif"}}>{product.cat===SERVICE_CAT?"🔧 Service / Add-on":isOut?"Out of Stock":isLow?`Only ${product.stock} left`:`${product.stock} in Stock`}</div>
          </div>
        </div>
        {product.desc&&<div style={{marginBottom:14}}><div style={{fontSize:10,color:G.muted,textTransform:"uppercase",letterSpacing:"0.1em",fontWeight:700,marginBottom:5}}>Description</div><div style={{fontSize:13,color:G.cream,lineHeight:1.7}}>{product.desc}</div></div>}
        {hasDims&&product.cat!==SERVICE_CAT&&<div style={{background:G.surf2,border:`1px solid ${G.bdr}`,borderRadius:10,padding:"12px 14px",marginBottom:18}}>
          <div style={{fontSize:10,color:G.muted,textTransform:"uppercase",letterSpacing:"0.1em",fontWeight:700,marginBottom:10}}>↔ Dimensions</div>
          <div style={{display:"flex",gap:10}}>
            {[["Width",d.w],["Height",d.h],["Depth",d.d]].map(([l,v])=>v?(
              <div key={l} style={{flex:1,textAlign:"center",background:G.surf,border:`1px solid ${G.bdr}`,borderRadius:8,padding:"8px 6px"}}>
                <div style={{fontSize:isMobile?15:18,fontWeight:700,color:G.goldL,fontFamily:"'Playfair Display',serif"}}>{v}</div>
                <div style={{fontSize:9,color:G.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginTop:2}}>{l} (cm)</div>
              </div>
            ):null)}
          </div>
        </div>}
        <div style={{display:"flex",gap:10}}>
          <button onClick={onClose} style={{flex:1,background:"#fff",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:8,padding:"11px",fontSize:13,fontWeight:600,cursor:"pointer"}}>Close</button>
          <button onClick={()=>{onSelectForQuote(product);onClose();}} style={{flex:2,background:isSelected?G.ok:G.goldL,border:"none",color:"#fff",borderRadius:8,padding:"11px",fontSize:13,fontWeight:700,cursor:"pointer"}}>
            {isSelected?"✓ Added to Quote":"+ Add to Quote"}
          </button>
        </div>
      </div>
    </ModalWrap>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  QUOTE BUILDER MODAL
// ══════════════════════════════════════════════════════════════════════════
function QuoteBuilderModal({selectedProds,onRemove,onUpdateQty,onClose,onGenerate,userProfile}){
  const isMobile=useIsMobile();
  const [clientName,setClientName]=useState("");
  const [clientPhone,setClientPhone]=useState("");
  const [clientEmail,setClientEmail]=useState("");
  const [clientAddress,setClientAddress]=useState("");
  const [preparedBy,setPreparedBy]=useState(userProfile?.displayName||"");
  const [notes,setNotes]=useState("");
  const [discountType,setDiscountType]=useState("%");
  const [discountValue,setDiscountValue]=useState("");
  const [quoteDate,setQuoteDate]=useState(todayStr());
  const subtotal=selectedProds.reduce((s,p)=>s+p.price*(p.qty||1),0);
  const discAmt=discountType==="%"?subtotal*(parseFloat(discountValue)||0)/100:parseFloat(discountValue)||0;
  const total=Math.max(0,subtotal-discAmt);
  function handleGenerate(){if(!clientName.trim())return alert("Please enter the client name.");onGenerate({clientName,clientPhone,clientEmail,clientAddress,preparedBy,notes,discountType,discountValue,quoteDate});}
  return(
    <ModalWrap onClose={onClose} maxW={600}>
      <div className="lh-modal-pad" style={{padding:"22px 24px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <div><h2 style={{color:G.goldL,fontFamily:"'Playfair Display',serif",fontSize:isMobile?18:21,fontWeight:700}}>Create Quote</h2><div style={{fontSize:12,color:G.muted,marginTop:3}}>{selectedProds.length} product{selectedProds.length>1?"s":""} selected</div></div>
          <button onClick={onClose} style={{background:"none",border:"none",color:G.muted,fontSize:24,cursor:"pointer"}}>×</button>
        </div>
        <div style={{background:G.surf2,border:`1px solid ${G.bdr}`,borderRadius:10,padding:"12px 14px",marginBottom:16}}>
          <div style={{fontSize:10,color:G.gold,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10}}>Selected Products</div>
          {selectedProds.map(p=>(
            <div key={p.id} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 0",borderBottom:`1px solid ${G.bdr}`}}>
              <div style={{width:40,height:40,borderRadius:7,overflow:"hidden",background:G.surf,border:`1px solid ${G.bdr}`,flexShrink:0}}>
                {p.photo?<img src={p.photo} style={{width:"100%",height:"100%",objectFit:"cover"}} alt={p.name}/>:<div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>🏠</div>}
              </div>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:G.cream,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.name}</div><div style={{fontSize:11,color:G.muted}}>{fmt(p.price)} each</div></div>
              <div style={{display:"flex",alignItems:"center",gap:4}}>
                <button onClick={()=>onUpdateQty(p.id,Math.max(1,(p.qty||1)-1))} style={{background:G.surf,border:`1px solid ${G.bdr}`,color:G.cream,borderRadius:5,width:26,height:26,fontSize:14,cursor:"pointer"}}>−</button>
                <span style={{fontSize:13,fontWeight:700,minWidth:20,textAlign:"center"}}>{p.qty||1}</span>
                <button onClick={()=>onUpdateQty(p.id,Math.min(p.stock,(p.qty||1)+1))} style={{background:G.surf,border:`1px solid ${G.bdr}`,color:G.cream,borderRadius:5,width:26,height:26,fontSize:14,cursor:"pointer"}}>+</button>
              </div>
              <div style={{fontSize:12,fontWeight:700,color:G.goldL,minWidth:70,textAlign:"right"}}>{fmt(p.price*(p.qty||1))}</div>
              <button onClick={()=>onRemove(p.id)} style={{background:"none",border:"none",color:G.muted,fontSize:18,cursor:"pointer",flexShrink:0}}>×</button>
            </div>
          ))}
        </div>
        <div className="lh-grid2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <div><label style={lbl}>Client Name *</label><input style={inp} value={clientName} onChange={e=>setClientName(e.target.value)} placeholder="e.g. Sarah Thompson"/></div>
          <div><label style={lbl}>Prepared By</label><input style={inp} value={preparedBy} onChange={e=>setPreparedBy(e.target.value)} placeholder="Your name"/></div>
        </div>
        <div className="lh-grid2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <div><label style={lbl}>Client Phone</label><input style={inp} value={clientPhone} onChange={e=>setClientPhone(e.target.value)} placeholder="e.g. +1 (416) 555-0100" type="tel"/></div>
          <div><label style={lbl}>Client Email</label><input style={inp} value={clientEmail} onChange={e=>setClientEmail(e.target.value)} placeholder="e.g. sarah@email.com" type="email"/></div>
        </div>
        <div style={{marginBottom:10}}><label style={lbl}>Client Address</label><input style={inp} value={clientAddress} onChange={e=>setClientAddress(e.target.value)} placeholder="e.g. 123 Main St, Toronto, ON M5V 1A1"/></div>
        <div style={{marginBottom:10}}><label style={lbl}>Quote Date</label><input style={inp} type="date" value={quoteDate} onChange={e=>setQuoteDate(e.target.value)}/></div>
        <div style={{background:G.surf2,border:`1px solid ${G.bdr}`,borderRadius:10,padding:"12px 14px",marginBottom:10}}>
          <div style={{fontSize:10,color:G.gold,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10}}>🏷 Discount (optional)</div>
          <div style={{display:"flex",gap:10}}>
            <div style={{flex:"0 0 130px"}}><label style={lbl}>Type</label><select style={{...inp,cursor:"pointer"}} value={discountType} onChange={e=>setDiscountType(e.target.value)}><option value="%">Percentage (%)</option><option value="$">Fixed Amount ($)</option></select></div>
            <div style={{flex:1}}><label style={lbl}>Value</label><input style={inp} type="number" value={discountValue} onChange={e=>setDiscountValue(e.target.value)} placeholder={discountType==="%"?"e.g. 10":"e.g. 200"} min="0"/></div>
          </div>
        </div>
        <div style={{marginBottom:16}}><label style={lbl}>Notes for Client (optional)</label><textarea style={{...inp,resize:"vertical"}} rows={2} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="e.g. Customisation available. Delivery in 2–4 weeks."/></div>
        <div style={{background:G.surf2,border:`1px solid ${G.bdr}`,borderRadius:10,padding:"12px 14px",marginBottom:18}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><span style={{fontSize:13,color:G.muted}}>Subtotal</span><span style={{fontSize:13,fontWeight:600,color:G.cream}}>{fmt(subtotal)}</span></div>
          {discAmt>0&&<div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><span style={{fontSize:13,color:G.warn}}>Discount</span><span style={{fontSize:13,fontWeight:600,color:G.warn}}>−{fmt(discAmt)}</span></div>}
          <div style={{display:"flex",justifyContent:"space-between",borderTop:`1px solid ${G.bdr}`,paddingTop:10,marginTop:6}}>
            <span style={{fontSize:15,fontWeight:700,color:G.goldL,fontFamily:"'Playfair Display',serif"}}>Total (CAD)</span>
            <span style={{fontSize:isMobile?18:20,fontWeight:700,color:G.goldL,fontFamily:"'Playfair Display',serif"}}>{fmt(total)}</span>
          </div>
          <div style={{fontSize:11,color:G.muted,marginTop:6,textAlign:"right"}}>⏱ Valid for 7 days or while stocks last</div>
        </div>
        <div style={{display:"flex",gap:10}}>
          <button onClick={onClose} style={{flex:1,background:"#fff",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:8,padding:"11px",fontSize:13,fontWeight:600,cursor:"pointer"}}>Cancel</button>
          <button onClick={handleGenerate} style={{flex:2,background:G.goldL,border:"none",color:"#fff",borderRadius:8,padding:"11px",fontSize:13,fontWeight:700,cursor:"pointer"}}>🖨 Generate Quote</button>
        </div>
      </div>
    </ModalWrap>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  CATALOG TAB
// ══════════════════════════════════════════════════════════════════════════
function CatalogTab({prods,onSaveQuote,userProfile}){
  const isMobile=useIsMobile();
  const [search,setSearch]=useState("");
  const [cat,setCat]=useState("All");
  const [detailProd,setDetailProd]=useState(null);
  const [showQuoteBuilder,setShowQuoteBuilder]=useState(false);
  const [selectedIds,setSelectedIds]=useState([]);
  const [quoteItems,setQuoteItems]=useState([]);
  const filtered=useMemo(()=>prods.filter(p=>{
    const ms=(p.name+p.code+p.cat).toLowerCase().includes(search.toLowerCase());
    const mc=cat==="All"||p.cat===cat;
    return ms&&mc;
  }),[prods,search,cat]);
  function toggleSelect(prod){
    if(selectedIds.includes(prod.id)){setSelectedIds(ids=>ids.filter(i=>i!==prod.id));setQuoteItems(items=>items.filter(i=>i.id!==prod.id));}
    else{setSelectedIds(ids=>[...ids,prod.id]);setQuoteItems(items=>[...items,{...prod,qty:1}]);}
  }
  function updateQty(id,qty){setQuoteItems(items=>items.map(i=>i.id===id?{...i,qty}:i));}
  function removeFromQuote(id){setSelectedIds(ids=>ids.filter(i=>i!==id));setQuoteItems(items=>items.filter(i=>i.id!==id));}
  function handleGenerate(info){
    const ref=makeRef();
    const subtotal=quoteItems.reduce((s,p)=>s+p.price*(p.qty||1),0);
    const discAmt=info.discountType==="%"?subtotal*(parseFloat(info.discountValue)||0)/100:parseFloat(info.discountValue)||0;
    const total=Math.max(0,subtotal-discAmt);
    generateQuotePage(quoteItems,info,ref);
    onSaveQuote({
      id:gid(),ref,
      clientName:info.clientName,
      clientPhone:info.clientPhone||"",
      clientEmail:info.clientEmail||"",
      clientAddress:info.clientAddress||"",
      preparedBy:info.preparedBy||"Lavishome Team",
      quoteDate:info.quoteDate,notes:info.notes||"",
      discountType:info.discountType,discountValue:info.discountValue||"",
      products:quoteItems.map(p=>({id:p.id,code:p.code,name:p.name,cat:p.cat,price:p.price,desc:p.desc||"",dims:p.dims||{w:"",h:"",d:""},photo:p.photo||null,stock:p.stock,qty:p.qty||1})),
      subtotal,discAmt,total,status:"Pending",createdAt:Date.now(),
    });
    setShowQuoteBuilder(false);setSelectedIds([]);setQuoteItems([]);
  }
  return(
    <div>
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
        <div style={{flex:1,minWidth:160,position:"relative"}}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search products…" style={{...inp,paddingLeft:34}}/><span style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",color:G.muted,fontSize:14,pointerEvents:"none"}}>🔍</span></div>
        <select value={cat} onChange={e=>setCat(e.target.value)} style={{...inp,width:"auto",minWidth:140,cursor:"pointer"}}>{ALL_CATS_CAT.map(c=><option key={c} value={c}>{c}</option>)}</select>
        {selectedIds.length>0&&<button onClick={()=>setShowQuoteBuilder(true)} style={{background:G.goldL,border:"none",color:"#fff",borderRadius:7,padding:"9px 16px",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>📋 Create Quote ({selectedIds.length})</button>}
      </div>
      <div style={{fontSize:12,color:G.muted,marginBottom:14}}>✓ Tap products to select for a quote. <strong style={{color:G.cream}}>{filtered.length}</strong> shown.</div>
      {filtered.length===0?<div style={{textAlign:"center",padding:50,color:G.muted}}><div style={{fontSize:36,marginBottom:10}}>📦</div><div>No products found</div></div>:
      <div className="lh-cgrid" style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:16}}>
        {filtered.map(p=>{
          const isSel=selectedIds.includes(p.id);
          const isLow=p.stock<=p.minStock&&p.stock>0,isOut=p.stock===0;
          const d=p.dims,hd=d&&(d.w||d.h||d.d);
          return(
            <div key={p.id} style={{background:G.surf,border:`2px solid ${isSel?G.goldL:G.bdr}`,borderRadius:14,overflow:"hidden",boxShadow:isSel?`0 4px 16px ${G.goldL}33`:"0 2px 8px rgba(0,0,0,0.07)",transition:"all 0.14s",position:"relative"}}>
              <div onClick={()=>toggleSelect(p)} style={{position:"absolute",top:12,left:12,zIndex:10,width:28,height:28,borderRadius:7,background:isSel?G.goldL:"rgba(255,255,255,0.92)",border:`2px solid ${isSel?G.goldL:G.bdr}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",boxShadow:"0 1px 4px rgba(0,0,0,0.1)"}}>
                {isSel&&<span style={{color:"#fff",fontSize:14,fontWeight:700}}>✓</span>}
              </div>
              <div onClick={()=>setDetailProd(p)} style={{height:isMobile?150:170,background:G.surf2,overflow:"hidden",position:"relative",cursor:"pointer"}}>
                {p.photo?<img src={p.photo} style={{width:"100%",height:"100%",objectFit:"cover"}} alt={p.name}/>:<div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",color:G.bdr,fontSize:44}}>🏠</div>}
                <div style={{position:"absolute",top:10,right:10,background:"rgba(255,255,255,0.92)",border:`1px solid ${G.bdr}`,borderRadius:5,padding:"2px 8px",fontSize:10,color:G.gold,fontWeight:700,fontFamily:"monospace"}}>{p.code}</div>
                {isOut&&<div style={{position:"absolute",bottom:10,left:10,background:G.danger,borderRadius:5,padding:"2px 8px",fontSize:9,color:"#fff",fontWeight:700}}>OUT OF STOCK</div>}
                {isLow&&!isOut&&<div style={{position:"absolute",bottom:10,left:10,background:G.warn,borderRadius:5,padding:"2px 8px",fontSize:9,color:"#fff",fontWeight:700}}>LOW STOCK</div>}
              </div>
              <div style={{padding:isMobile?12:14}}>
                <div style={{fontSize:9,color:G.gold,fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:3}}>{p.cat}</div>
                <div style={{fontSize:isMobile?13:14,fontWeight:600,color:G.cream,fontFamily:"'Playfair Display',serif",lineHeight:1.3,marginBottom:4}}>{p.name}</div>
                {p.desc&&<div style={{fontSize:11,color:G.muted,marginBottom:8,lineHeight:1.5}}>{p.desc}</div>}
                {hd&&p.cat!==SERVICE_CAT&&<div style={{display:"inline-flex",alignItems:"center",gap:5,background:G.surf2,border:`1px solid ${G.bdr}`,borderRadius:5,padding:"2px 8px",marginBottom:10}}><span style={{fontSize:9,color:G.muted,textTransform:"uppercase",letterSpacing:"0.1em",fontWeight:700}}>W×H×D</span><span style={{fontSize:11,color:G.gold,fontFamily:"monospace",fontWeight:600}}>{d.w||"–"}×{d.h||"–"}×{d.d||"–"} cm</span></div>}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                  <div style={{fontSize:isMobile?16:18,fontWeight:700,color:G.goldL,fontFamily:"'Playfair Display',serif"}}>${p.price.toLocaleString("en-CA",{minimumFractionDigits:2})}</div>
                  {p.cat===SERVICE_CAT
                    ?<span style={{padding:"3px 9px",borderRadius:999,fontSize:9,fontWeight:700,textTransform:"uppercase",background:"#ba5f3318",color:"#ba5f33",border:"1px solid #ba5f3344"}}>🔧 Service</span>
                    :<span style={{padding:"3px 9px",borderRadius:999,fontSize:9,fontWeight:700,textTransform:"uppercase",background:(isOut?G.danger:isLow?G.warn:G.ok)+"18",color:isOut?G.danger:isLow?G.warn:G.ok,border:`1px solid ${(isOut?G.danger:isLow?G.warn:G.ok)}44`}}>{isOut?"Out of Stock":isLow?`Only ${p.stock} left`:`${p.stock} available`}</span>
                  }
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>setDetailProd(p)} style={{flex:1,background:"#fff",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:7,padding:"9px 6px",fontSize:isMobile?12:11,fontWeight:600,cursor:"pointer"}}>View Details</button>
                  <button onClick={()=>toggleSelect(p)} style={{flex:1,background:isSel?G.ok:G.goldL,border:"none",color:"#fff",borderRadius:7,padding:"9px 6px",fontSize:isMobile?12:11,fontWeight:700,cursor:"pointer"}}>{isSel?"✓ Selected":"+ Add to Quote"}</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>}
      {selectedIds.length>0&&(
        <div className="lh-sticky" style={{position:"fixed",bottom:20,left:"50%",transform:"translateX(-50%)",background:G.goldL,borderRadius:999,padding:"13px 24px",boxShadow:"0 8px 32px rgba(106,78,16,0.35)",display:"flex",alignItems:"center",gap:14,zIndex:99,whiteSpace:"nowrap"}}>
          <span style={{color:"#fff",fontSize:13,fontWeight:600}}>{selectedIds.length} product{selectedIds.length>1?"s":""} selected</span>
          <button onClick={()=>setShowQuoteBuilder(true)} style={{background:"#fff",border:"none",color:G.goldL,borderRadius:999,padding:"8px 18px",fontSize:13,fontWeight:700,cursor:"pointer"}}>📋 Create Quote →</button>
          <button onClick={()=>{setSelectedIds([]);setQuoteItems([]);}} style={{background:"none",border:"1px solid rgba(255,255,255,0.4)",color:"#fff",borderRadius:999,padding:"8px 12px",fontSize:12,cursor:"pointer"}}>Clear</button>
        </div>
      )}
      {detailProd&&<ProductDetailModal product={detailProd} onClose={()=>setDetailProd(null)} onSelectForQuote={toggleSelect} isSelected={selectedIds.includes(detailProd.id)}/>}
      {showQuoteBuilder&&<QuoteBuilderModal selectedProds={quoteItems} onRemove={removeFromQuote} onUpdateQty={updateQty} onClose={()=>setShowQuoteBuilder(false)} onGenerate={handleGenerate} userProfile={userProfile}/>}
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════
//  ACCEPT QUOTE MODAL
//  Shows editable quantities + prices, cash/credit selector, confirm button
// ══════════════════════════════════════════════════════════════════════════
function AcceptQuoteModal({quote, onConfirm, onClose}){
  const isMobile=useIsMobile();
  const [payType,setPayType]=useState("Sale – Cash");
  const [items,setItems]=useState(
    quote.products.map(p=>({...p, confirmedQty: p.qty||1, confirmedPrice: p.price}))
  );

  function updateItem(id, field, val){
    setItems(prev=>prev.map(it=>it.id===id?{...it,[field]:parseFloat(val)||0}:it));
  }

  const total=items.reduce((s,it)=>s+it.confirmedPrice*it.confirmedQty,0);
  const discAmt=quote.discountType==="%"?total*(parseFloat(quote.discountValue)||0)/100:parseFloat(quote.discountValue)||0;
  const finalTotal=Math.max(0,total-discAmt);

  function handleConfirm(){
    onConfirm({payType, items, finalTotal});
  }

  return(
    <ModalWrap onClose={onClose} maxW={580}>
      <div className="lh-modal-pad" style={{padding:"24px 26px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:18}}>
          <div>
            <h2 style={{color:G.goldL,fontFamily:"'Playfair Display',serif",fontSize:isMobile?18:21,fontWeight:700}}>Confirm Acceptance</h2>
            <div style={{fontSize:12,color:G.muted,marginTop:3}}>Client: <strong style={{color:G.cream}}>{quote.clientName}</strong> · {quote.ref}</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:G.muted,fontSize:24,cursor:"pointer"}}>×</button>
        </div>

        {/* Info banner */}
        <div style={{background:G.ok+"10",border:`1px solid ${G.ok}33`,borderRadius:10,padding:"10px 14px",marginBottom:18,fontSize:12,color:G.ok,fontWeight:600}}>
          ✅ Confirming this will automatically deduct stock and create a finance entry.
        </div>

        {/* Payment type */}
        <div style={{marginBottom:18}}>
          <label style={lbl}>Payment Type</label>
          <div style={{display:"flex",gap:10}}>
            {["Sale – Cash","Sale – Credit"].map(t=>(
              <button key={t} onClick={()=>setPayType(t)} style={{flex:1,background:payType===t?G.goldL:"#fff",border:`1px solid ${payType===t?G.goldL:G.bdr}`,color:payType===t?"#fff":G.muted,borderRadius:8,padding:"10px",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                {t==="Sale – Cash"?"💰 Cash Payment":"📋 Credit (Pay Later)"}
              </button>
            ))}
          </div>
          {payType==="Sale – Credit"&&<div style={{fontSize:11,color:G.warn,marginTop:6}}>⚠️ Credit sale — client will owe this amount. Record payment later in Finance.</div>}
        </div>

        {/* Editable product list */}
        <div style={{background:G.surf2,border:`1px solid ${G.bdr}`,borderRadius:10,padding:"14px 16px",marginBottom:18}}>
          <div style={{fontSize:10,color:G.gold,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>Confirm Products & Quantities</div>
          <div style={{fontSize:11,color:G.muted,marginBottom:10}}>Adjust if client changed their mind on quantities or negotiated a different price.</div>
          {items.map(it=>(
            <div key={it.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:`1px solid ${G.bdr}`}}>
              {/* Thumb */}
              <div style={{width:40,height:40,borderRadius:7,overflow:"hidden",background:G.surf,border:`1px solid ${G.bdr}`,flexShrink:0}}>
                {it.photo?<img src={it.photo} style={{width:"100%",height:"100%",objectFit:"cover"}} alt={it.name}/>:<div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>🏠</div>}
              </div>
              {/* Name */}
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,fontWeight:600,color:G.cream,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{it.name}</div>
                <div style={{fontSize:10,color:G.muted}}>{it.cat}</div>
              </div>
              {/* Qty */}
              <div style={{display:"flex",flexDirection:"column",gap:2,alignItems:"center"}}>
                <div style={{fontSize:9,color:G.muted,textTransform:"uppercase",letterSpacing:"0.08em"}}>Qty</div>
                <input type="number" value={it.confirmedQty} min="1"
                  onChange={e=>updateItem(it.id,"confirmedQty",e.target.value)}
                  style={{...inp,width:60,textAlign:"center",padding:"5px 8px",fontSize:13,fontWeight:700}}/>
              </div>
              {/* Price */}
              <div style={{display:"flex",flexDirection:"column",gap:2,alignItems:"center"}}>
                <div style={{fontSize:9,color:G.muted,textTransform:"uppercase",letterSpacing:"0.08em"}}>Unit Price</div>
                <input type="number" value={it.confirmedPrice} min="0"
                  onChange={e=>updateItem(it.id,"confirmedPrice",e.target.value)}
                  style={{...inp,width:90,textAlign:"center",padding:"5px 8px",fontSize:13,fontWeight:700,color:G.goldL}}/>
              </div>
              {/* Line total */}
              <div style={{minWidth:80,textAlign:"right",fontSize:13,fontWeight:700,color:G.goldL}}>{fmt(it.confirmedPrice*it.confirmedQty)}</div>
            </div>
          ))}
        </div>

        {/* Final total */}
        <div style={{background:G.surf2,border:`1px solid ${G.bdr}`,borderRadius:10,padding:"12px 16px",marginBottom:22}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:13,color:G.muted}}>Subtotal</span><span style={{fontSize:13,fontWeight:600,color:G.cream}}>{fmt(total)}</span></div>
          {discAmt>0&&<div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:13,color:G.warn}}>Discount</span><span style={{fontSize:13,fontWeight:600,color:G.warn}}>−{fmt(discAmt)}</span></div>}
          <div style={{display:"flex",justifyContent:"space-between",borderTop:`1px solid ${G.bdr}`,paddingTop:10,marginTop:6}}>
            <span style={{fontSize:15,fontWeight:700,color:G.goldL,fontFamily:"'Playfair Display',serif"}}>Final Total (CAD)</span>
            <span style={{fontSize:isMobile?18:20,fontWeight:700,color:G.goldL,fontFamily:"'Playfair Display',serif"}}>{fmt(finalTotal)}</span>
          </div>
        </div>

        {/* Confirm buttons */}
        <div style={{display:"flex",gap:10}}>
          <button onClick={onClose} style={{flex:1,background:"#fff",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:8,padding:"11px",fontSize:13,fontWeight:600,cursor:"pointer"}}>Cancel</button>
          <button onClick={handleConfirm} style={{flex:2,background:G.ok,border:"none",color:"#fff",borderRadius:8,padding:"11px",fontSize:13,fontWeight:700,cursor:"pointer"}}>✅ Confirm Acceptance</button>
        </div>
      </div>
    </ModalWrap>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  CLIENT HISTORY MODAL
// ══════════════════════════════════════════════════════════════════════════
function ClientHistoryModal({clientName, allQuotes, onClose, onReopen}){
  const isMobile = useIsMobile();
  const clientQuotes = [...allQuotes]
    .filter(q => q.clientName.toLowerCase() === clientName.toLowerCase())
    .sort((a,b) => b.createdAt - a.createdAt);

  const totalSpent = clientQuotes
    .filter(q => q.status === "Accepted")
    .reduce((s,q) => s + q.total, 0);

  return(
    <ModalWrap onClose={onClose} maxW={620}>
      <div className="lh-modal-pad" style={{padding:"24px 26px"}}>
        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
          <div>
            <h2 style={{color:G.goldL,fontFamily:"'Playfair Display',serif",fontSize:isMobile?18:22,fontWeight:700}}>{clientName}</h2>
            <div style={{fontSize:12,color:G.muted,marginTop:4}}>{clientQuotes.length} quote{clientQuotes.length!==1?"s":""} · Total accepted: <strong style={{color:G.ok}}>{fmt(totalSpent)}</strong></div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:G.muted,fontSize:24,cursor:"pointer",lineHeight:1}}>×</button>
        </div>

        {/* Quote list */}
        {clientQuotes.length===0
          ?<div style={{textAlign:"center",padding:40,color:G.muted}}>No quotes found for this client.</div>
          :<div style={{display:"flex",flexDirection:"column",gap:10}}>
            {clientQuotes.map(q=>{
              const sm = STATUS_META[q.status]||STATUS_META.Pending;
              const exp = getExpiryStatus(q.quoteDate, q.status);
              return(
                <div key={q.id} style={{background:G.surf2,border:`1px solid ${G.bdr}`,borderRadius:10,padding:"12px 16px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:8}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                      <span style={{fontFamily:"monospace",fontWeight:700,color:G.gold,fontSize:12}}>{q.ref}</span>
                      <span style={{fontSize:11,color:G.muted}}>📅 {fmtDate(q.quoteDate)}</span>
                      <span style={{padding:"2px 8px",borderRadius:999,fontSize:10,fontWeight:700,background:sm.bg,color:sm.color,border:`1px solid ${sm.border}`}}>{sm.label}</span>
                      {exp&&<span style={{padding:"2px 8px",borderRadius:999,fontSize:10,fontWeight:700,background:exp.bg,color:exp.color,border:`1px solid ${exp.border}`}}>{exp.label}</span>}
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <span style={{fontSize:15,fontWeight:700,color:G.goldL,fontFamily:"'Playfair Display',serif"}}>{fmt(q.total)}</span>
                      <button onClick={()=>onReopen(q)} style={{background:G.goldL,border:"none",color:"#fff",borderRadius:6,padding:"5px 12px",fontSize:11,fontWeight:700,cursor:"pointer"}}>🖨 Open</button>
                    </div>
                  </div>
                  <div style={{fontSize:11,color:G.muted,lineHeight:1.5}}>
                    {q.products.map(p=>p.name+(p.qty>1?" ×"+p.qty:"")).join(", ")}
                  </div>
                </div>
              );
            })}
          </div>
        }
      </div>
    </ModalWrap>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  QUOTE HISTORY TAB
// ══════════════════════════════════════════════════════════════════════════
function QuoteHistoryTab({quotes,archivedQuotes,onUpdateStatus,onArchiveQuote,onRestoreQuote,onPermDeleteQuote,onAcceptQuote,onUndoAcceptance,onDuplicateQuote}){
  const isMobile=useIsMobile();
  const [search,setSearch]=useState("");
  const [statusF,setStatusF]=useState("All");
  const [delConfirm,setDelConfirm]=useState(null);
  const [acceptQuote,setAcceptQuote]=useState(null);
  const [undoConfirm,setUndoConfirm]=useState(null);
  const [showArchive,setShowArchive]=useState(false);
  const [permDelId,setPermDelId]=useState(null);
  const [clientHistory,setClientHistory]=useState(null); // client name string
  const [duplicating,setDuplicating]=useState(null);     // quote to duplicate
  const filtered=useMemo(()=>[...quotes].sort((a,b)=>b.createdAt-a.createdAt).filter(q=>{
    const ms=(q.clientName+q.ref+(q.preparedBy||"")).toLowerCase().includes(search.toLowerCase());
    const mf=statusF==="All"||q.status===statusF;
    return ms&&mf;
  }),[quotes,search,statusF]);
  const totalAll=quotes.length;
  const valAccepted=quotes.filter(q=>q.status==="Accepted").reduce((s,q)=>s+q.total,0);
  const countPending=quotes.filter(q=>q.status==="Pending").length;
  const countAccepted=quotes.filter(q=>q.status==="Accepted").length;
  function reopen(q){generateQuotePage(q.products,{clientName:q.clientName,clientPhone:q.clientPhone||"",clientEmail:q.clientEmail||"",clientAddress:q.clientAddress||"",preparedBy:q.preparedBy,notes:q.notes,discountType:q.discountType,discountValue:q.discountValue,quoteDate:q.quoteDate},q.ref);}
  function exportCSV(){
    const h=["Ref","Client","Prepared By","Date","Products","Subtotal","Discount","Total","Status","Notes"];
    const rows=filtered.map(q=>[q.ref,q.clientName,q.preparedBy||"",q.quoteDate,q.products.map(p=>`${p.name} ×${p.qty}`).join(" | "),q.subtotal.toFixed(2),q.discAmt.toFixed(2),q.total.toFixed(2),q.status,q.notes||""]);
    const csv=[h,...rows].map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download="lavishome_quotes.csv";a.click();
  }
  return(
    <div>
      <div className="lh-stats" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:22}}>
        {[{l:"Total Quotes",v:totalAll,icon:"📋",color:G.goldL},{l:"Pending",v:countPending,icon:"⏳",color:G.warn},{l:"Accepted",v:countAccepted,icon:"✅",color:G.ok},{l:"Accepted Value",v:"$"+valAccepted.toLocaleString("en-CA",{minimumFractionDigits:0}),icon:"💰",color:G.ok}].map(s=>(
          <div key={s.l} style={{background:G.surf,border:`1px solid ${G.bdr}`,borderRadius:12,padding:isMobile?"12px 14px":"16px 18px",boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>
            <div style={{fontSize:isMobile?16:20,marginBottom:3}}>{s.icon}</div>
            <div style={{fontSize:isMobile?15:18,fontWeight:700,color:s.color,fontFamily:"'Playfair Display',serif"}}>{s.v}</div>
            <div style={{fontSize:9,color:G.muted,textTransform:"uppercase",letterSpacing:"0.1em",marginTop:2}}>{s.l}</div>
          </div>
        ))}
      </div>
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
        <div style={{flex:1,minWidth:160,position:"relative"}}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search client or quote ref…" style={{...inp,paddingLeft:34}}/><span style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",color:G.muted,fontSize:14,pointerEvents:"none"}}>🔍</span></div>
        <select value={statusF} onChange={e=>setStatusF(e.target.value)} style={{...inp,width:"auto",minWidth:130,cursor:"pointer"}}><option value="All">All Statuses</option><option value="Pending">⏳ Pending</option><option value="Accepted">✅ Accepted</option><option value="Declined">❌ Declined</option></select>
        <button onClick={exportCSV} style={{background:"#fff",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:7,padding:"9px 14px",fontSize:12,fontWeight:600,cursor:"pointer"}}>⬇ CSV</button>
      </div>
      <div style={{fontSize:12,color:G.muted,marginBottom:14}}>Showing <strong style={{color:G.cream}}>{filtered.length}</strong> of {quotes.length} quotes</div>
      {filtered.length===0&&<div style={{textAlign:"center",padding:60,color:G.muted}}><div style={{fontSize:40,marginBottom:12}}>📋</div><div style={{fontSize:16,fontWeight:600,color:G.cream,marginBottom:6}}>No quotes yet</div><div style={{fontSize:13}}>Generate a quote from the Catalog tab — it will appear here automatically.</div></div>}
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        {filtered.map(q=>{
          const sm=STATUS_META[q.status]||STATUS_META.Pending;
          return(
            <div key={q.id} style={{background:G.surf,border:`1px solid ${G.bdr}`,borderRadius:14,padding:isMobile?"14px 16px":"18px 22px",boxShadow:"0 1px 6px rgba(0,0,0,0.06)"}}>
              <div className="lh-q-row" style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:16,marginBottom:14}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
                    {/* Client name — clickable to open history */}
                    <div
                      onClick={()=>setClientHistory(q.clientName)}
                      style={{fontSize:isMobile?15:17,fontWeight:700,color:G.goldL,fontFamily:"'Playfair Display',serif",cursor:"pointer",textDecoration:"underline",textDecorationStyle:"dotted",textUnderlineOffset:3}}>
                      {q.clientName}
                    </div>
                    <span style={{padding:"3px 10px",borderRadius:999,fontSize:10,fontWeight:700,background:sm.bg,color:sm.color,border:`1px solid ${sm.border}`}}>{sm.label}</span>
                    {/* Expiry flag */}
                    {exp&&<span style={{padding:"3px 10px",borderRadius:999,fontSize:10,fontWeight:700,background:exp.bg,color:exp.color,border:`1px solid ${exp.border}`}}>{exp.label}</span>}
                  </div>
                  <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
                    <div style={{fontSize:11,color:G.muted}}><span style={{fontFamily:"monospace",fontWeight:700,color:G.gold}}>{q.ref}</span></div>
                    <div style={{fontSize:11,color:G.muted}}>📅 {fmtDate(q.quoteDate)}</div>
                    {q.preparedBy&&<div style={{fontSize:11,color:G.muted}}>👤 {q.preparedBy}</div>}
                    <div style={{fontSize:11,color:G.muted}}>🕐 {fmtTs(q.createdAt)}</div>
                  </div>
                  {(q.clientPhone||q.clientEmail||q.clientAddress)&&<div style={{display:"flex",gap:12,flexWrap:"wrap",marginTop:6}}>
                    {q.clientPhone&&<div style={{fontSize:11,color:G.muted}}>📞 {q.clientPhone}</div>}
                    {q.clientEmail&&<div style={{fontSize:11,color:G.muted}}>✉️ {q.clientEmail}</div>}
                    {q.clientAddress&&<div style={{fontSize:11,color:G.muted}}>📍 {q.clientAddress}</div>}
                  </div>}
                </div>
                <div style={{textAlign:"right",flexShrink:0}}>
                  <div style={{fontSize:isMobile?18:22,fontWeight:700,color:G.goldL,fontFamily:"'Playfair Display',serif"}}>{fmt(q.total)}</div>
                  {q.discAmt>0&&<div style={{fontSize:11,color:G.muted,marginTop:2}}>after {q.discountType==="%"?q.discountValue+"%":"$"+q.discountValue} discount</div>}
                </div>
              </div>
              <div style={{background:G.surf2,border:`1px solid ${G.bdr}`,borderRadius:10,padding:"10px 14px",marginBottom:14}}>
                <div style={{fontSize:9,color:G.muted,textTransform:"uppercase",letterSpacing:"0.1em",fontWeight:700,marginBottom:8}}>Products</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                  {q.products.map((p,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:6,background:G.surf,border:`1px solid ${G.bdr}`,borderRadius:7,padding:"5px 10px"}}>
                      {p.photo&&<div style={{width:24,height:24,borderRadius:4,overflow:"hidden",flexShrink:0}}><img src={p.photo} style={{width:"100%",height:"100%",objectFit:"cover"}}/></div>}
                      <span style={{fontSize:12,color:G.cream,fontWeight:500}}>{p.name}</span>
                      {(p.qty||1)>1&&<span style={{fontSize:11,color:G.muted}}>×{p.qty}</span>}
                      <span style={{fontSize:12,fontWeight:600,color:G.gold}}>{fmt(p.price*(p.qty||1))}</span>
                    </div>
                  ))}
                </div>
                {q.notes&&<div style={{fontSize:11,color:G.muted,marginTop:8,paddingTop:8,borderTop:`1px solid ${G.bdr}`}}><span style={{fontWeight:600}}>Note: </span>{q.notes}</div>}
              </div>
              <div className="lh-q-actions" style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <button onClick={()=>reopen(q)} style={{background:G.goldL,border:"none",color:"#fff",borderRadius:7,padding:"8px 16px",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>🖨 Re-open Quote</button>
                <button onClick={()=>onDuplicateQuote(q)} style={{background:G.info+"18",border:`1px solid ${G.info}44`,color:G.info,borderRadius:7,padding:"8px 14px",fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>📋 Duplicate</button>
                {/* Accept — opens modal with editable qty/price/payment type */}
                {q.status!=="Accepted"&&<button onClick={()=>setAcceptQuote(q)} style={{background:G.ok,border:"none",color:"#fff",borderRadius:7,padding:"8px 14px",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>✅ Mark Accepted</button>}
                {/* Undo — only on accepted quotes */}
                {q.status==="Accepted"&&<button onClick={()=>setUndoConfirm(q)} style={{background:G.warn+"18",border:`1px solid ${G.warn}44`,color:G.warn,borderRadius:7,padding:"8px 14px",fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>↩️ Undo Acceptance</button>}
                {q.status!=="Declined"&&q.status!=="Accepted"&&<button onClick={()=>onUpdateStatus(q.id,"Declined")} style={{background:G.muted+"18",border:`1px solid ${G.muted}44`,color:G.muted,borderRadius:7,padding:"8px 14px",fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>❌ Mark Declined</button>}
                {q.status==="Declined"&&<button onClick={()=>onUpdateStatus(q.id,"Pending")} style={{background:G.warn+"18",border:`1px solid ${G.warn}44`,color:G.warn,borderRadius:7,padding:"8px 14px",fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>⏳ Mark Pending</button>}
                <button onClick={()=>setDelConfirm(q.id)} style={{marginLeft:"auto",background:G.warn+"10",border:`1px solid ${G.warn}33`,color:G.warn,borderRadius:7,padding:"8px 12px",fontSize:11,fontWeight:600,cursor:"pointer"}}>🗂️ Archive</button>
              </div>
            </div>
          );
        })}
      </div>
      {/* Archive section */}
      <div style={{marginTop:28}}>
        <button onClick={()=>setShowArchive(s=>!s)} style={{background:"none",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:8,padding:"8px 16px",fontSize:12,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:8}}>
          <span>🗂️ Archived Quotes</span>
          <span style={{background:G.surf2,borderRadius:999,padding:"1px 8px",fontSize:11,fontWeight:700,color:archivedQuotes.length>0?G.warn:G.muted}}>{archivedQuotes.length}</span>
          <span style={{fontSize:11}}>{showArchive?"▲":"▼"}</span>
        </button>
        {showArchive&&<div style={{marginTop:12}}>
          {archivedQuotes.length===0
            ?<div style={{background:G.surf2,border:`1px solid ${G.bdr}`,borderRadius:10,padding:"24px",textAlign:"center",color:G.muted,fontSize:13}}>No archived quotes</div>
            :<div style={{display:"flex",flexDirection:"column",gap:10}}>
              {archivedQuotes.map(q=>(
                <div key={q.id} style={{background:G.surf,border:`1px solid ${G.bdr}`,borderRadius:12,padding:"14px 18px",opacity:0.8}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:8}}>
                    <div>
                      <span style={{fontSize:14,fontWeight:700,color:G.cream,fontFamily:"'Playfair Display',serif"}}>{q.clientName}</span>
                      <span style={{fontSize:11,color:G.muted,marginLeft:10,fontFamily:"monospace"}}>{q.ref}</span>
                      <span style={{fontSize:11,color:G.muted,marginLeft:10}}>📅 {fmtDate(q.quoteDate)}</span>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:15,fontWeight:700,color:G.goldL,fontFamily:"'Playfair Display',serif"}}>{fmt(q.total)}</span>
                    </div>
                  </div>
                  <div style={{fontSize:11,color:G.warn,marginBottom:10}}>🗂️ Archived {q.archivedAt?new Date(q.archivedAt).toLocaleDateString("en-CA",{month:"short",day:"numeric",year:"numeric"}):""}</div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    <button onClick={()=>onRestoreQuote(q.id)} style={{background:G.ok+"18",border:`1px solid ${G.ok}44`,color:G.ok,borderRadius:7,padding:"7px 14px",fontSize:12,fontWeight:600,cursor:"pointer"}}>↩ Restore</button>
                    <button onClick={()=>setPermDelId(q.id)} style={{background:G.danger+"10",border:`1px solid ${G.danger}44`,color:G.danger,borderRadius:7,padding:"7px 14px",fontSize:12,fontWeight:600,cursor:"pointer"}}>🗑 Delete Forever</button>
                  </div>
                </div>
              ))}
            </div>}
        </div>}
      </div>

      {/* Archive confirm */}
      {delConfirm&&<ModalWrap onClose={()=>setDelConfirm(null)} maxW={400}><div style={{padding:28,textAlign:"center"}}>
        <div style={{fontSize:36,marginBottom:12}}>🗂️</div>
        <h3 style={{color:G.cream,fontFamily:"'Playfair Display',serif",marginBottom:8,fontSize:18}}>Archive Quote?</h3>
        <p style={{color:G.muted,fontSize:13,marginBottom:8}}>This quote will be removed from your active list but kept safely in the archive.</p>
        <p style={{color:G.muted,fontSize:13,marginBottom:22}}>You can restore or permanently delete it from the Archive section below.</p>
        <div style={{display:"flex",gap:10,justifyContent:"center"}}>
          <button onClick={()=>setDelConfirm(null)} style={{background:"#fff",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:7,padding:"10px 18px",fontSize:13,fontWeight:600,cursor:"pointer"}}>Cancel</button>
          <button onClick={()=>{onArchiveQuote(delConfirm);setDelConfirm(null);}} style={{background:G.warn,border:"none",color:"#fff",borderRadius:7,padding:"10px 18px",fontSize:13,fontWeight:700,cursor:"pointer"}}>🗂️ Archive</button>
        </div>
      </div></ModalWrap>}

      {/* Permanent delete confirm */}
      {permDelId&&<ModalWrap onClose={()=>setPermDelId(null)} maxW={380}><div style={{padding:28,textAlign:"center"}}>
        <div style={{fontSize:36,marginBottom:12}}>⚠️</div>
        <h3 style={{color:G.danger,fontFamily:"'Playfair Display',serif",marginBottom:8,fontSize:18}}>Permanently Delete?</h3>
        <p style={{color:G.muted,fontSize:13,marginBottom:22}}>This quote will be gone forever. This cannot be undone.</p>
        <div style={{display:"flex",gap:10,justifyContent:"center"}}>
          <button onClick={()=>setPermDelId(null)} style={{background:"#fff",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:7,padding:"10px 18px",fontSize:13,fontWeight:600,cursor:"pointer"}}>Cancel</button>
          <button onClick={()=>{onPermDeleteQuote(permDelId);setPermDelId(null);}} style={{background:G.danger,border:"none",color:"#fff",borderRadius:7,padding:"10px 18px",fontSize:13,fontWeight:700,cursor:"pointer"}}>Delete Forever</button>
        </div>
      </div></ModalWrap>}

      {/* Client history modal */}
      {clientHistory&&<ClientHistoryModal
        clientName={clientHistory}
        allQuotes={[...quotes,...archivedQuotes]}
        onClose={()=>setClientHistory(null)}
        onReopen={q=>{reopen(q);}}
      />}

      {/* Accept quote modal */}
      {acceptQuote&&<AcceptQuoteModal quote={acceptQuote} onClose={()=>setAcceptQuote(null)} onConfirm={(result)=>{onAcceptQuote(acceptQuote,result);setAcceptQuote(null);}}/>}

      {/* Undo confirmation modal */}
      {undoConfirm&&<ModalWrap onClose={()=>setUndoConfirm(null)} maxW={400}>
        <div style={{padding:28,textAlign:"center"}}>
          <div style={{fontSize:36,marginBottom:12}}>↩️</div>
          <h3 style={{color:G.cream,fontFamily:"'Playfair Display',serif",marginBottom:8,fontSize:18}}>Undo Acceptance?</h3>
          <p style={{color:G.muted,fontSize:13,marginBottom:8}}>This will:</p>
          <div style={{background:G.surf2,border:`1px solid ${G.bdr}`,borderRadius:10,padding:"12px 16px",marginBottom:22,textAlign:"left"}}>
            <div style={{fontSize:12,color:G.cream,marginBottom:6}}>📦 Restore stock for all products in this quote</div>
            <div style={{fontSize:12,color:G.cream,marginBottom:6}}>💳 Remove the auto-generated finance entry</div>
            <div style={{fontSize:12,color:G.cream}}>⏳ Set quote status back to Pending</div>
          </div>
          <div style={{display:"flex",gap:10,justifyContent:"center"}}>
            <button onClick={()=>setUndoConfirm(null)} style={{background:"#fff",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:7,padding:"10px 18px",fontSize:13,fontWeight:600,cursor:"pointer"}}>Cancel</button>
            <button onClick={()=>{onUndoAcceptance(undoConfirm);setUndoConfirm(null);}} style={{background:G.warn,border:"none",color:"#fff",borderRadius:7,padding:"10px 18px",fontSize:13,fontWeight:700,cursor:"pointer"}}>↩️ Yes, Undo</button>
          </div>
        </div>
      </ModalWrap>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  INVENTORY MODAL  (with photo compression)
// ══════════════════════════════════════════════════════════════════════════
function InvModal({initial,onSave,onClose}){
  const isMobile=useIsMobile();
  const isEdit=!!initial;
  const [f,setF]=useState(initial||{code:"LH-"+Math.random().toString(36).substr(2,4).toUpperCase(),name:"",cat:"Sofas",price:"",costPrice:"",stock:"",minStock:10,desc:"",dims:{w:"",h:"",d:""},photo:null});
  const [uploading,setUploading]=useState(false);
  const fRef=useRef();
  const set=k=>v=>setF(x=>({...x,[k]:v}));
  const setDim=k=>v=>setF(x=>({...x,dims:{...x.dims,[k]:v}}));

  async function handlePhoto(e){
    const file=e.target.files[0];
    if(!file)return;
    setUploading(true);
    const r=new FileReader();
    r.onload=async ev=>{
      // Compress photo before saving (13x smaller — ~30KB per photo)
      const compressed=await compressPhoto(ev.target.result);
      setF(x=>({...x,photo:compressed}));
      setUploading(false);
    };
    r.readAsDataURL(file);
  }

  function save(){
    if(!f.name.trim()||!f.code.trim())return alert("Name and code required.");
    onSave({...f,price:parseFloat(f.price)||0,costPrice:parseFloat(f.costPrice)||0,stock:parseInt(f.stock)||0,minStock:parseInt(f.minStock)||5,id:initial?.id||gid(),ts:initial?.ts||Date.now()});
  }
  const p=parseFloat(f.price)||0,c=parseFloat(f.costPrice)||0;
  const mg=p>0&&c>0?((p-c)/p*100).toFixed(1):null;
  const profitUnit=p>0&&c>0?p-c:null;
  const markupPct=p>0&&c>0?((p-c)/c*100).toFixed(1):null;
  return(
    <ModalWrap onClose={onClose} maxW={560}>
      <div className="lh-modal-pad" style={{padding:"22px 24px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <h2 style={{color:G.goldL,fontFamily:"'Playfair Display',serif",fontSize:isMobile?18:21,fontWeight:600}}>{isEdit?"Edit Product":"Add Product"}</h2>
          <button onClick={onClose} style={{background:"none",border:"none",color:G.muted,fontSize:22,cursor:"pointer"}}>×</button>
        </div>
        <div style={{marginBottom:14}}>
          <label style={lbl}>Product Photo</label>
          <div onClick={()=>!uploading&&fRef.current.click()} style={{border:`2px dashed ${G.bdr}`,borderRadius:8,height:90,cursor:uploading?"wait":"pointer",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",background:G.surf2}}>
            {uploading?<div style={{textAlign:"center",color:G.muted}}><div style={{fontSize:18,marginBottom:3}}>⏳</div><div style={{fontSize:11}}>Compressing photo…</div></div>:
             f.photo?<img src={f.photo} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="product"/>:
             <div style={{textAlign:"center",color:G.muted}}><div style={{fontSize:22,marginBottom:3}}>📷</div><div style={{fontSize:11}}>Tap to upload — auto compressed</div></div>}
          </div>
          <input ref={fRef} type="file" accept="image/*" onChange={handlePhoto} style={{display:"none"}} capture="environment"/>
          {f.photo&&!uploading&&<button onClick={()=>setF(x=>({...x,photo:null}))} style={{marginTop:6,background:"transparent",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:5,padding:"3px 10px",fontSize:11,cursor:"pointer"}}>Remove photo</button>}
        </div>
        <div className="lh-grid2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <div><label style={lbl}>Product Code</label><input style={inp} value={f.code} onChange={e=>set("code")(e.target.value)}/></div>
          <div><label style={lbl}>Category</label><select style={{...inp,cursor:"pointer"}} value={f.cat} onChange={e=>set("cat")(e.target.value)}>{[...CATS,SERVICE_CAT].map(c=><option key={c} value={c}>{c}</option>)}</select></div>
        </div>
        <div style={{marginBottom:10}}><label style={lbl}>Product Name</label><input style={inp} value={f.name} onChange={e=>set("name")(e.target.value)} placeholder="e.g. Velvet Chesterfield Sofa"/></div>
        <div style={{background:G.surf2,border:`1px solid ${G.bdr}`,borderRadius:10,padding:"12px 14px",marginBottom:10}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",color:G.gold,textTransform:"uppercase",marginBottom:10}}>💰 Pricing</div>
          <div className="lh-grid2" style={{display:"grid",gridTemplateColumns:f.cat===SERVICE_CAT?"1fr":"1fr 1fr",gap:10,marginBottom:mg!==null?10:0}}>
            <div><label style={lbl}>{f.cat===SERVICE_CAT?"Service Price (CAD)":"Selling Price (CAD)"}</label><input style={inp} type="number" value={f.price} onChange={e=>set("price")(e.target.value)} placeholder={f.cat===SERVICE_CAT?"e.g. 150":"e.g. 2499"} min="0"/></div>
            {f.cat!==SERVICE_CAT&&<div><label style={{...lbl,color:G.ok}}>Cost Price (CAD)</label><input style={{...inp,borderColor:"#a0c8b0"}} type="number" value={f.costPrice} onChange={e=>set("costPrice")(e.target.value)} placeholder="e.g. 1400" min="0"/></div>}
          </div>
          {mg!==null&&<div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {[{l:"Profit/Unit",v:fmt(profitUnit),c:profitUnit>=0?G.ok:G.danger},{l:"Margin %",v:mg+"%",c:marginColor(parseFloat(mg))},{l:"Markup %",v:markupPct+"%",c:G.gold}].map(s=>(
              <div key={s.l} style={{flex:1,minWidth:80,background:G.surf,border:`1px solid ${G.bdr}`,borderRadius:8,padding:"8px 10px",textAlign:"center"}}>
                <div style={{fontSize:9,color:G.muted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:2}}>{s.l}</div>
                <div style={{fontSize:13,fontWeight:700,color:s.c}}>{s.v}</div>
              </div>
            ))}
          </div>}
        </div>
        {/* Stock — hidden for services */}
        {f.cat!==SERVICE_CAT&&<div className="lh-grid2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <div><label style={lbl}>Current Stock</label><input style={inp} type="number" value={f.stock} onChange={e=>set("stock")(e.target.value)} min="0"/></div>
          <div><label style={lbl}>Low Stock Alert At</label><input style={inp} type="number" value={f.minStock} onChange={e=>set("minStock")(e.target.value)} min="1"/></div>
        </div>}
        {/* Service info banner */}
        {f.cat===SERVICE_CAT&&<div style={{background:"#fff8e8",border:"1px solid #e8c27a44",borderRadius:10,padding:"10px 14px",marginBottom:10}}>
          <div style={{fontSize:12,color:G.gold,fontWeight:600}}>🔧 Service / Add-on — no stock tracking needed. Just set a price and description.</div>
        </div>}
        {/* Dimensions — hidden for services */}
        {f.cat!==SERVICE_CAT&&<div style={{background:G.surf2,border:`1px solid ${G.bdr}`,borderRadius:10,padding:"12px 14px",marginBottom:10}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",color:G.gold,textTransform:"uppercase",marginBottom:10}}>↔ Dimensions (cm) — optional</div>
          <div className="lh-grid3" style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            {[["w","Width"],["h","Height"],["d","Depth"]].map(([k,l])=><div key={k}><label style={lbl}>{l}</label><input style={inp} type="number" value={f.dims?.[k]||""} onChange={e=>setDim(k)(e.target.value)} placeholder="cm" min="0"/></div>)}
          </div>
        </div>}
        <div style={{marginBottom:18}}><label style={lbl}>Description</label><input style={inp} value={f.desc} onChange={e=>set("desc")(e.target.value)} placeholder="Short description…"/></div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{background:"transparent",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:7,padding:"10px 16px",fontSize:13,fontWeight:600,cursor:"pointer"}}>Cancel</button>
          <button onClick={save} disabled={uploading} style={{background:uploading?G.muted:G.goldL,border:"none",color:"#fff",borderRadius:7,padding:"10px 20px",fontSize:13,fontWeight:700,cursor:uploading?"not-allowed":"pointer"}}>{uploading?"Uploading…":isEdit?"Save Changes":"Add Product"}</button>
        </div>
      </div>
    </ModalWrap>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  INVENTORY TAB
// ══════════════════════════════════════════════════════════════════════════
function InventoryTab({prods,onSaveProduct,onDeleteProduct,onAdjustStock}){
  const isMobile=useIsMobile();
  const [search,setSearch]=useState("");
  const [cat,setCat]=useState("All");
  const [stockF,setStockF]=useState("All");
  const [modal,setModal]=useState(null);
  const [editP,setEditP]=useState(null);
  const [delId,setDelId]=useState(null);
  const [vw,setVw]=useState("grid");

  const filtered=useMemo(()=>prods.filter(p=>{
    if(p.cat===SERVICE_CAT) return false; // Services only in Catalog, not Inventory
    const ms=(p.name+p.code).toLowerCase().includes(search.toLowerCase());
    const mc=cat==="All"||p.cat===cat;
    const mst=stockF==="All"||(stockF==="Low"&&p.stock<=p.minStock&&p.stock>0)||(stockF==="Out"&&p.stock===0)||(stockF==="OK"&&p.stock>p.minStock);
    return ms&&mc&&mst;
  }),[prods,search,cat,stockF]);

  const invProds=prods.filter(p=>p.cat!==SERVICE_CAT); // Exclude services from inventory stats
  const totalSellVal=invProds.reduce((s,p)=>s+p.price*p.stock,0);
  const totalPotProfit=invProds.reduce((s,p)=>s+(p.price-(p.costPrice||0))*p.stock,0);
  const lowN=invProds.filter(p=>p.stock<=p.minStock&&p.stock>0).length;
  const outN=invProds.filter(p=>p.stock===0).length;

  function exportCSV(){
    const h=["Code","Name","Category","Selling Price","Cost Price","Margin %","Profit/Unit","Stock","Min Stock","Status","W","H","D","Description"];
    const rows=filtered.map(p=>{const mg=calcMargin(p.price,p.costPrice);return[p.code,p.name,p.cat,p.price.toFixed(2),(p.costPrice||0).toFixed(2),mg!==null?mg+"%":"",mg!==null?(p.price-p.costPrice).toFixed(2):"",p.stock,p.minStock,p.stock===0?"Out":p.stock<=p.minStock?"Low":"OK",p.dims?.w||"",p.dims?.h||"",p.dims?.d||"",p.desc||""];});
    const csv=[h,...rows].map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download="lavishome_inventory.csv";a.click();
  }

  return(
    <div>
      {/* Stats */}
      <div className="lh-stats" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
        {[{l:"Products",v:prods.length,icon:"📦",a:false,s:false},{l:"Sell Value",v:"$"+totalSellVal.toLocaleString("en-CA",{minimumFractionDigits:0}),icon:"💰",a:false,s:false},{l:"Pot. Profit",v:"$"+totalPotProfit.toLocaleString("en-CA",{minimumFractionDigits:0}),icon:"📈",a:false,s:true},{l:"Low / Out",v:`${lowN} / ${outN}`,icon:"⚠️",a:lowN>0||outN>0,s:false}].map(s=>(
          <div key={s.l} style={{background:G.surf,border:`1px solid ${s.a?G.warn+"88":s.s?G.ok+"44":G.bdr}`,borderRadius:12,padding:isMobile?"12px 14px":"16px 18px",boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>
            <div style={{fontSize:isMobile?16:20,marginBottom:3}}>{s.icon}</div>
            <div style={{fontSize:isMobile?15:18,fontWeight:700,color:s.a?G.warn:s.s?G.ok:G.goldL,fontFamily:"'Playfair Display',serif"}}>{s.v}</div>
            <div style={{fontSize:9,color:G.muted,textTransform:"uppercase",letterSpacing:"0.1em",marginTop:2}}>{s.l}</div>
          </div>
        ))}
      </div>
      {/* Controls */}
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
        <div style={{flex:1,minWidth:160,position:"relative"}}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name or code…" style={{...inp,paddingLeft:34}}/><span style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",color:G.muted,fontSize:14,pointerEvents:"none"}}>🔍</span></div>
        <select value={cat} onChange={e=>setCat(e.target.value)} style={{...inp,width:"auto",minWidth:isMobile?"100%":140,cursor:"pointer"}}>{ALL_CATS_INV.map(c=><option key={c} value={c}>{c}</option>)}</select>
        <select value={stockF} onChange={e=>setStockF(e.target.value)} style={{...inp,width:"auto",minWidth:isMobile?"100%":120,cursor:"pointer"}}>{["All","OK","Low","Out"].map(s=><option key={s} value={s}>{{All:"All Stock",OK:"In Stock",Low:"Low Stock",Out:"Out of Stock"}[s]}</option>)}</select>
        <div style={{display:"flex",gap:4,width:isMobile?"100%":"auto"}}>
          {["grid","table"].map(v=><button key={v} onClick={()=>setVw(v)} style={{flex:isMobile?1:0,background:vw===v?G.goldL:"#fff",border:`1px solid ${vw===v?G.goldL:G.bdr}`,color:vw===v?"#fff":G.muted,borderRadius:7,padding:"8px 12px",fontSize:11,fontWeight:600,cursor:"pointer"}}>{{grid:"⊞ Grid",table:"☰ Table"}[v]}</button>)}
          <button onClick={exportCSV} style={{flex:isMobile?1:0,background:"#fff",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:7,padding:"8px 12px",fontSize:isMobile?12:11,fontWeight:600,cursor:"pointer"}}>⬇ CSV</button>
          <button onClick={()=>{setEditP(null);setModal("add");}} style={{flex:isMobile?2:0,background:G.goldL,border:"none",color:"#fff",borderRadius:7,padding:"8px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>+ Add</button>
        </div>
      </div>
      <div style={{fontSize:12,color:G.muted,marginBottom:12}}>Showing <strong style={{color:G.cream}}>{filtered.length}</strong> of {prods.length} products</div>

      {/* Grid */}
      {vw==="grid"&&(filtered.length===0?<div style={{textAlign:"center",padding:50,color:G.muted}}><div style={{fontSize:36,marginBottom:10}}>📦</div><div>No products found</div></div>:
      <div className="lh-pgrid" style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:16}}>
        {filtered.map(p=>{
          const isLow=p.stock<=p.minStock&&p.stock>0,isOut=p.stock===0,d=p.dims,hd=d&&(d.w||d.h||d.d);
          const mg=calcMargin(p.price,p.costPrice),profitU=p.price&&p.costPrice?p.price-p.costPrice:null;
          return(
            <div key={p.id} style={{background:G.surf,border:`1px solid ${isOut?G.danger+"66":isLow?G.warn+"66":G.bdr}`,borderRadius:14,overflow:"hidden",boxShadow:"0 2px 8px rgba(0,0,0,0.07)",transition:"transform 0.14s,box-shadow 0.14s"}}>
              <div style={{height:140,background:G.surf2,overflow:"hidden",position:"relative"}}>
                {p.photo?<img src={p.photo} style={{width:"100%",height:"100%",objectFit:"cover"}} alt={p.name}/>:<div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",color:G.bdr,fontSize:36}}>🏠</div>}
                <div style={{position:"absolute",top:8,right:8,background:"rgba(255,255,255,0.92)",border:`1px solid ${G.bdr}`,borderRadius:5,padding:"2px 8px",fontSize:10,color:G.gold,fontWeight:700,fontFamily:"monospace"}}>{p.code}</div>
                {(isLow||isOut)&&<div style={{position:"absolute",top:8,left:8,background:isOut?G.danger:G.warn,borderRadius:5,padding:"2px 8px",fontSize:9,color:"#fff",fontWeight:700}}>{isOut?"OUT":"LOW"}</div>}
                {mg!==null&&<div style={{position:"absolute",bottom:8,right:8,background:"rgba(255,255,255,0.92)",border:`1px solid ${G.bdr}`,borderRadius:5,padding:"2px 8px",fontSize:10,color:marginColor(parseFloat(mg)),fontWeight:700}}>{mg}% margin</div>}
              </div>
              <div style={{padding:14}}>
                <div style={{fontSize:9,color:G.gold,fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:3}}>{p.cat}</div>
                <div style={{fontSize:14,fontWeight:600,color:G.cream,fontFamily:"'Playfair Display',serif",lineHeight:1.3,marginBottom:4}}>{p.name}</div>
                {p.desc&&<div style={{fontSize:11,color:G.muted,marginBottom:8,lineHeight:1.5}}>{p.desc}</div>}
                {hd&&<div style={{display:"inline-flex",alignItems:"center",gap:5,background:G.surf2,border:`1px solid ${G.bdr}`,borderRadius:5,padding:"2px 8px",marginBottom:10}}><span style={{fontSize:9,color:G.muted,textTransform:"uppercase",letterSpacing:"0.1em",fontWeight:700}}>W×H×D</span><span style={{fontSize:11,color:G.gold,fontFamily:"monospace",fontWeight:600}}>{d.w||"–"}×{d.h||"–"}×{d.d||"–"} cm</span></div>}
                <div style={{background:G.surf2,borderRadius:8,padding:"10px 12px",marginBottom:10,border:`1px solid ${G.bdr}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:p.costPrice>0?6:0}}>
                    <div><div style={{fontSize:9,color:G.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:2}}>Selling Price</div><div style={{fontSize:16,fontWeight:700,color:G.goldL}}>${p.price.toLocaleString("en-CA",{minimumFractionDigits:2})}</div></div>
                    <span style={{padding:"3px 9px",borderRadius:999,fontSize:9,fontWeight:700,textTransform:"uppercase",background:(isOut?G.danger:isLow?G.warn:G.ok)+"18",color:isOut?G.danger:isLow?G.warn:G.ok,border:`1px solid ${(isOut?G.danger:isLow?G.warn:G.ok)}44`}}>{isOut?"Out":isLow?"Low":p.stock+" in stock"}</span>
                  </div>
                  {p.costPrice>0&&<div style={{display:"flex",gap:10,paddingTop:6,borderTop:`1px solid ${G.bdr}`}}>
                    <div style={{flex:1}}><div style={{fontSize:9,color:G.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:1}}>Cost Price</div><div style={{fontSize:12,fontWeight:600,color:G.ok}}>${p.costPrice.toLocaleString("en-CA",{minimumFractionDigits:2})}</div></div>
                    {profitU!==null&&<div style={{flex:1}}><div style={{fontSize:9,color:G.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:1}}>Profit/Unit</div><div style={{fontSize:12,fontWeight:600,color:profitU>=0?G.ok:G.danger}}>{fmt(profitU)}</div></div>}
                  </div>}
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,background:G.surf2,border:`1px solid ${G.bdr}`,borderRadius:8,padding:"6px 10px"}}>
                  <button onClick={()=>onAdjustStock(p,-1)} style={{background:G.bdr,border:"none",color:G.cream,borderRadius:5,width:28,height:28,fontSize:16,fontWeight:700,cursor:"pointer"}}>−</button>
                  <span style={{flex:1,textAlign:"center",fontSize:12,color:G.muted}}>{p.stock} units</span>
                  <button onClick={()=>onAdjustStock(p,1)} style={{background:G.bdr,border:"none",color:G.cream,borderRadius:5,width:28,height:28,fontSize:16,fontWeight:700,cursor:"pointer"}}>+</button>
                </div>
                <div style={{display:"flex",gap:7}}>
                  <button onClick={()=>{setEditP(p);setModal("edit");}} style={{flex:1,background:"#fff",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:7,padding:"8px 6px",fontSize:12,fontWeight:600,cursor:"pointer"}}>Edit</button>
                  <button onClick={()=>{setDelId(p.id);setModal("del");}} style={{flex:1,background:G.danger+"10",border:`1px solid ${G.danger}44`,color:G.danger,borderRadius:7,padding:"8px 6px",fontSize:12,fontWeight:600,cursor:"pointer"}}>Delete</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>)}

      {/* Table */}
      {vw==="table"&&<div style={{background:G.surf,border:`1px solid ${G.bdr}`,borderRadius:12,overflow:"auto",boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:900}}>
          <thead><tr style={{borderBottom:`2px solid ${G.bdr}`,background:G.surf2}}>{["","Code","Name","Category","Dims","Sell Price","Cost","Profit","Margin","Stock","Status",""].map((h,i)=><th key={i} style={{padding:"10px 12px",textAlign:"left",color:G.muted,fontSize:9,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
          <tbody>{filtered.map((p,idx)=>{
            const isLow=p.stock<=p.minStock&&p.stock>0,isOut=p.stock===0,d=p.dims;
            const mg=calcMargin(p.price,p.costPrice),profitU=p.price&&p.costPrice?p.price-p.costPrice:null;
            return<tr key={p.id} style={{borderBottom:`1px solid ${G.bdr}`,background:idx%2===0?"#fff":G.surf2}}>
              <td style={{padding:"7px 12px"}}><div style={{width:32,height:32,borderRadius:5,overflow:"hidden",background:G.surf2,border:`1px solid ${G.bdr}`}}>{p.photo?<img src={p.photo} style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>🏠</div>}</div></td>
              <td style={{padding:"7px 12px",color:G.gold,fontFamily:"monospace",fontWeight:700,fontSize:10,whiteSpace:"nowrap"}}>{p.code}</td>
              <td style={{padding:"7px 12px",color:G.cream,fontWeight:600,minWidth:130}}>{p.name}</td>
              <td style={{padding:"7px 12px",color:G.muted,whiteSpace:"nowrap"}}>{p.cat}</td>
              <td style={{padding:"7px 12px",color:G.muted,fontFamily:"monospace",fontSize:10,whiteSpace:"nowrap"}}>{d&&(d.w||d.h||d.d)?`${d.w||"–"}×${d.h||"–"}×${d.d||"–"}`:"—"}</td>
              <td style={{padding:"7px 12px",color:G.goldL,fontWeight:700,whiteSpace:"nowrap"}}>${p.price.toLocaleString("en-CA",{minimumFractionDigits:2})}</td>
              <td style={{padding:"7px 12px",color:G.ok,fontWeight:600,whiteSpace:"nowrap"}}>{p.costPrice>0?"$"+p.costPrice.toLocaleString("en-CA",{minimumFractionDigits:2}):"—"}</td>
              <td style={{padding:"7px 12px",fontWeight:600,whiteSpace:"nowrap",color:profitU!==null?(profitU>=0?G.ok:G.danger):G.muted}}>{profitU!==null?fmt(profitU):"—"}</td>
              <td style={{padding:"7px 12px",fontWeight:700,whiteSpace:"nowrap",color:mg!==null?marginColor(parseFloat(mg)):G.muted}}>{mg!==null?mg+"%":"—"}</td>
              <td style={{padding:"7px 12px"}}><div style={{display:"flex",alignItems:"center",gap:4}}>
                <button onClick={()=>onAdjustStock(p,-1)} style={{background:G.surf2,border:`1px solid ${G.bdr}`,color:G.cream,borderRadius:4,width:22,height:22,fontSize:12,cursor:"pointer"}}>−</button>
                <span style={{color:G.cream,fontWeight:700,minWidth:20,textAlign:"center"}}>{p.stock}</span>
                <button onClick={()=>onAdjustStock(p,1)} style={{background:G.surf2,border:`1px solid ${G.bdr}`,color:G.cream,borderRadius:4,width:22,height:22,fontSize:12,cursor:"pointer"}}>+</button>
              </div></td>
              <td style={{padding:"7px 12px"}}><span style={{padding:"2px 7px",borderRadius:999,fontSize:8,fontWeight:700,textTransform:"uppercase",background:(isOut?G.danger:isLow?G.warn:G.ok)+"18",color:isOut?G.danger:isLow?G.warn:G.ok,border:`1px solid ${(isOut?G.danger:isLow?G.warn:G.ok)}44`,whiteSpace:"nowrap"}}>{isOut?"OUT":isLow?`LOW·${p.stock}`:`OK·${p.stock}`}</span></td>
              <td style={{padding:"7px 12px"}}><div style={{display:"flex",gap:5}}>
                <button onClick={()=>{setEditP(p);setModal("edit");}} style={{background:"#fff",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:4,padding:"2px 8px",fontSize:10,fontWeight:600,cursor:"pointer"}}>Edit</button>
                <button onClick={()=>{setDelId(p.id);setModal("del");}} style={{background:G.danger+"10",border:`1px solid ${G.danger}44`,color:G.danger,borderRadius:4,padding:"2px 8px",fontSize:10,fontWeight:600,cursor:"pointer"}}>Del</button>
              </div></td>
            </tr>;
          })}</tbody>
        </table>
      </div>}

      {/* Modals */}
      {(modal==="add"||modal==="edit")&&<InvModal key={editP?.id||"new"} initial={editP} onSave={p=>{onSaveProduct(p);setModal(null);setEditP(null);}} onClose={()=>{setModal(null);setEditP(null);}}/>}
      {modal==="del"&&<ModalWrap onClose={()=>{setModal(null);setDelId(null);}} maxW={360}><div style={{padding:28,textAlign:"center"}}><div style={{fontSize:36,marginBottom:12}}>🗑️</div><h3 style={{color:G.cream,fontFamily:"'Playfair Display',serif",marginBottom:8,fontSize:18}}>Delete Product?</h3><p style={{color:G.muted,fontSize:13,marginBottom:22}}>This cannot be undone.</p><div style={{display:"flex",gap:10,justifyContent:"center"}}><button onClick={()=>{setModal(null);setDelId(null);}} style={{background:"#fff",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:7,padding:"10px 18px",fontSize:13,fontWeight:600,cursor:"pointer"}}>Cancel</button><button onClick={()=>{onDeleteProduct(delId);setModal(null);setDelId(null);}} style={{background:G.danger,border:"none",color:"#fff",borderRadius:7,padding:"10px 18px",fontSize:13,fontWeight:700,cursor:"pointer"}}>Delete</button></div></div></ModalWrap>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  TRANSACTION MODAL
// ══════════════════════════════════════════════════════════════════════════
function TxnModal({initial,onSave,onClose}){
  const isMobile=useIsMobile();
  const today=new Date().toISOString().split("T")[0];
  const [f,setF]=useState(initial||{type:"Sale – Cash",date:today,party:"",desc:"",amount:"",ref:"",notes:""});
  const set=k=>v=>setF(x=>({...x,[k]:v}));
  const meta=TXN_TYPES[f.type]||{};
  function save(){if(!f.type||!f.date||!f.party||!f.desc||!f.amount)return alert("Please fill all required fields.");const amt=parseFloat(f.amount);if(isNaN(amt)||amt<=0)return alert("Enter a valid positive amount.");onSave({...f,amount:amt,id:initial?.id||gid(),ts:initial?.ts||Date.now()});}
  const effRow=(label,val)=>{if(val===0)return null;return<div style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${G.bdr}`}}><span style={{fontSize:12,color:G.muted}}>{label}</span><span style={{fontSize:12,fontWeight:700,color:val>0?G.ok:G.danger}}>{val>0?"+ Amount":"− Amount"}</span></div>;};
  const grouped=TXN_KEYS.reduce((acc,k)=>{const g=TXN_TYPES[k].group;if(!acc[g])acc[g]=[];acc[g].push(k);return acc;},{});
  return(<ModalWrap onClose={onClose} maxW={520}><div className="lh-modal-pad" style={{padding:"22px 24px"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}><h2 style={{color:G.goldL,fontFamily:"'Playfair Display',serif",fontSize:isMobile?18:21,fontWeight:600}}>{initial?"Edit Transaction":"Record Transaction"}</h2><button onClick={onClose} style={{background:"none",border:"none",color:G.muted,fontSize:22,cursor:"pointer"}}>×</button></div>
    <div style={{marginBottom:12}}><label style={lbl}>Transaction Type *</label><select style={{...inp,cursor:"pointer"}} value={f.type} onChange={e=>set("type")(e.target.value)}>{Object.entries(grouped).map(([grp,items])=><optgroup key={grp} label={grp}>{items.map(k=><option key={k} value={k}>{TXN_TYPES[k].icon} {k}</option>)}</optgroup>)}</select></div>
    <div style={{background:G.surf2,border:`1px solid ${G.bdr}`,borderRadius:10,padding:"10px 14px",marginBottom:12}}><div style={{fontSize:10,color:G.gold,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>ℹ Accounting Effects</div>{effRow("Cash Balance",meta.cash||0)}{effRow("Debtors (A/R)",meta.debtor||0)}{effRow("Creditors (A/P)",meta.creditor||0)}{effRow("Equity / Capital",meta.equity||0)}</div>
    <div className="lh-grid2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}><div><label style={lbl}>Date *</label><input style={inp} type="date" value={f.date} onChange={e=>set("date")(e.target.value)}/></div><div><label style={lbl}>Reference No.</label><input style={inp} value={f.ref} onChange={e=>set("ref")(e.target.value)} placeholder="e.g. INV-001"/></div></div>
    <div className="lh-grid2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}><div><label style={lbl}>Party / Name *</label><input style={inp} value={f.party} onChange={e=>set("party")(e.target.value)} placeholder="Customer, Supplier…"/></div><div><label style={lbl}>Amount (CAD) *</label><input style={inp} type="number" value={f.amount} onChange={e=>set("amount")(e.target.value)} placeholder="0.00" min="0"/></div></div>
    <div style={{marginBottom:10}}><label style={lbl}>Description *</label><input style={inp} value={f.desc} onChange={e=>set("desc")(e.target.value)} placeholder="What is this transaction for?"/></div>
    <div style={{marginBottom:20}}><label style={lbl}>Notes (optional)</label><textarea style={{...inp,resize:"vertical"}} rows={2} value={f.notes} onChange={e=>set("notes")(e.target.value)} placeholder="Additional details…"/></div>
    <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><button onClick={onClose} style={{background:"#fff",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:7,padding:"10px 16px",fontSize:13,fontWeight:600,cursor:"pointer"}}>Cancel</button><button onClick={save} style={{background:G.goldL,border:"none",color:"#fff",borderRadius:7,padding:"10px 20px",fontSize:13,fontWeight:700,cursor:"pointer"}}>{initial?"Save Changes":"Record"}</button></div>
  </div></ModalWrap>);
}

// ══════════════════════════════════════════════════════════════════════════
//  FINANCE TAB
// ══════════════════════════════════════════════════════════════════════════
function FinanceTab({txns,archivedTxns,onAddTxn,onArchiveTxn,onRestoreTxn,onPermDeleteTxn,currentUser}){
  const isMobile=useIsMobile();
  const [search,setSearch]=useState("");
  const [typeF,setTypeF]=useState("All");
  const [modal,setModal]=useState(null);
  const [editT,setEditT]=useState(null);
  const [delId,setDelId]=useState(null);
  const [view,setView]=useState("ledger");
  const [showArchive,setShowArchive]=useState(false);
  const [permDelId,setPermDelId]=useState(null);
  const balances=useMemo(()=>{let cash=0,debtor=0,creditor=0,equity=0,revenue=0,expenses=0;txns.forEach(t=>{const m=TXN_TYPES[t.type];if(!m)return;cash+=m.cash*t.amount;debtor+=m.debtor*t.amount;creditor+=m.creditor*t.amount;equity+=m.equity*t.amount;if(m.group==="Revenue")revenue+=t.amount;if(m.group==="Expense")expenses+=t.amount;});return{cash,debtor,creditor,equity,revenue,expenses,profit:revenue-expenses};},[txns]);
  const filtered=useMemo(()=>[...txns].sort((a,b)=>new Date(b.date)-new Date(a.date)).filter(t=>{const ms=(t.desc+t.party+(t.ref||"")).toLowerCase().includes(search.toLowerCase());const mt=typeF==="All"||t.type===typeF;return ms&&mt;}),[txns,search,typeF]);
  function exportCSV(){const h=["Date","Type","Party","Description","Amount","Cash Δ","Debtor Δ","Creditor Δ","Equity Δ","Reference","Notes"];const rows=filtered.map(t=>{const m=TXN_TYPES[t.type]||{};return[t.date,t.type,t.party,t.desc,t.amount.toFixed(2),(m.cash||0)*t.amount,(m.debtor||0)*t.amount,(m.creditor||0)*t.amount,(m.equity||0)*t.amount,t.ref||"",t.notes||""];});const csv=[h,...rows].map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download="lavishome_transactions.csv";a.click();}
  const sCard=(label,val,color,sub)=>(<div style={{background:G.surf,border:`1px solid ${G.bdr}`,borderRadius:12,padding:isMobile?"14px 14px":"18px 20px",boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}><div style={{fontSize:10,color:G.muted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6}}>{label}</div><div style={{fontSize:isMobile?18:22,fontWeight:700,color:color||G.goldL,fontFamily:"'Playfair Display',serif"}}>{fmt(val)}</div>{sub&&<div style={{fontSize:11,color:G.muted,marginTop:4}}>{sub}</div>}</div>);
  const effCell=v=><td style={{padding:"8px 12px",fontFamily:"monospace",fontSize:11,color:v>0?G.ok:v<0?G.danger:G.muted,fontWeight:v!==0?700:400,whiteSpace:"nowrap"}}>{v!==0?(v>0?"+":"")+fmt(v):"—"}</td>;
  return(<div>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:8}}>
      <div style={{display:"flex",gap:4}}>{[["ledger","📒 Ledger"],["summary","📊 Summary"]].map(([v,l])=>(<button key={v} onClick={()=>setView(v)} style={{background:view===v?G.goldL:"#fff",border:`1px solid ${view===v?G.goldL:G.bdr}`,color:view===v?"#fff":G.muted,borderRadius:7,padding:"7px 14px",fontSize:11,fontWeight:600,cursor:"pointer"}}>{l}</button>))}</div>
      <div style={{display:"flex",gap:8}}><button onClick={exportCSV} style={{background:"#fff",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:7,padding:"7px 12px",fontSize:12,fontWeight:600,cursor:"pointer"}}>⬇</button><button onClick={()=>{setEditT(null);setModal("add");}} style={{background:G.goldL,border:"none",color:"#fff",borderRadius:7,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>+ Record</button></div>
    </div>
    {view==="summary"&&<div>
      <div className="lh-fin2" style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:14,marginBottom:20}}>{sCard("💵 Cash Balance",balances.cash,balances.cash>=0?G.ok:G.danger,"Available funds")}{sCard("📋 Debtors (A/R)",balances.debtor,G.info,"Owed to Lavishome")}{sCard("🏦 Creditors (A/P)",balances.creditor,G.warn,"Lavishome owes")}{sCard("🤝 Net Equity",balances.equity,G.gold,"Partners' stake")}</div>
      <div style={{background:G.surf,border:`1px solid ${G.bdr}`,borderRadius:12,padding:"18px 20px",marginBottom:18,boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}><div style={{fontSize:11,color:G.gold,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:14}}>📈 Income Summary</div>{[{label:"Total Revenue",val:balances.revenue,color:G.ok},{label:"Total Expenses",val:balances.expenses,color:G.danger},{label:"Net Profit / Loss",val:balances.profit,color:balances.profit>=0?G.ok:G.danger,bold:true}].map(r=>(<div key={r.label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"11px 0",borderBottom:`1px solid ${G.bdr}`}}><span style={{fontSize:13,color:G.muted,fontWeight:r.bold?700:400}}>{r.label}</span><span style={{fontSize:r.bold?isMobile?16:20:14,fontWeight:700,color:r.color,fontFamily:r.bold?"'Playfair Display',serif":"inherit"}}>{fmt(r.val)}</span></div>))}</div>
      <div style={{background:G.surf,border:`1px solid ${G.bdr}`,borderRadius:12,padding:"18px 20px",boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}><div style={{fontSize:11,color:G.gold,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:14}}>Breakdown by Type</div>{TXN_KEYS.map(k=>{const items=txns.filter(t=>t.type===k);if(!items.length)return null;const total=items.reduce((s,t)=>s+t.amount,0),m=TXN_TYPES[k];return<div key={k} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${G.bdr}`}}><div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:14}}>{m.icon}</span><span style={{fontSize:12,color:G.cream}}>{k}</span><span style={{fontSize:10,color:G.muted}}>{items.length} txn{items.length>1?"s":""}</span></div><span style={{fontSize:12,fontWeight:700,color:m.color}}>{fmt(total)}</span></div>;})}</div>
    </div>}
    {view==="ledger"&&<div>
      <div className="lh-fin4" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:18}}>{[["💵 Cash",balances.cash,balances.cash>=0?G.ok:G.danger],["📋 Debtors",balances.debtor,G.info],["🏦 Creditors",balances.creditor,G.warn],["🤝 Equity",balances.equity,G.gold]].map(([l,v,c])=>(<div key={l} style={{background:G.surf,border:`1px solid ${G.bdr}`,borderRadius:10,padding:"12px 14px",boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}><div style={{fontSize:10,color:G.muted,marginBottom:4}}>{l}</div><div style={{fontSize:isMobile?13:15,fontWeight:700,color:c,fontFamily:"'Playfair Display',serif"}}>{fmt(v)}</div></div>))}</div>
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}><div style={{flex:1,minWidth:160,position:"relative"}}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search transactions…" style={{...inp,paddingLeft:34}}/><span style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",color:G.muted,fontSize:14,pointerEvents:"none"}}>🔍</span></div><select value={typeF} onChange={e=>setTypeF(e.target.value)} style={{...inp,width:"auto",minWidth:isMobile?"100%":180,cursor:"pointer"}}><option value="All">All Types</option>{TXN_KEYS.map(k=><option key={k} value={k}>{TXN_TYPES[k].icon} {k}</option>)}</select></div>
      <div style={{fontSize:12,color:G.muted,marginBottom:12}}>Showing <strong style={{color:G.cream}}>{filtered.length}</strong> transactions</div>
      {filtered.length===0?<div style={{textAlign:"center",padding:50,color:G.muted}}><div style={{fontSize:36,marginBottom:10}}>📒</div><div>No transactions yet</div></div>:
      <div style={{background:G.surf,border:`1px solid ${G.bdr}`,borderRadius:12,overflow:"auto",boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:900}}>
        <thead><tr style={{borderBottom:`2px solid ${G.bdr}`,background:G.surf2}}>{["Date","Type","Party","Description","Amount","Cash Δ","Debtor Δ","Creditor Δ","Equity Δ","Ref",""].map((h,i)=><th key={i} style={{padding:"10px 12px",textAlign:"left",color:G.muted,fontSize:9,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
        <tbody>{filtered.map((t,idx)=>{const m=TXN_TYPES[t.type]||{cash:0,debtor:0,creditor:0,equity:0};return<tr key={t.id} style={{borderBottom:`1px solid ${G.bdr}`,background:idx%2===0?"#fff":G.surf2}}>
          <td style={{padding:"8px 12px",color:G.muted,fontSize:11,whiteSpace:"nowrap"}}>{fmtDate(t.date)}</td>
          <td style={{padding:"8px 12px",whiteSpace:"nowrap"}}><span style={{display:"inline-flex",alignItems:"center",gap:5,padding:"3px 8px",borderRadius:6,background:(m.color||G.gold)+"18",color:m.color||G.gold,fontSize:10,fontWeight:700,border:`1px solid ${(m.color||G.gold)}33`}}>{TXN_TYPES[t.type]?.icon} {t.type}</span></td>
          <td style={{padding:"8px 12px",color:G.cream,maxWidth:100,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.party}</td>
          <td style={{padding:"8px 12px",color:G.muted,maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.desc}</td>
          <td style={{padding:"8px 12px",color:G.goldL,fontWeight:700,whiteSpace:"nowrap"}}>{fmt(t.amount)}</td>
          {effCell(m.cash*t.amount)}{effCell(m.debtor*t.amount)}{effCell(m.creditor*t.amount)}{effCell(m.equity*t.amount)}
          <td style={{padding:"8px 12px",color:G.muted,fontSize:10,fontFamily:"monospace"}}>{t.ref||"—"}</td>
          <td style={{padding:"8px 12px"}}><div style={{display:"flex",gap:5}}><button onClick={()=>{setEditT(t);setModal("edit");}} style={{background:"#fff",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:5,padding:"3px 10px",fontSize:10,fontWeight:600,cursor:"pointer"}}>Edit</button><button onClick={()=>{setDelId(t.id);setModal("del");}} style={{background:G.danger+"10",border:`1px solid ${G.danger}44`,color:G.danger,borderRadius:5,padding:"3px 10px",fontSize:10,fontWeight:600,cursor:"pointer"}}>Del</button></div></td>
        </tr>;})}
        </tbody></table></div>}
    </div>}
    {/* Archive section — collapsed by default */}
    {view==="ledger"&&<div style={{marginTop:28}}>
      <button onClick={()=>setShowArchive(s=>!s)} style={{background:"none",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:8,padding:"8px 16px",fontSize:12,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:8}}>
        <span>🗂️ Archived Transactions</span>
        <span style={{background:G.surf2,borderRadius:999,padding:"1px 8px",fontSize:11,fontWeight:700,color:archivedTxns.length>0?G.warn:G.muted}}>{archivedTxns.length}</span>
        <span style={{fontSize:11}}>{showArchive?"▲":"▼"}</span>
      </button>
      {showArchive&&<div style={{marginTop:12}}>
        {archivedTxns.length===0
          ?<div style={{background:G.surf2,border:`1px solid ${G.bdr}`,borderRadius:10,padding:"24px",textAlign:"center",color:G.muted,fontSize:13}}>No archived transactions</div>
          :<div style={{background:G.surf,border:`1px solid ${G.bdr}`,borderRadius:12,overflow:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:700}}>
              <thead><tr style={{borderBottom:`2px solid ${G.bdr}`,background:G.surf2}}>
                {["Date","Type","Party","Description","Amount","Archived","Actions"].map((h,i)=><th key={i} style={{padding:"10px 12px",textAlign:"left",color:G.muted,fontSize:9,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>)}
              </tr></thead>
              <tbody>{archivedTxns.map((t,idx)=>{
                const m=TXN_TYPES[t.type]||{};
                return<tr key={t.id} style={{borderBottom:`1px solid ${G.bdr}`,background:idx%2===0?"#fff":G.surf2,opacity:0.75}}>
                  <td style={{padding:"8px 12px",color:G.muted,fontSize:11,whiteSpace:"nowrap"}}>{fmtDate(t.date)}</td>
                  <td style={{padding:"8px 12px",whiteSpace:"nowrap"}}><span style={{display:"inline-flex",alignItems:"center",gap:5,padding:"3px 8px",borderRadius:6,background:(m.color||G.gold)+"18",color:m.color||G.gold,fontSize:10,fontWeight:700,border:`1px solid ${(m.color||G.gold)}33`}}>{TXN_TYPES[t.type]?.icon} {t.type}</span></td>
                  <td style={{padding:"8px 12px",color:G.cream,maxWidth:100,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.party}</td>
                  <td style={{padding:"8px 12px",color:G.muted,maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.desc}</td>
                  <td style={{padding:"8px 12px",color:G.goldL,fontWeight:700,whiteSpace:"nowrap"}}>{fmt(t.amount)}</td>
                  <td style={{padding:"8px 12px",color:G.muted,fontSize:10,whiteSpace:"nowrap"}}>{t.archivedAt?new Date(t.archivedAt).toLocaleDateString("en-CA",{month:"short",day:"numeric"}):""}</td>
                  <td style={{padding:"8px 12px"}}><div style={{display:"flex",gap:6}}>
                    <button onClick={()=>onRestoreTxn(t.id)} style={{background:G.ok+"18",border:`1px solid ${G.ok}44`,color:G.ok,borderRadius:5,padding:"3px 10px",fontSize:10,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>↩ Restore</button>
                    <button onClick={()=>setPermDelId(t.id)} style={{background:G.danger+"10",border:`1px solid ${G.danger}44`,color:G.danger,borderRadius:5,padding:"3px 10px",fontSize:10,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>🗑 Delete Forever</button>
                  </div></td>
                </tr>;
              })}</tbody>
            </table>
          </div>}
      </div>}
    </div>}

    {(modal==="add"||modal==="edit")&&<TxnModal initial={editT} onSave={p=>{onAddTxn(p);setModal(null);setEditT(null);}} onClose={()=>{setModal(null);setEditT(null);}}/>}
    {/* Permanent delete confirm */}
    {permDelId&&<ModalWrap onClose={()=>setPermDelId(null)} maxW={380}>
      <div style={{padding:28,textAlign:"center"}}>
        <div style={{fontSize:36,marginBottom:12}}>⚠️</div>
        <h3 style={{color:G.danger,fontFamily:"'Playfair Display',serif",marginBottom:8,fontSize:18}}>Permanently Delete?</h3>
        <p style={{color:G.muted,fontSize:13,marginBottom:22}}>This transaction will be gone forever and cannot be recovered. Are you absolutely sure?</p>
        <div style={{display:"flex",gap:10,justifyContent:"center"}}>
          <button onClick={()=>setPermDelId(null)} style={{background:"#fff",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:7,padding:"10px 18px",fontSize:13,fontWeight:600,cursor:"pointer"}}>Cancel</button>
          <button onClick={()=>{onPermDeleteTxn(permDelId);setPermDelId(null);}} style={{background:G.danger,border:"none",color:"#fff",borderRadius:7,padding:"10px 18px",fontSize:13,fontWeight:700,cursor:"pointer"}}>Delete Forever</button>
        </div>
      </div>
    </ModalWrap>}
    {/* Archive confirm — soft delete */}
    {modal==="del"&&<ModalWrap onClose={()=>{setModal(null);setDelId(null);}} maxW={400}>
      <div style={{padding:28,textAlign:"center"}}>
        <div style={{fontSize:36,marginBottom:12}}>🗂️</div>
        <h3 style={{color:G.cream,fontFamily:"'Playfair Display',serif",marginBottom:8,fontSize:18}}>Archive Transaction?</h3>
        <p style={{color:G.muted,fontSize:13,marginBottom:8}}>The transaction will be removed from your ledger and balances but kept in your archive.</p>
        <p style={{color:G.muted,fontSize:13,marginBottom:22}}>You or your manager can restore or permanently delete it from the Archive section.</p>
        <div style={{display:"flex",gap:10,justifyContent:"center"}}>
          <button onClick={()=>{setModal(null);setDelId(null);}} style={{background:"#fff",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:7,padding:"10px 18px",fontSize:13,fontWeight:600,cursor:"pointer"}}>Cancel</button>
          <button onClick={()=>{onArchiveTxn(delId);setModal(null);setDelId(null);}} style={{background:G.warn,border:"none",color:"#fff",borderRadius:7,padding:"10px 18px",fontSize:13,fontWeight:700,cursor:"pointer"}}>🗂️ Archive</button>
        </div>
      </div>
    </ModalWrap>}
  </div>);
}

// ══════════════════════════════════════════════════════════════════════════
//  ROOT APP
// ══════════════════════════════════════════════════════════════════════════
export default function LavisHomeApp(){
  const isMobile=useIsMobile();
  const [prods,setProds]=useState([]);
  const [txns,setTxns]=useState([]);
  const [quotes,setQuotes]=useState([]);
  const [archivedTxns,setArchivedTxns]=useState([]);
  const [archivedQuotes,setArchivedQuotes]=useState([]);
  const [loaded,setLoaded]=useState(false);
  const [tab,setTab]=useState("inventory");
  const [saved,setSaved]=useState("");
  // ── Auth state
  const [authState,setAuthState]=useState("loading"); // "loading" | "loggedOut" | "denied" | "approved"
  const [currentUser,setCurrentUser]=useState(null);
  const [loginLoading,setLoginLoading]=useState(false);
  const [loginError,setLoginError]=useState("");
  const [userProfile,setUserProfile]=useState(null);  // {displayName, email, uid}
  const [needsName,setNeedsName]=useState(false);     // true = first login, show name modal

  // ── Google Auth listener — runs first, loads user profile, then data
  useEffect(()=>{
    const unsub=onAuthStateChanged(auth,async user=>{
      if(!user){
        setAuthState("loggedOut");setCurrentUser(null);
        setUserProfile(null);setNeedsName(false);
        return;
      }
      const email=user.email?.toLowerCase();
      const approved=APPROVED_EMAILS.map(e=>e.toLowerCase()).includes(email);
      if(!approved){setCurrentUser(user);setAuthState("denied");return;}
      // Load saved display name from Firebase
      try{
        const profileDoc=await getDoc(doc(db,"lavishome_users",user.uid));
        if(profileDoc.exists()){
          setUserProfile(profileDoc.data());
          setNeedsName(false);
        } else {
          // First login — no name saved yet
          setUserProfile(null);
          setNeedsName(true);
        }
      }catch{
        // If profile load fails, still let them in — name can be set later
        setUserProfile(null);
        setNeedsName(true);
      }
      setCurrentUser(user);
      setAuthState("approved");
    });
    return()=>unsub();
  },[]);

  // ── Firebase data listeners — only run when user is approved
  useEffect(()=>{
    if(authState!=="approved")return;
    let invOk=false,txnOk=false,qtOk=false,aTxnOk=false,aQtOk=false;
    function check(){if(invOk&&txnOk&&qtOk&&aTxnOk&&aQtOk)setLoaded(true);}
    const timeout=setTimeout(()=>{
      if(!invOk)setProds(SAMPLE_INV);
      if(!txnOk)setTxns(SAMPLE_TXN);
      if(!qtOk)setQuotes([]);
      if(!aTxnOk)setArchivedTxns([]);
      if(!aQtOk)setArchivedQuotes([]);
      setLoaded(true);
    },8000);

    const unsubInv=onSnapshot(
      collection(db,"lavishome_products"),
      snap=>{
        const items=snap.docs.map(d=>d.data());
        if(items.length===0&&!invOk){
          getDoc(doc(db,"lavishome","inventory")).then(oldDoc=>{
            if(oldDoc.exists()&&oldDoc.data().items?.length>0){
              const oldItems=oldDoc.data().items;
              Promise.all(oldItems.map(p=>setDoc(doc(db,"lavishome_products",p.id),p)));
            } else {
              Promise.all(SAMPLE_INV.map(p=>setDoc(doc(db,"lavishome_products",p.id),p)));
            }
          }).catch(()=>{});
        }
        setProds(items);invOk=true;check();
      },
      ()=>{setProds(SAMPLE_INV);invOk=true;check();}
    );
    const unsubTxn=onSnapshot(doc(db,"lavishome","transactions"),
      snap=>{setTxns(snap.exists()?(snap.data().items||[]):SAMPLE_TXN);txnOk=true;check();},
      ()=>{setTxns(SAMPLE_TXN);txnOk=true;check();}
    );
    const unsubQt=onSnapshot(doc(db,"lavishome","quotes"),
      snap=>{setQuotes(snap.exists()?(snap.data().items||[]):[]);qtOk=true;check();},
      ()=>{setQuotes([]);qtOk=true;check();}
    );
    const unsubATxn=onSnapshot(doc(db,"lavishome","archivedTransactions"),
      snap=>{setArchivedTxns(snap.exists()?(snap.data().items||[]):[]);aTxnOk=true;check();},
      ()=>{setArchivedTxns([]);aTxnOk=true;check();}
    );
    const unsubAQt=onSnapshot(doc(db,"lavishome","archivedQuotes"),
      snap=>{setArchivedQuotes(snap.exists()?(snap.data().items||[]):[]);aQtOk=true;check();},
      ()=>{setArchivedQuotes([]);aQtOk=true;check();}
    );
    return()=>{unsubInv();unsubTxn();unsubQt();unsubATxn();unsubAQt();clearTimeout(timeout);};
  },[authState]);

  // ── Auth handlers
  async function handleLogin(){
    setLoginLoading(true);setLoginError("");
    try{await signInWithPopup(auth,googleProvider);}
    catch(e){
      if(e.code==="auth/popup-closed-by-user")setLoginError("Sign-in was cancelled. Please try again.");
      else setLoginError("Sign-in failed. Please try again.");
    }
    setLoginLoading(false);
  }
  async function handleSignOut(){
    await signOut(auth);
    setAuthState("loggedOut");setCurrentUser(null);setLoaded(false);
    setUserProfile(null);setNeedsName(false);
    setProds([]);setTxns([]);setQuotes([]);setArchivedTxns([]);setArchivedQuotes([]);
  }

  function handleNameSaved(name){
    setUserProfile({uid:currentUser.uid,email:currentUser.email,displayName:name});
    setNeedsName(false);
  }

  // ── Archive: transactions
  async function archiveTxn(id){
    const txn=txns.find(t=>t.id===id);if(!txn)return;
    const archived={...txn,archived:true,archivedAt:Date.now(),archivedBy:userProfile?.displayName||currentUser?.email||"unknown"};
    const newTxns=txns.filter(t=>t.id!==id);
    const newArchived=[...archivedTxns,archived];
    await saveWithRetry(doc(db,"lavishome","transactions"),{items:newTxns});
    await saveWithRetry(doc(db,"lavishome","archivedTransactions"),{items:newArchived});
    setTxns(newTxns);setArchivedTxns(newArchived);
    setSaved("Archived ✓");setTimeout(()=>setSaved(""),2000);
  }
  async function restoreTxn(id){
    const txn=archivedTxns.find(t=>t.id===id);if(!txn)return;
    const restored={...txn,archived:false,archivedAt:null,archivedBy:null};
    const newArchived=archivedTxns.filter(t=>t.id!==id);
    const newTxns=[...txns,restored];
    await saveWithRetry(doc(db,"lavishome","transactions"),{items:newTxns});
    await saveWithRetry(doc(db,"lavishome","archivedTransactions"),{items:newArchived});
    setTxns(newTxns);setArchivedTxns(newArchived);
    setSaved("Restored ✓");setTimeout(()=>setSaved(""),2000);
  }
  async function permDeleteTxn(id){
    const newArchived=archivedTxns.filter(t=>t.id!==id);
    await saveWithRetry(doc(db,"lavishome","archivedTransactions"),{items:newArchived});
    setArchivedTxns(newArchived);
    setSaved("Permanently deleted");setTimeout(()=>setSaved(""),2000);
  }

  // ── Archive: quotes
  async function archiveQuote(id){
    const qt=quotes.find(q=>q.id===id);if(!qt)return;
    const archived={...qt,archived:true,archivedAt:Date.now(),archivedBy:userProfile?.displayName||currentUser?.email||"unknown"};
    const newQuotes=quotes.filter(q=>q.id!==id);
    const newArchived=[...archivedQuotes,archived];
    await saveWithRetry(doc(db,"lavishome","quotes"),{items:newQuotes});
    await saveWithRetry(doc(db,"lavishome","archivedQuotes"),{items:newArchived});
    setQuotes(newQuotes);setArchivedQuotes(newArchived);
    setSaved("Archived ✓");setTimeout(()=>setSaved(""),2000);
  }
  async function restoreQuote(id){
    const qt=archivedQuotes.find(q=>q.id===id);if(!qt)return;
    const restored={...qt,archived:false,archivedAt:null,archivedBy:null};
    const newArchived=archivedQuotes.filter(q=>q.id!==id);
    const newQuotes=[...quotes,restored];
    await saveWithRetry(doc(db,"lavishome","quotes"),{items:newQuotes});
    await saveWithRetry(doc(db,"lavishome","archivedQuotes"),{items:newArchived});
    setQuotes(newQuotes);setArchivedQuotes(newArchived);
    setSaved("Restored ✓");setTimeout(()=>setSaved(""),2000);
  }
  async function permDeleteQuote(id){
    const newArchived=archivedQuotes.filter(q=>q.id!==id);
    await saveWithRetry(doc(db,"lavishome","archivedQuotes"),{items:newArchived});
    setArchivedQuotes(newArchived);
    setSaved("Permanently deleted");setTimeout(()=>setSaved(""),2000);
  }

  function flash(){setSaved("Saved ✓");setTimeout(()=>setSaved(""),2000);}

  // ── Save a single product to its own Firestore document (with retry)
  async function handleSaveProduct(product){
    setProds(prev=>prev.find(x=>x.id===product.id)?prev.map(x=>x.id===product.id?product:x):[...prev,product]);
    const ok=await saveWithRetry(doc(db,"lavishome_products",product.id),product);
    if(ok)flash();else setSaved("Save failed — retrying…");
  }

  // ── Delete a single product document
  async function handleDeleteProduct(id){
    setProds(prev=>prev.filter(p=>p.id!==id));
    try{await deleteDoc(doc(db,"lavishome_products",id));flash();}
    catch{setSaved("Delete failed");}
  }

  // ── Adjust stock on a single product (with retry)
  async function handleAdjustStock(product,delta){
    const updated={...product,stock:Math.max(0,product.stock+delta)};
    setProds(prev=>prev.map(p=>p.id===updated.id?updated:p));
    await saveWithRetry(doc(db,"lavishome_products",updated.id),updated);
  }

  // ── Transactions — kept as single doc (no photos, no size concern)
  async function persistTxn(list){
    setTxns(list);
    const ok=await saveWithRetry(doc(db,"lavishome","transactions"),{items:list});
    if(ok)flash();else setSaved("Save failed");
  }
  function addOrUpdateTxn(t){const u=txns.find(x=>x.id===t.id)?txns.map(x=>x.id===t.id?t:x):[...txns,t];persistTxn(u);}
  function delTxn(id){persistTxn(txns.filter(t=>t.id!==id));}

  // ── Quotes — kept as single doc (photos already compressed in quote items)
  async function persistQuotes(list){
    setQuotes(list);
    const ok=await saveWithRetry(doc(db,"lavishome","quotes"),{items:list});
    if(ok)flash();else setSaved("Save failed");
  }
  function saveQuote(q){persistQuotes([q,...quotes]);}
  function updateQuoteStatus(id,status){persistQuotes(quotes.map(q=>q.id===id?{...q,status}:q));}
  function deleteQuote(id){persistQuotes(quotes.filter(q=>q.id!==id));}

  // ── Duplicate a quote — new ref, today date, status Pending
  function duplicateQuote(q){
    const newRef = makeRef();
    const today = todayStr();
    const newQuote = {
      ...q,
      id: gid(),
      ref: newRef,
      quoteDate: today,
      status: "Pending",
      createdAt: Date.now(),
      acceptedAt: null,
      acceptedTxnId: null,
      acceptedItems: null,
      archived: false,
      archivedAt: null,
      archivedBy: null,
    };
    persistQuotes([newQuote, ...quotes]);
    setSaved("Quote duplicated ✓");
    setTimeout(()=>setSaved(""),2000);
  }

  // ── Accept a quote: deduct stock + create finance entry
  async function handleAcceptQuote(quote, result){
    const{payType, items, finalTotal}=result;
    const today=new Date().toISOString().split("T")[0];
    const txnId=gid();

    // 1 — Deduct stock for each confirmed product (allow negative — Option B)
    for(const it of items){
      const prod=prods.find(p=>p.id===it.id);
      if(prod){
        const updated={...prod, stock: prod.stock - it.confirmedQty};
        await handleSaveProduct(updated);
      }
    }

    // 2 — Create finance entry tagged with quoteId so we can undo it later
    const newTxn={
      id: txnId,
      date: today,
      type: payType,
      party: quote.clientName,
      desc: `${quote.ref} — ${items.map(it=>it.name+" ×"+it.confirmedQty).join(", ")}`,
      amount: finalTotal,
      ref: quote.ref,
      notes: "Auto-generated from accepted quote",
      autoFromQuote: true,
      quoteId: quote.id,
      ts: Date.now(),
    };
    const newTxns=[...txns, newTxn];
    await persistTxn(newTxns);

    // 3 — Mark quote Accepted + store snapshot of confirmed items for undo
    const updatedQuotes=quotes.map(q=>q.id===quote.id?{
      ...q,
      status:"Accepted",
      acceptedAt: Date.now(),
      acceptedTxnId: txnId,
      acceptedItems: items.map(it=>({id:it.id, confirmedQty:it.confirmedQty, confirmedPrice:it.confirmedPrice})),
    }:q);
    await persistQuotes(updatedQuotes);
    setSaved("Accepted ✓ — stock & finance updated");
    setTimeout(()=>setSaved(""),3000);
  }

  // ── Undo acceptance: restore stock + remove finance entry + reset to Pending
  async function handleUndoAcceptance(quote){
    // 1 — Restore stock
    if(quote.acceptedItems){
      for(const it of quote.acceptedItems){
        const prod=prods.find(p=>p.id===it.id);
        if(prod){
          const restored={...prod, stock: prod.stock + it.confirmedQty};
          await handleSaveProduct(restored);
        }
      }
    }

    // 2 — Remove the auto-generated finance entry
    if(quote.acceptedTxnId){
      const newTxns=txns.filter(t=>t.id!==quote.acceptedTxnId);
      await persistTxn(newTxns);
    }

    // 3 — Reset quote to Pending, clear acceptance data
    const updatedQuotes=quotes.map(q=>q.id===quote.id?{
      ...q,
      status:"Pending",
      acceptedAt: null,
      acceptedTxnId: null,
      acceptedItems: null,
    }:q);
    await persistQuotes(updatedQuotes);
    setSaved("Undone ✓ — stock & finance restored");
    setTimeout(()=>setSaved(""),3000);
  }

  const cash=useMemo(()=>txns.reduce((s,t)=>{const m=TXN_TYPES[t.type];return s+(m?m.cash*t.amount:0);},0),[txns]);
  const pendingQuotes=quotes.filter(q=>q.status==="Pending").length;

  // ── Auth screens shown before anything else
  if(authState==="loading")return(
    <div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:G.bg,flexDirection:"column",gap:14}}>
      <div style={{color:G.goldL,fontFamily:"'Playfair Display',serif",fontSize:20}}>Lavishome</div>
      <div style={{color:G.muted,fontSize:13}}>Checking access…</div>
    </div>
  );
  if(authState==="loggedOut")return <LoginScreen onLogin={handleLogin} loading={loginLoading} error={loginError}/>;
  if(authState==="denied")return <AccessDeniedScreen user={currentUser} onSignOut={handleSignOut}/>;

  if(!loaded)return(
    <div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:G.bg,flexDirection:"column",gap:14}}>
      <div style={{color:G.goldL,fontFamily:"'Playfair Display',serif",fontSize:20}}>Connecting to Lavishome…</div>
      <div style={{color:G.muted,fontSize:13}}>Loading live data from Firebase</div>
    </div>
  );

  const TAB_LABELS={
    inventory: isMobile?"📦":"📦 Inventory",
    catalog:   isMobile?"🛋":"🛋 Catalog",
    quotes:    isMobile?`📋${pendingQuotes>0?` ${pendingQuotes}`:""}`:`📋 Quotes${pendingQuotes>0?` (${pendingQuotes})`:""}`,
    finance:   isMobile?"💳":"💳 Finance",
  };

  return(
    <div style={{minHeight:"100vh",background:G.bg,fontFamily:"'DM Sans',sans-serif",color:G.cream}}>
      <style>{GLOBAL_CSS}</style>

      {/* ── Name entry modal — first login only ── */}
      {needsName&&currentUser&&<SetNameModal user={currentUser} onSave={handleNameSaved}/>}

      {/* ── Header ── */}
      <div style={{background:G.surf,borderBottom:`1px solid ${G.bdr}`,boxShadow:"0 1px 6px rgba(0,0,0,0.07)",position:"sticky",top:0,zIndex:50}}>
        <div className="lh-hdr-inner" style={{maxWidth:1300,margin:"0 auto",padding:"0 16px",display:"flex",alignItems:"center",justifyContent:"space-between",height:58,flexWrap:"wrap",gap:0}}>
          <div className="lh-logo" style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:30,height:30,background:G.goldL,borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>🏠</div>
            <div>
              <div style={{fontSize:isMobile?13:15,fontWeight:700,fontFamily:"'Playfair Display',serif",color:G.goldL,letterSpacing:"0.05em"}}>Lavishome</div>
              {!isMobile&&<div style={{fontSize:8,color:G.muted,letterSpacing:"0.16em",textTransform:"uppercase"}}>Business Manager</div>}
            </div>
          </div>
          <div className="lh-hdr-tabs" style={{display:"flex",gap:2}}>
            {Object.entries(TAB_LABELS).map(([k,l])=>(
              <button key={k} onClick={()=>setTab(k)} style={{background:tab===k?G.goldL:"transparent",border:`1px solid ${tab===k?G.goldL:G.bdr}`,color:tab===k?"#fff":G.muted,borderRadius:7,padding:isMobile?"7px 10px":"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer",transition:"all 0.12s",whiteSpace:"nowrap",position:"relative"}}>
                {l}
                {k==="quotes"&&pendingQuotes>0&&tab!=="quotes"&&<span style={{position:"absolute",top:-3,right:-3,width:8,height:8,borderRadius:"50%",background:G.warn,border:"2px solid #fff"}}/>}
              </button>
            ))}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            {!isMobile&&<div style={{textAlign:"right"}}>
              <div style={{fontSize:8,color:G.muted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:2}}>💵 Cash</div>
              <div style={{fontSize:isMobile?12:14,fontWeight:700,color:cash>=0?G.ok:G.danger,fontFamily:"'Playfair Display',serif"}}>{fmt(cash)}</div>
            </div>}
            <div style={{display:"flex",alignItems:"center",gap:5,background:G.surf2,border:`1px solid ${G.bdr}`,borderRadius:999,padding:"4px 8px"}}>
              <div style={{width:6,height:6,borderRadius:"50%",background:G.ok}}></div>
              <span style={{fontSize:9,color:G.muted,fontWeight:600}}>Live</span>
            </div>
            {saved&&<span style={{fontSize:11,color:saved.includes("failed")||saved.includes("denied")?"#b83232":G.ok,fontWeight:600}}>{saved}</span>}
            {/* User avatar + sign out */}
            {currentUser&&!isMobile&&<div style={{display:"flex",alignItems:"center",gap:6,background:G.surf2,border:`1px solid ${G.bdr}`,borderRadius:999,padding:"4px 10px"}}>
              <span style={{fontSize:11,color:G.cream,fontWeight:700,maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {userProfile?.displayName||currentUser.displayName?.split(" ")[0]||currentUser.email?.split("@")[0]}
              </span>
              <button onClick={handleSignOut} style={{background:"none",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:999,padding:"2px 8px",fontSize:9,fontWeight:700,cursor:"pointer"}}>Sign out</button>
            </div>}
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{maxWidth:1300,margin:"0 auto",padding:isMobile?"16px 12px 100px":"28px 24px 100px"}}>
        {tab==="inventory"&&<InventoryTab prods={prods} onSaveProduct={handleSaveProduct} onDeleteProduct={handleDeleteProduct} onAdjustStock={handleAdjustStock}/>}
        {tab==="catalog"  &&<CatalogTab prods={prods} onSaveQuote={saveQuote} userProfile={userProfile}/>}
        {tab==="quotes"   &&<QuoteHistoryTab
          quotes={quotes} archivedQuotes={archivedQuotes}
          onUpdateStatus={updateQuoteStatus}
          onArchiveQuote={archiveQuote} onRestoreQuote={restoreQuote} onPermDeleteQuote={permDeleteQuote}
          onAcceptQuote={handleAcceptQuote} onUndoAcceptance={handleUndoAcceptance}
          onDuplicateQuote={duplicateQuote}
        />}
        {tab==="finance"  &&<FinanceTab
          txns={txns} archivedTxns={archivedTxns}
          onAddTxn={addOrUpdateTxn}
          onArchiveTxn={archiveTxn} onRestoreTxn={restoreTxn} onPermDeleteTxn={permDeleteTxn}
          currentUser={currentUser}
        />}
      </div>

      {/* ── Footer ── */}
      <div style={{textAlign:"center",padding:"12px 16px",color:G.muted,fontSize:10,borderTop:`1px solid ${G.bdr}`,letterSpacing:"0.1em",background:G.surf}}>
        🔴 LIVE — FIREBASE REAL-TIME — CHANGES APPEAR INSTANTLY ON ALL DEVICES
      </div>
    </div>
  );
}
