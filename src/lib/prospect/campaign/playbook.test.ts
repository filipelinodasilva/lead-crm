import { describe, expect, it } from 'vitest';

import {
  MAX_MESSAGE_LENGTH,
  OPTOUT_NOTICE,
  renderMessage,
  validateMessageText,
} from './message';
import { PLAYBOOK_PRESETS } from './playbook';
import { MAX_FOLLOWUPS } from './types';

const VARS = {
  nome: 'Clínica Sol',
  categoria: 'dentista',
  cidade: 'Belo Horizonte',
  nota: '4,3',
  avaliacoes: '38',
};

describe('PLAYBOOK_PRESETS', () => {
  it('has unique ids', () => {
    const ids = PLAYBOOK_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const preset of PLAYBOOK_PRESETS) {
    describe(preset.id, () => {
      const texts = [preset.text, ...preset.followups.map((f) => f.text)];

      it('keeps follow-ups within the engine limit and delays in range', () => {
        expect(preset.followups.length).toBeLessThanOrEqual(MAX_FOLLOWUPS);
        for (const f of preset.followups) {
          expect(f.delay_days).toBeGreaterThanOrEqual(1);
          expect(f.delay_days).toBeLessThanOrEqual(30);
        }
      });

      it('passes the same validation the campaign form applies', () => {
        for (const text of texts) expect(validateMessageText(text)).toBeNull();
      });

      it('fits the length limit once the opt-out line is added', () => {
        for (const text of texts) {
          const out = renderMessage(text, VARS, () => 0, true);
          expect(out.endsWith(OPTOUT_NOTICE)).toBe(true);
          expect(out.length).toBeLessThanOrEqual(
            MAX_MESSAGE_LENGTH + OPTOUT_NOTICE.length
          );
        }
      });

      it('leaves no raw braces and no link or price in what the lead gets', () => {
        for (const text of texts) {
          const out = renderMessage(text, VARS, () => 0.5, true);
          expect(out).not.toMatch(/[{}]/);
          expect(out).not.toMatch(/https?:|www\.|R\$/i);
        }
      });
    });
  }
});
