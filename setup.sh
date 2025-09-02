#!/bin/bash

# Bloodkeeper Bot Complete Setup Script
# This script will help you set up everything including domain configuration

echo "======================================================"
echo "🩸 Bloodkeeper Bot Setup Wizard"
echo "======================================================"
echo ""

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
echo "📋 Checking prerequisites..."

if ! command_exists node; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

if ! command_exists npm; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

if ! command_exists pm2; then
    echo "⚠️ PM2 is not installed. Installing globally..."
    sudo npm install -g pm2
fi

echo "✅ All prerequisites found!"
echo ""

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    echo "Please provide the following information:"
    echo ""
    
    read -p "Discord Bot Token: " BOT_TOKEN
    read -p "Discord Application ID: " APP_ID
    read -p "Discord Public Key: " PUBLIC_KEY
    read -p "Discord Guild/Server ID (for testing): " GUILD_ID
    read -p "Tzimisce Bot ID: " TZIMISCE_ID
    read -p "Blood Channel ID: " BLOOD_CHANNEL

    cat > .env << EOF
# Discord Configuration
DISCORD_BOT_TOKEN=$BOT_TOKEN
DISCORD_APPLICATION_ID=$APP_ID
DISCORD_PUBLIC_KEY=$PUBLIC_KEY
DISCORD_GUILD_ID=$GUILD_ID

# Bot Settings
TZIMISCE_BOT_ID=$TZIMISCE_ID
BLOOD_CHANNEL_ID=$BLOOD_CHANNEL

# Database
DB_PATH=./data/bloodkeeper.db

# Domain Configuration (optional)
DOMAIN_NAME=
EOF

    echo "✅ .env file created!"
else
    echo "✅ .env file already exists"
fi

echo ""
echo "======================================================"
echo "🌐 Domain Setup Options"
echo "======================================================"
echo ""
echo "Choose your setup method:"
echo "1) Use IP address with self-signed certificate (current setup)"
echo "2) Use a Google Workspace domain with Cloudflare"
echo "3) Use a custom domain with Let's Encrypt"
echo ""
read -p "Enter your choice (1-3): " DOMAIN_CHOICE

case $DOMAIN_CHOICE in
    1)
        echo ""
        echo "📋 Using IP address setup..."
        PUBLIC_IP=$(curl -s ifconfig.me)
        echo "Your public IP: $PUBLIC_IP"
        echo ""
        echo "⚠️ Make sure these ports are open in Oracle Cloud:"
        echo "   - Port 8443 (HTTPS)"
        echo "   - Port 3000 (HTTP - optional for testing)"
        echo ""
        echo "Set this URL in Discord Developer Portal:"
        echo "👉 https://$PUBLIC_IP:8443/interactions"
        ;;
        
    2)
        echo ""
        echo "======================================================"
        echo "📧 Google Workspace Domain Setup with Cloudflare"
        echo "======================================================"
        echo ""
        echo "Prerequisites:"
        echo "1. A Google Workspace account with a domain"
        echo "2. Domain DNS managed by Cloudflare (free tier is fine)"
        echo ""
        read -p "Enter your domain name (e.g., yourdomain.com): " DOMAIN_NAME
        read -p "Enter subdomain for the bot (e.g., bot): " SUBDOMAIN
        
        FULL_DOMAIN="$SUBDOMAIN.$DOMAIN_NAME"
        
        echo ""
        echo "📋 Setup Instructions:"
        echo ""
        echo "Step 1: Configure Cloudflare DNS"
        echo "--------------------------------"
        echo "1. Log into Cloudflare Dashboard"
        echo "2. Select your domain"
        echo "3. Go to DNS settings"
        echo "4. Add an A record:"
        echo "   - Type: A"
        echo "   - Name: $SUBDOMAIN"
        echo "   - IPv4 address: $(curl -s ifconfig.me)"
        echo "   - Proxy status: DNS only (gray cloud)"
        echo ""
        echo "Step 2: Install Cloudflare Tunnel (recommended for HTTPS)"
        echo "----------------------------------------------------------"
        echo "This avoids certificate issues and provides automatic HTTPS"
        echo ""
        
        read -p "Would you like to set up Cloudflare Tunnel? (y/n): " SETUP_TUNNEL
        
        if [ "$SETUP_TUNNEL" = "y" ]; then
            echo ""
            echo "Installing cloudflared..."
            wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
            sudo dpkg -i cloudflared-linux-amd64.deb
            rm cloudflared-linux-amd64.deb
            
            echo ""
            echo "📋 Cloudflare Tunnel Setup:"
            echo "1. Run: cloudflared tunnel login"
            echo "2. Authenticate with your Cloudflare account"
            echo "3. Run: cloudflared tunnel create bloodkeeper"
            echo "4. Run: cloudflared tunnel route dns bloodkeeper $FULL_DOMAIN"
            echo ""
            echo "5. Create config file at ~/.cloudflared/config.yml:"
            cat << EOF

url: http://localhost:3000
tunnel: <YOUR_TUNNEL_ID>
credentials-file: /home/ubuntu/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: $FULL_DOMAIN
    service: http://localhost:3000
  - service: http_status:404
EOF
            echo ""
            echo "6. Start tunnel: cloudflared tunnel run bloodkeeper"
            echo "7. Set Discord webhook URL to: https://$FULL_DOMAIN/interactions"
        fi
        
        # Update .env with domain
        sed -i "s/DOMAIN_NAME=.*/DOMAIN_NAME=$FULL_DOMAIN/" .env
        ;;
        
    3)
        echo ""
        echo "======================================================"
        echo "🔒 Custom Domain with Let's Encrypt"
        echo "======================================================"
        echo ""
        read -p "Enter your domain name: " DOMAIN_NAME
        
        echo "Installing Certbot..."
        sudo apt update
        sudo apt install -y certbot
        
        echo ""
        echo "📋 Certificate Setup Instructions:"
        echo "1. Make sure your domain points to this server's IP: $(curl -s ifconfig.me)"
        echo "2. Stop any services on port 80"
        echo "3. Run: sudo certbot certonly --standalone -d $DOMAIN_NAME"
        echo "4. Update the bot to use Let's Encrypt certificates"
        echo ""
        
        # Update .env with domain
        sed -i "s/DOMAIN_NAME=.*/DOMAIN_NAME=$DOMAIN_NAME/" .env
        ;;
esac

echo ""
echo "======================================================"
echo "🚀 Final Setup Steps"
echo "======================================================"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Register commands
echo ""
echo "🔧 Registering Discord commands..."
npm run register

# Create ecosystem file for PM2
echo ""
echo "📝 Creating PM2 ecosystem file..."
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
      NODE_ENV: 'production'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};
EOF

echo ""
echo "======================================================"
echo "✅ Setup Complete!"
echo "======================================================"
echo ""
echo "📋 Important Information:"
echo ""
echo "1. Discord Developer Portal Settings:"
echo "   - Go to: https://discord.com/developers/applications"
echo "   - Select your application"
echo "   - Go to 'General Information' tab"
echo "   - Copy the PUBLIC KEY and add it to .env file"
echo "   - Go to 'Interactions Endpoint URL' section"
echo ""

if [ "$DOMAIN_CHOICE" = "1" ]; then
    echo "   - Set URL to: https://$(curl -s ifconfig.me):8443/interactions"
elif [ "$DOMAIN_CHOICE" = "2" ] && [ "$SETUP_TUNNEL" = "y" ]; then
    echo "   - Set URL to: https://$FULL_DOMAIN/interactions"
elif [ "$DOMAIN_CHOICE" = "3" ]; then
    echo "   - Set URL to: https://$DOMAIN_NAME/interactions"
fi

echo ""
echo "2. Oracle Cloud Firewall Rules:"
echo "   - Port 8443 (HTTPS)"
echo "   - Port 3000 (HTTP - optional)"
echo ""
echo "3. Start the bot:"
echo "   ./deploy.sh"
echo ""
echo "4. Check logs:"
echo "   pm2 logs bloodkeeper-bot"
echo ""
echo "5. Monitor status:"
echo "   pm2 status"
echo ""

read -p "Would you like to start the bot now? (y/n): " START_NOW

if [ "$START_NOW" = "y" ]; then
    ./deploy.sh
fi
