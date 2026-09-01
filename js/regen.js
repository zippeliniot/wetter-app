// js/regen.js — Regen-Nowcast (2 h), Standort dynamisch wählbar

import { fetchRegenNowcast } from './api.js';
import { REGEN_SITES } from './config.js';

// Aktiver Standort – Standard: Gronenberg; wird per setSite() umgeschaltet
let currentSite = REGEN_SITES[0];
const RAIN_MMH = 0.05;
const DIRS = [
  { code: 'N', ang: 0 },
  { code: 'NO', ang: 45 },
  { code: 'O', ang: 90 },
  { code: 'SO', ang: 135 },
  { code: 'S', ang: 180 },
  { code: 'SW', ang: 225 },
  { code: 'W', ang: 270 },
  { code: 'NW', ang: 315 },
];
const RING_KM = [5, 10, 20, 30];

let chart = null;
let lastModel = null;
let active = false;

function mm15ToMmh(mm15) {
  return (mm15 == null ? 0 : Number(mm15)) * 4;
}

function classFromMmh(mmh) {
  if (mmh < RAIN_MMH) return { class: 'trocken', feel: 'kein Regen', verdict: 'Kein Regen' };
  if (mmh < 1) return { class: 'Niesel', feel: 'feiner Niesel / Spruehregen', verdict: 'Niesel' };
  if (mmh < 2.5) return { class: 'leicht', feel: 'leichter Regen', verdict: 'Leichter Regen' };
  if (mmh < 5) return { class: 'maessig', feel: 'maessiger Regen', verdict: 'Regen' };
  if (mmh < 15) return { class: 'stark', feel: 'starker Regen', verdict: 'Starker Regen' };
  return { class: 'heftig', feel: 'heftiger Regen', verdict: 'Heftiger Regen' };
}

function offsetLatLon(lat, lon, km, bearingDeg) {
  const R = 6371;
  const br = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const δ = km / R;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(br));
  const λ2 = λ1 + Math.atan2(Math.sin(br) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: (φ2 * 180) / Math.PI, lon: (λ2 * 180) / Math.PI };
}

function samplePoints() {
  const { lat, lon } = currentSite;
  const pts = [{ id: 'site', lat, lon, km: 0, dir: null }];
  for (const km of RING_KM) {
    for (const d of DIRS) {
      const p = offsetLatLon(lat, lon, km, d.ang);
      pts.push({ id: `${d.code}-${km}`, lat: p.lat, lon: p.lon, km, dir: d.code });
    }
  }
  return pts;
}

function fmtClock(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    const m = String(iso).match(/T(\d{2}:\d{2})/);
    return m ? m[1] : '—';
  }
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function minutesFromNow(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return Math.max(0, Math.round((t - now) / 60000));
}

function buildModel(responses, points, now = Date.now()) {
  const site = Array.isArray(responses) ? responses[0] : responses;
  const times = site.minutely_15.time;
  const sitePrecip = site.minutely_15.precipitation;

  const timeline = times.map((t, i) => {
    const mmh = mm15ToMmh(sitePrecip[i]);
    const cls = classFromMmh(mmh);
    return {
      iso: t,
      cest: fmtClock(t),
      minutes_from_now: minutesFromNow(t, now) ?? i * 15,
      site_mm15: sitePrecip[i] ?? 0,
      site_mmh: mmh,
      is_raining: mmh >= RAIN_MMH,
      site_class: cls.class,
      site_feel: cls.feel,
    };
  });

  let onset = null;
  let peak = { mmh: 0, i: 0 };
  let sumMm = 0;
  for (let i = 0; i < timeline.length; i++) {
    const s = timeline[i];
    sumMm += s.site_mm15;
    if (s.site_mmh > peak.mmh) peak = { mmh: s.site_mmh, i };
    if (onset == null && s.is_raining) onset = s;
  }

  const list = Array.isArray(responses) ? responses : [responses];
  const byPoint = points.map((p, pi) => {
    const r = list[pi] || list[0];
    const precip = r?.minutely_15?.precipitation || [];
    return { ...p, precip: precip.map(mm15ToMmh) };
  });

  function firstWetInRing(maxKm) {
    let best = null;
    for (const p of byPoint) {
      if (p.km <= 0 || p.km > maxKm) continue;
      for (let i = 0; i < times.length; i++) {
        if ((p.precip[i] || 0) < RAIN_MMH) continue;
        const cand = { min: minutesFromNow(times[i], now) ?? i * 15, km: p.km, dir: p.dir, i };
        if (!best || cand.min < best.min || (cand.min === best.min && cand.km < best.km)) best = cand;
        break;
      }
    }
    return best;
  }

  function nearestRainAtStep(stepIdx) {
    let best = null;
    for (const p of byPoint) {
      if (p.km <= 0) continue;
      const mmh = p.precip[stepIdx] || 0;
      if (mmh < RAIN_MMH) continue;
      if (!best || p.km < best.km) best = { km: p.km, dir: p.dir, mmh };
    }
    return best;
  }

  const approach = nearestRainAtStep(0) || nearestRainAtStep(1);
  const prox10 = firstWetInRing(10);
  const prox5 = firstWetInRing(5);
  const peakCls = classFromMmh(peak.mmh);
  const rains = !!onset;

  let verdict = 'Kein Regen';
  let heroFeel = 'In den nächsten 2 Stunden kein Niederschlag am Ort erwartet.';
  if (rains) {
    // Als „kurz" gilt Regen an ≤ 3 Zeitschritten (≤ 45 Minuten).
    const short = timeline.filter(s => s.is_raining).length <= 3;
    verdict = (short ? 'Kurzer ' : '') + peakCls.verdict;
    heroFeel = `${verdict} ab ca. ${onset.cest} Uhr. ${peakCls.feel}`;
  } else if (approach) {
    verdict = 'Regen in der Nähe';
    heroFeel = `Front aus ${approach.dir} (~${Math.round(approach.km)} km). Am Ort in den nächsten 2 Stunden noch kein Niederschlag.`;
  }

  const endCest = fmtClock(times[times.length - 1]);
  const horizonMin = Math.max(...timeline.map(s => s.minutes_from_now), 120);

  return {
    source: 'Open-Meteo · ICON-D2',
    nowCest: new Date(now).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
    endCest,
    timeline,
    rains,
    verdict,
    heroFeel,
    onset,
    peak: {
      mmh: peak.mmh,
      cest: timeline[peak.i]?.cest,
      class: peakCls.class,
      feel: peakCls.feel,
    },
    sumMm,
    prox10,
    prox5,
    approach,
    horizonMin,
  };
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function renderRadar(model) {
  const svg = document.getElementById('regen-radar-svg');
  if (!svg) return;
  const W = 320, H = 300, cx = 160, cy = 128;
  const maxR = 90;
  const kpp = 30 / maxR;
  const approach = model.approach;
  const beginMin = model.onset?.minutes_from_now;

  const rings = [10, 20, 30].map(km => {
    const r = km / kpp;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1.5"/>` +
      (km < 30 ? `<text x="${cx + r + 6}" y="${cy + 4}" fill="rgba(255,255,255,0.7)" font-size="11">${km} km</text>` : '');
  }).join('');

  const labels = [
    { t: 'N', a: -90 }, { t: 'O', a: 0 }, { t: 'S', a: 90 }, { t: 'W', a: 180 },
  ].map(({ t, a }) => {
    const rad = (a * Math.PI) / 180;
    const r = maxR + 16;
    const x = cx + Math.cos(rad) * r;
    const y = cy + Math.sin(rad) * r;
    return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-size="13" font-weight="700">${t}</text>`;
  }).join('');

  let front = '';
  let status = 'Keine Regenfront im 30-km-Umkreis';
  if (approach) {
    const dirAng = { N: -90, NO: -45, O: 0, SO: 45, S: 90, SW: 135, W: 180, NW: -135 }[approach.dir] ?? 180;
    const rad = (dirAng * Math.PI) / 180;
    const distPx = Math.max(Math.min(28, Number(approach.km)) / kpp, 30);
    const bx = cx + Math.cos(rad) * distPx;
    const by = cy + Math.sin(rad) * distPx;
    front = `
      <line x1="${cx}" y1="${cy}" x2="${bx}" y2="${by}" stroke="rgba(255,255,255,0.8)" stroke-width="2"/>
      <circle cx="${bx}" cy="${by}" r="18" fill="rgba(77,217,255,0.25)"/>
      <circle cx="${bx}" cy="${by}" r="12" fill="rgba(77,217,255,0.55)"/>
      <circle cx="${bx}" cy="${by}" r="6" fill="#4ade80"/>`;
    status = `Front ~${Math.round(approach.km)} km (${approach.dir}) — noch nicht am Ort`;
  }

  const badge = beginMin != null
    ? `<rect x="${W - 168}" y="8" width="156" height="26" rx="13" fill="rgba(255,255,255,0.1)" stroke="#4DD9FF"/>
       <text x="${W - 90}" y="25" text-anchor="middle" fill="#4DD9FF" font-size="11">${beginMin} Min bis Niederschlag</text>`
    : '';

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `
    ${badge}
    ${rings}
    <text x="${cx + maxR * 0.55}" y="${cy - maxR * 0.55}" fill="rgba(255,255,255,0.55)" font-size="10">30 km</text>
    ${labels}
    ${front}
    <circle cx="${cx}" cy="${cy}" r="7" fill="#ef4444" stroke="#fff" stroke-width="2"/>
    <text x="12" y="262" fill="rgba(255,255,255,0.9)" font-size="12">${status}</text>
    <g font-size="11" fill="rgba(255,255,255,0.75)">
      <circle cx="16" cy="286" r="4" fill="#ef4444"/><text x="24" y="290">Standort</text>
      <circle cx="110" cy="286" r="4" fill="#fff"/><text x="118" y="290">Richtung</text>
      <circle cx="200" cy="286" r="4" fill="#4DD9FF"/><text x="208" y="290">Regenfront</text>
    </g>`;
}

function renderChart(model) {
  const canvas = document.getElementById('regen-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  const labels = model.timeline.map(s => s.cest);
  const data = model.timeline.map(s => (s.site_mmh >= RAIN_MMH ? s.site_mmh : null));
  const beginIdx = model.onset ? model.timeline.indexOf(model.onset) : -1;
  const vmax = Math.max(1.0, ...model.timeline.map(s => s.site_mmh), 0.1) * 1.25;

  const cfg = {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'mm/h',
        data,
        borderColor: '#4DD9FF',
        backgroundColor: 'rgba(77,217,255,0.15)',
        borderWidth: 2,
        pointRadius: 4,
        pointBackgroundColor: '#4DD9FF',
        spanGaps: false,
        tension: 0.25,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ctx.parsed.y == null ? 'trocken' : `${ctx.parsed.y.toFixed(2)} mm/h`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: 'rgba(255,255,255,0.65)', maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
          grid: { color: 'rgba(255,255,255,0.08)' },
        },
        y: {
          min: 0,
          max: vmax,
          title: { display: true, text: 'mm/h', color: '#4DD9FF', font: { size: 11 } },
          ticks: { color: 'rgba(255,255,255,0.65)' },
          grid: { color: 'rgba(255,255,255,0.1)' },
        },
      },
    },
    plugins: [{
      id: 'beginLine',
      afterDraw(c) {
        if (beginIdx < 0) return;
        const xScale = c.scales.x;
        const yScale = c.scales.y;
        // getPixelForIndex liefert die korrekte X-Position für Kategorie-Achsen (Chart.js 4)
        const x = xScale.getPixelForIndex(beginIdx);
        const ctx = c.ctx;
        ctx.save();
        ctx.strokeStyle = 'rgba(77,217,255,0.7)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x, yScale.top);
        ctx.lineTo(x, yScale.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#4DD9FF';
        ctx.font = '11px Segoe UI, sans-serif';
        ctx.fillText('Beginn', x + 4, yScale.top + 12);
        ctx.restore();
      },
    }],
  };

  if (chart) chart.destroy();
  chart = new Chart(canvas, cfg);
}

function updateNavButton(rains) {
  const btn = document.getElementById('btn-regen');
  if (!btn) return;
  btn.textContent = rains ? 'Regen' : 'Kein Regen';
  btn.classList.toggle('accent', !!rains);
  btn.classList.toggle('dry', !rains);
  btn.title = rains
    ? 'Regen in den nächsten 2 Stunden — Vorhersage öffnen'
    : 'Kein Regen in den nächsten 2 Stunden — Vorhersage öffnen';
  btn.setAttribute('aria-label', btn.title);
}

function render(model) {
  lastModel = model;
  updateNavButton(model.rains);
  setText('regen-loc', currentSite.name);
  setText('regen-meta', `Ab Jetzt · bis ${model.endCest} · ${model.source}`);
  // Hero-Card-Titel zeitabhängig setzen (nicht statisch „Heute Abend")
  setText('regen-hero-label', `${model.nowCest} – ${model.endCest} Uhr`);
  setText('regen-verdict', model.verdict);
  setText('regen-hero-feel', model.heroFeel);

  if (model.onset) {
    setText('regen-eta-main', model.onset.cest);
    setText('regen-eta-sub', `in ~${model.onset.minutes_from_now} Min`);
  } else {
    setText('regen-eta-main', '—');
    setText('regen-eta-sub', 'kein Regen');
  }

  if (model.peak.mmh >= RAIN_MMH) {
    setText('regen-peak-main', `${model.peak.mmh.toFixed(1)} mm/h`);
    setText('regen-peak-sub', `${model.peak.class} · ${model.peak.cest}`);
  } else {
    setText('regen-peak-main', '0 mm/h');
    setText('regen-peak-sub', 'trocken');
  }

  setText('regen-prox10', model.prox10 ? `in ${model.prox10.min} Min` : '—');
  setText('regen-prox5', model.prox5 ? `in ${model.prox5.min} Min` : '—');
  setText('regen-sum', `${model.sumMm.toFixed(2)} mm`);

  const err = document.getElementById('regen-error');
  if (err) err.style.display = 'none';

  renderChart(model);
  renderRadar(model);
}

function showError(msg) {
  const err = document.getElementById('regen-error');
  if (err) {
    err.textContent = msg;
    err.style.display = 'block';
  }
}

export async function refresh() {
  try {
    const points = samplePoints();
    const responses = await fetchRegenNowcast(points);
    const model = buildModel(responses, points);
    render(model);
  } catch (e) {
    console.warn('[regen]', e);
    showError('Regen-Vorhersage konnte nicht geladen werden.');
  }
}

/** Wechselt den Regen-Standort anhand des Ortsnamens (aus REGEN_SITES). */
export function setSite(locName) {
  const found = REGEN_SITES.find(s => s.name.toLowerCase() === locName.toLowerCase());
  if (found) currentSite = found;
}

/** Leichte Abfrage nur für den Header-Button (aktueller Standort, 2 h). */
export async function refreshNavStatus() {
  try {
    const points = [{ id: 'site', lat: currentSite.lat, lon: currentSite.lon, km: 0, dir: null }];
    const responses = await fetchRegenNowcast(points);
    const model = buildModel(responses, points);
    updateNavButton(!!model.rains);
    return model.rains;
  } catch (e) {
    console.warn('[regen] nav status:', e);
    // Button nie bei „…“ hängen lassen
    updateNavButton(false);
    return null;
  }
}

export async function initRegen() {
  try {
    await refreshNavStatus();
  } catch (e) {
    console.warn('[regen] init:', e);
    updateNavButton(false);
  }
}

export function show() {
  active = true;
  document.getElementById('main-view')?.classList.add('hidden');
  document.getElementById('main-header')?.classList.add('hidden');
  document.getElementById('regen-view')?.classList.remove('hidden');
  document.getElementById('regen-header')?.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  refresh();
}

export function hide() {
  active = false;
  document.getElementById('regen-view')?.classList.add('hidden');
  document.getElementById('regen-header')?.classList.add('hidden');
  document.getElementById('main-view')?.classList.remove('hidden');
  document.getElementById('main-header')?.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function isActive() {
  return active;
}
