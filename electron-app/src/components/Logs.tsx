/**
 * Log viewer — browse logs with filters, export
 * Dark glass table with colored level badges
 */

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  colors,
  font,
  glassPanel,
  recessedInput,
  glassSelect,
  btnSecondary,
  btnSmall,
  glassTable,
  tableHeader,
  tableHeaderCell,
  tableCell,
  tableRowHoverBg,
  badge,
  radius,
  spacing,
  transition,
  springResponsive,
  staggerFast,
} from '../theme';
import GlassSkeleton from './GlassSkeleton';
import type { LogEntry } from '../types/global';

/* ─── Level badge config ────────────────────────────────────── */

const levelColors: Record<string, { bg: string; fg: string }> = {
  ERROR: { bg: colors.errorBg, fg: colors.error },
  WARN: { bg: colors.warningBg, fg: colors.warning },
  INFO: { bg: colors.infoBg, fg: colors.info },
  DEBUG: { bg: '#F5F5F5', fg: colors.textSecondary },
};

export default function Logs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [level, setLevel] = useState('');
  const [eventFilter, setEventFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const loadLogs = async () => {
    setLoading(true);
    const opts: Parameters<typeof window.vinted.getLogs>[0] = { limit: 200 };
    if (level) opts.level = level;
    if (eventFilter) opts.event = eventFilter;
    const data = await window.vinted.getLogs(opts);
    setLogs(data);
    setLoading(false);
  };

  useEffect(() => {
    loadLogs();
    const interval = setInterval(loadLogs, 5000);
    return () => clearInterval(interval);
  }, [level, eventFilter]);

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vinted-logs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts * 1000);
    return d.toLocaleString();
  };

  return (
    <div style={{ padding: spacing['2xl'], display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      {/* Filter bar */}
      <div
        style={{
          ...glassPanel,
          padding: `${spacing.md}px ${spacing.xl}px`,
          display: 'flex',
          gap: spacing.md,
          flexWrap: 'wrap',
          alignItems: 'center',
          borderRadius: radius.lg,
        }}
      >
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          style={{ ...glassSelect, minWidth: 130 }}
        >
          <option value="">All levels</option>
          <option value="DEBUG">DEBUG</option>
          <option value="INFO">INFO</option>
          <option value="WARN">WARN</option>
          <option value="ERROR">ERROR</option>
        </select>
        <input
          type="text"
          placeholder="Filter by event"
          value={eventFilter}
          onChange={(e) => setEventFilter(e.target.value)}
          style={{ ...recessedInput, width: 200 }}
        />
        <button
          type="button"
          onClick={loadLogs}
          style={{ ...btnSecondary, ...btnSmall }}
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={handleExport}
          style={{ ...btnSecondary, ...btnSmall }}
        >
          Export JSON
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ padding: spacing.xl }}>
          <GlassSkeleton height={40} count={8} borderRadius={radius.md} />
        </div>
      ) : (
        <div style={{ ...glassTable, overflow: 'auto', maxHeight: 'calc(100vh - 180px)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: font.size.md }}>
            <thead>
              <tr style={tableHeader}>
                <th style={tableHeaderCell}>Time</th>
                <th style={tableHeaderCell}>Level</th>
                <th style={tableHeaderCell}>Event</th>
                <th style={tableHeaderCell}>Payload</th>
              </tr>
            </thead>
            <motion.tbody
              initial="hidden"
              animate="visible"
              variants={{
                hidden: {},
                visible: { transition: staggerFast },
              }}
            >
              {logs.map((log) => {
                const lc = levelColors[log.level] || levelColors.DEBUG;
                return (
                  <motion.tr
                    key={log.id}
                    variants={{
                      hidden: { opacity: 0, y: 10 },
                      visible: { opacity: 1, y: 0 },
                    }}
                    transition={springResponsive}
                    style={{ transition: transition.fast }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = tableRowHoverBg;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <td style={{ ...tableCell, whiteSpace: 'nowrap', color: colors.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
                      {formatTime(log.created_at)}
                    </td>
                    <td style={tableCell}>
                      <span style={badge(lc.bg, lc.fg)}>
                        {log.level}
                      </span>
                    </td>
                    <td style={{ ...tableCell, color: colors.textPrimary }}>{log.event}</td>
                    <td
                      style={{
                        ...tableCell,
                        fontFamily: font.mono,
                        fontSize: font.size.sm,
                        color: colors.textMuted,
                        maxWidth: 400,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {log.payload ? (
                        <span title={log.payload}>
                          {log.payload.length > 80 ? log.payload.slice(0, 80) + '…' : log.payload}
                        </span>
                      ) : (
                        <span style={{ color: colors.textMuted }}>—</span>
                      )}
                    </td>
                  </motion.tr>
                );
              })}
            </motion.tbody>
          </table>
        </div>
      )}
      {logs.length === 0 && !loading && (
        <p style={{ color: colors.textMuted, textAlign: 'center', padding: spacing['3xl'] }}>
          No logs yet.
        </p>
      )}
    </div>
  );
}
