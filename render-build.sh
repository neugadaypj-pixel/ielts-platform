#!/bin/bash
set -e

echo "🔧 Installing Oracle Instant Client..."

# Download Oracle Instant Client Basic
wget -q https://download.oracle.com/otn_software/linux/instantclient/2340000/instantclient-basic-linux.x64-23.4.0.24.05.zip

# Unzip to /opt/oracle
mkdir -p /opt/oracle
unzip -q instantclient-basic-linux.x64-23.4.0.24.05.zip -d /opt/oracle

# Set up library path
export LD_LIBRARY_PATH=/opt/oracle/instantclient_23_4:$LD_LIBRARY_PATH
echo "export LD_LIBRARY_PATH=/opt/oracle/instantclient_23_4:\$LD_LIBRARY_PATH" >> ~/.bashrc

echo "✅ Oracle Instant Client installed"

# Install Node dependencies
echo "📦 Installing npm packages..."
npm install

echo "✅ Build complete!"
