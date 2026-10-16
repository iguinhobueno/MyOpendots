import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Watchdog } from '../src/server/watchdog.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import { Store } from '../src/server/store.js';
import type { Runner } from '../src/server/runner.js';
import type { TelegramService } from '../src/server/telegram.js';

describe('Watchdog (24/7 Self-Healing & High Availability)', () => {
  let workspace: WorkspaceStore;
  let store: Store;
  let runner: Runner;
  let telegram: TelegramService;
  let watchdog: Watchdog;

  beforeEach(() => {
    store = new Store(':memory:');
    workspace = new WorkspaceStore(':memory:', 'owner-test');
    workspace.createSpace('Main Space', 'Production workspace');

    runner = {
      abortAll: vi.fn(),
    } as unknown as Runner;

    telegram = {
      sendAlert: vi.fn(async () => {}),
      sendMessage: vi.fn(async () => {}),
      isConfigured: true,
    } as unknown as TelegramService;

    watchdog = new Watchdog(workspace, store, runner, telegram, {
      checkIntervalMs: 1000,
      maxHeapBytes: 512 * 1024 * 1024,
      failureThreshold: 2,
    });
  });

  afterEach(() => {
    watchdog.stop();
    vi.restoreAllMocks();
  });

  it('reports healthy status when memory and database are normal', async () => {
    const diag = await watchdog.diagnose();

    expect(diag.status).toBe('healthy');
    expect(diag.database.status).toBe('ok');
    expect(diag.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(diag.memory.heapUsedMb).toBeGreaterThan(0);
    expect(diag.scheduler.status).toBe('ok');
    expect(diag.consecutiveFailures).toBe(0);
  });

  it('detects degraded status when heap usage exceeds limit', async () => {
    const strictWatchdog = new Watchdog(workspace, store, runner, telegram, {
      maxHeapBytes: 1024, // 1 KB forces degraded status
    });

    const diag = await strictWatchdog.diagnose();
    expect(diag.status).toBe('degraded');
  });

  it('detects critical status when database ping fails', async () => {
    vi.spyOn(workspace, 'spaces').mockImplementation(() => {
      throw new Error('SQLite disk I/O error');
    });

    const diag = await watchdog.diagnose();
    expect(diag.status).toBe('critical');
    expect(diag.database.status).toBe('error');
    expect(diag.database.error).toContain('SQLite disk I/O error');
  });

  it('increments failures and triggers Telegram alert when threshold reached', async () => {
    vi.spyOn(workspace, 'spaces').mockImplementation(() => {
      throw new Error('SQLite locked');
    });

    // Check 1: failure threshold = 2, so should not alert yet
    const check1 = await watchdog.check();
    expect(check1.consecutiveFailures).toBe(1);
    expect(telegram.sendAlert).not.toHaveBeenCalled();
    expect(runner.abortAll).toHaveBeenCalledTimes(1);

    // Check 2: threshold reached, alerts Telegram
    const check2 = await watchdog.check();
    expect(check2.consecutiveFailures).toBe(2);
    expect(telegram.sendAlert).toHaveBeenCalledTimes(1);
    expect(telegram.sendAlert).toHaveBeenCalledWith(
      expect.stringContaining('INCIDENTE DETECTADO PELO WATCHDOG 24/7'),
    );

    // Check 3: consecutive failure while alert already active, does not spam duplicate alert
    await watchdog.check();
    expect(telegram.sendAlert).toHaveBeenCalledTimes(1);
  });

  it('sends recovery alert when health is restored after an incident', async () => {
    const spacesSpy = vi.spyOn(workspace, 'spaces');

    // Trigger 2 failures to activate alert
    spacesSpy.mockImplementation(() => {
      throw new Error('Database temporary outage');
    });
    await watchdog.check();
    await watchdog.check();
    expect(telegram.sendAlert).toHaveBeenCalledTimes(1);

    // Restore health
    spacesSpy.mockRestore();
    const recoveredDiag = await watchdog.check();

    expect(recoveredDiag.status).toBe('healthy');
    expect(recoveredDiag.consecutiveFailures).toBe(0);
    expect(telegram.sendAlert).toHaveBeenCalledTimes(2);
    expect(telegram.sendAlert).toHaveBeenLastCalledWith(
      expect.stringContaining('RECUPERAÇÃO CONFIRMADA (24/7)'),
    );
  });

  it('attaches process listeners and forwards uncaught exceptions to Telegram', () => {
    watchdog.attachProcessListeners();

    const listeners = process.listeners('uncaughtException');
    expect(listeners.length).toBeGreaterThan(0);

    const testError = new Error('Test fatal exception');
    // Call the attached handler directly to avoid terminating the test runner
    const handler = listeners[listeners.length - 1];
    handler(testError, 'uncaughtException');

    expect(telegram.sendAlert).toHaveBeenCalledWith(
      expect.stringContaining('FALHA CRÍTICA / UNCAUGHT EXCEPTION'),
    );

    watchdog.detachProcessListeners();
  });

  it('attaches process listeners and forwards unhandled rejections to Telegram', () => {
    watchdog.attachProcessListeners();

    const listeners = process.listeners('unhandledRejection');
    expect(listeners.length).toBeGreaterThan(0);

    const testReason = 'Simulated async network drop';
    const handler = listeners[listeners.length - 1];
    handler(testReason as unknown as Error, Promise.resolve());

    expect(telegram.sendAlert).toHaveBeenCalledWith(
      expect.stringContaining('FALHA CRÍTICA / UNHANDLED REJECTION'),
    );

    watchdog.detachProcessListeners();
  });

  it('starts and stops inspection timer cleanly', () => {
    vi.useFakeTimers();
    const checkSpy = vi.spyOn(watchdog, 'check').mockResolvedValue({} as any);

    watchdog.start();
    vi.advanceTimersByTime(2500);

    expect(checkSpy).toHaveBeenCalledTimes(2);

    watchdog.stop();
    vi.advanceTimersByTime(2500);
    expect(checkSpy).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});
