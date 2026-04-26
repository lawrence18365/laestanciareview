import {
  CATEGORIAS,
  type QuoteConfig,
  type QuoteCategoria,
  computePricing,
  dishById,
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

  type LineItem = { id: string; nombre: string; cantidad: number; includedSideName?: string };

  function asadoItemsPorCat(cat: QuoteCategoria): LineItem[] {
    if (modo !== 'asado') return [];
    const sides = config.asado.parrillaSides ?? {};
    return Object.entries(config.asado.cantidades)
      .map(([id, cantidad]): LineItem | null => {
        const d = dishById(id);
        if (!d || d.categoria !== cat || cantidad <= 0) return null;
        const sideId = sides[id];
        const includedSideName = sideId ? dishById(sideId)?.nombre : undefined;
        return { id, nombre: d.nombre, cantidad, includedSideName };
      })
      .filter((x): x is LineItem => x !== null);
  }

  function cartaItemsPorCat(cat: QuoteCategoria): LineItem[] {
    if (modo !== 'carta') return [];
    const sides = config.carta.parrillaSides ?? {};
    return Object.entries(config.carta.cantidades)
      .map(([id, cantidad]): LineItem | null => {
        const d = dishById(id);
        if (!d || d.categoria !== cat || cantidad <= 0) return null;
        const sideId = sides[id];
        const includedSideName = sideId ? dishById(sideId)?.nombre : undefined;
        return { id, nombre: d.nombre, cantidad, includedSideName };
      })
      .filter((x): x is LineItem => x !== null);
  }

  const tituloMenu =
    modo === 'opciones' ? 'Menú 3 Tiempos'
    : modo === 'asado' ? 'Asado al Centro'
    : modo === 'carta' ? 'Selección a la Carta'
    : 'Menú Individual';

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
          .quote-doc { border: none; padding: 0; }
        }
      `}</style>

      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <img src={logoSrc} alt={restaurantName} style={{ height: 64, width: 'auto', margin: '0 auto 12px', display: 'inline-block' }} />
        <p className="doc-mini">{city} · Eventos privados</p>
      </div>

      <div className="doc-divider" />

      {/* Datos */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 32, fontSize: 14 }}>
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
      <div style={{ marginBottom: 32 }}>
        <h3 className="h-1" style={{ textAlign: 'center', margin: '0 0 24px' }}>{tituloMenu}</h3>

        {modo === 'individual' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
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
            {bebidaPkg && (
              <div style={{ textAlign: 'center' }}>
                <p className="doc-mini" style={{ marginBottom: 8 }}>Bebidas</p>
                <p className="small" style={{ fontWeight: 600, margin: 0 }}>{bebidaPkg.nombre}</p>
                <p className="small text-2" style={{ margin: '4px 0 0' }}>{bebidaPkg.desc}</p>
              </div>
            )}
          </div>
        )}

        {modo === 'opciones' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
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
                      <p className="h-3 num" style={{ margin: 0 }}>{fmtMXN(tier.precio || 0)}</p>
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
            {bebidaPkg && (
              <div style={{ textAlign: 'center' }}>
                <p className="doc-mini" style={{ marginBottom: 8 }}>Bebidas (incluidas)</p>
                <p className="small" style={{ fontWeight: 600, margin: 0 }}>{bebidaPkg.nombre}</p>
                <p className="small text-2" style={{ margin: '4px 0 0' }}>{bebidaPkg.desc}</p>
              </div>
            )}
          </div>
        )}

        {modo === 'asado' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {(['Entradas', 'Parrilla', 'Guarniciones'] as QuoteCategoria[]).map((cat) => {
              const items = asadoItemsPorCat(cat);
              if (!items.length) return null;
              return (
                <div key={cat} style={{ textAlign: 'center' }}>
                  <p className="doc-mini" style={{ marginBottom: 8 }}>{cat}</p>
                  {items.map((item) => (
                    <div key={item.id} style={{ margin: '2px 0' }}>
                      <p className="small" style={{ margin: 0 }}>
                        <span className="num">{item.cantidad}</span> × {item.nombre}
                      </p>
                      {item.includedSideName && (
                        <p className="small text-3" style={{ margin: '2px 0 0', fontStyle: 'italic' }}>
                          ↳ Guarnición: {item.includedSideName} <span style={{ fontStyle: 'normal' }}>(incluida)</span>
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
            {bebidaPkg && (
              <div style={{ textAlign: 'center' }}>
                <p className="doc-mini" style={{ marginBottom: 8 }}>Bebidas</p>
                <p className="small" style={{ fontWeight: 600, margin: 0 }}>{bebidaPkg.nombre}</p>
                <p className="small text-2" style={{ margin: '4px 0 0' }}>{bebidaPkg.desc}</p>
              </div>
            )}
          </div>
        )}

        {modo === 'carta' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {CATEGORIAS.map((cat) => {
              const items = cartaItemsPorCat(cat);
              if (!items.length) return null;
              return (
                <div key={cat} style={{ textAlign: 'center' }}>
                  <p className="doc-mini" style={{ marginBottom: 8 }}>{cat}</p>
                  {items.map((item) => (
                    <div key={item.id} style={{ margin: '2px 0' }}>
                      <p className="small" style={{ margin: 0 }}>
                        {item.cantidad !== evento.personas && <><span className="num">{item.cantidad}</span> × </>}
                        {item.nombre}
                      </p>
                      {item.includedSideName && (
                        <p className="small text-3" style={{ margin: '2px 0 0', fontStyle: 'italic' }}>
                          ↳ Guarnición: {item.includedSideName} <span style={{ fontStyle: 'normal' }}>(incluida)</span>
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
            {bebidaPkg && (
              <div style={{ textAlign: 'center' }}>
                <p className="doc-mini" style={{ marginBottom: 8 }}>Bebidas</p>
                <p className="small" style={{ fontWeight: 600, margin: 0 }}>{bebidaPkg.nombre}</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="doc-divider" />

      {/* Precio */}
      <div style={{ textAlign: 'center', padding: '16px 0' }}>
        <p className="doc-mini" style={{ marginBottom: 8 }}>Inversión</p>
        <p className="price-big num" style={{ margin: 0 }}>{fmtMXN(pricing.precioFinalPP)}</p>
        <p className="small text-2" style={{ margin: '4px 0 0' }}>por persona</p>
        <p className="h-3 num" style={{ marginTop: 16 }}>
          Total {evento.personas} personas · {fmtMXN(pricing.precioTotalFinal)}
        </p>
        <p className="text-3" style={{ fontSize: 12, marginTop: 12 }}>
          {pricing.ivaIncluido && !pricing.servicioActivo && 'Precio incluye IVA 16%'}
          {!pricing.ivaIncluido && pricing.servicioActivo && 'Más 15% servicio + IVA 16%'}
          {!pricing.ivaIncluido && !pricing.servicioActivo && 'Más IVA 16%'}
          {pricing.ivaIncluido && pricing.servicioActivo && 'Incluye IVA 16% y 15% de servicio'}
        </p>
      </div>

      <div className="doc-divider" />

      {/* Términos */}
      <div>
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
      <div style={{ textAlign: 'center' }}>
        <p className="h-3" style={{ marginBottom: 4 }}>{firmaNombre}</p>
        <p className="small text-2" style={{ margin: 0 }}>{firmaCargo}</p>
        <p className="small text-2 num" style={{ margin: 0 }}>{firmaTelefono}</p>
      </div>
    </div>
  );
}
