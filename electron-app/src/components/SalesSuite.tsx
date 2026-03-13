/**
 * Sales Suite V2 — Sold orders dashboard with local persistence and enrichment
 *
 * Features:
 *  1. Status tabs: All / In Progress / Completed / Cancelled
 *  2. Background conversation enrichment (buyer username, item_id)
 *  3. Local persistence in sold_orders SQLite table
 *  4. Listing price from wardrobe cross-reference
 *  5. Listed/Originally Listed dates
 *  6. Item ID display on cards
 *  7. Read-only edit modal on click (if item exists in wardrobe)
 *  8. Fixed card outline UI glitch
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  colors,
  font,
  glassPanel,
  badge,
  btnPrimary,
  btnSecondary,
  btnSmall,
  spacing,
  radius,
  transition,
  shadows,
} from '../theme';
import type { VintedSoldItem, SoldOrderRow, BridgeResult } from '../types/global';

/* ─── Status tab definitions ─────────────────────────── */

const STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
] as const;

type StatusKey = (typeof STATUS_TABS)[number]['key'];

/** Merged view row — API data + local enrichment */
interface SaleDisplayItem {
  transaction_id: number;
  conversation_id: number;
  item_id: number | null;
  title: string;
  price_amount: string;
  price_currency: string;
  status: string;
  transaction_user_status: string;
  date: string | null;
  photo_url: string | null;
  buyer_username: string | null;
  listing_price: number | null;
  enriched: boolean;
}

export default function SalesSuite() {
  const [items, setItems] = useState<SaleDisplayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [page, setPage] = useState(1);
  const [statusTab, setStatusTab] = useState<StatusKey>('all');
  const [detailModal, setDetailModal] = useState<SaleDisplayItem | null>(null);
  const [modalWardrobe, setModalWardrobe] = useState<Record<string, unknown> | null>(null);
  const perPage = 20;
  const enrichAbort = useRef<AbortController | null>(null);

  /* ─── Data loading pipeline ─────────────────────────── */

  /** Convert API response item -> display item, merging with any local cache */
  const apiToDisplay = (apiItem: VintedSoldItem, cached?: SoldOrderRow | null): SaleDisplayItem => ({
    transaction_id: apiItem.transaction_id,
    conversation_id: apiItem.conversation_id,
    item_id: cached?.item_id ?? null,
    title: apiItem.title,
    price_amount: apiItem.price.amount,
    price_currency: apiItem.price.currency_code,
    status: apiItem.status,
    transaction_user_status: apiItem.transaction_user_status,
    date: apiItem.date,
    photo_url: cached?.photo_url ?? apiItem.photo?.url ?? null,
    buyer_username: cached?.buyer_username ?? null,
    listing_price: cached?.listing_price ?? null,
    enriched: !!cached?.enriched_at,
  });

  /** Convert local DB row -> display item */
  const cachedToDisplay = (row: SoldOrderRow): SaleDisplayItem => ({
    transaction_id: row.transaction_id,
    conversation_id: row.conversation_id,
    item_id: row.item_id,
    title: row.title,
    price_amount: row.price_amount ?? '0',
    price_currency: row.price_currency ?? 'GBP',
    status: row.status ?? '',
    transaction_user_status: row.transaction_user_status ?? '',
    date: row.date,
    photo_url: row.photo_url,
    buyer_username: row.buyer_username,
    listing_price: row.listing_price,
    enriched: !!row.enriched_at,
  });

  const loadSales = useCallback(async (status: StatusKey, pg: number) => {
    setLoading(true);
    setError(null);

    // Abort any ongoing enrichment
    enrichAbort.current?.abort();

    try {
      // 1) Fetch fresh from Vinted API
      const result: BridgeResult = await window.vinted.getSales(status, pg, perPage);

      if (!result.ok) {
        const err = result as { ok: false; code: string; message: string };
        setError({ code: err.code, message: err.message });

        // Fallback: show locally cached data
        try {
          const saved = await window.vinted.getSavedOrders(status === 'all' ? undefined : status);
          setItems(saved.map(cachedToDisplay));
        } catch {
          setItems([]);
        }
        return;
      }

      const data = (result as { ok: true; data: unknown }).data as { my_orders?: VintedSoldItem[] } | VintedSoldItem[];
      const rawItems = Array.isArray(data) ? data : (data as { my_orders?: VintedSoldItem[] })?.my_orders ?? [];

      // 2) Load local cache to merge enrichment data
      let savedMap = new Map<number, SoldOrderRow>();
      try {
        const saved = await window.vinted.getSavedOrders();
        savedMap = new Map(saved.map(s => [s.transaction_id, s]));
      } catch {/* ignore */}

      // 3) Convert + merge
      const displayItems = rawItems.map(api => apiToDisplay(api, savedMap.get(api.transaction_id)));
      setItems(displayItems);

      // 4) Persist basic order data to local DB (non-blocking)
      for (const api of rawItems) {
        const cached = savedMap.get(api.transaction_id);
        window.vinted.upsertSoldOrder({
          transaction_id: api.transaction_id,
          conversation_id: api.conversation_id,
          title: api.title,
          price_amount: api.price.amount,
          price_currency: api.price.currency_code,
          status: api.status,
          transaction_user_status: api.transaction_user_status,
          date: api.date,
          photo_url: cached?.photo_url ?? api.photo?.url ?? null,
        }).catch(() => {/* ignore persistence errors */});
      }

      // 5) Background enrichment for unenriched items
      const unenriched = displayItems.filter(d => !d.enriched);
      if (unenriched.length > 0) {
        const controller = new AbortController();
        enrichAbort.current = controller;
        setEnriching(true);
        enrichItems(unenriched, controller.signal).finally(() => setEnriching(false));
      }
    } catch (e) {
      setError({ code: 'UNKNOWN', message: String(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  /** Background enrichment — fetches conversation detail for each unenriched sale */
  const enrichItems = async (unenriched: SaleDisplayItem[], signal: AbortSignal) => {
    for (const item of unenriched) {
      if (signal.aborted) break;

      try {
        const convResult = await window.vinted.getSaleConversation(item.conversation_id);
        if (!convResult.ok || signal.aborted) continue;

        const convData = (convResult as { ok: true; data: unknown }).data as Record<string, unknown>;
        const conversation = (convData as { conversation?: Record<string, unknown> })?.conversation ?? convData;
        const oppositeUser = conversation?.opposite_user as Record<string, unknown> | undefined;
        const transaction = conversation?.transaction as Record<string, unknown> | undefined;

        const buyerUsername = (oppositeUser?.login as string) ?? null;
        const itemId = (transaction?.item_id as number) ?? null;
        const itemPhoto = transaction?.item_photo as Record<string, unknown> | undefined;
        const photoUrl = (itemPhoto?.url as string) ?? item.photo_url;

        // Cross-reference with wardrobe for listing price
        let listingPrice: number | null = null;

        if (itemId) {
          try {
            const invItem = await window.vinted.getInventoryByVintedId(itemId);
            if (invItem) {
              listingPrice = invItem.price ?? null;
            }
          } catch {/* ignore */}
        }

        // Update local DB
        await window.vinted.upsertSoldOrder({
          transaction_id: item.transaction_id,
          conversation_id: item.conversation_id,
          title: item.title,
          item_id: itemId,
          buyer_username: buyerUsername,
          photo_url: photoUrl,
          listing_price: listingPrice,
          enriched_at: Math.floor(Date.now() / 1000),
        });

        // Update display
        setItems(prev => prev.map(p =>
          p.transaction_id === item.transaction_id
            ? { ...p, item_id: itemId, buyer_username: buyerUsername, photo_url: photoUrl, listing_price: listingPrice, enriched: true }
            : p
        ));

        // Small delay between enrichment calls to avoid rate limiting
        await new Promise(r => setTimeout(r, 300));
      } catch {
        // Skip failures silently
      }
    }
  };

  useEffect(() => {
    loadSales(statusTab, page);
    return () => enrichAbort.current?.abort();
  }, [statusTab, page, loadSales]);

  const handleTabChange = (tab: StatusKey) => {
    setStatusTab(tab);
    setPage(1);
  };

  /* ─── Detail modal (read-only wardrobe view) ─────── */

  const handleCardClick = async (item: SaleDisplayItem) => {
    setDetailModal(item);
    setModalWardrobe(null);
    if (item.item_id) {
      try {
        const inv = await window.vinted.getInventoryByVintedId(item.item_id);
        if (inv) setModalWardrobe(inv as unknown as Record<string, unknown>);
      } catch {/* ignore */}
    }
  };

  /* ─── Format helpers ─────────────────────────────── */

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return dateStr; }
  };

  const formatTimestamp = (ts: number | null) => {
    if (!ts) return '—';
    try {
      return new Date(ts * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return '—'; }
  };

  const formatPrice = (amount: string, currency: string) => {
    const symbol = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : currency + ' ';
    return `${symbol}${amount}`;
  };

  /* ─── Styles ───────────────────────────────────────── */

  const cardStyle: React.CSSProperties = {
    ...glassPanel,
    padding: spacing.xl,
    display: 'flex',
    gap: spacing.xl,
    alignItems: 'flex-start',
    transition: transition.base,
    cursor: 'pointer',
    border: '1px solid transparent',
  };

  const cardHoverStyle: React.CSSProperties = {
    boxShadow: shadows.cardHover,
    border: `1px solid ${colors.glassBorderHover}`,
  };

  const thumbnailStyle: React.CSSProperties = {
    width: 88,
    height: 88,
    borderRadius: radius.lg,
    objectFit: 'cover' as const,
    background: colors.surface,
    flexShrink: 0,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: font.size.xs,
    color: colors.textMuted,
    fontWeight: font.weight.medium,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: 2,
  };

  const valueStyle: React.CSSProperties = {
    fontSize: font.size.base,
    color: colors.textPrimary,
    fontWeight: font.weight.medium,
  };

  const tabBarStyle: React.CSSProperties = {
    display: 'flex',
    gap: spacing.xs,
    borderBottom: `1px solid ${colors.glassBorder}`,
    paddingBottom: 0,
    marginBottom: spacing.lg,
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: `${spacing.sm}px ${spacing.lg}px`,
    fontSize: font.size.sm,
    fontWeight: active ? font.weight.semibold : font.weight.medium,
    color: active ? colors.primary : colors.textMuted,
    background: 'transparent',
    border: 'none',
    borderBottom: active ? `2px solid ${colors.primary}` : '2px solid transparent',
    cursor: 'pointer',
    transition: transition.base,
    marginBottom: -1,
  });

  const statusBadge = (status: string): React.CSSProperties => {
    const s = status.toLowerCase();
    if (s.includes('completed') || s.includes('complete'))
      return badge(colors.successBg, colors.success);
    if (s.includes('progress') || s.includes('shipping') || s.includes('parcel'))
      return badge('rgba(251, 191, 36, 0.12)', '#fbbf24');
    if (s.includes('cancelled') || s.includes('cancel'))
      return badge(colors.errorBg, colors.error);
    return badge(colors.glassBg, colors.textSecondary);
  };

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    backdropFilter: 'blur(6px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  };

  const modalStyle: React.CSSProperties = {
    ...glassPanel,
    width: '90%',
    maxWidth: 640,
    maxHeight: '85vh',
    overflow: 'auto',
    padding: spacing['2xl'],
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.lg,
  };

  return (
    <div style={{ padding: spacing['2xl'], display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: font.size['2xl'], fontWeight: font.weight.bold, color: colors.textPrimary, margin: 0, letterSpacing: '-0.02em' }}>
            Sales Suite
          </h2>
          <p style={{ margin: '4px 0 0', color: colors.textMuted, fontSize: font.size.base }}>
            Your sold orders and transaction history
            {enriching && <span style={{ marginLeft: 8, color: colors.primary, fontSize: font.size.xs }}>● Enriching…</span>}
          </p>
        </div>
        <button type="button" onClick={() => loadSales(statusTab, page)} disabled={loading}
          style={{ ...btnPrimary, ...btnSmall, opacity: loading ? 0.6 : 1, cursor: loading ? 'default' : 'pointer' }}>
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
      </div>

      {/* Status tabs */}
      <div style={tabBarStyle}>
        {STATUS_TABS.map(tab => (
          <button key={tab.key} type="button" onClick={() => handleTabChange(tab.key)} style={tabStyle(statusTab === tab.key)}
            onMouseEnter={e => { if (statusTab !== tab.key) e.currentTarget.style.color = colors.textPrimary; }}
            onMouseLeave={e => { if (statusTab !== tab.key) e.currentTarget.style.color = colors.textMuted; }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ ...glassPanel, padding: `${spacing.lg}px ${spacing.xl}px`, display: 'flex', alignItems: 'center', gap: spacing.md, borderColor: 'rgba(248, 113, 113, 0.3)' }}>
          <div style={{ width: 36, height: 36, borderRadius: radius.md, background: colors.errorBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={colors.error} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: font.weight.semibold, color: colors.error, fontSize: font.size.base, marginBottom: 2 }}>
              {error.code === 'DATADOME_CHALLENGE' || error.code === 'DD_CHALLENGE' ? 'Bot Challenge Detected'
                : error.code === 'SESSION_EXPIRED' ? 'Session Expired' : 'Failed to Load Sales'}
            </div>
            <div style={{ color: colors.textSecondary, fontSize: font.size.sm }}>{error.message}</div>
          </div>
          <button type="button" onClick={() => loadSales(statusTab, page)} style={{ ...btnSecondary, ...btnSmall }}>Retry</button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ ...glassPanel, padding: spacing.xl, height: 120, display: 'flex', alignItems: 'center', gap: spacing.xl }}>
              <div style={{ ...thumbnailStyle, background: colors.glassHighlight }} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ width: '40%', height: 14, background: colors.glassHighlight, borderRadius: radius.sm }} />
                <div style={{ width: '60%', height: 12, background: 'rgba(255,255,255,0.03)', borderRadius: radius.sm }} />
                <div style={{ width: '25%', height: 12, background: 'rgba(255,255,255,0.03)', borderRadius: radius.sm }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && items.length === 0 && !error && (
        <div style={{ ...glassPanel, padding: spacing['4xl'], textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: spacing.lg }}>💰</div>
          <h3 style={{ margin: '0 0 8px', fontSize: font.size.lg, fontWeight: font.weight.semibold, color: colors.textPrimary }}>
            No {statusTab === 'all' ? 'sold orders' : statusTab.replace('_', ' ') + ' orders'} yet
          </h3>
          <p style={{ margin: 0, color: colors.textMuted, fontSize: font.size.base, maxWidth: 360, marginLeft: 'auto', marginRight: 'auto' }}>
            When you sell items on Vinted, they'll appear here with full transaction details.
          </p>
        </div>
      )}

      {/* Sold item cards */}
      {!loading && items.map(item => (
        <SoldItemCard key={item.transaction_id} item={item} cardStyle={cardStyle} cardHoverStyle={cardHoverStyle}
          thumbnailStyle={thumbnailStyle} labelStyle={labelStyle} valueStyle={valueStyle}
          formatDate={formatDate} formatPrice={formatPrice} formatTimestamp={formatTimestamp}
          statusBadge={statusBadge} onClick={() => handleCardClick(item)} />
      ))}

      {/* Pagination */}
      {!loading && items.length >= perPage && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingTop: spacing.md }}>
          <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
            style={{ ...btnSecondary, ...btnSmall, opacity: page <= 1 ? 0.4 : 1, cursor: page <= 1 ? 'default' : 'pointer' }}>
            ← Previous
          </button>
          <span style={{ color: colors.textSecondary, fontSize: font.size.sm, fontVariantNumeric: 'tabular-nums' }}>Page {page}</span>
          <button type="button" onClick={() => setPage(p => p + 1)} style={{ ...btnSecondary, ...btnSmall }}>Next →</button>
        </div>
      )}

      {/* Detail Modal (read-only) */}
      {detailModal && (
        <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) setDetailModal(null); }}>
          <div style={modalStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: font.size.xl, fontWeight: font.weight.bold, color: colors.textPrimary }}>
                Sale Details
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
                <span style={{ ...badge(colors.successBg, colors.success), fontSize: font.size.xs }}>SOLD</span>
                <button type="button" onClick={() => setDetailModal(null)}
                  style={{ background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', fontSize: 20, padding: 4 }}>✕</button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: spacing.xl, alignItems: 'flex-start' }}>
              {detailModal.photo_url && (
                <img src={detailModal.photo_url} alt={detailModal.title}
                  style={{ width: 120, height: 120, borderRadius: radius.lg, objectFit: 'cover', flexShrink: 0 }} />
              )}
              <div style={{ flex: 1 }}>
                <h4 style={{ margin: '0 0 4px', fontSize: font.size.lg, color: colors.textPrimary }}>{detailModal.title}</h4>
                <div style={{ fontSize: font.size.sm, color: colors.textMuted }}>
                  {detailModal.buyer_username ? `Sold to @${detailModal.buyer_username}` : 'Buyer details loading…'}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: `${spacing.md}px ${spacing.xl}px` }}>
              <InfoField label="Sale Price" value={formatPrice(detailModal.price_amount, detailModal.price_currency)} highlight />
              <InfoField label="Listing Price" value={detailModal.listing_price ? formatPrice(String(detailModal.listing_price), detailModal.price_currency) : '—'} />
              <InfoField label="Item ID" value={detailModal.item_id ? `#${detailModal.item_id}` : '—'} mono />
              <InfoField label="Transaction ID" value={`#${detailModal.transaction_id}`} mono />
              <InfoField label="Sold On" value={formatDate(detailModal.date)} />
              <InfoField label="Status" value={detailModal.status} />
            </div>

            {/* Wardrobe details (read-only) */}
            {modalWardrobe && (
              <>
                <div style={{ borderTop: `1px solid ${colors.glassBorder}`, paddingTop: spacing.lg }}>
                  <h4 style={{ margin: '0 0 12px', fontSize: font.size.base, color: colors.textMuted, fontWeight: font.weight.semibold, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Wardrobe Details (Read Only)
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: `${spacing.sm}px ${spacing.xl}px` }}>
                    <InfoField label="Brand" value={(modalWardrobe.brand_name as string) ?? '—'} />
                    <InfoField label="Size" value={(modalWardrobe.size_label as string) ?? '—'} />
                    <InfoField label="Condition" value={(modalWardrobe.condition as string) ?? '—'} />
                    <InfoField label="Category ID" value={modalWardrobe.category_id ? `#${modalWardrobe.category_id}` : '—'} mono />
                  </div>
                  {modalWardrobe.description && (
                    <div style={{ marginTop: spacing.md }}>
                      <div style={labelStyle}>Description</div>
                      <div style={{ fontSize: font.size.sm, color: colors.textSecondary, whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>
                        {modalWardrobe.description as string}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: spacing.sm, paddingTop: spacing.sm }}>
              {detailModal.conversation_id && (
                <button type="button" style={{ ...btnSecondary, ...btnSmall, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  onClick={() => window.vinted.openExternal(`https://www.vinted.co.uk/inbox/${detailModal.conversation_id}`)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  Chat with Buyer
                </button>
              )}
              <button type="button" style={{ ...btnSecondary, ...btnSmall }} onClick={() => setDetailModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Sub-components ──────────────────────────────── */

function InfoField({ label, value, highlight, mono }: { label: string; value: string; highlight?: boolean; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: font.size.xs, color: colors.textMuted, fontWeight: font.weight.medium, textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 2 }}>
        {label}
      </div>
      <div style={{
        fontSize: font.size.base,
        color: highlight ? colors.success : colors.textPrimary,
        fontWeight: highlight ? font.weight.bold : font.weight.medium,
        fontFamily: mono ? font.mono : 'inherit',
        ...(mono ? { fontSize: font.size.sm, color: colors.textMuted } : {}),
      }}>
        {value}
      </div>
    </div>
  );
}

function SoldItemCard({
  item, cardStyle, cardHoverStyle, thumbnailStyle, labelStyle, valueStyle,
  formatDate, formatPrice, formatTimestamp, statusBadge, onClick,
}: {
  item: SaleDisplayItem;
  cardStyle: React.CSSProperties;
  cardHoverStyle: React.CSSProperties;
  thumbnailStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
  valueStyle: React.CSSProperties;
  formatDate: (d: string | null) => string;
  formatPrice: (amount: string, currency: string) => string;
  formatTimestamp: (ts: number | null) => string;
  statusBadge: (status: string) => React.CSSProperties;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div style={{ ...cardStyle, ...(hovered ? cardHoverStyle : {}) }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onClick={onClick}>
      {/* Thumbnail */}
      {item.photo_url ? (
        <img src={item.photo_url} alt={item.title} style={thumbnailStyle}
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      ) : (
        <div style={{ ...thumbnailStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${colors.glassBorder}` }}>
          <span style={{ fontSize: 28, opacity: 0.3 }}>📦</span>
        </div>
      )}

      {/* Details */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md }}>
          <h3 style={{ margin: 0, fontSize: font.size.lg, fontWeight: font.weight.semibold, color: colors.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
            {item.title}
          </h3>
          <span style={statusBadge(item.status)}>{item.status}</span>
        </div>

        {/* Info grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: `${spacing.sm}px ${spacing.xl}px` }}>
          <div>
            <div style={labelStyle}>Sold For</div>
            <div style={{ ...valueStyle, color: colors.success, fontWeight: font.weight.bold }}>{formatPrice(item.price_amount, item.price_currency)}</div>
          </div>
          {item.listing_price !== null && (
            <div>
              <div style={labelStyle}>Listed At</div>
              <div style={valueStyle}>{formatPrice(String(item.listing_price), item.price_currency)}</div>
            </div>
          )}
          <div>
            <div style={labelStyle}>Date</div>
            <div style={valueStyle}>{formatDate(item.date)}</div>
          </div>
          {item.buyer_username && (
            <div>
              <div style={labelStyle}>Buyer</div>
              <div style={{ ...valueStyle, color: colors.primary }}>@{item.buyer_username}</div>
            </div>
          )}
          {item.item_id && (
            <div>
              <div style={labelStyle}>Item ID</div>
              <div style={{ ...valueStyle, fontFamily: font.mono, fontSize: font.size.sm, color: colors.textMuted }}>#{item.item_id}</div>
            </div>
          )}
        </div>

        {/* Enrichment indicator */}
        {!item.enriched && (
          <div style={{ fontSize: font.size.xs, color: colors.textMuted, fontStyle: 'italic' }}>
            ⏳ Enriching details…
          </div>
        )}
      </div>
    </div>
  );
}
