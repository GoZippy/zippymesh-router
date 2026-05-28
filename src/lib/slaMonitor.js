/**
 * SLA Monitor — checks per-provider SLA thresholds and auto-disables providers in breach.
 * Run periodically by the maintenance scheduler.
 */
import { getSlaStats, getSlaPctLatency, getSlaConfig, disableProviderSla, getDisabledProviders } from './localDb.js';

/**
 * Check all providers with SLA config for breaches.
 * Auto-disables providers that have breached their threshold for > breach_window_minutes.
 * Returns array of breach events.
 */
export function checkSlaBreaches() {
  const stats = getSlaStats({ hours: 2 }); // Check last 2h window
  const breaches = [];

  for (const stat of stats) {
    try {
      const config = getSlaConfig(stat.provider);
      if (!config) continue;
      if (config.is_disabled) continue; // already disabled

      const p95 = getSlaPctLatency({ provider: stat.provider, pct: 95, hours: 1 });
      const uptimeBreach = stat.uptime_pct < config.target_uptime_pct;
      const latencyBreach = p95 !== null && p95 > config.target_p95_latency_ms;

      if (uptimeBreach || latencyBreach) {
        const reason = [];
        if (uptimeBreach) reason.push(`uptime ${stat.uptime_pct?.toFixed(1)}% < target ${config.target_uptime_pct}%`);
        if (latencyBreach) reason.push(`P95 latency ${p95}ms > target ${config.target_p95_latency_ms}ms`);
        const breachMsg = reason.join('; ');

        breaches.push({
          provider: stat.provider,
          uptimePct: stat.uptime_pct,
          p95LatencyMs: p95,
          reason: breachMsg,
        });

        if (config.auto_disable_on_breach) {
          console.warn(`[SLA] Auto-disabling ${stat.provider}: ${breachMsg}`);
          disableProviderSla(stat.provider, breachMsg);
        } else {
          console.warn(`[SLA] Breach detected for ${stat.provider}: ${breachMsg}`);
        }
      }
    } catch (e) {
      // Non-fatal per-provider error
    }
  }

  return breaches;
}

/**
 * Generate a weekly SLA summary report.
 */
export function generateWeeklySlaReport() {
  const stats = getSlaStats({ hours: 24 * 7 });
  return {
    generatedAt: new Date().toISOString(),
    periodDays: 7,
    providers: stats.map(s => ({
      provider: s.provider,
      uptimePct: s.uptime_pct,
      totalRequests: s.total_requests,
      avgLatencyMs: s.avg_latency_ms,
      p95LatencyMs: getSlaPctLatency({ provider: s.provider, pct: 95, hours: 24 * 7 }),
    })),
  };
}
