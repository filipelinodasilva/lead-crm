import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'

import {
  ForbiddenError,
  UnauthorizedError,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import {
  EvolutionApiError,
  connectInstance,
  createInstance,
  deleteInstance,
  evolutionConfigured,
  getConnectionState,
  instanceFromPhoneId,
  logoutInstance,
  phoneIdFromInstance,
  type EvolutionQr,
} from '@/lib/whatsapp/evolution-api'
import { evolutionWebhookSecret } from '@/lib/whatsapp/evolution-webhook'
import { ensureDefaultConnection, getConnectionById, listConnections } from '@/lib/whatsapp/connections'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * Conexões por QR code (Evolution API). A conta pode ter vários números.
 *   GET            → lista as conexões QR com o estado de cada uma
 *   GET ?id=<id>   → estado de uma conexão e o QR atualizado, se ainda estiver conectando
 *   POST {name?}   → adiciona uma conexão nova e devolve o QR
 *   POST {id}      → pede um QR novo para uma conexão existente
 *   DELETE ?id=<id>→ desconecta e remove a conexão
 */

function newInstanceName(accountId: string): string {
  return `crm-${accountId.replace(/-/g, '').slice(0, 8)}-${randomBytes(2).toString('hex')}`
}

function webhookBase(): string {
  return (process.env.EVOLUTION_WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '')
}

function errorResponse(error: unknown) {
  if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
    return toErrorResponse(error)
  }
  if (error instanceof EvolutionApiError) {
    return NextResponse.json({ error: error.message }, { status: 502 })
  }
  console.error('[whatsapp/evolution]', error)
  return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
}

async function stateWithQr(instance: string): Promise<{ state: string; qr: EvolutionQr | null }> {
  const state = await getConnectionState(instance)
  let qr: EvolutionQr | null = null
  if (state === 'connecting' || state === 'close') {
    try {
      qr = await connectInstance(instance)
    } catch {
      qr = null
    }
  }
  return { state, qr }
}

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const id = new URL(request.url).searchParams.get('id')
    const configured = evolutionConfigured()

    if (id) {
      const conn = await getConnectionById(supabase, accountId, id)
      if (!conn || conn.provider !== 'evolution') {
        return NextResponse.json({ error: 'Conexão não encontrada' }, { status: 404 })
      }
      const instance = instanceFromPhoneId(conn.phone_number_id)
      const { state, qr } = await stateWithQr(instance)
      const nowConnected = state === 'open'
      if (nowConnected !== (conn.status === 'connected')) {
        await supabase
          .from('whatsapp_config')
          .update({
            status: nowConnected ? 'connected' : 'disconnected',
            connected_at: nowConnected ? new Date().toISOString() : null,
          })
          .eq('id', conn.id)
      }
      return NextResponse.json({ configured, id: conn.id, instance, state, qr })
    }

    const all = (await listConnections(supabase, accountId)).filter((c) => c.provider === 'evolution')
    const connections = await Promise.all(
      all.map(async (c) => ({
        id: c.id,
        name: c.name,
        is_default: c.is_default,
        state: await getConnectionState(instanceFromPhoneId(c.phone_number_id)).catch(() => 'unknown'),
      })),
    )
    return NextResponse.json({ configured, connections })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`whatsapp-admin:${userId}`, RATE_LIMITS.whatsappAdmin)
    if (!limit.success) return rateLimitResponse(limit)

    if (!evolutionConfigured()) {
      return NextResponse.json(
        { error: 'A Evolution API não está configurada no servidor (EVOLUTION_API_URL e EVOLUTION_API_KEY).' },
        { status: 400 },
      )
    }
    const base = webhookBase()
    if (!base) {
      return NextResponse.json(
        { error: 'Defina EVOLUTION_WEBHOOK_BASE_URL (endereço pelo qual a Evolution alcança este CRM).' },
        { status: 400 },
      )
    }

    const body = (await request.json().catch(() => ({}))) as { id?: unknown; name?: unknown }

    // QR novo para uma conexão que já existe.
    if (typeof body.id === 'string' && body.id) {
      const conn = await getConnectionById(supabase, accountId, body.id)
      if (!conn || conn.provider !== 'evolution') {
        return NextResponse.json({ error: 'Conexão não encontrada' }, { status: 404 })
      }
      const instance = instanceFromPhoneId(conn.phone_number_id)
      const state = await getConnectionState(instance)
      const qr = state === 'open' ? null : await connectInstance(instance)
      return NextResponse.json({ id: conn.id, instance, state, qr })
    }

    const existing = await listConnections(supabase, accountId)
    const instance = newInstanceName(accountId)
    const created = await createInstance({
      instanceName: instance,
      webhookUrl: `${base}/api/evolution/webhook`,
      webhookSecret: evolutionWebhookSecret(),
    })

    const evoCount = existing.filter((c) => c.provider === 'evolution').length
    const name =
      typeof body.name === 'string' && body.name.trim()
        ? body.name.trim().slice(0, 60)
        : `WhatsApp QR ${evoCount + 1}`

    const { data: inserted, error: saveError } = await supabase
      .from('whatsapp_config')
      .insert({
        account_id: accountId,
        user_id: userId,
        phone_number_id: phoneIdFromInstance(instance),
        waba_id: null,
        access_token: encrypt(created.instanceToken),
        verify_token: null,
        provider: 'evolution',
        name,
        // A primeira conexão da conta vira a padrão.
        is_default: existing.length === 0,
        status: 'disconnected',
      })
      .select('id')
      .single()
    if (saveError || !inserted) {
      await deleteInstance(instance).catch(() => undefined)
      console.error('[whatsapp/evolution] salvar conexão:', saveError)
      return NextResponse.json({ error: 'Não foi possível salvar a conexão.' }, { status: 500 })
    }
    return NextResponse.json({ id: inserted.id, instance, state: 'connecting', qr: created.qr })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Informe a conexão (id).' }, { status: 400 })
    const conn = await getConnectionById(supabase, accountId, id)
    if (!conn) return NextResponse.json({ success: true })
    if (conn.provider === 'evolution') {
      const instance = instanceFromPhoneId(conn.phone_number_id)
      await logoutInstance(instance)
      await deleteInstance(instance)
    }
    const { error } = await supabase.from('whatsapp_config').delete().eq('id', conn.id).eq('account_id', accountId)
    if (error) return NextResponse.json({ error: 'Não foi possível remover a conexão.' }, { status: 500 })
    await ensureDefaultConnection(supabase, accountId)
    return NextResponse.json({ success: true })
  } catch (error) {
    return errorResponse(error)
  }
}
