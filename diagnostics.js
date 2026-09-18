/* =========================================================
   diagnostics.js — viewport sizing, log panel, environment checks
   (moved verbatim from the working single-file version)
   ========================================================= */

/* ================= viewport sizing (no aspect-ratio dependency) ================= */
const viewportEl = document.getElementById('viewport');
/* The video sizes the wrapper itself (width:100%, height:auto), so there is
   nothing to force. This only keeps the overlay canvas matched to the box. */
function fixViewportHeight(){
  try{
    const w = Math.round(viewportEl.clientWidth);
    const h = Math.round(viewportEl.clientHeight);
    const ov = document.getElementById('overlay');
    if(ov && w && h && (ov.width !== w || ov.height !== h)){ ov.width = w; ov.height = h; }
  }catch(e){}
}
window.addEventListener('resize', fixViewportHeight);
window.addEventListener('orientationchange', ()=>setTimeout(fixViewportHeight, 300));
setTimeout(fixViewportHeight, 0);
setTimeout(fixViewportHeight, 600);

/* ================= logging ================= */
const diagBar   = document.getElementById('diagBar');
const logPanel  = document.getElementById('logPanel');
const logBox    = document.getElementById('logBox');
const logLines  = [];

function ts(){
  const d = new Date();
  return d.toTimeString().slice(0,8) + '.' + String(d.getMilliseconds()).padStart(3,'0');
}
function log(msg){
  logLines.push('['+ts()+'] '+msg);
  if(logBox){
    logBox.textContent = logLines.join('\n');
    logBox.scrollTop = logBox.scrollHeight;
  }
}
function setDiagBar(kind, text){
  diagBar.className = 'status ' + kind;
  diagBar.textContent = text + '  (tap to ' + (logPanel.style.display === 'none' ? 'show' : 'hide') + ' logs)';
}
diagBar.addEventListener('click', ()=>{
  logPanel.style.display = logPanel.style.display === 'none' ? 'block' : 'none';
  diagBar.textContent = diagBar.textContent.replace(/tap to (show|hide) logs/, 'tap to ' + (logPanel.style.display === 'none' ? 'show' : 'hide') + ' logs');
});
document.getElementById('clearLogBtn').addEventListener('click', ()=>{
  logLines.length = 0;
  logBox.textContent = '';
  log('Log cleared.');
});
document.getElementById('copyLogBtn').addEventListener('click', async ()=>{
  const msgEl = document.getElementById('copyLogMsg');
  const text = logLines.join('\n') || '(no log entries yet)';
  let ok = false;
  try{
    await navigator.clipboard.writeText(text);
    ok = true;
  }catch(e){
    try{
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      ok = document.execCommand('copy');
      document.body.removeChild(ta);
    }catch(e2){ ok = false; }
  }
  msgEl.textContent = ok ? 'Copied ✓' : 'Copy blocked — tap in the box and select all manually';
  msgEl.style.color = ok ? 'var(--ok)' : 'var(--amber)';
  setTimeout(()=>{ msgEl.textContent = ''; }, 3000);
});

/* ================= environment diagnostics ================= */
function detectInApp(){
  const ua = navigator.userAgent || '';
  const hits = [];
  if(/FBAN|FBAV|FB_IAB/i.test(ua)) hits.push('Facebook');
  if(/Instagram/i.test(ua)) hits.push('Instagram');
  if(/WhatsApp/i.test(ua)) hits.push('WhatsApp');
  if(/Line\//i.test(ua)) hits.push('LINE');
  if(/Snapchat/i.test(ua)) hits.push('Snapchat');
  if(/Twitter/i.test(ua)) hits.push('X/Twitter');
  if(/TikTok|musical_ly|BytedanceWebview/i.test(ua)) hits.push('TikTok');
  if(/; wv\)/i.test(ua)) hits.push('Android WebView');
  if(/Telegram/i.test(ua)) hits.push('Telegram');
  return hits;
}

async function runDiagnostics(){
  const inIframe = (function(){ try{ return window.self !== window.top; }catch(e){ return true; } })();
  const proto    = location.protocol;
  const secure   = !!window.isSecureContext;
  const hasAPI   = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  const libs     = { QRCode: typeof QRCode !== 'undefined', jsQR: typeof jsQR === 'function', pako: typeof pako !== 'undefined' };
  const inApp    = detectInApp();

  let perm = 'unknown';
  try{
    if(navigator.permissions && navigator.permissions.query){
      const p = await navigator.permissions.query({ name:'camera' });
      perm = p.state;
    }
  }catch(e){ perm = 'not reportable'; }

  let camCount = 'not checked', camLabels = '';
  if(hasAPI && navigator.mediaDevices.enumerateDevices){
    try{
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind === 'videoinput');
      camCount = devs.length;
      camLabels = devs.map(d=>d.label).filter(Boolean).join(' / ');
    }catch(e){ camCount = 'enumerateDevices failed ('+e.name+')'; }
  }

  const rows = [
    ['Page address', proto + '//' + location.host + (inIframe ? ' (inside an embedded preview)' : '')],
    ['Secure context (https/localhost)', secure ? 'ok' : 'NO'],
    ['Embedded in iframe', inIframe ? 'YES — blocks camera' : 'ok'],
    ['In-app browser', inApp.length ? inApp.join(', ') : 'no'],
    ['getUserMedia available', hasAPI ? 'ok' : 'NO'],
    ['Camera permission', perm],
    ['Cameras reported', camCount + (camLabels ? ' — '+camLabels : '')],
    ['Libraries', (libs.QRCode?'QRCode ok':'QRCode NO')+' · '+(libs.jsQR?'jsQR ok':'jsQR NO')+' · '+(libs.pako?'pako ok':'pako NO')],
    ['Viewport box', Math.round(viewportEl.clientWidth)+'×'+Math.round(viewportEl.clientHeight)+' px'],
    ['Video state', 'readyState '+video.readyState+' · '+(video.videoWidth||0)+'×'+(video.videoHeight||0)+' · paused '+video.paused]
  ];

  const blockers = [];
  if(!secure) blockers.push('Not a secure context ('+proto+'). Camera only works on https:// or localhost. Run "python3 -m http.server 8000" in the file\'s folder and open http://localhost:8000/index.html.');
  if(inIframe) blockers.push('Page is inside an embedded preview. Iframes block camera access regardless of browser settings — open the page in its own tab.');
  if(inApp.length) blockers.push('In-app browser detected ('+inApp.join(', ')+'). These often block camera access — use the ⋯ menu and choose "Open in browser".');
  if(!hasAPI) blockers.push('This browser exposes no getUserMedia API at all.');
  if(camCount === 0) blockers.push('0 cameras reported while permission is '+perm+'. This means the phone OS is blocking the browser app itself. Android: Settings > Apps > [browser] > Permissions > Camera > Allow. iPhone: Settings > [browser] > Camera > Allow. Fully close and reopen the browser afterward.');
  if(!libs.jsQR) blockers.push('jsQR did not load (CDN blocked or offline) — scanning cannot run.');

  log('=== Environment check (build ' + BUILD + ') ===');
  rows.forEach(r=>log(r[0] + ': ' + r[1]));
  if(blockers.length){
    blockers.forEach(b=>log('BLOCKER: ' + b));
    const worst = !secure || !hasAPI ? 'err' : 'warn';
    setDiagBar(worst, (inIframe ? '⚠ Blocked — inside an embedded preview' : blockers.length ? '⚠ ' + blockers.length + ' issue(s) found' : '⚠ Camera may not work'));
  } else {
    log('No blockers found.');
    setDiagBar('ok', '✓ Nothing blocking the camera');
  }
}
