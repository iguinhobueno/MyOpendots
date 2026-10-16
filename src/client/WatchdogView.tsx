import { useEffect, useState } from 'react';
import {
  ShieldCheck,
  Activity,
  Cpu,
  Database,
  Send,
  RefreshCw,
  Bell,
  HardDrive,
  Clock,
  Sparkles,
} from 'lucide-react';
import { api } from './api';

interface HealthData {
  status: string;
  uptime: number;
  memory: {
    heapUsedMb: number;
    heapTotalMb: number;
    rssMb: number;
  };
  sqlite: string;
  tasks: number;
  spaces: number;
  dots: number;
}

export function WatchdogView() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [briefingOutput, setBriefingOutput] = useState<string | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [lastCheck, setLastCheck] = useState<Date>(new Date());

  useEffect(() => {
    let active = true;
    async function fetchHealth() {
      try {
        const data = await api<HealthData>('/health');
        if (active) {
          setHealth(data);
          setLastCheck(new Date());
        }
      } catch (err) {
        console.error('Failed to poll health:', err);
      }
    }

    void fetchHealth();
    const interval = setInterval(() => void fetchHealth(), 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${d > 0 ? `${d}d ` : ''}${h}h ${m}m ${s}s`;
  };

  const triggerManualBriefing = async () => {
    setBriefingLoading(true);
    setBriefingOutput(null);
    try {
      const res = await api<{ result: string }>('/swarm/delegate', 'POST', {
        sourceDotId: 'watchdog',
        targetDotId: 'dot',
        task: 'Gere o Briefing Matinal Proativo Executivo de hoje. Inclua status dos agentes (CineDot, DevDot), métricas de uptime 24/7, saúde do banco SQLite e plano de ação audiovisual.',
      });
      setBriefingOutput(res.result);
    } catch (err: any) {
      alert(`Falha ao gerar briefing: ${err.message || 'Erro de rede'}`);
    } finally {
      setBriefingLoading(false);
    }
  };

  const heapPercent = health
    ? Math.min(
        100,
        Math.round((health.memory.heapUsedMb / health.memory.heapTotalMb) * 100),
      )
    : 0;

  return (
    <div className="watchdog-view-container">
      {/* Hero Header */}
      <div className="view-hero-header">
        <div className="hero-badge watchdog-badge">
          <ShieldCheck size={14} />
          <span>GUARDIÃO 24/7 & ZERO DOWNTIME</span>
        </div>
        <h1>Painel de Telemetria & Auto-Recuperação</h1>
        <p>
          Monitoramento ininterrupto de processos, interceptores de falha em
          tempo real e persistência resiliente.
        </p>
      </div>

      {/* Grid de Métricas em Tempo Real */}
      <section className="metrics-grid-section">
        <div className="metric-card">
          <div className="metric-card-icon uptime">
            <Clock size={22} />
          </div>
          <div className="metric-card-content">
            <span className="metric-label">Uptime Contínuo</span>
            <strong className="metric-value">
              {health ? formatUptime(health.uptime) : 'Carregando...'}
            </strong>
            <span className="metric-sub">
              Último pulso: {lastCheck.toLocaleTimeString()}
            </span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-card-icon ram">
            <Cpu size={22} />
          </div>
          <div className="metric-card-content">
            <span className="metric-label">Memória Heap Node.js</span>
            <strong className="metric-value">
              {health
                ? `${health.memory.heapUsedMb} MB / ${health.memory.heapTotalMb} MB`
                : '--'}
            </strong>
            <div className="metric-progress-bar">
              <div
                className="metric-progress-fill"
                style={{ width: `${heapPercent}%` }}
              />
            </div>
            <span className="metric-sub">
              RSS: {health ? `${health.memory.rssMb} MB` : '--'} ({heapPercent}%
              heap alocado)
            </span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-card-icon db">
            <Database size={22} />
          </div>
          <div className="metric-card-content">
            <span className="metric-label">Persistência SQLite</span>
            <strong className="metric-value status-healthy">
              {health?.sqlite === 'ok' ? 'ONLINE (WAL)' : 'VERIFICANDO'}
            </strong>
            <span className="metric-sub">
              Transações ACID locais & auditoria ativa
            </span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-card-icon tasks">
            <Activity size={22} />
          </div>
          <div className="metric-card-content">
            <span className="metric-label">Agentes & Tarefas</span>
            <strong className="metric-value">
              {health
                ? `${health.dots} Dots · ${health.tasks} Tarefas`
                : '--'}
            </strong>
            <span className="metric-sub">
              Espaços de Trabalho: {health?.spaces ?? 0}
            </span>
          </div>
        </div>
      </section>

      {/* Escudo de Auto-Recuperação 24/7 */}
      <section className="watchdog-protectors-section">
        <h2 className="section-title">
          <ShieldCheck size={18} />
          <span>Mecanismos de Defesa & Self-Healing Ativos</span>
        </h2>
        <div className="protectors-grid">
          <div className="protector-card active">
            <div className="protector-header">
              <span className="protector-status-indicator pulse" />
              <strong>Uncaught Exception Interceptor</strong>
            </div>
            <p>
              Captura exceções fatais síncronas antes do crash, grava o stack
              trace e reinicia o loop sem interrupção de serviço.
            </p>
          </div>

          <div className="protector-card active">
            <div className="protector-header">
              <span className="protector-status-indicator pulse" />
              <strong>Unhandled Rejection Interceptor</strong>
            </div>
            <p>
              Neutraliza promessas assíncronas rejeitadas em chamadas de IA e
              APIs externas, mantendo o processo intacto.
            </p>
          </div>

          <div className="protector-card active">
            <div className="protector-header">
              <span className="protector-status-indicator pulse" />
              <strong>Alerta de Incidente no Telegram</strong>
            </div>
            <p>
              Despacha imediatamente notificações com diagnóstico completo via
              bot caso qualquer anomalia crítica seja identificada.
            </p>
          </div>

          <div className="protector-card active">
            <div className="protector-header">
              <span className="protector-status-indicator pulse" />
              <strong>Heartbeat & Memory Watchdog</strong>
            </div>
            <p>
              Monitora periodicamente o consumo de memória RSS e vácuo SQLite
              para impedir vazamento de recursos no servidor.
            </p>
          </div>
        </div>
      </section>

      {/* Briefing Matinal Proativo */}
      <section className="briefing-proactive-section">
        <div className="briefing-card-header">
          <div>
            <h2 className="section-title">
              <Bell size={18} />
              <span>Briefing Matinal Proativo (08:00 AM)</span>
            </h2>
            <p className="section-desc">
              Gera e envia automaticamente aos canais um relatório executivo de
              todas as ações, métricas e produções do dia anterior.
            </p>
          </div>
          <button
            className="manual-briefing-btn"
            disabled={briefingLoading}
            onClick={() => void triggerManualBriefing()}
          >
            {briefingLoading ? (
              <>
                <RefreshCw size={14} className="spinning" />
                <span>Compilando Briefing com Swarm...</span>
              </>
            ) : (
              <>
                <Sparkles size={14} />
                <span>Gerar Briefing Executivo Agora</span>
              </>
            )}
          </button>
        </div>

        {briefingOutput && (
          <div className="briefing-output-box">
            <div className="briefing-output-header">
              <span>📋 Relatório Compilado pelo Dot Central:</span>
            </div>
            <pre className="briefing-text">{briefingOutput}</pre>
          </div>
        )}
      </section>
    </div>
  );
}
