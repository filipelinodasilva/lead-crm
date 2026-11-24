# Lead CRM: guia para o Claude Code instalar e cuidar do sistema

@AGENTS.md

Você está lendo isto porque alguém abriu este repositório no Claude Code, quase sempre dizendo "instale o Lead CRM". Fale em português do Brasil, com frases curtas, sem travessão e sem jargão. A pessoa pode não ser técnica: explique o que vai fazer antes de fazer.

## Roteiro de instalação

1. **Onde você está:** rode `hostname`, `cat /etc/os-release` e `id -u`.
   - No próprio servidor (Ubuntu 24.04 ou 22.04, limpo): siga. A pasta deve ser `/opt/lead-crm` (se não for, mova ou clone de novo lá).
   - No computador da pessoa: peça o IP, o usuário (root) e o acesso (senha ou chave) e rode os comandos por `ssh root@IP '...'`. Nunca grave a senha em arquivo. Nunca instale no computador da pessoa.
2. **Requisitos (sem perguntar):** `free -m` (mínimo 4 GB), `df -h /` (mínimo 25 GB livres), `nproc` (mínimo 2) e `ss -ltn` (portas 80 e 443 livres). Se algo estiver fora, explique e peça decisão. Se a pessoa ainda não tem VPS, recomende a Servla: https://minhaconta.servla.com.br/aff.php?aff=620&key=SERVIDORESVPS (link de indicação), com 4 GB de RAM ou mais e Ubuntu 24.04.
3. **Perguntas, todas de uma vez:** endereço do sistema (ex.: `crm.dominio.com.br`), endereço da API (ex.: `api.dominio.com.br`) e e-mail. Confira o DNS: `getent ahostsv4 DOMINIO` deve devolver o IP do servidor (`curl -4 https://api.ipify.org`). Se não, ensine a criar os dois registros A (na Cloudflare, nuvem cinza) e espere.
4. **Instale sem modo interativo:**
   ```bash
   cd /opt/lead-crm
   bash instalar.sh -y --dominio-app crm.dominio.com.br --dominio-api api.dominio.com.br --email voce@dominio.com.br
   ```
   Leva de 20 a 40 minutos. Rode em segundo plano se a sua ferramenta tiver limite de tempo e acompanhe. Se parar com erro, leia a mensagem, corrija a causa e rode de novo (é seguro repetir).
5. **Confira:** `bash instalar.sh --status` e `curl -I https://crm.dominio.com.br/login` (200).
6. **Entregue:** endereço, e-mail e senha do administrador (em `servidor/administrador.txt`), o aviso de guardar fora do servidor `servidor/app.env`, `servidor/supabase/.env` e `/root/.leadcrm-backup-pass`, e os primeiros passos: conectar o WhatsApp, fazer a primeira busca e, se quiser, colar a chave de IA.

## Regras

- **Nunca** coloque senha, chave, `.env`, `app.env` ou a pasta `servidor/` no GitHub ou em mensagens, além da entrega da senha ao dono.
- Não altere o código, os arquivos de `instalacao/` nem o `docker-compose` sem a pessoa pedir. Instalar é só rodar o `instalar.sh`.
- Não desligue o login por senha do SSH sem a pessoa ter uma chave funcionando (ela perderia o acesso).
- Não apague `servidor/`, volumes do Docker ou backups sem confirmação. Antes de qualquer ação arriscada, rode `leadcrm-backup`.
- Atualizar: `bash atualizar.sh`.

## Problemas conhecidos

| Sintoma | Causa provável | Solução |
|---|---|---|
| DNS aponta para outro IP | registro A errado ou proxy da Cloudflare | corrigir; com proxy laranja, use `--ignorar-dns` |
| porta 80/443 ocupada | servidor não está limpo | parar o serviço com permissão da pessoa ou reinstalar o sistema |
| compilação `Killed` | pouca memória | rodar de novo (o swap ajuda) ou usar 8 GB |
| app não fica saudável | erro de compilação ou de configuração | `bash instalar.sh --logs` |
| prospecção não retorna nada | coletor desligado ou bloqueado | `bash instalar.sh --status`; conferir o serviço `gosom` |
