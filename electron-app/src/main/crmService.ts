/**
 * CRM Service — Auto-Message & Offer State Machine
 *
 * Uses a unified sequential queue to process actions one at a time.
 * All items share the same queue, sorted oldest-like-first.
 *
 * Architecture:
 *   setInterval (polling) → collectNotifications() → enqueue
 *   processQueue() loop → pop item → execute → wait delay → next
 */

import { BrowserWindow } from 'electron';
import * as bridge from './bridge';
import type { BridgeErrorResult } from './bridge';
import {
  getAutoMessageConfig,
  hasProcessedNotification,
  insertAutoMessageLog,
  updateAutoMessageLogStatus,
  isCrmIgnoredUser,
  type AutoMessageConfig,
} from './inventoryDb';
import { getSetting } from './settings';

// ─── Types ──────────────────────────────────────────────────────────────────

interface QueueItem {
  notificationId: string;
  itemId: string;
  receiverId: string;
  receiverUsername: string; // the Vinted username (for logs + ignore check)
  config: AutoMessageConfig;
  likeDate: number; // epoch ms of the original like
}

interface NotificationEntry {
  id?: string | number;
  entry_type?: number;
  type?: number | string;
  notification_type?: number | string;
  notification_link?: string;
  link?: string;
  url?: string;
  path?: string;
  action_url?: string;
  subject?: { url?: string; link?: string; [key: string]: unknown };
  action?: { url?: string; link?: string; [key: string]: unknown };
  data?: Record<string, unknown>;
  user?: { login?: string; id?: number; [key: string]: unknown };
  initiator?: { login?: string; id?: number; [key: string]: unknown };
  from_user?: { login?: string; id?: number; [key: string]: unknown };
  actor?: { login?: string; id?: number; [key: string]: unknown };
  created_at?: number | string;
  updated_at?: number | string;
  timestamp?: number;
  date?: number | string;
  time?: number | string;
  [key: string]: unknown;
}

// ─── State ──────────────────────────────────────────────────────────────────

let pollingInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

/** The unified action queue — sorted oldest like first */
const actionQueue: QueueItem[] = [];
let isProcessingQueue = false;
let isFirstAction = true;

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitteredDelay(baseMs: number): number {
  return baseMs + Math.floor(Math.random() * baseMs * 0.2);
}

function emitToRenderer(channel: string, data: Record<string, unknown>): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, data);
  }
}

// ─── Notification Parsing Helpers ───────────────────────────────────────────

function findNotificationArray(data: Record<string, unknown>): NotificationEntry[] {
  const knownKeys = ['notifications', 'inbox_notifications', 'data', 'items', 'entries'];
  for (const key of knownKeys) {
    const val = data[key];
    if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
      return val as NotificationEntry[];
    }
  }
  for (const key of Object.keys(data)) {
    const val = data[key];
    if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
      return val as NotificationEntry[];
    }
  }
  return [];
}

function extractEntryType(notif: NotificationEntry): number | null {
  for (const field of ['entry_type', 'type', 'notification_type'] as const) {
    const val = (notif as Record<string, unknown>)[field];
    if (val !== undefined && val !== null) {
      const num = typeof val === 'string' ? Number(val) : Number(val);
      if (!isNaN(num)) return num;
    }
  }
  return null;
}

function extractNotificationLink(notif: NotificationEntry): string {
  const directFields = ['notification_link', 'link', 'url', 'path', 'action_url'];
  for (const f of directFields) {
    const val = (notif as Record<string, unknown>)[f];
    if (typeof val === 'string' && val.length > 0) return val;
  }
  const nested = [notif.subject, notif.action, notif.data];
  for (const obj of nested) {
    if (!obj || typeof obj !== 'object') continue;
    for (const f of ['url', 'link', 'path', 'notification_link', 'action_url']) {
      const val = (obj as Record<string, unknown>)[f];
      if (typeof val === 'string' && val.length > 0) return val;
    }
  }
  return '';
}

function parseNotificationLink(link: string): { itemId: string; receiverId: string } | null {
  try {
    const itemMatch =
      link.match(/\/items\/(\d+)/) ??
      link.match(/item_id=(\d+)/);
    const receiverMatch =
      link.match(/receiver_id=(\d+)/) ??
      link.match(/offering_id=(\d+)/) ??
      link.match(/user_id=(\d+)/) ??
      link.match(/sender_id=(\d+)/);
    if (itemMatch && receiverMatch) {
      return { itemId: itemMatch[1], receiverId: receiverMatch[1] };
    }
    const itemParamMatch = link.match(/item_id=(\d+)/);
    if (itemParamMatch && receiverMatch) {
      return { itemId: itemParamMatch[1], receiverId: receiverMatch[1] };
    }
  } catch {
    // parse error
  }
  return null;
}

function extractLikeTimestamp(notif: NotificationEntry): number {
  // Try multiple timestamp field paths
  const candidates = [
    notif.created_at,
    notif.updated_at,
    notif.timestamp,
    notif.date,
    notif.time,
    (notif.data as Record<string, unknown> | undefined)?.created_at,
    (notif.data as Record<string, unknown> | undefined)?.timestamp,
  ];
  for (const raw of candidates) {
    if (raw === undefined || raw === null) continue;
    const num = typeof raw === 'string' ? Number(raw) : Number(raw);
    if (!num || isNaN(num)) continue;
    return num > 1e12 ? num : num * 1000;
  }
  return 0; // unknown — don't fake "now"
}

/**
 * Extract the username of the person who liked the item.
 * Vinted notifications may store the user in different nested objects.
 */
function extractLikerUsername(notif: NotificationEntry): string {
  // Try direct user objects
  const candidates = [
    notif.initiator?.login,
    notif.from_user?.login,
    notif.actor?.login,
    notif.user?.login,
    (notif.data as Record<string, unknown> | undefined)?.user_login as string | undefined,
  ];
  for (const val of candidates) {
    if (typeof val === 'string' && val.length > 0) return val;
  }
  return '';
}

// ─── Enqueue Logic ──────────────────────────────────────────────────────────

/**
 * Pre-check if a conversation already has messages for a given item+receiver.
 * Returns true if conversation already exists (skip), false if safe to enqueue.
 */
async function checkConversationExists(itemId: string, receiverId: string): Promise<boolean> {
  try {
    const initResult = await bridge.initiateConversation(Number(itemId), Number(receiverId));
    if (!initResult.ok) return false; // can't tell — let execution handle it

    const initData = (initResult as { ok: true; data: unknown }).data as Record<string, unknown>;
    const conv = (initData.conversation ?? initData) as Record<string, unknown>;
    const messagesArr = conv.messages as unknown[] | undefined;
    const msgCount = messagesArr?.length
      ?? (conv.msg_count as number)
      ?? (conv.messages_count as number)
      ?? 0;
    return msgCount > 0;
  } catch (err) {
    console.warn(`[CRM] Pre-check conversation error for item=${itemId}, receiver=${receiverId}:`, err);
    return false; // can't tell — let execution handle it
  }
}

/**
 * Adds a notification to the unified queue.
 * Queue is kept sorted by likeDate (oldest first).
 */
function enqueueAction(item: QueueItem): boolean {
  // Dedup: already processed or already in queue?
  if (hasProcessedNotification(item.notificationId)) return false;
  if (actionQueue.some((q) => q.notificationId === item.notificationId)) return false;

  // Ignored user check by username
  if (item.receiverUsername && isCrmIgnoredUser(item.receiverUsername)) {
    console.log(`[CRM] Skipping enqueue — ignored user: ${item.receiverUsername}`);
    return false;
  }

  // Insert log entry for UI visibility
  insertAutoMessageLog({
    notification_id: item.notificationId,
    item_id: item.itemId,
    receiver_id: item.receiverId,
    receiver_username: item.receiverUsername || null,
    action_type: item.config.offer_price ? 'offer+message' : 'message',
    status: 'scheduled',
    like_date: item.likeDate ? Math.round(item.likeDate / 1000) : null,
  });

  // Insert into queue sorted by likeDate ascending (oldest first)
  const insertIdx = actionQueue.findIndex((q) => q.likeDate > item.likeDate);
  if (insertIdx === -1) {
    actionQueue.push(item);
  } else {
    actionQueue.splice(insertIdx, 0, item);
  }

  emitToRenderer('crm:action-log', {
    type: 'scheduled',
    notification_id: item.notificationId,
    item_id: item.itemId,
    receiver_id: item.receiverId,
    like_date: item.likeDate,
    queue_size: actionQueue.length,
    timestamp: Date.now(),
  });

  // Kick the queue processor if not already running
  if (!isProcessingQueue) {
    void processQueue();
  }

  return true;
}

// ─── Queue Processor ────────────────────────────────────────────────────────

async function processQueue(): Promise<void> {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  console.log(`[CRM] Queue processor started. ${actionQueue.length} item(s) in queue.`);

  try {
    let needsDelay = false; // only true after a successful send

    while (actionQueue.length > 0 && isRunning) {
      const item = actionQueue.shift()!;

      // Only delay after a successful send (not after errors/skips)
      if (needsDelay) {
        const delayMin = getSetting('crm_delay_min_minutes');
        const delayMax = getSetting('crm_delay_max_minutes');
        const minMs = delayMin * 60 * 1000;
        const maxMs = delayMax * 60 * 1000;
        const waitMs = minMs + Math.random() * (maxMs - minMs);
        console.log(`[CRM] Waiting ${Math.round(waitMs / 1000)}s before next action…`);
        await sleep(waitMs);
        needsDelay = false;
      }

      // Check if still running after the wait
      if (!isRunning) {
        actionQueue.unshift(item);
        break;
      }

      const didSend = await executeAction(item);
      if (didSend) {
        needsDelay = true; // delay before next item
      }
      // If action failed/skipped, needsDelay stays false → next item fires immediately
    }
  } catch (err) {
    console.error('[CRM] Queue processor error:', err instanceof Error ? err.message : err);
  } finally {
    isProcessingQueue = false;
    console.log('[CRM] Queue processor finished.');
  }
}


// ─── Action Execution ───────────────────────────────────────────────────────

/**
 * Execute a single CRM action. Returns true if a message/offer was actually sent,
 * false if the action was skipped (existing conversation, etc.)
 */
async function executeAction(item: QueueItem): Promise<boolean> {
  const { notificationId, itemId, receiverId, config } = item;
  console.log(`[CRM] Executing action for item=${itemId}, receiver=${receiverId}`);

  updateAutoMessageLogStatus(notificationId, 'executing');
  emitToRenderer('crm:action-log', {
    type: 'executing',
    notification_id: notificationId,
    item_id: itemId,
    receiver_id: receiverId,
    like_date: item.likeDate,
    timestamp: Date.now(),
  });

  try {
    // Step 1: Initiate conversation / discover transaction
    const initResult = await bridge.initiateConversation(
      Number(itemId),
      Number(receiverId),
    );

    if (!initResult.ok) {
      const err = initResult as BridgeErrorResult;
      console.error(`[CRM] Init conversation failed for item=${itemId}, receiver=${receiverId}:`, err.code, err.message);
      throw new Error(`Init conversation failed: ${err.code} — ${err.message}`);
    }

    const initData = (initResult as { ok: true; data: unknown }).data as Record<string, unknown>;
    console.log(`[CRM] Init conversation response keys:`, Object.keys(initData));

    // Extract conversation_id and transaction_id from response
    let conversationId: number | null = null;
    let transactionId: number | null = null;

    if (initData.conversation) {
      const conv = initData.conversation as Record<string, unknown>;
      conversationId = conv.id as number ?? null;
      const txn = conv.transaction as Record<string, unknown> | undefined;
      transactionId = (txn?.id as number) ?? (conv.transaction_id as number) ?? null;
    } else if (initData.id) {
      conversationId = initData.id as number;
      const txn = initData.transaction as Record<string, unknown> | undefined;
      transactionId = (txn?.id as number) ?? (initData.transaction_id as number) ?? null;
    }

    // *** CONVERSATION CHECK ***
    // If the conversation already has messages, skip (no delay consumed)
    if (initData.conversation) {
      const conv = initData.conversation as Record<string, unknown>;
      const messagesArr = conv.messages as unknown[] | undefined;
      const msgCount = messagesArr?.length
        ?? (conv.msg_count as number)
        ?? (conv.messages_count as number)
        ?? 0;
      if (msgCount > 0) {
        console.log(`[CRM] Skipping item=${itemId}, receiver=${receiverId}: existing conversation with ${msgCount} message(s)`);
        updateAutoMessageLogStatus(notificationId, 'skipped_existing_convo', `Conversation already has ${msgCount} message(s)`);
        emitToRenderer('crm:action-log', {
          type: 'skipped',
          notification_id: notificationId,
          item_id: itemId,
          receiver_id: receiverId,
          reason: `Existing conversation (${msgCount} msgs)`,
          like_date: item.likeDate,
          timestamp: Date.now(),
        });
        return false; // skipped — do NOT consume a delay slot
      }
    }

    // If we couldn't obtain a conversation ID, fail this action
    if (!conversationId) {
      throw new Error(`Could not obtain conversation_id from initiate response (keys: ${Object.keys(initData).join(', ')})`);
    }

    // 5-10 second delay before first API action
    await sleep(5000 + Math.random() * 5000);

    // Step 2: Send offer if configured
    if (config.offer_price && config.offer_price > 0 && transactionId) {
      console.log(`[CRM] Sending offer: price=${config.offer_price}, transactionId=${transactionId}`);
      const offerResult = await bridge.sendOffer(
        transactionId,
        String(config.offer_price), // price as-is (e.g. "1750" for £1,750)
        'GBP',
      );

      if (!offerResult.ok) {
        console.warn(`[CRM] Offer failed:`, JSON.stringify(offerResult).slice(0, 500));
        // Continue to send message even if offer fails
      } else {
        console.log(`[CRM] Offer sent successfully`);
        const offerData = (offerResult as { ok: true; data: unknown }).data as Record<string, unknown>;
        const offer = offerData.offer as Record<string, unknown> | undefined;
        if (offer?.user_msg_thread_id && !conversationId) {
          conversationId = offer.user_msg_thread_id as number;
        }
      }

      // 5-10 second delay between offer and message
      await sleep(5000 + Math.random() * 5000);
    }

    // Step 3: Send message if configured and we have a conversation_id
    if (config.message_text && conversationId) {
      const msgResult = await bridge.sendMessage(
        conversationId,
        config.message_text,
      );

      if (!msgResult.ok) {
        const err = msgResult as BridgeErrorResult;
        throw new Error(`Message send failed: ${err.code} — ${err.message}`);
      }
    }

    // Success
    updateAutoMessageLogStatus(notificationId, 'sent');
    emitToRenderer('crm:action-log', {
      type: 'sent',
      notification_id: notificationId,
      item_id: itemId,
      receiver_id: receiverId,
      like_date: item.likeDate,
      timestamp: Date.now(),
    });
    console.log(`[CRM] Action complete for item=${itemId}, receiver=${receiverId}`);
    return true; // actually sent — consume a delay slot

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateAutoMessageLogStatus(notificationId, 'error', message);
    emitToRenderer('crm:action-log', {
      type: 'error',
      notification_id: notificationId,
      item_id: itemId,
      receiver_id: receiverId,
      error: message,
      like_date: item.likeDate,
      timestamp: Date.now(),
    });
    console.error(`[CRM] Action failed for item=${itemId}:`, message);
    return false; // error — skip delay for next action
  }
}

// ─── Polling ────────────────────────────────────────────────────────────────

async function pollNotifications(): Promise<void> {
  console.log('[CRM] Polling notifications…');
  const result = await bridge.fetchNotifications(1, 20);

  if (!result.ok) {
    const err = result as BridgeErrorResult;
    console.warn('[CRM] Notification poll failed:', err.code, err.message);
    emitToRenderer('crm:action-log', {
      type: 'poll_error',
      message: `${err.code}: ${err.message}`,
      timestamp: Date.now(),
    });
    return;
  }

  const data = (result as { ok: true; data: unknown }).data as Record<string, unknown>;

  // DEBUG: log the raw response shape
  console.log('[CRM] Raw notification response keys:', Object.keys(data));

  const notifications = findNotificationArray(data);
  console.log(`[CRM] Parsed ${notifications.length} notification entries`);

  let processedCount = 0;
  let debuggedFirst = false;

  for (const notif of notifications) {
    const entryType = extractEntryType(notif);
    if (entryType !== 20) continue; // only "like" notifications

    // Debug: log full structure of the first like notification
    if (!debuggedFirst) {
      console.log('[CRM] DEBUG first like notification keys:', Object.keys(notif));
      console.log('[CRM] DEBUG notif.user:', JSON.stringify(notif.user));
      console.log('[CRM] DEBUG notif.initiator:', JSON.stringify(notif.initiator));
      console.log('[CRM] DEBUG notif.from_user:', JSON.stringify(notif.from_user));
      console.log('[CRM] DEBUG notif.actor:', JSON.stringify(notif.actor));
      console.log('[CRM] DEBUG notif.created_at:', notif.created_at, 'notif.updated_at:', notif.updated_at, 'notif.timestamp:', notif.timestamp, 'notif.date:', notif.date);
      console.log('[CRM] DEBUG notif.data:', JSON.stringify(notif.data)?.slice(0, 500));
      debuggedFirst = true;
    }

    const notifId = String(notif.id ?? `${Date.now()}_${Math.random()}`);
    const link = extractNotificationLink(notif);
    if (!link) continue;

    const parsed = parseNotificationLink(link);
    if (!parsed) continue;

    const { itemId, receiverId } = parsed;

    // Dedup check
    if (hasProcessedNotification(notifId)) continue;

    // Extract username from notification
    const likerUsername = extractLikerUsername(notif);

    // Ignored user check
    if (likerUsername && isCrmIgnoredUser(likerUsername)) {
      console.log(`[CRM] Skipping notification from ignored user: ${likerUsername}`);
      continue;
    }

    // Has active config for this item?
    const config = getAutoMessageConfig(itemId);
    if (!config || !config.is_active) continue;

    const likeDate = extractLikeTimestamp(notif);


    if (enqueueAction({
      notificationId: notifId,
      itemId,
      receiverId,
      receiverUsername: likerUsername,
      config,
      likeDate,
    })) {
      processedCount++;
    }
  }

  if (processedCount > 0) {
    console.log(`[CRM] Enqueued ${processedCount} new action(s). Queue size: ${actionQueue.length}`);
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;

export function startCrm(pollIntervalMs = DEFAULT_POLL_INTERVAL_MS): void {
  if (isRunning) return;
  isRunning = true;
  isFirstAction = true;

  console.log('[CRM] Starting auto-message service…');
  emitToRenderer('crm:action-log', {
    type: 'service_started',
    timestamp: Date.now(),
  });

  // Initial poll
  void pollNotifications();

  // Recurring poll with jitter
  pollingInterval = setInterval(() => {
    const jitteredMs = jitteredDelay(pollIntervalMs);
    setTimeout(() => void pollNotifications(), jitteredMs - pollIntervalMs);
  }, pollIntervalMs);
}

export function stopCrm(): void {
  if (!isRunning) return;
  isRunning = false;

  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }

  // Mark remaining queue items as cancelled
  for (const item of actionQueue) {
    updateAutoMessageLogStatus(item.notificationId, 'cancelled');
  }
  actionQueue.length = 0;

  console.log('[CRM] Auto-message service stopped.');
  emitToRenderer('crm:action-log', {
    type: 'service_stopped',
    timestamp: Date.now(),
  });
}

export function isCrmRunning(): boolean {
  return isRunning;
}

/** Get count of currently queued actions. */
export function getPendingCount(): number {
  return actionQueue.length;
}

/**
 * Backfill: scan historical notifications for past likes on a specific item.
 */
export async function backfillItem(
  itemId: string,
  backfillHours: number,
  config: AutoMessageConfig,
): Promise<number> {
  const cutoffMs = Date.now() - backfillHours * 60 * 60 * 1000;
  let page = 1;
  const maxPages = 20;
  let scheduledCount = 0;

  console.log(`[CRM] Backfill: scanning past ${backfillHours}h of likes for item ${itemId}…`);
  emitToRenderer('crm:action-log', {
    type: 'backfill_started',
    item_id: itemId,
    hours: backfillHours,
    timestamp: Date.now(),
  });

  while (page <= maxPages) {
    const result = await bridge.fetchNotifications(page, 20);

    if (!result.ok) {
      const err = result as BridgeErrorResult;
      console.warn(`[CRM] Backfill page ${page} failed:`, err.code, err.message);
      break;
    }

    const data = (result as { ok: true; data: unknown }).data as Record<string, unknown>;
    const notifications = findNotificationArray(data);

    if (notifications.length === 0) break;

    let reachedCutoff = false;

    for (const notif of notifications) {
      const likeDate = extractLikeTimestamp(notif);

      if (likeDate > 0 && likeDate < cutoffMs) {
        reachedCutoff = true;
        break;
      }

      const entryType = extractEntryType(notif);
      if (entryType !== 20) continue;

      const link = extractNotificationLink(notif);
      if (!link) continue;

      const parsed = parseNotificationLink(link);
      if (!parsed) continue;

      if (parsed.itemId !== itemId) continue;

      const notifId = String(notif.id ?? `backfill_${Date.now()}_${Math.random()}`);

      const likerUsername = extractLikerUsername(notif);
      if (likerUsername && isCrmIgnoredUser(likerUsername)) continue;


      if (enqueueAction({
        notificationId: notifId,
        itemId: parsed.itemId,
        receiverId: parsed.receiverId,
        receiverUsername: likerUsername,
        config,
        likeDate,
      })) {
        scheduledCount++;
      }
    }

    if (reachedCutoff) break;

    page++;
    await sleep(2000 + Math.random() * 2000);
  }

  console.log(`[CRM] Backfill complete for item ${itemId}: ${scheduledCount} action(s) enqueued.`);
  emitToRenderer('crm:action-log', {
    type: 'backfill_complete',
    item_id: itemId,
    count: scheduledCount,
    timestamp: Date.now(),
  });

  return scheduledCount;
}
