import { useTexture } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";

/**
 * World-space selection mark using the generated ring cell in the brush atlas.
 * Decorative only: semantic selected/hover state remains in the DOM and store.
 */
export function InkSelection({
  position = [0, 0.08, 0],
  footprint = 3,
  rotation = 0,
  selected = false,
  hovered = false,
  destination = false,
}) {
  const source = useTexture("/assets/selection/selection-mask-atlas-v1.png");
  const ring = useMemo(() => {
    const texture = source.clone();
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    // Atlas is 2 columns × 4 rows. Select the top-right incomplete ring.
    texture.repeat.set(0.5, 0.25);
    texture.offset.set(0.5, 0.75);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }, [source]);

  const visible = selected || hovered || destination;
  if (!visible) return null;
  const opacity = selected ? 0.74 : destination ? 0.56 : 0.18;
  const color = destination ? "#d3a13b" : "#f0eadf";

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} scale={[footprint * 1.18, footprint * 0.74, 1]} renderOrder={20} raycast={() => null}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={ring}
          color={color}
          transparent
          opacity={opacity}
          depthWrite={false}
          toneMapped={false}
          polygonOffset
          polygonOffsetFactor={-3}
        />
      </mesh>
      {destination && (
        <mesh position={[footprint * 0.48, 0.16, 0]} raycast={() => null}>
          <octahedronGeometry args={[Math.max(0.08, footprint * 0.045), 0]} />
          <meshBasicMaterial color="#d3a13b" toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}
