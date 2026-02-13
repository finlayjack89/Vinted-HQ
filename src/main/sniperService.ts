/**
 * Sniper Service — matching engine, countdown, autobuy.
 * Integrates with feed: when new items arrive, match against snipers, trigger countdown/buy.
 */

import { BrowserWindow } from 'electron';
import * as snipers from './snipers';
import * as settings from './settings';
import * as checkoutService from './checkoutService';
import * as proxyService from './proxyService';
import { logger } from './logger';
import type { FeedItem } from './feedService';

const COUNTDOWN_SECONDS = 3;
const CHANNEL_COUNTDOWN = 'sniper:countdown';
const CHANNEL_COUNTDOWN_DONE = 'sniper:countdown-done';

let seenItemIds = new Set<number>();
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

  const newItems = items.filter((i) => !seenItemIds.has(i.id));
  for (const item of newItems) {
    seenItemIds.add(item.id);
  }

  for (const item of newItems) {
    for (const sniper of enabled) {
      if (!matchesSniper(item, sniper)) continue;

      const spent = getSniperSpentSafe(sniper.id);
      const limit = sniper.budget_limit || Infinity;
      const price = parseFloat(item.price) || 0;
      if (spent + price > limit) {
        logger.info('sniper:budget-exceeded', { sniperId: sniper.id, itemId: item.id });
        continue;
      }

      if (!autobuyEnabled) {
        logger.info('sniper:match-autobuy-off', { sniperId: sniper.id, itemId: item.id });
        continue;
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
          for (const win of BrowserWindow.getAllWindows()) {
            if (win.webContents && !win.isDestroyed()) {
              win.webContents.send(CHANNEL_COUNTDOWN_DONE, {
                countdownId,
                simulated: true,
                message: `[Simulation] Would have bought: ${item.title} (£${item.price})`,
              });
            }
          }
          return;
        }

        const proxy = proxyService.getProxyForCheckout(item);
        checkoutService.runCheckout(item, proxy, sniper.id).then((result) => {
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
    }
  }

  if (seenItemIds.size > 5000) {
    seenItemIds = new Set([...seenItemIds].slice(-2000));
  }
}

export function cancelCountdown(countdownId: string): boolean {
  const timerId = pendingCountdowns.get(countdownId);
  if (timerId) {
    clearTimeout(timerId);
    pendingCountdowns.delete(countdownId);
    return true;
  }
  return false;
}
