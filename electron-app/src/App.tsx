/**
 * Root React component — Seller HQ
 * Revolut-inspired sidebar layout with liquid glass UI
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';

import Feed from './components/Feed';
import Wardrobe from './components/Wardrobe';
import Settings from './components/Settings';
import Logs from './components/Logs';
import PurchasesSuite from './components/PurchasesSuite';
import SalesSuite from './components/SalesSuite';
import AutoMessage from './components/AutoMessage';
import ProxyStatus from './components/ProxyStatus';
import Sniper from './components/Sniper';
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
  shadows,
  radius,
  spacing,
  transition,
} from './theme';
import type { SniperCountdownParams } from './types/global';

type Tab = 'feed' | 'sniper' | 'wardrobe' | 'sales' | 'automessage' | 'proxies' | 'settings' | 'logs' | 'purchases';

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
  sniper: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
    </svg>
  ),
};

const tabLabels: Record<Tab, string> = {
  feed: 'Feed',
  sniper: 'Sniper',
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

  // ── Page transition refs ──
  const contentRef = useRef<HTMLDivElement>(null);
  const isTransitioning = useRef(false);

  const handleTabSwitch = useCallback((newTab: Tab) => {
    if (newTab === tab || isTransitioning.current) return;
    isTransitioning.current = true;

    // Trigger exit animation on the current page content
    const el = contentRef.current;
    if (el) {
      el.classList.add('page-exit');
    }

    // Wait for exit animation to finish, then switch tab
    setTimeout(() => {
      if (el) el.classList.remove('page-exit');
      setTab(newTab);
      isTransitioning.current = false;
    }, 250);
  }, [tab]);

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

  const [isSyncingExtension, setIsSyncingExtension] = useState(false);
  const [extensionSyncMsg, setExtensionSyncMsg] = useState('');

  const handleSyncFromExtension = async () => {
    if (isSyncingExtension) return;
    setIsSyncingExtension(true);
    setExtensionSyncMsg('Opening Chrome & waiting for extension (up to 45s)...');
    try {
      const result = await window.vinted.syncFromExtension();
      if (result.ok) {
        setExtensionSyncMsg('✅ Session synced!');
        setSessionExpired(false);
        setReconnectCookie('');
      } else {
        setExtensionSyncMsg(result.message || 'Extension sync failed.');
      }
    } catch {
      setExtensionSyncMsg('Extension sync failed.');
    } finally {
      setIsSyncingExtension(false);
    }
  };

  const handleCancelCountdown = () => {
    if (countdown) {
      window.vinted.cancelSniperCountdown(countdown.countdownId);
      setCountdown(null);
    }
  };



  return (
    <div
      style={{ display: 'flex', height: '100vh', fontFamily: font.family }}
    >
      {/* ─── Sidebar Underlay (Gradient Strip) ──────────────── */}
      <div style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: SIDEBAR_WIDTH,
        height: '100vh',
        background: `linear-gradient(180deg, ${colors.primaryMuted} 0%, rgba(168,85,247,0.05) 50%, rgba(236,72,153,0.02) 100%)`,
        zIndex: 99,
        borderRight: `1px solid ${colors.glassBorder}`,
      }} />

      {/* ─── Sidebar Content ────────────────────────────────── */}
      <aside
        style={{
          width: SIDEBAR_WIDTH,
          minWidth: SIDEBAR_WIDTH,
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          display: 'flex',
          flexDirection: 'column',
          background: 'transparent',
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
            Seller HQ
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
          {(['feed', 'sniper', 'wardrobe', 'sales', 'automessage', 'proxies', 'settings', 'logs', 'purchases'] as Tab[]).map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => handleTabSwitch(t)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '11px 16px',
                  borderRadius: radius.md,
                  border: `1px solid ${active ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.2)'}`,
                  background: active ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.4)',
                  boxShadow: active ? shadows.cardHover : 'none',
                  color: active ? colors.primary : colors.textSecondary,
                  fontWeight: active ? font.weight.bold : font.weight.medium,
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
          position: 'relative', // Add relative positioning for the full-screen overlay
          backgroundColor: colors.bgBase,
          backgroundImage: `
            radial-gradient(circle at 10% 20%, rgba(99, 102, 241, 0.12) 0%, transparent 40%),
            radial-gradient(circle at 90% 80%, rgba(139, 92, 246, 0.1) 0%, transparent 40%),
            radial-gradient(circle at 50% 50%, rgba(200, 200, 255, 0.08) 0%, transparent 60%)
          `,
        }}
      >
        {/* Hardware-safe dimming overlay instead of filter */}
        {countdown && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              bottom: 0,
              left: SIDEBAR_WIDTH,
              background: 'rgba(0, 0, 0, 0.65)',
              zIndex: 900,
              pointerEvents: 'none',
            }}
          />
        )}

        <div ref={contentRef} style={{ height: '100%' }}>
          {tab === 'feed' && <Feed />}
          {tab === 'sniper' && <Sniper />}
          {tab === 'wardrobe' && <Wardrobe />}
          {tab === 'sales' && <SalesSuite />}
          {tab === 'automessage' && <AutoMessage />}
          {tab === 'proxies' && <ProxyStatus />}
          {tab === 'settings' && <Settings />}
          {tab === 'logs' && <Logs />}
          {tab === 'purchases' && <PurchasesSuite />}
        </div>
      </main>

      {/* ─── Sniper Countdown Modal ───────────────────────── */}
      {countdown && (
        <div
          style={modalOverlay}
        >
          <div
            style={{ ...modalContent, textAlign: 'center', background: 'transparent' }}
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
              <span
                style={{
                  display: 'block',
                  fontSize: font.size['3xl'],
                  fontWeight: font.weight.bold,
                  color: colors.textPrimary,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {countdownSeconds > 0 ? countdownSeconds : 'Buying...'}
              </span>
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
          </div>
        </div>
      )}

      {/* ─── Session Expired Modal ────────────────────────── */}
      {sessionExpired && (
        <div style={{ ...modalOverlay, zIndex: 1002 }}>
          <div 
            style={{ 
              ...modalContent, 
              maxWidth: 480,
            }}
          >
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
            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              <button
                type="button"
                onClick={handleSyncFromExtension}
                disabled={isSyncingExtension}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  borderRadius: radius.md,
                  border: 'none',
                  background: isSyncingExtension
                    ? colors.textMuted
                    : 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                  color: '#fff',
                  fontWeight: font.weight.semibold,
                  fontSize: font.size.base,
                  cursor: isSyncingExtension ? 'wait' : 'pointer',
                  opacity: isSyncingExtension ? 0.7 : 1,
                }}
              >
                {isSyncingExtension ? '⏳ Syncing...' : '⚡ 1-Click Sync from Chrome'}
              </button>
            </div>
            {extensionSyncMsg && (
              <p style={{ margin: '0 0 12px', fontSize: font.size.sm, color: colors.textSecondary }}>
                {extensionSyncMsg}
              </p>
            )}
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
                style={{ ...btnSecondary }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Countdown Done Toast ─────────────────────────── */}
      {countdownDone && !countdown && (
        <div
          style={toastStyle}
        >
          {countdownDone}
        </div>
      )}
    </div>
  );
}
