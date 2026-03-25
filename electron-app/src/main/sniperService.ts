/**
 * Sniper Service — matching engine, countdown, autobuy.
 * Integrates with feed: when new items arrive, match against snipers, trigger countdown/buy.
 */

import { BrowserWindow } from 'electron';
import * as snipers from './snipers';
import * as settings from './settings';
import * as checkoutService from './checkoutService';
import * as proxyService from './proxyService';
import * as sniperHits from './sniperHits';
import { logger } from './logger';
import type { FeedItem } from './feedService';

const COUNTDOWN_SECONDS = 3;
const CHANNEL_COUNTDOWN = 'sniper:countdown';
const CHANNEL_COUNTDOWN_DONE = 'sniper:countdown-done';
const CHANNEL_HIT = 'sniper:hit';

let processedItemIds = new Set<number>();
const pendingCountdowns = new Map<string, ReturnType<typeof setTimeout>>();

function matchesSniper(item: FeedItem, sniper: import('./snipers').Sniper): boolean {
  const price = parseFloat(item.price) || 0;
  if (sniper.price_max != null && price > sniper.price_max) return false;
  if (sniper.keywords) {
    const kw = sniper.keywords.toLowerCase().split(/\s+/).filter(Boolean);
    const title = (item.title ?? '').toLowerCase();
    if (kw.length > 0 && !kw.every((k) => title.includes(k))) return false;
  }
  if (sniper.condition && item.condition) {
    const cond = sniper.condition.toLowerCase();
    const itemCond = item.condition.toLowerCase();
    if (!itemCond.includes(cond)) return false;
  }
  return true;
}

function getSniperSpentSafe(sniperId: number): number {
  try {
    return snipers.getSniperSpent(sniperId);
  } catch {
    return 0;
  }
}

export function processItems(items: FeedItem[]): void {
  const enabled = snipers.getEnabledSnipers();
  if (enabled.length === 0) return;

  const autobuyEnabled = settings.getSetting('autobuyEnabled');
  const simulationMode = settings.getSetting('simulationMode');

  // Do not process anything if both are off
  if (!autobuyEnabled && !simulationMode) return;

  // Filter out items we've already initiated a countdown/purchase for
  const unprocessedItems = items.filter((i) => !processedItemIds.has(i.id));

  for (const item of unprocessedItems) {
    for (const sniper of enabled) {
      if (!matchesSniper(item, sniper)) continue;

      // We found a match for this item. Mark it as processed so we don't buy/simulate it again in future polls.
      processedItemIds.add(item.id);

      const spent = getSniperSpentSafe(sniper.id);
      const limit = sniper.budget_limit || Infinity;
      const price = parseFloat(item.price) || 0;
      if (spent + price > limit) {
        logger.info('sniper:budget-exceeded', { sniperId: sniper.id, itemId: item.id });
        break; // break to stop trying other snipers for this item
      }

      const countdownId = `sniper-${sniper.id}-${item.id}-${Date.now()}`;

      for (const win of BrowserWindow.getAllWindows()) {
        if (win.webContents && !win.isDestroyed()) {
          win.webContents.send(CHANNEL_COUNTDOWN, {
            countdownId,
            item,
            sniper: { id: sniper.id, name: sniper.name },
            secondsLeft: COUNTDOWN_SECONDS,
          });
        }
      }

      const timerId = setTimeout(() => {
        pendingCountdowns.delete(countdownId);

        if (simulationMode) {
          logger.info('sniper:would-have-bought', {
            sniperId: sniper.id,
            sniperName: sniper.name,
            itemId: item.id,
            title: item.title,
            price: item.price,
          });
          const hit = sniperHits.insertHit({
            sniper_id: sniper.id,
            sniper_name: sniper.name,
            item_id: item.id,
            title: item.title,
            price: item.price,
            photo_url: item.photo_url ?? null,
            url: item.url ?? null,
            simulated: true,
          });
          for (const win of BrowserWindow.getAllWindows()) {
            if (win.webContents && !win.isDestroyed()) {
              win.webContents.send(CHANNEL_COUNTDOWN_DONE, {
                countdownId,
                simulated: true,
                message: `[Simulation] Would have bought: ${item.title} (£${item.price})`,
              });
              if (hit) win.webContents.send(CHANNEL_HIT, hit);
            }
          }
          return;
        }

        const proxy = proxyService.getProxyForCheckout(item);
        checkoutService.runCheckout(item, proxy, sniper.id).then((result) => {
          if (result.ok) {
            const hit = sniperHits.insertHit({
              sniper_id: sniper.id,
              sniper_name: sniper.name,
              item_id: item.id,
              title: item.title,
              price: item.price,
              photo_url: item.photo_url ?? null,
              url: item.url ?? null,
              simulated: false,
            });
            for (const win of BrowserWindow.getAllWindows()) {
              if (win.webContents && !win.isDestroyed()) {
                if (hit) win.webContents.send(CHANNEL_HIT, hit);
              }
            }
          }
          for (const win of BrowserWindow.getAllWindows()) {
            if (win.webContents && !win.isDestroyed()) {
              win.webContents.send(CHANNEL_COUNTDOWN_DONE, {
                countdownId,
                simulated: false,
                ok: result.ok,
                message: result.message,
              });
            }
          }
        });
      }, COUNTDOWN_SECONDS * 1000);

      pendingCountdowns.set(countdownId, timerId);
      break; // Only trigger one sniper per item
    }
  }

  if (processedItemIds.size > 5000) {
    processedItemIds = new Set([...processedItemIds].slice(-2000));
  }
}

export function cancelCountdown(countdownId: string): boolean {
  const timerId = pendingCountdowns.get(countdownId);
  if (timerId) {
    clearTimeout(timerId);
    pendingCountdowns.delete(countdownId);
    
    // Attempt to reset processed state for this item so it can be picked up again
    // We extract the item ID from the countdownId (sniper-{sniperId}-{itemId}-{timestamp})
    const parts = countdownId.split('-');
    if (parts.length >= 3) {
      const itemId = parseInt(parts[2], 10);
      if (!isNaN(itemId)) {
        processedItemIds.delete(itemId);
      }
    }
    
    return true;
  }
  return false;
}
