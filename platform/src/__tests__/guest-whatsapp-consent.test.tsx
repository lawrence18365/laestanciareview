/**
 * /guests WhatsApp action is consent-gated.
 *
 * WhatsAppButton is the single component behind all three call sites (desktop
 * table row, mobile card, guest detail panel), so asserting it here covers each.
 * A guest without marketingConsent must render no wa.me link at all — only a
 * muted "Sin consentimiento" label.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { WhatsAppButton } from '@/app/(app)/guests/GuestsTable';

const baseGuest = {
  id: 7,
  name: 'maria lopez',
  whatsapp: '+524771234567',
  birthdayMmdd: null,
  preferences: null,
  marketingConsent: true,
  status: 'validated' as const,
  validationCode: null,
  redemptionType: null,
  promoType: null,
  capturedAt: '2026-10-01T12:00:00.000Z',
  validatedAt: null,
  notes: null,
  visitCount: 1,
  lastVisit: null,
};

function render(marketingConsent: boolean, block = false) {
  return renderToStaticMarkup(
    <WhatsAppButton
      guest={{ ...baseGuest, marketingConsent }}
      restaurantName="La Estancia"
      todayMmdd="1010"
      sent={false}
      onSent={() => {}}
      block={block}
    />,
  );
}

describe('WhatsAppButton consent gate', () => {
  it('renders the wa.me link for a consented guest', () => {
    const html = render(true);
    expect(html).toContain('href="https://wa.me/');
    expect(html).not.toContain('Sin consentimiento');
  });

  it('renders no wa.me link and shows the label for a non-consented guest', () => {
    for (const block of [false, true]) {
      const html = render(false, block);
      expect(html).not.toContain('wa.me');
      expect(html).not.toContain('<a');
      expect(html).toContain('Sin consentimiento');
    }
  });
});
