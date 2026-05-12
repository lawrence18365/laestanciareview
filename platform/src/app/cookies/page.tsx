import type { Metadata } from 'next';
import PolicyPage from '@/components/legal/PolicyPage';

export const metadata: Metadata = {
  title: 'Política de Cookies | RateTap',
  description: 'Uso de cookies, pixeles y tecnologías similares en RateTap.',
};

export default function CookiesPage() {
  return (
    <PolicyPage
      title="Política de Cookies"
      updated="11 de mayo de 2026"
      intro="Usamos cookies y tecnologías similares para operar sesiones, medir uso del producto, entender campañas y mejorar la experiencia."
      sections={[
        {
          title: 'Cookies esenciales',
          body: [
            'Son necesarias para iniciar sesión, mantener seguridad, recordar estado básico, prevenir abuso y operar funciones de la plataforma. Sin estas cookies, algunas funciones no pueden trabajar correctamente.',
          ],
        },
        {
          title: 'Medición y marketing',
          body: [
            'Podemos usar Google Tag Manager, Meta Pixel y herramientas similares para medir visitas, formularios, campañas y rendimiento. Estos datos deben interpretarse como señales de interacción, no como prueba automática de compra o reseña pública.',
            'Cuando sea posible, los eventos importantes de negocio se deben confirmar desde el servidor, por ejemplo leads guardados, checkout creado, pago confirmado o cuenta activada.',
          ],
        },
        {
          title: 'Control',
          body: [
            'Puedes bloquear o eliminar cookies desde tu navegador. Algunas funciones, como inicio de sesión o medición de campañas, pueden dejar de funcionar o perder precisión.',
          ],
        },
        {
          title: 'Cambios',
          body: [
            'Podemos actualizar esta política cuando cambien las herramientas, proveedores o flujos del producto. La fecha superior indica la versión vigente.',
          ],
        },
      ]}
    />
  );
}
