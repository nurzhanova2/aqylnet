import { prisma } from '../config/prisma';
import { GROUP_BY_NAME } from '../config/personaGroups';

// One-off fill of Persona.group for the library that existed before the column
// (A1 stage 1).
//
//   docker compose exec backend node dist/scripts/backfillPersonaGroups.js
//
// Idempotent by name and by presence: a persona whose name is in the map gets
// its group only if it has none yet, so a group someone changed by hand is not
// overwritten and a second run changes nothing. Personas not in the map —
// created by users — stay null until someone places them; they are listed.
// The two personas added in this stage come from the seed (RUN_SEED), which
// adds missing personas by name; run it first.

async function main(): Promise<void> {
  const personas = await prisma.persona.findMany({ select: { id: true, name: true, group: true }, orderBy: { id: 'asc' } });

  let set = 0;
  let kept = 0;
  const unmapped: string[] = [];
  for (const p of personas) {
    const group = GROUP_BY_NAME[p.name];
    if (!group) { if (!p.group) unmapped.push(`${p.id} ${p.name}`); continue; }
    if (p.group) { kept += 1; continue; }
    await prisma.persona.update({ where: { id: p.id }, data: { group } });
    console.log(`persona ${p.id} ${p.name}: ${group}`);
    set += 1;
  }
  const missing = Object.keys(GROUP_BY_NAME).filter((n) => !personas.some((p) => p.name === n));
  console.log(`done: ${set} set, ${kept} already had a group, ${unmapped.length} without a group and not in the map${unmapped.length ? ` (${unmapped.join(', ')})` : ''}`);
  if (missing.length) console.log(`not in the library (run the seed first?): ${missing.join(', ')}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
