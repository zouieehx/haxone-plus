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
  app.set('trust proxy', 1);
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
      // Via codigo de vinculo (app nueva): ?code=HX-XXXXXX
      const code = String((req.query && req.query.code) || '').trim();
      if (code) {
        const c = store.getLinkCode(code);
        if (!c || !c.discordId) return res.json({ active: false, username: '', until: 0 });
        const rec = store.getByDiscordId(c.discordId);
        const active = store.isActive(rec, Date.now());
        return res.json({ active, username: c.username || '', until: rec && rec.until ? rec.until : 0 });
      }
      // Legacy por nick (transicion).
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

  // Valida un codigo de vinculo y devuelve a quien pertenece.
  // Registra desde donde se vinculo (IP/pais, seguridad). No frena la
  // respuesta: la geolocalizacion corre en segundo plano.
  app.get('/plus/link', (req, res) => {
    try {
      const c = store.getLinkCode((req.query && req.query.code) || '');
      if (!c || !c.discordId) return res.json({ ok: false });
      res.json({ ok: true, discordId: c.discordId, username: c.username || '' });
      try {
        const ip = reqIp(req);
        geoIp(ip).then((g) => {
          try {
            store.logLink({
              discordId: c.discordId, username: c.username || '',
              ip: ip || '', country: (g && g.country) || '', city: (g && g.city) || ''
            });
          } catch (e) {}
        }).catch(() => {});
      } catch (e) {}
    } catch (e) {
      try { res.json({ ok: false }); } catch (e2) {}
    }
  });

  function reqIp(req) {
    try {
      const f = req.headers && req.headers['x-forwarded-for'];
      if (f) return String(f).split(',')[0].trim();
      if (req.ip) return String(req.ip);
      if (req.connection && req.connection.remoteAddress) return String(req.connection.remoteAddress);
    } catch (e) {}
    return '';
  }

  async function geoIp(ip) {
    try {
      const clean = String(ip || '').split(',')[0].trim();
      if (!clean) return null;
      if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc00:|fe80:)/i.test(clean)) {
        return { country: 'local', city: '' };
      }
      const ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const to = setTimeout(() => { try { if (ctl) ctl.abort(); } catch (e) {} }, 3500);
      try {
        const r = await fetch('http://ip-api.com/json/' + encodeURIComponent(clean) + '?fields=status,country,city,query', {
          signal: ctl ? ctl.signal : undefined
        });
        if (!r.ok) return null;
        const j = await r.json();
        if (j && j.status === 'ok') return { country: String(j.country || ''), city: String(j.city || '') };
      } finally {
        try { clearTimeout(to); } catch (e) {}
      }
    } catch (e) {}
    return null;
  }

  function selfBase(req) {
    try {
      const proto = String((req.headers && (req.headers['x-forwarded-proto'] || req.protocol)) || 'https').split(',')[0].trim() || 'https';
      const host = String((req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '').split(',')[0].trim();
      if (!host) return '';
      return proto + '://' + host;
    } catch (e) { return ''; }
  }

  function oauthPage(title, big, sub) {
    const e = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<title>HaxOne Plus</title>'
      + '<style>body{background:#0A0A0A;color:#FFF;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}'
      + '.c{text-align:center;max-width:420px;padding:24px;}h1{font-size:18px;letter-spacing:2px;}'
      + '.code{font-size:34px;font-weight:900;letter-spacing:6px;background:#1A1A1A;border:2px solid #FFF;border-radius:12px;padding:12px 8px;margin:16px 0;}'
      + 'p{color:#D4D4D4;font-size:14px;line-height:1.5;}</style></head><body><div class="c">'
      + '<h1>' + e(title) + '</h1>'
      + (big ? '<div class="code">' + e(big) + '</div>' : '')
      + '<p>' + e(sub) + '</p></div></body></html>';
  }

  // Paso 1: la app manda aca -> redirige a Discord para autorizar.
  app.get('/oauth/discord', (req, res) => {
    try {
      const cid = String(process.env.DISCORD_CLIENT_ID || '').trim();
      if (!cid) return res.status(500).send(oauthPage('Sin configurar', '', 'Falta DISCORD_CLIENT_ID en el servidor.'));
      const redir = selfBase(req).replace(/\/+$/, '') + '/oauth/callback';
      if (!redir || redir.indexOf('http') !== 0) return res.status(500).send(oauthPage('Error', '', 'No se pudo armar la URL.'));
      const u = 'https://discord.com/oauth2/authorize?client_id=' + encodeURIComponent(cid)
        + '&redirect_uri=' + encodeURIComponent(redir)
        + '&response_type=code&scope=' + encodeURIComponent('identify');
      return res.redirect(u);
    } catch (e) {
      res.status(500).send(oauthPage('Error', '', 'Intentalo de nuevo.'));
    }
  });

  // Paso 2: Discord vuelve con ?code= -> se canjea y se muestra el codigo.
  app.get('/oauth/callback', async (req, res) => {
    try {
      const code = String((req.query && req.query.code) || '');
      if (!code) return res.status(400).send(oauthPage('Sin codigo', '', 'Empeza de nuevo desde la app (boton Vincular con Discord).'));
      const cid = String(process.env.DISCORD_CLIENT_ID || '').trim();
      const sec = String(process.env.DISCORD_CLIENT_SECRET || '').trim();
      if (!cid || !sec) return res.status(500).send(oauthPage('Sin configurar', '', 'Falta el secret en el servidor.'));
      const redir = selfBase(req).replace(/\/+$/, '') + '/oauth/callback';
      let tj = null;
      try {
        const tr = await fetch('https://discord.com/api/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: cid, client_secret: sec, grant_type: 'authorization_code', code, redirect_uri: redir })
        });
        if (!tr.ok) return res.status(400).send(oauthPage('Codigo vencido', '', 'Volvé a la app y generá otro (duran minutos).'));
        tj = await tr.json();
      } catch (e) {
        return res.status(500).send(oauthPage('Error de red', '', 'Intentalo de nuevo.'));
      }
      if (!tj || !tj.access_token) return res.status(400).send(oauthPage('No autorizado', '', 'Volvé a autorizar desde la app.'));
      let uj = null;
      try {
        const ur = await fetch('https://discord.com/api/users/@me', {
          headers: { Authorization: 'Bearer ' + tj.access_token }
        });
        if (!ur.ok) return res.status(400).send(oauthPage('Error', '', 'No se pudo leer tu Discord.'));
        uj = await ur.json();
      } catch (e) {
        return res.status(500).send(oauthPage('Error de red', '', 'Intentalo de nuevo.'));
      }
      if (!uj || !uj.id) return res.status(400).send(oauthPage('Error', '', 'No se pudo leer tu Discord.'));
      const linkCode = store.createLinkCode(uj.id, uj.username || '');
      if (!linkCode) return res.status(500).send(oauthPage('Error', '', 'Intentalo de nuevo.'));
      res.send(oauthPage('Cuenta vinculada', linkCode, 'Copiá este código y pegalo en HaxOne para vincularte.'));
    } catch (e) {
      res.status(500).send(oauthPage('Error', '', 'Intentalo de nuevo.'));
    }
  });

  // Estado de baneo: ?nick= y/o ?code= (el codigo resuelve la cuenta).
  app.get('/plus/ban-status', (req, res) => {
    try {
      const nick = String((req.query && req.query.nick) || '');
      const code = String((req.query && req.query.code) || '').trim();
      let discordId = '';
      if (code) {
        try {
          const c = store.getLinkCode(code);
          if (c && c.discordId) discordId = c.discordId;
        } catch (e) {}
      }
      res.json(store.banStatus({ nick, discordId }));
    } catch (e) {
      res.json({ banned: false });
    }
  });

  return app;
}

module.exports = { createServer };
