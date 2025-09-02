import { config } from 'dotenv';
import { commands } from './commands.js';

config();

const token = process.env.DISCORD_BOT_TOKEN;
const applicationId = process.env.DISCORD_APPLICATION_ID;
const guildId = process.env.DISCORD_GUILD_ID; // Add this to your .env file

if (!token) {
  throw new Error('The DISCORD_BOT_TOKEN environment variable is required.');
}
if (!applicationId) {
  throw new Error('The DISCORD_APPLICATION_ID environment variable is required.');
}

console.log('🔧 Starting command registration...');
console.log(`📱 Application ID: ${applicationId}`);

// Function to register commands
async function registerCommands(url, type) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${token}`,
    },
    method: 'PUT',
    body: JSON.stringify(commands),
  });

  if (response.ok) {
    console.log(`✅ Successfully registered ${type} commands`);
    const data = await response.json();
    console.log(`📋 Registered ${data.length} commands:`);
    data.forEach(cmd => {
      console.log(`   - /${cmd.name}: ${cmd.description}`);
    });
    return true;
  } else {
    console.error(`❌ Error registering ${type} commands`);
    let errorText = `Error: ${response.status} ${response.statusText}`;
    try {
      const error = await response.text();
      if (error) {
        errorText = `${errorText}\n${error}`;
      }
    } catch (err) {
      console.error('Error reading response:', err);
    }
    console.error(errorText);
    return false;
  }
}

// Main registration function
async function main() {
  let success = true;

  // Register guild commands (instant update)
  if (guildId) {
    console.log(`\n🏰 Registering commands to guild: ${guildId}`);
    const guildUrl = `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`;
    const guildSuccess = await registerCommands(guildUrl, 'guild');
    success = success && guildSuccess;
  } else {
    console.log('⚠️ No DISCORD_GUILD_ID found in .env - skipping guild registration');
    console.log('   Guild commands update instantly. Add DISCORD_GUILD_ID to .env for faster testing.');
  }

  // Register global commands (takes up to 1 hour to propagate)
  console.log('\n🌍 Registering global commands (may take up to 1 hour to propagate)');
  const globalUrl = `https://discord.com/api/v10/applications/${applicationId}/commands`;
  const globalSuccess = await registerCommands(globalUrl, 'global');
  success = success && globalSuccess;

  // Check if public key is set
  if (!process.env.DISCORD_PUBLIC_KEY) {
    console.log('\n⚠️ WARNING: DISCORD_PUBLIC_KEY not found in .env');
    console.log('   This is required for webhook signature verification!');
    console.log('   Get it from: https://discord.com/developers/applications');
  }

  // Final status
  console.log('\n' + '='.repeat(60));
  if (success) {
    console.log('✅ Command registration completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('1. Make sure your interaction endpoint URL is set in Discord Developer Portal');
    console.log('2. Ensure DISCORD_PUBLIC_KEY is in your .env file');
    console.log('3. If using guild commands, they should work immediately');
    console.log('4. Global commands may take up to 1 hour to appear');
  } else {
    console.log('❌ Some commands failed to register. Check the errors above.');
    process.exit(1);
  }
}

// Run registration
main().catch(console.error);
