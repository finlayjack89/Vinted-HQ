/**
 * Settings page — session, polling, couriers, delivery, proxies, search URLs
 * Revolut-inspired glass section panels
 */

import React, { useEffect, useState } from 'react';
import {
  colors,
  font,
  glassPanel,
  glassInput,
  glassTextarea,
  glassSelect,
  btnPrimary,
  btnSecondary,
  btnSmall,
  dangerText,
  sectionTitle,
  sectionDesc,
  badge,
  radius,
  spacing,
} from '../theme';
import type { AppSettings, SearchUrl, Sniper } from '../types/global';

type RefreshStatus =
  | 'idle'
  | 'opening'
  | 'waiting'
  | 'captured'
  | 'refreshed'
  | 'timed_out'
  | 'window_closed'
  | 'failed';

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

/* ─── Section Wrapper ───────────────────────────────────────── */

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        ...glassPanel,
        padding: spacing['2xl'],
        marginBottom: spacing.xl,
      }}
    >
      <h3 style={sectionTitle}>{title}</h3>
      {description && <p style={{ ...sectionDesc, marginBottom: spacing.lg }}>{description}</p>}
      <div>{children}</div>
    </section>
  );
}

/* ─── Input Row Helper ──────────────────────────────────────── */

function InputRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: spacing.sm, marginBottom: spacing.sm, alignItems: 'center' }}>
      {children}
    </div>
  );
}

/* ─── Default Settings ──────────────────────────────────────── */

const defaultSettings: AppSettings = {
  pollingIntervalSeconds: 5,
  defaultCourier: 'yodel',
  deliveryType: 'dropoff',
  latitude: 51.5074,
  longitude: -0.1278,
  verificationEnabled: false,
  verificationThresholdPounds: 100,
  authRequiredForPurchase: true,
  proxyUrls: [],
  simulationMode: true,
  autobuyEnabled: false,
  sessionAutofillEnabled: true,
  sessionAutoSubmitEnabled: false,
};

/* ─── Main Component ────────────────────────────────────────── */

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [hasCookie, setHasCookie] = useState(false);
  const [cookieInput, setCookieInput] = useState('');
  const [proxyInput, setProxyInput] = useState('');
  const [saved, setSaved] = useState(false);
  const [searchUrls, setSearchUrls] = useState<SearchUrl[]>([]);
  const [searchUrlInput, setSearchUrlInput] = useState('');
  const [snipers, setSnipers] = useState<Sniper[]>([]);
  const [sniperName, setSniperName] = useState('');
  const [sniperPriceMax, setSniperPriceMax] = useState('');
  const [sniperKeywords, setSniperKeywords] = useState('');
  const [sniperBudget, setSniperBudget] = useState('');
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [hasLoginCredentials, setHasLoginCredentials] = useState(false);
  const [isRefreshingSession, setIsRefreshingSession] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus>('idle');

  useEffect(() => {
    window.vinted.getSettings().then(setSettings);
    window.vinted.hasCookie().then(setHasCookie);
    window.vinted.getSearchUrls().then(setSearchUrls);
    window.vinted.getSnipers().then(setSnipers);
    window.vinted.hasLoginCredentials().then(setHasLoginCredentials);
  }, []);

  const showSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSaveCookie = async () => {
    if (!cookieInput.trim()) return;
    await window.vinted.storeCookie(cookieInput.trim());
    setHasCookie(true);
    setCookieInput('');
    showSaved();
  };

  const handleClearCookie = async () => {
    await window.vinted.clearCookie();
    setHasCookie(false);
    setCookieInput('');
    showSaved();
  };

  const handleRefreshSession = async () => {
    if (isRefreshingSession) return;
    setIsRefreshingSession(true);
    setRefreshStatus('opening');
    // Keep "waiting" visible even while the window is active.
    const waitingTimer = setTimeout(() => setRefreshStatus('waiting'), 900);
    try {
      const result = await window.vinted.startCookieRefresh();
      if (result.ok) {
        setRefreshStatus('captured');
        setHasCookie(true);
        setTimeout(() => setRefreshStatus('refreshed'), 300);
        showSaved();
      } else if (result.reason === 'TIMED_OUT') {
        setRefreshStatus('timed_out');
      } else if (result.reason === 'WINDOW_CLOSED') {
        setRefreshStatus('window_closed');
      } else {
        setRefreshStatus('failed');
      }
    } finally {
      clearTimeout(waitingTimer);
      setIsRefreshingSession(false);
    }
  };

  const handleSaveLoginCredentials = async () => {
    if (!loginUsername.trim() || !loginPassword.trim()) return;
    await window.vinted.saveLoginCredentials(loginUsername.trim(), loginPassword);
    setHasLoginCredentials(true);
    setLoginPassword('');
    showSaved();
  };

  const handleClearLoginCredentials = async () => {
    await window.vinted.clearLoginCredentials();
    setHasLoginCredentials(false);
    setLoginUsername('');
    setLoginPassword('');
    showSaved();
  };

  const refreshLabel: Record<RefreshStatus, string> = {
    idle: '',
    opening: 'Opening login window...',
    waiting: 'Waiting for login and cookie capture...',
    captured: 'Cookies captured.',
    refreshed: 'Session refreshed.',
    timed_out: 'Timed out while waiting for login.',
    window_closed: 'Login window closed before capture.',
    failed: 'Unable to refresh session.',
  };

  const handleSettingsChange = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    window.vinted.setSetting(key, value);
  };

  const handleAddProxy = () => {
    const url = proxyInput.trim();
    if (!url) return;
    const urls = [...settings.proxyUrls, url];
    setSettings((prev) => ({ ...prev, proxyUrls: urls }));
    window.vinted.setSetting('proxyUrls', urls);
    setProxyInput('');
  };

  const handleRemoveProxy = (index: number) => {
    const urls = settings.proxyUrls.filter((_, i) => i !== index);
    setSettings((prev) => ({ ...prev, proxyUrls: urls }));
    window.vinted.setSetting('proxyUrls', urls);
  };

  const handleAddSearchUrl = async () => {
    const url = searchUrlInput.trim();
    if (!url) return;
    const added = await window.vinted.addSearchUrl(url);
    if (added) {
      setSearchUrls((prev) => [...prev, added]);
      setSearchUrlInput('');
      showSaved();
      window.vinted.startFeedPolling();
    }
  };

  const handleToggleSearchUrl = async (id: number, enabled: boolean) => {
    await window.vinted.updateSearchUrl(id, { enabled });
    setSearchUrls((prev) => prev.map((u) => (u.id === id ? { ...u, enabled } : u)));
    if (enabled) window.vinted.startFeedPolling();
  };

  const handleDeleteSearchUrl = async (id: number) => {
    await window.vinted.deleteSearchUrl(id);
    setSearchUrls((prev) => prev.filter((u) => u.id !== id));
  };

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
      showSaved();
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

  /* ─── List item row style ─────────────────────────── */
  const listRow: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
    padding: `${spacing.md}px 0`,
    borderBottom: `1px solid ${colors.separator}`,
  };

  return (
    <div style={{ padding: spacing['2xl'], maxWidth: 620 }}>
      {/* Page header */}
      <h2
        style={{
          fontSize: font.size['2xl'],
          fontWeight: font.weight.bold,
          color: colors.textPrimary,
          margin: `0 0 ${spacing.xl}px`,
          letterSpacing: '-0.02em',
        }}
      >
        Settings
      </h2>

      {/* Saved toast */}
      {saved && (
        <div
          style={{
            position: 'fixed',
            top: 20,
            right: 20,
            zIndex: 1100,
            ...badge(colors.successBg, colors.success),
            padding: '8px 16px',
            fontSize: font.size.base,
            borderRadius: radius.md,
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          }}
          className="animate-fadeIn"
        >
          ✓ Saved
        </div>
      )}

      {/* ─── Session ──────────────────────────────────── */}
      <Section
        title="Vinted Session"
        description="One-click refresh opens a short-lived login window, captures cookies, then closes automatically. Manual paste remains available as fallback."
      >
        <div style={{ display: 'flex', gap: spacing.md, alignItems: 'center', marginBottom: spacing.md }}>
          <span style={badge(hasCookie ? colors.successBg : colors.warningBg, hasCookie ? colors.success : colors.warning)}>
            {hasCookie ? '✓ Connected' : 'No active session'}
          </span>
          <button
            type="button"
            onClick={handleRefreshSession}
            disabled={isRefreshingSession}
            style={{
              ...btnPrimary,
              ...btnSmall,
              opacity: isRefreshingSession ? 0.6 : 1,
              cursor: isRefreshingSession ? 'default' : 'pointer',
            }}
          >
            Refresh session (open login)
          </button>
          <button
            type="button"
            onClick={handleClearCookie}
            style={{
              ...btnSecondary,
              ...btnSmall,
            }}
          >
            Clear session
          </button>
        </div>
        {refreshStatus !== 'idle' && (
          <p style={{ ...sectionDesc, marginBottom: spacing.md }}>{refreshLabel[refreshStatus]}</p>
        )}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: spacing.sm,
            cursor: 'pointer',
            marginBottom: spacing.sm,
            fontSize: font.size.base,
            color: colors.textSecondary,
          }}
        >
          <input
            type="checkbox"
            checked={settings.sessionAutofillEnabled}
            onChange={(e) => handleSettingsChange('sessionAutofillEnabled', e.target.checked)}
          />
          Use saved login credentials to autofill Vinted login form
        </label>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: spacing.sm,
            cursor: 'pointer',
            marginBottom: spacing.md,
            fontSize: font.size.base,
            color: colors.textSecondary,
          }}
        >
          <input
            type="checkbox"
            checked={settings.sessionAutoSubmitEnabled}
            onChange={(e) => handleSettingsChange('sessionAutoSubmitEnabled', e.target.checked)}
          />
          Auto-submit login form after autofill
        </label>
        <InputRow>
          <input
            type="text"
            placeholder="Vinted email/username"
            value={loginUsername}
            onChange={(e) => setLoginUsername(e.target.value)}
            style={{ ...glassInput, flex: 1 }}
          />
          <input
            type="password"
            placeholder="Vinted password"
            value={loginPassword}
            onChange={(e) => setLoginPassword(e.target.value)}
            style={{ ...glassInput, flex: 1 }}
          />
        </InputRow>
        <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center', marginBottom: spacing.lg }}>
          <button
            type="button"
            onClick={handleSaveLoginCredentials}
            disabled={!loginUsername.trim() || !loginPassword.trim()}
            style={{
              ...btnSecondary,
              ...btnSmall,
              opacity: loginUsername.trim() && loginPassword.trim() ? 1 : 0.4,
              cursor: loginUsername.trim() && loginPassword.trim() ? 'pointer' : 'default',
            }}
          >
            Save login credentials
          </button>
          <button
            type="button"
            onClick={handleClearLoginCredentials}
            style={{ ...btnSecondary, ...btnSmall }}
          >
            Clear saved credentials
          </button>
          {hasLoginCredentials && (
            <span style={badge(colors.successBg, colors.success)}>Credentials saved in Keychain</span>
          )}
        </div>

        <textarea
          placeholder="Fallback: paste cookie string manually..."
          value={cookieInput}
          onChange={(e) => setCookieInput(e.target.value)}
          rows={4}
          style={{
            ...glassTextarea,
            width: '100%',
          }}
        />
        <button
          type="button"
          onClick={handleSaveCookie}
          disabled={!cookieInput.trim()}
          style={{
            ...btnPrimary,
            ...btnSmall,
            marginTop: spacing.sm,
            opacity: cookieInput.trim() ? 1 : 0.4,
            cursor: cookieInput.trim() ? 'pointer' : 'default',
          }}
        >
          Save pasted session
        </button>
      </Section>

      {/* ─── Search URLs ──────────────────────────────── */}
      <Section
        title="Search URLs"
        description="Vinted catalog URLs to poll. One proxy per URL (from Proxies section below). Active = included in feed."
      >
        <InputRow>
          <input
            type="url"
            placeholder="https://www.vinted.co.uk/catalog?search_text=...&order=newest_first"
            value={searchUrlInput}
            onChange={(e) => setSearchUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddSearchUrl()}
            style={{ ...glassInput, flex: 1 }}
          />
          <button
            type="button"
            onClick={handleAddSearchUrl}
            style={{ ...btnPrimary, ...btnSmall }}
          >
            Add
          </button>
        </InputRow>
        {searchUrls.length > 0 && (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {searchUrls.map((u) => (
              <li key={u.id} style={listRow}>
                <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer', flex: 1, minWidth: 0 }}>
                  <input
                    type="checkbox"
                    checked={u.enabled}
                    onChange={(e) => handleToggleSearchUrl(u.id, e.target.checked)}
                  />
                  <span
                    style={{
                      fontFamily: font.mono,
                      fontSize: font.size.sm,
                      color: u.enabled ? colors.textPrimary : colors.textMuted,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={u.url}
                  >
                    {u.url}
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => handleDeleteSearchUrl(u.id)}
                  style={dangerText}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ─── Proxies ──────────────────────────────────── */}
      <Section
        title="Proxies (required for Vinted)"
        description={`Residential proxies recommended to avoid bot detection. One proxy per search URL — first proxy for first URL, second for second URL, etc. Format: http://user:pass@host:port or socks5://user:pass@host:port. Same proxy used for entire checkout (sticky).`}
      >
        <InputRow>
          <input
            type="text"
            placeholder="http://user:pass@host:port or socks5://..."
            value={proxyInput}
            onChange={(e) => setProxyInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddProxy()}
            style={{ ...glassInput, flex: 1 }}
          />
          <button
            type="button"
            onClick={handleAddProxy}
            style={{ ...btnPrimary, ...btnSmall }}
          >
            Add
          </button>
        </InputRow>
        {settings.proxyUrls.length > 0 && (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {settings.proxyUrls.map((url, i) => (
              <li key={i} style={listRow}>
                <span
                  style={{
                    fontFamily: font.mono,
                    fontSize: font.size.sm,
                    color: colors.textPrimary,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {url}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveProxy(i)}
                  style={dangerText}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ─── Autobuy ──────────────────────────────────── */}
      <Section title="Autobuy (Sniper)">
        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer', marginBottom: spacing.md, fontSize: font.size.base, color: colors.textSecondary }}>
          <input
            type="checkbox"
            checked={settings.autobuyEnabled}
            onChange={(e) => handleSettingsChange('autobuyEnabled', e.target.checked)}
          />
          Enable autobuy (snipers will attempt to purchase matching items)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer', fontSize: font.size.base, color: colors.textSecondary }}>
          <input
            type="checkbox"
            checked={settings.simulationMode}
            onChange={(e) => handleSettingsChange('simulationMode', e.target.checked)}
          />
          Simulation mode — log "would have bought" only, no real purchases
        </label>
      </Section>

      {/* ─── Snipers ──────────────────────────────────── */}
      <Section
        title="Snipers"
        description="Rules that auto-purchase matching items. Enable Autobuy above. Each sniper: price max, keywords, budget limit."
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
          <input
            type="text"
            placeholder="Name"
            value={sniperName}
            onChange={(e) => setSniperName(e.target.value)}
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
        {snipers.length > 0 && (
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
        )}
      </Section>

      {/* ─── Polling ──────────────────────────────────── */}
      <Section title="Polling">
        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.md, fontSize: font.size.base, color: colors.textSecondary }}>
          <span>Interval (seconds):</span>
          <input
            type="number"
            min={1}
            max={60}
            value={settings.pollingIntervalSeconds}
            onChange={(e) =>
              handleSettingsChange('pollingIntervalSeconds', Math.max(1, parseInt(e.target.value, 10) || 5))
            }
            style={{ ...glassInput, width: 90 }}
          />
        </label>
      </Section>

      {/* ─── Delivery ─────────────────────────────────── */}
      <Section title="Delivery">
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer', fontSize: font.size.base, color: colors.textSecondary }}>
            <input
              type="radio"
              name="deliveryType"
              checked={settings.deliveryType === 'home'}
              onChange={() => handleSettingsChange('deliveryType', 'home')}
            />
            Home delivery
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer', fontSize: font.size.base, color: colors.textSecondary }}>
            <input
              type="radio"
              name="deliveryType"
              checked={settings.deliveryType === 'dropoff'}
              onChange={() => handleSettingsChange('deliveryType', 'dropoff')}
            />
            Drop-off point
          </label>
          <div style={{ display: 'flex', gap: spacing.lg, flexWrap: 'wrap', marginTop: spacing.sm }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, fontSize: font.size.base, color: colors.textSecondary }}>
              <span>Latitude:</span>
              <input
                type="number"
                step="any"
                value={settings.latitude}
                onChange={(e) => handleSettingsChange('latitude', parseFloat(e.target.value) || 0)}
                style={{ ...glassInput, width: 130 }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, fontSize: font.size.base, color: colors.textSecondary }}>
              <span>Longitude:</span>
              <input
                type="number"
                step="any"
                value={settings.longitude}
                onChange={(e) => handleSettingsChange('longitude', parseFloat(e.target.value) || 0)}
                style={{ ...glassInput, width: 130 }}
              />
            </label>
          </div>
        </div>
      </Section>

      {/* ─── Verification ─────────────────────────────── */}
      <Section title="Item Verification (£10)">
        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer', marginBottom: spacing.md, fontSize: font.size.base, color: colors.textSecondary }}>
          <input
            type="checkbox"
            checked={settings.verificationEnabled}
            onChange={(e) => handleSettingsChange('verificationEnabled', e.target.checked)}
          />
          Auto-include verification on expensive items
        </label>
        {settings.verificationEnabled && (
          <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md, fontSize: font.size.base, color: colors.textSecondary }}>
            <span>Threshold (£):</span>
            <input
              type="number"
              min={0}
              step={10}
              value={settings.verificationThresholdPounds}
              onChange={(e) =>
                handleSettingsChange('verificationThresholdPounds', parseFloat(e.target.value) || 0)
              }
              style={{ ...glassInput, width: 100 }}
            />
          </label>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer', fontSize: font.size.base, color: colors.textSecondary }}>
          <input
            type="checkbox"
            checked={settings.authRequiredForPurchase}
            onChange={(e) => handleSettingsChange('authRequiredForPurchase', e.target.checked)}
          />
          Require Yodel/DPD auth for purchases (prompt if unavailable)
        </label>
      </Section>

      {/* ─── Courier ──────────────────────────────────── */}
      <Section title="Courier">
        <select
          value={settings.defaultCourier}
          onChange={(e) => handleSettingsChange('defaultCourier', e.target.value)}
          style={{ ...glassSelect, minWidth: 180 }}
        >
          <option value="yodel">Yodel (auth)</option>
          <option value="dpd">DPD (auth)</option>
          <option value="evri">Evri</option>
          <option value="inpost">InPost</option>
          <option value="royal_mail">Royal Mail</option>
          <option value="cheapest">Cheapest</option>
        </select>
      </Section>
    </div>
  );
}
