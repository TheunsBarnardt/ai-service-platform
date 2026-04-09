import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateOpenApiSpec } from '../src/registry/openapi-generator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(__dirname, '..', 'openapi.json');

async function main(): Promise<void> {
  console.log('Generating OpenAPI spec...');

  const spec = await generateOpenApiSpec();
  const json = JSON.stringify(spec, null, 2);

  fs.writeFileSync(OUTPUT_PATH, json + '\n', 'utf-8');
  console.log(`OpenAPI spec written to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('Failed to generate OpenAPI spec:', err);
  process.exit(1);
});
