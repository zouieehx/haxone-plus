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
    if (m && typeof m === 'object' && m.licenses && typeof m.licenses === 'object') {
      if (!m.codes || typeof m.codes !== 'object') m.codes = {};
      if (!m.bans || typeof m.bans !== 'object') m.bans = { nicks: {}, ids: {} };
      if (!m.bans.nicks || typeof m.bans.nicks !== 'object') m.bans.nicks = {};
      if (!m.bans.ids || typeof m.bans.ids !== 'object') m.bans.ids = {};
      return m;
    }
  } catch (e) { /* no existe o corrupto: se empieza vacio */ }
  return { licenses: {}, codes: {}, bans: { nicks: {}, ids: {} } };
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

function keyForDiscord(discordId) { return 'id:' + String(discordId || ''); }

function getByDiscordId(discordId) {
  try {
    const id = String(discordId || '');
    if (!id) return null;
    const direct = get(keyForDiscord(id));
    if (direct) return direct;
    // Migracion: licencias viejas con clave por nick.
    const all = db.licenses || {};
    for (const k of Object.keys(all)) {
      try { if (all[k] && String(all[k].discordId) === id) return all[k]; } catch (e) {}
    }
  } catch (e) {}
  return null;
}

function upsertByDiscordId({ discordId, discordName, days }) {
  const id = String(discordId || '');
  if (!id) return null;
  const now = Date.now();
  const prev = getByDiscordId(id);
  let until = 0;
  try {
    const d = parseInt(days, 10);
    if (d > 0) until = now + d * 24 * 3600 * 1000;
  } catch (e) { until = 0; }
  const rec = {
    nick: (prev && prev.nick) || '',
    discordId: id,
    discordName: String(discordName || (prev && prev.discordName) || ''),
    active: true,
    since: (prev && prev.since) || now,
    until
  };
  db.licenses[keyForDiscord(id)] = rec;
  save(db);
  return rec;
}

const LINKABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function createLinkCode(discordId, discordName) {
  try {
    let code = 'HX-';
    for (let i = 0; i < 6; i++) code += LINKABC[Math.floor(Math.random() * LINKABC.length)];
    if (!db.codes || typeof db.codes !== 'object') db.codes = {};
    db.codes[code] = { discordId: String(discordId || ''), username: String(discordName || ''), created: Date.now() };
    save(db);
    return code;
  } catch (e) { return ''; }
}

function getLinkCode(code) {
  try {
    const c = String(code || '').trim().toUpperCase();
    if (!c || !db.codes || typeof db.codes !== 'object') return null;
    return db.codes[c] || null;
  } catch (e) { return null; }
}

function banAlive(rec, now) {
  try {
    if (!rec || rec.active === false) return false;
    const t = now || Date.now();
    if (rec.until && rec.until > 0 && rec.until <= t) return false;
    return true;
  } catch (e) { return false; }
}

function banNick(nick, reason, by, days) {
  const norm = normNick(nick);
  if (!norm) return null;
  const now = Date.now();
  let until = 0;
  try {
    const d = parseInt(days, 10);
    if (d > 0) until = now + d * 24 * 3600 * 1000;
  } catch (e) { until = 0; }
  if (!db.bans) db.bans = { nicks: {}, ids: {} };
  db.bans.nicks[norm] = { nick: String(nick).replace(/\s+/g, ' ').trim(), reason: String(reason || ''), by: String(by || ''), active: true, since: now, until };
  save(db);
  return db.bans.nicks[norm];
}

function unbanNick(nick) {
  try {
    const norm = normNick(nick);
    if (db.bans && db.bans.nicks && db.bans.nicks[norm]) {
      db.bans.nicks[norm].active = false;
      save(db);
      return true;
    }
  } catch (e) {}
  return false;
}

function banId(discordId, reason, by, days) {
  const id = String(discordId || '');
  if (!id) return null;
  const now = Date.now();
  let until = 0;
  try {
    const d = parseInt(days, 10);
    if (d > 0) until = now + d * 24 * 3600 * 1000;
  } catch (e) { until = 0; }
  if (!db.bans) db.bans = { nicks: {}, ids: {} };
  db.bans.ids[id] = { reason: String(reason || ''), by: String(by || ''), active: true, since: now, until };
  save(db);
  return db.bans.ids[id];
}

function unbanId(discordId) {
  try {
    const id = String(discordId || '');
    if (db.bans && db.bans.ids && db.bans.ids[id]) {
      db.bans.ids[id].active = false;
      save(db);
      return true;
    }
  } catch (e) {}
  return false;
}

// Estado de baneo: primero por cuenta vinculada, despues por nick.
function banStatus({ nick, discordId }) {
  const now = Date.now();
  try {
    const id = String(discordId || '');
    if (id && db.bans && db.bans.ids && banAlive(db.bans.ids[id], now)) {
      return { banned: true, type: 'account', reason: db.bans.ids[id].reason || '' };
    }
  } catch (e) {}
  try {
    const norm = normNick(nick);
    if (norm && db.bans && db.bans.nicks && banAlive(db.bans.nicks[norm], now)) {
      return { banned: true, type: 'nick', reason: db.bans.nicks[norm].reason || '' };
    }
  } catch (e) {}
  return { banned: false };
}

function sweepBans(now) {
  const t = now || Date.now();
  let n = 0;
  try {
    if (db.bans) {
      for (const bag of [db.bans.nicks, db.bans.ids]) {
        if (!bag) continue;
        for (const k of Object.keys(bag)) {
          const r = bag[k];
          if (r && r.active !== false && r.until && r.until > 0 && r.until <= t) { r.active = false; n++; }
        }
      }
      if (n) save(db);
    }
  } catch (e) {}
  return n;
}

// Registro de vinculaciones (seguridad: quien/desde donde). Tope 200.
function logLink({ discordId, username, ip, country, city }) {
  try {
    if (!db.links_log || !Array.isArray(db.links_log)) db.links_log = [];
    db.links_log.unshift({
      discordId: String(discordId || ''),
      username: String(username || ''),
      ip: String(ip || ''),
      country: String(country || ''),
      city: String(city || ''),
      at: Date.now()
    });
    if (db.links_log.length > 200) db.links_log.length = 200;
    save(db);
    return true;
  } catch (e) { return false; }
}

function getLinks({ discordId, limit } = {}) {
  try {
    if (!db.links_log || !Array.isArray(db.links_log)) return [];
    let out = db.links_log;
    if (discordId) out = out.filter((r) => r && String(r.discordId) === String(discordId));
    const n = Math.max(1, Math.min(25, parseInt(limit, 10) || 10));
    return out.slice(0, n);
  } catch (e) { return []; }
}

module.exports = { normNick, get, isActive, upsert, deactivate, deactivateByDiscordId, list, sweepExpired, keyForDiscord, getByDiscordId, upsertByDiscordId, createLinkCode, getLinkCode, banAlive, banNick, unbanNick, banId, unbanId, banStatus, sweepBans, logLink, getLinks };
