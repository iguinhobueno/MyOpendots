import { useState, useEffect, useRef } from 'react';
import {
  Film,
  Play,
  Pause,
  Sparkles,
  Zap,
  Volume2,
  CheckCircle2,
  Copy,
  Check,
  RefreshCw,
  Sliders,
  Tv,
} from 'lucide-react';
import { api } from './api';

export function CineDotStudio() {
  // Hook Generator State
  const [theme, setTheme] = useState(
    'O segredo de inteligência artificial que as Big Techs escondem de você',
  );
  const [platform, setPlatform] = useState('YouTube Shorts');
  const [tone, setTone] = useState('Confronto & Urgência');
  const [generating, setGenerating] = useState(false);
  const [hookResults, setHookResults] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Kinetic Subtitles Simulator State
  const [subText, setSubText] = useState(
    'SE VOCÊ NÃO DOMINAR IA HOJE O MERCADO VAI DESTRUIR SUA CARREIRA AMANHÃ',
  );
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentWordIdx, setCurrentWordIdx] = useState(0);
  const [wpm, setWpm] = useState(200);

  const words = subText.trim().split(/\s+/).filter(Boolean);

  // Break into 1-2 words chunks for kinetic subtitles
  const chunks: string[][] = [];
  for (let i = 0; i < words.length; i += 2) {
    chunks.push(words.slice(i, i + 2));
  }

  const [currentChunkIdx, setCurrentChunkIdx] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isPlaying || chunks.length === 0) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    const intervalMs = (60 / wpm) * 1000 * 1.5;
    timerRef.current = setInterval(() => {
      setCurrentChunkIdx((prev) => (prev + 1) % chunks.length);
    }, intervalMs);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, wpm, chunks.length]);

  const handleGenerateHooks = async () => {
    if (!theme.trim() || generating) return;
    setGenerating(true);
    setHookResults(null);

    const taskPrompt = `Como CineDot (Editor Sênior 12+ anos e Estrategista Audiovisual), crie 3 Ganchos Fatais de 3 segundos para ${platform}.
Tema: "${theme}"
Tom: ${tone}

Para cada opção, estruture rigorosamente:
1. FRAME-0 VISUAL (o que os olhos veem no primeiro milissegundo: corte, expressão, objeto, zoom in)
2. FALA MAGNÉTICA (1 frase curta, direta ao ponto sem introdução ou saudação)
3. SOUND DESIGN / SFX (efeito sonoro de impacto: whoosh, hit grave, glitch)
4. MICRO-LEGENDA CINÉTICA (as primeiras 3 a 5 palavras destacadas)`;

    try {
      const res = await api<{ result: string }>('/swarm/delegate', 'POST', {
        sourceDotId: 'studio',
        targetDotId: 'cinedot',
        task: taskPrompt,
      });
      setHookResults(res.result);
    } catch (err: any) {
      alert(`Falha ao gerar ganchos: ${err.message || 'Erro de rede'}`);
    } finally {
      setGenerating(false);
    }
  };

  const copyHooks = () => {
    if (!hookResults) return;
    void navigator.clipboard.writeText(hookResults);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const currentWords = chunks[currentChunkIdx] || [];

  return (
    <div className="cinedot-studio-container">
      {/* Hero Header */}
      <div className="view-hero-header">
        <div className="hero-badge studio-badge">
          <Film size={14} />
          <span>ESTÚDIO AUDIOVISUAL & RETENÇÃO EXTREMA</span>
        </div>
        <h1>CineDot Audiovisual Studio</h1>
        <p>
          Engenharia de retenção para YouTube Shorts e TikTok: Ganchos fatais de
          3 segundos, legendas cinéticas em micro-cartões e checklist dos 12+
          anos de mercado.
        </p>
      </div>

      <div className="studio-main-grid">
        {/* Coluna da Esquerda: Gerador de Ganchos & Auditoria */}
        <div className="studio-control-col">
          {/* Gerador de Ganchos */}
          <section className="studio-card">
            <h2 className="studio-card-title">
              <Zap size={18} />
              <span>Gerador de Ganchos Fatais (Regra dos 3 Segundos)</span>
            </h2>
            <div className="form-group">
              <label>Tema ou Ideia Central do Vídeo:</label>
              <input
                type="text"
                className="studio-input"
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                placeholder="Ex: Como viralizar no TikTok em 2026..."
              />
            </div>

            <div className="studio-form-row">
              <div className="form-group flex-1">
                <label>Plataforma Alvo:</label>
                <select
                  className="studio-select"
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                >
                  <option value="YouTube Shorts">YouTube Shorts</option>
                  <option value="TikTok">TikTok</option>
                  <option value="Instagram Reels">Instagram Reels</option>
                </select>
              </div>

              <div className="form-group flex-1">
                <label>Tom Psicológico:</label>
                <select
                  className="studio-select"
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                >
                  <option value="Confronto & Urgência">
                    Confronto & Urgência
                  </option>
                  <option value="Revelação de Segredo">
                    Revelação de Segredo
                  </option>
                  <option value="Alerta de Risco Grave">
                    Alerta de Risco Grave
                  </option>
                  <option value="Curiosidade Magnética">
                    Curiosidade Magnética
                  </option>
                </select>
              </div>
            </div>

            <button
              className="generate-hook-btn"
              disabled={generating || !theme.trim()}
              onClick={() => void handleGenerateHooks()}
            >
              {generating ? (
                <>
                  <RefreshCw size={15} className="spinning" />
                  <span>CineDot Construindo Roteiro de Retenção...</span>
                </>
              ) : (
                <>
                  <Sparkles size={15} />
                  <span>Gerar 3 Opções de Ganchos Fatais</span>
                </>
              )}
            </button>

            {hookResults && (
              <div className="hook-result-display">
                <div className="hook-result-header">
                  <span>🎯 Direção de Ganchos (CineDot):</span>
                  <button className="copy-btn-mini" onClick={copyHooks}>
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                    <span>{copied ? 'Copiado!' : 'Copiar'}</span>
                  </button>
                </div>
                <pre className="hook-output-pre">{hookResults}</pre>
              </div>
            )}
          </section>

          {/* Checklist de Retenção de Ouro */}
          <section className="studio-card checklist-card">
            <h2 className="studio-card-title">
              <CheckCircle2 size={18} />
              <span>Padrão Editorial de Retenção (12+ Anos)</span>
            </h2>
            <ul className="retention-checklist">
              <li>
                <div className="check-bullet active" />
                <div>
                  <strong>A Regra dos 3 Segundos (Gancho Fatal)</strong>
                  <p>
                    Sem introduções burocráticas ou saudações. O Frame-0 já deve
                    entregar o ápice ou conflito imediato.
                  </p>
                </div>
              </li>
              <li>
                <div className="check-bullet active" />
                <div>
                  <strong>Rítmica & Pacing Visual (3 a 5 Segundos)</strong>
                  <p>
                    Alterne cortes, zooms dinâmicos, B-Rolls ou manchetes antes
                    que a atenção do espectador decaia.
                  </p>
                </div>
              </li>
              <li>
                <div className="check-bullet active" />
                <div>
                  <strong>Mixagem Submissa de Trilha (BGM 18% a 22%)</strong>
                  <p>
                    A voz principal deve reinar límpida no centro. A trilha de
                    tensão fica subjugada no fundo.
                  </p>
                </div>
              </li>
              <li>
                <div className="check-bullet active" />
                <div>
                  <strong>Legendas Cinéticas em Micro-Cartões</strong>
                  <p>
                    1 a 3 palavras por bloco com realce cromático
                    (Amarelo/Vermelho) nas palavras de choque emocional.
                  </p>
                </div>
              </li>
            </ul>
          </section>
        </div>

        {/* Coluna da Direita: Simulador de Legendas Cinéticas 9:16 */}
        <div className="studio-preview-col">
          <section className="studio-card preview-card">
            <div className="preview-card-header">
              <h2 className="studio-card-title">
                <Tv size={18} />
                <span>Simulador de Legendas Cinéticas (9:16)</span>
              </h2>
              <div className="playback-controls">
                <button
                  className="play-pause-btn"
                  onClick={() => setIsPlaying(!isPlaying)}
                  aria-label={isPlaying ? 'Pausar' : 'Reproduzir'}
                >
                  {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                  <span>{isPlaying ? 'Pausar' : 'Play'}</span>
                </button>
              </div>
            </div>

            {/* Smartphone 9:16 Frame */}
            <div className="phone-mockup-frame">
              <div className="phone-speaker-bar" />
              <div className="phone-screen-viewport">
                <div className="phone-video-simulation">
                  {/* Subtle pulsing background representing 60fps video */}
                  <div className="mock-video-bg" />

                  {/* Top TikTok/Shorts UI overlay mockup */}
                  <div className="mock-top-controls">
                    <span className="mock-badge-live">🔴 4K 60FPS</span>
                    <span className="mock-audio-pill">
                      <Volume2 size={11} /> BGM (20%)
                    </span>
                  </div>

                  {/* Centered Kinetic Subtitle Card */}
                  <div className="kinetic-sub-box">
                    <div className="kinetic-word-card">
                      {currentWords.map((word, idx) => {
                        const cleanWord = word.replace(/[^a-zA-ZÀ-ÿ0-9]/g, '');
                        const isHighlight = [
                          'DESTRUIR',
                          'CARREIRA',
                          'IA',
                          'NÃO',
                          'SEGREDO',
                          'MERCADO',
                          'DOMINAR',
                          'PERIGO',
                          'HOJE',
                          'AMICÍDIO',
                          'URGENTE',
                          'FATAL',
                        ].includes(cleanWord.toUpperCase());

                        return (
                          <span
                            key={idx}
                            className={`kinetic-word ${isHighlight ? 'impact-highlight' : 'standard-word'}`}
                          >
                            {word}{' '}
                          </span>
                        );
                      })}
                    </div>
                  </div>

                  {/* Right side engagement icons mockup */}
                  <div className="mock-right-rail">
                    <div className="mock-icon-dot" />
                    <div className="mock-icon-dot" />
                    <div className="mock-icon-dot" />
                  </div>
                </div>
              </div>
            </div>

            {/* Input para testar legendas customizadas */}
            <div className="sub-simulator-controls">
              <label>Testar Texto no Simulador:</label>
              <textarea
                className="sub-test-input"
                rows={2}
                value={subText}
                onChange={(e) => {
                  setSubText(e.target.value);
                  setCurrentChunkIdx(0);
                }}
              />
              <div className="wpm-control-row">
                <Sliders size={14} />
                <span>Velocidade de Leitura: {wpm} WPM</span>
                <input
                  type="range"
                  min="120"
                  max="300"
                  step="10"
                  value={wpm}
                  onChange={(e) => setWpm(Number(e.target.value))}
                />
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
