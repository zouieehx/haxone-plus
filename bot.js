'use strict';
// HaxOne Plus — bot de Discord.
// Comandos (solo admins):
//   /addplus usuario:<@persona> [dias:<n>]
//       Da el rol Plus + registra la licencia en su cuenta de Discord
//       (despues vincula la cuenta en la app, sin depender del nick).
//       dias=0 (default) = permanente.
//   /removeplus usuario:<@persona>
//       Saca el rol + desactiva su licencia.
//   /plusinfo [usuario] [nick]
//       Muestra si tiene Plus, hasta cuando y con que nick.
//   /pluslist
//       Lista los Plus activos (ultimos 25).
//   /blacklist [usuario] [nick] [motivo] [dias]
//       Bloquea la app (no puede entrar a jugar). Por cuenta y/o nick.
//   /unblacklist [usuario] [nick]
//       Quita el bloqueo.
//   /vinculados [usuario]
//       Cuentas vinculadas a la app con IP/pais (seguridad).
// Flujo de cobro manual: te pagan por tu alias, vos corres /addplus y listo.
// Cuando el Plus vence (si pusiste dias), el bot solo le saca el rol y la
// app se le bloquea sola en la proxima verificacion.
const {
  Client, GatewayIntentBits, SlashCommandBuilder,
  PermissionFlagsBits, EmbedBuilder, REST, Routes
} = require('discord.js');

const COMMANDS = [
  new SlashCommandBuilder()
    .setName('addplus')
    .setDescription('Dar Plus a un usuario (cobro manual ya recibido)')
    .addUserOption(o => o.setName('usuario').setDescription('Persona a la que das Plus (@)').setRequired(true))
    .addIntegerOption(o => o.setName('dias').setDescription('Duracion en dias, 0 = permanente (default)').setRequired(false).setMinValue(0).setMaxValue(3650))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('removeplus')
    .setDescription('Quitar el Plus a un usuario')
    .addUserOption(o => o.setName('usuario').setDescription('Persona a la que quitas Plus').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('plusinfo')
    .setDescription('Ver el estado Plus de alguien')
    .addUserOption(o => o.setName('usuario').setDescription('Por usuario de Discord').setRequired(false))
    .addStringOption(o => o.setName('nick').setDescription('Por nick de HaxBall').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('pluslist')
    .setDescription('Listar licencias Plus activas')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Bloquear a alguien de la app (no puede entrar a jugar)')
    .addUserOption(o => o.setName('usuario').setDescription('Por cuenta de Discord (@)').setRequired(false))
    .addStringOption(o => o.setName('nick').setDescription('Por nick de HaxBall').setRequired(false))
    .addStringOption(o => o.setName('motivo').setDescription('Motivo (lo ve el bloqueado)').setRequired(false))
    .addIntegerOption(o => o.setName('dias').setDescription('Duracion en dias, 0 = permanente (default)').setRequired(false).setMinValue(0).setMaxValue(3650))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('unblacklist')
    .setDescription('Desbloquear a alguien de la app')
    .addUserOption(o => o.setName('usuario').setDescription('Por cuenta de Discord (@)').setRequired(false))
    .addStringOption(o => o.setName('nick').setDescription('Por nick de HaxBall').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('vinculados')
    .setDescription('Ver cuentas vinculadas a la app (IP/pais, seguridad)')
    .addUserOption(o => o.setName('usuario').setDescription('Filtrar por persona (@)').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON()
];

function fmtUntil(until) {
  if (!until) return 'permanente';
  try {
    const d = new Date(until);
    return d.toLocaleDateString('es-AR') + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  } catch (e) { return 'permanente'; }
}

function isAdmin(interaction) {
  try {
    const adminRole = String(process.env.ADMIN_ROLE_ID || '').trim();
    const m = interaction.member;
    if (!m) return false;
    if (typeof m.permissions !== 'undefined' && m.permissions.has(PermissionFlagsBits.Administrator)) return true;
    if (adminRole && m.roles && m.roles.cache && m.roles.cache.has(adminRole)) return true;
  } catch (e) {}
  return false;
}

async function startBot(store) {
  const token = String(process.env.DISCORD_TOKEN || '').trim();
  const guildId = String(process.env.DISCORD_GUILD_ID || '').trim();
  const plusRoleId = String(process.env.PLUS_ROLE_ID || '').trim();
  if (!token) {
    console.log('[bot] DISCORD_TOKEN vacio: API sola, bot apagado.');
    return null;
  }
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

  client.once('ready', async () => {
    try {
      console.log('[bot] Conectado como ' + (client.user && client.user.tag));
      if (guildId && client.application) {
        const rest = new REST({ version: '10' }).setToken(token);
        await rest.put(Routes.applicationGuildCommands(client.application.id, guildId), { body: COMMANDS });
        console.log('[bot] Comandos registrados en el servidor.');
      } else {
        console.log('[bot] Sin DISCORD_GUILD_ID: comandos no registrados.');
      }
    } catch (e) {
      console.log('[bot] Error registrando comandos: ' + (e && e.message ? e.message : e));
    }
    try { await sweepAndClean(client, store, plusRoleId); } catch (e) {}
  });

  client.on('interactionCreate', async (interaction) => {
    try {
      if (!interaction.isChatInputCommand()) return;
      if (!isAdmin(interaction)) {
        await interaction.reply({ content: 'No tenes permiso para usar esto.', ephemeral: true });
        return;
      }
      const name = interaction.commandName;
      if (name === 'addplus') await cmdAddPlus(interaction, store, plusRoleId);
      else if (name === 'removeplus') await cmdRemovePlus(interaction, store, plusRoleId);
      else if (name === 'plusinfo') await cmdPlusInfo(interaction, store);
      else if (name === 'pluslist') await cmdPlusList(interaction, store);
      else if (name === 'blacklist') await cmdBlacklist(interaction, store);
      else if (name === 'unblacklist') await cmdUnblacklist(interaction, store);
      else if (name === 'vinculados') await cmdVinculados(interaction, store);
    } catch (e) {
      try {
        if (interaction.deferred || interaction.replied) await interaction.followUp({ content: 'Error interno.', ephemeral: true });
        else await interaction.reply({ content: 'Error interno.', ephemeral: true });
      } catch (e2) {}
    }
  });

  // Limpieza de vencidos cada 10 minutos.
  setInterval(() => { sweepAndClean(client, store, plusRoleId).catch(() => {}); }, 10 * 60 * 1000);

  await client.login(token);
  return client;
}

async function cmdAddPlus(interaction, store, plusRoleId) {
  const user = interaction.options.getUser('usuario', true);
  let dias = 0;
  try { dias = interaction.options.getInteger('dias') || 0; } catch (e) { dias = 0; }
  await interaction.deferReply({ ephemeral: true });
  try {
    const rec = store.upsertByDiscordId({ discordId: user.id, discordName: user.username, days: dias });
    if (!rec) {
      await interaction.editReply('No se pudo registrar.');
      return;
    }
    let member = null;
    try { member = interaction.guild ? await interaction.guild.members.fetch(user.id) : null; } catch (e) { member = null; }
    let roleOk = false;
    if (member && plusRoleId) {
      try { await member.roles.add(plusRoleId, 'HaxOne Plus activado'); roleOk = true; } catch (e) { roleOk = false; }
    }
    const emb = new EmbedBuilder()
      .setTitle('Plus activado')
      .addFields(
        { name: 'Usuario', value: '<@' + user.id + '>', inline: true },
        { name: 'Hasta', value: fmtUntil(rec.until), inline: true },
        { name: 'Vincular', value: 'En HaxOne: pestana Plus, boton Vincular con Discord.', inline: false }
      )
      .setFooter({ text: roleOk ? 'Rol Plus dado.' : 'OJO: no pude dar el rol (revisa PLUS_ROLE_ID y mis permisos).' })
      .setTimestamp(new Date());
    await interaction.editReply({ embeds: [emb] });
    try {
      await user.send(
        'Tu **HaxOne Plus** esta activo (' + fmtUntil(rec.until) + ').\n' +
        'Vincula tu cuenta: abri HaxOne, pestaña Plus, botón **Vincular con Discord**, autoriza y pegá el código.\n' +
        'Desde ahí el Plus sigue a tu cuenta, no a tu nick.'
      );
    } catch (e) { /* MD cerrados: no pasa nada */ }
  } catch (e) {
    await interaction.editReply('No se pudo activar: ' + (e && e.message ? e.message : e));
  }
}

async function cmdRemovePlus(interaction, store, plusRoleId) {
  const user = interaction.options.getUser('usuario', true);
  await interaction.deferReply({ ephemeral: true });
  try {
    const n = store.deactivateByDiscordId(user.id);
    let member = null;
    try { member = interaction.guild ? await interaction.guild.members.fetch(user.id) : null; } catch (e) { member = null; }
    if (member && plusRoleId) {
      try { await member.roles.remove(plusRoleId, 'HaxOne Plus quitado'); } catch (e) {}
    }
    await interaction.editReply(n > 0
      ? 'Plus quitado a <@' + user.id + '> (' + n + ' licencia(s)).'
      : 'Ese usuario no tenia licencia registrada (igual le saque el rol si lo tenia).');
  } catch (e) {
    await interaction.editReply('Error: ' + (e && e.message ? e.message : e));
  }
}

async function cmdPlusInfo(interaction, store) {
  let user = null, nick = '';
  try { user = interaction.options.getUser('usuario', false); } catch (e) { user = null; }
  try { nick = String(interaction.options.getString('nick') || '').trim(); } catch (e) { nick = ''; }
  await interaction.deferReply({ ephemeral: true });
  try {
    let rec = null;
    if (nick) rec = store.get(store.normNick(nick));
    else if (user) {
      const all = store.list();
      rec = all.find(r => String(r.discordId) === String(user.id)) || null;
      // Si tiene varias, mostrar la activa primero.
      if (!rec) rec = null;
    } else {
      await interaction.editReply('Pasame `usuario` o `nick`.');
      return;
    }
    if (!rec) { await interaction.editReply('Sin licencia.'); return; }
    const on = store.isActive(rec, Date.now());
    await interaction.editReply(
      '**' + rec.nick + '** — ' + (on ? 'ACTIVO' : 'inactivo') +
      ' — <@' + rec.discordId + '> — hasta: ' + fmtUntil(rec.until)
    );
  } catch (e) {
    await interaction.editReply('Error: ' + (e && e.message ? e.message : e));
  }
}

async function cmdPlusList(interaction, store) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const now = Date.now();
    const act = store.list().filter(r => store.isActive(r, now)).slice(0, 25);
    if (!act.length) { await interaction.editReply('No hay Plus activos.'); return; }
    const lines = act.map(r => '`' + r.nick + '` — <@' + r.discordId + '> — ' + fmtUntil(r.until));
    await interaction.editReply('**Plus activos (' + act.length + '):**\n' + lines.join('\n'));
  } catch (e) {
    await interaction.editReply('Error: ' + (e && e.message ? e.message : e));
  }
}

function banTarget(interaction) {
  // Devuelve { user, nick } con lo que haya pasado (al menos uno).
  let user = null, nick = '';
  try { user = interaction.options.getUser('usuario', false); } catch (e) { user = null; }
  try { nick = String(interaction.options.getString('nick') || '').trim(); } catch (e) { nick = ''; }
  return { user, nick };
}

async function cmdBlacklist(interaction, store) {
  const { user, nick } = banTarget(interaction);
  let motivo = '', dias = 0;
  try { motivo = String(interaction.options.getString('motivo') || '').trim(); } catch (e) { motivo = ''; }
  try { dias = interaction.options.getInteger('dias') || 0; } catch (e) { dias = 0; }
  await interaction.deferReply({ ephemeral: true });
  try {
    if (!user && !nick) {
      await interaction.editReply('Pasame `usuario` o `nick`: `/blacklist usuario:@x` o `/blacklist nick:Name`.');
      return;
    }
    const by = interaction.user ? String(interaction.user.username || '') : '';
    const parts = [];
    if (user) {
      const r = store.banId(user.id, motivo, by, dias);
      if (r) parts.push('cuenta <@' + user.id + '>');
      try {
        await user.send('Fuiste **bloqueado de HaxOne**' + (motivo ? ' (' + motivo + ')' : '') + '. Habla con un admin en Discord.');
      } catch (eDM) {}
    }
    if (nick) {
      const r = store.banNick(nick, motivo, by, dias);
      if (r) parts.push('nick `' + r.nick + '`');
    }
    if (!parts.length) { await interaction.editReply('No se pudo bloquear.'); return; }
    const until = dias > 0 ? (' hasta ' + fmtUntil(Date.now() + dias * 24 * 3600 * 1000)) : ' (permanente)';
    await interaction.editReply('Bloqueado: ' + parts.join(' + ') + until + (motivo ? ' — ' + motivo : ''));
  } catch (e) {
    await interaction.editReply('Error: ' + (e && e.message ? e.message : e));
  }
}

async function cmdUnblacklist(interaction, store) {
  const { user, nick } = banTarget(interaction);
  await interaction.deferReply({ ephemeral: true });
  try {
    if (!user && !nick) {
      await interaction.editReply('Pasame `usuario` o `nick`.');
      return;
    }
    const parts = [];
    if (user && store.unbanId(user.id)) parts.push('cuenta <@' + user.id + '>');
    if (nick && store.unbanNick(nick)) parts.push('nick `' + String(nick).replace(/\s+/g, ' ').trim() + '`');
    if (!parts.length) { await interaction.editReply('No tenia bloqueo registrado.'); return; }
    await interaction.editReply('Desbloqueado: ' + parts.join(' + ') + '.');
  } catch (e) {
    await interaction.editReply('Error: ' + (e && e.message ? e.message : e));
  }
}

function fmtDate(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString('es-AR') + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  } catch (e) { return ''; }
}

async function cmdVinculados(interaction, store) {
  let user = null;
  try { user = interaction.options.getUser('usuario', false); } catch (e) { user = null; }
  await interaction.deferReply({ ephemeral: true });
  try {
    const rows = store.getLinks({ discordId: user ? String(user.id) : '', limit: 10 });
    if (!rows.length) {
      await interaction.editReply(user ? 'Esa cuenta todavia no se vinculo.' : 'Nadie se vinculo todavia.');
      return;
    }
    const lines = rows.map((r) => {
      const who = (r.username ? '@' + r.username : r.discordId) || '?';
      const where = [r.city, r.country].filter(Boolean).join(', ') || 'desconocido';
      return '`' + who + '` — ' + (r.ip || 'sin IP') + ' — ' + where + ' — ' + fmtDate(r.at);
    });
    await interaction.editReply('**Vinculados (' + rows.length + '):**\n' + lines.join('\n'));
  } catch (e) {
    await interaction.editReply('Error: ' + (e && e.message ? e.message : e));
  }
}

async function sweepAndClean(client, store, plusRoleId) {
  try { store.sweepBans(Date.now()); } catch (e) {}
  try {
    const expired = store.sweepExpired(Date.now());
    if (!expired.length || !plusRoleId) return;
    const guildId = String(process.env.DISCORD_GUILD_ID || '').trim();
    if (!guildId) return;
    let guild = null;
    try { guild = await client.guilds.fetch(guildId); } catch (e) { return; }
    for (const r of expired) {
      try {
        if (!r.discordId) continue;
        const m = await guild.members.fetch(String(r.discordId)).catch(() => null);
        if (m) await m.roles.remove(plusRoleId, 'HaxOne Plus vencido').catch(() => {});
      } catch (e) {}
    }
    if (expired.length) console.log('[bot] Vencidos limpiados: ' + expired.length);
  } catch (e) {}
}

module.exports = { startBot, cmdAddPlus, cmdRemovePlus, cmdPlusInfo, cmdPlusList, cmdBlacklist, cmdUnblacklist, cmdVinculados, isAdmin, fmtUntil, COMMANDS };
