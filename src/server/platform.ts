import { ComputerService } from './computer-service.js';
import { ConnectionService } from './connections.js';
import { EventType } from '@ag-ui/core';
import { PageService } from './page-service.js';
import { randomUUID } from 'node:crypto';
import {
  CopilotKitIntelligence,
  CopilotRuntime,
  createCopilotHonoHandler,
  type CopilotHonoApp,
} from '@copilotkit/runtime/v2';
import { createSlackChannel } from './slack-channel.js';
export { slackIdentity } from './slack-channel.js';
import { Store } from './store.js';
import { WorkspaceStore } from './workspace.js';
import { DotAgent } from './dot-agent.js';
import { runThreadTurn } from './headless.js';
import {
  INTELLIGENCE_KEY_MISSING_LABEL,
  setupStatus,
  type PlatformConfig,
} from './platform-config.js';
import { validateRuntimeScope } from './runtime-scope.js';
import { learningSelector } from './learning.js';
import { SetupTelemetry } from './setup-telemetry.js';
import { SwarmService } from './swarm.js';
export class Platform {
  private channelStartupFailed = false;
  readonly setupTelemetry: SetupTelemetry;
  readonly pages: PageService;
  readonly computers: ComputerService;
  readonly connections: ConnectionService;
  readonly swarm: SwarmService;
  readonly intelligence?: CopilotKitIntelligence;
  readonly handler?: CopilotHonoApp;
  constructor(
    readonly store: Store,
    readonly workspace: WorkspaceStore,
    readonly config: PlatformConfig,
  ) {
    this.setupTelemetry = new SetupTelemetry(store);
    this.computers = new ComputerService(
      workspace,
      config,
      () => store.settings().paused,
    );
    this.connections = new ConnectionService(workspace.connections);
    this.swarm = new SwarmService(
      workspace,
      (threadId, prompt, signal, metadata) =>
        this.turn(threadId, prompt, signal, metadata),
    );
    this.pages = new PageService(workspace, () => {
      this.requireReady();
      if (this.intelligence) return this.intelligence;
      return {
        async getOrCreateThread() {
          return {};
        },
        async getThreadMessages({ threadId }: { threadId: string }) {
          return {
            messages: workspace.getMessages(threadId).map((m) => ({
              role: m.role,
              content: m.content,
            })),
          };
        },
      };
    });
    if (!config.intelligenceKey) return;
    if (config.intelligenceKey !== 'local') {
      this.intelligence = new CopilotKitIntelligence({
        apiKey: config.intelligenceKey,
        apiUrl: config.intelligenceApiUrl,
        wsUrl: config.intelligenceWsUrl,
        getLearningContainerId: learningSelector(
          workspace,
          config.slackDotId ?? workspace.dots()[0]?.id,
        ),
      });
    }
    const channels = [];
    if (this.intelligence && config.slackChannel && config.slackTeam && config.slackUsers.length) {
      const dotId = config.slackDotId ?? workspace.dots()[0].id;
      if (!workspace.dot(dotId))
        throw new Error('SLACK_DOT_ID does not identify an existing Dot.');
      const slack = createSlackChannel({
        name: config.slackChannel,
        config,
        ownerId: workspace.ownerId,
        paused: () => store.settings().paused,
        agent: () =>
          new DotAgent(
            store,
            workspace,
            config,
            dotId,
            true,
            this.setupTelemetry,
            this.swarm,
          ),
      });
      channels.push(slack);
    }
    const runtime = new CopilotRuntime({
      ...(this.intelligence ? { intelligence: this.intelligence } : {}),
      telemetryId: this.setupTelemetry.identity,
      telemetryProperties: this.setupTelemetry.metadata,
      identifyUser: async () => ({
        id: workspace.ownerId,
        name: 'OpenDots owner',
      }),
      agents: async () =>
        Object.fromEntries(
          workspace
            .dots()
            .map((dot) => [
              dot.id,
              new DotAgent(
                store,
                workspace,
                config,
                dot.id,
                false,
                this.setupTelemetry,
                this.swarm,
              ),
            ]),
        ),
      channels: channels.length ? (channels as any) : undefined,
      generateThreadNames: true,
    } as any);
    this.handler = createCopilotHonoHandler({
      runtime,
      basePath: '/api/copilotkit',
      cors: { origin: [] },
    });
  }
  setup() {
    return setupStatus(
      this.config,
      this.handler?.channels?.status().overall ??
        (this.config.slackChannel ? 'setup_required' : 'not_configured'),
      this.channelStartupFailed,
    );
  }
  requireReady() {
    const missing = this.setup().missing;
    if (missing.length)
      throw new Error(
        `Setup required: ${missing.join(', ')}. Conversations require CopilotKit Intelligence.`,
      );
  }
  async start() {
    this.setupTelemetry.start();
    if (this.handler?.channels) {
      try {
        await this.handler.channels.ready({ timeoutMs: 15000 });
        this.channelStartupFailed = false;
      } catch (error) {
        this.channelStartupFailed = true;
        this.setupTelemetry.capture({
          kind: 'setup_failed',
          step: 'settings',
          error_class: 'channel_start_failed',
        });
        throw error;
      }
    }
  }
  async stop() {
    await this.setupTelemetry.stop();
    await this.handler?.channels?.stop();
  }
  async createConversation(dotId: string, title: string) {
    this.requireReady();
    if (!this.workspace.dot(dotId)) throw new Error('Dot not found.');
    const id = randomUUID();
    if (this.intelligence) {
      try {
        await this.intelligence.createThread({
          threadId: id,
          userId: this.workspace.ownerId,
          agentId: dotId,
          name: title,
        });
      } catch {
        throw new Error(
          'Intelligence could not create this conversation. Check the runtime key and connection.',
        );
      }
    }
    return this.workspace.bindThread(id, dotId, title);
  }
  async history(threadId: string): Promise<string> {
    this.requireReady();
    this.workspace.requireThread(threadId);
    if (this.intelligence) {
      const history = await this.intelligence.getThreadMessages({
        threadId,
        userId: this.workspace.ownerId,
      });
      return history.messages
        .filter((message) => ['user', 'assistant'].includes(message.role))
        .slice(-12)
        .map(
          (message) =>
            `${message.role}: ${typeof message.content === 'string' ? message.content : ''}`,
        )
        .join('\n')
        .slice(-12000);
    }
    return this.workspace
      .getMessages(threadId)
      .filter((message) => ['user', 'assistant'].includes(message.role))
      .slice(-12)
      .map((message) => `${message.role}: ${message.content}`)
      .join('\n')
      .slice(-12000);
  }
  async handle(request: Request): Promise<Response> {
    if (!this.handler)
      return Response.json(
        { error: `Setup required: ${INTELLIGENCE_KEY_MISSING_LABEL}.` },
        { status: 503 },
      );
    let body: unknown;
    if (request.method !== 'GET' && request.method !== 'HEAD')
      body = await request
        .clone()
        .json()
        .catch(() => null);
    try {
      validateRuntimeScope(request, this.workspace, body);
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Conversation scope denied.',
        },
        { status: 403 },
      );
    }
    return this.handler.fetch(request);
  }
  async turn(
    threadId: string,
    prompt: string,
    signal: AbortSignal,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    this.requireReady();
    const thread = this.workspace.requireThread(threadId);
    if (this.intelligence) {
      return runThreadTurn(
        this.config.runtimeUrl,
        this.config.ownerToken
          ? { Authorization: `Bearer ${this.config.ownerToken}` }
          : {},
        thread.dotId,
        threadId,
        prompt,
        signal,
        metadata,
      );
    }
    return this.runLocalTurn(thread.dotId, threadId, prompt, signal, metadata);
  }
  private async runLocalTurn(
    dotId: string,
    threadId: string,
    prompt: string,
    signal: AbortSignal,
    _metadata?: Record<string, unknown>,
  ): Promise<string> {
    const dot = this.workspace.dot(dotId);
    if (!dot) throw new Error('Dot not found.');
    signal.throwIfAborted();
    this.workspace.saveMessage(threadId, 'user', prompt);
    const history = this.workspace.getMessages(threadId);
    const messages = history.map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
    const agent = new DotAgent(
      this.store,
      this.workspace,
      this.config,
      dotId,
      false,
      this.setupTelemetry,
      this.swarm,
    );
    let text = '';
    let runError: Error | undefined;
    await new Promise<void>((resolve, reject) => {
      const sub = agent
        .run({
          threadId,
          runId: randomUUID(),
          state: {},
          context: [],
          messages,
          tools: [],
          forwardedProps: {},
        })
        .subscribe({
          next: (event: any) => {
            if (
              (event.type === EventType.TEXT_MESSAGE_CHUNK ||
                event.type === EventType.TEXT_MESSAGE_CONTENT) &&
              typeof event.delta === 'string'
            ) {
              text += event.delta;
            } else if (event.type === EventType.RUN_ERROR) {
              runError = new Error(event.message || 'Run error');
            }
          },
          error: (err) => {
            sub.unsubscribe();
            reject(err);
          },
          complete: () => {
            sub.unsubscribe();
            if (runError) reject(runError);
            else resolve();
          },
        });
      signal.addEventListener(
        'abort',
        () => {
          agent.abortRun();
          sub.unsubscribe();
          reject(signal.reason ?? new Error('Aborted'));
        },
        { once: true },
      );
    });
    if (!text.trim())
      throw new Error('The current compute turn returned no assistant response.');
    this.workspace.saveMessage(threadId, 'assistant', text);
    return text;
  }
}
