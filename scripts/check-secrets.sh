#!/usr/bin/env bash
# 실키(sk-ant-... 등)가 .env가 아닌 파일에 들어갔는지 확인하는 간단한 안전장치.
# git을 쓰게 되면 커밋 전에 한 번씩 돌려보세요: bash scripts/check-secrets.sh
set -e
cd "$(dirname "$0")/.."

echo "🔍 실키 패턴 검사 중..."
MATCHES=$(grep -rn "sk-ant-api[0-9]" . \
  --exclude-dir=node_modules --exclude-dir=.git \
  --exclude="*.env" 2>/dev/null || true)

if [ -n "$MATCHES" ]; then
  echo "⚠️  .env가 아닌 파일에서 실키로 보이는 패턴을 발견했습니다:"
  echo "$MATCHES"
  exit 1
else
  echo "✅ 이상 없음 — .env 외 파일에서 실키 패턴 발견되지 않음"
fi
