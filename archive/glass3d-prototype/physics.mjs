/**
 * A small deterministic 2D rigid-body simulation for the glass prototype.
 *
 * Shapes are circles (the round glass) and oriented boxes (the square glass
 * slabs). Gravity is zero on purpose: the bodies float, so linear momentum is
 * conserved and the invariants in physics.test.js stay meaningful.
 *
 * Conventions:
 *   - `n` in a contact points from body A to body B.
 *   - A is pushed along -n, B along +n.
 *   - A point's velocity is `v + w x r`, with the 2D cross given as
 *     (vx - w*ry, vy + w*rx).
 */

const EPS = 1e-9;

/** Rotate a world-space offset into a body's local frame. */
function toLocal(dx, dy, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [dx * c + dy * s, -dx * s + dy * c];
}

/** Rotate a local-frame direction back into world space. */
function toWorld(lx, ly, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [lx * c - ly * s, lx * s + ly * c];
}

function rectInertia(mass, hw, hh) {
  return (mass * (hw * hw + hh * hh)) / 3;
}

export function makeCircle({ x, y, r, vx = 0, vy = 0, angle = 0, w = 0, restitution = 0.92, friction = 0.15 }) {
  const mass = Math.PI * r * r;
  const body = { kind: 'circle', x, y, r, hw: r, hh: r, vx, vy, angle, w, restitution, friction, mass };
  body.invMass = 1 / mass;
  body.invInertia = 1 / ((mass * r * r) / 2);
  return body;
}

export function makeBox({ x, y, hw, hh, vx = 0, vy = 0, angle = 0, w = 0, restitution = 0.92, friction = 0.15 }) {
  const mass = 4 * hw * hh;
  const body = {
    kind: 'box', x, y, hw, hh, vx, vy, angle, w, restitution, friction, mass,
    r: Math.hypot(hw, hh),
  };
  body.invMass = 1 / mass;
  body.invInertia = 1 / rectInertia(mass, hw, hh);
  return body;
}

/** Half-extents of the body's axis-aligned bounding box. */
export function extent(body) {
  if (body.kind === 'circle') return [body.r, body.r];
  const c = Math.abs(Math.cos(body.angle));
  const s = Math.abs(Math.sin(body.angle));
  return [body.hw * c + body.hh * s, body.hw * s + body.hh * c];
}

/** The body's vertex furthest along (nx, ny) — the contact point of choice. */
function supportPoint(body, nx, ny) {
  const [lx, ly] = toLocal(nx, ny, body.angle);
  const sx = lx >= 0 ? body.hw : -body.hw;
  const sy = ly >= 0 ? body.hh : -body.hh;
  const [wx, wy] = toWorld(sx, sy, body.angle);
  return [body.x + wx, body.y + wy];
}

function circleCircle(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const sum = a.r + b.r;
  if (d >= sum - EPS) return null;
  const nx = d > EPS ? dx / d : 1;
  const ny = d > EPS ? dy / d : 0;
  return { a, b, nx, ny, depth: sum - d, px: a.x + nx * a.r, py: a.y + ny * a.r };
}

function circleBox(circle, box) {
  const [lx, ly] = toLocal(circle.x - box.x, circle.y - box.y, box.angle);
  const cx = Math.max(-box.hw, Math.min(box.hw, lx));
  const cy = Math.max(-box.hh, Math.min(box.hh, ly));

  let nxL;
  let nyL;
  let depth;
  if (lx === cx && ly === cy) {
    // Centre is inside the box: leave by the axis of least penetration.
    const px = box.hw - Math.abs(lx);
    const py = box.hh - Math.abs(ly);
    if (px < py) {
      nxL = lx >= 0 ? 1 : -1;
      nyL = 0;
      depth = px + circle.r;
    } else {
      nxL = 0;
      nyL = ly >= 0 ? 1 : -1;
      depth = py + circle.r;
    }
  } else {
    const dx = lx - cx;
    const dy = ly - cy;
    const d = Math.hypot(dx, dy);
    if (d >= circle.r) return null;
    nxL = d > EPS ? dx / d : 1;
    nyL = d > EPS ? dy / d : 0;
    depth = circle.r - d;
  }

  // The local normal points box -> circle; a contact points A(circle) -> B(box).
  const [nx, ny] = toWorld(-nxL, -nyL, box.angle);
  return { a: circle, b: box, nx, ny, depth, px: circle.x - nx * circle.r, py: circle.y - ny * circle.r };
}

function boxProjection(body, ax, ay) {
  const [lx, ly] = toLocal(ax, ay, body.angle);
  const centre = body.x * ax + body.y * ay;
  const radius = Math.abs(lx) * body.hw + Math.abs(ly) * body.hh;
  return [centre - radius, centre + radius];
}

function boxBox(a, b) {
  const axes = [];
  for (const body of [a, b]) {
    const c = Math.cos(body.angle);
    const s = Math.sin(body.angle);
    axes.push([c, s], [-s, c]);
  }

  let best = null;
  for (const [ax, ay] of axes) {
    const [amin, amax] = boxProjection(a, ax, ay);
    const [bmin, bmax] = boxProjection(b, ax, ay);
    const overlap = Math.min(amax, bmax) - Math.max(amin, bmin);
    if (overlap <= EPS) return null; // separating axis: no contact
    if (!best || overlap < best.depth) {
      const ca = a.x * ax + a.y * ay;
      const cb = b.x * ax + b.y * ay;
      const sign = cb >= ca ? 1 : -1;
      best = { depth: overlap, nx: ax * sign, ny: ay * sign };
    }
  }

  const [px, py] = supportPoint(a, best.nx, best.ny);
  return { a, b, nx: best.nx, ny: best.ny, depth: best.depth, px, py };
}

export function collide(a, b) {
  if (a.kind === 'circle' && b.kind === 'circle') return circleCircle(a, b);
  if (a.kind === 'circle') return circleBox(a, b);
  if (b.kind === 'circle') {
    const hit = circleBox(b, a);
    // circleBox built the contact as circle -> box; swap it back to a -> b.
    return hit && { ...hit, a, b, nx: -hit.nx, ny: -hit.ny };
  }
  return boxBox(a, b);
}

function applyImpulse(body, ix, iy, px, py) {
  body.vx += ix * body.invMass;
  body.vy += iy * body.invMass;
  body.w += ((px - body.x) * iy - (py - body.y) * ix) * body.invInertia;
}

function resolveContact(contact) {
  const { a, b, nx, ny, px, py } = contact;
  const rax = px - a.x;
  const ray = py - a.y;
  const rbx = px - b.x;
  const rby = py - b.y;

  const vaX = a.vx - a.w * ray;
  const vaY = a.vy + a.w * rax;
  const vbX = b.vx - b.w * rby;
  const vbY = b.vy + b.w * rbx;

  const rvX = vbX - vaX;
  const rvY = vbY - vaY;
  const vn = rvX * nx + rvY * ny;
  if (vn > 0) return; // already separating

  const raCn = rax * ny - ray * nx;
  const rbCn = rbx * ny - rby * nx;
  const invSum = a.invMass + b.invMass + raCn * raCn * a.invInertia + rbCn * rbCn * b.invInertia;
  if (invSum <= EPS) return;

  // Below a small closing speed, drop restitution so bodies settle instead of
  // buzzing forever on numerical noise.
  const restitution = Math.abs(vn) < 0.6 ? 0 : Math.min(a.restitution, b.restitution);
  const jn = (-(1 + restitution) * vn) / invSum;
  applyImpulse(a, -jn * nx, -jn * ny, px, py);
  applyImpulse(b, jn * nx, jn * ny, px, py);

  // Coulomb friction along the tangent.
  const tx = -ny;
  const ty = nx;
  const vt = rvX * tx + rvY * ty;
  const rtCn = rax * ty - ray * tx;
  const rtCnB = rbx * ty - rby * tx;
  const invSumT = a.invMass + b.invMass + rtCn * rtCn * a.invInertia + rtCnB * rtCnB * b.invInertia;
  if (invSumT <= EPS) return;
  const mu = (a.friction + b.friction) / 2;
  const jt = Math.max(-mu * jn, Math.min(mu * jn, -vt / invSumT));
  applyImpulse(a, -jt * tx, -jt * ty, px, py);
  applyImpulse(b, jt * tx, jt * ty, px, py);
}

/** Push overlapping bodies apart so contacts never persist visually. */
function separate(contact) {
  const { a, b, nx, ny, depth } = contact;
  const invSum = a.invMass + b.invMass;
  if (invSum <= EPS) return;
  const correction = (depth * 0.8) / invSum;
  a.x -= correction * a.invMass * nx;
  a.y -= correction * a.invMass * ny;
  b.x += correction * b.invMass * nx;
  b.y += correction * b.invMass * ny;
}

function contain(body, bounds) {
  const [ex, ey] = extent(body);
  const walls = [
    [body.x - ex < bounds.minX, 1, 0, bounds.minX + ex - body.x],
    [body.x + ex > bounds.maxX, -1, 0, body.x + ex - bounds.maxX],
    [body.y - ey < bounds.minY, 0, 1, bounds.minY + ey - body.y],
    [body.y + ey > bounds.maxY, 0, -1, body.y + ey - bounds.maxY],
  ];
  for (const [hit, nx, ny, depth] of walls) {
    if (!hit) continue;
    body.x += nx * depth;
    body.y += ny * depth;
    const vn = body.vx * -nx + body.vy * -ny;
    if (vn > 0) {
      const restitution = Math.abs(vn) < 0.6 ? 0 : body.restitution;
      const j = (1 + restitution) * vn;
      body.vx += nx * j;
      body.vy += ny * j;
      body.w *= 0.94; // a little spin bleeds off against a wall
    }
  }
}

/** Advance the world by `dt` seconds using fixed sub-steps. */
export function step(bodies, dt, bounds, substeps = 4) {
  const h = dt / substeps;
  for (let s = 0; s < substeps; s++) {
    for (const body of bodies) {
      body.x += body.vx * h;
      body.y += body.vy * h;
      body.angle += body.w * h;
    }
    for (let i = 0; i < bodies.length; i++) {
      for (let k = i + 1; k < bodies.length; k++) {
        const contact = collide(bodies[i], bodies[k]);
        if (contact) {
          resolveContact(contact);
          separate(contact);
        }
      }
    }
    for (const body of bodies) contain(body, bounds);
  }
  return bodies;
}

/** Total linear momentum — conserved while nothing touches a wall. */
export function momentum(bodies) {
  return bodies.reduce((acc, b) => [acc[0] + b.mass * b.vx, acc[1] + b.mass * b.vy], [0, 0]);
}

export function kineticEnergy(bodies) {
  return bodies.reduce((sum, b) => sum + 0.5 * b.mass * (b.vx * b.vx + b.vy * b.vy) + 0.5 * (1 / b.invInertia) * b.w * b.w, 0);
}
