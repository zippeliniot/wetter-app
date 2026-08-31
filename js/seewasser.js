// js/seewasser.js — Taschensee-Karte (Seewassertemperatur Gronenberg)
// Quellen: data/live.json (15 Min), data/hours.json (72h stuendlich, 15 Min),
//          data/history.json (1x), data/months/YYYY-MM.json (on-demand)
// Kein Eingriff in bestehende Module — nur Import von showToast aus ui.js.

import { showToast } from './ui.js';

const DATA   = 'data/';
const C_SW40 = '#00C8DC';
const C_SWGR = '#66DD88';
const C_REF  = 'rgba(255,255,255,0.35)';
const C_AT_FILL = 'rgba(255,184,48,0.13)';  // Luft-Band Minimum..Maximum
const C_AT_BND  = 'rgba(255,184,48,0.55)';  // Luft Min/Max Begrenzungslinien (gestrichelt)
const C_AT_AVG  = 'rgba(255,184,48,0.40)';  // Luft Ø (dezente Mittellinie)
const GRID   = 'rgba(255,255,255,0.08)';
const TICK   = 'rgba(255,255,255,0.85)';
const MONTH_SHORT = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
const DOW    = ['So','Mo','Di','Mi','Do','Fr','Sa'];
const DOY_M  = [1,32,60,91,121,152,182,213,244,274,305,335]; // DOY am Monatsersten (Nicht-Schaltjahr)
const FIRST_MONTH = '2023-06';

let history = null, live = null, hoursData = null;
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
async function loadHours()   { hoursData = await getJSON(DATA + 'hours.json'); return hoursData; }
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
    layout: { padding: { top: 12, left: 0, right: 0 } },
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
// Stunden-Achse: Labels sind ISO-Strings ("2026-08-28T08:00Z"). Anzeige in Lokalzeit,
// "HH:00"; um Mitternacht zweizeilig "00:00 / DD.MM.". Gitterlinie an Mitternacht heller.
const hourDate = (labels, i) => {
  const d = new Date(labels && labels[i]);
  return Number.isNaN(d.getTime()) ? null : d;
};
const dailyHourX = (maxTicks, labels) => ({
  ticks: {
    color: TICK, font: { size: 11 }, autoSkip: true, maxTicksLimit: maxTicks, maxRotation: 0,
    callback(v) {
      const d = hourDate(labels, v);
      if (!d) return '';
      if (labels && v === labels.length - 1) return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; // "jetzt"
      return d.getHours() === 0
        ? [`${pad2(0)}:00`, `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.`]
        : `${pad2(d.getHours())}:00`;
    },
  },
  grid: {
    color: (ctx) => {
      const d = hourDate(labels, ctx.index);
      return d && d.getHours() === 0 ? 'rgba(255,255,255,0.20)' : GRID;
    },
  },
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
// Lufttemperatur als Band: halbtransparente Fuellung Min..Max, orange gestrichelte
// Begrenzungslinien (Luft min./Luft max.) und dezente Ø-Mittellinie (Luft Ø, optional).
// minA/maxA/avgA sind gleich lang wie labels; avgA darf fehlen/leer sein.
// opts (z.B. { tension: 0 }) fuer stufige Monats-/Jahresansichten.
function atBand(minA, maxA, avgA, opts = {}) {
  const base = { pointRadius: 0, fill: false, tension: 0.3, spanGaps: true, ...opts };
  const ds = [
    { ...base, label: '_atmax', data: maxA, borderColor: 'transparent', borderWidth: 0 },
    { ...base, label: '_atmin', data: minA, borderColor: 'transparent', borderWidth: 0,
      fill: '-1', backgroundColor: C_AT_FILL },
    { ...base, label: 'Luft max.', data: maxA, borderColor: C_AT_BND, backgroundColor: C_AT_BND,
      borderWidth: 1, borderDash: [4, 4], pointHoverRadius: 3 },
    { ...base, label: 'Luft min.', data: minA, borderColor: C_AT_BND, backgroundColor: C_AT_BND,
      borderWidth: 1, borderDash: [4, 4], pointHoverRadius: 3 },
  ];
  if (avgA && avgA.some((v) => v != null)) {
    ds.push({ ...base, label: 'Luft Ø', data: avgA, borderColor: C_AT_AVG, backgroundColor: C_AT_AVG,
      borderWidth: 1, borderDash: [1, 3], pointHoverRadius: 3 });
  }
  return ds;
}
// Luft-Min/Max/Ø aus den (bereits geladenen) Monats-Records fuer eine Datums-Reihe.
function getAtSeries(dates, recs) {
  const min = [], max = [], avg = [];
  for (const dt of dates) {
    const a = ((recs[ym(dt)] || {})[dt.getDate()] || {}).at || null;
    min.push(a ? a.min : null);
    max.push(a ? a.max : null);
    avg.push(a ? a.mean : null);
  }
  return { min, max, avg };
}
// 12 Monatswerte -> 365-DOY-Array, Wert ueber den ganzen Monat konstant (Stufen).
function monthlyToDoy(arr12) {
  const out = new Array(365).fill(null);
  if (!arr12) return out;
  for (let m = 0; m < 12; m++) {
    if (arr12[m] == null) continue;
    const end = m < 11 ? DOY_M[m + 1] - 1 : 365;
    for (let d = DOY_M[m] - 1; d < end; d++) out[d] = arr12[m];
  }
  return out;
}

// Stundengrafik aus data/hours.json — rangeh = 24 (1 Tag) oder 72 (3 Tage).
async function cfgHours(rangeh) {
  if (!hoursData) { try { await loadHours(); } catch (e) { /* Datei evtl. noch nicht da */ } }
  const rows = ((hoursData && hoursData.hours) || []).slice(-rangeh);

  // ISO-Labels der Stundenpunkte + aktueller Zeitpunkt als zusaetzlicher letzter Punkt
  const labels = rows.map((r) => r.t);
  labels.push(new Date().toISOString());

  const sw40Data = rows.map((r) => r.sw40);
  const swgrData = rows.map((r) => r.swgr);
  const atAvg = rows.map((r) => r.at);
  const atMin = rows.map((r) => (r.at_min != null ? r.at_min : r.at));
  const atMax = rows.map((r) => (r.at_max != null ? r.at_max : r.at));
  // Momentanwerte aus live.json anhaengen (null wenn Sensor offline -> spanGaps ueberbrueckt)
  const lv = live && live.at != null ? live.at : null;
  sw40Data.push(live && live.sw40 != null ? live.sw40 : null);
  swgrData.push(live && live.swgr != null ? live.swgr : null);
  atAvg.push(lv); atMin.push(lv); atMax.push(lv);

  const ds = [
    line('40 cm', sw40Data, C_SW40),
    line('Grund', swgrData, C_SWGR),
    ...atBand(atMin, atMax, atAvg),
  ];
  const opt = baseOptions(dailyHourX(rangeh <= 24 ? 12 : 8, labels), false);
  opt.plugins.tooltip.callbacks.title = (items) => {
    if (!items.length) return '';
    const d = new Date(items[0].label);
    if (Number.isNaN(d.getTime())) return items[0].label;
    return `${DOW[d.getDay()]} ${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}. ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };
  return { type: 'line', data: { labels, datasets: ds }, options: opt };
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
  // Live-Fallback fuer heute (letzter Punkt)
  // sw40/swgr aus live.json wenn Monatsdatei noch keinen heutigen Wert hat
  if (live) {
    const last = sw40m.length - 1;
    if (sw40m[last] == null && live.sw40 != null) sw40m[last] = live.sw40;
    if (swgrm[last] == null && live.swgr != null) swgrm[last] = live.swgr;
    // Band (hi/lo) auch fuellen wenn leer
    if (lo[last] == null && live.sw40 != null) { lo[last] = live.sw40; hi[last] = live.sw40; }
  }
  // Luft Min/Max/Ø aus Monatsdateien; letzter Punkt (heute) ggf. aus live.json
  const at = getAtSeries(dates, recs);
  if (live && live.at != null) {
    const L = at.avg.length - 1;
    if (at.min[L] == null) at.min[L] = live.at;
    if (at.max[L] == null) at.max[L] = live.at;
    at.avg[L] = live.at;
  }
  const ds = [];
  if (withBand) ds.push(...band(hi, lo, C_SW40));
  ds.push(line('40 cm', sw40m, C_SW40, withBand ? {} : { fill: true, backgroundColor: hexA(C_SW40, 0.10) }));
  ds.push(line('Grund', swgrm, C_SWGR));
  ds.push(...atBand(at.min, at.max, at.avg));
  return { type: 'line', data: { labels, datasets: ds }, options: baseOptions(dailyX(nDays), false) };
}

async function cfgMonat() {
  const rec = monthRecords(await loadMonth(monthCursor));
  const [y, m] = monthCursor.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  const labels = [], sw40m = [], swgrm = [], atMin = [], atMax = [], atAvg = [], lo = [], hi = [];
  for (let d = 1; d <= dim; d++) {
    const r = rec[d];
    labels.push(String(d));
    sw40m.push(r ? r.sw40.mean : null);
    swgrm.push(r ? r.swgr.mean : null);
    atMin.push(r && r.at ? r.at.min : null);
    atMax.push(r && r.at ? r.at.max : null);
    atAvg.push(r && r.at ? r.at.mean : null);
    lo.push(r ? r.sw40.min : null);
    hi.push(r ? r.sw40.max : null);
  }
  const ds = [...band(hi, lo, C_SW40), line('40 cm', sw40m, C_SW40), line('Grund', swgrm, C_SWGR),
    ...atBand(atMin, atMax, atAvg)];
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
  const mm = (history.at_monthly && history.at_monthly[yr]) || null;
  const ds = [
    line(`Taschensee 40 cm ${yr}`, (history.years.sw40 && history.years.sw40[yr]) || [], C_SW40),
    line(`Grund ${yr}`, (history.years.swgr && history.years.swgr[yr]) || [], C_SWGR),
  ];
  if (mm) ds.push(...atBand(monthlyToDoy(mm.min), monthlyToDoy(mm.max), monthlyToDoy(mm.avg), { tension: 0 }));
  ds.push(line('Referenz', history.ref || [], C_REF, { borderWidth: 1.5, borderDash: [5, 4] }));
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
  const cy = String(new Date().getFullYear());
  const mmv = (history.at_monthly && history.at_monthly[cy]) || null;
  if (mmv) ds.push(...atBand(monthlyToDoy(mmv.min), monthlyToDoy(mmv.max), monthlyToDoy(mmv.avg), { tension: 0 }));
  ds.push(line('Referenz', history.ref || [], C_REF, { borderWidth: 1.5, borderDash: [5, 4] }));
  return { type: 'line', data: { labels, datasets: ds }, options: baseOptions(doyX(), true) };
}

// ---------- render ----------
function buildConfig() {
  if (activeTab === 'woche')     return cfgDailyWindow(7, true);
  if (activeTab === 'monat')     return cfgMonat();
  if (activeTab === 'jahr')      return cfgJahr(yearCursor);
  if (activeTab === 'vergleich') return cfgVergleich();
  // aktuell: Stundengrafik — 1 Tag = 24 h, 3 Tage = 72 h
  return cfgHours(window._swRange === 3 ? 72 : 24);
}

function swChartWrap() { return document.querySelector('#taschensee-card .chart-wrapper'); }

// Info-Text unter dem Chart (einmalig direkt nach .chart-wrapper eingefuegt).
function ensureInfoText() {
  if (document.getElementById('sw-info')) return;
  const wrap = swChartWrap();
  if (!wrap || !wrap.parentNode) return;
  const p = document.createElement('p');
  p.id = 'sw-info';
  p.style.cssText = 'font-size:0.75rem;opacity:0.6;margin-top:8px;line-height:1.5;padding:0 4px;';
  p.textContent =
    'Seewassertemperatur Taschensee Gronenberg. '
    + 'Sensor 40 cm: Tiefe 40 cm unter Wasseroberfläche. '
    + 'Sensor Grund: Bodennahe Messung. '
    + 'Luft: Aussentemperatur Messstation Gronenberg. '
    + 'Aktuell/1Tag: Stundenwerte letzte 24h. '
    + '3Tage: Stundenwerte letzte 72h. '
    + 'Woche: Tagesmittel letzte 7 Tage. '
    + 'Monat/Jahr/Vergleich: Historische Tagesmittel seit 2023. '
    + 'Luft: Band = Minimum–Maximum je Intervall (Stunde/Tag/Monat), Linie = Durchschnitt.';
  wrap.parentNode.insertBefore(p, wrap.nextSibling);
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
  const wrap = swChartWrap();
  const nowEl = document.getElementById('sw-now');
  // Chart immer anzeigen; das alte #sw-now (Sofortanzeige) wird nicht mehr genutzt.
  if (wrap) wrap.style.display = '';
  if (nowEl) nowEl.style.display = 'none';

  let cfg;
  try { cfg = await buildConfig(); }
  catch (e) { console.error('[seewasser]', e); showToast('Taschensee-Daten nicht verfügbar.'); return; }
  const canvas = document.getElementById('sw-chart');
  if (!canvas) return;
  if (chart) chart.destroy();
  chart = new Chart(canvas, cfg);
  lastCfg = cfg;
}

// Alter (Minuten) -> Kurz-Suffix fuer die Kopfzeile. Leer wenn frisch (<60 Min).
function fmtAge(age) {
  if (age == null || age < 60) return '';
  if (age < 120) return ' (1h)';
  return ` (${Math.round(age / 60)}h)`;
}

function updateHeader() {
  const el = document.getElementById('sw-current');
  if (!el || !live) return;
  const p = [];
  if (live.sw40 != null) {
    const dim = live.sw40_age != null && live.sw40_age > 60;
    const col = dim ? 'rgba(0,200,220,0.40)' : '#00C8DC';
    p.push(`<span style="color:${col}">${live.sw40}°${fmtAge(live.sw40_age)}</span>`);
  }
  if (live.swgr != null) {
    const dim = live.swgr_age != null && live.swgr_age > 60;
    const col = dim ? 'rgba(102,221,136,0.40)' : '#66DD88';
    p.push(`<span style="color:${col}">${live.swgr}°${fmtAge(live.swgr_age)}</span>`);
  }
  if (live.at != null) {
    const ah = live.ah != null ? ` ${live.ah}%` : '';
    p.push(`<span style="color:rgba(255,184,48,0.9)">${live.at}°${ah}</span>`);
  }
  el.innerHTML = p.join(' · ');
}

async function refreshLive() {
  try { await loadLive(); updateHeader(); }
  catch (e) { console.warn('[seewasser] live.json:', e); }
  try { await loadHours(); }
  catch (e) { console.warn('[seewasser] hours.json:', e); }
  if (activeTab === 'aktuell') render();
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

// ---------- Range-Schalter (1 Tag / 3 Tage) aus main.js mitnutzen ----------
function hookRange() {
  if (window._swRangeHooked) return;
  window._swRangeHooked = true;
  window._swRange = window._swRange || 1;
  const orig = window.setRange;
  window.setRange = (n) => {
    window._swRange = n;
    if (typeof orig === 'function') orig(n);
    if (activeTab === 'aktuell') render();
  };
}

// ---------- init (aus main.js aufgerufen) ----------
export async function initSeewasser() {
  monthCursor = ym(new Date());
  yearCursor = String(new Date().getFullYear());
  window._swRange = 1;
  hookRange();
  ensureInfoText();
  loadHistory().catch((e) => console.warn('[seewasser] history.json:', e));
  loadHours().catch((e) => console.warn('[seewasser] hours.json:', e));
  await refreshLive();
  render();
  if (liveTimer) clearInterval(liveTimer);
  liveTimer = setInterval(refreshLive, 15 * 60 * 1000);
}
