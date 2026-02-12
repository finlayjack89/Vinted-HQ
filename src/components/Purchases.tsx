/**
 * Purchase history — view completed purchases
 */

import React, { useEffect, useState } from 'react';
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

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ marginTop: 0 }}>Purchase History</h2>

      {loading ? (
        <p style={{ color: '#666' }}>Loading...</p>
      ) : (
        <div style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#f5f5f5' }}>
                <th style={{ padding: 10, textAlign: 'left', borderBottom: '1px solid #ddd' }}>Date</th>
                <th style={{ padding: 10, textAlign: 'left', borderBottom: '1px solid #ddd' }}>Item ID</th>
                <th style={{ padding: 10, textAlign: 'left', borderBottom: '1px solid #ddd' }}>Amount</th>
                <th style={{ padding: 10, textAlign: 'left', borderBottom: '1px solid #ddd' }}>Status</th>
                <th style={{ padding: 10, textAlign: 'left', borderBottom: '1px solid #ddd' }}>Sniper</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: 10, color: '#666' }}>{formatTime(p.created_at)}</td>
                  <td style={{ padding: 10 }}>
                    {p.item_id ? (
                      <a
                        href={`https://www.vinted.co.uk/items/${p.item_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#09f' }}
                      >
                        {p.item_id}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td style={{ padding: 10 }}>£{p.amount ?? '—'}</td>
                  <td style={{ padding: 10 }}>{p.status ?? '—'}</td>
                  <td style={{ padding: 10 }}>{p.sniper_id ?? 'Manual'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {purchases.length === 0 && !loading && (
        <p style={{ color: '#999' }}>No purchases yet. Complete a buy from the feed to see it here.</p>
      )}
    </div>
  );
}
