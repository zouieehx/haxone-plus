'use strict';
// HaxOne Plus — almacenamiento de licencias en JSON (sin base de datos).
// Archivo: DATA_DIR/licenses.json (en Railway va montado en un Volume /data
// para que sobreviva a los redeploys).
// Forma: { licenses: { "<nickNormalizado>": {
//   nick, discordId, discordName, active, since, until } } }
//   until = 0 => permanente. until > 0 => timestamp ms de vencimiento.
const fs = require('fs');
const path = require('path');

function normNick(s) {
  try {
    return String(s || '')
      .split('​').join('')     .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  } catch (e) { return ''; }
}

function filePath() {
  const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
  return path.join(dir, 'licenses.json');
}

function load() {
  const fp = filePath();
  try {
    const raw = fs.readFileSync(fp, 'utf8');
    const m = JSON.parse(raw);
    if (m && typeof m === 'object' && m.licenses && typeof m.licenses === 'object') return m;
  } catch (e) { /* no existe o corrupto: se empieza vacio */ }
  return { licenses: {} };
}

function save(db) {
  const fp = filePath();
  try { fs.mkdirSync(path.dirname(fp), { recursive: true }); } catch (e) {}
  const tmp = fp + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
    fs.renameSync(tmp, fp);
  } catch (e) { /* disco lleno/permisos: se sigue en memoria */ }
}

let db = load();

function get(norm) {
  try { return db.licenses[norm] || null; } catch (e) { return null; }
}

function isActive(rec, now) {
  try {
    if (!rec || rec.active === false) return false;
    const t = now || Date.now();
    if (rec.until && rec.until > 0 && rec.until <= t) return false;
    return true;
  } catch (e) { return false; }
}

function upsert({ nick, discordId, discordName, days }) {
  const norm = normNick(nick);
  if (!norm) return null;
  const now = Date.now();
  const prev = get(norm);
  let until = 0;
  try {
    const d = parseInt(days, 10);
    if (d > 0) until = now + d * 24 * 3600 * 1000;
  } catch (e) { until = 0; }
  const rec = {
    nick: String((prev && prev.nick) || nick || '').replace(/\s+/g, ' ').trim(),
    discordId: String(discordId || (prev && prev.discordId) || ''),
    discordName: String(discordName || (prev && prev.discordName) || ''),
    active: true,
    since: (prev && prev.since) || now,
    until
  };
  db.licenses[norm] = rec;
  save(db);
  return rec;
}

function deactivate(norm) {
  const rec = get(norm);
  if (!rec) return false;
  rec.active = false;
  save(db);
  return true;
}

function deactivateByDiscordId(discordId) {
  let n = 0;
  try {
    for (const k of Object.keys(db.licenses)) {
      if (db.licenses[k] && String(db.licenses[k].discordId) === String(discordId)) {
        db.licenses[k].active = false;
        n++;
      }
    }
    if (n) save(db);
  } catch (e) {}
  return n;
}

function list() {
  try {
    return Object.keys(db.licenses).map(k => Object.assign({ key: k }, db.licenses[k]));
  } catch (e) { return []; }
}

// Desactiva vencidos. Devuelve la lista de registros recien vencidos
// (para que el bot les saque el rol).
function sweepExpired(now) {
  const t = now || Date.now();
  const out = [];
  try {
    for (const k of Object.keys(db.licenses)) {
      const r = db.licenses[k];
      if (r && r.active !== false && r.until && r.until > 0 && r.until <= t) {
        r.active = false;
        out.push(Object.assign({ key: k }, r));
      }
    }
    if (out.length) save(db);
  } catch (e) {}
  return out;
}

module.exports = { normNick, get, isActive, upsert, deactivate, deactivateByDiscordId, list, sweepExpired };
