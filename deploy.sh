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

# Check if bot is already running
if pm2 list | grep -q "bloodkeeper-bot"; then
    echo "🔄 Restarting bot..."
    pm2 restart bloodkeeper-bot
else
    echo "🚀 Starting bot for the first time..."
    pm2 start ecosystem.config.cjs
    pm2 save
fi

# Show status
echo "✅ Deployment complete!"
pm2 status
pm2 logs bloodkeeper-bot --lines 10
