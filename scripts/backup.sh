#!/usr/bin/env bash
# DB 백업 (pg_dump, public 스키마). Supabase 일별 백업과 별개로 직접 들고 있는 사본.
# 사용: bash scripts/backup.sh [env 파일]   (기본 .env.production.local — docs/deploy.md 의 vercel env pull 로 받은 파일)
# 결과: $BACKUP_DIR(기본 ~/CS_Talk_Backups)/cs-talk-<날짜시각>.dump, 최근 30개만 보관
# 덤프에는 고객 개인정보가 들어 있다 → 본인만 읽을 수 있게 저장하고, 클라우드 동기화 폴더에 두지 않는다.
set -euo pipefail

ENV_FILE="${1:-.env.production.local}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/CS_Talk_Backups}"
KEEP="${KEEP:-30}"

[ -f "$ENV_FILE" ] || { echo "env 파일이 없어요: $ENV_FILE" >&2; exit 1; }
URL=$(node --env-file="$ENV_FILE" -e 'process.stdout.write((process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL ?? "").split("?")[0])')
[ -n "$URL" ] || { echo "POSTGRES_URL_NON_POOLING / DATABASE_URL 이 없어요" >&2; exit 1; }
case "$URL" in *localhost*|*127.0.0.1*) ;; *) URL="$URL?sslmode=require" ;; esac

# 서버(Supabase, Postgres 17)보다 낮은 버전의 pg_dump 는 거부된다 → libpq(항상 최신) 우선, 없으면 설치된 것 중 최신
# 없으면: brew install libpq
PG_DUMP=/opt/homebrew/opt/libpq/bin/pg_dump
[ -x "$PG_DUMP" ] || PG_DUMP=$(ls -d /opt/homebrew/opt/postgresql@*/bin/pg_dump 2>/dev/null | sort -V | tail -1)
PG_DUMP="${PG_DUMP:-$(command -v pg_dump)}"

umask 077
mkdir -p "$BACKUP_DIR"
OUT="$BACKUP_DIR/cs-talk-$(date +%Y%m%d-%H%M).dump"
"$PG_DUMP" --format=custom --no-owner --no-privileges --schema=public --file="$OUT" "$URL" || { rm -f "$OUT"; exit 1; }
echo "백업 완료: $OUT ($(du -h "$OUT" | cut -f1))"

ls -1t "$BACKUP_DIR"/cs-talk-*.dump | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f "$old"; done
