#!/bin/bash
# Деплой proxy на gemini-proxy.mooo.com
# Использование: ./deploy.sh [user@IP]
# Пример: ./deploy.sh root@123.45.67.89

TARGET="${1:-root@SERVER_IP}"
REMOTE_DIR="/opt/gemini-proxy"

echo "=== Деплой Design Process proxy на $TARGET ==="

# Копируем файлы (без node_modules)
scp server.js mcp-server.js package.json package-lock.json "$TARGET:$REMOTE_DIR/"

echo ""
echo "Теперь подключитесь к серверу и выполните:"
echo "  ssh $TARGET"
echo "  cd $REMOTE_DIR"
echo "  npm install"
echo "  pm2 restart gemini-proxy"
echo ""
echo "Если pm2 использует .env, убедитесь что в $REMOTE_DIR/.env есть:"
echo "  GEMINI_API_KEY=..."
echo "  FIGMA_ACCESS_TOKEN=..."
echo ""
