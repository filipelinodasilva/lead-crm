// Documentação interna (aba "Documentação"). Cada tópico tem as regras de
// negócio e um tutorial curto. Só em português por enquanto.

export interface DocSection {
  heading: string;
  /** Parágrafos descritivos. */
  body: string[];
  /** Passo a passo, quando faz sentido. */
  steps?: string[];
}

export interface DocTopic {
  id: string;
  title: string;
  summary: string;
  sections: DocSection[];
}

export const DOCS: DocTopic[] = [
  {
    id: "visao-geral",
    title: "Visão geral",
    summary: "O que é o Lead CRM e como as peças se encaixam.",
    sections: [
      {
        heading: "O que o sistema faz",
        body: [
          "O Lead CRM reúne, em um só lugar, a prospecção de clientes (busca no Google Maps e campanhas de abordagem), o atendimento pelo WhatsApp com vários atendentes no mesmo número, o funil de vendas e as automações.",
          "Cada empresa trabalha dentro da sua própria conta: contatos, conversas, funis, equipe e configurações de uma conta nunca aparecem em outra.",
        ],
      },
      {
        heading: "Fluxo de trabalho recomendado",
        body: ["Do lead ao cliente, o caminho é sempre o mesmo:"],
        steps: [
          "Prospecção: encontre empresas por segmento e cidade e salve as melhores.",
          "Campanha: envie a primeira abordagem pelo WhatsApp.",
          "Caixa de entrada: a resposta cai na fila do setor; um atendente assume.",
          "Funil: crie o negócio pela conversa e avance as etapas.",
          "Encerramento: finalize a conversa com um motivo para alimentar os relatórios.",
        ],
      },
    ],
  },
  {
    id: "contas-e-subcontas",
    title: "Contas, subcontas e teste grátis",
    summary: "Como funcionam a conta da empresa, as subcontas e os 7 dias grátis.",
    sections: [
      {
        heading: "Regra de negócio: teste de 7 dias",
        body: [
          "Toda conta nova (e toda subconta) começa com 7 dias grátis, com todos os módulos liberados. Uma faixa no topo mostra quantos dias faltam.",
          "Ao terminar o prazo, o sistema bloqueia o acesso aos dados sozinho. Nada é apagado: a liberação é feita manualmente pela administração do Lead CRM depois da contratação.",
        ],
      },
      {
        heading: "Regra de negócio: subcontas",
        body: [
          "Uma subconta é um CRM separado dentro da sua conta, com contatos, conversas, funis e equipe próprios. Serve para agências com vários clientes ou empresas com várias unidades.",
          "Só o dono ou um administrador cria subcontas, e uma subconta não cria outras subcontas. O dono e os administradores da conta-mãe entram nas subcontas como administradores.",
        ],
      },
      {
        heading: "Tutorial: criar e entrar em uma subconta",
        body: [],
        steps: [
          "Abra Subcontas no menu lateral.",
          "Digite o nome da empresa e clique em Criar subconta.",
          "Clique em Entrar: o sistema inteiro passa a mostrar os dados daquela subconta. O nome dela aparece no topo, em azul.",
          "Para voltar, use o botão Voltar para minha conta na barra lateral.",
          "Para dar acesso ao cliente, entre na subconta e gere um convite em Configurações > Membros da equipe.",
        ],
      },
    ],
  },
  {
    id: "equipe-e-permissoes",
    title: "Equipe e permissões",
    summary: "Papéis da conta e o que cada um pode fazer.",
    sections: [
      {
        heading: "Regra de negócio: papéis",
        body: [
          "Dono: controle total, inclusive transferir a propriedade da conta.",
          "Administrador: configura tudo (WhatsApp, setores, regras, membros) e vê todas as conversas.",
          "Atendente: atende conversas, edita contatos e negócios. Não altera configurações.",
          "Visualizador: só consulta o painel; por padrão não vê conversas.",
          "Dentro de cada setor existe ainda o papel de supervisor, explicado no tópico Atendimento.",
        ],
      },
      {
        heading: "Tutorial: convidar alguém",
        body: [],
        steps: [
          "Vá em Configurações > Membros da equipe.",
          "Clique em Convidar, escolha o papel e copie o link.",
          "Envie o link; ao aceitar, a pessoa entra na sua conta e no setor padrão.",
        ],
      },
    ],
  },
  {
    id: "atendimento",
    title: "Atendimento: setores, fila e privacidade",
    summary: "Como várias pessoas atendem o mesmo WhatsApp sem se atropelar.",
    sections: [
      {
        heading: "Regra de negócio: setores e fila",
        body: [
          "A conta tem um ou mais setores (Vendas, Suporte, Financeiro...). Cada número de WhatsApp pode apontar para um setor; sem isso a conversa nova cai no setor padrão.",
          "Fila é o conjunto de conversas abertas sem responsável. Quem é do setor vê a fila do setor e clica em Assumir para ficar responsável.",
        ],
      },
      {
        heading: "Regra de negócio: estados da conversa",
        body: [
          "Aberta sem responsável: está na fila.",
          "Aberta com responsável: em atendimento.",
          "Pendente: esperando o cliente ou um terceiro; sai da lista principal e mantém o responsável.",
          "Fechada: encerrada com motivo. Se o cliente escrever de novo, a conversa reabre: com o mesmo atendente, se o encerramento foi recente (regra de horas), ou de volta à fila.",
        ],
      },
      {
        heading: "Regra de negócio: quem vê o quê",
        body: [
          "Por padrão, uma conversa assumida só é vista pelo responsável, pelos supervisores do setor e pelos administradores. Os outros atendentes não a veem na lista, na busca nem pela API: a regra é aplicada no banco de dados.",
          "Administradores e supervisores abrem a conversa de outro atendente em modo supervisão (faixa amarela no topo) e podem assumir, transferir ou só observar.",
          "Essas regras são editáveis em Configurações > Atendimento (veja abaixo).",
        ],
      },
      {
        heading: "Tela de tickets: abas Atendendo, Fila, Resolvidos e Todas",
        body: [
          "No topo da Caixa de entrada ficam quatro abas, cada uma com o seu contador. Atendendo: as conversas abertas em que você é o responsável. Fila: conversas abertas sem responsável (o contador fica amarelo quando há alguém esperando). Resolvidos: conversas encerradas. Todas: tudo o que você pode ver.",
          "Administradores e supervisores têm a opção Ver atendimentos de toda a equipe na aba Atendendo. Com mais de um setor, aparecem botões coloridos para filtrar por setor (vários ao mesmo tempo). Os filtros antigos (não lidas, aguardando resposta, expirando, tags, empresa, número) continuam funcionando dentro de cada aba.",
          "O atalho Filas e equipes, no menu lateral, abre direto a configuração de setores, equipes e regras.",
        ],
      },
      {
        heading: "Tutorial: atender uma conversa",
        body: [],
        steps: [
          "Na Caixa de entrada, abra a aba Fila (ou Atendendo para as suas).",
          "Abra a conversa e clique em Assumir.",
          "Responda normalmente. Para passar a outra pessoa, use o botão de atribuição; para outro setor, o botão com o nome do setor.",
          "Esperando retorno? Marque como Pendente.",
          "Terminou? Marque como Fechada e escolha o motivo.",
        ],
      },
      {
        heading: "Tutorial: configurar setores e regras",
        body: [],
        steps: [
          "Vá em Configurações > Atendimento.",
          "Crie os setores, escolha a cor e marque o padrão.",
          "Clique no nome de cada pessoa para colocá-la no setor: um clique vira atendente, outro vira supervisor, outro remove.",
          "Ajuste os motivos de encerramento.",
          "Em Regras, escolha quem vê conversas assumidas e a fila, se o atendente pode transferir, se o motivo é obrigatório e por quantas horas a conversa reabre com o último atendente. Salve.",
        ],
      },
    ],
  },
  {
    id: "tickets",
    title: "Tickets (ciclos de atendimento)",
    summary: "Número do atendimento, linha do tempo e notas internas.",
    sections: [
      {
        heading: "Regra de negócio: o que é um ticket",
        body: [
          "Um ticket é um ciclo de atendimento: começa quando a conversa é criada ou quando o cliente volta depois de um encerramento, passa pela fila e pelo responsável, e termina no encerramento. Cada mensagem não é um ticket; as mensagens do ciclo ficam dentro dele.",
          "A conversa com o contato continua sendo uma só (o histórico de mensagens não se divide). Cada empresa tem a sua numeração sequencial (#1, #2, #3...), mostrada na lista e no topo da conversa.",
          "Tudo é registrado automaticamente pelo banco de dados: entrou na fila, assumido por, transferido para, movido de setor, pendente, retomado, encerrado com motivo, avaliado.",
        ],
      },
      {
        heading: "Onde ver",
        body: [
          "No painel do contato (lateral direita da conversa), a seção Atendimentos lista os tickets daquela conversa. Clique em um para ver a linha do tempo.",
          "Notas internas: as notas do contato feitas durante um atendimento ficam marcadas com o número do ticket. Notas não são enviadas ao cliente.",
          "Limite atual: o atendente vê os tickets das conversas que as regras de atendimento deixam ele ver. Se uma conversa passou para outro atendente e a regra é Só o responsável, os tickets antigos dela deixam de aparecer para ele (e também no relatório dele).",
        ],
      },
    ],
  },
  {
    id: "atendimento-automatico",
    title: "Atendimento automático (opcional)",
    summary: "Menu de setores, horários, mensagens automáticas, avaliação, transferência e encerramento automáticos.",
    sections: [
      {
        heading: "Regra de negócio",
        body: [
          "É um módulo alternativo, no estilo do Whaticket, que vem todo desligado. Ele não substitui Fluxos, Automações nem o Agente de IA. Quando chega uma mensagem: se um fluxo estiver ativo para o contato, o fluxo responde; senão, o menu de setores (se ligado); depois as automações e, por último, a IA. Quando o menu responde, a IA e as automações de conteúdo ficam quietas naquela mensagem.",
          "Mensagens automáticas saem como bot: não contam como resposta do atendente no painel nem no filtro Aguardando resposta.",
          "Na API oficial da Meta, texto livre só pode ser enviado até 24 horas depois da última mensagem do cliente. Fora disso a mensagem automática não é enviada e fica registrada.",
        ],
      },
      {
        heading: "O que cada opção faz",
        body: [
          "Saudação com menu de setores: na primeira mensagem de um atendimento iniciado pelo cliente (e sem responsável), envia a saudação e a lista numerada de setores. A resposta com o número move a conversa para o setor e envia a saudação do setor. Respostas inválidas repetem o menu; esgotadas as tentativas, vai para o setor padrão. Atendimentos iniciados por nós (campanha, nova conversa, disparo) não recebem menu.",
          "Aviso de fora de horário: cada setor tem horário de funcionamento (dias e faixa de horas, no fuso da conta) e uma mensagem. Fora do horário, o cliente recebe a mensagem uma vez por atendimento.",
          "Mensagens ao assumir, ao transferir e ao encerrar: enviadas quando um atendente faz a ação na tela.",
          "Avaliação de 1 a 5: ao encerrar um atendimento que teve responsável, o cliente recebe o pedido de nota. A resposta de 1 a 5 em até 24 horas fica no ticket e no relatório, e a conversa continua encerrada. Qualquer outra resposta reabre normalmente.",
          "Transferência automática: se ninguém assumir em X minutos, a conversa vai para o setor escolhido (uma vez por atendimento).",
          "Encerramento por inatividade: encerra com o motivo escolhido quando a última mensagem foi nossa e o cliente não responde há X horas. Nunca encerra se o cliente falou por último.",
          "Variáveis nos textos: {nome} (nome do cliente), {atendente}, {setor} e {ticket}.",
        ],
      },
      {
        heading: "Tutorial: ligar o menu de setores",
        body: [],
        steps: [
          "Em Filas e equipes, crie pelo menos dois setores.",
          "Em cada setor, abra Horário e mensagens do setor e escreva a saudação (e, se quiser, o horário e a mensagem de fora de horário).",
          "Desça até Atendimento automático, ligue Saudação com menu de setores, ajuste o texto e salve.",
          "Teste mandando uma mensagem de outro número para o WhatsApp da empresa.",
        ],
      },
    ],
  },
  {
    id: "relatorio-atendimento",
    title: "Relatório de atendimento",
    summary: "Indicadores por atendente, setor e motivo.",
    sections: [
      {
        heading: "O que mostra",
        body: [
          "Para os últimos 7, 30 ou 90 dias: atendimentos abertos, encerrados, quantos estão na fila agora, espera média (da abertura até alguém assumir), atendimento médio (de assumir até encerrar) e nota média. Abaixo, as mesmas medidas por atendente, por setor e por motivo de encerramento.",
          "Administradores veem a empresa toda. Atendentes veem apenas os atendimentos que as regras de atendimento deixam ver.",
        ],
      },
    ],
  },
  {
    id: "caixa-de-entrada",
    title: "Caixa de entrada e WhatsApp",
    summary: "Conexões, filtros, modelos e respostas rápidas.",
    sections: [
      {
        heading: "Conexões de WhatsApp",
        body: [
          "A conta pode ter vários números. Pelo QR code (sem janela de 24 horas) ou pela API oficial da Meta (com modelos aprovados e janela de 24 horas para mensagens livres).",
          "Cada conversa fica ligada ao número pelo qual chegou; com mais de um número, um selo mostra qual é.",
        ],
      },
      {
        heading: "Filtros da lista",
        body: [
          "Todas, Minhas, Não lidas, Aguardando resposta (o cliente falou por último), Sem responsável (fila), Expirando (janela de 24 h acabando), Abertas, Pendentes e Fechadas. Também é possível filtrar por tag do contato, empresa e número.",
        ],
      },
      {
        heading: "Modelos e respostas rápidas",
        body: [
          "Modelos são as mensagens aprovadas pela Meta para iniciar conversa fora da janela de 24 horas. Respostas rápidas são atalhos de texto da sua equipe, digitando / na caixa de mensagem.",
        ],
      },
    ],
  },
  {
    id: "contatos",
    title: "Contatos, tags e campos",
    summary: "Base de contatos, importação e organização.",
    sections: [
      {
        heading: "Regra de negócio",
        body: [
          "Um contato é único por telefone dentro da conta; importar de novo atualiza em vez de duplicar. Tags servem para segmentar (disparos e filtros); campos personalizados guardam informações próprias do seu negócio.",
        ],
      },
      {
        heading: "Tutorial: importar uma planilha",
        body: [],
        steps: ["Contatos > Importar.", "Envie o CSV e relacione as colunas.", "Escolha tags para o lote e confirme."],
      },
    ],
  },
  {
    id: "funil",
    title: "Funil e negócios",
    summary: "Etapas, negócios e acompanhamento pela conversa.",
    sections: [
      {
        heading: "Regra de negócio",
        body: [
          "Um funil tem etapas ordenadas; um negócio é um contato com valor em uma etapa. O painel mostra o pipeline e a taxa de conversão por etapa.",
          "O negócio pode ser aberto pela lateral da conversa; a etapa atual aparece ali, e mudar a etapa pela conversa reflete no funil na hora.",
        ],
      },
      {
        heading: "Funil e atendimento juntos",
        body: [
          "Cada cartão do funil mostra o atendimento do contato no WhatsApp: número do ticket, setor (na cor do setor) e situação (responsável, Na fila ou Encerrado). Clicar nessa linha abre a conversa na Caixa de entrada.",
          "As regras de privacidade valem aqui também: se a conversa é de outro atendente e você não pode vê-la, o cartão não mostra o atendimento.",
        ],
      },
      {
        heading: "Tutorial: criar um negócio pela conversa",
        body: [],
        steps: ["Abra a conversa.", "No painel do contato, em Negócios, clique em Novo.", "Escolha o funil, a etapa e o valor."],
      },
    ],
  },
  {
    id: "prospeccao",
    title: "Prospecção",
    summary: "Busca de empresas, campanhas de abordagem e ranking no Google.",
    sections: [
      {
        heading: "Busca de empresas",
        body: [
          "Pesquise por segmento e cidade. O resultado traz nome, telefone, site, nota e avaliações do Google Maps; salve os melhores como leads.",
        ],
      },
      {
        heading: "Diagnóstico de site (Fase 3)",
        body: [
          "Selecione leads com site e clique em Analisar sites (ou Analisar site na gaveta do lead). O sistema confere se o site está no ar, se usa HTTPS, qual plataforma/CMS utiliza, se possui botão de WhatsApp, redes sociais, e-mails públicos e se há Pixel/GTM instalado (Meta Pixel, Google Tag Manager, Google Ads/GA4, TikTok).",
          "Sites fora do ar ou sem Pixel/GTM aumentam automaticamente a nota de oportunidade do lead.",
        ],
      },
      {
        heading: "Campanhas",
        body: [
          "Uma campanha envia a mensagem inicial para uma lista de leads pelo WhatsApp, com intervalo entre envios para proteger o número. As respostas caem na fila do setor configurado.",
        ],
      },
      {
        heading: "Ranking",
        body: ["Mostra em que posição uma empresa aparece no Google Maps para um termo, em vários pontos da cidade. Útil para vender serviços de SEO local."],
      },
    ],
  },
  {
    id: "disparos-automacoes",
    title: "Disparos, automações e fluxos",
    summary: "Mensagens em massa e respostas automáticas.",
    sections: [
      {
        heading: "Disparos",
        body: ["Envio de um modelo para um público filtrado por tags ou empresa, com acompanhamento de entregues, lidos e respondidos."],
      },
      {
        heading: "Automações e fluxos",
        body: [
          "Automações são regras do tipo gatilho e ação (nova conversa, tag adicionada, negócio movido). Fluxos são conversas guiadas com perguntas e respostas, montadas em um editor visual.",
        ],
      },
    ],
  },
  {
    id: "agentes-ia",
    title: "Agentes de IA",
    summary: "Respostas automáticas com inteligência artificial e passagem para humano.",
    sections: [
      {
        heading: "Regra de negócio",
        body: [
          "O agente responde com base na base de conhecimento da conta. Quando não sabe ou quando o cliente pede uma pessoa, ele passa a conversa para a fila com um resumo; a partir daí a IA fica desligada naquela conversa até um atendente reativar.",
        ],
      },
    ],
  },
  {
    id: "administracao",
    title: "Administração da plataforma",
    summary: "Só para quem opera o Lead CRM.",
    sections: [
      {
        heading: "Painel /admin",
        body: [
          "Lista todas as contas com dono, situação, data do teste e membros. Ações: Liberar (vira ativa), Bloquear, +7 dias de teste e Entrar (abrir a conta para dar suporte).",
        ],
      },
    ],
  },
];
