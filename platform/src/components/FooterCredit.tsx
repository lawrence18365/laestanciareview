/**
 * Agency credit for public footers (login, legal, guest-facing pages).
 *
 * The utm_* parameters tell Nova North Studio which property sent the click, so
 * keep them intact — a bare https://novanorthstudio.com/ link loses the
 * attribution. Colour is inherited from the surrounding footer; globals.css
 * pins `.footer-credit a` to `color: inherit` so it never shows the default
 * blue on the dark audit page.
 */
const CREDIT_URL =
  'https://novanorthstudio.com/?utm_source=app.ratetapmx.com&utm_medium=referral&utm_campaign=site-credit';

export default function FooterCredit() {
  return (
    <span className="footer-credit">
      Site by <a href={CREDIT_URL}>Nova North Studio</a>
    </span>
  );
}
