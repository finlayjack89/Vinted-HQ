/**
 * Feed — list/grid of items from search URLs
 */

import React, { useEffect, useState } from 'react';
import type { FeedItem } from '../types/global';

export default function Feed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [hasCookie, setHasCookie] = useState(false);
  const [searchUrlCount, setSearchUrlCount] = useState(0);

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

  const handleDismissNew = () => setNewCount(0);

  if (!hasCookie) {
    return (
      <div style={{ padding: 24, color: '#666' }}>
        <p>Connect your Vinted session in Settings to see the feed.</p>
      </div>
    );
  }

  if (searchUrlCount === 0) {
    return (
      <div style={{ padding: 24, color: '#666' }}>
        <p>Add search URLs in Settings and enable them to start the feed.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <span style={{ fontSize: 14, color: '#666' }}>
          {items.length} items · {isPolling ? 'Polling active' : 'Polling paused'}
        </span>
        {newCount > 0 && (
          <button
            type="button"
            onClick={handleDismissNew}
            style={{
              padding: '6px 12px',
              background: '#09f',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {newCount} new — dismiss
          </button>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 16,
          alignContent: 'start',
        }}
      >
        {items.map((item) => (
          <FeedItemCard
            key={item.id}
            item={item}
            expanded={expandedId === item.id}
            onToggle={() => setExpandedId((id) => (id === item.id ? null : item.id))}
          />
        ))}
      </div>

      {items.length === 0 && (
        <p style={{ color: '#999', textAlign: 'center', padding: 48 }}>
          No items yet. Polling runs every few seconds — check back shortly.
        </p>
      )}
    </div>
  );
}

function FeedItemCard({
  item,
  expanded,
  onToggle,
}: {
  item: FeedItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        border: '1px solid #e0e0e0',
        borderRadius: 8,
        overflow: 'hidden',
        cursor: 'pointer',
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ aspectRatio: '1', background: '#f5f5f5', position: 'relative' }}>
        {item.photo_url ? (
          <img
            src={item.photo_url}
            alt={item.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
            No image
          </div>
        )}
      </div>
      <div style={{ padding: 12, flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }} title={item.title}>
          {item.title.length > 60 ? item.title.slice(0, 60) + '…' : item.title}
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#09f' }}>
          £{item.price} {item.currency}
        </div>
        {item.condition && <span style={{ fontSize: 12, color: '#666' }}>{item.condition}</span>}
      </div>
      {expanded && (
        <div
          style={{
            padding: 12,
            borderTop: '1px solid #eee',
            fontSize: 12,
            color: '#666',
            background: '#fafafa',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {item.size && <div>Size: {item.size}</div>}
          {item.brand && <div>Brand: {item.brand}</div>}
          {item.seller_login && <div>Seller: {item.seller_login}</div>}
          {item.source_urls.length > 1 && <div>From {item.source_urls.length} searches</div>}
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ color: '#09f', marginTop: 8, display: 'inline-block' }}
          >
            Open on Vinted →
          </a>
        </div>
      )}
    </div>
  );
}
