// Fails if a test names an unknown requirement. With a phase argument, also fails
// if a `Verified by: test` requirement up to that phase has no test.
import { readdirSync, readFileSync } from "node:fs";

const SPEC_DIR = "specs";
const TEST_DIR = "test";
const ID = /\b(?:POLL|HOME|SES|COST|API|SEC|ALERT|DASH|OPS)-\d+\b/g;
const HEADING = /^### ([A-Z]+-\d+): .+\n\nPhase: (\d+)\. Verified by: (test|manual)\.$/gm;

const phase = process.argv[2] === undefined ? null : Number(process.argv[2]);
const problems = [];
const requirements = new Map();

for (const file of readdirSync(SPEC_DIR)) {
  if (!file.endsWith(".md") || file === "README.md") continue;
  const text = readFileSync(`${SPEC_DIR}/${file}`, "utf8");
  const headings = text.match(/^### .+$/gm) ?? [];
  const parsed = [...text.matchAll(HEADING)];
  if (headings.length !== parsed.length) problems.push(`${file}: a requirement heading is missing its "Phase: N. Verified by: x." line`);
  for (const [, id, reqPhase, verifiedBy] of parsed) {
    if (requirements.has(id)) problems.push(`${id}: defined twice`);
    requirements.set(id, { phase: Number(reqPhase), verifiedBy });
  }
}

const covered = new Set();
for (const file of readdirSync(TEST_DIR)) {
  if (!file.endsWith(".test.ts")) continue;
  const text = readFileSync(`${TEST_DIR}/${file}`, "utf8");
  const titles = text.match(/\b(?:it|describe)(?:\.each\([\s\S]*?\))?\(\s*["'`].*["'`]/g) ?? [];
  for (const title of titles) {
    for (const [id] of title.matchAll(ID)) {
      if (!requirements.has(id)) problems.push(`${file}: unknown requirement ${id}`);
      covered.add(id);
    }
  }
}

if (phase !== null) {
  for (const [id, req] of requirements) {
    if (req.verifiedBy === "test" && req.phase <= phase && !covered.has(id)) problems.push(`${id}: no test`);
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`${requirements.size} requirements, ${covered.size} covered by tests`);
