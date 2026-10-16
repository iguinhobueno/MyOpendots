import { useEffect, useState } from 'react';
import {
  Bot,
  Send,
  RefreshCw,
  Sparkles,
  Layers,
  CheckCircle2,
  Clock,
  ArrowRight,
  Shield,
  Film,
  Code,
  Copy,
  Check,
} from 'lucide-react';
import { api } from './api';

interface SwarmDot {
  id: string;
  name: string;
  instructions: string;
  specialty?: string;
}

interface DelegationLog {
  id: string;
  sourceDotId: string;
  targetDotId: string;
  task: string;
  result: string;
  status: string;
  createdAt: string;
}

interface DelegationResponse {
  delegationId: string;
  targetDotId: string;
  targetName: string;
  status: string;
  result: string;
  sourceDotId: string;
}

export function SwarmView() {
  const [dots, setDots] = useState<SwarmDot[]>([]);
  const [logs, setLogs] = useState<DelegationLog[]>([]);
  const [sourceDot, setSourceDot] = useState('dot');
  const [targetDot, setTargetDot] = useState('cinedot');
  const [taskPrompt, setTaskPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState<DelegationResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [logRefreshKey, setLogRefreshKey] = useState(0);

  useEffect(() => {
    async function loadData() {
      try {
        const [dotsData, logsData] = await Promise.all([
          api<{ dots: SwarmDot[] }>('/swarm/dots'),
          api<{ logs: DelegationLog[] }>('/swarm/logs'),
        ]);
        setDots(dotsData.dots || []);
        setLogs(logsData.logs || []);
      } catch (err) {
        console.error('Failed to load swarm data:', err);
      }
    }
    void loadData();
  }, [logRefreshKey]);

  const handleDelegate = async () => {
    if (!taskPrompt.trim() || loading) return;
    setLoading(true);
    setLastResult(null);

    try {
      const response = await api<DelegationResponse>(
        '/swarm/delegate',
        'POST',
        {
          sourceDotId: sourceDot,
          targetDotId: targetDot,
          task: taskPrompt,
        },
      );
      setLastResult(response);
      setLogRefreshKey((k) => k + 1);
    } catch (err: any) {
      alert(`Falha na delegação: ${err.message || 'Erro de comunicação'}`);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const presets = [
    {
      target: 'cinedot',
      title: '3 Ganchos Vitais (CineDot)',
      prompt:
        'Crie 3 opções de ganchos fatais de 3 segundos para um corte sobre inteligência artificial no YouTube Shorts/TikTok. Inclua Frame-0 visual, fala falada e gatilho sonoro.',
    },
    {
      target: 'devDot',
      title: 'Auditoria de Resiliência (DevDot)',
      prompt:
        'Revise a arquitetura de persistência SQLite e os interceptores do Watchdog 24/7. Liste 3 garantias de zero downtime.',
    },
    {
      target: 'cinedot',
      title: 'Legendas Cinéticas (CineDot)',
      prompt:
        'Formate a seguinte frase no padrão de legendas cinéticas em micro-cartões (1 a 3 palavras) com cores de destaque cromático: "Se você não usar inteligência artificial hoje, o mercado vai te engolir amanhã."',
    },
  ];

  return (
    <div className="swarm-view-container">
      {/* Header */}
      <div className="view-hero-header">
        <div className="hero-badge">
          <Layers size={14} />
          <span>SISTEMA MULTI-AGENTE DISTRIBUÍDO</span>
        </div>
        <h1>Swarm Multi-Agente & Delegação</h1>
        <p>
          Coordenação autônoma de especialistas com persistência local SQLite e
          trilha de auditoria em tempo real.
        </p>
      </div>

      {/* Roster de Especialistas */}
      <section className="swarm-roster-section">
        <h2 className="section-title">
          <Bot size={18} />
          <span>Especialistas Conectados ao Swarm</span>
        </h2>
        <div className="swarm-roster-grid">
          {dots.map((dot) => {
            const isCine = dot.id.toLowerCase().includes('cine');
            const isDev = dot.id.toLowerCase().includes('dev');
            return (
              <div
                key={dot.id}
                className={`swarm-dot-card ${targetDot === dot.id ? 'selected' : ''}`}
                onClick={() => setTargetDot(dot.id)}
              >
                <div className="dot-card-header">
                  <div
                    className={`dot-avatar-badge ${isCine ? 'cine' : isDev ? 'dev' : 'main'}`}
                  >
                    {isCine ? (
                      <Film size={20} />
                    ) : isDev ? (
                      <Code size={20} />
                    ) : (
                      <Shield size={20} />
                    )}
                  </div>
                  <div>
                    <h3>{dot.name}</h3>
                    <span className="dot-id-tag">@{dot.id}</span>
                  </div>
                </div>
                <p className="dot-instructions-snippet">{dot.instructions}</p>
                <div className="dot-card-footer">
                  <span className="status-indicator online">Ativo no Swarm</span>
                  <button
                    className="select-delegate-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setTargetDot(dot.id);
                    }}
                  >
                    Selecionar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Estação de Delegação Interativa */}
      <section className="delegation-station-section">
        <h2 className="section-title">
          <Sparkles size={18} />
          <span>Estação de Delegação Interativa</span>
        </h2>

        <div className="delegation-form-card">
          <div className="route-selectors">
            <div className="route-select-group">
              <label>Agente Emissor:</label>
              <select
                value={sourceDot}
                onChange={(e) => setSourceDot(e.target.value)}
              >
                {dots.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} (@{d.id})
                  </option>
                ))}
              </select>
            </div>

            <div className="route-arrow">
              <ArrowRight size={20} />
            </div>

            <div className="route-select-group">
              <label>Agente Especialista (Destino):</label>
              <select
                value={targetDot}
                onChange={(e) => setTargetDot(e.target.value)}
              >
                {dots.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} (@{d.id})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Quick Presets */}
          <div className="quick-presets-row">
            <span>Modelos Rápidos:</span>
            {presets.map((preset, index) => (
              <button
                key={index}
                className="preset-btn"
                onClick={() => {
                  setTargetDot(preset.target);
                  setTaskPrompt(preset.prompt);
                }}
              >
                {preset.title}
              </button>
            ))}
          </div>

          <div className="prompt-input-wrapper">
            <textarea
              className="delegation-textarea"
              placeholder={`Instrução ou tarefa técnica a ser delegada para @${targetDot}...`}
              rows={4}
              value={taskPrompt}
              onChange={(e) => setTaskPrompt(e.target.value)}
            />
          </div>

          <div className="delegation-action-bar">
            <button
              className="delegate-submit-btn"
              disabled={loading || !taskPrompt.trim()}
              onClick={() => void handleDelegate()}
            >
              {loading ? (
                <>
                  <RefreshCw size={16} className="spinning" />
                  <span>Delegando e Processando...</span>
                </>
              ) : (
                <>
                  <Send size={16} />
                  <span>Executar Delegação Autônoma</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Live Result Display */}
        {lastResult && (
          <div className="delegation-result-card">
            <div className="result-header">
              <div className="result-title-badge">
                <CheckCircle2 size={16} />
                <span>Delegação Concluída: {lastResult.targetName}</span>
              </div>
              <button
                className="copy-result-btn"
                onClick={() => copyToClipboard(lastResult.result)}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{copied ? 'Copiado!' : 'Copiar Resposta'}</span>
              </button>
            </div>
            <div className="result-content-body">
              <pre>{lastResult.result}</pre>
            </div>
            <div className="result-meta-footer">
              <span>ID: {lastResult.delegationId}</span>
              <span>Origem: @{lastResult.sourceDotId}</span>
              <span>Destino: @{lastResult.targetDotId}</span>
              <span>Status: {lastResult.status}</span>
            </div>
          </div>
        )}
      </section>

      {/* Histórico / Trilha de Auditoria SQLite */}
      <section className="swarm-audit-section">
        <div className="audit-header-row">
          <h2 className="section-title">
            <Clock size={18} />
            <span>Trilha de Auditoria SQLite (Logs em Tempo Real)</span>
          </h2>
          <button
            className="refresh-logs-btn"
            onClick={() => setLogRefreshKey((k) => k + 1)}
          >
            <RefreshCw size={14} />
            <span>Atualizar Logs</span>
          </button>
        </div>

        {logs.length === 0 ? (
          <div className="empty-logs-placeholder">
            Nenhuma delegação registrada no banco SQLite ainda. Dispare uma
            tarefa acima!
          </div>
        ) : (
          <div className="logs-timeline">
            {logs.map((log) => (
              <div key={log.id} className="log-timeline-item">
                <div className="log-item-header">
                  <div className="log-route-badge">
                    <span>@{log.sourceDotId}</span>
                    <ArrowRight size={12} />
                    <strong>@{log.targetDotId}</strong>
                  </div>
                  <span className="log-status-tag">{log.status}</span>
                  <span className="log-timestamp">
                    {new Date(log.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="log-task-preview">
                  <strong>Tarefa:</strong> {log.task}
                </div>
                <details className="log-result-details">
                  <summary>Ver resposta completa do especialista</summary>
                  <pre className="log-result-body">{log.result}</pre>
                </details>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
