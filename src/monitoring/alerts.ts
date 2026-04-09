import { logger } from '../utils/logger.js';

type AlertLevel = 'info' | 'warning' | 'critical';

interface AlertPayload {
  level: AlertLevel;
  title: string;
  details: Record<string, unknown>;
  timestamp: string;
}

const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL ?? '';

export async function sendAlert(
  level: AlertLevel,
  title: string,
  details: Record<string, unknown>,
): Promise<void> {
  const payload: AlertPayload = {
    level,
    title,
    details,
    timestamp: new Date().toISOString(),
  };

  // Always log locally at the appropriate level
  switch (level) {
    case 'info':
      logger.info({ alert: payload }, `Alert: ${title}`);
      break;
    case 'warning':
      logger.warn({ alert: payload }, `Alert: ${title}`);
      break;
    case 'critical':
      logger.error({ alert: payload }, `Alert: ${title}`);
      break;
  }

  // If a webhook URL is configured, POST the alert
  if (ALERT_WEBHOOK_URL) {
    try {
      const response = await fetch(ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5_000),
      });

      if (!response.ok) {
        logger.warn(
          { status: response.status, url: ALERT_WEBHOOK_URL },
          'Alert webhook returned non-OK status',
        );
      }
    } catch (err) {
      logger.error({ err, url: ALERT_WEBHOOK_URL }, 'Failed to send alert to webhook');
    }
  }
}

export async function alertCircuitBreaker(serviceId: string): Promise<void> {
  await sendAlert('critical', 'Circuit breaker opened', {
    service_id: serviceId,
    action: 'Circuit breaker has opened due to consecutive failures. Requests are being rejected.',
  });
}

export async function alertProviderFailover(from: string, to: string): Promise<void> {
  await sendAlert('warning', 'Provider failover triggered', {
    from_provider: from,
    to_provider: to,
    action: 'Traffic has been rerouted to the secondary provider.',
  });
}

export async function alertLowFunds(fundId: string, balance: number): Promise<void> {
  await sendAlert('warning', 'Low fund balance', {
    fund_id: fundId,
    balance_cents: balance,
    action: 'Fund balance has dropped below the configured threshold.',
  });
}
