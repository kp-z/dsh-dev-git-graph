import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const client = fs.readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');

test('uses official sidebar slot and glass theme tokens', () => {
  assert.match(client, /sidebar\.footer\.action/);
  assert.match(client, /--dsw-alias-bg-base/);
  assert.match(client, /backdrop-filter:blur/);
  assert.match(client, /prefers-reduced-motion/);
  assert.match(client, /data-ds-dark-theme/);
});

test('does not take over official DOM structure', () => {
  assert.doesNotMatch(client, /MutationObserver/);
  assert.doesNotMatch(client, /querySelectorAll/);
  assert.doesNotMatch(client, /display:none/);
});
