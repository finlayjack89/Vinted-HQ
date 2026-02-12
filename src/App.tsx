/**
 * Root React component — Vinted UK Sniper
 */

import React, { useState, useEffect } from 'react';
import Feed from './components/Feed';
import Settings from './components/Settings';
import type { SniperCountdownParams } from './types/global';

type Tab = 'feed' | 'settings';

export default function App() {
  const [tab, setTab] = useState<Tab>('feed');
  const [countdown, setCountdown] = useState<SniperCountdownParams | null>(null);
  const [countdownSeconds, setCountdownSeconds] = useState(0);
  const [countdownDone, setCountdownDone] = useState<string | null>(null);

  useEffect(() => {
    const unsub = window.vinted.onSniperCountdown((params) => {
      setCountdown(params);
      setCountdownSeconds(params.secondsLeft);
      setCountdownDone(null);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = window.vinted.onSniperCountdownDone((params) => {
      setCountdownDone(params.message);
      setCountdown(null);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!countdownDone) return;
    const t = setTimeout(() => setCountdownDone(null), 5000);
    return () => clearTimeout(t);
  }, [countdownDone]);

  useEffect(() => {
    if (!countdown || countdownSeconds <= 0) return;
    const t = setInterval(() => {
      setCountdownSeconds((s) => {
        if (s <= 1) {
          clearInterval(t);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [countdown, countdownSeconds]);

  const handleCancelCountdown = () => {
    if (countdown) {
      window.vinted.cancelSniperCountdown(countdown.countdownId);
      setCountdown(null);
    }
  };

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

      <main style={{ flex: 1, overflow: 'auto' }}>
        {tab === 'feed' && <Feed />}
        {tab === 'settings' && <Settings />}
      </main>

      {countdown && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: '#fff',
              padding: 24,
              borderRadius: 8,
              maxWidth: 400,
              textAlign: 'center',
            }}
          >
            <h3 style={{ margin: '0 0 8px' }}>Sniper: {countdown.sniper.name}</h3>
            <p style={{ margin: '0 0 8px', fontSize: 14 }}>{countdown.item.title}</p>
            <p style={{ margin: '0 0 16px', fontWeight: 700, color: '#09f' }}>£{countdown.item.price}</p>
            <p style={{ margin: '0 0 16px', fontSize: 24, fontWeight: 700 }}>
              {countdownSeconds > 0 ? countdownSeconds : 'Buying...'}
            </p>
            <button
              type="button"
              onClick={handleCancelCountdown}
              disabled={countdownSeconds <= 0}
              style={{
                padding: '10px 24px',
                background: '#c00',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: countdownSeconds > 0 ? 'pointer' : 'default',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {countdownDone && !countdown && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#333',
            color: '#fff',
            padding: '12px 24px',
            borderRadius: 8,
            fontSize: 14,
            zIndex: 1001,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}
        >
          {countdownDone}
        </div>
      )}
    </div>
  );
}
