import { describe, expect, it } from 'vitest';

import {
  OPTOUT_NOTICE,
  isOptOutText,
  renderMessage,
  validateMessageText,
  variablesFor,
} from './message';
import {
  effectiveDailyCap,
  hhmmToMinutes,
  isInWindow,
  isValidTimezone,
  localDayStart,
  minutesToHHMM,
  nextDelayMs,
} from './schedule';
import { parseCampaignInput } from './service';

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

describe('validateMessageText', () => {
  it('accepts variables and spintax', () => {
    expect(
      validateMessageText('{Olá|Oi} {nome}, vi a {categoria} em {cidade}.')
    ).toBeNull();
  });
  it('rejects empty, long, unknown variables, lone braces and one-option groups', () => {
    expect(validateMessageText('   ')).toMatch(/Escreva/);
    expect(validateMessageText('a'.repeat(1001))).toMatch(/1000/);
    expect(validateMessageText('Oi {sobrenome}')).toMatch(/desconhecida/);
    expect(validateMessageText('Oi {nome')).toMatch(/sem par/);
    expect(validateMessageText('{Oi|}')).toMatch(/duas opções/);
  });
});

describe('renderMessage', () => {
  const vars = {
    nome: 'Clínica Sol',
    categoria: 'dentista',
    cidade: 'BH',
    nota: '4,8',
    avaliacoes: '120',
  };
  it('fills variables and picks spintax options from the random source', () => {
    expect(
      renderMessage('{Olá|Oi} {nome} de {cidade}', vars, () => 0, false)
    ).toBe('Olá Clínica Sol de BH');
    expect(renderMessage('{Olá|Oi} {nome}', vars, () => 0.99, false)).toBe(
      'Oi Clínica Sol'
    );
  });
  it('appends the opt-out notice by default and collapses gaps left by empty variables', () => {
    expect(
      renderMessage('Oi {cidade} {nome}', { ...vars, cidade: '' }).endsWith(
        OPTOUT_NOTICE
      )
    ).toBe(true);
    expect(
      renderMessage(
        'Oi {cidade} {nome}',
        { ...vars, cidade: '' },
        () => 0,
        false
      )
    ).toBe('Oi Clínica Sol');
  });
});

describe('variablesFor', () => {
  it('uses the lead and formats the rating with a comma', () => {
    expect(
      variablesFor(
        {
          name: 'Studio X',
          category: 'personal_trainer',
          city: 'Contagem',
          rating: 4.6,
          review_count: 31,
        },
        'Outro'
      )
    ).toEqual({
      nome: 'Studio X',
      categoria: 'personal trainer',
      cidade: 'Contagem',
      nota: '4,6',
      avaliacoes: '31',
    });
  });
  it('falls back to the contact name when there is no lead', () => {
    expect(variablesFor(null, 'Maria')).toMatchObject({
      nome: 'Maria',
      cidade: '',
      nota: '',
    });
  });
});

describe('isOptOutText', () => {
  it('detects requests to stop, with or without accents', () => {
    for (const t of [
      'SAIR',
      'Sair',
      'pare',
      'Não quero mais',
      'nao quero receber',
      'stop',
      'Cancelar por favor',
    ]) {
      expect(isOptOutText(t)).toBe(true);
    }
  });
  it('does not fire on normal replies', () => {
    for (const t of [
      'Quero sim!',
      'Pode me ligar?',
      'sairei às 18h',
      'Para quando?',
      '',
      null,
    ]) {
      expect(isOptOutText(t as string | null)).toBe(false);
    }
  });
});

describe('send window', () => {
  const w = {
    startMin: 540,
    endMin: 1080,
    days: [1, 2, 3, 4, 5],
    timezone: 'America/Sao_Paulo',
  };
  it('is open from 09:00 up to, not including, 18:00 local time on listed days', () => {
    expect(isInWindow(new Date('2026-10-26T12:00:00Z'), w)).toBe(true); // Monday 09:00 BRT
    expect(isInWindow(new Date('2026-10-26T11:59:00Z'), w)).toBe(false); // 08:59
    expect(isInWindow(new Date('2026-10-26T20:59:00Z'), w)).toBe(true); // 17:59
    expect(isInWindow(new Date('2026-10-26T21:00:00Z'), w)).toBe(false); // 18:00
    expect(isInWindow(new Date('2026-10-31T15:00:00Z'), w)).toBe(false); // Saturday
  });
  it('finds the start of the local day', () => {
    expect(
      localDayStart(
        new Date('2026-10-26T02:00:00Z'),
        'America/Sao_Paulo'
      ).toISOString()
    ).toBe('2026-10-25T03:00:00.000Z');
    expect(
      localDayStart(
        new Date('2026-10-26T15:30:00Z'),
        'America/Sao_Paulo'
      ).toISOString()
    ).toBe('2026-10-26T03:00:00.000Z');
  });
  it('validates time zones and HH:MM', () => {
    expect(isValidTimezone('America/Sao_Paulo')).toBe(true);
    expect(isValidTimezone('Marte/Olympus')).toBe(false);
    expect(hhmmToMinutes('09:30')).toBe(570);
    expect(hhmmToMinutes('24:00')).toBe(1440);
    expect(hhmmToMinutes('25:00')).toBeNull();
    expect(hhmmToMinutes('9h')).toBeNull();
    expect(minutesToHHMM(570)).toBe('09:30');
  });
});

describe('daily cap and pacing', () => {
  const tz = 'America/Sao_Paulo';
  const start = new Date('2026-10-26T15:00:00Z');
  it('ramps up 10, 15, 20... until the limit when warm-up is on', () => {
    expect(
      effectiveDailyCap(30, true, start, new Date('2026-10-26T18:00:00Z'), tz)
    ).toBe(10);
    expect(
      effectiveDailyCap(30, true, start, new Date('2026-10-27T18:00:00Z'), tz)
    ).toBe(15);
    expect(
      effectiveDailyCap(30, true, start, new Date('2026-10-28T18:00:00Z'), tz)
    ).toBe(20);
    expect(
      effectiveDailyCap(30, true, start, new Date('2026-11-10T18:00:00Z'), tz)
    ).toBe(30);
    expect(
      effectiveDailyCap(8, true, start, new Date('2026-10-26T18:00:00Z'), tz)
    ).toBe(8);
  });
  it('uses the plain limit without warm-up', () => {
    expect(
      effectiveDailyCap(30, false, start, new Date('2026-10-26T18:00:00Z'), tz)
    ).toBe(30);
  });
  it('waits a random time inside the interval', () => {
    expect(nextDelayMs(45, 120, () => 0)).toBe(45_000);
    expect(nextDelayMs(45, 120, () => 1)).toBe(120_000);
    expect(nextDelayMs(60, 60, () => 0.5)).toBe(60_000);
  });
});

describe('parseCampaignInput', () => {
  const base = {
    name: 'Dentistas BH',
    pipelineId: ID,
    stageId: ID2,
    connectionId: ID,
    messageText: 'Oi {nome}',
  };
  it('applies the safe defaults', () => {
    const p = parseCampaignInput(base);
    expect(p).toMatchObject({
      daily_limit: 30,
      warmup: true,
      include_optout: true,
      stop_on_reply: true,
      window_start_min: 540,
      window_end_min: 1080,
      days: [1, 2, 3, 4, 5],
      min_interval_s: 45,
      max_interval_s: 120,
      timezone: 'America/Sao_Paulo',
      followups: [],
    });
  });
  it('reads followups, days and window', () => {
    const p = parseCampaignInput({
      ...base,
      windowStart: '10:00',
      windowEnd: '16:30',
      days: [5, 1, 1, 3],
      followups: [{ delayDays: 2, text: 'Lembrete {nome}' }],
    });
    expect(p.window_start_min).toBe(600);
    expect(p.window_end_min).toBe(990);
    expect(p.days).toEqual([1, 3, 5]);
    expect(p.followups).toEqual([{ delay_days: 2, text: 'Lembrete {nome}' }]);
  });
  it('rejects bad input with a readable message', () => {
    const bad = (over: object) => () =>
      parseCampaignInput({ ...base, ...over });
    expect(bad({ name: 'x' })).toThrow(/nome/i);
    expect(bad({ pipelineId: 'nope' })).toThrow(/inválido/);
    expect(bad({ stageId: '' })).toThrow(/obrigatório/);
    expect(bad({ windowStart: '18:00', windowEnd: '09:00' })).toThrow(/janela/);
    expect(bad({ days: [] })).toThrow(/dia da semana/);
    expect(bad({ days: [9] })).toThrow(/dia da semana/);
    expect(bad({ minIntervalSeconds: 100, maxIntervalSeconds: 50 })).toThrow(
      /intervalo/i
    );
    expect(bad({ minIntervalSeconds: 3 })).toThrow(/Intervalo mínimo/);
    expect(bad({ dailyLimit: 0 })).toThrow(/Limite por dia/);
    expect(bad({ dailyLimit: 9999 })).toThrow(/Limite por dia/);
    expect(bad({ timezone: 'Marte/Olympus' })).toThrow(/Fuso/);
    expect(bad({ templateVars: ['sobrenome'] })).toThrow(/desconhecida/);
    expect(
      bad({ followups: [1, 2, 3].map(() => ({ delayDays: 1, text: 'oi' })) })
    ).toThrow(/No máximo/);
    expect(bad({ followups: [{ delayDays: 0, text: 'oi' }] })).toThrow(/Prazo/);
    expect(bad({ followups: [{ delayDays: 1, text: 'Oi {x}' }] })).toThrow(
      /Acompanhamento 1/
    );
  });
});
