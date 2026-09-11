#!/usr/bin/env bash
set -euo pipefail

# Local-only disaster-recovery rehearsal. It never accepts a database URL and
# uses only synthetic sentinel rows inside two isolated, temporary containers.

if [[ "${ALLOW_SYNTHETIC_RESTORE_REHEARSAL:-}" != "1" ]]; then
  echo "拒绝运行：请显式设置 ALLOW_SYNTHETIC_RESTORE_REHEARSAL=1" >&2
  exit 2
fi

command -v docker >/dev/null 2>&1 || { echo "缺少 docker" >&2; exit 2; }
docker info >/dev/null 2>&1 || { echo "Docker 未运行" >&2; exit 2; }

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
migration_dir="$repo_root/server/db/migrations"
run_suffix="$(date +%Y%m%d%H%M%S)-$$"
source_container="pennys-restore-source-$run_suffix"
target_container="pennys-restore-target-$run_suffix"
source_database="pennys_restore_source"
target_database="pennys_restore_target"
test_password="pennys-synthetic-restore-only"
temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/pennys-restore-rehearsal.XXXXXX")"
dump_file="$temp_dir/pennys-synthetic.dump"

cleanup() {
  docker rm -f "$source_container" "$target_container" >/dev/null 2>&1 || true
  if [[ "$temp_dir" == "${TMPDIR:-/tmp}/pennys-restore-rehearsal."* ]]; then
    find "$temp_dir" -type f -delete 2>/dev/null || true
    rmdir "$temp_dir" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

start_postgres() {
  local container="$1" database="$2"
  docker run --detach --name "$container" \
    --tmpfs /var/lib/postgresql/data:rw,nosuid,noexec,size=768m \
    --env "POSTGRES_PASSWORD=$test_password" \
    --env "POSTGRES_DB=$database" \
    postgres:16-alpine >/dev/null
  local attempt
  for attempt in $(seq 1 60); do
    if docker exec "$container" pg_isready --username postgres --dbname "$database" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "PostgreSQL 启动超时：$container" >&2
  return 1
}

prepare_roles() {
  local container="$1" database="$2"
  docker exec --interactive "$container" psql --set ON_ERROR_STOP=1 --username postgres --dbname "$database" >/dev/null <<'SQL'
CREATE ROLE venture_club_app NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
SQL
}

start_postgres "$source_container" "$source_database"
start_postgres "$target_container" "$target_database"
prepare_roles "$source_container" "$source_database"
prepare_roles "$target_container" "$target_database"

docker exec --interactive "$source_container" psql --set ON_ERROR_STOP=1 --username postgres --dbname "$source_database" >/dev/null <<'SQL'
CREATE SCHEMA IF NOT EXISTS venture_private;
REVOKE ALL ON SCHEMA venture_private FROM PUBLIC;
CREATE TABLE IF NOT EXISTS venture_private.schema_migrations (
  version text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

migration_files=(
  "$migration_dir"/001_core_domains.sql
  "$migration_dir"/002_security.sql
  "$migration_dir"/003_cloudbase_gateway_read_views.sql
  "$migration_dir"/004_wechat_identity_entitlement.sql
  "$migration_dir"/005_resource_private_storage.sql
  "$migration_dir"/006_governed_member_import.sql
  "$migration_dir"/007_governed_materialization.sql
  "$migration_dir"/008_admin_session_rbac.sql
  "$migration_dir"/014_production_intake_008_baseline.sql
)

for migration_file in "${migration_files[@]}"; do
  [[ -f "$migration_file" ]] || { echo "缺少迁移：$migration_file" >&2; exit 1; }
  docker exec --interactive "$source_container" psql --set ON_ERROR_STOP=1 --username postgres --dbname "$source_database" >/dev/null < "$migration_file"
  migration_name="$(basename "$migration_file" .sql)"
  migration_checksum="$(shasum -a 256 "$migration_file" | awk '{print $1}')"
  docker exec "$source_container" psql --set ON_ERROR_STOP=1 --username postgres --dbname "$source_database" \
    --command "INSERT INTO venture_private.schema_migrations(version,checksum) VALUES ('$migration_name','$migration_checksum') ON CONFLICT(version) DO UPDATE SET checksum=excluded.checksum" >/dev/null
done

docker exec --interactive "$source_container" psql --set ON_ERROR_STOP=1 --username postgres --dbname "$source_database" >/dev/null <<'SQL'
INSERT INTO venture_private.users(id,identity_subject_ciphertext,display_name,account_status)
VALUES ('restore-drill-synthetic-user','ciphertext:synthetic-only','合成恢复哨兵','active');
INSERT INTO venture_private.activities(id,format,title,starts_at,category,status,meeting_link_ciphertext)
VALUES ('restore-drill-synthetic-activity','online','合成恢复演练活动','2030-01-01T01:00:00Z','restore_drill','waiting','ciphertext:synthetic-only');
INSERT INTO venture_private.audit_logs(id,actor_user_id,actor_role,action,subject_type,subject_id,safe_change_summary)
VALUES ('restore-drill-synthetic-audit','restore-drill-synthetic-user','system_admin','restore.rehearsal.seed','restore_rehearsal','restore-drill-synthetic-activity','{"sensitive_data_included":false,"synthetic":true}'::jsonb);
SQL

manifest_sql="SELECT jsonb_build_object(
  'migration_count',(SELECT count(*) FROM venture_private.schema_migrations),
  'table_count',(SELECT count(*) FROM information_schema.tables WHERE table_schema='venture_private' AND table_type='BASE TABLE'),
  'function_count',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('venture_private','public') AND p.proname LIKE 'venture_%'),
  'synthetic_users',(SELECT count(*) FROM venture_private.users WHERE id='restore-drill-synthetic-user'),
  'synthetic_activities',(SELECT count(*) FROM venture_private.activities WHERE id='restore-drill-synthetic-activity'),
  'synthetic_audits',(SELECT count(*) FROM venture_private.audit_logs WHERE id='restore-drill-synthetic-audit'),
  'digest',(SELECT md5(string_agg(version||':'||checksum,',' ORDER BY version)) FROM venture_private.schema_migrations)
)::text"

source_manifest="$(docker exec "$source_container" psql --tuples-only --no-align --username postgres --dbname "$source_database" --command "$manifest_sql")"
docker exec "$source_container" pg_dump --format custom --no-owner --username postgres --dbname "$source_database" --file /tmp/pennys-synthetic.dump
docker cp "$source_container:/tmp/pennys-synthetic.dump" "$dump_file" >/dev/null

restore_started="$(date +%s)"
docker cp "$dump_file" "$target_container:/tmp/pennys-synthetic.dump" >/dev/null
docker exec "$target_container" pg_restore --exit-on-error --no-owner --username postgres --dbname "$target_database" /tmp/pennys-synthetic.dump >/dev/null
target_manifest="$(docker exec "$target_container" psql --tuples-only --no-align --username postgres --dbname "$target_database" --command "$manifest_sql")"
restore_seconds="$(( $(date +%s) - restore_started ))"

[[ "$source_manifest" == "$target_manifest" ]] || { echo "恢复前后清单不一致" >&2; exit 1; }
[[ "$restore_seconds" -le 300 ]] || { echo "本地恢复超过 300 秒 RTO 门槛" >&2; exit 1; }

security_result="$(docker exec "$target_container" psql --tuples-only --no-align --username postgres --dbname "$target_database" --command "SELECT jsonb_build_object(
  'public_private_schema_access',has_schema_privilege('public','venture_private','USAGE'),
  'anonymous_private_table_access',has_table_privilege('anon','venture_private.users','SELECT'),
  'authenticated_private_table_access',has_table_privilege('authenticated','venture_private.users','SELECT'),
  'service_activity_rpc',has_function_privilege('service_role','public.venture_upsert_activity(text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text,text,text,jsonb,jsonb,text,text,text,text,text)','EXECUTE'),
  'private_columns_in_public_activity_view',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='venture_activities_public' AND column_name LIKE '%ciphertext%')
)::text")"

expected_security='{"service_activity_rpc": true, "public_private_schema_access": false, "anonymous_private_table_access": false, "authenticated_private_table_access": false, "private_columns_in_public_activity_view": false}'
[[ "$security_result" == "$expected_security" ]] || { echo "恢复后的权限基线不符合预期：$security_result" >&2; exit 1; }

if docker exec "$target_container" psql --set ON_ERROR_STOP=1 --username postgres --dbname "$target_database" --command \
  "UPDATE venture_private.audit_logs SET action='restore.rehearsal.tamper' WHERE id='restore-drill-synthetic-audit'" >/dev/null 2>&1; then
  echo "恢复后的审计记录可被篡改" >&2
  exit 1
fi

dump_bytes="$(wc -c < "$dump_file" | tr -d ' ')"
printf '{"ok":true,"scope":"local_synthetic_only","snapshot_rpo":"sentinel_preserved","restore_seconds":%s,"dump_bytes":%s,"manifest":%s,"security":%s,"audit_append_only":true}\n' \
  "$restore_seconds" "$dump_bytes" "$target_manifest" "$security_result"
