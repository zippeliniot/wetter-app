// js/seewasser.js — Taschensee-Karte (Seewassertemperatur Gronenberg)
// Quellen: data/live.json (15 Min), data/history.json (1x), data/months/YYYY-MM.json (on-demand)
// Kein Eingriff in bestehende Module — nur Import von showToast aus ui.js.

import { showToast } from './ui.js';

const DATA   = 'data/';
const C_SW40 = '#00C8DC';
const C_SWGR = '#66DD88';
const C_REF  = 'rgba(255,255,255,0.35)';
const C_AT   = 'rgba(255,184,48,0.8)';  // Lufttemperatur (gestrichelt)
const GRID   = 'rgba(255,255,255,0.08)';
const TICK   = 'rgba(255,255,255,0.85)';
const MONTH_SHORT = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
const DOW    = ['So','Mo','Di','Mi','Do','Fr','Sa'];
const DOY_M  = [1,32,60,91,121,152,182,213,244,274,305,335]; // DOY am Monatsersten (Nicht-Schaltjahr)
const FIRST_MONTH = '2023-06';

let history = null, live = null;
const monthCache = new Map();
let activeTab = 'aktuell', cmpSensor = 'sw40', monthCursor = null, yearCursor = null;
let chart = null, lastCfg = null, liveTimer = null;

// ---------- fetch ----------
async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}
async function loadHistory() { if (!history) history = await getJSON(DATA + 'history.json'); return history; }
async function loadLive()    { live = await getJSON(DATA + 'live.json'); return live; }
async function loadMonth(key) {
  if (monthCache.has(key)) return monthCache.get(key);
  const j = await getJSON(`${DATA}months/${key}.json`);
  monthCache.set(key, j);
  return j;
}

// ---------- helpers ----------
const pad2 = (n) => String(n).padStart(2, '0');
const ym = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
function shiftYm(key, delta) {
  let [y, m] = key.split('-').map(Number);
  m += delta;
  while (m < 1)  { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return `${y}-${pad2(m)}`;
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function monthRecords(j) {
  const ix = {};
  j.cols.forEach((c, i) => (ix[c] = i));
  const g = (row, k) => (ix[k] != null && row[ix[k]] != null ? row[ix[k]] : null);
  const rec = {};
  for (const row of j.data) {
    rec[row[0]] = {
      sw40: { min: g(row, 'sw40_min'), max: g(row, 'sw40_max'), mean: g(row, 'sw40_mean') },
      swgr: { min: g(row, 'swgr_min'), max: g(row, 'swgr_max'), mean: g(row, 'swgr_mean') },
      at:   { min: g(row, 'at_min'),   max: g(row, 'at_max'),   mean: g(row, 'at_mean') },
    };
  }
  return rec;
}
const doyToLabel = (doy) => {
  const d = new Date(2001, 0, doy);
  return `${d.getDate()}. ${MONTH_SHORT[d.getMonth()]}`;
};

// ---------- config-Bau ----------
function baseOptions(xScale, doyTooltip) {
  return {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        filter: (i) => i.dataset && i.dataset.label && !i.dataset.label.startsWith('_'),
        callbacks: {
          title: doyTooltip ? (items) => (items.length ? doyToLabel(Number(items[0].label)) : '') : undefined,
          label: (c) => ` ${c.dataset.label}: ${c.parsed.y == null ? '–' : c.parsed.y + ' °C'}`,
        },
      },
    },
    scales: {
      x: { ...xScale, bounds: 'data', offset: false },
      y: { ticks: { color: TICK, font: { size: 11 }, callback: (v) => v + '°' }, grid: { color: GRID } },
    },
    animation: { duration: 350 },
    layout: { padding: { top: 24, left: 0, right: 0 } },
  };
}
const dailyX = (maxTicks) => ({
  ticks: { color: TICK, font: { size: 11 }, autoSkip: true, maxTicksLimit: maxTicks, maxRotation: 0 },
  grid: { color: GRID },
});
const doyX = () => ({
  ticks: {
    color: TICK, font: { size: 11 }, autoSkip: false, maxRotation: 0,
    callback(v) { const doy = Number(this.getLabelForValue(v)); const i = DOY_M.indexOf(doy); return i >= 0 ? MONTH_SHORT[i] : ''; },
  },
  grid: { color: (ctx) => (DOY_M.includes(ctx.index + 1) ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0)') },
});
function line(label, data, color, extra = {}) {
  return { label, data, borderColor: color, backgroundColor: color,
    borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.3, fill: false, spanGaps: true, ...extra };
}
function band(hi, lo, color) {
  return [
    { label: '_max', data: hi, borderColor: 'transparent', borderWidth: 0, pointRadius: 0, fill: false, tension: 0.3, spanGaps: true },
    { label: '_min', data: lo, borderColor: 'transparent', borderWidth: 0, pointRadius: 0, fill: '-1', backgroundColor: hexA(color, 0.10), tension: 0.3, spanGaps: true },
  ];
}
// Lufttemperatur: gestrichelte duenne Linie. data ggf. leer (history.json hat noch kein "at").
function atLine(data) {
  return {
    label: 'Luft', data, borderColor: C_AT, backgroundColor: C_AT,
    borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, pointHoverRadius: 3,
    tension: 0.3, fill: false, spanGaps: true,
  };
}
// at-Tagesmittel aus den (bereits geladenen) Monats-Records fuer eine Datums-Reihe.
function getAtData(dates, recs) {
  return dates.map((dt) => {
    const r = (recs[ym(dt)] || {})[dt.getDate()];
    return r && r.at ? r.at.mean : null;
  });
}

async function cfgDailyWindow(nDays, withBand) {
  const today = new Date();
  const recs = {};
  for (const k of new Set([ym(today), shiftYm(ym(today), -1), shiftYm(ym(today), -2)])) {
    try { recs[k] = monthRecords(await loadMonth(k)); } catch (e) { /* Monat evtl. noch nicht da */ }
  }
  // Tagesmittel der letzten nDays Tage (heute = letzter Punkt, i=0)
  const dates = [], labels = [], sw40m = [], swgrm = [], lo = [], hi = [];
  for (let i = nDays - 1; i >= 0; i--) {
    const dt = new Date(today); dt.setDate(today.getDate() - i);
    const r = (recs[ym(dt)] || {})[dt.getDate()];
    dates.push(dt);
    labels.push(`${DOW[dt.getDay()]} ${dt.getDate()}.${dt.getMonth() + 1}.`);
    sw40m.push(r ? r.sw40.mean : null);
    swgrm.push(r ? r.swgr.mean : null);
    lo.push(r ? r.sw40.min : null);
    hi.push(r ? r.sw40.max : null);
  }
  // Luft: Tagesmittel aus Monatsdateien fuer vergangene Tage, letzter Punkt (heute) = live.at
  const atData = getAtData(dates, recs);
  if (live && live.at != null) atData[atData.length - 1] = live.at;
  const ds = [];
  if (withBand) ds.push(...band(hi, lo, C_SW40));
  ds.push(line('Taschensee 40 cm', sw40m, C_SW40, withBand ? {} : { fill: true, backgroundColor: hexA(C_SW40, 0.10) }));
  ds.push(line('Grund', swgrm, C_SWGR));
  ds.push(atLine(atData));
  return { type: 'line', data: { labels, datasets: ds }, options: baseOptions(dailyX(nDays), false) };
}

async function cfgMonat() {
  const rec = monthRecords(await loadMonth(monthCursor));
  const [y, m] = monthCursor.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  const labels = [], sw40m = [], swgrm = [], atm = [], lo = [], hi = [];
  for (let d = 1; d <= dim; d++) {
    const r = rec[d];
    labels.push(String(d));
    sw40m.push(r ? r.sw40.mean : null);
    swgrm.push(r ? r.swgr.mean : null);
    atm.push(r && r.at ? r.at.mean : null);
    lo.push(r ? r.sw40.min : null);
    hi.push(r ? r.sw40.max : null);
  }
  const ds = [...band(hi, lo, C_SW40), line('Taschensee 40 cm', sw40m, C_SW40), line('Grund', swgrm, C_SWGR), atLine(atm)];
  return { type: 'line', data: { labels, datasets: ds }, options: baseOptions(dailyX(10), false) };
}

// Verfuegbare Jahre (mit Daten) — Basis sw40, sortiert aufsteigend.
function swYears() {
  const y = (history && history.years && history.years.sw40) ? Object.keys(history.years.sw40) : [];
  return y.slice().sort();
}
// yearCursor auf ein Jahr mit Daten klemmen (Fallback: letztes verfuegbares / aktuelles Jahr).
function resolveYear() {
  const years = swYears();
  if (years.includes(yearCursor)) return yearCursor;
  return years.length ? years[years.length - 1] : String(new Date().getFullYear());
}

async function cfgJahr(year) {
  await loadHistory();
  const yr = String(year || resolveYear());
  yearCursor = yr;
  const labels = Array.from({ length: 365 }, (_, i) => i + 1);
  const ds = [
    line(`Taschensee 40 cm ${yr}`, (history.years.sw40 && history.years.sw40[yr]) || [], C_SW40),
    line(`Grund ${yr}`, (history.years.swgr && history.years.swgr[yr]) || [], C_SWGR),
    atLine((history.years.at && history.years.at[yr]) || []),
    line('Referenz', history.ref || [], C_REF, { borderWidth: 1.5, borderDash: [5, 4] }),
  ];
  return { type: 'line', data: { labels, datasets: ds }, options: baseOptions(doyX(), true) };
}

async function cfgVergleich() {
  await loadHistory();
  const years = history.years[cmpSensor] || {};
  const keys = Object.keys(years).sort();
  const labels = Array.from({ length: 365 }, (_, i) => i + 1);
  const rgb = cmpSensor === 'sw40' ? [0, 200, 220] : [102, 221, 136];
  const ds = keys.map((k, i) => {
    const t = keys.length > 1 ? i / (keys.length - 1) : 1;
    return line(k, years[k], `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(0.30 + 0.65 * t).toFixed(2)})`,
      { borderWidth: i === keys.length - 1 ? 2.5 : 1.4 });
  });
  ds.push(atLine((history.years.at && history.years.at[String(new Date().getFullYear())]) || []));
  ds.push(line('Referenz', history.ref || [], C_REF, { borderWidth: 1.5, borderDash: [5, 4] }));
  return { type: 'line', data: { labels, datasets: ds }, options: baseOptions(doyX(), true) };
}

// ---------- render ----------
function buildConfig() {
  if (activeTab === 'woche')     return cfgDailyWindow(7, true);
  if (activeTab === 'monat')     return cfgMonat();
  if (activeTab === 'jahr')      return cfgJahr(yearCursor);
  if (activeTab === 'vergleich') return cfgVergleich();
  return cfgDailyWindow(3, false); // aktuell — letzte 3 Tage Tagesmittel
}

function renderSubctrl() {
  const el = document.getElementById('sw-subctrl');
  if (!el) return;
  if (activeTab === 'monat') {
    const [y, m] = monthCursor.split('-').map(Number);
    const prevOff = monthCursor <= FIRST_MONTH ? 'disabled' : '';
    const nextOff = monthCursor >= ym(new Date()) ? 'disabled' : '';
    el.innerHTML = `<button ${prevOff} onclick="window.swMonth(-1)">‹</button>`
      + `<span>${MONTH_SHORT[m - 1]} ${y}</span>`
      + `<button ${nextOff} onclick="window.swMonth(1)">›</button>`;
  } else if (activeTab === 'jahr') {
    const years = swYears();
    const yr = resolveYear();
    yearCursor = yr;
    const i = years.indexOf(yr);
    const prevOff = i <= 0 ? 'disabled' : '';
    const nextOff = i < 0 || i >= years.length - 1 ? 'disabled' : '';
    el.innerHTML = `<button ${prevOff} onclick="window.swYearDelta(-1)">‹</button>`
      + `<span>${yr}</span>`
      + `<button ${nextOff} onclick="window.swYearDelta(1)">›</button>`;
  } else if (activeTab === 'vergleich') {
    const b = (k, l) => `<button onclick="window.swCmp('${k}')" style="${k === cmpSensor ? 'background:rgba(255,255,255,0.22);' : ''}">${l}</button>`;
    el.innerHTML = b('sw40', '40 cm') + b('swgr', 'Grund');
  } else {
    // aktuell: Luft+Feuchte steht bereits in #sw-current (updateHeader)
    el.innerHTML = '';
  }
}

async function render() {
  renderSubctrl();
  let cfg;
  try { cfg = await buildConfig(); }
  catch (e) { console.error('[seewasser]', e); showToast('Taschensee-Daten nicht verfügbar.'); return; }
  const canvas = document.getElementById('sw-chart');
  if (!canvas) return;
  if (chart) chart.destroy();
  chart = new Chart(canvas, cfg);
  lastCfg = cfg;
}

function updateHeader() {
  const el = document.getElementById('sw-current');
  if (!el || !live) return;
  const p = [];
  if (live.sw40 != null) p.push(`<span style="color:#00C8DC">${live.sw40}°</span>`);
  if (live.swgr != null) p.push(`<span style="color:#66DD88">${live.swgr}°</span>`);
  if (live.at != null) {
    const ah = live.ah != null ? ` ${live.ah}%` : '';
    p.push(`<span style="color:rgba(255,184,48,0.9)">${live.at}°${ah}</span>`);
  }
  el.innerHTML = p.join(' · ');
}

async function refreshLive() {
  try { await loadLive(); updateHeader(); if (activeTab === 'aktuell') render(); }
  catch (e) { console.warn('[seewasser] live.json:', e); }
}
export { refreshLive };

// ---------- window-Handler (Projekt-Stil) ----------
window.swSetTab = (tab) => {
  if (tab === activeTab) return;
  activeTab = tab;
  document.querySelectorAll('#taschensee-card .sw-tabs .range-btn')
    .forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  render();
};
window.swMonth = (delta) => {
  const nx = shiftYm(monthCursor, delta);
  if (nx < FIRST_MONTH || nx > ym(new Date())) return;
  monthCursor = nx;
  render();
};
window.swYearDelta = (delta) => {
  const years = swYears();
  if (!years.length) return;
  let i = years.indexOf(yearCursor);
  if (i < 0) i = years.length - 1;
  const ni = i + delta;
  if (ni < 0 || ni >= years.length) return;
  yearCursor = years[ni];
  render();
};
window.swCmp = (k) => { if (k !== cmpSensor) { cmpSensor = k; render(); } };

// ---------- Fullscreen (nutzt bestehendes #fs-modal via main.js) ----------
export function getFSConfig() {
  if (!lastCfg) return null;
  const data = (typeof structuredClone === 'function')
    ? structuredClone(lastCfg.data)
    : JSON.parse(JSON.stringify(lastCfg.data));
  return {
    type: lastCfg.type,
    data,
    options: { ...lastCfg.options, plugins: { ...lastCfg.options.plugins }, scales: { ...lastCfg.options.scales } },
  };
}

// ---------- init (aus main.js aufgerufen) ----------
export async function initSeewasser() {
  monthCursor = ym(new Date());
  yearCursor = String(new Date().getFullYear());
  loadHistory().catch((e) => console.warn('[seewasser] history.json:', e));
  await refreshLive();
  render();
  if (liveTimer) clearInterval(liveTimer);
  liveTimer = setInterval(refreshLive, 15 * 60 * 1000);
}
