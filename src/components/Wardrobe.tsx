/**
 * Wardrobe Dashboard — inventory management, sync, and stealth relist queue.
 * Sub-tabs: Live | Local Only | Discrepancies | Queue (Waiting Room)
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  colors,
  font,
  glassPanel,
  glassInput,
  glassTextarea,
  glassSelect,
  btnPrimary,
  btnSecondary,
  btnDanger,
  btnSmall,
  badge,
  tableHeaderCell,
  tableCell,
  tableRowHoverBg,
  modalOverlay,
  modalContent,
  radius,
  spacing,
  transition,
  sectionTitle,
} from '../theme';
import type { InventoryItem, RelistQueueEntry, OntologyEntity } from '../types/global';

type SubTab = 'live' | 'local' | 'discrepancy' | 'queue';

// ─── Main Component ─────────────────────────────────────────────────────────

export default function Wardrobe() {
  const [subTab, setSubTab] = useState<SubTab>('live');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [queue, setQueue] = useState<RelistQueueEntry[]>([]);
  const [countdown, setCountdown] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number } | null>(null);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [ontologyAlert, setOntologyAlert] = useState<{ deletedCategories: unknown[]; affectedItems: unknown[] } | null>(null);

  // ── Data loading ──
  const loadItems = useCallback(async () => {
    try {
      const data = await window.vinted.getWardrobe();
      setItems(data ?? []);
    } catch (err) {
      console.error('Failed to load wardrobe:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
    window.vinted.getRelistQueue().then((data) => {
      setQueue(data.queue ?? []);
      setCountdown(data.countdown ?? 0);
    });
  }, [loadItems]);

  // ── Event listeners ──
  useEffect(() => {
    const unsubQueue = window.vinted.onQueueUpdate((data) => {
      setQueue(data.queue as RelistQueueEntry[]);
      setCountdown(data.countdown);
      setProcessing(data.processing);
    });
    const unsubOntology = window.vinted.onOntologyAlert((data) => {
      setOntologyAlert(data as { deletedCategories: unknown[]; affectedItems: unknown[] });
      loadItems(); // Refresh items after ontology change
    });
    const unsubSync = window.vinted.onSyncProgress((data) => {
      if (data.stage === 'starting') {
        setSyncing(true);
        setSyncProgress({ current: 0, total: 0 });
      } else if (data.stage === 'progress') {
        setSyncProgress({ current: data.current, total: data.total });
      } else {
        setSyncing(false);
        setSyncProgress(null);
        loadItems();
      }
    });

    return () => {
      unsubQueue();
      unsubOntology();
      unsubSync();
    };
  }, [loadItems]);

  // ── Derived lists ──
  const liveItems = items.filter((i) => i.status === 'live' || i.status === 'discrepancy');
  const localItems = items.filter((i) => i.status === 'local_only');
  const discrepancyItems = items.filter((i) => i.status === 'discrepancy' || i.status === 'action_required');

  // ── Actions ──
  const handleSync = async () => {
    setSyncing(true);
    try {
      const userId = await window.vinted.getVintedUserId();
      if (!userId) {
        console.error('Sync failed: Could not determine Vinted user ID. Please refresh your session first.');
        setSyncing(false);
        return;
      }
      await window.vinted.pullFromVinted(userId);
    } catch (err) {
      console.error('Sync failed:', err);
    }
    setSyncing(false);
    loadItems();
  };

  const handleRefreshOntology = async () => {
    await window.vinted.refreshOntology();
  };

  const handleRelist = async (localIds: number[]) => {
    await window.vinted.enqueueRelist(localIds);
  };

  const handlePush = async (localId: number) => {
    await window.vinted.pushToVinted(localId);
    loadItems();
  };

  const handleDelete = async (localId: number) => {
    await window.vinted.deleteWardrobeItem(localId);
    loadItems();
  };

  const handleSaveEdit = async (data: Record<string, unknown>) => {
    await window.vinted.upsertWardrobeItem(data as { title: string; price: number; id?: number });
    setEditingItem(null);
    loadItems();
  };

  const subTabCounts: Record<SubTab, number> = {
    live: liveItems.length,
    local: localItems.length,
    discrepancy: discrepancyItems.length,
    queue: queue.length,
  };

  const subTabLabels: Record<SubTab, string> = {
    live: 'Live',
    local: 'Local Only',
    discrepancy: 'Discrepancies',
    queue: 'Queue',
  };

  return (
    <div style={{ padding: spacing['2xl'], maxWidth: 1200, margin: '0 auto' }}>
      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xl }}>
        <h2 style={{ ...sectionTitle, marginBottom: 0, fontSize: font.size['2xl'] }}>Wardrobe</h2>
        <div style={{ display: 'flex', gap: spacing.sm }}>
          <button
            type="button"
            onClick={handleRefreshOntology}
            style={{ ...btnSecondary, ...btnSmall }}
          >
            Refresh Ontology
          </button>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            style={{
              ...btnPrimary,
              ...btnSmall,
              opacity: syncing ? 0.6 : 1,
              cursor: syncing ? 'default' : 'pointer',
            }}
          >
            {syncing
              ? syncProgress
                ? `Syncing ${syncProgress.current}/${syncProgress.total}...`
                : 'Syncing...'
              : 'Sync from Vinted'}
          </button>
        </div>
      </div>

      {/* ── Sub-tab Navigation ── */}
      <div
        style={{
          display: 'flex',
          gap: 2,
          marginBottom: spacing.xl,
          background: colors.glassBg,
          borderRadius: radius.lg,
          padding: 3,
          border: `1px solid ${colors.glassBorder}`,
        }}
      >
        {(['live', 'local', 'discrepancy', 'queue'] as SubTab[]).map((t) => {
          const active = subTab === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setSubTab(t)}
              style={{
                flex: 1,
                padding: '10px 16px',
                borderRadius: radius.md,
                border: 'none',
                background: active ? colors.primaryMuted : 'transparent',
                color: active ? colors.primary : colors.textSecondary,
                fontWeight: active ? font.weight.semibold : font.weight.medium,
                fontSize: font.size.sm,
                cursor: 'pointer',
                transition: transition.base,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {subTabLabels[t]}
              {subTabCounts[t] > 0 && (
                <span
                  style={{
                    ...badge(
                      t === 'discrepancy' ? colors.warningBg : t === 'queue' ? colors.infoBg : colors.glassHighlight,
                      t === 'discrepancy' ? colors.warning : t === 'queue' ? colors.info : colors.textSecondary
                    ),
                    fontSize: 10,
                    padding: '1px 6px',
                  }}
                >
                  {subTabCounts[t]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Content ── */}
      {loading ? (
        <div style={{ textAlign: 'center', color: colors.textMuted, padding: spacing['4xl'] }}>
          Loading wardrobe...
        </div>
      ) : (
        <>
          {subTab === 'live' && (
            <ItemTable
              items={liveItems}
              onRelist={(id) => handleRelist([id])}
              onEdit={(item) => setEditingItem(item)}
              showDiscrepancyBadge
              emptyMessage="No live listings. Sync from Vinted to import your wardrobe."
            />
          )}
          {subTab === 'local' && (
            <ItemTable
              items={localItems}
              onPush={handlePush}
              onEdit={(item) => setEditingItem(item)}
              onDelete={handleDelete}
              emptyMessage="No local-only items. Create new listings or sync from Vinted."
            />
          )}
          {subTab === 'discrepancy' && (
            <DiscrepancyView
              items={discrepancyItems}
              onEdit={(item) => setEditingItem(item)}
              onPush={handlePush}
            />
          )}
          {subTab === 'queue' && (
            <WaitingRoom
              queue={queue}
              countdown={countdown}
              processing={processing}
              onRemove={(localId) => window.vinted.dequeueRelist(localId)}
              onClear={() => window.vinted.clearRelistQueue()}
            />
          )}
        </>
      )}

      {/* ── Edit Modal ── */}
      {editingItem && (
        <EditItemModal
          item={editingItem}
          onSave={handleSaveEdit}
          onClose={() => setEditingItem(null)}
        />
      )}

      {/* ── Ontology Alert Modal ── */}
      {ontologyAlert && (
        <div style={modalOverlay} onClick={() => setOntologyAlert(null)}>
          <div style={{ ...modalContent, maxWidth: 520 }} onClick={(e) => e.stopPropagation()} className="animate-fadeInScale">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: spacing.lg }}>
              <div style={{
                width: 40, height: 40, borderRadius: radius.md,
                background: colors.warningBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={colors.warning} strokeWidth="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: font.size.lg, fontWeight: font.weight.semibold, color: colors.textPrimary }}>
                  Category Changes Detected
                </h3>
                <p style={{ margin: 0, fontSize: font.size.sm, color: colors.textSecondary }}>
                  {(ontologyAlert.affectedItems as unknown[]).length} item(s) need attention
                </p>
              </div>
            </div>
            <div style={{ marginBottom: spacing.lg, maxHeight: 200, overflow: 'auto' }}>
              {(ontologyAlert.affectedItems as { localId: number; title: string; oldCategory: string }[]).map((ai) => (
                <div key={ai.localId} style={{ padding: '8px 0', borderBottom: `1px solid ${colors.separator}`, fontSize: font.size.sm }}>
                  <span style={{ color: colors.textPrimary }}>{ai.title}</span>
                  <span style={{ color: colors.textMuted, marginLeft: 8 }}>({ai.oldCategory})</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: spacing.sm }}>
              <button type="button" onClick={() => { setOntologyAlert(null); setSubTab('discrepancy'); }} style={{ ...btnPrimary, ...btnSmall, flex: 1 }}>
                Review Items
              </button>
              <button type="button" onClick={() => setOntologyAlert(null)} style={{ ...btnSecondary, ...btnSmall }}>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Item Table (Live & Local Only) ─────────────────────────────────────────

function ItemTable({
  items,
  onRelist,
  onPush,
  onEdit,
  onDelete,
  showDiscrepancyBadge,
  emptyMessage,
}: {
  items: InventoryItem[];
  onRelist?: (localId: number) => void;
  onPush?: (localId: number) => void;
  onEdit?: (item: InventoryItem) => void;
  onDelete?: (localId: number) => void;
  showDiscrepancyBadge?: boolean;
  emptyMessage: string;
}) {
  if (items.length === 0) {
    return (
      <div style={{ ...glassPanel, padding: spacing['4xl'], textAlign: 'center', color: colors.textMuted }}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div style={{ ...glassPanel, overflow: 'hidden', padding: 0 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
            <th style={tableHeaderCell}>Image</th>
            <th style={tableHeaderCell}>Title</th>
            <th style={tableHeaderCell}>Price</th>
            <th style={tableHeaderCell}>Status</th>
            <th style={tableHeaderCell}>Relists</th>
            <th style={{ ...tableHeaderCell, textAlign: 'right' as const }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              onRelist={onRelist}
              onPush={onPush}
              onEdit={onEdit}
              onDelete={onDelete}
              showDiscrepancyBadge={showDiscrepancyBadge}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ItemRow({
  item,
  onRelist,
  onPush,
  onEdit,
  onDelete,
  showDiscrepancyBadge,
}: {
  item: InventoryItem;
  onRelist?: (localId: number) => void;
  onPush?: (localId: number) => void;
  onEdit?: (item: InventoryItem) => void;
  onDelete?: (localId: number) => void;
  showDiscrepancyBadge?: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  const photoUrl = item.photo_urls?.[0] ?? item.local_image_paths?.[0] ?? '';
  const isLocalPath = photoUrl.startsWith('/') || photoUrl.startsWith('C:');

  return (
    <tr
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ background: hovered ? tableRowHoverBg : 'transparent', transition: transition.fast }}
    >
      <td style={tableCell}>
        <div style={{
          width: 56, height: 56, borderRadius: radius.md, overflow: 'hidden',
          background: colors.glassBg, flexShrink: 0,
        }}>
          {photoUrl && (
            <img
              src={isLocalPath ? `file://${photoUrl}` : photoUrl}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          )}
        </div>
      </td>
      <td style={tableCell}>
        <div style={{ fontWeight: font.weight.medium, color: colors.textPrimary, marginBottom: 2 }}>
          {item.title}
        </div>
        {item.brand_name && (
          <div style={{ fontSize: font.size.xs, color: colors.textMuted }}>{item.brand_name}</div>
        )}
      </td>
      <td style={tableCell}>
        <span style={{ fontWeight: font.weight.semibold, color: colors.textPrimary }}>
          {item.currency === 'GBP' ? '£' : item.currency}{item.price}
        </span>
      </td>
      <td style={tableCell}>
        <StatusBadge status={item.status} showDiscrepancy={showDiscrepancyBadge} />
      </td>
      <td style={tableCell}>
        <span style={{ color: colors.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
          {item.relist_count}
        </span>
      </td>
      <td style={{ ...tableCell, textAlign: 'right' as const }}>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          {onEdit && (
            <button type="button" onClick={() => onEdit(item)} style={actionBtn}>
              Edit
            </button>
          )}
          {onRelist && item.vinted_item_id && (
            <button type="button" onClick={() => onRelist(item.id)} style={{ ...actionBtn, color: colors.primary }}>
              Relist
            </button>
          )}
          {onPush && (
            <button type="button" onClick={() => onPush(item.id)} style={{ ...actionBtn, color: colors.success }}>
              Push
            </button>
          )}
          {item.vinted_item_id && (
            <a
              href={`https://www.vinted.co.uk/items/${item.vinted_item_id}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...actionBtn, textDecoration: 'none' }}
            >
              Open
            </a>
          )}
          {onDelete && (
            <button type="button" onClick={() => onDelete(item.id)} style={{ ...actionBtn, color: colors.error }}>
              Del
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

const actionBtn: React.CSSProperties = {
  background: colors.glassHighlight,
  border: `1px solid ${colors.glassBorder}`,
  borderRadius: radius.sm,
  padding: '4px 10px',
  fontSize: font.size.xs,
  fontWeight: font.weight.medium,
  color: colors.textSecondary,
  cursor: 'pointer',
  transition: transition.fast,
  fontFamily: font.family,
};

function StatusBadge({ status, showDiscrepancy }: { status: string; showDiscrepancy?: boolean }) {
  if (status === 'action_required') return <span style={badge(colors.errorBg, colors.error)}>Action Required</span>;
  if (status === 'discrepancy' && showDiscrepancy) return <span style={badge(colors.warningBg, colors.warning)}>Discrepancy</span>;
  if (status === 'live') return <span style={badge(colors.successBg, colors.success)}>Live</span>;
  if (status === 'local_only') return <span style={badge(colors.glassBg, colors.textMuted)}>Local</span>;
  return <span style={badge(colors.glassBg, colors.textMuted)}>{status}</span>;
}

// ─── Discrepancy View ───────────────────────────────────────────────────────

function DiscrepancyView({
  items,
  onEdit,
  onPush,
}: {
  items: InventoryItem[];
  onEdit: (item: InventoryItem) => void;
  onPush: (localId: number) => void;
}) {
  if (items.length === 0) {
    return (
      <div style={{ ...glassPanel, padding: spacing['4xl'], textAlign: 'center', color: colors.textMuted }}>
        No discrepancies. Local vault is in sync with Vinted.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
      {items.filter((i) => i.status === 'action_required').length > 0 && (
        <div style={{
          ...glassPanel, padding: spacing.lg,
          borderColor: 'rgba(248, 113, 113, 0.3)',
          background: 'rgba(248, 113, 113, 0.05)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: spacing.sm }}>
            <span style={badge(colors.errorBg, colors.error)}>Action Required</span>
            <span style={{ fontSize: font.size.sm, color: colors.textSecondary }}>
              These items have broken category references from ontology changes
            </span>
          </div>
        </div>
      )}

      <ItemTable
        items={items}
        onEdit={onEdit}
        onPush={onPush}
        showDiscrepancyBadge
        emptyMessage="No discrepancies."
      />
    </div>
  );
}

// ─── Waiting Room (Queue) ───────────────────────────────────────────────────

function WaitingRoom({
  queue,
  countdown,
  processing,
  onRemove,
  onClear,
}: {
  queue: RelistQueueEntry[];
  countdown: number;
  processing: boolean;
  onRemove: (localId: number) => void;
  onClear: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      {/* Countdown + Controls */}
      <div style={{ display: 'flex', gap: spacing.lg }}>
        {/* Countdown Timer */}
        <div style={{
          ...glassPanel, padding: spacing.xl, flex: 1,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: 120,
        }}>
          {processing && countdown > 0 ? (
            <>
              <div style={{ fontSize: font.size.xs, color: colors.textMuted, textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: spacing.sm }}>
                Next relist in
              </div>
              <div style={{
                fontSize: 48, fontWeight: font.weight.bold, color: colors.primary,
                fontFamily: font.mono, fontVariantNumeric: 'tabular-nums',
                lineHeight: 1,
              }}>
                {countdown}s
              </div>
            </>
          ) : processing ? (
            <div style={{ fontSize: font.size.lg, color: colors.primary }} className="animate-pulse">
              Processing...
            </div>
          ) : (
            <div style={{ color: colors.textMuted, fontSize: font.size.base }}>
              {queue.length === 0 ? 'No items queued' : `${queue.filter((e) => e.status === 'pending').length} item(s) ready`}
            </div>
          )}
        </div>

        {/* Queue Controls */}
        <div style={{ ...glassPanel, padding: spacing.xl, display: 'flex', flexDirection: 'column', gap: spacing.sm, minWidth: 160 }}>
          <div style={{ fontSize: font.size.sm, fontWeight: font.weight.semibold, color: colors.textSecondary, marginBottom: spacing.xs }}>
            Controls
          </div>
          <button
            type="button"
            onClick={onClear}
            disabled={queue.length === 0}
            style={{
              ...btnDanger,
              ...btnSmall,
              opacity: queue.length === 0 ? 0.4 : 1,
              cursor: queue.length === 0 ? 'default' : 'pointer',
            }}
          >
            Clear Queue
          </button>
          <div style={{ fontSize: font.size.xs, color: colors.textMuted }}>
            Done: {queue.filter((e) => e.status === 'done').length} |{' '}
            Errors: {queue.filter((e) => e.status === 'error').length}
          </div>
        </div>
      </div>

      {/* Queue Table */}
      {queue.length === 0 ? (
        <div style={{ ...glassPanel, padding: spacing['4xl'], textAlign: 'center', color: colors.textMuted }}>
          No items queued for relisting. Select items from the Live tab and click "Relist".
        </div>
      ) : (
        <div style={{ ...glassPanel, overflow: 'hidden', padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                <th style={tableHeaderCell}>Preview</th>
                <th style={tableHeaderCell}>Title</th>
                <th style={tableHeaderCell}>Price</th>
                <th style={tableHeaderCell}>Status</th>
                <th style={tableHeaderCell}>Relists</th>
                <th style={{ ...tableHeaderCell, textAlign: 'right' as const }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((entry) => (
                <QueueRow key={entry.localId} entry={entry} onRemove={onRemove} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function QueueRow({ entry, onRemove }: { entry: RelistQueueEntry; onRemove: (localId: number) => void }) {
  const [hovered, setHovered] = useState(false);
  const thumbSrc = entry.mutatedThumbnailPath
    ? `file://${entry.mutatedThumbnailPath}`
    : entry.thumbnailPath
      ? `file://${entry.thumbnailPath}`
      : '';

  const statusBadge = () => {
    switch (entry.status) {
      case 'pending': return <span style={badge(colors.glassBg, colors.textMuted)}>Pending</span>;
      case 'mutating': return <span style={badge(colors.warningBg, colors.warning)} className="animate-pulse">Mutating</span>;
      case 'uploading': return <span style={badge(colors.infoBg, colors.info)} className="animate-pulse">Uploading</span>;
      case 'done': return <span style={badge(colors.successBg, colors.success)}>Done</span>;
      case 'error': return <span style={badge(colors.errorBg, colors.error)} title={entry.error}>Error</span>;
    }
  };

  return (
    <tr
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ background: hovered ? tableRowHoverBg : 'transparent', transition: transition.fast }}
    >
      <td style={tableCell}>
        <div style={{
          width: 100, height: 100, borderRadius: radius.md, overflow: 'hidden',
          background: colors.glassBg, flexShrink: 0,
        }}>
          {thumbSrc && (
            <img
              src={thumbSrc}
              alt="Preview"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          )}
        </div>
      </td>
      <td style={tableCell}>
        <div style={{ fontWeight: font.weight.medium, color: colors.textPrimary, marginBottom: 4 }}>
          {entry.jitteredTitle}
        </div>
        {entry.jitteredTitle !== entry.title && (
          <div style={{ fontSize: font.size.xs, color: colors.textMuted }}>
            <span style={{ textDecoration: 'line-through' }}>{entry.title}</span>
          </div>
        )}
      </td>
      <td style={tableCell}>
        <span style={{ fontWeight: font.weight.semibold }}>£{entry.price}</span>
      </td>
      <td style={tableCell}>{statusBadge()}</td>
      <td style={tableCell}>
        <span style={{ fontVariantNumeric: 'tabular-nums', color: colors.textSecondary }}>
          {entry.relistCount} → {entry.relistCount + 1}
        </span>
      </td>
      <td style={{ ...tableCell, textAlign: 'right' as const }}>
        {entry.status === 'pending' && (
          <button type="button" onClick={() => onRemove(entry.localId)} style={{ ...actionBtn, color: colors.error }}>
            Remove
          </button>
        )}
      </td>
    </tr>
  );
}

// ─── Edit Item Modal ────────────────────────────────────────────────────────

function EditItemModal({
  item,
  onSave,
  onClose,
}: {
  item: InventoryItem;
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? '');
  const [price, setPrice] = useState(String(item.price));
  const [condition, setCondition] = useState(item.condition ?? '');
  const [brandName, setBrandName] = useState(item.brand_name ?? '');
  const [categories, setCategories] = useState<OntologyEntity[]>([]);
  const [conditionOptions, setConditionOptions] = useState<OntologyEntity[]>([]);
  const [colorOptions, setColorOptions] = useState<OntologyEntity[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState(item.category_id ?? 0);
  const [selectedColorIds, setSelectedColorIds] = useState<number[]>(item.color_ids ?? []);

  useEffect(() => {
    window.vinted.getOntology('category').then(setCategories).catch(() => {});
    window.vinted.getOntology('color').then(setColorOptions).catch(() => {});
    window.vinted.getOntology('condition').then(setConditionOptions).catch(() => {});
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      id: item.id,
      title: title.trim(),
      description: description.trim(),
      price: parseFloat(price) || 0,
      condition,
      brand_name: brandName.trim(),
      brand_id: item.brand_id,
      category_id: selectedCategoryId || null,
      color_ids: JSON.stringify(selectedColorIds),
      size_id: item.size_id,
      size_label: item.size_label,
      status_id: item.status_id,
      package_size_id: item.package_size_id,
      item_attributes: typeof item.item_attributes === 'string' ? item.item_attributes : JSON.stringify(item.item_attributes ?? []),
      photo_urls: typeof item.photo_urls === 'string' ? item.photo_urls : JSON.stringify(item.photo_urls ?? []),
      local_image_paths: typeof item.local_image_paths === 'string' ? item.local_image_paths : JSON.stringify(item.local_image_paths ?? []),
      status: item.vinted_item_id ? 'discrepancy' : item.status,
    });
  };

  const toggleColor = (id: number) => {
    setSelectedColorIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  return (
    <div style={modalOverlay} onClick={onClose}>
      <div
        style={{ ...modalContent, maxWidth: 600, maxHeight: '85vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
        className="animate-fadeInScale"
      >
        <h3 style={{ margin: '0 0 20px', fontSize: font.size.lg, fontWeight: font.weight.semibold, color: colors.textPrimary }}>
          Edit Listing
        </h3>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
          {/* Title */}
          <div>
            <label style={labelStyle}>Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{ ...glassInput, width: '100%' }}
              required
            />
          </div>

          {/* Description */}
          <div>
            <label style={labelStyle}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              style={{ ...glassTextarea, width: '100%' }}
            />
          </div>

          {/* Price + Brand Row */}
          <div style={{ display: 'flex', gap: spacing.md }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Price (GBP)</label>
              <input
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                style={{ ...glassInput, width: '100%' }}
                required
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Brand</label>
              <input
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                style={{ ...glassInput, width: '100%' }}
              />
            </div>
          </div>

          {/* Category */}
          <div>
            <label style={labelStyle}>Category</label>
            <select
              value={selectedCategoryId}
              onChange={(e) => setSelectedCategoryId(Number(e.target.value))}
              style={{ ...glassSelect, width: '100%' }}
            >
              <option value={0}>— Select Category —</option>
              {categories.map((c) => (
                <option key={c.entity_id} value={c.entity_id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Condition */}
          <div>
            <label style={labelStyle}>Condition</label>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              style={{ ...glassSelect, width: '100%' }}
            >
              <option value="">— Select Condition —</option>
              {conditionOptions.length > 0
                ? conditionOptions.map((c) => (
                    <option key={c.entity_id} value={c.name}>{c.name}</option>
                  ))
                : <>
                    <option value="New with tags">New with tags</option>
                    <option value="Very good">Very good</option>
                    <option value="Good">Good</option>
                    <option value="Satisfactory">Satisfactory</option>
                  </>
              }
            </select>
          </div>

          {/* Colors */}
          <div>
            <label style={labelStyle}>Colors</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {colorOptions.length > 0
                ? colorOptions.map((c) => {
                    const selected = selectedColorIds.includes(c.entity_id);
                    const extra = c.extra as Record<string, unknown> | null;
                    const hex = extra?.hex as string | undefined;
                    return (
                      <button
                        key={c.entity_id}
                        type="button"
                        onClick={() => toggleColor(c.entity_id)}
                        style={{
                          ...actionBtn,
                          background: selected ? colors.primaryMuted : colors.glassHighlight,
                          color: selected ? colors.primary : colors.textSecondary,
                          borderColor: selected ? colors.primary : colors.glassBorder,
                          display: 'flex', alignItems: 'center', gap: 4,
                        }}
                      >
                        {hex && <span style={{ width: 10, height: 10, borderRadius: '50%', background: hex, border: '1px solid rgba(255,255,255,0.2)' }} />}
                        {c.name}
                      </button>
                    );
                  })
                : <span style={{ color: colors.textMuted, fontSize: font.size.sm }}>
                    Refresh ontology to load color options
                  </span>
              }
            </div>
          </div>

          {/* Photos Preview */}
          {(item.photo_urls?.length > 0 || item.local_image_paths?.length > 0) && (
            <div>
              <label style={labelStyle}>Photos</label>
              <div style={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap' }}>
                {(item.local_image_paths?.length > 0 ? item.local_image_paths : item.photo_urls).map((url, i) => (
                  <div key={i} style={{
                    width: 72, height: 72, borderRadius: radius.md, overflow: 'hidden',
                    background: colors.glassBg, border: `1px solid ${colors.glassBorder}`,
                  }}>
                    <img
                      src={url.startsWith('/') ? `file://${url}` : url}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: spacing.sm, marginTop: spacing.sm }}>
            <button type="submit" style={{ ...btnPrimary, flex: 1 }}>
              Save Changes
            </button>
            <button type="button" onClick={onClose} style={btnSecondary}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: font.size.sm,
  fontWeight: font.weight.medium,
  color: colors.textSecondary,
  marginBottom: 6,
};
