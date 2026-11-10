import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GROUP_BY_NAME } from './personaGroups';

// The seed carries the groups inline (it imports nothing from src); the
// backfill uses this map. Two copies of one decision — this keeps them equal.

test('every seed persona has the group the map gives it, and the map has no one the seed lacks', () => {
  const seed = fs.readFileSync(path.join(__dirname, '../../prisma/seed.ts'), 'utf8');
  const inSeed = Object.fromEntries([...seed.matchAll(/name: '([^']+)', group: '([a-z]+)'/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(inSeed, { ...GROUP_BY_NAME });
});

test('the approved split: 16 population, 6 business, 12 experts', () => {
  const count = (g: string) => Object.values(GROUP_BY_NAME).filter((v) => v === g).length;
  assert.deepEqual([count('population'), count('business'), count('experts')], [16, 6, 12]);
});
