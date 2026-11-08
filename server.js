import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = join(root, "data");
const dataFile = join(dataDir, "vehicles.json");
const publicDir = join(root, "public");
const port = Number(process.env.PORT || 3000);

const statuses = ["yolda", "bekliyor", "bakimda", "musait"];

function load() {
  if (!existsSync(dataFile)) return { vehicles: [] };
  try {
    const parsed = JSON.parse(readFileSync(dataFile, "utf8"));
    return Array.isArray(parsed.vehicles) ? parsed : { vehicles: [] };
  } catch {
    return { vehicles: [] };
  }
}

function save(store) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(dataFile, JSON.stringify(store, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
      if (chunks.reduce((n, c) => n + c.length, 0) > 1_000_000) {
        reject(new Error("too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("invalid json"));
      }
    });
    req.on("error", reject);
  });
}

function clean(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function vehicleFrom(body, existing) {
  const plate = clean(body.plate, 16).toLocaleUpperCase("tr-TR");
  const name = clean(body.name, 80);
  const driver = clean(body.driver, 80);
  const status = statuses.includes(body.status) ? body.status : "musait";
  const location = clean(body.location, 160);
  const note = clean(body.note, 280);
  if (!plate || !name) {
    const error = new Error("Plaka ve araç adı gerekli.");
    error.status = 400;
    throw error;
  }
  const now = new Date().toISOString();
  return {
    id: existing?.id ?? randomUUID(),
    plate,
    name,
    driver,
    status,
    location,
    note,
    updatedAt: now,
    createdAt: existing?.createdAt ?? now,
  };
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname === "/api/vehicles" && req.method === "GET") {
      return send(res, 200, load());
    }
    if (url.pathname === "/api/vehicles" && req.method === "POST") {
      const store = load();
      const vehicle = vehicleFrom(await readBody(req));
      if (store.vehicles.some((item) => item.plate === vehicle.plate)) {
        return send(res, 409, { error: "Bu plaka zaten kayıtlı." });
      }
      store.vehicles.unshift(vehicle);
      save(store);
      return send(res, 201, vehicle);
    }
    const match = url.pathname.match(/^\/api\/vehicles\/([^/]+)$/);
    if (match && (req.method === "PUT" || req.method === "DELETE")) {
      const store = load();
      const index = store.vehicles.findIndex((item) => item.id === match[1]);
      if (index < 0) return send(res, 404, { error: "Araç bulunamadı." });
      if (req.method === "DELETE") {
        const [removed] = store.vehicles.splice(index, 1);
        save(store);
        return send(res, 200, removed);
      }
      const next = vehicleFrom(await readBody(req), store.vehicles[index]);
      if (store.vehicles.some((item, i) => i !== index && item.plate === next.plate)) {
        return send(res, 409, { error: "Bu plaka zaten kayıtlı." });
      }
      store.vehicles[index] = next;
      save(store);
      return send(res, 200, next);
    }
    if (req.method !== "GET") return send(res, 405, { error: "Yöntem desteklenmiyor." });
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    if (path.includes("..")) return send(res, 400, { error: "Geçersiz yol." });
    const file = join(publicDir, path);
    const ext = path.slice(path.lastIndexOf("."));
    if (!file.startsWith(publicDir) || !types[ext] || !existsSync(file)) {
      return send(res, 404, "Bulunamadı", "text/plain; charset=utf-8");
    }
    send(res, 200, readFileSync(file), types[ext]);
  } catch (error) {
    send(res, error.status || 400, { error: error.message || "İstek işlenemedi." });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Araç takip http://0.0.0.0:${port}`);
});
