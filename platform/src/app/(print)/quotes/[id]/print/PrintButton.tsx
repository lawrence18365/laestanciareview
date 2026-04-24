'use client';

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      style={{
        padding: '0.5rem 1.5rem',
        fontSize: '0.72rem',
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        background: '#fff',
        color: '#1a1a1a',
        border: 'none',
        cursor: 'pointer',
      }}
    >
      Imprimir / Guardar PDF
    </button>
  );
}
