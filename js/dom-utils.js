// ---------- DOM helpers (small utilities shared across all app modules) ----------
const $ = id => document.getElementById(id);

function setStatus(id,msg,cls){
  const el = $(id);
  el.textContent = msg;
  el.className = 'status' + (cls?(' '+cls):'');
}
