'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

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

/* ── Colors ─────────────────────────────────────── */

const C = {
  bg: '#09090b',
  surface: 'rgba(255,255,255,0.03)',
  border: 'rgba(255,255,255,0.07)',
  borderLight: 'rgba(255,255,255,0.12)',
  white: '#fafafa',
  muted: 'rgba(255,255,255,0.45)',
  dim: 'rgba(255,255,255,0.2)',
  gold: '#f59e0b',
  green: '#22c55e',
  greenBg: 'rgba(34, 197, 94, 0.1)',
  greenBorder: 'rgba(34, 197, 94, 0.25)',
  red: '#ef4444',
  redBg: 'rgba(239, 68, 68, 0.1)',
  redBorder: 'rgba(239, 68, 68, 0.25)',
  amberBg: 'rgba(245, 158, 11, 0.08)',
  amberBorder: 'rgba(245, 158, 11, 0.2)',
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
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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

  const topPerformer = useMemo(() => {
    const todayActive = team.filter((s) => s.todayScans > 0);
    if (todayActive.length === 0) return null;
    return todayActive.sort(
      (a, b) => b.todayScans - a.todayScans || b.avgRating - a.avgRating,
    )[0];
  }, [team]);

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
  const timeStr = clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const secondsSince = Math.floor((clock.getTime() - lastUpdate.getTime()) / 1000);

  return (
    <div
      ref={containerRef}
      style={{
        background: C.bg,
        color: C.white,
        height: fs ? '100vh' : undefined,
        minHeight: fs ? undefined : 'calc(100vh - 120px)',
        padding: fs ? '1.5rem 2rem' : '1.25rem',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: fs ? 0 : 12,
        overflow: 'hidden',
      }}
    >
      {/* ── HEADER ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: fs ? '1.25rem' : '1rem',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: fs ? '1rem' : '0.75rem' }}>
          {/* Restaurant logo */}
          <div
            style={{
              width: fs ? 52 : 42,
              height: fs ? 52 : 42,
              borderRadius: fs ? 12 : 10,
              overflow: 'hidden',
              background: logoDarkBg ? '#111' : '#fff',
              flexShrink: 0,
              border: `1px solid ${C.borderLight}`,
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            }}
          >
            <img
              src={logoSrc}
              alt={restaurantName}
              style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 3 }}
            />
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: fs ? '1.35rem' : '1.05rem',
              fontWeight: 600,
              letterSpacing: '0.02em',
            }}
          >
            {restaurantName}
          </h1>
          {/* Live badge */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgba(34,197,94,0.12)',
              border: '1px solid rgba(34,197,94,0.25)',
              borderRadius: 20,
              padding: '3px 10px 3px 7px',
              fontSize: '0.6rem',
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase' as const,
              color: '#4ade80',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#22c55e',
                animation: 'livePulse 2s ease-in-out infinite',
              }}
            />
            LIVE
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ fontSize: '0.65rem', color: C.dim }}>
            {secondsSince < 5 ? 'Updated just now' : `Updated ${secondsSince}s ago`}
          </span>
          <span
            style={{
              fontSize: fs ? '1rem' : '0.85rem',
              fontWeight: 500,
              color: C.muted,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {timeStr}
          </span>
          <button
            onClick={toggleFullscreen}
            style={{
              background: C.surface,
              border: `1px solid ${C.borderLight}`,
              color: C.white,
              borderRadius: 8,
              padding: '7px 14px',
              cursor: 'pointer',
              fontSize: '0.65rem',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = C.surface)}
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              {fs ? (
                <><polyline points="4 14 4 20 10 20" /><polyline points="20 10 20 4 14 4" /><line x1="14" y1="10" x2="20" y2="4" /><line x1="4" y1="20" x2="10" y2="14" /></>
              ) : (
                <><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></>
              )}
            </svg>
            {fs ? 'Exit' : 'Fullscreen'}
          </button>
        </div>
      </div>

      {/* ── MAIN CONTENT: two columns ── */}
      <div
        className="live-content-grid"
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: fs ? '340px 1fr' : '280px 1fr',
          gap: fs ? '1.25rem' : '0.85rem',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {/* ── LEFT COLUMN ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: fs ? '0.85rem' : '0.65rem', overflow: 'hidden' }}>
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

          {/* Staff of the Day */}
          {topPerformer && <TopPerformer member={topPerformer} large={fs} />}

          {/* Live Activity Feed */}
          <LiveFeed scans={data.recentScans} now={clock} large={fs} />
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: fs ? '0.85rem' : '0.65rem', overflow: 'hidden' }}>
          {/* Stats Row with week-over-week */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: fs ? '0.85rem' : '0.6rem', flexShrink: 0 }}>
            <StatBox
              label="Total Scans"
              weekValue={data.week.totalScans}
              todayValue={data.today.totalScans}
              lastWeekValue={data.lastWeek.totalScans}
              color={C.gold}
              bgColor={C.amberBg}
              borderColor={C.amberBorder}
              large={fs}
            />
            <StatBox
              label="Sent to Google"
              weekValue={data.week.sentToGoogle}
              todayValue={data.today.sentToGoogle}
              lastWeekValue={data.lastWeek.sentToGoogle}
              color={C.green}
              bgColor={C.greenBg}
              borderColor={C.greenBorder}
              large={fs}
              icon="star"
            />
            <StatBox
              label="Intercepted"
              weekValue={data.week.belowFourCount}
              todayValue={data.today.belowFourCount}
              lastWeekValue={data.lastWeek.belowFourCount}
              color={C.red}
              bgColor={C.redBg}
              borderColor={C.redBorder}
              large={fs}
              icon="shield"
            />
          </div>

          {/* Team Leaderboard Table */}
          <TeamTable team={team} large={fs} />
        </div>
      </div>

      {/* ── FOOTER ── */}
      <div style={{ textAlign: 'right', paddingTop: fs ? '0.75rem' : '0.5rem', fontSize: '0.55rem', letterSpacing: '0.06em', color: C.dim, flexShrink: 0 }}>
        Powered by <span style={{ fontWeight: 600, color: C.muted }}>RateTap</span>
      </div>

      {/* Keyframes */}
      <style>{`
        @keyframes livePulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(34,197,94,0.5); }
          50% { opacity: 0.6; box-shadow: 0 0 0 4px rgba(34,197,94,0); }
        }
        @keyframes fadeInScan {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (max-width: 700px) {
          .live-content-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
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
  const size = fs ? 110 : 90;
  const r = size / 2 - 12;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - rate / 100);
  const ringColor = rate >= 70 ? C.green : rate >= 40 ? C.gold : C.red;

  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: fs ? 14 : 10,
        padding: fs ? '1.25rem' : '0.85rem',
        display: 'flex',
        alignItems: 'center',
        gap: fs ? '1.25rem' : '0.85rem',
        flexShrink: 0,
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={fs ? 9 : 7} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={ringColor}
          strokeWidth={fs ? 9 : 7}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 1s ease' }}
        />
        <text x={size / 2} y={size / 2 - 4} textAnchor="middle" fill="white" fontSize={fs ? 26 : 20} fontWeight="700">
          {rate}%
        </text>
        <text
          x={size / 2}
          y={size / 2 + (fs ? 14 : 11)}
          textAnchor="middle"
          fill="rgba(255,255,255,0.35)"
          fontSize={fs ? 8 : 7}
          fontWeight="600"
          letterSpacing="0.1em"
        >
          SATISFACTION
        </text>
      </svg>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: '0.55rem',
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase' as const,
            color: C.muted,
            marginBottom: fs ? 12 : 8,
          }}
        >
          Reputation Shield
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: fs ? 8 : 5 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.green, flexShrink: 0 }} />
          <span style={{ fontSize: fs ? '0.8rem' : '0.7rem' }}>
            <strong>{googleSends}</strong>{' '}
            <span style={{ color: C.muted }}>sent to Google</span>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.red, flexShrink: 0 }} />
          <span style={{ fontSize: fs ? '0.8rem' : '0.7rem' }}>
            <strong>{intercepted}</strong>{' '}
            <span style={{ color: C.muted }}>caught before Google</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── Staff of the Day ───────────────────────────── */

function TopPerformer({ member, large }: { member: MergedStaff; large: boolean }) {
  const fs = large;
  return (
    <div
      style={{
        background: 'linear-gradient(135deg, rgba(245,158,11,0.1), rgba(245,158,11,0.02))',
        border: '1px solid rgba(245,158,11,0.2)',
        borderRadius: fs ? 14 : 10,
        padding: fs ? '1rem 1.25rem' : '0.7rem 0.85rem',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          fontSize: '0.5rem',
          fontWeight: 700,
          letterSpacing: '0.14em',
          textTransform: 'uppercase' as const,
          color: C.gold,
          marginBottom: fs ? 6 : 4,
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        <svg width={12} height={12} viewBox="0 0 24 24" fill={C.gold} stroke="none">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
        Staff of the Day
      </div>
      <div style={{ fontSize: fs ? '1.1rem' : '0.9rem', fontWeight: 700, marginBottom: 3 }}>
        {member.name}
      </div>
      <div style={{ fontSize: fs ? '0.7rem' : '0.6rem', color: C.muted }}>
        {member.todayScans} scans today
        {member.todayFiveStars > 0 && <> &middot; {member.todayFiveStars} sent to Google</>}
        {member.avgRating > 0 && <> &middot; {member.avgRating.toFixed(1)} avg</>}
      </div>
    </div>
  );
}

/* ── Live Activity Feed ─────────────────────────── */

function LiveFeed({ scans, now, large }: { scans: RecentScan[]; now: Date; large: boolean }) {
  const fs = large;
  return (
    <div
      style={{
        flex: 1,
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: fs ? 14 : 10,
        padding: fs ? '0.85rem 1rem' : '0.65rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      <div
        style={{
          fontSize: '0.5rem',
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase' as const,
          color: C.muted,
          marginBottom: 6,
          flexShrink: 0,
        }}
      >
        Recent Activity
      </div>
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {scans.length === 0 ? (
          <div style={{ color: C.dim, fontSize: '0.75rem', padding: '1rem 0', textAlign: 'center' }}>
            Waiting for scans...
          </div>
        ) : (
          scans.map((scan, i) => {
            const ago = relativeTime(new Date(scan.createdAt), now);
            const stars = Array.from({ length: 5 }, (_, si) => (si < scan.rating ? '\u2605' : '\u2606')).join('');
            return (
              <div
                key={scan.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: fs ? '5px 6px' : '3px 4px',
                  borderRadius: 5,
                  background: i === 0 ? 'rgba(255,255,255,0.04)' : 'transparent',
                  animation: i === 0 ? 'fadeInScan 0.4s ease' : undefined,
                  fontSize: fs ? '0.75rem' : '0.65rem',
                }}
              >
                <span
                  style={{
                    flex: 1,
                    fontWeight: 500,
                    whiteSpace: 'nowrap' as const,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {scan.staffName ?? 'Unknown'}
                </span>
                <span
                  style={{
                    color: scan.rating >= 4 ? C.gold : C.red,
                    fontSize: fs ? '0.7rem' : '0.6rem',
                    letterSpacing: '0.01em',
                    flexShrink: 0,
                  }}
                >
                  {stars}
                </span>
                {!scan.sentToGoogle && (
                  <span
                    style={{
                      fontSize: '0.45rem',
                      fontWeight: 700,
                      letterSpacing: '0.05em',
                      background: C.redBg,
                      border: `1px solid ${C.redBorder}`,
                      color: C.red,
                      borderRadius: 3,
                      padding: '1px 4px',
                      flexShrink: 0,
                      textTransform: 'uppercase' as const,
                    }}
                  >
                    caught
                  </span>
                )}
                <span
                  style={{
                    fontSize: fs ? '0.6rem' : '0.5rem',
                    color: C.dim,
                    flexShrink: 0,
                    textAlign: 'right' as const,
                    minWidth: 42,
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
  color,
  bgColor,
  borderColor,
  icon,
  large,
}: {
  label: string;
  weekValue: number;
  todayValue: number;
  lastWeekValue: number;
  color: string;
  bgColor: string;
  borderColor: string;
  icon?: 'star' | 'shield';
  large: boolean;
}) {
  const fs = large;
  const delta = weekValue - lastWeekValue;
  const showDelta = lastWeekValue > 0 || weekValue > 0;

  return (
    <div
      style={{
        background: bgColor,
        border: `1px solid ${borderColor}`,
        borderRadius: fs ? 14 : 10,
        padding: fs ? '1.1rem' : '0.75rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
        {icon === 'star' && (
          <svg width={fs ? 13 : 11} height={fs ? 13 : 11} viewBox="0 0 24 24" fill={color} stroke="none">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        )}
        {icon === 'shield' && (
          <svg width={fs ? 13 : 11} height={fs ? 13 : 11} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        )}
        <span
          style={{
            fontSize: fs ? '0.6rem' : '0.5rem',
            fontWeight: 600,
            textTransform: 'uppercase' as const,
            letterSpacing: '0.1em',
            color: C.muted,
          }}
        >
          {label}
        </span>
      </div>
      <div
        style={{
          fontSize: fs ? '2.2rem' : '1.6rem',
          fontWeight: 700,
          color,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {weekValue}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' as const }}>
        <span style={{ fontSize: fs ? '0.65rem' : '0.55rem', color: C.dim }}>
          {todayValue} today
        </span>
        {showDelta && (
          <span
            style={{
              fontSize: fs ? '0.6rem' : '0.5rem',
              fontWeight: 600,
              color: delta > 0 ? C.green : delta < 0 ? C.red : C.dim,
            }}
          >
            {delta > 0 ? '+' : ''}{delta} vs last wk
          </span>
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
      style={{
        flex: 1,
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: fs ? 14 : 10,
        padding: fs ? '0.85rem 1rem' : '0.65rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      <div
        style={{
          fontSize: '0.5rem',
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase' as const,
          color: C.muted,
          marginBottom: 6,
          flexShrink: 0,
        }}
      >
        Team Leaderboard
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <ThCell align="left" large={fs}>#</ThCell>
              <ThCell align="left" large={fs}>Name</ThCell>
              <ThCell align="right" large={fs}>Scans</ThCell>
              <ThCell align="right" large={fs} color={C.green}>5-star</ThCell>
              <ThCell align="right" large={fs} color={C.red}>&lt;4</ThCell>
              <ThCell align="right" large={fs}>Avg</ThCell>
            </tr>
          </thead>
          <tbody>
            {team.map((m, i) => {
              const rank = i + 1;
              const hasActivity = m.weekScans > 0;
              const rankColors: Record<number, string> = { 1: C.gold, 2: '#a8a8a8', 3: '#cd7f32' };

              return (
                <tr
                  key={m.id}
                  style={{
                    opacity: hasActivity ? 1 : 0.3,
                    borderTop: i > 0 ? `1px solid ${C.border}` : undefined,
                  }}
                >
                  <TdCell align="left" large={fs} style={{ fontWeight: 700, color: rankColors[rank] ?? C.dim, width: 32 }}>
                    {rank}
                  </TdCell>
                  <TdCell align="left" large={fs} style={{ fontWeight: 500 }}>
                    {m.name}
                    {m.todayScans > 0 && (
                      <span style={{ marginLeft: 6, fontSize: '0.55rem', color: C.muted }}>
                        +{m.todayScans} today
                      </span>
                    )}
                  </TdCell>
                  <TdCell align="right" large={fs} style={{ fontWeight: 600 }}>{m.weekScans}</TdCell>
                  <TdCell align="right" large={fs} style={{ color: m.weekFiveStars > 0 ? C.green : C.dim }}>{m.weekFiveStars}</TdCell>
                  <TdCell align="right" large={fs} style={{ color: m.weekBelowFour > 0 ? C.red : C.dim }}>{m.weekBelowFour}</TdCell>
                  <TdCell align="right" large={fs} style={{ color: C.muted }}>
                    {m.avgRating > 0 ? m.avgRating.toFixed(1) : '-'}
                  </TdCell>
                </tr>
              );
            })}
          </tbody>
        </table>
        {team.length === 0 && (
          <div style={{ textAlign: 'center', padding: '2rem 0', color: C.dim, fontSize: '0.8rem' }}>
            No staff registered yet
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
  const stars = Array.from({ length: 5 }, (_, i) => {
    const filled = rating - i;
    if (filled >= 0.75) return 'full';
    if (filled >= 0.25) return 'half';
    return 'empty';
  });

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, rgba(66,133,244,0.1), rgba(66,133,244,0.03))',
        border: '1px solid rgba(66,133,244,0.2)',
        borderRadius: fs ? 14 : 10,
        padding: fs ? '1rem 1.25rem' : '0.7rem 0.85rem',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: fs ? 14 : 10,
      }}
    >
      {/* Google "G" icon */}
      <svg width={fs ? 28 : 22} height={fs ? 28 : 22} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
        <path
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
          fill="#4285F4"
        />
        <path
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          fill="#34A853"
        />
        <path
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          fill="#FBBC05"
        />
        <path
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          fill="#EA4335"
        />
      </svg>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span
            style={{
              fontSize: fs ? '1.6rem' : '1.25rem',
              fontWeight: 700,
              color: C.white,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {rating.toFixed(1)}
          </span>
          <div style={{ display: 'flex', gap: 1 }}>
            {stars.map((s, i) => (
              <svg key={i} width={fs ? 14 : 11} height={fs ? 14 : 11} viewBox="0 0 24 24">
                <polygon
                  points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
                  fill={s === 'empty' ? 'rgba(255,255,255,0.1)' : '#FBBC05'}
                  opacity={s === 'half' ? 0.5 : 1}
                  stroke="none"
                />
              </svg>
            ))}
          </div>
        </div>
        <div style={{ fontSize: fs ? '0.65rem' : '0.55rem', color: C.muted, marginTop: 1 }}>
          {reviewCount != null ? `${reviewCount.toLocaleString()} reviews on Google` : 'Google Rating'}
        </div>
        {trend && trend.ratingChange !== 0 && (
          <div
            style={{
              marginTop: fs ? 8 : 5,
              padding: '4px 8px',
              borderRadius: 6,
              background: trend.ratingChange > 0
                ? 'rgba(34,197,94,0.1)'
                : 'rgba(239,68,68,0.1)',
              border: `1px solid ${trend.ratingChange > 0 ? C.greenBorder : C.redBorder}`,
              fontSize: fs ? '0.6rem' : '0.5rem',
              color: trend.ratingChange > 0 ? C.green : C.red,
              fontWeight: 600,
            }}
          >
            {trend.ratingChange > 0 ? '+' : ''}{trend.ratingChange.toFixed(1)} since start
            {trend.reviewsGained > 0 && (
              <span style={{ color: C.muted, fontWeight: 400 }}>
                {' '}&middot; +{trend.reviewsGained} new reviews
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Table helpers ──────────────────────────────── */

function ThCell({ children, align, large, color }: { children: React.ReactNode; align: 'left' | 'right'; large: boolean; color?: string }) {
  return (
    <th
      style={{
        textAlign: align,
        padding: large ? '0.4rem 0.5rem' : '0.3rem 0.4rem',
        fontSize: large ? '0.55rem' : '0.45rem',
        fontWeight: 700,
        textTransform: 'uppercase' as const,
        letterSpacing: '0.08em',
        color: color ?? C.dim,
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      {children}
    </th>
  );
}

function TdCell({ children, align, large, style: extra }: { children: React.ReactNode; align: 'left' | 'right'; large: boolean; style?: React.CSSProperties }) {
  return (
    <td
      style={{
        textAlign: align,
        padding: large ? '0.5rem 0.5rem' : '0.4rem 0.4rem',
        fontSize: large ? '0.8rem' : '0.7rem',
        ...extra,
      }}
    >
      {children}
    </td>
  );
}
