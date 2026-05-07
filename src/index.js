import { Client, GatewayIntentBits, Collection } from 'discord.js';
import { config } from 'dotenv';
import cron from 'node-cron';
import express from 'express';
import crypto from 'crypto';
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

// Function to verify Discord signature
function verifyDiscordSignature(rawBody, signature, timestamp, publicKey) {
  try {
    const keyBuffer = Buffer.from(publicKey, 'hex');
    const derPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    const derKey = Buffer.concat([derPrefix, keyBuffer]);
    const publicKeyObj = crypto.createPublicKey({
      key: derKey,
      format: 'der',
      type: 'spki',
    });
    const isVerified = crypto.verify(
      null,
      Buffer.from(timestamp + rawBody),
      publicKeyObj,
      Buffer.from(signature, 'hex')
    );
    return isVerified;
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

// HTTP server setup
const PORT = process.env.HTTP_PORT || 3000;

console.log(`🌐 Setting up HTTP server on port ${PORT}...`);

// Middleware to capture raw body for signature verification
app.use('/interactions', express.raw({type: 'application/json'}), (req, res, next) => {
  const signature = req.get('X-Signature-Ed25519');
  const timestamp = req.get('X-Signature-Timestamp');
  const rawBody = req.body.toString('utf8');

  // Verify Discord signature
  if (!process.env.DISCORD_PUBLIC_KEY) {
    console.error('❌ DISCORD_PUBLIC_KEY not set in .env!');
    return res.status(500).send('Server misconfigured');
  }

  if (!signature || !timestamp) {
    console.error('❌ Missing signature headers');
    return res.status(401).send('Unauthorized');
  }

  const isValid = verifyDiscordSignature(
    rawBody,
    signature,
    timestamp,
    process.env.DISCORD_PUBLIC_KEY
  );

  if (!isValid) {
    console.error('❌ Invalid signature');
    return res.status(401).send('Invalid signature');
  }

  // Parse JSON body
  try {
    req.body = JSON.parse(rawBody);
    next();
  } catch (e) {
    console.error('❌ Failed to parse JSON:', e);
    return res.status(400).json({ error: 'Invalid JSON' });
  }
});

// Health check endpoint
app.get('/', (req, res) => {
  res.send(`
    <h1>🩸 Bloodkeeper Bot is Running!</h1>
    <p>Status: ✅ Online</p>
    <p>Commands: /ping, /bloodlevel, /setblood, /bloodhistory</p>
  `);
});

// Handle Discord interactions
app.post('/interactions', async (req, res) => {
  try {
    const { type, data, member, guild_id } = req.body;

    console.log(`📥 Interaction - Type: ${type}, Command: ${data?.name || 'none'}`);

    // Respond to Discord's ping (type 1)
    if (type === 1) {
      console.log('🏓 Discord ping received - sending pong');
      return res.json({ type: 1 });
    }

    // Handle slash commands (type 2)
    if (type === 2) {
      const commandName = data.name;
      console.log(`⚡ Processing command: /${commandName}`);

      // Check admin permissions for restricted commands
      const isAdmin = member?.permissions &&
                     (BigInt(member.permissions) & BigInt(0x8)) === BigInt(0x8);

      switch(commandName) {
        case 'ping':
          return res.json({
            type: 4,
            data: {
              content: '🏓 Pong! Bot is responding successfully!',
              flags: 0
            }
          });

        case 'bloodlevel':
          const currentLevel = await bloodTracker.getCurrentBloodLevel();
          const percentage = Math.round((currentLevel / 200) * 100);

          return res.json({
            type: 4,
            data: {
              content: `🩸 **Current City Blood Level**: ${currentLevel}/200 (${percentage}%)`,
              embeds: [{
                color: currentLevel > 100 ? 0x00ff00 : currentLevel > 50 ? 0xffff00 : 0xff0000,
                fields: [
                  {
                    name: '📊 Status',
                    value: currentLevel > 100 ? '✅ Healthy' : currentLevel > 50 ? '⚠️ Moderate' : '🚨 Critical',
                    inline: true
                  },
                  {
                    name: '📈 Percentage',
                    value: `${percentage}%`,
                    inline: true
                  }
                ],
                footer: {
                  text: 'Blood resets monthly to 200'
                }
              }]
            }
          });

        case 'setblood':
          if (!isAdmin) {
            return res.json({
              type: 4,
              data: {
                content: '❌ You need administrator permissions to use this command.',
                flags: 64 // Ephemeral
              }
            });
          }

          const amount = data.options?.find(opt => opt.name === 'amount')?.value;
          if (amount !== undefined && amount >= 0 && amount <= 300) {
            await bloodTracker.setBloodLevel(amount);
            return res.json({
              type: 4,
              data: {
                content: `✅ Blood level set to **${amount}**`,
                flags: 0
              }
            });
          } else {
            return res.json({
              type: 4,
              data: {
                content: '❌ Please provide a value between 0 and 300.',
                flags: 64
              }
            });
          }

        case 'bloodhistory':
          const history = await bloodTracker.getBloodHistory(10);

          if (history.length === 0) {
            return res.json({
              type: 4,
              data: { content: '📊 No blood consumption history yet.' }
            });
          }

          const historyText = history.slice(0, 5).map(entry => {
            const date = new Date(entry.timestamp).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            });
            return `• ${date}: Consumed **${entry.successes}** → Level **${entry.blood_level}**`;
          }).join('\n');

          return res.json({
            type: 4,
            data: {
              embeds: [{
                title: '📊 Recent Blood Consumption',
                description: historyText,
                color: 0x8b0000,
                footer: {
                  text: `Showing last ${Math.min(5, history.length)} entries`
                }
              }]
            }
          });

        default:
          return res.json({
            type: 4,
            data: {
              content: '❌ Unknown command',
              flags: 64
            }
          });
      }
    }

    // Unknown interaction type
    console.log(`❓ Unknown interaction type: ${type}`);
    return res.status(400).json({ error: 'Unknown interaction type' });

  } catch (error) {
    console.error('❌ Error handling interaction:', error);

    // Try to send a user-friendly error response
    try {
      return res.json({
        type: 4,
        data: {
          content: '❌ An error occurred while processing your command. Please try again.',
          flags: 64
        }
      });
    } catch {
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Start HTTP server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ HTTP server running on port ${PORT}`);
  console.log(`🔗 Local endpoint: http://localhost:${PORT}`);
  console.log(`📋 Waiting for tunnel URL to be set in Discord...`);
});

// Discord bot ready event
client.once('ready', async () => {
  console.log(`✅ ${client.user.tag} is online!`);
  console.log(`🤖 Bot ID: ${client.user.id}`);

  // Initialize database
  try {
    await bloodTracker.initializeDatabase();
    const currentLevel = await bloodTracker.getCurrentBloodLevel();
    console.log(`📊 Current blood level: ${currentLevel}/200`);
    console.log('🗄️ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  }
});

// Message handler for Tzimisce bot
client.on('messageCreate', async (message) => {
  console.log(`📨 Message from: ${message.author.id} in channel: ${message.channel.id}`);
  if (message.author.id === client.user.id) return;

  if (message.author.id !== process.env.TZIMISCE_BOT_ID) return;
  if (message.channel.id !== process.env.BLOOD_CHANNEL_ID) return;

  console.log(`📥 Processing message from Tzimisce`);
  console.log(`📝 Content: ${message.content}`);
  console.log(`📝 Embeds: ${JSON.stringify(message.embeds)}`);
  const result = await bloodTracker.processRollMessage({
    author: { id: message.author.id },
    channel_id: message.channel.id,
    content: message.content || '',
    embeds: message.embeds.map(embed => ({
      title: embed.title,
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
      response += `\n✨ **Monthly reset** - Blood level restored to 200!`;
    }

    if (newBloodLevel <= 20) {
      response += `\n🚨 **WARNING**: City blood level is critically low!`;
    }

    await message.channel.send(response);
  }
});

// Monthly reset cron job
cron.schedule('0 0 1 * *', async () => {
  console.log('🗓️ Running monthly blood reset...');
  const wasReset = await bloodTracker.checkAndResetMonthly();
  if (wasReset) {
    const channel = client.channels.cache.get(process.env.BLOOD_CHANNEL_ID);
    if (channel) {
      await channel.send('🗓️ **Monthly Reset**: City blood level restored to 200!');
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

// Login to Discord
console.log('🔐 Logging into Discord...');
client.login(process.env.DISCORD_BOT_TOKEN);
