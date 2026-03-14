/**
 * Proxy Status — live tracker showing health of all proxies.
 * Dark glass table with color-coded status badges, provider info, and cooldown timers.
 */

import React, { useEffect, useState, useRef } from 'react';
import {
  colors,
  font,
  glassPanel,
  glassTable,
  tableHeader,
  tableHeaderCell,
  tableCell,
  tableRowHoverBg,
  badge,
  radius,
  spacing,
  transition,
  btnSecondary,
  btnSmall,
  btnDanger,
} from '../theme';
import type { ProxyStatusEntry } from '../types/global';

/* ─── Status config ──────────────────────────────────────────── */

const statusConfig: Record<string, { bg: string; fg: string; label: string }> = {
  active: { bg: colors.successBg, fg: colors.success, label: 'Active' },
  cooldown: { bg: colors.warningBg, fg: colors.warning, label: 'Cooldown' },
  blocked: { bg: colors.errorBg, fg: colors.error, label: 'Blocked' },
};

/* ─── Pulsing dot for active status ──────────────────────────── */

const PulsingDot = ({ color }: { color: string }) => (
  <span
    style={{
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: color,
      display: 'inline-block',
      flexShrink: 0,
      boxShadow: `0 0 6px ${color}`,
      animation: color === colors.success ? 'pulse 2s ease-in-out infinite' : undefined,
    }}
  />
);

/* ─── Format time ago ────────────────────────────────────────── */

function timeAgo(ts: number | null): string {
  if (!ts) return '—';
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatCooldown(seconds: number): string {
  if (seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/* ─── Component ──────────────────────────────────────────────── */

export default function ProxyStatus() {
  const [proxies, setProxies] = useState<ProxyStatusEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadStatus = async () => {
    const data = await window.vinted.getProxyStatus();
    setProxies(data);
    setLoading(false);
  };

  useEffect(() => {
    loadStatus();
    // Refresh every 2 seconds for live cooldown timers
    intervalRef.current = setInterval(loadStatus, 2000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const handleUnblock = async (proxy: string) => {
    await window.vinted.unblockProxy(proxy);
    loadStatus();
  };

  // Separate by pool
  const scrapingProxies = proxies.filter((p) => p.pool === 'scraping');
  const checkoutProxies = proxies.filter((p) => p.pool === 'checkout');

  // Summary stats
  const activeCount = scrapingProxies.filter((p) => p.status === 'active').length;
  const cooldownCount = scrapingProxies.filter((p) => p.status === 'cooldown').length;
  const blockedCount = scrapingProxies.filter((p) => p.status === 'blocked').length;

  return (
    <div style={{ padding: spacing['2xl'], display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      {/* Summary bar */}
      <div
        style={{
          ...glassPanel,
          padding: `${spacing.lg}px ${spacing.xl}px`,
          display: 'flex',
          gap: spacing.xl,
          alignItems: 'center',
          borderRadius: radius.lg,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PulsingDot color={activeCount > 0 ? colors.success : colors.error} />
          <span style={{ fontSize: font.size.base, fontWeight: font.weight.semibold, color: colors.textPrimary }}>
            Proxy Health
          </span>
        </div>
        <div style={{ display: 'flex', gap: spacing.lg, marginLeft: 'auto' }}>
          <span style={badge(colors.successBg, colors.success)}>
            {activeCount} Active
          </span>
          {cooldownCount > 0 && (
            <span style={badge(colors.warningBg, colors.warning)}>
              {cooldownCount} Cooldown
            </span>
          )}
          {blockedCount > 0 && (
            <span style={badge(colors.errorBg, colors.error)}>
              {blockedCount} Blocked
            </span>
          )}
          <button
            type="button"
            onClick={loadStatus}
            style={{ ...btnSecondary, ...btnSmall }}
          >
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <p style={{ color: colors.textMuted, padding: spacing.xl }} className="animate-pulse">
          Loading proxy status...
        </p>
      ) : (
        <>
          {/* Scraping Proxies */}
          <div>
            <h3
              style={{
                fontSize: font.size.lg,
                fontWeight: font.weight.semibold,
                color: colors.textPrimary,
                margin: `0 0 ${spacing.sm}px`,
              }}
            >
              Scraping Proxies
            </h3>
            <p style={{ fontSize: font.size.sm, color: colors.textMuted, margin: `0 0 ${spacing.md}px` }}>
              Used for feed polling. Escalating cooldown: Strike 1 = 5 min, Strike 2 = 15 min, Strike 3+ = Blocked.
            </p>
            {scrapingProxies.length === 0 ? (
              <div
                style={{
                  ...glassPanel,
                  padding: spacing['3xl'],
                  textAlign: 'center',
                  color: colors.textMuted,
                }}
              >
                No scraping proxies configured. Add proxies in Settings.
              </div>
            ) : (
              <div style={{ ...glassTable, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: font.size.md }}>
                  <thead>
                    <tr style={tableHeader}>
                      <th style={tableHeaderCell}>Status</th>
                      <th style={tableHeaderCell}>Provider</th>
                      <th style={tableHeaderCell}>Host</th>
                      <th style={tableHeaderCell}>Port</th>
                      <th style={tableHeaderCell}>Strikes</th>
                      <th style={tableHeaderCell}>Cooldown</th>
                      <th style={tableHeaderCell}>Last Forbidden</th>
                      <th style={tableHeaderCell}>Last Success</th>
                      <th style={tableHeaderCell}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scrapingProxies.map((p) => {
                      const sc = statusConfig[p.status];
                      return (
                        <tr
                          key={p.proxy}
                          style={{ transition: transition.fast }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = tableRowHoverBg;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                          }}
                        >
                          {/* Status */}
                          <td style={tableCell}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <PulsingDot color={sc.fg} />
                              <span style={badge(sc.bg, sc.fg)}>{sc.label}</span>
                            </div>
                          </td>
                          {/* Provider */}
                          <td style={{ ...tableCell, fontWeight: font.weight.medium, color: colors.textPrimary }}>
                            {p.provider}
                          </td>
                          {/* Host */}
                          <td
                            style={{
                              ...tableCell,
                              fontFamily: font.mono,
                              fontSize: font.size.sm,
                              color: colors.textSecondary,
                            }}
                          >
                            {p.host}
                          </td>
                          {/* Port */}
                          <td
                            style={{
                              ...tableCell,
                              fontFamily: font.mono,
                              fontSize: font.size.sm,
                              fontWeight: font.weight.semibold,
                              color: colors.primary,
                            }}
                          >
                            {p.port}
                          </td>
                          {/* Strikes */}
                          <td style={tableCell}>
                            <StrikeIndicator strikes={p.strikes} />
                          </td>
                          {/* Cooldown */}
                          <td
                            style={{
                              ...tableCell,
                              fontFamily: font.mono,
                              fontSize: font.size.sm,
                              fontVariantNumeric: 'tabular-nums',
                              color: p.cooldownRemaining > 0 ? colors.warning : colors.textMuted,
                            }}
                          >
                            {p.status === 'blocked'
                              ? '—'
                              : p.cooldownRemaining > 0
                                ? formatCooldown(p.cooldownRemaining)
                                : '—'}
                          </td>
                          {/* Last Forbidden */}
                          <td
                            style={{
                              ...tableCell,
                              fontSize: font.size.sm,
                              color: p.lastForbiddenAt ? colors.error : colors.textMuted,
                            }}
                          >
                            {timeAgo(p.lastForbiddenAt)}
                          </td>
                          {/* Last Success */}
                          <td
                            style={{
                              ...tableCell,
                              fontSize: font.size.sm,
                              color: p.lastSuccessAt ? colors.success : colors.textMuted,
                            }}
                          >
                            {timeAgo(p.lastSuccessAt)}
                          </td>
                          {/* Actions */}
                          <td style={tableCell}>
                            {p.status === 'blocked' && (
                              <button
                                type="button"
                                onClick={() => handleUnblock(p.proxy)}
                                style={{
                                  ...btnDanger,
                                  ...btnSmall,
                                  fontSize: font.size.xs,
                                  padding: '4px 10px',
                                }}
                              >
                                Unblock
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Checkout Proxies */}
          {checkoutProxies.length > 0 && (
            <div>
              <h3
                style={{
                  fontSize: font.size.lg,
                  fontWeight: font.weight.semibold,
                  color: colors.textPrimary,
                  margin: `0 0 ${spacing.sm}px`,
                }}
              >
                Checkout Proxies
              </h3>
              <p style={{ fontSize: font.size.sm, color: colors.textMuted, margin: `0 0 ${spacing.md}px` }}>
                Residential proxies for checkout/payment operations. Not subject to scraping cooldowns.
              </p>
              <div style={{ ...glassTable, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: font.size.md }}>
                  <thead>
                    <tr style={tableHeader}>
                      <th style={tableHeaderCell}>Status</th>
                      <th style={tableHeaderCell}>Provider</th>
                      <th style={tableHeaderCell}>Host</th>
                      <th style={tableHeaderCell}>Port</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checkoutProxies.map((p) => (
                      <tr
                        key={p.proxy}
                        style={{ transition: transition.fast }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = tableRowHoverBg;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        <td style={tableCell}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <PulsingDot color={colors.success} />
                            <span style={badge(colors.successBg, colors.success)}>Active</span>
                          </div>
                        </td>
                        <td style={{ ...tableCell, fontWeight: font.weight.medium, color: colors.textPrimary }}>
                          {p.provider}
                        </td>
                        <td
                          style={{
                            ...tableCell,
                            fontFamily: font.mono,
                            fontSize: font.size.sm,
                            color: colors.textSecondary,
                          }}
                        >
                          {p.host}
                        </td>
                        <td
                          style={{
                            ...tableCell,
                            fontFamily: font.mono,
                            fontSize: font.size.sm,
                            fontWeight: font.weight.semibold,
                            color: colors.primary,
                          }}
                        >
                          {p.port}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ─── Strike indicator (visual dots) ────────────────────────── */

function StrikeIndicator({ strikes }: { strikes: number }) {
  const maxDots = 3;
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      {Array.from({ length: maxDots }).map((_, i) => {
        const filled = i < strikes;
        const color = strikes >= 3 ? colors.error : strikes === 2 ? colors.warning : colors.warning;
        return (
          <span
            key={i}
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: filled ? color : 'rgba(255, 255, 255, 0.08)',
              border: filled ? 'none' : `1px solid rgba(255, 255, 255, 0.12)`,
              transition: transition.fast,
            }}
          />
        );
      })}
      {strikes > 0 && (
        <span
          style={{
            fontSize: font.size.xs,
            color: strikes >= 3 ? colors.error : colors.warning,
            marginLeft: 4,
            fontWeight: font.weight.medium,
          }}
        >
          {strikes >= 3 ? `${strikes}` : `${strikes}/3`}
        </span>
      )}
    </div>
  );
}
