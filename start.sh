#!/bin/bash

# PolySpeak - Mac/Linux Startup Script
# This script installs dependencies and starts the development server

# Change to the script's directory (project root)
cd "$(dirname "$0")"

echo "========================================"
echo "  PolySpeak - Structural Speaking Coach"
echo "========================================"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed or not in PATH."
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

echo "[INFO] Node.js version:"
node --version
echo ""

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "[ERROR] npm is not installed or not in PATH."
    exit 1
fi

echo "[INFO] npm version:"
npm --version
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "[INFO] Installing dependencies..."
    echo "This may take a few minutes on first run..."
    echo ""
    npm install
    if [ $? -ne 0 ]; then
        echo "[ERROR] Failed to install dependencies."
        exit 1
    fi
    echo ""
    echo "[SUCCESS] Dependencies installed successfully!"
    echo ""
else
    echo "[INFO] Dependencies already installed."
    echo ""
fi

# Fix permissions for executables in node_modules/.bin (if directory exists)
if [ -d "node_modules/.bin" ]; then
    echo "[INFO] Ensuring executable permissions..."
    chmod +x node_modules/.bin/* 2>/dev/null || true
fi

# Check if .env.local exists
if [ ! -f ".env.local" ]; then
    echo "[INFO] .env.local file not found."
    echo "[INFO] Creating .env.local from example..."
    if [ -f ".env.local.example" ]; then
        cp ".env.local.example" ".env.local"
        echo "[INFO] Please edit .env.local and add your GEMINI_API_KEY (optional)"
    else
        echo "GEMINI_API_KEY=" > .env.local
        echo "[INFO] Created .env.local file. Add your GEMINI_API_KEY if needed."
    fi
    echo ""
fi

echo "========================================"
echo "  Starting development server..."
echo "========================================"
echo ""
echo "The app will open at http://localhost:3000"
echo "Press Ctrl+C to stop the server"
echo ""

# Start the development server
npm run dev

