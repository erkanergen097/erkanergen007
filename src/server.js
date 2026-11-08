import { createStore } from './store.js';
import { createApp } from './app.js';
import { startSimulator } from './simulator.js';

const PORT = Number(process.env.PORT ?? 3000);
const store = createStore(process.env.DB_FILE ?? 'data/arac-takip.db');
const { server, ingest } = createApp(store, { ingestToken: process.env.INGEST_TOKEN });

if (process.env.SIMULATE !== 'false') {
  startSimulator(store, (p) => {
    try { ingest(p); } catch (e) { console.error('Simülatör:', e.message); }
  });
  console.log('Simülatör aktif (kapatmak için SIMULATE=false)');
}

server.listen(PORT, '0.0.0.0', () => console.log(`Araç takip: http://localhost:${PORT}`));
