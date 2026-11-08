import { bearing, distanceKm } from './geo.js';

// İstanbul'da birkaç örnek güzergâh (döngüsel).
const ROUTES = [
  [[41.0082, 28.9784], [41.0151, 28.9795], [41.0255, 28.9744], [41.0369, 28.9850], [41.0422, 29.0076], [41.0255, 29.0150], [41.0082, 28.9784]],
  [[40.9909, 29.0303], [40.9820, 29.0570], [40.9700, 29.0800], [40.9850, 29.1000], [41.0030, 29.0700], [40.9909, 29.0303]],
  [[41.0766, 29.0123], [41.0850, 29.0380], [41.1050, 29.0230], [41.0950, 28.9900], [41.0766, 29.0123]],
  [[41.0400, 28.8900], [41.0200, 28.8400], [40.9900, 28.8000], [41.0050, 28.8600], [41.0400, 28.8900]],
];

export const DEMO_VEHICLES = [
  { plate: '34 ABC 101', name: 'Kamyonet 1', driver: 'Ahmet Yılmaz', speed_limit: 70 },
  { plate: '34 DEF 202', name: 'Servis 2', driver: 'Mehmet Kaya', speed_limit: 60 },
  { plate: '34 GHJ 303', name: 'Binek 3', driver: 'Ayşe Demir', speed_limit: 80 },
  { plate: '34 KLM 404', name: 'Tır 4', driver: 'Fatma Şahin', speed_limit: 70 },
];

/** Demo araçlarını güzergâhlarda hareket ettirir ve konumları onPosition'a iletir. */
export function startSimulator(store, onPosition, { intervalMs = 2000 } = {}) {
  for (const v of DEMO_VEHICLES) {
    try { store.addVehicle(v); } catch { /* zaten var */ }
  }
  const sims = DEMO_VEHICLES.map((v, i) => {
    const route = ROUTES[i % ROUTES.length].map(([lat, lng]) => ({ lat, lng }));
    return { plate: v.plate, route, pos: { ...route[0] }, next: 1, speed: 40, stopTicks: 0 };
  });

  const tick = () => {
    for (const s of sims) {
      if (s.stopTicks > 0) {
        s.stopTicks--;
        s.speed = 0;
      } else {
        if (Math.random() < 0.02) s.stopTicks = 5 + Math.floor(Math.random() * 10);
        s.speed = Math.min(115, Math.max(15, s.speed + (Math.random() - 0.45) * 15));
      }
      // Görselde hareket belirgin olsun diye simülasyon zamanı 10x hızlı.
      let remaining = (s.speed * intervalMs * 10) / 3_600_000;
      while (remaining > 0) {
        const target = s.route[s.next];
        const d = distanceKm(s.pos, target);
        if (d <= remaining) {
          s.pos = { ...target };
          s.next = (s.next + 1) % s.route.length;
          remaining -= d;
        } else {
          const f = remaining / d;
          s.pos = { lat: s.pos.lat + (target.lat - s.pos.lat) * f, lng: s.pos.lng + (target.lng - s.pos.lng) * f };
          remaining = 0;
        }
      }
      const heading = bearing(s.pos, s.route[s.next]);
      onPosition({ plate: s.plate, lat: s.pos.lat, lng: s.pos.lng, speed: Math.round(s.speed), heading });
    }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
