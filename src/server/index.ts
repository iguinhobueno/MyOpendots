import { webSearchProvider } from './parallel.js';
import { createShutdown } from './shutdown.js';
import { reportChannelFailure, safeFailure } from './slack-channel.js';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Store } from './store.js';
import { Runner } from './runner.js';
import { createApp } from './app.js';
import { resolveAppOrigins } from './app-origin.js';
import { WorkspaceStore } from './workspace.js';
import { Platform } from './platform.js';
import {
  intelligenceApiKeyFromEnv,
  intelligenceWsUrlFromEnv,
  type PlatformConfig,
} from './platform-config.js';
import { research } from './research.js';
import { TelegramService } from './telegram.js';
import { Watchdog } from './watchdog.js';
import { BriefingService } from './briefing.js';
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 4310);
const ownerToken = process.env.OWNER_TOKEN;
if (
  !['127.0.0.1', '::1', 'localhost'].includes(host) &&
  (!ownerToken || ownerToken.length < 24)
)
  throw new Error(
    'External binding requires an OWNER_TOKEN of at least 24 characters.',
  );
const database = process.env.DATABASE_PATH ?? 'data/opendots.sqlite';
const store = new Store(database);
const workspace = new WorkspaceStore(
  database,
  process.env.OWNER_ID ?? 'opendots-owner',
);
const config: PlatformConfig = {
  intelligenceKey: intelligenceApiKeyFromEnv(process.env),
  intelligenceApiUrl: process.env.INTELLIGENCE_API_URL || undefined,
  intelligenceWsUrl: intelligenceWsUrlFromEnv(process.env),
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL,
  baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
  webSearchProvider: webSearchProvider(process.env.WEB_SEARCH_PROVIDER),
  parallelApiKey: process.env.PARALLEL_API_KEY,
  browserUrl: process.env.BROWSER_URL,
  browserSecret: process.env.BROWSER_SECRET,
  computerSupervisorUrl: process.env.COMPUTER_SUPERVISOR_URL,
  computerSupervisorToken: process.env.COMPUTER_SUPERVISOR_TOKEN,
  computerToken: process.env.COMPUTER_TOKEN,
  computerNamespace: process.env.COMPUTER_NAMESPACE,
  voiceKey: process.env.VOICE_API_KEY,
  voiceModel: process.env.VOICE_MODEL,
  voiceName: process.env.VOICE_NAME ?? 'marin',
  slackChannel: process.env.SLACK_CHANNEL_NAME,
  slackTeam: process.env.SLACK_TEAM_ID,
  slackUsers: (process.env.SLACK_USER_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  slackDotId: process.env.SLACK_DOT_ID || undefined,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || undefined,
  telegramAllowedUsers: (process.env.TELEGRAM_ALLOWED_USERS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  telegramDotId: process.env.TELEGRAM_DOT_ID || undefined,
  telegramDefaultChatId: process.env.TELEGRAM_CHAT_ID || undefined,
  runtimeUrl: `http://${host === '::1' ? '[::1]' : '127.0.0.1'}:${port}/api/copilotkit`,
  ownerToken,
};
const platform = new Platform(store, workspace, config);
export const telegram = new TelegramService(workspace, platform, {
  botToken: config.telegramBotToken,
  allowedUsers: config.telegramAllowedUsers,
  defaultChatId: config.telegramDefaultChatId,
  defaultDotId: config.telegramDotId,
  apiKey: config.apiKey,
  baseUrl: config.baseUrl,
});

const researchConfig = {
  mode: 'live' as const,
  apiKey: config.apiKey,
  model: config.model,
  baseUrl: config.baseUrl,
  webSearchProvider: config.webSearchProvider,
  parallelApiKey: config.parallelApiKey,
  browserUrl: config.browserUrl,
  browserSecret: config.browserSecret,
};
const runner = new Runner(
  store,
  researchConfig,
  async (claim, memories, signal, progress) => {
    if (config.intelligenceKey) {
      const threadId = workspace.taskThread(claim.id);
      if (threadId) {
        progress('Running this task in its Intelligence conversation.');
        const text = await platform.turn(threadId, claim.prompt, signal, {
          opendotsSource: 'scheduled_task',
        });
        return { text, sources: [], sample: false };
      }
    }
    progress('Executing automated research via live web search and model.');
    const result = await research(
      claim.prompt,
      memories,
      researchConfig,
      signal,
      progress,
    );
    return result;
  },
);
export const watchdog = new Watchdog(workspace, store, runner, telegram, {
  checkIntervalMs: Number(process.env.WATCHDOG_INTERVAL_MS ?? 60_000),
  maxHeapBytes: Number(process.env.WATCHDOG_MAX_HEAP_MB ?? 512) * 1024 * 1024,
});
export const briefing = new BriefingService(
  workspace,
  store,
  platform,
  telegram,
  {
    scheduledTime: process.env.BRIEFING_TIME ?? '08:00',
    targetChatId: config.telegramDefaultChatId,
    defaultDotId: config.telegramDotId,
  },
);
telegram.onBriefingRequested = async () => briefing.generateBriefing();
telegram.onDiagnosticsRequested = async () => {
  const diag = await watchdog.diagnose();
  return [
    '🛡️ *DIAGNÓSTICO WATCHDOG 24/7*',
    `• Status: *${diag.status.toUpperCase()}*`,
    `• Uptime: \`${diag.uptimeSeconds}s\``,
    `• Memória Heap: \`${diag.memory.heapUsedMb} MB\` (Limite: ${diag.memory.heapLimitMb} MB)`,
    `• RSS: \`${diag.memory.rssMb} MB\``,
    `• Banco SQLite: \`${diag.database.status}\` (Latência: \`${diag.database.latencyMs}ms\`)`,
    `• Tarefas Pendentes: \`${diag.scheduler.pendingTasks}\``,
    `• Falhas Consecutivas: \`${diag.consecutiveFailures}\``,
  ].join('\n');
};
telegram.onSwarmRequested = async (arg?: string) => {
  if (arg) {
    const parts = arg.split(/\s+/);
    const target = parts[0];
    const task = parts.slice(1).join(' ');
    if (!task) {
      return `⚠️ Informe a tarefa após o nome do Dot. Exemplo:\n\`/swarm CineDot Crie um gancho de 3s sobre produtividade\``;
    }
    const dots = workspace.dots();
    const fromId = dots[0]?.id ?? 'telegram';
    const result = await platform.swarm.delegate(fromId, target, task);
    return [
      `🐝 *RESULTADO DA DELEGAÇÃO SWARM*`,
      `• Especialista: *${result.toDotName}*`,
      `• Duração: \`${result.durationMs}ms\``,
      `• Tarefa: _"${task}"_`,
      `\n${result.result}`,
    ].join('\n');
  }

  const roster = platform.swarm.getRoster();
  const recentLogs = platform.swarm.getHistory(3);
  const rosterLines = roster
    .map((d) => `• *${d.name}*: _${d.instructions.slice(0, 100)}..._`)
    .join('\n');
  const logLines = recentLogs.length
    ? recentLogs
        .map(
          (l) =>
            `• [${l.fromDotName} ➔ ${l.toDotName}]: ${l.status === 'completed' ? '✅' : '❌'} (${l.durationMs}ms)`,
        )
        .join('\n')
    : '• Nenhuma delegação recente.';

  return [
    `🐝 *OPENDOTS MULTI-AGENT SWARM*`,
    `\n🤖 *Especialistas Disponíveis:*`,
    rosterLines,
    `\n📋 *Atividade Recente:*`,
    logLines,
    `\n💡 *Como Delegar:*`,
    `Envie: \`/swarm <Dot> <tarefa>\` ou peça normalmente em qualquer conversa.`,
  ].join('\n');
};
const wsOrigin = new URL(
  config.intelligenceWsUrl ?? 'wss://realtime.intelligence.copilotkit.ai',
).origin;
const app = createApp({
  store,
  runner,
  config: researchConfig,
  ownerToken,
  origin: resolveAppOrigins(process.env.APP_ORIGIN, process.env.NODE_ENV),
  platform,
});
app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header(
    'Content-Security-Policy',
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${wsOrigin}; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
  );
  await next();
});
app.get('/api/*', (c) => c.json({ error: 'Not found.' }, 404));
app.use('/*', serveStatic({ root: './dist/client' }));
app.get('*', serveStatic({ path: './dist/client/index.html' }));
const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(`OpenDots template listening on http://${host}:${info.port}`);
  runner.start();
  void platform
    .start()
    .catch((error) =>
      reportChannelFailure(
        'Slack Channels activation failed; check setup status',
        [safeFailure(error)],
      ),
    );
  void telegram
    .start()
    .catch((error) =>
      reportChannelFailure(
        'Telegram bot service failed to start',
        [safeFailure(error)],
      ),
    );
  platform.swarm.seedSpecialists();
  watchdog.start();
  briefing.start();
});
const shutdown = createShutdown({
  stopRunner: () => runner.stop(),
  stopPlatform: () => platform.stop(),
  stopTelegram: () => telegram.stop(),
  stopWatchdog: () => watchdog.stop(),
  stopBriefing: () => briefing.stop(),
  closeServer: () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
  exit: (code) => process.exit(code),
  report: (operation, error) =>
    reportChannelFailure(operation, [safeFailure(error)]),
});
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
