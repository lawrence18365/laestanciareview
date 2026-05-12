import Link from 'next/link';

type PolicySection = {
  title: string;
  body: string[];
};

type PolicyPageProps = {
  title: string;
  updated: string;
  intro: string;
  sections: PolicySection[];
};

export default function PolicyPage({ title, updated, intro, sections }: PolicyPageProps) {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#f5f0eb',
        color: '#1c1917',
        fontFamily: 'var(--font-sans, -apple-system, BlinkMacSystemFont, sans-serif)',
        padding: '48px 20px',
      }}
    >
      <article
        style={{
          maxWidth: 860,
          margin: '0 auto',
          background: '#fff',
          border: '1px solid #1c1917',
          padding: 'clamp(28px, 6vw, 64px)',
          boxShadow: '8px 8px 0 rgba(28, 25, 23, 0.08)',
        }}
      >
        <Link
          href="/"
          style={{
            color: '#57534e',
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textDecoration: 'none',
            textTransform: 'uppercase',
          }}
        >
          RateTap
        </Link>
        <h1
          style={{
            fontFamily: 'var(--font-serif, Georgia, serif)',
            fontSize: 'clamp(36px, 7vw, 64px)',
            lineHeight: 1,
            margin: '28px 0 12px',
          }}
        >
          {title}
        </h1>
        <p style={{ color: '#78716c', margin: '0 0 32px' }}>Actualizado: {updated}</p>
        <p style={{ fontSize: 18, lineHeight: 1.7, marginBottom: 36 }}>{intro}</p>

        {sections.map((section) => (
          <section key={section.title} style={{ borderTop: '1px solid #e7e5e4', paddingTop: 28, marginTop: 28 }}>
            <h2 style={{ fontSize: 20, margin: '0 0 12px' }}>{section.title}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph} style={{ color: '#44403c', lineHeight: 1.75, margin: '0 0 14px' }}>
                {paragraph}
              </p>
            ))}
          </section>
        ))}

        <footer style={{ borderTop: '1px solid #e7e5e4', marginTop: 36, paddingTop: 24, color: '#57534e', fontSize: 14 }}>
          Contacto: <a href="mailto:hello@ratetapmx.com" style={{ color: '#1c1917', fontWeight: 700 }}>hello@ratetapmx.com</a>
          <div style={{ marginTop: 14, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <Link href="/privacy" style={{ color: '#1c1917' }}>Privacidad</Link>
            <Link href="/terms" style={{ color: '#1c1917' }}>Términos</Link>
            <Link href="/cookies" style={{ color: '#1c1917' }}>Cookies</Link>
          </div>
        </footer>
      </article>
    </main>
  );
}
