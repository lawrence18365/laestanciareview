/**
 * Turn a name like "JUAN CARLOS" into a staff code like "JUANCARLOS".
 * If duplicates exist in the same restaurant, a numeric suffix is appended.
 */
export function makeCode(name: string, usedCodes: Set<string>): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^A-Za-z]/g, '')       // remove spaces/punctuation
    .toUpperCase();
  let code = base;
  let i = 2;
  while (usedCodes.has(code)) {
    code = `${base}${i}`;
    i++;
  }
  usedCodes.add(code);
  return code;
}
