import { useEffect, useRef } from 'react';

/** A single recorded position sample for a satellite. */
export interface TrackPoint {
  lat: number;
  lng: number;
  alt: number;
  t: number; // client receive time (ms)
}

/** Rolling per-satellite position history, keyed by satellite id. */
export type TrackStore = Record<string, TrackPoint[]>;

const MAX_POINTS = 240; // cap history per satellite to bound memory
const MIN_MOVE_DEG = 0.01; // ignore duplicate/near-identical samples

interface SatPayload {
  id?: string | number;
  name?: string;
  noradId?: string | number;
  lat?: number;
  lng?: number;
  alt?: number;
}

function parsePayload(solaceData: unknown): SatPayload | null {
  if (!solaceData) return null;
  try {
    const src = solaceData as { getBinaryAttachment?: () => string };
    const raw =
      typeof src.getBinaryAttachment === 'function'
        ? src.getBinaryAttachment()
        : (solaceData as string);
    if (typeof raw !== 'string') return null;
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    return JSON.parse(raw.substring(start, end + 1)) as SatPayload;
  } catch {
    return null;
  }
}

/**
 * Buffers position history for the *focused* satellite (the one currently
 * selected/hovered) so we can draw its actual past track. History lives in a
 * ref (no re-render per message); read the current snapshot from inside a
 * render loop (useFrame) where per-frame reads are cheap.
 *
 * We deliberately record only the focused satellite rather than the whole
 * constellation: with a wildcard subscription the stream carries 1000+ distinct
 * satellites, so a shared buffer spreads one sample across each of them and no
 * single track ever grows past a point or two. Scoping to the focused id lets
 * that satellite's ~1 Hz updates accumulate into a real multi-point track.
 *
 * `resetKey` clears the buffer when the subscription/region changes so stale
 * tracks from a previous filter don't linger.
 */
export function useTrajectories(
  solaceData: unknown,
  resetKey: string,
  focusId: string | number | null | undefined,
) {
  const storeRef = useRef<TrackStore>({});
  const focusRef = useRef<string | null>(focusId != null ? String(focusId) : null);

  useEffect(() => {
    focusRef.current = focusId != null ? String(focusId) : null;
    // Drop any other satellite's buffered points so a stale track from a
    // previously focused satellite doesn't linger under the new one.
    const key = focusRef.current;
    if (key === null) {
      storeRef.current = {};
    } else {
      const kept = storeRef.current[key];
      storeRef.current = kept ? { [key]: kept } : {};
    }
  }, [focusId]);

  useEffect(() => {
    storeRef.current = {};
  }, [resetKey]);

  useEffect(() => {
    const payload = parsePayload(solaceData);
    if (!payload) return;

    const id = payload.id ?? payload.name ?? payload.noradId;
    if (id === undefined || id === null) return;
    if (typeof payload.lat !== 'number' || typeof payload.lng !== 'number') return;

    const key = String(id);
    // Only buffer the focused satellite's history (see hook doc comment).
    if (focusRef.current === null || key !== focusRef.current) return;
    const store = storeRef.current;
    const history = store[key] ?? (store[key] = []);
    const last = history[history.length - 1];

    // Skip duplicates (same position re-sent) to keep the track meaningful.
    if (
      last &&
      Math.abs(last.lat - payload.lat) < MIN_MOVE_DEG &&
      Math.abs(last.lng - payload.lng) < MIN_MOVE_DEG
    ) {
      return;
    }

    history.push({
      lat: payload.lat,
      lng: payload.lng,
      alt: typeof payload.alt === 'number' ? payload.alt : (last?.alt ?? 0),
      t: Date.now(),
    });
    if (history.length > MAX_POINTS) history.splice(0, history.length - MAX_POINTS);
  }, [solaceData]);

  const getTrack = (id: string | number | undefined): TrackPoint[] => {
    if (id === undefined || id === null) return [];
    return storeRef.current[String(id)] ?? [];
  };

  return { getTrack, storeRef };
}
