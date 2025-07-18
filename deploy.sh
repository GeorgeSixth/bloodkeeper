#!/bin/bash

# Bloodkeeper Bot Deployment Script
echo "🚀 Deploying Bloodkeeper Bot..."

# Pull latest changes
echo "📥 Pulling latest code..."
git pull origin main

# Install dependencies if package.json changed
if git diff HEAD~1 --name-only | grep -q "package.json"; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Register commands if commands.js changed
if git diff HEAD~1 --name-only | grep -q "src/commands.js"; then
    echo "🔧 Registering slash commands..."
    npm run register
fi

# Create logs directory if it doesn't exist
mkdir -p logs

# Stop and remove any old tunnel services
if pm2 list | grep -q "localtunnel"; then
    echo "🧹 Cleaning up old tunnel service..."
    pm2 stop localtunnel
    pm2 delete localtunnel
fi

if pm2 list | grep -q "ngrok-tunnel"; then
    echo "🧹 Cleaning up old ngrok tunnel..."
    pm2 stop ngrok-tunnel
    pm2 delete ngrok-tunnel
fi

# Check if bot is already running
if pm2 list | grep -q "bloodkeeper-bot"; then
    echo "🔄 Restarting bot..."
    pm2 restart bloodkeeper-bot
else
    echo "🚀 Starting bot for the first time..."
    pm2 start ecosystem.config.cjs
    pm2 save
fi

# Wait a moment for bot to start
sleep 3

# Get the public IP
PUBLIC_IP=$(curl -s ifconfig.me)

# Show the endpoints
echo ""
echo "🎉 Deployment complete!"
echo "🌐 Public IP: $PUBLIC_IP"
echo "🔗 HTTP endpoint: http://$PUBLIC_IP:3000/interactions"
echo "🔒 HTTPS endpoint: https://$PUBLIC_IP:8443/interactions"
echo ""
echo "📋 Set this URL in Discord Developer Portal as interactions endpoint:"
echo "   https://$PUBLIC_IP:8443/interactions"
echo ""
echo "⚠️  Make sure port 8443 is open in Oracle Cloud Security List!"
echo ""

# Show status
pm2 status
echo ""
echo "📊 Recent logs:"
pm2 logs bloodkeeper-bot --lines 10
