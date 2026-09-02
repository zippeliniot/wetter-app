import { CITIES, COL, REGEN_SITES } from './config.js';
import * as api from './api.js';
// Hinweis: fetchCityData wird nicht mehr direkt verwendet – Batch via fetchAllCitiesData
import * as ui from './ui.js';
import * as utils from './utils.js';
import * as charts from './charts.js';
import * as seewasser from './seewasser.js';
import * as blitz from './blitz.js';
import * as regen from './regen.js';

// --- STATE ---
let currentRange = 1;
let currentLocation = localStorage.getItem('wetter-loc') || 'gronenberg';
let cachedData = null, marineCache = null;
let tempChart = null, windChart = null, seaChart = null, fsChart = null;
let shellBuilt = false;

// Speicher-Keys für den LocalStorage
const CACHE_KEY_CITY = 'wetter_city_cache';
const CACHE_KEY_MARINE = 'wetter_marine_cache';

// --- HILFSFUNKTIONEN ---

/** Index der aktuell gewählten Stadt in CITIES (-1 bei 'all'). */
function getCityIdx() {
    return CITIES.findIndex(c => c.name.toLowerCase() === currentLocation);
}

/**
 * Welche Stadt soll im Wind-Chart angezeigt werden?
 * 'all' → Gronenberg (Index 1); Einzelstadt → deren Index; Fallback: 1.
 */
function getWindCityIdx() {
    if (currentLocation === 'all') return 1;
    const idx = getCityIdx();
    return idx >= 0 ? idx : 1;
}

// --- APP LOGIC ---

/**
 * Lädt Daten aus dem LocalStorage und rendert sie sofort
 */
async function loadFromCache() {
    const cityData = localStorage.getItem(CACHE_KEY_CITY);
    const marineData = localStorage.getItem(CACHE_KEY_MARINE);

    if (cityData && marineData) {
        console.log("Lade Daten aus Cache...");
        cachedData = JSON.parse(cityData);
        marineCache = JSON.parse(marineData);

        // Wenn Cache noch aus alter 2-Städte-Version stammt → verwerfen
        if (cachedData.length < CITIES.length) {
            console.log("Cache veraltet (weniger Städte), lade neu...");
            cachedData = null;
            marineCache = null;
            return;
        }

        // 1. Shell bauen (falls noch nicht geschehen)
        if (!shellBuilt) {
            ui.buildForecastShell(cachedData, CITIES);
            shellBuilt = true;
        }

        // 2. Werte in Tabelle und Header setzen
        ui.updateForecastValues(cachedData, CITIES);

        // 3. Charts initialisieren mit Cache-Daten
        initCharts();
        updateSeaHeader();

        // Status auf "Lade aktuelle Daten..."
        ui.setStatus('loading');
        ui.dom.updatedText.textContent = 'Lade aktuelle Daten...';
    }
}

async function loadAll(silent = false) {
    try {
        ui.setStatus('loading');
        // Batch-Request; bei 429 sofort abbrechen (kein Fallback – der würde 4x weitere 429 erzeugen)
        let allData = null;
        try {
            allData = await api.fetchAllCitiesData(CITIES);
        } catch (batchErr) {
            if (String(batchErr.message).includes('429')) throw batchErr; // direkt in catch-Block
            console.warn('[loadAll] Batch fehlgeschlagen, versuche Einzel-Requests:', batchErr);
            const results = await Promise.allSettled(CITIES.map(c => api.fetchCityData(c)));
            allData = results.map((r, i) => {
                if (r.status === 'fulfilled') return r.value;
                console.warn(`[loadAll] ${CITIES[i].name} fehlgeschlagen:`, r.reason);
                return cachedData?.[i] ?? null;
            });
        }

        // Datenstruktur validieren – ungültige Einträge durch Cache ersetzen
        allData = allData.map((d, i) => {
            if (d && d.hourly && d.daily) return d;
            console.warn(`[loadAll] Ungültige Datenstruktur für ${CITIES[i].name}:`, d);
            return cachedData?.[i] ?? null;
        });

        const marineRaw = await api.fetchMarineData().catch(e => { console.warn('[loadAll] Marine-Daten fehlgeschlagen:', e); return null; });

        // Abbrechen nur wenn HH (0) UND GR (1) keine Daten haben
        if (!allData[0] && !allData[1]) throw new Error("Kernstädte HH+GR nicht erreichbar");

        // Cache speichern
        localStorage.setItem(CACHE_KEY_CITY, JSON.stringify(allData));
        if (marineRaw) localStorage.setItem(CACHE_KEY_MARINE, JSON.stringify(marineRaw));

        cachedData = allData;
        marineCache = marineRaw;

        if (!shellBuilt) {
            ui.buildForecastShell(cachedData, CITIES);
            ui.updateForecastValues(cachedData, CITIES);
            initCharts(); // Ruft am Ende auch applyLocationFilter auf
            shellBuilt = true;
        } else {
            ui.updateForecastValues(cachedData, CITIES);
            updateCharts(); // Ruft jetzt explizit applyLocationFilter auf
        }

        ui.setStatus('ok');
        ui.dom.updatedText.textContent = 'Aktualisiert: ' + new Date().toLocaleTimeString('de-DE');
    } catch (e) {
        console.error('[loadAll] Kritischer Fehler:', e);
        ui.setStatus('error');
        if (!silent) ui.showToast("Aktualisierung fehlgeschlagen. Zeige alte Daten.");
        // Bei 429: nächsten Versuch in ~5 Min statt in 10 Min
        if (String(e.message).includes('429') && remainingWeather > 300) {
            remainingWeather = 300;
        }
    }
}

function initCharts() {
    requestAnimationFrame(() => {
        const tempCfg = charts.getTempChartConfig(cachedData, currentRange, CITIES);
        if (tempCfg) tempChart = new Chart(document.getElementById('temp-chart'), tempCfg);
        const windCfg = charts.getWindChartConfig(cachedData, currentRange, CITIES, 'wind-chart', getWindCityIdx());
        if (windCfg) windChart = new Chart(document.getElementById('wind-chart'), windCfg);
        if (marineCache) {
            seaChart = new Chart(document.getElementById('sea-chart'), charts.getSeaChartConfig(marineCache, currentRange, CITIES));
        }
        // WICHTIG: Beim ersten Initialisieren den Filter anwenden
        applyLocationFilter();
    });
}

function updateCharts() {
    if (tempChart) {
        const cfg = charts.getTempChartConfig(cachedData, currentRange, CITIES, 'temp-chart');
        if (cfg) {
            tempChart.data = cfg.data;
            tempChart._isNight = cfg._isNight;
            tempChart._symEvery = cfg._symEvery;
            tempChart._N = cfg._N;
            // Wichtig: 'none' verhindert Animationen beim Hintergrund-Update
            tempChart.update('none');
        }
    }
    if (windChart) {
        const cfg = charts.getWindChartConfig(cachedData, currentRange, CITIES, 'wind-chart', getWindCityIdx());
        if (cfg) {
            windChart.data = cfg.data;
            windChart._isNight = cfg._isNight;
            windChart.update('none');
        }
    }
    if (seaChart && marineCache) {
        const cfg = charts.getSeaChartConfig(marineCache, currentRange, CITIES, 'sea-chart');
        seaChart.data = cfg.data;
        seaChart._isNight = cfg._isNight;
        seaChart.update('none');
        updateSeaHeader();
    }

    // WICHTIG: Nach dem Update den Filter erneut anwenden
    applyLocationFilter();
}

function updateSeaHeader() {
    if (!marineCache) return;
    const range = currentRange;
    const step = range === 1 ? 1 : 2;
    const src = marineCache.hourly.time;
    const start = utils.getStartIndex(src);
    const end = Math.min(start + range * 24, src.length);

    const values = [];
    const waveVals = [];
    for (let i = start; i < end; i += step) {
        values.push(marineCache.hourly.sea_surface_temperature[i]);
        waveVals.push(marineCache.hourly.wave_height[i]);
    }

    const cur = values.find(v => v != null);
    const wave = waveVals.find(v => v != null);
    ui.dom.seaCurrent.textContent = [cur != null ? Math.round(cur * 10) / 10 + ' °C' : null, wave != null ? '〰 ' + Math.round(wave * 100) + ' cm' : null].filter(Boolean).join('  ');
}

function applyLocationFilter() {
    const N = CITIES.length;          // 4
    const cityIdx = getCityIdx();      // -1 wenn 'all'
    const isAll = currentLocation === 'all';

    // --- Temp-Chart: Datasets ein-/ausblenden ---
    // Struktur: [0..N-1] rainBars | [N..2N-1] rainDots | [2N..3N-1] tempLines
    if (tempChart) {
        for (let ci = 0; ci < N; ci++) {
            const show = isAll ? (ci === 0 || ci === 1) : (ci === cityIdx);
            tempChart.getDatasetMeta(ci).hidden      = !show; // rainBar
            tempChart.getDatasetMeta(N + ci).hidden  = !show; // rainDot
            tempChart.getDatasetMeta(2*N + ci).hidden = !show; // tempLine
        }
        tempChart.update('none');
    }

    // --- Wind-Chart: Daten der gewählten Stadt / bei 'all' → GR ---
    // Wind-Chart wird neu befüllt (Daten und Titel)
    if (windChart && cachedData) {
        const wIdx = getWindCityIdx();
        const windCfg = charts.getWindChartConfig(cachedData, currentRange, CITIES, 'wind-chart', wIdx);
        if (windCfg) {
            windChart.data = windCfg.data;
            windChart._isNight = windCfg._isNight;
            windChart.update('none');
        }
        // Titel der Wind-Card aktualisieren
        const windTitleEl = document.getElementById('wind-card-title');
        if (windTitleEl) windTitleEl.textContent = `Wind · ${CITIES[wIdx].name} km/h ↗`;
    }
    // Wind-Card: immer sichtbar (alle Städte haben Winddaten)
    document.getElementById('wind-card').style.display = '';

    // --- Taschensee + Blitz + Ostsee: nur bei GR oder 'all' ---
    const showGRCards = isAll || currentLocation === 'gronenberg';
    const _sw = document.getElementById('taschensee-card');
    if (_sw) _sw.style.display = showGRCards ? '' : 'none';
    const _bz = document.getElementById('blitz-card');
    if (_bz) _bz.style.display = showGRCards ? '' : 'none';
    const _sea = document.getElementById('sea-card');
    if (_sea) _sea.style.display = showGRCards ? '' : 'none';

    // --- Prognose-Tabelle ---
    for (let ci = 0; ci < N; ci++) {
        const show = isAll ? (ci === 0 || ci === 1) : (ci === cityIdx);
        document.querySelectorAll(`.fc-row-${ci}`).forEach(el => el.style.display = show ? '' : 'none');
    }
    // Trennzeile zwischen HH und GR nur in 'all'-Modus
    document.querySelectorAll('.fc-row-sep').forEach(el => el.style.display = isAll ? '' : 'none');

    // --- Legende ---
    // Schlüssel: hh=0, gr=1, ki=2, lü=3
    const LEG_KEYS = ['hh', 'gr', 'ki', 'lü'];
    LEG_KEYS.forEach((key, ci) => {
        const show = isAll ? (ci === 0 || ci === 1) : (ci === cityIdx);
        const toggleLeg = (id) => { const el = document.getElementById(id); if (el) el.style.display = show ? '' : 'none'; };
        toggleLeg(`leg-${key}-temp`);
        toggleLeg(`leg-${key}-rain`);
    });

    // --- Hinweis-Card (nicht mehr benötigt, immer ausblenden) ---
    const notice = document.getElementById('no-weather-notice');
    if (notice) notice.style.display = 'none';

    // --- Aktiver Menüeintrag ---
    ['gronenberg', 'hamburg', 'kiel', 'lübeck', 'all'].forEach(loc => {
        const el = document.getElementById(`sm-${loc}`);
        if (el) el.classList.toggle('active', currentLocation === loc);
    });
}



// --- GLOBAL HANDLERS ---
window.setRange = (days) => {
    currentRange = days;
    document.getElementById('btn1').classList.toggle('active', days === 1);
    document.getElementById('btn3').classList.toggle('active', days === 3);
    updateCharts();
};

window.toggleMenu = (e) => {
    e.stopPropagation();
    ui.dom.settingsMenu.classList.toggle('open');
};

window.setLocation = (loc) => {
    currentLocation = loc;
    localStorage.setItem('wetter-loc', loc);
    ui.dom.settingsMenu.classList.remove('open');
    // Regen-Nowcast-Standort synchron halten (bei 'all' → Gronenberg)
    regen.setSite(loc === 'all' ? 'Gronenberg' : loc);
    applyLocationFilter();
};

window.openFS = (type) => {
    const modal = document.getElementById('fs-modal');
    const title = document.getElementById('fs-title');
    const canvas = document.getElementById('fs-canvas');

    let config;
    if (type === 'temp') {
      title.textContent = "Temperatur & Niederschlag";
      config = charts.getTempChartConfig(cachedData, currentRange, CITIES, 'fs-canvas');
    } else if (type === 'wind') {
      const wIdx = getWindCityIdx();
      title.textContent = `Windgeschwindigkeit ${CITIES[wIdx].name}`;
      config = charts.getWindChartConfig(cachedData, currentRange, CITIES, 'fs-canvas', wIdx);
    } else if (type === 'seewasser') {
      const c = seewasser.getFSConfig();
      if (!c) return;
      title.textContent = "Taschensee Gronenberg";
      config = c;
    } else {
      title.textContent = "Ostsee Wassertemperatur";
      config = charts.getSeaChartConfig(marineCache, currentRange, CITIES, 'fs-canvas');
    }

    if (!config) return; // Keine Daten verfügbar

    // Setze den FullScreen Flag für das Symbol-Plugin
    config.options.plugins.fullScreen = true;

    modal.classList.add('open');
    if (fsChart) fsChart.destroy();
    fsChart = new Chart(canvas, config);
};


window.closeFS = () => {
    document.getElementById('fs-modal').classList.remove('open');
    if (fsChart) { fsChart.destroy(); fsChart = null; }
};

window.manualRefresh = () => {
    remainingRegen   = REGEN_INTERVAL;
    remainingWeather = WEATHER_INTERVAL;
    if (regen.isActive()) {
        regen.refresh();
        return;
    }
    loadAll(false);
    seewasser.refreshLive();
    blitz.refresh();
    regen.refreshNavStatus();
};

window.showRegen = () => regen.show();
window.showMain = () => regen.hide();

window.togglePause = () => {
    paused = !paused;
    const btn = document.getElementById('pause-btn');
    if (btn) { btn.textContent = paused ? 'Weiter' : 'Pause'; btn.style.background = paused ? 'rgba(255,184,48,0.20)' : ''; }
};

window.locateMe = () => {
    ui.dom.settingsMenu.classList.remove('open');
    if (!navigator.geolocation) { ui.showToast('GPS nicht unterstützt'); return; }
    const btn = document.getElementById('sm-gps');
    btn.textContent = '📍 Wird ermittelt …';

    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude: lat, longitude: lon } = pos.coords;
        // Nächsten Ort aus allen Städten bestimmen
        const nearest = CITIES.reduce((a, b) => {
          const d1 = Math.pow(a.lat-lat,2)+Math.pow(a.lon-lon,2);
          const d2 = Math.pow(b.lat-lat,2)+Math.pow(b.lon-lon,2);
          return d1 < d2 ? a : b;
        });
        btn.textContent = '📍 Meinen Standort';
        window.setLocation(nearest.name.toLowerCase());
      },
      err => { btn.textContent = '📍 Meinen Standort'; ui.showToast('Standort konnte nicht ermittelt werden.'); },
      { timeout: 8000 }
    );
};

window.showImpressum = () => { ui.dom.settingsMenu.classList.remove('open'); document.getElementById('impressum-overlay').classList.add('open'); }
window.closeImpressum = () => { document.getElementById('impressum-overlay').classList.remove('open'); }

// --- TIMER ---
// Regen-Nowcast: alle 2 Minuten (120 s) — leichte Single-Point-Abfrage
// Wetter+Marine:  alle 10 Minuten (600 s) — vollständiger Batch-Abruf
const REGEN_INTERVAL   = 120;
const WEATHER_INTERVAL = 600;
let remainingRegen   = REGEN_INTERVAL;
let remainingWeather = WEATHER_INTERVAL;
let paused = false;

setInterval(() => {
    if (paused) return;
    remainingRegen--;
    remainingWeather--;

    // Countdown-Ring zeigt Zeit bis zum nächsten Regen-Check
    ui.dom.ringProgress.style.strokeDashoffset = (2 * Math.PI * 12) * (1 - remainingRegen / REGEN_INTERVAL);
    ui.dom.countdownNum.textContent = remainingRegen;

    if (remainingRegen <= 0) {
        remainingRegen = REGEN_INTERVAL;
        regen.refreshNavStatus().then(status => {
            // Bei 429: nächsten Regen-Check auf 10 Min verschieben
            if (status === 'rate_limited') remainingRegen = 600;
        });
    }
    if (remainingWeather <= 0) {
        remainingWeather = WEATHER_INTERVAL;
        loadAll(true);
    }
}, 1000);

// --- INIT SEQUENCE ---
window.addEventListener('DOMContentLoaded', async () => {
    // Regen-Standort mit gespeicherter Location synchronisieren
    regen.setSite(currentLocation === 'all' ? 'Gronenberg' : currentLocation);

    // Regen-Button-Status sofort (unabhaengig vom restlichen Wetter-Cache)
    regen.initRegen();

    // 1. Erst Cache laden (sofortige Anzeige)
    await loadFromCache();

    // 2. Dann echte Daten vom Server holen (Hintergrund-Update)
    loadAll(true);

    // 3. Taschensee- + Blitz-Karte (unabhaengig von der Open-Meteo-Schleife)
    seewasser.initSeewasser();
    blitz.initBlitz();
});
