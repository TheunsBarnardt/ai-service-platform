import { logger } from '../utils/logger.js';
import { listServices, type ServiceRow } from '../db/queries/services.js';
import { pool } from '../db/pool.js';

interface DescriptionVariant {
  id: string;
  serviceId: string;
  text: string;
  isActive: boolean;
  discoveryCount: number;
  connectionCount: number;
  createdAt: Date;
}

interface OptimizationResult {
  serviceId: string;
  serviceName: string;
  variantsGenerated: number;
  activeVariant: string | null;
  winner: string | null;
}

/**
 * Generate description variants for a service using the LLM.
 * In production, this calls the LLM provider to produce 2-3 alternatives.
 * For now, logs the intent and returns placeholder variants.
 */
async function generateVariants(service: ServiceRow): Promise<string[]> {
  logger.info(
    { serviceId: service.id, serviceName: service.name },
    'Generating description variants for A/B testing',
  );

  // In production: call getProvider().complete() to generate variants
  // const provider = getProvider();
  // const result = await provider.complete([
  //   { role: 'system', content: 'Generate 3 alternative descriptions for an API service listing.' },
  //   { role: 'user', content: `Service: ${service.name}\nCurrent: ${service.description}` },
  // ]);

  // Stub: return the current description as the only variant
  const current = service.description ?? `${service.name} AI service`;
  return [
    current,
    `${current} - optimized for accuracy`,
    `${current} - fast and reliable`,
  ];
}

/**
 * Track a discovery event: a caller viewed this service listing.
 */
export async function trackDiscovery(serviceId: string, variantId: string): Promise<void> {
  logger.debug({ serviceId, variantId }, 'Tracking listing discovery');

  try {
    await pool.query(
      `UPDATE listing_variants
       SET discovery_count = discovery_count + 1, updated_at = NOW()
       WHERE id = $1 AND service_id = $2`,
      [variantId, serviceId],
    );
  } catch (err) {
    logger.debug({ err, serviceId, variantId }, 'Failed to track discovery (table may not exist yet)');
  }
}

/**
 * Track a connection event: a caller connected/invoked after viewing this variant.
 */
export async function trackConnection(serviceId: string, variantId: string): Promise<void> {
  logger.debug({ serviceId, variantId }, 'Tracking listing connection');

  try {
    await pool.query(
      `UPDATE listing_variants
       SET connection_count = connection_count + 1, updated_at = NOW()
       WHERE id = $1 AND service_id = $2`,
      [variantId, serviceId],
    );
  } catch (err) {
    logger.debug({ err, serviceId, variantId }, 'Failed to track connection (table may not exist yet)');
  }
}

/**
 * Pick the winning variant based on connection rate.
 */
function pickWinner(variants: DescriptionVariant[]): DescriptionVariant | null {
  if (variants.length === 0) return null;

  // Need at least 50 discoveries per variant before picking a winner
  const MIN_DISCOVERIES = 50;
  const eligible = variants.filter((v) => v.discoveryCount >= MIN_DISCOVERIES);

  if (eligible.length < 2) return null;

  // Conversion rate = connections / discoveries
  let best: DescriptionVariant | null = null;
  let bestRate = -1;

  for (const v of eligible) {
    const rate = v.connectionCount / v.discoveryCount;
    if (rate > bestRate) {
      bestRate = rate;
      best = v;
    }
  }

  return best;
}

/**
 * Run the optimization loop for all listed services.
 * Generates variants, tracks metrics, and picks winners.
 */
export async function optimizeListings(): Promise<OptimizationResult[]> {
  const services = await listServices({ isActive: true });
  const results: OptimizationResult[] = [];

  logger.info(
    { serviceCount: services.length },
    'Starting listing optimization pass',
  );

  for (const service of services) {
    if (service.registry_status !== 'listed') continue;

    const result: OptimizationResult = {
      serviceId: service.id,
      serviceName: service.name,
      variantsGenerated: 0,
      activeVariant: null,
      winner: null,
    };

    try {
      // Check for existing variants
      const existingResult = await pool.query<DescriptionVariant>(
        `SELECT * FROM listing_variants WHERE service_id = $1 ORDER BY created_at`,
        [service.id],
      );

      let variants = existingResult.rows;

      // Generate new variants if none exist
      if (variants.length === 0) {
        const texts = await generateVariants(service);
        result.variantsGenerated = texts.length;

        // In production: insert into listing_variants table
        logger.info(
          { serviceId: service.id, variants: texts.length },
          'Generated listing variants (stub: not persisted until table exists)',
        );
      } else {
        // Check for a winner
        const winner = pickWinner(variants);
        if (winner) {
          result.winner = winner.id;
          logger.info(
            {
              serviceId: service.id,
              winnerId: winner.id,
              conversionRate: winner.connectionCount / winner.discoveryCount,
            },
            'Listing variant winner found',
          );
        }

        const active = variants.find((v) => v.isActive);
        result.activeVariant = active?.id ?? null;
      }
    } catch (err) {
      logger.debug(
        { err, serviceId: service.id },
        'Listing optimization skipped (tables may not exist yet)',
      );
    }

    results.push(result);
  }

  logger.info({ resultCount: results.length }, 'Listing optimization pass complete');
  return results;
}
