import { Client, GatewayIntentBits, Collection } from 'discord.js';
import { config } from 'dotenv';
import cron from 'node-cron';
import { BloodTracker } from './bloodTracker.js';
import { commands } from './commands.js';

// Load environment variables
config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Initialize blood tracker
const bloodTracker = new BloodTracker();

// Set up commands collection
client.commands = new Collection();
commands.forEach(command => {
  client.commands.set(command.name, command);
});

client.once('ready', async () => {
  console.log(`✅ ${client.user.tag} is online and tracking blood levels!`);
  console.log(`🤖 Bot ID: ${client.user.id}`);
  console.log(`📱 Application ID from env: ${process.env.DISCORD_APPLICATION_ID}`);
  
  // Check if IDs match
  if (client.user.id !== process.env.DISCORD_APPLICATION_ID) {
    console.error('❌ MISMATCH: Bot ID does not match Application ID!');
    console.error('This means your bot token belongs to a different application.');
  }
  
  // Initialize database...
  try {
    await bloodTracker.initializeDatabase();
    console.log(`📊 Current blood level: ${await bloodTracker.getCurrentBloodLevel()}`);
    console.log('🗄️ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  }
});

client.on('messageCreate', async (message) => {
  // Ignore messages from our own bot
  if (message.author.id === client.user.id) return;
  
  // Only process messages from Tzimisce bot in the specific channel
  if (message.author.id !== process.env.TZIMISCE_BOT_ID) return;
  if (message.channel.id !== process.env.BLOOD_CHANNEL_ID) return;
  
  console.log(`📥 Processing message from Tzimisce`);
  
  // Note: Without MESSAGE_CONTENT_INTENT, message.content will be empty
  // We'll need to rely on embeds only
  const result = await bloodTracker.processRollMessage({
    author: { id: message.author.id },
    channel_id: message.channel.id,
    content: message.content || '', // Will be empty without MESSAGE_CONTENT_INTENT
    embeds: message.embeds.map(embed => ({
      description: embed.description,
      fields: embed.fields.map(field => ({
        name: field.name,
        value: field.value
      }))
    }))
  });

  if (result) {
    const { successes, newBloodLevel, wasReset } = result;
    
    let response = `🩸 **Blood consumed!** ${successes} successes detected.\n`;
    response += `**New city blood level**: ${newBloodLevel}`;
    
    if (wasReset) {
      response += `\n✨ **Monthly reset occurred** - Blood level was restored to 200.`;
    }
    
    if (newBloodLevel === 0) {
      response += `\n🚨 **WARNING**: City blood level has reached 0!`;
    }
    
    console.log(`📤 Sending response: Blood level now ${newBloodLevel}`);
    await message.channel.send(response);
  }
});

client.on('interactionCreate', async (interaction) => {
  console.log(`🔍 RAW INTERACTION: Type: ${interaction.type}, CommandName: ${interaction.commandName || 'none'}`);
  console.log(`🔍 Guild: ${interaction.guild?.name || 'DM'}, Channel: ${interaction.channel?.name || 'unknown'}`);
  console.log(`🔍 User: ${interaction.user.tag}`);
  
  if (!interaction.isChatInputCommand()) {
    console.log(`❌ Not a chat input command, skipping`);
    return;
  }

  const { commandName } = interaction;
  console.log(`📥 Processing command: /${commandName}`);

  try {
    if (commandName === 'ping') {
      console.log('🏓 Executing ping...');
      await interaction.reply('Pong! 🏓');
      console.log('✅ Ping completed');
    } else if (commandName === 'bloodlevel') {
      console.log('🩸 Executing bloodlevel...');
      const currentLevel = await bloodTracker.getCurrentBloodLevel();
      await interaction.reply(`🩸 **City Blood Level**: ${currentLevel}`);
      console.log(`✅ Bloodlevel completed: ${currentLevel}`);
    } else if (commandName === 'setblood') {
      console.log('🔧 Executing setblood...');
      if (!interaction.member.permissions.has('Administrator')) {
        await interaction.reply({ content: '❌ You need administrator permissions to use this command.', ephemeral: true });
        console.log('❌ Setblood denied - no admin permissions');
        return;
      }
      
      const amount = interaction.options.getInteger('amount');
      await bloodTracker.setBloodLevel(amount);
      await interaction.reply(`🩸 Blood level set to ${amount}`);
      console.log(`✅ Setblood completed: ${amount}`);
    } else if (commandName === 'bloodhistory') {
      console.log('📊 Executing bloodhistory...');
      const history = await bloodTracker.getBloodHistory(10);
      if (history.length === 0) {
        await interaction.reply('📊 No blood consumption history found.');
        console.log('📊 Bloodhistory completed - no history');
        return;
      }
      
      let response = '📊 **Recent Blood Consumption History:**\n';
      history.forEach(entry => {
        const date = new Date(entry.timestamp).toLocaleString();
        response += `• ${date}: -${entry.successes} (Level: ${entry.blood_level})\n`;
      });
      
      await interaction.reply(response);
      console.log('✅ Bloodhistory completed');
    } else {
      console.log(`❓ Unknown command: ${commandName}`);
      await interaction.reply({ content: '❌ Unknown command', ephemeral: true });
    }

  } catch (error) {
    console.error('❌ ERROR in interaction handler:', error);
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
      } else {
        await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
      }
    } catch (followUpError) {
      console.error('❌ Error sending error message:', followUpError);
    }
  }
});

// Monthly blood reset cron job (runs on 1st of each month at midnight)
cron.schedule('0 0 1 * *', async () => {
  console.log('🗓️ Running monthly blood reset...');
  const wasReset = await bloodTracker.checkAndResetMonthly();
  if (wasReset) {
    console.log('✅ Monthly blood reset completed');
    
    // Optionally notify in the channel
    const channel = client.channels.cache.get(process.env.BLOOD_CHANNEL_ID);
    if (channel) {
      await channel.send('🗓️ **Monthly Reset**: City blood level has been restored to 200!');
    }
  }
});

// Error handling
client.on('error', console.error);
process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

// Login
client.login(process.env.DISCORD_BOT_TOKEN);
