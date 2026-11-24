#!/usr/bin/env bash
# Lead CRM: backup diário criptografado (banco, WhatsApp, arquivos enviados e configuração).
# Instalado pelo instalar.sh em /usr/local/bin/leadcrm-backup e agendado em /etc/cron.d/leadcrm-backup.
# Cópia para fora do servidor (recomendado): configure o rclone e defina RCLONE_REMOTE=nome:pasta no cron.
#
# Restaurar (teste, nunca direto em produção):
#   openssl enc -d -aes-256-cbc -pbkdf2 -pass file:/root/.leadcrm-backup-pass -in supabase-postgres.dump.enc -out banco.dump
#   docker exec -i supabase-db pg_restore -U supabase_admin -d postgres --clean --if-exists < banco.dump
set -euo pipefail

BASE="${LEADCRM_DIR:-/opt/lead-crm}"
SRV="$BASE/servidor"
DEST=/opt/backups/lead-crm
DIA=$(date +%F)
DIR="$DEST/$DIA"
PASS=/root/.leadcrm-backup-pass
[ -s "$PASS" ] || { echo "Falta $PASS (senha do backup)."; exit 1; }

mkdir -p "$DIR"
umask 077

docker exec supabase-db pg_dump -U supabase_admin -d postgres -Fc > "$DIR/supabase-postgres.dump"
docker exec supabase-db pg_dumpall -U supabase_admin --globals-only > "$DIR/supabase-globals.sql"
if docker ps --format '{{.Names}}' | grep -qx leadcrm-evolution-postgres; then
  docker exec leadcrm-evolution-postgres pg_dump -U evolution -d evolution -Fc > "$DIR/evolution.dump"
fi
[ -d "$SRV/supabase/volumes/storage" ] && tar czf "$DIR/storage.tgz" -C "$SRV/supabase/volumes" storage

existentes=$(cd "$SRV" && ls .env app.env supabase/.env docker-compose.yml Caddyfile 2>/dev/null || true)
tar czf - -C "$SRV" $existentes | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:$PASS" -out "$DIR/configuracao.tgz.enc"

for f in supabase-postgres.dump supabase-globals.sql evolution.dump storage.tgz; do
  [ -f "$DIR/$f" ] || continue
  openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:$PASS" -in "$DIR/$f" -out "$DIR/$f.enc"
  rm -f "$DIR/$f"
done

# retenção: 14 diários e 8 semanais (domingo)
if [ "$(date +%u)" = 7 ]; then mkdir -p "$DEST/semanal"; cp -r "$DIR" "$DEST/semanal/$DIA"; fi
find "$DEST" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime +14 -exec rm -rf {} +
find "$DEST/semanal" -mindepth 1 -maxdepth 1 -type d -mtime +56 -exec rm -rf {} + 2>/dev/null || true

if [ -n "${RCLONE_REMOTE:-}" ] && command -v rclone >/dev/null 2>&1; then
  rclone copy "$DIR" "$RCLONE_REMOTE/$DIA" && echo "Copiado para $RCLONE_REMOTE/$DIA"
else
  echo "AVISO: o backup está só neste servidor (RCLONE_REMOTE não configurado)."
fi
du -sh "$DIR"
echo "BACKUP OK: $DIR"
