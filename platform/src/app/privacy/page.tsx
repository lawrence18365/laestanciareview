import type { Metadata } from 'next';
import PolicyPage from '@/components/legal/PolicyPage';

export const metadata: Metadata = {
  title: 'Política de Privacidad | RateTap',
  description: 'Cómo RateTap recopila, usa y protege datos personales en su plataforma para restaurantes.',
};

export default function PrivacyPage() {
  return (
    <PolicyPage
      title="Política de Privacidad"
      updated="11 de mayo de 2026"
      intro="Esta política explica qué datos recopila RateTap, para qué los usamos y cómo puedes contactarnos para ejercer derechos sobre tus datos. No vendemos datos personales."
      sections={[
        {
          title: 'Datos que recopilamos',
          body: [
            'Recopilamos datos de restaurantes y contactos comerciales, incluyendo nombre del negocio, ciudad, nombre del contacto, correo, teléfono, dirección de envío y datos necesarios para configurar la cuenta.',
            'Cuando un restaurante usa RateTap con sus clientes, podemos procesar calificaciones, comentarios privados, nombre opcional, correo opcional, WhatsApp, fecha de cumpleaños si se proporciona, consentimiento de comunicación y datos de validación de visita.',
            'También procesamos datos técnicos como dirección IP, navegador, eventos de uso, páginas visitadas, identificadores de sesión, registros de errores y datos de interacción con códigos QR, NFC o enlaces de auditoría.',
          ],
        },
        {
          title: 'Uso de los datos',
          body: [
            'Usamos los datos para operar la plataforma, crear cuentas, procesar pagos, enviar alertas, generar reportes, validar visitas, dar soporte, prevenir abuso, medir rendimiento y mejorar el producto.',
            'Los datos de clientes finales se usan para el restaurante que opera la cuenta y para los flujos que el cliente acepta, como recibir comunicación por WhatsApp o participar en campañas de cumpleaños.',
          ],
        },
        {
          title: 'Proveedores',
          body: [
            'Podemos usar proveedores como Stripe para pagos, Spacemail o proveedores de correo para emails, Telnyx/Twilio/WhatsApp para mensajería, Google APIs para datos de ubicaciones, Sentry para errores, Meta/Google Tag Manager para medición, hosting y base de datos administrada.',
            'Cada proveedor recibe solo los datos necesarios para prestar su servicio. No usamos proveedores como autorización para vender información personal.',
          ],
        },
        {
          title: 'Retención y seguridad',
          body: [
            'Conservamos datos mientras sean necesarios para operar cuentas, cumplir obligaciones, resolver disputas, prevenir abuso y mantener registros comerciales. Podemos eliminar o anonimizar datos cuando ya no sean necesarios.',
            'Aplicamos controles técnicos y organizativos razonables, incluyendo sesiones protegidas, controles de acceso, límites de uso, registros operativos y proveedores especializados. Ningún sistema es infalible.',
          ],
        },
        {
          title: 'Tus derechos',
          body: [
            'Puedes solicitar acceso, corrección, eliminación u oposición al uso de tus datos escribiendo a hello@ratetapmx.com. Si eres cliente de un restaurante que usa RateTap, también puedes contactar directamente al restaurante responsable de la relación contigo.',
          ],
        },
      ]}
    />
  );
}
