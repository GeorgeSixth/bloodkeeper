#!/bin/bash

# Fixed Ngrok Setup Script for Bloodkeeper Bot

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
echo "📋 Checking Ngrok Authentication..."
echo ""

# Check if ngrok is already configured
if ngrok config check 2>/dev/null | grep -q "Valid"; then
    echo "✅ Ngrok is already authenticated"
else
    echo "You need to authenticate Ngrok with your account token."
    echo ""
    echo "1. Go to: https://dashboard.ngrok.com/get-started/your-authtoken"
    echo "2. Copy your authtoken"
    echo ""
    read -p "3. Paste your Ngrok authtoken here: " NGROK_TOKEN
    
    if [ ! -z "$NGROK_TOKEN" ]; then
        ngrok config add-authtoken $NGROK_TOKEN
        echo "✅ Ngrok authtoken configured!"
    else
        echo "❌ No token provided. Cannot continue."
        exit 1
    fi
fi

echo ""
echo "🚀 Creating Ngrok tunnel starter..."
echo ""

# Create a CommonJS file for PM2 (to avoid ES module issues)
cat > start-ngrok.cjs << 'EOF'
const { spawn } = require('child_process');

console.log('🚇 Starting Ngrok tunnel for port 3000...');

// Start ngrok with explicit command
const ngrok = spawn('ngrok', ['http', '3000', '--log=stdout'], {
    env: { ...process.env }
});

let tunnelUrl = null;

// Monitor ngrok output
ngrok.stdout.on('data', (data) => {
    const output = data.toString();
    console.log(output);
    
    // Look for the tunnel URL in different formats
    const patterns = [
        /url=https:\/\/[\w-]+\.ngrok-free\.app/,
        /https:\/\/[\w-]+\.ngrok-free\.app/,
        /https:\/\/[\w-]+\.ngrok\.io/
    ];
    
    for (const pattern of patterns) {
        const match = output.match(pattern);
        if (match && !tunnelUrl) {
            tunnelUrl = match[0].replace('url=', '');
            
            console.log('');
            console.log('====================================================');
            console.log('🎉 Ngrok Tunnel Active!');
            console.log('====================================================');
            console.log('');
            console.log('📋 Your public HTTPS URL:');
            console.log(`👉 ${tunnelUrl}`);
            console.log('');
            console.log('Set this in Discord Developer Portal:');
            console.log(`👉 ${tunnelUrl}/interactions`);
            console.log('');
            console.log('Direct link to Discord settings:');
            console.log('https://discord.com/developers/applications');
            console.log('====================================================');
            console.log('');
            
            // Write URL to file for reference
            require('fs').writeFileSync('tunnel-url.txt', tunnelUrl);
            break;
        }
    }
});

ngrok.stderr.on('data', (data) => {
    console.error(`Ngrok stderr: ${data}`);
});

ngrok.on('error', (error) => {
    console.error('Failed to start ngrok:', error);
    process.exit(1);
});

ngrok.on('close', (code) => {
    if (code !== 0) {
        console.log(`Ngrok process exited with code ${code}`);
        console.log('');
        console.log('❌ Ngrok failed to start. Common issues:');
        console.log('1. Authentication: Run "ngrok config add-authtoken YOUR_TOKEN"');
        console.log('2. Port in use: Make sure port 3000 is available');
        console.log('3. Network: Check your internet connection');
    }
    process.exit(code);
});

// Keep the process alive
process.on('SIGINT', () => {
    console.log('Shutting down Ngrok...');
    ngrok.kill();
    process.exit(0);
});

// Keep process running
setInterval(() => {
    // Keep alive
}, 1000);
EOF

echo "✅ Created start-ngrok.cjs"
echo ""

# Update PM2 ecosystem config to use CommonJS
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
      USE_HTTP_ONLY: 'true',
      HTTP_PORT: 3000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }, {
    name: 'ngrok-tunnel',
    script: './start-ngrok.cjs',
    interpreter: 'node',
    autorestart: true,
    watch: false,
    max_restarts: 10,
    min_uptime: '10s',
    error_file: './logs/ngrok-err.log',
    out_file: './logs/ngrok-out.log'
  }]
};
EOF

echo "✅ Updated ecosystem.config.cjs"
echo ""

# Stop and clean up old processes
echo "🧹 Cleaning up old processes..."
pm2 stop ngrok-tunnel 2>/dev/null || true
pm2 delete ngrok-tunnel 2>/dev/null || true
pm2 stop bloodkeeper-bot 2>/dev/null || true

# Make sure the bot uses HTTP only (since ngrok handles HTTPS)
if [ -f "./src/index.js" ]; then
    echo "✅ Bot configured for HTTP mode (ngrok handles HTTPS)"
else
    echo "⚠️  Make sure your bot is configured to use HTTP on port 3000"
fi

# Start everything fresh
echo ""
echo "🚀 Starting services..."
pm2 start ecosystem.config.cjs
pm2 save

sleep 5

echo ""
echo "======================================================"
echo "✅ Setup Complete!"
echo "======================================================"
echo ""

# Check if ngrok started successfully
if pm2 list | grep ngrok-tunnel | grep -q online; then
    echo "✅ Ngrok tunnel is running!"
    echo ""
    echo "📊 Getting tunnel URL..."
    echo ""
    
    # Show the logs to see the URL
    pm2 logs ngrok-tunnel --lines 50 --nostream | grep -A5 -B5 "Ngrok Tunnel Active" || true
    
    # Check if URL was saved
    if [ -f "tunnel-url.txt" ]; then
        URL=$(cat tunnel-url.txt)
        echo ""
        echo "======================================================"
        echo "🎉 Your Discord Webhook URL:"
        echo "👉 $URL/interactions"
        echo "======================================================"
    else
        echo ""
        echo "📋 View live logs to see your tunnel URL:"
        echo "   pm2 logs ngrok-tunnel"
    fi
else
    echo "❌ Ngrok failed to start. Checking logs..."
    pm2 logs ngrok-tunnel --lines 20 --nostream
    echo ""
    echo "🔧 Troubleshooting:"
    echo "1. Verify your authtoken: ngrok config check"
    echo "2. Add token if needed: ngrok config add-authtoken YOUR_TOKEN"
    echo "3. Check logs: pm2 logs ngrok-tunnel"
fi

echo ""
echo "📋 Useful commands:"
echo "  View tunnel URL:  pm2 logs ngrok-tunnel | grep 'Tunnel Active' -A10"
echo "  Restart tunnel:   pm2 restart ngrok-tunnel"
echo "  Check status:     pm2 status"
echo "  View all logs:    pm2 logs"
