/* =========================================================
   core.js — build stamp, tabs, byte helpers, container format
   (moved verbatim from the working single-file version)
   ========================================================= */

/* BUILD STAMP — bump this on every edit. If the number shown
   in the header / diagnostics panel is not the latest one,
   the browser is serving a CACHED copy. */
const BUILD = 'v1.0 · prod';
document.getElementById('buildTag').textContent = 'build ' + BUILD;

/* ================= tabs ================= */
document.querySelectorAll('.tab').forEach(t=>{
  t.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById('panel-'+t.dataset.tab).classList.add('active');
    if(t.dataset.tab === 'encode') stopCamera();
    else fixViewportHeight();
  });
});

/* ================= helpers ================= */
const MAGIC = 'PQPDF2';
function genId(){ return Math.random().toString(36).slice(2,8).toUpperCase(); }
function fmtKB(b){ return b < 1024 ? b+' B' : (b/1024).toFixed(1)+' KB'; }
function eccConst(v){
  return {L:QRCode.CorrectLevel.L, M:QRCode.CorrectLevel.M, Q:QRCode.CorrectLevel.Q, H:QRCode.CorrectLevel.H}[v] || QRCode.CorrectLevel.L;
}
function bytesToBase64(bytes){
  let binary = '';
  const chunk = 0x8000;
  for(let i=0;i<bytes.length;i+=chunk){
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i+chunk));
  }
  return btoa(binary);
}
function base64ToBytes(b64){
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* ================= container format ================= */
function buildContainer(files){
  const enc = new TextEncoder();
  const manifest = JSON.stringify({ f: files.map(f=>({ n:f.name, s:f.bytes.length })) });
  const head = enc.encode(MAGIC+'\n'+manifest+'\n');
  const total = head.length + files.reduce((a,f)=>a+f.bytes.length,0);
  const out = new Uint8Array(total);
  out.set(head, 0);
  let off = head.length;
  for(const f of files){ out.set(f.bytes, off); off += f.bytes.length; }
  return out;
}
function parseContainer(bytes){
  const dec = new TextDecoder();
  const nl1 = bytes.indexOf(10);
  if(nl1 < 0 || dec.decode(bytes.subarray(0, nl1)) !== MAGIC) return null;
  const nl2 = bytes.indexOf(10, nl1+1);
  if(nl2 < 0) return null;
  const manifest = JSON.parse(dec.decode(bytes.subarray(nl1+1, nl2)));
  let off = nl2+1;
  return manifest.f.map(m=>{
    const b = bytes.subarray(off, off+m.s);
    off += m.s;
    return { name:m.n, bytes:b };
  });
}
