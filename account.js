// ══════════════════════════════════════════════════════════════════════════
// ACCOUNT SCREENS — optional sign-in, recovery code, unlock, import
// ══════════════════════════════════════════════════════════════════════════
// All crypto/auth lives in vault.js; this file is only UI + the mode switch
// after a successful sign-in (see _acctAfterAuth). Uses the app's globals
// (DATA_MODE, _enterMode, _wipeDataCaches, toast, esc) at call time.
'use strict';

(function injectAcctCss(){
  const css=`
#mode-bar{font-size:0.7rem;color:var(--text2);background:var(--gdim);border-bottom:1px solid var(--border);padding:7px 14px;text-align:center;line-height:1.5}
#mode-bar a{color:var(--accent);font-weight:700;cursor:pointer;white-space:nowrap}
#acct-ov{position:fixed;inset:0;z-index:1000;background:var(--bg);overflow-y:auto;display:none}
#acct-ov .acct-wrap{max-width:420px;margin:0 auto;padding:28px 20px 40px;min-height:100%;display:flex;flex-direction:column;gap:12px}
#acct-ov h2{font-size:1.25rem;font-weight:800;margin:6px 0 0;color:var(--text)}
#acct-ov .acct-sub{font-size:0.8rem;color:var(--text2);line-height:1.6}
#acct-ov .acct-li{display:flex;gap:12px;align-items:flex-start;font-size:0.82rem;line-height:1.55;color:var(--text);padding:6px 0}
#acct-ov .acct-li b{display:block;font-size:0.84rem}
#acct-ov .acct-li span.i{font-size:1.2rem;line-height:1.2;flex-shrink:0;width:26px;text-align:center}
#acct-ov .acct-code{font-family:var(--mono);font-size:1.05rem;letter-spacing:0.06em;background:var(--bg2);border:1px solid var(--border);border-radius:var(--rsm);padding:14px;text-align:center;line-height:1.8;user-select:all}
#acct-ov .acct-err{font-size:0.74rem;color:var(--red);min-height:1em}
#acct-ov .acct-link{font-size:0.74rem;color:var(--accent);cursor:pointer;text-align:center;font-weight:600}
#acct-ov .acct-muted{font-size:0.7rem;color:var(--text3);text-align:center;line-height:1.5}
#acct-ov .acct-back{font-size:0.74rem;color:var(--text2);cursor:pointer;align-self:flex-start}
#acct-ov .acct-spacer{flex:1}
#acct-ov .acct-or{display:flex;align-items:center;gap:10px;font-size:0.66rem;color:var(--text3)}
#acct-ov .acct-or:before,#acct-ov .acct-or:after{content:'';flex:1;height:1px;background:var(--border)}
#acct-ov .acct-prog{height:6px;background:var(--bg2);border-radius:3px;overflow:hidden}
#acct-ov .acct-prog div{height:100%;background:var(--accent);width:0;transition:width .2s}
#acct-ov label.acct-check{display:flex;gap:8px;align-items:center;font-size:0.78rem;color:var(--text);cursor:pointer}
`;
  const s=document.createElement('style');s.textContent=css;document.head.appendChild(s);
})();

function _acctOv(){
  let ov=document.getElementById('acct-ov');
  if(!ov){ov=document.createElement('div');ov.id='acct-ov';document.body.appendChild(ov);}
  return ov;
}
function _acctShow(html){
  const ov=_acctOv();
  ov.innerHTML=`<div class="acct-wrap">${html}</div>`;
  ov.style.display='block';ov.scrollTop=0;
  // Focus the first field on form screens only — never on picker screens,
  // where it would pop the keyboard and scroll to the "add your own" box.
  const f=ov.querySelector('.su-grid')?null:ov.querySelector('input:not([type=checkbox]):not([type=file])');
  if(f)setTimeout(()=>f.focus(),50);
}
function acctClose(){const ov=document.getElementById('acct-ov');if(ov){ov.style.display='none';ov.innerHTML='';}}
const _acctEsc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function _acctVal(id){const el=document.getElementById(id);return el?el.value:'';}
function _acctErr(msg){const el=document.getElementById('acct-err');if(el)el.textContent=msg||'';}
// Run an async step with the primary button in a busy state.
async function _acctBusy(btnId,label,fn){
  const b=document.getElementById(btnId);const old=b?b.textContent:'';
  if(b){b.disabled=true;b.textContent=label;}
  _acctErr('');
  try{return await fn();}
  catch(e){_acctErr(e instanceof VAULT.VaultError?e.message:'Something went wrong. Check your connection and try again.');if(!(e instanceof VAULT.VaultError))console.warn('account step failed',e);}
  finally{if(b&&document.body.contains(b)){b.disabled=false;b.textContent=old;}}
}
function _acctOnEnter(ev,fn){if(ev.key==='Enter'){ev.preventDefault();fn();}}

// "Continue with Google" needs the Google provider enabled in Firebase
// Authentication. Off by default: Google users still need a separate data
// password, so it adds little over username + password.
const GOOGLE_SIGNIN=false;
function _acctGoogleBtn(){return GOOGLE_SIGNIN?`<div class="acct-or">or</div>
    <button class="btn btn-g btn-full" onclick="acctGoogle()">Continue with Google</button>`:'';}

// ── 1. Why sign in ────────────────────────────────────────────────────────
function acctShowWhy(legacy){
  _acctShow(`
    <div class="acct-back" onclick="acctClose()">✕ Not now</div>
    <h2>${legacy?'SpendWise now has private accounts':'Keep your data safe and everywhere'}</h2>
    <div class="acct-sub">${legacy
      ?'Your data used to sync through a shared database. Create an account to keep syncing: from now on it is encrypted so only you can read it.'
      :"You don't need an account to use SpendWise. Right now your data is saved on this device only. An account adds:"}</div>
    <div class="acct-li"><span class="i">🔄</span><div><b>Sync across your devices</b>Use SpendWise on your phone, tablet and laptop, always up to date.</div></div>
    <div class="acct-li"><span class="i">🛟</span><div><b>Get your data back</b>Lose or change your phone and everything is still there when you sign in.</div></div>
    <div class="acct-li"><span class="i">🔒</span><div><b>Private by design</b>Your data is encrypted on your device before it's synced. Nobody else can read it, not even the app's creator.</div></div>
    <div class="acct-spacer"></div>
    <button class="btn btn-p btn-full" onclick="acctShowCreate()">Create account</button>
    <button class="btn btn-g btn-full" onclick="acctShowSignIn()">I already have an account</button>
    ${_acctGoogleBtn()}
  `);
}

// ── 2. Create account ─────────────────────────────────────────────────────
function acctShowCreate(){
  _acctShow(`
    <div class="acct-back" onclick="acctShowWhy()">‹ Back</div>
    <h2>Create your account</h2>
    <div><label class="ilabel">Username</label><input class="ifield" id="acct-u" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="ada.o"></div>
    <div><label class="ilabel">Password</label><input class="ifield" id="acct-p" type="password" autocomplete="new-password" placeholder="10 or more characters"></div>
    <div><label class="ilabel">Confirm password</label><input class="ifield" id="acct-p2" type="password" autocomplete="new-password" onkeydown="_acctOnEnter(event,acctDoCreate)"></div>
    <div class="acct-muted" style="text-align:left">Your password also locks your data. It never leaves this device, so nobody can reset it for you. You'll get a recovery code next in case you forget it.</div>
    <div class="acct-err" id="acct-err"></div>
    <button class="btn btn-p btn-full" id="acct-go" onclick="acctDoCreate()">Create account</button>
  `);
}
function acctDoCreate(){
  const u=_acctVal('acct-u'),p=_acctVal('acct-p'),p2=_acctVal('acct-p2');
  if(p!==p2){_acctErr("The passwords don't match.");return;}
  _acctBusy('acct-go','Creating…',async()=>{
    const code=await VAULT.signUp(u,p);
    acctShowCode(code,()=>_acctAfterAuth({isNew:true}));
  });
}

// ── 3. Recovery code ──────────────────────────────────────────────────────
let _acctCodeNext=null;
function acctShowCode(code,next){
  _acctCodeNext=next;
  _acctShow(`
    <h2>Save your recovery code</h2>
    <div class="acct-sub">If you ever forget your password, this code is the only way back into your data. Nobody else has a copy, including the app's creator.</div>
    <div class="acct-code" id="acct-code">${_acctEsc(code)}</div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-g btn-sm" style="flex:1" onclick="acctCopyCode()">Copy</button>
      <button class="btn btn-g btn-sm" style="flex:1" onclick="acctSaveCode()">Save as file</button>
    </div>
    <label class="acct-check"><input type="checkbox" id="acct-saved"> I've saved it somewhere safe</label>
    <div class="acct-err" id="acct-err"></div>
    <div class="acct-spacer"></div>
    <button class="btn btn-p btn-full" id="acct-go" onclick="acctCodeDone()">Continue</button>
  `);
}
function acctCopyCode(){
  const c=document.getElementById('acct-code').textContent;
  (navigator.clipboard?navigator.clipboard.writeText(c):Promise.reject()).then(()=>toast('Recovery code copied'),()=>toast('Select the code and copy it'));
}
function acctSaveCode(){
  const c=document.getElementById('acct-code').textContent;
  const u=VAULT.username||'';
  const txt=`SpendWise recovery code\n\nUsername: ${u}\nRecovery code: ${c}\n\nKeep this somewhere safe. With your username, it lets you reset a forgotten password.\n`;
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([txt],{type:'text/plain'}));a.download='SpendWise-recovery-code.txt';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
function acctCodeDone(){
  if(!document.getElementById('acct-saved').checked){_acctErr('Tick the box once your code is saved.');return;}
  const n=_acctCodeNext;_acctCodeNext=null;if(n)n();
}

// ── 4. Sign in ────────────────────────────────────────────────────────────
function acctShowSignIn(prefill){
  _acctShow(`
    <div class="acct-back" onclick="acctShowWhy()">‹ Back</div>
    <h2>Welcome back</h2>
    <div><label class="ilabel">Username</label><input class="ifield" id="acct-u" autocomplete="username" autocapitalize="none" spellcheck="false" value="${_acctEsc(prefill||'')}"></div>
    <div><label class="ilabel">Password</label><input class="ifield" id="acct-p" type="password" autocomplete="current-password" onkeydown="_acctOnEnter(event,acctDoSignIn)"></div>
    <div class="acct-err" id="acct-err"></div>
    <button class="btn btn-p btn-full" id="acct-go" onclick="acctDoSignIn()">Sign in</button>
    <div class="acct-link" onclick="acctShowRecover()">Forgot password? Use your recovery code</div>
    ${_acctGoogleBtn()}
  `);
}
function acctDoSignIn(){
  _acctBusy('acct-go','Signing in…',async()=>{
    const r=await VAULT.signIn(_acctVal('acct-u'),_acctVal('acct-p'));
    if(r.needsSetup) acctShowCode(r.code,()=>_acctAfterAuth({isNew:true}));
    else await _acctAfterAuth({isNew:false});
  });
}

// ── 5. Forgot password ────────────────────────────────────────────────────
function acctShowRecover(){
  _acctShow(`
    <div class="acct-back" onclick="acctShowSignIn()">‹ Back</div>
    <h2>Reset your password</h2>
    <div class="acct-sub">Enter your username and the recovery code you saved when you created your account, then choose a new password.</div>
    <div><label class="ilabel">Username</label><input class="ifield" id="acct-u" autocomplete="username" autocapitalize="none" spellcheck="false"></div>
    <div><label class="ilabel">Recovery code</label><input class="ifield" id="acct-c" autocapitalize="characters" spellcheck="false" placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" style="font-family:var(--mono)"></div>
    <div><label class="ilabel">New password</label><input class="ifield" id="acct-p" type="password" autocomplete="new-password" placeholder="10 or more characters"></div>
    <div><label class="ilabel">Confirm new password</label><input class="ifield" id="acct-p2" type="password" autocomplete="new-password" onkeydown="_acctOnEnter(event,acctDoRecover)"></div>
    <div class="acct-err" id="acct-err"></div>
    <button class="btn btn-p btn-full" id="acct-go" onclick="acctDoRecover()">Reset password</button>
  `);
}
function acctDoRecover(){
  if(_acctVal('acct-p')!==_acctVal('acct-p2')){_acctErr("The passwords don't match.");return;}
  _acctBusy('acct-go','Resetting…',async()=>{
    await VAULT.recover(_acctVal('acct-u'),_acctVal('acct-c'),_acctVal('acct-p'));
    toast('Password reset. Your recovery code still works.');
    await _acctAfterAuth({isNew:false});
  });
}

// ── 6. Google ─────────────────────────────────────────────────────────────
function acctGoogle(){
  _acctErr('');
  VAULT.googleSignIn().then(r=>{
    if(r.redirecting) return;
    if(r.hasKeys) acctShowUnlock();
    else acctShowGoogleSetPw();
  }).catch(e=>{
    if(!document.getElementById('acct-err')) acctShowWhy();
    _acctErr(e instanceof VAULT.VaultError?e.message:"Couldn't sign in with Google.");
  });
}
function acctShowGoogleSetPw(){
  _acctShow(`
    <h2>Set a data password</h2>
    <div class="acct-sub">Google signs you in, but your data is locked with a password only you know. You'll enter it once on each new device.</div>
    <div><label class="ilabel">Data password</label><input class="ifield" id="acct-p" type="password" autocomplete="new-password" placeholder="10 or more characters"></div>
    <div><label class="ilabel">Confirm</label><input class="ifield" id="acct-p2" type="password" autocomplete="new-password" onkeydown="_acctOnEnter(event,acctDoGoogleSetPw)"></div>
    <div class="acct-err" id="acct-err"></div>
    <button class="btn btn-p btn-full" id="acct-go" onclick="acctDoGoogleSetPw()">Continue</button>
    <div class="acct-link" onclick="acctSignOut()">Cancel and sign out</div>
  `);
}
function acctDoGoogleSetPw(){
  if(_acctVal('acct-p')!==_acctVal('acct-p2')){_acctErr("The passwords don't match.");return;}
  _acctBusy('acct-go','Setting up…',async()=>{
    const code=await VAULT.googleSetPassword(_acctVal('acct-p'));
    acctShowCode(code,()=>_acctAfterAuth({isNew:true}));
  });
}

// ── 7. Unlock (signed in, but this device has no key) ─────────────────────
function acctShowUnlock(){
  const u=firebase.auth().currentUser;
  const isGoogle=u&&u.providerData.some(p=>p.providerId==='google.com');
  if(!isGoogle){
    // Username accounts always unlock during sign-in; if we get here the key
    // was cleared, so sign in again (same password).
    const name=VAULT.username;
    VAULT.signOut().then(()=>acctShowSignIn(name));
    return;
  }
  _acctShow(`
    <h2>Unlock your data</h2>
    <div class="acct-sub">Signed in as ${_acctEsc(u.email||'')}. Enter your data password to unlock SpendWise on this device.</div>
    <div><label class="ilabel">Data password</label><input class="ifield" id="acct-p" type="password" autocomplete="current-password" onkeydown="_acctOnEnter(event,acctDoUnlock)"></div>
    <div class="acct-err" id="acct-err"></div>
    <button class="btn btn-p btn-full" id="acct-go" onclick="acctDoUnlock()">Unlock</button>
    <div class="acct-link" onclick="acctShowGoogleRecover()">Forgot it? Use your recovery code</div>
    <div class="acct-link" style="color:var(--text2)" onclick="acctSignOut()">Sign out</div>
  `);
}
function acctDoUnlock(){
  _acctBusy('acct-go','Unlocking…',async()=>{
    await VAULT.googleUnlock(_acctVal('acct-p'));
    await _acctAfterAuth({isNew:false});
  });
}
function acctShowGoogleRecover(){
  _acctShow(`
    <div class="acct-back" onclick="acctShowUnlock()">‹ Back</div>
    <h2>Reset your data password</h2>
    <div><label class="ilabel">Recovery code</label><input class="ifield" id="acct-c" autocapitalize="characters" spellcheck="false" style="font-family:var(--mono)"></div>
    <div><label class="ilabel">New data password</label><input class="ifield" id="acct-p" type="password" autocomplete="new-password"></div>
    <div><label class="ilabel">Confirm</label><input class="ifield" id="acct-p2" type="password" autocomplete="new-password"></div>
    <div class="acct-err" id="acct-err"></div>
    <button class="btn btn-p btn-full" id="acct-go" onclick="acctDoGoogleRecover()">Reset</button>
  `);
}
function acctDoGoogleRecover(){
  if(_acctVal('acct-p')!==_acctVal('acct-p2')){_acctErr("The passwords don't match.");return;}
  _acctBusy('acct-go','Resetting…',async()=>{
    await VAULT.googleRecover(_acctVal('acct-c'),_acctVal('acct-p'));
    await _acctAfterAuth({isNew:false});
  });
}

// ── After sign-in: decide what happens to this device's data ──────────────
async function _acctAfterAuth({isNew}){
  const from=DATA_MODE;
  const localDocs=from==='local'?VAULT.localDocCount():0;
  if(from==='local'&&localDocs>0){
    const accountHasData=isNew?false:await VAULT.accountHasData();
    if(!accountHasData){await _acctUpload(localDocs);return;}
    return _acctShowReplace(localDocs);
  }
  if(from==='legacy'){
    const accountHasData=isNew?false:await VAULT.accountHasData();
    if(!accountHasData) return acctShowImport();
    _wipeDataCaches();
  }
  if(from==='local') await VAULT.clearLocal();
  acctClose();
  await _enterMode('cloud');
  toast('Signed in. Your data is syncing.');
}
async function _acctUpload(n){
  _acctShow(`
    <h2>Moving your data into your account</h2>
    <div class="acct-sub">Encrypting and uploading ${n} items from this device…</div>
    <div class="acct-prog"><div id="acct-bar"></div></div>
    <div class="acct-err" id="acct-err"></div>
  `);
  try{
    await VAULT.uploadLocal((d,t)=>{const b=document.getElementById('acct-bar');if(b)b.style.width=Math.round(d/t*100)+'%';});
    await VAULT.clearLocal();
    acctClose();
    await _enterMode('cloud');
    toast('Your data is now in your account and syncing.');
  }catch(e){
    console.warn('upload failed',e);
    _acctErr("Upload didn't finish. Your data is still on this device. Check your connection and try again.");
    const w=document.querySelector('#acct-ov .acct-wrap');
    if(w)w.insertAdjacentHTML('beforeend',`<button class="btn btn-p btn-full" onclick="_acctUpload(${n})">Try again</button>`);
  }
}
function _acctShowReplace(n){
  _acctShow(`
    <h2>Your account already has data</h2>
    <div class="acct-sub">This device has ${n} items that aren't in your account. Continuing loads your account's data and removes this device's copy.</div>
    <div class="acct-spacer"></div>
    <button class="btn btn-p btn-full" id="acct-go" onclick="_acctDoReplace()">Use my account's data</button>
    <button class="btn btn-g btn-full" onclick="acctSignOut()">Cancel and sign out</button>
  `);
}
async function _acctDoReplace(){
  await _acctBusy('acct-go','Loading…',async()=>{
    await VAULT.clearLocal();_wipeDataCaches();
    acctClose();
    await _enterMode('cloud');
  });
}

async function acctSignOut(){
  const wasCloud=DATA_MODE==='cloud';
  await VAULT.signOut();
  if(wasCloud) _wipeDataCaches();
  acctClose();
  await _enterMode('local');
  if(typeof renderAll==='function') renderAll();
  if(wasCloud) toast('Signed out. Your data is safe in your account.');
}

// ── Legacy import (owner's data from the old shared collections) ──────────
const LEGACY_COLLECTIONS=['transactions','income','cashBalances','cashLedger','investments','debtors','loans','budgets','transfers','historicalSummary','specialBudgets','aiChats','appConfig'];
function acctShowImport(){
  _acctShow(`
    <h2>Bring your existing data across</h2>
    <div class="acct-sub">This copies everything from the old shared database into your new account, encrypted. The old copy isn't changed or deleted.</div>
    <div class="acct-prog"><div id="acct-bar"></div></div>
    <div class="acct-sub" id="acct-imp-log" style="font-family:var(--mono);font-size:0.68rem;white-space:pre-line"></div>
    <div class="acct-err" id="acct-err"></div>
    <div class="acct-spacer"></div>
    <button class="btn btn-p btn-full" id="acct-go" onclick="acctDoImport()">Import my data</button>
    <div class="acct-link" style="color:var(--text2)" onclick="acctSkipImport()">Skip and start fresh</div>
  `);
}
async function acctSkipImport(){_wipeDataCaches();acctClose();await _enterMode('cloud');}
function acctDoImport(){
  _acctBusy('acct-go','Importing…',async()=>{
    const log=document.getElementById('acct-imp-log'),bar=document.getElementById('acct-bar');
    const raw=VAULT.raw,manifest={at:new Date().toISOString(),uid:VAULT.uid,collections:{}};
    const say=t=>{if(log)log.textContent+=t+'\n';};
    let done=0;
    for(const c of LEGACY_COLLECTIONS){
      const snap=await raw.collection(c).get({source:'server'});
      const docs=snap.docs;
      for(let i=0;i<docs.length;i+=200){
        const b=VAULT.udb.batch();
        docs.slice(i,i+200).forEach(d=>b.set(VAULT.udb.collection(c).doc(d.id),d.data()));
        await b.commit();
      }
      // verify: re-read from the account and compare ids (+ amounts for txns/income)
      const back=await VAULT.udb.collection(c).get({source:'server'});
      const srcIds=new Set(docs.map(d=>d.id)),dstIds=new Set(back.docs.map(d=>d.id));
      const missing=[...srcIds].filter(id=>!dstIds.has(id));
      let sumOk=true;
      if(c==='transactions'||c==='income'){
        const sum=arr=>arr.reduce((s,x)=>s+(+x.amtNGN||+x.amount||0),0);
        const a=Math.round(sum(docs.map(d=>d.data()))),b2=Math.round(sum(back.docs.map(d=>d.data())));
        sumOk=a===b2;manifest.collections[c]={count:docs.length,total:a,ids:[...srcIds]};
      }else manifest.collections[c]={count:docs.length,ids:[...srcIds]};
      if(missing.length||!sumOk) throw new VAULT.VaultError(`Check failed on ${c}: ${missing.length} missing${sumOk?'':', totals differ'}. Nothing was deleted; try again.`);
      say(`✓ ${c}: ${docs.length}`);
      done++;if(bar)bar.style.width=Math.round(done/LEGACY_COLLECTIONS.length*100)+'%';
    }
    say('Moving your personal defaults into your account…');
    manifest.ownerExtras=await _acctApplyLegacyProfile();
    say('✓ payee lines, categories, budgets, fixed bills, bank accounts');
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(manifest,null,1)],{type:'application/json'}));a.download='spendwise-import-manifest-'+manifest.at.slice(0,10)+'.json';a.click();
    say('\nAll collections copied and checked. A manifest file was downloaded; keep it with the repo.');
    try{localStorage.setItem(LOCAL_MODE_LS,'1');}catch{}
    const go=document.getElementById('acct-go');
    if(go){go.textContent='Open SpendWise';go.onclick=async()=>{_wipeDataCaches();acctClose();await _enterMode('cloud');};}
    return true;
  });
}

// The owner's old built-in defaults (legacy-profile.js, loaded only here)
// become ordinary per-account settings, merged with what the import copied.
function _acctLoadLegacyProfile(){
  if(window.LEGACY_PROFILE) return Promise.resolve(window.LEGACY_PROFILE);
  return new Promise((res,rej)=>{const s=document.createElement('script');s.src='legacy-profile.js?x='+Date.now();s.onload=()=>res(window.LEGACY_PROFILE);s.onerror=()=>rej(new VAULT.VaultError("Couldn't load your old defaults. Check your connection and try again."));document.head.appendChild(s);});
}
async function _acctApplyLegacyProfile(){
  const L=await _acctLoadLegacyProfile();
  const cfg=VAULT.udb.collection('appConfig');
  const get=async id=>{const d=await cfg.doc(id).get({source:'server'});return d.exists?d.data():null;};
  // payee lines: old built-ins -> customLines, skipping any the owner removed
  const cl=(await get('customLines'))||{};
  const lines={...(cl.lines||{})},removed=cl.removed||{};
  let movedLines=0;
  for(const cat in L.catLines){
    const gone=new Set(removed[cat]||[]);
    const cur=new Set(lines[cat]||[]);
    L.catLines[cat].forEach(p=>{if(!gone.has(p)&&!cur.has(p)&&!(CAT_LINES[cat]||[]).includes(p)){cur.add(p);movedLines++;}});
    if(cur.size) lines[cat]=[...cur];
  }
  await cfg.doc('customLines').set({lines,removed},{merge:true});
  // categories that are no longer built in
  const cc=(await get('customCats'))||{};
  const cats=[...new Set([...(cc.cats||[]),...L.extraCats])];
  await cfg.doc('customCats').set({cats},{merge:true});
  // bank accounts: the old undeletable defaults + the custom ones
  const ca=(await get('cashAccounts'))||{};
  const accounts=[...new Set([...L.cashAccounts,...(ca.accounts||[])])];
  const usd=[...new Set([...(ca.usd||[]),...L.usdAccounts])];
  await cfg.doc('cashAccounts').set({accounts,usd});
  // platforms only if the account has none saved
  const inv=(await get('investments'))||{};
  if(!Array.isArray(inv.platforms)||!inv.platforms.length) await cfg.doc('investments').set({platforms:L.platforms},{merge:true});
  // budgets + fixed bills fallbacks, and skip onboarding
  await cfg.doc('profile').set({onboarded:true,defBudgets:L.defBudgets,fixedObl:L.fixedObl,legacyImport:new Date().toISOString()},{merge:true});
  return {movedLines,cats,accounts,usd};
}

// ── Account card (More → Data) ────────────────────────────────────────────
function renderAccountCard(){
  if(typeof DATA_MODE==='undefined') return '';
  if(DATA_MODE==='cloud'){
    return `<div class="exp-card" style="margin-top:10px">
      <div class="exp-card-title" style="margin-bottom:6px">Account</div>
      <div class="exp-card-sub" style="margin-bottom:10px">Signed in as <b>${_acctEsc(VAULT.username)}</b>. Your data is encrypted on this device and synced to your account. Nobody else can read it.</div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-g btn-sm" style="flex:1" onclick="acctShowChangePw()">Change password</button>
        <button class="btn btn-g btn-sm" style="flex:1" onclick="acctConfirmSignOut()">Sign out</button>
      </div></div>`;
  }
  return `<div class="exp-card" style="margin-top:10px">
    <div class="exp-card-title" style="margin-bottom:6px">Account</div>
    <div class="exp-card-sub" style="margin-bottom:10px">Your data is saved on this device only. Sign in to sync across your devices and get it back if you lose this one.</div>
    <button class="btn btn-p btn-sm btn-full" onclick="acctShowWhy(${DATA_MODE==='legacy'})">Sign in or create account</button></div>`;
}
function acctConfirmSignOut(){
  _acctShow(`
    <div class="acct-back" onclick="acctClose()">‹ Back</div>
    <h2>Sign out of this device?</h2>
    <div class="acct-sub">Your data stays safe in your account. This device's copy is removed, and you'll need your password to sign in here again.</div>
    <div class="acct-spacer"></div>
    <button class="btn btn-p btn-full" onclick="acctSignOut()">Sign out</button>
    <button class="btn btn-g btn-full" onclick="acctClose()">Cancel</button>
  `);
}
function acctShowChangePw(){
  _acctShow(`
    <div class="acct-back" onclick="acctClose()">‹ Back</div>
    <h2>Change password</h2>
    <div><label class="ilabel">Current password</label><input class="ifield" id="acct-o" type="password" autocomplete="current-password"></div>
    <div><label class="ilabel">New password</label><input class="ifield" id="acct-p" type="password" autocomplete="new-password" placeholder="10 or more characters"></div>
    <div><label class="ilabel">Confirm new password</label><input class="ifield" id="acct-p2" type="password" autocomplete="new-password"></div>
    <div class="acct-muted" style="text-align:left">Your recovery code keeps working.</div>
    <div class="acct-err" id="acct-err"></div>
    <button class="btn btn-p btn-full" id="acct-go" onclick="acctDoChangePw()">Change password</button>
  `);
}
function acctDoChangePw(){
  if(_acctVal('acct-p')!==_acctVal('acct-p2')){_acctErr("The passwords don't match.");return;}
  _acctBusy('acct-go','Saving…',async()=>{
    await VAULT.changePassword(_acctVal('acct-o'),_acctVal('acct-p'));
    acctClose();toast('Password changed');
  });
}
