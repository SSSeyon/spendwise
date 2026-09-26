// ══════════════════════════════════════════════════════════════════════════
// SETUP — logo catalogue, account/platform picker, first-run onboarding
// ══════════════════════════════════════════════════════════════════════════
// Logos: files live in the repo's Logos/ folder. Entries marked want: have
// no file yet — drop that file into Logos/ and change want: to file:.
// Logos: files live in the repo's Logos/ folder and are served from the app's
// own origin. A catalogue entry whose file hasn't been added yet still works:
// bankLogoEl/platformLogoEl fall back to initials / a colour dot on error.
// Users can also upload their own image; it's shrunk to 64px on the device
// and stored as a data: URL in their (encrypted) settings.
'use strict';

const LOGO_CATALOG={
  bank:[
    {name:'GTB',file:'GTB.png'},
    {name:'Access',file:'Access.png'},
    {name:'First Bank',file:'FBN.png'},
    {name:'Zenith',file:'Zenith.png'},
    {name:'UBA',file:'UBA.png'},
    {name:'Kuda',file:'Kuda.png'},
    {name:'Opay',file:'Opay.jpg'},
    {name:'Moniepoint',file:'Moniepoint.jpg'},
    {name:'PalmPay',file:'PalmPay.png'},
    {name:'ALAT by Wema',file:'Wema.jpg'},
    {name:'Stanbic IBTC',file:'Stanbic.png'},
    {name:'Fidelity',file:'Fidelity.png'},
    {name:'FCMB',file:'FCMB.png'},
    {name:'Sterling',file:'Sterling.png'},
    {name:'Union Bank',file:'Union.png'},
    {name:'Ecobank',file:'Ecobank.png'},
    {name:'Polaris',file:'Polaris.png'},
    {name:'Providus',file:'Providus.png'},
    {name:'Renmoney',file:'Renmoney.png'},
    {name:'Carbon',file:'Carbon.png'},
    {name:'Cash',file:'',icon:'💵'},
    {name:'USD Cash',file:'',icon:'💵',usd:true},
  ],
  platform:[
    {name:'PiggyVest',file:'Piggy.png',currency:'NGN',color:'#c8f542'},
    {name:'Cowrywise',file:'Cowrywise.png',currency:'NGN',color:'#0066f5'},
    {name:'Risevest',file:'Risevest.jpg',currency:'USD',color:'#f5c842'},
    {name:'Bamboo',file:'Bamboo.png',currency:'USD',color:'#ff5c9f'},
    {name:'Trove',file:'Trove.png',currency:'USD',color:'#ff9f5c'},
    {name:'Chaka',file:'Chaka.png',currency:'USD',color:'#7b61ff'},
    {name:'Kuda Save',file:'Kuda.png',currency:'NGN',color:'#40196d'},
    {name:'Renmoney Savings',file:'Renmoney.png',currency:'NGN',color:'#4a8aee'},
    {name:'ARM',file:'ARM.jpg',currency:'NGN',color:'#1d4f91'},
    {name:'Stanbic IBTC Asset Management',file:'Stanbic.png',currency:'NGN',color:'#0033a1'},
    {name:'Meristem',file:'Meristem.png',currency:'NGN',color:'#00843d'},
  ],
};

// Logo file for a catalogue name (also matches the owner's legacy short names).
function catalogLogo(kind,name){
  const n=String(name||'').toLowerCase();
  const e=(LOGO_CATALOG[kind]||[]).find(x=>x.name.toLowerCase()===n);
  return e&&e.file?e.file:'';
}

(function injectSetupCss(){
  const css=`
#acct-ov .su-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px}
#acct-ov .su-tile{border:1px solid var(--border);border-radius:var(--rsm);background:var(--bg1);padding:10px 6px 8px;display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;text-align:center;font-size:0.68rem;color:var(--text);line-height:1.25;min-height:78px;position:relative;user-select:none}
#acct-ov .su-tile.on{border-color:var(--accent);background:var(--adim);box-shadow:0 0 0 1px var(--accent) inset}
#acct-ov .su-tile.on:after{content:'✓';position:absolute;top:4px;right:6px;font-size:0.7rem;color:var(--accent);font-weight:800}
#acct-ov .su-logo{width:34px;height:34px;border-radius:8px;object-fit:contain;background:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:0.8rem;color:#445}
#acct-ov .su-steps{font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--text3);font-weight:700}
#acct-ov .su-row{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)}
#acct-ov .su-row .ifield{max-width:170px;margin-left:auto;font-family:var(--mono)}
#acct-ov .su-other{border:1px dashed var(--border2);border-radius:var(--rsm);padding:12px;display:flex;flex-direction:column;gap:8px}
`;
  const s=document.createElement('style');s.textContent=css;document.head.appendChild(s);
})();

function _suLogoHtml(entry,round){
  const r=round?'50%':'8px';
  const initials=String(entry.name).replace(/[^A-Za-z0-9 ]/g,'').split(/\s+/).map(w=>w[0]||'').join('').slice(0,2).toUpperCase();
  if(entry.icon&&!entry.file) return `<div class="su-logo" style="border-radius:${r};background:var(--bg3);font-size:1.1rem">${entry.icon}</div>`;
  const src=entry.logo||entry.file;
  const bg=entry.color||'var(--bg3)',fg=entry.color?'#fff':'var(--text2)';
  if(!src) return `<div class="su-logo" style="border-radius:${r};background:${bg};color:${fg}">${initials}</div>`;
  return `<img class="su-logo" style="border-radius:${r}" src="${logoUrl(src)}" alt="" onerror="this.outerHTML='<div class=&quot;su-logo&quot; style=&quot;border-radius:${r};background:${bg};color:${fg}&quot;>${initials}</div>'">`;
}

// Shrink an uploaded image to a 64px PNG data: URL.
function _suLogoFromFile(file){
  return new Promise((res,rej)=>{
    if(!file||!/^image\//.test(file.type)) return rej(new Error('Choose an image file'));
    const img=new Image();const url=URL.createObjectURL(file);
    img.onload=()=>{
      const c=document.createElement('canvas');c.width=c.height=64;
      const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,64,64);
      const s=Math.min(64/img.width,64/img.height),w=img.width*s,h=img.height*s;
      g.drawImage(img,(64-w)/2,(64-h)/2,w,h);URL.revokeObjectURL(url);
      res(c.toDataURL('image/png'));
    };
    img.onerror=()=>{URL.revokeObjectURL(url);rej(new Error("Couldn't read that image"));};
    img.src=url;
  });
}

// ── Picker state ──────────────────────────────────────────────────────────
// Used by onboarding (multi-select, both kinds) and by the Accounts pages
// (add one or more to an existing list).
const SU={step:0,banks:new Map(),plats:new Map(),custom:{bank:[],platform:[]},onDone:null,kinds:['bank','platform'],opening:{}};

function _suEntries(kind){
  const existing=kind==='bank'?new Set(getCashAccounts()):new Set(getPlatforms().map(p=>p.label));
  return LOGO_CATALOG[kind].concat(SU.custom[kind]).filter(e=>!existing.has(e.name));
}
function _suSel(kind){return kind==='bank'?SU.banks:SU.plats;}
function suToggle(kind,name){
  const sel=_suSel(kind);
  if(sel.has(name)) sel.delete(name);
  else{const e=LOGO_CATALOG[kind].concat(SU.custom[kind]).find(x=>x.name===name);if(e)sel.set(name,e);}
  const el=document.querySelector(`#acct-ov .su-tile[data-k="${kind}"][data-n="${CSS.escape(name)}"]`);
  if(el) el.classList.toggle('on',sel.has(name));
}
function _suGrid(kind){
  const sel=_suSel(kind);
  return `<div class="su-grid">${_suEntries(kind).map(e=>`<div class="su-tile${sel.has(e.name)?' on':''}" data-k="${kind}" data-n="${_acctEsc(e.name)}" onclick="suToggle('${kind}',this.dataset.n)">${_suLogoHtml(e,kind==='platform')}<div>${_acctEsc(e.name)}</div></div>`).join('')}</div>
  <div class="su-other" id="su-other-${kind}">
    <div style="font-size:0.72rem;font-weight:700;color:var(--text2)">Not listed? Add your own</div>
    <input class="ifield" id="su-oname-${kind}" placeholder="${kind==='bank'?'Account name, e.g. Salary account':'Platform name'}">
    <div style="display:flex;gap:8px">
      <select class="ifield" id="su-ocur-${kind}" style="flex:1"><option value="NGN">₦ Naira</option><option value="USD">$ US dollar</option>${kind==='platform'?'<option value="GBP">£ Pound</option>':''}</select>
      <label class="btn btn-g btn-sm" style="flex:1;margin:0">Logo (optional)<input type="file" accept="image/*" id="su-ologo-${kind}" style="display:none" onchange="document.getElementById('su-ologo-lbl-${kind}').textContent=this.files[0]?this.files[0].name:''"></label>
    </div>
    <div class="acct-muted" id="su-ologo-lbl-${kind}" style="text-align:left"></div>
    <button class="btn btn-g btn-sm" onclick="suAddOther('${kind}')">+ Add</button>
  </div>`;
}
async function suAddOther(kind){
  const name=(document.getElementById('su-oname-'+kind).value||'').trim();
  if(!name){toast('Enter a name');return;}
  const all=LOGO_CATALOG[kind].concat(SU.custom[kind]);
  const taken=kind==='bank'?getCashAccounts():getPlatforms().map(p=>p.label);
  if(all.some(e=>e.name.toLowerCase()===name.toLowerCase())||taken.some(n=>n.toLowerCase()===name.toLowerCase())){toast('That one already exists');return;}
  const cur=document.getElementById('su-ocur-'+kind).value;
  const f=document.getElementById('su-ologo-'+kind).files[0];
  let logo='';
  if(f){try{logo=await _suLogoFromFile(f);}catch(e){toast(e.message);return;}}
  const colors=['#14b8a6','#6366f1','#f59e0b','#ef4444','#0ea5e9','#a855f7','#22c55e'];
  const e={name,file:'',logo,custom:true,usd:cur==='USD',currency:cur,color:colors[(SU.custom[kind].length)%colors.length]};
  SU.custom[kind].push(e);_suSel(kind).set(name,e);
  SU.render();
}

// Commit selections to the user's settings.
function _suCommit(){
  if(SU.banks.size){
    const accts=getCashAccounts().slice(),usd=getUsdAccounts().slice();
    SU.banks.forEach((e,name)=>{if(!accts.includes(name))accts.push(name);if(e.usd&&!usd.includes(name))usd.push(name);});
    setCashAccounts(accts,usd);
    // catalogue logos resolve at render time (catalogLogo); only uploads are stored
    SU.banks.forEach((e,name)=>{if(e.logo)setCashLogo(name,e.logo);});
  }
  if(SU.plats.size){
    const plats=getPlatforms().slice();
    SU.plats.forEach(e=>{
      const key=e.name.replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_]/g,'')||('P'+Date.now());
      if(plats.some(p=>p.key===key)) return;
      plats.push({key,label:e.name,color:e.color||'#c8f542',currency:e.currency||'NGN',logo:e.logo||''});
    });
    savePlatforms(plats);PLATFORMS=plats;
  }
}
async function _suSaveOpening(){
  const vals={};
  document.querySelectorAll('#acct-ov input[data-open]').forEach(i=>{const v=parseFloat(String(i.value).replace(/[^0-9.\-]/g,''));if(v)vals[i.dataset.open]=v;});
  if(!Object.keys(vals).length||!db) return;
  const m=S.cashMonth||S.expMonth,y=S.cashYear||S.expYear;
  const cur={...(cGet(CK.cash(m,y))||{}),...vals};
  cSet(CK.cash(m,y),cur);S.cash=cur;
  try{await db.collection('cashBalances').doc(sid(m,y)).set({...vals,month:m,year:y},{merge:true});}
  catch(e){console.warn('opening balances write failed',e);}
}
function _suReset(){SU.step=0;SU.banks=new Map();SU.plats=new Map();SU.custom={bank:[],platform:[]};}

// ── Onboarding (first run) ────────────────────────────────────────────────
function suShouldOnboard(){
  if(typeof DATA_MODE==='undefined'||DATA_MODE==='legacy'||DATA_MODE==='locked') return false;
  const p=getProfile();
  return !(p&&p.onboarded);
}
function suStart(){_suReset();SU.render=_suRenderOnboard;SU.render();}
function _suRenderOnboard(){
  const steps=['Welcome','Your banks','Investments','Balances'];
  const hdr=SU.step?`<div class="su-steps">Step ${SU.step} of 3 · ${steps[SU.step]}</div>`:'';
  if(SU.step===0){
    _acctShow(`
      <div class="acct-spacer"></div>
      <h2 style="font-size:1.6rem">Welcome to SpendWise</h2>
      <div class="acct-sub">Track your spending, cash, investments and net worth in one place. Everything stays on your device unless you choose to sync it.</div>
      <div class="acct-spacer"></div>
      <button class="btn btn-p btn-full" onclick="SU.step=1;SU.render()">Get started</button>
      <button class="btn btn-g btn-full" onclick="acctShowSignIn()">I already have an account</button>
      <div class="acct-muted">No sign-up needed to start.</div>
    `);return;
  }
  if(SU.step===1){
    _acctShow(`${hdr}
      <h2>Where do you keep your money?</h2>
      <div class="acct-sub">Tap your banks and wallets. You can add or remove them later.</div>
      ${_suGrid('bank')}
      <div class="acct-spacer"></div>
      <button class="btn btn-p btn-full" onclick="SU.step=2;SU.render()">Next</button>
    `);return;
  }
  if(SU.step===2){
    _acctShow(`${hdr}
      <div class="acct-back" onclick="SU.step=1;SU.render()">‹ Back</div>
      <h2>Any investment apps?</h2>
      <div class="acct-sub">Optional. Pick the platforms you save or invest with.</div>
      ${_suGrid('platform')}
      <div class="acct-spacer"></div>
      <button class="btn btn-p btn-full" onclick="SU.step=3;SU.render()">Next</button>
    `);return;
  }
  const banks=[...SU.banks.values()];
  _acctShow(`${hdr}
    <div class="acct-back" onclick="SU.step=2;SU.render()">‹ Back</div>
    <h2>Opening balances</h2>
    <div class="acct-sub">${banks.length?"How much is in each account today? Leave blank if you're not sure. You can change these any time on the Accounts page.":"You didn't pick any accounts. You can add them later on the Accounts page."}</div>
    ${banks.map(e=>`<div class="su-row">${_suLogoHtml(e)}<div style="font-size:0.8rem">${_acctEsc(e.name)}</div><input class="ifield" inputmode="decimal" data-open="${_acctEsc(e.name)}" placeholder="${e.usd?'$ 0':'₦ 0'}"></div>`).join('')}
    <div class="acct-err" id="acct-err"></div>
    <div class="acct-spacer"></div>
    <button class="btn btn-p btn-full" id="acct-go" onclick="suFinish()">Finish</button>
  `);
}
async function suFinish(){
  await _acctBusy('acct-go','Saving…',async()=>{
    _suCommit();
    await _suSaveOpening();
    saveProfile({onboarded:true,createdAt:Date.now()});
    _suReset();acctClose();
    renderAll();
    toast('All set. Add your first expense with the + button.');
  });
}

// ── Add from the Accounts / Investments pages ─────────────────────────────
function suOpenPicker(kind){
  _suReset();
  SU.render=()=>{
    _acctShow(`
      <div class="acct-back" onclick="acctClose()">‹ Back</div>
      <h2>${kind==='bank'?'Add accounts':'Add investment platforms'}</h2>
      ${_suGrid(kind)}
      <div class="acct-spacer"></div>
      <button class="btn btn-p btn-full" onclick="suPickerDone('${kind}')">Add selected</button>
    `);
  };
  SU.render();
}
function suPickerDone(kind){
  const n=_suSel(kind).size;
  if(!n){toast('Tap at least one');return;}
  _suCommit();_suReset();acctClose();
  if(kind==='bank'){renderCashPage();}else{renderInvestments();}
  renderDashboard();
  toast(n===1?'Added':`Added ${n}`);
}
