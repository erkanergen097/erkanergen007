# Araç Takip

Canlı harita üzerinde araç takibi: anlık konum, rota geçmişi, hız aşımı uyarıları.

## Çalıştırma

```bash
npm install
npm start        # http://localhost:3000
npm test
```

Varsayılan olarak İstanbul'da hareket eden 4 demo araç simüle edilir.

| Ortam değişkeni | Varsayılan | Açıklama |
| --- | --- | --- |
| `PORT` | `3000` | HTTP portu |
| `DB_FILE` | `data/arac-takip.db` | SQLite veritabanı dosyası |
| `SIMULATE` | `true` | `false` ise demo araçlar çalışmaz |
| `INGEST_TOKEN` | — | Ayarlanırsa `/api/positions` için `Authorization: Bearer <token>` gerekir |

## Özellikler

- Leaflet/OpenStreetMap haritasında canlı konum (WebSocket ile anlık)
- Araç durumu: hareket halinde / duruyor / çevrimdışı (5 dk sinyal yoksa)
- Seçilen aracın rota geçmişi (15 dk – 24 saat), toplam km ve maks. hız
- Araç bazlı hız limiti ve hız aşımı uyarıları
- Araç ekleme / silme

## GPS cihazı veya mobil uygulamadan konum gönderme

```bash
curl -X POST http://localhost:3000/api/positions \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <INGEST_TOKEN>' \
  -d '{"plate":"34 ABC 101","lat":41.01,"lng":28.97,"speed":55,"heading":90}'
```

`vehicleId` veya `plate` ile araç belirtilir; `speed` (km/s), `heading` (derece) ve `ts` (ms) isteğe bağlıdır. Toplu gönderim için dizi kabul edilir.

## API

| Yöntem | Yol | Açıklama |
| --- | --- | --- |
| GET | `/api/vehicles` | Araçlar ve son konumları |
| POST | `/api/vehicles` | Araç ekle (`plate`, `name`, `driver`, `speed_limit`) |
| GET / DELETE | `/api/vehicles/:id` | Araç detayı / silme |
| GET | `/api/vehicles/:id/history?from=&to=` | Rota geçmişi (ms zaman damgaları) |
| GET | `/api/alerts?limit=` | Son uyarılar |
| POST | `/api/positions` | Konum gönderimi |
| WS | `/ws` | `vehicle`, `alert`, `removed` olayları |
