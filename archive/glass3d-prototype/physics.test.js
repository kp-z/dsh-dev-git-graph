import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collide, extent, kineticEnergy, makeBox, makeCircle, momentum, step,
} from './physics.mjs';

const BOUNDS = { minX: -40, maxX: 40, minY: -22, maxY: 22 };

/** A repeatable mixed cluster of round and square glass, no gravity. */
function scene() {
  return [
    makeCircle({ x: -6, y: 0, r: 2.4, vx: 3.1, vy: 1.4, w: 0.6 }),
    makeCircle({ x: 2, y: -3, r: 1.7, vx: -2.3, vy: 2.2, w: -1.1 }),
    makeBox({ x: 7, y: 2, hw: 2.6, hh: 1.7, vx: -1.9, vy: -1.6, angle: 0.4, w: 0.9 }),
    makeBox({ x: -3, y: 4, hw: 1.5, hh: 1.5, vx: 1.2, vy: -2.6, angle: -0.7, w: -0.5 }),
    makeCircle({ x: 0, y: 7, r: 1.2, vx: -1.4, vy: -1.1, w: 1.7 }),
  ];
}

function run(bodies, seconds, bounds = BOUNDS, dt = 1 / 120) {
  for (let t = 0; t < Math.round(seconds / dt); t++) step(bodies, dt, bounds);
  return bodies;
}

/** Deepest remaining penetration across every pair. */
function worstOverlap(bodies) {
  let worst = 0;
  for (let i = 0; i < bodies.length; i++) {
    for (let k = i + 1; k < bodies.length; k++) {
      const contact = collide(bodies[i], bodies[k]);
      if (contact) worst = Math.max(worst, contact.depth);
    }
  }
  return worst;
}

test('never produces a non-finite value', () => {
  const bodies = run(scene(), 30);
  for (const b of bodies) {
    for (const key of ['x', 'y', 'angle', 'vx', 'vy', 'w']) {
      assert.ok(Number.isFinite(b[key]), `${b.kind}.${key} became ${b[key]}`);
    }
  }
});

test('keeps every body inside the walls', () => {
  const bodies = scene();
  const dt = 1 / 120;
  for (let t = 0; t < 120 * 60; t++) {
    step(bodies, dt, BOUNDS);
    for (const b of bodies) {
      const [ex, ey] = extent(b);
      // Half a pixel of slack: separation is applied in the same sub-step.
      assert.ok(b.x - ex >= BOUNDS.minX - 0.05, `${b.kind} escaped left at x=${b.x}`);
      assert.ok(b.x + ex <= BOUNDS.maxX + 0.05, `${b.kind} escaped right at x=${b.x}`);
      assert.ok(b.y - ey >= BOUNDS.minY - 0.05, `${b.kind} escaped bottom at y=${b.y}`);
      assert.ok(b.y + ey <= BOUNDS.maxY + 0.05, `${b.kind} escaped top at y=${b.y}`);
    }
  }
});

test('resolves contacts instead of letting bodies sink into each other', () => {
  const bodies = run(scene(), 24);
  assert.ok(worstOverlap(bodies) < 0.06, `bodies still overlap by ${worstOverlap(bodies)}`);
});

test('conserves momentum while nothing touches a wall', () => {
  // A wide pen, and a short run, so only body-body contacts happen.
  const bounds = { minX: -400, maxX: 400, minY: -400, maxY: 400 };
  const bodies = scene();
  const before = momentum(bodies);
  run(bodies, 6, bounds);
  const after = momentum(bodies);
  assert.ok(Math.abs(after[0] - before[0]) < 1e-9, `px drifted by ${after[0] - before[0]}`);
  assert.ok(Math.abs(after[1] - before[1]) < 1e-9, `py drifted by ${after[1] - before[1]}`);
});

test('never gains energy', () => {
  const bodies = scene();
  const start = kineticEnergy(bodies);
  const dt = 1 / 120;
  let peak = start;
  for (let t = 0; t < 120 * 40; t++) {
    step(bodies, dt, BOUNDS);
    peak = Math.max(peak, kineticEnergy(bodies));
  }
  // A little slack for the positional correction doing work on contact.
  assert.ok(peak <= start * 1.02, `energy grew from ${start.toFixed(3)} to ${peak.toFixed(3)}`);
});

test('spins a body that is struck off centre', () => {
  const ball = makeCircle({ x: -3, y: 2.0, r: 0.8, vx: 6, vy: 0 });
  const slab = makeBox({ x: 0, y: 0, hw: 1.4, hh: 1.4, angle: 0, w: 0 });
  const bounds = { minX: -400, maxX: 400, minY: -400, maxY: 400 };
  for (let t = 0; t < 240; t++) step([ball, slab], 1 / 240, bounds);
  // Struck above centre, so the slab must pick up spin rather than just slide.
  assert.ok(Math.abs(slab.w) > 1e-3, `slab did not rotate (w=${slab.w})`);
  assert.ok(Math.abs(ball.w) > 1e-3, `ball did not rotate (w=${ball.w})`);
});

test('is deterministic for identical input', () => {
  const a = run(scene(), 12);
  const b = run(scene(), 12);
  for (let i = 0; i < a.length; i++) {
    for (const key of ['x', 'y', 'angle', 'vx', 'vy', 'w']) {
      assert.equal(a[i][key], b[i][key], `body ${i} ${key} diverged`);
    }
  }
});

test('separates every shape pairing without ordering artifacts', () => {
  // Each pairing must report the same penetration whichever way it is passed.
  const pairs = [
    [makeCircle({ x: 0, y: 0, r: 2 }), makeCircle({ x: 3, y: 0.5, r: 2 })],
    [makeCircle({ x: 0, y: 0, r: 2 }), makeBox({ x: 2, y: 0.4, hw: 2, hh: 1.5, angle: 0.3 })],
    [makeBox({ x: 0, y: 0, hw: 2, hh: 1.5, angle: 0.3 }), makeBox({ x: 2.4, y: 0.5, hw: 1.6, hh: 1.2, angle: -0.2 })],
  ];
  for (const [a, b] of pairs) {
    const forward = collide(a, b);
    const backward = collide(b, a);
    assert.ok(forward, 'expected a contact');
    assert.ok(backward, 'expected a contact when the pair is passed the other way');
    assert.ok(Math.abs(forward.depth - backward.depth) < 1e-9, 'penetration depends on argument order');
    // The normal must point the same way in world space, i.e. A -> B both times.
    assert.ok(Math.abs(forward.nx + backward.nx) < 1e-9, `normal x flipped (${forward.nx} vs ${backward.nx})`);
    assert.ok(Math.abs(forward.ny + backward.ny) < 1e-9, `normal y flipped (${forward.ny} vs ${backward.ny})`);
  }
});
