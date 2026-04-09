import { logger } from '../utils/logger.js';
import { listServices, type ServiceRow } from '../db/queries/services.js';

interface RegistryEndpoint {
  name: string;
  url: string;
}

// In production, these would be configured via environment or DB
const REGISTRY_ENDPOINTS: RegistryEndpoint[] = [
  // { name: 'mcp-registry', url: 'https://registry.example.com/api/v1/services' },
  // { name: 'rapidapi', url: 'https://rapidapi.com/api/v1/listings' },
];

export async function publishToRegistries(service: ServiceRow): Promise<void> {
  logger.info(
    {
      serviceId: service.id,
      serviceName: service.name,
      serviceType: service.service_type,
      registryCount: REGISTRY_ENDPOINTS.length,
    },
    'Publishing service to registries',
  );

  if (REGISTRY_ENDPOINTS.length === 0) {
    logger.info(
      { serviceId: service.id },
      'No registry endpoints configured. Skipping external publish. '
        + 'In production, this would POST to MCP registry APIs and API directories.',
    );
    return;
  }

  const results = await Promise.allSettled(
    REGISTRY_ENDPOINTS.map(async (endpoint) => {
      logger.info(
        { serviceId: service.id, registry: endpoint.name },
        'Publishing to registry',
      );

      // In production: POST service listing to the registry API
      // const response = await fetch(endpoint.url, {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({
      //     name: service.name,
      //     description: service.description,
      //     type: service.service_type,
      //     input_schema: service.input_schema,
      //     output_schema: service.output_schema,
      //     price_cents: service.price_cents,
      //     quality_score: service.quality_score,
      //   }),
      // });

      return { registry: endpoint.name, status: 'published' as const };
    }),
  );

  for (const result of results) {
    if (result.status === 'rejected') {
      logger.error({ err: result.reason }, 'Failed to publish to registry');
    }
  }
}

export async function updateAllListings(): Promise<void> {
  const services = await listServices({ isActive: true });

  logger.info(
    { serviceCount: services.length },
    'Refreshing all service registry listings',
  );

  for (const service of services) {
    if (service.registry_status === 'listed') {
      await publishToRegistries(service);
    }
  }

  logger.info('All registry listings refreshed');
}

export async function removeFromRegistries(serviceId: string): Promise<void> {
  logger.info(
    { serviceId, registryCount: REGISTRY_ENDPOINTS.length },
    'Removing service from registries',
  );

  if (REGISTRY_ENDPOINTS.length === 0) {
    logger.info(
      { serviceId },
      'No registry endpoints configured. Skipping removal. '
        + 'In production, this would send DELETE requests to each registry.',
    );
    return;
  }

  const results = await Promise.allSettled(
    REGISTRY_ENDPOINTS.map(async (endpoint) => {
      logger.info(
        { serviceId, registry: endpoint.name },
        'Removing from registry',
      );

      // In production: DELETE service listing from the registry API
      // await fetch(`${endpoint.url}/${serviceId}`, { method: 'DELETE' });

      return { registry: endpoint.name, status: 'removed' as const };
    }),
  );

  for (const result of results) {
    if (result.status === 'rejected') {
      logger.error({ err: result.reason }, 'Failed to remove from registry');
    }
  }
}
