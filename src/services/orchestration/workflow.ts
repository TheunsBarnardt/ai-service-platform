import { BaseService, type ServiceRecord } from '../base-service.js';
import { routeServiceCall } from '../router.js';
import { getServiceById } from '../../db/queries/services.js';
import { logger } from '../../utils/logger.js';

interface WorkflowStep {
  service_id: string;
  input: Record<string, unknown>;
}

export class WorkflowService extends BaseService {
  async execute(
    _service: ServiceRecord,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const steps = input.steps as WorkflowStep[];
    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      throw new Error('Missing required field: steps (non-empty array)');
    }

    const results: Record<string, unknown>[] = [];
    let totalLatencyMs = 0;
    let previousOutput: Record<string, unknown> | null = null;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      // Look up the step's service
      const svc = await getServiceById(step.service_id);

      if (!svc) {
        throw new Error(`Workflow step ${i}: service ${step.service_id} not found`);
      }

      // Merge previous output as context into step input
      const stepInput = { ...step.input };
      if (previousOutput) {
        stepInput.context = JSON.stringify(previousOutput);
      }

      logger.debug(
        { step: i, serviceId: step.service_id, serviceType: svc.service_type },
        'Executing workflow step',
      );

      const stepResult = await routeServiceCall(svc, stepInput, 'workflow-internal');

      results.push(stepResult.result as Record<string, unknown>);
      totalLatencyMs += stepResult.latencyMs;
      previousOutput = stepResult.result as Record<string, unknown>;
    }

    return {
      results,
      total_latency_ms: totalLatencyMs,
      steps_completed: results.length,
    };
  }
}
