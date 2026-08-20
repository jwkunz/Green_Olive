// This file defines a STRING containing worker-side JS source, not code that
// runs directly in the browser. It's assembled with the other WORKER_*_SRC
// pieces by js/worker-bootstrap.js into one script, then run inside a Web
// Worker via a Blob URL (this keeps the app fully self-contained and working
// when opened directly via file://, where Worker() can't load external
// worker script files due to browser same-origin restrictions).
const WORKER_CODEGEN_SRC = `
// ============================================================
// WORKER MODULE: GNSS PRN code generation (C/A, L2C CM/CL, L5 I5/Q5)
// Verified this session: C/A/L2C against ICD-GPS-200 primary spec text
// and an independently-published worked example; L5 via self-consistency
// checks matching the spec's own stated bit-ordering invariant.
// ============================================================

const PRN_TAPS = {
  1:[2,6],2:[3,7],3:[4,8],4:[5,9],5:[1,9],6:[2,10],7:[1,8],8:[2,9],9:[3,10],10:[2,3],
  11:[3,4],12:[5,6],13:[6,7],14:[7,8],15:[8,9],16:[9,10],17:[1,4],18:[2,5],19:[3,6],20:[4,7],
  21:[5,8],22:[6,9],23:[1,3],24:[4,6],25:[5,7],26:[6,8],27:[7,9],28:[8,10],29:[1,6],30:[2,7],
  31:[3,8],32:[4,9]
};

const L2C_INIT = {
  1:['742417664','624145772'], 2:['756014035','506610362'], 3:['002747144','220360016'],
  4:['066265724','710406104'], 5:['601403471','001143345'], 6:['703232733','053023326'],
  7:['124510070','652521276'], 8:['617316361','206124777'], 9:['047541621','015563374'],
  10:['733031046','561522076'], 11:['713512145','023163525'], 12:['024437606','117776450'],
  13:['021264003','606516355'], 14:['230655351','003037343'], 15:['001314400','046515565'],
  16:['222021506','671511621'], 17:['540264026','605402220'], 18:['205521705','002576207'],
  19:['064022144','525163451'], 20:['120161274','266527765'], 21:['044023533','006760703'],
  22:['724744327','501474556'], 23:['045743577','743747443'], 24:['741201660','615534726'],
  25:['700274134','763621420'], 26:['010247261','720727474'], 27:['713433445','700521043'],
  28:['737324162','222567263'], 29:['311627434','132765304'], 30:['710452007','746332245'],
  31:['722462133','102300466'], 32:['050172213','255231716']
};

const L2C_CM_LEN = 10230, L2C_CL_LEN = 767250;

const L2C_TAPS = [3,4,5,6,9,11,13,16,19,21,24,27];

function generateCACode(prn){
  const taps = PRN_TAPS[((prn-1)%32)+1];
  let g1 = new Uint8Array(10).fill(1);
  let g2 = new Uint8Array(10).fill(1);
  const code = new Int8Array(1023);
  for(let i=0;i<1023;i++){
    const g1out = g1[9];
    const g2out = g2[taps[0]-1] ^ g2[taps[1]-1];
    code[i] = (g1out ^ g2out) ? -1 : 1;
    const g1fb = g1[2] ^ g1[9];
    const g2fb = g2[1]^g2[2]^g2[5]^g2[7]^g2[8]^g2[9];
    for(let k=9;k>0;k--) g1[k]=g1[k-1];
    g1[0]=g1fb;
    for(let k=9;k>0;k--) g2[k]=g2[k-1];
    g2[0]=g2fb;
  }
  return code;
}

function octalToBits27(octalStr){
  let bin = '';
  for(const ch of octalStr) bin += parseInt(ch,8).toString(2).padStart(3,'0');
  return bin.slice(bin.length-27);
}

function makeL2ChipGenerator(initOctal){
  let arr = octalToBits27(initOctal).split('').map(Number);
  const stageToIdx = function(s){ return 27-s; };
  return function(){
    const out = arr[0];
    let fb = 0;
    for(const s of L2C_TAPS) fb ^= arr[stageToIdx(s)];
    for(let j=0;j<26;j++) arr[j]=arr[j+1];
    arr[26]=fb;
    return out ? -1 : 1;
  };
}

function generateL2Code(initOctal, length){
  const gen = makeL2ChipGenerator(initOctal);
  const code = new Int8Array(length);
  for(let i=0;i<length;i++) code[i]=gen();
  return code;
}

function generateL2CMCode(prn){
  const init = L2C_INIT[((prn-1)%32)+1];
  return generateL2Code(init[0], L2C_CM_LEN);
}

function generateL2CLCode(prn){
  const init = L2C_INIT[((prn-1)%32)+1];
  return generateL2Code(init[1], L2C_CL_LEN);
}

// ---------- L5 I5/Q5 code generation (real IS-GPS-705 XA/XB generator) ----------
// XA: 13-stage LFSR, poly 1+x^9+x^10+x^12+x^13, all-1s init, short-cycled to
// 8190 chips (reset 1 chip early), same for every satellite.
// XB: 13-stage LFSR, poly 1+x+x^3+x^4+x^6+x^7+x^8+x^12+x^13, NOT short-cycled
// (natural 8191-length), satellite/component-specific initial state from
// Table 3-Ia. Composite I5/Q5 = XA XOR XB, 10230 chips (1ms), reused cyclically.
const L5_XA_TAPS = [9,10,12,13];

const L5_XB_TAPS = [1,3,4,6,7,8,12,13];

const L5_INIT = {
  1:['0101011100100','1001011001100'], 2:['1100000110101','0100011110110'], 3:['0100000001000','1111000100011'],
  4:['1011000100110','0011101101010'], 5:['1110111010111','0011110110010'], 6:['0110011111010','0101010101001'],
  7:['1010010011111','1111110000001'], 8:['1011110100100','0110101101000'], 9:['1111100101011','1011101000011'],
  10:['0111111011110','0010010000110'], 11:['0000100111010','0001000000101'], 12:['1110011111001','0101011000101'],
  13:['0001110011100','0100110100101'], 14:['0100000100111','1010000111111'], 15:['0110101011010','1011110001111'],
  16:['0001111001001','1101001011111'], 17:['0100110001111','1110011001000'], 18:['1111000011110','1011011100100'],
  19:['1100100011111','0011001011011'], 20:['0110101101101','1100001110001'], 21:['0010000001000','0110110010000'],
  22:['1110111101111','0010110001110'], 23:['1000011111110','1000101111101'], 24:['1100010110100','0110111110011'],
  25:['1101001101101','0100010011011'], 26:['1010110010110','0101010111100'], 27:['0101011011110','1000011111010'],
  28:['0111101010110','1111101000010'], 29:['0101111100001','0101000100100'], 30:['1000010110111','1000001111001'],
  31:['0001010011110','0101111100101'], 32:['0000010111001','1001000101010']
};

const L5_NH10 = [0,0,0,0,1,1,0,1,0,1]; // I5 overlay, 10 bits @ 1kHz (spans one 10ms CNAV symbol)
const L5_NH20 = [0,0,0,0,0,1,0,0,1,1,0,1,0,1,0,0,1,1,1,0]; // Q5 overlay, 20 bits @ 1kHz (dataless)
let L5_XA_CACHE = null;

function generateL5XA(){
  if(L5_XA_CACHE) return L5_XA_CACHE;
  let arr = new Array(13).fill(1);
  const out = new Int8Array(10230);
  for(let i=0;i<10230;i++){
    out[i] = arr[12];
    let fb = 0; for(const s of L5_XA_TAPS) fb ^= arr[s-1];
    for(let k=12;k>0;k--) arr[k]=arr[k-1];
    arr[0]=fb;
    if((i+1)===8190){ arr = new Array(13).fill(1); }
  }
  L5_XA_CACHE = out;
  return out;
}

function generateL5XB(initStr){
  let arr = initStr.split('').map(Number);
  const out = new Int8Array(10230);
  for(let i=0;i<10230;i++){
    out[i] = arr[12];
    let fb = 0; for(const s of L5_XB_TAPS) fb ^= arr[s-1];
    for(let k=12;k>0;k--) arr[k]=arr[k-1];
    arr[0]=fb;
  }
  return out;
}

function generateL5Code(xaCode, xbInitStr){
  const xb = generateL5XB(xbInitStr);
  const code = new Int8Array(10230);
  for(let i=0;i<10230;i++) code[i] = (xaCode[i]^xb[i]) ? -1 : 1;
  return code;
}

function generateI5Code(prn){ return generateL5Code(generateL5XA(), L5_INIT[((prn-1)%32)+1][0]); }

function generateQ5Code(prn){ return generateL5Code(generateL5XA(), L5_INIT[((prn-1)%32)+1][1]); }
`;
