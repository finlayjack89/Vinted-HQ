/**
 * ItemIntelligence — Analysis modal with real-time SSE progress,
 * authenticity verdict checklist, and market valuation panel.
 *
 * Renders as a portal overlay. Subscribes to `intelligence:progress`
 * events during analysis and displays the final report.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import {
  colors,
  font,
  frostedPanel,
  frostedCard,
  btnPrimary,
  btnSecondary,
  btnSmall,
  badge,
  modalOverlay,
  modalContent,
  radius,
  spacing,
  transition,
  shadows,
  sectionTitle,
} from '../theme';

// ─── Types ──────────────────────────────────────────────────────────────────

type AnalysisMode = 'auth_only' | 'market_only' | 'full';
type AnalysisTier = 'essential' | 'pro' | 'ultra';

type ProgressEvent = {
  step: string;
  status: string;
  message: string;
  progress_pct?: number;
  data?: Record<string, unknown>;
};

type MarkerEval = {
  marker_name: string;
  weight: string;
  result: string;
  observation: string;
  vision_confidence: number;
  image_index?: number | null;
};

type ProfitEstimate = {
  platform: string;
  sell_price_gbp: number;
  fees_gbp: number;
  shipping_gbp: number;
  net_revenue_gbp: number;
  purchase_price_gbp: number;
  profit_gbp: number;
  profit_margin_pct: number;
  roi_pct: number;
};

type Verdict = {
  verdict: string;
  confidence: number;
  risk_level: string;
  veto_triggered: boolean;
  veto_reason?: string;
  critical_pass: number;
  critical_fail: number;
  critical_unverifiable: number;
  supporting_pass: number;
  supporting_fail: number;
  supporting_unverifiable: number;
  reasoning: string;
};

type Report = {
  report_id: string;
  mode: string;
  listing_title: string;
  listing_price_gbp: number;
  identification?: {
    brand: string;
    model?: string;
    colorway?: string;
    size?: string;
    condition?: string;
    confidence: number;
    reasoning: string;
  };
  authenticity_evaluation?: {
    evaluations: MarkerEval[];
    general_observations: string[];
    photos_analyzed: number;
  };
  authenticity_verdict?: Verdict;
  market_valuation?: {
    item_summary: string;
    price_position: string;
    price_percentile?: number;
    profit_estimates: ProfitEstimate[];
    market_velocity?: string;
    confidence: number;
    reasoning: string;
  };
  models_used: string[];
  duration_seconds: number;
  errors: string[];
  partial: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  listing: {
    title: string;
    description?: string;
    price: number;
    url?: string;
    photo_urls: string[];
    brand_hint?: string;
    category_hint?: string;
    condition_hint?: string;
    local_id?: number;
    vinted_item_id?: number;
  };
  /** If a cached report exists, show it immediately */
  cachedReport?: Report | null;
};

// ─── Pipeline Step Labels ───────────────────────────────────────────────────

const STEP_LABELS: Record<string, string> = {
  preflight: 'Pre-flight Check',
  agent_1: 'Identifying Item',
  cache: 'Cache Lookup',
  agent_2: 'Researching Market & Auth Data',
  ocr: 'OCR Text Extraction',
  reference: 'Reference Image Fetch',
  agent_3: 'Market Valuation',
  agent_4: 'Authenticity Analysis',
  veto: 'Forensic Verdict Engine',
  complete: 'Analysis Complete',
};

const STEP_ICONS: Record<string, string> = {
  preflight: '🔑',
  agent_1: '🔍',
  cache: '💾',
  agent_2: '📊',
  ocr: '📝',
  reference: '🖼️',
  agent_3: '💰',
  agent_4: '🔬',
  veto: '⚖️',
  complete: '✅',
};

// ─── Main Component ─────────────────────────────────────────────────────────

export default function ItemIntelligence({ open, onClose, listing, cachedReport }: Props) {
  const [mode, setMode] = useState<AnalysisMode>('full');
  const [tier, setTier] = useState<AnalysisTier>('essential');
  const [deepResearch, setDeepResearch] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const [report, setReport] = useState<Report | null>(cachedReport ?? null);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [progressPct, setProgressPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'auth' | 'market'>('overview');
  const progressEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll progress log
  useEffect(() => {
    progressEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [progress]);

  // Subscribe to progress events
  useEffect(() => {
    if (!analyzing) return;
    const unsub = window.vinted.onIntelligenceProgress((event: ProgressEvent) => {
      setProgress((prev) => [...prev, event]);
      setCurrentStep(event.step);
      if (event.progress_pct !== undefined) setProgressPct(event.progress_pct);

      if (event.step === 'complete' && event.data?.report) {
        setReport(event.data.report as unknown as Report);
        setAnalyzing(false);
      }
      if (event.status === 'error' && event.step !== 'complete') {
        // Non-fatal error, continue
      }
    });
    return unsub;
  }, [analyzing]);

  const handleAnalyze = useCallback(async () => {
    setAnalyzing(true);
    setProgress([]);
    setReport(null);
    setError(null);
    setProgressPct(0);
    setCurrentStep(null);

    try {
      const result = await window.vinted.analyzeItem({
        mode,
        tier,
        deep_research: deepResearch,
        listing_title: listing.title,
        listing_description: listing.description,
        listing_price_gbp: listing.price,
        listing_url: listing.url,
        photo_urls: listing.photo_urls,
        brand_hint: listing.brand_hint,
        category_hint: listing.category_hint,
        condition_hint: listing.condition_hint,
        local_id: listing.local_id,
        vinted_item_id: listing.vinted_item_id,
      });

      if (!result.ok) {
        setError(result.error || 'Analysis failed');
        setAnalyzing(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
      setAnalyzing(false);
    }
  }, [mode, tier, deepResearch, listing]);

  if (!open) return null;

  const showResults = !!report && !analyzing;

  return ReactDOM.createPortal(
    <div className="modal-overlay" style={modalOverlay} onClick={onClose}>
      <div
        style={{
          ...modalContent,
          maxWidth: 860,
          maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: spacing.lg, flexShrink: 0,
        }}>
          <div>
            <h2 style={{ ...sectionTitle, fontSize: font.size.xl, marginBottom: 4 }}>
              🧠 Item Intelligence
            </h2>
            <p style={{ margin: 0, fontSize: font.size.sm, color: colors.textSecondary, maxWidth: 500 }}>
              {listing.title}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 20, color: colors.textMuted, padding: 8,
            }}
          >
            ✕
          </button>
        </div>

        {/* ── Mode Picker (pre-analysis) ── */}
        {!analyzing && !showResults && (
          <div style={{ flexShrink: 0 }}>
            <div style={{ marginBottom: spacing.lg }}>
              <div style={{
                display: 'flex', gap: spacing.sm, marginBottom: spacing.lg,
              }}>
                {(['auth_only', 'market_only', 'full'] as AnalysisMode[]).map((m) => {
                  const active = mode === m;
                  const labels: Record<AnalysisMode, string> = {
                    auth_only: '🔬 Auth Check',
                    market_only: '💰 Market Research',
                    full: '🎯 Full Analysis',
                  };
                  const descs: Record<AnalysisMode, string> = {
                    auth_only: 'Verify authenticity only',
                    market_only: 'Price & profit analysis',
                    full: 'Auth + Market combined',
                  };
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      style={{
                        flex: 1,
                        padding: `${spacing.md}px ${spacing.lg}px`,
                        borderRadius: radius.lg,
                        border: active ? `2px solid ${colors.primary}` : `1px solid rgba(0,0,0,0.08)`,
                        background: active ? colors.primaryMuted : colors.bgElevated,
                        cursor: 'pointer',
                        transition: transition.base,
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ fontSize: font.size.base, fontWeight: font.weight.semibold, color: active ? colors.primary : colors.textPrimary }}>
                        {labels[m]}
                      </div>
                      <div style={{ fontSize: font.size.xs, color: colors.textSecondary, marginTop: 2 }}>
                        {descs[m]}
                      </div>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={handleAnalyze}
                style={{
                  ...btnPrimary,
                  width: '100%',
                  padding: '14px 24px',
                  fontSize: font.size.lg,
                  background: 'linear-gradient(135deg, #6366F1, #8B5CF6)',
                  borderRadius: radius.lg,
                }}
              >
                Run Analysis
              </button>

              {/* ── Tier Selector ── */}
              <div style={{ marginTop: spacing.lg }}>
                <div style={{ fontSize: font.size.sm, fontWeight: font.weight.semibold, color: colors.textPrimary, marginBottom: spacing.sm }}>
                  Analysis Depth
                </div>
                <div style={{ display: 'flex', gap: spacing.sm }}>
                  {([
                    { key: 'essential' as AnalysisTier, label: '⚡ Essential', cost: '~£0.15', time: '~40s', desc: 'Flash model · OCR · Domain ranking' },
                    { key: 'pro' as AnalysisTier, label: '🔬 Pro', cost: '~£0.27', time: '~55s', desc: 'Pro model · Reference images · 7+ queries' },
                    { key: 'ultra' as AnalysisTier, label: '🛡️ Ultra', cost: '~£0.47', time: '~70s', desc: 'All Pro features + Multi-model consensus' },
                  ]).map(({ key, label, cost, time, desc }) => {
                    const active = tier === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => { setTier(key); if (key === 'essential') setDeepResearch(false); }}
                        style={{
                          flex: 1,
                          padding: `${spacing.md}px ${spacing.sm}px`,
                          borderRadius: radius.lg,
                          border: active ? `2px solid ${colors.primary}` : `1px solid rgba(0,0,0,0.08)`,
                          background: active ? colors.primaryMuted : colors.bgElevated,
                          cursor: 'pointer',
                          transition: transition.base,
                          textAlign: 'center',
                        }}
                      >
                        <div style={{ fontSize: font.size.base, fontWeight: font.weight.semibold, color: active ? colors.primary : colors.textPrimary }}>
                          {label}
                        </div>
                        <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>
                          {desc}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'center', gap: spacing.sm, marginTop: 6 }}>
                          <span style={{ fontSize: font.size.xs, color: colors.textSecondary }}>{cost}</span>
                          <span style={{ fontSize: font.size.xs, color: colors.textMuted }}>·</span>
                          <span style={{ fontSize: font.size.xs, color: colors.textSecondary }}>{time}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── Deep Research Toggle (Pro/Ultra only) ── */}
              {tier !== 'essential' && (
                <div style={{
                  marginTop: spacing.md,
                  padding: spacing.md,
                  borderRadius: radius.md,
                  background: deepResearch ? 'rgba(99, 102, 241, 0.06)' : 'rgba(0,0,0,0.02)',
                  border: deepResearch ? `1px solid ${colors.primary}` : '1px solid rgba(0,0,0,0.06)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  cursor: 'pointer',
                  transition: transition.base,
                }}
                  onClick={() => setDeepResearch(!deepResearch)}
                >
                  <div>
                    <div style={{ fontSize: font.size.sm, fontWeight: font.weight.semibold, color: deepResearch ? colors.primary : colors.textPrimary }}>
                      🧪 Deep Research
                    </div>
                    <div style={{ fontSize: font.size.xs, color: colors.textSecondary, marginTop: 2 }}>
                      Agentic multi-step search · +£0.15-0.35 · +20-30s
                    </div>
                  </div>
                  <div style={{
                    width: 40, height: 22, borderRadius: 11,
                    background: deepResearch ? colors.primary : 'rgba(0,0,0,0.15)',
                    position: 'relative', transition: transition.base,
                  }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: '50%',
                      background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                      position: 'absolute', top: 2,
                      left: deepResearch ? 20 : 2,
                      transition: transition.base,
                    }} />
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div style={{
                padding: spacing.md, background: colors.errorBg,
                border: `1px solid rgba(220,38,38,0.2)`, borderRadius: radius.md,
                color: colors.error, fontSize: font.size.sm,
              }}>
                {error}
              </div>
            )}
          </div>
        )}

        {/* ── Progress View (during analysis) ── */}
        {analyzing && (
          <div style={{ flex: 1, overflow: 'auto' }}>
            {/* Progress bar */}
            <div style={{
              height: 4, background: 'rgba(0,0,0,0.06)', borderRadius: 2,
              marginBottom: spacing.lg, overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', background: 'linear-gradient(90deg, #6366F1, #8B5CF6)',
                borderRadius: 2, width: `${progressPct}%`,
                transition: 'width 0.5s ease',
              }} />
            </div>

            {/* Step list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
              {progress.map((evt, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: spacing.md,
                    padding: `${spacing.sm}px ${spacing.md}px`,
                    background: evt.status === 'error' ? colors.errorBg
                      : evt.status === 'complete' ? 'rgba(5,150,105,0.06)'
                      : 'transparent',
                    borderRadius: radius.sm,
                  }}
                >
                  <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>
                    {evt.status === 'running' ? '⏳'
                      : evt.status === 'complete' ? '✅'
                      : evt.status === 'error' ? '❌'
                      : evt.status === 'skipped' ? '⏭️'
                      : STEP_ICONS[evt.step] || '🔄'}
                  </span>
                  <div>
                    <div style={{
                      fontSize: font.size.sm, fontWeight: font.weight.semibold,
                      color: evt.status === 'error' ? colors.error : colors.textPrimary,
                    }}>
                      {STEP_LABELS[evt.step] || evt.step}
                    </div>
                    <div style={{ fontSize: font.size.xs, color: colors.textSecondary, marginTop: 2 }}>
                      {evt.message}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={progressEndRef} />
            </div>
          </div>
        )}

        {/* ── Results View (after analysis) ── */}
        {showResults && (
          <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
            {/* Tab bar */}
            <div style={{
              display: 'flex', gap: 2, marginBottom: spacing.lg,
              background: 'rgba(0,0,0,0.03)', borderRadius: radius.md, padding: 3,
              flexShrink: 0,
            }}>
              {([
                { key: 'overview' as const, label: '📋 Overview' },
                ...(report.mode !== 'market_only' ? [{ key: 'auth' as const, label: '🔬 Authenticity' }] : []),
                ...(report.mode !== 'auth_only' ? [{ key: 'market' as const, label: '💰 Market' }] : []),
              ]).map(({ key, label }) => {
                const active = activeTab === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActiveTab(key)}
                    style={{
                      flex: 1, padding: '8px 14px', borderRadius: radius.sm,
                      border: 'none',
                      background: active ? colors.bgElevated : 'transparent',
                      color: active ? colors.primary : colors.textSecondary,
                      fontWeight: active ? font.weight.semibold : font.weight.medium,
                      fontSize: font.size.sm, cursor: 'pointer',
                      transition: transition.base,
                      boxShadow: active ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Tab content */}
            <div style={{ flex: 1, overflow: 'auto' }}>
              {activeTab === 'overview' && <OverviewTab report={report} />}
              {activeTab === 'auth' && <AuthTab report={report} />}
              {activeTab === 'market' && <MarketTab report={report} />}
            </div>

            {/* Footer */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginTop: spacing.lg, paddingTop: spacing.md,
              borderTop: `1px solid ${colors.separator}`, flexShrink: 0,
            }}>
              <div style={{ fontSize: font.size.xs, color: colors.textMuted }}>
                {report.duration_seconds.toFixed(1)}s · {report.models_used.join(', ')}
                {report.partial && <span style={{ color: colors.warning, marginLeft: 8 }}>⚠ Partial results</span>}
              </div>
              <div style={{ display: 'flex', gap: spacing.sm }}>
                <button type="button" onClick={handleAnalyze} style={{ ...btnSecondary, ...btnSmall }}>
                  Re-analyze
                </button>
                <button type="button" onClick={onClose} style={{ ...btnPrimary, ...btnSmall }}>
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ─── Overview Tab ────────────────────────────────────────────────────────────

function OverviewTab({ report }: { report: Report }) {
  const verdict = report.authenticity_verdict;
  const identification = report.identification;
  const market = report.market_valuation;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      {/* Identification Card */}
      {identification && (
        <div style={{ ...frostedCard, padding: spacing.lg }}>
          <div style={{ fontSize: font.size.sm, color: colors.textMuted, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Identified As
          </div>
          <div style={{ fontSize: font.size.xl, fontWeight: font.weight.semibold, color: colors.textPrimary }}>
            {identification.brand} {identification.model || ''}
          </div>
          {identification.colorway && (
            <div style={{ fontSize: font.size.sm, color: colors.textSecondary, marginTop: 4 }}>
              {identification.colorway}{identification.size ? ` · Size ${identification.size}` : ''}
              {identification.condition ? ` · ${identification.condition}` : ''}
            </div>
          )}
          <ConfidenceMeter value={identification.confidence} label="Identification Confidence" />
        </div>
      )}

      {/* Verdict + Market Summary side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: verdict && market ? '1fr 1fr' : '1fr', gap: spacing.md }}>
        {/* Verdict Card */}
        {verdict && (
          <div style={{
            ...frostedCard, padding: spacing.lg,
            borderLeft: `4px solid ${verdictColor(verdict.verdict)}`,
          }}>
            <div style={{ fontSize: font.size.sm, color: colors.textMuted, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Authenticity Verdict
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: spacing.sm,
            }}>
              <span style={{ fontSize: 28 }}>{verdictEmoji(verdict.verdict)}</span>
              <div>
                <div style={{
                  fontSize: font.size.lg, fontWeight: font.weight.semibold,
                  color: verdictColor(verdict.verdict),
                }}>
                  {verdict.verdict.replace(/_/g, ' ')}
                </div>
                <div style={{ fontSize: font.size.xs, color: colors.textSecondary }}>
                  {(verdict.confidence * 100).toFixed(0)}% confidence · {verdict.risk_level} risk
                </div>
              </div>
            </div>
            {verdict.veto_triggered && verdict.veto_reason && (
              <div style={{
                marginTop: spacing.sm, padding: spacing.sm,
                background: colors.errorBg, borderRadius: radius.sm,
                fontSize: font.size.xs, color: colors.error,
              }}>
                ⚠ Forensic Veto: {verdict.veto_reason}
              </div>
            )}
          </div>
        )}

        {/* Market Position Card */}
        {market && (
          <div style={{ ...frostedCard, padding: spacing.lg }}>
            <div style={{ fontSize: font.size.sm, color: colors.textMuted, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Market Position
            </div>
            <div style={{
              fontSize: font.size.lg, fontWeight: font.weight.semibold,
              color: market.price_position === 'Below Market' ? colors.success
                : market.price_position === 'Above Market' ? colors.error
                : colors.textPrimary,
            }}>
              {market.price_position}
            </div>
            {market.price_percentile !== undefined && market.price_percentile !== null && (
              <div style={{ fontSize: font.size.xs, color: colors.textSecondary, marginTop: 4 }}>
                {market.price_percentile}th percentile
              </div>
            )}
            <ConfidenceMeter value={market.confidence} label="Market Confidence" />
          </div>
        )}
      </div>

      {/* Errors */}
      {report.errors.length > 0 && (
        <div style={{
          padding: spacing.md, background: colors.warningBg,
          border: `1px solid rgba(217,119,6,0.2)`, borderRadius: radius.md,
        }}>
          <div style={{ fontSize: font.size.sm, fontWeight: font.weight.semibold, color: colors.warning, marginBottom: 4 }}>
            ⚠ Pipeline Warnings
          </div>
          {report.errors.map((err, i) => (
            <div key={i} style={{ fontSize: font.size.xs, color: colors.textSecondary }}>{err}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Auth Tab ────────────────────────────────────────────────────────────────

function AuthTab({ report }: { report: Report }) {
  const evals = report.authenticity_evaluation?.evaluations || [];
  const verdict = report.authenticity_verdict;

  const criticalEvals = evals.filter((e) => e.weight === 'CRITICAL');
  const supportingEvals = evals.filter((e) => e.weight === 'SUPPORTING');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      {/* Summary Stats */}
      {verdict && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: spacing.sm,
        }}>
          <StatCard
            label="Critical Markers"
            pass={verdict.critical_pass} fail={verdict.critical_fail}
            unverifiable={verdict.critical_unverifiable}
          />
          <StatCard
            label="Supporting Markers"
            pass={verdict.supporting_pass} fail={verdict.supporting_fail}
            unverifiable={verdict.supporting_unverifiable}
          />
          <div style={{ ...frostedCard, padding: spacing.md, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
            <div style={{ fontSize: font.size.xs, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Photos Analyzed
            </div>
            <div style={{ fontSize: font.size['2xl'], fontWeight: font.weight.bold, color: colors.textPrimary, marginTop: 4 }}>
              {report.authenticity_evaluation?.photos_analyzed || 0}
            </div>
          </div>
        </div>
      )}

      {/* Critical Markers */}
      {criticalEvals.length > 0 && (
        <div>
          <h3 style={{ fontSize: font.size.sm, fontWeight: font.weight.semibold, color: colors.textPrimary, margin: 0, marginBottom: spacing.sm }}>
            🔴 Critical Markers
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {criticalEvals.map((ev, i) => (
              <MarkerRow key={i} eval={ev} />
            ))}
          </div>
        </div>
      )}

      {/* Supporting Markers */}
      {supportingEvals.length > 0 && (
        <div>
          <h3 style={{ fontSize: font.size.sm, fontWeight: font.weight.semibold, color: colors.textPrimary, margin: 0, marginBottom: spacing.sm }}>
            🔵 Supporting Markers
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {supportingEvals.map((ev, i) => (
              <MarkerRow key={i} eval={ev} />
            ))}
          </div>
        </div>
      )}

      {/* Verdict Reasoning */}
      {verdict?.reasoning && (
        <div style={{ ...frostedCard, padding: spacing.lg }}>
          <div style={{ fontSize: font.size.sm, fontWeight: font.weight.semibold, color: colors.textPrimary, marginBottom: spacing.sm }}>
            Forensic Reasoning
          </div>
          <p style={{ fontSize: font.size.sm, color: colors.textSecondary, lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap' }}>
            {verdict.reasoning}
          </p>
        </div>
      )}

      {evals.length === 0 && (
        <div style={{ textAlign: 'center', color: colors.textMuted, padding: spacing['3xl'] }}>
          No authenticity data available for this analysis.
        </div>
      )}
    </div>
  );
}

// ─── Market Tab ──────────────────────────────────────────────────────────────

function MarketTab({ report }: { report: Report }) {
  const market = report.market_valuation;
  if (!market) {
    return (
      <div style={{ textAlign: 'center', color: colors.textMuted, padding: spacing['3xl'] }}>
        No market data available for this analysis.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      {/* Price Position */}
      <div style={{ ...frostedCard, padding: spacing.lg }}>
        <div style={{ fontSize: font.size.sm, color: colors.textMuted, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Price Analysis
        </div>
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: spacing.md,
        }}>
          <span style={{ fontSize: font.size['2xl'], fontWeight: font.weight.bold, color: colors.textPrimary }}>
            £{report.listing_price_gbp.toFixed(2)}
          </span>
          <span style={{
            ...badge(
              market.price_position === 'Below Market' ? colors.successBg : market.price_position === 'Above Market' ? colors.errorBg : colors.infoBg,
              market.price_position === 'Below Market' ? colors.success : market.price_position === 'Above Market' ? colors.error : colors.info,
            ),
            fontSize: font.size.sm,
            padding: '4px 12px',
          }}>
            {market.price_position}
          </span>
        </div>
        {market.market_velocity && (
          <div style={{ fontSize: font.size.sm, color: colors.textSecondary, marginTop: spacing.sm }}>
            Market Velocity: {market.market_velocity}
          </div>
        )}
      </div>

      {/* Profit Estimates Table */}
      {market.profit_estimates.length > 0 && (
        <div style={{ ...frostedCard, overflow: 'hidden' }}>
          <div style={{ padding: `${spacing.md}px ${spacing.lg}px`, borderBottom: `1px solid ${colors.separator}` }}>
            <div style={{ fontSize: font.size.sm, fontWeight: font.weight.semibold, color: colors.textPrimary }}>
              Profit Estimates by Platform
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F5F5F5' }}>
                {['Platform', 'Sell Price', 'Fees', 'Net Revenue', 'Profit', 'ROI'].map((h) => (
                  <th key={h} style={{
                    padding: '10px 14px', textAlign: 'left', fontSize: font.size.xs,
                    fontWeight: font.weight.semibold, color: colors.textSecondary,
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                    borderBottom: `1px solid ${colors.separator}`,
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {market.profit_estimates.map((pe) => (
                <tr key={pe.platform} style={{ borderBottom: `1px solid ${colors.separator}` }}>
                  <td style={{ padding: '10px 14px', fontSize: font.size.sm, fontWeight: font.weight.semibold, color: colors.textPrimary, textTransform: 'capitalize' }}>
                    {pe.platform}
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: font.size.sm, color: colors.textPrimary }}>
                    £{pe.sell_price_gbp.toFixed(2)}
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: font.size.sm, color: colors.textSecondary }}>
                    £{pe.fees_gbp.toFixed(2)}
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: font.size.sm, color: colors.textPrimary }}>
                    £{pe.net_revenue_gbp.toFixed(2)}
                  </td>
                  <td style={{
                    padding: '10px 14px', fontSize: font.size.sm,
                    fontWeight: font.weight.semibold,
                    color: pe.profit_gbp >= 0 ? colors.success : colors.error,
                  }}>
                    {pe.profit_gbp >= 0 ? '+' : ''}£{pe.profit_gbp.toFixed(2)}
                  </td>
                  <td style={{
                    padding: '10px 14px', fontSize: font.size.sm,
                    color: pe.roi_pct >= 0 ? colors.success : colors.error,
                  }}>
                    {pe.roi_pct >= 0 ? '+' : ''}{pe.roi_pct.toFixed(0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Market Analysis Reasoning */}
      {market.reasoning && (
        <div style={{ ...frostedCard, padding: spacing.lg }}>
          <div style={{ fontSize: font.size.sm, fontWeight: font.weight.semibold, color: colors.textPrimary, marginBottom: spacing.sm }}>
            Market Analysis
          </div>
          <p style={{ fontSize: font.size.sm, color: colors.textSecondary, lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap' }}>
            {market.reasoning}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ConfidenceMeter({ value, label }: { value: number; label: string }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? colors.success : pct >= 50 ? colors.warning : colors.error;

  return (
    <div style={{ marginTop: spacing.md }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: font.size.xs, color: colors.textMuted }}>{label}</span>
        <span style={{ fontSize: font.size.xs, fontWeight: font.weight.semibold, color }}>{pct}%</span>
      </div>
      <div style={{ height: 4, background: 'rgba(0,0,0,0.06)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`, background: color,
          borderRadius: 2, transition: 'width 0.5s ease',
        }} />
      </div>
    </div>
  );
}

function MarkerRow({ eval: ev }: { eval: MarkerEval }) {
  const [expanded, setExpanded] = useState(false);
  const icon = ev.result === 'PASS' ? '✅' : ev.result === 'FAIL' ? '❌' : '👁️';
  const resultColor = ev.result === 'PASS' ? colors.success : ev.result === 'FAIL' ? colors.error : colors.textMuted;

  return (
    <div
      style={{
        ...frostedCard,
        padding: `${spacing.sm}px ${spacing.md}px`,
        cursor: 'pointer',
        transition: transition.fast,
        borderLeft: `3px solid ${resultColor}`,
      }}
      onClick={() => setExpanded(!expanded)}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
          <span style={{ fontSize: 14 }}>{icon}</span>
          <span style={{ fontSize: font.size.sm, fontWeight: font.weight.medium, color: colors.textPrimary }}>
            {ev.marker_name}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
          <span style={{ fontSize: font.size.xs, color: colors.textMuted }}>
            {Math.round(ev.vision_confidence * 100)}%
          </span>
          <span style={{ fontSize: 10, color: colors.textMuted }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>
      {expanded && (
        <div style={{
          marginTop: spacing.sm, paddingTop: spacing.sm,
          borderTop: `1px solid ${colors.separator}`,
          fontSize: font.size.xs, color: colors.textSecondary, lineHeight: 1.6,
        }}>
          {ev.observation}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label, pass, fail, unverifiable,
}: { label: string; pass: number; fail: number; unverifiable: number }) {
  return (
    <div style={{ ...frostedCard, padding: spacing.md }}>
      <div style={{ fontSize: font.size.xs, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: spacing.sm }}>
        {label}
      </div>
      <div style={{ display: 'flex', gap: spacing.sm }}>
        <span style={{ ...badge(colors.successBg, colors.success) }}>✅ {pass}</span>
        <span style={{ ...badge(colors.errorBg, colors.error) }}>❌ {fail}</span>
        <span style={{ ...badge('rgba(0,0,0,0.04)', colors.textMuted) }}>👁 {unverifiable}</span>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function verdictColor(verdict: string): string {
  switch (verdict.toLowerCase()) {
    case 'authentic': return colors.success;
    case 'likely_authentic': return '#059669';
    case 'inconclusive': return colors.warning;
    case 'likely_counterfeit': return '#EA580C';
    case 'counterfeit': return colors.error;
    default: return colors.textMuted;
  }
}

function verdictEmoji(verdict: string): string {
  switch (verdict.toLowerCase()) {
    case 'authentic': return '✅';
    case 'likely_authentic': return '🟢';
    case 'inconclusive': return '🟡';
    case 'likely_counterfeit': return '🟠';
    case 'counterfeit': return '🔴';
    default: return '⚪';
  }
}
