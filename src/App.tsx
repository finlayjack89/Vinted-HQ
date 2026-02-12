/**
 * Root React component — Vinted UK Sniper
 */

import React, { useState } from 'react';
import Settings from './components/Settings';

type Tab = 'feed' | 'settings';

export default function App() {
  const [tab, setTab] = useState<Tab>('settings');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <header
        style={{
          padding: '12px 24px',
          borderBottom: '1px solid #ddd',
          display: 'flex',
          alignItems: 'center',
          gap: 24,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 18 }}>Vinted UK Sniper</h1>
        <nav style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => setTab('feed')}
            style={{
              padding: '8px 16px',
              cursor: 'pointer',
              background: tab === 'feed' ? '#f0f0f0' : 'transparent',
              border: '1px solid #ccc',
              borderRadius: 4,
            }}
          >
            Feed
          </button>
          <button
            type="button"
            onClick={() => setTab('settings')}
            style={{
              padding: '8px 16px',
              cursor: 'pointer',
              background: tab === 'settings' ? '#f0f0f0' : 'transparent',
              border: '1px solid #ccc',
              borderRadius: 4,
            }}
          >
            Settings
          </button>
        </nav>
      </header>

      <main style={{ flex: 1 }}>
        {tab === 'feed' && (
          <div style={{ padding: 24 }}>
            <p style={{ color: '#666' }}>Feed coming in Phase 3. Add search URLs in Settings first.</p>
          </div>
        )}
        {tab === 'settings' && <Settings />}
      </main>
    </div>
  );
}
