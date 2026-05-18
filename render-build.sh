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

# Download libaio library directly
echo "📦 Downloading libaio library..."
cd instantclient/instantclient_23_4
# Download libaio from a direct source
wget -q -O libaio.so.1 https://github.com/oracle/node-oracledb/releases/download/v6.0.0/libaio.so.1 || \
wget -q http://ftp.us.debian.org/debian/pool/main/liba/libaio/libaio1_0.3.113-5_amd64.deb && \
ar x libaio1_0.3.113-5_amd64.deb && \
tar xf data.tar.xz ./lib/x86_64-linux-gnu/libaio.so.1.0.1 --strip-components=3 && \
ln -sf libaio.so.1.0.1 libaio.so.1 && \
rm -f libaio1_0.3.113-5_amd64.deb control.tar.* data.tar.*
cd ../..

echo "✅ libaio library installed"

# Install Node dependencies
echo "📦 Installing npm packages..."
npm install

echo "✅ Build complete!"
