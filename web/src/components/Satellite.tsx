import { useRef, useMemo, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { geodeticToVec3 } from '../utils/coordinateConversion';

interface SatelliteProps extends React.ComponentPropsWithoutRef<'mesh'> {
  data: {
    lat: number;
    lng: number;
    alt: number;
  };
  name: string;
  /** True when this satellite is the pinned/selected one (trajectory shown). */
  selected?: boolean;
  /** Animation speed multiplier from the time controls. */
  speed?: number;
  /** When true, freeze position/scale animation. */
  paused?: boolean;
}

export function Satellite({
  data,
  onPointerOver,
  onPointerOut,
  selected = false,
  speed = 1,
  paused = false,
  ...props
}: SatelliteProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  const targetPosition = useMemo(() => {
    return geodeticToVec3(data.lat, data.lng, data.alt);
  }, [data.lat, data.lng, data.alt]);

  useFrame(() => {
    if (meshRef.current) {
      if (!paused) {
        // Scale the lerp by speed so faster playback catches up quicker.
        const posLerp = Math.min(1, 0.1 * speed);
        meshRef.current.position.lerp(targetPosition, posLerp);
      }

      const targetScale = selected ? 2 : hovered ? 1.75 : 1;
      meshRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.15);
    }
  });

  return (
    <mesh
      ref={meshRef}
      {...props}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        setHovered(true);
        if (typeof onPointerOver === 'function') {
          onPointerOver(e);
        }
      }}
      onPointerOut={(e: ThreeEvent<PointerEvent>) => {
        setHovered(false);
        if (typeof onPointerOut === 'function') {
          onPointerOut(e);
        }
      }}
    >
      <sphereGeometry args={[0.03, 16, 16]} />
      <meshStandardMaterial
        color={selected ? "#ffd166" : hovered ? "#ffeb3b" : "#00c897"}
        emissive={selected ? "#ffd166" : hovered ? "#ffeb3b" : "#009670"}
        emissiveIntensity={selected ? 6 : hovered ? 5 : 2}
        toneMapped={false}
      />
    </mesh>
  );
}