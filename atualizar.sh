#!/usr/bin/env bash
# Lead CRM: atualiza para a versão mais nova do GitHub, fazendo backup antes.
# Uso (como root, na pasta do projeto): bash atualizar.sh
set -euo pipefail
AQUI="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
[ -f "$AQUI/servidor/.env" ] || { echo "Lead CRM não instalado. Rode primeiro: bash instalar.sh"; exit 1; }

if [ -x /usr/local/bin/leadcrm-backup ]; then
  echo "Fazendo backup antes de atualizar..."
  LEADCRM_DIR="$AQUI" /usr/local/bin/leadcrm-backup
fi
if [ -d "$AQUI/.git" ]; then
  git -C "$AQUI" pull --ff-only
else
  echo "Esta pasta não é um clone do GitHub: pulei o download."
fi
# o instalador é idempotente: aplica migrações novas e recompila o app, mantendo dados e senhas
bash "$AQUI/instalar.sh" -y --ignorar-dns
