import { pool } from '../db/pool.js';
import { logger } from '../utils/logger.js';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

interface CircuitEntry {
  state: CircuitState;
  failures: number;
  openedAt: number | null;
  lastFailureAt: number | null;
}

const FAILURE_THRESHOLD = 10;
const OPEN_DURATION_MS = 60_000;

export class CircuitBreaker {
  private circuits = new Map<string, CircuitEntry>();

  private getOrCreate(serviceId: string): CircuitEntry {
    let entry = this.circuits.get(serviceId);
    if (!entry) {
      entry = {
        state: CircuitState.CLOSED,
        failures: 0,
        openedAt: null,
        lastFailureAt: null,
      };
      this.circuits.set(serviceId, entry);
    }
    return entry;
  }

  recordSuccess(serviceId: string): void {
    const entry = this.getOrCreate(serviceId);

    if (entry.state === CircuitState.HALF_OPEN) {
      logger.info({ serviceId }, 'Circuit breaker closing after successful probe');
    }

    entry.state = CircuitState.CLOSED;
    entry.failures = 0;
    entry.openedAt = null;
    entry.lastFailureAt = null;

    this.persistState(serviceId, entry).catch((err) => {
      logger.error({ err, serviceId }, 'Failed to persist circuit breaker state');
    });
  }

  recordFailure(serviceId: string): void {
    const entry = this.getOrCreate(serviceId);
    const now = Date.now();

    entry.failures++;
    entry.lastFailureAt = now;

    if (entry.state === CircuitState.HALF_OPEN) {
      // Probe failed, re-open
      entry.state = CircuitState.OPEN;
      entry.openedAt = now;
      logger.warn({ serviceId, failures: entry.failures }, 'Circuit breaker re-opened after failed probe');
    } else if (entry.failures >= FAILURE_THRESHOLD && entry.state === CircuitState.CLOSED) {
      entry.state = CircuitState.OPEN;
      entry.openedAt = now;
      logger.warn({ serviceId, failures: entry.failures }, 'Circuit breaker opened');
    }

    this.persistState(serviceId, entry).catch((err) => {
      logger.error({ err, serviceId }, 'Failed to persist circuit breaker state');
    });
  }

  isOpen(serviceId: string): boolean {
    const entry = this.circuits.get(serviceId);
    if (!entry) return false;

    if (entry.state === CircuitState.OPEN) {
      // Check if cooldown has elapsed
      if (entry.openedAt && Date.now() - entry.openedAt >= OPEN_DURATION_MS) {
        // Transition to HALF_OPEN, allow one probe
        entry.state = CircuitState.HALF_OPEN;
        logger.info({ serviceId }, 'Circuit breaker transitioning to half-open');
        return false; // allow the probe request through
      }
      return true;
    }

    return false;
  }

  getState(serviceId: string): CircuitState {
    const entry = this.circuits.get(serviceId);
    if (!entry) return CircuitState.CLOSED;

    // Handle time-based transition to HALF_OPEN
    if (entry.state === CircuitState.OPEN && entry.openedAt) {
      if (Date.now() - entry.openedAt >= OPEN_DURATION_MS) {
        entry.state = CircuitState.HALF_OPEN;
      }
    }

    return entry.state;
  }

  getAllStates(): Record<string, { state: CircuitState; failures: number }> {
    const result: Record<string, { state: CircuitState; failures: number }> = {};
    for (const [serviceId, entry] of this.circuits) {
      result[serviceId] = { state: this.getState(serviceId), failures: entry.failures };
    }
    return result;
  }

  private async persistState(serviceId: string, entry: CircuitEntry): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO circuit_breaker_state (service_id, state, failures, opened_at, last_failure_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (service_id)
         DO UPDATE SET state = $2, failures = $3, opened_at = $4, last_failure_at = $5, updated_at = NOW()`,
        [
          serviceId,
          entry.state,
          entry.failures,
          entry.openedAt ? new Date(entry.openedAt) : null,
          entry.lastFailureAt ? new Date(entry.lastFailureAt) : null,
        ],
      );
    } catch (err) {
      // Non-fatal: in-memory state is authoritative, DB is for observability
      logger.debug({ err, serviceId }, 'Circuit breaker DB persist failed (non-fatal)');
    }
  }

  async loadFromDb(): Promise<void> {
    try {
      const result = await pool.query<{
        service_id: string;
        state: string;
        failures: number;
        opened_at: Date | null;
        last_failure_at: Date | null;
      }>('SELECT service_id, state, failures, opened_at, last_failure_at FROM circuit_breaker_state');

      for (const row of result.rows) {
        this.circuits.set(row.service_id, {
          state: row.state as CircuitState,
          failures: row.failures,
          openedAt: row.opened_at ? row.opened_at.getTime() : null,
          lastFailureAt: row.last_failure_at ? row.last_failure_at.getTime() : null,
        });
      }

      logger.info({ count: result.rows.length }, 'Loaded circuit breaker state from DB');
    } catch (err) {
      logger.warn({ err }, 'Failed to load circuit breaker state from DB, starting fresh');
    }
  }
}

export const circuitBreaker = new CircuitBreaker();
