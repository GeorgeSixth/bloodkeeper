#!/bin/bash

# Ngrok Setup Script for Bloodkeeper Bot

echo "======================================================"
echo "🚇 Setting up Ngrok Tunnel for Discord Bot"
echo "======================================================"
echo ""

# Check if ngrok is installed
if ! command -v ngrok &> /dev/null; then
    echo "📦 Installing Ngrok..."
    
    # Download and install ngrok
    wget https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz
    tar -xzf ngrok-v3-stable-linux-amd64.tgz
    sudo mv ngrok /usr/local/bin/
    rm ngrok-v3-stable-linux-amd64.tgz
    
    echo "✅ Ngrok installed!"
else
    echo "✅ Ngrok is already installed"
fi

echo ""
echo "📋 Ngrok Setup Instructions:"
echo "======================================================"
echo ""
echo "1. Create a free Ngrok account:"
echo "   https://dashboard.ngrok.com/signup"
echo ""
echo "2. Get your auth token from:"
echo "   https://dashboard.ngrok.com/get-started/your-authtoken"
echo ""
read -p "3. Enter your Ngrok auth token: " NGROK_TOKEN

if [ ! -z "$NGROK_TOKEN" ]; then
    ngrok config add-authtoken $NGROK_TOKEN
    echo "✅ Ngrok configured!"
fi

echo ""
echo "4. Starting Ngrok tunnel..."
echo ""

# Create ngrok config file
cat > ngrok.yml << EOF
version: "2"
authtoken: $NGROK_TOKEN
tunnels:
  bloodkeeper:
    proto: http
    addr: 3000
    inspect: false
EOF

# Create a script to run ngrok in background with PM2
cat > start-ngrok.js << 'EOF'
const { spawn } = require('child_process');
const https = require('https');

console.log('🚇 Starting Ngrok tunnel...');

// Start ngrok
const ngrok = spawn('ngrok', ['http', '3000', '--log=stdout']);

let tunnelUrl = null;

// Monitor ngrok output
ngrok.stdout.on('data', (data) => {
    const output = data.toString();
    console.log(output);
    
    // Look for the tunnel URL
    const urlMatch = output.match(/url=https:\/\/[\w-]+\.ngrok-free\.app/);
    if (urlMatch && !tunnelUrl) {
        tunnelUrl = urlMatch[0].replace('url=', '');
        console.log('');
        console.log('====================================================');
        console.log('🎉 Ngrok Tunnel Active!');
        console.log('====================================================');
        console.log('');
        console.log(`📋 Set this URL in Discord Developer Portal:`);
        console.log(`👉 ${tunnelUrl}/interactions`);
        console.log('');
        console.log('Link: https://discord.com/developers/applications');
        console.log('====================================================');
    }
});

ngrok.stderr.on('data', (data) => {
    console.error(`Ngrok error: ${data}`);
});

ngrok.on('close', (code) => {
    console.log(`Ngrok process exited with code ${code}`);
    process.exit(code);
});

// Keep the process alive
process.on('SIGINT', () => {
    console.log('Shutting down Ngrok...');
    ngrok.kill();
    process.exit(0);
});
EOF

echo "======================================================"
echo "🚀 Starting Services"
echo "======================================================"
echo ""

# Make sure the bot is running on port 3000
echo "Starting bot on port 3000..."
pm2 stop bloodkeeper-bot 2>/dev/null || true

# Update the bot to use port 3000 for HTTP
cat > ecosystem.config.cjs << 'EOF'
module.exports = {
  apps: [{
    name: 'bloodkeeper-bot',
    script: './src/index.js',
    instances: 1,
    exec_mode: 'cluster',
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      USE_HTTP_ONLY: 'true',  // Use HTTP only since Ngrok handles HTTPS
      HTTP_PORT: 3000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};
EOF

# Start the bot
pm2 start ecosystem.config.cjs
sleep 3

# Start ngrok with PM2
pm2 stop ngrok-tunnel 2>/dev/null || true
pm2 delete ngrok-tunnel 2>/dev/null || true
pm2 start start-ngrok.js --name ngrok-tunnel
pm2 save

echo ""
echo "✅ Setup complete!"
echo ""
echo "📊 View tunnel URL and status:"
echo "   pm2 logs ngrok-tunnel"
echo ""
echo "🔄 The tunnel URL will be displayed in the logs above"
echo "   Copy it and set it in Discord Developer Portal"
echo ""
echo "⚠️  Note: Free Ngrok URLs change each time you restart"
echo "   Consider upgrading to a paid plan for a static URL"
