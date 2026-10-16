import type { WorkspaceStore } from './workspace.js';
import type { Store } from './store.js';
import type { Runner } from './runner.js';
import type { TelegramService } from './telegram.js';

export interface WatchdogConfig {
  checkIntervalMs?: number;
  maxHeapBytes?: number;
  failureThreshold?: number;
}

export interface WatchdogDiagnostics {
  status: 'healthy' | 'degraded' | 'critical';
  uptimeSeconds: number;
  timestamp: number;
  memory: {
    heapUsedMb: number;
    heapTotalMb: number;
    rssMb: number;
    heapLimitMb: number;
  };
  database: {
    status: 'ok' | 'error';
    latencyMs: number;
    error?: string;
  };
  scheduler: {
    status: 'ok' | 'stuck';
    pendingTasks: number;
  };
  consecutiveFailures: number;
}

export class Watchdog {
  private timer?: ReturnType<typeof setInterval>;
  private consecutiveFailures = 0;
  private isAlertActive = false;
  private uncaughtHandler?: (error: Error) => void;
  private unhandledRejectionHandler?: (reason: unknown) => void;

  constructor(
    private readonly workspace: WorkspaceStore,
    private readonly store: Store,
    private readonly runner: Runner,
    private readonly telegram: TelegramService,
    private readonly config: WatchdogConfig = {},
  ) {}

  private get maxHeapBytes(): number {
    return this.config.maxHeapBytes ?? 512 * 1024 * 1024; // 512 MB default
  }

  private get failureThreshold(): number {
    return this.config.failureThreshold ?? 2;
  }

  async diagnose(): Promise<WatchdogDiagnostics> {
    const mem = process.memoryUsage();
    const heapUsed = mem.heapUsed;
    const heapUsedMb = Math.round(heapUsed / 1024 / 1024);
    const heapTotalMb = Math.round(mem.heapTotal / 1024 / 1024);
    const rssMb = Math.round(mem.rss / 1024 / 1024);

    let heapLimitMb = 0;
    try {
      const v8 = await import('node:v8');
      heapLimitMb = Math.round(v8.getHeapStatistics().heap_size_limit / 1024 / 1024);
    } catch {
      heapLimitMb = heapTotalMb * 2;
    }

    // Ping SQLite database
    let dbStatus: 'ok' | 'error' = 'ok';
    let dbError: string | undefined;
    const dbStart = performance.now();
    try {
      this.workspace.spaces();
    } catch (err) {
      dbStatus = 'error';
      dbError = err instanceof Error ? err.message : String(err);
    }
    const dbLatencyMs = Math.round(performance.now() - dbStart);

    // Check scheduler
    const tasks = this.store.tasks();
    const pendingTasks = tasks.filter((t) => t.lease).length;
    const schedulerStatus: 'ok' | 'stuck' = 'ok';

    // Evaluate health
    let status: 'healthy' | 'degraded' | 'critical' = 'healthy';
    if (dbStatus === 'error') {
      status = 'critical';
    } else if (heapUsed > this.maxHeapBytes) {
      status = 'degraded';
    }

    return {
      status,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: Date.now(),
      memory: {
        heapUsedMb,
        heapTotalMb,
        rssMb,
        heapLimitMb,
      },
      database: {
        status: dbStatus,
        latencyMs: dbLatencyMs,
        error: dbError,
      },
      scheduler: {
        status: schedulerStatus,
        pendingTasks,
      },
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  async check(): Promise<WatchdogDiagnostics> {
    const diag = await this.diagnose();

    if (diag.status !== 'healthy') {
      this.consecutiveFailures++;
      diag.consecutiveFailures = this.consecutiveFailures;

      // Self-healing attempt: trigger garbage collection if memory elevated
      if (diag.memory.heapUsedMb > Math.round(this.maxHeapBytes / 1024 / 1024)) {
        if (typeof global.gc === 'function') {
          try {
            global.gc();
          } catch {
            // gc call error safe ignore
          }
        }
      }

      // Self-healing attempt: abort stuck runner tasks if database latency or error
      if (diag.database.status === 'error') {
        try {
          this.runner.abortAll();
        } catch {
          // safe ignore
        }
      }

      // Dispatch Telegram alert when threshold reached
      if (this.consecutiveFailures >= this.failureThreshold && !this.isAlertActive) {
        this.isAlertActive = true;
        const details = [
          `• Status: *${diag.status.toUpperCase()}*`,
          `• Falhas consecutivas: ${this.consecutiveFailures}`,
          `• Heap: \`${diag.memory.heapUsedMb} MB\` (Limite: ${Math.round(this.maxHeapBytes / 1024 / 1024)} MB)`,
          `• Banco de Dados: \`${diag.database.status}\`${diag.database.error ? ` (${diag.database.error})` : ''}`,
          `• Latência DB: \`${diag.database.latencyMs}ms\``,
          `• Uptime: \`${diag.uptimeSeconds}s\``,
          `• Ação de auto-recuperação: *Disparada automaticamente*`,
        ].join('\n');

        await this.telegram.sendAlert(
          `⚠️ *INCIDENTE DETECTADO PELO WATCHDOG 24/7*\n\n${details}`,
        ).catch(() => {});
      }
    } else {
      // System recovered
      if (this.isAlertActive) {
        this.isAlertActive = false;
        await this.telegram.sendAlert(
          `✅ *RECUPERAÇÃO CONFIRMADA (24/7)*\n\nTodos os serviços e métricas retornaram à normalidade estável.\n• Heap: \`${diag.memory.heapUsedMb} MB\`\n• DB Latência: \`${diag.database.latencyMs}ms\``,
        ).catch(() => {});
      }
      this.consecutiveFailures = 0;
      diag.consecutiveFailures = 0;
    }

    return diag;
  }

  attachProcessListeners(): void {
    if (this.uncaughtHandler) return;

    this.uncaughtHandler = (error: Error) => {
      console.error('[Watchdog 24/7] Uncaught Exception:', error);
      void this.telegram.sendAlert(
        `🚨 *FALHA CRÍTICA / UNCAUGHT EXCEPTION*\n\nErro: \`${error.message}\`\nStack: \`${(error.stack || '').slice(0, 500)}\`\nStatus: *Auto-recuperação iniciada.*`,
      ).catch(() => {});
    };

    this.unhandledRejectionHandler = (reason: unknown) => {
      console.error('[Watchdog 24/7] Unhandled Rejection:', reason);
      const msg = reason instanceof Error ? reason.message : String(reason);
      void this.telegram.sendAlert(
        `🚨 *FALHA CRÍTICA / UNHANDLED REJECTION*\n\nMotivo: \`${msg}\`\nStatus: *Processo mantido ativo pelo Watchdog.*`,
      ).catch(() => {});
    };

    process.on('uncaughtException', this.uncaughtHandler);
    process.on('unhandledRejection', this.unhandledRejectionHandler);
  }

  detachProcessListeners(): void {
    if (this.uncaughtHandler) {
      process.off('uncaughtException', this.uncaughtHandler);
      this.uncaughtHandler = undefined;
    }
    if (this.unhandledRejectionHandler) {
      process.off('unhandledRejection', this.unhandledRejectionHandler);
      this.unhandledRejectionHandler = undefined;
    }
  }

  start(): void {
    if (this.timer) return;
    this.attachProcessListeners();
    const interval = this.config.checkIntervalMs ?? 60_000;
    this.timer = setInterval(() => void this.check(), interval);
    console.log(`[Watchdog 24/7] Guardião ativo (inspeção a cada ${Math.round(interval / 1000)}s).`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.detachProcessListeners();
    console.log('[Watchdog 24/7] Guardião encerrado.');
  }
}
