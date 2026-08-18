const EMAIL_CANDIDATE_PATTERN = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9\-]+(?:\.[a-zA-Z0-9\-]+)+/g;
const STRICT_EMAIL_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9._%+\-]{0,62}[a-zA-Z0-9])?@[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,63}$/;
const ASSET_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'css', 'js']);

function decodeEmailEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&#0*64;|&#x0*40;/gi, '@')
    .replace(/&#0*46;|&#x0*2e;/gi, '.')
    .replace(/&nbsp;|&#0*160;|&#x0*a0;/gi, ' ');
}

function validateEmail(candidate: string, stripPhonePrefix: boolean): string | null {
  const atIndex = candidate.lastIndexOf('@');
  if (atIndex <= 0) return null;

  let localPart = candidate.slice(0, atIndex);
  const domain = candidate.slice(atIndex + 1);

  if (stripPhonePrefix) {
    const prefix = localPart.match(/^[+\d][\d.-]*(?=[a-zA-Z])/u)?.[0];
    const digitCount = prefix?.replace(/\D/g, '').length ?? 0;
    if (prefix && digitCount >= 7) {
      localPart = localPart.slice(prefix.length);
    }
  }

  if (/^[\d._%+\-]+$/.test(localPart)) return null;

  const email = `${localPart}@${domain}`;
  if (email.length > 254 || localPart.length > 64 || domain.length > 253) return null;
  if (localPart.includes('..') || !STRICT_EMAIL_PATTERN.test(email)) return null;

  const lowerEmail = email.toLowerCase();
  const lowerLocalPart = localPart.toLowerCase();
  const lowerDomain = domain.toLowerCase();
  const extension = lowerDomain.split('.').at(-1);

  if (extension && ASSET_EXTENSIONS.has(extension)) return null;
  if (/^(?:no-?reply|wordpress)(?:[._+\-]|$)/.test(lowerLocalPart)) return null;
  if (lowerEmail.includes('sentry') || lowerEmail.includes('example')) return null;
  if (lowerDomain === 'sentry.io' || lowerDomain.endsWith('.sentry.io')) return null;

  return email;
}

export function extractEmailFromHtml(html: string): string | null {
  const decodedHtml = decodeEmailEntities(html);
  const mailtoPattern = new RegExp(`mailto:\\s*(${EMAIL_CANDIDATE_PATTERN.source})`, 'i');
  const mailtoCandidate = decodedHtml.match(mailtoPattern)?.[1];
  if (mailtoCandidate) {
    const email = validateEmail(mailtoCandidate, false);
    if (email) return email;
  }

  const text = decodedHtml.replace(/<[^>]*>/g, ' ');
  for (const match of text.matchAll(EMAIL_CANDIDATE_PATTERN)) {
    const email = validateEmail(match[0], true);
    if (email) return email;
  }

  return null;
}
