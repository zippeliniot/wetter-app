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
