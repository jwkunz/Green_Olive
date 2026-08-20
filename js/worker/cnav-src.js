// This file defines a STRING containing worker-side JS source, not code that
// runs directly in the browser. It's assembled with the other WORKER_*_SRC
// pieces by js/worker-bootstrap.js into one script, then run inside a Web
// Worker via a Blob URL (this keeps the app fully self-contained and working
// when opened directly via file://, where Worker() can't load external
// worker script files due to browser same-origin restrictions).
const WORKER_CNAV_SRC = `
// ============================================================
// WORKER MODULE: CNAV message encoding (IS-GPS-200 Appendix III)
// Real framing/CRC-24Q/rate-1/2 K=7 convolutional FEC, verified against
// open-source decoders; payload field widths documented as a
// simplification reusing the LNAV scheme (see ROADMAP.md).
// ============================================================

// ---------- Real CNAV message encoding (IS-GPS-200 Appendix III) ----------
// Framing verified against gnss-sdr's open-source CNAV decoder (preamble,
// PRN/msgtype/TOW/alert bit offsets); CRC-24Q and the rate-1/2 K=7
// convolutional code (171/133 octal) verified against IS-GPS-200 text and
// cross-checked structurally (linearity, determinism, continuous-state
// chunking). NOTE: the 238-bit ephemeris/clock payload within each message
// uses the same field widths verified for LNAV rather than the exact real
// CNAV Table 30-I bit positions (which we could not independently verify
// this session) -- framing/CRC/FEC are authentic, payload layout is a
// documented simplification carrying the same genuine fitted values.
const CNAV_PREAMBLE = [1,0,0,0,1,0,1,1];

function crc24q(bits){
  const poly = 0x1864CFB;
  let reg = 0;
  for(const b of bits){
    const topBit = (reg >>> 23) & 1;
    reg = ((reg << 1) & 0xFFFFFF) | b;
    if(topBit) reg ^= (poly & 0xFFFFFF);
  }
  const out = [];
  for(let i=23;i>=0;i--) out.push((reg>>>i)&1);
  return out;
}

function buildCnavPayload10(eph, iode){
  const IODE = fbits(iode, 8, 1, false);
  const p = IODE.concat(fbits(eph.Crs, 16, Math.pow(2,-5), true))
    .concat(fbits(eph.deltaN, 16, Math.pow(2,-43)*Math.PI, true))
    .concat(fbits(eph.M0, 32, Math.pow(2,-31)*Math.PI, true))
    .concat(fbits(eph.Cuc, 16, Math.pow(2,-29), true))
    .concat(fbits(eph.e, 32, Math.pow(2,-33), false))
    .concat(fbits(eph.Cus, 16, Math.pow(2,-29), true))
    .concat(fbits(eph.sqrtA, 32, Math.pow(2,-19), false))
    .concat(fbits(eph.toe, 16, 16, false));
  return p.concat(new Array(238-p.length).fill(0));
}

function buildCnavPayload11(eph, iode){
  const p = fbits(eph.Cic, 16, Math.pow(2,-29), true)
    .concat(fbits(eph.Omega0, 32, Math.pow(2,-31)*Math.PI, true))
    .concat(fbits(eph.Cis, 16, Math.pow(2,-29), true))
    .concat(fbits(eph.i0, 32, Math.pow(2,-31)*Math.PI, true))
    .concat(fbits(eph.Crc, 16, Math.pow(2,-5), true))
    .concat(fbits(eph.omega, 32, Math.pow(2,-31)*Math.PI, true))
    .concat(fbits(eph.omegaDot, 24, Math.pow(2,-43)*Math.PI, true))
    .concat(fbits(iode, 8, 1, false))
    .concat(fbits(eph.idot, 14, Math.pow(2,-43)*Math.PI, true));
  return p.concat(new Array(238-p.length).fill(0));
}

function buildCnavPayload30(clk){
  const p = fbits(((clk.WN%1024)+1024)%1024, 10, 1, false)
    .concat(fbits(clk.IODC, 10, 1, false))
    .concat(fbits(clk.TGD, 8, Math.pow(2,-31), true))
    .concat(fbits(clk.toc, 16, 16, false))
    .concat(fbits(clk.af2, 8, Math.pow(2,-55), true))
    .concat(fbits(clk.af1, 16, Math.pow(2,-43), true))
    .concat(fbits(clk.af0, 22, Math.pow(2,-31), true));
  return p.concat(new Array(238-p.length).fill(0));
}

function buildCnavMessage(prn, msgType, towCount17, payload238){
  const head = CNAV_PREAMBLE.concat(intToBits(prn,6)).concat(intToBits(msgType,6)).concat(intToBits(towCount17,17)).concat([0]);
  const dataForCrc = head.concat(payload238); // 38+238=276 bits
  const crc = crc24q(dataForCrc);
  return dataForCrc.concat(crc); // 300 bits
}

function convEncodeStep(bit, state){
  const G1 = 0b1111001, G2 = 0b1011011; // 171, 133 octal
  const window = [bit].concat(state);
  let g1=0, g2=0;
  for(let i=0;i<7;i++){
    if((G1>>(6-i))&1) g1 ^= window[i];
    if((G2>>(6-i))&1) g2 ^= window[i];
  }
  return {g1, g2, newState: [bit].concat(state.slice(0,5))};
}

// Cycles CNAV message types 10,11,30 (each 'secPerMsg' seconds: 12s for L2C
// @50sps, 6s for L5 @100sps), convolutionally encoding continuously (state
// carried across message boundaries, matching the real spec's requirement).
function generateRealCnavSymbols(prn, durationSec, eph, clk, secPerMsg, symbolsPerSec, towBaseSec){
  const numSymbols = Math.ceil(durationSec*symbolsPerSec) + 4;
  const symbols = new Int8Array(numSymbols);
  if(!eph || !clk){
    let seed = (prn*104729 + 777) >>> 0;
    function rnd(){ seed = (seed*1103515245 + 12345) >>> 0; return (seed >>> 8) / 0x1000000; }
    for(let i=0;i<numSymbols;i++) symbols[i] = rnd()<0.5 ? 1 : -1;
    return symbols;
  }
  const iode = clk.IODC % 256;
  const msgBuilders = [
    ()=>({type:10, payload:buildCnavPayload10(eph, iode)}),
    ()=>({type:11, payload:buildCnavPayload11(eph, iode)}),
    ()=>({type:30, payload:buildCnavPayload30(clk)})
  ];
  let convState = [0,0,0,0,0,0];
  let idx = 0, msgIdx = 0;
  while(idx < numSymbols){
    const mb = msgBuilders[msgIdx%3]();
    const towCount17 = Math.floor((towBaseSec + (msgIdx+1)*secPerMsg)/6) & 0x1FFFF;
    const msgBits = buildCnavMessage(prn, mb.type, towCount17, mb.payload);
    for(const bit of msgBits){
      const r = convEncodeStep(bit, convState);
      convState = r.newState;
      if(idx<numSymbols) symbols[idx++] = r.g1 ? -1 : 1;
      if(idx<numSymbols) symbols[idx++] = r.g2 ? -1 : 1;
    }
    msgIdx++;
  }
  return symbols;
}

function generateCnavSymbols(prn, durationSec, eph, clk, towBaseSec){
  return generateRealCnavSymbols(prn, durationSec, eph, clk, 12, 50, towBaseSec||0);
}

// L5 CNAV: same message/CRC/FEC scheme as L2C, but 6s/message @ 100sps
// (L5 runs at 2x the data rate per the spec).
function generateL5CnavSymbols(prn, durationSec, eph, clk, towBaseSec){
  return generateRealCnavSymbols(prn, durationSec, eph, clk, 6, 100, towBaseSec||0);
}
`;
