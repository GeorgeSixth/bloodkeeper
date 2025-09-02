#!/bin/bash

# Bloodkeeper Bot Enhanced Deployment Script

set -e  # Exit on error

echo "======================================================"
echo "🚀 Deploying Bloodkeeper Bot"
echo "======================================================"
echo ""

# Function to check if .env exists
check_env() {
    if [ ! -f .env ]; then
        echo "❌ .env file not found!"
        echo "Run ./setup.sh first to configure the bot"
        exit 1
    fi
    
    # Check for required variables
    source .env
    if [ -z "$DISCORD_BOT_TOKEN" ] || [ -z "$DISCORD_APPLICATION_ID" ] || [ -z "$DISCORD_PUBLIC_KEY" ]; then
        echo "❌ Missing required environment variables!"
        echo "Please check your .env file has:"
        echo "  - DISCORD_BOT_TOKEN"
        echo "  - DISCORD_APPLICATION_ID"
        echo "  - DISCORD_PUBLIC_KEY"
        exit 1
    fi
    echo "✅ Environment variables verified"
}

# Function to check Discord API health
check_discord_api() {
    echo "🔍 Checking Discord API connection..."
    
    RESPONSE=$(curl -s -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
                     https://discord.com/api/v10/users/@me)
    
    if echo "$RESPONSE" | grep -q '"id"'; then
        BOT_NAME=$(echo "$RESPONSE" | grep -oP '"username":"\K[^"]+')
        echo "✅ Connected to Discord as: $BOT_NAME"
    else
        echo "❌ Failed to connect to Discord API"
        echo "Response: $RESPONSE"
        echo "Please check your DISCORD_BOT_TOKEN"
        exit 1
    fi
}

# Check environment
check_env

# Pull latest changes
echo ""
echo "📥 Pulling latest code..."
git pull origin main || echo "⚠️ Could not pull from git (may be local changes)"

# Install dependencies if package.json changed
if [ ! -d "node_modules" ] || git diff HEAD~1 --name-only 2>/dev/null | grep -q "package.json"; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Check Discord connection
check_discord_api

# Register commands if needed
if [ ! -f ".last_register" ] || git diff HEAD~1 --name-only 2>/dev/null | grep -q "commands.js"; then
    echo ""
    echo "🔧 Registering slash commands..."
    npm run register && touch .last_register || echo "⚠️ Command registration failed - continuing anyway"
fi

# Create necessary directories
mkdir -p logs data certs

# Clean up old processes
echo ""
echo "🧹 Cleaning up old processes..."

# Stop old tunnel services
for service in localtunnel ngrok-tunnel cloudflared; do
    if pm2 list | grep -q "$service"; then
        echo "  Stopping $service..."
        pm2 stop $service 2>/dev/null
        pm2 delete $service 2>/dev/null
    fi
done

# Handle bot restart/start
echo ""
if pm2 list | grep -q "bloodkeeper-bot"; then
    echo "🔄 Restarting bot..."
    pm2 restart bloodkeeper-bot
else
    echo "🚀 Starting bot for the first time..."
    pm2 start ecosystem.config.cjs
    pm2 save
    pm2 startup systemd -u $USER --hp /home/$USER || true
fi

# Wait for bot to initialize
echo ""
echo "⏳ Waiting for bot to initialize..."
sleep 5

# Check bot status
if pm2 list | grep "bloodkeeper-bot" | grep -q "online"; then
    echo "✅ Bot is running!"
else
    echo "❌ Bot failed to start. Checking logs..."
    pm2 logs bloodkeeper-bot --lines 20 --nostream
    exit 1
fi

# Get connection information
PUBLIC_IP=$(curl -s ifconfig.me)
source .env

echo ""
echo "======================================================"
echo "🎉 Deployment Complete!"
echo "======================================================"
echo ""
echo "📊 Bot Status:"
pm2 status bloodkeeper-bot
echo ""
echo "🌐 Connection Information:"
echo "  Public IP: $PUBLIC_IP"
echo "  HTTP endpoint: http://$PUBLIC_IP:3000/interactions"
echo "  HTTPS endpoint: https://$PUBLIC_IP:8443/interactions"

if [ ! -z "$DOMAIN_NAME" ]; then
    echo "  Domain: https://$DOMAIN_NAME/interactions"
fi

echo ""
echo "📋 Discord Developer Portal Configuration:"
echo "  1. Go to: https://discord.com/developers/applications/$DISCORD_APPLICATION_ID/information"
echo "  2. Set Interactions Endpoint URL to:"
echo "     https://$PUBLIC_IP:8443/interactions"

if [ ! -z "$DOMAIN_NAME" ]; then
    echo "     OR if using domain: https://$DOMAIN_NAME/interactions"
fi

echo ""
echo "⚠️  Important Reminders:"
echo "  - Ensure port 8443 is open in Oracle Cloud Security List"
echo "  - Ensure DISCORD_PUBLIC_KEY is set correctly in .env"
echo "  - Commands may take a few minutes to appear in Discord"
echo ""
echo "📊 View logs with: pm2 logs bloodkeeper-bot"
echo "🔄 Restart with: pm2 restart bloodkeeper-bot"
echo "⛔ Stop with: pm2 stop bloodkeeper-bot"
echo ""

# Show recent logs
echo "📋 Recent bot logs:"
echo "-------------------"
pm2 logs bloodkeeper-bot --lines 15 --nostream
