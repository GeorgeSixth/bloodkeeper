#!/bin/bash

# Cloudflare Tunnel Setup Script (No Domain Required)

echo "======================================================"
echo "☁️  Setting up Cloudflare Tunnel (Free, No Domain)"
echo "======================================================"
echo ""

# Install cloudflared
if ! command -v cloudflared &> /dev/null; then
    echo "📦 Installing Cloudflare Tunnel..."
    
    # Download and install cloudflared
    wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
    sudo dpkg -i cloudflared-linux-amd64.deb
    rm cloudflared-linux-amd64.deb
    
    echo "✅ Cloudflared installed!"
else
    echo "✅ Cloudflared is already installed"
fi

echo ""
echo "📋 Quick Tunnel Setup (No Account Required!)"
echo "======================================================"
echo ""
echo "This will create a temporary public URL for your bot."
echo "The URL changes each time you restart (upgrade for permanent URL)."
echo ""

# Create a script to run cloudflare tunnel
cat > start-cloudflare-tunnel.sh << 'EOF'
#!/bin/bash

echo "☁️ Starting Cloudflare Quick Tunnel..."
echo "This creates a public HTTPS URL for your bot"
echo ""

# Run cloudflare tunnel (no auth required for quick tunnels)
cloudflared tunnel --url http://localhost:3000 2>&1 | while read line; do
    echo "$line"
    
    # Look for the tunnel URL
    if echo "$line" | grep -q "https://.*\.trycloudflare\.com"; then
        URL=$(echo "$line" | grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com')
        
        echo ""
        echo "======================================================"
        echo "🎉 Cloudflare Tunnel Active!"
        echo "======================================================"
        echo ""
        echo "📋 Your public URL is:"
        echo "👉 $URL"
        echo ""
        echo "Set this in Discord Developer Portal:"
        echo "👉 $URL/interactions"
        echo ""
        echo "Link: https://discord.com/developers/applications"
        echo "======================================================"
        echo ""
        
        # Save URL to file
        echo "$URL" > tunnel-url.txt
    fi
done
EOF

chmod +x start-cloudflare-tunnel.sh

echo "🚀 Starting your bot and tunnel..."
echo ""

# Make sure bot is configured for HTTP only (tunnel handles HTTPS)
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
    name: 'cloudflare-tunnel',
    script: './start-cloudflare-tunnel.sh',
    interpreter: 'bash',
    autorestart: true,
    watch: false,
    error_file: './logs/tunnel-err.log',
    out_file: './logs/tunnel-out.log'
  }]
};
EOF

# Stop existing processes
pm2 stop all 2>/dev/null || true
pm2 delete all 2>/dev/null || true

# Start everything
pm2 start ecosystem.config.cjs
pm2 save

sleep 5

echo ""
echo "======================================================"
echo "✅ Setup Complete!"
echo "======================================================"
echo ""
echo "📊 View your tunnel URL:"
echo "   pm2 logs cloudflare-tunnel"
echo ""
echo "The URL will be shown above. Copy it and add '/interactions'"
echo "Then set it in Discord Developer Portal."
echo ""
echo "⚠️  Note: This is a quick tunnel - URL changes on restart"
echo ""
echo "For a permanent tunnel with custom domain:"
echo "1. Create free Cloudflare account"
echo "2. Run: cloudflared tunnel login"
echo "3. Run: cloudflared tunnel create bloodkeeper"
echo ""

# Show the logs to display URL
pm2 logs cloudflare-tunnel --lines 20 --nostream
