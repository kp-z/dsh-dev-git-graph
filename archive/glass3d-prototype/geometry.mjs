/**
 * Geometry and material factories for the glass prototype.
 *
 * Every function takes the three.js namespace as its first argument. That looks
 * redundant in the browser — the classes are already in scope once the vendored
 * build is inlined — but it is what lets the real three.js be imported here in
 * Node and the actual geometry be built and measured, with no WebGL context.
 */

/** A rectangle with rounded corners, as a two-dimensional Shape. */
export function roundedRectShape(THREE, w, h, r) {
  const { Shape } = THREE;
  const radius = Math.min(r, w / 2, h / 2);
  const s = new Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + radius, y);
  s.lineTo(x + w - radius, y);
  s.quadraticCurveTo(x + w, y, x + w, y + radius);
  s.lineTo(x + w, y + h - radius);
  s.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  s.lineTo(x + radius, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - radius);
  s.lineTo(x, y + radius);
  s.quadraticCurveTo(x, y, x + radius, y);
  return s;
}

/** Round glass is a sphere; square glass is a rounded slab, centred on origin. */
export function geometryFor(THREE, spec) {
  if (spec.kind === 'circle') return new THREE.SphereGeometry(spec.r, 64, 40);
  const geometry = new THREE.ExtrudeGeometry(
    roundedRectShape(THREE, spec.hw * 2, spec.hh * 2, Math.min(spec.hw, spec.hh) * 0.42),
    {
      depth: spec.depth,
      bevelEnabled: true,
      bevelSize: 0.09,
      bevelThickness: 0.09,
      bevelSegments: 4,
      curveSegments: 18,
    },
  );
  // Extrusion runs from z=0 to z=depth, so shift it to sit on the body's centre.
  geometry.center();
  return geometry;
}

/** Physical glass: transmission plus dispersion is what makes it read as glass. */
export function glassMaterial(THREE, tint) {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0.02,
    transmission: 1,
    thickness: 2.4,
    ior: 1.5,
    dispersion: 3.5,
    iridescence: 1,
    iridescenceIOR: 1.6,
    iridescenceThicknessRange: [120, 520],
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMapIntensity: 2.2,
    attenuationColor: new THREE.Color(tint),
    attenuationDistance: 40,
    transparent: true,
  });
}
