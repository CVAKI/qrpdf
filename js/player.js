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
  playInfo.textContent = (playIdx+1)+' / '+qrPayloads.length + (playLoops ? '   · loop '+(playLoops+1) : '');
  const nxt = (playIdx+1) % qrPayloads.length;
  if(!frameCache.has(nxt)) setTimeout(()=>frameNode(nxt), 0);
}
function currentSpeed(){
  return playSpeedSel.value === 'custom'
    ? Math.max(30, parseInt(playCustom.value,10) || 400)
    : parseInt(playSpeedSel.value,10);
}
function playTick(){
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
  playIdx = 0; playLoops = 0;
  frameCache.clear();
  playOverlay.classList.add('active');
  playSub.textContent = 'Point the other device\'s camera at this screen — any order, so just let it loop.';
  renderPlayFrame();
  startPlayTimer();
});
document.getElementById('playClose').addEventListener('click', ()=>{
  stopPlayTimer(); playOverlay.classList.remove('active'); frameCache.clear();
});
playPauseBtn.addEventListener('click', ()=>{
  if(playRunning){ stopPlayTimer(); playPauseBtn.textContent = '▶ Resume'; }
  else startPlayTimer();
});
document.getElementById('playNextBtn').addEventListener('click', ()=>{
  playIdx = (playIdx+1) % qrPayloads.length; renderPlayFrame(); if(playRunning) startPlayTimer();
});
document.getElementById('playPrevBtn').addEventListener('click', ()=>{
  playIdx = (playIdx-1+qrPayloads.length) % qrPayloads.length; renderPlayFrame(); if(playRunning) startPlayTimer();
});
playSpeedSel.addEventListener('change', ()=>{
  playCustom.style.display = playSpeedSel.value === 'custom' ? 'inline-block' : 'none';
  if(playRunning) startPlayTimer();
});
playCustom.addEventListener('change', ()=>{ if(playRunning) startPlayTimer(); });
document.addEventListener('keydown', (e)=>{
  if(!playOverlay.classList.contains('active')) return;
  if(e.key === 'Escape'){ stopPlayTimer(); playOverlay.classList.remove('active'); }
  if(e.key === ' '){ e.preventDefault(); playPauseBtn.click(); }
  if(e.key === 'ArrowRight') document.getElementById('playNextBtn').click();
  if(e.key === 'ArrowLeft')  document.getElementById('playPrevBtn').click();
});

/* =========================================================
   Go-to-frame box (added): type a code number — e.g. one the
   scanner lists under "still missing" — press Go / Enter and
   the player jumps to it and pauses there. Press Resume to
   keep looping. Numbers are 1-based, same as the "n / total"
   counter and the scanner's chunk tiles.
   ========================================================= */
const playGoInput = document.getElementById('playGoInput');
const playGoBtn   = document.getElementById('playGoBtn');

function playGoTo(){
  const total = qrPayloads.length;
  const n = parseInt(playGoInput.value, 10);
  if(!total) return;
  if(isNaN(n) || n < 1 || n > total){
    playGoInput.classList.add('invalid');
    return;
  }
  playGoInput.classList.remove('invalid');
  playIdx = n - 1;
  stopPlayTimer();
  playPauseBtn.textContent = '▶ Resume';
  renderPlayFrame();
  playGoInput.blur();            // closes the phone keyboard so the code is fully visible
}
playGoBtn.addEventListener('click', playGoTo);
playGoInput.addEventListener('input', ()=>playGoInput.classList.remove('invalid'));
playGoInput.addEventListener('keydown', (e)=>{
  e.stopPropagation();           // keep Space / arrow keys from triggering the player shortcuts while typing
  if(e.key === 'Enter'){ e.preventDefault(); playGoTo(); }
  if(e.key === 'Escape'){ playGoInput.blur(); }
});
/* each time the player opens: clear the box and show the valid range */
document.getElementById('playBtn').addEventListener('click', ()=>{
  if(!qrPayloads.length) return;
  playGoInput.value = '';
  playGoInput.classList.remove('invalid');
  playGoInput.max = qrPayloads.length;
  playGoInput.placeholder = '1–' + qrPayloads.length;
});
