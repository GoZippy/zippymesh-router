import { getParallelSessions } from '@/lib/routing/smartRouter.js';

export async function GET() {
  const sessions = getParallelSessions();
  return Response.json({
    sessions: Array.from(sessions.entries()).map(([id, state]) => ({
      id,
      callCount: state.callCount,
      lastUsed: new Date(state.lastUsed).toISOString()
    }))
  });
}
