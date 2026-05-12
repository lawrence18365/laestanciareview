import type { Metadata } from 'next';
import PolicyPage from '@/components/legal/PolicyPage';

export const metadata: Metadata = {
  title: 'Términos de Servicio | RateTap',
  description: 'Condiciones básicas para usar RateTap como restaurante o usuario autorizado.',
};

export default function TermsPage() {
  return (
    <PolicyPage
      title="Términos de Servicio"
      updated="11 de mayo de 2026"
      intro="Estos términos regulan el uso de RateTap. Si usas la plataforma en nombre de un restaurante, confirmas que tienes autorización para hacerlo."
      sections={[
        {
          title: 'Servicio',
          body: [
            'RateTap ofrece herramientas para recopilar calificaciones, facilitar reseñas, recibir comentarios privados, medir desempeño de personal y operar campañas relacionadas con la experiencia de clientes en restaurantes.',
            'El restaurante es responsable de usar la plataforma de forma honesta, legal y compatible con sus obligaciones hacia clientes, empleados, proveedores y plataformas externas.',
          ],
        },
        {
          title: 'Cuentas y acceso',
          body: [
            'Debes proteger tus credenciales y limitar el acceso a personal autorizado. Eres responsable de la actividad realizada desde tu cuenta, salvo uso no autorizado que nos reportes oportunamente.',
            'Podemos suspender cuentas por abuso, fraude, impago, uso que afecte la seguridad del sistema o incumplimiento de estos términos.',
          ],
        },
        {
          title: 'Pagos',
          body: [
            'Los planes, pruebas, precios y ciclos de cobro se muestran durante el proceso comercial o de checkout. Los pagos se procesan mediante Stripe u otro proveedor de pago autorizado.',
            'Salvo acuerdo escrito distinto, la falta de pago puede causar suspensión o cancelación del servicio.',
          ],
        },
        {
          title: 'Uso aceptable',
          body: [
            'No debes usar RateTap para spam, acoso, suplantación, manipulación engañosa, extracción no autorizada, acceso a datos de terceros, vulneración de seguridad o actividades ilegales.',
            'No debes afirmar resultados comerciales, calificaciones públicas o reseñas verificadas que no puedas demostrar con datos reales.',
          ],
        },
        {
          title: 'Limitaciones',
          body: [
            'RateTap no garantiza resultados específicos en Google, ventas, calificación pública, volumen de reseñas o ingresos. La plataforma ayuda a operar procesos; los resultados dependen de la ejecución del restaurante y de terceros.',
            'El servicio se ofrece con disponibilidad comercial razonable, sujeto a mantenimiento, proveedores externos, errores y eventos fuera de nuestro control.',
          ],
        },
        {
          title: 'Contacto',
          body: [
            'Para soporte, cancelaciones o preguntas comerciales, escribe a hello@ratetapmx.com.',
          ],
        },
      ]}
    />
  );
}
