import { WMO, DN } from './config.js';

export function getWmoInfo(c) { return WMO[c] ?? ['Unbekannt','🌡️']; }

export function getWmoSymbol(code, isNight) {
    const info = getWmoInfo(code);
    const symbol = info[1];
    if (isNight) {
        if (symbol === '☀️') return '🌙';
        if (symbol === '🌤️') return '🌌';
        if (symbol === '⛅') return '☁️🌙';
    }
    return symbol;
}

// Mondphasen-Berechnung
export function getMoonPhaseSymbol(date) {
    const lp = 2551443;
    const now = new Date(date);
    const newMoon = new Date(1970, 0, 1);
    const diff = (now - newMoon) / 1000;
    const phase = (diff % lp) / lp;

    const phases = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
    const index = Math.floor(phase * 8);
    return phases[index] || '🌑';
}

export function getWindDir(deg) {
    return ['N','NO','O','SO','S','SW','W','NW'][Math.round(deg/45)%8];
}

export function fmtTime(iso) {
    return iso ? (iso.includes('T') ? iso.split('T')[1].slice(0, 5) : iso.slice(-5)) : '–';
}

export function fmtHHMM(date) {
    return String(date.getHours()).padStart(2,'0') + ':' + String(date.getMinutes()).padStart(2,'0');
}

export function isNightAt(isoStr, lat, lon) {
    const date = new Date(isoStr);
    const sun = SunCalc.getTimes(date, lat, lon);
    return date < sun.sunrise || date > sun.sunset;
}

export function getStartIndex(times) {
    const now = new Date();
    now.setMinutes(0,0,0);
    for (let i = 0; i < times.length; i++) {
        if (new Date(times[i]) >= now) return i;
    }
    return 0;
}
