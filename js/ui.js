import { DN } from './config.js';
import { getWmoInfo } from './utils.js'; // KORRIGIERT: Import jetzt aus utils.js statt config.js

export const dom = {
    fcTable: document.getElementById('fc-table'),
    updatedText: document.getElementById('updated-text'),
    statusDot: document.getElementById('status-dot'),
    toastContainer: document.getElementById('toast-container'),
    seaCurrent: document.getElementById('sea-current'),
    ringProgress: document.getElementById('ring-progress'),
    countdownNum: document.getElementById('countdown-num'),
    settingsMenu: document.getElementById('settings-menu')
};

export function buildForecastShell(allData, cities) {
    const days = allData[0].daily.time;
    const dayLabels = days.map((t, i) => i === 0 ? 'Heute' : DN[new Date(t).getDay()]);

    dom.fcTable.innerHTML = `
      <tr class="fc-dh"><td></td>${dayLabels.map(d => `<td>${d}</td>`).join('')}</tr>
      ${cities.map((c, ci) => `
        <tr class="fc-city-row fc-row-${ci}">
          <td class="fc-city-lbl"><span style="background:${ci===0?'#FFB830':'#4DD9FF'};"></span>${ci===0?'HH':'GR'}</td>
          ${days.map((_,di) => `<td><div class="fc-icon" id="fc-${ci}-${di}-icon"></div><div class="fc-max" id="fc-${ci}-${di}-max"></div><div class="fc-min" id="fc-${ci}-${di}-min"></div></td>`).join('')}
        </tr>
        ${ci === 0 ? '<tr class="fc-city-sep fc-row-sep"><td colspan="8"></td></tr>' : ''}`).join('')}
      <tr class="fc-info-sep"><td colspan="8"></td></tr>
      <tr class="fc-info-row"><td class="fc-info-lbl">🌅<span class="fc-lbl-txt">Sonne</span></td>${days.map((_,di) => `<td class="fc-time" id="fc-sr-${di}"></td>`).join('')}</tr>
      <tr class="fc-info-row"><td class="fc-info-lbl">🌇<span class="fc-lbl-txt">Sonne</span></td>${days.map((_,di) => `<td class="fc-time" id="fc-ss-${di}"></td>`).join('')}</tr>
      <tr class="fc-info-sep"><td colspan="8"></td></tr>
      <tr class="fc-info-row"><td class="fc-info-lbl">🌕<span class="fc-lbl-txt">Mond</span></td>${days.map((_,di) => `<td class="fc-time" id="fc-mr-${di}"></td>`).join('')}</tr>
      <tr class="fc-info-row"><td class="fc-info-lbl">🌑<span class="fc-lbl-txt">Mond</span></td>${days.map((_,di) => `<td class="fc-time" id="fc-ms-${di}"></td>`).join('')}</tr>`;
}

export function updateForecastValues(allData, cities) {
    allData.forEach((data, i) => {
      const d = data.daily;
      d.time.forEach((_, j) => {
        const [, fi] = getWmoInfo(d.weather_code[j]);
        setText(`fc-${i}-${j}-icon`, fi);
        setText(`fc-${i}-${j}-max`,  Math.round(d.temperature_2m_max[j]) + '°');
        setText(`fc-${i}-${j}-min`,  Math.round(d.temperature_2m_min[j]) + '°');
      });
    });

    const d0 = allData[0].daily;
    const lat = cities[1].lat, lon = cities[1].lon;
    d0.time.forEach((dateStr, j) => {
      setText(`fc-sr-${j}`, fmtTime(d0.sunrise?.[j]));
      setText(`fc-ss-${j}`, fmtTime(d0.sunset?.[j]));
      // Hinweis: SunCalc wird global in index.html geladen
      const mt = SunCalc.getMoonTimes(new Date(dateStr + 'T12:00:00'), lat, lon);
      setText(`fc-mr-${j}`, mt.rise ? fmtHHMM(mt.rise) : '–');
      setText(`fc-ms-${j}`, mt.set  ? fmtHHMM(mt.set)  : '–');
    });
}

// Hilfsfunktionen für Zeitformate (da diese in ui.js gebraucht werden)
function fmtTime(iso) { return iso ? (iso.includes('T') ? iso.split('T')[1].slice(0, 5) : iso.slice(-5)) : '–'; }
function fmtHHMM(date) { return String(date.getHours()).padStart(2,'0') + ':' + String(date.getMinutes()).padStart(2,'0'); }

export function setText(id, val) {
    const el = document.getElementById(id);
    if (el && el.textContent !== String(val)) el.textContent = val;
}

export function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    dom.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
}

export function setStatus(s) {
    dom.statusDot.className = 'status-dot' + (s === 'loading' ? ' loading' : s === 'error' ? ' error' : '');
}
