import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { ValidationError } from './store.js';

const root = (p) => fileURLToPath(new URL(p, import.meta.url));

export function createApp(store, { ingestToken } = {}) {
  const app = express();
  app.use(express.json());
  app.use(express.static(root('../public')));
  app.use('/vendor/leaflet', express.static(root('../node_modules/leaflet/dist')));

  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  const broadcast = (msg) => {
    const data = JSON.stringify(msg);
    for (const c of wss.clients) if (c.readyState === 1) c.send(data);
  };

  const ingest = (payload) => {
    const { vehicle, alert } = store.recordPosition(payload);
    broadcast({ type: 'vehicle', vehicle });
    if (alert) broadcast({ type: 'alert', alert });
    return { vehicle, alert };
  };

  const id = (req) => Number(req.params.id);

  app.get('/api/vehicles', (_req, res) => res.json(store.listVehicles()));
  app.post('/api/vehicles', (req, res) => {
    const vehicle = store.addVehicle(req.body ?? {});
    broadcast({ type: 'vehicle', vehicle });
    res.status(201).json(vehicle);
  });
  app.get('/api/vehicles/:id', (req, res) => {
    const v = store.getVehicle(id(req));
    v ? res.json(v) : res.status(404).json({ error: 'Araç bulunamadı' });
  });
  app.delete('/api/vehicles/:id', (req, res) => {
    if (!store.removeVehicle(id(req))) return res.status(404).json({ error: 'Araç bulunamadı' });
    broadcast({ type: 'removed', id: id(req) });
    res.status(204).end();
  });
  app.get('/api/vehicles/:id/history', (req, res) => {
    const to = Number(req.query.to ?? Date.now());
    const from = Number(req.query.from ?? to - 60 * 60 * 1000);
    res.json(store.history(id(req), from, to));
  });
  app.get('/api/alerts', (req, res) => res.json(store.alerts(Math.min(Number(req.query.limit) || 50, 500))));

  // GPS cihazı / mobil uygulama konum gönderimi. Tek nesne veya dizi kabul eder.
  app.post('/api/positions', (req, res) => {
    if (ingestToken && req.get('authorization') !== `Bearer ${ingestToken}`) {
      return res.status(401).json({ error: 'Yetkisiz' });
    }
    const items = Array.isArray(req.body) ? req.body : [req.body ?? {}];
    res.status(201).json(items.map(ingest));
  });

  app.use((err, _req, res, _next) => {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Geçersiz JSON' });
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  });

  return { app, server, wss, ingest };
}
