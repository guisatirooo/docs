#!/usr/bin/env node
// Baixa uma foto de cada carro para ../img/<slug>.jpg  (Node 18+)
// Uso:  cd carros-colecao && node tools/baixar-fotos.mjs [--force]
// Fontes (nessa ordem): wikis de Carros no Fandom – miniaturas (carstoys) primeiro, depois os personagens.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imgDir = path.join(root, "img");
fs.mkdirSync(imgDir, { recursive: true });
const force = process.argv.includes("--force");
const HOSTS = ["carstoys.fandom.com", "pixarcars.fandom.com", "cars.fandom.com"];
const UA = { "User-Agent": "carros-colecao/1.0 (uso pessoal)" };

const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, "assets/data.js"), "utf8"), ctx);
const slug = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const norm = s => slug(s).replace(/-/g, "");

async function api(host, params) {
  const u = `https://${host}/api.php?format=json&redirects=1&` + new URLSearchParams(params);
  try { const r = await fetch(u, { headers: UA }); return r.ok ? await r.json() : null; } catch { return null; }
}
const thumbOf = j => Object.values(j?.query?.pages || {}).filter(p => p.thumbnail).map(p => ({ title: p.title, url: p.thumbnail.source, idx: p.index ?? 0 }));

async function find(car) {
  const name = car.wiki || car.name;
  const clean = name.replace(/\s*\(.*?\)\s*/g, " ").trim();
  for (const host of HOSTS) {
    // 1) página com título exato
    for (const t of [...new Set([name, clean])]) {
      const hit = thumbOf(await api(host, { action: "query", prop: "pageimages", piprop: "thumbnail", pithumbsize: 600, titles: t }))[0];
      if (hit) return { ...hit, host };
    }
    // 2) busca: melhor resultado cujo título contém o nome
    const hits = thumbOf(await api(host, { action: "query", generator: "search", gsrsearch: clean, gsrlimit: 8, gsrnamespace: 0, prop: "pageimages", piprop: "thumbnail", pithumbsize: 600 }))
      .sort((a, b) => a.idx - b.idx);
    const good = hits.find(h => norm(h.title).includes(norm(clean)));
    if (good) return { ...good, host };
  }
  return null;
}

const cars = new Map();
for (const f of ctx.window.FILMS) for (const a of f.cars) cars.set(slug(a[0]), { name: a[0], wiki: a[5] || a[0] });
const missing = []; let ok = 0, skip = 0, i = 0;
for (const [s, car] of cars) {
  i++; const file = path.join(imgDir, s + ".jpg");
  if (!force && fs.existsSync(file)) { skip++; continue; }
  const hit = await find(car);
  if (!hit) { missing.push(car.name); console.log(`[${i}/${cars.size}] ✗ ${car.name}`); continue; }
  try {
    const r = await fetch(hit.url, { headers: UA }); if (!r.ok) throw new Error(r.status);
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); ok++;
    console.log(`[${i}/${cars.size}] ✓ ${car.name}  ←  ${hit.host} · ${hit.title}`);
  } catch (e) { missing.push(car.name); console.log(`[${i}/${cars.size}] ✗ ${car.name} (${e.message})`); }
}
console.log(`\nBaixadas: ${ok} · já existiam: ${skip} · sem foto: ${missing.length}`);
if (missing.length) console.log("Sem foto (coloque manualmente em img/<slug>.jpg):\n - " + missing.join("\n - "));
