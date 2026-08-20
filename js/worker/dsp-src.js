// This file defines a STRING containing worker-side JS source, not code that
// runs directly in the browser. It's assembled with the other WORKER_*_SRC
// pieces by js/worker-bootstrap.js into one script, then run inside a Web
// Worker via a Blob URL (this keeps the app fully self-contained and working
// when opened directly via file://, where Worker() can't load external
// worker script files due to browser same-origin restrictions).
const WORKER_DSP_SRC = `
// ============================================================
// WORKER MODULE: front-end DSP chain (bandwidth filter, AGC, ADC quantization)
// ============================================================

function makeButterworthLowpass(cutoffHz, fs){
  const wc = Math.tan(Math.PI*cutoffHz/fs);
  const k2 = wc*wc, sqrt2 = Math.SQRT2;
  const a0 = k2 + sqrt2*wc + 1;
  const b0 = k2/a0, b1 = 2*b0, b2 = b0;
  const a1 = 2*(k2-1)/a0, a2 = (k2 - sqrt2*wc + 1)/a0;
  let x1=0,x2=0,y1=0,y2=0;
  return function(x0){
    const y0 = b0*x0 + b1*x1 + b2*x2 - a1*y1 - a2*y2;
    x2=x1; x1=x0; y2=y1; y1=y0;
    return y0;
  };
}

function applyFrontEndFilter(iData, qData, cutoffHz, fs){
  const filtI = makeButterworthLowpass(cutoffHz, fs);
  const filtQ = makeButterworthLowpass(cutoffHz, fs);
  for(let n=0;n<iData.length;n++){
    iData[n] = filtI(iData[n]);
    qData[n] = filtQ(qData[n]);
  }
}

function applyAGC(iData, qData, fs, targetAmplitude){
  const tau = 0.001;
  const alpha = 1 - Math.exp(-1/(tau*fs));
  let powerEst = targetAmplitude*targetAmplitude;
  for(let n=0;n<iData.length;n++){
    const inst = iData[n]*iData[n] + qData[n]*qData[n];
    powerEst += alpha*(inst - powerEst);
    const gain = targetAmplitude/Math.sqrt(Math.max(powerEst,1e-9));
    iData[n] *= gain;
    qData[n] *= gain;
  }
}

function quantizeArray(data, bits, sigma){
  const levels = 1<<bits;
  const half = levels/2;
  const stepFactor = bits===1 ? 1.0 : bits===2 ? 0.98 : bits===3 ? 0.5 : 0.35;
  const step = sigma*stepFactor;
  const out = new Float32Array(data.length);
  for(let n=0;n<data.length;n++){
    let idx = Math.round(data[n]/step);
    idx = Math.max(-half, Math.min(half-1, idx));
    out[n] = idx + 0.5;
  }
  return out;
}
`;
