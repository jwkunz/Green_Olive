let visibleSats = []; // computed at chosen time: {prn, az, el, rangeM, dopplerHz, satPosECEF}

// ---------- compute sky view ----------
$('computeBtn').onclick = () => {
  const latDeg = parseFloat($('lat').value), lonDeg = parseFloat($('lon').value), hgt = parseFloat($('hgt').value)||0;
  const date = new Date($('dt').value);
  if(isNaN(date.getTime())){ setStatus('skyStatus','Pick a valid date/time.','err'); return; }

  const obsEcef = geodeticToEcef(latDeg, lonDeg, hgt);
  const towSec = gpsTowSeconds(date);
  const results = [];
  for(const sat of satellites){
    const ecef = satEcefPosition(sat, date);
    if(!ecef) continue; // propagation failed for this element set
    const {az, el, range} = ecefToAzEl(ecef, obsEcef, latDeg, lonDeg);
    if(el > 5){ // above horizon-ish mask
      // velocity via finite difference for doppler
      const dtSec = 1;
      const laterDate = new Date(date.getTime()+dtSec*1000);
      const ecef2 = satEcefPosition(sat, laterDate);
      if(!ecef2){ continue; }
      const rangeLater = Math.sqrt((ecef2.x-obsEcef.x)**2+(ecef2.y-obsEcef.y)**2+(ecef2.z-obsEcef.z)**2);
      const rangeRateMps = (rangeLater-range)/dtSec; // m/s, positive = receding
      const dopplerHz = -rangeRateMps/C_LIGHT*L1_FREQ;

      const ionoM = klobucharDelaySec(latDeg, lonDeg, az, el, towSec) * C_LIGHT;
      const tropoM = tropoDelayMeters(el);
      const clockBiasM = synthClockBiasMeters(sat.prn);
      const effectiveRange = range + ionoM + tropoM + clockBiasM;
      const amp = elevationGainFactor(el);

      // Broadcast-accurate ephemeris: least-squares fit of real IS-GPS-200
      // parameters against SGP4 truth around this observation time (used as toe).
      const fit = fitEphemeris(sat.satrec, date, towSec);
      const clk = fit ? synthClockParams(sat.prn, fit.params.toe, gpsWeekNumber(date)) : null;

      results.push({prn:sat.prn, az, el, range, effectiveRange, dopplerHz, rangeRateMps, ecef, ionoM, tropoM, clockBiasM, amp,
        eph: fit ? fit.params : null, fitResidualM: fit ? fit.fitRmsMeters : null, clk});
    }
  }
  results.sort((a,b)=>b.el-a.el);
  visibleSats = results;
  renderSkyPlot(results);
  renderSatTable(results);
  $('skywrap').style.display = 'flex';
  setStatus('skyStatus', results.length+' satellites above 5° elevation at selected time.', results.length? 'ok':'warn');
  $('genBtn').disabled = results.length===0;
  updateSizeEstimate();
};

function renderSkyPlot(sats){
  const cv = $('skycanvas'), ctx = cv.getContext('2d');
  const cx=160, cy=160, R=140;
  ctx.clearRect(0,0,320,320);
  ctx.strokeStyle = '#1b2b2e'; ctx.fillStyle = '#5f8577'; ctx.font='9px monospace';
  [30,60,90].forEach(el=>{
    const r = R*(90-el)/90;
    ctx.beginPath(); ctx.arc(cx,cy,r,0,2*Math.PI); ctx.stroke();
  });
  ctx.beginPath(); ctx.moveTo(cx-R,cy); ctx.lineTo(cx+R,cy);
  ctx.moveTo(cx,cy-R); ctx.lineTo(cx,cy+R); ctx.stroke();
  ctx.fillText('N',cx-4,cy-R+10); ctx.fillText('S',cx-4,cy+R-2);
  ctx.fillText('E',cx+R-10,cy+4); ctx.fillText('W',cx-R+2,cy+4);

  sats.forEach(s=>{
    const r = R*(90-s.el)/90;
    const th = (s.az-90)*DEG; // az=0 is north (up), canvas 0deg is +x(east); rotate
    const x = cx + r*Math.cos((s.az)*DEG - Math.PI/2);
    const y = cy + r*Math.sin((s.az)*DEG - Math.PI/2);
    ctx.beginPath(); ctx.arc(x,y,5,0,2*Math.PI);
    ctx.fillStyle='#3dffa0'; ctx.shadowColor='#3dffa0'; ctx.shadowBlur=6; ctx.fill(); ctx.shadowBlur=0;
    ctx.fillStyle='#c9e8db'; ctx.font='10px monospace';
    ctx.fillText(s.prn, x+7, y-6);
  });
}

function renderSatTable(sats){
  const tbody = $('satTable').querySelector('tbody');
  tbody.innerHTML = '';
  sats.forEach(s=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="prn">${s.prn}</td><td>${s.az.toFixed(1)}</td><td>${s.el.toFixed(1)}</td><td>${(s.range/1000).toFixed(0)}</td><td>${s.dopplerHz.toFixed(0)}</td><td>${s.ionoM.toFixed(1)}</td><td>${s.tropoM.toFixed(1)}</td><td>${s.clockBiasM.toFixed(0)}</td><td>${s.amp.toFixed(2)}</td><td>${s.fitResidualM!=null ? s.fitResidualM.toFixed(0) : 'n/a'}</td>`;
    tbody.appendChild(tr);
  });
}
