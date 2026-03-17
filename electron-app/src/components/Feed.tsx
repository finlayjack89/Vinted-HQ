/**
 * Feed — grid of items from search URLs
 * Revolut-inspired glass card design
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';

import {
  colors,
  font,
  frostedCard,
  btnPrimary,
  btnSecondary,
  btnSmall,
  radius,
  spacing,
  transition,
  shadows,
  badge,
  glassPanel,
  modalOverlay,
  modalContent,
} from '../theme';
import GlassSkeleton from './GlassSkeleton';
import type { FeedItem } from '../types/global';

export default function Feed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [hasCookie, setHasCookie] = useState(false);
  const [searchUrlCount, setSearchUrlCount] = useState(0);
  const [buyingId, setBuyingId] = useState<number | null>(null);
  const [buyProgress, setBuyProgress] = useState<string | null>(null);
  const [buyResult, setBuyResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [selectedItem, setSelectedItem] = useState<FeedItem | null>(null);

  // ── Scroll-aware update buffering ──
  // Buffer IPC data during active scroll to avoid React re-renders blocking frames
  const isScrollingRef = useRef(false);
  const pendingItemsRef = useRef<FeedItem[] | null>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPendingItems = useCallback(() => {
    const pending = pendingItemsRef.current;
    if (!pending) return;
    pendingItemsRef.current = null;
    setItems((prev) => {
      // Deduplicate: skip update if same item IDs in same order
      if (prev.length === pending.length && prev.every((p, i) => p.id === pending[i].id)) {
        return prev; // same reference → no re-render
      }
      const prevIds = new Set(prev.map((i) => i.id));
      const added = pending.filter((i) => !prevIds.has(i.id)).length;
      if (added > 0 && prev.length > 0) setNewCount((n) => n + added);
      return pending;
    });
  }, []);

  // Listen for scroll on the nearest scrollable ancestor (<main> in App.tsx)
  useEffect(() => {
    const scrollParent = document.querySelector('main');
    if (!scrollParent) return;

    const onScroll = () => {
      isScrollingRef.current = true;
      // Reset debounce timer — treat scroll as "still active" for 150ms after last event
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => {
        isScrollingRef.current = false;
        flushPendingItems();
      }, 150);
    };

    scrollParent.addEventListener('scroll', onScroll, { passive: true });
    return () => scrollParent.removeEventListener('scroll', onScroll);
  }, [flushPendingItems]);

  useEffect(() => {
    window.vinted.hasCookie().then(setHasCookie);
    window.vinted.getSearchUrls().then((urls) => setSearchUrlCount(urls.filter((u) => u.enabled).length));
    window.vinted.isFeedPolling().then(setIsPolling);

    const unsubscribe = window.vinted.onFeedItems((newItems) => {
      if (isScrollingRef.current) {
        // Buffer: don't trigger React re-render while scrolling
        pendingItemsRef.current = newItems;
        return;
      }
      setItems((prev) => {
        // Deduplicate: skip update if same item IDs in same order
        if (prev.length === newItems.length && prev.every((p, i) => p.id === newItems[i].id)) {
          return prev; // same reference → no re-render
        }
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

  // Lock scroll on <main> when modal is open
  useEffect(() => {
    const main = document.querySelector('main');
    if (!main) return;
    if (selectedItem) {
      main.style.overflow = 'hidden';
    } else {
      main.style.overflow = 'auto';
    }
    return () => { main.style.overflow = 'auto'; };
  }, [selectedItem]);

  const handleBuy = useCallback(async (item: FeedItem) => {
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
  }, []);

  const handleToggle = useCallback((id: number) => {
    setSelectedItem((prev) => {
      if (prev?.id === id) return null;
      return items.find((i) => i.id === id) ?? null;
    });
  }, [items]);

  const handleDismissNew = () => setNewCount(0);

  /* ─── Empty states ───────────────────────────────────── */

  if (!hasCookie) {
    return (
      <div style={{ padding: spacing['3xl'], display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ ...frostedCard, padding: spacing['4xl'], textAlign: 'center', maxWidth: 400 }}>
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
        <div style={{ ...frostedCard, padding: spacing['4xl'], textAlign: 'center', maxWidth: 400 }}>
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
    <div className="page-enter" style={{ padding: spacing['2xl'], display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      {/* Status bar */}
      <div
        style={{
          ...frostedCard,
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
            onToggle={handleToggle}
            isBuying={buyingId === item.id}
          />
        ))}
      </div>

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

      {/* ─── Item Detail Modal (portaled to body for correct viewport centering) ── */}
      {selectedItem && ReactDOM.createPortal(
        <div
          style={modalOverlay}
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedItem(null); }}
        >
          <div
            style={{
              ...modalContent,
              maxWidth: 460,
              maxHeight: '85vh',
              overflow: 'auto',
              padding: spacing.lg,
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: font.size.base, fontWeight: font.weight.bold, color: colors.textPrimary, letterSpacing: '-0.02em' }}>
                Item Details
              </h3>
              <button type="button" onClick={() => setSelectedItem(null)}
                style={{ background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', fontSize: 24, padding: 4 }}>✕</button>
            </div>

            {/* Photo + Details Container */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
              {selectedItem.photo_url && (
                <div style={{ width: '80%', aspectRatio: '4 / 5', borderRadius: radius.lg, overflow: 'hidden', margin: '0 auto' }}>
                  <img src={selectedItem.photo_url} alt={selectedItem.title}
                    loading="lazy" decoding="async"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              )}
              
              <div style={{ flex: 1 }}>
                <h4 style={{ margin: '0 0 4px', fontSize: font.size.base, color: colors.textPrimary, fontWeight: font.weight.semibold }}>{selectedItem.title}</h4>
                {selectedItem.seller_login && (
                  <div style={{ fontSize: font.size.sm, color: colors.textSecondary, marginBottom: spacing.sm }}>Seller: <strong style={{ color: colors.textPrimary }}>@{selectedItem.seller_login}</strong></div>
                )}
                
                {/* Details Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: `${spacing.xs}px ${spacing.sm}px`, background: 'rgba(255, 255, 255, 0.2)', padding: spacing.md, borderRadius: radius.md, border: `1px solid ${colors.glassBorder}` }}>
                  <div>
                    <div style={{ fontSize: font.size.xs, color: colors.textMuted, fontWeight: font.weight.medium, textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 2 }}>Price</div>
                    <div style={{ fontSize: font.size.base, fontWeight: font.weight.bold, color: colors.success }}>£{selectedItem.price} {selectedItem.currency}</div>
                  </div>
                  {selectedItem.size && (
                    <div>
                      <div style={{ fontSize: font.size.xs, color: colors.textMuted, fontWeight: font.weight.medium, textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 2 }}>Size</div>
                      <div style={{ fontSize: font.size.base, fontWeight: font.weight.medium, color: colors.textPrimary }}>{selectedItem.size}</div>
                    </div>
                  )}
                  {selectedItem.brand && (
                    <div>
                      <div style={{ fontSize: font.size.xs, color: colors.textMuted, fontWeight: font.weight.medium, textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 2 }}>Brand</div>
                      <div style={{ fontSize: font.size.base, fontWeight: font.weight.medium, color: colors.textPrimary }}>{selectedItem.brand}</div>
                    </div>
                  )}
                  {selectedItem.condition && (
                    <div>
                      <div style={{ fontSize: font.size.xs, color: colors.textMuted, fontWeight: font.weight.medium, textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 2 }}>Condition</div>
                      <div style={{ fontSize: font.size.base, fontWeight: font.weight.medium, color: colors.textPrimary }}>{selectedItem.condition}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Buy progress */}
            {buyProgress && buyingId === selectedItem.id && (
              <div style={{ fontSize: font.size.sm, color: colors.primary, fontWeight: font.weight.medium }}>{buyProgress}</div>
            )}
            {buyResult && (
              <div style={{ fontSize: font.size.sm, color: buyResult.ok ? colors.success : colors.error, fontWeight: font.weight.medium }}>{buyResult.message}</div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: spacing.sm, paddingTop: spacing.sm }}>
              <button
                type="button"
                onClick={() => handleBuy(selectedItem)}
                disabled={buyingId !== null}
                style={{
                  ...btnPrimary,
                  ...btnSmall,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  opacity: buyingId !== null ? 0.5 : 1,
                  cursor: buyingId !== null ? 'default' : 'pointer',
                }}
              >
                Buy Now
              </button>
              <a
                href={selectedItem.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  ...btnSecondary,
                  ...btnSmall,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  textDecoration: 'none',
                }}
              >
                Open on Vinted →
              </a>
              <button type="button" style={{ ...btnSecondary, ...btnSmall }} onClick={() => setSelectedItem(null)}>Close</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

const FeedItemCard = React.memo(function FeedItemCard({
  item,
  onToggle,
  isBuying,
}: {
  item: FeedItem;
  onToggle: (id: number) => void;
  isBuying: boolean;
}) {
  return (
    <div
      className="feed-card"
      onClick={() => onToggle(item.id)}
      style={{
        ...frostedCard,
        cursor: 'pointer',
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
        }}
      >
        {item.photo_url ? (
          <img
            src={item.photo_url}
            alt={item.title}
            loading="lazy"
            decoding="async"
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
    </div>
  );
});
