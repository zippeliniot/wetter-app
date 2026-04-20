import { CITIES, COL } from './config.js';
import * as api from './api.js';
import * as ui from './ui.js';
import * as utils from './utils.js';
import * as charts from './charts.js';

// --- STATE ---
let currentRange = 1;
let currentLocation = localStorage.getItem('wetter-loc') || 'gronenberg';
let cachedData = null, marineCache = null;
let tempChart = null, windChart = null, seaChart = null, fsChart = null;
let shellBuilt = false;

// Speicher-Keys für den LocalStorage
const CACHE_KEY_CITY = 'wetter_city_cache';
const CACHE_KEY_MARINE = 'wetter_marine_cache';

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
        const [results, marineRaw] = await Promise.all([
            Promise.allSettled(CITIES.map(c => api.fetchCityData(c))),
            api.fetchMarineData().catch(() => null),
        ]);

        if (!results.every(r => r.status === 'fulfilled')) throw new Error("API Fehler");

        const allData = results.map(r => r.value);

        // Cache speichern
        localStorage.setItem('wetter_city_cache', JSON.stringify(allData));
        if (marineRaw) localStorage.setItem('wetter_marine_cache', JSON.stringify(marineRaw));

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
        ui.setStatus('error');
        ui.showToast("Aktualisierung fehlgeschlagen. Zeige alte Daten.");
    }
}

function initCharts() {
    requestAnimationFrame(() => {
        tempChart = new Chart(document.getElementById('temp-chart'), charts.getTempChartConfig(cachedData, currentRange, CITIES));
        windChart = new Chart(document.getElementById('wind-chart'), charts.getWindChartConfig(cachedData, currentRange, CITIES));
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
        tempChart.data = cfg.data;
        tempChart._isNight = cfg._isNight;
        tempChart._symEvery = cfg._symEvery;
        // Wichtig: 'none' verhindert Animationen beim Hintergrund-Update
        tempChart.update('none');
    }
    if (windChart) {
        const cfg = charts.getWindChartConfig(cachedData, currentRange, CITIES, 'wind-chart');
        windChart.data = cfg.data;
        windChart._isNight = cfg._isNight;
        windChart.update('none');
    }
    if (seaChart && marineCache) {
        const cfg = charts.getSeaChartConfig(marineCache, currentRange, CITIES, 'sea-chart');
        seaChart.data = cfg.data;
        seaChart._isNight = cfg._isNight;
        seaChart.update('none');
        updateSeaHeader();
    }

    // WICHTIG: Nach dem Update den Filter erneut anwenden,
    // damit Hamburg/GR wieder korrekt ein-/ausgeblendet sind!
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
    const showHH = currentLocation === 'hamburg' || currentLocation === 'all';
    const showGR = currentLocation === 'gronenberg' || currentLocation === 'all';

    if (tempChart) {
        // Datasets in charts.js Reihenfolge:
        // 0: HH Regen (Bar)
        // 1: GR Regen (Bar)
        // 2: HH RainDots (Line)
        // 3: GR RainDots (Line)
        // 4: HH Temp (Line)
        // 5: GR Temp (Line)

        // Setze Sichtbarkeit für Hamburg
        tempChart.getDatasetMeta(0).hidden = !showHH;
        tempChart.getDatasetMeta(2).hidden = !showHH;
        tempChart.getDatasetMeta(4).hidden = !showHH;

        // Setze Sichtbarkeit für Gronenberg
        tempChart.getDatasetMeta(1).hidden = !showGR;
        tempChart.getDatasetMeta(3).hidden = !showGR;
        tempChart.getDatasetMeta(5).hidden = !showGR;

        tempChart.update('none');
    }

    // Wind Karte (nur GR)
    document.getElementById('wind-card').style.display = showGR ? '' : 'none';

    // Tabelle
    document.querySelectorAll('.fc-row-0, .fc-row-sep').forEach(el => el.style.display = showHH ? '' : 'none');
    document.querySelectorAll('.fc-row-1').forEach(el => el.style.display = showGR ? '' : 'none');

    // Legende
    const toggleLeg = (id, show) => {
        const el = document.getElementById(id);
        if(el) el.style.display = show ? '' : 'none';
    };
    toggleLeg('leg-hh-temp', showHH);
    toggleLeg('leg-hh-rain', showHH);
    toggleLeg('leg-gr-temp', showGR);
    toggleLeg('leg-gr-rain', showGR);
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
      title.textContent = "Windgeschwindigkeit Gronenberg";
      config = charts.getWindChartConfig(cachedData, currentRange, CITIES, 'fs-canvas');
    } else {
      title.textContent = "Ostsee Wassertemperatur";
      config = charts.getSeaChartConfig(marineCache, currentRange, CITIES, 'fs-canvas');
    }

    // AKTUALISIERUNG: Setze den FullScreen Flag für das Symbol-Plugin
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
    remaining = 15;
    loadAll(false);
};

window.togglePause = () => {
    paused = !paused;
    document.getElementById('pause-btn').textContent = paused ? 'Weiter' : 'Pause';
    document.getElementById('pause-btn').style.background = paused ? 'rgba(255,184,48,0.20)' : '';
};

window.locateMe = () => {
    ui.dom.settingsMenu.classList.remove('open');
    if (!navigator.geolocation) { ui.showToast('GPS nicht unterstützt'); return; }
    const btn = document.getElementById('sm-gps');
    btn.textContent = '📍 Wird ermittelt …';

    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude: lat, longitude: lon } = pos.coords;
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
let remaining = 15, paused = false;
setInterval(() => {
    if (paused) return;
    remaining--;
    ui.dom.ringProgress.style.strokeDashoffset = (2 * Math.PI * 12) * (1 - remaining / 15);
    ui.dom.countdownNum.textContent = remaining;
    if (remaining <= 0) { remaining = 15; loadAll(true); }
}, 1000);

// --- INIT SEQUENCE ---
window.addEventListener('DOMContentLoaded', async () => {
    // 1. Erst Cache laden (sofortige Anzeige)
    await loadFromCache();

    // 2. Dann echte Daten vom Server holen (Hintergrund-Update)
    loadAll(true);
});
