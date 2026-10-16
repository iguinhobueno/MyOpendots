import { describe, expect, it, vi, beforeEach } from 'vitest';
import { swarmTools } from '../src/server/swarm-tools.js';
import { SwarmService } from '../src/server/swarm.js';
import { WorkspaceStore } from '../src/server/workspace.js';

describe('swarmTools (Agent Tools for Multi-Agent Orchestration)', () => {
  let workspace: WorkspaceStore;
  let swarm: SwarmService;
  let check: () => void;
  let controller: AbortController;

  beforeEach(() => {
    workspace = new WorkspaceStore(':memory:', 'owner-test');
    check = vi.fn();
    controller = new AbortController();

    const mockExecutor = vi.fn(async (_threadId, prompt) => `Resultado: ${prompt.slice(0, 30)}`);
    swarm = new SwarmService(workspace, mockExecutor as any);
    swarm.seedSpecialists();
  });

  it('exposes list_available_dots, delegate_to_dot, and broadcast_to_swarm tools', () => {
    const dots = workspace.dots();
    const tools = swarmTools(workspace, dots[0].id, swarm, check, controller.signal);

    const names = tools.map((t) => t.name);
    expect(names).toEqual(['list_available_dots', 'delegate_to_dot', 'broadcast_to_swarm']);
  });

  it('list_available_dots excludes the calling Dot from the roster', async () => {
    const dots = workspace.dots();
    const caller = dots[0];
    const tools = swarmTools(workspace, caller.id, swarm, check, controller.signal);
    const listTool = tools.find((t) => t.name === 'list_available_dots')!;

    const result = (await (listTool as any).execute?.({})) as any;

    expect(check).toHaveBeenCalled();
    expect(result.totalAvailable).toBe(dots.length - 1);
    expect(result.dots.every((d: any) => d.id !== caller.id)).toBe(true);
  });

  it('delegate_to_dot executes delegation and returns formatted output', async () => {
    const dots = workspace.dots();
    const caller = dots[0];
    const tools = swarmTools(workspace, caller.id, swarm, check, controller.signal);
    const delegateTool = tools.find((t) => t.name === 'delegate_to_dot')!;

    const result = (await (delegateTool as any).execute?.({
      target: 'CineDot',
      task: 'Roteiro de 30 segundos com gancho fatal.',
      context: 'Nicho: Inteligência Artificial.',
    })) as any;

    expect(check).toHaveBeenCalled();
    expect(result.targetDot).toBe('CineDot');
    expect(result.status).toBe('completed');
    expect(result.result).toContain('Resultado:');
  });

  it('delegate_to_dot catches failure and returns error object gracefully', async () => {
    const dots = workspace.dots();
    const caller = dots[0];
    const tools = swarmTools(workspace, caller.id, swarm, check, controller.signal);
    const delegateTool = tools.find((t) => t.name === 'delegate_to_dot')!;

    const result = (await (delegateTool as any).execute?.({
      target: 'InexistenteDot',
      task: 'Executar tarefa.',
    })) as any;

    expect(result.status).toBe('failed');
    expect(result.error).toContain('não encontrado');
  });

  it('broadcast_to_swarm executes multi-dot requests', async () => {
    const dots = workspace.dots();
    const caller = dots[0];
    const tools = swarmTools(workspace, caller.id, swarm, check, controller.signal);
    const broadcastTool = tools.find((t) => t.name === 'broadcast_to_swarm')!;

    const result = (await (broadcastTool as any).execute?.({
      delegations: [
        { target: 'CineDot', task: 'Sugira 3 ganchos.' },
        { target: 'DevDot', task: 'Sugira arquitetura.' },
      ],
    })) as any;

    expect(result.delegations).toHaveLength(2);
    expect(result.delegations[0].targetDot).toBe('CineDot');
    expect(result.delegations[0].status).toBe('completed');
    expect(result.delegations[1].targetDot).toBe('DevDot');
    expect(result.delegations[1].status).toBe('completed');
  });
});
