import type { ServiceRecord } from './base-service.js';
import { CompletionService } from './inference/completion.js';
import { RetrievalService } from './rag/retrieval.js';
import { ToolExecutorService } from './tools/executor.js';
import { WorkflowService } from './orchestration/workflow.js';
import { ScorerService } from './eval/scorer.js';
import { calculateCostCents } from '../providers/cost-tracker.js';
import { logger } from '../utils/logger.js';

export interface ServiceCallResult {
  result: Record<string, unknown>;
  tokensInput: number;
  tokensOutput: number;
  model: string;
  latencyMs: number;
  costCents: number;
}

const completionService = new CompletionService();
const retrievalService = new RetrievalService();
const toolExecutorService = new ToolExecutorService();
const workflowService = new WorkflowService();
const scorerService = new ScorerService();

export async function routeServiceCall(
  service: ServiceRecord,
  input: Record<string, unknown>,
  callerId: string,
): Promise<ServiceCallResult> {
  logger.info(
    { serviceId: service.id, serviceType: service.service_type, callerId },
    'Routing service call',
  );

  const start = Date.now();
  let output: Record<string, unknown>;

  switch (service.service_type) {
    case 'inference':
    case 'completion':
      output = await completionService.execute(service, input);
      break;

    case 'rag':
    case 'retrieval':
      output = await retrievalService.execute(service, input);
      break;

    case 'tools':
    case 'executor':
      output = await toolExecutorService.execute(service, input);
      break;

    case 'orchestration':
    case 'workflow':
      output = await workflowService.execute(service, input);
      break;

    case 'eval':
    case 'scorer':
      output = await scorerService.execute(service, input);
      break;

    default:
      throw new Error(`Unsupported service type: ${service.service_type}`);
  }

  const latencyMs = (output.latencyMs as number) ?? (Date.now() - start);
  const tokensInput = (output.tokensInput as number) ?? 0;
  const tokensOutput = (output.tokensOutput as number) ?? 0;
  const model = (output.model as string) ?? 'unknown';

  const costCents = calculateCostCents(model, tokensInput, tokensOutput);

  return {
    result: output,
    tokensInput,
    tokensOutput,
    model,
    latencyMs,
    costCents,
  };
}
