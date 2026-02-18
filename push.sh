#!/bin/bash
# Скрипт для пуша на GitHub
cd "$(dirname "$0")"

echo "🔄 Push на GitHub..."
git push origin main

if [ $? -eq 0 ]; then
    echo "✅ Готово! Изменения залиты на GitHub"
else
    echo ""
    echo "⚠️ Нужна авторизация. Выбери способ:"
    echo ""
    echo "1) Через Cursor: Source Control (Ctrl+Shift+G) → Sync Changes"
    echo ""
    echo "2) Через терминал с токеном:"
    echo "   git push https://ТВОЙ_ТОКЕН@github.com/Vsttsk/mapgress.git main"
    echo "   (токен: GitHub → Settings → Developer settings → Personal access tokens)"
    echo ""
    echo "3) Настроить SSH: ssh-keygen -t ed25519 -C 'email@example.com'"
    echo "   Добавить ~/.ssh/id_ed25519.pub в GitHub → Settings → SSH keys"
fi
