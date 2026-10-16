import { randomUUID } from 'node:crypto';
import type { WorkspaceStore } from './workspace.js';
import type { Platform } from './platform.js';

export interface TelegramConfig {
  botToken?: string;
  allowedUsers?: string[];
  defaultChatId?: string;
  defaultDotId?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
}

export interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramAudio {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
  title?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  voice?: TelegramVoice;
  audio?: TelegramAudio;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export class TelegramService {
  private offset = 0;
  private stopped = false;
  private abortController: AbortController | null = null;

  constructor(
    private readonly workspace: WorkspaceStore,
    private readonly platform: Platform,
    private readonly config: TelegramConfig,
  ) {}

  get isConfigured(): boolean {
    return Boolean(this.config.botToken && this.config.botToken.trim());
  }

  public onBriefingRequested?: (chatId: string) => Promise<string>;
  public onDiagnosticsRequested?: () => Promise<string>;

  private sanitize(input: unknown): string {
    const str = input instanceof Error ? input.message : String(input);
    if (!this.config.botToken) return str;
    return str.replaceAll(this.config.botToken, 'bot<REDACTED>');
  }

  async apiCall<T>(method: string, body?: Record<string, unknown>): Promise<T> {
    if (!this.config.botToken) {
      throw new Error('Telegram bot token not configured.');
    }
    const url = `https://api.telegram.org/bot${this.config.botToken}/${method}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: this.abortController?.signal,
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Telegram API ${method} failed (${response.status}): ${this.sanitize(errorText)}`,
      );
    }
    const data = (await response.json()) as { ok: boolean; result: T; description?: string };
    if (!data.ok) {
      throw new Error(
        `Telegram API ${method} error: ${this.sanitize(data.description || 'Unknown error')}`,
      );
    }
    return data.result;
  }

  async sendChatAction(chatId: string | number, action = 'typing'): Promise<void> {
    try {
      await this.apiCall('sendChatAction', { chat_id: chatId, action });
    } catch {
      // Chat actions are advisory; failures can be safely ignored
    }
  }

  async sendMessage(
    chatId: string | number,
    text: string,
    parseMode?: 'Markdown' | 'HTML',
  ): Promise<void> {
    const maxLen = 4000;
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += maxLen) {
      chunks.push(text.slice(i, i + maxLen));
    }
    if (!chunks.length) return;

    for (const chunk of chunks) {
      try {
        if (parseMode) {
          await this.apiCall('sendMessage', {
            chat_id: chatId,
            text: chunk,
            parse_mode: parseMode,
          });
          continue;
        }
      } catch {
        // Fallback to plain text on markdown parse errors
      }
      await this.apiCall('sendMessage', {
        chat_id: chatId,
        text: chunk,
      });
    }
  }

  async sendAlert(text: string, targetChatId?: string | number): Promise<void> {
    if (!this.isConfigured) return;
    const recipients = new Set<string>();
    if (targetChatId) {
      recipients.add(String(targetChatId));
    } else if (this.config.defaultChatId) {
      recipients.add(this.config.defaultChatId);
    } else if (this.config.allowedUsers?.length) {
      for (const user of this.config.allowedUsers) {
        if (/^\d+$/.test(user)) recipients.add(user);
      }
    }
    const alertMessage = `🚨 *ALERTA OPENDOTS*\n\n${text}`;
    for (const id of recipients) {
      await this.sendMessage(id, alertMessage, 'Markdown').catch((err) =>
        console.error(`[Telegram] Alert delivery to ${id} failed:`, this.sanitize(err)),
      );
    }
  }

  private isAuthorized(message: TelegramMessage): boolean {
    const allowed = this.config.allowedUsers;
    if (!allowed || allowed.length === 0) return true;
    const senderId = String(message.from?.id ?? '');
    const senderUsername = message.from?.username?.toLowerCase() ?? '';
    return allowed.some((u) => {
      const clean = u.trim().toLowerCase().replace(/^@/, '');
      return clean === senderId || clean === senderUsername;
    });
  }

  private async getFilePath(fileId: string): Promise<string> {
    const file = await this.apiCall<{ file_path?: string }>('getFile', { file_id: fileId });
    if (!file.file_path) {
      throw new Error('Telegram did not return a valid file path.');
    }
    return file.file_path;
  }

  async transcribeAudio(fileId: string, mimeType = 'audio/ogg'): Promise<string> {
    if (!this.config.apiKey) {
      throw new Error('No API key configured for audio transcription.');
    }
    const filePath = await this.getFilePath(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${this.config.botToken}/${filePath}`;
    const fileResponse = await fetch(fileUrl, { signal: this.abortController?.signal });
    if (!fileResponse.ok) {
      throw new Error(`Failed to download audio from Telegram (${fileResponse.status}).`);
    }
    const arrayBuffer = await fileResponse.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuffer).toString('base64');

    // Google Gemini API handles audio multimodal inputs directly
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.config.apiKey}`;
    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Audio,
                },
              },
              {
                text: 'Transcreva este áudio com precisão na língua falada. Retorne ESTRITAMENTE a transcrição textual do que foi dito, sem saudações, sem introduções e sem markdown.',
              },
            ],
          },
        ],
      }),
    });

    if (geminiRes.ok) {
      const data = (await geminiRes.json()) as any;
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text === 'string' && text.trim()) return text.trim();
    }

    // Fallback: Gemini 1.5 Flash
    const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.config.apiKey}`;
    const fallbackRes = await fetch(fallbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Audio,
                },
              },
              {
                text: 'Transcreva este áudio exatamente. Retorne apenas o texto transcrito.',
              },
            ],
          },
        ],
      }),
    });
    if (fallbackRes.ok) {
      const data = (await fallbackRes.json()) as any;
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text === 'string' && text.trim()) return text.trim();
    }

    throw new Error('Falha na transcrição do áudio com o modelo Gemini.');
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (!message) return;
    const chatId = message.chat.id;

    if (!this.isAuthorized(message)) {
      const senderId = message.from?.id ?? 'desconhecido';
      await this.sendMessage(
        chatId,
        `⛔ *Acesso não autorizado.*\n\nSeu Telegram ID é: \`${senderId}\`\nAdicione-o na variável \`TELEGRAM_ALLOWED_USERS\` no arquivo \`.env\` do servidor para liberar o acesso.`,
        'Markdown',
      );
      return;
    }

    const dots = this.workspace.dots();
    if (!dots.length) {
      await this.sendMessage(
        chatId,
        '⚠️ Nenhum Dot configurado no OpenDots. Acesse a interface web para inicializar um Dot.',
      );
      return;
    }

    let binding = this.workspace.telegramChat(String(chatId));
    let dotId = binding?.dotId ?? this.config.defaultDotId ?? dots[0].id;
    let dot = this.workspace.dot(dotId) ?? dots[0];
    dotId = dot.id;

    if (!binding) {
      const thread = this.workspace.bindThread(
        randomUUID(),
        dotId,
        `Telegram (${message.from?.first_name || 'Mobile'})`,
      );
      this.workspace.bindTelegramChat(String(chatId), thread.id, dotId);
      binding = {
        chatId: String(chatId),
        threadId: thread.id,
        dotId,
        updatedAt: Date.now(),
      };
    } else {
      try {
        this.workspace.requireThread(binding.threadId);
      } catch {
        const thread = this.workspace.bindThread(
          randomUUID(),
          dotId,
          `Telegram (${message.from?.first_name || 'Mobile'})`,
        );
        this.workspace.bindTelegramChat(String(chatId), thread.id, dotId);
        binding = {
          chatId: String(chatId),
          threadId: thread.id,
          dotId,
          updatedAt: Date.now(),
        };
      }
    }

    const rawText = message.text?.trim() ?? '';

    // Command handling
    if (rawText.startsWith('/start')) {
      await this.sendMessage(
        chatId,
        `👋 *OpenDots Mobile Conectado!*\n\n🤖 *Dot Ativo:* ${dot.name}\n\n*Comandos Rápidos:*\n• /briefing - Gerar briefing executivo proativo\n• /health - Diagnóstico completo do Watchdog 24/7\n• /dots - Listar Dots disponíveis\n• /use <nome> - Trocar o Dot da conversa\n• /new - Reiniciar o tópico da conversa\n• /status - Uptime e memória\n\nEnvie mensagens de texto ou **áudios** para interagir diretamente.`,
        'Markdown',
      );
      return;
    }

    if (rawText.startsWith('/briefing')) {
      void this.sendChatAction(chatId, 'typing');
      if (this.onBriefingRequested) {
        try {
          const briefing = await this.onBriefingRequested(String(chatId));
          await this.sendMessage(chatId, `🌅 *BRIEFING EXECUTIVO*\n\n${briefing}`, 'Markdown');
        } catch (err) {
          await this.sendMessage(chatId, '⚠️ Falha ao gerar briefing executivo no momento.');
        }
      } else {
        await this.sendMessage(chatId, 'Serviço de briefing proativo não configurado.');
      }
      return;
    }

    if (rawText.startsWith('/health') || rawText.startsWith('/watchdog')) {
      if (this.onDiagnosticsRequested) {
        try {
          const diag = await this.onDiagnosticsRequested();
          await this.sendMessage(chatId, diag, 'Markdown');
        } catch {
          await this.sendMessage(chatId, '⚠️ Falha ao obter diagnóstico do Watchdog.');
        }
      } else {
        await this.sendMessage(chatId, 'Watchdog não configurado.');
      }
      return;
    }

    if (rawText.startsWith('/dots')) {
      const list = dots
        .map((d) => `• *${d.name}* (ID: \`${d.id.slice(0, 8)}\`)${d.id === dotId ? ' 👈 _[ativo]_' : ''}`)
        .join('\n');
      await this.sendMessage(
        chatId,
        `🤖 *Dots Disponíveis no OpenDots:*\n\n${list}\n\nUse \`/use <nome>\` para alternar o Dot ativo.`,
        'Markdown',
      );
      return;
    }

    if (rawText.startsWith('/use')) {
      const targetQuery = rawText.replace(/^\/use\s*/, '').trim().toLowerCase();
      if (!targetQuery) {
        await this.sendMessage(
          chatId,
          'Informe o nome ou ID do Dot. Exemplo: `/use Dot`',
          'Markdown',
        );
        return;
      }
      const targetDot = dots.find(
        (d) =>
          d.name.toLowerCase().includes(targetQuery) ||
          d.id.toLowerCase().startsWith(targetQuery),
      );
      if (!targetDot) {
        await this.sendMessage(
          chatId,
          `❌ Dot não encontrado com o termo "${targetQuery}". Use /dots para listar os disponíveis.`,
        );
        return;
      }
      const newThread = this.workspace.bindThread(
        randomUUID(),
        targetDot.id,
        `Telegram (${targetDot.name})`,
      );
      this.workspace.bindTelegramChat(String(chatId), newThread.id, targetDot.id);
      await this.sendMessage(
        chatId,
        `✅ Dot alterado para: *${targetDot.name}*!\nNova conversa inicializada.`,
        'Markdown',
      );
      return;
    }

    if (rawText.startsWith('/new')) {
      const freshThread = this.workspace.bindThread(
        randomUUID(),
        dotId,
        `Telegram (${dot.name})`,
      );
      this.workspace.bindTelegramChat(String(chatId), freshThread.id, dotId);
      await this.sendMessage(
        chatId,
        `🔄 *Conversa reiniciada com o Dot ${dot.name}!* As próximas mensagens começarão um novo contexto histórico.`,
        'Markdown',
      );
      return;
    }

    if (rawText.startsWith('/status')) {
      const uptimeSec = Math.floor(process.uptime());
      const heapMb = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
      const historyCount = this.workspace.getMessages(binding.threadId).length;
      await this.sendMessage(
        chatId,
        `🛡️ *Status do Servidor OpenDots*\n\n• Operação: *Online (24/7)*\n• Uptime: \`${uptimeSec}s\`\n• Memória Heap: \`${heapMb} MB\`\n• Dot Ativo: *${dot.name}*\n• Mensagens no Tópico: \`${historyCount}\`\n• Persistência: *SQLite Local-First*`,
        'Markdown',
      );
      return;
    }

    // Process user input (Text or Voice)
    let promptText = rawText;
    let isVoice = false;

    if (!promptText && (message.voice || message.audio)) {
      const fileId = message.voice?.file_id ?? message.audio?.file_id;
      const mimeType = message.voice?.mime_type ?? message.audio?.mime_type ?? 'audio/ogg';
      if (fileId) {
        void this.sendChatAction(chatId, 'record_voice');
        try {
          promptText = await this.transcribeAudio(fileId, mimeType);
          isVoice = true;
        } catch (transcribeError) {
          console.error('[Telegram] Voice transcription error:', this.sanitize(transcribeError));
          await this.sendMessage(
            chatId,
            '⚠️ Não foi possível transcrever sua mensagem de voz. Verifique a configuração da chave do Gemini.',
          );
          return;
        }
      }
    }

    if (!promptText) return;

    void this.sendChatAction(chatId, 'typing');
    const controller = new AbortController();

    try {
      const answer = await this.platform.turn(
        binding.threadId,
        promptText,
        controller.signal,
        { opendotsSource: 'telegram' },
      );

      const header = isVoice ? `🎙️ _"${promptText}"_\n\n` : '';
      await this.sendMessage(chatId, `${header}${answer}`, 'Markdown');
    } catch (turnError) {
      console.error('[Telegram] Dot turn error:', this.sanitize(turnError));
      await this.sendMessage(
        chatId,
        'Desculpe, ocorreu uma instabilidade ao processar seu pedido. Tente novamente em alguns instantes.',
      );
    }
  }

  async start(): Promise<void> {
    if (!this.isConfigured) {
      console.log('[Telegram] TELEGRAM_BOT_TOKEN não configurado. Serviço móvel em espera.');
      return;
    }
    this.stopped = false;
    this.abortController = new AbortController();

    try {
      const botInfo = await this.apiCall<{ username?: string }>('getMe');
      console.log(`[Telegram] Bot conectado com sucesso: @${botInfo.username || 'bot'}`);
    } catch (authError) {
      console.error('[Telegram] Falha na autenticação do bot:', this.sanitize(authError));
      return;
    }

    void this.pollLoop();
  }

  stop(): void {
    this.stopped = true;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    console.log('[Telegram] Serviço móvel encerrado.');
  }

  private async pollLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        const updates = await this.apiCall<TelegramUpdate[]>('getUpdates', {
          offset: this.offset,
          timeout: 25,
          allowed_updates: ['message'],
        });

        for (const update of updates) {
          this.offset = update.update_id + 1;
          await this.handleUpdate(update).catch((err) =>
            console.error('[Telegram] Erro no processamento do update:', this.sanitize(err)),
          );
        }
      } catch (pollError) {
        if (this.stopped) break;
        // Non-fatal network drops: wait 3s before retrying
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }
}
