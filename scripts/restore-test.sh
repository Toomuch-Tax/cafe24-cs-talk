#!/usr/bin/env bash
# 백업 복원 테스트: 로컬 임시 DB 에 복원해 주요 테이블 행 수를 확인하고 지운다. (운영 DB 는 건드리지 않음)
# 사용: bash scripts/restore-test.sh [덤프 파일]   (기본: ~/CS_Talk_Backups 의 가장 최근 파일)
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$HOME/CS_Talk_Backups}"
DUMP="${1:-$(ls -1t "$BACKUP_DIR"/cs-talk-*.dump 2>/dev/null | head -1)}"
[ -s "$DUMP" ] || { echo "덤프 파일이 없어요" >&2; exit 1; }

BIN=/opt/homebrew/opt/libpq/bin
[ -x "$BIN/pg_restore" ] || BIN=$(ls -d /opt/homebrew/opt/postgresql@*/bin 2>/dev/null | sort -V | tail -1)
BIN="${BIN:-$(dirname "$(command -v pg_restore)")}"
DB="cs_talk_restore_test_$$"

"$BIN/createdb" "$DB"
trap '"$BIN/dropdb" --if-exists "$DB"' EXIT
# 덤프에 public 스키마 생성이 들어 있으므로 빈 DB 의 기본 public 스키마를 먼저 지운다
"$BIN/psql" -q -d "$DB" -c "drop schema public cascade"
# 로컬 Postgres 가 운영(17)보다 낮아도 되도록 SQL 로 풀어서 넣고, 17 전용 설정은 뺀다
"$BIN/pg_restore" --no-owner --no-privileges --file=- "$DUMP" \
  | sed '/^SET transaction_timeout/d' \
  | "$BIN/psql" -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null

echo "복원 확인: $DUMP"
"$BIN/psql" -d "$DB" -v ON_ERROR_STOP=1 -c "
  select 'conversations' as tbl, count(*) from conversations
  union all select 'messages', count(*) from messages
  union all select 'contacts', count(*) from contacts
  union all select 'settings', count(*) from settings
  union all select 'schema_migrations', count(*) from schema_migrations"
echo "복원 테스트 성공 (임시 DB $DB 는 삭제됩니다)"
