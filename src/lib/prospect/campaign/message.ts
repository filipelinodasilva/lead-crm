// Message text for mass sending: variables like {nome} and spintax like
// {Olá|Oi|E aí} (a group with a pipe is a choice, a single word is a variable).

export const VARIABLES = [
  'nome',
  'categoria',
  'cidade',
  'nota',
  'avaliacoes',
] as const;
export type VariableName = (typeof VARIABLES)[number];
export type MessageVars = Record<VariableName, string>;

export const OPTOUT_NOTICE =
  '\n\nPara não receber mais mensagens, responda SAIR.';
export const MAX_MESSAGE_LENGTH = 1000;

const GROUP = /\{([^{}]*)\}/g;

function isVariable(name: string): name is VariableName {
  return (VARIABLES as readonly string[]).includes(name);
}

/** Returns a user-facing error, or null when the text is valid. */
export function validateMessageText(text: string): string | null {
  const t = text.trim();
  if (!t) return 'Escreva a mensagem.';
  if (t.length > MAX_MESSAGE_LENGTH) {
    return `A mensagem passa de ${MAX_MESSAGE_LENGTH} caracteres.`;
  }
  // unbalanced braces would leave raw "{" in what the lead receives
  const stripped = t.replace(GROUP, '');
  if (/[{}]/.test(stripped)) return 'Há uma chave { ou } sem par na mensagem.';
  for (const m of t.matchAll(GROUP)) {
    const inner = m[1].trim();
    if (inner.includes('|')) {
      const options = inner
        .split('|')
        .map((o) => o.trim())
        .filter(Boolean);
      if (options.length < 2)
        return `A variação {${inner}} precisa de pelo menos duas opções.`;
    } else if (!isVariable(inner.toLowerCase())) {
      return `Variável desconhecida: {${inner}}. Use ${VARIABLES.map((v) => `{${v}}`).join(', ')}.`;
    }
  }
  return null;
}

export function renderMessage(
  text: string,
  vars: MessageVars,
  rng: () => number = Math.random,
  includeOptout = true
): string {
  const out = text
    .replace(GROUP, (_all, inner: string) => {
      const body = inner.trim();
      if (body.includes('|')) {
        const options = body
          .split('|')
          .map((o) => o.trim())
          .filter(Boolean);
        return options[Math.floor(rng() * options.length)] ?? '';
      }
      const key = body.toLowerCase();
      return isVariable(key) ? vars[key] : '';
    })
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return includeOptout ? out + OPTOUT_NOTICE : out;
}

/** Fill the variables from a lead (preferred) or just the contact name. */
export function variablesFor(
  lead: {
    name?: string | null;
    category?: string | null;
    city?: string | null;
    rating?: number | null;
    review_count?: number | null;
  } | null,
  contactName: string | null
): MessageVars {
  return {
    nome: (lead?.name ?? contactName ?? '').trim(),
    categoria: (lead?.category ?? '').replace(/_/g, ' '),
    cidade: lead?.city ?? '',
    nota: lead?.rating != null ? String(lead.rating).replace('.', ',') : '',
    avaliacoes: lead?.review_count != null ? String(lead.review_count) : '',
  };
}

const OPTOUT_WORDS =
  /^\s*(sair|parar|pare|stop|cancelar|remover|descadastrar|nao quero( receber)?( mais)?)\b/;

/** True when a reply asks to stop receiving messages. */
export function isOptOutText(text: string | null | undefined): boolean {
  if (!text) return false;
  const plain = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return OPTOUT_WORDS.test(plain);
}
