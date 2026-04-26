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
  { id: 'e1', categoria: 'Entradas', nombre: 'Empanadas', peso: '60g c/u', precio: 110, desc: 'Carne, queso, humita, salmón, siciliana, espinaca, queso azul o chistorra' },
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
  { id: 'p1', categoria: 'Pastas', nombre: 'Spaguetti', precio: 240, desc: 'Bolognesa, fileto, pesto, burro, tuco, alfredo, crema o pomodoro' },
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
  desc: string;
  precio: number;
};

export const PAQUETES_BEBIDAS: BeveragePackage[] = [
  { id: 'completo', nombre: 'Paquete Básico', desc: '3 bebidas por persona: refresco, naranjada, limonada, agua mineral, vino tinto de la casa o cerveza nacional', precio: 200 },
  { id: 'premium', nombre: 'Paquete Premium', desc: '2 copas de vino de la casa + 2 bebidas extra (refresco, naranjada, limonada, agua o café)', precio: 300 },
  { id: 'sin-alcohol', nombre: 'Paquete Sin Alcohol', desc: '3 bebidas sin alcohol por persona (refresco, naranjada, limonada, agua o café)', precio: 159 },
  { id: 'a-la-carta', nombre: 'Bebidas a la Carta', desc: 'Las bebidas se cobran por separado al consumo', precio: 0 },
];

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
  cantidades: Record<string, number>;
  // Maps a Parrilla dish id (e.g. 'pa20') to the included side dish id
  // (e.g. 'g1'). Each Parrilla cut comes with one side at no charge — the
  // included side is NOT mirrored into `cantidades` so it stays free.
  parrillaSides: Record<string, string>;
  bebidas: string;
  markup: number;
  incluyeIVA: boolean;
  incluyeServicio: boolean;
};

export type CartaState = {
  cantidades: Record<string, number>;
  parrillaSides: Record<string, string>;
  bebidas: string;
  markup: number;
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
      bebidas: 'completo',
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
      bebidas: 'sin-alcohol',
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
    config: {
      // Guarniciones intentionally omitted — every Parrilla cut here gets
      // its included side via `parrillaSides` (seeded on template apply).
      // Add explicit guarniciones below ONLY when the customer wants extra
      // sides beyond the per-cut included one (or premium sides like
      // Espárragos/Tuétano which never qualify as "included").
      cantidades: {
        e6: 2, e7: 1, e10: 1,
        pa19: 2, pa20: 1, pa23: 1, pa21: 1, pa24: 1,
      },
      bebidas: 'completo',
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
  bebidas: 'completo',
  precioPP: 0,
  costoPP: 0,
  incluyeIVA: true,
  incluyeServicio: false,
};

export const EMPTY_OPCIONES: OpcionesState = {
  sopas: [],
  tiers: [
    { letra: 'A', precio: 0, platos: '' },
    { letra: 'B', precio: 0, platos: '' },
    { letra: 'C', precio: 0, platos: '' },
  ],
  postres: [],
  bebidas: 'completo',
  incluyeIVA: true,
  incluyeServicio: false,
};

export const EMPTY_ASADO: AsadoState = {
  cantidades: {},
  parrillaSides: {},
  bebidas: 'completo',
  markup: 40,
  incluyeIVA: true,
  incluyeServicio: false,
};

export const EMPTY_CARTA: CartaState = {
  cantidades: {},
  parrillaSides: {},
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
  templateId?: string;
  folio?: string;
  terms?: string;
};

// Backfills fields added in newer schemas onto a config loaded from the DB.
// Quotes saved before parrillaSides existed have it undefined — coerce to an
// empty map so downstream code can read it without nullchecks everywhere.
export function migrateConfig(c: QuoteConfig): QuoteConfig {
  return {
    ...c,
    asado: { ...c.asado, parrillaSides: c.asado?.parrillaSides ?? {} },
    carta: { ...c.carta, parrillaSides: c.carta?.parrillaSides ?? {} },
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
    asado: { ...EMPTY_ASADO, cantidades: {}, parrillaSides: {} },
    carta: { ...EMPTY_CARTA, cantidades: {}, parrillaSides: {} },
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

  let costoTotal = 0;
  let subtotalVenta = 0;
  let ivaIncluido = false;
  let servicioActivo = false;

  if (config.modo === 'individual') {
    const { indiv } = config;
    costoTotal = (indiv.costoPP + bebidaPP * 0.4) * personas;
    subtotalVenta = (indiv.precioPP + bebidaPP) * personas;
    ivaIncluido = indiv.incluyeIVA;
    servicioActivo = indiv.incluyeServicio;
  } else if (config.modo === 'opciones') {
    const { opciones } = config;
    // Use average of tier prices as reference
    const tierPrices = opciones.tiers.map((t) => t.precio || 0).filter((p) => p > 0);
    const avgTier = tierPrices.length ? tierPrices.reduce((a, b) => a + b, 0) / tierPrices.length : 0;
    costoTotal = (avgTier * 0.42 + bebidaPP * 0.4) * personas;
    subtotalVenta = (avgTier + bebidaPP) * personas;
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
    costoTotal = cost + bebidaPP * 0.4 * personas;
    subtotalVenta = cost * (1 + (asado.markup || 0) / 100) + bebidaPP * personas;
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
    costoTotal = cost + bebidaPP * 0.4 * personas;
    subtotalVenta = cost * (1 + (carta.markup || 0) / 100) + bebidaPP * personas;
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
