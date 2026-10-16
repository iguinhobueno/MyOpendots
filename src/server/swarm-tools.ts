import { defineTool } from '@copilotkit/runtime/v2';
import { z } from 'zod';
import type { WorkspaceStore } from './workspace.js';
import type { SwarmService } from './swarm.js';

export function swarmTools(
  workspace: WorkspaceStore,
  currentDotId: string,
  swarm: SwarmService,
  check: () => void,
  signal: AbortSignal,
) {
  return [
    defineTool({
      name: 'list_available_dots',
      description:
        'List other specialist Dots (agents) available in the workspace for collaboration or delegation. Returns Dot id, name, and role instructions.',
      parameters: z.object({}),
      execute: async () => {
        check();
        const otherDots = workspace
          .dots()
          .filter((d) => d.id !== currentDotId)
          .map((d) => ({
            id: d.id,
            name: d.name,
            instructions: d.instructions.slice(0, 300),
            researchAllowed: d.researchAllowed,
          }));
        return {
          totalAvailable: otherDots.length,
          dots: otherDots,
        };
      },
    }),
    defineTool({
      name: 'delegate_to_dot',
      description:
        'Delegate a specialized subtask or inquiry to another Dot in the workspace (e.g. CineDot for audiovisual strategy/hooks, DevDot for software architecture/code). Returns the specialist Dot output.',
      parameters: z.object({
        target: z
          .string()
          .min(1)
          .describe('The target Dot name (e.g. "CineDot", "DevDot") or Dot ID.'),
        task: z
          .string()
          .min(1)
          .max(4000)
          .describe('Detailed instructions for the specialist Dot to execute.'),
        context: z
          .string()
          .max(4000)
          .optional()
          .describe('Optional background information or source material for the task.'),
      }),
      execute: async ({ target, task, context }) => {
        check();
        signal.throwIfAborted();
        try {
          const result = await swarm.delegate(
            currentDotId,
            target,
            task,
            context,
            signal,
          );
          return {
            targetDot: result.toDotName,
            status: result.status,
            result: result.result,
            durationMs: result.durationMs,
          };
        } catch (error) {
          return {
            targetDot: target,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    }),
    defineTool({
      name: 'broadcast_to_swarm',
      description:
        'Delegate subtasks in parallel to multiple specialist Dots simultaneously and gather their combined outputs.',
      parameters: z.object({
        delegations: z
          .array(
            z.object({
              target: z.string().describe('Target Dot name or ID.'),
              task: z.string().describe('Instructions for this specialist.'),
              context: z.string().optional().describe('Optional context.'),
            }),
          )
          .min(1)
          .max(3)
          .describe('Up to 3 delegations to execute in parallel.'),
      }),
      execute: async ({ delegations }) => {
        check();
        signal.throwIfAborted();
        const results = await swarm.broadcast(currentDotId, delegations, signal);
        return {
          delegations: results.map((r) => ({
            targetDot: r.toDotName,
            status: r.status,
            result: r.result,
            error: r.error,
          })),
        };
      },
    }),
  ];
}
