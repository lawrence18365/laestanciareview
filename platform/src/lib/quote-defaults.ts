export type MenuCategory =
  | 'entrada'
  | 'ensalada'
  | 'corte'
  | 'guarnicion'
  | 'postre'
  | 'bebida'
  | 'vino'
  | 'extra';

export const CATEGORY_LABELS: Record<MenuCategory, string> = {
  entrada: 'Entradas',
  ensalada: 'Ensaladas',
  corte: 'Cortes / Parrilla',
  guarnicion: 'Guarniciones',
  postre: 'Postres',
  bebida: 'Bebidas',
  vino: 'Vinos',
  extra: 'Extras',
};

// Real La Estancia Argentina menu (from official 2025 menu PDF).
// Guarniciones are INCLUDED in the event package price — they are not charged
// as add-ons. The price per person already covers the selected sides.
export const MENU_OPTIONS: Record<MenuCategory, string[]> = {
  entrada: [
    'Empanadas Relleno (carne / queso / humita / salmón)',
    'Queso Provoleta 160g',
    'Provoleta Estancia 160g',
    'Queso Fundido 220g',
    'Queso Fundido con Chistorra 100g',
    'Queso Fundido con Chorizo Argentino 75g',
    'Chorizo Argentino 160g',
    'Chistorra 200g',
    'Chicharrón Rib-Eye 220g',
    'Mollejas de Ternera 350g',
    'Burrata Rústica 130g',
    'Carpaccio de Salmón Ahumado 150g',
    'Camarones con Champiñones al Ajillo 180g',
    'Tiradito de Camarón y Pulpo 200g',
  ],
  ensalada: [
    'César (preparada en su mesa)',
    'Mixta',
    'Santelmo',
    'Capresse',
    'Griega',
    'Evita',
    'Gaucha',
    'Falsa Niçoise',
    'Nordika',
  ],
  corte: [
    'Arrachera 400g',
    'Picaña 300g',
    'Churrasco Pibe 400g',
    'Bife de Chorizo Pibe 300g',
    'Bife de Chorizo 500g',
    'Bife de Chorizo Ribeteado 500g (New York)',
    'Rib-Eye Roll 400g',
    'Rib-Eye Roll 600g',
    'Ojo de Rib-Eye 300g',
    'Bife de Lomo Pibe 300g',
    'Bife de Lomo 600g',
    'Medallones de Filete 300g',
    'Filete Estancia Argentina 300g',
    'Asado de Tira 500g',
    'Tomahawk 1kg',
    'New York Añejo 300g (Dry Age)',
    'Rib-Eye Añejo 300g (Dry Age)',
    'Rib Eye Akaushi 300g (Premium)',
    'Salmón a la Parrilla 200g',
    'Pechuga a las Brasas',
  ],
  // All real guarniciones from the 2025 menu. Included in event package price.
  guarnicion: [
    'Papa (cargada, saratoga o a la francesa)',
    'Puré de Papa',
    'Puré de Jalapeño',
    'Espinacas a la Crema',
    'Verduras a la Parrilla',
    'Verduras Cocidas',
    'Espárragos a la Parrilla',
    'Cebolla Asada',
    'Chiles Toreados',
    'Guacamole',
    'Granos de Elote a la Mantequilla',
    'Ensaladilla Rusa',
    'Betabel Rostizado',
    'Tuétano a la Parrilla',
  ],
  postre: [
    'Flan Napolitano',
    'Cookie Skillet',
    'Volcán de Chocolate',
    'Crème Brûlée',
    'Helado Artesanal',
    'Postre del día',
    'Selección de postres',
  ],
  bebida: [
    'Refrescos',
    'Aguas frescas (Limonada / Naranjada)',
    'Café americano',
    'Cappuccino',
    'Agua mineral',
    'Jugo natural',
  ],
  vino: [
    'Vino de la casa (tinto o blanco)',
    'Trapiche Malbec',
    'Santa Julia Malbec',
    'Selección del sommelier',
    'Botella a elección de la carta',
  ],
  extra: [
    'Decoración de mesa',
    'Música en vivo',
    'Coordinador de eventos',
    'Hora extra de servicio',
    'Pantalla / proyector',
  ],
};

export type PackageTemplate = {
  name: string;
  pricePerPerson: string;
  items: Partial<Record<MenuCategory, string[]>>;
};

// Package templates use real menu items. Guarniciones are always included —
// the price per person covers the selected sides, no extra per-item charge.
export const PACKAGE_TEMPLATES: PackageTemplate[] = [
  {
    name: 'Ejecutivo',
    pricePerPerson: '650',
    items: {
      entrada: ['Queso Provoleta 160g', 'Chorizo Argentino 160g'],
      ensalada: ['César (preparada en su mesa)'],
      corte: ['Arrachera 400g'],
      guarnicion: ['Puré de Papa', 'Papa (cargada, saratoga o a la francesa)'],
      postre: ['Postre del día'],
      bebida: ['Refrescos', 'Aguas frescas (Limonada / Naranjada)', 'Café americano'],
      vino: [],
      extra: [],
    },
  },
  {
    name: 'Premium',
    pricePerPerson: '850',
    items: {
      entrada: ['Empanadas Relleno (carne / queso / humita / salmón)', 'Provoleta Estancia 160g', 'Chistorra 200g'],
      ensalada: ['César (preparada en su mesa)', 'Mixta'],
      corte: ['Bife de Chorizo 500g'],
      guarnicion: ['Puré de Papa', 'Papa (cargada, saratoga o a la francesa)', 'Espinacas a la Crema'],
      postre: ['Flan Napolitano'],
      bebida: ['Refrescos', 'Aguas frescas (Limonada / Naranjada)', 'Café americano'],
      vino: ['Vino de la casa (tinto o blanco)'],
      extra: [],
    },
  },
  {
    name: 'Elite',
    pricePerPerson: '1100',
    items: {
      entrada: [
        'Empanadas Relleno (carne / queso / humita / salmón)',
        'Queso Fundido con Chorizo Argentino 75g',
        'Provoleta Estancia 160g',
        'Mollejas de Ternera 350g',
      ],
      ensalada: ['César (preparada en su mesa)', 'Evita'],
      corte: ['Rib-Eye Roll 400g'],
      guarnicion: [
        'Puré de Papa',
        'Papa (cargada, saratoga o a la francesa)',
        'Espinacas a la Crema',
        'Verduras a la Parrilla',
      ],
      postre: ['Selección de postres'],
      bebida: ['Refrescos', 'Aguas frescas (Limonada / Naranjada)', 'Café americano', 'Cappuccino'],
      vino: ['Selección del sommelier'],
      extra: [],
    },
  },
];

export const DEFAULT_TERMS = `1. Cotización válida por 15 días a partir de la fecha de emisión.
2. Para confirmar la reservación se requiere un anticipo del 50% del total.
3. El saldo restante deberá liquidarse antes del evento.
4. El precio está sujeto a cambios si se modifica el número de personas, menú o servicios.`;

export const EVENT_TYPES = [
  'Comida corporativa',
  'Cena corporativa',
  'Reunión de negocios',
  'Celebración de empresa',
  'Cumpleaños',
  'Aniversario',
  'Graduación',
  'Boda / XV años',
  'Evento privado',
  'Otro',
];

export type QuoteItemsMap = Record<MenuCategory, string[]>;

export function emptyItemsMap(): QuoteItemsMap {
  return {
    entrada: [],
    ensalada: [],
    corte: [],
    guarnicion: [],
    postre: [],
    bebida: [],
    vino: [],
    extra: [],
  };
}

export function itemsMapFromTemplate(tpl: PackageTemplate): QuoteItemsMap {
  return {
    entrada: tpl.items.entrada ?? [],
    ensalada: tpl.items.ensalada ?? [],
    corte: tpl.items.corte ?? [],
    guarnicion: tpl.items.guarnicion ?? [],
    postre: tpl.items.postre ?? [],
    bebida: tpl.items.bebida ?? [],
    vino: tpl.items.vino ?? [],
    extra: tpl.items.extra ?? [],
  };
}
