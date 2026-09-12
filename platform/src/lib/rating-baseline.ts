/**
 * The Google rating baseline: what the "before" side of every rating comparison
 * means, and the one sentence that has to travel with it.
 *
 * Imports nothing on purpose. The dashboard, the analytics view, the live view
 * and the owner overview all render this note, and none of them should pull a
 * database client in to get it.
 */

/** Before 2026-03-17, eleven of twelve locations pointed at the wrong Google
 * Place ID; snapshots from before the re-point describe a different listing
 * (review counts jumped 115 -> 1133 overnight) and cannot be a baseline. */
export const RATING_BASELINE_FLOOR = new Date('2026-03-17T00:00:00.000Z');

/**
 * Said out loud wherever a baseline is compared against a current rating, so
 * nobody reads a step change in the numbers as a step change in the estate.
 */
export const RATING_BASELINE_NOTE = 'Base de Google recalibrada el 11 sep 2026 tras corregir el ID de ficha de 11 ubicaciones; comparaciones anteriores usaban otra ficha.';
