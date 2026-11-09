import test from 'node:test';
import assert from 'node:assert/strict';

// The real vendored three.js. None of what this file touches needs a WebGL
// context, which is what makes the geometry checkable before a browser runs it.
import * as THREE from './vendor/three.module.js';

import { DOMAIN, SPECS } from './specs.mjs';
import { geometryFor, glassMaterial, roundedRectShape } from './geometry.mjs';
import { collide, extent, makeBox, makeCircle } from './physics.mjs';

test('builds finite geometry for every body in the scene', () => {
  for (const spec of SPECS) {
    const geometry = geometryFor(THREE, spec);
    const position = geometry.getAttribute('position');
    assert.ok(position, `${spec.kind} produced no positions`);
    assert.ok(position.count > 0, `${spec.kind} produced an empty mesh`);
    for (let i = 0; i < position.array.length; i++) {
      assert.ok(Number.isFinite(position.array[i]), `${spec.kind} position ${i} is ${position.array[i]}`);
    }
    // Normals matter here: without them the glass renders flat and black.
    assert.ok(geometry.getAttribute('normal'), `${spec.kind} has no normals`);
  }
});

test('sizes each solid to its spec, including the bevel', () => {
  const BEVEL = 0.09;
  for (const spec of SPECS) {
    const geometry = geometryFor(THREE, spec);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const size = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
    for (const value of size) assert.ok(Number.isFinite(value) && value > 0, `degenerate extent ${value}`);

    if (spec.kind === 'circle') {
      const d = size[0];
      assert.ok(Math.abs(d - spec.r * 2) < 1e-6, `sphere diameter ${d} != ${spec.r * 2}`);
      assert.ok(Math.abs(size[2] - d) < 1e-6, 'sphere is not round in z');
    } else {
      // Rounded corners trim the box; the bevel then grows it past the outline,
      // so the width lands between the inscribed and the bevelled size.
      const maxW = spec.hw * 2 + BEVEL * 2;
      assert.ok(size[0] <= maxW + 1e-6, `slab width ${size[0]} exceeds ${maxW}`);
      assert.ok(size[0] > spec.hw * 2 * 0.95, `slab width ${size[0]} is too far under ${spec.hw * 2}`);
      assert.ok(size[2] > spec.depth, `slab depth ${size[2]} is thinner than ${spec.depth}`);
    }
  }
});

test('centres each solid on its own origin', () => {
  for (const spec of SPECS) {
    const geometry = geometryFor(THREE, spec);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    // A slab extruded from z=0 must be re-centred, or it floats off its body.
    for (const axis of ['x', 'y', 'z']) {
      const mid = (box.max[axis] + box.min[axis]) / 2;
      assert.ok(Math.abs(mid) < 1e-6, `${spec.kind} is off-centre on ${axis} by ${mid}`);
    }
  }
});

test('asks for real glass, with dispersion actually set', () => {
  const material = glassMaterial(THREE, 0x007aff);
  assert.equal(material.transmission, 1);
  assert.equal(material.ior, 1.5);
  // three silently ignores unknown constructor keys, so assert the property
  // really landed rather than trusting that it was accepted.
  assert.equal(material.dispersion, 3.5, 'dispersion did not stick — refraction will not split colour');
  assert.ok(material.thickness > 0, 'transmission without thickness renders as clear plastic');
  assert.equal(material.transparent, true);
  assert.equal(material.metalness, 0);
  assert.ok(material.attenuationColor, 'no attenuation colour set');
});

test('rounds the slab corners to the requested radius', () => {
  const w = 5;
  const h = 3;
  const r = 1;
  const points = roundedRectShape(THREE, w, h, r).getPoints(64);
  assert.ok(points.length > 8, 'shape has too few points to be rounded');
  for (const p of points) {
    assert.ok(p.x >= -w / 2 - 1e-9 && p.x <= w / 2 + 1e-9, `x ${p.x} outside the rectangle`);
    assert.ok(p.y >= -h / 2 - 1e-9 && p.y <= h / 2 + 1e-9, `y ${p.y} outside the rectangle`);
  }
  // A rounded corner means no point sits in the very corner of the bounding box.
  const inCorner = points.some((p) => Math.abs(Math.abs(p.x) - w / 2) < 1e-6 && Math.abs(Math.abs(p.y) - h / 2) < 1e-6);
  assert.ok(!inCorner, 'the corner is square, so the radius was not applied');
});

test('starts every body inside the domain and clear of the others', () => {
  const toBody = (spec) => (spec.kind === 'circle'
    ? makeCircle({ x: spec.x, y: spec.y, r: spec.r })
    : makeBox({ x: spec.x, y: spec.y, hw: spec.hw, hh: spec.hh, angle: spec.angle || 0 }));

  const bodies = SPECS.map(toBody);
  bodies.forEach((body, i) => {
    const [ex, ey] = extent(body);
    assert.ok(body.x - ex >= DOMAIN.minX && body.x + ex <= DOMAIN.maxX, `body ${i} starts outside the domain on x`);
    assert.ok(body.y - ey >= DOMAIN.minY && body.y + ey <= DOMAIN.maxY, `body ${i} starts outside the domain on y`);
  });

  // Beginning overlapped would look broken on the very first frame.
  for (let i = 0; i < bodies.length; i++) {
    for (let k = i + 1; k < bodies.length; k++) {
      const contact = collide(bodies[i], bodies[k]);
      assert.ok(!contact, `bodies ${i} and ${k} start overlapping by ${contact?.depth}`);
    }
  }
});
