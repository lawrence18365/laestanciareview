'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import React from 'react';

/* ── Types ──────────────────────────────────────── */

interface LiveTotals {
  totalScans: number;
  fiveStarCount: number;
  belowFourCount: number;
  sentToGoogle: number;
}

interface StaffStat {
  staffId: number | null;
  staffName: string | null;
  staffCode: string | null;
  totalScans: number;
  fiveStarCount: number;
  belowFourCount: number;
  avgRating: number;
  todayScans: number;
  todayFiveStars: number;
  todayBelowFour: number;
}

interface StaffMember {
  id: number;
  name: string;
  code: string;
  active: boolean;
}

interface RecentScan {
  id: number;
  staffName: string | null;
  rating: number;
  sentToGoogle: boolean;
  createdAt: string | Date;
}

interface LiveData {
  week: LiveTotals;
  lastWeek: LiveTotals;
  today: LiveTotals;
  staffStats: StaffStat[];
  allStaff: StaffMember[];
  recentScans: RecentScan[];
}

interface MergedStaff {
  id: number;
  name: string;
  code: string;
  weekScans: number;
  weekFiveStars: number;
  weekBelowFour: number;
  avgRating: number;
  todayScans: number;
  todayFiveStars: number;
  todayBelowFour: number;
}

interface GoogleTrend {
  baselineRating: number;
  baselineReviewCount: number;
  baselineDate: string | Date;
  currentRating: number;
  currentReviewCount: number;
  currentDate: string | Date;
  ratingChange: number;
  reviewsGained: number;
}

interface Props {
  restaurantName: string;
  logoSrc: string;
  logoDarkBg: boolean;
  googleRating: number | null;
  googleReviewCount: number | null;
  googleTrend: GoogleTrend | null;
  initialData: LiveData;
}

/* ── Colors (Classy Editorial Light Theme) ──────── */

const C = {
  bgBase: '#F9F9F8', // Soft warm white
  panelBg: '#FFFFFF',
  panelBorder: '#E2E2E2',
  borderDark: '#111111',
  textMain: '#111111',
  textMuted: '#666666',
  textDim: '#A3A3A3',
  gold: '#D97706',
  green: '#059669',
  red: '#DC2626',
  blue: '#2563EB',
};

/* ── Helpers ────────────────────────────────────── */

function mergeStaff(data: LiveData): MergedStaff[] {
  const statsMap = new Map<number, StaffStat>();
  for (const s of data.staffStats) {
    if (s.staffId != null) statsMap.set(s.staffId, s);
  }

  const merged: MergedStaff[] = data.allStaff.map((s) => {
    const stat = statsMap.get(s.id);
    return {
      id: s.id,
      name: s.name,
      code: s.code,
      weekScans: stat?.totalScans ?? 0,
      weekFiveStars: stat?.fiveStarCount ?? 0,
      weekBelowFour: stat?.belowFourCount ?? 0,
      avgRating: stat?.avgRating ?? 0,
      todayScans: stat?.todayScans ?? 0,
      todayFiveStars: stat?.todayFiveStars ?? 0,
      todayBelowFour: stat?.todayBelowFour ?? 0,
    };
  });

  for (const s of data.staffStats) {
    if (s.staffId == null || !data.allStaff.some((a) => a.id === s.staffId)) {
      merged.push({
        id: -(merged.length + 1),
        name: s.staffName ?? s.staffCode ?? 'Unknown',
        code: s.staffCode ?? '',
        weekScans: s.totalScans,
        weekFiveStars: s.fiveStarCount,
        weekBelowFour: s.belowFourCount,
        avgRating: s.avgRating,
        todayScans: s.todayScans,
        todayFiveStars: s.todayFiveStars,
        todayBelowFour: s.todayBelowFour,
      });
    }
  }

  merged.sort((a, b) => b.weekScans - a.weekScans);
  return merged;
}

function relativeTime(date: Date, now: Date): string {
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return 'justo ahora';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;
  return `hace ${Math.floor(hours / 24)}d`;
}

/* ── Main Component ─────────────────────────────── */

export default function LiveView({ restaurantName, logoSrc, logoDarkBg, googleRating: initialGoogleRating, googleReviewCount: initialGoogleReviewCount, googleTrend: initialGoogleTrend, initialData }: Props) {
  const [data, setData] = useState<LiveData>(initialData);
  const [gRating, setGRating] = useState(initialGoogleRating);
  const [gReviewCount, setGReviewCount] = useState(initialGoogleReviewCount);
  const [gTrend, setGTrend] = useState<GoogleTrend | null>(initialGoogleTrend);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [clock, setClock] = useState(new Date());
  const containerRef = useRef<HTMLDivElement>(null);

  const team = useMemo(() => mergeStaff(data), [data]);

  // Compute daily winners: anyone with >0 scans today, sorted primarily by todayScans
  const todayTopPerformers = useMemo(() => {
    const todayActive = team.filter((s) => s.todayScans > 0);
    return todayActive.sort(
      (a, b) => b.todayScans - a.todayScans || b.avgRating - a.avgRating,
    ).slice(0, 3); // Get top 3 for gamification
  }, [team]);

  const topPerformer = todayTopPerformers[0] || null;

  const protectionRate = useMemo(() => {
    const total = data.week.totalScans;
    if (total === 0) return 0;
    return Math.round((data.week.sentToGoogle / total) * 100);
  }, [data.week]);

  // Poll every 15s
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/auth/live');
        if (res.ok) {
          const json = await res.json();
          setData(json);
          if (json.googleRating != null) setGRating(json.googleRating);
          if (json.googleReviewCount != null) setGReviewCount(json.googleReviewCount);
          if (json.googleTrend) setGTrend(json.googleTrend);
          setLastUpdate(new Date());
        }
      } catch { /* retry next interval */ }
    }, 15_000);
    return () => clearInterval(interval);
  }, []);

  // Clock
  useEffect(() => {
    const interval = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Fullscreen
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const fs = isFullscreen;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const timeStr = clock.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const secondsSince = Math.floor((clock.getTime() - lastUpdate.getTime()) / 1000);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        background: C.bgBase,
        color: C.textMain,
        height: fs ? '100vh' : undefined,
        minHeight: fs ? undefined : 'calc(100vh - 120px)',
        padding: fs ? '2rem 3rem' : '1.5rem',
        fontFamily: '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: fs ? 0 : 0, // Sharp corners
        overflow: 'hidden',
        border: fs ? 'none' : `1px solid ${C.borderDark}`,
        boxShadow: fs ? 'none' : '12px 12px 0px rgba(0,0,0,0.05)',
      }}
    >
      {/* ── HEADER ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: fs ? '3rem' : '1.5rem',
          flexShrink: 0,
          borderBottom: `2px solid ${C.borderDark}`,
          paddingBottom: fs ? '1.5rem' : '1rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: fs ? '2rem' : '1rem' }}>
          {/* Restaurant logo */}
          <div
            style={{
              width: fs ? 120 : 56, // Significantly bigger in fullscreen
              height: fs ? 120 : 56, // Significantly bigger in fullscreen
              borderRadius: 0,
              overflow: 'hidden',
              background: logoDarkBg ? '#111' : '#fff',
              flexShrink: 0,
              border: `1px solid ${C.borderDark}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: fs ? '8px' : '4px',
              boxShadow: fs ? '4px 4px 0px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 0.3s ease',
            }}
          >
            <img
              src={logoSrc}
              alt={restaurantName}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: fs ? 8 : 4 }}>
            <h1
              className="editorial-serif"
              style={{
                margin: 0,
                fontSize: fs ? '3rem' : '1.5rem',
                fontWeight: 600,
                letterSpacing: '-0.02em',
                color: C.textMain,
                lineHeight: 1.1,
              }}
            >
              {restaurantName}
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Live badge */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: fs ? '0.8rem' : '0.65rem',
                  fontWeight: 700,
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase' as const,
                  color: C.green,
                }}
              >
                <span
                  style={{
                    width: fs ? 8 : 6,
                    height: fs ? 8 : 6,
                    borderRadius: '50%',
                    background: C.green,
                    animation: 'liveIndicatorLight 2s ease-in-out infinite',
                  }}
                />
                EN VIVO
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center' }}>
             <span
              className="font-numeric"
              style={{
                fontSize: fs ? '2rem' : '1.1rem',
                fontWeight: 500,
                color: C.textMain,
                lineHeight: 1,
                marginBottom: 4,
                letterSpacing: '-0.02em',
              }}
            >
              {mounted ? timeStr : ''}
            </span>
            <span style={{ fontSize: fs ? '0.8rem' : '0.65rem', color: C.textMuted, fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              {secondsSince < 5 ? 'Sincronizado: Justo Ahora' : `Sincronizado: Hace ${secondsSince}s`}
            </span>
          </div>
          <button
            onClick={toggleFullscreen}
            style={{
              background: C.panelBg,
              border: `1px solid ${C.borderDark}`,
              color: C.textMain,
              borderRadius: 0,
              padding: fs ? '14px 20px' : '8px 14px',
              cursor: 'pointer',
              fontSize: fs ? '0.8rem' : '0.7rem',
              fontWeight: 600,
              letterSpacing: '0.05em',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.15s ease',
              textTransform: 'uppercase',
              boxShadow: fs ? '4px 4px 0px rgba(0,0,0,1)' : 'none', // Brutalist shadow on button in FS
            }}
            onMouseEnter={(e) => {
              if(!fs) {
                e.currentTarget.style.background = C.textMain;
                e.currentTarget.style.color = C.panelBg;
              } else {
                 e.currentTarget.style.transform = 'translate(2px, 2px)';
                 e.currentTarget.style.boxShadow = '2px 2px 0px rgba(0,0,0,1)';
              }
            }}
            onMouseLeave={(e) => {
              if(!fs) {
                e.currentTarget.style.background = C.panelBg;
                e.currentTarget.style.color = C.textMain;
              } else {
                 e.currentTarget.style.transform = 'translate(0px, 0px)';
                 e.currentTarget.style.boxShadow = '4px 4px 0px rgba(0,0,0,1)';
              }
            }}
          >
            <svg width={fs ? 20 : 14} height={fs ? 20 : 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              {fs ? (
                <><polyline points="4 14 4 20 10 20" /><polyline points="20 10 20 4 14 4" /><line x1="14" y1="10" x2="20" y2="4" /><line x1="4" y1="20" x2="10" y2="14" /></>
              ) : (
                <><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></>
              )}
            </svg>
            {fs ? 'SALIR' : 'EXPANDIR'}
          </button>
        </div>
      </div>

      {/* ── MAIN CONTENT: two columns ── */}
      <div
        className="live-content-grid"
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: fs ? '420px 1fr' : '340px 1fr',
          gap: fs ? '2.5rem' : '1.5rem',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {/* ── LEFT COLUMN ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: fs ? '1.5rem' : '1.25rem', overflow: 'hidden' }}>
          {/* Gamified Daily Winners */}
          {(todayTopPerformers.length > 0) && (
            <DailyPodium winners={todayTopPerformers} large={fs} />
          )}

          {/* Google Rating */}
          {gRating != null && (
            <GoogleRatingCard rating={gRating} reviewCount={gReviewCount} trend={gTrend} large={fs} />
          )}

          {/* Protection Score Ring */}
          <ProtectionRing
            rate={protectionRate}
            googleSends={data.week.sentToGoogle}
            intercepted={data.week.belowFourCount}
            large={fs}
          />

          {/* Live Activity Feed */}
          <LiveFeed scans={data.recentScans} now={clock} large={fs} />
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: fs ? '1.5rem' : '1.25rem', overflow: 'hidden' }}>
          {/* Stats Row with week-over-week */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: fs ? '1.5rem' : '1.25rem', flexShrink: 0 }}>
            <StatBox
              label="TOTAL ESCANEOS"
              weekValue={data.week.totalScans}
              todayValue={data.today.totalScans}
              lastWeekValue={data.lastWeek.totalScans}
              large={fs}
            />
            <StatBox
              label="ENVIADOS A GOOGLE"
              weekValue={data.week.sentToGoogle}
              todayValue={data.today.sentToGoogle}
              lastWeekValue={data.lastWeek.sentToGoogle}
              large={fs}
            />
            <StatBox
              label="INTERCEPTADOS"
              weekValue={data.week.belowFourCount}
              todayValue={data.today.belowFourCount}
              lastWeekValue={data.lastWeek.belowFourCount}
              large={fs}
            />
          </div>

          {/* Team Leaderboard Table */}
          <TeamTable team={team} large={fs} />
        </div>
      </div>

      {/* ── FOOTER ── */}
      <div style={{ 
        borderTop: `1px solid ${C.panelBorder}`,
        marginTop: fs ? '1.5rem' : '1rem',
        paddingTop: fs ? '1.5rem' : '1rem', 
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '0.65rem', 
        letterSpacing: '0.05em', 
        color: C.textDim, 
        flexShrink: 0,
        textTransform: 'uppercase'
      }}>
        <span>PANEL DE DATOS INTERNO</span>
        <span>
          SISTEMA PROVISTO POR <span style={{ fontWeight: 700, color: C.textMain }}>RATETAP</span>
        </span>
      </div>

      {/* Keyframes & Global Styles */}
      <style>{`
        .editorial-serif {
          font-family: 'Playfair Display', Georgia, serif;
        }

        .font-numeric {
          font-family: "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace;
          font-variant-numeric: tabular-nums;
        }
        
        .flat-panel {
          background: ${C.panelBg};
          border: 1px solid ${C.borderDark};
          border-radius: 0px;
        }

        @keyframes liveIndicatorLight {
          0% { opacity: 1; }
          50% { opacity: 0.3; }
          100% { opacity: 1; }
        }

        @keyframes slideInScanLight {
          from { opacity: 0; transform: translateY(-5px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes championGlow {
          0% { border-color: #D97706; box-shadow: 0 0 5px rgba(217,119,6,0.2); }
          50% { border-color: #F59E0B; box-shadow: 0 0 15px rgba(217,119,6,0.6); }
          100% { border-color: #D97706; box-shadow: 0 0 5px rgba(217,119,6,0.2); }
        }

        @keyframes flipBadge {
          0% { transform: perspective(400px) rotateY(0); }
          10% { transform: perspective(400px) rotateY(180deg); }
          100% { transform: perspective(400px) rotateY(180deg); }
        }

        /* Custom Scrollbar */
        ::-webkit-scrollbar {
          width: 4px;
          height: 4px;
        }
        ::-webkit-scrollbar-track {
          background: ${C.bgBase};
        }
        ::-webkit-scrollbar-thumb {
          background: ${C.panelBorder};
        }
        ::-webkit-scrollbar-thumb:hover {
          background: ${C.textDim};
        }
        
        @media (max-width: 1024px) {
          .live-content-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

/* ── Gamified Podium ───────────────────────────── */

function DailyPodium({ winners, large }: { winners: MergedStaff[]; large: boolean }) {
  const fs = large;
  const first = winners[0];
  const second = winners[1];
  const third = winners[2];

  // Colors for podium
  const gold = '#D97706';
  const silver = '#9CA3AF';
  const bronze = '#B45309';

  return (
    <div
      style={{
        background: '#111111', // Invert for impact
        border: `1px solid ${C.borderDark}`,
        padding: fs ? '1.5rem' : '1.25rem',
        flexShrink: 0,
        position: 'relative',
        color: '#FFFFFF',
      }}
    >
      <div
        style={{
          fontSize: '0.65rem',
          fontWeight: 800,
          letterSpacing: '0.15em',
          textTransform: 'uppercase' as const,
          color: '#A3A3A3',
          marginBottom: fs ? 16 : 12,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderBottom: '1px solid #333',
          paddingBottom: 10,
        }}
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="square">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
        LÍDERES DEL DÍA
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: fs ? 12 : 8 }}>
        {/* 1st Place - Boldest */}
        {first && (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 12, 
            padding: fs ? '12px 16px' : '8px 12px',
            background: 'rgba(217, 119, 6, 0.1)', 
            border: `1px solid ${gold}`,
            animation: 'championGlow 3s infinite ease-in-out'
          }}>
             <div style={{
                width: fs ? 28 : 24, height: fs ? 28 : 24,
                background: gold, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: fs ? '1rem' : '0.8rem',
                fontFamily: '"JetBrains Mono", monospace'
             }}>1</div>
             <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
               <span className="editorial-serif" style={{ fontSize: fs ? '1.3rem' : '1.1rem', fontWeight: 700, color: '#fff', fontStyle: 'italic', lineHeight: 1.1 }}>{first.name}</span>
               <span style={{ fontSize: '0.65rem', color: gold, fontWeight: 700, letterSpacing: '0.05em' }}>CAMPEÓN ACTUAL</span>
             </div>
             <div style={{ textAlign: 'right' }}>
               <div className="font-numeric" style={{ fontSize: fs ? '1.5rem' : '1.2rem', fontWeight: 700, color: gold, lineHeight: 1 }}>{first.todayScans}</div>
               <div style={{ fontSize: '0.55rem', color: '#888', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Escaneos</div>
             </div>
          </div>
        )}

        {/* 2nd and 3rd - Grid below */}
        {(second || third) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {second && (
               <div style={{ 
                 display: 'flex', 
                 alignItems: 'center', 
                 gap: 8, 
                 padding: '8px 12px',
                 border: `1px solid #333`,
               }}>
                  <div style={{ color: silver, fontWeight: 700, fontSize: '0.9rem', fontFamily: '"JetBrains Mono", monospace' }}>#2</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="editorial-serif" style={{ fontSize: '1rem', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{second.name}</div>
                  </div>
                  <div className="font-numeric" style={{ fontSize: '1rem', color: silver, fontWeight: 600 }}>{second.todayScans}</div>
               </div>
            )}
            {third && (
               <div style={{ 
                 display: 'flex', 
                 alignItems: 'center', 
                 gap: 8, 
                 padding: '8px 12px',
                 border: `1px solid #333`,
               }}>
                  <div style={{ color: bronze, fontWeight: 700, fontSize: '0.9rem', fontFamily: '"JetBrains Mono", monospace' }}>#3</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="editorial-serif" style={{ fontSize: '1rem', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{third.name}</div>
                  </div>
                  <div className="font-numeric" style={{ fontSize: '1rem', color: bronze, fontWeight: 600 }}>{third.todayScans}</div>
               </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


/* ── Protection Ring ────────────────────────────── */

function ProtectionRing({
  rate,
  googleSends,
  intercepted,
  large,
}: {
  rate: number;
  googleSends: number;
  intercepted: number;
  large: boolean;
}) {
  const fs = large;
  const size = fs ? 150 : 120;
  const strokeW = fs ? 6 : 5;
  const r = size / 2 - strokeW - 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - rate / 100);

  return (
    <div
      className="flat-panel"
      style={{
        padding: fs ? '2rem 1.5rem' : '1.5rem 1.25rem',
        display: 'flex',
        alignItems: 'center',
        gap: fs ? '2rem' : '1.5rem',
        flexShrink: 0,
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        {/* Track solid */}
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#F0F0F0" strokeWidth={strokeW} />
        {/* Progress indicator */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={C.borderDark}
          strokeWidth={strokeW}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="butt"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 1s ease' }}
        />
        <text className="font-numeric" x={size / 2} y={size / 2} textAnchor="middle" fill={C.textMain} fontSize={fs ? 36 : 28} fontWeight="500" dy=".3em">
          {rate}%
        </text>
        <text
          x={size / 2}
          y={size / 2 + (fs ? 24 : 20)}
          textAnchor="middle"
          fill={C.textMuted}
          fontSize={fs ? 9 : 8}
          fontWeight="600"
          letterSpacing="0.1em"
        >
          PUNTUACIÓN
        </text>
      </svg>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: fs ? 16 : 12 }}>
        <div
          style={{
            fontSize: '0.7rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase' as const,
            color: C.textMain,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            borderBottom: `1px solid ${C.panelBorder}`,
            paddingBottom: 8,
          }}
        >
          ESCUDO DE REPUTACIÓN
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 6, height: 6, background: C.borderDark, flexShrink: 0 }} />
            <span style={{ fontSize: fs ? '0.85rem' : '0.75rem', display: 'flex', alignItems: 'center', gap: 6 }}>
              <strong className="font-numeric" style={{ fontSize: fs ? '1.1rem' : '1rem', color: C.textMain, fontWeight: 500 }}>{googleSends}</strong>
              <span style={{ color: C.textMuted }}>ENVIADOS A GOOGLE</span>
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 6, height: 6, background: C.textDim, flexShrink: 0 }} />
            <span style={{ fontSize: fs ? '0.85rem' : '0.75rem', display: 'flex', alignItems: 'center', gap: 6 }}>
              <strong className="font-numeric" style={{ fontSize: fs ? '1.1rem' : '1rem', color: C.textMain, fontWeight: 500 }}>{intercepted}</strong>
              <span style={{ color: C.textMuted }}>INTERCEPTADOS</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Live Activity Feed ─────────────────────────── */

function LiveFeed({ scans, now, large }: { scans: RecentScan[]; now: Date; large: boolean }) {
  const fs = large;
  return (
    <div
      className="flat-panel"
      style={{
        flex: 1,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      <div
        style={{
          fontSize: '0.65rem',
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase' as const,
          color: C.textMain,
          padding: fs ? '1.25rem 1.5rem' : '1rem 1.25rem',
          flexShrink: 0,
          borderBottom: `1px solid ${C.panelBorder}`,
          background: '#FAFAFA'
        }}
      >
        REGISTRO DE ACTIVIDAD
      </div>
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {scans.length === 0 ? (
          <div style={{ color: C.textDim, fontSize: '0.8rem', padding: '3rem 0', textAlign: 'center', fontStyle: 'italic', fontFamily: 'Georgia, serif' }}>
            Esperando registros...
          </div>
        ) : (
          scans.map((scan, i) => {
            const ago = relativeTime(new Date(scan.createdAt), now);
            const isGood = scan.rating >= 4;
            return (
              <div
                key={scan.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: fs ? '12px 1.5rem' : '10px 1.25rem',
                  borderBottom: `1px solid ${C.panelBorder}`,
                  background: i === 0 ? '#FDFDFD' : 'transparent',
                  animation: i === 0 ? 'slideInScanLight 0.4s ease' : undefined,
                }}
              >
                <span
                  style={{
                    flex: 1,
                    fontWeight: 500,
                    color: C.textMain,
                    fontSize: fs ? '0.85rem' : '0.8rem',
                    whiteSpace: 'nowrap' as const,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {scan.staffName ?? 'Desconocido'}
                </span>
                
                <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                  {Array.from({ length: 5 }).map((_, idx) => (
                    <div 
                      key={idx} 
                      style={{ 
                        width: fs ? 10 : 8, 
                        height: fs ? 10 : 8, 
                        background: idx < scan.rating ? C.textMain : '#EEEEEE',
                        borderRadius: '1px'
                      }} 
                    />
                  ))}
                </div>

                {!scan.sentToGoogle && (
                  <span
                    style={{
                      fontSize: '0.55rem',
                      fontWeight: 600,
                      letterSpacing: '0.05em',
                      border: `1px solid ${C.textMain}`,
                      color: C.textMain,
                      padding: '2px 6px',
                      flexShrink: 0,
                      textTransform: 'uppercase' as const,
                    }}
                  >
                    Interceptado
                  </span>
                )}
                <span
                  className="font-numeric"
                  style={{
                    fontSize: fs ? '0.7rem' : '0.65rem',
                    color: C.textMuted,
                    flexShrink: 0,
                    textAlign: 'right' as const,
                    minWidth: 55,
                  }}
                >
                  {ago}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ── Stat Box (with week-over-week delta) ───────── */

function StatBox({
  label,
  weekValue,
  todayValue,
  lastWeekValue,
  large,
}: {
  label: string;
  weekValue: number;
  todayValue: number;
  lastWeekValue: number;
  large: boolean;
}) {
  const fs = large;
  const delta = weekValue - lastWeekValue;
  const showDelta = lastWeekValue > 0 || weekValue > 0;

  return (
    <div
      className="flat-panel"
      style={{
        padding: fs ? '1.5rem' : '1.25rem',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          fontSize: fs ? '0.65rem' : '0.6rem',
          fontWeight: 700,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.1em',
          color: C.textMuted,
          marginBottom: fs ? 16 : 12,
        }}
      >
        {label}
      </div>
      
      <div
        className="editorial-serif"
        style={{
          fontSize: fs ? '3.5rem' : '2.5rem',
          fontWeight: 400,
          color: C.textMain,
          lineHeight: 1,
          marginBottom: fs ? 16 : 12,
        }}
      >
        {weekValue}
      </div>
      
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        borderTop: `1px solid ${C.panelBorder}`,
        paddingTop: fs ? 12 : 10,
        marginTop: 'auto'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
           <span className="font-numeric" style={{ fontSize: fs ? '0.85rem' : '0.75rem', color: C.textMain, fontWeight: 500 }}>
             {todayValue}
           </span>
           <span style={{ fontSize: fs ? '0.6rem' : '0.55rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
             HOY
           </span>
        </div>
        {showDelta && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: fs ? '0.75rem' : '0.7rem', color: C.textMain }}>
               {delta > 0 ? '↑' : delta < 0 ? '↓' : '-'}
            </span>
            <span className="font-numeric" style={{ fontSize: fs ? '0.85rem' : '0.75rem', fontWeight: 500, color: C.textMain }}>
              {Math.abs(delta)}
            </span>
            <span style={{ fontSize: fs ? '0.6rem' : '0.55rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              VS SEMANA PASADA
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Team Leaderboard Table ─────────────────────── */

function TeamTable({ team, large }: { team: MergedStaff[]; large: boolean }) {
  const fs = large;

  return (
    <div
      className="flat-panel"
      style={{
        flex: 1,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      <div
        style={{
          fontSize: '0.65rem',
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase' as const,
          color: C.textMain,
          padding: fs ? '1.25rem 1.5rem' : '1rem 1.25rem',
          flexShrink: 0,
          background: '#FAFAFA',
          borderBottom: `1px solid ${C.panelBorder}`,
        }}
      >
        ÍNDICE DE PERSONAL
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, background: C.panelBg, zIndex: 1 }}>
            <tr>
              <ThCell align="center" large={fs} style={{ width: 50, borderBottom: `2px solid ${C.borderDark}` }}>RANGO</ThCell>
              <ThCell align="left" large={fs} style={{ borderBottom: `2px solid ${C.borderDark}` }}>NOMBRE</ThCell>
              <ThCell align="right" large={fs} style={{ borderBottom: `2px solid ${C.borderDark}` }}>ESCANEOS</ThCell>
              <ThCell align="right" large={fs} style={{ borderBottom: `2px solid ${C.borderDark}` }}>5 ESTRELLAS</ThCell>
              <ThCell align="right" large={fs} style={{ borderBottom: `2px solid ${C.borderDark}` }}>&lt;4</ThCell>
              <ThCell align="right" large={fs} style={{ borderBottom: `2px solid ${C.borderDark}` }}>PROM</ThCell>
            </tr>
          </thead>
          <tbody>
            {team.map((m, i) => {
              const rank = i + 1;
              const hasActivity = m.weekScans > 0;

              return (
                <tr
                  key={m.id}
                  style={{
                    opacity: hasActivity ? 1 : 0.4,
                    borderBottom: `1px solid ${C.panelBorder}`,
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#F9F9F9'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <TdCell align="center" large={fs} style={{ color: C.textMuted }}>
                    <span className="font-numeric" style={{ fontSize: fs ? '0.85rem' : '0.75rem' }}>
                      {rank.toString().padStart(2, '0')}
                    </span>
                  </TdCell>
                  <TdCell align="left" large={fs} style={{ fontWeight: 500, color: C.textMain }}>
                    {m.name}
                    {m.todayScans > 0 && (
                      <span style={{ 
                        marginLeft: 10, 
                        fontSize: '0.6rem', 
                        color: C.textMuted, 
                        border: `1px solid ${C.panelBorder}`,
                        padding: '1px 5px', 
                        fontWeight: 600,
                        fontFamily: 'monospace'
                      }}>
                        +{m.todayScans}
                      </span>
                    )}
                  </TdCell>
                  <TdCell align="right" large={fs} className="font-numeric" style={{ fontWeight: 500 }}>{m.weekScans}</TdCell>
                  <TdCell align="right" large={fs} className="font-numeric" style={{ color: m.weekFiveStars > 0 ? C.textMain : C.textDim }}>{m.weekFiveStars}</TdCell>
                  <TdCell align="right" large={fs} className="font-numeric" style={{ color: m.weekBelowFour > 0 ? C.textMain : C.textDim }}>{m.weekBelowFour}</TdCell>
                  <TdCell align="right" large={fs} className="font-numeric" style={{ color: C.textMuted }}>
                    {m.avgRating > 0 ? m.avgRating.toFixed(1) : '-'}
                  </TdCell>
                </tr>
              );
            })}
          </tbody>
        </table>
        {team.length === 0 && (
          <div style={{ textAlign: 'center', padding: '4rem 0', color: C.textDim, fontSize: '0.85rem', fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>
            No hay registros para mostrar
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Google Rating Card ─────────────────────────── */

function GoogleRatingCard({
  rating,
  reviewCount,
  trend,
  large,
}: {
  rating: number;
  reviewCount: number | null;
  trend: GoogleTrend | null;
  large: boolean;
}) {
  const fs = large;

  return (
    <div
      className="flat-panel"
      style={{
        padding: fs ? '1.5rem' : '1.25rem',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'flex-start',
        gap: fs ? 20 : 16,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', color: C.textMuted, marginBottom: fs ? 12 : 8, textTransform: 'uppercase' }}>
          SENTIMIENTO GLOBAL
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span
            className="editorial-serif"
            style={{
              fontSize: fs ? '3rem' : '2.5rem',
              color: C.textMain,
              lineHeight: 1,
            }}
          >
            {rating.toFixed(1)}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', gap: 4 }}>
               {Array.from({ length: 5 }).map((_, i) => (
                 <svg key={i} width={fs ? 14 : 12} height={fs ? 14 : 12} viewBox="0 0 24 24">
                   <polygon
                     points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
                     fill={i < Math.round(rating) ? C.textMain : 'none'}
                     stroke={C.textMain}
                     strokeWidth="2"
                   />
                 </svg>
               ))}
            </div>
            <div style={{ fontSize: fs ? '0.7rem' : '0.65rem', color: C.textMuted, fontWeight: 500, letterSpacing: '0.02em' }}>
              {reviewCount != null ? <><span className="font-numeric" style={{ color: C.textMain }}>{reviewCount.toLocaleString()}</span> RESEÑAS VERIFICADAS</> : 'ÍNDICE DE GOOGLE'}
            </div>
          </div>
        </div>
        
        {trend && trend.ratingChange !== 0 && (
          <div
            style={{
              marginTop: fs ? 16 : 12,
              paddingTop: fs ? 12 : 10,
              borderTop: `1px solid ${C.panelBorder}`,
              fontSize: fs ? '0.65rem' : '0.6rem',
              color: C.textMain,
              fontWeight: 600,
              letterSpacing: '0.05em',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              textTransform: 'uppercase'
            }}
          >
            <span style={{ color: trend.ratingChange > 0 ? C.green : C.red }}>
              {trend.ratingChange > 0 ? '↑' : '↓'} {Math.abs(trend.ratingChange).toFixed(1)}
            </span>
            <span style={{ color: C.textMuted }}>TENDENCIA</span>
            {trend.reviewsGained > 0 && (
              <>
                <span style={{ color: C.panelBorder }}>|</span>
                <span><span className="font-numeric">+{trend.reviewsGained}</span> NUEVAS</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Table helpers ──────────────────────────────── */

function ThCell({ children, align, large, color, style }: { children: React.ReactNode; align: 'left' | 'right' | 'center'; large: boolean; color?: string; style?: React.CSSProperties }) {
  return (
    <th
      style={{
        textAlign: align,
        padding: large ? '1rem 1.5rem' : '0.75rem 1.25rem',
        fontSize: large ? '0.65rem' : '0.6rem',
        fontWeight: 700,
        textTransform: 'uppercase' as const,
        letterSpacing: '0.05em',
        color: color ?? C.textMuted,
        ...style
      }}
    >
      {children}
    </th>
  );
}

function TdCell({ children, align, large, className, style: extra }: { children: React.ReactNode; align: 'left' | 'right' | 'center'; large: boolean; className?: string; style?: React.CSSProperties }) {
  return (
    <td
      className={className}
      style={{
        textAlign: align,
        padding: large ? '1rem 1.5rem' : '0.8rem 1.25rem',
        fontSize: large ? '0.85rem' : '0.8rem',
        ...extra,
      }}
    >
      {children}
    </td>
  );
}
