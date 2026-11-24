import { describe, expect, it } from 'vitest';

import {
  candidateNames,
  cleanCnpj,
  decideCandidate,
  extractCep,
  extractCityState,
  extractNeighborhood,
  extractStreetNumber,
  formatCnpj,
  phoneVariants,
  porteLabel,
} from './cnpj';

describe('cnpj helpers & Fase 2 decision rules', () => {
  it('cleans and formats numeric and alphanumeric CNPJs', () => {
    expect(cleanCnpj('12.345.678/0001-95')).toBe('12345678000195');
    expect(cleanCnpj('12.ABC.345/01DE-35')).toBe('12ABC34501DE35');
    expect(cleanCnpj('123')).toBeNull();
    expect(formatCnpj('12345678000195')).toBe('12.345.678/0001-95');
  });

  it('generates Brazilian phone variants with and without the 9th mobile digit', () => {
    expect(phoneVariants('+55 (31) 98888-7777')).toEqual([
      '3188887777',
      '31988887777',
    ]);
    expect(phoneVariants('(31) 8888-7777')).toEqual([
      '3188887777',
      '31988887777',
    ]);
    expect(phoneVariants('(31) 3822-1234')).toEqual(['3138221234']);
    expect(phoneVariants('123')).toEqual([]);
  });

  it('extracts CEP, street number, neighborhood and city/UF from Maps addresses', () => {
    const addr =
      'Av. Castelo Branco, 239 - Sl 42 - Horto, Ipatinga - MG, 35160-294, Brazil';
    expect(extractStreetNumber(addr)).toBe('239');
    expect(extractCep(addr)).toBe('35160294');
    expect(extractCityState(addr)).toEqual({ city: 'Ipatinga', state: 'MG' });
    expect(extractNeighborhood(addr)).toBe('Horto');
  });

  it('cleans candidate names stripping city, neighborhood and slogans', () => {
    expect(
      candidateNames('Academia Smart Fit - Iguaçú', 'Ipatinga', 'Iguaçu')
    ).toContain('Academia Smart Fit');
    expect(
      candidateNames(
        'VS Odontologia Integrada – Dentista 24h em Ipatinga | Dr. Victor Saraiva',
        'Ipatinga'
      )
    ).toContain('VS Odontologia Integrada');
  });

  it('reproduces all calibrated Fase 2 v3 candidate decisions', () => {
    expect(decideCandidate([])).toEqual({
      status: 'none',
      method: 'none',
      top: null,
    });

    // Única empresa ativa no endereço mas com nome diferente (ex.: MEI no nome civil) -> revisar
    expect(
      decideCandidate([
        {
          cnpj: '1',
          nome: 'SANDRA MARIA',
          sim: 0,
          mesmo_endereco: true,
          mesmo_cep: true,
        },
      ]).status
    ).toBe('review');

    // Mesmo CEP+número e nome parecido >= 0.5 -> endereco (matched)
    expect(
      decideCandidate([
        {
          cnpj: '1',
          nome: 'VS INTEGRADA',
          sim: 0.62,
          mesmo_endereco: true,
          mesmo_cep: true,
        },
      ])
    ).toMatchObject({ status: 'matched', method: 'address' });

    // Prédio comercial com várias empresas e nenhum nome parecido -> revisar
    expect(
      decideCandidate([
        {
          cnpj: '1',
          nome: 'A',
          sim: 0.05,
          mesmo_endereco: true,
          mesmo_cep: true,
        },
        {
          cnpj: '2',
          nome: 'B',
          sim: 0,
          mesmo_endereco: true,
          mesmo_cep: true,
        },
      ]).status
    ).toBe('review');

    // Rede/franquia com nome médio sem mesmo CEP -> revisar
    expect(
      decideCandidate([
        {
          cnpj: '3',
          nome: 'SMART X',
          sim: 0.55,
          mesmo_endereco: false,
          mesmo_cep: false,
        },
      ]).status
    ).toBe('review');

    // Nome >= 0.5 com mesmo CEP -> nome (matched)
    expect(
      decideCandidate([
        {
          cnpj: '3',
          nome: 'SMART FIT',
          sim: 0.55,
          mesmo_endereco: false,
          mesmo_cep: true,
        },
      ])
    ).toMatchObject({ status: 'matched', method: 'name' });

    // Nome forte >= 0.75 mesmo sem CEP -> nome (matched)
    expect(
      decideCandidate([
        {
          cnpj: '4',
          nome: 'ORALDENTS',
          sim: 0.8,
          mesmo_endereco: false,
          mesmo_cep: false,
        },
      ])
    ).toMatchObject({ status: 'matched', method: 'name' });
  });

  it('formats porte labels accurately', () => {
    expect(porteLabel({ mei: true, porte: 1 })).toBe('MEI');
    expect(porteLabel({ mei: false, porte: 1 })).toBe('ME');
    expect(porteLabel({ mei: false, porte: 3 })).toBe('EPP');
    expect(porteLabel({ mei: false, porte: 5 })).toBe('Médio/Grande');
  });
});
