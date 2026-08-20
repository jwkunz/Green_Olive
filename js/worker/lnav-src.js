// This file defines a STRING containing worker-side JS source, not code that
// runs directly in the browser. It's assembled with the other WORKER_*_SRC
// pieces by js/worker-bootstrap.js into one script, then run inside a Web
// Worker via a Blob URL (this keeps the app fully self-contained and working
// when opened directly via file://, where Worker() can't load external
// worker script files due to browser same-origin restrictions).
const WORKER_LNAV_SRC = `
// ============================================================
// WORKER MODULE: LNAV subframe encoding (IS-GPS-200 Appendix II)
// Real parity algorithm + real subframe 1/2/3 bit layout, verified
// via independent encode/decode round trips (see ROADMAP.md).
// ============================================================

// ---------- Real LNAV subframe encoding (IS-GPS-200, verified: 200/200 parity
// round-trips, corruption detection confirmed, full field round trip to sub-LSB
// precision against an independent decoder) ----------
function toTwosComp(val, bits, scale){
  let raw = Math.round(val/scale);
  const max = Math.pow(2,bits-1);
  raw = Math.max(-max, Math.min(max-1, raw));
  if(raw<0) raw += Math.pow(2,bits);
  return raw;
}

function toUnsignedField(val, bits, scale){
  let raw = Math.round(val/scale);
  return Math.max(0, Math.min(Math.pow(2,bits)-1, raw));
}

function intToBits(val, bits){
  const out = new Array(bits);
  for(let i=bits-1;i>=0;i--){ out[i] = val & 1; val = Math.floor(val/2); }
  return out;
}

function fbits(val,bits,scale,signed){ return intToBits(signed?toTwosComp(val,bits,scale):toUnsignedField(val,bits,scale), bits); }

function computeParity(d24, Dstar29, Dstar30){
  const g = i => d24[i-1];
  const D25 = Dstar29 ^ g(1)^g(2)^g(3)^g(5)^g(6)^g(10)^g(11)^g(12)^g(13)^g(14)^g(17)^g(18)^g(20)^g(23);
  const D26 = Dstar30 ^ g(2)^g(3)^g(4)^g(6)^g(7)^g(11)^g(12)^g(13)^g(14)^g(15)^g(18)^g(19)^g(21)^g(24);
  const D27 = Dstar29 ^ g(1)^g(3)^g(4)^g(5)^g(7)^g(8)^g(12)^g(13)^g(14)^g(15)^g(16)^g(19)^g(20)^g(22);
  const D28 = Dstar30 ^ g(2)^g(4)^g(5)^g(6)^g(8)^g(9)^g(13)^g(14)^g(15)^g(16)^g(17)^g(20)^g(21)^g(23);
  const D29 = Dstar30 ^ g(1)^g(3)^g(5)^g(6)^g(7)^g(9)^g(10)^g(14)^g(15)^g(16)^g(17)^g(18)^g(21)^g(22)^g(24);
  const D30 = Dstar29 ^ g(3)^g(5)^g(6)^g(8)^g(9)^g(10)^g(11)^g(13)^g(15)^g(19)^g(22)^g(23)^g(24);
  return [D25,D26,D27,D28,D29,D30];
}

function encodeWord(d24, Dstar29, Dstar30){
  const transmitted = d24.map(b => b ^ Dstar30);
  return transmitted.concat(computeParity(d24, Dstar29, Dstar30));
}

function buildSubframe(subframeId, towCount17, data192, carryIn){
  let Dstar29 = carryIn[0], Dstar30 = carryIn[1];
  let bits = [];
  const preamble = [1,0,0,0,1,0,1,1];
  const tlmData = preamble.concat(new Array(16).fill(0));
  const w1 = encodeWord(tlmData, Dstar29, Dstar30);
  bits = bits.concat(w1); Dstar29=w1[28]; Dstar30=w1[29];
  const towBits = intToBits(towCount17, 17);
  const sfIdBits = intToBits(subframeId, 3);
  const howData = towBits.concat([0,0]).concat(sfIdBits).concat([0,0]);
  const w2 = encodeWord(howData, Dstar29, Dstar30);
  bits = bits.concat(w2); Dstar29=w2[28]; Dstar30=w2[29];
  for(let w=0; w<8; w++){
    const chunk = data192.slice(w*24, w*24+24);
    const word = encodeWord(chunk, Dstar29, Dstar30);
    bits = bits.concat(word); Dstar29=word[28]; Dstar30=word[29];
  }
  return { bits, carryOut: [Dstar29, Dstar30] };
}

// Subframe 1 (clock) word layout verified against gpsd's open-source subframe
// decoder: W3=WN(10)+L2code(2)+URA(4)+health(6)+IODC_MSB(2); W4-6=reserved;
// W7=reserved(16)+TGD(8); W8=IODC_LSB(8)+toc(16); W9=af2(8)+af1(16); W10=af0(22)+spare(2)
function buildSubframe1Data(clk){
  const WN = fbits(((clk.WN%1024)+1024)%1024, 10, 1, false);
  const w3 = WN.concat([0,0]).concat(intToBits(0,4)).concat(intToBits(0,6)).concat(intToBits(Math.floor(toUnsignedField(clk.IODC,10,1)/256),2));
  const w4 = new Array(24).fill(0), w5 = new Array(24).fill(0), w6 = new Array(24).fill(0);
  const w7 = new Array(16).fill(0).concat(fbits(clk.TGD, 8, Math.pow(2,-31), true));
  const w8 = intToBits(toUnsignedField(clk.IODC,10,1)%256, 8).concat(fbits(clk.toc, 16, 16, false));
  const w9 = fbits(clk.af2, 8, Math.pow(2,-55), true).concat(fbits(clk.af1, 16, Math.pow(2,-43), true));
  const w10 = fbits(clk.af0, 22, Math.pow(2,-31), true).concat([0,0]);
  return w3.concat(w4,w5,w6,w7,w8,w9,w10);
}

// Subframe 2 (ephemeris1): field widths per IS-GPS-200 Table 20-III
function buildSubframe2Data(eph, iode){
  const IODE = fbits(iode, 8, 1, false);
  const w3 = IODE.concat(fbits(eph.Crs, 16, Math.pow(2,-5), true));
  const M0bits = fbits(eph.M0, 32, Math.pow(2,-31)*Math.PI, true);
  const w4 = fbits(eph.deltaN, 16, Math.pow(2,-43)*Math.PI, true).concat(M0bits.slice(0,8));
  const w5 = M0bits.slice(8,32);
  const ebits = fbits(eph.e, 32, Math.pow(2,-33), false);
  const w6 = fbits(eph.Cuc, 16, Math.pow(2,-29), true).concat(ebits.slice(0,8));
  const w7 = ebits.slice(8,32);
  const sqrtAbits = fbits(eph.sqrtA, 32, Math.pow(2,-19), false);
  const w8 = fbits(eph.Cus, 16, Math.pow(2,-29), true).concat(sqrtAbits.slice(0,8));
  const w9 = sqrtAbits.slice(8,32);
  const w10 = fbits(eph.toe, 16, 16, false).concat([0]).concat(new Array(5).fill(0)).concat([0,0]);
  return w3.concat(w4,w5,w6,w7,w8,w9,w10);
}

// Subframe 3 (ephemeris2)
function buildSubframe3Data(eph, iode){
  const O0bits = fbits(eph.Omega0, 32, Math.pow(2,-31)*Math.PI, true);
  const w3 = fbits(eph.Cic, 16, Math.pow(2,-29), true).concat(O0bits.slice(0,8));
  const w4 = O0bits.slice(8,32);
  const i0bits = fbits(eph.i0, 32, Math.pow(2,-31)*Math.PI, true);
  const w5 = fbits(eph.Cis, 16, Math.pow(2,-29), true).concat(i0bits.slice(0,8));
  const w6 = i0bits.slice(8,32);
  const omegaBits = fbits(eph.omega, 32, Math.pow(2,-31)*Math.PI, true);
  const w7 = fbits(eph.Crc, 16, Math.pow(2,-5), true).concat(omegaBits.slice(0,8));
  const w8 = omegaBits.slice(8,32);
  const w9 = fbits(eph.omegaDot, 24, Math.pow(2,-43)*Math.PI, true);
  const w10 = fbits(iode, 8, 1, false).concat(fbits(eph.idot, 14, Math.pow(2,-43)*Math.PI, true)).concat([0,0]);
  return w3.concat(w4,w5,w6,w7,w8,w9,w10);
}

// Cycles subframes 1,2,3,1,2,3... (6s each, matching real LNAV pacing),
// chaining parity carry continuously across subframe boundaries. Falls
// back to a plausible synthetic-bit stream if no fitted ephemeris/clock
// is available for this satellite (e.g. propagation failed for its TLE).
function generateLnavBits(prn, durationSec, eph, clk, towBaseSec){
  const numBits = Math.ceil(durationSec*50) + 2;
  const bits = new Int8Array(numBits);
  if(!eph || !clk){
    const preamble = [1,0,0,0,1,0,1,1];
    let seed = (prn*7919 + 12345) >>> 0;
    function rnd(){ seed = (seed*1103515245 + 12345) >>> 0; return (seed >>> 8) / 0x1000000; }
    for(let i=0;i<numBits;i++){
      const pos = i % 300;
      bits[i] = (pos < 8) ? (preamble[pos] ? 1 : -1) : (rnd()<0.5 ? 1 : -1);
    }
    return bits;
  }
  const iode = clk.IODC % 256;
  const dataBuilders = [
    ()=>buildSubframe1Data(clk),
    ()=>buildSubframe2Data(eph, iode),
    ()=>buildSubframe3Data(eph, iode)
  ];
  let carry = [0,0];
  let idx = 0, subIdx = 0;
  while(idx < numBits){
    const sfId = (subIdx%3)+1;
    const towCount17 = Math.floor((towBaseSec + (subIdx+1)*6)/6) & 0x1FFFF;
    const sf = buildSubframe(sfId, towCount17, dataBuilders[subIdx%3](), carry);
    carry = sf.carryOut;
    for(let k=0; k<300 && idx<numBits; k++, idx++){
      bits[idx] = sf.bits[k] ? -1 : 1; // transmitted chip-domain bit -> BPSK
    }
    subIdx++;
  }
  return bits;
}
`;
