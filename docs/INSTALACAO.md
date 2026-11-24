# Instalação do Lead CRM na VPS

Guia passo a passo para quem nunca instalou um sistema em servidor. Leva de 20 a 40 minutos, quase todo o tempo esperando o servidor trabalhar.

## 1. Requisitos mínimos

| Item | Mínimo | Recomendado | Por quê |
|---|---|---|---|
| Sistema | Ubuntu 24.04 (ou 22.04) **limpo** | Ubuntu 24.04 | O instalador foi testado nele. Servidor limpo evita conflito de portas. |
| Memória | **4 GB de RAM** | 8 GB | O sistema usa cerca de 1,5 GB parado; a compilação pede perto de 3 GB por alguns minutos. O instalador cria 4 GB de memória virtual (swap). |
| Processador | **2 vCPU** | 4 vCPU | Com 2 vCPU funciona; a compilação só fica mais lenta. |
| Disco | **40 GB SSD** | 80 GB NVMe | Cerca de 10 GB de programas, mais espaço para conversas, arquivos e backups. |
| Rede | IPv4 público, portas **80 e 443** livres | | Para o HTTPS automático. |
| Acesso | usuário **root** por SSH | | |
| Domínio | **2 subdomínios** do seu domínio | | Um para o sistema e outro para a API (ex.: `crm.` e `api.`). |

Opcionais (dá para configurar depois, dentro do sistema):
- um número de WhatsApp para conectar por QR Code;
- chave da API do Google Places (o coletor gratuito já vem ligado);
- chave da OpenAI ou da Anthropic para o assistente de IA;
- um servidor de e-mail (SMTP) para confirmação de cadastro e recuperação de senha.

### VPS recomendada

Contrate uma VPS com pelo menos 4 GB de RAM e Ubuntu 24.04 na **[Servla](https://minhaconta.servla.com.br/aff.php?aff=620&key=SERVIDORESVPS)** (link de indicação). Na hora de escolher o sistema, marque **Ubuntu 24.04**. Anote o **IP** e a **senha de root** que chegam por e-mail.

## 2. Apontar os subdomínios (DNS)

No painel onde está o seu domínio (Cloudflare, Registro.br, Hostinger etc.), crie **dois registros do tipo A**:

| Tipo | Nome | Valor |
|---|---|---|
| A | `crm` | IP da sua VPS |
| A | `api` | IP da sua VPS |

Na Cloudflare, deixe a **nuvem cinza** (sem proxy). Espere de 5 a 30 minutos para propagar.

## 3. Entrar no servidor

No Windows, abra o **PowerShell**. No Mac ou Linux, abra o **Terminal**. Digite (trocando pelo seu IP):

```bash
ssh root@IP_DA_SUA_VPS
```

Na primeira vez, responda `yes` e digite a senha de root (ela não aparece enquanto você digita, é normal).

## 4. Baixar e instalar

```bash
apt-get update && apt-get install -y git
git clone https://github.com/SEU-USUARIO/lead-crm /opt/lead-crm
cd /opt/lead-crm
bash instalar.sh
```

O instalador pergunta:
1. **Endereço do sistema**, por exemplo `crm.seudominio.com.br`;
2. **Endereço da API**, por exemplo `api.seudominio.com.br`;
3. **Seu e-mail**, usado no certificado HTTPS e como administrador.

Depois disso ele trabalha sozinho: confere o servidor e o DNS, instala o Docker, o banco, o sistema, o HTTPS, o WhatsApp, o coletor do Google Maps e o backup diário. No fim aparecem o **endereço** e a **senha do administrador**. Guarde essa senha.

Sem perguntas (tudo em uma linha):

```bash
bash instalar.sh -y --dominio-app crm.seudominio.com.br --dominio-api api.seudominio.com.br --email voce@seudominio.com.br
```

Outras opções: `bash instalar.sh --help`. Para ligar o firewall (libera só as portas 22, 80 e 443), acrescente `--firewall`.

## 5. Primeiro acesso

1. Abra `https://crm.seudominio.com.br` e entre com o e-mail e a senha do administrador.
2. **Configurações > WhatsApp:** conecte o seu número pelo QR Code.
3. **Prospecção:** faça a primeira busca (ex.: "dentista" em "Campinas").
4. **Configurações > IA:** cole a sua chave, se for usar o assistente.

**Cadastro fechado por padrão:** ninguém cria conta sozinho. Para colocar alguém da equipe, vá em **Configurações > Membros da equipe** e mande o convite.

Vai revender o sistema para clientes? Rode `bash instalar.sh --cadastro-aberto`. Aí qualquer pessoa cria conta, cada conta nova nasce com **7 dias grátis** e é bloqueada sozinha depois, e você libera ou bloqueia no painel **/admin**. O administrador não tem esse limite. Para fechar de novo: `bash instalar.sh --cadastro-fechado`.

Atenção com cadastro aberto: cada conta tem o próprio limite de buscas. Se você instalou com a sua chave do Google Places, as buscas das contas de clientes também saem da sua fatura.

## 6. Dia a dia

| Para | Comando (dentro de `/opt/lead-crm`) |
|---|---|
| Ver a situação | `bash instalar.sh --status` |
| Atualizar para a versão nova | `bash atualizar.sh` |
| Ver o log do sistema | `bash instalar.sh --logs` |
| Fazer backup agora | `leadcrm-backup` |

O backup roda todo dia às 3h30 em `/opt/backups/lead-crm`, criptografado. A senha fica em `/root/.leadcrm-backup-pass`.

**Guarde fora do servidor** (num gerenciador de senhas): `servidor/app.env`, `servidor/supabase/.env` e `/root/.leadcrm-backup-pass`. Sem eles, os backups e as chaves salvas no sistema não abrem.

## 7. Problemas comuns

| Sintoma | O que fazer |
|---|---|
| "aponta para 'nada'" ou outro IP | O DNS ainda não propagou ou o registro A está errado. Confira e espere. Na Cloudflare, use a nuvem cinza. |
| "a porta 80 está ocupada" | O servidor não está limpo (tem Apache, Nginx ou painel). Reinstale o sistema pelo painel da VPS. |
| "memória de ... MB. O mínimo é 4 GB" | Troque para um plano com 4 GB ou mais. |
| A compilação parou com "Killed" | Falta de memória. Rode `bash instalar.sh` de novo; se repetir, use 8 GB. |
| O site abre sem cadeado (HTTPS) | Quase sempre é DNS. Espere alguns minutos: o certificado sai sozinho. |
| Parou com erro no meio | Leia a mensagem, corrija e rode `bash instalar.sh` de novo. É seguro repetir. |

## 8. Segurança

- O banco e o painel do Supabase **não ficam na internet**: só o sistema e a API passam pelo HTTPS.
- Prefira entrar no servidor com **chave SSH** em vez de senha, e use `--firewall`.
- O cadastro público vem fechado. Se abrir com `--cadastro-aberto`, configure também o SMTP (variáveis `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` antes de rodar o instalador), senão as contas novas entram sem confirmar o e-mail.
- O coletor gratuito raspa o Google Maps, o que contraria os termos do Google. Use com moderação (há um teto mensal de 300 buscas) ou use a API oficial do Google Places.
