#!/bin/bash
# Recast Republic API Server Setup for Own Hosting (VPS)
# This script sets up Node.js, the app, and PM2 for production

set -e

echo "🚀 Recast Republic API Server Setup"
echo "===================================="

# Step 1: Update system
echo "📦 Updating system packages..."
sudo apt-get update
sudo apt-get upgrade -y

# Step 2: Install Node.js (v22 LTS recommended)
echo "📦 Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version

# Step 3: Install PM2 globally (process manager)
echo "📦 Installing PM2 (process manager)..."
sudo npm install -g pm2

# Step 4: Clone or navigate to your repo
echo "📁 Setting up application directory..."
APP_DIR="$HOME/recast-republic"
if [ ! -d "$APP_DIR" ]; then
    mkdir -p "$APP_DIR"
    cd "$APP_DIR"
    git clone https://github.com/macsubido29-bit/recast-republic.git .
else
    cd "$APP_DIR"
    git pull origin main
fi

# Step 5: Install dependencies
echo "📚 Installing npm dependencies..."
npm install

# Step 6: Create .env file for production
echo "⚙️  Creating .env file..."
cat > "$APP_DIR/.env" << 'EOF'
PORT=3000
HOST=0.0.0.0
DB_PATH=./data/recast-republic.sqlite
NODE_ENV=production
WEBSITE_URL=https://macsubido29-bit.github.io
CORS_ORIGINS=https://macsubido29-bit.github.io
ADMIN_EMAIL=recastrepublic29@gmail.com
TRUST_PROXY=true

# Email notifications (optional - Gmail example)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=recastrepublic29@gmail.com
SMTP_PASSWORD=your-google-app-password-here
SMTP_FROM=recastrepublic29@gmail.com
EOF

echo "⚠️  IMPORTANT: Edit .env and add your actual values:"
echo "   nano $APP_DIR/.env"
read -p "Press Enter after editing .env..."

# Step 7: Start with PM2
echo "🎯 Starting application with PM2..."
cd "$APP_DIR"
pm2 start server.js --name "recast-republic" --instances max --exec-mode cluster
pm2 save
pm2 startup

echo ""
echo "✅ Setup Complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env with your settings: nano $APP_DIR/.env"
echo "2. Check status: pm2 status"
echo "3. View logs: pm2 logs recast-republic"
echo "4. Update api-config.js in GitHub with your VPS domain"
echo "5. Set up HTTPS with Nginx + Let's Encrypt (see nginx-setup.sh)"
echo ""
