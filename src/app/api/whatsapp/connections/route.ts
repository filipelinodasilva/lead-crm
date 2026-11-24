import { NextResponse } from 'next/server'

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { getConnectionById, listConnections } from '@/lib/whatsapp/connections'

/**
 * GET /api/whatsapp/connections
 * Conexões de WhatsApp da conta, só com campos seguros (nunca o token). Qualquer membro pode ler:
 * a caixa de entrada usa a lista para o selo de número, o filtro e a regra da janela de 24 horas.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const all = await listConnections(supabase, accountId)
    return NextResponse.json({
      connections: all.map((c) => ({
        id: c.id,
        name: c.name,
        provider: c.provider,
        status: c.status,
        is_default: c.is_default,
      })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/whatsapp/connections  { id, name?, is_default? }
 * Renomeia uma conexão e/ou a define como padrão (a que atende conversas novas, disparos e automações
 * sem número definido). Só administradores.
 */
export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = (await request.json().catch(() => null)) as { id?: unknown; name?: unknown; is_default?: unknown } | null
    const id = typeof body?.id === 'string' ? body.id : ''
    if (!id) return NextResponse.json({ error: 'Informe a conexão (id).' }, { status: 400 })
    const conn = await getConnectionById(supabase, accountId, id)
    if (!conn) return NextResponse.json({ error: 'Conexão não encontrada' }, { status: 404 })

    if (typeof body?.name === 'string') {
      const name = body.name.trim().slice(0, 60)
      if (!name) return NextResponse.json({ error: 'O nome não pode ficar vazio.' }, { status: 400 })
      const { error } = await supabase.from('whatsapp_config').update({ name }).eq('id', id).eq('account_id', accountId)
      if (error) return NextResponse.json({ error: 'Não foi possível renomear.' }, { status: 500 })
    }
    if (body?.is_default === true && !conn.is_default) {
      // Um índice parcial garante uma padrão por conta: tira de todas e põe nesta.
      await supabase.from('whatsapp_config').update({ is_default: false }).eq('account_id', accountId).eq('is_default', true)
      const { error } = await supabase.from('whatsapp_config').update({ is_default: true }).eq('id', id).eq('account_id', accountId)
      if (error) return NextResponse.json({ error: 'Não foi possível definir a conexão padrão.' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
