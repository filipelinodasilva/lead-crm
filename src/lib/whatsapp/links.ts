// Links para abrir um número no WhatsApp fora do sistema (WhatsApp Web ou app).
// Telefone aceita E.164 ("+5531999990001") ou como aparece na tela ("(31) 99999-0001").
// Sem DDI assume Brasil, igual ao envio de nova conversa.

import { normalizeBrazilPhone } from './new-conversation';

/** Só os dígitos com DDI, prontos para o link, ou null se não parecer telefone. */
export function waDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const e164 = normalizeBrazilPhone(phone);
  return e164 ? e164.slice(1) : null;
}

function withText(base: string, text?: string | null): string {
  const t = text?.trim();
  return t ? `${base}&text=${encodeURIComponent(t)}` : base;
}

/** WhatsApp Web: abre direto a conversa no navegador (pede o login se for a primeira vez). */
export function waWebUrl(
  phone: string | null | undefined,
  text?: string | null
): string | null {
  const d = waDigits(phone);
  return d ? withText(`https://web.whatsapp.com/send?phone=${d}`, text) : null;
}

/** Link curto do WhatsApp: no celular abre o app, no computador oferece o Web. */
export function waMeUrl(
  phone: string | null | undefined,
  text?: string | null
): string | null {
  const d = waDigits(phone);
  if (!d) return null;
  const t = text?.trim();
  return t
    ? `https://wa.me/${d}?text=${encodeURIComponent(t)}`
    : `https://wa.me/${d}`;
}
