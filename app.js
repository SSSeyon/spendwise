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

// ══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════════════
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
const MS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Built-in categories and their starter "actual expense" lines. Generic on
// purpose (v4.5): each user adds their own payees, stored in their account
// (appConfig/customLines). The owner's old personal lines were moved into
// their account by the one-time v4.5 import (code removed in v4.6).
const CAT_LINES = {
  'Utilities': ['Power','Water'],
  'Fuel': ['Fuel','Gas'],
  'Car maintenance': ['Car service','Car wash','Vehicle papers renewal'],
  'Domestic': ['Rent','Service charge','Laundry','Home repairs','Cleaner'],
  'Food': ['Lunch','Eat out'],
  'Groceries': ['Supermarket','Market'],
  'Kids': ['School fees','Kids (other)'],
  'Internet services': ['Internet','Airtime'],
  'Recreation': ['Outing','DSTV'],
  'Personal care': ['Medications','Personal care'],
  'Gifts and donations': ['Gifts','Donations'],
  'Loans': [],
  'Others': ['Cash Withdrawal','Others'],
  'Work Travel': ['Taxi','Flights','Hotel'],
  'Education': ['Tuition','Books'],
};
const _BASE_CATS = Object.keys(CAT_LINES);
// Custom categories and their emoji (the emoji used to live only in memory,
// so a new category lost its icon on reload).
function getCustomCats(){return cGet('sw3_custom_cats')||[];}
function getCustomIcons(){return cGet('sw3_custom_icons')||{};}
function _applyCustomIcons(){Object.assign(CAT_ICONS,getCustomIcons());}
function saveCustomCats(arr,icons){
  cSet('sw3_custom_cats',arr);
  if(icons)cSet('sw3_custom_icons',icons);
  _applyCustomIcons();
  if(db)db.collection('appConfig').doc('customCats')
    .set({cats:arr,icons:getCustomIcons(),updatedAt:FV.serverTimestamp()},{merge:true})
    .catch(e=>console.warn('customCats sync failed',e));
}
// The user-added "actual expense" lines (payees per category, kept in
// S.customExpLines, including the __removed__ map) used to be localStorage-only,
// so they never left the device they were created on — added lines "vanished"
// on any other device or after a cache clear. This mirrors saveCustomCats so
// they live in Firestore too. Persists the whole map (last-write-wins), which is
// fine for a low-frequency config edited one line at a time.
function saveCustomLines(){
  const all=S.customExpLines||{};
  cSet(CK.customLines,all);
  if(!db)return;
  // Firestore rejects field names that both start and end with "__", so the
  // __removed__ map (deleted built-in lines) can't ride inside `lines` — it
  // gets its own `removed` field and is recombined on load. Without this the
  // whole customLines write throws and nothing syncs.
  const {__removed__:removed, ...lines}=all;
  try{
    db.collection('appConfig').doc('customLines')
      .set({lines,removed:removed||{},updatedAt:FV.serverTimestamp()},{merge:true})
      .catch(e=>console.warn('customLines sync failed',e));
  }catch(e){console.warn('customLines sync failed',e);}
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
    if(Array.isArray(arr))cSet('sw3_custom_cats',arr);
    if(doc.exists&&doc.data()?.icons)cSet('sw3_custom_icons',doc.data().icons);
    _applyCustomIcons();
  }catch(e){_warnLoad('loadCustomCats',e);}
}
async function loadCustomLines(){
  if(!db) return;
  try{
    const doc=await db.collection('appConfig').doc('customLines').get();
    const data=doc.exists?doc.data():null;
    const obj=data&&data.lines&&typeof data.lines==='object'?{...data.lines}:null;
    if(obj){
      // Recombine the separately-stored __removed__ map (see saveCustomLines)
      if(data.removed&&typeof data.removed==='object')obj.__removed__=data.removed;
      S.customExpLines=obj;
      cSet(CK.customLines,obj);
    }else if(S.customExpLines&&Object.keys(S.customExpLines).length){
      // First run after the fix: nothing in Firestore yet, but this device has
      // lines from the old localStorage-only era — back them up now.
      saveCustomLines();
    }
  }catch(e){_warnLoad('loadCustomLines',e);}
}
function getAllCats(){return[..._BASE_CATS,...getCustomCats().filter(c=>!_BASE_CATS.includes(c))];}


// ── ICONS ──────────────────────────────────────────────────────────────────
const CAT_ICONS = {
  'Utilities':          '💡',
  'Fuel':               '⛽',
  'Car maintenance':    '🔧',
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

// ── LOGOS ──────────────────────────────────────────────────────────────────
// A logo value is either a filename in the app's own Logos/ folder (the
// built-in catalogue in setup.js) or a small data: URL the user uploaded,
// which is stored in their account like any other setting.
const LOGOS_BASE_URL='Logos/';
function logoUrl(v){return /^data:image\//.test(v)?v:LOGOS_BASE_URL+encodeURIComponent(v);}
function getCashLogos(){return cGet('sw3_cash_logos')||{};}
function setCashLogo(acctName,filename){
  const m=getCashLogos();
  if(filename) m[acctName]=filename.trim();
  else delete m[acctName];
  cSet('sw3_cash_logos',m);
  // Mirror to Firestore — use {merge:true} so concurrent per-account writes don't
  // erase each other (each call only changes the one field that changed).
  if(db){
    const payload=filename?{[acctName]:filename.trim()}:{[acctName]:FV.delete()};
    db.collection('appConfig').doc('cashLogos').set(payload,{merge:true}).catch(e=>console.warn("cashLogos write failed",e));
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
  const file=getCashLogos()[name]||(typeof catalogLogo==='function'?catalogLogo('bank',name):'');
  const initials=name.slice(0,2).toUpperCase();
  if(!file) return `<div style="width:${size}px;height:${size}px;border-radius:4px;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:${Math.round(size*0.45)}px;font-weight:700;color:var(--text2);flex-shrink:0">${initials}</div>`;
  const url=logoUrl(file);
  return `<img src="${url}" width="${size}" height="${size}" style="border-radius:4px;object-fit:contain;background:#fff;flex-shrink:0" onerror="_logoFallbackBank(this,'${name}',${size})">`;
}
function platformLogoEl(key,color,size=20){
  const plat=getPlatforms().find(p=>p.key===key);
  const file=plat?.logo||(plat&&typeof catalogLogo==='function'?catalogLogo('platform',plat.label):'');
  if(!file) return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};opacity:0.85;flex-shrink:0"></div>`;
  const url=logoUrl(file);
  return `<img src="${url}" width="${size}" height="${size}" style="border-radius:50%;object-fit:contain;background:#fff;flex-shrink:0" onerror="_logoFallbackPlatform(this,'${color}',${size})">`;
}


// USD-denominated cash accounts: the legacy 'USD Cash' name plus any account
// the user marked as USD (appConfig/cashAccounts.usd).
function getUsdAccounts(){return cGet('sw3_usd_accounts')||[];}
function isUSDCashAccount(name){return name==='USD Cash'||getUsdAccounts().includes(name);}
function cashTotalNGN(cashObj,m,y){const r=getFxRates(m||S.expMonth,y||S.expYear);const c=_withAccrued(cashObj||S.cash,m||S.expMonth,y||S.expYear);return getCashAccounts().reduce((s,b)=>{const v=c[b]||0;return s+(isUSDCashAccount(b)?v*(r.USD||1650):v);},0);}
function getCashAccounts(){return cGet('sw3_cash_accounts')||[];}
// Persist the full account list (+ which are USD) locally AND to Firestore.
function setCashAccounts(allAccounts,usd){
  const list=[...new Set(allAccounts)];
  const usdList=(usd||getUsdAccounts()).filter(a=>list.includes(a));
  cSet('sw3_cash_accounts',list);cSet('sw3_usd_accounts',usdList);
  if(db) db.collection('appConfig').doc('cashAccounts').set({accounts:list,usd:usdList},{merge:false}).catch(e=>console.warn("cashAccounts write failed",e));
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
      cSet('sw3_usd_accounts',Array.isArray(doc.data().usd)?doc.data().usd:[]);
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

// ── Budgets (v4.7): one standard budget + optional month overrides ──
// The standard budget (profile.defBudgets → DEF_BUDGETS) applies to every
// month. A month with its own doc in `budgets` uses that instead; months
// budgeted before v4.7 each have their own doc, so their history is unchanged.
// Cache per month: {categories} for an override, {none:true} when the month
// is known to have none.
function budgetOverride(m,y){const o=cGet(CK.budgets(m,y));return o&&o.categories&&typeof o.categories==='object'?o.categories:null;}
function budgetFor(m,y){const o=budgetOverride(m,y);return o?{...DEF_BUDGETS,...o}:{...DEF_BUDGETS};}
// Once per account: the most recently saved month becomes the standard
// budget, and copies of it saved for this month onwards are dropped (they'd
// only hide later changes to the standard).
async function _migrateStandardBudget(){
  const p=getProfile()||{};
  if(p.budgetStdMigrated||!db)return;
  try{
    const snap=await db.collection('budgets').get();
    const docs=snap.docs.map(d=>({id:d.id,...d.data()})).filter(d=>d.year&&d.month&&d.categories)
      .sort((a,b)=>(b.year*100+b.month)-(a.year*100+a.month));
    const n=new Date(),nowKey=n.getFullYear()*100+n.getMonth()+1;
    const latest=docs.find(d=>Object.values(d.categories).some(v=>+v>0));
    const std=latest?{...latest.categories}:{...DEF_BUDGETS};
    const same=c=>{const k=new Set([...Object.keys(c),...Object.keys(std)]);return [...k].every(x=>(+c[x]||0)===(+std[x]||0));};
    for(const d of docs){
      if(d.year*100+d.month>=nowKey&&same(d.categories)){
        await db.collection('budgets').doc(d.id).delete();
        cSet(CK.budgets(d.month,d.year),{none:true});
      }
    }
    saveProfile({defBudgets:std,budgetStdMigrated:true});
    S.budgets=budgetFor(S.expMonth,S.expYear);
    try{renderDashboard();renderExpenses();renderSettBudget();}catch(e){console.warn('budget re-render failed',e);}
  }catch(e){console.warn('standard budget migration postponed',e);}
}

const NW_CFG_KEY='sw3_nw_config';
function getNWConfig(){
  const saved=cGet(NW_CFG_KEY);
  if(saved) return saved;
  // Default: include everything
  return {
    includeInvestments:true,
    includeCash:true,
    includeDebtors:true,
    includeLoans:false, // liabilities are opt-in — see nwLoansOutstanding()
    cashAccounts:getCashAccounts(), // all accounts by default
  };
}
function saveNWConfig(cfg){
  cSet(NW_CFG_KEY,cfg);
  if(db)db.collection('appConfig').doc('nwConfig')
    .set({cfg,updatedAt:FV.serverTimestamp()},{merge:true})
    .catch(e=>console.warn('nwConfig sync failed',e));
}
async function loadNWConfig(){
  if(!db) return;
  try{
    const doc=await db.collection('appConfig').doc('nwConfig').get();
    if(doc.exists&&doc.data()?.cfg)cSet(NW_CFG_KEY,doc.data().cfg);
  }catch(e){_warnLoad('loadNWConfig',e);}
}
// Total still owed on borrowings — a LIABILITY, so it is subtracted from net
// worth (the mirror of debtors, which are money owed to you). Opt-in via
// `includeLoans === true`: an absent key means off, so turning this on never
// silently rewrites an existing net-worth history.
// Debtors that count toward net worth: still expected back AND with a positive
// balance. Settled, zero and overpaid (negative) balances are excluded, and
// several debts owed by the same person are summed into a single row.
function nwDebtorRows(){
  const byName={},order=[];
  (S.debtors||[]).filter(d=>d.expectRepayment!==false&&(d.ngnBalance||0)>0).forEach(d=>{
    const k=String(d.name||'-').trim();
    if(byName[k]==null){byName[k]=0;order.push(k);}
    byName[k]+=(d.ngnBalance||0);
  });
  return order.map(n=>({name:n,total:byName[n]}));
}
function nwDebtorsExpected(){return nwDebtorRows().reduce((s,r)=>s+r.total,0);}
function nwLoansOutstanding(cfg){
  const c=cfg||getNWConfig();
  if(c.includeLoans!==true) return 0;
  return (S.loans||[])
    .filter(l=>l.status!=='settled')
    .reduce((s,l)=>s+Math.max(0,(l.amtNGN||l.amount||0)-(l.repaid||0)),0);
}


const PLATFORMS_DEFAULT = [];
const PLATFORMS_KEY='sw3_platforms';
function getPlatforms(){return cGet(PLATFORMS_KEY)||PLATFORMS_DEFAULT;}
// Month docs can still hold platforms that have since been removed (e.g.
// USDHoldings, which was moved to Cash). v4.7.1: those are no longer shown or
// counted on any Investments screen. netWorthFor() still counts their value
// in past months (see _retiredInvValue) so old net worth doesn't drop.
const INV_META_FIELDS=new Set(['month','year','id','createdAt','updatedAt']);
function platformsFor(monthData){return getPlatforms();}
// Value held in removed platforms in a month doc.
function _retiredInvValue(monthData){
  const known=new Set(getPlatforms().map(p=>p.key));
  return Object.keys(monthData||{}).reduce((s,k)=>{
    if(INV_META_FIELDS.has(k)||known.has(k))return s;
    const v=Number(monthData[k]);
    return s+(v>0?v:0);
  },0);
}
function savePlatforms(arr){cSet(PLATFORMS_KEY,arr);_syncInvConfig();}
// PLATFORMS is populated lazily at first render via getPlatforms() — never call at module scope
let PLATFORMS=PLATFORMS_DEFAULT;

const DEF_RATES={NGN:1,USD:1600,GBP:2050};

// New feature keys
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

// Sub principals (sw3_inv_subs) are a SINGLE LIVE SNAPSHOT — they are not
// bucketed by month, so they only ever describe the real current month. They
// are preferred there because the month's Firestore total can lag behind edits
// made on the Accounts page. For any earlier month that preference is wrong:
// the month's own investments doc is the authoritative record of what the
// balances were then. Without this guard, viewing a past month showed today's
// balances on the dashboard.
function _invIsLiveMonth(m,y){const n=appNow();return m===(n.getMonth()+1)&&y===n.getFullYear();}
function invBalanceFor(pKey,m,y,monthData){
  if(_invIsLiveMonth(m,y)){
    const subs=migrateToSubs(pKey);
    const st=subs.reduce((s,sb)=>s+(Number(sb.principal)||0),0);
    if(st>0) return st+_invDailyAccrued(pKey,subs,st);
  }
  return Number((monthData||{})[pKey])||0;
}

// ── Sync all investment config to Firestore (debounced) ──────────────────
let _invConfigSyncTimer=null;
// True from a local change until its write lands, so the listener below
// can't put an older copy back over it in the meantime (it did: month-end
// interest booked on Piggy lost its principal and movement to a snapshot that
// arrived during the 800ms wait).
let _invCfgPending=false;
function _syncInvConfig(){
  clearTimeout(_invConfigSyncTimer);_invCfgPending=true;
  _invConfigSyncTimer=setTimeout(()=>{
    if(!db){_invCfgPending=false;return;}
    const payload={
      platforms:getPlatforms(),
      invMeta:getInvMeta(),
      invSubs:getInvSubs(),
      invMoves:getInvMovements(),
      updatedAt:FV.serverTimestamp()
    };
    db.collection('appConfig').doc('investments').set(payload,{merge:true})
      .then(()=>{_invCfgPending=false;},e=>{_invCfgPending=false;console.warn('invConfig sync failed',e);});
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
    if(Array.isArray(d.invMoves))cSet(INV_MOVE_KEY,d.invMoves);
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
// Synced via appConfig/cashInterest (until v4.7 it stayed on one device and
// was wiped on sign-out, and interest posting depends on it).
function saveCashInterestMeta(meta){
  cSet(CASH_INT_KEY,meta);
  if(db)db.collection('appConfig').doc('cashInterest').set({meta,updatedAt:FV.serverTimestamp()}).catch(e=>console.warn('cashInterest sync failed',e));
}
async function loadCashInterest(){
  if(!db)return;
  try{const d=await db.collection('appConfig').doc('cashInterest').get();
    if(d.exists&&d.data()?.meta)cSet(CASH_INT_KEY,d.data().meta);
    else if(Object.keys(getCashInterestMeta()).length)saveCashInterestMeta(getCashInterestMeta()); // first run: upload this device's rates
  }catch(e){_warnLoad('loadCashInterest',e);}
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

// Per-user fallbacks, set from appConfig/profile by _applyProfile() (the owner's
// old hard-coded values live in their profile doc now).
let DEF_BUDGETS={};
let FIXED_OBL=[];

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
  // The user's own payee lines (appConfig/customLines) — most payees live here now
  const cl=(typeof S!=='undefined'&&S.customExpLines)||{};
  for(const cat in cl){if(cat==='__removed__'||!Array.isArray(cl[cat]))continue;if(cl[cat].some(p=>String(p).toLowerCase()===lower))return cat;}
  for(const{kw,cat}of PAYEE_KEYWORDS){if(lower.includes(kw))return cat;}
  return null;
}

// ── Per-user profile (appConfig/profile) ──
// {onboarded, defBudgets, fixedObl}. New users get empty fallbacks; the
// owner's old hard-coded budgets/fixed bills were written here by the import.
const PROFILE_KEY='sw3_profile';
function getProfile(){return cGet(PROFILE_KEY)||null;}
function _applyProfile(p){
  DEF_BUDGETS=(p&&p.defBudgets&&typeof p.defBudgets==='object')?{...p.defBudgets}:{};
  FIXED_OBL=(p&&Array.isArray(p.fixedObl))?p.fixedObl.map(o=>({...o})):[];
}
function saveProfile(patch){
  const p={...(getProfile()||{}),...patch};
  cSet(PROFILE_KEY,p);_applyProfile(p);
  if(db)db.collection('appConfig').doc('profile').set({...p,updatedAt:FV.serverTimestamp()},{merge:true}).catch(e=>console.warn('profile write failed',e));
  return p;
}
async function loadProfile(){
  if(!db) return;
  try{
    const doc=await db.collection('appConfig').doc('profile').get();
    if(doc.exists){const p=doc.data();delete p.updatedAt;cSet(PROFILE_KEY,p);_applyProfile(p);}
  }catch(e){_warnLoad('loadProfile',e);}
}

// ── RECURRING ENGINE ──
// An item: {id, payee, amount, type:'expense'|'income', category | incCat,
// bank, notes, frequency, day, nextRun, lastPosted, auto}.
// `day` anchors monthly/quarterly/yearly items to their day of the month, so
// an item on the 31st lands on the last day of short months instead of
// drifting (31 Jan → 28 Feb → 31 Mar, not → 3 Mar → 3 Apr).
// `auto` items post themselves when the app opens on or after their date;
// the rest wait on Home for a tap. Since v4.7 this also replaces Fixed Bills.
const CK_RECUR='sw3_recurring';
function getRecurring(){return cGet(CK_RECUR)||[];}
function saveRecurring(list){
  cSet(CK_RECUR,list);
  if(db)db.collection('appConfig').doc('recurring')
    .set({list,updatedAt:FV.serverTimestamp()},{merge:true})
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
function _recurId(){return 'r'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
function _parseYmd(s){const p=String(s||todayStr()).slice(0,10).split('-').map(Number);return {y:p[0],m:p[1],d:p[2]};}
function nextRunDate(freq,from,day){
  let {y,m,d}=_parseYmd(from);
  if(freq==='weekly') return toLocalISO(new Date(y,m-1,d+7));
  m+=freq==='quarterly'?3:freq==='annually'?12:1;
  while(m>12){m-=12;y++;}
  const dd=Math.min(day||d,new Date(y,m,0).getDate());
  return `${y}-${String(m).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
}
// Due in the current month or overdue.
function isDueThisMonth(nextRun){
  if(!nextRun)return false;
  return nextRun.slice(0,7)<=todayStr().slice(0,7);
}
// Monthly equivalent of a recurring item (Treasury's "fixed obligations").
function _recurMonthly(r){const a=+r.amount||0;return r.frequency==='weekly'?a*52/12:r.frequency==='quarterly'?a/3:r.frequency==='annually'?a/12:a;}
function _addRecurring(o){
  const auto=!!document.getElementById('e-recur-auto')?.checked;
  const day=_parseYmd(o.date).d;
  const item={id:_recurId(),payee:o.payee,amount:o.amount,type:o.type,bank:o.bank||'',notes:o.notes||'',
    frequency:o.frequency,day,nextRun:nextRunDate(o.frequency,o.date,day),lastPosted:o.date,auto};
  if(o.type==='income')item.incCat=o.incCat||'Other';else item.category=o.category||'Others';
  const rl=getRecurring();rl.push(item);saveRecurring(rl);renderRecurringCard();
}
// Old items were saved without ids; give every item one so posts and edits
// can find it again after another device reorders the list.
function _ensureRecurIds(){
  const l=getRecurring();let ch=false;
  l.forEach(r=>{if(!r.id){r.id=_recurId()+Math.random().toString(36).slice(2,4);ch=true;}});
  if(ch)saveRecurring(l);
  return l;
}
function _logRecurPost(payee,amount,type){
  const log=cGet('sw3_recur_posted_log')||[];
  log.unshift({date:todayStr(),payee,amount,type});
  cSet('sw3_recur_posted_log',log.slice(0,20));
}
// Write one occurrence of `r` dated `postDate` (income or expense record +
// the bank balance). Returns true when written.
async function _recurWrite(r,postDate){
  const {y:pY,m:pM}=_parseYmd(postDate);
  const bank=r.bank||getCashAccounts()[0];
  if(!bank){toast(`Add a bank account to post "${r.payee}"`);return false;}
  const isUSD=isUSDCashAccount(bank);
  const amtNGN=isUSD?Math.round(r.amount*(getFxRates(pM,pY).USD||1600)):r.amount;
  const isInc=r.type==='income';
  const data=isInc
    ?{amount:r.amount,amtNGN,currency:isUSD?'USD':'NGN',category:r.incCat||'Other',bank,notes:r.notes||'',date:postDate,month:pM,year:pY,type:'income',recurId:r.id||''}
    :{amount:r.amount,amtNGN,currency:isUSD?'USD':'NGN',category:r.category||'Others',bank,payee:r.payee,notes:r.notes||'',date:postDate,month:pM,year:pY,type:'expense',recurId:r.id||''};
  const ref=db.collection(isInc?'income':'transactions').doc();
  _placeRecord(isInc?'inc':'txn',{...data,id:ref.id},null);
  _adjustCash(bank,isInc?r.amount:-r.amount,pM,pY,isInc?'income':'expense','',postDate);
  ref.set({...data,createdAt:FV.serverTimestamp()}).catch(e=>{console.warn('recurring post write failed — queued',e);oqAdd(isInc?'income':'transactions',ref.id,data,true);});
  _logRecurPost(r.payee,r.amount,r.type);
  return true;
}
// Claim the next occurrence of item `id` so two devices opening at once can't
// both post it: the recurring list is re-read inside a transaction and the
// date only advances if nobody else has moved it. Returns the claimed date.
async function _recurClaim(id,expectNext){
  let claimed=null;
  const ref=db.collection('appConfig').doc('recurring');
  await db.runTransaction(async t=>{
    claimed=null;
    const s=await t.get(ref);
    const list=(s.exists&&Array.isArray(s.data().list))?s.data().list:getRecurring();
    const r=list.find(x=>x.id===id);
    if(!r||r.nextRun!==expectNext) return;
    claimed=r.nextRun;
    r.lastPosted=r.nextRun;r.nextRun=nextRunDate(r.frequency,r.nextRun,r.day);
    t.set(ref,{list,updatedAt:FV.serverTimestamp()},{merge:true});
    cSet(CK_RECUR,list);
  });
  return claimed;
}
// Tap "Post" on a due item (asks first).
async function postRecurring(id){
  const r=_ensureRecurIds().find(x=>x.id===id);if(!r)return;
  if(!confirm(`Post "${r.payee}" (${fN(r.amount)}) as ${r.type==='income'?'income':'an expense'}, dated ${fmtDate(r.nextRun)}?`))return;
  let date=null;
  try{date=await _recurClaim(id,r.nextRun);}
  catch(e){console.warn('recurring claim failed',e);toast('Posting needs a connection. Try again when you\'re online.');return;}
  if(!date){toast('Already posted on another device');renderRecurringCard();return;}
  if(await _recurWrite(r,date))toast(`${r.payee} posted · ${r.bank||getCashAccounts()[0]} updated`);
  renderDashboard();renderExpenses();renderIncome();renderRecurringCard();renderCashPage();
  if(document.getElementById('recur-modal')?.classList.contains('open'))openRecurModal();
}
// Move to the next date without posting (e.g. a bill that was waived).
function skipRecurring(id){
  const l=getRecurring();const r=l.find(x=>x.id===id);if(!r)return;
  if(!confirm(`Skip "${r.payee}" on ${fmtDate(r.nextRun)}? Nothing is recorded; the next one is ${fmtDate(nextRunDate(r.frequency,r.nextRun,r.day))}.`))return;
  r.nextRun=nextRunDate(r.frequency,r.nextRun,r.day);
  saveRecurring(l);renderRecurringCard();renderDashAlerts();
  if(document.getElementById('recur-modal')?.classList.contains('open'))openRecurModal();
}
// Items marked "post automatically": post every occurrence that has come due
// (catching up at most a year), once per app open, after the data has synced.
let _autoRecurBusy=false;
async function runAutoRecurring(){
  if(!db||_autoRecurBusy)return;
  _autoRecurBusy=true;
  const today=todayStr();let n=0;
  try{
    for(const r of _ensureRecurIds()){
      if(!r.auto)continue;
      for(let guard=0;guard<12;guard++){
        const cur=getRecurring().find(x=>x.id===r.id);
        if(!cur||!cur.nextRun||cur.nextRun>today)break;
        let date=null;
        try{date=await _recurClaim(cur.id,cur.nextRun);}catch(e){console.warn('auto recurring claim failed',e);break;}
        if(!date)break;
        if(await _recurWrite(cur,date))n++;else break;
      }
    }
  }finally{_autoRecurBusy=false;}
  if(n){toast(`${n} recurring ${n===1?'entry':'entries'} posted automatically`);renderAll();}
}
function toggleRecurAuto(id,on){
  const l=getRecurring();const r=l.find(x=>x.id===id);if(!r)return;
  r.auto=!!on;saveRecurring(l);openRecurModal();renderRecurringCard();
  toast(on?'Will post automatically when due':'Will wait for you to post it');
  if(on)runAutoRecurring();
}
function editRecurringAmount(id){
  const l=getRecurring();const r=l.find(x=>x.id===id);if(!r)return;
  const v=prompt(`New amount for "${r.payee}"`,String(r.amount));if(v===null)return;
  const a=parseFloat(_evalExpr(v));if(!(a>0)){toast('Enter a valid amount');return;}
  r.amount=a;saveRecurring(l);openRecurModal();renderRecurringCard();
}
function renderRecurringCard(){
  const due=_ensureRecurIds().filter(r=>isDueThisMonth(r.nextRun));
  const card=document.getElementById('dash-recurring-card');
  const list=document.getElementById('dash-recurring-list');
  if(!card||!list)return;
  if(!due.length){card.style.display='none';return;}
  card.style.display='block';
  list.innerHTML=due.map(r=>{
    const act=r.auto
      ?`<span style="font-size:0.62rem;color:var(--text3)">Posts itself</span>`
      :`<span style="font-size:0.7rem;color:var(--accent)">Post →</span>`;
    return`<div class="txi" style="cursor:pointer" onclick="${r.auto?'openRecurModal()':`postRecurring('${r.id}')`}"><div><div class="txi-cat">${esc(r.payee)}</div><div class="txi-meta">${r.type==='income'?'Income':'Expense'} · ${r.frequency} · Due ${fmtDate(r.nextRun)}</div></div><div style="display:flex;align-items:center;gap:8px"><span class="badge ${r.type==='income'?'bg':'br'}">${r.type==='income'?'+':'-'}${isUSDCashAccount(r.bank)?'$'+r.amount:fC(r.amount)}</span>${act}</div></div>`;
  }).join('');
}
function openRecurModal(){
  const list=_ensureRecurIds();
  document.getElementById('recur-list').innerHTML=list.length?list.map(r=>`
    <div class="dc" style="margin-bottom:8px">
      <div class="dc-top"><div><div class="dc-name">${esc(r.payee)}</div><div class="dc-sub">${r.frequency} · ${esc(r.category||r.incCat||'')}${r.bank?' · '+esc(r.bank):''} · Next: ${fmtDate(r.nextRun)||'—'}</div></div>
        <button class="txi-del" onclick="deleteRecurring('${r.id}')">×</button>
      </div>
      <div style="display:flex;gap:8px;margin-top:6px;align-items:center">
        <span class="badge ${r.type==='income'?'bg':'br'}">${r.type}</span>
        <span style="font-family:var(--mono);font-size:0.78rem;cursor:pointer" onclick="editRecurringAmount('${r.id}')" title="Change the amount">${fN(r.amount)} ✎</span>
        <label style="margin-left:auto;display:flex;align-items:center;gap:5px;font-size:0.66rem;color:var(--text2);cursor:pointer"><input type="checkbox" ${r.auto?'checked':''} onchange="toggleRecurAuto('${r.id}',this.checked)"> Post automatically</label>
      </div>
      ${isDueThisMonth(r.nextRun)?`<div style="display:flex;gap:8px;margin-top:8px">${r.auto?'':`<button class="btn btn-p btn-sm" style="flex:1" onclick="postRecurring('${r.id}')">Post now</button>`}<button class="btn btn-g btn-sm" style="flex:1" onclick="skipRecurring('${r.id}')">Skip this one</button></div>`:''}
    </div>`).join(''):'<div class="empty"><div class="empty-i">◷</div>No recurring transactions yet.<br>Choose "Repeats" when you add an expense or income.</div>';
  openMod('recur-modal');
}
function deleteRecurring(id){
  const l=getRecurring();const r=l.find(x=>x.id===id);if(!r)return;
  if(!confirm(`Stop repeating "${r.payee}"? Entries already posted stay.`))return;
  saveRecurring(l.filter(x=>x.id!==id));openRecurModal();renderRecurringCard();
}
// v4.7: Fixed Bills became recurring items (not posted automatically, no
// bank yet). Runs once per account.
function _migrateFixedBills(){
  const p=getProfile()||{};
  if(p.fixedBillsMigrated)return;
  const bills=[...(Array.isArray(p.fixedObl)?p.fixedObl:[]),...(cGet('sw3_fixed_obl')||[]),...(cGet('sw3_custom_obl')||[])]
    .filter((b,i,a)=>b&&b.label&&+b.amount>0&&a.findIndex(x=>x.label===b.label)===i);
  if(bills.length){
    const n=new Date();const first=toLocalISO(new Date(n.getFullYear(),n.getMonth()+1,1));
    const l=getRecurring();
    bills.forEach(b=>{if(l.some(r=>r.payee===b.label))return;
      l.push({id:_recurId()+Math.random().toString(36).slice(2,4),payee:b.label,amount:+b.amount,type:'expense',category:smartCat(b.label)||'Others',bank:'',notes:'From Fixed Bills',frequency:'monthly',day:1,nextRun:first,lastPosted:'',auto:false});});
    saveRecurring(l);
  }
  cDel('sw3_fixed_obl');cDel('sw3_custom_obl');
  saveProfile({fixedBillsMigrated:true,fixedObl:[]});
}

// ── TRANSACTION RULES (auto-categorization) ──
// Stored like recurring: localStorage cache + appConfig/rules doc in Firestore.
// A rule = {match, category}: when an expense name contains `match`
// (case-insensitive), the category is auto-assigned in the expense form.
// First matching rule wins; rules take precedence over the built-in smartCat.
const CK_RULES='sw3_rules';
function getRules(){return cGet(CK_RULES)||[];}
function saveRules(list){
  cSet(CK_RULES,list);
  if(db)db.collection('appConfig').doc('rules')
    .set({list,updatedAt:FV.serverTimestamp()},{merge:true})
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

// ── GOALS ──────────
// Stored like recurring: localStorage cache + appConfig/goals doc in Firestore.
// A goal = {id, name, icon, target, current, deadline, createdAt}.
const CK_GOALS='sw3_goals';
function getGoals(){return cGet(CK_GOALS)||[];}
function saveGoals(list){
  cSet(CK_GOALS,list);
  if(db)db.collection('appConfig').doc('goals')
    .set({list,updatedAt:FV.serverTimestamp()},{merge:true})
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
  const target=numVal('goal-target')||0;
  const current=numVal('goal-current')||0;
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

// HISTORY is loaded from localStorage (seeded via JSON import).
function getHistory(){return cGet('sw3_history')||[];}

// ══════════════════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════════════════
const now=appNow();
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
  budgets:(m,y)=>`sw3_bud_${y}_${m}`, // v4.7 format: {categories} | {none:true}
  lastSync:'sw3_last_sync',
  fbSyncVer:'sw3_fb_sync_ver',
  customLines:'sw3_custom_lines',
  currency:'sw3_dash_currency',
};
// This device's copy of the data. Until v4.7 it lived in localStorage, which
// caps out around 5 MB and then silently stops saving. Now it lives in
// IndexedDB with an in-memory copy, so cGet/cSet stay synchronous: reads come
// from memory, writes update memory at once and reach IndexedDB a moment
// later. Values are kept as JSON text so every cGet returns a fresh copy (as
// localStorage did). Small UI preferences and the retry queues stay in
// localStorage (_CACHE_LS), so they survive even an abrupt close.
// Note: this copy is not encrypted — on the device, the data is protected by
// the phone's own lock (App lock only hides the screen).
const _CACHE_LS=new Set(['sw3_offline_queue','sw3_ripple_queue','sw3_dash_order','sw3_hidden_cards','sw3_dash_currency']);
const _cMem=new Map();
let _cDb=null,_cMode='ls',_cPend=new Map(),_cTimer=null,_lsWarned=false;
function _cWarn(e){if(!_lsWarned){_lsWarned=true;console.warn('cache write failed - cached data may be stale:',e);}}
const cGet=k=>{
  try{
    if(_cMode==='idb'&&!_CACHE_LS.has(k)){const v=_cMem.get(k);return v?JSON.parse(v):null;}
    const v=localStorage.getItem(k);return v?JSON.parse(v):null;
  }catch{return null;}
};
const cSet=(k,v)=>{
  let s;try{s=JSON.stringify(v);}catch(e){_cWarn(e);return;}
  if(_cMode==='idb'&&!_CACHE_LS.has(k)){_cMem.set(k,s);_cPend.set(k,s);_cSchedule();return;}
  try{localStorage.setItem(k,s);}catch(e){_cWarn(e);}
};
function cDel(k){
  if(_cMode==='idb'&&!_CACHE_LS.has(k)){_cMem.delete(k);_cPend.set(k,undefined);_cSchedule();return;}
  try{localStorage.removeItem(k);}catch{}
}
// Keys (of the data copy) starting with `prefix`.
function cKeys(prefix){
  const out=[];
  if(_cMode==='idb')_cMem.forEach((_,k)=>{if(k.startsWith(prefix))out.push(k);});
  else try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith(prefix))out.push(k);}}catch{}
  return out;
}
function _cSchedule(){if(!_cTimer)_cTimer=setTimeout(_cFlush,250);}
function _cFlush(){
  _cTimer=null;
  if(!_cDb||!_cPend.size)return;
  const batch=_cPend;_cPend=new Map();
  try{
    const t=_cDb.transaction('kv','readwrite'),st=t.objectStore('kv');
    batch.forEach((v,k)=>{if(v===undefined)st.delete(k);else st.put(v,k);});
    t.onerror=()=>_cWarn(t.error);
  }catch(e){_cWarn(e);}
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')_cFlush();});
window.addEventListener('pagehide',_cFlush);
// Open the store and load it into memory before anything renders. The first
// time, the old localStorage copy is moved across (and removed, to free the
// space). Falls back to localStorage if IndexedDB isn't available.
async function cacheInit(){
  try{
    _cDb=await new Promise((res,rej)=>{const r=indexedDB.open('spendwise-cache',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
    await new Promise((res,rej)=>{
      const rq=_cDb.transaction('kv','readonly').objectStore('kv').openCursor();
      rq.onsuccess=()=>{const c=rq.result;if(c){_cMem.set(c.key,c.value);c.continue();}else res();};
      rq.onerror=()=>rej(rq.error);
    });
    _cMode='idb';
    if(!localStorage.getItem('sw3_cache_moved')){
      const move=[];
      for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith('sw3_')&&!_CACHE_LS.has(k)&&!_LS_ONLY.test(k))move.push(k);}
      move.forEach(k=>{const v=localStorage.getItem(k);if(v!=null&&!_cMem.has(k)){_cMem.set(k,v);_cPend.set(k,v);}});
      _cFlush();
      move.forEach(k=>{try{localStorage.removeItem(k);}catch{}});
      localStorage.setItem('sw3_cache_moved','1');
    }
  }catch(e){console.warn('IndexedDB unavailable - keeping this device\'s data copy in localStorage',e);_cMode='ls';_cDb=null;}
}
// localStorage keys that are read directly (preferences, lock, queues) and
// must never be moved into the data copy.
const _LS_ONLY=/^sw3_(theme|applock|fab_pos|last_page|local_mode|vault_incq|lockv_|getstarted_off|dismissed_notifs|hist_scan_at|cache_moved|last_seen_ym)/;

function loadFromCache(){
  _applyProfile(getProfile());
  _applyCustomIcons();

  const m=S.expMonth,y=S.expYear;
  S.txns=cGet(CK.txns(m,y))||[];
  S.income=cGet(CK.inc(m,y))||[];
  S.investments=cGet(CK.inv(m,y))||{};
  S.cash=cGet(CK.cash(m,y))||{};
  S.debtors=cGet(CK.debtors)||[];
  S.loans=cGet(CK.loans)||[];
  S.budgets=budgetFor(m,y);
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
    .set({overrides:ovr,updatedAt:FV.serverTimestamp()},{merge:false})
    .catch(e=>console.warn('fxOverrides sync failed',e));
}
// Rate for a month: your own rate (Settings → Advanced) → the automatic rate
// → the built-in table → the nearest earlier month that has one.
function getFxRates(m,y){
  const k=fxKey(m,y);const ovr=getFxOverrides();
  if(ovr[k])return ovr[k];
  const a=getFxAuto()[k];if(a&&a.USD)return {USD:a.USD,GBP:a.GBP||Math.round(a.USD*1.27)};
  return FX_RATES[k]||_nearestFx(k);
}
function _nearestFx(k){
  const auto=getFxAuto(),ovr=getFxOverrides();
  const all={...FX_RATES};Object.keys(auto).forEach(x=>{if(auto[x]&&auto[x].USD)all[x]={USD:auto[x].USD,GBP:auto[x].GBP||Math.round(auto[x].USD*1.27)};});Object.assign(all,ovr);
  const keys=Object.keys(all).sort();
  const before=keys.filter(x=>x<=k);
  return all[before.length?before[before.length-1]:keys[0]]||{USD:1600,GBP:2050};
}
// ── Automatic exchange rates (v4.7) ──
// Once a day the app fetches today's dollar and pound rates in naira from a
// free public source (no account; nothing about you is sent) and keeps them
// as this month's rate, in appConfig/fxAuto so every device agrees. A rate you
// type in Settings → Advanced → Exchange rates always wins.
const FX_AUTO_KEY='sw3_fx_auto';
const FX_AUTO_URL='https://open.er-api.com/v6/latest/USD';
function getFxAuto(){return cGet(FX_AUTO_KEY)||{};}
async function loadFxAuto(){
  if(!db)return;
  try{const d=await db.collection('appConfig').doc('fxAuto').get();
    if(d.exists&&d.data()?.rates)cSet(FX_AUTO_KEY,{...getFxAuto(),...d.data().rates});
  }catch(e){_warnLoad('loadFxAuto',e);}
}
async function fxAutoUpdate(){
  if(navigator.onLine===false)return;
  const n=appNow(),k=fxKey(n.getMonth()+1,n.getFullYear());
  const auto=getFxAuto();
  if(auto[k]&&Date.now()-(auto[k].at||0)<864e5)return;
  try{
    const r=await fetch(FX_AUTO_URL,{cache:'no-store'});
    if(!r.ok)return;
    const j=await r.json();
    const ngn=+(j&&j.rates&&j.rates.NGN),gbp=+(j&&j.rates&&j.rates.GBP);
    if(!(ngn>100))return;
    auto[k]={USD:Math.round(ngn),GBP:gbp>0?Math.round(ngn/gbp):Math.round(ngn*1.27),at:Date.now()};
    cSet(FX_AUTO_KEY,auto);
    if(db)db.collection('appConfig').doc('fxAuto').set({rates:auto,updatedAt:FV.serverTimestamp()},{merge:true}).catch(e=>console.warn('fxAuto sync failed',e));
    renderDashboard();
  }catch(e){console.warn('exchange rate fetch failed',e);}
}
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
  // Safely evaluate simple arithmetic expressions: digits, +, -, *, /, (, ), spaces, commas, dots.
  // "5k" / "2.5m" shorthands are expanded first (Quick add teaches them).
  const cleaned=String(raw==null?'':raw).replace(/[,₦$£]/g,'').trim().replace(/(\d+(?:\.\d+)?)\s*([kKmM])(?![a-zA-Z])/g,(_,d,u)=>String(Math.round(parseFloat(d)*(u.toLowerCase()==='k'?1e3:1e6)*100)/100));
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
// Read a money/number field for saving: commas, "5k", "2.5m" and simple sums
// all work even if the field never lost focus (so the blur formatter never ran).
function numVal(elOrId){const el=typeof elOrId==='string'?document.getElementById(elOrId):elOrId;return parseFloat(_evalExpr(el?el.value:''));}
function _makeNumInput(el){
  // Wrap existing input in num-wrap if not already
  if(el.closest('.num-wrap')) return;
  const wrap=document.createElement('div');wrap.className='num-wrap';
  el.parentNode.insertBefore(wrap,el);wrap.appendChild(el);
  const disp=document.createElement('div');disp.className='num-display';
  disp.textContent='';wrap.appendChild(disp);
  // While NOT focused: hide the raw text and show the comma-formatted overlay.
  // While focused: reveal the raw (unformatted) text and hide the overlay, so
  // the caret lands exactly where it's clicked. The overlay shows "1,000,000"
  // (9 chars) while the input's real value is "1000000" (7 chars); leaving it
  // visible during editing made the caret map to the raw text and appear in the
  // wrong place — the reported "cursor doesn't match the text" bug.
  el.style.color='transparent';el.style.caretColor='var(--text)';
  el.addEventListener('input',()=>_syncNumDisplay(el));
  el.addEventListener('focus',()=>{el.style.color='var(--text)';if(disp)disp.style.opacity='0';});
  el.addEventListener('blur',()=>{
    // Evaluate any expression, then reformat
    const evaled=_evalExpr(el.value);
    if(evaled!==el.value) el.value=evaled;
    el.style.color='transparent';
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
// The app clock. Normally the real date; after a month is closed early (Settings
// or the Home card, "Close September" on 29 Sept) it is the 1st of the next
// month until the calendar catches up, so new entries, the live month and the
// month-end work all move on. Use appNow()/todayStr() for anything that picks a
// month or day; keep new Date()/Date.now() for timestamps and throttles.
function _closedThrough(){try{const p=getProfile();return (p&&p.closedThrough)||'';}catch(e){return '';}}
function _realMonth(){const n=new Date();return n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0');}
function appNow(){
  const n=new Date(),c=_closedThrough();
  if(c&&_realMonth()<=c){const [y,m]=c.split('-').map(Number);return new Date(y,m,1,12);}
  return n;
}
function _earlyClosed(){const c=_closedThrough();return !!c&&_realMonth()===c;}
const todayStr=()=>toLocalISO(appNow());
const toLocalISO=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
// Escape a value for safe interpolation inside a single-quoted onclick="...('...')" argument.
function jsq(s){return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");}
const MONTHS_SHORT=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDate(iso){if(!iso)return'—';const p=iso.slice(0,10).split('-');if(p.length<3)return iso;return`${parseInt(p[2],10)}-${MONTHS_SHORT[parseInt(p[1],10)-1]}-${p[0]}`;}
// Returns numeric ms from a Firestore Timestamp, JS Date, ISO string, or 0 for missing
function txnTs(t){if(!t)return 0;if(typeof t.toMillis==='function')return t.toMillis();if(typeof t.seconds==='number')return t.seconds*1000+(t.nanoseconds||0)/1e6;if(t instanceof Date)return t.getTime();if(typeof t==='string')return new Date(t).getTime()||0;return 0;}
const curM=()=>appNow().getMonth()+1;
const curY=()=>appNow().getFullYear();
const bSt=(s,b)=>!b?'ok':s/b>=1?'over':s/b>=0.8?'warn':'ok';

function fmtCur(ngn, currency, m, y) {
  if(!currency||currency==='NGN'||currency==='NATIVE') return fN(ngn);
  const rates=getFxRates(m||S.dashMonth,y||S.dashYear);
  const sym=currency==='USD'?'$':'£';
  return sym+(ngn/(rates[currency]||1)).toLocaleString('en-NG',{maximumFractionDigits:0});
}
// An amount in the display currency picked in any page header ("Effective"
// shows naira, since these totals mix accounts).
function fC(ngn){const c=S.dashCurrency;return fmtCur(ngn,c==='NATIVE'?'NGN':c);}
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
function _autoGrowTA(el){el.style.height='auto';el.style.height=el.scrollHeight+'px';}
function openMod(id){
  document.getElementById(id).classList.add('open');
  // Deferred a tick so it runs after any synchronous .value= population that
  // happens right after the openMod() call (e.g. openEditExp sets e-notes
  // after opening exp-modal) — otherwise the box would size to the old/empty value.
  setTimeout(()=>document.querySelectorAll('#'+id+' textarea.ta-notes').forEach(_autoGrowTA),0);
}
function closeMod(id){document.getElementById(id).classList.remove('open');}

function setSyncStatus(st){
  const dot=document.getElementById('sync-dot'),lbl=document.getElementById('sync-lbl');
  if(!dot||!lbl) return;
  dot.className='sync-dot';
  if(DATA_MODE==='local'&&st!=='error') st='local';
  const map={syncing:{cls:'yellow',text:'Syncing'},synced:{cls:'green',text:'Synced'},offline:{cls:'red',text:'Offline'},error:{cls:'red',text:'Error'},local:{cls:'yellow',text:'This device'},legacy:{cls:'yellow',text:'Not syncing'},locked:{cls:'yellow',text:'Locked'}};
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
// ── Data modes (v4.5) ──
// 'cloud'  signed in + key unlocked on this device: db = VAULT.udb, every doc
//          encrypted under users/{uid}/…
// 'local'  not signed in: db = VAULT's IndexedDB-backed local db, nothing
//          leaves the device. Same API, so the rest of the app doesn't care.
// 'locked' signed in but this device has no key (it was cleared): db = null
//          until the user signs in again.
// 'legacy' a device that ran a pre-accounts version: caches hold the owner's
//          data from the old shared collections. db = null (render from cache,
//          never overwrite it) until the user creates an account and imports.
let DATA_MODE='local';
// The owner's uid — set after the owner creates their account (also in
// firestore.rules). Unlocks publishing shared AI keys and the owner-only
// repair tools.
const OWNER_UID='pkuOGxHr19goU9qJjmPq2f3MzEw2';
const LOCAL_MODE_LS='sw3_local_mode';
function _hasLegacyCache(){
  try{if(localStorage.getItem(LOCAL_MODE_LS))return false;
    if(cKeys('sw3_txns_').length)return true;}catch{}
  return false;
}
function initFirebase(){
  try{_clockMoveViews(false);}catch(e){console.warn('month clock',e);}  // a month closed early opens on the next one
  try{loadFromCache();}catch(e){console.error('loadFromCache threw',e);}
  try{renderAll();}catch(e){console.error('renderAll threw',e);}
  if(S.isStale) showStaleBar();
  (async()=>{
    await new Promise(resolve=>{function check(){if(typeof firebase!=='undefined'&&firebase.auth)resolve();else setTimeout(check,50);}check();});
    firebase.initializeApp({apiKey:"AIzaSyCIe7f02DrbrwZLIBmNlvslXWmNLVMiluw",authDomain:"spendwise-d6393.firebaseapp.com",projectId:"spendwise-d6393",storageBucket:"spendwise-d6393.firebasestorage.app",messagingSenderId:"460779232494",appId:"1:460779232494:web:cd3c178b88d0f22044a7ff"});
    const fs=firebase.firestore();
    fs.enablePersistence().catch(()=>{});
    VAULT.attach(fs);

    const user=await new Promise(res=>{const u=firebase.auth().onAuthStateChanged(x=>{u();res(x);});});
    if(user&&await VAULT.restoreDevice(user.uid)){await _enterMode('cloud');}
    else if(user){await _enterMode('locked');}
    else if(_hasLegacyCache()){await _enterMode('legacy');}
    else{await _enterMode('local');}
  })();
}

// Switch the data source and (re)load everything from it.
async function _enterMode(mode){
  stopRealtimeListeners();
  DATA_MODE=mode;
  if(mode==='cloud') db=VAULT.udb;
  else if(mode==='local'){db=await VAULT.openLocal();try{localStorage.setItem(LOCAL_MODE_LS,'1');}catch{}}
  else db=null;
  _renderModeBar();
  if(mode==='locked'){setSyncStatus('locked');if(typeof acctShowUnlock==='function')acctShowUnlock();return;}
  if(mode==='legacy'){_invMigrateGate=false;setSyncStatus('legacy');return;}
  if(mode==='local'){setSyncStatus('local');}
  await _bootSync();
  if(typeof suShouldOnboard==='function'&&suShouldOnboard()) suStart();
}

async function _bootSync(){
    if(DATA_MODE==='cloud'&&!navigator.onLine){_invMigrateGate=true;setSyncStatus('offline');return;}
    if(DATA_MODE==='cloud')setSyncStatus('syncing');
    if(DATA_MODE==='cloud'){try{await VAULT.flushPending();}catch(e){console.warn('pending balance changes not yet applied',e);}}
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
      S.budgets=budgetFor(m,y);
      _migrateFixedBills();       // v4.7: Fixed Bills → recurring (once per account)
      _migrateStandardBudget();   // v4.7: one budget for every month (once per account)
      cSet(CK.lastSync,Date.now());setSyncStatus(DATA_MODE==='local'?'local':'synced');hideStaleBar();renderAll();startRealtimeListeners();
      runAutoRecurring();         // fire-and-forget: posts "automatic" recurring items that have come due
      runAutoInterest();          // fire-and-forget: month-end interest on accounts with no maturity date
      fxAutoUpdate();             // fire-and-forget: this month's exchange rates
      _prefetchHistoryMonths(); // fire-and-forget: pulls prior months so smart insights have history on this device
      _healCashLedgers(); // fire-and-forget: pushes any ledger entries stranded locally on this device up to Firestore
    }catch(e){console.error(e);setSyncStatus('error');}
}

// Wipe every per-account data cache on this device (sign-out, or replacing
// this device's local data with an account's). UI prefs survive.
const _KEEP_ON_WIPE=new Set(['sw3_vault_incq','sw3_theme','sw3_fab_pos','sw3_dash_order','sw3_hidden_cards','sw3_last_page','sw3_dash_currency',LOCAL_MODE_LS]);
function _wipeDataCaches(){
  try{
    cKeys('sw3_').forEach(k=>{if(!_KEEP_ON_WIPE.has(k))cDel(k);});
    const ks=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith('sw3_')&&!_KEEP_ON_WIPE.has(k)&&k!=='sw3_cache_moved')ks.push(k);}
    ks.forEach(k=>localStorage.removeItem(k));
    _cFlush();
  }catch(e){console.warn('cache wipe failed',e);}
  S.txns=[];S.income=[];S.investments={};S.cash={};S.debtors=[];
}

// Header strip telling the user where their data lives.
function _renderModeBar(){
  let el=document.getElementById('mode-bar');
  if(!el){el=document.createElement('div');el.id='mode-bar';const app=document.querySelector('.app');if(app)app.prepend(el);else return;}
  const msg={
    local:['📱 Saved on this device only.','Sign in to sync','acctShowWhy()'],
    legacy:['SpendWise now has private accounts.','Create yours to keep syncing','acctShowWhy(true)'],
    locked:['🔒 Enter your password to unlock your data on this device.','Unlock','acctShowUnlock()'],
  }[DATA_MODE];
  if(!msg){el.style.display='none';el.innerHTML='';return;}
  el.style.display='';
  el.innerHTML=`<span>${msg[0]}</span> <a onclick="${msg[2]}">${msg[1]} ›</a>`;
}

async function syncAll(){
  const m=S.expMonth,y=S.expYear;
  await Promise.all([loadTxns(m,y),loadIncome(m,y),loadInvData(m,y),loadCashData(m,y),loadDebtors(),loadBudgets(m,y),loadHistoricalSummary(),loadInvConfig(),loadCashLogos(),loadCashAccounts(),loadLoans(),loadFxOverrides(),loadNWConfig(),loadRecurring(),loadCustomCats(),loadCustomLines(),loadAiChats(),loadGoals(),loadRules(),loadAiKeys(),loadSpecialBudgets(),loadInterestPosts(),loadProfile(),loadSharedAiKeys(),loadCashInterest(),loadFxAuto()]);
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
let _aiKeysListener=null;
let _sbListener=null;
let _linesListener=null;
let _intPostListener=null;
let _budgetListener=null;
let _xfrListener=null;
let _profileListener=null;
let _cashIntListener=null;

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
        cSet('sw3_usd_accounts',Array.isArray(snap.data().usd)?snap.data().usd:[]);
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
      if(_invCfgPending) return;   // a local change is still on its way up
      const d=snap.data()||{};
      // Firestore still delivers a "server ack" event for our OWN writes once
      // they commit (hasPendingWrites only filters the first, optimistic echo)
      // — comparing against the local cache turns that ack into a no-op instead
      // of a full re-render that would blow away a logo input mid-keystroke.
      let changed=false;
      if(d.platforms&&d.platforms.length&&JSON.stringify(d.platforms)!==JSON.stringify(getPlatforms())){cSet(PLATFORMS_KEY,d.platforms);changed=true;}
      if(d.invMeta&&Object.keys(d.invMeta).length&&JSON.stringify(d.invMeta)!==JSON.stringify(getInvMeta())){cSet(INV_META_KEY,d.invMeta);changed=true;}
      if(d.invSubs&&Object.keys(d.invSubs).length&&JSON.stringify(d.invSubs)!==JSON.stringify(getInvSubs())){cSet(INV_SUBS_KEY,d.invSubs);changed=true;}
      if(Array.isArray(d.invMoves)&&JSON.stringify(d.invMoves)!==JSON.stringify(getInvMovements())){cSet(INV_MOVE_KEY,d.invMoves);}
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
        cSet('sw3_custom_cats',arr);
        if(snap.data()?.icons)cSet('sw3_custom_icons',snap.data().icons);
        _applyCustomIcons();
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

  // AI API keys — real-time cross-device sync. Compare against the local cache
  // so Firestore's own server-ack echo of our write is a no-op instead of a
  // re-render that would clear the "add key" inputs mid-typing.
  if(_aiKeysListener){_aiKeysListener();_aiKeysListener=null;}
  _aiKeysListener=db.collection('appConfig').doc('aiKeys')
    .onSnapshot(snap=>{
      if(!snap.exists||snap.metadata.hasPendingWrites) return;
      const d=snap.data()||{};
      if(!Array.isArray(d.list)) return;
      let changed=false;
      if(JSON.stringify(d.list)!==JSON.stringify(_aiKeys())){ S.aiKeys=d.list; cSet(AI_KEYS_LS,d.list); changed=true; }
      if(typeof d.activeId==='string' && d.activeId!==(cGet(AI_ACTIVE_KEY_LS)||'')){ cSet(AI_ACTIVE_KEY_LS,d.activeId); changed=true; }
      if(changed){ renderSettData(); renderProjAI(); }
    },err=>console.warn('aiKeys listener:',err));

  // Special budgets — real-time cross-device sync. Skip our own pending writes,
  // and don't re-render while a field in the pane is focused (that would drop
  // an edit in progress); the pane is display:none unless its tab is on screen.
  if(_sbListener){_sbListener();_sbListener=null;}
  _sbListener=db.collection('specialBudgets')
    .onSnapshot(snap=>{
      if(snap.metadata.hasPendingWrites) return;
      const list=snap.docs.map(d=>({id:d.id,...d.data()}));
      _sbSortList(list);
      S.specialBudgets=list;cSet(SB_LS,list);
      const pane=document.getElementById('special-pane');
      if(pane&&pane.style.display!=='none'&&!pane.contains(document.activeElement))renderSpecial();
    },err=>console.warn('specialBudgets listener:',err));

  // Expense lines (payees per category) — real-time cross-device sync.
  // Mirrors the customCats listener above. The __removed__ map is stored in its
  // own `removed` field because Firestore rejects field names that both start
  // and end with "__" (see saveCustomLines).
  if(_linesListener){_linesListener();_linesListener=null;}
  _linesListener=db.collection('appConfig').doc('customLines')
    .onSnapshot(snap=>{
      if(!snap.exists||snap.metadata.hasPendingWrites) return;
      const d=snap.data()||{};
      if(!d.lines||typeof d.lines!=='object') return;
      const obj={...d.lines};
      if(d.removed&&typeof d.removed==='object') obj.__removed__=d.removed;
      S.customExpLines=obj;
      cSet(CK.customLines,obj);
      const pane=document.getElementById('exp-pane');
      if(pane&&pane.style.display!=='none'&&!pane.contains(document.activeElement))renderExpenses();
    },err=>console.warn('customLines listener:',err));

  // Interest posting ledger — the highest-value of these: without it two
  // devices can each post the same month's interest, double-counting income.
  // Cache-only; the Income tab re-reads it on its next render.
  if(_intPostListener){_intPostListener();_intPostListener=null;}
  _intPostListener=db.collection('appConfig').doc('interestPosts')
    .onSnapshot(snap=>{
      if(!snap.exists||snap.metadata.hasPendingWrites) return;
      const posts=snap.data()?.posts;
      if(posts&&typeof posts==='object') cSet(INT_POSTS_KEY,posts);
    },err=>console.warn('interestPosts listener:',err));

  // Monthly category budgets — scoped to the month on screen, like _cashListener.
  // A collection-wide listener would pull every month ever recorded.
  if(_budgetListener){_budgetListener();_budgetListener=null;}
  _budgetListener=db.collection('budgets').doc(sid(m,y))
    .onSnapshot(snap=>{
      if(snap.metadata.hasPendingWrites) return;
      const cats=snap.exists?snap.data()?.categories:null;
      cSet(CK.budgets(m,y),cats&&typeof cats==='object'?{categories:cats}:{none:true});
      if(S.expMonth!==m||S.expYear!==y) return;          // month moved on
      S.budgets=budgetFor(m,y);
      renderDashboard();
      const pane=document.getElementById('exp-pane');
      if(pane&&pane.style.display!=='none'&&!pane.contains(document.activeElement))renderExpenses();
    },err=>console.warn('budgets listener:',err));

  // Cash interest rates and auto exchange rates — small settings docs.
  if(_cashIntListener){_cashIntListener();_cashIntListener=null;}
  _cashIntListener=db.collection('appConfig').doc('cashInterest')
    .onSnapshot(snap=>{
      if(!snap.exists||snap.metadata.hasPendingWrites) return;
      const meta=snap.data()?.meta;
      if(meta&&JSON.stringify(meta)!==JSON.stringify(getCashInterestMeta())){cSet(CASH_INT_KEY,meta);renderCashPage();renderIncome();}
    },err=>console.warn('cashInterest listener:',err));

  // Profile (standard budget, onboarding, migrations) — so a standard budget
  // changed on another device applies here too.
  if(_profileListener){_profileListener();_profileListener=null;}
  _profileListener=db.collection('appConfig').doc('profile')
    .onSnapshot(snap=>{
      if(!snap.exists||snap.metadata.hasPendingWrites) return;
      const p=snap.data()||{};delete p.updatedAt;
      if(JSON.stringify(p)===JSON.stringify(getProfile()))return;
      const _clk=_closedThrough();
      cSet(PROFILE_KEY,p);_applyProfile(p);
      if((p.closedThrough||'')!==_clk){_clockMoveViews(true);renderAll();}
      S.budgets=budgetFor(S.expMonth,S.expYear);
      renderDashboard();
      const sb=document.getElementById('sett-budget');
      if(sb&&sb.style.display!=='none'&&!sb.contains(document.activeElement))renderSettBudget();
    },err=>console.warn('profile listener:',err));

  // Transfers — month-scoped, mirroring _txnListener. Feeds the account
  // drill-down history and the Transfer History modal.
  if(_xfrListener){_xfrListener();_xfrListener=null;}
  _xfrListener=db.collection('transfers').where('year','==',y).where('month','==',m)
    .onSnapshot(snap=>{
      if(snap.metadata.hasPendingWrites) return;
      const list=snap.docs.map(d=>({id:d.id,...d.data()}))
        .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
      cSet(CK.xfr(m,y),list);
      const hist=document.getElementById('xfr-hist-modal');
      if(hist&&hist.classList.contains('show')) _renderXfrHistory(list,m,y);
    },err=>console.warn('transfers listener:',err));

  // cashLedger is deliberately NOT listened to. It is append-only via
  // arrayUnion and capped at 500 entries/month, so a listener would re-download
  // the whole array on every transaction from any device. Its only consumer
  // (the balance audit) already does a fresh .get() when opened, and
  // _syncCashLedgerUp heals stranded entries. This is a decision, not a gap.
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
  if(_aiKeysListener){_aiKeysListener();_aiKeysListener=null;}
  if(_sbListener){_sbListener();_sbListener=null;}
  if(_linesListener){_linesListener();_linesListener=null;}
  if(_intPostListener){_intPostListener();_intPostListener=null;}
  if(_budgetListener){_budgetListener();_budgetListener=null;}
  if(_xfrListener){_xfrListener();_xfrListener=null;}
  if(_profileListener){_profileListener();_profileListener=null;}
  if(_cashIntListener){_cashIntListener();_cashIntListener=null;}
}

async function loadTxns(m,y){
  // Always fetch from Firestore — local cache is only a fallback, not authoritative
  try{
    let snap;
    try{snap=await db.collection('transactions').where('year','==',y).where('month','==',m).orderBy('date','desc').get();}
    catch{snap=await db.collection('transactions').where('year','==',y).where('month','==',m).get();}
    // An empty answer from the server (or the on-device db) is real: the last
    // entry may have been deleted elsewhere. An empty answer from an offline
    // cache is not, so the local copy is kept then.
    if(snap&&(snap.size>0||db.isLocal||!snap.metadata?.fromCache)){
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
  if(!_dbReady()) return;
  let fetched=0;
  for(const {m:mm,y:yy} of _prevMonthsList(S.expMonth,S.expYear,6)){
    if(Array.isArray(cGet(CK.txns(mm,yy)))) continue;
    try{
      const snap=await db.collection('transactions').where('year','==',yy).where('month','==',mm).get();
      // Apply the same category renames the one-time local migrations do,
      // since those already ran before these months were cached
      cSet(CK.txns(mm,yy),snap.docs.map(d=>{const t={id:d.id,...d.data()};return t;}));
      fetched++;
    }catch(e){/* offline or rules — insights degrade gracefully */}
  }
  if(fetched){try{renderDashAlerts();renderProjInsights();}catch(e){console.warn("alert/insight render failed",e);}}
}

async function loadIncome(m,y){
  // Always fetch from Firestore
  try{
    let snap;
    try{snap=await db.collection('income').where('year','==',y).where('month','==',m).orderBy('date','desc').get();}
    catch{snap=await db.collection('income').where('year','==',y).where('month','==',m).get();}
    if(snap&&(snap.size>0||db.isLocal||!snap.metadata?.fromCache)){
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
    const _now=appNow();
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
  try{
    const localCash=cGet(CK.cash(m,y))||{};
    const doc=await db.collection('cashBalances').doc(sid(m,y)).get();

    // Guard: only seed/repair for months up to the current real month.
    const _now=appNow();
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
          try{await db.collection('cashBalances').doc(sid(m,y)).set(repaired,{merge:true});}catch(e){console.warn("cashBalances repair write failed",e);}
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
        try{await db.collection('cashBalances').doc(sid(m,y)).set(seed,{merge:true});}catch(e){console.warn("cashBalances seed write failed",e);}
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
    if(snap&&(snap.size>0||db.isLocal||!snap.metadata?.fromCache)){
      S.debtors=snap.docs.map(d=>({id:d.id,...d.data()}));
      cSet(CK.debtors,S.debtors);
    }
  }catch(e){_warnLoad('loadDebtors',e);}
}

// ── Monthly history (income and spending per month) ────────────────────────
// sw3_history feeds the 6-month chart, Treasury, History and the full-year
// view. Until v4.7 every app open re-read EVERY transaction and income record
// and rewrote every historicalSummary doc (~1,300 reads and ~35 writes per
// launch, against a free allowance shared by every user). Now:
//   · opening the app reads only the summary docs (one small doc per month);
//   · a full re-scan runs at most once a day per device, and also refreshes
//     this device's copy of every month (search, insights and charts use it);
//   · a summary doc is written only when its totals actually change
//     (_histTouch runs after every save and delete).
const HIST_SCAN_LS='sw3_hist_scan_at';
function _histLabel(m,y){return MS[m-1]+" '"+String(y).slice(2);}
function _histSum(txns,inc){return {expenses:(txns||[]).reduce((s,t)=>s+txNGN(t),0),income:(inc||[]).reduce((s,i)=>s+txNGN(i),0)};}
// Put a month's totals into `hist`; true if anything changed.
function _histUpsert(hist,m,y,tot){
  const i=hist.findIndex(h=>h.year===y&&h.month===m);
  if(i>=0){
    if(hist[i].expenses===tot.expenses&&hist[i].income===tot.income)return false;
    hist[i]={...hist[i],...tot};return true;
  }
  if(!tot.expenses&&!tot.income)return false;
  hist.push({year:y,month:m,label:_histLabel(m,y),...tot});
  hist.sort((a,b)=>a.year!==b.year?a.year-b.year:a.month-b.month);
  return true;
}
function _histWrite(m,y,tot){
  if(!db)return;
  db.collection('historicalSummary').doc(sid(m,y))
    .set({year:y,month:m,label:_histLabel(m,y),...tot},{merge:true})
    .catch(e=>console.warn('historicalSummary write failed',e));
}
// Recompute one month from what this device holds (the month on screen, or
// its cached copy) and save it if the totals changed.
function _histTouch(m,y){
  if(!m||!y)return;
  const inView=m===S.expMonth&&y===S.expYear;
  const tx=inView?S.txns:cGet(CK.txns(m,y)), inc=inView?S.income:cGet(CK.inc(m,y));
  if(!Array.isArray(tx)&&!Array.isArray(inc))return;
  const tot=_histSum(tx,inc);
  const hist=getHistory();
  if(_histUpsert(hist,m,y,tot)){cSet('sw3_history',hist);_histWrite(m,y,tot);}
}
async function loadHistoricalSummary(){
  let hist;
  try{
    const snap=await db.collection('historicalSummary').get();
    hist=snap.docs.map(d=>{const h=d.data();return {year:h.year,month:h.month,label:h.label||_histLabel(h.month||1,h.year),income:h.income||0,expenses:h.expenses||0};}).filter(h=>h.year&&h.month);
    hist.sort((a,b)=>a.year!==b.year?a.year-b.year:a.month-b.month);
  }catch(e){_warnLoad('loadHistoricalSummary',e);hist=getHistory();}
  let last=0;try{last=+localStorage.getItem(HIST_SCAN_LS)||0;}catch{}
  // Reads from the on-device database cost nothing, so local mode always scans.
  if(!hist.length||db.isLocal||Date.now()-last>864e5){
    try{await _histFullScan(hist);try{localStorage.setItem(HIST_SCAN_LS,String(Date.now()));}catch{}}
    catch(e){_warnLoad('history scan',e);}
  }
  _histUpsert(hist,S.expMonth,S.expYear,_histSum(S.txns,S.income));
  cSet('sw3_history',hist);
}
async function _histFullScan(hist){
  const [tx,inc]=await Promise.all([db.collection('transactions').get(),db.collection('income').get()]);
  const by={};
  const add=(d,k)=>{const r={id:d.id,...d.data()};if(!r.year||!r.month)return;const key=r.year*100+r.month;(by[key]=by[key]||{tx:[],inc:[]})[k].push(r);};
  tx.docs.forEach(d=>add(d,'tx'));inc.docs.forEach(d=>add(d,'inc'));
  const byDate=(a,b)=>a.date>b.date?-1:a.date<b.date?1:txnTs(b.createdAt)-txnTs(a.createdAt);
  Object.keys(by).forEach(k=>{
    const v=by[k],y=Math.floor(k/100),m=k%100;
    if(!(m===S.expMonth&&y===S.expYear)){cSet(CK.txns(m,y),v.tx.sort(byDate));cSet(CK.inc(m,y),v.inc.sort(byDate));}
    const tot=_histSum(v.tx,v.inc);
    if(_histUpsert(hist,m,y,tot))_histWrite(m,y,tot);
  });
}
// First paint on a device with no saved history yet: build it from whatever
// months are cached. The database version replaces it once it loads.
function _buildHistoryFromCache(){
  if(getHistory().length)return;
  const hist=[];
  cKeys('sw3_txns_').concat(cKeys('sw3_inc_')).forEach(k=>{
    const mt=k.match(/_(\d{4})_(\d{1,2})$/);if(!mt)return;
    const y=+mt[1],m=+mt[2];
    _histUpsert(hist,m,y,_histSum(cGet(CK.txns(m,y)),cGet(CK.inc(m,y))));
  });
  if(hist.length)cSet('sw3_history',hist);
}

async function loadBudgets(m,y){
  // The month's own budget if it has one; otherwise the standard budget.
  try{
    const doc=await db.collection('budgets').doc(sid(m,y)).get();
    cSet(CK.budgets(m,y),doc.exists&&doc.data()?.categories?{categories:doc.data().categories}:{none:true});
  }catch(e){_warnLoad('loadBudgets',e);}
  if(S.expMonth===m&&S.expYear===y)S.budgets=budgetFor(m,y);
}
function reloadMonth(m,y){
  S.expMonth=m;S.expYear=y;S.expCat='All';
  // Home shows the same month as Expenses.
  S.dashMonth=m;S.dashYear=y;try{initPeriodSelector();}catch(e){console.warn('period selector refresh failed',e);}
  S.txns=cGet(CK.txns(m,y))||[];
  S.income=cGet(CK.inc(m,y))||[];
  S.investments=cGet(CK.inv(m,y))||{};
  S.budgets=budgetFor(m,y);
  renderExpenses();renderDashboard();
  if(document.getElementById('inc-pane')?.style.display!=='none') renderIncome();
  if(_dbReady()){
    setSyncStatus('syncing');
    Promise.all([loadTxns(m,y),loadIncome(m,y),loadInvData(m,y),loadBudgets(m,y)])
      .then(()=>{
        if(S.expMonth===m&&S.expYear===y){
          S.txns=cGet(CK.txns(m,y))||S.txns;
          S.income=cGet(CK.inc(m,y))||S.income;
          S.investments=cGet(CK.inv(m,y))||S.investments;
          S.budgets=budgetFor(m,y);
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

// ── FLOATING BUTTONS (every tab) ───────────────────────────────────────────
// Two buttons stacked in one group: + (Quick add, opens the form) and the mic
// above it (Say it). Ask AI is the first tab of AI/Analytics, so the buttons
// are hidden there (they'd sit on the chat box). Drag either button to move
// the pair; the position is remembered on this device.
const FAB_POS_LS='sw3_fab_pos';
function _fabEl(){return document.getElementById('fab-group');}
function _fabApplyPos(){
  const fab=_fabEl();if(!fab)return;
  let p=null;try{p=JSON.parse(localStorage.getItem(FAB_POS_LS)||'null');}catch{}
  if(!p){fab.style.left='';fab.style.top='';fab.style.right='';fab.style.bottom='';return;}
  const w=fab.offsetWidth||48,h=fab.offsetHeight||108;
  // Stored as fractions of the viewport so rotation / resizing keeps it on screen.
  const x=Math.min(Math.max(8,p.fx*window.innerWidth-w/2),window.innerWidth-w-8);
  const y=Math.min(Math.max(60,p.fy*window.innerHeight-h/2),window.innerHeight-h-8);
  fab.style.left=x+'px';fab.style.top=y+'px';fab.style.right='auto';fab.style.bottom='auto';
}
function fabMenuClose(){} // the old + menu is gone; kept for callers
function fabAction(a){
  if(a==='add'){openExpModal('expense');}
  else if(a==='voice'){openVoiceAdd();} // same tap = user gesture for the mic
  else if(a==='ai'){openAiInsight();setTimeout(()=>document.getElementById('ai-input')?.focus(),200);}
}
// Hidden on the AI chat; shown everywhere else.
let _projTabCur='ai';
function _fabVisibility(){
  const g=_fabEl();if(g)g.classList.toggle('hidden',S.page==='forecast'&&_projTabCur==='ai');
}
(function initFab(){
  const old=document.getElementById('fab');if(!old)return;
  const group=document.createElement('div');group.id='fab-group';
  group.innerHTML=`
    <button class="fab fab-say" id="fab-say" title="Say it (drag to move)" aria-label="Say it">🎤</button>
    <button class="fab" id="fab-add" title="Quick add (drag to move)" aria-label="Quick add">+</button>`;
  old.replaceWith(group);
  // Drag vs tap: a press that moves more than 8px is a drag (of the whole pair).
  let sx=0,sy=0,ox=0,oy=0,dragging=false,down=null;
  group.querySelectorAll('.fab').forEach(btn=>{
    btn.addEventListener('pointerdown',e=>{
      down=btn;dragging=false;sx=e.clientX;sy=e.clientY;
      const r=group.getBoundingClientRect();ox=sx-r.left;oy=sy-r.top;
      try{btn.setPointerCapture(e.pointerId);}catch{}
    });
    btn.addEventListener('pointermove',e=>{
      if(down!==btn)return;
      if(!dragging&&Math.hypot(e.clientX-sx,e.clientY-sy)<8)return;
      if(!dragging){dragging=true;group.classList.add('dragging');}
      const w=group.offsetWidth,h=group.offsetHeight;
      const x=Math.min(Math.max(8,e.clientX-ox),window.innerWidth-w-8);
      const y=Math.min(Math.max(60,e.clientY-oy),window.innerHeight-h-8);
      group.style.left=x+'px';group.style.top=y+'px';group.style.right='auto';group.style.bottom='auto';
      e.preventDefault();
    });
    const end=e=>{
      if(down!==btn)return;down=null;
      try{btn.releasePointerCapture(e.pointerId);}catch{}
      if(dragging){
        group.classList.remove('dragging');
        const r=group.getBoundingClientRect();
        try{localStorage.setItem(FAB_POS_LS,JSON.stringify({fx:(r.left+r.width/2)/window.innerWidth,fy:(r.top+r.height/2)/window.innerHeight}));}catch{}
      }else if(e.type==='pointerup'){haptic([6]);fabAction(btn.id==='fab-say'?'voice':'add');}
    };
    btn.addEventListener('pointerup',end);btn.addEventListener('pointercancel',end);
    // Keyboard users: Enter/Space (pointer events cover mouse and touch).
    btn.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fabAction(btn.id==='fab-say'?'voice':'add');}});
  });
  window.addEventListener('resize',_fabApplyPos);
  _fabApplyPos();
})();
// Double-tap-free way back: long-press isn't discoverable, so Settings offers a reset.
function fabResetPosition(){try{localStorage.removeItem(FAB_POS_LS);}catch{}_fabApplyPos();toast('Buttons moved back to the corner');}

function navTo(pg, deepCat){
  S.page=pg;
  try{localStorage.setItem('sw3_last_page',pg);}catch(e){}
  document.querySelectorAll('.pg').forEach(p=>p.classList.remove('active'));
  document.getElementById('pg-'+pg).classList.add('active');
  document.querySelectorAll('.bn').forEach(n=>n.classList.toggle('active',n.dataset.pg===pg));
  document.getElementById('app-body').scrollTop=0;
  _fabVisibility();
  if(pg==='forecast'&&_projTabCur==='ai')renderProjAI(); // AI is the first tab; build it on open
  if(pg==='expenses'&&deepCat){
    S.expCat=deepCat;
    renderExpenses();
    setTimeout(()=>{const el=document.getElementById('exp-summary');if(el)el.scrollIntoView({behavior:'smooth',block:'start'});},80);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// DASHBOARD PERIOD SELECTOR
// ══════════════════════════════════════════════════════════════════════════
// Years that can be picked: from the first year with any data (or this year)
// up to this year. (Until v4.7 this was a fixed 2023–2026 list.)
function _dataYears(){
  const cy=appNow().getFullYear();
  let min=cy;
  getHistory().forEach(h=>{if(h.year&&h.year<min)min=h.year;});
  cKeys('sw3_txns_').forEach(k=>{const y=+(k.match(/_(\d{4})_/)||[])[1];if(y&&y<min)min=y;});
  if(S.expYear<min)min=S.expYear;
  const out=[];for(let y=Math.max(cy,S.dashYear||cy);y>=min;y--)out.push(y);
  return out;
}
function initPeriodSelector(){
  const yearSel=document.getElementById('dash-year');
  const monthSel=document.getElementById('dash-month-sel');
  yearSel.innerHTML=_dataYears().map(y=>`<option value="${y}">${y}</option>`).join('');
  yearSel.value=S.dashYear;
  updateMonthOptions();
  monthSel.value=S.dashMonth;
}

function updateMonthOptions(){
  const y=parseInt(document.getElementById('dash-year').value);
  const monthSel=document.getElementById('dash-month-sel');
  const maxM=12;
  const minM=1;
  const opts=[{value:0,label:'Full Year'}];
  for(let m=minM;m<=maxM;m++) opts.push({value:m,label:MONTHS[m-1]});
  monthSel.innerHTML=opts.map(o=>`<option value="${o.value}">${o.label}</option>`).join('');
  monthSel.value=S.dashMonth;
}

// One currency setting for the whole app. Every page header has a picker
// (class cur-sync) and Settings → Preferences has another; changing any of
// them changes them all.
function _syncCurrencyPickers(v){
  document.querySelectorAll('select.cur-sync,select[data-cur-pref]').forEach(s=>{if(s.value!==v)s.value=v;});
}
function setDisplayCurrency(v){
  S.dashCurrency=v;cSet(CK.currency,v);
  _syncCurrencyPickers(v);
  renderDashboard();renderExpenses();renderIncome();renderForecast();renderInvestments();renderCashPage();renderDebtors();renderLoans();
  try{renderSettBudget();renderRecurringCard();}catch(e){console.warn("settings re-render failed",e);}
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
    S.budgets=budgetFor(S.dashMonth,S.dashYear);
  }
  renderDashboard();renderExpenses();renderForecast();renderInvestments();renderCashPage();
  if(_dbReady()&&S.dashMonth>0){
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
  const n=appNow();
  const _hdrDate=document.getElementById('hdr-date');if(_hdrDate)_hdrDate.textContent=MS[n.getMonth()].toUpperCase()+' '+n.getFullYear();
  initPeriodSelector();
  const _rf=[['applyDashOrder',applyDashOrder],['renderDashboard',renderDashboard],['renderExpenses',renderExpenses],['renderInvestments',renderInvestments],['renderCashPage',renderCashPage],['renderDebtors',renderDebtors],['renderLoans',renderLoans],['renderForecast',renderForecast],['renderSettings',renderSettings],['renderRecurringCard',renderRecurringCard],['renderGoalsCard',renderGoalsCard]];
  _rf.forEach(([name,fn])=>{try{fn();}catch(e){console.error('renderAll: '+name+' threw',e);_showRenderErr(name,e);}});
  try{
    const lastPg=localStorage.getItem('sw3_last_page');
    const valid=['dashboard','expenses','accounts','forecast','settings'];
    if(lastPg&&valid.includes(lastPg)&&lastPg!=='dashboard') navTo(lastPg);
  }catch(e){console.warn("renderAll failed",e);}
}

// ══════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════════════════
// ── Getting started checklist (Home, new users) ──
// Shown until every step is done, the user has logged a few entries, or they
// dismiss it. Steps tick themselves off from real data.
const GETSTARTED_LS='sw3_getstarted_off';
function _hasAnyTxns(min){
  let n=(S.txns||[]).length;
  for(const k of cKeys('sw3_txns_')){if(n>=min)break;n+=(cGet(k)||[]).length;}
  return n>=min;
}
function renderGetStarted(){
  const el=document.getElementById('dash-getstarted');if(!el)return;
  let off=false;try{off=!!localStorage.getItem(GETSTARTED_LS);}catch{}
  if(off||_hasAnyTxns(5)){el.innerHTML='';return;}
  const hasBudget=Object.values(S.budgets||{}).some(v=>+v>0);
  const steps=[
    {done:getCashAccounts().length>0,t:'Add your bank accounts',s:'Accounts → Cash → + Add accounts',go:"navTo('accounts')"},
    {done:_hasAnyTxns(1),t:'Log your first expense',s:'Tap the round + button, or type it in Quick add',go:"openExpModal('expense')"},
    {done:hasBudget,t:'Set a monthly budget',s:'Settings → Budget',go:"navTo('settings');settTab('budget',document.querySelectorAll('#pg-settings .tabs .tab')[1])"},
    {done:typeof DATA_MODE!=='undefined'&&DATA_MODE==='cloud',t:'Create an account to sync',s:'Use it on all your devices and never lose your data',go:"acctShowWhy()"},
  ];
  if(steps.every(x=>x.done)){el.innerHTML='';return;}
  const n=steps.filter(x=>x.done).length;
  el.innerHTML=`<div class="card gs-card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
      <div style="font-size:0.82rem;font-weight:700">Getting started <span style="font-size:0.66rem;color:var(--text3);font-weight:500">${n} of ${steps.length}</span></div>
      <span class="sh-link" style="font-size:0.66rem" onclick="dismissGetStarted()">Hide</span>
    </div>
    ${steps.map(x=>`<div class="gs-row${x.done?' done':''}" ${x.done?'':`onclick="${x.go}"`}>
      <span class="gs-tick">${x.done?'✓':''}</span>
      <div style="flex:1;min-width:0"><div class="gs-t">${x.t}</div>${x.done?'':`<div class="gs-s">${x.s}</div>`}</div>
      ${x.done?'':'<span class="gs-go">›</span>'}
    </div>`).join('')}
    <div class="gs-foot" onclick="openGuide()">New to SpendWise? <b>Read the guide ›</b></div>
  </div>`;
}
function dismissGetStarted(){try{localStorage.setItem(GETSTARTED_LS,'1');}catch{}renderGetStarted();}
// ── Month in review (v4.7) ────────────────────────────────────────────────
// For the first week of a month, Home shows how the month before went:
// spent, earned, saved, the change on the month before, top categories, the
// biggest expense and any category over budget. Hide dismisses it for that
// month; Share sends a short text summary.
const REVIEW_OFF_LS='sw3_review_off';
function _reviewData(){
  const n=appNow();if(n.getDate()>7)return null;
  const pm=n.getMonth()===0?12:n.getMonth(),py=n.getMonth()===0?n.getFullYear()-1:n.getFullYear();
  try{if(localStorage.getItem(REVIEW_OFF_LS)===`${py}-${pm}`)return null;}catch{}
  const tx=cGet(CK.txns(pm,py)),inc=cGet(CK.inc(pm,py));
  if(!Array.isArray(tx)||!tx.length)return null;
  const spent=tx.reduce((s,t)=>s+txNGN(t),0),income=(inc||[]).reduce((s,i)=>s+txNGN(i),0);
  const ppm=pm===1?12:pm-1,ppy=pm===1?py-1:py;
  const prev=getHistory().find(h=>h.year===ppy&&h.month===ppm);
  const cats={};tx.forEach(t=>{cats[t.category||'Others']=(cats[t.category||'Others']||0)+txNGN(t);});
  const top=Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,3);
  const biggest=tx.slice().sort((a,b)=>txNGN(b)-txNGN(a))[0];
  const B=budgetFor(pm,py);
  const over=Object.entries(cats).filter(([c,v])=>(+B[ck(c)]||0)>0&&v>+B[ck(c)]).map(([c])=>c);
  const budgeted=Object.keys(cats).filter(c=>(+B[ck(c)]||0)>0).length;
  return {pm,py,spent,income,saved:income-spent,prevSpent:prev?prev.expenses:0,top,biggest,over,budgeted,count:tx.length};
}
function renderMonthReview(){
  const el=document.getElementById('dash-review');if(!el)return;
  const d=_reviewData(),cm=_closeMonthCard();
  if(!d){el.innerHTML=cm;return;}
  const name=MONTHS[d.pm-1];
  const chg=d.prevSpent?Math.round((d.spent-d.prevSpent)/d.prevSpent*100):null;
  const rate=d.income>0?Math.round(d.saved/d.income*100):null;
  el.innerHTML=cm+`<div class="card mr-card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <div style="font-size:0.84rem;font-weight:800">${name} in review</div>
      <span class="sh-link" style="font-size:0.66rem" onclick="dismissMonthReview()">Hide</span>
    </div>
    <div class="mr-grid">
      <div><div class="mr-l">Spent</div><div class="mr-v">${maskIf('review',fC(d.spent))}</div>${chg!=null?`<div class="mr-s" style="color:${chg>0?'var(--red)':'var(--accent)'}">${chg>0?'▲':'▼'} ${Math.abs(chg)}% vs ${MS[(d.pm+10)%12]}</div>`:''}</div>
      <div><div class="mr-l">Income</div><div class="mr-v" style="color:var(--accent)">${d.income?maskIf('review',fC(d.income)):'—'}</div></div>
      <div><div class="mr-l">${d.saved>=0?'Saved':'Overspent'}</div><div class="mr-v" style="color:${d.saved>=0?'var(--accent)':'var(--red)'}">${d.income?maskIf('review',fC(Math.abs(d.saved))):'—'}</div>${rate!=null&&d.saved>=0?`<div class="mr-s">${rate}% of income</div>`:''}</div>
    </div>
    <div class="mr-row"><span>Top spending</span><span>${d.top.map(([c,v])=>`${CAT_ICONS[c]||''} ${esc(c)} ${maskIf('review',fC(v))}`).join(' · ')}</span></div>
    ${d.biggest?`<div class="mr-row"><span>Biggest expense</span><span>${esc(d.biggest.payee||d.biggest.category||'')} ${maskIf('review',fC(txNGN(d.biggest)))} · ${fmtDate(d.biggest.date)}</span></div>`:''}
    ${d.budgeted?`<div class="mr-row"><span>Budget</span><span>${d.over.length?`Over in ${d.over.map(esc).join(', ')}`:'Every category within budget ✓'}</span></div>`:''}
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn btn-g btn-sm" style="flex:1" onclick="shareMonthReview()">Share</button>
      <button class="btn btn-g btn-sm" style="flex:1" onclick="reloadMonth(${d.pm},${d.py});navTo('expenses')">See ${name}</button>
    </div>
  </div>`;
}
function dismissMonthReview(){
  const d=_reviewData();if(d){try{localStorage.setItem(REVIEW_OFF_LS,`${d.py}-${d.pm}`);}catch{}}
  renderMonthReview();
}
async function shareMonthReview(){
  const d=_reviewData();if(!d)return;
  const name=`${MONTHS[d.pm-1]} ${d.py}`;
  const lines=[`My ${name} with SpendWise`,
    `Spent: ${fN(d.spent)}`+(d.prevSpent?` (${d.spent>d.prevSpent?'+':''}${Math.round((d.spent-d.prevSpent)/d.prevSpent*100)}% vs the month before)`:''),
    d.income?`Income: ${fN(d.income)}`:'',
    d.income?`${d.saved>=0?'Saved':'Overspent'}: ${fN(Math.abs(d.saved))}${d.saved>=0&&d.income?` (${Math.round(d.saved/d.income*100)}%)`:''}`:'',
    `Top spending: ${d.top.map(([c,v])=>`${c} ${fN(v)}`).join(', ')}`].filter(Boolean);
  const text=lines.join('\n');
  if(navigator.share){try{await navigator.share({title:`${name} in review`,text});}catch(e){/* dismissed */}return;}
  try{await navigator.clipboard.writeText(text);toast('Summary copied');}catch(e){toast('Could not share');}
}
function renderDashboard(){
  const m=S.dashMonth,y=S.dashYear,cur=S.dashCurrency;
  renderGetStarted();
  try{renderMonthReview();}catch(e){console.warn('month review failed',e);}
  _syncCurrencyPickers(cur);
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

  const spent=txns.reduce((s,t)=>s+txNGN(t),0);
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
  const _NW=netWorthFor(m,y);
  const cash=_NW.cashDoc;
  const _fxR=getFxRates(m,y);
  const _nwCfg=_NW.cfg;
  const _nwAccts=_NW.accts;
  // The Cash card lists every account, so its total does too; only the Net
  // Worth figure leaves out accounts unticked in Settings → Net Worth.
  const cashTotal=_NW.cashAll;
  const inv=_NW.invDoc;
  // Full portfolio total — ALL platforms, regardless of the Net Worth include
  // toggles. The Investments stat card always shows the complete figure (the
  // Net Worth number above is what honours the include config). Matches the
  // total shown by drillDown('investments').
  const invTotalAll=platformsFor(inv).reduce((s,p)=>s+invBalanceFor(p.key,m,y,inv),0);
  const debtNW=_NW.debt, loanNW=_NW.loans;   // loans are a liability — subtracted
  const nw=_NW.total;
  const _nwParts=[_nwCfg.includeInvestments!==false?'Investments':null,_nwAccts.length?'Cash':null,_nwCfg.includeDebtors!==false&&debtNW?'Debtors':null].filter(Boolean);
  document.getElementById('dash-nw').innerHTML=maskIf('nw',fmtCur(nw,cur,m,y)||'—');
  const _nwEye=document.getElementById('nw-eye');if(_nwEye)_nwEye.innerHTML=eyeBtn('nw','renderDashboard');
  document.getElementById('dash-nw-sub').innerHTML=`${_nwParts.join(' + ')}${loanNW?' − Loans':''} · ${MONTHS[m-1]} ${y}`+_getNWDeltaBadge(m,y);

  const st=bSt(spent,budgTotal);
  // MoM comparison — pull previous month from cache/history
  const prevM=m===1?12:m-1,prevY=m===1?y-1:y;
  const prevTxns=cGet(CK.txns(prevM,prevY))||[];
  const prevHist=getHistory().find(h=>h.year===prevY&&h.month===prevM);
  const prevSpent=prevTxns.length?prevTxns.reduce((s,t)=>s+txNGN(t),0):(prevHist?.expenses||0);
  const prevIncHist=cGet(CK.inc(prevM,prevY))||[];
  const prevIncAmt=prevIncHist.length?prevIncHist.reduce((s,i)=>s+txNGN(i),0):(prevHist?.income||0);
  const momBadge=(cur2,prev,invertGood)=>{
    if(!prev||prev===0) return '';
    const pct=Math.round((cur2-prev)/prev*100);
    if(pct===0) return '';
    const up=pct>0;const good=invertGood?!up:up;
    return`<span class="mom-badge ${good?'mom-dn':'mom-up'}">${up?'+':''}${pct}%</span>`;
  };
  // ── Safe-to-spend: remaining budget ÷ days left, shown only for the live month ──
  const _now=appNow();
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
  txns.forEach(t=>{catSpend[t.category]=(catSpend[t.category]||0)+txNGN(t);});

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
    (cGet(CK.txns(prevM,prevY))||[]).forEach(t=>{prevCatSpend[t.category]=(prevCatSpend[t.category]||0)+txNGN(t);});
    const catDiffs=Object.keys({...catSpend,...prevCatSpend}).map(c=>({c,d:(catSpend[c]||0)-(prevCatSpend[c]||0)}));
    catDiffs.sort((a,b)=>Math.abs(b.d)-Math.abs(a.d));
    const top=catDiffs[0];
    const driver=top&&Math.abs(top.d)>5000?`, driven by ${top.d>0?'a rise in':'a drop in'} <strong>${top.c}</strong>`:'';
    el.innerHTML=`Spending is <span style="color:${col};font-weight:600">${fmtCur(Math.abs(diff),cur,m,y)} (${pct}%) ${dir}</span> vs last month${driver}.`;
  })();

  // Expense chart
  renderCatChart(catSpend,cur,m,y);
  // Cash Flow is the first chart tab, so draw it whenever it's the one showing.
  if(document.getElementById('dash-tab-cashflow')?.style.display!=='none')renderCashFlowChart();

  // Spend vs budget
  const allCats=[...new Set([...getAllCats(),...Object.keys(catSpend)])];
  // Only show categories with actual spend; budgets still count in total for the Spent card
  const catRows=allCats.filter(c=>catSpend[c]>0).map(c=>({cat:c,spent:catSpend[c]||0,budg:S.budgets[ck(c)]||0})).sort((a,b)=>b.spent-a.spent);
  const _catRowHtml=r=>{
    const st=bSt(r.spent,r.budg);const pct=r.budg?Math.min(r.spent/r.budg*100,100):0;
    const icn=`<span style="margin-right:5px">${CAT_ICONS[r.cat]||''}</span>`;
    return`<div class="cr"><div class="cr-top"><span class="cr-name">${icn}${r.cat}</span><div class="cr-vals"><span class="cr-spent" style="color:${st==='over'?'var(--red)':st==='warn'?'var(--gold)':'var(--text)'}">${fmtCur(r.spent,cur,m,y)}</span>${r.budg?`<span class="cr-budg">/ ${fmtCur(r.budg,cur,m,y)}</span>`:''}</div></div><div class="prog"><div class="pf ${st}" style="width:${pct}%"></div></div></div>`;
  };
    document.getElementById('dash-cats').innerHTML=catRows.length?catRows.map(_catRowHtml).join(''):'<div class="empty"><div class="empty-i">↕</div>No expenses this month</div>';

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
  const dashInvTotal=platformsFor(inv).reduce((s,p)=>s+invBalanceFor(p.key,m,y,inv),0);
  document.getElementById('dash-inv-total').innerHTML=dashInvTotal?maskIf('dash-inv-list',fmtCur(dashInvTotal,cur==='NATIVE'?'NGN':cur,m,y)):'—';
  const invEyeEl=document.getElementById('dash-inv-eye');
  if(invEyeEl) invEyeEl.innerHTML=eyeBtn('dash-inv-list','renderDashboard');
  document.getElementById('dash-inv').innerHTML=platformsFor(inv).map(p=>{
    const val=invBalanceFor(p.key,m,y,inv);
    const pct=dashInvTotal>0?((val/dashInvTotal)*100).toFixed(1):'0.0';
    const dispVal=fmtPlatformVal(val,p.key,cur,m,y);
    const badge=`<span style="font-size:0.56rem;padding:1px 4px;border-radius:3px;background:var(--bg3);color:var(--text3);margin-left:4px">${p.currency}</span>`;
    return`<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="drillDownInvPlatform('${p.key}')"><div style="display:flex;align-items:center;gap:8px">${platformLogoEl(p.key,p.color,22)}<div><div style="font-size:0.78rem;font-weight:600">${p.label}${badge}</div><div style="font-size:0.62rem;color:var(--text2);font-family:var(--mono)">${pct}%</div></div></div><div style="font-family:var(--mono);font-size:0.84rem;color:${val?p.color:'var(--text3)'};">${val?maskIf('dash-inv-list',dispVal):'—'}</div></div>`;
  }).join('');
  const active=platformsFor(inv).filter(p=>invBalanceFor(p.key,m,y,inv)>0);
  document.getElementById('dash-abar').innerHTML=dashInvTotal&&active.length?active.map(p=>{const val=invBalanceFor(p.key,m,y,inv);return`<div style="flex:${val};background:${p.color};opacity:0.8"></div>`;}).join(''):'';

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

  // Recent transactions
  const recEl=document.getElementById('dash-recent');
  const combined=[...txns.map(t=>({...t,type:'exp'})),...incList.map(t=>({...t,type:'inc'}))].sort((a,b)=>a.date>b.date?-1:a.date<b.date?1:txnTs(b.createdAt)-txnTs(a.createdAt)).slice(0,5);
  if(!combined.length){recEl.innerHTML='<div class="empty"><div class="empty-i">↕</div>No transactions yet</div>';}
  else{recEl.innerHTML='<div class="txlist">'+combined.map(tx=>{
    const _lbl=tx.category?((CAT_ICONS[tx.category]||'')+' '+tx.category):esc(tx.payee)||'—';
    return`<div class="txi"><div><div class="txi-cat">${_lbl}</div><div class="txi-meta">${esc(tx.payee||tx.notes)||'—'} · ${fmtDate(tx.date)}</div></div><div class="${tx.type==='inc'?'txi-amt txi-inc':'txi-amt txi-exp'}">${tx.type==='inc'?'+':''}${fmtCur(txNGN(tx),cur,m,y)}${txFxNote(tx)}</div></div>`;
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
      const amt=`${isInc?'+':'−'}${fmtCur(txNGN(tx),cur,m,y)}${txFxNote(tx)}`;
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
  const todayStr=(()=>{const d=appNow();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');})();

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
    return`<div class="txi"><div><div class="txi-cat">${tx.category?(CAT_ICONS[tx.category]||'')+'\u00a0'+esc(tx.category):esc(tx.payee)||'—'}</div><div class="txi-meta">${esc(tx.payee||tx.notes)||'—'}</div></div><div class="${isInc?'txi-amt txi-inc':'txi-amt txi-exp'}">${isInc?'+':'−'}${fmtCur(txNGN(tx),cur,m,y)}${txFxNote(tx)}</div></div>`;
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

// Pull the first emoji grapheme out of arbitrary typed text, keeping ZWJ
// sequences (👨‍👩‍👧‍👦), skin-tone modifiers and variation selectors intact — so the
// whole emoji survives, not just its first code point. Lets the picker accept
// anything the user types from their device's emoji keyboard.
function _firstEmoji(str){
  str=(str||'').trim();
  if(!str) return '';
  try{
    if(typeof Intl!=='undefined'&&Intl.Segmenter){
      const seg=new Intl.Segmenter('en',{granularity:'grapheme'});
      for(const s of seg.segment(str)){
        // Extended_Pictographic covers most emoji; Regional_Indicator covers
        // country flags (🇳🇬), which are pairs and not pictographic themselves.
        if(/[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(s.segment)) return s.segment;
      }
      return '';
    }
  }catch(e){}
  const m=str.match(/\p{Regional_Indicator}\p{Regional_Indicator}|\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic}|[️\u{1f3fb}-\u{1f3ff}])*/u);
  return m?m[0]:'';
}

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

  // Full-keyboard entry: focusing this input lets the user open their device's
  // (or OS's) emoji keyboard and pick ANY emoji — not just the curated grid.
  const typeRow=document.createElement('div');
  typeRow.className='emoji-typerow';
  const emInput=document.createElement('input');
  emInput.className='emoji-search';
  emInput.placeholder='Type or pick any emoji 😀';
  emInput.setAttribute('autocomplete','off');
  emInput.setAttribute('autocapitalize','none');
  emInput.setAttribute('autocorrect','off');
  const useBtn=document.createElement('button');
  useBtn.className='emoji-use-btn';
  useBtn.textContent='Use';
  useBtn.disabled=true;
  const applyTyped=()=>{const em=_firstEmoji(emInput.value);if(em&&_emojiCb){_emojiCb(em);closeEmojiPicker();}};
  emInput.oninput=()=>{const em=_firstEmoji(emInput.value);useBtn.disabled=!em;useBtn.textContent=em?('Use '+em):'Use';};
  emInput.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();applyTyped();}};
  useBtn.onclick=applyTyped;
  typeRow.appendChild(emInput);
  typeRow.appendChild(useBtn);
  _emojiPanel.appendChild(typeRow);

  const groups=document.createElement('div');
  groups.className='emoji-groups';
  Object.keys(EMOJI_GROUPS).forEach((g,i)=>{
    const btn=document.createElement('button');
    btn.className='emoji-group-btn'+(i===0?' active':'');
    btn.textContent=g;
    btn.onclick=()=>{
      _emojiGroup=g;
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
  setTimeout(()=>emInput.focus(),50);
}

function _renderEmojiGrid(){
  const grid=document.getElementById('emoji-grid');
  if(!grid) return;
  const list=EMOJI_GROUPS[_emojiGroup]||ALL_EMOJIS;
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
      silent:false,
      // Where the SW's notificationclick handler should send the user. Path only
      // (no hash) so it matches/opens the app root cleanly.
      data:{url:location.origin+location.pathname}
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
      byCat[c].total+=txNGN(t);byCat[c].count++;
      if(d<=cutoff) byCat[c].early+=txNGN(t);
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
  const now=appNow();
  const m=now.getMonth()+1,y=now.getFullYear(),day=now.getDate();
  const daysInMonth=new Date(y,m,0).getDate(),daysLeft=daysInMonth-day;
  const mk=`${y}-${m}`;
  const txns=(S.expMonth===m&&S.expYear===y)?S.txns:(cGet(CK.txns(m,y))||[]);
  const B=(S.expMonth===m&&S.expYear===y)?S.budgets:budgetFor(m,y);
  const hist=_spendHistoryStats(m,y,day);
  const nMonths=hist.monthsScanned;
  const out={alerts:[],insights:[],catProj:{},totalProj:0,totalBudget:Object.values(B).reduce((s,v)=>s+(v||0),0),monthsUsed:nMonths};

  const catSpend={},catCount={};
  txns.forEach(t=>{if(!t||!t.amount)return;const c=t.category||'Other';catSpend[c]=(catSpend[c]||0)+txNGN(t);catCount[c]=(catCount[c]||0)+1;});

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
  const spentTotal=txns.reduce((s,t)=>s+txNGN(t),0);
  if(out.totalBudget>0&&spentTotal>0){
    const pct=Math.round(out.totalProj/out.totalBudget*100);
    const histNote=nMonths>=2
      ?`Based on ${nMonths} months of your history: routine categories are paced against how much of the month's spend usually lands by day ${day}; one-off categories are held at their typical monthly total instead of being multiplied per day.`
      :`Less than 2 months of history is cached on this device, so this is a simple pro-rata estimate — it gets smarter as history builds.`;
    if(pct>=110){
      out.alerts.push({type:'danger',icon:'🔴',key:`proj-total-${mk}`,
        title:`Heading over budget — projected ${fC(out.totalProj)}`,
        sub:`${fC(spentTotal)} spent by day ${day} · budget ${fC(out.totalBudget)} · ${daysLeft}d left`,
        why:histNote});
    }else if(pct>=90){
      out.alerts.push({type:'warn',icon:'⚠️',key:`proj-total-${mk}`,
        title:`Cutting it close — projected ${pct}% of budget`,
        sub:`Projected ${fC(out.totalProj)} vs ${fC(out.totalBudget)} · ${daysLeft}d left`,
        why:histNote});
    }else{
      out.insights.push({type:'good',icon:'✅',key:`proj-total-${mk}`,
        title:`On track — projected ${pct}% of budget`,
        sub:`Projected ${fC(out.totalProj)} vs ${fC(out.totalBudget)} · ${fC(Math.max(0,out.totalBudget-out.totalProj))} headroom`,
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
        sub:`${fC(p.spent)} spent vs ${fC(p.budget)} budget`,
        why:p.typTotal>0?`Your typical ${cat} month is ${fC(p.typTotal)}. With ${daysLeft} days left, expect roughly ${fC(Math.max(0,p.proj-p.spent))} more based on your usual pattern.`:`No history yet for ${cat} — the overage is measured against this month's budget only.`});
      return;
    }
    // Projected overspend — only when the method has something to stand on.
    if(p.budget>0&&p.proj>p.budget*1.1&&p.spent>0&&(p.method!=='linear'||day>=7)){
      const why=p.method==='episodic'
        ?`You've made ${p.count} ${cat} purchase${p.count===1?'':'s'} this month; historically you make ~${Math.round(p.typCount)}/month totalling ${fC(p.typTotal)}. This is NOT extrapolated daily — the projection assumes your normal purchase rhythm, and it still lands over budget.`
        :p.method==='paced'
        ?`By day ${day} you've usually spent ${Math.round(p.frac*100)}% of your monthly ${cat} total. Scaling this month's ${fC(p.spent)} by that curve projects ${fC(p.proj)} vs ${fC(p.budget)} budget.`
        :`Simple pro-rata (limited history for ${cat}): ${fC(p.spent)} over ${day} days extends to ${fC(p.proj)}.`;
      out.alerts.push({type:'warn',icon,key,
        title:`${cat} pacing over budget`,
        sub:`Projected ${fC(p.proj)} vs ${fC(p.budget)} (${Math.round(p.proj/p.budget*100)}%)`,
        why});
      return;
    }
    // Episodic anomaly — unusually heavy month vs typical, budget or not.
    if(p.method==='episodic'&&p.typTotal>0&&p.spent>p.typTotal*1.3&&(p.spent-p.typTotal)>Math.max(5000,p.typTotal*0.3)){
      out.alerts.push({type:'warn',icon,key:`anom-${ck(cat)}-${mk}`,
        title:`${cat} unusually high this month`,
        sub:`${fC(p.spent)} so far vs typical ${fC(p.typTotal)}/month`,
        why:`Over the last ${nMonths} months your median ${cat} month was ${fC(p.typTotal)} across ~${Math.round(p.typCount)} purchase${Math.round(p.typCount)===1?'':'s'}. This month is already ${Math.round((p.spent/p.typTotal-1)*100)}% above that — worth a look, though it may be a known one-off.`});
      return;
    }
    // Positive / contextual reads → Analytics insights only (no alert noise).
    if(p.method==='episodic'&&p.spent>0&&p.typTotal>0&&p.spent<=p.typTotal*1.15&&p.count<=Math.ceil(p.typCount)){
      out.insights.push({type:'info',icon,key,
        title:`${cat}: normal rhythm`,
        sub:`${p.count} purchase${p.count===1?'':'s'} (${fC(p.spent)}) · typical month: ~${Math.round(p.typCount)} totalling ${fC(p.typTotal)}`,
        why:`${cat} isn't a daily expense for you — history shows ~${Math.round(p.typCount)} purchase${Math.round(p.typCount)===1?'':'s'}/month. Expect roughly ${fC(Math.max(0,p.typTotal-p.spent))} more this month if the pattern holds.`});
    }else if(p.method==='paced'&&p.budget>0&&day>=10&&p.proj<=p.budget*0.85&&p.spent>0){
      out.insights.push({type:'good',icon,key,
        title:`${cat} running under budget`,
        sub:`Projected ${fC(p.proj)} vs ${fC(p.budget)} — about ${fC(p.budget-p.proj)} headroom`,
        why:`You've spent ${fC(p.spent)} by day ${day}; historically that's ${Math.round(p.frac*100)}% of the month done, so finishing near ${fC(p.proj)} would beat your ${fC(p.budget)} budget.`});
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
            why:`Historically ${cat} takes about ${Math.round(shareTyp*100)}% of your monthly spending; this month it's at ${Math.round(shareNow*100)}% (${fC(p.spent)} of ${fC(spentTotal)}).`});
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
  const now=appNow();
  const m=now.getMonth()+1,y=now.getFullYear();
  const isCurrentMonth=(S.dashMonth===m&&S.dashYear===y);

  // 1) Smart spend alerts (history-aware; only meaningful for current month)
  const alerts=isCurrentMonth?computeSmartInsights().alerts.slice():[];

  // 2) Upcoming recurring payments (due this month, not yet posted)
  const recurring=getRecurring().filter(r=>isDueThisMonth(r.nextRun)&&r.type==='expense'&&!r.auto);
  if(recurring.length){
    const total=recurring.reduce((s,r)=>s+(r.amount||0),0);
    alerts.push({
      type:'info',
      icon:'🔁',
      title:`${recurring.length} recurring payment${recurring.length>1?'s':''} due this month`,
      sub:recurring.map(r=>`${r.payee} (${fN(r.amount)})`).join(' · ')+(total?` · Total: ${fC(total)}`:''),
      link:{label:'Post now →',fn:"openRecurModal()"}
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
        const spent2=S.txns.reduce((s,t)=>s+txNGN(t),0);
        const savedAmt=incTotal-spent2;
        const actualPct=Math.round(savedAmt/incTotal*100);
        const targetAmt=Math.round(incTotal*targetPct/100);
        if(actualPct<targetPct*0.8){
          alerts.push({type:'warn',icon:'🎯',title:`Savings target: ${actualPct}% of ${targetPct}% goal`,sub:`Targeting ${fC(targetAmt)} saved · actual ${fC(Math.max(0,savedAmt))} · ${fC(Math.max(0,targetAmt-savedAmt))} short`});
        }
      }
    }
  }

  // 4) Overdue debtors (no activity > 60 days)
  const overdue=_getOverdueDebtors();
  if(overdue.length){
    alerts.push({type:'warn',icon:'⏰',title:`${overdue.length} debtor${overdue.length>1?'s':''} — no activity > 60 days`,sub:overdue.map(d=>d.name+' ('+fC(d.ngnBalance||0)+' due)').join(' · ')});
  }

  // Feed notification bell (always, even when el is hidden)
  updateNotifPanel(alerts);
  // Hide alert strip — alerts now live in the bell panel only
  el.innerHTML='';
}


// ── Net worth: one calculation for every screen (v4.7) ────────────────────
// Home, the Net Worth breakdown, the trend chart, the full-year view and the
// ▲/▼ badge used to compute it five different ways (some ignored
// sub-investments, debtors or loans, so they could disagree). All of them use
// this now, honouring Settings → Advanced → Net Worth.
// Debtors and loans aren't recorded per month, so today's figures are used
// for every month.
function _cashDocFor(m,y){
  if(m===S.cashMonth&&y===S.cashYear&&S.cash&&Object.keys(S.cash).length)return S.cash;
  return cGet(CK.cash(m,y))||((m===S.dashMonth&&y===S.dashYear)?S.cash:null)||{};
}
function _invDocFor(m,y){
  return cGet(CK.inv(m,y))||((m===S.dashMonth&&y===S.dashYear)?S.investments:null)||{};
}
function netWorthFor(m,y){
  const cfg=getNWConfig();
  const inv=_invDocFor(m,y),cash=_withAccrued(_cashDocFor(m,y),m,y),fx=getFxRates(m,y);
  const accts=cfg.cashAccounts||getCashAccounts();
  const _cv=b=>{const v=+cash[b]||0;return isUSDCashAccount(b)?v*(fx.USD||1600):v;};
  const cashT=accts.reduce((s,b)=>s+_cv(b),0);
  // Every account, whatever the Net Worth toggles say: the Cash card total.
  const cashAll=getCashAccounts().reduce((s,b)=>s+_cv(b),0);
  const plats=cfg.includeInvestments===false?[]:platformsFor(inv).filter(p=>{
    const fi=getInvPlatformMeta(p.key).assetClass==='fixed_income';
    return !(fi&&cfg.includeFixedIncome===false)&&!(!fi&&cfg.includeEquities===false);
  });
  const invT=plats.reduce((s,p)=>s+invBalanceFor(p.key,m,y,inv),0);
  const debt=cfg.includeDebtors!==false?nwDebtorsExpected():0;
  const loans=nwLoansOutstanding(cfg);
  // Removed platforms (e.g. USD Holdings, moved to Cash) still count in past
  // months' net worth, as cash. Not in the live month, and not in a month whose
  // cash already has a dollar balance, where it would be counted twice.
  let retired=0;
  if(!_invIsLiveMonth(m,y)&&!getCashAccounts().some(b=>isUSDCashAccount(b)&&+cash[b]>0))retired=_retiredInvValue(inv);
  const hasData=Object.keys(cash).some(k=>k!=='month'&&k!=='year'&&+cash[k])||plats.some(p=>invBalanceFor(p.key,m,y,inv));
  return {total:invT+cashT+retired+debt-loans,inv:invT,cash:cashT+retired,cashAll,retired,debt,loans,cfg,accts,plats,invDoc:inv,cashDoc:cash,hasData};
}
// Fetch every month's saved balances once per session (a few dozen small
// docs), so the trend chart and badges work on a device that has only ever
// opened the current month. That gap is why the Net Worth chart was empty.
let _balHistAt=0,_balHistP=null;
function ensureBalanceHistory(){
  if(!db||Date.now()-_balHistAt<6e5)return Promise.resolve(false);
  if(_balHistP)return _balHistP;
  _balHistP=(async()=>{
    try{
      const [cs,is]=await Promise.all([db.collection('cashBalances').get(),db.collection('investments').get()]);
      const n=appNow(),live=sid(n.getMonth()+1,n.getFullYear());
      cs.docs.forEach(d=>{if(!/^\d{4}-\d{2}$/.test(d.id)||d.id===live)return;const [y,m]=d.id.split('-').map(Number);cSet(CK.cash(m,y),d.data());});
      is.docs.forEach(d=>{if(!/^\d{4}-\d{2}$/.test(d.id)||d.id===live)return;const [y,m]=d.id.split('-').map(Number);cSet(CK.inv(m,y),d.data());});
      _balHistAt=Date.now();
      return true;
    }catch(e){_warnLoad('balance history',e);return false;}
    finally{_balHistP=null;}
  })();
  return _balHistP;
}
function _nwForMonth(m,y){return netWorthFor(m,y).total;}
function renderNWTrendChart(){
  const canvas=document.getElementById('nw-trend-chart');
  if(!canvas) return;
  const note=document.getElementById('nw-trend-note');
  // The last 12 months up to the month on screen that have any balances.
  const endY=S.dashMonth?S.dashYear:appNow().getFullYear(),endM=S.dashMonth||12;
  const pts=[];
  for(let i=11;i>=0;i--){
    let mm=endM-i,yy=endY;while(mm<1){mm+=12;yy--;}
    const nw=netWorthFor(mm,yy);
    if(nw.hasData)pts.push({label:_histLabel(mm,yy),nw:nw.total});
  }
  if(S.nwChart){S.nwChart.destroy();S.nwChart=null;}
  if(pts.length<2){
    canvas.style.display='none';
    if(note)note.textContent=db?'Loading your monthly balances…':'Net worth needs at least two months of balances.';
    if(db)ensureBalanceHistory().then(ok=>{if(ok)renderNWTrendChart();else if(note)note.textContent='Net worth needs at least two months of balances.';});
    return;
  }
  canvas.style.display='block';
  if(note)note.textContent='Cash + investments at the end of each month. Debtors and loans use today\'s figures.';
  const ctx=canvas.getContext('2d');
  const nwLabelPlugin={id:'nwLabels',afterDatasetsDraw(chart){
    const {ctx:c,data,scales:{x,y}}=chart;
    data.datasets[0].data.forEach((val,i)=>{
      if(!val) return;
      const xp=x.getPixelForValue(i);
      const yp=y.getPixelForValue(val);
      const lbl=(val/1e6).toFixed(2)+'M';
      c.save();c.font='bold 8px DM Mono, monospace';c.fillStyle=getComputedStyle(document.body).getPropertyValue('--accent').trim()||'#14b8a6';c.textAlign='center';
      c.fillText(lbl,xp,yp-9);
      c.restore();
    });
  }};
  const acc=getComputedStyle(document.body).getPropertyValue('--accent').trim()||'#14b8a6';
  const tick=getComputedStyle(document.body).getPropertyValue('--text3').trim()||'#7d8fa8';
  S.nwChart=new Chart(ctx,{type:'line',data:{labels:pts.map(p=>p.label),datasets:[{data:pts.map(p=>p.nw),borderColor:acc,backgroundColor:'rgba(20,184,166,0.08)',borderWidth:2,pointBackgroundColor:acc,pointRadius:4,tension:0.35,fill:true}]},options:{responsive:true,maintainAspectRatio:true,layout:{padding:{top:18}},plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmtChartNGN(c.parsed.y)}}},scales:{x:{grid:{display:false},ticks:{color:tick,font:{family:'DM Mono',size:9}},border:{display:false}},y:{display:false}}},plugins:[nwLabelPlugin]});
}

function renderDashFullYear(y,totalInc,totalExp,cur){
  const histYear=getHistory().filter(h=>h.year===y);
  const now=appNow();
  const currentYear=now.getFullYear();
  // Use Dec for completed years, current month for the ongoing year
  const refMonth=y<currentYear?12:(y===currentYear?now.getMonth()+1:12);
  // Pull NW from cached balances for the reference month
  const _RN=netWorthFor(refMonth,y);
  if(!_RN.hasData)ensureBalanceHistory().then(ok=>{if(ok&&S.dashMonth===0)renderDashboard();});
  const refInv=_RN.invDoc,refCash=_RN.cashDoc;
  const refInvTotal=platformsFor(refInv).reduce((s,p)=>s+invBalanceFor(p.key,refMonth,y,refInv),0);
  const refCashTotal=cashTotalNGN(refCash,refMonth,y);
  const refNW=_RN.total;
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
  const _ie=document.getElementById('dash-inc-exp');if(_ie)_ie.innerHTML=histYear.map(h=>`<div class="inc-row"><span class="pjlabel">${h.label}</span><div style="text-align:right"><div style="font-size:0.72rem;font-family:var(--mono);color:var(--accent)">${fmtCur(h.income,cur,h.month,y)}</div><div style="font-size:0.68rem;font-family:var(--mono);color:var(--red)">${fmtCur(h.expenses,cur,h.month,y)}</div></div></div>`).join('');
  const _cb=document.getElementById('dash-cash-badge');
  if(_cb)_cb.textContent=refCashTotal?fmtCur(refCashTotal,cur,refMonth,y):'—';
  const _cbody=document.getElementById('dash-cash-body');
  if(_cbody)_cbody.innerHTML=getCashAccounts().map(b=>{const v=refCash[b]||0;if(!v)return'';const disp=isUSDCashAccount(b)?'$'+v.toFixed(2):fmtCur(v,cur,refMonth,y);return`<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border)"><span style="font-size:0.72rem">${b}</span><span style="font-family:var(--mono);font-size:0.76rem;color:var(--blue)">${disp}</span></div>`;}).join('')||'<div class="csub">No cash data</div>';
  document.getElementById('dash-inv-total').textContent=refInvTotal?fmtCur(refInvTotal,cur==='NATIVE'?'NGN':cur,refMonth,y):'—';
  document.getElementById('dash-inv').innerHTML=platformsFor(refInv).filter(p=>invBalanceFor(p.key,refMonth,y,refInv)).map(p=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border)"><span style="font-size:0.72rem">${esc(p.label)}</span><span style="font-family:var(--mono);font-size:0.76rem;color:${p.color}">${fmtCur(invBalanceFor(p.key,refMonth,y,refInv),cur==='NATIVE'?'NGN':cur,refMonth,y)}</span></div>`).join('')||'<div class="csub">No investment data</div>';
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
  const catSpend={};S.txns.forEach(t=>{catSpend[t.category]=(catSpend[t.category]||0)+txNGN(t);});
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
  const isExp=tab==='expenses',isInc=tab==='income',isSp=tab==='special';
  document.getElementById('exp-pane').style.display=isExp?'block':'none';
  document.getElementById('inc-pane').style.display=isInc?'block':'none';
  const sp=document.getElementById('special-pane');if(sp)sp.style.display=isSp?'block':'none';
  document.getElementById('exp-page-title').textContent=isExp?'Expenses':isInc?'Income':'Special Budget';
  // The month strip and the global NGN/USD/GBP selector only apply to
  // Expenses/Income — Special Budget carries its own per-budget currency.
  const mrow=document.getElementById('exp-months');if(mrow)mrow.style.display=isSp?'none':'';
  const csel=document.getElementById('exp-currency');if(csel)csel.style.display=isSp?'none':'';
  document.querySelectorAll('#exp-tab-btn,#inc-tab-btn,#special-tab-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  if(isInc) renderIncome();
  else if(isSp) renderSpecial();
  else renderExpenses();
}

// ─── SPECIAL BUDGET ─────────────────────────────────────────────────────────
// Standalone, currency-switchable budgets for one-off things — a trip, an event.
// Each budget is one Firestore doc in `specialBudgets`; the budget list, the
// single-budget editor and the side-by-side comparison are three views of the
// same #special-pane. Unit costs are stored in the budget's base currency
// (default NGN); switching the display currency just re-divides by a user-typed
// FX rate (exactly like the old spreadsheet's "change cell C7"). The maths:
//   line total   = qty × cost/unit
//   subtotal     = Σ line totals
//   contingency  = subtotal × contingency%
//   total        = subtotal + contingency ; per-head = total ÷ travelers
var SB_LS='sw3_special_budgets';
var _sbMode='list';        // 'list' | 'detail' | 'compare'
var _sbActiveId='';        // id of the budget open in the editor
var _sbDraft=null;         // working copy being edited — nothing persists until Save
var _sbIsNew=false;        // draft is a brand-new budget not yet in the list/Firestore
var _sbDirty=false;        // draft has unsaved edits (drives the Save button)
var _sbOptItem='';         // line-item id whose cost-options editor is expanded
var _sbCur='';             // display currency ('' → the budget's own base)
var _sbCompareSel=[];      // budget ids ticked in the compare view
const SB_CURS=['NGN','USD','GBP'];

function _sbList(){if(!Array.isArray(S.specialBudgets))S.specialBudgets=cGet(SB_LS)||[];return S.specialBudgets;}
function _sbById(id){return _sbList().find(b=>b.id===id)||null;}
function _sbNewId(){return 'sb'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);}
function _sbSortList(a){a.sort((x,y)=>(y.updatedAt||0)-(x.updatedAt||0));return a;}
function _sbSaveCache(){cSet(SB_LS,_sbList());}
// Mirror one budget to Firestore so it follows the user across every device.
function _sbSave(b){
  if(!b)return;
  b.updatedAt=Date.now();
  _sbSortList(_sbList());
  _sbSaveCache();
  if(db)db.collection('specialBudgets').doc(b.id).set({
    title:b.title||'',type:b.type||'travel',base:b.base||'NGN',fx:b.fx||{},
    travelers:_sbNum(b.travelers),nights:_sbNum(b.nights),departure:b.departure||'',
    contingencyPct:_sbNum(b.contingencyPct),items:b.items||[],
    createdAt:b.createdAt||Date.now(),updatedAt:b.updatedAt
  },{merge:true}).catch(e=>console.warn('special budget sync failed',e));
}

// ── Money maths (all in base currency; converted only for display) ──
function _sbNum(v){const n=parseFloat(typeof _evalExpr==='function'?_evalExpr(v):String(v==null?'':v).replace(/[, ]/g,''));return isFinite(n)?n:0;}
function _sbItemTotal(it){return _sbNum(it.qty)*_sbNum(it.unit);}
function _sbSubtotal(b){return (b.items||[]).reduce((s,it)=>s+_sbItemTotal(it),0);}
function _sbContingency(b){return _sbSubtotal(b)*(_sbNum(b.contingencyPct)/100);}
function _sbTotal(b){return _sbSubtotal(b)+_sbContingency(b);}
function _sbPerHead(b){const t=_sbNum(b.travelers);return t>0?_sbTotal(b)/t:_sbTotal(b);}
function _sbDispCur(b){return _sbCur||b.base||'NGN';}
function _sbSym(c){return c==='USD'?'$':c==='GBP'?'£':c==='NGN'?'₦':c+' ';}
// fx[c] = how many units of base equal 1 unit of currency c, so base→c divides;
// the base currency itself always has an implicit factor of 1.
function _sbConv(amtBase,b,cur){const base=b.base||'NGN';if(cur===base)return amtBase;const r=_sbNum((b.fx||{})[cur]);return r>0?amtBase/r:amtBase;}
function _sbFmt(amtBase,b,cur){cur=cur||_sbDispCur(b);return _sbSym(cur)+Math.round(_sbConv(amtBase,b,cur)).toLocaleString('en-US');}
// Arrival = departure + nights (checkout convention). Built and read entirely in
// UTC so a positive local offset (e.g. WAT, UTC+1) can't roll the date back a day.
function _sbArrival(b){if(!b.departure)return'';const p=b.departure.slice(0,10).split('-').map(Number);if(p.length<3||!p[0])return'';const d=new Date(Date.UTC(p[0],p[1]-1,p[2]+_sbNum(b.nights)));return isNaN(d.getTime())?'':d.toISOString().slice(0,10);}

// A line item's "basis" is a convenience that fills its qty from the trip
// parameters (× travelers / × nights). Editing qty directly switches it to
// 'custom' so a manual override (e.g. 11 days of transport for a 9-night trip)
// is never silently overwritten when travelers or nights later change.
function _sbApplyBasis(b,it){
  if(it.basis==='traveler')it.qty=_sbNum(b.travelers)||1;
  else if(it.basis==='night'||it.basis==='day')it.qty=_sbNum(b.nights)||1;
  else if(it.basis==='flat')it.qty=1;
  // 'custom' → leave qty untouched
}
function _sbSyncQtys(b){(b.items||[]).forEach(it=>_sbApplyBasis(b,it));}
function _sbTravelItems(){
  const mk=(name,basis)=>({id:_sbNewId(),name,basis,qty:1,unit:0,status:'outstanding'});
  return [mk('Flight','traveler'),mk('Hotel','night'),mk('Visa','traveler'),
    mk('Feeding','day'),mk('Local transport','day'),mk('Touring','traveler'),mk('Shopping','traveler')];
}

// ── Loading + realtime (wired into syncAll / start-stopRealtimeListeners) ──
async function loadSpecialBudgets(){
  if(!db)return;
  try{
    const snap=await db.collection('specialBudgets').get();
    const list=snap.docs.map(d=>({id:d.id,...d.data()}));
    _sbSortList(list);
    S.specialBudgets=list;cSet(SB_LS,list);
  }catch(e){_warnLoad('loadSpecialBudgets',e);}
}

// ── Draft model ────────────────────────────────────────────────────────────
// Editing never touches Firestore. All edits mutate the in-memory _sbDraft;
// only Save (sbSave → _sbCommit) writes it to the list + Firestore. This is
// what makes the explicit Save button meaningful — leaving without saving
// discards the changes.
function _sbCommit(){
  const b=_sbDraft;if(!b)return;
  b.updatedAt=Date.now();
  const l=_sbList();const i=l.findIndex(x=>x.id===b.id);
  if(i>=0)l[i]=b;else l.unshift(b);
  _sbIsNew=false;_sbDirty=false;
  _sbSave(b);                 // sorts, caches, mirrors to Firestore
}
function sbSave(){
  if(!_sbDraft||!_sbDirty)return;
  _sbCommit();renderSpecial();toast('Saved to all your devices');
}
function _sbFindItem(itemId){return _sbDraft?(_sbDraft.items||[]).find(x=>x.id===itemId):null;}

// ── Create / duplicate / delete ──
function sbNewBudget(type){
  type=type||'travel';
  const b={id:_sbNewId(),title:type==='travel'?'New trip':'New budget',type,
    base:'NGN',fx:{USD:DEF_RATES.USD,GBP:DEF_RATES.GBP},
    travelers:type==='travel'?2:1,nights:type==='travel'?7:0,
    departure:type==='travel'?appNow().toISOString().slice(0,10):'',
    contingencyPct:5,items:type==='travel'?_sbTravelItems():[],
    createdAt:Date.now(),updatedAt:Date.now()};
  _sbSyncQtys(b);
  _sbDraft=b;_sbActiveId=b.id;_sbIsNew=true;_sbDirty=true;_sbOptItem='';
  _sbCur='';_sbMode='detail';renderSpecial();
}
function sbDuplicate(){
  if(!_sbDraft)return;
  _sbCommit();                 // persist the current budget so it isn't lost
  const src=_sbDraft;
  const copy=JSON.parse(JSON.stringify(src));
  copy.id=_sbNewId();
  copy.items=(copy.items||[]).map(it=>({...it,id:_sbNewId(),
    options:(it.options||[]).map(o=>({...o,id:_sbNewId()}))}));
  copy.title=(src.title||'Budget')+' (copy)';
  copy.createdAt=Date.now();copy.updatedAt=Date.now();
  _sbDraft=copy;_sbActiveId=copy.id;_sbIsNew=true;_sbDirty=true;_sbOptItem='';
  renderSpecial();
  toast('Copy created — tweak it, then Save. Compare from the list.');
}
function sbDelete(){
  const b=_sbDraft;if(!b)return;
  if(_sbIsNew){
    if(!confirm('Discard this unsaved budget?'))return;
  }else{
    if(!confirm('Delete “'+(b.title||'this budget')+'” on all your devices?'))return;
    const l=_sbList();const i=l.findIndex(x=>x.id===b.id);if(i>=0)l.splice(i,1);
    _sbSaveCache();
    if(db)db.collection('specialBudgets').doc(b.id).delete().catch(e=>console.warn('special budget delete failed',e));
    _sbCompareSel=_sbCompareSel.filter(x=>x!==b.id);
  }
  _sbDraft=null;_sbIsNew=false;_sbDirty=false;_sbMode='list';_sbActiveId='';renderSpecial();
}

// ── Field / item edits (all mutate the draft; Save persists) ──
function sbRename(){
  const b=_sbDraft;if(!b)return;
  const v=prompt('Budget name',b.title||'');if(v===null)return;
  const t=String(v).trim().replace(/\s+/g,' ');if(!t)return;
  b.title=t.length>60?t.slice(0,60)+'…':t;_sbDirty=true;renderSpecial();
}
function sbEditField(field,val){
  const b=_sbDraft;if(!b)return;
  if(field==='travelers'||field==='nights')b[field]=Math.max(0,Math.round(_sbNum(val)));
  else if(field==='contingencyPct')b.contingencyPct=Math.max(0,_sbNum(val));
  else if(field==='fxUSD'){b.fx=b.fx||{};b.fx.USD=_sbNum(val);}
  else if(field==='fxGBP'){b.fx=b.fx||{};b.fx.GBP=_sbNum(val);}
  else b[field]=val;
  if(field==='travelers'||field==='nights')_sbSyncQtys(b);
  _sbDirty=true;renderSpecial();
}
function sbEditItem(itemId,field,val){
  const b=_sbDraft;if(!b)return;
  const it=(b.items||[]).find(x=>x.id===itemId);if(!it)return;
  if(field==='qty'){it.qty=_sbNum(val);it.basis='custom';}  // manual override
  else if(field==='unit')it.unit=_sbNum(val);
  else it[field]=val;                                       // name, status
  _sbDirty=true;renderSpecial();
}
function sbSetBasis(itemId,basis){
  const b=_sbDraft;if(!b)return;
  const it=(b.items||[]).find(x=>x.id===itemId);if(!it)return;
  it.basis=basis;_sbApplyBasis(b,it);_sbDirty=true;renderSpecial();
}
function sbAddItem(){
  const b=_sbDraft;if(!b)return;
  (b.items=b.items||[]).push({id:_sbNewId(),name:'New item',basis:'flat',qty:1,unit:0,status:'outstanding',options:[]});
  _sbDirty=true;renderSpecial();
}
function sbDelItem(itemId){
  const b=_sbDraft;if(!b)return;
  b.items=(b.items||[]).filter(x=>x.id!==itemId);
  if(_sbOptItem===itemId)_sbOptItem='';
  _sbDirty=true;renderSpecial();
}

// ── Line-item cost options (e.g. compare airlines / hotels in place) ──
// An item can carry a list of named options {id,label,unit}; the picked one
// (it.optId) drives it.unit, so selecting a different option instantly re-totals
// the whole budget without leaving the editor.
function sbToggleOpts(itemId){_sbOptItem=_sbOptItem===itemId?'':itemId;renderSpecial();}
function sbAddOption(itemId){
  const it=_sbFindItem(itemId);if(!it)return;
  it.options=it.options||[];
  const o={id:_sbNewId(),label:'Option '+(it.options.length+1),unit:_sbNum(it.unit)};
  it.options.push(o);
  if(!it.optId){it.optId=o.id;it.unit=_sbNum(o.unit);}
  _sbOptItem=itemId;_sbDirty=true;renderSpecial();
}
function sbEditOption(itemId,optId,field,val){
  const it=_sbFindItem(itemId);if(!it)return;
  const o=(it.options||[]).find(x=>x.id===optId);if(!o)return;
  if(field==='unit'){o.unit=_sbNum(val);if(it.optId===optId)it.unit=_sbNum(val);}
  else o.label=val;
  _sbDirty=true;renderSpecial();
}
function sbSelectOption(itemId,optId){
  const it=_sbFindItem(itemId);if(!it)return;
  const o=(it.options||[]).find(x=>x.id===optId);if(!o)return;
  it.optId=optId;it.unit=_sbNum(o.unit);_sbDirty=true;renderSpecial();
}
function sbDelOption(itemId,optId){
  const it=_sbFindItem(itemId);if(!it)return;
  it.options=(it.options||[]).filter(x=>x.id!==optId);
  if(it.optId===optId){
    if(it.options.length){it.optId=it.options[0].id;it.unit=_sbNum(it.options[0].unit);}
    else it.optId='';
  }
  _sbDirty=true;renderSpecial();
}

// ── Navigation ──
function sbOpen(id){
  const src=_sbById(id);if(!src)return;
  _sbDraft=JSON.parse(JSON.stringify(src));
  _sbActiveId=id;_sbIsNew=false;_sbDirty=false;_sbOptItem='';_sbCur='';_sbMode='detail';renderSpecial();
}
function sbBack(){
  if(_sbDirty&&!confirm('Discard unsaved changes?'))return;
  _sbDraft=null;_sbIsNew=false;_sbDirty=false;_sbMode='list';_sbActiveId='';renderSpecial();
}
function sbSetCur(c){_sbCur=c;renderSpecial();}   // display-only; not a saved edit
function sbEnterCompare(){_sbMode='compare';renderSpecial();}
function sbExitCompare(){_sbMode='list';renderSpecial();}
function sbToggleCompare(id){const i=_sbCompareSel.indexOf(id);if(i>=0)_sbCompareSel.splice(i,1);else _sbCompareSel.push(id);renderSpecial();}

// ── Render ──
function renderSpecial(){
  const el=document.getElementById('special-pane');if(!el)return;
  if(_sbMode==='detail'){if(_sbDraft){el.innerHTML=_sbDetailHTML(_sbDraft);return;}_sbMode='list';}
  if(_sbMode==='compare'){el.innerHTML=_sbCompareHTML();return;}
  el.innerHTML=_sbListHTML();
}
function _sbListHTML(){
  const l=_sbList();
  const cards=l.map(b=>{
    const sub=b.type==='travel'
      ?`${_sbNum(b.travelers)} traveller(s) · ${_sbNum(b.nights)} night(s)${b.departure?' · '+fmtDate(b.departure):''}`
      :`${(b.items||[]).length} item(s)`;
    return `<div class="exp-card" style="margin-bottom:10px;cursor:pointer" onclick="sbOpen('${b.id}')">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="min-width:0">
          <div class="exp-card-title" style="margin-bottom:2px">${esc(b.title||'Untitled budget')}</div>
          <div style="font-size:0.64rem;color:var(--text3)">${b.type==='travel'?'✈ Travel':'★ Event'} · ${esc(sub)}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:0.6rem;color:var(--text3)">Total (${b.base||'NGN'})</div>
          <div style="font-weight:700;font-size:0.9rem;color:var(--accent)">${_sbFmt(_sbTotal(b),b,b.base||'NGN')}</div>
        </div>
      </div>
    </div>`;
  }).join('');
  const empty=`<div class="empty" style="padding:26px 0"><div class="empty-i">✈</div>No special budgets yet.<br>Create one for a trip or an event.</div>`;
  return `<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
      <button class="btn btn-p btn-sm" onclick="sbNewBudget('travel')">＋ Travel budget</button>
      <button class="btn btn-g btn-sm" onclick="sbNewBudget('event')">＋ Event budget</button>
      ${l.length>1?`<button class="btn btn-g btn-sm" onclick="sbEnterCompare()" style="margin-left:auto">⇄ Compare</button>`:''}
    </div>
    ${l.length?cards:empty}`;
}
function _sbTotRow(label,val,strong){
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;${strong?'border-top:1px solid var(--line,rgba(128,128,128,.25));margin-top:4px;padding-top:8px':''}">
    <div style="font-size:${strong?'0.8rem':'0.72rem'};color:${strong?'var(--text)':'var(--text2)'};font-weight:${strong?'700':'400'}">${label}</div>
    <div style="font-weight:${strong?'800':'600'};font-size:${strong?'1rem':'0.8rem'};color:${strong?'var(--accent)':'var(--text)'}">${val}</div>
  </div>`;
}
function _sbDetailHTML(b){
  const cur=_sbDispCur(b),base=b.base||'NGN',isTravel=b.type==='travel';
  const curBtns=SB_CURS.map(c=>`<button class="btn btn-sm ${c===cur?'btn-p':'btn-g'}" style="padding:4px 10px;font-size:0.62rem" onclick="sbSetCur('${c}')">${_sbSym(c)} ${c}</button>`).join('');
  const fxRows=SB_CURS.filter(c=>c!==base).map(c=>
    `<div class="ig" style="flex:1;min-width:120px"><label class="ilabel">1 ${c} = ${_sbSym(base)}</label><input class="ifield" inputmode="decimal" value="${_sbNum((b.fx||{})[c])||''}" onchange="sbEditField('fx${c}',this.value)"></div>`).join('');
  const basisOpts=sel=>['flat','traveler','night','day','custom'].map(x=>`<option value="${x}"${x===(sel||'custom')?' selected':''}>${x==='flat'?'Flat':x==='traveler'?'× travellers':x==='night'?'× nights':x==='day'?'× days':'Custom'}</option>`).join('');
  const travOpts=Array.from({length:20},(_,i)=>i+1).map(n=>`<option value="${n}"${n===_sbNum(b.travelers)?' selected':''}>${n}</option>`).join('');
  const nightOpts=Array.from({length:61},(_,i)=>i).map(n=>`<option value="${n}"${n===_sbNum(b.nights)?' selected':''}>${n}</option>`).join('');
  const rows=(b.items||[]).map(it=>{
    const paid=it.status==='paid';
    const hasOpts=Array.isArray(it.options)&&it.options.length>0;
    const optsOpen=_sbOptItem===it.id;
    // Active-option picker (shown inline when the item carries saved options)
    const optSel=hasOpts?`<div class="ig" style="flex:1;min-width:120px"><label class="ilabel">Option</label>
        <select class="sfield" onchange="sbSelectOption('${it.id}',this.value)">
          ${it.options.map(o=>`<option value="${o.id}"${o.id===it.optId?' selected':''}>${esc(o.label||'Option')} — ${_sbFmt(_sbNum(o.unit),b,cur)}</option>`).join('')}
        </select></div>`:'';
    // When options exist their picker drives the cost, so lock the free-text cost
    const unitField=hasOpts
      ? `<div class="ig" style="flex:2;min-width:96px"><label class="ilabel">Cost/unit (${base})</label><input class="ifield" value="${_sbNum(it.unit)}" disabled title="Set by the selected option"></div>`
      : `<div class="ig" style="flex:2;min-width:96px"><label class="ilabel">Cost/unit (${base})</label><input class="ifield" inputmode="decimal" value="${_sbNum(it.unit)}" onchange="sbEditItem('${it.id}','unit',this.value)"></div>`;
    // Expandable editor for adding/renaming/pricing options
    const optEditor=optsOpen?`<div style="margin-top:8px;padding:8px;border:1px dashed var(--border);border-radius:var(--rsm)">
        <div class="ilabel" style="margin-bottom:6px">Options — different airlines / hotels, etc.</div>
        ${(it.options||[]).map(o=>`<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
            <input class="ifield" style="flex:2;min-width:80px" value="${esc(o.label||'')}" placeholder="e.g. Emirates" onchange="sbEditOption('${it.id}','${o.id}','label',this.value)">
            <input class="ifield" style="flex:1;min-width:70px" inputmode="decimal" value="${_sbNum(o.unit)}" onchange="sbEditOption('${it.id}','${o.id}','unit',this.value)">
            <button class="btn btn-sm ${o.id===it.optId?'btn-p':'btn-g'}" style="padding:4px 8px;font-size:0.58rem" onclick="sbSelectOption('${it.id}','${o.id}')" title="Use this option">${o.id===it.optId?'✓':'Use'}</button>
            <button class="btn btn-g btn-sm" style="padding:4px 7px" onclick="sbDelOption('${it.id}','${o.id}')" title="Remove option">✕</button>
          </div>`).join('')||'<div class="csub" style="margin-bottom:6px">No options yet.</div>'}
        <button class="btn btn-g btn-sm btn-full" style="font-size:0.62rem" onclick="sbAddOption('${it.id}')">＋ Add option</button>
      </div>`:'';
    return `<div class="exp-card" style="margin-bottom:8px;padding:10px">
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
        <input class="ifield" style="flex:1;font-weight:600;font-size:0.74rem" value="${esc(it.name||'')}" onchange="sbEditItem('${it.id}','name',this.value)">
        <button class="btn btn-sm ${optsOpen?'btn-p':'btn-g'}" style="padding:4px 8px;font-size:0.58rem" onclick="sbToggleOpts('${it.id}')" title="Saved cost options">⚙${hasOpts?' '+it.options.length:''}</button>
        <button class="btn btn-g btn-sm" style="padding:4px 8px" onclick="sbDelItem('${it.id}')" title="Remove item">🗑</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-end">
        <div class="ig" style="flex:1;min-width:60px"><label class="ilabel">Qty</label><input class="ifield" inputmode="decimal" value="${_sbNum(it.qty)}" onchange="sbEditItem('${it.id}','qty',this.value)"></div>
        ${unitField}
        <div class="ig" style="flex:1;min-width:82px"><label class="ilabel">Basis</label><select class="sfield" onchange="sbSetBasis('${it.id}',this.value)">${basisOpts(it.basis)}</select></div>
        ${optSel}
      </div>
      ${optEditor}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
        <button class="btn btn-sm ${paid?'btn-p':'btn-g'}" style="padding:3px 9px;font-size:0.6rem" onclick="sbEditItem('${it.id}','status','${paid?'outstanding':'paid'}')">${paid?'✓ Paid':'Outstanding'}</button>
        <div style="font-weight:700;font-size:0.82rem">${_sbFmt(_sbItemTotal(it),b,cur)}</div>
      </div>
    </div>`;
  }).join('');
  const sub=_sbSubtotal(b),cont=_sbContingency(b),tot=_sbTotal(b);
  const paidSum=(b.items||[]).filter(it=>it.status==='paid').reduce((s,it)=>s+_sbItemTotal(it),0);
  const outstanding=tot-paidSum;
  const saveLbl=_sbIsNew?'Save':(_sbDirty?'Save changes':'Saved ✓');
  return `<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
      <button class="btn btn-g btn-sm" style="padding:5px 10px" onclick="sbBack()">← All budgets</button>
      <div style="flex:1"></div>
      <button class="btn btn-g btn-sm" style="padding:5px 9px" onclick="sbDuplicate()" title="Duplicate to compare scenarios">⧉ Duplicate</button>
      <button class="btn ${_sbDirty?'btn-p':'btn-g'} btn-sm" style="padding:5px 14px" onclick="sbSave()" ${_sbDirty?'':'disabled'}>${saveLbl}</button>
    </div>
    ${_sbDirty?'<div class="csub" style="margin:-4px 0 8px;color:var(--accent)">Unsaved changes — tap Save to sync across your devices.</div>':''}
    <div class="exp-card" style="margin-bottom:10px">
      <div class="exp-card-title" style="margin:0 0 8px;cursor:pointer" onclick="sbRename()" title="Tap to rename">${esc(b.title||'Untitled')} <span style="font-size:0.6rem;color:var(--text3)">✎</span></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${curBtns}</div>
      ${isTravel?`<div style="display:flex;gap:6px;flex-wrap:wrap">
        <div class="ig" style="flex:1;min-width:70px"><label class="ilabel">Travellers</label><select class="sfield" onchange="sbEditField('travelers',this.value)">${travOpts}</select></div>
        <div class="ig" style="flex:1;min-width:70px"><label class="ilabel">Nights</label><select class="sfield" onchange="sbEditField('nights',this.value)">${nightOpts}</select></div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
        <div class="ig" style="flex:1;min-width:120px"><label class="ilabel">Departure</label><input class="ifield" type="date" value="${b.departure||''}" onchange="sbEditField('departure',this.value)"></div>
        <div class="ig" style="flex:1;min-width:120px"><label class="ilabel">Arrival (auto)</label><input class="ifield" type="date" value="${_sbArrival(b)}" disabled></div>
      </div>`:''}
      ${fxRows?`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">${fxRows}</div><div class="csub" style="margin-top:4px;font-size:0.58rem">Rates convert the display only — costs are stored in ${base}.</div>`:''}
    </div>

    <div class="clabel" style="margin:2px 0 8px">Line items</div>
    ${rows||'<div class="csub" style="margin-bottom:8px">No items yet — add your first below.</div>'}
    <button class="btn btn-g btn-full btn-sm" style="margin-bottom:12px" onclick="sbAddItem()">＋ Add line item</button>

    <div class="exp-card" style="margin-bottom:10px">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <div class="ig" style="flex:1"><label class="ilabel">Contingency %</label><input class="ifield" inputmode="decimal" value="${_sbNum(b.contingencyPct)}" onchange="sbEditField('contingencyPct',this.value)"></div>
        <div style="flex:1;text-align:right"><div style="font-size:0.6rem;color:var(--text3)">Contingency</div><div style="font-weight:600">${_sbFmt(cont,b,cur)}</div></div>
      </div>
      ${_sbTotRow('Subtotal',_sbFmt(sub,b,cur))}
      ${_sbTotRow('Outstanding',_sbFmt(outstanding,b,cur))}
      ${_sbTotRow('Total',_sbFmt(tot,b,cur),true)}
      ${isTravel?_sbTotRow('Per traveller',_sbFmt(_sbPerHead(b),b,cur)):''}
    </div>
    <button class="btn ${_sbDirty?'btn-p':'btn-g'} btn-full" style="margin-bottom:10px" onclick="sbSave()" ${_sbDirty?'':'disabled'}>${saveLbl}</button>
    <button class="btn btn-g btn-full btn-sm" style="margin-bottom:20px" onclick="sbDelete()">${_sbIsNew?'Discard':'Delete this budget'}</button>`;
}
function _sbCompareHTML(){
  const l=_sbList();
  const sel=_sbCompareSel.filter(id=>_sbById(id));
  const picker=l.map(b=>`<label style="display:flex;align-items:center;gap:8px;font-size:0.72rem;padding:5px 0;cursor:pointer">
      <input type="checkbox" ${sel.includes(b.id)?'checked':''} onchange="sbToggleCompare('${b.id}')"> ${esc(b.title||'Untitled')}
      <span style="margin-left:auto;color:var(--text3);font-size:0.62rem">${_sbFmt(_sbTotal(b),b,b.base||'NGN')}</span>
    </label>`).join('');
  let table;
  if(sel.length>=1){
    const budgets=sel.map(id=>_sbById(id));
    const cur=budgets[0].base||'NGN';
    const names=[];budgets.forEach(b=>(b.items||[]).forEach(it=>{if(it.name&&!names.includes(it.name))names.push(it.name);}));
    const head=`<th style="text-align:left">Item</th>`+budgets.map(b=>`<th style="text-align:right">${esc(b.title||'—')}</th>`).join('');
    const bodyRows=names.map(nm=>{
      const cells=budgets.map(b=>{const it=(b.items||[]).find(x=>x.name===nm);return `<td style="text-align:right">${it?_sbFmt(_sbItemTotal(it),b,cur):'—'}</td>`;}).join('');
      return `<tr><td>${esc(nm)}</td>${cells}</tr>`;
    }).join('');
    const contRow=`<tr><td>Contingency</td>${budgets.map(b=>`<td style="text-align:right">${_sbFmt(_sbContingency(b),b,cur)}</td>`).join('')}</tr>`;
    const totRow=`<tr class="sb-cmp-tot"><td>Total</td>${budgets.map(b=>`<td style="text-align:right">${_sbFmt(_sbTotal(b),b,cur)}</td>`).join('')}</tr>`;
    const phRow=`<tr style="font-weight:600"><td>Per traveller</td>${budgets.map(b=>`<td style="text-align:right">${_sbFmt(_sbPerHead(b),b,cur)}</td>`).join('')}</tr>`;
    table=`<div style="overflow-x:auto;margin-top:12px"><table class="sb-cmp"><thead><tr>${head}</tr></thead><tbody>${bodyRows}${contRow}${totRow}${phRow}</tbody></table></div>
      <div class="csub" style="margin-top:6px">All figures in ${cur}, each budget converted with its own FX rates.</div>`;
  }else{
    table=`<div class="csub" style="margin-top:12px">Tick budgets above to compare them side by side.</div>`;
  }
  return `<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
      <button class="btn btn-g btn-sm" style="padding:5px 10px" onclick="sbExitCompare()">← Back</button>
      <div class="clabel" style="margin:0">Compare budgets</div>
    </div>
    <div class="exp-card">${picker}</div>
    ${table}`;
}

function renderIncome(){
  const m=S.expMonth,y=S.expYear,cur=S.dashCurrency;
  const inc=[...S.income].sort((a,b)=>a.date>b.date?-1:a.date<b.date?1:txnTs(b.createdAt)-txnTs(a.createdAt));
  const totalNGN=inc.reduce((s,i)=>s+(i.amtNGN||i.amount||0),0);
  const summEl=document.getElementById('inc-summary');
  const listEl=document.getElementById('inc-list');
  if(!summEl||!listEl) return;
  _renderInterestCard();
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

// Edit an income record in the + form (the separate income window was
// removed in v4.7). The type buttons are hidden while editing, so an edit
// can't turn into a different kind of record.
function openEditInc(id){
  const inc=S.income.find(i=>i.id===id);
  if(!inc){toast('Income record not found');return;}
  openExpModal('income');
  document.getElementById('e-edit-id').value=id;
  _setEditMode(true,'Edit Income','Update Income');
  const cat=document.getElementById('i-cat2');
  if(cat&&inc.category&&![...cat.options].some(o=>o.value===inc.category)){const o=document.createElement('option');o.value=inc.category;o.textContent=inc.category;cat.appendChild(o);}
  if(cat)cat.value=inc.category||'Other';
  const b=document.getElementById('i-bank2');
  if(b&&inc.bank&&![...b.options].some(o=>o.value===inc.bank)){const o=document.createElement('option');o.value=inc.bank;o.textContent=inc.bank;b.appendChild(o);}
  if(b)b.value=inc.bank||'';
  document.getElementById('e-amt').value=inc.amount||'';
  document.getElementById('e-date').value=inc.date||todayStr();
  document.getElementById('e-notes').value=inc.notes||'';
  setTimeout(()=>{const a=document.getElementById('e-amt');if(a)_syncNumDisplay(a);},100);
}

function delIncome(id){
  const idx=S.income.findIndex(i=>i.id===id);
  const inc=idx>=0?S.income[idx]:null;
  if(!inc)return;
  // Optimistically remove from local state immediately
  S.income.splice(idx,1);
  cSet(CK.inc(S.expMonth,S.expYear),S.income);
  // Interest credited to an investment platform never touched a bank.
  const _cashBank=inc.bank&&getCashAccounts().includes(inc.bank);
  if(_cashBank&&inc.amount) _adjustCash(inc.bank, -inc.amount, inc.month||S.expMonth, inc.year||S.expYear, 'income-delete', '', inc.date);
  _histTouch(S.expMonth,S.expYear);
  renderIncome();renderDashboard();renderCashPage();
  haptic([6]);
  const rollback=()=>{
    _placeRecord('inc',{month:S.expMonth,year:S.expYear,...inc},null);
    if(_cashBank&&inc.amount) _adjustCash(inc.bank, inc.amount, inc.month||S.expMonth, inc.year||S.expYear, 'income-delete-undo', '', inc.date);
    renderIncome();renderDashboard();renderCashPage();
  };
  showUndoToast('Income deleted',
    rollback,
    async ()=>{ // commit: permanent Firestore delete
      try{await db.collection('income').doc(id).delete();}
      catch(e){toast('Delete failed — restored');rollback();return;}
      // A deleted interest posting can be posted again.
      if(inc.source==='interest'&&inc.intAcct){
        _unrecordInterest(inc);
        const posts=getInterestPosts(),p=posts[inc.intAcct]||{};
        const k=Object.keys(p).find(s=>p[s]&&p[s].incomeId===id);
        if(k){
          // A deleted automatic month stays claimed, so it isn't added back.
          if(p[k].auto)p[k]={...p[k],skipped:true,incomeId:''};else delete p[k];
          saveInterestPosts(posts);renderIncome();
        }
      }
    });
}

let _expSort='date'; // 'date' | 'expense' — controls layout inside each category
function setExpSort(mode){_expSort=mode;renderExpenses();}

function renderExpenses(){
  const m=S.expMonth,y=S.expYear;
  const months=[];for(let i=1;i<=12;i++) months.push(i);
  document.getElementById('exp-months').innerHTML=_monthStrip(m,y,'reloadMonth');
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

  // Searching here filters this month; the link opens the search of every month.
  const _crossHtml=searchQ?`<div class="csub" style="margin-top:10px;text-align:center"><span class="sh-link" onclick="openGlobalSearch();setTimeout(()=>{const i=document.getElementById('global-search-input');if(i){i.value=document.getElementById('exp-search').value;_runGlobalSearch();}},120)">Search every month for \"${esc(searchQ)}\" ›</span></div>`:'';

  const total=txns.reduce((s,t)=>s+txNGN(t),0);
  const catSpend={};txns.forEach(t=>{catSpend[t.category]=(catSpend[t.category]||0)+txNGN(t);});

  const filterDesc=S.expCat!=='All'?` · ${S.expCat}`:'';
  document.getElementById('exp-summary').innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center${Object.keys(catSpend).length?';margin-bottom:12px':''}">
      <div><div class="clabel">Total — ${MONTHS[m-1]}${filterDesc}${eyeBtn('exp-summary','renderExpenses')}</div><div class="cval">${maskIf('exp-summary',fmtCur(S.expCat!=='All'?filtered.reduce((s,t)=>s+txNGN(t),0):total,cur,m,y))}</div></div>
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
          <div class="txi-amt txi-exp">${fmtCur(txNGN(tx),cur,m,y)}${txFxNote(tx)}</div>
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
        const dayTotal=dayTxns.reduce((s,t)=>s+txNGN(t),0);
        return`<div style="padding:5px 12px 2px;font-size:0.68rem;font-weight:600;color:var(--text3);display:flex;justify-content:space-between;border-top:1px solid var(--border)">
          <span>${fmtDate(d)}</span><span style="font-family:var(--mono);color:var(--text2)">${fmtCur(dayTotal,cur,m,y)}</span></div>
          ${dayTxns.map(tx=>`
          <div onclick="openEditExp('${tx.id}')" style="display:flex;justify-content:space-between;align-items:center;padding:3px 12px;cursor:pointer">
            <span style="font-size:0.75rem;color:var(--text);min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(tx.payee)||'—'}${tx.bank?`<span style="color:var(--text3)"> · ${esc(tx.bank)}</span>`:''}${tx.notes?`<span style="color:var(--text3)"> · ${esc(tx.notes)}</span>`:''}</span>
            <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;margin-left:8px">
              <span style="font-family:var(--mono);font-size:0.75rem;color:var(--red)">${fmtCur(txNGN(tx),cur,m,y)}${txFxNote(tx)}</span>
              <button class="txi-del" onclick="event.stopPropagation();delExpense('${tx.id}')">×</button>
            </div>
          </div>`).join('')}`;
      }).join('');
    } else {
      // By expense
      const byExp={};
      items.forEach(tx=>{const key=tx.payee||'—';(byExp[key]=byExp[key]||[]).push(tx);});
      const groups=Object.entries(byExp)
        .map(([name,grpTxns])=>({name,grpTxns,total:grpTxns.reduce((s,t)=>s+txNGN(t),0)}))
        .sort((a,b)=>b.total-a.total);
      return groups.map(g=>{
        const gTxns=[...g.grpTxns].sort((a,b)=>a.date>b.date?-1:a.date<b.date?1:txnTs(b.createdAt)-txnTs(a.createdAt));
        return`<div style="padding:5px 12px 2px;font-size:0.68rem;font-weight:600;color:var(--text3);display:flex;justify-content:space-between;border-top:1px solid var(--border)">
          <span>${esc(g.name)}</span><span style="font-family:var(--mono);color:var(--text2)">${fmtCur(g.total,cur,m,y)}</span></div>
          ${gTxns.map(tx=>`
          <div onclick="openEditExp('${tx.id}')" style="display:flex;justify-content:space-between;align-items:center;padding:3px 12px;cursor:pointer">
            <span style="font-size:0.75rem;color:var(--text3);min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${fmtDate(tx.date)}${tx.bank?` · ${esc(tx.bank)}`:''}${tx.notes?` · ${esc(tx.notes)}`:''}</span>
            <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;margin-left:8px">
              <span style="font-family:var(--mono);font-size:0.75rem;color:var(--red)">${fmtCur(txNGN(tx),cur,m,y)}${txFxNote(tx)}</span>
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
    return groups[b].reduce((s,t)=>s+txNGN(t),0)-groups[a].reduce((s,t)=>s+txNGN(t),0);
  });
  listEl.innerHTML=orderedCats.map(cat=>{
    const items=groups[cat];
    const catTotal=items.reduce((s,t)=>s+txNGN(t),0);
    const gid='grp-'+cat.replace(/[^a-zA-Z0-9]/g,'');
    return`<div style="margin-bottom:6px">
      <div onclick="toggleExpGrp('${gid}')" style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--rsm);cursor:pointer;user-select:none">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:0.63rem;color:var(--text3);transition:transform 0.15s" id="${gid}-arrow">▶</span>
          ${`<span style="font-size:0.9rem">${CAT_ICONS[cat]||'📋'}</span>`}
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

// ── Search (every month; opened from Home) ─────────────────────────────────
// One search for the whole app (v4.7). Results come at once from this
// device's copy of every month, then from the database (once per 10 minutes),
// so older months are covered too. Matches the item, category, bank and
// notes; a number ("5000", "5k") also matches amounts.
let _gsData=null,_gsAt=0,_gsDebounceT=null;
function _gsFromCache(){
  const out=new Map();
  cKeys('sw3_txns_').forEach(k=>(cGet(k)||[]).forEach(t=>{if(t&&t.id)out.set('e'+t.id,{...t,_kind:'expense'});}));
  cKeys('sw3_inc_').forEach(k=>(cGet(k)||[]).forEach(t=>{if(t&&t.id)out.set('i'+t.id,{...t,_kind:'income'});}));
  (S.txns||[]).forEach(t=>out.set('e'+t.id,{...t,_kind:'expense'}));
  (S.income||[]).forEach(t=>out.set('i'+t.id,{...t,_kind:'income'}));
  return out;
}
async function openGlobalSearch(){
  openMod('global-search-modal');
  const input=document.getElementById('global-search-input');
  if(input){input.value='';setTimeout(()=>input.focus(),80);}
  _gsData=_gsFromCache();
  _runGlobalSearch();
  if(!db||Date.now()-_gsAt<6e5)return;
  try{
    const [txSnap,incSnap]=await Promise.all([db.collection('transactions').get(),db.collection('income').get()]);
    txSnap.docs.forEach(d=>_gsData.set('e'+d.id,{id:d.id,...d.data(),_kind:'expense'}));
    incSnap.docs.forEach(d=>_gsData.set('i'+d.id,{id:d.id,...d.data(),_kind:'income'}));
    _gsAt=Date.now();
    _runGlobalSearch();
  }catch(e){console.warn('search: could not load every month',e);}
}
function _debounceGlobalSearch(){
  clearTimeout(_gsDebounceT);
  _gsDebounceT=setTimeout(_runGlobalSearch,200);
}
function _runGlobalSearch(){
  const body=document.getElementById('global-search-body');if(!body)return;
  const raw=(document.getElementById('global-search-input')?.value||'').trim();
  const q=raw.toLowerCase();
  if(!q){body.innerHTML=`<div class="csub">Search every entry in every month: an item, category, bank, note or amount (e.g. "5k").</div>`;return;}
  const numQ=/^[\d.,\s₦$£kKmM+]+$/.test(raw)?parseFloat(_evalExpr(raw)):NaN;
  const all=[...(_gsData||new Map()).values()];
  const results=all.filter(r=>{
    if(!isNaN(numQ)&&numQ>0){
      const amts=[+r.amount,+r.amtNGN,r.fx&&+r.fx.amount].filter(v=>v>0);
      if(amts.some(v=>Math.round(v)===Math.round(numQ)))return true;
    }
    return [r.payee,r.category,r.notes,r.bank].filter(Boolean).join(' ').toLowerCase().includes(q);
  }).sort((a,b)=>(b.date||'')>(a.date||'')?1:(b.date||'')<(a.date||'')?-1:0);
  if(!results.length){body.innerHTML='<div class="empty"><div class="empty-i">🔍</div>No matches</div>';return;}
  const shown=results.slice(0,200);
  const total=results.reduce((s,r)=>s+(r._kind==='expense'?txNGN(r):0),0);
  body.innerHTML=`<div class="csub" style="margin-bottom:6px">${results.length} match${results.length>1?'es':''}${total?` · ${fN(total)} spent`:''}${results.length>200?' (showing the newest 200)':''}</div>`+
    shown.map(r=>{
      const isExp=r._kind==='expense';
      const label=isExp?(r.payee||r.category||'Expense'):(r.category||'Income');
      const sub=[r.date?fmtDate(r.date):'',isExp&&r.payee&&r.category?r.category:'',r.bank||'',r.notes||''].filter(Boolean).map(esc).join(' · ');
      return`<div class="dc" style="margin-bottom:6px;cursor:pointer" onclick="_jumpToGlobalResult('${r._kind}','${jsq(r.id)}',${r.month||0},${r.year||0})">
        <div class="dc-top">
          <div style="min-width:0"><div class="dc-name">${esc(label)}</div><div class="dc-sub">${sub}</div></div>
          <div style="font-family:var(--mono);font-size:0.8rem;color:${isExp?'var(--red)':'var(--green)'};white-space:nowrap">${isExp?'−':'+'}${fN(txNGN(r))}${txFxNote(r)}</div>
        </div>
      </div>`;
    }).join('');
}
// Open the result's month on the Expenses page, then the entry itself.
function _jumpToGlobalResult(kind,id,m,y){
  if(!m||!y) return;
  closeMod('global-search-modal');
  navTo('expenses');
  const btn=document.getElementById(kind==='income'?'inc-tab-btn':'exp-tab-btn');
  if(btn) switchExpTab(kind==='income'?'income':'expenses',btn);
  reloadMonth(m,y);
  const rec=(_gsData&&_gsData.get((kind==='income'?'i':'e')+id))||null;
  const list=kind==='income'?S.income:S.txns;
  if(rec&&!list.some(t=>t.id===id))list.unshift(rec);
  setTimeout(()=>{if(kind==='income')openEditInc(id);else openEditExp(id);},150);
}
function setCatFilter(c){S.expCat=c;renderExpenses();}
function openFilterDrawer(){
  const grid=document.getElementById('filter-grid');
  grid.innerHTML=['All',...getAllCats()].map(c=>`<div class="filter-chip ${c===S.expCat?'active':''}" onclick="setCatFilter('${jsq(c)}');document.querySelectorAll('.filter-chip').forEach(x=>x.classList.remove('active'));this.classList.add('active')">${c}</div>`).join('');
  document.getElementById('filter-drawer').classList.add('open');
}
function closeFilterDrawer(){document.getElementById('filter-drawer').classList.remove('open');renderExpenses();}
function clearFilter(){S.expCat='All';closeFilterDrawer();}



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
  // Transfers don't repeat; the row also stays hidden while editing.
  const _rr=document.getElementById('e-recur-row');
  if(_rr&&!document.getElementById('e-edit-id').value)_rr.style.display=type==='transfer'?'none':'flex';
  const saveBtn=document.getElementById('e-save');
  if(saveBtn)saveBtn.textContent=type==='income'?'Record Income':type==='transfer'?'Transfer Funds':'Save Expense';
  const title=document.getElementById('exp-modal-title');
  if(title)title.textContent=type==='income'?'Record Income':type==='transfer'?'Transfer':type==='expense'?'New Expense':'Transaction';
  updateExpAmtLabel();
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
  if(el)el.textContent=v?`Repeats ${v==='annually'?'yearly':v}`:'One-time';
  const ar=document.getElementById('e-recur-auto-row');if(ar)ar.style.display=v?'flex':'none';
}
function getExpLines(cat){
  return[...new Set([...(CAT_LINES[cat]||[]),...(S.customExpLines[cat]||[])].filter(p=>{const removed=(S.customExpLines['__removed__']||{})[cat]||[];return!removed.includes(p);}))];
}
function updateExpenseLines(){
  const cat=document.getElementById('e-cat')?.value;if(!cat)return;
  const lines=getExpLines(cat).slice().sort((a,b)=>a.localeCompare(b));
  const sel=document.getElementById('e-payee-sel');
  if(sel){sel.innerHTML=['-- Select --',...lines,'+ Add new'].map(l=>`<option value="${esc(l)}">${esc(l)}</option>`).join('');delete sel.dataset.allowEmpty;}
  const wrap=document.getElementById('e-payee-new-wrap');if(wrap)wrap.style.display='none';
  const hint=document.getElementById('e-autocat-hint');if(hint)hint.textContent='';
}
function handlePayeeSel(){
  const val=document.getElementById('e-payee-sel')?.value;
  const wrap=document.getElementById('e-payee-new-wrap');
  if(wrap)wrap.style.display=val==='+ Add new'?'block':'none';
}
// Income categories: the standard set plus any the user has recorded before
// (read from the local month caches), so personal ones survive without being
// written into the code.
const INC_CATS_BASE=['Salary','Allowance','Bonus / Dividend','Interest Income','Other'];
function getIncomeCats(){
  const seen=new Set();
  cKeys('sw3_inc_').forEach(k=>(cGet(k)||[]).forEach(r=>{if(r&&r.category)seen.add(r.category);}));
  (S.income||[]).forEach(r=>{if(r&&r.category)seen.add(r.category);});
  const extra=[...seen].filter(c=>!INC_CATS_BASE.includes(c)).sort((a,b)=>a.localeCompare(b));
  return [...INC_CATS_BASE.slice(0,-1),...extra,'Other'];
}
function openExpModal(type){
  type=type||'expense';_txnType=type;
  const ic2=document.getElementById('i-cat2');
  if(ic2)ic2.innerHTML=getIncomeCats().map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  const qs=document.getElementById('qa-status');if(qs){qs.textContent='';qs.className='qa-status';}
  const qn=document.getElementById('e-notes');if(qn)delete qn.dataset.qa;
  const ecur=document.getElementById('e-cur');if(ecur)ecur.value='NGN';
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
  _setEditMode(false);
  const rr=document.getElementById('e-recur');if(rr)rr.value='';
  const ra=document.getElementById('e-recur-auto');if(ra)ra.checked=false;
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
  _setEditMode(true,'Edit Expense','Update Expense');
  // A price entered in $/£ reopens in that currency so it can be corrected.
  const _ec=document.getElementById('e-cur');
  if(tx.fx&&tx.fx.amount&&_ec){_ec.value=tx.fx.currency;document.getElementById('e-amt').value=tx.fx.amount;}
  else{if(_ec)_ec.value='NGN';document.getElementById('e-amt').value=tx.amount;}
  // Old records can point at a category, item or account that has since been
  // renamed or removed (or, before 2026, have no item at all). Offer the
  // record's own value so it can still be edited and saved as it is.
  const addOpt=(sel,v,label)=>{if(sel&&v!=null&&![...sel.options].some(o=>o.value===v)){const o=document.createElement('option');o.value=v;o.textContent=label||v;sel.appendChild(o);}};
  const cs=document.getElementById('e-cat');addOpt(cs,tx.category);cs.value=tx.category;
  updateExpenseLines();
  const ps=document.getElementById('e-payee-sel');
  if(ps){
    if(tx.payee&&tx.payee!=='-- Select --'){addOpt(ps,tx.payee);ps.value=tx.payee;}
    else{addOpt(ps,'','— No item —');ps.value='';ps.dataset.allowEmpty='1';}
  }
  document.getElementById('e-notes').value=tx.notes||'';
  document.getElementById('e-date').value=tx.date||todayStr();
  const eb=document.getElementById('e-bank');if(eb&&tx.bank){addOpt(eb,tx.bank);eb.value=tx.bank;}
  updateExpAmtLabel();
  setTimeout(()=>{const a=document.getElementById('e-amt');if(a)_syncNumDisplay(a);},100);
}
// Editing hides the Expense/Income/Transfer switch and the "repeats" option.
function _setEditMode(on,title,btn){
  const row=document.getElementById('e-type-row');if(row)row.style.display=on?'none':'flex';
  const rr=document.getElementById('e-recur-row');if(rr)rr.style.display=on?'none':'flex';
  if(on){
    const t=document.getElementById('exp-modal-title');if(t)t.textContent=title;
    const b=document.getElementById('e-save');if(b)b.textContent=btn;
  }
}
const openEditExpense=openEditExp; // alias used in category popup

// ── QUICK ADD (type or say a transaction; the form fills itself in) ────────
// "5k lunch from GTB yesterday" → Expense · ₦5,000 · Food / Lunch · GTB · date.
// An on-device parser runs first (instant, works offline); when online with an
// AI key, Gemini refines it for free-form phrasing. Nothing is saved until the
// user taps Save, so a wrong guess costs one correction, not a bad record.
// Only the typed sentence plus the user's category/item/account NAMES go to
// Gemini — no amounts history, balances or other records.
const _QA_FILLER=new Set(['i','spent','spend','paid','pay','bought','buy','for','on','from','to','with','via','using','at','the','a','an','my','naira','ngn','of','in','and','today','yesterday','ago','days','day','last','this','received','got','earned','income','salary','transfer','transferred','moved','move','sent','send','account','bank','cash','card','by','gave','give','cost','costs','me','it','was','is','got','paid','pay','with']);
const _QA_WEEKDAYS=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
function _qaAllItems(){
  const out=[];
  getAllCats().forEach(c=>getExpLines(c).forEach(p=>out.push({cat:c,item:p})));
  return out;
}
function _qaNorm(s){return String(s||'').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();}
function _qaParseLocal(text){
  const raw=String(text||'').trim(),low=raw.toLowerCase();
  const r={type:'expense',amount:null,currency:'NGN',category:null,payee:null,bank:null,toBank:null,date:null,notes:''};
  if(/\$|\busd\b|\bdollars?\b/.test(low))r.currency='USD';else if(/£|\bgbp\b|\bpounds?\b/.test(low))r.currency='GBP';
  // amount: 5k, 5,000, 2.5m, ₦12000, $40
  // First number that isn't part of "3 days ago" / "2 days".
  const am=[...low.matchAll(/(?:₦|\$|usd\s*|ngn\s*|n(?=\d))?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|m|thousand|million|mil)?\b/g)]
    .find(x=>!/^\s*days?\b/.test(low.slice(x.index+x[0].length)));
  let amountTxt='';
  if(am){
    let v=parseFloat(am[1].replace(/,/g,''));
    const mult=(am[2]||'').toLowerCase();
    if(mult==='k'||mult==='thousand')v*=1e3;else if(mult==='m'||mult==='million'||mult==='mil')v*=1e6;
    if(isFinite(v)&&v>0){r.amount=Math.round(v*100)/100;amountTxt=am[0];}
  }
  // type
  if(/\b(received|got paid|earned|salary|income|credited|was paid|paid me|refund(ed)?|allowance|bonus|dividend)\b/.test(low)||/\bgot\b.*\b(pay|paid|paycheck)\b/.test(low))r.type='income';
  // accounts named in the sentence, in the order they appear
  const accts=getCashAccounts();
  const found=[];
  accts.forEach(a=>{const n=_qaNorm(a);if(!n)return;const idx=(' '+_qaNorm(low)+' ').indexOf(' '+n+' ');if(idx>=0)found.push({a,idx});});
  found.sort((x,y)=>x.idx-y.idx);
  if(/\b(transfer(red)?|move[d]?|sent)\b/.test(low)&&found.length>=2){r.type='transfer';r.bank=found[0].a;r.toBank=found[1].a;}
  else if(found.length)r.bank=found[0].a;
  // date
  const d=appNow();
  if(/\byesterday\b/.test(low))d.setDate(d.getDate()-1);
  else{
    const ago=low.match(/\b(\d+)\s+days?\s+ago\b/);
    if(ago)d.setDate(d.getDate()-(+ago[1]));
    else{
      const wd=_QA_WEEKDAYS.findIndex(w=>new RegExp('\\b'+w+'\\b').test(low));
      if(wd>=0){let back=(d.getDay()-wd+7)%7;if(back===0)back=7;d.setDate(d.getDate()-back);}
    }
  }
  r.date=toLocalISO(d);
  // what it was for: the words left after removing amount, accounts and filler
  let rest=_qaNorm(low.replace(amountTxt,' '));
  found.forEach(f=>{rest=(' '+rest+' ').replace(' '+_qaNorm(f.a)+' ',' ').trim();});
  _QA_WEEKDAYS.forEach(w=>{rest=rest.replace(new RegExp('\\b'+w+'\\b','g'),' ');});
  const words=rest.split(' ').filter(w=>w&&!_QA_FILLER.has(w)&&!/^\d+$/.test(w)&&!['k','m'].includes(w));
  const phrase=words.join(' ');
  if(r.type==='expense'&&phrase){
    const items=_qaAllItems();
    const hit=items.find(x=>_qaNorm(x.item)===phrase)
      ||items.find(x=>{const n=_qaNorm(x.item);return n&&(phrase.includes(n)||n.includes(phrase));});
    if(hit){r.payee=hit.item;r.category=hit.cat;}
    else{
      r.payee=phrase.replace(/\b\w/g,c=>c.toUpperCase());
      r.category=applyRules(r.payee)||smartCat(r.payee)||null;
    }
  }else if(r.type==='income'&&phrase){
    const ic=getIncomeCats().find(c=>_qaNorm(c).split(' ').some(w=>w.length>3&&phrase.includes(w)));
    r.category=ic||(/\bsalary\b/.test(low)?'Salary':null);
    r.notes=phrase.replace(/\b\w/g,c=>c.toUpperCase());
  }
  return r;
}
async function _qaParseAI(text,local){
  const cats={};getAllCats().forEach(c=>{cats[c]=getExpLines(c);});
  const prompt=`You turn one short note about money into a transaction for a personal finance app. Reply with JSON only.
Today is ${todayStr()} (${_QA_WEEKDAYS[appNow().getDay()]}). Amounts are in Naira unless another currency is stated. "5k" means 5000, "2m" means 2000000.
Expense categories and their known items: ${JSON.stringify(cats)}
Income categories: ${JSON.stringify(getIncomeCats())}
The user's accounts: ${JSON.stringify(getCashAccounts())}
Rules:
- type is "expense", "income" or "transfer" (moving money between two of the user's own accounts).
- category must be exactly one of the listed categories for that type, or null.
- payee (expenses only) is what the money was spent on, 1-3 words. Prefer an existing item name exactly as listed when it fits; otherwise a short new name in Title Case.
- bank is the account the money left (expense, transfer) or went into (income), exactly as listed, or null if not mentioned. toBank is the receiving account for a transfer.
- date is YYYY-MM-DD. Use today if no day is mentioned.
- notes: anything useful not captured elsewhere, else "".
- currency is the currency the amount was stated in: "NGN", "USD" or "GBP" (e.g. "$7" or "7 dollars" is USD). Do not convert the amount.
JSON shape: {"type":"","amount":0,"currency":"NGN","category":null,"payee":null,"bank":null,"toBank":null,"date":"","notes":""}
Note: ${JSON.stringify(String(text).slice(0,300))}`;
  const res=await Promise.race([
    _aiFetch({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{temperature:0,responseMimeType:'application/json',maxOutputTokens:400,thinkingConfig:{thinkingBudget:0}}}),
    new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),12000)),
  ]);
  let j;try{j=JSON.parse(String(res.text).replace(/^```(?:json)?|```$/g,'').trim());}catch{return null;}
  if(!j||typeof j!=='object')return null;
  const accts=getCashAccounts(),pickAcct=v=>accts.find(a=>_qaNorm(a)===_qaNorm(v))||null;
  const out={...local};
  if(['expense','income','transfer'].includes(j.type))out.type=j.type;
  if(+j.amount>0)out.amount=+j.amount;
  if(['NGN','USD','GBP'].includes(j.currency))out.currency=j.currency;
  if(/^\d{4}-\d{2}-\d{2}$/.test(j.date||''))out.date=j.date;
  if(j.bank)out.bank=pickAcct(j.bank)||out.bank;
  if(j.toBank)out.toBank=pickAcct(j.toBank)||out.toBank;
  if(typeof j.notes==='string')out.notes=j.notes.slice(0,200);
  if(out.type==='expense'){
    if(j.category&&getAllCats().includes(j.category))out.category=j.category;
    if(j.payee){
      const hit=_qaAllItems().find(x=>_qaNorm(x.item)===_qaNorm(j.payee));
      out.payee=hit?hit.item:String(j.payee).slice(0,40);
      if(hit&&!j.category)out.category=hit.cat;
    }
  }else if(out.type==='income'){
    if(j.category&&getIncomeCats().includes(j.category))out.category=j.category;
  }
  return out;
}
function _qaFill(r){
  setTxnType(r.type);
  // Clear what an earlier Quick add may have filled, so nothing stale remains.
  const ps=document.getElementById('e-payee-sel');if(ps&&[...ps.options].some(o=>o.value==='-- Select --'))ps.value='-- Select --';
  const pn=document.getElementById('e-payee-new');if(pn)pn.value='';
  const nt=document.getElementById('e-notes');if(nt&&nt.dataset.qa)nt.value='';
  handlePayeeSel();
  const amt=document.getElementById('e-amt');
  if(r.amount){amt.value=String(r.amount);if(typeof _syncNumDisplay==='function')_syncNumDisplay(amt);}
  const _ec=document.getElementById('e-cur');if(_ec&&r.type==='expense')_ec.value=r.currency||'NGN';
  if(r.date)document.getElementById('e-date').value=r.date;
  const setSel=(id,v)=>{const el=document.getElementById(id);if(el&&v&&[...el.options].some(o=>o.value===v))el.value=v;};
  if(r.type==='expense'){
    if(r.category){setSel('e-cat',r.category);updateExpenseLines();}
    if(r.payee){
      const sel=document.getElementById('e-payee-sel');
      if(sel&&[...sel.options].some(o=>o.value===r.payee)){sel.value=r.payee;}
      else if(sel){sel.value='+ Add new';document.getElementById('e-payee-new').value=r.payee;}
      handlePayeeSel();
    }
    setSel('e-bank',r.bank);updateExpAmtLabel();
    // A $ price with a dollar account: the account is already in dollars.
    if(_ec&&isUSDCashAccount(document.getElementById('e-bank').value))_ec.value='NGN';
  }else if(r.type==='income'){
    setSel('i-cat2',r.category);setSel('i-bank2',r.bank);
  }else if(r.type==='transfer'){
    setXfrType('cash-cash');setSel('xfr2-from',r.bank);setSel('xfr2-to',r.toBank);
  }
  if(r.notes&&!nt.value){nt.value=r.notes;nt.dataset.qa='1';}
}
function _qaStatus(msg,cls){const el=document.getElementById('qa-status');if(el){el.textContent=msg||'';el.className='qa-status'+(cls?' '+cls:'');}}
let _qaSeq=0; // a newer Say it takes over from one still waiting on the AI
async function quickAddParse(text){
  text=String(text||'').trim();
  if(!text){_qaStatus('Type or say something like “5k lunch from GTB yesterday”.');return;}
  const seq=++_qaSeq;
  const local=_qaParseLocal(text);
  _qaFill(local);
  let r=local,byAI=false;
  if(navigator.onLine!==false&&_aiKey()){
    _qaStatus('Filling in…');
    try{const a=await _qaParseAI(text,local);if(a&&seq===_qaSeq){r=a;byAI=true;_qaFill(a);}}
    catch(e){console.warn('quick add AI failed, kept the on-device result',e);}
  }
  if(seq!==_qaSeq)return;
  const missing=[];
  if(!r.amount)missing.push('amount');
  if(r.type==='expense'&&!r.category)missing.push('category');
  if(r.type==='expense'&&!r.payee)missing.push('what it was spent on');
  if(r.type!=='transfer'&&!r.bank)missing.push(r.type==='income'?'account':'bank');
  if(r.type==='transfer'&&(!r.bank||!r.toBank))missing.push('accounts');
  _qaStatus(missing.length?`Filled in${byAI?' ✦':''}. Please pick the ${missing.join(' and ')}, then save.`:`Filled in${byAI?' ✦':''}. Check it, then save.`,missing.length?'qa-warn':'qa-ok');
}
// ── VOICE INPUT (shared by Say it and the AI chat) ─────────────────────────
// Web Speech API. Chrome/Android and Safari have it; some installed-app modes
// and Firefox don't, so every caller has a typed fallback.
let _voiceRec=null;
function voiceSupported(){return !!(window.SpeechRecognition||window.webkitSpeechRecognition);}
// opts: {btn, onText(text), onDone(finalText), onStatus(msg,cls)}
function voiceStart(opts){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  const status=opts.onStatus||(()=>{});
  if(!SR){status("Voice isn't available in this browser. Type it instead, or use your keyboard's mic.",'qa-warn');return;}
  if(_voiceRec){try{_voiceRec.stop();}catch{}return;} // second tap = stop
  const rec=new SR();_voiceRec=rec;
  rec.lang=navigator.language||'en-NG';rec.interimResults=true;rec.maxAlternatives=1;
  if(opts.btn)opts.btn.classList.add('on');
  let finalText='',lastText='';
  rec.onresult=e=>{
    let t='';for(let i=0;i<e.results.length;i++)t+=e.results[i][0].transcript;
    lastText=t;if(opts.onText)opts.onText(t);
    if(e.results[e.results.length-1].isFinal)finalText=t;
  };
  rec.onerror=e=>{status(e.error==='not-allowed'||e.error==='service-not-allowed'?'Microphone access is blocked. Allow it in your browser settings, or type instead.':e.error==='no-speech'?"Didn't hear anything. Tap the mic and try again.":"Didn't catch that. Try again or type it.",'qa-warn');};
  rec.onend=()=>{
    _voiceRec=null;if(opts.btn)opts.btn.classList.remove('on');
    const t=(finalText||lastText||'').trim();
    if(t&&opts.onDone)opts.onDone(t);
  };
  try{rec.start();}catch(e){_voiceRec=null;if(opts.btn)opts.btn.classList.remove('on');status("Couldn't start the microphone.",'qa-warn');}
}
// Say it (the + menu): its own screen, and the one place to describe a
// transaction in words. Listening starts straight away (the menu tap is the
// user gesture the mic needs) and what's heard goes into the box; tapping the
// box stops the mic so you can type instead. When you stop talking, or tap ✦,
// the + form opens filled in, for you to check and save.
let _vcTyping=false;
function _vcStatus(msg,cls){const el=document.getElementById('vc-status');if(el){el.textContent=msg||'';el.className='vc-status'+(cls?' '+cls:'');}}
function openVoiceAdd(){
  const v=document.getElementById('vc-text');if(v)v.value='';
  openMod('voice-modal');
  voiceAddStart();
}
function voiceAddStart(){
  if(_voiceRec){try{_voiceRec.stop();}catch{}return;}
  _vcTyping=false;
  const v=document.getElementById('vc-text');if(v)v.value='';
  _vcStatus(voiceSupported()?'Listening…':'Type it below, then tap ✦.');
  voiceStart({
    btn:document.getElementById('vc-mic'),
    onText:t=>{if(v&&!_vcTyping)v.value=t;},
    onDone:()=>{
      if(_vcTyping||!document.getElementById('voice-modal')?.classList.contains('open'))return;
      _vcStatus('Got it. Filling in the form…','qa-ok');
      setTimeout(voiceAddSubmit,500);
    },
    onStatus:_vcStatus,
  });
}
// Tapping the box while listening: stop the mic without submitting.
function voiceAddTyping(){
  if(!_voiceRec)return;
  _vcTyping=true;
  const r=_voiceRec;_voiceRec=null;try{r.abort();}catch{}
  document.getElementById('vc-mic')?.classList.remove('on');
  _vcStatus('Type it, then tap ✦.');
}
function voiceAddSubmit(){
  if(!document.getElementById('voice-modal')?.classList.contains('open'))return;
  const text=(document.getElementById('vc-text')?.value||'').trim();
  if(!text){_vcStatus('Say or type something first.','qa-warn');return;}
  closeVoice();
  openExpModal('expense');
  quickAddParse(text);
}
function closeVoice(){
  closeMod('voice-modal'); // first, so the mic stopping doesn't go on to fill in the form
  if(_voiceRec){const r=_voiceRec;_voiceRec=null;try{r.abort();}catch{}}
  document.getElementById('vc-mic')?.classList.remove('on');
}
// AI chat: dictate the question into the box; the user reviews it and taps ➤.
function aiVoice(){
  const inp=document.getElementById('ai-input');if(!inp||inp.disabled)return;
  const before=inp.value.trim();
  voiceStart({
    btn:document.getElementById('ai-mic'),
    onText:t=>{inp.value=(before?before+' ':'')+t;if(typeof aiGrowInput==='function')aiGrowInput(inp);},
    onDone:()=>inp.focus(),
    onStatus:msg=>toast(msg),
  });
}

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
// `dateStr` is the transaction's own date. It matters because these entries are
// surfaced in the account history — stamping them with today's date would show
// (and sort) them wrongly. Falls back to today when a caller doesn't pass one.
function _logCashLedger(bank, delta, m, y, source, ref, dateStr){
  try{
    const key=`sw3_cash_ledger_${y}_${m}`;
    const entry={ts:Date.now(),date:dateStr||todayStr(),bank,delta:Math.round(delta*100)/100,source:source||'',ref:ref||''};
    const log=cGet(key)||[];
    log.push(entry);
    cSet(key, log.slice(-500)); // cap per month (local cache only)
    if(db){
      db.collection('cashLedger').doc(sid(m,y)).set({
        month:m, year:y,
        entries: FV.arrayUnion(entry)
      },{merge:true}).catch(e=>console.warn("cashLedger write failed",e));
    }
  }catch(e){console.warn("cash ledger entry not recorded",e);}
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
  if(!_dbReady()) return 0;
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
      entries: FV.arrayUnion(...missing)
    },{merge:true});
    return missing.length;
  }catch(e){return 0;}
}

// Reconcile the ledger for the current + several recent months on app open,
// so a device that stranded entries heals automatically without the user
// having to open the audit.
async function _healCashLedgers(){
  if(!_dbReady()) return;
  const seen=new Set();
  for(const {m,y} of _prevMonthsList(S.expMonth+1,S.expYear,7)){ // current month + 6 prior
    const k=`${y}-${m}`; if(seen.has(k))continue; seen.add(k);
    try{await _syncCashLedgerUp(m,y);}catch(e){_warnLoad("_syncCashLedgerUp",e);}
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
      }catch(e){_warnLoad("_walkBackClosing",e);}
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
  if(!_dbReady()) return;
  const q=cGet('sw3_ripple_queue')||[];
  if(!q.length) return;
  cSet('sw3_ripple_queue',[]);
  for(const it of q){
    try{await db.collection('cashBalances').doc(sid(it.m,it.y))
      .set({[it.bank]:FV.increment(it.delta)},{merge:true});}
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
        d.ref.set({[bank]:FV.increment(delta)},{merge:true})
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

function _adjustCash(bank, delta, m, y, source, ref, dateStr){
  // delta: positive = add, negative = deduct
  if(!bank||!delta) return;
  // Update local state immediately for instant UI (single-device correctness).
  const isCurMonth=(m===S.cashMonth&&y===S.cashYear)||(m===S.dashMonth&&y===S.dashYear);
  const base=isCurMonth&&Object.keys(S.cash||{}).length?{...S.cash}:{...(cGet(CK.cash(m,y))||{})};
  base[bank]=(base[bank]||0)+delta;
  if(m===S.cashMonth&&y===S.cashYear) S.cash=base;
  if(m===S.dashMonth&&y===S.dashYear) S.cash=base;
  cSet(CK.cash(m,y),base);
  _logCashLedger(bank, delta, m, y, source, ref, dateStr);
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
          [bank]: FV.increment(delta),
          month:m, year:y
        },{merge:true});
        _clearCashDirty(m,y,bank);
        _rippleCashForward(bank,delta,m,y); // fire-and-forget
      }catch(e){
        _clearCashDirty(m,y,bank);
        // Retry the same change later. (It used to queue a copy of the whole
        // month's balances, which could overwrite changes made on another
        // device in the meantime.)
        console.warn('balance change not saved yet - will retry',e);
        _rippleQueueAdd(bank,delta,m,y);
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
  if(db) db.collection('transfers').doc(rec.id).set(rec).catch(e=>console.warn("transfer record write failed",e));
  return rec.id;
}

// ── Transfers: one implementation for all three surfaces ───────────────────
// The expense modal, the Move modal and the Cash-page quick transfer each used
// to write the whole cashBalances doc directly, and each derived the month from
// whichever month the UI happened to be showing rather than from the
// transaction's own date. A transfer dated in August while September was on
// screen therefore moved September's balance. They also bypassed the cash
// ledger, so transfers never appeared in an account's history, and a full-doc
// write could clobber a concurrent change from another device.
//
// Everything now funnels through here: cash legs go through _adjustCash
// (atomic FieldValue.increment, ledger entry stamped with the real date,
// ripple-forward into later months, offline queue) and investment legs through
// _invDeposit/_invWithdraw.

// Month/year come from the transaction's DATE, never from the viewed month.
function _ymOf(dateStr){
  const p=String(dateStr||'').split('-'), y=+p[0], m=+p[1];
  return (y>1970&&m>=1&&m<=12)?{m,y}:{m:S.expMonth,y:S.expYear};
}
// Resolve a balance the same way _adjustCash does, so the insufficient-funds
// guard and the write it guards can never disagree about which month they mean.
function _cashBalFor(bank,m,y){
  const base=((m===S.cashMonth&&y===S.cashYear)||(m===S.dashMonth&&y===S.dashYear))
    ? (S.cash||{}) : (cGet(CK.cash(m,y))||{});
  return Number(base[bank])||0;
}
// Returns {ok, msg}. Callers toast msg and handle their own close/render.
function _doTransfer({kind,from,to,amt,date,notes}){
  amt=Number(amt);
  if(!amt||amt<=0) return {ok:false,msg:'Enter a valid amount'};
  if(!from||!to)   return {ok:false,msg:'Select accounts'};
  date=date||todayStr();
  notes=notes||'';
  const {m,y}=_ymOf(date);
  const fx=getFxRates(m,y).USD||1650;

  // Interest earned but not yet recorded can cover a shortfall (current month
  // only, because recorded interest is dated today).
  const _topUp=()=>_invIsLiveMonth(m,y)&&_offerInterestTopUp('cash:'+from,_cashBalFor(from,m,y),amt);
  if(kind==='cash-cash'){
    if(from===to) return {ok:false,msg:'Select different accounts'};
    if(_cashBalFor(from,m,y)<amt&&!_topUp()) return {ok:false,msg:`Insufficient funds in ${from}`};
    const fU=isUSDCashAccount(from),tU=isUSDCashAccount(to);
    // Amount is entered in the FROM account's currency; convert when they differ.
    const toAmt=fU===tU?amt:(fU?Math.round(amt*fx):+(amt/fx).toFixed(2));
    const ref=_saveXfrRecord(from,to,amt,date,m,y,notes,toAmt,'cash-cash');
    _adjustCash(from,-amt,m,y,'Transfer → '+to,ref,date);
    _adjustCash(to,toAmt,m,y,'Transfer ← '+from,ref,date);
    return {ok:true,msg:fU===tU
      ? `${fU?'$'+amt:fN(amt)}: ${from} → ${to}`
      : `${fU?'$'+amt:fN(amt)} → ${tU?'$'+toAmt:fN(toAmt)}: ${from} → ${to}`};
  }

  // Investment legs mutate the LIVE sub-principal snapshot (see the note above
  // getSubsForPlatform): sub balances are a single current-month snapshot, not
  // month-bucketed. Applying a back-dated investment leg would write today's
  // principals into a past month AND corrupt today's figures, so refuse it.
  // Back-dating inside the current month is still fine.
  if(!_invIsLiveMonth(m,y)){
    const n=appNow();
    return {ok:false,msg:`Investment transfers must be dated in ${MONTHS[n.getMonth()]} ${n.getFullYear()} — investment balances only track the current month`};
  }

  if(kind==='cash-inv'){
    if(_cashBalFor(from,m,y)<amt&&!_topUp()) return {ok:false,msg:`Insufficient funds in ${from}`};
    const ngnAmt=isUSDCashAccount(from)?Math.round(amt*fx):amt;
    const platLabel=PLATFORMS.find(p=>p.key===to)?.label||to;
    const ref=_saveXfrRecord(from,to,amt,date,m,y,notes,ngnAmt,'cash-inv');
    _adjustCash(from,-amt,m,y,'Transfer → '+platLabel,ref,date);
    _invDeposit(to,ngnAmt,m,y);
    addInvMovement(to,ngnAmt,date,notes);
    return {ok:true,msg:`${isUSDCashAccount(from)?'$'+amt:fN(ngnAmt)}: ${from} → ${platLabel}`};
  }

  if(kind==='inv-cash'){
    const platLabel=PLATFORMS.find(p=>p.key===from)?.label||from;
    // Withdraw FIRST — it returns false on insufficient balance, so nothing is
    // credited before we know the debit can succeed.
    if(!_invWithdraw(from,amt,m,y)){
      const bal=getSubsForPlatform(from).reduce((s,sb)=>s+(Number(sb.principal)||0),0)||Number(S.investments[from])||0;
      if(!_offerInterestTopUp('inv:'+from,bal,amt)||!_invWithdraw(from,amt,m,y))
        return {ok:false,msg:`Insufficient balance in ${platLabel}`};
    }
    const toAmt=isUSDCashAccount(to)?+(amt/fx).toFixed(2):amt;
    const ref=_saveXfrRecord(from,to,amt,date,m,y,notes,toAmt,'inv-cash');
    _adjustCash(to,toAmt,m,y,'Transfer ← '+platLabel,ref,date);
    addInvMovement(from,-amt,date,notes);
    return {ok:true,msg:`${fN(amt)}: ${platLabel} → ${to}`};
  }
  return {ok:false,msg:'Unknown transfer type'};
}

// ── Shared investment balance mutators (keep subs + flat totals in sync) ──
// All amounts are NGN equivalents (USD platforms store NGN per the storage rule).
function _invDeposit(pKey, ngnAmt, m, y){
  const subs=migrateToSubs(pKey);
  subs[0].principal=(Number(subs[0].principal)||0)+ngnAmt;
  saveSubsForPlatform(pKey,subs);
  const inv={...S.investments};inv[pKey]=subs.reduce((s,sb)=>s+(Number(sb.principal)||0),0);
  S.investments=inv;cSet(CK.inv(m,y),inv);
  if(db)db.collection('investments').doc(sid(m,y)).set({...inv,month:m,year:y},{merge:true}).catch(e=>console.warn("investments write failed (deposit)",e));
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
  if(db)db.collection('investments').doc(sid(m,y)).set({...inv,month:m,year:y},{merge:true}).catch(e=>console.warn("investments write failed (withdrawal)",e));
  return true;
}

// ══════════════════════════════════════════════════════════════════════════
// INTEREST INCOME POSTING
// ══════════════════════════════════════════════════════════════════════════
// Interest-bearing accounts (Renmoney = cash, Piggy = investment, and any other
// account you've set a rate on) accrue daily. The interest is recorded when
// you choose (see "Recording interest" below). sw3_interest_posts is the
// ledger of the old month-by-month posts (before v4.7.2); accrual starts after
// the last of them.
const INT_POSTS_KEY='sw3_interest_posts';
function getInterestPosts(){return cGet(INT_POSTS_KEY)||{};}
function saveInterestPosts(obj){
  cSet(INT_POSTS_KEY,obj);
  if(db)db.collection('appConfig').doc('interestPosts')
    .set({posts:obj,updatedAt:FV.serverTimestamp()})   // whole map, so a removed month is removed
    .catch(e=>console.warn('interestPosts sync failed',e));
}
async function loadInterestPosts(){
  if(!db)return;
  try{
    const doc=await db.collection('appConfig').doc('interestPosts').get();
    const obj=doc.exists?doc.data()?.posts:null;
    if(obj&&typeof obj==='object')cSet(INT_POSTS_KEY,obj);
  }catch(e){_warnLoad('loadInterestPosts',e);}
}
function _daysInMonth(m,y){return new Date(y,m,0).getDate();}
// Candidate accounts: cash accounts with an interest rate set, plus investment
// platforms whose subs carry a rate.
function _interestAccounts(){
  const list=[];
  const im=getCashInterestMeta();
  getCashAccounts().forEach(name=>{
    const ci=im[name];
    if(ci&&_sbNum(ci.interestRate)>0)
      list.push({key:'cash:'+name,kind:'cash',name,rate:_sbNum(ci.interestRate),compoundType:ci.compoundType||'daily_accrual',startDate:ci.startDate||''});
  });
  (typeof PLATFORMS!=='undefined'?PLATFORMS:[]).forEach(p=>{
    const subs=getSubsForPlatform(p.key)||[];
    const wr=subs.find(s=>_sbNum(s.rate)>0);
    if(wr)
      list.push({key:'inv:'+p.key,kind:'inv',name:p.label||p.key,pKey:p.key,rate:_sbNum(wr.rate),compoundType:wr.compoundType||'daily_accrual',startDate:wr.startDate||''});
  });
  return list;
}
// ── Interest (v4.7.3) ────────────────────────────────────────────────────
// • Worked out day by day on what the account actually held. Each day's
//   opening balance is rebuilt from the month's closing balance and the dated
//   movements in that month: the cash ledger for bank accounts (expenses,
//   income, transfers, interest), investment movements for platforms. A month
//   with no recorded movements uses the average of its opening and closing
//   balance. (v4.7.2 multiplied today's balance by the whole period.)
// • No maturity date: interest is added automatically at the end of each
//   month (runAutoInterest). One Interest Income entry dated the month's last
//   day, the balance credited, so the next month earns on it. Months before
//   INT_AUTO_FROM aren't back-filled one by one; interest earned before then
//   goes into the first automatic credit.
// • With a maturity date: interest keeps accruing until then and is recorded
//   by hand ("Record interest") or when cashed out.
// • "Record interest" works at any time; accrual restarts that day (intFrom).
// Posted months live in sw3_interest_posts (appConfig/interestPosts), claimed
// in a transaction so two devices can't both post the same month.
const INT_AUTO_FROM='2026-09';
function _laterDate(a,b){return !a?(b||''):!b?a:(a>b?a:b);}
function _ymd(y,m,d){return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;}
function _nextMonthStart(y,m){return m===12?_ymd(y+1,1,1):_ymd(y,m+1,1);}
function _lastPostedFrom(key){
  const p=getInterestPosts()[key]||{};
  const ks=Object.keys(p).filter(k=>/^\d{4}-\d{2}$/.test(k)).sort();
  if(!ks.length)return '';
  const [y,m]=ks[ks.length-1].split('-').map(Number);
  return _nextMonthStart(y,m);
}
function _monthsFrom(from){
  const out=[];if(!from)return out;
  const n=appNow(),cm=n.getMonth()+1,cy=n.getFullYear();
  let [y,m]=from.split('-').map(Number);
  while(y<cy||(y===cy&&m<=cm)){out.push({m,y});if(++m>12){m=1;y++;}}
  return out;
}
function _cashIntMeta(name){return getCashInterestMeta()[name]||{};}
// Where accrual starts: the latest of the start date, the last "Record
// interest" and (for accounts credited monthly) the last month credited.
function _cashAccrualFrom(name){
  const ci=_cashIntMeta(name);
  return _laterDate(_laterDate(ci.startDate||'',ci.intFrom||''),ci.maturityDate?'':_lastPostedFrom('cash:'+name));
}
function _subAccrualFrom(pKey,sub){
  return _laterDate(_laterDate(sub.startDate||'',sub.intFrom||''),sub.maturityDate?'':_lastPostedFrom('inv:'+pKey));
}

// ── Balance history ──
// Cash ledger entries: this device's copy plus the synced month doc (fetched
// by _loadLedgers; the ledger has no listener, see startRealtimeListeners).
const _ledgerRemote={};
function _ledgerEntries(m,y){
  const seen=new Set(),out=[];
  [...(cGet(`sw3_cash_ledger_${y}_${m}`)||[]),...((_ledgerRemote[sid(m,y)]||{}).entries||[])].forEach(e=>{
    const k=`${e.ts}|${e.bank}|${e.delta}|${e.source}`;
    if(!seen.has(k)){seen.add(k);out.push(e);}
  });
  return out;
}
async function _loadLedgers(months){
  if(!_dbReady())return false;
  const n=appNow(),live=sid(n.getMonth()+1,n.getFullYear());
  const need=months.filter(({m,y})=>{const r=_ledgerRemote[sid(m,y)];return !r||(sid(m,y)===live&&Date.now()-r.at>3e5);});
  if(!need.length)return false;
  await Promise.all(need.map(async({m,y})=>{
    try{
      const d=await db.collection('cashLedger').doc(sid(m,y)).get();
      _ledgerRemote[sid(m,y)]={at:Date.now(),entries:d.exists&&Array.isArray(d.data().entries)?d.data().entries:[]};
    }catch(e){_warnLoad('cash ledger '+sid(m,y),e);}
  }));
  return true;
}
// Closing balance of an account for a month (the live balance for this month).
function _closingBal(key,m,y){
  const live=_invIsLiveMonth(m,y);
  if(key.startsWith('cash:')){
    const name=key.slice(5);
    const doc=(live&&S.cashMonth===m&&S.cashYear===y&&S.cash&&Object.keys(S.cash).length)?S.cash:cGet(CK.cash(m,y));
    return doc&&doc[name]!=null?_sbNum(doc[name]):null;
  }
  const pKey=key.slice(4);
  if(live){const t=getSubsForPlatform(pKey).reduce((s,sb)=>s+(Number(sb.principal)||0),0);return t||_sbNum((cGet(CK.inv(m,y))||{})[pKey]);}
  const doc=cGet(CK.inv(m,y));
  return doc&&doc[pKey]!=null?_sbNum(doc[pKey]):null;
}
function _movesIn(key,m,y){
  const pre=_ymd(y,m,1).slice(0,8);
  if(key.startsWith('cash:')){
    const name=key.slice(5);
    return _ledgerEntries(m,y).filter(e=>e.bank===name&&String(e.date||'').startsWith(pre)).map(e=>({date:e.date,delta:+e.delta||0}));
  }
  const pKey=key.slice(4);
  return getInvMovements().filter(x=>x.platformKey===pKey&&String(x.date||'').startsWith(pre)).map(x=>({date:x.date,delta:+x.delta||0}));
}
// Opening balance of each day of a month (index 0 = the 1st): the closing
// balance less everything that moved on or after that day.
function _dayBalances(key,m,y){
  const n=_daysInMonth(m,y),p=m===1?{m:12,y:y-1}:{m:m-1,y};
  const now=appNow();
  let close=_closingBal(key,m,y);
  const prevClose=_closingBal(key,p.m,p.y);
  if(close==null)close=prevClose;
  if(close==null)close=_closingBal(key,now.getMonth()+1,now.getFullYear())||0;
  const moves=_movesIn(key,m,y);
  if(!moves.length){
    const v=prevClose!=null?(prevClose+close)/2:close;
    return new Array(n).fill(v);
  }
  const out=new Array(n);
  for(let d=1;d<=n;d++){const ds=_ymd(y,m,d);out[d-1]=close-moves.reduce((s,x)=>s+(x.date>=ds?x.delta:0),0);}
  return out;
}
// Interest on `key` for the days from `from` up to (not including) `to`.
function _interestRange(key,rate,ct,from,to,share){
  if(!(rate>0)||!from||!to||from>=to)return 0;
  if(share==null)share=1;
  const r=rate/100/365;
  let acc=0,[y,m]=from.split('-').map(Number);
  const [ty,tm]=to.split('-').map(Number);
  while(y<ty||(y===ty&&m<=tm)){
    const bals=_dayBalances(key,m,y);
    for(let d=1;d<=bals.length;d++){
      const ds=_ymd(y,m,d);
      if(ds<from)continue;
      if(ds>=to)break;
      const b=Math.max(0,bals[d-1]*share);
      acc+=(ct==='daily_compound'?b+acc:b)*r;
    }
    if(++m>12){m=1;y++;}
  }
  return acc;
}

// ── Estimates ──
// Interest a cash account has earned and not yet recorded, in the account's
// own currency, up to today (or `endCap`, or its maturity date).
function _cashInterest(name,endCap){
  const ci=_cashIntMeta(name),rate=_sbNum(ci.interestRate);
  const from=_cashAccrualFrom(name)||todayStr().slice(0,8)+'01';
  let to=endCap||todayStr();
  if(ci.maturityDate&&ci.maturityDate<to)to=ci.maturityDate;
  if(!rate||from>=to)return {amount:0,from,to,rate};
  let amt=_interestRange('cash:'+name,rate,ci.compoundType,from,to,1);
  amt=isUSDCashAccount(name)?Math.round(amt*100)/100:Math.round(amt);
  return {amount:amt,from,to,rate};
}
function _cashUnrealised(name){return _cashInterest(name);}
// One fixed-income investment. The platform's balance history is shared
// across its investments by their current principal.
function _subInterest(pKey,sub,endCap,platTotal){
  if(sub.assetClass!=='fixed_income'||!_sbNum(sub.rate))return null;
  const from=_subAccrualFrom(pKey,sub);if(!from)return null;
  let to=endCap||todayStr();
  if(sub.maturityDate&&sub.maturityDate<to)to=sub.maturityDate;
  const tot=platTotal!=null?platTotal:getSubsForPlatform(pKey).reduce((s,x)=>s+(Number(x.principal)||0),0);
  const share=tot>0?(Number(sub.principal)||0)/tot:1;
  const amount=from<to?Math.round(_interestRange('inv:'+pKey,_sbNum(sub.rate),sub.compoundType,from,to,share)):0;
  return {id:sub.id,amount,from,to,rate:_sbNum(sub.rate),matured:!!(sub.maturityDate&&sub.maturityDate<=todayStr())};
}
// A platform's unrecorded interest (₦) with each investment's share.
// monthlyOnly: just the investments credited monthly (no maturity date).
function _invUnrealised(pKey,endCap,monthlyOnly){
  const subs=getSubsForPlatform(pKey),tot=subs.reduce((s,x)=>s+(Number(x.principal)||0),0);
  const per=[];let amount=0,from='',rate=0;
  subs.forEach(sb=>{
    if(monthlyOnly&&sb.maturityDate)return;
    const r=_subInterest(pKey,sb,endCap,tot);if(!r)return;
    if(!from||r.from<from)from=r.from;rate=rate||r.rate;
    if(r.amount>0){per.push({id:r.id,amount:r.amount});amount+=r.amount;}
  });
  return {amount,from,rate,per};
}
function _unrealisedFor(key){
  return key.startsWith('cash:')?_cashUnrealised(key.slice(5)):_invUnrealised(key.slice(4));
}
// Credited automatically each month (no maturity date)?
// Daily-compounding accounts (e.g. Renmoney): interest joins the balance every
// day, so what they hold today is the saved balance plus the interest built up
// since it was last added. Month-end accounts (e.g. Piggy) only grow when the
// month's interest is added. Either way the month's interest is booked as one
// Interest Income entry at month end (runAutoInterest).
function _intDaily(key){
  if(key.startsWith('cash:'))return _cashIntMeta(key.slice(5)).compoundType==='daily_compound';
  return getSubsForPlatform(key.slice(4)).some(s=>s.assetClass==='fixed_income'&&_sbNum(s.rate)&&s.compoundType==='daily_compound');
}
// A month's cash balances with daily-compounding interest built up so far
// added (this month only; the saved balances are untouched).
function _withAccrued(cash,m,y){
  if(!cash||cash._accrued||!_invIsLiveMonth(m,y))return cash;
  let out=cash;
  getCashAccounts().forEach(n=>{
    const ci=_cashIntMeta(n);
    if(ci.compoundType!=='daily_compound'||!(_sbNum(ci.interestRate)>0))return;
    const a=_cashUnrealised(n).amount;
    if(a){if(out===cash)out={...cash};out[n]=(+cash[n]||0)+a;}
  });
  // Marked (not enumerable, so never saved) so it can't be added twice.
  if(out!==cash)Object.defineProperty(out,'_accrued',{value:true});
  return out;
}
function _invDailyAccrued(pKey,subs,tot){
  return subs.reduce((s,sb)=>{
    if(sb.compoundType!=='daily_compound')return s;
    const r=_subInterest(pKey,sb,null,tot);return s+(r?r.amount:0);
  },0);
}
function _intMonthly(key){
  if(key.startsWith('cash:'))return !_cashIntMeta(key.slice(5)).maturityDate;
  return getSubsForPlatform(key.slice(4)).some(s=>s.assetClass==='fixed_income'&&_sbNum(s.rate)&&!s.maturityDate);
}
// Fetch what the estimates need (ledgers, past balances) and redraw once.
let _intPrefP=null;
function _intPrefetch(){
  if(_intPrefP||!_dbReady())return;
  const froms=getCashAccounts().filter(n=>_sbNum(_cashIntMeta(n).interestRate)>0).map(n=>_cashAccrualFrom(n)||todayStr().slice(0,8)+'01').sort();
  if(!froms.length)return;
  _intPrefP=Promise.all([_loadLedgers(_monthsFrom(froms[0])),ensureBalanceHistory()])
    .then(([a,b])=>{if(a||b){renderCashPage();_renderInterestCard();}})
    .catch(e=>console.warn('interest prefetch failed',e))
    .finally(()=>{_intPrefP=null;});
}
function _interestAcctName(key){
  return key.startsWith('cash:')?key.slice(5):(PLATFORMS.find(p=>p.key===key.slice(4))?.label||key.slice(4));
}
function _fmtAcctAmt(key,v){return key.startsWith('cash:')&&isUSDCashAccount(key.slice(5))?'$'+(+v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):fN(Math.round(v));}

// ── Booking ──
// Add `amt` to a platform's saved month docs from (m,y) to last month, and
// set this month's to the investments' live total.
function _invBumpDocs(pKey,amt,m,y,subs){
  const n=appNow(),cm=n.getMonth()+1,cy=n.getFullYear();
  let mm=m,yy=y;
  while(yy<cy||(yy===cy&&mm<cm)){
    const d=cGet(CK.inv(mm,yy));
    if(d&&d[pKey]!=null){
      const v=Math.max(0,_sbNum(d[pKey])+amt);
      cSet(CK.inv(mm,yy),{...d,[pKey]:v});
      if(db)db.collection('investments').doc(sid(mm,yy)).set({[pKey]:v,month:mm,year:yy},{merge:true}).catch(e=>console.warn('investments write failed (interest)',e));
    }
    if(++mm>12){mm=1;yy++;}
  }
  const inv={...(cGet(CK.inv(cm,cy))||{}),month:cm,year:cy};
  inv[pKey]=subs.reduce((s,sb)=>s+(Number(sb.principal)||0),0);
  cSet(CK.inv(cm,cy),inv);
  if(S.cashMonth===cm&&S.cashYear===cy)S.investments=inv;
  if(db)db.collection('investments').doc(sid(cm,cy)).set(inv,{merge:true}).catch(e=>console.warn('investments write failed (interest)',e));
}
// Books `amount` (account currency) of interest on `key`, dated `date`, as an
// Interest Income entry and credits the account. opts: notes, fields (extra
// entry fields), per (investment shares), restart (restart the investments'
// accrual on `date`). Returns the income id.
function _bookInterest(key,amount,date,opts){
  const {m,y}=_ymOf(date);
  const name=_interestAcctName(key),isCash=key.startsWith('cash:');
  const usd=isCash&&isUSDCashAccount(name);
  const ref=db.collection('income').doc(),id=ref.id;
  const entry={amount,amtNGN:usd?Math.round(amount*(getFxRates(m,y).USD||1600)):Math.round(amount),currency:usd?'USD':'NGN',
    category:'Interest Income',bank:name,notes:opts.notes||'Interest',date,month:m,year:y,type:'income',source:'interest',intAcct:key,...(opts.fields||{})};
  if(isCash){
    _adjustCash(name,amount,m,y,'interest','',date);
  }else{
    const pKey=key.slice(4),subs=getSubsForPlatform(pKey);
    const per=(opts.per&&opts.per.length)?opts.per:[{id:subs[0]?.id,amount:1}];
    const tot=per.reduce((s,p)=>s+p.amount,0)||1;
    let left=Math.round(amount);
    const shares=per.map((p,i)=>{const a=i===per.length-1?left:Math.round(amount*p.amount/tot);left-=a;return {id:p.id,amount:a};});
    const prev={};
    const updated=subs.map(sb=>{
      const o={...sb},sh=shares.find(s=>s.id===sb.id);
      if(sh)o.principal=(Number(sb.principal)||0)+sh.amount;
      if(opts.restart&&sb.assetClass==='fixed_income'&&_sbNum(sb.rate)){prev[sb.id]=sb.intFrom||'';o.intFrom=date;}
      return o;
    });
    entry.intSubs=shares;
    if(opts.restart)entry.intPrev=prev;
    saveSubsForPlatform(pKey,updated);
    _invBumpDocs(pKey,Math.round(amount),m,y,updated);
    addInvMovement(pKey,Math.round(amount),date,'Interest');
  }
  _placeRecord('inc',{...entry,id},null);
  ref.set({...entry,createdAt:FV.serverTimestamp()}).catch(e=>{console.warn('interest income sync failed — queued',e);oqAdd('income',id,entry,true);});
  _histTouch(m,y);
  return id;
}
// "Record interest": books `amount` dated today and restarts accrual.
function recordInterest(key,amount){
  amount=+amount;
  if(!(amount>0))return false;
  const date=todayStr(),est=_unrealisedFor(key),isCash=key.startsWith('cash:');
  const fields={realised:true};
  if(isCash){
    const name=key.slice(5),meta=getCashInterestMeta();
    fields.intPrevFrom=(meta[name]||{}).intFrom||'';
    meta[name]={...(meta[name]||{}),intFrom:date};
    saveCashInterestMeta(meta);
  }
  _bookInterest(key,amount,date,{notes:`Interest ${est.from?fmtDate(est.from)+' – ':'to '}${fmtDate(date)}`,fields,per:est.per,restart:!isCash});
  return true;
}
// Undo the balance side of a deleted interest entry (a cash account's balance
// is already reversed by the income delete itself).
function _unrecordInterest(inc){
  if(!inc||!inc.intAcct||!(inc.realised||inc.auto))return;
  if(inc.intAcct.startsWith('cash:')){
    if(inc.realised){
      const name=inc.intAcct.slice(5),meta=getCashInterestMeta();
      if(meta[name]){meta[name]={...meta[name],intFrom:inc.intPrevFrom||''};saveCashInterestMeta(meta);}
    }
    return;
  }
  const pKey=inc.intAcct.slice(4);
  const subs=getSubsForPlatform(pKey).map(sb=>{
    const sh=(inc.intSubs||[]).find(s=>s.id===sb.id);
    const out={...sb};
    if(sh)out.principal=Math.max(0,(Number(sb.principal)||0)-sh.amount);
    if(inc.intPrev&&sb.id in inc.intPrev)out.intFrom=inc.intPrev[sb.id];
    return out;
  });
  saveSubsForPlatform(pKey,subs);
  _invBumpDocs(pKey,-Math.round(inc.amount||0),inc.month||appNow().getMonth()+1,inc.year||appNow().getFullYear(),subs);
  const mv=getInvMovements(),i=mv.findIndex(x=>x.platformKey===pKey&&x.date===inc.date&&x.notes==='Interest'&&x.delta===Math.round(inc.amount||0));
  if(i>=0){mv.splice(i,1);cSet(INV_MOVE_KEY,mv);_syncInvConfig();}
  renderInvestments();renderDashboard();
}

// ── Automatic month-end interest ──
// Claim one account-month in a transaction; false if another device (or an
// earlier run) already has it.
async function _intClaim(key,mon,amount){
  const ref=db.collection('appConfig').doc('interestPosts');
  let ok=false;
  await db.runTransaction(async t=>{
    ok=false;
    const s=await t.get(ref);
    const posts=(s.exists&&s.data().posts)||{};
    if(posts[key]&&posts[key][mon]){cSet(INT_POSTS_KEY,posts);return;}
    posts[key]={...(posts[key]||{}),[mon]:{amount,auto:true,postedAt:Date.now()}};
    t.set(ref,{posts,updatedAt:FV.serverTimestamp()},{merge:true});
    cSet(INT_POSTS_KEY,posts);
    ok=true;
  });
  return ok;
}
let _autoIntBusy=false;
async function runAutoInterest(){
  if(!_dbReady()||_autoIntBusy)return;
  _autoIntBusy=true;
  const done=[];
  try{
    const n=appNow(),cur=sid(n.getMonth()+1,n.getFullYear());
    // A cash rate with no start date counts from the 1st of the month it was
    // first seen, so a later month's run doesn't keep moving the start.
    const meta=getCashInterestMeta();let pinned=false;
    getCashAccounts().forEach(nm=>{const ci=meta[nm];if(ci&&_sbNum(ci.interestRate)>0&&!ci.startDate&&!ci.intFrom){meta[nm]={...ci,intFrom:cur+'-01'};pinned=true;}});
    if(pinned)saveCashInterestMeta(meta);
    if(cur<=INT_AUTO_FROM)return;
    const accts=_interestAccounts().filter(a=>_intMonthly(a.key));
    if(!accts.length)return;
    const froms=accts.map(a=>a.kind==='cash'?_cashAccrualFrom(a.name):_invUnrealised(a.pKey,null,true).from).filter(Boolean).sort();
    if(froms.length)await Promise.all([_loadLedgers(_monthsFrom(froms[0])),ensureBalanceHistory()]);
    for(const a of accts){
      for(let guard=0;guard<24;guard++){
        const from=a.kind==='cash'?_cashAccrualFrom(a.name):_invUnrealised(a.pKey,null,true).from;
        if(!from)break;
        let mon=from.slice(0,7);if(mon<INT_AUTO_FROM)mon=INT_AUTO_FROM;
        if(mon>=cur)break;
        const [ty,tm]=mon.split('-').map(Number);
        const end=_nextMonthStart(ty,tm),last=_ymd(ty,tm,_daysInMonth(tm,ty));
        const est=a.kind==='cash'?_cashInterest(a.name,end):_invUnrealised(a.pKey,end,true);
        let ok=false;
        try{ok=await _intClaim(a.key,mon,est.amount);}catch(e){console.warn('interest claim failed',e);break;}
        if(!ok)continue;   // already credited elsewhere; the start has moved on
        if(est.amount>0){
          const id=_bookInterest(a.key,est.amount,last,{
            notes:`${MONTHS[tm-1]} ${ty} interest${est.from<_ymd(ty,tm,1)?` (since ${fmtDate(est.from)})`:''}`,
            fields:{auto:true},per:est.per});
          const posts=getInterestPosts();
          if(posts[a.key]&&posts[a.key][mon]){posts[a.key][mon].incomeId=id;saveInterestPosts(posts);}
          done.push(`${a.name} ${_fmtAcctAmt(a.key,est.amount)}`);
        }
      }
    }
  }catch(e){console.warn('automatic interest failed',e);}
  finally{_autoIntBusy=false;}
  if(done.length){
    toast(`Interest added: ${done.join(' · ')}`);
    renderDashboard();renderIncome();renderCashPage();renderInvestments();renderExpenses();
  }
}

// ── Close a month early (v4.7.9) ──
// "Close September" on, say, 29 Sept: profile.closedThrough='2026-09' moves
// the app clock (appNow) to 1 Oct, so the month-end work runs now (interest
// booked on 30 Sept, bills due by 1 Oct posted, October's rate), new entries
// default to 1 Oct and every page opens on October. Until the real 1 Oct it
// can be reopened, which takes back the interest the close booked.
function _monLabel(mon){const [y,m]=mon.split('-').map(Number);return MONTHS[m-1];}
function _nextMonLabel(mon){const [y,m]=mon.split('-').map(Number);return MONTHS[m%12];}
// Every page back to the clock's month (after a close, reopen or boot).
function _clockMoveViews(reload){
  const n=appNow(),m=n.getMonth()+1,y=n.getFullYear();
  S.cashMonth=m;S.cashYear=y;
  if(reload)reloadMonth(m,y);else{S.expMonth=m;S.expYear=y;S.dashMonth=m;S.dashYear=y;}
}
async function closeMonthEarly(){
  if(!_dbReady()){toast('Still loading. Try again in a moment.');return;}
  if(_earlyClosed())return;
  const mon=_realMonth(),cur=_monLabel(mon),nxt=_nextMonLabel(mon);
  const [y,m]=mon.split('-').map(Number);
  if(!confirm(`Close ${cur} now?\n\n• Interest for ${cur} is added to your accounts, dated ${fmtDate(_ymd(y,m,_daysInMonth(m,y)))}.\n• Bills due by 1 ${nxt.slice(0,3)} are posted.\n• SpendWise moves to ${nxt}: new entries are dated 1 ${nxt.slice(0,3)}.\n\nYou can reopen ${cur} until it really ends.`))return;
  saveProfile({closedThrough:mon});
  _clockMoveViews(true);
  renderAll();
  toast(`${cur} closed. You're now in ${nxt}.`);
  await runAutoInterest();
  runAutoRecurring();
  fxAutoUpdate();
}
async function reopenMonth(){
  if(!_earlyClosed()||!_dbReady())return;
  const mon=_closedThrough(),cur=_monLabel(mon),nxt=_nextMonLabel(mon);
  if(!confirm(`Reopen ${cur}?\n\nThe interest added when you closed it is taken back (it's added again when you close ${cur} or when the month ends). Bills already posted for 1 ${nxt.slice(0,3)} stay. New entries are dated today again.`))return;
  const posts=getInterestPosts();let changed=false;
  for(const key of Object.keys(posts)){
    const p=posts[key]&&posts[key][mon];
    if(!p||!p.auto)continue;
    if(p.incomeId)await _removeInterestEntry(p.incomeId,mon);
    delete posts[key][mon];changed=true;
  }
  if(changed)saveInterestPosts(posts);
  saveProfile({closedThrough:''});
  _clockMoveViews(true);
  renderAll();renderInvestments();
  toast(`${cur} reopened.`);
}
// Remove one automatic interest entry: the income record, and the balance it
// added (a cash account's through the ledger; an investment's via _unrecordInterest).
async function _removeInterestEntry(id,mon){
  const [y,m]=mon.split('-').map(Number);
  let inc=(cGet(CK.inc(m,y))||[]).find(i=>i.id===id)||(S.income||[]).find(i=>i.id===id);
  if(!inc){try{const d=await db.collection('income').doc(id).get();if(d.exists)inc={id,...d.data()};}catch(e){}}
  if(!inc)return;
  const c=cGet(CK.inc(m,y));if(Array.isArray(c))cSet(CK.inc(m,y),c.filter(i=>i.id!==id));
  if(S.expMonth===m&&S.expYear===y){S.income=(S.income||[]).filter(i=>i.id!==id);}
  if(inc.intAcct&&inc.intAcct.startsWith('cash:')&&inc.amount)_adjustCash(inc.bank,-inc.amount,m,y,'income-delete','',inc.date);
  else _unrecordInterest(inc);
  _histTouch(m,y);
  try{await db.collection('income').doc(id).delete();}catch(e){console.warn('interest entry delete failed',e);}
}
// Saving an entry dated in a month that was closed early: offer the 1st of
// the next month instead (OK), or keep the date (Cancel).
function _checkClosedDate(){
  if(!_earlyClosed())return;
  const el=document.getElementById('e-date');if(!el||!el.value)return;
  const mon=_closedThrough();
  if(el.value.slice(0,7)>mon)return;
  if(el.value.slice(0,7)<mon)return; // older months: back-dating as usual
  const first=todayStr();
  if(confirm(`${_monLabel(mon)} is closed. Post this on ${fmtDate(first)} instead?\n\nOK: ${fmtDate(first)}\nCancel: keep ${fmtDate(el.value)}`))el.value=first;
}
// Home card: in a month's last week, offer to close it; while closed early, offer to reopen.
function _closeMonthCard(){
  if(_earlyClosed()){
    const mon=_closedThrough();
    return `<div class="exp-card close-mo-card"><span>${_monLabel(mon)} is closed. You're in ${_nextMonLabel(mon)}.</span><button class="btn btn-g btn-sm" onclick="reopenMonth()">Reopen ${_monLabel(mon)}</button></div>`;
  }
  const n=new Date();
  if(_daysInMonth(n.getMonth()+1,n.getFullYear())-n.getDate()>6)return '';
  const cur=MONTHS[n.getMonth()];
  return `<div class="exp-card close-mo-card"><span>Done with ${cur}? Close it now and start ${MONTHS[(n.getMonth()+1)%12]}.</span><button class="btn btn-p btn-sm" onclick="closeMonthEarly()">Close ${cur}</button></div>`;
}

// ── Record interest window ──
let _intKey=null;
function openRecordInterest(key){
  const u=_unrealisedFor(key),name=_interestAcctName(key);
  _intKey=key;
  const usd=key.startsWith('cash:')&&isUSDCashAccount(name);
  document.getElementById('int-title').textContent=`Record interest — ${name}`;
  document.getElementById('int-desc').innerHTML=(u.amount>0
    ?`At ${u.rate}% a year on what ${esc(name)} actually held each day, it has earned about <b>${_fmtAcctAmt(key,u.amount)}</b> since ${fmtDate(u.from)}. If your statement shows a different figure, enter that instead.<br><br>This adds it to ${esc(name)}'s balance and records it as Interest Income for today.`
    :`No interest is estimated since ${u.from?fmtDate(u.from):'the start date'}. You can still enter the amount from your statement.`)
    +(_intMonthly(key)?`<br><br>Interest is also added automatically at the end of each month.`:'');
  document.getElementById('int-amt-lbl').textContent=`Interest earned (${usd?'$':'₦'})`;
  const el=document.getElementById('int-amount');
  el.value=u.amount>0?(usd?u.amount.toFixed(2):Math.round(u.amount).toLocaleString()):'';
  openMod('int-modal');
  setTimeout(()=>initNumInputs(document.getElementById('int-modal')),50);
}
function confirmRecordInterest(){
  if(!_intKey){closeMod('int-modal');return;}
  const amt=parseFloat(_evalExpr(document.getElementById('int-amount').value));
  if(!(amt>0)){toast('Enter the interest amount');return;}
  const key=_intKey;
  if(!recordInterest(key,amt)){toast('Could not record interest');return;}
  closeMod('int-modal');_intKey=null;
  haptic([10]);
  toast(`${_interestAcctName(key)} interest recorded · ${_fmtAcctAmt(key,amt)}`);
  renderIncome();renderDashboard();renderCashPage();renderInvestments();
}
// Used by transfers: when the stored balance is short but recorded interest
// would cover it, offer to record the interest first. Returns true if done.
function _offerInterestTopUp(key,bal,amt){
  const u=_unrealisedFor(key);
  if(!(u.amount>0)||bal+u.amount<amt)return false;
  const name=_interestAcctName(key);
  // Daily-compounding interest is already in the account, so just book it.
  if(_intDaily(key))return recordInterest(key,u.amount);
  if(!confirm(`${name} holds ${_fmtAcctAmt(key,bal)} plus about ${_fmtAcctAmt(key,u.amount)} of interest that isn't recorded yet.\n\nRecord ${_fmtAcctAmt(key,u.amount)} as interest income (dated today) and make the transfer?`))return false;
  return recordInterest(key,u.amount);
}
function _renderInterestCard(){
  const el=document.getElementById('inc-interest');if(!el)return;
  const accts=_interestAccounts();
  if(!accts.length){el.innerHTML='';return;}
  _intPrefetch();
  const rows=accts.map(a=>{
    const u=_unrealisedFor(a.key),monthly=_intMonthly(a.key);
    const action=u.amount>0
      ?`<button class="btn btn-p btn-sm" style="padding:5px 11px;font-size:0.62rem" onclick="openRecordInterest('${jsq(a.key)}')">Record ${_fmtAcctAmt(a.key,u.amount)}</button>`
      :`<button class="btn btn-g btn-sm" style="padding:5px 11px;font-size:0.62rem" onclick="openRecordInterest('${jsq(a.key)}')">Record</button>`;
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);gap:8px">
      <div style="min-width:0">
        <div style="font-size:0.74rem;font-weight:600">${esc(a.name)} <span style="font-size:0.54rem;color:var(--text3);text-transform:uppercase;letter-spacing:0.04em">${a.kind==='cash'?'cash':'invest'} · ${a.rate}%/yr</span></div>
        <div style="font-size:0.6rem;color:var(--gold);font-family:var(--mono)">${u.amount>0?`≈${_fmtAcctAmt(a.key,u.amount)} earned since ${fmtDate(u.from)}`:'Nothing earned since last recorded'}</div>
        <div style="font-size:0.56rem;color:var(--text3)">${monthly?'Added automatically at the end of each month':'Has a maturity date: record it when paid'}</div>
      </div>
      <div style="flex-shrink:0;text-align:right">${action}</div>
    </div>`;
  }).join('');
  el.innerHTML=`<div class="card" style="margin-bottom:10px">
    <div class="clabel" style="margin-bottom:2px">Interest</div>
    ${rows}
    <div style="font-size:0.58rem;color:var(--text3);margin-top:8px;line-height:1.5">Interest is worked out on what each account held day by day, from its balance and the money moved in and out. Without a maturity date it's added to the balance on the last day of each month. Record adds what's been earned so far now; you can enter your statement's figure instead.</div>
  </div>`;
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
  }catch(e){_warnLoad("openXfrHistory",e);}
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
    _adjustCash(r.to,-toVal,r.month||m,r.year||y,'Transfer reversed ('+_xfrSideLabel(r.from)+' → '+_xfrSideLabel(r.to)+')',recId,r.date);
  }else{
    if(!_invWithdraw(r.to,toVal,r.month||m,r.year||y)){toast(`Insufficient balance in ${_xfrSideLabel(r.to)} to reverse`);return;}
    addInvMovement(r.to,-toVal,r.date,'Transfer reversed');   // cancels the original movement in the interest history
  }
  // Give back to the FROM side
  if(fromIsCash) _adjustCash(r.from,r.amount,r.month||m,r.year||y,'Transfer reversed ('+_xfrSideLabel(r.from)+' → '+_xfrSideLabel(r.to)+')',recId,r.date);
  else{_invDeposit(r.from,r.amount,r.month||m,r.year||y);addInvMovement(r.from,r.amount,r.date,'Transfer reversed');}
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
  try{await db.collection('transfers').doc(recId).delete();}catch(e){console.warn("transfer record delete failed",e);}
}

async function saveExpense(){
  if(S.saving)return;
  const type=document.getElementById('e-type')?.value||'expense';
  const amt=numVal('e-amt');
  if(!amt||amt<=0){toast('Enter a valid amount');return;}
  _checkClosedDate();             // dated in a month closed early? offer the 1st of the next

  // ── Transfer ──
  if(type==='transfer'){
    const r=_doTransfer({
      kind:_xfrType,
      from:document.getElementById('xfr2-from')?.value,
      to:document.getElementById('xfr2-to')?.value,
      amt,
      date:document.getElementById('e-date').value||todayStr(),
      notes:document.getElementById('e-notes').value||'',
    });
    if(!r.ok){toast(r.msg);return;}
    toast(r.msg);
    haptic([8,40,8]);closeMod('exp-modal');
    renderCashPage();renderInvestments();renderDashboard();
    return;
  }

  // ── Income (new, or an edit opened from the Income list) ──
  if(type==='income'){
    const editId=document.getElementById('e-edit-id').value;
    const _editInc=editId?S.income.find(i=>i.id===editId):null;
    const incBank=document.getElementById('i-bank2')?.value||getCashAccounts()[0];
    if(!incBank){toast('Add a bank account first (Accounts → Cash)');return;}
    const incIsUSD=isUSDCashAccount(incBank);
    const incDateVal=document.getElementById('e-date').value||todayStr();
    const _idp=incDateVal.split('-');const incTxM=parseInt(_idp[1]),incTxY=parseInt(_idp[0]);
    const incFxRates=getFxRates(incTxM,incTxY);
    const incAmtNGN=incIsUSD?Math.round(amt*incFxRates.USD):amt;
    const data={amount:amt,amtNGN:incAmtNGN,currency:incIsUSD?'USD':'NGN',category:document.getElementById('i-cat2')?.value||'Other',bank:incBank,notes:document.getElementById('e-notes').value,date:incDateVal,month:incTxM,year:incTxY,type:'income'};
    const freq=document.getElementById('e-recur')?.value;
    if(freq&&!editId)_addRecurring({payee:data.category,amount:amt,incCat:data.category,bank:data.bank,notes:data.notes,frequency:freq,type:'income',date:data.date});

    // Apply locally + adjust cash right away — instant no matter how poor the
    // connection is. The doc ID is generated client-side (no network round-trip);
    // the actual write is fired in the background below and never awaited here.
    const ref=editId?db.collection('income').doc(editId):db.collection('income').doc();
    if(_editInc){
      const oB=_editInc.bank||'',oA=_editInc.amount||0,oM=_editInc.month||incTxM,oY=_editInc.year||incTxY;
      if(oB===incBank&&oM===incTxM&&oY===incTxY){if(amt!==oA)_adjustCash(incBank,amt-oA,incTxM,incTxY,'income-edit','',incDateVal);}
      else{if(oB&&oA)_adjustCash(oB,-oA,oM,oY,'income-edit-reverse','',_editInc.date);_adjustCash(incBank,amt,incTxM,incTxY,'income-edit','',incDateVal);}
    }else _adjustCash(incBank, amt, incTxM, incTxY, 'income', '', incDateVal);
    _placeRecord('inc',{...(_editInc||{}),...data,id:ref.id},_editInc);
    const _otherMonth=(incTxM!==S.expMonth||incTxY!==S.expYear)?` · filed under ${MONTHS[incTxM-1]} ${incTxY}`:'';
    closeMod('exp-modal');toast(`${_editInc?'Income updated':'Income recorded'} · ${incBank} updated${_otherMonth}`);haptic([8,40,8]);renderDashboard();renderCashPage();renderIncome();

    // Sync to Firestore in the background. Never awaited, so a slow or flaky
    // connection can't stall the save; Firestore's own offline persistence
    // carries the write through automatically.
    setSyncStatus('syncing');
    (_editInc?ref.update(data):ref.set({...data,createdAt:FV.serverTimestamp()}))
      .then(()=>setSyncStatus('synced'))
      .catch(e=>{
        console.warn('[income] background save failed — queued for retry',e);
        oqAdd('income',ref.id,data,true);
        toast('Sync issue — will retry automatically');
      });
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
    saveCustomLines();
  }
  // The placeholder must never be stored as a real item (it leaked into ~10
  // records before v4.6.1).
  // An old record with no item may be saved as it is (see openEditExp).
  const _allowEmpty=!!document.getElementById('e-edit-id').value&&document.getElementById('e-payee-sel')?.dataset.allowEmpty==='1';
  if(payee==='-- Select --'||(!payee&&!_allowEmpty)){toast('Choose what it was spent on, or pick “+ Add new”');document.getElementById('e-payee-sel')?.focus();return;}
  const expBank=document.getElementById('e-bank').value;
  const expIsUSD=isUSDCashAccount(expBank);
  const expDateVal=document.getElementById('e-date').value||todayStr();
  const _edp=expDateVal.split('-');const expTxM=parseInt(_edp[1]),expTxY=parseInt(_edp[0]);
  const expFxRates=getFxRates(expTxM,expTxY);
  // A foreign-currency price paid from a naira account (e.g. a $6.93
  // subscription on a naira card): convert at that month's rate. The bank is
  // debited in naira; the original price is kept in `fx` for display.
  const entryCur=expIsUSD?'USD':(document.getElementById('e-cur')?.value||'NGN');
  const fxOrig=(!expIsUSD&&entryCur!=='NGN')?{amount:amt,currency:entryCur,rate:expFxRates[entryCur]||0}:null;
  if(fxOrig&&!fxOrig.rate){toast(`No ${entryCur} rate for that month. Add one in Settings → Data → Advanced → Exchange Rates.`);return;}
  const amtB=fxOrig?Math.round(amt*fxOrig.rate):amt; // in the bank's own currency
  // Duplicate guard — same payee + amount + date is almost always a double-tap
  if(!document.getElementById('e-edit-id').value){
    const _dupDate=document.getElementById('e-date').value||todayStr();
    const _ddp=_dupDate.split('-');const _ddm=parseInt(_ddp[1]),_ddy=parseInt(_ddp[0]);
    const _pool=(_ddm===S.expMonth&&_ddy===S.expYear)?S.txns:(cGet(CK.txns(_ddm,_ddy))||[]);
    const _dupBank=document.getElementById('e-bank').value;
    const _dup=_pool.find(t=>t.payee===payee&&t.amount===amtB&&t.date===_dupDate);
    if(_dup&&!confirm(`Possible duplicate: "${payee}" for ${isUSDCashAccount(_dupBank)?'$'+amtB:fN(amtB)} is already recorded on ${fmtDate(_dupDate)}.\n\nSave anyway?`))return;
  }
  const editId=document.getElementById('e-edit-id').value;
  const freq=document.getElementById('e-recur')?.value;
  const amtNGN=expIsUSD?Math.round(amtB*expFxRates.USD):amtB;
  const data={amount:amtB,amtNGN,fx:fxOrig,currency:expIsUSD?'USD':'NGN',category:document.getElementById('e-cat').value,bank:expBank,payee,notes:document.getElementById('e-notes').value,date:expDateVal,month:expTxM,year:expTxY,type:'expense'};
  if(freq&&!editId)_addRecurring({payee,amount:amtB,category:data.category,bank:data.bank,notes:data.notes,frequency:freq,type:'expense',date:data.date});
  const _editTx=editId?S.txns.find(t=>t.id===editId):null;
  // Doc ref generated client-side (no network round-trip) so the id is known
  // immediately, whether this is a new doc or an existing one being edited.
  const docRef=editId?db.collection('transactions').doc(editId):db.collection('transactions').doc();

  // Apply locally + adjust cash right away — instant no matter how poor the
  // connection is. The actual Firestore write happens in the background below.
  if(editId){
    // Same bank and month: one net change. Otherwise reverse the old debit in
    // its own month, then debit the new bank in the new month.
    const _eOldBank=_editTx?.bank||'', _eOldAmt=_editTx?.amount||0;
    const oM=_editTx?.month||expTxM, oY=_editTx?.year||expTxY;
    if(_eOldBank===data.bank&&_eOldBank&&oM===expTxM&&oY===expTxY){
      const _net=_eOldAmt-amtB; // positive = expense reduced, negative = expense increased
      if(_net!==0) _adjustCash(data.bank, _net, expTxM, expTxY, 'expense-edit', '', expDateVal);
    }else{
      if(_eOldBank&&_eOldAmt) _adjustCash(_eOldBank, _eOldAmt, oM, oY, 'expense-edit-reverse', '', _editTx.date);
      if(data.bank) _adjustCash(data.bank, -amtB, expTxM, expTxY, 'expense-edit', '', expDateVal);
    }
  } else {
    if(data.bank) _adjustCash(data.bank, -amtB, expTxM, expTxY, 'expense', '', expDateVal);  // deduct
  }
  _placeRecord('txn',{...(_editTx||{}),...data,id:docRef.id},_editTx);
  const _otherMonth=(expTxM!==S.expMonth||expTxY!==S.expYear)?` · filed under ${MONTHS[expTxM-1]} ${expTxY}`:'';
  closeMod('exp-modal');const _ep=document.getElementById('e-payee-emoji');if(_ep)_ep.textContent='📦';toast((editId?'Updated':'Saved')+_otherMonth);haptic([8,40,8]);renderExpenses();renderDashboard();

  // Sync to Firestore in the background. Never awaited, so a slow or flaky
  // connection can't stall the save; Firestore's own offline persistence
  // carries the write through automatically. The offline queue below is a
  // fallback for genuine failures (not just a slow write).
  setSyncStatus('syncing');
  const _write=editId?docRef.update(data):docRef.set({...data,createdAt:FV.serverTimestamp()});
  _write.then(()=>setSyncStatus('synced')).catch(e=>{
    console.warn('[expense] background save failed — queued for retry',e);
    oqAdd('transactions',docRef.id,data,true);
    toast('Sync issue — will retry automatically');
  });
}
// File a new or edited record under its own month. S.txns / S.income only
// ever hold the month on screen, so a record dated in another month goes to
// that month's cache instead (and leaves this one if an edit moved it). A
// month that has never been loaded on this device is left alone: it is read
// in full from the database when it's opened.
function _placeRecord(kind,rec,oldRec){
  const list=kind==='inc'?'income':'txns', key=kind==='inc'?CK.inc:CK.txns;
  const vm=S.expMonth,vy=S.expYear;
  const inView=(m,y)=>m===vm&&y===vy;
  if(oldRec&&!inView(oldRec.month,oldRec.year)){
    const c=cGet(key(oldRec.month,oldRec.year));
    if(Array.isArray(c))cSet(key(oldRec.month,oldRec.year),c.filter(t=>t.id!==rec.id));
  }
  S[list]=(S[list]||[]).filter(t=>t.id!==rec.id);
  if(inView(rec.month,rec.year))S[list].unshift(rec);
  else{
    const c=cGet(key(rec.month,rec.year));
    if(Array.isArray(c)){c.unshift(rec);cSet(key(rec.month,rec.year),c.filter((t,i,a)=>a.findIndex(x=>x.id===t.id)===i));}
  }
  cSet(key(vm,vy),S[list]);
  _histTouch(rec.month,rec.year);
  if(oldRec&&(oldRec.month!==rec.month||oldRec.year!==rec.year))_histTouch(oldRec.month,oldRec.year);
}
function delExpense(id){
  const idx=S.txns.findIndex(t=>t.id===id);
  const tx=idx>=0?S.txns[idx]:null;
  if(!tx)return;
  // Optimistically remove from local state immediately
  S.txns.splice(idx,1);
  cSet(CK.txns(S.expMonth,S.expYear),S.txns);
  _histTouch(S.expMonth,S.expYear);
  // Restore cash balance immediately — to the transaction's own month bucket
  if(tx.bank&&tx.amount) _adjustCash(tx.bank, tx.amount, tx.month||S.expMonth, tx.year||S.expYear, 'expense-delete', '', tx.date);
  renderExpenses();renderDashboard();
  haptic([6]);
  const rollback=()=>{
    // Back into its own month, even if another month is on screen by now.
    _placeRecord('txn',{month:S.expMonth,year:S.expYear,...tx},null);
    if(tx.bank&&tx.amount) _adjustCash(tx.bank, -tx.amount, tx.month||S.expMonth, tx.year||S.expYear, 'expense-delete-undo', '', tx.date);
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
function updateExpAmtLabel(){
  const bank=document.getElementById(typeof _txnType!=='undefined'&&_txnType==='income'?'i-bank2':'e-bank')?.value||'';
  const usdBank=isUSDCashAccount(bank);
  const curSel=document.getElementById('e-cur');
  // The currency picker is for expenses paid from a naira account; a USD
  // account is always in dollars.
  const showCur=!usdBank&&(typeof _txnType==='undefined'||_txnType==='expense');
  if(curSel){curSel.style.display=showCur?'':'none';if(!showCur)curSel.value='NGN';}
  const cur=usdBank?'USD':(curSel?.value||'NGN');
  const lbl=document.getElementById('e-amt-label');
  if(lbl) lbl.textContent=`Amount (${{NGN:'₦',USD:'$',GBP:'£'}[cur]})`;
  updateExpFxHint();
}
// "≈ ₦11,088 at ₦1,600/$" under the amount when the price is in $ or £.
function updateExpFxHint(){
  const h=document.getElementById('e-fx-hint');if(!h)return;
  const cur=document.getElementById('e-cur')?.value||'NGN';
  const bank=document.getElementById('e-bank')?.value||'';
  if(cur==='NGN'||isUSDCashAccount(bank)||(typeof _txnType!=='undefined'&&_txnType!=='expense')){h.textContent='';return;}
  const d=(document.getElementById('e-date')?.value||todayStr()).split('-');
  const rate=getFxRates(+d[1],+d[0])[cur]||0;
  const v=numVal('e-amt');
  const sym=cur==='USD'?'$':'£';
  h.textContent=rate?(v>0?`≈ ${fN(Math.round(v*rate))} at ${fN(rate)}/${sym}, taken from your naira account`:`Converted at ${fN(rate)}/${sym} for that month`):`No ${cur} rate for that month (Settings → Data → Advanced)`;
}
// Naira value of an expense record, for totals. USD-account expenses store
// dollars in `amount` and the naira value in `amtNGN`; everything else is
// already naira. Balances use `amount` (the account's own currency).
function txNGN(t){
  if(!t)return 0;
  const a=+t.amount||0;
  if(!t.currency||t.currency==='NGN')return a;
  if(t.amtNGN!=null&&!isNaN(+t.amtNGN))return +t.amtNGN;
  const r=getFxRates(t.month||S.expMonth,t.year||S.expYear)[t.currency];
  return r?Math.round(a*r):a;
}
// Small "($6.93)" note beside a naira figure when the price was in $ or £.
function txFxNote(t){
  if(!t)return'';
  if(t.fx&&t.fx.amount)return`<span class="fx-note">(${t.fx.currency==='GBP'?'£':'$'}${(+t.fx.amount).toLocaleString('en-US',{maximumFractionDigits:2})})</span>`;
  if(t.currency==='USD')return`<span class="fx-note">($${(+t.amount||0).toLocaleString('en-US',{maximumFractionDigits:2})})</span>`;
  return'';
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
  const inv=_getInvData();
  const cur=S.dashCurrency,m=S.cashMonth,y=S.cashYear;
  // Sub balances are a live current-month snapshot, so a past month is READ-ONLY:
  // its figures come from that month's saved doc and the edit affordances are hidden.
  const live=_invIsLiveMonth(m,y);
  const total=platformsFor(inv).reduce((acc,p)=>acc+invBalanceFor(p.key,m,y,inv),0);
  const fxRates=getFxRates(m,y);
  const elTotal=document.getElementById('inv-total'+s);
  const elPlatforms=document.getElementById('inv-platforms'+s);
  const elAlloc=document.getElementById('inv-alloc'+s);
  const elAbar=document.getElementById('inv-abar'+s);
  const elLegend=document.getElementById('inv-legend'+s);
  const elEditLabel=document.getElementById('inv-edit-label'+s);
  const elEditFields=document.getElementById('inv-edit-fields'+s);

  // Split platforms into equities and fixed income
  const _invPlats=PLATFORMS;
  const eqPlats=_invPlats.filter(p=>{const meta=getInvPlatformMeta(p.key);return meta.assetClass!=="fixed_income";});
  const fiPlats=_invPlats.filter(p=>{const meta=getInvPlatformMeta(p.key);return meta.assetClass==="fixed_income";});
  const eqTotal=eqPlats.reduce((acc,p)=>acc+invBalanceFor(p.key,m,y,inv),0);
  const fiTotal=fiPlats.reduce((acc,p)=>acc+invBalanceFor(p.key,m,y,inv),0);

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
    // Daily-compounding interest is part of the balance already; month-end
    // interest is shown as earned-so-far until it's added.
    let totalPrincipalNGN=0, totalInterestNGN=0, dailyIntNGN=0, anyMatured=false;
    const subRows=subs.map(sub=>{
      const pNGN=Number(sub.principal)||0;
      totalPrincipalNGN+=pNGN;
      let interest=0,projBal=pNGN,isMatured=false;
      // Unrecorded interest, from the platform's balance history (live month only).
      const _si=live?_subInterest(p.key,sub):null;
      const _daily=sub.compoundType==='daily_compound';
      if(_si){interest=_si.amount;projBal=pNGN+(_daily?interest:0);isMatured=_si.matured;}
      totalInterestNGN+=interest;
      if(_daily)dailyIntNGN+=interest;
      if(isMatured) anyMatured=true;

      // Use fNum (no ₦ prefix) since dispCcy is prepended separately
      const dispPrincipal=isUSD?(pNGN/fxRate).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):fNum(pNGN);
      const dispTotal=isUSD?((projBal/fxRate).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})):fNum(Math.round(projBal));
      const dispCcy=isUSD?'$':isGBP?'£':'₦';
      const rateTag=sub.assetClass==='fixed_income'&&sub.rate?`<span class="int-badge">${sub.rate}%</span>`:'';
      const matTag=sub.maturityDate?`<span style="font-size:0.58rem;color:${isMatured?'var(--red)':'var(--text3)'}"> · ${isMatured?'Matured':'Matures'} ${fmtDate(sub.maturityDate)}</span>`:'';
      const intLine=interest>0?`<span style="font-size:0.6rem;color:var(--gold);font-family:var(--mono);margin-left:4px">(+${dispCcy}${isUSD?(interest/fxRate).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):fNum(Math.round(interest))})</span>`:'';

      const recBtn=live&&interest>=1
        ?`<button onclick="event.stopPropagation();openRecordInterest('inv:${jsq(p.key)}')" style="font-size:0.6rem;padding:2px 8px;border-radius:3px;background:rgba(245,180,40,0.12);border:1px solid rgba(245,180,40,0.35);color:var(--gold);cursor:pointer;margin-right:6px">Record interest</button>`
        :'';
      const liqBtn=sub.assetClass==='fixed_income'&&pNGN>0
        ?`<div style="margin-top:5px;text-align:right">${recBtn}<button onclick="event.stopPropagation();openLiqModal('${p.key}','${sub.id}')" style="font-size:0.6rem;padding:2px 8px;border-radius:3px;background:rgba(255,80,80,0.12);border:1px solid rgba(255,80,80,0.3);color:var(--red);cursor:pointer">Liquidate</button></div>`
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
    const platformNGN=effectivePrincipalNGN+dailyIntNGN;
    const _monthIntNGN=totalInterestNGN-dailyIntNGN;
    const _fmtInt=v=>isUSD?'$'+(v/fxRate).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):fN(Math.round(v));
    const _n=appNow(),_lastDay=_ymd(_n.getFullYear(),_n.getMonth()+1,_daysInMonth(_n.getMonth()+1,_n.getFullYear()));
    const intNote=[dailyIntNGN>0?`incl. +${_fmtInt(dailyIntNGN)} interest`:'',_monthIntNGN>0?`+${_fmtInt(_monthIntNGN)} earned this month, added ${fmtDate(_lastDay)}`:''].filter(Boolean).join(' · ');
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
            <div class="ig" style="margin-bottom:0"><label class="ilabel">Interest is added</label><select class="sfield" id="inv-sub-ct-${p.key}-${sub.id}${s}" style="font-size:0.75rem;padding:6px 8px" onchange="toggleSubFIFields('${p.key}','${sub.id}','${s}')">
              <option value="daily_accrual"${(sub.compoundType||'daily_accrual')==='daily_accrual'?' selected':''}>End of each month</option>
              <option value="daily_compound"${sub.compoundType==='daily_compound'?' selected':''}>Every day (compounds)</option>
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

    const editSection=!live?"":`<div id="inv-edit-panel-${p.key}${s}" onclick="event.stopPropagation()" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
      <div style="font-size:0.68rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px">Edit ${esc(p.label)}</div>
      <div style="margin-bottom:8px;display:flex;align-items:center;gap:8px"><span class="ilabel" style="font-size:0.65rem;margin:0;flex:1">Logo</span><button class="btn btn-g btn-sm" style="padding:3px 8px;font-size:0.62rem" onclick="pickLogo('platform','${p.key}')">Upload a logo</button>${p.logo?`<button class="btn btn-g btn-sm" style="padding:3px 8px;font-size:0.62rem" onclick="updatePlatLogo('${p.key}','');renderInvestments()">↺ Standard</button>`:''}</div>
      <div id="inv-sub-list-${p.key}${s}">${editPanels}</div>
      ${addSubBtn}
      <button class="txi-del" onclick="removePlatform('${p.key}')" style="margin-top:10px;width:100%;text-align:center;padding:4px;font-size:0.65rem;color:var(--text3)">Remove platform</button>
    </div>`;

    return`<div class="card" style="margin-bottom:8px;${live?"cursor:pointer":""}" ${live?`onclick="toggleInvEdit('${p.key}','${s}')"`:""}>
      <div style="display:flex;align-items:center;gap:10px">
        <div id="inv-logo-th-${p.key}${s}" style="flex-shrink:0">${platformLogoEl(p.key,p.color,26)}</div>
        <div style="flex:1;min-width:0">
          <div class="pname">${p.label}${badge}${intBadge}${maturedBadge}${subCount}</div>
          <div class="ppct">${pct}%</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div class="pval" style="color:${platformNGN?p.color:'var(--text3)'}">${platformNGN?maskIf('inv-page',dispMainVal):'—'}</div>
          ${intNote&&!_isHidden('inv-page')?`<div style="font-size:0.58rem;color:var(--gold);font-family:var(--mono)${live?`;cursor:pointer" onclick="event.stopPropagation();openRecordInterest('inv:${jsq(p.key)}')" title="Record this interest now`:``}">${intNote}</div>`:''}
          <div onclick="event.stopPropagation();drillDownInvPlatform('${p.key}')" style="font-size:0.6rem;color:var(--text3);margin-top:2px;cursor:pointer">Activity ›</div>
        </div>
      </div>
      ${subs.length>0?`<div id="inv-sub-display-${p.key}${s}" style="display:none;margin-top:4px">${subRows.map(r=>r.html).join('')}</div>`:''}
      ${editSection}
    </div>`;
  }

  if(elPlatforms){
    let html='';
    if(!live){
      const n=appNow();
      html+=`<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--rsm);padding:9px 11px;margin-bottom:10px;font-size:0.66rem;color:var(--text2);line-height:1.5">
        Viewing <strong>${MONTHS[m-1]} ${y}</strong> — these are that month's saved balances.
        Investment balances can only be edited for the current month.
        <button class="btn btn-g btn-sm" style="margin-top:7px;font-size:0.62rem;padding:4px 9px" onclick="changeCashMonth(${n.getMonth()+1},${n.getFullYear()})">Go to ${MONTHS[n.getMonth()]} ${n.getFullYear()}</button>
      </div>`;
    }
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
  if(elEditFields && !live){ elEditFields.innerHTML=""; }   // no data entry for past months
  if(elEditFields && live){
    // Add Platform section only — per-platform edit is now inline in each row
    elEditFields.innerHTML=`
      <div class="card" style="margin-top:4px">
        <button class="btn btn-inc btn-full" onclick="suOpenPicker('platform')">+ Add investment platforms</button>
      </div>`;
  }
}
function toggleInvEdit(pKey, suffix){
  if(!_invIsLiveMonth(S.cashMonth,S.cashYear)){toast("Switch to the current month to edit investments");return;}
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
    saveBtn.style.display=anyOpen.some(el=>el.style.display!=="none")?"block":"none";
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
  if(!_invIsLiveMonth(S.cashMonth,S.cashYear)){toast("Switch to the current month to edit investments");return;}
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
  if(!_invIsLiveMonth(S.cashMonth,S.cashYear)){toast("Switch to the current month to edit investments");return;}
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
  if(!_invIsLiveMonth(S.cashMonth,S.cashYear)){toast("Switch to the current month to edit investments");return;}
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
  // Source account applies to new money only — a gain/loss isn't funded from a
  // bank. Optional: leaving it on "None" records the inflow without touching cash.
  const srcWrap=document.getElementById('inv-adj-src-wrap');
  const srcSel=document.getElementById('inv-adj-src');
  if(srcWrap) srcWrap.style.display=(type==='inflow')?'block':'none';
  if(srcSel){
    // false → no built-in blank option; we supply our own "None" wording.
    srcSel.innerHTML=`<option value="">— None / Don't deduct —</option>`+cashOptsWithBal(false);
    srcSel.value='';
  }
  openMod('inv-adj-modal');
  setTimeout(()=>initNumInputs(document.getElementById('inv-adj-modal')),50);
}

async function applyInvAdjust(){
  if(!_adjPKey||!_adjSubId||!_adjType) return;
  const rawAmt=_evalExpr(document.getElementById('inv-adj-amount').value);
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
  if(db) db.collection('investments').doc(sid(m,y)).set(invData,{merge:true}).catch(e=>console.warn("investments write failed (adjustment)",e));

  // Optional funding account (inflow only): move the money out of that account
  // so the cash side stays honest, and log it like a Cash → Investment transfer
  // (transfer record + accrual movement) so it shows in the platform's history.
  let srcAcct='';
  if(_adjType==='inflow'){
    srcAcct=document.getElementById('inv-adj-src')?.value||'';
    if(srcAcct){
      const usdRate=getFxRates(m,y).USD||1600;
      const posNGN=Math.abs(amtNGN);
      // USD cash accounts hold raw dollars; NGN accounts hold naira.
      const deduct=isUSDCashAccount(srcAcct)
        ? (isUSD?Math.abs(amt):posNGN/usdRate)
        : posNGN;
      const d=new Date(date);const dm=d.getMonth()+1,dy=d.getFullYear();
      _adjustCash(srcAcct,-deduct,dm,dy,'inv-inflow',_adjPKey);
      _saveXfrRecord(srcAcct,_adjPKey,deduct,date,dm,dy,notes,posNGN,'cash-inv');
      if(typeof addInvMovement==='function') addInvMovement(_adjPKey,posNGN,date,notes);
    }
  }

  const sign=amtNGN>=0?'+':'';
  const dispAmt=isUSD?`${sign}$${Math.abs(amt).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`:`${sign}₦${fNum(Math.abs(amtNGN))}`;
  const label=_adjType==='inflow'?'Inflow':amtNGN>=0?'Gain':'Loss';
  closeMod('inv-adj-modal');
  toast(`${label}: ${dispAmt} applied${srcAcct?' · '+srcAcct+' debited':''}`);
  haptic([8,40,8]);
  renderInvestments();renderDashboard();renderCashPage();
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
  if(!_invIsLiveMonth(S.cashMonth,S.cashYear)){toast("Switch to the current month to edit investments");return;}
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
    const _si=_subInterest(pKey,sub);
    if(_si)projBalNGN=pNGN+_si.amount;
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
  const data={amount:amtNGN,amtNGN,currency:'NGN',category:'Interest Income',bank,notes:`${label} — fixed income payout`,date,month:m,year:y,type:'income',source:'liquidation-interest'};
  const ref=db.collection('income').doc();
  _placeRecord('inc',{...data,id:ref.id},null);
  ref.set({...data,createdAt:FV.serverTimestamp()}).catch(e=>{console.warn('interest income write failed — queued',e);oqAdd('income',ref.id,data,true);});
}
async function confirmLiquidation(){
  if(!_liqPKey||!_liqSubId){closeMod('liq-modal');return;}
  const rawAmt=_evalExpr(document.getElementById('liq-amount').value);
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
  // A partial cash-out only takes what was cashed out; the rest stays invested.
  // (Before v4.7 the whole principal was zeroed whatever the amount.)
  const remaining=Math.max(0,pNGN-amtNGN);
  if(remaining>0&&!confirm(`Cash out ${fN(amtNGN)} and leave ${fN(remaining)} invested in ${sub.label}?`))return;

  subs[subIdx]={...sub,principal:remaining};
  addInvMovement(_liqPKey,-(pNGN-remaining),date,'Cash-out');   // for the interest history
  saveSubsForPlatform(_liqPKey,subs);

  // Recompute and persist platform total
  const m=S.cashMonth,y=S.cashYear;
  const newPlatTotal=subs.reduce((sum,s)=>sum+(Number(s.principal)||0),0);
  const invData={...(cGet(CK.inv(m,y))||S.investments),month:m,year:y};
  invData[_liqPKey]=newPlatTotal;
  S.investments=invData;
  cSet(CK.inv(m,y),invData);
  if(db) db.collection('investments').doc(sid(m,y)).set(invData,{merge:true}).catch(e=>console.warn("investments write failed (liquidation source)",e));

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
    addInvMovement(destPKey,amtNGN,date,'Cash-out in');
    const destTotal=destSubs.reduce((s,sb)=>s+(Number(sb.principal)||0),0);
    invData[destPKey]=destTotal;
    S.investments=invData;
    cSet(CK.inv(m,y),invData);
    if(db) db.collection('investments').doc(sid(m,y)).set(invData,{merge:true}).catch(e=>console.warn("investments write failed (liquidation target)",e));
    const destPlat=PLATFORMS.find(pl=>pl.key===destPKey);
    toast(`₦${fNum(amtNGN)} → ${destPlat?destPlat.label:destPKey}`);
  } else {
    // Liquidate to cash account
    // A dollar account is credited in dollars.
    const _liqCredit=isUSDCashAccount(destVal)?+(amtNGN/(getFxRates(liqM,liqY).USD||1600)).toFixed(2):amtNGN;
    _adjustCash(destVal,_liqCredit,liqM,liqY,'investment-liquidation','',date);
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
        const raw=prinEl?numVal(prinEl):NaN;
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
  _renderInvInto('-2');  // Accounts → Investments
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
      .map(d=>{const doc=d.data();return{year:doc.year,month:doc.month,label:`${MS[(doc.month||1)-1]} '${String(doc.year||2024).slice(2)}`,total:platformsFor(doc).reduce((sum,p)=>sum+(doc[p.key]||0),0)};})
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
  document.getElementById('cash-months').innerHTML=_monthStrip(m,y,'changeCashMonth');
  setTimeout(()=>{const el=document.querySelector('#cash-months .mpill.active');if(el)el.scrollIntoView({inline:'center',block:'nearest'});},0);
  const cash=_withAccrued(S.cash,m,y);   // daily-compounding accounts include today's interest
  const fxR=getFxRates(m,y);
  const total=ACCTS.reduce((s,b)=>{const v=cash[b]||0;return s+(isUSDCashAccount(b)?v*(fxR.USD||1650):v);},0);
  const intMeta=getCashInterestMeta();
  const live=_invIsLiveMonth(m,y);
  const _n=appNow(),_lastDay=_ymd(_n.getFullYear(),_n.getMonth()+1,_daysInMonth(_n.getMonth()+1,_n.getFullYear()));
  if(live)_intPrefetch();
  document.getElementById('cash-summary').innerHTML=`<div class="clabel">Total Cash — ${MONTHS[m-1]} ${y}${eyeBtn('cash-page','renderCashPage')}</div><div class="cval">${total?maskIf('cash-page',fmtCur(Math.round(total),cur,m,y)):'—'}</div><div class="csub">${ACCTS.join(' · ')}</div>`;
  document.getElementById('cash-breakdown').innerHTML=ACCTS.length?ACCTS.map((b,i)=>{
    const val=cash[b]||0,pct=total?Math.round((isUSDCashAccount(b)?val*(fxR.USD||1650):val)/total*100):0;
    const ci=intMeta[b];
    const intInfo=ci&&ci.interestRate?`<span class="int-badge">${ci.interestRate}% p.a.</span>`:'';
    // Interest earned and not yet added, from the account's day-by-day balance.
    const projInt=ci&&ci.interestRate&&live?_cashUnrealised(b).amount:0;
    const _daily=ci&&ci.compoundType==='daily_compound';
    const intProjection=projInt>0.5?`<div style="font-size:0.6rem;color:var(--gold);margin-top:1px;cursor:pointer" onclick="event.stopPropagation();openRecordInterest('cash:${jsq(b)}')" title="Record this interest now">${_daily
      ?`incl. ~${_fmtAcctAmt('cash:'+b,projInt)} interest this month (compounds daily)`
      :ci.maturityDate?`~${_fmtAcctAmt('cash:'+b,projInt)} interest so far, paid at maturity (${fmtDate(ci.maturityDate)})`
      :`+~${_fmtAcctAmt('cash:'+b,projInt)} earned this month, added ${fmtDate(_lastDay)}`}</div>`:'';
    let dispVal;
    if(isUSDCashAccount(b)){
      const ngnEquiv=val*(fxR.USD||1650);
      dispVal=(cur==='NATIVE'||cur==='NGN')?'$'+val.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' ('+fN(ngnEquiv)+')':fmtCur(ngnEquiv,cur,m,y);
    } else {
      dispVal=fmtCur(val,cur,m,y);
    }
    return`<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 0;cursor:pointer;${i<ACCTS.length-1?'border-bottom:1px solid var(--border)':''}" onclick="drillDownAccount('${jsq(b)}')">
      <div style="display:flex;align-items:center;gap:8px;min-width:0">${bankLogoEl(b,26)}<div style="min-width:0"><div style="font-size:0.82rem;font-weight:600">${esc(b)}${intInfo} <span style="font-size:0.6rem;color:var(--text3)">›</span></div><div style="font-size:0.65rem;color:var(--text2);font-family:var(--mono);margin-top:1px">${pct}%</div>${_isHidden('cash-page')?'':intProjection}</div></div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0"><div style="font-family:var(--mono);font-size:0.9rem;color:${val?'var(--blue)':'var(--text3)'}">${val?maskIf('cash-page',dispVal):'—'}</div><button class="acct-edit-btn" title="Edit ${esc(b)}" onclick="event.stopPropagation();openAcctEdit('${jsq(b)}')">✎</button></div>
    </div>`;
  }).join(''):'<div class="empty">No accounts yet. Tap <b>+ Add accounts</b> below.</div>';
}
// ── Edit one account (v4.7.3) ────────────────────────────────────────────
// Replaces the page-wide "Edit balances & accounts" panel: the ✎ beside an
// account (or Edit in its history) opens just that account's balance for the
// month on screen, its interest settings, logo, and removal.
let _acctEditName=null;
function openAcctEdit(name){
  _acctEditName=name;
  const m=S.cashMonth,y=S.cashYear,usd=isUSDCashAccount(name);
  const ci=_cashIntMeta(name),own=!!getCashLogos()[name];
  const bal=(S.cash||{})[name];
  document.getElementById('acct-title').textContent=`Edit ${name}`;
  const firstOfMonth=todayStr().slice(0,8)+'01';
  document.getElementById('acct-body').innerHTML=`
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
      <div id="acct-logo-th">${bankLogoEl(name,34)}</div>
      <div style="flex:1;min-width:0;font-size:0.7rem;color:var(--text2)">${usd?'Held in US dollars':'Held in naira'}</div>
      <button class="btn btn-g btn-sm" style="padding:4px 10px;font-size:0.64rem" onclick="pickLogo('bank','${jsq(name)}')">Logo</button>
      ${own?`<button class="btn btn-g btn-sm" style="padding:4px 10px;font-size:0.64rem" onclick="setCashLogo('${jsq(name)}','');renderCashPage();openAcctEdit('${jsq(name)}')" title="Use the standard logo">↺</button>`:''}
    </div>
    <div class="ig" style="margin-bottom:12px">
      <label class="ilabel">Balance at the end of ${MONTHS[m-1]} ${y} (${usd?'$':'₦'})</label>
      <input class="ifield" type="text" id="acct-bal" inputmode="decimal" value="${bal!=null&&bal!==''?bal:''}" placeholder="0">
      <div style="font-size:0.6rem;color:var(--text3);margin-top:3px">To correct the balance to match your bank. Later months move by the same amount.</div>
    </div>
    <div style="font-size:0.72rem;font-weight:700;margin:4px 0 8px">Interest</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div class="ig" style="margin-bottom:8px"><label class="ilabel">Rate (% a year)</label><input class="ifield" type="text" id="acct-rate" inputmode="decimal" placeholder="None" value="${ci.interestRate||''}"></div>
      <div class="ig" style="margin-bottom:8px"><label class="ilabel">Counts from</label><input class="ifield" type="date" id="acct-start" value="${ci.startDate||(ci.interestRate?'':firstOfMonth)}"></div>
    </div>
    <div class="ig" style="margin-bottom:8px"><label class="ilabel">Interest is added</label><select class="sfield" id="acct-ct">
      <option value="daily_accrual"${ci.compoundType!=='daily_compound'?' selected':''}>At the end of each month</option>
      <option value="daily_compound"${ci.compoundType==='daily_compound'?' selected':''}>Every day (compounds)</option>
    </select></div>
    <div class="ig" style="margin-bottom:6px"><label class="ilabel">Maturity date (optional)</label><input class="ifield" type="date" id="acct-mat" value="${ci.maturityDate||''}"></div>
    <div style="font-size:0.6rem;color:var(--text3);line-height:1.5;margin-bottom:14px">Interest is worked out on what ${esc(name)} held each day, from its balance and the money moved in and out since the date above. <b>Every day</b>: the interest joins the balance daily and earns interest itself, so the balance you see grows each day. <b>End of each month</b>: it's added on the last day of the month. Either way each month's interest is saved as one Interest Income entry on the month's last day. With a maturity date it builds until then instead, and you record it when it's paid.</div>
    <button class="btn btn-p btn-full" style="font-weight:700" onclick="saveAcctEdit()">Save</button>
    <button class="btn btn-g btn-full" style="margin-top:8px" onclick="closeMod('acct-modal');drillDownAccount('${jsq(name)}')">View history</button>
    <button class="btn btn-d btn-full" style="margin-top:14px" onclick="removeCashAccount('${jsq(name)}')">Remove ${esc(name)}</button>`;
  openMod('acct-modal');
  setTimeout(()=>initNumInputs(document.getElementById('acct-modal')),50);
}
async function saveAcctEdit(){
  const name=_acctEditName;if(!name){closeMod('acct-modal');return;}
  const m=S.cashMonth,y=S.cashYear;
  // Interest settings
  const rate=numVal(document.getElementById('acct-rate'));
  const start=document.getElementById('acct-start').value;
  const mat=document.getElementById('acct-mat').value;
  if(mat&&start&&mat<=start){toast('The maturity date must be after the start date');return;}
  const meta=getCashInterestMeta(),old=meta[name]||{};
  const nextMeta=!isNaN(rate)&&rate>0
    ?{interestRate:rate,compoundType:document.getElementById('acct-ct').value||'daily_accrual',...(start?{startDate:start}:{}),...(mat?{maturityDate:mat}:{}),...(old.intFrom?{intFrom:old.intFrom}:{})}
    :{};
  if(JSON.stringify(nextMeta)!==JSON.stringify(old)){meta[name]=nextMeta;saveCashInterestMeta(meta);}
  // Balance correction for the month on screen (moves later months too)
  const raw=document.getElementById('acct-bal').value.trim();
  const prev=Number((S.cash||{})[name])||0;
  const next=raw===''?prev:numVal(document.getElementById('acct-bal'));
  if(isNaN(next)){toast('Enter a valid balance');return;}
  closeMod('acct-modal');
  if(next!==prev){
    const data={...(S.cash||{}),[name]:next,month:m,year:y};
    S.cash=data;cSet(CK.cash(m,y),data);
    _markCashDirty(m,y,name);
    try{
      await db.collection('cashBalances').doc(sid(m,y)).set({[name]:next,month:m,year:y},{merge:true});
      _clearCashDirty(m,y,name);
      _rippleCashForward(name,next-prev,m,y);
    }catch(e){_clearCashDirty(m,y,name);console.warn('balance save failed - will retry',e);_rippleQueueAdd(name,next-prev,m,y);}
  }
  toast(`${name} saved`);haptic([8]);
  renderCashPage();renderDashboard();renderIncome();
}
// Month strip with the previous year at the start and the next year (up to
// this one) at the end, so any month of any year can be reached.
function _monthStrip(m,y,fn){
  const cy=appNow().getFullYear();
  let h=`<div class="mpill mpill-yr" onclick="${fn}(12,${y-1})">‹ ${y-1}</div>`;
  for(let mo=1;mo<=12;mo++)h+=`<div class="mpill ${mo===m?'active':''}" onclick="${fn}(${mo},${y})">${MS[mo-1]}${mo===m&&y!==cy?' '+String(y).slice(2):''}</div>`;
  if(y<cy)h+=`<div class="mpill mpill-yr" onclick="${fn}(1,${y+1})">${y+1} ›</div>`;
  return h;
}
async function changeCashMonth(m,y){
  S.cashMonth=m;if(y)S.cashYear=y;
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
  if(_dbReady()){
    loadCashData(m,S.cashYear).then(()=>{if(S.cashMonth===m)renderCashPage();}).catch(e=>_warnLoad("loadCashData (month switch)",e));
    loadInvData(m,S.cashYear).then(()=>{if(S.cashMonth===m)renderInvestments();}).catch(e=>_warnLoad("loadInvData (month switch)",e));
  }
  startRealtimeListeners();
}
function removeCashAccount(name){
  if(!confirm(`Remove ${name} from your accounts? Its past entries and balances stay in your history.`))return;
  setCashAccounts(getCashAccounts().filter(a=>a!==name));
  closeMod('acct-modal');toast(`${name} removed`);renderCashPage();renderDashboard();
}
// Upload your own logo for an account ('bank') or investment platform: it's
// shrunk to 64px on the device and saved in your settings.
function pickLogo(kind,id){
  const inp=document.createElement('input');inp.type='file';inp.accept='image/*';
  inp.onchange=async()=>{
    const f=inp.files&&inp.files[0];if(!f)return;
    try{
      const url=await _suLogoFromFile(f);
      if(kind==='bank'){setCashLogo(id,url);renderCashPage();}
      else{updatePlatLogo(id,url);renderInvestments();}
      renderDashboard();toast('Logo updated');
    }catch(e){toast(e.message||'Could not use that image');}
  };
  inp.click();
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
  // Each record is one debt; several debts can share an obligor, so group by
  // name. A person with a single debt renders exactly as before.
  const order=[],byName={};
  dbs.forEach((d,idx)=>{
    const k=String(d.name||'—').trim();
    if(!byName[k]){byName[k]={name:k,items:[]};order.push(byName[k]);}
    byName[k].items.push({d,idx});
  });
  _dlist.innerHTML=order.map(g=>g.items.length>1
    ? _debGroupHTML(g,cur,m,y)
    : _debCardHTML(g.items[0].d,g.items[0].idx,cur,m,y,false)).join('');
}
function _debGroupHTML(g,cur,m,y){
  // "Active" = still expected back AND not yet fully repaid.
  const live=g.items.filter(({d})=>d.expectRepayment!==false);
  const active=live.filter(({d})=>(d.paid||0)<(d.amount||0));
  const owed=live.reduce((s,{d})=>s+(d.ngnBalance||0),0);
  const first=g.items[0].d;
  return `<div class="dc" style="padding-bottom:10px">
    <div class="dc-top" style="align-items:center">
      <div><div class="dc-name">${esc(g.name)}</div>
        <div class="dc-sub">${g.items.length} debts · ${active.length} active</div></div>
      <div class="badge ${owed>0?'br':'bg'}">${owed>0?fmtCur(owed,cur,m,y)+' due':'All settled'}</div>
    </div>
    <div style="margin-top:8px;border-left:2px solid var(--border);padding-left:9px">
      ${g.items.map(({d,idx})=>_debCardHTML(d,idx,cur,m,y,true)).join('')}
    </div>
    <button class="btn btn-g btn-sm" style="margin-top:9px" onclick="event.stopPropagation();openAddDebt('${first.id||g.items[0].idx}')">+ Add another debt for ${esc(g.name)}</button>
  </div>`;
}
function _debCardHTML(d,idx,cur,m,y,inGroup){
  const expectRepay=d.expectRepayment!==false;
  const pct=d.amount>0?((d.paid||0)/d.amount)*100:0;
  const settled=pct>=100||!expectRepay;
  const owedDisp=fmtCur(d.ngnBalance||0,cur,m,y);
  const rid=d.id||idx;
  // Inside a group the obligor's name is already in the header, so each row
  // leads with what distinguishes the individual debt instead.
  const title=inGroup
    ? `${esc(d.category||'Loan')} · ${d.currency} ${fNum(d.amount)}`
    : `${esc(d.name)} <span style="font-size:0.62rem;color:var(--text3)">›</span>`;
  const sub=inGroup
    ? `${d.date?fmtDate(d.date):''}${d.notes?' · '+esc(d.notes):''}`
    : `${esc(d.category)} · ${d.currency} ${fNum(d.amount)}${d.date?' · '+fmtDate(d.date):''}`;
  return `<div class="${inGroup?'':'dc'}" style="cursor:pointer;${inGroup?'padding:7px 0;border-bottom:1px solid var(--border);':''}${settled&&expectRepay?'opacity:0.45':''}" onclick="drillDownDebtor('${rid}')">
    <div class="dc-top">
      <div><div class="${inGroup?'dc-sub':'dc-name'}" style="${inGroup?'font-weight:600;color:var(--text)':''}">${title}</div><div class="dc-sub">${sub}</div></div>
      <div class="badge ${!expectRepay?'bgold':settled?'bg':'br'}">${!expectRepay?'Write-off':settled?'Settled':owedDisp+' due'}</div>
    </div>
    ${inGroup?'':`<div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">
      <div style="font-size:0.65rem;color:var(--text2)">Expecting repayment</div>
      <div onclick="event.stopPropagation();toggleRepay('${rid}',${!expectRepay})" style="width:36px;height:20px;border-radius:10px;background:${expectRepay?'var(--accent)':'var(--border2)'};position:relative;cursor:pointer;transition:background 0.2s;flex-shrink:0">
        <div style="position:absolute;top:2px;${expectRepay?'right:2px':'left:2px'};width:16px;height:16px;border-radius:50%;background:${expectRepay?'var(--bg)':'var(--text3)'};transition:all 0.2s"></div>
      </div>
    </div>`}
    ${expectRepay&&!settled?`<div class="prog" style="margin-top:8px"><div class="pf ok" style="width:${Math.min(pct,100)}%"></div></div>`:''}
    ${!inGroup&&d.notes?`<div style="font-size:0.65rem;color:var(--text2);margin-top:5px">${esc(d.notes)}</div>`:''}
    <div style="display:flex;gap:6px;margin-top:9px;flex-wrap:wrap">
      ${expectRepay&&!settled?`<button class="btn btn-g btn-sm" onclick="event.stopPropagation();recordPmt('${rid}',${d.amount},${d.paid||0},${d.rate||DEF_RATES[d.currency]||1})">Record Payment</button>`:''}
      ${inGroup?'':`<button class="btn btn-g btn-sm" onclick="event.stopPropagation();openAddDebt('${rid}')">+ Add Debt</button>`}
      <button class="btn btn-g btn-sm" onclick="event.stopPropagation();openEditDeb('${rid}')">Edit</button>
      <button class="btn btn-d btn-sm" onclick="event.stopPropagation();removeDeb('${rid}')">Remove</button>
    </div>
  </div>`;
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
  if(id&&db){try{await db.collection('debtors').doc(id).update({expectRepayment:newVal});}catch(e){console.warn("debtor expectRepayment update failed",e);}}
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
  if(S.saving) return;const name=document.getElementById('d-name').value.trim();const amt=numVal('d-amt');if(!name||!amt){toast('Name and amount required');return;}
  S.saving=true;const btn=document.getElementById('deb-save');btn.textContent='Saving…';btn.disabled=true;setSyncStatus('syncing');
  const cur=document.getElementById('d-cur').value,paid=numVal('d-paid')||0,rateIn=numVal('d-rate'),rate=isNaN(rateIn)?(DEF_RATES[cur]||1):rateIn,bal=amt-paid,eid=document.getElementById('d-eid').value;
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
      data.createdAt=FV.serverTimestamp();
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
// ── ADD ANOTHER DEBT UNDER THE SAME OBLIGOR ───────────────────────────────
// Each debt is its own record (one Firestore doc) so it carries its own
// balance and payment log; the Debtors list groups records by name. This used
// to fold the new amount into a single running total per person, which made
// per-debt repayment tracking impossible.
function openAddDebt(id){
  const d=S.debtors.find(x=>x.id===id);if(!d){toast('Debtor not found');return;}
  const cashOpts=cashOptsWithBal(true);
  const g=S.debtors.filter(x=>x.name===d.name);
  const gOut=g.reduce((s,x)=>s+((x.amount||0)-(x.paid||0)),0);
  document.getElementById('drill-title').textContent='New debt — '+d.name;
  document.getElementById('drill-body').innerHTML=`
    <div class="csub" style="margin-bottom:10px">${esc(d.name)} currently has ${g.length} debt${g.length===1?'':'s'} · ${d.currency} ${fNum(gOut)} outstanding. This adds a <strong>separate</strong> debt with its own payment tracking.</div>
    <div class="ig"><label class="ilabel">Amount (${d.currency})</label>
      <input class="ifield" type="text" id="ad-amt" placeholder="0" style="font-size:1.1rem;font-family:var(--mono)"></div>
    <div class="ig"><label class="ilabel">Disburse from Account (optional)</label>
      <select class="sfield" id="ad-bank"><option value="">— Don't deduct —</option>${cashOpts}</select></div>
    <div class="ig"><label class="ilabel">Date</label>
      <input class="ifield" type="date" id="ad-date" value="${todayStr()}"></div>
    <div class="ig"><label class="ilabel">Note</label>
      <input class="ifield" type="text" id="ad-note" placeholder="Optional"></div>
    <button class="btn btn-p btn-full" id="ad-save" onclick="_doAddDebt('${id}')">Add debt</button>`;
  openMod('drill-modal');
  setTimeout(()=>initNumInputs(document.getElementById('drill-body')),80);
}
async function _doAddDebt(id){
  const d=S.debtors.find(x=>x.id===id);if(!d)return;
  const add=numVal('ad-amt');
  if(!add||add<=0){toast('Enter a valid amount');return;}
  const bank=document.getElementById('ad-bank')?.value||'';
  const dDate=document.getElementById('ad-date')?.value||todayStr();
  const note=document.getElementById('ad-note')?.value||'';
  const rate=d.rate||DEF_RATES[d.currency]||1;
  const btn=document.getElementById('ad-save');
  if(btn){btn.textContent='Saving…';btn.disabled=true;}
  // A brand-new sibling record inheriting the obligor's name/currency/rate.
  const data={name:d.name,currency:d.currency,amount:add,paid:0,balance:add,rate,
    ngnBalance:add*rate,category:d.category||'Loan',notes:note,date:dDate,
    expectRepayment:true,disbursedFrom:bank||''};
  try{
    const newId=db.collection('debtors').doc().id;
    await db.collection('debtors').doc(newId).set({...data,createdAt:FV.serverTimestamp()});
    S.debtors=[{...data,id:newId},...(S.debtors||[])];
    cSet(CK.debtors,S.debtors);
    if(bank){
      // Mirror the payment-credit currency rules, in the deduction direction
      const isUSDAcct=isUSDCashAccount(bank);
      let delta;
      if(isUSDAcct) delta=(d.currency==='USD')?add:add/rate;
      else delta=(d.currency==='NGN'||!d.currency)?add:add*rate;
      const txD=new Date(dDate);const dm=txD.getMonth()+1,dy=txD.getFullYear();
      _adjustCash(bank,-delta,dm,dy,'debt-add',newId,dDate);
    }
    closeMod('drill-modal');
    toast(`New debt for ${d.name} · ${d.currency} ${fNum(add)}${bank?' · '+bank+' deducted':''}`);
    haptic([8,40,8]);
    await loadDebtors();renderDebtors();renderDashboard();
  }catch(e){toast('Error adding debt');}
  finally{if(btn){btn.textContent='Add debt';btn.disabled=false;}}
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
  const pmt=numVal(pmtEl);
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
      // Routed through _adjustCash (rather than writing the balance directly)
      // so the credit is atomic, ripples into later months, and lands in the
      // cash ledger — which is what makes it show up in the account's history.
      _adjustCash(bankAcct,cashDelta,dm,dy,'debt-payment',id,pmtDate);
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
// Removing a debt can also undo what it did to your banks: the money that
// went out when it was lent, and any repayments credited to a bank.
function _debtCashDelta(d,amt,bank){
  const rate=d.rate||DEF_RATES[d.currency]||1;
  return isUSDCashAccount(bank)?(d.currency==='USD'?amt:amt/rate):((d.currency==='NGN'||!d.currency)?amt:amt*rate);
}
async function removeDeb(id){
  const d=S.debtors.find(x=>x.id===id);if(!d)return;
  if(!confirm(`Remove ${d.name}'s ${d.currency||'NGN'} ${fNum(d.amount)} debt?`)) return;
  const moves=[];
  if(d.disbursedFrom&&d.amount)moves.push({bank:d.disbursedFrom,delta:_debtCashDelta(d,d.amount,d.disbursedFrom),date:d.date});
  (d.pmtLog||[]).forEach(p=>{if(p.creditedTo&&p.amount)moves.push({bank:p.creditedTo,delta:-_debtCashDelta(d,p.amount,p.creditedTo),date:p.date});});
  const undo=moves.length&&confirm(`Also undo its bank movements?\n\n${moves.map(mv=>`${mv.bank}: ${mv.delta>0?'+':'−'}${fNum(Math.abs(mv.delta))}`).join('\n')}\n\nOK = undo them · Cancel = remove the record only`);
  try{
    await db.collection('debtors').doc(id).delete();
    if(undo)moves.forEach(mv=>{const {m,y}=_ymOf(mv.date);_adjustCash(mv.bank,mv.delta,m,y,'debt-remove-reverse',id,mv.date);});
    toast(undo?'Removed · bank balances restored':'Removed');
    await loadDebtors();renderDebtors();renderDashboard();
  }catch(e){toast('Error removing');}
}

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
  const rawAmt=_evalExpr(document.getElementById('ln-amt').value);
  const amt=parseFloat(rawAmt);
  if(!lender||!amt||amt<=0){toast('Lender name and principal amount required');return;}
  S.saving=true;
  const btn=document.getElementById('loan-save');
  btn.textContent='Saving…';btn.disabled=true;setSyncStatus('syncing');
  const cur=document.getElementById('ln-cur').value;
  const fxIn=numVal('ln-fx');
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
    ratePA:numVal('ln-rate-pa')||0,
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
      data.createdAt=FV.serverTimestamp();
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
  const l=S.loans.find(x=>x.id===id);if(!l)return;
  if(!confirm(`Remove the ${l.lender} loan?`)) return;
  const moves=[];
  if(l.disbursedTo&&(l.amtNGN||l.amount))moves.push({bank:l.disbursedTo,delta:-(l.amtNGN||l.amount),date:l.startDate});
  (l.repayLog||[]).forEach(r=>{if(r.account&&r.amount)moves.push({bank:r.account,delta:+r.amount,date:r.date});});
  const undo=moves.length&&confirm(`Also undo its bank movements?\n\n${moves.map(mv=>`${mv.bank}: ${mv.delta>0?'+':'−'}${fNum(Math.abs(mv.delta))}`).join('\n')}\n\nOK = undo them · Cancel = remove the record only`);
  try{
    await db.collection('loans').doc(id).delete();
    if(undo)moves.forEach(mv=>{const {m,y}=_ymOf(mv.date);_adjustCash(mv.bank,mv.delta,m,y,'loan-remove-reverse',id,mv.date);});
    toast(undo?'Loan removed · bank balances restored':'Loan removed');
    await loadLoans();renderLoans();renderDashboard();
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
  const rawAmt=_evalExpr(document.getElementById('lrp-amt').value);
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
      _adjustCash(deductAcct, -amt, lm, ly, 'loan-repayment', id, rpDate);
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

  // Several loans can share a lender, so group by lender name. A lender with a
  // single loan renders exactly as before. Each loan keeps its own repayment
  // log and "Record Repayment" button.
  const order=[],byLender={};
  sorted.forEach(l=>{
    const k=String(l.lender||'—').trim();
    if(!byLender[k]){byLender[k]={lender:k,items:[]};order.push(byLender[k]);}
    byLender[k].items.push(l);
  });
  _llist.innerHTML=order.map(g=>{
    if(g.items.length===1) return _loanCardHTML(g.items[0],cur,m,y,false);
    const active=g.items.filter(l=>l.status!=='settled');
    const out=active.reduce((s,l)=>s+Math.max(0,(l.amtNGN||l.amount||0)-(l.repaid||0)),0);
    return `<div class="dc" style="padding-bottom:10px">
      <div class="dc-top" style="align-items:center">
        <div><div class="dc-name">${esc(g.lender)}</div>
          <div class="dc-sub">${g.items.length} loans · ${active.length} active</div></div>
        <div class="badge ${out>0?'br':'bg'}">${out>0?fmtCur(out,cur,m,y)+' left':'All settled'}</div>
      </div>
      <div style="margin-top:8px;border-left:2px solid var(--border);padding-left:9px">
        ${g.items.map(l=>_loanCardHTML(l,cur,m,y,true)).join('')}
      </div>
      <button class="btn btn-g btn-sm" style="margin-top:9px" onclick="event.stopPropagation();openLoanModFor('${jsq(g.lender)}')">+ Add another loan from ${esc(g.lender)}</button>
    </div>`;
  }).join('');
}
// Prefill the Add Loan form with an existing lender so a second, separate loan
// can be recorded under them (each loan keeps its own balance + repayments).
function openLoanModFor(lender){
  openLoanMod();
  const el=document.getElementById('ln-lender');
  if(el) el.value=lender;
  const t=document.getElementById('loan-mod-title');
  if(t) t.textContent='Add Loan — '+lender;
}
function _loanCardHTML(l,cur,m,y,inGroup){
  {
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
    // Inside a lender group the name sits in the header, so each row leads with
    // what distinguishes the individual loan.
    const head=inGroup
      ? `<div class="dc-sub" style="font-weight:600;color:var(--text)">${esc(l.loanType||'Loan')} · ${l.currency} ${fNum(l.amount||0)}${rateStr}</div>
         <div class="dc-sub">${l.startDate?fmtDate(l.startDate):''}${dueStr}${disbTo}</div>`
      : `<div class="dc-name">${esc(l.lender)} <span style="font-size:0.62rem;color:var(--text3)">›</span></div>
         <div class="dc-sub">${esc(l.loanType||'Loan')} · ${l.currency} ${fNum(l.amount||0)}${rateStr}${dueStr}</div>
         <div class="dc-sub" style="margin-top:2px">${l.startDate?fmtDate(l.startDate):''}${disbTo}</div>`;
    return`<div class="${inGroup?'':'dc'}" style="cursor:pointer;${inGroup?'padding:7px 0;border-bottom:1px solid var(--border);':''}${settled?'opacity:0.5':''}" onclick="drillDownLoan('${l.id}')">
      <div class="dc-top">
        <div>${head}</div>
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
  }
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
  // Charts drawn while their tab was hidden have no size, so draw on open.
  if(tab==='networth') renderNWTrendChart();
  if(tab==='trend'&&S.trendChart) S.trendChart.resize();
  if(tab==='breakdown'&&S.catChart) S.catChart.resize();
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
      series[t.category][i]+=txNGN(t);
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
  S.txns.forEach(t=>{catSpend[t.category]=(catSpend[t.category]||0)+txNGN(t);});

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

  const CAT_COLOURS=['#f87171','#fb923c','#e879a0','#c084fc','#fbbf24','#60a5fa','#34d399','#94a3b8'];
  const colorMap={'Income':'#14b8a6','Savings':'#34d399','Deficit':'#fb923c','Others':'#94a3b8'};
  cats.forEach(([cat],i)=>{if(!colorMap[cat])colorMap[cat]=CAT_COLOURS[i%CAT_COLOURS.length];});

  const data=[];
  cats.forEach(([cat,val])=>data.push({from:'Income',to:cat,flow:val}));
  if(savings>0)       data.push({from:'Income',to:'Savings',flow:savings});
  else if(savings<0)  data.push({from:'Income',to:'Deficit',flow:Math.abs(savings)});

  // Each band is labelled on one line where it meets its category, e.g.
  // "Food ₦44,000 (17%)" (share of income, or of spending when there's no
  // income), in black. Income is written under the chart, beneath its bar.
  // The plugin's own labels are hidden (color transparent); cfLabels draws them.
  const _base=incTotal>0?incTotal:totalExp;
  const labels={Income:`Income ${fmtCur(incTotal,cur,m,y)}`};
  data.forEach(d=>{labels[d.to]=`${d.to} ${fmtCur(Math.round(d.flow),cur,m,y)} (${_base?Math.round(d.flow/_base*100):0}%)`;});
  const cfLabels={id:'cfLabels',afterDatasetsDraw(chart){
    const meta=chart.getDatasetMeta(0),ctrl=meta.controller,nodes=ctrl&&ctrl._nodes;
    if(!nodes||!meta.xScale)return;
    const c=chart.ctx,area=chart.chartArea,xs=meta.xScale,ys=meta.yScale;
    const lh=13,right=[];
    c.save();
    c.textBaseline='middle';c.fillStyle='#000';
    c.font='600 10px "DM Mono", monospace';
    for(const node of nodes.values()){
      const x=xs.getPixelForValue(node.x),y=ys.getPixelForValue(node.y);
      const h=Math.abs(ys.getPixelForValue(node.y+Math.max(node.in||node.out,node.out||node.in))-y);
      const text=labels[node.key]||node.key;
      if(x<area.width/2){
        // Income: under the chart, beneath its bar (layout padding makes room).
        c.textAlign='left';
        c.fillText(text,x,area.bottom+11);
      }else right.push({text,x,y:y+h/2});
    }
    // Category labels sit on their band, just left of the category's bar;
    // nudged apart when small bands are too close to fit a line each.
    right.sort((a,b)=>a.y-b.y);
    let prev=area.top+lh/2-lh;
    right.forEach(t=>{t.y=Math.max(t.y,prev+lh);prev=t.y;});
    const over=prev-(area.bottom-lh/2);
    if(over>0)for(let i=right.length-1,lim=area.bottom-lh/2;i>=0;i--){right[i].y=Math.min(right[i].y,lim);lim=right[i].y-lh;}
    c.textAlign='right';
    right.forEach(t=>c.fillText(t.text,t.x-6,t.y));
    c.restore();
  }};
  // Tapping a flow lists that category's expenses, as the Breakdown chart
  // does. "Others" lists the smaller ones.
  const _top=new Set(cats.map(([c])=>c).filter(c=>c!=='Others'));
  const _cfOpen=to=>{
    if(to==='Income'){drillDown('income');return;}
    if(to==='Expenses'){drillDown('expenses');return;}
    if(to==='Savings'||to==='Deficit')return;
    const list=to==='Others'?S.txns.filter(t=>!_top.has(t.category)):S.txns.filter(t=>t.category===to);
    if(!list.length)return;
    haptic([10]);
    openCatPopup(to,list,cur,m,y);
  };
  S._cfOpen=_cfOpen;
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
        size:'max',
        color:'transparent',
        font:{family:'DM Mono, monospace',size:10},
        borderWidth:0,
        nodePadding:18,
        nodeWidth:14,
      }]
    },
    plugins:[cfLabels],
    options:{
      responsive:true,
      maintainAspectRatio:false,
      layout:{padding:{bottom:18}},
      onClick:(_e,els)=>{if(els.length){const d=data[els[0].index];if(d)_cfOpen(d.to);}},
      onHover:(e,els)=>{if(e.native?.target)e.native.target.style.cursor=els.length?'pointer':'default';},
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
}

// ══════════════════════════════════════════════════════════════════════════
// FORECAST — Treasury, Net Worth, Analytics, History, Fixed Bills
// ══════════════════════════════════════════════════════════════════════════
function renderForecast(){renderProjInsights();renderProjTreasury();renderProjHistory();renderProjAI();}
function projTab(tab,btn){
  ['insights','treasury','history','obligations','ai'].forEach(t=>{
    const el=document.getElementById('proj-'+t);if(el)el.style.display=t===tab?'block':'none';
  });
  btn.closest('.tabs').querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));btn.classList.add('active');
  _projTabCur=tab;_fabVisibility();
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
  const now=appNow();
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
    <div class="cval" style="color:${barColor}">${R.totalProj?fC(R.totalProj):'—'}<span style="font-size:0.7rem;color:var(--text2);font-weight:400"> projected${R.totalBudget?` · ${pct}% of ${fC(R.totalBudget)} budget`:''}</span></div>
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
        <span class="pjval" style="text-align:right"><span style="color:var(--text2)">${fC(p.spent)}</span> → <span style="color:${st}">${fC(p.proj)}</span>${p.budget?`<span style="color:var(--text3);font-size:0.66rem"> / ${fC(p.budget)}</span>`:''}</span>
      </div>`;}).join('')+`<div class="csub" style="margin-top:8px">spent → projected / budget. "Typical total" = median of your last ${R.monthsUsed} months for categories bought ≤4×/month; "pace curve" = scaled by how much of the month's spend usually lands by day ${day}.</div></div>`;
  }
  el.innerHTML=html;
}

function renderProjTreasury(){
  const el=document.getElementById('proj-treasury');if(!el)return;
  const m=S.dashMonth||S.expMonth,y=S.dashYear||S.expYear,cur=S.dashCurrency||'NGN';
  // Completed months only: the month in progress would pull the averages down.
  const hist=_completedHistory().filter(h=>h.expenses>0).slice(-6);
  const cash=S.cash,cashTotal=cashTotalNGN(cash);
  const avgSpend=hist.length?hist.reduce((s,h)=>s+h.expenses,0)/hist.length:0;
  const avgInc=hist.length?hist.reduce((s,h)=>s+(h.income||0),0)/hist.length:0;
  // Fixed obligations = recurring expenses, as a monthly amount (v4.7: Fixed
  // Bills became recurring items).
  const fixedItems=getRecurring().filter(r=>r.type!=='income');
  const fixedTotal=fixedItems.reduce((s,r)=>s+_recurMonthly(r),0);
  const runway=avgSpend>0?(cashTotal/avgSpend):null;
  const savingsRates=hist.map(h=>h.income>0?Math.max(0,(h.income-h.expenses)/h.income*100):0);
  const avgSaveRate=savingsRates.length?savingsRates.reduce((a,b)=>a+b,0)/savingsRates.length:0;
  const latestRate=savingsRates[savingsRates.length-1]||0;
  const rateDir=savingsRates.length>=2?latestRate-savingsRates[savingsRates.length-2]:0;
  const last3=hist.slice(-3),prev3=hist.slice(-6,-3);
  const last3Avg=last3.length?last3.reduce((s,h)=>s+h.expenses,0)/last3.length:0;
  const prev3Avg=prev3.length?prev3.reduce((s,h)=>s+h.expenses,0)/prev3.length:0;
  const expInflation=prev3Avg>0?((last3Avg-prev3Avg)/prev3Avg*100):null;
  const base=avgInc-avgSpend;
  el.innerHTML=`
    <div class="g2" style="margin-bottom:10px">
      <div class="card card-sm" style="margin-bottom:0;text-align:center">
        <div class="clabel">Runway</div>
        <div style="font-family:var(--mono);font-size:1.1rem;font-weight:500;color:${runway>6?'var(--accent)':runway>3?'var(--gold)':'var(--red)'}">${runway?runway.toFixed(1)+'mo':'—'}</div>
        <div class="csub">at avg burn</div>
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
      <div class="pjrow"><span class="pjlabel">Fixed obligations <span class="sh-link" style="font-size:0.62rem" onclick="openRecurModal()">(${fixedItems.length} recurring ›)</span></span><span class="pjval" style="color:var(--gold)">${fmtCur(Math.round(fixedTotal),cur,m,y)}</span></div>
      <div class="pjrow"><span class="pjlabel">Discretionary (avg − fixed)</span><span class="pjval">${fmtCur(Math.round(Math.max(0,avgSpend-fixedTotal)),cur,m,y)}</span></div>
      <div class="pjrow" style="font-weight:700"><span>Avg. net / month</span><span class="pjval" style="color:${base>=0?'var(--accent)':'var(--red)'}">${fmtCur(Math.round(base),cur,m,y)} ${base>=0?'saved':'deficit'}</span></div>
      ${expInflation!==null?`<div style="margin-top:10px;padding:8px 10px;border-radius:var(--rsm);background:${Math.abs(expInflation)>10?'var(--rdim)':'var(--bg2)'};font-size:0.72rem;color:${expInflation>10?'var(--red)':expInflation<-5?'var(--accent)':'var(--text2)'}">
        ${expInflation>10?'⚠':'◈'} Expense ${expInflation>0?'inflation':'deflation'}: spending is <strong>${Math.abs(expInflation).toFixed(1)}%</strong> ${expInflation>0?'higher':'lower'} vs prior 3 months</div>`:''}
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


function renderProjHistory(){
  const el=document.getElementById('proj-history');if(!el)return;
  el.innerHTML=`
    <div class="card">
      <div style="display:grid;grid-template-columns:80px 1fr 1fr;gap:0;padding-bottom:7px;border-bottom:1px solid var(--border);margin-bottom:4px">
        <div style="font-size:0.62rem;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:var(--text3)">Month</div>
        <div style="font-size:0.62rem;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:var(--accent);text-align:right;cursor:pointer" onclick="histSort('income')">Income ↕</div>
        <div style="font-size:0.62rem;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:var(--red);text-align:right;cursor:pointer" onclick="histSort('expenses')">Expenses ↕</div>
      </div>
      <div id="hist-rows">${buildHistRows(_histByRecent())}</div>
    </div>`;
}
// History defaults to most-recent month first. (getHistory() is stored oldest-
// first for charts/trends; the tab wants the newest month at the top.)
function _histByRecent(){return [...getHistory()].sort((a,b)=>b.year!==a.year?b.year-a.year:b.month-a.month);}
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
  if(!_dbReady()) return;
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
    const liveExp=freshTxns.reduce((s,t)=>s+txNGN(t),0);
    const liveInc=freshInc.reduce((s,i)=>s+txNGN(i),0);
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
  const totalExp=txns.reduce((s,t)=>s+txNGN(t),0);
  const totalInc=inc.reduce((s,i)=>s+(i.amtNGN||i.amount||0),0);
  const cats={};txns.forEach(t=>{cats[t.category]=(cats[t.category]||0)+txNGN(t);});
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
  const cashAccounts=getCashAccounts();
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
      <label style="font-size:0.62rem;color:var(--text2);width:68px;flex-shrink:0">${esc(a)}${isUSDCashAccount(a)?' ($)':''}</label>
      <input class="ifield" type="text" id="hd-cash-${sid_}-${a}" placeholder="0" value="${cashData[a]!==undefined?cashData[a]:''}" style="padding:4px 8px;font-size:0.72rem;font-family:var(--mono)">
    </div>`).join('');
  const invInputs=PLATFORMS.map(p=>{
    const dispCur='₦'; // investment balances are stored in naira
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
  const cashAccounts=getCashAccounts();
  const before=cGet(CK.cash(m,y))||{};
  // Build cash doc
  const cashDoc={month:m,year:y};
  cashAccounts.forEach(a=>{
    const el=document.getElementById(`hd-cash-${sid_}-${a}`);
    if(!el) return;
    const v=el.value.trim();
    if(v!=='') cashDoc[a]=numVal(el)||0;
  });
  // Build inv doc
  const invDoc={month:m,year:y};
  PLATFORMS.forEach(p=>{
    const el=document.getElementById(`hd-inv-${sid_}-${p.key}`);
    if(!el) return;
    const v=el.value.trim();
    if(v!=='') invDoc[p.key]=numVal(el)||0;
  });
  try{
    await Promise.all([
      db.collection('cashBalances').doc(sid_).set(cashDoc,{merge:true}),
      db.collection('investments').doc(sid_).set(invDoc,{merge:true})
    ]);
    cSet(CK.cash(m,y),{...before,...cashDoc});
    cSet(CK.inv(m,y),{...(cGet(CK.inv(m,y))||{}),...invDoc});
    // A corrected closing balance carries into every later month (as on the
    // Cash page).
    cashAccounts.forEach(a=>{if(cashDoc[a]==null)return;const d=cashDoc[a]-(before[a]||0);if(d)_rippleCashForward(a,d,m,y);});
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
function renderSettings(){renderSettData();renderSettBudget();renderSettExport();renderSettGuide();}
function settTab(tab,btn){['data','budget','export','guide'].forEach(t=>{document.getElementById('sett-'+t).style.display=t===tab?'block':'none';});btn.closest('.tabs').querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));btn.classList.add('active');}
// ── GUIDE TAB (Settings → Guide) ──
// Static how-to for new users. Keep it in step with the UI: if you rename a
// screen, tab or button, update the matching line here.
function renderSettGuide(){
  const el=document.getElementById('sett-guide');if(!el)return;
  const sec=(title,body,open)=>`<details class="gd"${open?' open':''}><summary>${title}</summary><div class="gd-b">${body}</div></details>`;
  el.innerHTML=`
    <div class="exp-card" style="margin-top:10px">
      <div class="exp-card-title">How to use SpendWise</div>
      <div class="exp-card-sub" style="margin-bottom:0">Tap a section to open it.</div>
    </div>
    ${sec('Quick start',`
      <ol>
        <li><b>Add your accounts.</b> Go to <b>Accounts → Cash → + Add accounts</b>, add your banks and cash from the logo list, then tap <b>✎</b> beside each one to enter what's in it today.</li>
        <li><b>Set a budget.</b> In <b>Settings → Budget</b>, enter a monthly amount for each category you care about and tap <b>Save for every month</b>. It applies to every month until you change it.</li>
        <li><b>Record spending as it happens.</b> Tap the round <b>+</b> button, enter the amount, pick a category, what you spent it on, and the bank it came from. The balance of that bank goes down automatically.</li>
        <li><b>Record income</b> the same way, using the <b>Income</b> button at the top of the + form.</li>
        <li><b>Check Home</b> to see where your money is going and how you're doing against your budget.</li>
      </ol>
      <p>New here? The <b>Getting started</b> checklist on Home walks you through these steps and ticks them off as you go.</p>
      <p class="gd-tip">The habit that matters most: log spending the same day. Everything else in the app is built from those entries.</p>`,true)}
    ${sec('Saving, syncing and privacy',`
      <p>You can use SpendWise without an account. Your data is then saved <b>on this device only</b>: if you lose the phone or clear the browser, it's gone.</p>
      <p><b>Create an account</b> (Settings → Data → Account) to:</p>
      <ul>
        <li>use the app on all your devices: sign in with the same username and password and everything syncs;</li>
        <li>get your data back if you change or lose your phone.</li>
      </ul>
      <p>Anything already on this device is uploaded to your new account.</p>
      <p><b>Your recovery code.</b> When you create an account you get a recovery code. Keep it somewhere safe (a password manager, or written down). It's the <b>only</b> way back in if you forget your password. If you add a recovery email, you can send the code to your inbox so it's there when you need it. You can see the code, email it again or create a new one in <b>Settings → Data → Account → Recovery code &amp; email</b>.</p>
      <p><b>Privacy.</b> Your data is encrypted on your device before it's saved online. Nobody else can read it, including the person who runs the app. The only exceptions are Quick add and the AI Analyst, which send what you type to Google's Gemini service to understand it.</p>
      <p><b>Deleting your account.</b> Settings → Data → Account → <b>Delete my account</b> permanently erases your account and all your data from every device. Download a backup first (Settings → Export) if you want to keep a copy.</p>`)}
    ${sec('Recording money (the + button)',`
      <p>Two round buttons sit on every page (except the AI chat): <b>+</b> is <b>Quick add</b> and the 🎤 above it is <b>Say it</b> (speak or type the transaction). To ask the AI, open the <b>AI/Analytics</b> tab; it opens on the chat. If the buttons are covering something, <b>drag either one</b> to move them anywhere on the screen; they stay where you leave them.</p>
      <p><b>Quick add</b> opens the form for you to fill in yourself.</p>
      <p><b>Say it</b> is the fastest way. It opens its own screen and starts listening: say something like <i>"5k lunch from GTB yesterday"</i>, <i>"received 250k salary into Access"</i> or <i>"moved 20k from Opay to Kuda"</i>. Prefer to type? Tap the box under the mic and type it instead, then tap ✦. The form opens filled in; check it and tap Save. Nothing is saved until you do. Tap the big mic to stop early or to try again.</p>
      <p><b>Closing a month early.</b> Done with a month before it ends (say on 29 Sept)? Tap <b>Close September</b> on Home (it shows in the last week of the month) or in Settings → Data → Month. September's interest is added, bills due are posted, and SpendWise moves to October: new entries are dated 1 Oct. If you date something in September afterwards, you're asked whether to post it on 1 Oct instead. Changed your mind? <b>Reopen September</b> until the month really ends.</p>
      <p>Filling in the form yourself, choose what you're recording:</p>
      <ul>
        <li><b>Paid in dollars or pounds from a naira account?</b> (e.g. a $6.93 subscription on your naira card) Switch the currency next to Amount to $ or £. It's converted at that month's rate and your account is charged in naira.</li>
        <li><b>Expense.</b> Pick a <b>category</b> (e.g. Food) and what it was <b>spent on</b> (e.g. Lunch). To add a new item, choose "New item" and give it a name and emoji. It's remembered for next time.</li>
        <li><b>Income.</b> Choose the category and the bank it was received into.</li>
        <li><b>Transfer.</b> Moves money between your own accounts: <b>Cash → Cash</b>, <b>Cash → Invest</b> or <b>Invest → Cash</b>. It isn't counted as spending.</li>
      </ul>
      <p>Set the date if it didn't happen today; it's filed under the right month and that month's balances are updated. Set <b>Repeats</b> (weekly, monthly…) for bills and income that repeat (rent, subscriptions, salary). Tick <b>Post it automatically</b> and it's recorded by itself on its date; otherwise it shows on Home under <b>Upcoming Bills</b> for you to post or skip.</p>
      <p><b>To fix a mistake:</b> on the Expenses page, tap an entry (or ✎) to edit it, or tap × to delete it. Tap <b>Undo</b> within a few seconds if you deleted the wrong one.</p>`)}
    ${sec('Home',`
      <ul>
        <li><b>Net Worth</b>: everything you have (cash + investments + money owed to you), minus loans if you choose. Tap it for the breakdown, and tap the 👁 to hide amounts when others can see your screen.</li>
        <li><b>Search</b> (top right) finds any entry in any month by item, category, bank, note or amount.</li>
        <li><b>Year / month / currency</b> selectors change the period and currency you're looking at (the currency is also in Settings → Preferences).</li>
        <li>In the first week of a month, a <b>month in review</b> card sums up the month before. You can share it or hide it.</li>
        <li><b>Spend vs Budget</b>: how much of each category's budget you've used this month.</li>
        <li><b>Calendar</b> shows what you spent on each day. <b>Charts</b> cover breakdown, 6-month trend, net worth and cash flow.</li>
        <li>Tap <b>Edit</b> (top right) to reorder the cards.</li>
        <li>The 🔔 bell shows alerts, like a category on track to go over budget.</li>
      </ul>`)}
    ${sec('Expenses page',`
      <ul>
        <li>Tap a month in the strip at the top to switch months; the ends of the strip go to the year before or after.</li>
        <li>The box filters the month you're on (use <b>Search</b> on Home for every month). <b>Filter</b> narrows to categories. Sort <b>By date</b> or <b>By expense</b>.</li>
        <li><b>Income</b> tab: everything you received that month.</li>
        <li><b>Special Budget</b> tab: plan a trip or event separately from your monthly budget. Add items, compare options (e.g. two airlines or hotels) and switch currency.</li>
      </ul>`)}
    ${sec('Accounts page',`
      <ul>
        <li><b>Cash</b>: your bank and cash balances. Tap an account to see every movement in and out of it. <b>⇄ Transfer</b> moves money between your accounts or to and from investments; <b>Transfer history</b> lists (and can reverse) past transfers. <b>✎</b> beside an account edits just that account: correct its balance, set its interest rate and dates, change its logo or remove it. <b>+ Add accounts</b> adds more.</li>
        <li><b>Investments</b>: balances on savings and investment platforms. You can record money going in, gains or losses, or cash out all or part of an investment back to a bank. <b>Trend</b> shows growth over time. Past months are read-only.</li>
        <li><b>Interest</b>: set a rate on an account (✎ beside it on the Cash page, or on the investment) and choose how it's added. <b>Every day (compounds)</b>, like Renmoney: the balance you see grows daily and you can spend all of it. <b>End of each month</b>, like Piggy: it shows as earned this month and joins the balance on the last day. Either way it's worked out on what the account actually held each day, and each month's interest is saved as one Interest Income entry (Expenses → Income, and in History). With a maturity date it builds until then; tap <b>Record</b> when it's paid (you can enter your statement's figure).</li>
        <li><b>Debtors</b>: money people owe you. Add a person and record repayments as they come in.</li>
        <li><b>Loans</b>: money you owe. Record repayments to see what's left.</li>
      </ul>`)}
    ${sec('AI/Analytics page',`
      <ul>
        <li><b>AI ✦</b>: ask questions about your money in plain English ("Where did most of my money go last month?"). It can draw charts too. Tap 🎤 to speak your question instead of typing. Chats sync across your devices.</li>
        <li><b>Insights</b>: a forecast of how the month will end and which categories are running hot.</li>
        <li><b>Treasury</b>: your <b>runway</b> (how many months your cash would last at your usual spending), savings rate, your fixed monthly bills (from Recurring) and a 3-month cash projection. It uses completed months only.</li>
        <li><b>History</b>: income and expenses month by month. Tap a column heading to sort.</li>
      </ul>
      <p class="gd-tip">When you use the AI Analyst, your question and the relevant figures are sent to Google's Gemini service to produce the answer. Nothing is sent unless you ask it something.</p>`)}
    ${sec('Settings page',`
      <ul>
        <li><b>Data</b>: your account (sign in, sign out, password, recovery code, delete account), <b>app lock</b>, savings <b>goals</b>, <b>recurring</b> items, <b>preferences</b> (currency, the + button) and <b>Help</b> (this guide and <b>Report a problem</b>). Rarely needed tools (your own AI key, what counts in net worth, exchange rates, balance audit) are under <b>Advanced</b>. Dollar and pound rates are fetched automatically each day; you can set your own for any month.</li>
        <li><b>Budget</b>: one budget for every month (<b>Save for every month</b>), or a different one for a single month (<b>Only this month</b>). Also manage categories and items here. Built-in categories can't be deleted, but any category can be merged into another.</li>
        <li><b>Export</b>: download your data as Excel (a monthly budget workbook), CSV, or a full JSON backup.</li>
        <li><b>Guide</b>: this page.</li>
      </ul>`)}
    ${sec('Tips and troubleshooting',`
      <ul>
        <li><b>Install it like an app.</b> On iPhone, open the site in Safari, tap Share → <b>Add to Home Screen</b>. On Android, open it in Chrome, tap ⋮ → <b>Add to Home screen</b> / <b>Install app</b>.</li>
        <li><b>Works offline.</b> Entries made without internet sync when you're back online.</li>
        <li><b>Pull down</b> on the Home page to reload your data.</li>
        <li>If a bar says <b>Update available</b>, tap <b>Update now</b> to get the latest version.</li>
        <li><b>Balance looks wrong?</b> Check that the entry used the right bank and date. You can also correct a balance directly: Accounts → Cash → ✎ beside the account.</li>
        <li><b>Forgot your password?</b> On the sign-in screen, tap <b>Forgot password? Use your recovery code</b>, then set a new password.</li>
        <li><b>Lock the app</b> with your fingerprint, face or phone PIN: Settings → Data → <b>App lock</b> (needs an account; your password always works as a backup).</li>
        <li><b>Something not working?</b> Settings → Data → Help → <b>Report a problem</b> opens an email to the developer with the details needed to fix it.</li>
        <li><b>Using a shared or borrowed device?</b> Sign out when you're done (Settings → Data → Account). This removes your data from that device; it stays safe in your account. On your own phone, the copy of your data kept for offline use is protected by the phone's lock, so keep one set.</li>
      </ul>`)}
  `;
  // One section open at a time: opening a section closes the others.
  el.querySelectorAll('details.gd').forEach(d=>d.addEventListener('toggle',()=>{
    if(d.open)el.querySelectorAll('details.gd[open]').forEach(o=>{if(o!==d)o.open=false;});
  }));
}
function renderSettBudget(){
  const total=Object.values(S.budgets).reduce((s,v)=>s+(v||0),0);
  const prevM=S.expMonth===1?12:S.expMonth-1,prevY=S.expMonth===1?S.expYear-1:S.expYear;
  const prevTxnsList=cGet(CK.txns(prevM,prevY))||[];
  const prevCatSpend={};prevTxnsList.forEach(t=>{prevCatSpend[t.category]=(prevCatSpend[t.category]||0)+txNGN(t);});
  const monName=`${MONTHS[S.expMonth-1]} ${S.expYear}`;
  const custom=!!budgetOverride(S.expMonth,S.expYear);
  document.getElementById('sett-budget').innerHTML=`
    <div class="exp-card" style="margin-top:10px;padding:10px 12px">
      <div style="font-size:0.76rem;font-weight:700">${custom?`Custom budget for ${monName}`:'Your monthly budget'}</div>
      <div style="font-size:0.66rem;color:var(--text2);margin-top:3px;line-height:1.5">${custom
        ?`${monName} has its own budget, so changes to your standard budget don't affect it. <span class="sh-link" style="font-size:0.66rem" onclick="resetMonthBudget()">Use the standard budget for ${MONTHS[S.expMonth-1]}</span>`
        :`Applies to every month. To budget one month differently, change the amounts and tap "Only ${MS[S.expMonth-1]} ${S.expYear}".`}</div>
    </div>
    ${getAllCats().map(c=>{const k=ck(c);const prevSpend=prevCatSpend[c]||0;return`<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border)"><span style="flex:1;font-size:0.72rem;color:var(--text2)">${CAT_ICONS[c]||''} ${c}</span>${prevSpend?`<span style="font-size:0.58rem;color:var(--text3);font-family:var(--mono);cursor:pointer;white-space:nowrap" onclick="document.getElementById('b-${k}').value=${prevSpend};updateBudgetTotal()" title="Copy last month actual">↩${fN(prevSpend).replace('₦','')}</span>`:'<span style="width:32px"></span>'}<input class="ifield" type="text" id="b-${k}" placeholder="0" value="${S.budgets[k]||''}" style="width:100px;flex-shrink:0;font-size:0.76rem;padding:5px 8px" oninput="updateBudgetTotal()"></div>`;}).join('')}
    <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid var(--border);margin-bottom:12px;font-weight:700;font-size:0.84rem"><span>Total</span><span id="budget-total-display" style="font-family:var(--mono);color:var(--accent)">${_budgetTotalText(total)}</span></div>
    ${['USD','GBP'].includes(S.dashCurrency)?`<div style="font-size:0.62rem;color:var(--text3);margin:-6px 0 12px">Budgets are entered in naira; the total is also shown in ${S.dashCurrency==='USD'?'dollars':'pounds'} at this month's rate.</div>`:''}
    <button class="btn btn-g btn-sm" style="margin-bottom:8px" onclick="copyActualSpend()">↩ Fill in last month's actual spend</button>
    <div style="display:flex;gap:8px;margin-bottom:16px">
      <button class="btn btn-p" style="flex:2" onclick="saveBudget('std')">Save for every month</button>
      <button class="btn btn-g" style="flex:1" onclick="saveBudget('month')">Only ${MS[S.expMonth-1]} ${S.expYear}</button>
    </div>
    <div style="border-top:1px solid var(--border);padding-top:14px">
      <div style="font-size:0.7rem;font-weight:700;color:var(--text2);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.06em">Manage Categories &amp; Items</div>
      <div style="font-size:0.66rem;color:var(--text3);margin-bottom:10px">Tap a category to see its items: what you spend on, like Lunch, Spar or Netflix. Built-in categories cannot be deleted (but can be merged). Custom categories with transactions must be merged before removal.</div>
      <div id="cat-payee-accordion">
        ${getAllCats().map((c)=>{
          const isCustom=!_BASE_CATS.includes(c);
          const allPayees=[...(CAT_LINES[c]||[]),...(S.customExpLines[c]||[])].filter(p=>{const removed=(S.customExpLines['__removed__']||{})[c]||[];return!removed.includes(p);});
          return`<div class="cat-acc-item" id="cat-acc-${c.replace(/[^a-z0-9]/gi,'_')}">
            <div class="cat-acc-hdr" onclick="toggleCatAcc('${c.replace(/'/g,"\\'")}')">
              <span style="font-size:0.76rem;flex:1">${CAT_ICONS[c]||'📦'} ${c}</span>
              <span style="font-size:0.62rem;color:var(--text3);margin-right:8px">${allPayees.length} item${allPayees.length!==1?'s':''}</span>
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
                  </div>`).join(''):'<div style="font-size:0.7rem;color:var(--text3);padding:6px 0">No items yet.</div>'}
              </div>
              <div style="display:flex;gap:6px;margin-top:8px;align-items:center">
                <input class="ifield" id="new-payee-${c.replace(/[^a-z0-9]/gi,'_')}" placeholder="Add item…" style="flex:1;font-size:0.74rem;padding:5px 8px">
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
      <div style="font-size:0.7rem;font-weight:700;color:var(--text2);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.06em">Merge Items</div>
      <div class="csub" style="margin-bottom:10px">Combine two items within a category into one. Past transactions are updated too, across every month and device.</div>
      ${(()=>{const c0=getAllCats()[0]||'';const lines=_payeeLinesForCat(c0);const lopts=lines.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('');return`
      <div style="margin-bottom:8px"><label class="ilabel">Category</label><select class="sfield" id="pmerge-cat" style="font-size:0.75rem" onchange="_pmergeFillLines()">${getAllCats().map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></div>
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center;margin-bottom:8px">
        <div><label class="ilabel">From (merged away)</label><select class="sfield" id="pmerge-from" style="font-size:0.75rem">${lopts}</select></div>
        <div style="font-size:1rem;color:var(--text3);padding-top:18px">→</div>
        <div><label class="ilabel">Into (kept)</label><select class="sfield" id="pmerge-into" style="font-size:0.75rem">${lopts}</select></div>
      </div>`;})()}
      <button class="btn btn-d btn-full" onclick="mergePayeeLines()" style="font-size:0.76rem">Merge Lines</button>
    </div>
    <div style="border-top:1px solid var(--border);padding-top:14px;margin-top:14px">
      <div style="font-size:0.7rem;font-weight:700;color:var(--text2);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.06em">Auto-Categorization Rules</div>
      <div class="csub" style="margin-bottom:10px">When an expense name contains the text below, its category is filled in automatically (first match wins, overrides the built-in suggestions).</div>
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
  setTimeout(()=>{initNumInputs(document.getElementById('sett-budget'));
    const pi=document.getElementById('pmerge-into');if(pi&&pi.options.length>1)pi.selectedIndex=1;},0);
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
  if(emojiBtn) emojiBtn.textContent='📦'; // reset
  const cats=getCustomCats();cats.push(name);saveCustomCats(cats,{...getCustomIcons(),[name]:emoji});
  input.value='';
  // Refresh expense modal cat select if open
  const catSel=document.getElementById('e-cat');
  if(catSel) catSel.innerHTML=getAllCats().map(c=>`<option value="${c}">${CAT_ICONS[c]||''} ${c}</option>`).join('');
  renderSettBudget();toast('Category added: '+name);
}
function removeCustomCat(name){
  // Check if this category has any transactions in any cached month
  const allKeys=cKeys('sw3_txns_');
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
  if(!name){toast('Enter a name');return;}
  const existing=[...(CAT_LINES[cat]||[]),...(S.customExpLines[cat]||[])];
  if(existing.map(p=>p.toLowerCase()).includes(name.toLowerCase())){toast('That item already exists in this category');return;}
  if(!S.customExpLines[cat]) S.customExpLines[cat]=[];
  S.customExpLines[cat].push(name);
  saveCustomLines();
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
// Rewrite the `payee` field on every past transaction of one category from
// oldPayee → newPayee, so a rename (or a merge onto an existing name) reflects
// historically — not just in the dropdown. Mirrors the category migrations:
// updates all cached months + the live S.txns immediately, then updates
// Firestore in the background (single-field `payee` query, so no composite
// index is needed; category is filtered client-side). Returns the count of
// locally-updated transactions for the toast.
function _rewritePayeeHistory(cat, oldPayee, newPayee){
  let n=0;
  cKeys('sw3_txns_').forEach(k=>{
    let arr; try{arr=cGet(k);}catch(e){return;}
    if(!Array.isArray(arr))return;
    let changed=false;
    arr.forEach(t=>{ if(t.category===cat && t.payee===oldPayee){ t.payee=newPayee; changed=true; n++; } });
    if(changed) cSet(k,arr);
  });
  if(Array.isArray(S.txns)) S.txns.forEach(t=>{ if(t.category===cat && t.payee===oldPayee) t.payee=newPayee; });
  if(db){
    db.collection('transactions').where('payee','==',oldPayee).get().then(async snap=>{
      const docs=snap.docs.filter(d=>d.data().category===cat);
      for(let i=0;i<docs.length;i+=400){
        const batch=db.batch();
        docs.slice(i,i+400).forEach(d=>batch.update(d.ref,{payee:newPayee}));
        await batch.commit();
      }
    }).catch(e=>console.warn('payee history rewrite failed',e));
  }
  return n;
}
function commitEditPayee(cat,oldPayee,newPayee,src){
  if(!newPayee){toast('Name cannot be empty');return;}
  if(newPayee===oldPayee){renderSettBudget();return;}
  // Count how many past transactions this touches so the confirm is informed.
  let hist=0;
  cKeys('sw3_txns_').forEach(k=>{
    let arr; try{arr=cGet(k);}catch(e){return;}
    if(Array.isArray(arr)) hist+=arr.filter(t=>t.category===cat&&t.payee===oldPayee).length;
  });
  const merging=[...(CAT_LINES[cat]||[]),...((S.customExpLines[cat]||[]))].includes(newPayee);
  const msg=(merging?`Merge "${oldPayee}" into existing "${newPayee}"`:`Rename "${oldPayee}" to "${newPayee}"`)
    +(hist?` and update ${hist} past transaction${hist===1?'':'s'}?`:'?');
  if(!confirm(msg)) return;
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
    // Map old→new and dedupe (so a merge onto an existing line doesn't leave two)
    S.customExpLines[cat]=[...new Set((S.customExpLines[cat]||[]).map(p=>p===oldPayee?newPayee:p))];
  }
  saveCustomLines();
  const updated=_rewritePayeeHistory(cat,oldPayee,newPayee);
  const key=cat.replace(/[^a-z0-9]/gi,'_');
  renderSettBudget();
  if(typeof renderExpenses==='function')renderExpenses();
  if(typeof renderDashboard==='function')renderDashboard();
  setTimeout(()=>{ const el=document.getElementById('cat-acc-'+key); if(el&&!el.classList.contains('open')) toggleCatAcc(cat); },0);
  toast(updated?`Renamed to "${newPayee}" · ${updated} transaction${updated===1?'':'s'} updated`:`Renamed to "${newPayee}"`);
}
function removePayeeLine(cat,payee,src){
  if(!confirm(`Remove "${payee}" from ${cat}? Past entries keep it.`))return;
  if(src==='builtin'){
    // Built-in items are hidden via the synced __removed__ map
    CAT_LINES[cat]=(CAT_LINES[cat]||[]).filter(p=>p!==payee);
    if(!S.customExpLines['__removed__']) S.customExpLines['__removed__']={};
    if(!S.customExpLines['__removed__'][cat]) S.customExpLines['__removed__'][cat]=[];
    if(!S.customExpLines['__removed__'][cat].includes(payee)) S.customExpLines['__removed__'][cat].push(payee);
  } else {
    if(!S.customExpLines[cat]) return;
    S.customExpLines[cat]=S.customExpLines[cat].filter(p=>p!==payee);
    if(!S.customExpLines[cat].length) delete S.customExpLines[cat];
  }
  saveCustomLines();
  // Redraw and keep this category open (the list used to stay unchanged).
  renderSettBudget();
  setTimeout(()=>{const el=document.getElementById('cat-acc-'+cat.replace(/[^a-z0-9]/gi,'_'));if(el&&!el.classList.contains('open'))toggleCatAcc(cat);},0);
  toast(`Removed "${payee}"`);
}
// ── Merge two expense lines (payees) within a category ─────────────────────
function _payeeLinesForCat(c){
  const removed=(S.customExpLines['__removed__']||{})[c]||[];
  return [...new Set([...(CAT_LINES[c]||[]),...(S.customExpLines[c]||[])])].filter(p=>!removed.includes(p));
}
function _removeLineFromList(cat,payee){
  if((CAT_LINES[cat]||[]).includes(payee)){
    CAT_LINES[cat]=(CAT_LINES[cat]||[]).filter(p=>p!==payee);
    S.customExpLines['__removed__']=S.customExpLines['__removed__']||{};
    S.customExpLines['__removed__'][cat]=S.customExpLines['__removed__'][cat]||[];
    if(!S.customExpLines['__removed__'][cat].includes(payee))S.customExpLines['__removed__'][cat].push(payee);
  }
  if(S.customExpLines[cat]) S.customExpLines[cat]=S.customExpLines[cat].filter(p=>p!==payee);
}
// Repopulate the From/Into line pickers when the category dropdown changes.
function _pmergeFillLines(){
  const cat=document.getElementById('pmerge-cat')?.value;
  const lines=cat?_payeeLinesForCat(cat):[];
  const opts=lines.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('');
  const fromEl=document.getElementById('pmerge-from'),intoEl=document.getElementById('pmerge-into');
  if(fromEl)fromEl.innerHTML=opts;
  if(intoEl){intoEl.innerHTML=opts;if(lines.length>1)intoEl.selectedIndex=1;}
}
// Core of a payee merge: rewrite history, drop the old line, ensure the kept
// line exists. Callable programmatically (bulk cleanups) as well as from the UI.
function _mergePayeeCore(cat,from,into){
  const updated=_rewritePayeeHistory(cat,from,into);
  _removeLineFromList(cat,from);
  if(!(CAT_LINES[cat]||[]).includes(into)&&!((S.customExpLines[cat]||[]).includes(into)))
    (S.customExpLines[cat]=S.customExpLines[cat]||[]).push(into);
  saveCustomLines();
  return updated;
}
// Move every transaction with `payee` out of fromCat and into toCat, across all
// months (local caches + Firestore) — the payee-scoped counterpart to the
// whole-category merge. Also moves the payee's line into the target category.
function movePayeeCategory(payee,fromCat,toCat){
  let n=0;
  cKeys('sw3_txns_').forEach(k=>{
    let arr;try{arr=cGet(k);}catch(e){return;}
    if(!Array.isArray(arr))return;
    let changed=false;
    arr.forEach(t=>{ if(t.category===fromCat&&t.payee===payee){ t.category=toCat; changed=true; n++; } });
    if(changed) cSet(k,arr);
  });
  if(Array.isArray(S.txns)) S.txns.forEach(t=>{ if(t.category===fromCat&&t.payee===payee) t.category=toCat; });
  // Move the line definition across too
  _removeLineFromList(fromCat,payee);
  if(!(CAT_LINES[toCat]||[]).includes(payee)&&!((S.customExpLines[toCat]||[]).includes(payee)))
    (S.customExpLines[toCat]=S.customExpLines[toCat]||[]).push(payee);
  saveCustomLines();
  if(db){
    return db.collection('transactions').where('payee','==',payee).get().then(async snap=>{
      const docs=snap.docs.filter(d=>d.data().category===fromCat);
      for(let i=0;i<docs.length;i+=400){
        const batch=db.batch();
        docs.slice(i,i+400).forEach(d=>batch.update(d.ref,{category:toCat}));
        await batch.commit();
      }
      return docs.length;
    });
  }
  return Promise.resolve(n);
}
function mergePayeeLines(){
  const cat=document.getElementById('pmerge-cat')?.value;
  const from=document.getElementById('pmerge-from')?.value;
  const into=document.getElementById('pmerge-into')?.value;
  if(!cat||!from||!into){toast('Pick a category and two lines');return;}
  if(from===into){toast('Pick two different lines to merge');return;}
  let hist=0;
  cKeys('sw3_txns_').forEach(k=>{
    let a;try{a=cGet(k);}catch(e){return;}
    if(Array.isArray(a)) hist+=a.filter(t=>t.category===cat&&t.payee===from).length;
  });
  if(!confirm(`Merge "${from}" into "${into}" in ${cat}${hist?` and update ${hist} past transaction${hist===1?'':'s'}`:''}?`))return;
  const updated=_mergePayeeCore(cat,from,into);
  renderSettBudget();
  if(typeof renderExpenses==='function')renderExpenses();
  if(typeof renderDashboard==='function')renderDashboard();
  toast(updated?`Merged · ${updated} transaction${updated===1?'':'s'} updated`:`Merged "${from}" into "${into}"`);
}
function updateBudgetTotal(){
  const total=getAllCats().reduce((s,c)=>{const v=numVal('b-'+ck(c))||0;return s+v;},0);
  const el=document.getElementById('budget-total-display');
  if(el) el.textContent=_budgetTotalText(total);
}
function _budgetTotalText(total){
  return ['USD','GBP'].includes(S.dashCurrency)?`${fN(total)} · ${fC(total)}`:fN(total);
}
function copyActualSpend(){
  const prevM=S.expMonth===1?12:S.expMonth-1,prevY=S.expMonth===1?S.expYear-1:S.expYear;
  const prevTxns=cGet(CK.txns(prevM,prevY))||[];
  const prevSpend={};prevTxns.forEach(t=>{prevSpend[t.category]=(prevSpend[t.category]||0)+txNGN(t);});
  getAllCats().forEach(c=>{const el=document.getElementById('b-'+ck(c));if(el&&prevSpend[c])el.value=Math.round(prevSpend[c]);});
  updateBudgetTotal();
  toast('Copied actual spend from '+MS[prevM-1]);
}
// scope 'std': the standard budget for every month (and this month drops any
// custom budget of its own). scope 'month': a budget for this month only.
async function saveBudget(scope){
  const cats={};getAllCats().forEach(c=>{const k=ck(c);const el=document.getElementById('b-'+k);const v=el?numVal(el):NaN;cats[k]=isNaN(v)?0:v;});
  const m=S.expMonth,y=S.expYear;
  try{
    if(scope==='month'){
      await db.collection('budgets').doc(sid(m,y)).set({month:m,year:y,categories:cats});
      cSet(CK.budgets(m,y),{categories:cats});
      toast(`Budget saved for ${MONTHS[m-1]} ${y} only`);
    }else{
      saveProfile({defBudgets:cats});
      if(budgetOverride(m,y)){await db.collection('budgets').doc(sid(m,y)).delete();cSet(CK.budgets(m,y),{none:true});}
      toast('Budget saved for every month');
    }
    S.budgets=budgetFor(m,y);
    renderDashboard();renderSettBudget();
  }catch(e){console.warn('budget save failed',e);toast('Error saving budget');}
}
async function resetMonthBudget(){
  const m=S.expMonth,y=S.expYear;
  if(!confirm(`Use your standard budget for ${MONTHS[m-1]} ${y} instead of its own?`))return;
  try{await db.collection('budgets').doc(sid(m,y)).delete();}catch(e){console.warn('budget reset failed',e);toast('Could not reset. Try again.');return;}
  cSet(CK.budgets(m,y),{none:true});S.budgets=budgetFor(m,y);
  renderDashboard();renderSettBudget();toast('Using your standard budget');
}

function renderSettExport(){
  document.getElementById('sett-export').innerHTML=`
    <div class="exp-card"><div class="exp-card-title">Full Data Backup (JSON)</div><div class="exp-card-sub">Export everything — transactions, income, cash, investments, debtors, history — as a JSON file you can re-import later.</div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-p btn-sm" onclick="exportFullBackup()">↓ Download Backup JSON</button><button class="btn btn-g btn-sm" onclick="document.getElementById('backup-file-input').click()">↑ Restore from Backup</button></div><input type="file" id="backup-file-input" accept=".json,application/json" style="display:none" onchange="importFullBackup(event)"></div>
    <div class="exp-card"><div class="exp-card-title">Export All Data</div><div class="exp-card-sub">Excel: one budget-workbook sheet per month — day-by-day expense matrix with totals &amp; budget, cash accounts, investments and summaries. CSV: flat transaction list.</div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-exp btn-sm" onclick="exportAll('csv')">↓ CSV</button><button class="btn btn-exp btn-sm" onclick="exportAll('xlsx')">↓ Excel</button></div></div>
    <div class="exp-card"><div class="exp-card-title">Export by Month</div><div class="exp-card-sub">Select a month and export just that month — Excel uses the budget-workbook layout (expenses × days, cash, investments, summaries).</div>
    <div class="gform" style="margin-bottom:10px">
      <div class="ig"><label class="ilabel">Month</label><select class="sfield" id="exp-mo-sel">${Array.from({length:12},(_,i)=>i+1).reverse().map(m=>`<option value="${m}"${m===curM()?' selected':''}>${MONTHS[m-1]}</option>`).join('')}</select></div>
      <div class="ig"><label class="ilabel">Year</label><select class="sfield" id="exp-yr-sel">${_dataYears().map(y=>`<option value="${y}">${y}</option>`).join('')}</select></div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-exp btn-sm" onclick="exportMonth('csv')">↓ CSV</button><button class="btn btn-exp btn-sm" onclick="exportMonth('xlsx')">↓ Excel</button></div></div>
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
  try{await _syncCashLedgerUp(m,y);}catch(e){_warnLoad("_syncCashLedgerUp (audit)",e);}
  const prevM=m===1?12:m-1,prevY=m===1?y-1:y;
  async function fetchMonth(col){
    try{const s=await db.collection(col).where('year','==',y).where('month','==',m).get();return s.docs.map(d=>({...d.data(),id:d.id}));}
    catch(e){return null;}
  }
  let txns=await fetchMonth('transactions');if(!txns)txns=cGet(CK.txns(m,y))||[];
  let incs=await fetchMonth('income');if(!incs)incs=cGet(CK.inc(m,y))||[];
  let xfrs=await fetchMonth('transfers');if(!xfrs)xfrs=cGet(CK.xfr(m,y))||[];
  let prevCash=null;
  try{const d=await db.collection('cashBalances').doc(sid(prevM,prevY)).get();prevCash=d.exists?d.data():null;}catch(e){_warnLoad("audit: prev-month cash",e);}
  if(!prevCash)prevCash=cGet(CK.cash(prevM,prevY))||{};
  let curCash=null;
  try{const d=await db.collection('cashBalances').doc(sid(m,y)).get();curCash=d.exists?d.data():null;}catch(e){_warnLoad("audit: current-month cash",e);}
  if(!curCash)curCash=cGet(CK.cash(m,y))||S.cash||{};
  // Cash ledger — the ONLY record of loan, debtor and investment-liquidation
  // cash movements (these never hit the income/expense/transfer collections).
  // Without them the audit ignores real inflows/outflows and reports false
  // gaps. Merge Firestore (cross-device) with the local cache (offline-created
  // entries not yet synced), deduped by ts|bank|delta|source.
  let ledger=[];
  try{const d=await db.collection('cashLedger').doc(sid(m,y)).get();if(d.exists&&Array.isArray(d.data().entries))ledger=d.data().entries.slice();}catch(e){_warnLoad("audit: cash ledger",e);}
  {
    const local=cGet(`sw3_cash_ledger_${y}_${m}`)||[];
    const seen=new Set(ledger.map(e=>`${e.ts}|${e.bank}|${e.delta}|${e.source}`));
    local.forEach(e=>{const k=`${e.ts}|${e.bank}|${e.delta}|${e.source}`;if(!seen.has(k)){ledger.push(e);seen.add(k);}});
  }
  // Only loan/debtor/investment sources are added from the ledger; income,
  // expense and transfers are already counted via the collections above, so
  // including them here would double-count.
  // Debtor repayments only exist in the ledger, so they belong here too.
  // (Interest and top-ups funded from a bank already have an income or
  // transfer record, so they're counted there instead.)
  const LEDGER_ONLY_SRC=new Set(['loan-proceeds','loan-repayment','loan-edit-adjust','loan-remove-reverse','debt-add','debt-edit-adjust','debt-payment','debt-remove-reverse','investment-liquidation']);
  const accounts=getCashAccounts();
  const rows=accounts.map(b=>{
    const open=prevCash[b]||0;
    // The interest part of a cash-out is also in the ledger's liquidation
    // entry (the whole payout), so its income record is skipped here.
    const incSum=incs.filter(i=>i.bank===b&&i.source!=='liquidation-interest').reduce((s,i)=>s+(i.amount||0),0);
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
    '<div class="csub" style="margin-top:8px">Loan, debtor and investment flows are included. Remaining differences are usually balances you corrected by hand, or very old activity recorded before this check existed.</div>';
}
function auditFix(b,val,m,y){
  if(!confirm(`Set ${b} balance to the computed value?`))return;
  const cash={...(cGet(CK.cash(m,y))||S.cash||{})};
  cash[b]=val;
  if(m===S.cashMonth&&y===S.cashYear)S.cash=cash;
  if(m===S.dashMonth&&y===S.dashYear)S.cash=cash;
  cSet(CK.cash(m,y),cash);
  if(db)db.collection('cashBalances').doc(sid(m,y)).set({...cash,month:m,year:y},{merge:true}).catch(e=>console.warn("cashBalances write failed (manual balance edit)",e));
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
    }).catch(e=>console.warn("cashLedger heal/merge failed",e));
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
  try{toast('Downloading safety backup first…');await exportFullBackup();}catch(e){console.warn("safety backup before destructive op FAILED",e);}
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
    cKeys('sw3_').forEach(k=>{if(/^sw3_(txns|inc|cash|inv|bud)_\d{4}_\d{1,2}$/.test(k))cDel(k);});
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
  const expRows=txns.map(t=>([t.date||'','Expense',t.category||'',t.payee||'',t.bank||'',t.notes||'',-txNGN(t),0]));
  const incRows=(incomeRecs||[]).map(i=>([i.date||'','Income',i.category||'Income','',i.bank||'',i.notes||'',0,i.amtNGN||i.amount||0]));
  const all=[...expRows,...incRows].sort((a,b)=>a[0]>b[0]?1:a[0]<b[0]?-1:0);
  const header=[`${label} — Transactions`];
  const cols=['Date','Type','Category','Spent on','Bank','Notes','Expense (₦)','Income (₦)'];
  const rows=[header,[],cols,...all];
  // Summary
  const totExp=txns.reduce((s,t)=>s+txNGN(t),0);
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
    (groups[cat][name]=groups[cat][name]||Array(days).fill(0))[day-1]+=txNGN(t);
  });
  aoa.push([null,'Spent on']);
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
  const spentTotal=txns.reduce((s,t)=>s+txNGN(t),0);
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
    wdTotals[dt.getDay()===0?6:dt.getDay()-1]+=txNGN(t);
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


function renderSettData(){
  const fbVer=cGet(CK.fbSyncVer)||null;
  const ls=cGet(CK.lastSync);
  let syncInfo='Not yet synced';
  if(ls){const d=new Date(ls),diff=Math.round((Date.now()-d)/60000);syncInfo=diff<2?'Just now':diff<60?`${diff}m ago`:d.toLocaleDateString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});}
  // Everyday settings first; rarely-needed tools sit in the collapsed
  // "Advanced" section at the bottom.
  // App Info shows ONLY the current release note — bump-version.ps1 replaces
  // the single v-entry below on each release (keep its markup unchanged).
  document.getElementById('sett-data').innerHTML=`
    ${renderAccountCard()}
    ${typeof renderAppLockCard==='function'?renderAppLockCard():''}
    <div class="exp-card" style="margin-top:10px">
      <div class="exp-card-title" style="margin-bottom:6px">Goals</div>
      <div class="exp-card-sub" style="margin-bottom:8px">Savings targets with progress tracking. Active goals appear on the dashboard.</div>
      ${getGoals().map((g,i)=>{const pct=g.target>0?Math.min(100,Math.round((g.current||0)/g.target*100)):0;return`<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)"><span style="font-size:0.76rem">${g.icon||'🎯'} ${esc(g.name)} <span style="color:var(--text3);font-size:0.64rem;font-family:var(--mono)">${pct}%</span></span><button class="btn btn-g btn-sm" style="padding:2px 8px;font-size:0.66rem" onclick="openGoalModal(${i})">Edit</button></div>`;}).join('')||'<div style="font-size:0.7rem;color:var(--text3);padding:2px 0 6px">No goals yet.</div>'}
      <button class="btn btn-p btn-sm btn-full" style="margin-top:10px" onclick="openGoalModal()">+ New Goal</button>
    </div>
    <div class="exp-card" style="margin-top:10px">
      <div class="exp-card-title" style="margin-bottom:6px">Recurring</div>
      <div class="exp-card-sub" style="margin-bottom:10px">Bills and income that repeat. Each one can post itself when it's due, or wait on Home for a tap. Add one by choosing "Repeats" on the + form.</div>
      <button class="btn btn-g btn-sm btn-full" onclick="openRecurModal()">Manage recurring (${getRecurring().length})</button>
    </div>
    <div class="exp-card" style="margin-top:10px">
      <div class="exp-card-title" style="margin-bottom:8px">Preferences</div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <label class="ilabel" style="margin:0">Show amounts in</label>
        <select class="sfield" data-cur-pref="1" style="width:auto;font-size:0.74rem;padding:5px 8px" onchange="setDisplayCurrency(this.value)">
          ${[['NGN','₦ Naira'],['USD','$ US dollars'],['GBP','£ Pounds'],['NATIVE','Each account\'s own currency']].map(([v,l])=>`<option value="${v}"${S.dashCurrency===v?' selected':''}>${l}</option>`).join('')}
        </select>
      </div>
      <div style="font-size:0.68rem;color:var(--text2);margin-top:10px">The round <b>+</b> and 🎤 buttons can be dragged anywhere on the screen. <span class="sh-link" style="font-size:0.68rem" onclick="fabResetPosition()">Put it back in the corner</span></div>
    </div>
    <div class="exp-card" style="margin-top:10px">
      <div class="exp-card-title" style="margin-bottom:6px">Month</div>
      ${_earlyClosed()
        ?`<div class="exp-card-sub" style="margin-bottom:10px">${_monLabel(_closedThrough())} is closed, so SpendWise is in ${_nextMonLabel(_closedThrough())} and new entries are dated ${fmtDate(todayStr())}. You can reopen it until it really ends.</div><button class="btn btn-g btn-sm btn-full" onclick="reopenMonth()">Reopen ${_monLabel(_closedThrough())}</button>`
        :`<div class="exp-card-sub" style="margin-bottom:10px">Finished with ${MONTHS[new Date().getMonth()]} before it ends? Close it: its interest is added, bills due are posted and SpendWise moves to ${MONTHS[(new Date().getMonth()+1)%12]}, with new entries dated the 1st.</div><button class="btn btn-g btn-sm btn-full" onclick="closeMonthEarly()">Close ${MONTHS[new Date().getMonth()]} now</button>`}
    </div>
    <div class="exp-card" style="margin-top:10px">
      <div class="exp-card-title" style="margin-bottom:6px">Help</div>
      <div class="exp-card-sub" style="margin-bottom:10px">New here? The Guide explains every part of the app. Found a bug or have an idea? Send it straight to the developer.</div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-g btn-sm" style="flex:1" onclick="openGuide()">Open the guide</button>
        <button class="btn btn-g btn-sm" style="flex:1" onclick="reportProblem()">Report a problem</button>
      </div>
      <div style="font-size:0.66rem;color:var(--text3);line-height:1.7;margin-top:10px"><div>Version: v4.8.0</div><div style="color:var(--text3);margin-top:4px">v4.8.0: Analytics is now AI/Analytics and opens on the AI chat. The + menu is replaced by two buttons: + for Quick add and the mic for Say it.</div></div>
    </div>
    <details class="sett-adv" id="sett-adv"${_settAdvOpen?' open':''} ontoggle="_settAdvOpen=this.open">
      <summary>Advanced<span>AI keys, net worth, exchange rates, balance audit</span></summary>
      ${renderApiKeysCard()}
      ${renderNWConfigCard()}
      ${renderFxCard()}
      <div class="exp-card" style="margin-top:10px"><div class="exp-card-title">Balance Audit</div><div class="exp-card-sub">Recomputes each cash account for the current month from records (opening + income − expenses ± transfers ± loan/debtor/investment flows) and flags any gap against the stored balance. Manual balance edits will show as differences.</div><button class="btn btn-p btn-sm" onclick="runBalanceAudit()">Run Audit</button><div id="audit-result" style="margin-top:10px"></div></div>
    </details>
  `;
}
var _settAdvOpen=false; // keep Advanced open across re-renders
function openGuide(){
  navTo('settings');
  const b=[...document.querySelectorAll('#pg-settings .tabs .tab')].find(t=>t.textContent.trim()==='Guide');
  if(b) settTab('guide',b);
}
// "Report a problem": opens the user's own email app, addressed to the
// developer, with the details that help reproduce a bug. No personal data
// (username, balances) is included; the user can add what they want.
const FEEDBACK_EMAIL='ssseyon@gmail.com';
function reportProblem(){
  const body=[
    'What happened (and what did you expect)?','','','',
    'Steps to make it happen again (if you know them):','','','',
    '— Please keep the details below; they help fix it —',
    `App version: ${APP_VERSION}`,
    `Mode: ${typeof DATA_MODE!=='undefined'?DATA_MODE:'?'}`,
    `Page: ${S.page||'?'}`,
    `Screen: ${screen.width}×${screen.height}, ${window.matchMedia('(display-mode: standalone)').matches?'installed app':'browser'}`,
    `Device: ${navigator.userAgent}`,
  ].join('\n');
  location.href=`mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('SpendWise problem report ('+APP_VERSION+')')}&body=${encodeURIComponent(body)}`;
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
        <label style="display:flex;align-items:center;justify-content:space-between;font-size:0.78rem">
          <span>Loans (outstanding) <span style="font-size:0.6rem;color:var(--text3)">— subtracted</span></span>
          <input type="checkbox" id="nwcfg-loans" ${cfg.includeLoans===true?'checked':''} onchange="saveNWConfigFromUI()">
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
  // Explicit opt-in (=== true), so an absent key stays off for existing configs
  cfg.includeLoans=document.getElementById('nwcfg-loans')?.checked===true;
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
  const _fxNow=appNow();
  const _fxFutureKeys=[];
  for(let i=0;i<12;i++){
    const fm=_fxNow.getMonth()+i,fy=_fxNow.getFullYear()+Math.floor(fm/12);
    _fxFutureKeys.push(fxKey((fm%12)+1,fy));
  }
  const allKeys=[...new Set([...Object.keys(FX_RATES),...Object.keys(ovr),..._fxFutureKeys])].sort();
  const m=S.dashMonth,y=S.dashYear;
  const cur=getFxRates(m,y);
  const rows=allKeys.map(k=>{
    const _a=getFxAuto()[k];
    const base=FX_RATES[k]||(_a&&_a.USD?{USD:_a.USD,GBP:_a.GBP}:{});
    const isAuto=!FX_RATES[k]&&!!(_a&&_a.USD);
    const override=ovr[k]||{};
    const usd=override.USD??base.USD??'';
    const gbp=override.GBP??base.GBP??'';
    const isOverridden=!!(override.USD||override.GBP);
    const isCurrentMonth=(k===fxKey(m,y));
    return`<div style="display:grid;grid-template-columns:80px 1fr 1fr auto;gap:6px;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);${isCurrentMonth?'background:var(--bg2);border-radius:6px':''}">
      <span style="font-family:var(--mono);font-size:0.72rem;color:${isOverridden?'var(--accent)':isCurrentMonth?'var(--blue)':'var(--text2)'};font-weight:${isCurrentMonth?'700':'400'}">${k}${isCurrentMonth?' ●':''}${isOverridden?' ✎':isAuto?' ⟳':''}</span>
      <input class="ifield" type="text" id="fx-usd-${k}" value="${usd}" placeholder="USD→₦" style="font-size:0.74rem;padding:4px 7px">
      <input class="ifield" type="text" id="fx-gbp-${k}" value="${gbp}" placeholder="GBP→₦" style="font-size:0.74rem;padding:4px 7px">
      ${isOverridden?`<button class="btn btn-g btn-sm" style="padding:2px 6px;font-size:0.64rem" onclick="clearFxOverride('${k}')">✕</button>`:`<span></span>`}
    </div>`;
  }).join('');
  return`
    <div class="exp-card" style="margin-top:10px">
      <div class="exp-card-title" style="margin-bottom:4px">Exchange Rates (₦ per 1 foreign unit)</div>
      <div class="exp-card-sub" style="margin-bottom:10px">Current month (${String(m).padStart(2,'0')}/${y}): $1 = ₦${cur.USD} &nbsp;|&nbsp; £1 = ₦${cur.GBP}. Rates marked ⟳ are fetched automatically each day for the current month. Edit any row and tap Save to use your own rate instead (marked ✎).</div>
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
  const _fxNow=appNow();
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
    const usd=usdEl?numVal(usdEl):NaN;
    const gbp=gbpEl?numVal(gbpEl):NaN;
    const _a=getFxAuto()[k];
    const base=FX_RATES[k]||(_a&&_a.USD?{USD:_a.USD,GBP:_a.GBP}:{});
    // Only store as override if the value differs from the built-in or automatic rate
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
    try{await fetch('./index.html',{cache:'reload'});}catch(e){console.warn("shell refetch failed",e);}
  }catch(e){console.warn("forceHardRefresh failed",e);}
  window.location.reload();
}
// Pull-to-refresh (Home): reload the data, not the app. Until v4.7 this wiped
// the service worker and its offline copy, so the app wouldn't open offline
// until the next visit online. "Update now" and tapping the version label
// still do the full refresh.
async function forceSyncNow(){
  if(!_dbReady()){toast("You're offline. Showing what's saved on this device.");return;}
  if(DATA_MODE==='cloud')setSyncStatus('syncing');
  const m=S.expMonth,y=S.expYear;
  try{
    await syncAll();
    S.txns=cGet(CK.txns(m,y))||S.txns;
    S.income=cGet(CK.inc(m,y))||S.income;
    S.investments=cGet(CK.inv(m,y))||S.investments;
    S.cash=cGet(CK.cash(m,y))||S.cash;
    S.debtors=cGet(CK.debtors)||S.debtors;
    S.budgets=budgetFor(m,y);
    cSet(CK.lastSync,Date.now());setSyncStatus(DATA_MODE==='local'?'local':'synced');renderAll();startRealtimeListeners();
    runAutoRecurring();runAutoInterest();fxAutoUpdate();
    toast('Up to date');
  }catch(e){console.warn('refresh failed',e);setSyncStatus('error');toast("Couldn't refresh. Try again.");}
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
    const cats={};S.txns.forEach(t=>{cats[t.category]=(cats[t.category]||0)+txNGN(t);});
    const sorted=Object.entries(cats).sort((a,b)=>b[1]-a[1]);
    const total=sorted.reduce((s,[,v])=>s+v,0);
    body=sorted.map(([cat,val])=>fmtRow(cat,fmtCur(val,cur,m,y),'var(--red)')).join('');
    body+=`<div style="display:flex;justify-content:space-between;padding:10px 0;font-weight:700"><span>Total</span><span style="font-family:var(--mono);color:var(--red)">${fmtCur(total,cur,m,y)}</span></div>`;
  }
  else if(type==='income'){
    title=`Income — ${MONTHS[m-1]} ${y}`;
    const sorted=[...S.income].sort((a,b)=>(b.amount||0)-(a.amount||0));
    const total=sorted.reduce((s,i)=>s+txNGN(i),0);
    body=sorted.map(i=>fmtRow(i.category||i.payee||'Income',fmtCur(txNGN(i),cur,m,y),'var(--accent)')).join('');
    body+=`<div style="display:flex;justify-content:space-between;padding:10px 0;font-weight:700"><span>Total</span><span style="font-family:var(--mono);color:var(--accent)">${fmtCur(total,cur,m,y)}</span></div>`;
  }

  else if(type==='networth'){
    title=`Net Worth — ${MONTHS[m-1]} ${y}`;
    const NW=netWorthFor(m,y);
    const inv=NW.invDoc,cash=NW.cashDoc,_nwCfg=NW.cfg,_nwAccts=NW.accts;
    const _fxRNW=getFxRates(m,y);
    const debtOwed=NW.debt;
    body='';
    if(_nwCfg.includeInvestments!==false){
      const visiblePlats=platformsFor(inv).filter(p=>{
        const meta=getInvPlatformMeta(p.key);
        const isFI=meta.assetClass==='fixed_income';
        if(isFI&&_nwCfg.includeFixedIncome===false) return false;
        if(!isFI&&_nwCfg.includeEquities===false) return false;
        return true;
      });
      if(visiblePlats.length){
        body+=`<div style="font-size:0.65rem;font-weight:700;color:var(--text3);text-transform:uppercase;padding:6px 0 4px">Investments</div>`;
        body+=visiblePlats.map(p=>{
          const bal=invBalanceFor(p.key,m,y,inv);
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
      if(NW.retired)body+=fmtRow('Removed platforms (now cash)',fmtCur(NW.retired,cur,m,y),'var(--blue)');
    }
    if(debtOwed){
      body+=`<div style="font-size:0.65rem;font-weight:700;color:var(--text3);text-transform:uppercase;padding:10px 0 4px">Debtors (expected)</div>`;
      body+=nwDebtorRows().map(r=>fmtRow(esc(r.name),fmtCur(r.total,cur,m,y),"var(--gold)")).join("");
    }
    const loanOwed=nwLoansOutstanding(_nwCfg);
    if(loanOwed){
      body+=`<div style="font-size:0.65rem;font-weight:700;color:var(--text3);text-transform:uppercase;padding:10px 0 4px">Loans (owed)</div>`;
      body+=(S.loans||[]).filter(l=>l.status!=='settled').map(l=>{
        const out=Math.max(0,(l.amtNGN||l.amount||0)-(l.repaid||0));
        return out?fmtRow(l.lender,'−'+fmtCur(out,cur,m,y),'var(--red)'):'';
      }).join('');
    }
    body+=`<div style="display:flex;justify-content:space-between;padding:10px 0;font-weight:700;border-top:1px solid var(--border);margin-top:4px"><span>Total Net Worth</span><span style="font-family:var(--mono);color:var(--accent)">${fmtCur(NW.total,cur,m,y)}</span></div>`;
  }
  else if(type==='cash'){
    title=`Cash — ${MONTHS[m-1]} ${y}`;
    const cash=_withAccrued(S.cash,m,y);
    const total=cashTotalNGN(cash,m,y);   // (already includes today's interest; not added twice)
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
    const total=platformsFor(inv).reduce((s,p)=>s+invBalanceFor(p.key,m,y,inv),0);
    body=PLATFORMS.map(p=>{
      const val=invBalanceFor(p.key,m,y,inv);
      const pct=total>0?((val/total)*100).toFixed(1):'0.0';
      return`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="drillDownInvPlatform('${p.key}')"><span style="font-size:0.78rem;color:var(--text2)">${p.label} <span style="font-size:0.58rem;color:var(--text3)">${p.currency} · ${pct}%</span> <span style="font-size:0.6rem;color:var(--text3)">›</span></span><span style="font-family:var(--mono);font-size:0.82rem;color:${val?p.color:'var(--text3)'}">${val?fmtPlatformVal(val,p.key,cur,m,y):'—'}</span></div>`;
    }).join('');
    body+=`<div style="display:flex;justify-content:space-between;padding:10px 0;font-weight:700"><span>Total Portfolio</span><span style="font-family:var(--mono);color:var(--accent)">${fmtCur(total,cur==='NATIVE'?'NGN':cur,m,y)}</span></div>`;
  }
  else if(type==='budget'){
    title=`Budget vs Actual — ${MONTHS[m-1]} ${y}`;
    const cats=Object.keys(S.budgets);
    const actuals={};S.txns.forEach(t=>{actuals[t.category]=(actuals[t.category]||0)+txNGN(t);});
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
// Labels for cash-ledger sources that have no richer record of their own
// (debtor / loan / interest flows). Expenses, income and transfers are shown
// from their own records instead, so they are deliberately absent here.
const LEDGER_SRC_LABELS={
  'debt-add':'Debt disbursed','debt-edit-adjust':'Debt edit adjustment',
  'debt-payment':'Debt repayment received',
  'loan-proceeds':'Loan received','loan-repayment':'Loan repayment',
  'loan-edit-adjust':'Loan edit adjustment',
  'investment-liquidation':'Investment cashed out',
  'debt-remove-reverse':'Debt removed (reversed)','loan-remove-reverse':'Loan removed (reversed)',
};
function drillDownAccount(bankName){
  const m=S.dashMonth,y=S.dashYear,cur=S.dashCurrency;
  const isUSD=isUSDCashAccount(bankName);
  // Everything on this account is stored in the account's own currency, so
  // format in that currency rather than assuming naira.
  const fmtAcct=v=>isUSD
    ?(v<0?'-$':'$')+Math.abs(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})
    :fmtCur(Math.abs(v),cur,m,y);
  const xfrs=cGet(CK.xfr(m,y))||[];
  const mine=xfrs.filter(x=>x.from===bankName||x.to===bankName);
  // Ledger entries cover flows with no record of their own. Skip any that a
  // transfer record already represents (same day + same magnitude) so a single
  // movement is never listed twice.
  const seen=new Set(mine.map(x=>{
    const v=x.from===bankName?x.amount:(x.toAmt!=null?x.toAmt:x.amount);
    return x.date+'|'+Math.round(Math.abs(v));
  }));
  const ledger=(cGet(`sw3_cash_ledger_${y}_${m}`)||[])
    .filter(e=>e.bank===bankName&&LEDGER_SRC_LABELS[e.source])
    .filter(e=>!seen.has((e.date||'')+'|'+Math.round(Math.abs(e.delta))))
    .map(e=>({...e,_type:'led'}));
  const txns=[
    ...S.txns.filter(t=>t.bank===bankName).map(t=>({...t,_type:'exp'})),
    // (a cash-out's interest is already inside its "Investment cashed out" row)
    ...S.income.filter(i=>i.bank===bankName&&i.source!=='liquidation-interest').map(i=>({...i,_type:'inc'})),
    ...mine.map(x=>({...x,_type:'xfr'})),
    ...ledger
  ].sort((a,b)=>a.date>b.date?-1:a.date<b.date?1:txnTs(b.createdAt)-txnTs(a.createdAt));

  const bal=_withAccrued(S.cash,S.cashMonth,S.cashYear)[bankName];
  const balStr=bal!=null?(isUSD?` · $${bal.toFixed(2)}`:`  · ${fN(Math.round(bal))}`):'' ;
  document.getElementById('drill-title').innerHTML=`${esc(bankName)}${balStr} <button class="acct-edit-btn" style="margin-left:6px;vertical-align:middle" title="Edit this account" onclick="closeMod('drill-modal');openAcctEdit('${jsq(bankName)}')">✎</button>`;

  if(!txns.length){
    document.getElementById('drill-body').innerHTML='<div style="color:var(--text3);padding:12px 0">No transactions for this account this month.</div>';
    openMod('drill-modal');return;
  }
  const delBtn=fn=>`<button class="txi-del" title="Delete and reverse the balance change" onclick="event.stopPropagation();${fn}">×</button>`;
  const row=(title,meta,amtHtml,cls,btn)=>`<div class="txi" style="padding:7px 0;border-bottom:1px solid var(--border)">
      <div style="min-width:0;flex:1"><div class="txi-cat">${title}</div><div class="txi-meta">${meta}</div></div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;margin-left:10px">
        <div class="txi-amt ${cls}" style="white-space:nowrap">${amtHtml}</div>${btn||''}
      </div>
    </div>`;

  document.getElementById('drill-body').innerHTML='<div class="txlist">'+txns.map(tx=>{
    const isInc=tx._type==='inc';
    if(tx._type==='xfr'){
      const isOut=tx.from===bankName;
      const counterpart=isOut?tx.to:tx.from;
      // Show THIS account's side: the receiving account gets toAmt (already
      // FX-converted on save), not the sending account's amount.
      const val=isOut?tx.amount:(tx.toAmt!=null?tx.toAmt:tx.amount);
      const badge=`<span style="font-size:0.55rem;font-weight:700;color:var(--gold);background:rgba(250,204,21,0.12);border-radius:3px;padding:1px 4px;margin-left:4px">XFR</span>`;
      const other=isOut
        ?(tx.toAmt!=null&&tx.toAmt!==tx.amount?` (→ ${_xfrAmtDisp(tx.to,tx.toAmt)})`:'')
        :(tx.amount!==val?` (from ${_xfrAmtDisp(tx.from,tx.amount)})`:'');
      return row(`${isOut?'Transfer out':'Transfer in'}${badge}`,
        `${fmtDate(tx.date)} · ${isOut?'→ ':'← '}${esc(_xfrSideLabel(counterpart))}${other}${tx.notes?' · '+esc(tx.notes):''}`,
        `${isOut?'−':'+'}${fmtAcct(val)}`, isOut?'txi-exp':'txi-inc',
        delBtn(`reverseTransferFromAccount('${jsq(tx.id)}','${jsq(bankName)}')`));
    }
    if(tx._type==='led'){
      const inflow=tx.delta>0;
      return row(`${LEDGER_SRC_LABELS[tx.source]||tx.source}<span style="font-size:0.55rem;font-weight:700;color:var(--text3);background:var(--bg3);border-radius:3px;padding:1px 4px;margin-left:4px">AUTO</span>`,
        `${fmtDate(tx.date)}`,
        `${inflow?'+':'−'}${fmtAcct(tx.delta)}`, inflow?'txi-inc':'txi-exp',
        `<span style="font-size:0.55rem;color:var(--text3);white-space:nowrap" title="Delete this from the Loans or Debtors page">via record</span>`);
    }
    const icon=tx.category?(CAT_ICONS[tx.category]||''):'';
    const cat=tx.category||(isInc?'Income':'—');
    const sub=isInc?(tx.notes||''):(tx.payee&&tx.payee!==cat?esc(tx.payee):'')+(tx.notes?` · ${esc(tx.notes)}`:'');
    const amt=`${isInc?'+':'−'}${fmtAcct(tx.amount)}`;
    const badge=isInc?`<span style="font-size:0.55rem;font-weight:700;color:var(--accent);background:rgba(52,211,153,0.12);border-radius:3px;padding:1px 4px;margin-left:4px">INC</span>`:'';
    return`<div class="txi" style="padding:7px 0;border-bottom:1px solid var(--border)">
      <div style="min-width:0;flex:1">
        <div class="txi-cat">${icon?icon+'\u00a0':''}${esc(cat)}${badge}</div>
        <div class="txi-meta">${fmtDate(tx.date)}${sub?' · '+sub:''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;margin-left:10px">
        <div class="txi-amt ${isInc?'txi-inc':'txi-exp'}" style="white-space:nowrap">${amt}</div>
        ${delBtn(`deleteFromAccount('${isInc?'inc':'exp'}','${jsq(tx.id)}','${jsq(bankName)}')`)}
      </div>
    </div>`;
  }).join('')+'</div>'
    +`<div class="csub" style="margin-top:8px">Deleting reverses the balance change on this account. Rows marked AUTO come from a loan, debt or interest record — delete those from their own page.</div>`;
  openMod('drill-modal');
}
// Delete an expense/income straight from the account view. delExpense and
// delIncome already restore the account balance, so this just re-opens the
// drill-down on the refreshed data.
function deleteFromAccount(kind,id,bankName){
  const rec=kind==='inc'?S.income.find(i=>i.id===id):S.txns.find(t=>t.id===id);
  if(!rec){toast('Not found');return;}
  const label=kind==='inc'?(rec.category||'income'):(rec.payee||rec.category||'expense');
  if(!confirm(`Delete "${label}"?\n\n${bankName} will be adjusted back by this amount.`))return;
  if(kind==='inc') delIncome(id); else delExpense(id);
  setTimeout(()=>{try{drillDownAccount(bankName);}catch(e){console.warn("account drill-down refresh failed",e);}},350);
}
async function reverseTransferFromAccount(recId,bankName){
  await reverseTransfer(recId);   // confirms, restores both sides, drops the record
  setTimeout(()=>{try{drillDownAccount(bankName);}catch(e){console.warn("account drill-down refresh failed",e);}},350);
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
        // The platform's side of the transfer is always naira (toAmt for money
        // in; for money out, `amount` is the platform side).
        const amt=`${isOut?'−':'+'}${fmtCur(isOut?x.amount:(x.toAmt!=null?x.toAmt:x.amount),cur,m,y)}`;
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
  if(opening>0.005) adds.push({date:d.date||'',amount:opening,note:'Original loan',acct:d.disbursedFrom||d.acct||'',_k:'add'});
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
    {date:l.startDate||'',amount:principal,note:'Loan received',acct:l.disbursedTo||l.acct||'',_k:'orig'}
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
  const total=_catPopupTxns.reduce((s,t)=>s+txNGN(t),0);

  let listHTML='';
  if(_catPopupSort==='date'){
    // Group by date, sorted most-recent first
    const byDate={};
    _catPopupTxns.forEach(tx=>{const d=tx.date||'';(byDate[d]=byDate[d]||[]).push(tx);});
    const dates=Object.keys(byDate).sort((a,b)=>a>b?-1:1);
    listHTML=dates.map(d=>{
      const dayTxns=byDate[d].sort((a,b)=>(b.amount||0)-(a.amount||0));
      const dayTotal=dayTxns.reduce((s,t)=>s+txNGN(t),0);
      return`<div style="padding:6px 0 2px;font-size:0.68rem;font-weight:600;color:var(--text3);display:flex;justify-content:space-between;border-top:1px solid var(--border);margin-top:4px">
        <span>${fmtDate(d)}</span><span style="font-family:var(--mono);color:var(--text2)">${fmtCur(dayTotal,cur,m,y)}</span></div>
        ${dayTxns.map(tx=>`
        <div class="txi" style="padding:6px 0 6px 10px" onclick="openEditExpense('${tx.id}');closeMod('drill-modal')">
          <div style="flex:1;min-width:0">
            <div class="txi-cat" style="font-size:0.74rem">${esc(tx.payee)||'—'}</div>
            ${tx.notes?`<div class="txi-meta">${esc(tx.notes)}</div>`:''}
          </div>
          <div class="txi-amt txi-exp">${fmtCur(txNGN(tx),cur,m,y)}${txFxNote(tx)}</div>
        </div>`).join('')}`;
    }).join('');
  } else {
    // Group by actual expense (payee), sorted by group total desc
    const byExpense={};
    _catPopupTxns.forEach(tx=>{const key=tx.payee||'—';(byExpense[key]=byExpense[key]||[]).push(tx);});
    const groups=Object.entries(byExpense)
      .map(([name,txns])=>({name,txns,total:txns.reduce((s,t)=>s+txNGN(t),0)}))
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
          <div class="txi-amt txi-exp">${fmtCur(txNGN(tx),cur,m,y)}${txFxNote(tx)}</div>
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
// ONLINE/OFFLINE
// ══════════════════════════════════════════════════════════════════════════
// Local mode reads IndexedDB, so connectivity only matters when signed in.
function _dbReady(){return !!db&&(db.isLocal||navigator.onLine);}
window.addEventListener('online',()=>{
  document.getElementById('offl').style.display='none';
  if(DATA_MODE==='cloud'&&db){
    setSyncStatus('syncing');
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
window.addEventListener('offline',()=>{if(DATA_MODE!=='cloud')return;document.getElementById('offl').style.display='block';setSyncStatus('offline');});
if(!navigator.onLine&&!localStorage.getItem(LOCAL_MODE_LS)) document.getElementById('offl').style.display='block';
['exp-modal','deb-modal','merge-cat-modal'].forEach(id=>{const el=document.getElementById(id);if(el)el.addEventListener('click',function(e){if(e.target===this)closeMod(id);});});
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});


// ── Version check against GitHub Pages ──
const APP_VERSION='v4.8.0';
async function checkForUpdate(){
  try{
    const res=await fetch(location.origin+location.pathname+'?_='+Date.now(),{cache:'no-store'});
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
  }catch(e){_warnLoad("checkForUpdate",e);}
}
// BOOT — this device's data copy loads from IndexedDB first (a few ms), then
// the app starts. Notification permission is only asked from the 🔔 panel.
cacheInit().then(initFirebase);
setTimeout(checkForUpdate, 3000); // check after initial load settles

// ══════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════
// ── Withdrawal-aware accrual movements ──────────────────────────────────
// delta: positive = deposit, negative = withdrawal
function getInvMovements(){return cGet(INV_MOVE_KEY)||[];}
function addInvMovement(pKey,delta,date,notes){
  if(!delta) return;
  const list=getInvMovements();
  list.push({platformKey:pKey,delta:Math.round(delta),date:date||todayStr(),notes:notes||''});
  cSet(INV_MOVE_KEY,list.slice(-500));
  _syncInvConfig(); // synced with the investment settings (v4.7)
}

// ══════════════════════════════════════════════════════════════════════════
// MONTHLY SAVINGS TARGET
// ══════════════════════════════════════════════════════════════════════════
// Kept in the synced profile since v4.7 (it used to stay on one device).
function getSavingsTarget(){const p=getProfile()||{};return parseFloat(p.savingsTargetPct!=null?p.savingsTargetPct:cGet(SAVINGS_TARGET_KEY))||0;}
function saveSavingsTarget(pct){saveProfile({savingsTargetPct:pct});}
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
  const now=appNow();
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
  const prev=netWorthFor(prevM,prevY);
  if(!prev.hasData||!prev.total)return'';
  const delta=netWorthFor(m,y).total-prev.total;if(!Math.round(delta))return'';
  const pct=Math.round(Math.abs(delta)/Math.abs(prev.total)*100);
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
// History without the month in progress (averages and projections).
function _completedHistory(){const n=appNow(),k=n.getFullYear()*100+n.getMonth()+1;return getHistory().filter(h=>h.year*100+h.month<k);}
function renderCashFlowProjection(containerEl){
  if(!containerEl)return;
  const hist=_completedHistory().filter(h=>h.income>0||h.expenses>0).slice(-6);
  if(hist.length<2){containerEl.innerHTML='<div class="csub" style="padding:8px 0">Need more history for projection</div>';return;}
  const avgInc=hist.reduce((s,h)=>s+(h.income||0),0)/hist.length;
  const avgExp=hist.reduce((s,h)=>s+(h.expenses||0),0)/hist.length;
  const cashNow=cashTotalNGN(S.cash);
  let monthlyInt=0;
  const intMeta=getCashInterestMeta();
  getCashAccounts().forEach(b=>{const ci=intMeta[b];if(ci&&ci.interestRate)monthlyInt+=(S.cash[b]||0)*(ci.interestRate/100/12);});
  PLATFORMS.forEach(p=>{const meta=getInvPlatformMeta(p.key);if(meta.assetClass==='fixed_income'&&meta.interestRate)monthlyInt+=(S.investments[p.key]||0)*(meta.interestRate/100/12);});
  const netPerMonth=avgInc+monthlyInt-avgExp;
  const now=appNow();let runningCash=cashNow;
  const months=[];
  for(let i=1;i<=3;i++){const d=new Date(now.getFullYear(),now.getMonth()+i,1);runningCash+=netPerMonth;months.push({label:MS[d.getMonth()]+" '"+String(d.getFullYear()).slice(2),cash:Math.round(runningCash)});}
  const breakEven=avgExp>avgInc+monthlyInt&&cashNow>0?Math.ceil(cashNow/(avgExp-avgInc-monthlyInt)):null;
  containerEl.innerHTML=`
    <div class="sh" style="margin-bottom:10px"><div class="sh-title">3-Month Cash Projection</div></div>
    <div class="pjrow"><span class="pjlabel">Avg. monthly income (6m)</span><span class="pjval" style="color:var(--accent)">${fC(Math.round(avgInc))}</span></div>
    ${monthlyInt>500?`<div class="pjrow"><span class="pjlabel">Est. monthly interest</span><span class="pjval" style="color:var(--gold)">+${fC(Math.round(monthlyInt))}</span></div>`:''}
    <div class="pjrow"><span class="pjlabel">Avg. monthly spend (6m)</span><span class="pjval" style="color:var(--red)">${fC(Math.round(avgExp))}</span></div>
    <div class="pjrow" style="font-weight:700;border-top:1px solid var(--border);padding-top:6px;margin-top:4px"><span>Monthly net</span><span class="pjval" style="color:${netPerMonth>=0?'var(--accent)':'var(--red)'}">${fC(Math.round(Math.abs(netPerMonth)))} ${netPerMonth>=0?'saved':'deficit'}</span></div>
    <div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px">
      <div style="font-size:0.6rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--text3);margin-bottom:6px">Projected Cash Balance</div>
      ${months.map(mo=>`<div class="pjrow"><span class="pjlabel">${mo.label}</span><span class="pjval" style="color:${mo.cash>0?'var(--blue)':'var(--red)'}">${fC(mo.cash)}</span></div>`).join('')}
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
  const allKeys=cKeys('sw3_txns_');
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
    const allTxnKeys=cKeys('sw3_txns_');
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
      saveCustomLines();
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

    // ── 4. Merge the standard budget and every cached month budget ─────
    const _mergeCats=c=>{const f=+c[fromKey]||0;if(!f)return false;c[intoKey]=(+c[intoKey]||0)+f;c[fromKey]=0;return true;};
    const std={...DEF_BUDGETS};if(_mergeCats(std))saveProfile({defBudgets:std});
    cKeys('sw3_bud_').forEach(k=>{const o=cGet(k);if(o&&o.categories&&_mergeCats(o.categories))cSet(k,o);});
    S.budgets=budgetFor(S.expMonth,S.expYear);

    // ── 5. Remove source from custom cats list (if custom) ─────────────
    if(!_BASE_CATS.includes(_mergeFrom)){
      const custom=getCustomCats().filter(c=>c!==_mergeFrom);
      saveCustomCats(custom);
    }

    closeMod('merge-cat-modal');
    // Bust all transaction localStorage caches — the Firestore docs were just
    // updated in batch, so every month loaded after this will come from the
    // correct (renamed) Firestore data via the snapshot listener.
    cKeys('sw3_txns_').concat(cKeys('sw3_inc_')).forEach(cDel);
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
    // Home only (owner's choice, v4.6.2). Elsewhere, scrolling up inside lists,
    // forms and the AI chat kept triggering accidental refreshes.
    if(S.page!=='dashboard') return;
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
      setTimeout(()=>{forceSyncNow().finally(()=>{spin.remove();_resetPtr();});}, 300);
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
// the user's complete financial history. Uses the user's own Gemini key if
// they added one (appConfig/aiKeys, encrypted like all their data), otherwise
// the shared key the owner publishes at publicConfig/aiKeys.
// ══════════════════════════════════════════════════════════════════════════
// var + function declarations (not const/let): renderAll() runs during init,
// before this end-of-file module body executes — hoisting keeps that safe.
var AI_CHATS_LS='sw3_ai_chats', AI_ACTIVE_LS='sw3_ai_active';
var AI_KEYS_LS='sw3_gemini_keys', AI_ACTIVE_KEY_LS='sw3_gemini_active_key';
// Tried in order until one answers. gemini-flash-latest is Google's
// hot-swapped alias: it tracks the newest GA Flash without a code change, so
// this list does not need editing when the next model ships. The pinned ids
// below it are the fallback chain (newest first) for keys or regions where the
// alias is not served, and for when the alias itself is mid-swap.
var AI_MODELS=['gemini-flash-latest','gemini-3.8-flash','gemini-3.7-flash','gemini-3.6-flash','gemini-3.5-flash'];
// "gemini-flash-latest".replace('gemini-','Gemini ') reads as "Gemini
// flash-latest", so format deliberately.
function _aiModelLabel(id){
  if(!id) return '';
  if(id==='gemini-flash-latest') return 'Gemini Flash (latest)';
  const m=/^gemini-([\d.]+)-(.+)$/.exec(id);
  return m?`Gemini ${m[1]} ${m[2].charAt(0).toUpperCase()+m[2].slice(1)}`:id;
}

// ── AI-generated charts ────────────────────────────────────────────────────
// The model may emit one ```spendwise-chart fenced block per reply holding a
// small, strict JSON spec. _aiMd turns it into a <canvas>; _aiMountCharts then
// instantiates Chart.js against it after the HTML is in the DOM.
//
// The schema is deliberately NOT Chart.js-shaped (series/name/data, not
// datasets): given "datasets" the model helpfully emits a full Chart.js config
// with colours and nested options, which defeats theming and widens the parse
// surface. Colours come from CSS vars so charts follow light/dark.
var _aiCharts={};      // canvasId -> Chart instance currently on screen
var _aiChartQueue=[];  // {id,spec} produced during _aiMd, drained on mount

function _aiDestroyCharts(){
  for(const k in _aiCharts){try{_aiCharts[k].destroy();}catch(e){}}
  _aiCharts={};
}
// Returns a normalised spec or null. NEVER throws: a hallucinated chart must
// not break the reply around it.
function _aiChartValidate(raw){
  if(!raw||typeof raw!=='object') return null;
  let type=String(raw.type||'').toLowerCase();
  if(type==='pie') type='doughnut';                     // the model reaches for "pie"
  if(['bar','line','doughnut'].indexOf(type)<0) return null;
  const labels=Array.isArray(raw.labels)?raw.labels.map(l=>String(l)):null;
  if(!labels||!labels.length||labels.length>24) return null;
  let series=Array.isArray(raw.series)?raw.series:null;
  if(!series||!series.length||series.length>3) return null;
  if(type==='doughnut') series=series.slice(0,1);       // one ring only
  const out=[];
  for(const s of series){
    if(!s||!Array.isArray(s.data)) return null;
    const data=s.data.map(v=>Number(v));
    if(data.length!==labels.length) return null;
    if(data.some(v=>!isFinite(v))) return null;
    out.push({name:String(s.name||''),data});
  }
  return {type,title:String(raw.title||''),labels,series:out,stacked:type==='bar'&&raw.stacked===true};
}
// Same CSS-var approach the cash-flow chart uses, so charts match the theme.
function _aiChartTheme(){
  const cs=getComputedStyle(document.body), v=n=>(cs.getPropertyValue(n)||'').trim();
  return {
    tick:v('--text3')||'#888',
    grid:v('--border')||'#333',
    palette: [v('--accent')||'#14b8a6', v('--blue')||'#60a5fa', v('--gold')||'#fbbf24',
         v('--red')||'#f87171', '#c084fc', '#94a3b8'],
  };
}
function _aiChartHtml(rawJson,key,n){
  let spec=null;
  try{ spec=_aiChartValidate(JSON.parse(rawJson)); }
  catch(err){ console.warn('AI chart JSON rejected',err); }
  if(!spec) return '<div class="ai-chartfail">Chart unavailable</div>';
  const id='ai-cht-'+String(key).replace(/[^A-Za-z0-9_-]/g,'')+'-'+n;
  _aiChartQueue.push({id,spec});
  return `<div class="ai-chart">${spec.title?`<div class="ai-chart-t">${esc(spec.title)}</div>`:''}<div class="ai-chart-c"><canvas id="${id}"></canvas></div></div>`;
}
function _aiMountCharts(){
  if(typeof Chart==='undefined'){_aiChartQueue=[];return;}
  const th=_aiChartTheme();
  const q=_aiChartQueue; _aiChartQueue=[];
  q.forEach(({id,spec})=>{
    const cv=document.getElementById(id);
    if(!cv) return;
    try{
      const single=spec.series.length===1;
      const datasets=spec.series.map((s,i)=>spec.type==='doughnut'
        ? {data:s.data,backgroundColor:spec.labels.map((_,j)=>th.palette[j%th.palette.length]),borderWidth:0}
        : {label:s.name||undefined,data:s.data,
           backgroundColor:spec.type==='line'?'transparent':th.palette[i%th.palette.length],
           borderColor:th.palette[i%th.palette.length],borderWidth:spec.type==='line'?2:0,
           borderRadius:spec.type==='bar'?3:0,tension:0.3,pointRadius:spec.type==='line'?3:0});
      _aiCharts[id]=new Chart(cv.getContext('2d'),{
        type:spec.type,
        data:{labels:spec.labels,datasets},
        options:{
          responsive:true,maintainAspectRatio:false,
          plugins:{
            legend:{display:spec.type==='doughnut'||!single,
              labels:{color:th.tick,boxWidth:10,font:{size:9}}},
            tooltip:{callbacks:{label:c=>{
              const val=spec.type==='doughnut'?c.parsed:c.parsed.y;
              return (c.dataset.label?c.dataset.label+': ':'')+fmtChartNGN(Number(val)||0);
            }}}
          },
          scales:spec.type==='doughnut'?{}:{
            x:{stacked:spec.stacked,grid:{display:false},ticks:{color:th.tick,font:{size:9}},border:{display:false}},
            y:{stacked:spec.stacked,grid:{color:th.grid},ticks:{color:th.tick,font:{size:9},callback:v=>fmtChartNGN(v)},border:{display:false}}
          }
        }
      });
    }catch(e){
      console.warn('AI chart render failed',id,e);
      const w=cv.closest('.ai-chart');
      if(w) w.outerHTML='<div class="ai-chartfail">Chart unavailable</div>';
    }
  });
}
var _aiCtx=null,_aiCtxAt=0,_aiBusy=false;
// True while composing a brand-new, not-yet-sent conversation (device-local).
var _aiNewMode=false;

// ── Multi-key store (Data tab) ──────────────────────────────────────────────
// Several Gemini API keys can be saved (e.g. separate Google accounts to work
// around free-tier rate limits); one is "active" at a time. Synced across
// devices via appConfig/aiKeys (same pattern as recurring/goals/rules), with
// localStorage as the offline-first cache — so keys survive a hard refresh /
// storage eviction because they're reloaded from Firestore on every boot.
function _aiNewKeyId(){return 'k'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
function _aiKeys(){
  if(!Array.isArray(S.aiKeys)){const keys=cGet(AI_KEYS_LS);S.aiKeys=Array.isArray(keys)?keys:[];}
  return S.aiKeys;
}
// Write-through: cache locally, then push the whole list + active pointer to
// Firestore so every device stays in sync. Called only on explicit user edits
// (add/edit/delete/switch) — never on load, so a fresh device can't blank the
// cloud copy before it has fetched it.
function _aiSyncKeys(){
  cSet(AI_KEYS_LS,_aiKeys());
  if(db) db.collection('appConfig').doc('aiKeys')
    .set({list:_aiKeys(),activeId:cGet(AI_ACTIVE_KEY_LS)||'',updatedAt:FV.serverTimestamp()},{merge:true})
    .catch(e=>console.warn('aiKeys sync failed',e));
}
async function loadAiKeys(){
  if(!db) return;
  try{
    const doc=await db.collection('appConfig').doc('aiKeys').get();
    if(doc.exists){
      const d=doc.data()||{};
      if(Array.isArray(d.list)){
        cSet(AI_KEYS_LS,d.list);
        S.aiKeys=d.list;
        if(typeof d.activeId==='string'&&d.activeId) cSet(AI_ACTIVE_KEY_LS,d.activeId);
      }
    }else{
      // No cloud copy yet — seed it from whatever this device already holds so
      // pre-existing local keys start syncing instead of being stranded.
      if(_aiKeys().length) _aiSyncKeys();
    }
  }catch(e){_warnLoad('loadAiKeys',e);}
}
function _aiActiveKeyId(){
  const keys=_aiKeys();
  const id=cGet(AI_ACTIVE_KEY_LS)||'';
  if(id&&keys.some(k=>k.id===id)) return id;
  return keys[0]?.id||''; // stale/missing pointer — fall back to the first saved key
}
function _aiKey(){
  const k=_aiKeys().find(k=>k.id===_aiActiveKeyId());
  if(k&&k.key) return k.key;
  return _aiSharedKey(); // no key of their own → the app's shared key
}

// ── Shared Gemini keys (v4.5) ──
// The owner's keys, published at publicConfig/aiKeys (readable by anyone,
// writable only by OWNER_UID per firestore.rules), so AI works for every user
// without them creating a key. A user's own key, if they add one, wins.
// Read through the raw Firestore handle so it works signed out too.
var AI_SHARED_LS='sw3_shared_ai_keys'; // var, not const: settings render at boot, before this line runs
function _aiShared(){return cGet(AI_SHARED_LS)||{list:[],activeId:''};}
function _aiSharedKey(){const s=_aiShared();const k=(s.list||[]).find(x=>x.id===s.activeId)||(s.list||[])[0];return k?k.key:'';}
function isOwner(){return !!(typeof OWNER_UID==='string'&&OWNER_UID&&VAULT.uid===OWNER_UID&&DATA_MODE==='cloud');}
async function loadSharedAiKeys(){
  if(!VAULT.raw) return;
  try{
    const d=await VAULT.raw.collection('publicConfig').doc('aiKeys').get();
    cSet(AI_SHARED_LS,d.exists?{list:d.data().list||[],activeId:d.data().activeId||''}:{list:[],activeId:''});
  }catch(e){_warnLoad('loadSharedAiKeys',e);}
}
async function publishSharedAiKeys(){
  if(!isOwner()){toast('Only the app owner can do this');return;}
  const list=_aiKeys().filter(k=>k.key);
  if(!list.length){toast('Add a key first');return;}
  try{
    await VAULT.raw.collection('publicConfig').doc('aiKeys').set({list,activeId:_aiActiveKeyId(),updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
    cSet(AI_SHARED_LS,{list,activeId:_aiActiveKeyId()});
    toast('Shared with everyone');renderSettData();
  }catch(e){console.warn('shared key publish failed',e);toast("Couldn't publish: "+(e.code||e.message));}
}
function renderApiKeysCard(){
  const keys=_aiKeys();
  const activeId=_aiActiveKeyId();
  const rows=keys.map(k=>{
    const isActive=k.id===activeId;
    const masked=k.key?('•'.repeat(Math.max(0,k.key.length-4))+k.key.slice(-4)):'';
    return`<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding:7px 0;border-bottom:1px solid var(--border)">
      <label style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;cursor:pointer">
        <input type="radio" name="ai-active-key" ${isActive?'checked':''} onchange="setActiveAiKey('${jsq(k.id)}')">
        <div style="min-width:0">
          <div style="font-size:0.76rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(k.label||'Untitled key')}${isActive?' <span style="color:var(--accent);font-size:0.6rem">● ACTIVE</span>':''}</div>
          <div style="font-size:0.64rem;color:var(--text3);font-family:var(--mono)">${masked}</div>
        </div>
      </label>
      <div style="display:flex;gap:4px;flex-shrink:0">
        <button class="btn btn-g btn-sm" style="padding:2px 7px;font-size:0.64rem" onclick="editAiKey('${jsq(k.id)}')">✎</button>
        <button class="btn btn-d btn-sm" style="padding:2px 7px;font-size:0.64rem" onclick="deleteAiKey('${jsq(k.id)}')">✕</button>
      </div>
    </div>`;
  }).join('')||'<div style="font-size:0.7rem;color:var(--text3);padding:2px 0 6px">No API keys saved yet.</div>';
  const shared=_aiShared(),hasShared=(shared.list||[]).length>0;
  const intro=isOwner()
    ?`Your keys, encrypted in your account. <b>Everyone else uses the shared key</b> (${hasShared?shared.list.length+' published':'none published yet'}). After changing keys here, publish them again.`
    :hasShared
      ?`AI is included: the AI Analyst uses SpendWise's shared key. You don't need to add anything. Optionally add your own Gemini key below and it will be used instead.`
      :`Add a Gemini API key to use the AI Analyst (AI/Analytics → AI).`;
  return`<div class="exp-card" style="margin-top:10px">
    <div class="exp-card-title" style="margin-bottom:6px">AI API Keys</div>
    <div class="exp-card-sub" style="margin-bottom:10px">${intro}</div>
    ${isOwner()?`<button class="btn btn-inc btn-sm btn-full" style="margin-bottom:8px" onclick="publishSharedAiKeys()">Publish my keys as the shared keys</button>`:''}
    ${keys.length||isOwner()||!hasShared?rows:''}
    <div style="display:flex;gap:6px;margin-top:10px">
      <input class="ifield" id="new-ai-key-label" placeholder="Label (e.g. Personal)" style="flex:1;font-size:0.74rem;padding:6px 10px">
    </div>
    <div style="display:flex;gap:6px;margin-top:6px">
      <input class="ifield" id="new-ai-key-value" type="password" autocomplete="off" placeholder="Paste Gemini API key" style="flex:1;font-size:0.74rem;padding:6px 10px" onkeydown="if(event.key==='Enter')addAiKey()">
      <button class="btn btn-p btn-sm" onclick="addAiKey()">+ Add</button>
    </div>
  </div>`;
}
function addAiKey(){
  const labelEl=document.getElementById('new-ai-key-label');
  const valEl=document.getElementById('new-ai-key-value');
  const label=(labelEl?.value||'').trim();
  const key=(valEl?.value||'').trim();
  if(!key){toast('Paste an API key first');return;}
  const keys=_aiKeys();
  const id=_aiNewKeyId();
  keys.push({id,label:label||`Key ${keys.length+1}`,key});
  if(!cGet(AI_ACTIVE_KEY_LS)) cSet(AI_ACTIVE_KEY_LS,id); // first key ever — make it active
  _aiSyncKeys();
  if(labelEl)labelEl.value='';if(valEl)valEl.value='';
  toast('API key saved');haptic([8]);
  renderSettData();renderProjAI();
}
function setActiveAiKey(id){
  cSet(AI_ACTIVE_KEY_LS,id);
  _aiSyncKeys();
  toast('Active key switched');haptic([8]);
  renderSettData();renderProjAI();
}
function editAiKey(id){
  const k=_aiKeys().find(x=>x.id===id);if(!k)return;
  const newLabel=prompt('Label',k.label||'');
  if(newLabel===null)return;
  const newKey=prompt('API key',k.key||'');
  if(newKey===null)return;
  const v=newKey.trim();
  if(!v){toast('API key cannot be empty');return;}
  k.label=newLabel.trim()||k.label;k.key=v;
  _aiSyncKeys();
  toast('API key updated');
  renderSettData();renderProjAI();
}
function deleteAiKey(id){
  const keys=_aiKeys();
  const idx=keys.findIndex(x=>x.id===id);if(idx===-1)return;
  const k=keys[idx];
  if(!confirm(`Delete API key "${k.label||'Untitled'}"?`))return;
  keys.splice(idx,1);
  if(cGet(AI_ACTIVE_KEY_LS)===id) cSet(AI_ACTIVE_KEY_LS,keys[0]?.id||'');
  _aiSyncKeys();
  toast('API key deleted');haptic([8]);
  renderSettData();renderProjAI();
}
function goToApiKeys(){
  navTo('settings');
  const tabBtn=document.querySelector('#pg-settings .tabs .tab');
  if(tabBtn) settTab('data',tabBtn);
  // The keys card lives in the collapsed Advanced section.
  _settAdvOpen=true;const adv=document.getElementById('sett-adv');if(adv)adv.open=true;
  setTimeout(()=>(document.getElementById('new-ai-key-label')?.closest('.exp-card')||adv)?.scrollIntoView({behavior:'smooth',block:'start'}),50);
}

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
async function loadAiChats(){
  if(!db)return;
  try{
    const snap=await db.collection('aiChats').get();
    const chats=snap.docs.map(d=>({id:d.id,...d.data()}));
    _aiSortChats(chats);
    S.aiChats=chats;cSet(AI_CHATS_LS,chats);
  }catch(e){_warnLoad('loadAiChats',e);}
}

function renderProjAI(){
  const el=document.getElementById('proj-ai');if(!el)return;
  // MANDATORY before any innerHTML rebuild: canvas ids are deterministic, and
  // Chart.js throws "Canvas is already in use" if an id is reused against a
  // detached canvas. Both this function and the aiChats snapshot listener
  // rebuild the pane, and both come through here.
  _aiDestroyCharts(); _aiChartQueue=[];
  if(!Array.isArray(AI_MODELS))return; // init-time call lands before module vars are assigned; projTab re-renders on open
  if(!_aiKey()){
    el.innerHTML=`<div class="card">
      <div class="clabel">AI Analyst — Setup</div>
      <div class="csub" style="margin-bottom:6px">Ask anything about your money — a Gemini-powered analyst reads your entire history (every expense, income, transfer, balance, loan, debtor and investment) and answers with your real numbers.</div>
      <div class="csub" style="margin-bottom:10px">Add a free Gemini API key to get started. It's saved in your account (encrypted like the rest of your data) so it works on all your devices. Get one at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style="color:var(--accent)">aistudio.google.com/apikey</a>.</div>
      <button class="btn btn-p btn-sm" onclick="goToApiKeys()">Add API Key</button>
    </div>`;
    return;
  }
  const chats=_aiChats();
  const active=_aiResolveActive();          // null while composing a new chat
  const list=active?active.msgs:[];
  // Chart canvas ids must be deterministic per (chat, message) so a re-render
  // reuses them - _aiDestroyCharts() below clears the old instances first.
  const _cid=(active&&active.id)||"new";
  const msgs=list.map((m,mi)=>
    m.r==='u'?`<div class="ai-msg ai-u">${esc(m.t)}</div>`
    :m.r==='e'?`<div class="ai-msg ai-err">⚠ ${esc(m.t)}</div>`
    :`<div class="ai-msg ai-m">${_aiMd(m.t,_cid+"_"+mi)}${m.mdl?`<div style="font-size:0.58rem;color:var(--text3);margin-top:6px;text-align:right">${esc(_aiModelLabel(m.mdl))}</div>`:''}</div>`).join('');
  // Offer a one-tap retry when the conversation ended on a failed reply
  const retryBtn=(!_aiBusy&&list.length&&list[list.length-1].r==='e')
    ?`<div style="margin:4px 0 2px"><button class="btn btn-g btn-sm" onclick="aiRetry()" title="Send the last question again">↻ Retry</button></div>`:'';
  const chips=list.length?'':`<div class="ai-chips">${[
    'Give me a deep-dive report on my finances',
    'Where can I realistically cut back?',
    'How has my spending trended over the last 6 months?',
    'Am I on track this month?',
  ].map(q=>`<button class="ai-chip" onclick="aiAsk('${jsq(q)}')">${esc(q)}</button>`).join('')}</div>`;
  // Show what actually answered in this conversation, not what we would try
  // first - with an alias at the head, the aspirational badge would mislead.
  const _lastMdl=(list.slice().reverse().find(x=>x.r==='m'&&x.mdl)||{}).mdl;
  const model=_lastMdl||AI_MODELS[0];
  // Conversation picker — shown once there is at least one saved chat (or a new
  // one being composed alongside existing ones).
  const opts=chats.map(c=>`<option value="${esc(c.id)}"${active&&active.id===c.id?' selected':''}>${esc(c.title||'Conversation')}</option>`).join('');
  const newOpt=active?'':`<option value="__new__" selected>✦ New conversation…</option>`;
  const showBar=chats.length>0;
  const chatBar=showBar?`<div class="ai-chatbar">
      <select class="ifield ai-chatsel" onchange="aiSelectChat(this.value)" ${_aiBusy?'disabled':''}>${newOpt}${opts}</select>
      ${active?`<button class="btn btn-g btn-sm" onclick="aiShareChat()" title="Share this conversation (WhatsApp, etc.)">📤</button><button class="btn btn-g btn-sm" onclick="aiRenameChat()" title="Rename this conversation">✎</button><button class="btn btn-g btn-sm" onclick="aiDeleteChat()" title="Delete this conversation on all your devices">🗑</button>`:''}
    </div>`:'';
  el.innerHTML=`<div class="card" style="padding:12px 14px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
      <div class="clabel" style="margin:0">AI Analyst<span class="ai-badge">${esc(_aiModelLabel(model))}</span></div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-g btn-sm" onclick="aiNewChat()" title="Start a new conversation" ${_aiBusy?'disabled':''}>＋ New</button>
        <button class="btn btn-g btn-sm" onclick="goToApiKeys()" title="Manage API keys">Keys…</button>
      </div>
    </div>
    ${chatBar}
    <div class="csub" style="margin:8px 0">Grounded in your full history — expenses, income, transfers, balances, loans, debtors, investments.</div>
    <div class="ai-log" id="ai-log">${msgs||`<div class="empty" style="padding:16px 0"><div class="empty-i">✦</div>Ask anything about your money.<br>Your entire history is the context.</div>`}${retryBtn}${_aiBusy?'<div class="ai-msg ai-m ai-typing"><span></span><span></span><span></span></div>':''}</div>
    ${chips}
    <div class="ai-inrow">
      <textarea class="ifield" id="ai-input" rows="1" placeholder="Ask about your finances…" style="flex:1;font-size:0.76rem" ${_aiBusy?'disabled':''} onkeydown="aiInputKey(event)" oninput="aiGrowInput(this)"></textarea>
      ${voiceSupported()?`<button class="ai-mic" id="ai-mic" onclick="aiVoice()" title="Speak your question" aria-label="Speak your question" ${_aiBusy?'disabled':''}>🎤</button>`:''}
      <button class="btn btn-p" onclick="aiSend()" ${_aiBusy?'disabled':''} style="padding:9px 16px">➤</button>
    </div>
  </div>`;
  _aiMountCharts();   // HTML is in the DOM now - instantiate any queued charts
  const log=document.getElementById('ai-log');if(log)log.scrollTop=log.scrollHeight;
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
// Flatten a chat to plain text for sharing. Gemini replies are markdown; do a
// light pass to WhatsApp-friendly formatting (**bold** → *bold*, strip heading
// hashes) so it reads cleanly in a message rather than showing raw markup.
function _aiChatToText(c){
  const md=t=>String(t||'')
    .replace(/\*\*(.+?)\*\*/g,'*$1*')       // **bold** → *bold* (WhatsApp bold)
    .replace(/^#{1,6}\s+/gm,'')             // drop ATX heading hashes
    .trim();
  const body=c.msgs.filter(m=>m.r!=='e').map(m=>
    (m.r==='u'?'🙋 Me:':'✦ SpendWise AI:')+'\n'+md(m.t)).join('\n\n');
  return (c.title?c.title+'\n':'')+'— SpendWise AI conversation —\n\n'+body;
}
// Share the active conversation. On mobile this opens the native share sheet
// (WhatsApp appears there and it handles long text without URL limits); on
// desktop / browsers without navigator.share it falls back to WhatsApp's web
// link, and to the clipboard if that popup is blocked.
async function aiShareChat(){
  const c=_aiResolveActive();
  if(!c||!c.msgs.some(m=>m.r!=='e')){toast('Nothing to share yet');return;}
  const text=_aiChatToText(c);
  if(navigator.share){
    try{await navigator.share({title:c.title||'SpendWise AI chat',text});}
    catch(e){/* user dismissed the sheet — not an error */}
    return;
  }
  const w=window.open('https://wa.me/?text='+encodeURIComponent(text),'_blank','noopener');
  if(!w){
    try{await navigator.clipboard.writeText(text);toast('Chat copied — paste it into WhatsApp');}
    catch(e){toast('Could not open WhatsApp');}
  }
}
function aiSend(){const inp=document.getElementById('ai-input');if(!inp)return;const v=inp.value;inp.value='';aiGrowInput(inp);aiAsk(v);}
// Auto-grow the chat textarea as the user types (wraps + expands, capped by the
// textarea.ifield max-height in CSS, which then scrolls).
function aiGrowInput(t){if(!t)return;t.style.height='auto';t.style.height=Math.min(t.scrollHeight,200)+'px';}
// Enter sends; Shift+Enter inserts a newline (standard chat convention).
function aiInputKey(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();aiSend();}}
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
    _aiPush(cid,{r:'m',t:reply.text,mdl:reply.model});
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
// model doesn't mean a lower tier is also exhausted). Only a bad-key error
// (400/401/403) aborts immediately; everything else is tried against every
// model before giving up.
//
// The chain is always tried in its declared best-first order. An earlier
// version remembered whichever model last answered and tried THAT first, but
// that permanently pinned a device to an older model once it answered — after
// prepending a newer flagship (e.g. gemini-3.6-flash) the remembered older
// model kept winning and the new one was never reached. Best-first, every time.
async function _aiFetch(body){
  const key=_aiKey();if(!key)throw new Error('No API key saved — open Keys… settings');
  const models=AI_MODELS.slice();
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
        throw new Error('Gemini rejected the API key'+(j.error&&j.error.message?': '+j.error.message:'')+'. Tap Keys… to switch or fix it.');
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
    return {text:text.trim(),model};
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
  const usdAccts=getCashAccounts().filter(isUSDCashAccount);
  const usdNote=usdAccts.length?`${usdAccts.map(a=>'"'+a+'"').join(', ')} ${usdAccts.length>1?'are':'is'} in US dollars; every other account is in NGN`:'all accounts are in NGN';
  sect.push(`MONTH-END ACCOUNT BALANCES (one JSON per month; keys are account names; ${usdNote}):\n`
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
  const nw=appNow();
  const fx=getFxRates(nw.getMonth()+1,nw.getFullYear());
  const std=Object.entries(DEF_BUDGETS).filter(([,v])=>+v>0);
  if(std.length)sect.push('STANDARD MONTHLY BUDGET (applies to every month that has no budget of its own below; NGN per category):\n'+JSON.stringify(Object.fromEntries(std)));
  const recur=getRecurring();
  if(recur.length)sect.push('RECURRING ITEMS (bills and income that repeat):\n'+recur.map(r=>[r.type,r.payee,num(r.amount),r.frequency,'next '+r.nextRun].join('|')).join('\n'));
  const goals=getGoals();
  if(goals.length)sect.push('SAVINGS GOALS (name|target|saved so far|deadline):\n'+goals.map(g=>[g.name,num(g.target),num(g.current),g.deadline||''].join('|')).join('\n'));
  const head=`You are SpendWise AI, the financial analyst built into this user's personal finance app. Today is ${todayStr()}.
All amounts are Nigerian Naira (NGN, ₦) unless marked otherwise. Dollar accounts: ${usdAccts.length?usdAccts.join(', '):'none'} (their balances and expenses are in USD; expense amount_NGN is already converted). Working FX assumption: 1 USD ≈ ₦${fx.USD}, 1 GBP ≈ ₦${fx.GBP}.
Rules:
- Ground every statement in the data below. Cite real months and real figures (use ₦ with thousands separators). Never invent or estimate numbers the data doesn't support — say plainly when it can't answer.
- Transfers move money between the user's own accounts; never count them as income or spending.
- Lead with the answer, then the evidence. Be direct and specific to THIS user's patterns — no generic financial-advice boilerplate.
- Format with markdown: short paragraphs, bullets, and small tables where they help. Round to whole naira.
- You may include ONE chart per reply when a number series reads better as a picture (a trend across months, a composition, a comparison). Emit it as a fenced block, raw JSON only:
\`\`\`spendwise-chart
{"type":"bar|line|doughnut","title":"Short title","labels":["Jun","Jul"],"series":[{"name":"Spend","data":[412000,388500]}]}
\`\`\`
  No comments, no trailing commas, no ₦ signs and no thousands separators inside the JSON — plain numbers. Every series' data length must equal labels length. Max 24 labels, max 3 series; doughnut takes exactly one series. Never set colours or styling; the app themes the chart.
- The written answer must stand on its own. A chart supplements it — never say "see the chart below" instead of giving the numbers.

THE USER'S COMPLETE FINANCIAL DATA:

`;
  _aiCtx=head+sect.join('\n\n');
  _aiCtxAt=Date.now();
  return _aiCtx;
}

// Minimal markdown → HTML for AI replies: headings, bold/italic/code,
// bullet + numbered lists, and pipe tables. Everything is HTML-escaped first.
function _aiMd(src,key){
  const e=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const inline=s=>e(s)
    .replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g,'$1<i>$2</i>')
    .replace(/`([^`]+)`/g,'<code>$1</code>');
  const lines=String(src||'').split(/\r?\n/);
  let html='',i=0,chartN=0;
  while(i<lines.length){
    const L=lines[i];
    if(/^\s*$/.test(L)){i++;continue;}
    // Fenced blocks are consumed WHOLE and before anything else, so the JSON
    // inside a chart block never reaches inline()/e() and gets mangled. This
    // also means any other fenced block now renders as a <pre> instead of each
    // line becoming a stray paragraph full of backticks.
    if(/^\s*```/.test(L)){
      const lang=L.replace(/^\s*```/,'').trim().toLowerCase();
      const buf=[]; i++;
      while(i<lines.length&&!/^\s*```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;                       // consume the closing fence (or fall out at EOF)
      html+=(lang==='spendwise-chart')
        ? _aiChartHtml(buf.join('\n'),key,chartN++)
        : `<pre class="ai-pre"><code>${e(buf.join('\n'))}</code></pre>`;
      continue;
    }
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

