// ---------- orbit propagation (full SGP4/SDP4 via satellite.js — handles GPS's ~12h deep-space regime) ----------
function satEcefPosition(sat, date){
  const pv = satellite.propagate(sat.satrec, date);
  if(!pv || !pv.position) return null; // propagation error (e.g. decayed/invalid elements)
  const gmst = satellite.gstime(date);
  const ecf = satellite.eciToEcf(pv.position, gmst); // km
  return { x: ecf.x*1000, y: ecf.y*1000, z: ecf.z*1000 }; // meters
}

function geodeticToEcef(latDeg, lonDeg, h){
  const lat = latDeg*DEG, lon = lonDeg*DEG;
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat);
  const N = WGS84_A/Math.sqrt(1 - WGS84_E2*sinLat*sinLat);
  return {
    x: (N+h)*cosLat*Math.cos(lon),
    y: (N+h)*cosLat*Math.sin(lon),
    z: (N*(1-WGS84_E2)+h)*sinLat
  };
}

function ecefToAzEl(satEcef, obsEcef, latDeg, lonDeg){
  const dx = satEcef.x-obsEcef.x, dy = satEcef.y-obsEcef.y, dz = satEcef.z-obsEcef.z;
  const range = Math.sqrt(dx*dx+dy*dy+dz*dz);
  const lat = latDeg*DEG, lon = lonDeg*DEG;
  const sinLat=Math.sin(lat), cosLat=Math.cos(lat), sinLon=Math.sin(lon), cosLon=Math.cos(lon);
  const e = -sinLon*dx + cosLon*dy;
  const n = -sinLat*cosLon*dx - sinLat*sinLon*dy + cosLat*dz;
  const u = cosLat*cosLon*dx + cosLat*sinLon*dy + sinLat*dz;
  const az = (Math.atan2(e,n)*RAD + 360)%360;
  const el = Math.asin(u/range)*RAD;
  return {az, el, range};
}

// ---------- Phase 2: propagation-delay & power models ----------
// Example broadcast ionospheric coefficients (typical mid-latitude magnitudes).
// These are NOT live broadcast values — TLE orbit data doesn't include the
// nav message, so real alpha/beta coefficients aren't available here.
const KLOBUCHAR_ALPHA = [1.0245e-08, 2.2352e-08, -5.9605e-08, -1.1921e-07];
const KLOBUCHAR_BETA  = [9.4208e+04, 6.5536e+04, -1.9661e+05, -6.5536e+04];

function gpsTowSeconds(date){
  // seconds since GPS week start (Sunday 00:00 UTC). Ignores the ~18s
  // GPS-UTC leap-second offset, which is negligible for this delay model.
  return date.getUTCDay()*86400 + date.getUTCHours()*3600 + date.getUTCMinutes()*60 + date.getUTCSeconds() + date.getUTCMilliseconds()/1000;
}

function gpsWeekNumber(date){
  const gpsEpoch = Date.UTC(1980,0,6);
  return Math.floor((date.getTime()-gpsEpoch)/86400000/7) % 1024; // 10-bit rollover, matches WN field width
}

// Clock correction params for the LNAV/CNAV clock message. af0 reuses the
// existing synthetic clock bias (real values need the broadcast message
// itself, unavailable from TLE); af1 is a small synthetic drift; af2=0
// (real satellites essentially never need a nonzero quadratic term).
function synthClockParams(prn, toe, weekNumber){
  const af0 = synthClockBiasMeters(prn)/C_LIGHT;
  const seed2 = Math.sin(prn*78.233)*12345.678;
  const frac2 = seed2 - Math.floor(seed2);
  const af1 = (frac2-0.5)*2*1e-11; // +/- ~1e-11 s/s, realistic order of magnitude
  return { WN: weekNumber, IODC: Math.floor(toe/7200)%1024, TGD: -1.0e-8, toc: toe, af2: 0, af1, af0 };
}

function klobucharDelaySec(latDeg, lonDeg, azDeg, elDeg, towSec){
  const latSc = latDeg/180, lonSc = lonDeg/180, elSc = elDeg/180;
  const azRad = azDeg*DEG;
  const psi = 0.0137/(elSc+0.11) - 0.022;
  let phiI = latSc + psi*Math.cos(azRad);
  phiI = Math.max(-0.416, Math.min(0.416, phiI));
  const lambdaI = lonSc + psi*Math.sin(azRad)/Math.cos(phiI*Math.PI);
  const phiM = phiI + 0.064*Math.cos((lambdaI-1.617)*Math.PI);
  let t = 4.32e4*lambdaI + towSec;
  t = t % 86400; if(t<0) t += 86400;
  const F = 1.0 + 16.0*Math.pow(0.53-elSc, 3);
  let AMP = KLOBUCHAR_ALPHA[0] + phiM*(KLOBUCHAR_ALPHA[1] + phiM*(KLOBUCHAR_ALPHA[2] + phiM*KLOBUCHAR_ALPHA[3]));
  if(AMP<0) AMP=0;
  let PER = KLOBUCHAR_BETA[0] + phiM*(KLOBUCHAR_BETA[1] + phiM*(KLOBUCHAR_BETA[2] + phiM*KLOBUCHAR_BETA[3]));
  if(PER<72000) PER=72000;
  const x = 2*Math.PI*(t-50400)/PER;
  return Math.abs(x)<1.57 ? F*(5e-9 + AMP*(1 - x*x/2 + x*x*x*x/24)) : F*5e-9;
}

// Simplified cosecant-mapping tropospheric delay (~2.3m zenith delay assumption)
function tropoDelayMeters(elDeg){
  return 2.3 / Math.sin(Math.sqrt(elDeg*elDeg + 6.25)*DEG);
}

// Simulated satellite clock bias — real values come from the broadcast nav
// message (af0/af1/af2), which isn't available from TLE data alone. This
// generates a deterministic-per-PRN synthetic bias so the effect is visible
// and reproducible, clearly not a real clock correction.
function synthClockBiasMeters(prn){
  const seed = Math.sin(prn*12.9898)*43758.5453;
  const frac = seed - Math.floor(seed);
  return (frac-0.5)*2*300; // +/- ~300 m (~1 microsecond-scale bias)
}

// Approximate combined antenna-gain + low-elevation attenuation factor
function elevationGainFactor(elDeg){
  return Math.max(0.15, 0.3 + 0.7*Math.sin(elDeg*DEG));
}

// ---------- Phase 7: real broadcast ephemeris via least-squares curve fit ----------
// Standard IS-GPS-200 Table 20-IV broadcast ephemeris position algorithm.
function broadcastPosition(p, t){
  const A = p.sqrtA*p.sqrtA;
  const n0 = Math.sqrt(GM/(A*A*A));
  const n = n0 + p.deltaN;
  let tk = t - p.toe;
  if(tk > 302400) tk -= 604800;
  if(tk < -302400) tk += 604800;
  const Mk = p.M0 + n*tk;
  let Ek = Mk;
  for(let i=0;i<15;i++) Ek = Ek - (Ek - p.e*Math.sin(Ek) - Mk)/(1 - p.e*Math.cos(Ek));
  const nuK = Math.atan2(Math.sqrt(1-p.e*p.e)*Math.sin(Ek), Math.cos(Ek)-p.e);
  const PhiK = nuK + p.omega;
  const dU = p.Cus*Math.sin(2*PhiK) + p.Cuc*Math.cos(2*PhiK);
  const dR = p.Crs*Math.sin(2*PhiK) + p.Crc*Math.cos(2*PhiK);
  const dI = p.Cis*Math.sin(2*PhiK) + p.Cic*Math.cos(2*PhiK);
  const uK = PhiK + dU;
  const rK = A*(1 - p.e*Math.cos(Ek)) + dR;
  const iK = p.i0 + dI + p.idot*tk;
  const xo = rK*Math.cos(uK), yo = rK*Math.sin(uK);
  const OmegaK = p.Omega0 + (p.omegaDot - OMEGA_E)*tk - OMEGA_E*p.toe;
  const cO=Math.cos(OmegaK), sO=Math.sin(OmegaK), cI=Math.cos(iK), sI=Math.sin(iK);
  return {x: xo*cO - yo*cI*sO, y: xo*sO + yo*cI*cO, z: yo*sI};
}
// ECI state vector -> osculating classical elements (used as the LM fit's initial guess)
function rv2coe(r, v){
  const rmag = Math.hypot(r.x,r.y,r.z), vmag = Math.hypot(v.x,v.y,v.z);
  const h = {x: r.y*v.z-r.z*v.y, y: r.z*v.x-r.x*v.z, z: r.x*v.y-r.y*v.x};
  const hmag = Math.hypot(h.x,h.y,h.z);
  const nVec = {x: -h.y, y: h.x, z:0};
  const nmag = Math.hypot(nVec.x,nVec.y,nVec.z);
  const rdotv = r.x*v.x+r.y*v.y+r.z*v.z;
  const eVec = {
    x: ((vmag*vmag - GM/rmag)*r.x - rdotv*v.x)/GM,
    y: ((vmag*vmag - GM/rmag)*r.y - rdotv*v.y)/GM,
    z: ((vmag*vmag - GM/rmag)*r.z - rdotv*v.z)/GM
  };
  const e = Math.hypot(eVec.x,eVec.y,eVec.z);
  const energy = vmag*vmag/2 - GM/rmag;
  const a = -GM/(2*energy);
  const i = Math.acos(h.z/hmag);
  let Omega = Math.atan2(nVec.y, nVec.x); if(Omega<0) Omega += 2*Math.PI;
  let omega = Math.acos((nVec.x*eVec.x+nVec.y*eVec.y)/(nmag*e));
  if(eVec.z<0) omega = 2*Math.PI - omega;
  let nu0 = Math.acos((eVec.x*r.x+eVec.y*r.y+eVec.z*r.z)/(e*rmag));
  if(rdotv<0) nu0 = 2*Math.PI - nu0;
  const E0 = 2*Math.atan2(Math.sqrt(1-e)*Math.sin(nu0/2), Math.sqrt(1+e)*Math.cos(nu0/2));
  let M0 = E0 - e*Math.sin(E0);
  if(M0<0) M0 += 2*Math.PI;
  return {sqrtA:Math.sqrt(a), e, i0:i, Omega0:Omega, omega, M0};
}
function wrapPi(x){ return ((x + Math.PI) % (2*Math.PI) + 2*Math.PI) % (2*Math.PI) - Math.PI; }

const EPH_PARAM_NAMES = ['sqrtA','e','i0','Omega0','omega','M0','deltaN','idot','omegaDot','Cuc','Cus','Crc','Crs','Cic','Cis'];
const EPH_STEP_SIZES = {sqrtA:1, e:1e-7, i0:1e-7, Omega0:1e-7, omega:1e-7, M0:1e-7, deltaN:1e-12, idot:1e-13, omegaDot:1e-12, Cuc:1e-9,Cus:1e-9,Crc:1e-2,Crs:1e-2,Cic:1e-9,Cis:1e-9};

// Levenberg-Marquardt least-squares fit of the broadcast ephemeris model against
// SGP4-propagated truth positions sampled over a +/-1hr window around toe. This
// is what a real GPS control segment does (fit a curve-fit representation to the
// true orbit) -- not just repackaging osculating elements.
function fitEphemeris(satrec, toeDate, toeSec){
  const sampleTimesSec = [];
  for(let dt=-3600; dt<=3600; dt+=300) sampleTimesSec.push(dt);
  const samples = sampleTimesSec.map(dt=>{
    const d = new Date(toeDate.getTime()+dt*1000);
    const pv = satellite.propagate(satrec, d);
    if(!pv || !pv.position) return null;
    const gmst = satellite.gstime(d);
    const ecf = satellite.eciToEcf(pv.position, gmst);
    return {t: dt, pos: {x:ecf.x*1000, y:ecf.y*1000, z:ecf.z*1000}};
  }).filter(s=>s);
  if(samples.length < 10) return null;

  const pv0 = satellite.propagate(satrec, toeDate);
  if(!pv0 || !pv0.position) return null;
  const r0 = {x:pv0.position.x*1000, y:pv0.position.y*1000, z:pv0.position.z*1000};
  const v0 = {x:pv0.velocity.x*1000, y:pv0.velocity.y*1000, z:pv0.velocity.z*1000};
  const coe = rv2coe(r0, v0);
  let params = Object.assign({toe: toeSec, deltaN:0, idot:0, omegaDot:0, Cuc:0,Cus:0,Crc:0,Crs:0,Cic:0,Cis:0}, coe);

  function residuals(p){
    const res = [];
    for(const s of samples){
      const pred = broadcastPosition(p, p.toe + s.t);
      res.push(pred.x-s.pos.x, pred.y-s.pos.y, pred.z-s.pos.z);
    }
    return res;
  }
  let lambda = 1e-3;
  let curRms = Math.sqrt(residuals(params).reduce((s,x)=>s+x*x,0)/(samples.length*3));
  for(let iter=0; iter<40 && curRms>0.05; iter++){
    const r = residuals(params);
    const m = r.length, nP = EPH_PARAM_NAMES.length;
    const J = [];
    for(let j=0;j<nP;j++){
      const name = EPH_PARAM_NAMES[j], h = EPH_STEP_SIZES[name];
      const pPlus = Object.assign({}, params); pPlus[name]+=h;
      const pMinus = Object.assign({}, params); pMinus[name]-=h;
      const rPlus = residuals(pPlus), rMinus = residuals(pMinus);
      J.push(rPlus.map((v,k)=>(v-rMinus[k])/(2*h)));
    }
    const JTJ = Array.from({length:nP},()=>new Array(nP).fill(0));
    const JTr = new Array(nP).fill(0);
    for(let a=0;a<nP;a++){
      for(let b=0;b<nP;b++){ let s=0; for(let k=0;k<m;k++) s+=J[a][k]*J[b][k]; JTJ[a][b]=s; }
      let s=0; for(let k=0;k<m;k++) s+=J[a][k]*r[k]; JTr[a]=-s;
    }
    let accepted=false;
    for(let attempt=0; attempt<8 && !accepted; attempt++){
      const A = [];
      for(let a=0;a<nP;a++){ const row=JTJ[a].slice(); row[a]+=lambda*JTJ[a][a]; row.push(JTr[a]); A.push(row); }
      for(let col=0; col<nP; col++){
        let piv=col; for(let row=col+1; row<nP; row++) if(Math.abs(A[row][col])>Math.abs(A[piv][col])) piv=row;
        const tmp=A[col]; A[col]=A[piv]; A[piv]=tmp;
        if(Math.abs(A[col][col])<1e-30) continue;
        for(let row=0; row<nP; row++){
          if(row===col) continue;
          const f=A[row][col]/A[col][col];
          for(let c2=col; c2<=nP; c2++) A[row][c2]-=f*A[col][c2];
        }
      }
      const delta = A.map((row,idx)=> Math.abs(row[idx])>1e-30 ? row[nP]/row[idx] : 0);
      const trial = Object.assign({}, params);
      for(let j=0;j<nP;j++) trial[EPH_PARAM_NAMES[j]] += delta[j];
      const trialRms = Math.sqrt(residuals(trial).reduce((s,x)=>s+x*x,0)/m);
      if(trialRms < curRms){ params=trial; curRms=trialRms; lambda*=0.5; accepted=true; }
      else lambda*=3;
    }
    if(!accepted) break;
  }
  params.M0 = wrapPi(params.M0);
  params.omega = wrapPi(params.omega);
  params.Omega0 = wrapPi(params.Omega0);
  params.i0 = wrapPi(params.i0);
  return {params, fitRmsMeters: curRms};
}
