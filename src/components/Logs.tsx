/**
 * Log viewer — browse logs with filters, export
 */

import React, { useEffect, useState } from 'react';
import type { LogEntry } from '../types/global';

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          style={{ padding: 8, minWidth: 120 }}
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
          style={{ padding: 8, width: 180 }}
        />
        <button type="button" onClick={loadLogs} style={{ padding: '8px 16px', cursor: 'pointer' }}>
          Refresh
        </button>
        <button type="button" onClick={handleExport} style={{ padding: '8px 16px', cursor: 'pointer' }}>
          Export JSON
        </button>
      </div>

      {loading ? (
        <p style={{ color: '#666' }}>Loading...</p>
      ) : (
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 220px)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f5f5f5', position: 'sticky', top: 0 }}>
                <th style={{ padding: 8, textAlign: 'left', borderBottom: '1px solid #ddd' }}>Time</th>
                <th style={{ padding: 8, textAlign: 'left', borderBottom: '1px solid #ddd' }}>Level</th>
                <th style={{ padding: 8, textAlign: 'left', borderBottom: '1px solid #ddd' }}>Event</th>
                <th style={{ padding: 8, textAlign: 'left', borderBottom: '1px solid #ddd' }}>Payload</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: 8, whiteSpace: 'nowrap', color: '#666' }}>{formatTime(log.created_at)}</td>
                  <td style={{ padding: 8 }}>
                    <span
                      style={{
                        padding: '2px 6px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 600,
                        background:
                          log.level === 'ERROR'
                            ? '#fee'
                            : log.level === 'WARN'
                              ? '#fef3cd'
                              : log.level === 'INFO'
                                ? '#e3f2fd'
                                : '#f5f5f5',
                      }}
                    >
                      {log.level}
                    </span>
                  </td>
                  <td style={{ padding: 8 }}>{log.event}</td>
                  <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 12, overflow: 'hidden', maxWidth: 400 }}>
                    {log.payload ? (
                      <span title={log.payload}>{log.payload.length > 80 ? log.payload.slice(0, 80) + '…' : log.payload}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {logs.length === 0 && !loading && <p style={{ color: '#999' }}>No logs yet.</p>}
    </div>
  );
}
