// Stress test for the quote builder logic.
// Does NOT hit the DB — exercises pure computation: templates, pricing, serialization.

import {
  MENU,
  TEMPLATES,
  PAQUETES_BEBIDAS,
  computePricing,
  emptyConfig,
  dishById,
  fmtMXN,
  type QuoteConfig,
} from '../src/lib/quote-data';

let fail = 0;
let pass = 0;
const log = (ok: boolean, msg: string, detail?: unknown) => {
  if (ok) { pass++; console.log('  PASS', msg); }
  else { fail++; console.error('  FAIL', msg, detail ?? ''); }
};

console.log('\n══════ 1. Template dish refs all exist ══════');
for (const t of TEMPLATES) {
  const ids: string[] = [];
  if (t.config.sopas) ids.push(...t.config.sopas);
  if (t.config.platos) ids.push(...t.config.platos);
  if (t.config.postres) ids.push(...t.config.postres);
  if (t.config.cantidades) ids.push(...Object.keys(t.config.cantidades));
  const missing = ids.filter((id) => !dishById(id));
  log(missing.length === 0, `${t.id}: ${ids.length} dish refs`, missing.length ? { missing } : undefined);
  if (t.config.bebidas) {
    const pkg = PAQUETES_BEBIDAS.find((p) => p.id === t.config.bebidas);
    log(!!pkg, `${t.id}: bebida pkg '${t.config.bebidas}' exists`);
  }
}

console.log('\n══════ 2. MENU uniqueness ══════');
const ids = MENU.map((d) => d.id);
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
log(dupes.length === 0, `MENU has ${MENU.length} dishes, all unique`, dupes.length ? { dupes } : undefined);

console.log('\n══════ 3. Pricing: Individual mode ══════');
{
  const c = emptyConfig('individual');
  c.evento.personas = 50;
  c.evento.cliente = 'Boda García';
  c.indiv.precioPP = 1000;
  c.indiv.costoPP = 450;
  c.indiv.bebidas = 'basico'; // +$300/pp
  c.indiv.incluyeIVA = true;
  c.indiv.incluyeServicio = false;
  const p = computePricing(c);
  // Expected: subtotalVenta = (1000+300)*50 = 65,000. IVA included, no service.
  // precioTotalFinal = 65,000. precioFinalPP = 1,300.
  console.log(`  personas=50 precioPP=1000 +bebidas300 IVA incluido:`);
  console.log(`    subtotalVenta=${fmtMXN(p.subtotalVenta)}   total=${fmtMXN(p.precioTotalFinal)}   pp=${fmtMXN(p.precioFinalPP)}`);
  log(p.subtotalVenta === 65000, 'subtotalVenta = $65,000', p.subtotalVenta);
  log(p.precioTotalFinal === 65000, 'total = $65,000 (IVA incluido)', p.precioTotalFinal);
  log(p.precioFinalPP === 1300, 'precio/pp = $1,300', p.precioFinalPP);
  log(p.gananciaBruta > 0, 'ganancia positiva', p.gananciaBruta);
}

console.log('\n══════ 4. Pricing: Individual + servicio + IVA not included ══════');
{
  const c = emptyConfig('individual');
  c.evento.personas = 10;
  c.indiv.precioPP = 1000;
  c.indiv.costoPP = 450;
  c.indiv.bebidas = 'barra-libre-sin-alcohol'; // +$200/pp
  c.indiv.incluyeIVA = false;
  c.indiv.incluyeServicio = true;
  const p = computePricing(c);
  // subtotalVenta = (1000+200)*10 = 12,000
  // servicio = 12,000 * 0.15 = 1,800
  // conServicio = 13,800
  // iva = 13,800 * 0.16 = 2,208
  // total = 16,008
  console.log(`  personas=10 precioPP=1000 +bebida200 +15%serv +16%IVA:`);
  console.log(`    subtotal=${fmtMXN(p.subtotalVenta)}  serv=${fmtMXN(p.servicioAmt)}  iva=${fmtMXN(p.ivaAmt)}  total=${fmtMXN(p.precioTotalFinal)}`);
  log(Math.abs(p.subtotalVenta - 12000) < 1, 'subtotal $12,000');
  log(Math.abs(p.servicioAmt - 1800) < 1, 'servicio ≈ $1,800');
  log(Math.abs(p.precioTotalFinal - 16008) < 2, 'total ≈ $16,008');
}

console.log('\n══════ 5. Pricing: 3-opciones mode ══════');
{
  const c = emptyConfig('opciones');
  c.evento.personas = 100;
  c.opciones.tiers = [
    { letra: 'A', precio: 1100, platos: 'Arrachera' },
    { letra: 'B', precio: 1250, platos: 'NY' },
    { letra: 'C', precio: 1400, platos: 'Rib-Eye' },
  ];
  c.opciones.bebidas = 'basico'; // +$300/pp
  c.opciones.incluyeIVA = true;
  c.opciones.incluyeServicio = false;
  const p = computePricing(c);
  // avgTier = (1100+1250+1400)/3 = 1250
  // subtotal = (1250+300)*100 = 155,000
  console.log(`  personas=100 tiers=[1100,1250,1400] avg=1250 +bebida300:`);
  console.log(`    subtotal=${fmtMXN(p.subtotalVenta)}  total=${fmtMXN(p.precioTotalFinal)}  pp=${fmtMXN(p.precioFinalPP)}`);
  log(p.subtotalVenta === 155000, 'subtotal $155,000');
  log(p.precioFinalPP === 1550, 'pp $1,550 (avg tier + bebida)');
}

console.log('\n══════ 6. Pricing: Asado mode ══════');
{
  const c = emptyConfig('asado');
  c.evento.personas = 20;
  c.asado.cantidades = {
    'e6': 3,    // Chorizo $150 x3 = 450
    'pa19': 4,  // Arrachera Pibe $420 x4 = 1680
    'g1': 5,    // Papas francesa $60 x5 = 300
  };
  c.asado.markup = 40;
  c.asado.bebidas = 'basico'; // $300 x 20 = 6000
  c.asado.incluyeIVA = true;
  c.asado.incluyeServicio = false;
  const p = computePricing(c);
  // Expectation is derived from MENU so it survives future menu-price edits.
  const cost = Object.entries(c.asado.cantidades).reduce(
    (sum, [id, qty]) => sum + dishById(id)!.precio * qty,
    0,
  );
  const expected = cost * 1.40 + 300 * 20;
  console.log(`  cantidades=[3 chorizo, 4 arrachera, 5 papas] markup=40% +bebida:`);
  console.log(`    cost=${fmtMXN(p.costoTotal)}  subtotal=${fmtMXN(p.subtotalVenta)}  total=${fmtMXN(p.precioTotalFinal)}  pp=${fmtMXN(p.precioFinalPP)}`);
  log(Math.abs(p.subtotalVenta - expected) < 0.01, `subtotalVenta ${fmtMXN(expected)}`, p.subtotalVenta);
}

console.log('\n══════ 7. Pricing: 0 personas edge case ══════');
{
  const c = emptyConfig('individual');
  c.evento.personas = 0;  // user clears the field
  c.indiv.precioPP = 1000;
  c.indiv.costoPP = 400;
  c.indiv.bebidas = 'basico';
  c.indiv.incluyeIVA = true;
  const p = computePricing(c);
  console.log(`  personas=0 → treated as 1 internally; pp should still compute`);
  log(Number.isFinite(p.precioFinalPP), 'precioFinalPP is finite', p.precioFinalPP);
  log(Number.isFinite(p.precioTotalFinal), 'total is finite', p.precioTotalFinal);
}

console.log('\n══════ 8. Pricing: Empty asado (no items) ══════');
{
  const c = emptyConfig('asado');
  c.evento.personas = 10;
  c.asado.cantidades = {};
  c.asado.markup = 40;
  c.asado.bebidas = 'a-la-carta'; // $0
  const p = computePricing(c);
  console.log(`  empty asado: costo=${p.costoTotal} subtotal=${p.subtotalVenta} total=${p.precioTotalFinal}`);
  log(p.subtotalVenta === 0, 'subtotal $0 when no items');
  log(p.precioFinalPP === 0, 'pp $0');
  log(p.margenPct === 0, 'margen 0% (no revenue)');
}

console.log('\n══════ 9. JSON round-trip (save → load) ══════');
{
  const original = emptyConfig('individual');
  original.evento.cliente = 'Familia Pérez';
  original.evento.telefono = '33 1234 5678';
  original.evento.personas = 25;
  original.indiv.sopas = ['s6', 's7'];
  original.indiv.platos = ['pa19', 'm1'];
  original.indiv.postres = ['po2'];
  original.indiv.bebidas = 'premium';
  original.indiv.precioPP = 1500;
  original.indiv.costoPP = 600;
  const serialized = JSON.stringify(original);
  const parsed = JSON.parse(serialized) as QuoteConfig;
  log(parsed.evento.cliente === 'Familia Pérez', 'client name round-trip');
  log(parsed.indiv.sopas.length === 2, 'sopas array round-trip');
  log(parsed.indiv.bebidas === 'premium', 'bebida round-trip');
  const p1 = computePricing(original);
  const p2 = computePricing(parsed);
  log(p1.precioFinalPP === p2.precioFinalPP, 'pricing deterministic across round-trip');
}

console.log('\n══════ 10. WhatsApp URL encoding ══════');
{
  const phone = '33 1234 5678'.replace(/\D/g, '');
  const msg = 'Hola María 👋\n💰 *$1,200 por persona*\nTotal: $60,000';
  const link = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  log(phone === '3312345678', 'phone digits extracted');
  log(link.includes('Hola%20Mar%C3%ADa'), 'unicode encoded', link.slice(0, 80));
  log(link.includes('%F0%9F%92%B0'), 'emoji encoded (💰)');
  log(!link.includes(' '), 'no raw spaces');
}

console.log('\n══════ 11. Safety: malformed inputs ══════');
{
  const c = emptyConfig('carta');
  c.evento.personas = 10;
  c.carta.cantidades = { 'not-a-real-id': 5, 'pa19': 2 };  // unknown id mixed with real
  c.carta.markup = 40;
  c.carta.bebidas = 'a-la-carta';
  const p = computePricing(c);
  console.log(`  carta with unknown dish id: cost=${fmtMXN(p.costoTotal)} subtotal=${fmtMXN(p.subtotalVenta)}`);
  log(Number.isFinite(p.precioTotalFinal), 'survives unknown dish id');
  // Derived from MENU: only pa19 counts, with a 40% markup.
  const expectedSubtotal = dishById('pa19')!.precio * 2 * 1.40;
  log(Math.abs(p.subtotalVenta - expectedSubtotal) < 0.01, 'only valid dishes counted', p.subtotalVenta);
}

console.log('\n══════ 12. Very large group ══════');
{
  const c = emptyConfig('individual');
  c.evento.personas = 500;
  c.indiv.precioPP = 1500;
  c.indiv.costoPP = 500;
  c.indiv.bebidas = 'premium'; // +$400
  c.indiv.incluyeIVA = false;
  c.indiv.incluyeServicio = true;
  const p = computePricing(c);
  console.log(`  500 pax × $1,500 + $400 bebida, +15%serv +16%IVA:`);
  console.log(`    subtotal=${fmtMXN(p.subtotalVenta)} total=${fmtMXN(p.precioTotalFinal)}`);
  log(p.subtotalVenta === 950000, 'subtotal $950k');
  log(p.precioTotalFinal > 1_000_000, 'total over $1M (big event)', p.precioTotalFinal);
  log(Number.isFinite(p.precioTotalFinal), 'no overflow');
}

console.log('\n══════ 12b. Pastel Personalizado per-person pricing ══════');
{
  const c = emptyConfig('carta');
  c.evento.personas = 30;
  c.carta.cantidades = { 'po7': 1 };  // 1 pastel for 30 pax
  c.carta.markup = 0;                 // strip markup for easy math
  c.carta.bebidas = 'a-la-carta';     // $0
  c.carta.incluyeIVA = true;
  const p = computePricing(c);
  console.log(`  1 pastel × 30 pax @ $20/pp → cost should be $600 (not $20)`);
  console.log(`    cost=${fmtMXN(p.costoTotal)}  subtotal=${fmtMXN(p.subtotalVenta)}`);
  log(p.subtotalVenta === 600, 'pastel scales by personas', p.subtotalVenta);
}

console.log('\n══════ 12c. WhatsApp phone normalization (MX) ══════');
{
  const norm = (raw: string): string => {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 10) return '52' + digits;
    if (digits.length === 11 && digits.startsWith('1')) return '52' + digits.slice(1);
    return digits;
  };
  log(norm('33 1234 5678') === '523312345678', 'local 10-digit → 52 prefix');
  log(norm('+52 33 1234 5678') === '523312345678', 'already-prefixed left alone');
  log(norm('52 33 1234 5678') === '523312345678', 'no-plus already-prefixed left alone');
  log(norm('1 33 1234 5678') === '523312345678', '11-digit "1+10" habit corrected');
  log(norm('') === '', 'empty stays empty');
}

console.log('\n══════ 13. All 4 templates apply cleanly ══════');
for (const t of TEMPLATES) {
  const c = emptyConfig(t.modo);
  // mimic applyTemplate
  if (t.modo === 'individual') {
    c.indiv = { ...c.indiv, ...t.config, sopas: t.config.sopas ?? [], platos: t.config.platos ?? [], postres: t.config.postres ?? [] } as typeof c.indiv;
  } else if (t.modo === 'opciones') {
    c.opciones = { ...c.opciones, ...t.config, sopas: t.config.sopas ?? [], postres: t.config.postres ?? [] } as typeof c.opciones;
  } else if (t.modo === 'asado') {
    c.asado = { ...c.asado, ...t.config, cantidades: t.config.cantidades ?? {} } as typeof c.asado;
  }
  c.evento.personas = 30;
  const p = computePricing(c);
  console.log(`  ${t.nombre}: pp=${fmtMXN(p.precioFinalPP)} total=${fmtMXN(p.precioTotalFinal)} margen=${p.margenPct}%`);
  log(Number.isFinite(p.precioFinalPP) && p.precioFinalPP >= 0, `${t.id} yields finite pricing`);
}

console.log(`\n══════ RESULT ══════`);
console.log(`  ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
