import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SwarmService, type SwarmTurnExecutor } from '../src/server/swarm.js';
import { WorkspaceStore } from '../src/server/workspace.js';

describe('SwarmService (Multi-Agent Swarm & Dot-to-Dot Delegation)', () => {
  let workspace: WorkspaceStore;
  let swarm: SwarmService;
  let mockExecutor: SwarmTurnExecutor;

  beforeEach(() => {
    workspace = new WorkspaceStore(':memory:', 'owner-test');
    mockExecutor = vi.fn(async (_threadId, prompt) => {
      return `[Resposta Especialista] Análise concluída para: "${prompt.slice(0, 50)}..."`;
    }) as unknown as SwarmTurnExecutor;
    swarm = new SwarmService(workspace, mockExecutor);
  });

  it('seeds CineDot and DevDot specialists into workspace', () => {
    const { cineDot, devDot } = swarm.seedSpecialists();

    expect(cineDot).toBeDefined();
    expect(cineDot?.name).toBe('CineDot');
    expect(cineDot?.instructions).toContain('Regra dos 3 Segundos');

    expect(devDot).toBeDefined();
    expect(devDot?.name).toBe('DevDot');
    expect(devDot?.instructions).toContain('Pronto de Primeira');

    // Calling seed again should return existing dots without duplication
    const secondCall = swarm.seedSpecialists();
    expect(secondCall.cineDot?.id).toBe(cineDot?.id);
    expect(secondCall.devDot?.id).toBe(devDot?.id);
  });

  it('lists the complete swarm roster', () => {
    swarm.seedSpecialists();
    const roster = swarm.getRoster();

    expect(roster.length).toBeGreaterThanOrEqual(2);
    const names = roster.map((r) => r.name);
    expect(names).toContain('CineDot');
    expect(names).toContain('DevDot');
  });

  it('delegates a task to another Dot and records execution', async () => {
    const { cineDot } = swarm.seedSpecialists();
    const dots = workspace.dots();
    const primaryDot = dots.find((d) => d.name === 'Dot') ?? dots[0];

    const result = await swarm.delegate(
      primaryDot.id,
      'CineDot',
      'Crie um gancho de 3 segundos para um vídeo sobre alta disponibilidade.',
      'O público é composto por desenvolvedores de software sênior.',
    );

    expect(result.status).toBe('completed');
    expect(result.toDotName).toBe('CineDot');
    expect(result.toDotId).toBe(cineDot?.id);
    expect(result.result).toContain('[Resposta Especialista]');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    expect(mockExecutor).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('Crie um gancho de 3 segundos'),
      expect.any(AbortSignal),
      expect.objectContaining({
        opendotsSource: 'swarm_delegation',
        fromDotId: primaryDot.id,
        depth: 1,
      }),
    );

    // Verify persistence in SQLite
    const history = workspace.swarmDelegations();
    expect(history.length).toBe(1);
    expect(history[0].fromDotName).toBe(primaryDot.name);
    expect(history[0].toDotName).toBe('CineDot');
    expect(history[0].status).toBe('completed');
  });

  it('blocks self-delegation attempts', async () => {
    const { devDot } = swarm.seedSpecialists();
    if (!devDot) throw new Error('DevDot not found');

    await expect(
      swarm.delegate(devDot.id, devDot.id, 'Refatore este código.'),
    ).rejects.toThrow('Auto-delegação proibida');
  });

  it('rejects delegation to nonexistent target Dot', async () => {
    const dots = workspace.dots();
    await expect(
      swarm.delegate(dots[0].id, 'FantasmaDot', 'Faça algo.'),
    ).rejects.toThrow("Dot de destino não encontrado no workspace: 'FantasmaDot'.");
  });

  it('enforces maximum recursion depth (depth >= 3)', async () => {
    const { cineDot, devDot } = swarm.seedSpecialists();
    if (!cineDot || !devDot) throw new Error('Dots not found');

    await expect(
      swarm.delegate(
        cineDot.id,
        devDot.id,
        'Loop infinito de delegação',
        undefined,
        undefined,
        3, // Depth limit reached
      ),
    ).rejects.toThrow('Limite máximo de profundidade de delegação do Swarm atingido');
  });

  it('broadcasts parallel subtasks to multiple Dots', async () => {
    swarm.seedSpecialists();
    const dots = workspace.dots();
    const primaryDot = dots[0];

    const results = await swarm.broadcast(primaryDot.id, [
      { target: 'CineDot', task: 'Crie um gancho fatal.' },
      { target: 'DevDot', task: 'Revise o código TypeScript.' },
    ]);

    expect(results.length).toBe(2);
    expect(results[0].status).toBe('completed');
    expect(results[0].toDotName).toBe('CineDot');
    expect(results[1].status).toBe('completed');
    expect(results[1].toDotName).toBe('DevDot');

    const history = workspace.swarmDelegations();
    expect(history.length).toBe(2);
  });
});
