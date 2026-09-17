'use strict';
// HaxOne Plus — bot de Discord.
// Comandos (solo admins):
//   /addplus usuario:<@persona> [nick:<nombre>] [dias:<n>]
//       Da el rol Plus + registra la licencia. Si no pasas nick, usa el
//       nombre visible del usuario en el servidor. dias=0 (default) = permanente.
//   /removeplus usuario:<@persona>
//       Saca el rol + desactiva su licencia.
//   /plusinfo [usuario] [nick]
//       Muestra si tiene Plus, hasta cuando y con que nick.
//   /pluslist
//       Lista los Plus activos (ultimos 25).
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
    .addUserOption(o => o.setName('usuario').setDescription('Persona a la que das Plus').setRequired(true))
    .addStringOption(o => o.setName('nick').setDescription('Nick de HaxBall (default: su nombre en Discord)').setRequired(false))
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
  let nick = '';
  try { nick = String(interaction.options.getString('nick') || '').trim(); } catch (e) { nick = ''; }
  let dias = 0;
  try { dias = interaction.options.getInteger('dias') || 0; } catch (e) { dias = 0; }
  await interaction.deferReply({ ephemeral: true });
  try {
    const guild = interaction.guild;
    let member = null;
    try { member = guild ? await guild.members.fetch(user.id) : null; } catch (e) { member = null; }
    if (!nick && member) {
      try { nick = String((member.nickname || member.user.username) || '').trim(); } catch (e) { nick = ''; }
    }
    if (!nick) {
      await interaction.editReply('Pasame el nick: `/addplus usuario:@x nick:SuNick` (no pude detectar su nombre).');
      return;
    }
    const rec = store.upsert({ nick, discordId: user.id, discordName: user.username, days: dias });
    if (!rec) {
      await interaction.editReply('Nick invalido.');
      return;
    }
    let roleOk = false;
    if (member && plusRoleId) {
      try { await member.roles.add(plusRoleId, 'HaxOne Plus activado'); roleOk = true; } catch (e) { roleOk = false; }
    }
    const emb = new EmbedBuilder()
      .setTitle('Plus activado')
      .addFields(
        { name: 'Usuario', value: '<@' + user.id + '>', inline: true },
        { name: 'Nick HaxBall', value: '`' + rec.nick + '`', inline: true },
        { name: 'Hasta', value: fmtUntil(rec.until), inline: true }
      )
      .setFooter({ text: roleOk ? 'Rol Plus dado.' : 'OJO: no pude dar el rol (revisa PLUS_ROLE_ID y mis permisos).' })
      .setTimestamp(new Date());
    await interaction.editReply({ embeds: [emb] });
    // Aviso por MD al comprador.
    try {
      await user.send(
        'Tu **HaxOne Plus** esta activo para el nick **' + rec.nick + '** (' + fmtUntil(rec.until) + ').\n' +
        'Abri HaxOne con ese nick y la pestana Plus se desbloquea sola.\n' +
        'IMPORTANTE: juga siempre con ese nick, si lo cambias el Plus se bloquea.'
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

async function sweepAndClean(client, store, plusRoleId) {
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

module.exports = { startBot };
