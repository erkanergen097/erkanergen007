/* global L */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('tr-TR');
const STATUS = { moving: 'Hareket halinde', idle: 'Duruyor', offline: 'Çevrimdışı' };

const map = L.map('map').setView([41.02, 28.98], 11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap',
}).addTo(map);

const vehicles = new Map(); // id -> vehicle
const markers = new Map(); // id -> L.marker
let selectedId = null;
let historyLayer = null;
let fitted = false;

function icon(v) {
  const rot = v.last?.heading ?? 0;
  return L.divIcon({
    className: '',
    iconSize: [80, 40],
    iconAnchor: [40, 11],
    html: `<div class="vmarker"><div class="arrow ${v.status}"><span style="transform:rotate(${rot}deg)">▲</span></div><div class="label">${esc(v.plate)}</div></div>`,
  });
}

function upsertMarker(v) {
  if (!v.last) return;
  const ll = [v.last.lat, v.last.lng];
  let m = markers.get(v.id);
  if (!m) {
    m = L.marker(ll, { icon: icon(v) }).addTo(map).on('click', () => select(v.id));
    markers.set(v.id, m);
  } else {
    m.setLatLng(ll).setIcon(icon(v));
  }
  m.bindTooltip(`${esc(v.name || v.plate)} · ${Math.round(v.last.speed)} km/s`);
  if (v.id === selectedId) map.panTo(ll, { animate: true });
}

function renderList() {
  const list = [...vehicles.values()].sort((a, b) => a.plate.localeCompare(b.plate, 'tr'));
  $('#vehicles').innerHTML = list.map((v) => {
    const speed = v.last ? Math.round(v.last.speed) : '-';
    const over = v.last && v.last.speed > v.speed_limit ? 'over' : '';
    return `<li data-id="${v.id}" class="${v.id === selectedId ? 'selected' : ''}">
      <span class="dot ${v.status}" title="${STATUS[v.status]}"></span>
      <div class="meta"><div class="plate">${esc(v.plate)}</div>
        <div class="sub">${esc([v.name, v.driver].filter(Boolean).join(' · ') || '—')}</div></div>
      <span class="speed ${over}">${speed} km/s</span></li>`;
  }).join('') || '<li>Henüz araç yok</li>';

  const count = (s) => list.filter((v) => v.status === s).length;
  $('#summary').innerHTML = `<div><b>${count('moving')}</b>Hareket</div><div><b>${count('idle')}</b>Duran</div><div><b>${count('offline')}</b>Çevrimdışı</div>`;
  if (selectedId) renderDetail();
}

function renderDetail() {
  const v = vehicles.get(selectedId);
  if (!v) return;
  $('#detail-info').innerHTML = `<b>${esc(v.plate)}</b> ${esc(v.name)}<br>
    Sürücü: ${esc(v.driver || '—')}<br>
    Durum: ${STATUS[v.status]} · Limit: ${v.speed_limit} km/s<br>
    Son sinyal: ${v.last ? fmtTime(v.last.ts) : '—'}
    <br><button class="link" id="delete-vehicle">Aracı sil</button>`;
}

async function loadHistory() {
  if (!selectedId) return;
  const minutes = Number($('#range').value);
  const to = Date.now();
  const res = await fetch(`/api/vehicles/${selectedId}/history?from=${to - minutes * 60000}&to=${to}`);
  const { points, distanceKm } = await res.json();
  historyLayer?.remove();
  historyLayer = L.polyline(points.map((p) => [p.lat, p.lng]), { color: '#4f46e5', weight: 4, opacity: 0.7 }).addTo(map);
  const maxSpeed = points.reduce((m, p) => Math.max(m, p.speed), 0);
  $('#history-info').textContent = points.length
    ? `${points.length} nokta · ${distanceKm.toFixed(2)} km · maks. ${Math.round(maxSpeed)} km/s`
    : 'Bu aralıkta kayıt yok';
}

function select(id) {
  selectedId = id;
  $('#detail').hidden = false;
  const v = vehicles.get(id);
  if (v?.last) map.setView([v.last.lat, v.last.lng], 14);
  renderList();
  loadHistory();
}

function deselect() {
  selectedId = null;
  $('#detail').hidden = true;
  historyLayer?.remove();
  historyLayer = null;
  renderList();
}

function addAlert(a, isNew = false) {
  const li = document.createElement('li');
  if (isNew) li.className = 'new';
  li.innerHTML = `<time>${fmtTime(a.ts)}</time>${esc(a.message)}`;
  $('#alerts').prepend(li);
  while ($('#alerts').children.length > 50) $('#alerts').lastChild.remove();
}

$('#vehicles').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (li) select(Number(li.dataset.id));
});
$('#close-detail').addEventListener('click', deselect);
$('#range').addEventListener('change', loadHistory);
$('#detail').addEventListener('click', async (e) => {
  if (e.target.id !== 'delete-vehicle' || !selectedId) return;
  if (!confirm('Araç ve tüm geçmişi silinsin mi?')) return;
  await fetch(`/api/vehicles/${selectedId}`, { method: 'DELETE' });
});
$('#add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  const res = await fetch('/api/vehicles', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json();
  $('#add-error').textContent = res.ok ? '' : data.error;
  if (res.ok) e.target.reset();
});

function removeVehicle(id) {
  vehicles.delete(id);
  markers.get(id)?.remove();
  markers.delete(id);
  if (selectedId === id) deselect(); else renderList();
}

async function loadAll() {
  const [vs, alerts] = await Promise.all([
    fetch('/api/vehicles').then((r) => r.json()),
    fetch('/api/alerts?limit=50').then((r) => r.json()),
  ]);
  for (const id of [...vehicles.keys()]) if (!vs.some((v) => v.id === id)) removeVehicle(id);
  for (const v of vs) { vehicles.set(v.id, v); upsertMarker(v); }
  $('#alerts').innerHTML = '';
  alerts.reverse().forEach((a) => addAlert(a));
  renderList();
  if (!fitted && markers.size) {
    map.fitBounds(L.featureGroup([...markers.values()]).getBounds().pad(0.2));
    fitted = true;
  }
}

function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => { $('#conn').className = 'conn on'; loadAll(); };
  ws.onclose = () => { $('#conn').className = 'conn off'; setTimeout(connect, 2000); };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'vehicle') {
      vehicles.set(msg.vehicle.id, msg.vehicle);
      upsertMarker(msg.vehicle);
      if (msg.vehicle.id === selectedId && historyLayer && msg.vehicle.last) {
        historyLayer.addLatLng([msg.vehicle.last.lat, msg.vehicle.last.lng]);
      }
      renderList();
    } else if (msg.type === 'alert') {
      addAlert(msg.alert, true);
    } else if (msg.type === 'removed') {
      removeVehicle(msg.id);
    }
  };
}

connect();
// Sinyal kesilen araçların "çevrimdışı" durumuna geçmesi için periyodik yenileme.
setInterval(loadAll, 60000);
