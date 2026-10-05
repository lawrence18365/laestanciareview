# Informe semanal de cocina

## Activación

Desactivado por defecto. Tests y revisión no equivalen a despliegue ni entrega. El líder autoriza y ejecuta despliegue, configuración, importación y envíos. El implementador no escribe el ledger de producción ni usa SMTP real.

Gate: revisión independiente del commit, integración y checks; revisión privada de ambos cortes; aprobación de producción; importación de pruebas de envíos anteriores; verificación de alias, autenticación, skips repetidos y próximo período. SMTP aceptado no demuestra llegada al inbox ni lectura. No prometer entrega «perfecta» cuando existen estados inciertos.

## Configuración protegida

- `CHEF_REPORT_ENABLED`: solo `true` habilita producción. Deshabilitado: cero acceso DB/SMTP.
- `CHEF_REPORT_EMAILS`: dueño y chef, lista separada por comas, máximo dos destinatarios únicos. Normaliza minúsculas y deduplica. Rechaza direcciones inválidas, encabezados, listas vacías y CR/LF.
- `CHEF_REPORT_EMAIL`: compatibilidad con un destinatario antiguo. Si también hay lista, debe coincidir exactamente con su único destinatario; una lista de dos con singleton presente falla. Eliminar el singleton al configurar ambos roles.
- `CHEF_REPORT_PREVIEW_EMAILS`: allowlist interna explícitamente autorizada. Todos los destinatarios reales quedan excluidos de preview, incluso allowlisted. Máximo dos previews por ejecución.
- `CHEF_REPORT_REPLY_TO`: mailbox validado; predeterminado `hello@ratetapmx.com`. El mailto de área completa y replyTo usan el mismo destino; el asunto incluye la semana, codificado.
- `DATABASE_URL`, `SMTP_USER`, `SMTP_PASS`: secretos existentes. Opcionales existentes: `SMTP_HOST`, `SMTP_PORT`, `EMAIL_FROM`. No registrar secretos ni direcciones privadas en código.

## Calendario y reintentos

`/api/cron/chef-weekly-report`, diario `0 14 * * *` UTC (08:00 CDMX). El primer envío de cada semana completa es nominalmente lunes 14 UTC; dispararlo antes no envía. Vercel puede ejecutar con jitter: no es una garantía al minuto. Bearer exacto `CRON_SECRET`; ningún query parameter aceptado.

Períodos lunes–domingo completos en `America/Mexico_City`, exactamente 12 unidades del exporter. El sweep visita como máximo las dos últimas semanas completas y dos destinatarios por período. Para la semana anterior solo procesa fingerprints existentes: no inicia envíos históricos ausentes. Los aceptados se omiten antes de renderizar. Un fallo de un destinatario no bloquea al otro.

Cada fingerprint estable combina namespace live/preview, semana y hash de destinatario. Una conexión toma advisory lock, lee y confirma reserva `attempted` **antes** de SMTP. Sin migración: evento `chef_report_delivery` en `product_events`; sin comentarios, nombres o dirección del destinatario. MessageId es evidencia SMTP, no identidad de cliente.

- `sent`: aceptación explícita del destinatario y messageId; nunca reintentar.
- `failed`, `retryable=true`: solo error positivamente conocido pre-SMTP o rechazo de destinatario sin aceptación. Backoff mínimo 20 horas, máximo tres intentos por fingerprint, dentro de las dos semanas recientes.
- `unknown`: timeout, respuesta ambigua, falta de messageId o fallo de finalización. Nunca reintentar automáticamente.
- `attempted`: reserva persistente, posible interrupción. Nunca reintentar automáticamente.
- Fallos antiguos sin prueba `retryable=true` tampoco se reintentan.

SMTP de chef usa transporte separado, deadline 8 segundos y cierre; no lanza append IMAP desacoplado. Genera un único Message-ID RFC antes de MailComposer: mismo ID en header MIME, opciones SMTP, resultado y ledger, aunque el proveedor devuelva otro ID. Los callers antiguos conservan transporte, IDs por defecto y append originales. Sweep con presupuesto 45 segundos, comprobaciones antes de envío, queries/conexiones acotadas y ruta Node de 60 segundos; agotamiento difiere trabajo sin reserva/SMTP. Los fallos o incertidumbre aparecen con hashes/códigos sanitizados y devuelven 502; configuración/consulta global 500, autenticación 401. No se pasan errores crudos a logs.

Operaciones: inspeccionar ledger y prueba del proveedor con acceso autorizado. En `unknown`/`attempted`, no borrar reservas ni reenviar por intuición. Confirmar aceptación o no aceptación y solicitar decisión explícita. El CLI no ofrece `--force`, envío live ni bypass del ledger. Un `failed` agotado o fuera de ventana necesita la misma revisión operativa.

## CLI

Desde `platform`, entorno protegido o `.env.local`:

```sh
# SELECT solamente; sin SMTP ni ledger writes.
npx tsx scripts/chef-weekly-report.ts
npx tsx scripts/chef-weekly-report.ts --week-start 2026-09-21

# Solo después de autorización de inbox interno; dirección ficticia.
npx tsx scripts/chef-weekly-report.ts --week-start 2026-09-28 --send-preview --preview-to internal@example.test

# Privilegiado: importar evidencia auditada, NO SMTP.
npx tsx scripts/chef-weekly-report.ts --import-manual-sends --audit-file /protected/manual-sends.json
```

Dry-run predeterminado; guarda HTML/texto/CSV privados en `data/chef-exports/`, archivos 0600. Preview y live comparten renderer/adjuntos; cambia destinatario y prefijo del asunto. No usar CSV del exporter histórico como adjunto automático: mantiene su API/formato manual con columna de mesero.

### Prueba de importación

El flag de importación y audit file son obligatorios juntos, incompatibles con preview, dry-run o week overrides. Solo operador autorizado local; ninguna ruta HTTP lo expone. Archivo fuera de Git, máximo cuatro pruebas, esquema:

```json
{
  "version": 1,
  "deliveries": [{
    "namespace": "live",
    "source": "manual_smtp",
    "status": "smtp-accepted",
    "to": "chef@example.test",
    "weekStart": "2026-09-28",
    "messageId": "<actual-wire-message-id@example.test>",
    "acceptedAt": "2026-10-05T13:00:00Z",
    "evidenceSource": "sent_archive_observation",
    "archiveObservedAt": "2026-10-05T13:00:00Z"
  }]
}
```

Ejemplo ficticio, no autorización ni prueba real. Exige destinatario configurado, lunes completo, Message-ID real del MIME enviado (no un ID diferente devuelto por el helper) y timestamp UTC posterior al cierre del período y no futuro. `evidenceSource` y `archiveObservedAt` son opcionales juntos para compatibilidad con versión 1. En modo `sent_archive_observation`, ambos timestamps deben ser idénticos: `acceptedAt` registra la observación del archivo Sent posterior a aceptación, **no** la hora exacta del relay, recepción en inbox o lectura. Mantener la evidencia privada que acredita esa aceptación; un archivo Sent por sí solo no prueba recepción. El líder conserva las cuatro pruebas verificadas y sus wire IDs únicos.

Rechaza preview, estados no aceptados, destinatarios externos y duplicados. Batch transaccional con locks ordenados: contradicción aborta todo. Idempotencia solo para prueba idéntica ya importada, incluidos los campos de procedencia; no sobrescribe `unknown`, `attempted`, otro source ni evidencia diferente. Registra `source=manual_smtp_import`, no historia automática ficticia. Después, live debe omitir esos fingerprints en triggers repetidos.

## Contenido y privacidad

Totales de comentarios capturados: no visitas, escaneos ni reseñas Google. `captured` cuenta todos los comentarios no vacíos de la semana y las 12 unidades; la cobertura suma ese total. `kitchen` cuenta registros con al menos una señal culinaria automática; `unclassified = captured - kitchen` cuenta registros sin señal. Sin clasificar **no** significa positivo ni ausencia de problemas. No hay withholding por nombres ni métrica «retenidos».

La consulta automática no selecciona nombre, correo o contacto de clientes/meseros ni consulta la tabla staff. El texto privado se clasifica internamente con reglas culinarias acotadas; no cambia el clasificador global. La autoridad pública es `PublicKitchenRow`: únicamente unidad de una lista constante, fecha calendario CDMX validada, calificación entera 1–5 y enums `KitchenSignalId` finitos. Reconstrucción explícita, sin spread del modelo privado. IDs desconocidos fallan con error genérico, sin eco. Todas las descripciones salen de `KITCHEN_SIGNALS`, nunca de capturas regex, nombres o platos libres; ambigüedad no tiene fallback de texto. No publicar texto crudo ni redactado en HTML, texto, DTO, ambos CSV, logs/eventos o adjuntos automáticos.

Sistema visual RateTap existente, hasta ocho registros: preocupaciones y sugerencias antes de valoraciones culinarias positivas; secciones separadas. Son observaciones automáticas, no causas verificadas ni lectura completa. «Fragmentos duros reportados» no infiere qué material era ni su causa. Estrellas no descartan problemas; no inferir recurrencia, culpabilidad ni acciones de personal.

Ambos CSV usan solo `unidad,fecha,calificacion,observaciones_automaticas`. El completo incluye todos los registros; sin señales usa el valor fijo «Sin señal culinaria automática». Cocina es el subconjunto con señales. Sin columna comentario, quote o mesero; sin texto original. Los comentarios completos requieren **otro seguimiento privado, revisado por una persona**, usando el exporter manual histórico compatible. Ese export nunca se adjunta automáticamente. Sin nueva web de aprobación, LLM, proveedor o esquema DB.

El clasificador automático pertenece al módulo de cocina: no importa ni usa `analyzeFeedbackText` o polaridad global. Mantiene contexto culinario corto y negación acotada. Las preocupaciones específicas prevalecen sobre elogios genéricos, incluso entre cláusulas. Asado demasiado rojo y crema de espinaca con falta de sabor tienen señales finitas propias; el exporter manual conserva su helper histórico.

Regresiones: canarios arbitrarios de nombres/contactos/markup/instrucciones ausentes de DTO/HTML/texto/ambos CSV/logs/eventos; descripciones derivadas del diccionario; metadata/CSV por registro; gramática de roles conserva sopa fría; ID SMTP igual en MIME/opciones/resultado/ledger. El control negativo de privacidad introduce deliberadamente texto privado en la fila pública y debe fallar antes de restauración. Compatibilidad: once keys reales auditados solo en evidencia privada SELECT-only contra dependencias publicadas y actuales, nunca fixtures en Git. Restaurar temporalmente la dependencia global debe fallar los dos contraejemplos de compatibilidad; el helper lanzando error o invirtiendo polaridad no debe cambiar la clasificación final.
