"use strict";
/* ================= constants ================= */
const KEY = "paperdesk:v2", OLDKEY = "paperdesk:v1";
const RATE = 0.045, DEFAULT_IV = 0.35;
const SEED = {
  AAPL:[270,"Apple"], MSFT:[480,"Microsoft"], NVDA:[180,"NVIDIA"], GOOGL:[300,"Alphabet"], AMZN:[230,"Amazon"],
  META:[620,"Meta Platforms"], TSLA:[400,"Tesla"], NFLX:[1100,"Netflix"], AMD:[220,"AMD"], JPM:[310,"JPMorgan Chase"],
  SPY:[670,"SPDR S&P 500 ETF"], QQQ:[600,"Invesco QQQ ETF"], DIS:[110,"Disney"], COST:[900,"Costco"], V:[340,"Visa"], KO:[70,"Coca-Cola"]
};
/* m = dollars per 1.00 point, mg = approximate initial margin per contract (real margins vary and change) */
const FUT = {
  ES:{n:"E-mini S&P 500", m:50,   mg:24000, seed:6700},
  MES:{n:"Micro E-mini S&P 500", m:5, mg:2400, seed:6700},
  NQ:{n:"E-mini Nasdaq-100", m:20,  mg:36000, seed:25000},
  MNQ:{n:"Micro E-mini Nasdaq-100", m:2, mg:3600, seed:25000},
  CL:{n:"Crude Oil (WTI)", m:1000,  mg:7500,  seed:85},
  GC:{n:"Gold", m:100,              mg:13000, seed:4200}
};
const COLORS = ["#0f5c7a","#c9792b","#6a4c93","#2e8b57","#b5446e","#3d7ea6","#8c8c3a","#7a5c3e","#4f6d7a"];

/* ================= state ================= */
let DB = null;
let tab = "search", optSym = "AAPL", optExp = null, M = null, busy = false;
let INST = null;                      // instrument detail on Search tab
let SR = {q:"", list:[], loading:false, err:"", note:""};
let armedKey = null, armedTimer = null;

const store = {
  async get(k){
    if(window.storage){ try{ const r = await window.storage.get(k); if(r && r.value) return r.value; }catch(e){} }
    try{ return localStorage.getItem(k); }catch(e){ return null; }
  },
  async set(k,v){
    if(window.storage){ try{ await window.storage.set(k,v); return; }catch(e){} }
    try{ localStorage.setItem(k,v); }catch(e){}
  }
};
function freshQuotes(){
  const q = {};
  for(const s in SEED) q[s] = {price:SEED[s][0], prev:SEED[s][0], src:"est", asOf:""};
  for(const s in FUT) q[s] = {price:FUT[s].seed, prev:FUT[s].seed, src:"est", asOf:""};
  return q;
}
function blankPortfolio(id,name,cash){
  const c = cash>0?cash:0;
  const p = {id, name, cash:c, deposits:c, realized:0, positions:{}, options:[], futures:[], trades:[], history:[]};
  if(c>0) p.trades.push({t:Date.now(), text:"Starting cash", amt:c});
  return p;
}
function freshDB(){
  return {v:2, activeId:1, portfolios:[blankPortfolio(1,"Main",0)], quotes:freshQuotes(), iv:{}, names:{},
    watch:["AAPL","MSFT","NVDA","GOOGL","AMZN","TSLA","META","SPY"],
    settings:{tdKey:"", gh:{owner:"", repo:"", path:"portfolio-data.json", branch:"main", token:""}}, nextId:2};
}
const P = () => DB.portfolios.find(p=>p.id===DB.activeId) || DB.portfolios[0];

function mergeLoaded(obj){
  const f = freshDB(), d = Object.assign(f, obj);
  d.settings = Object.assign(f.settings, obj.settings||{});
  d.settings.gh = Object.assign(freshDB().settings.gh, (obj.settings||{}).gh||{});
  d.quotes = Object.assign(freshQuotes(), obj.quotes||{});
  d.portfolios.forEach(p=>{ p.positions=p.positions||{}; p.options=p.options||[]; p.futures=p.futures||[]; p.trades=p.trades||[]; p.history=p.history||[]; });
  if(!d.portfolios.length) d.portfolios=[blankPortfolio(1,"Main",0)];
  if(!d.portfolios.find(p=>p.id===d.activeId)) d.activeId = d.portfolios[0].id;
  return d;
}
async function load(){
  DB = freshDB();
  try{
    const raw = await store.get(KEY);
    if(raw){ DB = mergeLoaded(JSON.parse(raw)); return; }
    const old = await store.get(OLDKEY);                       // migrate the first version
    if(old){
      const o = JSON.parse(old), p = blankPortfolio(1,"Main",0);
      p.cash=o.cash||0; p.deposits=o.deposits||0; p.realized=o.realized||0;
      for(const s in (o.positions||{})) p.positions[s]={qty:o.positions[s].qty, avg:o.positions[s].avg};
      p.options=(o.options||[]).map(x=>Object.assign({},x)); p.trades=(o.trades||[]).map(t=>({t:t.t,text:t.text,amt:t.amt}));
      p.history=(o.history||[]).map(h=>({t:h.t,v:h.v}));
      DB.portfolios=[p]; DB.nextId=(o.nextId||1)+5; DB.watch=o.watch||DB.watch;
      return;
    }
    // Nothing saved in this browser yet: try the JSON file shipped in the repo
    const r = await fetch("data/portfolio-data.json", {cache:"no-store"});
    if(r.ok){ const seed = await r.json(); if(seed && Array.isArray(seed.portfolios)) DB = mergeLoaded(seed); }
  }catch(e){}
}
let saveTimer;
function save(){ clearTimeout(saveTimer); saveTimer = setTimeout(()=>store.set(KEY, JSON.stringify(DB)), 250); }
function exportJSON(){
  const c = JSON.parse(JSON.stringify(DB));
  c.settings = {tdKey:"", gh:Object.assign({}, c.settings.gh, {token:""})};   // never export secrets
  return JSON.stringify(c, null, 2);
}

/* ================= helpers ================= */
const el = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const usd = (n,d=2) => (n<0?"-":"") + "$" + Math.abs(n).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
const sgn = n => (n>0.004?"+":"") + usd(n);
const pct = n => (n>=0?"+":"") + (n*100).toFixed(2) + "%";
const cls = n => n>0.004?"gain":(n<-0.004?"loss":"");
const num = n => Math.round(n*10000)/10000;
const ymd = d => d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
const nice = s => new Date(s+"T12:00:00").toLocaleDateString("en-US",{day:"numeric",month:"short",year:"numeric"});
const wait = ms => new Promise(r=>setTimeout(r,ms));
const nameOf = s => DB.names[s] || (SEED[s]?SEED[s][1]:(FUT[s]?FUT[s].n:""));
function setStatus(t){ el("status").textContent = t; }
function log(p,text,amt){ p.trades.unshift({t:Date.now(), text, amt}); if(p.trades.length>500) p.trades.length=500; }
function snapshot(){ const p=P(); p.history.push({t:Date.now(), v:acct(p).equity}); if(p.history.length>300) p.history=p.history.slice(-300); }

/* ================= pricing ================= */
const price = s => DB.quotes[s] ? DB.quotes[s].price : null;
const ivOf = s => DB.iv[s] || DEFAULT_IV;
function cdf(x){
  const t=1/(1+0.2316419*Math.abs(x)), d=0.3989423*Math.exp(-x*x/2);
  const p=d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));
  return x>0?1-p:p;
}
function bs(type,Sp,K,T,r,v){
  if(T<=0) return Math.max(0, type==="C"?Sp-K:K-Sp);
  const sq=v*Math.sqrt(T), d1=(Math.log(Sp/K)+(r+v*v/2)*T)/sq, d2=d1-sq;
  return type==="C" ? Sp*cdf(d1)-K*Math.exp(-r*T)*cdf(d2) : K*Math.exp(-r*T)*cdf(-d2)-Sp*cdf(-d1);
}
function delta(type,Sp,K,T,r,v){
  if(T<=0) return type==="C"?(Sp>K?1:0):(Sp<K?-1:0);
  const d1=(Math.log(Sp/K)+(r+v*v/2)*T)/(v*Math.sqrt(T));
  return type==="C"?cdf(d1):cdf(d1)-1;
}
function yearsTo(exp){ return Math.max(0,(new Date(exp+"T21:00:00Z").getTime()-Date.now())/(365*864e5)); }
function optQuote(sym,type,K,exp){
  const sp=price(sym); if(!sp) return null;
  const T=yearsTo(exp), v=ivOf(sym), mid=Math.max(0.01,bs(type,sp,K,T,RATE,v));
  return {mid, bid:Math.max(0.01,mid*0.98-0.01), ask:mid*1.02+0.01, delta:delta(type,sp,K,T,RATE,v)};
}
function expiries(){
  const d=new Date(); d.setHours(12,0,0,0);
  d.setDate(d.getDate()+(((5-d.getDay()+7)%7)||7));
  return [0,1,2,3,7,12,25].map(w=>{const x=new Date(d); x.setDate(x.getDate()+7*w); return ymd(x);});
}
const strikeStep = p => p<20?0.5:p<50?1:p<100?2.5:p<250?5:p<500?10:p<1000?20:25;
const optLabel = o => `${o.sym} $${o.strike} ${o.type==="C"?"Call":"Put"} · ${nice(o.expiry)}`;

/* Account maths. qty is signed everywhere: positive = long, negative = short. */
function acct(p){
  let stockVal=0, stockUnreal=0, optVal=0, optUnreal=0, futPL=0, dayPL=0, coll=0, optCost=0, stockCost=0;
  for(const [s,pos] of Object.entries(p.positions)){
    const q=DB.quotes[s], pr=q?q.price:pos.avg;
    stockVal+=pos.qty*pr; stockUnreal+=pos.qty*(pr-pos.avg); stockCost+=Math.abs(pos.qty)*pos.avg;
    if(q) dayPL+=pos.qty*(q.price-q.prev);
    if(pos.qty<0) coll+=1.5*(-pos.qty)*pr;                     // short stock: proceeds + 50% extra
  }
  for(const o of p.options){
    const q=optQuote(o.sym,o.type,o.strike,o.expiry), mark=q?q.mid:o.avg;
    optVal+=o.qty*mark*100; optUnreal+=o.qty*(mark-o.avg)*100; optCost+=Math.abs(o.qty)*o.avg*100;
    if(o.qty<0){
      const sp=price(o.sym)||o.strike, otm=o.type==="C"?Math.max(0,o.strike-sp):Math.max(0,sp-o.strike);
      coll+=(Math.max(0.2*sp-otm,0.1*sp)*100+mark*100)*(-o.qty);   // short option margin (simplified)
    }
  }
  for(const f of p.futures){
    const q=DB.quotes[f.sym], pr=q?q.price:f.avg, m=FUT[f.sym].m;
    futPL+=f.qty*(pr-f.avg)*m; if(q) dayPL+=f.qty*(q.price-q.prev)*m; coll+=Math.abs(f.qty)*FUT[f.sym].mg;
  }
  const equity=p.cash+stockVal+optVal+futPL;
  return {stockVal,optVal,futPL,dayPL,coll,equity,bp:p.cash+futPL-coll,
          unreal:stockUnreal+optUnreal+futPL, total:equity-p.deposits, long:stockVal+optVal};
}

/* Apply a fill to a signed position. Returns realized P/L in price units x closed quantity. */
function fill(pos,d,px){
  const q0=pos.qty; let pl=0;
  if(q0===0 || Math.sign(q0)===Math.sign(d)){
    const nq=q0+d; pos.avg=(Math.abs(q0)*pos.avg+Math.abs(d)*px)/Math.abs(nq); pos.qty=nq;
  } else {
    const c=Math.min(Math.abs(d),Math.abs(q0)); pl=(px-pos.avg)*c*Math.sign(q0);
    const nq=q0+d; if(Math.abs(nq)>1e-9 && Math.sign(nq)!==Math.sign(q0)) pos.avg=px; pos.qty=nq;
  }
  pos.qty=Math.round(pos.qty*1e4)/1e4; return pl;
}
function describe(q0,d){
  if(q0===0||q0*d>0) return d>0?"Opens or adds to a long position":"Opens or adds to a short position";
  const c=Math.min(Math.abs(d),Math.abs(q0)), rem=Math.abs(d)-c;
  return `Closes ${num(c)} ${q0>0?"long":"short"}` + (rem>1e-9?` and opens ${num(rem)} ${d>0?"long":"short"}`:"");
}

/* ================= trading ================= */
const KIND_MULT = inst => inst.k==="stock"?1:inst.k==="opt"?100:FUT[inst.sym].m;
function heldQty(p,inst){
  if(inst.k==="stock") return (p.positions[inst.sym]||{qty:0}).qty;
  if(inst.k==="fut") return (p.futures.find(f=>f.sym===inst.sym)||{qty:0}).qty;
  const o=p.options.find(x=>x.sym===inst.sym&&x.type===inst.type&&x.strike===inst.strike&&x.expiry===inst.expiry); return o?o.qty:0;
}
function execTrade(c,inst,d){
  d=num(d); if(!d) return "Enter a quantity greater than zero.";
  if(inst.k==="stock"){
    const pr=price(inst.sym); if(!pr) return "No price for "+inst.sym+". Refresh prices first.";
    const pos=c.positions[inst.sym]||(c.positions[inst.sym]={qty:0,avg:0});
    c.realized+=fill(pos,d,pr); c.cash-=d*pr; if(Math.abs(pos.qty)<1e-5) delete c.positions[inst.sym];
    log(c,`${d>0?"Bought":"Sold"} ${Math.abs(d)} ${inst.sym} @ ${usd(pr)}`,-d*pr);
  } else if(inst.k==="opt"){
    if(!Number.isInteger(d)) return "Contracts must be whole numbers.";
    const q=optQuote(inst.sym,inst.type,inst.strike,inst.expiry); if(!q) return "No price for "+inst.sym+".";
    const px=d>0?q.ask:q.bid;
    let o=c.options.find(x=>x.sym===inst.sym&&x.type===inst.type&&x.strike===inst.strike&&x.expiry===inst.expiry);
    if(!o){ o={id:DB.nextId++,sym:inst.sym,type:inst.type,strike:inst.strike,expiry:inst.expiry,qty:0,avg:0}; c.options.push(o); }
    c.realized+=fill(o,d,px)*100; c.cash-=d*px*100; if(o.qty===0) c.options=c.options.filter(x=>x!==o);
    log(c,`${d>0?"Bought":"Sold"} ${Math.abs(d)} × ${optLabel(inst)} @ ${usd(px)}`,-d*px*100);
  } else {
    if(!Number.isInteger(d)) return "Contracts must be whole numbers.";
    const pr=price(inst.sym); if(!pr) return "No price for "+inst.sym+".";
    let f=c.futures.find(x=>x.sym===inst.sym); if(!f){ f={id:DB.nextId++,sym:inst.sym,qty:0,avg:0}; c.futures.push(f); }
    const pl=fill(f,d,pr)*FUT[inst.sym].m; c.realized+=pl; c.cash+=pl; if(f.qty===0) c.futures=c.futures.filter(x=>x!==f);
    log(c,`${d>0?"Bought":"Sold"} ${Math.abs(d)} ${inst.sym} futures @ ${usd(pr)}`,pl);
  }
  return null;
}
function previewTrade(inst,d){
  const p=P(), c=JSON.parse(JSON.stringify(p)), err=execTrade(c,inst,d); if(err) return {err};
  const a=acct(c), b=acct(p);
  return {err:(a.bp<-0.005 && a.bp<b.bp-1e-6)?"Not enough buying power. This order needs "+usd(-a.bp)+" more.":null, a, dReal:c.realized-p.realized};
}
function commitTrade(inst,d){
  const r=previewTrade(inst,d); if(r.err) return r.err;
  execTrade(P(),inst,d); snapshot(); save(); return null;
}
function settleExpired(){
  const today=ymd(new Date());
  DB.portfolios.forEach(p=>{
    p.options=p.options.filter(o=>{
      const q=DB.quotes[o.sym]; if(o.expiry>=today||!q||q.src!=="live") return true;
      const intr=o.type==="C"?Math.max(0,q.price-o.strike):Math.max(0,o.strike-q.price);
      p.cash+=o.qty*intr*100; p.realized+=(intr-o.avg)*100*o.qty;
      log(p,`Expired ${o.qty} × ${optLabel(o)} · settled at ${usd(intr)}`,o.qty*intr*100); return false;
    });
  });
}

/* ================= market data ================= */
const hasKey = () => !!DB.settings.tdKey;
function applyQuote(sym,pr,prev,asOf,name){
  if(!(pr>0)) return false;
  DB.quotes[sym]={price:pr, prev:prev>0?prev:pr, src:"live", asOf:asOf||""};
  if(name) DB.names[sym]=name; return true;
}
async function td(path,params){
  const u=new URL("https://api.twelvedata.com/"+path);
  for(const k in params) u.searchParams.set(k,params[k]);
  u.searchParams.set("apikey",DB.settings.tdKey);
  const r=await fetch(u.toString()), j=await r.json();
  if(j.status==="error"||j.code>=400) throw new Error(j.message||"Twelve Data error");
  return j;
}
async function claudeJSON(prompt){
  const resp=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:1000,tools:[{type:"web_search_20250305",name:"web_search"}],messages:[{role:"user",content:prompt}]})});
  const data=await resp.json();
  const text=(data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("");
  const a=text.indexOf("{"), b=text.lastIndexOf("}"); if(a<0||b<0) throw new Error("No data returned");
  return JSON.parse(text.slice(a,b+1));
}
const todayStr = () => new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"});

async function refreshQuotes(only){
  if(busy) return; busy=true; el("btnRefresh").disabled=true;
  const all=only||[...new Set([...DB.watch,...DB.portfolios.flatMap(p=>[...Object.keys(p.positions),...p.options.map(o=>o.sym),...p.futures.map(f=>f.sym)])])];
  const stocks=all.filter(s=>!FUT[s]), futs=all.filter(s=>FUT[s]);
  let got=0, errMsg="", asOf="";
  try{
    if(hasKey()){
      for(let i=0;i<stocks.length;i+=8){
        if(i>0){ for(let s=62;s>0;s--){ setStatus(`Twelve Data free plan allows 8 quotes a minute. Next batch in ${s}s...`); await wait(1000); } }
        const batch=stocks.slice(i,i+8); setStatus(`Fetching ${batch.join(", ")}...`);
        let res=await td("quote",{symbol:batch.join(",")}); if(batch.length===1) res={[batch[0]]:res};
        for(const s of batch){ const r=res[s]; if(r&&r.close&&r.status!=="error"){ if(applyQuote(s,parseFloat(r.close),parseFloat(r.previous_close),r.datetime?("as of "+r.datetime):"",r.name)){got++; asOf=r.datetime||asOf;} } }
      }
    } else {
      for(let i=0;i<stocks.length;i+=8){
        const batch=stocks.slice(i,i+8); setStatus(`Looking up ${batch.join(", ")}...`);
        const res=await claudeJSON(`Today is ${todayStr()}. Use web search to find the latest available price (live if the US market is open, otherwise the most recent close) and the previous close for these US-listed tickers: ${batch.join(", ")}.
Respond with ONLY a JSON object, no markdown: {"asOf":"short quote time, e.g. close Nov 20 2026","quotes":[{"symbol":"AAPL","price":0.00,"prevClose":0.00}]}. Only include tickers where you found a current price. Never guess or fill in from memory.`);
        for(const q of (res.quotes||[])){ const s=String(q.symbol||"").toUpperCase(); if(batch.includes(s)&&applyQuote(s,parseFloat(q.price),parseFloat(q.prevClose),res.asOf)){got++; asOf=res.asOf||asOf;} }
      }
    }
    if(futs.length && !hasKey()){
      setStatus("Looking up futures...");
      const res=await claudeJSON(`Today is ${todayStr()}. Use web search to find the latest front-month futures price and previous settlement for: ${futs.map(s=>s+" ("+FUT[s].n+")").join(", ")}. Micro contracts (MES, MNQ) trade at the same index level as ES and NQ.
Respond with ONLY a JSON object: {"asOf":"short quote time","quotes":[{"symbol":"ES","price":0.00,"prevClose":0.00}]}. Only include contracts where you found a current price. Never guess.`);
      for(const q of (res.quotes||[])){ const s=String(q.symbol||"").toUpperCase(); if(FUT[s]&&applyQuote(s,parseFloat(q.price),parseFloat(q.prevClose),res.asOf)) got++; }
    }
  }catch(e){ errMsg=e.message||"request failed"; }
  busy=false; el("btnRefresh").disabled=false;
  if(got){ settleExpired(); DB.portfolios.forEach(p=>p.history.push({t:Date.now(),v:acct(p).equity})); save(); }
  if(got) setStatus(`Updated ${got} prices${asOf?" · "+asOf:""}${errMsg?" · some lookups failed: "+errMsg:""}${hasKey()&&futs.length?" · futures need a manual price (Admin) in key mode":""}`);
  else setStatus(`Could not fetch prices (${errMsg||"no data"}). ${hasKey()?"Check your Twelve Data key in Admin.":"Outside claude.ai, add a free Twelve Data key in Admin to get live prices."}`);
  render();
}

/* ---------- search & instrument detail ---------- */
async function doSearch(){
  const q=(el("sq").value||"").trim(); if(!q) return;
  SR={q,list:[],loading:true,err:"",note:""}; renderView();
  try{
    if(hasKey()){
      const j=await td("symbol_search",{symbol:q,outputsize:30}), seen={};
      SR.list=(j.data||[]).filter(x=>x.country==="United States"&&!seen[x.symbol]&&(seen[x.symbol]=1)).slice(0,10)
        .map(x=>({symbol:x.symbol,name:x.instrument_name,ex:x.exchange,type:x.instrument_type}));
    } else {
      const j=await claudeJSON(`Today is ${todayStr()}. Use web search. Find US-listed stocks or ETFs matching "${q}" (tickers or company names), up to 5 results, with latest price and previous close.
Respond with ONLY JSON: {"asOf":"short quote time","results":[{"symbol":"","name":"","exchange":"","price":0,"prevClose":0}]}. Never guess prices.`);
      SR.list=(j.results||[]).map(x=>{ const s=String(x.symbol).toUpperCase(); applyQuote(s,parseFloat(x.price),parseFloat(x.prevClose),j.asOf,x.name); return {symbol:s,name:x.name,ex:x.exchange,type:""}; });
      save(); SR.note="Price history needs a free Twelve Data key (Admin → Data & sync).";
    }
    if(!SR.list.length) SR.err="No US-listed matches found.";
  }catch(e){ SR.err=(hasKey()?"Search failed: ":"Search needs Claude (inside claude.ai) or a Twelve Data key. ")+(e.message||""); }
  SR.loading=false; renderView();
}
async function openInstrument(sym,name){
  sym=sym.toUpperCase(); if(name) DB.names[sym]=name;
  INST={sym,hist:null,range:"3M",loading:true,err:""}; tab="search"; render();
  try{
    if(hasKey() && !FUT[sym]){
      const [q,h]=await Promise.all([td("quote",{symbol:sym}), td("time_series",{symbol:sym,interval:"1day",outputsize:260})]);
      applyQuote(sym,parseFloat(q.close),parseFloat(q.previous_close),q.datetime?("as of "+q.datetime):"",q.name);
      INST.hist=(h.values||[]).map(v=>({d:v.datetime,c:parseFloat(v.close)})).reverse();
      save();
    } else if(!price(sym)) await refreshQuotes([sym]);
  }catch(e){ INST.err=e.message||"Could not load data"; }
  if(INST) INST.loading=false; render();
}

/* ================= rendering ================= */
function srcTag(q){ return !q?"":(q.src==="live"?`<span class="tag live" title="${esc(q.asOf||"")}">live</span>`:q.src==="manual"?`<span class="tag" title="Set by you in Admin">manual</span>`:`<span class="tag" title="Starter estimate. Refresh prices to replace it.">est.</span>`); }
function sparkline(p){
  const h=p.history; if(h.length<2) return `<div class="note">Your portfolio chart appears after a couple of trades or price refreshes.</div>`;
  const w=320, ht=84, vs=h.map(x=>x.v), mn=Math.min(...vs), mx=Math.max(...vs), rg=(mx-mn)||1;
  const pts=h.map((x,i)=>`${(i/(h.length-1)*(w-8)+4).toFixed(1)},${(ht-8-((x.v-mn)/rg)*(ht-16)).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 ${w} ${ht}" width="100%" role="img" aria-label="Portfolio value over time"><polyline class="ln" points="${pts}"/><text x="4" y="10">${usd(mx,0)}</text><text x="4" y="${ht-1}">${usd(mn,0)}</text></svg>`;
}
function renderHeader(){
  el("pfSel").innerHTML=DB.portfolios.map(p=>`<option value="${p.id}" ${p.id===DB.activeId?"selected":""}>${esc(p.name)}</option>`).join("");
}
function renderHero(){
  const p=P(), a=acct(p), tp=p.deposits>0?a.total/p.deposits:0;
  el("hero").innerHTML=`
    <div class="hero">
      <div>
        <div class="muted">${esc(p.name)} · total portfolio value</div>
        <div class="big">${usd(a.equity)}</div>
        <div class="${cls(a.total)}" style="font-weight:600">${sgn(a.total)} ${p.deposits>0?`(${pct(tp)})`:""} <span class="muted" style="font-weight:400">all-time vs money added</span></div>
      </div>
      <div>${sparkline(p)}</div>
    </div>
    <div class="stats">
      <div class="stat"><div class="l">Cash</div><div class="v">${usd(p.cash)}</div></div>
      <div class="stat"><div class="l" title="Cash you can still use, after margin for short positions and futures">Buying power</div><div class="v ${a.bp<0?"loss":""}">${usd(a.bp)}</div></div>
      <div class="stat"><div class="l">Today</div><div class="v ${cls(a.dayPL)}">${sgn(a.dayPL)}</div></div>
      <div class="stat"><div class="l">Unrealized P/L</div><div class="v ${cls(a.unreal)}">${sgn(a.unreal)}</div></div>
      <div class="stat"><div class="l">Realized P/L</div><div class="v ${cls(p.realized)}">${sgn(p.realized)}</div></div>
      <div class="stat"><div class="l">Margin held</div><div class="v">${usd(a.coll)}</div></div>
    </div>${a.bp<-0.005?`<div class="warnbox" style="margin-top:12px">Buying power is negative. In a real account this would trigger a margin call. Close some positions or add money.</div>`:""}`;
}

/* ----- search ----- */
function histChart(){
  const h=INST.hist, n={"1M":21,"3M":63,"6M":126,"1Y":252}[INST.range], pts=h.slice(-n); INST.pts=pts;
  const w=640, ht=240, pad=34, cs=pts.map(p=>p.c), mn=Math.min(...cs), mx=Math.max(...cs), rg=(mx-mn)||1, up=cs[cs.length-1]>=cs[0];
  const X=i=>pad+i/(pts.length-1)*(w-2*pad), Y=c=>ht-pad-(c-mn)/rg*(ht-2*pad);
  return `<svg id="hchart" viewBox="0 0 ${w} ${ht}" width="100%" role="img" aria-label="Price history">
    <line class="axis" x1="${pad}" x2="${w-pad}" y1="${ht-pad}" y2="${ht-pad}"/>
    <polyline class="ln ${up?"up":"dn"}" points="${pts.map((p,i)=>X(i).toFixed(1)+","+Y(p.c).toFixed(1)).join(" ")}"/>
    <line id="hl" class="guide" x1="0" x2="0" y1="${pad-10}" y2="${ht-pad}" visibility="hidden"/>
    <text id="ht" x="${pad}" y="14" style="fill:var(--ink);font-size:12px">${INST.sym} ${pts[0].d} to ${pts[pts.length-1].d}</text>
    <text x="${pad}" y="${ht-pad+14}">${usd(mn,2)}</text><text x="${w-pad}" y="${ht-pad+14}" text-anchor="end">${usd(mx,2)}</text>
  </svg>`;
}
function viewSearch(){
  const p=P();
  let list="";
  if(SR.loading) list=`<div class="empty">Searching...</div>`;
  else if(SR.err) list=`<div class="warnbox">${esc(SR.err)}</div>`;
  else if(SR.list.length) list=`<div class="scroll"><table><tbody>${SR.list.map(r=>{ const q=DB.quotes[r.symbol]; return `<tr><td><span class="sym">${esc(r.symbol)}</span><div class="muted" style="font-size:12px">${esc(r.name||"")} ${r.ex?"· "+esc(r.ex):""}</div></td><td>${q?usd(q.price):""}${srcTag(q)}</td><td><button class="sm primary" data-a="inst" data-s="${esc(r.symbol)}">Open chart and trade</button></td></tr>`; }).join("")}</tbody></table></div>${SR.note?`<p class="note">${esc(SR.note)}</p>`:""}`;
  let inst="";
  if(INST){
    const s=INST.sym, q=DB.quotes[s], chg=q?(q.price-q.prev)/q.prev:0, held=(p.positions[s]||{qty:0}).qty, watching=DB.watch.includes(s);
    let chart;
    if(INST.loading) chart=`<div class="empty">Loading ${s}...</div>`;
    else if(INST.hist&&INST.hist.length>2) chart=histChart()+`<div class="row" style="margin-top:6px">${["1M","3M","6M","1Y"].map(r=>`<button class="sm ${INST.range===r?"on-range":""}" data-a="range" data-r="${r}">${r}</button>`).join("")}</div>`;
    else chart=`<div class="note">${INST.err?esc(INST.err)+" · ":""}${FUT[s]?"History is not available for futures.":"Historical charts need a free Twelve Data key. Add it in Admin → Data & sync, then open this stock again."}</div>`;
    inst=`<div class="card"><div class="row between"><div><h2>${s} <span class="muted" style="font-weight:400">${esc(nameOf(s))}</span></h2>
      <div style="font-size:26px;font-weight:650">${q?usd(q.price):"–"}${srcTag(q)} <span class="${cls(chg)}" style="font-size:15px">${q?pct(chg):""}</span></div></div>
      <div class="row"><button class="buy" data-a="trade" data-s="${s}" data-side="buy" ${q?"":"disabled"}>Buy</button>
      <button class="sell" data-a="trade" data-s="${s}" data-side="sell" ${q?"":"disabled"}>Sell / Short</button>
      <button data-a="toopt" data-s="${s}" ${q?"":"disabled"}>Options</button>
      <button data-a="${watching?"unwatch":"watch"}" data-s="${s}">${watching?"Remove from watchlist":"Add to watchlist"}</button></div></div>
      ${held?`<div class="muted" style="margin:6px 0">You ${held>0?"hold":"are short"} ${Math.abs(held)} shares in ${esc(p.name)}.</div>`:""}
      <div style="margin-top:10px">${chart}</div></div>`;
  }
  return `<div class="card"><h2 style="margin-bottom:8px">Search US stocks and ETFs</h2>
    <div class="inline"><input id="sq" placeholder="Ticker or company, e.g. Palantir or PLTR" value="${esc(SR.q)}" style="flex:1;min-width:200px"><button class="primary" data-a="search">Search</button></div>
    <div style="margin-top:10px">${list}</div></div>${inst}`;
}

/* ----- watchlist ----- */
function viewMarkets(){
  const p=P();
  const rows=DB.watch.map(s=>{
    const q=DB.quotes[s], chg=q?(q.price-q.prev)/q.prev:0, held=(p.positions[s]||{qty:0}).qty;
    return `<tr><td><span class="sym">${s}</span><div class="muted" style="font-size:12px">${esc(nameOf(s))}</div></td>
      <td>${q?usd(q.price):"–"}${srcTag(q)}</td><td class="${cls(chg)}">${q?pct(chg):"–"}</td><td>${held?num(held):""}</td>
      <td><button class="sm buy" data-a="trade" data-s="${s}" data-side="buy" ${q?"":"disabled"}>Buy</button>
      <button class="sm sell" data-a="trade" data-s="${s}" data-side="sell" ${q?"":"disabled"}>Sell</button>
      <button class="sm" data-a="inst" data-s="${s}">Chart</button><button class="sm" data-a="toopt" data-s="${s}" ${q?"":"disabled"}>Options</button>
      <button class="sm" data-a="unwatch" data-s="${s}" aria-label="Remove ${s}">×</button></td></tr>`;
  }).join("");
  return `<div class="card"><div class="row between" style="margin-bottom:8px"><h2>Watchlist</h2>
    <div class="row"><input id="addSym" placeholder="Add ticker" maxlength="6" style="width:130px"><button data-a="addsym">Add</button></div></div>
    <div class="scroll"><table><thead><tr><th>Stock</th><th>Price</th><th>Day</th><th>Held</th><th></th></tr></thead><tbody>${rows||`<tr><td colspan="5" class="empty">Add a ticker to start.</td></tr>`}</tbody></table></div>
    <p class="note" style="margin-bottom:0">Selling more shares than you hold opens a short position. Short stock needs 150% of its value as collateral (your sale proceeds plus 50% of your own money). Prices tagged <b>est.</b> are starter values; refresh to replace them.</p></div>`;
}

/* ----- options ----- */
function viewOptions(){
  const p=P(), syms=[...new Set([...DB.watch,...Object.keys(p.positions),...p.options.map(o=>o.sym)])].filter(s=>!FUT[s]);
  if(!syms.includes(optSym)) optSym=syms[0];
  const exps=expiries(); if(!optExp||!exps.includes(optExp)) optExp=exps[0];
  const sp=price(optSym), T=yearsTo(optExp), step=sp?strikeStep(sp):1; let chain="";
  if(sp){
    const atm=Math.round(sp/step)*step;
    for(let i=-8;i<=8;i++){
      const K=Math.round((atm+i*step)*100)/100; if(K<=0) continue;
      const c=optQuote(optSym,"C",K,optExp), q=optQuote(optSym,"P",K,optExp), ci=K<sp?"itm":"", pi=K>sp?"itm":"";
      chain+=`<tr>
        <td class="${ci}"><button class="buy" data-a="otrade" data-type="C" data-strike="${K}" data-side="buy">${usd(c.ask)}</button></td>
        <td class="${ci}"><button class="sell" data-a="otrade" data-type="C" data-strike="${K}" data-side="sell">${usd(c.bid)}</button></td>
        <td class="${ci}">${c.delta.toFixed(2)}</td><td class="k ${i===0?"atm":""}">${K}</td><td class="${pi}">${q.delta.toFixed(2)}</td>
        <td class="${pi}"><button class="sell" data-a="otrade" data-type="P" data-strike="${K}" data-side="sell">${usd(q.bid)}</button></td>
        <td class="${pi}"><button class="buy" data-a="otrade" data-type="P" data-strike="${K}" data-side="buy">${usd(q.ask)}</button></td></tr>`;
    }
  }
  return `<div class="card"><div class="row between"><h2>Options chain</h2><div class="row">
      <select id="optSym" aria-label="Underlying">${syms.map(s=>`<option ${s===optSym?"selected":""}>${s}</option>`).join("")}</select>
      <select id="optExp" aria-label="Expiry">${exps.map(e=>`<option value="${e}" ${e===optExp?"selected":""}>${nice(e)}</option>`).join("")}</select>
      <label class="muted" style="font-size:13px">Volatility <input id="optIv" type="number" min="5" max="300" step="1" value="${Math.round(ivOf(optSym)*100)}" style="width:68px"> %</label></div></div>
    <div class="muted" style="margin:6px 0 10px">${optSym} ${sp?usd(sp):"no price"} · ${Math.round(T*365)} days to expiry · 1 contract = 100 shares</div>
    ${sp?`<div class="scroll"><table class="chain"><thead><tr><th>Call: buy</th><th>Call: sell</th><th>Delta</th><th style="text-align:center">Strike</th><th>Delta</th><th>Put: sell</th><th>Put: buy</th></tr></thead><tbody>${chain}</tbody></table></div>`:`<div class="empty">Refresh prices to load ${optSym}.</div>`}
    <p class="note">Green buttons buy at the ask, red buttons sell at the bid. Selling a contract you do not own is <b>writing</b> (selling to open): you collect the premium now and take on the obligation, so margin is held. Selling a contract you own just closes it. Prices come from the Black-Scholes model using the volatility above, not from live option quotes. Shaded cells are in the money.</p></div>`;
}

/* ----- futures ----- */
function viewFutures(){
  const p=P();
  const rows=Object.keys(FUT).map(s=>{
    const f=FUT[s], q=DB.quotes[s], pos=p.futures.find(x=>x.sym===s), chg=q?(q.price-q.prev)/q.prev:0, upl=pos?pos.qty*(q.price-pos.avg)*f.m:0;
    return `<tr><td><span class="sym">${s}</span><div class="muted" style="font-size:12px">${esc(f.n)}</div></td><td>${q?usd(q.price):"–"}${srcTag(q)}</td><td class="${cls(chg)}">${q?pct(chg):"–"}</td>
      <td>${usd(f.m,0)}</td><td>${usd(f.mg,0)}</td><td>${pos?`${pos.qty>0?"Long":"Short"} ${Math.abs(pos.qty)} @ ${usd(pos.avg)}`:""}</td><td class="${cls(upl)}">${pos?sgn(upl):""}</td>
      <td><button class="sm buy" data-a="ftrade" data-s="${s}" data-side="buy" ${q?"":"disabled"}>Buy</button> <button class="sm sell" data-a="ftrade" data-s="${s}" data-side="sell" ${q?"":"disabled"}>Sell</button></td></tr>`;
  }).join("");
  return `<div class="card"><h2 style="margin-bottom:8px">Futures</h2>
    <div class="scroll"><table><thead><tr><th>Contract</th><th>Price</th><th>Day</th><th>$ per point</th><th>Margin / contract</th><th>Position</th><th>Unrealized</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="note" style="margin-bottom:0"><b>How futures work here:</b> you do not pay the contract price. You post a margin deposit (shown, approximate) and gain or lose <b>$ per point</b> for every point the price moves. Example: one ES contract is $50 a point, so a 10-point rise earns $500 if you are long and costs $500 if you are short. Profit and loss moves into your cash when you close. Buying with no position opens a long, selling with no position opens a short. Contracts are continuous front-month, with no expiry or rolling. Real margins change often.</p></div>`;
}

/* ----- portfolio ----- */
function donut(items){
  items=items.filter(i=>i.v>0.005); const total=items.reduce((a,b)=>a+b.v,0); if(total<=0) return "";
  const C=2*Math.PI*40; let cum=0;
  const arcs=items.map((it,i)=>{const len=it.v/total*C; const s=`<circle r="40" cx="60" cy="60" fill="none" stroke="${COLORS[i%COLORS.length]}" stroke-width="18" stroke-dasharray="${len} ${C-len}" stroke-dashoffset="${-cum}" transform="rotate(-90 60 60)"/>`; cum+=len; return s;}).join("");
  return `<svg viewBox="0 0 120 120" width="150" height="150" role="img" aria-label="Allocation">${arcs}</svg><div class="legend" style="margin-top:8px">${items.map((it,i)=>`<span><span class="dot" style="background:${COLORS[i%COLORS.length]}"></span>${esc(it.n)} ${(it.v/total*100).toFixed(0)}%</span>`).join("")}</div>`;
}
function viewPortfolio(){
  const p=P();
  const sRows=Object.entries(p.positions).map(([s,pos])=>{
    const q=DB.quotes[s], pr=q?q.price:pos.avg, val=pos.qty*pr, pl=(pr-pos.avg)*pos.qty;
    return `<tr><td class="sym">${s}<span class="tag side">${pos.qty>0?"long":"short"}</span></td><td>${num(pos.qty)}</td><td>${usd(pos.avg)}</td><td>${usd(pr)}${srcTag(q)}</td><td>${usd(val)}</td><td class="${cls(pl)}">${sgn(pl)}</td><td class="${cls(pl)}">${pct(pl/(pos.avg*Math.abs(pos.qty)))}</td>
      <td><button class="sm" data-a="close" data-k="stock" data-s="${s}">Close</button> <button class="sm" data-a="inst" data-s="${s}">Chart</button></td></tr>`;
  }).join("");
  const oRows=p.options.map(o=>{
    const q=optQuote(o.sym,o.type,o.strike,o.expiry), mark=q?q.mid:o.avg, val=o.qty*mark*100, pl=(mark-o.avg)*100*o.qty, days=Math.ceil((new Date(o.expiry+"T21:00:00Z")-Date.now())/864e5);
    return `<tr><td><span class="sym">${esc(optLabel(o))}</span><span class="tag side">${o.qty>0?"long":"short"}</span></td><td>${o.qty}</td><td>${usd(o.avg)}</td><td>${usd(mark)}</td><td>${usd(val)}</td><td class="${cls(pl)}">${sgn(pl)}</td><td class="${cls(pl)}">${pct(pl/(o.avg*100*Math.abs(o.qty)))}</td><td>${days<0?"awaiting settlement":days+"d"}</td>
      <td><button class="sm" data-a="close" data-k="opt" data-id="${o.id}">Close</button></td></tr>`;
  }).join("");
  const fRows=p.futures.map(f=>{
    const q=DB.quotes[f.sym], pr=q?q.price:f.avg, pl=f.qty*(pr-f.avg)*FUT[f.sym].m;
    return `<tr><td class="sym">${f.sym}<span class="tag side">${f.qty>0?"long":"short"}</span><div class="muted" style="font-size:12px">${esc(FUT[f.sym].n)}</div></td><td>${f.qty}</td><td>${usd(f.avg)}</td><td>${usd(pr)}${srcTag(q)}</td><td>${usd(Math.abs(f.qty)*FUT[f.sym].mg,0)}</td><td class="${cls(pl)}">${sgn(pl)}</td>
      <td><button class="sm" data-a="close" data-k="fut" data-s="${f.sym}">Close</button></td></tr>`;
  }).join("");
  const a=acct(p), items=[{n:"Cash",v:p.cash}];
  for(const [s,pos] of Object.entries(p.positions)) if(pos.qty>0) items.push({n:s,v:pos.qty*(price(s)||pos.avg)});
  const lo=p.options.filter(o=>o.qty>0).reduce((t,o)=>{const q=optQuote(o.sym,o.type,o.strike,o.expiry); return t+o.qty*(q?q.mid:o.avg)*100;},0); if(lo>0) items.push({n:"Options",v:lo});
  return `<div class="grid2"><div>
    <div class="card"><h2 style="margin-bottom:8px">Stocks</h2>${sRows?`<div class="scroll"><table><thead><tr><th>Symbol</th><th>Qty</th><th>Avg price</th><th>Price</th><th>Value</th><th>P/L</th><th>P/L %</th><th></th></tr></thead><tbody>${sRows}</tbody></table></div>`:`<div class="empty">No stock positions. Search a stock or use the Watchlist.</div>`}</div>
    <div class="card"><h2 style="margin-bottom:8px">Options</h2>${oRows?`<div class="scroll"><table><thead><tr><th>Contract</th><th>Qty</th><th>Avg premium</th><th>Mark</th><th>Value</th><th>P/L</th><th>P/L %</th><th>Expires</th><th></th></tr></thead><tbody>${oRows}</tbody></table></div>`:`<div class="empty">No option positions.</div>`}</div>
    <div class="card"><h2 style="margin-bottom:8px">Futures</h2>${fRows?`<div class="scroll"><table><thead><tr><th>Contract</th><th>Qty</th><th>Entry</th><th>Price</th><th>Margin</th><th>P/L</th><th></th></tr></thead><tbody>${fRows}</tbody></table></div>`:`<div class="empty">No futures positions.</div>`}</div>
    </div><div class="card"><h2 style="margin-bottom:8px">Long holdings and cash</h2>${donut(items)||`<div class="empty">Add money to see your allocation.</div>`}
      <div class="sumlist" style="margin-top:12px"><div><span>Long market value</span><span>${usd(a.long)}</span></div><div><span>Futures P/L (unsettled)</span><span class="${cls(a.futPL)}">${sgn(a.futPL)}</span></div></div></div></div>`;
}
function viewActivity(){
  const p=P(), rows=p.trades.map(t=>`<div class="act"><div>${esc(t.text)}<div class="muted" style="font-size:12px">${new Date(t.t).toLocaleString()}</div></div><div class="${cls(t.amt)}">${sgn(t.amt)}</div></div>`).join("");
  return `<div class="card"><h2 style="margin-bottom:6px">Activity · ${esc(p.name)}</h2>${rows||`<div class="empty">Deposits and trades will be listed here.</div>`}</div>`;
}

/* ----- admin ----- */
function viewAdmin(){
  const p=P(), g=DB.settings.gh;
  const pfRows=DB.portfolios.map(x=>`<tr><td class="sym">${esc(x.name)}${x.id===DB.activeId?`<span class="tag side">active</span>`:""}</td><td>${usd(acct(x).equity)}</td><td class="${cls(acct(x).total)}">${sgn(acct(x).total)}</td><td><button class="sm" data-a="switch" data-id="${x.id}" ${x.id===DB.activeId?"disabled":""}>Switch</button></td></tr>`).join("");
  const posRows=[
    ...Object.entries(p.positions).map(([s,x])=>`<tr><td>${s} shares</td><td>${num(x.qty)} @ ${usd(x.avg)}</td><td><button class="sm sell" data-a="delpos" data-k="stock" data-id="${s}">Delete</button></td></tr>`),
    ...p.options.map(o=>`<tr><td>${esc(optLabel(o))}</td><td>${o.qty} @ ${usd(o.avg)}</td><td><button class="sm sell" data-a="delpos" data-k="opt" data-id="${o.id}">Delete</button></td></tr>`),
    ...p.futures.map(f=>`<tr><td>${f.sym} futures</td><td>${f.qty} @ ${usd(f.avg)}</td><td><button class="sm sell" data-a="delpos" data-k="fut" data-id="${f.id}">Delete</button></td></tr>`)
  ].join("");
  const priceSyms=[...new Set([...DB.watch,...Object.keys(FUT),...Object.keys(p.positions)])];
  const priceRows=priceSyms.map(s=>{const q=DB.quotes[s]; return `<tr><td class="sym">${s}</td><td>${srcTag(q)}</td><td><input class="pxo" data-s="${s}" type="number" step="any" value="${q?q.price:""}" style="width:110px" aria-label="Price for ${s}"></td></tr>`;}).join("");
  return `<div class="grid2b"><div>
    <div class="card"><h2>Portfolios</h2><div class="scroll"><table><thead><tr><th>Name</th><th>Value</th><th>P/L</th><th></th></tr></thead><tbody>${pfRows}</tbody></table></div></div>
    <div class="card"><h2>Reset numbers · ${esc(p.name)}</h2>
      <div class="field"><label for="admName">Rename portfolio</label><div class="inline"><input id="admName" value="${esc(p.name)}"><button data-a="adm-rename">Rename</button></div></div>
      <div class="field"><label for="admCash">Set cash balance to (the difference counts as money added or withdrawn)</label><div class="inline"><input id="admCash" type="number" step="any" value="${num(p.cash)}"><button data-a="adm-setcash">Set cash</button></div></div>
      <div class="field"><label for="admStart">Wipe everything in this portfolio and restart with cash of</label><div class="inline"><input id="admStart" type="number" step="any" value="100000"><button data-a="adm-reset">Reset portfolio</button></div></div>
      <div class="inline" style="margin-top:8px"><button data-a="adm-clearreal">Zero realized P/L</button><button data-a="adm-clearhist">Clear activity and chart</button><button data-a="adm-delpf" ${DB.portfolios.length<2?"disabled":""}>Delete portfolio</button></div>
      <div class="inline" style="margin-top:8px"><button data-a="adm-resetall" class="sell">Erase all portfolios and settings</button></div></div>
    <div class="card"><h2 style="margin-bottom:6px">Positions in ${esc(p.name)}</h2>${posRows?`<div class="scroll"><table><tbody>${posRows}</tbody></table></div><p class="note">Deleting a position removes it with no cash change.</p>`:`<div class="empty">No open positions.</div>`}</div>
    </div><div>
    <div class="card"><h2>Prices</h2><p class="note">Type a price to override a quote, for example futures when you are not inside claude.ai. It stays until the next successful refresh.</p>
      <div class="scroll"><table><tbody>${priceRows}</tbody></table></div></div>
    <div class="card"><h2>Data and sync</h2>
      <h3>Market data key (optional)</h3>
      <div class="inline"><input id="tdKey" type="password" placeholder="Twelve Data API key" value="${esc(DB.settings.tdKey)}" style="flex:1"><button data-a="savekey">Save</button></div>
      <p class="note">A free key from twelvedata.com enables stock search, price history charts and live quotes outside claude.ai. It stays in this browser and is never exported. The free plan allows 8 quotes a minute, so large refreshes pause between batches.</p>
      <h3>Backup as JSON</h3>
      <div class="inline"><button data-a="export">Show JSON</button><button data-a="download">Download file</button><button data-a="import">Import from box</button></div>
      <textarea id="dataBox" placeholder="Export fills this box. Paste JSON here and press Import to restore." spellcheck="false"></textarea>
      <h3>Sync to GitHub</h3>
      <div class="grid2b" style="gap:8px">
        <input id="ghOwner" placeholder="GitHub username" value="${esc(g.owner)}"><input id="ghRepo" placeholder="Repository" value="${esc(g.repo)}">
        <input id="ghPath" placeholder="File path" value="${esc(g.path)}"><input id="ghBranch" placeholder="Branch" value="${esc(g.branch)}"></div>
      <input id="ghToken" type="password" placeholder="Fine-grained token (Contents: read and write on that repo only)" value="${esc(g.token)}" style="width:100%;margin-top:8px">
      <div class="inline" style="margin-top:8px"><button data-a="ghsave">Save settings</button><button class="primary" data-a="ghpush">Push to GitHub</button><button data-a="ghpull">Pull from GitHub</button></div>
      <div id="ghMsg" class="muted" style="font-size:13px;margin-top:6px"></div>
      <p class="note">Push writes your data (without keys or token) to that file in your repo. Use a private repo for the data, since a public repo would show your portfolio to everyone. This button only works from a normal web page such as GitHub Pages, not inside claude.ai.</p></div>
    </div></div>`;
}
function renderView(){
  document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("on",b.dataset.t===tab));
  const v={search:viewSearch,markets:viewMarkets,options:viewOptions,futures:viewFutures,portfolio:viewPortfolio,activity:viewActivity,admin:viewAdmin}[tab];
  el("view").innerHTML=v();
}
function render(){ renderHeader(); renderHero(); renderView(); }

/* ================= modals ================= */
function payoffSvg(type,K,prem,sp,side){
  const w=340,h=160,pad=22, lo=sp*0.75, hi=sp*1.25, N=40, s=side==="buy"?1:-1, pts=[];
  for(let i=0;i<=N;i++){const x=lo+(hi-lo)*i/N; pts.push([x,s*((type==="C"?Math.max(0,x-K):Math.max(0,K-x))-prem)*100]);}
  const ys=pts.map(p=>p[1]), mn=Math.min(...ys,0), mx=Math.max(...ys,0), rg=(mx-mn)||1;
  const X=x=>pad+(x-lo)/(hi-lo)*(w-2*pad), Y=y=>h-pad-(y-mn)/rg*(h-2*pad), be=type==="C"?K+prem:K-prem;
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Profit or loss at expiry by stock price">
    <line class="axis" x1="${pad}" x2="${w-pad}" y1="${Y(0)}" y2="${Y(0)}"/><line class="guide" x1="${X(sp)}" x2="${X(sp)}" y1="${pad-8}" y2="${h-pad}"/>
    <polyline class="ln" points="${pts.map(p=>X(p[0]).toFixed(1)+","+Y(p[1]).toFixed(1)).join(" ")}"/>
    <text x="${X(sp)+3}" y="${pad-1}">now ${usd(sp,0)}</text><text x="${pad}" y="${h-6}">${usd(lo,0)}</text><text x="${w-pad}" y="${h-6}" text-anchor="end">${usd(hi,0)}</text>
    ${be>lo&&be<hi?`<circle cx="${X(be)}" cy="${Y(0)}" r="3.5" style="fill:var(--accent)"/><text x="${X(be)}" y="${Y(0)-7}" text-anchor="middle">break-even ${usd(be)}</text>`:""}</svg>`;
}
function openModal(m){ M=m; drawModal(); }
function closeModal(){ M=null; el("modalRoot").innerHTML=""; }
function instTitle(i){ return i.k==="opt"?optLabel(i):i.k==="fut"?`${i.sym} futures · ${FUT[i.sym].n}`:`${i.sym} ${nameOf(i.sym)}`; }
function drawModal(){
  if(!M){ el("modalRoot").innerHTML=""; return; }
  let body="";
  if(M.kind==="wallet"){
    body=`<h2>Paper wallet · ${esc(P().name)}</h2><div class="muted">Cash: ${usd(P().cash)}. Practice money only.</div>
      <div class="seg"><button class="${M.mode==="add"?"on b":""}" data-a="wmode" data-m="add">Add money</button><button class="${M.mode==="out"?"on s":""}" data-a="wmode" data-m="out">Withdraw</button></div>
      <div class="chips">${[1000,10000,100000,1000000].map(v=>`<button class="sm" data-a="chip" data-v="${v}">${usd(v,0)}</button>`).join("")}</div>
      <div class="field"><label for="minput">Amount (USD)</label><input id="minput" type="number" min="0" step="any" inputmode="decimal"></div>
      <div class="err" id="merr"></div><div class="row" style="justify-content:flex-end"><button data-a="mclose">Cancel</button><button class="primary" data-a="mconfirm">${M.mode==="add"?"Add to wallet":"Withdraw"}</button></div>`;
  } else if(M.kind==="newpf"){
    body=`<h2>New portfolio</h2><div class="muted">Each portfolio has its own cash, positions and P/L. Prices are shared.</div>
      <div class="field"><label for="pfName">Name</label><input id="pfName" placeholder="e.g. Options experiments"></div>
      <div class="field"><label for="minput">Starting cash (USD, can be 0)</label><input id="minput" type="number" min="0" step="any" value="100000"></div>
      <div class="err" id="merr"></div><div class="row" style="justify-content:flex-end"><button data-a="mclose">Cancel</button><button class="primary" data-a="mconfirm">Create</button></div>`;
  } else if(M.kind==="ticket"){
    const i=M.inst, px=i.k==="opt"?optQuote(i.sym,i.type,i.strike,i.expiry):null, pr=i.k==="opt"?(px?(M.side==="buy"?px.ask:px.bid):0):price(i.sym);
    const unit=i.k==="opt"?"contracts":i.k==="fut"?"contracts":"shares (fractions allowed)";
    body=`<h2>${esc(instTitle(i))}</h2><div class="muted">${i.k==="opt"?(M.side==="buy"?"Buy at the ask ":"Sell at the bid ")+usd(pr)+" per share ("+usd(pr*100)+" per contract)":usd(pr)+(i.k==="fut"?" · "+usd(FUT[i.sym].m,0)+" per point · margin ≈ "+usd(FUT[i.sym].mg,0)+" per contract":" per share")}${i.k!=="opt"?srcTag(DB.quotes[i.sym]):""}</div>
      <div class="seg"><button class="${M.side==="buy"?"on b":""}" data-a="smode" data-m="buy">Buy</button><button class="${M.side==="sell"?"on s":""}" data-a="smode" data-m="sell">Sell${i.k==="stock"?" / Short":""}</button></div>
      ${i.k==="opt"?`<div style="margin:6px 0">${payoffSvg(i.type,i.strike,pr,price(i.sym),M.side)}</div><div class="muted" style="font-size:13px">Profit or loss per contract at expiry, by where the stock finishes.</div>`:""}
      <div class="field"><label for="minput">Quantity (${unit})</label><input id="minput" type="number" min="0" step="${i.k==="stock"?"any":"1"}" value="${M.prefill||(i.k==="stock"?"":"1")}"></div>
      <div class="sumlist" id="msum"></div><div class="err" id="merr"></div>
      <div class="row" style="justify-content:flex-end"><button data-a="mclose">Cancel</button><button class="primary" data-a="mconfirm">Place order</button></div>`;
  }
  el("modalRoot").innerHTML=`<div class="overlay" data-a="overlay"><div class="modal" role="dialog" aria-modal="true">${body}</div></div>`;
  const inp=el("minput"); if(inp){ inp.addEventListener("input",modalSummary); inp.addEventListener("keydown",e=>{if(e.key==="Enter")confirmModal();}); }
  (el("pfName")||inp)&&(el("pfName")||inp).focus(); modalSummary();
}
function modalSummary(){
  const box=el("msum"); if(!box||!M||M.kind!=="ticket") return;
  const v=parseFloat(el("minput").value)||0; if(!(v>0)){ box.innerHTML=`<div><span class="muted">Enter a quantity to see the effect of this order.</span></div>`; return; }
  const i=M.inst, d=M.side==="buy"?v:-v, q0=heldQty(P(),i), r=previewTrade(i,d);
  let pr=price(i.sym); if(i.k==="opt"){ const q=optQuote(i.sym,i.type,i.strike,i.expiry); pr=q?(d>0?q.ask:q.bid):0; }
  const value=v*pr*KIND_MULT(i);
  let rows=`<div><span>${i.k==="fut"?"Contract value (notional)":"Order value"}</span><b>${usd(value)}</b></div><div><span>Effect</span><span style="text-align:right">${describe(q0,d)}</span></div>`;
  if(!r.err){ rows+=`<div><span>Realized P/L on this order</span><span class="${cls(r.dReal)}">${sgn(r.dReal)}</span></div><div><span>Buying power after</span><span>${usd(r.a.bp)}</span></div>`; }
  else rows+=`<div><span class="loss">${esc(r.err)}</span></div>`;
  if(i.k==="opt"&&d<0&&q0<=0) rows+=`<div><span class="muted">Writing options: ${i.type==="C"?"loss is unlimited if the stock rallies":"loss is large if the stock falls toward zero"}. Margin is held.</span></div>`;
  box.innerHTML=rows;
}
function confirmModal(){
  if(!M) return; let err=null;
  if(M.kind==="newpf"){
    const name=(el("pfName").value||"").trim()||("Portfolio "+(DB.portfolios.length+1)), cash=parseFloat(el("minput").value)||0, p=blankPortfolio(DB.nextId++,name,cash);
    DB.portfolios.push(p); DB.activeId=p.id; snapshot(); save(); closeModal(); render(); return;
  }
  const v=parseFloat(el("minput").value); if(!(v>0)){ el("merr").textContent="Enter a number greater than zero."; return; }
  const p=P();
  if(M.kind==="wallet"){
    if(M.mode==="add"){ p.cash+=v; p.deposits+=v; log(p,"Added paper money",v); }
    else if(v>acct(p).bp+1e-9) err="You can withdraw up to "+usd(Math.max(0,acct(p).bp))+" (cash not held as margin).";
    else { p.cash-=v; p.deposits-=v; log(p,"Withdrew paper money",-v); }
    if(!err){ snapshot(); save(); }
  } else if(M.kind==="ticket"){ err=commitTrade(M.inst, M.side==="buy"?v:-v); }
  if(err){ el("merr").textContent=err; return; }
  closeModal(); render();
}

/* ================= admin helpers ================= */
function confirmClick(btn,key,label){
  if(armedKey===key) { armedKey=null; clearTimeout(armedTimer); return true; }
  armedKey=key; btn.dataset.orig=btn.textContent; btn.textContent=label; btn.classList.add("sell");
  clearTimeout(armedTimer); armedTimer=setTimeout(()=>{ armedKey=null; btn.textContent=btn.dataset.orig; btn.classList.remove("sell"); },5000);
  return false;
}
function ghHeaders(){ return {Authorization:"Bearer "+DB.settings.gh.token, Accept:"application/vnd.github+json"}; }
function ghUrl(){ const g=DB.settings.gh; return `https://api.github.com/repos/${g.owner}/${g.repo}/contents/${g.path}`; }
function ghMsg(t){ const m=el("ghMsg"); if(m) m.textContent=t; }
async function ghPush(){
  const g=DB.settings.gh; if(!g.owner||!g.repo||!g.token){ ghMsg("Fill in username, repository and token, then save settings."); return; }
  ghMsg("Pushing...");
  try{
    const r=await fetch(ghUrl()+"?ref="+encodeURIComponent(g.branch),{headers:ghHeaders()}); let sha;
    if(r.ok) sha=(await r.json()).sha; else if(r.status!==404) throw new Error("GitHub said "+r.status);
    const put=await fetch(ghUrl(),{method:"PUT",headers:ghHeaders(),body:JSON.stringify({message:"Paper Desk data "+new Date().toISOString(),content:btoa(unescape(encodeURIComponent(exportJSON()))),branch:g.branch,sha})});
    if(!put.ok) throw new Error("GitHub said "+put.status+" "+((await put.json()).message||""));
    ghMsg("Pushed at "+new Date().toLocaleTimeString()+".");
  }catch(e){ ghMsg("Push failed: "+e.message+" (this works only from a normal web page, not inside claude.ai)"); }
}
async function ghPull(btn){
  const g=DB.settings.gh; if(!g.owner||!g.repo||!g.token){ ghMsg("Fill in username, repository and token, then save settings."); return; }
  if(!confirmClick(btn,"ghpull","Click again to replace local data")) return;
  ghMsg("Pulling...");
  try{
    const r=await fetch(ghUrl()+"?ref="+encodeURIComponent(g.branch),{headers:ghHeaders()});
    if(!r.ok) throw new Error("GitHub said "+r.status);
    const j=await r.json(); importJSON(decodeURIComponent(escape(atob(j.content.replace(/\n/g,"")))));
    ghMsg("Pulled and loaded.");
  }catch(e){ ghMsg("Pull failed: "+e.message); }
}
function importJSON(text){
  const o=JSON.parse(text); if(!o||!Array.isArray(o.portfolios)) throw new Error("Not a Paper Desk backup");
  const keep=DB.settings; DB=mergeLoaded(o); DB.settings=keep; save(); render();
}

/* ================= events ================= */
document.addEventListener("click",e=>{
  const t=e.target.closest("[data-a]"); if(!t) return; const a=t.dataset.a, d=t.dataset, p=P();
  if(a==="overlay"){ if(e.target===t) closeModal(); return; }
  if(a==="tab"){ tab=d.t; renderView(); }
  else if(a==="refresh") refreshQuotes();
  else if(a==="wallet") openModal({kind:"wallet",mode:"add"});
  else if(a==="newpf") openModal({kind:"newpf"});
  else if(a==="wmode"){ M.mode=d.m; drawModal(); }
  else if(a==="chip") el("minput").value=d.v;
  else if(a==="trade") openModal({kind:"ticket",inst:{k:"stock",sym:d.s},side:d.side});
  else if(a==="ftrade") openModal({kind:"ticket",inst:{k:"fut",sym:d.s},side:d.side});
  else if(a==="otrade") openModal({kind:"ticket",inst:{k:"opt",sym:optSym,type:d.type,strike:parseFloat(d.strike),expiry:optExp},side:d.side});
  else if(a==="close"){
    if(d.k==="stock"){ const q=p.positions[d.s].qty; openModal({kind:"ticket",inst:{k:"stock",sym:d.s},side:q>0?"sell":"buy",prefill:String(Math.abs(q))}); }
    else if(d.k==="fut"){ const f=p.futures.find(x=>x.sym===d.s); openModal({kind:"ticket",inst:{k:"fut",sym:d.s},side:f.qty>0?"sell":"buy",prefill:String(Math.abs(f.qty))}); }
    else { const o=p.options.find(x=>x.id===parseInt(d.id)); openModal({kind:"ticket",inst:{k:"opt",sym:o.sym,type:o.type,strike:o.strike,expiry:o.expiry},side:o.qty>0?"sell":"buy",prefill:String(Math.abs(o.qty))}); }
  }
  else if(a==="smode"){ M.side=d.m; M.prefill=el("minput")?el("minput").value:""; drawModal(); }
  else if(a==="toopt"){ optSym=d.s; tab="options"; renderView(); }
  else if(a==="mclose") closeModal();
  else if(a==="mconfirm") confirmModal();
  else if(a==="unwatch"){ DB.watch=DB.watch.filter(s=>s!==d.s); save(); renderView(); }
  else if(a==="watch"){ if(!DB.watch.includes(d.s)) DB.watch.push(d.s); save(); renderView(); }
  else if(a==="addsym") addSymbol();
  else if(a==="search") doSearch();
  else if(a==="inst") openInstrument(d.s);
  else if(a==="range"){ INST.range=d.r; renderView(); }
  else if(a==="switch"){ DB.activeId=parseInt(d.id); save(); render(); }
  else if(a==="adm-rename"){ const n=(el("admName").value||"").trim(); if(n){ p.name=n; save(); render(); } }
  else if(a==="adm-setcash"){ const v=parseFloat(el("admCash").value); if(isFinite(v)&&v>=0){ const df=v-p.cash; p.cash=v; p.deposits+=df; log(p,"Admin: cash set to "+usd(v),df); snapshot(); save(); render(); } }
  else if(a==="adm-reset"){ if(!confirmClick(t,"reset","Click again to wipe this portfolio")) return; const v=Math.max(0,parseFloat(el("admStart").value)||0); Object.assign(p,blankPortfolio(p.id,p.name,v)); snapshot(); save(); render(); }
  else if(a==="adm-clearreal"){ p.realized=0; save(); render(); }
  else if(a==="adm-clearhist"){ if(!confirmClick(t,"clearhist","Click again to confirm")) return; p.trades=[]; p.history=[]; save(); render(); }
  else if(a==="adm-delpf"){ if(!confirmClick(t,"delpf","Click again to delete")) return; DB.portfolios=DB.portfolios.filter(x=>x.id!==p.id); DB.activeId=DB.portfolios[0].id; save(); render(); }
  else if(a==="adm-resetall"){ if(!confirmClick(t,"resetall","Click again to erase everything")) return; const k=DB.settings; DB=freshDB(); DB.settings=k; save(); render(); }
  else if(a==="delpos"){
    if(d.k==="stock") delete p.positions[d.id]; else if(d.k==="opt") p.options=p.options.filter(x=>x.id!==parseInt(d.id)); else p.futures=p.futures.filter(x=>x.id!==parseInt(d.id));
    snapshot(); save(); render();
  }
  else if(a==="savekey"){ DB.settings.tdKey=el("tdKey").value.trim(); save(); setStatus(DB.settings.tdKey?"Key saved. Press Refresh prices.":"Key removed."); }
  else if(a==="export"){ el("dataBox").value=exportJSON(); }
  else if(a==="download"){ const b=new Blob([exportJSON()],{type:"application/json"}), u=URL.createObjectURL(b), l=document.createElement("a"); l.href=u; l.download="portfolio-data.json"; l.click(); setTimeout(()=>URL.revokeObjectURL(u),2000); el("dataBox").value=exportJSON(); }
  else if(a==="import"){ if(!confirmClick(t,"import","Click again to replace local data")) return; try{ importJSON(el("dataBox").value); }catch(err){ setStatus("Import failed: "+err.message); } }
  else if(a==="ghsave"){ const g=DB.settings.gh; g.owner=el("ghOwner").value.trim(); g.repo=el("ghRepo").value.trim(); g.path=el("ghPath").value.trim()||"portfolio-data.json"; g.branch=el("ghBranch").value.trim()||"main"; g.token=el("ghToken").value.trim(); save(); ghMsg("Saved."); }
  else if(a==="ghpush"){ ghPush(); }
  else if(a==="ghpull"){ ghPull(t); }
});
document.addEventListener("change",e=>{
  const t=e.target;
  if(t.id==="optSym"){ optSym=t.value; renderView(); }
  else if(t.id==="optExp"){ optExp=t.value; renderView(); }
  else if(t.id==="optIv"){ const v=parseFloat(t.value); if(v>=5&&v<=300){ DB.iv[optSym]=v/100; save(); render(); } }
  else if(t.id==="pfSel"){ DB.activeId=parseInt(t.value); save(); render(); }
  else if(t.classList&&t.classList.contains("pxo")){ const v=parseFloat(t.value); if(v>0){ const q=DB.quotes[t.dataset.s]; DB.quotes[t.dataset.s]={price:v,prev:q?q.prev:v,src:"manual",asOf:""}; save(); render(); } }
});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&M) closeModal();
  if(e.key==="Enter"&&e.target.id==="addSym") addSymbol();
  if(e.key==="Enter"&&e.target.id==="sq") doSearch();
});
document.addEventListener("pointermove",e=>{
  const s=e.target.closest&&e.target.closest("#hchart"); if(!s||!INST||!INST.pts) return;
  const r=s.getBoundingClientRect(), w=640, pad=34, n=INST.pts.length, x=(e.clientX-r.left)/r.width*w;
  const i=Math.max(0,Math.min(n-1,Math.round((x-pad)/(w-2*pad)*(n-1)))), px=pad+i/(n-1)*(w-2*pad), hl=el("hl");
  hl.setAttribute("x1",px); hl.setAttribute("x2",px); hl.setAttribute("visibility","visible");
  el("ht").textContent=`${INST.sym}  ${INST.pts[i].d}  ${usd(INST.pts[i].c)}`;
});
function addSymbol(){
  const s=(el("addSym").value||"").trim().toUpperCase();
  if(!/^[A-Z][A-Z.\-]{0,5}$/.test(s)){ setStatus("Enter a valid US ticker symbol."); return; }
  if(!DB.watch.includes(s)) DB.watch.push(s); save(); renderView(); refreshQuotes([s]);
}

/* ================= start ================= */
(async function init(){ await load(); render(); refreshQuotes(); })();
