// ---------- Phase 7: correlator / acquisition proof (Worker-based) ----------
function updateCorrelatorSatOptions(){
  const sel = $('corrPrn');
  sel.innerHTML = '';
  if(!lastGeneration || lastGeneration.signal === 'l5'){
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = lastGeneration ? 'Correlator supports L1 C/A and L2C only (L5\u2019s 10.23 Mcps codes make full-resolution search impractical without an FFT-based approach)' : 'Generate a recording first';
    sel.appendChild(opt);
    $('corrBtn').disabled = true;
    return;
  }
  lastGeneration.sats.forEach(s=>{
    const opt = document.createElement('option');
    opt.value = s.prn; opt.textContent = 'PRN '+s.prn;
    sel.appendChild(opt);
  });
  $('corrBtn').disabled = lastGeneration.sats.length===0;
}

let corrWorker = null;

$('corrBtn').onclick = () => {
  if(!lastGeneration || lastGeneration.signal==='l5') return;
  const prn = parseInt($('corrPrn').value,10);
  const satTruth = lastGeneration.sats.find(s=>s.prn===prn);
  if(!satTruth) return;
  const signal = lastGeneration.signal;

  const fs = lastGeneration.fs;
  const view = new DataView(lastGeneration.wavBuffer);
  const dataStart = 44;
  const totalSamplesAvail = (lastGeneration.wavBuffer.byteLength-44)/4; // 2 channels x 2 bytes

  // Decimate to a ~2.046 MHz-equivalent stream so correlator runtime stays
  // bounded. Full-resolution (1-chip step) phase search is used throughout
  // -- PRN autocorrelation is only ~1 chip wide, so anything coarser
  // essentially never detects the real peak (confirmed by testing).
  const targetFs = 2046000;
  const stride = Math.max(1, Math.round(fs/targetFs));
  const effFs = fs/stride;
  // Block = 1ms coherent sub-integration for both signals. A full 20ms CM
  // code period as one coherent block was tested and found far too
  // sensitive to Doppler mismatch at this search grid's 500Hz resolution
  // (longer coherent windows need proportionally finer Doppler steps) --
  // 1ms blocks keep Doppler tolerance matched to the 500Hz grid, with more
  // non-coherent blocks recovering the SNR instead.
  const blockLen = Math.round(effFs*0.001);
  const maxBlocks = 20;
  const availBlocks = Math.floor((totalSamplesAvail/stride)/blockLen);
  const numBlocks = Math.min(maxBlocks, availBlocks);
  if(numBlocks < 1){ setStatus('corrStatus','Recording too short for correlation.','err'); return; }

  const winLen = numBlocks*blockLen;
  const iArr = new Float32Array(winLen), qArr = new Float32Array(winLen);
  for(let n=0;n<winLen;n++){
    const srcIdx = n*stride;
    iArr[n] = view.getInt16(dataStart + srcIdx*4, true);
    qArr[n] = view.getInt16(dataStart + srcIdx*4 + 2, true);
  }

  $('corrBtn').disabled = true;
  $('corrCanvas').style.display='none';
  $('corrResult').innerHTML = '';
  setStatus('corrStatus','Running acquisition search in worker...');
  $('corrProgressBar').style.width='0%';

  if(corrWorker){ corrWorker.terminate(); }
  const workerBlob = new Blob([WORKER_SRC], {type:'application/javascript'});
  const workerUrl = URL.createObjectURL(workerBlob);
  corrWorker = new Worker(workerUrl);

  corrWorker.onmessage = (e) => {
    const m = e.data;
    if(m.type==='corrProgress'){
      $('corrProgressBar').style.width = m.pct+'%';
      setStatus('corrStatus','Running acquisition search... '+m.pct+'%');
    } else if(m.type==='corrDone'){
      const grid = new Float32Array(m.grid);
      renderCorrelatorHeatmap(grid, m.numBins, m.numPhases, m.peakBin, m.peakPhase);
      const peakDoppler = m.dopplerBins[m.peakBin];
      const sigLabel = signal==='l2c' ? 'L2C (CM, phase range 0-1023)' : 'L1 C/A';
      $('corrResult').innerHTML =
        '<div class="note" style="color:var(--phosphor);border-color:var(--phosphor);">'+
        sigLabel+' — Peak found: Doppler \u2248 '+peakDoppler+' Hz (truth: '+satTruth.dopplerHz.toFixed(0)+' Hz), '+
        'code phase \u2248 '+m.peakPhase+' chips (truth: '+satTruth.codePhase0.toFixed(1)+' chips), '+
        'peak/mean \u2248 '+m.snrDb.toFixed(1)+' dB above the noise floor \u2014 recovered from '+m.numBlocks+' coherent block(s) of non-coherent integration.'+
        '</div>';
      setStatus('corrStatus','Done.','ok');
      $('corrBtn').disabled = false;
      URL.revokeObjectURL(workerUrl);
    } else if(m.type==='corrError'){
      setStatus('corrStatus','Worker error: '+m.message,'err');
      $('corrBtn').disabled = false;
      URL.revokeObjectURL(workerUrl);
    }
  };
  corrWorker.onerror = (err) => {
    setStatus('corrStatus','Worker error: '+err.message,'err');
    $('corrBtn').disabled = false;
  };

  corrWorker.postMessage(
    { type:'correlate', signal, prn, effFs, iArr: iArr.buffer, qArr: qArr.buffer, blockLen, numBlocks },
    [iArr.buffer, qArr.buffer]
  );
};

function renderCorrelatorHeatmap(grid, numBins, numPhases, peakBin, peakIdx){
  const cv = $('corrCanvas');
  cv.style.display='block';
  const ctx = cv.getContext('2d');
  const w = cv.width, h = cv.height;
  ctx.clearRect(0,0,w,h);
  let maxV=0; for(let i=0;i<grid.length;i++) maxV=Math.max(maxV,grid[i]);
  const cellW = w/numPhases, cellH = h/numBins;
  for(let bi=0; bi<numBins; bi++){
    for(let ph=0; ph<numPhases; ph++){
      const v = maxV>0 ? grid[bi*numPhases+ph]/maxV : 0;
      const g = Math.floor(v*255);
      ctx.fillStyle = 'rgb('+Math.floor(g*0.1)+','+g+','+Math.floor(g*0.55)+')';
      ctx.fillRect(ph*cellW, (numBins-1-bi)*cellH, Math.ceil(cellW), Math.ceil(cellH));
    }
  }
  ctx.strokeStyle = '#ff5d5d'; ctx.lineWidth=2;
  ctx.strokeRect(peakIdx*cellW-3, (numBins-1-peakBin)*cellH-3, cellW+6, cellH+6);
}
