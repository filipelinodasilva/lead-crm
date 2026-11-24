# Lead CRM

**O CRM que gera leads qualificados para o seu negócio.**

Encontre empresas no Google Maps, aborde pelo WhatsApp, acompanhe cada conversa até a venda e atenda com a sua equipe no mesmo número. Tudo no seu próprio servidor, com o código-fonte aberto e os dados sob o seu controle.

## O que ele faz

- **Prospecção no Google Maps:** busque por segmento e cidade e receba nome, telefone, site, nota e avaliações. Filtre, selecione e salve como lead. Coletor gratuito incluso, ou a API oficial do Google Places.
- **Diagnóstico de site e ranking local:** veja como cada empresa aparece na busca e se o site dela tem problemas, para abordar com um motivo real.
- **Campanhas de abordagem no WhatsApp:** modelos prontos, variáveis como `{nome}` e `{cidade}`, variações de texto, acompanhamentos automáticos e respeito a quem pede para sair.
- **Caixa de entrada compartilhada:** vários atendentes no mesmo número, setores, fila, transferência, histórico por atendimento e relatórios.
- **Funil de vendas:** negócios por etapa, do primeiro contato ao fechamento.
- **Automações, fluxos e assistente de IA:** respostas automáticas, base de conhecimento e chave própria da OpenAI, da Anthropic ou de uma API compatível.
- **WhatsApp por QR Code (Evolution API) ou pela API oficial da Meta.**
- **Multiempresa:** contas, subcontas no estilo agência, papéis (dono, admin, atendente, leitura) e convite da equipe. Para revender, abra o cadastro (`--cadastro-aberto`): cada conta nova ganha 7 dias grátis e você libera ou bloqueia no painel do administrador.

## Instalação em 1 comando (VPS)

Você precisa de uma VPS limpa com Ubuntu 24.04 e de dois subdomínios apontando para ela. Veja os requisitos e o passo a passo completo em **[docs/INSTALACAO.md](docs/INSTALACAO.md)**.

```bash
git clone https://github.com/filipelinodasilva/lead-crm /opt/lead-crm
cd /opt/lead-crm
bash instalar.sh
```

O instalador instala o Docker, o banco (Supabase com pgvector), o sistema, o HTTPS, o WhatsApp, o coletor do Google Maps e o backup diário. No fim, mostra o endereço e a senha do administrador.

Prefere que a IA instale para você? Abra o [Claude Code](https://claude.com/claude-code) no servidor e diga: *"Instale o Lead CRM seguindo o CLAUDE.md"*.

## Requisitos mínimos

| Item | Mínimo | Recomendado |
|---|---|---|
| Sistema | Ubuntu 24.04 (ou 22.04) limpo | Ubuntu 24.04 |
| Memória | 4 GB de RAM | 8 GB de RAM |
| Processador | 2 vCPU | 4 vCPU |
| Disco | 40 GB SSD | 80 GB NVMe |
| Rede | IPv4 público, portas 80 e 443 livres | |
| Domínio | 2 subdomínios (sistema e API) | |

**VPS recomendada:** [Servla](https://minhaconta.servla.com.br/aff.php?aff=620&key=SERVIDORESVPS) (link de indicação).

## Atualizar

```bash
cd /opt/lead-crm && bash atualizar.sh
```

Faz backup, baixa a versão nova, aplica as mudanças no banco e recompila, sem perder dados.

## Licença e créditos

Código aberto sob a licença MIT. O Lead CRM é derivado do [wacrm](https://github.com/ArnasDon/wacrm), de Arnas Donauskas (MIT). Veja [LICENSE](LICENSE) e [NOTICE.md](NOTICE.md).

Use a prospecção com responsabilidade: dados de contato de empresas também são protegidos pela LGPD. Aborde com motivo legítimo, use só o necessário e pare na hora quando alguém pedir.
