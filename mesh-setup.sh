#!/bin/bash

# ZippyMesh Node Setup (Linux/macOS)

echo -e "\033[0;36m--- ZippyMesh Node Setup ---\033[0m"

# 1. Check for Node.js
if ! command -v node &> /dev/null; then
    echo -e "\033[0;31mError: Node.js is not installed. Please install Node.js 18+.\033[0m"
    exit 1
fi

# 2. Setup Environment
if [ ! -f .env ]; then
    echo "Creating .env from example..."
    cp .env.example .env
    echo -e "\033[0;33mGenerated .env. Please edit it to customize your node name/ports if needed.\033[0m"
fi

# 3. Install Dependencies
echo "Installing dependencies..."
npm install

# 4. Build Application
echo "Building application..."
npm run build

# 5. Success
echo -e "\033[0;32m--- Installation Complete ---\033[0m"
echo "To start your node: npm start"
