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

# Download libaio library directly (Ubuntu 20.04 version)
echo "📦 Downloading libaio library..."
mkdir -p lib
cd lib
wget -q http://archive.ubuntu.com/ubuntu/pool/main/liba/libaio/libaio1_0.3.112-5_amd64.deb
ar x libaio1_0.3.112-5_amd64.deb
tar xf data.tar.xz
# Find and copy the libaio library
find . -name "libaio.so.1*" -exec cp {} ../instantclient/instantclient_23_4/ \;
cd ..
rm -rf lib

echo "✅ libaio library installed"

# Install Node dependencies
echo "📦 Installing npm packages..."
npm install

echo "✅ Build complete!"
