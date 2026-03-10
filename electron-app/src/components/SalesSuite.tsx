/**
 * Sales Suite — View sold items dashboard
 * Full-width glass cards with item details and action buttons
 */

import React, { useEffect, useState } from 'react';
import {
  colors,
  font,
  glassPanel,
  glassInner,
  badge,
  btnPrimary,
  btnSecondary,
  btnSmall,
  spacing,
  radius,
  transition,
  shadows,
} from '../theme';
import type { VintedSoldItem, BridgeResult } from '../types/global';

type SalesResponse = {
  items: VintedSoldItem[];
  pagination?: {
    current_page: number;
    total_pages: number;
    total_entries: number;
    per_page: number;
  };
};

export default function SalesSuite() {
  const [items, setItems] = useState<VintedSoldItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const perPage = 20;

  const loadSales = async (pg: number) => {
    setLoading(true);
    setError(null);
    try {
      const userId = await window.vinted.getVintedUserId();
      if (!userId) {
        setError({ code: 'NO_USER', message: 'No Vinted user ID found. Connect your session in Settings.' });
        setLoading(false);
        return;
      }
      const result: BridgeResult = await window.vinted.getSales(userId, pg, perPage);
      if (!result.ok) {
        const err = result as { ok: false; code: string; message: string };
        setError({ code: err.code, message: err.message });
        setItems([]);
      } else {
        const data = (result as { ok: true; data: unknown }).data as SalesResponse;
        const rawItems = data?.items ?? (Array.isArray(data) ? data : []);
        setItems(rawItems as VintedSoldItem[]);
        if (data?.pagination) {
          setTotalPages(data.pagination.total_pages || 1);
        }
      }
    } catch (e) {
      setError({ code: 'UNKNOWN', message: String(e) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSales(page);
  }, [page]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  const handleOpenListing = (item: VintedSoldItem) => {
    const url = item.url?.startsWith('http')
      ? item.url
      : `https://www.vinted.co.uk/items/${item.id}`;
    window.vinted.openExternal(url);
  };

  const handleOpenChat = (item: VintedSoldItem) => {
    if (item.conversation_id) {
      window.vinted.openExternal(`https://www.vinted.co.uk/inbox/${item.conversation_id}`);
    } else if (item.buyer_id) {
      window.vinted.openExternal(`https://www.vinted.co.uk/member/${item.buyer_id}`);
    }
  };

  const handleEditItem = (item: VintedSoldItem) => {
    window.location.hash = `/wardrobe?edit=${item.id}`;
  };

  /* ─── Styles ───────────────────────────────────────── */

  const cardStyle: React.CSSProperties = {
    ...glassPanel,
    padding: spacing.xl,
    display: 'flex',
    gap: spacing.xl,
    alignItems: 'flex-start',
    transition: transition.base,
    cursor: 'default',
  };

  const cardHoverStyle: React.CSSProperties = {
    boxShadow: shadows.cardHover,
    borderColor: colors.glassBorderHover,
  };

  const thumbnailStyle: React.CSSProperties = {
    width: 88,
    height: 88,
    borderRadius: radius.lg,
    objectFit: 'cover' as const,
    background: colors.surface,
    border: `1px solid ${colors.glassBorder}`,
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

  const actionBtnStyle: React.CSSProperties = {
    ...btnSecondary,
    ...btnSmall,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    whiteSpace: 'nowrap' as const,
  };

  const errorBannerStyle: React.CSSProperties = {
    ...glassPanel,
    padding: `${spacing.lg}px ${spacing.xl}px`,
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
    borderColor: 'rgba(248, 113, 113, 0.3)',
  };

  return (
    <div style={{ padding: spacing['2xl'], display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2
            style={{
              fontSize: font.size['2xl'],
              fontWeight: font.weight.bold,
              color: colors.textPrimary,
              margin: 0,
              letterSpacing: '-0.02em',
            }}
          >
            Sales Suite
          </h2>
          <p style={{ margin: '4px 0 0', color: colors.textMuted, fontSize: font.size.base }}>
            Your sold items and transaction history
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadSales(page)}
          disabled={loading}
          style={{
            ...btnPrimary,
            ...btnSmall,
            opacity: loading ? 0.6 : 1,
            cursor: loading ? 'default' : 'pointer',
          }}
        >
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
      </div>

      {/* Datadome / error banner */}
      {error && (
        <div style={errorBannerStyle}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: radius.md,
              background: colors.errorBg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={colors.error} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: font.weight.semibold, color: colors.error, fontSize: font.size.base, marginBottom: 2 }}>
              {error.code === 'DATADOME_CHALLENGE' || error.code === 'DD_CHALLENGE'
                ? 'Bot Challenge Detected'
                : error.code === 'SESSION_EXPIRED'
                  ? 'Session Expired'
                  : 'Failed to Load Sales'}
            </div>
            <div style={{ color: colors.textSecondary, fontSize: font.size.sm }}>
              {error.message}
            </div>
          </div>
          <button
            type="button"
            onClick={() => loadSales(page)}
            style={{ ...btnSecondary, ...btnSmall }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="animate-pulse"
              style={{
                ...glassPanel,
                padding: spacing.xl,
                height: 120,
                display: 'flex',
                alignItems: 'center',
                gap: spacing.xl,
              }}
            >
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
            No sold items yet
          </h3>
          <p style={{ margin: 0, color: colors.textMuted, fontSize: font.size.base, maxWidth: 360, marginLeft: 'auto', marginRight: 'auto' }}>
            When you sell items on Vinted, they'll appear here with full transaction details.
          </p>
        </div>
      )}

      {/* Sold item cards */}
      {!loading && items.map((item) => (
        <SoldItemCard
          key={item.id}
          item={item}
          cardStyle={cardStyle}
          cardHoverStyle={cardHoverStyle}
          thumbnailStyle={thumbnailStyle}
          labelStyle={labelStyle}
          valueStyle={valueStyle}
          actionBtnStyle={actionBtnStyle}
          formatDate={formatDate}
          onOpenListing={handleOpenListing}
          onOpenChat={handleOpenChat}
          onEditItem={handleEditItem}
        />
      ))}

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingTop: spacing.md }}>
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            style={{
              ...btnSecondary,
              ...btnSmall,
              opacity: page <= 1 ? 0.4 : 1,
              cursor: page <= 1 ? 'default' : 'pointer',
            }}
          >
            ← Previous
          </button>
          <span style={{ color: colors.textSecondary, fontSize: font.size.sm, fontVariantNumeric: 'tabular-nums' }}>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            style={{
              ...btnSecondary,
              ...btnSmall,
              opacity: page >= totalPages ? 0.4 : 1,
              cursor: page >= totalPages ? 'default' : 'pointer',
            }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── SoldItemCard sub-component ──────────────────────── */

function SoldItemCard({
  item,
  cardStyle,
  cardHoverStyle,
  thumbnailStyle,
  labelStyle,
  valueStyle,
  actionBtnStyle,
  formatDate,
  onOpenListing,
  onOpenChat,
  onEditItem,
}: {
  item: VintedSoldItem;
  cardStyle: React.CSSProperties;
  cardHoverStyle: React.CSSProperties;
  thumbnailStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
  valueStyle: React.CSSProperties;
  actionBtnStyle: React.CSSProperties;
  formatDate: (d: string | null) => string;
  onOpenListing: (item: VintedSoldItem) => void;
  onOpenChat: (item: VintedSoldItem) => void;
  onEditItem: (item: VintedSoldItem) => void;
}) {
  const [hovered, setHovered] = useState(false);

  const brandDisplay = [item.brand_title, item.collection_title, item.model_title]
    .filter(Boolean)
    .join(' · ') || null;

  return (
    <div
      style={{
        ...cardStyle,
        ...(hovered ? cardHoverStyle : {}),
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Thumbnail */}
      {item.photo_url ? (
        <img
          src={item.photo_url}
          alt={item.title}
          style={thumbnailStyle}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <div style={{ ...thumbnailStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 28, opacity: 0.3 }}>📦</span>
        </div>
      )}

      {/* Details */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md }}>
          <div style={{ minWidth: 0 }}>
            <h3
              style={{
                margin: 0,
                fontSize: font.size.lg,
                fontWeight: font.weight.semibold,
                color: colors.textPrimary,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {item.title}
            </h3>
            {brandDisplay && (
              <p style={{ margin: '2px 0 0', fontSize: font.size.sm, color: colors.textSecondary }}>
                {brandDisplay}
              </p>
            )}
          </div>
          <span style={badge(colors.successBg, colors.success)}>SOLD</span>
        </div>

        {/* Info grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: `${spacing.sm}px ${spacing.xl}px`,
          }}
        >
          <div>
            <div style={labelStyle}>Listed Price</div>
            <div style={valueStyle}>
              {item.currency === 'GBP' ? '£' : item.currency}{item.price}
            </div>
          </div>
          {item.total_item_price && (
            <div>
              <div style={labelStyle}>Sale Price</div>
              <div style={{ ...valueStyle, color: colors.success, fontWeight: font.weight.bold }}>
                {item.currency === 'GBP' ? '£' : item.currency}{item.total_item_price}
              </div>
            </div>
          )}
          <div>
            <div style={labelStyle}>Sale Date</div>
            <div style={valueStyle}>{formatDate(item.sold_at)}</div>
          </div>
          {item.order_confirmed_at && (
            <div>
              <div style={labelStyle}>Order Confirmed</div>
              <div style={valueStyle}>{formatDate(item.order_confirmed_at)}</div>
            </div>
          )}
          {item.buyer_login && (
            <div>
              <div style={labelStyle}>Buyer</div>
              <div style={{ ...valueStyle, color: colors.primary }}>@{item.buyer_login}</div>
            </div>
          )}
          <div>
            <div style={labelStyle}>Sale ID</div>
            <div style={{ ...valueStyle, fontFamily: font.mono, fontSize: font.size.sm, color: colors.textMuted }}>
              {item.transaction_id ?? item.id}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap', marginTop: spacing.xs }}>
          <button
            type="button"
            onClick={() => onOpenListing(item)}
            style={actionBtnStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = colors.glassBorderHover;
              e.currentTarget.style.background = colors.glassBgHover;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = colors.glassBorder;
              e.currentTarget.style.background = colors.glassHighlight;
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            View Listing
          </button>
          {(item.conversation_id || item.buyer_id) && (
            <button
              type="button"
              onClick={() => onOpenChat(item)}
              style={actionBtnStyle}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = colors.glassBorderHover;
                e.currentTarget.style.background = colors.glassBgHover;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = colors.glassBorder;
                e.currentTarget.style.background = colors.glassHighlight;
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              Chat with Buyer
            </button>
          )}
          <button
            type="button"
            onClick={() => onEditItem(item)}
            style={actionBtnStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = colors.primaryMuted;
              e.currentTarget.style.background = colors.primaryMuted;
              e.currentTarget.style.color = colors.primary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = colors.glassBorder;
              e.currentTarget.style.background = colors.glassHighlight;
              e.currentTarget.style.color = colors.textPrimary;
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Edit Item
          </button>
        </div>
      </div>
    </div>
  );
}
