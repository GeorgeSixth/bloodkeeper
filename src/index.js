import { Client, GatewayIntentBits, Collection } from 'discord.js';
import { config } from 'dotenv';
import cron from 'node-cron';
import express from 'express';
import { BloodTracker } from './bloodTracker.js';
import { commands } from './commands.js';

// Load environment variables
config();

console.log('🚀 Starting Bloodkeeper Bot...');

const app = express();
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

// Start HTTP server FIRST (before Discord connection)
const PORT = process.env.PORT || 3000;

console.log('🌐 Setting up HTTP server...');

// Health check endpoint
app.get('/', (req, res) => {
  res.send('Bloodkeeper Bot is running! 🩸');
});

// Simple verification function (without external dependency for now)
function verifyDiscordRequest(body, signature, timestamp, publicKey) {
  // For now, let's bypass verification to test if the server works
  // TODO: Add proper verification later
  return true;
}

// HTTP server middleware for Discord interactions
app.use('/interactions', express.json());

// Handle Discord interactions via HTTP
app.post('/interactions', async (req, res) => {
  try {
    const { type, data } = req.body;
    
    console.log(`🔍 HTTP INTERACTION: Type: ${type}, Command: ${data?.name || 'none'}`);

    // Respond to Discord's ping
    if (type === 1) {
      console.log('🏓 Discord ping received via HTTP');
      return res.send({ type: 1 });
    }

    // Handle slash commands
    if (type === 2) {
      const commandName = data.name;
      console.log(`📥 Processing HTTP command: /${commandName}`);

      if (commandName === 'ping') {
        console.log('🏓 Executing ping via HTTP...');
        return res.send({
          type: 4,
          data: { content: 'Pong! 🏓 (via HTTPS tunnel)' }
        });
      } else if (commandName === 'bloodlevel') {
        console.log('🩸 Executing bloodlevel via HTTP...');
        const currentLevel = await bloodTracker.getCurrentBloodLevel();
        return res.send({
          type: 4,
          data: { content: `🩸 **City Blood Level**: ${currentLevel}` }
        });
      } else if (commandName === 'setblood') {
        console.log('🔧 Executing setblood via HTTP...');
        const amount = data.options.find(opt => opt.name === 'amount')?.value;
        if (amount !== undefined) {
          await bloodTracker.setBloodLevel(amount);
          return res.send({
            type: 4,
            data: { content: `🩸 Blood level set to ${amount}` }
          });
        }
      } else if (commandName === 'bloodhistory') {
        console.log('📊 Executing bloodhistory via HTTP...');
        const history = await bloodTracker.getBloodHistory(10);
        if (history.length === 0) {
          return res.send({
            type: 4,
            data: { content: '📊 No blood consumption history found.' }
          });
        }
        
        let response = '📊 **Recent Blood Consumption History:**\n';
        history.forEach(entry => {
          const date = new Date(entry.timestamp).toLocaleString();
          response += `• ${date}: -${entry.successes} (Level: ${entry.blood_level})\n`;
        });
        
        return res.send({
          type: 4,
          data: { content: response }
        });
      }
    }

    return res.status(400).send('Unknown interaction type');
  } catch (error) {
    console.error('❌ ERROR in HTTP interaction handler:', error);
    return res.status(500).send('Internal server error');
  }
});

// Start HTTP server with better error handling
console.log(`🌐 Attempting to start HTTP server on port ${PORT}...`);

const server = app.listen(PORT, '0.0.0.0', (error) => {
  if (error) {
    console.error('❌ Failed to start HTTP server:', error);
    process.exit(1);
  } else {
    console.log(`🌐 HTTP server running on port ${PORT}`);
    console.log(`🔗 Local endpoint: http://localhost:${PORT}/interactions`);
  }
});

server.on('error', (error) => {
  console.error('❌ HTTP server error:', error);
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use`);
  }
  process.exit(1);
});

client.once('ready', async () => {
  console.log(`✅ ${client.user.tag} is online and tracking blood levels!`);
  console.log(`🤖 Bot ID: ${client.user.id}`);
  console.log(`📱 Application ID from env: ${process.env.DISCORD_APPLICATION_ID}`);
  
  // Initialize database
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
    content: message.content || '',
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

// Monthly blood reset cron job
cron.schedule('0 0 1 * *', async () => {
  console.log('🗓️ Running monthly blood reset...');
  const wasReset = await bloodTracker.checkAndResetMonthly();
  if (wasReset) {
    console.log('✅ Monthly blood reset completed');
    
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

console.log('🔐 Logging into Discord...');
// Login to Discord (after HTTP server is started)
client.login(process.env.DISCORD_BOT_TOKEN);
