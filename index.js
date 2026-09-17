'use strict';
// HaxOne Plus — arranque: API + bot en el mismo proceso (un solo Railway).
const store = require('./store');
const { createServer } = require('./server');
const { startBot } = require('./bot');

const PORT = parseInt(process.env.PORT || '3000', 10) || 3000;

async function main() {
  try {
    const app = createServer(store);
    app.listen(PORT, () => console.log('[api] Escuchando en puerto ' + PORT));
  } catch (e) {
    console.log('[api] No se pudo levantar: ' + (e && e.message ? e.message : e));
    process.exit(1);
  }
  try {
    await startBot(store);
  } catch (e) {
    console.log('[bot] No se pudo conectar (la API sigue andando): ' + (e && e.message ? e.message : e));
  }
}

main();
