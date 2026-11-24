import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A conta pode ter várias conexões de WhatsApp. Consultar `whatsapp_config` filtrando só por
 * `account_id` e esperando uma linha (`.single()` / `.maybeSingle()`) quebra assim que existe
 * uma segunda conexão, e quebra em silêncio. Todo código deve usar `src/lib/whatsapp/connections.ts`.
 *
 * Este teste falha se um arquivo fora da lista abaixo voltar a fazer essa consulta.
 */

const ROOT = join(process.cwd(), 'src')

// Arquivos que podem consultar a tabela diretamente, e por quê.
const ALLOWED = new Set(
  [
    'lib/whatsapp/connections.ts', // o resolvedor
    'app/api/whatsapp/connections/route.ts', // lista, renomeia, define padrão
    'app/api/whatsapp/evolution/route.ts', // cria e remove conexões QR
    'app/api/whatsapp/config/route.ts', // formulário da Meta (filtra por provider)
    'app/api/evolution/webhook/route.ts', // localiza pela instância
    'app/api/whatsapp/webhook/route.ts', // localiza por phone_number_id
    'components/settings/whatsapp-config.tsx', // formulário da Meta (filtra por provider)
    'components/settings/settings-overview.tsx', // lista de linhas, sem .single()
    'app/(dashboard)/inbox/page.tsx', // lista de linhas, sem .single()
    'lib/whatsapp/send-message.ts', // atualização por id (token)
    'lib/whatsapp/template-webhook.ts', // localiza por waba_id
  ].map((p) => p.replace(/\//g, '/')),
)

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(full)
  }
  return out
}

describe('consultas a whatsapp_config', () => {
  it('só os arquivos permitidos acessam a tabela diretamente', () => {
    const offenders: string[] = []
    for (const file of walk(ROOT)) {
      const rel = relative(ROOT, file).replace(/\\/g, '/')
      if (ALLOWED.has(rel)) continue
      const text = readFileSync(file, 'utf8')
      if (/from\(\s*['"]whatsapp_config['"]\s*\)/.test(text)) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })

  it('nenhum arquivo combina whatsapp_config, account_id e .single() sem passar pelo resolvedor', () => {
    const offenders: string[] = []
    for (const file of walk(ROOT)) {
      const rel = relative(ROOT, file).replace(/\\/g, '/')
      if (rel === 'lib/whatsapp/connections.ts') continue
      const text = readFileSync(file, 'utf8')
      const re = /from\(\s*['"]whatsapp_config['"]\s*\)[\s\S]{0,220}?\.eq\(\s*['"]account_id['"][\s\S]{0,120}?\.(single|maybeSingle)\(\)/g
      for (const m of text.matchAll(re)) {
        // Permitido quando a consulta também filtra por provedor (no máximo uma Meta por conta).
        if (/\.eq\(\s*['"]provider['"]/.test(m[0])) continue
        offenders.push(rel)
      }
    }
    expect(offenders).toEqual([])
  })
})
