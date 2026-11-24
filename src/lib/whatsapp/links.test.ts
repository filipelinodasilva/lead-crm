import { describe, expect, it } from 'vitest';

import { waDigits, waMeUrl, waWebUrl } from './links';

describe('waDigits', () => {
  it('keeps an E.164 number as digits', () => {
    expect(waDigits('+5531999990001')).toBe('5531999990001');
  });
  it('reads a number as shown on screen and assumes Brazil', () => {
    expect(waDigits('(31) 99999-0001')).toBe('5531999990001');
    expect(waDigits('(31) 3821-8941')).toBe('553138218941');
  });
  it('keeps a foreign number that already has its country code', () => {
    expect(waDigits('+1 (415) 555-0123')).toBe('14155550123');
  });
  it('returns null for empty or non-phone input', () => {
    expect(waDigits(null)).toBeNull();
    expect(waDigits('')).toBeNull();
    expect(waDigits('abc')).toBeNull();
    expect(waDigits('123')).toBeNull();
  });
});

describe('waWebUrl', () => {
  it('opens the chat on WhatsApp Web, with the text when given', () => {
    expect(waWebUrl('+5531999990001')).toBe(
      'https://web.whatsapp.com/send?phone=5531999990001'
    );
    expect(waWebUrl('+5531999990001', 'Oi, tudo bem?')).toBe(
      'https://web.whatsapp.com/send?phone=5531999990001&text=Oi%2C%20tudo%20bem%3F'
    );
  });
  it('encodes line breaks and accents', () => {
    const url = waWebUrl('+5531999990001', 'Olá\nSegunda linha')!;
    expect(url).toContain('text=Ol%C3%A1%0ASegunda%20linha');
  });
  it('ignores blank text and returns null without a valid phone', () => {
    expect(waWebUrl('+5531999990001', '   ')).toBe(
      'https://web.whatsapp.com/send?phone=5531999990001'
    );
    expect(waWebUrl(null)).toBeNull();
  });
});

describe('waMeUrl', () => {
  it('builds the short link', () => {
    expect(waMeUrl('+5531999990001')).toBe('https://wa.me/5531999990001');
    expect(waMeUrl('+5531999990001', 'Oi')).toBe(
      'https://wa.me/5531999990001?text=Oi'
    );
    expect(waMeUrl('x')).toBeNull();
  });
});
