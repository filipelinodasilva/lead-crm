import { describe, expect, it } from 'vitest'

import { normalizeEvolutionEvent, phoneFromJid, toMetaEnvelope } from './evolution-webhook'

const upsert = (data: Record<string, unknown>) => ({ event: 'messages.upsert', instance: 'crm-1', data })

describe('phoneFromJid', () => {
  it('extrai o número de um JID comum', () => {
    expect(phoneFromJid('5511999999999@s.whatsapp.net')).toBe('5511999999999')
  })
  it('acrescenta o 9 em celular brasileiro sem ele', () => {
    expect(phoneFromJid('553180253910@s.whatsapp.net')).toBe('5531980253910')
    expect(phoneFromJid('5531980253910@s.whatsapp.net')).toBe('5531980253910')
    // fixo (primeiro dígito 2 a 5) não muda
    expect(phoneFromJid('553132531234@s.whatsapp.net')).toBe('553132531234')
  })
  it('descarta grupos, status e LID sem número', () => {
    expect(phoneFromJid('120363@g.us')).toBeNull()
    expect(phoneFromJid('status@broadcast')).toBeNull()
    expect(phoneFromJid('abc123@lid')).toBeNull()
  })
  it('usa o JID alternativo quando o principal é LID', () => {
    expect(phoneFromJid('abc@lid', '5511988887777@s.whatsapp.net')).toBe('5511988887777')
  })
})

describe('normalizeEvolutionEvent', () => {
  it('converte texto recebido', () => {
    const ev = normalizeEvolutionEvent(
      upsert({
        key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false, id: 'ABC' },
        pushName: 'Maria',
        message: { conversation: 'Olá!' },
        messageTimestamp: 1700000000,
      }),
    )
    expect(ev.kind).toBe('message')
    if (ev.kind !== 'message') return
    expect(ev.phone).toBe('5511999999999')
    expect(ev.metaMessage).toMatchObject({ type: 'text', text: { body: 'Olá!' } })
    const env = toMetaEnvelope(ev, 'evo_crm-1') as {
      entry: Array<{ changes: Array<{ value: { contacts: Array<{ wa_id: string }> } }> }>
    }
    expect(env.entry[0].changes[0].value.contacts[0].wa_id).toBe('5511999999999')
  })

  it('converte imagem com legenda e carrega o base64', () => {
    const ev = normalizeEvolutionEvent(
      upsert({
        key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false, id: 'IMG1' },
        message: { imageMessage: { mimetype: 'image/jpeg', caption: 'foto' }, base64: 'QUJD' },
      }),
    )
    expect(ev.kind).toBe('message')
    if (ev.kind !== 'message') return
    expect(ev.metaMessage).toMatchObject({
      type: 'image',
      image: { id: 'evo:IMG1', mime_type: 'image/jpeg', caption: 'foto' },
    })
    expect(ev.media?.base64).toBe('QUJD')
  })

  it('desembrulha mensagem temporária', () => {
    const ev = normalizeEvolutionEvent(
      upsert({
        key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false, id: 'E1' },
        message: { ephemeralMessage: { message: { extendedTextMessage: { text: 'oi' } } } },
      }),
    )
    expect(ev.kind === 'message' && ev.text).toBe('oi')
  })

  it('ignora grupos e tipos não suportados', () => {
    expect(
      normalizeEvolutionEvent(
        upsert({ key: { remoteJid: '1203@g.us', fromMe: false, id: 'G' }, message: { conversation: 'x' } }),
      ).kind,
    ).toBe('ignore')
    expect(
      normalizeEvolutionEvent(
        upsert({
          key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false, id: 'P' },
          message: { protocolMessage: {} },
        }),
      ).kind,
    ).toBe('ignore')
  })

  it('marca mensagens enviadas pelo celular', () => {
    const ev = normalizeEvolutionEvent(
      upsert({
        key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: true, id: 'M' },
        message: { conversation: 'resposta' },
      }),
    )
    expect(ev.kind === 'message' && ev.fromMe).toBe(true)
  })

  it('mapeia status de entrega e leitura, só para mensagens enviadas', () => {
    const base = { event: 'messages.update', instance: 'crm-1' }
    const jid = '5511999999999@s.whatsapp.net'
    const delivered = normalizeEvolutionEvent({ ...base, data: { keyId: 'K1', remoteJid: jid, fromMe: true, status: 'DELIVERY_ACK' } })
    expect(delivered.kind === 'status' && delivered.status).toBe('delivered')
    const read = normalizeEvolutionEvent({ ...base, data: { keyId: 'K1', remoteJid: jid, fromMe: true, status: 'READ' } })
    expect(read.kind === 'status' && read.status).toBe('read')
    const incoming = normalizeEvolutionEvent({ ...base, data: { keyId: 'K2', remoteJid: jid, fromMe: false, status: 'READ' } })
    expect(incoming.kind).toBe('ignore')
  })

  it('reconhece mudança de conexão', () => {
    const ev = normalizeEvolutionEvent({ event: 'CONNECTION_UPDATE', instance: 'crm-1', data: { state: 'open' } })
    expect(ev).toMatchObject({ kind: 'connection', state: 'open' })
  })
})
