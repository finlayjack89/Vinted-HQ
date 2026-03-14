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
  const [bulkSyncing, setBulkSyncing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number; title: string; failed: number } | null>(null);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [ontologyAlert, setOntologyAlert] = useState<{ deletedCategories: unknown[]; affectedItems: unknown[] } | null>(null);
  const [actionBusy, setActionBusy] = useState<null | { kind: 'push' | 'pull'; localId: number }>(null);
  const [backgroundSyncing, setBackgroundSyncing] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkActionProgress, setBulkActionProgress] = useState<{ kind: 'push' | 'pull'; current: number; total: number; failed: number } | null>(null);

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
    loadItems().then(async () => {
      // After local DB is rendered, silently sync from Vinted in the background
      try {
        const userId = await window.vinted.getVintedUserId();
        if (userId) {
          setBackgroundSyncing(true);
          await window.vinted.pullFromVinted(userId);
          // onSyncProgress listener will call loadItems() and clear syncing state
        }
      } catch (err) {
        console.warn('[Wardrobe] Background sync skipped:', err);
        setBackgroundSyncing(false);
      }
    });
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
        setBackgroundSyncing(false);
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

  // ── Bulk Deep Sync Orchestrator ──
  const handleBulkSync = async (): Promise<void> => {
    // Filter and sort items for Bulk Deep Sync:
    // 1. Must have a vinted_item_id
    // 2. Status must be one of: active, live, hidden, reserved
    // 3. Sort order: Active/Live (newest->oldest) -> Hidden (newest->oldest) -> Reserved (newest->oldest)
    // 4. Within each status group, shallow items (no deep sync) come before already-synced ones
    const itemsToSync = items
      .filter((i) => i.vinted_item_id && ['active', 'live', 'hidden', 'reserved'].includes(i.status.toLowerCase()))
      .sort((a, b) => {
        const priorityA = ['active', 'live'].includes(a.status.toLowerCase()) ? 3 : a.status.toLowerCase() === 'hidden' ? 2 : 1;
        const priorityB = ['active', 'live'].includes(b.status.toLowerCase()) ? 3 : b.status.toLowerCase() === 'hidden' ? 2 : 1;

        if (priorityA !== priorityB) {
          return priorityB - priorityA; // Higher priority (active/live) first
        }

        // Within the same status, prioritize shallow (un-synced) items first
        const aIsShallow = !a.detail_hydrated_at ? 0 : 1;
        const bIsShallow = !b.detail_hydrated_at ? 0 : 1;
        if (aIsShallow !== bIsShallow) return aIsShallow - bIsShallow;

        // Within the same sync depth, sort newest to oldest
        const timeA = a.created_at ?? Number(a.id);
        const timeB = b.created_at ?? Number(b.id);
        return timeB - timeA;
      });
    if (itemsToSync.length === 0) return;

    setBulkSyncing(true);
    let failedCount = 0;

    for (let idx = 0; idx < itemsToSync.length; idx++) {
      const currentItem = itemsToSync[idx];
      setBulkProgress({ current: idx + 1, total: itemsToSync.length, title: currentItem.title, failed: failedCount });

      try {
        // 1. Capture initial updated_at as baseline
        const initialUpdatedAt = currentItem.updated_at ?? 0;

        // 2. Open the edit page in background Chrome
        await window.vinted.openExternal(
          `https://www.vinted.co.uk/items/${currentItem.vinted_item_id}/edit?hq_sync=true`,
          { background: true },
        );

        // 3. The Waiter: poll until updated_at changes or timeout
        const synced = await new Promise<boolean>((resolve) => {
          let pollCount = 0;
          const MAX_POLLS = 20; // 20 × 1500ms = 30 seconds

          const interval = setInterval(async () => {
            pollCount++;
            if (pollCount > MAX_POLLS) {
              clearInterval(interval);
              resolve(false); // timed out — don't block the queue
              return;
            }
            try {
              const polledItem = await window.vinted.getWardrobeItem(currentItem.id);
              if (polledItem?.updated_at && polledItem.updated_at !== initialUpdatedAt) {
                clearInterval(interval);
                resolve(true);
              }
            } catch {
              // ignore individual poll errors
            }
          }, 1500);
        });

        if (!synced) {
          console.warn(`[BulkSync] Timed out for item ${currentItem.id} (${currentItem.title})`);
          failedCount++;
        } else {
          console.log(`[BulkSync] ✅ Synced item ${currentItem.id} (${currentItem.title})`);
        }
      } catch (err) {
        console.error(`[BulkSync] Error syncing item ${currentItem.id}:`, err);
        failedCount++;
      }

      // 4. Human-like delay between items (2-5 seconds)
      if (idx < itemsToSync.length - 1) {
        await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));
      }
    }

    // 5. Done — refresh the UI
    setBulkSyncing(false);
    setBulkProgress(null);
    await loadItems();
    console.log(`[BulkSync] Complete. ${itemsToSync.length - failedCount}/${itemsToSync.length} succeeded, ${failedCount} failed/timed out.`);
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
    };
  };

  const toggleSelectId = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBulkAction = async (kind: 'push' | 'pull') => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkActionProgress({ kind, current: 0, total: ids.length, failed: 0 });
    let failed = 0;
    for (let i = 0; i < ids.length; i++) {
      setBulkActionProgress({ kind, current: i + 1, total: ids.length, failed });
      try {
        const result = kind === 'pull'
          ? await window.vinted.pullLiveToLocal(ids[i])
          : await window.vinted.pushToVinted(ids[i]);
        if (!result?.ok) failed++;
      } catch {
        failed++;
      }
    }
    setBulkActionProgress(null);
    setSelectedIds(new Set());
    setSelectMode(false);
    await loadItems();
    if (failed > 0) window.alert(`${failed} of ${ids.length} items failed.`);
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
        <div className="modal-overlay" style={modalOverlay}>
          <div
            style={{ ...modalContent, maxWidth: 420, textAlign: 'center', background: colors.bgElevated, backdropFilter: 'none', WebkitBackdropFilter: 'none' }}
            onClick={(e) => e.stopPropagation()}

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
              onClick={() => setIsCreating(true)}
              style={{
                ...btnPrimary,
                ...btnSmall,
                background: 'linear-gradient(135deg, #10b981, #059669)',
                border: 'none',
              }}
            >
              ✚ Create Listing
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectMode((v) => !v);
                setSelectedIds(new Set());
              }}
              style={{
                ...btnSecondary,
                ...btnSmall,
                ...(selectMode ? { color: colors.primary, borderColor: colors.primary, background: colors.primaryMuted } : {}),
              }}
            >
              {selectMode ? '✓ Select Mode' : '☐ Select'}
            </button>
            <button
              type="button"
              onClick={async () => {
                setLoading(true);
                await loadItems();
              }}
              disabled={loading}
              style={{
                ...btnSecondary,
                ...btnSmall,
                opacity: loading ? 0.6 : 1,
                cursor: loading ? 'default' : 'pointer',
              }}
              title="Reload items from local database"
            >
              {loading ? '↻ Refreshing…' : '↻ Refresh'}
            </button>
            <button
              type="button"
              onClick={handleRefreshOntology}
              style={{ ...btnSecondary, ...btnSmall }}
            >
              Refresh Ontology
            </button>
            <button
              type="button"
              onClick={handleBulkSync}
              disabled={bulkSyncing || syncing}
              style={{
                ...btnSecondary,
                ...btnSmall,
                opacity: bulkSyncing ? 0.6 : 1,
                cursor: bulkSyncing ? 'default' : 'pointer',
              }}
            >
              {bulkSyncing && bulkProgress
                ? `Deep Syncing ${bulkProgress.current}/${bulkProgress.total}…`
                : '🔄 Bulk Deep Sync'}
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
            {backgroundSyncing && !syncing && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: font.size.xs, color: colors.textMuted }}>
                <span style={{
                  width: 12, height: 12, border: '2px solid rgba(16,185,129,0.2)',
                  borderTopColor: '#10b981', borderRadius: '50%',
                  animation: 'hq-spin 0.8s linear infinite', display: 'inline-block',
                }} />
                Refreshing…
              </span>
            )}
          </div>
        </div>
        {syncing && syncProgress?.message && (
          <div style={{ marginTop: spacing.xs, fontSize: font.size.sm, color: colors.textSecondary }}>
            {syncProgress.message}
          </div>
        )}
        {bulkSyncing && bulkProgress && (
          <div style={{
            marginTop: spacing.sm,
            background: 'rgba(16, 185, 129, 0.08)',
            border: '1px solid rgba(16, 185, 129, 0.25)',
            borderRadius: 8,
            padding: `${spacing.sm} ${spacing.md}`,
            fontSize: font.size.sm,
            color: '#10b981',
          }}>
            <div style={{ fontWeight: 600 }}>
              ⟳ Deep Syncing {bulkProgress.current}/{bulkProgress.total}
              {bulkProgress.failed > 0 && <span style={{ color: '#ff6b6b', marginLeft: 8 }}>({bulkProgress.failed} timed out)</span>}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
              {bulkProgress.title}
            </div>
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

      {/* ── Bulk Action Bar ── */}
      {selectMode && selectedIds.size > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: spacing.sm,
          marginBottom: spacing.md,
          padding: `${spacing.sm} ${spacing.md}`,
          background: colors.primaryMuted,
          border: `1px solid ${colors.primary}`,
          borderRadius: radius.md,
          fontSize: font.size.sm,
        }}>
          <span style={{ color: colors.primary, fontWeight: font.weight.semibold }}>
            {selectedIds.size} selected
          </span>
          <button
            type="button"
            onClick={() => handleBulkAction('pull')}
            disabled={!!bulkActionProgress}
            style={{ ...btnSecondary, ...btnSmall, color: colors.info, borderColor: 'rgba(96,165,250,0.3)' }}
          >
            {bulkActionProgress?.kind === 'pull'
              ? `Pulling ${bulkActionProgress.current}/${bulkActionProgress.total}…`
              : '⬇ Bulk Pull'}
          </button>
          <button
            type="button"
            onClick={() => handleBulkAction('push')}
            disabled={!!bulkActionProgress}
            style={{ ...btnSecondary, ...btnSmall, color: colors.success, borderColor: 'rgba(16,185,129,0.3)' }}
          >
            {bulkActionProgress?.kind === 'push'
              ? `Pushing ${bulkActionProgress.current}/${bulkActionProgress.total}…`
              : '⬆ Bulk Push'}
          </button>
          <button
            type="button"
            onClick={() => { setSelectedIds(new Set()); setSelectMode(false); }}
            style={{ ...btnSecondary, ...btnSmall }}
          >Cancel</button>
        </div>
      )}

      {/* ── Content ── */}
      {
        loading ? (
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
                selectMode={selectMode}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelectId}
              />
            )}
            {subTab === 'live' && (
              <ItemTable
                items={liveItems}
                onRelist={(id) => handleRelist([id])}
                onEdit={(item) => setEditingItem(item)}
                showDiscrepancyBadge
                emptyMessage="No live listings. Sync from Vinted to import your wardrobe."
                selectMode={selectMode}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelectId}
              />
            )}
            {subTab === 'local' && (
              <ItemTable
                items={localItems}
                onPush={handlePush}
                onEdit={(item) => setEditingItem(item)}
                onDelete={handleDelete}
                emptyMessage="No local-only items. Create new listings or sync from Vinted."
                selectMode={selectMode}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelectId}
              />
            )}
            {subTab === 'discrepancy' && (
              <DiscrepancyView
                items={discrepancyItems}
                onEdit={(item) => setEditingItem(item)}
                onPush={handlePush}
                onPull={handlePull}
                selectMode={selectMode}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelectId}
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
        )
      }

      {/* ── Edit Modal ── */}
      {
        editingItem && (
          <EditItemModal
            item={editingItem}
            onSave={handleSaveEdit}
            onClose={() => setEditingItem(null)}
          />
        )
      }

      {/* ── Create Listing Modal ── */}
      {
        isCreating && (
          <EditItemModal
            item={null}
            onSave={async () => ({ ok: true })} // not used in create mode
            onClose={() => { setIsCreating(false); loadItems(); }}
          />
        )
      }

      {/* ── Ontology Alert Modal ── */}
      {
        ontologyAlert && (
          <div className="modal-overlay" style={modalOverlay} onClick={() => setOntologyAlert(null)}>
            <div style={{ ...modalContent, maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
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
        )
      }
    </div >
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
  selectMode,
  selectedIds,
  onToggleSelect,
}: {
  items: InventoryItem[];
  onRelist?: (localId: number) => void;
  onPush?: (localId: number) => void;
  onPull?: (localId: number) => void;
  onEdit?: (item: InventoryItem) => void;
  onDelete?: (localId: number) => void;
  showDiscrepancyBadge?: boolean;
  emptyMessage: string;
  selectMode?: boolean;
  selectedIds?: Set<number>;
  onToggleSelect?: (id: number) => void;
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
            {selectMode && (
              <th style={{ ...tableHeaderCell, width: 40, textAlign: 'center' as const }}>
                <input
                  type="checkbox"
                  checked={items.length > 0 && items.every((i) => selectedIds?.has(i.id))}
                  onChange={() => {
                    if (!onToggleSelect) return;
                    const allSelected = items.every((i) => selectedIds?.has(i.id));
                    items.forEach((i) => {
                      if (allSelected && selectedIds?.has(i.id)) onToggleSelect(i.id);
                      if (!allSelected && !selectedIds?.has(i.id)) onToggleSelect(i.id);
                    });
                  }}
                  style={{ cursor: 'pointer', accentColor: colors.primary }}
                />
              </th>
            )}
            <th style={tableHeaderCell}>Image</th>
            <th style={tableHeaderCell}>Title</th>
            <th style={tableHeaderCell}>Price</th>
            <th style={tableHeaderCell}>Status</th>
            <th style={tableHeaderCell}>Sync</th>
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
              selectMode={selectMode}
              selected={selectedIds?.has(item.id)}
              onToggleSelect={onToggleSelect}
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
  selectMode,
  selected,
  onToggleSelect,
}: {
  item: InventoryItem;
  onRelist?: (localId: number) => void;
  onPush?: (localId: number) => void;
  onPull?: (localId: number) => void;
  onEdit?: (item: InventoryItem) => void;
  onDelete?: (localId: number) => void;
  showDiscrepancyBadge?: boolean;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: number) => void;
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
      style={{ background: hovered ? tableRowHoverBg : (selected ? 'rgba(99,102,241,0.08)' : 'transparent'), transition: transition.fast }}
    >
      {selectMode && (
        <td style={{ ...tableCell, width: 40, textAlign: 'center' as const }}>
          <input
            type="checkbox"
            checked={!!selected}
            onChange={() => onToggleSelect?.(item.id)}
            style={{ cursor: 'pointer', accentColor: colors.primary }}
          />
        </td>
      )}
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
        {item.detail_hydrated_at
          ? <span style={badge('rgba(16,185,129,0.15)', 'rgb(16,185,129)')}>Deep</span>
          : <span style={badge('rgba(245,158,11,0.15)', 'rgb(245,158,11)')}>Shallow</span>
        }
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
                btn.textContent = 'Syncing in Browser...';
                btn.disabled = true;

                // Open the Vinted Edit page with the hq_sync parameter to trigger the Chrome Extension
                await window.vinted.openExternal(`https://www.vinted.co.uk/items/${item.vinted_item_id}/edit?hq_sync=true`);

                setTimeout(() => {
                  btn.textContent = 'Fetch Full Details';
                  btn.disabled = false;
                }, 4000);
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
  selectMode,
  selectedIds,
  onToggleSelect,
}: {
  items: InventoryItem[];
  onEdit: (item: InventoryItem) => void;
  onPush: (localId: number) => void;
  onPull: (localId: number) => void;
  selectMode?: boolean;
  selectedIds?: Set<number>;
  onToggleSelect?: (id: number) => void;
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
        selectMode={selectMode}
        selectedIds={selectedIds}
        onToggleSelect={onToggleSelect}
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
          // Nested structure (e.g. grouped by type)
          for (const opt of subOptions) {
            const o = opt as Record<string, unknown>;
            materials.push({ id: Number(o.id), title: String(o.title || '') });
          }
        } else if (g.id) {
          // Flat structure (e.g. brand-specific materials like Lamborghini)
          materials.push({ id: Number(g.id), title: String(g.title || '') });
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
  item: InventoryItem | null;
  onSave: (data: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}) {
  const isCreateMode = item === null;
  type PhotoPlanItem =
    | { type: 'existing'; id: number; url: string }
    | { type: 'new'; path: string };

  // ── State: basic fields ──
  const [title, setTitle] = useState(item?.title ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [price, setPrice] = useState(item ? String(item.price) : '');
  // Store condition as status_id (numeric) for Vinted API compatibility
  const [selectedStatusId, setSelectedStatusId] = useState(item?.status_id ?? 0);
  const [isUnisex, setIsUnisex] = useState(Boolean(item?.is_unisex));

  // ── State: create mode progress ──
  const [createProgress, setCreateProgress] = useState<{ step: string; current: number; total: number; message?: string } | null>(null);

  // ── State: ontology-backed fields ──
  const [allCategories, setAllCategories] = useState<OntologyEntity[]>([]);
  const [allColors, setAllColors] = useState<OntologyEntity[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState(item?.category_id ?? 0);
  const [selectedBrandId, setSelectedBrandId] = useState(item?.brand_id ?? 0);
  const [selectedBrandName, setSelectedBrandName] = useState(item?.brand_name ?? '');
  const [selectedColorIds, setSelectedColorIds] = useState<number[]>(
    Array.isArray(item?.color_ids) ? item.color_ids : []
  );

  // ── State: dynamic brand search ──
  const [brandResults, setBrandResults] = useState<SelectOption[]>([]);
  const [brandLoading, setBrandLoading] = useState(false);

  // ── State: category-specific fields (fetched from Vinted API) ──
  const [sizeOptions, setSizeOptions] = useState<{ id: number; title: string }[]>([]);
  const [materialOptions, setMaterialOptions] = useState<{ id: number; title: string }[]>([]);
  const [packageSizeOptions, setPackageSizeOptions] = useState<{ id: number; title: string }[]>([]);
  const [conditionOptions, setConditionOptions] = useState<{ id: number; title: string }[]>(FALLBACK_CONDITIONS);

  const [selectedSizeId, setSelectedSizeId] = useState(item?.size_id ?? 0);
  const [packageSizeId, setPackageSizeId] = useState(item?.package_size_id ?? 3);

  // Track which fields are available for the selected category
  const [availableFields, setAvailableFields] = useState<string[]>([]);

  // Parse material from item_attributes
  const parsedAttrs = Array.isArray(item?.item_attributes) ? item.item_attributes : [];
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
  const [selectedCollectionId, setSelectedCollectionId] = useState(() => {
    if (!item) return 0;
    // Read from separate DB columns (exist at runtime via SELECT m.*, not in TS type)
    const itemAny = item as Record<string, unknown>;
    if (typeof itemAny.collection_id === 'number' && itemAny.collection_id) return itemAny.collection_id;
    // Fallback to model_metadata JSON
    const meta = item.model_metadata as Record<string, unknown> | null;
    if (meta && typeof meta.collection_id === 'number') return meta.collection_id;
    return 0;
  });
  const [selectedModelId, setSelectedModelId] = useState(() => {
    if (!item) return 0;
    const itemAny = item as Record<string, unknown>;
    if (typeof itemAny.model_id === 'number' && itemAny.model_id) return itemAny.model_id;
    const meta = item.model_metadata as Record<string, unknown> | null;
    if (meta && typeof meta.model_id === 'number') return meta.model_id;
    return 0;
  });
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
    if (!item) return [];
    const localPaths = Array.isArray(item.local_image_paths) ? item.local_image_paths : [];
    const remoteUrls = Array.isArray(item.photo_urls) ? item.photo_urls : [];

    if (remoteUrls.length > 0) {
      return remoteUrls.map((u: string) => ({ type: 'existing', id: 0, url: u }));
    } else if (localPaths.length > 0) {
      return localPaths.map((p: string) => ({ type: 'new', path: p }));
    }
    return [];
  });

  const reloadItem = async (): Promise<Record<string, unknown> | null> => {
    if (!item) return null;
    try {
      const freshItem = await window.vinted.getWardrobeItem(item.id);
      if (freshItem) {
        // Diagnostic: log model-related fields from the SQLite row
        console.log('[EditModal] reloadItem model fields:', {
          collection_id: freshItem.collection_id,
          model_id: freshItem.model_id,
          model_metadata: freshItem.model_metadata,
          category_id: freshItem.category_id,
          brand_id: freshItem.brand_id,
          updated_at: freshItem.updated_at,
          allKeys: Object.keys(freshItem),
        });

        setTitle(freshItem.title);
        setDescription(freshItem.description ?? '');
        setPrice(String(freshItem.price));
        setSelectedStatusId(freshItem.status_id ?? 0);
        setSelectedCategoryId(freshItem.category_id ?? 0);
        setSelectedBrandId(freshItem.brand_id ?? 0);
        setSelectedBrandName(freshItem.brand_name ?? '');
        setSelectedSizeId(freshItem.size_id ?? 0);
        setPackageSizeId(freshItem.package_size_id ?? 3);

        if (freshItem.isbn) setIsbn(freshItem.isbn);
        if (freshItem.measurement_length) setMeasurementLength(String(freshItem.measurement_length));
        if (freshItem.measurement_width) setMeasurementWidth(String(freshItem.measurement_width));
        if (freshItem.collection_id) setSelectedCollectionId(freshItem.collection_id);
        if (freshItem.model_id) setSelectedModelId(freshItem.model_id);

        const parsedAttrs = Array.isArray(freshItem.item_attributes) ? freshItem.item_attributes : [];
        const materialAttr = parsedAttrs.find((a: { code: string }) => a.code === 'material');
        if (materialAttr && Array.isArray(materialAttr.ids)) {
          setSelectedMaterialIds(materialAttr.ids);
        }

        if (Array.isArray(freshItem.color_ids)) setSelectedColorIds(freshItem.color_ids);

        const freshPaths = Array.isArray(freshItem.local_image_paths) ? freshItem.local_image_paths : [];
        const freshUrls = Array.isArray(freshItem.photo_urls) ? freshItem.photo_urls : [];
        if (freshUrls.length > 0) {
          setPhotoPlanItems(freshUrls.map((u: string) => ({ type: 'existing', id: 0, url: u })));
        } else if (freshPaths.length > 0) {
          setPhotoPlanItems(freshPaths.map((p: string) => ({ type: 'new', path: p })));
        }
        return freshItem as Record<string, unknown>;
      }
    } catch (err) {
      console.error('[EditModal] Failed to reload item:', err);
    }
    return null;
  };
  const [photoPlanOriginalExistingIds, setPhotoPlanOriginalExistingIds] = useState<number[]>([]);
  const hasUnresolvedExistingPhotoIds = photoPlanItems.some((p) => p.type === 'existing' && p.id <= 0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // ── Deep Sync polling state (Phase E.1) ──
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'timeout'>('idle');
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Bumped after successful sync to force material/size/condition useEffects to re-run
  const [syncGeneration, setSyncGeneration] = useState(0);

  // ── Load static ontology data & fetch item detail for pre-filling ──
  useEffect(() => {
    window.vinted.getOntology('category').then(setAllCategories).catch(() => undefined);
    window.vinted.getOntology('color').then(setAllColors).catch(() => undefined);
    // Seed brand with current item's brand so it shows in the dropdown
    if (item?.brand_id && item?.brand_name) {
      setBrandResults([{ id: item.brand_id, name: item.brand_name }]);
    }
  }, [item?.id, item?.vinted_item_id]);

  // ── Cleanup sync interval on unmount (prevents leaks if modal closes mid-sync) ──
  useEffect(() => {
    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }
    };
  }, []);

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

  // ── Fetch Materials when category, brand, or status changes ──
  useEffect(() => {
    if (!selectedCategoryId || detailLoading) return;

    // Fetch materials & attribute config via POST /attributes
    const catId = selectedCategoryId;
    window.vinted.getMaterials(catId, item?.vinted_item_id, selectedBrandId || undefined, selectedStatusId || undefined).then((r: { ok: boolean; data?: unknown }) => {
      console.log('[EditModal] getMaterials RAW:', JSON.stringify(r));
      const { materials, availableFields: fields, nicheAttributes: niche } = extractFromAttributes(r);
      console.log('[EditModal] getMaterials result:', { ok: r?.ok, count: materials.length, fields, niche: niche.length });
      setMaterialOptions(materials);
      if (fields.length > 0) setAvailableFields(fields);
      setNicheAttributes(niche);
      // Reverse-lookup material IDs from DOM-scraped material names
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
  }, [selectedCategoryId, selectedBrandId, selectedStatusId, item?.vinted_item_id, detailLoading, syncGeneration]);

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



    // Fetch package sizes — response: { package_sizes: [{ id, title, ... }] }
    const vintedItemId = item?.vinted_item_id ?? undefined;
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
          if (recommended && recommended.id) setPackageSizeId(recommended.id as number);
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
  }, [selectedCategoryId, item?.vinted_item_id, detailLoading, syncGeneration]);

  // ── Auto-fetch models when brand + category are set (initial load or post-sync) ──
  useEffect(() => {
    console.log('[EditModal] Model useEffect fired:', { selectedBrandId, selectedCategoryId, syncGeneration, modelOptionsLength: modelOptions.length, selectedModelId, selectedCollectionId });
    if (!selectedBrandId || !selectedCategoryId) return;
    // Only auto-fetch if we don't already have model options loaded
    if (modelOptions.length > 0 && syncGeneration === 0) return;
    setModelsLoading(true);
    console.log('[EditModal] Fetching models for category', selectedCategoryId, 'brand', selectedBrandId);
    window.vinted.getModels(selectedCategoryId, selectedBrandId).then((res: { ok: boolean; data?: unknown }) => {
      console.log('[EditModal] getModels response:', JSON.stringify(res).substring(0, 500));
      if (res?.ok) {
        const data = res.data as Record<string, unknown>;
        const rawModels = (data.models ?? []) as Record<string, unknown>[];
        const opts = rawModels.map((m) => ({
          id: Number(m.id),
          name: String(m.title || m.name || ''),
          children: Array.isArray(m.children)
            ? (m.children as Record<string, unknown>[]).map((c) => ({ id: Number(c.id), name: String(c.title || c.name || '') }))
            : undefined,
        }));
        setModelOptions(opts);
        // Auto-resolve collection ID from model ID if needed
        if (selectedModelId && !selectedCollectionId) {
          const matchedCol = opts.find((col) =>
            col.children && col.children.some((child) => child.id === selectedModelId)
          );
          if (matchedCol) setSelectedCollectionId(matchedCol.id);
        }
      } else {
        setModelOptions([]);
      }
    }).catch((err) => {
      console.error('[EditModal] Auto-fetch models failed:', err);
    }).finally(() => setModelsLoading(false));
  }, [selectedBrandId, selectedCategoryId, syncGeneration]);

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

  // Subscribe to create progress events
  useEffect(() => {
    if (!isCreateMode) return;
    const unsub = window.vinted.onCreateProgress((data) => {
      setCreateProgress(data);
      if (data.step === 'complete' || data.step === 'error') {
        // Auto-clear after a delay
        setTimeout(() => setCreateProgress(null), data.step === 'error' ? 5000 : 2000);
      }
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreateMode]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (detailLoading) {
      // Prevent validation errors caused by saving before required IDs are loaded.
      setSaveError('Please wait for listing details to finish loading before saving.');
      return;
    }
    if (saving) return;

    // ── Create mode validation ──
    if (isCreateMode) {
      const errors: string[] = [];
      if (!title.trim() || title.trim().length < 5) errors.push('Title must be at least 5 characters');
      if (!description.trim()) errors.push('Description is required');
      if (!price || parseFloat(price) <= 0) errors.push('Price must be greater than 0');
      if (!selectedCategoryId) errors.push('Category is required');
      if (!selectedStatusId) errors.push('Condition is required');
      if (!packageSizeId) errors.push('Parcel size is required');
      const newPhotos = photoPlanItems.filter((p) => p.type === 'new');
      if (newPhotos.length === 0) errors.push('At least 1 photo is required');
      if (photoPlanItems.length > 12) errors.push('Maximum 12 photos allowed');
      if (errors.length > 0) {
        setSaveError(errors.join('. '));
        return;
      }
    }

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
    const conditionStr = condOpt?.title ?? item?.condition ?? '';

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
    const fallbackColorIds = Array.isArray(item?.color_ids) ? item.color_ids : [];
    const finalColorIds = selectedColorIds.length > 0 ? selectedColorIds : fallbackColorIds;

    setSaving(true);
    setSaveError('');

    const showSizeField =
      sizeOptions.length > 0 &&
      (availableFields.includes('size') || (availableFields.length === 0 && !!domSize));

    // ── Create mode: upload photos + publish via dedicated IPC ──
    if (isCreateMode) {
      const photoPaths = photoPlanItems
        .filter((p) => p.type === 'new')
        .map((p) => (p as { type: 'new'; path: string }).path)
        .filter(Boolean);

      const formData: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim(),
        price: parseFloat(price) || 0,
        currency: 'GBP',
        catalog_id: selectedCategoryId || null,
        brand_id: selectedBrandId || null,
        brand: selectedBrandName.trim(),
        size_id: selectedSizeId || null,
        status_id: selectedStatusId || 2,
        is_unisex: isUnisex,
        color_ids: finalColorIds,
        package_size_id: packageSizeId || 3,
        item_attributes: attrs.length > 0 ? attrs : [],
        isbn: isbn || null,
        measurement_length: measurementLength ? parseFloat(measurementLength) : null,
        measurement_width: measurementWidth ? parseFloat(measurementWidth) : null,
        condition: conditionStr,
        ...(Object.keys(modelMetadata).length > 0 ? { model_metadata: modelMetadata } : {}),
      };

      setSaving(true);
      setSaveError('');

      window.vinted.createListing(formData, photoPaths).then((result) => {
        if (!result.ok) {
          setSaveError(result.error || 'Failed to create listing');
          setSaving(false);
          return;
        }
        // Success — close creates modal
        setSaving(false);
        onClose();
      }).catch((err) => {
        setSaveError(err instanceof Error ? err.message : String(err));
        setSaving(false);
      });
      return;
    }

    const updates: Record<string, unknown> = {
      title,
      description,
      price: Number(price),
      status_id: selectedStatusId,
      category_id: selectedCategoryId || null,
      brand_id: selectedBrandId || null,
      brand_name: selectedBrandId ? selectedBrandName : null,
      size_id: selectedSizeId || null,
      package_size_id: packageSizeId || null,
      is_unisex: isUnisex,
      color_ids: selectedColorIds,
      isbn: isbn || null,
      measurement_length: measurementLength ? Number(measurementLength) : null,
      measurement_width: measurementWidth ? Number(measurementWidth) : null,
      collection_id: selectedCollectionId || null,
      model_id: selectedModelId || null,
      item_attributes: selectedMaterialIds.length > 0 ? [{ code: 'material', ids: selectedMaterialIds }] : null,
    };

    // Check if we need to remove the model/collection if category changed
    if (!availableFields.includes('model') && updates.collection_id) {
      updates.collection_id = null;
      updates.model_id = null;
    }

    // `updates` contains most of the fields we want to send to the backend.
    // `payload` will combine `updates` with other derived fields and photo data.
    const payload: Record<string, unknown> = {
      id: item!.id,
      ...updates,
      // `updates.color_ids` is `selectedColorIds`, but we need `finalColorIds` which includes fallback.
      color_ids: JSON.stringify(finalColorIds),
      // `updates.price` is `Number(price)`, but we need `parseFloat(price) || 0`.
      price: parseFloat(price) || 0,
      // `updates.is_unisex` is boolean, but we need 1 or 0.
      is_unisex: isUnisex ? 1 : 0,
      // `updates.measurement_length` is `Number(measurementLength)`, but we need `parseFloat`.
      measurement_length: measurementLength ? parseFloat(measurementLength) : null,
      // `updates.measurement_width` is `Number(measurementWidth)`, but we need `parseFloat`.
      measurement_width: measurementWidth ? parseFloat(measurementWidth) : null,
      // `updates.title` and `updates.description` are raw, but we need trimmed.
      title: title.trim(),
      description: description.trim(),
      // `updates.brand_name` is raw, but we need trimmed.
      brand_name: selectedBrandName.trim(),

      // Fields not in `updates`
      condition: conditionStr,
      // Pass the fully computed/reordered photo paths/URIs for the bridge to diff
      photo_urls: photoPlanItems.map((p) => p.type === 'existing' ? p.url : p.path),
      // NEW: track which existing photo IDs the user intends to keep (by explicitly selecting them)
      retained_photo_ids: photoPlanItems
        .filter((p) => p.type === 'existing' && p.id > 0)
        .map((p) => p.id as number),
      local_image_paths: JSON.stringify(newPaths), // Still needed for local-only items
      status: item!.vinted_item_id ? 'discrepancy' : item!.status,
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
      payload.size_label = sizeOptions.find((s) => s.id === selectedSizeId)?.title ?? item?.size_label ?? '';
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

  const editLocalPaths = Array.isArray(item?.local_image_paths) ? item.local_image_paths : [];
  const editPhotoUrls = Array.isArray(item?.photo_urls) ? item.photo_urls : [];
  const editPhotos = editLocalPaths.length > 0 ? editLocalPaths : editPhotoUrls;

  return (
    <div className="modal-overlay" style={modalOverlay} onClick={onClose}>
      <div
        style={{ ...modalContent, maxWidth: 640, maxHeight: '90vh', overflow: 'auto', padding: spacing['2xl'], position: 'relative' }}
        onClick={(e) => e.stopPropagation()}

      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 24px' }}>
          <h3 style={{ margin: 0, fontSize: font.size.xl, fontWeight: font.weight.semibold, color: colors.textPrimary }}>
            {isCreateMode ? 'Create Listing' : 'Edit Listing'}
          </h3>
          {!isCreateMode && item?.vinted_item_id && item.status !== 'removed' && (
            <button
              type="button"
              disabled={isSyncing}
              onClick={async () => {
                if (isSyncing || !item) return;

                // 1. Capture the item's current updated_at as our baseline
                const initialUpdatedAt = item.updated_at ?? 0;
                setIsSyncing(true);
                setSyncStatus('syncing');

                // 2. Open Chrome in background so it doesn't steal focus
                await window.vinted.openExternal(`https://www.vinted.co.uk/items/${item.vinted_item_id}/edit?hq_sync=true`, { background: true });

                // 3. Start strict polling loop (1500ms intervals, 30s safety timeout)
                let pollCount = 0;
                const MAX_POLLS = 20; // 20 × 1500ms = 30 seconds

                syncIntervalRef.current = setInterval(async () => {
                  try {
                    pollCount++;

                    // Safety timeout: 30 seconds
                    if (pollCount > MAX_POLLS) {
                      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
                      syncIntervalRef.current = null;
                      setIsSyncing(false);
                      setSyncStatus('timeout');
                      setTimeout(() => setSyncStatus('idle'), 4000);
                      return;
                    }

                    // 4. Poll: read the item's updated_at from SQLite via IPC
                    const polledItem = await window.vinted.getWardrobeItem(item.id);
                    if (!polledItem) return;

                    // 5. Compare: has updated_at changed from our baseline?
                    if (polledItem.updated_at && polledItem.updated_at !== initialUpdatedAt) {
                      // ✅ Sync complete — the extension has written new data
                      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
                      syncIntervalRef.current = null;

                      // Re-hydrate all fields from the freshly updated SQLite row
                      await reloadItem();

                      // Bump syncGeneration to force material/size/model useEffects to re-run
                      setSyncGeneration((g) => g + 1);

                      setSyncStatus('success');
                      setIsSyncing(false);
                      setTimeout(() => setSyncStatus('idle'), 3000);
                    }
                  } catch (err) {
                    console.error('[EditModal] Sync poll error:', err);
                  }
                }, 1500);
              }}
              style={{
                ...btnSecondary,
                ...btnSmall,
                color: syncStatus === 'timeout' ? '#ff6b6b' : syncStatus === 'success' ? '#10b981' : '#10b981',
                borderColor: syncStatus === 'timeout' ? 'rgba(255, 107, 107, 0.3)' : 'rgba(16, 185, 129, 0.3)',
                opacity: isSyncing ? 0.8 : 1,
                cursor: isSyncing ? 'not-allowed' : 'pointer',
              }}
            >
              {syncStatus === 'syncing' ? '⟳ Syncing from Vinted…' : syncStatus === 'success' ? '✅ Synced!' : syncStatus === 'timeout' ? '⏱ Sync timed out' : 'Sync with Extension'}
            </button>
          )}
        </div>

        {isSyncing && !isCreateMode && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(17, 17, 17, 0.85)',

            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            zIndex: 100, borderRadius: 12,
          }}>
            <div style={{
              width: 40, height: 40, border: '3px solid rgba(16, 185, 129, 0.2)',
              borderTopColor: '#10b981', borderRadius: '50%',
              animation: 'hq-spin 0.8s linear infinite',
            }} />
            <div style={{ marginTop: 16, fontSize: 16, fontWeight: 600, color: '#10b981' }}>
              Syncing from Vinted…
            </div>
            <div style={{ marginTop: 6, fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
              This usually takes 5–10 seconds
            </div>
            <style>{`@keyframes hq-spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}
        {isCreateMode && createProgress && createProgress.step !== 'complete' && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(17, 17, 17, 0.85)',

            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            zIndex: 100, borderRadius: 12,
          }}>
            <div style={{
              width: 40, height: 40, border: '3px solid rgba(16, 185, 129, 0.2)',
              borderTopColor: createProgress.step === 'error' ? '#ff6b6b' : '#10b981', borderRadius: '50%',
              animation: createProgress.step === 'error' ? 'none' : 'hq-spin 0.8s linear infinite',
            }} />
            <div style={{ marginTop: 16, fontSize: 16, fontWeight: 600, color: createProgress.step === 'error' ? '#ff6b6b' : '#10b981' }}>
              {createProgress.message || 'Publishing…'}
            </div>
            {createProgress.step === 'uploading' && createProgress.total > 0 && (
              <div style={{
                marginTop: 12, width: 200, height: 4, borderRadius: 2,
                background: 'rgba(255,255,255,0.1)',
              }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  background: '#10b981',
                  width: `${(createProgress.current / createProgress.total) * 100}%`,
                  transition: 'width 0.3s ease',
                }} />
              </div>
            )}
            <style>{`@keyframes hq-spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}
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
            opacity: saving || isSyncing ? 0.85 : 1,
            pointerEvents: saving || isSyncing ? 'none' : 'auto',
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
               Show if materialOptions loaded from API, OR if we already have selected materials */}
          {(materialOptions.length > 0 || selectedMaterialIds.length > 0) && (
            <SearchableSelect
              label="Material (max 3)"
              options={materialOptions.map((m) => ({ id: m.id, name: m.title }))}
              value={selectedMaterialIds}
              onChange={(val) => {
                if (Array.isArray(val)) {
                  if (val.length <= 3) setSelectedMaterialIds(val as number[]);
                } else if (val) {
                  const num = Number(val);
                  if (selectedMaterialIds.length < 3 && !selectedMaterialIds.includes(num)) {
                    setSelectedMaterialIds([...selectedMaterialIds, num]);
                  }
                } else {
                  setSelectedMaterialIds([]);
                }
              }}
              maxSelections={3}
              placeholder="Select materials..."
            />
          )}

          {/* ── Model/Collection (Luxury brands like Chanel, LV, etc.) ── */}
          {(availableFields.includes('model') || selectedModelId || selectedCollectionId || modelOptions.length > 0) && (
            <div>
              <label style={labelStyle}>Model / Collection</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <select
                  style={{ ...glassSelect, width: '100%' }}
                  value={selectedCollectionId || ''}
                  onChange={(e) => {
                    setSelectedCollectionId(e.target.value ? Number(e.target.value) : null);
                    setSelectedModelId(null);
                  }}
                >
                  <option value="">-- Select Collection --</option>
                  {modelOptions.map((c) => (
                    <option key={`col-${c.id}`} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select
                  style={{ ...glassSelect, width: '100%' }}
                  value={selectedModelId || ''}
                  onChange={(e) => setSelectedModelId(e.target.value ? Number(e.target.value) : null)}
                  disabled={!selectedCollectionId}
                >
                  <option value="">-- Select Model --</option>
                  {modelOptions
                    .find((c) => c.id === selectedCollectionId)
                    ?.children?.map((m) => (
                      <option key={`mod-${m.id}`} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          )}

          {/* ── ISBN (Books category) ── */}
          {(availableFields.includes('isbn') || isbn) && (
            <div>
              <label style={labelStyle}>ISBN</label>
              <input
                type="text"
                value={isbn}
                onChange={(e) => setIsbn(e.target.value)}
                style={{ ...glassInput, width: '100%' }}
                placeholder="e.g. 9780123456789"
              />
            </div>
          )}

          {/* ── Measurements ── */}
          {((availableFields.includes('measurement_length') && availableFields.includes('measurement_width')) ||
            measurementLength ||
            measurementWidth) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={labelStyle}>Length (cm)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={measurementLength}
                    onChange={(e) => setMeasurementLength(e.target.value)}
                    style={{ ...glassInput, width: '100%' }}
                    placeholder="Length in cm"
                  />
                </div>
                <div>
                  <label style={labelStyle}>Width (cm)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={measurementWidth}
                    onChange={(e) => setMeasurementWidth(e.target.value)}
                    style={{ ...glassInput, width: '100%' }}
                    placeholder="Width in cm"
                  />
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
            <label style={labelStyle}>Price ({item?.currency || 'GBP'})</label>
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
            <button type="submit" style={{ ...btnPrimary, flex: 1, opacity: saving || detailLoading || isSyncing ? 0.7 : 1 }} disabled={saving || detailLoading || isSyncing}>
              {saving
                ? (isCreateMode ? 'Publishing…' : 'Saving…')
                : isSyncing ? 'Syncing…'
                : detailLoading ? 'Loading details…'
                : isCreateMode ? 'Publish Listing' : 'Save Changes'}
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
