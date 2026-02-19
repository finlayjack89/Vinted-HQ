import crypto from 'node:crypto';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export type LiveSnapshot = {
  title: string;
  description: string;
  price: number;
  currency: string;
  catalog_id: number | null;
  brand_id: number | null;
  size_id: number | null;
  status_id: number | null;
  package_size_id: number | null;
  color_ids: number[];
  item_attributes: { code: string; ids: number[] }[];
  is_unisex: boolean;
  isbn: string | null;
  measurement_length: number | null;
  measurement_width: number | null;
  model_metadata: { collection_id?: number; model_id?: number } | null;
  manufacturer: string | null;
  manufacturer_labelling: string | null;
  video_game_rating_id: number | null;
  shipment_prices: { domestic: Json; international: Json } | null;
};

function toNumberOrNull(v: unknown): number | null {
  const n = typeof v === 'number' ? v : (typeof v === 'string' ? Number(v) : NaN);
  return Number.isFinite(n) ? n : null;
}

function toStringOrEmpty(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function toStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s ? s : null;
}

function uniqSortedNumbers(arr: unknown): number[] {
  const raw = Array.isArray(arr) ? arr : [];
  const nums = raw
    .map((x) => toNumberOrNull(x))
    .filter((x): x is number => typeof x === 'number' && x > 0);
  const uniq = Array.from(new Set(nums));
  uniq.sort((a, b) => a - b);
  return uniq;
}

function normalizeItemAttributes(value: unknown): { code: string; ids: number[] }[] {
  if (!Array.isArray(value)) return [];
  const attrs: { code: string; ids: number[] }[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as Record<string, unknown>;
    const code = String(obj.code || '').trim();
    if (!code) continue;
    const ids = uniqSortedNumbers(obj.ids);
    attrs.push({ code, ids });
  }
  attrs.sort((a, b) => a.code.localeCompare(b.code));
  return attrs;
}

function stableJson(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(stableJson);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const out: Record<string, Json> = {};
    for (const k of keys) out[k] = stableJson(obj[k]);
    return out;
  }
  return String(value);
}

function stableStringifyJson(value: Json): string {
  // stableJson already sorts keys recursively; this is a safe stringify wrapper.
  return JSON.stringify(value);
}

export function buildLiveSnapshotFromItemData(itemData: Record<string, unknown>): LiveSnapshot {
  const shipment = itemData.shipment_prices && typeof itemData.shipment_prices === 'object' && !Array.isArray(itemData.shipment_prices)
    ? (itemData.shipment_prices as Record<string, unknown>)
    : null;

  const modelMetaRaw =
    itemData.model_metadata && typeof itemData.model_metadata === 'object' && !Array.isArray(itemData.model_metadata)
      ? (itemData.model_metadata as Record<string, unknown>)
      : null;
  const model_metadata = modelMetaRaw
    ? {
        ...(toNumberOrNull(modelMetaRaw.collection_id) ? { collection_id: Number(modelMetaRaw.collection_id) } : {}),
        ...(toNumberOrNull(modelMetaRaw.model_id) ? { model_id: Number(modelMetaRaw.model_id) } : {}),
      }
    : null;

  return {
    title: toStringOrEmpty(itemData.title).trim(),
    description: toStringOrEmpty(itemData.description),
    price: Number(toNumberOrNull(itemData.price) ?? 0),
    currency: toStringOrEmpty(itemData.currency || 'GBP'),
    catalog_id: toNumberOrNull(itemData.catalog_id),
    brand_id: toNumberOrNull(itemData.brand_id),
    size_id: toNumberOrNull(itemData.size_id),
    status_id: toNumberOrNull(itemData.status_id),
    package_size_id: toNumberOrNull(itemData.package_size_id),
    color_ids: uniqSortedNumbers(itemData.color_ids),
    item_attributes: normalizeItemAttributes(itemData.item_attributes),
    is_unisex: Boolean(itemData.is_unisex),
    isbn: toStringOrNull(itemData.isbn),
    measurement_length: toNumberOrNull(itemData.measurement_length),
    measurement_width: toNumberOrNull(itemData.measurement_width),
    model_metadata: model_metadata && (model_metadata.collection_id || model_metadata.model_id) ? model_metadata : null,
    manufacturer: toStringOrNull(itemData.manufacturer),
    manufacturer_labelling: toStringOrNull(itemData.manufacturer_labelling),
    video_game_rating_id: toNumberOrNull(itemData.video_game_rating_id),
    shipment_prices: shipment
      ? { domestic: stableJson(shipment.domestic), international: stableJson(shipment.international) }
      : null,
  };
}

export function buildLiveSnapshotFromVintedDetail(vinted: Record<string, unknown>): LiveSnapshot {
  // Vinted responses can vary (flat fields vs nested dto objects). For snapshotting,
  // we aim for a stable subset that matches what we PUT on edit.
  const priceObj = vinted.price && typeof vinted.price === 'object' && !Array.isArray(vinted.price)
    ? (vinted.price as Record<string, unknown>)
    : null;
  const currency = toStringOrEmpty(priceObj?.currency_code || vinted.currency || 'GBP');
  const amount = priceObj?.amount ?? vinted.price;

  return buildLiveSnapshotFromItemData({
    title: vinted.title,
    description: vinted.description ?? '',
    price: amount,
    currency,
    catalog_id: vinted.catalog_id ?? (vinted.catalog && typeof vinted.catalog === 'object' ? (vinted.catalog as Record<string, unknown>).id : null),
    brand_id: vinted.brand_id ?? (vinted.brand_dto && typeof vinted.brand_dto === 'object' ? (vinted.brand_dto as Record<string, unknown>).id : null),
    size_id: vinted.size_id ?? (vinted.size && typeof vinted.size === 'object' ? (vinted.size as Record<string, unknown>).id : null),
    status_id: vinted.status_id ?? (vinted.status && typeof vinted.status === 'object' ? (vinted.status as Record<string, unknown>).id : null),
    package_size_id: vinted.package_size_id ?? (vinted.package_size && typeof vinted.package_size === 'object' ? (vinted.package_size as Record<string, unknown>).id : null),
    color_ids: vinted.color_ids ?? vinted.colors ?? [],
    item_attributes: vinted.item_attributes ?? vinted.attributes ?? [],
    is_unisex: vinted.is_unisex,
    isbn: (vinted as Record<string, unknown>).isbn,
    measurement_length: (vinted as Record<string, unknown>).measurement_length,
    measurement_width: (vinted as Record<string, unknown>).measurement_width,
    model_metadata: (vinted as Record<string, unknown>).model_metadata,
    manufacturer: (vinted as Record<string, unknown>).manufacturer,
    manufacturer_labelling: (vinted as Record<string, unknown>).manufacturer_labelling,
    video_game_rating_id: (vinted as Record<string, unknown>).video_game_rating_id,
    shipment_prices: (vinted as Record<string, unknown>).shipment_prices,
  });
}

export function hashLiveSnapshot(snapshot: LiveSnapshot): string {
  const json = stableJson(snapshot);
  const s = stableStringifyJson(json);
  return crypto.createHash('sha256').update(s).digest('hex');
}

