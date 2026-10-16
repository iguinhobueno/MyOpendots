import { randomUUID } from 'node:crypto';
import type { WorkspaceStore } from './workspace.js';
import type { Store } from './store.js';
import type { Platform } from './platform.js';
import type { TelegramService } from './telegram.js';

export interface BriefingConfig {
  scheduledTime?: string; // Format "HH:MM", default "08:00"
  targetChatId?: string;
  defaultDotId?: string;
}

export class BriefingService {
  private timer?: ReturnType<typeof setInterval>;
  private lastSentDate = '';

  constructor(
    private readonly workspace: WorkspaceStore,
    private readonly store: Store,
    private readonly platform: Platform,
    private readonly telegram: TelegramService,
    private readonly config: BriefingConfig = {},
  ) {}

  get scheduledTime(): string {
    return this.config.scheduledTime ?? '08:00';
  }

  collectSummaryData() {
    const spaces = this.workspace.spaces();
    const dots = this.workspace.dots();
    const tasks = this.store.tasks();

    const recentPages: { spaceName: string; title: string; updatedAt: number }[] = [];
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    for (const space of spaces) {
      try {
        const pages = this.workspace.pages.list(space.id);
        for (const page of pages) {
          if (page.updatedAt >= oneDayAgo) {
            recentPages.push({
              spaceName: space.name,
              title: page.title,
              updatedAt: page.updatedAt,
            });
          }
        }
      } catch {
        // Safe skip on single space read
      }
    }

    return {
      totalSpaces: spaces.length,
      dots: dots.map((d) => d.name),
      activeTasks: tasks.filter((t) => t.lease).length,
      scheduledTasks: tasks.filter((t) => typeof t.intervalSeconds === 'number').length,
      totalTasks: tasks.length,
      recentPages,
      uptimeHours: (process.uptime() / 3600).toFixed(1),
    };
  }

  async generateBriefing(dotId?: string): Promise<string> {
    const dots = this.workspace.dots();
    if (!dots.length) {
      throw new Error('Nenhum Dot disponível no workspace para gerar o briefing.');
    }

    const selectedDotId = dotId ?? this.config.defaultDotId ?? dots[0].id;
    const selectedDot = this.workspace.dot(selectedDotId) ?? dots[0];

    const data = this.collectSummaryData();

    const pagesSection = data.recentPages.length
      ? data.recentPages.map((p) => `• [${p.spaceName}] ${p.title}`).join('\n')
      : '• Nenhuma alteração recente nas últimas 24 horas.';

    const prompt = [
      'Você é o assistente pessoal de alta performance do OpenDots.',
      'Gere um BRIEFING EXECUTIVO PROATIVO para o usuário começar o dia com clareza absoluta.',
      '',
      '--- DADOS DO SISTEMA ---',
      `• Uptime operacional contínuo: ${data.uptimeHours} horas`,
      `• Total de Tarefas cadastradas: ${data.totalTasks} (Ativas: ${data.activeTasks}, Recorrentes: ${data.scheduledTasks})`,
      `• Documentos/Páginas atualizados nas últimas 24h:`,
      pagesSection,
      '',
      '--- DIRETRIZES DE ESTILO ---',
      '1. Seja direto, enérgico e profissional.',
      '2. Use emojis adequados para destacar pontos-chave.',
      '3. Divida em 3 seções: 📊 Visão Geral do Sistema, 🎯 Prioridades & Tarefas do Dia, e 💡 Sugestão Proativa do Dot.',
      '4. Mantenha o texto limpo e escaneável para leitura rápida no celular.',
    ].join('\n');

    // Create a transient thread for briefing generation
    const thread = this.workspace.bindThread(
      randomUUID(),
      selectedDot.id,
      'Briefing Matinal Automático',
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);

    try {
      const result = await this.platform.turn(thread.id, prompt, controller.signal, {
        opendotsSource: 'scheduled_briefing',
      });
      return result;
    } finally {
      clearTimeout(timeout);
    }
  }

  async dispatchBriefing(targetChatId?: string): Promise<string> {
    const text = await this.generateBriefing();
    const chatId = targetChatId ?? this.config.targetChatId;

    if (this.telegram.isConfigured) {
      const header = `🌅 *BRIEFING PROATIVO OPENDOTS*\n\n`;
      if (chatId) {
        await this.telegram.sendMessage(chatId, `${header}${text}`, 'Markdown');
      } else {
        await this.telegram.sendAlert(`${header}${text}`);
      }
    }

    return text;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 60_000);
    console.log(
      `[Briefing Proativo] Ativo (programado para disparar diariamente às ${this.scheduledTime}).`,
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    console.log('[Briefing Proativo] Encerrado.');
  }

  private async tick(): Promise<void> {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const currentHours = String(now.getHours()).padStart(2, '0');
    const currentMinutes = String(now.getMinutes()).padStart(2, '0');
    const currentTime = `${currentHours}:${currentMinutes}`;

    if (currentTime === this.scheduledTime && this.lastSentDate !== today) {
      this.lastSentDate = today;
      try {
        console.log(`[Briefing Proativo] Disparando briefing automático matinal (${currentTime})...`);
        await this.dispatchBriefing();
        console.log('[Briefing Proativo] Briefing entregue com sucesso!');
      } catch (error) {
        console.error('[Briefing Proativo] Falha no disparo do briefing:', error);
      }
    }
  }
}
