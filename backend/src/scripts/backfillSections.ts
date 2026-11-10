import { prisma } from '../config/prisma';
import { replaceSections, sectionsMatch } from '../services/documentSection.service';

// One-off backfill of DocumentSection for projects created before A1 stage 0.
//
//   docker compose exec backend node dist/scripts/backfillSections.js
//
// Idempotent by *presence*: a project that already has sections is left alone,
// whatever their number — a later change to the splitting rules must not
// silently re-cut every stored document. It is checked instead, and a project
// whose sections no longer match its text is reported, not repaired; the audit
// repairs that case itself on the next report (sectionsFor).
//
// Lives under src/ so the production build compiles it: the image has no tsx.

async function main(): Promise<void> {
  const projects = await prisma.project.findMany({
    where: { documentText: { not: null } },
    select: { id: true, documentText: true, _count: { select: { sections: true } } },
    orderBy: { id: 'asc' },
  });

  let built = 0;
  let skipped = 0;
  let mismatched = 0;
  for (const p of projects) {
    const text = p.documentText ?? '';
    if (p._count.sections > 0) {
      skipped += 1;
      const rows = await prisma.documentSection.findMany({ where: { projectId: p.id }, orderBy: { order: 'asc' } });
      if (!sectionsMatch(text, rows)) {
        mismatched += 1;
        console.log(`project ${p.id}: has sections that do not match its document — left as is`);
      }
      continue;
    }
    await prisma.$transaction((tx) => replaceSections(tx, p.id, text));
    const n = await prisma.documentSection.count({ where: { projectId: p.id } });
    console.log(`project ${p.id}: ${text.length} chars → ${n} sections`);
    built += 1;
  }
  console.log(`done: ${built} built, ${skipped} already had sections (${mismatched} of them mismatched), ${projects.length} with a document`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
