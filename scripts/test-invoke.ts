/**
 * CLI tool to test service invocation.
 *
 * Usage:
 *   tsx scripts/test-invoke.ts --service general-inference --input '{"prompt":"Hello"}' --api-key sk_...
 *
 * Options:
 *   --service   Service ID (required)
 *   --input     JSON input payload (required)
 *   --api-key   API key for authentication (required)
 *   --base-url  Base URL (default: http://localhost:3000)
 */

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--') && i + 1 < argv.length) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      args[key] = value;
      i++;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  const serviceId = args['service'];
  const inputRaw = args['input'];
  const apiKey = args['api-key'];
  const baseUrl = args['base-url'] ?? 'http://localhost:3000';

  if (!serviceId || !inputRaw || !apiKey) {
    console.error(
      'Usage: tsx scripts/test-invoke.ts --service <id> --input \'<json>\' --api-key <key>',
    );
    console.error('');
    console.error('Options:');
    console.error('  --service   Service ID (required)');
    console.error('  --input     JSON input payload (required)');
    console.error('  --api-key   API key for authentication (required)');
    console.error('  --base-url  Base URL (default: http://localhost:3000)');
    process.exit(1);
  }

  let input: Record<string, unknown>;
  try {
    input = JSON.parse(inputRaw) as Record<string, unknown>;
  } catch {
    console.error('Error: --input must be valid JSON');
    process.exit(1);
  }

  const url = `${baseUrl}/v1/services/${serviceId}/invoke`;

  console.log(`POST ${url}`);
  console.log(`Input: ${JSON.stringify(input, null, 2)}`);
  console.log('');

  const startTime = Date.now();

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ input }),
  });

  const elapsedMs = Date.now() - startTime;
  const body = await response.text();

  console.log(`Status: ${response.status} ${response.statusText}`);
  console.log(`Time: ${elapsedMs}ms`);
  console.log('');

  try {
    const parsed = JSON.parse(body);
    console.log('Response:');
    console.log(JSON.stringify(parsed, null, 2));
  } catch {
    console.log('Response (raw):');
    console.log(body);
  }

  if (!response.ok) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
