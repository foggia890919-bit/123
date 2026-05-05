#!/bin/bash
# 텔레그램 봇 systemd 서비스 설치
# 실행: bash ~/sales/simple/scripts/install-bot.sh

set -e

SERVICE_NAME="naver-sales-bot"
SERVICE_FILE="/home/ubuntu/sales/simple/scripts/naver-sales-bot.service"
TARGET="/etc/systemd/system/${SERVICE_NAME}.service"

if [ ! -f "$SERVICE_FILE" ]; then
  echo "❌ $SERVICE_FILE 없음"
  exit 1
fi

echo "📦 systemd 서비스 등록…"
sudo cp "$SERVICE_FILE" "$TARGET"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

sleep 2
echo ""
echo "✅ 설치 완료. 상태:"
sudo systemctl status "$SERVICE_NAME" --no-pager | head -15

echo ""
echo "로그 확인: tail -f ~/sales/bot.log"
echo "재시작:    sudo systemctl restart $SERVICE_NAME"
echo "정지:      sudo systemctl stop $SERVICE_NAME"
echo "비활성화:  sudo systemctl disable $SERVICE_NAME"
