/**
 * Sniper tab — manage sniper rules + view simulation / purchase hits
 * Uses the existing design system (frosted panels, theme tokens, badges)
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';

import {
  colors,
  font,
  glassPanel,
  glassInput,
  btnPrimary,
  btnSecondary,
  btnSmall,
  dangerText,
  sectionTitle,
  sectionDesc,
  badge,
  radius,
  spacing,
  transition,
  frostedCard,
} from '../theme';
import type { Sniper as SniperType, SniperHit, AppSettings } from '../types/global';

/* ─── Section Wrapper ───────────────────────────────────────── */

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        ...glassPanel,
        padding: spacing['2xl'],
        marginBottom: spacing['2xl'],
      }}
    >
      <h3 style={sectionTitle}>{title}</h3>
      {description && <p style={{ ...sectionDesc, marginBottom: spacing.lg }}>{description}</p>}
      <div>{children}</div>
    </section>
  );
}

/* ─── Sniper Budget Display ─────────────────────────────────── */

function SniperSpentDisplay({ sniperId, budgetLimit }: { sniperId: number; budgetLimit: number }) {
  const [spent, setSpent] = useState<number | null>(null);
  useEffect(() => {
    window.vinted.getSniperSpent(sniperId).then(setSpent);
  }, [sniperId]);
  return (
    <span style={badge(colors.primaryMuted, colors.primary)}>
      budget £{budgetLimit} (spent: £{spent ?? '…'})
    </span>
  );
}

/* ─── Relative Time Formatter ───────────────────────────────── */

function relativeTime(epoch: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - epoch;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/* ─── Hit Card ──────────────────────────────────────────────── */

function HitCard({ hit }: { hit: SniperHit }) {
  const [hovered, setHovered] = useState(false);

  const handleOpenItem = () => {
    if (hit.url) {
      window.vinted.openExternal(hit.url);
    } else if (hit.item_id) {
      window.vinted.openExternal(`https://www.vinted.co.uk/items/${hit.item_id}`);
    }
  };

  return (
    <div
      onClick={handleOpenItem}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...frostedCard,
        display: 'flex',
        alignItems: 'center',
        gap: spacing.lg,
        padding: spacing.lg,
        cursor: 'pointer',
        transform: hovered ? 'translateY(-1px)' : 'none',
        boxShadow: hovered
          ? '0 8px 32px rgba(0, 0, 0, 0.06)'
          : '0 4px 16px rgba(0, 0, 0, 0.03)',
        transition: transition.base,
      }}
    >
      {/* Thumbnail */}
      {hit.photo_url ? (
        <img
          src={hit.photo_url}
          alt={hit.title ?? 'Item'}
          style={{
            width: 56,
            height: 56,
            borderRadius: radius.md,
            objectFit: 'cover',
            flexShrink: 0,
          }}
        />
      ) : (
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: radius.md,
            background: colors.surface,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={colors.textMuted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </div>
      )}

      {/* Details */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, marginBottom: 2 }}>
          <span
            style={{
              fontSize: font.size.base,
              fontWeight: font.weight.medium,
              color: colors.textPrimary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {hit.title || `Item #${hit.item_id}`}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
          <span style={{ fontSize: font.size.sm, fontWeight: font.weight.semibold, color: colors.primary }}>
            £{hit.price ?? '?'}
          </span>
          <span style={{ fontSize: font.size.xs, color: colors.textMuted }}>
            via {hit.sniper_name}
          </span>
          <span style={{ fontSize: font.size.xs, color: colors.textMuted }}>
            · {relativeTime(hit.created_at)}
          </span>
        </div>
      </div>

      {/* Status Badge */}
      <span
        style={badge(
          hit.simulated ? colors.warningBg : colors.successBg,
          hit.simulated ? colors.warning : colors.success,
        )}
      >
        {hit.simulated ? '🔬 Simulated' : '✓ Purchased'}
      </span>
    </div>
  );
}

/* ─── Filter Tabs ───────────────────────────────────────────── */

type HitFilter = 'all' | 'simulated' | 'purchased';

function FilterTabs({ active, onChange }: { active: HitFilter; onChange: (f: HitFilter) => void }) {
  const tabs: { key: HitFilter; label: string }[] = [
    { key: 'all', label: 'All Hits' },
    { key: 'simulated', label: 'Simulated' },
    { key: 'purchased', label: 'Purchased' },
  ];

  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: spacing.lg }}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          style={{
            padding: '6px 16px',
            borderRadius: radius.full,
            border: 'none',
            background: active === t.key ? colors.primary : 'rgba(0,0,0,0.04)',
            color: active === t.key ? '#fff' : colors.textSecondary,
            fontSize: font.size.sm,
            fontWeight: active === t.key ? font.weight.semibold : font.weight.medium,
            fontFamily: font.family,
            cursor: 'pointer',
            transition: transition.fast,
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ─── Main Export ────────────────────────────────────────────── */

export default function Sniper() {
  // ── Settings ──
  const [settings, setSettings] = useState<AppSettings | null>(null);
  // ── Snipers ──
  const [snipers, setSnipers] = useState<SniperType[]>([]);
  const [sniperName, setSniperName] = useState('');
  const [sniperPriceMax, setSniperPriceMax] = useState('');
  const [sniperKeywords, setSniperKeywords] = useState('');
  const [sniperBudget, setSniperBudget] = useState('');
  // ── Hits ──
  const [hits, setHits] = useState<SniperHit[]>([]);
  const [hitFilter, setHitFilter] = useState<HitFilter>('all');
  const [loading, setLoading] = useState(true);

  // ── Load initial data ──
  useEffect(() => {
    const load = async () => {
      const [s, sn] = await Promise.all([
        window.vinted.getSettings(),
        window.vinted.getSnipers(),
      ]);
      setSettings(s);
      setSnipers(sn);
      setLoading(false);
    };
    load();
  }, []);

  // ── Load hits when filter changes ──
  const loadHits = useCallback(async () => {
    const opts: { limit?: number; simulated?: boolean } = { limit: 200 };
    if (hitFilter === 'simulated') opts.simulated = true;
    if (hitFilter === 'purchased') opts.simulated = false;
    const h = await window.vinted.getSniperHits(opts);
    setHits(h);
  }, [hitFilter]);

  useEffect(() => {
    loadHits();
  }, [loadHits]);

  // ── Real-time hit updates ──
  useEffect(() => {
    const unsub = window.vinted.onSniperHit((hit) => {
      // Only add if it matches current filter
      if (hitFilter === 'simulated' && !hit.simulated) return;
      if (hitFilter === 'purchased' && hit.simulated) return;
      setHits((prev) => [hit, ...prev]);
    });
    return unsub;
  }, [hitFilter]);

  // ── Settings change ──
  const handleSettingsChange = async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    if (!settings) return;
    setSettings({ ...settings, [key]: value });
    await window.vinted.setSetting(key, value);
  };

  // ── Sniper CRUD ──
  const handleAddSniper = async () => {
    const name = sniperName.trim();
    if (!name) return;
    const added = await window.vinted.addSniper({
      name,
      price_max: sniperPriceMax ? parseFloat(sniperPriceMax) : undefined,
      keywords: sniperKeywords.trim() || undefined,
      budget_limit: sniperBudget ? parseFloat(sniperBudget) : 0,
    });
    if (added) {
      setSnipers((prev) => [...prev, added]);
      setSniperName('');
      setSniperPriceMax('');
      setSniperKeywords('');
      setSniperBudget('');
    }
  };

  const handleToggleSniper = async (id: number, enabled: boolean) => {
    await window.vinted.updateSniper(id, { enabled });
    setSnipers((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)));
  };

  const handleDeleteSniper = async (id: number) => {
    await window.vinted.deleteSniper(id);
    setSnipers((prev) => prev.filter((s) => s.id !== id));
  };

  const handleClearHits = async () => {
    await window.vinted.clearSniperHits();
    setHits([]);
  };

  // ── List item row style ──
  const listRow: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
    padding: `${spacing.md}px 0`,
    borderBottom: `1px solid ${colors.separator}`,
  };

  if (loading || !settings) {
    return (
      <div className="page-enter" style={{ padding: spacing['2xl'], maxWidth: 800 }}>
        <p style={{ color: colors.textMuted }}>Loading...</p>
      </div>
    );
  }

  const simulatedCount = hits.filter((h) => h.simulated).length;
  const purchasedCount = hits.filter((h) => !h.simulated).length;

  return (
    <div className="page-enter" style={{ padding: spacing['2xl'], maxWidth: 800 }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xl }}>
        <div>
          <h2
            style={{
              fontSize: font.size['2xl'],
              fontWeight: font.weight.bold,
              color: colors.textPrimary,
              margin: 0,
              letterSpacing: '-0.02em',
            }}
          >
            Sniper
          </h2>
          <p style={{ margin: `${spacing.xs}px 0 0`, color: colors.textMuted, fontSize: font.size.base }}>
            Auto-buy rules &amp; matched items
          </p>
        </div>

        {/* Status badges */}
        <div style={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap' }}>
          <span style={badge(settings.autobuyEnabled ? colors.successBg : colors.surface, settings.autobuyEnabled ? colors.success : colors.textMuted)}>
            {settings.autobuyEnabled ? '⚡ Autobuy ON' : 'Autobuy OFF'}
          </span>
          <span style={badge(settings.simulationMode ? colors.warningBg : colors.surface, settings.simulationMode ? colors.warning : colors.textMuted)}>
            {settings.simulationMode ? '🔬 Simulation' : 'Live Mode'}
          </span>
        </div>
      </div>

      {/* ─── Mode Controls ──────────────────────────────── */}
      <Section title="Mode">
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer', fontSize: font.size.base, color: colors.textSecondary }}>
            <input
              type="checkbox"
              checked={settings.autobuyEnabled}
              onChange={(e) => handleSettingsChange('autobuyEnabled', e.target.checked)}
            />
            Enable autobuy — snipers will attempt to purchase matching items
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer', fontSize: font.size.base, color: colors.textSecondary }}>
            <input
              type="checkbox"
              checked={settings.simulationMode}
              onChange={(e) => handleSettingsChange('simulationMode', e.target.checked)}
            />
            Simulation mode — log "would have bought" only, no real purchases
          </label>
          {settings.simulationMode && (
            <div
              style={{
                padding: `${spacing.md}px ${spacing.lg}px`,
                borderRadius: radius.md,
                background: colors.warningBg,
                border: `1px solid rgba(217, 119, 6, 0.15)`,
                fontSize: font.size.sm,
                color: colors.warning,
                display: 'flex',
                alignItems: 'center',
                gap: spacing.sm,
              }}
            >
              <span style={{ fontSize: 16 }}>🔬</span>
              Simulation mode is active. Matching items will appear below but nothing will be purchased on Vinted.
            </div>
          )}
        </div>
      </Section>

      {/* ─── Sniper Rules ───────────────────────────────── */}
      <Section
        title="Sniper Rules"
        description="Each rule auto-matches items by keywords and max price. Enable Autobuy above for rules to trigger."
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
          <input
            type="text"
            placeholder="Name"
            value={sniperName}
            onChange={(e) => setSniperName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddSniper()}
            style={{ ...glassInput, width: 130 }}
          />
          <input
            type="number"
            placeholder="Max £"
            value={sniperPriceMax}
            onChange={(e) => setSniperPriceMax(e.target.value)}
            style={{ ...glassInput, width: 90 }}
          />
          <input
            type="text"
            placeholder="Keywords"
            value={sniperKeywords}
            onChange={(e) => setSniperKeywords(e.target.value)}
            style={{ ...glassInput, width: 130 }}
          />
          <input
            type="number"
            placeholder="Budget £"
            value={sniperBudget}
            onChange={(e) => setSniperBudget(e.target.value)}
            style={{ ...glassInput, width: 100 }}
          />
          <button
            type="button"
            onClick={handleAddSniper}
            style={{ ...btnPrimary, ...btnSmall }}
          >
            Add sniper
          </button>
        </div>
        {snipers.length > 0 ? (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {snipers.map((s) => (
              <li key={s.id} style={listRow}>
                <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer', flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    onChange={(e) => handleToggleSniper(s.id, e.target.checked)}
                  />
                  <span style={{ fontWeight: font.weight.medium, color: colors.textPrimary }}>{s.name}</span>
                  {s.price_max != null && (
                    <span style={badge(colors.glassBg, colors.textSecondary)}>max £{s.price_max}</span>
                  )}
                  {s.keywords && (
                    <span style={badge(colors.glassBg, colors.textSecondary)}>"{s.keywords}"</span>
                  )}
                  {s.budget_limit > 0 && (
                    <SniperSpentDisplay sniperId={s.id} budgetLimit={s.budget_limit} />
                  )}
                </label>
                <button
                  type="button"
                  onClick={() => handleDeleteSniper(s.id)}
                  style={dangerText}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ color: colors.textMuted, fontSize: font.size.sm, margin: 0 }}>
            No sniper rules configured. Add one above.
          </p>
        )}
      </Section>

      {/* ─── Sniper Hits ────────────────────────────────── */}
      <Section title="Matched Items">
        {/* Summary stats */}
        <div style={{ display: 'flex', gap: spacing.lg, marginBottom: spacing.lg, flexWrap: 'wrap' }}>
          <div
            style={{
              flex: 1,
              minWidth: 140,
              padding: spacing.lg,
              borderRadius: radius.lg,
              background: colors.warningBg,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: font.size['2xl'], fontWeight: font.weight.bold, color: colors.warning }}>
              {simulatedCount}
            </div>
            <div style={{ fontSize: font.size.xs, color: colors.textMuted, marginTop: 2 }}>Simulated</div>
          </div>
          <div
            style={{
              flex: 1,
              minWidth: 140,
              padding: spacing.lg,
              borderRadius: radius.lg,
              background: colors.successBg,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: font.size['2xl'], fontWeight: font.weight.bold, color: colors.success }}>
              {purchasedCount}
            </div>
            <div style={{ fontSize: font.size.xs, color: colors.textMuted, marginTop: 2 }}>Purchased</div>
          </div>
        </div>

        {/* Filter + Clear */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
          <FilterTabs active={hitFilter} onChange={setHitFilter} />
          {hits.length > 0 && (
            <button
              type="button"
              onClick={handleClearHits}
              style={{ ...btnSecondary, ...btnSmall, color: colors.error, borderColor: 'rgba(220,38,38,0.15)' }}
            >
              Clear all
            </button>
          )}
        </div>

        {/* Hit list */}
        {hits.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
            {hits.map((hit) => (
              <HitCard key={hit.id} hit={hit} />
            ))}
          </div>
        ) : (
          <div
            style={{
              textAlign: 'center',
              padding: `${spacing['3xl']}px ${spacing.xl}px`,
              color: colors.textMuted,
              fontSize: font.size.base,
            }}
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={colors.textMuted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: spacing.md, opacity: 0.5 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="16" />
              <line x1="8" y1="12" x2="16" y2="12" />
            </svg>
            <p style={{ margin: 0 }}>No matched items yet.</p>
            <p style={{ margin: `${spacing.xs}px 0 0`, fontSize: font.size.sm }}>
              {settings.autobuyEnabled
                ? 'Waiting for feed items that match your sniper rules...'
                : 'Enable Autobuy to start matching items.'}
            </p>
          </div>
        )}
      </Section>
    </div>
  );
}
