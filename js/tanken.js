// js/tanken.js — Tankstellenpreise (Tankerkoenig), Umkreis Gronenberg
// Liest ausschliesslich statische data/tanken.json + data/tanken_history.json
// (kein API-Key im Frontend).

const PREFS_KEY = 'tanken-chart-prefs';
const DEFAULT_FUELS = ['e10', 'diesel']; // E5 bewusst nicht default (April-Vorgabe)
const STATION_COLORS = ['#4DD9FF', '#FFB830', '#4ade80', '#c084fc', '#fb7185', '#facc15', '#38bdf8', '#f472b6'];
const FUEL_DASH = { e5: [], e10: [6, 4], diesel: [2, 2] };
const FUEL_LABEL = { e5: 'E5', e10: 'E10', diesel: 'Diesel' };

const SORT_ORDER = ['e5', 'e10', 'diesel'];

let active = false;
let stations = [];
let sortKey = 'e10'; // Default passend zu DEFAULT_FUELS (E5 ist per Default nicht angezeigt)
let historyData = null;
let chartRange = 1; // Tage – eigener Kontext, nicht window.setRange/currentRange aus main.js

// prefs.stationIds === null bedeutet "alle" (noch keine explizite Auswahl getroffen)
let prefs = loadPrefs();

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { stationIds: null, fuels: DEFAULT_FUELS.slice() };
    const p = JSON.parse(raw);
    return {
      stationIds: Array.isArray(p.stationIds) ? p.stationIds : null,
      fuels: Array.isArray(p.fuels) ? p.fuels : DEFAULT_FUELS.slice(),
    };
  } catch (e) {
    return { stationIds: null, fuels: DEFAULT_FUELS.slice() };
  }
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (e) {
    console.warn('[tanken] Prefs konnten nicht gespeichert werden', e);
  }
}

function fmtPrice(v) {
  return typeof v !== 'number' ? '—' : `${v.toFixed(3).replace('.', ',')} €`;
}

function fmtDist(km) {
  return km == null ? '—' : `${Number(km).toFixed(1)} km`;
}

function fmtUpdated(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Sorgt dafuer, dass sortKey immer eine aktuell ausgewaehlte Sorte ist -
 * sonst automatischer Wechsel auf die erste noch ausgewaehlte (E5->E10->Diesel). */
function ensureValidSortKey() {
  if (sortKey && prefs.fuels.includes(sortKey)) return;
  sortKey = SORT_ORDER.find(f => prefs.fuels.includes(f)) || null;
}

function renderSortToggle() {
  const toggle = document.getElementById('tanken-sort-toggle');
  if (!toggle) return;
  if (prefs.fuels.length === 0) {
    toggle.style.display = 'none';
    return;
  }
  toggle.style.display = '';
  toggle.querySelectorAll('.range-btn').forEach(b => {
    const fuel = b.dataset.sort;
    const visible = prefs.fuels.includes(fuel);
    b.style.display = visible ? '' : 'none';
    b.classList.toggle('active', fuel === sortKey);
  });
}

function render() {
  const list = document.getElementById('tanken-list');
  if (!list) return;

  ensureValidSortKey();
  renderSortToggle();

  const filtered = stations.filter(st => isStationChecked(st.id));

  if (stations.length > 0 && filtered.length === 0) {
    list.innerHTML = '<p class="bz-empty">Keine Stationen ausgewählt (siehe ⚙)</p>';
    return;
  }

  if (prefs.fuels.length === 0) {
    list.innerHTML = filtered.length === 0
      ? '<p class="bz-empty">Keine Stationen gefunden.</p>'
      : '<p class="bz-empty">Keine Kraftstoffsorte ausgewählt (siehe ⚙)</p>';
    return;
  }

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    const aNum = typeof av === 'number';
    const bNum = typeof bv === 'number';
    if (!aNum && !bNum) return 0;
    if (!aNum) return 1;
    if (!bNum) return -1;
    return av - bv;
  });

  list.innerHTML = sorted.map(st => {
    const priceRows = prefs.fuels.map(fuel => `
      <div><div class="tanken-price-lbl">${FUEL_LABEL[fuel] ?? fuel}</div><div class="tanken-price">${fmtPrice(st[fuel])}</div></div>
    `).join('');
    return `
    <div class="card tanken-row ${st.isOpen ? '' : 'closed'}">
      <div>
        <div class="tanken-name">${st.name ?? '—'}${st.brand ? ` · ${st.brand}` : ''}
          <span class="tanken-badge ${st.isOpen ? 'open' : 'closed'}">${st.isOpen ? 'offen' : 'geschlossen'}</span>
        </div>
        <div class="tanken-addr">${[st.street, st.houseNumber].filter(Boolean).join(' ')}, ${[st.postCode, st.place].filter(Boolean).join(' ')}</div>
        <div class="tanken-dist">${fmtDist(st.dist)}</div>
      </div>
      <div class="tanken-prices">${priceRows}</div>
    </div>
  `;
  }).join('') || '<p class="bz-empty">Keine Stationen gefunden.</p>';
}

// ---------- Zahnrad-Einstellungen (Stationen/Sorten je Geraet, localStorage) ----------

function isStationChecked(id) {
  if (!prefs.stationIds) return true; // Default: alle angehakt
  return prefs.stationIds.includes(id);
}

function renderSettingsPanel() {
  const box = document.getElementById('tanken-station-checks');
  if (box) {
    box.innerHTML = stations.map(st => `
      <label class="sm-item" style="display:flex;align-items:center;gap:8px;">
        <input type="checkbox" data-station-id="${st.id}" ${isStationChecked(st.id) ? 'checked' : ''} onchange="window.tankenPrefsChanged()">
        <span>${st.name ?? st.id}${st.brand ? ` · ${st.brand}` : ''}</span>
      </label>
    `).join('') || '<div class="sm-item" style="opacity:0.6;cursor:default;">Keine Stationen geladen</div>';
  }
  const e5 = document.getElementById('tanken-fuel-e5');
  const e10 = document.getElementById('tanken-fuel-e10');
  const diesel = document.getElementById('tanken-fuel-diesel');
  if (e5) e5.checked = prefs.fuels.includes('e5');
  if (e10) e10.checked = prefs.fuels.includes('e10');
  if (diesel) diesel.checked = prefs.fuels.includes('diesel');
}

export function toggleSettings(e) {
  e?.stopPropagation();
  renderSettingsPanel();
  document.getElementById('tanken-settings-menu')?.classList.toggle('open');
}

export function prefsChanged() {
  const stationChecks = [...document.querySelectorAll('#tanken-station-checks input[type="checkbox"]')];
  prefs.stationIds = stationChecks.filter(c => c.checked).map(c => c.dataset.stationId);

  const fuels = [];
  if (document.getElementById('tanken-fuel-e5')?.checked) fuels.push('e5');
  if (document.getElementById('tanken-fuel-e10')?.checked) fuels.push('e10');
  if (document.getElementById('tanken-fuel-diesel')?.checked) fuels.push('diesel');
  prefs.fuels = fuels;

  savePrefs();
  render();
}

// ---------- Preisliste laden ----------

async function load() {
  const err = document.getElementById('tanken-error');
  if (err) err.style.display = 'none';
  try {
    const res = await fetch('data/tanken.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const groups = data.groups || [];
    stations = groups.flatMap(g => g.stations || []);

    const loc = document.getElementById('tanken-loc');
    if (loc) loc.textContent = groups.map(g => g.desc).filter(Boolean).join(', ') || '—';

    const upd = document.getElementById('tanken-updated');
    if (upd) upd.textContent = fmtUpdated(data.updated_at);

    render();
    if (document.getElementById('tanken-settings-menu')?.classList.contains('open')) {
      renderSettingsPanel();
    }
  } catch (e) {
    console.warn('[tanken]', e);
    if (err) {
      err.textContent = 'Tankstellenpreise konnten nicht geladen werden.';
      err.style.display = 'block';
    }
  }
}

async function loadHistory() {
  try {
    const res = await fetch('data/tanken_history.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    historyData = await res.json();
  } catch (e) {
    console.warn('[tanken] history', e);
    historyData = null;
  }
}

export function setSort(key) {
  sortKey = key;
  document.querySelectorAll('#tanken-sort-toggle .range-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.sort === key);
  });
  render();
}

export function setRange(days) {
  chartRange = days;
  document.querySelectorAll('#tanken-range-toggle .range-btn').forEach(b => {
    b.classList.toggle('active', Number(b.dataset.range) === days);
  });
}

/** Wird vom 5-Minuten-Tick aus main.js aufgerufen (no-op wenn Ansicht inaktiv). */
export async function refresh() {
  if (!active) return;
  await load();
}

// ---------- Vollbild-Preisverlauf-Chart ----------

const emptyStatePlugin = {
  id: 'tankenEmptyState',
  afterDraw(chart) {
    if (chart.data.datasets.length > 0) return;
    const { ctx, width, height } = chart;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '13px Segoe UI, sans-serif';
    ctx.fillText('Noch keine Verlaufsdaten – sammelt sich seit Aktivierung.', width / 2, height / 2);
    ctx.restore();
  },
};

function stationIndex(id) {
  const idx = stations.findIndex(s => s.id === id);
  return idx >= 0 ? idx : 0;
}

function stationLabel(id) {
  const st = stations.find(s => s.id === id);
  return st ? (st.name ?? id) : id;
}

function fmtChartLabel(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function emptyFSConfig() {
  return {
    type: 'line',
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } },
    },
    plugins: [emptyStatePlugin],
  };
}

/** Baut die Chart.js-Konfiguration fuer das Vollbild-Modal aus
 * data/tanken_history.json, gefiltert auf die per Zahnrad gewaehlten
 * Stationen+Sorten und den eigenen 1-Tag/3-Tage-Zustand (chartRange). */
export function getFSConfig() {
  const points = historyData?.points;
  if (!Array.isArray(points) || points.length === 0) return emptyFSConfig();

  const cutoff = Date.now() - chartRange * 24 * 60 * 60 * 1000;
  const filteredPoints = points
    .filter(p => {
      const t = new Date(p.t).getTime();
      return !isNaN(t) && t >= cutoff;
    })
    .sort((a, b) => new Date(a.t) - new Date(b.t));

  const stationIds = prefs.stationIds && prefs.stationIds.length
    ? prefs.stationIds
    : stations.map(s => s.id);
  const fuels = prefs.fuels;

  if (filteredPoints.length === 0 || stationIds.length === 0 || fuels.length === 0) {
    return emptyFSConfig();
  }

  const labels = filteredPoints.map(p => fmtChartLabel(p.t));
  const datasets = [];

  for (const sid of stationIds) {
    for (const fuel of fuels) {
      const data = filteredPoints.map(p => {
        const v = p.prices?.[sid]?.[fuel];
        return typeof v === 'number' ? v : null;
      });
      if (data.every(v => v == null)) continue;
      datasets.push({
        label: `${stationLabel(sid)} · ${FUEL_LABEL[fuel] ?? fuel}`,
        data,
        borderColor: STATION_COLORS[stationIndex(sid) % STATION_COLORS.length],
        backgroundColor: 'transparent',
        borderWidth: 2,
        borderDash: FUEL_DASH[fuel] ?? [],
        pointRadius: 2,
        pointHoverRadius: 4,
        spanGaps: true,
        tension: 0.2,
      });
    }
  }

  if (datasets.length === 0) return emptyFSConfig();

  return {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          labels: { color: 'rgba(255,255,255,0.85)', font: { size: 12 }, usePointStyle: true, pointStyle: 'line' },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${fmtPrice(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: 'rgba(255,255,255,0.65)', maxRotation: 0, autoSkip: true, maxTicksLimit: 10 },
          grid: { color: 'rgba(255,255,255,0.08)' },
        },
        y: {
          ticks: { color: 'rgba(255,255,255,0.85)', callback: v => Number(v).toFixed(2) + ' €' },
          grid: { color: 'rgba(255,255,255,0.08)' },
        },
      },
      animation: { duration: 300 },
    },
    plugins: [emptyStatePlugin],
  };
}

// ---------- show/hide ----------

export function show() {
  active = true;
  document.getElementById('main-view')?.classList.add('hidden');
  document.getElementById('main-header')?.classList.add('hidden');
  document.getElementById('tanken-view')?.classList.remove('hidden');
  document.getElementById('tanken-header')?.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  load();
  loadHistory();
}

export function hide() {
  active = false;
  document.getElementById('tanken-settings-menu')?.classList.remove('open');
  document.getElementById('tanken-view')?.classList.add('hidden');
  document.getElementById('tanken-header')?.classList.add('hidden');
  document.getElementById('main-view')?.classList.remove('hidden');
  document.getElementById('main-header')?.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function isActive() {
  return active;
}
