/**
 * Dublê do módulo `@/lib/whatsapp/connections` para testes de rotas e do envio.
 * Cada função devolve a conexão que o teste definiu (ou null para "WhatsApp não configurado").
 */
export function makeConnectionsMock(get: () => unknown) {
  const one = async () => get()
  return {
    getConnectionForConversation: one,
    getDefaultConnection: one,
    getMetaConnection: one,
    getConnectionById: one,
    resolveConnection: one,
    listConnections: async () => {
      const c = get()
      return c ? [c] : []
    },
    ensureDefaultConnection: async () => undefined,
    connectionLabel: () => 'WhatsApp',
  }
}
