import { Client, GatewayIntentBits, Collection } from 'discord.js';
import { config } from 'dotenv';
import cron from 'node-cron';
import express from 'express';
import https from 'https';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { BloodTracker } from './bloodTracker.js';
import { commands } from './commands.js';

const execAsync = promisify(exec);

// Load environment variables
config();

console.log('🚀 Starting Bloodkeeper Bot with HTTPS...');

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

// Function to create self-signed certificate
async function createSelfSignedCert() {
  try {
    // Check if certificates already exist
    if (fs.existsSync('./certs/server.key') && fs.existsSync('./certs/server.crt')) {
      console.log('📜 SSL certificates found');
      return;
    }

    console.log('🔐 Creating self-signed SSL certificate...');
    
    // Create certs directory
    if (!fs.existsSync('./certs')) {
      fs.mkdirSync('./certs');
    }

    // Get public IP for certificate
    const { stdout: publicIP } = await execAsync('curl -s ifconfig.me');
    console.log(`🌐 Public IP: ${publicIP.trim()}`);

    // Create self-signed certificate valid for the public IP
    await execAsync(`openssl req -nodes -new -x509 -keyout ./certs/server.key -out ./certs/server.crt -days 365 -subj "/C=US/ST=State/L=City/O=Organization/CN=${publicIP.trim()}"`);
    
    console.log('✅ SSL certificate created for IP:', publicIP.trim());
    return publicIP.trim();
  } catch (error) {
    console.error('❌ Error creating SSL certificate:', error);
    throw error;
  }
}

// HTTP and HTTPS server setup
const HTTP_PORT = 3000;
const HTTPS_PORT = 8443; // Use port 8443 instead of 443 (no sudo required)

console.log('🌐 Setting up HTTP/HTTPS servers...');

// Health check endpoint
app.get('/', (req, res) => {
  res.send('Bloodkeeper Bot is running with HTTPS! 🩸🔒');
});

// HTTP server middleware for Discord interactions
app.use('/interactions', express.json());

// Handle Discord interactions via HTTP/HTTPS
app.post('/interactions', async (req, res) => {
  try {
    const { type, data } = req.body;
    
    console.log(`🔍 HTTPS INTERACTION: Type: ${type}, Command: ${data?.name || 'none'}`);

    // Respond to Discord's ping
    if (type === 1) {
      console.log('🏓 Discord ping received via HTTPS');
      return res.send({ type: 1 });
    }

    // Handle slash commands
    if (type === 2) {
      const commandName = data.name;
      console.log(`📥 Processing HTTPS command: /${commandName}`);

      if (commandName === 'ping') {
        console.log('🏓 Executing ping via HTTPS...');
        return res.send({
          type: 4,
          data: { content: 'Pong! 🏓 (via HTTPS with self-signed cert)' }
        });
      } else if (commandName === 'bloodlevel') {
        console.log('🩸 Executing bloodlevel via HTTPS...');
        const currentLevel = await bloodTracker.getCurrentBloodLevel();
        return res.send({
          type: 4,
          data: { content: `🩸 **City Blood Level**: ${currentLevel}` }
        });
      } else if (commandName === 'setblood') {
        console.log('🔧 Executing setblood via HTTPS...');
        const amount = data.options.find(opt => opt.name === 'amount')?.value;
        if (amount !== undefined) {
          await bloodTracker.setBloodLevel(amount);
          return res.send({
            type: 4,
            data: { content: `🩸 Blood level set to ${amount}` }
          });
        }
      } else if (commandName === 'bloodhistory') {
        console.log('📊 Executing bloodhistory via HTTPS...');
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
    console.error('❌ ERROR in HTTPS interaction handler:', error);
    return res.status(500).send('Internal server error');
  }
});

// Start servers
async function startServers() {
  try {
    const publicIP = await createSelfSignedCert();
    
    // Start HTTP server (for local testing)
    app.listen(HTTP_PORT, '0.0.0.0', () => {
      console.log(`🌐 HTTP server running on port ${HTTP_PORT}`);
      console.log(`🔗 Local HTTP endpoint: http://localhost:${HTTP_PORT}/interactions`);
    });

    // Start HTTPS server (for Discord)
    const httpsOptions = {
      key: fs.readFileSync('./certs/server.key'),
      cert: fs.readFileSync('./certs/server.crt')
    };

    https.createServer(httpsOptions, app).listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log(`🔒 HTTPS server running on port ${HTTPS_PORT}`);
      console.log(`🔗 Public HTTPS endpoint: https://${publicIP}:${HTTPS_PORT}/interactions`);
      console.log(`📋 Set this URL in Discord Developer Portal: https://${publicIP}:${HTTPS_PORT}/interactions`);
    });

  } catch (error) {
    console.error('❌ Failed to start servers:', error);
    process.exit(1);
  }
}

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

// Start everything
console.log('🔐 Creating SSL certificate and starting servers...');
startServers();

console.log('🔐 Logging into Discord...');
client.login(process.env.DISCORD_BOT_TOKEN);
