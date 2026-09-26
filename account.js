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
#acct-ov .acct-err{font-size:0.8rem;font-weight:600;color:var(--red);line-height:1.45}
#acct-ov .acct-err:not(:empty){background:var(--rdim);border:1px solid var(--red);border-radius:var(--rsm);padding:9px 12px}
#acct-ov .acct-link{font-size:0.74rem;color:var(--accent);cursor:pointer;text-align:center;font-weight:600}
#acct-ov .acct-muted{font-size:0.7rem;color:var(--text3);text-align:center;line-height:1.5}
#acct-ov .acct-back{font-size:0.74rem;color:var(--text2);cursor:pointer;align-self:flex-start}
#acct-ov .acct-spacer{flex:1}
#acct-ov .acct-or{display:flex;align-items:center;gap:10px;font-size:0.66rem;color:var(--text3)}
#acct-ov .acct-or:before,#acct-ov .acct-or:after{content:'';flex:1;height:1px;background:var(--border)}
#acct-ov .acct-prog{height:6px;background:var(--bg2);border-radius:3px;overflow:hidden}
#acct-ov .acct-prog div{height:100%;background:var(--accent);width:0;transition:width .2s}
#acct-ov label.acct-check{display:flex;gap:8px;align-items:center;font-size:0.78rem;color:var(--text);cursor:pointer}
#lock-ov{position:fixed;inset:0;z-index:3000;background:var(--bg);display:none;overflow-y:auto}
#lock-ov .lk{max-width:360px;margin:0 auto;min-height:100%;padding:40px 24px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center}
#lock-ov .lk-i{font-size:2.6rem}
#lock-ov h2{font-size:1.2rem;font-weight:800;margin:0;color:var(--text)}
#lock-ov .lk-s{font-size:0.8rem;color:var(--text2);line-height:1.55}
#lock-ov .lk-l{font-size:0.76rem;color:var(--accent);font-weight:600;cursor:pointer}
#lock-ov .acct-err{font-size:0.8rem;font-weight:600;color:var(--red)}
#lock-ov .ifield{width:100%}
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
// Errors must be impossible to miss: on a phone the keyboard can cover the
// message, so highlight it, scroll it into view and also show a toast.
function _acctErr(msg){
  const el=document.getElementById('acct-err');if(el)el.textContent=msg||'';
  if(!msg) return;
  if(el)setTimeout(()=>el.scrollIntoView({block:'center',behavior:'smooth'}),50);
  if(typeof toast==='function')toast(msg);
  if(typeof haptic==='function')try{haptic();}catch{}
}
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
    <div><label class="ilabel">Password</label><input class="ifield" id="acct-p" type="password" autocomplete="new-password" placeholder="${VAULT.MIN_PASSWORD} or more characters"></div>
    <div><label class="ilabel">Confirm password</label><input class="ifield" id="acct-p2" type="password" autocomplete="new-password"></div>
    <div><label class="ilabel">Recovery email <span style="font-weight:400;color:var(--text3)">(optional)</span></label><input class="ifield" id="acct-e" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" placeholder="you@example.com" onkeydown="_acctOnEnter(event,acctDoCreate)"></div>
    <div class="acct-muted" style="text-align:left">Your password also locks your data. It never leaves this device, so nobody can reset it for you. You'll get a recovery code next in case you forget it. Add an email and you can send that code to your inbox, so it's there if you need it. The email is only used for this, and it's encrypted like the rest of your data.</div>
    <div class="acct-err" id="acct-err"></div>
    <button class="btn btn-p btn-full" id="acct-go" onclick="acctDoCreate()">Create account</button>
  `);
}
function acctDoCreate(){
  const u=_acctVal('acct-u'),p=_acctVal('acct-p'),p2=_acctVal('acct-p2'),e=_acctVal('acct-e').trim();
  if(p!==p2){_acctErr("The passwords don't match.");return;}
  _acctBusy('acct-go','Creating…',async()=>{
    const code=await VAULT.signUp(u,p,e);
    acctShowCode(code,()=>_acctAfterAuth({isNew:true}),{email:e,username:u});
  });
}

// ── 3. Recovery code ──────────────────────────────────────────────────────
let _acctCodeNext=null,_acctCodeEmail='',_acctCodeUser='';
function acctShowCode(code,next,opts){
  _acctCodeNext=next;
  _acctCodeEmail=(opts&&opts.email)||'';
  _acctCodeUser=(opts&&opts.username)||VAULT.username||'';
  _acctShow(`
    <h2>Save your recovery code</h2>
    <div class="acct-sub">If you ever forget your password, this code is the only way back into your data. Nobody else has a copy, including the app's creator.</div>
    <div class="acct-code" id="acct-code">${_acctEsc(code)}</div>
    ${_acctCodeEmail?`<button class="btn btn-inc btn-sm btn-full" onclick="acctEmailCode()">✉ Email it to ${_acctEsc(_acctCodeEmail)}</button>`:''}
    <div style="display:flex;gap:8px">
      <button class="btn btn-g btn-sm" style="flex:1" onclick="acctCopyCode()">Copy</button>
      <button class="btn btn-g btn-sm" style="flex:1" onclick="acctSaveCode()">Save as file</button>
      ${_acctCodeEmail?'':`<button class="btn btn-g btn-sm" style="flex:1" onclick="acctEmailCode()">Email</button>`}
    </div>
    ${_acctCodeEmail?`<div class="acct-muted" style="text-align:left">This opens your email app with the code filled in. Tap <b>Send</b> to keep a copy in your inbox. Anyone who can read that email and knows your username could get into your account, so only use an email you keep secure.</div>`:''}
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
// Sent from the user's own email app (mailto:), so the code never passes
// through anything the app's creator runs.
function _acctRecoveryMail(to,username,code){
  const link=location.origin+location.pathname;
  const body=`SpendWise recovery code\n\nUsername: ${username}\nRecovery code: ${code}\n\nIf you forget your password: open ${link} , choose "I already have an account", then "Forgot password? Use your recovery code".\n\nKeep this email private. With your username, this code lets someone reset your password.`;
  location.href=`mailto:${encodeURIComponent(to||'')}?subject=${encodeURIComponent('SpendWise recovery code')}&body=${encodeURIComponent(body)}`;
}
function acctEmailCode(){
  _acctRecoveryMail(_acctCodeEmail,_acctCodeUser,document.getElementById('acct-code').textContent);
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
    <div class="acct-sub">Enter your username and the recovery code you saved when you created your account, then choose a new password. If you emailed the code to yourself, search your inbox for "SpendWise recovery code".</div>
    <div><label class="ilabel">Username</label><input class="ifield" id="acct-u" autocomplete="username" autocapitalize="none" spellcheck="false"></div>
    <div><label class="ilabel">Recovery code</label><input class="ifield" id="acct-c" autocapitalize="characters" spellcheck="false" placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" style="font-family:var(--mono)"></div>
    <div><label class="ilabel">New password</label><input class="ifield" id="acct-p" type="password" autocomplete="new-password" placeholder="${VAULT.MIN_PASSWORD} or more characters"></div>
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
    <div><label class="ilabel">Data password</label><input class="ifield" id="acct-p" type="password" autocomplete="new-password" placeholder="${VAULT.MIN_PASSWORD} or more characters"></div>
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
  // A device that ran a pre-accounts version: its caches are the old shared
  // data, which the account replaces (the owner's copy was imported in v4.5).
  if(from==='legacy') _wipeDataCaches();
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

// ── Account card (Settings → Data) ────────────────────────────────────────────
function renderAccountCard(){
  if(typeof DATA_MODE==='undefined') return '';
  if(DATA_MODE==='cloud'){
    return `<div class="exp-card" style="margin-top:10px">
      <div class="exp-card-title" style="margin-bottom:6px">Account</div>
      <div class="exp-card-sub" style="margin-bottom:10px">Signed in as <b>${_acctEsc(VAULT.username)}</b>. Your data is encrypted on this device and synced to your account. Nobody else can read it.</div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-g btn-sm" style="flex:1" onclick="acctShowChangePw()">Change password</button>
        <button class="btn btn-g btn-sm" style="flex:1" onclick="acctConfirmSignOut()">Sign out</button>
      </div>
      <button class="btn btn-g btn-sm btn-full" style="margin-top:8px" onclick="acctShowRecovery()">Recovery code &amp; email</button>
      <div style="color:var(--red);margin-top:12px;font-size:0.7rem;font-weight:600;text-align:center;cursor:pointer" onclick="acctShowDelete()">Delete my account</div></div>`;
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
// ── Delete account (signed in) ────────────────────────────────────────────
function acctShowDelete(){
  _acctShow(`
    <div class="acct-back" onclick="acctClose()">‹ Back</div>
    <h2>Delete your account?</h2>
    <div class="acct-sub">This permanently deletes your account and <b>all your data</b> on every device: transactions, balances, investments, budgets, AI chats and settings. It can't be undone, and nobody can recover it for you.</div>
    <div class="acct-sub">Want a copy first? Go to Settings → Export and download a backup.</div>
    <div><label class="ilabel">Type your username to confirm</label><input class="ifield" id="acct-u" autocomplete="off" autocapitalize="none" spellcheck="false"></div>
    <div><label class="ilabel">Password</label><input class="ifield" id="acct-p" type="password" autocomplete="current-password" onkeydown="_acctOnEnter(event,acctDoDelete)"></div>
    <div class="acct-err" id="acct-err"></div>
    <div class="acct-spacer"></div>
    <button class="btn btn-d btn-full" id="acct-go" onclick="acctDoDelete()">Delete everything</button>
    <button class="btn btn-g btn-full" onclick="acctClose()">Cancel</button>
  `);
}
function acctDoDelete(){
  if(VAULT.normUser(_acctVal('acct-u'))!==VAULT.normUser(VAULT.username)){_acctErr("That isn't your username.");return;}
  _acctBusy('acct-go','Deleting…',async()=>{
    const b=document.getElementById('acct-go');
    await VAULT.deleteAccount(_acctVal('acct-p'),n=>{if(b)b.textContent=`Deleting… (${n})`;});
    _wipeDataCaches();
    try{localStorage.removeItem(LOCK_LS);}catch{}
    await VAULT.clearLocal();
    acctClose();
    await _enterMode('local');
    if(typeof renderAll==='function') renderAll();
    toast('Your account and data have been deleted.');
  });
}

// ── Recovery code & email (signed in) ─────────────────────────────────────
let _acctRec=null; // {code,email,username} while this screen is open
async function acctShowRecovery(){
  _acctShow(`<div class="acct-back" onclick="acctClose()">‹ Back</div><h2>Recovery code &amp; email</h2><div class="acct-sub">Loading…</div>`);
  try{_acctRec=await VAULT.recoveryInfo();}
  catch(e){console.warn('recovery info failed',e);_acctRec=null;}
  if(!_acctRec){_acctShow(`<div class="acct-back" onclick="acctClose()">‹ Back</div><h2>Recovery code &amp; email</h2><div class="acct-sub">Couldn't load this right now. Check your connection and try again.</div>`);return;}
  const r=_acctRec;
  _acctShow(`
    <div class="acct-back" onclick="acctClose()">‹ Back</div>
    <h2>Recovery code &amp; email</h2>
    <div class="acct-sub">If you forget your password, your recovery code is the only way back in. Keep it somewhere safe, or email it to yourself.</div>
    <div><label class="ilabel">Recovery email <span style="font-weight:400;color:var(--text3)">(optional)</span></label><input class="ifield" id="acct-e" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" placeholder="you@example.com" value="${_acctEsc(r.email||'')}"></div>
    <button class="btn btn-g btn-sm btn-full" id="acct-esave" onclick="acctSaveRecEmail()">Save email</button>
    <div class="acct-muted" style="text-align:left">Used only to send your recovery code to yourself. It's encrypted like the rest of your data, so nobody else can see it.</div>
    ${r.code?`
      <div class="acct-code" id="acct-code" style="filter:blur(6px);cursor:pointer" onclick="this.style.filter='none'" title="Tap to show">${_acctEsc(r.code)}</div>
      <div class="acct-muted">Tap the code to show it.</div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-inc btn-sm" style="flex:1" onclick="acctEmailSavedCode()">✉ Email it to me</button>
        <button class="btn btn-g btn-sm" style="flex:1" onclick="acctCopyCode()">Copy</button>
      </div>`
    :`<div class="acct-sub" style="margin-top:6px">Your account was made before recovery codes could be shown again, so this device can't display it. If you still have it saved, you're fine. If not, create a new one below.</div>`}
    <div class="acct-err" id="acct-err"></div>
    <div class="acct-spacer"></div>
    <div><label class="ilabel">Lost your code? Enter your password to create a new one</label><input class="ifield" id="acct-p" type="password" autocomplete="current-password" onkeydown="_acctOnEnter(event,acctDoNewCode)"></div>
    <button class="btn btn-g btn-full" id="acct-go" onclick="acctDoNewCode()">Create a new recovery code</button>
    <div class="acct-muted" style="text-align:left">Your old code stops working once a new one is created.</div>
  `);
}
function acctSaveRecEmail(){
  _acctBusy('acct-esave','Saving…',async()=>{
    const e=await VAULT.setRecoveryEmail(_acctVal('acct-e'));
    if(_acctRec)_acctRec.email=e;
    toast(e?'Recovery email saved':'Recovery email removed');
  });
}
function acctEmailSavedCode(){
  if(!_acctRec||!_acctRec.code)return;
  const to=_acctVal('acct-e').trim()||_acctRec.email||'';
  _acctRecoveryMail(to,_acctRec.username||VAULT.username,_acctRec.code);
}
function acctDoNewCode(){
  _acctBusy('acct-go','Creating…',async()=>{
    const code=await VAULT.newRecoveryCodeFor(_acctVal('acct-p'));
    const email=(_acctRec&&_acctRec.email)||'';
    acctShowCode(code,()=>{acctClose();toast('New recovery code saved');if(typeof renderSettData==='function')renderSettData();},{email,username:(_acctRec&&_acctRec.username)||VAULT.username});
  });
}
function acctShowChangePw(){
  _acctShow(`
    <div class="acct-back" onclick="acctClose()">‹ Back</div>
    <h2>Change password</h2>
    <div><label class="ilabel">Current password</label><input class="ifield" id="acct-o" type="password" autocomplete="current-password"></div>
    <div><label class="ilabel">New password</label><input class="ifield" id="acct-p" type="password" autocomplete="new-password" placeholder="${VAULT.MIN_PASSWORD} or more characters"></div>
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

// ══════════════════════════════════════════════════════════════════════════
// APP LOCK — fingerprint / Face ID / device PIN via WebAuthn
// ══════════════════════════════════════════════════════════════════════════
// A privacy screen for people who hand their phone to others. It is a gate in
// front of the UI, not extra encryption: the data on the device is protected
// by the account's encryption and the phone's own lock, not by this. The OS
// prompt (fingerprint, face or device PIN) does the checking; the signature it
// returns is not verified because there's no server to verify it against.
// Needs an account so the password is always there as a fallback.
const LOCK_LS='sw3_applock';           // {credId, uid, after(min)} on this device
const LOCK_AFTER=[0,1,5,15];
let _lockHiddenAt=0,_lockOpen=false;
function lockCfg(){try{const c=JSON.parse(localStorage.getItem(LOCK_LS)||'null');return c&&c.credId?c:null;}catch{return null;}}
function _lockB64(buf){let s='';new Uint8Array(buf).forEach(b=>s+=String.fromCharCode(b));return btoa(s);}
function _lockUnb64(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
async function lockSupported(){
  try{return !!(window.PublicKeyCredential&&await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());}catch{return false;}
}
async function lockEnable(){
  if(DATA_MODE!=='cloud'){toast('Create an account first');return;}
  if(!await lockSupported()){toast("This device or browser doesn't support fingerprint or face unlock");return;}
  try{
    const name=VAULT.username||'SpendWise';
    const cred=await navigator.credentials.create({publicKey:{
      challenge:crypto.getRandomValues(new Uint8Array(32)),
      rp:{name:'SpendWise'},
      user:{id:new TextEncoder().encode(String(VAULT.uid).slice(0,64)),name,displayName:name},
      pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],
      authenticatorSelection:{authenticatorAttachment:'platform',userVerification:'required',residentKey:'discouraged'},
      timeout:60000,
    }});
    if(!cred) return;
    try{await VAULT.primeVerifier();}catch(e){console.warn('lock: password check not cached',e);}
    localStorage.setItem(LOCK_LS,JSON.stringify({credId:_lockB64(cred.rawId),uid:VAULT.uid,after:1}));
    toast('App lock is on');
  }catch(e){
    if(e&&e.name==='NotAllowedError'){toast('App lock was not turned on');return;}
    console.warn('lock enable failed',e);toast("Couldn't turn on app lock on this device");
  }
  if(typeof renderSettData==='function') renderSettData();
}
function lockDisable(){
  try{localStorage.removeItem(LOCK_LS);}catch{}
  toast('App lock is off');
  if(typeof renderSettData==='function') renderSettData();
}
function lockSetAfter(v){
  const c=lockCfg();if(!c)return;c.after=+v;
  try{localStorage.setItem(LOCK_LS,JSON.stringify(c));}catch{}
}
function renderAppLockCard(){
  const c=lockCfg();
  const body=DATA_MODE!=='cloud'
    ?`<div class="exp-card-sub" style="margin-bottom:0">Lock SpendWise with your fingerprint, face or phone PIN. Sign in first: your password is the backup if the scan doesn't work.</div>`
    :c?`<div class="exp-card-sub" style="margin-bottom:10px">On. SpendWise asks for your fingerprint, face or phone PIN when you open it.</div>
        <div style="display:flex;gap:8px;align-items:center">
          <label class="ilabel" style="margin:0;flex:1">Lock when I leave the app for</label>
          <select class="sfield" style="width:auto;font-size:0.72rem;padding:5px 8px" onchange="lockSetAfter(this.value)">
            ${LOCK_AFTER.map(m=>`<option value="${m}" ${(c.after??1)===m?'selected':''}>${m===0?'Immediately':m+' min'}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-g btn-sm btn-full" style="margin-top:10px" onclick="lockDisable()">Turn off app lock</button>`
    :`<div class="exp-card-sub" style="margin-bottom:10px">Ask for your fingerprint, face or phone PIN whenever SpendWise opens, so nobody else can look at your finances.</div>
      <button class="btn btn-p btn-sm btn-full" onclick="lockEnable()">Turn on app lock</button>`;
  return`<div class="exp-card" style="margin-top:10px"><div class="exp-card-title" style="margin-bottom:6px">🔒 App lock</div>${body}</div>`;
}
function _lockOv(){
  let ov=document.getElementById('lock-ov');
  if(!ov){ov=document.createElement('div');ov.id='lock-ov';document.body.appendChild(ov);}
  return ov;
}
function lockShow(){
  if(_lockOpen) return;
  _lockOpen=true;
  const ov=_lockOv();
  ov.innerHTML=`<div class="lk">
    <div class="lk-i">🔒</div>
    <h2>SpendWise is locked</h2>
    <div class="lk-s">Use your fingerprint, face or phone PIN to open it.</div>
    <button class="btn btn-p btn-full" id="lk-go" onclick="lockTryUnlock()">Unlock</button>
    <div class="acct-err" id="lk-err"></div>
    <div class="lk-l" onclick="lockShowPassword()">Use my password instead</div>
  </div>`;
  ov.style.display='block';
  // Android Chrome allows the prompt straight away; iOS needs the tap.
  if(!/iPhone|iPad|iPod/.test(navigator.userAgent)) setTimeout(lockTryUnlock,250);
}
function _lockDone(){
  _lockOpen=false;
  const ov=document.getElementById('lock-ov');if(ov){ov.style.display='none';ov.innerHTML='';}
}
async function lockTryUnlock(){
  const c=lockCfg();if(!c){_lockDone();return;}
  const err=document.getElementById('lk-err');if(err)err.textContent='';
  try{
    const a=await navigator.credentials.get({publicKey:{
      challenge:crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials:[{type:'public-key',id:_lockUnb64(c.credId)}],
      userVerification:'required',timeout:60000,
    }});
    if(a) _lockDone();
  }catch(e){
    if(err) err.textContent=e&&e.name==='NotAllowedError'?'Not unlocked. Tap Unlock to try again.':"Couldn't use fingerprint or face here. Use your password instead.";
  }
}
function lockShowPassword(){
  const ov=_lockOv();
  ov.innerHTML=`<div class="lk">
    <div class="lk-i">🔑</div>
    <h2>Enter your password</h2>
    <div class="lk-s">Your SpendWise account password${VAULT.username?' for <b>'+_acctEsc(VAULT.username)+'</b>':''}.</div>
    <input class="ifield" id="lk-p" type="password" autocomplete="current-password" onkeydown="if(event.key==='Enter')lockDoPassword()">
    <div class="acct-err" id="lk-err"></div>
    <button class="btn btn-p btn-full" id="lk-go" onclick="lockDoPassword()">Unlock</button>
    <div class="lk-l" onclick="_lockOpen=false;lockShow()">Use fingerprint or face</div>
  </div>`;
  setTimeout(()=>document.getElementById('lk-p')?.focus(),50);
}
async function lockDoPassword(){
  const b=document.getElementById('lk-go'),err=document.getElementById('lk-err');
  if(b){b.disabled=true;b.textContent='Checking…';}
  try{
    if(await VAULT.verifyPassword(_acctVal('lk-p'))) _lockDone();
    else if(err) err.textContent="That password isn't right.";
  }catch(e){if(err)err.textContent=e instanceof VAULT.VaultError?e.message:'Something went wrong. Try again.';}
  finally{if(b&&document.body.contains(b)){b.disabled=false;b.textContent='Unlock';}}
}
// Lock on open, and again after being away longer than the chosen time.
(function lockInit(){
  if(lockCfg()) lockShow();
  document.addEventListener('visibilitychange',()=>{
    const c=lockCfg();if(!c) return;
    if(document.visibilityState==='hidden'){if(!_lockOpen)_lockHiddenAt=Date.now();}
    else if(!_lockOpen&&_lockHiddenAt&&Date.now()-_lockHiddenAt>=(c.after??1)*60000) lockShow();
  });
})();
