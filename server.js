'use strict';
// HaxOne Plus — API de licencias (corre junto al bot en el mismo Railway).
//   GET /health
//   GET /plus/check?nick=<nick de HaxBall> -> { active, nick, until }
// CORS abierto: la app HaxOne consulta desde haxball.com.
// Rate-limit simple en memoria para evitar abuso.
const express = require('express');
const cors = require('cors');

function createServer(store) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: '*', maxAge: 86400 }));
  app.use(express.json({ limit: '64kb' }));

  const hits = new Map();
  app.use((req, res, next) => {
    try {
      const now = Date.now();
      const ip = (req.headers['x-forwarded-for'] || req.ip || '?').toString().split(',')[0].trim();
      let rec = hits.get(ip);
      if (!rec || now - rec.t > 60000) rec = { n: 0, t: now };
      rec.n++;
      hits.set(ip, rec);
      if (rec.n > 240) return res.status(429).json({ error: 'rate_limited' });
      if (hits.size > 5000) hits.clear();
    } catch (e) { /* seguir sin limite */ }
    next();
  });

  app.get('/health', (req, res) => {
    res.json({ ok: true, now: Date.now() });
  });

  app.get('/plus/check', (req, res) => {
    try {
      const nick = String((req.query && req.query.nick) || '');
      const norm = store.normNick(nick);
      if (!norm) return res.json({ active: false, nick: '', until: 0 });
      const rec = store.get(norm);
      const active = store.isActive(rec, Date.now());
      res.json({
        active,
        nick: rec ? rec.nick : '',
        until: rec && rec.until ? rec.until : 0
      });
    } catch (e) {
      res.json({ active: false, nick: '', until: 0 });
    }
  });

  return app;
}

module.exports = { createServer };
