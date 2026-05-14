#!/bin/bash
# cron 자동 등록 (run.ts 매일 8시 + scheduler.ts 매분 폴링)
# 실행: bash ~/sales/simple/scripts/install-cron.sh
#
# 기존 sales 관련 cron 줄 제거 후 새로 등록 (idempotent).

set -e

WORKDIR="/home/ubuntu/sales/simple"
NPX="/usr/bin/npx"
LOG_DIR="/home/ubuntu"

# 기존 crontab 백업
crontab -l > /tmp/cron.bak 2>/dev/null || true

# sales 관련 줄만 제거 (다른 crontab 보존)
grep -v "sales/simple" /tmp/cron.bak > /tmp/cron.clean || true

# 새 cron 추가
cat >> /tmp/cron.clean <<EOF

# 네이버 매출 자동화
PATH=/usr/local/bin:/usr/bin:/bin
# 매일 KST 8시 — 매출 보고 (어제 + 7일 롤링)
0 8 * * * cd ${WORKDIR} && ${NPX} tsx run.ts >> ${LOG_DIR}/sales.log 2>&1
# 매일 KST 8시 1분 — 재고 보고 (B2C 재고장 → 텔레그램 + ⭐재고이력 누적)
1 8 * * * cd ${WORKDIR} && ${NPX} tsx inventory-report.ts >> ${LOG_DIR}/sales.log 2>&1
# 매분 — 시트 「자동화」 폴링 (사장님이 GO 입력하면 실행)
* * * * * cd ${WORKDIR} && ${NPX} tsx scheduler.ts >> ${LOG_DIR}/scheduler.log 2>&1
EOF

# 적용
crontab /tmp/cron.clean

echo "✅ cron 등록 완료"
echo ""
echo "현재 등록된 작업:"
crontab -l | grep -v "^#" | grep -v "^$"
echo ""
echo "로그 보기:"
echo "  tail -f ~/sales.log        # 매일 8시 매출 보고"
echo "  tail -f ~/scheduler.log    # 매분 자동화 폴링"
