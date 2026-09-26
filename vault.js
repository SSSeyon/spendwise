// ══════════════════════════════════════════════════════════════════════════
// VAULT — accounts + on-device encryption
// ══════════════════════════════════════════════════════════════════════════
// Every signed-in user's data lives under users/{uid}/… and is AES-GCM
// encrypted on the device before it is written. The project owner can see
// document counts, year/month and write times — never amounts, payees,
// notes, balances or chats.
//
// Key hierarchy (all WebCrypto, no libraries):
//   master     = PBKDF2-SHA256(password, "sw1|u:<username>", 600k)
//   authSecret = HKDF(master,"sw-auth-v1")  → the Firebase password. The real
//                password never leaves the device, so Firebase holds nothing
//                that can unlock the data.
//   kek        = HKDF(master,"sw-kek-v1")   → wraps the data key (DEK)
//   DEK        = random 256-bit AES-GCM key → encrypts every document
//   recovery   = 125-bit random code; HKDF(code) gives a second DEK wrap, the
//                id of a public recovery/{id} doc, and the key that seals the
//                current authSecret inside it (so a forgotten password can
//                still sign in without any email).
// The unwrapped DEK is kept in IndexedDB as a NON-extractable CryptoKey, so a
// device asks for the password once.
//
// `udb` mimics the slice of the Firestore compat API app.js uses, so app.js
// keeps calling db.collection(...) unchanged. Only `year` and `month` stay in
// plaintext (month queries/listeners need them); filters and sorts on any
// other field run on the device after decryption.
'use strict';

const VAULT=(()=>{
  const te=new TextEncoder(),td=new TextDecoder();
  const subtle=crypto.subtle;
  const PBKDF2_ITER=600000;
  const SYNTH_DOMAIN='spendwise.invalid';
  const PLAIN=new Set(['year','month']);
  const META_FIELDS=new Set(['v','_enc','year','month']);

  // ── encoding helpers ────────────────────────────────────────────────────
  const b64=u8=>{let s='';for(let i=0;i<u8.length;i+=0x8000)s+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000));return btoa(s);};
  const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  const hex=u8=>Array.from(u8,b=>b.toString(16).padStart(2,'0')).join('');
  const rand=n=>crypto.getRandomValues(new Uint8Array(n));
  const CROCK='0123456789ABCDEFGHJKMNPQRSTVWXYZ';

  function normUser(u){return String(u||'').trim().toLowerCase();}
  function validUser(u){return /^[a-z0-9][a-z0-9._-]{2,23}$/.test(u);}
  function userEmail(u){return normUser(u)+'@'+SYNTH_DOMAIN;}
  function userSalt(u){return 'sw1|u:'+normUser(u);}
  function googleSalt(uid){return 'sw1|g:'+uid;}

  function newRecoveryCode(){
    const r=rand(25);let s='';
    for(let i=0;i<25;i++){s+=CROCK[r[i]&31];if(i%5===4&&i<24)s+='-';}
    return s;
  }
  function codeBytes(code){
    const c=String(code||'').toUpperCase().replace(/[^0-9A-Z]/g,'').replace(/O/g,'0').replace(/[IL]/g,'1');
    if(c.length!==25||[...c].some(ch=>!CROCK.includes(ch))) return null;
    return te.encode(c);
  }

  // ── crypto primitives ───────────────────────────────────────────────────
  async function hkdf(ikm,salt,info){
    const k=await subtle.importKey('raw',ikm,'HKDF',false,['deriveBits']);
    return new Uint8Array(await subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt:te.encode(salt),info:te.encode(info)},k,256));
  }
  const aesKey=(raw,extractable=false)=>subtle.importKey('raw',raw,{name:'AES-GCM'},extractable,['encrypt','decrypt']);
  async function seal(key,bytes,aad){
    const iv=rand(12);
    const ct=new Uint8Array(await subtle.encrypt({name:'AES-GCM',iv,additionalData:te.encode(aad||'')},key,bytes));
    const out=new Uint8Array(12+ct.length);out.set(iv);out.set(ct,12);
    return b64(out);
  }
  async function open(key,s,aad){
    const u=unb64(s);
    return new Uint8Array(await subtle.decrypt({name:'AES-GCM',iv:u.subarray(0,12),additionalData:te.encode(aad||'')},key,u.subarray(12)));
  }
  async function passwordKeys(password,salt){
    const pk=await subtle.importKey('raw',te.encode(String(password).normalize('NFKC')),'PBKDF2',false,['deriveBits']);
    const master=new Uint8Array(await subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:te.encode(salt),iterations:PBKDF2_ITER},pk,256));
    return {
      authSecret:'sw1.'+b64(await hkdf(master,salt,'sw-auth-v1')),
      kek:await aesKey(await hkdf(master,salt,'sw-kek-v1')),
    };
  }
  async function recoveryKeys(code,salt){
    const raw=codeBytes(code);if(!raw) return null;
    const authRaw=await hkdf(raw,salt,'sw-rec-auth-v1');
    return {
      docId:hex(await hkdf(raw,salt,'sw-rec-id-v1')),
      kek:await aesKey(await hkdf(raw,salt,'sw-rec-kek-v1')),
      authRaw, authKey:await aesKey(authRaw),
    };
  }

  // ── device key store (IndexedDB, non-extractable CryptoKey) ─────────────
  function idb(){return new Promise((res,rej)=>{const r=indexedDB.open('spendwise-vault',1);r.onupgradeneeded=()=>r.result.createObjectStore('keys');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
  async function idbPut(k,v){const d=await idb();return new Promise((res,rej)=>{const t=d.transaction('keys','readwrite');t.objectStore('keys').put(v,k);t.oncomplete=()=>res();t.onerror=()=>rej(t.error);});}
  async function idbGet(k){const d=await idb();return new Promise((res,rej)=>{const t=d.transaction('keys','readonly');const r=t.objectStore('keys').get(k);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
  async function idbClear(){const d=await idb();return new Promise((res,rej)=>{const t=d.transaction('keys','readwrite');t.objectStore('keys').clear();t.oncomplete=()=>res();t.onerror=()=>rej(t.error);});}

  // ── session state ───────────────────────────────────────────────────────
  let raw=null;      // real firebase.firestore()
  let uid=null;      // signed-in uid
  let dek=null;      // CryptoKey
  const plainCache=new Map(); // path -> last known plaintext (for merge writes)

  async function _installDek(rawDek,forUid){
    dek=await aesKey(rawDek,false);
    uid=forUid;
    try{await idbPut(forUid,{dek,at:Date.now()});}catch(e){console.warn('vault: could not remember key on this device',e);}
  }
  async function restoreDevice(forUid){
    try{const r=await idbGet(forUid);if(r&&r.dek){dek=r.dek;uid=forUid;return true;}}
    catch(e){console.warn('vault: device key read failed',e);}
    return false;
  }

  // ── value encoding ──────────────────────────────────────────────────────
  // Sentinels are plain objects so they survive JSON (the offline queue
  // stores pending writes in localStorage).
  const FV={
    serverTimestamp:()=>({__fv:'ts'}),
    increment:n=>({__fv:'inc',v:+n}),
    arrayUnion:(...v)=>({__fv:'union',v}),
    delete:()=>({__fv:'del'}),
  };
  const isFV=(v,k)=>v&&typeof v==='object'&&v.__fv===k;
  function nowTs(){const ms=Date.now();return {seconds:Math.floor(ms/1000),nanoseconds:(ms%1000)*1e6};}
  function toPlain(v){
    if(v===null||typeof v!=='object') return v;
    if(isFV(v,'ts')) return nowTs();
    if(typeof v.toMillis==='function'&&typeof v.seconds==='number') return {seconds:v.seconds,nanoseconds:v.nanoseconds||0};
    if(v instanceof Date) return v.toISOString();
    if(Array.isArray(v)) return v.map(toPlain);
    const o={};for(const k in v){const x=v[k];if(x===undefined)continue;o[k]=toPlain(x);}return o;
  }
  const aadFor=path=>uid+'/'+path;
  async function encJson(path,obj,suffix){return seal(dek,te.encode(JSON.stringify(obj)),aadFor(path)+(suffix||''));}
  async function decJson(path,s,suffix){return JSON.parse(td.decode(await open(dek,s,aadFor(path)+(suffix||''))));}

  // raw Firestore doc → plaintext object
  async function decodeDoc(path,rd){
    if(!rd) return undefined;
    let obj={};
    if(rd._enc){
      try{obj=await decJson(path,rd._enc);}
      catch(e){console.warn('vault: could not decrypt '+path,e);obj={};}
    }
    for(const f in rd){
      if(META_FIELDS.has(f)) continue;
      const arr=rd[f];if(!Array.isArray(arr)) continue;
      const out=[];const seen=new Set();
      const push=x=>{const k=JSON.stringify(x);if(!seen.has(k)){seen.add(k);out.push(x);}};
      (Array.isArray(obj[f])?obj[f]:[]).forEach(push);
      for(const s of arr){
        if(typeof s!=='string') continue;
        try{push(await decJson(path,s,'#'+f));}catch(e){console.warn('vault: bad array entry in '+path+'#'+f,e);}
      }
      obj[f]=out;
    }
    if(typeof rd.year==='number'&&obj.year==null) obj.year=rd.year;
    if(typeof rd.month==='number'&&obj.month==null) obj.month=rd.month;
    return obj;
  }

  // Split a write payload into: plaintext fields, arrayUnion ops, increments.
  function splitPayload(data){
    const fields={},unions={},incs={},dels=[];
    for(const k in data){
      const v=data[k];
      if(v===undefined) continue;
      if(isFV(v,'union')) unions[k]=v.v.map(toPlain);
      else if(isFV(v,'inc')) incs[k]=v.v;
      else if(isFV(v,'del')) dels.push(k);
      else fields[k]=toPlain(v);
    }
    return {fields,unions,incs,dels};
  }
  function applyMerge(base,sp){
    const o={...(base||{})};
    Object.assign(o,sp.fields);
    sp.dels.forEach(k=>{delete o[k];});
    for(const k in sp.incs) o[k]=(+o[k]||0)+sp.incs[k];
    return o;
  }
  // plaintext object (+ pending unions) → raw Firestore payload
  async function encodeDoc(path,obj,unions){
    const out={v:1,_enc:await encJson(path,obj)};
    if(typeof obj.year==='number') out.year=obj.year;
    if(typeof obj.month==='number') out.month=obj.month;
    for(const k in (unions||{})){
      const enc=await Promise.all(unions[k].map(x=>encJson(path,x,'#'+k)));
      out[k]=firebase.firestore.FieldValue.arrayUnion(...enc);
    }
    return out;
  }

  // ── wrapper classes ─────────────────────────────────────────────────────
  class DocSnap{
    constructor(ref,exists,data,metadata){this.ref=ref;this.id=ref.id;this.exists=exists;this._d=data;this.metadata=metadata||{hasPendingWrites:false,fromCache:false};}
    data(){return this._d===undefined?undefined:JSON.parse(JSON.stringify(this._d));}
    get(f){return this._d?this._d[f]:undefined;}
  }
  class QuerySnap{
    constructor(docs,metadata){this.docs=docs;this.size=docs.length;this.empty=!docs.length;this.metadata=metadata||{hasPendingWrites:false,fromCache:false};}
    forEach(fn){this.docs.forEach(fn);}
  }
  async function wrapDocSnap(ref,rs){
    if(!rs.exists){plainCache.delete(ref.path);return new DocSnap(ref,false,undefined,rs.metadata);}
    const d=await decodeDoc(ref.path,rs.data());
    plainCache.set(ref.path,d);
    return new DocSnap(ref,true,d,rs.metadata);
  }

  class DocRef{
    constructor(col,rawRef){this._col=col;this._raw=rawRef;this.id=rawRef.id;this.path=col+'/'+rawRef.id;}
    async get(opts){return wrapDocSnap(this,await this._raw.get(opts));}
    async _base(){
      if(plainCache.has(this.path)) return plainCache.get(this.path);
      try{const s=await this.get();return s.exists?s.data():{};}catch{return {};}
    }
    async set(data,opts){
      const sp=splitPayload(data||{});
      const merge=!!(opts&&opts.merge);
      if(Object.keys(sp.incs).length) return this._incrementWrite(sp);
      if(!merge){
        const obj=applyMerge({},sp);
        plainCache.set(this.path,obj);
        return this._raw.set(await encodeDoc(this.path,obj,sp.unions));
      }
      const obj=applyMerge(await this._base(),sp);
      plainCache.set(this.path,obj);
      return this._raw.set(await encodeDoc(this.path,obj,sp.unions),{merge:true});
    }
    update(data){return this.set(data,{merge:true});}
    async delete(){plainCache.delete(this.path);return this._raw.delete();}
    // Increments can't run on ciphertext: read-decrypt-add-encrypt inside a
    // transaction, which keeps concurrent devices from clobbering each other.
    // Transactions need the network, so this rejects offline and the caller's
    // existing offline fallback takes over.
    async _incrementWrite(sp){
      const self=this;
      return raw.runTransaction(async t=>{
        const rs=await t.get(self._raw);
        const base=rs.exists?await decodeDoc(self.path,rs.data()):{};
        const obj=applyMerge(base,sp);
        const enc=await encodeDoc(self.path,obj,sp.unions);
        t.set(self._raw,enc,{merge:true});
        plainCache.set(self.path,obj);
      });
    }
    onSnapshot(cb,err){
      let chain=Promise.resolve(),live=true;
      const unsub=this._raw.onSnapshot(rs=>{
        chain=chain.then(async()=>{const s=await wrapDocSnap(this,rs);if(live)cb(s);}).catch(e=>{console.warn('vault: doc snapshot',e);if(err)err(e);});
      },e=>{if(err)err(e);});
      return ()=>{live=false;unsub();};
    }
  }

  const isDocIdPath=f=>f&&typeof f==='object'&&typeof f.isEqual==='function'&&f.isEqual(firebase.firestore.FieldPath.documentId());
  function cmpOp(a,op,b){
    switch(op){
      case '==':return a===b;case '!=':return a!==b;
      case '<':return a<b;case '<=':return a<=b;case '>':return a>b;case '>=':return a>=b;
      case 'in':return Array.isArray(b)&&b.includes(a);
      case 'not-in':return Array.isArray(b)&&!b.includes(a);
      case 'array-contains':return Array.isArray(a)&&a.includes(b);
      case 'array-contains-any':return Array.isArray(a)&&Array.isArray(b)&&b.some(x=>a.includes(x));
    }
    return false;
  }

  class Query{
    constructor(col,rawQ,st){this._col=col;this._rq=rawQ;this._st=st||{filters:[],sorts:[],limit:null,serverOrder:true};}
    _next(rq,patch){return new Query(this._col,rq,{...this._st,...patch});}
    where(f,op,v){
      if(isDocIdPath(f)||PLAIN.has(f)) return this._next(this._rq.where(f,op,v),{});
      return this._next(this._rq,{filters:[...this._st.filters,{f,op,v}]});
    }
    orderBy(f,dir){
      const sorts=[...this._st.sorts,{f,dir:dir==='desc'?-1:1}];
      if(PLAIN.has(f)&&this._st.serverOrder) return this._next(this._rq.orderBy(f,dir||'asc'),{sorts});
      return this._next(this._rq,{sorts,serverOrder:false});
    }
    limit(n){
      if(!this._st.filters.length&&this._st.serverOrder) return this._next(this._rq.limit(n),{limit:n});
      return this._next(this._rq,{limit:n});
    }
    async _wrap(rqs){
      const docs=await Promise.all(rqs.docs.map(async d=>{
        const ref=new DocRef(this._col,d.ref);
        const data=await decodeDoc(ref.path,d.data());
        plainCache.set(ref.path,data);
        return new DocSnap(ref,true,data,d.metadata);
      }));
      let out=docs.filter(ds=>this._st.filters.every(({f,op,v})=>cmpOp(ds._d[f],op,v)));
      if(this._st.sorts.length){
        const s=this._st.sorts;
        out.sort((a,b)=>{for(const {f,dir} of s){const x=a._d[f],y=b._d[f];if(x<y)return -dir;if(x>y)return dir;}return 0;});
      }
      if(this._st.limit!=null) out=out.slice(0,this._st.limit);
      return new QuerySnap(out,rqs.metadata);
    }
    async get(opts){return this._wrap(await this._rq.get(opts));}
    onSnapshot(cb,err){
      let chain=Promise.resolve(),live=true;
      const unsub=this._rq.onSnapshot(rqs=>{
        chain=chain.then(async()=>{const s=await this._wrap(rqs);if(live)cb(s);}).catch(e=>{console.warn('vault: query snapshot',e);if(err)err(e);});
      },e=>{if(err)err(e);});
      return ()=>{live=false;unsub();};
    }
  }
  class ColRef extends Query{
    constructor(name){super(name,raw.collection('users').doc(uid).collection(name));this._name=name;}
    doc(id){const rc=raw.collection('users').doc(uid).collection(this._name);return new DocRef(this._name,id==null?rc.doc():rc.doc(String(id)));}
    async add(data){const r=this.doc();await r.set(data);return r;}
  }

  class Batch{
    constructor(){this._ops=[];}
    set(ref,data,opts){this._ops.push({k:'set',ref,data,opts});return this;}
    update(ref,data){this._ops.push({k:'set',ref,data,opts:{merge:true}});return this;}
    delete(ref){this._ops.push({k:'del',ref});return this;}
    async commit(){
      const rb=raw.batch();
      for(const op of this._ops){
        if(op.k==='del'){plainCache.delete(op.ref.path);rb.delete(op.ref._raw);continue;}
        const sp=splitPayload(op.data||{});
        if(Object.keys(sp.incs).length) throw new Error('vault: increment inside a batch is not supported');
        const merge=!!(op.opts&&op.opts.merge);
        const obj=applyMerge(merge?await op.ref._base():{},sp);
        plainCache.set(op.ref.path,obj);
        const enc=await encodeDoc(op.ref.path,obj,sp.unions);
        if(merge) rb.set(op.ref._raw,enc,{merge:true});else rb.set(op.ref._raw,enc);
      }
      return rb.commit();
    }
  }

  const udb={
    collection:name=>new ColRef(name),
    batch:()=>new Batch(),
    enablePersistence:()=>Promise.resolve(),
    async runTransaction(fn){
      return raw.runTransaction(async rt=>{
        const pending=[];const seen=new Map();
        const t={
          async get(ref){const rs=await rt.get(ref._raw);const s=await (async()=>{if(!rs.exists)return new DocSnap(ref,false,undefined,rs.metadata);const d=await decodeDoc(ref.path,rs.data());return new DocSnap(ref,true,d,rs.metadata);})();seen.set(ref.path,s._d);return s;},
          set(ref,data,opts){pending.push({ref,data,opts});return t;},
          update(ref,data){pending.push({ref,data,opts:{merge:true}});return t;},
          delete(ref){pending.push({ref,del:true});return t;},
        };
        const result=await fn(t);
        for(const p of pending){
          if(p.del){rt.delete(p.ref._raw);plainCache.delete(p.ref.path);continue;}
          const sp=splitPayload(p.data||{});
          const merge=!!(p.opts&&p.opts.merge);
          const base=merge?(seen.has(p.ref.path)?seen.get(p.ref.path):await p.ref._base()):{};
          const obj=applyMerge(base,sp);
          rt.set(p.ref._raw,await encodeDoc(p.ref.path,obj,sp.unions),merge?{merge:true}:undefined);
          plainCache.set(p.ref.path,obj);
        }
        return result;
      });
    },
  };

  // ── account flows ───────────────────────────────────────────────────────
  function _auth(){return firebase.auth();}
  const metaRef=()=>raw.collection('users').doc(uid).collection('meta').doc('keys');

  async function _createKeys(forUid,salt,pk,username){
    uid=forUid;
    const dekRaw=rand(32);
    const code=newRecoveryCode();
    const rk=await recoveryKeys(code,salt);
    const dekKey=await aesKey(dekRaw);
    const meta={
      v:1,kind:username?'user':'google',username:username||null,salt,iter:PBKDF2_ITER,
      wrapPass:await seal(pk.kek,dekRaw,'dek|'+forUid),
      wrapRec:await seal(rk.kek,dekRaw,'dek-rec|'+forUid),
      // lets a signed-in device refresh the recovery doc after a password
      // change without asking for the code again
      recSealed:await seal(dekKey,te.encode(JSON.stringify({docId:rk.docId,authRaw:b64(rk.authRaw)})),'rec|'+forUid),
      createdAt:firebase.firestore.FieldValue.serverTimestamp(),
    };
    if(username){
      await raw.collection('recovery').doc(rk.docId).set({
        uid:forUid,v:1,
        authEnc:await seal(rk.authKey,te.encode(pk.authSecret),'rec-auth|'+rk.docId),
      });
    }
    await metaRef().set(meta);
    await _installDek(dekRaw,forUid);
    return code;
  }
  async function _updateRecoveryAuth(meta,newAuthSecret){
    if(!meta.recSealed) return;
    const r=JSON.parse(td.decode(await open(dek,meta.recSealed,'rec|'+uid)));
    const authKey=await aesKey(unb64(r.authRaw));
    await raw.collection('recovery').doc(r.docId).set({
      uid,v:1,authEnc:await seal(authKey,te.encode(newAuthSecret),'rec-auth|'+r.docId),
    });
  }
  function _authErr(e){
    const c=e&&e.code||'';
    if(c==='auth/email-already-in-use') return 'That username is taken. Try another.';
    if(c==='auth/invalid-credential'||c==='auth/wrong-password'||c==='auth/user-not-found'||c==='auth/invalid-login-credentials') return 'Wrong username or password.';
    if(c==='auth/too-many-requests') return 'Too many attempts. Wait a few minutes and try again.';
    if(c==='auth/network-request-failed') return "You're offline. Connect to the internet to sign in.";
    if(c==='auth/popup-closed-by-user'||c==='auth/cancelled-popup-request') return 'Sign-in was cancelled.';
    return (e&&e.message)||'Something went wrong. Try again.';
  }
  class VaultError extends Error{}
  const fail=m=>{throw new VaultError(m);};

  async function signUp(username,password){
    const u=normUser(username);
    if(!validUser(u)) fail('Usernames are 3–24 characters: letters, numbers, dots, dashes or underscores.');
    if(String(password).length<10) fail('Use at least 10 characters for your password.');
    const salt=userSalt(u);
    const pk=await passwordKeys(password,salt);
    let cred;
    try{cred=await _auth().createUserWithEmailAndPassword(userEmail(u),pk.authSecret);}
    catch(e){fail(_authErr(e));}
    return _createKeys(cred.user.uid,salt,pk,u);
  }
  // Returns {needsSetup:true, code} when the account existed but its key
  // setup never finished (e.g. the app was closed mid-sign-up).
  async function signIn(username,password){
    const u=normUser(username);
    const salt=userSalt(u);
    const pk=await passwordKeys(password,salt);
    let cred;
    try{cred=await _auth().signInWithEmailAndPassword(userEmail(u),pk.authSecret);}
    catch(e){fail(_authErr(e));}
    uid=cred.user.uid;
    const ms=await metaRef().get({source:'server'});
    if(!ms.exists) return {needsSetup:true,code:await _createKeys(uid,salt,pk,u)};
    let dekRaw;
    try{dekRaw=await open(pk.kek,ms.data().wrapPass,'dek|'+uid);}
    catch{fail('Wrong username or password.');}
    await _installDek(dekRaw,uid);
    return {needsSetup:false};
  }
  // Forgotten password: the recovery code signs in, unlocks the data key and
  // sets a new password. No email involved.
  async function recover(username,code,newPassword){
    const u=normUser(username);
    if(String(newPassword).length<10) fail('Use at least 10 characters for your new password.');
    const salt=userSalt(u);
    const rk=await recoveryKeys(code,salt);
    if(!rk) fail("That recovery code isn't valid. Check it and try again.");
    const rs=await raw.collection('recovery').doc(rk.docId).get({source:'server'});
    if(!rs.exists) fail("That username and recovery code don't match.");
    let oldAuth;
    try{oldAuth=td.decode(await open(rk.authKey,rs.data().authEnc,'rec-auth|'+rk.docId));}
    catch{fail("That username and recovery code don't match.");}
    let cred;
    try{cred=await _auth().signInWithEmailAndPassword(userEmail(u),oldAuth);}
    catch(e){fail(_authErr(e));}
    uid=cred.user.uid;
    const meta=(await metaRef().get({source:'server'})).data();
    const dekRaw=await open(rk.kek,meta.wrapRec,'dek-rec|'+uid);
    const pk=await passwordKeys(newPassword,salt);
    await cred.user.updatePassword(pk.authSecret);
    await metaRef().update({wrapPass:await seal(pk.kek,dekRaw,'dek|'+uid)});
    await _installDek(dekRaw,uid);
    await _updateRecoveryAuth(meta,pk.authSecret);
  }
  async function changePassword(oldPassword,newPassword){
    if(String(newPassword).length<10) fail('Use at least 10 characters for your new password.');
    const user=_auth().currentUser;if(!user) fail('Sign in first.');
    const meta=(await metaRef().get({source:'server'})).data();
    const salt=meta.salt;
    const oldPk=await passwordKeys(oldPassword,salt);
    let dekRaw;
    try{dekRaw=await open(oldPk.kek,meta.wrapPass,'dek|'+uid);}catch{fail('Your current password is wrong.');}
    const pk=await passwordKeys(newPassword,salt);
    if(meta.kind==='user'){
      await user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(user.email,oldPk.authSecret));
      await user.updatePassword(pk.authSecret);
      await _updateRecoveryAuth(meta,pk.authSecret);
    }
    await metaRef().update({wrapPass:await seal(pk.kek,dekRaw,'dek|'+uid)});
  }

  // Google: sign in, then the user sets/enters a separate data password
  // (Google gives the app no secret it could encrypt with).
  async function googleSignIn(){
    const p=new firebase.auth.GoogleAuthProvider();
    let cred;
    try{cred=await _auth().signInWithPopup(p);}
    catch(e){
      if(e&&(e.code==='auth/popup-blocked'||e.code==='auth/operation-not-supported-in-this-environment')){await _auth().signInWithRedirect(p);return {redirecting:true};}
      fail(_authErr(e));
    }
    uid=cred.user.uid;
    const ms=await metaRef().get({source:'server'});
    return {hasKeys:ms.exists};
  }
  async function googleSetPassword(password){
    if(String(password).length<10) fail('Use at least 10 characters for your data password.');
    const salt=googleSalt(uid);
    return _createKeys(uid,salt,await passwordKeys(password,salt),null);
  }
  async function googleUnlock(password){
    const ms=await metaRef().get({source:'server'});
    const pk=await passwordKeys(password,ms.data().salt);
    let dekRaw;
    try{dekRaw=await open(pk.kek,ms.data().wrapPass,'dek|'+uid);}catch{fail('Wrong data password.');}
    await _installDek(dekRaw,uid);
  }
  async function googleRecover(code,newPassword){
    if(String(newPassword).length<10) fail('Use at least 10 characters for your new password.');
    const meta=(await metaRef().get({source:'server'})).data();
    const rk=await recoveryKeys(code,meta.salt);
    if(!rk) fail("That recovery code isn't valid.");
    let dekRaw;
    try{dekRaw=await open(rk.kek,meta.wrapRec,'dek-rec|'+uid);}catch{fail("That recovery code doesn't match this account.");}
    const pk=await passwordKeys(newPassword,meta.salt);
    await metaRef().update({wrapPass:await seal(pk.kek,dekRaw,'dek|'+uid)});
    await _installDek(dekRaw,uid);
  }

  async function signOut(){
    plainCache.clear();dek=null;uid=null;
    try{await idbClear();}catch(e){console.warn('vault: key clear failed',e);}
    try{await _auth().signOut();}catch(e){console.warn('vault: sign-out failed',e);}
  }

  return {
    // setup
    attach(fsRaw){raw=fsRaw;},
    get raw(){return raw;},
    get uid(){return uid;},
    get unlocked(){return !!(dek&&uid);},
    get username(){const u=firebase.auth().currentUser;return u&&u.email&&u.email.endsWith('@'+SYNTH_DOMAIN)?u.email.split('@')[0]:(u&&(u.email||u.displayName))||'';},
    restoreDevice,
    // accounts
    signUp,signIn,recover,changePassword,signOut,
    googleSignIn,googleSetPassword,googleUnlock,googleRecover,
    VaultError,normUser,validUser,
    // data
    udb,FV,
    // test hooks
    _t:{seal,open,passwordKeys,recoveryKeys,newRecoveryCode,codeBytes,encodeDoc,decodeDoc,splitPayload,applyMerge,cmpOp,
        _setKey:async(u,rawDek)=>{uid=u;dek=await aesKey(rawDek);}},
  };
})();
const FV=VAULT.FV;
