import Ajv, { type JSONSchemaType } from 'ajv';
import type { ServiceRow } from '../db/queries/services.js';

const ajv = new Ajv.default({ allErrors: true });

/** Re-export ServiceRow as ServiceRecord for convenience within services. */
export type ServiceRecord = ServiceRow;

export abstract class BaseService {
  abstract execute(
    service: ServiceRecord,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;

  protected validateInput<T>(
    input: unknown,
    schema: JSONSchemaType<T> | Record<string, unknown>,
  ): T {
    const validate = ajv.compile(schema);
    if (!validate(input)) {
      const messages = (validate.errors ?? [])
        .map((e: { instancePath?: string; message?: string }) => `${e.instancePath || '/'} ${e.message}`)
        .join('; ');
      throw new Error(`Input validation failed: ${messages}`);
    }
    return input as T;
  }
}
