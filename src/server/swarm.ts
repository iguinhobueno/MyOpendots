import { randomUUID } from 'node:crypto';
import type { WorkspaceStore } from './workspace.js';
import type { Dot } from '../shared/types.js';

export type SwarmTurnExecutor = (
  threadId: string,
  prompt: string,
  signal: AbortSignal,
  metadata?: Record<string, unknown>,
) => Promise<string>;

export interface SwarmDelegationResult {
  id: string;
  fromDotId: string;
  fromDotName: string;
  toDotId: string;
  toDotName: string;
  task: string;
  status: 'completed' | 'failed';
  result?: string;
  error?: string;
  durationMs: number;
}

export class SwarmService {
  constructor(
    private readonly workspace: WorkspaceStore,
    private turnExecutor?: SwarmTurnExecutor,
  ) {}

  setTurnExecutor(executor: SwarmTurnExecutor): void {
    this.turnExecutor = executor;
  }

  getRoster(): Array<{
    id: string;
    name: string;
    spaceId: string;
    instructions: string;
    researchAllowed: boolean;
  }> {
    return this.workspace.dots().map((d) => ({
      id: d.id,
      name: d.name,
      spaceId: d.spaceId,
      instructions: d.instructions,
      researchAllowed: d.researchAllowed,
    }));
  }

  getHistory(limit = 20) {
    return this.workspace.swarmDelegations(limit);
  }

  seedSpecialists(): { cineDot?: Dot; devDot?: Dot } {
    const spaces = this.workspace.spaces();
    if (!spaces.length) return {};
    const spaceId = spaces[0].id;
    const dots = this.workspace.dots();

    let cineDot = dots.find((d) => d.name.toLowerCase() === 'cinedot');
    if (!cineDot) {
      cineDot = this.workspace.createDot(
        spaceId,
        'CineDot',
        'Você é o CineDot, Estrategista Audiovisual Sênior (YouTube Shorts & TikTok) e Editor de Vídeo com mais de 12 anos de experiência. Foco absoluto em retenção máxima e engajamento orgânico. Princípios inegociáveis: 1) A Regra dos 3 Segundos (Gancho Fatal que prende no primeiro frame); 2) Rítmica e Pacing Dinâmico (trocas de elementos a cada 3 a 5s); 3) Legendas Cinéticas (blocos de 1-3 palavras com destaque cromático); 4) Títulos irresistíveis de alto CTR com gatilhos de confronto e curiosidade sem clickbait falso. Seja direto, técnico e produza roteiros/análises prontos para gravação e edição.',
        true,
        true,
      );
    }

    let devDot = dots.find((d) => d.name.toLowerCase() === 'devdot');
    if (!devDot) {
      devDot = this.workspace.createDot(
        spaceId,
        'DevDot',
        'Você é o DevDot, Engenheiro de Software Sênior & Especialista em Arquitetura Resiliente e Alta Performance. Princípio do Pronto de Primeira: nunca use TODOs ou código incompleto. Filosofia /ponytail: prefira a biblioteca padrão nativa, soluções minimalistas e zero dependências supérfluas. Produza código seguro, tipado e com validações robustas.',
        true,
        true,
      );
    }

    return { cineDot, devDot };
  }

  async delegate(
    fromDotId: string,
    target: string,
    task: string,
    context?: string,
    signal?: AbortSignal,
    depth = 0,
  ): Promise<SwarmDelegationResult> {
    if (!this.turnExecutor) {
      throw new Error('Executor de turnos do Swarm não configurado na plataforma.');
    }

    if (depth >= 3) {
      throw new Error('Limite máximo de profundidade de delegação do Swarm atingido (máximo 3 níveis).');
    }

    const fromDot = this.workspace.dot(fromDotId) ?? {
      id: fromDotId,
      name: 'Dot Principal',
    };

    const targetDot =
      this.workspace.dot(target) ?? this.workspace.findDotByName(target);
    if (!targetDot) {
      throw new Error(`Dot de destino não encontrado no workspace: '${target}'.`);
    }

    if (targetDot.id === fromDot.id) {
      throw new Error('Auto-delegação proibida: um Dot não pode delegar para si mesmo.');
    }

    const start = performance.now();
    const delegationId = randomUUID();

    const prompt = [
      `[SWARM DELEGATION: ${fromDot.name} ➔ ${targetDot.name}]`,
      `Você foi acionado como especialista pelo agente '${fromDot.name}'.`,
      `--- TAREFA ESPECÍFICA ---`,
      task.trim(),
      context ? `\n--- CONTEXTO ADICIONAL FORNECIDO ---\n${context.trim()}` : '',
      `\nDiretriz: Seja direto, altamente focado e retorne a resposta técnica final sem introduções ou saudações burocráticas.`,
    ]
      .filter(Boolean)
      .join('\n');

    const subThread = this.workspace.bindThread(
      randomUUID(),
      targetDot.id,
      `[Swarm] ${fromDot.name} ➔ ${targetDot.name}`,
    );

    const controller = new AbortController();
    const abortListener = () => controller.abort(signal?.reason);
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener('abort', abortListener, { once: true });
    }
    const timeout = setTimeout(() => controller.abort(new Error('Swarm delegation timeout')), 60_000);

    let status: 'completed' | 'failed' = 'completed';
    let responseText = '';
    let errorMessage: string | undefined;

    try {
      responseText = await this.turnExecutor(
        subThread.id,
        prompt,
        controller.signal,
        {
          opendotsSource: 'swarm_delegation',
          fromDotId: fromDot.id,
          depth: depth + 1,
        },
      );
    } catch (err) {
      status = 'failed';
      errorMessage = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener('abort', abortListener);

      const durationMs = Math.round(performance.now() - start);
      const logEntry = {
        id: delegationId,
        fromDotId: fromDot.id,
        fromDotName: fromDot.name,
        toDotId: targetDot.id,
        toDotName: targetDot.name,
        task,
        status,
        result: responseText || undefined,
        error: errorMessage,
        durationMs,
      };

      try {
        this.workspace.saveSwarmDelegation(logEntry);
      } catch {
        // Safe ignore log persistence failure
      }
    }

    const durationMs = Math.round(performance.now() - start);
    return {
      id: delegationId,
      fromDotId: fromDot.id,
      fromDotName: fromDot.name,
      toDotId: targetDot.id,
      toDotName: targetDot.name,
      task,
      status,
      result: responseText,
      durationMs,
    };
  }

  async broadcast(
    fromDotId: string,
    delegations: Array<{ target: string; task: string; context?: string }>,
    signal?: AbortSignal,
  ): Promise<SwarmDelegationResult[]> {
    const bounded = delegations.slice(0, 3);
    const results = await Promise.all(
      bounded.map(async (d) => {
        try {
          return await this.delegate(
            fromDotId,
            d.target,
            d.task,
            d.context,
            signal,
          );
        } catch (err) {
          const fromDot = this.workspace.dot(fromDotId) ?? {
            id: fromDotId,
            name: 'Dot Principal',
          };
          return {
            id: randomUUID(),
            fromDotId: fromDot.id,
            fromDotName: fromDot.name,
            toDotId: d.target,
            toDotName: d.target,
            task: d.task,
            status: 'failed' as const,
            error: err instanceof Error ? err.message : String(err),
            durationMs: 0,
          };
        }
      }),
    );
    return results;
  }
}
