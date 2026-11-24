# Créditos e componentes de terceiros

O **Lead CRM** é um trabalho derivado do **wacrm** (https://github.com/ArnasDon/wacrm), Copyright (c) 2026 Arnas Donauskas, distribuído sob a licença MIT. O aviso de copyright original está mantido no arquivo [LICENSE](LICENSE).

Alguns identificadores internos do código (chaves de armazenamento do navegador e cabeçalhos como `x-wacrm-secret`) mantêm o nome original para preservar compatibilidade.

## Componentes baixados na instalação

O instalador baixa e executa os programas abaixo. Eles **não fazem parte deste repositório**, e cada um segue a sua própria licença, que deve ser consultada no repositório oficial:

| Componente | Uso | Origem |
|---|---|---|
| Supabase (self-hosted) | banco de dados, login, arquivos e tempo real | https://github.com/supabase/supabase |
| PostgreSQL + pgvector | banco de dados e busca semântica | imagens oficiais do Supabase |
| Evolution API | conexão do WhatsApp por QR Code | https://github.com/EvolutionAPI/evolution-api |
| google-maps-scraper (gosom) | coletor gratuito do Google Maps | https://github.com/gosom/google-maps-scraper |
| Caddy | HTTPS automático | https://github.com/caddyserver/caddy |
| Docker | execução dos serviços | https://www.docker.com |

As bibliotecas JavaScript usadas pelo sistema estão em `package.json`, com as licenças de cada pacote.
