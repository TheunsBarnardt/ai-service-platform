import { pool } from '../pool.js';
import { generateId } from '../../utils/crypto.js';

export interface ServiceRow {
  id: string;
  name: string;
  service_type: string;
  description: string | null;
  input_schema: Record<string, unknown> | null;
  output_schema: Record<string, unknown> | null;
  system_prompt: string | null;
  config: Record<string, unknown>;
  price_cents: number | null;
  cost_cents: number | null;
  quality_score: number;
  latency_sla_ms: number;
  registry_status: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ServiceFilters {
  type?: string;
  minQuality?: number;
  isActive?: boolean;
}

export async function listServices(filters?: ServiceFilters): Promise<ServiceRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (filters?.type) {
    conditions.push(`service_type = $${paramIdx++}`);
    params.push(filters.type);
  }

  if (filters?.minQuality !== undefined) {
    conditions.push(`quality_score >= $${paramIdx++}`);
    params.push(filters.minQuality);
  }

  if (filters?.isActive !== undefined) {
    conditions.push(`is_active = $${paramIdx++}`);
    params.push(filters.isActive);
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const result = await pool.query<ServiceRow>(
    `SELECT * FROM services ${whereClause} ORDER BY quality_score DESC, name ASC`,
    params,
  );

  return result.rows;
}

export async function getServiceById(id: string): Promise<ServiceRow | null> {
  const result = await pool.query<ServiceRow>(
    `SELECT * FROM services WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function getServiceByName(name: string): Promise<ServiceRow | null> {
  const result = await pool.query<ServiceRow>(
    `SELECT * FROM services WHERE name = $1`,
    [name],
  );
  return result.rows[0] ?? null;
}

export async function createService(data: {
  name: string;
  serviceType: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  systemPrompt?: string;
  config?: Record<string, unknown>;
  priceCents?: number;
  costCents?: number;
  qualityScore?: number;
  latencySlsMs?: number;
  registryStatus?: string;
}): Promise<ServiceRow> {
  const id = generateId();
  const result = await pool.query<ServiceRow>(
    `INSERT INTO services (
       id, name, service_type, description, input_schema, output_schema,
       system_prompt, config, price_cents, cost_cents, quality_score,
       latency_sla_ms, registry_status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      id,
      data.name,
      data.serviceType,
      data.description ?? null,
      data.inputSchema ? JSON.stringify(data.inputSchema) : null,
      data.outputSchema ? JSON.stringify(data.outputSchema) : null,
      data.systemPrompt ?? null,
      JSON.stringify(data.config ?? {}),
      data.priceCents ?? null,
      data.costCents ?? null,
      data.qualityScore ?? 50,
      data.latencySlsMs ?? 5000,
      data.registryStatus ?? 'listed',
    ],
  );
  return result.rows[0];
}

export async function updateServiceQualityScore(id: string, score: number): Promise<void> {
  await pool.query(
    `UPDATE services SET quality_score = $2, updated_at = now() WHERE id = $1`,
    [id, score],
  );
}

export async function updateServiceRegistryStatus(id: string, status: string): Promise<void> {
  await pool.query(
    `UPDATE services SET registry_status = $2, updated_at = now() WHERE id = $1`,
    [id, status],
  );
}
