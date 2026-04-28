import {
  CATEGORIAS,
  TEMPLATES,
  type QuoteConfig,
  type QuoteCategoria,
  computePricing,
  computeTierPricing,
  dishById,
  extraSectionsPP,
  fmtMXN,
  packageById,
} from '@/lib/quote-data';

type Props = {
  config: QuoteConfig;
  folio: string;
  restaurantName?: string;
  city?: string;
  logoSrc?: string;
  firmaNombre?: string;
  firmaCargo?: string;
  firmaTelefono?: string;
};

// Reusable beverage block for Vista Cliente — name in bold, then a bulleted
// list of what's actually included. Replaces the previous one-line desc
// paragraph; customers were sending follow-up "¿qué incluye?" questions
// because "Paquete Básico" alone meant nothing to them.
function BebidasBlock({
  pkg,
  label = 'Bebidas',
}: {
  pkg: { nombre: string; bullets: string[]; desc: string };
  label?: string;
}) {
  return (
    <div style={{ textAlign: 'center' }}>
      <p className="doc-mini" style={{ marginBottom: 8 }}>{label}</p>
      <p className="small" style={{ fontWeight: 600, margin: 0 }}>{pkg.nombre}</p>
      {pkg.bullets && pkg.bullets.length > 0 ? (
        <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0' }}>
          {pkg.bullets.map((b, i) => (
            <li
              key={i}
              className="small text-3"
              style={{ margin: '2px 0', fontStyle: 'italic' }}
            >
              • {b}
            </li>
          ))}
        </ul>
      ) : (
        <p className="small text-2" style={{ margin: '4px 0 0' }}>{pkg.desc}</p>
      )}
    </div>
  );
}

function formatFecha(fecha: string): string {
  if (!fecha) return '—';
  try {
    const d = new Date(fecha + 'T12:00:00');
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return fecha;
  }
}

export default function QuotePreview({
  config,
  folio,
  restaurantName = 'La Estancia Argentina',
  city = 'León, Guanajuato',
  logoSrc = '/logos/grupo-estancia.png',
  firmaNombre = 'Guillermo Padilla',
  firmaCargo = 'Gerente General · La Estancia Argentina León',
  firmaTelefono = '33 11 47 90 86',
}: Props) {
  const { modo, evento } = config;
  const pricing = computePricing(config);
  const bebidaPkg = packageById(
    modo === 'individual' ? config.indiv.bebidas
    : modo === 'opciones' ? config.opciones.bebidas
    : modo === 'asado' ? config.asado.bebidas
    : config.carta.bebidas,
  );

  const indivSopasDishes = modo === 'individual' ? config.indiv.sopas.map(dishById).filter(Boolean) : [];
  const indivPlatosDishes = modo === 'individual' ? config.indiv.platos.map(dishById).filter(Boolean) : [];
  const indivPostresDishes = modo === 'individual' ? config.indiv.postres.map(dishById).filter(Boolean) : [];

  const opcionesSopasDishes = modo === 'opciones' ? config.opciones.sopas.map(dishById).filter(Boolean) : [];
  const opcionesPostresDishes = modo === 'opciones' ? config.opciones.postres.map(dishById).filter(Boolean) : [];

  // Template-level "shared sides" applies to bundle products like Asado al
  // Centro: guarniciones in cantidades are part of the bundle price and
  // should render as "(incluida)" instead of as separate paid line items.
  // Premium guarniciones (includedEligible: false) keep paid styling even
  // here — Espárragos and Tuétano always bill, by design.
  const template = config.templateId
    ? TEMPLATES.find((t) => t.id === config.templateId)
    : undefined;
  const sharedSides = template?.sharedSides;

  type LineItem = {
    id: string;
    nombre: string;
    cantidad: number;
    includedSideName?: string; // carta per-cut nested side
    sharedIncluded?: boolean;  // asado bundle "(incluida)" tag
    variants?: string[];       // selected fillings/sauces for this dish
  };

  function asadoItemsPorCat(cat: QuoteCategoria): LineItem[] {
    if (modo !== 'asado') return [];
    const variantsMap = config.asado.dishVariants ?? {};
    return Object.entries(config.asado.cantidades)
      .map(([id, cantidad]): LineItem | null => {
        const d = dishById(id);
        if (!d || d.categoria !== cat || cantidad <= 0) return null;
        const sharedIncluded = !!(
          sharedSides &&
          d.categoria === 'Guarniciones' &&
          d.includedEligible !== false
        );
        const v = variantsMap[id];
        const variants = v && v.length > 0 ? v : undefined;
        return { id, nombre: d.nombre, cantidad, sharedIncluded, variants };
      })
      .filter((x): x is LineItem => x !== null);
  }

  function cartaItemsPorCat(cat: QuoteCategoria): LineItem[] {
    if (modo !== 'carta') return [];
    const sides = config.carta.parrillaSides ?? {};
    const variantsMap = config.carta.dishVariants ?? {};
    return Object.entries(config.carta.cantidades)
      .map(([id, cantidad]): LineItem | null => {
        const d = dishById(id);
        if (!d || d.categoria !== cat || cantidad <= 0) return null;
        const sideId = sides[id];
        const includedSideName = sideId ? dishById(sideId)?.nombre : undefined;
        const v = variantsMap[id];
        const variants = v && v.length > 0 ? v : undefined;
        return { id, nombre: d.nombre, cantidad, includedSideName, variants };
      })
      .filter((x): x is LineItem => x !== null);
  }

  const tituloMenu =
    modo === 'opciones' ? 'Menú 3 Tiempos'
    : modo === 'asado' ? 'Asado al Centro'
    : modo === 'carta' ? 'Selección a la Carta'
    : 'Menú Individual';

  // Sections render at the top of the menu (brindis pattern). For opciones
  // mode, the section's per-pp price is embedded into the per-tier figure
  // shown to the customer — they should see one final number per option,
  // not "Opción A $1,050 + Brindis $700".
  const sections = (config.extraSections ?? []).filter(
    (s) => s.nombre.trim() || s.descripcion.trim(),
  );
  const tierExtraEmbedded = modo === 'opciones' ? extraSectionsPP(config) : 0;

  return (
    <div className="quote-doc">
      <style>{`
        .quote-doc {
          background: #fff;
          border: 1px solid #E8E3D8;
          border-radius: 12px;
          padding: 56px 48px;
          font-family: 'Manrope', system-ui, sans-serif;
          color: #0A0A0A;
          line-height: 1.5;
          -webkit-font-smoothing: antialiased;
        }
        .quote-doc .serif { font-family: 'Playfair Display', Georgia, serif; }
        .quote-doc .num { font-feature-settings: 'tnum'; font-variant-numeric: tabular-nums; }
        .quote-doc .doc-divider { height: 1px; background: #E8E3D8; margin: 32px 0; }
        .quote-doc .doc-mini {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #A3A3A3;
        }
        .quote-doc .h-1 {
          font-family: 'Playfair Display', serif;
          font-size: 24px;
          font-weight: 600;
          letter-spacing: -0.015em;
          line-height: 1.2;
        }
        .quote-doc .h-3 {
          font-size: 14px;
          font-weight: 600;
          letter-spacing: -0.005em;
        }
        .quote-doc .small { font-size: 13px; font-weight: 400; }
        .quote-doc .text-2 { color: #525252; }
        .quote-doc .text-3 { color: #A3A3A3; }
        .quote-doc .price-big {
          font-family: 'Playfair Display', serif;
          font-size: 48px;
          font-weight: 700;
          letter-spacing: -0.03em;
          line-height: 1;
        }
        @media (max-width: 640px) {
          .quote-doc { padding: 32px 24px; }
          .quote-doc .price-big { font-size: 36px; }
        }
        @media print {
          /* Tighten everything so a typical event cotización fits on a
             single A4/Letter sheet — Leslie's PDFs were spilling onto a
             second page that was 70% empty. */
          .quote-doc { border: none; padding: 0; font-size: 12px; line-height: 1.4; }
          .quote-doc .doc-divider { margin: 12px 0; }
          .quote-doc .doc-mini { font-size: 9px; }
          .quote-doc .h-1 { font-size: 18px; line-height: 1.15; }
          .quote-doc .h-3 { font-size: 12px; }
          .quote-doc .small { font-size: 11px; }
          .quote-doc .price-big { font-size: 32px; }
          .quote-doc .qp-header { margin-bottom: 14px !important; }
          .quote-doc .qp-header img { height: 44px !important; margin-bottom: 4px !important; }
          .quote-doc .qp-datos { gap: 12px !important; margin-bottom: 14px !important; font-size: 12px !important; }
          .quote-doc .qp-menu { margin-bottom: 14px !important; }
          .quote-doc .qp-menu .qp-menu-title { margin: 0 0 12px !important; }
          .quote-doc .qp-menu-stack { gap: 12px !important; }
          .quote-doc .qp-precio { padding: 6px 0 !important; }
          .quote-doc .qp-precio .qp-precio-pp { margin-bottom: 4px !important; }
          .quote-doc .qp-precio .qp-precio-total { margin-top: 8px !important; }
          .quote-doc .qp-precio .qp-precio-tax { margin-top: 6px !important; }
          .quote-doc .qp-terms ol { line-height: 1.45 !important; padding-left: 14px !important; }
          .quote-doc .qp-terms ol li { margin-bottom: 2px !important; }
          .quote-doc .qp-firma .h-3 { margin-bottom: 2px !important; }
          /* Avoid awkward page splits inside core blocks */
          .quote-doc .qp-precio,
          .quote-doc .qp-firma,
          .quote-doc .qp-terms { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      {/* Header */}
      <div className="qp-header" style={{ textAlign: 'center', marginBottom: 32 }}>
        <img src={logoSrc} alt={restaurantName} style={{ height: 64, width: 'auto', margin: '0 auto 12px', display: 'inline-block' }} />
        <p className="doc-mini">{city} · Eventos privados</p>
      </div>

      <div className="doc-divider" />

      {/* Datos */}
      <div className="qp-datos" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 32, fontSize: 14 }}>
        <div>
          <p className="doc-mini" style={{ marginBottom: 6 }}>Cliente</p>
          <p style={{ fontWeight: 600, margin: 0 }}>{evento.cliente || '—'}</p>
          {evento.telefono && <p className="text-2" style={{ fontSize: 12, marginTop: 2 }}>{evento.telefono}</p>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <p className="doc-mini" style={{ marginBottom: 6 }}>Cotización</p>
          <p className="num" style={{ fontWeight: 600, margin: 0 }}>{folio}</p>
          <p className="text-2" style={{ fontSize: 12, marginTop: 2 }}>
            {new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div>
          <p className="doc-mini" style={{ marginBottom: 6 }}>Evento</p>
          <p style={{ fontWeight: 600, margin: 0 }}>{evento.tipo}</p>
          <p className="text-2" style={{ fontSize: 12, marginTop: 2 }}>
            {evento.fecha ? formatFecha(evento.fecha) + (evento.hora ? ' · ' + evento.hora : '') : '—'}
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p className="doc-mini" style={{ marginBottom: 6 }}>Personas</p>
          <p className="num" style={{ fontWeight: 600, margin: 0 }}>{evento.personas}</p>
        </div>
      </div>

      <div className="doc-divider" />

      {/* Menú */}
      <div className="qp-menu" style={{ marginBottom: 32 }}>
        <h3 className="h-1 qp-menu-title" style={{ textAlign: 'center', margin: '0 0 24px' }}>{tituloMenu}</h3>

        {sections.length > 0 && (
          <div className="qp-menu-stack" style={{ display: 'flex', flexDirection: 'column', gap: 24, marginBottom: 24 }}>
            {sections.map((sec) => (
              <div key={sec.id} style={{ textAlign: 'center' }}>
                <p className="doc-mini" style={{ marginBottom: 8 }}>{sec.nombre.trim() || 'Sección'}</p>
                {sec.descripcion.trim() && (
                  <p className="small" style={{ margin: 0, whiteSpace: 'pre-line', lineHeight: 1.6 }}>
                    {sec.descripcion.trim()}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {modo === 'individual' && (
          <div className="qp-menu-stack" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {indivSopasDishes.length > 0 && (
              <div style={{ textAlign: 'center' }}>
                <p className="doc-mini" style={{ marginBottom: 8 }}>1° Tiempo · A elegir 1</p>
                {indivSopasDishes.map((d) => (
                  <p key={d!.id} className="small" style={{ margin: '2px 0' }}>{d!.nombre}</p>
                ))}
              </div>
            )}
            {indivPlatosDishes.length > 0 && (
              <div style={{ textAlign: 'center' }}>
                <p className="doc-mini" style={{ marginBottom: 8 }}>2° Tiempo · Plato Fuerte · A elegir 1</p>
                {indivPlatosDishes.map((d) => (
                  <p key={d!.id} className="small" style={{ margin: '2px 0' }}>{d!.nombre}</p>
                ))}
              </div>
            )}
            {indivPostresDishes.length > 0 && (
              <div style={{ textAlign: 'center' }}>
                <p className="doc-mini" style={{ marginBottom: 8 }}>3° Tiempo · Postre · A elegir 1</p>
                {indivPostresDishes.map((d) => (
                  <p key={d!.id} className="small" style={{ margin: '2px 0' }}>{d!.nombre}</p>
                ))}
              </div>
            )}
            {bebidaPkg && <BebidasBlock pkg={bebidaPkg} />}
          </div>
        )}

        {modo === 'opciones' && (
          <div className="qp-menu-stack" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {opcionesSopasDishes.length > 0 && (
              <div style={{ textAlign: 'center' }}>
                <p className="doc-mini" style={{ marginBottom: 8 }}>1° Tiempo · A elegir 1</p>
                {opcionesSopasDishes.map((d) => (
                  <p key={d!.id} className="small" style={{ margin: '2px 0' }}>{d!.nombre}</p>
                ))}
              </div>
            )}
            <div>
              <p className="doc-mini" style={{ textAlign: 'center', marginBottom: 12 }}>2° Tiempo · Plato Fuerte · A elegir 1</p>
              {config.opciones.tiers.map((tier) => (
                tier.platos.trim() ? (
                  <div key={tier.letra} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #E8E3D8' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                      <p className="h-3" style={{ margin: 0 }}>Opción {tier.letra}</p>
                      <p className="h-3 num" style={{ margin: 0 }}>{fmtMXN((tier.precio || 0) + tierExtraEmbedded)}</p>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      {tier.platos.split('\n').filter((l) => l.trim()).map((linea, i) => (
                        <p key={i} className="small" style={{ margin: '2px 0' }}>{linea}</p>
                      ))}
                    </div>
                  </div>
                ) : null
              ))}
            </div>
            {opcionesPostresDishes.length > 0 && (
              <div style={{ textAlign: 'center' }}>
                <p className="doc-mini" style={{ marginBottom: 8 }}>3° Tiempo · Postre · A elegir 1</p>
                {opcionesPostresDishes.map((d) => (
                  <p key={d!.id} className="small" style={{ margin: '2px 0' }}>{d!.nombre}</p>
                ))}
              </div>
            )}
            {bebidaPkg && <BebidasBlock pkg={bebidaPkg} label="Bebidas (incluidas)" />}
          </div>
        )}

        {modo === 'asado' && (
          <div className="qp-menu-stack" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {(['Entradas', 'Parrilla', 'Guarniciones'] as QuoteCategoria[]).map((cat) => {
              const items = asadoItemsPorCat(cat);
              if (!items.length) return null;
              return (
                <div key={cat} style={{ textAlign: 'center' }}>
                  <p className="doc-mini" style={{ marginBottom: 8 }}>{cat}</p>
                  {items.map((item) => {
                    // When qty matches headcount, the customer naturally
                    // reads it as "1 per guest" — surface that explicitly
                    // so they don't have to do mental math. Skip the tag
                    // when the line is already labeled "(incluida)" to
                    // avoid double-tagging.
                    const showPerPersonTag =
                      !item.sharedIncluded && item.cantidad === evento.personas;
                    return (
                      <div key={item.id} style={{ margin: '2px 0' }}>
                        <p className="small" style={{ margin: 0 }}>
                          <span className="num">{item.cantidad}</span> × {item.nombre}
                          {showPerPersonTag && (
                            <span className="text-3" style={{ fontStyle: 'italic', marginLeft: 8 }}>(1 por persona)</span>
                          )}
                          {item.sharedIncluded && (
                            <span className="text-3" style={{ fontStyle: 'italic', marginLeft: 8 }}>(incluida)</span>
                          )}
                        </p>
                        {item.variants && (
                          <p className="small text-3" style={{ margin: '2px 0 0', fontStyle: 'italic' }}>
                            → Sabores: {item.variants.join(', ')}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {bebidaPkg && <BebidasBlock pkg={bebidaPkg} />}
          </div>
        )}

        {modo === 'carta' && (
          <div className="qp-menu-stack" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {CATEGORIAS.map((cat) => {
              const items = cartaItemsPorCat(cat);
              if (!items.length) return null;
              return (
                <div key={cat} style={{ textAlign: 'center' }}>
                  <p className="doc-mini" style={{ marginBottom: 8 }}>{cat}</p>
                  {items.map((item) => {
                    const isPerPerson = item.cantidad === evento.personas;
                    return (
                      <div key={item.id} style={{ margin: '2px 0' }}>
                        <p className="small" style={{ margin: 0 }}>
                          <span className="num">{item.cantidad}</span> × {item.nombre}
                          {isPerPerson && (
                            <span className="text-3" style={{ fontStyle: 'italic', marginLeft: 8 }}>(1 por persona)</span>
                          )}
                        </p>
                        {item.variants && (
                          <p className="small text-3" style={{ margin: '2px 0 0', fontStyle: 'italic' }}>
                            → Sabores: {item.variants.join(', ')}
                          </p>
                        )}
                        {item.includedSideName && (
                          <p className="small text-3" style={{ margin: '2px 0 0', fontStyle: 'italic' }}>
                            → Guarnición: {item.includedSideName} <span style={{ fontStyle: 'normal' }}>(incluida)</span>
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {bebidaPkg && <BebidasBlock pkg={bebidaPkg} />}
          </div>
        )}
      </div>

      <div className="doc-divider" />

      {/* Precio */}
      {(() => {
        const taxNote =
          pricing.ivaIncluido && !pricing.servicioActivo ? 'Precio incluye IVA 16%' :
          !pricing.ivaIncluido && pricing.servicioActivo ? 'Más 15% servicio + IVA 16%' :
          !pricing.ivaIncluido && !pricing.servicioActivo ? 'Más IVA 16%' :
          'Incluye IVA 16% y 15% de servicio';

        // Opciones mode shows one row per tier — A/B/C have different cuts
        // and different prices, and the customer hasn't chosen yet, so the
        // averaged single price was misleading ($1,450 for an A=$1,400 /
        // B=$1,550 / C=$1,700 menu read as a flat price they were never
        // actually offered). Fall back to the single-price block for
        // individual / asado / carta where there's a real flat price.
        if (modo === 'opciones') {
          const tiers = computeTierPricing(config);
          if (tiers.length === 0) {
            // No tier has a price set yet — render a placeholder so the
            // layout doesn't collapse mid-edit.
            return (
              <div className="qp-precio" style={{ textAlign: 'center', padding: '16px 0' }}>
                <p className="doc-mini qp-precio-pp" style={{ marginBottom: 8 }}>Inversión por persona</p>
                <p className="text-3 small" style={{ margin: 0 }}>Define el precio de cada opción para verlo aquí</p>
              </div>
            );
          }
          return (
            <div className="qp-precio" style={{ padding: '16px 0' }}>
              <p className="doc-mini qp-precio-pp" style={{ marginBottom: 12, textAlign: 'center' }}>Inversión por persona</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
                {tiers.map((t) => (
                  <div
                    key={t.letra}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      padding: '6px 0',
                      borderBottom: '1px solid #F3EFE6',
                    }}
                  >
                    <span className="h-3" style={{ margin: 0 }}>Opción {t.letra}</span>
                    <span className="h-3 num" style={{ margin: 0 }}>{fmtMXN(t.pricePP)}</span>
                  </div>
                ))}
              </div>
              <p className="doc-mini qp-precio-total" style={{ marginBottom: 12, textAlign: 'center' }}>
                Total estimado · {evento.personas} personas
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {tiers.map((t) => (
                  <div
                    key={t.letra}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      padding: '6px 0',
                      borderBottom: '1px solid #F3EFE6',
                    }}
                  >
                    <span className="small text-2" style={{ margin: 0 }}>Opción {t.letra}</span>
                    <span className="small num" style={{ margin: 0, fontWeight: 600 }}>{fmtMXN(t.total)}</span>
                  </div>
                ))}
              </div>
              <p className="text-3 qp-precio-tax" style={{ fontSize: 12, marginTop: 12, textAlign: 'center' }}>{taxNote}</p>
            </div>
          );
        }

        // Single-price flow (individual / asado / carta) — unchanged.
        return (
          <div className="qp-precio" style={{ textAlign: 'center', padding: '16px 0' }}>
            <p className="doc-mini qp-precio-pp" style={{ marginBottom: 8 }}>Inversión</p>
            <p className="price-big num" style={{ margin: 0 }}>{fmtMXN(pricing.precioFinalPP)}</p>
            <p className="small text-2" style={{ margin: '4px 0 0' }}>por persona</p>
            <p className="h-3 num qp-precio-total" style={{ marginTop: 16 }}>
              Total {evento.personas} personas · {fmtMXN(pricing.precioTotalFinal)}
            </p>
            <p className="text-3 qp-precio-tax" style={{ fontSize: 12, marginTop: 12 }}>{taxNote}</p>
          </div>
        );
      })()}

      <div className="doc-divider" />

      {/* Términos */}
      <div className="qp-terms">
        <p className="doc-mini" style={{ marginBottom: 12 }}>Términos y condiciones</p>
        <ol className="small text-2" style={{ paddingLeft: 16, margin: 0, lineHeight: 1.7 }}>
          {(config.terms ?? '')
            .split('\n')
            .map((l) => l.replace(/^\d+\.\s*/, '').trim())
            .filter(Boolean)
            .map((line, i) => (
              <li key={i} style={{ marginBottom: 6 }}>{line}</li>
            ))}
        </ol>
      </div>

      <div className="doc-divider" />

      {/* Firma */}
      <div className="qp-firma" style={{ textAlign: 'center' }}>
        <p className="h-3" style={{ marginBottom: 4 }}>{firmaNombre}</p>
        <p className="small text-2" style={{ margin: 0 }}>{firmaCargo}</p>
        <p className="small text-2 num" style={{ margin: 0 }}>{firmaTelefono}</p>
      </div>
    </div>
  );
}
