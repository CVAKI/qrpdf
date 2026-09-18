/* =========================================================
   ui-extras.js — cosmetic hooks for the Stitch look only.
   Nothing here touches encode/decode logic. Safe to delete:
   the app still works, you just lose the laser sweep,
   drag-highlight and the in-viewport start button.
   ========================================================= */
(function(){
  const vp       = document.getElementById('viewport');
  const idle     = document.getElementById('vpIdle');
  const startBtn = document.getElementById('startCamBtn');
  const idleBtn  = document.getElementById('vpIdleBtn');
  const drop     = document.getElementById('dropzoneBox');

  /* laser sweep runs only while the camera preview is live.
     decode.js hides #vpIdle (display:none) when the preview shows and
     restores it (display:block) on stop, so we just watch that. */
  new MutationObserver(function(){
    vp.classList.toggle('scanning', idle.style.display === 'none');
  }).observe(idle, { attributes:true, attributeFilter:['style'] });

  /* "Start camera" button inside the standby panel */
  if(idleBtn) idleBtn.addEventListener('click', function(){ startBtn.click(); });

  /* highlight the dropzone while a file is dragged over it */
  ['dragenter','dragover'].forEach(function(ev){
    drop.addEventListener(ev, function(){ drop.classList.add('dragover'); });
  });
  ['dragleave','drop'].forEach(function(ev){
    drop.addEventListener(ev, function(){ drop.classList.remove('dragover'); });
  });
})();
