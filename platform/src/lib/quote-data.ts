// Data definitions for the La Estancia quote builder.
//
// The builder has four operating "modes" that share a common client/event
// section. Each mode stores its own state shape. The full form state is
// persisted as JSONB on `quotes.config_json` and derived values
// (precioFinalPP, precioTotalFinal) are mirrored to the legacy columns
// so the list view keeps working.

export type QuoteCategoria =
  | 'Entradas'
  | 'Sopas'
  | 'Ensaladas'
  | 'Pastas'
  | 'Parrilla'
  | 'Del Mar'
  | 'Guarniciones'
  | 'Postres';

export type QuoteDish = {
  id: string;
  categoria: QuoteCategoria;
  nombre: string;
  peso?: string;
  precio: number;
  desc?: string;
  tag?: string;
  // When true, `precio` is per-person and the effective cost is
  // precio × personas × qty. Used for items like Pastel Personalizado
  // priced at $20/pp and shared across the group.
  perPerson?: boolean;
  // Guarniciones only. When false, the side cannot be chosen as a Parrilla
  // cut's "included" side — Espárragos and Tuétano always bill separately.
  // Defaults to true via `?? true`; only premium sides set this to false.
  includedEligible?: boolean;
  // Selectable variants/fillings (e.g. empanada flavors, pasta sauces).
  // When set, the Constructor exposes a chip multi-selector under the dish
  // row and Vista Cliente renders the picked subset as a sub-line. Leave
  // unset for dishes without meaningful variant choices.
  variants?: string[];
};

export const CATEGORIAS: QuoteCategoria[] = [
  'Entradas',
  'Sopas',
  'Ensaladas',
  'Pastas',
  'Parrilla',
  'Del Mar',
  'Guarniciones',
  'Postres',
];

export const MENU: QuoteDish[] = [
  // Entradas
  { id: 'e1', categoria: 'Entradas', nombre: 'Empanadas', peso: '60g c/u', precio: 110, desc: 'Carne, queso, humita, salmón, siciliana, espinaca, queso azul o chistorra', variants: ['Carne', 'Queso', 'Humita', 'Salmón', 'Siciliana', 'Espinaca', 'Queso azul', 'Chistorra'] },
  { id: 'e2', categoria: 'Entradas', nombre: 'Queso Fundido', peso: '220g', precio: 150 },
  { id: 'e3', categoria: 'Entradas', nombre: 'Queso Fundido con Chistorra', peso: '100g', precio: 175 },
  { id: 'e4', categoria: 'Entradas', nombre: 'Queso Fundido con Chorizo Argentino', peso: '75g', precio: 175 },
  { id: 'e5', categoria: 'Entradas', nombre: 'Camarones con Champiñones al Ajillo', peso: '180g', precio: 380 },
  { id: 'e6', categoria: 'Entradas', nombre: 'Chorizo Argentino', peso: '160g', precio: 150 },
  { id: 'e7', categoria: 'Entradas', nombre: 'Chistorra', peso: '200g', precio: 175 },
  { id: 'e8', categoria: 'Entradas', nombre: 'Chicharrón Rib-Eye', peso: '220g', precio: 375, desc: 'Acompañado de guacamole y pico de gallo' },
  { id: 'e9', categoria: 'Entradas', nombre: 'Mollejas de Ternera', peso: '350g', precio: 275 },
  { id: 'e10', categoria: 'Entradas', nombre: 'Queso Provoleta', peso: '160g', precio: 175 },
  { id: 'e11', categoria: 'Entradas', nombre: 'Provoleta Estancia', peso: '160g', precio: 195 },
  { id: 'e12', categoria: 'Entradas', nombre: 'Carpaccio de Salmón Ahumado', peso: '150g', precio: 275 },
  { id: 'e13', categoria: 'Entradas', nombre: 'Tártara de Atún', peso: '150g', precio: 240 },
  { id: 'e14', categoria: 'Entradas', nombre: 'Burrata Rústica', peso: '130g', precio: 320 },
  { id: 'e15', categoria: 'Entradas', nombre: 'Tiradito de Camarón y Pulpo', peso: '200g', precio: 275 },
  { id: 'e16', categoria: 'Entradas', nombre: 'Jamón Ibérico 5 Jotas', peso: '40g', precio: 600, tag: 'Premium' },
  { id: 'e17', categoria: 'Entradas', nombre: 'Jamón Ibérico 5 Jotas', peso: '80g', precio: 1200, tag: 'Premium' },

  // Sopas
  { id: 's1', categoria: 'Sopas', nombre: 'Jugo de Carne', peso: '240ml', precio: 160 },
  { id: 's2', categoria: 'Sopas', nombre: 'Jugo de Carne con Ostión', peso: '240ml/50g', precio: 170 },
  { id: 's3', categoria: 'Sopas', nombre: 'Jugo de Carne con Camarón', peso: '240ml/60g', precio: 210 },
  { id: 's4', categoria: 'Sopas', nombre: 'Sopa Estancia', peso: '240ml', precio: 120 },
  { id: 's5', categoria: 'Sopas', nombre: 'Sopa de Cebolla', peso: '240ml', precio: 140 },
  { id: 's6', categoria: 'Sopas', nombre: 'Crema de Tomate Rostizado', peso: '240ml', precio: 150 },
  { id: 's7', categoria: 'Sopas', nombre: 'Crema de Alcachofa', peso: '240ml', precio: 150 },
  { id: 's8', categoria: 'Sopas', nombre: 'Crema de Papa con Jamón Ibérico', peso: '240ml', precio: 180, desc: 'Especial para eventos' },

  // Ensaladas
  { id: 'en1', categoria: 'Ensaladas', nombre: 'Mixta', precio: 120 },
  { id: 'en2', categoria: 'Ensaladas', nombre: 'Santelmo', precio: 175 },
  { id: 'en3', categoria: 'Ensaladas', nombre: 'Falsa Nicoise', precio: 175 },
  { id: 'en4', categoria: 'Ensaladas', nombre: 'Capresse', precio: 175 },
  { id: 'en5', categoria: 'Ensaladas', nombre: 'César', precio: 175, desc: 'Preparada en su mesa' },
  { id: 'en6', categoria: 'Ensaladas', nombre: 'Griega', precio: 175 },
  { id: 'en7', categoria: 'Ensaladas', nombre: 'Evita', precio: 175 },
  { id: 'en8', categoria: 'Ensaladas', nombre: 'Gaucha', precio: 175 },
  { id: 'en9', categoria: 'Ensaladas', nombre: 'Nordika', precio: 275 },

  // Pastas
  { id: 'p1', categoria: 'Pastas', nombre: 'Spaguetti', precio: 240, desc: 'Bolognesa, fileto, pesto, burro, tuco, alfredo, crema o pomodoro', variants: ['Bolognesa', 'Fileto', 'Pesto', 'Burro', 'Tuco', 'Alfredo', 'Crema', 'Pomodoro'] },
  { id: 'p2', categoria: 'Pastas', nombre: 'Lasagna', peso: '350g', precio: 270 },
  { id: 'p3', categoria: 'Pastas', nombre: 'Tagliatelle al Salmone', precio: 270 },
  { id: 'p4', categoria: 'Pastas', nombre: 'Canelones de Picaña', peso: '200g', precio: 350 },

  // Parrilla
  { id: 'pa1', categoria: 'Parrilla', nombre: 'Bife de Chorizo Pibe', peso: '300g', precio: 640 },
  { id: 'pa2', categoria: 'Parrilla', nombre: 'Bife de Chorizo', peso: '500g', precio: 1050 },
  { id: 'pa3', categoria: 'Parrilla', nombre: 'Bife de Chorizo', peso: '750g', precio: 1570 },
  { id: 'pa4', categoria: 'Parrilla', nombre: 'Rib-Eye Roll', peso: '400g', precio: 1050 },
  { id: 'pa5', categoria: 'Parrilla', nombre: 'Rib-Eye Roll', peso: '600g', precio: 1570 },
  { id: 'pa6', categoria: 'Parrilla', nombre: 'Ojo de Rib-Eye', peso: '300g', precio: 750 },
  { id: 'pa7', categoria: 'Parrilla', nombre: 'Ojo de Rib-Eye', peso: '500g', precio: 1250 },
  { id: 'pa8', categoria: 'Parrilla', nombre: 'Tapa de Rib-Eye', peso: '300g', precio: 750 },
  { id: 'pa9', categoria: 'Parrilla', nombre: 'Tapa de Rib-Eye', peso: '500g', precio: 1250 },
  { id: 'pa10', categoria: 'Parrilla', nombre: 'Cowboy', peso: '500g', precio: 1150 },
  { id: 'pa11', categoria: 'Parrilla', nombre: 'Tomahawk', peso: '1kg', precio: 2150, tag: 'Premium' },
  { id: 'pa12', categoria: 'Parrilla', nombre: 'NY Ribeteado Pibe', peso: '300g', precio: 570 },
  { id: 'pa13', categoria: 'Parrilla', nombre: 'NY Ribeteado', peso: '500g', precio: 950 },
  { id: 'pa14', categoria: 'Parrilla', nombre: 'Bife de Lomo Pibe', peso: '300g', precio: 450 },
  { id: 'pa15', categoria: 'Parrilla', nombre: 'Bife de Lomo', peso: '600g', precio: 750 },
  { id: 'pa16', categoria: 'Parrilla', nombre: 'Medallones de Filete', peso: '300g', precio: 470 },
  { id: 'pa17', categoria: 'Parrilla', nombre: 'Filete Estancia Argentina', peso: '300g', precio: 450 },
  { id: 'pa18', categoria: 'Parrilla', nombre: 'Cabrería', peso: '300g', precio: 520 },
  { id: 'pa19', categoria: 'Parrilla', nombre: 'Arrachera Pibe', peso: '250g', precio: 420 },
  { id: 'pa20', categoria: 'Parrilla', nombre: 'Arrachera', peso: '400g', precio: 570 },
  { id: 'pa21', categoria: 'Parrilla', nombre: 'Tapa de Vacío', peso: '300g', precio: 490 },
  { id: 'pa22', categoria: 'Parrilla', nombre: 'Churrasco Pibe', peso: '400g', precio: 450 },
  { id: 'pa23', categoria: 'Parrilla', nombre: 'Picaña', peso: '300g', precio: 420 },
  { id: 'pa24', categoria: 'Parrilla', nombre: 'Asado de Tira', peso: '500g', precio: 870 },
  { id: 'pa25', categoria: 'Parrilla', nombre: 'Asado de Tira Ancho', peso: '800g', precio: 1280, desc: 'Para 2 personas' },
  { id: 'pa26', categoria: 'Parrilla', nombre: 'Pechuga a las Brasas', peso: '300g', precio: 320 },
  { id: 'pa27', categoria: 'Parrilla', nombre: 'New York Añejo Dry Age', peso: '300g', precio: 890, tag: 'Dry Age' },
  { id: 'pa28', categoria: 'Parrilla', nombre: 'New York Añejo Dry Age', peso: '600g', precio: 1680, tag: 'Dry Age' },
  { id: 'pa29', categoria: 'Parrilla', nombre: 'Rib-Eye Añejo Dry Age', peso: '300g', precio: 890, tag: 'Dry Age' },
  { id: 'pa30', categoria: 'Parrilla', nombre: 'Rib-Eye Añejo Dry Age', peso: '600g', precio: 1680, tag: 'Dry Age' },
  { id: 'pa31', categoria: 'Parrilla', nombre: 'Rib Eye Akaushi', peso: '300g', precio: 1350, tag: 'Akaushi' },
  { id: 'pa32', categoria: 'Parrilla', nombre: 'Rib Eye Akaushi', peso: '500g', precio: 2300, tag: 'Akaushi' },

  // Del Mar
  { id: 'm1', categoria: 'Del Mar', nombre: 'Salmón a la Parrilla', peso: '200g', precio: 370, desc: 'Guarnición de ensalada Evita' },
  { id: 'm2', categoria: 'Del Mar', nombre: 'Atún Sellado', peso: '200g', precio: 350 },
  { id: 'm3', categoria: 'Del Mar', nombre: 'Pulpo a la Parrilla', peso: '300g', precio: 450 },
  { id: 'm4', categoria: 'Del Mar', nombre: 'Camarones al Gusto', peso: '200g', precio: 380 },
  { id: 'm5', categoria: 'Del Mar', nombre: 'Chilean Sea Bass Porteño', peso: '200g', precio: 620, tag: 'Premium' },

  // Guarniciones
  { id: 'g1', categoria: 'Guarniciones', nombre: 'Papas a la Francesa', precio: 60 },
  { id: 'g2', categoria: 'Guarniciones', nombre: 'Puré de Papa', precio: 60 },
  { id: 'g2b', categoria: 'Guarniciones', nombre: 'Papa al Horno', precio: 60 },
  { id: 'g2c', categoria: 'Guarniciones', nombre: 'Papas Estilo Norteño', precio: 70 },
  { id: 'g3', categoria: 'Guarniciones', nombre: 'Puré de Jalapeño', precio: 60 },
  { id: 'g4', categoria: 'Guarniciones', nombre: 'Cebolla Asada', precio: 60 },
  { id: 'g5', categoria: 'Guarniciones', nombre: 'Chiles Toreados', precio: 60 },
  { id: 'g6', categoria: 'Guarniciones', nombre: 'Verduras Cocidas', precio: 60 },
  { id: 'g7', categoria: 'Guarniciones', nombre: 'Verduras a la Parrilla', precio: 60 },
  { id: 'g8', categoria: 'Guarniciones', nombre: 'Espinacas a la Crema', precio: 60 },
  { id: 'g9', categoria: 'Guarniciones', nombre: 'Guacamole', precio: 75 },
  { id: 'g10', categoria: 'Guarniciones', nombre: 'Granos de Elote', precio: 60 },
  { id: 'g11', categoria: 'Guarniciones', nombre: 'Ensaladilla Rusa', precio: 60 },
  { id: 'g12', categoria: 'Guarniciones', nombre: 'Espárragos a la Parrilla', precio: 90, includedEligible: false },
  { id: 'g13', categoria: 'Guarniciones', nombre: 'Betabel Rostizado', precio: 60 },
  { id: 'g14', categoria: 'Guarniciones', nombre: 'Tuétano a la Parrilla', precio: 90, includedEligible: false },

  // Postres
  { id: 'po1', categoria: 'Postres', nombre: 'Cookie Skillet con Helado', precio: 140 },
  { id: 'po2', categoria: 'Postres', nombre: 'Flan Napolitano', precio: 120 },
  { id: 'po3', categoria: 'Postres', nombre: 'Pastel Estancia', precio: 160 },
  { id: 'po4', categoria: 'Postres', nombre: 'Pastel de Kiwi y Plátano', precio: 160 },
  { id: 'po5', categoria: 'Postres', nombre: 'Alfajores Argentinos', precio: 120, desc: '3 piezas' },
  { id: 'po6', categoria: 'Postres', nombre: 'Crème Brulée', precio: 140 },
  { id: 'po7', categoria: 'Postres', nombre: 'Pastel Personalizado', precio: 20, desc: 'Mensaje a elegir, ideal para brindis · $20 por persona', perPerson: true },
];

export type BeveragePackage = {
  id: string;
  nombre: string;
  // One-line summary used in the Constructor radio picker (kept short).
  desc: string;
  // Detailed bullet list shown on Vista Cliente / PDF so the customer
  // knows exactly what's in the package — fixes a real-world issue where
  // hostesses were getting follow-up "¿qué incluye el básico?" questions
  // after sending quotes. Edit these to change what the customer sees;
  // ideal future state is a DB-backed table so non-engineers can edit.
  bullets: string[];
  precio: number;
};

export const PAQUETES_BEBIDAS: BeveragePackage[] = [
  {
    id: 'basico',
    nombre: 'Básico',
    desc: '3 bebidas por persona: refresco, naranjada, limonada, agua mineral, vino tinto de la casa o cerveza nacional',
    bullets: [
      '3 bebidas por persona',
      'Refresco, naranjada, limonada, agua mineral',
      'Vino tinto de la casa o cerveza nacional',
    ],
    precio: 200,
  },
  {
    id: 'premium',
    nombre: 'Premium',
    desc: '4 bebidas por persona: 2 con alcohol (vino casa o cerveza nacional) + 2 sin alcohol (refresco, naranjada, limonada, agua o café)',
    bullets: [
      '4 bebidas por persona',
      '2 con alcohol: vino de la casa o cerveza nacional',
      '2 sin alcohol: refresco, naranjada, limonada, agua o café',
    ],
    precio: 300,
  },
  {
    id: 'barra-libre-sin-alcohol',
    nombre: 'Barra Libre Sin Alcohol',
    desc: 'Ilimitado: refresco, naranjada, limonada, agua mineral, café',
    bullets: [
      'Bebidas sin alcohol ilimitadas',
      'Refresco, naranjada, limonada, agua mineral, café',
    ],
    precio: 150,
  },
  {
    id: 'mixto-ilimitado',
    nombre: 'Mixto Ilimitado',
    desc: '2 bebidas con alcohol (vino casa o cerveza nacional) + barra libre sin alcohol ilimitada',
    bullets: [
      '2 bebidas con alcohol: vino de la casa o cerveza nacional',
      'Barra libre sin alcohol ilimitada',
    ],
    precio: 280,
  },
  {
    id: 'a-la-carta',
    nombre: 'A la Carta',
    desc: 'Las bebidas se cobran por separado al consumo',
    bullets: ['Se cobran por separado al consumo'],
    precio: 0,
  },
];

// Legacy bebida ids that lived in saved quotes before the 2026 rename. We
// resolve them on read in `migrateConfig` so existing quotes don't break.
// Mapping: 'completo' (old Básico) → 'basico', 'sin-alcohol' (old $159 3-bebida
// sin-alcohol) → 'barra-libre-sin-alcohol' (new $150 ilimitado, the closest
// match Leslie agreed to as a price-and-content swap).
const LEGACY_BEBIDA_IDS: Record<string, string> = {
  completo: 'basico',
  'sin-alcohol': 'barra-libre-sin-alcohol',
};

function migrateBebidaId(id: string | undefined): string {
  if (!id) return 'basico';
  return LEGACY_BEBIDA_IDS[id] ?? id;
}

export type QuoteModo = 'individual' | 'opciones' | 'asado' | 'carta';

export type IndivState = {
  sopas: string[];
  platos: string[];
  postres: string[];
  bebidas: string;
  precioPP: number;
  costoPP: number;
  incluyeIVA: boolean;
  incluyeServicio: boolean;
};

export type TierState = {
  letra: string;
  precio: number;
  platos: string;
  // Per-tier cost so the internal margen for A/B/C is real instead of the
  // legacy 0.42 × avgTier heuristic. Optional: when 0/undefined, pricing
  // falls back to the heuristic so older quotes keep their numbers.
  costoPP?: number;
};

// Free-form extra section (brindis, mesa de quesos, dessert station…). Lives
// at the top of QuoteConfig, not per-mode, because hostess can attach them
// to any quote regardless of which template/mode she started from. The
// precio rolls into the per-pp total; the section renders as its own header
// + descripcion block in Vista Cliente / PDF.
export type ExtraSection = {
  id: string;
  nombre: string;
  descripcion: string;
  precioPP: number;
  costoPP?: number;
};

export type OpcionesState = {
  sopas: string[];
  tiers: TierState[];
  postres: string[];
  bebidas: string;
  incluyeIVA: boolean;
  incluyeServicio: boolean;
};

export type AsadoState = {
  // Asado al Centro is a shared parrillada — sides are bundled by the
  // template (see QuoteTemplate.sharedSides) and live as line items in
  // `cantidades` like any other bundled dish. No per-cut included-side
  // picker; the included-side concept here is template-level, not per-row.
  cantidades: Record<string, number>;
  // Selected variants per dish (e.g. dishVariants.e1 = ['Carne','Queso']).
  // Empty/missing = hostess hasn't locked it in; Vista Cliente skips the
  // sub-line. Only dishes with QuoteDish.variants surface a chip picker.
  dishVariants: Record<string, string[]>;
  bebidas: string;
  markup: number;
  // Manual overrides — when > 0, take priority over the markup-derived
  // precio/pp and the auto-summed costoPP. Hostess uses these when she
  // negotiated a flat price that doesn't match cost × markup, or when her
  // real costo differs from sum of menu prices (special supplier deal,
  // pre-prep labor, etc.). Leave at 0 to keep the auto behavior.
  precioPPManual?: number;
  costoPPManual?: number;
  incluyeIVA: boolean;
  incluyeServicio: boolean;
};

export type CartaState = {
  cantidades: Record<string, number>;
  // A la Carta is per-cut: each Parrilla dish maps to one free included
  // side (parrilla dish id → guarnición dish id). The included side is
  // NOT mirrored into `cantidades`, so pricing leaves it free.
  parrillaSides: Record<string, string>;
  dishVariants: Record<string, string[]>;
  bebidas: string;
  markup: number;
  // See AsadoState — same override semantics for Carta mode.
  precioPPManual?: number;
  costoPPManual?: number;
  incluyeIVA: boolean;
  incluyeServicio: boolean;
};

export type EventoState = {
  cliente: string;
  telefono: string;
  fecha: string;
  hora: string;
  tipo: string;
  personas: number;
  presupuesto: number;
  prioridad: string;
};

export type QuoteTemplate = {
  id: string;
  nombre: string;
  subtitulo: string;
  precioPP?: number;
  precioLabel: string;
  descripcion: string;
  idealPara: string;
  modo: QuoteModo;
  // When set, this template represents a "shared sides" product (e.g.
  // parrillada al centro): guarniciones in `cantidades` are part of the
  // bundle price and should render as "(incluida)" in Vista Cliente,
  // not as separate paid line items. `sideRatioPerPerson` is the
  // recommended sides-to-headcount ratio (0.5 = 1 side per 2 personas)
  // — reserved for a future "Recomendado: X guarniciones" hint.
  sharedSides?: { sideRatioPerPerson: number };
  config: {
    sopas?: string[];
    platos?: string[];
    tiers?: TierState[];
    postres?: string[];
    cantidades?: Record<string, number>;
    bebidas?: string;
    markup?: number;
    precioPP?: number;
    costoPP?: number;
    incluyeIVA?: boolean;
    incluyeServicio?: boolean;
  };
};

export const TEMPLATES: QuoteTemplate[] = [
  {
    id: 'tres-tiempos-opciones',
    nombre: 'Menú 3 Tiempos · 3 Opciones',
    subtitulo: 'Bodas, eventos formales',
    precioPP: 1250,
    precioLabel: 'Desde $1,100/pp',
    descripcion: 'Sopa o crema, 3 opciones de plato fuerte (A/B/C) con guarnición, postre y bebidas. El cliente elige el día del evento qué opción quiere cada invitado.',
    idealPara: 'Bodas, eventos corporativos, grupos donde quieres dar variedad de cortes a distinto precio.',
    modo: 'opciones',
    config: {
      sopas: ['s5', 's6', 's7'],
      tiers: [
        { letra: 'A', precio: 1100, platos: 'Arrachera 250g / Puré de Papa\nPechuga de Pollo 300g a la Parrilla / Papas Estilo Norteño' },
        { letra: 'B', precio: 1250, platos: 'New York 300g / Verduras a la Parrilla\nMedallones de Filete\nSalmón a la Parrilla / Ensalada de la Casa' },
        { letra: 'C', precio: 1400, platos: 'Rib-Eye Añejo 300g / Papa al Horno\nTapa de Rib-Eye 300g / Espárragos al Grill\nChilean Sea Bass Estilo Porteño' },
      ],
      postres: ['po1', 'po2', 'po3', 'po4'],
      bebidas: 'basico',
      incluyeIVA: true,
      incluyeServicio: false,
    },
  },
  {
    id: 'individual-economico',
    nombre: 'Menú Individual Económico',
    subtitulo: 'Comidas ejecutivas',
    precioPP: 1000,
    precioLabel: '$1,000/pp con IVA',
    descripcion: 'Crema, plato fuerte, postre y bebidas sin alcohol. Precio único por persona, fácil de cotizar y cobrar.',
    idealPara: 'Comidas ejecutivas pequeñas, juntas con cliente, eventos con presupuesto controlado.',
    modo: 'individual',
    config: {
      sopas: ['s6', 's7'],
      platos: ['pa19', 'm1'],
      postres: ['po2', 'po5'],
      bebidas: 'barra-libre-sin-alcohol',
      precioPP: 1000,
      costoPP: 420,
      incluyeIVA: true,
      incluyeServicio: false,
    },
  },
  {
    id: 'asado-centro',
    nombre: 'Asado Argentino al Centro',
    subtitulo: 'Reuniones familiares, cumpleaños',
    precioLabel: 'Por consumo + markup',
    descripcion: 'Tablas de entradas, parrillada al centro (chorizo, arrachera, picaña, vacío), guarniciones surtidas y postre. Ideal para compartir.',
    idealPara: 'Grupos de 10–40 personas que quieren convivir con todo al centro.',
    modo: 'asado',
    // Asado al Centro is a shared parrillada — guarniciones are bundled at
    // ~1 per 2 personas. They live in cantidades (and bill into the bundle
    // price), but render as "(incluida)" so the customer doesn't read them
    // as separate paid extras. Premium sides (Espárragos, Tuétano) added
    // here would still render as paid via the includedEligible:false flag.
    sharedSides: { sideRatioPerPerson: 0.5 },
    config: {
      cantidades: {
        e6: 2, e7: 1, e10: 1,
        pa19: 2, pa20: 1, pa23: 1, pa21: 1, pa24: 1,
        g1: 2, g2: 1, g7: 2, g9: 1,
      },
      bebidas: 'basico',
      markup: 40,
      incluyeIVA: true,
      incluyeServicio: true,
    },
  },
  {
    id: 'premium-cata',
    nombre: 'Menú Premium con Cata',
    subtitulo: 'Aniversarios, celebraciones especiales',
    precioPP: 1800,
    precioLabel: 'Desde $1,600/pp',
    descripcion: 'Entrada de autor, corte premium (Dry Age o Akaushi), guarniciones seleccionadas y postre. Incluye cata de vinos.',
    idealPara: 'Cenas especiales donde la calidad del corte y el vino es lo más importante.',
    modo: 'individual',
    config: {
      sopas: ['s8'],
      platos: ['pa29', 'pa4', 'm5'],
      postres: ['po3', 'po6'],
      bebidas: 'premium',
      precioPP: 1800,
      costoPP: 780,
      incluyeIVA: true,
      incluyeServicio: true,
    },
  },
];

export const DEFAULT_TERMS = `1. Esta cotización tiene una vigencia de 15 días naturales a partir de su fecha de emisión.
2. Se requiere un anticipo del 50% para confirmar la reservación del evento.
3. Precios sujetos a cambio sin previo aviso después de la vigencia.`;

export const EMPTY_EVENTO: EventoState = {
  cliente: '',
  telefono: '',
  fecha: '',
  hora: '',
  tipo: 'Boda',
  personas: 50,
  presupuesto: 0,
  prioridad: 'Calidad',
};

export const EMPTY_INDIV: IndivState = {
  sopas: [],
  platos: [],
  postres: [],
  bebidas: 'basico',
  precioPP: 0,
  costoPP: 0,
  incluyeIVA: true,
  incluyeServicio: false,
};

export const EMPTY_OPCIONES: OpcionesState = {
  sopas: [],
  tiers: [
    { letra: 'A', precio: 0, platos: '', costoPP: 0 },
    { letra: 'B', precio: 0, platos: '', costoPP: 0 },
    { letra: 'C', precio: 0, platos: '', costoPP: 0 },
  ],
  postres: [],
  bebidas: 'basico',
  incluyeIVA: true,
  incluyeServicio: false,
};

export const EMPTY_ASADO: AsadoState = {
  cantidades: {},
  dishVariants: {},
  bebidas: 'basico',
  markup: 40,
  incluyeIVA: true,
  incluyeServicio: false,
};

export const EMPTY_CARTA: CartaState = {
  cantidades: {},
  parrillaSides: {},
  dishVariants: {},
  bebidas: 'a-la-carta',
  markup: 40,
  incluyeIVA: true,
  incluyeServicio: false,
};

export type QuoteConfig = {
  modo: QuoteModo;
  evento: EventoState;
  indiv: IndivState;
  opciones: OpcionesState;
  asado: AsadoState;
  carta: CartaState;
  // Optional free-form sections (brindis, mesa de quesos, dessert station…)
  // appended to any quote regardless of mode. Renders at top of menu in
  // Vista Cliente; precioPP rolls into per-pp total. Empty/missing = none.
  extraSections?: ExtraSection[];
  templateId?: string;
  folio?: string;
  terms?: string;
};

// Backfills fields added in newer schemas onto a config loaded from the DB.
// Quotes saved before these maps existed have them undefined — coerce to
// empty maps so downstream code can read them without nullchecks. Also
// remaps legacy bebida ids ('completo', 'sin-alcohol') to their post-2026
// successors so existing quotes don't render with undefined packages.
export function migrateConfig(c: QuoteConfig): QuoteConfig {
  return {
    ...c,
    indiv: {
      ...c.indiv,
      bebidas: migrateBebidaId(c.indiv?.bebidas),
    },
    opciones: {
      ...c.opciones,
      bebidas: migrateBebidaId(c.opciones?.bebidas),
      tiers: (c.opciones?.tiers ?? []).map((t) => ({
        ...t,
        costoPP: t.costoPP ?? 0,
      })),
    },
    asado: {
      ...c.asado,
      bebidas: migrateBebidaId(c.asado?.bebidas),
      dishVariants: c.asado?.dishVariants ?? {},
    },
    carta: {
      ...c.carta,
      bebidas: migrateBebidaId(c.carta?.bebidas),
      parrillaSides: c.carta?.parrillaSides ?? {},
      dishVariants: c.carta?.dishVariants ?? {},
    },
    extraSections: c.extraSections ?? [],
  };
}

export function emptyConfig(modo: QuoteModo = 'opciones'): QuoteConfig {
  return {
    modo,
    evento: { ...EMPTY_EVENTO },
    indiv: { ...EMPTY_INDIV, sopas: [], platos: [], postres: [] },
    opciones: {
      ...EMPTY_OPCIONES,
      sopas: [],
      postres: [],
      tiers: EMPTY_OPCIONES.tiers.map((t) => ({ ...t })),
    },
    asado: { ...EMPTY_ASADO, cantidades: {}, dishVariants: {} },
    carta: { ...EMPTY_CARTA, cantidades: {}, parrillaSides: {}, dishVariants: {} },
    extraSections: [],
    terms: DEFAULT_TERMS,
  };
}

export function dishById(id: string): QuoteDish | undefined {
  return MENU.find((d) => d.id === id);
}

export function dishName(id: string): string {
  return dishById(id)?.nombre ?? id;
}

export function packageById(id: string): BeveragePackage | undefined {
  return PAQUETES_BEBIDAS.find((p) => p.id === id);
}

// Sum of extra-section per-pp prices. Used in Vista Cliente / PDF to embed
// the extras into the displayed per-tier price for opciones mode (so the
// customer sees one final number per option, not "Opción A $1,050 +
// Brindis $700"). Returns 0 when no sections — safe to add unconditionally.
export function extraSectionsPP(config: QuoteConfig): number {
  return (config.extraSections ?? []).reduce((sum, s) => sum + (s.precioPP || 0), 0);
}

export function newExtraSectionId(): string {
  return 'sec-' + Math.random().toString(36).slice(2, 9);
}

export function isParrilla(dishId: string): boolean {
  return dishById(dishId)?.categoria === 'Parrilla';
}

// Sides eligible to be a Parrilla cut's free included side.
// Premium guarniciones (Espárragos, Tuétano) are excluded — they always bill
// through Guarniciones as paid add-ons.
export function eligibleIncludedSides(): QuoteDish[] {
  return MENU.filter((d) => d.categoria === 'Guarniciones' && d.includedEligible !== false);
}

// ── Pricing helpers ─────────────────────────────────────────────────────────

function servicePct() {
  return 0.15;
}

function ivaPct() {
  return 0.16;
}

export type PricingResult = {
  costoTotal: number;
  subtotalVenta: number;
  servicioActivo: boolean;
  servicioAmt: number;
  ivaIncluido: boolean;
  ivaAmt: number;
  precioTotalFinal: number;
  precioFinalPP: number;
  gananciaBruta: number;
  margenPct: number;
};

export function computePricing(config: QuoteConfig): PricingResult {
  const personas = Math.max(1, config.evento.personas || 1);
  const pkg = packageById(
    config.modo === 'individual'
      ? config.indiv.bebidas
      : config.modo === 'opciones'
      ? config.opciones.bebidas
      : config.modo === 'asado'
      ? config.asado.bebidas
      : config.carta.bebidas,
  );
  const bebidaPP = pkg?.precio ?? 0;

  // Extra sections (brindis, mesa de quesos, …) add to per-pp total across
  // every mode. costoPP is optional — skip if 0/undefined.
  const sections = config.extraSections ?? [];
  const extraVentaPP = sections.reduce((sum, s) => sum + (s.precioPP || 0), 0);
  const extraCostoPP = sections.reduce((sum, s) => sum + (s.costoPP || 0), 0);

  let costoTotal = 0;
  let subtotalVenta = 0;
  let ivaIncluido = false;
  let servicioActivo = false;

  if (config.modo === 'individual') {
    const { indiv } = config;
    costoTotal = (indiv.costoPP + extraCostoPP + bebidaPP * 0.4) * personas;
    subtotalVenta = (indiv.precioPP + extraVentaPP + bebidaPP) * personas;
    ivaIncluido = indiv.incluyeIVA;
    servicioActivo = indiv.incluyeServicio;
  } else if (config.modo === 'opciones') {
    const { opciones } = config;
    const tierPrices = opciones.tiers.map((t) => t.precio || 0).filter((p) => p > 0);
    const avgTier = tierPrices.length ? tierPrices.reduce((a, b) => a + b, 0) / tierPrices.length : 0;
    // Prefer real per-tier costos when at least one is set; otherwise fall
    // back to the legacy 0.42 × avgTier heuristic so old quotes keep their
    // numbers exactly.
    const tierCostos = opciones.tiers
      .map((t) => (t.precio || 0) > 0 ? (t.costoPP ?? 0) : 0)
      .filter((c) => c > 0);
    const avgCosto = tierCostos.length
      ? tierCostos.reduce((a, b) => a + b, 0) / tierCostos.length
      : avgTier * 0.42;
    costoTotal = (avgCosto + extraCostoPP + bebidaPP * 0.4) * personas;
    subtotalVenta = (avgTier + extraVentaPP + bebidaPP) * personas;
    ivaIncluido = opciones.incluyeIVA;
    servicioActivo = opciones.incluyeServicio;
  } else if (config.modo === 'asado') {
    const { asado } = config;
    let cost = 0;
    for (const [id, qty] of Object.entries(asado.cantidades)) {
      const dish = dishById(id);
      if (!dish || qty <= 0) continue;
      const mult = dish.perPerson ? personas : 1;
      cost += dish.precio * qty * mult;
    }
    const autoCostoPP = cost / personas;
    const autoVentaPP = autoCostoPP * (1 + (asado.markup || 0) / 100);
    const effCostoPP = (asado.costoPPManual ?? 0) > 0 ? asado.costoPPManual! : autoCostoPP;
    const effVentaPP = (asado.precioPPManual ?? 0) > 0 ? asado.precioPPManual! : autoVentaPP;
    costoTotal = (effCostoPP + extraCostoPP + bebidaPP * 0.4) * personas;
    subtotalVenta = (effVentaPP + extraVentaPP + bebidaPP) * personas;
    ivaIncluido = asado.incluyeIVA;
    servicioActivo = asado.incluyeServicio;
  } else {
    const { carta } = config;
    let cost = 0;
    for (const [id, qty] of Object.entries(carta.cantidades)) {
      const dish = dishById(id);
      if (!dish || qty <= 0) continue;
      const mult = dish.perPerson ? personas : 1;
      cost += dish.precio * qty * mult;
    }
    const autoCostoPP = cost / personas;
    const autoVentaPP = autoCostoPP * (1 + (carta.markup || 0) / 100);
    const effCostoPP = (carta.costoPPManual ?? 0) > 0 ? carta.costoPPManual! : autoCostoPP;
    const effVentaPP = (carta.precioPPManual ?? 0) > 0 ? carta.precioPPManual! : autoVentaPP;
    costoTotal = (effCostoPP + extraCostoPP + bebidaPP * 0.4) * personas;
    subtotalVenta = (effVentaPP + extraVentaPP + bebidaPP) * personas;
    ivaIncluido = carta.incluyeIVA;
    servicioActivo = carta.incluyeServicio;
  }

  const servicioAmt = servicioActivo ? subtotalVenta * servicePct() : 0;
  const conServicio = subtotalVenta + servicioAmt;
  const ivaAmt = ivaIncluido ? 0 : conServicio * ivaPct();
  const precioTotalFinal = conServicio + ivaAmt;
  const precioFinalPP = precioTotalFinal / personas;
  const gananciaBruta = subtotalVenta - costoTotal;
  const margenPct = subtotalVenta > 0 ? Math.round((gananciaBruta / subtotalVenta) * 100) : 0;

  return {
    costoTotal,
    subtotalVenta,
    servicioActivo,
    servicioAmt,
    ivaIncluido,
    ivaAmt,
    precioTotalFinal,
    precioFinalPP,
    gananciaBruta,
    margenPct,
  };
}

// Format MXN currency without decimals, e.g. $1,200
export function fmtMXN(n: number): string {
  return '$' + Math.round(n || 0).toLocaleString('es-MX');
}
