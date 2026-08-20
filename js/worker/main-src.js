// This file defines a STRING containing worker-side JS source, not code that
// runs directly in the browser. It's assembled with the other WORKER_*_SRC
// pieces by js/worker-bootstrap.js into one script, then run inside a Web
// Worker via a Blob URL (this keeps the app fully self-contained and working
// when opened directly via file://, where Worker() can't load external
// worker script files due to browser same-origin restrictions).
const WORKER_MAIN_SRC = `
// ============================================================
// WORKER MODULE: message dispatch (generate / correlate)
// ============================================================

// ---------- Correlator / acquisition search (runs here so it can reuse the
// already-verified code generators, and so it's off the main thread) ----------
function runCorrelate(msg){
  try {
    const signal = msg.signal, prn = msg.prn, effFs = msg.effFs;
    const iArr = new Float32Array(msg.iArr), qArr = new Float32Array(msg.qArr);
    const blockLen = msg.blockLen, numBlocks = msg.numBlocks;

    // Full-resolution (step=1) search is required: PRN code autocorrelation
    // is only ~1 chip wide, so any coarser phase step essentially never
    // lands close enough to detect the real peak (confirmed by testing --
    // a coarse-stepped search found noise-level false peaks, not the
    // signal). L2C's search is restricted to [0,1023) combined-chips,
    // which matches this simulator's own generation range (codePhase0 is
    // always in that range by construction) -- correct for recordings
    // made by this app, not a general-purpose full-range L2C acquisition.
    let localCode, chipRateRef, searchPhases;
    if(signal==='l2c'){
      const cm = generateL2CMCode(prn); // 10230 chips
      localCode = new Int8Array(20460); // one full CM/CL combined-chip cycle (20ms)
      for(let i=0;i<20460;i++) localCode[i] = (i%2===0) ? cm[(i>>1)%10230] : 0; // CM-only matched filter, CL slots contribute 0
      chipRateRef = 1.023e6; searchPhases = 1023; // restricted range, see note above
    } else {
      localCode = generateCACode(prn); // 1023 chips
      chipRateRef = 1.023e6; searchPhases = 1023;
    }
    const codeLen = localCode.length;
    const numPhases = searchPhases;
    const phaseStep = 1;
    const dopplerRange = 4000;
    const dopplerBins = [];
    for(let d=-dopplerRange; d<=dopplerRange; d+=500) dopplerBins.push(d);
    const powerGrid = new Float32Array(dopplerBins.length*numPhases);

    let biIdx = 0;
    function processBin(){
      const dHz = dopplerBins[biIdx];
      const wI = new Float32Array(blockLen), wQ = new Float32Array(blockLen);
      for(let b=0; b<numBlocks; b++){
        const blockStart = b*blockLen;
        for(let k=0;k<blockLen;k++){
          const n = blockStart+k;
          const t = n/effFs;
          const ph = -2*Math.PI*dHz*t;
          const c = Math.cos(ph), sn = Math.sin(ph);
          wI[k] = iArr[n]*c - qArr[n]*sn;
          wQ[k] = iArr[n]*sn + qArr[n]*c;
        }
        for(let pIdx=0; pIdx<numPhases; pIdx++){
          const ph2 = pIdx*phaseStep;
          let sI=0, sQ=0;
          for(let k=0;k<blockLen;k++){
            const chipIdx = Math.floor(k*(chipRateRef/effFs) + ph2) % codeLen;
            const cv = localCode[chipIdx];
            sI += wI[k]*cv;
            sQ += wQ[k]*cv;
          }
          powerGrid[biIdx*numPhases+pIdx] += sI*sI+sQ*sQ;
        }
      }
      biIdx++;
      const pct = Math.floor(100*biIdx/dopplerBins.length);
      self.postMessage({type:'corrProgress', pct});
      if(biIdx < dopplerBins.length){
        setTimeout(processBin, 0);
      } else {
        finish();
      }
    }
    function finish(){
      let peakVal=-1, peakBin=0, peakIdx=0;
      for(let bi=0; bi<dopplerBins.length; bi++){
        for(let pIdx=0; pIdx<numPhases; pIdx++){
          const v = powerGrid[bi*numPhases+pIdx];
          if(v>peakVal){ peakVal=v; peakBin=bi; peakIdx=pIdx; }
        }
      }
      let sum=0; for(let i=0;i<powerGrid.length;i++) sum+=powerGrid[i];
      const meanVal = sum/powerGrid.length;
      const snrDb = 10*Math.log10(peakVal/meanVal);
      self.postMessage({
        type:'corrDone', grid: powerGrid.buffer, numBins: dopplerBins.length, numPhases,
        dopplerBins, peakBin, peakPhase: peakIdx*phaseStep, snrDb, numBlocks, phaseStep, codeLen
      }, [powerGrid.buffer]);
    }
    processBin();
  } catch(err){
    self.postMessage({type:'corrError', message: (err&&err.message)?err.message:String(err)});
  }
}

self.onmessage = function(e){
  const msg = e.data;
  if(msg.type === 'correlate'){ runCorrelate(msg); return; }
  if(msg.type !== 'generate') return;
  try {
    const signal = msg.signal, fs = msg.fs, dur = msg.dur, noiseLevel = msg.noiseLevel;
    const bwHz = msg.bwHz, agcOn = msg.agcOn, qbits = msg.qbits, satsIn = msg.sats;
    const chipRate = 1.023e6;
    const totalSamples = Math.floor(fs*dur);

    const sats = satsIn.map(function(s){
      const base = {
        prn:s.prn, dopplerHz:s.dopplerHz, codePhase0:s.codePhase0, amp:s.amp,
        phase0: Math.random()*2*Math.PI,
        mpDelayChips:s.mpDelayChips, mpAmpFactor:s.mpAmpFactor, mpPhaseOffset:s.mpPhaseOffset
      };
      if(signal==='l2c'){
        base.cmCode = generateL2CMCode(s.prn);
        base.clCode = generateL2CLCode(s.prn);
        base.cnavSymbols = generateCnavSymbols(s.prn, dur, s.eph, s.clk, s.towBaseSec||0);
      } else if(signal==='l5'){
        base.i5Code = generateI5Code(s.prn);
        base.q5Code = generateQ5Code(s.prn);
        base.l5CnavSymbols = generateL5CnavSymbols(s.prn, dur, s.eph, s.clk, s.towBaseSec||0);
      } else {
        base.code = generateCACode(s.prn);
        base.navBits = generateLnavBits(s.prn, dur, s.eph, s.clk, s.towBaseSec||0);
      }
      return base;
    });

    const l5ChipRate = 10.23e6;

    // For L1 C/A / L2C: returns a single real composite chip value (code*data).
    function sampleChip(s,t,extraDelayChips){
      if(signal==='l2c'){
        const combinedIdx = Math.floor(t*chipRate + s.codePhase0 + extraDelayChips);
        const pairPos = combinedIdx & 1;
        const subIdx = combinedIdx >> 1;
        if(pairPos===0){
          const cmIdx = ((subIdx % L2C_CM_LEN)+L2C_CM_LEN) % L2C_CM_LEN;
          const symIdx = Math.min(s.cnavSymbols.length-1, Math.floor(t/0.02));
          return s.cmCode[cmIdx]*s.cnavSymbols[symIdx];
        } else {
          const clIdx = ((subIdx % L2C_CL_LEN)+L2C_CL_LEN) % L2C_CL_LEN;
          return s.clCode[clIdx];
        }
      } else {
        const chipIdx = Math.floor((t*chipRate + s.codePhase0 + extraDelayChips) % 1023);
        const bitIdx = Math.min(s.navBits.length-1, Math.floor(t*50));
        return s.code[chipIdx]*s.navBits[bitIdx];
      }
    }

    // L5 is genuinely dual-quadrature (I5 and Q5 are independent real bit
    // trains on the I/Q rails directly, not a single stream rotated by
    // carrier phase like L1/L2C) — returns {i, q} for the pre-Doppler complex value.
    function sampleL5IQ(s,t,extraDelayChips){
      const chipIdx = Math.floor((t*l5ChipRate + s.codePhase0*10 + extraDelayChips) % 10230);
      const symIdx = Math.min(s.l5CnavSymbols.length-1, Math.floor(t/0.01));
      const nh10Idx = Math.floor(t*1000) % 10;
      const nh20Idx = Math.floor(t*1000) % 20;
      const i5val = s.i5Code[chipIdx] * s.l5CnavSymbols[symIdx] * (L5_NH10[nh10Idx]?-1:1);
      const q5val = s.q5Code[chipIdx] * (L5_NH20[nh20Idx]?-1:1);
      return {i:i5val, q:q5val};
    }

    const iData = new Float32Array(totalSamples);
    const qData = new Float32Array(totalSamples);
    const CHUNK = 500000;
    let idx = 0;

    function genChunk(){
      const end = Math.min(idx+CHUNK, totalSamples);
      for(let n=idx;n<end;n++){
        const t = n/fs;
        let accI=0, accQ=0;
        for(let si=0; si<sats.length; si++){
          const s = sats[si];
          const ph = 2*Math.PI*s.dopplerHz*t + s.phase0;
          const cosPh = Math.cos(ph), sinPh = Math.sin(ph);
          if(signal==='l5'){
            // Dual-quadrature: rotate the complex (I5 + jQ5) value by Doppler phase,
            // rather than a single real chip stream (see sampleL5IQ comment).
            const c = sampleL5IQ(s,t,0);
            accI += s.amp*(c.i*cosPh - c.q*sinPh);
            accQ += s.amp*(c.i*sinPh + c.q*cosPh);
            const mp = sampleL5IQ(s,t,s.mpDelayChips*10); // chip units differ 10x for L5
            const mpPh = ph + s.mpPhaseOffset;
            const mpCos = Math.cos(mpPh), mpSin = Math.sin(mpPh);
            accI += s.amp*s.mpAmpFactor*(mp.i*mpCos - mp.q*mpSin);
            accQ += s.amp*s.mpAmpFactor*(mp.i*mpSin + mp.q*mpCos);
          } else {
            const chipVal = sampleChip(s,t,0);
            accI += s.amp*chipVal*cosPh;
            accQ += s.amp*chipVal*sinPh;
            const mpChipVal = sampleChip(s,t,s.mpDelayChips);
            const mpPh = ph + s.mpPhaseOffset;
            accI += s.amp*s.mpAmpFactor*mpChipVal*Math.cos(mpPh);
            accQ += s.amp*s.mpAmpFactor*mpChipVal*Math.sin(mpPh);
          }
        }
        const nI = (Math.random()+Math.random()+Math.random()-1.5)/1.5*noiseLevel;
        const nQ = (Math.random()+Math.random()+Math.random()-1.5)/1.5*noiseLevel;
        iData[n] = accI/Math.sqrt(sats.length) + nI;
        qData[n] = accQ/Math.sqrt(sats.length) + nQ;
      }
      idx = end;
      const pct = Math.floor(70*idx/totalSamples);
      self.postMessage({type:'progress', pct: pct, stage:'Generating baseband IQ...'});
      if(idx < totalSamples){
        setTimeout(genChunk, 0);
      } else {
        finalize();
      }
    }

    function finalize(){
      self.postMessage({type:'progress', pct:72, stage:'Applying front-end filter...'});
      const cutoffHz = Math.min(bwHz/2, fs*0.475);
      applyFrontEndFilter(iData, qData, cutoffHz, fs);

      const targetAmplitude = 1.0;
      if(agcOn){
        self.postMessage({type:'progress', pct:80, stage:'Applying AGC...'});
        applyAGC(iData, qData, fs, targetAmplitude);
      }

      let outI, outQ, scale;
      if(qbits < 16){
        self.postMessage({type:'progress', pct:88, stage:'Quantizing...'});
        let sigma = targetAmplitude/Math.SQRT2;
        if(!agcOn){
          let sumsq=0;
          for(let n=0;n<iData.length;n++) sumsq += iData[n]*iData[n]+qData[n]*qData[n];
          sigma = Math.sqrt(sumsq/(2*iData.length));
        }
        outI = quantizeArray(iData, qbits, sigma);
        outQ = quantizeArray(qData, qbits, sigma);
        const half = (1<<qbits)/2;
        scale = (32760*0.9)/half;
      } else {
        outI = iData; outQ = qData;
        let peak=0;
        for(let n=0;n<outI.length;n++){ peak=Math.max(peak,Math.abs(outI[n]),Math.abs(outQ[n])); }
        scale = peak>0 ? (32767*0.9)/peak : 1;
      }

      self.postMessage({type:'progress', pct:95, stage:'Encoding WAV...'});
      const totalSamplesLocal = outI.length;
      const bytesPerSample=2, numChannels=2;
      const dataSize = totalSamplesLocal*numChannels*bytesPerSample;
      const buffer = new ArrayBuffer(44+dataSize);
      const view = new DataView(buffer);
      function writeStr(off,str){ for(let i=0;i<str.length;i++) view.setUint8(off+i, str.charCodeAt(i)); }
      writeStr(0,'RIFF'); view.setUint32(4, 36+dataSize, true);
      writeStr(8,'WAVE'); writeStr(12,'fmt ');
      view.setUint32(16,16,true); view.setUint16(20,1,true);
      view.setUint16(22,numChannels,true); view.setUint32(24,fs,true);
      view.setUint32(28, fs*numChannels*bytesPerSample, true);
      view.setUint16(32, numChannels*bytesPerSample, true);
      view.setUint16(34, 16, true);
      writeStr(36,'data'); view.setUint32(40, dataSize, true);

      let off=44;
      for(let n=0;n<totalSamplesLocal;n++){
        view.setInt16(off, Math.max(-32768,Math.min(32767, Math.round(outI[n]*scale))), true); off+=2;
        view.setInt16(off, Math.max(-32768,Math.min(32767, Math.round(outQ[n]*scale))), true); off+=2;
      }

      self.postMessage({type:'done', buffer: buffer, satCount: sats.length}, [buffer]);
    }

    genChunk();
  } catch(err){
    self.postMessage({type:'error', message: (err && err.message) ? err.message : String(err)});
  }
};
`;
