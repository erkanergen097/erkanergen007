import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { routeLengthKm } from './geo.js';

export const OFFLINE_AFTER_MS = 5 * 60 * 1000;
const IDLE_SPEED_KMH = 3;

export class ValidationError extends Error {}

export function createStore(file = ':memory:') {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY,
      plate TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      driver TEXT NOT NULL DEFAULT '',
      speed_limit INTEGER NOT NULL DEFAULT 90
    );
    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY,
      vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      lat REAL NOT NULL, lng REAL NOT NULL,
      speed REAL NOT NULL DEFAULT 0, heading REAL NOT NULL DEFAULT 0,
      ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS positions_vehicle_ts ON positions(vehicle_id, ts);
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY,
      vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      type TEXT NOT NULL, message TEXT NOT NULL,
      ts INTEGER NOT NULL
    );
  `);

  const q = {
    vehicles: db.prepare('SELECT * FROM vehicles ORDER BY plate'),
    vehicleById: db.prepare('SELECT * FROM vehicles WHERE id = ?'),
    vehicleByPlate: db.prepare('SELECT * FROM vehicles WHERE plate = ?'),
    insertVehicle: db.prepare(
      'INSERT INTO vehicles (plate, name, driver, speed_limit) VALUES (?, ?, ?, ?)'
    ),
    deleteVehicle: db.prepare('DELETE FROM vehicles WHERE id = ?'),
    lastPosition: db.prepare(
      'SELECT * FROM positions WHERE vehicle_id = ? ORDER BY ts DESC, id DESC LIMIT 1'
    ),
    insertPosition: db.prepare(
      'INSERT INTO positions (vehicle_id, lat, lng, speed, heading, ts) VALUES (?, ?, ?, ?, ?, ?)'
    ),
    history: db.prepare(
      'SELECT lat, lng, speed, heading, ts FROM positions WHERE vehicle_id = ? AND ts BETWEEN ? AND ? ORDER BY ts, id'
    ),
    insertAlert: db.prepare(
      'INSERT INTO alerts (vehicle_id, type, message, ts) VALUES (?, ?, ?, ?)'
    ),
    alerts: db.prepare(
      `SELECT a.*, v.plate FROM alerts a JOIN vehicles v ON v.id = a.vehicle_id
       ORDER BY a.ts DESC, a.id DESC LIMIT ?`
    ),
  };

  function status(pos, now) {
    if (!pos || now - pos.ts > OFFLINE_AFTER_MS) return 'offline';
    return pos.speed < IDLE_SPEED_KMH ? 'idle' : 'moving';
  }

  function withPosition(v, now = Date.now()) {
    const last = q.lastPosition.get(v.id) ?? null;
    return { ...v, last, status: status(last, now) };
  }

  return {
    db,
    listVehicles: (now = Date.now()) => q.vehicles.all().map((v) => withPosition(v, now)),
    getVehicle(id) {
      const v = q.vehicleById.get(id);
      return v ? withPosition(v) : null;
    },
    addVehicle({ plate, name = '', driver = '', speed_limit = 90 }) {
      plate = String(plate ?? '').trim().toUpperCase();
      if (!plate) throw new ValidationError('Plaka zorunlu');
      const limit = Number(speed_limit);
      if (!Number.isFinite(limit) || limit <= 0) throw new ValidationError('Geçersiz hız limiti');
      if (q.vehicleByPlate.get(plate)) throw new ValidationError('Bu plaka zaten kayıtlı');
      const { lastInsertRowid } = q.insertVehicle.run(plate, String(name), String(driver), limit);
      return this.getVehicle(Number(lastInsertRowid));
    },
    removeVehicle: (id) => q.deleteVehicle.run(id).changes > 0,

    /** Konum kaydeder; hız limiti yeni aşıldıysa uyarı da üretir. */
    recordPosition({ vehicleId, plate, lat, lng, speed = 0, heading = 0, ts = Date.now() }) {
      const v = vehicleId != null
        ? q.vehicleById.get(Number(vehicleId))
        : q.vehicleByPlate.get(String(plate ?? '').trim().toUpperCase());
      if (!v) throw new ValidationError('Araç bulunamadı');
      [lat, lng, speed, heading, ts] = [lat, lng, speed, heading, ts].map(Number);
      if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) throw new ValidationError('Geçersiz koordinat');
      if (!Number.isFinite(speed) || speed < 0) throw new ValidationError('Geçersiz hız');
      if (!Number.isFinite(ts)) throw new ValidationError('Geçersiz zaman');

      const prev = q.lastPosition.get(v.id);
      q.insertPosition.run(v.id, lat, lng, speed, Number.isFinite(heading) ? heading : 0, ts);

      let alert = null;
      // Sadece limitin altından üstüne geçişte uyar, her pakette değil.
      if (speed > v.speed_limit && !(prev && prev.speed > v.speed_limit)) {
        const message = `${v.plate} hız limitini aştı: ${Math.round(speed)} km/s (limit ${v.speed_limit})`;
        const r = q.insertAlert.run(v.id, 'overspeed', message, ts);
        alert = { id: Number(r.lastInsertRowid), vehicle_id: v.id, plate: v.plate, type: 'overspeed', message, ts };
      }
      return { vehicle: withPosition(v), alert };
    },

    history(id, from, to) {
      const points = q.history.all(id, from, to);
      return { points, distanceKm: routeLengthKm(points) };
    },
    alerts: (limit = 50) => q.alerts.all(limit),
  };
}
