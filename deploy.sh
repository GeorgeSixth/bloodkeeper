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

# Install localtunnel globally if not installed
if ! command -v lt &> /dev/null; then
    echo "🌐 Installing LocalTunnel..."
    npm install -g localtunnel
fi

# Register commands if commands.js changed
if git diff HEAD~1 --name-only | grep -q "src/commands.js"; then
    echo "🔧 Registering slash commands..."
    npm run register
fi

# Create logs directory if it doesn't exist
mkdir -p logs

# Check if bot is already running
if pm2 list | grep -q "bloodkeeper-bot"; then
    echo "🔄 Restarting bot..."
    pm2 restart bloodkeeper-bot
else
    echo "🚀 Starting bot for the first time..."
    pm2 start ecosystem.config.cjs
    pm2 save
fi

# Start or restart LocalTunnel
echo "🌐 Setting up HTTPS tunnel..."
if pm2 list | grep -q "localtunnel"; then
    echo "🔄 Restarting tunnel..."
    pm2 restart localtunnel
else
    echo "🌐 Starting new tunnel..."
    pm2 start --name localtunnel "lt --port 3000 --subdomain bloodkeeper"
    pm2 save
fi

# Wait a moment for tunnel to establish
sleep 3

# Show the tunnel URL
echo ""
echo "🎉 Deployment complete!"
echo "🔗 Your HTTPS endpoint: https://bloodkeeper.loca.lt"
echo "📋 Set this URL in Discord Developer Portal as interactions endpoint:"
echo "   https://bloodkeeper.loca.lt/interactions"
echo ""

# Show status
pm2 status
echo ""
echo "📊 Recent logs:"
pm2 logs bloodkeeper-bot --lines 5
