// ---------- TLE / almanac state and UI wiring ----------
let satellites = []; // parsed TLE elements

function setNowDefault(){
  const now = new Date();
  now.setMinutes(now.getMinutes()-now.getTimezoneOffset());
  $('dt').value = now.toISOString().slice(0,16);
}
setNowDefault();
$('nowBtn').onclick = setNowDefault;

$('geoBtn').onclick = () => {
  if(!navigator.geolocation){ setStatus('almanacStatus','Geolocation not available in this browser.','err'); return; }
  navigator.geolocation.getCurrentPosition(pos=>{
    $('lat').value = pos.coords.latitude.toFixed(5);
    $('lon').value = pos.coords.longitude.toFixed(5);
  }, err=>{ setStatus('almanacStatus','Location permission denied.','err'); });
};

// ---------- TLE fetch & parse ----------
$('almanacBtn').onclick = async () => {
  setStatus('almanacStatus','Fetching live GPS almanac from celestrak.org ...');
  $('manualNote').style.display='none';
  try{
    const url = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tle';
    const resp = await fetch(url);
    if(!resp.ok) throw new Error('HTTP '+resp.status);
    const text = await resp.text();
    parseTleBlock(text);
  }catch(e){
    setStatus('almanacStatus','Live fetch blocked: '+e.message,'err');
    $('manualNote').style.display='block';
  }
};

$('manualBtn').onclick = () => {
  const text = $('manualTle').value;
  if(!text.trim()){ setStatus('almanacStatus','Paste TLE text first.','err'); return; }
  parseTleBlock(text);
};

function parseTleBlock(text){
  if(typeof satellite === 'undefined'){
    setStatus('almanacStatus','satellite.js failed to load from CDN (check network/ad-blocker).','err');
    return;
  }
  const lines = text.split('\n').map(l=>l.replace('\r','')).filter(l=>l.trim().length>0);
  const sats = [];
  for(let i=0;i<lines.length-1;i++){
    if(lines[i].startsWith('1 ') && lines[i+1] && lines[i+1].startsWith('2 ')){
      const l1 = lines[i], l2 = lines[i+1];
      let name = 'PRN?';
      if(i>0 && !lines[i-1].startsWith('1 ') && !lines[i-1].startsWith('2 ')) name = lines[i-1].trim();
      try{
        const satrec = satellite.twoline2satrec(l1, l2);
        if(!satrec) continue;
        let prnMatch = name.match(/PRN\s*(\d+)/i);
        const noradId = parseInt(l1.substring(2,7),10);
        const prn = prnMatch ? parseInt(prnMatch[1],10) : noradId;
        sats.push({name, prn, satrec});
      }catch(err){ /* skip malformed entry */ }
    }
  }
  if(sats.length===0){ setStatus('almanacStatus','No valid TLE entries found in that data.','err'); return; }
  satellites = sats;
  setStatus('almanacStatus', 'Loaded '+sats.length+' GPS satellites (SGP4/SDP4 via satellite.js). Ready to compute sky view.', 'ok');
  $('computeBtn').disabled = false;
}
