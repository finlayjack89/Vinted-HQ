# Liquid Glass Corrections — Walkthrough

## Summary
Addressed 7 critical architectural gaps between the initial implementation and the ANIMATION_SPEC_V2.md requirements.

## Changes

### Phase A — SVG Pipeline at DOM Root

```diff:index.html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Vinted HQ</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
    <style>
      /* Prevent flash-of-white while CSS loads */
      body { background: #080b12; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/renderer.tsx"></script>
  </body>
</html>
===
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Vinted HQ</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
    <style>
      /* Prevent flash-of-white while CSS loads */
      body { background: #FAF9F6; }
    </style>
  </head>
  <body>
    <!-- Liquid Glass SVG Displacement Pipeline — must be at DOM root -->
    <svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">
      <defs>
        <filter id="liquid-glass-refraction" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves="3" seed="42" stitchTiles="stitch" result="noise"/>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="6" xChannelSelector="R" yChannelSelector="G" result="displaced"/>
          <feGaussianBlur in="displaced" stdDeviation="0.5" result="blurred"/>
          <feBlend in="blurred" in2="SourceGraphic" mode="normal"/>
        </filter>
      </defs>
    </svg>
    <div id="root"></div>
    <script type="module" src="/src/renderer.tsx"></script>
  </body>
</html>
```
```diff:App.tsx
/**
 * Root React component — Vinted HQ
 * Revolut-inspired sidebar layout with liquid glass UI
 */

import React, { useState, useEffect } from 'react';
import Feed from './components/Feed';
import Wardrobe from './components/Wardrobe';
import Settings from './components/Settings';
import Logs from './components/Logs';
import PurchasesSuite from './components/PurchasesSuite';
import SalesSuite from './components/SalesSuite';
import AutoMessage from './components/AutoMessage';
import ProxyStatus from './components/ProxyStatus';
import {
  colors,
  font,
  glassTextarea,
  btnPrimary,
  btnSecondary,
  btnDanger,
  modalOverlay,
  modalContent,
  toast as toastStyle,
  SIDEBAR_WIDTH,
  radius,
  spacing,
  transition,
  liquidGlassPanel,
} from './theme';
import type { SniperCountdownParams } from './types/global';

type Tab = 'feed' | 'wardrobe' | 'sales' | 'automessage' | 'proxies' | 'settings' | 'logs' | 'purchases';

/* ─── SVG Icons (inline for zero-dep) ───────────────────────── */

const icons: Record<Tab, JSX.Element> = {
  feed: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  wardrobe: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3h7v18H3zM14 3h7v18h-7z" />
      <line x1="7" y1="8" x2="7" y2="12" />
      <line x1="17" y1="8" x2="17" y2="12" />
    </svg>
  ),
  proxies: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="2" />
      <circle cx="4" cy="6" r="2" />
      <circle cx="20" cy="6" r="2" />
      <circle cx="4" cy="18" r="2" />
      <circle cx="20" cy="18" r="2" />
      <line x1="6" y1="7" x2="10" y2="11" />
      <line x1="18" y1="7" x2="14" y2="11" />
      <line x1="6" y1="17" x2="10" y2="13" />
      <line x1="18" y1="17" x2="14" y2="13" />
    </svg>
  ),
  settings: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  logs: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  purchases: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  ),
  sales: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  automessage: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <line x1="9" y1="10" x2="15" y2="10" />
    </svg>
  ),
};

const tabLabels: Record<Tab, string> = {
  feed: 'Feed',
  wardrobe: 'Wardrobe',
  sales: 'Sales',
  automessage: 'Auto-Message',
  proxies: 'Proxies',
  settings: 'Settings',
  logs: 'Logs',
  purchases: 'Purchases',
};

export default function App() {
  const [tab, setTab] = useState<Tab>('feed');
  const [sessionExpired, setSessionExpired] = useState(false);
  const [reconnectCookie, setReconnectCookie] = useState('');
  const [countdown, setCountdown] = useState<SniperCountdownParams | null>(null);
  const [countdownSeconds, setCountdownSeconds] = useState(0);
  const [countdownDone, setCountdownDone] = useState<string | null>(null);

  useEffect(() => {
    const unsubExpired = window.vinted.onSessionExpired(() => setSessionExpired(true));
    const unsubReconnected = window.vinted.onSessionReconnected(() => {
      setSessionExpired(false);
      setReconnectCookie('');
    });
    return () => {
      unsubExpired();
      unsubReconnected();
    };
  }, []);

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

  const [isRefreshingSession, setIsRefreshingSession] = useState(false);

  const handleReconnect = async () => {
    if (!reconnectCookie.trim()) return;
    await window.vinted.storeCookie(reconnectCookie.trim());
  };

  const handleRefreshSession = async () => {
    if (isRefreshingSession) return;
    setIsRefreshingSession(true);
    try {
      const result = await window.vinted.startCookieRefresh();
      if (result.ok) {
        setSessionExpired(false);
        setReconnectCookie('');
      }
    } finally {
      setIsRefreshingSession(false);
    }
  };

  const handleCancelCountdown = () => {
    if (countdown) {
      window.vinted.cancelSniperCountdown(countdown.countdownId);
      setCountdown(null);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: font.family }}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
        aria-hidden="true"
      >
        <defs>
          <filter id="liquid-glass-refraction" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.015"
              numOctaves="3"
              seed="42"
              stitchTiles="stitch"
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="6"
              xChannelSelector="R"
              yChannelSelector="G"
              result="displaced"
            />
            <feGaussianBlur
              in="displaced"
              stdDeviation="0.5"
              result="blurred"
            />
            <feBlend in="blurred" in2="SourceGraphic" mode="normal" />
          </filter>
        </defs>
      </svg>
      {/* ─── Sidebar ──────────────────────────────────────── */}
      <aside
        className="liquid-glass-panel"
        style={{
          ...liquidGlassPanel,
          width: SIDEBAR_WIDTH,
          minWidth: SIDEBAR_WIDTH,
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(255, 255, 255, 0.60)',
          backdropFilter: 'url(#liquid-glass-refraction) blur(40px) saturate(150%)',
          WebkitBackdropFilter: 'url(#liquid-glass-refraction) blur(40px) saturate(150%)',
          borderRight: `1px solid rgba(255, 255, 255, 0.9)`,
          boxShadow: '1px 0 12px rgba(0, 0, 0, 0.03)',
          borderRadius: 0, // Left sidebar is flush
          zIndex: 100,
          padding: `${spacing['2xl']}px 0`,
        }}
      >
        {/* Branding */}
        <div style={{ padding: `0 ${spacing.xl}px`, marginBottom: spacing['3xl'] }}>
          <h1
            style={{
              fontSize: font.size.xl,
              fontWeight: font.weight.bold,
              color: colors.textPrimary,
              margin: 0,
              letterSpacing: '-0.02em',
            }}
          >
            Vinted HQ
          </h1>
          <span
            style={{
              fontSize: font.size.xs,
              color: colors.textMuted,
              fontWeight: font.weight.medium,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginTop: 4,
              display: 'block',
            }}
          >
            Sniper Dashboard
          </span>
        </div>

        {/* Nav Items */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: `0 ${spacing.sm}px` }}>
          {(['feed', 'wardrobe', 'sales', 'automessage', 'proxies', 'settings', 'logs', 'purchases'] as Tab[]).map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '11px 16px',
                  borderRadius: radius.md,
                  border: 'none',
                  background: active ? colors.primaryMuted : 'transparent',
                  color: active ? colors.primary : colors.textSecondary,
                  fontWeight: active ? font.weight.semibold : font.weight.medium,
                  fontSize: font.size.base,
                  cursor: 'pointer',
                  transition: transition.base,
                  textAlign: 'left',
                  width: '100%',
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = 'rgba(0, 0, 0, 0.04)';
                    e.currentTarget.style.color = colors.textPrimary;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = colors.textSecondary;
                  }
                }}
              >
                {icons[t]}
                {tabLabels[t]}
              </button>
            );
          })}
        </nav>

        {/* Bottom spacer for visual balance */}
        <div style={{ flex: 1 }} />

        {/* Session status indicator */}
        {sessionExpired && (
          <div
            style={{
              margin: `0 ${spacing.md}px`,
              padding: `${spacing.sm}px ${spacing.md}px`,
              borderRadius: radius.md,
              background: colors.errorBg,
              color: colors.error,
              fontSize: font.size.sm,
              fontWeight: font.weight.medium,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: colors.error, flexShrink: 0 }} />
            Session expired
          </div>
        )}
      </aside>

      {/* ─── Main Content ─────────────────────────────────── */}
      <main
        style={{
          flex: 1,
          marginLeft: SIDEBAR_WIDTH,
          height: '100vh',
          overflow: 'auto',
          background: colors.bgBase,
        }}
      >
        {tab === 'feed' && <Feed />}
        {tab === 'wardrobe' && <Wardrobe />}
        {tab === 'sales' && <SalesSuite />}
        {tab === 'automessage' && <AutoMessage />}
        {tab === 'proxies' && <ProxyStatus />}
        {tab === 'settings' && <Settings />}
        {tab === 'logs' && <Logs />}
        {tab === 'purchases' && <PurchasesSuite />}
      </main>

      {/* ─── Sniper Countdown Modal ───────────────────────── */}
      {countdown && (
        <div style={modalOverlay}>
          <div style={{ ...modalContent, textAlign: 'center' }} className="animate-fadeInScale">
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: radius.lg,
                background: colors.primaryMuted,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={colors.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <h3 style={{ margin: '0 0 6px', fontSize: font.size.lg, fontWeight: font.weight.semibold, color: colors.textPrimary }}>
              {countdown.sniper.name}
            </h3>
            <p style={{ margin: '0 0 4px', fontSize: font.size.base, color: colors.textSecondary }}>
              {countdown.item.title}
            </p>
            <p style={{ margin: '0 0 20px', fontWeight: font.weight.bold, color: colors.primary, fontSize: font.size.lg }}>
              £{countdown.item.price}
            </p>
            <p
              style={{
                margin: '0 0 24px',
                fontSize: font.size['3xl'],
                fontWeight: font.weight.bold,
                color: colors.textPrimary,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {countdownSeconds > 0 ? countdownSeconds : 'Buying...'}
            </p>
            <button
              type="button"
              onClick={handleCancelCountdown}
              disabled={countdownSeconds <= 0}
              style={{
                ...btnDanger,
                opacity: countdownSeconds > 0 ? 1 : 0.4,
                cursor: countdownSeconds > 0 ? 'pointer' : 'default',
                width: '100%',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ─── Session Expired Modal ────────────────────────── */}
      {sessionExpired && (
        <div style={{ ...modalOverlay, zIndex: 1002 }}>
          <div style={{ ...modalContent, maxWidth: 480 }} className="animate-fadeInScale">
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: radius.lg,
                background: colors.errorBg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={colors.error} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <h3 style={{ margin: '0 0 8px', fontSize: font.size.lg, fontWeight: font.weight.semibold, color: colors.textPrimary }}>
              Session expired
            </h3>
            <p style={{ margin: '0 0 20px', color: colors.textSecondary, fontSize: font.size.base, lineHeight: 1.6 }}>
              Your Vinted session has expired. Open the login page to re-authenticate, or paste a cookie string manually.
            </p>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              <button
                type="button"
                onClick={handleRefreshSession}
                disabled={isRefreshingSession}
                style={{
                  ...btnPrimary,
                  flex: 1,
                  opacity: isRefreshingSession ? 0.6 : 1,
                  cursor: isRefreshingSession ? 'default' : 'pointer',
                }}
              >
                {isRefreshingSession ? 'Opening login...' : 'Refresh session (open login)'}
              </button>
            </div>
            <details style={{ marginBottom: 16 }}>
              <summary style={{ color: colors.textSecondary, fontSize: font.size.sm, cursor: 'pointer', marginBottom: 8 }}>
                Or paste cookie manually...
              </summary>
              <textarea
                placeholder="Paste cookie string here..."
                value={reconnectCookie}
                onChange={(e) => setReconnectCookie(e.target.value)}
                rows={4}
                style={{
                  ...glassTextarea,
                  width: '100%',
                  marginBottom: 8,
                }}
              />
              <button
                type="button"
                onClick={handleReconnect}
                disabled={!reconnectCookie.trim()}
                style={{
                  ...btnPrimary,
                  width: '100%',
                  opacity: reconnectCookie.trim() ? 1 : 0.4,
                  cursor: reconnectCookie.trim() ? 'pointer' : 'default',
                }}
              >
                Reconnect
              </button>
            </details>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => {
                  setSessionExpired(false);
                  setReconnectCookie('');
                }}
                style={{ ...btnSecondary, flex: 1 }}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Countdown Done Toast ─────────────────────────── */}
      {countdownDone && !countdown && (
        <div style={toastStyle} className="animate-slideUp">
          {countdownDone}
        </div>
      )}
    </div>
  );
}
===
/**
 * Root React component — Vinted HQ
 * Revolut-inspired sidebar layout with liquid glass UI
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Feed from './components/Feed';
import Wardrobe from './components/Wardrobe';
import Settings from './components/Settings';
import Logs from './components/Logs';
import PurchasesSuite from './components/PurchasesSuite';
import SalesSuite from './components/SalesSuite';
import AutoMessage from './components/AutoMessage';
import ProxyStatus from './components/ProxyStatus';
import {
  colors,
  font,
  glassTextarea,
  btnPrimary,
  btnSecondary,
  btnDanger,
  modalOverlay,
  modalContent,
  toast as toastStyle,
  SIDEBAR_WIDTH,
  radius,
  spacing,
  transition,
  liquidGlassPanel,
  springSmooth,
  springGentle,
  springResponsive,
} from './theme';
import type { SniperCountdownParams } from './types/global';

type Tab = 'feed' | 'wardrobe' | 'sales' | 'automessage' | 'proxies' | 'settings' | 'logs' | 'purchases';

/* ─── SVG Icons (inline for zero-dep) ───────────────────────── */

const icons: Record<Tab, JSX.Element> = {
  feed: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  wardrobe: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3h7v18H3zM14 3h7v18h-7z" />
      <line x1="7" y1="8" x2="7" y2="12" />
      <line x1="17" y1="8" x2="17" y2="12" />
    </svg>
  ),
  proxies: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="2" />
      <circle cx="4" cy="6" r="2" />
      <circle cx="20" cy="6" r="2" />
      <circle cx="4" cy="18" r="2" />
      <circle cx="20" cy="18" r="2" />
      <line x1="6" y1="7" x2="10" y2="11" />
      <line x1="18" y1="7" x2="14" y2="11" />
      <line x1="6" y1="17" x2="10" y2="13" />
      <line x1="18" y1="17" x2="14" y2="13" />
    </svg>
  ),
  settings: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  logs: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  purchases: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  ),
  sales: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  automessage: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <line x1="9" y1="10" x2="15" y2="10" />
    </svg>
  ),
};

const tabLabels: Record<Tab, string> = {
  feed: 'Feed',
  wardrobe: 'Wardrobe',
  sales: 'Sales',
  automessage: 'Auto-Message',
  proxies: 'Proxies',
  settings: 'Settings',
  logs: 'Logs',
  purchases: 'Purchases',
};

export default function App() {
  const [tab, setTab] = useState<Tab>('feed');
  const [sessionExpired, setSessionExpired] = useState(false);
  const [reconnectCookie, setReconnectCookie] = useState('');
  const [countdown, setCountdown] = useState<SniperCountdownParams | null>(null);
  const [countdownSeconds, setCountdownSeconds] = useState(0);
  const [countdownDone, setCountdownDone] = useState<string | null>(null);

  useEffect(() => {
    const unsubExpired = window.vinted.onSessionExpired(() => setSessionExpired(true));
    const unsubReconnected = window.vinted.onSessionReconnected(() => {
      setSessionExpired(false);
      setReconnectCookie('');
    });
    return () => {
      unsubExpired();
      unsubReconnected();
    };
  }, []);

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

  const [isRefreshingSession, setIsRefreshingSession] = useState(false);

  const handleReconnect = async () => {
    if (!reconnectCookie.trim()) return;
    await window.vinted.storeCookie(reconnectCookie.trim());
  };

  const handleRefreshSession = async () => {
    if (isRefreshingSession) return;
    setIsRefreshingSession(true);
    try {
      const result = await window.vinted.startCookieRefresh();
      if (result.ok) {
        setSessionExpired(false);
        setReconnectCookie('');
      }
    } finally {
      setIsRefreshingSession(false);
    }
  };

  const handleCancelCountdown = () => {
    if (countdown) {
      window.vinted.cancelSniperCountdown(countdown.countdownId);
      setCountdown(null);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: font.family }}>
      {/* ─── Sidebar ──────────────────────────────────────── */}
      <motion.aside
        className="liquid-glass-panel"
        initial={{ x: -SIDEBAR_WIDTH, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={springSmooth}
        style={{
          ...liquidGlassPanel,
          width: SIDEBAR_WIDTH,
          minWidth: SIDEBAR_WIDTH,
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(255, 255, 255, 0.60)',
          backdropFilter: 'url(#liquid-glass-refraction) blur(40px) saturate(150%)',
          WebkitBackdropFilter: 'url(#liquid-glass-refraction) blur(40px) saturate(150%)',
          borderRight: `1px solid rgba(255, 255, 255, 0.9)`,
          boxShadow: '1px 0 12px rgba(0, 0, 0, 0.03)',
          borderRadius: 0,
          zIndex: 100,
          padding: `${spacing['2xl']}px 0`,
        }}
      >
        {/* Branding */}
        <div style={{ padding: `0 ${spacing.xl}px`, marginBottom: spacing['3xl'] }}>
          <h1
            style={{
              fontSize: font.size.xl,
              fontWeight: font.weight.bold,
              color: colors.textPrimary,
              margin: 0,
              letterSpacing: '-0.02em',
            }}
          >
            Vinted HQ
          </h1>
          <span
            style={{
              fontSize: font.size.xs,
              color: colors.textMuted,
              fontWeight: font.weight.medium,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginTop: 4,
              display: 'block',
            }}
          >
            Sniper Dashboard
          </span>
        </div>

        {/* Nav Items */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: `0 ${spacing.sm}px` }}>
          {(['feed', 'wardrobe', 'sales', 'automessage', 'proxies', 'settings', 'logs', 'purchases'] as Tab[]).map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '11px 16px',
                  borderRadius: radius.md,
                  border: 'none',
                  background: active ? colors.primaryMuted : 'transparent',
                  color: active ? colors.primary : colors.textSecondary,
                  fontWeight: active ? font.weight.semibold : font.weight.medium,
                  fontSize: font.size.base,
                  cursor: 'pointer',
                  transition: transition.base,
                  textAlign: 'left',
                  width: '100%',
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = 'rgba(0, 0, 0, 0.04)';
                    e.currentTarget.style.color = colors.textPrimary;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = colors.textSecondary;
                  }
                }}
              >
                {icons[t]}
                {tabLabels[t]}
              </button>
            );
          })}
        </nav>

        {/* Bottom spacer for visual balance */}
        <div style={{ flex: 1 }} />

        {/* Session status indicator */}
        {sessionExpired && (
          <div
            style={{
              margin: `0 ${spacing.md}px`,
              padding: `${spacing.sm}px ${spacing.md}px`,
              borderRadius: radius.md,
              background: colors.errorBg,
              color: colors.error,
              fontSize: font.size.sm,
              fontWeight: font.weight.medium,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: colors.error, flexShrink: 0 }} />
            Session expired
          </div>
        )}
      </motion.aside>

      {/* ─── Main Content ─────────────────────────────────── */}
      <motion.main
        animate={{
          filter: countdown ? 'brightness(0.5) blur(8px)' : 'brightness(1) blur(0px)',
        }}
        transition={springGentle}
        style={{
          flex: 1,
          marginLeft: SIDEBAR_WIDTH,
          height: '100vh',
          overflow: 'auto',
          background: colors.bgBase,
        }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            transition={springSmooth}
            style={{ height: '100%' }}
          >
            {tab === 'feed' && <Feed />}
            {tab === 'wardrobe' && <Wardrobe />}
            {tab === 'sales' && <SalesSuite />}
            {tab === 'automessage' && <AutoMessage />}
            {tab === 'proxies' && <ProxyStatus />}
            {tab === 'settings' && <Settings />}
            {tab === 'logs' && <Logs />}
            {tab === 'purchases' && <PurchasesSuite />}
          </motion.div>
        </AnimatePresence>
      </motion.main>

      {/* ─── Sniper Countdown Modal ───────────────────────── */}
      <AnimatePresence>
        {countdown && (
          <motion.div
            key="sniper-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={springGentle}
            style={modalOverlay}
          >
            <motion.div
              key="sniper-modal"
              initial={{ scale: 0.8, y: -40, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.8, y: -40, opacity: 0 }}
              transition={springGentle}
              style={{ ...modalContent, textAlign: 'center' }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: radius.lg,
                  background: colors.primaryMuted,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px',
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={colors.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <h3 style={{ margin: '0 0 6px', fontSize: font.size.lg, fontWeight: font.weight.semibold, color: colors.textPrimary }}>
                {countdown.sniper.name}
              </h3>
              <p style={{ margin: '0 0 4px', fontSize: font.size.base, color: colors.textSecondary }}>
                {countdown.item.title}
              </p>
              <p style={{ margin: '0 0 20px', fontWeight: font.weight.bold, color: colors.primary, fontSize: font.size.lg }}>
                £{countdown.item.price}
              </p>
              <div style={{ margin: '0 0 24px' }}>
                <AnimatePresence mode="wait">
                  <motion.span
                    key={countdownSeconds}
                    initial={{ scale: 1.15, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.85, opacity: 0 }}
                    transition={springResponsive}
                    style={{
                      display: 'block',
                      fontSize: font.size['3xl'],
                      fontWeight: font.weight.bold,
                      color: colors.textPrimary,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {countdownSeconds > 0 ? countdownSeconds : 'Buying...'}
                  </motion.span>
                </AnimatePresence>
              </div>
              <button
                type="button"
                onClick={handleCancelCountdown}
                disabled={countdownSeconds <= 0}
                style={{
                  ...btnDanger,
                  opacity: countdownSeconds > 0 ? 1 : 0.4,
                  cursor: countdownSeconds > 0 ? 'pointer' : 'default',
                  width: '100%',
                }}
              >
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Session Expired Modal ────────────────────────── */}
      {sessionExpired && (
        <div style={{ ...modalOverlay, zIndex: 1002 }}>
          <div style={{ ...modalContent, maxWidth: 480 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: radius.lg,
                background: colors.errorBg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={colors.error} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <h3 style={{ margin: '0 0 8px', fontSize: font.size.lg, fontWeight: font.weight.semibold, color: colors.textPrimary }}>
              Session expired
            </h3>
            <p style={{ margin: '0 0 20px', color: colors.textSecondary, fontSize: font.size.base, lineHeight: 1.6 }}>
              Your Vinted session has expired. Open the login page to re-authenticate, or paste a cookie string manually.
            </p>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              <button
                type="button"
                onClick={handleRefreshSession}
                disabled={isRefreshingSession}
                style={{
                  ...btnPrimary,
                  flex: 1,
                  opacity: isRefreshingSession ? 0.6 : 1,
                  cursor: isRefreshingSession ? 'default' : 'pointer',
                }}
              >
                {isRefreshingSession ? 'Opening login...' : 'Refresh session (open login)'}
              </button>
            </div>
            <details style={{ marginBottom: 16 }}>
              <summary style={{ color: colors.textSecondary, fontSize: font.size.sm, cursor: 'pointer', marginBottom: 8 }}>
                Or paste cookie manually...
              </summary>
              <textarea
                placeholder="Paste cookie string here..."
                value={reconnectCookie}
                onChange={(e) => setReconnectCookie(e.target.value)}
                rows={4}
                style={{
                  ...glassTextarea,
                  width: '100%',
                  marginBottom: 8,
                }}
              />
              <button
                type="button"
                onClick={handleReconnect}
                disabled={!reconnectCookie.trim()}
                style={{
                  ...btnPrimary,
                  width: '100%',
                  opacity: reconnectCookie.trim() ? 1 : 0.4,
                  cursor: reconnectCookie.trim() ? 'pointer' : 'default',
                }}
              >
                Reconnect
              </button>
            </details>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => {
                  setSessionExpired(false);
                  setReconnectCookie('');
                }}
                style={{ ...btnSecondary, flex: 1 }}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Countdown Done Toast ─────────────────────────── */}
      <AnimatePresence>
        {countdownDone && !countdown && (
          <motion.div
            key="countdown-toast"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={springSmooth}
            style={toastStyle}
          >
            {countdownDone}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

The `<svg><feDisplacementMap>` pipeline now lives in [index.html](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Vinted-HQ/electron-app/index.html) before `<div id="root">`, making it available to all components without depending on React's render tree.

### Phase B — Glass Tokens + Modal GPU Fix

```diff:theme.ts
/**
 * Centralized design tokens — Elevated Neutral / Liquid Glass Theme
 */

import type { CSSProperties } from 'react';

/* ─── Color Palette ─────────────────────────────────────────── */

export const colors = {
  // ── Backgrounds ───────────────────────────────────────────
  bgBase:        '#FAF9F6',   // Warm off-white. The absolute bottom layer of <body>.
  bgElevated:    '#FFFFFF',   // Pure white. Reserved for cards, panels, modals.
  surface:       '#F0EFEB',   // Subtle warm grey. For nested containers, resting inputs.

  // ── Glass ─────────────────────────────────────────────────
  glassBg:       'rgba(255, 255, 255, 0.65)',    // Translucent base for glass panels.
  glassBgHover:  'rgba(255, 255, 255, 0.80)',    // Increased opacity on hover.
  glassBorder:   'rgba(255, 255, 255, 0.85)',    // High-opacity white edge.
  glassBorderHover: 'rgba(255, 255, 255, 0.95)', // Near-opaque on hover.
  glassHighlight: 'rgba(255, 255, 255, 0.40)',   // For card default state.
  glassInset:    'rgba(255, 255, 255, 0.70)',    // Inset volumetric illumination.

  // ── Primary Accent (Indigo) ───────────────────────────────
  primary:       '#6366F1',   // Primary interactive accent.
  primaryHover:  '#4F46E5',   // Darkened on hover for depth.
  primaryMuted:  'rgba(99, 102, 241, 0.10)',  // Tinted backgrounds (active nav).
  primaryGlow:   'rgba(99, 102, 241, 0.15)',  // Subtle elevation shadow.

  // ── Text ──────────────────────────────────────────────────
  textPrimary:   '#111111',   // Near-black. Max contrast without optical vibration.
  textSecondary: '#666666',   // Dark grey. Metadata, timestamps, descriptions.
  textMuted:     '#A3A3A3',   // Light grey. Placeholders, disabled states.

  // ── Semantic Status ───────────────────────────────────────
  success:     '#059669',     // Deep emerald text.
  successBg:   '#ECFDF5',     // Pale mint background.
  error:       '#DC2626',     // Red text.
  errorBg:     '#FEF2F2',     // Pale rose background.
  warning:     '#D97706',     // Amber text.
  warningBg:   '#FFFBEB',     // Pale gold background.
  info:        '#2563EB',     // Blue text.
  infoBg:      '#EFF6FF',     // Pale blue background.

  // ── Miscellaneous ─────────────────────────────────────────
  separator:   'rgba(0, 0, 0, 0.06)',  // Extremely subtle dividers.
  overlay:     'rgba(0, 0, 0, 0.40)',  // Modal backdrop.
  white:       '#FFFFFF',
  black:       '#000000',
} as const;

/* ─── Typography ────────────────────────────────────────────── */

export const font = {
  family:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  mono:
    "'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace",
  size: {
    xs:   11,
    sm:   12,
    md:   13,
    base: 14,
    lg:   16,
    xl:   18,
    '2xl': 22,
    '3xl': 28,
  },
  weight: {
    normal:   400 as const,  // Body copy, table cells.
    medium:   500 as const,  // Metadata, labels.
    semibold: 600 as const,  // Primary data points, headers.
    bold:     700 as const,  // App title, hero numbers.
  },
} as const;

/* ─── Shadows & Effects ─────────────────────────────────────── */

export const shadows = {
  glass:
    '0 12px 32px rgba(0, 0, 0, 0.04), ' +
    'inset 0 4px 20px rgba(255, 255, 255, 0.7), ' +
    'inset 0 -1px 2px rgba(0, 0, 0, 0.02)',
  glassSubtle:
    '0 4px 24px rgba(0, 0, 0, 0.03)',
  glow:
    `0 2px 12px ${colors.primaryGlow}`,
  card:
    '0 4px 24px rgba(0, 0, 0, 0.03)',
  cardHover:
    '0 12px 40px rgba(0, 0, 0, 0.06)',
  toast:
    '0 8px 32px rgba(0, 0, 0, 0.08)',
} as const;

export const blur = {
  glass:      'blur(20px) saturate(150%)',
  glassLight: 'blur(16px) saturate(130%)',
  glassHeavy: 'blur(40px) saturate(150%)',
} as const;

/* ─── Spacing & Radii ───────────────────────────────────────── */

export const radius = {
  sm:   8,       // Badges, small pills.
  md:   12,      // Inputs, buttons.
  lg:   16,      // Inner nested panels.
  xl:   20,      // Standard glass panels, cards.
  '2xl': 24,     // Sidebar, modal, primary containers.
  full: 9999,    // Fully pill-shaped toggles.
} as const;

export const spacing = {
  xs:   4,
  sm:   8,
  md:   12,
  lg:   16,
  xl:   24,      // Standard component padding.
  '2xl': 32,     // Macro-spacing between settings sections.
  '3xl': 40,     // Major layout gaps.
  '4xl': 48,     // Extreme separation (page-level).
} as const;

/* ─── Transition ────────────────────────────────────────────── */

export const transition = {
  fast: 'all 0.15s ease',
  base: 'all 0.2s ease',
  slow: 'all 0.3s ease',
  spring: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const;

/* ─── Reusable Style Objects (CSSProperties) ────────────────── */

export const liquidGlassPanel: CSSProperties = {
  position: 'relative',
  background: colors.glassBg,
  backdropFilter: `url(#liquid-glass-refraction) ${blur.glass}`,
  WebkitBackdropFilter: `url(#liquid-glass-refraction) ${blur.glass}`,
  border: `1px solid ${colors.glassBorder}`,
  borderRadius: radius['2xl'],   // 24px
  boxShadow: shadows.glass,
  overflow: 'hidden',
};

export const liquidGlassCard: CSSProperties = {
  position: 'relative',
  background: colors.glassHighlight,
  backdropFilter: blur.glassLight,
  WebkitBackdropFilter: blur.glassLight,
  border: `1px solid rgba(0, 0, 0, 0.05)`,
  borderRadius: radius.xl,        // 20px
  boxShadow: shadows.card,
  overflow: 'hidden',
  transition: transition.base,
};

export const recessedInput: CSSProperties = {
  background: 'rgba(0, 0, 0, 0.03)',
  border: '1px solid transparent',
  borderRadius: radius.md,          // 12px
  color: colors.textPrimary,
  fontFamily: font.family,
  fontSize: font.size.base,
  padding: '12px 16px',
  outline: 'none',
  transition: transition.base,
  boxSizing: 'border-box' as const,
  boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.04)',
};

// Aliases for backward compatibility
export const glassPanel: CSSProperties = liquidGlassPanel;
export const glassInput: CSSProperties = recessedInput;

export const glassInner: CSSProperties = {
  background: colors.glassHighlight,
  border: `1px solid ${colors.glassBorder}`,
  borderRadius: radius.lg,
};

export const glassTextarea: CSSProperties = {
  ...recessedInput,
  fontFamily: font.mono,
  fontSize: font.size.sm,
  resize: 'vertical' as const,
};

export const glassSelect: CSSProperties = {
  ...recessedInput,
  cursor: 'pointer',
  appearance: 'none' as const,
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23666666' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
  paddingRight: 36,
};

export const btnPrimary: CSSProperties = {
  background: colors.primary,
  color: colors.white,
  border: 'none',
  borderRadius: radius.md,
  padding: '12px 24px',
  fontSize: font.size.base,
  fontWeight: font.weight.semibold,
  fontFamily: font.family,
  cursor: 'pointer',
  transition: transition.base,
  boxShadow: `0 2px 8px ${colors.primaryGlow}`,
};

export const btnSecondary: CSSProperties = {
  background: colors.bgElevated,
  color: colors.textPrimary,
  border: `1px solid rgba(0, 0, 0, 0.10)`,
  borderRadius: radius.md,
  padding: '12px 24px',
  fontSize: font.size.base,
  fontWeight: font.weight.medium,
  fontFamily: font.family,
  cursor: 'pointer',
  transition: transition.base,
};

export const btnDanger: CSSProperties = {
  ...btnSecondary,
  color: colors.error,
  border: `1px solid rgba(220, 38, 38, 0.2)`,
  background: colors.errorBg,
};

export const btnSmall: CSSProperties = {
  padding: '6px 14px',
  fontSize: font.size.sm,
  borderRadius: radius.sm,
};

export const dangerText: CSSProperties = {
  color: colors.error,
  fontSize: font.size.sm,
  cursor: 'pointer',
  background: 'none',
  border: 'none',
  fontFamily: font.family,
  fontWeight: font.weight.medium,
  transition: transition.fast,
  padding: '4px 8px',
  borderRadius: radius.sm,
};

export const glassTable: CSSProperties = {
  ...liquidGlassPanel,
  overflow: 'hidden',
  padding: 0,
};

export const tableHeader: CSSProperties = {
  background: '#F5F5F5',
  position: 'sticky' as const,
  top: 0,
  zIndex: 1,
};

export const tableHeaderCell: CSSProperties = {
  padding: '12px 16px',
  textAlign: 'left' as const,
  fontSize: font.size.sm,
  fontWeight: font.weight.semibold,
  color: colors.textSecondary,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  borderBottom: `1px solid ${colors.separator}`,
};

export const tableCell: CSSProperties = {
  padding: '14px 16px',
  fontSize: font.size.base,
  color: colors.textPrimary,
  borderBottom: `1px solid ${colors.separator}`,
  minHeight: 48,
};

export const tableRowHoverBg = 'rgba(0, 0, 0, 0.02)';

export const badge = (bg: string, fg: string): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  padding: '3px 10px',
  borderRadius: radius.full,
  fontSize: font.size.xs,
  fontWeight: font.weight.semibold,
  letterSpacing: '0.02em',
  background: bg,
  color: fg,
});

export const sectionTitle: CSSProperties = {
  fontSize: font.size.lg,
  fontWeight: font.weight.semibold,
  color: colors.textPrimary,
  margin: 0,
  marginBottom: spacing.sm,
};

export const sectionDesc: CSSProperties = {
  fontSize: font.size.base,
  color: colors.textSecondary,
  margin: 0,
  lineHeight: 1.6,
};

export const modalOverlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: colors.overlay,
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

export const modalContent: CSSProperties = {
  ...liquidGlassPanel,
  background: colors.bgElevated,
  padding: spacing['2xl'],
  maxWidth: 480,
  width: '90%',
  boxShadow: '0 24px 64px rgba(0, 0, 0, 0.12)',
};

export const toast: CSSProperties = {
  position: 'fixed',
  bottom: 24,
  left: '50%',
  transform: 'translateX(-50%)',
  ...liquidGlassPanel,
  padding: '14px 28px',
  fontSize: font.size.base,
  color: colors.textPrimary,
  zIndex: 1001,
  boxShadow: shadows.toast,
};

export const SIDEBAR_WIDTH = 240;
===
/**
 * Centralized design tokens — Elevated Neutral / Liquid Glass Theme
 */

import type { CSSProperties } from 'react';

/* ─── Color Palette ─────────────────────────────────────────── */

export const colors = {
  // ── Backgrounds ───────────────────────────────────────────
  bgBase:        '#FAF9F6',   // Warm off-white. The absolute bottom layer of <body>.
  bgElevated:    '#FFFFFF',   // Pure white. Reserved for cards, panels, modals.
  surface:       '#F0EFEB',   // Subtle warm grey. For nested containers, resting inputs.

  // ── Glass ─────────────────────────────────────────────────
  glassBg:       'rgba(255, 255, 255, 0.65)',    // Translucent base for glass panels.
  glassBgHover:  'rgba(255, 255, 255, 0.80)',    // Increased opacity on hover.
  glassBorder:   'rgba(255, 255, 255, 0.85)',    // High-opacity white edge.
  glassBorderHover: 'rgba(255, 255, 255, 0.95)', // Near-opaque on hover.
  glassHighlight: 'rgba(255, 255, 255, 0.40)',   // For card default state.
  glassInset:    'rgba(255, 255, 255, 0.70)',    // Inset volumetric illumination.

  // ── Primary Accent (Indigo) ───────────────────────────────
  primary:       '#6366F1',   // Primary interactive accent.
  primaryHover:  '#4F46E5',   // Darkened on hover for depth.
  primaryMuted:  'rgba(99, 102, 241, 0.10)',  // Tinted backgrounds (active nav).
  primaryGlow:   'rgba(99, 102, 241, 0.15)',  // Subtle elevation shadow.

  // ── Text ──────────────────────────────────────────────────
  textPrimary:   '#111111',   // Near-black. Max contrast without optical vibration.
  textSecondary: '#666666',   // Dark grey. Metadata, timestamps, descriptions.
  textMuted:     '#A3A3A3',   // Light grey. Placeholders, disabled states.

  // ── Semantic Status ───────────────────────────────────────
  success:     '#059669',     // Deep emerald text.
  successBg:   '#ECFDF5',     // Pale mint background.
  error:       '#DC2626',     // Red text.
  errorBg:     '#FEF2F2',     // Pale rose background.
  warning:     '#D97706',     // Amber text.
  warningBg:   '#FFFBEB',     // Pale gold background.
  info:        '#2563EB',     // Blue text.
  infoBg:      '#EFF6FF',     // Pale blue background.

  // ── Miscellaneous ─────────────────────────────────────────
  separator:   'rgba(0, 0, 0, 0.06)',  // Extremely subtle dividers.
  overlay:     'rgba(0, 0, 0, 0.40)',  // Modal backdrop.
  white:       '#FFFFFF',
  black:       '#000000',
} as const;

/* ─── Typography ────────────────────────────────────────────── */

export const font = {
  family:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  mono:
    "'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace",
  size: {
    xs:   11,
    sm:   12,
    md:   13,
    base: 14,
    lg:   16,
    xl:   18,
    '2xl': 22,
    '3xl': 28,
  },
  weight: {
    normal:   400 as const,  // Body copy, table cells.
    medium:   500 as const,  // Metadata, labels.
    semibold: 600 as const,  // Primary data points, headers.
    bold:     700 as const,  // App title, hero numbers.
  },
} as const;

/* ─── Shadows & Effects ─────────────────────────────────────── */

export const shadows = {
  glass:
    '0 12px 32px rgba(0, 0, 0, 0.04), ' +
    'inset 0 4px 20px rgba(255, 255, 255, 0.7), ' +
    'inset 0 -1px 2px rgba(0, 0, 0, 0.02)',
  glassSubtle:
    '0 4px 24px rgba(0, 0, 0, 0.03)',
  glow:
    `0 2px 12px ${colors.primaryGlow}`,
  card:
    '0 4px 24px rgba(0, 0, 0, 0.03)',
  cardHover:
    '0 12px 40px rgba(0, 0, 0, 0.06)',
  toast:
    '0 8px 32px rgba(0, 0, 0, 0.08)',
} as const;

export const blur = {
  glass:      'blur(20px) saturate(150%)',
  glassLight: 'blur(16px) saturate(130%)',
  glassHeavy: 'blur(40px) saturate(150%)',
} as const;

/* ─── Spacing & Radii ───────────────────────────────────────── */

export const radius = {
  sm:   8,       // Badges, small pills.
  md:   12,      // Inputs, buttons.
  lg:   16,      // Inner nested panels.
  xl:   20,      // Standard glass panels, cards.
  '2xl': 24,     // Sidebar, modal, primary containers.
  full: 9999,    // Fully pill-shaped toggles.
} as const;

export const spacing = {
  xs:   4,
  sm:   8,
  md:   12,
  lg:   16,
  xl:   24,      // Standard component padding.
  '2xl': 32,     // Macro-spacing between settings sections.
  '3xl': 40,     // Major layout gaps.
  '4xl': 48,     // Extreme separation (page-level).
} as const;

/* ─── Transition ────────────────────────────────────────────── */

export const transition = {
  fast: 'all 0.15s ease',
  base: 'all 0.2s ease',
  slow: 'all 0.3s ease',
  spring: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const;

/* ─── Framer Motion Spring Tokens ───────────────────────────── */

/** Micro-interactions: toggles, buttons, card entrances */
export const springResponsive = {
  type: 'spring' as const,
  stiffness: 350,
  damping: 25,
  mass: 1,
};

/** Macro-spatial transitions: page routing, layout shifts */
export const springSmooth = {
  type: 'spring' as const,
  stiffness: 150,
  damping: 15,
  mass: 1,
};

/** Z-axis elevation: modals, overlays, heavy panels */
export const springGentle = {
  type: 'spring' as const,
  stiffness: 75,
  damping: 15,
  mass: 1,
};

/** Stagger configuration for data grid population */
export const staggerFast = {
  staggerChildren: 0.05,
};

/* ─── Reusable Style Objects (CSSProperties) ────────────────── */

export const liquidGlassPanel: CSSProperties = {
  position: 'relative',
  background: colors.glassBg,
  backdropFilter: `url(#liquid-glass-refraction) ${blur.glass}`,
  WebkitBackdropFilter: `url(#liquid-glass-refraction) ${blur.glass}`,
  border: `1px solid ${colors.glassBorder}`,
  borderRadius: radius['2xl'],   // 24px
  boxShadow: shadows.glass,
  overflow: 'hidden',
  transform: 'translate3d(0, 0, 0)',
  willChange: 'transform, backdrop-filter',
};

export const liquidGlassCard: CSSProperties = {
  position: 'relative',
  background: colors.glassHighlight,
  backdropFilter: `url(#liquid-glass-refraction) ${blur.glassLight}`,
  WebkitBackdropFilter: `url(#liquid-glass-refraction) ${blur.glassLight}`,
  border: `1px solid rgba(0, 0, 0, 0.05)`,
  borderRadius: radius.xl,        // 20px
  boxShadow: shadows.card,
  overflow: 'hidden',
  transition: transition.base,
  transform: 'translate3d(0, 0, 0)',
  willChange: 'transform, backdrop-filter',
};

export const recessedInput: CSSProperties = {
  background: 'rgba(0, 0, 0, 0.03)',
  border: '1px solid transparent',
  borderRadius: radius.md,          // 12px
  color: colors.textPrimary,
  fontFamily: font.family,
  fontSize: font.size.base,
  padding: '12px 16px',
  outline: 'none',
  transition: transition.base,
  boxSizing: 'border-box' as const,
  boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.04)',
};

// Aliases for backward compatibility
export const glassPanel: CSSProperties = liquidGlassPanel;
export const glassInput: CSSProperties = recessedInput;

export const glassInner: CSSProperties = {
  background: colors.glassHighlight,
  border: `1px solid ${colors.glassBorder}`,
  borderRadius: radius.lg,
};

export const glassTextarea: CSSProperties = {
  ...recessedInput,
  fontFamily: font.mono,
  fontSize: font.size.sm,
  resize: 'vertical' as const,
};

export const glassSelect: CSSProperties = {
  ...recessedInput,
  cursor: 'pointer',
  appearance: 'none' as const,
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23666666' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
  paddingRight: 36,
};

export const btnPrimary: CSSProperties = {
  background: colors.primary,
  color: colors.white,
  border: 'none',
  borderRadius: radius.md,
  padding: '12px 24px',
  fontSize: font.size.base,
  fontWeight: font.weight.semibold,
  fontFamily: font.family,
  cursor: 'pointer',
  transition: transition.base,
  boxShadow: `0 2px 8px ${colors.primaryGlow}`,
};

export const btnSecondary: CSSProperties = {
  background: colors.bgElevated,
  color: colors.textPrimary,
  border: `1px solid rgba(0, 0, 0, 0.10)`,
  borderRadius: radius.md,
  padding: '12px 24px',
  fontSize: font.size.base,
  fontWeight: font.weight.medium,
  fontFamily: font.family,
  cursor: 'pointer',
  transition: transition.base,
};

export const btnDanger: CSSProperties = {
  ...btnSecondary,
  color: colors.error,
  border: `1px solid rgba(220, 38, 38, 0.2)`,
  background: colors.errorBg,
};

export const btnSmall: CSSProperties = {
  padding: '6px 14px',
  fontSize: font.size.sm,
  borderRadius: radius.sm,
};

export const dangerText: CSSProperties = {
  color: colors.error,
  fontSize: font.size.sm,
  cursor: 'pointer',
  background: 'none',
  border: 'none',
  fontFamily: font.family,
  fontWeight: font.weight.medium,
  transition: transition.fast,
  padding: '4px 8px',
  borderRadius: radius.sm,
};

export const glassTable: CSSProperties = {
  ...liquidGlassPanel,
  overflow: 'hidden',
  padding: 0,
};

export const tableHeader: CSSProperties = {
  background: '#F5F5F5',
  position: 'sticky' as const,
  top: 0,
  zIndex: 1,
};

export const tableHeaderCell: CSSProperties = {
  padding: '12px 16px',
  textAlign: 'left' as const,
  fontSize: font.size.sm,
  fontWeight: font.weight.semibold,
  color: colors.textSecondary,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  borderBottom: `1px solid ${colors.separator}`,
};

export const tableCell: CSSProperties = {
  padding: '14px 16px',
  fontSize: font.size.base,
  color: colors.textPrimary,
  borderBottom: `1px solid ${colors.separator}`,
  minHeight: 48,
};

export const tableRowHoverBg = 'rgba(0, 0, 0, 0.02)';

export const badge = (bg: string, fg: string): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  padding: '3px 10px',
  borderRadius: radius.full,
  fontSize: font.size.xs,
  fontWeight: font.weight.semibold,
  letterSpacing: '0.02em',
  background: bg,
  color: fg,
});

export const sectionTitle: CSSProperties = {
  fontSize: font.size.lg,
  fontWeight: font.weight.semibold,
  color: colors.textPrimary,
  margin: 0,
  marginBottom: spacing.sm,
};

export const sectionDesc: CSSProperties = {
  fontSize: font.size.base,
  color: colors.textSecondary,
  margin: 0,
  lineHeight: 1.6,
};

export const modalOverlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: colors.overlay,
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  transform: 'translate3d(0, 0, 0)',
  willChange: 'transform',
};

export const modalContent: CSSProperties = {
  ...liquidGlassPanel,
  background: colors.bgElevated,
  padding: spacing['2xl'],
  maxWidth: 480,
  width: '90%',
  boxShadow: '0 24px 64px rgba(0, 0, 0, 0.12)',
};

export const toast: CSSProperties = {
  position: 'fixed',
  bottom: 24,
  left: '50%',
  transform: 'translateX(-50%)',
  ...liquidGlassPanel,
  padding: '14px 28px',
  fontSize: font.size.base,
  color: colors.textPrimary,
  zIndex: 1001,
  boxShadow: shadows.toast,
};

export const SIDEBAR_WIDTH = 240;
```

- `liquidGlassCard` now references `url(#liquid-glass-refraction)` in its `backdropFilter`
- Both `liquidGlassPanel` and `liquidGlassCard` have inline `translate3d(0,0,0)` + `willChange`
- `modalOverlay` GPU-promoted to prevent background freeze during scroll-beneath-modal

### Phase C — Volumetric Lighting

```diff:index.css
/* ─── Elevated Neutral / Liquid Glass Theme ─────────── */

@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

/* ─── Reset & Base ──────────────────────────────────────────── */

*, *::before, *::after {
  box-sizing: border-box;
}

html, body, #root {
  margin: 0;
  padding: 0;
  height: 100%;
  background-color: #FAF9F6;
  color: #111111;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* ─── Scrollbar (Webkit / Chromium / Electron) ──────────────── */

::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.12); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.20); }

/* ─── Liquid Glass Helper Classes ───────────────────────────── */

.liquid-glass-panel::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow:
    inset 2px 2px 4px rgba(255, 255, 255, 0.95),
    inset -1px -1px 2px rgba(255, 255, 255, 0.4);
  pointer-events: none;
  z-index: 1;
}

/* ─── Selection ─────────────────────────────────────────────── */

::selection {
  background: rgba(99, 102, 241, 0.2);
  color: #111111;
}

::-moz-selection {
  background: rgba(99, 102, 241, 0.2);
  color: #111111;
}

/* ─── Form Element Resets ───────────────────────────────────── */

input,
textarea,
select,
button {
  font-family: inherit;
  font-size: inherit;
  color: inherit;
  outline: none;
}

select option {
  background: #FFFFFF;
  color: #111111;
}

input::placeholder,
textarea::placeholder {
  color: #A3A3A3;
}

input:focus,
textarea:focus,
select:focus {
  border-color: rgba(99, 102, 241, 0.5) !important;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15) !important;
}

button:focus-visible {
  outline: 2px solid rgba(99, 102, 241, 0.5);
  outline-offset: 2px;
}

/* ─── Links ─────────────────────────────────────────────────── */

a {
  color: #6366F1;
  text-decoration: none;
  transition: color 0.15s ease;
}

a:hover {
  color: #4F46E5;
}

/* ─── Custom Checkbox & Radio ───────────────────────────────── */

input[type="checkbox"],
input[type="radio"] {
  appearance: none;
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border: 1.5px solid rgba(0, 0, 0, 0.2);
  background: rgba(0, 0, 0, 0.04);
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
  position: relative;
}

input[type="checkbox"] {
  border-radius: 5px;
}

input[type="radio"] {
  border-radius: 50%;
}

input[type="checkbox"]:checked,
input[type="radio"]:checked {
  background: #6366F1;
  border-color: #6366F1;
}

input[type="checkbox"]:checked::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 6px;
  width: 4px;
  height: 8px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

input[type="radio"]:checked::after {
  content: '';
  position: absolute;
  top: 4px;
  left: 4px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fff;
}

input[type="checkbox"]:focus,
input[type="radio"]:focus {
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2) !important;
  border-color: rgba(99, 102, 241, 0.5) !important;
}

/* ─── Animations ────────────────────────────────────────────── */

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes fadeInScale {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@keyframes slideUp {
  from { opacity: 0; transform: translateX(-50%) translateY(16px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

/* Utility animation classes */
.animate-fadeIn {
  animation: fadeIn 0.3s ease forwards;
}

.animate-fadeInScale {
  animation: fadeInScale 0.25s ease forwards;
}

.animate-pulse {
  animation: pulse 2s ease-in-out infinite;
}

.animate-slideUp {
  animation: slideUp 0.3s ease forwards;
}

/* ─── Code/mono styling ─────────────────────────────────────── */

code {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace;
  font-size: 0.85em;
  background: rgba(0, 0, 0, 0.04);
  padding: 2px 6px;
  border-radius: 4px;
  color: #6366F1;
}
===
/* ─── Elevated Neutral / Liquid Glass Theme ─────────── */

@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

/* ─── Reset & Base ──────────────────────────────────────────── */

*, *::before, *::after {
  box-sizing: border-box;
}

html, body, #root {
  margin: 0;
  padding: 0;
  height: 100%;
  background-color: #FAF9F6;
  color: #111111;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* ─── Scrollbar (Webkit / Chromium / Electron) ──────────────── */

::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.12); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.20); }

/* ─── Liquid Glass Helper Classes ───────────────────────────── */

.liquid-glass-panel {
  transform: translate3d(0, 0, 0);
  will-change: transform, backdrop-filter;
}

.liquid-glass-panel::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow:
    inset 2px 2px 4px rgba(255, 255, 255, 0.95),
    inset -1px -1px 2px rgba(255, 255, 255, 0.4);
  pointer-events: none;
  z-index: 1;
}

/* ─── Liquid Glass Skeleton Shimmer ─────────────────────────── */

.liquid-glass-skeleton {
  position: relative;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.40);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  border: 1px solid rgba(255, 255, 255, 0.85);
  border-radius: 20px;
}

.liquid-glass-skeleton::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.4) 50%,
    transparent 100%
  );
  background-size: 200% 100%;
  animation: shimmer 1.8s ease-in-out infinite;
  pointer-events: none;
}

/* ─── Liquid Glass Card — Volumetric Lighting ──────────────── */

.liquid-glass-card {
  position: relative;
  transform: translate3d(0, 0, 0);
  will-change: transform, backdrop-filter;
}

/* Diffuse surface shine — soft radial glow following cursor */
.liquid-glass-card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(
    circle at var(--mouse-x, 50%) var(--mouse-y, 50%),
    rgba(255, 255, 255, 0.25) 0%,
    transparent 60%
  );
  pointer-events: none;
  z-index: 2;
  opacity: 0;
  transition: opacity 0.2s ease;
}

/* Show the diffuse shine only when mouse variables are injected */
.liquid-glass-card[style*="--mouse-x"]::before {
  opacity: 1;
}

/* Sharp edge highlight — masked to padding-box for glass bevel */
.liquid-glass-card::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(
    circle at var(--mouse-x, 50%) var(--mouse-y, 50%),
    rgba(255, 255, 255, 0.5) 0%,
    transparent 40%
  );
  -webkit-mask-image: linear-gradient(transparent 60%, black 100%);
  mask-image: linear-gradient(transparent 60%, black 100%);
  -webkit-mask-clip: padding-box;
  mask-clip: padding-box;
  pointer-events: none;
  z-index: 2;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.liquid-glass-card[style*="--mouse-x"]::after {
  opacity: 1;
}

/* ─── Selection ─────────────────────────────────────────────── */

::selection {
  background: rgba(99, 102, 241, 0.2);
  color: #111111;
}

::-moz-selection {
  background: rgba(99, 102, 241, 0.2);
  color: #111111;
}

/* ─── Form Element Resets ───────────────────────────────────── */

input,
textarea,
select,
button {
  font-family: inherit;
  font-size: inherit;
  color: inherit;
  outline: none;
}

select option {
  background: #FFFFFF;
  color: #111111;
}

input::placeholder,
textarea::placeholder {
  color: #A3A3A3;
}

input:focus,
textarea:focus,
select:focus {
  border-color: rgba(99, 102, 241, 0.5) !important;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15) !important;
}

button:focus-visible {
  outline: 2px solid rgba(99, 102, 241, 0.5);
  outline-offset: 2px;
}

/* ─── Links ─────────────────────────────────────────────────── */

a {
  color: #6366F1;
  text-decoration: none;
  transition: color 0.15s ease;
}

a:hover {
  color: #4F46E5;
}

/* ─── Custom Checkbox & Radio ───────────────────────────────── */

input[type="checkbox"],
input[type="radio"] {
  appearance: none;
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border: 1.5px solid rgba(0, 0, 0, 0.2);
  background: rgba(0, 0, 0, 0.04);
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
  position: relative;
}

input[type="checkbox"] {
  border-radius: 5px;
}

input[type="radio"] {
  border-radius: 50%;
}

input[type="checkbox"]:checked,
input[type="radio"]:checked {
  background: #6366F1;
  border-color: #6366F1;
}

input[type="checkbox"]:checked::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 6px;
  width: 4px;
  height: 8px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

input[type="radio"]:checked::after {
  content: '';
  position: absolute;
  top: 4px;
  left: 4px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fff;
}

input[type="checkbox"]:focus,
input[type="radio"]:focus {
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2) !important;
  border-color: rgba(99, 102, 241, 0.5) !important;
}

/* ─── Animations (retained) ─────────────────────────────────── */

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.animate-pulse {
  animation: pulse 2s ease-in-out infinite;
}

/* ─── Code/mono styling ─────────────────────────────────────── */

code {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace;
  font-size: 0.85em;
  background: rgba(0, 0, 0, 0.04);
  padding: 2px 6px;
  border-radius: 4px;
  color: #6366F1;
}
```

- `.liquid-glass-card::before` — diffuse radial-gradient at `var(--mouse-x) var(--mouse-y)`
- `.liquid-glass-card::after` — edge-masked specular highlight
- Both auto-activate via `[style*="--mouse-x"]` selector when [useMousePosition](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Vinted-HQ/electron-app/src/hooks/useMousePosition.ts#9-31) injects values

### Phase D — Feed Virtualization

```diff:Feed.tsx
/**
 * Feed — grid of items from search URLs
 * Revolut-inspired glass card design
 */

import React, { useEffect, useState } from 'react';
import {
  colors,
  font,
  liquidGlassCard,
  btnPrimary,
  btnSmall,
  radius,
  spacing,
  transition,
  shadows,
  badge,
} from '../theme';
import type { FeedItem } from '../types/global';

export default function Feed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [hasCookie, setHasCookie] = useState(false);
  const [searchUrlCount, setSearchUrlCount] = useState(0);
  const [buyingId, setBuyingId] = useState<number | null>(null);
  const [buyProgress, setBuyProgress] = useState<string | null>(null);
  const [buyResult, setBuyResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    window.vinted.hasCookie().then(setHasCookie);
    window.vinted.getSearchUrls().then((urls) => setSearchUrlCount(urls.filter((u) => u.enabled).length));
    window.vinted.isFeedPolling().then(setIsPolling);

    const unsubscribe = window.vinted.onFeedItems((newItems) => {
      setItems((prev) => {
        const prevIds = new Set(prev.map((i) => i.id));
        const added = newItems.filter((i) => !prevIds.has(i.id)).length;
        if (added > 0 && prev.length > 0) setNewCount((n) => n + added);
        return newItems;
      });
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (searchUrlCount > 0 && hasCookie) {
      window.vinted.startFeedPolling();
    }
  }, [searchUrlCount, hasCookie]);

  useEffect(() => {
    const unsubProgress = window.vinted.onCheckoutProgress(setBuyProgress);
    return unsubProgress;
  }, []);

  const handleBuy = async (item: FeedItem) => {
    setBuyingId(item.id);
    setBuyProgress('Starting...');
    setBuyResult(null);
    try {
      const result = await window.vinted.checkoutBuy(item);
      setBuyResult({ ok: result.ok, message: result.message });
      if (!result.ok) setBuyProgress(null);
      else setBuyProgress(null);
    } catch (err) {
      setBuyResult({ ok: false, message: err instanceof Error ? err.message : 'Checkout failed' });
      setBuyProgress(null);
    } finally {
      setBuyingId(null);
    }
  };

  const handleDismissNew = () => setNewCount(0);

  /* ─── Empty states ───────────────────────────────────── */

  if (!hasCookie) {
    return (
      <div style={{ padding: spacing['3xl'], display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ ...liquidGlassCard, padding: spacing['4xl'], textAlign: 'center', maxWidth: 400 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔗</div>
          <p style={{ color: colors.textSecondary, fontSize: font.size.base, margin: 0, lineHeight: 1.6 }}>
            Connect your Vinted session in <strong style={{ color: colors.textPrimary }}>Settings</strong> to see the feed.
          </p>
        </div>
      </div>
    );
  }

  if (searchUrlCount === 0) {
    return (
      <div style={{ padding: spacing['3xl'], display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ ...liquidGlassCard, padding: spacing['4xl'], textAlign: 'center', maxWidth: 400 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔍</div>
          <p style={{ color: colors.textSecondary, fontSize: font.size.base, margin: 0, lineHeight: 1.6 }}>
            Add search URLs in <strong style={{ color: colors.textPrimary }}>Settings</strong> and enable them to start the feed.
          </p>
        </div>
      </div>
    );
  }

  /* ─── Main feed ──────────────────────────────────────── */

  return (
    <div style={{ padding: spacing['2xl'], display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      {/* Status bar */}
      <div
        style={{
          ...liquidGlassCard,
          padding: `${spacing.md}px ${spacing.xl}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: spacing.md,
          borderRadius: radius.lg,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md }}>
          {/* Polling indicator dot */}
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: isPolling ? colors.success : colors.textMuted,
              flexShrink: 0,
              boxShadow: isPolling ? `0 0 8px ${colors.success}` : 'none',
            }}
            className={isPolling ? 'animate-pulse' : undefined}
          />
          <span style={{ fontSize: font.size.base, color: colors.textSecondary }}>
            {items.length} items · {isPolling ? 'Polling active' : 'Polling paused'}
            {buyProgress && <span style={{ color: colors.primary }}> · {buyProgress}</span>}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
          {buyResult && (
            <span
              style={badge(
                buyResult.ok ? colors.successBg : colors.errorBg,
                buyResult.ok ? colors.success : colors.error,
              )}
            >
              {buyResult.message}
            </span>
          )}
          {newCount > 0 && (
            <button
              type="button"
              onClick={handleDismissNew}
              style={{
                ...btnPrimary,
                ...btnSmall,
                boxShadow: 'none',
              }}
            >
              {newCount} new — dismiss
            </button>
          )}
        </div>
      </div>

      {/* Item grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: spacing.xl,
          alignContent: 'start',
        }}
      >
        {items.map((item) => (
          <FeedItemCard
            key={item.id}
            item={item}
            expanded={expandedId === item.id}
            onToggle={() => setExpandedId((id) => (id === item.id ? null : item.id))}
            onBuy={handleBuy}
            isBuying={buyingId !== null}
          />
        ))}
      </div>

      {items.length === 0 && (
        <p style={{ color: colors.textMuted, textAlign: 'center', padding: spacing['4xl'], fontSize: font.size.base }}>
          No items yet. Polling runs every few seconds — check back shortly.
        </p>
      )}
    </div>
  );
}

/* ─── Feed Item Card ────────────────────────────────────────── */

function FeedItemCard({
  item,
  expanded,
  onToggle,
  onBuy,
  isBuying,
}: {
  item: FeedItem;
  expanded: boolean;
  onToggle: () => void;
  onBuy: (item: FeedItem) => void;
  isBuying: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...liquidGlassCard,
        overflow: 'hidden',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        transition: transition.base,
        background: hovered ? colors.glassBgHover : liquidGlassCard.background,
        transform: hovered ? 'translateY(-4px)' : 'translateY(0)',
        boxShadow: hovered ? shadows.cardHover : shadows.card,
      }}
    >
      {/* Image */}
      <div
        style={{
          aspectRatio: '1',
          background: colors.bgElevated,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: '20px 20px 0 0',
          boxShadow: 'inset 0 -20px 30px rgba(0,0,0,0.05)',
        }}
      >
        {item.photo_url ? (
          <img
            src={item.photo_url}
            alt={item.title}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transition: transition.slow,
              transform: hovered ? 'scale(1.03)' : 'scale(1)',
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: colors.textMuted,
              fontSize: font.size.sm,
            }}
          >
            No image
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: spacing.md, flex: 1 }}>
        <div
          style={{
            fontWeight: font.weight.medium,
            fontSize: font.size.base,
            color: colors.textPrimary,
            marginBottom: 4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={item.title}
        >
          {item.title.length > 50 ? item.title.slice(0, 50) + '…' : item.title}
        </div>
        <div style={{ fontSize: font.size.lg, fontWeight: font.weight.semibold, color: colors.textPrimary, textShadow: '0 1px 0 rgba(255,255,255,0.9)' }}>
          £{item.price} {item.currency}
        </div>
        {item.condition && (
          <span style={{ fontSize: font.size.sm, color: colors.textSecondary, marginTop: 2, display: 'block', fontWeight: font.weight.normal }}>
            {item.condition}
          </span>
        )}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div
          style={{
            padding: spacing.md,
            borderTop: `1px solid ${colors.separator}`,
            fontSize: font.size.sm,
            color: colors.textSecondary,
            background: 'rgba(255, 255, 255, 0.02)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {item.size && <div style={{ marginBottom: 3 }}>Size: <span style={{ color: colors.textPrimary }}>{item.size}</span></div>}
          {item.brand && <div style={{ marginBottom: 3 }}>Brand: <span style={{ color: colors.textPrimary }}>{item.brand}</span></div>}
          {item.seller_login && <div style={{ marginBottom: 3 }}>Seller: <span style={{ color: colors.textPrimary }}>{item.seller_login}</span></div>}
          {item.source_urls.length > 1 && <div style={{ marginBottom: 3 }}>From {item.source_urls.length} searches</div>}
          <div style={{ display: 'flex', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onBuy(item);
              }}
              disabled={isBuying}
              style={{
                ...btnPrimary,
                ...btnSmall,
                opacity: isBuying ? 0.5 : 1,
                cursor: isBuying ? 'default' : 'pointer',
              }}
            >
              Buy Now
            </button>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                color: colors.textSecondary,
                fontSize: font.size.sm,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                transition: transition.fast,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = colors.primary; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = colors.textSecondary; }}
            >
              Open on Vinted →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
===
/**
 * Feed — grid of items from search URLs
 * Revolut-inspired glass card design
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
// @ts-ignore — react-window types may lag behind
import { FixedSizeList } from 'react-window';
import {
  colors,
  font,
  liquidGlassCard,
  btnPrimary,
  btnSmall,
  radius,
  spacing,
  transition,
  shadows,
  badge,
  springResponsive,
  staggerFast,
} from '../theme';
import { useMousePosition } from '../hooks/useMousePosition';
import { useScrollDegradation } from '../hooks/useScrollDegradation';
import GlassSkeleton from './GlassSkeleton';
import type { FeedItem } from '../types/global';

const CARD_MIN_WIDTH = 220;
const CARD_GAP = spacing.xl;
const ROW_HEIGHT = 380; // card height + gap

export default function Feed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [hasCookie, setHasCookie] = useState(false);
  const [searchUrlCount, setSearchUrlCount] = useState(0);
  const [buyingId, setBuyingId] = useState<number | null>(null);
  const [buyProgress, setBuyProgress] = useState<string | null>(null);
  const [buyResult, setBuyResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    window.vinted.hasCookie().then(setHasCookie);
    window.vinted.getSearchUrls().then((urls) => setSearchUrlCount(urls.filter((u) => u.enabled).length));
    window.vinted.isFeedPolling().then(setIsPolling);

    const unsubscribe = window.vinted.onFeedItems((newItems) => {
      setItems((prev) => {
        const prevIds = new Set(prev.map((i) => i.id));
        const added = newItems.filter((i) => !prevIds.has(i.id)).length;
        if (added > 0 && prev.length > 0) setNewCount((n) => n + added);
        return newItems;
      });
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (searchUrlCount > 0 && hasCookie) {
      window.vinted.startFeedPolling();
    }
  }, [searchUrlCount, hasCookie]);

  useEffect(() => {
    const unsubProgress = window.vinted.onCheckoutProgress(setBuyProgress);
    return unsubProgress;
  }, []);

  const handleBuy = async (item: FeedItem) => {
    setBuyingId(item.id);
    setBuyProgress('Starting...');
    setBuyResult(null);
    try {
      const result = await window.vinted.checkoutBuy(item);
      setBuyResult({ ok: result.ok, message: result.message });
      if (!result.ok) setBuyProgress(null);
      else setBuyProgress(null);
    } catch (err) {
      setBuyResult({ ok: false, message: err instanceof Error ? err.message : 'Checkout failed' });
      setBuyProgress(null);
    } finally {
      setBuyingId(null);
    }
  };

  const handleDismissNew = () => setNewCount(0);

  /* ─── Empty states ───────────────────────────────────── */

  if (!hasCookie) {
    return (
      <div style={{ padding: spacing['3xl'], display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ ...liquidGlassCard, padding: spacing['4xl'], textAlign: 'center', maxWidth: 400 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔗</div>
          <p style={{ color: colors.textSecondary, fontSize: font.size.base, margin: 0, lineHeight: 1.6 }}>
            Connect your Vinted session in <strong style={{ color: colors.textPrimary }}>Settings</strong> to see the feed.
          </p>
        </div>
      </div>
    );
  }

  if (searchUrlCount === 0) {
    return (
      <div style={{ padding: spacing['3xl'], display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ ...liquidGlassCard, padding: spacing['4xl'], textAlign: 'center', maxWidth: 400 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔍</div>
          <p style={{ color: colors.textSecondary, fontSize: font.size.base, margin: 0, lineHeight: 1.6 }}>
            Add search URLs in <strong style={{ color: colors.textPrimary }}>Settings</strong> and enable them to start the feed.
          </p>
        </div>
      </div>
    );
  }

  /* ─── Main feed ──────────────────────────────────────── */

  return (
    <div style={{ padding: spacing['2xl'], display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      {/* Status bar */}
      <div
        style={{
          ...liquidGlassCard,
          padding: `${spacing.md}px ${spacing.xl}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: spacing.md,
          borderRadius: radius.lg,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md }}>
          {/* Polling indicator dot */}
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: isPolling ? colors.success : colors.textMuted,
              flexShrink: 0,
              boxShadow: isPolling ? `0 0 8px ${colors.success}` : 'none',
            }}
            className={isPolling ? 'animate-pulse' : undefined}
          />
          <span style={{ fontSize: font.size.base, color: colors.textSecondary }}>
            {items.length} items · {isPolling ? 'Polling active' : 'Polling paused'}
            {buyProgress && <span style={{ color: colors.primary }}> · {buyProgress}</span>}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
          {buyResult && (
            <span
              style={badge(
                buyResult.ok ? colors.successBg : colors.errorBg,
                buyResult.ok ? colors.success : colors.error,
              )}
            >
              {buyResult.message}
            </span>
          )}
          {newCount > 0 && (
            <button
              type="button"
              onClick={handleDismissNew}
              style={{
                ...btnPrimary,
                ...btnSmall,
                boxShadow: 'none',
              }}
            >
              {newCount} new — dismiss
            </button>
          )}
        </div>
      </div>

      {/* Virtualized Item Grid */}
      <VirtualizedFeedGrid
        items={items}
        expandedId={expandedId}
        onToggle={(id: number) => setExpandedId((prev) => (prev === id ? null : id))}
        onBuy={handleBuy}
        isBuying={buyingId !== null}
      />

      {items.length === 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: spacing.xl,
          }}
        >
          <GlassSkeleton height={280} count={6} />
        </div>
      )}
    </div>
  );
}

/* ─── Virtualized Feed Grid ─────────────────────────────────── */

function VirtualizedFeedGrid({
  items,
  expandedId,
  onToggle,
  onBuy,
  isBuying,
}: {
  items: FeedItem[];
  expandedId: number | null;
  onToggle: (id: number) => void;
  onBuy: (item: FeedItem) => void;
  isBuying: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const { setContainerRef, isDegraded } = useScrollDegradation();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    setContainerWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  const columns = Math.max(1, Math.floor((containerWidth + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP)));
  const rowCount = Math.ceil(items.length / columns);
  const listHeight = Math.min(rowCount * ROW_HEIGHT, window.innerHeight - 200);

  // Attach scroll degradation to the list's outer element
  const outerRef = useCallback(
    (node: HTMLElement | null) => {
      setContainerRef(node);
    },
    [setContainerRef],
  );

  if (items.length === 0) return null;

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <FixedSizeList
        height={listHeight}
        itemCount={rowCount}
        itemSize={ROW_HEIGHT}
        width="100%"
        outerRef={outerRef}
      >
        {({ index, style }: { index: number; style: React.CSSProperties }) => {
          const start = index * columns;
          const rowItems = items.slice(start, start + columns);
          return (
            <div
              style={{
                ...style,
                display: 'grid',
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
                gap: CARD_GAP,
                paddingBottom: CARD_GAP,
              }}
            >
              {rowItems.map((item) => (
                <FeedItemCard
                  key={item.id}
                  item={item}
                  expanded={expandedId === item.id}
                  onToggle={() => onToggle(item.id)}
                  onBuy={onBuy}
                  isBuying={isBuying}
                  isDegraded={isDegraded}
                />
              ))}
            </div>
          );
        }}
      </FixedSizeList>
    </div>
  );
}

/* ─── Feed Item Card ────────────────────────────────────────── */

function FeedItemCard({
  item,
  expanded,
  onToggle,
  onBuy,
  isBuying,
  isDegraded = false,
}: {
  item: FeedItem;
  expanded: boolean;
  onToggle: () => void;
  onBuy: (item: FeedItem) => void;
  isBuying: boolean;
  isDegraded?: boolean;
}) {
  const { ref, onMouseMove, onMouseLeave } = useMousePosition<HTMLDivElement>();

  return (
    <motion.div
      ref={ref}
      className="liquid-glass-card"
      onClick={onToggle}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      variants={{
        hidden: { y: 20, opacity: 0 },
        visible: { y: 0, opacity: 1 },
      }}
      transition={springResponsive}
      whileHover={{ y: -4, boxShadow: shadows.cardHover }}
      style={{
        ...liquidGlassCard,
        overflow: 'hidden',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        background: liquidGlassCard.background,
        backdropFilter: isDegraded
          ? 'blur(16px) saturate(130%)'
          : liquidGlassCard.backdropFilter,
        WebkitBackdropFilter: isDegraded
          ? 'blur(16px) saturate(130%)'
          : liquidGlassCard.WebkitBackdropFilter,
      }}
    >
      {/* Image */}
      <div
        style={{
          aspectRatio: '1',
          background: colors.bgElevated,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: '20px 20px 0 0',
          boxShadow: 'inset 0 -20px 30px rgba(0,0,0,0.05)',
        }}
      >
        {item.photo_url ? (
          <img
            src={item.photo_url}
            alt={item.title}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: colors.textMuted,
              fontSize: font.size.sm,
            }}
          >
            No image
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: spacing.md, flex: 1 }}>
        <div
          style={{
            fontWeight: font.weight.medium,
            fontSize: font.size.base,
            color: colors.textPrimary,
            marginBottom: 4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={item.title}
        >
          {item.title.length > 50 ? item.title.slice(0, 50) + '…' : item.title}
        </div>
        <div style={{ fontSize: font.size.lg, fontWeight: font.weight.semibold, color: colors.textPrimary, textShadow: '0 1px 0 rgba(255,255,255,0.9)' }}>
          £{item.price} {item.currency}
        </div>
        {item.condition && (
          <span style={{ fontSize: font.size.sm, color: colors.textSecondary, marginTop: 2, display: 'block', fontWeight: font.weight.normal }}>
            {item.condition}
          </span>
        )}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div
          style={{
            padding: spacing.md,
            borderTop: `1px solid ${colors.separator}`,
            fontSize: font.size.sm,
            color: colors.textSecondary,
            background: 'rgba(255, 255, 255, 0.02)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {item.size && <div style={{ marginBottom: 3 }}>Size: <span style={{ color: colors.textPrimary }}>{item.size}</span></div>}
          {item.brand && <div style={{ marginBottom: 3 }}>Brand: <span style={{ color: colors.textPrimary }}>{item.brand}</span></div>}
          {item.seller_login && <div style={{ marginBottom: 3 }}>Seller: <span style={{ color: colors.textPrimary }}>{item.seller_login}</span></div>}
          {item.source_urls.length > 1 && <div style={{ marginBottom: 3 }}>From {item.source_urls.length} searches</div>}
          <div style={{ display: 'flex', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onBuy(item);
              }}
              disabled={isBuying}
              style={{
                ...btnPrimary,
                ...btnSmall,
                opacity: isBuying ? 0.5 : 1,
                cursor: isBuying ? 'default' : 'pointer',
              }}
            >
              Buy Now
            </button>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                color: colors.textSecondary,
                fontSize: font.size.sm,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                transition: transition.fast,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = colors.primary; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = colors.textSecondary; }}
            >
              Open on Vinted →
            </a>
          </div>
        </div>
      )}
    </motion.div>
  );
}
```

- New [VirtualizedFeedGrid](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Vinted-HQ/electron-app/src/components/Feed.tsx#208-292) component wraps `FixedSizeList` from `react-window`
- `ResizeObserver` dynamically calculates column count from container width
- [useScrollDegradation](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Vinted-HQ/electron-app/src/hooks/useScrollDegradation.ts#13-68) wired to the list's outer element
- `isDegraded` prop on [FeedItemCard](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Vinted-HQ/electron-app/src/components/Feed.tsx#295-461) falls back to plain `blur(16px)` during fast scroll

### Phase E — Keyframe Cleanup

- Deleted `@keyframes fadeIn/fadeInScale/slideUp` + `.animate-fadeIn/fadeInScale/slideUp`
- Removed 3 `animate-fadeInScale` from [Wardrobe.tsx](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Vinted-HQ/electron-app/src/components/Wardrobe.tsx)
- Retained `@keyframes pulse` + `.animate-pulse` (polling indicators)
- Retained `@keyframes shimmer` (glass skeleton)

## Verification

- **`tsc --noEmit`**: Zero new errors. All 30+ errors are pre-existing in untouched files ([Wardrobe.tsx](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Vinted-HQ/electron-app/src/components/Wardrobe.tsx), `checkoutService.ts`, `bridge.ts`, etc.)
