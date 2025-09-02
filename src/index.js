import { Client, GatewayIntentBits, Collection } from 'discord.js';
import { config } from 'dotenv';
import cron from 'node-cron';
import express from 'express';
import https from 'https';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
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

// Function to verify Discord signature
function verifyDiscordSignature(req) {
  const signature = req.get('X-Signature-Ed25519');
  const timestamp = req.get('X-Signature-Timestamp');
  const body = req.rawBody;
  
  if (!signature || !timestamp || !body) {
    console.log('❌ Missing signature headers or body');
    return false;
  }

  const isVerified = crypto.verify(
    'ed25519',
    Buffer.from(timestamp + body),
    {
      key: `-----BEGIN PUBLIC KEY-----\n${Buffer.from(process.env.DISCORD_PUBLIC_KEY, 'hex').toString('base64')}\n-----END PUBLIC KEY-----`,
      format: 'pem',
    },
    Buffer.from(signature, 'hex')
  );

  return isVerified;
}

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
    const trimmedIP = publicIP.trim();
    console.log(`🌐 Public IP: ${trimmedIP}`);

    // Create OpenSSL config for SAN
    const opensslConfig = `
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_ca
prompt = no

[req_distinguished_name]
C = US
ST = State
L = City
O = Organization
CN = ${trimmedIP}

[v3_ca]
subjectAltName = @alt_names

[alt_names]
IP.1 = ${trimmedIP}
DNS.1 = localhost
`;

    // Write config to temp file
    fs.writeFileSync('./certs/openssl.cnf', opensslConfig);

    // Create self-signed certificate with SAN
    await execAsync(`openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout ./certs/server.key -out ./certs/server.crt -config ./certs/openssl.cnf`);
    
    console.log('✅ SSL certificate created for IP:', trimmedIP);
    
    // Clean up config file
    fs.unlinkSync('./certs/openssl.cnf');
    
    return trimmedIP;
  } catch (error) {
    console.error('❌ Error creating SSL certificate:', error);
    throw error;
  }
}

// HTTP and HTTPS server setup
const HTTP_PORT = 3000;
const HTTPS_PORT = 8443;

console.log('🌐 Setting up HTTP/HTTPS servers...');

// Middleware to capture raw body for signature verification
app.use('/interactions', express.raw({type: 'application/json'}), (req, res, next) => {
  req.rawBody = req.body.toString('utf8');
  try {
    req.body = JSON.parse(req.rawBody);
  } catch (e) {
    console.error('❌ Failed to parse JSON:', e);
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  next();
});

// Health check endpoint
app.get('/', (req, res) => {
  res.send('Bloodkeeper Bot is running with HTTPS! 🩸🔒');
});

// Handle Discord interactions
app.post('/interactions', async (req, res) => {
  try {
    console.log('📥 Received interaction request');
    
    // Verify Discord signature
    if (!verifyDiscordSignature(req)) {
      console.error('❌ Invalid signature');
      return res.status(401).send('Invalid signature');
    }

    const { type, data, member, guild_id } = req.body;
    
    console.log(`🔍 Interaction - Type: ${type}, Command: ${data?.name || 'none'}`);

    // Respond to Discord's ping
    if (type === 1) {
      console.log('🏓 Discord ping received - sending pong');
      return res.json({ type: 1 });
    }

    // Handle slash commands
    if (type === 2) {
      const commandName = data.name;
      console.log(`📥 Processing command: /${commandName}`);

      // Check permissions for admin commands
      const isAdmin = member?.permissions && 
                     (BigInt(member.permissions) & BigInt(0x8)) === BigInt(0x8); // ADMINISTRATOR permission

      if (commandName === 'ping') {
        return res.json({
          type: 4,
          data: { content: '🏓 Pong! Bot is responding to interactions!' }
        });
      } 
      
      else if (commandName === 'bloodlevel') {
        const currentLevel = await bloodTracker.getCurrentBloodLevel();
        return res.json({
          type: 4,
          data: { 
            content: `🩸 **Current City Blood Level**: ${currentLevel}/200`,
            embeds: [{
              color: currentLevel > 100 ? 0x00ff00 : currentLevel > 50 ? 0xffff00 : 0xff0000,
              fields: [
                {
                  name: 'Status',
                  value: currentLevel > 100 ? '✅ Healthy' : currentLevel > 50 ? '⚠️ Moderate' : '🚨 Critical',
                  inline: true
                },
                {
                  name: 'Percentage',
                  value: `${Math.round((currentLevel / 200) * 100)}%`,
                  inline: true
                }
              ]
            }]
          }
        });
      } 
      
      else if (commandName === 'setblood') {
        if (!isAdmin) {
          return res.json({
            type: 4,
            data: { 
              content: '❌ You need administrator permissions to use this command.',
              flags: 64 // Ephemeral message
            }
          });
        }

        const amount = data.options?.find(opt => opt.name === 'amount')?.value;
        if (amount !== undefined && amount >= 0 && amount <= 300) {
          await bloodTracker.setBloodLevel(amount);
          return res.json({
            type: 4,
            data: { content: `✅ Blood level set to **${amount}**` }
          });
        } else {
          return res.json({
            type: 4,
            data: { content: '❌ Invalid amount. Please provide a value between 0 and 300.' }
          });
        }
      } 
      
      else if (commandName === 'bloodhistory') {
        const history = await bloodTracker.getBloodHistory(10);
        
        if (history.length === 0) {
          return res.json({
            type: 4,
            data: { content: '📊 No blood consumption history found.' }
          });
        }
        
        const historyFields = history.slice(0, 5).map(entry => {
          const date = new Date(entry.timestamp);
          return {
            name: date.toLocaleString('en-US', { 
              month: 'short', 
              day: 'numeric', 
              hour: '2-digit', 
              minute: '2-digit' 
            }),
            value: `Consumed: **${entry.successes}** | Level: **${entry.blood_level}**`,
            inline: false
          };
        });
        
        return res.json({
          type: 4,
          data: { 
            embeds: [{
              title: '📊 Recent Blood Consumption History',
              color: 0x8b0000,
              fields: historyFields,
              footer: {
                text: `Showing last ${historyFields.length} entries`
              }
            }]
          }
        });
      }

      return res.json({
        type: 4,
        data: { content: '❌ Unknown command' }
      });
    }

    console.log(`❓ Unknown interaction type: ${type}`);
    return res.status(400).json({ error: 'Unknown interaction type' });
    
  } catch (error) {
    console.error('❌ Error in interaction handler:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Start servers
async function startServers() {
  try {
    const publicIP = await createSelfSignedCert();
    
    // Start HTTP server
    app.listen(HTTP_PORT, '0.0.0.0', () => {
      console.log(`🌐 HTTP server running on port ${HTTP_PORT}`);
      console.log(`🔗 Local HTTP endpoint: http://localhost:${HTTP_PORT}/interactions`);
    });

    // Start HTTPS server
    const httpsOptions = {
      key: fs.readFileSync('./certs/server.key'),
      cert: fs.readFileSync('./certs/server.crt')
    };

    https.createServer(httpsOptions, app).listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log(`🔒 HTTPS server running on port ${HTTPS_PORT}`);
      console.log(`🔗 Public HTTPS endpoint: https://${publicIP || '89.168.60.67'}:${HTTPS_PORT}/interactions`);
      console.log(`\n📋 IMPORTANT: Set this URL in Discord Developer Portal:`);
      console.log(`   https://${publicIP || '89.168.60.67'}:${HTTPS_PORT}/interactions\n`);
    });

  } catch (error) {
    console.error('❌ Failed to start servers:', error);
    process.exit(1);
  }
}

// Discord bot ready event
client.once('ready', async () => {
  console.log(`✅ ${client.user.tag} is online and tracking blood levels!`);
  console.log(`🤖 Bot ID: ${client.user.id}`);
  console.log(`📱 Application ID: ${process.env.DISCORD_APPLICATION_ID}`);
  
  // Initialize database
  try {
    await bloodTracker.initializeDatabase();
    const currentLevel = await bloodTracker.getCurrentBloodLevel();
    console.log(`📊 Current blood level: ${currentLevel}`);
    console.log('🗄️ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  }
});

// Message handler for Tzimisce bot
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
      fields: embed.fields?.map(field => ({
        name: field.name,
        value: field.value
      })) || []
    }))
  });

  if (result) {
    const { successes, newBloodLevel, wasReset } = result;
    
    let response = `🩸 **Blood consumed!** ${successes} successes detected.\n`;
    response += `**New city blood level**: ${newBloodLevel}/200`;
    
    if (wasReset) {
      response += `\n✨ **Monthly reset occurred** - Blood level was restored to 200.`;
    }
    
    if (newBloodLevel <= 20) {
      response += `\n🚨 **WARNING**: City blood level is critically low!`;
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
      await channel.send('🗓️ **Monthly Reset**: City blood level has been restored to 200!');
    }
  }
});

// Error handling
client.on('error', console.error);
process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⚠️ Shutting down gracefully...');
  client.destroy();
  process.exit(0);
});

// Start everything
console.log('🔐 Starting Bloodkeeper Bot...');
startServers();

console.log('🔐 Logging into Discord...');
client.login(process.env.DISCORD_BOT_TOKEN);
