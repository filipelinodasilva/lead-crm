import type { PhoneKind } from './types';

export interface ParsedPlacePhone {
  e164: string | null;
  kind: PhoneKind;
}

/**
 * Turn the international number Google returns ("+55 31 99999-9999") into
 * E.164 and guess whether it can have WhatsApp.
 *
 * Only Brazil is classified: 11 national digits with a 9 after the area
 * code is a mobile line; 10 digits starting 2-5 is a landline; 10 digits
 * starting 6-9 is a legacy 8-digit mobile. Everything else is `unknown`
 * (still stored, the user decides).
 */
export function parsePlacePhone(
  international: string | null | undefined
): ParsedPlacePhone {
  if (!international) return { e164: null, kind: 'unknown' };
  const digits = international.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) {
    return { e164: null, kind: 'unknown' };
  }
  const e164 = `+${digits}`;
  if (!digits.startsWith('55')) return { e164, kind: 'unknown' };

  const national = digits.slice(2);
  if (national.length === 11 && national[2] === '9') {
    return { e164, kind: 'mobile' };
  }
  if (national.length === 10) {
    return { e164, kind: '2345'.includes(national[2]) ? 'landline' : 'mobile' };
  }
  return { e164, kind: 'unknown' };
}
