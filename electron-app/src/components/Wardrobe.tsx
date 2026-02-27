/**
 * Wardrobe Dashboard — inventory management, sync, and stealth relist queue.
 * Sub-tabs: Live | Local Only | Discrepancies | Queue (Waiting Room)
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
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

type SubTab = 'all' | 'live' | 'local' | 'discrepancy' | 'queue';

// ─── Main Component ─────────────────────────────────────────────────────────

export default function Wardrobe() {
  const [subTab, setSubTab] = useState<SubTab>('all');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [queue, setQueue] = useState<RelistQueueEntry[]>([]);
  const [countdown, setCountdown] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number; message?: string } | null>(null);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [ontologyAlert, setOntologyAlert] = useState<{ deletedCategories: unknown[]; affectedItems: unknown[] } | null>(null);
  const [actionBusy, setActionBusy] = useState<null | { kind: 'push' | 'pull'; localId: number }>(null);

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
        setSyncProgress({ current: 0, total: 0, message: data.message });
      } else if (data.stage === 'progress') {
        setSyncProgress((prev) => ({
          current: data.current,
          total: data.total,
          message: data.message ?? prev?.message,
        }));
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
  const liveItems = items.filter((i) => ['live', 'discrepancy', 'hidden', 'reserved'].includes(i.status));
  const localItems = items.filter((i) => i.status === 'local_only');
  const discrepancyItems = items.filter((i) => i.status === 'discrepancy' || i.status === 'action_required');
  const soldItems = items.filter((i) => i.status === 'sold');

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
    setActionBusy({ kind: 'push', localId });
    try {
      const result = await window.vinted.pushToVinted(localId);
      if (!result?.ok) {
        window.alert(result?.error || 'Push failed');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      window.alert(`Push failed: ${msg}`);
    } finally {
      await loadItems();
      setActionBusy(null);
    }
  };

  const handlePull = async (localId: number) => {
    setActionBusy({ kind: 'pull', localId });
    try {
      const result = await window.vinted.pullLiveToLocal(localId);
      if (!result?.ok) {
        window.alert(result?.error || 'Pull failed');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      window.alert(`Pull failed: ${msg}`);
    } finally {
      await loadItems();
      setActionBusy(null);
    }
  };

  const handleDelete = async (localId: number) => {
    await window.vinted.deleteWardrobeItem(localId);
    loadItems();
  };

  const handleSaveEdit = async (data: Record<string, unknown>) => {
    const localId = data.id as number | undefined;
    const item = editingItem;
    try {
      // If the item is linked to a live Vinted listing, push changes to Vinted
      if (localId && item?.vinted_item_id) {
        const result = await window.vinted.editLiveItem(localId, data);
        if (!result.ok) {
          console.error('Failed to push edit to Vinted:', result.error);
          // Still saved locally — status will be 'discrepancy'
          return { ok: false, error: result.error || 'Failed to push edit to Vinted' };
        }
      } else {
        // Local-only item — just save locally
        await window.vinted.upsertWardrobeItem(data as { title: string; price: number; id?: number });
      }
      setEditingItem(null);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    } finally {
      await loadItems();
    }
  };

  const subTabCounts: Record<SubTab, number> = {
    all: items.length,
    live: liveItems.length,
    local: localItems.length,
    discrepancy: discrepancyItems.length,
    queue: queue.length,
  };

  const subTabLabels: Record<SubTab, string> = {
    all: 'All Items',
    live: 'Live',
    local: 'Local Only',
    discrepancy: 'Discrepancies',
    queue: 'Queue',
  };

  return (
    <div style={{ padding: spacing['2xl'], maxWidth: 1200, margin: '0 auto' }}>
      {actionBusy && (
        <div style={modalOverlay}>
          <div
            style={{ ...modalContent, maxWidth: 420, textAlign: 'center', background: colors.bgElevated, backdropFilter: 'none', WebkitBackdropFilter: 'none' }}
            onClick={(e) => e.stopPropagation()}
            className="animate-fadeInScale"
          >
            <div style={{ fontSize: font.size.lg, fontWeight: font.weight.semibold, color: colors.textPrimary }} className="animate-pulse">
              {actionBusy.kind === 'push' ? 'Pushing to Vinted…' : 'Pulling from Vinted…'}
            </div>
            <div style={{ marginTop: 8, fontSize: font.size.sm, color: colors.textSecondary, lineHeight: 1.5 }}>
              This can take a few seconds. Please don’t close the app.
            </div>
          </div>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div style={{ marginBottom: spacing.xl }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
        {syncing && syncProgress?.message && (
          <div style={{ marginTop: spacing.xs, fontSize: font.size.sm, color: colors.textSecondary }}>
            {syncProgress.message}
          </div>
        )}
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
        {(['all', 'live', 'local', 'discrepancy', 'queue'] as SubTab[]).map((t) => {
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
          {subTab === 'all' && (
            <ItemTable
              items={items}
              onRelist={(id) => handleRelist([id])}
              onEdit={(item) => setEditingItem(item)}
              onDelete={handleDelete}
              showDiscrepancyBadge
              emptyMessage="No items in your wardrobe. Sync from Vinted or create new listings."
            />
          )}
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
              onPull={handlePull}
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
  onPull,
  onEdit,
  onDelete,
  showDiscrepancyBadge,
  emptyMessage,
}: {
  items: InventoryItem[];
  onRelist?: (localId: number) => void;
  onPush?: (localId: number) => void;
  onPull?: (localId: number) => void;
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
              onPull={onPull}
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
  onPull,
  onEdit,
  onDelete,
  showDiscrepancyBadge,
}: {
  item: InventoryItem;
  onRelist?: (localId: number) => void;
  onPush?: (localId: number) => void;
  onPull?: (localId: number) => void;
  onEdit?: (item: InventoryItem) => void;
  onDelete?: (localId: number) => void;
  showDiscrepancyBadge?: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  const photoUrls = Array.isArray(item.photo_urls) ? item.photo_urls : [];
  const localPaths = Array.isArray(item.local_image_paths) ? item.local_image_paths : [];
  const photoUrl = localPaths[0] ?? photoUrls[0] ?? '';
  const isLocalPath = photoUrl.startsWith('/') || photoUrl.startsWith('C:');
  const imgSrc = isLocalPath ? `local-image://${encodeURI(photoUrl)}` : photoUrl;

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
              src={imgSrc}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
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
        {item.status === 'discrepancy' && item.discrepancy_reason === 'failed_push' && (
          <div style={{ fontSize: font.size.xs, color: colors.error }}>
            Last push failed — retry Push
          </div>
        )}
        {item.status === 'discrepancy' && item.discrepancy_reason === 'external_change' && (
          <div style={{ fontSize: font.size.xs, color: colors.textMuted }}>
            Live listing changed — Pull to accept or Push to overwrite
          </div>
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
          {onPull && item.vinted_item_id && (
            <button type="button" onClick={() => onPull(item.id)} style={{ ...actionBtn, color: colors.info }}>
              Pull
            </button>
          )}
          {onPush && (
            <button type="button" onClick={() => onPush(item.id)} style={{ ...actionBtn, color: colors.success }}>
              Push
            </button>
          )}
          {item.vinted_item_id && (
            <button
              type="button"
              onClick={async (e) => {
                const btn = e.currentTarget;
                btn.textContent = 'Syncing…';
                btn.disabled = true;
                try {
                  const res = await window.vinted.deepSync(item.vinted_item_id!);
                  btn.textContent = res.ok ? '✅ Synced!' : `❌ ${res.message || 'Failed'}`;
                  if (res.ok) setTimeout(() => { btn.textContent = 'Fetch Full Details'; btn.disabled = false; }, 2000);
                  else setTimeout(() => { btn.textContent = 'Fetch Full Details'; btn.disabled = false; }, 4000);
                } catch {
                  btn.textContent = '❌ Error';
                  setTimeout(() => { btn.textContent = 'Fetch Full Details'; btn.disabled = false; }, 3000);
                }
              }}
              style={{ ...actionBtn, color: '#10b981' }}
            >
              Fetch Full Details
            </button>
          )}
          {item.vinted_item_id && (
            <button
              type="button"
              onClick={() => window.vinted.openExternal(`https://www.vinted.co.uk/items/${item.vinted_item_id}/edit?hq_mode=true`)}
              style={{ ...actionBtn, color: colors.primary }}
            >
              Edit on Vinted
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
  if (status === 'discrepancy' && showDiscrepancy) return <span style={badge(colors.warningBg, colors.warning)}>Edited</span>;
  if (status === 'live') return <span style={badge(colors.successBg, colors.success)}>Active</span>;
  if (status === 'sold') return <span style={badge('rgba(99,102,241,0.15)', 'rgb(99,102,241)')}>Sold</span>;
  if (status === 'hidden') return <span style={badge('rgba(245,158,11,0.15)', 'rgb(245,158,11)')}>Hidden</span>;
  if (status === 'reserved') return <span style={badge('rgba(236,72,153,0.15)', 'rgb(236,72,153)')}>Reserved</span>;
  if (status === 'local_only') return <span style={badge(colors.glassBg, colors.textMuted)}>Local</span>;
  return <span style={badge(colors.glassBg, colors.textMuted)}>{status}</span>;
}

// ─── Discrepancy View ───────────────────────────────────────────────────────

function DiscrepancyView({
  items,
  onEdit,
  onPush,
  onPull,
}: {
  items: InventoryItem[];
  onEdit: (item: InventoryItem) => void;
  onPush: (localId: number) => void;
  onPull: (localId: number) => void;
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
        onPull={onPull}
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
    ? `local-image://${entry.mutatedThumbnailPath}`
    : entry.thumbnailPath
      ? `local-image://${entry.thumbnailPath}`
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

// ─── Searchable Select Component ─────────────────────────────────────────────

type SelectOption = { id: number; name: string; extra?: Record<string, unknown> | null };

function SearchableSelect({
  label,
  options,
  value,
  onChange,
  placeholder,
  renderOption,
  maxSelections = 1,
  onSearch,
  loading,
}: {
  label: string;
  options: SelectOption[];
  value: number | number[];
  onChange: (value: number | number[]) => void;
  placeholder?: string;
  renderOption?: (opt: SelectOption, selected: boolean) => React.ReactNode;
  maxSelections?: number;
  onSearch?: (keyword: string) => void;
  loading?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedIds = Array.isArray(value) ? value : (value ? [value] : []);
  const selectedNames = selectedIds
    .map((id) => options.find((o) => o.id === id)?.name)
    .filter(Boolean)
    .join(', ');

  const filtered = onSearch
    ? options
    : (search ? options.filter((o) => o.name.toLowerCase().includes(search.toLowerCase())) : options);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSearch = (val: string) => {
    setSearch(val);
    if (onSearch) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => { if (val.length >= 2) onSearch(val); }, 300);
    }
  };

  const toggle = (id: number, name?: string) => {
    if (maxSelections === 1) {
      onChange(id);
      setOpen(false);
      setSearch('');
      if (name) setSearch('');
    } else {
      const arr = Array.isArray(value) ? value : [];
      if (arr.includes(id)) {
        onChange(arr.filter((v) => v !== id));
      } else if (arr.length < maxSelections) {
        onChange([...arr, id]);
      }
    }
  };

  const clear = () => {
    onChange(maxSelections === 1 ? 0 : []);
    setSearch('');
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <label style={labelStyle}>{label}</label>
      <div
        onClick={() => setOpen(true)}
        style={{
          ...glassInput,
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          minHeight: 38,
        }}
      >
        {open ? (
          <input
            autoFocus
            type="text"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={placeholder ?? `Search ${label.toLowerCase()}...`}
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: colors.textPrimary,
              fontSize: font.size.sm,
              width: '100%',
              padding: 0,
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span style={{ color: selectedNames ? colors.textPrimary : colors.textMuted, fontSize: font.size.sm, flex: 1 }}>
            {selectedNames || placeholder || `Select ${label.toLowerCase()}...`}
          </span>
        )}
        {selectedIds.length > 0 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); clear(); }}
            style={{ background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', padding: '0 4px', fontSize: 14 }}
          >
            ×
          </button>
        )}
      </div>
      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          maxHeight: 200,
          overflow: 'auto',
          background: colors.bgElevated,
          border: `1px solid ${colors.glassBorder}`,
          borderRadius: radius.md,
          marginTop: 4,
          zIndex: 1000,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}>
          {loading ? (
            <div style={{ padding: '10px 12px', color: colors.textMuted, fontSize: font.size.sm }}>Searching...</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '10px 12px', color: colors.textMuted, fontSize: font.size.sm }}>
              {onSearch && search.length < 2 ? 'Type at least 2 characters...' : 'No results'}
            </div>
          ) : (
            filtered.slice(0, 100).map((opt) => {
              const sel = selectedIds.includes(opt.id);
              return (
                <div
                  key={opt.id}
                  onClick={() => toggle(opt.id, opt.name)}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    background: sel ? colors.primaryMuted : 'transparent',
                    color: sel ? colors.primary : colors.textPrimary,
                    fontSize: font.size.sm,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    transition: transition.fast,
                  }}
                  onMouseEnter={(e) => { if (!sel) (e.target as HTMLElement).style.background = colors.glassBgHover; }}
                  onMouseLeave={(e) => { if (!sel) (e.target as HTMLElement).style.background = 'transparent'; }}
                >
                  {renderOption ? renderOption(opt, sel) : opt.name}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ─── Hierarchical Category Select ────────────────────────────────────────────

function HierarchicalCategorySelect({
  categories,
  value,
  onChange,
}: {
  categories: OntologyEntity[];
  value: number;
  onChange: (id: number) => void;
}) {
  // Build tree: top-level (parent_id null) → children
  const topLevel = categories.filter((c) => !c.parent_id);
  const getChildren = (parentId: number) => categories.filter((c) => c.parent_id === parentId);

  // Find the chain from root to current value
  const findChain = (targetId: number): number[] => {
    const chain: number[] = [];
    let current = categories.find((c) => c.entity_id === targetId);
    while (current) {
      chain.unshift(current.entity_id);
      current = current.parent_id ? categories.find((c) => c.entity_id === current!.parent_id) : undefined;
    }
    return chain;
  };

  const chain = value ? findChain(value) : [];

  // Build levels: level 0 = top-level, level 1 = children of chain[0], etc.
  const levels: { options: OntologyEntity[]; selected: number }[] = [
    { options: topLevel, selected: chain[0] ?? 0 },
  ];
  for (let i = 0; i < chain.length; i++) {
    const children = getChildren(chain[i]);
    if (children.length > 0) {
      levels.push({ options: children, selected: chain[i + 1] ?? 0 });
    }
  }

  const handleChange = (levelIndex: number, entityId: number) => {
    // When a level changes, clear all deeper levels and set the new value
    const children = getChildren(entityId);
    // If no children, this is the leaf — set as the selected category
    if (children.length === 0) {
      onChange(entityId);
    } else {
      // Has children — set this as intermediate, but also set as current value
      // until user picks a child
      onChange(entityId);
    }
  };

  const levelLabels = ['Category', 'Subcategory', 'Type', 'Subtype'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
      <label style={labelStyle}>Category</label>
      {levels.map((level, i) => (
        <select
          key={i}
          value={level.selected}
          onChange={(e) => handleChange(i, Number(e.target.value))}
          style={{ ...glassSelect, width: '100%' }}
        >
          <option value={0}>— {levelLabels[i] ?? 'Select'} —</option>
          {level.options.map((c) => (
            <option key={c.entity_id} value={c.entity_id}>{c.name}</option>
          ))}
        </select>
      ))}
    </div>
  );
}

// ─── Edit Item Modal ────────────────────────────────────────────────────────

const FALLBACK_CONDITIONS = [
  { id: 6, title: 'New with tags' },
  { id: 1, title: 'New without tags' },
  { id: 2, title: 'Very good' },
  { id: 3, title: 'Good' },
  { id: 4, title: 'Satisfactory' },
];

// Helper: extract array from a BridgeResult with dynamic key
function extractArray(result: { ok: boolean; data?: unknown }, ...keys: string[]): { id: number; title: string;[k: string]: unknown }[] {
  if (!result?.ok || !result.data) return [];
  const data = result.data as Record<string, unknown>;
  for (const key of keys) {
    if (Array.isArray(data[key])) {
      return (data[key] as unknown[]).map((e: unknown) => {
        const obj = e as Record<string, unknown>;
        return { id: Number(obj.id), title: String(obj.title || obj.name || ''), ...obj };
      });
    }
  }
  // If the data itself is an array
  if (Array.isArray(data)) {
    return (data as unknown[]).map((e: unknown) => {
      const obj = e as Record<string, unknown>;
      return { id: Number(obj.id), title: String(obj.title || obj.name || ''), ...obj };
    });
  }
  return [];
}

/** Parsed niche attribute with dropdown options */
type NicheAttribute = {
  code: string;
  title: string;
  selectionType: 'single' | 'multi';
  selectionLimit: number;
  required: boolean;
  displayType: string;
  options: { id: number; title: string }[];
};

/**
 * Extract materials, available fields, and niche attribute configs from
 * POST /api/v2/item_upload/attributes response.
 */
function extractFromAttributes(result: { ok: boolean; data?: unknown }): {
  materials: { id: number; title: string }[];
  availableFields: string[];
  nicheAttributes: NicheAttribute[];
} {
  if (!result?.ok || !result.data) return { materials: [], availableFields: [], nicheAttributes: [] };
  const data = result.data as Record<string, unknown>;
  const attributes = data.attributes as { code: string; configuration?: Record<string, unknown> | null }[] | undefined;
  if (!Array.isArray(attributes)) return { materials: [], availableFields: [], nicheAttributes: [] };

  const availableFields = attributes.map((a) => a.code);
  const nicheAttributes: NicheAttribute[] = [];

  // Extract materials
  const materials: { id: number; title: string }[] = [];
  const materialAttr = attributes.find((a) => a.code === 'material');
  if (materialAttr?.configuration) {
    const topOptions = (materialAttr.configuration as Record<string, unknown>).options as unknown[] | undefined;
    if (Array.isArray(topOptions)) {
      for (const group of topOptions) {
        const g = group as Record<string, unknown>;
        const subOptions = g.options as unknown[] | undefined;
        if (Array.isArray(subOptions)) {
          for (const opt of subOptions) {
            const o = opt as Record<string, unknown>;
            materials.push({ id: Number(o.id), title: String(o.title || '') });
          }
        }
      }
    }
  }

  // Extract niche attributes with config (video_game_platform, etc.)
  const coreFields = new Set(['brand', 'condition', 'color', 'material', 'size', 'unisex', 'model', 'measurements', 'isbn']);
  for (const attr of attributes) {
    if (coreFields.has(attr.code)) continue;
    const conf = attr.configuration as Record<string, unknown> | null;
    if (!conf) continue;
    const opts: { id: number; title: string }[] = [];
    const topOpts = conf.options as unknown[] | undefined;
    if (Array.isArray(topOpts)) {
      for (const group of topOpts) {
        const g = group as Record<string, unknown>;
        const subOpts = g.options as unknown[] | undefined;
        if (Array.isArray(subOpts)) {
          for (const o of subOpts) {
            const opt = o as Record<string, unknown>;
            opts.push({ id: Number(opt.id), title: String(opt.title || '') });
          }
        } else {
          opts.push({ id: Number(g.id), title: String(g.title || '') });
        }
      }
    }
    nicheAttributes.push({
      code: attr.code,
      title: String(conf.title || attr.code),
      selectionType: String(conf.selection_type || 'single') as 'single' | 'multi',
      selectionLimit: Number(conf.selection_limit || 1),
      required: Boolean(conf.required),
      displayType: String(conf.display_type || 'list'),
      options: opts,
    });
  }

  return { materials, availableFields, nicheAttributes };
}

function EditItemModal({
  item,
  onSave,
  onClose,
}: {
  item: InventoryItem;
  onSave: (data: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}) {
  type PhotoPlanItem =
    | { type: 'existing'; id: number; url: string }
    | { type: 'new'; path: string };

  // ── State: basic fields ──
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? '');
  const [price, setPrice] = useState(String(item.price));
  // Store condition as status_id (numeric) for Vinted API compatibility
  const [selectedStatusId, setSelectedStatusId] = useState(item.status_id ?? 0);
  const [isUnisex, setIsUnisex] = useState(Boolean(item.is_unisex));

  // ── State: ontology-backed fields ──
  const [allCategories, setAllCategories] = useState<OntologyEntity[]>([]);
  const [allColors, setAllColors] = useState<OntologyEntity[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState(item.category_id ?? 0);
  const [selectedBrandId, setSelectedBrandId] = useState(item.brand_id ?? 0);
  const [selectedBrandName, setSelectedBrandName] = useState(item.brand_name ?? '');
  const [selectedColorIds, setSelectedColorIds] = useState<number[]>(
    Array.isArray(item.color_ids) ? item.color_ids : []
  );

  // ── State: dynamic brand search ──
  const [brandResults, setBrandResults] = useState<SelectOption[]>([]);
  const [brandLoading, setBrandLoading] = useState(false);

  // ── State: category-specific fields (fetched from Vinted API) ──
  const [sizeOptions, setSizeOptions] = useState<{ id: number; title: string }[]>([]);
  const [materialOptions, setMaterialOptions] = useState<{ id: number; title: string }[]>([]);
  const [packageSizeOptions, setPackageSizeOptions] = useState<{ id: number; title: string }[]>([]);
  const [conditionOptions, setConditionOptions] = useState<{ id: number; title: string }[]>(FALLBACK_CONDITIONS);

  const [selectedSizeId, setSelectedSizeId] = useState(item.size_id ?? 0);
  const [packageSizeId, setPackageSizeId] = useState(item.package_size_id ?? 3);

  // Track which fields are available for the selected category
  const [availableFields, setAvailableFields] = useState<string[]>([]);

  // Parse material from item_attributes
  const parsedAttrs = Array.isArray(item.item_attributes) ? item.item_attributes : [];
  const materialAttr = parsedAttrs.find((a: { code: string }) => a.code === 'material');
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<number[]>(() => {
    if (materialAttr && Array.isArray(materialAttr.ids)) return materialAttr.ids;
    return [];
  });

  // Loading/error state for item detail fetch
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  // ── State: niche fields (models, ISBN, measurements, video game, etc.) ──
  const [nicheAttributes, setNicheAttributes] = useState<NicheAttribute[]>([]);
  const [nicheValues, setNicheValues] = useState<Record<string, number | number[] | string>>({});
  const [modelOptions, setModelOptions] = useState<{ id: number; name: string; children?: { id: number; name: string }[] }[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState(0);
  const [selectedModelId, setSelectedModelId] = useState(0);
  const [isbn, setIsbn] = useState('');
  const [measurementLength, setMeasurementLength] = useState('');
  const [measurementWidth, setMeasurementWidth] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);

  // DOM-scraped text values from the Vinted page (used for reverse lookups)
  const [domColours, setDomColours] = useState('');
  const [domMaterials, setDomMaterials] = useState('');
  const [domSize, setDomSize] = useState('');
  const [domParcelSize, setDomParcelSize] = useState('');

  // ── Photos (editable) ──
  const [photoPlanItems, setPhotoPlanItems] = useState<PhotoPlanItem[]>(() => {
    const localPaths = Array.isArray(item.local_image_paths) ? item.local_image_paths : [];
    const remoteUrls = Array.isArray(item.photo_urls) ? item.photo_urls : [];

    // Only treat local_image_paths as 'new' uploads if there are no remote URLs
    // (i.e. this is a completely local un-pushed item). Otherwise, local_image_paths
    // is just a cache of the remote images.
    if (remoteUrls.length > 0) {
      return remoteUrls.map((u: string) => ({ type: 'existing', id: 0, url: u }));
    } else if (localPaths.length > 0) {
      return localPaths.map((p: string) => ({ type: 'new', path: p }));
    }
    return [];
  });
  const [photoPlanOriginalExistingIds, setPhotoPlanOriginalExistingIds] = useState<number[]>([]);
  const hasUnresolvedExistingPhotoIds = photoPlanItems.some((p) => p.type === 'existing' && p.id <= 0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // ── Load static ontology data & fetch item detail for pre-filling ──
  useEffect(() => {
    window.vinted.getOntology('category').then(setAllCategories).catch(() => undefined);
    window.vinted.getOntology('color').then(setAllColors).catch(() => undefined);
    // Seed brand with current item's brand so it shows in the dropdown
    if (item.brand_id && item.brand_name) {
      setBrandResults([{ id: item.brand_id, name: item.brand_name }]);
    }

    // Category-aware: ask main process whether this item is complete enough to edit/push.
    // Also enforce a 7-day cache TTL (stale cache triggers a refresh fetch).
    let cancelled = false;
    const checkAndFetch = async () => {
      if (!item.vinted_item_id) return;

      const nowSec = Math.floor(Date.now() / 1000);
      let comp: Awaited<ReturnType<typeof window.vinted.getDetailCompleteness>> | null = null;
      try {
        comp = await window.vinted.getDetailCompleteness(item.id);
      } catch {
        comp = null;
      }
      if (cancelled) return;

      const hydratedAt =
        (comp && typeof comp.detail_hydrated_at === 'number' ? comp.detail_hydrated_at : null) ??
        (typeof item.detail_hydrated_at === 'number' ? item.detail_hydrated_at : null);
      const isCacheStale = Boolean(hydratedAt) && (nowSec - (hydratedAt as number) > 7 * 24 * 60 * 60);
      const needsDetailFetch = !comp || !comp.ok || !comp.complete || isCacheStale;
      if (!needsDetailFetch) return;

      // Debug window is opt-in (it is intrusive in normal usage).
      // Enable by running in DevTools: localStorage.setItem('vinted_edit_debug_window', '1')
      if (import.meta.env.DEV && window.localStorage.getItem('vinted_edit_debug_window') === '1') {
        window.vinted.openEditDebugWindow(item.vinted_item_id).catch((err) => {
          console.warn('[EditModal] openEditDebugWindow failed:', err);
        });
      }
      setDetailError('');
      setDetailLoading(true);
      console.log('[EditModal] Fetching item detail for vinted_item_id:', item.vinted_item_id);
      window.vinted.getItemDetail(item.vinted_item_id).then((r) => {
        if (cancelled) return;
        console.log('[EditModal] Item detail response:', r.ok, r.ok ? 'has data' : (r as { code?: string; message?: string }).message);
        if (!r.ok || !r.data) {
          const errMsg = (r as { message?: string }).message || 'Failed to load item details';
          const is404 = errMsg.includes('404') || errMsg.includes('NOT_FOUND');
          setDetailError(is404
            ? 'This item may have been sold or deleted on Vinted. Fields will need to be filled manually.'
            : 'Could not load full item details. Some fields may need manual input.');
          return;
        }
        const raw = r.data as Record<string, unknown>;
        const d = (raw.item ?? raw) as Record<string, unknown>;

        // Log debug data from the browser-based extraction
        const debug = raw._debug as Record<string, unknown> | undefined;
        if (debug) {
          console.log('[EditModal] === DEBUG: Extraction source ===', debug.source);
          console.log('[EditModal] === DEBUG: Match count ===', debug.matchCount);
          console.log('[EditModal] === DEBUG: Page title ===', debug.docTitle);
        }

        console.log('[EditModal] Normalized item keys:', Object.keys(d));
        console.log('[EditModal] Normalized item values:', {
          catalog_id: d.catalog_id, brand_id: d.brand_id, brand_title: d.brand_title,
          size_id: d.size_id, size_title: d.size_title,
          status_id: d.status_id, color_ids: d.color_ids,
          package_size_id: d.package_size_id, is_unisex: d.is_unisex,
          price: d.price, description: d.description ? 'present' : 'missing',
        });

        // ── Normalize: flatten nested objects from React fiber data ──
        // Vinted's React components use brand_dto, size_dto, etc. as nested objects
        const brandObj = (d.brand_dto ?? d.brand) as Record<string, unknown> | string | null;
        const brandObjDict = brandObj && typeof brandObj === 'object' ? brandObj as Record<string, unknown> : null;
        const catObj = (d.category ?? d.catalog) as Record<string, unknown> | undefined;
        const sizeObj = d.size && typeof d.size === 'object' ? d.size as Record<string, unknown> : null;
        const statusObj = d.status && typeof d.status === 'object' ? d.status as Record<string, unknown> : null;
        const pkgObj = (d.package_size ?? d.package_size_dto) as Record<string, unknown> | undefined;
        const pkgObjDict = pkgObj && typeof pkgObj === 'object' ? pkgObj as Record<string, unknown> : null;
        const priceObj = d.price && typeof d.price === 'object' ? d.price as Record<string, unknown> : null;

        // Resolve brand_id: flat field, brand_dto.id, or brand.id
        const resolvedBrandId = d.brand_id ? Number(d.brand_id) : (brandObjDict?.id ? Number(brandObjDict.id) : 0);
        const resolvedBrandName = d.brand_title ? String(d.brand_title)
          : (brandObjDict?.title ? String(brandObjDict.title)
            : (brandObjDict?.name ? String(brandObjDict.name)
              : (typeof brandObj === 'string' ? String(brandObj) : '')));

        // Resolve catalog_id: flat field, or nested category/catalog .id
        const resolvedCatId = d.catalog_id ? Number(d.catalog_id)
          : (catObj && typeof catObj === 'object' && catObj.id ? Number(catObj.id) : 0);

        // Resolve size_id
        const resolvedSizeId = d.size_id ? Number(d.size_id) : (sizeObj?.id ? Number(sizeObj.id) : 0);

        // Resolve status_id (condition)
        const resolvedStatusId = d.status_id ? Number(d.status_id) : (statusObj?.id ? Number(statusObj.id) : 0);

        // Resolve package_size_id
        const resolvedPkgId = d.package_size_id ? Number(d.package_size_id) : (pkgObj?.id ? Number(pkgObj.id) : 0);

        // Resolve price — may be a number, string, or { amount, currency_code }
        const resolvedPrice = priceObj ? String(priceObj.amount ?? priceObj.price ?? d.price)
          : (d.price ? String(d.price) : '');

        // Resolve color_ids: flat array, or nested colors array of objects
        let resolvedColorIds: number[] = [];
        if (d.color_ids && Array.isArray(d.color_ids)) {
          resolvedColorIds = d.color_ids as number[];
        } else if (d.colors && Array.isArray(d.colors)) {
          resolvedColorIds = (d.colors as Record<string, unknown>[])
            .map((c) => Number(c.id))
            .filter((id) => id > 0);
        } else {
          // Vinted SSR sometimes uses color1_id, color2_id
          const c1 = d.color1_id ? Number(d.color1_id) : 0;
          const c2 = d.color2_id ? Number(d.color2_id) : 0;
          if (c1) resolvedColorIds.push(c1);
          if (c2) resolvedColorIds.push(c2);
        }

        // ── Apply resolved values to state ──
        // Fill gaps, but don't clobber user edits if they started typing before this finishes.
        const liveDesc = typeof d.description === 'string' ? d.description : '';
        if (liveDesc.trim()) {
          setDescription((prev) => (prev.trim() ? prev : liveDesc));
        }
        if (resolvedCatId) setSelectedCategoryId((prev) => (prev ? prev : resolvedCatId));
        if (resolvedBrandId) {
          setSelectedBrandId((prev) => (prev ? prev : resolvedBrandId));
          if (resolvedBrandName) {
            setSelectedBrandName((prev) => (prev ? prev : resolvedBrandName));
            setBrandResults((prev) => {
              if (prev.find((b) => b.id === resolvedBrandId)) return prev;
              return [{ id: resolvedBrandId, name: resolvedBrandName }, ...prev];
            });
          }
        }
        if (resolvedSizeId) setSelectedSizeId((prev) => (prev ? prev : resolvedSizeId));
        if (resolvedStatusId) setSelectedStatusId((prev) => (prev ? prev : resolvedStatusId));
        if (resolvedPkgId) {
          const initialPkg = item.package_size_id ?? 3;
          setPackageSizeId((prev) => (prev === initialPkg ? resolvedPkgId : prev));
        }
        if (resolvedColorIds.length > 0) setSelectedColorIds((prev) => (prev.length > 0 ? prev : resolvedColorIds));
        if (d.is_unisex !== undefined) {
          const initialUnisex = Boolean(item.is_unisex);
          setIsUnisex((prev) => (prev === initialUnisex ? Boolean(d.is_unisex) : prev));
        }
        if (resolvedPrice) {
          const initialPrice = String(item.price);
          setPrice((prev) => (prev === initialPrice ? resolvedPrice : prev));
        }

        // Persist missing detail fields so the next open doesn't need a refetch
        // and "Push" has the required IDs even outside the modal.
        try {
          const patch: Record<string, unknown> = { id: item.id, title: item.title, price: item.price };
          let changed = false;
          if (!item.category_id && resolvedCatId) { patch.category_id = resolvedCatId; changed = true; }
          if (!item.brand_id && resolvedBrandId) {
            patch.brand_id = resolvedBrandId;
            if (resolvedBrandName) patch.brand_name = resolvedBrandName;
            changed = true;
          }
          if (!item.size_id && resolvedSizeId) { patch.size_id = resolvedSizeId; changed = true; }
          if (!item.size_label && (d.size_title || sizeObj?.title || sizeObj?.name)) {
            patch.size_label = String(d.size_title || sizeObj?.title || sizeObj?.name || '');
            changed = true;
          }
          if (!item.status_id && resolvedStatusId) { patch.status_id = resolvedStatusId; changed = true; }
          if (!item.package_size_id && resolvedPkgId) { patch.package_size_id = resolvedPkgId; changed = true; }
          if ((!Array.isArray(item.color_ids) || item.color_ids.length === 0) && resolvedColorIds.length > 0) {
            patch.color_ids = JSON.stringify(resolvedColorIds);
            changed = true;
          }
          const localDesc = typeof item.description === 'string' ? item.description : '';
          const liveDesc = typeof d.description === 'string' ? d.description : '';
          if (!localDesc.trim() && liveDesc.trim()) { patch.description = liveDesc; changed = true; }
          if (Array.isArray(item.item_attributes) && item.item_attributes.length === 0 && d.item_attributes && Array.isArray(d.item_attributes)) {
            patch.item_attributes = JSON.stringify(d.item_attributes);
            changed = true;
          }
          if (changed) {
            window.vinted.upsertWardrobeItem(patch as { title: string; price: number; id?: number }).catch((err) => {
              console.warn('[EditModal] Failed to persist hydrated details:', err);
            });
          }
        } catch {
          /* ignore persistence errors */
        }

        // Parse materials from item_attributes (array of {code, ids})
        if (d.item_attributes && Array.isArray(d.item_attributes)) {
          const matAttr = (d.item_attributes as { code: string; ids?: number[] }[]).find((a) => a.code === 'material');
          if (matAttr?.ids) setSelectedMaterialIds(matAttr.ids);
        }
        // Pre-fill niche fields
        if (d.isbn) setIsbn(String(d.isbn));
        if (d.measurement_length) setMeasurementLength(String(d.measurement_length));
        if (d.measurement_width) setMeasurementWidth(String(d.measurement_width));

        // ── Reverse-lookup brand_id from brand_title ──
        if (!resolvedBrandId && resolvedBrandName) {
          window.vinted.searchBrands(resolvedBrandName, resolvedCatId || undefined).then((br: { ok: boolean; data?: unknown }) => {
            const brands = (br.ok && br.data && typeof br.data === 'object')
              ? ((br.data as Record<string, unknown>).brands as { id: number; title: string }[] | undefined) ?? []
              : [];
            const exactMatch = brands.find((b) => b.title.toLowerCase() === resolvedBrandName.toLowerCase());
            if (exactMatch) {
              console.log('[EditModal] Reverse-lookup brand_id:', exactMatch.id, exactMatch.title);
              setSelectedBrandId(exactMatch.id);
              setSelectedBrandName(exactMatch.title);
              setBrandResults((prev) => {
                if (prev.find((b) => b.id === exactMatch.id)) return prev;
                return [{ id: exactMatch.id, name: exactMatch.title }, ...prev];
              });
            }
          }).catch(() => undefined);
        }

        // ── Store DOM-scraped text values for reverse lookup ──
        // These get matched against ontology options when the category-change
        // useEffect loads sizes, materials, colours, and package sizes.
        const domColourStr = d._dom_colours as string | undefined;
        const domMatStr = d._dom_materials as string | undefined;
        const domSizeStr = d._dom_size as string | undefined;
        const domPkgStr = d._dom_parcel_size as string | undefined;

        if (domColourStr) setDomColours(domColourStr);
        if (domMatStr) {
          setDomMaterials(domMatStr);
          // Pre-select materials using negative placeholder IDs (DOM-scraped, no API lookup)
          // These get matched against real IDs when/if the materials API loads.
          if (selectedMaterialIds.length === 0) {
            const matNames = domMatStr.split(',').map((s: string) => s.trim()).filter(Boolean);
            setSelectedMaterialIds(matNames.map((_: string, i: number) => -(i + 1)));
          }
        }
        if (domSizeStr) setDomSize(domSizeStr);
        if (domPkgStr) setDomParcelSize(domPkgStr);

        // ── Photos with IDs (for reorder/remove + save) ──
        // Prefer the photo list from the live Vinted edit-page data (has IDs).
        try {
          // If we already have local pending photos, don't overwrite the plan from live.
          // (Those local paths are the user's intended changes.)
          const existingLocalPaths = Array.isArray(item.local_image_paths) ? item.local_image_paths : [];
          if (existingLocalPaths.length === 0) {
            const rawPhotos = (d.photos ?? []) as Record<string, unknown>[];
            if (Array.isArray(rawPhotos) && rawPhotos.length > 0) {
              const existing: PhotoPlanItem[] = rawPhotos
                .map((p) => ({
                  type: 'existing' as const,
                  id: Number(p.id || 0),
                  url: String(p.url || ''),
                }))
                .filter((p) => !!p.url);
              if (existing.length > 0) {
                setPhotoPlanItems(existing);
                setPhotoPlanOriginalExistingIds(
                  existing
                    .map((p) => (p.type === 'existing' ? p.id : 0))
                    .filter((id) => id > 0)
                );
              }
            }
          }
        } catch {
          /* ignore */
        }

        console.log('[EditModal] DOM-scraped values:', {
          colours: domColourStr, materials: domMatStr,
          size: domSizeStr, parcel: domPkgStr,
        });

        // ── Immediate colour lookup from allColors (already loaded) ──
        if (domColourStr && resolvedColorIds.length === 0) {
          const colourNames = domColourStr.split(',').map((s: string) => s.trim()).filter(Boolean);
          // Ontology returns objects with .name (not .title) and .entity_id (the color ID for the API)
          window.vinted.getOntology('color').then((colors: Record<string, unknown>[]) => {
            const matched: number[] = [];
            for (const name of colourNames) {
              const found = (Array.isArray(colors) ? colors : []).find((c) => {
                const cName = String(c.name || c.title || '');
                return cName.toLowerCase() === name.toLowerCase();
              });
              if (found) {
                // Use entity_id (the Vinted color ID) if available, otherwise use id
                matched.push(Number(found.entity_id ?? found.id));
              }
            }
            if (matched.length > 0) {
              console.log('[EditModal] Reverse-lookup color_ids:', matched);
              setSelectedColorIds(matched);
            }
          }).catch(() => undefined);
        }
      }).catch((err) => {
        if (cancelled) return;
        console.error('[EditModal] Item detail fetch failed:', err);
      }).finally(() => {
        if (cancelled) return;
        setDetailLoading(false);
      });

    };

    void checkAndFetch();

    return () => {
      cancelled = true;
    };
  }, [item.id, item.vinted_item_id]);

  const openPhotoPicker = () => {
    fileInputRef.current?.click();
  };

  const onPhotoFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const paths: string[] = [];
    for (const f of files) {
      // Electron provides a non-standard `path` field.
      const p = (f as unknown as { path?: string }).path;
      if (p) paths.push(p);
    }
    if (paths.length > 0) {
      setPhotoPlanItems((prev) => [...prev, ...paths.map((p) => ({ type: 'new' as const, path: p }))]);
    }
    // Allow selecting the same file again later.
    e.target.value = '';
  };

  const movePhoto = (idx: number, dir: -1 | 1) => {
    setPhotoPlanItems((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      const tmp = next[idx];
      next[idx] = next[j];
      next[j] = tmp;
      return next;
    });
  };

  const removePhotoAt = (idx: number) => {
    setPhotoPlanItems((prev) => prev.filter((_, i) => i !== idx));
  };

  // ── Fetch category-specific options when category changes ──
  useEffect(() => {
    if (!selectedCategoryId) return;
    const catId = selectedCategoryId;

    // Wait until detail fetch completes (if it's running) to ensure session token is captured
    if (detailLoading) return;

    // Fetch size groups — response: { size_groups: [{ id, caption, sizes: [{ id, title }] }] }
    window.vinted.getSizes(catId).then((r: { ok: boolean; data?: unknown }) => {
      const groups = extractArray(r, 'size_groups');
      const flat: { id: number; title: string }[] = [];
      for (const g of groups) {
        const subSizes = (g as Record<string, unknown>).sizes;
        if (Array.isArray(subSizes)) {
          for (const sub of subSizes as unknown[]) {
            const so = sub as Record<string, unknown>;
            flat.push({ id: Number(so.id), title: String(so.title || so.name || '') });
          }
        } else {
          flat.push({ id: g.id, title: g.title });
        }
      }
      setSizeOptions(flat);
      // Reverse-lookup size_id from DOM-scraped size label
      if (domSize && !selectedSizeId) {
        const match = flat.find((s) => s.title.toLowerCase() === domSize.toLowerCase());
        if (match) {
          console.log('[EditModal] Reverse-lookup size_id:', match.id, match.title);
          setSelectedSizeId(match.id);
        }
      }
    }).catch(() => setSizeOptions([]));

    // Fetch materials & attribute config via POST /attributes
    window.vinted.getMaterials(catId, item.vinted_item_id).then((r: { ok: boolean; data?: unknown }) => {
      console.log('[EditModal] getMaterials RAW:', JSON.stringify(r));
      const { materials, availableFields: fields, nicheAttributes: niche } = extractFromAttributes(r);
      console.log('[EditModal] getMaterials result:', { ok: r?.ok, count: materials.length, fields, niche: niche.length });
      setMaterialOptions(materials);
      if (fields.length > 0) setAvailableFields(fields);
      setNicheAttributes(niche);
      // Reverse-lookup material IDs from DOM-scraped material names
      // Also try reverse-lookup if we have placeholder IDs (negative) from DOM scraping
      if (domMaterials && materials.length > 0 && (selectedMaterialIds.length === 0 || selectedMaterialIds.some((id) => id < 0))) {
        const matNames = domMaterials.split(',').map((s) => s.trim()).filter(Boolean);
        const matched: number[] = [];
        for (const name of matNames) {
          const found = materials.find((m: { id: number; title: string }) => m.title.toLowerCase() === name.toLowerCase());
          if (found) matched.push(found.id);
        }
        if (matched.length > 0) {
          console.log('[EditModal] Reverse-lookup material_ids:', matched);
          setSelectedMaterialIds(matched);
        }
      }
    }).catch((err) => {
      console.error('[EditModal] getMaterials failed:', err);
      setMaterialOptions([]);
    });

    // Fetch package sizes — response: { package_sizes: [{ id, title, ... }] }
    const vintedItemId = item.vinted_item_id ?? undefined;
    window.vinted.getPackageSizes(catId, vintedItemId).then((r: { ok: boolean; data?: unknown }) => {
      const pkgs = extractArray(r, 'package_sizes');
      if (pkgs.length > 0) {
        setPackageSizeOptions(pkgs);
        // Reverse-lookup package_size_id from DOM-scraped parcel size label
        if (domParcelSize && packageSizeId <= 3) {
          const match = pkgs.find((p) => p.title.toLowerCase() === domParcelSize.toLowerCase());
          if (match) {
            console.log('[EditModal] Reverse-lookup package_size_id:', match.id, match.title);
            setPackageSizeId(match.id);
          }
        }
        // If still default and API response has a "recommended" one, use it
        if (packageSizeId <= 3) {
          const recommended = pkgs.find((p: Record<string, unknown>) => (p as Record<string, unknown>).is_recommended === true);
          if (recommended) setPackageSizeId(recommended.id);
        }
      }
    }).catch(() => undefined);

    // Fetch conditions — response: { conditions: [{ id, title, explanation }] }
    window.vinted.getConditions(catId).then((r: { ok: boolean; data?: unknown }) => {
      const conds = extractArray(r, 'conditions');
      if (conds.length > 0) setConditionOptions(conds);
    }).catch(() => undefined);

    // Fetch popular brands for this category
    window.vinted.searchBrands('', catId).then((r) => {
      if (r.ok) {
        const brands = extractArray(r as { ok: boolean; data?: unknown }, 'brands');
        const opts = brands.map((b) => ({ id: b.id, name: b.title }));
        // Keep current brand in list if not in results
        if (selectedBrandId && !opts.find((o) => o.id === selectedBrandId) && selectedBrandName) {
          opts.unshift({ id: selectedBrandId, name: selectedBrandName });
        }
        setBrandResults(opts);
      }
    }).catch(() => undefined);
  }, [selectedCategoryId, item.vinted_item_id, detailLoading]);

  // ── Brand search handler ──
  const handleBrandSearch = async (keyword: string) => {
    setBrandLoading(true);
    try {
      const result = await window.vinted.searchBrands(keyword, selectedCategoryId || undefined);
      if (result.ok) {
        const brands = extractArray(result as { ok: boolean; data?: unknown }, 'brands');
        const opts = brands.map((b) => ({ id: b.id, name: b.title }));
        // Keep current brand in list if not in results
        if (selectedBrandId && !opts.find((o) => o.id === selectedBrandId) && selectedBrandName) {
          opts.unshift({ id: selectedBrandId, name: selectedBrandName });
        }
        setBrandResults(opts);
      }
    } catch { /* ignore */ }
    setBrandLoading(false);
  };

  const handleBrandChange = (id: number | number[]) => {
    const brandId = Array.isArray(id) ? id[0] : id;
    setSelectedBrandId(brandId);
    const brand = brandResults.find((b) => b.id === brandId);
    setSelectedBrandName(brand?.name ?? '');
    // Reset model selection when brand changes
    setModelOptions([]);
    setSelectedCollectionId(0);
    setSelectedModelId(0);
    // Fetch models if this brand might have them (the attributes response tells us if 'model' is available)
    if (brandId && selectedCategoryId && availableFields.includes('model')) {
      setModelsLoading(true);
      window.vinted.getModels(selectedCategoryId, brandId).then((r) => {
        if (r.ok) {
          const data = (r as { ok: true; data: unknown }).data as Record<string, unknown>;
          const rawModels = (data.models ?? []) as Record<string, unknown>[];
          const opts = rawModels.map((m) => ({
            id: Number(m.id),
            name: String(m.name || ''),
            children: Array.isArray(m.children)
              ? (m.children as Record<string, unknown>[]).map((c) => ({ id: Number(c.id), name: String(c.name || '') }))
              : undefined,
          }));
          setModelOptions(opts);
        }
      }).catch(() => undefined).finally(() => setModelsLoading(false));
    }
  };

  const handleColorChange = (ids: number | number[]) => {
    setSelectedColorIds(Array.isArray(ids) ? ids : [ids]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (detailLoading) {
      // Prevent validation errors caused by saving before required IDs are loaded.
      setSaveError('Please wait for listing details to finish loading before saving.');
      return;
    }
    if (saving) return;

    const existingUrls = photoPlanItems
      .filter((p) => p.type === 'existing')
      .map((p) => (p as { type: 'existing'; url: string }).url)
      .filter(Boolean);
    const newPaths = photoPlanItems
      .filter((p) => p.type === 'new')
      .map((p) => (p as { type: 'new'; path: string }).path)
      .filter(Boolean);

    // Rebuild item_attributes with updated material
    let attrs = parsedAttrs.filter((a: { code: string }) => a.code !== 'material');
    if (selectedMaterialIds.length > 0) {
      attrs = [...attrs, { code: 'material', ids: selectedMaterialIds }];
    }

    // Derive condition string from status_id
    const condOpt = conditionOptions.find((c) => c.id === selectedStatusId);
    const conditionStr = condOpt?.title ?? item.condition ?? '';

    // Add niche attributes to item_attributes
    for (const attr of nicheAttributes) {
      const val = nicheValues[attr.code];
      if (val !== undefined && val !== 0 && val !== '') {
        attrs = attrs.filter((a: { code: string }) => a.code !== attr.code);
        if (Array.isArray(val)) {
          attrs.push({ code: attr.code, ids: val as number[] });
        } else if (typeof val === 'number') {
          attrs.push({ code: attr.code, ids: [val] });
        }
      }
    }

    // Build model metadata if model is selected
    const modelMetadata: Record<string, unknown> = {};
    if (selectedCollectionId) modelMetadata.collection_id = selectedCollectionId;
    if (selectedModelId) modelMetadata.model_id = selectedModelId;

    // Guard against accidental clears: if the UI didn't manage to prefill/resolve IDs,
    // preserve existing persisted values rather than sending an empty required field.
    const fallbackColorIds = Array.isArray(item.color_ids) ? item.color_ids : [];
    const finalColorIds = selectedColorIds.length > 0 ? selectedColorIds : fallbackColorIds;

    setSaving(true);
    setSaveError('');

    const showSizeField =
      sizeOptions.length > 0 &&
      (availableFields.includes('size') || (availableFields.length === 0 && !!domSize));

    const payload: Record<string, unknown> = {
      id: item.id,
      title: title.trim(),
      description: description.trim(),
      price: parseFloat(price) || 0,
      condition: conditionStr,
      brand_id: selectedBrandId || null,
      brand_name: selectedBrandName.trim(),
      category_id: selectedCategoryId || null,
      color_ids: JSON.stringify(finalColorIds),
      status_id: selectedStatusId || null,
      package_size_id: packageSizeId,
      item_attributes: JSON.stringify(attrs),
      is_unisex: isUnisex ? 1 : 0,
      isbn: isbn || null,
      measurement_length: measurementLength ? parseFloat(measurementLength) : null,
      measurement_width: measurementWidth ? parseFloat(measurementWidth) : null,
      photo_urls: JSON.stringify(existingUrls),
      local_image_paths: JSON.stringify(newPaths),
      status: item.vinted_item_id ? 'discrepancy' : item.status,
      __photo_plan: {
        original_existing_ids: photoPlanOriginalExistingIds,
        items: photoPlanItems,
      },
      ...(Object.keys(modelMetadata).length > 0 ? { model_metadata: JSON.stringify(modelMetadata) } : {}),
    };

    // If the category doesn't have a size field (e.g. bags), don't send `size_id: null`.
    // Omitting the field avoids accidentally clearing a previously-synced size_id.
    if (showSizeField) {
      payload.size_id = selectedSizeId || null;
      payload.size_label = sizeOptions.find((s) => s.id === selectedSizeId)?.title ?? item.size_label ?? '';
    }

    onSave(payload).then((r) => {
      if (!r.ok) {
        setSaveError(r.error || 'Failed to save changes');
        setSaving(false);
        return;
      }
      // Leave closing to the parent (it closes the modal on success).
      setSaving(false);
    }).catch((err) => {
      setSaveError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    });
  };

  // ── Render data ──
  const colorSelectOpts = allColors.map((c) => ({
    id: c.entity_id,
    name: c.name,
    extra: c.extra as Record<string, unknown> | null,
  }));

  const editLocalPaths = Array.isArray(item.local_image_paths) ? item.local_image_paths : [];
  const editPhotoUrls = Array.isArray(item.photo_urls) ? item.photo_urls : [];
  const editPhotos = editLocalPaths.length > 0 ? editLocalPaths : editPhotoUrls;

  return (
    <div style={modalOverlay} onClick={onClose}>
      <div
        style={{ ...modalContent, maxWidth: 640, maxHeight: '90vh', overflow: 'auto', padding: spacing['2xl'], position: 'relative' }}
        onClick={(e) => e.stopPropagation()}
        className="animate-fadeInScale"
      >
        <h3 style={{ margin: '0 0 24px', fontSize: font.size.xl, fontWeight: font.weight.semibold, color: colors.textPrimary }}>
          Edit Listing
        </h3>

        {detailLoading && (
          <div style={{ background: colors.infoBg, border: `1px solid rgba(96, 165, 250, 0.25)`, borderRadius: 8, padding: spacing.sm, marginBottom: spacing.md, fontSize: font.size.sm, color: colors.info }}>
            Loading additional listing details from Vinted… You can keep editing, but Save is disabled until this finishes.
          </div>
        )}
        {detailError && (
          <div style={{ background: 'rgba(255,180,0,0.12)', border: '1px solid rgba(255,180,0,0.3)', borderRadius: 8, padding: spacing.sm, marginBottom: spacing.md, fontSize: font.size.sm, color: '#ffb400' }}>
            {detailError}
          </div>
        )}
        {saveError && (
          <div style={{ background: 'rgba(255,0,0,0.10)', border: '1px solid rgba(255,0,0,0.25)', borderRadius: 8, padding: spacing.sm, marginBottom: spacing.md, fontSize: font.size.sm, color: '#ff6b6b' }}>
            Save failed: {saveError}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: spacing.xl,
            opacity: saving ? 0.85 : 1,
            pointerEvents: saving ? 'none' : 'auto',
          }}
        >

          {/* ── Photos ── */}
          <div>
            <label style={labelStyle}>Photos</label>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={onPhotoFilesSelected}
            />

            <div style={{ display: 'flex', gap: spacing.sm, marginBottom: spacing.sm }}>
              <button
                type="button"
                onClick={openPhotoPicker}
                style={{ ...btnSecondary, ...btnSmall }}
                disabled={saving || hasUnresolvedExistingPhotoIds}
                title={hasUnresolvedExistingPhotoIds ? 'Photo IDs not loaded — cannot edit photos yet' : undefined}
              >
                Add photos
              </button>
              <div style={{ color: colors.textMuted, fontSize: font.size.xs, alignSelf: 'center' }}>
                {saving
                  ? `Saving...${photoPlanItems.some((p) => p.type === 'new') ? ' Uploading photos and saving listing.' : ' Updating listing.'}`
                  : hasUnresolvedExistingPhotoIds
                    ? 'Photo editing is disabled because live photo IDs could not be loaded. Retry opening the modal and wait for details to load.'
                    : 'Drag-and-drop not supported yet; use Add photos. You can reorder/remove before saving.'}
              </div>
            </div>

            {photoPlanItems.length > 0 ? (
              <div style={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap' }}>
                {photoPlanItems.map((p, i) => {
                  const src =
                    p.type === 'new'
                      ? `local-image://${encodeURI(p.path)}`
                      : p.url;
                  const hasId = p.type === 'existing' ? p.id > 0 : true;

                  return (
                    <div key={`${p.type}-${p.type === 'existing' ? p.id : p.path}-${i}`} style={{ width: 112 }}>
                      <div style={{
                        width: 112,
                        height: 112,
                        borderRadius: radius.md,
                        overflow: 'hidden',
                        background: colors.glassBg,
                        border: `1px solid ${colors.glassBorder}`,
                        position: 'relative',
                      }}>
                        <img
                          src={src}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                        {!hasId && (
                          <div style={{
                            position: 'absolute',
                            left: 6,
                            bottom: 6,
                            background: 'rgba(0,0,0,0.6)',
                            color: '#fff',
                            fontSize: 10,
                            padding: '2px 6px',
                            borderRadius: 999,
                          }}>
                            no-id
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        <button
                          type="button"
                          onClick={() => movePhoto(i, -1)}
                          style={{ ...btnSecondary, ...btnSmall, flex: 1 }}
                          title="Move left"
                          disabled={saving || hasUnresolvedExistingPhotoIds}
                        >
                          ←
                        </button>
                        <button
                          type="button"
                          onClick={() => movePhoto(i, 1)}
                          style={{ ...btnSecondary, ...btnSmall, flex: 1 }}
                          title="Move right"
                          disabled={saving || hasUnresolvedExistingPhotoIds}
                        >
                          →
                        </button>
                        <button
                          type="button"
                          onClick={() => removePhotoAt(i)}
                          style={{ ...btnDanger, ...btnSmall }}
                          title="Remove"
                          disabled={saving || hasUnresolvedExistingPhotoIds}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ ...glassInput, width: '100%', color: colors.textMuted, fontSize: font.size.sm }}>
                No photos selected.
              </div>
            )}
          </div>

          {/* ── Title ── */}
          <div>
            <label style={labelStyle}>Title</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
              style={{ ...glassInput, width: '100%' }} required />
          </div>

          {/* ── Description ── */}
          <div>
            <label style={labelStyle}>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              rows={5} style={{ ...glassTextarea, width: '100%' }} placeholder="Describe your item..." />
          </div>

          {/* ── Category (Hierarchical) ── */}
          <HierarchicalCategorySelect categories={allCategories} value={selectedCategoryId} onChange={setSelectedCategoryId} />

          {/* ── Brand (Live search via API) ── */}
          <SearchableSelect
            label="Brand"
            options={brandResults}
            value={selectedBrandId}
            onChange={(v) => handleBrandChange(v)}
            placeholder="Type to search brands..."
            onSearch={handleBrandSearch}
            loading={brandLoading}
          />

          {/* ── Condition ── */}
          <div>
            <label style={labelStyle}>Condition</label>
            <select value={selectedStatusId} onChange={(e) => setSelectedStatusId(Number(e.target.value))} style={{ ...glassSelect, width: '100%' }}>
              <option value={0}>— Select Condition —</option>
              {conditionOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          </div>

          {/* ── Size (Category-specific dropdown — hidden if category has no size groups) ──
               When availableFields is empty (attributes API broken), fall back to
               checking whether the DOM scraping found a size value on the view page.
               If domSize is empty AND availableFields is empty, the item has no size. */}
          {(sizeOptions.length > 0 && (availableFields.includes('size') || (availableFields.length === 0 && !!domSize))) && (
            <div>
              <label style={labelStyle}>Size</label>
              {sizeOptions.length > 0 ? (
                <select value={selectedSizeId} onChange={(e) => setSelectedSizeId(Number(e.target.value))} style={{ ...glassSelect, width: '100%' }}>
                  <option value={0}>— Select Size —</option>
                  {sizeOptions.map((s) => (
                    <option key={s.id} value={s.id}>{s.title}</option>
                  ))}
                </select>
              ) : (
                <div style={{ ...glassInput, width: '100%', color: colors.textMuted, fontSize: font.size.sm }}>
                  {selectedCategoryId ? 'Loading sizes...' : 'Select a category first'}
                </div>
              )}
            </div>
          )}

          {/* ── Colours (Searchable, max 2) ── */}
          <SearchableSelect
            label="Colours (max 2)"
            options={colorSelectOpts}
            value={selectedColorIds}
            onChange={(v) => handleColorChange(v)}
            placeholder="Search colours..."
            maxSelections={2}
            renderOption={(opt, sel) => {
              const hex = opt.extra?.hex as string | undefined;
              return (
                <>
                  {hex && <span style={{ width: 14, height: 14, borderRadius: '50%', background: hex, border: '1px solid rgba(255,255,255,0.2)', flexShrink: 0 }} />}
                  <span>{opt.name}</span>
                  {sel && <span style={{ marginLeft: 'auto', fontSize: 11, color: colors.primary }}>Selected</span>}
                </>
              );
            }}
          />

          {/* ── Material (Category-specific dropdown, multi-select up to 3) ──
               Show if materialOptions loaded from API, OR if DOM scraping found materials */}
          {(materialOptions.length > 0 || domMaterials) && (
            <SearchableSelect
              label="Material (max 3)"
              options={materialOptions.length > 0
                ? materialOptions.map((m) => ({ id: m.id, name: m.title }))
                : domMaterials.split(',').map((s, i) => ({ id: -(i + 1), name: s.trim() }))
              }
              value={selectedMaterialIds}
              onChange={(v) => setSelectedMaterialIds(Array.isArray(v) ? v : [v])}
              placeholder="Search materials..."
              maxSelections={3}
            />
          )}

          {/* ── Model/Collection (Luxury brands like Chanel, LV, etc.) ── */}
          {availableFields.includes('model') && modelOptions.length > 0 && (
            <div>
              <label style={labelStyle}>Model / Collection</label>
              <select
                value={selectedCollectionId}
                onChange={(e) => {
                  const cid = Number(e.target.value);
                  setSelectedCollectionId(cid);
                  setSelectedModelId(0);
                }}
                style={{ ...glassSelect, width: '100%', marginBottom: spacing.sm }}
              >
                <option value={0}>— Select Collection —</option>
                {modelOptions.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              {selectedCollectionId > 0 && (() => {
                const collection = modelOptions.find((m) => m.id === selectedCollectionId);
                if (collection?.children && collection.children.length > 0) {
                  return (
                    <select
                      value={selectedModelId}
                      onChange={(e) => setSelectedModelId(Number(e.target.value))}
                      style={{ ...glassSelect, width: '100%' }}
                    >
                      <option value={0}>— Select Model —</option>
                      {collection.children.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  );
                }
                return null;
              })()}
              {modelsLoading && (
                <div style={{ color: colors.textMuted, fontSize: font.size.xs, marginTop: 4 }}>Loading models...</div>
              )}
            </div>
          )}

          {/* ── ISBN (Books category) ── */}
          {availableFields.includes('isbn') && (
            <div>
              <label style={labelStyle}>ISBN</label>
              <input type="text" value={isbn} onChange={(e) => setIsbn(e.target.value)}
                placeholder="Enter ISBN number..."
                style={{ ...glassInput, width: '100%' }} />
            </div>
          )}

          {/* ── Measurements (Sized clothing) ── */}
          {availableFields.includes('measurements') && (
            <div>
              <label style={labelStyle}>Measurements (cm)</label>
              <div style={{ display: 'flex', gap: spacing.sm }}>
                <input type="number" step="0.1" value={measurementLength} onChange={(e) => setMeasurementLength(e.target.value)}
                  placeholder="Length" style={{ ...glassInput, flex: 1 }} />
                <input type="number" step="0.1" value={measurementWidth} onChange={(e) => setMeasurementWidth(e.target.value)}
                  placeholder="Width" style={{ ...glassInput, flex: 1 }} />
              </div>
            </div>
          )}

          {/* ── Dynamic niche attributes (video_game_platform, etc.) ── */}
          {nicheAttributes.map((attr) => (
            <div key={attr.code}>
              <label style={labelStyle}>{attr.title}{attr.required ? ' *' : ''}</label>
              {attr.options.length > 0 ? (
                attr.selectionType === 'single' ? (
                  <select
                    value={Number(nicheValues[attr.code] ?? 0)}
                    onChange={(e) => setNicheValues((prev) => ({ ...prev, [attr.code]: Number(e.target.value) }))}
                    style={{ ...glassSelect, width: '100%' }}
                  >
                    <option value={0}>— Select {attr.title} —</option>
                    {attr.options.map((o) => (
                      <option key={o.id} value={o.id}>{o.title}</option>
                    ))}
                  </select>
                ) : (
                  <SearchableSelect
                    label=""
                    options={attr.options.map((o) => ({ id: o.id, name: o.title }))}
                    value={Array.isArray(nicheValues[attr.code]) ? nicheValues[attr.code] as number[] : []}
                    onChange={(v) => setNicheValues((prev) => ({ ...prev, [attr.code]: v }))}
                    placeholder={`Search ${attr.title.toLowerCase()}...`}
                    maxSelections={attr.selectionLimit}
                  />
                )
              ) : (
                <input type="text" value={String(nicheValues[attr.code] ?? '')}
                  onChange={(e) => setNicheValues((prev) => ({ ...prev, [attr.code]: e.target.value }))}
                  placeholder={`Enter ${attr.title.toLowerCase()}...`}
                  style={{ ...glassInput, width: '100%' }} />
              )}
            </div>
          ))}

          {/* ── Price ── */}
          <div>
            <label style={labelStyle}>Price ({item.currency || 'GBP'})</label>
            <input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)}
              style={{ ...glassInput, width: '100%' }} required />
          </div>

          {/* ── Package Size ── */}
          <div>
            <label style={labelStyle}>Parcel Size</label>
            <div style={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap' }}>
              {(packageSizeOptions.length > 0 ? packageSizeOptions : [
                { id: 1, title: 'Small' }, { id: 2, title: 'Medium' }, { id: 3, title: 'Large' },
              ]).map((pkg) => {
                const sel = packageSizeId === pkg.id;
                return (
                  <button key={pkg.id} type="button" onClick={() => setPackageSizeId(pkg.id)}
                    style={{
                      flex: 1, minWidth: 100, padding: '10px 12px', borderRadius: radius.md,
                      border: `1px solid ${sel ? colors.primary : colors.glassBorder}`,
                      background: sel ? colors.primaryMuted : colors.glassBg,
                      color: sel ? colors.primary : colors.textSecondary,
                      cursor: 'pointer', textAlign: 'center' as const, transition: transition.fast,
                      fontWeight: sel ? font.weight.semibold : font.weight.medium,
                      fontSize: font.size.sm,
                    }}
                  >
                    {pkg.title}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Unisex toggle (only shown if category supports it) ── */}
          {(availableFields.length === 0 || availableFields.includes('unisex')) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
              <label style={{ ...labelStyle, marginBottom: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                <div onClick={() => setIsUnisex(!isUnisex)}
                  style={{
                    width: 40, height: 22, borderRadius: 11,
                    background: isUnisex ? colors.primary : colors.glassBg,
                    border: `1px solid ${isUnisex ? colors.primary : colors.glassBorder}`,
                    position: 'relative', cursor: 'pointer', transition: transition.base,
                  }}>
                  <div style={{
                    width: 16, height: 16, borderRadius: '50%', background: colors.white,
                    position: 'absolute', top: 2, left: isUnisex ? 20 : 2, transition: transition.base,
                  }} />
                </div>
                Unisex item
              </label>
            </div>
          )}

          {/* ── Actions ── */}
          <div style={{ display: 'flex', gap: spacing.sm, marginTop: spacing.sm, paddingTop: spacing.lg, borderTop: `1px solid ${colors.separator}` }}>
            <button type="submit" style={{ ...btnPrimary, flex: 1, opacity: saving || detailLoading ? 0.7 : 1 }} disabled={saving || detailLoading}>
              {saving ? 'Saving…' : detailLoading ? 'Loading details…' : 'Save Changes'}
            </button>
            <button type="button" onClick={onClose} style={btnSecondary} disabled={saving}>Cancel</button>
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
