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

# Copy libaio library from repo
echo "📦 Installing libaio library from repo..."
cp libs/libaio.so.1 instantclient/instantclient_23_4/libaio.so.1
chmod +x instantclient/instantclient_23_4/libaio.so.1
echo "✅ libaio library installed (size: $(stat -c%s instantclient/instantclient_23_4/libaio.so.1) bytes)"

# Install Node dependencies
echo "📦 Installing npm packages..."
npm install

# Fix wallet file permissions (ORA-28759 prevention)
echo "🔐 Setting wallet file permissions..."
if [ -d "wallet" ]; then
    chmod 644 wallet/*
    echo "✅ Wallet permissions set to 644 (readable)"
else
    echo "⚠️  WARNING: wallet/ directory not found!"
fi

echo "✅ Build complete!"
