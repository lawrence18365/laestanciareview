'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Stats {
  todayTotal: number;
  todayFiveStars: number;
  weekTotal: number;
  rank: number | null;
  teamSize: number;
  series: { date: string; count: number }[];
}

interface Props {
  staffName: string;
  restaurantName: string;
  logoSrc: string;
  logoDarkBg: boolean;
  stats: Stats;
}

const GOLD = '#E8B84B';

function statusFor(rank: number | null, teamSize: number) {
  if (rank === 1) return { emoji: '🏆', label: '#1 de la semana', color: GOLD };
  if (rank === 2) return { emoji: '🥈', label: `Top 3 · #2 de ${teamSize}`, color: '#CBD5E1' };
  if (rank === 3) return { emoji: '🥉', label: `Top 3 · #3 de ${teamSize}`, color: '#D9A066' };
  if (rank && rank > 3) return { emoji: '⭐', label: `#${rank} de ${teamSize} esta semana`, color: '#9CA3AF' };
  return { emoji: '👋', label: 'Empieza tu semana', color: '#9CA3AF' };
}

export default function MeseroCard({
  staffName,
  restaurantName,
  logoSrc,
  logoDarkBg,
  stats,
}: Props) {
  const router = useRouter();
  const [updatedAt, setUpdatedAt] = useState<string>('');

  // Keep the scoreboard live during service without a manual reload.
  useEffect(() => {
    const fmt = () =>
      new Date().toLocaleTimeString('es-MX', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Mexico_City',
      });
    // Defer the first set so it isn't a synchronous setState in the effect body.
    const initial = setTimeout(() => setUpdatedAt(fmt()), 0);
    const id = setInterval(() => {
      router.refresh();
      setUpdatedAt(fmt());
    }, 60_000);
    return () => {
      clearTimeout(initial);
      clearInterval(id);
    };
  }, [router]);

  const status = statusFor(stats.rank, stats.teamSize);
  const firstName = staffName.split(' ')[0];

  return (
    <main
      style={{
        minHeight: '100dvh',
        background: 'radial-gradient(120% 80% at 50% 0%, #1c1c22 0%, #0b0b0d 60%)',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '1.75rem 1.1rem 2.5rem',
        fontFamily: 'var(--font-sans, system-ui, sans-serif)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
        {/* Header */}
        <header style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
          <span
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: logoDarkBg ? '#fff' : 'rgba(255,255,255,0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </span>
          <div style={{ lineHeight: 1.15 }}>
            <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.55)' }}>{restaurantName}</div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>Mi tablero</div>
          </div>
        </header>

        {/* Greeting + status */}
        <div style={{ textAlign: 'center', marginTop: '0.4rem' }}>
          <div style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: '0.7rem' }}>
            Hola, {firstName}
          </div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              borderRadius: 999,
              border: `1px solid ${status.color}`,
              background: 'rgba(255,255,255,0.04)',
              fontWeight: 700,
              fontSize: '0.9rem',
              color: status.color,
            }}
          >
            <span style={{ fontSize: '1.1rem' }}>{status.emoji}</span>
            {status.label}
          </div>
        </div>

        {/* Hero: today */}
        <section
          style={{
            background: 'linear-gradient(160deg, rgba(232,184,75,0.16), rgba(255,255,255,0.03))',
            border: '1px solid rgba(232,184,75,0.35)',
            borderRadius: 20,
            padding: '1.6rem 1rem',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontSize: '0.72rem',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.6)',
              marginBottom: '0.3rem',
            }}
          >
            Reseñas hoy
          </div>
          <div style={{ fontSize: '5rem', fontWeight: 800, lineHeight: 1, color: GOLD }}>
            {stats.todayTotal}
          </div>
          <div style={{ marginTop: '0.5rem', fontSize: '0.95rem', color: 'rgba(255,255,255,0.7)' }}>
            {stats.todayFiveStars} de 5 estrellas ⭐
          </div>
        </section>

        {/* Week + rank */}
        <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
          <Stat label="Esta semana" value={stats.weekTotal} suffix="reseñas" />
          <Stat
            label="Tu lugar"
            value={stats.rank ? `#${stats.rank}` : '—'}
            suffix={stats.rank ? `de ${stats.teamSize}` : 'sin reseñas aún'}
          />
        </section>

        {/* 7-day trend */}
        <section
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 16,
            padding: '1rem 1rem 0.85rem',
          }}
        >
          <div
            style={{
              fontSize: '0.72rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.55)',
              marginBottom: '0.8rem',
            }}
          >
            Últimos 7 días
          </div>
          <Sparkbars series={stats.series} />
        </section>

        <div style={{ textAlign: 'center', fontSize: '0.72rem', color: 'rgba(255,255,255,0.35)' }}>
          Actualizado {updatedAt} · se actualiza solo
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value, suffix }: { label: string; value: number | string; suffix: string }) {
  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16,
        padding: '1.1rem 0.9rem',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontSize: '0.68rem',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.5)',
          marginBottom: '0.4rem',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: '2.4rem', fontWeight: 800, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)', marginTop: '0.3rem' }}>{suffix}</div>
    </div>
  );
}

const DAY_LABELS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

function Sparkbars({ series }: { series: { date: string; count: number }[] }) {
  const max = Math.max(1, ...series.map((s) => s.count));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.45rem', height: 84 }}>
      {series.map((s, i) => {
        const h = Math.round((s.count / max) * 64);
        const isToday = i === series.length - 1;
        // 'en-CA' date string → weekday letter (parse as local noon to avoid TZ shift).
        const dow = new Date(`${s.date}T12:00:00`).getDay();
        return (
          <div key={s.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem' }}>
            <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.6)', height: 12 }}>
              {s.count > 0 ? s.count : ''}
            </div>
            <div
              style={{
                width: '100%',
                height: Math.max(4, h),
                borderRadius: 5,
                background: isToday ? GOLD : 'rgba(255,255,255,0.18)',
                transition: 'height 0.3s ease',
              }}
            />
            <div style={{ fontSize: '0.6rem', color: isToday ? GOLD : 'rgba(255,255,255,0.4)', fontWeight: isToday ? 700 : 400 }}>
              {DAY_LABELS[dow]}
            </div>
          </div>
        );
      })}
    </div>
  );
}
