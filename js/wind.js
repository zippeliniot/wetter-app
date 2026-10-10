// js/wind.js — Wind-Karte (Forecast-Balken + gemessene Boeen-Historie Gronenberg)
// Quellen: Forecast-Daten aus main.js (setForecast), data/live.json (wind_gust_max),
//          data/months/YYYY-MM.json (wind_gust_max_max), data/history.json (wind_gust_max_monthly)
// Aufbau analog seewasser.js. Historie-Tabs gibt es nur fuer Gronenberg (einziger GW2000A-Standort).

import { showToast } from './ui.js';
import * as charts from './charts.js';

const DATA = 'data/';
const C_WIND = '#38bdf8';
const C_MAXLINE = 'rgba(255,255,255,0.55)';
const GRID = 'rgba(255,255,255,0.08)';
const TICK = 'rgba(255,255,255,0.85)';
const MONTH_SHORT = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
const DOW = ['So','Mo','Di','Mi','Do','Fr','Sa'];
const FIRST_MONTH = '2023-06';
const GR_IDX = 1; // Gronenberg in CITIES
const CMP_PALETTE = ['#00C8DC', '#FFB830', '#c084fc', '#fb7185', '#4ade80', '#38bdf8', '#facc15', '#f472b6', '#a3e635', '#fb923c', '#818cf8', '#2dd4bf'];

let history = null, live = null;
const monthCache = new Map();
let activeTab = 'aktuell', monthCursor = null, yearCursor = null;
let chart = null, liveTimer = null, monthEmpty = false;
let cmpHiddenYears = null; // null = noch nicht initialisiert (Standard: aeltere als die letzten 3 ausgeblendet)
// Forecast-Kontext aus main.js (Stadt-/Range-abhaengig)
let fc = { data: null, range: 1, cityIdx: GR_IDX, cities: null };

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
const liveGust = () => (live && live.wind_gust_max != null ? live.wind_gust_max : null);
// { tag: Tagesmax Boe } aus einer Monatsdatei
function monthRecords(j) {
  const ix = j.cols.indexOf('wind_gust_max_max');
  const rec = {};
  if (ix < 0) return rec;
  for (const row of j.data) if (row[ix] != null) rec[row[0]] = row[ix];
  return rec;
}
const isGronenberg = () => fc.cityIdx === GR_IDX;

// ---------- config-Bau ----------
function baseOptions(xTicks) {
  return {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        filter: (i) => i.dataset && i.dataset.label && !i.dataset.label.startsWith('_') && i.parsed.y != null,
        callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.y == null ? '–' : c.parsed.y + ' km/h'}` },
      },
    },
    scales: {
      x: { ticks: { color: TICK, font: { size: 11 }, autoSkip: true, maxTicksLimit: xTicks, maxRotation: 0 }, grid: { color: GRID } },
      y: { beginAtZero: true, ticks: { color: TICK, font: { size: 11 } }, grid: { color: GRID } },
    },
    animation: { duration: 350 },
    layout: { padding: { top: 12, left: 0, right: 0 } },
  };
}
function line(label, data, color, extra = {}) {
  return { label, data, borderColor: color, backgroundColor: color, borderWidth: 2,
    pointRadius: 3, pointHoverRadius: 5, tension: 0, fill: false, spanGaps: true, ...extra };
}

// Aktuell: bestehender Forecast-Balkenchart + pro Kalendertag eine Tages-Max-Linie.
function cfgAktuell() {
  if (!fc.data) return null;
  const cfg = charts.getWindChartConfig(fc.data, fc.range, fc.cities, 'wind-chart', fc.cityIdx);
  if (!cfg) return null;
  const labels = cfg.data.labels;
  const refData = fc.data[Math.min(fc.cityIdx, fc.data.length - 1)] ?? fc.data.find((d) => d != null);
  const hTime = refData.hourly.time, hWind = refData.hourly.wind_speed_10m;
  const todayKey = ym(new Date()) + '-' + pad2(new Date().getDate());

  // Label-Indizes je Kalendertag (Label = "YYYY-MM-DDTHH:MM")
  const days = new Map();
  labels.forEach((l, i) => {
    const k = String(l).slice(0, 10);
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(i);
  });
  const lines = [];
  for (const [k, idxs] of days) {
    let val = null, measured = false;
    if (k === todayKey) {
      val = liveGust(); measured = val != null;
    } else {
      for (let i = 0; i < hTime.length; i++) {
        if (String(hTime[i]).slice(0, 10) !== k || hWind[i] == null) continue;
        val = val == null ? hWind[i] : Math.max(val, hWind[i]);
      }
    }
    if (val == null) continue;
    const v = Math.round(val);
    const data = new Array(labels.length).fill(null);
    idxs.forEach((i) => { data[i] = v; });
    lines.push({
      type: 'line', label: 'Tagesmax', data, _src: measured ? 'gemessen' : 'Vorhersage',
      borderColor: C_MAXLINE, backgroundColor: C_MAXLINE, borderWidth: 1.2, borderDash: [4, 4],
      pointRadius: 0, pointHoverRadius: 0, stepped: true, fill: false, spanGaps: false, order: 0,
    });
  }
  cfg.data.datasets.push(...lines);
  const tt = cfg.options.plugins.tooltip;
  const barLabel = tt.callbacks.label;
  tt.filter = (i) => i.parsed.y != null;
  tt.callbacks.label = (c) => (c.dataset.type === 'line'
    ? ` Tagesmax: ${c.parsed.y} km/h (${c.dataset._src})` : barLabel(c));
  return cfg;
}

// Letzte nDays Tage: Tagesmaxima aus Monatsdateien, heute mit live.json nachgezogen.
async function cfgWoche(nDays) {
  const today = new Date();
  const recs = {};
  for (const k of new Set([ym(today), shiftYm(ym(today), -1)])) {
    try { recs[k] = monthRecords(await loadMonth(k)); } catch (e) { /* Monat evtl. noch nicht da */ }
  }
  const labels = [], vals = [];
  for (let i = nDays - 1; i >= 0; i--) {
    const dt = new Date(today); dt.setDate(today.getDate() - i);
    labels.push(`${DOW[dt.getDay()]} ${dt.getDate()}.${dt.getMonth() + 1}.`);
    let v = (recs[ym(dt)] || {})[dt.getDate()] ?? null;
    if (i === 0 && liveGust() != null && (v == null || liveGust() > v)) v = liveGust();
    vals.push(v);
  }
  return { type: 'line', data: { labels, datasets: [line('Tagesmax Böe', vals, C_WIND)] }, options: baseOptions(nDays) };
}

async function cfgMonat() {
  let rec = {};
  try { rec = monthRecords(await loadMonth(monthCursor)); } catch (e) { /* Datei fehlt */ }
  const [y, m] = monthCursor.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  const labels = [], vals = [];
  for (let d = 1; d <= dim; d++) { labels.push(String(d)); vals.push(rec[d] ?? null); }
  if (monthCursor === ym(new Date()) && liveGust() != null) {
    const i = new Date().getDate() - 1;
    if (vals[i] == null || liveGust() > vals[i]) vals[i] = liveGust();
  }
  monthEmpty = !vals.some((v) => v != null);
  return { type: 'line', data: { labels, datasets: [line('Tagesmax Böe', vals, C_WIND, { pointRadius: 2 })] }, options: baseOptions(10) };
}

const windYears = () => Object.keys((history && history.wind_gust_max_monthly) || {}).sort();
function resolveYear() {
  const years = windYears();
  if (years.includes(yearCursor)) return yearCursor;
  return years.length ? years[years.length - 1] : String(new Date().getFullYear());
}

async function cfgJahr(year) {
  await loadHistory();
  const yr = String(year || resolveYear());
  yearCursor = yr;
  const vals = (history.wind_gust_max_monthly && history.wind_gust_max_monthly[yr]) || [];
  return { type: 'line', data: { labels: MONTH_SHORT, datasets: [line(`Monatsmax Böe ${yr}`, vals, C_WIND)] }, options: baseOptions(12) };
}

function cmpYearColor(allYears, yr) {
  const n = allYears.length, i = allYears.indexOf(yr);
  if (n <= CMP_PALETTE.length) { const hex = CMP_PALETTE[i]; return { solid: hex, soft: hexA(hex, 0.28) }; }
  const h = Math.round((360 * i) / n);
  return { solid: `hsl(${h}, 65%, 60%)`, soft: `hsla(${h}, 65%, 60%, 0.28)` };
}
function ensureCmpDefaultVisibility(allYears) {
  if (cmpHiddenYears !== null) return;
  cmpHiddenYears = new Set();
  const hideCount = Math.max(0, allYears.length - 3);
  for (let i = 0; i < hideCount; i++) cmpHiddenYears.add(allYears[i]);
}

async function cfgVergleich() {
  await loadHistory();
  const allYears = windYears();
  ensureCmpDefaultVisibility(allYears);
  const curYear = String(new Date().getFullYear());
  const ds = [];
  for (const yr of allYears) {
    if (cmpHiddenYears.has(yr)) continue;
    ds.push(line(yr, history.wind_gust_max_monthly[yr], cmpYearColor(allYears, yr).solid,
      { borderWidth: yr === curYear ? 2.5 : 1.6 }));
  }
  return { type: 'line', data: { labels: MONTH_SHORT, datasets: ds }, options: baseOptions(12) };
}

// ---------- render ----------
function buildConfig() {
  if (activeTab === 'woche')     return cfgWoche(7);
  if (activeTab === 'monat')     return cfgMonat();
  if (activeTab === 'jahr')      return cfgJahr(yearCursor);
  if (activeTab === 'vergleich') return cfgVergleich();
  return cfgAktuell();
}

function renderSubctrl() {
  const el = document.getElementById('wind-subctrl');
  if (!el) return;
  el.style.flexWrap = '';
  if (activeTab === 'monat') {
    const [y, m] = monthCursor.split('-').map(Number);
    const prevOff = monthCursor <= FIRST_MONTH ? 'disabled' : '';
    const nextOff = monthCursor >= ym(new Date()) ? 'disabled' : '';
    el.innerHTML = `<button ${prevOff} onclick="window.windMonth(-1)">‹</button>`
      + `<span>${MONTH_SHORT[m - 1]} ${y}${monthEmpty ? ' – keine Daten' : ''}</span>`
      + `<button ${nextOff} onclick="window.windMonth(1)">›</button>`;
  } else if (activeTab === 'jahr') {
    const years = windYears();
    const yr = resolveYear();
    yearCursor = yr;
    const i = years.indexOf(yr);
    const prevOff = i <= 0 ? 'disabled' : '';
    const nextOff = i < 0 || i >= years.length - 1 ? 'disabled' : '';
    el.innerHTML = `<button ${prevOff} onclick="window.windYearDelta(-1)">‹</button>`
      + `<span>${yr}</span>`
      + `<button ${nextOff} onclick="window.windYearDelta(1)">›</button>`;
  } else if (activeTab === 'vergleich') {
    el.style.flexWrap = 'wrap';
    const allYears = windYears();
    ensureCmpDefaultVisibility(allYears);
    el.innerHTML = `<div style="display:flex;flex-wrap:wrap;justify-content:center;gap:6px;width:100%;">`
      + allYears.map((yr) => {
        const hidden = cmpHiddenYears.has(yr);
        const c = cmpYearColor(allYears, yr);
        const style = hidden ? 'opacity:0.4;' : `background:${c.soft};border-color:${c.solid};color:#fff;`;
        return `<button onclick="window.windCmpYear('${yr}')" style="${style}">${yr}</button>`;
      }).join('') + `</div>`;
  } else {
    el.innerHTML = ''; // aktuell: Legende steht im Header
  }
}

// Historie-Tabs nur fuer Gronenberg; bei anderer Stadt ausblenden und auf "aktuell" zurueck.
function applyCityVisibility() {
  const show = isGronenberg();
  const tabs = document.querySelector('#wind-card .wind-tabs');
  const sub = document.getElementById('wind-subctrl');
  if (tabs) tabs.style.display = show ? '' : 'none';
  if (sub) sub.style.display = show ? '' : 'none';
  if (!show && activeTab !== 'aktuell') {
    activeTab = 'aktuell';
    document.querySelectorAll('#wind-card .wind-tabs .range-btn')
      .forEach((b) => b.classList.toggle('active', b.dataset.tab === 'aktuell'));
  }
}

// soft = Hintergrund-Update ohne Neuaufbau/Animation (Forecast-Refresh im Tab "aktuell")
async function render(soft = false) {
  applyCityVisibility();
  let cfg;
  try { cfg = await buildConfig(); }
  catch (e) { console.error('[wind]', e); showToast('Winddaten nicht verfügbar.'); return; }
  renderSubctrl();
  if (!cfg) return;
  const canvas = document.getElementById('wind-chart');
  if (!canvas) return;
  if (soft && chart && chart.config.type === cfg.type && activeTab === 'aktuell') {
    chart.data = cfg.data;
    chart._isNight = cfg._isNight;
    chart.update('none');
    return;
  }
  if (chart) chart.destroy();
  chart = new Chart(canvas, cfg);
}

// ---------- Schnittstelle zu main.js ----------
/** Forecast-Kontext (Daten, Range, Stadt) setzen; rendert den Tab "aktuell" neu. */
export function setForecast(data, range, cityIdx, cities) {
  const cityChanged = fc.cityIdx !== cityIdx;
  fc = { data, range, cityIdx, cities };
  if (activeTab === 'aktuell' || cityChanged) render(!cityChanged);
}

export async function refreshLive() {
  try { await loadLive(); }
  catch (e) { console.warn('[wind] live.json:', e); }
  if (activeTab === 'aktuell') render(true);
}

// ---------- window-Handler ----------
window.windSetTab = (tab) => {
  if (tab === activeTab || !isGronenberg()) return;
  activeTab = tab;
  document.querySelectorAll('#wind-card .wind-tabs .range-btn')
    .forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  render();
};
window.windMonth = (delta) => {
  const nx = shiftYm(monthCursor, delta);
  if (nx < FIRST_MONTH || nx > ym(new Date())) return;
  monthCursor = nx;
  render();
};
window.windYearDelta = (delta) => {
  const years = windYears();
  if (!years.length) return;
  let i = years.indexOf(yearCursor);
  if (i < 0) i = years.length - 1;
  const ni = i + delta;
  if (ni < 0 || ni >= years.length) return;
  yearCursor = years[ni];
  render();
};
window.windCmpYear = (yr) => {
  yr = String(yr);
  const allYears = windYears();
  ensureCmpDefaultVisibility(allYears);
  if (cmpHiddenYears.has(yr)) {
    cmpHiddenYears.delete(yr);
  } else {
    if (allYears.filter((y) => !cmpHiddenYears.has(y)).length <= 1) return; // letztes Jahr bleibt sichtbar
    cmpHiddenYears.add(yr);
  }
  render();
};

// ---------- init (aus main.js aufgerufen) ----------
export async function initWind() {
  monthCursor = ym(new Date());
  yearCursor = String(new Date().getFullYear());
  loadHistory().catch((e) => console.warn('[wind] history.json:', e));
  try { await loadLive(); } catch (e) { console.warn('[wind] live.json:', e); }
  await render();
  if (liveTimer) clearInterval(liveTimer);
  liveTimer = setInterval(refreshLive, 15 * 60 * 1000);
}
