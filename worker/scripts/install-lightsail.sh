#!/usr/bin/env bash
# AWS Lightsail Seoul (Ubuntu 22.04) one-shot installer for the inventory worker.
#
# Usage on a fresh Lightsail instance:
#   ssh ubuntu@<your-ip>
#   curl -fsSL https://raw.githubusercontent.com/foggia890919-bit/123/claude/plan-service-project-Ea4Bn/worker/scripts/install-lightsail.sh | bash
#
# After the script finishes, edit /home/ubuntu/inventory/worker/.env
# (credentials + WORKER_TOKEN) and run:
#   sudo systemctl start inventory-worker

set -euo pipefail

REPO="https://github.com/foggia890919-bit/123.git"
BRANCH="claude/plan-service-project-Ea4Bn"
INSTALL_DIR="${HOME}/inventory"
WORKER_DIR="${INSTALL_DIR}/worker"

echo "==> updating apt"
sudo apt-get update -y

echo "==> installing prerequisites (git, curl, build tools)"
sudo apt-get install -y git curl ca-certificates gnupg

echo "==> installing Node.js 20"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "    node $(node -v) / npm $(npm -v)"

echo "==> cloning repo"
if [ ! -d "${INSTALL_DIR}/.git" ]; then
  git clone --branch "${BRANCH}" "${REPO}" "${INSTALL_DIR}"
else
  cd "${INSTALL_DIR}"
  git fetch origin
  git checkout "${BRANCH}"
  git pull --ff-only origin "${BRANCH}"
fi

echo "==> installing worker dependencies"
cd "${WORKER_DIR}"
npm install --no-audit --no-fund

echo "==> installing chromium + system libs for Playwright"
sudo apt-get install -y \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libxcomposite1 libxdamage1 \
  libxrandr2 libgbm1 libpango-1.0-0 libasound2 libxshmfence1 libdrm2 || true
sudo npx playwright install --with-deps chromium || npx playwright install chromium

echo "==> writing .env if missing"
if [ ! -f "${WORKER_DIR}/.env" ]; then
  cp "${WORKER_DIR}/.env.example" "${WORKER_DIR}/.env"
  TOKEN=$(openssl rand -hex 32)
  sed -i "s|^WORKER_TOKEN=.*|WORKER_TOKEN=${TOKEN}|" "${WORKER_DIR}/.env"
  echo ""
  echo "==================================================================="
  echo " Generated WORKER_TOKEN. Save this — you'll set it on Vercel too:"
  echo ""
  echo "   ${TOKEN}"
  echo ""
  echo "==================================================================="
  echo ""
fi

echo "==> installing systemd service"
sudo tee /etc/systemd/system/inventory-worker.service >/dev/null <<EOF
[Unit]
Description=Inventory Scraper Worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${USER}
WorkingDirectory=${WORKER_DIR}
EnvironmentFile=${WORKER_DIR}/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable inventory-worker

echo ""
echo "==================================================================="
echo " Setup complete."
echo ""
echo " Next steps:"
echo "   1. Edit ${WORKER_DIR}/.env and add wholesale credentials:"
echo "        nano ${WORKER_DIR}/.env"
echo ""
echo "   2. Open Lightsail port 8080:"
echo "        Lightsail console -> Networking -> Add rule (TCP 8080)"
echo ""
echo "   3. Start the worker:"
echo "        sudo systemctl start inventory-worker"
echo ""
echo "   4. Watch logs:"
echo "        sudo journalctl -u inventory-worker -f"
echo ""
echo "   5. On Vercel, add env vars:"
echo "        WORKER_URL  = http://<your-lightsail-ip>:8080"
echo "        WORKER_TOKEN = (the token shown above)"
echo "==================================================================="
