import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock('@/lib/mailer', () => ({ sendMail: mocks.sendMail, FROM: 'RateTap <hello@ratetapmx.com>' }));

import { POST } from '@/app/api/cron/founder-preview/route';

function req(body: unknown, auth = 'Bearer s3cret') {
  return new NextRequest('https://app.ratetapmx.com/api/cron/founder-preview', {
    method: 'POST',
    headers: { authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('founder-preview route', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 's3cret');
    vi.stubEnv('OWNER_NOTIFICATION_EMAIL', 'lawrencebrennan@gmail.com,guillermo1606@gmail.com');
    mocks.sendMail.mockReset().mockResolvedValue({ success: true });
  });

  it('rejects a wrong secret', async () => {
    const res = await POST(req({ to: 'lawrencebrennan@gmail.com', subject: '[Preview] x', html: '<p>x</p>' }, 'Bearer nope'));
    expect(res.status).toBe(401);
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it('refuses any recipient outside OWNER_NOTIFICATION_EMAIL', async () => {
    const res = await POST(req({ to: 'juancarlos.rivera@grupoestancia.com', subject: '[Preview] x', html: '<p>x</p>' }));
    expect(res.status).toBe(400);
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it('refuses a subject not marked as a preview', async () => {
    const res = await POST(req({ to: 'guillermo1606@gmail.com', subject: 'Grupo Estancia · resumen', html: '<p>x</p>' }));
    expect(res.status).toBe(400);
  });

  it('sends to a founder with a preview subject', async () => {
    const res = await POST(req({ to: 'Guillermo1606@gmail.com', subject: '[Vista previa] Grupo Estancia', html: '<p>x</p>' }));
    expect(res.status).toBe(200);
    expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'guillermo1606@gmail.com', subject: '[Vista previa] Grupo Estancia' }));
  });
});
