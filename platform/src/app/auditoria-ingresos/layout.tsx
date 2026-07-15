import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Auditoría gratuita de ingresos para restaurantes | RateTap',
  description:
    'Descubre cuánto podría producir tu noche más floja activando la lista de invitados que tu restaurante ya tiene.',
  alternates: {
    canonical: '/auditoria-ingresos',
  },
};

export default function RevenueAuditLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
