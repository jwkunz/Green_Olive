// ---------- IQ generation (dispatched to Worker) ----------
// ---------- size estimate ----------
function updateFsOptionsForSignal(){
  const signal = $('signal').value;
  const fsSel = $('fs');
  const l5Warning = $('l5SizeWarning');
  Array.from(fsSel.options).forEach(opt=>{
    const val = parseInt(opt.value,10);
    const isL5Rate = val >= 20000000;
    opt.hidden = signal==='l5' ? !isL5Rate : isL5Rate;
  });
  // if current selection is now hidden, jump to the first visible option
  if(fsSel.options[fsSel.selectedIndex].hidden){
    const firstVisible = Array.from(fsSel.options).find(o=>!o.hidden);
    if(firstVisible) fsSel.value = firstVisible.value;
  }
  l5Warning.style.display = signal==='l5' ? 'block' : 'none';
}
function updateSizeEstimate(){
  const fs = parseInt($('fs').value,10);
  const dur = parseFloat($('dur').value)||0;
  const bytes = fs*dur*2*2; // stereo (I/Q), 16-bit
  const mb = bytes/1e6;
  $('sizeEstimate').textContent = 'Estimated file size: ~'+mb.toFixed(1)+' MB ('+visibleSats.length+' satellites in view)';
}
$('fs').onchange = updateSizeEstimate;
$('dur').oninput = updateSizeEstimate;
$('signal').onchange = () => { updateFsOptionsForSignal(); updateSizeEstimate(); };
updateFsOptionsForSignal();


let genWorker = null;
let lastGeneration = null; // {wavBuffer, fs, signal, dur, sats:[{prn,dopplerHz,codePhase0,...}]}

// ---------- WAV IQ generation (dispatched to Worker) ----------
$('genBtn').onclick = () => {
  if(visibleSats.length===0){ setStatus('genStatus','Compute a sky view with at least one visible satellite first.','err'); return; }
  const fs = parseInt($('fs').value,10);
  let dur = parseFloat($('dur').value);
  if(!(dur>0)){ setStatus('genStatus','Duration must be greater than 0.','err'); return; }
  if(dur>60){
    const estMb = (fs*dur*4/1e6).toFixed(0);
    const proceed = confirm('This will generate ~'+dur.toFixed(0)+'s of IQ data ('+estMb+' MB) — that may take a while and use significant memory. Continue?');
    if(!proceed) return;
  }
  const noiseLevel = parseFloat($('noise').value);
  const signal = $('signal').value;
  const carrierFreq = signal==='l2c' ? L2_FREQ : signal==='l5' ? L5_FREQ : L1_FREQ;
  const bwHz = parseInt($('bw').value,10);
  const agcOn = $('agc').value === '1';
  const qbits = parseInt($('qbits').value,10);

  const chipRate = 1.023e6;
  const codeLenL1 = 1023;
  const towBaseSec = gpsTowSeconds(new Date($('dt').value));
  const satsPayload = visibleSats.map(s=>{
    const dopplerHz = -s.rangeRateMps/C_LIGHT*carrierFreq;
    const codePhase0 = (s.effectiveRange % (C_LIGHT/chipRate*codeLenL1)) / (C_LIGHT/chipRate);
    // Automatic elevation-dependent multipath (see Phase 4 notes)
    const mpDelayChips = 0.3 + 0.9*(((s.prn*37)%97)/97);
    const mpAmpFactor = 0.5*Math.exp(-s.el/15);
    const mpPhaseOffset = ((s.prn*53)%360)*DEG;
    return {prn:s.prn, dopplerHz, codePhase0, amp:s.amp, mpDelayChips, mpAmpFactor, mpPhaseOffset,
      eph: s.eph, clk: s.clk, towBaseSec};
  });

  $('genBtn').disabled = true;
  $('dlWrap').innerHTML = '';
  setStatus('genStatus','Starting worker ('+(signal==='l2c'?'L2C':'L1 C/A')+')...');
  $('progressBar').style.width='0%';

  if(genWorker){ genWorker.terminate(); }
  const workerBlob = new Blob([WORKER_SRC], {type:'application/javascript'});
  const workerUrl = URL.createObjectURL(workerBlob);
  genWorker = new Worker(workerUrl);

  genWorker.onmessage = (e) => {
    const msg = e.data;
    if(msg.type === 'progress'){
      $('progressBar').style.width = msg.pct+'%';
      setStatus('genStatus', msg.stage+' '+msg.pct+'%');
    } else if(msg.type === 'done'){
      const blob = new Blob([msg.buffer], {type:'audio/wav'});
      const url = URL.createObjectURL(blob);
      const mb = (blob.size/1e6).toFixed(1);
      const qLabel = qbits<16 ? (qbits+'-bit ADC') : '16-bit idealized';
      const sigLabel = signal==='l2c' ? 'L2C' : signal==='l5' ? 'L5' : 'L1 C/A';
      $('dlWrap').innerHTML = `<a class="dl" href="${url}" download="gps_sim_iq.wav">⬇ Download gps_sim_iq.wav</a> (${mb} MB, ${sigLabel}, L=I / R=Q, ${fs} Hz, ${msg.satCount} satellites, ${qLabel}${agcOn?', AGC on':', AGC off'})`;
      setStatus('genStatus','Done.','ok');
      $('genBtn').disabled = false;
      lastGeneration = { wavBuffer: msg.buffer, fs, signal, dur, sats: satsPayload };
      updateCorrelatorSatOptions();
      URL.revokeObjectURL(workerUrl);
    } else if(msg.type === 'error'){
      setStatus('genStatus','Worker error: '+msg.message,'err');
      $('genBtn').disabled = false;
      URL.revokeObjectURL(workerUrl);
    }
  };
  genWorker.onerror = (err) => {
    setStatus('genStatus','Worker error: '+err.message,'err');
    $('genBtn').disabled = false;
  };

  genWorker.postMessage({ type:'generate', signal, fs, dur, noiseLevel, bwHz, agcOn, qbits, sats: satsPayload });
};
