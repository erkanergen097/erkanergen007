import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceKm, routeLengthKm } from '../src/geo.js';
import { createStore, OFFLINE_AFTER_MS } from '../src/store.js';
import { createApp } from '../src/app.js';

test('distanceKm: Taksim–Kadıköy yaklaşık 6.3 km', () => {
  const d = distanceKm({ lat: 41.0369, lng: 28.985 }, { lat: 40.9909, lng: 29.0303 });
  assert.ok(Math.abs(d - 6.3) < 0.5, `beklenmeyen mesafe ${d}`);
  assert.equal(routeLengthKm([{ lat: 1, lng: 1 }]), 0);
});

test('store: konum, durum ve hız uyarısı', () => {
  const s = createStore();
  const v = s.addVehicle({ plate: '34 abc 1', speed_limit: 50 });
  assert.equal(v.plate, '34 ABC 1');
  assert.equal(v.status, 'offline');
  assert.throws(() => s.addVehicle({ plate: '34 ABC 1' }), /zaten kayıtlı/);

  const now = Date.now();
  assert.equal(s.recordPosition({ vehicleId: v.id, lat: 41, lng: 29, speed: 40, ts: now - 3000 }).alert, null);
  const r1 = s.recordPosition({ plate: '34 ABC 1', lat: 41.01, lng: 29, speed: 70, ts: now - 2000 });
  assert.equal(r1.alert.type, 'overspeed');
  assert.equal(r1.vehicle.status, 'moving');
  // Limit üstünde kalmaya devam etmek yeni uyarı üretmez.
  assert.equal(s.recordPosition({ vehicleId: v.id, lat: 41.02, lng: 29, speed: 80, ts: now - 1000 }).alert, null);
  assert.equal(s.recordPosition({ vehicleId: v.id, lat: 41.02, lng: 29, speed: 0, ts: now }).vehicle.status, 'idle');
  assert.equal(s.alerts().length, 1);

  const h = s.history(v.id, now - 10_000, now);
  assert.equal(h.points.length, 4);
  assert.ok(h.distanceKm > 2 && h.distanceKm < 2.5);

  assert.equal(s.listVehicles(now + OFFLINE_AFTER_MS + 1)[0].status, 'offline');
  assert.throws(() => s.recordPosition({ vehicleId: v.id, lat: 200, lng: 0 }), /koordinat/);
  assert.throws(() => s.recordPosition({ plate: 'YOK', lat: 0, lng: 0 }), /bulunamadı/);
});

test('HTTP API', async (t) => {
  const store = createStore();
  const { server } = createApp(store, { ingestToken: 'gizli' });
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}`;
  const json = { 'content-type': 'application/json' };

  let res = await fetch(`${base}/api/vehicles`, { method: 'POST', headers: json, body: JSON.stringify({ plate: '06 X 1', speed_limit: 60 }) });
  assert.equal(res.status, 201);
  const v = await res.json();

  res = await fetch(`${base}/api/positions`, { method: 'POST', headers: json, body: JSON.stringify({ vehicleId: v.id, lat: 39.9, lng: 32.8 }) });
  assert.equal(res.status, 401);

  res = await fetch(`${base}/api/positions`, {
    method: 'POST',
    headers: { ...json, authorization: 'Bearer gizli' },
    body: JSON.stringify([{ vehicleId: v.id, lat: 39.9, lng: 32.8, speed: 30 }, { plate: '06 x 1', lat: 39.91, lng: 32.8, speed: 90 }]),
  });
  assert.equal(res.status, 201);
  const out = await res.json();
  assert.equal(out[1].alert.type, 'overspeed');

  res = await fetch(`${base}/api/positions`, { method: 'POST', headers: { ...json, authorization: 'Bearer gizli' }, body: JSON.stringify({ vehicleId: v.id, lat: 'x', lng: 1 }) });
  assert.equal(res.status, 400);

  assert.equal((await (await fetch(`${base}/api/vehicles/${v.id}/history`)).json()).points.length, 2);
  assert.equal((await (await fetch(`${base}/api/alerts`)).json()).length, 1);
  assert.equal((await fetch(`${base}/api/vehicles/${v.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await fetch(`${base}/api/vehicles/${v.id}`)).status, 404);
});
