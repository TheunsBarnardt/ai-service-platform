import { logger } from '../utils/logger.js';

interface LatencyBucket {
  values: number[];
  maxSize: number;
}

export interface MetricsSnapshot {
  total_requests: number;
  requests_by_service: Record<string, number>;
  error_count: number;
  revenue_total_cents: number;
  latency: {
    p50: number;
    p95: number;
    p99: number;
    count: number;
  };
  collected_since: string;
}

class MetricsCollector {
  private totalRequests = 0;
  private requestsByService = new Map<string, number>();
  private errorCount = 0;
  private revenueTotalCents = 0;
  private latencyBucket: LatencyBucket = { values: [], maxSize: 10_000 };
  private collectedSince = new Date();

  recordRequest(
    serviceId: string,
    latencyMs: number,
    success: boolean,
    revenueCents: number,
  ): void {
    this.totalRequests++;

    const current = this.requestsByService.get(serviceId) ?? 0;
    this.requestsByService.set(serviceId, current + 1);

    if (!success) {
      this.errorCount++;
    }

    this.revenueTotalCents += revenueCents;

    // Store latency for percentile calculation
    if (this.latencyBucket.values.length < this.latencyBucket.maxSize) {
      this.latencyBucket.values.push(latencyMs);
    } else {
      // Reservoir sampling: randomly replace an element
      const idx = Math.floor(Math.random() * this.totalRequests);
      if (idx < this.latencyBucket.maxSize) {
        this.latencyBucket.values[idx] = latencyMs;
      }
    }
  }

  getMetrics(): MetricsSnapshot {
    const sorted = [...this.latencyBucket.values].sort((a, b) => a - b);

    return {
      total_requests: this.totalRequests,
      requests_by_service: Object.fromEntries(this.requestsByService),
      error_count: this.errorCount,
      revenue_total_cents: this.revenueTotalCents,
      latency: {
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        count: sorted.length,
      },
      collected_since: this.collectedSince.toISOString(),
    };
  }

  resetMetrics(): MetricsSnapshot {
    const snapshot = this.getMetrics();

    logger.info(
      {
        total_requests: snapshot.total_requests,
        error_count: snapshot.error_count,
        revenue_total_cents: snapshot.revenue_total_cents,
      },
      'Metrics snapshot taken and reset',
    );

    this.totalRequests = 0;
    this.requestsByService.clear();
    this.errorCount = 0;
    this.revenueTotalCents = 0;
    this.latencyBucket.values = [];
    this.collectedSince = new Date();

    return snapshot;
  }
}

function percentile(sortedValues: number[], pct: number): number {
  if (sortedValues.length === 0) return 0;

  const index = Math.ceil((pct / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, index)];
}

export const metrics = new MetricsCollector();

export const { recordRequest, getMetrics, resetMetrics } = {
  recordRequest: metrics.recordRequest.bind(metrics),
  getMetrics: metrics.getMetrics.bind(metrics),
  resetMetrics: metrics.resetMetrics.bind(metrics),
};
