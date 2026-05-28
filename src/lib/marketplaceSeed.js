/**
 * Seed the community marketplace with built-in starter playbooks.
 * Called once at startup if the table is empty.
 */
import { getSqliteDb, publishMarketplacePlaybook } from './localDb.js';

const BUILT_IN_PLAYBOOKS = [
  {
    title: 'Cost Optimizer',
    description: 'Route all requests to free models first, fall back to paid only when needed.',
    author: 'ZippyMesh',
    intent: 'default',
    tags: ['cost', 'free', 'budget'],
    rules: [
      { type: 'filter-in', field: 'isFree', value: true, priority: 1 },
      { type: 'sort', field: 'pricing.inputPerMToken', direction: 'asc', priority: 2 },
    ],
  },
  {
    title: 'Privacy First',
    description: 'Only use local models — no data leaves your machine.',
    author: 'ZippyMesh',
    intent: 'default',
    tags: ['privacy', 'local', 'offline'],
    rules: [
      { type: 'filter-in', field: 'isLocal', value: true, priority: 1 },
    ],
  },
  {
    title: 'Code Expert',
    description: 'Boost models known for strong coding performance.',
    author: 'ZippyMesh',
    intent: 'code',
    tags: ['code', 'programming', 'development'],
    rules: [
      { type: 'boost', field: 'capabilities', value: 'code', score: 25, priority: 1 },
      { type: 'filter-out', field: 'id', value: 'text-embedding-ada-002', priority: 2 },
    ],
  },
  {
    title: 'Low Latency',
    description: 'Prioritize fastest-responding models for real-time applications.',
    author: 'ZippyMesh',
    intent: 'chat',
    tags: ['speed', 'latency', 'realtime'],
    rules: [
      { type: 'sort', field: 'avgLatencyMs', direction: 'asc', priority: 1 },
      { type: 'filter-out', field: 'capabilities', value: 'reasoning', priority: 2 },
    ],
  },
  {
    title: 'OpenRouter Only',
    description: 'Route exclusively through OpenRouter for maximum model variety.',
    author: 'ZippyMesh',
    intent: 'default',
    tags: ['openrouter', 'variety'],
    rules: [
      { type: 'filter-in', field: 'provider', value: 'openrouter', priority: 1 },
    ],
  },
];

export function seedMarketplace() {
  const db = getSqliteDb();
  if (!db) return;
  try {
    const count = db.prepare('SELECT COUNT(*) as c FROM marketplace_playbooks').get()?.c ?? 0;
    if (count > 0) return; // Already seeded
    for (const p of BUILT_IN_PLAYBOOKS) {
      publishMarketplacePlaybook({ ...p, rulesJson: JSON.stringify(p.rules) });
    }
    console.log(`[Marketplace] Seeded ${BUILT_IN_PLAYBOOKS.length} built-in playbooks`);
  } catch (e) {
    console.warn('[Marketplace] Seed failed:', e.message);
  }
}
