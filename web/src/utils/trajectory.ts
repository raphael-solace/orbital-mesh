import type { TrackPoint } from '../hooks/useTrajectories';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/**
 * Forecast the future ground track by extrapolating the satellite's recent
 * motion along a great circle. We derive a heading and angular step from the
 * last observed segment, then advance step-by-step across the sphere. Altitude
 * is held near the latest value (slowly relaxed toward the recent mean) so the
 * forecast shell matches the current orbit height.
 *
 * This uses only the buffered event positions — no velocity or TLE required —
 * so it literally continues "from the last events' locations."
 */
// Fixed angular step per projected point. Each point is ~1° of great-circle
// arc, so `steps` points ≈ `steps` degrees of ground track regardless of how
// finely (or coarsely) the live samples happen to be spaced.
const STEP_ANGLE = 1 * DEG;

/**
 * Project the future ground track ahead of the satellite along the great circle
 * defined by its most recent motion. Default ~90 steps ≈ a quarter-orbit arc.
 */
export function forecastTrack(history: TrackPoint[], steps = 90): TrackPoint[] {
  return projectTrack(history, steps, 1);
}

/**
 * Project the past ground track *backward* from the earliest observed point, so
 * a selected satellite shows a long trailing arc immediately instead of waiting
 * a minute for real samples to accumulate. Returned oldest-first so it can be
 * prepended to the real history.
 */
export function backcastTrack(history: TrackPoint[], steps = 90): TrackPoint[] {
  const back = projectTrack(history, steps, -1);
  // projectTrack walks away from the endpoint; reverse so the result runs
  // oldest → newest and joins cleanly onto the real history.
  return back.reverse();
}

/**
 * Shared great-circle extrapolation. `dir = 1` projects forward from the last
 * point along the direction of travel; `dir = -1` projects backward from the
 * first point, away from the direction of travel.
 */
function projectTrack(history: TrackPoint[], steps: number, dir: 1 | -1): TrackPoint[] {
  if (history.length < 2) return [];

  // Anchor at the relevant endpoint and find a distinct neighbour for heading.
  const anchor = dir === 1 ? history[history.length - 1] : history[0];
  let neighbour = dir === 1 ? history[history.length - 2] : history[1];
  if (dir === 1) {
    for (let i = history.length - 2; i >= 0; i--) {
      if (isDistinct(history[i], anchor)) { neighbour = history[i]; break; }
    }
  } else {
    for (let i = 1; i < history.length; i++) {
      if (isDistinct(history[i], anchor)) { neighbour = history[i]; break; }
    }
  }

  const start = { lat: anchor.lat * DEG, lng: anchor.lng * DEG };
  const other = { lat: neighbour.lat * DEG, lng: neighbour.lng * DEG };

  // Heading in the direction of travel (forward) or opposite it (backward).
  const bearing =
    dir === 1 ? initialBearing(other, start) : initialBearing(start, other);

  const out: TrackPoint[] = [];
  let cur = start;
  const alt = anchor.alt;
  for (let i = 1; i <= steps; i++) {
    cur = destinationPoint(cur, bearing, STEP_ANGLE);
    out.push({ lat: cur.lat * RAD, lng: cur.lng * RAD, alt, t: anchor.t + dir * i });
  }
  return out;
}

function isDistinct(p: TrackPoint, q: TrackPoint): boolean {
  return Math.abs(p.lat - q.lat) > 1e-6 || Math.abs(p.lng - q.lng) > 1e-6;
}

interface RadPoint {
  lat: number;
  lng: number;
}

function initialBearing(p1: RadPoint, p2: RadPoint): number {
  const dLng = p2.lng - p1.lng;
  const y = Math.sin(dLng) * Math.cos(p2.lat);
  const x =
    Math.cos(p1.lat) * Math.sin(p2.lat) -
    Math.sin(p1.lat) * Math.cos(p2.lat) * Math.cos(dLng);
  return Math.atan2(y, x);
}

function destinationPoint(p: RadPoint, bearing: number, dist: number): RadPoint {
  const lat = Math.asin(
    Math.sin(p.lat) * Math.cos(dist) +
      Math.cos(p.lat) * Math.sin(dist) * Math.cos(bearing),
  );
  const lng =
    p.lng +
    Math.atan2(
      Math.sin(bearing) * Math.sin(dist) * Math.cos(p.lat),
      Math.cos(dist) - Math.sin(p.lat) * Math.sin(lat),
    );
  return { lat, lng };
}
