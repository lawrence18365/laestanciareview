/**
 * Tell "the team stopped asking" apart from "fewer guests came in".
 *
 * Why this exists — 2026-09-10. Four locations looked disengaged on scan volume
 * alone. The conversations found something else: one had a floor-discipline
 * problem, two were simply empty (a bad sales month), and one had a new GM who
 * had never been trained. Nobody had churned. An owner briefing built on scan
 * volume would have accused two GMs who were doing their jobs.
 *
 * The discriminator is not volume and it is not GM logins. It is BREADTH: how
 * many distinct waiters captured at least one review this week.
 *
 *   Half-empty dining room  -> the same waiters ask, each just gets fewer
 *                              chances. Volume falls, breadth holds.
 *   Floor stopped asking    -> fewer waiters participate at all.
 *                              Volume falls AND breadth falls.
 *
 * Checked against the four known cases (weeks of Aug 24 and Aug 31):
 *   Estancia Veracruz  86->38 scans, 15->7 waiters  -> adoption   (correct)
 *   Harbor's Veracruz  65->61 scans,  9->9 waiters  -> steady     (correct)
 *   Xalapa             86->48 scans,  5->6 waiters  -> traffic    (correct)
 *   Regio Norte        collapsed to 1 waiter        -> adoption   (correct)
 *
 * GM login activity is carried as supporting colour only. A GM who trains the
 * floor daily but never opens the app is doing the job; absence from the app is
 * never on its own evidence of anything.
 *
 * Everything here is descriptive. It reports what the numbers show and stops.
 */

/** How far scans must fall week over week before we call volume "down". */
export const SCAN_DROP_THRESHOLD = -0.25;

/**
 * How far participation must fall before we say the floor stopped asking.
 * Deliberately steep: a false "your team quit" costs a relationship, a missed
 * one costs a week. When in doubt this returns 'mixed' and accuses nobody.
 */
export const BREADTH_COLLAPSE_THRESHOLD = -0.35;

/** Above this, participation counts as holding steady. */
export const BREADTH_STABLE_THRESHOLD = -0.15;

/** Logins in the week at or below which the GM was absent from the app. */
export const GM_ABSENT_LOGIN_DAYS = 1;

export type LocationSignal =
  /** Volume down, participation held. Fewer guests, same floor. */
  | 'traffic'
  /** Volume down and participation collapsed. The one case worth a call. */
  | 'adoption'
  /** Volume down, participation somewhere between. State facts, don't judge. */
  | 'mixed'
  /** Volume holding. */
  | 'healthy'
  /** No usable baseline. */
  | 'insufficient-data';

export interface LocationSignalInput {
  scansThisWeek: number;
  scansLastWeek: number;
  /** Distinct waiters who captured at least one review this week. */
  staffAskingThisWeek: number;
  /** Same, the week before. */
  staffAskingLastWeek: number;
  /** Distinct days the GM account opened the app. Supporting colour only. */
  gmActiveDays: number;
  /** False when the week predates telemetry; suppresses GM commentary. */
  gmTelemetryAvailable?: boolean;
}

export interface LocationSignalResult {
  signal: LocationSignal;
  /** Week-over-week scan change, e.g. -0.32. Null with no baseline. */
  scanChange: number | null;
  /** Week-over-week change in distinct waiters asking. Null with no baseline. */
  breadthChange: number | null;
  gmPresent: boolean;
  /** One plain sentence, safe to put in front of an owner. */
  summary: string;
  /** True only for 'adoption' — the sole case that should raise an alert. */
  actionable: boolean;
}

function pct(change: number): string {
  return `${Math.round(Math.abs(change) * 100)}%`;
}

export function classifyLocation(input: LocationSignalInput): LocationSignalResult {
  const {
    scansThisWeek,
    scansLastWeek,
    staffAskingThisWeek,
    staffAskingLastWeek,
    gmActiveDays,
    gmTelemetryAvailable = true,
  } = input;

  const gmPresent = gmActiveDays > GM_ABSENT_LOGIN_DAYS;

  if (scansLastWeek === 0) {
    return {
      signal: 'insufficient-data',
      scanChange: null,
      breadthChange: null,
      gmPresent,
      summary:
        scansThisWeek === 0
          ? 'Sin escaneos esta semana ni la anterior. No hay base para comparar.'
          : `${scansThisWeek} escaneos esta semana, sin semana previa para comparar.`,
      actionable: false,
    };
  }

  const scanChange = (scansThisWeek - scansLastWeek) / scansLastWeek;
  const breadthChange =
    staffAskingLastWeek > 0
      ? (staffAskingThisWeek - staffAskingLastWeek) / staffAskingLastWeek
      : null;

  const gmNote =
    gmTelemetryAvailable && !gmPresent
      ? ' El gerente no entró a la app esta semana.'
      : '';

  if (scanChange > SCAN_DROP_THRESHOLD) {
    const dir = scanChange >= 0 ? 'arriba' : 'abajo';
    return {
      signal: 'healthy',
      scanChange,
      breadthChange,
      gmPresent,
      summary: `Escaneos ${dir} ${pct(scanChange)}, con ${staffAskingThisWeek} ${staffAskingThisWeek === 1 ? 'mesero capturando' : 'meseros capturando'}.${gmNote}`,
      actionable: false,
    };
  }

  // Volume is down. Breadth decides what that means.
  if (breadthChange === null) {
    return {
      signal: 'mixed',
      scanChange,
      breadthChange,
      gmPresent,
      summary: `Escaneos ${pct(scanChange)} abajo. Sin base de participación previa para saber si el equipo dejó de pedir o hubo menos afluencia.${gmNote}`,
      actionable: false,
    };
  }

  if (breadthChange >= BREADTH_STABLE_THRESHOLD) {
    return {
      signal: 'traffic',
      scanChange,
      breadthChange,
      gmPresent,
      summary: `Escaneos ${pct(scanChange)} abajo, pero siguen participando ${staffAskingThisWeek} meseros (antes ${staffAskingLastWeek}). El equipo sigue pidiendo; entraron menos comensales.`,
      actionable: false,
    };
  }

  if (breadthChange <= BREADTH_COLLAPSE_THRESHOLD) {
    return {
      signal: 'adoption',
      scanChange,
      breadthChange,
      gmPresent,
      summary: `Escaneos ${pct(scanChange)} abajo y los meseros que capturan bajaron de ${staffAskingLastWeek} a ${staffAskingThisWeek}. Menos gente pidiendo, no sólo menos comensales.${gmNote}`,
      actionable: true,
    };
  }

  return {
    signal: 'mixed',
    scanChange,
    breadthChange,
    gmPresent,
    summary: `Escaneos ${pct(scanChange)} abajo, meseros capturando de ${staffAskingLastWeek} a ${staffAskingThisWeek}. No alcanza para distinguir menos afluencia de menos uso.${gmNote}`,
    actionable: false,
  };
}

/** Spanish label for a signal, for table cells and subject lines. */
export function signalLabel(signal: LocationSignal): string {
  switch (signal) {
    case 'traffic':
      return 'Menos afluencia';
    case 'adoption':
      return 'Revisar uso';
    case 'mixed':
      return 'Sin conclusión';
    case 'healthy':
      return 'En orden';
    case 'insufficient-data':
      return 'Sin datos suficientes';
  }
}
