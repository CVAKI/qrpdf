/* =========================================================
   encode.js — PDF(s) -> compressed -> QR chunk payloads + grid
   (moved verbatim from the working single-file version)
   ========================================================= */

const genForm      = document.getElementById('genForm');
const genStatus    = document.getElementById('genStatus');
const resultCard   = document.getElementById('resultCard');
const resultSub    = document.getElementById('resultSub');
const qrGrid       = document.getElementById('qrGrid');
const fileListEl   = document.getElementById('fileList');
const chunkInput   = document.getElementById('chunkSize');
const autoChunkBox = document.getElementById('autoChunk');
const compressSel  = document.getElementById('compress');
const densitySel   = document.getElementById('density');
const estimateEl   = document.getElementById('estimate');
const genBtn       = document.getElementById('genBtn');

/* ECC is fixed in production rather than user-facing: M gives real error-correction
   headroom for a moving-camera scan without eating into the low-density byte budget
   the way L would force higher density to compensate, or H would waste capacity. */
const FIXED_ECC = 'M';

let pendingFiles = [];
let qrPayloads   = [];
let currentEcc   = FIXED_ECC;

document.getElementById('pdfInput').addEventListener('change', async (e)=>{
  const files = Array.from(e.target.files||[]);
  for(const f of files){
    const buf = await f.arrayBuffer();
    pendingFiles.push({ name: f.name.replace(/\|/g,'_'), bytes: new Uint8Array(buf) });
  }
  e.target.value = '';
  renderFileList();
  refreshEstimate();
});

document.getElementById('clearBtn').addEventListener('click', ()=>{
  pendingFiles = []; qrPayloads = [];
  qrGrid.innerHTML = '';
  resultCard.style.display='none';
  genStatus.innerHTML='';
  renderFileList(); refreshEstimate();
});

function renderFileList(){
  if(!pendingFiles.length){
    fileListEl.innerHTML = '<div class="empty">No files added yet.</div>';
    genBtn.disabled = true;
    return;
  }
  genBtn.disabled = false;
  fileListEl.innerHTML = '';
  pendingFiles.forEach((f,i)=>{
    const row = document.createElement('div');
    row.className = 'filerow';
    const nm = document.createElement('div');
    nm.className = 'nm'; nm.textContent = (i+1)+'. '+f.name;
    const sz = document.createElement('div');
    sz.className = 'sz'; sz.textContent = fmtKB(f.bytes.length);
    const rm = document.createElement('button');
    rm.type='button'; rm.className='secondary tiny'; rm.textContent='remove';
    rm.addEventListener('click', ()=>{ pendingFiles.splice(i,1); renderFileList(); refreshEstimate(); });
    row.appendChild(nm); row.appendChild(sz); row.appendChild(rm);
    fileListEl.appendChild(row);
  });
}

const ECC_CAP = { L:2900, M:2300, Q:1600, H:1250 };

/* Density is now capped hard. A QR carrying ~200–600 bytes stays at a low
   version number (big modules), which is what makes it lock on instantly at
   speed. File size no longer pushes the density up — it only adds more codes. */
const HARD_MIN = 150, HARD_MAX = 600;

function suggestChunk(b64len, ecc){
  const cap = Math.min(ECC_CAP[ecc] || 2900, HARD_MAX);
  let want = parseInt(densitySel.value, 10) || 400;
  // very small payloads: go sparser still, it costs almost nothing
  if(b64len <= 2500) want = Math.min(want, 250);
  return Math.max(HARD_MIN, Math.min(want, cap));
}

let packCache = null;
function packKey(){
  return pendingFiles.map(f=>f.name+':'+f.bytes.length).join('~') + '#' + compressSel.value;
}
function packedSize(){
  if(!pendingFiles.length) return null;
  const key = packKey();
  if(packCache && packCache.key === key) return packCache;
  const container = buildContainer(pendingFiles);
  const level = parseInt(compressSel.value,10);
  let payload = container, gzipped = false;
  if(level > 0){
    const gz = pako.gzip(container, { level });
    /* JPG / PNG / ZIP / DOCX are already compressed: gzip can't shrink them and only
       adds overhead. Keep the gzip result only when it actually wins; the receiver
       detects both forms by itself. */
    if(gz.length < container.length){ payload = gz; gzipped = true; }
  }
  packCache = { key, payload, raw: container.length, gzipped };
  return packCache;
}

function refreshEstimate(){
  if(!pendingFiles.length){ estimateEl.textContent = 'Add a file to see the estimate.'; return; }
  const { payload, raw, gzipped } = packedSize();
  const b64len = Math.ceil(payload.length/3)*4;
  const ecc = FIXED_ECC;
  if(autoChunkBox.checked) chunkInput.value = suggestChunk(b64len, ecc);
  const cap = Math.min(ECC_CAP[ecc], 2860) - 40;
  let chunk = parseInt(chunkInput.value,10) || 400;
  if(chunk > cap){ chunk = cap; if(autoChunkBox.checked) chunkInput.value = chunk; }
  const total = Math.ceil(b64len / chunk);

  const saved = raw ? Math.round(100 - (payload.length/raw)*100) : 0;
  const secs = total * 400 / 1000;
  let html = '<b>'+pendingFiles.length+'</b> file(s) · <b>'+fmtKB(raw)+'</b> raw'
    + (gzipped ? ' → <b>'+fmtKB(payload.length)+'</b> packed ('+saved+'% smaller)' : '')
    + ' · <b>'+total+'</b> QR code(s) at '+chunk+' bytes each'
    + '<br><span style="color:var(--ink-soft)">One full pass ≈ '+fmtDur(secs)+' at 400ms/frame, ≈ '+fmtDur(total*0.1)+' on turbo.</span>';
  if(chunk > 600) html += '<br><span style="color:var(--amber)">Above 600 bytes the pattern gets dense and a moving camera may miss codes. 200–600 scans fastest.</span>';
  if(parseInt(compressSel.value,10) > 0 && !gzipped)
    html += '<br><span style="color:var(--ink-soft)">Already-compressed data (photos, PNGs, ZIPs) — sent as-is, gzip can\'t shrink it.</span>';
  if(total > 600){
    const hasImg = pendingFiles.some(f=>/^image\//.test(guessMime(f.name, f.bytes)));
    html += '<br><span style="color:var(--amber)">'+total+' codes is a long transfer'
      + (hasImg ? ' — phone photos are big, so resize or compress the image first' : '')
      + '. Raise the density a step or send fewer files per batch.</span>';
  }
  estimateEl.innerHTML = html;
}

chunkInput.addEventListener('input', ()=>{ autoChunkBox.checked = false; refreshEstimate(); });
autoChunkBox.addEventListener('change', refreshEstimate);
compressSel.addEventListener('change', refreshEstimate);
densitySel.addEventListener('change', ()=>{ autoChunkBox.checked = true; refreshEstimate(); });

genForm.addEventListener('submit', (e)=>{
  e.preventDefault();
  if(!pendingFiles.length) return;
  genStatus.innerHTML = '<div class="status info">Packing…</div>';
  qrGrid.innerHTML = '';
  resultCard.style.display = 'none';

  setTimeout(()=>{
    try{
      const { payload, raw } = packedSize();
      const b64 = bytesToBase64(payload);
      const ecc = FIXED_ECC;
      currentEcc = ecc;
      const cap = Math.min(ECC_CAP[ecc], 2860) - 40;
      let chunk = Math.min(parseInt(chunkInput.value,10) || 400, cap);
      const id = genId();
      const total = Math.ceil(b64.length / chunk);

      qrPayloads = [];
      for(let i=0;i<total;i++){
        qrPayloads.push(['Q2', id, total, i, b64.slice(i*chunk, (i+1)*chunk)].join('|'));
      }

      renderGridLazy(id, total);
      const names = pendingFiles.map(f=>f.name).join(', ');
      resultSub.textContent = names+' — '+total+' code(s), sequence ID '+id
        +'. Play them on this screen and scan with the other device.';
      resultCard.style.display = 'block';
      genStatus.innerHTML = '<div class="status ok">Packed '+fmtKB(raw)+' → '+fmtKB(payload.length)
        +' → '+total+' QR code(s). Hit “Play sequence” for the fastest transfer.</div>';
    }catch(err){
      genStatus.innerHTML = '<div class="status err">Could not build the sequence: '+err.message+'</div>';
    }
  }, 30);
});

let gridObserver = null;
function renderGridLazy(id, total){
  if(gridObserver) gridObserver.disconnect();
  qrGrid.innerHTML = '';
  const cells = [];
  for(let i=0;i<total;i++){
    const cell = document.createElement('div');
    cell.className = 'qr-cell';
    cell.dataset.idx = i;
    cell.innerHTML = '<div class="ph">'+(i+1)+'</div><div class="idx">'+(i+1)+' / '+total+'   ['+id+']</div>';
    qrGrid.appendChild(cell);
    cells.push(cell);
  }
  if('IntersectionObserver' in window){
    gridObserver = new IntersectionObserver((entries)=>{
      entries.forEach(en=>{ if(en.isIntersecting){ drawCell(en.target); gridObserver.unobserve(en.target); } });
    }, { rootMargin:'300px' });
    cells.forEach(c=>gridObserver.observe(c));
  } else {
    cells.forEach(drawCell);
  }
}
function drawCell(cell){
  if(cell.dataset.drawn) return;
  cell.dataset.drawn = '1';
  const i = parseInt(cell.dataset.idx,10);
  const ph = cell.querySelector('.ph');
  const holder = document.createElement('div');
  if(ph) cell.replaceChild(holder, ph);
  else cell.insertBefore(holder, cell.firstChild);
  new QRCode(holder, { text:qrPayloads[i], width:180, height:180, correctLevel:eccConst(currentEcc) });
}
document.getElementById('renderAllBtn').addEventListener('click', ()=>{
  qrGrid.querySelectorAll('.qr-cell').forEach(drawCell);
});
document.getElementById('printBtn').addEventListener('click', ()=>{
  qrGrid.querySelectorAll('.qr-cell').forEach(drawCell);
  setTimeout(()=>window.print(), 300);
});
document.getElementById('dlAllBtn').addEventListener('click', ()=>{
  qrGrid.querySelectorAll('.qr-cell').forEach(drawCell);
  setTimeout(()=>{
    const nodes = qrGrid.querySelectorAll('canvas, .qr-cell img');
    let i = 0;
    const step = ()=>{
      if(i >= nodes.length) return;
      const node = nodes[i];
      const url = node.tagName === 'CANVAS' ? node.toDataURL('image/png') : node.src;
      const a = document.createElement('a');
      a.href = url; a.download = 'qr_'+String(i+1).padStart(3,'0')+'.png';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      i++;
      setTimeout(step, 120);
    };
    step();
  }, 400);
});
