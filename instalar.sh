#!/usr/bin/env bash
# Lead CRM: instalador para VPS limpa (Ubuntu 22.04 ou 24.04).
#
# Uso (como root, dentro da pasta do projeto, de preferência /opt/lead-crm):
#   bash instalar.sh                                   pergunta o que faltar
#   bash instalar.sh -y --dominio-app crm.seudominio.com.br --dominio-api api.seudominio.com.br \
#        --email voce@seudominio.com.br
#   bash instalar.sh --status                          situação dos serviços
#
# Pode rodar de novo sem perder nada: o que já existe é mantido.
set -Eeuo pipefail

AQUI="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
SRV="$AQUI/servidor"
SUP="$SRV/supabase"
SUPABASE_COMMIT="86f9c0c2506c8276a03410d99f3185b8bd67d0e9"   # versão testada do Supabase self-hosted

APP_DOMAIN="${LEADCRM_DOMINIO_APP:-}"; API_DOMAIN="${LEADCRM_DOMINIO_API:-}"; ACME_EMAIL="${LEADCRM_EMAIL:-}"
ADMIN_EMAIL="${LEADCRM_ADMIN_EMAIL:-}"; ADMIN_SENHA="${LEADCRM_ADMIN_SENHA:-}"
GOOGLE_PLACES_API_KEY="${GOOGLE_PLACES_API_KEY:-}"
SIM=0; IGNORAR_DNS=0; GOSOM=""; CADASTRO=""; BACKUP=1; FIREWALL=0; SO_STATUS=0; SO_LOGS=0

vermelho() { printf '\033[31m%s\033[0m\n' "$*"; }
passo() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
ok() { printf '\033[32m✓\033[0m %s\n' "$*"; }
aviso() { printf '\033[33m!\033[0m %s\n' "$*"; }
erro() { vermelho "ERRO: $*"; exit 1; }
trap 'vermelho "A instalação parou na linha $LINENO. Corrija a causa e rode de novo: é seguro repetir."' ERR

ajuda() {
  cat <<'TXT'
Opções:
  --dominio-app X     endereço do sistema (ex.: crm.seudominio.com.br)
  --dominio-api X     endereço da API (ex.: api.seudominio.com.br)
  --email X           e-mail do certificado HTTPS
  --admin-email X     e-mail do administrador (padrão: o mesmo do --email)
  --admin-senha X     senha do administrador (padrão: gerada)
  --google-places X   chave da API Google Places (opcional; cada conta também pode cadastrar a sua)
  --sem-gosom         não liga o coletor gratuito do Google Maps
  --cadastro-aberto   qualquer pessoa pode criar conta (para revender; padrão: fechado, só por convite)
  --cadastro-fechado  volta a aceitar novos usuários só por convite
  --sem-backup        não agenda o backup diário
  --firewall          liga o firewall (UFW) liberando só as portas 22, 80 e 443
  --ignorar-dns       segue mesmo se o DNS ainda não aponta para este servidor (ex.: proxy da Cloudflare)
  -y                  não pergunta nada
  --status            mostra a situação e sai
  --logs              mostra as últimas linhas do log do sistema e sai
TXT
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dominio-app) APP_DOMAIN="${2:-}"; shift 2 ;;
    --dominio-api) API_DOMAIN="${2:-}"; shift 2 ;;
    --email) ACME_EMAIL="${2:-}"; shift 2 ;;
    --admin-email) ADMIN_EMAIL="${2:-}"; shift 2 ;;
    --admin-senha) ADMIN_SENHA="${2:-}"; shift 2 ;;
    --google-places) GOOGLE_PLACES_API_KEY="${2:-}"; shift 2 ;;
    --sem-gosom) GOSOM=0; shift ;;
    --cadastro-aberto) CADASTRO=true; shift ;;
    --cadastro-fechado) CADASTRO=false; shift ;;
    --sem-backup) BACKUP=0; shift ;;
    --firewall) FIREWALL=1; shift ;;
    --ignorar-dns) IGNORAR_DNS=1; shift ;;
    -y) SIM=1; shift ;;
    --status) SO_STATUS=1; shift ;;
    --logs) SO_LOGS=1; shift ;;
    -h|--help) ajuda; exit 0 ;;
    *) erro "opção desconhecida: $1 (use --help)" ;;
  esac
done

# mantém a escolha do coletor feita na primeira instalação
[ -n "$GOSOM" ] || GOSOM="$(grep -E '^GOSOM=' "$SRV/.env" 2>/dev/null | cut -d= -f2)"
GOSOM="${GOSOM:-1}"
[ -n "$CADASTRO" ] || CADASTRO="$(grep -E '^CADASTRO_ABERTO=' "$SRV/.env" 2>/dev/null | cut -d= -f2)"
CADASTRO="${CADASTRO:-false}"

compose_app() { docker compose --project-directory "$SRV" -f "$SRV/docker-compose.yml" --env-file "$SRV/.env" "$@"; }
perfis() { [ "$(grep -E '^GOSOM=' "$SRV/.env" 2>/dev/null | cut -d= -f2)" = 1 ] && echo "--profile gosom" || true; }

status() {
  passo "Situação"
  [ -d "$SUP" ] && (cd "$SUP" && docker compose ps --format 'table {{.Name}}\t{{.Status}}') || aviso "Supabase não instalado."
  [ -f "$SRV/.env" ] && compose_app $(perfis) ps --format 'table {{.Name}}\t{{.Status}}' || aviso "App não instalado."
  if [ -f "$SRV/.env" ]; then
    d=$(grep -E '^APP_DOMAIN=' "$SRV/.env" | cut -d= -f2)
    echo -n "Sistema https://$d/login: "; curl -s -o /dev/null -w '%{http_code}\n' "https://$d/login" || true
  fi
}

[ "$(id -u)" = 0 ] || erro "rode como root (ou com sudo)."
if [ "$SO_STATUS" = 1 ]; then status; exit 0; fi
if [ "$SO_LOGS" = 1 ]; then compose_app logs --tail 120 app; exit 0; fi

# ---------- 1. servidor ----------
passo "Conferindo o servidor"
. /etc/os-release
case "${ID}-${VERSION_ID}" in
  ubuntu-22.04|ubuntu-24.04) ok "Sistema: $PRETTY_NAME" ;;
  *) aviso "Sistema $PRETTY_NAME não testado. Recomendado: Ubuntu 24.04." ;;
esac
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
DISCO_GB=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
CPUS=$(nproc)
[ "$MEM_MB" -ge 3500 ] || erro "memória de ${MEM_MB} MB. O mínimo é 4 GB."
if [ -f "$SRV/.env" ]; then
  [ "$DISCO_GB" -ge 8 ] || erro "só ${DISCO_GB} GB livres no disco. Libere espaço (ex.: docker builder prune -af) e rode de novo."
else
  [ "$DISCO_GB" -ge 25 ] || erro "só ${DISCO_GB} GB livres no disco. O mínimo é 25 GB livres (recomendado 80 GB)."
fi
ok "Memória ${MEM_MB} MB, ${CPUS} vCPU, ${DISCO_GB} GB livres"
[ "$CPUS" -ge 2 ] || aviso "Só ${CPUS} vCPU: funciona, mas a compilação fica lenta. Recomendado: 4 vCPU."
for p in 80 443; do
  dono=$(ss -ltnpH "sport = :$p" 2>/dev/null | grep -o 'users:(("[^"]*' | head -1 | cut -d'"' -f2 || true)
  if [ -n "$dono" ] && [ "$dono" != "docker-proxy" ]; then
    erro "a porta $p está ocupada por '$dono'. O Lead CRM precisa das portas 80 e 443 livres (servidor limpo)."
  fi
done

# ---------- 2. perguntas ----------
pergunta() { # var texto padrão
  local v="${!1}"
  if [ -z "$v" ] && [ "$SIM" = 0 ]; then read -r -p "$2${3:+ [$3]}: " v; fi
  printf -v "$1" '%s' "${v:-$3}"
}
[ -f "$SRV/.env" ] && {
  APP_DOMAIN="${APP_DOMAIN:-$(grep -E '^APP_DOMAIN=' "$SRV/.env" | cut -d= -f2)}"
  API_DOMAIN="${API_DOMAIN:-$(grep -E '^API_DOMAIN=' "$SRV/.env" | cut -d= -f2)}"
  ACME_EMAIL="${ACME_EMAIL:-$(grep -E '^ACME_EMAIL=' "$SRV/.env" | cut -d= -f2)}"
  ADMIN_EMAIL="${ADMIN_EMAIL:-$(grep -E '^ADMIN_EMAIL=' "$SRV/.env" | cut -d= -f2)}"
}
pergunta APP_DOMAIN "Endereço do sistema (ex.: crm.seudominio.com.br)" ""
pergunta API_DOMAIN "Endereço da API (ex.: api.seudominio.com.br)" ""
pergunta ACME_EMAIL "Seu e-mail (certificado HTTPS e administrador)" ""
pergunta ADMIN_EMAIL "E-mail do administrador do sistema" "$ACME_EMAIL"
[ -n "$APP_DOMAIN" ] && [ -n "$API_DOMAIN" ] && [ -n "$ACME_EMAIL" ] || erro "informe --dominio-app, --dominio-api e --email."
[ "$APP_DOMAIN" != "$API_DOMAIN" ] || erro "o endereço do sistema e o da API precisam ser diferentes."

passo "Conferindo o DNS"
MEU_IP=$(curl -4 -fsS --max-time 10 https://api.ipify.org || true)
for d in "$APP_DOMAIN" "$API_DOMAIN"; do
  ip=$(getent ahostsv4 "$d" | awk '{print $1; exit}' || true)
  if [ -n "$ip" ] && [ "$ip" = "$MEU_IP" ]; then ok "$d aponta para este servidor ($ip)"; continue; fi
  aviso "$d aponta para '${ip:-nada}', e este servidor é '${MEU_IP:-desconhecido}'."
  echo "   Crie no seu DNS um registro A: $d -> $MEU_IP (na Cloudflare, com a nuvem CINZA, sem proxy)."
  [ "$IGNORAR_DNS" = 1 ] || erro "ajuste o DNS, espere alguns minutos e rode de novo (ou use --ignorar-dns)."
done

# ---------- 3. pacotes, swap e Docker ----------
passo "Instalando o básico e o Docker (pode levar alguns minutos)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg git openssl python3 jq >/dev/null
SWAP_MB=$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$SWAP_MB" -lt 1024 ] && [ ! -e /swapfile ]; then
  fallocate -l 4G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=4096 status=none
  chmod 600 /swapfile; mkswap /swapfile >/dev/null
  if swapon /swapfile 2>/dev/null; then
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    ok "Memória virtual (swap) de 4 GB criada"
  else
    rm -f /swapfile; aviso "Este servidor não permite swap. Se a compilação falhar por memória, use 8 GB de RAM."
  fi
fi
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
fi
if [ ! -f /etc/docker/daemon.json ]; then
  mkdir -p /etc/docker
  printf '{\n  "log-driver": "json-file",\n  "log-opts": { "max-size": "20m", "max-file": "5" },\n  "live-restore": true\n}\n' > /etc/docker/daemon.json
  systemctl restart docker
fi
systemctl enable --now docker >/dev/null 2>&1
CV=$(docker compose version --short | sed 's/^v//')
python3 -c "import sys; v=tuple(int(x) for x in '$CV'.split('.')[:3]); sys.exit(0 if v>=(2,24,0) else 1)" \
  || erro "Docker Compose $CV é antigo. É preciso 2.24 ou mais novo."
ok "Docker $(docker --version | awk '{print $3}' | tr -d ,) e Compose $CV"

# ---------- 4. Supabase (banco, login, arquivos e tempo real) ----------
passo "Instalando o Supabase (banco de dados com pgvector)"
mkdir -p "$SRV"; chmod 700 "$SRV"
setenv() { # arquivo chave valor
  python3 - "$1" "$2" "$3" <<'PY'
import sys, re, pathlib
p, k, v = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
linhas = p.read_text().splitlines() if p.exists() else []
saida, achou = [], False
for l in linhas:
    if re.match(rf'^{re.escape(k)}=', l):
        saida.append(f'{k}={v}'); achou = True
    else:
        saida.append(l)
if not achou:
    saida.append(f'{k}={v}')
p.write_text('\n'.join(saida) + '\n')
PY
}
if [ ! -d "$SUP" ]; then
  tmp=$(mktemp -d)
  git -C "$tmp" init -q supabase
  git -C "$tmp/supabase" remote add origin https://github.com/supabase/supabase
  git -C "$tmp/supabase" sparse-checkout set docker
  git -C "$tmp/supabase" fetch -q --depth 1 --filter=blob:none origin "$SUPABASE_COMMIT"
  git -C "$tmp/supabase" checkout -q FETCH_HEAD
  cp -r "$tmp/supabase/docker" "$SUP"
  rm -rf "$tmp"
fi
cd "$SUP"
if [ ! -f .env ]; then
  cp .env.example .env; chmod 600 .env
  # o script oficial imprime as chaves na tela: silenciado para não vazar em log
  sh utils/generate-keys.sh --update-env >/dev/null 2>&1
  rm -f .env.old; chmod 600 .env
fi
setenv .env SUPABASE_PUBLIC_URL "https://$API_DOMAIN"
setenv .env API_EXTERNAL_URL "https://$API_DOMAIN/auth/v1"
setenv .env SITE_URL "https://$APP_DOMAIN"
setenv .env ADDITIONAL_REDIRECT_URLS "https://$APP_DOMAIN/**"
if [ "$CADASTRO" = true ]; then setenv .env DISABLE_SIGNUP false; else setenv .env DISABLE_SIGNUP true; fi
setenv .env STUDIO_DEFAULT_ORGANIZATION "Lead CRM"
setenv .env STUDIO_DEFAULT_PROJECT "Lead CRM"
setenv .env DASHBOARD_USERNAME "admin"
setenv .env POOLER_TENANT_ID "leadcrm"
if [ -n "${SMTP_HOST:-}" ]; then
  setenv .env SMTP_HOST "$SMTP_HOST"; setenv .env SMTP_PORT "${SMTP_PORT:-587}"
  setenv .env SMTP_USER "${SMTP_USER:-}"; setenv .env SMTP_PASS "${SMTP_PASS:-}"
  setenv .env SMTP_SENDER_NAME "${SMTP_SENDER_NAME:-Lead CRM}"; setenv .env SMTP_ADMIN_EMAIL "${SMTP_ADMIN_EMAIL:-$ACME_EMAIL}"
  setenv .env ENABLE_EMAIL_AUTOCONFIRM "false"
else
  setenv .env ENABLE_EMAIL_AUTOCONFIRM "true"
fi
if grep -qE 'your-super|this_password_is_insecure|your-32-character|your-encryption-key|your-tenant-id' .env; then
  erro "sobrou valor de exemplo em $SUP/.env. Apague a pasta $SUP e rode de novo."
fi
cp "$AQUI/instalacao/supabase.override.yml" docker-compose.override.yml
setenv .env COMPOSE_FILE "docker-compose.yml:docker-compose.override.yml"
mkdir -p volumes/storage volumes/snippets volumes/functions
docker compose pull -q
docker compose up -d
for i in $(seq 1 60); do
  s=$(docker inspect -f '{{.State.Health.Status}}' supabase-db 2>/dev/null || echo starting)
  [ "$s" = healthy ] && break; sleep 5
done
[ "$s" = healthy ] || erro "o banco não ficou saudável. Veja: cd $SUP && docker compose logs db"
ok "Supabase no ar"

# ---------- 5. tabelas (migrações) ----------
passo "Criando as tabelas do Lead CRM"
PSQL=(docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
SQL
total=0; novas=0
for f in $(ls "$AQUI"/supabase/migrations/*.sql | sort); do
  total=$((total+1)); base=$(basename "$f" .sql); versao="${base%%_*}"; nome="${base#*_}"
  ja=$("${PSQL[@]}" -At -c "select 1 from supabase_migrations.schema_migrations where version='${versao}'" || true)
  [ "$ja" = 1 ] && continue
  "${PSQL[@]}" < "$f" || erro "falha na migração $base."
  "${PSQL[@]}" -c "insert into supabase_migrations.schema_migrations(version, name) values ('${versao}', '${nome}')"
  novas=$((novas+1))
done
ok "Migrações: $novas novas, $total no total"

# ---------- 6. app, HTTPS, agendador, WhatsApp e coletor ----------
passo "Compilando e iniciando o Lead CRM (na primeira vez leva de 5 a 15 minutos)"
cp -f "$AQUI/instalacao/docker-compose.yml" "$SRV/docker-compose.yml"
cp -f "$AQUI/instalacao/Caddyfile" "$SRV/Caddyfile"
val() { grep -E "^$1=" "$SUP/.env" | head -n1 | cut -d= -f2-; }
gen() { openssl rand -hex "$1"; }
umask 077
if [ ! -f "$SRV/.env" ]; then
  cat > "$SRV/.env" <<EOF
APP_DOMAIN=$APP_DOMAIN
API_DOMAIN=$API_DOMAIN
ACME_EMAIL=$ACME_EMAIL
ANON_KEY=$(val ANON_KEY)
EVOLUTION_DB_PASSWORD=$(gen 16)
EVOLUTION_API_KEY=$(gen 24)
GOSOM=$GOSOM
EOF
fi
setenv "$SRV/.env" APP_DOMAIN "$APP_DOMAIN"; setenv "$SRV/.env" API_DOMAIN "$API_DOMAIN"; setenv "$SRV/.env" ACME_EMAIL "$ACME_EMAIL"
setenv "$SRV/.env" GOSOM "$GOSOM"; setenv "$SRV/.env" ADMIN_EMAIL "$ADMIN_EMAIL"; setenv "$SRV/.env" CADASTRO_ABERTO "$CADASTRO"
EVO_KEY=$(grep -E '^EVOLUTION_API_KEY=' "$SRV/.env" | cut -d= -f2-)
if [ ! -f "$SRV/app.env" ]; then
  cat > "$SRV/app.env" <<EOF
NEXT_PUBLIC_SUPABASE_URL=https://$API_DOMAIN
NEXT_PUBLIC_SUPABASE_ANON_KEY=$(val ANON_KEY)
SUPABASE_SERVICE_ROLE_KEY=$(val SERVICE_ROLE_KEY)
NEXT_PUBLIC_SITE_URL=https://$APP_DOMAIN
NEXT_PUBLIC_APP_LOCALE=pt
APP_URL=https://$APP_DOMAIN
ALLOWED_INVITE_HOSTS=$APP_DOMAIN
ENCRYPTION_KEY=$(gen 32)
AUTOMATION_CRON_SECRET=$(gen 24)
META_APP_ID=${META_APP_ID:-}
META_APP_SECRET=${META_APP_SECRET:-$(gen 24)}
EVOLUTION_API_URL=http://evolution-api:8080
EVOLUTION_API_KEY=$EVO_KEY
EVOLUTION_WEBHOOK_BASE_URL=http://app:3000
EVOLUTION_WEBHOOK_SECRET=$(gen 24)
GOOGLE_PLACES_API_KEY=$GOOGLE_PLACES_API_KEY
PROSPECT_GOSOM_URL=http://gosom:8080
PROSPECT_GOSOM_MONTHLY_CAP=300
EOF
fi
setenv "$SRV/app.env" NEXT_PUBLIC_SUPABASE_URL "https://$API_DOMAIN"
setenv "$SRV/app.env" NEXT_PUBLIC_SITE_URL "https://$APP_DOMAIN"
setenv "$SRV/app.env" APP_URL "https://$APP_DOMAIN"
setenv "$SRV/app.env" ALLOWED_INVITE_HOSTS "$APP_DOMAIN"
[ "$GOSOM" = 1 ] || setenv "$SRV/app.env" PROSPECT_GOSOM_URL ""
[ -n "$GOOGLE_PLACES_API_KEY" ] && setenv "$SRV/app.env" GOOGLE_PLACES_API_KEY "$GOOGLE_PLACES_API_KEY"
chmod 600 "$SRV/.env" "$SRV/app.env"
umask 022
compose_app config -q
compose_app $(perfis) up -d --build
for i in $(seq 1 90); do
  s=$(docker inspect -f '{{.State.Health.Status}}' "$(compose_app ps -q app)" 2>/dev/null || echo starting)
  [ "$s" = healthy ] && break; sleep 5
done
[ "$s" = healthy ] || erro "o app não ficou saudável. Veja: bash instalar.sh --logs"
ok "Lead CRM no ar"
# cada recompilação deixa cache e imagem antiga para trás: limpa para não encher o disco
docker builder prune -af >/dev/null 2>&1 || true
docker image prune -f >/dev/null 2>&1 || true

# ---------- 7. administrador ----------
passo "Criando o administrador"
SERVICE=$(val SERVICE_ROLE_KEY)
ADMIN_TXT="$SRV/administrador.txt"
existe=$("${PSQL[@]}" -At -c "select id from auth.users where lower(email)=lower('${ADMIN_EMAIL//\'/}')" || true)
if [ -z "$existe" ]; then
  [ -n "$ADMIN_SENHA" ] || ADMIN_SENHA="$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 16)"
  corpo=$(jq -n --arg e "$ADMIN_EMAIL" --arg s "$ADMIN_SENHA" '{email:$e,password:$s,email_confirm:true}')
  codigo=$(curl -s -o /tmp/leadcrm-admin.json -w '%{http_code}' -X POST "http://127.0.0.1:8000/auth/v1/admin/users" \
    -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" -H 'Content-Type: application/json' -d "$corpo")
  rm -f /tmp/leadcrm-admin.json
  [ "$codigo" = 200 ] || [ "$codigo" = 201 ] || erro "não consegui criar o administrador (código $codigo)."
  [ -f "$ADMIN_TXT" ] && mv "$ADMIN_TXT" "$ADMIN_TXT.anterior"
  umask 077; printf 'Endereço: https://%s\nE-mail: %s\nSenha: %s\n' "$APP_DOMAIN" "$ADMIN_EMAIL" "$ADMIN_SENHA" > "$ADMIN_TXT"; umask 022
fi
"${PSQL[@]}" <<SQL
insert into public.platform_admins(user_id)
  select id from auth.users where lower(email)=lower('${ADMIN_EMAIL//\'/}') on conflict do nothing;
update public.accounts set status='active'
  where owner_user_id in (select id from auth.users where lower(email)=lower('${ADMIN_EMAIL//\'/}'));
SQL
ok "Administrador: $ADMIN_EMAIL (acesso ao painel /admin, sem limite de teste)"

# ---------- 8. backup diário ----------
if [ "$BACKUP" = 1 ]; then
  passo "Agendando o backup diário (3h30)"
  [ -s /root/.leadcrm-backup-pass ] || { umask 077; openssl rand -base64 32 > /root/.leadcrm-backup-pass; umask 022; }
  install -m 700 "$AQUI/instalacao/backup.sh" /usr/local/bin/leadcrm-backup
  echo "30 3 * * * root LEADCRM_DIR=$AQUI /usr/local/bin/leadcrm-backup >> /var/log/leadcrm-backup.log 2>&1" > /etc/cron.d/leadcrm-backup
  ok "Backup em /opt/backups/lead-crm (senha em /root/.leadcrm-backup-pass: guarde uma cópia fora do servidor)"
fi

# ---------- 9. firewall (opcional) ----------
if [ "$FIREWALL" = 1 ]; then
  passo "Ligando o firewall"
  apt-get install -y -qq ufw >/dev/null
  ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
  ufw --force enable >/dev/null
  ok "Firewall ligado: só 22, 80 e 443"
fi

# ---------- 10. conferência ----------
passo "Conferindo"
sleep 5
c_app=$(curl -s -o /dev/null -w '%{http_code}' "https://$APP_DOMAIN/login" || true)
c_api=$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $(val ANON_KEY)" "https://$API_DOMAIN/auth/v1/health" || true)
[ "$c_app" = 200 ] && ok "Sistema respondendo com HTTPS" || aviso "Sistema devolveu '$c_app'. Se o DNS acabou de ser criado, espere alguns minutos: o HTTPS liga sozinho."
[ "$c_api" = 200 ] && ok "API respondendo com HTTPS" || aviso "API devolveu '$c_api'. Mesma observação do DNS."

passo "Instalação concluída"
echo "Sistema:        https://$APP_DOMAIN"
echo "Administrador:  $ADMIN_EMAIL"
[ "$CADASTRO" = true ] && echo "Cadastro:       aberto (qualquer pessoa cria conta com 7 dias grátis)" || echo "Cadastro:       fechado (novos usuários só por convite, em Configurações > Membros da equipe)"
if [ -f "$ADMIN_TXT" ]; then
  echo "Senha:          $(grep '^Senha:' "$ADMIN_TXT" | cut -d' ' -f2)   (também em $ADMIN_TXT)"
fi
echo
echo "Guarde FORA do servidor: $SRV/app.env (ENCRYPTION_KEY), $SUP/.env e /root/.leadcrm-backup-pass."
echo "Situação: bash instalar.sh --status     Atualizar: bash atualizar.sh"
