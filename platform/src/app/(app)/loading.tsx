export default function AppLoading() {
  return (
    <>
      <style>{`
        @keyframes rt-pulse {
          0%, 100% { opacity: 0.15; }
          50% { opacity: 0.3; }
        }
        .rt-skeleton {
          background: var(--text-main, #111111);
          animation: rt-pulse 1.8s ease-in-out infinite;
          border-radius: 0;
        }
      `}</style>
      <div style={{ padding: '2rem', maxWidth: 1100, margin: '0 auto' }}>
        {/* Title bar */}
        <div className="rt-skeleton" style={{ width: '35%', height: 24, marginBottom: '1.5rem' }} />

        {/* Stat cards row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
          <div className="rt-skeleton" style={{ height: 96 }} />
          <div className="rt-skeleton" style={{ height: 96, animationDelay: '0.15s' }} />
          <div className="rt-skeleton" style={{ height: 96, animationDelay: '0.3s' }} />
        </div>

        {/* Table header */}
        <div className="rt-skeleton" style={{ width: '22%', height: 14, marginBottom: '1rem' }} />

        {/* Table rows */}
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rt-skeleton"
            style={{ height: 44, marginBottom: 6, animationDelay: `${i * 0.1}s` }}
          />
        ))}
      </div>
    </>
  );
}
