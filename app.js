// ══════════════════════════════════════════════════════════════════════════
// THEME
// ══════════════════════════════════════════════════════════════════════════

// ── OFFLINE WRITE QUEUE ──────────────────────────────────────────────────
// Queues Firestore writes when offline; retries automatically on reconnect.
const OQ_KEY='sw3_offline_queue';
function oqGet(){return cGet(OQ_KEY)||[];}
function oqAdd(collection,docId,data,merge=true){
  const q=oqGet();
  q.push({collection,docId,data,merge,ts:Date.now()});
  cSet(OQ_KEY,q);
  setSyncStatus('offline');
}
async function oqFlush(){
  const q=oqGet();
  if(!q.length) return;
  const remaining=[];
  for(const op of q){
    try{
      const ref=db.collection(op.collection).doc(op.docId);
      if(op.merge) await ref.set(op.data,{merge:true});
      else await ref.set(op.data);
    }catch(e){remaining.push(op);}
  }
  cSet(OQ_KEY,remaining);
  if(!remaining.length){setSyncStatus('synced');toast('Offline saves synced ✓');}
}
// Listen for connectivity restoration
window.addEventListener('online',()=>{
  if(db){oqFlush();_rippleQueueFlush();}
});

function toggleTheme(){
  const ic=document.getElementById('theme-icon');
  // switching: if currently light → going dark; if dark → going light
  const goingDark=document.body.classList.contains('light');
  if(ic) ic.textContent=goingDark?'🌙':'☀️';
  const isLight=document.body.classList.toggle('light');
  try{localStorage.setItem('sw3_theme',isLight?'light':'dark');}catch{}
}
(function initTheme(){
  try{
    const saved=localStorage.getItem('sw3_theme');
    if(saved){
      if(saved==='light') document.body.classList.add('light');
    } else {
      // No saved preference — follow system
      if(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches){
        document.body.classList.add('light');
      }
    }
    // Keep in sync with system changes (only when user hasn't overridden)
    if(window.matchMedia){
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change',e=>{
        if(!localStorage.getItem('sw3_theme')){
          if(e.matches) document.body.classList.add('light');
          else document.body.classList.remove('light');
          const ic=document.getElementById('theme-icon');
          if(ic) ic.textContent=e.matches?'☀️':'🌙';
        }
      });
    }
  }catch{}
})();

// ── DESIGN MODE (Classic | Monarch) ─────────────────────────────────────────
// Cosmetic only. Monarch adds body.monarch, which activates the scoped token
// blocks at the bottom of styles.css plus a few render flourishes (icon
// badges, hero chart, grouped budget). Classic is the default and its CSS
// token blocks are untouched when the flag is off. Data and features are
// identical in both modes.
function getDesignMode(){try{return localStorage.getItem('sw3_design_mode')==='monarch'?'monarch':'classic';}catch{return 'classic';}}
function isMonarch(){return document.body.classList.contains('monarch');}
function setDesignMode(mode){
  try{localStorage.setItem('sw3_design_mode',mode);}catch{}
  document.body.classList.toggle('monarch',mode==='monarch');
  try{renderAll();}catch{}
  toast(mode==='monarch'?'Monarch design mode':'Classic design mode');
}
(function initDesignMode(){try{if(getDesignMode()==='monarch')document.body.classList.add('monarch');}catch{}})();

// ══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════════════
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
const MS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Categories with their expense lines from Excel
const CAT_LINES = {
  'Utilities': ['Power'],
  'Fuel': ['Gas','Fuel - Old Ford','Fuel - Ford'],
  'Car maintenance': ['Ford maintenance','Old Ford maintenance','Vehicle papers renewal'],
  'Itunu': ['Itunu'],
  'Domestic': ['Car purchase','Car wash','Service charge','Laundry','Home repairs','Rent','Temu','Cleaner'],
  'Food': ['Lunch','Eat out'],
  'Groceries': ['Ozzy shopping','Super Saver','Globus','Spar','Ebeano','Blenco','Sinomart','Cash groceries','Other groceries'],
  'Kids': ["Fife's school fees","Fife's (Other)","Fife's Bday"],
  'Internet services': ['Netflix/Amazon','Internet +Airtime'],
  'Recreation': ['UK Visa','DSTV','Outing','Outing BDG'],
  'Personal care': ['Medications','Personal care'],
  'Gifts and donations': ['Mama','Mum','Pentho','Pego','Dunsin','Gbago Day','Jennifer','Gbago','Tadeyon','Senapon Whesu','Mausi Whesu','Cash gifts','Baba Sesi','Athingban','Segowe','Sejiro','Yemi','Tope','Francis','MBO',"Dad's Bday","JO's Bday","Kola's Wedding","Olamide's wedding",'Pirotress','Xmas Gifts','Xmas gift (Gatemen)','Others'],
  'Loans': ['Semasa','Gbewato','Morin','House of Mayrie','Mauton','Tobi Talia','Jennifer','Maugbe'],
  'Others': ['Cash Withdrawal','Others'],
  'Work Travel': ['Home-MMIA','MMIA - Home','Westgate','Westgate - RB','LC Waikiki','RB - The View','Java House','RB - Westgate (Jen)','RB - Pizza Garden (all)','Pizza Garden (All)','Mall to RB (FJ)','RB to Mercure (JO)','RB to Riverside (JO)','Radisson - Address (All)','Address -Radisson (All)','Riverside - Marriot (All)'],
  'Education': ['Tuition','School fees'],
};
const _BASE_CATS = Object.keys(CAT_LINES);
// getCustomCats is safe to call any time — reads localStorage directly, no dependency on cGet/S
function getCustomCats(){try{const v=localStorage.getItem('sw3_custom_cats');return v?JSON.parse(v):[];}catch{return[];}}
function saveCustomCats(arr){
  try{localStorage.setItem('sw3_custom_cats',JSON.stringify(arr));}catch{}
  if(db)db.collection('appConfig').doc('customCats')
    .set({cats:arr,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true})
    .catch(e=>console.warn('customCats sync failed',e));
}
// Every loadX() below deliberately swallows its own error rather than throwing,
// so that one failed Firestore read cannot reject syncAll()'s Promise.all and
// leave the entire app unsynced. That part is intentional — keep it.
//
// What was NOT intentional: swallowing them *silently*. A failed read was
// indistinguishable from a successful one, so the header could show a green
// "Synced" while the app quietly served stale cached data, with nothing in the
// console to say so. That is the same class of bug as _pushDeviceNotifs's empty
// catch, which hid broken mobile notifications indefinitely. Log, don't vanish.
function _warnLoad(what,e){ console.warn(`[sync] ${what} failed — keeping cached data:`,e); }

async function loadCustomCats(){
  if(!db) return;
  try{
    const doc=await db.collection('appConfig').doc('customCats').get();
    const arr=doc.exists?doc.data()?.cats:null;
    if(Array.isArray(arr)){try{localStorage.setItem('sw3_custom_cats',JSON.stringify(arr));}catch{}}
  }catch(e){_warnLoad('loadCustomCats',e);}
}
function getAllCats(){return[..._BASE_CATS,...getCustomCats().filter(c=>!_BASE_CATS.includes(c))];}
// CATS: evaluated lazily after full script init via getter so cGet is always available
const CATS = _BASE_CATS; // static fallback — always use getAllCats() in render functions

// ── ICONS ──────────────────────────────────────────────────────────────────
const CAT_ICONS = {
  'Utilities':          '💡',
  'Fuel':               '⛽',
  'Car maintenance':    '🔧',
  'Itunu':              '👤',
  'Domestic':           '🏠',
  'Food':               '🍽️',
  'Groceries':          '🛒',
  'Kids':               '🧒',
  'Internet services':  '📡',
  'Recreation':         '🎬',
  'Personal care':      '💊',
  'Gifts and donations':'🎁',
  'Loans':              '🤝',
  'Others':             '📦',
  'Work Travel':        '✈️',
  'Education':          '📚',
};

// Circular tinted icon badge (Monarch mode only — call sites branch on
// isMonarch(); Classic keeps its original plain-emoji markup untouched).
const _CATB_PALETTE=['#0e9384','#e04f16','#444ce7','#ba24d5','#0086c9','#e31b54','#099250','#dc6803','#6938ef','#088ab2'];
function catColor(cat){let h=0;const s=String(cat||'');for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return _CATB_PALETTE[h%_CATB_PALETTE.length];}
function catBadge(cat){return`<span class="catb" style="--catbg:${catColor(cat)}26">${CAT_ICONS[cat]||'📦'}</span>`;}

// ── GITHUB-HOSTED LOGOS ────────────────────────────────────────────────────
// Upload logo files to the Logos/ folder in your GitHub repo.
// Filename must match exactly what you enter in the settings (case-sensitive).
const LOGOS_BASE_URL='https://raw.githubusercontent.com/SSSeyon/spendwise/main/Logos/';
function getCashLogos(){return cGet('sw3_cash_logos')||{};}
function setCashLogo(acctName,filename){
  const m=getCashLogos();
  if(filename) m[acctName]=filename.trim();
  else delete m[acctName];
  cSet('sw3_cash_logos',m);
  // Mirror to Firestore — use {merge:true} so concurrent per-account writes don't
  // erase each other (each call only changes the one field that changed).
  if(db){
    const payload=filename?{[acctName]:filename.trim()}:{[acctName]:firebase.firestore.FieldValue.delete()};
    db.collection('appConfig').doc('cashLogos').set(payload,{merge:true}).catch(()=>{});
  }
  // Update the thumbnail in the settings list immediately without re-rendering the page.
  const safeId=acctName.replace(/\s/g,'-');
  const th=document.getElementById('cash-logo-th-'+safeId);
  if(th) th.innerHTML=bankLogoEl(acctName,20);
}
function _logoFallbackBank(el,name,size){
  const initials=name.slice(0,2).toUpperCase();
  const d=document.createElement('div');
  d.style.cssText=`width:${size}px;height:${size}px;border-radius:4px;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:${Math.round(size*0.45)}px;font-weight:700;color:var(--text2);flex-shrink:0`;
  d.textContent=initials;el.parentNode.replaceChild(d,el);
}
function _logoFallbackPlatform(el,color,size){
  const d=document.createElement('div');
  d.style.cssText=`width:${size}px;height:${size}px;border-radius:50%;background:${color};opacity:0.85;flex-shrink:0`;
  el.parentNode.replaceChild(d,el);
}
function bankLogoEl(name,size=20){
  const file=getCashLogos()[name]||'';
  const initials=name.slice(0,2).toUpperCase();
  if(!file) return `<div style="width:${size}px;height:${size}px;border-radius:4px;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:${Math.round(size*0.45)}px;font-weight:700;color:var(--text2);flex-shrink:0">${initials}</div>`;
  const url=LOGOS_BASE_URL+encodeURIComponent(file);
  return `<img src="${url}" width="${size}" height="${size}" style="border-radius:4px;object-fit:contain;background:#fff;flex-shrink:0" onerror="_logoFallbackBank(this,'${name}',${size})">`;
}
function platformLogoEl(key,color,size=20){
  const plat=getPlatforms().find(p=>p.key===key);
  const file=plat?.logo||'';
  if(!file) return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};opacity:0.85;flex-shrink:0"></div>`;
  const url=LOGOS_BASE_URL+encodeURIComponent(file);
  return `<img src="${url}" width="${size}" height="${size}" style="border-radius:50%;object-fit:contain;background:#fff;flex-shrink:0" onerror="_logoFallbackPlatform(this,'${color}',${size})">`;
}

const DEFAULT_CASH_ACCOUNTS = ['GTB','Access','Renmoney','USD Cash'];
const USD_CASH_ACCOUNTS = ['USD Cash']; // cash accounts denominated in USD
function isUSDCashAccount(name){return USD_CASH_ACCOUNTS.includes(name);}
function cashTotalNGN(cashObj,m,y){const r=getFxRates(m||S.expMonth,y||S.expYear);return getCashAccounts().reduce((s,b)=>{const v=(cashObj||S.cash)[b]||0;return s+(isUSDCashAccount(b)?v*(r.USD||1650):v);},0);}
function getCashAccounts(){const saved=cGet('sw3_cash_accounts');if(!saved)return DEFAULT_CASH_ACCOUNTS;const merged=[...DEFAULT_CASH_ACCOUNTS];saved.forEach(a=>{if(!merged.includes(a))merged.push(a);});return merged;}
// Persist the custom-account list locally AND to Firestore so it syncs across devices.
// Only the non-default (custom) accounts are stored, matching the localStorage shape.
function setCashAccounts(allAccounts){
  const custom=allAccounts.filter(a=>!DEFAULT_CASH_ACCOUNTS.includes(a));
  cSet('sw3_cash_accounts',custom);
  if(db) db.collection('appConfig').doc('cashAccounts').set({accounts:custom},{merge:false}).catch(()=>{});
}
async function loadFxOverrides(){
  if(!db) return;
  try{
    const doc=await db.collection('appConfig').doc('fxOverrides').get();
    if(doc.exists&&doc.data()?.overrides){
      cSet(FX_OVR_KEY,doc.data().overrides);
    }
  }catch(e){_warnLoad('loadFxOverrides',e);}
}
async function loadCashAccounts(){
  if(!db) return;
  try{
    const doc=await db.collection('appConfig').doc('cashAccounts').get();
    if(doc.exists&&Array.isArray(doc.data()?.accounts)){
      cSet('sw3_cash_accounts',doc.data().accounts);
    }
  }catch(e){_warnLoad('loadCashAccounts',e);}
}

// Build <option> HTML for cash accounts with balance shown in brackets
function cashOptsWithBal(addEmpty){
  const cash=S.cash||{};
  const opts=getCashAccounts().map(a=>{
    const v=cash[a];
    const balStr=v!=null?(isUSDCashAccount(a)?` ($${v.toFixed(2)})`:`  (${fN(Math.round(v))})`):'';
    return`<option value="${a}">${a}${balStr}</option>`;
  }).join('');
  return addEmpty?`<option value="">— Don't credit —</option>`+opts:opts;
}
// Build <option> HTML for investment platforms with current sub-principal total in brackets
function invOptsWithBal(){
  return PLATFORMS.map(p=>{
    const subs=getSubsForPlatform(p.key);
    const total=subs.reduce((s,sb)=>s+(sb.principal||0),0);
    const balStr=total?`  (${fN(Math.round(total))})`:'';
    return`<option value="${p.key}">${p.label}${balStr} (${p.currency})</option>`;
  }).join('');
}

// Budget rollover: when on, a month with no saved budget yet is pre-filled
// from the previous month's categories on load (see loadBudgets).
function getBudgetRollover(){try{return localStorage.getItem('sw3_budget_rollover')==='1';}catch{return false;}}
function setBudgetRollover(on){try{localStorage.setItem('sw3_budget_rollover',on?'1':'0');}catch{}}

const NW_CFG_KEY='sw3_nw_config';
function getNWConfig(){
  const saved=cGet(NW_CFG_KEY);
  if(saved) return saved;
  // Default: include everything
  return {
    includeInvestments:true,
    includeCash:true,
    includeDebtors:true,
    cashAccounts:getCashAccounts(), // all accounts by default
  };
}
function saveNWConfig(cfg){
  cSet(NW_CFG_KEY,cfg);
  if(db)db.collection('appConfig').doc('nwConfig')
    .set({cfg,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true})
    .catch(e=>console.warn('nwConfig sync failed',e));
}
async function loadNWConfig(){
  if(!db) return;
  try{
    const doc=await db.collection('appConfig').doc('nwConfig').get();
    if(doc.exists&&doc.data()?.cfg)cSet(NW_CFG_KEY,doc.data().cfg);
  }catch(e){_warnLoad('loadNWConfig',e);}
}


const PLATFORMS_DEFAULT = [
  {key:'Piggy',label:'Piggy',color:'#c8f542',currency:'NGN'},
  {key:'PiggySafelock',label:'Piggy Safelock',color:'#a8d430',currency:'NGN'},
  {key:'RenVault',label:'RenVault',color:'#4a8aee',currency:'NGN'},
  {key:'Risevest',label:'Risevest',color:'#f5c842',currency:'USD'},
  {key:'Trove',label:'Trove',color:'#ff9f5c',currency:'USD'},
  {key:'Bamboo',label:'Bamboo',color:'#ff5c9f',currency:'USD'},
];
const PLATFORMS_KEY='sw3_platforms';
function getPlatforms(){return cGet(PLATFORMS_KEY)||PLATFORMS_DEFAULT;}
function savePlatforms(arr){cSet(PLATFORMS_KEY,arr);_syncInvConfig();}
// PLATFORMS is populated lazily at first render via getPlatforms() — never call at module scope
let PLATFORMS=PLATFORMS_DEFAULT;

const DEF_RATES={NGN:1,USD:1600,GBP:2050};

// New feature keys
const INV_WD_KEY='sw3_inv_withdrawals';
const INV_MOVE_KEY='sw3_inv_movements'; // [{platformKey, delta(+dep/-wd), date, notes}] for withdrawal-aware accrual
const SAVINGS_TARGET_KEY='sw3_savings_target_pct';

// Investment asset class metadata (stored separately from balances)
// Keys: platformKey → {assetClass: 'equity'|'fixed_income', interestRate, compoundType: 'daily_compound'|'daily_accrual'}
const INV_META_KEY='sw3_inv_meta';
function getInvMeta(){return cGet(INV_META_KEY)||{};}
function saveInvMeta(meta){cSet(INV_META_KEY,meta);_syncInvConfig();}
function getInvPlatformMeta(key){return(getInvMeta()[key])||{assetClass:'equity'};}
function saveInvPlatformMeta(key,data){const m=getInvMeta();m[key]={...(m[key]||{}),...data};saveInvMeta(m);}

// ── Sub-investments ──────────────────────────────────────────────────────
const INV_SUBS_KEY='sw3_inv_subs';
function getInvSubs(){return cGet(INV_SUBS_KEY)||{};}
function saveInvSubs(subs){cSet(INV_SUBS_KEY,subs);_syncInvConfig();}
function getSubsForPlatform(pKey){return(getInvSubs()[pKey])||[];}
function saveSubsForPlatform(pKey,arr){const s=getInvSubs();s[pKey]=arr;saveInvSubs(s);}

// ── Sync all investment config to Firestore (debounced) ──────────────────
let _invConfigSyncTimer=null;
function _syncInvConfig(){
  clearTimeout(_invConfigSyncTimer);
  _invConfigSyncTimer=setTimeout(()=>{
    if(!db) return;
    const payload={
      platforms:getPlatforms(),
      invMeta:getInvMeta(),
      invSubs:getInvSubs(),
      updatedAt:firebase.firestore.FieldValue.serverTimestamp()
    };
    db.collection('appConfig').doc('investments').set(payload,{merge:true}).catch(e=>console.warn('invConfig sync failed',e));
  },800);
}

// ── Load investment config from Firestore (called at boot) ───────────────
async function loadCashLogos(){
  if(!db) return;
  try{
    const doc=await db.collection('appConfig').doc('cashLogos').get();
    if(doc.exists&&doc.data()){
      // Remote is the source of truth; merge so any offline-only entries survive
      const merged={...getCashLogos(),...doc.data()};
      cSet('sw3_cash_logos',merged);
    }
  }catch(e){_warnLoad('loadCashLogos',e);}
}
async function loadInvConfig(){
  if(!db) return;
  try{
    const doc=await db.collection('appConfig').doc('investments').get();
    if(!doc.exists) return;
    const d=doc.data();
    if(d.platforms&&d.platforms.length){cSet(PLATFORMS_KEY,d.platforms);}
    if(d.invMeta&&Object.keys(d.invMeta).length){cSet(INV_META_KEY,d.invMeta);}
    if(d.invSubs&&Object.keys(d.invSubs).length){cSet(INV_SUBS_KEY,d.invSubs);}
  }catch(e){console.warn('loadInvConfig failed',e);}
}

// Guards migrateToSubs' persistent write below. Set true once this session has
// actually loaded real invSubs/investments data from Firestore (see initFirebase).
// Without this gate, migrateToSubs ran on the very first synchronous render at
// boot — before Firestore had a chance to populate the cache — saw an empty
// subs array (because it hadn't loaded yet, not because it was genuinely
// empty), and PERSISTED a synthetic single "Investment 1" record (assetClass
// defaulted to 'equity', principal defaulted to 0) that overwrote the real,
// multi-entry sub-investment history in Firestore. Reads before the gate opens
// still return a synthetic in-memory record so the UI has something to show;
// they just don't persist it.
let _invMigrateGate=false;
function migrateToSubs(pKey){
  const existing=getSubsForPlatform(pKey);
  if(existing.length) return existing;
  const meta=getInvPlatformMeta(pKey);
  const principal=S.investments?.[pKey]||0;
  const sub={id:pKey+'_sub_1',label:'Investment 1',principal,
    assetClass:meta.assetClass||'equity',rate:meta.interestRate||'',
    compoundType:meta.compoundType||'daily_accrual',
    startDate:meta.startDate||'',maturityDate:meta.maturityDate||''};
  if(_invMigrateGate) saveSubsForPlatform(pKey,[sub]);
  return [sub];
}

function addPlatform(label,currency,color,logoFile){
  label=label.trim();if(!label) return toast('Enter a platform name');
  const key=label.replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_]/g,'');
  const plats=getPlatforms();
  if(plats.find(p=>p.key===key||p.label.toLowerCase()===label.toLowerCase())) return toast('Platform already exists');
  plats.push({key,label,color:color||'#c8f542',currency:currency||'NGN',logo:(logoFile||'').trim()});
  savePlatforms(plats);PLATFORMS=plats;
  toast(`Added "${label}"`);renderInvestments();renderDashboard();
}
function updatePlatLogo(key,filename){
  const plats=getPlatforms();
  const p=plats.find(x=>x.key===key);
  if(!p) return;
  p.logo=(filename||'').trim();
  savePlatforms(plats);PLATFORMS=plats;
  // Update every visible thumbnail for this platform immediately without re-rendering.
  document.querySelectorAll('[id^="inv-logo-th-'+key+'"]').forEach(th=>{th.innerHTML=platformLogoEl(key,p.color,26);});
}
function removePlatform(key){
  if(!confirm('Remove this investment platform? Its balance data will remain in history.')) return;
  const plats=getPlatforms().filter(p=>p.key!==key);
  savePlatforms(plats);PLATFORMS=plats;
  toast('Platform removed');renderInvestments();renderDashboard();
}

// Cash account interest metadata
// Keys: accountName → {interestRate, compoundType: 'daily_compound'}
const CASH_INT_KEY='sw3_cash_interest';
function getCashInterestMeta(){return cGet(CASH_INT_KEY)||{};}
function saveCashInterestMeta(meta){cSet(CASH_INT_KEY,meta);}

// ── Interest accrual helpers ───────────────────────────────────────────
// Computes simple daily or compound interest for a single segment.
// Returns interest in NGN (number).
function _calcSegmentInterest(principal, annualRatePct, compoundType, fromDate, toDate){
  if(!principal||!annualRatePct||!fromDate) return 0;
  const r=annualRatePct/100;
  const from=new Date(fromDate);from.setHours(0,0,0,0);
  const to=new Date(toDate);to.setHours(0,0,0,0);
  const days=Math.max(0,Math.round((to-from)/(1000*60*60*24)));
  if(!days) return 0;
  if(compoundType==='daily_compound') return principal*(Math.pow(1+r/365,days)-1);
  return principal*(r/365)*days; // daily_accrual: simple
}

// Withdrawal/deposit-aware interest calculation.
// Walks the timeline from startDate to today (capped at maturity), splitting at each
// movement date. `movements` is an array of {date:'YYYY-MM-DD', delta:Number} where
// delta is POSITIVE for deposits and NEGATIVE for withdrawals.
// The CURRENT principal is the end state; principal in earlier segments is reconstructed
// by removing the net movements that happened at/after each split point.
// daily_compound compounds within each segment and rolls the grown balance forward.
// Returns {interest, projectedBalance, daysAccrued, isMatured}
function calcInterestAccrual(principal, annualRatePct, compoundType, startDate, maturityDate, movements){
  if(!principal||!annualRatePct||!startDate) return {interest:0,projectedBalance:principal||0,daysAccrued:0,isMatured:false};
  const today=new Date();today.setHours(0,0,0,0);
  let effectiveTo=today;
  let isMatured=false;
  if(maturityDate){
    const mat=new Date(maturityDate);mat.setHours(0,0,0,0);
    if(mat<=today){effectiveTo=mat;isMatured=true;}
  }
  const start=new Date(startDate);start.setHours(0,0,0,0);
  const totalDays=Math.max(0,Math.round((effectiveTo-start)/86400000));
  if(totalDays<=0) return {interest:0,projectedBalance:Math.round(principal),daysAccrued:0,isMatured};

  const r=annualRatePct/100;
  const compound=compoundType==='daily_compound';

  // Build movement list within (startDate, effectiveTo], sorted ascending by date.
  const startStr=toLocalISO(start);
  const endStr=toLocalISO(effectiveTo);
  const mv=(movements||[])
    .filter(x=>x&&x.date&&x.delta&&x.date>startStr&&x.date<=endStr)
    .map(x=>({date:x.date,delta:x.delta}))
    .sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);

  // Reconstruct the principal at the START of the period (before any movements):
  //   principal_at_start = current_principal − sum(all deltas in window)
  const netDelta=mv.reduce((s,x)=>s+x.delta,0);
  let segPrincipal=principal-netDelta;
  if(segPrincipal<0) segPrincipal=0; // guard against inconsistent data

  // Build segment boundaries: startDate, each movement date, effectiveTo
  const boundaries=[startStr,...mv.map(x=>x.date),endStr];
  let totalInterest=0;
  for(let i=0;i<boundaries.length-1;i++){
    const segFrom=new Date(boundaries[i]);segFrom.setHours(0,0,0,0);
    const segTo=new Date(boundaries[i+1]);segTo.setHours(0,0,0,0);
    const segDays=Math.max(0,Math.round((segTo-segFrom)/86400000));
    if(segDays>0&&segPrincipal>0){
      if(compound){
        const grown=segPrincipal*Math.pow(1+r/365,segDays);
        totalInterest+=grown-segPrincipal;
        segPrincipal=grown; // roll grown balance forward (compounding)
      } else {
        totalInterest+=segPrincipal*(r/365)*segDays;
      }
    }
    // Apply the movement that occurs at boundaries[i+1] (deposit + / withdrawal −)
    if(i+1<boundaries.length-1){
      const moveDate=boundaries[i+1];
      const deltaAtDate=mv.filter(x=>x.date===moveDate).reduce((s,x)=>s+x.delta,0);
      segPrincipal+=deltaAtDate;
      if(segPrincipal<0) segPrincipal=0;
    }
  }

  return {
    interest:Math.round(totalInterest),
    projectedBalance:Math.round(principal+totalInterest),
    daysAccrued:totalDays,
    isMatured,
  };
}

// FX rates by month (USD/NGN and GBP/NGN averages)
const FX_RATES = {
  '2023-11':{USD:780,GBP:960},'2023-12':{USD:900,GBP:1110},
  '2024-01':{USD:1400,GBP:1760},'2024-02':{USD:1490,GBP:1880},'2024-03':{USD:1560,GBP:1970},
  '2024-04':{USD:1350,GBP:1700},'2024-05':{USD:1380,GBP:1740},'2024-06':{USD:1480,GBP:1880},
  '2024-07':{USD:1570,GBP:2020},'2024-08':{USD:1590,GBP:2050},'2024-09':{USD:1580,GBP:2040},
  '2024-10':{USD:1650,GBP:2130},'2024-11':{USD:1680,GBP:2160},'2024-12':{USD:1540,GBP:1950},
  '2025-01':{USD:1560,GBP:1960},'2025-02':{USD:1580,GBP:2000},'2025-03':{USD:1590,GBP:2020},
  '2025-04':{USD:1600,GBP:2040},'2025-05':{USD:1610,GBP:2050},'2025-06':{USD:1620,GBP:2060},
  '2025-07':{USD:1630,GBP:2070},'2025-08':{USD:1620,GBP:2060},'2025-09':{USD:1600,GBP:2040},
  '2025-10':{USD:1610,GBP:2050},'2025-11':{USD:1620,GBP:2060},'2025-12':{USD:1540,GBP:1950},
  '2026-01':{USD:1580,GBP:2010},'2026-02':{USD:1600,GBP:2030},'2026-03':{USD:1620,GBP:2060},
  '2026-04':{USD:1600,GBP:2040},'2026-05':{USD:1590,GBP:2020},
};

const DEF_BUDGETS={Utilities:90000,Fuel:150000,Carmaintenance:50000,Itunu:0,Domestic:200000,Food:150000,Groceries:400000,Kids:200000,Internetservices:50000,Recreation:100000,Personalcare:50000,Giftsanddonations:200000,Loans:0,Others:50000,WorkTravel:0,Education:0};
const FIXED_OBL=[{label:'Service Charge',amount:55000},{label:'Internet & Airtime',amount:30000},{label:'Power',amount:90000},{label:'Fuel',amount:150000}];
// School fees loaded from localStorage via seed JSON.
const SCHOOL_FEES_DEFAULT=[];

// ── SMART CATEGORISATION — payee keyword → category ──
const PAYEE_CAT_MAP=(()=>{const m={};Object.entries(CAT_LINES).forEach(([cat,lines])=>{lines.forEach(l=>{m[l.toLowerCase()]=cat;});});return m;})();
const PAYEE_KEYWORDS=[
  {kw:'spar',cat:'Groceries'},{kw:'ebeano',cat:'Groceries'},{kw:'blenco',cat:'Groceries'},{kw:'shoprite',cat:'Groceries'},{kw:'supermart',cat:'Groceries'},{kw:'market',cat:'Groceries'},
  {kw:'fuel',cat:'Fuel'},{kw:'petrol',cat:'Fuel'},{kw:'diesel',cat:'Fuel'},{kw:'gas',cat:'Fuel'},
  {kw:'netflix',cat:'Internet services'},{kw:'amazon',cat:'Internet services'},{kw:'airtime',cat:'Internet services'},{kw:'dstv',cat:'Recreation'},{kw:'gotv',cat:'Recreation'},
  {kw:'uber',cat:'Work Travel'},{kw:'bolt',cat:'Work Travel'},{kw:'taxi',cat:'Work Travel'},
  {kw:'pharmacy',cat:'Personal care'},{kw:'drug',cat:'Personal care'},{kw:'hospital',cat:'Personal care'},
  {kw:'school',cat:'Kids'},{kw:'tuition',cat:'Education'},{kw:'fees',cat:'Kids'},
  {kw:'rent',cat:'Domestic'},{kw:'laundry',cat:'Domestic'},{kw:'cleaner',cat:'Domestic'},
  {kw:'restaurant',cat:'Food'},{kw:'lunch',cat:'Food'},{kw:'dinner',cat:'Food'},{kw:'eat',cat:'Food'},
];
function smartCat(payee){
  if(!payee)return null;
  const lower=payee.toLowerCase().trim();
  if(PAYEE_CAT_MAP[lower])return PAYEE_CAT_MAP[lower];
  for(const{kw,cat}of PAYEE_KEYWORDS){if(lower.includes(kw))return cat;}
  return null;
}

// ── RECURRING ENGINE ──
const CK_RECUR='sw3_recurring';
function getRecurring(){return cGet(CK_RECUR)||[];}
function saveRecurring(list){
  cSet(CK_RECUR,list);
  if(db)db.collection('appConfig').doc('recurring')
    .set({list,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true})
    .catch(e=>console.warn('recurring sync failed',e));
}
async function loadRecurring(){
  if(!db) return;
  try{
    const doc=await db.collection('appConfig').doc('recurring').get();
    const arr=doc.exists?doc.data()?.list:null;
    if(Array.isArray(arr))cSet(CK_RECUR,arr);
  }catch(e){_warnLoad('loadRecurring',e);}
}
function nextRunDate(freq,from){
  const d=new Date(from||Date.now());
  if(freq==='weekly'){d.setDate(d.getDate()+7);}
  else if(freq==='monthly'){d.setMonth(d.getMonth()+1);}
  else if(freq==='quarterly'){d.setMonth(d.getMonth()+3);}
  else if(freq==='annually'){d.setFullYear(d.getFullYear()+1);}
  return toLocalISO(d);
}
function isDueThisMonth(nextRun){
  if(!nextRun)return false;
  const n=new Date(nextRun),now=new Date();
  return n.getFullYear()===now.getFullYear()&&n.getMonth()===now.getMonth()||n<now;
}
function _logRecurPost(payee,amount,type){
  const log=cGet('sw3_recur_posted_log')||[];
  log.unshift({date:todayStr(),payee,amount,type});
  cSet('sw3_recur_posted_log',log.slice(0,20));
}
async function postRecurring(idx){
  const list=getRecurring();const r=list[idx];if(!r)return;
  if(!confirm(`Post "${r.payee}" — ${fN(r.amount)} as ${r.type==='income'?'income':'expense'}?`))return;
  // Stamp with the due date (nextRun) when present so the entry lands in the
  // correct month; derive the month/year bucket from that same date.
  const postDate=(r.nextRun||todayStr()).slice(0,10);
  const _pdp=postDate.split('-');const pM=parseInt(_pdp[1]),pY=parseInt(_pdp[0]);
  let _posted=false;
  if(r.type==='income'){
    const bank=r.bank||getCashAccounts()[0];
    const isUSD=isUSDCashAccount(bank);
    const fxRates=getFxRates(pM,pY);
    const amtNGN=isUSD?Math.round(r.amount*fxRates.USD):r.amount;
    const data={amount:r.amount,amtNGN,currency:isUSD?'USD':'NGN',category:r.incCat||'Other',bank,notes:r.notes||'',date:postDate,month:pM,year:pY,type:'income',createdAt:firebase.firestore.FieldValue.serverTimestamp()};
    try{
      const ref=await db.collection('income').add(data);
      if(pM===S.expMonth&&pY===S.expYear) S.income.unshift({...data,id:ref.id});
      const incCache=cGet(CK.inc(pM,pY))||[];incCache.unshift({...data,id:ref.id});cSet(CK.inc(pM,pY),incCache);
      _adjustCash(bank, r.amount, pM, pY);
      _logRecurPost(r.payee,r.amount,'income');
      toast(`${r.payee} posted as income · ${bank} updated`);
      _posted=true;
    }catch(e){toast('Error posting');}
  }else{
    const bank=r.bank||getCashAccounts()[0];
    const isUSD=isUSDCashAccount(bank);
    const fxRates=getFxRates(pM,pY);
    const amtNGN=isUSD?Math.round(r.amount*fxRates.USD):r.amount;
    const data={amount:r.amount,amtNGN,currency:isUSD?'USD':'NGN',category:r.category,bank,payee:r.payee,notes:r.notes||'',date:postDate,month:pM,year:pY,type:'expense',createdAt:firebase.firestore.FieldValue.serverTimestamp()};
    try{
      const ref=await db.collection('transactions').add(data);
      if(pM===S.expMonth&&pY===S.expYear) S.txns.unshift({...data,id:ref.id});
      const txCache=cGet(CK.txns(pM,pY))||[];txCache.unshift({...data,id:ref.id});cSet(CK.txns(pM,pY),txCache);
      _adjustCash(bank, -r.amount, pM, pY);
      _logRecurPost(r.payee,r.amount,'expense');
      toast(`${r.payee} posted · ${bank} updated`);
      _posted=true;
    }catch(e){toast('Error posting');}
  }
  if(_posted){
    list[idx].lastPosted=postDate;list[idx].nextRun=nextRunDate(r.frequency,postDate);
    saveRecurring(list);renderDashboard();renderExpenses();renderRecurringCard();renderCashPage();
  }
}
function renderRecurringCard(){
  const due=getRecurring().filter(r=>isDueThisMonth(r.nextRun));
  const card=document.getElementById('dash-recurring-card');
  const list=document.getElementById('dash-recurring-list');
  if(!card||!list)return;
  if(!due.length){card.style.display='none';return;}
  card.style.display='block';
  const all=getRecurring();
  list.innerHTML=due.map(r=>{const idx=all.indexOf(r);return`<div class="txi" style="cursor:pointer" onclick="postRecurring(${idx})"><div><div class="txi-cat">${esc(r.payee)}</div><div class="txi-meta">${r.type==='income'?'Income':'Expense'} · ${r.frequency} · Due ${fmtDate(r.nextRun)||'now'}</div></div><div style="display:flex;align-items:center;gap:8px"><span class="badge ${r.type==='income'?'bg':'br'}">${r.type==='income'?'+':'-'}${fN(r.amount)}</span><span style="font-size:0.7rem;color:var(--accent)">Post →</span></div></div>`;}).join('');
}
function openRecurModal(){
  const list=getRecurring();
  document.getElementById('recur-list').innerHTML=list.length?list.map((r,i)=>`
    <div class="dc" style="margin-bottom:8px">
      <div class="dc-top"><div><div class="dc-name">${esc(r.payee)}</div><div class="dc-sub">${r.frequency} · ${esc(r.category||r.incCat||'')} · Next: ${fmtDate(r.nextRun)||'—'}</div></div>
        <button class="txi-del" onclick="deleteRecurring(${i})">×</button>
      </div>
      <div style="display:flex;gap:8px;margin-top:6px">
        <span class="badge ${r.type==='income'?'bg':'br'}">${r.type}</span>
        <span style="font-family:var(--mono);font-size:0.78rem">${fN(r.amount)}</span>
      </div>
      ${isDueThisMonth(r.nextRun)?`<button class="btn btn-p btn-sm" style="margin-top:8px;width:100%" onclick="postRecurring(${i});closeMod('recur-modal')">Post Now</button>`:''}
    </div>`).join(''):'<div class="empty"><div class="empty-i">◷</div>No recurring transactions set up.<br>Add one via the expense form.</div>';
  openMod('recur-modal');
}
function deleteRecurring(i){const list=getRecurring();list.splice(i,1);saveRecurring(list);openRecurModal();renderRecurringCard();}

// ── TRANSACTION RULES (auto-categorization — GLOBAL, runs in both design modes) ──
// Stored like recurring: localStorage cache + appConfig/rules doc in Firestore.
// A rule = {match, category}: when an expense name contains `match`
// (case-insensitive), the category is auto-assigned in the expense form.
// First matching rule wins; rules take precedence over the built-in smartCat.
const CK_RULES='sw3_rules';
function getRules(){return cGet(CK_RULES)||[];}
function saveRules(list){
  cSet(CK_RULES,list);
  if(db)db.collection('appConfig').doc('rules')
    .set({list,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true})
    .catch(e=>console.warn('rules sync failed',e));
}
async function loadRules(){
  if(!db) return;
  try{
    const doc=await db.collection('appConfig').doc('rules').get();
    const arr=doc.exists?doc.data()?.list:null;
    if(Array.isArray(arr))cSet(CK_RULES,arr);
  }catch(e){_warnLoad('loadRules',e);}
}
function applyRules(payee){
  const p=String(payee||'').toLowerCase().trim();
  if(!p)return null;
  for(const r of getRules()){if(r.match&&r.category&&p.includes(String(r.match).toLowerCase()))return r.category;}
  return null;
}
function addRule(){
  const match=(document.getElementById('rule-match')?.value||'').trim();
  const category=document.getElementById('rule-cat')?.value;
  if(!match){toast('Enter the text to match');return;}
  if(!category){toast('Pick a category');return;}
  const list=getRules();list.push({match,category});saveRules(list);
  renderSettBudget();toast('Rule added');
}
function deleteRule(i){const list=getRules();list.splice(i,1);saveRules(list);renderSettBudget();}

// ── GOALS (GLOBAL feature — data + logic run in both design modes) ──────────
// Stored like recurring: localStorage cache + appConfig/goals doc in Firestore.
// A goal = {id, name, icon, target, current, deadline, createdAt}.
const CK_GOALS='sw3_goals';
function getGoals(){return cGet(CK_GOALS)||[];}
function saveGoals(list){
  cSet(CK_GOALS,list);
  if(db)db.collection('appConfig').doc('goals')
    .set({list,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true})
    .catch(e=>console.warn('goals sync failed',e));
}
async function loadGoals(){
  if(!db) return;
  try{
    const doc=await db.collection('appConfig').doc('goals').get();
    const arr=doc.exists?doc.data()?.list:null;
    if(Array.isArray(arr))cSet(CK_GOALS,arr);
  }catch(e){_warnLoad('loadGoals',e);}
}
function renderGoalsCard(){
  const card=document.getElementById('dash-goals-card');
  const list=document.getElementById('dash-goals-list');
  if(!card||!list)return;
  const goals=getGoals();
  if(!goals.length){card.style.display='none';return;}
  card.style.display='block';
  const cur=S.dashCurrency,m=S.dashMonth||S.expMonth,y=S.dashYear||S.expYear;
  list.innerHTML=goals.map((g,i)=>{
    const pct=g.target>0?Math.min(100,Math.round((g.current||0)/g.target*100)):0;
    const done=pct>=100;
    return`<div style="padding:7px 0;cursor:pointer" onclick="openGoalModal(${i})">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
        <span style="font-size:0.76rem;font-weight:600">${g.icon||'🎯'} ${esc(g.name)}${done?' <span class="badge bg">Done ✓</span>':''}</span>
        <span style="font-size:0.66rem;font-family:var(--mono);color:var(--text2)">${fmtCur(g.current||0,cur,m,y)} / ${fmtCur(g.target||0,cur,m,y)}</span>
      </div>
      <div class="prog"><div class="pf ${done?'ok':pct>=50?'ok':'warn'}" style="width:${pct}%"></div></div>
      <div style="display:flex;justify-content:space-between;margin-top:2px">
        <span style="font-size:0.6rem;color:var(--text3);font-family:var(--mono)">${pct}%</span>
        ${g.deadline?`<span style="font-size:0.6rem;color:var(--text3)">by ${fmtDate(g.deadline)}</span>`:''}
      </div>
    </div>`;
  }).join('');
}
let _goalEditIdx=null;
function openGoalModal(idx){
  _goalEditIdx=(typeof idx==='number')?idx:null;
  const g=_goalEditIdx!=null?getGoals()[_goalEditIdx]:null;
  document.getElementById('goal-modal-title').textContent=g?'Edit Goal':'New Goal';
  document.getElementById('goal-name').value=g?.name||'';
  document.getElementById('goal-emoji').textContent=g?.icon||'🎯';
  document.getElementById('goal-target').value=g?.target||'';
  document.getElementById('goal-current').value=g?.current||'';
  document.getElementById('goal-deadline').value=g?.deadline||'';
  document.getElementById('goal-delete-btn').style.display=g?'block':'none';
  openMod('goal-modal');
  setTimeout(()=>{initNumInputs(document.getElementById('goal-modal'));},0);
}
function saveGoalFromModal(){
  const name=(document.getElementById('goal-name').value||'').trim();
  const target=parseFloat(document.getElementById('goal-target').value)||0;
  const current=parseFloat(document.getElementById('goal-current').value)||0;
  const deadline=document.getElementById('goal-deadline').value||'';
  const icon=(document.getElementById('goal-emoji').textContent||'').trim()||'🎯';
  if(!name){toast('Enter a goal name');return;}
  if(target<=0){toast('Enter a target amount');return;}
  const list=getGoals();
  if(_goalEditIdx!=null&&list[_goalEditIdx])list[_goalEditIdx]={...list[_goalEditIdx],name,icon,target,current,deadline};
  else list.push({id:'g'+Date.now().toString(36),name,icon,target,current,deadline,createdAt:todayStr()});
  saveGoals(list);
  closeMod('goal-modal');toast(_goalEditIdx!=null?'Goal updated':'Goal added');
  renderGoalsCard();renderSettData();
}
function deleteGoalFromModal(){
  if(_goalEditIdx==null)return;
  if(!confirm('Delete this goal?'))return;
  const list=getGoals();list.splice(_goalEditIdx,1);saveGoals(list);
  closeMod('goal-modal');toast('Goal deleted');
  renderGoalsCard();renderSettData();
}

// ── BUDGET CATEGORY GROUPS (Monarch grouped budget rollups) ────────────────
// Fixed default grouping of the built-in categories; custom categories fall
// into "Other". Used only by the Monarch dashboard budget view — Classic
// keeps its flat list.
const DEF_CAT_GROUPS={
  'Home & Utilities':['Utilities','Domestic','Internet services'],
  'Food':['Food','Groceries'],
  'Transport':['Fuel','Car maintenance','Work Travel'],
  'Family':['Kids','Education','Itunu'],
  'Personal':['Personal care','Recreation'],
  'Giving & Loans':['Gifts and donations','Loans'],
};
function catGroupOf(cat){for(const[g,arr]of Object.entries(DEF_CAT_GROUPS)){if(arr.includes(cat))return g;}return'Other';}

// HISTORY is loaded from localStorage (seeded via JSON import).
function getHistory(){return cGet('sw3_history')||[];}

// ══════════════════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════════════════
const now=new Date();
let S={
  page:'dashboard',
  expMonth:now.getMonth()+1,expYear:now.getFullYear(),expCat:'All',
  cashMonth:now.getMonth()+1,cashYear:now.getFullYear(),
  dashMonth:now.getMonth()+1,dashYear:now.getFullYear(),dashCurrency:'NGN',
  txns:[],income:[],investments:{},cash:{},debtors:[],loans:[],budgets:{...DEF_BUDGETS},
  catChart:null,trendChart:null,invChart:null,invChart2:null,nwChart:null,
  chartType:'doughnut',
  saving:false,isStale:false,lastSync:null,fbSyncVersion:null,
  customExpLines:{}, // user-added expense lines
};
let db;

// ══════════════════════════════════════════════════════════════════════════
// CACHE
// ══════════════════════════════════════════════════════════════════════════
const CK={
  txns:(m,y)=>`sw3_txns_${y}_${m}`,
  inc:(m,y)=>`sw3_inc_${y}_${m}`,
  inv:(m,y)=>`sw3_inv_${y}_${m}`,
  cash:(m,y)=>`sw3_cash_${y}_${m}`,
  xfr:(m,y)=>`sw3_xfr_${y}_${m}`,
  debtors:'sw3_debtors',
  loans:'sw3_loans',
  budgets:(m,y)=>`sw3_budgets_${y}_${m}`,
  lastSync:'sw3_last_sync',
  fbSyncVer:'sw3_fb_sync_ver',
  customLines:'sw3_custom_lines',
  schoolFees:'sw3_school_fees',
  currency:'sw3_dash_currency',
};
const cGet=k=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):null;}catch{return null;}};
const cSet=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch{}};

function loadFromCache(){
  // ── Migrate Energy → Fuel (one-time, background) ──────────────────────
  if(!cGet('sw3_migrated_energy_to_fuel')){
    // Rewrite all cached transaction months synchronously
    const allTxnKeys=Object.keys(localStorage).filter(k=>k.startsWith('sw3_txns_'));
    allTxnKeys.forEach(lsKey=>{
      const arr=cGet(lsKey);if(!arr)return;
      let changed=false;
      arr.forEach(t=>{if(t.category==='Energy'){t.category='Fuel';changed=true;}});
      if(changed)cSet(lsKey,arr);
    });
    // Merge budget allocations in all cached budget months
    const allBudgetKeys=Object.keys(localStorage).filter(k=>k.startsWith('sw3_budgets_'));
    allBudgetKeys.forEach(lsKey=>{
      const arr=cGet(lsKey);if(!arr)return;
      if(arr['Energy']){arr['Fuel']=(arr['Fuel']||0)+arr['Energy'];delete arr['Energy'];cSet(lsKey,arr);}
    });
    // Merge payee lines
    const energyLines=CAT_LINES['Energy']||[];
    if(energyLines.length){
      if(!CAT_LINES['Fuel'])CAT_LINES['Fuel']=[];
      energyLines.forEach(l=>{if(!CAT_LINES['Fuel'].includes(l))CAT_LINES['Fuel'].push(l);});
      CAT_LINES['Energy']=[];
    }
    // Remove Energy from custom cats if present
    const custom=getCustomCats().filter(c=>c!=='Energy');saveCustomCats(custom);
    cSet('sw3_migrated_energy_to_fuel',true);
    // Fire async Firestore batch in the background (non-blocking)
    _migrateEnergyFirestore();
  }

  if(!cGet('sw3_migrated_usd_cash')){
    const m=new Date().getMonth()+1,y=new Date().getFullYear();
    const inv=cGet(CK.inv(m,y));
    if(inv&&inv.USDHoldings&&inv.USDHoldings>0){
      const fxR=getFxRates(m,y);
      const usdAmt=+(inv.USDHoldings/fxR.USD).toFixed(2);
      const cash=cGet(CK.cash(m,y))||{};
      if(!cash['USD Cash']||cash['USD Cash']===0){
        cash['USD Cash']=usdAmt;
        cSet(CK.cash(m,y),cash);
        // Also write to Firestore so loadCashData doesn't overwrite the migrated value
        cSet('sw3_usd_cash_pending_migration',{m,y,usdAmt});
      }
    }
    cSet('sw3_migrated_usd_cash','1');
  }

  // One-time: strip legacy ledger/segment fields from investment meta so
  // interest is computed statelessly from the current principal only.
  if(!cGet('sw3_migrated_inv_stateless')){
    const meta=cGet(INV_META_KEY)||{};
    let changed=false;
    Object.keys(meta).forEach(k=>{
      const m2=meta[k];if(!m2||typeof m2!=='object') return;
      if('ledger' in m2||'lastSavedPrincipal' in m2||'investmentStartDate' in m2){
        // Prefer the original investment start date if it was recorded
        if(m2.investmentStartDate&&!m2.startDate) m2.startDate=m2.investmentStartDate;
        if(m2.investmentStartDate&&m2.startDate&&m2.investmentStartDate<m2.startDate) m2.startDate=m2.investmentStartDate;
        delete m2.ledger;delete m2.lastSavedPrincipal;delete m2.investmentStartDate;
        changed=true;
      }
    });
    if(changed) cSet(INV_META_KEY,meta);
    cSet('sw3_migrated_inv_stateless','1');
  }

  const m=S.expMonth,y=S.expYear;
  S.txns=cGet(CK.txns(m,y))||[];
  S.income=cGet(CK.inc(m,y))||[];
  S.investments=cGet(CK.inv(m,y))||{};
  S.cash=cGet(CK.cash(m,y))||{};
  S.debtors=cGet(CK.debtors)||[];
  S.loans=cGet(CK.loans)||[];
  S.budgets=cGet(CK.budgets(m,y))||{...DEF_BUDGETS};
  S.lastSync=cGet(CK.lastSync);
  S.fbSyncVersion=cGet(CK.fbSyncVer);
  S.dashCurrency=cGet(CK.currency)||'NGN';
  S.customExpLines=cGet(CK.customLines)||{};
  S.isStale=S.txns.length>0||Object.keys(S.investments).length>0||Object.keys(S.cash).length>0;
  // Set theme icon correctly on load
  const _themeIc=document.getElementById('theme-icon');
  if(_themeIc) _themeIc.textContent=document.body.classList.contains('light')?'☀️':'🌙';
  // Pre-build history from cache so charts show immediately, Firebase will overwrite
  _buildHistoryFromCache();
}

// ══════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════
const sid=(m,y)=>`${y}-${String(m).padStart(2,'0')}`;
const fxKey=(m,y)=>`${y}-${String(m).padStart(2,'0')}`;
const FX_OVR_KEY='sw3_fx_overrides';
function getFxOverrides(){return cGet(FX_OVR_KEY)||{};}
function _syncFxOverrides(ovr){
  if(!db) return;
  db.collection('appConfig').doc('fxOverrides')
    .set({overrides:ovr,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:false})
    .catch(e=>console.warn('fxOverrides sync failed',e));
}
function getFxRates(m,y){const k=fxKey(m,y);const ovr=getFxOverrides();return ovr[k]||FX_RATES[k]||{USD:1600,GBP:2050};}
const fN=n=>n==null||isNaN(n)?'—':'₦'+Number(n).toLocaleString('en-NG',{maximumFractionDigits:0});
// ── NUMBER INPUT FORMATTING ──────────────────────────────────────────────
function fmtThousands(v){
  if(v===''||v===null||v===undefined) return '';
  const n=Number(String(v).replace(/,/g,''));
  if(isNaN(n)) return v;
  return n.toLocaleString('en-NG',{maximumFractionDigits:0});
}
function _syncNumDisplay(input){
  const wrap=input.closest('.num-wrap');
  if(!wrap) return;
  let disp=wrap.querySelector('.num-display');
  const raw=input.value.replace(/,/g,'');
  if(disp) disp.textContent=raw?fmtThousands(raw):'';
}
function _evalExpr(raw){
  // Safely evaluate simple arithmetic expressions: digits, +, -, *, /, (, ), spaces, commas, dots
  const cleaned=raw.replace(/,/g,'').trim();
  if(!cleaned) return '';
  if(/^[\d.]+$/.test(cleaned)) return cleaned; // plain number, no eval needed
  if(!/^[\d.+\-*/()\s]+$/.test(cleaned)) return cleaned; // unexpected chars, leave as-is
  try{
    // eslint-disable-next-line no-new-func
    const result=Function('"use strict";return ('+cleaned+')')();
    if(typeof result==='number'&&isFinite(result)) return String(Math.round(result*100)/100);
  }catch(e){}
  return cleaned;
}
function _makeNumInput(el){
  // Wrap existing input in num-wrap if not already
  if(el.closest('.num-wrap')) return;
  const wrap=document.createElement('div');wrap.className='num-wrap';
  el.parentNode.insertBefore(wrap,el);wrap.appendChild(el);
  const disp=document.createElement('div');disp.className='num-display';
  disp.textContent='';wrap.appendChild(disp);
  el.style.color='transparent';el.style.caretColor='var(--text)';
  el.addEventListener('input',()=>_syncNumDisplay(el));
  el.addEventListener('focus',()=>{if(disp)disp.style.opacity='0.4';});
  el.addEventListener('blur',()=>{
    // Evaluate any expression, then reformat
    const evaled=_evalExpr(el.value);
    if(evaled!==el.value) el.value=evaled;
    if(disp)disp.style.opacity='1';
    _syncNumDisplay(el);
  });
  _syncNumDisplay(el);
}
function initNumInputs(scope){
  (scope||document).querySelectorAll('input[type="number"],input[type="text"].ifield,input[inputmode="decimal"],input[inputmode="numeric"]').forEach(el=>{
    if(!el.closest('.num-wrap')) _makeNumInput(el);
    else _syncNumDisplay(el);
  });
}

function fmtChartNGN(v){if(Math.abs(v)>=1e6)return'₦'+(v/1e6).toFixed(2)+'M';if(Math.abs(v)>=1e3)return'₦'+(v/1e3).toFixed(1)+'K';return'₦'+v.toFixed(0);}
function fmtChartMoney(v){return fmtChartNGN(v);}
const fNum=n=>n==null||isNaN(n)?'—':Number(n).toLocaleString('en-NG',{maximumFractionDigits:0});
const ck=c=>c.replace(/[^a-zA-Z]/g,'');
const todayStr=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
const toLocalISO=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
// Escape a value for safe interpolation inside a single-quoted onclick="...('...')" argument.
function jsq(s){return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");}
const MONTHS_SHORT=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDate(iso){if(!iso)return'—';const p=iso.slice(0,10).split('-');if(p.length<3)return iso;return`${parseInt(p[2],10)}-${MONTHS_SHORT[parseInt(p[1],10)-1]}-${p[0]}`;}
// Returns numeric ms from a Firestore Timestamp, JS Date, ISO string, or 0 for missing
function txnTs(t){if(!t)return 0;if(typeof t.toMillis==='function')return t.toMillis();if(typeof t.seconds==='number')return t.seconds*1000+(t.nanoseconds||0)/1e6;if(t instanceof Date)return t.getTime();if(typeof t==='string')return new Date(t).getTime()||0;return 0;}
const curM=()=>new Date().getMonth()+1;
const curY=()=>new Date().getFullYear();
const bSt=(s,b)=>!b?'ok':s/b>=1?'over':s/b>=0.8?'warn':'ok';

function fmtCur(ngn, currency, m, y) {
  if(!currency||currency==='NGN'||currency==='NATIVE') return fN(ngn);
  const rates=getFxRates(m||S.dashMonth,y||S.dashYear);
  const sym=currency==='USD'?'$':'£';
  return sym+(ngn/(rates[currency]||1)).toLocaleString('en-NG',{maximumFractionDigits:0});
}
function fmtPlatformVal(rawVal,platformKey,currency,m,y){
  const p=PLATFORMS.find(x=>x.key===platformKey);
  if(!p) return fmtCur(rawVal,currency,m,y);
  if(currency==='NATIVE'){
    if(p.currency==='NGN') return fN(rawVal);
    const rates=getFxRates(m||S.dashMonth,y||S.dashYear);
    const sym=p.currency==='USD'?'$':'£';
    return sym+(rawVal/(rates[p.currency]||1)).toLocaleString('en-NG',{maximumFractionDigits:2});
  }
  return fmtCur(rawVal,currency,m,y);
}

// ── Per-card privacy (eye) toggles ─────────────────────────────────────────
// Each money card gets its own independent toggle, persisted device-locally.
// Only actual cash figures are masked — percentages, badges and progress bars
// always stay visible.
const HIDDEN_CARDS_LS='sw3_hidden_cards';
const _EYE_ON='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const _EYE_OFF='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
function _hiddenCards(){if(!S.hiddenCards)S.hiddenCards=cGet(HIDDEN_CARDS_LS)||{};return S.hiddenCards;}
function _isHidden(key){return !!_hiddenCards()[key];}
function maskIf(key,disp){return _isHidden(key)?'<span class="masked">••••••</span>':disp;}
function eyeBtn(key,fn){return`<button class="eye-btn" onclick="toggleCardEye('${key}','${fn||''}',event)" title="${_isHidden(key)?'Show figures':'Hide figures'}">${_isHidden(key)?_EYE_OFF:_EYE_ON}</button>`;}
function toggleCardEye(key,fn,ev){
  if(ev)ev.stopPropagation();
  const h=_hiddenCards();
  if(h[key])delete h[key];else h[key]=true;
  cSet(HIDDEN_CARDS_LS,h);
  const f=fn&&window[fn];
  if(typeof f==='function')f();
}

function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500);}

// ── UNDO TOAST ─────────────────────────────────────────────────────────────
// Shows a toast with an Undo button for 5s. If untouched, commitFn runs
// (the permanent Firestore delete); tapping Undo restores local state instead.
let _undoTimer=null,_undoPending=null;
function _undoEl(){
  let el=document.getElementById('undo-toast');
  if(!el){
    el=document.createElement('div');el.id='undo-toast';
    el.style.cssText='position:fixed;left:50%;transform:translateX(-50%);bottom:84px;z-index:9999;display:none;align-items:center;gap:14px;padding:10px 16px;background:var(--bg2);border:1px solid var(--border2);border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,0.4);font-size:0.78rem';
    el.innerHTML='<span id="undo-msg"></span><button id="undo-btn" style="background:none;border:none;color:var(--accent);font-weight:700;font-size:0.78rem;cursor:pointer;padding:0">UNDO</button>';
    document.body.appendChild(el);
    document.getElementById('undo-btn').onclick=()=>{
      if(_undoPending){clearTimeout(_undoTimer);_undoPending.undo();_undoPending=null;_undoTimer=null;}
      el.style.display='none';
    };
  }
  return el;
}
function _commitPendingUndo(){
  if(_undoPending){clearTimeout(_undoTimer);_undoPending.commit();_undoPending=null;_undoTimer=null;}
  const el=document.getElementById('undo-toast');if(el)el.style.display='none';
}
function showUndoToast(msg, undoFn, commitFn){
  _commitPendingUndo(); // only one pending undo at a time
  const el=_undoEl();
  document.getElementById('undo-msg').textContent=msg;
  el.style.display='flex';
  _undoPending={undo:undoFn,commit:commitFn};
  _undoTimer=setTimeout(()=>{const p=_undoPending;_undoPending=null;_undoTimer=null;el.style.display='none';if(p)p.commit();},5000);
}
function _recalcHistIncome(m,y){
  const hist=cGet('sw3_history')||[];
  const hIdx=hist.findIndex(h=>h.year===y&&h.month===m);
  if(hIdx>=0){hist[hIdx].income=S.income.reduce((s,i)=>s+(i.amtNGN||i.amount||0),0);cSet('sw3_history',hist);}
}
function openMod(id){document.getElementById(id).classList.add('open');}
function closeMod(id){document.getElementById(id).classList.remove('open');}

function setSyncStatus(st){
  const dot=document.getElementById('sync-dot'),lbl=document.getElementById('sync-lbl');
  if(!dot||!lbl) return;
  dot.className='sync-dot';
  const map={syncing:{cls:'yellow',text:'Syncing'},synced:{cls:'green',text:'Synced'},offline:{cls:'red',text:'Offline'},error:{cls:'red',text:'Error'}};
  const s=map[st]||map.offline;
  dot.classList.add(s.cls);lbl.textContent=s.text;
  _updateOqBadge();
}
function _updateOqBadge(){
  const el=document.getElementById('oq-badge');if(!el)return;
  const n=oqGet().length;
  el.textContent=n?`${n} pending`:'';
  el.style.display=n?'inline':'none';
}
function showStaleBar(){
  if(!S.lastSync) return;
  const d=new Date(S.lastSync),diff=Math.round((Date.now()-d)/60000);
  document.getElementById('stale-time').textContent=diff<60?`${diff}m ago`:d.toLocaleDateString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  document.getElementById('stale-bar').style.display='flex';
}
function hideStaleBar(){document.getElementById('stale-bar').style.display='none';}

// ══════════════════════════════════════════════════════════════════════════
// FIREBASE
// ══════════════════════════════════════════════════════════════════════════
function initFirebase(){
  try{loadFromCache();}catch(e){console.error('loadFromCache threw',e);}
  try{renderAll();}catch(e){console.error('renderAll threw',e);}
  if(S.isStale) showStaleBar();
  (async()=>{
    await new Promise(resolve=>{function check(){if(typeof firebase!=='undefined')resolve();else setTimeout(check,50);}check();});
    firebase.initializeApp({apiKey:"AIzaSyCIe7f02DrbrwZLIBmNlvslXWmNLVMiluw",authDomain:"spendwise-d6393.firebaseapp.com",projectId:"spendwise-d6393",storageBucket:"spendwise-d6393.firebasestorage.app",messagingSenderId:"460779232494",appId:"1:460779232494:web:cd3c178b88d0f22044a7ff"});
    db=firebase.firestore();
    db.enablePersistence().catch(()=>{});
    if(!navigator.onLine){_invMigrateGate=true;setSyncStatus('offline');return;}
    setSyncStatus('syncing');
    try{
      const m=S.expMonth,y=S.expYear;
      await syncAll();
      _invMigrateGate=true;
      // Always reload S.* from cache after sync — loadX functions
      // wrote fresh Firebase data to cache; we must pick it up here
      S.txns=cGet(CK.txns(m,y))||S.txns;
      S.income=cGet(CK.inc(m,y))||S.income;
      S.investments=cGet(CK.inv(m,y))||S.investments;
      S.cash=cGet(CK.cash(m,y))||S.cash;
      S.debtors=cGet(CK.debtors)||S.debtors;
      cSet(CK.lastSync,Date.now());setSyncStatus('synced');hideStaleBar();renderAll();startRealtimeListeners();
      _checkMonthEndClose(); // fire-and-forget: freezes any months that closed since the app was last opened
      _prefetchHistoryMonths(); // fire-and-forget: pulls prior months so smart insights have history on this device
      _healCashLedgers(); // fire-and-forget: pushes any ledger entries stranded locally on this device up to Firestore
    }catch(e){console.error(e);setSyncStatus('error');}
  })();
}

async function syncAll(){
  const m=S.expMonth,y=S.expYear;
  await Promise.all([loadTxns(m,y),loadIncome(m,y),loadInvData(m,y),loadCashData(m,y),loadDebtors(),loadBudgets(m,y),loadHistoricalSummary(),loadInvConfig(),loadCashLogos(),loadCashAccounts(),loadLoans(),loadFxOverrides(),loadNWConfig(),loadRecurring(),loadCustomCats(),loadAiChats(),loadGoals(),loadRules()]);
}

// ── REALTIME LISTENER ─────────────────────────────────────────────────────
// Listens to the current month's transactions in Firestore.
// When another device saves an expense, this fires and updates the UI.
let _txnListener=null;
let _incListener=null;
let _cashListener=null;
let _logosListener=null;
let _acctsListener=null;
let _fxOvrListener=null;
let _invCfgListener=null;
let _nwCfgListener=null;
let _recurListener=null;
let _goalsListener=null;
let _rulesListener=null;
let _catsListener=null;
let _debListener=null;
let _loanListener=null;
let _aiChatListener=null;

function startRealtimeListeners(){
  stopRealtimeListeners();
  const m=S.expMonth,y=S.expYear;
  const cm=S.cashMonth||S.expMonth,cy=S.cashYear||S.expYear;
  if(!db) return;

  // Transactions — guarded so a listener left over from a previous month
  // (or still catching up after a month switch) can never overwrite the
  // month currently being viewed; it still updates that month's cache.
  _txnListener=db.collection('transactions')
    .where('year','==',y).where('month','==',m)
    .onSnapshot(snap=>{
      if(snap.metadata.hasPendingWrites) return; // skip own writes mid-save
      const fresh=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.date>b.date?-1:a.date<b.date?1:txnTs(b.createdAt)-txnTs(a.createdAt));
      cSet(CK.txns(m,y),fresh);
      if(S.expMonth!==m||S.expYear!==y) return;
      S.txns=fresh;
      renderExpenses();renderDashboard();
      setSyncStatus('synced');
    },err=>console.warn('txn listener:',err));

  // Income — same stale-month guard as transactions.
  _incListener=db.collection('income')
    .where('year','==',y).where('month','==',m)
    .onSnapshot(snap=>{
      if(snap.metadata.hasPendingWrites) return;
      const fresh=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.date>b.date?-1:a.date<b.date?1:txnTs(b.createdAt)-txnTs(a.createdAt));
      cSet(CK.inc(m,y),fresh);
      if(S.expMonth!==m||S.expYear!==y) return;
      S.income=fresh;
      renderDashboard();
      setSyncStatus('synced');
    },err=>console.warn('inc listener:',err));

  // Cash balances — follows the Cash tab's own month (cm/cy), not the
  // expenses month, and is guarded the same way.
  _cashListener=db.collection('cashBalances').doc(sid(cm,cy))
    .onSnapshot(snap=>{
      if(!snap.exists||snap.metadata.hasPendingWrites) return;
      const data={...snap.data()};
      // Preserve any field with a local write still in flight to this device,
      // so a remote update to a different field can't blank it momentarily.
      const local=cGet(CK.cash(cm,cy))||{};
      Object.keys(local).forEach(k=>{ if(_isCashDirty(cm,cy,k)) data[k]=local[k]; });
      cSet(CK.cash(cm,cy),data);
      if(S.cashMonth!==cm||S.cashYear!==cy) return;
      S.cash=data;
      renderCashPage();renderDashboard();
    },err=>console.warn('cash listener:',err));

  // Cash logos — real-time cross-device sync
  if(_logosListener){_logosListener();_logosListener=null;}
  _logosListener=db.collection('appConfig').doc('cashLogos')
    .onSnapshot(snap=>{
      if(!snap.exists||snap.metadata.hasPendingWrites) return;
      const data=snap.data()||{};
      // Merge: remote wins for keys it has, local keeps anything not yet on remote
      const merged={...getCashLogos(),...data};
      cSet('sw3_cash_logos',merged);
      renderCashPage();renderDashboard();
    },err=>console.warn('cashLogos listener:',err));

  // Cash accounts (custom list) — real-time cross-device sync
  if(_acctsListener){_acctsListener();_acctsListener=null;}
  _acctsListener=db.collection('appConfig').doc('cashAccounts')
    .onSnapshot(snap=>{
      if(!snap.exists||snap.metadata.hasPendingWrites) return;
      const arr=snap.data()?.accounts;
      if(Array.isArray(arr)){
        cSet('sw3_cash_accounts',arr);
        renderCashPage();renderDashboard();
      }
    },err=>console.warn('cashAccounts listener:',err));

  // FX rate overrides — real-time cross-device sync
  if(_fxOvrListener){_fxOvrListener();_fxOvrListener=null;}
  _fxOvrListener=db.collection('appConfig').doc('fxOverrides')
    .onSnapshot(snap=>{
      if(!snap.exists||snap.metadata.hasPendingWrites) return;
      const ovr=snap.data()?.overrides;
      if(ovr&&typeof ovr==='object'){
        cSet(FX_OVR_KEY,ovr);
        renderSettData();renderDashboard();
      }
    },err=>console.warn('fxOverrides listener:',err));

  // Investment config (platforms / meta / subs) — real-time cross-device sync
  if(_invCfgListener){_invCfgListener();_invCfgListener=null;}
  _invCfgListener=db.collection('appConfig').doc('investments')
    .onSnapshot(snap=>{
      if(!snap.exists||snap.metadata.hasPendingWrites) return;
      const d=snap.data()||{};
      // Firestore still delivers a "server ack" event for our OWN writes once
      // they commit (hasPendingWrites only filters the first, optimistic echo)
      // — comparing against the local cache turns that ack into a no-op instead
      // of a full re-render that would blow away a logo input mid-keystroke.
      let changed=false;
      if(d.platforms&&d.platforms.length&&JSON.stringify(d.platforms)!==JSON.stringify(getPlatforms())){cSet(PLATFORMS_KEY,d.platforms);changed=true;}
      if(d.invMeta&&Object.keys(d.invMeta).length&&JSON.stringify(d.invMeta)!==JSON.stringify(getInvMeta())){cSet(INV_META_KEY,d.invMeta);changed=true;}
      if(d.invSubs&&Object.keys(d.invSubs).length&&JSON.stringify(d.invSubs)!==JSON.stringify(getInvSubs())){cSet(INV_SUBS_KEY,d.invSubs);changed=true;}
      if(changed){PLATFORMS=getPlatforms();renderInvestments();renderDashboard();}
    },err=>console.warn('invConfig listener:',err));

  // Net worth config — real-time cross-device sync
  if(_nwCfgListener){_nwCfgListener();_nwCfgListener=null;}
  _nwCfgListener=db.collection('appConfig').doc('nwConfig')
    .onSnapshot(snap=>{
      if(!snap.exists||snap.metadata.hasPendingWrites) return;
      const cfg=snap.data()?.cfg;
      if(cfg&&typeof cfg==='object'){
        cSet(NW_CFG_KEY,cfg);
        renderDashboard();
      }
    },err=>console.warn('nwConfig listener:',err));

  // Recurring transactions — real-time cross-device sync
  if(_recurListener){_recurListener();_recurListener=null;}
  _recurListener=db.collection('appConfig').doc('recurring')
    .onSnapshot(snap=>{
      if(!snap.exists||snap.metadata.hasPendingWrites) return;
      const arr=snap.data()?.list;
      if(Array.isArray(arr)){
        cSet(CK_RECUR,arr);
        renderRecurringCard();renderDashboard();
      }
    },err=>console.warn('recurring listener:',err));

  // Goals — real-time cross-device sync
  if(_goalsListener){_goalsListener();_goalsListener=null;}
  _goalsListener=db.collection('appConfig').doc('goals')
    .onSnapshot(snap=>{
      if(!snap.exists||snap.metadata.hasPendingWrites) return;
      const arr=snap.data()?.list;
      if(Array.isArray(arr)){
        cSet(CK_GOALS,arr);
        renderGoalsCard();
      }
    },err=>console.warn('goals listener:',err));

  // Transaction rules — real-time cross-device sync
  if(_rulesListener){_rulesListener();_rulesListener=null;}
  _rulesListener=db.collection('appConfig').doc('rules')
    .onSnapshot(snap=>{
      if(!snap.exists||snap.metadata.hasPendingWrites) return;
      const arr=snap.data()?.list;
      if(Array.isArray(arr)){
        cSet(CK_RULES,arr);
      }
    },err=>console.warn('rules listener:',err));

  // Custom categories — real-time cross-device sync
  if(_catsListener){_catsListener();_catsListener=null;}
  _catsListener=db.collection('appConfig').doc('customCats')
    .onSnapshot(snap=>{
      if(!snap.exists||snap.metadata.hasPendingWrites) return;
      const arr=snap.data()?.cats;
      if(Array.isArray(arr)){
        try{localStorage.setItem('sw3_custom_cats',JSON.stringify(arr));}catch{}
        renderExpenses();
      }
    },err=>console.warn('customCats listener:',err));

  // Debtors — real-time cross-device sync
  if(_debListener){_debListener();_debListener=null;}
  _debListener=db.collection('debtors').onSnapshot(snap=>{
    if(snap.metadata.hasPendingWrites) return;
    S.debtors=snap.docs.map(d=>({id:d.id,...d.data()}));
    cSet(CK.debtors,S.debtors);
    renderDebtors();renderDashboard();
  },err=>console.warn('debtors listener:',err));

  // Loans — real-time cross-device sync
  if(_loanListener){_loanListener();_loanListener=null;}
  _loanListener=db.collection('loans').onSnapshot(snap=>{
    if(snap.metadata.hasPendingWrites) return;
    S.loans=snap.docs.map(d=>({id:d.id,...d.data()}));
    cSet(CK.loans,S.loans);
    renderLoans();
  },err=>console.warn('loans listener:',err));

  // AI conversations — real-time cross-device sync. aiAsk works by chat id and
  // re-resolves after each await, and this skips our own pending writes, so a
  // rebuild here can't drop an in-flight reply. Preserve any in-progress typing.
  if(_aiChatListener){_aiChatListener();_aiChatListener=null;}
  _aiChatListener=db.collection('aiChats')
    .onSnapshot(snap=>{
      if(snap.metadata.hasPendingWrites) return;
      const chats=snap.docs.map(d=>({id:d.id,...d.data()}));
      _aiSortChats(chats);
      S.aiChats=chats;cSet(AI_CHATS_LS,chats);
      const draft=(document.getElementById('ai-input')||{}).value;
      renderProjAI();
      const inp=document.getElementById('ai-input');if(inp&&draft)inp.value=draft;
    },err=>console.warn('aiChats listener:',err));
}

function stopRealtimeListeners(){
  if(_txnListener){_txnListener();_txnListener=null;}
  if(_incListener){_incListener();_incListener=null;}
  if(_cashListener){_cashListener();_cashListener=null;}
  if(_logosListener){_logosListener();_logosListener=null;}
  if(_acctsListener){_acctsListener();_acctsListener=null;}
  if(_fxOvrListener){_fxOvrListener();_fxOvrListener=null;}
  if(_invCfgListener){_invCfgListener();_invCfgListener=null;}
  if(_nwCfgListener){_nwCfgListener();_nwCfgListener=null;}
  if(_recurListener){_recurListener();_recurListener=null;}
  if(_goalsListener){_goalsListener();_goalsListener=null;}
  if(_rulesListener){_rulesListener();_rulesListener=null;}
  if(_catsListener){_catsListener();_catsListener=null;}
  if(_debListener){_debListener();_debListener=null;}
  if(_loanListener){_loanListener();_loanListener=null;}
  if(_aiChatListener){_aiChatListener();_aiChatListener=null;}
}

async function loadTxns(m,y){
  // Always fetch from Firestore — local cache is only a fallback, not authoritative
  try{
    let snap;
    try{snap=await db.collection('transactions').where('year','==',y).where('month','==',m).orderBy('date','desc').get();}
    catch{snap=await db.collection('transactions').where('year','==',y).where('month','==',m).get();}
    if(snap&&snap.size>0){
      const fresh=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.date>b.date?-1:a.date<b.date?1:txnTs(b.createdAt)-txnTs(a.createdAt));
      cSet(CK.txns(m,y),fresh);
      if(S.expMonth===m&&S.expYear===y) S.txns=fresh;
    }
  }catch(e){/* keep local */}
}

// Background prefetch of prior months' transactions so the smart-insights
// engine has history to learn from on any device, not just ones where the
// user has browsed back through old months. Skips months already cached.
async function _prefetchHistoryMonths(){
  if(!db||!navigator.onLine) return;
  let fetched=0;
  for(const {m:mm,y:yy} of _prevMonthsList(S.expMonth,S.expYear,6)){
    if(Array.isArray(cGet(CK.txns(mm,yy)))) continue;
    try{
      const snap=await db.collection('transactions').where('year','==',yy).where('month','==',mm).get();
      // Apply the same category renames the one-time local migrations do,
      // since those already ran before these months were cached
      cSet(CK.txns(mm,yy),snap.docs.map(d=>{const t={id:d.id,...d.data()};if(t.category==='Energy')t.category='Fuel';if(t.category==='Fife')t.category='Kids';return t;}));
      fetched++;
    }catch(e){/* offline or rules — insights degrade gracefully */}
  }
  if(fetched){try{renderDashAlerts();renderProjInsights();}catch(e){}}
}

async function loadIncome(m,y){
  // Always fetch from Firestore
  try{
    let snap;
    try{snap=await db.collection('income').where('year','==',y).where('month','==',m).orderBy('date','desc').get();}
    catch{snap=await db.collection('income').where('year','==',y).where('month','==',m).get();}
    if(snap&&snap.size>0){
      const fresh=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.date>b.date?-1:a.date<b.date?1:txnTs(b.createdAt)-txnTs(a.createdAt));
      cSet(CK.inc(m,y),fresh);
      if(S.expMonth===m&&S.expYear===y) S.income=fresh;
    }
  }catch(e){/* keep local */}
}

async function loadInvData(m,y){
  // Always fetch from Firebase so edits on other devices are picked up immediately.
  // Fall back to localStorage only when offline.
  try{
    const doc=await db.collection('investments').doc(sid(m,y)).get();
    if(doc.exists&&doc.data()){
      S.investments={...doc.data()};cSet(CK.inv(m,y),S.investments);return;
    }
    // No document for this month. Only fall back to the most recent entry
    // when viewing the current month or a future (carry-forward) month —
    // for a genuinely PAST month with no doc, showing/caching the latest
    // figures would misrepresent that month's real history.
    const _now=new Date();
    const isPastMonth=(y<_now.getFullYear())||(y===_now.getFullYear()&&m<_now.getMonth()+1);
    if(!isPastMonth){
      const snap=await db.collection('investments').orderBy('year','desc').orderBy('month','desc').limit(1).get();
      if(!snap.empty){S.investments={...snap.docs[0].data()};} // display only — do not cache under this month's key
      else S.investments={};
    }else{
      const local=cGet(CK.inv(m,y));
      S.investments=(local&&Object.keys(local).length)?{...local}:{};
    }
  }catch(e){
    // Offline — use localStorage cache as fallback
    const local=cGet(CK.inv(m,y));
    if(local&&Object.keys(local).some(k=>!['month','year'].includes(k)&&local[k]>0)){
      S.investments={...local};
    }
  }
}

async function loadCashData(m,y){
  // Flush any pending USD Cash migration write to Firestore (one-time)
  const pendingMig=cGet('sw3_usd_cash_pending_migration');
  if(pendingMig&&db){
    try{
      const {m:pm,y:py,usdAmt}=pendingMig;
      const migRef=db.collection('cashBalances').doc(sid(pm,py));
      await migRef.set({'USD Cash':usdAmt,year:py,month:pm},{merge:true});
      cSet('sw3_usd_cash_pending_migration',null);
    }catch(e){}
  }
  try{
    const localCash=cGet(CK.cash(m,y))||{};
    const doc=await db.collection('cashBalances').doc(sid(m,y)).get();

    // Guard: only seed/repair for months up to the current real month.
    const _now=new Date();
    const isFutureMonth=(y>_now.getFullYear())||(y===_now.getFullYear()&&m>_now.getMonth()+1);

    if(doc.exists&&doc.data()){
      const remote={...doc.data()};
      // Detect uninitialised new-month doc: created by FieldValue.increment on an
      // empty doc (old behaviour) before carry-forward logic was deployed.
      // Symptom: every cash account is zero or missing while prev month was non-zero.
      const accts=getCashAccounts();
      const remoteTotal=accts.reduce((s,b)=>s+Math.abs(remote[b]||0),0);
      if(!isFutureMonth&&remoteTotal===0){
        // Walk back up to 12 months to check if there were real closing balances.
        const prev=await _walkBackClosing(m,y);
        const prevTotal=accts.reduce((s,b)=>s+Math.abs(prev[b]||0),0);
        if(prevTotal>0){
          // Repair: merge prev closing into current doc for any zero/missing account.
          // Uses a plain falsy check (not >0) so a genuine negative prior
          // balance is also carried forward correctly.
          const repaired={...remote,month:m,year:y};
          accts.forEach(b=>{if(!remote[b]&&prev[b]) repaired[b]=prev[b];});
          try{await db.collection('cashBalances').doc(sid(m,y)).set(repaired,{merge:true});}catch(e){}
          S.cash=repaired;cSet(CK.cash(m,y),repaired);return;
        }
      }
      // Normal path: authoritative remote doc — let in-flight local fields win.
      const merged={...remote};
      Object.keys(localCash).forEach(k=>{if(_isCashDirty(m,y,k)) merged[k]=localCash[k];});
      S.cash=merged;cSet(CK.cash(m,y),merged);return;
    }

    // No doc at all for this month — seed from the most recent closing balance.
    // (This is a read-path safety net; _ensureCashDoc covers the write path.)
    if(!isFutureMonth){
      const prev=await _walkBackClosing(m,y);
      if(Object.keys(prev).length){
        const seed={...prev,month:m,year:y};
        try{await db.collection('cashBalances').doc(sid(m,y)).set(seed,{merge:true});}catch(e){}
        S.cash={...prev};cSet(CK.cash(m,y),{...prev,month:m,year:y});return;
      }
    }
    // Absolute fallback — local cache only (offline / no prior month path).
    if(Object.keys(localCash).length){S.cash=localCash;return;}
  }catch(e){_warnLoad('loadCashData',e);}
}

async function loadDebtors(){
  // Always fetch from Firestore
  try{
    const snap=await db.collection('debtors').get();
    if(snap&&snap.size>0){
      S.debtors=snap.docs.map(d=>({id:d.id,...d.data()}));
      cSet(CK.debtors,S.debtors);
    }
  }catch(e){_warnLoad('loadDebtors',e);}
}

async function loadHistoricalSummary(){
  // Always pull from Firebase — never skip with local-always-wins
  try{
    // No orderBy — sort client-side to avoid composite index requirement
    let snap;
    try{snap=await db.collection('historicalSummary').get({source:'server'});}
    catch(e){snap=await db.collection('historicalSummary').get();}
    const MS2=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    let hist=[];
    if(snap&&snap.size>0){
      hist=snap.docs.map(d=>{const h=d.data();return{year:h.year,month:h.month,
        label:h.label||(MS2[(h.month||1)-1]+" '"+String(h.year).slice(2)),
        income:h.income||0,expenses:h.expenses||0};});
    }
    // Augment with live months not yet in historicalSummary.
    // Check Firestore transactions/income collections (not just localStorage)
    // so mobile devices with no local cache also see all months.
    const histKeys=new Set(hist.map(h=>`${h.year}-${h.month}`));
    try{
      const [txAllSnap,incAllSnap]=await Promise.all([
        db.collection('transactions').get(),
        db.collection('income').get(),
      ]);
      // Group by year-month
      const txByMonth={}, incByMonth={};
      txAllSnap.docs.forEach(d=>{const h=d.data();if(!h.year||!h.month) return;const k=`${h.year}-${h.month}`;txByMonth[k]=(txByMonth[k]||[]);txByMonth[k].push(h);});
      incAllSnap.docs.forEach(d=>{const h=d.data();if(!h.year||!h.month) return;const k=`${h.year}-${h.month}`;incByMonth[k]=(incByMonth[k]||[]);incByMonth[k].push(h);});
      const allMonthKeys=new Set([...Object.keys(txByMonth),...Object.keys(incByMonth)]);
      allMonthKeys.forEach(k=>{
        const [ys,ms]=k.split('-');const y=parseInt(ys),m=parseInt(ms);
        const expenses=(txByMonth[k]||[]).reduce((s,t)=>s+(t.amount||0),0);
        const income=(incByMonth[k]||[]).reduce((s,i)=>s+(i.amtNGN||i.amount||0),0);
        if(!expenses&&!income) return;
        const existIdx=hist.findIndex(h=>h.year===y&&h.month===m);
        if(existIdx>=0){
          // Always override with live scan — historicalSummary can be stale
          hist[existIdx].expenses=expenses;
          hist[existIdx].income=income;
        } else {
          hist.push({year:y,month:m,label:MS2[m-1]+" '"+String(y).slice(2),income,expenses});
          histKeys.add(k);
        }
      });
    }catch(e){
      // Firestore scan failed — fall back to localStorage only
      for(let y=2023;y<=new Date().getFullYear();y++){
        for(let m=1;m<=12;m++){
          const key=`${y}-${m}`;
          if(histKeys.has(key)) continue;
          const txns=cGet(CK.txns(m,y));
          const inc=cGet(CK.inc(m,y));
          if(!txns&&!inc) continue;
          const expenses=(txns||[]).reduce((s,t)=>s+(t.amount||0),0);
          const income=(inc||[]).reduce((s,i)=>s+(i.amtNGN||i.amount||0),0);
          if(!expenses&&!income) continue;
          hist.push({year:y,month:m,label:MS2[m-1]+" '"+String(y).slice(2),income,expenses});
          histKeys.add(key);
        }
      }
    }
    // Sort chronologically
    hist.sort((a,b)=>a.year!==b.year?a.year-b.year:a.month-b.month);
    // Always override the current month with live in-memory totals
    // so the history summary row is never stale for the active month
    const cm=S.expMonth,cy=S.expYear;
    const liveExp=S.txns.reduce((s,t)=>s+(t.amount||0),0);
    const liveInc=S.income.reduce((s,i)=>s+(i.amtNGN||i.amount||0),0);
    const ci=hist.findIndex(h=>h.year===cy&&h.month===cm);
    if(ci>=0){hist[ci].expenses=liveExp;hist[ci].income=liveInc;}
    else if(liveExp||liveInc){const MS2b=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];hist.push({year:cy,month:cm,label:MS2b[cm-1]+" '"+String(cy).slice(2),income:liveInc,expenses:liveExp});hist.sort((a,b)=>a.year!==b.year?a.year-b.year:a.month-b.month);}
    if(hist.length){
      cSet('sw3_history',hist);
      // Write corrected totals back to Firestore historicalSummary so it stays accurate
      try{
        hist.forEach(h=>{
          const docId=`${h.year}-${String(h.month).padStart(2,'0')}`;
          db.collection('historicalSummary').doc(docId).set({
            year:h.year,month:h.month,
            label:h.label,income:h.income,expenses:h.expenses
          },{merge:true}).catch(()=>{});
        });
      }catch(e){}
      // Re-render now that we have authoritative history from Firebase
      renderAll();
    }
  }catch(e){
    // On error, try to build entirely from localStorage cache
    _buildHistoryFromCache();
  }
}

// ── Automatic month-end close ──────────────────────────────────────────────
// On the first app load after the real-world calendar month has rolled over,
// permanently freeze the month(s) that just ended into historicalSummary
// with an income/expenses/closing-cash snapshot marked closed:true. This
// runs automatically on boot — no manual export or button press needed.
async function _checkMonthEndClose(){
  if(!db) return;
  try{
    const _now=new Date();
    const curY=_now.getFullYear(),curM=_now.getMonth()+1;
    const lastSeen=localStorage.getItem('sw3_last_seen_ym'); // 'YYYY-M'
    localStorage.setItem('sw3_last_seen_ym',`${curY}-${curM}`);
    if(!lastSeen) return; // first ever run on this device — nothing to close retroactively
    const [ly,lm]=lastSeen.split('-').map(Number);
    if(!ly||!lm) return;
    if(ly===curY&&lm===curM) return; // still the same month — nothing has closed
    const MS2=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    let y=ly,m=lm,closedAny=0;
    // Walk every month from the last time the app was opened up to (but not
    // including) the current real month, closing each not already closed.
    while(y<curY||(y===curY&&m<curM)){
      const docId=sid(m,y);
      try{
        const existing=await db.collection('historicalSummary').doc(docId).get();
        if(!(existing.exists&&existing.data()?.closed)){
          const [txSnap,incSnap,cashDoc]=await Promise.all([
            db.collection('transactions').where('year','==',y).where('month','==',m).get(),
            db.collection('income').where('year','==',y).where('month','==',m).get(),
            db.collection('cashBalances').doc(docId).get(),
          ]);
          const expenses=txSnap.docs.reduce((s,d)=>s+(d.data().amount||0),0);
          const income=incSnap.docs.reduce((s,d)=>s+(d.data().amtNGN||d.data().amount||0),0);
          let closingCash=0;
          if(cashDoc.exists){
            const cd=cashDoc.data()||{};
            const fxR=getFxRates(m,y);
            getCashAccounts().forEach(acct=>{
              const v=cd[acct]||0;
              closingCash+=isUSDCashAccount(acct)?v*(fxR.USD||1600):v;
            });
          }
          await db.collection('historicalSummary').doc(docId).set({
            year:y,month:m,label:MS2[m-1]+" '"+String(y).slice(2),
            income,expenses,closingCash,closed:true,
            closedAt:firebase.firestore.FieldValue.serverTimestamp()
          },{merge:true});
          closedAny++;
        }
      }catch(e){/* skip this month on error, still try the next */}
      m++;if(m>12){m=1;y++;}
    }
    if(closedAny) toast(`${closedAny} month${closedAny>1?'s':''} closed and archived`);
  }catch(e){console.warn('month-end close check failed:',e);}
}

function _buildHistoryFromCache(){
  const MS2=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const hist=[];
  for(let y=2023;y<=new Date().getFullYear();y++){
    for(let m=1;m<=12;m++){
      const txns=cGet(CK.txns(m,y));
      const inc=cGet(CK.inc(m,y));
      if(!txns&&!inc) continue;
      const expenses=(txns||[]).reduce((s,t)=>s+(t.amount||0),0);
      const income=(inc||[]).reduce((s,i)=>s+(i.amtNGN||i.amount||0),0);
      if(!expenses&&!income) continue;
      hist.push({year:y,month:m,label:MS2[m-1]+" '"+String(y).slice(2),income,expenses});
    }
  }
  if(hist.length){
    // Override current month with live totals
    const cm=S.expMonth,cy=S.expYear;
    const liveExp=S.txns.reduce((s,t)=>s+(t.amount||0),0);
    const liveInc=S.income.reduce((s,i)=>s+(i.amtNGN||i.amount||0),0);
    const ci=hist.findIndex(h=>h.year===cy&&h.month===cm);
    if(ci>=0&&(liveExp||liveInc)){hist[ci].expenses=liveExp;hist[ci].income=liveInc;}
    cSet('sw3_history',hist);
  }
}

async function loadBudgets(m,y){
  const local=cGet(CK.budgets(m,y));
  if(local&&Object.keys(local).length>0){S.budgets=local;} // instant paint from cache
  // Always refresh from Firestore so a budget edited on another device is
  // picked up (previously this returned early on any cache hit and a
  // remote edit was never seen until the local cache was cleared).
  try{const doc=await db.collection('budgets').doc(sid(m,y)).get();
    if(doc.exists&&doc.data()?.categories){
      S.budgets={...DEF_BUDGETS,...doc.data().categories};
      cSet(CK.budgets(m,y),S.budgets);
    }else if(!local&&getBudgetRollover()){
      // No budget saved for this month yet — check whether rollover is on
      // and copy the previous month's categories in as a starting point.
      const prevM=m===1?12:m-1,prevY=m===1?y-1:y;
      try{
        const pd=await db.collection('budgets').doc(sid(prevM,prevY)).get();
        if(pd.exists&&pd.data()?.categories){
          S.budgets={...DEF_BUDGETS,...pd.data().categories};
          cSet(CK.budgets(m,y),S.budgets);
        }
      }catch(e){_warnLoad('loadBudgets (prior-month fallback)',e);}
    }
  }catch(e){_warnLoad('loadBudgets',e);}
}

function reloadMonth(m,y){
  S.expMonth=m;S.expYear=y;S.expCat='All';
  S.txns=cGet(CK.txns(m,y))||[];
  S.income=cGet(CK.inc(m,y))||[];
  S.investments=cGet(CK.inv(m,y))||{};
  S.budgets=cGet(CK.budgets(m,y))||{...DEF_BUDGETS};
  renderExpenses();renderDashboard();
  if(document.getElementById('inc-pane')?.style.display!=='none') renderIncome();
  if(db&&navigator.onLine){
    setSyncStatus('syncing');
    Promise.all([loadTxns(m,y),loadIncome(m,y),loadInvData(m,y),loadBudgets(m,y)])
      .then(()=>{
        if(S.expMonth===m&&S.expYear===y){
          S.txns=cGet(CK.txns(m,y))||S.txns;
          S.income=cGet(CK.inc(m,y))||S.income;
          S.investments=cGet(CK.inv(m,y))||S.investments;
          S.budgets=cGet(CK.budgets(m,y))||S.budgets;
          setSyncStatus('synced');renderExpenses();renderDashboard();renderInvestments();
          if(document.getElementById('inc-pane')?.style.display!=='none') renderIncome();
        }
      }).catch(()=>setSyncStatus('error'));
    startRealtimeListeners();
  }
}

// ══════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════════════════
// Haptic feedback — gracefully no-ops where Vibration API isn't supported
function haptic(pattern=[10]){try{if(navigator.vibrate) navigator.vibrate(pattern);}catch{}}

// Jumps straight to the Analytics → AI tab (used by the Gemini FAB)
function openAiInsight(){
  navTo('forecast');
  const btn=document.getElementById('proj-tab-ai');
  if(btn) projTab('ai',btn);
}

function navTo(pg, deepCat){
  S.page=pg;
  try{localStorage.setItem('sw3_last_page',pg);}catch(e){}
  document.querySelectorAll('.pg').forEach(p=>p.classList.remove('active'));
  document.getElementById('pg-'+pg).classList.add('active');
  document.querySelectorAll('.bn').forEach(n=>n.classList.toggle('active',n.dataset.pg===pg));
  document.getElementById('app-body').scrollTop=0;
  const fab=document.getElementById('fab');
  if(pg==='forecast'){
    fab.className='fab fab-ai';
    fab.innerHTML='<img src="Logos/Gemini.webp" alt="AI">';
    fab.onclick=()=>openAiInsight();
  }else if(['dashboard','expenses','accounts','debtors'].includes(pg)){
    fab.className='fab';
    fab.innerHTML='+';
    fab.onclick=pg==='debtors'?()=>openDebMod():()=>openExpModal('expense');
  }else{
    fab.className='fab hidden';
  }
  if(pg==='expenses'&&deepCat){
    S.expCat=deepCat;
    renderExpenses();
    setTimeout(()=>{const el=document.getElementById('exp-summary');if(el)el.scrollIntoView({behavior:'smooth',block:'start'});},80);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// DASHBOARD PERIOD SELECTOR
// ══════════════════════════════════════════════════════════════════════════
function initPeriodSelector(){
  const yearSel=document.getElementById('dash-year');
  const monthSel=document.getElementById('dash-month-sel');
  // Years from 2023 to current
  const yrs=[2026,2025,2024,2023];
  yearSel.innerHTML=yrs.map(y=>`<option value="${y}">${y}</option>`).join('');
  yearSel.value=S.dashYear;
  updateMonthOptions();
  monthSel.value=S.dashMonth;
}

function updateMonthOptions(){
  const y=parseInt(document.getElementById('dash-year').value);
  const monthSel=document.getElementById('dash-month-sel');
  const maxM=12;
  const minM=y===2023?11:1;
  const opts=[{value:0,label:'Full Year'}];
  for(let m=minM;m<=maxM;m++) opts.push({value:m,label:MONTHS[m-1]});
  monthSel.innerHTML=opts.map(o=>`<option value="${o.value}">${o.label}</option>`).join('');
  monthSel.value=S.dashMonth;
}

function dashPeriodChange(){
  const newYear=parseInt(document.getElementById('dash-year').value);
  const newMonth=parseInt(document.getElementById('dash-month-sel').value);
  const newCur=document.getElementById('dash-currency').value;
  const curOnly=(newYear===S.dashYear&&newMonth===S.dashMonth&&newCur!==S.dashCurrency);
  S.dashYear=newYear;S.dashMonth=newMonth;S.dashCurrency=newCur;
  cSet(CK.currency,newCur);
  updateMonthOptions();
  if(curOnly){renderDashboard();renderExpenses();renderForecast();renderInvestments();renderCashPage();return;}
  if(S.dashMonth>0){
    S.expMonth=S.dashMonth;S.expYear=S.dashYear;
    S.txns=cGet(CK.txns(S.dashMonth,S.dashYear))||[];
    S.income=cGet(CK.inc(S.dashMonth,S.dashYear))||[];
    S.investments=cGet(CK.inv(S.dashMonth,S.dashYear))||{};
    S.cash=cGet(CK.cash(S.dashMonth,S.dashYear))||{};
    S.budgets=cGet(CK.budgets(S.dashMonth,S.dashYear))||{...DEF_BUDGETS};
  }
  renderDashboard();renderExpenses();renderForecast();renderInvestments();renderCashPage();
  if(db&&navigator.onLine&&S.dashMonth>0){
    const m=S.dashMonth,y=S.dashYear;
    setSyncStatus('syncing');
    Promise.all([loadTxns(m,y),loadIncome(m,y),loadInvData(m,y),loadCashData(m,y)])
      .then(()=>{
        if(S.expMonth===m&&S.expYear===y){
          S.txns=cGet(CK.txns(m,y))||S.txns;
          S.income=cGet(CK.inc(m,y))||S.income;
          S.investments=cGet(CK.inv(m,y))||S.investments;
          S.cash=cGet(CK.cash(m,y))||S.cash;
          setSyncStatus('synced');renderDashboard();renderExpenses();renderInvestments();
        }
      }).catch(()=>setSyncStatus('error'));
    startRealtimeListeners();
  }
}

// ══════════════════════════════════════════════════════════════════════════
// RENDER ALL
// ══════════════════════════════════════════════════════════════════════════
function _showRenderErr(name,e){
  let bar=document.getElementById('_render-err-bar');
  if(!bar){bar=document.createElement('div');bar.id='_render-err-bar';bar.style.cssText='position:fixed;top:0;left:0;right:0;z-index:9999;background:#c0392b;color:#fff;font-size:0.72rem;padding:8px 12px;font-family:monospace;white-space:pre-wrap;word-break:break-all;max-height:40vh;overflow:auto';document.body.appendChild(bar);}
  bar.textContent+='['+name+']: '+e.message+'\n';
}
function renderAll(){
  const n=new Date();
  const _hdrDate=document.getElementById('hdr-date');if(_hdrDate)_hdrDate.textContent=MS[n.getMonth()].toUpperCase()+' '+n.getFullYear();
  initPeriodSelector();
  const _rf=[['applyDashOrder',applyDashOrder],['renderDashboard',renderDashboard],['renderExpenses',renderExpenses],['renderInvestments',renderInvestments],['renderCashPage',renderCashPage],['renderDebtors',renderDebtors],['renderLoans',renderLoans],['renderForecast',renderForecast],['renderSettings',renderSettings],['renderRecurringCard',renderRecurringCard],['renderGoalsCard',renderGoalsCard]];
  _rf.forEach(([name,fn])=>{try{fn();}catch(e){console.error('renderAll: '+name+' threw',e);_showRenderErr(name,e);}});
  try{
    const lastPg=localStorage.getItem('sw3_last_page');
    const valid=['dashboard','expenses','accounts','forecast','settings'];
    if(lastPg&&valid.includes(lastPg)&&lastPg!=='dashboard') navTo(lastPg);
  }catch(e){}
}

// ══════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════════════════
function renderDashboard(){
  const m=S.dashMonth,y=S.dashYear,cur=S.dashCurrency;
  const _cs=document.getElementById('dash-currency');if(_cs&&_cs.value!==cur)_cs.value=cur;
  // Keep all tab currency selects in sync
  ['exp-currency','acct-currency','forecast-currency'].forEach(id=>{const el=document.getElementById(id);if(el&&el.value!==cur)el.value=cur;});
  const isFullYear=m===0;
  const periodLabel=isFullYear?`${y} — Full Year`:`${MONTHS[m-1]} ${y}`;
  document.getElementById('dash-period-label').textContent=periodLabel;
  document.getElementById('dash-month-label').textContent=isFullYear?`${y}`:`${MONTHS[m-1]}`;

  // Get transactions for period
  let txns=S.txns,incList=S.income;
  if(isFullYear){
    // For full year, use HISTORY data
    const hYear=getHistory().filter(h=>h.year===y);
    const totalInc=hYear.reduce((s,h)=>s+(h.income||0),0);
    const totalExp=hYear.reduce((s,h)=>s+(h.expenses||0),0);
    txns=[];incList=[];
    renderDashFullYear(y,totalInc,totalExp,cur);
    return;
  }

  const spent=txns.reduce((s,t)=>s+(t.amount||0),0);
  const incTotal=incList.reduce((s,i)=>s+(i.amtNGN||i.amount||0),0);
  // Keep sw3_history current month entry in sync with live data
  (()=>{
    const hist=cGet('sw3_history')||[];
    const ci=hist.findIndex(h=>h.year===y&&h.month===m);
    const liveExp=spent, liveInc=incTotal||0;
    if(ci>=0&&(liveExp!==hist[ci].expenses||liveInc!==hist[ci].income)){
      hist[ci].expenses=liveExp;hist[ci].income=liveInc;cSet('sw3_history',hist);
    }
  })();
  // Also check HISTORY for this month
  const histEntry=getHistory().find(h=>h.year===y&&h.month===m);
  const incomeDisplay=incTotal>0?incTotal:(histEntry?histEntry.income:0);

  const budgTotal=Object.values(S.budgets).reduce((s,v)=>s+(v||0),0);
  const cash=S.cash;
  const _fxR=getFxRates(m,y);
  const _nwCfg=getNWConfig();
  const _nwAccts=_nwCfg.cashAccounts||getCashAccounts();
  const cashTotal=_nwAccts.reduce((s,b)=>{const v=cash[b]||0;return s+(isUSDCashAccount(b)?v*(_fxR.USD||1650):v);},0);
  const inv=S.investments;
  const invTotal=_nwCfg.includeInvestments!==false?PLATFORMS.reduce((s,p)=>{
    const meta=getInvPlatformMeta(p.key);
    const isFI=meta.assetClass==='fixed_income';
    if(isFI&&_nwCfg.includeFixedIncome===false) return s;
    if(!isFI&&_nwCfg.includeEquities===false) return s;
    // Use sub principals (same source as accounts page) to avoid stale Firestore totals
    const subs=getSubsForPlatform(p.key);
    const bal=subs.length?subs.reduce((ss,sub)=>ss+(Number(sub.principal)||0),0):(S.investments[p.key]||0);
    return s+bal;
  },0):0;
  // Full portfolio total — ALL platforms, regardless of the Net Worth include
  // toggles. The Investments stat card always shows the complete figure (the
  // Net Worth number above is what honours the include config). Matches the
  // total shown by drillDown('investments').
  const invTotalAll=PLATFORMS.reduce((s,p)=>{
    const subs=getSubsForPlatform(p.key);
    const bal=subs.length?subs.reduce((ss,sub)=>ss+(Number(sub.principal)||0),0):(S.investments[p.key]||0);
    return s+bal;
  },0);
  const debtNW=_nwCfg.includeDebtors!==false?S.debtors.filter(d=>d.expectRepayment!==false).reduce((s,d)=>s+(d.ngnBalance||0),0):0;
  const nw=invTotal+cashTotal+debtNW;
  const _nwParts=[_nwCfg.includeInvestments!==false?'Investments':null,_nwAccts.length?'Cash':null,_nwCfg.includeDebtors!==false&&debtNW?'Debtors':null].filter(Boolean);
  document.getElementById('dash-nw').innerHTML=maskIf('nw',fmtCur(nw,cur,m,y)||'—');
  const _nwEye=document.getElementById('nw-eye');if(_nwEye)_nwEye.innerHTML=eyeBtn('nw','renderDashboard');
  document.getElementById('dash-nw-sub').innerHTML=`${_nwParts.join(' + ')} · ${MONTHS[m-1]} ${y}`+_getNWDeltaBadge(m,y);

  const st=bSt(spent,budgTotal);
  // MoM comparison — pull previous month from cache/history
  const prevM=m===1?12:m-1,prevY=m===1?y-1:y;
  const prevTxns=cGet(CK.txns(prevM,prevY))||[];
  const prevHist=getHistory().find(h=>h.year===prevY&&h.month===prevM);
  const prevSpent=prevTxns.length?prevTxns.reduce((s,t)=>s+(t.amount||0),0):(prevHist?.expenses||0);
  const prevIncHist=cGet(CK.inc(prevM,prevY))||[];
  const prevIncAmt=prevIncHist.length?prevIncHist.reduce((s,i)=>s+(i.amount||0),0):(prevHist?.income||0);
  const momBadge=(cur2,prev,invertGood)=>{
    if(!prev||prev===0) return '';
    const pct=Math.round((cur2-prev)/prev*100);
    if(pct===0) return '';
    const up=pct>0;const good=invertGood?!up:up;
    return`<span class="mom-badge ${good?'mom-dn':'mom-up'}">${up?'+':''}${pct}%</span>`;
  };
  // ── Safe-to-spend: remaining budget ÷ days left, shown only for the live month ──
  const _now=new Date();
  const _isLiveMonth=(m===_now.getMonth()+1&&y===_now.getFullYear());
  let _spentFooter=`${fmtCur(budgTotal-spent,cur,m,y)} left`;
  if(_isLiveMonth&&budgTotal>0){
    const _diM=new Date(y,m,0).getDate();
    const _daysLeft=Math.max(1,_diM-_now.getDate()+1);
    const _safe=Math.max(0,budgTotal-spent)/_daysLeft;
    const _over=spent>budgTotal;
    _spentFooter=_over
      ?`<span style="color:var(--red)">Over by ${fmtCur(spent-budgTotal,cur,m,y)}</span>`
      :`<span title="Remaining budget ÷ ${_daysLeft} days left">${fmtCur(_safe,cur,m,y)}/day safe · ${_daysLeft}d left</span>`;
  }
  document.getElementById('dash-stats').innerHTML=`
    <div class="card card-sm" style="margin-bottom:0;cursor:pointer" onclick="drillDown('expenses')"><div class="clabel">Spent ›${eyeBtn('dash-spent','renderDashboard')}</div><div class="cval-sm">${maskIf('dash-spent',fmtCur(spent,cur,m,y))}${momBadge(spent,prevSpent,true)}</div><div class="prog"><div class="pf ${st}" style="width:${budgTotal?Math.min(spent/budgTotal*100,100):0}%"></div></div><div class="csub">${_isHidden('dash-spent')?'<span class="masked">••••••</span>':_spentFooter}</div></div>
    <div class="card card-sm" style="margin-bottom:0;cursor:pointer" onclick="drillDown('income')"><div class="clabel">Income ›${eyeBtn('dash-income','renderDashboard')}</div><div class="cval-sm" style="color:var(--accent)">${maskIf('dash-income',fmtCur(incomeDisplay,cur,m,y))}${momBadge(incomeDisplay,prevIncAmt,false)}</div><div class="csub">This month</div></div>
    <div class="card card-sm" style="margin-bottom:0;cursor:pointer" onclick="drillDown('cash')"><div class="clabel">Cash ›${eyeBtn('dash-cash','renderDashboard')}</div><div class="cval-sm">${cashTotal?maskIf('dash-cash',fmtCur(cashTotal,cur,m,y)):'—'}</div><div class="csub">All accounts</div></div>
    <div class="card card-sm" style="margin-bottom:0;cursor:pointer" onclick="drillDown('investments')"><div class="clabel">Investments ›${eyeBtn('dash-inv','renderDashboard')}</div><div class="cval-sm">${invTotalAll?maskIf('dash-inv',fmtCur(invTotalAll,cur==='NATIVE'?'NGN':cur,m,y)):'—'}</div><div class="csub">All platforms</div></div>
  `;

  // Category spend
  const catSpend={};
  txns.forEach(t=>{catSpend[t.category]=(catSpend[t.category]||0)+(t.amount||0);});

  // MoM commentary sentence (catSpend now available)
  (()=>{
    const el=document.getElementById('dash-commentary');
    if(!el) return;
    if(!prevSpent){el.textContent='';return;}
    const diff=spent-prevSpent;
    const pct=Math.abs(Math.round((diff/prevSpent)*100));
    if(pct<2){el.textContent='Spending is in line with last month.';return;}
    const dir=diff>0?'higher':'lower';
    const col=diff>0?'var(--red)':'var(--accent)';
    const prevCatSpend={};
    (cGet(CK.txns(prevM,prevY))||[]).forEach(t=>{prevCatSpend[t.category]=(prevCatSpend[t.category]||0)+(t.amount||0);});
    const catDiffs=Object.keys({...catSpend,...prevCatSpend}).map(c=>({c,d:(catSpend[c]||0)-(prevCatSpend[c]||0)}));
    catDiffs.sort((a,b)=>Math.abs(b.d)-Math.abs(a.d));
    const top=catDiffs[0];
    const driver=top&&Math.abs(top.d)>5000?`, driven by ${top.d>0?'a rise in':'a drop in'} <strong>${top.c}</strong>`:'';
    el.innerHTML=`Spending is <span style="color:${col};font-weight:600">${fmtCur(Math.abs(diff),cur,m,y)} (${pct}%) ${dir}</span> vs last month${driver}.`;
  })();

  // Expense chart
  renderCatChart(catSpend,cur,m,y);

  // Spend vs budget
  const allCats=[...new Set([...CATS,...Object.keys(catSpend)])];
  // Only show categories with actual spend; budgets still count in total for the Spent card
  const catRows=allCats.filter(c=>catSpend[c]>0).map(c=>({cat:c,spent:catSpend[c]||0,budg:S.budgets[ck(c)]||0})).sort((a,b)=>b.spent-a.spent);
  const _catRowHtml=r=>{
    const st=bSt(r.spent,r.budg);const pct=r.budg?Math.min(r.spent/r.budg*100,100):0;
    const icn=isMonarch()?catBadge(r.cat):`<span style="margin-right:5px">${CAT_ICONS[r.cat]||''}</span>`;
    return`<div class="cr"><div class="cr-top"><span class="cr-name">${icn}${r.cat}</span><div class="cr-vals"><span class="cr-spent" style="color:${st==='over'?'var(--red)':st==='warn'?'var(--gold)':'var(--text)'}">${fmtCur(r.spent,cur,m,y)}</span>${r.budg?`<span class="cr-budg">/ ${fmtCur(r.budg,cur,m,y)}</span>`:''}</div></div><div class="prog"><div class="pf ${st}" style="width:${pct}%"></div></div></div>`;
  };
  if(isMonarch()&&catRows.length){
    // Monarch: category-group rollups (parent totals + child rows)
    const grouped={};
    catRows.forEach(r=>{const g=catGroupOf(r.cat);(grouped[g]=grouped[g]||[]).push(r);});
    const gEntries=Object.entries(grouped).map(([g,rows])=>({g,rows,spent:rows.reduce((s,r)=>s+r.spent,0),budg:rows.reduce((s,r)=>s+r.budg,0)})).sort((a,b)=>b.spent-a.spent);
    document.getElementById('dash-cats').innerHTML=gEntries.map(ge=>{
      const gst=bSt(ge.spent,ge.budg);
      return`<div style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0 5px">
          <span style="font-size:0.64rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text2)">${ge.g}</span>
          <span style="font-size:0.64rem;font-family:var(--mono);color:${gst==='over'?'var(--red)':'var(--text2)'}">${fmtCur(ge.spent,cur,m,y)}${ge.budg?` / ${fmtCur(ge.budg,cur,m,y)}`:''}</span>
        </div>
        ${ge.rows.map(_catRowHtml).join('')}
      </div>`;
    }).join('');
  }else{
    document.getElementById('dash-cats').innerHTML=catRows.length?catRows.map(_catRowHtml).join(''):'<div class="empty"><div class="empty-i">↕</div>No expenses this month</div>';
  }

  // Cash (collapsible card)
  const cashAccts=getCashAccounts();
  const cashBadgeEl=document.getElementById('dash-cash-badge');
  if(cashBadgeEl) cashBadgeEl.innerHTML=cashTotal?maskIf('dash-cash-list',fmtCur(cashTotal,cur,m,y)):'—';
  const cashEyeEl=document.getElementById('dash-cash-eye');
  if(cashEyeEl) cashEyeEl.innerHTML=eyeBtn('dash-cash-list','renderDashboard');
  const cashBodyEl=document.getElementById('dash-cash-body');
  if(cashBodyEl) cashBodyEl.innerHTML=cashAccts.map((b,i)=>{const val=cash[b]||0;const pct=cashTotal?Math.round((isUSDCashAccount(b)?val*(_fxR.USD||1650):val)/cashTotal*100):0;const dispVal=isUSDCashAccount(b)?(cur==='NATIVE'?'$'+val.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):fmtCur(val*(_fxR.USD||1650),cur,m,y)):fmtCur(val,cur,m,y);return`<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;${i<cashAccts.length-1?'border-bottom:1px solid var(--border)':''};cursor:pointer" onclick="drillDownAccount('${jsq(b)}')"><div style="display:flex;align-items:center;gap:8px">${bankLogoEl(b,22)}<div><div style="font-size:0.78rem;font-weight:600">${b}</div><div style="font-size:0.62rem;color:var(--text2);font-family:var(--mono);margin-top:1px">${pct}% of total</div></div></div><div style="font-family:var(--mono);font-size:0.86rem;color:${val?'var(--blue)':'var(--text3)'};">${val?maskIf('dash-cash-list',dispVal):'—'}</div></div>`;}).join('');

  // Investments (collapsible card) — always use migrateToSubs so legacy flat data is picked up
  PLATFORMS=getPlatforms();
  const dashInvTotal=PLATFORMS.reduce((s,p)=>{
    const subs=migrateToSubs(p.key);
    const subTotal=subs.reduce((ss,sb)=>ss+(Number(sb.principal)||0),0);
    return s+(subTotal>0?subTotal:(inv[p.key]||0));
  },0);
  document.getElementById('dash-inv-total').innerHTML=dashInvTotal?maskIf('dash-inv-list',fmtCur(dashInvTotal,cur==='NATIVE'?'NGN':cur,m,y)):'—';
  const invEyeEl=document.getElementById('dash-inv-eye');
  if(invEyeEl) invEyeEl.innerHTML=eyeBtn('dash-inv-list','renderDashboard');
  document.getElementById('dash-inv').innerHTML=PLATFORMS.map(p=>{
    const subs=migrateToSubs(p.key);
    const subTotal=subs.reduce((s,sb)=>s+(Number(sb.principal)||0),0);
    const val=subTotal>0?subTotal:(inv[p.key]||0);
    const pct=dashInvTotal>0?((val/dashInvTotal)*100).toFixed(1):'0.0';
    const dispVal=fmtPlatformVal(val,p.key,cur,m,y);
    const badge=`<span style="font-size:0.56rem;padding:1px 4px;border-radius:3px;background:var(--bg3);color:var(--text3);margin-left:4px">${p.currency}</span>`;
    return`<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="drillDownInvPlatform('${p.key}')"><div style="display:flex;align-items:center;gap:8px">${platformLogoEl(p.key,p.color,22)}<div><div style="font-size:0.78rem;font-weight:600">${p.label}${badge}</div><div style="font-size:0.62rem;color:var(--text2);font-family:var(--mono)">${pct}%</div></div></div><div style="font-family:var(--mono);font-size:0.84rem;color:${val?p.color:'var(--text3)'};">${val?maskIf('dash-inv-list',dispVal):'—'}</div></div>`;
  }).join('');
  const active=PLATFORMS.filter(p=>{const subs=migrateToSubs(p.key);const st=subs.reduce((s,sb)=>s+(Number(sb.principal)||0),0);return(st>0?st:(inv[p.key]||0))>0;});
  document.getElementById('dash-abar').innerHTML=dashInvTotal&&active.length?active.map(p=>{const subs=migrateToSubs(p.key);const st=subs.reduce((s,sb)=>s+(Number(sb.principal)||0),0);const val=st>0?st:(inv[p.key]||0);return`<div style="flex:${val};background:${p.color};opacity:0.8"></div>`;}).join(''):'';

  // 6-Month Trend
  const recent=getHistory().slice(-6);
  if(S.trendChart) S.trendChart.destroy();
  const tctx=document.getElementById('trend-chart').getContext('2d');
  const trendLabelPlugin={id:'trendLabels',afterDatasetsDraw(chart){
    const {ctx:c,data,scales:{x,y}}=chart;
    [0,1].forEach(dsIdx=>{
      const ds=data.datasets[dsIdx];
      ds.data.forEach((val,i)=>{
        if(!val) return;
        const xp=x.getPixelForValue(i)+(dsIdx===0?-10:10);
        const yp=y.getPixelForValue(val);
        const lbl=(val/1e6).toFixed(2)+'M';
        c.save();c.font='bold 7.5px DM Mono, monospace';
        c.fillStyle=dsIdx===0?'rgba(20,184,166,0.9)':'rgba(96,165,250,0.9)';
        c.textAlign='center';
        c.fillText(lbl,xp,yp-5);
        c.restore();
      });
    });
  }};
  S.trendChart=new Chart(tctx,{type:'bar',data:{labels:recent.map(d=>d.label),datasets:[
    {label:'Expenses',data:recent.map(d=>d.expenses||0),backgroundColor:'rgba(20,184,166,0.75)',borderRadius:3,borderSkipped:false,order:2},
    {label:'Income',data:recent.map(d=>d.income||0),backgroundColor:'rgba(96,165,250,0.4)',borderRadius:3,borderSkipped:false,order:2},
    {label:'Savings %',data:recent.map(d=>d.income>0?Math.round((d.income-d.expenses)/d.income*100):0),type:'line',borderColor:'#fbbf24',backgroundColor:'transparent',borderWidth:2,pointBackgroundColor:'#fbbf24',pointRadius:3,tension:0.3,yAxisID:'y2',order:1}
  ]},options:{responsive:true,maintainAspectRatio:true,plugins:{legend:{display:false},tooltip:{backgroundColor:'#161b25',borderColor:'#252d3d',borderWidth:1,callbacks:{label:c=>c.dataset.label==='Savings %'?c.parsed.y.toFixed(1)+'%':fmtChartNGN(c.parsed.y)}}},scales:{x:{grid:{display:false},ticks:{color:'#7d8fa8',font:{family:'DM Mono',size:9}},border:{display:false}},y:{display:false},y2:{display:false,min:-20,max:100}},barPercentage:0.72},plugins:[trendLabelPlugin]});

  // Net Worth trend
  renderNWTrendChart();

  // Monarch chart-forward hero (no-op in Classic)
  renderNWHeroChart();

  // Recent transactions
  const recEl=document.getElementById('dash-recent');
  const combined=[...txns.map(t=>({...t,type:'exp'})),...incList.map(t=>({...t,type:'inc'}))].sort((a,b)=>a.date>b.date?-1:a.date<b.date?1:txnTs(b.createdAt)-txnTs(a.createdAt)).slice(0,5);
  if(!combined.length){recEl.innerHTML='<div class="empty"><div class="empty-i">↕</div>No transactions yet</div>';}
  else{recEl.innerHTML='<div class="txlist">'+combined.map(tx=>{
    const _lbl=tx.category?(isMonarch()?catBadge(tx.category)+tx.category:(CAT_ICONS[tx.category]||'')+' '+tx.category):esc(tx.payee)||'—';
    return`<div class="txi"><div><div class="txi-cat">${_lbl}</div><div class="txi-meta">${esc(tx.payee||tx.notes)||'—'} · ${fmtDate(tx.date)}</div></div><div class="${tx.type==='inc'?'txi-amt txi-inc':'txi-amt txi-exp'}">${tx.type==='inc'?'+':''}${fmtCur(tx.amount,cur,m,y)}</div></div>`;
  }).join('')+'</div>';}

  // Calendar
  renderDashCalendar(m, y, [...S.txns, ...S.income.map(i=>({...i,type:'inc'}))]);

  // Smart alerts
  renderDashAlerts();
}


// ══════════════════════════════════════════════════════════════════════════
// ALL TRANSACTIONS MODAL (dashboard "View all")
// ══════════════════════════════════════════════════════════════════════════
function openAllTxnsModal(){
  const m=S.dashMonth,y=S.dashYear,cur=S.dashCurrency||'NGN';
  const title=document.getElementById('all-txns-title');
  const body=document.getElementById('all-txns-body');
  if(!body) return;
  const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
  if(title) title.textContent=MONTHS[m-1]+' '+y+' — All Transactions';

  const all=[
    ...S.txns.map(t=>({...t,_type:'exp'})),
    ...S.income.map(i=>({...i,_type:'inc'}))
  ].sort((a,b)=>a.date>b.date?-1:a.date<b.date?1:txnTs(b.createdAt)-txnTs(a.createdAt));

  if(!all.length){
    body.innerHTML='<div class="empty"><div class="empty-i">↕</div>No transactions this month</div>';
    openMod('all-txns-modal');
    return;
  }

  // Group by date for day headers
  const groups=[];
  let curDate=null;
  all.forEach(tx=>{
    const d=tx.date?tx.date.slice(0,10):'';
    if(d!==curDate){curDate=d;groups.push({date:d,rows:[]});}
    groups[groups.length-1].rows.push(tx);
  });

  body.innerHTML=groups.map(g=>{
    const dateHdr=g.date?`<div style="font-size:0.62rem;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em;padding:10px 0 4px">${fmtDate(g.date)}</div>`:'';
    const rows=g.rows.map(tx=>{
      const isInc=tx._type==='inc';
      const icon=tx.category?(CAT_ICONS[tx.category]||''):'';
      const cat=tx.category||'Income';
      const sub=isInc?(tx.notes||tx.bank||''):(tx.payee&&tx.payee!==cat?esc(tx.payee):'')+(tx.bank?`<span style="color:var(--text3)"> · ${esc(tx.bank)}</span>`:'');
      const amt=`${isInc?'+':'−'}${fmtCur(tx.amount,cur,m,y)}`;
      const typeBadge=isInc
        ?`<span style="font-size:0.55rem;font-weight:700;color:var(--accent);background:rgba(52,211,153,0.12);border-radius:3px;padding:1px 4px;margin-left:4px">INC</span>`
        :'';
      return`<div class="txi" style="padding:7px 0;border-bottom:1px solid var(--border)">
        <div style="min-width:0;flex:1">
          <div class="txi-cat">${icon?icon+' ':''}${esc(cat)}${typeBadge}</div>
          ${sub?`<div class="txi-meta">${sub}</div>`:''}
        </div>
        <div class="txi-amt ${isInc?'txi-inc':'txi-exp'}" style="white-space:nowrap;margin-left:10px">${amt}</div>
      </div>`;
    }).join('');
    return dateHdr+rows;
  }).join('');

  openMod('all-txns-modal');
}

// ══════════════════════════════════════════════════════════════════════════
// DASHBOARD CALENDAR
// ══════════════════════════════════════════════════════════════════════════
function renderDashCalendar(m, y, txns){
  const el=document.getElementById('dash-calendar');
  if(!el) return;

  const MS_SHORT=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONTH_NAMES=['January','February','March','April','May','June','July','August','September','October','November','December'];

  // Build map: "YYYY-MM-DD" → [txn, ...]
  const byDate={};
  txns.forEach(tx=>{
    if(!tx.date) return;
    const key=tx.date.length===10?tx.date:tx.date.slice(0,10);
    if(!byDate[key]) byDate[key]=[];
    byDate[key].push(tx);
  });

  // Calendar grid
  const firstDay=new Date(y, m-1, 1).getDay(); // 0=Sun
  const daysInMonth=new Date(y, m, 0).getDate();
  const todayStr=(()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');})();

  let cells='';
  // Header
  cells+=MS_SHORT.map(d=>`<div class="dcal-hd">${d}</div>`).join('');
  // Empty leading cells
  for(let i=0;i<firstDay;i++) cells+=`<div class="dcal-cell dcal-empty"></div>`;
  // Day cells
  for(let d=1;d<=daysInMonth;d++){
    const dateStr=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayTxns=byDate[dateStr]||[];
    const count=dayTxns.length;
    const isToday=dateStr===todayStr;
    const hasTxns=count>0;
    const expCount=dayTxns.filter(t=>t.type!=='inc').length;
    const incCount=dayTxns.filter(t=>t.type==='inc').length;
    const badge=hasTxns?`<sup class="dcal-badge${incCount&&!expCount?' dcal-badge-inc':expCount&&!incCount?' dcal-badge-exp':''}">${count}</sup>`:'';
    cells+=`<div class="dcal-cell${isToday?' dcal-today':''}${hasTxns?' dcal-has':''}" onclick="${hasTxns?`showDayTxns('${dateStr}',event)`:''}"><span class="dcal-day">${d}${badge}</span></div>`;
  }

  el.innerHTML=`<div class="card" style="padding:12px 10px">
    <div class="sh" style="margin-bottom:10px"><div class="sh-title">📅 ${MONTH_NAMES[m-1]} ${y}</div></div>
    <div class="dcal-grid">${cells}</div>
  </div>`;
}

function showDayTxns(dateStr, evt){
  evt&&evt.stopPropagation();
  const m=S.expMonth,y=S.expYear;
  const cur=S.dashCurrency||'NGN';
  const all=[...S.txns,...S.income.map(i=>({...i,type:'inc'}))];
  const dayTxns=all.filter(tx=>{
    const k=tx.date&&tx.date.length>=10?tx.date.slice(0,10):tx.date;
    return k===dateStr;
  });
  if(!dayTxns.length) return;

  const d=new Date(dateStr);
  const label=d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});

  // Reuse existing modal or create inline popup
  let pop=document.getElementById('dcal-popup');
  if(!pop){
    pop=document.createElement('div');
    pop.id='dcal-popup';
    pop.className='dcal-popup';
    pop.innerHTML='<div class="dcal-popup-inner"><div class="dcal-popup-hd"><span id="dcal-popup-title"></span><button class="dcal-popup-close" onclick="this.closest(\'.dcal-popup\').style.display=\'none\'">✕</button></div><div id="dcal-popup-body"></div></div>';
    pop.onclick=e=>{if(e.target===pop)pop.style.display='none';};
    document.body.appendChild(pop);
  }
  document.getElementById('dcal-popup-title').textContent=label;
  document.getElementById('dcal-popup-body').innerHTML='<div class="txlist">'+dayTxns.map(tx=>{
    const isInc=tx.type==='inc';
    return`<div class="txi"><div><div class="txi-cat">${tx.category?(CAT_ICONS[tx.category]||'')+'\u00a0'+tx.category:esc(tx.payee)||'—'}</div><div class="txi-meta">${esc(tx.payee||tx.notes)||'—'}</div></div><div class="${isInc?'txi-amt txi-inc':'txi-amt txi-exp'}">${isInc?'+':'−'}${fmtCur(tx.amount,cur,m,y)}</div></div>`;
  }).join('')+'</div>';
  pop.style.display='flex';
}

// ══════════════════════════════════════════════════════════════════════════
// EMOJI PICKER
// ══════════════════════════════════════════════════════════════════════════
const EMOJI_GROUPS = {
  '🏠': ['🏠','🏡','🏗','🏢','🏦','🏪','⚡','💡','🔌','🚿','🛁','🛏','🪑','🧹','🧺','🧻','🪣','🔑','🚪'],
  '🍽️': ['🍽️','🍔','🍕','🌮','🥗','🥘','🍜','🍱','🛒','🥩','🥦','🧃','☕','🧂','🍞','🥚','🧈','🫙'],
  '👨‍👩‍👧‍👦': ['👨‍👩‍👧‍👦','🧒','👶','🧸','🎒','🏫','📚','✏️','🎨','🎭','⚽','🏀','🎮','🧩','🎪','🎠','🎡','🪁'],
  '🚗': ['🚗','🚕','🛻','🚙','⛽','🔧','🔩','🛞','🔋','🪛','🧰','🛣','🚦','🅿️','✈️','🚂','🛳','🚌'],
  '💊': ['💊','🏥','🩺','💉','🩹','🧴','🪥','💆','💅','🧖','💄','🪞','👗','👠','👟','👓','🕶','⌚'],
  '🎬': ['🎬','🎵','🎸','🎹','📺','🎭','🎟','🎪','⛳','🏊','🧘','🎳','♟','🎲','🃏','🎯','📷','🏖'],
  '💼': ['💼','📊','📈','💹','💰','💳','🏧','💵','💴','💶','💷','🤝','📋','🖥','📱','⌨️','🖨','📞'],
  '🎁': ['🎁','🎀','🎊','🎉','🥂','🪅','💐','🎂','🎈','🪴','🕯','🫶','❤️','🙏','👍','🌟','⭐','🌈'],
  '🌐': ['🌐','📡','📶','💻','🖥','📱','⌨️','🖱','💾','💿','📀','🔐','🔒','🛡','🔑','📧','📬','📮'],
  '📦': ['📦','🛍','📫','🗂','📁','🗑','📌','📎','✂️','🖊','📝','🗒','📅','⏰','🧲','🔦','🪜','🗝'],
};
const ALL_EMOJIS=Object.values(EMOJI_GROUPS).flat();

let _emojiCb=null, _emojiPanel=null, _emojiScrim=null, _emojiGroup=null, _emojiSearch='';

function openEmojiPicker(triggerEl, callback){
  closeEmojiPicker();
  _emojiCb=callback;

  // Create scrim
  _emojiScrim=document.createElement('div');
  _emojiScrim.className='emoji-scrim';
  _emojiScrim.onclick=closeEmojiPicker;
  document.body.appendChild(_emojiScrim);

  // Create panel
  _emojiPanel=document.createElement('div');
  _emojiPanel.className='emoji-panel';

  const search=document.createElement('input');
  search.className='emoji-search';
  search.placeholder='Search emoji…';
  search.oninput=e=>{_emojiSearch=e.target.value.toLowerCase();_renderEmojiGrid();};
  _emojiPanel.appendChild(search);

  const groups=document.createElement('div');
  groups.className='emoji-groups';
  Object.keys(EMOJI_GROUPS).forEach((g,i)=>{
    const btn=document.createElement('button');
    btn.className='emoji-group-btn'+(i===0?' active':'');
    btn.textContent=g;
    btn.onclick=()=>{
      _emojiGroup=g;_emojiSearch='';search.value='';
      groups.querySelectorAll('.emoji-group-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      _renderEmojiGrid();
    };
    groups.appendChild(btn);
  });
  _emojiPanel.appendChild(groups);

  const grid=document.createElement('div');
  grid.className='emoji-grid';
  grid.id='emoji-grid';
  _emojiPanel.appendChild(grid);
  _emojiGroup=Object.keys(EMOJI_GROUPS)[0];
  document.body.appendChild(_emojiPanel);
  _renderEmojiGrid();

  // Position below trigger
  const r=triggerEl.getBoundingClientRect();
  const panelW=Math.min(320,window.innerWidth-24);
  let left=r.left;
  let top=r.bottom+6;
  if(left+panelW>window.innerWidth-8) left=window.innerWidth-panelW-8;
  if(top+340>window.innerHeight) top=r.top-346;
  _emojiPanel.style.left=left+'px';
  _emojiPanel.style.top=top+'px';
  _emojiPanel.style.width=panelW+'px';
  setTimeout(()=>search.focus(),50);
}

function _renderEmojiGrid(){
  const grid=document.getElementById('emoji-grid');
  if(!grid) return;
  const list=_emojiSearch
    ? ALL_EMOJIS.filter(e=>e.includes(_emojiSearch))
    : (EMOJI_GROUPS[_emojiGroup]||ALL_EMOJIS);
  grid.innerHTML='';
  list.forEach(emoji=>{
    const btn=document.createElement('button');
    btn.className='emoji-btn';
    btn.textContent=emoji;
    btn.onclick=()=>{if(_emojiCb)_emojiCb(emoji);closeEmojiPicker();};
    grid.appendChild(btn);
  });
}

function closeEmojiPicker(){
  if(_emojiPanel){_emojiPanel.remove();_emojiPanel=null;}
  if(_emojiScrim){_emojiScrim.remove();_emojiScrim=null;}
  _emojiCb=null;_emojiSearch='';
}


// ── TRANSFER TYPE ─────────────────────────────────────────────────────────
let _xfrType = 'cash-cash';
function setXfrType(type){
  _xfrType=type;
  document.querySelectorAll('.xfr-type-btn').forEach(b=>b.classList.remove('active'));
  const btnMap={'cash-cash':'xfr-type-cc','cash-inv':'xfr-type-ci','inv-cash':'xfr-type-ic'};
  const btn=document.getElementById(btnMap[type]);if(btn)btn.classList.add('active');
  const fromLbl=document.getElementById('xfr-from-label');
  const toLbl=document.getElementById('xfr-to-label');
  const fromSel=document.getElementById('xfr2-from');
  const toSel=document.getElementById('xfr2-to');
  const cashOpts=cashOptsWithBal();
  const invOpts=invOptsWithBal();
  if(type==='cash-cash'){
    if(fromLbl)fromLbl.textContent='From Cash Account';
    if(toLbl)toLbl.textContent='To Cash Account';
    if(fromSel)fromSel.innerHTML=cashOpts;
    if(toSel)toSel.innerHTML=cashOpts;
  } else if(type==='cash-inv'){
    if(fromLbl)fromLbl.textContent='From Cash Account';
    if(toLbl)toLbl.textContent='To Investment Platform';
    if(fromSel)fromSel.innerHTML=cashOpts;
    if(toSel)toSel.innerHTML=invOpts;
  } else {
    if(fromLbl)fromLbl.textContent='From Investment Platform';
    if(toLbl)toLbl.textContent='To Cash Account';
    if(fromSel)fromSel.innerHTML=invOpts;
    if(toSel)toSel.innerHTML=cashOpts;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// NOTIFICATION BELL
// ══════════════════════════════════════════════════════════════════════════
function toggleNotifPanel(){
  const panel=document.getElementById('notif-panel');
  const scrim=document.getElementById('notif-scrim');
  const isOpen=panel.classList.contains('open');
  if(isOpen){closeNotifPanel();}
  else{_renderNotifList();panel.classList.add('open');scrim.style.display='block';}
}
function closeNotifPanel(){
  document.getElementById('notif-panel').classList.remove('open');
  document.getElementById('notif-scrim').style.display='none';
}
// Store current alerts for dismiss/detail
let _currentAlerts = [];
let _dismissedIds = new Set(JSON.parse(localStorage.getItem('sw3_dismissed_notifs')||'[]'));

function _alertId(a){ return a.key||(a.type+'|'+a.title); }

function updateNotifPanel(alerts){
  // Filter out dismissed
  _currentAlerts = alerts.filter(a=>!_dismissedIds.has(_alertId(a)));
  const badge=document.getElementById('notif-badge');
  const list=document.getElementById('notif-list');
  if(!badge||!list) return;
  const count=_currentAlerts.length;
  badge.textContent=count>9?'9+':count;
  badge.style.display=count?'flex':'none';
  _renderNotifList();
  // Device push for new alerts
  _pushDeviceNotifs(alerts);
}

const _NOTIF_ORDER={danger:0,warn:1,info:2,good:3};

// Banner shown at the top of the notification panel when this device cannot
// actually show system notifications. Chrome on Android frequently suppresses
// the boot-time permission prompt (quiet UI), so a device can sit at 'default'
// forever without the user ever seeing a request — this gives them a tap to
// trigger one, which is also the only reliable way to ask on mobile.
function _notifPermBanner(){
  if(!('Notification' in window)) return '';
  const p=Notification.permission;
  if(p==='granted') return '';
  if(p==='denied') return `<div class="notif-empty" style="text-align:left;line-height:1.5">
      🔕 Notifications are blocked for SpendWise on this device.<br>
      Re-enable them in your browser's site settings for this page.
    </div>`;
  return `<div class="notif-empty" style="text-align:left;line-height:1.5;cursor:pointer" onclick="_enableNotifsFromGesture()">
      🔔 <span style="color:var(--accent);font-weight:600;text-decoration:underline">Turn on notifications for this device</span><br>
      <span style="font-size:0.9em">Alerts will show while SpendWise is open.</span>
    </div>`;
}

async function _enableNotifsFromGesture(){
  if(!('Notification' in window)){toast('This browser has no notification support');return;}
  try{
    const p=await Notification.requestPermission();
    _notifPermission=p;
    toast(p==='granted'?'Notifications enabled':'Notifications not enabled');
  }catch(e){
    console.warn('[notif] requestPermission failed',e);
    toast('Could not enable notifications');
  }
  _renderNotifList();
}

function _renderNotifList(){
  const list=document.getElementById('notif-list');
  if(!list) return;
  const perm=_notifPermBanner();
  if(!_currentAlerts.length){list.innerHTML=perm+'<div class="notif-empty">✓ No alerts right now</div>';return;}
  _currentAlerts.sort((a,b)=>(_NOTIF_ORDER[a.type]??2)-(_NOTIF_ORDER[b.type]??2));
  list.innerHTML=perm+_currentAlerts.map((a,i)=>{
    // Expanding only earns its tap when there's genuinely more to show
    const hasDetail=!!(a.why||a.link);
    return`
    <div class="notif-item n-${a.type}" id="nitem-${i}" ${hasDetail?`onclick="toggleNotifDetail(${i})"`:''}>
      <div class="notif-swipe-bg">✕</div>
      <div class="notif-item-row">
        <div class="notif-item-icon">${a.icon}</div>
        <div class="notif-item-body">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px">
            <div class="notif-item-title" style="flex:1">${a.title}</div>
            <span class="notif-dismiss-btn" onclick="event.stopPropagation();dismissNotif(${i})">✕</span>
          </div>
          <div class="notif-item-sub">${a.sub}</div>
          ${hasDetail?`<div class="notif-item-detail">${a.why?`<div class="notif-why">💭 ${a.why}</div>`:''}${a.link?`<span style="cursor:pointer;color:var(--accent);font-weight:600;text-decoration:underline" onclick="event.stopPropagation();closeNotifPanel();${a.link.fn}">${a.link.label}</span>`:''}</div>
          <div class="notif-caret">▾ why</div>`:''}
        </div>
      </div>
    </div>`;}).join('');
  // Attach swipe listeners after render
  _currentAlerts.forEach((_,i)=>_attachNotifSwipe(i));
}
function _attachNotifSwipe(i){
  const el=document.getElementById('nitem-'+i);
  if(!el||el._swipeInit) return;
  el._swipeInit=true;
  let startX=0,curX=0,swiping=false;
  const THRESHOLD=80;
  el.addEventListener('touchstart',e=>{startX=e.touches[0].clientX;curX=startX;swiping=true;},{passive:true});
  el.addEventListener('touchmove',e=>{
    if(!swiping) return;
    curX=e.touches[0].clientX;
    const dx=startX-curX;
    if(dx>0){
      el.style.transform=`translateX(${-dx}px)`;
      const bg=el.querySelector('.notif-swipe-bg');
      if(bg) bg.style.opacity=Math.min(1,dx/THRESHOLD);
    }
  },{passive:true});
  el.addEventListener('touchend',()=>{
    if(!swiping) return;
    swiping=false;
    const dx=startX-curX;
    if(dx>THRESHOLD){
      el.style.transition='transform 0.2s,opacity 0.2s';
      el.style.transform='translateX(-100%)';
      el.style.opacity='0';
      setTimeout(()=>dismissNotif(i),200);
    } else {
      el.style.transform='';
      const bg=el.querySelector('.notif-swipe-bg');
      if(bg) bg.style.opacity='0';
    }
  });
}

function toggleNotifDetail(i){
  const el=document.getElementById('nitem-'+i);
  if(el) el.classList.toggle('expanded');
}

function dismissNotif(i){
  const a=_currentAlerts[i];
  if(!a) return;
  _dismissedIds.add(_alertId(a));
  localStorage.setItem('sw3_dismissed_notifs', JSON.stringify([..._dismissedIds]));
  _currentAlerts.splice(i,1);
  const badge=document.getElementById('notif-badge');
  if(badge){badge.textContent=_currentAlerts.length>9?'9+':_currentAlerts.length;badge.style.display=_currentAlerts.length?'flex':'none';}
  _renderNotifList();
}

function clearAllNotifs(){
  _currentAlerts.forEach(a=>_dismissedIds.add(_alertId(a)));
  localStorage.setItem('sw3_dismissed_notifs', JSON.stringify([..._dismissedIds]));
  _currentAlerts=[];
  const badge=document.getElementById('notif-badge');
  if(badge){badge.textContent='0';badge.style.display='none';}
  _renderNotifList();
}

// Device push notifications via Web Notifications API
let _notifPermission='default';
async function _requestNotifPermission(){
  if(!('Notification' in window)) return;
  if(Notification.permission==='granted'){_notifPermission='granted';return;}
  if(Notification.permission!=='denied'){
    const p=await Notification.requestPermission();
    _notifPermission=p;
  }
}
const _sentPushIds=new Set();

// IMPORTANT — why this goes through the service worker and not `new Notification()`:
// Mobile browsers (Chrome on Android, Safari on iOS) do NOT implement the
// Notification constructor. Calling it there throws
//   TypeError: Failed to construct 'Notification': Illegal constructor.
//              Use ServiceWorkerRegistration.showNotification() instead.
// Desktop browsers DO implement it — which is why this function used to work
// perfectly on a laptop and silently never fire on a phone. The old code also
// swallowed the throw in a bare `catch(e){}`, so the failure was invisible.
// ServiceWorkerRegistration.showNotification() works on desktop AND mobile, so
// it is the primary path. Do not "simplify" this back to the constructor.
async function _pushDeviceNotifs(alerts){
  if(!('Notification' in window)||Notification.permission!=='granted') return;

  const fresh=alerts.filter(a=>{
    const id=_alertId(a);
    return !_sentPushIds.has(id)&&!_dismissedIds.has(id);
  });
  if(!fresh.length) return;

  // getRegistration() (not .ready) — .ready never settles when registration
  // failed, which would hang this function forever instead of falling back.
  let reg=null;
  try{ reg=await navigator.serviceWorker?.getRegistration(); }
  catch(e){ console.warn('[notif] no service worker registration:',e); }

  for(const a of fresh){
    const id=_alertId(a);
    _sentPushIds.add(id);
    const title='SpendWise — '+a.title;
    // Relative path: the app is served from /spendwise/, so the previous
    // root-absolute '/favicon.ico' pointed outside the app at a file that does
    // not exist in this repo. Desktop tolerates a missing icon; Android does not.
    const opts={
      body:a.sub.replace(/<[^>]+>/g,'').slice(0,120),
      icon:'icon-192.png',
      badge:'icon-192.png',
      tag:id,
      silent:false
    };
    try{
      if(reg&&reg.showNotification) await reg.showNotification(title,opts);
      else new Notification(title,opts); // desktop-only last resort
    }catch(e){
      // Never swallow this again — a silent throw here is precisely how the
      // mobile breakage went unnoticed. Un-mark the id so it can retry.
      console.warn('[notif] failed to show notification',id,e);
      _sentPushIds.delete(id);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// DASHBOARD CARD REORDER
// ══════════════════════════════════════════════════════════════════════════
const DASH_CARD_LABELS = {
  networth:'Net Worth', stats:'Stat Cards', recent:'Recent Transactions',
  budget:'Spend vs Budget', charts:'Charts', cash:'Cash', investments:'Investments'
};
const DEFAULT_CARD_ORDER = ['networth','stats','recent','budget','charts','cash','investments'];

function getDashOrder(){
  return cGet('sw3_dash_order') || [...DEFAULT_CARD_ORDER];
}
function saveDashOrder(order){ cSet('sw3_dash_order', order); }

function applyDashOrder(){
  const order=getDashOrder();
  const container=document.getElementById('dash-cards-container');
  if(!container) return;
  order.forEach(id=>{
    const el=container.querySelector(`[data-card="${id}"]`);
    if(el) container.appendChild(el);
  });
}

let _dashEditMode=false;
let _dragSrc=null;

function toggleDashEdit(){
  _dashEditMode=!_dashEditMode;
  const btn=document.getElementById('dash-edit-btn');
  if(btn) btn.textContent=_dashEditMode?'Editing…':'Edit';
  // Show/hide floating done bar
  let doneBar=document.getElementById('dash-done-bar');
  if(_dashEditMode){
    if(!doneBar){
      doneBar=document.createElement('div');
      // Allow handles to protrude left
      const container2=document.getElementById('dash-cards-container');
      if(container2) container2.style.paddingLeft='32px';
      doneBar.id='dash-done-bar';
      doneBar.style.cssText='position:fixed;bottom:calc(var(--nh) + 10px);left:50%;transform:translateX(-50%);z-index:150;background:var(--accent);color:#fff;font-weight:700;font-size:0.78rem;padding:10px 28px;border-radius:24px;box-shadow:0 4px 16px rgba(20,184,166,0.4);cursor:pointer;letter-spacing:0.02em';
      doneBar.textContent='✓ Done Reordering';
      doneBar.onclick=toggleDashEdit;
      document.body.appendChild(doneBar);
    }
    doneBar.style.display='block';
  } else {
    if(doneBar) doneBar.style.display='none';
    const _cont=document.getElementById('dash-cards-container');
    if(_cont) _cont.style.paddingLeft='';
  }
  const rail=document.getElementById('dash-scroll-rail');
  if(rail){rail.classList.toggle('visible',_dashEditMode);}
  if(_dashEditMode) _updateScrollRail();
  const container=document.getElementById('dash-cards-container');
  if(!container) return;
  container.querySelectorAll('.dash-card-wrap').forEach(wrap=>{
    const cardId=wrap.dataset.card;
    const existingHandle=wrap.querySelector('.reorder-handle');
    if(_dashEditMode){
      if(!existingHandle){
        const handle=document.createElement('div');
        handle.className='reorder-handle';
        handle.innerHTML='⠿⠿';
        handle.title=DASH_CARD_LABELS[cardId]||cardId;
        handle.style.cssText='position:absolute;left:-28px;top:50%;transform:translateY(-50%);width:24px;height:40px;display:flex;align-items:center;justify-content:center;background:var(--bg2);border:1px solid var(--border);border-radius:6px;cursor:grab;user-select:none;font-size:0.75rem;color:var(--text3);letter-spacing:-2px;z-index:10';
        wrap.style.position='relative';
        wrap.appendChild(handle);
        // Touch drag on handle only
        handle.addEventListener('touchstart', e=>{e.stopPropagation();_dragStart(e, wrap);}, {passive:true});
        handle.addEventListener('touchmove', e=>{e.stopPropagation();_dragTouchMove(e, wrap);}, {passive:false});
        handle.addEventListener('touchend', e=>{e.stopPropagation();_dragTouchEnd(e, wrap);});
        // Mouse drag on whole wrap
        wrap.setAttribute('draggable','true');
        wrap.addEventListener('dragstart', e=>_mouseDragStart(e, wrap));
        wrap.addEventListener('dragover', e=>_mouseDragOver(e, wrap));
        wrap.addEventListener('drop', e=>_mouseDrop(e, wrap));
        wrap.addEventListener('dragend', _mouseDragEnd);
      }
    } else {
      if(existingHandle) existingHandle.remove();
      wrap.removeAttribute('draggable');
    }
  });
  if(!_dashEditMode){
    // save current DOM order
    const order=[...container.querySelectorAll('.dash-card-wrap')].map(w=>w.dataset.card);
    saveDashOrder(order);
  }
}

// Mouse drag
function _mouseDragStart(e, wrap){ _dragSrc=wrap; wrap.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; }
function _mouseDragOver(e, wrap){ e.preventDefault(); e.dataTransfer.dropEffect='move'; wrap.classList.add('drag-over'); }
function _mouseDrop(e, wrap){
  e.preventDefault();
  const container=document.getElementById('dash-cards-container');
  if(_dragSrc&&_dragSrc!==wrap){
    const children=[...container.children];
    const srcIdx=children.indexOf(_dragSrc);
    const tgtIdx=children.indexOf(wrap);
    if(srcIdx<tgtIdx) container.insertBefore(_dragSrc, wrap.nextSibling);
    else container.insertBefore(_dragSrc, wrap);
  }
  container.querySelectorAll('.dash-card-wrap').forEach(w=>w.classList.remove('drag-over'));
}
function _mouseDragEnd(){ document.querySelectorAll('.dash-card-wrap').forEach(w=>{w.classList.remove('dragging','drag-over');}); _dragSrc=null; }

// Touch drag (simple swap on release)
let _touchSrc=null, _touchStartY=0;
function _dragStart(e, wrap){ _touchSrc=wrap; _touchStartY=e.touches[0].clientY; wrap.classList.add('dragging'); }
function _dragTouchMove(e, wrap){ e.preventDefault(); }
function _dragTouchEnd(e, wrap){
  wrap.classList.remove('dragging');
  if(!_touchSrc) return;
  const endY=e.changedTouches[0].clientY;
  const container=document.getElementById('dash-cards-container');
  const children=[...container.querySelectorAll('.dash-card-wrap')];
  // Find element under touch end point
  const target=children.find(c=>{
    if(c===_touchSrc) return false;
    const r=c.getBoundingClientRect();
    return endY>=r.top&&endY<=r.bottom;
  });
  if(target){
    const srcIdx=children.indexOf(_touchSrc);
    const tgtIdx=children.indexOf(target);
    if(srcIdx<tgtIdx) container.insertBefore(_touchSrc, target.nextSibling);
    else container.insertBefore(_touchSrc, target);
  }
  _touchSrc=null;
}


// ── EDIT MODE SCROLL RAIL ──────────────────────────────────────────────────
function _railScroll(delta){window.scrollBy({top:delta,behavior:'smooth'});setTimeout(_updateScrollRail,120);}
function _updateScrollRail(){
  const thumb=document.getElementById('dash-scroll-thumb');
  const track=document.getElementById('dash-scroll-track');
  if(!thumb||!track) return;
  const trackH=track.getBoundingClientRect().height;
  const docH=document.documentElement.scrollHeight;
  const winH=window.innerHeight;
  const scrolled=window.scrollY;
  const ratio=winH/docH;
  const thumbH=Math.max(36,trackH*ratio);
  const maxTop=trackH-thumbH;
  const top=(scrolled/(docH-winH))*maxTop;
  thumb.style.height=thumbH+'px';
  thumb.style.top=top+'px';
}
window.addEventListener('scroll',()=>{if(_dashEditMode) _updateScrollRail();},{passive:true});


// ── COLLAPSIBLE TOGGLE ─────────────────────────────────────────────────────
function toggleCollapsible(bodyId, hdrId){
  const body=document.getElementById(bodyId);
  const hdr=document.getElementById(hdrId);
  if(!body||!hdr) return;
  // Use hdr class as single source of truth — avoids double-click on first load
  const isOpen=hdr.classList.contains('open');
  body.style.display=isOpen?'none':'block';
  hdr.classList.toggle('open',!isOpen);
}

// ── SMART DASHBOARD ALERTS ─────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════
// SMART INSIGHTS ENGINE
// Learns each category's rhythm from cached history (up to 6 prior months)
// so projections respect cadence: one Fuel top-up on the 1st is a top-up,
// not a new daily habit. Episodic categories (few purchases/month) are held
// at their typical monthly total; routine categories are paced against the
// fraction of the month's spend that history says lands by today's date.
// ══════════════════════════════════════════════════════════════════════════
function _median(a){if(!a||!a.length)return 0;const s=[...a].sort((x,y)=>x-y);const mid=Math.floor(s.length/2);return s.length%2?s[mid]:(s[mid-1]+s[mid])/2;}
function _prevMonthsList(m,y,n){
  const out=[];let mm=m,yy=y;
  for(let i=0;i<n;i++){mm--;if(mm<1){mm=12;yy--;}out.push({m:mm,y:yy});}
  return out;
}
// Scan cached prior months once. For each category: monthly totals & counts
// (zero-padded for months where it didn't appear, so medians reflect true
// frequency) and the fraction of each month's total spent by day `day`.
function _spendHistoryStats(m,y,day){
  const cats={};let monthsScanned=0;
  _prevMonthsList(m,y,6).forEach(({m:mm,y:yy})=>{
    const txns=cGet(CK.txns(mm,yy));
    if(!Array.isArray(txns)||!txns.length) return;
    monthsScanned++;
    const cutoff=Math.min(day,new Date(yy,mm,0).getDate());
    const byCat={};
    txns.forEach(t=>{
      if(!t||!t.amount) return;
      const c=t.category||'Other';
      const d=parseInt(String(t.date||'').slice(8,10),10)||1;
      byCat[c]=byCat[c]||{total:0,count:0,early:0};
      byCat[c].total+=t.amount;byCat[c].count++;
      if(d<=cutoff) byCat[c].early+=t.amount;
    });
    Object.entries(byCat).forEach(([c,v])=>{
      cats[c]=cats[c]||{totals:[],counts:[],fracs:[],monthsPresent:0};
      cats[c].totals.push(v.total);cats[c].counts.push(v.count);
      cats[c].fracs.push(v.total>0?v.early/v.total:0);
      cats[c].monthsPresent++;
    });
  });
  Object.values(cats).forEach(s=>{while(s.totals.length<monthsScanned){s.totals.push(0);s.counts.push(0);}});
  return {monthsScanned,cats};
}
// Returns {alerts, insights, catProj, totalProj, totalBudget, monthsUsed}.
// `alerts` feed the notification bell; `insights` (superset with positive /
// contextual reads) feed the Analytics → Insights tab. Every item carries a
// `why` — the reasoning shown when expanded — and a month-scoped `key` so a
// dismissed alert stays dismissed for that month even as amounts move.
function computeSmartInsights(){
  const now=new Date();
  const m=now.getMonth()+1,y=now.getFullYear(),day=now.getDate();
  const daysInMonth=new Date(y,m,0).getDate(),daysLeft=daysInMonth-day;
  const mk=`${y}-${m}`;
  const txns=(S.expMonth===m&&S.expYear===y)?S.txns:(cGet(CK.txns(m,y))||[]);
  const B=(S.expMonth===m&&S.expYear===y)?S.budgets:(cGet(CK.budgets(m,y))||S.budgets||{});
  const hist=_spendHistoryStats(m,y,day);
  const nMonths=hist.monthsScanned;
  const out={alerts:[],insights:[],catProj:{},totalProj:0,totalBudget:Object.values(B).reduce((s,v)=>s+(v||0),0),monthsUsed:nMonths};

  const catSpend={},catCount={};
  txns.forEach(t=>{if(!t||!t.amount)return;const c=t.category||'Other';catSpend[c]=(catSpend[c]||0)+t.amount;catCount[c]=(catCount[c]||0)+1;});

  // ── Per-category projections ──
  new Set([...Object.keys(catSpend),...Object.keys(hist.cats)]).forEach(cat=>{
    const spent=catSpend[cat]||0;
    const h=hist.cats[cat];
    let proj,method,typTotal=0,typCount=0,frac=0;
    if(h&&h.monthsPresent>=2){
      typTotal=Math.round(_median(h.totals));typCount=_median(h.counts);
      if(typCount<=4){
        // Episodic (fuel top-ups, school fees): expect the typical monthly
        // total, never a per-day multiple of an early one-off purchase.
        proj=Math.max(spent,typTotal);method='episodic';
      }else{
        frac=Math.min(1,Math.max(0.10,_median(h.fracs.filter(f=>f>0))||day/daysInMonth));
        proj=Math.max(spent,Math.round(spent/frac));
        if(typTotal>0) proj=Math.max(spent,Math.round(proj*0.65+typTotal*0.35));
        method='paced';
      }
    }else{
      // Not enough history — plain pro-rata, and only after the first week
      // so day-1 purchases can't manufacture a fake overspend.
      proj=day>=7?Math.round(spent/day*daysInMonth):spent;method='linear';
    }
    out.catProj[cat]={spent,proj,method,typTotal,typCount,frac,count:catCount[cat]||0,budget:B[ck(cat)]||0};
    out.totalProj+=proj;
  });

  // ── Total-budget outlook ──
  const spentTotal=txns.reduce((s,t)=>s+(t.amount||0),0);
  if(out.totalBudget>0&&spentTotal>0){
    const pct=Math.round(out.totalProj/out.totalBudget*100);
    const histNote=nMonths>=2
      ?`Based on ${nMonths} months of your history: routine categories are paced against how much of the month's spend usually lands by day ${day}; one-off categories are held at their typical monthly total instead of being multiplied per day.`
      :`Less than 2 months of history is cached on this device, so this is a simple pro-rata estimate — it gets smarter as history builds.`;
    if(pct>=110){
      out.alerts.push({type:'danger',icon:'🔴',key:`proj-total-${mk}`,
        title:`Heading over budget — projected ${fN(out.totalProj)}`,
        sub:`${fN(spentTotal)} spent by day ${day} · budget ${fN(out.totalBudget)} · ${daysLeft}d left`,
        why:histNote});
    }else if(pct>=90){
      out.alerts.push({type:'warn',icon:'⚠️',key:`proj-total-${mk}`,
        title:`Cutting it close — projected ${pct}% of budget`,
        sub:`Projected ${fN(out.totalProj)} vs ${fN(out.totalBudget)} · ${daysLeft}d left`,
        why:histNote});
    }else{
      out.insights.push({type:'good',icon:'✅',key:`proj-total-${mk}`,
        title:`On track — projected ${pct}% of budget`,
        sub:`Projected ${fN(out.totalProj)} vs ${fN(out.totalBudget)} · ${fN(Math.max(0,out.totalBudget-out.totalProj))} headroom`,
        why:histNote});
    }
  }

  // ── Per-category stories ──
  Object.entries(out.catProj).forEach(([cat,p])=>{
    const icon=CAT_ICONS[cat]||'📊';
    const key=`cat-${ck(cat)}-${mk}`;
    // Already over budget — a fact, not a projection.
    if(p.budget>0&&p.spent>p.budget){
      out.alerts.push({type:'danger',icon,key,
        title:`${cat} is over budget`,
        sub:`${fN(p.spent)} spent vs ${fN(p.budget)} budget`,
        why:p.typTotal>0?`Your typical ${cat} month is ${fN(p.typTotal)}. With ${daysLeft} days left, expect roughly ${fN(Math.max(0,p.proj-p.spent))} more based on your usual pattern.`:`No history yet for ${cat} — the overage is measured against this month's budget only.`});
      return;
    }
    // Projected overspend — only when the method has something to stand on.
    if(p.budget>0&&p.proj>p.budget*1.1&&p.spent>0&&(p.method!=='linear'||day>=7)){
      const why=p.method==='episodic'
        ?`You've made ${p.count} ${cat} purchase${p.count===1?'':'s'} this month; historically you make ~${Math.round(p.typCount)}/month totalling ${fN(p.typTotal)}. This is NOT extrapolated daily — the projection assumes your normal purchase rhythm, and it still lands over budget.`
        :p.method==='paced'
        ?`By day ${day} you've usually spent ${Math.round(p.frac*100)}% of your monthly ${cat} total. Scaling this month's ${fN(p.spent)} by that curve projects ${fN(p.proj)} vs ${fN(p.budget)} budget.`
        :`Simple pro-rata (limited history for ${cat}): ${fN(p.spent)} over ${day} days extends to ${fN(p.proj)}.`;
      out.alerts.push({type:'warn',icon,key,
        title:`${cat} pacing over budget`,
        sub:`Projected ${fN(p.proj)} vs ${fN(p.budget)} (${Math.round(p.proj/p.budget*100)}%)`,
        why});
      return;
    }
    // Episodic anomaly — unusually heavy month vs typical, budget or not.
    if(p.method==='episodic'&&p.typTotal>0&&p.spent>p.typTotal*1.3&&(p.spent-p.typTotal)>Math.max(5000,p.typTotal*0.3)){
      out.alerts.push({type:'warn',icon,key:`anom-${ck(cat)}-${mk}`,
        title:`${cat} unusually high this month`,
        sub:`${fN(p.spent)} so far vs typical ${fN(p.typTotal)}/month`,
        why:`Over the last ${nMonths} months your median ${cat} month was ${fN(p.typTotal)} across ~${Math.round(p.typCount)} purchase${Math.round(p.typCount)===1?'':'s'}. This month is already ${Math.round((p.spent/p.typTotal-1)*100)}% above that — worth a look, though it may be a known one-off.`});
      return;
    }
    // Positive / contextual reads → Analytics insights only (no alert noise).
    if(p.method==='episodic'&&p.spent>0&&p.typTotal>0&&p.spent<=p.typTotal*1.15&&p.count<=Math.ceil(p.typCount)){
      out.insights.push({type:'info',icon,key,
        title:`${cat}: normal rhythm`,
        sub:`${p.count} purchase${p.count===1?'':'s'} (${fN(p.spent)}) · typical month: ~${Math.round(p.typCount)} totalling ${fN(p.typTotal)}`,
        why:`${cat} isn't a daily expense for you — history shows ~${Math.round(p.typCount)} purchase${Math.round(p.typCount)===1?'':'s'}/month. Expect roughly ${fN(Math.max(0,p.typTotal-p.spent))} more this month if the pattern holds.`});
    }else if(p.method==='paced'&&p.budget>0&&day>=10&&p.proj<=p.budget*0.85&&p.spent>0){
      out.insights.push({type:'good',icon,key,
        title:`${cat} running under budget`,
        sub:`Projected ${fN(p.proj)} vs ${fN(p.budget)} — about ${fN(p.budget-p.proj)} headroom`,
        why:`You've spent ${fN(p.spent)} by day ${day}; historically that's ${Math.round(p.frac*100)}% of the month done, so finishing near ${fN(p.proj)} would beat your ${fN(p.budget)} budget.`});
    }
  });

  // ── Share-shift: where is this month's money going vs usual? ──
  if(nMonths>=2&&spentTotal>0){
    const typSum=Object.values(out.catProj).reduce((s,p)=>s+p.typTotal,0);
    if(typSum>0){
      Object.entries(out.catProj).forEach(([cat,p])=>{
        const shareNow=p.spent/spentTotal,shareTyp=p.typTotal/typSum;
        if(p.spent>10000&&shareTyp>0&&shareNow>shareTyp*1.5&&shareNow-shareTyp>0.08){
          out.insights.push({type:'info',icon:CAT_ICONS[cat]||'📊',key:`share-${ck(cat)}-${mk}`,
            title:`${cat} is dominating this month`,
            sub:`${Math.round(shareNow*100)}% of spend so far — usually ~${Math.round(shareTyp*100)}%`,
            why:`Historically ${cat} takes about ${Math.round(shareTyp*100)}% of your monthly spending; this month it's at ${Math.round(shareNow*100)}% (${fN(p.spent)} of ${fN(spentTotal)}).`});
        }
      });
    }
  }
  // Alerts are also insights — Analytics shows the full picture.
  out.insights=[...out.alerts,...out.insights];
  return out;
}

function renderDashAlerts(){
  const el=document.getElementById('dash-alerts');
  if(!el) return;
  const now=new Date();
  const m=now.getMonth()+1,y=now.getFullYear();
  const isCurrentMonth=(S.dashMonth===m&&S.dashYear===y);

  // 1) Smart spend alerts (history-aware; only meaningful for current month)
  const alerts=isCurrentMonth?computeSmartInsights().alerts.slice():[];

  // 2) Upcoming recurring payments (due this month, not yet posted)
  const recurring=getRecurring().filter(r=>isDueThisMonth(r.nextRun)&&r.type==='expense');
  if(recurring.length){
    const total=recurring.reduce((s,r)=>s+(r.amount||0),0);
    alerts.push({
      type:'info',
      icon:'🔁',
      title:`${recurring.length} recurring payment${recurring.length>1?'s':''} due this month`,
      sub:recurring.map(r=>`${r.payee} (${fN(r.amount)})`).join(' · ')+(total?` · Total: ${fN(total)}`:''),
      link:{label:'Post now →',fn:"openMod('recur-modal')"}
    });
  }

  // 2b) Recently posted recurring (last 3 days) — confirms what went out
  const _rpl=(cGet('sw3_recur_posted_log')||[]).filter(p=>{const d=new Date(p.date);return !isNaN(d)&&(Date.now()-d.getTime())/86400000<=3;});
  if(_rpl.length){
    alerts.push({
      type:'info',
      icon:'✅',
      title:`${_rpl.length} recurring transaction${_rpl.length>1?'s':''} posted recently`,
      sub:_rpl.map(p=>`${p.payee} (${fN(p.amount)})`).join(' · ')
    });
  }

  // 3) Savings target progress
  if(isCurrentMonth){
    const targetPct=getSavingsTarget();
    if(targetPct>0){
      const incTotal=S.income.reduce((s,i)=>s+(i.amtNGN||i.amount||0),0);
      if(incTotal>0){
        const spent2=S.txns.reduce((s,t)=>s+(t.amount||0),0);
        const savedAmt=incTotal-spent2;
        const actualPct=Math.round(savedAmt/incTotal*100);
        const targetAmt=Math.round(incTotal*targetPct/100);
        if(actualPct<targetPct*0.8){
          alerts.push({type:'warn',icon:'🎯',title:`Savings target: ${actualPct}% of ${targetPct}% goal`,sub:`Targeting ${fN(targetAmt)} saved · actual ${fN(Math.max(0,savedAmt))} · ${fN(Math.max(0,targetAmt-savedAmt))} short`});
        }
      }
    }
  }

  // 4) Overdue debtors (no activity > 60 days)
  const overdue=_getOverdueDebtors();
  if(overdue.length){
    alerts.push({type:'warn',icon:'⏰',title:`${overdue.length} debtor${overdue.length>1?'s':''} — no activity > 60 days`,sub:overdue.map(d=>d.name+' ('+fN(d.ngnBalance||0)+' due)').join(' · ')});
  }

  // Feed notification bell (always, even when el is hidden)
  updateNotifPanel(alerts);
  // Hide alert strip — alerts now live in the bell panel only
  el.innerHTML='';
}


// Net worth for a given month from cached balances — subs-aware + debtors.
// Debtors aren't month-bucketed, so the live debtor balance is used for all points.
function _nwForMonth(m,y){
  const inv=cGet(CK.inv(m,y))||{};
  const cash=cGet(CK.cash(m,y))||{};
  const invT=PLATFORMS.reduce((s,p)=>{
    const subs=(cGet('sw3_inv_subs')||{})[p.key];
    const subTotal=Array.isArray(subs)?subs.reduce((ss,sb)=>ss+(Number(sb.principal)||0),0):0;
    return s+(subTotal>0?subTotal:(inv[p.key]||0));
  },0);
  const cashT=cashTotalNGN(cash,m,y);
  const _nwCfg=cGet('sw3_nw_config')||{};
  const debtT=_nwCfg.includeDebtors!==false?S.debtors.filter(d=>d.expectRepayment!==false).reduce((s,d)=>s+(d.ngnBalance||0),0):0;
  return invT+cashT+debtT;
}
function renderNWTrendChart(){
  const hist=getHistory();
  if(!hist.length) return;
  const pts=hist.slice(-12).map(h=>({label:h.label,nw:_nwForMonth(h.month,h.year)})).filter(p=>p.nw>0);
  if(pts.length<2) return;
  const canvas=document.getElementById('nw-trend-chart');
  if(!canvas) return;
  if(S.nwChart) S.nwChart.destroy();
  const ctx=canvas.getContext('2d');
  const nwLabelPlugin={id:'nwLabels',afterDatasetsDraw(chart){
    const {ctx:c,data,scales:{x,y}}=chart;
    data.datasets[0].data.forEach((val,i)=>{
      if(!val) return;
      const xp=x.getPixelForValue(i);
      const yp=y.getPixelForValue(val);
      const lbl=(val/1e6).toFixed(2)+'M';
      c.save();c.font='bold 8px DM Mono, monospace';c.fillStyle='#c8f542';c.textAlign='center';
      c.fillText(lbl,xp,yp-9);
      c.restore();
    });
  }};
  S.nwChart=new Chart(ctx,{type:'line',data:{labels:pts.map(p=>p.label),datasets:[{data:pts.map(p=>p.nw),borderColor:'#c8f542',backgroundColor:'rgba(200,245,66,0.06)',borderWidth:2,pointBackgroundColor:'#c8f542',pointRadius:4,tension:0.35,fill:true}]},options:{responsive:true,maintainAspectRatio:true,layout:{padding:{top:18}},plugins:{legend:{display:false},tooltip:{backgroundColor:'#12122a',borderColor:'#1f1f3a',borderWidth:1,callbacks:{label:c=>fmtChartNGN(c.parsed.y)}}},scales:{x:{grid:{display:false},ticks:{color:'#3a3a6a',font:{family:'DM Mono',size:9}},border:{display:false}},y:{display:false}}},plugins:[nwLabelPlugin]});
}

// Monarch mode: 12-month net-worth area chart inside the Net Worth hero card.
// Read-only over cached history; hidden (and destroyed) entirely in Classic.
function renderNWHeroChart(){
  const wrap=document.getElementById('nw-hero-chart-wrap');
  if(!wrap)return;
  const _teardown=()=>{wrap.style.display='none';if(S.nwHeroChart){S.nwHeroChart.destroy();S.nwHeroChart=null;}};
  if(!isMonarch()||_isHidden('nw')){_teardown();return;}
  const hist=getHistory();
  const pts=hist.slice(-12).map(h=>({label:h.label,nw:_nwForMonth(h.month,h.year)})).filter(p=>p.nw>0);
  if(pts.length<2){_teardown();return;}
  const canvas=document.getElementById('nw-hero-chart');
  if(!canvas)return;
  wrap.style.display='block';
  if(S.nwHeroChart)S.nwHeroChart.destroy();
  const acc=(getComputedStyle(document.body).getPropertyValue('--accent')||'#14b8a6').trim();
  S.nwHeroChart=new Chart(canvas.getContext('2d'),{type:'line',
    data:{labels:pts.map(p=>p.label),datasets:[{data:pts.map(p=>p.nw),borderColor:acc,backgroundColor:acc+'1f',borderWidth:2,pointRadius:0,pointHitRadius:8,tension:0.35,fill:true}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmtChartNGN(c.parsed.y)}}},scales:{x:{grid:{display:false},ticks:{color:getComputedStyle(document.body).getPropertyValue('--text3').trim()||'#888',font:{size:9},maxTicksLimit:6},border:{display:false}},y:{display:false}}}});
}

function renderDashFullYear(y,totalInc,totalExp,cur){
  const histYear=getHistory().filter(h=>h.year===y);
  const now=new Date();
  const currentYear=now.getFullYear();
  // Use Dec for completed years, current month for the ongoing year
  const refMonth=y<currentYear?12:(y===currentYear?now.getMonth()+1:12);
  // Pull NW from cached balances for the reference month
  const refInv=cGet(CK.inv(refMonth,y))||S.investments||{};
  const refCash=cGet(CK.cash(refMonth,y))||S.cash||{};
  const refInvTotal=PLATFORMS.reduce((s,p)=>s+(refInv[p.key]||0),0);
  const refCashTotal=cashTotalNGN(refCash,refMonth,y);
  const refNW=refInvTotal+refCashTotal;
  const refLabel=y<currentYear?`Dec ${y}`:`${MONTHS[refMonth-1]} ${y}`;
  document.getElementById('dash-nw').textContent=refNW?fmtCur(refNW,cur,refMonth,y):'—';
  document.getElementById('dash-nw-sub').textContent=`Net Worth · ${refLabel}`;
  const net=totalInc-totalExp;
  document.getElementById('dash-stats').innerHTML=`
    <div class="card card-sm" style="margin-bottom:0"><div class="clabel">Total Spent</div><div class="cval-sm">${fmtCur(totalExp,cur,1,y)}</div></div>
    <div class="card card-sm" style="margin-bottom:0"><div class="clabel">Total Income</div><div class="cval-sm" style="color:var(--accent)">${fmtCur(totalInc,cur,1,y)}</div></div>
    <div class="card card-sm" style="margin-bottom:0"><div class="clabel">Net</div><div class="cval-sm" style="color:${net>=0?'var(--accent)':'var(--red)'}">${fmtCur(Math.abs(net),cur,1,y)}</div></div>
    <div class="card card-sm" style="margin-bottom:0"><div class="clabel">Months</div><div class="cval-sm">${histYear.length}</div><div class="csub">with data</div></div>
  `;
  document.getElementById('cat-chart').style.display='none';
  document.getElementById('chart-btns').style.display='none';
  document.getElementById('dash-cats').innerHTML='<div class="csub" style="padding:8px 0">Category breakdown available for individual months</div>';
  document.getElementById('dash-inc-exp').innerHTML=histYear.map(h=>`<div class="inc-row"><span class="pjlabel">${h.label}</span><div style="text-align:right"><div style="font-size:0.72rem;font-family:var(--mono);color:var(--accent)">${fmtCur(h.income,cur,h.month,y)}</div><div style="font-size:0.68rem;font-family:var(--mono);color:var(--red)">${fmtCur(h.expenses,cur,h.month,y)}</div></div></div>`).join('');
  const _cb=document.getElementById('dash-cash-badge');
  if(_cb)_cb.textContent=refCashTotal?fmtCur(refCashTotal,cur,refMonth,y):'—';
  const _cbody=document.getElementById('dash-cash-body');
  if(_cbody)_cbody.innerHTML=getCashAccounts().map(b=>{const v=refCash[b]||0;if(!v)return'';const disp=isUSDCashAccount(b)?'$'+v.toFixed(2):fmtCur(v,cur,refMonth,y);return`<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border)"><span style="font-size:0.72rem">${b}</span><span style="font-family:var(--mono);font-size:0.76rem;color:var(--blue)">${disp}</span></div>`;}).join('')||'<div class="csub">No cash data</div>';
  document.getElementById('dash-inv-total').textContent=refInvTotal?fmtCur(refInvTotal,cur==='NATIVE'?'NGN':cur,refMonth,y):'—';
  document.getElementById('dash-inv').innerHTML=PLATFORMS.filter(p=>refInv[p.key]).map(p=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border)"><span style="font-size:0.72rem">${p.label}</span><span style="font-family:var(--mono);font-size:0.76rem;color:${p.color}">${fmtCur(refInv[p.key],cur==='NATIVE'?'NGN':cur,refMonth,y)}</span></div>`).join('')||'<div class="csub">No investment data</div>';
  document.getElementById('dash-abar').innerHTML='';
  if(S.trendChart) S.trendChart.destroy();
  const ctx=document.getElementById('trend-chart').getContext('2d');
  S.trendChart=new Chart(ctx,{type:'bar',data:{labels:histYear.map(d=>d.label),datasets:[{label:'Income',data:histYear.map(d=>d.income||0),backgroundColor:'rgba(96,165,250,0.4)',borderRadius:3,borderSkipped:false},{label:'Expenses',data:histYear.map(d=>d.expenses||0),backgroundColor:'rgba(20,184,166,0.75)',borderRadius:3,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:true,plugins:{legend:{display:false},tooltip:{backgroundColor:'#161b25',borderColor:'#252d3d',borderWidth:1,callbacks:{label:c=>fmtChartNGN(c.parsed.y)}}},scales:{x:{grid:{display:false},ticks:{color:'#7d8fa8',font:{family:'DM Mono',size:9}},border:{display:false}},y:{display:false}},barPercentage:0.72}});
  document.getElementById('dash-recent').innerHTML='<div class="csub">Recent transactions shown for individual months</div>';
}

// ══════════════════════════════════════════════════════════════════════════
// CATEGORY CHART
// ══════════════════════════════════════════════════════════════════════════
const CAT_COLORS=['#c8f542','#5c9eff','#f5c842','#ff5c9f','#9f5cff','#ff9f5c','#4ade80','#f87171','#a8d430','#4a8aee','#60a5fa','#fbbf24','#34d399','#e879f9','#fb923c'];

function setChartType(type,btn){
  S.chartType=type;
  document.querySelectorAll('.chart-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');
  const catSpend={};S.txns.forEach(t=>{catSpend[t.category]=(catSpend[t.category]||0)+(t.amount||0);});
  renderCatChart(catSpend,S.dashCurrency,S.dashMonth,S.dashYear);
}

function renderCatChart(catSpend,cur,m,y){
  let canvas=document.getElementById('cat-chart');
  const btns=document.getElementById('chart-btns');
  if(!canvas||!canvas.parentNode) return;
  const entries=Object.entries(catSpend).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  btns.style.display='flex';
  if(!entries.length){canvas.style.display='none';return;}
  canvas.style.display='block';
  // Destroy old chart instance cleanly
  if(S.catChart){try{S.catChart.destroy();}catch(e){}S.catChart=null;}
  // Replace canvas node to avoid Chart.js reuse errors
  const newCanvas=document.createElement('canvas');
  newCanvas.id='cat-chart';
  newCanvas.style.cssText='max-height:220px;cursor:pointer;display:block';
  canvas.parentNode.replaceChild(newCanvas,canvas);
  canvas=newCanvas; // update local reference
  const ctx=canvas.getContext('2d');
  const labels=entries.map(([k])=>k);
  const data=entries.map(([,v])=>v);
  const colors=labels.map((_,i)=>CAT_COLORS[i%CAT_COLORS.length]);

  // Chart click: open category breakdown popup
  const onChartClick=(_evt,elements)=>{
    if(!elements.length) return;
    const cat=labels[elements[0].index];
    if(!cat) return;
    haptic([10]);
    openCatPopup(cat, S.txns.filter(t=>t.category===cat), S.dashCurrency, m, y);
  };

  const commonOpts={
    responsive:true,
    maintainAspectRatio:true,
    onClick:onChartClick,
    plugins:{
      legend:{display:S.chartType!=='bar',position:'bottom',labels:{color:'#8888bb',font:{family:'DM Mono',size:9},boxWidth:8,padding:8}},
      tooltip:{backgroundColor:'#12122a',borderColor:'#1f1f3a',borderWidth:1,callbacks:{
        label:c=>{
          const allData=c.chart.data.datasets[0].data;
          const total=allData.reduce((s,v)=>s+(Number(v)||0),0);
          const v=c.parsed!==undefined?(typeof c.parsed==='object'?(c.parsed.y!==undefined?c.parsed.y:c.raw):c.parsed):c.raw;
          const pct=total>0?((Number(v)/total)*100).toFixed(1):'0.0';
          return (c.label||'')+': '+pct+'%  '+fmtChartNGN(Number(v));
        },
        footer:()=>['Tap for details →']
      }}
    }
  };

  if(S.chartType==='hbar'){
    canvas.style.cssText='max-height:280px;cursor:pointer;display:block';
    // hbar: draw % label inside/beside each bar
    const hbarLabelPlugin={id:'hbarLabels',afterDatasetsDraw(chart){
      const {ctx:c,data,scales:{x,y}}=chart;
      const total=data.datasets[0].data.reduce((s,v)=>s+(Number(v)||0),0);
      c.save();
      data.datasets[0].data.forEach((val,i)=>{
        if(!val) return;
        const pct=total>0?((val/total)*100).toFixed(1)+'%':'';
        const xp=x.getPixelForValue(val);
        const yp=y.getPixelForValue(i);
        c.font='bold 9px DM Mono, monospace';
        c.fillStyle='rgba(255,255,255,0.85)';
        c.textAlign='left';
        c.fillText(pct, xp+4, yp+4);
      });
      c.restore();
    }};
    S.catChart=new Chart(ctx,{type:'bar',data:{labels,datasets:[{data,backgroundColor:colors,borderWidth:0,borderRadius:3}]},options:{...commonOpts,indexAxis:'y',plugins:{...commonOpts.plugins,legend:{display:false}},scales:{x:{display:false,grid:{display:false}},y:{grid:{display:false},ticks:{color:'#8888bb',font:{family:'DM Mono',size:9}},border:{display:false}}}},plugins:[hbarLabelPlugin]});
  } else {
    canvas.style.cssText='max-height:220px;cursor:pointer;display:block';
    // pct labels for doughnut/pie, value labels for vertical bar
    const catLabelPlugin={id:'catLabels',afterDatasetsDraw(chart){
      const {ctx:c,data}=chart;
      const total=data.datasets[0].data.reduce((s,v)=>s+(Number(v)||0),0);
      if(S.chartType==='bar'){
        const {scales:{x,y}}=chart;
        data.datasets[0].data.forEach((val,i)=>{
          if(!val) return;
          const pct=total>0?((val/total)*100).toFixed(1)+'%':'';
          const xp=x.getPixelForValue(i);
          const yp=y.getPixelForValue(val);
          c.save();c.font='bold 8px DM Mono, monospace';c.fillStyle='rgba(255,255,255,0.8)';c.textAlign='center';
          c.fillText(pct,xp,yp-5);
          c.restore();
        });
      } else {
        // doughnut / pie: draw pct in centre of each arc
        const ds=chart.getDatasetMeta(0);
        ds.data.forEach((arc,i)=>{
          const val=data.datasets[0].data[i];
          if(!val) return;
          const pct=total>0?((val/total)*100).toFixed(1)+'%':'';
          const {x:cx,y:cy}=arc.tooltipPosition();
          c.save();c.font='bold 8px DM Mono, monospace';c.fillStyle='rgba(255,255,255,0.9)';c.textAlign='center';c.textBaseline='middle';
          c.fillText(pct,cx,cy);
          c.restore();
        });
      }
    }};
    S.catChart=new Chart(ctx,{type:S.chartType==='bar'?'bar':S.chartType,data:{labels,datasets:[{data,backgroundColor:colors,borderWidth:0,borderRadius:S.chartType==='bar'?4:0}]},options:{...commonOpts,scales:S.chartType==='bar'?{x:{grid:{display:false},ticks:{color:'#3a3a6a',font:{family:'DM Mono',size:9}},border:{display:false}},y:{display:false}}:{}},plugins:[catLabelPlugin]});
  }
}

// ══════════════════════════════════════════════════════════════════════════
// EXPENSES
// ══════════════════════════════════════════════════════════════════════════
function switchExpTab(tab, btn){
  document.getElementById('exp-pane').style.display=tab==='expenses'?'block':'none';
  document.getElementById('inc-pane').style.display=tab==='income'?'block':'none';
  document.getElementById('exp-page-title').textContent=tab==='expenses'?'Expenses':'Income';
  document.querySelectorAll('#exp-tab-btn,#inc-tab-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  if(tab==='income') renderIncome();
  else renderExpenses();
}

function renderIncome(){
  const m=S.expMonth,y=S.expYear,cur=S.dashCurrency;
  const inc=[...S.income].sort((a,b)=>a.date>b.date?-1:a.date<b.date?1:txnTs(b.createdAt)-txnTs(a.createdAt));
  const totalNGN=inc.reduce((s,i)=>s+(i.amtNGN||i.amount||0),0);
  const summEl=document.getElementById('inc-summary');
  const listEl=document.getElementById('inc-list');
  if(!summEl||!listEl) return;
  summEl.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center">
    <div><div class="clabel">Total Income — ${MONTHS[m-1]} ${y}${eyeBtn('inc-summary','renderIncome')}</div><div class="cval" style="color:var(--accent)">${maskIf('inc-summary',fmtCur(totalNGN,cur,m,y))}</div></div>
    <div style="text-align:right"><div class="clabel">Count</div><div class="cval">${inc.length}</div></div>
  </div>`;
  if(!inc.length){listEl.innerHTML=`<div class="empty"><div class="empty-i">↑</div>No income recorded for ${MONTHS[m-1]}</div>`;return;}
  listEl.innerHTML='<div class="txlist">'+inc.map(i=>{
    const dispAmt=fmtCur(i.amtNGN||i.amount||0,cur,m,y);
    const isUSD=i.currency==='USD';
    const rawAmt=isUSD?`$${(i.amount||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`:'';
    return`<div class="txi" id="txi-inc-${i.id}">
      <div style="flex:1;min-width:0">
        <div class="txi-cat" style="font-size:0.76rem">${esc(i.category||'Income')}${i.notes?` · ${esc(i.notes)}`:''}</div>
        <div class="txi-meta">${fmtDate(i.date)}${i.bank?' · '+i.bank:''}${rawAmt?' · '+rawAmt:''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <div class="txi-amt" style="color:var(--accent)">${dispAmt}</div>
        <button class="txi-edit" onclick="event.stopPropagation();openEditInc('${i.id}')">✎</button>
        <button class="txi-del" onclick="event.stopPropagation();delIncome('${i.id}')">×</button>
      </div>
    </div>`;
  }).join('')+'</div>';
}

function openEditInc(id){
  const inc=S.income.find(i=>i.id===id);
  if(!inc){toast('Income record not found');return;}
  const titleEl=document.getElementById('inc-modal-title');
  const editIdEl=document.getElementById('i-edit-id');
  const amtEl=document.getElementById('i-amt');
  const catEl=document.getElementById('i-cat');
  const bankEl=document.getElementById('i-bank');
  const dateEl=document.getElementById('i-date');
  const notesEl=document.getElementById('i-notes');
  const saveBtn=document.getElementById('i-save');
  if(titleEl) titleEl.textContent='Edit Income';
  if(editIdEl) editIdEl.value=id;
  if(amtEl) amtEl.value=inc.amount||'';
  if(catEl){
    // Add category if not in list
    const opts=[...catEl.options].map(o=>o.value);
    if(inc.category&&!opts.includes(inc.category)){const o=document.createElement('option');o.value=inc.category;o.textContent=inc.category;catEl.appendChild(o);}
    catEl.value=inc.category||'Other';
  }
  if(bankEl) bankEl.value=inc.bank||bankEl.options[0]?.value||'';
  if(dateEl) dateEl.value=inc.date||'';
  if(notesEl) notesEl.value=inc.notes||'';
  if(saveBtn) saveBtn.textContent='Update Income';
  updateIncAmtLabel();
  openMod('inc-modal');
}

function delIncome(id){
  const idx=S.income.findIndex(i=>i.id===id);
  const inc=idx>=0?S.income[idx]:null;
  if(!inc)return;
  // Optimistically remove from local state immediately
  S.income.splice(idx,1);
  cSet(CK.inc(S.expMonth,S.expYear),S.income);
  if(inc.bank&&inc.amount) _adjustCash(inc.bank, -inc.amount, inc.month||S.expMonth, inc.year||S.expYear, 'income-delete');
  _recalcHistIncome(S.expMonth,S.expYear);
  renderIncome();renderDashboard();renderCashPage();
  haptic([6]);
  const rollback=()=>{
    S.income.splice(Math.min(idx,S.income.length),0,inc);
    cSet(CK.inc(S.expMonth,S.expYear),S.income);
    if(inc.bank&&inc.amount) _adjustCash(inc.bank, inc.amount, inc.month||S.expMonth, inc.year||S.expYear);
    _recalcHistIncome(S.expMonth,S.expYear);
    renderIncome();renderDashboard();renderCashPage();
  };
  showUndoToast('Income deleted',
    rollback,
    async ()=>{ // commit: permanent Firestore delete
      try{await db.collection('income').doc(id).delete();}
      catch(e){toast('Delete failed — restored');rollback();}
    });
}

let _expSort='date'; // 'date' | 'expense' — controls layout inside each category
function setExpSort(mode){_expSort=mode;renderExpenses();}

function renderExpenses(){
  const m=S.expMonth,y=S.expYear;
  const months=[];for(let i=1;i<=12;i++) months.push(i);
  document.getElementById('exp-months').innerHTML=months.map(mo=>`<div class="mpill ${mo===m?'active':''}" onclick="reloadMonth(${mo},${y})">${MS[mo-1]}</div>`).join('');
  setTimeout(()=>{const el=document.querySelector('#exp-months .mpill.active');if(el)el.scrollIntoView({inline:'center',block:'nearest'});},0);

  // Update sort button active states
  const btnExp=document.getElementById('exp-sort-exp-btn');
  const btnDate=document.getElementById('exp-sort-date-btn');
  if(btnExp) btnExp.className=`btn btn-sm ${_expSort==='expense'?'btn-p':'btn-g'}`;
  if(btnDate) btnDate.className=`btn btn-sm ${_expSort==='date'?'btn-p':'btn-g'}`;

  const txns=[...S.txns].sort((a,b)=>a.date>b.date?-1:a.date<b.date?1:txnTs(b.createdAt)-txnTs(a.createdAt));
  const searchQ=(document.getElementById('exp-search')?.value||'').toLowerCase().trim();
  const cur=S.dashCurrency;

  let filtered=txns;
  if(S.expCat!=='All') filtered=filtered.filter(t=>t.category===S.expCat);
  if(searchQ) filtered=filtered.filter(t=>(t.payee||'').toLowerCase().includes(searchQ)||(t.notes||'').toLowerCase().includes(searchQ));

  // ── Cross-month search across cached months ──
  let _crossHtml='';
  if(searchQ.length>=2){
    const _others=[];
    Object.keys(localStorage).forEach(k=>{
      const mt=k.match(/^sw3_txns_(\d{4})_(\d{1,2})$/);
      if(!mt)return;
      const ky=parseInt(mt[1]),km=parseInt(mt[2]);
      if(km===m&&ky===y)return;
      (cGet(k)||[]).forEach(t=>{
        if((t.payee||'').toLowerCase().includes(searchQ)||(t.notes||'').toLowerCase().includes(searchQ)) _others.push({...t,_m:km,_y:ky});
      });
    });
    if(_others.length){
      _others.sort((a,b)=>a.date>b.date?-1:a.date<b.date?1:0);
      const _shown=_others.slice(0,30);
      _crossHtml=`<div class="card" style="margin-top:12px"><div class="clabel" style="margin-bottom:8px">Results in other months (${_others.length})</div>${_shown.map(t=>`<div class="txi" style="cursor:pointer" onclick="reloadMonth(${t._m},${t._y})"><div style="flex:1;min-width:0"><div class="txi-cat" style="font-size:0.76rem">${esc(t.payee)||'—'}</div><div class="txi-meta">${fmtDate(t.date)} · ${MS[t._m-1]} ${t._y} · ${esc(t.bank||'')}</div></div><div class="txi-amt txi-exp">${fmtCur(t.amount,cur,t._m,t._y)}</div></div>`).join('')}${_others.length>30?`<div class="csub" style="margin-top:6px">Showing first 30 — tap a row to open its month</div>`:`<div class="csub" style="margin-top:6px">Tap a row to open its month</div>`}</div>`;
    }
  }

  const total=txns.reduce((s,t)=>s+(t.amount||0),0);
  const catSpend={};txns.forEach(t=>{catSpend[t.category]=(catSpend[t.category]||0)+(t.amount||0);});

  const filterDesc=S.expCat!=='All'?` · ${S.expCat}`:'';
  document.getElementById('exp-summary').innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center${Object.keys(catSpend).length?';margin-bottom:12px':''}">
      <div><div class="clabel">Total — ${MONTHS[m-1]}${filterDesc}${eyeBtn('exp-summary','renderExpenses')}</div><div class="cval">${maskIf('exp-summary',fmtCur(S.expCat!=='All'?filtered.reduce((s,t)=>s+(t.amount||0),0):total,cur,m,y))}</div></div>
      <div style="text-align:right"><div class="clabel">Count</div><div class="cval">${filtered.length}${filtered.length!==txns.length?`<span style="font-size:0.6rem;color:var(--text3)"> / ${txns.length}</span>`:''}</div></div>
    </div>
    ${Object.keys(catSpend).length?`<div style="display:flex;flex-wrap:wrap;gap:5px">${Object.entries(catSpend).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([c,amt])=>`<div onclick="quickCatFilter('${jsq(c)}')" style="padding:2px 9px;border-radius:20px;background:${S.expCat===c?'var(--adim)':'var(--bg2)'};border:1px solid ${S.expCat===c?'var(--accent)':'var(--border)'};font-size:0.63rem;color:${S.expCat===c?'var(--accent)':'var(--text2)'};cursor:pointer">${c} · ${maskIf('exp-summary',fmtCur(amt,cur,m,y))}</div>`).join('')}</div>`:''}`;

  const listEl=document.getElementById('exp-list');
  if(!filtered.length){
    listEl.innerHTML=`<div class="empty"><div class="empty-i">↕</div>${searchQ?`No results for "${searchQ}"`:S.expCat!=='All'?`No ${S.expCat} transactions`:'No transactions'}</div>`+_crossHtml;
    return;
  }

  // ── Swipeable flat row ──
  const swipeRow=(tx)=>`
    <div class="swipe-wrap" id="sw-${tx.id}">
      <div class="swipe-del-bg" id="swbg-${tx.id}">DELETE</div>
      <div class="txi" id="txi-${tx.id}" data-id="${tx.id}"
           ontouchstart="swipeStart(event,'${tx.id}')"
           ontouchmove="swipeMove(event,'${tx.id}')"
           ontouchend="swipeEnd(event,'${tx.id}')">
        <div style="flex:1;min-width:0">
          <div class="txi-cat" style="font-size:0.76rem">${esc(tx.payee)||'—'}</div>
          <div class="txi-meta">${fmtDate(tx.date)} · ${esc(tx.bank||'')}${tx.notes?' · '+esc(tx.notes):''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          <div class="txi-amt txi-exp">${fmtCur(tx.amount,cur,m,y)}</div>
          <button class="txi-edit" onclick="event.stopPropagation();openEditExp('${tx.id}')">✎</button>
          <button class="txi-del" onclick="event.stopPropagation();delExpense('${tx.id}')">×</button>
        </div>
      </div>
    </div>`;

  // ── Inner body for a category's items ──
  // By date: sub-group by date, most-recent first; items within date sorted by amount desc
  // By expense: sub-group by actual expense name, sorted by total desc; items within group sorted by date desc
  const renderCatBody=(items)=>{
    if(_expSort==='date'){
      const byDate={};
      items.forEach(tx=>{const d=tx.date||'';(byDate[d]=byDate[d]||[]).push(tx);});
      const dates=Object.keys(byDate).sort((a,b)=>a>b?-1:1);
      return dates.map(d=>{
        const dayTxns=byDate[d].sort((a,b)=>(b.amount||0)-(a.amount||0));
        const dayTotal=dayTxns.reduce((s,t)=>s+(t.amount||0),0);
        return`<div style="padding:5px 12px 2px;font-size:0.68rem;font-weight:600;color:var(--text3);display:flex;justify-content:space-between;border-top:1px solid var(--border)">
          <span>${fmtDate(d)}</span><span style="font-family:var(--mono);color:var(--text2)">${fmtCur(dayTotal,cur,m,y)}</span></div>
          ${dayTxns.map(tx=>`
          <div onclick="openEditExp('${tx.id}')" style="display:flex;justify-content:space-between;align-items:center;padding:3px 12px;cursor:pointer">
            <span style="font-size:0.75rem;color:var(--text);min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(tx.payee)||'—'}${tx.bank?`<span style="color:var(--text3)"> · ${esc(tx.bank)}</span>`:''}${tx.notes?`<span style="color:var(--text3)"> · ${esc(tx.notes)}</span>`:''}</span>
            <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;margin-left:8px">
              <span style="font-family:var(--mono);font-size:0.75rem;color:var(--red)">${fmtCur(tx.amount,cur,m,y)}</span>
              <button class="txi-del" onclick="event.stopPropagation();delExpense('${tx.id}')">×</button>
            </div>
          </div>`).join('')}`;
      }).join('');
    } else {
      // By expense
      const byExp={};
      items.forEach(tx=>{const key=tx.payee||'—';(byExp[key]=byExp[key]||[]).push(tx);});
      const groups=Object.entries(byExp)
        .map(([name,grpTxns])=>({name,grpTxns,total:grpTxns.reduce((s,t)=>s+(t.amount||0),0)}))
        .sort((a,b)=>b.total-a.total);
      return groups.map(g=>{
        const gTxns=[...g.grpTxns].sort((a,b)=>a.date>b.date?-1:a.date<b.date?1:txnTs(b.createdAt)-txnTs(a.createdAt));
        return`<div style="padding:5px 12px 2px;font-size:0.68rem;font-weight:600;color:var(--text3);display:flex;justify-content:space-between;border-top:1px solid var(--border)">
          <span>${esc(g.name)}</span><span style="font-family:var(--mono);color:var(--text2)">${fmtCur(g.total,cur,m,y)}</span></div>
          ${gTxns.map(tx=>`
          <div onclick="openEditExp('${tx.id}')" style="display:flex;justify-content:space-between;align-items:center;padding:3px 12px;cursor:pointer">
            <span style="font-size:0.75rem;color:var(--text3);min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${fmtDate(tx.date)}${tx.bank?` · ${esc(tx.bank)}`:''}${tx.notes?` · ${esc(tx.notes)}`:''}</span>
            <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;margin-left:8px">
              <span style="font-family:var(--mono);font-size:0.75rem;color:var(--red)">${fmtCur(tx.amount,cur,m,y)}</span>
              <button class="txi-del" onclick="event.stopPropagation();delExpense('${tx.id}')">×</button>
            </div>
          </div>`).join('')}`;
      }).join('');
    }
  };

  // When filtered to a single category or searching, skip the outer category accordion
  if(S.expCat!=='All'||searchQ){
    listEl.innerHTML=`<div style="border:1px solid var(--border);border-radius:var(--rsm);overflow:hidden">${renderCatBody(filtered)}</div>`+_crossHtml;
    return;
  }

  // ── Outer: categories sorted by total spend desc ──
  const groups={};
  filtered.forEach(tx=>{if(!groups[tx.category])groups[tx.category]=[];groups[tx.category].push(tx);});
  const orderedCats=Object.keys(groups).sort((a,b)=>{
    return groups[b].reduce((s,t)=>s+(t.amount||0),0)-groups[a].reduce((s,t)=>s+(t.amount||0),0);
  });
  listEl.innerHTML=orderedCats.map(cat=>{
    const items=groups[cat];
    const catTotal=items.reduce((s,t)=>s+(t.amount||0),0);
    const gid='grp-'+cat.replace(/[^a-zA-Z0-9]/g,'');
    return`<div style="margin-bottom:6px">
      <div onclick="toggleExpGrp('${gid}')" style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--rsm);cursor:pointer;user-select:none">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:0.63rem;color:var(--text3);transition:transform 0.15s" id="${gid}-arrow">▶</span>
          ${isMonarch()?catBadge(cat):`<span style="font-size:0.9rem">${CAT_ICONS[cat]||'📋'}</span>`}
          <span style="font-size:0.8rem;font-weight:700">${cat}</span>
          <span style="font-size:0.62rem;color:var(--text3);font-family:var(--mono)">${items.length}</span>
        </div>
        <span style="font-family:var(--mono);font-size:0.82rem;color:var(--red)">${fmtCur(catTotal,cur,m,y)}</span>
      </div>
      <div id="${gid}" style="display:none;border:1px solid var(--border);border-top:none;border-radius:0 0 var(--rsm) var(--rsm);overflow:hidden">
        ${renderCatBody(items)}
      </div>
    </div>`;
  }).join('');
}

function toggleExpGrp(gid){
  const el=document.getElementById(gid);
  const arrow=document.getElementById(gid+'-arrow');
  if(!el) return;
  const open=el.style.display!=='none';
  el.style.display=open?'none':'block';
  if(arrow) arrow.style.transform=open?'':'rotate(90deg)';
}
function quickCatFilter(c){S.expCat=S.expCat===c?'All':c;const s=document.getElementById('exp-search');if(s)s.value='';renderExpenses();}

// ── Global search (across ALL months, not just the one currently loaded) ──
let _globalSearchCache=null; // {txns:[...], income:[...]} — fetched once per modal open
let _globalSearchDebounceT=null;

async function openGlobalSearch(){
  openMod('global-search-modal');
  const input=document.getElementById('global-search-input');
  if(input) input.value='';
  document.getElementById('global-search-body').innerHTML='<div class="csub">Loading all transactions…</div>';
  if(!db){document.getElementById('global-search-body').innerHTML='<div class="empty"><div class="empty-i">⚠</div>Needs a connection</div>';return;}
  try{
    const [txSnap,incSnap]=await Promise.all([
      db.collection('transactions').get(),
      db.collection('income').get(),
    ]);
    _globalSearchCache={
      txns:txSnap.docs.map(d=>({id:d.id,...d.data(),_kind:'expense'})),
      income:incSnap.docs.map(d=>({id:d.id,...d.data(),_kind:'income'})),
    };
  }catch(e){
    document.getElementById('global-search-body').innerHTML='<div class="empty"><div class="empty-i">⚠</div>Could not load — check connection</div>';
    return;
  }
  document.getElementById('global-search-body').innerHTML='<div class="csub">Type to search every transaction across every month.</div>';
  if(input) input.focus();
}

function _debounceGlobalSearch(){
  clearTimeout(_globalSearchDebounceT);
  _globalSearchDebounceT=setTimeout(_runGlobalSearch,220);
}

function _runGlobalSearch(){
  const body=document.getElementById('global-search-body');
  const q=(document.getElementById('global-search-input')?.value||'').toLowerCase().trim();
  if(!q){body.innerHTML='<div class="csub">Type to search every transaction across every month.</div>';return;}
  if(!_globalSearchCache){body.innerHTML='<div class="csub">Still loading…</div>';return;}
  const all=[...(_globalSearchCache.txns||[]),...(_globalSearchCache.income||[])];
  const results=all.filter(r=>{
    const hay=[r.payee,r.category,r.notes].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  }).sort((a,b)=>(b.date||'')>(a.date||'')?1:-1).slice(0,200);
  if(!results.length){body.innerHTML='<div class="empty"><div class="empty-i">🔍</div>No matches</div>';return;}
  body.innerHTML=`<div class="csub" style="margin-bottom:6px">${results.length} match${results.length>1?'es':''}${results.length===200?' (showing first 200)':''}</div>`+
    results.map(r=>{
      const isExp=r._kind==='expense';
      const amt=isExp?(r.amount||0):(r.amtNGN||r.amount||0);
      const label=isExp?(r.payee||r.category||'Expense'):(r.category||'Income');
      const monthLabel=r.month&&r.year?`${MONTHS[r.month-1]} ${r.year}`:'';
      return`<div class="dc" style="margin-bottom:6px;cursor:pointer" onclick="_jumpToGlobalResult(${r.month||0},${r.year||0})">
        <div class="dc-top">
          <div>
            <div class="dc-name">${esc(label)}</div>
            <div class="dc-sub">${monthLabel}${r.date?' · '+fmtDate(r.date):''}${r.notes?' · '+esc(r.notes):''}</div>
          </div>
          <div style="font-family:var(--mono);font-size:0.8rem;color:${isExp?'var(--red)':'var(--green)'}">${isExp?'-':'+'}${fN(amt)}</div>
        </div>
      </div>`;
    }).join('');
}

function _jumpToGlobalResult(m,y){
  if(!m||!y) return;
  closeMod('global-search-modal');
  const btn=document.getElementById('exp-tab-btn');
  if(btn) switchExpTab('expenses',btn);
  reloadMonth(m,y);
  toast(`Jumped to ${MONTHS[m-1]} ${y}`);
}
function setCatFilter(c){S.expCat=c;renderExpenses();}
function openFilterDrawer(){
  const grid=document.getElementById('filter-grid');
  grid.innerHTML=['All',...CATS].map(c=>`<div class="filter-chip ${c===S.expCat?'active':''}" onclick="setCatFilter('${c}');document.querySelectorAll('.filter-chip').forEach(x=>x.classList.remove('active'));this.classList.add('active')">${c}</div>`).join('');
  document.getElementById('filter-drawer').classList.add('open');
}
function closeFilterDrawer(){document.getElementById('filter-drawer').classList.remove('open');renderExpenses();}
function clearFilter(){S.expCat='All';closeFilterDrawer();}

// ══════════════════════════════════════════════════════════════════════════
// SWIPE-TO-DELETE
// ══════════════════════════════════════════════════════════════════════════
const _swipe={};  // per-id touch state

function attachSwipeHandlers(){
  // Nothing extra needed — handlers are inline on each row via ontouchstart etc.
  // This function is kept as a hook for future use.
}

function swipeStart(e, id){
  const touch=e.touches[0];
  _swipe[id]={startX:touch.clientX,startY:touch.clientY,dx:0,active:true,passed:false};
}

function swipeMove(e, id){
  const st=_swipe[id];
  if(!st||!st.active) return;
  const touch=e.touches[0];
  const dx=touch.clientX-st.startX;
  const dy=touch.clientY-st.startY;

  // If vertical scroll is dominant, don't hijack
  if(!st.passed&&Math.abs(dy)>Math.abs(dx)&&Math.abs(dy)>8){st.active=false;return;}
  if(Math.abs(dx)>8) st.passed=true;
  if(!st.passed) return;

  // Only allow left-swipe (negative dx)
  const clampedDx=Math.min(0,dx);
  st.dx=clampedDx;

  const row=document.getElementById('txi-'+id);
  const bg=document.getElementById('swbg-'+id);
  if(!row||!bg) return;

  row.classList.add('swiping');
  row.style.transform=`translateX(${clampedDx}px)`;

  // Reveal the red bg proportionally, full opacity at 80px
  const pct=Math.min(1,Math.abs(clampedDx)/80);
  bg.style.opacity=pct;

  // Prevent page scroll while swiping horizontally
  if(Math.abs(dx)>10) e.preventDefault();
}

function swipeEnd(e, id){
  const st=_swipe[id];
  if(!st) return;
  const row=document.getElementById('txi-'+id);
  const bg=document.getElementById('swbg-'+id);
  if(!row||!bg){delete _swipe[id];return;}

  row.classList.remove('swiping');

  if(Math.abs(st.dx)>=72){
    // Committed — execute delete with haptic, animate out
    haptic([8,30,18]);
    row.style.transform='translateX(-100%)';
    bg.style.opacity='1';
    const wrap=document.getElementById('sw-'+id);
    if(wrap){
      wrap.style.transition='max-height 0.28s ease, opacity 0.28s ease';
      wrap.style.overflow='hidden';
      // Collapse height then delete
      requestAnimationFrame(()=>{
        wrap.style.maxHeight=wrap.offsetHeight+'px';
        requestAnimationFrame(()=>{
          wrap.style.maxHeight='0';
          wrap.style.opacity='0';
          setTimeout(()=>delExpense(id),300);
        });
      });
    } else {
      delExpense(id);
    }
  } else {
    // Not committed — snap back
    row.style.transform='translateX(0)';
    bg.style.opacity='0';
  }
  delete _swipe[id];
}

// ── TRANSACTION TYPE UI ──
let _txnType='expense';
function setTxnType(type){
  _txnType=type;
  document.getElementById('e-type').value=type;
  ['expense','income','transfer'].forEach(t=>{
    const btn=document.getElementById('type-'+t);if(!btn)return;
    btn.style.borderWidth=t===type?'2px':'1px';
    btn.style.opacity=t===type?'1':'0.55';
  });
  document.getElementById('e-expense-fields').style.display=type==='expense'?'block':'none';
  document.getElementById('e-income-fields').style.display=type==='income'?'block':'none';
  document.getElementById('e-transfer-fields').style.display=type==='transfer'?'block':'none';
  const saveBtn=document.getElementById('e-save');
  if(saveBtn)saveBtn.textContent=type==='income'?'Record Income':type==='transfer'?'Transfer Funds':'Save Expense';
  const title=document.getElementById('exp-modal-title');
  if(title)title.textContent=type==='income'?'Record Income':type==='transfer'?'Transfer':type==='expense'?'New Expense':'Transaction';
}
function autoSuggestCat(payee){
  // User-defined rules (appConfig/rules) take precedence over built-in keywords.
  const ruleCat=applyRules(payee);
  const cat=ruleCat||smartCat(payee);
  const hint=document.getElementById('e-autocat-hint');
  const catSel=document.getElementById('e-cat');
  if(cat&&catSel){catSel.value=cat;updateExpenseLines();if(hint)hint.textContent=ruleCat?'↑ rule':'↑ auto';}
  else{if(hint)hint.textContent='';}
}
function updateRecurDesc(){
  const v=document.getElementById('e-recur')?.value;
  const el=document.getElementById('recur-desc');
  if(el)el.textContent=v?`Repeats ${v}`:'One-time';
}
function getExpLines(cat){
  return[...new Set([...(CAT_LINES[cat]||[]),...(S.customExpLines[cat]||[])].filter(p=>{const removed=(S.customExpLines['__removed__']||{})[cat]||[];return!removed.includes(p);}))];
}
function updateExpenseLines(){
  const cat=document.getElementById('e-cat')?.value;if(!cat)return;
  const lines=getExpLines(cat).slice().sort((a,b)=>a.localeCompare(b));
  const sel=document.getElementById('e-payee-sel');
  if(sel)sel.innerHTML=['-- Select --',...lines,'+ Add new'].map(l=>`<option value="${l}">${l}</option>`).join('');
  const wrap=document.getElementById('e-payee-new-wrap');if(wrap)wrap.style.display='none';
  const hint=document.getElementById('e-autocat-hint');if(hint)hint.textContent='';
}
function handlePayeeSel(){
  const val=document.getElementById('e-payee-sel')?.value;
  const wrap=document.getElementById('e-payee-new-wrap');
  if(wrap)wrap.style.display=val==='+ Add new'?'block':'none';
}
function openExpModal(type){
  type=type||'expense';_txnType=type;
  const catSel=document.getElementById('e-cat');
  catSel.innerHTML=getAllCats().map(c=>`<option value="${c}">${CAT_ICONS[c]||''} ${c}</option>`).join('');
  const bankOpts=cashOptsWithBal();
  document.getElementById('e-bank').innerHTML=bankOpts;
  updateExpAmtLabel();
  const ib2=document.getElementById('i-bank2');if(ib2)ib2.innerHTML=bankOpts;
  const xf=document.getElementById('xfr2-from'),xt=document.getElementById('xfr2-to');
  if(xf)xf.innerHTML=bankOpts;if(xt)xt.innerHTML=bankOpts;
  document.getElementById('e-date').value=todayStr();
  document.getElementById('e-amt').value='';
  document.getElementById('e-notes').value='';
  document.getElementById('e-payee-new').value='';
  document.getElementById('e-payee-new-wrap').style.display='none';
  document.getElementById('e-edit-id').value='';
  const rr=document.getElementById('e-recur');if(rr)rr.value='';
  updateRecurDesc();
  _xfrType='cash-cash';setXfrType('cash-cash');
  const hint=document.getElementById('e-autocat-hint');if(hint)hint.textContent='';
  setTxnType(type);updateExpenseLines();
  openMod('exp-modal');
  setTimeout(()=>{initNumInputs(document.getElementById('exp-modal'));document.getElementById('e-amt').focus();},80);
}
function openEditExp(id){
  const tx=S.txns.find(t=>t.id===id);if(!tx)return;
  openExpModal('expense');
  document.getElementById('e-edit-id').value=id;
  const title=document.getElementById('exp-modal-title');if(title)title.textContent='Edit Expense';
  const saveBtn=document.getElementById('e-save');if(saveBtn)saveBtn.textContent='Update Expense';
  document.getElementById('e-amt').value=tx.amount;
  document.getElementById('e-cat').value=tx.category;
  updateExpenseLines();
  const ps=document.getElementById('e-payee-sel');if(ps)ps.value=tx.payee||'-- Select --';
  document.getElementById('e-notes').value=tx.notes||'';
  document.getElementById('e-date').value=tx.date||todayStr();
  const eb=document.getElementById('e-bank');if(eb&&tx.bank)eb.value=tx.bank;
}
const openEditExpense=openEditExp; // alias used in category popup

// ── CASH BALANCE HELPERS ────────────────────────────────────────────────────
// Pending-write tracker: while an atomic increment is in flight, the field is
// "dirty" so loadCashData lets the local value win. Once the server confirms,
// the field is cleared and remote increments from OTHER devices flow through.
const _cashDirty={}; // key: `${y}-${m}|${bank}` -> count of in-flight writes
function _cashDirtyKey(m,y,bank){return `${y}-${m}|${bank}`;}
function _markCashDirty(m,y,bank){const k=_cashDirtyKey(m,y,bank);_cashDirty[k]=(_cashDirty[k]||0)+1;}
function _clearCashDirty(m,y,bank){const k=_cashDirtyKey(m,y,bank);if(_cashDirty[k]){_cashDirty[k]--;if(_cashDirty[k]<=0)delete _cashDirty[k];}}
function _isCashDirty(m,y,bank){return !!_cashDirty[_cashDirtyKey(m,y,bank)];}

// Append a reason entry to the cash ledger so the audit can explain any gap.
// Also mirrored to Firestore (one doc per month, entries appended via
// arrayUnion) so the drill-down ledger is visible on every device, not
// just the one that made the change.
function _logCashLedger(bank, delta, m, y, source, ref){
  try{
    const key=`sw3_cash_ledger_${y}_${m}`;
    const entry={ts:Date.now(),date:todayStr(),bank,delta:Math.round(delta*100)/100,source:source||'',ref:ref||''};
    const log=cGet(key)||[];
    log.push(entry);
    cSet(key, log.slice(-500)); // cap per month (local cache only)
    if(db){
      db.collection('cashLedger').doc(sid(m,y)).set({
        month:m, year:y,
        entries: firebase.firestore.FieldValue.arrayUnion(entry)
      },{merge:true}).catch(()=>{});
    }
  }catch(e){}
}

// Push cash-ledger entries that exist locally but not in Firestore.
// The per-entry write above is fire-and-forget with no retry, so an entry made
// while offline (or during a transient write failure) can end up stranded in
// one device's localStorage — visible in that device's balance audit but
// invisible everywhere else, because the balance itself DID sync (atomic
// increment + ripple queue) while its ledger explanation did not. This
// reconciles local → Firestore so stranded entries propagate. arrayUnion
// dedupes on exact match, so entries that already synced are no-ops.
// Returns the number of entries pushed.
async function _syncCashLedgerUp(m,y){
  if(!db||!navigator.onLine) return 0;
  const local=cGet(`sw3_cash_ledger_${y}_${m}`)||[];
  if(!local.length) return 0;
  let remote=[];
  try{const d=await db.collection('cashLedger').doc(sid(m,y)).get();if(d.exists&&Array.isArray(d.data().entries))remote=d.data().entries;}catch(e){return 0;}
  const seen=new Set(remote.map(e=>`${e.ts}|${e.bank}|${e.delta}|${e.source}`));
  const missing=local.filter(e=>!seen.has(`${e.ts}|${e.bank}|${e.delta}|${e.source}`));
  if(!missing.length) return 0;
  try{
    await db.collection('cashLedger').doc(sid(m,y)).set({
      month:m, year:y,
      entries: firebase.firestore.FieldValue.arrayUnion(...missing)
    },{merge:true});
    return missing.length;
  }catch(e){return 0;}
}

// Reconcile the ledger for the current + several recent months on app open,
// so a device that stranded entries heals automatically without the user
// having to open the audit.
async function _healCashLedgers(){
  if(!db||!navigator.onLine) return;
  const seen=new Set();
  for(const {m,y} of _prevMonthsList(S.expMonth+1,S.expYear,7)){ // current month + 6 prior
    const k=`${y}-${m}`; if(seen.has(k))continue; seen.add(k);
    try{await _syncCashLedgerUp(m,y);}catch(e){}
  }
}

// Walk back up to 12 months to find the most recent month with real closing
// balances, checking Firestore first then the local cache. Shared by the
// doc-seed path and the loadCashData repair path.
async function _walkBackClosing(m,y){
  let pm=m,py=y;
  for(let i=0;i<12;i++){
    pm=pm===1?12:pm-1; py=pm===12?py-1:py;
    if(db){
      try{
        const pd=await db.collection('cashBalances').doc(sid(pm,py)).get();
        if(pd.exists&&pd.data()){
          const p=pd.data(),out={};
          Object.keys(p).forEach(k=>{if(k!=='month'&&k!=='year'&&k!=='updatedAt')out[k]=p[k];});
          if(Object.keys(out).length) return out;
        }
      }catch(e){}
    }
    const lc=cGet(CK.cash(pm,py));
    if(lc&&Object.keys(lc).some(k=>k!=='month'&&k!=='year'&&lc[k])){
      const out={};Object.keys(lc).forEach(k=>{if(k!=='month'&&k!=='year')out[k]=lc[k];});
      return out;
    }
  }
  return {};
}

// In-flight ensure promises so concurrent _adjustCash calls share one seed.
const _cashEnsureInflight={};
async function _ensureCashDoc(m,y){
  if(!db) return;
  const id=sid(m,y);
  if(_cashEnsureInflight[id]) return _cashEnsureInflight[id];
  _cashEnsureInflight[id]=(async()=>{
    const ref=db.collection('cashBalances').doc(id);
    try{
      // Transaction = atomic create-if-missing. If the doc exists, do nothing,
      // so a seed can never overwrite an increment that landed first.
      await db.runTransaction(async t=>{
        const snap=await t.get(ref);
        if(snap.exists) return;
        const prev=await _walkBackClosing(m,y);
        t.set(ref,{...prev,month:m,year:y});
      });
    }catch(e){/* offline or rules error: increment path still queues via oqAdd */}
    finally{delete _cashEnsureInflight[id];}
  })();
  return _cashEnsureInflight[id];
}

// Tiny persisted retry queue for ripple increments that failed to write.
function _rippleQueueAdd(bank,delta,m,y){
  const q=cGet('sw3_ripple_queue')||[];
  q.push({bank,delta,m,y,ts:Date.now()});
  cSet('sw3_ripple_queue',q.slice(-200));
}
async function _rippleQueueFlush(){
  if(!db||!navigator.onLine) return;
  const q=cGet('sw3_ripple_queue')||[];
  if(!q.length) return;
  cSet('sw3_ripple_queue',[]);
  for(const it of q){
    try{await db.collection('cashBalances').doc(sid(it.m,it.y))
      .set({[it.bank]:firebase.firestore.FieldValue.increment(it.delta)},{merge:true});}
    catch(e){_rippleQueueAdd(it.bank,it.delta,it.m,it.y);}
  }
}

// Apply the same delta to every LATER month doc that already exists, because
// each month stores a running balance derived from earlier months.
async function _rippleCashForward(bank,delta,m,y){
  if(!db||!delta) return;
  try{
    const snap=await db.collection('cashBalances')
      .where(firebase.firestore.FieldPath.documentId(),'>',sid(m,y)).get();
    if(snap.empty) return;
    const writes=[];
    snap.docs.forEach(d=>{
      if(!/^\d{4}-\d{2}$/.test(d.id)) return; // safety: month docs only
      const parts=d.id.split('-'),ry=+parts[0],rm=+parts[1];
      _markCashDirty(rm,ry,bank);
      writes.push(
        d.ref.set({[bank]:firebase.firestore.FieldValue.increment(delta)},{merge:true})
          .then(()=>_clearCashDirty(rm,ry,bank))
          .catch(()=>{_clearCashDirty(rm,ry,bank);_rippleQueueAdd(bank,delta,rm,ry);})
      );
      // Keep the local cache for that later month in step too.
      const c=cGet(CK.cash(rm,ry));
      if(c){c[bank]=(c[bank]||0)+delta;cSet(CK.cash(rm,ry),c);}
      // If the user is currently VIEWING that later month, update live state.
      if(rm===S.cashMonth&&ry===S.cashYear){S.cash={...(S.cash||{}),[bank]:((S.cash||{})[bank]||0)+delta};}
    });
    await Promise.all(writes);
    renderCashPage();renderDashboard();
  }catch(e){/* offline: local caches were not touched; queue nothing extra */}
}

function _adjustCash(bank, delta, m, y, source, ref){
  // delta: positive = add, negative = deduct
  if(!bank||!delta) return;
  // Update local state immediately for instant UI (single-device correctness).
  const isCurMonth=(m===S.cashMonth&&y===S.cashYear)||(m===S.dashMonth&&y===S.dashYear);
  const base=isCurMonth&&Object.keys(S.cash||{}).length?{...S.cash}:{...(cGet(CK.cash(m,y))||{})};
  base[bank]=(base[bank]||0)+delta;
  if(m===S.cashMonth&&y===S.cashYear) S.cash=base;
  if(m===S.dashMonth&&y===S.dashYear) S.cash=base;
  cSet(CK.cash(m,y),base);
  _logCashLedger(bank, delta, m, y, source, ref);
  // Firestore write is an ATOMIC field increment — commutes with concurrent
  // writes to other fields/devices, so balances can't clobber each other.
  // Seed the month doc first (create-if-missing from the prior closing
  // balance) so an increment on a brand-new month never starts from zero,
  // then ripple the same delta into every later month that already exists.
  if(db){
    _markCashDirty(m,y,bank);
    (async()=>{
      try{
        await _ensureCashDoc(m,y);
        await db.collection('cashBalances').doc(sid(m,y)).set({
          [bank]: firebase.firestore.FieldValue.increment(delta),
          month:m, year:y
        },{merge:true});
        _clearCashDirty(m,y,bank);
        _rippleCashForward(bank,delta,m,y); // fire-and-forget
      }catch(e){
        _clearCashDirty(m,y,bank);
        // Queue a full-doc fallback so the delta isn't lost while offline
        oqAdd('cashBalances', sid(m,y), {...base, month:m, year:y}, true);
      }
    })();
  }
  renderCashPage();renderDashboard();
}

// Save a lightweight transfer record for history display
function _saveXfrRecord(from, to, amt, date, m, y, notes, toAmt, kind){
  // amount is in the FROM side's currency; toAmt is what the TO side received (falls back to amount)
  const rec={id:'xfr_'+Date.now(),from,to,amount:amt,toAmt:toAmt!=null?toAmt:amt,kind:kind||'',date,notes:notes||'',month:m,year:y,createdAt:Date.now()};
  const list=cGet(CK.xfr(m,y))||[];
  list.unshift(rec);
  cSet(CK.xfr(m,y),list);
  if(db) db.collection('transfers').doc(rec.id).set(rec).catch(()=>{});
}

// ── Shared investment balance mutators (keep subs + flat totals in sync) ──
// All amounts are NGN equivalents (USD platforms store NGN per the storage rule).
function _invDeposit(pKey, ngnAmt, m, y){
  const subs=migrateToSubs(pKey);
  subs[0].principal=(Number(subs[0].principal)||0)+ngnAmt;
  saveSubsForPlatform(pKey,subs);
  const inv={...S.investments};inv[pKey]=subs.reduce((s,sb)=>s+(Number(sb.principal)||0),0);
  S.investments=inv;cSet(CK.inv(m,y),inv);
  if(db)db.collection('investments').doc(sid(m,y)).set({...inv,month:m,year:y},{merge:true}).catch(()=>{});
}
function _invWithdraw(pKey, ngnAmt, m, y){
  // Returns false if the platform balance is insufficient. Deducts across subs in order.
  const subs=migrateToSubs(pKey);
  let subTotal=subs.reduce((s,sb)=>s+(Number(sb.principal)||0),0);
  const flat=S.investments[pKey]||0;
  if(subTotal===0&&flat>0){subs[0].principal=flat;subTotal=flat;} // repair corrupt zero-principal subs
  if(subTotal<ngnAmt) return false;
  let rem=ngnAmt;
  subs.forEach(sb=>{if(rem<=0)return;const p=Number(sb.principal)||0;const d=Math.min(p,rem);sb.principal=p-d;rem-=d;});
  saveSubsForPlatform(pKey,subs);
  const inv={...S.investments};inv[pKey]=subs.reduce((s,sb)=>s+(Number(sb.principal)||0),0);
  S.investments=inv;cSet(CK.inv(m,y),inv);
  if(db)db.collection('investments').doc(sid(m,y)).set({...inv,month:m,year:y},{merge:true}).catch(()=>{});
  return true;
}

// ── TRANSFER HISTORY (view / reverse / delete) ────────────────────────────
async function openXfrHistory(){
  const m=S.cashMonth||S.expMonth,y=S.cashYear||S.expYear;
  document.getElementById('xfr-hist-title').textContent=`Transfers — ${MONTHS[m-1]} ${y}`;
  const body=document.getElementById('xfr-hist-body');
  body.innerHTML='<div class="csub">Loading…</div>';
  openMod('xfr-hist-modal');
  // Local cache first, then merge Firestore records for cross-device coverage
  let recs=cGet(CK.xfr(m,y))||[];
  try{
    const snap=await db.collection('transfers').where('year','==',y).where('month','==',m).get();
    const seen=new Set(recs.map(r=>r.id));
    snap.docs.forEach(d=>{const r=d.data();if(!seen.has(r.id)){recs.push(r);seen.add(r.id);}});
    cSet(CK.xfr(m,y),recs);
  }catch(e){}
  recs.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  _renderXfrHistory(recs,m,y);
}
function _xfrSideLabel(name){
  if(getCashAccounts().includes(name))return name;
  return PLATFORMS.find(p=>p.key===name)?.label||name;
}
function _xfrAmtDisp(name,val){
  return getCashAccounts().includes(name)&&isUSDCashAccount(name)?'$'+Number(val).toLocaleString('en-US',{maximumFractionDigits:2}):fN(val);
}
function _renderXfrHistory(recs,m,y){
  const body=document.getElementById('xfr-hist-body');
  if(!recs.length){body.innerHTML='<div class="empty"><div class="empty-i">⇄</div>No transfers this month</div>';return;}
  body.innerHTML=recs.map(r=>{
    const toVal=r.toAmt!=null?r.toAmt:r.amount;
    const cross=String(_xfrAmtDisp(r.from,r.amount))!==String(_xfrAmtDisp(r.to,toVal));
    return`<div class="dc" style="margin-bottom:8px">
      <div class="dc-top">
        <div>
          <div class="dc-name" style="font-size:0.78rem">${esc(_xfrSideLabel(r.from))} → ${esc(_xfrSideLabel(r.to))}</div>
          <div class="dc-sub">${fmtDate(r.date)}${r.notes?' · '+esc(r.notes):''}</div>
        </div>
        <div style="text-align:right">
          <div style="font-family:var(--mono);font-size:0.82rem;color:var(--blue)">${_xfrAmtDisp(r.from,r.amount)}</div>
          ${cross?`<div style="font-size:0.6rem;color:var(--text3);font-family:var(--mono)">→ ${_xfrAmtDisp(r.to,toVal)}</div>`:''}
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-top:8px">
        <button class="btn btn-g btn-sm" onclick="reverseTransfer('${r.id}')">↩ Reverse</button>
        <button class="btn btn-g btn-sm" onclick="removeXfrRecord('${r.id}')" style="color:var(--red)">× Remove record</button>
      </div>
    </div>`;}).join('')+
    '<div class="csub" style="margin-top:4px">Reverse undoes the balance changes and removes the record. Remove deletes only the log entry, leaving balances untouched.</div>';
}
async function reverseTransfer(recId){
  const m=S.cashMonth||S.expMonth,y=S.cashYear||S.expYear;
  const recs=cGet(CK.xfr(m,y))||[];
  const r=recs.find(x=>x.id===recId);
  if(!r){toast('Record not found');return;}
  if(!confirm(`Reverse this transfer?\n\n${_xfrSideLabel(r.from)} → ${_xfrSideLabel(r.to)}\n${_xfrAmtDisp(r.from,r.amount)}\n\nBalances on both sides will be restored.`))return;
  const toVal=r.toAmt!=null?r.toAmt:r.amount;
  const fromIsCash=getCashAccounts().includes(r.from);
  const toIsCash=getCashAccounts().includes(r.to);
  // Take back from the TO side first — abort cleanly if it lacks funds
  if(toIsCash){
    if((S.cash[r.to]||0)<toVal&&!confirm(`${r.to} has less than the transferred amount. Reverse anyway (balance may go negative)?`))return;
    _adjustCash(r.to,-toVal,r.month||m,r.year||y);
  }else{
    if(!_invWithdraw(r.to,toVal,r.month||m,r.year||y)){toast(`Insufficient balance in ${_xfrSideLabel(r.to)} to reverse`);return;}
  }
  // Give back to the FROM side
  if(fromIsCash) _adjustCash(r.from,r.amount,r.month||m,r.year||y);
  else _invDeposit(r.from,r.amount,r.month||m,r.year||y);
  await _deleteXfrRecord(recId,m,y);
  toast('Transfer reversed');haptic([8,40,8]);
  renderCashPage();renderInvestments();renderDashboard();
  openXfrHistory();
}
async function removeXfrRecord(recId){
  const m=S.cashMonth||S.expMonth,y=S.cashYear||S.expYear;
  if(!confirm('Remove this record from the log? Balances will NOT change.'))return;
  await _deleteXfrRecord(recId,m,y);
  toast('Record removed');
  openXfrHistory();
}
async function _deleteXfrRecord(recId,m,y){
  const recs=(cGet(CK.xfr(m,y))||[]).filter(x=>x.id!==recId);
  cSet(CK.xfr(m,y),recs);
  try{await db.collection('transfers').doc(recId).delete();}catch(e){}
}

async function saveExpense(){
  if(S.saving)return;
  const type=document.getElementById('e-type')?.value||'expense';
  const amt=parseFloat(document.getElementById('e-amt').value);
  if(!amt||amt<=0){toast('Enter a valid amount');return;}

  // ── Transfer ──
  if(type==='transfer'){
    const from=document.getElementById('xfr2-from')?.value,to=document.getElementById('xfr2-to')?.value;
    if(!from||!to){toast('Select accounts');return;}
    const m=S.expMonth,y=S.expYear;
    const date=document.getElementById('e-date').value||todayStr();
    const notes=document.getElementById('e-notes').value||'';

    const _fx=getFxRates(m,y).USD||1650;

    if(_xfrType==='cash-cash'){
      if(from===to){toast('Select different accounts');return;}
      if((S.cash[from]||0)<amt){toast(`Insufficient funds in ${from}`);return;}
      const fU=isUSDCashAccount(from),tU=isUSDCashAccount(to);
      // Amount is entered in the FROM account's currency; convert when currencies differ
      const toAmt=fU===tU?amt:(fU?Math.round(amt*_fx):+(amt/_fx).toFixed(2));
      const cash={...S.cash};cash[from]=(cash[from]||0)-amt;cash[to]=(cash[to]||0)+toAmt;
      S.cash=cash;cSet(CK.cash(m,y),cash);
      if(db)db.collection('cashBalances').doc(sid(m,y)).set({...cash,month:m,year:y},{merge:true}).catch(()=>{});
      _saveXfrRecord(from,to,amt,date,m,y,notes,toAmt,'cash-cash');
      toast(fU===tU?`${fU?'$'+amt:fN(amt)}: ${from} → ${to}`:`${fU?'$'+amt:fN(amt)} → ${tU?'$'+toAmt:fN(toAmt)}: ${from} → ${to}`);

    } else if(_xfrType==='cash-inv'){
      // Deduct from cash (account currency), add NGN equivalent to investment
      if((S.cash[from]||0)<amt){toast(`Insufficient funds in ${from}`);return;}
      const ngnAmt=isUSDCashAccount(from)?Math.round(amt*_fx):amt;
      const cash={...S.cash};cash[from]=(cash[from]||0)-amt;
      S.cash=cash;cSet(CK.cash(m,y),cash);
      if(db)db.collection('cashBalances').doc(sid(m,y)).set({...cash,month:m,year:y},{merge:true}).catch(()=>{});
      _invDeposit(to,ngnAmt,m,y);
      const platLabel=PLATFORMS.find(p=>p.key===to)?.label||to;
      _saveXfrRecord(from,to,amt,date,m,y,notes,ngnAmt,'cash-inv');
      toast(`${isUSDCashAccount(from)?'$'+amt:fN(ngnAmt)}: ${from} → ${platLabel}`);

    } else {
      // inv-cash: deduct NGN from investment, credit cash in its own currency
      const platLabel=PLATFORMS.find(p=>p.key===from)?.label||from;
      if(!_invWithdraw(from,amt,m,y)){toast(`Insufficient balance in ${platLabel}`);return;}
      const toAmt=isUSDCashAccount(to)?+(amt/_fx).toFixed(2):amt;
      const cash={...S.cash};cash[to]=(cash[to]||0)+toAmt;
      S.cash=cash;cSet(CK.cash(m,y),cash);
      if(db)db.collection('cashBalances').doc(sid(m,y)).set({...cash,month:m,year:y},{merge:true}).catch(()=>{});
      _saveXfrRecord(from,to,amt,date,m,y,notes,toAmt,'inv-cash');
      toast(`${fN(amt)}: ${platLabel} → ${to}`);
    }

    haptic([8,40,8]);closeMod('exp-modal');
    renderCashPage();renderInvestments();renderDashboard();
    return;
  }

  // ── Income ──
  if(type==='income'){
    S.saving=true;const btn=document.getElementById('e-save');btn.textContent='Saving…';btn.disabled=true;setSyncStatus('syncing');
    const incBank=document.getElementById('i-bank2')?.value||getCashAccounts()[0];
    const incIsUSD=isUSDCashAccount(incBank);
    const incDateVal=document.getElementById('e-date').value||todayStr();
    const _idp=incDateVal.split('-');const incTxM=parseInt(_idp[1]),incTxY=parseInt(_idp[0]);
    const incFxRates=getFxRates(incTxM,incTxY);
    const incAmtNGN=incIsUSD?Math.round(amt*incFxRates.USD):amt;
    const data={amount:amt,amtNGN:incAmtNGN,currency:incIsUSD?'USD':'NGN',category:document.getElementById('i-cat2')?.value||'Other',bank:incBank,notes:document.getElementById('e-notes').value,date:incDateVal,month:incTxM,year:incTxY,type:'income',createdAt:firebase.firestore.FieldValue.serverTimestamp()};
    // Save as recurring if set
    const freq=document.getElementById('e-recur')?.value;
    if(freq){const rl=getRecurring();rl.push({payee:data.category,amount:amt,incCat:data.category,bank:data.bank,notes:data.notes,frequency:freq,type:'income',nextRun:nextRunDate(freq,data.date),lastPosted:data.date});saveRecurring(rl);}
    try{
      const ref=await db.collection('income').add(data);
      S.income.unshift({...data,id:ref.id});
      cSet(CK.inc(incTxM,incTxY),S.income);
      _adjustCash(incBank, amt, incTxM, incTxY, 'income');
      const hist=cGet('sw3_history')||[];
      const hIdx=hist.findIndex(h=>h.year===incTxY&&h.month===incTxM);
      const totalInc=S.income.reduce((s,i)=>s+(i.amtNGN||i.amount||0),0);
      if(hIdx>=0){hist[hIdx].income=totalInc;}
      else{const MS2=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];hist.push({year:incTxY,month:incTxM,label:MS2[incTxM-1]+" '"+String(incTxY).slice(2),income:totalInc,expenses:S.txns.reduce((s,t)=>s+(t.amount||0),0)});hist.sort((a,b)=>a.year!==b.year?a.year-b.year:a.month-b.month);}
      cSet('sw3_history',hist);
      closeMod('exp-modal');toast(`Income recorded · ${incBank} updated`);haptic([8,40,8]);setSyncStatus('synced');renderDashboard();renderCashPage();renderIncome();
    }
    catch(e){
      // Queue for retry when back online; apply local state so the entry stays visible
      const qd={...data};delete qd.createdAt; // FieldValue sentinel doesn't survive JSON
      const offId='offline_inc_'+Date.now();
      oqAdd('income',offId,qd,true);
      S.income.unshift({...qd,id:offId});
      cSet(CK.inc(incTxM,incTxY),S.income);
      _adjustCash(incBank, amt, incTxM, incTxY);
      closeMod('exp-modal');toast('Saved offline — will sync when connected');
      renderIncome();renderDashboard();renderCashPage();
    }
    finally{S.saving=false;btn.textContent='Record Income';btn.disabled=false;}
    return;
  }

  // ── Expense ──
  const paySel=document.getElementById('e-payee-sel').value;let payee=paySel;
  if(paySel==='+ Add new'){
    payee=document.getElementById('e-payee-new').value.trim();
    if(!payee){toast('Enter a name');return;}
    // Prefix with chosen emoji if one was selected and name doesn't already start with one
    const _emojiBtn=document.getElementById('e-payee-emoji');
    const _chosenEmoji=_emojiBtn?_emojiBtn.textContent.trim():'';
    const _hasEmoji=_chosenEmoji&&_chosenEmoji!=='📦';
    const _firstChar=payee.codePointAt(0);
    const _alreadyEmoji=_firstChar>127;
    if(_hasEmoji&&!_alreadyEmoji) payee=_chosenEmoji+' '+payee;
    const cat=document.getElementById('e-cat').value;
    if(!S.customExpLines[cat])S.customExpLines[cat]=[];
    if(!S.customExpLines[cat].includes(payee))S.customExpLines[cat].push(payee);
    cSet(CK.customLines,S.customExpLines);
  }
  // Duplicate guard — same payee + amount + date is almost always a double-tap
  if(!document.getElementById('e-edit-id').value){
    const _dupDate=document.getElementById('e-date').value||todayStr();
    const _ddp=_dupDate.split('-');const _ddm=parseInt(_ddp[1]),_ddy=parseInt(_ddp[0]);
    const _pool=(_ddm===S.expMonth&&_ddy===S.expYear)?S.txns:(cGet(CK.txns(_ddm,_ddy))||[]);
    const _dupBank=document.getElementById('e-bank').value;
    const _dup=_pool.find(t=>t.payee===payee&&t.amount===amt&&t.date===_dupDate);
    if(_dup&&!confirm(`Possible duplicate: "${payee}" for ${isUSDCashAccount(_dupBank)?'$'+amt:fN(amt)} is already recorded on ${fmtDate(_dupDate)}.\n\nSave anyway?`))return;
  }
  S.saving=true;const btn=document.getElementById('e-save');btn.textContent='Saving…';btn.disabled=true;setSyncStatus('syncing');
  const editId=document.getElementById('e-edit-id').value;
  const freq=document.getElementById('e-recur')?.value;
  const expBank=document.getElementById('e-bank').value;
  const expIsUSD=isUSDCashAccount(expBank);
  const expDateVal=document.getElementById('e-date').value||todayStr();
  const _edp=expDateVal.split('-');const expTxM=parseInt(_edp[1]),expTxY=parseInt(_edp[0]);
  const expFxRates=getFxRates(expTxM,expTxY);
  const amtNGN=expIsUSD?Math.round(amt*expFxRates.USD):amt;
  const data={amount:amt,amtNGN,currency:expIsUSD?'USD':'NGN',category:document.getElementById('e-cat').value,bank:expBank,payee,notes:document.getElementById('e-notes').value,date:expDateVal,month:expTxM,year:expTxY,type:'expense'};
  if(freq&&!editId){
    const rl=getRecurring();
    rl.push({payee,amount:amt,category:data.category,bank:data.bank,notes:data.notes,frequency:freq,type:'expense',nextRun:nextRunDate(freq,data.date),lastPosted:data.date});
    saveRecurring(rl);renderRecurringCard();
  }
  // Capture before the try so the catch block can compute the correct net delta.
  const _editTx=editId?S.txns.find(t=>t.id===editId):null;
  try{
    if(editId){
      await db.collection('transactions').doc(editId).update(data);
      const idx=S.txns.findIndex(t=>t.id===editId);if(idx>=0)S.txns[idx]={...S.txns[idx],...data};
      // Both adjustments AFTER the await — no snapshot can fire between them.
      // Same bank: single net delta (one Firestore increment, zero intermediate state).
      // Different banks: two independent fields on different-or-same doc, no ordering race.
      const _eOldBank=_editTx?.bank||'', _eOldAmt=_editTx?.amount||0;
      if(_eOldBank===data.bank&&_eOldBank){
        const _net=_eOldAmt-amt; // positive = expense reduced, negative = expense increased
        if(_net!==0) _adjustCash(data.bank, _net, expTxM, expTxY, 'expense-edit');
      }else{
        if(_eOldBank&&_eOldAmt) _adjustCash(_eOldBank, _eOldAmt, _editTx.month||expTxM, _editTx.year||expTxY, 'expense-edit-reverse');
        if(data.bank) _adjustCash(data.bank, -amt, expTxM, expTxY, 'expense-edit');
      }
    } else {
      data.createdAt=firebase.firestore.FieldValue.serverTimestamp();
      const ref=await db.collection('transactions').add(data);
      S.txns.unshift({...data,id:ref.id});
      if(data.bank) _adjustCash(data.bank, -amt, expTxM, expTxY, 'expense');                     // deduct
    }
    cSet(CK.txns(expTxM,expTxY),S.txns);closeMod('exp-modal');const _ep=document.getElementById('e-payee-emoji');if(_ep)_ep.textContent='📦';toast(editId?'Updated':'Saved');haptic([8,40,8]);setSyncStatus('synced');renderExpenses();renderDashboard();
  }catch(e){
    // Queue for retry when back online; apply local state so the entry stays visible
    const qData={...data};delete qData.createdAt; // FieldValue sentinel doesn't survive JSON
    const offId=editId||('offline_'+Date.now());
    oqAdd('transactions',offId,qData,true);
    if(editId){
      const idx=S.txns.findIndex(t=>t.id===editId);
      if(idx>=0)S.txns[idx]={...S.txns[idx],...qData};
      // Neither cash adjustment ran yet (both are after the failed await).
      const _ceOldBank=_editTx?.bank||'', _ceOldAmt=_editTx?.amount||0;
      if(_ceOldBank===data.bank&&_ceOldBank){
        const _cnet=_ceOldAmt-amt;
        if(_cnet!==0) _adjustCash(data.bank, _cnet, expTxM, expTxY, 'expense-edit');
      }else{
        if(_ceOldBank&&_ceOldAmt) _adjustCash(_ceOldBank, _ceOldAmt, _editTx?.month||expTxM, _editTx?.year||expTxY, 'expense-edit-reverse');
        if(data.bank) _adjustCash(data.bank, -amt, expTxM, expTxY, 'expense-edit');
      }
    }else{
      S.txns.unshift({...qData,id:offId});
      if(data.bank) _adjustCash(data.bank, -amt, expTxM, expTxY, 'expense');
    }
    cSet(CK.txns(expTxM,expTxY),S.txns);
    closeMod('exp-modal');toast('Saved offline — will sync when connected');
    renderExpenses();renderDashboard();
  }
  finally{S.saving=false;btn.textContent='Save Expense';btn.disabled=false;}
}
function delExpense(id){
  const idx=S.txns.findIndex(t=>t.id===id);
  const tx=idx>=0?S.txns[idx]:null;
  if(!tx)return;
  // Optimistically remove from local state immediately
  S.txns.splice(idx,1);
  cSet(CK.txns(S.expMonth,S.expYear),S.txns);
  // Restore cash balance immediately — to the transaction's own month bucket
  if(tx.bank&&tx.amount) _adjustCash(tx.bank, tx.amount, tx.month||S.expMonth, tx.year||S.expYear, 'expense-delete');
  renderExpenses();renderDashboard();
  haptic([6]);
  const rollback=()=>{
    S.txns.splice(Math.min(idx,S.txns.length),0,tx);
    cSet(CK.txns(S.expMonth,S.expYear),S.txns);
    if(tx.bank&&tx.amount) _adjustCash(tx.bank, -tx.amount, tx.month||S.expMonth, tx.year||S.expYear);
    renderExpenses();renderDashboard();
  };
  showUndoToast('Expense deleted',
    rollback,
    async ()=>{ // commit: permanent Firestore delete
      try{await db.collection('transactions').doc(id).delete();}
      catch(e){toast('Delete failed — restored');rollback();}
    });
}

// ══════════════════════════════════════════════════════════════════════════
// INCOME
// ══════════════════════════════════════════════════════════════════════════
function updateIncAmtLabel(){
  const bank=document.getElementById('i-bank')?.value||'';
  const lbl=document.getElementById('i-amt-label');
  if(lbl) lbl.textContent=isUSDCashAccount(bank)?'Amount ($)':'Amount (₦)';
}
function updateExpAmtLabel(){
  const bank=document.getElementById('e-bank')?.value||'';
  const lbl=document.getElementById('e-amt-label');
  if(lbl) lbl.textContent=isUSDCashAccount(bank)?'Amount ($)':'Amount (₦)';
}
function openIncModal(){
  _resetIncModal();
  document.getElementById('i-date').value=todayStr();
  ['i-amt','i-notes'].forEach(id=>document.getElementById(id).value='');
  const bankSel=document.getElementById('i-bank');
  if(bankSel){bankSel.innerHTML=cashOptsWithBal();updateIncAmtLabel();}
  openMod('inc-modal');
  setTimeout(()=>document.getElementById('i-amt').focus(),300);
}
async function saveIncome(){
  if(S.saving) return;
  const amt=parseFloat(document.getElementById('i-amt').value);
  if(!amt||amt<=0){toast('Enter a valid amount');return;}
  S.saving=true;const btn=document.getElementById('i-save');btn.textContent='Saving…';btn.disabled=true;setSyncStatus('syncing');
  const bank=document.getElementById('i-bank').value;
  const isUSD=isUSDCashAccount(bank);
  const dateVal=document.getElementById('i-date').value||todayStr();
  const _dp=dateVal.split('-');const txM=parseInt(_dp[1]),txY=parseInt(_dp[0]);
  const fxRates=getFxRates(txM,txY);
  const amtNGN=isUSD?Math.round(amt*fxRates.USD):amt;
  const editId=document.getElementById('i-edit-id')?.value||'';
  const data={amount:amt,amtNGN,currency:isUSD?'USD':'NGN',category:document.getElementById('i-cat').value,bank,notes:document.getElementById('i-notes').value,date:dateVal,month:txM,year:txY};
  // Capture before the try so the catch can compute the correct net delta.
  const _editInc=editId?S.income.find(i=>i.id===editId):null;
  try{
    if(editId){
      await db.collection('income').doc(editId).update(data);
      const idx=S.income.findIndex(i=>i.id===editId);
      if(idx>=0) S.income[idx]={...S.income[idx],...data};
      else S.income.unshift({...data,id:editId});
      cSet(CK.inc(txM,txY),S.income);
      // Both adjustments AFTER the await — same net-delta pattern as saveExpense.
      const _iOldBank=_editInc?.bank||'', _iOldAmt=_editInc?.amount||0;
      if(_iOldBank===bank&&_iOldBank){
        const _inet=amt-_iOldAmt; // positive = income increased, negative = decreased
        if(_inet!==0) _adjustCash(bank, _inet, txM, txY, 'income-edit');
      }else{
        if(_iOldBank&&_iOldAmt) _adjustCash(_iOldBank, -_iOldAmt, _editInc?.month||txM, _editInc?.year||txY, 'income-edit-reverse');
        _adjustCash(bank, amt, txM, txY, 'income-edit');
      }
      toast(`Income updated · ${bank} adjusted`);
    } else {
      const ref=await db.collection('income').add({...data,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
      S.income.unshift({...data,id:ref.id});
      cSet(CK.inc(txM,txY),S.income);
      _adjustCash(bank, amt, txM, txY, 'income');
      toast(`Income recorded · ${bank} updated`);
    }
    const hist=cGet('sw3_history')||[];
    const hIdx=hist.findIndex(h=>h.year===txY&&h.month===txM);
    const totalInc=S.income.reduce((s,i)=>s+(i.amtNGN||i.amount||0),0);
    if(hIdx>=0){hist[hIdx].income=totalInc;}
    else{const MS2=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];hist.push({year:txY,month:txM,label:MS2[txM-1]+" '"+String(txY).slice(2),income:totalInc,expenses:S.txns.reduce((s,t)=>s+(t.amount||0),0)});hist.sort((a,b)=>a.year!==b.year?a.year-b.year:a.month-b.month);}
    cSet('sw3_history',hist);
    haptic([8,40,8]);setSyncStatus('synced');
    closeMod('inc-modal');
    _resetIncModal();
    renderIncome();renderDashboard();renderCashPage();
  }catch(e){
    // Queue for retry when back online; apply local state so the entry stays visible
    const qd={...data};
    if(editId){
      oqAdd('income',editId,qd,true);
      const idx=S.income.findIndex(i=>i.id===editId);
      if(idx>=0)S.income[idx]={...S.income[idx],...qd};else S.income.unshift({...qd,id:editId});
      // Neither cash adjustment ran yet (both are now after the failed await).
      const _ciOldBank=_editInc?.bank||'', _ciOldAmt=_editInc?.amount||0;
      if(_ciOldBank===bank&&_ciOldBank){
        const _cinet=amt-_ciOldAmt;
        if(_cinet!==0) _adjustCash(bank, _cinet, txM, txY, 'income-edit');
      }else{
        if(_ciOldBank&&_ciOldAmt) _adjustCash(_ciOldBank, -_ciOldAmt, _editInc?.month||txM, _editInc?.year||txY, 'income-edit-reverse');
        _adjustCash(bank, amt, txM, txY, 'income-edit');
      }
    }else{
      const offId='offline_inc_'+Date.now();
      oqAdd('income',offId,qd,true);
      S.income.unshift({...qd,id:offId});
      _adjustCash(bank, amt, txM, txY, 'income');
    }
    cSet(CK.inc(txM,txY),S.income);
    closeMod('inc-modal');_resetIncModal();
    toast('Saved offline — will sync when connected');
    renderIncome();renderDashboard();renderCashPage();
  }
  finally{S.saving=false;btn.textContent=document.getElementById('i-edit-id')?.value?'Update Income':'Record Income';btn.disabled=false;}
}
function _resetIncModal(){
  const editIdEl=document.getElementById('i-edit-id');
  const titleEl=document.getElementById('inc-modal-title');
  const saveBtn=document.getElementById('i-save');
  if(editIdEl) editIdEl.value='';
  if(titleEl) titleEl.textContent='Record Income';
  if(saveBtn) saveBtn.textContent='Record Income';
}

// ══════════════════════════════════════════════════════════════════════════
// INVESTMENTS
// ══════════════════════════════════════════════════════════════════════════
function _getInvData(){
  // Always use freshest data for the month currently selected on the Accounts
  // page (S.cashMonth/S.cashYear — same month the Cash tab follows). Falls
  // back to the previous month's cache as a placeholder while the live fetch
  // (loadInvData, kicked off by changeCashMonth) is in flight — never an
  // arbitrary cached month, which used to surface stale/wrong-month data.
  const cur=cGet(CK.inv(S.cashMonth,S.cashYear));
  if(cur&&Object.keys(cur).some(k=>!['month','year'].includes(k)&&cur[k]>0)){
    S.investments={...cur};
  } else {
    const prevM=S.cashMonth===1?12:S.cashMonth-1,prevY=S.cashMonth===1?S.cashYear-1:S.cashYear;
    const prev=cGet(CK.inv(prevM,prevY));
    S.investments=(prev&&Object.keys(prev).some(k=>!['month','year'].includes(k)&&prev[k]>0))?{...prev}:{};
  }
  return S.investments;
}
function _renderInvInto(suffix){
  PLATFORMS=getPlatforms(); // always read from storage
  // suffix = '' for pg-investments, '-2' for pg-accounts acct-invest tab
  const s=suffix;
  const inv=_getInvData(),total=PLATFORMS.reduce((acc,p)=>acc+(inv[p.key]||0),0);
  const cur=S.dashCurrency,m=S.cashMonth,y=S.cashYear;
  const fxRates=getFxRates(m,y);
  const elTotal=document.getElementById('inv-total'+s);
  const elPlatforms=document.getElementById('inv-platforms'+s);
  const elAlloc=document.getElementById('inv-alloc'+s);
  const elAbar=document.getElementById('inv-abar'+s);
  const elLegend=document.getElementById('inv-legend'+s);
  const elEditLabel=document.getElementById('inv-edit-label'+s);
  const elEditFields=document.getElementById('inv-edit-fields'+s);

  // Split platforms into equities and fixed income
  const eqPlats=PLATFORMS.filter(p=>{const meta=getInvPlatformMeta(p.key);return meta.assetClass!=='fixed_income';});
  const fiPlats=PLATFORMS.filter(p=>{const meta=getInvPlatformMeta(p.key);return meta.assetClass==='fixed_income';});
  const eqTotal=eqPlats.reduce((acc,p)=>{const subs=getSubsForPlatform(p.key);const sp=subs.reduce((s,sb)=>s+(Number(sb.principal)||0),0);return acc+(sp>0?sp:(inv[p.key]||0));},0);
  const fiTotal=fiPlats.reduce((acc,p)=>{const subs=getSubsForPlatform(p.key);const sp=subs.reduce((s,sb)=>s+(Number(sb.principal)||0),0);return acc+(sp>0?sp:(inv[p.key]||0));},0);

  if(elTotal){
    const intBadge=fiPlats.filter(p=>getInvPlatformMeta(p.key).interestRate).length?`<span class="int-badge">Interest-bearing</span>`:'';
    elTotal.innerHTML=`<div class="clabel">Total Portfolio — ${MONTHS[m-1]} ${y}${eyeBtn('inv-page','renderInvestments')}</div><div class="cval">${total?maskIf('inv-page',fmtCur(total,cur==='NATIVE'?'NGN':cur,m,y)):'—'}${intBadge}</div><div class="csub" style="display:flex;gap:10px;margin-top:4px"><span style="color:var(--blue)">Equities ${eqTotal?maskIf('inv-page',fmtCur(eqTotal,cur==='NATIVE'?'NGN':cur,m,y)):'—'}</span><span style="color:var(--gold)">Fixed Income ${fiTotal?maskIf('inv-page',fmtCur(fiTotal,cur==='NATIVE'?'NGN':cur,m,y)):'—'}</span></div>`;
  }

  function _renderPlatRow(p){
    const subs=migrateToSubs(p.key);
    const fxRates=getFxRates(m,y);
    const isUSD=p.currency==='USD';
    const isGBP=p.currency==='GBP';
    const fxRate=isUSD?(fxRates.USD||1600):isGBP?(fxRates.GBP||2050):1;

    // ── Compute platform total (principal + accrued interest across all subs) ──
    let totalPrincipalNGN=0, totalInterestNGN=0, anyMatured=false;
    const subRows=subs.map(sub=>{
      const pNGN=Number(sub.principal)||0;
      totalPrincipalNGN+=pNGN;
      let interest=0,projBal=pNGN,isMatured=false;
      if(sub.assetClass==='fixed_income'&&sub.rate){
        // Pass empty movements — sub principals are tracked directly; platform-level
        // movements (no subId) would incorrectly reconstruct a doubled historical principal
        const r=calcInterestAccrual(pNGN,Number(sub.rate),sub.compoundType||'daily_accrual',sub.startDate||null,sub.maturityDate||null,[]);
        interest=r.interest; projBal=r.projectedBalance; isMatured=r.isMatured;
      }
      totalInterestNGN+=interest;
      if(isMatured) anyMatured=true;

      // Use fNum (no ₦ prefix) since dispCcy is prepended separately
      const dispPrincipal=isUSD?(pNGN/fxRate).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):fNum(pNGN);
      const dispTotal=isUSD?((projBal/fxRate).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})):fNum(Math.round(projBal));
      const dispCcy=isUSD?'$':isGBP?'£':'₦';
      const rateTag=sub.assetClass==='fixed_income'&&sub.rate?`<span class="int-badge">${sub.rate}%</span>`:'';
      const matTag=sub.maturityDate?`<span style="font-size:0.58rem;color:${isMatured?'var(--red)':'var(--text3)'}"> · ${isMatured?'Matured':'Matures'} ${fmtDate(sub.maturityDate)}</span>`:'';
      const intLine=interest>0?`<span style="font-size:0.6rem;color:var(--gold);font-family:var(--mono);margin-left:4px">(+${dispCcy}${isUSD?(interest/fxRate).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):fNum(Math.round(interest))})</span>`:'';

      const liqBtn=sub.assetClass==='fixed_income'&&pNGN>0
        ?`<div style="margin-top:5px;text-align:right"><button onclick="event.stopPropagation();openLiqModal('${p.key}','${sub.id}')" style="font-size:0.6rem;padding:2px 8px;border-radius:3px;background:rgba(255,80,80,0.12);border:1px solid rgba(255,80,80,0.3);color:var(--red);cursor:pointer">Liquidate</button></div>`
        :'';

      return{sub,pNGN,projBal,interest,isMatured,html:`
        <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:7px 12px;border-top:1px solid var(--border)">
          <div style="flex:1;min-width:0">
            <div style="font-size:0.74rem;font-weight:600;color:var(--text)">${esc(sub.label)}${rateTag}</div>
            <div style="font-size:0.6rem;color:var(--text3);margin-top:1px">${sub.startDate?'Since '+fmtDate(sub.startDate):''}${matTag}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;margin-left:10px">
            <div style="font-size:0.78rem;font-family:var(--mono);color:${p.color}">${maskIf('inv-page',`${dispCcy}${dispTotal}${intLine}`)}</div>
            ${interest>0&&!_isHidden('inv-page')?`<div style="font-size:0.58rem;color:var(--text3)">${dispCcy}${dispPrincipal} principal</div>`:''}
            ${liqBtn}
          </div>
        </div>`};
    });

    const subPrincipalTotal=totalPrincipalNGN;
    // Fall back to flat Firestore total if subs haven't been populated yet
    const effectivePrincipalNGN=subPrincipalTotal>0?subPrincipalTotal:(inv[p.key]||0);
    const platformNGN=effectivePrincipalNGN+totalInterestNGN;
    const pct=inv[p.key]&&(PLATFORMS.reduce((a,pp)=>a+(inv[pp.key]||0),0)>0)?((inv[p.key]/(PLATFORMS.reduce((a,pp)=>a+(inv[pp.key]||0),0)))*100).toFixed(1):'0.0';
    const badge=`<span style="font-size:0.56rem;padding:1px 4px;border-radius:3px;background:var(--bg3);color:var(--text3);margin-left:4px">${p.currency}</span>`;
    const fiCount=subs.filter(s=>s.assetClass==='fixed_income'&&s.rate).length;
    const intBadge=fiCount?`<span class="int-badge">Interest-bearing</span>`:'';
    const maturedBadge=anyMatured?`<span style="font-size:0.58rem;padding:1px 4px;border-radius:3px;background:rgba(255,80,80,0.15);color:var(--red);margin-left:4px">Matured</span>`:'';
    const subCount=subs.length>1?`<span style="font-size:0.6rem;color:var(--text3);margin-left:6px">${subs.length} investments</span>`:'';
    const dispMainVal=isUSD?'$'+((platformNGN/fxRate)).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):fN(Math.round(platformNGN));

    // ── Per-sub edit forms ──
    const editPanels=subs.map((sub,idx)=>{
      const dispBal=isUSD&&sub.principal?'$'+((Number(sub.principal)/fxRate)).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):sub.principal?fN(Number(sub.principal)):'—';
      const lbl=isUSD?`$ USD`:'₦ NGN';
      return`<div id="inv-sub-panel-${p.key}-${sub.id}${s}" style="border:1px solid var(--border);border-radius:var(--rsm);padding:10px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <input class="ifield" id="inv-sub-label-${p.key}-${sub.id}${s}" value="${esc(sub.label)}" placeholder="Label" style="font-size:0.74rem;padding:4px 8px;flex:1;margin-right:8px">
          ${subs.length>1?`<button class="txi-del" onclick="removeInvSub('${p.key}','${sub.id}','${s}')" title="Remove this investment">×</button>`:''}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding:6px 8px;background:var(--bg3);border-radius:var(--rsm)">
          <div>
            <div style="font-size:0.58rem;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em">Balance (${lbl})</div>
            <div style="font-size:0.86rem;font-family:var(--mono);color:var(--accent);font-weight:600">${dispBal}</div>
          </div>
          <div style="display:flex;gap:5px">
            <button onclick="openInvAdjModal('${p.key}','${sub.id}','inflow')" style="font-size:0.6rem;padding:3px 7px;border-radius:3px;background:rgba(100,200,100,0.15);border:1px solid rgba(100,200,100,0.3);color:#7dea7d;cursor:pointer">+ Inflow</button>
            <button onclick="openInvAdjModal('${p.key}','${sub.id}','gain_loss')" style="font-size:0.6rem;padding:3px 7px;border-radius:3px;background:rgba(200,245,66,0.08);border:1px solid rgba(200,245,66,0.25);color:var(--accent);cursor:pointer">± Gain/Loss</button>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <select class="sfield" id="inv-sub-ac-${p.key}-${sub.id}${s}" style="flex:1;font-size:0.72rem;padding:5px 8px" onchange="toggleSubFIFields('${p.key}','${sub.id}','${s}')">
            <option value="equity"${sub.assetClass!=='fixed_income'?' selected':''}>Equity</option>
            <option value="fixed_income"${sub.assetClass==='fixed_income'?' selected':''}>Fixed Income</option>
          </select>
        </div>
        <div id="inv-sub-fi-${p.key}-${sub.id}${s}" style="${sub.assetClass==='fixed_income'?'':'display:none'}">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px">
            <div class="ig" style="margin-bottom:0"><label class="ilabel">Annual Rate (%)</label><input class="ifield" type="text" id="inv-sub-rate-${p.key}-${sub.id}${s}" placeholder="e.g. 18" value="${sub.rate||''}" style="font-size:0.8rem;padding:6px 10px"></div>
            <div class="ig" style="margin-bottom:0"><label class="ilabel">Accrual</label><select class="sfield" id="inv-sub-ct-${p.key}-${sub.id}${s}" style="font-size:0.75rem;padding:6px 8px" onchange="toggleSubFIFields('${p.key}','${sub.id}','${s}')">
              <option value="daily_accrual"${(sub.compoundType||'daily_accrual')==='daily_accrual'?' selected':''}>Daily Accrual</option>
              <option value="daily_compound"${sub.compoundType==='daily_compound'?' selected':''}>Daily Compound</option>
            </select></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div class="ig" style="margin-bottom:0"><label class="ilabel">Start Date</label><input class="ifield" type="date" id="inv-sub-start-${p.key}-${sub.id}${s}" value="${sub.startDate||''}" style="font-size:0.78rem;padding:5px 8px"></div>
            <div id="inv-sub-mat-row-${p.key}-${sub.id}${s}" class="ig" style="margin-bottom:0;${sub.assetClass==='fixed_income'&&(sub.compoundType||'daily_accrual')==='daily_accrual'?'':'display:none'}"><label class="ilabel">Maturity</label><input class="ifield" type="date" id="inv-sub-mat-${p.key}-${sub.id}${s}" value="${sub.maturityDate||''}" style="font-size:0.78rem;padding:5px 8px"></div>
          </div>
        </div>
      </div>`;
    }).join('');

    const canAddSub=subs.length<5;
    const addSubBtn=canAddSub?`<button class="btn btn-g btn-full" style="font-size:0.72rem;padding:5px" onclick="addInvSub('${p.key}','${s}')">+ Add Investment</button>`:`<div style="font-size:0.62rem;color:var(--text3);text-align:center;padding:4px">Maximum 5 investments per platform</div>`;

    const editSection=`<div id="inv-edit-panel-${p.key}${s}" onclick="event.stopPropagation()" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
      <div style="font-size:0.68rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px">Edit ${esc(p.label)}</div>
      <div style="margin-bottom:8px"><label class="ilabel" style="font-size:0.65rem">Logo filename</label><input class="ifield" id="plat-logo-${p.key}${s}" type="text" placeholder="e.g. piggyvest.png" value="${esc(p.logo||'')}" style="font-size:0.72rem;padding:4px 8px;margin-top:3px" oninput="updatePlatLogo('${p.key}',this.value)"><div class="csub" style="font-size:0.58rem;margin-top:2px">File in your Logos/ folder on GitHub</div></div>
      <div id="inv-sub-list-${p.key}${s}">${editPanels}</div>
      ${addSubBtn}
      <button class="txi-del" onclick="removePlatform('${p.key}')" style="margin-top:10px;width:100%;text-align:center;padding:4px;font-size:0.65rem;color:var(--text3)">Remove platform</button>
    </div>`;

    return`<div class="card" style="margin-bottom:8px;cursor:pointer" onclick="toggleInvEdit('${p.key}','${s}')">
      <div style="display:flex;align-items:center;gap:10px">
        <div id="inv-logo-th-${p.key}${s}" style="flex-shrink:0">${platformLogoEl(p.key,p.color,26)}</div>
        <div style="flex:1;min-width:0">
          <div class="pname">${p.label}${badge}${intBadge}${maturedBadge}${subCount}</div>
          <div class="ppct">${pct}%</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div class="pval" style="color:${platformNGN?p.color:'var(--text3)'}">${platformNGN?maskIf('inv-page',dispMainVal):'—'}</div>
          ${totalInterestNGN>0&&!_isHidden('inv-page')?`<div style="font-size:0.58rem;color:var(--gold);font-family:var(--mono)">+${isUSD?'$'+((totalInterestNGN/fxRate)).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):fN(Math.round(totalInterestNGN))} interest</div>`:''}
          <div onclick="event.stopPropagation();drillDownInvPlatform('${p.key}')" style="font-size:0.6rem;color:var(--text3);margin-top:2px;cursor:pointer">Activity ›</div>
        </div>
      </div>
      ${subs.length>0?`<div id="inv-sub-display-${p.key}${s}" style="display:none;margin-top:4px">${subRows.map(r=>r.html).join('')}</div>`:''}
      ${editSection}
    </div>`;
  }

  if(elPlatforms){
    let html='';
    if(eqPlats.length){
      html+=`<div style="font-size:0.6rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--blue);margin:10px 0 5px">Equities / Growth</div>`;
      html+=eqPlats.map(_renderPlatRow).join('');
    }
    if(fiPlats.length){
      html+=`<div style="font-size:0.6rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--gold);margin:12px 0 5px">Fixed Income</div>`;
      html+=fiPlats.map(_renderPlatRow).join('');
    }
    elPlatforms.innerHTML=html;
  }

  const active=PLATFORMS.filter(p=>inv[p.key]);
  if(elAlloc){
    if(active.length&&total){
      elAlloc.style.display='block';
      if(elAbar) elAbar.innerHTML=active.map(p=>`<div style="flex:${inv[p.key]};background:${p.color};opacity:0.82"></div>`).join('');
      if(elLegend) elLegend.innerHTML=active.map(p=>`<div style="display:flex;align-items:center;gap:4px;font-size:0.62rem;color:var(--text2)"><div style="width:7px;height:7px;border-radius:2px;background:${p.color}"></div>${p.label}</div>`).join('');
    } else elAlloc.style.display='none';
  }
  if(elEditLabel) elEditLabel.textContent=`${MONTHS[m-1]} ${y}`;
  if(elEditFields){
    // Add Platform section only — per-platform edit is now inline in each row
    elEditFields.innerHTML=`
      <div class="card" style="margin-top:4px">
        <div style="font-size:0.7rem;font-weight:700;color:var(--text2);margin-bottom:10px;text-transform:uppercase;letter-spacing:0.06em">Add Investment Platform</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
          <div class="ig" style="margin-bottom:0;grid-column:1/-1"><label class="ilabel">Platform Name</label><input class="ifield" id="new-plat-name${s}" placeholder="e.g. Stanbic" style="font-size:0.8rem;padding:6px 10px"></div>
          <div class="ig" style="margin-bottom:0"><label class="ilabel">Currency</label><select class="sfield" id="new-plat-cur${s}" style="font-size:0.78rem;padding:6px 10px">
            <option value="NGN">NGN ₦</option>
            <option value="USD">USD $</option>
            <option value="GBP">GBP £</option>
          </select></div>
          <div class="ig" style="margin-bottom:0"><label class="ilabel">Colour</label><input type="color" id="new-plat-col${s}" value="#c8f542" style="width:100%;height:36px;border:none;border-radius:var(--rsm);background:none;cursor:pointer;padding:0"></div>
          <div class="ig" style="margin-bottom:0;grid-column:1/-1"><label class="ilabel">Logo filename</label><input class="ifield" id="new-plat-logo${s}" placeholder="e.g. piggyvest.png" style="font-size:0.8rem;padding:6px 10px"><div class="csub" style="font-size:0.6rem;margin-top:3px">File in your Logos/ folder on GitHub</div></div>
        </div>
        <button class="btn btn-inc btn-full" onclick="addPlatform(document.getElementById('new-plat-name${s}').value,document.getElementById('new-plat-cur${s}').value,document.getElementById('new-plat-col${s}').value,document.getElementById('new-plat-logo${s}').value)">+ Add Platform</button>
      </div>`;
  }
}
function toggleInvEdit(pKey, suffix){
  const s=suffix||'';
  const panel=document.getElementById('inv-edit-panel-'+pKey+s);
  const subDisplay=document.getElementById('inv-sub-display-'+pKey+s);
  if(!panel) return;
  const isOpen=panel.style.display!=='none';
  panel.style.display=isOpen?'none':'block';
  if(subDisplay) subDisplay.style.display=isOpen?'none':'block';
  const saveBtn=document.getElementById('inv-save-btn'+s);
  if(saveBtn){
    const anyOpen=[...document.querySelectorAll('[id^="inv-edit-panel-"]')].filter(el=>el.id.endsWith(s));
    saveBtn.style.display=anyOpen.some(el=>el.style.display!=='none')?'block':'none';
  }
  if(panel.style.display!=='none') setTimeout(()=>initNumInputs(panel),0);
}

function toggleSubFIFields(pKey, subId, suffix){
  const s=suffix||'';
  const acEl=document.getElementById(`inv-sub-ac-${pKey}-${subId}${s}`);
  const ctEl=document.getElementById(`inv-sub-ct-${pKey}-${subId}${s}`);
  const fiDiv=document.getElementById(`inv-sub-fi-${pKey}-${subId}${s}`);
  const matRow=document.getElementById(`inv-sub-mat-row-${pKey}-${subId}${s}`);
  if(!acEl||!fiDiv) return;
  const isFI=acEl.value==='fixed_income';
  fiDiv.style.display=isFI?'block':'none';
  if(matRow) matRow.style.display=(isFI&&ctEl&&ctEl.value==='daily_accrual')?'block':'none';
}

function addInvSub(pKey, suffix){
  const s=suffix||'';
  const subs=getSubsForPlatform(pKey);
  if(subs.length>=5){toast('Maximum 5 investments per platform');return;}
  const newId=pKey+'_sub_'+(Date.now());
  subs.push({id:newId,label:'Investment '+(subs.length+1),principal:'',
    assetClass:'equity',rate:'',compoundType:'daily_accrual',startDate:'',maturityDate:''});
  saveSubsForPlatform(pKey,subs);
  renderInvestments();
  // Re-open edit panel after re-render
  setTimeout(()=>{
    const panel=document.getElementById('inv-edit-panel-'+pKey+s);
    const subDisplay=document.getElementById('inv-sub-display-'+pKey+s);
    if(panel){panel.style.display='block';if(subDisplay)subDisplay.style.display='block';initNumInputs(panel);}
  },50);
}

function removeInvSub(pKey, subId, suffix){
  const subs=getSubsForPlatform(pKey);
  if(subs.length<=1){toast('A platform must have at least one investment');return;}
  if(!confirm('Remove this investment?')) return;
  const updated=subs.filter(s=>s.id!==subId);
  saveSubsForPlatform(pKey,updated);
  renderInvestments();
  setTimeout(()=>{
    const s=suffix||'';
    const panel=document.getElementById('inv-edit-panel-'+pKey+s);
    const subDisplay=document.getElementById('inv-sub-display-'+pKey+s);
    if(panel){panel.style.display='block';if(subDisplay)subDisplay.style.display='block';}
  },50);
}

// ── Investment Adjustments (Inflow / Gain / Loss) ─────────────────────────
let _adjPKey=null, _adjSubId=null, _adjType=null;

function openInvAdjModal(pKey, subId, type){
  _adjPKey=pKey; _adjSubId=subId; _adjType=type;
  const subs=getSubsForPlatform(pKey);
  const sub=subs.find(s=>s.id===subId);
  if(!sub) return;
  const p=PLATFORMS.find(pl=>pl.key===pKey);
  const m=S.cashMonth,y=S.cashYear;
  const isUSD=p&&p.currency==='USD';
  const fxRates=getFxRates(m,y);
  const fxRate=isUSD?(fxRates.USD||1600):1;
  const curBal=isUSD?'$'+((Number(sub.principal)||0)/fxRate).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):fN(Number(sub.principal)||0);
  const titles={inflow:'Record Inflow',gain_loss:'Record Gain / Loss'};
  const descs={
    inflow:`Adding new money to <strong>${esc(sub.label)}</strong>. Current balance: ${curBal}.`,
    gain_loss:`Enter a positive number for a gain, negative for a loss.<br>Current balance: ${curBal}.`,
  };
  const amtLabels={inflow:`Amount (${isUSD?'$':'₦'})`,gain_loss:`Amount (${isUSD?'$':'₦'}) — negative = loss`};
  document.getElementById('inv-adj-title').textContent=titles[type];
  document.getElementById('inv-adj-desc').innerHTML=descs[type];
  document.getElementById('inv-adj-amt-label').textContent=amtLabels[type];
  document.getElementById('inv-adj-amount').value='';
  document.getElementById('inv-adj-date').value=todayStr();
  document.getElementById('inv-adj-notes').value='';
  openMod('inv-adj-modal');
  setTimeout(()=>initNumInputs(document.getElementById('inv-adj-modal')),50);
}

async function applyInvAdjust(){
  if(!_adjPKey||!_adjSubId||!_adjType) return;
  const rawAmt=document.getElementById('inv-adj-amount').value.replace(/,/g,'');
  const amt=parseFloat(rawAmt);
  if(isNaN(amt)||amt===0){toast('Enter a valid amount');return;}
  const date=document.getElementById('inv-adj-date').value||todayStr();
  const notes=document.getElementById('inv-adj-notes').value.trim();
  const p=PLATFORMS.find(pl=>pl.key===_adjPKey);
  const isUSD=p&&p.currency==='USD';
  const m=S.cashMonth,y=S.cashYear;
  const fxRate=isUSD?(getFxRates(m,y).USD||1600):1;
  const amtNGN=Math.round(isUSD?amt*fxRate:amt); // may be negative for gain_loss

  const subs=getSubsForPlatform(_adjPKey);
  const subIdx=subs.findIndex(s=>s.id===_adjSubId);
  if(subIdx<0){toast('Investment not found');return;}
  const sub=subs[subIdx];
  const prevPrincipal=Number(sub.principal)||0;
  let newPrincipal;
  if(_adjType==='gain_loss'){
    newPrincipal=Math.max(0,prevPrincipal+amtNGN);
  } else {
    // inflow — always positive
    newPrincipal=prevPrincipal+Math.abs(amtNGN);
  }
  subs[subIdx]={...sub,principal:newPrincipal};
  saveSubsForPlatform(_adjPKey,subs);

  const newPlatTotal=subs.reduce((s,sb)=>s+(Number(sb.principal)||0),0);
  const invData={...(cGet(CK.inv(m,y))||S.investments),month:m,year:y};
  invData[_adjPKey]=newPlatTotal;
  S.investments=invData;
  cSet(CK.inv(m,y),invData);
  if(db) db.collection('investments').doc(sid(m,y)).set(invData,{merge:true}).catch(()=>{});

  const sign=amtNGN>=0?'+':'';
  const dispAmt=isUSD?`${sign}$${Math.abs(amt).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`:`${sign}₦${fNum(Math.abs(amtNGN))}`;
  const label=_adjType==='inflow'?'Inflow':amtNGN>=0?'Gain':'Loss';
  closeMod('inv-adj-modal');
  toast(`${label}: ${dispAmt} applied`);
  haptic([8,40,8]);
  renderInvestments();renderDashboard();
}

// ── Liquidation ───────────────────────────────────────────────────────────
let _liqPKey=null, _liqSubId=null, _liqDest='cash';

function setLiqDest(dest){
  _liqDest=dest;
  const cashBtn=document.getElementById('liq-dest-cash-btn');
  const invBtn=document.getElementById('liq-dest-inv-btn');
  if(cashBtn) cashBtn.className=`btn btn-sm ${dest==='cash'?'btn-p':'btn-g'}`;
  if(invBtn) invBtn.className=`btn btn-sm ${dest==='investment'?'btn-p':'btn-g'}`;
  const bankSel=document.getElementById('liq-bank');
  if(!bankSel) return;
  if(dest==='cash'){
    bankSel.innerHTML=cashOptsWithBal();
  } else {
    // All platforms except the one being liquidated; filter to allow sub selection
    const opts=PLATFORMS.filter(pl=>pl.key!==_liqPKey).map(pl=>{
      const subs=getSubsForPlatform(pl.key);
      if(subs.length<=1) return`<option value="${pl.key}|0">${pl.label} — ${subs[0]?subs[0].label:'Investment 1'}</option>`;
      return subs.map((sb,i)=>`<option value="${pl.key}|${i}">${pl.label} — ${sb.label}</option>`).join('');
    }).join('');
    bankSel.innerHTML=opts||'<option value="">No other platforms</option>';
  }
}

function openLiqModal(pKey, subId){
  _liqPKey=pKey; _liqSubId=subId; _liqDest='cash';
  const subs=getSubsForPlatform(pKey);
  const sub=subs.find(s=>s.id===subId);
  if(!sub) return;
  const p=PLATFORMS.find(pl=>pl.key===pKey);
  const m=S.cashMonth,y=S.cashYear;
  const fxRates=getFxRates(m,y);
  const isUSD=p&&p.currency==='USD';
  const isGBP=p&&p.currency==='GBP';
  const fxRate=isUSD?(fxRates.USD||1600):isGBP?(fxRates.GBP||2050):1;
  const pNGN=Number(sub.principal)||0;
  let projBalNGN=pNGN;
  if(sub.assetClass==='fixed_income'&&sub.rate){
    const r=calcInterestAccrual(pNGN,Number(sub.rate),sub.compoundType||'daily_accrual',sub.startDate||null,sub.maturityDate||null,[]);
    projBalNGN=r.projectedBalance;
  }
  const dispCcy=isUSD?'$':isGBP?'£':'₦';
  const dispPrin=isUSD?'$'+(pNGN/fxRate).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'₦'+fNum(pNGN);
  const dispTotal=isUSD?'$'+(projBalNGN/fxRate).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'₦'+fNum(Math.round(projBalNGN));
  document.getElementById('liq-title').textContent=`Liquidate — ${sub.label}`;
  document.getElementById('liq-sub-desc').innerHTML=`<strong>${p?p.label:'Platform'}</strong> · ${dispPrin} principal${projBalNGN>pNGN?' + interest = '+dispTotal:''}`;
  const amtEl=document.getElementById('liq-amount');
  amtEl.value=Math.round(projBalNGN).toLocaleString();
  document.getElementById('liq-amount-hint').textContent=isUSD?`Converted at ₦${fxRate}/$. Edit if needed.`:'Edit to liquidate a partial amount.';
  document.getElementById('liq-date').value=todayStr();
  // Reset to cash dest and populate
  document.getElementById('liq-dest-cash-btn').className='btn btn-sm btn-p';
  document.getElementById('liq-dest-inv-btn').className='btn btn-sm btn-g';
  setLiqDest('cash');
  openMod('liq-modal');
  setTimeout(()=>initNumInputs(document.getElementById('liq-modal')),50);
}

// Records the interest portion of a fixed-income liquidation as an Income
// entry for that period (Income History / Insights), without touching cash —
// the cash side is already handled by the liquidation's own _adjustCash call.
async function _recordInvestmentInterestIncome(label,bank,amtNGN,date,m,y){
  const data={amount:amtNGN,amtNGN,currency:'NGN',category:'Interest Income',bank,notes:`${label} — fixed income payout`,date,month:m,year:y};
  try{
    const ref=await db.collection('income').add({...data,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    S.income.unshift({...data,id:ref.id});
  }catch(e){
    const offId='offline_inc_'+Date.now();
    oqAdd('income',offId,data,true);
    S.income.unshift({...data,id:offId});
  }
  cSet(CK.inc(m,y),S.income);
  const hist=cGet('sw3_history')||[];
  const hIdx=hist.findIndex(h=>h.year===y&&h.month===m);
  const totalInc=S.income.reduce((s,i)=>s+(i.amtNGN||i.amount||0),0);
  if(hIdx>=0){hist[hIdx].income=totalInc;}
  else{const MS2=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];hist.push({year:y,month:m,label:MS2[m-1]+" '"+String(y).slice(2),income:totalInc,expenses:S.txns.reduce((s,t)=>s+(t.amount||0),0)});hist.sort((a,b)=>a.year!==b.year?a.year-b.year:a.month-b.month);}
  cSet('sw3_history',hist);
}
async function confirmLiquidation(){
  if(!_liqPKey||!_liqSubId){closeMod('liq-modal');return;}
  const rawAmt=document.getElementById('liq-amount').value.replace(/,/g,'');
  const amtNGN=Math.round(parseFloat(rawAmt));
  if(!amtNGN||amtNGN<=0){toast('Enter a valid amount');return;}
  const destVal=document.getElementById('liq-bank').value;
  const date=document.getElementById('liq-date').value||todayStr();
  const dp=date.split('-');const liqM=parseInt(dp[1]),liqY=parseInt(dp[0]);
  if(!destVal){toast('Select a destination');return;}

  const subs=getSubsForPlatform(_liqPKey);
  const subIdx=subs.findIndex(s=>s.id===_liqSubId);
  if(subIdx<0){toast('Investment not found');return;}
  const sub=subs[subIdx];
  const pNGN=Number(sub.principal)||0;
  // Payout above principal on a fixed-income sub is realised interest — report
  // it as income for the period. Principal itself is never counted as income.
  const interestNGN=(sub.assetClass==='fixed_income'&&sub.rate)?Math.max(0,amtNGN-pNGN):0;

  // Zero out the sub principal
  subs[subIdx]={...sub,principal:0};
  saveSubsForPlatform(_liqPKey,subs);

  // Recompute and persist platform total
  const m=S.cashMonth,y=S.cashYear;
  const newPlatTotal=subs.reduce((sum,s)=>sum+(Number(s.principal)||0),0);
  const invData={...(cGet(CK.inv(m,y))||S.investments),month:m,year:y};
  invData[_liqPKey]=newPlatTotal;
  S.investments=invData;
  cSet(CK.inv(m,y),invData);
  if(db) db.collection('investments').doc(sid(m,y)).set(invData,{merge:true}).catch(()=>{});

  if(_liqDest==='investment'){
    // Liquidate into another investment sub
    const [destPKey,destSubIdxStr]=destVal.split('|');
    const destSubIdx=parseInt(destSubIdxStr)||0;
    const destSubs=migrateToSubs(destPKey);
    if(destSubs[destSubIdx]){
      destSubs[destSubIdx].principal=(Number(destSubs[destSubIdx].principal)||0)+amtNGN;
    } else {
      destSubs.push({id:destPKey+'_sub_'+(Date.now()),label:'Investment '+(destSubs.length+1),
        principal:amtNGN,assetClass:'equity',rate:'',compoundType:'daily_accrual',startDate:date,maturityDate:''});
    }
    saveSubsForPlatform(destPKey,destSubs);
    const destTotal=destSubs.reduce((s,sb)=>s+(Number(sb.principal)||0),0);
    invData[destPKey]=destTotal;
    S.investments=invData;
    cSet(CK.inv(m,y),invData);
    if(db) db.collection('investments').doc(sid(m,y)).set(invData,{merge:true}).catch(()=>{});
    const destPlat=PLATFORMS.find(pl=>pl.key===destPKey);
    toast(`₦${fNum(amtNGN)} → ${destPlat?destPlat.label:destPKey}`);
  } else {
    // Liquidate to cash account
    _adjustCash(destVal,amtNGN,liqM,liqY,'investment-liquidation');
    toast(`₦${fNum(amtNGN)} liquidated → ${destVal}`);
    if(interestNGN>0) await _recordInvestmentInterestIncome(sub.label,destVal,interestNGN,date,liqM,liqY);
  }

  closeMod('liq-modal');
  haptic([8,40,8]);
  renderInvestments();renderDashboard();renderIncome();
}

async function saveInvFromEdit(){
  if(S.saving) return;S.saving=true;setSyncStatus('syncing');
  try{
    PLATFORMS=getPlatforms();
    const data={month:S.cashMonth,year:S.cashYear};
    const fxRates=getFxRates(S.cashMonth,S.cashYear);
    // Process each platform
    PLATFORMS.forEach(p=>{
      // Check if any edit panel is open for this platform (either suffix)
      const panel=document.getElementById('inv-edit-panel-'+p.key+'-2')||document.getElementById('inv-edit-panel-'+p.key);
      if(!panel||panel.style.display==='none'){
        // Not opened — carry forward existing stored value
        const existing=cGet(CK.inv(S.cashMonth,S.cashYear));
        if(existing&&existing[p.key]!=null) data[p.key]=existing[p.key];
        return;
      }
      // Collect subs from their DOM inputs
      const subs=getSubsForPlatform(p.key);
      const s=panel.id.includes('-2')?'-2':'';
      const isUSD=p.currency==='USD';
      const isGBP=p.currency==='GBP';
      const fxRate=isUSD?(fxRates.USD||1600):isGBP?(fxRates.GBP||2050):1;
      let platformTotalNGN=0;
      const updatedSubs=subs.map(sub=>{
        const labelEl=document.getElementById(`inv-sub-label-${p.key}-${sub.id}${s}`);
        const prinEl=document.getElementById(`inv-sub-prin-${p.key}-${sub.id}${s}`);
        const acEl=document.getElementById(`inv-sub-ac-${p.key}-${sub.id}${s}`);
        const rateEl=document.getElementById(`inv-sub-rate-${p.key}-${sub.id}${s}`);
        const ctEl=document.getElementById(`inv-sub-ct-${p.key}-${sub.id}${s}`);
        const startEl=document.getElementById(`inv-sub-start-${p.key}-${sub.id}${s}`);
        const matEl=document.getElementById(`inv-sub-mat-${p.key}-${sub.id}${s}`);
        const raw=prinEl?parseFloat(prinEl.value.replace(/,/g,'')):NaN;
        const principalNGN=isNaN(raw)?Number(sub.principal)||0:Math.round(isUSD?raw*fxRate:isGBP?raw*fxRate:raw);
        platformTotalNGN+=principalNGN;
        return{
          ...sub,
          label:labelEl?labelEl.value.trim()||sub.label:sub.label,
          principal:principalNGN,
          assetClass:acEl?acEl.value:sub.assetClass,
          rate:rateEl?rateEl.value:sub.rate,
          compoundType:ctEl?ctEl.value:sub.compoundType,
          startDate:startEl?startEl.value:sub.startDate,
          maturityDate:matEl?matEl.value:sub.maturityDate,
        };
      });
      saveSubsForPlatform(p.key,updatedSubs);
      data[p.key]=platformTotalNGN;
      // Update legacy meta from first sub (for any code still reading getInvPlatformMeta)
      const first=updatedSubs[0];
      if(first){
        const meta={assetClass:first.assetClass};
        if(first.assetClass==='fixed_income'&&first.rate){
          meta.interestRate=Number(first.rate);
          meta.compoundType=first.compoundType||'daily_accrual';
          meta.startDate=first.startDate||todayStr();
          if(first.maturityDate) meta.maturityDate=first.maturityDate;
        }
        const allMeta=getInvMeta();allMeta[p.key]=meta;saveInvMeta(allMeta);
      }
    });
    S.investments=data;cSet(CK.inv(S.cashMonth,S.cashYear),data);
    renderInvestments();renderDashboard();
    try{await db.collection('investments').doc(sid(S.cashMonth,S.cashYear)).set(data,{merge:true});toast('Balances saved');haptic([8,40,8]);setSyncStatus('synced');}
    catch(e){oqAdd('investments',sid(S.cashMonth,S.cashYear),data,true);toast('Saved offline — will sync when connected');}
  }catch(e){console.error('saveInvFromEdit error',e);toast('Error saving — please try again');setSyncStatus('error');}
  finally{S.saving=false;}
}
function renderInvestments(){
  _renderInvInto('');    // pg-investments page (legacy, may not be visible)
  _renderInvInto('-2');  // acct-invest tab inside pg-accounts (the live one)
}
function invTab(tab,btn){
  const tabs=['current','trend'];
  const inAccounts=btn.closest('#acct-invest')!=null;
  const s=inAccounts?'-2':'';
  tabs.forEach(t=>{const el=document.getElementById('inv-'+t+s);if(el)el.style.display=t===tab?'block':'none';});
  btn.closest('.tabs').querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));btn.classList.add('active');
  if(tab==='trend'){renderInvTrend(s);setTimeout(()=>renderInvAllocChart(s),200);}
}
async function renderInvTrend(suffix){
  const s=suffix||'';
  const chartKey=s?'invChart2':'invChart';  // separate instances per suffix
  try{
    // No orderBy — avoids composite index requirement; sort client-side instead
    let snap;
    try{snap=await db.collection('investments').get({source:'server'});}
    catch(e){snap=await db.collection('investments').get();}
    if(!snap||snap.empty){console.warn('renderInvTrend: no investment docs');return;}
    const data=snap.docs
      .map(d=>{const doc=d.data();return{year:doc.year,month:doc.month,label:`${MS[(doc.month||1)-1]} '${String(doc.year||2024).slice(2)}`,total:PLATFORMS.reduce((sum,p)=>sum+(doc[p.key]||0),0)};})
      .filter(d=>d.total>0)
      .sort((a,b)=>a.year!==b.year?a.year-b.year:a.month-b.month);
    if(!data.length){console.warn('renderInvTrend: all totals zero');return;}
    if(S[chartKey]){try{S[chartKey].destroy();}catch(e){} S[chartKey]=null;}
    // Find canvas — look up by ID, ensure it is visible before drawing
    let chartEl=document.getElementById('inv-chart'+s);
    if(!chartEl){console.warn('renderInvTrend: canvas not found for suffix',s);return;}
    // Make sure the parent trend div is visible so Chart.js can get dimensions
    const trendPane=document.getElementById('inv-trend'+s);
    if(trendPane) trendPane.style.display='block';
    const newCanvas=document.createElement('canvas');
    newCanvas.id=chartEl.id;newCanvas.style.cssText='max-height:200px';
    chartEl.parentNode.replaceChild(newCanvas,chartEl);
    chartEl=newCanvas;
    const ctx=chartEl.getContext('2d');
    const datalabelsPlugin={id:'invDatalabels',afterDatasetsDraw(chart){
      const {ctx:c,data,scales:{x,y}}=chart;
      c.save();
      data.datasets[0].data.forEach((val,i)=>{
        if(!val) return;
        const xp=x.getPixelForValue(i);
        const yp=y.getPixelForValue(val);
        const lbl=(val/1e6).toFixed(2)+'M';
        c.font='bold 8px DM Mono, monospace';
        c.fillStyle='#c8f542';
        c.textAlign='center';
        c.fillText(lbl,xp,yp-7);
      });
      c.restore();
    }};
    S[chartKey]=new Chart(ctx,{
      type:'line',
      data:{labels:data.map(d=>d.label),datasets:[{data:data.map(d=>d.total),borderColor:'#c8f542',backgroundColor:'rgba(200,245,66,0.06)',borderWidth:2,pointBackgroundColor:'#c8f542',pointRadius:4,tension:0.3,fill:true}]},
      options:{responsive:true,maintainAspectRatio:true,plugins:{legend:{display:false},tooltip:{backgroundColor:'#12122a',borderColor:'#1f1f3a',borderWidth:1,callbacks:{label:c=>fmtChartNGN(c.parsed.y)}}},scales:{x:{grid:{display:false},ticks:{color:'#3a3a6a',font:{family:'DM Mono',size:9}},border:{display:false}},y:{display:false}}},
      plugins:[datalabelsPlugin]
    });
  }catch(e){console.error('invTrend error',e);}
}

// ══════════════════════════════════════════════════════════════════════════
// CASH PAGE
// ══════════════════════════════════════════════════════════════════════════
function renderCashPage(){
  const m=S.cashMonth,y=S.cashYear,cur=S.dashCurrency;
  const ACCTS=getCashAccounts();
  const months=[];for(let i=1;i<=12;i++) months.push(i);
  document.getElementById('cash-months').innerHTML=months.map(mo=>`<div class="mpill ${mo===m?'active':''}" onclick="changeCashMonth(${mo})">${MS[mo-1]}</div>`).join('');
  setTimeout(()=>{const el=document.querySelector('#cash-months .mpill.active');if(el)el.scrollIntoView({inline:'center',block:'nearest'});},0);
  document.getElementById('cash-month-label').textContent=`${MONTHS[m-1]} ${y}`;
  const cash=S.cash;
  const fxR=getFxRates(m,y);
  const total=ACCTS.reduce((s,b)=>{const v=cash[b]||0;return s+(isUSDCashAccount(b)?v*(fxR.USD||1650):v);},0);
  const total_ngn=total; // NGN-equivalent total for % calculations
  const intMeta=getCashInterestMeta();
  document.getElementById('cash-summary').innerHTML=`<div class="clabel">Total Cash — ${MONTHS[m-1]} ${y}${eyeBtn('cash-page','renderCashPage')}</div><div class="cval">${total?maskIf('cash-page',fmtCur(Math.round(total),cur,m,y)):'—'}</div><div class="csub">${ACCTS.join(' · ')}</div>`;
  document.getElementById('cash-breakdown').innerHTML=ACCTS.map((b,i)=>{
    const val=cash[b]||0,pct=total_ngn?Math.round((isUSDCashAccount(b)?(val*(getFxRates(m,y).USD||1650)):val)/total_ngn*100):0;
    const ci=intMeta[b];
    const intInfo=ci&&ci.interestRate?`<span class="int-badge">${ci.interestRate}% p.a.</span>`:'';
    const projInt=ci&&ci.interestRate&&val?calcInterestAccrual(val,ci.interestRate,'daily_accrual',ci.startDate||null,null).interest:0;
    const intProjection=projInt>0.5?`<div style="font-size:0.6rem;color:var(--gold);margin-top:1px">~${isUSDCashAccount(b)?'$'+projInt.toFixed(2):fN(Math.round(projInt))} accrued${ci.startDate?' since '+ci.startDate:''}</div>`:'';
    const _fxR2=getFxRates(m,y);
    let dispVal;
    if(isUSDCashAccount(b)){
      const ngnEquiv=val*(_fxR2.USD||1650);
      dispVal=(cur==='NATIVE'||cur==='NGN')?'$'+val.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' ('+fN(ngnEquiv)+')':fmtCur(ngnEquiv,cur,m,y);
    } else {
      dispVal=fmtCur(val,cur,m,y);
    }
    return`<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;cursor:pointer;${i<ACCTS.length-1?'border-bottom:1px solid var(--border)':''}" onclick="drillDownAccount('${jsq(b)}')"><div style="display:flex;align-items:center;gap:8px">${bankLogoEl(b,26)}<div><div style="font-size:0.82rem;font-weight:600">${b}${intInfo} <span style="font-size:0.6rem;color:var(--text3)">›</span></div><div style="font-size:0.65rem;color:var(--text2);font-family:var(--mono);margin-top:1px">${pct}%</div>${_isHidden('cash-page')?'':intProjection}</div></div><div style="font-family:var(--mono);font-size:0.9rem;color:${val?'var(--blue)':'var(--text3)'}">${val?maskIf('cash-page',dispVal):'—'}</div></div>`;
  }).join('');
  document.getElementById('cash-inputs').innerHTML=`<div class="gform">${ACCTS.map(b=>`<div class="ig"><label class="ilabel">${b} (${isUSDCashAccount(b)?'$':'₦'})</label><input class="ifield" type="text" id="cash-${b.toLowerCase().replace(/\s+/g,'-')}" placeholder="0" value="${cash[b]||''}"></div>`).join('')}</div>`;
  // Cash interest settings section
  let intHtml=`<div class="card" style="margin-bottom:10px"><div class="clabel" style="margin-bottom:10px">Interest Rates</div>`;
  intHtml+=ACCTS.map(b=>{
    const ci=intMeta[b]||{};
    const startDate=ci.startDate||'';
    return`<div style="padding:8px 0;border-bottom:1px solid var(--border)">
      <div style="font-size:0.78rem;font-weight:600;margin-bottom:5px">${b}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="ig" style="margin-bottom:0"><label class="ilabel">Annual Rate (%)</label><input class="ifield" type="text" id="cash-int-${b.toLowerCase().replace(/\s+/g,'-')}" placeholder="0 = none" value="${ci.interestRate||''}" style="font-size:0.78rem;padding:5px 9px"></div>
        <div class="ig" style="margin-bottom:0"><label class="ilabel">Start Date</label><input class="ifield" type="date" id="cash-sd-${b.toLowerCase().replace(/\s+/g,'-')}" value="${startDate}" style="font-size:0.75rem;padding:5px 9px" title="Interest accrues from this date"></div>
      </div>
    </div>`;
  }).join('');
  intHtml+=`<div style="font-size:0.6rem;color:var(--text3);margin-top:8px;line-height:1.5">Daily accrual: simple interest on balance from the start date. Interest is shown as a projection and does not auto-add to the balance.</div>`;
  intHtml+=`<button class="btn btn-g btn-full" style="margin-top:10px" onclick="saveCashInterest()">Save Interest Rates</button></div>`;
  // Inject interest section after cash-inputs if element exists
  let intEl=document.getElementById('cash-interest-section');
  if(!intEl){
    const inputsEl=document.getElementById('cash-inputs');
    if(inputsEl){
      intEl=document.createElement('div');intEl.id='cash-interest-section';
      inputsEl.parentNode.insertBefore(intEl,inputsEl.nextSibling);
    }
  }
  if(intEl) intEl.innerHTML=intHtml;
  const customAccts=ACCTS.filter(a=>!DEFAULT_CASH_ACCOUNTS.includes(a));
  const caEl=document.getElementById('custom-accts-list');
  // Show logo editing for ALL accounts (default + custom)
  if(caEl){const allAccts=getCashAccounts();const logos=getCashLogos();caEl.innerHTML=allAccts.map(a=>{const isDefault=DEFAULT_CASH_ACCOUNTS.includes(a);const logoFile=logos[a]||'';const _safeId=a.replace(/\s/g,'-');return`<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)"><div id="cash-logo-th-${_safeId}" style="flex-shrink:0">${bankLogoEl(a,20)}</div><div style="flex:1;min-width:0"><div style="font-size:0.74rem;font-weight:600">${a}</div><input class="ifield" type="text" placeholder="logo filename, e.g. gtb.png" value="${esc(logoFile)}" style="font-size:0.65rem;padding:3px 6px;margin-top:3px" oninput="setCashLogo('${jsq(a)}',this.value)" onblur="renderCashPage()"></div>${isDefault?'':` <button class="btn btn-d btn-sm" onclick="removeCashAccount('${jsq(a)}')">✕</button>`}</div>`;}).join('');}
  const opts=ACCTS.map(a=>`<option>${a}</option>`).join('');
  const xFrom=document.getElementById('xfr-from');const xTo=document.getElementById('xfr-to');
  if(xFrom) xFrom.innerHTML=opts;if(xTo) xTo.innerHTML=opts;
}
function saveCashInterest(){
  const ACCTS=getCashAccounts();
  const meta={};
  ACCTS.forEach(b=>{
    const bkey=b.toLowerCase().replace(/\s+/g,'-');
    const rateEl=document.getElementById('cash-int-'+bkey);
    const sdEl=document.getElementById('cash-sd-'+bkey);
    const rate=rateEl?parseFloat(rateEl.value):NaN;
    if(!isNaN(rate)&&rate>0){
      meta[b]={interestRate:rate,compoundType:'daily_accrual'};
      if(sdEl&&sdEl.value) meta[b].startDate=sdEl.value;
    } else {meta[b]={};}
  });
  saveCashInterestMeta(meta);
  toast('Interest rates saved');
  renderCashPage();renderDashboard();
}
async function changeCashMonth(m){
  S.cashMonth=m;
  const cached=cGet(CK.cash(m,S.cashYear));
  const accts=getCashAccounts();
  const cachedTotal=cached?accts.reduce((s,b)=>s+Math.abs(cached[b]||0),0):0;
  if(cached&&cachedTotal>0){
    // Cache has real balances — show immediately.
    S.cash=cached;
  } else {
    // Cache is empty or all-zero — show prev month's closing balance as a
    // placeholder while loadCashData runs the seed/repair against Firestore.
    const prevM=m===1?12:m-1,prevY=m===1?S.cashYear-1:S.cashYear;
    const prevCached=cGet(CK.cash(prevM,prevY))||{};
    const seed={};
    Object.keys(prevCached).forEach(k=>{if(k!=='month'&&k!=='year') seed[k]=prevCached[k];});
    if(Object.keys(seed).length) S.cash=seed;
  }
  renderCashPage();
  // Investments live on the same Accounts page and follow this same month —
  // paint instantly from cache (or the previous month's cache as a
  // placeholder — see _getInvData), then refresh live like Cash does.
  renderInvestments();
  if(db&&navigator.onLine){
    loadCashData(m,S.cashYear).then(()=>{if(S.cashMonth===m)renderCashPage();}).catch(()=>{});
    loadInvData(m,S.cashYear).then(()=>{if(S.cashMonth===m)renderInvestments();}).catch(()=>{});
  }
  startRealtimeListeners();
}
async function saveCash(){
  const ACCTS=getCashAccounts();
  const _prevVals={...(S.cash||cGet(CK.cash(S.cashMonth,S.cashYear))||{})};
  const data={month:S.cashMonth,year:S.cashYear};
  ACCTS.forEach(b=>{const el=document.getElementById('cash-'+b.toLowerCase().replace(/\s+/g,'-'));data[b]=el?parseFloat(el.value)||0:0;});
  S.cash=data;cSet(CK.cash(S.cashMonth,S.cashYear),data);
  renderCashPage();renderDashboard();toast('Cash balances saved');haptic([8]);setSyncStatus('syncing');
  ACCTS.forEach(b=>_markCashDirty(S.cashMonth,S.cashYear,b));
  try{
    await db.collection('cashBalances').doc(sid(S.cashMonth,S.cashYear)).set(data,{merge:true});
    ACCTS.forEach(b=>_clearCashDirty(S.cashMonth,S.cashYear,b));
    setSyncStatus('synced');
    // A manual balance correction changes this month's closing, so it must
    // ripple into every later month that already has a doc.
    ACCTS.forEach(b=>{
      const d=(data[b]||0)-(_prevVals[b]||0);
      if(d) _rippleCashForward(b,d,S.cashMonth,S.cashYear);
    });
  }
  catch(e){
    ACCTS.forEach(b=>_clearCashDirty(S.cashMonth,S.cashYear,b));
    toast('Saved locally — sync pending');setSyncStatus('error');
  }
}
function addCashAccount(){
  const name=document.getElementById('new-acct-name').value.trim();
  if(!name){toast('Enter an account name');return;}
  const existing=getCashAccounts();
  if(existing.includes(name)){toast('Account already exists');return;}
  setCashAccounts([...existing,name]);
  const logoFile=document.getElementById('new-acct-logo')?.value.trim()||'';
  if(logoFile) setCashLogo(name,logoFile);
  document.getElementById('new-acct-name').value='';
  const le=document.getElementById('new-acct-logo');if(le)le.value='';
  toast(`${name} added`);renderCashPage();
}
function removeCashAccount(name){
  if(DEFAULT_CASH_ACCOUNTS.includes(name)){toast('Cannot remove default accounts');return;}
  setCashAccounts(getCashAccounts().filter(a=>a!==name));
  toast(`${name} removed`);renderCashPage();
}

// ══════════════════════════════════════════════════════════════════════════
// MOVE FUNDS (Cash ↔ Investment)
// ══════════════════════════════════════════════════════════════════════════
let _moveDir = 'cash-inv'; // 'cash-inv' | 'inv-cash'

function openMoveFunds(){
  _moveDir = 'cash-inv';
  document.getElementById('move-date').value = todayStr();
  document.getElementById('move-amt').value = '';
  document.getElementById('move-notes').value = '';
  _populateMoveSelects();
  _syncMoveDirUI();
  openMod('move-modal');
  setTimeout(()=>initNumInputs(document.getElementById('move-modal')), 80);
}

function setMoveDir(dir){
  _moveDir = dir;
  _syncMoveDirUI();
  _populateMoveSelects();
}

function _syncMoveDirUI(){
  const ci = document.getElementById('move-dir-ci');
  const ic = document.getElementById('move-dir-ic');
  if(ci) { ci.className = _moveDir==='cash-inv' ? 'btn btn-p btn-sm' : 'btn btn-g btn-sm'; }
  if(ic) { ic.className = _moveDir==='inv-cash' ? 'btn btn-p btn-sm' : 'btn btn-g btn-sm'; }
  const fromLbl = document.getElementById('move-from-label');
  const toLbl   = document.getElementById('move-to-label');
  if(_moveDir==='cash-inv'){
    if(fromLbl) fromLbl.textContent = 'From Account (Cash)';
    if(toLbl)   toLbl.textContent   = 'To Platform (Investment)';
  } else {
    if(fromLbl) fromLbl.textContent = 'From Platform (Investment)';
    if(toLbl)   toLbl.textContent   = 'To Account (Cash)';
  }
  const title = document.getElementById('move-modal-title');
  if(title) title.textContent = _moveDir==='cash-inv' ? 'Cash → Investment' : 'Investment → Cash';
}

function _populateMoveSelects(){
  const cashOpts = cashOptsWithBal();
  const invOpts  = invOptsWithBal();
  const fromSel = document.getElementById('move-from');
  const toSel   = document.getElementById('move-to');
  if(_moveDir==='cash-inv'){
    if(fromSel) fromSel.innerHTML = cashOpts;
    if(toSel)   toSel.innerHTML   = invOpts;
  } else {
    if(fromSel) fromSel.innerHTML = invOpts;
    if(toSel)   toSel.innerHTML   = cashOpts;
  }
}

async function saveMoveFunds(){
  const amt = parseFloat(document.getElementById('move-amt').value);
  if(!amt || amt <= 0){ toast('Enter a valid amount'); return; }
  const from  = document.getElementById('move-from').value;
  const to    = document.getElementById('move-to').value;
  const date  = document.getElementById('move-date').value || todayStr();
  const notes = document.getElementById('move-notes').value.trim();
  const m = S.cashMonth, y = S.cashYear;

  const _mfx = getFxRates(m,y).USD||1650;

  if(_moveDir === 'cash-inv'){
    // Deduct from cash account (in its own currency)
    if((S.cash[from]||0) < amt){ toast(`Insufficient funds in ${from}`); return; }
    const ngnAmt = isUSDCashAccount(from)?Math.round(amt*_mfx):amt;
    const cash = {...S.cash};
    cash[from] = (cash[from]||0) - amt;
    S.cash = cash;
    cSet(CK.cash(m,y), cash);
    if(db) db.collection('cashBalances').doc(sid(m,y)).set({...cash,month:m,year:y},{merge:true}).catch(()=>{});

    // Add NGN equivalent to investment platform (subs + flat total kept in sync)
    _invDeposit(to, ngnAmt, m, y);

    const platLabel = PLATFORMS.find(p=>p.key===to)?.label || to;
    _saveXfrRecord(from,to,amt,date,m,y,notes,ngnAmt,'cash-inv');
    toast(`Moved ${isUSDCashAccount(from)?'$'+amt:fN(ngnAmt)} from ${from} → ${platLabel}`);
    // Log deposit as a positive movement so withdrawal-aware accrual sees it
    addInvMovement(to, ngnAmt, date, notes);

  } else {
    // Deduct from investment platform (subs + flat total kept in sync)
    const platLabel = PLATFORMS.find(p=>p.key===from)?.label || from;
    if(!_invWithdraw(from, amt, m, y)){
      toast(`Insufficient balance in ${platLabel}`); return;
    }

    // Add to cash account (in its own currency)
    const toAmt = isUSDCashAccount(to)?+(amt/_mfx).toFixed(2):amt;
    const cash = {...S.cash};
    cash[to] = (cash[to]||0) + toAmt;
    S.cash = cash;
    cSet(CK.cash(m,y), cash);
    if(db) db.collection('cashBalances').doc(sid(m,y)).set({...cash,month:m,year:y},{merge:true}).catch(()=>{});

    _saveXfrRecord(from,to,amt,date,m,y,notes,toAmt,'inv-cash');
    toast(`Moved ${fN(amt)} from ${platLabel} → ${to}`);
    // Log withdrawal for realised gain tracking (existing) + accrual movement (negative)
    addInvWithdrawal(from,amt,document.getElementById('move-date')?.value||todayStr(),document.getElementById('move-notes')?.value||'');
    addInvMovement(from, -amt, date, notes);
  }

  haptic([8,40,8]);
  closeMod('move-modal');
  renderCashPage();
  renderInvestments();
  renderDashboard();
}

async function transferFunds(){
  const from=document.getElementById('xfr-from').value,to=document.getElementById('xfr-to').value;
  const amt=parseFloat(document.getElementById('xfr-amt').value)||0;
  if(!amt||amt<=0){toast('Enter a valid amount');return;}
  if(from===to){toast('Choose different accounts');return;}
  const cash={...S.cash};
  if((cash[from]||0)<amt){toast(`Insufficient funds in ${from}`);return;}
  const _tfU=isUSDCashAccount(from),_ttU=isUSDCashAccount(to);
  const _tfx=getFxRates(S.cashMonth,S.cashYear).USD||1650;
  const _toAmt=_tfU===_ttU?amt:(_tfU?Math.round(amt*_tfx):+(amt/_tfx).toFixed(2));
  cash[from]=(cash[from]||0)-amt;cash[to]=(cash[to]||0)+_toAmt;
  S.cash=cash;cSet(CK.cash(S.cashMonth,S.cashYear),cash);
  _saveXfrRecord(from,to,amt,todayStr(),S.cashMonth,S.cashYear,'',_toAmt,'cash-cash');
  document.getElementById('xfr-amt').value='';toast(`Transferred ${_tfU?'$'+amt:fN(amt)} from ${from} to ${to}`);
  renderCashPage();renderDashboard();setSyncStatus('syncing');
  try{await db.collection('cashBalances').doc(sid(S.cashMonth,S.cashYear)).set({...cash,month:S.cashMonth,year:S.cashYear},{merge:true});setSyncStatus('synced');}
  catch(e){setSyncStatus('error');}
}

// ══════════════════════════════════════════════════════════════════════════
// DEBTORS
// ══════════════════════════════════════════════════════════════════════════
function renderDebtors(){
  const dbs=S.debtors;
  const cur=S.dashCurrency,m=S.dashMonth,y=S.dashYear;
  const totalLoaned=dbs.reduce((s,d)=>{const r=d.rate||DEF_RATES[d.currency]||1;return s+(d.amount||0)*r;},0);
  const totalOwed=dbs.filter(d=>d.expectRepayment!==false).reduce((s,d)=>s+(d.ngnBalance||0),0);
  const _dstats=document.getElementById('debtor-stats');
  const _dlist=document.getElementById('debtor-list');
  if(!_dstats||!_dlist) return; // elements only exist when Debtors tab is active
  _dstats.innerHTML=`<div class="card card-sm" style="margin-bottom:0"><div class="clabel">Total Loaned${eyeBtn('deb-loaned','renderDebtors')}</div><div class="cval-sm">${maskIf('deb-loaned',fmtCur(totalLoaned,cur,m,y))}</div></div><div class="card card-sm" style="margin-bottom:0"><div class="clabel">Expected Back${eyeBtn('deb-owed','renderDebtors')}</div><div class="cval-sm" style="color:var(--red)">${maskIf('deb-owed',fmtCur(totalOwed,cur,m,y))}</div></div>`;
  if(!dbs.length){_dlist.innerHTML='<div class="empty"><div class="empty-i">⊟</div>No debtors yet</div>';return;}
  _dlist.innerHTML=dbs.map((d,idx)=>{
    const expectRepay=d.expectRepayment!==false;
    const pct=d.amount>0?((d.paid||0)/d.amount)*100:0;
    const settled=pct>=100||!expectRepay;
    const owedDisp=fmtCur(d.ngnBalance||0,cur,m,y);
    return`<div class="dc" style="cursor:pointer;${settled&&expectRepay?'opacity:0.4':''}" onclick="drillDownDebtor('${d.id||idx}')">
      <div class="dc-top">
        <div><div class="dc-name">${esc(d.name)} <span style="font-size:0.62rem;color:var(--text3)">›</span></div><div class="dc-sub">${esc(d.category)} · ${d.currency} ${fNum(d.amount)}${d.date?' · '+fmtDate(d.date):''}</div></div>
        <div class="badge ${!expectRepay?'bgold':settled?'bg':'br'}">${!expectRepay?'Write-off':settled?'Settled':owedDisp+' due'}</div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">
        <div style="font-size:0.65rem;color:var(--text2)">Expecting repayment</div>
        <div onclick="event.stopPropagation();toggleRepay('${d.id||idx}',${!expectRepay})" style="width:36px;height:20px;border-radius:10px;background:${expectRepay?'var(--accent)':'var(--border2)'};position:relative;cursor:pointer;transition:background 0.2s;flex-shrink:0">
          <div style="position:absolute;top:2px;${expectRepay?'right:2px':'left:2px'};width:16px;height:16px;border-radius:50%;background:${expectRepay?'var(--bg)':'var(--text3)'};transition:all 0.2s"></div>
        </div>
      </div>
      ${expectRepay&&!settled?`<div class="prog" style="margin-top:8px"><div class="pf ok" style="width:${Math.min(pct,100)}%"></div></div>`:''}
      ${d.notes?`<div style="font-size:0.65rem;color:var(--text2);margin-top:5px">${esc(d.notes)}</div>`:''}
      <div style="display:flex;gap:6px;margin-top:9px;flex-wrap:wrap">
        ${expectRepay&&!settled?`<button class="btn btn-g btn-sm" onclick="event.stopPropagation();recordPmt('${d.id||idx}',${d.amount},${d.paid||0},${d.rate||DEF_RATES[d.currency]||1})">Record Payment</button>`:''}
        <button class="btn btn-g btn-sm" onclick="event.stopPropagation();openAddDebt('${d.id||idx}')">+ Add Debt</button>
        <button class="btn btn-g btn-sm" onclick="event.stopPropagation();openEditDeb('${d.id||idx}')">Edit</button>
        <button class="btn btn-d btn-sm" onclick="event.stopPropagation();removeDeb('${d.id||idx}')">Remove</button>
      </div>
    </div>`;
  }).join('');
}
async function toggleRepay(id,newVal){
  // Find by id, fall back to index for seed-imported debtors without a Firestore id
  const d=id?S.debtors.find(x=>x.id===id):null;
  if(d){
    d.expectRepayment=newVal;
  } else {
    // id was the rendered index (for un-synced debtors)
    const idx=parseInt(id);
    if(!isNaN(idx)&&S.debtors[idx]) S.debtors[idx].expectRepayment=newVal;
  }
  cSet(CK.debtors,S.debtors);
  renderDebtors();
  if(id&&db){try{await db.collection('debtors').doc(id).update({expectRepayment:newVal});}catch(e){}}
}
function _populateDebAcct(selectedVal=''){
  const sel=document.getElementById('d-acct');if(!sel) return;
  const accts=getCashAccounts();
  sel.innerHTML=`<option value="">— None / Don't deduct —</option>`+
    accts.map(a=>`<option value="${a}"${a===selectedVal?' selected':''}>${a}</option>`).join('');
}
function openDebMod(){
  document.getElementById('deb-mod-title').textContent='Add Debtor';
  document.getElementById('deb-save').textContent='Add Debtor';
  document.getElementById('d-eid').value='';
  ['d-name','d-amt','d-paid','d-rate','d-notes'].forEach(i=>document.getElementById(i).value='');
  document.getElementById('d-cur').value='NGN';
  document.getElementById('d-type').value='Loan';
  document.getElementById('d-date').value=todayStr();
  const adjWrap=document.getElementById('d-adjust-wrap');if(adjWrap)adjWrap.style.display='none';
  const adjChk=document.getElementById('d-adjust-cash');if(adjChk)adjChk.checked=false;
  _populateDebAcct('');
  openMod('deb-modal');
}
function openEditDeb(id){
  const d=S.debtors.find(x=>x.id===id);if(!d) return;
  document.getElementById('deb-mod-title').textContent='Edit Debtor';
  document.getElementById('deb-save').textContent='Update';
  document.getElementById('d-eid').value=id;
  document.getElementById('d-name').value=d.name||'';
  document.getElementById('d-cur').value=d.currency||'NGN';
  document.getElementById('d-type').value=d.category||'Loan';
  document.getElementById('d-amt').value=d.amount||'';
  document.getElementById('d-paid').value=d.paid||'';
  document.getElementById('d-rate').value=d.rate||'';
  document.getElementById('d-notes').value=d.notes||'';
  document.getElementById('d-date').value=d.date||todayStr();
  const adjWrap=document.getElementById('d-adjust-wrap');if(adjWrap)adjWrap.style.display='block';
  const adjChk=document.getElementById('d-adjust-cash');if(adjChk)adjChk.checked=false;
  _populateDebAcct(d.disbursedFrom||'');
  openMod('deb-modal');
}
async function saveDebtor(){
  if(S.saving) return;const name=document.getElementById('d-name').value.trim();const amt=parseFloat(document.getElementById('d-amt').value);if(!name||!amt){toast('Name and amount required');return;}
  S.saving=true;const btn=document.getElementById('deb-save');btn.textContent='Saving…';btn.disabled=true;setSyncStatus('syncing');
  const cur=document.getElementById('d-cur').value,paid=parseFloat(document.getElementById('d-paid').value)||0,rateIn=parseFloat(document.getElementById('d-rate').value),rate=isNaN(rateIn)?(DEF_RATES[cur]||1):rateIn,bal=amt-paid,eid=document.getElementById('d-eid').value;
  const disbAcct=document.getElementById('d-acct')?.value||'';
  const txDate=document.getElementById('d-date')?.value||todayStr();
  const data={name,currency:cur,amount:amt,paid,balance:bal,rate,ngnBalance:bal*rate,category:document.getElementById('d-type').value,notes:document.getElementById('d-notes').value,date:txDate,expectRepayment:true,disbursedFrom:disbAcct};
  try{
    if(eid){
      const _oldDeb=S.debtors.find(x=>x.id===eid);
      await db.collection('debtors').doc(eid).update(data);
      const idx=S.debtors.findIndex(x=>x.id===eid);
      if(idx>=0)S.debtors[idx]={...S.debtors[idx],...data};
      cSet(CK.debtors,S.debtors);
      // Optional: also adjust cash for the change in principal, gated by an
      // explicit checkbox since debtor edits normally do NOT touch cash
      // (the money already moved). Only meaningful when an account is
      // selected and we know the debtor's prior figures.
      const adjChk=document.getElementById('d-adjust-cash');
      if(adjChk&&adjChk.checked&&disbAcct&&_oldDeb){
        const oldRate=_oldDeb.rate||DEF_RATES[_oldDeb.currency]||1;
        const oldPrincipalNGN=(_oldDeb.currency==='USD'||_oldDeb.currency==='GBP')?(_oldDeb.amount||0)*oldRate:(_oldDeb.amount||0);
        const newPrincipalNGN=(cur==='USD'||cur==='GBP')?amt*rate:amt;
        const delta=oldPrincipalNGN-newPrincipalNGN; // positive = amount decreased, credit cash back
        if(delta){
          const txD=new Date(txDate);
          const dm=txD.getMonth()+1,dy=txD.getFullYear();
          _adjustCash(disbAcct, delta, dm, dy, 'debt-edit-adjust', eid);
        }
      }
    } else {
      data.createdAt=firebase.firestore.FieldValue.serverTimestamp();
      // Generate the ID client-side so the same doc can be queued for retry
      // if the write fails while offline.
      const newId=db.collection('debtors').doc().id;
      let _debOffline=false;
      try{
        await db.collection('debtors').doc(newId).set(data);
      }catch(werr){
        const qd={...data};delete qd.createdAt;
        oqAdd('debtors',newId,qd,false);
        _debOffline=true;
      }
      S.debtors=[{...data,id:newId},...(S.debtors||[])];
      cSet(CK.debtors,S.debtors);
      // Deduct from cash balance if an account was selected (new debtor only).
      // Routed through _adjustCash so it is atomic, ledgered, ripples into
      // later months, and queues itself for retry when offline.
      if(disbAcct){
        const txD=new Date(txDate);
        const dm=txD.getMonth()+1,dy=txD.getFullYear();
        const deductNGN=cur==='USD'?amt*rate:(cur==='GBP'?amt*rate:amt);
        _adjustCash(disbAcct, -deductNGN, dm, dy, 'debt-add', newId);
      }
      if(_debOffline){
        closeMod('deb-modal');toast('Saved offline — will sync when connected');haptic([8,40,8]);setSyncStatus('offline');await loadDebtors();renderDebtors();
        return;
      }
    }
    closeMod('deb-modal');toast(eid?'Updated':'Debtor added — account balance updated');haptic([8,40,8]);setSyncStatus('synced');await loadDebtors();renderDebtors();
  }
  catch(e){toast('Error saving');setSyncStatus('error');}
  finally{S.saving=false;btn.textContent=document.getElementById('d-eid').value?'Update':'Add Debtor';btn.disabled=false;}
}
// ── ADD ADDITIONAL DEBT TO AN EXISTING DEBTOR ─────────────────────────────
function openAddDebt(id){
  const d=S.debtors.find(x=>x.id===id);if(!d){toast('Debtor not found');return;}
  const cashOpts=cashOptsWithBal(true);
  document.getElementById('drill-title').textContent='Add Debt — '+d.name;
  document.getElementById('drill-body').innerHTML=`
    <div class="csub" style="margin-bottom:10px">Current: ${d.currency} ${fNum(d.amount)} loaned · ${fNum((d.amount||0)-(d.paid||0))} outstanding</div>
    <div class="ig"><label class="ilabel">Additional Amount (${d.currency})</label>
      <input class="ifield" type="text" id="ad-amt" placeholder="0" style="font-size:1.1rem;font-family:var(--mono)"></div>
    <div class="ig"><label class="ilabel">Disburse from Account (optional)</label>
      <select class="sfield" id="ad-bank"><option value="">— Don't deduct —</option>${cashOpts}</select></div>
    <div class="ig"><label class="ilabel">Date</label>
      <input class="ifield" type="date" id="ad-date" value="${todayStr()}"></div>
    <div class="ig"><label class="ilabel">Note</label>
      <input class="ifield" type="text" id="ad-note" placeholder="Optional"></div>
    <button class="btn btn-p btn-full" id="ad-save" onclick="_doAddDebt('${id}')">Add to Debt</button>`;
  openMod('drill-modal');
  setTimeout(()=>initNumInputs(document.getElementById('drill-body')),80);
}
async function _doAddDebt(id){
  const d=S.debtors.find(x=>x.id===id);if(!d)return;
  const add=parseFloat(document.getElementById('ad-amt')?.value);
  if(!add||add<=0){toast('Enter a valid amount');return;}
  const bank=document.getElementById('ad-bank')?.value||'';
  const dDate=document.getElementById('ad-date')?.value||todayStr();
  const note=document.getElementById('ad-note')?.value||'';
  const rate=d.rate||DEF_RATES[d.currency]||1;
  const newAmt=(d.amount||0)+add;
  const newBal=newAmt-(d.paid||0);
  const entry={date:dDate,amount:add,note,disbursedFrom:bank||null};
  const log=[...(d.addLog||[]),entry];
  const btn=document.getElementById('ad-save');
  if(btn){btn.textContent='Saving…';btn.disabled=true;}
  try{
    await db.collection('debtors').doc(id).update({amount:newAmt,balance:newBal,ngnBalance:newBal*rate,addLog:log,expectRepayment:true});
    if(bank){
      // Mirror the payment-credit currency rules, in the deduction direction
      const isUSDAcct=isUSDCashAccount(bank);
      let delta;
      if(isUSDAcct) delta=(d.currency==='USD')?add:add/rate;
      else delta=(d.currency==='NGN'||!d.currency)?add:add*rate;
      const txD=new Date(dDate);const dm=txD.getMonth()+1,dy=txD.getFullYear();
      _adjustCash(bank,-delta,dm,dy,'debt-add');
    }
    closeMod('drill-modal');
    toast(`Debt increased by ${d.currency} ${fNum(add)}${bank?' · '+bank+' deducted':''}`);
    haptic([8,40,8]);
    await loadDebtors();renderDebtors();renderDashboard();
  }catch(e){toast('Error adding debt');}
  finally{if(btn){btn.textContent='Add to Debt';btn.disabled=false;}}
}
async function recordPmt(id,amt,paid,rate){
  const d=S.debtors.find(x=>x.id===id);if(!d)return;
  const cashOpts=cashOptsWithBal(true);
  document.getElementById('drill-title').textContent='Record Payment — '+d.name;
  document.getElementById('drill-body').innerHTML=`
    <div class="ig"><label class="ilabel">Payment Amount (${d.currency})</label>
      <input class="ifield" type="text" id="rp-amt" placeholder="0" style="font-size:1.1rem;font-family:var(--mono)"></div>
    <div class="ig"><label class="ilabel">Credit to Account (optional)</label>
      <select class="sfield" id="rp-bank"><option value="">— Don't credit —</option>${cashOpts}</select></div>
    <div class="ig"><label class="ilabel">Date</label>
      <input class="ifield" type="date" id="rp-date" value="${todayStr()}"></div>
    <button class="btn btn-p btn-full" id="rp-save" onclick="_doRecordPmt('${id}',${amt},${paid},${rate})">Save Payment</button>
  `;
  openMod('drill-modal');
  setTimeout(()=>document.getElementById('rp-amt')?.focus(),200);
}
async function _doRecordPmt(id,amt,paid,rate){
  const pmtEl=document.getElementById('rp-amt');
  const pmt=parseFloat(pmtEl?.value);
  if(!pmt||pmt<=0){toast('Enter a valid amount');return;}
  const bankAcct=document.getElementById('rp-bank')?.value||'';
  const pmtDate=document.getElementById('rp-date')?.value||todayStr();
  const np=paid+pmt,bal=amt-np;
  const entry={date:pmtDate,amount:pmt,creditedTo:bankAcct||null};
  const btn=document.getElementById('rp-save');
  if(btn){btn.textContent='Saving…';btn.disabled=true;}
  try{
    const d=S.debtors.find(x=>x.id===id);
    const log=[...((d&&d.pmtLog)||[]),entry];
    await db.collection('debtors').doc(id).update({paid:np,balance:bal,ngnBalance:bal*rate,pmtLog:log});
    if(bankAcct){
      const isUSDAcct=isUSDCashAccount(bankAcct);
      // For USD Cash accounts: store the raw foreign-currency amount (USD).
      // For NGN accounts: convert to NGN using the debt's exchange rate.
      let cashDelta;
      if(isUSDAcct){
        // pmt is in the debt's currency; if debt is USD add raw, otherwise convert to USD
        cashDelta=(d?.currency==='USD')?pmt:pmt/rate;
      } else {
        cashDelta=(d?.currency==='NGN'||!d?.currency)?pmt:pmt*rate;
      }
      const txD=new Date(pmtDate);const dm=txD.getMonth()+1,dy=txD.getFullYear();
      const cashData={...(cGet(CK.cash(dm,dy))||S.cash)};
      cashData[bankAcct]=(cashData[bankAcct]||0)+cashDelta;
      if(dm===S.expMonth&&dy===S.expYear)S.cash=cashData;
      cSet(CK.cash(dm,dy),cashData);
      if(db)db.collection('cashBalances').doc(sid(dm,dy)).set({...cashData,month:dm,year:dy},{merge:true}).catch(()=>{});
      renderCashPage();renderDashboard();
    }
    toast('Payment recorded'+(bankAcct?' · '+bankAcct+' credited':''));
    closeMod('drill-modal');
    await loadDebtors();renderDebtors();
  }catch(e){toast('Error');if(btn){btn.textContent='Save Payment';btn.disabled=false;}}
}
function togglePmtLog(id){
  const el=document.getElementById('pmt-log-'+id);
  if(el) el.style.display=el.style.display==='none'?'block':'none';
}
async function removeDeb(id){if(!confirm('Remove this debtor?')) return;try{await db.collection('debtors').doc(id).delete();toast('Removed');await loadDebtors();renderDebtors();}catch(e){toast('Error removing');}}

// ══════════════════════════════════════════════════════════════════════════
// ACCOUNTS PAGE (Cash + Investments)
// ══════════════════════════════════════════════════════════════════════════
function acctTab(tab, btn){
  ['cash','invest','debtors','loans'].forEach(t=>{const el=document.getElementById('acct-'+t);if(el)el.style.display=t===tab?'block':'none';});
  btn.closest('.tabs').querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  // The month pill only applies to Cash/Investments, which are stored as
  // monthly snapshots — Debtors/Loans are running balances with no per-month
  // history, so showing the pill there would wrongly imply it changes them.
  const monthsRow=document.getElementById('cash-months');
  if(monthsRow) monthsRow.style.display=(tab==='debtors'||tab==='loans')?'none':'flex';
  if(tab==='debtors') renderDebtors();
  if(tab==='loans') renderLoans();
}
function toggleCashEdit(){
  const s=document.getElementById('cash-edit-section');
  const open=s.style.display!=='none';
  s.style.display=open?'none':'block';
}

// ══════════════════════════════════════════════════════════════════════════
// LOANS
// ══════════════════════════════════════════════════════════════════════════

async function loadLoans(){
  try{
    const snap=await db.collection('loans').get();
    if(snap&&snap.size>=0){
      S.loans=snap.docs.map(d=>({id:d.id,...d.data()}));
      cSet(CK.loans,S.loans);
    }
  }catch(e){_warnLoad('loadLoans',e);}
}

function _populateLoanAcct(selId, selectedVal=''){
  const sel=document.getElementById(selId);if(!sel) return;
  const accts=getCashAccounts();
  sel.innerHTML=`<option value="">— None / External —</option>`+
    accts.map(a=>`<option value="${a}"${a===selectedVal?' selected':''}>${a}</option>`).join('');
}

function openLoanMod(){
  document.getElementById('loan-mod-title').textContent='Add Loan';
  document.getElementById('loan-save').textContent='Add Loan';
  document.getElementById('ln-eid').value='';
  ['ln-lender','ln-amt','ln-rate-pa','ln-fx','ln-notes'].forEach(i=>{const el=document.getElementById(i);if(el)el.value='';});
  document.getElementById('ln-cur').value='NGN';
  document.getElementById('ln-type').value='Personal';
  document.getElementById('ln-start').value=todayStr();
  document.getElementById('ln-due').value='';
  const adjWrap=document.getElementById('ln-adjust-wrap');if(adjWrap)adjWrap.style.display='none';
  const adjChk=document.getElementById('ln-adjust-cash');if(adjChk)adjChk.checked=false;
  _populateLoanAcct('ln-acct','');
  openMod('loan-modal');
}

function openEditLoan(id){
  const l=S.loans.find(x=>x.id===id);if(!l) return;
  document.getElementById('loan-mod-title').textContent='Edit Loan';
  document.getElementById('loan-save').textContent='Update Loan';
  document.getElementById('ln-eid').value=id;
  document.getElementById('ln-lender').value=l.lender||'';
  document.getElementById('ln-cur').value=l.currency||'NGN';
  document.getElementById('ln-type').value=l.loanType||'Personal';
  document.getElementById('ln-amt').value=l.amount||'';
  document.getElementById('ln-rate-pa').value=l.ratePA||'';
  document.getElementById('ln-start').value=l.startDate||todayStr();
  document.getElementById('ln-due').value=l.dueDate||'';
  document.getElementById('ln-fx').value=l.fxRate||'';
  document.getElementById('ln-notes').value=l.notes||'';
  const adjWrap=document.getElementById('ln-adjust-wrap');if(adjWrap)adjWrap.style.display='block';
  const adjChk=document.getElementById('ln-adjust-cash');if(adjChk)adjChk.checked=false;
  _populateLoanAcct('ln-acct', l.disbursedTo||'');
  openMod('loan-modal');
}

async function saveLoan(){
  if(S.saving) return;
  const lender=document.getElementById('ln-lender').value.trim();
  const rawAmt=document.getElementById('ln-amt').value.replace(/,/g,'');
  const amt=parseFloat(rawAmt);
  if(!lender||!amt||amt<=0){toast('Lender name and principal amount required');return;}
  S.saving=true;
  const btn=document.getElementById('loan-save');
  btn.textContent='Saving…';btn.disabled=true;setSyncStatus('syncing');
  const cur=document.getElementById('ln-cur').value;
  const fxIn=parseFloat(document.getElementById('ln-fx').value);
  const fxRate=isNaN(fxIn)||fxIn<=0?(getFxRates(S.expMonth,S.expYear)[cur]||1):fxIn;
  const amtNGN=cur==='NGN'?amt:Math.round(amt*fxRate);
  const eid=document.getElementById('ln-eid').value;
  const disbAcct=document.getElementById('ln-acct').value||'';
  const startDate=document.getElementById('ln-start').value||todayStr();
  const data={
    lender,
    currency:cur,
    amount:amt,
    amtNGN,
    fxRate,
    loanType:document.getElementById('ln-type').value,
    ratePA:parseFloat(document.getElementById('ln-rate-pa').value)||0,
    startDate,
    dueDate:document.getElementById('ln-due').value||'',
    notes:document.getElementById('ln-notes').value||'',
    disbursedTo:disbAcct,
    repaid:eid?(S.loans.find(x=>x.id===eid)?.repaid||0):0,
    repayLog:eid?(S.loans.find(x=>x.id===eid)?.repayLog||[]):[],
    status:'active',
  };
  // Mark settled if fully repaid
  if(data.repaid>=amtNGN) data.status='settled';
  try{
    if(eid){
      const _oldLoan=S.loans.find(x=>x.id===eid);
      await db.collection('loans').doc(eid).update(data);
      const idx=S.loans.findIndex(x=>x.id===eid);
      if(idx>=0)S.loans[idx]={...S.loans[idx],...data};
      cSet(CK.loans,S.loans);
      // Optional: also adjust cash for the change in principal, gated by an
      // explicit checkbox since loan edits normally do NOT touch cash (the
      // money already moved). Only meaningful when an account is selected.
      const adjChk=document.getElementById('ln-adjust-cash');
      if(adjChk&&adjChk.checked&&disbAcct&&_oldLoan){
        const delta=amtNGN-(_oldLoan.amtNGN||0); // positive = principal increased, credit the extra
        if(delta){
          const d=new Date(startDate);
          const lm=d.getMonth()+1,ly=d.getFullYear();
          _adjustCash(disbAcct, delta, lm, ly, 'loan-edit-adjust', eid);
        }
      }
      toast('Loan updated');
    } else {
      data.createdAt=firebase.firestore.FieldValue.serverTimestamp();
      // Generate the ID client-side so the doc can be queued for retry if
      // the write fails while offline; the cash credit below still lands
      // immediately via _adjustCash's own offline queue either way.
      const newId=db.collection('loans').doc().id;
      let _loanOffline=false;
      try{
        await db.collection('loans').doc(newId).set(data);
      }catch(werr){
        const qd={...data};delete qd.createdAt;
        oqAdd('loans',newId,qd,false);
        _loanOffline=true;
      }
      S.loans=[{...data,id:newId},...(S.loans||[])];
      cSet(CK.loans,S.loans);
      // Credit the selected cash account with the loan proceeds
      if(disbAcct){
        const d=new Date(startDate);
        const lm=d.getMonth()+1,ly=d.getFullYear();
        _adjustCash(disbAcct, amtNGN, lm, ly, 'loan-proceeds', newId);
      }
      toast(_loanOffline?'Saved offline — will sync when connected':'Loan recorded — account credited');
    }
    haptic([8,40,8]);setSyncStatus('synced');
    closeMod('loan-modal');
    await loadLoans();renderLoans();
  }catch(e){toast('Error saving loan');setSyncStatus('error');}
  finally{S.saving=false;btn.textContent=eid?'Update Loan':'Add Loan';btn.disabled=false;}
}

async function removeLoan(id){
  if(!confirm('Remove this loan record? This does not reverse any cash entries.')) return;
  try{
    await db.collection('loans').doc(id).delete();
    toast('Loan removed');
    await loadLoans();renderLoans();
  }catch(e){toast('Error removing loan');}
}

function openLoanRepay(id){
  document.getElementById('lrp-lid').value=id;
  document.getElementById('lrp-amt').value='';
  document.getElementById('lrp-notes').value='';
  document.getElementById('lrp-date').value=todayStr();
  _populateLoanAcct('lrp-acct','');
  openMod('loan-repay-modal');
}

async function saveLoanRepayment(){
  if(S.saving) return;
  const id=document.getElementById('lrp-lid').value;
  const rawAmt=document.getElementById('lrp-amt').value.replace(/,/g,'');
  const amt=parseFloat(rawAmt);
  if(!id||!amt||amt<=0){toast('Amount required');return;}
  const loan=S.loans.find(x=>x.id===id);
  if(!loan){toast('Loan not found');return;}
  S.saving=true;setSyncStatus('syncing');
  const deductAcct=document.getElementById('lrp-acct').value||'';
  const rpDate=document.getElementById('lrp-date').value||todayStr();
  const rpNotes=document.getElementById('lrp-notes').value||'';
  // The repayment amount is always in NGN (like debtor payments)
  const newRepaid=(loan.repaid||0)+amt;
  const outstanding=Math.max(0,(loan.amtNGN||loan.amount||0)-newRepaid);
  const newLog=[...(loan.repayLog||[]),{date:rpDate,amount:amt,notes:rpNotes,account:deductAcct}];
  const update={repaid:newRepaid,repayLog:newLog,status:outstanding<=0?'settled':'active'};
  try{
    await db.collection('loans').doc(id).update(update);
    // Deduct from cash account
    if(deductAcct){
      const d=new Date(rpDate);
      const lm=d.getMonth()+1,ly=d.getFullYear();
      _adjustCash(deductAcct, -amt, lm, ly, 'loan-repayment', id);
    }
    toast('Repayment recorded');haptic([8,40,8]);setSyncStatus('synced');
    closeMod('loan-repay-modal');
    await loadLoans();renderLoans();
  }catch(e){toast('Error recording repayment');setSyncStatus('error');}
  finally{S.saving=false;}
}

function toggleLoanLog(id){
  const el=document.getElementById('loan-log-'+id);
  if(el) el.style.display=el.style.display==='none'?'block':'none';
}

function renderLoans(){
  const loans=S.loans;
  const cur=S.dashCurrency,m=S.expMonth,y=S.expYear;
  const _lstats=document.getElementById('loan-stats');
  const _llist=document.getElementById('loan-list');
  if(!_lstats||!_llist) return;

  const totalBorrowed=loans.reduce((s,l)=>s+(l.amtNGN||l.amount||0),0);
  const totalOutstanding=loans.filter(l=>l.status!=='settled')
    .reduce((s,l)=>s+Math.max(0,(l.amtNGN||l.amount||0)-(l.repaid||0)),0);
  const activeCount=loans.filter(l=>l.status!=='settled').length;

  _lstats.innerHTML=`
    <div class="card card-sm" style="margin-bottom:0">
      <div class="clabel">Total Borrowed${eyeBtn('loan-borrowed','renderLoans')}</div>
      <div class="cval-sm">${maskIf('loan-borrowed',fmtCur(totalBorrowed,cur,m,y))}</div>
    </div>
    <div class="card card-sm" style="margin-bottom:0">
      <div class="clabel">Outstanding${eyeBtn('loan-out','renderLoans')}</div>
      <div class="cval-sm" style="color:var(--red)">${maskIf('loan-out',fmtCur(totalOutstanding,cur,m,y))}</div>
    </div>`;

  if(!loans.length){
    _llist.innerHTML='<div class="empty"><div class="empty-i">🏦</div>No loans recorded yet</div>';
    return;
  }

  // Sort: active first, then settled; within each group newest first
  const sorted=[...loans].sort((a,b)=>{
    if(a.status==='settled'&&b.status!=='settled') return 1;
    if(a.status!=='settled'&&b.status==='settled') return -1;
    return (b.startDate||'')>(a.startDate||'')?1:-1;
  });

  _llist.innerHTML=sorted.map(l=>{
    const principal=l.amtNGN||l.amount||0;
    const repaid=l.repaid||0;
    const outstanding=Math.max(0,principal-repaid);
    const settled=l.status==='settled'||outstanding<=0;
    const pct=principal>0?Math.min((repaid/principal)*100,100):0;
    const disbTo=l.disbursedTo?`<span style="color:var(--text2)"> → ${esc(l.disbursedTo)}</span>`:'';
    const rateStr=l.ratePA?` · ${l.ratePA}% p.a.`:'';
    const dueStr=l.dueDate?` · Due ${fmtDate(l.dueDate)}`:'';
    // Display-only simple-interest estimate: principal × rate × days/365,
    // from the start date to today (or to settlement — we don't track a
    // settled date, so this keeps accruing display-side until settled).
    // ratePA is stored for reference only and this figure is never saved.
    let accruedStr='';
    if(!settled&&l.ratePA&&l.startDate){
      const start=new Date(l.startDate);
      const days=Math.max(0,Math.floor((Date.now()-start.getTime())/86400000));
      const accrued=principal*(l.ratePA/100)*(days/365);
      if(accrued>0) accruedStr=`<div style="font-size:0.6rem;color:var(--gold);font-family:var(--mono);margin-top:3px">≈${fmtCur(accrued,cur,m,y)} interest accrued over ${days}d (estimate, not saved)</div>`;
    }
    return`<div class="dc" style="cursor:pointer;${settled?'opacity:0.5':''}" onclick="drillDownLoan('${l.id}')">
      <div class="dc-top">
        <div>
          <div class="dc-name">${esc(l.lender)} <span style="font-size:0.62rem;color:var(--text3)">›</span></div>
          <div class="dc-sub">${esc(l.loanType||'Loan')} · ${l.currency} ${fNum(l.amount||0)}${rateStr}${dueStr}</div>
          <div class="dc-sub" style="margin-top:2px">${l.startDate?fmtDate(l.startDate):''}${disbTo}</div>
        </div>
        <div class="badge ${settled?'bg':'br'}">${settled?'Settled':fmtCur(outstanding,cur,m,y)+' left'}</div>
      </div>
      ${!settled?`<div class="prog" style="margin-top:8px"><div class="pf ok" style="width:${pct.toFixed(1)}%"></div></div>
      <div style="font-size:0.6rem;color:var(--text3);font-family:var(--mono);margin-top:3px">${pct.toFixed(0)}% repaid · ${fmtCur(repaid,cur,m,y)} of ${fmtCur(principal,cur,m,y)}</div>${accruedStr}`:''}
      ${l.notes?`<div style="font-size:0.65rem;color:var(--text2);margin-top:5px">${esc(l.notes)}</div>`:''}
      <div style="display:flex;gap:6px;margin-top:9px;flex-wrap:wrap">
        ${!settled?`<button class="btn btn-g btn-sm" onclick="event.stopPropagation();openLoanRepay('${l.id}')">Record Repayment</button>`:''}
        <button class="btn btn-g btn-sm" onclick="event.stopPropagation();openEditLoan('${l.id}')">Edit</button>
        <button class="btn btn-d btn-sm" onclick="event.stopPropagation();removeLoan('${l.id}')">Remove</button>
      </div></div>`
  }).join('');
}

// ══════════════════════════════════════════════════════════════════════════
// DASHBOARD CHART TABS
// ══════════════════════════════════════════════════════════════════════════
function dashChartTab(tab, btn){
  ['breakdown','trend','networth','cashflow','trends'].forEach(t=>{const el=document.getElementById('dash-tab-'+t);if(el)el.style.display=t===tab?'block':'none';});
  btn.closest('.tabs').querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  if(tab==='cashflow') renderCashFlowChart();
  if(tab==='trends') renderCategoryTrends();
}

// ── CATEGORY TRENDS (6-month sparklines) ──────────────────────────────────
function _last6MonthKeys(m,y){
  const out=[];let cm=m,cy=y;
  for(let i=0;i<6;i++){out.unshift({m:cm,y:cy});cm--;if(cm<1){cm=12;cy--;}}
  return out;
}
function renderCategoryTrends(){
  const m=S.dashMonth,y=S.dashYear,cur=S.dashCurrency;
  const el=document.getElementById('cat-spark-list');
  if(!el) return;
  const months=_last6MonthKeys(m,y);
  // Per-category spend per month
  const series={}; // cat -> [6 values]
  months.forEach((mk,i)=>{
    const isCurrent=(mk.m===S.expMonth&&mk.y===S.expYear);
    const txns=isCurrent?S.txns:(cGet(CK.txns(mk.m,mk.y))||[]);
    txns.forEach(t=>{
      if(!series[t.category])series[t.category]=[0,0,0,0,0,0];
      series[t.category][i]+=(t.amount||0);
    });
  });
  const cats=Object.keys(series).filter(c=>series[c].some(v=>v>0));
  if(!cats.length){el.innerHTML='<div class="empty"><div class="empty-i">📈</div>Not enough history yet</div>';return;}
  // Sort by latest-month spend desc
  cats.sort((a,b)=>series[b][5]-series[a][5]);
  const allMax=Math.max(...cats.flatMap(c=>series[c]),1);
  el.innerHTML=cats.map(c=>{
    const vals=series[c];
    const latest=vals[5];
    const prior3=(vals[2]+vals[3]+vals[4])/3;
    const delta=prior3>0?((latest-prior3)/prior3)*100:(latest>0?100:0);
    const rising=delta>10,falling=delta<-10;
    const arrow=rising?'<span style="color:var(--red)">▲</span>':falling?'<span style="color:var(--accent)">▼</span>':'<span style="color:var(--text3)">→</span>';
    const deltaTxt=Math.abs(delta)<1?'flat':`${delta>0?'+':''}${Math.round(delta)}%`;
    // Inline SVG sparkline
    const W=120,H=28,pad=2;
    const max=Math.max(...vals,1);
    const pts=vals.map((v,i)=>{
      const x=pad+(i*(W-2*pad)/5);
      const yv=H-pad-(v/max)*(H-2*pad);
      return`${x.toFixed(1)},${yv.toFixed(1)}`;
    }).join(' ');
    const lastX=pad+(5*(W-2*pad)/5);
    const lastY=H-pad-(vals[5]/max)*(H-2*pad);
    return`<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="font-size:0.74rem;font-weight:600;display:flex;align-items:center;gap:5px">${CAT_ICONS[c]||'📋'} ${esc(c)}</div>
        <div style="font-size:0.6rem;color:var(--text2);font-family:var(--mono);margin-top:1px">${fmtCur(latest,cur,m,y)} ${arrow} ${deltaTxt}</div>
      </div>
      <svg width="${W}" height="${H}" style="flex-shrink:0">
        <polyline points="${pts}" fill="none" stroke="${rising?'var(--red)':falling?'var(--accent)':'var(--blue)'}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" opacity="0.85"/>
        <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="2.2" fill="${rising?'var(--red)':falling?'var(--accent)':'var(--blue)'}"/>
      </svg>
    </div>`;
  }).join('')+`<div class="csub" style="margin-top:8px">Bars span ${MS[months[0].m-1]} ${String(months[0].y).slice(2)} – ${MS[months[5].m-1]} ${String(months[5].y).slice(2)}</div>`;
}

function renderCashFlowChart(){
  const m=S.dashMonth,y=S.dashYear,cur=S.dashCurrency;
  const canvas=document.getElementById('cashflow-diagram');
  if(!canvas) return;

  const incTotal=S.income.reduce((s,i)=>s+(i.amtNGN||i.amount||0),0);
  const catSpend={};
  S.txns.forEach(t=>{catSpend[t.category]=(catSpend[t.category]||0)+(t.amount||0);});

  // Top 7 categories by spend; everything else grouped into Others
  let cats=Object.entries(catSpend).sort((a,b)=>b[1]-a[1]);
  if(cats.length>7){
    const other=cats.slice(7).reduce((s,[,v])=>s+v,0);
    cats=[...cats.slice(0,7),['Others',other]];
  }
  const totalExp=cats.reduce((s,[,v])=>s+v,0);
  const savings=incTotal-totalExp;

  if(!incTotal&&!totalExp){
    if(S._sankeyChart){S._sankeyChart.destroy();S._sankeyChart=null;}
    document.getElementById('cashflow-nodata')?.remove();
    canvas.insertAdjacentHTML('afterend','<div id="cashflow-nodata" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--text3);font-size:0.72rem">No data for this period</div>');
    return;
  }
  document.getElementById('cashflow-nodata')?.remove();

  // Destroy stale instance before creating a new one
  if(S._sankeyChart){S._sankeyChart.destroy();S._sankeyChart=null;}

  // Monarch: muted green/coral palette; Classic keeps the original colors.
  const _mon=isMonarch();
  const CAT_COLOURS=_mon
    ?['#d97862','#c98a4b','#b0779c','#8a7fc9','#bfa04a','#6b93b0','#5aa88a','#9a998f']
    :['#f87171','#fb923c','#e879a0','#c084fc','#fbbf24','#60a5fa','#34d399','#94a3b8'];
  const colorMap=_mon
    ?{'Income':'#2f8f6f','Savings':'#5aa88a','Deficit':'#c98a4b','Others':'#9a998f'}
    :{'Income':'#14b8a6','Savings':'#34d399','Deficit':'#fb923c','Others':'#94a3b8'};
  cats.forEach(([cat],i)=>{if(!colorMap[cat])colorMap[cat]=CAT_COLOURS[i%CAT_COLOURS.length];});

  const data=[];
  cats.forEach(([cat,val])=>data.push({from:'Income',to:cat,flow:val}));
  if(savings>0)       data.push({from:'Income',to:'Savings',flow:savings});
  else if(savings<0)  data.push({from:'Income',to:'Deficit',flow:Math.abs(savings)});

  const ctx=canvas.getContext('2d');
  S._sankeyChart=new Chart(ctx,{
    type:'sankey',
    data:{
      datasets:[{
        label:'Cash Flow',
        data,
        colorFrom:(c)=>colorMap[c.dataset.data[c.dataIndex].from]||'#60a5fa',
        colorTo:  (c)=>colorMap[c.dataset.data[c.dataIndex].to]  ||'#60a5fa',
        colorMode:'gradient',
        borderWidth:0,
        nodePadding:14,
        nodeWidth:14,
      }]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{
          callbacks:{
            label:(item)=>{
              const d=item.dataset.data[item.dataIndex];
              const pct=incTotal>0?Math.round(d.flow/incTotal*100):0;
              return`${d.from} to ${d.to}: ${fmtCur(Math.round(d.flow),cur,m,y)} (${pct}%)`;
            }
          },
          backgroundColor:'rgba(22,27,37,0.95)',
          titleColor:'#e8edf5',
          bodyColor:'#7d8fa8',
          borderColor:'#252d3d',
          borderWidth:1,
          padding:10,
          titleFont:{family:'DM Mono, monospace',size:11},
          bodyFont:{family:'DM Mono, monospace',size:10},
        }
      }
    }
  });

  // Legend
  const legEl=document.getElementById('cashflow-legend');
  if(legEl){
    const items=[
      {color:colorMap['Income'],label:`Income ${fmtCur(incTotal,cur,m,y)}`},
      {color:_mon?'#d97862':'#f87171',label:`Expenses ${fmtCur(totalExp,cur,m,y)}`},
      savings>=0
        ?{color:colorMap['Savings'],label:`Savings ${fmtCur(savings,cur,m,y)}`}
        :{color:colorMap['Deficit'],label:`Deficit ${fmtCur(Math.abs(savings),cur,m,y)}`},
    ];
    legEl.innerHTML=items.map(it=>`<span style="display:flex;align-items:center;gap:3px;font-size:0.58rem;color:var(--text3)"><span style="display:inline-block;width:7px;height:7px;border-radius:1px;background:${it.color}"></span>${it.label}</span>`).join('');
  }
}

// ══════════════════════════════════════════════════════════════════════════
// FORECAST — Treasury, Net Worth, Analytics, History, Fixed Bills
// ══════════════════════════════════════════════════════════════════════════
function renderForecast(){renderProjInsights();renderProjTreasury();renderProjHistory();renderProjObligations();renderProjFees();renderProjAI();}
function projTab(tab,btn){
  ['insights','treasury','history','obligations','ai'].forEach(t=>{
    const el=document.getElementById('proj-'+t);if(el)el.style.display=t===tab?'block':'none';
  });
  btn.closest('.tabs').querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));btn.classList.add('active');
  if(tab==='ai')renderProjAI(); // panel skips the init-time render pass; build it fresh on open
}

// ── ANALYTICS: INSIGHTS TAB ──────────────────────────────────────────────
// Full read of the smart-insights engine: month outlook, per-category
// projections with the method that produced them, and narrative insights
// (including the positive ones the notification bell deliberately skips).
// Manual refresh only (↻ button below): computeSmartInsights re-parses
// several months of cached transactions, so it's kept off the save path.
function refreshInsights(){
  renderProjInsights();
  toast('Insights refreshed');haptic([8]);
}
function renderProjInsights(){
  const el=document.getElementById('proj-insights');if(!el)return;
  const now=new Date();
  const m=now.getMonth()+1,y=now.getFullYear(),day=now.getDate();
  const daysInMonth=new Date(y,m,0).getDate();
  const R=computeSmartInsights();

  // 1) Month outlook header card
  const pct=R.totalBudget>0?Math.round(R.totalProj/R.totalBudget*100):0;
  const barColor=pct>=110?'var(--red)':pct>=90?'var(--gold)':'var(--accent)';
  let html=`<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <div class="clabel" style="margin:0">Month Outlook — ${MONTHS[m-1]} ${y} · Day ${day}/${daysInMonth}</div>
      <button class="btn btn-g btn-sm" onclick="refreshInsights()" title="Recompute insights with the latest data" style="padding:2px 8px;font-size:0.68rem">↻ Refresh</button>
    </div>
    <div class="cval" style="color:${barColor}">${R.totalProj?fN(R.totalProj):'—'}<span style="font-size:0.7rem;color:var(--text2);font-weight:400"> projected${R.totalBudget?` · ${pct}% of ${fN(R.totalBudget)} budget`:''}</span></div>
    ${R.totalBudget?`<div class="prog" style="margin-top:8px"><div class="pf ${pct>=110?'over':pct>=90?'warn':'ok'}" style="width:${Math.min(100,pct)}%"></div></div>`:''}
    <div class="csub" style="margin-top:8px">${R.monthsUsed>=2
      ?`Projections learn from ${R.monthsUsed} months of your history: categories you buy a few times a month (fuel, fees) are held at their typical total — never multiplied per day — while routine spending is paced against your usual curve for day ${day}.`
      :`Only ${R.monthsUsed} month${R.monthsUsed===1?'':'s'} of history cached on this device — projections fall back to simple pro-rata and sharpen as history builds.`}</div>
  </div>`;

  // 2) Narrative insight cards
  const order={danger:0,warn:1,info:2,good:3};
  const insights=[...R.insights].sort((a,b)=>(order[a.type]??2)-(order[b.type]??2)).slice(0,10);
  if(insights.length){
    html+=`<div class="card"><div class="clabel">Insights</div>`+insights.map(a=>`
      <div class="ins-card i-${a.type}">
        <div class="ins-icon">${a.icon}</div>
        <div style="flex:1;min-width:0">
          <div class="ins-title">${a.title}</div>
          <div class="ins-sub">${a.sub}</div>
          ${a.why?`<div class="ins-why">${a.why}</div>`:''}
        </div>
      </div>`).join('')+`</div>`;
  }

  // 3) Category projection table — how each number was reached
  const rows=Object.entries(R.catProj).filter(([,p])=>p.proj>0||p.spent>0)
    .sort((a,b)=>b[1].proj-a[1].proj).slice(0,10);
  if(rows.length){
    const METHOD_LABEL={episodic:'typical total',paced:'your pace curve',linear:'pro-rata'};
    html+=`<div class="card"><div class="clabel">Category Projections</div>`+rows.map(([cat,p])=>{
      const st=p.budget>0?(p.proj>p.budget*1.1?'var(--red)':p.proj>p.budget*0.9?'var(--gold)':'var(--accent)'):'var(--text)';
      return`<div class="pjrow">
        <span class="pjlabel" style="min-width:0"><span style="margin-right:5px">${CAT_ICONS[cat]||'📊'}</span>${cat}<span class="ins-method">${METHOD_LABEL[p.method]||''}</span></span>
        <span class="pjval" style="text-align:right"><span style="color:var(--text2)">${fN(p.spent)}</span> → <span style="color:${st}">${fN(p.proj)}</span>${p.budget?`<span style="color:var(--text3);font-size:0.66rem"> / ${fN(p.budget)}</span>`:''}</span>
      </div>`;}).join('')+`<div class="csub" style="margin-top:8px">spent → projected / budget. "Typical total" = median of your last ${R.monthsUsed} months for categories bought ≤4×/month; "pace curve" = scaled by how much of the month's spend usually lands by day ${day}.</div></div>`;
  }
  el.innerHTML=html;
}

function renderProjTreasury(){
  const el=document.getElementById('proj-treasury');if(!el)return;
  const m=S.dashMonth||S.expMonth,y=S.dashYear||S.expYear,cur=S.dashCurrency||'NGN';
  const hist=getHistory().filter(h=>h.expenses>0).slice(-6);
  const cash=S.cash,cashTotal=cashTotalNGN(cash);
  const avgSpend=hist.length?hist.reduce((s,h)=>s+h.expenses,0)/hist.length:0;
  const avgInc=hist.length?hist.reduce((s,h)=>s+(h.income||0),0)/hist.length:0;
  const {fixed:_tFixed,custom:_tCustom}=_getAllObl();const allObl=[..._tFixed,..._tCustom];
  const fixedTotal=allObl.reduce((s,o)=>s+o.amount,0);
  const runway=avgSpend>0?(cashTotal/avgSpend):null;
  const liquidityRatio=avgSpend>0?(cashTotal/avgSpend):null;
  const savingsRates=hist.map(h=>h.income>0?Math.max(0,(h.income-h.expenses)/h.income*100):0);
  const avgSaveRate=savingsRates.length?savingsRates.reduce((a,b)=>a+b,0)/savingsRates.length:0;
  const latestRate=savingsRates[savingsRates.length-1]||0;
  const rateDir=savingsRates.length>=2?latestRate-savingsRates[savingsRates.length-2]:0;
  const last3=hist.slice(-3),prev3=hist.slice(-6,-3);
  const last3Avg=last3.length?last3.reduce((s,h)=>s+h.expenses,0)/last3.length:0;
  const prev3Avg=prev3.length?prev3.reduce((s,h)=>s+h.expenses,0)/prev3.length:0;
  const expInflation=prev3Avg>0?((last3Avg-prev3Avg)/prev3Avg*100):null;
  const base=avgInc-avgSpend,cons=avgInc*0.9-avgSpend*1.1,opt=avgInc*1.05-avgSpend*0.95;
  el.innerHTML=`
    <div class="g3" style="margin-bottom:10px">
      <div class="card card-sm" style="margin-bottom:0;text-align:center">
        <div class="clabel">Runway</div>
        <div style="font-family:var(--mono);font-size:1.1rem;font-weight:500;color:${runway>6?'var(--accent)':runway>3?'var(--gold)':'var(--red)'}">${runway?runway.toFixed(1)+'mo':'—'}</div>
        <div class="csub">at avg burn</div>
      </div>
      <div class="card card-sm" style="margin-bottom:0;text-align:center">
        <div class="clabel">Liquidity</div>
        <div style="font-family:var(--mono);font-size:1.1rem;font-weight:500;color:${liquidityRatio>3?'var(--accent)':liquidityRatio>1?'var(--gold)':'var(--red)'}">${liquidityRatio?liquidityRatio.toFixed(1)+'x':'—'}</div>
        <div class="csub">cash / burn</div>
      </div>
      <div class="card card-sm" style="margin-bottom:0;text-align:center">
        <div class="clabel">Save Rate</div>
        <div style="font-family:var(--mono);font-size:1.1rem;font-weight:500;color:${avgSaveRate>25?'var(--accent)':avgSaveRate>10?'var(--gold)':'var(--red)'}">${avgSaveRate.toFixed(1)}%</div>
        <div class="csub" style="color:${rateDir>=0?'var(--accent)':'var(--red)'}">${rateDir>=0?'↑':'↓'}${Math.abs(rateDir).toFixed(1)}% MoM</div>
      </div>
    </div>
    <div class="card">
      <div class="sh" style="margin-bottom:10px"><div class="sh-title">Cash Flow Analysis</div></div>
      <div class="pjrow"><span class="pjlabel">Avg. monthly income (6m)</span><span class="pjval" style="color:var(--accent)">${fmtCur(Math.round(avgInc),cur,m,y)}</span></div>
      <div class="pjrow"><span class="pjlabel">Avg. monthly spend (6m)</span><span class="pjval" style="color:var(--red)">${fmtCur(Math.round(avgSpend),cur,m,y)}</span></div>
      <div class="pjrow"><span class="pjlabel">Fixed obligations</span><span class="pjval" style="color:var(--gold)">${fmtCur(Math.round(fixedTotal),cur,m,y)}</span></div>
      <div class="pjrow"><span class="pjlabel">Discretionary (avg − fixed)</span><span class="pjval">${fmtCur(Math.round(Math.max(0,avgSpend-fixedTotal)),cur,m,y)}</span></div>
      <div class="pjrow" style="font-weight:700"><span>Avg. net / month</span><span class="pjval" style="color:${base>=0?'var(--accent)':'var(--red)'}">${fmtCur(Math.round(base),cur,m,y)} ${base>=0?'saved':'deficit'}</span></div>
      ${expInflation!==null?`<div style="margin-top:10px;padding:8px 10px;border-radius:var(--rsm);background:${Math.abs(expInflation)>10?'var(--rdim)':'var(--bg2)'};font-size:0.72rem;color:${expInflation>10?'var(--red)':expInflation<-5?'var(--accent)':'var(--text2)'}">
        ${expInflation>10?'⚠':'◈'} Expense ${expInflation>0?'inflation':'deflation'}: spending is <strong>${Math.abs(expInflation).toFixed(1)}%</strong> ${expInflation>0?'higher':'lower'} vs prior 3 months</div>`:''}
    </div>
    <div class="card">
      <div class="sh" style="margin-bottom:10px"><div class="sh-title">Monthly Net Forecast</div><span style="font-size:0.62rem;color:var(--text3)">next month</span></div>
      <div class="pjrow"><span class="pjlabel" style="display:flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:var(--red);display:inline-block"></span>Conservative</span><span class="pjval" style="color:${cons>=0?'var(--accent)':'var(--red)'}">${fmtCur(Math.round(cons),cur,m,y)}</span></div>
      <div class="pjrow"><span class="pjlabel" style="display:flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:var(--gold);display:inline-block"></span>Base</span><span class="pjval" style="color:${base>=0?'var(--accent)':'var(--red)'}">${fmtCur(Math.round(base),cur,m,y)}</span></div>
      <div class="pjrow"><span class="pjlabel" style="display:flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:var(--accent);display:inline-block"></span>Optimistic</span><span class="pjval" style="color:var(--accent)">${fmtCur(Math.round(opt),cur,m,y)}</span></div>
      <div class="csub" style="margin-top:8px">Conservative = income −10%, spend +10%. Optimistic = income +5%, spend −5%.</div>
    </div>
    <div class="card">
      <div class="sh" style="margin-bottom:14px"><div class="sh-title">Savings Rate Trend</div></div>
      <div style="display:flex;align-items:flex-end;gap:5px;height:100px;padding-bottom:2px">
        ${savingsRates.map((r,i)=>`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px">
          <div style="font-size:0.52rem;font-family:var(--mono);color:var(--text2);font-weight:600">${r>0?r.toFixed(1)+'%':''}</div>
          <div style="width:100%;background:${r>25?'var(--accent)':r>10?'var(--gold)':'var(--red)'};border-radius:3px 3px 0 0;height:${Math.max(6,Math.round(r/60*80))}px;opacity:0.85"></div>
          <div style="font-size:0.5rem;font-family:var(--mono);color:var(--text3)">${hist[i]?hist[i].label.slice(0,3):''}</div>
        </div>`).join('')}
      </div>
    </div>`;
  // Remove previously appended cards to avoid duplication on re-render
  ['proj-treasury-cf','proj-treasury-st'].forEach(id=>{const old=document.getElementById(id);if(old)old.remove();});
  // Append cash flow projection card
  const cfCard=document.createElement('div');cfCard.id='proj-treasury-cf';cfCard.className='card';el.appendChild(cfCard);
  renderCashFlowProjection(cfCard);
  // Append savings target card
  const targetPct=getSavingsTarget();
  const stCard=document.createElement('div');stCard.id='proj-treasury-st';stCard.className='card';
  stCard.innerHTML=`<div class="sh" style="margin-bottom:10px"><div class="sh-title">Monthly Savings Target</div></div>
    <div class="pjrow"><span class="pjlabel">Current target</span><span class="pjval" style="color:var(--accent)">${targetPct?targetPct+'%':'Not set'}</span></div>
    <div style="display:flex;gap:8px;align-items:flex-end;margin-top:10px">
      <div class="ig" style="flex:1;margin-bottom:0"><label class="ilabel">Target %</label><input class="ifield" type="text" id="st-pct" placeholder="e.g. 25" value="${targetPct||''}" style="font-size:0.84rem;padding:7px 10px"></div>
      <button class="btn btn-p btn-sm" onclick="saveSavingsTargetUI()" style="flex-shrink:0;padding:9px 16px">Save</button>
    </div>
    <div class="csub" style="margin-top:6px">Alert fires when actual savings fall below 80% of this target.</div>`;
  el.appendChild(stCard);
}

function _getAllObl(){
  // Fixed bills = seeded FIXED_OBL overridable via sw3_fixed_obl + user additions in sw3_custom_obl
  const fixed=cGet('sw3_fixed_obl')||FIXED_OBL.map(o=>({...o}));
  const custom=cGet('sw3_custom_obl')||[];
  return{fixed,custom};
}
function renderProjObligations(){
  const el=document.getElementById('proj-obligations');
  if(!el) return;
  const m=S.dashMonth||S.expMonth,y=S.dashYear||S.expYear,cur=S.dashCurrency||'NGN';
  const {fixed,custom}=_getAllObl();
  const allObl=[...fixed,...custom];
  const grandTotal=allObl.reduce((s,o)=>s+o.amount,0);
  const recent=getHistory().filter(h=>h.income&&h.expenses).slice(-3);
  const avgInc=recent.length?recent.reduce((s,h)=>s+h.income,0)/recent.length:0;
  const oblPct=avgInc?Math.round((grandTotal/avgInc)*100):null;
  el.innerHTML=`
    <div class="card">
      <div class="clabel">Total Fixed Monthly</div>
      <div class="cval" style="color:var(--gold)">${fmtCur(Math.round(grandTotal),cur,m,y)}</div>
      ${oblPct!==null?`<div class="csub">${oblPct}% of avg. monthly income</div>`:''}
    </div>
    <div class="card">
      <div class="sh"><div class="sh-title">Fixed Bills</div><button class="btn btn-g btn-sm" onclick="addObligation()">+ Add</button></div>
      ${fixed.map((o,i)=>`
        <div class="pjrow" id="obl-fixed-row-${i}">
          <span class="pjlabel" style="flex:1">${o.label}</span>
          <span class="pjval" style="color:var(--gold);margin-right:8px">${fmtCur(Math.round(o.amount),cur,m,y)}</span>
          <button class="btn btn-g btn-sm" style="padding:2px 7px;font-size:0.68rem;margin-right:4px" onclick="editFixedObl(${i})">Edit</button>
          <button class="txi-del" style="font-size:0.7rem" onclick="deleteFixedObl(${i})">×</button>
        </div>
        <div id="obl-fixed-edit-${i}" style="display:none;background:var(--bg2);border-radius:6px;padding:8px 10px;margin:2px 0 6px">
          <div class="ig" style="margin-bottom:6px"><label class="ilabel">Label</label><input class="ifield" id="obl-fe-lbl-${i}" type="text" value="${o.label}"></div>
          <div class="ig" style="margin-bottom:8px"><label class="ilabel">Amount (₦)</label><input class="ifield" id="obl-fe-amt-${i}" type="text" value="${o.amount}"></div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-p btn-sm" onclick="saveFixedObl(${i})">Save</button>
            <button class="btn btn-g btn-sm" onclick="document.getElementById('obl-fixed-edit-${i}').style.display='none'">Cancel</button>
          </div>
        </div>`).join('')}
      ${custom.map((o,i)=>`
        <div class="pjrow">
          <span class="pjlabel" style="flex:1">${o.label}</span>
          <span class="pjval" style="color:var(--gold);margin-right:8px">${fmtCur(Math.round(o.amount),cur,m,y)}</span>
          <button class="txi-del" style="font-size:0.7rem" onclick="removeObligation(${i})">×</button>
        </div>`).join('')}
      <div class="pjrow" style="font-weight:700;border-top:1px solid var(--border2);margin-top:6px;padding-top:10px">
        <span>Total</span><span class="pjval" style="color:var(--gold)">${fmtCur(Math.round(grandTotal),cur,m,y)}</span>
      </div>
    </div>
    <div class="card" id="obl-add-card" style="display:none">
      <div class="clabel" style="margin-bottom:10px">Add Fixed Bill</div>
      <div class="ig"><label class="ilabel">Label</label><input class="ifield" id="obl-lbl" type="text" placeholder="e.g. School fees"></div>
      <div class="ig"><label class="ilabel">Monthly Amount (₦)</label><input class="ifield" id="obl-amt" type="text" placeholder="0"></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button class="btn btn-p btn-sm" onclick="saveObligation()">Save</button>
        <button class="btn btn-g btn-sm" onclick="document.getElementById('obl-add-card').style.display='none'">Cancel</button>
      </div>
    </div>`;
}
function editFixedObl(i){
  document.querySelectorAll('[id^="obl-fixed-edit-"]').forEach(el=>el.style.display='none');
  document.getElementById('obl-fixed-edit-'+i).style.display='block';
}
function deleteFixedObl(i){
  if(!confirm('Remove this fixed bill?')) return;
  const fixed=cGet('sw3_fixed_obl')||FIXED_OBL.map(o=>({...o}));
  fixed.splice(i,1);
  cSet('sw3_fixed_obl',fixed);
  renderProjObligations();renderProjTreasury();toast('Bill removed');
}
function saveFixedObl(i){
  const lbl=document.getElementById('obl-fe-lbl-'+i).value.trim();
  const amt=parseFloat(document.getElementById('obl-fe-amt-'+i).value);
  if(!lbl||isNaN(amt)||amt<0){toast('Enter a valid label and amount');return;}
  const fixed=cGet('sw3_fixed_obl')||FIXED_OBL.map(o=>({...o}));
  fixed[i]={label:lbl,amount:amt};
  cSet('sw3_fixed_obl',fixed);
  renderProjObligations();renderProjTreasury();toast('Bill updated');
}
function addObligation(){document.getElementById('obl-add-card').style.display='block';document.getElementById('obl-lbl').value='';document.getElementById('obl-amt').value='';}
function saveObligation(){
  const lbl=document.getElementById('obl-lbl').value.trim();
  const amt=parseFloat(document.getElementById('obl-amt').value);
  if(!lbl||!amt){toast('Enter label and amount');return;}
  const custom=cGet('sw3_custom_obl')||[];
  custom.push({label:lbl,amount:amt});
  cSet('sw3_custom_obl',custom);
  document.getElementById('obl-add-card').style.display='none';
  renderProjObligations();toast('Fixed bill added');
}
function removeObligation(i){
  const custom=cGet('sw3_custom_obl')||[];
  custom.splice(i,1);cSet('sw3_custom_obl',custom);
  renderProjObligations();toast('Removed');
}

function renderProjFees(){
  const el=document.getElementById('proj-fees');if(!el)return;
  const m=S.dashMonth||S.expMonth,y=S.dashYear||S.expYear,cur=S.dashCurrency||'NGN';
  const feeState=cGet(CK.schoolFees)||SCHOOL_FEES_DEFAULT.map((f,i)=>({...f,id:i}));
  const rem=feeState.filter(f=>!f.paid).reduce((s,f)=>s+f.amount,0);
  const paid=feeState.filter(f=>f.paid).reduce((s,f)=>s+f.amount,0);
  el.innerHTML=`
    <div class="g2" style="margin-bottom:10px">
      <div class="card card-sm" style="margin-bottom:0"><div class="clabel">Remaining</div><div class="cval-sm" style="color:var(--red)">${fmtCur(Math.round(rem),cur,m,y)}</div></div>
      <div class="card card-sm" style="margin-bottom:0"><div class="clabel">Paid So Far</div><div class="cval-sm" style="color:var(--accent)">${fmtCur(Math.round(paid),cur,m,y)}</div></div>
    </div>
    <div class="card">
      <div class="sh" style="margin-bottom:8px"><div class="clabel" style="margin-bottom:0">Fee Schedule</div><button class="btn btn-g btn-sm" onclick="openAddFeeModal()">+ Add</button></div>
      ${feeState.map((f,i)=>`
        <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--border)">
          <div style="${f.paid?'opacity:0.45':''}">
            <div style="font-size:0.78rem;font-weight:600">${f.label}</div>
            <div style="font-size:0.65rem;font-family:var(--mono);color:var(--text2)">${fmtCur(Math.round(f.amount),cur,m,y)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:7px">
            ${f.paid?'<span class="badge bg">Paid</span>':''}
            <div onclick="toggleFeePaid(${i})" style="width:36px;height:20px;border-radius:10px;background:${f.paid?'var(--accent)':'var(--border2)'};position:relative;cursor:pointer;flex-shrink:0"><div style="position:absolute;top:2px;${f.paid?'right:2px':'left:2px'};width:16px;height:16px;border-radius:50%;background:${f.paid?'var(--bg)':'var(--text3)'};transition:all 0.2s"></div></div>
            <button class="btn btn-g btn-sm" onclick="editFeeEntry(${i})" style="padding:2px 7px;font-size:0.62rem">Edit</button>
            <button class="txi-del" onclick="removeFeeEntry(${i})">×</button>
          </div>
        </div>`).join('')}
    </div>
    <div class="card" id="fee-edit-card" style="display:none">
      <div class="clabel" style="margin-bottom:10px" id="fee-edit-title">Add Fee</div>
      <div class="ig"><label class="ilabel">Label</label><input class="ifield" id="fee-lbl" type="text" placeholder="e.g. Term 3 – Jun '26"></div>
      <div class="ig"><label class="ilabel">Amount (₦)</label><input class="ifield" id="fee-amt" type="text" placeholder="0"></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button class="btn btn-p btn-sm" onclick="saveFeeEntry()">Save</button>
        <button class="btn btn-g btn-sm" onclick="document.getElementById('fee-edit-card').style.display='none'">Cancel</button>
      </div>
      <input type="hidden" id="fee-edit-idx" value="-1">
    </div>
  `;
}
function toggleFeePaid(idx){
  const fs=cGet(CK.schoolFees)||SCHOOL_FEES_DEFAULT.map((f,i)=>({...f,id:i}));
  fs[idx].paid=!fs[idx].paid;cSet(CK.schoolFees,fs);renderProjFees();
}
function openAddFeeModal(){
  document.getElementById('fee-edit-card').style.display='block';
  document.getElementById('fee-edit-title').textContent='Add Fee Entry';
  document.getElementById('fee-lbl').value='';
  document.getElementById('fee-amt').value='';
  document.getElementById('fee-edit-idx').value='-1';
}
function editFeeEntry(idx){
  const fs=cGet(CK.schoolFees)||SCHOOL_FEES_DEFAULT.map((f,i)=>({...f,id:i}));
  const f=fs[idx];if(!f) return;
  document.getElementById('fee-edit-card').style.display='block';
  document.getElementById('fee-edit-title').textContent='Edit Fee Entry';
  document.getElementById('fee-lbl').value=f.label;
  document.getElementById('fee-amt').value=f.amount;
  document.getElementById('fee-edit-idx').value=idx;
}
function saveFeeEntry(){
  const lbl=document.getElementById('fee-lbl').value.trim();
  const amt=parseFloat(document.getElementById('fee-amt').value);
  if(!lbl||!amt){toast('Enter label and amount');return;}
  const idx=parseInt(document.getElementById('fee-edit-idx').value);
  const fs=cGet(CK.schoolFees)||SCHOOL_FEES_DEFAULT.map((f,i)=>({...f,id:i}));
  if(idx>=0){fs[idx].label=lbl;fs[idx].amount=amt;}
  else{fs.push({label:lbl,amount:amt,paid:false,id:Date.now()});}
  cSet(CK.schoolFees,fs);
  document.getElementById('fee-edit-card').style.display='none';
  renderProjFees();toast(idx>=0?'Fee updated':'Fee added');
}
function removeFeeEntry(idx){
  const fs=cGet(CK.schoolFees)||SCHOOL_FEES_DEFAULT.map((f,i)=>({...f,id:i}));
  fs.splice(idx,1);cSet(CK.schoolFees,fs);renderProjFees();toast('Removed');
}
function renderProjHistory(){
  const el=document.getElementById('proj-history');if(!el)return;
  el.innerHTML=`
    <div class="card">
      <div style="display:grid;grid-template-columns:80px 1fr 1fr;gap:0;padding-bottom:7px;border-bottom:1px solid var(--border);margin-bottom:4px">
        <div style="font-size:0.62rem;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:var(--text3)">Month</div>
        <div style="font-size:0.62rem;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:var(--accent);text-align:right;cursor:pointer" onclick="histSort('income')">Income ↕</div>
        <div style="font-size:0.62rem;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:var(--red);text-align:right;cursor:pointer" onclick="histSort('expenses')">Expenses ↕</div>
      </div>
      <div id="hist-rows">${buildHistRows(getHistory())}</div>
    </div>`;
}
function buildHistRows(data){
  const cur=S.dashCurrency||'NGN';
  return data.map((d,i)=>{
    const rowKey=`${d.year}-${d.month}`;
    return`
    <div style="display:grid;grid-template-columns:80px 1fr 1fr;gap:0;padding:7px 0;border-bottom:1px solid var(--border);cursor:pointer;align-items:center" onclick="expandHistRow('${rowKey}',${d.year},${d.month})">
      <div style="font-size:0.75rem;font-weight:600">${d.label}</div>
      <div style="font-family:var(--mono);font-size:0.71rem;color:var(--accent);text-align:right">${fmtCur(d.income,cur,d.month,d.year)}</div>
      <div style="font-family:var(--mono);font-size:0.71rem;color:var(--red);text-align:right">${fmtCur(d.expenses,cur,d.month,d.year)}</div>
    </div>
    <div id="hist-detail-${rowKey}" style="display:none;background:var(--bg2);border-radius:6px;padding:8px 10px;margin:2px 0 4px;font-size:0.68rem"></div>
  `}).join('');
}
let _histDir={income:1,expenses:1};
function histSort(col){
  _histDir[col]*=-1;
  const sorted=[...getHistory()].sort((a,b)=>_histDir[col]*(b[col]-a[col]));
  const el=document.getElementById('hist-rows');
  if(el) el.innerHTML=buildHistRows(sorted);
}
function expandHistRow(rowKey,year,month){
  const el=document.getElementById('hist-detail-'+rowKey);
  if(!el) return;
  const showing=el.style.display!=='none'&&el.innerHTML!==''&&!el.innerHTML.includes('Loading');
  if(showing){el.style.display='none';return;}
  el.style.display='block';
  el.innerHTML='<div style="color:var(--text3);font-size:0.68rem;padding:4px">Loading…</div>';
  _loadHistDetail({year,month}, el);
}
async function _loadHistDetail(d, el){
  const m=d.month,y=d.year;
  const sid_=`${y}-${String(m).padStart(2,'0')}`;
  let txns=[],inc=[],invData={},cashData={};

  // Always render from cache first so the panel never stays on "Loading…"
  txns=cGet(CK.txns(m,y))||[];
  inc=cGet(CK.inc(m,y))||[];
  invData=cGet(CK.inv(m,y))||{};
  cashData=cGet(CK.cash(m,y))||{};
  _renderHistDetail(el,txns,inc,invData,cashData,m,y,sid_);

  // Then try to refresh from Firestore in the background
  if(!db||!navigator.onLine) return;
  try{
    const [txSnap,incSnap,invDoc,cashDoc]=await Promise.all([
      db.collection('transactions').where('year','==',y).where('month','==',m).get(),
      db.collection('income').where('year','==',y).where('month','==',m).get(),
      db.collection('investments').doc(sid_).get(),
      db.collection('cashBalances').doc(sid_).get()
    ]);
    const freshTxns=txSnap.docs.map(doc=>({id:doc.id,...doc.data()}));
    const freshInc=incSnap.docs.map(doc=>({id:doc.id,...doc.data()}));
    const freshInv=invDoc.exists?invDoc.data():invData;
    const freshCash=cashDoc.exists?cashDoc.data():cashData;
    if(freshTxns.length) cSet(CK.txns(m,y),freshTxns);
    if(freshInc.length) cSet(CK.inc(m,y),freshInc);
    // Update sw3_history totals to match live data
    const liveExp=freshTxns.reduce((s,t)=>s+(t.amount||0),0);
    const liveInc=freshInc.reduce((s,i)=>s+(i.amount||0),0);
    if(liveExp||liveInc){
      const hist=cGet('sw3_history')||[];
      const hi=hist.findIndex(h=>h.year===y&&h.month===m);
      if(hi>=0){hist[hi].expenses=liveExp;hist[hi].income=liveInc;cSet('sw3_history',hist);}
    }
    // Re-render with fresh data if panel is still open
    if(el.style.display!=='none'){
      _renderHistDetail(el,freshTxns,freshInc,freshInv,freshCash,m,y,sid_);
    }
  }catch(e){
    // Already rendered from cache above — nothing more to do
    console.warn('histDetail fetch error',e);
  }
}
function _renderHistDetail(el,txns,inc,invData,cashData,m,y,sid_){
  const cur=S.dashCurrency==='NATIVE'?'NATIVE':S.dashCurrency||'NGN';
  const USD_PLATS=['Risevest','Trove','Bamboo'];
  const totalExp=txns.reduce((s,t)=>s+(t.amount||0),0);
  const totalInc=inc.reduce((s,i)=>s+(i.amtNGN||i.amount||0),0);
  const cats={};txns.forEach(t=>{cats[t.category]=(cats[t.category]||0)+(t.amount||0);});
  const incCats={};inc.forEach(i=>{incCats[i.category]=(incCats[i.category]||0)+(i.amtNGN||i.amount||0);});
  const expRows=Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([c,v])=>`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:0.7rem;color:var(--text2)">${CAT_ICONS[c]||''} ${c}</span>
      <div style="text-align:right;flex-shrink:0;margin-left:6px">
        <span style="font-family:var(--mono);font-size:0.7rem;color:var(--red)">${fmtCur(v,cur,m,y)}</span>
        <span style="font-size:0.58rem;color:var(--text3);margin-left:4px">${totalExp>0?((v/totalExp)*100).toFixed(1)+'%':''}</span>
      </div>
    </div>`).join('');
  const incRows=Object.entries(incCats).sort((a,b)=>b[1]-a[1]).map(([c,v])=>`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:0.7rem;color:var(--text2)">${c}</span>
      <span style="font-family:var(--mono);font-size:0.7rem;color:var(--accent)">${fmtCur(v,cur,m,y)}</span>
    </div>`).join('');
  const cashAccounts=getCashAccounts().concat(['Union']).filter((a,i,arr)=>arr.indexOf(a)===i);
  const cashRows=cashAccounts.filter(a=>cashData[a]!==undefined).map(a=>`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:0.7rem;color:var(--text2)">${a}</span>
      <span style="font-family:var(--mono);font-size:0.7rem;color:var(--blue)">${isUSDCashAccount(a)?(cur==='NATIVE'?'$'+cashData[a].toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):fmtCur(cashData[a]*(getFxRates(m,y).USD||1600),cur,m,y)):fmtCur(cashData[a],cur,m,y)}</span>
    </div>`).join('');
  const invRows=PLATFORMS.filter(p=>invData[p.key]!==undefined&&invData[p.key]!==0).map(p=>`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:0.7rem;color:var(--text2)">${p.label}</span>
      <span style="font-family:var(--mono);font-size:0.7rem;color:var(--gold)">${fmtCur(invData[p.key],cur,m,y)}</span>
    </div>`).join('');
  const cashInputs=cashAccounts.map(a=>`
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
      <label style="font-size:0.62rem;color:var(--text2);width:68px;flex-shrink:0">${a}</label>
      <input class="ifield" type="text" id="hd-cash-${sid_}-${a}" placeholder="0" value="${cashData[a]!==undefined?cashData[a]:''}" style="padding:4px 8px;font-size:0.72rem;font-family:var(--mono)">
    </div>`).join('');
  const invInputs=PLATFORMS.map(p=>{
    const isUSD=USD_PLATS.includes(p.key);
    const dispCur=isUSD?'USD':'₦';
    return`<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
      <label style="font-size:0.62rem;color:var(--text2);width:88px;flex-shrink:0">${p.label} <span style="color:var(--text3)">(${dispCur})</span></label>
      <input class="ifield" type="text" id="hd-inv-${sid_}-${p.key}" placeholder="0" value="${invData[p.key]!==undefined?invData[p.key]:''}" style="padding:4px 8px;font-size:0.72rem;font-family:var(--mono)">
    </div>`;}).join('');
  const editId=`hd-edit-${sid_}`;
  const noBalances=!cashRows&&!invRows;
  el.innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:start">
      <div>
        <div style="font-size:0.58rem;font-weight:700;color:var(--accent);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.06em">Income — ${fmtCur(totalInc,cur,m,y)}</div>
        ${incRows||'<div style="font-size:0.68rem;color:var(--text3);padding:4px 0">—</div>'}
      </div>
      <div>
        <div style="font-size:0.58rem;font-weight:700;color:var(--red);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.06em">Expenses — ${fmtCur(totalExp,cur,m,y)}</div>
        ${expRows||'<div style="font-size:0.68rem;color:var(--text3);padding:4px 0">—</div>'}
      </div>
    </div>
    <div style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <div style="font-size:0.58rem;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em">Cash &amp; Investments</div>
        <button style="background:none;border:1px solid var(--border);border-radius:4px;color:var(--accent);font-size:0.58rem;font-weight:700;padding:2px 8px;cursor:pointer;font-family:var(--font)" onclick="_toggleHistBalEdit('${editId}')">✎ Edit</button>
      </div>
      ${noBalances?'<div style="font-size:0.68rem;color:var(--text3);padding:2px 0">No balances recorded for this month.</div>':''}
      ${cashRows?`<div style="font-size:0.58rem;font-weight:700;color:var(--blue);margin-bottom:3px;text-transform:uppercase;letter-spacing:0.04em">Cash</div>${cashRows}`:''}
      ${invRows?`<div style="font-size:0.58rem;font-weight:700;color:var(--gold);margin-top:6px;margin-bottom:3px;text-transform:uppercase;letter-spacing:0.04em">Investments</div>${invRows}`:''}
      <div id="${editId}" style="display:none;margin-top:10px;background:var(--bg3);border-radius:6px;padding:10px">
        <div style="font-size:0.6rem;font-weight:700;color:var(--blue);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.06em">Cash Balances</div>
        ${cashInputs}
        <div style="font-size:0.6rem;font-weight:700;color:var(--gold);margin-top:10px;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.06em">Investment Balances</div>
        ${invInputs}
        <div style="display:flex;gap:6px;margin-top:10px">
          <button class="btn btn-p" style="flex:1;font-size:0.72rem;padding:7px" onclick="_saveHistBalances('${sid_}',${m},${y})">Save Balances</button>
          <button class="btn btn-g" style="font-size:0.72rem;padding:7px" onclick="document.getElementById('${editId}').style.display='none'">Cancel</button>
        </div>
      </div>
    </div>`;
}
function _toggleHistBalEdit(editId){
  const el=document.getElementById(editId);
  if(!el) return;
  el.style.display=el.style.display==='none'?'block':'none';
}
async function _saveHistBalances(sid_,m,y){
  const cashAccounts=getCashAccounts().concat(['Union']).filter((a,i,arr)=>arr.indexOf(a)===i);
  const USD_PLATS=['Risevest','Trove','Bamboo'];
  // Build cash doc
  const cashDoc={month:m,year:y};
  cashAccounts.forEach(a=>{
    const el=document.getElementById(`hd-cash-${sid_}-${a}`);
    if(!el) return;
    const v=el.value.trim();
    if(v!=='') cashDoc[a]=parseFloat(v)||0;
  });
  // Build inv doc
  const invDoc={month:m,year:y};
  PLATFORMS.forEach(p=>{
    const el=document.getElementById(`hd-inv-${sid_}-${p.key}`);
    if(!el) return;
    const v=el.value.trim();
    if(v!=='') invDoc[p.key]=parseFloat(v)||0;
  });
  try{
    await Promise.all([
      db.collection('cashBalances').doc(sid_).set(cashDoc,{merge:true}),
      db.collection('investments').doc(sid_).set(invDoc,{merge:true})
    ]);
    cSet(CK.cash(m,y),cashDoc);
    cSet(CK.inv(m,y),invDoc);
    toast('Balances saved');
    setSyncStatus('synced');
    // Refresh current month if it matches
    if(m===S.expMonth&&y===S.expYear){
      S.cash=cashDoc;S.investments=invDoc;
      renderCashPage();renderInvestments();renderDashboard();
    }
    // Collapse edit panel and reload detail
    const editId=`hd-edit-${sid_}`;
    const editEl=document.getElementById(editId);
    if(editEl) editEl.style.display='none';
    const rowKey=`${y}-${m}`;
    const detailEl=document.getElementById(`hist-detail-${rowKey}`);
    if(detailEl) _loadHistDetail({month:m,year:y},detailEl);
  }catch(e){
    toast('Error: '+e.message);setSyncStatus('error');
  }
}

// ══════════════════════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════════════════════
function renderSettings(){renderSettData();renderSettBudget();renderSettExport();}
function settTab(tab,btn){['data','budget','export'].forEach(t=>{document.getElementById('sett-'+t).style.display=t===tab?'block':'none';});btn.closest('.tabs').querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));btn.classList.add('active');}
function renderSettBudget(){
  const total=Object.values(S.budgets).reduce((s,v)=>s+(v||0),0);
  const prevM=S.expMonth===1?12:S.expMonth-1,prevY=S.expMonth===1?S.expYear-1:S.expYear;
  const hasPrevBudget=!!cGet(CK.budgets(prevM,prevY));
  const prevTxnsList=cGet(CK.txns(prevM,prevY))||[];
  const prevCatSpend={};prevTxnsList.forEach(t=>{prevCatSpend[t.category]=(prevCatSpend[t.category]||0)+(t.amount||0);});
  document.getElementById('sett-budget').innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-size:0.68rem;color:var(--text2)">Budget for ${MONTHS[S.expMonth-1]} ${S.expYear}</div>
      ${hasPrevBudget?`<button class="btn btn-g btn-sm" onclick="copyLastBudget()">↩ Copy budget ${MS[prevM-1]}</button>`:''}
    </div>
    <label style="display:flex;align-items:center;gap:6px;font-size:0.66rem;color:var(--text2);margin-bottom:12px;cursor:pointer">
      <input type="checkbox" id="budget-rollover-toggle" ${getBudgetRollover()?'checked':''} onchange="setBudgetRollover(this.checked)">
      Auto-carry this month's categories into new months with no budget set yet
    </label>
    ${getAllCats().map(c=>{const k=ck(c);const prevSpend=prevCatSpend[c]||0;return`<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border)"><span style="flex:1;font-size:0.72rem;color:var(--text2)">${CAT_ICONS[c]||''} ${c}</span>${prevSpend?`<span style="font-size:0.58rem;color:var(--text3);font-family:var(--mono);cursor:pointer;white-space:nowrap" onclick="document.getElementById('b-${k}').value=${prevSpend};updateBudgetTotal()" title="Copy last month actual">↩${fN(prevSpend).replace('₦','')}</span>`:'<span style="width:32px"></span>'}<input class="ifield" type="text" id="b-${k}" placeholder="0" value="${S.budgets[k]||''}" style="width:100px;flex-shrink:0;font-size:0.76rem;padding:5px 8px" oninput="updateBudgetTotal()"></div>`;}).join('')}
    <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid var(--border);margin-bottom:12px;font-weight:700;font-size:0.84rem"><span>Total</span><span id="budget-total-display" style="font-family:var(--mono);color:var(--accent)">${fN(total)}</span></div>
    <div style="display:flex;gap:8px;margin-bottom:16px">
      <button class="btn btn-g btn-sm" onclick="copyActualSpend()">↩ Copy all actual spend</button>
      <button class="btn btn-p" style="flex:1" onclick="saveBudget()">Save Budget</button>
    </div>
    <div style="border-top:1px solid var(--border);padding-top:14px">
      <div style="font-size:0.7rem;font-weight:700;color:var(--text2);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.06em">Manage Categories &amp; Actual Expenses</div>
      <div style="font-size:0.66rem;color:var(--text3);margin-bottom:10px">Tap a category to expand its actual expense lines. Built-in categories cannot be deleted (but can be merged). Custom categories with transactions must be merged before removal.</div>
      <div id="cat-payee-accordion">
        ${getAllCats().map((c)=>{
          const isCustom=!_BASE_CATS.includes(c);
          const allPayees=[...(CAT_LINES[c]||[]),...(S.customExpLines[c]||[])].filter(p=>{const removed=(S.customExpLines['__removed__']||{})[c]||[];return!removed.includes(p);});
          return`<div class="cat-acc-item" id="cat-acc-${c.replace(/[^a-z0-9]/gi,'_')}">
            <div class="cat-acc-hdr" onclick="toggleCatAcc('${c.replace(/'/g,"\\'")}')">
              <span style="font-size:0.76rem;flex:1">${CAT_ICONS[c]||'📦'} ${c}</span>
              <span style="font-size:0.62rem;color:var(--text3);margin-right:8px">${allPayees.length} expense${allPayees.length!==1?'s':''}</span>
              ${isCustom?`<button class="cat-remove-btn" onclick="event.stopPropagation();removeCustomCat('${c.replace(/'/g,"\\'")}')">×</button>`:''}
              <span class="cat-acc-chevron">›</span>
            </div>
            <div class="cat-acc-body" style="display:none">
              <div class="cat-acc-payees" id="cat-acc-payees-${c.replace(/[^a-z0-9]/gi,'_')}">
                ${allPayees.length?allPayees.map(p=>`
                  <div class="cat-acc-payee-row" id="cat-payee-row-${c.replace(/[^a-z0-9]/gi,'_')}-${p.replace(/[^a-z0-9]/gi,'_')}">
                    <span class="cat-payee-name" id="cat-payee-lbl-${c.replace(/[^a-z0-9]/gi,'_')}-${p.replace(/[^a-z0-9]/gi,'_')}">${p}</span>
                    <div style="display:flex;gap:4px">
                      <button class="btn btn-g btn-sm" style="padding:2px 7px;font-size:0.66rem" onclick="startEditPayee('${c.replace(/'/g,"\\'")}','${p.replace(/'/g,"\\'")}')">Edit</button>
                      <button class="txi-del" onclick="removePayeeLine('${c.replace(/'/g,"\\'")}','${p.replace(/'/g,"\\'")}','${(CAT_LINES[c]||[]).includes(p)?'builtin':'custom'}')">×</button>
                    </div>
                  </div>`).join(''):'<div style="font-size:0.7rem;color:var(--text3);padding:6px 0">No actual expenses yet.</div>'}
              </div>
              <div style="display:flex;gap:6px;margin-top:8px;align-items:center">
                <input class="ifield" id="new-payee-${c.replace(/[^a-z0-9]/gi,'_')}" placeholder="Add actual expense…" style="flex:1;font-size:0.74rem;padding:5px 8px">
                <button class="btn btn-p btn-sm" style="font-size:0.72rem" onclick="addPayeeToCategory('${c.replace(/'/g,"\\'")}')">+ Add</button>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>
      <div style="border-top:1px solid var(--border);padding-top:10px;margin-top:10px">
        <div style="font-size:0.7rem;font-weight:700;color:var(--text2);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.06em">Add Category</div>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="emoji-trigger" id="new-cat-emoji" onclick="openEmojiPicker(this,e=>document.getElementById('new-cat-emoji').textContent=e)" title="Pick emoji">📦</button>
          <input class="ifield" id="new-cat-input" placeholder="New category name" style="flex:1;font-size:0.76rem;padding:6px 10px">
          <button class="btn btn-p btn-sm" onclick="addCustomCat()">+ Add</button>
        </div>
      </div>
    </div>
    <div style="border-top:1px solid var(--border);padding-top:14px;margin-top:4px">
      <div style="font-size:0.7rem;font-weight:700;color:var(--text2);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.06em">Merge Categories</div>
      <div class="csub" style="margin-bottom:10px">Reassign all transactions from one category into another, and combine their budgets across all months.</div>
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center;margin-bottom:8px">
        <div><label class="ilabel">From (source)</label><select class="sfield" id="merge-from" style="font-size:0.75rem">${getAllCats().map(c=>`<option>${c}</option>`).join('')}</select></div>
        <div style="font-size:1rem;color:var(--text3);padding-top:18px">→</div>
        <div><label class="ilabel">Into (target)</label><select class="sfield" id="merge-into" style="font-size:0.75rem">${getAllCats().map(c=>`<option>${c}</option>`).join('')}</select></div>
      </div>
      <button class="btn btn-d btn-full" onclick="openMergeCatModal()" style="font-size:0.76rem">Merge & Reassign</button>
    </div>
    <div style="border-top:1px solid var(--border);padding-top:14px;margin-top:14px">
      <div style="font-size:0.7rem;font-weight:700;color:var(--text2);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.06em">Auto-Categorization Rules</div>
      <div class="csub" style="margin-bottom:10px">When an expense name contains the text below, its category is filled in automatically (first match wins, overrides the built-in suggestions). Applies everywhere, in both design modes.</div>
      ${getRules().map((r,i)=>`<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="flex:1;font-size:0.74rem">"${esc(r.match)}" <span style="color:var(--text3)">→</span> ${CAT_ICONS[r.category]||''} ${esc(r.category)}</span>
        <button class="txi-del" onclick="deleteRule(${i})">×</button>
      </div>`).join('')||'<div style="font-size:0.7rem;color:var(--text3);padding:2px 0 6px">No rules yet.</div>'}
      <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:6px;margin-top:10px;align-items:center">
        <input class="ifield" id="rule-match" placeholder="Name contains…" style="font-size:0.74rem;padding:6px 10px">
        <select class="sfield" id="rule-cat" style="font-size:0.74rem;padding:6px 10px">${getAllCats().map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
        <button class="btn btn-p btn-sm" onclick="addRule()">+ Add</button>
      </div>
    </div>`;
  setTimeout(()=>{initNumInputs(document.getElementById('sett-budget'));},0);
}
function copyLastBudget(){
  const prevM=S.expMonth===1?12:S.expMonth-1,prevY=S.expMonth===1?S.expYear-1:S.expYear;
  const prev=cGet(CK.budgets(prevM,prevY));
  if(!prev){toast('No budget found for last month');return;}
  getAllCats().forEach(c=>{const k=ck(c);const el=document.getElementById('b-'+k);if(el)el.value=prev[k]||'';});
  toast(`Copied from ${MONTHS[prevM-1]} — remember to save`);
}
function addCustomCat(){
  const input=document.getElementById('new-cat-input');
  if(!input) return;
  const name=input.value.trim();
  if(!name){toast('Enter a category name');return;}
  if(getAllCats().map(c=>c.toLowerCase()).includes(name.toLowerCase())){toast('Category already exists');return;}
  // Store chosen emoji in CAT_ICONS
  const emojiBtn=document.getElementById('new-cat-emoji');
  const emoji=emojiBtn?emojiBtn.textContent.trim():'📦';
  CAT_ICONS[name]=emoji;
  if(emojiBtn) emojiBtn.textContent='📦'; // reset
  const cats=getCustomCats();cats.push(name);saveCustomCats(cats);
  input.value='';
  // Refresh expense modal cat select if open
  const catSel=document.getElementById('e-cat');
  if(catSel) catSel.innerHTML=getAllCats().map(c=>`<option value="${c}">${CAT_ICONS[c]||''} ${c}</option>`).join('');
  renderSettBudget();toast('Category added: '+name);
}
function removeCustomCat(name){
  // Check if this category has any transactions in any cached month
  const allKeys=Object.keys(localStorage).filter(k=>k.startsWith('sw3_txns_'));
  let txnCount=0;
  allKeys.forEach(k=>{const arr=cGet(k)||[];txnCount+=arr.filter(t=>t.category===name).length;});
  if(txnCount>0){
    // Has history — must merge first. Populate merge-from and open merge modal
    const fromEl=document.getElementById('merge-from');
    const intoEl=document.getElementById('merge-into');
    if(fromEl){fromEl.value=name;}
    if(intoEl){
      // Pick a different category as default target
      const others=getAllCats().filter(c=>c!==name);
      if(others.length) intoEl.value=others[0];
    }
    toast(`"${name}" has ${txnCount} transaction${txnCount!==1?'s':''} — merge it first`);
    openMergeCatModal();
    return;
  }
  if(!confirm('Remove category "'+name+'"?')) return;
  const cats=getCustomCats().filter(c=>c!==name);saveCustomCats(cats);
  const catSel=document.getElementById('e-cat');
  if(catSel) catSel.innerHTML=getAllCats().map(c=>`<option value="${c}">${CAT_ICONS[c]||''} ${c}</option>`).join('');
  renderSettBudget();toast('Category removed');
}
function toggleCatAcc(cat){
  const key=cat.replace(/[^a-z0-9]/gi,'_');
  const item=document.getElementById('cat-acc-'+key);
  if(!item) return;
  const body=item.querySelector('.cat-acc-body');
  const isOpen=item.classList.contains('open');
  item.classList.toggle('open',!isOpen);
  body.style.display=isOpen?'none':'block';
}
function addPayeeToCategory(cat){
  const key=cat.replace(/[^a-z0-9]/gi,'_');
  const inp=document.getElementById('new-payee-'+key);
  if(!inp) return;
  const name=inp.value.trim();
  if(!name){toast('Enter a payee name');return;}
  const existing=[...(CAT_LINES[cat]||[]),...(S.customExpLines[cat]||[])];
  if(existing.map(p=>p.toLowerCase()).includes(name.toLowerCase())){toast('Actual expense already exists in this category');return;}
  if(!S.customExpLines[cat]) S.customExpLines[cat]=[];
  S.customExpLines[cat].push(name);
  cSet(CK.customLines,S.customExpLines);
  inp.value='';
  renderSettBudget();
  // Re-open this category after re-render
  setTimeout(()=>{ const el=document.getElementById('cat-acc-'+key); if(el&&!el.classList.contains('open')) toggleCatAcc(cat); },0);
  toast(`Added "${name}" to ${cat}`);
}
function startEditPayee(cat,payee){
  const key=cat.replace(/[^a-z0-9]/gi,'_');
  const pkey=payee.replace(/[^a-z0-9]/gi,'_');
  const lblEl=document.getElementById('cat-payee-lbl-'+key+'-'+pkey);
  const rowEl=document.getElementById('cat-payee-row-'+key+'-'+pkey);
  if(!lblEl||!rowEl) return;
  const inp=document.createElement('input');
  inp.className='cat-payee-edit-input';
  inp.value=payee;
  const src=(CAT_LINES[cat]||[]).includes(payee)?'builtin':'custom';
  const saveBtn=document.createElement('button');
  saveBtn.className='btn btn-p btn-sm';saveBtn.style.cssText='padding:2px 7px;font-size:0.66rem;margin-left:4px';saveBtn.textContent='Save';
  const cancelBtn=document.createElement('button');
  cancelBtn.className='btn btn-g btn-sm';cancelBtn.style.cssText='padding:2px 7px;font-size:0.66rem;margin-left:4px';cancelBtn.textContent='✕';
  saveBtn.onclick=()=>commitEditPayee(cat,payee,inp.value.trim(),src);
  cancelBtn.onclick=()=>renderSettBudget();
  rowEl.innerHTML='';
  rowEl.appendChild(inp);rowEl.appendChild(saveBtn);rowEl.appendChild(cancelBtn);
  inp.focus();inp.select();
}
function commitEditPayee(cat,oldPayee,newPayee,src){
  if(!newPayee){toast('Payee name cannot be empty');return;}
  if(newPayee===oldPayee){renderSettBudget();return;}
  // Remove old, add new in the correct list
  if(src==='builtin'){
    CAT_LINES[cat]=(CAT_LINES[cat]||[]).map(p=>p===oldPayee?newPayee:p);
    // Persist removal of old builtin name
    if(!S.customExpLines['__removed__']) S.customExpLines['__removed__']={};
    if(!S.customExpLines['__removed__'][cat]) S.customExpLines['__removed__'][cat]=[];
    if(!S.customExpLines['__removed__'][cat].includes(oldPayee)) S.customExpLines['__removed__'][cat].push(oldPayee);
    if(!S.customExpLines[cat]) S.customExpLines[cat]=[];
    if(!S.customExpLines[cat].includes(newPayee)) S.customExpLines[cat].push(newPayee);
  } else {
    S.customExpLines[cat]=(S.customExpLines[cat]||[]).map(p=>p===oldPayee?newPayee:p);
  }
  cSet(CK.customLines,S.customExpLines);
  const key=cat.replace(/[^a-z0-9]/gi,'_');
  renderSettBudget();
  setTimeout(()=>{ const el=document.getElementById('cat-acc-'+key); if(el&&!el.classList.contains('open')) toggleCatAcc(cat); },0);
  toast(`Renamed to "${newPayee}"`);
}
function renderPayeeLines(){} // kept as no-op for any stale call sites
function addPayeeLine(){} // kept as no-op
function removePayeeLine(cat,payee,src){
  if(src==='builtin'){
    // Remove from CAT_LINES in memory
    CAT_LINES[cat]=(CAT_LINES[cat]||[]).filter(p=>p!==payee);
    // Also persist the removal so it survives re-renders
    if(!S.customExpLines['__removed__']) S.customExpLines['__removed__']={};
    if(!S.customExpLines['__removed__'][cat]) S.customExpLines['__removed__'][cat]=[];
    if(!S.customExpLines['__removed__'][cat].includes(payee)) S.customExpLines['__removed__'][cat].push(payee);
    cSet(CK.customLines,S.customExpLines);
  } else {
    if(!S.customExpLines[cat]) return;
    S.customExpLines[cat]=S.customExpLines[cat].filter(p=>p!==payee);
    if(!S.customExpLines[cat].length) delete S.customExpLines[cat];
    cSet(CK.customLines,S.customExpLines);
  }
  renderPayeeLines();
  toast(`Removed "${payee}"`);
}
function updateBudgetTotal(){
  const total=getAllCats().reduce((s,c)=>{const v=parseFloat(document.getElementById('b-'+ck(c))?.value)||0;return s+v;},0);
  const el=document.getElementById('budget-total-display');
  if(el) el.textContent=fN(total);
}
function copyActualSpend(){
  const prevM=S.expMonth===1?12:S.expMonth-1,prevY=S.expMonth===1?S.expYear-1:S.expYear;
  const prevTxns=cGet(CK.txns(prevM,prevY))||[];
  const prevSpend={};prevTxns.forEach(t=>{prevSpend[t.category]=(prevSpend[t.category]||0)+(t.amount||0);});
  getAllCats().forEach(c=>{const el=document.getElementById('b-'+ck(c));if(el&&prevSpend[c])el.value=Math.round(prevSpend[c]);});
  updateBudgetTotal();
  toast('Copied actual spend from '+MS[prevM-1]);
}
async function saveBudget(){
  const cats={};getAllCats().forEach(c=>{const k=ck(c);const el=document.getElementById('b-'+k);const v=el?parseFloat(el.value):NaN;cats[k]=isNaN(v)?0:v;});setSyncStatus('syncing');
  try{await db.collection('budgets').doc(sid(S.expMonth,S.expYear)).set({month:S.expMonth,year:S.expYear,categories:cats},{merge:true});S.budgets={...DEF_BUDGETS,...cats};cSet(CK.budgets(S.expMonth,S.expYear),S.budgets);toast('Budget saved');setSyncStatus('synced');renderDashboard();}
  catch(e){toast('Error saving budget');setSyncStatus('error');}
}

function renderSettExport(){
  document.getElementById('sett-export').innerHTML=`
    <div class="exp-card"><div class="exp-card-title">Full Data Backup (JSON)</div><div class="exp-card-sub">Export everything — transactions, income, cash, investments, debtors, history — as a JSON file you can re-import later.</div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-p btn-sm" onclick="exportFullBackup()">↓ Download Backup JSON</button><button class="btn btn-g btn-sm" onclick="document.getElementById('backup-file-input').click()">↑ Restore from Backup</button></div><input type="file" id="backup-file-input" accept=".json,application/json" style="display:none" onchange="importFullBackup(event)"></div>
    <div class="exp-card"><div class="exp-card-title">Export All Data</div><div class="exp-card-sub">Excel: one budget-workbook sheet per month — day-by-day expense matrix with totals &amp; budget, cash accounts, investments and summaries. CSV: flat transaction list.</div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-exp btn-sm" onclick="exportAll('csv')">↓ CSV</button><button class="btn btn-exp btn-sm" onclick="exportAll('xlsx')">↓ Excel</button></div></div>
    <div class="exp-card"><div class="exp-card-title">Export by Month</div><div class="exp-card-sub">Select a month and export just that month — Excel uses the budget-workbook layout (expenses × days, cash, investments, summaries).</div>
    <div class="gform" style="margin-bottom:10px">
      <div class="ig"><label class="ilabel">Month</label><select class="sfield" id="exp-mo-sel">${Array.from({length:12},(_,i)=>i+1).reverse().map(m=>`<option value="${m}">${MONTHS[m-1]}</option>`).join('')}</select></div>
      <div class="ig"><label class="ilabel">Year</label><select class="sfield" id="exp-yr-sel"><option value="2026">2026</option><option value="2025">2025</option><option value="2024">2024</option></select></div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-exp btn-sm" onclick="exportMonth('csv')">↓ CSV</button><button class="btn btn-exp btn-sm" onclick="exportMonth('xlsx')">↓ Excel</button></div></div>
    <div class="exp-card"><div class="exp-card-title">Balance Audit</div><div class="exp-card-sub">Recomputes each cash account for the current month from records (opening + income − expenses ± transfers ± loan/debtor/investment flows) and flags any gap against the stored balance. Manual balance edits will show as differences.</div><button class="btn btn-p btn-sm" onclick="runBalanceAudit()">Run Audit</button><div id="audit-result" style="margin-top:10px"></div></div>
  `;
}

// ── BALANCE AUDIT ──────────────────────────────────────────────────────────
async function runBalanceAudit(){
  const m=S.dashMonth,y=S.dashYear;
  const out=document.getElementById('audit-result');
  if(out)out.innerHTML='<div class="csub">Auditing '+MONTHS[m-1]+' '+y+'…</div>';
  // Push any locally-stranded ledger entries up first, so running the audit on
  // the device that HAS the entry (e.g. the phone) propagates it to Firestore
  // for every other device.
  try{await _syncCashLedgerUp(m,y);}catch(e){}
  const prevM=m===1?12:m-1,prevY=m===1?y-1:y;
  async function fetchMonth(col){
    try{const s=await db.collection(col).where('year','==',y).where('month','==',m).get();return s.docs.map(d=>({...d.data(),id:d.id}));}
    catch(e){return null;}
  }
  let txns=await fetchMonth('transactions');if(!txns)txns=cGet(CK.txns(m,y))||[];
  let incs=await fetchMonth('income');if(!incs)incs=cGet(CK.inc(m,y))||[];
  let xfrs=await fetchMonth('transfers');if(!xfrs)xfrs=cGet(CK.xfr(m,y))||[];
  let prevCash=null;
  try{const d=await db.collection('cashBalances').doc(sid(prevM,prevY)).get();prevCash=d.exists?d.data():null;}catch(e){}
  if(!prevCash)prevCash=cGet(CK.cash(prevM,prevY))||{};
  let curCash=null;
  try{const d=await db.collection('cashBalances').doc(sid(m,y)).get();curCash=d.exists?d.data():null;}catch(e){}
  if(!curCash)curCash=cGet(CK.cash(m,y))||S.cash||{};
  // Cash ledger — the ONLY record of loan, debtor and investment-liquidation
  // cash movements (these never hit the income/expense/transfer collections).
  // Without them the audit ignores real inflows/outflows and reports false
  // gaps. Merge Firestore (cross-device) with the local cache (offline-created
  // entries not yet synced), deduped by ts|bank|delta|source.
  let ledger=[];
  try{const d=await db.collection('cashLedger').doc(sid(m,y)).get();if(d.exists&&Array.isArray(d.data().entries))ledger=d.data().entries.slice();}catch(e){}
  {
    const local=cGet(`sw3_cash_ledger_${y}_${m}`)||[];
    const seen=new Set(ledger.map(e=>`${e.ts}|${e.bank}|${e.delta}|${e.source}`));
    local.forEach(e=>{const k=`${e.ts}|${e.bank}|${e.delta}|${e.source}`;if(!seen.has(k)){ledger.push(e);seen.add(k);}});
  }
  // Only loan/debtor/investment sources are added from the ledger; income,
  // expense and transfers are already counted via the collections above, so
  // including them here would double-count.
  const LEDGER_ONLY_SRC=new Set(['loan-proceeds','loan-repayment','loan-edit-adjust','debt-add','debt-edit-adjust','investment-liquidation']);
  const accounts=getCashAccounts();
  const rows=accounts.map(b=>{
    const open=prevCash[b]||0;
    const incSum=incs.filter(i=>i.bank===b).reduce((s,i)=>s+(i.amount||0),0);
    const expSum=txns.filter(t=>t.bank===b).reduce((s,t)=>s+(t.amount||0),0);
    const xfrOut=xfrs.filter(x=>x.from===b).reduce((s,x)=>s+(x.amount||0),0);
    const xfrIn=xfrs.filter(x=>x.to===b).reduce((s,x)=>s+((x.toAmt!=null?x.toAmt:x.amount)||0),0);
    // Net loan/debtor/investment cash flow (signed: proceeds/liquidations +, repayments/disbursements −)
    const otherSum=Math.round(ledger.filter(e=>e.bank===b&&LEDGER_ONLY_SRC.has(e.source)).reduce((s,e)=>s+(e.delta||0),0)*100)/100;
    const expected=Math.round((open+incSum-expSum-xfrOut+xfrIn+otherSum)*100)/100;
    const actual=curCash[b]||0;
    const diff=Math.round((actual-expected)*100)/100;
    return{b,open,incSum,expSum,xfrOut,xfrIn,otherSum,expected,actual,diff};
  });
  const fmt=(b,v)=>isUSDCashAccount(b)?'$'+Number(v).toLocaleString('en-US',{maximumFractionDigits:2}):fN(Math.round(v));
  if(out)out.innerHTML=rows.map(r=>{
    const ok=Math.abs(r.diff)<1;
    return`<div style="padding:8px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:0.76rem;font-weight:600">${r.b}</span>
        <span class="badge ${ok?'bg':'br'}">${ok?'✓ Reconciled':'Δ '+fmt(r.b,r.diff)}</span>
      </div>
      <div style="font-size:0.62rem;color:var(--text2);font-family:var(--mono);margin-top:3px">
        Open ${fmt(r.b,r.open)} + Inc ${fmt(r.b,r.incSum)} − Exp ${fmt(r.b,r.expSum)} − Out ${fmt(r.b,r.xfrOut)} + In ${fmt(r.b,r.xfrIn)}${r.otherSum?` ${r.otherSum<0?'−':'+'} L/D/Inv ${fmt(r.b,Math.abs(r.otherSum))}`:''} = ${fmt(r.b,r.expected)} · Stored: ${fmt(r.b,r.actual)}
      </div>
      ${ok?'':`<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"><button class="btn btn-g btn-sm" onclick="auditFix('${r.b}',${r.expected},${m},${y})">Set to computed ${fmt(r.b,r.expected)}</button><button class="btn btn-g btn-sm" onclick="showCashLedger('${r.b}',${m},${y})">View ledger</button></div>`}
    </div>`;}).join('')+
    '<div class="csub" style="margin-top:8px">Loan, debtor and investment-liquidation flows are now included (via the cash ledger). Remaining differences are usually manual balance edits, or loan/debtor/investment activity from before the ledger existed (pre-v3.14.79).</div>';
}
function auditFix(b,val,m,y){
  if(!confirm(`Set ${b} balance to the computed value?`))return;
  const cash={...(cGet(CK.cash(m,y))||S.cash||{})};
  cash[b]=val;
  if(m===S.cashMonth&&y===S.cashYear)S.cash=cash;
  if(m===S.dashMonth&&y===S.dashYear)S.cash=cash;
  cSet(CK.cash(m,y),cash);
  if(db)db.collection('cashBalances').doc(sid(m,y)).set({...cash,month:m,year:y},{merge:true}).catch(()=>{});
  renderCashPage();renderDashboard();toast(`${b} balance updated`);
  runBalanceAudit();
}
function showCashLedger(bank,m,y){
  _renderCashLedger(bank,m,y);
  // Merge in any remote-only entries (logged from another device) then
  // re-render if anything new was found.
  if(db){
    db.collection('cashLedger').doc(sid(m,y)).get().then(doc=>{
      if(!doc.exists) return;
      const remote=doc.data()?.entries;
      if(!Array.isArray(remote)||!remote.length) return;
      const key=`sw3_cash_ledger_${y}_${m}`;
      const local=cGet(key)||[];
      const seen=new Set(local.map(e=>`${e.ts}|${e.bank}|${e.delta}`));
      let added=false;
      remote.forEach(e=>{
        const k=`${e.ts}|${e.bank}|${e.delta}`;
        if(!seen.has(k)){local.push(e);seen.add(k);added=true;}
      });
      if(added){
        local.sort((a,b)=>a.ts-b.ts);
        cSet(key,local.slice(-500));
        _renderCashLedger(bank,m,y);
      }
    }).catch(()=>{});
  }
}
function _renderCashLedger(bank,m,y){
  const log=(cGet(`sw3_cash_ledger_${y}_${m}`)||[]).filter(e=>e.bank===bank);
  const out=document.getElementById('audit-result');
  if(!out)return;
  const fmt=v=>isUSDCashAccount(bank)?(v<0?'-$':'$')+Math.abs(v).toLocaleString('en-US',{maximumFractionDigits:2}):(v<0?'-₦':'₦')+Math.abs(Math.round(v)).toLocaleString();
  const SRC={income:'Income',expense:'Expense','expense-edit':'Expense edit','expense-edit-reverse':'Expense edit (reversal)','expense-delete':'Expense deleted','income-delete':'Income deleted','income-edit':'Income edit','income-edit-reverse':'Income edit (reversal)','debt-add':'Debt disbursed','debt-edit-adjust':'Debt edit adjustment','loan-proceeds':'Loan proceeds','loan-repayment':'Loan repayment','loan-edit-adjust':'Loan edit adjustment','investment-liquidation':'Investment liquidation'};
  const body=log.length
    ?log.slice().reverse().map(e=>`<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:0.66rem"><span style="color:var(--text2)">${e.date} · ${SRC[e.source]||e.source||'manual'}</span><span style="font-family:var(--mono);color:${e.delta<0?'var(--red)':'var(--accent)'}">${e.delta>0?'+':''}${fmt(e.delta)}</span></div>`).join('')
    :'<div class="csub">No recorded movements this month. The ledger only captures changes made since v3.14.79; earlier balances and manual edits won\'t appear.</div>';
  out.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-size:0.78rem;font-weight:700">${bank} — ${MONTHS[m-1]} ledger</span><button class="btn btn-g btn-sm" onclick="runBalanceAudit()">← Back to audit</button></div>${body}`;
}

async function exportFullBackup(){
  toast('Building backup…');
  // Fetch each collection independently so one failure doesn't abort the rest.
  // No orderBy on transactions — avoids missing-index errors.
  async function safeFetch(query){
    try{const s=await query.get();return s.docs;}catch(e){console.warn('exportFullBackup fetch failed:',e);return[];}
  }
  const [txDocs,incDocs,cashDocs,invDocs,debDocs,histDocs,loanDocs,xfrDocs,budgetDocs,cfgDocs,ledgerDocs]=await Promise.all([
    safeFetch(db.collection('transactions')),
    safeFetch(db.collection('income')),
    safeFetch(db.collection('cashBalances')),
    safeFetch(db.collection('investments')),
    safeFetch(db.collection('debtors')),
    safeFetch(db.collection('historicalSummary')),
    safeFetch(db.collection('loans')),
    safeFetch(db.collection('transfers')),
    safeFetch(db.collection('budgets')),
    safeFetch(db.collection('appConfig')),
    safeFetch(db.collection('cashLedger')),
  ]);
  const backup={
    _meta:{version:'3.15.0',generated:todayStr(),description:'SpendWise full backup'},
    transactions:txDocs.map(d=>({...d.data(),_id:d.id})),
    income:incDocs.map(d=>({...d.data(),_id:d.id})),
    cashBalances:cashDocs.map(d=>d.data()),
    investments:invDocs.map(d=>d.data()),
    debtors:debDocs.map(d=>({...d.data(),_id:d.id})),
    historicalSummary:histDocs.map(d=>d.data()),
    loans:loanDocs.map(d=>({...d.data(),_id:d.id})),
    transfers:xfrDocs.map(d=>({...d.data(),_id:d.id})),
    budgets:budgetDocs.map(d=>d.data()),
    appConfig:cfgDocs.map(d=>({...d.data(),_id:d.id})),
    cashLedger:ledgerDocs.map(d=>d.data()),
  };
  const totalDocs=txDocs.length+incDocs.length+cashDocs.length+invDocs.length+debDocs.length+histDocs.length+loanDocs.length+xfrDocs.length+budgetDocs.length+cfgDocs.length+ledgerDocs.length;
  if(!totalDocs){toast('Nothing to export — check connection');return;}
  const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=`spendwise-backup-${todayStr()}.json`;a.click();
  URL.revokeObjectURL(url);
  toast(`Backup downloaded (${totalDocs} records)`);haptic([8]);
}

async function importFullBackup(ev){
  const file=ev.target.files&&ev.target.files[0];
  ev.target.value=''; // allow picking the same file again
  if(!file)return;
  let data;
  try{data=JSON.parse(await file.text());}
  catch(e){toast('Invalid backup file');return;}
  const tx=Array.isArray(data.transactions)?data.transactions:[];
  const inc=Array.isArray(data.income)?data.income:[];
  const cashB=Array.isArray(data.cashBalances)?data.cashBalances:[];
  const invB=Array.isArray(data.investments)?data.investments:[];
  const debs=Array.isArray(data.debtors)?data.debtors:[];
  const hist=Array.isArray(data.historicalSummary)?data.historicalSummary:[];
  const loans=Array.isArray(data.loans)?data.loans:[];
  const xfrs=Array.isArray(data.transfers)?data.transfers:[];
  const budgets=Array.isArray(data.budgets)?data.budgets:[];
  const cfg=Array.isArray(data.appConfig)?data.appConfig:[];
  const ledger=Array.isArray(data.cashLedger)?data.cashLedger:[];
  const total=tx.length+inc.length+cashB.length+invB.length+debs.length+hist.length+loans.length+xfrs.length+budgets.length+cfg.length+ledger.length;
  if(!total){toast('Backup file contains no records');return;}
  if(!db){toast('Restore needs a connection');return;}
  if(!confirm(`Restore from backup${data._meta?.generated?' ('+data._meta.generated+')':''}?\n\n${tx.length} transactions\n${inc.length} income records\n${cashB.length} cash months\n${invB.length} investment months\n${debs.length} debtors\n${hist.length} history rows\n${loans.length} loans\n${xfrs.length} transfers\n${budgets.length} budget months\n${cfg.length} config docs\n${ledger.length} ledger months\n\nExisting records with matching IDs will be overwritten.`))return;
  // Safety net: download a backup of the current data before overwriting anything
  try{toast('Downloading safety backup first…');await exportFullBackup();}catch(e){}
  toast('Restoring…');setSyncStatus('syncing');
  try{
    const ops=[];
    const docRows=(arr,col)=>arr.forEach(r=>{const{_id,...d}=r;ops.push({col,id:_id||(col+'_restore_'+Math.random().toString(36).slice(2,10)),d});});
    docRows(tx,'transactions');docRows(inc,'income');docRows(debs,'debtors');docRows(loans,'loans');docRows(xfrs,'transfers');
    const monthRows=(arr,col)=>arr.forEach(r=>{if(r.month&&r.year)ops.push({col,id:sid(r.month,r.year),d:r});});
    monthRows(cashB,'cashBalances');monthRows(invB,'investments');monthRows(hist,'historicalSummary');monthRows(budgets,'budgets');monthRows(ledger,'cashLedger');
    // appConfig docs restore by their original doc ID (fxOverrides, nwConfig, etc.)
    cfg.forEach(r=>{const{_id,...d}=r;if(_id)ops.push({col:'appConfig',id:_id,d});});
    // Batched writes — Firestore caps batches at 500 ops
    for(let i=0;i<ops.length;i+=400){
      const batch=db.batch();
      ops.slice(i,i+400).forEach(o=>batch.set(db.collection(o.col).doc(o.id),o.d,{merge:true}));
      await batch.commit();
    }
    // Bust monthly localStorage caches so onSnapshot listeners refetch fresh data.
    // Match only sw3_{txns|inc|cash|inv|budgets}_{year}_{month} — NOT sw3_inv_subs / sw3_inv_meta etc.
    Object.keys(localStorage).forEach(k=>{if(/^sw3_(txns|inc|cash|inv|budgets)_\d{4}_\d{1,2}$/.test(k))localStorage.removeItem(k);});
    setSyncStatus('synced');toast(`Restored ${ops.length} records ✓ — reloading…`);haptic([8,40,8]);
    setTimeout(()=>location.reload(),1200);
  }catch(e){
    console.error('Restore failed:',e);
    setSyncStatus('error');toast('Restore failed — check connection and try again');
  }
}
// ── Multi-sheet Excel export ───────────────────────────────────────────────
function _buildTxnSheet(txns,incomeRecs,label){
  // Combined daily transactions: expenses + income, sorted by date asc
  const expRows=txns.map(t=>([t.date||'','Expense',t.category||'',t.payee||'',t.bank||'',t.notes||'',-(t.amount||0),0]));
  const incRows=(incomeRecs||[]).map(i=>([i.date||'','Income',i.category||'Income','',i.bank||'',i.notes||'',0,i.amtNGN||i.amount||0]));
  const all=[...expRows,...incRows].sort((a,b)=>a[0]>b[0]?1:a[0]<b[0]?-1:0);
  const header=[`${label} — Transactions`];
  const cols=['Date','Type','Category','Actual Expense','Bank','Notes','Expense (₦)','Income (₦)'];
  const rows=[header,[],cols,...all];
  // Summary
  const totExp=txns.reduce((s,t)=>s+(t.amount||0),0);
  const totInc=(incomeRecs||[]).reduce((s,i)=>s+(i.amtNGN||i.amount||0),0);
  rows.push([],[`Total expenses`,'','','','','',totExp,'']);
  rows.push([`Total income`,'','','','','','',totInc]);
  rows.push([`Net`,'','','','','','',totInc-totExp]);
  return rows;
}

// ── Workbook-style month sheets ────────────────────────────────────────────
// Replicates the layout of the original hand-kept budget workbook: one sheet
// per month — a day-by-day expense matrix (item rows × day columns with Total
// formulas and the month's budget), then Cash blocks per account, Investments
// per platform, and the summary tables. Values + number formats only (SheetJS
// community edition can't write fills/fonts).
const _XL_NUM='#,##0';
function _xlN(v){return{v:Math.round((v||0)*100)/100,t:'n',z:_XL_NUM};}
function _monthSheetName(m,y){return MONTHS[m-1].slice(0,3)+"'"+String(y).slice(2);}

function _buildMonthMatrixWS(m,y,txns,incRecs,aux){
  const days=new Date(y,m,0).getDate();
  const lastCol=XLSX.utils.encode_col(6+days-1);   // day columns start at G
  const pad5=[null,null,null,null,null];
  const aoa=[];
  // Rows 1-4: Date / Day / Day no / Period across the day columns
  const dates=[],dayNames=[],dayNos=[],periods=[];
  for(let d=1;d<=days;d++){
    const dt=new Date(y,m-1,d);
    const wd=dt.getDay()===0?7:dt.getDay();        // 1=Mon … 7=Sun
    dates.push({v:dt,t:'d',z:'d/mmm'});
    dayNames.push({v:dt,t:'d',z:'ddd'});
    dayNos.push({v:wd,t:'n'});
    periods.push(wd>=6?'Weekend':'Weekday');
  }
  aoa.push([...pad5,'Date',...dates]);
  aoa.push([...pad5,'Day',...dayNames]);
  aoa.push([...pad5,'Day no',...dayNos]);
  aoa.push([...pad5,'Period',...periods]);
  aoa.push([]);
  // Actual expenses: one row per unique description (payee), grouped by category
  const groups={};                                  // cat → {name → amount[days]}
  txns.forEach(t=>{
    const cat=t.category||'Others';
    const name=(t.payee||'').trim()||cat;
    // Undated records land on day 1 so the row total stays correct
    const day=Math.min(days,Math.max(1,parseInt(String(t.date||'').slice(8,10),10)||1));
    (groups[cat]=groups[cat]||{});
    (groups[cat][name]=groups[cat][name]||Array(days).fill(0))[day-1]+=(t.amount||0);
  });
  aoa.push([null,'Actual expenses']);
  aoa.push([null,'Expenses','Category','Total','Budget']);
  const firstItem=aoa.length+1;                     // 1-based Excel row of first item
  const budgetCats=(aux.budBy[sid(m,y)]||{}).categories||{};
  Object.keys(groups).sort((a,b)=>a.localeCompare(b)).forEach(cat=>{
    let first=true;
    Object.keys(groups[cat]).sort((a,b)=>a.localeCompare(b)).forEach(name=>{
      const r=aoa.length+1;
      const cells=groups[cat][name].map(v=>v?_xlN(v):null);
      const bud=first?budgetCats[ck(cat)]:null;     // budget once per category group
      aoa.push([null,name,cat,{t:'n',z:_XL_NUM,f:`SUM(G${r}:${lastCol}${r})`},bud?_xlN(bud):null,null,...cells]);
      first=false;
    });
  });
  const lastItem=aoa.length;
  const hasItems=lastItem>=firstItem;
  const totalRow=aoa.length+1;
  const spentTotal=txns.reduce((s,t)=>s+(t.amount||0),0);
  aoa.push([null,'Total',null,hasItems?{t:'n',z:_XL_NUM,f:`SUM(D${firstItem}:D${lastItem})`}:_xlN(0),hasItems?{t:'n',z:_XL_NUM,f:`SUM(E${firstItem}:E${lastItem})`}:_xlN(0)]);
  aoa.push([null,'Cummulative spend',null,{t:'n',z:_XL_NUM,f:`D${totalRow}`}]);
  aoa.push([]);
  // Cash: per-account block — opening (prev month), inflow, expense, balance
  const prevSid=m===1?sid(12,y-1):sid(m-1,y);
  const cashCur=aux.cashBy[sid(m,y)]||{};
  const cashPrev=aux.cashBy[prevSid]||{};
  const accts=getCashAccounts().filter(a=>(cashCur[a]||0)||(cashPrev[a]||0)||incRecs.some(i=>i.bank===a)||txns.some(t=>t.bank===a));
  aoa.push([null,'Cash']);
  accts.forEach(a=>{
    const inflow=incRecs.filter(i=>i.bank===a).reduce((s,i)=>s+(i.amtNGN||i.amount||0),0);
    const spend=txns.filter(t=>t.bank===a).reduce((s,t)=>s+(t.amount||0),0);
    aoa.push([null,a]);
    aoa.push([null,'Opening balance',null,_xlN(cashPrev[a]||0)]);
    aoa.push([null,'Inflow',null,_xlN(inflow)]);
    aoa.push([null,'Expense',null,_xlN(-spend)]);
    aoa.push([null,'Balance',null,_xlN(cashCur[a]!=null?cashCur[a]:(cashPrev[a]||0)+inflow-spend)]);
    aoa.push([]);
  });
  // Investments: per-platform block — opening (prev month) and closing value
  const invCur=aux.invBy[sid(m,y)]||{};
  const invPrev=aux.invBy[prevSid]||{};
  const plats=getPlatforms().filter(p=>(invCur[p.key]||0)||(invPrev[p.key]||0));
  aoa.push([null,'Investments']);
  plats.forEach(p=>{
    aoa.push([null,p.label]);
    aoa.push([null,'Opening balance',null,_xlN(invPrev[p.key]||0)]);
    aoa.push([null,'Closing balance',null,_xlN(invCur[p.key]||0)]);
    aoa.push([]);
  });
  // Summary tables
  const wdTotals=[0,0,0,0,0,0,0];                   // Mon..Sun
  txns.forEach(t=>{
    const d=parseInt(String(t.date||'').slice(8,10),10);
    const dt=new Date(y,m-1,d||1);
    wdTotals[dt.getDay()===0?6:dt.getDay()-1]+=(t.amount||0);
  });
  aoa.push([null,'Expense summary']);
  aoa.push([null,'Day of the week',null,'Amount']);
  ['Mon','Tue','Wed','Thur','Fri','Sat','Sun'].forEach((n,i)=>aoa.push([null,n,{v:i+1,t:'n'},_xlN(wdTotals[i])]));
  aoa.push([null,'Total',null,_xlN(spentTotal)]);
  aoa.push([]);
  aoa.push([null,'Expense summary']);
  aoa.push([null,'Day of the week',null,'Amount']);
  aoa.push([null,'Weekday',null,_xlN(wdTotals[0]+wdTotals[1]+wdTotals[2]+wdTotals[3]+wdTotals[4])]);
  aoa.push([null,'Weekend',null,_xlN(wdTotals[5]+wdTotals[6])]);
  aoa.push([null,'Total',null,_xlN(spentTotal)]);
  aoa.push([]);
  aoa.push([null,'Cash available']);
  aoa.push([null,'Bank',null,'N Amount']);
  let cashTot=0;
  accts.forEach(a=>{const v=cashCur[a]||0;cashTot+=v;aoa.push([null,a,null,_xlN(v)]);});
  aoa.push([null,'Total',null,_xlN(cashTot)]);
  aoa.push([]);
  aoa.push([null,'Investment']);
  aoa.push([null,'Platform',null,'N Amount']);
  let invTot=0;
  plats.forEach(p=>{const v=invCur[p.key]||0;invTot+=v;aoa.push([null,p.label,null,_xlN(v)]);});
  aoa.push([null,'Total',null,_xlN(invTot)]);
  aoa.push([]);
  const debtExp=(S.debtors||[]).filter(d=>d.expectRepayment!==false).reduce((s,d)=>s+(d.ngnBalance||0),0);
  aoa.push([null,'Financial assets']);
  aoa.push([null,'Source',null,'N Amount']);
  aoa.push([null,'Cash',null,_xlN(cashTot)]);
  aoa.push([null,'Investments',null,_xlN(invTot)]);
  aoa.push([null,'Expected debt repayment',null,_xlN(debtExp)]);
  aoa.push([null,'Total',null,_xlN(cashTot+invTot+debtExp)]);
  const ws=XLSX.utils.aoa_to_sheet(aoa,{cellDates:true});
  ws['!cols']=[{wch:9},{wch:18},{wch:16.6},{wch:14.6},{wch:13.9},{wch:10.3},...Array(days).fill({wch:13.9})];
  return ws;
}

// Cash balances, investment values and budgets for every month, keyed by
// 'YYYY-MM' doc id — fetched once per export so multi-sheet builds are cheap.
async function _fetchMatrixAux(){
  const [cashSnap,invSnap,budSnap]=await Promise.all([
    db.collection('cashBalances').get().catch(()=>null),
    db.collection('investments').get().catch(()=>null),
    db.collection('budgets').get().catch(()=>null),
  ]);
  const map=s=>{const o={};if(s)s.docs.forEach(d=>o[d.id]=d.data());return o;};
  return{cashBy:map(cashSnap),invBy:map(invSnap),budBy:map(budSnap)};
}

async function _exportMatrixXlsx(monthsList,txns,incRecs,filename){
  if(typeof XLSX==='undefined'){toast('Excel library not loaded');return;}
  const aux=await _fetchMatrixAux();
  const wb=XLSX.utils.book_new();
  monthsList.forEach(([mo,yr])=>{
    const mt=txns.filter(t=>t.month===mo&&t.year===yr);
    const mi=incRecs.filter(i=>i.month===mo&&i.year===yr);
    XLSX.utils.book_append_sheet(wb,_buildMonthMatrixWS(mo,yr,mt,mi,aux),_monthSheetName(mo,yr));
  });
  XLSX.writeFile(wb,filename+'.xlsx');
  toast(`Excel downloaded — ${monthsList.length} month sheet${monthsList.length===1?'':'s'}`);
}

async function exportAll(fmt){
  toast('Fetching all data…');
  try{
    const [txnSnap,incSnap]=await Promise.all([
      db.collection('transactions').orderBy('date','asc').get(),
      db.collection('income').orderBy('date','asc').get(),
    ]);
    const txns=txnSnap.docs.map(d=>({id:d.id,...d.data()}));
    const incRecs=incSnap.docs.map(d=>({id:d.id,...d.data()}));
    if(fmt==='csv'){
      // CSV: combined flat file
      const rows=_buildTxnSheet(txns,incRecs,'All Time');
      const csv=rows.map(r=>r.map(c=>typeof c==='string'&&c.includes(',')?`"${c}"`:String(c)).join(',')).join('\n');
      const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
      const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='SpendWise_All.csv';a.click();URL.revokeObjectURL(url);
      toast('CSV downloaded');return;
    }
    // One workbook-style sheet per month that has any activity, oldest first
    const keys=new Set();
    [...txns,...incRecs].forEach(r=>{if(r.month&&r.year)keys.add(r.year*100+r.month);});
    const monthsList=[...keys].sort((a,b)=>a-b).map(k=>[k%100,Math.floor(k/100)]);
    if(!monthsList.length){toast('No data to export');return;}
    await _exportMatrixXlsx(monthsList,txns,incRecs,'SpendWise_All');
  }catch(e){console.error(e);toast('Error exporting — check console');}
}

async function exportMonth(fmt){
  const m=parseInt(document.getElementById('exp-mo-sel').value);
  const y=parseInt(document.getElementById('exp-yr-sel').value);
  toast(`Fetching ${MONTHS[m-1]} ${y}…`);
  try{
    let txnSnap,incSnap;
    try{
      [txnSnap,incSnap]=await Promise.all([
        db.collection('transactions').where('year','==',y).where('month','==',m).orderBy('date','asc').get(),
        db.collection('income').where('year','==',y).where('month','==',m).orderBy('date','asc').get(),
      ]);
    }catch{
      [txnSnap,incSnap]=await Promise.all([
        db.collection('transactions').where('year','==',y).where('month','==',m).get(),
        db.collection('income').where('year','==',y).where('month','==',m).get(),
      ]);
    }
    const txns=txnSnap.docs.map(d=>({id:d.id,...d.data()}));
    const incRecs=incSnap.docs.map(d=>({id:d.id,...d.data()}));
    const label=`${MONTHS[m-1]} ${y}`;
    if(fmt==='csv'){
      const rows=_buildTxnSheet(txns,incRecs,label);
      const csv=rows.map(r=>r.map(c=>typeof c==='string'&&c.includes(',')?`"${c}"`:String(c)).join(',')).join('\n');
      const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
      const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`SpendWise_${MONTHS[m-1]}_${y}.csv`;a.click();URL.revokeObjectURL(url);
      toast('CSV downloaded');return;
    }
    await _exportMatrixXlsx([[m,y]],txns,incRecs,`SpendWise_${MONTHS[m-1]}_${y}`);
  }catch(e){console.error(e);toast('Error exporting');}
}

function doExport(rows,filename,fmt){
  // Legacy fallback — single sheet
  if(fmt==='csv'){const csv=rows.map(r=>r.map(c=>typeof c==='string'&&c.includes(',')?`"${c}"`:String(c)).join(',')).join('\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename+'.csv';a.click();URL.revokeObjectURL(url);toast('CSV downloaded');}
  else{if(typeof XLSX==='undefined'){toast('Excel library not loaded');return;}const ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=[{wch:12},{wch:18},{wch:28},{wch:12},{wch:28},{wch:14}];const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Transactions');XLSX.writeFile(wb,filename+'.xlsx');toast('Excel file downloaded');}
}
function doExport(rows,filename,fmt){
  if(fmt==='csv'){const csv=rows.map(r=>r.map(c=>typeof c==='string'&&c.includes(',')?`"${c}"`:String(c)).join(',')).join('\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename+'.csv';a.click();URL.revokeObjectURL(url);toast('CSV downloaded');}
  else{if(typeof XLSX==='undefined'){toast('Excel library not loaded');return;}const ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=[{wch:12},{wch:18},{wch:28},{wch:12},{wch:28},{wch:14}];const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Transactions');XLSX.writeFile(wb,filename+'.xlsx');toast('Excel file downloaded');}
}

function renderSettData(){
  const fbVer=cGet(CK.fbSyncVer)||null;
  const ls=cGet(CK.lastSync);
  let syncInfo='Not yet synced';
  if(ls){const d=new Date(ls),diff=Math.round((Date.now()-d)/60000);syncInfo=diff<2?'Just now':diff<60?`${diff}m ago`:d.toLocaleDateString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});}
  const _mon=getDesignMode()==='monarch';
  document.getElementById('sett-data').innerHTML=`
    <div class="exp-card" style="margin-top:10px"><div class="exp-card-title" style="margin-bottom:8px">App Info</div><div style="font-size:0.72rem;color:var(--text2);line-height:1.9"><div>Version: v4.4.1</div><div>Firebase: spendwise-d6393</div><div>History: Nov 2023 – May 2026</div><div style="color:var(--text3);margin-top:4px">v4.4.1: Notifications now work on phones — they were silently failing on Android and only ever appearing on desktop. If they are off, open the bell menu and tap "Turn on notifications for this device". Also: the app now opens much faster when you are online, instead of waiting on the network before showing anything.</div></div></div>
    <div class="exp-card" style="margin-top:10px">
      <div class="exp-card-title" style="margin-bottom:6px">Design Mode</div>
      <div class="exp-card-sub" style="margin-bottom:10px">Switch the app's look. Classic is the original design; Monarch is a softer, chart-forward style. Purely cosmetic — your data and features are identical in both.</div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm ${_mon?'btn-g':'btn-p'}" style="flex:1" onclick="setDesignMode('classic')">Classic</button>
        <button class="btn btn-sm ${_mon?'btn-p':'btn-g'}" style="flex:1" onclick="setDesignMode('monarch')">Monarch</button>
      </div>
    </div>
    <div class="exp-card" style="margin-top:10px">
      <div class="exp-card-title" style="margin-bottom:6px">Goals</div>
      <div class="exp-card-sub" style="margin-bottom:8px">Savings targets with progress tracking. Active goals appear on the dashboard.</div>
      ${getGoals().map((g,i)=>{const pct=g.target>0?Math.min(100,Math.round((g.current||0)/g.target*100)):0;return`<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)"><span style="font-size:0.76rem">${g.icon||'🎯'} ${esc(g.name)} <span style="color:var(--text3);font-size:0.64rem;font-family:var(--mono)">${pct}%</span></span><button class="btn btn-g btn-sm" style="padding:2px 8px;font-size:0.66rem" onclick="openGoalModal(${i})">Edit</button></div>`;}).join('')||'<div style="font-size:0.7rem;color:var(--text3);padding:2px 0 6px">No goals yet.</div>'}
      <button class="btn btn-p btn-sm btn-full" style="margin-top:10px" onclick="openGoalModal()">+ New Goal</button>
    </div>
    <div class="exp-card" style="margin-top:10px">
      <div class="exp-card-title" style="margin-bottom:6px">Recurring Transactions</div>
      <div class="exp-card-sub" style="margin-bottom:10px">Bills and income that repeat. Due items appear on the dashboard as Upcoming Bills. Add one via the expense form's recurring option.</div>
      <button class="btn btn-g btn-sm btn-full" onclick="openRecurModal()">Manage Recurring (${getRecurring().length})</button>
    </div>
    <div class="exp-card" style="margin-top:10px">
      <div class="exp-card-title" style="margin-bottom:6px">Default Cash Accounts</div>
      <div class="exp-card-sub" style="margin-bottom:10px">These accounts always appear in cash tracking. USD Cash is fixed and cannot be removed.</div>
      <div id="default-accts-list">
        ${DEFAULT_CASH_ACCOUNTS.filter(a=>a!=='USD Cash').map(a=>`
          <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:0.76rem">${a}</span>
            <button class="btn btn-d btn-sm" style="padding:2px 8px;font-size:0.68rem" onclick="removeDefaultAccount('${jsq(a)}')">Remove</button>
          </div>`).join('')}
        <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:0.76rem">USD Cash</span>
          <span style="font-size:0.62rem;color:var(--text3)">fixed</span>
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-top:10px;align-items:center">
        <input class="ifield" id="new-default-acct" placeholder="e.g. Zenith" style="flex:1;font-size:0.76rem;padding:6px 10px">
        <button class="btn btn-p btn-sm" onclick="addDefaultAccount()">+ Add</button>
      </div>
    </div>
    ${renderNWConfigCard()}
    ${renderFxCard()}
  `;
}

function addDefaultAccount(){
  const inp=document.getElementById('new-default-acct');
  if(!inp) return;
  const name=inp.value.trim();
  if(!name){toast('Enter an account name');return;}
  if(DEFAULT_CASH_ACCOUNTS.map(a=>a.toLowerCase()).includes(name.toLowerCase())){toast('Account already exists');return;}
  DEFAULT_CASH_ACCOUNTS.push(name);
  // Also add to saved list
  const saved=cGet('sw3_cash_accounts')||[...DEFAULT_CASH_ACCOUNTS];
  if(!saved.includes(name)) saved.push(name);
  cSet('sw3_cash_accounts',saved);
  inp.value='';
  renderSettData();renderCashPage();renderDashboard();
  toast(`Added "${name}" to default accounts`);
}
function removeDefaultAccount(name){
  if(name==='USD Cash'){toast('USD Cash cannot be removed');return;}
  const idx=DEFAULT_CASH_ACCOUNTS.indexOf(name);
  if(idx===-1) return;
  DEFAULT_CASH_ACCOUNTS.splice(idx,1);
  const saved=cGet('sw3_cash_accounts')||[];
  cSet('sw3_cash_accounts',saved.filter(a=>a!==name));
  renderSettData();renderCashPage();renderDashboard();
  toast(`Removed "${name}" from default accounts`);
}
function clearFxOverride(k){
  const ovr=getFxOverrides();
  delete ovr[k];
  cSet(FX_OVR_KEY,ovr);
  _syncFxOverrides(ovr);
  toast(`Override removed for ${k}`);
  renderSettData();
  renderAll();
}
function renderNWConfigCard(){
  const cfg=getNWConfig();
  const allAccts=getCashAccounts();
  const selAccts=cfg.cashAccounts||allAccts;
  return`
    <div class="exp-card" style="margin-top:10px">
      <div class="exp-card-title" style="margin-bottom:6px">Net Worth Card</div>
      <div class="exp-card-sub" style="margin-bottom:12px">Choose what is included in the homepage net worth total and breakdown.</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <label style="display:flex;align-items:center;justify-content:space-between;font-size:0.78rem">
          <span>Investments</span>
          <input type="checkbox" id="nwcfg-inv" ${cfg.includeInvestments!==false?'checked':''} onchange="saveNWConfigFromUI()">
        </label>
        <div id="nwcfg-inv-sub" style="margin:0 0 2px 14px;display:flex;flex-direction:column;gap:6px;${cfg.includeInvestments===false?'opacity:0.4;pointer-events:none':''}">
          <label style="display:flex;align-items:center;justify-content:space-between;font-size:0.73rem;color:var(--text2)">
            <span>Equities</span>
            <input type="checkbox" id="nwcfg-eq" ${cfg.includeEquities!==false?'checked':''} onchange="saveNWConfigFromUI()">
          </label>
          <label style="display:flex;align-items:center;justify-content:space-between;font-size:0.73rem;color:var(--text2)">
            <span>Fixed Income</span>
            <input type="checkbox" id="nwcfg-fi" ${cfg.includeFixedIncome!==false?'checked':''} onchange="saveNWConfigFromUI()">
          </label>
        </div>
        <label style="display:flex;align-items:center;justify-content:space-between;font-size:0.78rem">
          <span>Debtors (expected repayments)</span>
          <input type="checkbox" id="nwcfg-deb" ${cfg.includeDebtors!==false?'checked':''} onchange="saveNWConfigFromUI()">
        </label>
        <div>
          <div style="font-size:0.7rem;font-weight:700;color:var(--text2);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.05em">Cash Accounts</div>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${allAccts.map(a=>`
              <label style="display:flex;align-items:center;justify-content:space-between;font-size:0.78rem">
                <span>${a}</span>
                <input type="checkbox" data-nw-acct="${a}" ${selAccts.includes(a)?'checked':''} onchange="saveNWConfigFromUI()">
              </label>`).join('')}
          </div>
        </div>
      </div>
    </div>`;
}
function saveNWConfigFromUI(){
  const cfg=getNWConfig();
  cfg.includeInvestments=document.getElementById('nwcfg-inv')?.checked!==false;
  cfg.includeEquities=document.getElementById('nwcfg-eq')?.checked!==false;
  cfg.includeFixedIncome=document.getElementById('nwcfg-fi')?.checked!==false;
  cfg.includeDebtors=document.getElementById('nwcfg-deb')?.checked!==false;
  const acctBoxes=document.querySelectorAll('[data-nw-acct]');
  cfg.cashAccounts=[...acctBoxes].filter(el=>el.checked).map(el=>el.dataset.nwAcct);
  cfg.includeCash=cfg.cashAccounts.length>0;
  // Dim sub-options when parent Investments is unchecked
  const sub=document.getElementById('nwcfg-inv-sub');
  if(sub) sub.style.cssText=`margin:0 0 2px 14px;display:flex;flex-direction:column;gap:6px;${cfg.includeInvestments?'':'opacity:0.4;pointer-events:none'}`;
  saveNWConfig(cfg);
  renderDashboard();
}
function renderFxCard(){
  const ovr=getFxOverrides();
  // Build the full month list: FX_RATES keys + any override-only months +
  // the real-world current month and the next 11 months ahead, so the
  // current month and any month we move into is always editable here
  // even before a built-in or override entry exists for it.
  const _fxNow=new Date();
  const _fxFutureKeys=[];
  for(let i=0;i<12;i++){
    const fm=_fxNow.getMonth()+i,fy=_fxNow.getFullYear()+Math.floor(fm/12);
    _fxFutureKeys.push(fxKey((fm%12)+1,fy));
  }
  const allKeys=[...new Set([...Object.keys(FX_RATES),...Object.keys(ovr),..._fxFutureKeys])].sort();
  const m=S.dashMonth,y=S.dashYear;
  const cur=getFxRates(m,y);
  const rows=allKeys.map(k=>{
    const base=FX_RATES[k]||{};
    const override=ovr[k]||{};
    const usd=override.USD??base.USD??'';
    const gbp=override.GBP??base.GBP??'';
    const isOverridden=!!(override.USD||override.GBP);
    const isCurrentMonth=(k===fxKey(m,y));
    return`<div style="display:grid;grid-template-columns:80px 1fr 1fr auto;gap:6px;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);${isCurrentMonth?'background:var(--bg2);border-radius:6px':''}">
      <span style="font-family:var(--mono);font-size:0.72rem;color:${isOverridden?'var(--accent)':isCurrentMonth?'var(--blue)':'var(--text2)'};font-weight:${isCurrentMonth?'700':'400'}">${k}${isCurrentMonth?' ●':''}${isOverridden?' ✎':''}</span>
      <input class="ifield" type="text" id="fx-usd-${k}" value="${usd}" placeholder="USD→₦" style="font-size:0.74rem;padding:4px 7px">
      <input class="ifield" type="text" id="fx-gbp-${k}" value="${gbp}" placeholder="GBP→₦" style="font-size:0.74rem;padding:4px 7px">
      ${isOverridden?`<button class="btn btn-g btn-sm" style="padding:2px 6px;font-size:0.64rem" onclick="clearFxOverride('${k}')">✕</button>`:`<span></span>`}
    </div>`;
  }).join('');
  return`
    <div class="exp-card" style="margin-top:10px">
      <div class="exp-card-title" style="margin-bottom:4px">Exchange Rates (₦ per 1 foreign unit)</div>
      <div class="exp-card-sub" style="margin-bottom:10px">Current month (${String(m).padStart(2,'0')}/${y}): $1 = ₦${cur.USD} &nbsp;|&nbsp; £1 = ₦${cur.GBP}. Edit any row and tap Save to override built-in rates. Overridden rows are marked ✎.</div>
      <div style="display:grid;grid-template-columns:80px 1fr 1fr auto;gap:6px;margin-bottom:4px">
        <span style="font-size:0.64rem;color:var(--text3);text-transform:uppercase">Month</span>
        <span style="font-size:0.64rem;color:var(--text3);text-transform:uppercase">USD → ₦</span>
        <span style="font-size:0.64rem;color:var(--text3);text-transform:uppercase">GBP → ₦</span>
        <span></span>
      </div>
      <div style="max-height:340px;overflow-y:auto;-webkit-overflow-scrolling:touch">${rows}</div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-p btn-sm" style="flex:1" onclick="saveAllFxOverrides()">Save All Changes</button>
        <button class="btn btn-g btn-sm" onclick="clearAllFxOverrides()">Clear All Overrides</button>
      </div>
    </div>`;
}
function saveAllFxOverrides(){
  const _fxNow=new Date();
  const _fxFutureKeys=[];
  for(let i=0;i<12;i++){
    const fm=_fxNow.getMonth()+i,fy=_fxNow.getFullYear()+Math.floor(fm/12);
    _fxFutureKeys.push(fxKey((fm%12)+1,fy));
  }
  const allKeys=[...new Set([...Object.keys(FX_RATES),...Object.keys(getFxOverrides()),..._fxFutureKeys])].sort();
  const ovr=getFxOverrides();
  allKeys.forEach(k=>{
    const usdEl=document.getElementById('fx-usd-'+k);
    const gbpEl=document.getElementById('fx-gbp-'+k);
    const usd=usdEl?parseFloat(usdEl.value):NaN;
    const gbp=gbpEl?parseFloat(gbpEl.value):NaN;
    const base=FX_RATES[k]||{};
    // Only store as override if the value differs from the built-in
    const usdChanged=!isNaN(usd)&&usd>0&&usd!==(base.USD||0);
    const gbpChanged=!isNaN(gbp)&&gbp>0&&gbp!==(base.GBP||0);
    if(usdChanged||gbpChanged){
      ovr[k]={USD:!isNaN(usd)&&usd>0?usd:(base.USD||1600),GBP:!isNaN(gbp)&&gbp>0?gbp:(base.GBP||2050)};
    } else {
      delete ovr[k]; // value matches built-in — remove override
    }
  });
  cSet(FX_OVR_KEY,ovr);
  _syncFxOverrides(ovr);
  toast('Exchange rates saved');
  renderSettData();renderDashboard();
}
function clearAllFxOverrides(){
  if(!confirm('Clear all custom FX rate overrides and revert to built-in rates?')) return;
  cSet(FX_OVR_KEY,{});
  _syncFxOverrides({});
  toast('All overrides cleared');
  renderSettData();renderDashboard();
}
async function forceHardRefresh(){
  try{
    if('serviceWorker' in navigator){
      const regs=await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=>r.unregister()));
    }
    if(window.caches){
      const keys=await caches.keys();
      await Promise.all(keys.map(k=>caches.delete(k)));
    }
    // location.reload() does NOT bypass the browser's HTTP cache, so a stale
    // index.html (and the app.js it points to) can survive an SW+cache wipe
    // and re-trigger the update banner forever. Force the entry point to
    // refetch from the server first; the fresh index.html then references the
    // current ?v= app.js/styles.css, breaking the loop in a single reload.
    try{await fetch('./index.html',{cache:'reload'});}catch(e){}
  }catch(e){}
  window.location.reload();
}
async function forceSyncNow(){
  if(!db||!navigator.onLine){toast('Not connected');return;}
  setSyncStatus('syncing');toast('Pulling from Firebase…');
  // Force-sync: clear local cache first so loadX functions fetch from Firebase
  const m=S.expMonth,y=S.expYear;
  try{
    // Pull fresh data by temporarily clearing local cache for current month
    localStorage.removeItem(CK.txns(m,y));
    localStorage.removeItem(CK.inc(m,y));
    localStorage.removeItem(CK.inv(m,y));
    localStorage.removeItem(CK.cash(m,y));
    localStorage.removeItem(CK.debtors);
    localStorage.removeItem('sw3_history');
    await syncAll();
    S.txns=cGet(CK.txns(m,y))||S.txns;
    S.income=cGet(CK.inc(m,y))||S.income;
    S.investments=cGet(CK.inv(m,y))||S.investments;
    S.cash=cGet(CK.cash(m,y))||S.cash;
    S.debtors=cGet(CK.debtors)||S.debtors;
    cSet(CK.lastSync,Date.now());setSyncStatus('synced');renderAll();toast('Sync complete');renderSettData();
  }catch(e){setSyncStatus('error');toast('Sync failed');}
}

// ══════════════════════════════════════════════════════════════════════════
// DASHBOARD DRILLDOWN
// ══════════════════════════════════════════════════════════════════════════
function drillDown(type){
  const m=S.dashMonth,y=S.dashYear,cur=S.dashCurrency;
  let title='',body='';
  const fmtRow=(label,val,color)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-size:0.78rem;color:var(--text2)">${label}</span><span style="font-family:var(--mono);font-size:0.82rem;color:${color||'var(--fg)'}">${val}</span></div>`;

  if(type==='expenses'){
    title=`Expenses — ${MONTHS[m-1]} ${y}`;
    const cats={};S.txns.forEach(t=>{cats[t.category]=(cats[t.category]||0)+(t.amount||0);});
    const sorted=Object.entries(cats).sort((a,b)=>b[1]-a[1]);
    const total=sorted.reduce((s,[,v])=>s+v,0);
    body=sorted.map(([cat,val])=>fmtRow(cat,fmtCur(val,cur,m,y),'var(--red)')).join('');
    body+=`<div style="display:flex;justify-content:space-between;padding:10px 0;font-weight:700"><span>Total</span><span style="font-family:var(--mono);color:var(--red)">${fmtCur(total,cur,m,y)}</span></div>`;
  }
  else if(type==='income'){
    title=`Income — ${MONTHS[m-1]} ${y}`;
    const sorted=[...S.income].sort((a,b)=>(b.amount||0)-(a.amount||0));
    const total=sorted.reduce((s,i)=>s+(i.amount||0),0);
    body=sorted.map(i=>fmtRow(i.category||i.payee||'Income',fmtCur(i.amount,cur,m,y),'var(--accent)')).join('');
    body+=`<div style="display:flex;justify-content:space-between;padding:10px 0;font-weight:700"><span>Total</span><span style="font-family:var(--mono);color:var(--accent)">${fmtCur(total,cur,m,y)}</span></div>`;
  }
  else if(type==='savings'){
    title=`Net Savings — ${MONTHS[m-1]} ${y}`;
    const totalInc=S.income.reduce((s,i)=>s+(i.amtNGN||i.amount||0),0);
    const totalExp=S.txns.reduce((s,t)=>s+(t.amount||0),0);
    const net=totalInc-totalExp;
    body=fmtRow('Total Income',fmtCur(totalInc,cur,m,y),'var(--accent)')+
         fmtRow('Total Expenses',fmtCur(totalExp,cur,m,y),'var(--red)')+
         `<div style="display:flex;justify-content:space-between;padding:10px 0;font-weight:700"><span>Net</span><span style="font-family:var(--mono);color:${net>=0?'var(--accent)':'var(--red)'}">${fmtCur(Math.abs(net),cur,m,y)}</span></div>`;
    const rate=totalInc>0?Math.round((net/totalInc)*100):0;
    body+=`<div style="margin-top:8px;padding:10px;background:var(--bg2);border-radius:var(--rsm);font-size:0.72rem;color:var(--text2)">Savings rate: <strong style="color:${rate>20?'var(--accent)':rate>0?'var(--gold)':'var(--red)'}">${rate}%</strong></div>`;
  }
  else if(type==='networth'){
    title=`Net Worth — ${MONTHS[m-1]} ${y}`;
    const inv=S.investments,cash=S.cash;
    const _nwCfg=getNWConfig();
    const _nwAccts=_nwCfg.cashAccounts||getCashAccounts();
    const _fxRNW=getFxRates(m,y);
    const invTotal=_nwCfg.includeInvestments!==false?PLATFORMS.reduce((s,p)=>{
      const meta=getInvPlatformMeta(p.key);
      const isFI=meta.assetClass==='fixed_income';
      if(isFI&&_nwCfg.includeFixedIncome===false) return s;
      if(!isFI&&_nwCfg.includeEquities===false) return s;
      const subs=getSubsForPlatform(p.key);
      const bal=subs.length?subs.reduce((ss,sub)=>ss+(Number(sub.principal)||0),0):(inv[p.key]||0);
      return s+bal;
    },0):0;
    const cashTotal=_nwAccts.reduce((s,b)=>{const v=cash[b]||0;return s+(isUSDCashAccount(b)?v*(_fxRNW.USD||1650):v);},0);
    const debtOwed=_nwCfg.includeDebtors!==false?S.debtors.filter(d=>d.expectRepayment!==false).reduce((s,d)=>s+(d.ngnBalance||0),0):0;
    body='';
    if(_nwCfg.includeInvestments!==false){
      const visiblePlats=PLATFORMS.filter(p=>{
        const meta=getInvPlatformMeta(p.key);
        const isFI=meta.assetClass==='fixed_income';
        if(isFI&&_nwCfg.includeFixedIncome===false) return false;
        if(!isFI&&_nwCfg.includeEquities===false) return false;
        return true;
      });
      if(visiblePlats.length){
        body+=`<div style="font-size:0.65rem;font-weight:700;color:var(--text3);text-transform:uppercase;padding:6px 0 4px">Investments</div>`;
        body+=visiblePlats.map(p=>{
          const subs=getSubsForPlatform(p.key);
          const bal=subs.length?subs.reduce((ss,sub)=>ss+(Number(sub.principal)||0),0):(inv[p.key]||0);
          return fmtRow(p.label+` <span style="font-size:0.58rem;color:var(--text3)">${p.currency}</span>`,fmtPlatformVal(bal,p.key,cur,m,y),p.color);
        }).join('');
      }
    }
    if(_nwAccts.length){
      body+=`<div style="font-size:0.65rem;font-weight:700;color:var(--text3);text-transform:uppercase;padding:10px 0 4px">Cash</div>`;
      body+=_nwAccts.map(b=>{
        const v=cash[b]||0;
        let disp;
        if(isUSDCashAccount(b)){
          const ngnEquiv=v*(_fxRNW.USD||1650);
          disp=(cur==='NATIVE'||cur==='NGN')?'$'+v.toFixed(2)+' ('+fN(ngnEquiv)+')':fmtCur(ngnEquiv,cur,m,y);
        } else {
          disp=fmtCur(v,cur,m,y);
        }
        return fmtRow(b,disp,'var(--blue)');
      }).join('');
    }
    if(debtOwed){
      body+=`<div style="font-size:0.65rem;font-weight:700;color:var(--text3);text-transform:uppercase;padding:10px 0 4px">Debtors (expected)</div>`;
      body+=S.debtors.filter(d=>d.expectRepayment!==false).map(d=>fmtRow(d.name,fmtCur(d.ngnBalance||0,cur,m,y),'var(--gold)')).join('');
    }
    body+=`<div style="display:flex;justify-content:space-between;padding:10px 0;font-weight:700;border-top:1px solid var(--border);margin-top:4px"><span>Total Net Worth</span><span style="font-family:var(--mono);color:var(--accent)">${fmtCur(invTotal+cashTotal+debtOwed,cur,m,y)}</span></div>`;
  }
  else if(type==='cash'){
    title=`Cash — ${MONTHS[m-1]} ${y}`;
    const cash=S.cash;
    const total=cashTotalNGN(cash,m,y);
    const _fxRC=getFxRates(m,y);
    body=getCashAccounts().map(b=>{
      const v=cash[b]||0;
      let disp;
      if(isUSDCashAccount(b)){
        const ngnEquiv=v*(_fxRC.USD||1650);
        disp=(cur==='NATIVE'||cur==='NGN')?'$'+v.toFixed(2)+' ('+fN(ngnEquiv)+')':fmtCur(ngnEquiv,cur,m,y);
      } else {
        disp=fmtCur(v,cur,m,y);
      }
      return`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="drillDownAccount('${jsq(b)}')"><span style="font-size:0.78rem;color:var(--text2)">${esc(b)} <span style="font-size:0.6rem;color:var(--text3)">›</span></span><span style="font-family:var(--mono);font-size:0.82rem;color:var(--blue)">${disp}</span></div>`;
    }).join('');
    body+=`<div style="display:flex;justify-content:space-between;padding:10px 0;font-weight:700"><span>Total</span><span style="font-family:var(--mono);color:var(--blue)">${fmtCur(total,cur,m,y)}</span></div>`;
  }
  else if(type==='investments'){
    title=`Investments — ${MONTHS[m-1]} ${y}`;
    const inv=S.investments;
    const total=PLATFORMS.reduce((s,p)=>{const subs=getSubsForPlatform(p.key);return s+(subs.length?subs.reduce((ss,sb)=>ss+(Number(sb.principal)||0),0):(inv[p.key]||0));},0);
    body=PLATFORMS.map(p=>{
      const subs=getSubsForPlatform(p.key);
      const val=subs.length?subs.reduce((ss,sb)=>ss+(Number(sb.principal)||0),0):(inv[p.key]||0);
      const pct=total>0?((val/total)*100).toFixed(1):'0.0';
      return`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="drillDownInvPlatform('${p.key}')"><span style="font-size:0.78rem;color:var(--text2)">${p.label} <span style="font-size:0.58rem;color:var(--text3)">${p.currency} · ${pct}%</span> <span style="font-size:0.6rem;color:var(--text3)">›</span></span><span style="font-family:var(--mono);font-size:0.82rem;color:${val?p.color:'var(--text3)'}">${val?fmtPlatformVal(val,p.key,cur,m,y):'—'}</span></div>`;
    }).join('');
    body+=`<div style="display:flex;justify-content:space-between;padding:10px 0;font-weight:700"><span>Total Portfolio</span><span style="font-family:var(--mono);color:var(--accent)">${fmtCur(total,cur==='NATIVE'?'NGN':cur,m,y)}</span></div>`;
  }
  else if(type==='budget'){
    title=`Budget vs Actual — ${MONTHS[m-1]} ${y}`;
    const cats=Object.keys(S.budgets);
    const actuals={};S.txns.forEach(t=>{actuals[t.category]=(actuals[t.category]||0)+(t.amount||0);});
    body=cats.filter(c=>S.budgets[c]>0).map(c=>{
      const bud=S.budgets[c]||0,act=actuals[c]||0,over=act>bud;
      return`<div style="padding:7px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="font-size:0.78rem">${c}</span>
          <span style="font-family:var(--mono);font-size:0.72rem;color:${over?'var(--red)':'var(--accent)'}">${fmtCur(act,cur,m,y)} / ${fmtCur(bud,cur,m,y)}</span>
        </div>
        <div style="height:4px;background:var(--border);border-radius:2px">
          <div style="height:4px;width:${Math.min(100,(act/bud)*100).toFixed(1)}%;background:${over?'var(--red)':'var(--accent)'};border-radius:2px"></div>
        </div>
      </div>`;
    }).join('');
  }

  document.getElementById('drill-title').innerHTML=title;
  document.getElementById('drill-body').innerHTML=body||'<div style="color:var(--text3);padding:12px 0">No data for this period.</div>';
  openMod('drill-modal');
}

// ══════════════════════════════════════════════════════════════════════════
// ACCOUNT TRANSACTION DRILLDOWN (bank account or investment platform)
// ══════════════════════════════════════════════════════════════════════════
function drillDownAccount(bankName){
  const m=S.dashMonth,y=S.dashYear,cur=S.dashCurrency;
  const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
  // Gather expenses, income, and transfers tagged to this account, sorted newest-first
  const xfrs=cGet(CK.xfr(m,y))||[];
  const txns=[
    ...S.txns.filter(t=>t.bank===bankName).map(t=>({...t,_type:'exp'})),
    ...S.income.filter(i=>i.bank===bankName).map(i=>({...i,_type:'inc'})),
    ...xfrs.filter(x=>x.from===bankName||x.to===bankName).map(x=>({...x,_type:'xfr'}))
  ].sort((a,b)=>a.date>b.date?-1:a.date<b.date?1:txnTs(b.createdAt)-txnTs(a.createdAt));

  const bal=S.cash[bankName];
  const balStr=bal!=null?(isUSDCashAccount(bankName)?` · $${bal.toFixed(2)}`:`  · ${fN(Math.round(bal))}`):'' ;
  document.getElementById('drill-title').innerHTML=`${esc(bankName)}${balStr}`;

  if(!txns.length){
    document.getElementById('drill-body').innerHTML='<div style="color:var(--text3);padding:12px 0">No transactions for this account this month.</div>';
    openMod('drill-modal');return;
  }

  document.getElementById('drill-body').innerHTML='<div class="txlist">'+txns.map(tx=>{
    const isInc=tx._type==='inc';
    const isXfr=tx._type==='xfr';
    if(isXfr){
      const isOut=tx.from===bankName;
      const counterpart=isOut?tx.to:tx.from;
      const amt=`${isOut?'−':'+'}${fmtCur(tx.amount,cur,m,y)}`;
      const badge=`<span style="font-size:0.55rem;font-weight:700;color:var(--gold);background:rgba(250,204,21,0.12);border-radius:3px;padding:1px 4px;margin-left:4px">XFR</span>`;
      return`<div class="txi" style="padding:7px 0;border-bottom:1px solid var(--border)">
        <div style="min-width:0;flex:1">
          <div class="txi-cat">${isOut?'Transfer out':'Transfer in'}${badge}</div>
          <div class="txi-meta">${fmtDate(tx.date)} · ${isOut?'→ ':'← '}${esc(counterpart)}${tx.notes?' · '+esc(tx.notes):''}</div>
        </div>
        <div class="txi-amt ${isOut?'txi-exp':'txi-inc'}" style="white-space:nowrap;margin-left:10px">${amt}</div>
      </div>`;
    }
    const icon=tx.category?(CAT_ICONS[tx.category]||''):'';
    const cat=tx.category||(isInc?'Income':'—');
    const sub=isInc?(tx.notes||''):(tx.payee&&tx.payee!==cat?esc(tx.payee):'')+(tx.notes?` · ${esc(tx.notes)}`:'');
    const amt=`${isInc?'+':'−'}${fmtCur(tx.amount,cur,m,y)}`;
    const badge=isInc?`<span style="font-size:0.55rem;font-weight:700;color:var(--accent);background:rgba(52,211,153,0.12);border-radius:3px;padding:1px 4px;margin-left:4px">INC</span>`:'';
    return`<div class="txi" style="padding:7px 0;border-bottom:1px solid var(--border)">
      <div style="min-width:0;flex:1">
        <div class="txi-cat">${icon?icon+'\u00a0':''}${esc(cat)}${badge}</div>
        <div class="txi-meta">${fmtDate(tx.date)}${sub?' · '+sub:''}</div>
      </div>
      <div class="txi-amt ${isInc?'txi-inc':'txi-exp'}" style="white-space:nowrap;margin-left:10px">${amt}</div>
    </div>`;
  }).join('')+'</div>';
  openMod('drill-modal');
}

function drillDownInvPlatform(pKey){
  PLATFORMS=getPlatforms();
  const m=S.dashMonth,y=S.dashYear,cur=S.dashCurrency;
  const plat=PLATFORMS.find(p=>p.key===pKey);
  if(!plat) return;
  const subs=migrateToSubs(pKey);
  const total=subs.reduce((s,sb)=>s+(Number(sb.principal)||0),0);

  document.getElementById('drill-title').innerHTML=`${esc(plat.label)} · ${total?fmtPlatformVal(total,pKey,cur,m,y):'—'}`;

  let body='';

  // Transfer history for this platform (deposits / withdrawals recorded via _saveXfrRecord)
  const xfrs=(cGet(CK.xfr(m,y))||[]).filter(x=>x.from===pKey||x.to===pKey)
    .sort((a,b)=>a.date>b.date?-1:a.date<b.date?1:txnTs(b.createdAt)-txnTs(a.createdAt));

  // Investment movements log
  const moves=getInvMovements().filter(mv=>mv.platformKey===pKey)
    .sort((a,b)=>a.date>b.date?-1:a.date<b.date?1:0);

  const hasActivity=xfrs.length||moves.length;

  if(hasActivity){
    body+=`<div style="font-size:0.65rem;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em;padding:10px 0 4px">Activity</div>`;

    // Merge transfers and movements into one chronological list
    const allActivity=[
      ...xfrs.map(x=>({date:x.date,createdAt:x.createdAt,_src:'xfr',data:x})),
      ...moves.map(mv=>({date:mv.date,createdAt:0,_src:'mv',data:mv}))
    ].sort((a,b)=>a.date>b.date?-1:a.date<b.date?1:txnTs(b.createdAt)-txnTs(a.createdAt));

    body+=allActivity.map(item=>{
      if(item._src==='xfr'){
        const x=item.data;
        const isOut=x.from===pKey;
        const counterpart=isOut?x.to:x.from;
        const amt=`${isOut?'−':'+'}${fmtCur(x.amount,cur,m,y)}`;
        const badge=`<span style="font-size:0.55rem;font-weight:700;color:var(--gold);background:rgba(250,204,21,0.12);border-radius:3px;padding:1px 4px;margin-left:4px">XFR</span>`;
        return`<div class="txi" style="padding:7px 0;border-bottom:1px solid var(--border)">
          <div style="min-width:0;flex:1">
            <div class="txi-cat">${isOut?'Transfer out':'Transfer in'}${badge}</div>
            <div class="txi-meta">${fmtDate(x.date)} · ${isOut?'→ ':'← '}${esc(counterpart)}${x.notes?' · '+esc(x.notes):''}</div>
          </div>
          <div class="txi-amt ${isOut?'txi-exp':'txi-inc'}" style="white-space:nowrap;margin-left:10px">${amt}</div>
        </div>`;
      } else {
        const mv=item.data;
        const isIn=mv.delta>0;
        return`<div class="txi" style="padding:7px 0;border-bottom:1px solid var(--border)">
          <div style="min-width:0;flex:1">
            <div class="txi-cat">${isIn?'Deposit':'Withdrawal'}</div>
            <div class="txi-meta">${fmtDate(mv.date)}${mv.notes?' · '+esc(mv.notes):''}</div>
          </div>
          <div class="txi-amt ${isIn?'txi-inc':'txi-exp'}" style="white-space:nowrap;margin-left:10px">${isIn?'+':'−'}${fN(Math.abs(mv.delta))}</div>
        </div>`;
      }
    }).join('');
  } else {
    body+=`<div style="color:var(--text3);padding:10px 0;font-size:0.75rem">No transfers recorded this month.</div>`;
  }

  // Sub-accounts summary
  if(subs.length){
    body+=`<div style="font-size:0.65rem;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em;padding:12px 0 4px">Sub-accounts</div>`;
    body+=subs.map(sb=>{
      const pr=Number(sb.principal)||0;
      const rateStr=sb.annualRate?` · ${sb.annualRate}% p.a.`:(sb.rate?` · ${sb.rate}% p.a.`:'');
      const matStr=sb.maturityDate?` · matures ${fmtDate(sb.maturityDate)}`:'';
      return`<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">
        <div style="min-width:0;flex:1">
          <div style="font-size:0.78rem;font-weight:600">${esc(sb.label||sb.name||'Sub-account')}</div>
          <div style="font-size:0.62rem;color:var(--text2);font-family:var(--mono)">${fmtDate(sb.startDate||'')}${rateStr}${matStr}</div>
        </div>
        <div style="font-family:var(--mono);font-size:0.82rem;color:${pr?plat.color:'var(--text3)'};white-space:nowrap;margin-left:10px">${pr?fmtPlatformVal(pr,pKey,cur,m,y):'—'}</div>
      </div>`;
    }).join('');
  }

  document.getElementById('drill-body').innerHTML=body;
  openMod('drill-modal');
}

// ══════════════════════════════════════════════════════════════════════════
// DEBTOR / LOAN ACTIVITY DRILLDOWN
// ══════════════════════════════════════════════════════════════════════════
// Shared row renderer for a debt-style ledger entry.
function _debtRow(label,meta,amt,isCredit){
  return`<div class="txi" style="padding:7px 0;border-bottom:1px solid var(--border)">
    <div style="min-width:0;flex:1">
      <div class="txi-cat">${label}</div>
      <div class="txi-meta">${meta}</div>
    </div>
    <div class="txi-amt ${isCredit?'txi-inc':'txi-exp'}" style="white-space:nowrap;margin-left:10px">${isCredit?'+':'−'}${amt}</div>
  </div>`;
}

function drillDownDebtor(id){
  const d=S.debtors.find(x=>x.id===id)||S.debtors[parseInt(id)];
  if(!d) return;
  const curSym=d.currency==='USD'?'$':d.currency==='GBP'?'£':'₦';
  const bal=(d.amount||0)-(d.paid||0);
  document.getElementById('drill-title').innerHTML=`${esc(d.name)} · ${curSym}${fNum(bal)} due`;

  // The original loan plus every subsequent top-up. Debtors created before
  // addLog existed have no entry for the opening amount, so synthesise one
  // from the record's own date/amount to keep the running balance honest.
  const adds=(d.addLog||[]).map(a=>({date:a.date,amount:a.amount,note:a.note||'',acct:a.disbursedFrom||'',_k:'add'}));
  const openingLogged=adds.reduce((s,a)=>s+(a.amount||0),0);
  const opening=(d.amount||0)-openingLogged;
  if(opening>0.005) adds.push({date:d.date||'',amount:opening,note:'Original loan',acct:d.acct||'',_k:'add'});
  const pmts=(d.pmtLog||[]).map(p=>({date:p.date,amount:p.amount,note:'',acct:p.creditedTo||'',_k:'pmt'}));
  // Payments recorded before pmtLog existed live only in the aggregate `paid`
  // field. Synthesise one entry for the untracked remainder so the running
  // balance reconciles to the real outstanding figure shown in the title.
  const pmtLogged=pmts.reduce((s,p)=>s+(p.amount||0),0);
  const priorPaid=(d.paid||0)-pmtLogged;
  if(priorPaid>0.005) pmts.push({date:d.date||'',amount:priorPaid,note:'Earlier payment',acct:'',_k:'pmt'});

  const merged=[...adds,...pmts];
  if(!merged.length){
    document.getElementById('drill-body').innerHTML='<div style="color:var(--text3);padding:12px 0">No activity recorded for this debtor.</div>';
    openMod('drill-modal');return;
  }

  // Chronological order for the running balance (oldest→newest). Same-date ties
  // put the loan before its repayment, since you can't repay before borrowing.
  const asc=[...merged].sort((a,b)=>{
    if(a.date!==b.date) return a.date<b.date?-1:1;
    return a._k==='add'?-1:b._k==='add'?1:0;
  });
  let run=0;
  const runMap=new Map();
  asc.forEach(e=>{run+=e._k==='add'?(e.amount||0):-(e.amount||0);runMap.set(e,run);});

  // Display newest-first.
  const all=[...asc].reverse();
  const body='<div class="txlist">'+all.map(e=>{
    const isAdd=e._k==='add';
    const badge=isAdd
      ?`<span style="font-size:0.55rem;font-weight:700;color:var(--gold);background:rgba(250,204,21,0.12);border-radius:3px;padding:1px 4px;margin-left:4px">LOANED</span>`
      :`<span style="font-size:0.55rem;font-weight:700;color:var(--accent);background:rgba(52,211,153,0.12);border-radius:3px;padding:1px 4px;margin-left:4px">PAID</span>`;
    const acct=e.acct?` · ${isAdd?'from ':'to '}${esc(e.acct)}`:'';
    const note=e.note?` · ${esc(e.note)}`:'';
    const meta=`${e.date?fmtDate(e.date):'—'}${acct}${note} · bal ${curSym}${fNum(runMap.get(e)||0)}`;
    return _debtRow((isAdd?'Loaned out':'Repayment')+badge,meta,curSym+fNum(e.amount||0),!isAdd);
  }).join('')+'</div>';

  document.getElementById('drill-body').innerHTML=body;
  openMod('drill-modal');
}

function drillDownLoan(id){
  const l=S.loans.find(x=>x.id===id);
  if(!l) return;
  const principal=l.amtNGN||l.amount||0;
  const outstanding=Math.max(0,principal-(l.repaid||0));
  document.getElementById('drill-title').innerHTML=`${esc(l.lender||l.name||'Loan')} · ${fN(Math.round(outstanding))} outstanding`;

  const rows=[
    ...(l.repayLog||[]).map(r=>({date:r.date,amount:r.amount,note:r.notes||'',acct:r.account||'',_k:'rp'})),
    {date:l.startDate||'',amount:principal,note:'Loan received',acct:l.acct||'',_k:'orig'}
  ].sort((a,b)=>a.date>b.date?-1:a.date<b.date?1:0);

  const body='<div class="txlist">'+rows.map(e=>{
    const isOrig=e._k==='orig';
    const badge=isOrig
      ?`<span style="font-size:0.55rem;font-weight:700;color:var(--gold);background:rgba(250,204,21,0.12);border-radius:3px;padding:1px 4px;margin-left:4px">BORROWED</span>`
      :`<span style="font-size:0.55rem;font-weight:700;color:var(--accent);background:rgba(52,211,153,0.12);border-radius:3px;padding:1px 4px;margin-left:4px">REPAID</span>`;
    const acct=e.acct?` · ${isOrig?'into ':'from '}${esc(e.acct)}`:'';
    const note=e.note?` · ${esc(e.note)}`:'';
    return _debtRow((isOrig?'Loan received':'Repayment')+badge,`${e.date?fmtDate(e.date):'—'}${acct}${note}`,fN(Math.round(e.amount||0)),isOrig);
  }).join('')+'</div>';

  document.getElementById('drill-body').innerHTML=body;
  openMod('drill-modal');
}

// ══════════════════════════════════════════════════════════════════════════
// CATEGORY DETAIL POPUP (from chart click)
// ══════════════════════════════════════════════════════════════════════════
let _catPopupTxns=[], _catPopupSort='expense';

function openCatPopup(cat, txns, cur, m, y){
  _catPopupTxns=[...txns];
  _catPopupSort='expense';
  document.getElementById('drill-title').innerHTML=`${CAT_ICONS[cat]||''} ${cat}`;
  _renderCatPopup(cur, m, y);
  openMod('drill-modal');
}

function _renderCatPopup(cur, m, y){
  cur=cur||S.dashCurrency; m=m||S.dashMonth; y=y||S.dashYear;
  const total=_catPopupTxns.reduce((s,t)=>s+(t.amount||0),0);

  let listHTML='';
  if(_catPopupSort==='date'){
    // Group by date, sorted most-recent first
    const byDate={};
    _catPopupTxns.forEach(tx=>{const d=tx.date||'';(byDate[d]=byDate[d]||[]).push(tx);});
    const dates=Object.keys(byDate).sort((a,b)=>a>b?-1:1);
    listHTML=dates.map(d=>{
      const dayTxns=byDate[d].sort((a,b)=>(b.amount||0)-(a.amount||0));
      const dayTotal=dayTxns.reduce((s,t)=>s+(t.amount||0),0);
      return`<div style="padding:6px 0 2px;font-size:0.68rem;font-weight:600;color:var(--text3);display:flex;justify-content:space-between;border-top:1px solid var(--border);margin-top:4px">
        <span>${fmtDate(d)}</span><span style="font-family:var(--mono);color:var(--text2)">${fmtCur(dayTotal,cur,m,y)}</span></div>
        ${dayTxns.map(tx=>`
        <div class="txi" style="padding:6px 0 6px 10px" onclick="openEditExpense('${tx.id}');closeMod('drill-modal')">
          <div style="flex:1;min-width:0">
            <div class="txi-cat" style="font-size:0.74rem">${esc(tx.payee)||'—'}</div>
            ${tx.notes?`<div class="txi-meta">${esc(tx.notes)}</div>`:''}
          </div>
          <div class="txi-amt txi-exp">${fmtCur(tx.amount,cur,m,y)}</div>
        </div>`).join('')}`;
    }).join('');
  } else {
    // Group by actual expense (payee), sorted by group total desc
    const byExpense={};
    _catPopupTxns.forEach(tx=>{const key=tx.payee||'—';(byExpense[key]=byExpense[key]||[]).push(tx);});
    const groups=Object.entries(byExpense)
      .map(([name,txns])=>({name,txns,total:txns.reduce((s,t)=>s+(t.amount||0),0)}))
      .sort((a,b)=>b.total-a.total);
    listHTML=groups.map(g=>{
      const gTxns=[...g.txns].sort((a,b)=>a.date>b.date?-1:a.date<b.date?1:txnTs(b.createdAt)-txnTs(a.createdAt));
      return`<div style="padding:6px 0 2px;font-size:0.68rem;font-weight:600;color:var(--text3);display:flex;justify-content:space-between;border-top:1px solid var(--border);margin-top:4px">
        <span>${esc(g.name)}</span><span style="font-family:var(--mono);color:var(--text2)">${fmtCur(g.total,cur,m,y)}</span></div>
        ${gTxns.map(tx=>`
        <div class="txi" style="padding:5px 0 5px 10px" onclick="openEditExpense('${tx.id}');closeMod('drill-modal')">
          <div style="flex:1;min-width:0">
            <div class="txi-meta">${fmtDate(tx.date)}${tx.bank?' · '+esc(tx.bank):''}</div>
            ${tx.notes?`<div class="txi-meta">${esc(tx.notes)}</div>`:''}
          </div>
          <div class="txi-amt txi-exp">${fmtCur(tx.amount,cur,m,y)}</div>
        </div>`).join('')}`;
    }).join('');
  }

  document.getElementById('drill-body').innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0 12px">
      <div style="font-family:var(--mono);font-size:0.88rem;color:var(--accent);font-weight:500">${fmtCur(total,cur,m,y)}<span style="font-size:0.62rem;color:var(--text3);margin-left:6px">${_catPopupTxns.length} transaction${_catPopupTxns.length!==1?'s':''}</span></div>
      <div style="display:flex;gap:6px">
        <button onclick="_catPopupSort='expense';_renderCatPopup()" class="btn btn-sm ${_catPopupSort==='expense'?'btn-p':'btn-g'}" style="font-size:0.62rem;padding:4px 8px">By expense</button>
        <button onclick="_catPopupSort='date';_renderCatPopup()" class="btn btn-sm ${_catPopupSort==='date'?'btn-p':'btn-g'}" style="font-size:0.62rem;padding:4px 8px">By date</button>
      </div>
    </div>
    <div class="txlist">${listHTML}</div>`;
}


// ══════════════════════════════════════════════════════════════════════════
// SEED / JSON IMPORT
// ══════════════════════════════════════════════════════════════════════════
let _pendingSeed=null;
function handleSeedFile(event){
  const file=event.target.files[0];if(!file) return;
  const reader=new FileReader();
  reader.onload=(e)=>{
    try{
      const seed=JSON.parse(e.target.result);
      if(!seed.transactions||!seed.income){document.getElementById('seed-status').innerHTML='<span style="color:var(--red)">Invalid file</span>';return;}
      _pendingSeed=seed;
      const preview=document.getElementById('seed-preview');preview.style.display='block';
      preview.innerHTML=`
        <div style="font-size:0.7rem;font-weight:700;color:var(--text2);margin-bottom:8px">${file.name}</div>
        ${[['Transactions',seed.transactions?.length||0],['Income',seed.income?.length||0],['Cash records',seed.cashBalances?.length||0],['Investments',seed.investments?.length||0],['Debtors',seed.debtors?.length||0],['History',seed.historicalSummary?.length||0]]
          .map(([k,v])=>`<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border);font-size:0.72rem"><span style="color:var(--text2)">${k}</span><span style="font-family:var(--mono);color:var(--accent)">${v}</span></div>`).join('')}
        <div style="margin-top:10px;display:flex;gap:8px">
          <button class="btn btn-p btn-sm" onclick="confirmSeedImport()">Import All Data</button>
          <button class="btn btn-g btn-sm" onclick="document.getElementById('seed-preview').style.display='none'">Cancel</button>
        </div>`;
      document.getElementById('seed-status').textContent='Review counts, then click Import.';
    }catch(err){document.getElementById('seed-status').innerHTML=`<span style="color:var(--red)">Parse error: ${err.message}</span>`;}
  };
  reader.readAsText(file);
}
async function confirmSeedImport(){
  const seed=_pendingSeed;if(!seed) return;
  const c={t:seed.transactions?.length||0,i:seed.income?.length||0,ca:seed.cashBalances?.length||0,iv:seed.investments?.length||0,d:seed.debtors?.length||0,h:seed.historicalSummary?.length||0};
  if(!confirm(`Import will load:\n${c.t} transactions · ${c.i} income entries\n${c.ca} cash records · ${c.iv} investment records\n${c.d} debtors · ${c.h} history rows\n\nApp loads instantly — Firebase syncs in background.`)) return;
  const statusEl=document.getElementById('seed-status');
  document.getElementById('seed-preview').style.display='none';
  statusEl.innerHTML='<span style="color:var(--gold)">Loading into app…</span>';
  // Write to localStorage immediately
  const txnsByM={},incByM={};
  for(const t of(seed.transactions||[])){const k=CK.txns(t.month,t.year);if(!txnsByM[k])txnsByM[k]=[];txnsByM[k].push(t);}
  for(const i of(seed.income||[])){const k=CK.inc(i.month,i.year);if(!incByM[k])incByM[k]=[];incByM[k].push(i);}
  for(const[k,v]of Object.entries(txnsByM)) cSet(k,v);
  for(const[k,v]of Object.entries(incByM)) cSet(k,v);
  for(const c of(seed.cashBalances||[])) cSet(CK.cash(c.month,c.year),c);
  for(const i of(seed.investments||[])) cSet(CK.inv(i.month,i.year),i);
  if(seed.debtors?.length) cSet(CK.debtors,seed.debtors);
  // Save historical summary as the HISTORY array used by charts/projections
  if(seed.historicalSummary?.length){
    const MS2=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const hist=seed.historicalSummary.map(h=>({
      year:h.year,month:h.month,
      label:h.label||(MS2[(h.month||1)-1]+" '"+String(h.year).slice(2)),
      income:h.income||0,expenses:h.expenses||0
    }));
    cSet('sw3_history',hist);
  }
  const ver=(seed._meta?.version||'imported')+' @ '+new Date().toLocaleDateString('en-GB');
  cSet(CK.fbSyncVer,ver);cSet(CK.lastSync,Date.now());
  // Reload S.* and render
  const m=S.expMonth,y=S.expYear;
  S.txns=cGet(CK.txns(m,y))||[];
  S.income=cGet(CK.inc(m,y))||[];
  S.investments=cGet(CK.inv(m,y))||{};
  S.cash=cGet(CK.cash(m,y))||{};
  S.debtors=seed.debtors||[];
  _pendingSeed=null;
  statusEl.innerHTML=`<span style="color:var(--accent)">✓ App loaded — syncing to Firebase…</span>`;
  toast('Data loaded');renderAll();
  // Background Firebase write
  if(!db){statusEl.innerHTML+=` <span style="color:var(--text2)">(Firebase not ready — data in local cache)</span>`;return;}
  setSyncStatus('syncing');
  (async()=>{
    try{
      const now=firebase.firestore.Timestamp.now();
      const mk=r=>`${r.year}-${String(r.month).padStart(2,'0')}`;
      async function batchSet(col,items,idFn){
        let b=db.batch(),n=0;
        for(const item of items){const ref=idFn?db.collection(col).doc(idFn(item)):db.collection(col).doc();b.set(ref,item,{merge:true});if(++n>=490){await b.commit();b=db.batch();n=0;}}
        if(n>0) await b.commit();
      }
      async function clearM(col,months){for(const{year,month}of months){try{const s=await db.collection(col).where('year','==',year).where('month','==',month).get();if(!s.empty){let b=db.batch();s.docs.forEach(d=>b.delete(d.ref));await b.commit();}}catch(e){}}}
      if(seed.historicalSummary?.length) await batchSet('historicalSummary',seed.historicalSummary,mk);
      if(seed.cashBalances?.length) await batchSet('cashBalances',seed.cashBalances,mk);
      if(seed.investments?.length) await batchSet('investments',seed.investments,mk);
      const txnMs=[...new Map(seed.transactions.map(t=>[`${t.year}-${t.month}`,t])).values()];
      await clearM('transactions',txnMs);
      await batchSet('transactions',seed.transactions.map(t=>({...t,createdAt:now})),null);
      const incMs=[...new Map(seed.income.map(i=>[`${i.year}-${i.month}`,i])).values()];
      await clearM('income',incMs);
      await batchSet('income',seed.income.map(i=>({...i,createdAt:now})),null);
      if(seed.debtors?.length){const ex=await db.collection('debtors').get();if(!ex.empty){const b=db.batch();ex.docs.forEach(d=>b.delete(d.ref));await b.commit();}await batchSet('debtors',seed.debtors.map(d=>({...d,createdAt:now})),null);}
      cSet(CK.lastSync,Date.now());setSyncStatus('synced');hideStaleBar();
      if(statusEl) statusEl.innerHTML=`<span style="color:var(--accent)">✓ Firebase sync complete</span>`;
      toast('Firebase sync complete');renderSettData();
    }catch(err){
      console.error('Firebase seed error:',err);setSyncStatus('error');
      if(statusEl) statusEl.innerHTML+=`<br><span style="color:var(--gold)">⚠ Firebase failed (${err.message}) — safe in local cache</span>`;
    }
  })();
}


// ══════════════════════════════════════════════════════════════════════════
// ONLINE/OFFLINE
// ══════════════════════════════════════════════════════════════════════════
window.addEventListener('online',()=>{
  document.getElementById('offl').style.display='none';setSyncStatus('syncing');
  if(db){
    const m=S.expMonth,y=S.expYear;
    syncAll().then(()=>{
      if(S.expMonth===m&&S.expYear===y){
        S.txns=cGet(CK.txns(m,y))||S.txns;
        S.income=cGet(CK.inc(m,y))||S.income;
        S.investments=cGet(CK.inv(m,y))||S.investments;
        S.cash=cGet(CK.cash(m,y))||S.cash;
      }
      setSyncStatus('synced');cSet(CK.lastSync,Date.now());hideStaleBar();renderAll();startRealtimeListeners();
    }).catch(()=>setSyncStatus('error'));
  }
});
window.addEventListener('offline',()=>{document.getElementById('offl').style.display='block';setSyncStatus('offline');});
if(!navigator.onLine) document.getElementById('offl').style.display='block';
['exp-modal','deb-modal','inc-modal','move-modal','merge-cat-modal'].forEach(id=>{const el=document.getElementById(id);if(el)el.addEventListener('click',function(e){if(e.target===this)closeMod(id);});});
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});


// ── ONE-TIME MIGRATION: Fife → Kids ──────────────────────────────────────
async function _migrateFifeToKids(){
  const MKEY='sw3_migrated_fife_kids';
  if(localStorage.getItem(MKEY)) return; // already done
  try{
    // Migrate transactions
    const txSnap=await db.collection('transactions').where('category','==','Fife').get();
    // Migrate income (unlikely but safe)
    const incSnap=await db.collection('income').where('category','==','Fife').get();
    const allDocs=[...txSnap.docs,...incSnap.docs];
    if(!allDocs.length){localStorage.setItem(MKEY,'1');return;}
    // Batch update in groups of 500
    const CHUNK=500;
    for(let i=0;i<allDocs.length;i+=CHUNK){
      const batch=db.batch();
      allDocs.slice(i,i+CHUNK).forEach(doc=>batch.update(doc.ref,{category:'Kids'}));
      await batch.commit();
    }
    // Also update any cached localStorage entries
    Object.keys(localStorage).filter(k=>k.startsWith('sw3_txns_')||k.startsWith('sw3_inc_')).forEach(k=>{
      try{
        const arr=JSON.parse(localStorage.getItem(k));
        if(!Array.isArray(arr)) return;
        let changed=false;
        arr.forEach(t=>{if(t.category==='Fife'){t.category='Kids';changed=true;}});
        if(changed) localStorage.setItem(k,JSON.stringify(arr));
      }catch(e){}
    });
    localStorage.setItem(MKEY,'1');
    console.log(`SpendWise: migrated ${allDocs.length} Fife→Kids records`);
    toast('Category migration complete: Fife → Kids');
  }catch(e){
    console.warn('Fife→Kids migration failed:',e);
  }
}
// ── Version check against GitHub Pages ──
const APP_VERSION='v4.4.1';
async function checkForUpdate(){
  try{
    const res=await fetch('https://ssseyon.github.io/spendwise/?_='+Date.now(),{cache:'no-store'});
    if(!res.ok)return;
    const html=await res.text();
    const m=html.match(/ver-lbl[^>]*>\s*(v[\d.]+)\s*</i);
    if(!m)return;
    const remote=m[1].trim();
    if(remote!==APP_VERSION){
      const banner=document.getElementById('sw-update-banner');
      const msg=document.getElementById('sw-update-msg');
      if(msg)msg.textContent=`Update available: ${APP_VERSION} → ${remote}`;
      if(banner)banner.style.display='block';
    }
  }catch(e){}
}
// ── USD Cash repair: reads USDHoldings from Firestore investments, writes to cashBalances ──
async function _migrateEnergyFirestore(){
  // Non-blocking background Firestore migration: Energy → Fuel
  try{
    const snap=await db.collection('transactions').where('category','==','Energy').get();
    if(snap&&!snap.empty){
      const chunks=[];const docs=snap.docs;
      for(let i=0;i<docs.length;i+=400)chunks.push(docs.slice(i,i+400));
      for(const chunk of chunks){
        const batch=db.batch();
        chunk.forEach(d=>batch.update(d.ref,{category:'Fuel'}));
        await batch.commit();
      }
      console.log(`[migration] Energy→Fuel: updated ${snap.size} Firestore transactions`);
    }
  }catch(e){console.warn('[migration] Energy→Fuel Firestore step failed (will retry on next load if not flagged)',e);}
}

async function _repairUSDCash(){
  if(cGet('sw3_usd_repair_v2')) return; // already done on this device
  try{
    // Check a Firestore-wide flag too, so a new device / cleared storage /
    // private session doesn't silently re-run this and overwrite historical
    // "USD Cash" values with a freshly recomputed absolute figure.
    try{
      const migDoc=await db.collection('appConfig').doc('migrations').get();
      if(migDoc.exists&&migDoc.data()?.usdRepairV2){cSet('sw3_usd_repair_v2','1');return;}
    }catch(e){}
    const snap=await db.collection('investments').get();
    if(snap.empty){cSet('sw3_usd_repair_v2','1');return;}
    const batch=db.batch();
    let repaired=0;
    snap.forEach(doc=>{
      const d=doc.data();
      if(!d.USDHoldings||d.USDHoldings<=0) return;
      const m=d.month,y=d.year;
      if(!m||!y) return;
      const fxR=getFxRates(m,y);
      const usdAmt=+(d.USDHoldings/(fxR.USD||1600)).toFixed(2);
      const cashRef=db.collection('cashBalances').doc(sid(m,y));
      batch.set(cashRef,{'USD Cash':usdAmt,month:m,year:y},{merge:true});
      // Also update local cache
      const cached=cGet(CK.cash(m,y))||{};
      if(!cached['USD Cash']||cached['USD Cash']===0){
        cached['USD Cash']=usdAmt;
        cSet(CK.cash(m,y),cached);
      }
      repaired++;
    });
    if(repaired>0){
      await batch.commit();
      // Refresh current view
      S.cash=cGet(CK.cash(S.cashMonth||S.expMonth,S.cashYear||S.expYear))||{};
      if(typeof renderDashboard==='function') renderDashboard();
      if(typeof renderCashPage==='function') renderCashPage();
      toast(`USD Cash restored across ${repaired} month(s)`);
    }
    try{await db.collection('appConfig').doc('migrations').set({usdRepairV2:true},{merge:true});}catch(e){}
    cSet('sw3_usd_repair_v2','1');
  }catch(e){console.warn('USD Cash repair failed:',e);}
}
// BOOT
initFirebase();
_requestNotifPermission();
setTimeout(checkForUpdate, 3000); // check after initial load settles
// Wait until db is initialised before running one-time migrations
(function _waitForDbThenMigrate(){
  if(typeof db !== 'undefined' && db){
    _migrateFifeToKids();
    _repairUSDCash();
  } else {
    setTimeout(_waitForDbThenMigrate, 500);
  }
})();

// ══════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════
function getInvWithdrawals(){return cGet(INV_WD_KEY)||[];}
function addInvWithdrawal(pKey,amtNGN,date,notes){
  const list=getInvWithdrawals();
  list.push({platformKey:pKey,amountNGN:amtNGN,date:date||todayStr(),notes:notes||''});
  cSet(INV_WD_KEY,list);
}
// ── Withdrawal-aware accrual movements ──────────────────────────────────
// delta: positive = deposit, negative = withdrawal
function getInvMovements(){return cGet(INV_MOVE_KEY)||[];}
function addInvMovement(pKey,delta,date,notes){
  if(!delta) return;
  const list=getInvMovements();
  list.push({platformKey:pKey,delta:Math.round(delta),date:date||todayStr(),notes:notes||''});
  cSet(INV_MOVE_KEY,list);
}
function getMovementsForPlatform(pKey){
  return getInvMovements().filter(m=>m.platformKey===pKey).map(m=>({date:m.date,delta:m.delta}));
}
function getRealisedGain(pKey){
  const cost=cGet('sw3_inv_cost_'+pKey)||0;if(!cost)return null;
  const totalWd=getInvWithdrawals().filter(w=>w.platformKey===pKey).reduce((s,w)=>s+(w.amountNGN||0),0);
  return(S.investments[pKey]||0)+totalWd-cost;
}
function _renderWithdrawalSummary(suffix){
  const s=suffix||'';
  const elId='inv-wd-summary'+s;
  let el=document.getElementById(elId);
  if(!el){
    const currentDiv=document.getElementById('inv-current'+s);if(!currentDiv)return;
    el=document.createElement('div');el.id=elId;el.className='card';currentDiv.appendChild(el);
  }
  const wds=getInvWithdrawals();
  if(!wds.length){el.style.display='none';return;}
  el.style.display='block';
  const byPlat={};
  wds.forEach(w=>{byPlat[w.platformKey]=(byPlat[w.platformKey]||0)+(w.amountNGN||0);});
  const rows=Object.entries(byPlat).map(([k,total])=>{
    const p=PLATFORMS.find(pl=>pl.key===k);
    const rg=getRealisedGain(k);
    return`<div class="pjrow"><span class="pjlabel">${p?p.label:k} withdrawals</span><span class="pjval" style="color:var(--text2)">${fN(Math.round(total))}${rg!==null?`<span style="font-size:0.62rem;color:${rg>=0?'var(--accent)':'var(--red)'};margin-left:4px">${rg>=0?'+':''}${fN(Math.round(rg))}</span>`:''}</span></div>`;
  }).join('');
  el.innerHTML=`<div class="sh" style="margin-bottom:8px"><div class="sh-title" style="font-size:0.78rem">Withdrawal History & Realised Gains</div></div>${rows}<div class="csub" style="margin-top:6px">Realised gain = current value + total withdrawn − cost basis</div>`;
}

// ══════════════════════════════════════════════════════════════════════════
// MONTHLY SAVINGS TARGET
// ══════════════════════════════════════════════════════════════════════════
function getSavingsTarget(){return parseFloat(cGet(SAVINGS_TARGET_KEY))||0;}
function saveSavingsTarget(pct){cSet(SAVINGS_TARGET_KEY,pct);}
function saveSavingsTargetUI(){
  const el=document.getElementById('st-pct');
  const pct=parseFloat(el?.value)||0;
  saveSavingsTarget(pct);
  toast(pct?`Savings target set: ${pct}%`:'Savings target cleared');
  renderDashAlerts();
}

// ══════════════════════════════════════════════════════════════════════════
// OVERDUE DEBTOR HELPERS
// ══════════════════════════════════════════════════════════════════════════
function _getOverdueDebtors(){
  const now=new Date();
  return S.debtors.filter(d=>{
    if(d.expectRepayment===false||(d.ngnBalance||0)<=0)return false;
    let lastDate=d.date||'';
    if(d.pmtLog&&d.pmtLog.length)lastDate=d.pmtLog[d.pmtLog.length-1].date;
    if(!lastDate)return false;
    return Math.floor((now-new Date(lastDate))/(864e5))>60;
  });
}

// ══════════════════════════════════════════════════════════════════════════
// NET WORTH DELTA BADGE helper
// ══════════════════════════════════════════════════════════════════════════
function _getNWDeltaBadge(m,y){
  if(m===0)return'';
  const prevM=m===1?12:m-1,prevY=m===1?y-1:y;
  const prevInv=cGet(CK.inv(prevM,prevY))||{};
  const prevCash=cGet(CK.cash(prevM,prevY))||{};
  const prevNW=PLATFORMS.reduce((s,p)=>s+(prevInv[p.key]||0),0)+cashTotalNGN(prevCash);
  if(!prevNW)return'';
  const curNW=PLATFORMS.reduce((s,p)=>s+(S.investments[p.key]||0),0)+cashTotalNGN(S.cash);
  const delta=curNW-prevNW;if(!delta)return'';
  const pct=Math.round(Math.abs(delta)/prevNW*100);
  const up=delta>0;
  return`<span class="mom-badge ${up?'mom-dn':'mom-up'}" style="vertical-align:middle"> ${up?'▲':'▼'} ${fN(Math.abs(delta))} (${pct}%)</span>`;
}

// ══════════════════════════════════════════════════════════════════════════
// STACKED AREA CHART — Equities vs Fixed Income over time
// ══════════════════════════════════════════════════════════════════════════
let _allocChart=null;
async function renderInvAllocChart(suffix){
  const s=suffix||'';
  const trendDiv=document.getElementById('inv-trend'+s);if(!trendDiv)return;
  const elId='inv-alloc-chart-wrap'+s;
  if(!document.getElementById(elId)){
    const wrap=document.createElement('div');
    wrap.id=elId;wrap.className='card';wrap.style.marginTop='10px';
    wrap.innerHTML=`<div class="clabel" style="margin-bottom:12px">Equities vs Fixed Income</div><canvas id="inv-alloc-chart${s}" style="max-height:180px"></canvas><div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap"><div style="display:flex;align-items:center;gap:5px;font-size:0.63rem;color:var(--text2)"><div style="width:8px;height:8px;border-radius:2px;background:#60a5fa"></div>Equities</div><div style="display:flex;align-items:center;gap:5px;font-size:0.63rem;color:var(--text2)"><div style="width:8px;height:8px;border-radius:2px;background:#fbbf24"></div>Fixed Income</div></div>`;
    trendDiv.appendChild(wrap);
  }
  const canvasId='inv-alloc-chart'+s;
  try{
    let snap;
    try{snap=await db.collection('investments').get({source:'server'});}
    catch(e){snap=await db.collection('investments').get();}
    if(!snap||snap.empty)return;
    const sorted=snap.docs.map(d=>{const doc=d.data();return{year:doc.year,month:doc.month,label:`${MS[(doc.month||1)-1]} '${String(doc.year||2024).slice(2)}`,data:doc};}).filter(d=>d.year&&d.month).sort((a,b)=>a.year!==b.year?a.year-b.year:a.month-b.month);
    const pts=sorted.map(d=>{let eq=0,fi=0;PLATFORMS.forEach(p=>{const val=d.data[p.key]||0;if(getInvPlatformMeta(p.key).assetClass==='fixed_income')fi+=val;else eq+=val;});return{label:d.label,eq,fi};}).filter(p=>p.eq+p.fi>0);
    if(pts.length<2)return;
    if(_allocChart){try{_allocChart.destroy();}catch(e){}_allocChart=null;}
    let canvas=document.getElementById(canvasId);if(!canvas)return;
    const newCanvas=document.createElement('canvas');newCanvas.id=canvasId;newCanvas.style.cssText='max-height:180px';
    canvas.parentNode.replaceChild(newCanvas,canvas);canvas=newCanvas;
    const ctx=canvas.getContext('2d');
    _allocChart=new Chart(ctx,{type:'bar',data:{labels:pts.map(p=>p.label),datasets:[
      {label:'Equities',data:pts.map(p=>p.eq),backgroundColor:'rgba(96,165,250,0.75)',borderRadius:2,borderSkipped:false},
      {label:'Fixed Income',data:pts.map(p=>p.fi),backgroundColor:'rgba(251,191,36,0.75)',borderRadius:2,borderSkipped:false}
    ]},options:{responsive:true,maintainAspectRatio:true,interaction:{mode:'index',intersect:false},plugins:{legend:{display:true,position:'bottom',labels:{color:'#7d8fa8',font:{family:'DM Mono',size:9},boxWidth:8,padding:8}},tooltip:{backgroundColor:'#12122a',borderColor:'#1f1f3a',borderWidth:1,callbacks:{label:c=>c.dataset.label+': '+fmtChartNGN(c.parsed.y)}}},scales:{x:{grid:{display:false},ticks:{color:'#3a3a6a',font:{family:'DM Mono',size:9}},border:{display:false},stacked:true},y:{display:false,stacked:true}},barPercentage:0.72}});
  }catch(e){console.warn('allocChart',e);}
}

// ══════════════════════════════════════════════════════════════════════════
// CASH FLOW PROJECTION + BREAK-EVEN helper
// ══════════════════════════════════════════════════════════════════════════
function renderCashFlowProjection(containerEl){
  if(!containerEl)return;
  const hist=getHistory().filter(h=>h.income>0||h.expenses>0).slice(-6);
  if(hist.length<2){containerEl.innerHTML='<div class="csub" style="padding:8px 0">Need more history for projection</div>';return;}
  const avgInc=hist.reduce((s,h)=>s+(h.income||0),0)/hist.length;
  const avgExp=hist.reduce((s,h)=>s+(h.expenses||0),0)/hist.length;
  const cashNow=cashTotalNGN(S.cash);
  let monthlyInt=0;
  const intMeta=getCashInterestMeta();
  getCashAccounts().forEach(b=>{const ci=intMeta[b];if(ci&&ci.interestRate)monthlyInt+=(S.cash[b]||0)*(ci.interestRate/100/12);});
  PLATFORMS.forEach(p=>{const meta=getInvPlatformMeta(p.key);if(meta.assetClass==='fixed_income'&&meta.interestRate)monthlyInt+=(S.investments[p.key]||0)*(meta.interestRate/100/12);});
  const netPerMonth=avgInc+monthlyInt-avgExp;
  const now=new Date();let runningCash=cashNow;
  const months=[];
  for(let i=1;i<=3;i++){const d=new Date(now.getFullYear(),now.getMonth()+i,1);runningCash+=netPerMonth;months.push({label:MS[d.getMonth()]+" '"+String(d.getFullYear()).slice(2),cash:Math.round(runningCash)});}
  const breakEven=avgExp>avgInc+monthlyInt&&cashNow>0?Math.ceil(cashNow/(avgExp-avgInc-monthlyInt)):null;
  containerEl.innerHTML=`
    <div class="sh" style="margin-bottom:10px"><div class="sh-title">3-Month Cash Projection</div></div>
    <div class="pjrow"><span class="pjlabel">Avg. monthly income (6m)</span><span class="pjval" style="color:var(--accent)">${fN(Math.round(avgInc))}</span></div>
    ${monthlyInt>500?`<div class="pjrow"><span class="pjlabel">Est. monthly interest</span><span class="pjval" style="color:var(--gold)">+${fN(Math.round(monthlyInt))}</span></div>`:''}
    <div class="pjrow"><span class="pjlabel">Avg. monthly spend (6m)</span><span class="pjval" style="color:var(--red)">${fN(Math.round(avgExp))}</span></div>
    <div class="pjrow" style="font-weight:700;border-top:1px solid var(--border);padding-top:6px;margin-top:4px"><span>Monthly net</span><span class="pjval" style="color:${netPerMonth>=0?'var(--accent)':'var(--red)'}">${fN(Math.round(Math.abs(netPerMonth)))} ${netPerMonth>=0?'saved':'deficit'}</span></div>
    <div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px">
      <div style="font-size:0.6rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--text3);margin-bottom:6px">Projected Cash Balance</div>
      ${months.map(mo=>`<div class="pjrow"><span class="pjlabel">${mo.label}</span><span class="pjval" style="color:${mo.cash>0?'var(--blue)':'var(--red)'}">${fN(mo.cash)}</span></div>`).join('')}
    </div>
    ${breakEven?`<div style="margin-top:10px;padding:8px 10px;border-radius:var(--rsm);background:var(--rdim);font-size:0.72rem;color:var(--red)">⚠ Break-even: cash exhausted in ~${breakEven} month${breakEven!==1?'s':''} at current burn rate</div>`:'<div style="margin-top:6px;font-size:0.68rem;color:var(--accent)">✓ Cash trajectory is positive over next 3 months</div>'}
  `;
}

// ══════════════════════════════════════════════════════════════════════════
// MERGE CATEGORY
// ══════════════════════════════════════════════════════════════════════════
let _mergeFrom='', _mergeInto='';

function openMergeCatModal(){
  const fromEl=document.getElementById('merge-from');
  const intoEl=document.getElementById('merge-into');
  if(!fromEl||!intoEl) return;
  _mergeFrom=fromEl.value;
  _mergeInto=intoEl.value;
  if(!_mergeFrom||!_mergeInto){toast('Select both categories');return;}
  if(_mergeFrom===_mergeInto){toast('Source and target must differ');return;}
  // Count affected transactions across all cached months
  let txnCount=0;
  const allKeys=Object.keys(localStorage).filter(k=>k.startsWith('sw3_txns_'));
  allKeys.forEach(k=>{
    const arr=cGet(k)||[];
    txnCount+=arr.filter(t=>t.category===_mergeFrom).length;
  });
  // Get current budgets for both
  const fromBudg=S.budgets[ck(_mergeFrom)]||0;
  const intoBudg=S.budgets[ck(_mergeInto)]||0;
  const mergedBudg=fromBudg+intoBudg;
  const isCustomFrom=!_BASE_CATS.includes(_mergeFrom);
  const body=document.getElementById('merge-cat-body');
  if(body) body.innerHTML=`
    <div style="background:var(--bg2);border-radius:var(--rsm);padding:12px 14px;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:10px;font-size:0.9rem;font-weight:700">
        <span>${CAT_ICONS[_mergeFrom]||'📦'} ${_mergeFrom}</span>
        <span style="color:var(--text3)">→</span>
        <span>${CAT_ICONS[_mergeInto]||'📦'} ${_mergeInto}</span>
      </div>
    </div>
    <div class="pjrow"><span class="pjlabel">Transactions to reassign</span><span class="pjval">${txnCount} found in cache</span></div>
    <div class="pjrow"><span class="pjlabel">${_mergeFrom} budget</span><span class="pjval">${fN(fromBudg)}</span></div>
    <div class="pjrow"><span class="pjlabel">${_mergeInto} budget</span><span class="pjval">${fN(intoBudg)}</span></div>
    <div class="pjrow" style="font-weight:700"><span>Combined budget</span><span class="pjval" style="color:var(--accent)">${fN(mergedBudg)}</span></div>
    <div style="margin-top:12px;padding:8px 10px;border-radius:var(--rsm);background:var(--rdim);font-size:0.7rem;color:var(--red);line-height:1.5">
      ⚠ This rewrites transaction history permanently. All <strong>${_mergeFrom}</strong> transactions across all months will become <strong>${_mergeInto}</strong>.
      ${isCustomFrom?' The source category will be deleted after merging.':' Built-in categories cannot be deleted but will be cleared.'}
    </div>`;
  openMod('merge-cat-modal');
}

async function execMergeCat(){
  const btn=document.getElementById('merge-cat-confirm');
  if(btn){btn.textContent='Merging…';btn.disabled=true;}
  setSyncStatus('syncing');
  try{
    const fromKey=ck(_mergeFrom), intoKey=ck(_mergeInto);

    // ── 1. Reassign transactions in Firestore (batch) ──────────────────
    let snap;
    try{snap=await db.collection('transactions').where('category','==',_mergeFrom).get();}
    catch(e){snap=null;}
    if(snap&&!snap.empty){
      // Firestore batches are limited to 500 ops
      const chunks=[];
      const docs=snap.docs;
      for(let i=0;i<docs.length;i+=400) chunks.push(docs.slice(i,i+400));
      for(const chunk of chunks){
        const batch=db.batch();
        chunk.forEach(d=>batch.update(d.ref,{category:_mergeInto}));
        await batch.commit();
      }
    }

    // ── 2. Reassign transactions in all local caches ───────────────────
    const allTxnKeys=Object.keys(localStorage).filter(k=>k.startsWith('sw3_txns_'));
    allTxnKeys.forEach(lsKey=>{
      const arr=cGet(lsKey);
      if(!arr) return;
      let changed=false;
      arr.forEach(t=>{if(t.category===_mergeFrom){t.category=_mergeInto;changed=true;}});
      if(changed) cSet(lsKey,arr);
    });
    // Update current month's in-memory txns
    S.txns.forEach(t=>{if(t.category===_mergeFrom)t.category=_mergeInto;});

    // ── 3. Migrate payee lines from source → target ────────────────────
    // Move CAT_LINES entries (built-in payees) to the target category
    const srcLines=CAT_LINES[_mergeFrom]||[];
    if(srcLines.length){
      if(!CAT_LINES[_mergeInto]) CAT_LINES[_mergeInto]=[];
      srcLines.forEach(l=>{if(!CAT_LINES[_mergeInto].includes(l))CAT_LINES[_mergeInto].push(l);});
      CAT_LINES[_mergeFrom]=[];
    }
    // Move customExpLines entries (user-added payees) to the target category
    const srcCustom=S.customExpLines[_mergeFrom]||[];
    if(srcCustom.length){
      if(!S.customExpLines[_mergeInto]) S.customExpLines[_mergeInto]=[];
      srcCustom.forEach(l=>{if(!S.customExpLines[_mergeInto].includes(l))S.customExpLines[_mergeInto].push(l);});
      delete S.customExpLines[_mergeFrom];
      cSet(CK.customLines,S.customExpLines);
    }

    // ── 3. Merge budgets across all historical Firestore budget docs ───
    let budgetSnap;
    try{budgetSnap=await db.collection('budgets').get();}catch(e){budgetSnap=null;}
    if(budgetSnap&&!budgetSnap.empty){
      const batch=db.batch();
      budgetSnap.docs.forEach(d=>{
        const cats=d.data().categories||{};
        const fromAmt=cats[fromKey]||0;
        const intoAmt=cats[intoKey]||0;
        if(fromAmt>0){
          const updated={...cats,[intoKey]:intoAmt+fromAmt,[fromKey]:0};
          batch.update(d.ref,{categories:updated});
        }
      });
      await batch.commit();
    }

    // ── 4. Merge budgets in all local budget caches ────────────────────
    const allBudgetKeys=Object.keys(localStorage).filter(k=>k.startsWith('sw3_budgets_'));
    allBudgetKeys.forEach(lsKey=>{
      const cacheKey=lsKey.replace(/^sw3_/,'');
      const budg=cGet(cacheKey);
      if(!budg) return;
      const fromAmt=budg[fromKey]||0;
      if(fromAmt>0){
        budg[intoKey]=(budg[intoKey]||0)+fromAmt;
        budg[fromKey]=0;
        cSet(cacheKey,budg);
      }
    });
    // Update current in-memory budget
    const curFromAmt=S.budgets[fromKey]||0;
    S.budgets[intoKey]=(S.budgets[intoKey]||0)+curFromAmt;
    S.budgets[fromKey]=0;
    cSet(CK.budgets(S.expMonth,S.expYear),S.budgets);

    // ── 5. Remove source from custom cats list (if custom) ─────────────
    if(!_BASE_CATS.includes(_mergeFrom)){
      const custom=getCustomCats().filter(c=>c!==_mergeFrom);
      saveCustomCats(custom);
    }

    closeMod('merge-cat-modal');
    // Bust all transaction localStorage caches — the Firestore docs were just
    // updated in batch, so every month loaded after this will come from the
    // correct (renamed) Firestore data via the snapshot listener.
    Object.keys(localStorage).filter(k=>k.startsWith('sw3_txns_')||k.startsWith('sw3_inc_')).forEach(k=>localStorage.removeItem(k));
    toast(`Merged: ${_mergeFrom} → ${_mergeInto}`);haptic([8,40,8]);setSyncStatus('synced');
    renderExpenses();renderDashboard();renderSettBudget();
  }catch(e){
    console.error('Merge error',e);
    toast('Error during merge — partial changes may have saved');setSyncStatus('error');
    if(btn){btn.textContent='Merge';btn.disabled=false;}
  }
}

// ── PULL-TO-REFRESH ────────────────────────────────────────────────────
(function(){
  const THRESHOLD = 72;   // px of pull needed to trigger
  const appBody   = document.getElementById('app-body');
  const indicator = document.getElementById('ptr-indicator');
  const arrow     = document.getElementById('ptr-arrow');
  const label     = document.getElementById('ptr-label');
  if(!appBody||!indicator) return;

  let startY=0, pulling=false, triggered=false;

  appBody.addEventListener('touchstart', e=>{
    // Disabled on the Analytics page: its inner scroll areas (the AI chat log,
    // long history lists) sit at appBody.scrollTop===0, so scrolling up to read
    // would otherwise inadvertently trigger a refresh.
    if(S.page==='forecast') return;
    // Only begin if scrolled to the very top
    if(appBody.scrollTop===0) {startY=e.touches[0].clientY; pulling=true; triggered=false;}
  },{passive:true});

  appBody.addEventListener('touchmove', e=>{
    if(!pulling) return;
    const dy = e.touches[0].clientY - startY;
    if(dy<=0){pulling=false;_resetPtr();return;}
    // Show indicator — clamp height to 2× threshold max
    const pct = Math.min(dy/THRESHOLD, 2);
    indicator.style.height = Math.min(dy*0.4, 44)+'px';
    indicator.classList.add('ptr-visible');
    if(dy>=THRESHOLD){
      arrow.classList.add('flipped');
      label.textContent='Release to refresh';
      triggered=true;
    } else {
      arrow.classList.remove('flipped');
      label.textContent='Pull to refresh';
      triggered=false;
    }
  },{passive:true});

  appBody.addEventListener('touchend', ()=>{
    if(!pulling) return;
    pulling=false;
    if(triggered){
      // Show spinning state, then hard-refresh
      arrow.style.display='none';
      label.textContent='Refreshing…';
      indicator.style.height='44px';
      const spin=document.createElement('span');spin.className='ptr-spinner';
      indicator.insertBefore(spin,label);
      setTimeout(()=>forceHardRefresh(), 400);
    } else {
      _resetPtr();
    }
  },{passive:true});

  function _resetPtr(){
    indicator.style.height='0';
    indicator.classList.remove('ptr-visible','ptr-releasing');
    arrow.classList.remove('flipped');
    arrow.style.display='';
    label.textContent='Pull to refresh';
  }
})();

// ══════════════════════════════════════════════════════════════════════════
// AI ANALYST (Analytics → AI) — Gemini-powered analysis and chat grounded in
// the user's complete financial history. The API key is pasted by the user
// and lives ONLY in this device's localStorage — never in code or Firestore
// (the repo and the Firestore project are both publicly readable).
// ══════════════════════════════════════════════════════════════════════════
// var + function declarations (not const/let): renderAll() runs during init,
// before this end-of-file module body executes — hoisting keeps that safe.
var AI_KEY_LS='sw3_gemini_key', AI_CHAT_LS='sw3_ai_chat', AI_MODEL_LS='sw3_gemini_model';
var AI_CHATS_LS='sw3_ai_chats', AI_ACTIVE_LS='sw3_ai_active';
// Tried in order until one answers; the winner is remembered per device.
var AI_MODELS=['gemini-2.5-flash','gemini-2.0-flash','gemini-1.5-flash'];
var _aiCtx=null,_aiCtxAt=0,_aiBusy=false;
// True while composing a brand-new, not-yet-sent conversation (device-local).
var _aiNewMode=false;
function _aiKey(){return cGet('sw3_gemini_key')||'';}

// ── Multi-conversation store ────────────────────────────────────────────────
// Each conversation is one Firestore doc in the `aiChats` collection:
//   {title, msgs:[{r,t}], createdAt, updatedAt}   (createdAt/updatedAt = epoch ms)
// giving every chat its own 1MB budget and letting one be deleted on its own.
// The active-chat pointer is device-local (which chat you're reading is UI
// state, not data). The Gemini API key is never synced.
function _aiChats(){if(!Array.isArray(S.aiChats))S.aiChats=cGet(AI_CHATS_LS)||[];return S.aiChats;}
function _aiActiveId(){return cGet(AI_ACTIVE_LS)||'';}
function _aiSetActive(id){cSet(AI_ACTIVE_LS,id||'');}
function _chatById(id){return _aiChats().find(c=>c.id===id)||null;}
function _aiSortChats(arr){arr.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));return arr;}
function _aiNewId(){return 'c'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);}
function _aiTitleFrom(t){t=String(t||'').trim().replace(/\s+/g,' ');if(!t)return 'New conversation';return t.length>42?t.slice(0,42)+'…':t;}
function _aiSaveCache(){cSet(AI_CHATS_LS,_aiChats());}
// Resolve the conversation currently on screen: the explicit new-chat view is
// null; otherwise the pinned active id, falling back to the most recent chat.
function _aiResolveActive(){
  if(_aiNewMode)return null;
  const chats=_aiChats();
  return _chatById(_aiActiveId())||chats[0]||null;
}
// Trim msgs IN PLACE (keep the array reference an in-flight aiAsk holds) and
// mirror this one chat to Firestore so it follows the user across devices.
function _aiSaveChatDoc(c){
  if(!c)return;
  if(c.msgs.length>40)c.msgs.splice(0,c.msgs.length-40);
  _aiSaveCache();
  if(db)db.collection('aiChats').doc(c.id)
    .set({title:c.title,msgs:c.msgs,createdAt:c.createdAt||Date.now(),updatedAt:c.updatedAt||Date.now()},{merge:true})
    .catch(e=>console.warn('AI chat sync failed',e));
}
// Append a message to a chat resolved by id (never by a captured reference, so
// a listener rebuild mid-request can't orphan it), bump it to the top, persist.
function _aiPush(cid,msg){
  const c=_chatById(cid);if(!c)return;
  c.msgs.push(msg);c.updatedAt=Date.now();
  _aiSortChats(_aiChats());
  _aiSaveChatDoc(c);
}
// Pull every conversation into this device on startup (called from syncAll).
// One-time migration: fold the old single-doc conversation into a chat.
async function loadAiChats(){
  if(!db)return;
  try{
    const snap=await db.collection('aiChats').get();
    let chats=snap.docs.map(d=>({id:d.id,...d.data()}));
    if(!chats.length){
      const old=await db.collection('appConfig').doc('aiChat').get();
      const list=old.exists?old.data()?.list:null;
      if(Array.isArray(list)&&list.length){
        const first=list.find(m=>m.r==='u');
        const c={id:_aiNewId(),title:_aiTitleFrom(first&&first.t),msgs:list,createdAt:Date.now(),updatedAt:Date.now()};
        chats=[c];
        db.collection('aiChats').doc(c.id).set({title:c.title,msgs:c.msgs,createdAt:c.createdAt,updatedAt:c.updatedAt}).catch(()=>{});
        db.collection('appConfig').doc('aiChat').set({list:[],migrated:true},{merge:true}).catch(()=>{}); // mark migrated so we don't re-import
      }
    }
    _aiSortChats(chats);
    S.aiChats=chats;cSet(AI_CHATS_LS,chats);
  }catch(e){_warnLoad('loadAiChats',e);}
}

function renderProjAI(){
  const el=document.getElementById('proj-ai');if(!el)return;
  if(!Array.isArray(AI_MODELS))return; // init-time call lands before module vars are assigned; projTab re-renders on open
  if(!_aiKey()){
    el.innerHTML=`<div class="card">
      <div class="clabel">AI Analyst — Setup</div>
      <div class="csub" style="margin-bottom:6px">Ask anything about your money — a Gemini-powered analyst reads your entire history (every expense, income, transfer, balance, loan, debtor and investment) and answers with your real numbers.</div>
      <div class="csub" style="margin-bottom:10px">Paste your Gemini API key below. It is stored only on this device and never leaves it except to call Google's API directly. Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style="color:var(--accent)">aistudio.google.com/apikey</a>. Each device needs the key entered once.</div>
      <div style="display:flex;gap:6px">
        <input class="ifield" id="ai-key-input" type="password" placeholder="Paste Gemini API key" style="flex:1;font-size:0.76rem" autocomplete="off" onkeydown="if(event.key==='Enter')aiSaveKey()">
        <button class="btn btn-p btn-sm" onclick="aiSaveKey()">Save</button>
      </div>
    </div>`;
    return;
  }
  const chats=_aiChats();
  const active=_aiResolveActive();          // null while composing a new chat
  const list=active?active.msgs:[];
  const msgs=list.map(m=>
    m.r==='u'?`<div class="ai-msg ai-u">${esc(m.t)}</div>`
    :m.r==='e'?`<div class="ai-msg ai-err">⚠ ${esc(m.t)}</div>`
    :`<div class="ai-msg ai-m">${_aiMd(m.t)}</div>`).join('');
  // Offer a one-tap retry when the conversation ended on a failed reply
  const retryBtn=(!_aiBusy&&list.length&&list[list.length-1].r==='e')
    ?`<div style="margin:4px 0 2px"><button class="btn btn-g btn-sm" onclick="aiRetry()" title="Send the last question again">↻ Retry</button></div>`:'';
  const chips=list.length?'':`<div class="ai-chips">${[
    'Give me a deep-dive report on my finances',
    'Where can I realistically cut back?',
    'How has my spending trended over the last 6 months?',
    'Am I on track this month?',
  ].map(q=>`<button class="ai-chip" onclick="aiAsk('${jsq(q)}')">${esc(q)}</button>`).join('')}</div>`;
  const model=cGet(AI_MODEL_LS)||AI_MODELS[0];
  // Conversation picker — shown once there is at least one saved chat (or a new
  // one being composed alongside existing ones).
  const opts=chats.map(c=>`<option value="${esc(c.id)}"${active&&active.id===c.id?' selected':''}>${esc(c.title||'Conversation')}</option>`).join('');
  const newOpt=active?'':`<option value="__new__" selected>✦ New conversation…</option>`;
  const showBar=chats.length>0;
  const chatBar=showBar?`<div class="ai-chatbar">
      <select class="ifield ai-chatsel" onchange="aiSelectChat(this.value)" ${_aiBusy?'disabled':''}>${newOpt}${opts}</select>
      ${active?`<button class="btn btn-g btn-sm" onclick="aiRenameChat()" title="Rename this conversation">✎</button><button class="btn btn-g btn-sm" onclick="aiDeleteChat()" title="Delete this conversation on all your devices">🗑</button>`:''}
    </div>`:'';
  el.innerHTML=`<div class="card" style="padding:12px 14px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
      <div class="clabel" style="margin:0">AI Analyst<span class="ai-badge">${esc(model.replace('gemini-','Gemini '))}</span></div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-g btn-sm" onclick="aiNewChat()" title="Start a new conversation" ${_aiBusy?'disabled':''}>＋ New</button>
        <button class="btn btn-g btn-sm" onclick="aiChangeKey()" title="Remove the saved API key from this device">Key…</button>
      </div>
    </div>
    ${chatBar}
    <div class="csub" style="margin:8px 0">Grounded in your full history — expenses, income, transfers, balances, loans, debtors, investments.</div>
    <div class="ai-log" id="ai-log">${msgs||`<div class="empty" style="padding:16px 0"><div class="empty-i">✦</div>Ask anything about your money.<br>Your entire history is the context.</div>`}${retryBtn}${_aiBusy?'<div class="ai-msg ai-m ai-typing"><span></span><span></span><span></span></div>':''}</div>
    ${chips}
    <div class="ai-inrow">
      <input class="ifield" id="ai-input" placeholder="Ask about your finances…" style="flex:1;font-size:0.76rem" ${_aiBusy?'disabled':''} onkeydown="if(event.key==='Enter')aiSend()">
      <button class="btn btn-p" onclick="aiSend()" ${_aiBusy?'disabled':''} style="padding:9px 16px">➤</button>
    </div>
  </div>`;
  const log=document.getElementById('ai-log');if(log)log.scrollTop=log.scrollHeight;
}

function aiSaveKey(){
  const inp=document.getElementById('ai-key-input');if(!inp)return;
  const v=inp.value.trim();
  if(!v){toast('Paste your Gemini API key first');return;}
  cSet(AI_KEY_LS,v);toast('Key saved on this device');haptic([8]);renderProjAI();
}
function aiChangeKey(){
  if(!confirm('Remove the saved Gemini API key from this device?'))return;
  try{localStorage.removeItem(AI_KEY_LS);localStorage.removeItem(AI_MODEL_LS);}catch(e){}
  renderProjAI();
}
// Switch to composing a brand-new conversation (nothing is written until the
// first message is actually sent, so we never leave empty ghost chats behind).
function aiNewChat(){
  if(_aiBusy)return;
  _aiNewMode=true;_aiSetActive('');renderProjAI();
  setTimeout(()=>{const i=document.getElementById('ai-input');if(i)i.focus();},30);
}
function aiSelectChat(id){
  if(_aiBusy)return;
  if(id==='__new__'){aiNewChat();return;}
  _aiNewMode=false;_aiSetActive(id);renderProjAI();
}
function aiRenameChat(){
  if(_aiBusy)return;
  const c=_aiResolveActive();if(!c){toast('No conversation to rename');return;}
  const v=prompt('Rename conversation',c.title||'');
  if(v===null)return;
  const t=String(v).trim().replace(/\s+/g,' ');
  if(!t)return;
  c.title=t.length>60?t.slice(0,60)+'…':t;
  c.updatedAt=Date.now();
  _aiSaveChatDoc(c);
  haptic([8]);renderProjAI();
}
function aiDeleteChat(){
  const c=_aiResolveActive();if(!c){toast('No conversation to delete');return;}
  if(!confirm('Delete “'+(c.title||'this conversation')+'” on all your devices?'))return;
  const chats=_aiChats();const i=chats.findIndex(x=>x.id===c.id);if(i>=0)chats.splice(i,1);
  _aiSaveCache();
  if(db)db.collection('aiChats').doc(c.id).delete().catch(e=>console.warn('AI chat delete failed',e));
  // Fall back to the next most-recent chat, or a fresh empty one if none remain.
  _aiNewMode=!chats.length;_aiSetActive(chats[0]?chats[0].id:'');
  haptic([8]);renderProjAI();
}
function aiSend(){const inp=document.getElementById('ai-input');if(!inp)return;const v=inp.value;inp.value='';aiAsk(v);}
async function aiAsk(text){
  if(_aiBusy)return;
  text=String(text||'').trim();if(!text)return;
  // Resolve the target chat; if composing a new one (or none exist yet), create
  // it now and title it from this first question.
  let c=_aiResolveActive();
  if(!c){
    c={id:_aiNewId(),title:_aiTitleFrom(text),msgs:[],createdAt:Date.now(),updatedAt:Date.now()};
    _aiChats().unshift(c);_aiSetActive(c.id);_aiNewMode=false;
  }
  const cid=c.id;
  _aiPush(cid,{r:'u',t:text});
  await _aiRun(cid);
}
// Run one Gemini request against a chat's current history. The chat is always
// re-resolved by id after each await (listener rebuilds mid-request must not
// orphan the reply — see _aiPush).
async function _aiRun(cid){
  _aiBusy=true;renderProjAI();
  try{
    const ctx=await _aiBuildContext();
    const cur=_chatById(cid);if(!cur)throw new Error('This conversation was deleted');
    // Send the recent turns (minus any error bubbles) so follow-ups have memory
    const contents=cur.msgs.filter(m=>m.r!=='e').slice(-20).map(m=>({role:m.r==='u'?'user':'model',parts:[{text:m.t}]}));
    const reply=await _aiFetch({
      system_instruction:{parts:[{text:ctx}]},
      contents,
      generationConfig:{temperature:0.35,maxOutputTokens:8192},
    });
    _aiPush(cid,{r:'m',t:reply});
  }catch(e){
    _aiPush(cid,{r:'e',t:e&&e.message?e.message:'Request failed — check your connection'});
  }
  _aiBusy=false;renderProjAI();
}
// Retry after a failed reply: drop the trailing error bubble(s) IN PLACE and
// re-run the request — the last user message is still the tail of the history.
async function aiRetry(){
  if(_aiBusy)return;
  const c=_aiResolveActive();if(!c)return;
  let removed=false;
  while(c.msgs.length&&c.msgs[c.msgs.length-1].r==='e'){c.msgs.pop();removed=true;}
  if(!c.msgs.some(m=>m.r==='u')){renderProjAI();return;}
  if(removed){c.updatedAt=Date.now();_aiSaveChatDoc(c);}
  await _aiRun(c.id);
}

// Calls Gemini's generateContent REST API, falling back through AI_MODELS on
// 404/5xx and 429 (key tiers differ in which models they can access, and each
// model has its own separate rate limit — a 429 on the preferred/flagship
// model doesn't mean a lower tier is also exhausted). Remembers the first
// model that answers. Only a bad-key error (400/401/403) aborts immediately;
// everything else is tried against every model before giving up.
async function _aiFetch(body){
  const key=_aiKey();if(!key)throw new Error('No API key saved — open the Key… settings');
  const pref=cGet(AI_MODEL_LS);
  const models=pref?[pref,...AI_MODELS.filter(m=>m!==pref)]:AI_MODELS.slice();
  let lastErr='no models reachable',allRateLimited=true;
  for(const model of models){
    const url=`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    // One raw generateContent call. Returns {net}/{err} (err.rateLimited set
    // for 429s) for soft failures — the caller falls through to the next
    // model in AI_MODELS for all of these — and throws only for a bad key.
    const call=async payload=>{
      let res;
      try{
        res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      }catch(e){return {net:true};}
      if(res.status===400||res.status===401||res.status===403){
        const j=await res.json().catch(()=>({}));
        throw new Error('Gemini rejected the API key'+(j.error&&j.error.message?': '+j.error.message:'')+'. Tap Key… to re-enter it.');
      }
      if(res.status===429){
        const j=await res.json().catch(()=>({}));
        return {err:'rate limited'+(j.error&&j.error.message?': '+j.error.message:''),rateLimited:true};
      }
      if(!res.ok){const j=await res.json().catch(()=>({}));return {err:(j.error&&j.error.message)||('HTTP '+res.status)};}
      return {json:await res.json().catch(()=>null)};
    };
    const read=j=>{const c=j&&j.candidates&&j.candidates[0];return {text:c&&c.content&&c.content.parts?c.content.parts.map(p=>p.text||'').join(''):'',reason:(c&&c.finishReason)||''};};

    const first=await call(body);
    if(first.net){lastErr='network error — are you online?';allRateLimited=false;continue;}
    if(first.err){lastErr=first.err;if(!first.rateLimited)allRateLimited=false;continue;}
    let {text,reason}=read(first.json);
    if(!text.trim()){lastErr=reason||'empty response';allRateLimited=false;continue;}

    // Gemini caps a single response at maxOutputTokens and reports MAX_TOKENS
    // when a long answer (e.g. a deep-dive report) is clipped mid-sentence.
    // Feed the partial back as a model turn and ask it to continue, stitching
    // the pieces together. Bounded so a stubborn loop can't run away.
    const convo=body.contents.slice();
    let guard=0,seg=text;
    while(reason==='MAX_TOKENS'&&guard++<5){
      convo.push({role:'model',parts:[{text:seg}]});
      convo.push({role:'user',parts:[{text:'Continue exactly where you left off, mid-sentence if needed. Do not repeat anything you already wrote and do not restart.'}]});
      const more=await call({...body,contents:convo});
      if(more.net||more.err||!more.json)break;
      const nx=read(more.json);
      if(!nx.text.trim())break;
      text+=nx.text;seg=nx.text;reason=nx.reason;
    }
    cSet(AI_MODEL_LS,model);
    return text.trim();
  }
  if(allRateLimited)throw new Error('Gemini rate limit reached on every available model ('+models.join(', ')+') — try again in a bit.');
  throw new Error('Gemini request failed: '+lastErr);
}

// Builds the grounding context: every Firestore collection compacted into
// pipe-delimited/JSON sections. Cached for 10 minutes so a chat session
// doesn't re-download the database on every question.
async function _aiBuildContext(force){
  if(_aiCtx&&!force&&Date.now()-_aiCtxAt<10*60*1000)return _aiCtx;
  if(!db)throw new Error('AI needs a connection to load your data — try again once synced');
  const grab=async col=>{try{const s=await db.collection(col).get();return s.docs.map(d=>({id:d.id,...d.data()}));}catch(e){console.warn('AI ctx fetch failed:',col,e);return[];}};
  const [tx,inc,xfr,cashB,invB,loans,debs,hist,budgets]=await Promise.all(
    ['transactions','income','transfers','cashBalances','investments','loans','debtors','historicalSummary','budgets'].map(grab));
  if(!tx.length&&!inc.length&&!hist.length)throw new Error('Could not load your data — check your connection and retry');
  // Drop ids and Firestore timestamp objects; they add tokens, not signal
  const strip=o=>{const r={};for(const k in o){const v=o[k];if(k==='id'||k==='createdAt'||k==='updatedAt')continue;if(v&&typeof v==='object'&&typeof v.seconds==='number')continue;r[k]=v;}return r;};
  const byDate=(a,b)=>String(a.date||'').localeCompare(String(b.date||''));
  const ym=o=>`${o.year||'?'}-${String(o.month||'?').padStart(2,'0')}`;
  const byYm=(a,b)=>ym(a).localeCompare(ym(b));
  const num=v=>Math.round(Number(v)||0);
  const sect=[];
  sect.push('EXPENSES (date|category|payee|bank|amount_NGN|notes):\n'
    +tx.slice().sort(byDate).map(t=>[t.date,t.category,t.payee,t.bank,num(t.amtNGN||t.amount),(t.notes||'').replace(/[|\n]/g,' ').slice(0,48)].join('|')).join('\n'));
  sect.push('INCOME (date|category|bank|amount_NGN|notes):\n'
    +inc.slice().sort(byDate).map(t=>[t.date,t.category||'Income',t.bank,num(t.amtNGN||t.amount),(t.notes||'').replace(/[|\n]/g,' ').slice(0,48)].join('|')).join('\n'));
  sect.push('TRANSFERS between own accounts — not income or spending (date|from|to|amount_from_side|amount_to_side):\n'
    +xfr.slice().sort(byDate).map(t=>[t.date,t.from,t.to,num(t.amount),num(t.toAmt!=null?t.toAmt:t.amount)].join('|')).join('\n'));
  sect.push('MONTH-END ACCOUNT BALANCES (one JSON per month; keys are account names; "USD Cash" is in dollars, the rest NGN):\n'
    +cashB.slice().sort(byYm).map(c=>ym(c)+' '+JSON.stringify(strip(c))).join('\n'));
  sect.push('INVESTMENTS (one JSON per month; NGN values per platform):\n'
    +invB.slice().sort(byYm).map(c=>ym(c)+' '+JSON.stringify(strip(c))).join('\n'));
  sect.push('LOANS the user OWES (JSON each; pmtLog = repayments made):\n'
    +loans.map(l=>JSON.stringify(strip(l))).join('\n'));
  sect.push('DEBTORS — money owed TO the user (JSON each):\n'
    +debs.map(d=>JSON.stringify(strip(d))).join('\n'));
  sect.push('HISTORICAL MONTHLY SUMMARY — months before per-transaction tracking began (JSON each):\n'
    +hist.slice().sort(byYm).map(h=>JSON.stringify(strip(h))).join('\n'));
  sect.push('BUDGETS (one JSON per month; NGN per category):\n'
    +budgets.slice().sort(byYm).map(b=>ym(b)+' '+JSON.stringify(strip(b))).join('\n'));
  const nw=new Date();
  const fx=getFxRates(nw.getMonth()+1,nw.getFullYear());
  const head=`You are SpendWise AI, the financial analyst built into the owner's personal finance app. Today is ${todayStr()}.
All amounts are Nigerian Naira (NGN, ₦) unless marked USD; "USD Cash" is a dollar account. Working FX assumption: 1 USD ≈ ₦${fx.USD}, 1 GBP ≈ ₦${fx.GBP}.
Rules:
- Ground every statement in the data below. Cite real months and real figures (use ₦ with thousands separators). Never invent or estimate numbers the data doesn't support — say plainly when it can't answer.
- Transfers move money between the user's own accounts; never count them as income or spending.
- Lead with the answer, then the evidence. Be direct and specific to THIS user's patterns — no generic financial-advice boilerplate.
- Format with markdown: short paragraphs, bullets, and small tables where they help. Round to whole naira.

THE USER'S COMPLETE FINANCIAL DATA:

`;
  _aiCtx=head+sect.join('\n\n');
  _aiCtxAt=Date.now();
  return _aiCtx;
}

// Minimal markdown → HTML for AI replies: headings, bold/italic/code,
// bullet + numbered lists, and pipe tables. Everything is HTML-escaped first.
function _aiMd(src){
  const e=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const inline=s=>e(s)
    .replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g,'$1<i>$2</i>')
    .replace(/`([^`]+)`/g,'<code>$1</code>');
  const lines=String(src||'').split(/\r?\n/);
  let html='',i=0;
  while(i<lines.length){
    const L=lines[i];
    if(/^\s*$/.test(L)){i++;continue;}
    if(/^#{1,6}\s/.test(L)){html+=`<div class="ai-h">${inline(L.replace(/^#{1,6}\s*/,''))}</div>`;i++;continue;}
    if(/^\s*[-*•]\s+/.test(L)){
      let items='';
      while(i<lines.length&&/^\s*[-*•]\s+/.test(lines[i])){items+=`<li>${inline(lines[i].replace(/^\s*[-*•]\s+/,''))}</li>`;i++;}
      html+=`<ul>${items}</ul>`;continue;
    }
    if(/^\s*\d+[.)]\s+/.test(L)){
      let items='';
      while(i<lines.length&&/^\s*\d+[.)]\s+/.test(lines[i])){items+=`<li>${inline(lines[i].replace(/^\s*\d+[.)]\s+/,''))}</li>`;i++;}
      html+=`<ol>${items}</ol>`;continue;
    }
    if(/^\s*\|.*\|\s*$/.test(L)){
      const rows=[];
      while(i<lines.length&&/^\s*\|.*\|\s*$/.test(lines[i])){rows.push(lines[i].trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(c=>c.trim()));i++;}
      const data=rows.filter(r=>!r.every(c=>/^:?-{2,}:?$/.test(c)));
      if(data.length)html+='<div class="ai-tblwrap"><table class="ai-tbl">'+data.map((r,ri)=>'<tr>'+r.map(c=>ri===0?`<th>${inline(c)}</th>`:`<td>${inline(c)}</td>`).join('')+'</tr>').join('')+'</table></div>';
      continue;
    }
    html+=`<p>${inline(L)}</p>`;i++;
  }
  return html;
}

