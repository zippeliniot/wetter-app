export async function fetchCityData(city) {
    const p = new URLSearchParams({
      latitude: city.lat, longitude: city.lon,
      current: ['temperature_2m','relative_humidity_2m','apparent_temperature','weather_code','wind_speed_10m','wind_direction_10m','precipitation','uv_index'].join(','),
      hourly:  ['temperature_2m','precipitation','wind_speed_10m','wind_direction_10m','weather_code'].join(','),
      daily:   ['weather_code','temperature_2m_max','temperature_2m_min','precipitation_sum','sunrise','sunset'].join(','),
      timezone: 'Europe/Berlin', forecast_days: 7,
    });
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
}

/**
 * Alle Städte in einem einzigen Batch-Request (Open-Meteo Multi-Location).
 * Zuverlässiger als N parallele Einzelaufrufe — gibt ein Array zurück,
 * ein Eintrag pro Stadt in derselben Reihenfolge wie `cities`.
 */
export async function fetchAllCitiesData(cities) {
    const p = new URLSearchParams({
      latitude:  cities.map(c => c.lat).join(','),
      longitude: cities.map(c => c.lon).join(','),
      current: ['temperature_2m','relative_humidity_2m','apparent_temperature','weather_code','wind_speed_10m','wind_direction_10m','precipitation','uv_index'].join(','),
      hourly:  ['temperature_2m','precipitation','wind_speed_10m','wind_direction_10m','weather_code'].join(','),
      daily:   ['weather_code','temperature_2m_max','temperature_2m_min','precipitation_sum','sunrise','sunset'].join(','),
      timezone: 'Europe/Berlin', forecast_days: 7,
    });
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    // Open-Meteo gibt bei mehreren Orten ein Array zurück, bei einem Ort ein Objekt
    return Array.isArray(data) ? data : [data];
}

export async function fetchMarineData() {
    const p = new URLSearchParams({
      latitude: 54.02334, longitude: 10.77672,
      hourly:   ['sea_surface_temperature','wave_height'].join(','),
      timezone: 'Europe/Berlin', forecast_days: 7,
    });
    const r = await fetch(`https://marine-api.open-meteo.com/v1/marine?${p}`);
    if (!r.ok) throw new Error(`Marine HTTP ${r.status}`);
    return r.json();
}

/** Multi-Punkt 15-Min-Niederschlag (ca. 2 h) für Regen-Nowcast */
export async function fetchRegenNowcast(points) {
    const p = new URLSearchParams({
      latitude: points.map(x => x.lat).join(','),
      longitude: points.map(x => x.lon).join(','),
      minutely_15: 'precipitation',
      forecast_minutely_15: '8',
      timezone: 'Europe/Berlin',
    });
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`);
    if (!r.ok) throw new Error(`Regen HTTP ${r.status}`);
    const data = await r.json();
    return Array.isArray(data) ? data : [data];
}
