import {
  computeTierPricing,
  computePricing,
  emptyConfig,
} from '../src/lib/quote-data';

const c = emptyConfig('opciones');
c.evento.personas = 50;
c.opciones.bebidas = 'basico';
c.opciones.incluyeIVA = true;
c.opciones.incluyeServicio = false;
c.opciones.tiers = [
  { letra: 'A', precio: 1100, platos: 'A', costoPP: 0 },
  { letra: 'B', precio: 1250, platos: 'B', costoPP: 0 },
  { letra: 'C', precio: 1400, platos: 'C', costoPP: 0 },
];

console.log('Case 1 — IVA included, no servicio, bebidas Básico ($200/pp), 50 pax:');
for (const t of computeTierPricing(c)) {
  console.log(`  Opción ${t.letra}: $${Math.round(t.pricePP)}/pp · total $${Math.round(t.total).toLocaleString('es-MX')}`);
}
const p1 = computePricing(c);
console.log(`  Legacy avg: $${Math.round(p1.precioFinalPP)}/pp · total $${Math.round(p1.precioTotalFinal).toLocaleString('es-MX')}`);

console.log('\nCase 2 — Servicio 15% active, IVA NOT included:');
c.opciones.incluyeIVA = false;
c.opciones.incluyeServicio = true;
for (const t of computeTierPricing(c)) {
  console.log(`  Opción ${t.letra}: $${Math.round(t.pricePP)}/pp · total $${Math.round(t.total).toLocaleString('es-MX')}`);
}

console.log('\nCase 3 — Brindis section $300/pp, IVA included, no servicio:');
c.opciones.incluyeIVA = true;
c.opciones.incluyeServicio = false;
c.extraSections = [{ id: 'sec-x', nombre: 'Brindis', descripcion: '', precioPP: 300, costoPP: 0 }];
for (const t of computeTierPricing(c)) {
  console.log(`  Opción ${t.letra}: $${Math.round(t.pricePP)}/pp · total $${Math.round(t.total).toLocaleString('es-MX')}`);
}

console.log('\nCase 4 — empty tiers (all precio=0): should return empty array');
const c2 = emptyConfig('opciones');
c2.evento.personas = 50;
console.log(`  result.length = ${computeTierPricing(c2).length}`);

console.log('\nCase 5 — non-opciones mode: should return empty array');
const c3 = emptyConfig('individual');
c3.evento.personas = 50;
console.log(`  result.length = ${computeTierPricing(c3).length}`);
