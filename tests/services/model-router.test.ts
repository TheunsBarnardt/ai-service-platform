import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectModel } from '../../src/services/inference/model-router.js';

describe('selectModel', () => {
  it('selects cheap model for short simple input', () => {
    const model = selectModel('Hello, how are you?');
    assert.ok(
      model.includes('haiku') || model.includes('mini'),
      `Expected cheap model, got ${model}`,
    );
  });

  it('selects powerful model for long complex input with code', () => {
    const codeInput = `
      Please review this code:
      \`\`\`
      export async function processData(items: string[]): Promise<void> {
        const results = await Promise.all(items.map(async (item) => {
          return await fetch(\`/api/process/\${item}\`);
        }));
        return results;
      }
      \`\`\`
      ${'Can you explain the architecture of this distributed system? '.repeat(20)}
    `;
    const model = selectModel(codeInput);
    assert.ok(
      model.includes('sonnet') || model.includes('gpt-4o'),
      `Expected powerful model, got ${model}`,
    );
    // Ensure it is NOT the mini variant
    assert.ok(
      !model.includes('mini'),
      `Expected non-mini model, got ${model}`,
    );
  });

  it('selects powerful model for input with technical terms', () => {
    const techInput = 'Explain the distributed microservice architecture and kubernetes deployment pipeline';
    const model = selectModel(techInput);
    assert.ok(
      model.includes('sonnet') || model.includes('gpt-4o'),
      `Expected powerful model for technical input, got ${model}`,
    );
    assert.ok(
      !model.includes('mini'),
      `Expected non-mini model, got ${model}`,
    );
  });
});
