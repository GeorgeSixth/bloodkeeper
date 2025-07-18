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
      response += `\n✨ **Monthly reset occurred** - Blood level was restored to 100.`;
    }
    
    if (newBloodLevel === 0) {
      response += `\n🚨 **WARNING**: City blood level has reached 0!`;
    }
    
    console.log(`📤 Sending response: Blood level now ${newBloodLevel}`);
    await message.channel.send(response);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  try {
    if (commandName === 'ping') {
      await interaction.reply('Pong! 🏓');
    }

    if (commandName === 'bloodlevel') {
      const currentLevel = await bloodTracker.getCurrentBloodLevel();
      await interaction.reply(`🩸 **City Blood Level**: ${currentLevel}`);
    }

    if (commandName === 'setblood') {
      // Check if user has admin permissions
      if (!interaction.member.permissions.has('Administrator')) {
        await interaction.reply({ content: '❌ You need administrator permissions to use this command.', ephemeral: true });
        return;
      }
      
      const amount = interaction.options.getInteger('amount');
      await bloodTracker.setBloodLevel(amount);
      await interaction.reply(`🩸 Blood level set to ${amount}`);
    }

    if (commandName === 'bloodhistory') {
      const history = await bloodTracker.getBloodHistory(10);
      if (history.length === 0) {
        await interaction.reply('📊 No blood consumption history found.');
        return;
      }
      
      let response = '📊 **Recent Blood Consumption History:**\n';
      history.forEach(entry => {
        const date = new Date(entry.timestamp).toLocaleString();
        response += `• ${date}: -${entry.successes} (Level: ${entry.blood_level})\n`;
      });
      
      await interaction.reply(response);
    }

  } catch (error) {
    console.error('Error handling interaction:', error);
    const errorMessage = 'There was an error while executing this command!';
    
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
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
      await channel.send('🗓️ **Monthly Reset**: City blood level has been restored to 100!');
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
