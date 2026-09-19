/* =========================================================
   player.js — fullscreen QR playback
   (moved verbatim from the working single-file version)
   ========================================================= */

const playOverlay  = document.getElementById('playOverlay');
const playStage    = document.getElementById('playStage');
const playInfo     = document.getElementById('playInfo');
const playSpeedSel = document.getElementById('playSpeed');
const playCustom   = document.getElementById('playCustom');
const playPauseBtn = document.getElementById('playPauseBtn');
const playSub      = document.getElementById('playSub');

let playIdx = 0, playTimer = null, playRunning = false, playLoops = 0;
/* range playback: { start, end } (0-based, inclusive) while a "23-681" style span is playing */
let playRange = null;
const frameCache = new Map();
const CACHE_MAX = 24;

function frameNode(i){
  if(frameCache.has(i)) return frameCache.get(i);
  const holder = document.createElement('div');
  new QRCode(holder, { text:qrPayloads[i], width:560, height:560, correctLevel:eccConst(currentEcc) });
  if(frameCache.size >= CACHE_MAX) frameCache.delete(frameCache.keys().next().value);
  frameCache.set(i, holder);
  return holder;
}
function renderPlayFrame(){
  if(!qrPayloads.length) return;
  const node = frameNode(playIdx);
  playStage.innerHTML = '';
  playStage.appendChild(node);
  playInfo.textContent = (playIdx+1)+' / '+qrPayloads.length
    + (playRange ? '   · '+(playRange.start+1)+'–'+(playRange.end+1) : (playLoops ? '   · loop '+(playLoops+1) : ''));
  const nxt = (playIdx+1) % qrPayloads.length;
  if(!frameCache.has(nxt)) setTimeout(()=>frameNode(nxt), 0);
}
function currentSpeed(){
  return playSpeedSel.value === 'custom'
    ? Math.max(30, parseInt(playCustom.value,10) || 400)
    : parseInt(playSpeedSel.value,10);
}
/* a range plays once, then parks on its last code (Resume goes back to normal looping from there) */
function finishRange(){
  stopPlayTimer();
  playRange = null;
  playPauseBtn.textContent = '▶ Resume';
  playInfo.textContent = (playIdx+1)+' / '+qrPayloads.length+'   · range done';
}
function playTick(){
  if(playRange){
    playIdx = playIdx + 1;
    renderPlayFrame();
    if(playIdx >= playRange.end) finishRange();
    return;
  }
  playIdx = playIdx + 1;
  if(playIdx >= qrPayloads.length){ playIdx = 0; playLoops++; }
  renderPlayFrame();
}
function startPlayTimer(){
  stopPlayTimer();
  playTimer = setInterval(playTick, currentSpeed());
  playRunning = true;
  playPauseBtn.textContent = '⏸ Pause';
}
function stopPlayTimer(){
  if(playTimer) clearInterval(playTimer);
  playTimer = null; playRunning = false;
}
document.getElementById('playBtn').addEventListener('click', ()=>{
  if(!qrPayloads.length) return;
  playIdx = 0; playLoops = 0; playRange = null;
  frameCache.clear();
  playOverlay.classList.add('active');
  playSub.textContent = 'Point the other device\'s camera at this screen — any order, so just let it loop.';
  renderPlayFrame();
  startPlayTimer();
});
document.getElementById('playClose').addEventListener('click', ()=>{
  playRange = null; stopPlayTimer(); playOverlay.classList.remove('active'); frameCache.clear();
});
playPauseBtn.addEventListener('click', ()=>{
  if(playRunning){ stopPlayTimer(); playPauseBtn.textContent = '▶ Resume'; }
  else startPlayTimer();
});
document.getElementById('playNextBtn').addEventListener('click', ()=>{
  playRange = null; playIdx = (playIdx+1) % qrPayloads.length; renderPlayFrame(); if(playRunning) startPlayTimer();
});
document.getElementById('playPrevBtn').addEventListener('click', ()=>{
  playRange = null; playIdx = (playIdx-1+qrPayloads.length) % qrPayloads.length; renderPlayFrame(); if(playRunning) startPlayTimer();
});
playSpeedSel.addEventListener('change', ()=>{
  playCustom.style.display = playSpeedSel.value === 'custom' ? 'inline-block' : 'none';
  if(playRunning) startPlayTimer();
});
playCustom.addEventListener('change', ()=>{ if(playRunning) startPlayTimer(); });
document.addEventListener('keydown', (e)=>{
  if(!playOverlay.classList.contains('active')) return;
  if(e.key === 'Escape'){ playRange = null; stopPlayTimer(); playOverlay.classList.remove('active'); }
  if(e.key === ' '){ e.preventDefault(); playPauseBtn.click(); }
  if(e.key === 'ArrowRight') document.getElementById('playNextBtn').click();
  if(e.key === 'ArrowLeft')  document.getElementById('playPrevBtn').click();
});

/* =========================================================
   Go box: type a code number or a range, press Go / Enter.
     45       jump to code 45 and pause there (Resume keeps looping)
     23-681   play codes 23 → 681 once, then stop on 681
     500-     play 500 → last code once
   Also accepts  23–681  23:681  23..681  23 to 681.  Numbers are
   1-based, same as the "n / total" counter and the scanner's tiles.
   ========================================================= */
const playGoInput = document.getElementById('playGoInput');
const playGoBtn   = document.getElementById('playGoBtn');

/* returns {a,b} (1-based, a<=b) or null when the text is not valid */
function parseGoInput(text, total){
  const s = String(text).trim().toLowerCase();
  let m = /^(\d+)$/.exec(s);
  if(m){
    const n = parseInt(m[1], 10);
    return (n >= 1 && n <= total) ? { a:n, b:n } : null;
  }
  m = /^(\d+)\s*(?:-|–|—|:|\.\.|to)\s*(\d*)$/.exec(s);
  if(!m) return null;
  let a = parseInt(m[1], 10);
  let b = m[2] === '' ? total : parseInt(m[2], 10);
  if(a > b){ const t = a; a = b; b = t; }          /* 67-45 works like 45-67 */
  return (a >= 1 && b <= total) ? { a, b } : null;
}

function playGoTo(){
  const total = qrPayloads.length;
  if(!total) return;
  const r = parseGoInput(playGoInput.value, total);
  if(!r){
    playGoInput.classList.add('invalid');
    return;
  }
  playGoInput.classList.remove('invalid');
  if(r.a === r.b){                                 /* single code: jump + pause */
    playRange = null;
    playIdx = r.a - 1;
    stopPlayTimer();
    playPauseBtn.textContent = '▶ Resume';
    renderPlayFrame();
  } else {                                         /* range: play a → b once, stop on b */
    playRange = { start:r.a - 1, end:r.b - 1 };
    playIdx = playRange.start;
    renderPlayFrame();
    startPlayTimer();
  }
  playGoInput.blur();            // closes the phone keyboard so the code is fully visible
}
playGoBtn.addEventListener('click', playGoTo);
playGoInput.addEventListener('input', ()=>playGoInput.classList.remove('invalid'));
playGoInput.addEventListener('keydown', (e)=>{
  e.stopPropagation();           // keep Space / arrow keys from triggering the player shortcuts while typing
  if(e.key === 'Enter'){ e.preventDefault(); playGoTo(); }
  if(e.key === 'Escape'){ playGoInput.blur(); }
});
/* each time the player opens: clear the box and show the hint */
document.getElementById('playBtn').addEventListener('click', ()=>{
  if(!qrPayloads.length) return;
  playGoInput.value = '';
  playGoInput.classList.remove('invalid');
  playGoInput.placeholder = '45 or 23-' + Math.min(qrPayloads.length, 99);
});
