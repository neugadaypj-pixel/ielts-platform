#!/bin/bash
set -e

echo "🔧 Installing Oracle Instant Client..."

# Create directory in project root (Render allows writes here)
mkdir -p instantclient

# Download Oracle Instant Client Basic
echo "📥 Downloading Oracle Instant Client..."
wget -q https://download.oracle.com/otn_software/linux/instantclient/2340000/instantclient-basic-linux.x64-23.4.0.24.05.zip

# Unzip to project directory
echo "📦 Extracting..."
unzip -q instantclient-basic-linux.x64-23.4.0.24.05.zip -d instantclient

# Clean up zip file
rm instantclient-basic-linux.x64-23.4.0.24.05.zip

echo "✅ Oracle Instant Client installed at $(pwd)/instantclient/instantclient_23_4"

# Install Node dependencies
echo "📦 Installing npm packages..."
npm install

echo "✅ Build complete!"
