import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TelegramService, type TelegramUpdate } from '../src/server/telegram.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import { Platform } from '../src/server/platform.js';
import { Store } from '../src/server/store.js';

describe('TelegramService', () => {
  let workspace: WorkspaceStore;
  let platform: Platform;
  let store: Store;
  const dummyToken = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';

  beforeEach(() => {
    store = new Store(':memory:');
    workspace = new WorkspaceStore(':memory:', 'owner-test');
    workspace.createSpace('General', 'Default space');
    const space = workspace.spaces()[0];
    workspace.createDot(space.id, 'Jarvis', 'Helpful assistant', true, true);
    platform = {
      turn: vi.fn(async () => 'Resposta simulada do Dot'),
    } as unknown as Platform;
  });

  it('reports isConfigured correctly', () => {
    const unconfigured = new TelegramService(workspace, platform, {});
    expect(unconfigured.isConfigured).toBe(false);

    const configured = new TelegramService(workspace, platform, { botToken: dummyToken });
    expect(configured.isConfigured).toBe(true);
  });

  it('authorizes any user when allowedUsers is empty', async () => {
    const service = new TelegramService(workspace, platform, { botToken: dummyToken });
    const update: TelegramUpdate = {
      update_id: 1,
      message: {
        message_id: 10,
        from: { id: 999999, is_bot: false, first_name: 'Anonymous' },
        chat: { id: 999999, type: 'private' },
        date: Date.now(),
        text: '/start',
      },
    };

    const spySend = vi.spyOn(service, 'sendMessage').mockResolvedValue(undefined);
    await service.handleUpdate(update);

    expect(spySend).toHaveBeenCalledWith(
      999999,
      expect.stringContaining('OpenDots Mobile Conectado!'),
      'Markdown',
    );
  });

  it('rejects unauthorized users when allowedUsers is populated', async () => {
    const service = new TelegramService(workspace, platform, {
      botToken: dummyToken,
      allowedUsers: ['12345', 'valid_user'],
    });

    const update: TelegramUpdate = {
      update_id: 2,
      message: {
        message_id: 11,
        from: { id: 999999, is_bot: false, first_name: 'Attacker', username: 'intruder' },
        chat: { id: 999999, type: 'private' },
        date: Date.now(),
        text: 'Hello dot',
      },
    };

    const spySend = vi.spyOn(service, 'sendMessage').mockResolvedValue(undefined);
    await service.handleUpdate(update);

    expect(spySend).toHaveBeenCalledWith(
      999999,
      expect.stringContaining('Acesso não autorizado'),
      'Markdown',
    );
    expect(platform.turn).not.toHaveBeenCalled();
  });

  it('accepts authorized user matching username', async () => {
    const service = new TelegramService(workspace, platform, {
      botToken: dummyToken,
      allowedUsers: ['@IguinhoBueno'],
    });

    const update: TelegramUpdate = {
      update_id: 3,
      message: {
        message_id: 12,
        from: { id: 55555, is_bot: false, first_name: 'Igor', username: 'iguinhobueno' },
        chat: { id: 55555, type: 'private' },
        date: Date.now(),
        text: '/start',
      },
    };

    const spySend = vi.spyOn(service, 'sendMessage').mockResolvedValue(undefined);
    await service.handleUpdate(update);

    expect(spySend).toHaveBeenCalledWith(
      55555,
      expect.stringContaining('OpenDots Mobile Conectado!'),
      'Markdown',
    );
  });

  it('handles /dots and /use commands', async () => {
    const space = workspace.spaces()[0];
    workspace.createDot(space.id, 'Editor', 'Video editor', true, true);

    const service = new TelegramService(workspace, platform, { botToken: dummyToken });
    const spySend = vi.spyOn(service, 'sendMessage').mockResolvedValue(undefined);

    // /dots
    await service.handleUpdate({
      update_id: 4,
      message: {
        message_id: 20,
        from: { id: 100, is_bot: false, first_name: 'User' },
        chat: { id: 100, type: 'private' },
        date: Date.now(),
        text: '/dots',
      },
    });

    expect(spySend).toHaveBeenCalledWith(
      100,
      expect.stringContaining('Jarvis'),
      'Markdown',
    );
    expect(spySend).toHaveBeenCalledWith(
      100,
      expect.stringContaining('Editor'),
      'Markdown',
    );

    // /use Editor
    await service.handleUpdate({
      update_id: 5,
      message: {
        message_id: 21,
        from: { id: 100, is_bot: false, first_name: 'User' },
        chat: { id: 100, type: 'private' },
        date: Date.now(),
        text: '/use Editor',
      },
    });

    expect(spySend).toHaveBeenCalledWith(
      100,
      expect.stringContaining('Dot alterado para: *Editor*'),
      'Markdown',
    );

    const chatBinding = workspace.telegramChat('100');
    expect(chatBinding).toBeDefined();
    const boundDot = workspace.dot(chatBinding!.dotId);
    expect(boundDot?.name).toBe('Editor');
  });

  it('processes text messages by executing Dot turn and replying', async () => {
    const service = new TelegramService(workspace, platform, { botToken: dummyToken });
    const spySend = vi.spyOn(service, 'sendMessage').mockResolvedValue(undefined);
    const spyAction = vi.spyOn(service, 'sendChatAction').mockResolvedValue(undefined);

    await service.handleUpdate({
      update_id: 6,
      message: {
        message_id: 30,
        from: { id: 100, is_bot: false, first_name: 'User' },
        chat: { id: 100, type: 'private' },
        date: Date.now(),
        text: 'Qual o plano de corte de vídeo?',
      },
    });

    expect(spyAction).toHaveBeenCalledWith(100, 'typing');
    expect(platform.turn).toHaveBeenCalledWith(
      expect.any(String),
      'Qual o plano de corte de vídeo?',
      expect.any(AbortSignal),
      { opendotsSource: 'telegram' },
    );
    expect(spySend).toHaveBeenCalledWith(
      100,
      'Resposta simulada do Dot',
      'Markdown',
    );
  });

  it('splits long messages exceeding 4000 characters', async () => {
    const service = new TelegramService(workspace, platform, { botToken: dummyToken });
    const spyApi = vi.spyOn(service, 'apiCall').mockResolvedValue({} as any);

    const longText = 'A'.repeat(8500);
    await service.sendMessage(100, longText);

    // 8500 chars -> 3 chunks (4000, 4000, 500)
    expect(spyApi).toHaveBeenCalledTimes(3);
    expect(spyApi).toHaveBeenNthCalledWith(1, 'sendMessage', {
      chat_id: 100,
      text: 'A'.repeat(4000),
    });
    expect(spyApi).toHaveBeenNthCalledWith(2, 'sendMessage', {
      chat_id: 100,
      text: 'A'.repeat(4000),
    });
    expect(spyApi).toHaveBeenNthCalledWith(3, 'sendMessage', {
      chat_id: 100,
      text: 'A'.repeat(500),
    });
  });

  it('delivers proactive alerts via sendAlert', async () => {
    const service = new TelegramService(workspace, platform, {
      botToken: dummyToken,
      defaultChatId: '88888',
      allowedUsers: ['11111', 'igor'],
    });

    const spySend = vi.spyOn(service, 'sendMessage').mockResolvedValue(undefined);
    await service.sendAlert('O serviço de renderização encontrou alta latência.');

    expect(spySend).toHaveBeenCalledWith(
      '88888',
      expect.stringContaining('ALERTA OPENDOTS'),
      'Markdown',
    );
  });

  it('processes incoming voice messages by transcribing and executing turn', async () => {
    const service = new TelegramService(workspace, platform, {
      botToken: dummyToken,
      apiKey: 'test-api-key',
    });

    vi.spyOn(service, 'transcribeAudio').mockResolvedValue('Crie um gancho de 3 segundos para o vídeo');
    const spySend = vi.spyOn(service, 'sendMessage').mockResolvedValue(undefined);
    const spyAction = vi.spyOn(service, 'sendChatAction').mockResolvedValue(undefined);

    await service.handleUpdate({
      update_id: 7,
      message: {
        message_id: 40,
        from: { id: 100, is_bot: false, first_name: 'Igor' },
        chat: { id: 100, type: 'private' },
        date: Date.now(),
        voice: {
          file_id: 'voice_123',
          file_unique_id: 'uniq_123',
          duration: 5,
        },
      },
    });

    expect(spyAction).toHaveBeenCalledWith(100, 'record_voice');
    expect(platform.turn).toHaveBeenCalledWith(
      expect.any(String),
      'Crie um gancho de 3 segundos para o vídeo',
      expect.any(AbortSignal),
      { opendotsSource: 'telegram' },
    );
    expect(spySend).toHaveBeenCalledWith(
      100,
      expect.stringContaining('🎙️ _"Crie um gancho de 3 segundos para o vídeo"_'),
      'Markdown',
    );
  });

  it('handles /briefing command via onBriefingRequested callback', async () => {
    const service = new TelegramService(workspace, platform, { botToken: dummyToken });
    service.onBriefingRequested = vi.fn(async () => 'Status: Tudo excelente.');
    const spySend = vi.spyOn(service, 'sendMessage').mockResolvedValue(undefined);

    await service.handleUpdate({
      update_id: 8,
      message: {
        message_id: 50,
        from: { id: 100, is_bot: false, first_name: 'Igor' },
        chat: { id: 100, type: 'private' },
        date: Date.now(),
        text: '/briefing',
      },
    });

    expect(service.onBriefingRequested).toHaveBeenCalledWith('100');
    expect(spySend).toHaveBeenCalledWith(
      100,
      expect.stringContaining('Status: Tudo excelente.'),
      'Markdown',
    );
  });

  it('handles /health command via onDiagnosticsRequested callback', async () => {
    const service = new TelegramService(workspace, platform, { botToken: dummyToken });
    service.onDiagnosticsRequested = vi.fn(async () => '🛡️ DIAGNÓSTICO: HEALTHY');
    const spySend = vi.spyOn(service, 'sendMessage').mockResolvedValue(undefined);

    await service.handleUpdate({
      update_id: 9,
      message: {
        message_id: 51,
        from: { id: 100, is_bot: false, first_name: 'Igor' },
        chat: { id: 100, type: 'private' },
        date: Date.now(),
        text: '/health',
      },
    });

    expect(service.onDiagnosticsRequested).toHaveBeenCalled();
    expect(spySend).toHaveBeenCalledWith(100, '🛡️ DIAGNÓSTICO: HEALTHY', 'Markdown');
  });

  it('handles /swarm command via onSwarmRequested callback', async () => {
    const service = new TelegramService(workspace, platform, { botToken: dummyToken });
    service.onSwarmRequested = vi.fn(async () => '🐝 SWARM ROSTER: CineDot, DevDot');
    const spySend = vi.spyOn(service, 'sendMessage').mockResolvedValue(undefined);

    await service.handleUpdate({
      update_id: 10,
      message: {
        message_id: 52,
        from: { id: 100, is_bot: false, first_name: 'Igor' },
        chat: { id: 100, type: 'private' },
        date: Date.now(),
        text: '/swarm CineDot Gancho de 3s',
      },
    });

    expect(service.onSwarmRequested).toHaveBeenCalledWith('CineDot Gancho de 3s');
    expect(spySend).toHaveBeenCalledWith(100, '🐝 SWARM ROSTER: CineDot, DevDot', 'Markdown');
  });
});
