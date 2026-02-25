/**
 * Feed — grid of items from search URLs
 * Revolut-inspired glass card design
 */

import React, { useEffect, useState } from 'react';
import {
  colors,
  font,
  glassPanel,
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
        <div style={{ ...glassPanel, padding: spacing['4xl'], textAlign: 'center', maxWidth: 400 }}>
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
        <div style={{ ...glassPanel, padding: spacing['4xl'], textAlign: 'center', maxWidth: 400 }}>
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
          ...glassPanel,
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
          gap: spacing.lg,
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
        ...glassPanel,
        overflow: 'hidden',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        transition: transition.base,
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
        boxShadow: hovered ? shadows.cardHover : shadows.card,
        borderColor: hovered ? colors.glassBorderHover : colors.glassBorder,
      }}
    >
      {/* Image */}
      <div
        style={{
          aspectRatio: '1',
          background: colors.bgElevated,
          position: 'relative',
          overflow: 'hidden',
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
            fontWeight: font.weight.semibold,
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
        <div style={{ fontSize: font.size.lg, fontWeight: font.weight.bold, color: colors.primary }}>
          £{item.price} {item.currency}
        </div>
        {item.condition && (
          <span style={{ fontSize: font.size.sm, color: colors.textMuted, marginTop: 2, display: 'block' }}>
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
