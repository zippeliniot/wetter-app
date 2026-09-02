// Globaler Rate-Limit-Guard: bei einem 429 werden für RATE_BLOCK_MS
// alle weiteren API-Aufrufe sofort lokal abgebrochen (kein HTTP-Request).
// Der Zeitstempel wird auch im sessionStorage gespeichert, damit ein
// Seitenreload die Sperre nicht zurücksetzt.
const RATE_BLOCK_MS = 10 * 60 * 1000; // 10 Minuten
const RATE_KEY = 'om_rate_limited_until';

function isRateLimited() {
    const stored = Number(sessionStorage.getItem(RATE_KEY) || 0);
    return Date.now() < stored;
}

function getRateLimitRemaining() {
    return Math.max(0, Math.ceil((Number(sessionStorage.getItem(RATE_KEY) || 0) - Date.now()) / 1000));
}

function markRateLimited() {
    sessionStorage.setItem(RATE_KEY, String(Date.now() + RATE_BLOCK_MS));
    console.warn(`[api] Rate-Limit: alle Anfragen für ${RATE_BLOCK_MS / 60000} Min gesperrt.`);
}

function guardRateLimit(label) {
    if (isRateLimited()) {
        throw new Error(`HTTP 429 (gesperrt, noch ${getRateLimitRemaining()}s)`);
    }
}

function handleResponse(r, label) {
    if (r.status === 429) { markRateLimited(); throw new Error(`HTTP 429`); }
    if (!r.ok) throw new Error(`${label} HTTP ${r.status}`);
}

export function rateLimitRemainingSeconds() {
    return getRateLimitRemaining();
}

export async function fetchCityData(city) {
    guardRateLimit('fetchCityData');
    const p = new URLSearchParams({
      latitude: city.lat, longitude: city.lon,
      current: ['temperature_2m','relative_humidity_2m','apparent_temperature','weather_code','wind_speed_10m','wind_direction_10m','precipitation','uv_index'].join(','),
      hourly:  ['temperature_2m','precipitation','wind_speed_10m','wind_direction_10m','weather_code'].join(','),
      daily:   ['weather_code','temperature_2m_max','temperature_2m_min','precipitation_sum','sunrise','sunset'].join(','),
      timezone: 'Europe/Berlin', forecast_days: 7,
    });
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`);
    handleResponse(r, '');
    return r.json();
}

/**
 * Alle Städte in einem einzigen Batch-Request (Open-Meteo Multi-Location).
 * Zuverlässiger als N parallele Einzelaufrufe — gibt ein Array zurück,
 * ein Eintrag pro Stadt in derselben Reihenfolge wie `cities`.
 */
export async function fetchAllCitiesData(cities) {
    guardRateLimit('fetchAllCitiesData');
    const p = new URLSearchParams({
      latitude:  cities.map(c => c.lat).join(','),
      longitude: cities.map(c => c.lon).join(','),
      current: ['temperature_2m','relative_humidity_2m','apparent_temperature','weather_code','wind_speed_10m','wind_direction_10m','precipitation','uv_index'].join(','),
      hourly:  ['temperature_2m','precipitation','wind_speed_10m','wind_direction_10m','weather_code'].join(','),
      daily:   ['weather_code','temperature_2m_max','temperature_2m_min','precipitation_sum','sunrise','sunset'].join(','),
      timezone: 'Europe/Berlin', forecast_days: 7,
    });
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`);
    handleResponse(r, '');
    const data = await r.json();
    // Open-Meteo gibt bei mehreren Orten ein Array zurück, bei einem Ort ein Objekt
    return Array.isArray(data) ? data : [data];
}

export async function fetchMarineData() {
    guardRateLimit('fetchMarineData');
    const p = new URLSearchParams({
      latitude: 54.02334, longitude: 10.77672,
      hourly:   ['sea_surface_temperature','wave_height'].join(','),
      timezone: 'Europe/Berlin', forecast_days: 7,
    });
    const r = await fetch(`https://marine-api.open-meteo.com/v1/marine?${p}`);
    handleResponse(r, 'Marine');
    return r.json();
}

/** Multi-Punkt 15-Min-Niederschlag (ca. 2 h) für Regen-Nowcast */
export async function fetchRegenNowcast(points) {
    guardRateLimit('fetchRegenNowcast');
    const p = new URLSearchParams({
      latitude: points.map(x => x.lat).join(','),
      longitude: points.map(x => x.lon).join(','),
      minutely_15: 'precipitation',
      forecast_minutely_15: '8',
      timezone: 'Europe/Berlin',
    });
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`);
    handleResponse(r, 'Regen');
    const data = await r.json();
    return Array.isArray(data) ? data : [data];
}
