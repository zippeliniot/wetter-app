export const CITIES = [
    {
        name: 'Hamburg',
        sub: 'Hansestadt',
        lat: 53.56389207412397,
        lon: 10.010347420810374
    },
    {
        name: 'Gronenberg',
        sub: '23684 · Schleswig-Holstein',
        lat: 54.04541193007556,
        lon: 10.708640362471053
    },
];

export const COL = [
    { line: '#FFB830', fill: 'rgba(255,184,48,0.36)',  bar: 'rgba(255,184,48,0.52)', barB: 'rgba(255,184,48,0.78)' },
    { line: '#4DD9FF', fill: 'rgba(77,217,255,0.28)',  bar: 'rgba(77,217,255,0.48)', barB: 'rgba(77,217,255,0.72)' },
];

export const WMO = {
    0:['Klarer Himmel','☀️'],    1:['Überwiegend klar','🌤️'],
    2:['Teilweise bewölkt','⛅'], 3:['Bedeckt','☁️'],
    45:['Nebel','🌫️'],           48:['Raureif-Nebel','🌫️'],
    51:['Leichter Niesel','🌦️'], 53:['Nieselregen','🌦️'],
    55:['Starker Niesel','🌧️'],  61:['Leichter Regen','🌧️'],
    63:['Regen','🌧️'],           65:['Starker Regen','🌧️'],
    71:['Leicht. Schnee','🌨️'],  73:['Schneefall','❄️'],
    75:['Starker Schnee','❄️'],  77:['Schneekörner','🌨️'],
    80:['Leichte Schauer','🌦️'], 81:['Schauer','🌧️'],
    82:['Starke Schauer','⛈️'],  85:['Schneeschauer','🌨️'],
    86:['Starke Schnee-S.','❄️'],95:['Gewitter','⛈️'],
    96:['Gewitter+Hagel','⛈️'],  99:['Schw. Gewitter','⛈️'],
};

export const DN = ['So','Mo','Di','Mi','Do','Fr','Sa'];
export const FULL_DN = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
