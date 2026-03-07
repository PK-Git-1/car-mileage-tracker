#!/bin/bash
# setup-verify.sh - Verify Car Mileage Tracker is set up correctly

echo "🔍 Checking Car Mileage Tracker Setup..."
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not installed"
    echo "   Install from: https://nodejs.org/"
    exit 1
fi
echo "✓ Node.js: $(node --version)"

# Check npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm not installed"
    exit 1
fi
echo "✓ npm: $(npm --version)"

# Check Git
if ! command -v git &> /dev/null; then
    echo "❌ Git not installed"
    echo "   Install from: https://git-scm.com/"
    exit 1
fi
echo "✓ Git: $(git --version)"

# Check required files
echo ""
echo "Checking files..."
[ -f "app.js" ] && echo "✓ app.js" || echo "❌ app.js missing"
[ -f "server.js" ] && echo "✓ server.js" || echo "❌ server.js missing"
[ -f "index.html" ] && echo "✓ index.html" || echo "❌ index.html missing"
[ -f "package.json" ] && echo "✓ package.json" || echo "❌ package.json missing"

# Check node_modules
echo ""
if [ -d "node_modules" ]; then
    echo "✓ Dependencies installed"
else
    echo "⚠️  Dependencies not installed"
    echo "   Run: npm install"
fi

# Check git repo
echo ""
if [ -d ".git" ]; then
    echo "✓ Git repository initialized"
else
    echo "⚠️  Git repository not initialized"
    echo "   Run: git init"
fi

echo ""
echo "✅ Setup verification complete!"
echo ""
echo "To start:"
echo "  npm start"
echo ""
echo "Then open: http://localhost:3000"
