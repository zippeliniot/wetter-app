// js/tanken.js — Tankstellenpreise (Tankerkoenig), Umkreis Gronenberg
// Liest ausschliesslich die statische data/tanken.json (kein API-Key im Frontend).

let active = false;
let stations = [];
let sortKey = 'e5';

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

function render() {
  const list = document.getElementById('tanken-list');
  if (!list) return;

  const sorted = [...stations].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    const aNum = typeof av === 'number';
    const bNum = typeof bv === 'number';
    if (!aNum && !bNum) return 0;
    if (!aNum) return 1;
    if (!bNum) return -1;
    return av - bv;
  });

  list.innerHTML = sorted.map(st => `
    <div class="card tanken-row ${st.isOpen ? '' : 'closed'}">
      <div>
        <div class="tanken-name">${st.name ?? '—'}${st.brand ? ` · ${st.brand}` : ''}
          <span class="tanken-badge ${st.isOpen ? 'open' : 'closed'}">${st.isOpen ? 'offen' : 'geschlossen'}</span>
        </div>
        <div class="tanken-addr">${[st.street, st.houseNumber].filter(Boolean).join(' ')}, ${[st.postCode, st.place].filter(Boolean).join(' ')}</div>
        <div class="tanken-dist">${fmtDist(st.dist)}</div>
      </div>
      <div class="tanken-prices">
        <div><div class="tanken-price-lbl">E5</div><div class="tanken-price">${fmtPrice(st.e5)}</div></div>
        <div><div class="tanken-price-lbl">E10</div><div class="tanken-price">${fmtPrice(st.e10)}</div></div>
        <div><div class="tanken-price-lbl">Diesel</div><div class="tanken-price">${fmtPrice(st.diesel)}</div></div>
      </div>
    </div>
  `).join('') || '<p class="bz-empty">Keine Stationen gefunden.</p>';
}

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
  } catch (e) {
    console.warn('[tanken]', e);
    if (err) {
      err.textContent = 'Tankstellenpreise konnten nicht geladen werden.';
      err.style.display = 'block';
    }
  }
}

export function setSort(key) {
  sortKey = key;
  document.querySelectorAll('#tanken-sort-toggle .range-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.sort === key);
  });
  render();
}

export function show() {
  active = true;
  document.getElementById('main-view')?.classList.add('hidden');
  document.getElementById('main-header')?.classList.add('hidden');
  document.getElementById('tanken-view')?.classList.remove('hidden');
  document.getElementById('tanken-header')?.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  load();
}

export function hide() {
  active = false;
  document.getElementById('tanken-view')?.classList.add('hidden');
  document.getElementById('tanken-header')?.classList.add('hidden');
  document.getElementById('main-view')?.classList.remove('hidden');
  document.getElementById('main-header')?.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function isActive() {
  return active;
}
