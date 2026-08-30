// js/blitz.js — Blitzsituation-Karte (reine Info-Anzeige aus data/live.json, kein Chart)

const DATA = 'data/';
let live = null, timer = null;

async function load() {
  const r = await fetch(DATA + 'live.json', { cache: 'no-store' });
  if (!r.ok) throw new Error(`live.json -> HTTP ${r.status}`);
  return r.json();
}
const fmtDist = (km) => (km == null ? '–' : km < 1 ? '< 1 km' : `${Math.round(km)} km`);
function fmtTime(v) {
  if (v == null) return '–';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function render() {
  const box = document.getElementById('blitz-body');
  if (!box) return;
  if (!live) { box.innerHTML = '<div class="bz-empty">Wird geladen …</div>'; return; }
  const { bld, blt, bln } = live;
  if (bld == null && blt == null && !(bln > 0)) {
    box.innerHTML = '<div class="bz-empty">Kein Blitz in letzter Zeit</div>';
    return;
  }
  const rows = [
    ['Entfernung', fmtDist(bld)],
    ['Letzter Blitz', fmtTime(blt)],
    ['Blitze heute', bln != null ? String(bln) : '–'],
  ];
  box.innerHTML = rows.map(([k, v]) =>
    `<div class="bz-row"><span class="bz-k">${k}</span><span class="bz-v">${v}</span></div>`).join('');
}

export async function refresh() {
  try { live = await load(); render(); }
  catch (e) { console.warn('[blitz] live.json:', e); }
}

export async function initBlitz() {
  render();
  await refresh();
  if (timer) clearInterval(timer);
  timer = setInterval(refresh, 15 * 60 * 1000);
}
