import { describe, expect, it } from 'vitest'

import { normalizeBrazilPhone } from './new-conversation'

describe('normalizeBrazilPhone', () => {
  it('acrescenta o DDI do Brasil quando falta', () => {
    expect(normalizeBrazilPhone('(11) 99876-5432')).toBe('+5511998765432')
    expect(normalizeBrazilPhone('11998765432')).toBe('+5511998765432')
    expect(normalizeBrazilPhone('011 98765-4321')).toBe('+5511987654321')
  })
  it('mantém números que já têm DDI', () => {
    expect(normalizeBrazilPhone('+55 11 99876-5432')).toBe('+5511998765432')
    expect(normalizeBrazilPhone('5511998765432')).toBe('+5511998765432')
    expect(normalizeBrazilPhone('+1 415 555 0123')).toBe('+14155550123')
  })
  it('rejeita entrada que não é telefone', () => {
    expect(normalizeBrazilPhone('')).toBeNull()
    expect(normalizeBrazilPhone('abc')).toBeNull()
    expect(normalizeBrazilPhone('123')).toBeNull()
  })
})
