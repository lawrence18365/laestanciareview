import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AlertCoverageNotice from '@/components/dashboard/AlertCoverageNotice';

describe('AlertCoverageNotice', () => {
  it('names locations without registered alerts instead of claiming no device', () => {
    const html = renderToStaticMarkup(
      <AlertCoverageNotice
        coverage={{ covered: 2, total: 3, missing: ['Estancia Xalapa'] }}
      />,
    );

    expect(html).toContain('Alertas push activadas: 2/3 ubicaciones');
    expect(html).toContain('Sin alertas configuradas: Estancia Xalapa');
    // The location has devices in use; what it lacks is a registered alert.
    expect(html).not.toContain('Sin dispositivo');
    expect(html).toContain('Activar notificaciones');
  });

  it('joins several missing locations in one line', () => {
    const html = renderToStaticMarkup(
      <AlertCoverageNotice coverage={{ covered: 1, total: 3, missing: ['Centro', 'Norte'] }} />,
    );

    expect(html).toContain('Sin alertas configuradas: Centro, Norte');
  });

  it('renders an unknown state, never a misleading 0/', () => {
    const html = renderToStaticMarkup(<AlertCoverageNotice coverage={null} />);

    expect(html).toContain('no disponible');
    expect(html).not.toContain('0/');
    expect(html).not.toContain('Sin alertas');
  });

  it('renders nothing when the group has no operational locations', () => {
    expect(
      renderToStaticMarkup(
        <AlertCoverageNotice coverage={{ covered: 0, total: 0, missing: [] }} />,
      ),
    ).toBe('');
  });

  it('shows only a muted summary when every location has alerts', () => {
    const html = renderToStaticMarkup(
      <AlertCoverageNotice coverage={{ covered: 3, total: 3, missing: [] }} />,
    );

    expect(html).toContain('Alertas push activadas: 3/3 ubicaciones');
    expect(html).not.toContain('Sin alertas');
    expect(html).not.toContain('#FFFBEB');
  });
});
