/* =========================================================
   decode.js — camera, jsQR scan loop, chunk collection, rebuild
   (moved verbatim from the working single-file version)
   ========================================================= */

const video        = document.getElementById('video');
const scanCanvas   = document.getElementById('scanCanvas');
const scanCtx      = scanCanvas.getContext('2d', { willReadFrequently:true });
const overlayEl    = document.getElementById('overlay');
const overlayCtx   = overlayEl.getContext('2d');
const vpIdle       = document.getElementById('vpIdle');
const vpHud        = document.getElementById('vpHud');
const vpTools      = document.getElementById('vpTools');
const scanStatus   = document.getElementById('scanStatus');
const chunkGrid    = document.getElementById('chunkGrid');
const progressBar  = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
const progressLabel= document.getElementById('progressLabel');
const downloadArea = document.getElementById('downloadArea');
const resetRow     = document.getElementById('resetRow');
const startCamBtn  = document.getElementById('startCamBtn');
const stopCamBtn   = document.getElementById('stopCamBtn');

let stream = null, rafId = null;
let session = null;

function setStatus(msg, kind){
  scanStatus.innerHTML = '<div class="status '+(kind||'info')+'">'+msg+'</div>';
}
document.getElementById('resetSessionBtn').addEventListener('click', ()=>{
  log('Session manually reset by user.');
  session = null; downloadArea.innerHTML=''; chunkGrid.innerHTML='';
  progressBar.style.display='none'; progressLabel.style.display='none';
  resetRow.style.display='none'; setStatus('Session cleared — ready for a new sequence.','info');
});

function ensureSession(id, total, legacyName){
  if(!session || session.id !== id){
    log('New sequence detected: ' + id + ' (' + total + ' codes expected).');
    session = { id, total, chunks:new Map(), legacyName: legacyName||null, done:false };
    downloadArea.innerHTML = '';
  }
  if(legacyName) session.legacyName = legacyName;
  resetRow.style.display = 'flex';
}

function renderChunkGrid(){
  if(!session){ chunkGrid.innerHTML=''; progressBar.style.display='none'; progressLabel.style.display='none'; return; }
  progressBar.style.display = 'block';
  progressLabel.style.display = 'block';
  if(chunkGrid.childElementCount !== session.total){
    chunkGrid.innerHTML = '';
    for(let i=0;i<session.total;i++){
      const d = document.createElement('div');
      d.className = 'chunk-dot'; d.textContent = i+1;
      chunkGrid.appendChild(d);
    }
  }
  for(let i=0;i<session.total;i++){
    if(session.chunks.has(i)) chunkGrid.children[i].classList.add('got');
  }
  const pct = Math.round(100 * session.chunks.size / session.total);
  progressFill.style.width = pct+'%';
  const missing = session.total - session.chunks.size;
  progressLabel.textContent = pct+'% — '+session.chunks.size+' / '+session.total+' codes'
    + (missing && missing <= 12 ? '  · still missing: '+missingList().join(', ') : '');
  if(session.chunks.size === session.total && !session.done){
    session.done = true;
    completeSession();
  }
}
function missingList(){
  const out = [];
  for(let i=0;i<session.total;i++) if(!session.chunks.has(i)) out.push(i+1);
  return out;
}

function handleDecodedText(text){
  const parts = text.split('|');
  if(parts.length < 5) return false;
  let id, total, idx, data, legacyName = null;
  if(parts[0] === 'Q2'){
    id = parts[1]; total = parseInt(parts[2],10); idx = parseInt(parts[3],10);
    data = parts.slice(4).join('|');
  } else {
    id = parts[0]; total = parseInt(parts[1],10); idx = parseInt(parts[2],10);
    legacyName = parts[3] || null; data = parts.slice(4).join('|');
  }
  if(isNaN(total) || isNaN(idx)) return false;

  ensureSession(id, total, legacyName);
  if(session.id !== id){
    log('Ignored code from different sequence: ' + id + ' (collecting ' + session.id + ').');
    setStatus('That code belongs to a different sequence ('+id+') — ignored.', 'warn');
    return false;
  }
  if(!session.chunks.has(idx)){
    session.chunks.set(idx, data);
    setStatus('Captured '+(idx+1)+' of '+total+'.', 'ok');
    renderChunkGrid();
  }
  return true;
}

function completeSession(){
  log('All ' + session.total + ' chunks captured for sequence ' + session.id + ' — reassembling.');
  stopCamera();
  let full = '';
  for(let i=0;i<session.total;i++) full += session.chunks.get(i);
  try{
    let bytes = base64ToBytes(full);
    if(bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = pako.ungzip(bytes);
    let files = parseContainer(bytes);
    if(!files) files = [{ name: session.legacyName || 'recovered.pdf', bytes }];
    downloadArea.innerHTML = '';
    files.forEach(f=>{
      const blob = new Blob([f.bytes], { type:'application/pdf' });
      const a = document.createElement('a');
      a.className = 'download-link';
      a.href = URL.createObjectURL(blob);
      a.download = f.name || 'recovered.pdf';
      a.textContent = '↓ '+(f.name||'recovered.pdf')+'  ('+fmtKB(f.bytes.length)+')';
      downloadArea.appendChild(a);
    });
    log('Reassembled ' + files.length + ' file(s) successfully.');
    setStatus('All '+session.total+' codes received — '+files.length+' file(s) rebuilt.', 'ok');
  }catch(err){
    session.done = false;
    log('Reassembly FAILED: ' + err.message);
    setStatus('Reassembly failed ('+err.message+') — one code was probably misread. Reset the session and rescan.', 'err');
  }
}

/* ---------------- camera ---------------- */
startCamBtn.addEventListener('click', ()=>{ startCamera().catch(e=>{
  log('UNEXPECTED top-level failure: ' + e.name + ' — ' + e.message);
  setStatus('Unexpected failure starting the camera: '+e.name+' — '+e.message, 'err');
  releaseStream(); startCamBtn.disabled = false; stopCamBtn.disabled = true;
}); });
stopCamBtn.addEventListener('click', stopCamera);
document.getElementById('recheckBtn').addEventListener('click', ()=>{ fixViewportHeight(); runDiagnostics(); });

function releaseStream(){
  if(stream){ try{ stream.getTracks().forEach(t=>t.stop()); }catch(e){} stream = null; }
  try{ video.srcObject = null; }catch(e){}
}

function withTimeout(promise, ms, label){
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_,rej)=>setTimeout(()=>rej(new Error(label+' timed out after '+ms+'ms')), ms))
  ]);
}

async function startCamera(){
  log('Start camera pressed.');
  if(typeof jsQR !== 'function'){
    log('ABORT: jsQR not loaded.');
    setStatus('The QR-scanning library failed to load (jsQR missing) — usually a network/CDN issue. Reload the page.', 'warn');
    return;
  }
  if(!window.isSecureContext){
    log('ABORT: not a secure context (' + location.protocol + ').');
    setStatus('Camera blocked: this page is not on https:// or localhost. Host the file, or use “Upload QR image files” below.', 'warn');
    return;
  }
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    log('ABORT: no getUserMedia API in this browser.');
    setStatus('This browser exposes no camera API. Try Chrome, Safari or Firefox, or upload QR images.', 'warn');
    return;
  }

  startCamBtn.disabled = true;
  setStatus('Requesting camera…', 'info');
  log('Calling getUserMedia (facingMode: ideal environment)…');
  fixViewportHeight();

  /* --- 1. acquire the stream (back camera only, never {exact:…}) --- */
  let s = null;
  try{
    try{
      s = await navigator.mediaDevices.getUserMedia({
        video:{ facingMode:{ ideal:'environment' }, width:{ ideal:1920 }, height:{ ideal:1080 } }
      });
      log('getUserMedia resolved on first attempt.');
    }catch(inner){
      log('First getUserMedia attempt failed: ' + inner.name + ' — ' + inner.message);
      if(['OverconstrainedError','ConstraintNotSatisfiedError','NotFoundError','TypeError','NotReadableError'].indexOf(inner.name) !== -1){
        log('Retrying with bare {video:true}…');
        s = await navigator.mediaDevices.getUserMedia({ video:true });
        log('Bare retry resolved.');
      } else throw inner;
    }
  }catch(err){
    log('getUserMedia FAILED: ' + err.name + ' — ' + err.message);
    startCamBtn.disabled = false;
    if(err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'){
      let inIframe = false; try{ inIframe = window.self !== window.top; }catch(e){ inIframe = true; }
      log('Permission denied. inIframe=' + inIframe);
      setStatus(inIframe
        ? 'Camera blocked — this page is inside an embedded preview (iframe). Iframes block the camera no matter what your browser permission says. Open the page in its own tab.'
        : 'Permission reported as denied. Reload the page, press Start camera and accept the prompt. If your browser says it is allowed, check the OS-level camera permission for the browser app itself.', 'warn');
    } else if(err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError'){
      setStatus('No camera reported. If this phone obviously has one, the OS is blocking the browser app: Android → Settings → Apps → [browser] → Permissions → Camera → Allow; iPhone → Settings → [browser] → Camera → Allow. Then fully close and reopen the browser.', 'warn');
    } else if(err.name === 'NotReadableError'){
      setStatus('The camera is already in use by another app or tab. Close it and try again.', 'warn');
    } else {
      setStatus('Could not access the camera ('+err.name+': '+err.message+'). You can upload QR images instead.', 'warn');
    }
    runDiagnostics();
    return;
  }

  stream = s;
  log('Stream acquired. Tracks: ' + stream.getVideoTracks().map(t=>t.label||'(unlabeled)').join(', '));

  /* --- 2. attach to the <video>. Hide the placeholder as soon as ANY
           readiness signal fires, independent of play() resolving. --- */
  const reveal = ()=>{ log('Video readiness event fired — revealing preview.'); video.style.display = 'block'; vpIdle.style.display = 'none'; fixViewportHeight(); };
  video.addEventListener('loadedmetadata', reveal, { once:true });
  video.addEventListener('loadeddata',     reveal, { once:true });
  video.addEventListener('playing',        reveal, { once:true });

  try{
    video.setAttribute('playsinline','');
    video.setAttribute('webkit-playsinline','');
    video.muted = true;
    video.srcObject = stream;
    log('Assigned stream to video.srcObject.');
  }catch(e){
    log('srcObject assignment failed (' + e.message + '), falling back to createObjectURL.');
    try{ video.src = URL.createObjectURL(stream); }catch(e2){ log('createObjectURL fallback also failed: ' + e2.message); }
  }

  /* --- 3. play() inside try/catch WITH a timeout, so a hang or a
           rejection can never leave the camera on and the UI stuck. --- */
  let playErr = null;
  try{
    await withTimeout(video.play(), 7000, 'video.play()');
    log('video.play() resolved.');
  }catch(e){
    playErr = e;
    log('video.play() did not resolve cleanly: ' + e.message);
  }

  if(playErr && video.readyState < 2){
    // genuinely dead — release the camera instead of leaving it lit
    log('readyState still ' + video.readyState + ' after play() failure — releasing camera.');
    releaseStream();
    startCamBtn.disabled = false;
    stopCamBtn.disabled = true;
    video.style.display = 'none';
    vpIdle.style.display = 'block';
    setStatus('The camera opened but the video stream never started ('+playErr.message+'). This is usually an in-app browser or an autoplay restriction — try opening the page in Chrome/Safari directly, or use image upload.', 'err');
    runDiagnostics();
    return;
  }
  if(playErr){ log('Frames are arriving despite play() issue — continuing.'); setStatus('Note: play() reported "'+playErr.message+'" but frames are arriving — continuing.', 'warn'); }

  video.style.display = 'block';
  vpIdle.style.display = 'none';
  vpTools.style.display = 'flex';

  /* --- 4. capability probing is fully isolated: on some phones
           getCapabilities() exists but throws, and that must not
           abort anything above. --- */
  try{ setupCamTools(); log('Capability probe (torch/zoom/focus) completed.'); }
  catch(e){ log('Capability probe threw (' + e.message + ') — isolated, continuing.'); }

  stopCamBtn.disabled = false;
  scanStartedAt = performance.now();
  lastFrameCheck = 0; frames = 0; fpsMark = performance.now(); fps = 0;
  fixViewportHeight();
  log('Camera fully started, entering scan loop. Video ' + video.videoWidth + '×' + video.videoHeight + '.');
  runDiagnostics();
  scanLoop();
}

function setupCamTools(){
  const track = stream && stream.getVideoTracks()[0];
  const torchBtn  = document.getElementById('torchBtn');
  const zoomWrap  = document.getElementById('zoomWrap');
  const zoomRange = document.getElementById('zoomRange');
  torchBtn.style.display = 'none';
  zoomWrap.style.display = 'none';
  if(!track || typeof track.getCapabilities !== 'function') return;

  let caps = null;
  try{ caps = track.getCapabilities(); }catch(e){ return; }
  if(!caps) return;

  try{
    if(caps.focusMode && caps.focusMode.indexOf && caps.focusMode.indexOf('continuous') !== -1){
      track.applyConstraints({ advanced:[{ focusMode:'continuous' }] }).catch(()=>{});
    }
  }catch(e){}

  try{
    if(caps.torch){
      let on = false;
      torchBtn.style.display = 'inline-block';
      torchBtn.onclick = ()=>{
        on = !on;
        track.applyConstraints({ advanced:[{ torch:on }] })
          .then(()=>{ torchBtn.textContent = on ? '🔦 Torch on' : '🔦 Torch'; })
          .catch(()=>{ torchBtn.textContent = '🔦 unsupported'; });
      };
    }
  }catch(e){}

  try{
    if(caps.zoom){
      zoomWrap.style.display = 'block';
      zoomRange.min = caps.zoom.min; zoomRange.max = caps.zoom.max;
      zoomRange.step = caps.zoom.step || 0.1;
      let cur = caps.zoom.min;
      try{ cur = track.getSettings().zoom || caps.zoom.min; }catch(e){}
      zoomRange.value = cur;
      zoomRange.oninput = ()=>{
        track.applyConstraints({ advanced:[{ zoom: parseFloat(zoomRange.value) }] }).catch(()=>{});
      };
    }
  }catch(e){}
}

function stopCamera(){
  log('Stop camera called.');
  if(rafId) cancelAnimationFrame(rafId);
  rafId = null;
  releaseStream();
  video.style.display = 'none';
  vpIdle.style.display = 'block';
  vpTools.style.display = 'none';
  viewportEl.classList.remove('locked');
  vpHud.textContent = '';
  try{ overlayCtx.clearRect(0,0,overlayEl.width,overlayEl.height); }catch(e){}
  startCamBtn.disabled = false;
  stopCamBtn.disabled  = true;
}

let lastFrameCheck = 0, scanStartedAt = 0, frames = 0, fpsMark = 0, fps = 0, lockUntil = 0;

function drawLock(loc, sx, sy){
  const boxW = viewportEl.clientWidth, boxH = viewportEl.clientHeight;
  if(!boxW || !boxH) return;
  if(overlayEl.width !== boxW || overlayEl.height !== boxH){
    overlayEl.width = boxW; overlayEl.height = boxH;
  }
  overlayCtx.clearRect(0,0,boxW,boxH);
  if(!loc) return;
  const vw = video.videoWidth, vh = video.videoHeight;
  if(!vw || !vh) return;
  // the video fills the box exactly (width:100%, height:auto) — no crop, no letterbox
  const k = boxW / vw;
  const map = p => [ (p.x/sx)*k, (p.y/sy)*k ];
  const pts = [loc.topLeftCorner, loc.topRightCorner, loc.bottomRightCorner, loc.bottomLeftCorner].map(map);
  overlayCtx.beginPath();
  overlayCtx.moveTo(pts[0][0], pts[0][1]);
  for(let i=1;i<pts.length;i++) overlayCtx.lineTo(pts[i][0], pts[i][1]);
  overlayCtx.closePath();
  overlayCtx.strokeStyle = '#4ADE80';
  overlayCtx.lineWidth = 3;
  overlayCtx.stroke();
}

function scanLoop(){
  if(!stream) return;
  if(video.readyState >= 2 && video.videoWidth){
    const nativeW = video.videoWidth, nativeH = video.videoHeight;
    const targetW = Math.min(900, nativeW);
    const scale = targetW / nativeW;
    scanCanvas.width = targetW;
    scanCanvas.height = Math.round(nativeH * scale);
    scanCtx.drawImage(video, 0, 0, scanCanvas.width, scanCanvas.height);
    const imageData = scanCtx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts:'dontInvert' });

    frames++;
    const now = performance.now();
    if(now - fpsMark > 500){ fps = Math.round(frames * 1000 / (now - fpsMark)); frames = 0; fpsMark = now; }

    if(code && code.data){
      handleDecodedText(code.data);
      lockUntil = now + 250;
      viewportEl.classList.add('locked');
      drawLock(code.location, scale, scale);
    } else {
      if(now > lockUntil){ viewportEl.classList.remove('locked'); drawLock(null); }
      if(now - lastFrameCheck > 400){
        lastFrameCheck = now;
        if(!session || session.chunks.size === 0){
          const secs = Math.round((now - scanStartedAt)/1000);
          let msg = '🔍 Scanning — camera active, no code detected yet ('+secs+'s).';
          if(secs > 8) msg += ' Move closer, hold steadier, raise screen brightness, or slow the player down / lower bytes per QR code.';
          setStatus(msg, 'info');
        }
      }
    }
    vpHud.textContent = nativeW+'×'+nativeH+' · '+fps+' fps · '
      + (viewportEl.classList.contains('locked') ? 'LOCKED' : 'searching')
      + (session ? ' · '+session.chunks.size+'/'+session.total : '');
  } else {
    vpHud.textContent = 'waiting for frames… readyState '+video.readyState;
  }
  rafId = requestAnimationFrame(scanLoop);
}

/* image upload fallback */
document.getElementById('imgInput').addEventListener('change', (e)=>{
  const files = Array.from(e.target.files || []);
  files.forEach(file=>{
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = ()=>{
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0,0,c.width,c.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if(code && code.data) handleDecodedText(code.data);
      else setStatus('No QR code found in '+file.name+'.', 'warn');
      URL.revokeObjectURL(url);
    };
    img.onerror = ()=>{ setStatus('Could not read '+file.name+' as an image.', 'warn'); URL.revokeObjectURL(url); };
    img.src = url;
  });
  e.target.value = '';
});
