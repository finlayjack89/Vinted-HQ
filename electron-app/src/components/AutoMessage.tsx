/**
 * AutoMessage — CRM Dashboard for Auto-Message & Offer Suite
 *
 * Features:
 * 1. Item Picker — compact 2-column grid of wardrobe thumbnails (excludes configured items)
 * 2. Preset Messages — save/load reusable message templates, selectable in rule form
 * 3. Dual-anchor delay slider — random delay range between min/max
 * 4. Ignored Users — username-based blocklist
 * 5. Active Rules & Logs — manage configs + view action history
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  colors,
  font,
  glassPanel,
  glassInput,
  glassTextarea,
  glassTable,
  tableHeader,
  tableHeaderCell,
  tableCell,
  tableRowHoverBg,
  badge,
  btnPrimary,
  btnSecondary,
  btnDanger,
  btnSmall,
  sectionTitle,
  sectionDesc,
  radius,
  spacing,
  transition,
} from '../theme';
import type {
  AutoMessageConfig,
  AutoMessageLog,
  AutoMessagePreset,
  CrmIgnoredUser,
  InventoryItem,
} from '../types/global';

// ─── Dual Range Slider ──────────────────────────────────────────────────────

function DualRangeSlider({
  min,
  max,
  valueMin,
  valueMax,
  onChange,
  unit = 'min',
}: {
  min: number;
  max: number;
  valueMin: number;
  valueMax: number;
  onChange: (low: number, high: number) => void;
  unit?: string;
}) {
  const pctMin = ((valueMin - min) / (max - min)) * 100;
  const pctMax = ((valueMax - min) / (max - min)) * 100;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: font.size.sm, color: colors.textSecondary }}>
          {valueMin} {unit}
        </span>
        <span style={{ fontSize: font.size.sm, color: colors.textSecondary }}>
          {valueMax} {unit}
        </span>
      </div>
      <div style={{ position: 'relative', height: 32 }}>
        <div style={{
          position: 'absolute', top: 13, left: 0, right: 0, height: 6,
          background: 'rgba(255,255,255,0.06)', borderRadius: 3,
        }} />
        <div style={{
          position: 'absolute', top: 13, height: 6,
          left: `${pctMin}%`, width: `${pctMax - pctMin}%`,
          background: `linear-gradient(90deg, ${colors.primary}, ${colors.primaryHover})`,
          borderRadius: 3, boxShadow: `0 0 8px ${colors.primaryGlow}`,
        }} />
        <input
          type="range" min={min} max={max} value={valueMin}
          onChange={(e) => onChange(Math.min(Number(e.target.value), valueMax - 1), valueMax)}
          style={{ ...sliderInputStyle, zIndex: 3 }}
        />
        <input
          type="range" min={min} max={max} value={valueMax}
          onChange={(e) => onChange(valueMin, Math.max(Number(e.target.value), valueMin + 1))}
          style={{ ...sliderInputStyle, zIndex: 4 }}
        />
      </div>
      <div style={{
        textAlign: 'center', marginTop: 4,
        fontSize: font.size.xs, color: colors.textMuted,
      }}>
        Random delay between {valueMin}–{valueMax} {unit}
      </div>
    </div>
  );
}

const sliderInputStyle: React.CSSProperties = {
  position: 'absolute', top: 0, left: 0, width: '100%', height: 32,
  appearance: 'none', WebkitAppearance: 'none',
  background: 'transparent', pointerEvents: 'none', cursor: 'pointer',
};

// ─── Global Delay Settings ──────────────────────────────────────────────────────────

function GlobalDelaySettings() {
  const [delayMin, setDelayMin] = React.useState(2);
  const [delayMax, setDelayMax] = React.useState(5);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    window.vinted.getSettings().then((s: Record<string, unknown>) => {
      setDelayMin((s.crm_delay_min_minutes as number) ?? 2);
      setDelayMax((s.crm_delay_max_minutes as number) ?? 5);
      setLoaded(true);
    });
  }, []);

  const save = (min: number, max: number) => {
    setDelayMin(min);
    setDelayMax(max);
    void window.vinted.setSettings({ crm_delay_min_minutes: min, crm_delay_max_minutes: max });
  };

  if (!loaded) return null;

  return (
    <div className="liquid-glass-panel" style={{ ...glassPanel, padding: spacing.md, marginBottom: spacing.lg }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
        <h3 style={{ ...sectionTitle, margin: 0, fontSize: font.size.base }}>
          Delay Between Messages
        </h3>
        <span style={{ fontSize: font.size.xs, color: colors.textMuted }}>
          Random {delayMin}–{delayMax} min between each user
        </span>
      </div>
      <DualRangeSlider
        min={1} max={30}
        valueMin={delayMin}
        valueMax={delayMax}
        onChange={(low, high) => save(low, high)}
      />
    </div>
  );
}

// ─── Item Picker Grid ───────────────────────────────────────────────────────

function ItemPickerGrid({
  items,
  configuredIds,
  onSelect,
}: {
  items: InventoryItem[];
  configuredIds: Set<string>;
  onSelect: (item: InventoryItem) => void;
}) {
  const available = items.filter((item) => {
    const vintedId = item.vinted_item_id ? String(item.vinted_item_id) : null;
    return vintedId && !configuredIds.has(vintedId);
  });

  if (available.length === 0) {
    return (
      <div style={{ padding: spacing.xl, textAlign: 'center', color: colors.textMuted }}>
        All listed items already have auto-message rules.
      </div>
    );
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(2, 1fr)',
      gap: spacing.sm,
      maxHeight: 340,
      overflowY: 'auto',
      padding: spacing.xs,
    }}>
      {available.map((item) => {
        const thumb = item.photo_urls?.[0] || item.local_image_paths?.[0] || '';
        return (
          <button
            key={item.id}
            onClick={() => onSelect(item)}
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: `1px solid ${colors.glassBorder}`,
              borderRadius: radius.md,
              padding: 0,
              cursor: 'pointer',
              overflow: 'hidden',
              transition: transition.base,
              textAlign: 'left',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = colors.primary;
              e.currentTarget.style.boxShadow = `0 0 10px ${colors.primaryGlow}`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = colors.glassBorder;
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <div style={{
              width: '100%', height: 100, overflow: 'hidden',
              background: colors.bgElevated,
            }}>
              {thumb ? (
                <img
                  src={thumb} alt={item.title}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <div style={{
                  width: '100%', height: '100%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: colors.textMuted, fontSize: font.size.xs,
                }}>No image</div>
              )}
            </div>
            <div style={{
              padding: `4px ${spacing.sm}px`,
              fontSize: font.size.xs,
              fontWeight: font.weight.medium,
              color: colors.textPrimary,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {item.title}
            </div>
            <div style={{
              padding: `0 ${spacing.sm}px 4px`,
              fontSize: 10,
              color: colors.textMuted,
            }}>
              {(item as Record<string, unknown>).brand as string || ''} · £{typeof item.price === 'number' ? item.price.toFixed(2) : item.price}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── Preset Manager ─────────────────────────────────────────────────────────

function PresetManager({
  presets,
  onSelect,
  onSave,
  onDelete,
}: {
  presets: AutoMessagePreset[];
  onSelect: (body: string) => void;
  onSave: (preset: { name: string; body: string }) => void;
  onDelete: (id: number) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [editName, setEditName] = useState('');
  const [editBody, setEditBody] = useState('');

  const handleSave = () => {
    if (!editName.trim() || !editBody.trim()) return;
    onSave({ name: editName.trim(), body: editBody.trim() });
    setEditName(''); setEditBody(''); setShowAdd(false);
  };

  return (
    <div className="liquid-glass-panel" style={{ ...glassPanel, padding: spacing.lg, marginBottom: spacing.lg }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
        <h3 style={{ ...sectionTitle, margin: 0, fontSize: font.size.lg }}>Preset Messages</h3>
        <button style={{ ...btnSecondary, ...btnSmall }} onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? 'Cancel' : '+ New'}
        </button>
      </div>
      {showAdd && (
        <div style={{ marginBottom: spacing.md }}>
          <input
            placeholder="Preset name (e.g. 'Friendly Greeting')"
            value={editName} onChange={(e) => setEditName(e.target.value)}
            style={{ ...glassInput, width: '100%', marginBottom: spacing.sm }}
          />
          <textarea
            placeholder="Message body…"
            value={editBody} onChange={(e) => setEditBody(e.target.value)}
            rows={3} style={{ ...glassTextarea, width: '100%', marginBottom: spacing.sm }}
          />
          <button style={{ ...btnPrimary, ...btnSmall }} onClick={handleSave}>Save Preset</button>
        </div>
      )}
      {presets.length === 0 && !showAdd && (
        <p style={{ color: colors.textMuted, fontSize: font.size.sm, margin: 0 }}>
          No presets yet. Create one to speed up rule creation.
        </p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.xs }}>
        {presets.map((p) => (
          <div
            key={p.id}
            style={{
              display: 'flex', alignItems: 'center', gap: spacing.sm,
              padding: `${spacing.sm}px ${spacing.md}px`,
              background: 'rgba(255,255,255,0.02)', borderRadius: radius.md,
              transition: transition.fast, cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
            onClick={() => onSelect(p.body)}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: font.size.sm, fontWeight: font.weight.semibold, color: colors.textPrimary }}>{p.name}</div>
              <div style={{ fontSize: font.size.xs, color: colors.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.body}</div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(p.id); }}
              style={{ ...btnDanger, ...btnSmall, padding: '4px 8px', fontSize: font.size.xs }}
            >✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Ignored Users Panel ────────────────────────────────────────────────────

function IgnoredUsersPanel({
  users,
  onAdd,
  onRemove,
}: {
  users: CrmIgnoredUser[];
  onAdd: (username: string) => void;
  onRemove: (username: string) => void;
}) {
  const [input, setInput] = useState('');
  const [expanded, setExpanded] = useState(false);

  const handleAdd = () => {
    if (!input.trim()) return;
    onAdd(input.trim());
    setInput('');
  };

  return (
    <div style={{ ...glassPanel, padding: spacing.lg, marginBottom: spacing.lg }}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        onClick={() => setExpanded(!expanded)}
      >
        <h3 style={{ ...sectionTitle, margin: 0, fontSize: font.size.lg }}>
          Ignored Users {users.length > 0 && <span style={{ color: colors.textMuted, fontWeight: font.weight.normal }}>({users.length})</span>}
        </h3>
        <span style={{ color: colors.textSecondary, fontSize: font.size.sm }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>
      {expanded && (
        <div style={{ marginTop: spacing.md }}>
          <div style={{ display: 'flex', gap: spacing.sm, marginBottom: spacing.md }}>
            <input
              placeholder="Vinted username…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
              style={{ ...glassInput, flex: 1 }}
            />
            <button style={{ ...btnPrimary, ...btnSmall }} onClick={handleAdd} disabled={!input.trim()}>
              Add
            </button>
          </div>
          {users.length === 0 && (
            <p style={{ color: colors.textMuted, fontSize: font.size.sm, margin: 0 }}>
              No ignored users. Add a Vinted username to block auto-messages.
            </p>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.xs }}>
            {users.map((u) => (
              <div key={u.username} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', borderRadius: radius.full,
                background: 'rgba(255,255,255,0.04)', border: `1px solid ${colors.glassBorder}`,
                fontSize: font.size.sm, color: colors.textPrimary,
              }}>
                {u.username}
                <button
                  onClick={() => onRemove(u.username)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: colors.error, fontSize: font.size.xs, padding: 0,
                    lineHeight: 1,
                  }}
                >✕</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Status Badge ───────────────────────────────────────────────────────────

const statusColors: Record<string, { bg: string; fg: string }> = {
  scheduled: { bg: colors.infoBg, fg: colors.info },
  executing: { bg: colors.warningBg, fg: colors.warning },
  sent: { bg: colors.successBg, fg: colors.success },
  error: { bg: colors.errorBg, fg: colors.error },
  cancelled: { bg: 'rgba(255,255,255,0.06)', fg: colors.textMuted },
  skipped_existing_convo: { bg: colors.warningBg, fg: colors.warning },
  pending: { bg: colors.infoBg, fg: colors.info },
};

function StatusBadge({ status }: { status: string }) {
  const c = statusColors[status] ?? statusColors.pending;
  const label = status === 'skipped_existing_convo' ? 'skipped' : status;
  return <span style={badge(c.bg, c.fg)}>{label}</span>;
}

// ─── Config Form ────────────────────────────────────────────────────────────

function ConfigForm({
  initial,
  selectedItem,
  presets,
  messageText,
  onSave,
  onCancel,
}: {
  initial?: AutoMessageConfig;
  selectedItem?: InventoryItem | null;
  presets: AutoMessagePreset[];
  messageText?: string;
  onSave: (config: Omit<AutoMessageConfig, 'created_at' | 'updated_at'>, backfillHours?: number) => void;
  onCancel: () => void;
}) {
  const itemId = initial?.item_id ?? (selectedItem?.vinted_item_id ? String(selectedItem.vinted_item_id) : '');
  const itemTitle = selectedItem?.title ?? `Item #${itemId}`;
  const itemPrice = selectedItem?.price;
  const itemThumb = selectedItem?.photo_urls?.[0];

  const [form, setForm] = useState({
    message_text: initial?.message_text ?? messageText ?? '',
    offer_price: initial?.offer_price ?? null as number | null,
    send_offer_first: initial?.send_offer_first ?? false,
    is_active: initial?.is_active ?? true,
  });

  const [backfillEnabled, setBackfillEnabled] = useState(!initial);
  const [backfillValue, setBackfillValue] = useState(24);
  const [backfillUnit, setBackfillUnit] = useState<'minutes' | 'hours' | 'days' | 'weeks'>('hours');

  // Update message text when a preset is selected externally
  useEffect(() => {
    if (messageText && messageText !== form.message_text) {
      setForm((prev) => ({ ...prev, message_text: messageText }));
    }
  }, [messageText]);

  return (
    <div className="liquid-glass-panel" style={{ ...glassPanel, padding: spacing.xl, marginBottom: spacing.lg }}>
      <h3 style={{ ...sectionTitle, marginBottom: spacing.md }}>
        {initial ? 'Edit Rule' : 'Create Rule'}
      </h3>

      {/* Selected item preview */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: spacing.md,
        padding: spacing.md, marginBottom: spacing.lg,
        background: 'rgba(255,255,255,0.03)',
        borderRadius: radius.md, border: `1px solid ${colors.glassBorder}`,
      }}>
        {itemThumb && (
          <img
            src={itemThumb} alt={itemTitle}
            style={{ width: 48, height: 48, borderRadius: radius.sm, objectFit: 'cover' }}
          />
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: font.weight.semibold, color: colors.textPrimary }}>
            {itemTitle}
          </div>
          <div style={{ fontSize: font.size.xs, color: colors.textMuted, fontFamily: font.mono }}>
            ID: {itemId}
          </div>
        </div>
        {itemPrice != null && (
          <div style={{
            fontSize: font.size.lg, fontWeight: font.weight.bold, color: colors.primary,
          }}>
            £{typeof itemPrice === 'number' ? itemPrice.toFixed(2) : itemPrice}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.md }}>
        {/* Preset selector */}
        {presets.length > 0 && (
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Use Preset Message</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.xs }}>
              {presets.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setForm({ ...form, message_text: p.body })}
                  style={{
                    padding: '5px 12px',
                    borderRadius: radius.full,
                    border: `1px solid ${form.message_text === p.body ? colors.primary : colors.glassBorder}`,
                    background: form.message_text === p.body ? colors.primaryMuted : 'rgba(255,255,255,0.03)',
                    color: form.message_text === p.body ? colors.primary : colors.textSecondary,
                    fontSize: font.size.xs,
                    fontWeight: font.weight.semibold,
                    fontFamily: font.family,
                    cursor: 'pointer',
                    transition: transition.fast,
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Message Text</label>
          <textarea
            placeholder="Hi! Thanks for your interest…"
            value={form.message_text ?? ''}
            onChange={(e) => setForm({ ...form, message_text: e.target.value })}
            rows={3}
            style={{ ...glassTextarea, width: '100%' }}
          />
        </div>
        <div>
          <label style={labelStyle}>Offer Price (£)</label>
          <input
            type="number"
            placeholder="Leave empty for no offer"
            value={form.offer_price ?? ''}
            onChange={(e) => setForm({
              ...form,
              offer_price: e.target.value ? Number(e.target.value) : null,
            })}
            step="0.01" min="0"
            style={{ ...glassInput, width: '100%' }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.lg, paddingTop: 24 }}>
          <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox" checked={form.send_offer_first}
              onChange={(e) => setForm({ ...form, send_offer_first: e.target.checked })}
              style={{ accentColor: colors.primary }}
            />
            Send offer first
          </label>
          <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox" checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              style={{ accentColor: colors.success }}
            />
            Active
          </label>
        </div>

        {/* Backfill past likes — always visible */}
        <div style={{ gridColumn: '1 / -1', padding: spacing.md, background: 'rgba(255,255,255,0.02)', borderRadius: radius.md, border: `1px solid ${colors.glassBorder}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
            <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 0 }}>
              <input
                type="checkbox" checked={backfillEnabled}
                onChange={(e) => setBackfillEnabled(e.target.checked)}
                style={{ accentColor: colors.info }}
              />
              Include past likes
            </label>
          </div>
          {backfillEnabled && (
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm }}>
              <span style={{ fontSize: font.size.sm, color: colors.textSecondary }}>Go back</span>
              <input
                type="number" min={1}
                value={backfillValue}
                onChange={(e) => setBackfillValue(Math.max(1, Number(e.target.value) || 1))}
                style={{ ...glassInput, width: 60, padding: '4px 8px', textAlign: 'center', fontSize: font.size.sm }}
              />
              <select
                value={backfillUnit}
                onChange={(e) => setBackfillUnit(e.target.value as 'minutes' | 'hours' | 'days' | 'weeks')}
                style={{ ...glassInput, padding: '5px 8px', fontSize: font.size.sm, cursor: 'pointer' }}
              >
                <option value="minutes">minutes</option>
                <option value="hours">hours</option>
                <option value="days">days</option>
                <option value="weeks">weeks</option>
              </select>
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: spacing.sm, marginTop: spacing.lg }}>
        <button style={btnPrimary} onClick={() => {
            const backfillHours = backfillEnabled
              ? backfillValue * (backfillUnit === 'minutes' ? 1/60 : backfillUnit === 'hours' ? 1 : backfillUnit === 'days' ? 24 : 168)
              : undefined;
            onSave({
              item_id: itemId,
              message_text: form.message_text || null,
              offer_price: form.offer_price,
              delay_min_minutes: 2,
              delay_max_minutes: 5,
              send_offer_first: form.send_offer_first,
              is_active: form.is_active,
            }, backfillHours);
          }}
          disabled={!itemId}
        >
          {initial ? 'Update' : 'Create Rule'}
        </button>
        <button style={btnSecondary} onClick={onCancel}>Close</button>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function AutoMessage() {
  const [configs, setConfigs] = useState<AutoMessageConfig[]>([]);
  const [logs, setLogs] = useState<AutoMessageLog[]>([]);
  const [presets, setPresets] = useState<AutoMessagePreset[]>([]);
  const [ignoredUsers, setIgnoredUsers] = useState<CrmIgnoredUser[]>([]);
  const [wardrobeItems, setWardrobeItems] = useState<InventoryItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<'configs' | 'logs'>('configs');

  const [showForm, setShowForm] = useState(false);
  const [editConfig, setEditConfig] = useState<AutoMessageConfig | undefined>();
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [presetMessageText, setPresetMessageText] = useState('');
  const [showItemPicker, setShowItemPicker] = useState(false);

  const configuredIds = new Set(configs.map((c) => c.item_id));

  const reload = useCallback(async () => {
    const [cfgs, lg, running, prsts, wardrobe, ignored] = await Promise.all([
      window.vinted.getCrmConfigs(),
      window.vinted.getCrmLogs({}),
      window.vinted.isCrmRunning(),
      window.vinted.getCrmPresets(),
      window.vinted.getWardrobe({ status: 'live' }),
      window.vinted.getCrmIgnoredUsers(),
    ]);
    setConfigs(cfgs); setLogs(lg); setIsRunning(running);
    setPresets(prsts); setWardrobeItems(wardrobe); setIgnoredUsers(ignored);
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const unsub = window.vinted.onCrmActionLog(() => { void reload(); });
    return unsub;
  }, [reload]);

  const handleSaveConfig = async (config: Omit<AutoMessageConfig, 'created_at' | 'updated_at'>, backfillHours?: number) => {
    await window.vinted.upsertCrmConfig(config);
    if (backfillHours) {
      // Trigger backfill after saving the config
      await window.vinted.backfillCrmItem(config.item_id, backfillHours);
    }
    setShowForm(false); setEditConfig(undefined); setSelectedItem(null);
    setPresetMessageText(''); setShowItemPicker(false);
    void reload();
  };

  const handleDeleteConfig = async (itemId: string) => {
    await window.vinted.deleteCrmConfig(itemId);
    void reload();
  };

  const handleToggleActive = async (config: AutoMessageConfig) => {
    await window.vinted.upsertCrmConfig({ ...config, is_active: !config.is_active });
    void reload();
  };

  const handleToggleService = async () => {
    if (isRunning) { await window.vinted.stopCrm(); } else { await window.vinted.startCrm(); }
    void reload();
  };

  const handleSavePreset = async (preset: { name: string; body: string }) => {
    await window.vinted.upsertCrmPreset(preset);
    void reload();
  };

  const handleDeletePreset = async (id: number) => {
    await window.vinted.deleteCrmPreset(id);
    void reload();
  };

  const handleSelectPresetMessage = (body: string) => {
    setPresetMessageText(body);
  };

  const handleSelectItem = (item: InventoryItem) => {
    setSelectedItem(item); setShowItemPicker(false);
    setShowForm(true); setEditConfig(undefined);
  };

  const handleAddIgnoredUser = async (username: string) => {
    await window.vinted.addCrmIgnoredUser(username);
    void reload();
  };

  const handleRemoveIgnoredUser = async (username: string) => {
    await window.vinted.removeCrmIgnoredUser(username);
    void reload();
  };

  const [backfillTarget, setBackfillTarget] = useState<string | null>(null);
  const [backfillHoursSelect, setBackfillHoursSelect] = useState(24);

  const handleBackfill = async (itemId: string, hours: number) => {
    setBackfillTarget(null);
    await window.vinted.backfillCrmItem(itemId, hours);
    void reload();
  };

  const findWardrobeItem = (itemId: string): InventoryItem | undefined =>
    wardrobeItems.find((w) => String(w.vinted_item_id) === itemId);

  return (
    <div style={{ padding: spacing['3xl'], maxWidth: 1200 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.lg }}>
        <div>
          <h2 style={{ margin: 0, fontSize: font.size['2xl'], fontWeight: font.weight.bold, color: colors.textPrimary }}>
            Auto-Message & Offers
          </h2>
          <p style={{ ...sectionDesc, marginTop: 4 }}>
            Automatically respond to buyers who like your items
          </p>
        </div>
        <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 16px', borderRadius: radius.full,
            background: isRunning ? colors.successBg : 'rgba(255,255,255,0.04)',
            transition: transition.base,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: isRunning ? colors.success : colors.textMuted,
              boxShadow: isRunning ? `0 0 8px ${colors.success}` : 'none',
              animation: isRunning ? 'pulse 2s infinite' : 'none',
            }} />
            <span style={{ fontSize: font.size.sm, fontWeight: font.weight.semibold, color: isRunning ? colors.success : colors.textMuted }}>
              {isRunning ? 'Running' : 'Stopped'}
            </span>
          </div>
          <button
            style={isRunning ? { ...btnDanger, ...btnSmall } : { ...btnPrimary, ...btnSmall }}
            onClick={handleToggleService}
          >
            {isRunning ? 'Stop' : 'Start'}
          </button>
        </div>
      </div>

      {/* Global Delay Settings */}
      <GlobalDelaySettings />

      {/* Preset Messages */}
      <PresetManager
        presets={presets}
        onSelect={handleSelectPresetMessage}
        onSave={handleSavePreset}
        onDelete={handleDeletePreset}
      />

      {/* Ignored Users */}
      <IgnoredUsersPanel
        users={ignoredUsers}
        onAdd={handleAddIgnoredUser}
        onRemove={handleRemoveIgnoredUser}
      />

      {/* Tab Bar */}
      <div style={{ display: 'flex', gap: 2, marginBottom: spacing.lg }}>
        {(['configs', 'logs'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '10px 20px', border: 'none',
              borderRadius: `${radius.md}px ${radius.md}px 0 0`,
              background: activeTab === tab ? colors.primaryMuted : 'transparent',
              color: activeTab === tab ? colors.primary : colors.textSecondary,
              fontWeight: activeTab === tab ? font.weight.semibold : font.weight.medium,
              fontSize: font.size.base, fontFamily: font.family,
              cursor: 'pointer', transition: transition.base,
            }}
          >
            {tab === 'configs' ? `Rules (${configs.length})` : `Logs (${logs.length})`}
          </button>
        ))}
      </div>

      {/* Configs Tab */}
      {activeTab === 'configs' && (
        <>
          {showForm && (
            <ConfigForm
              initial={editConfig}
              selectedItem={selectedItem}
              presets={presets}
              messageText={presetMessageText}
              onSave={handleSaveConfig}
              onCancel={() => {
                setShowForm(false); setEditConfig(undefined);
                setSelectedItem(null); setPresetMessageText('');
              }}
            />
          )}
          {!showForm && (
            <div style={{ marginBottom: spacing.lg }}>
              <button style={btnPrimary} onClick={() => setShowItemPicker(!showItemPicker)}>
                {showItemPicker ? 'Hide Items' : '+ Add Rule'}
              </button>
            </div>
          )}
          {showItemPicker && !showForm && (
            <div style={{ ...glassPanel, padding: spacing.lg, marginBottom: spacing.lg }}>
              <h3 style={{ ...sectionTitle, marginBottom: spacing.sm }}>Select an Item</h3>
              <p style={{ ...sectionDesc, marginBottom: spacing.md }}>
                Items with existing rules are hidden.
              </p>
              <ItemPickerGrid
                items={wardrobeItems}
                configuredIds={configuredIds}
                onSelect={handleSelectItem}
              />
            </div>
          )}
          <div style={glassTable}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={tableHeader}>
                    <th style={tableHeaderCell}>Item</th>
                    <th style={tableHeaderCell}>Message</th>
                    <th style={tableHeaderCell}>Offer</th>
                    <th style={tableHeaderCell}>Status</th>
                    <th style={{ ...tableHeaderCell, textAlign: 'right' as const }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {configs.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ ...tableCell, textAlign: 'center', color: colors.textMuted, padding: spacing['3xl'] }}>
                        No rules configured. Click "+ Add Rule" to get started.
                      </td>
                    </tr>
                  )}
                  {configs.map((cfg) => {
                    const wItem = findWardrobeItem(cfg.item_id);
                    const thumb = wItem?.photo_urls?.[0] || '';
                    return (
                      <tr
                        key={cfg.item_id} style={{ transition: transition.fast }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = tableRowHoverBg; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                      >
                        <td style={{ ...tableCell, minWidth: 180 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
                            {thumb && <img src={thumb} alt="" style={{ width: 32, height: 32, borderRadius: radius.sm, objectFit: 'cover' }} />}
                            <div>
                              <div style={{ fontSize: font.size.sm, fontWeight: font.weight.medium, color: colors.textPrimary, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {wItem?.title || `#${cfg.item_id}`}
                              </div>
                              <div style={{ fontSize: font.size.xs, color: colors.textMuted, fontFamily: font.mono }}>{cfg.item_id}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ ...tableCell, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {cfg.message_text || <span style={{ color: colors.textMuted }}>—</span>}
                        </td>
                        <td style={{ ...tableCell, whiteSpace: 'nowrap' }}>
                          {cfg.offer_price ? `£${cfg.offer_price.toFixed(2)}` : <span style={{ color: colors.textMuted }}>—</span>}
                        </td>
                        <td style={tableCell}>
                          <button onClick={() => handleToggleActive(cfg)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                            <span style={badge(cfg.is_active ? colors.successBg : 'rgba(255,255,255,0.06)', cfg.is_active ? colors.success : colors.textMuted)}>
                              {cfg.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </button>
                        </td>
                        <td style={{ ...tableCell, textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: spacing.xs, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                            {backfillTarget === cfg.item_id ? (
                              <div style={{ display: 'flex', gap: spacing.xs, alignItems: 'center' }}>
                                <select
                                  value={backfillHoursSelect}
                                  onChange={(e) => setBackfillHoursSelect(Number(e.target.value))}
                                  style={{ ...glassInput, padding: '4px 6px', fontSize: font.size.xs }}
                                >
                                  <option value={6}>6h</option>
                                  <option value={12}>12h</option>
                                  <option value={24}>24h</option>
                                  <option value={48}>48h</option>
                                  <option value={168}>7d</option>
                                </select>
                                <button style={{ ...btnPrimary, ...btnSmall, fontSize: font.size.xs }} onClick={() => handleBackfill(cfg.item_id, backfillHoursSelect)}>Go</button>
                                <button style={{ ...btnSecondary, ...btnSmall, fontSize: font.size.xs }} onClick={() => setBackfillTarget(null)}>✕</button>
                              </div>
                            ) : (
                              <button style={{ ...btnSecondary, ...btnSmall, fontSize: font.size.xs }} onClick={() => setBackfillTarget(cfg.item_id)}>Backfill</button>
                            )}
                            <button style={{ ...btnSecondary, ...btnSmall }} onClick={() => { setEditConfig(cfg); setSelectedItem(wItem ?? null); setShowItemPicker(false); setShowForm(true); }}>Edit</button>
                            <button style={{ ...btnDanger, ...btnSmall }} onClick={() => handleDeleteConfig(cfg.item_id)}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Logs Tab */}
      {activeTab === 'logs' && (
        <div style={glassTable}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: `${spacing.sm}px ${spacing.md}px`, borderBottom: `1px solid ${colors.glassBorder}` }}>
            <button
              style={{ ...btnSecondary, ...btnSmall, fontSize: font.size.xs }}
              onClick={async () => { await window.vinted.clearCrmLogs(); void reload(); }}
            >
              Clear Logs
            </button>
          </div>
          <div style={{ overflowX: 'auto', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={tableHeader}>
                  <th style={tableHeaderCell}>Time</th>
                  <th style={tableHeaderCell}>Item</th>
                  <th style={tableHeaderCell}>User</th>
                  <th style={tableHeaderCell}>Action</th>
                  <th style={tableHeaderCell}>Status</th>
                  <th style={tableHeaderCell}>Error</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ ...tableCell, textAlign: 'center', color: colors.textMuted, padding: spacing['3xl'] }}>
                      No actions dispatched yet. Start the service and wait for likes.
                    </td>
                  </tr>
                )}
                {logs.map((log) => {
                  const wItem = findWardrobeItem(log.item_id);
                  return (
                    <tr key={log.notification_id} style={{ transition: transition.fast }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = tableRowHoverBg; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                    >
                      <td style={{ ...tableCell, fontFamily: font.mono, fontSize: font.size.xs, whiteSpace: 'nowrap' }}>
                        {new Date(log.timestamp * 1000).toLocaleString()}
                      </td>
                      <td style={{ ...tableCell, fontSize: font.size.sm }}>{wItem?.title || log.item_id}</td>
                      <td style={{ ...tableCell, fontSize: font.size.sm }}>
                        {log.receiver_username || <span style={{ fontFamily: font.mono, fontSize: font.size.xs, color: colors.textMuted }}>{log.receiver_id}</span>}
                      </td>
                      <td style={tableCell}>{log.action_type}</td>
                      <td style={tableCell}><StatusBadge status={log.status} /></td>
                      <td style={{ ...tableCell, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: colors.error }}>
                        {log.error_message || ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 18px; height: 18px; border-radius: 50%;
          background: linear-gradient(135deg, ${colors.primary}, ${colors.primaryHover});
          box-shadow: 0 2px 8px ${colors.primaryGlow};
          cursor: pointer; pointer-events: all;
          border: 2px solid ${colors.bgElevated};
        }
        input[type="range"]::-moz-range-thumb {
          width: 18px; height: 18px; border-radius: 50%;
          background: linear-gradient(135deg, ${colors.primary}, ${colors.primaryHover});
          box-shadow: 0 2px 8px ${colors.primaryGlow};
          cursor: pointer; pointer-events: all;
          border: 2px solid ${colors.bgElevated};
        }
      `}</style>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: font.size.sm,
  fontWeight: font.weight.medium, color: colors.textSecondary, marginBottom: 6,
};
