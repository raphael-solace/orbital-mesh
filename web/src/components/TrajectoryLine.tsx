import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { geodeticToVec3 } from '../utils/coordinateConversion';
import { forecastTrack, backcastTrack } from '../utils/trajectory';
import type { TrackPoint, TrackStore } from '../hooks/useTrajectories';

interface TrajectoryLineProps {
  /** Selected satellite id whose past + future track we draw. */
  satId: string | number | null | undefined;
  /** Shared, mutable store of per-satellite position history. */
  storeRef: React.MutableRefObject<TrackStore>;
  /** Fraction (0..1) of the buffered history to show, from the time controls. */
  trailFraction?: number;
  /** How many forecast steps to project ahead (≈ degrees of ground track). */
  forecastSteps?: number;
  /** How many steps of past track to synthesize backward before real data fills in. */
  backcastSteps?: number;
}

type Vec3 = [number, number, number];

function toPoints(pts: TrackPoint[]): Vec3[] {
  const out: Vec3[] = [];
  for (const p of pts) {
    const v = geodeticToVec3(p.lat, p.lng, p.alt);
    out.push([v.x, v.y, v.z]);
  }
  return out;
}

// Two points on top of each other so drei's <Line> always has valid geometry
// even before any real samples arrive (it renders nothing visible).
const EMPTY: Vec3[] = [
  [0, 0, 0],
  [0, 0, 0],
];

export function TrajectoryLine({
  satId,
  storeRef,
  trailFraction = 1,
  forecastSteps = 90,
  backcastSteps = 90,
}: TrajectoryLineProps) {
  const [pastPoints, setPastPoints] = useState<Vec3[]>(EMPTY);
  const [futurePoints, setFuturePoints] = useState<Vec3[]>(EMPTY);
  // Track the last serialized geometry so we only push state updates on change.
  const lastPastLen = useRef(0);
  const lastFutureLen = useRef(0);

  useFrame(() => {
    if (satId === null || satId === undefined) return;
    const full = storeRef.current[String(satId)] ?? [];

    if (full.length < 2) {
      if (lastPastLen.current !== 0) {
        lastPastLen.current = 0;
        lastFutureLen.current = 0;
        setPastPoints(EMPTY);
        setFuturePoints(EMPTY);
      }
      return;
    }

    // Trail length control: keep the most recent fraction of real history.
    const keep = Math.max(2, Math.round(full.length * clamp01(trailFraction)));
    const realPast = full.slice(Math.max(0, full.length - keep));

    // Prepend a synthesized backward arc so the trail reads as long immediately,
    // then joins onto the real observed points (oldest → newest).
    const back = backcastTrack(full, backcastSteps);
    const pastAll = [...back, ...realPast];
    const past = toPoints(pastAll);

    // Future: start at the latest real point, then the great-circle forecast.
    const forecast = forecastTrack(full, forecastSteps);
    const future = toPoints([full[full.length - 1], ...forecast]);

    if (past.length !== lastPastLen.current) {
      lastPastLen.current = past.length;
      setPastPoints(past);
    }
    if (future.length !== lastFutureLen.current) {
      lastFutureLen.current = future.length;
      setFuturePoints(future);
    }
  });

  const pastKey = useMemo(() => pastPoints.length, [pastPoints]);
  const futureKey = useMemo(() => futurePoints.length, [futurePoints]);

  if (satId === null || satId === undefined) return null;

  return (
    <>
      {/* Travelled path — solid, warm amber, thick. */}
      <Line
        key={`past-${pastKey}`}
        points={pastPoints}
        color="#ffd166"
        lineWidth={2.5}
        transparent
        opacity={0.9}
        depthTest={false}
        depthWrite={false}
        renderOrder={997}
        frustumCulled={false}
      />
      {/* Forecast — dashed cyan, thick. */}
      <Line
        key={`future-${futureKey}`}
        points={futurePoints}
        color="#00f2ff"
        lineWidth={2}
        dashed
        dashSize={0.08}
        gapSize={0.05}
        transparent
        opacity={0.85}
        depthTest={false}
        depthWrite={false}
        renderOrder={997}
        frustumCulled={false}
      />
    </>
  );
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export default TrajectoryLine;
