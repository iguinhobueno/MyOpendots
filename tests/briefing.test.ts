import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { BriefingService } from '../src/server/briefing.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import { Store } from '../src/server/store.js';
import type { Platform } from '../src/server/platform.js';
import type { TelegramService } from '../src/server/telegram.js';

describe('BriefingService (Proactive Intelligence & Daily Summary)', () => {
  let workspace: WorkspaceStore;
  let store: Store;
  let platform: Platform;
  let telegram: TelegramService;
  let briefing: BriefingService;

  beforeEach(() => {
    store = new Store(':memory:');
    workspace = new WorkspaceStore(':memory:', 'owner-test');
    workspace.createSpace('General', 'Default space');
    const space = workspace.spaces()[0];
    workspace.createDot(space.id, 'Jarvis', 'Helpful assistant', true, true);

    // Create a sample page
    workspace.pages.create(space.id, {
      title: 'Planejamento Q4',
      content: 'Metas e objetivos da equipe.',
    });

    platform = {
      turn: vi.fn(async (_threadId, prompt) => {
        return `📊 Visão Geral: Sistema 100% operacional.\n🎯 Prioridades: Concluir Planejamento Q4.\n💡 Sugestão: Revisar tarefas pendentes.`;
      }),
    } as unknown as Platform;

    telegram = {
      sendMessage: vi.fn(async () => {}),
      sendAlert: vi.fn(async () => {}),
      isConfigured: true,
    } as unknown as TelegramService;

    briefing = new BriefingService(workspace, store, platform, telegram, {
      scheduledTime: '08:00',
      targetChatId: '12345678',
    });
  });

  afterEach(() => {
    briefing.stop();
    vi.restoreAllMocks();
  });

  it('collects accurate summary data from spaces, pages, and tasks', () => {
    const spaces = workspace.spaces();
    const summary = briefing.collectSummaryData();

    expect(summary.totalSpaces).toBe(spaces.length);
    expect(summary.dots).toContain('Jarvis');
    expect(summary.recentPages.length).toBe(1);
    expect(summary.recentPages[0].title).toBe('Planejamento Q4');
    expect(summary.totalTasks).toBe(0);
  });

  it('generates executive briefing using platform and selected Dot', async () => {
    const dots = workspace.dots();
    const result = await briefing.generateBriefing(dots[0].id);

    expect(result).toContain('Visão Geral');
    expect(result).toContain('Prioridades');
    expect(platform.turn).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('Planejamento Q4'),
      expect.any(AbortSignal),
      { opendotsSource: 'scheduled_briefing' },
    );
  });

  it('throws an error if no Dots exist in the workspace', async () => {
    vi.spyOn(workspace, 'dots').mockReturnValue([]);

    await expect(briefing.generateBriefing()).rejects.toThrow(
      'Nenhum Dot disponível no workspace',
    );
  });

  it('dispatches briefing directly to configured Telegram chat', async () => {
    await briefing.dispatchBriefing();

    expect(telegram.sendMessage).toHaveBeenCalledWith(
      '12345678',
      expect.stringContaining('BRIEFING PROATIVO OPENDOTS'),
      'Markdown',
    );
  });

  it('falls back to sendAlert when targetChatId is not provided', async () => {
    const unassignedBriefing = new BriefingService(workspace, store, platform, telegram, {
      scheduledTime: '08:00',
    });

    await unassignedBriefing.dispatchBriefing();

    expect(telegram.sendAlert).toHaveBeenCalledWith(
      expect.stringContaining('BRIEFING PROATIVO OPENDOTS'),
    );
  });

  it('starts and stops scheduler timer cleanly', () => {
    vi.useFakeTimers();
    briefing.start();
    briefing.stop();
    vi.useRealTimers();
  });
});
