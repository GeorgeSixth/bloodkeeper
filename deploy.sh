#!/bin/bash

# Bloodkeeper Bot Deployment Script
echo "Deploying Bloodkeeper Bot..."

# Pull latest changes
echo "Pulling latest code..."
git pull origin main

# Install dependencies if package.json changed
if git diff HEAD~1 --name-only | grep -q "package.json"; then
    echo "Installing dependencies..."
    npm install
fi

# Register commands if commands.js changed
if git diff HEAD~1 --name-only | grep -q "src/commands.js"; then
    echo "Registering slash commands..."
    npm run register
fi

# Restart the bot
echo "Restarting bot..."
pm2 restart bloodkeeper-bot

# Show status
echo "✅ Deployment complete!"
pm2 status bloodkeeper-bot
pm2 logs bloodkeeper-bot --lines 10
