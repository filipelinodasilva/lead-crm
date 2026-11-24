// Playbook Lead CRM: modelos prontos de abordagem fria no WhatsApp.
// Regras do texto: curto, uma observação real do perfil, sem link e sem preço,
// pede permissão (não reunião) e aceita o "não". Só usa as variáveis de
// message.ts. O aviso "responda SAIR" é anexado pela campanha.
// Cadência: entrada, dia 3 (valor, sem cobrança), dia 7 (encerramento leve).

import type { FollowUp } from './types';

export interface PlaybookPreset {
  id: string;
  label: string;
  text: string;
  followups: FollowUp[];
}

// Os dois acompanhamentos valem para qualquer abertura.
// delay_days conta a partir da mensagem anterior: 3 (dia 3) e 4 (dia 7).
const FOLLOWUPS: FollowUp[] = [
  {
    delay_days: 3,
    text:
      '{Oi|Olá}, {nome}. Só deixando aqui, sem cobrança: separei o print de como a busca por {categoria} em {cidade} aparece hoje. ' +
      'Costuma mostrar de onde vêm (ou deixam de vir) ligações sem ninguém perceber. Quer que eu envie?',
  },
  {
    delay_days: 4,
    text:
      '{nome}, não quero ficar insistindo. Se esse assunto entrar na pauta mais pra frente, o print continua com você. Sucesso por aí!',
  },
];

export const PLAYBOOK_PRESETS: PlaybookPreset[] = [
  {
    id: 'observacao',
    label: 'A. Observação direta (comece por esta)',
    text:
      '{Oi|Olá}, tudo bem? Pesquisei {categoria} em {cidade} no Google e vi a {nome} por lá, ' +
      'com nota {nota} e {avaliacoes} avaliações.\n\n' +
      'Montei um print rápido de como um cliente novo enxerga vocês na busca. Posso te mandar? Se não fizer sentido, sem problema.',
    followups: FOLLOWUPS,
  },
  {
    id: 'elogio',
    label: 'B. Elogio específico + dúvida',
    text:
      '{Oi|Olá}, {nome}! Vi as avaliações de vocês no Google ({nota} com {avaliacoes} avaliações) e dá para ver que o pessoal gosta do trabalho.\n\n' +
      'Fiquei curioso se isso aparece bem para quem pesquisa {categoria} em {cidade}. Posso te mostrar o que encontrei? Leva 1 minuto.',
    followups: FOLLOWUPS,
  },
  {
    id: 'curiosidade',
    label: 'C. Pergunta curiosa',
    text:
      '{Oi|Olá}, tudo bem? Uma curiosidade: se eu pesquisar {categoria} em {cidade} no Google agora, a {nome} é uma das primeiras que aparecem pra você?\n\n' +
      'Pergunto porque fiz um teste aqui e o resultado me chamou atenção.',
    followups: FOLLOWUPS,
  },
];
