import * as THREE from "three";
import { Suspense, useState, useEffect, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Starfield } from "./components/Starfield";
import { Earth } from './components/Earth';
import { Sun } from "./components/Sun";
import ControlPanel from "./components/ControlPanel";
import { InfoPanel } from "./components/InfoPanel";
import { Moon } from "./components/Moon";
import { Atmosphere } from "./components/Atmosphere";
import { SatelliteManager } from "./components/SatelliteManager";
import { SatelliteTooltip } from "./components/SatelliteTooltip";
import { MobileMenu } from "./components/MobileMenu";
import { RegionGrid } from "./components/RegionGrid";
import { TrajectoryLine } from "./components/TrajectoryLine";
import { getSunDirection } from "./utils/astronomy";
import { useSolace } from "./hooks/useSolace";
import { useIsMobile } from "./hooks/useIsMobile";
import { useTrajectories } from "./hooks/useTrajectories";

interface TimeControlsState {
  paused: boolean;
  speed: number; // animation speed multiplier (auto-rotation / motion)
  trailFraction: number; // 0..1 of buffered history to draw
}

function World({
  children,
  paused,
}: {
  children: React.ReactNode;
  paused: boolean;
}) {
  const worldRef = useRef<THREE.Group>(null);
  // Freeze the day-rotation while paused by holding the last angle.
  const frozenAngle = useRef<number | null>(null);

  useFrame(() => {
    if (!worldRef.current) return;

    if (paused) {
      if (frozenAngle.current === null) frozenAngle.current = worldRef.current.rotation.y;
      worldRef.current.rotation.y = frozenAngle.current;
      return;
    }
    frozenAngle.current = null;

    const now = new Date();
    const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;

    const dayRotation = ((utcHours - 12) / 24) * 2 * Math.PI;
    const BIAS_DEGREES = 90;
    const CALIBRATION = Math.PI + (BIAS_DEGREES * Math.PI / 180);

    worldRef.current.rotation.y = dayRotation + CALIBRATION;
  });

  return <group ref={worldRef}>{children}</group>;
}

function App() {
  const [activeTopics, setActiveTopics] = useState<string[]>(["earth/sat/tracked/*/*/*/*/*"]);
  const [regionKey, setRegionKey] = useState("all");
  const [activeHoverData, setActiveHoverData] = useState<any | null>(null);
  const [selectedSat, setSelectedSat] = useState<any | null>(null);
  const [timeState, setTimeState] = useState<TimeControlsState>({
    paused: false,
    speed: 1,
    trailFraction: 1,
  });
  const [sunDirection] = useState(() => getSunDirection());
  const { data, isConnected, msgRate } = useSolace(activeTopics);
  const [satelliteCount, setSatelliteCount] = useState(0);
  const isMobile = useIsMobile();

  // Buffer the focused satellite's positions so we can draw its track.
  const activeTopicsKey = activeTopics.join('|');
  const selectedId = selectedSat?.id ?? selectedSat?.name ?? selectedSat?.noradId ?? null;
  const hoverId = activeHoverData?.id ?? activeHoverData?.name ?? activeHoverData?.noradId ?? null;
  const focusId = selectedId ?? hoverId;
  const { storeRef } = useTrajectories(data, activeTopicsKey, focusId);

  // Drop the pinned selection when the subscription/region changes.
  useEffect(() => {
    setSelectedSat(null);
  }, [activeTopicsKey]);

  // Keep the pinned satellite's tooltip position/data fresh on new events.
  useEffect(() => {
    if (!data || !selectedSat) return;
    try {
      const raw = typeof data.getBinaryAttachment === 'function'
        ? data.getBinaryAttachment()
        : data;
      const s = raw.indexOf('{');
      const e = raw.lastIndexOf('}');
      if (s === -1) return;
      const payload = JSON.parse(raw.substring(s, e + 1));
      const pid = payload.id ?? payload.name ?? payload.noradId;
      if (String(pid) === String(selectedId)) {
        setSelectedSat((prev: Record<string, unknown>) => ({ ...prev, ...payload }));
      }
    } catch {
      /* ignore */
    }
    // Mirrors the hover live-update effect below; keyed on new messages only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    if (!data || !activeHoverData) return;

    try {
      const rawString = typeof data.getBinaryAttachment === 'function'
        ? data.getBinaryAttachment()
        : data;

      const jsonStart = rawString.indexOf('{');
      const jsonEnd = rawString.lastIndexOf('}');
      if (jsonStart === -1) return;
      const payload = JSON.parse(rawString.substring(jsonStart, jsonEnd + 1));

      const satId = payload.id || payload.name || payload.noradId;

      if (satId === activeHoverData.id) {
        setActiveHoverData((prev: any) => ({
          ...prev,
          ...payload,
          x: prev.x,
          y: prev.y
        }));
      }
    } catch (e) {
      console.error("Tooltip Live-Update Error:", e);
    }
  }, [data]);

  const controlPanel = (
    <ControlPanel
      satelliteCount={satelliteCount}
      onFilterChange={setActiveTopics}
      onRegionChange={setRegionKey}
      msgRate={msgRate}
      isConnected={isConnected}
      solaceData={data}
      paused={timeState.paused}
      onTogglePause={() => setTimeState((s) => ({ ...s, paused: !s.paused }))}
      mobile={isMobile}
    />
  );
  const infoPanel = <InfoPanel mobile={isMobile} />;

  return (
    <div style={{ width: '100vw', height: '100dvh', position: 'relative', overflow: 'hidden' }}>
      {!isMobile && (
        <>
          {controlPanel}
          {infoPanel}
        </>
      )}
      <Canvas
        camera={{ position: [0, 0.1, 5] }}
        gl={{
          toneMapping: THREE.NoToneMapping
        }}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          display: 'block'
        }}>

        <World paused={timeState.paused}>
          <Earth sunDirection={sunDirection} />
          <Atmosphere sunDirection={sunDirection} />
          <RegionGrid regionKey={regionKey} />
          <TrajectoryLine
            satId={focusId}
            storeRef={storeRef}
            trailFraction={timeState.trailFraction}
          />
          <SatelliteManager
            key={activeTopics.join('|')}
            filterTopics={activeTopics}
            solaceData={data}
            isConnected={isConnected}
            onHoverSatellite={setActiveHoverData}
            onSelectSatellite={setSelectedSat}
            selectedId={selectedId}
            onCountChange={setSatelliteCount}
            isMobile={isMobile}
            speed={timeState.speed}
            paused={timeState.paused}
          />
        </World>
        <Suspense fallback={null}>
          <Moon sunDirection={sunDirection} />
        </Suspense>
        <Sun direction={sunDirection} />
        <hemisphereLight args={[0xffffff, 0x000000, 3.0]} />
        <directionalLight
          position={[sunDirection.x * 10, sunDirection.y * 10, sunDirection.z * 10]}
          intensity={2}
        />
        <Starfield />
        <OrbitControls
          enableDamping={true}
          dampingFactor={0.05}
          autoRotate={!activeHoverData && !selectedSat && !timeState.paused}
          autoRotateSpeed={0.08 * timeState.speed}
          minDistance={2.6}
          maxDistance={25}
        />
      </Canvas>

      {activeHoverData && (
        <SatelliteTooltip
          data={activeHoverData}
          visible={!!activeHoverData}
          x={activeHoverData?.x}
          y={activeHoverData?.y}
          mobile={isMobile}
          onClose={() => setActiveHoverData(null)}
        />
      )}

      {selectedSat && (
        <div
          style={{
            position: 'absolute',
            top: isMobile ? 12 : 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 25,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '6px 12px',
            borderRadius: 999,
            background: 'rgba(10, 14, 20, 0.75)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 209, 102, 0.5)',
            color: '#ffd166',
            fontFamily: 'monospace',
            fontSize: 12,
            whiteSpace: 'nowrap',
          }}
        >
          <span>◉ TRACKING {selectedSat.name ?? selectedSat.id}</span>
          <button
            onClick={() => setSelectedSat(null)}
            style={{
              cursor: 'pointer',
              border: '1px solid rgba(255,209,102,0.5)',
              background: 'transparent',
              color: '#ffd166',
              borderRadius: 6,
              padding: '2px 8px',
              fontFamily: 'monospace',
              fontSize: 11,
            }}
          >
            CLEAR
          </button>
        </div>
      )}

      {isMobile && (
        <MobileMenu
          info={infoPanel}
          controls={controlPanel}
        />
      )}
    </div>
  );
}

export default App;
