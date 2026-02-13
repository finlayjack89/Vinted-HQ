/**
 * Purchase history — view completed purchases
 * Dark glass table matching Logs style
 */

import React, { useEffect, useState } from 'react';
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
  spacing,
  transition,
} from '../theme';
import type { Purchase } from '../types/global';

export default function Purchases() {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const data = await window.vinted.getPurchases(100);
      setPurchases(data);
      setLoading(false);
    };
    load();
  }, []);

  const formatTime = (ts: number) => {
    const d = new Date(ts * 1000);
    return d.toLocaleString();
  };

  /* ─── Status styling ──────────────────────────────── */
  const statusColor = (status: string | null) => {
    if (!status) return colors.textMuted;
    const s = status.toLowerCase();
    if (s.includes('complete') || s.includes('success')) return colors.success;
    if (s.includes('fail') || s.includes('error') || s.includes('cancel')) return colors.error;
    if (s.includes('pending') || s.includes('process')) return colors.warning;
    return colors.textSecondary;
  };

  return (
    <div style={{ padding: spacing['2xl'], display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      {/* Page header */}
      <h2
        style={{
          fontSize: font.size['2xl'],
          fontWeight: font.weight.bold,
          color: colors.textPrimary,
          margin: 0,
          letterSpacing: '-0.02em',
        }}
      >
        Purchase History
      </h2>

      {loading ? (
        <p style={{ color: colors.textMuted, padding: spacing.xl }} className="animate-pulse">
          Loading...
        </p>
      ) : (
        <div style={{ ...glassTable, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: font.size.base }}>
            <thead>
              <tr style={tableHeader}>
                <th style={tableHeaderCell}>Date</th>
                <th style={tableHeaderCell}>Item ID</th>
                <th style={tableHeaderCell}>Amount</th>
                <th style={tableHeaderCell}>Status</th>
                <th style={tableHeaderCell}>Sniper</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => (
                <tr
                  key={p.id}
                  style={{ transition: transition.fast }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = tableRowHoverBg;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <td style={{ ...tableCell, color: colors.textMuted, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                    {formatTime(p.created_at)}
                  </td>
                  <td style={tableCell}>
                    {p.item_id ? (
                      <a
                        href={`https://www.vinted.co.uk/items/${p.item_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          color: colors.primary,
                          fontWeight: font.weight.medium,
                          transition: transition.fast,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = '#a5b4fc'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = colors.primary; }}
                      >
                        {p.item_id}
                      </a>
                    ) : (
                      <span style={{ color: colors.textMuted }}>—</span>
                    )}
                  </td>
                  <td style={{ ...tableCell, fontWeight: font.weight.semibold, color: colors.textPrimary }}>
                    {p.amount != null ? `£${p.amount}` : <span style={{ color: colors.textMuted }}>—</span>}
                  </td>
                  <td style={tableCell}>
                    {p.status ? (
                      <span style={badge(
                        statusColor(p.status) === colors.success ? colors.successBg
                          : statusColor(p.status) === colors.error ? colors.errorBg
                            : statusColor(p.status) === colors.warning ? colors.warningBg
                              : 'rgba(255,255,255,0.06)',
                        statusColor(p.status),
                      )}>
                        {p.status}
                      </span>
                    ) : (
                      <span style={{ color: colors.textMuted }}>—</span>
                    )}
                  </td>
                  <td style={{ ...tableCell, color: p.sniper_id ? colors.textPrimary : colors.textMuted }}>
                    {p.sniper_id ?? 'Manual'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {purchases.length === 0 && !loading && (
        <div style={{ ...glassPanel, padding: spacing['4xl'], textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🛒</div>
          <p style={{ color: colors.textMuted, fontSize: font.size.base, margin: 0 }}>
            No purchases yet. Complete a buy from the feed to see it here.
          </p>
        </div>
      )}
    </div>
  );
}
