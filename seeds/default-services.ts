import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  host: process.env['DB_HOST'] ?? 'localhost',
  port: parseInt(process.env['DB_PORT'] ?? '5432', 10),
  user: process.env['DB_USER'] ?? 'postgres',
  password: process.env['DB_PASSWORD'] ?? '',
  database: process.env['DB_NAME'] ?? 'ai_service_platform',
});

interface ServiceSeed {
  name: string;
  service_type: string;
  description: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  price_cents: number;
  quality_score: number;
  latency_sla_ms: number;
  registry_status: string;
}

const defaultServices: ServiceSeed[] = [
  {
    name: 'general-inference',
    service_type: 'inference',
    description: 'General-purpose LLM inference with a balanced model. Suitable for chat, summarisation, classification, and other standard text tasks.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The user prompt to send to the model' },
        system_prompt: { type: 'string', description: 'Optional system prompt for context' },
        max_tokens: { type: 'integer', default: 1024, description: 'Maximum tokens in the response' },
        temperature: { type: 'number', minimum: 0, maximum: 2, default: 0.7 },
      },
      required: ['prompt'],
    },
    output_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Generated text response' },
        usage: {
          type: 'object',
          properties: {
            input_tokens: { type: 'integer' },
            output_tokens: { type: 'integer' },
          },
        },
        model: { type: 'string', description: 'Model identifier used' },
        finish_reason: { type: 'string', enum: ['stop', 'max_tokens', 'error'] },
      },
      required: ['text', 'usage', 'model', 'finish_reason'],
    },
    price_cents: 10,
    quality_score: 70,
    latency_sla_ms: 5000,
    registry_status: 'listed',
  },
  {
    name: 'code-review',
    service_type: 'eval_scoring',
    description: 'Automated code quality evaluation. Analyses code for bugs, style issues, security vulnerabilities, and provides a quality score with actionable feedback.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Source code to review' },
        language: { type: 'string', description: 'Programming language (e.g., typescript, python, go)' },
        context: { type: 'string', description: 'Optional context about the code purpose' },
        severity_threshold: { type: 'string', enum: ['info', 'warning', 'error', 'critical'], default: 'warning' },
      },
      required: ['code', 'language'],
    },
    output_schema: {
      type: 'object',
      properties: {
        score: { type: 'integer', minimum: 0, maximum: 100, description: 'Overall code quality score' },
        issues: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              line: { type: 'integer' },
              severity: { type: 'string', enum: ['info', 'warning', 'error', 'critical'] },
              message: { type: 'string' },
              suggestion: { type: 'string' },
            },
          },
        },
        summary: { type: 'string', description: 'Human-readable summary of the review' },
      },
      required: ['score', 'issues', 'summary'],
    },
    price_cents: 15,
    quality_score: 75,
    latency_sla_ms: 8000,
    registry_status: 'listed',
  },
  {
    name: 'document-qa',
    service_type: 'rag_retrieval',
    description: 'Document-grounded question answering. Upload or reference documents, then ask questions answered with citations from the source material.',
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to answer' },
        documents: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              content: { type: 'string' },
              metadata: { type: 'object' },
            },
            required: ['id', 'content'],
          },
          description: 'Documents to search for answers',
        },
        top_k: { type: 'integer', default: 5, description: 'Number of chunks to retrieve' },
      },
      required: ['question', 'documents'],
    },
    output_schema: {
      type: 'object',
      properties: {
        answer: { type: 'string', description: 'The generated answer' },
        citations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              document_id: { type: 'string' },
              excerpt: { type: 'string' },
              relevance_score: { type: 'number' },
            },
          },
        },
        confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Answer confidence score' },
      },
      required: ['answer', 'citations', 'confidence'],
    },
    price_cents: 8,
    quality_score: 68,
    latency_sla_ms: 6000,
    registry_status: 'listed',
  },
  {
    name: 'data-transform',
    service_type: 'tool_execution',
    description: 'Structured data transformation service. Converts between JSON, CSV, and other formats with schema mapping, filtering, and aggregation support.',
    input_schema: {
      type: 'object',
      properties: {
        data: { description: 'Input data (JSON object, array, or CSV string)' },
        input_format: { type: 'string', enum: ['json', 'csv', 'tsv'], default: 'json' },
        output_format: { type: 'string', enum: ['json', 'csv', 'tsv'], default: 'json' },
        transform: {
          type: 'object',
          properties: {
            select: { type: 'array', items: { type: 'string' }, description: 'Fields to include' },
            rename: { type: 'object', description: 'Field rename mapping (old -> new)' },
            filter: { type: 'string', description: 'Filter expression (e.g., "age > 18")' },
          },
        },
      },
      required: ['data'],
    },
    output_schema: {
      type: 'object',
      properties: {
        data: { description: 'Transformed output data' },
        format: { type: 'string' },
        row_count: { type: 'integer', description: 'Number of rows in output' },
        columns: { type: 'array', items: { type: 'string' }, description: 'Column names in output' },
      },
      required: ['data', 'format', 'row_count'],
    },
    price_cents: 5,
    quality_score: 80,
    latency_sla_ms: 3000,
    registry_status: 'listed',
  },
  {
    name: 'multi-step-research',
    service_type: 'orchestration',
    description: 'Multi-step web research agent. Given a research question, plans a search strategy, gathers information from multiple sources, synthesises findings, and produces a structured report.',
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The research question or topic' },
        depth: { type: 'string', enum: ['shallow', 'moderate', 'deep'], default: 'moderate', description: 'Research depth level' },
        max_sources: { type: 'integer', default: 10, description: 'Maximum number of sources to consult' },
        output_style: { type: 'string', enum: ['summary', 'report', 'bullet_points'], default: 'report' },
      },
      required: ['question'],
    },
    output_schema: {
      type: 'object',
      properties: {
        report: { type: 'string', description: 'The research report or summary' },
        sources: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              url: { type: 'string' },
              relevance: { type: 'number' },
            },
          },
        },
        steps_taken: { type: 'integer', description: 'Number of research steps executed' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['report', 'sources', 'steps_taken', 'confidence'],
    },
    price_cents: 25,
    quality_score: 65,
    latency_sla_ms: 30000,
    registry_status: 'listed',
  },
];

async function seed() {
  console.log('Seeding default services...');

  for (const service of defaultServices) {
    const result = await pool.query(
      `INSERT INTO services (name, service_type, description, input_schema, output_schema, price_cents, quality_score, latency_sla_ms, registry_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (name) DO UPDATE SET
         service_type = EXCLUDED.service_type,
         description = EXCLUDED.description,
         input_schema = EXCLUDED.input_schema,
         output_schema = EXCLUDED.output_schema,
         price_cents = EXCLUDED.price_cents,
         quality_score = EXCLUDED.quality_score,
         latency_sla_ms = EXCLUDED.latency_sla_ms,
         registry_status = EXCLUDED.registry_status,
         updated_at = now()
       RETURNING id, name`,
      [
        service.name,
        service.service_type,
        service.description,
        JSON.stringify(service.input_schema),
        JSON.stringify(service.output_schema),
        service.price_cents,
        service.quality_score,
        service.latency_sla_ms,
        service.registry_status,
      ],
    );

    const row = result.rows[0] as { id: string; name: string };
    console.log(`  [OK] ${row.name} (${row.id})`);
  }

  console.log(`Seeded ${defaultServices.length} services.`);
}

seed()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => {
    void pool.end();
  });
