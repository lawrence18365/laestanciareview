import { describe, it, expect } from 'vitest';
import { csvEscape, splitName, guestsToMetaCsv, META_AUDIENCE_HEADERS } from '@/lib/guest-csv';

describe('csvEscape', () => {
  it('passes plain ASCII through unchanged', () => {
    expect(csvEscape('hello')).toBe('hello');
  });

  it('wraps values containing commas in double quotes', () => {
    expect(csvEscape('Apt 3, Colonia Roma')).toBe('"Apt 3, Colonia Roma"');
  });

  it('wraps values containing newlines in double quotes', () => {
    expect(csvEscape('line one\nline two')).toBe('"line one\nline two"');
  });

  it('doubles internal quotes and wraps', () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  it('handles carriage returns (Windows line endings)', () => {
    expect(csvEscape('a\r\nb')).toBe('"a\r\nb"');
  });

  it('preserves Unicode characters untouched', () => {
    expect(csvEscape('García Peña')).toBe('García Peña');
  });

  it('handles the empty string', () => {
    expect(csvEscape('')).toBe('');
  });
});

describe('splitName', () => {
  it('splits on the first space only', () => {
    expect(splitName('Juan Carlos García')).toEqual({ fn: 'Juan', ln: 'Carlos García' });
  });

  it('returns fn only when the name is a single word', () => {
    expect(splitName('Juan')).toEqual({ fn: 'Juan', ln: '' });
  });

  it('trims leading and trailing whitespace', () => {
    expect(splitName('  Juan  Carlos  ')).toEqual({ fn: 'Juan', ln: 'Carlos' });
  });

  it('returns empty strings for all-whitespace input', () => {
    expect(splitName('   ')).toEqual({ fn: '', ln: '' });
  });

  it('handles the empty string', () => {
    expect(splitName('')).toEqual({ fn: '', ln: '' });
  });

  it('preserves accented characters', () => {
    expect(splitName('José Peña')).toEqual({ fn: 'José', ln: 'Peña' });
  });
});

describe('guestsToMetaCsv', () => {
  it('emits exactly the Meta Custom Audience headers', () => {
    const csv = guestsToMetaCsv([]);
    expect(csv).toBe(META_AUDIENCE_HEADERS.join(','));
  });

  it('prepends "+" to whatsapp values that lack one', () => {
    const csv = guestsToMetaCsv([{ name: 'Juan García', whatsapp: '525512345678' }]);
    const [, row] = csv.split('\n');
    expect(row.startsWith('+525512345678,')).toBe(true);
  });

  it('does not double the "+" when already present', () => {
    const csv = guestsToMetaCsv([{ name: 'Juan', whatsapp: '+525512345678' }]);
    const [, row] = csv.split('\n');
    expect(row.startsWith('+525512345678,')).toBe(true);
  });

  it('emits one data row per guest in input order', () => {
    const csv = guestsToMetaCsv([
      { name: 'Ana', whatsapp: '525511111111' },
      { name: 'Bob', whatsapp: '525522222222' },
    ]);
    expect(csv.split('\n')).toHaveLength(3); // header + 2 rows
  });

  it('fills email blank and country "mx" (both are required columns)', () => {
    const csv = guestsToMetaCsv([{ name: 'Juan García', whatsapp: '525512345678' }]);
    const [, row] = csv.split('\n');
    const cols = row.split(',');
    // phone, fn, ln, email (blank), country ("mx")
    expect(cols[3]).toBe('');
    expect(cols[4]).toBe('mx');
  });

  it('escapes names containing commas', () => {
    const csv = guestsToMetaCsv([{ name: 'Rodríguez, José', whatsapp: '525512345678' }]);
    // Name is "Rodríguez," (becomes fn with the comma, ln is "José")
    // csvEscape on "Rodríguez," produces "\"Rodríguez,\""
    expect(csv).toContain('"Rodríguez,"');
  });
});
