import { useState, useEffect, useRef, useMemo } from "react";
import { db } from "./firebase";
import { doc, onSnapshot, setDoc } from "firebase/firestore";

const G = {
  bg: "#0f0e0c", surf: "#1a1917", surf2: "#201f1d", bdr: "#2e2c2a",
  gold: "#c9a05a", goldL: "#e8c27a", cream: "#f0ead8",
  muted: "#6a6560", danger: "#c0392b", warn: "#e67e22", ok: "#27ae60", info: "#2980b9",
};

const CATS = ["Sofas","Beds","Chairs","Office Desks","Coffee Tables","Consoles","Wall Cabinets","Dining Tables","Wardrobes","Lighting","Textiles","Decor","Kitchen","Bathroom","Outdoor","Other"];
const ALL_CATS = ["All", ...CATS];

const TXN_TYPES = {
  "Sale – Cash":          { cash:  1, debtor:  0, creditor:  0, equity:  1, color: "#27ae60", icon: "💰", group: "Revenue"    },
  "Sale – Credit":        { cash:  0, debtor:  1, creditor:  0, equity:  1, color: "#2ecc71", icon: "📋", group: "Revenue"    },
  "Purchase – Cash":      { cash: -1, debtor:  0, creditor:  0, equity: -1, color: "#e74c3c", icon: "🛒", group: "Expense"    },
  "Purchase – Credit":    { cash:  0, debtor:  0, creditor:  1, equity: -1, color: "#c0392b", icon: "📦", group: "Expense"    },
  "Receive from Debtor":  { cash:  1, debtor: -1, creditor:  0, equity:  0, color: "#27ae60", icon: "✅", group: "Settlement" },
  "Pay Creditor":         { cash: -1, debtor:  0, creditor: -1, equity:  0, color: "#e67e22", icon: "🏦", group: "Settlement" },
  "Partner Contribution": { cash:  1, debtor:  0, creditor:  0, equity:  1, color: "#8e44ad", icon: "🤝", group: "Capital"    },
  "Return of Capital":    { cash: -1, debtor:  0, creditor:  0, equity: -1, color: "#9b59b6", icon: "↩️", group: "Capital"    },
  "Expense":              { cash: -1, debtor:  0, creditor:  0, equity: -1, color: "#e74c3c", icon: "🧾", group: "Expense"    },
  "Other Income":         { cash:  1, debtor:  0, creditor:  0, equity:  1, color: "#2980b9", icon: "💵", group: "Revenue"    },
};
const TXN_KEYS = Object.keys(TXN_TYPES);

function gid() { return "LH-" + Math.random().toString(36).substr(2, 6).toUpperCase(); }
function fmt(n) { return (n<0?"-":"")+new Intl.NumberFormat("en-CA",{style:"currency",currency:"CAD",minimumFractionDigits:2}).format(Math.abs(n)); }
function fmtDate(d) { return new Date(d+"T00:00:00").toLocaleDateString("en-CA",{year:"numeric",month:"short",day:"numeric"}); }
function calcMargin(price,cost) { if(!cost||cost<=0||!price||price<=0)return null; return((price-cost)/price*100).toFixed(1); }
function marginColor(m) { if(m===null)return G.muted; if(m>=40)return G.ok; if(m>=20)return G.warn; return G.danger; }

const SAMPLE_INV = [
  {id:gid(),code:"LH-A001",name:"Velvet Chesterfield Sofa",cat:"Sofas",price:2499,costPrice:1400,stock:4,minStock:3,desc:"3-seater in deep burgundy velvet",dims:{w:"220",h:"85",d:"95"},photo:null,ts:Date.now()},
  {id:gid(),code:"LH-B002",name:"Marble & Brass Coffee Table",cat:"Coffee Tables",price:1299,costPrice:680,stock:8,minStock:5,desc:"Italian Carrara marble top",dims:{w:"120",h:"45",d:"60"},photo:null,ts:Date.now()},
  {id:gid(),code:"LH-E005",name:"Executive Oak Desk",cat:"Office Desks",price:1890,costPrice:950,stock:5,minStock:3,desc:"Solid oak, cable management included",dims:{w:"160",h:"75",d:"80"},photo:null,ts:Date.now()},
  {id:gid(),code:"LH-F006",name:"King Platform Bed",cat:"Beds",price:3299,costPrice:1800,stock:2,minStock:2,desc:"Solid white oak, natural oil finish",dims:{w:"193",h:"120",d:"210"},photo:null,ts:Date.now()},
  {id:gid(),code:"LH-G007",name:"Floating Wall Cabinet",cat:"Wall Cabinets",price:849,costPrice:380,stock:9,minStock:4,desc:"Smoked oak with brass handles",dims:{w:"100",h:"60",d:"35"},photo:null,ts:Date.now()},
  {id:gid(),code:"LH-H008",name:"Marble Entry Console",cat:"Consoles",price:1450,costPrice:720,stock:3,minStock:2,desc:"Brushed brass legs, Arabescato top",dims:{w:"140",h:"80",d:"38"},photo:null,ts:Date.now()},
];
const SAMPLE_TXN = [
  {id:gid(),date:"2026-03-05",type:"Partner Contribution",party:"Rohit – Partner",desc:"Initial capital injection",amount:50000,ref:"CAP-001",notes:"",ts:Date.now()},
  {id:gid(),date:"2026-03-10",type:"Purchase – Cash",party:"Milano Imports",desc:"Initial inventory purchase",amount:28000,ref:"PO-001",notes:"Sofas & beds stock",ts:Date.now()},
  {id:gid(),date:"2026-03-18",type:"Sale – Cash",party:"Sarah Thompson",desc:"Velvet Chesterfield Sofa × 1",amount:2499,ref:"INV-001",notes:"",ts:Date.now()},
  {id:gid(),date:"2026-03-22",type:"Sale – Credit",party:"Meridian Design Studio",desc:"Office desks × 3 + consoles × 2",amount:8570,ref:"INV-002",notes:"Net 30 terms",ts:Date.now()},
  {id:gid(),date:"2026-03-28",type:"Expense",party:"Lavishome Operations",desc:"Showroom rent – March",amount:3200,ref:"EXP-001",notes:"",ts:Date.now()},
  {id:gid(),date:"2026-04-01",type:"Receive from Debtor",party:"Meridian Design Studio",desc:"Partial payment – INV-002",amount:5000,ref:"REC-001",notes:"Balance $3,570 outstanding",ts:Date.now()},
];

const lbl = {fontSize:10,fontWeight:700,letterSpacing:"0.1em",color:G.muted,textTransform:"uppercase",display:"block",marginBottom:5};
const inp = {background:G.bg,border:`1px solid ${G.bdr}`,borderRadius:8,color:G.cream,padding:"9px 14px",fontSize:13,outline:"none",fontFamily:"inherit",width:"100%"};

function ModalWrap({onClose,children,maxW=540}){
  return <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div onClick={e=>e.stopPropagation()} style={{background:G.surf,border:`1px solid ${G.bdr}`,borderRadius:16,width:"100%",maxWidth:maxW,maxHeight:"92vh",overflow:"auto",boxShadow:"0 24px 60px rgba(0,0,0,0.6)"}}>{children}</div>
  </div>;
}

function InvModal({initial,onSave,onClose}){
  const isEdit=!!initial;
  const [f,setF]=useState(initial||{code:"LH-"+Math.random().toString(36).substr(2,4).toUpperCase(),name:"",cat:"Sofas",price:"",costPrice:"",stock:"",minStock:10,desc:"",dims:{w:"",h:"",d:""},photo:null});
  const fRef=useRef();
  const set=k=>v=>setF(x=>({...x,[k]:v}));
  const setDim=k=>v=>setF(x=>({...x,dims:{...x.dims,[k]:v}}));
  function handlePhoto(e){const file=e.target.files[0];if(!file)return;if(file.size>600000){alert("Max 600KB");return;}const r=new FileReader();r.onload=ev=>setF(x=>({...x,photo:ev.target.result}));r.readAsDataURL(file);}
  function save(){if(!f.name.trim()||!f.code.trim())return alert("Name and code required.");onSave({...f,price:parseFloat(f.price)||0,costPrice:parseFloat(f.costPrice)||0,stock:parseInt(f.stock)||0,minStock:parseInt(f.minStock)||5,id:initial?.id||gid(),ts:initial?.ts||Date.now()});}
  const p=parseFloat(f.price)||0,c=parseFloat(f.costPrice)||0;
  const mg=p>0&&c>0?((p-c)/p*100).toFixed(1):null;
  const profitUnit=p>0&&c>0?p-c:null;
  const markupPct=p>0&&c>0?((p-c)/c*100).toFixed(1):null;
  return <ModalWrap onClose={onClose} maxW={560}><div style={{padding:"22px 24px"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
      <h2 style={{color:G.gold,fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:600}}>{isEdit?"Edit Product":"Add Product"}</h2>
      <button onClick={onClose} style={{background:"none",border:"none",color:G.muted,fontSize:22,cursor:"pointer"}}>×</button>
    </div>
    <div style={{marginBottom:14}}>
      <label style={lbl}>Photo</label>
      <div onClick={()=>fRef.current.click()} style={{border:`2px dashed ${G.bdr}`,borderRadius:8,height:90,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",background:G.bg}}>
        {f.photo?<img src={f.photo} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="product"/>:<div style={{textAlign:"center",color:G.muted}}><div style={{fontSize:20,marginBottom:2}}>📷</div><div style={{fontSize:10}}>Upload (max 600KB)</div></div>}
      </div>
      <input ref={fRef} type="file" accept="image/*" onChange={handlePhoto} style={{display:"none"}}/>
      {f.photo&&<button onClick={()=>setF(x=>({...x,photo:null}))} style={{marginTop:5,background:"transparent",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:5,padding:"3px 8px",fontSize:10,cursor:"pointer"}}>Remove</button>}
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
      <div><label style={lbl}>Product Code</label><input style={inp} value={f.code} onChange={e=>set("code")(e.target.value)}/></div>
      <div><label style={lbl}>Category</label><select style={{...inp,cursor:"pointer"}} value={f.cat} onChange={e=>set("cat")(e.target.value)}>{CATS.map(c=><option key={c} value={c}>{c}</option>)}</select></div>
    </div>
    <div style={{marginBottom:10}}><label style={lbl}>Product Name</label><input style={inp} value={f.name} onChange={e=>set("name")(e.target.value)} placeholder="e.g. Velvet Chesterfield Sofa"/></div>
    <div style={{background:G.bg,border:`1px solid ${G.bdr}`,borderRadius:10,padding:"14px 16px",marginBottom:10}}>
      <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",color:G.gold,textTransform:"uppercase",marginBottom:12}}>💰 Pricing</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:mg!==null?12:0}}>
        <div><label style={lbl}>Selling Price (CAD)</label><input style={inp} type="number" value={f.price} onChange={e=>set("price")(e.target.value)} placeholder="e.g. 2499" min="0"/></div>
        <div><label style={{...lbl,color:"#5a9a6a"}}>Cost / Purchase Price (CAD)</label><input style={{...inp,borderColor:"#2e4a36"}} type="number" value={f.costPrice} onChange={e=>set("costPrice")(e.target.value)} placeholder="e.g. 1400" min="0"/></div>
      </div>
      {mg!==null&&<div style={{display:"flex",gap:10}}>
        {[{label:"Profit / Unit",val:fmt(profitUnit),color:profitUnit>=0?G.ok:G.danger},{label:"Margin %",val:mg+"%",color:marginColor(parseFloat(mg))},{label:"Markup %",val:markupPct+"%",color:G.goldL}].map(s=><div key={s.label} style={{flex:1,background:G.surf,borderRadius:8,padding:"8px 12px",textAlign:"center"}}><div style={{fontSize:9,color:G.muted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:3}}>{s.label}</div><div style={{fontSize:14,fontWeight:700,color:s.color}}>{s.val}</div></div>)}
      </div>}
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
      <div><label style={lbl}>Current Stock</label><input style={inp} type="number" value={f.stock} onChange={e=>set("stock")(e.target.value)} min="0"/></div>
      <div><label style={lbl}>Low Stock Alert At</label><input style={inp} type="number" value={f.minStock} onChange={e=>set("minStock")(e.target.value)} min="1"/></div>
    </div>
    <div style={{background:G.bg,border:`1px solid ${G.bdr}`,borderRadius:10,padding:"14px 16px",marginBottom:10}}>
      <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",color:G.gold,textTransform:"uppercase",marginBottom:12}}>↔ Dimensions (cm) — optional</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
        {[["w","Width"],["h","Height"],["d","Depth"]].map(([k,l])=><div key={k}><label style={lbl}>{l}</label><input style={inp} type="number" value={f.dims?.[k]||""} onChange={e=>setDim(k)(e.target.value)} placeholder="cm" min="0"/></div>)}
      </div>
    </div>
    <div style={{marginBottom:18}}><label style={lbl}>Description</label><input style={inp} value={f.desc} onChange={e=>set("desc")(e.target.value)} placeholder="Short description…"/></div>
    <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
      <button onClick={onClose} style={{background:"transparent",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:7,padding:"8px 14px",fontSize:12,fontWeight:600,cursor:"pointer"}}>Cancel</button>
      <button onClick={save} style={{background:G.gold,border:"none",color:"#0f0e0c",borderRadius:7,padding:"8px 18px",fontSize:12,fontWeight:700,cursor:"pointer"}}>{isEdit?"Save Changes":"Add Product"}</button>
    </div>
  </div></ModalWrap>;
}

function InventoryTab({prods,persist}){
  const [search,setSearch]=useState("");
  const [cat,setCat]=useState("All");
  const [stockF,setStockF]=useState("All");
  const [modal,setModal]=useState(null);
  const [editP,setEditP]=useState(null);
  const [delId,setDelId]=useState(null);
  const [vw,setVw]=useState("grid");
  function saveProduct(p){const u=prods.find(x=>x.id===p.id)?prods.map(x=>x.id===p.id?p:x):[...prods,p];persist(u);setModal(null);setEditP(null);}
  function del(){persist(prods.filter(p=>p.id!==delId));setModal(null);setDelId(null);}
  function adj(id,d){persist(prods.map(p=>p.id===id?{...p,stock:Math.max(0,p.stock+d)}:p));}
  const filtered=useMemo(()=>prods.filter(p=>{const ms=(p.name+p.code).toLowerCase().includes(search.toLowerCase());const mc=cat==="All"||p.cat===cat;const mst=stockF==="All"||(stockF==="Low"&&p.stock<=p.minStock&&p.stock>0)||(stockF==="Out"&&p.stock===0)||(stockF==="OK"&&p.stock>p.minStock);return ms&&mc&&mst;}),[prods,search,cat,stockF]);
  const totalSellVal=prods.reduce((s,p)=>s+p.price*p.stock,0);
  const totalPotProfit=prods.reduce((s,p)=>s+(p.price-(p.costPrice||0))*p.stock,0);
  const lowN=prods.filter(p=>p.stock<=p.minStock&&p.stock>0).length;
  const outN=prods.filter(p=>p.stock===0).length;
  function exportCSV(){const h=["Code","Name","Category","Selling Price","Cost Price","Margin %","Profit/Unit","Stock","Min Stock","Status","W","H","D","Description"];const rows=filtered.map(p=>{const mg=calcMargin(p.price,p.costPrice);return[p.code,p.name,p.cat,p.price.toFixed(2),(p.costPrice||0).toFixed(2),mg!==null?mg+"%":"",mg!==null?(p.price-p.costPrice).toFixed(2):"",p.stock,p.minStock,p.stock===0?"Out":p.stock<=p.minStock?"Low":"OK",p.dims?.w||"",p.dims?.h||"",p.dims?.d||"",p.desc||""];});const csv=[h,...rows].map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download="lavishome_inventory.csv";a.click();}
  return <div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
      {[{l:"Products",v:prods.length,icon:"📦",a:false,s:false},{l:"Sell Value",v:"$"+totalSellVal.toLocaleString("en-CA",{minimumFractionDigits:0}),icon:"💰",a:false,s:false},{l:"Potential Profit",v:"$"+totalPotProfit.toLocaleString("en-CA",{minimumFractionDigits:0}),icon:"📈",a:false,s:true},{l:"Low / Out",v:`${lowN} / ${outN}`,icon:"⚠️",a:lowN>0||outN>0,s:false}].map(s=><div key={s.l} style={{background:G.surf,border:`1px solid ${s.a?G.warn+"55":s.s?G.ok+"33":G.bdr}`,borderRadius:10,padding:"14px 16px"}}><div style={{fontSize:18,marginBottom:3}}>{s.icon}</div><div style={{fontSize:16,fontWeight:700,color:s.a?G.warn:s.s?G.ok:G.goldL,fontFamily:"'Playfair Display',serif"}}>{s.v}</div><div style={{fontSize:9,color:G.muted,textTransform:"uppercase",letterSpacing:"0.1em"}}>{s.l}</div></div>)}
    </div>
    <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
      <div style={{flex:1,minWidth:160,position:"relative"}}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name or code…" style={{...inp,paddingLeft:32}}/><span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:G.muted,fontSize:13,pointerEvents:"none"}}>🔍</span></div>
      <select value={cat} onChange={e=>setCat(e.target.value)} style={{...inp,width:"auto",minWidth:140,cursor:"pointer"}}>{ALL_CATS.map(c=><option key={c} value={c}>{c}</option>)}</select>
      <select value={stockF} onChange={e=>setStockF(e.target.value)} style={{...inp,width:"auto",minWidth:110,cursor:"pointer"}}>{["All","OK","Low","Out"].map(s=><option key={s} value={s}>{{All:"All Stock",OK:"In Stock",Low:"Low",Out:"Out"}[s]}</option>)}</select>
      <div style={{display:"flex",gap:4}}>{["grid","table"].map(v=><button key={v} onClick={()=>setVw(v)} style={{background:vw===v?G.gold:G.surf,border:`1px solid ${G.bdr}`,color:vw===v?"#0f0e0c":G.muted,borderRadius:6,padding:"7px 11px",fontSize:11,fontWeight:600,cursor:"pointer"}}>{{grid:"⊞",table:"☰"}[v]}</button>)}</div>
      <button onClick={exportCSV} style={{background:"transparent",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:7,padding:"6px 12px",fontSize:12,fontWeight:600,cursor:"pointer"}}>⬇ CSV</button>
      <button onClick={()=>{setEditP(null);setModal("add");}} style={{background:G.gold,border:"none",color:"#0f0e0c",borderRadius:7,padding:"6px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>+ Add</button>
    </div>
    <div style={{display:"flex",gap:5,marginBottom:14,flexWrap:"wrap"}}>{ALL_CATS.map(c=><button key={c} onClick={()=>setCat(c)} style={{background:cat===c?G.gold:G.surf,border:`1px solid ${cat===c?G.gold:G.bdr}`,color:cat===c?"#0f0e0c":G.muted,borderRadius:999,padding:"3px 10px",fontSize:10,fontWeight:600,cursor:"pointer"}}>{c}</button>)}</div>
    <div style={{fontSize:11,color:G.muted,marginBottom:12}}><span style={{color:G.cream,fontWeight:600}}>{filtered.length}</span> of {prods.length} products</div>
    {vw==="grid"&&(filtered.length===0?<div style={{textAlign:"center",padding:50,color:G.muted}}><div style={{fontSize:32,marginBottom:8}}>📦</div><div>No products</div></div>:
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:16}}>
      {filtered.map(p=>{const isLow=p.stock<=p.minStock&&p.stock>0,isOut=p.stock===0,d=p.dims,hd=d&&(d.w||d.h||d.d),mg=calcMargin(p.price,p.costPrice),profitU=p.price&&p.costPrice?p.price-p.costPrice:null;
      return <div key={p.id} style={{background:G.surf,border:`1px solid ${isOut?G.danger+"55":isLow?G.warn+"44":G.bdr}`,borderRadius:13,overflow:"hidden",transition:"transform 0.14s,box-shadow 0.14s"}} onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 8px 24px rgba(0,0,0,0.4)"}} onMouseLeave={e=>{e.currentTarget.style.transform="none";e.currentTarget.style.boxShadow="none"}}>
        <div style={{height:140,background:G.bg,overflow:"hidden",position:"relative"}}>
          {p.photo?<img src={p.photo} style={{width:"100%",height:"100%",objectFit:"cover"}} alt={p.name}/>:<div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",color:G.bdr,fontSize:32}}>🏠</div>}
          <div style={{position:"absolute",top:7,right:7,background:G.bg+"dd",borderRadius:5,padding:"1px 6px",fontSize:9,color:G.gold,fontWeight:700,fontFamily:"monospace"}}>{p.code}</div>
          {(isLow||isOut)&&<div style={{position:"absolute",top:7,left:7,background:isOut?G.danger:G.warn,borderRadius:5,padding:"2px 6px",fontSize:8,color:"#fff",fontWeight:700}}>{isOut?"OUT":"LOW"}</div>}
          {mg!==null&&<div style={{position:"absolute",bottom:7,right:7,background:G.bg+"ee",borderRadius:5,padding:"2px 7px",fontSize:10,color:marginColor(parseFloat(mg)),fontWeight:700}}>{mg}% margin</div>}
        </div>
        <div style={{padding:13}}>
          <div style={{fontSize:8,color:G.gold,fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:2}}>{p.cat}</div>
          <div style={{fontSize:13,fontWeight:600,color:G.cream,fontFamily:"'Playfair Display',serif",lineHeight:1.3,marginBottom:4}}>{p.name}</div>
          {p.desc&&<div style={{fontSize:10,color:G.muted,marginBottom:8,lineHeight:1.4}}>{p.desc}</div>}
          {hd&&<div style={{display:"inline-flex",alignItems:"center",gap:4,background:G.bg,border:`1px solid ${G.bdr}`,borderRadius:5,padding:"2px 7px",marginBottom:8}}><span style={{fontSize:8,color:G.muted,textTransform:"uppercase",letterSpacing:"0.1em",fontWeight:700}}>W×H×D</span><span style={{fontSize:10,color:G.goldL,fontFamily:"monospace",fontWeight:600}}>{d.w||"–"}×{d.h||"–"}×{d.d||"–"}cm</span></div>}
          <div style={{background:G.bg,borderRadius:8,padding:"8px 10px",marginBottom:8}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:p.costPrice>0?5:0}}>
              <div><div style={{fontSize:9,color:G.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:1}}>Selling Price</div><div style={{fontSize:15,fontWeight:700,color:G.goldL}}>${p.price.toLocaleString("en-CA",{minimumFractionDigits:2})}</div></div>
              <span style={{padding:"1px 7px",borderRadius:999,fontSize:8,fontWeight:700,textTransform:"uppercase",background:(isOut?G.danger:isLow?G.warn:G.ok)+"22",color:isOut?"#e74c3c":isLow?G.warn:G.ok}}>{isOut?"OUT":isLow?"LOW":p.stock+" in stock"}</span>
            </div>
            {p.costPrice>0&&<div style={{display:"flex",gap:8}}>
              <div style={{flex:1}}><div style={{fontSize:9,color:G.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:1}}>Cost Price</div><div style={{fontSize:12,fontWeight:600,color:"#5a9a6a"}}>${p.costPrice.toLocaleString("en-CA",{minimumFractionDigits:2})}</div></div>
              {profitU!==null&&<div style={{flex:1}}><div style={{fontSize:9,color:G.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:1}}>Profit/Unit</div><div style={{fontSize:12,fontWeight:600,color:profitU>=0?G.ok:G.danger}}>{fmt(profitU)}</div></div>}
            </div>}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8,background:G.bg,borderRadius:7,padding:"5px 8px"}}>
            <button onClick={()=>adj(p.id,-1)} style={{background:G.bdr,border:"none",color:G.cream,borderRadius:4,width:22,height:22,fontSize:13,fontWeight:700,cursor:"pointer"}}>−</button>
            <span style={{flex:1,textAlign:"center",fontSize:10,color:G.muted}}>{p.stock} units</span>
            <button onClick={()=>adj(p.id,1)} style={{background:G.bdr,border:"none",color:G.cream,borderRadius:4,width:22,height:22,fontSize:13,fontWeight:700,cursor:"pointer"}}>+</button>
          </div>
          <div style={{display:"flex",gap:6}}>
            <button onClick={()=>{setEditP(p);setModal("edit");}} style={{flex:1,background:"transparent",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:6,padding:"5px",fontSize:10,fontWeight:600,cursor:"pointer"}}>Edit</button>
            <button onClick={()=>{setDelId(p.id);setModal("del");}} style={{flex:1,background:G.danger+"22",border:`1px solid ${G.danger}44`,color:"#e74c3c",borderRadius:6,padding:"5px",fontSize:10,fontWeight:600,cursor:"pointer"}}>Delete</button>
          </div>
        </div>
      </div>;})}
    </div>)}
    {vw==="table"&&<div style={{background:G.surf,border:`1px solid ${G.bdr}`,borderRadius:12,overflow:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:980}}><thead><tr style={{borderBottom:`1px solid ${G.bdr}`}}>{["","Code","Name","Category","Dims","Sell Price","Cost Price","Profit/Unit","Margin %","Stock","Status",""].map((h,i)=><th key={i} style={{padding:"9px 12px",textAlign:"left",color:G.muted,fontSize:9,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead><tbody>{filtered.map(p=>{const isLow=p.stock<=p.minStock&&p.stock>0,isOut=p.stock===0,d=p.dims,mg=calcMargin(p.price,p.costPrice),profitU=p.price&&p.costPrice?p.price-p.costPrice:null;return <tr key={p.id} style={{borderBottom:`1px solid ${G.bdr}22`}}><td style={{padding:"7px 12px"}}><div style={{width:32,height:32,borderRadius:5,overflow:"hidden",background:G.bdr}}>{p.photo?<img src={p.photo} style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12}}>🏠</div>}</div></td><td style={{padding:"7px 12px",color:G.gold,fontFamily:"monospace",fontWeight:600,fontSize:10,whiteSpace:"nowrap"}}>{p.code}</td><td style={{padding:"7px 12px",color:G.cream,fontWeight:500,minWidth:140}}>{p.name}</td><td style={{padding:"7px 12px",color:G.muted,whiteSpace:"nowrap"}}>{p.cat}</td><td style={{padding:"7px 12px",color:G.muted,fontFamily:"monospace",fontSize:10,whiteSpace:"nowrap"}}>{d&&(d.w||d.h||d.d)?`${d.w||"–"}×${d.h||"–"}×${d.d||"–"}`:"—"}</td><td style={{padding:"7px 12px",color:G.goldL,fontWeight:600,whiteSpace:"nowrap"}}>${p.price.toLocaleString("en-CA",{minimumFractionDigits:2})}</td><td style={{padding:"7px 12px",color:"#5a9a6a",fontWeight:600,whiteSpace:"nowrap"}}>{p.costPrice>0?"$"+p.costPrice.toLocaleString("en-CA",{minimumFractionDigits:2}):"—"}</td><td style={{padding:"7px 12px",fontWeight:600,whiteSpace:"nowrap",color:profitU!==null?(profitU>=0?G.ok:G.danger):G.muted}}>{profitU!==null?fmt(profitU):"—"}</td><td style={{padding:"7px 12px",fontWeight:700,whiteSpace:"nowrap",color:mg!==null?marginColor(parseFloat(mg)):G.muted}}>{mg!==null?mg+"%":"—"}</td><td style={{padding:"7px 12px"}}><div style={{display:"flex",alignItems:"center",gap:5}}><button onClick={()=>adj(p.id,-1)} style={{background:G.bdr,border:"none",color:G.cream,borderRadius:3,width:20,height:20,fontSize:12,cursor:"pointer"}}>−</button><span style={{color:G.cream,fontWeight:700,minWidth:20,textAlign:"center"}}>{p.stock}</span><button onClick={()=>adj(p.id,1)} style={{background:G.bdr,border:"none",color:G.cream,borderRadius:3,width:20,height:20,fontSize:12,cursor:"pointer"}}>+</button></div></td><td style={{padding:"7px 12px"}}><span style={{padding:"2px 7px",borderRadius:999,fontSize:8,fontWeight:700,textTransform:"uppercase",background:(isOut?G.danger:isLow?G.warn:G.ok)+"22",color:isOut?"#e74c3c":isLow?G.warn:G.ok,whiteSpace:"nowrap"}}>{isOut?"OUT":isLow?`LOW·${p.stock}`:`OK·${p.stock}`}</span></td><td style={{padding:"7px 12px"}}><div style={{display:"flex",gap:5}}><button onClick={()=>{setEditP(p);setModal("edit");}} style={{background:"transparent",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:4,padding:"2px 8px",fontSize:10,fontWeight:600,cursor:"pointer"}}>Edit</button><button onClick={()=>{setDelId(p.id);setModal("del");}} style={{background:G.danger+"22",border:`1px solid ${G.danger}44`,color:"#e74c3c",borderRadius:4,padding:"2px 8px",fontSize:10,fontWeight:600,cursor:"pointer"}}>Del</button></div></td></tr>;})}</tbody></table></div>}
    {(modal==="add"||modal==="edit")&&<InvModal key={editP?.id||"new"} initial={editP} onSave={saveProduct} onClose={()=>{setModal(null);setEditP(null);}}/>}
    {modal==="del"&&<ModalWrap onClose={()=>{setModal(null);setDelId(null);}} maxW={340}><div style={{padding:28,textAlign:"center"}}><div style={{fontSize:32,marginBottom:10}}>🗑️</div><h3 style={{color:G.cream,fontFamily:"'Playfair Display',serif",marginBottom:8}}>Delete Product?</h3><p style={{color:G.muted,fontSize:13,marginBottom:20}}>This cannot be undone.</p><div style={{display:"flex",gap:10,justifyContent:"center"}}><button onClick={()=>{setModal(null);setDelId(null);}} style={{background:"transparent",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:7,padding:"8px 16px",fontSize:12,fontWeight:600,cursor:"pointer"}}>Cancel</button><button onClick={del} style={{background:G.danger,border:"none",color:"#fff",borderRadius:7,padding:"8px 16px",fontSize:12,fontWeight:700,cursor:"pointer"}}>Delete</button></div></div></ModalWrap>}
  </div>;
}

function TxnModal({initial,onSave,onClose}){
  const today=new Date().toISOString().split("T")[0];
  const [f,setF]=useState(initial||{type:"Sale – Cash",date:today,party:"",desc:"",amount:"",ref:"",notes:""});
  const set=k=>v=>setF(x=>({...x,[k]:v}));
  const meta=TXN_TYPES[f.type]||{};
  function save(){if(!f.type||!f.date||!f.party||!f.desc||!f.amount)return alert("Please fill all required fields.");const amt=parseFloat(f.amount);if(isNaN(amt)||amt<=0)return alert("Enter a valid positive amount.");onSave({...f,amount:amt,id:initial?.id||gid(),ts:initial?.ts||Date.now()});}
  const effRow=(label,val)=>{if(val===0)return null;return <div style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:`1px solid ${G.bdr}22`}}><span style={{fontSize:12,color:G.muted}}>{label}</span><span style={{fontSize:12,fontWeight:700,color:val>0?G.ok:G.danger}}>{val>0?"+ Amount":"− Amount"}</span></div>;};
  const grouped=TXN_KEYS.reduce((acc,k)=>{const g=TXN_TYPES[k].group;if(!acc[g])acc[g]=[];acc[g].push(k);return acc;},{});
  return <ModalWrap onClose={onClose} maxW={520}><div style={{padding:"22px 24px"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
      <h2 style={{color:G.gold,fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:600}}>{initial?"Edit Transaction":"Record Transaction"}</h2>
      <button onClick={onClose} style={{background:"none",border:"none",color:G.muted,fontSize:22,cursor:"pointer"}}>×</button>
    </div>
    <div style={{marginBottom:14}}><label style={lbl}>Transaction Type *</label><select style={{...inp,cursor:"pointer"}} value={f.type} onChange={e=>set("type")(e.target.value)}>{Object.entries(grouped).map(([grp,items])=><optgroup key={grp} label={grp}>{items.map(k=><option key={k} value={k}>{TXN_TYPES[k].icon} {k}</option>)}</optgroup>)}</select></div>
    <div style={{background:G.bg,border:`1px solid ${G.bdr}`,borderRadius:10,padding:"10px 14px",marginBottom:14}}><div style={{fontSize:10,color:G.gold,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>ℹ Accounting Effects</div>{effRow("Cash Balance",meta.cash||0)}{effRow("Debtors (A/R)",meta.debtor||0)}{effRow("Creditors (A/P)",meta.creditor||0)}{effRow("Equity / Capital",meta.equity||0)}</div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}><div><label style={lbl}>Date *</label><input style={inp} type="date" value={f.date} onChange={e=>set("date")(e.target.value)}/></div><div><label style={lbl}>Reference No.</label><input style={inp} value={f.ref} onChange={e=>set("ref")(e.target.value)} placeholder="e.g. INV-001"/></div></div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}><div><label style={lbl}>Party / Name *</label><input style={inp} value={f.party} onChange={e=>set("party")(e.target.value)} placeholder="Customer, Supplier…"/></div><div><label style={lbl}>Amount (CAD) *</label><input style={inp} type="number" value={f.amount} onChange={e=>set("amount")(e.target.value)} placeholder="0.00" min="0"/></div></div>
    <div style={{marginBottom:12}}><label style={lbl}>Description *</label><input style={inp} value={f.desc} onChange={e=>set("desc")(e.target.value)} placeholder="What is this for?"/></div>
    <div style={{marginBottom:20}}><label style={lbl}>Notes (optional)</label><textarea style={{...inp,resize:"vertical"}} rows={2} value={f.notes} onChange={e=>set("notes")(e.target.value)} placeholder="Additional details…"/></div>
    <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><button onClick={onClose} style={{background:"transparent",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:7,padding:"8px 16px",fontSize:12,fontWeight:600,cursor:"pointer"}}>Cancel</button><button onClick={save} style={{background:G.gold,border:"none",color:"#0f0e0c",borderRadius:7,padding:"8px 20px",fontSize:12,fontWeight:700,cursor:"pointer"}}>{initial?"Save Changes":"Record"}</button></div>
  </div></ModalWrap>;
}

function FinanceTab({txns,onAddTxn,onDelTxn}){
  const [search,setSearch]=useState("");
  const [typeF,setTypeF]=useState("All");
  const [modal,setModal]=useState(null);
  const [editT,setEditT]=useState(null);
  const [delId,setDelId]=useState(null);
  const [view,setView]=useState("ledger");
  const balances=useMemo(()=>{let cash=0,debtor=0,creditor=0,equity=0,revenue=0,expenses=0;txns.forEach(t=>{const m=TXN_TYPES[t.type];if(!m)return;cash+=m.cash*t.amount;debtor+=m.debtor*t.amount;creditor+=m.creditor*t.amount;equity+=m.equity*t.amount;if(m.group==="Revenue")revenue+=t.amount;if(m.group==="Expense")expenses+=t.amount;});return{cash,debtor,creditor,equity,revenue,expenses,profit:revenue-expenses};},[txns]);
  const filtered=useMemo(()=>[...txns].sort((a,b)=>new Date(b.date)-new Date(a.date)).filter(t=>{const ms=(t.desc+t.party+(t.ref||"")).toLowerCase().includes(search.toLowerCase());const mt=typeF==="All"||t.type===typeF;return ms&&mt;}),[txns,search,typeF]);
  function exportCSV(){const h=["Date","Type","Party","Description","Amount","Cash Δ","Debtor Δ","Creditor Δ","Equity Δ","Reference","Notes"];const rows=filtered.map(t=>{const m=TXN_TYPES[t.type]||{};return[t.date,t.type,t.party,t.desc,t.amount.toFixed(2),(m.cash||0)*t.amount,(m.debtor||0)*t.amount,(m.creditor||0)*t.amount,(m.equity||0)*t.amount,t.ref||"",t.notes||""];});const csv=[h,...rows].map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download="lavishome_transactions.csv";a.click();}
  const sCard=(label,val,color,sub)=><div style={{background:G.surf,border:`1px solid ${G.bdr}`,borderRadius:12,padding:"16px 18px"}}><div style={{fontSize:10,color:G.muted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6}}>{label}</div><div style={{fontSize:20,fontWeight:700,color:color||G.goldL,fontFamily:"'Playfair Display',serif"}}>{fmt(val)}</div>{sub&&<div style={{fontSize:11,color:G.muted,marginTop:4}}>{sub}</div>}</div>;
  const effCell=v=><td style={{padding:"8px 12px",fontFamily:"monospace",fontSize:11,color:v>0?G.ok:v<0?G.danger:G.muted,fontWeight:v!==0?700:400,whiteSpace:"nowrap"}}>{v!==0?(v>0?"+":"")+fmt(v):"—"}</td>;
  return <div>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
      <div style={{display:"flex",gap:4}}>{[["ledger","📒 Ledger"],["summary","📊 Summary"]].map(([v,l])=><button key={v} onClick={()=>setView(v)} style={{background:view===v?G.gold:G.surf,border:`1px solid ${G.bdr}`,color:view===v?"#0f0e0c":G.muted,borderRadius:7,padding:"7px 14px",fontSize:11,fontWeight:600,cursor:"pointer"}}>{l}</button>)}</div>
      <div style={{display:"flex",gap:8}}><button onClick={exportCSV} style={{background:"transparent",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:7,padding:"6px 12px",fontSize:12,fontWeight:600,cursor:"pointer"}}>⬇ Export</button><button onClick={()=>{setEditT(null);setModal("add");}} style={{background:G.gold,border:"none",color:"#0f0e0c",borderRadius:7,padding:"6px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>+ Record Transaction</button></div>
    </div>
    {view==="summary"&&<div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:14,marginBottom:20}}>{sCard("💵 Cash Balance",balances.cash,balances.cash>=0?G.ok:G.danger,"Available funds")}{sCard("📋 Debtors (A/R)",balances.debtor,G.info,"Owed to Lavishome")}{sCard("🏦 Creditors (A/P)",balances.creditor,G.warn,"Lavishome owes")}{sCard("🤝 Net Equity / Capital",balances.equity,G.gold,"Partners' stake")}</div>
      <div style={{background:G.surf,border:`1px solid ${G.bdr}`,borderRadius:12,padding:"18px 20px",marginBottom:20}}><div style={{fontSize:11,color:G.gold,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:14}}>📈 Income Summary</div>{[{label:"Total Revenue",val:balances.revenue,color:G.ok},{label:"Total Expenses",val:balances.expenses,color:G.danger},{label:"Net Profit / Loss",val:balances.profit,color:balances.profit>=0?G.ok:G.danger,bold:true}].map(r=><div key={r.label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:`1px solid ${G.bdr}33`}}><span style={{fontSize:13,color:G.muted,fontWeight:r.bold?700:400}}>{r.label}</span><span style={{fontSize:r.bold?18:14,fontWeight:700,color:r.color,fontFamily:r.bold?"'Playfair Display',serif":"inherit"}}>{fmt(r.val)}</span></div>)}</div>
      <div style={{background:G.surf,border:`1px solid ${G.bdr}`,borderRadius:12,padding:"18px 20px"}}><div style={{fontSize:11,color:G.gold,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:14}}>Breakdown by Type</div>{TXN_KEYS.map(k=>{const items=txns.filter(t=>t.type===k);if(!items.length)return null;const total=items.reduce((s,t)=>s+t.amount,0),m=TXN_TYPES[k];return <div key={k} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${G.bdr}22`}}><div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:14}}>{m.icon}</span><span style={{fontSize:12,color:G.cream}}>{k}</span><span style={{fontSize:10,color:G.muted}}>{items.length} txn{items.length>1?"s":""}</span></div><span style={{fontSize:13,fontWeight:700,color:m.color}}>{fmt(total)}</span></div>;})}</div>
    </div>}
    {view==="ledger"&&<div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:18}}>{[["💵 Cash",balances.cash,balances.cash>=0?G.ok:G.danger],["📋 Debtors",balances.debtor,G.info],["🏦 Creditors",balances.creditor,G.warn],["🤝 Equity",balances.equity,G.gold]].map(([l,v,c])=><div key={l} style={{background:G.surf,border:`1px solid ${G.bdr}`,borderRadius:10,padding:"12px 14px"}}><div style={{fontSize:10,color:G.muted,marginBottom:4}}>{l}</div><div style={{fontSize:15,fontWeight:700,color:c,fontFamily:"'Playfair Display',serif"}}>{fmt(v)}</div></div>)}</div>
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}><div style={{flex:1,minWidth:160,position:"relative"}}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search transactions…" style={{...inp,paddingLeft:32}}/><span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:G.muted,fontSize:13,pointerEvents:"none"}}>🔍</span></div><select value={typeF} onChange={e=>setTypeF(e.target.value)} style={{...inp,width:"auto",minWidth:180,cursor:"pointer"}}><option value="All">All Types</option>{TXN_KEYS.map(k=><option key={k} value={k}>{TXN_TYPES[k].icon} {k}</option>)}</select></div>
      <div style={{fontSize:11,color:G.muted,marginBottom:12}}><span style={{color:G.cream,fontWeight:600}}>{filtered.length}</span> transactions</div>
      {filtered.length===0?<div style={{textAlign:"center",padding:50,color:G.muted}}><div style={{fontSize:32,marginBottom:8}}>📒</div><div>No transactions yet</div></div>:
      <div style={{background:G.surf,border:`1px solid ${G.bdr}`,borderRadius:12,overflow:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:900}}><thead><tr style={{borderBottom:`1px solid ${G.bdr}`}}>{["Date","Type","Party","Description","Amount","Cash Δ","Debtor Δ","Creditor Δ","Equity Δ","Ref",""].map((h,i)=><th key={i} style={{padding:"10px 12px",textAlign:"left",color:G.muted,fontSize:9,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead><tbody>{filtered.map(t=>{const m=TXN_TYPES[t.type]||{cash:0,debtor:0,creditor:0,equity:0};return <tr key={t.id} style={{borderBottom:`1px solid ${G.bdr}22`}}><td style={{padding:"8px 12px",color:G.muted,fontSize:11,whiteSpace:"nowrap"}}>{fmtDate(t.date)}</td><td style={{padding:"8px 12px",whiteSpace:"nowrap"}}><span style={{display:"inline-flex",alignItems:"center",gap:5,padding:"2px 8px",borderRadius:6,background:(m.color||G.gold)+"22",color:m.color||G.gold,fontSize:10,fontWeight:700}}>{TXN_TYPES[t.type]?.icon} {t.type}</span></td><td style={{padding:"8px 12px",color:G.cream,maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.party}</td><td style={{padding:"8px 12px",color:G.muted,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.desc}</td><td style={{padding:"8px 12px",color:G.goldL,fontWeight:700,whiteSpace:"nowrap"}}>{fmt(t.amount)}</td>{effCell(m.cash*t.amount)}{effCell(m.debtor*t.amount)}{effCell(m.creditor*t.amount)}{effCell(m.equity*t.amount)}<td style={{padding:"8px 12px",color:G.muted,fontSize:10,fontFamily:"monospace"}}>{t.ref||"—"}</td><td style={{padding:"8px 12px"}}><div style={{display:"flex",gap:5}}><button onClick={()=>{setEditT(t);setModal("edit");}} style={{background:"transparent",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:5,padding:"2px 8px",fontSize:10,fontWeight:600,cursor:"pointer"}}>Edit</button><button onClick={()=>{setDelId(t.id);setModal("del");}} style={{background:G.danger+"22",border:`1px solid ${G.danger}44`,color:"#e74c3c",borderRadius:5,padding:"2px 8px",fontSize:10,fontWeight:600,cursor:"pointer"}}>Del</button></div></td></tr>;})}
      </tbody></table></div>}
    </div>}
    {(modal==="add"||modal==="edit")&&<TxnModal initial={editT} onSave={p=>{onAddTxn(p);setModal(null);setEditT(null);}} onClose={()=>{setModal(null);setEditT(null);}}/>}
    {modal==="del"&&<ModalWrap onClose={()=>{setModal(null);setDelId(null);}} maxW={340}><div style={{padding:28,textAlign:"center"}}><div style={{fontSize:32,marginBottom:10}}>🗑️</div><h3 style={{color:G.cream,fontFamily:"'Playfair Display',serif",marginBottom:8}}>Delete Transaction?</h3><p style={{color:G.muted,fontSize:13,marginBottom:20}}>This will affect your balances.</p><div style={{display:"flex",gap:10,justifyContent:"center"}}><button onClick={()=>{setModal(null);setDelId(null);}} style={{background:"transparent",border:`1px solid ${G.bdr}`,color:G.muted,borderRadius:7,padding:"8px 16px",fontSize:12,fontWeight:600,cursor:"pointer"}}>Cancel</button><button onClick={()=>{onDelTxn(delId);setModal(null);setDelId(null);}} style={{background:G.danger,border:"none",color:"#fff",borderRadius:7,padding:"8px 16px",fontSize:12,fontWeight:700,cursor:"pointer"}}>Delete</button></div></div></ModalWrap>}
  </div>;
}

// ── ROOT APP ──────────────────────────────────────────────────────────────
export default function LavisHomeApp() {
  const [prods, setProds] = useState([]);
  const [txns,  setTxns]  = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("inventory");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    let invOk=false, txnOk=false;
    function check(){ if(invOk&&txnOk) setLoaded(true); }
    const unsubInv = onSnapshot(doc(db,"lavishome","inventory"), snap => {
      setProds(snap.exists() ? (snap.data().items||[]) : SAMPLE_INV);
      invOk=true; check();
    });
    const unsubTxn = onSnapshot(doc(db,"lavishome","transactions"), snap => {
      setTxns(snap.exists() ? (snap.data().items||[]) : SAMPLE_TXN);
      txnOk=true; check();
    });
    return () => { unsubInv(); unsubTxn(); };
  }, []);

  function flash(){ setSaved("Saved ✓"); setTimeout(()=>setSaved(""),2000); }

  async function persistInv(list){
    setProds(list);
    try { await setDoc(doc(db,"lavishome","inventory"),{items:list}); flash(); }
    catch { setSaved("Save failed"); }
  }
  async function persistTxn(list){
    setTxns(list);
    try { await setDoc(doc(db,"lavishome","transactions"),{items:list}); flash(); }
    catch { setSaved("Save failed"); }
  }

  function addOrUpdateTxn(t){ const u=txns.find(x=>x.id===t.id)?txns.map(x=>x.id===t.id?t:x):[...txns,t]; persistTxn(u); }
  function delTxn(id){ persistTxn(txns.filter(t=>t.id!==id)); }
  const cash = useMemo(()=>txns.reduce((s,t)=>{const m=TXN_TYPES[t.type];return s+(m?m.cash*t.amount:0);},0),[txns]);

  if (!loaded) return (
    <div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:G.bg,flexDirection:"column",gap:16}}>
      <div style={{color:G.gold,fontFamily:"'Playfair Display',serif",fontSize:18}}>Connecting to Lavishome…</div>
      <div style={{color:G.muted,fontSize:12}}>Loading live data from Firebase</div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:G.bg,fontFamily:"'DM Sans',sans-serif",color:G.cream}}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet"/>
      <div style={{background:G.surf,borderBottom:`1px solid ${G.bdr}`}}>
        <div style={{maxWidth:1280,margin:"0 auto",padding:"0 24px",display:"flex",alignItems:"center",justifyContent:"space-between",height:58}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:28,height:28,background:G.gold,borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>🏠</div>
            <div>
              <div style={{fontSize:14,fontWeight:700,fontFamily:"'Playfair Display',serif",color:G.goldL,letterSpacing:"0.04em"}}>Lavishome</div>
              <div style={{fontSize:8,color:G.muted,letterSpacing:"0.14em",textTransform:"uppercase"}}>Business Manager</div>
            </div>
          </div>
          <div style={{display:"flex",gap:2}}>
            {[["inventory","📦 Inventory"],["finance","💳 Finance"]].map(([k,l])=>(
              <button key={k} onClick={()=>setTab(k)} style={{background:tab===k?G.gold:G.surf2,border:`1px solid ${tab===k?G.gold:G.bdr}`,color:tab===k?"#0f0e0c":G.muted,borderRadius:8,padding:"7px 18px",fontSize:12,fontWeight:700,cursor:"pointer",transition:"all 0.12s"}}>{l}</button>
            ))}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:9,color:G.muted,textTransform:"uppercase",letterSpacing:"0.1em"}}>💵 Cash Balance</div>
              <div style={{fontSize:14,fontWeight:700,color:cash>=0?G.ok:G.danger,fontFamily:"'Playfair Display',serif"}}>{fmt(cash)}</div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:G.ok,boxShadow:`0 0 6px ${G.ok}`}}></div>
              <span style={{fontSize:10,color:G.muted}}>Live</span>
            </div>
            {saved&&<span style={{fontSize:11,color:G.ok}}>{saved}</span>}
          </div>
        </div>
      </div>
      <div style={{maxWidth:1280,margin:"0 auto",padding:24}}>
        {tab==="inventory"&&<InventoryTab prods={prods} persist={persistInv}/>}
        {tab==="finance"&&<FinanceTab txns={txns} onAddTxn={addOrUpdateTxn} onDelTxn={delTxn}/>}
      </div>
      <div style={{textAlign:"center",padding:"10px 24px",color:G.muted,fontSize:9,borderTop:`1px solid ${G.bdr}22`,letterSpacing:"0.1em"}}>
        🔴 LIVE — FIREBASE REAL-TIME — CHANGES APPEAR INSTANTLY ON ALL DEVICES
      </div>
    </div>
  );
}
