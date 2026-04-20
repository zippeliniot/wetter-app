import { COL, DN, FULL_DN } from './config.js';
import { isNightAt, getStartIndex, getWmoInfo, getWindDir, getWmoSymbol, getMoonPhaseSymbol } from './utils.js';

// --- PLUGINS ---
const dayNightPlugin = {
    id: 'dayNight',
    beforeDatasetsDraw(chart) {
        const { ctx, chartArea: a } = chart;
        if (!a || !chart._isNight) return;
        const n = chart._isNight;
        const slot = a.width / n.length;
        ctx.save();
        n.forEach((night, i) => {
            ctx.fillStyle = night ? 'rgba(0, 5, 55, 0.38)' : 'rgba(255, 215, 100, 0.11)';
            ctx.fillRect(a.left + i * slot, a.top, slot + 0.5, a.height);
        });
        ctx.restore();
    }
};

const weatherSymbolPlugin = {
    id: 'weatherSymbols',
    afterDatasetsDraw(chart) {
        const { ctx } = chart;
        const isFS = chart.options.plugins.fullScreen || false;
        const fontSize = isFS ? 40 : 13;
        const everyN = chart._symEvery ?? 3;

        chart.data.datasets.forEach((ds, dsIdx) => {
            if (!ds.codes) return;
            const meta = chart.getDatasetMeta(dsIdx);
            if (ds.hidden || meta.hidden) return;
            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';

            ds.codes.forEach((code, i) => {
                if (i % everyN !== 0) return;
                const pt = meta.data[i];
                if (pt) {
                    const nightStatus = chart._isNight ? chart._isNight[i] : false;

                    // Wetter Symbol
                    ctx.font = `${fontSize}px sans-serif`;
                    ctx.fillStyle = '#FFFFFF';
                    const symbol = getWmoSymbol(code ?? 0, nightStatus);
                    ctx.fillText(symbol, pt.x, pt.y - 5);

                    // Mondphase (Nur nachts)
                    if (nightStatus) {
                        ctx.font = `${fontSize * 0.8}px sans-serif`;
                        ctx.fillStyle = '#ADD8E6';
                        const moon = getMoonPhaseSymbol(chart.data.labels[i]);
                        ctx.fillText(moon, pt.x + 12, pt.y - 15);
                    }
                }
            });
            ctx.restore();
        });
    }
};

const windArrowPlugin = {
    id: 'windArrows',
    afterDatasetsDraw(chart) {
        const { ctx, scales: { y } } = chart;
        const ds = chart.data.datasets[0];
        const meta = chart.getDatasetMeta(0);
        if (!ds.dirs || !meta.data.length) return;
        const barW = meta.data[0]?.width ?? 0;
        if (barW < 6) return;
        ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `bold ${Math.max(9, Math.min(13, barW * 0.65))}px sans-serif`;
        meta.data.forEach((bar, i) => {
            const spd = ds.data[i], dir = ds.dirs[i];
            if (spd == null || dir == null) return;
            ctx.save(); ctx.translate(bar.x, y.getPixelForValue(spd) - 9);
            ctx.rotate(((dir + 180) % 360) * Math.PI / 180);
            ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fillText('↑', 0, 0);
            ctx.restore();
        });
        ctx.restore();
    }
};

const windZonesPlugin = {
    id: 'windZones',
    beforeDatasetsDraw(chart) {
        const { ctx, chartArea: a, scales: { y } } = chart;
        if (!a) return;
        const bands = [
            { from: 0, to: 15, color: 'rgba(74,222,128,0.06)' },
            { from: 15, to: 25, color: 'rgba(250,204,21,0.07)' },
            { from: 25, to: 50, color: 'rgba(251,146,60,0.07)' },
            { from: 50, to: y.max, color: 'rgba(239,68,68,0.09)' },
        ];
        ctx.save();
        bands.forEach(b => {
            if (b.from >= y.max) return;
            const top = y.getPixelForValue(Math.min(b.to, y.max)), bot = y.getPixelForValue(b.from);
            ctx.fillStyle = b.color; ctx.fillRect(a.left, top, a.width, bot - top);
        });
        ctx.setLineDash([3,3]); ctx.lineWidth = 1;
        [[15,'rgba(74,222,128,0.38)'],[25,'rgba(250,204,21,0.38)'],[50,'rgba(239,68,68,0.38)']].forEach(([v,c]) => {
            if (v > y.max) return;
            const py = y.getPixelForValue(v); ctx.strokeStyle = c; ctx.beginPath(); ctx.moveTo(a.left, py); ctx.lineTo(a.right, py); ctx.stroke();
        });
        ctx.restore();
    }
};

function rainDotColor(v) {
    if (v < 0.5) return 'rgba(74,222,128,0.95)'; if (v < 1.0) return 'rgba(250,204,21,0.95)';
    if (v < 2.0) return 'rgba(251,146,60,0.95)'; return 'rgba(239,68,68,0.95)';
}
function windFill(v) {
    if (v <= 15) return 'rgba(74,222,128,0.80)'; if (v <= 25) return 'rgba(250,204,21,0.80)';
    if (v < 50) return 'rgba(251,146,60,0.82)'; return 'rgba(239,68,68,0.88)';
}
function windBorder(v) {
    if (v <= 15) return 'rgba(74,222,128,1)'; if (v <= 25) return 'rgba(250,204,21,1)';
    if (v < 50) return 'rgba(251,146,60,1)'; return 'rgba(239,68,68,1)';
}
function seaTempColor(v) {
    if (v == null) return 'rgba(0,200,220,0.6)'; if (v <= 10) return '#4488FF'; if (v <= 15) return '#66DD88';
    if (v <= 20) return '#FFE944'; if (v <= 24) return '#FF9933'; if (v <= 26) return '#FF6666'; return '#DD1111';
}
function waveColor(v) {
    if (v == null) return 'rgba(68,136,255,0.55)'; if (v <= 0.10) return 'rgba(68,136,255,0.65)';
    if (v <= 0.50) return 'rgba(255,230,50,0.70)'; if (v <= 1.00) return 'rgba(255,150,40,0.75)';
    if (v <= 1.50) return 'rgba(255,100,100,0.78)'; return 'rgba(210,20,20,0.85)';
}

function xAxisCfg() {
    return {
      ticks: {
        color: 'rgba(255,255,255,0.85)', font: { size: 11 },
        autoSkip: false,
        callback: function(val) {
          const labels = this.chart.data.labels;
          const lbl = labels[val];
          if (!lbl || typeof lbl !== 'string') return '';
          const hour = parseInt(lbl.slice(11, 13));
          const dateStr = lbl.slice(0, 10);
          const dateObj = new Date(dateStr + 'T12:00');
          const dayIdx = dateObj.getDay();
          const count = labels.length;
          const showEvery = count <= 24 ? 2 : 6;
          if (hour % showEvery !== 0) return '';
          if (hour === 0) {
            const now = new Date();
            const todayStr = now.toISOString().slice(0, 10);
            const isToday = dateStr === todayStr;
            let dayName = (isToday) ? ((now.getHours() < 20) ? FULL_DN[dayIdx] : DN[dayIdx]) : FULL_DN[dayIdx];
            return [dayName, "00"];
          }
          return String(hour).padStart(2, '0');
        },
      },
      grid: {
        color: (ctx) => {
          const lbl = ctx.chart.data?.labels?.[ctx.index];
          return (lbl && lbl.slice(11, 13) === '00') ? 'rgba(255,255,255,0.38)' : 'rgba(255,255,255,0.10)';
        },
        lineWidth: (ctx) => {
          const lbl = ctx.chart.data?.labels?.[ctx.index];
          return (lbl && lbl.slice(11, 13) === '00') ? 2 : 1;
        },
      },
    };
}

function getSharedTimeRange(timeArray, range) {
    const step = range === 1 ? 1 : 2;
    const start = getStartIndex(timeArray);
    const end = Math.min(start + range * 24, timeArray.length);
    const labels = [], nightArr = [];
    for (let i = start; i < end; i += step) {
        labels.push(timeArray[i]);
        nightArr.push(isNightAt(timeArray[i], 54.0454, 10.7086));
    }
    return { labels, nightArr, start, end, step };
}

export function getTempChartConfig(allData, range, cities, canvasId = 'temp-chart') {
    const { labels, nightArr, start, end, step } = getSharedTimeRange(allData[0].hourly.time, range);
    const temps = allData.map(d => { const out = []; for (let i = start; i < end; i += step) out.push(d.hourly.temperature_2m[i]); return out; });
    const codes = allData.map(d => { const out = []; for (let i = start; i < end; i += step) out.push(d.hourly.weather_code[i] ?? 0); return out; });
    const rains = allData.map(d => {
      const out = [];
      for (let i = start; i < end; i += step) {
        let s = 0; for (let j = i; j < Math.min(i + step, end, d.hourly.time.length); j++) s += (d.hourly.precipitation[j] ?? 0);
        out.push(Math.round(s * 10) / 10);
      }
      return out;
    });

    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const grads = allData.map((_, i) => {
      const g = ctx.createLinearGradient(0, 0, 0, 290);
      g.addColorStop(0, COL[i].fill); g.addColorStop(1, 'rgba(0,0,0,0)'); return g;
    });

    return {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { type:'bar', label:'HH Regen', data:rains[0], backgroundColor: 'rgba(255,184,48,0.3)', yAxisID:'yRain', order: 5 },
          { type:'bar', label:'GR Regen', data:rains[1], backgroundColor: 'rgba(77,217,255,0.3)', yAxisID:'yRain', order: 6 },
          { type:'line', label:'HH RainDots', data:rains[0], pointRadius:rains[0].map(v=>v>0?4:0), pointBackgroundColor:rains[0].map(rainDotColor), borderWidth:0, pointHoverRadius:0, tension:0, fill:false, yAxisID:'yRain', order: 3 },
          { type:'line', label:'GR RainDots', data:rains[1], pointRadius:rains[1].map(v=>v>0?4:0), pointBackgroundColor:rains[1].map(rainDotColor), borderWidth:0, pointHoverRadius:0, tension:0, fill:false, yAxisID:'yRain', order: 4 },
          { type:'line', label:'HH Temp.', data:temps[0], codes:codes[0], borderColor:COL[0].line, backgroundColor:grads[0], borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:0.30, fill:true, yAxisID:'yTemp', order:1 },
          { type:'line', label:'GR Temp.', data:temps[1], codes:codes[1], borderColor:COL[1].line, backgroundColor:grads[1], borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:0.30, fill:true, yAxisID:'yTemp', order:2 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, fullScreen: false, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y}${c.datasetIndex < 4 ? ' mm' : '°C'}` }},
        },
        scales: {
          x: xAxisCfg(),
          yTemp: { position:'left', ticks:{ color:'rgba(255,255,255,0.85)', font:{size:11}, callback: v => v+'°' }, grid:{ color:'rgba(255,255,255,0.08)' }},
          yRain: { position:'right', beginAtZero:true, ticks:{ color:'rgba(140,210,255,0.90)', font:{size:11}, stepSize: 0.2, callback: v => v+'mm' }, grid:{ drawOnChartArea:false }},
        },
        animation: { duration: 350 },
        layout: { padding: { top: 24, left: 0, right: 0 } },
      },
      plugins: [dayNightPlugin, weatherSymbolPlugin],
      _isNight: nightArr,
      _symEvery: range === 1 ? 3 : 4
    };
}

export function getWindChartConfig(allData, range, cities, canvasId = 'wind-chart') {
    const { labels, nightArr, start, end, step } = getSharedTimeRange(allData[0].hourly.time, range);
    const gr = allData[1];
    const winds = [], dirs = [];
    for (let i = start; i < end; i += step) {
      winds.push(Math.round(gr.hourly.wind_speed_10m[i]));
      dirs.push(gr.hourly.wind_direction_10m[i]);
    }

    return {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Gronenberg', data: winds, dirs,
          backgroundColor: winds.map(windFill), borderColor: winds.map(windBorder), borderWidth: 1, borderRadius: 3,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction:{ mode:'index', intersect:false },
        plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label: c => {
            const dir = c.dataset.dirs?.[c.dataIndex]; return ` ${c.parsed.y} km/h${dir != null ? ' · '+getWindDir(dir) : ''}`;
          }}},
        },
        scales:{
          x: xAxisCfg(),
          y:{ beginAtZero:true, ticks:{ color:'rgba(255,255,255,0.85)', font:{size:11}, callback: v => v }, grid:{ color:'rgba(255,255,255,0.08)' }},
          yGhost: {
            type: 'linear', position: 'right', display: true,
            grid: { display: false }, border: { display: false },
            ticks: { display: true, color: 'transparent', callback: () => '0.0mm' }
          }
        },
        animation: { duration: 350 },
        layout: { padding: { top: 24, left: 0, right: 0 } },
      },
      plugins: [dayNightPlugin, windZonesPlugin, windArrowPlugin],
      _isNight: nightArr
    };
}

export function getSeaChartConfig(marine, range, cities, canvasId = 'sea-chart') {
    const { labels, nightArr, start, end, step } = getSharedTimeRange(marine.hourly.time, range);
    const temps = marine.hourly.sea_surface_temperature;
    const waves = marine.hourly.wave_height;
    const values = [], waveVals = [];
    for (let i = start; i < end; i += step) {
      values.push(temps[i] != null ? Math.round(temps[i] * 10) / 10 : null);
      waveVals.push(waves[i] != null ? Math.round(waves[i] * 100) / 100 : null);
    }

    return {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { type: 'bar', label: 'Wellenhöhe', data: waveVals, backgroundColor: waveVals.map(waveColor), borderWidth: 0, borderRadius: 2, yAxisID: 'yWave', order: 2, spanGaps: true },
          { type: 'line', label: 'Wassertemperatur', data: values, borderColor: '#00C8DC', backgroundColor: 'rgba(0,180,200,0.07)', borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4, tension: 0.35, fill: true, yAxisID: 'yTemp', order: 1, spanGaps: true, segment: { borderColor: ctx => seaTempColor(ctx.p1.parsed.y ?? ctx.p0.parsed.y) }, },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.datasetIndex === 0 ? ` Wellen: ${Math.round((c.parsed.y ?? 0) * 100)} cm` : ` Wasser: ${c.parsed.y} °C` }}},
        scales: {
          x: xAxisCfg(),
          yTemp: { position:'left', ticks:{ color:'rgba(255,255,255,0.85)', font:{size:11}, callback: v => v+'°' }, grid:{ color:'rgba(255,255,255,0.08)' }},
          yWave: { position:'right', beginAtZero:true, ticks:{ color:'rgba(140,200,255,0.85)', font:{size:11}, stepSize:0.05, maxTicksLimit:8, callback: v => Math.round(v*100)+'cm' }, grid:{ drawOnChartArea:false }},
        },
        animation: { duration: 350 },
        layout: { padding: { top: 24, left: 0, right: 0 } },
      },
      plugins: [dayNightPlugin],
      _isNight: nightArr
    };
}
