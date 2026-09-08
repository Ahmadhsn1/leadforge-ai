#!/usr/bin/env node
/**
 * Checks every model id in the registry against OpenRouter's live catalogue.
 *
 * A retired model id does not fail at startup. It fails on the first real call
 * for whichever task routed to it, after the router has already committed —
 * which is how four dead ids sat in the registry unnoticed. Run this in CI.
 *
 * Exits non-zero if any id is missing.
 */
import fs from 'node:fs';
const ids = [...fs.readFileSync(new URL('../packages/ai/src/registry.ts', import.meta.url), 'utf8').matchAll(/^\s*id: '([^']+)'/gm)].map((m) => m[1]);
const { data } = await (await fetch('https://openrouter.ai/api/v1/models')).json();
const live = new Map(data.map((m) => [m.id, m]));
const missing = [];
console.log('registry entries:', ids.length);
for (const id of ids) {
  const m = live.get(id);
  if (!m) { console.log(`MISSING  ${id}`); missing.push(id); continue; }
  const so = (m.supported_parameters ?? []).includes('structured_outputs');
  console.log(`ok       ${id} | ctx=${m.context_length} | in=$${m.pricing.prompt * 1e6}/M out=$${m.pricing.completion * 1e6}/M | structured=${so}`);
}
if (missing.length > 0) {
  console.error(`
${missing.length} model id(s) no longer exist on OpenRouter.`);
  process.exit(1);
}
