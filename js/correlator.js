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
      renderCorrelatorHeatmap(grid, m.numBins, m.numPhases, m.peakBin, m.peakPhase, m.dopplerBins, m.phaseStep);
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

// Renders the acquisition search grid as a heatmap with labeled axes (code
// phase on X, Doppler on Y) and a color bar so the plot is interpretable on
// its own, not just as a decorative peak-finder.
function renderCorrelatorHeatmap(grid, numBins, numPhases, peakBin, peakIdx, dopplerBins, phaseStep){
  const cv = $('corrCanvas');
  cv.style.display='block';
  const ctx = cv.getContext('2d');
  const w = cv.width, h = cv.height;
  ctx.clearRect(0,0,w,h);

  const marginLeft = 64, marginRight = 92, marginTop = 14, marginBottom = 48;
  const plotW = w - marginLeft - marginRight;
  const plotH = h - marginTop - marginBottom;

  let maxV=0; for(let i=0;i<grid.length;i++) maxV=Math.max(maxV,grid[i]);
  function colorFor(v){
    const g = Math.floor(Math.max(0,Math.min(1,v))*255);
    return 'rgb('+Math.floor(g*0.1)+','+g+','+Math.floor(g*0.55)+')';
  }

  // ---- heatmap cells ----
  const cellW = plotW/numPhases, cellH = plotH/numBins;
  for(let bi=0; bi<numBins; bi++){
    for(let ph=0; ph<numPhases; ph++){
      const v = maxV>0 ? grid[bi*numPhases+ph]/maxV : 0;
      ctx.fillStyle = colorFor(v);
      ctx.fillRect(marginLeft+ph*cellW, marginTop+(numBins-1-bi)*cellH, Math.ceil(cellW), Math.ceil(cellH));
    }
  }

  // ---- peak marker ----
  ctx.strokeStyle = '#ff5d5d'; ctx.lineWidth = 2;
  ctx.strokeRect(marginLeft+peakIdx*cellW-3, marginTop+(numBins-1-peakBin)*cellH-3, cellW+6, cellH+6);

  // ---- plot border ----
  ctx.strokeStyle = '#1b2b2e'; ctx.lineWidth = 1;
  ctx.strokeRect(marginLeft, marginTop, plotW, plotH);

  ctx.font = '10px monospace';

  // ---- X axis: code phase (chips), with tick marks + title ----
  const numXTicks = 5;
  ctx.strokeStyle = '#1b2b2e';
  ctx.fillStyle = '#5f8577';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for(let t=0;t<numXTicks;t++){
    const frac = t/(numXTicks-1);
    const ph = Math.round(frac*(numPhases-1));
    const x = marginLeft + ph*cellW + cellW/2;
    ctx.beginPath(); ctx.moveTo(x, marginTop+plotH); ctx.lineTo(x, marginTop+plotH+4); ctx.stroke();
    ctx.fillText(String(ph*(phaseStep||1)), x, marginTop+plotH+6);
  }
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Code Phase (chips)', marginLeft+plotW/2, h-6);

  // ---- Y axis: Doppler (Hz), with tick marks + title ----
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  const numYTicks = Math.max(1, Math.min(5, numBins));
  for(let t=0;t<numYTicks;t++){
    const frac = numYTicks>1 ? t/(numYTicks-1) : 0;
    const bi = Math.round(frac*(numBins-1));
    const y = marginTop + (numBins-1-bi)*cellH + cellH/2;
    ctx.strokeStyle = '#1b2b2e';
    ctx.beginPath(); ctx.moveTo(marginLeft-4, y); ctx.lineTo(marginLeft, y); ctx.stroke();
    const label = (dopplerBins && dopplerBins[bi]!=null) ? dopplerBins[bi] : bi;
    ctx.fillStyle = '#5f8577';
    ctx.fillText(String(label), marginLeft-7, y);
  }
  ctx.save();
  ctx.translate(14, marginTop+plotH/2);
  ctx.rotate(-Math.PI/2);
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('Doppler (Hz)', 0, 0);
  ctx.restore();

  // ---- color bar: maps cell brightness to relative correlation power ----
  const cbX = w-marginRight+20, cbW = 14, cbY = marginTop, cbH = plotH;
  for(let i=0;i<cbH;i++){
    const v = 1 - i/cbH; // top = strongest, bottom = weakest
    ctx.fillStyle = colorFor(v);
    ctx.fillRect(cbX, cbY+i, cbW, 1);
  }
  ctx.strokeStyle = '#1b2b2e'; ctx.lineWidth = 1;
  ctx.strokeRect(cbX, cbY, cbW, cbH);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  [0, 0.5, 1].forEach(frac=>{
    const y = cbY + cbH*(1-frac);
    ctx.strokeStyle = '#1b2b2e';
    ctx.beginPath(); ctx.moveTo(cbX+cbW, y); ctx.lineTo(cbX+cbW+4, y); ctx.stroke();
    ctx.fillStyle = '#5f8577';
    ctx.fillText(Math.round(frac*100)+'%', cbX+cbW+6, y);
  });
  ctx.save();
  ctx.translate(w-12, marginTop+plotH/2);
  ctx.rotate(-Math.PI/2);
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('Correlation power (norm.)', 0, 0);
  ctx.restore();
}
