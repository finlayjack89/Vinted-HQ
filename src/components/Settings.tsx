/**
 * Settings page — session, polling, couriers, delivery, proxies, search URLs
 */

import React, { useEffect, useState } from 'react';
import type { AppSettings, SearchUrl, Sniper } from '../types/global';

function SniperSpentDisplay({ sniperId, budgetLimit }: { sniperId: number; budgetLimit: number }) {
  const [spent, setSpent] = useState<number | null>(null);
  useEffect(() => {
    window.vinted.getSniperSpent(sniperId).then(setSpent);
  }, [sniperId]);
  return (
    <span style={{ color: '#666', fontSize: 12 }}>
      budget £{budgetLimit} (spent: £{spent ?? '…'})
    </span>
  );
}

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
};

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

  useEffect(() => {
    window.vinted.getSettings().then(setSettings);
    window.vinted.hasCookie().then(setHasCookie);
    window.vinted.getSearchUrls().then(setSearchUrls);
    window.vinted.getSnipers().then(setSnipers);
  }, []);

  const handleSaveCookie = async () => {
    if (!cookieInput.trim()) return;
    await window.vinted.storeCookie(cookieInput.trim());
    setHasCookie(true);
    setCookieInput('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleClearCookie = async () => {
    await window.vinted.clearCookie();
    setHasCookie(false);
    setCookieInput('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
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
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
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
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
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

  return (
    <div style={{ padding: 24, maxWidth: 560 }}>
      <h2 style={{ marginTop: 0 }}>Settings</h2>

      {/* Session */}
      <section style={{ marginBottom: 32 }}>
        <h3>Vinted Session</h3>
        <p style={{ color: '#666', fontSize: 14 }}>
          Paste your full cookie string from Chrome DevTools (Application → Cookies → copy). Kept secure in OS Keychain.
        </p>
        {hasCookie ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: 'green', fontWeight: 500 }}>✓ Connected</span>
            <button
              type="button"
              onClick={handleClearCookie}
              style={{ padding: '6px 12px', fontSize: 13, cursor: 'pointer' }}
            >
              Clear session
            </button>
          </div>
        ) : (
          <>
            <textarea
              placeholder="Paste cookie string here..."
              value={cookieInput}
              onChange={(e) => setCookieInput(e.target.value)}
              rows={4}
              style={{
                width: '100%',
                padding: 12,
                fontFamily: 'monospace',
                fontSize: 12,
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
            <button
              type="button"
              onClick={handleSaveCookie}
              disabled={!cookieInput.trim()}
              style={{ marginTop: 8, padding: '8px 16px', cursor: 'pointer' }}
            >
              Save session
            </button>
          </>
        )}
      </section>

      {/* Search URLs (Phase 3) */}
      <section style={{ marginBottom: 32 }}>
        <h3>Search URLs</h3>
        <p style={{ color: '#666', fontSize: 14 }}>
          Vinted catalog URLs to poll. One proxy per URL (from Proxies section below). Active = included in feed.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            type="url"
            placeholder="https://www.vinted.co.uk/catalog?search_text=...&order=newest_first"
            value={searchUrlInput}
            onChange={(e) => setSearchUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddSearchUrl()}
            style={{ flex: 1, padding: 8 }}
          />
          <button type="button" onClick={handleAddSearchUrl} style={{ padding: '8px 16px', cursor: 'pointer' }}>
            Add
          </button>
        </div>
        {searchUrls.length > 0 && (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {searchUrls.map((u) => (
              <li
                key={u.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 0',
                  borderBottom: '1px solid #eee',
                }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flex: 1, minWidth: 0 }}>
                  <input
                    type="checkbox"
                    checked={u.enabled}
                    onChange={(e) => handleToggleSearchUrl(u.id, e.target.checked)}
                  />
                  <span style={{ fontFamily: 'monospace', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={u.url}>
                    {u.url}
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => handleDeleteSearchUrl(u.id)}
                  style={{ fontSize: 12, cursor: 'pointer', color: '#c00', flexShrink: 0 }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Proxies — essential for feed & checkout; placed after Search URLs for context */}
      <section style={{ marginBottom: 32 }}>
        <h3>Proxies (required for Vinted)</h3>
        <p style={{ color: '#666', fontSize: 14 }}>
          Residential proxies are recommended to avoid bot detection. One proxy per search URL — first proxy for first URL,
          second for second URL, etc. Format: <code style={{ fontSize: 12 }}>http://user:pass@host:port</code> or{' '}
          <code style={{ fontSize: 12 }}>socks5://user:pass@host:port</code>. Same proxy used for entire checkout (sticky).
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            type="text"
            placeholder="http://user:pass@host:port or socks5://..."
            value={proxyInput}
            onChange={(e) => setProxyInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddProxy()}
            style={{ flex: 1, padding: 8 }}
          />
          <button type="button" onClick={handleAddProxy} style={{ padding: '8px 16px', cursor: 'pointer' }}>
            Add
          </button>
        </div>
        {settings.proxyUrls.length > 0 && (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {settings.proxyUrls.map((url, i) => (
              <li
                key={i}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '6px 0',
                  borderBottom: '1px solid #eee',
                }}
              >
                <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{url}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveProxy(i)}
                  style={{ fontSize: 12, cursor: 'pointer', color: '#c00' }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Autobuy (Phase 5) */}
      <section style={{ marginBottom: 32 }}>
        <h3>Autobuy (Sniper)</h3>
        <label style={{ display: 'block', marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={settings.autobuyEnabled}
            onChange={(e) => handleSettingsChange('autobuyEnabled', e.target.checked)}
          />
          Enable autobuy (snipers will attempt to purchase matching items)
        </label>
        <label style={{ display: 'block' }}>
          <input
            type="checkbox"
            checked={settings.simulationMode}
            onChange={(e) => handleSettingsChange('simulationMode', e.target.checked)}
          />
          Simulation mode — log "would have bought" only, no real purchases
        </label>
      </section>

      {/* Snipers */}
      <section style={{ marginBottom: 32 }}>
        <h3>Snipers</h3>
        <p style={{ color: '#666', fontSize: 14 }}>
          Rules that auto-purchase matching items. Enable Autobuy above. Each sniper: price max, keywords, budget limit.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          <input
            type="text"
            placeholder="Name"
            value={sniperName}
            onChange={(e) => setSniperName(e.target.value)}
            style={{ width: 120, padding: 8 }}
          />
          <input
            type="number"
            placeholder="Max £"
            value={sniperPriceMax}
            onChange={(e) => setSniperPriceMax(e.target.value)}
            style={{ width: 80, padding: 8 }}
          />
          <input
            type="text"
            placeholder="Keywords"
            value={sniperKeywords}
            onChange={(e) => setSniperKeywords(e.target.value)}
            style={{ width: 120, padding: 8 }}
          />
          <input
            type="number"
            placeholder="Budget £"
            value={sniperBudget}
            onChange={(e) => setSniperBudget(e.target.value)}
            style={{ width: 80, padding: 8 }}
          />
          <button type="button" onClick={handleAddSniper} style={{ padding: '8px 16px', cursor: 'pointer' }}>
            Add sniper
          </button>
        </div>
        {snipers.length > 0 && (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {snipers.map((s) => (
              <li
                key={s.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 0',
                  borderBottom: '1px solid #eee',
                }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flex: 1, minWidth: 0 }}>
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    onChange={(e) => handleToggleSniper(s.id, e.target.checked)}
                  />
                  <span style={{ fontWeight: 500 }}>{s.name}</span>
                  {s.price_max != null && <span style={{ color: '#666', fontSize: 12 }}>max £{s.price_max}</span>}
                  {s.keywords && <span style={{ color: '#666', fontSize: 12 }}>"{s.keywords}"</span>}
                  {s.budget_limit > 0 && (
                    <SniperSpentDisplay sniperId={s.id} budgetLimit={s.budget_limit} />
                  )}
                </label>
                <button
                  type="button"
                  onClick={() => handleDeleteSniper(s.id)}
                  style={{ fontSize: 12, cursor: 'pointer', color: '#c00', flexShrink: 0 }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Polling */}
      <section style={{ marginBottom: 32 }}>
        <h3>Polling</h3>
        <label style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>Interval (seconds):</span>
          <input
            type="number"
            min={1}
            max={60}
            value={settings.pollingIntervalSeconds}
            onChange={(e) =>
              handleSettingsChange('pollingIntervalSeconds', Math.max(1, parseInt(e.target.value, 10) || 5))
            }
            style={{ width: 80, padding: 6 }}
          />
        </label>
      </section>

      {/* Delivery */}
      <section style={{ marginBottom: 32 }}>
        <h3>Delivery</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label>
            <input
              type="radio"
              name="deliveryType"
              checked={settings.deliveryType === 'home'}
              onChange={() => handleSettingsChange('deliveryType', 'home')}
            />
            Home delivery
          </label>
          <label>
            <input
              type="radio"
              name="deliveryType"
              checked={settings.deliveryType === 'dropoff'}
              onChange={() => handleSettingsChange('deliveryType', 'dropoff')}
            />
            Drop-off point
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Latitude:</span>
            <input
              type="number"
              step="any"
              value={settings.latitude}
              onChange={(e) => handleSettingsChange('latitude', parseFloat(e.target.value) || 0)}
              style={{ width: 120, padding: 6 }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Longitude:</span>
            <input
              type="number"
              step="any"
              value={settings.longitude}
              onChange={(e) => handleSettingsChange('longitude', parseFloat(e.target.value) || 0)}
              style={{ width: 120, padding: 6 }}
            />
          </label>
        </div>
      </section>

      {/* Verification */}
      <section style={{ marginBottom: 32 }}>
        <h3>Item Verification (£10)</h3>
        <label>
          <input
            type="checkbox"
            checked={settings.verificationEnabled}
            onChange={(e) => handleSettingsChange('verificationEnabled', e.target.checked)}
          />
          Auto-include verification on expensive items
        </label>
        {settings.verificationEnabled && (
          <label style={{ display: 'block', marginTop: 8 }}>
            <span>Threshold (£):</span>
            <input
              type="number"
              min={0}
              step={10}
              value={settings.verificationThresholdPounds}
              onChange={(e) =>
                handleSettingsChange('verificationThresholdPounds', parseFloat(e.target.value) || 0)
              }
              style={{ width: 80, marginLeft: 8, padding: 6 }}
            />
          </label>
        )}
        <label style={{ display: 'block', marginTop: 12 }}>
          <input
            type="checkbox"
            checked={settings.authRequiredForPurchase}
            onChange={(e) => handleSettingsChange('authRequiredForPurchase', e.target.checked)}
          />
          Require Yodel/DPD auth for purchases (prompt if unavailable)
        </label>
      </section>

      {/* Couriers */}
      <section style={{ marginBottom: 32 }}>
        <h3>Courier</h3>
        <select
          value={settings.defaultCourier}
          onChange={(e) => handleSettingsChange('defaultCourier', e.target.value)}
          style={{ padding: 8, minWidth: 140 }}
        >
          <option value="yodel">Yodel (auth)</option>
          <option value="dpd">DPD (auth)</option>
          <option value="evri">Evri</option>
          <option value="inpost">InPost</option>
          <option value="royal_mail">Royal Mail</option>
          <option value="cheapest">Cheapest</option>
        </select>
      </section>

      {saved && <p style={{ color: 'green', fontSize: 14 }}>Saved.</p>}
    </div>
  );
}
