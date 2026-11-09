/**
 * The scene's data: the virtual domain the simulation runs in, and the shapes
 * that populate it. Kept separate from the three.js scene code so the geometry
 * can be built and checked in Node, without a WebGL context.
 */

/** World units. The camera is fitted to this box, so motion never depends on the window. */
export const DOMAIN = { minX: -20, maxX: 20, minY: -12, maxY: 12 };

/**
 * Six bodies: three round (spheres) and three square (rounded slabs).
 * `tilt` is a fixed orientation offset that gives the group depth without
 * pretending the 2D simulation knows about it.
 */
export const SPECS = [
  { kind: 'circle', x: -11.0, y: 3.4, r: 2.55, tint: 0x007aff, vx: 2.9, vy: 1.1, w: 0.30, tilt: [-0.16, 0.22] },
  { kind: 'circle', x: -3.0, y: -5.2, r: 1.75, tint: 0x32ade6, vx: -2.1, vy: 2.3, w: -0.55, tilt: [0.24, -0.14] },
  { kind: 'circle', x: 8.4, y: 6.2, r: 1.30, tint: 0x5e5ce6, vx: -1.5, vy: -1.9, w: 0.85, tilt: [-0.30, -0.18] },
  { kind: 'box', x: 6.0, y: -3.0, hw: 2.45, hh: 1.65, depth: 1.70, tint: 0xbf5af2, vx: -2.4, vy: 1.6, angle: 0.35, w: 0.42, tilt: [0.30, 0.12] },
  { kind: 'box', x: -7.6, y: -6.4, hw: 1.55, hh: 1.55, depth: 1.50, tint: 0x007aff, vx: 1.8, vy: 2.0, angle: -0.5, w: -0.62, tilt: [-0.22, 0.34] },
  { kind: 'box', x: 1.6, y: 7.4, hw: 1.85, hh: 1.15, depth: 1.35, tint: 0x32ade6, vx: -1.3, vy: -2.2, angle: 0.9, w: 0.55, tilt: [0.18, -0.28] },
];
