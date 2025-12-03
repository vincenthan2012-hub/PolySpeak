#!/bin/bash

# PolySpeak - Mac/Linux Startup Script
# This script installs dependencies and starts the development server

# Change to the script's directory (project root)
cd "$(dirname "$0")"

echo "========================================"
echo "  PolySpeak - Structural Speaking Coach"
echo "========================================"
echo ""

# Function to install Node.js on macOS
install_node_macos() {
    echo "[INFO] Detected macOS. Attempting to install Node.js..."
    
    # Try Homebrew first
    if command -v brew &> /dev/null; then
        echo "[INFO] Using Homebrew to install Node.js..."
        echo "This may take a few minutes..."
        brew install node
        if [ $? -eq 0 ]; then
            echo "[OK] Node.js installed successfully via Homebrew!"
            return 0
        fi
    fi
    
    # Try downloading installer
    echo "[INFO] Homebrew not available. Downloading Node.js installer..."
    NODE_VERSION="20.18.0"  # LTS version
    ARCH=$(uname -m)
    
    if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then
        NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-arm64.pkg"
    else
        NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-x64.pkg"
    fi
    
    echo "[INFO] Please download and install Node.js from:"
    echo "  $NODE_URL"
    echo "  Or visit: https://nodejs.org/"
    echo ""
    echo "After installation, please restart this script."
    return 1
}

# Function to install Node.js on Linux
install_node_linux() {
    echo "[INFO] Detected Linux. Attempting to install Node.js..."
    
    # Detect Linux distribution
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        DISTRO=$ID
    else
        DISTRO="unknown"
    fi
    
    # Try using nvm (Node Version Manager) - most universal
    if command -v curl &> /dev/null || command -v wget &> /dev/null; then
        echo "[INFO] Installing Node.js using nvm (Node Version Manager)..."
        echo "This is the recommended method for Linux."
        
        # Install nvm if not present
        if [ ! -d "$HOME/.nvm" ]; then
            echo "[INFO] Installing nvm..."
            if command -v curl &> /dev/null; then
                curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
            else
                wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
            fi
            
            # Load nvm
            export NVM_DIR="$HOME/.nvm"
            [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
        else
            # Load nvm if already installed
            export NVM_DIR="$HOME/.nvm"
            [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
        fi
        
        # Install Node.js LTS using nvm
        # nvm is a shell function, not a command, so we need to source it
        if [ -s "$NVM_DIR/nvm.sh" ]; then
            echo "[INFO] Installing Node.js LTS via nvm..."
            . "$NVM_DIR/nvm.sh"
            nvm install --lts
            nvm use --lts
            nvm alias default node
            if [ $? -eq 0 ]; then
                echo "[OK] Node.js installed successfully via nvm!"
                # Add nvm to PATH for current session
                export PATH="$NVM_DIR/versions/node/$(nvm version)/bin:$PATH"
                return 0
            fi
        fi
    fi
    
    # Try package manager based on distribution
    case $DISTRO in
        ubuntu|debian)
            echo "[INFO] Attempting to install Node.js via apt..."
            if command -v sudo &> /dev/null; then
                curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
                sudo apt-get install -y nodejs
                if [ $? -eq 0 ]; then
                    echo "[OK] Node.js installed successfully via apt!"
                    return 0
                fi
            fi
            ;;
        fedora|rhel|centos)
            echo "[INFO] Attempting to install Node.js via dnf/yum..."
            if command -v sudo &> /dev/null; then
                curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash -
                sudo dnf install -y nodejs 2>/dev/null || sudo yum install -y nodejs
                if [ $? -eq 0 ]; then
                    echo "[OK] Node.js installed successfully!"
                    return 0
                fi
            fi
            ;;
        arch|manjaro)
            echo "[INFO] Attempting to install Node.js via pacman..."
            if command -v sudo &> /dev/null; then
                sudo pacman -S --noconfirm nodejs npm
                if [ $? -eq 0 ]; then
                    echo "[OK] Node.js installed successfully!"
                    return 0
                fi
            fi
            ;;
    esac
    
    echo "[ERROR] Automatic installation failed."
    echo ""
    echo "Please install Node.js manually:"
    echo "  1. Visit https://nodejs.org/"
    echo "  2. Download the LTS version for your system"
    echo "  3. Follow the installation instructions"
    echo "  4. Restart this script after installation"
    echo ""
    echo "Or install nvm manually:"
    echo "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
    echo ""
    return 1
}

# Try to load nvm if it exists (for Linux users who already have nvm)
if [ -s "$HOME/.nvm/nvm.sh" ]; then
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    # Use default node version if available
    nvm use default 2>/dev/null || nvm use node 2>/dev/null || true
    # Add nvm node to PATH
    if [ -n "$(nvm version 2>/dev/null)" ]; then
        export PATH="$NVM_DIR/versions/node/$(nvm version)/bin:$PATH"
    fi
fi

# Check if Node.js is installed
echo "[1/5] Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo "[INFO] Node.js is not installed. Attempting to install automatically..."
    echo ""
    
    # Detect OS
    OS="$(uname -s)"
    case "$OS" in
        Darwin*)
            install_node_macos
            ;;
        Linux*)
            install_node_linux
            ;;
        *)
            echo "[ERROR] Unsupported operating system: $OS"
            echo "Please install Node.js manually from https://nodejs.org/"
            exit 1
            ;;
    esac
    
    if [ $? -ne 0 ]; then
        exit 1
    fi
    
    # Verify installation and refresh PATH if needed
    if ! command -v node &> /dev/null; then
        # Try to load nvm if it was just installed
        if [ -s "$HOME/.nvm/nvm.sh" ]; then
            export NVM_DIR="$HOME/.nvm"
            [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
            nvm use --lts 2>/dev/null
            export PATH="$NVM_DIR/versions/node/$(nvm version 2>/dev/null)/bin:$PATH"
        fi
        
        # Check again
        if ! command -v node &> /dev/null; then
            echo "[ERROR] Node.js installation completed but not found in PATH."
            echo "Please restart your terminal or run: source ~/.bashrc (or ~/.zshrc)"
            echo "Then run this script again."
            exit 1
        fi
    fi
fi

echo "[OK] Node.js version:"
node --version
echo ""

# Check if npm is installed
echo "[2/5] Checking npm..."
if ! command -v npm &> /dev/null; then
    echo "[ERROR] npm is not installed or not in PATH."
    echo "npm should come with Node.js. Please reinstall Node.js."
    exit 1
fi

echo "[OK] npm version:"
npm --version
echo ""

# Check if node_modules exists
echo "[3/5] Checking dependencies..."
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
    echo "[OK] Dependencies already installed."
    echo ""
fi

# Fix permissions for executables in node_modules/.bin (if directory exists)
if [ -d "node_modules/.bin" ]; then
    echo "[4/5] Ensuring executable permissions..."
    chmod +x node_modules/.bin/* 2>/dev/null || true
fi

# Check if .env.local exists
echo "[5/5] Checking environment configuration..."
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
else
    echo "[OK] .env.local exists"
    echo ""
fi

echo "========================================"
echo "  Starting development server..."
echo "========================================"
echo ""
echo "The app will open at http://localhost:5173"
echo "Press Ctrl+C to stop the server"
echo ""

# Start the development server
npm run dev

