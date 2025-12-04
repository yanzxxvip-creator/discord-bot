// index.js
// TempVoice Pro+ — All-in-one index.js
// Requirements: node >=18, discord.js v14, fs-extra, dotenv
// Install: npm i discord.js fs-extra dotenv

const { Client, GatewayIntentBits, PermissionsBitField, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
const fs = require("fs-extra");
require("dotenv").config();

// Load config
const configPath = "./config.json";
if(!fs.existsSync(configPath)) {
  console.error("Missing config.json — create one first.");
  process.exit(1);
}
const config = fs.readJsonSync(configPath);

// DB file for storing created temp channels
const dbPath = "./data/tempvoice.json";
fs.ensureFileSync(dbPath);
let db = {};
try { db = fs.readJsonSync(dbPath) } catch(e){ db = {}; fs.writeJsonSync(dbPath, {}); }
function saveDB(){ fs.writeJsonSync(dbPath, db, { spaces: 2 }); }

// Basic vars
const prefix = config.prefix || "!";
const createCooldowns = {}; // per-user cooldown for creating channels

// Create client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  presence: { activities: [{ name: "TempVoice Pro+ • Gold" }], status: "online" }
});

// Helpers
const isOwner = (id) => String(id) === String(config.ownerId);
const hasManagePerms = (member) => member?.permissions?.has(PermissionsBitField.Flags.ManageChannels);

// Check channel owner/coowner
function isChannelOwner(guildId, channelId, userId){
  if(!db[guildId] || !db[guildId][channelId]) return false;
  const ch = db[guildId][channelId];
  return ch.owner === userId || (ch.coowners && ch.coowners.includes(userId)) || isOwner(userId);
}

// Build 4x4 gold panel embed + buttons
function buildGoldPanel(voice, chData){
  const embed = new EmbedBuilder()
    .setTitle(`🔶 TempVoice — ${voice.name}`)
    .setDescription("Gunakan tombol untuk kontrol room. Panel Gold Premium (4×4).")
    .setColor(0xD4AF37)
    .addFields(
      { name: "Owner", value: `<@${chData.owner}>`, inline: true },
      { name: "Limit", value: `${voice.userLimit || 0}`, inline: true },
      { name: "Locked", value: `${chData.locked ? "Yes" : "No"}`, inline: true },
      { name: "Private", value: `${chData.private ? "Yes" : "No"}`, inline: true }
    )
    .setFooter({ text: "TempVoice Pro+ • Gold Premium" });

  const btns = [
    // row 1
    { id: `rename_${voice.id}`, label: "🏷 Name", style: ButtonStyle.Primary },
    { id: `limit_plus_${voice.id}`, label: "➕ Limit", style: ButtonStyle.Success },
    { id: `limit_minus_${voice.id}`, label: "➖ Limit", style: ButtonStyle.Danger },
    { id: `privacy_${voice.id}`, label: "🔐 Private", style: ButtonStyle.Secondary },

    // row 2
    { id: `trust_${voice.id}`, label: "🟩 Trust", style: ButtonStyle.Success },
    { id: `untrust_${voice.id}`, label: "⬜ Untrust", style: ButtonStyle.Secondary },
    { id: `invite_${voice.id}`, label: "✉️ Invite", style: ButtonStyle.Primary },
    { id: `kick_${voice.id}`, label: "👢 Kick", style: ButtonStyle.Danger },

    // row 3
    { id: `banvc_${voice.id}`, label: "⛔ BanVC", style: ButtonStyle.Danger },
    { id: `unbanvc_${voice.id}`, label: "✅ UnbanVC", style: ButtonStyle.Success },
    { id: `hide_${voice.id}`, label: "👻 Hide", style: ButtonStyle.Secondary },
    { id: `reveal_${voice.id}`, label: "👁 Reveal", style: ButtonStyle.Primary },

    // row 4
    { id: `claim_${voice.id}`, label: "👑 Claim", style: ButtonStyle.Primary },
    { id: `transfer_${voice.id}`, label: "🔁 Transfer", style: ButtonStyle.Secondary },
    { id: `delete_${voice.id}`, label: "🗑 Delete", style: ButtonStyle.Danger },
    { id: `more_${voice.id}`, label: "⚙ More", style: ButtonStyle.Secondary }
  ];

  const rows = [];
  for(let r=0;r<4;r++){
    const row = new ActionRowBuilder();
    for(let c=0;c<4;c++){
      const b = btns[r*4 + c];
      row.addComponents(new ButtonBuilder().setCustomId(b.id).setLabel(b.label).setStyle(b.style));
    }
    rows.push(row);
  }
  return { embed, rows };
}

// Create temp channel function
async function createTempChannel(member){
  try{
    const guild = member.guild;
    const now = Date.now();
    if(createCooldowns[member.id] && now - createCooldowns[member.id] < (config.cooldownCreateSeconds||8)*1000) return;
    createCooldowns[member.id] = now;

    if(!config.tempCategory || !config.creatorChannel) return;
    const category = guild.channels.cache.get(config.tempCategory);
    if(!category) return;

    const name = `${member.user.username}'s Room`;
    const channel = await guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      parent: category.id,
      bitrate: config.defaultBitrate || 64000,
      userLimit: config.defaultUserLimit || 0,
      reason: "TempVoice Pro+ auto-create"
    });

    // move user into channel
    await member.voice.setChannel(channel).catch(()=>{});

    if(!db[guild.id]) db[guild.id] = {};
    db[guild.id][channel.id] = {
      owner: member.id,
      coowners: [],
      createdAt: Date.now(),
      locked: false,
      private: false,
      banned: [],
      backupName: name,
      userLimit: 0,
      trusted: []
    };
    saveDB();

    // send log
    const log = guild.channels.cache.get(config.logChannel);
    if(log && log.isTextBased()) log.send(`🎧 [Create] <@${member.id}> -> ${channel.name}`).catch(()=>{});

    // post panel to setupChannel
    const setupCh = guild.channels.cache.get(config.setupChannel);
    if(setupCh && setupCh.isTextBased()){
      const panel = buildGoldPanel(channel, db[guild.id][channel.id]);
      await setupCh.send({ embeds: [panel.embed], components: panel.rows }).catch(()=>{});
    }

  }catch(err){ console.error("createTempChannel:", err); }
}

// Event: ready
client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setActivity("TempVoice Pro+ | Gold Panel");
});

// Event: voice state updates — create and delete logic + re-post panel
client.on("voiceStateUpdate", async (oldState, newState) => {
  try{
    const guild = newState.guild || oldState.guild;
    if(!guild) return;

    // if user joined creator channel -> create
    if(newState.channelId && newState.channelId === config.creatorChannel){
      await createTempChannel(newState.member);
    }

    // when owner leaves and channel empty -> delete
    if(oldState.channelId && db[guild.id] && db[guild.id][oldState.channelId]){
      const ch = oldState.channel;
      if(ch && !ch.deleted && ch.members.size === 0){
        // remove from db and delete channel
        delete db[guild.id][oldState.channelId];
        saveDB();
        ch.delete().catch(()=>{});
        const log = guild.channels.cache.get(config.logChannel);
        if(log && log.isTextBased()) log.send(`🗑️ [Delete] Empty temp ${ch.name}`).catch(()=>{});
      }
    }

    // when owner joins their channel, refresh panel in setup
    if(newState.channelId && db[guild.id] && db[guild.id][newState.channelId]){
      const chData = db[guild.id][newState.channelId];
      if(newState.member.id === chData.owner){
        const setupCh = guild.channels.cache.get(config.setupChannel);
        if(setupCh && setupCh.isTextBased()){
          const panel = buildGoldPanel(newState.channel, chData);
          await setupCh.send({ embeds: [panel.embed], components: panel.rows }).catch(()=>{});
        }
      }
    }
  }catch(e){ console.error("voiceStateUpdate err:", e); }
});

// Message command: simple handler for setup & help & owner
client.on("messageCreate", async (msg) => {
  try{
    if(msg.author.bot) return;
    if(!msg.guild) return;

    const content = msg.content.trim();
    if(!content.startsWith(prefix)) return;
    const args = content.slice(prefix.length).split(/\s+/);
    const cmd = args.shift().toLowerCase();

    // Setup: create default channels (owner or manageChannels)
    if(cmd === "setup"){
      if(!isOwner(msg.author.id) && !hasManagePerms(msg.member)) return msg.reply("❌ Kamu perlu jadi owner atau punya Manage Channels.");
      try{
        const category = await msg.guild.channels.create({ name: "TempVoice Category", type: ChannelType.GuildCategory });
        const creator = await msg.guild.channels.create({ name: "Create TempVoice", type: ChannelType.GuildVoice, parent: category.id });
        const log = await msg.guild.channels.create({ name: "tempvoice-logs", type: ChannelType.GuildText });
        const setup = await msg.guild.channels.create({ name: "setup-panel", type: ChannelType.GuildText });
        config.creatorChannel = creator.id;
        config.tempCategory = category.id;
        config.logChannel = log.id;
        config.setupChannel = setup.id;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        return msg.reply("✅ Setup complete. Config disimpan.");
      }catch(e){ console.error(e); return msg.reply("Setup gagal. Cek permission bot."); }
    }

    // Basic help
    if(cmd === "help"){
      const embed = new EmbedBuilder()
        .setTitle("TempVoice Pro+ — Commands")
        .setDescription("Panel Gold premium, gunakan tombol pada channel `setup-panel` atau command.")
        .addFields(
          { name: `${prefix}setup`, value: "Setup category & channels (owner/ManageChannels).", inline: true },
          { name: "Panel", value: "Gunakan tombol 4×4 di `setup-panel` untuk kontrol room.", inline: true }
        ).setColor(0x00B0F4);
      return msg.reply({ embeds: [embed] });
    }

    // owner commands: eval & reload (dangerous - only owner)
    if(isOwner(msg.author.id) && cmd === "eval"){
      const js = args.join(" ");
      try{
        let result = eval(js);
        if(typeof result !== "string") result = require("util").inspect(result, { depth: 1 });
        return msg.channel.send(`\`\`\`js\n${String(result).slice(0,1900)}\n\`\`\``);
      }catch(e){ return msg.channel.send(`\`\`\`ERROR: ${e.message}\n\`\`\``); }
    }

  }catch(e){ console.error("messageCreate err:", e); }
});

// Interaction handling: all buttons
client.on("interactionCreate", async (interaction) => {
  try{
    if(!interaction.isButton()) return;
    const id = interaction.customId;
    const [action, ...rest] = id.split("_");
    const channelId = rest.join("_");
    const guild = interaction.guild;
    const member = interaction.member;

    if(!guild) return interaction.reply({ content: "Guild error.", ephemeral: true });
    if(!db[guild.id] || !db[guild.id][channelId]) return interaction.reply({ content: "Channel tidak terdaftar.", ephemeral: true });
    const voice = guild.channels.cache.get(channelId);
    if(!voice) return interaction.reply({ content: "Channel tidak ditemukan.", ephemeral: true });

    // Permission: must be owner/coowner or ManageChannels or server admin
    if(!isChannelOwner(guild.id, channelId, member.id) && !hasManagePerms(member)){
      return interaction.reply({ content: "❌ Kamu bukan owner/co-owner atau admin.", ephemeral: true });
    }

    const chData = db[guild.id][channelId];

    // RENAME: prompt user to respond in the channel where panel posted (we instruct ephemeral then await a message)
    if(action === "rename"){
      await interaction.reply({ content: "Ketik `name: New Room Name` di channel ini dalam 30s untuk mengganti nama.", ephemeral: true });
      const filter = m => m.author.id === member.id && m.content.toLowerCase().startsWith("name:");
      const collected = await interaction.channel.awaitMessages({ filter, max:1, time:30000 }).catch(()=>{});
      if(collected && collected.first()){
        const newName = collected.first().content.split("name:")[1].trim();
        if(newName){
          await voice.setName(newName).catch(()=>{});
          chData.backupName = newName; saveDB();
          guild.channels.cache.get(config.logChannel)?.send(`🏷️ ${member.user.tag} renamed ${voice.id} -> ${newName}`).catch(()=>{});
          return interaction.followUp({ content: `✅ Renamed to **${newName}**`, ephemeral: true });
        }
      }
      return interaction.followUp({ content: "❌ No name provided.", ephemeral: true });
    }

    // LIMIT + / -
    if(id.startsWith("limit_plus_")){
      const cid = id.split("limit_plus_")[1];
      const vc = guild.channels.cache.get(cid);
      if(!vc) return interaction.reply({ content: "Channel not found", ephemeral: true });
      let newLimit = (vc.userLimit || 0) + 1; if(newLimit > 99) newLimit = 99;
      await vc.setUserLimit(newLimit).catch(()=>{});
      chData.userLimit = newLimit; saveDB();
      return interaction.reply({ content: `➕ Limit set to ${newLimit}`, ephemeral: true });
    }
    if(id.startsWith("limit_minus_")){
      const cid = id.split("limit_minus_")[1];
      const vc = guild.channels.cache.get(cid);
      if(!vc) return interaction.reply({ content: "Channel not found", ephemeral: true });
      let newLimit = (vc.userLimit || 0) - 1; if(newLimit < 0) newLimit = 0;
      await vc.setUserLimit(newLimit).catch(()=>{});
      chData.userLimit = newLimit; saveDB();
      return interaction.reply({ content: `➖ Limit set to ${newLimit}`, ephemeral: true });
    }

    // PRIVACY toggle
    if(action === "privacy"){
      const everyone = guild.roles.everyone;
      if(!chData.private){
        await voice.permissionOverwrites.edit(everyone, { Connect: false }).catch(()=>{});
        // allow owner & coowners
        const allow = [chData.owner, ...(chData.coowners||[])];
        for(const id of allow) await voice.permissionOverwrites.edit(id, { Connect: true }).catch(()=>{});
        chData.private = true; saveDB();
        guild.channels.cache.get(config.logChannel)?.send(`🔐 ${voice.name} set PRIVATE by ${member.user.tag}`).catch(()=>{});
        return interaction.reply({ content: "🔐 Channel set to PRIVATE", ephemeral: true });
      } else {
        await voice.permissionOverwrites.edit(everyone, { Connect: true }).catch(()=>{});
        chData.private = false; saveDB();
        guild.channels.cache.get(config.logChannel)?.send(`🔓 ${voice.name} set PUBLIC by ${member.user.tag}`).catch(()=>{});
        return interaction.reply({ content: "🔓 Channel set to PUBLIC", ephemeral: true });
      }
    }

    // TRUST / UNTRUST (simple demo: trust the user who clicks)
    if(action === "trust"){
      chData.trusted = chData.trusted || [];
      if(!chData.trusted.includes(member.id)) chData.trusted.push(member.id);
      saveDB();
      return interaction.reply({ content: `🟩 ${member.user.tag} trusted.`, ephemeral: true });
    }
    if(action === "untrust"){
      chData.trusted = (chData.trusted||[]).filter(x=>x!==member.id);
      saveDB();
      return interaction.reply({ content: `⬜ ${member.user.tag} untrusted.`, ephemeral: true });
    }

    // INVITE: ask to mention user in panel channel
    if(action === "invite"){
      await interaction.reply({ content: "Mention user in this channel to send DM invite (30s).", ephemeral: true });
      const filter = m => m.author.id === member.id && m.mentions.users.size>0;
      const collected = await interaction.channel.awaitMessages({ filter, max:1, time:30000 }).catch(()=>{});
      if(collected && collected.first()){
        const u = collected.first().mentions.users.first();
        try{ await u.send(`${member.user.tag} invited you to voice ${voice.name} in ${guild.name}`); return interaction.followUp({ content: `✉️ Invite sent to ${u.tag}`, ephemeral: true }); }catch(e){ return interaction.followUp({ content: "❌ Can't DM user.", ephemeral: true }); }
      }
      return interaction.followUp({ content: "❌ No mention.", ephemeral: true });
    }

    // KICK: mention member
    if(action === "kick"){
      await interaction.reply({ content: "Mention member to kick from VC (30s).", ephemeral: true });
      const filter = m => m.author.id === member.id && m.mentions.members.size>0;
      const collected = await interaction.channel.awaitMessages({ filter, max:1, time:30000 }).catch(()=>{});
      if(collected && collected.first()){
        const mem = collected.first().mentions.members.first();
        if(!mem.voice.channel || mem.voice.channel.id !== voice.id) return interaction.followUp({ content: "❌ Member not in VC.", ephemeral: true });
        await mem.voice.disconnect().catch(()=>{});
        guild.channels.cache.get(config.logChannel)?.send(`👢 ${mem.user.tag} kicked from ${voice.name} by ${member.user.tag}`).catch(()=>{});
        return interaction.followUp({ content: `✅ Kicked ${mem.user.tag}`, ephemeral: true });
      }
      return interaction.followUp({ content: "❌ No mention.", ephemeral: true });
    }

    // BanVC / UnbanVC
    if(action === "banvc"){
      await interaction.reply({ content: "Mention user to BanVC (30s).", ephemeral: true });
      const filter = m => m.author.id === member.id && m.mentions.users.size>0;
      const collected = await interaction.channel.awaitMessages({ filter, max:1, time:30000 }).catch(()=>{});
      if(collected && collected.first()){
        const u = collected.first().mentions.users.first();
        chData.banned = chData.banned || [];
        if(!chData.banned.includes(u.id)) chData.banned.push(u.id);
        await voice.permissionOverwrites.edit(u.id, { Connect: false }).catch(()=>{});
        saveDB();
        return interaction.followUp({ content: `⛔ ${u.tag} banned from VC`, ephemeral: true });
      }
      return interaction.followUp({ content: "❌ No mention.", ephemeral: true });
    }
    if(action === "unbanvc"){
      await interaction.reply({ content: "Mention user to UnbanVC (30s).", ephemeral: true });
      const filter = m => m.author.id === member.id && m.mentions.users.size>0;
      const collected = await interaction.channel.awaitMessages({ filter, max:1, time:30000 }).catch(()=>{});
      if(collected && collected.first()){
        const u = collected.first().mentions.users.first();
        chData.banned = (chData.banned||[]).filter(x=>x!==u.id);
        await voice.permissionOverwrites.delete(u.id).catch(()=>{});
        saveDB();
        return interaction.followUp({ content: `✅ ${u.tag} unbanned.`, ephemeral: true });
      }
      return interaction.followUp({ content: "❌ No mention.", ephemeral: true });
    }

    // Hide / Reveal
    if(action === "hide"){
      await voice.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false }).catch(()=>{});
      chData.hidden = true; saveDB();
      guild.channels.cache.get(config.logChannel)?.send(`🙈 ${voice.name} hidden by ${member.user.tag}`).catch(()=>{});
      return interaction.reply({ content: "👻 Channel hidden.", ephemeral: true });
    }
    if(action === "reveal"){
      await voice.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: true }).catch(()=>{});
      chData.hidden = false; saveDB();
      guild.channels.cache.get(config.logChannel)?.send(`👁 ${voice.name} revealed by ${member.user.tag}`).catch(()=>{});
      return interaction.reply({ content: "👁 Channel revealed.", ephemeral: true });
    }

    // Claim / Transfer / Delete / More
    if(action === "claim"){
      chData.owner = member.id; saveDB();
      guild.channels.cache.get(config.logChannel)?.send(`👑 ${member.user.tag} claimed ${voice.name}`).catch(()=>{});
      return interaction.reply({ content: "👑 Kamu sekarang owner.", ephemeral: true });
    }

    if(action === "transfer"){
      await interaction.reply({ content: "Mention user to transfer ownership (30s).", ephemeral: true });
      const filter = m => m.author.id === member.id && m.mentions.users.size>0;
      const collected = await interaction.channel.awaitMessages({ filter, max:1, time:30000 }).catch(()=>{});
      if(collected && collected.first()){
        const u = collected.first().mentions.users.first();
        chData.owner = u.id; saveDB();
        guild.channels.cache.get(config.logChannel)?.send(`🔁 Ownership transferred to ${u.tag}`).catch(()=>{});
     
