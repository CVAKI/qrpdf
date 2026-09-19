/* =========================================================
   core.js — build stamp, tabs, byte helpers, container format
   (moved verbatim from the working single-file version)
   ========================================================= */

/* BUILD STAMP — bump this on every edit. If the number shown
   in the header / diagnostics panel is not the latest one,
   the browser is serving a CACHED copy. */
const BUILD = 'v1.1 · files';
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
function fmtKB(b){
  if(b < 1024) return b+' B';
  if(b < 1024*1024) return (b/1024).toFixed(1)+' KB';
  return (b/1024/1024).toFixed(2)+' MB';
}
function fmtDur(s){
  s = Math.round(s);
  if(s < 90) return s+'s';
  if(s < 5400) return Math.round(s/60)+' min';
  return (s/3600).toFixed(1)+' h';
}
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

/* ================= file types ================= */
/* The container stores only name + bytes, so the receiver has to work out the
   MIME type itself. Extension first, then magic bytes, then a generic fallback.
   (A wrong type is what makes phones rename / mis-open downloads.) */
const MIME_BY_EXT = {
  pdf:'application/pdf',
  jpg:'image/jpeg', jpeg:'image/jpeg', jpe:'image/jpeg', jfif:'image/jpeg',
  png:'image/png', gif:'image/gif', webp:'image/webp', bmp:'image/bmp',
  svg:'image/svg+xml', avif:'image/avif', heic:'image/heic', heif:'image/heif',
  tif:'image/tiff', tiff:'image/tiff', ico:'image/x-icon',
  zip:'application/zip', '7z':'application/x-7z-compressed', rar:'application/vnd.rar',
  gz:'application/gzip', tar:'application/x-tar',
  txt:'text/plain', csv:'text/csv', json:'application/json', md:'text/markdown', html:'text/html',
  docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  apk:'application/vnd.android.package-archive',
  mp3:'audio/mpeg', wav:'audio/wav', mp4:'video/mp4'
};
/* types every browser can draw in an <img> — used for the preview on the receiving side */
const PREVIEW_MIMES = ['image/jpeg','image/png','image/gif','image/webp','image/bmp','image/svg+xml','image/avif'];

function extOf(name){
  const m = /\.([A-Za-z0-9]+)$/.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}
function sniffType(b){
  if(!b || b.length < 4) return null;
  if(b[0]===0x25 && b[1]===0x50 && b[2]===0x44 && b[3]===0x46) return { mime:'application/pdf', ext:'pdf' };
  if(b[0]===0x89 && b[1]===0x50 && b[2]===0x4E && b[3]===0x47) return { mime:'image/png',  ext:'png' };
  if(b[0]===0xFF && b[1]===0xD8 && b[2]===0xFF)                return { mime:'image/jpeg', ext:'jpg' };
  if(b[0]===0x47 && b[1]===0x49 && b[2]===0x46 && b[3]===0x38) return { mime:'image/gif',  ext:'gif' };
  if(b[0]===0x50 && b[1]===0x4B && (b[2]===0x03 || b[2]===0x05)) return { mime:'application/zip', ext:'zip' };
  if(b.length > 11 && b[0]===0x52 && b[1]===0x49 && b[2]===0x46 && b[3]===0x46
     && b[8]===0x57 && b[9]===0x45 && b[10]===0x42 && b[11]===0x50) return { mime:'image/webp', ext:'webp' };
  return null;
}
function guessMime(name, bytes){
  const byExt = MIME_BY_EXT[extOf(name)];
  if(byExt) return byExt;
  const s = sniffType(bytes);
  return s ? s.mime : 'application/octet-stream';
}
function isPreviewable(mime){ return PREVIEW_MIMES.indexOf(mime) !== -1; }
/* only used for old-format sequences that carried no file name */
function recoveredName(bytes){
  const s = sniffType(bytes);
  return 'recovered.' + (s ? s.ext : 'pdf');
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
