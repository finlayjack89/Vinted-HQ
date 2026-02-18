/**
 * Item Detail Browser — fetches full item data by loading the Vinted page
 * in a hidden Electron BrowserWindow and extracting data via JS injection.
 *
 * Vinted is a JavaScript SPA — the HTML only has 6 SEO fields. All real
 * data (numeric IDs for category, brand, size, etc.) is loaded by
 * client-side JavaScript.  This module loads the page in a real Chromium
 * browser (Electron's BrowserWindow), waits for hydration, then extracts
 * the data — similar to how dotb.io's Chrome extension works.
 *
 * Anti-detection measures:
 *   - Real Chromium browser (genuine TLS, Canvas, WebGL)
 *   - Real Chrome user agent
 *   - navigator.webdriver spoofed to false
 *   - window.chrome stub injected
 *   - Routed through ISP proxy for clean IP reputation
 */

import { BrowserWindow, session } from 'electron';
import * as secureStorage from './secureStorage';
import * as proxyService from './proxyService';
import { setupNetworkInterception } from './authCapture';
import * as settings from './settings';
import { logger } from './logger';

const VINTED_BASE = 'https://www.vinted.co.uk';
const OVERALL_TIMEOUT_MS = 45_000;
const HYDRATION_WAIT_MS = 10_000;
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

export async function fetchItemDetailViaBrowser(
  itemId: number
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; code: string; message: string }> {
  const cookie = secureStorage.retrieveCookie();
  if (!cookie) {
    return { ok: false, code: 'MISSING_COOKIE', message: 'No session cookie.' };
  }

  const ses = session.fromPartition('persist:vinted-scraper');
  setupNetworkInterception(ses);

  // ── Chrome user agent ──
  ses.setUserAgent(CHROME_UA);

  // ── Proxy: use an ISP proxy for clean IP reputation ──
  // Electron's setProxy does NOT support user:pass in the URL.
  // We must strip credentials from the proxy rules and provide them
  // via the session 'login' event instead.
  const proxyRaw = proxyService.getAnyScrapingProxy();
  let proxyUser = '';
  let proxyPass = '';
  if (proxyRaw) {
    try {
      const pu = new URL(proxyRaw);
      proxyUser = decodeURIComponent(pu.username);
      proxyPass = decodeURIComponent(pu.password);
      const proxyHost = `${pu.protocol}//${pu.hostname}:${pu.port}`;
      await ses.setProxy({ proxyRules: proxyHost });
      logger.info('item-detail-browser-proxy', { proxy: proxyHost, hasAuth: !!(proxyUser && proxyPass) });
    } catch {
      await ses.setProxy({ proxyRules: '' });
      logger.warn('item-detail-browser-proxy-parse-failed', { proxyRaw: proxyRaw.replace(/:[^:@]+@/, ':***@') });
    }
  } else {
    await ses.setProxy({ proxyRules: '' });
    logger.info('item-detail-browser-proxy', { proxy: 'DIRECT' });
  }

  // ── Set cookies (skip individual HttpOnly failures) ──
  let cookiesSet = 0;
  let cookiesSkipped = 0;
  for (const pair of cookie.split('; ')) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx < 0) continue;
    const name = pair.slice(0, eqIdx).trim();
    const value = pair.slice(eqIdx + 1).trim();
    if (!name) continue;
    try {
      await ses.cookies.set({
        url: VINTED_BASE,
        name,
        value,
        domain: '.vinted.co.uk',
        path: '/',
        secure: true,
        sameSite: 'no_restriction' as const,
      });
      cookiesSet++;
    } catch {
      cookiesSkipped++;
    }
  }
  logger.info('item-detail-browser-cookies', { cookiesSet, cookiesSkipped });

  try {
    return await withTimeout(
      _doFetch(ses, itemId, proxyUser, proxyPass),
      OVERALL_TIMEOUT_MS,
      'Browser item detail fetch',
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('item-detail-browser-error', { itemId, error: msg });
    return { ok: false, code: 'BROWSER_ERROR', message: msg };
  }
}


async function _doFetch(
  ses: Electron.Session,
  itemId: number,
  proxyUser: string,
  proxyPass: string,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; code: string; message: string }> {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      session: ses,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  try {
    // ── Proxy authentication via Electron's login event ──
    if (proxyUser && proxyPass) {
      win.webContents.on('login', (event, _details, _authInfo, callback) => {
        event.preventDefault();
        callback(proxyUser, proxyPass);
      });
    }

    const pageUrl = `${VINTED_BASE}/items/${itemId}`;
    logger.info('item-detail-browser-loading', { itemId, url: pageUrl });

    // ── Navigate: wait for did-navigate (fires after server response, before resource load) ──
    const navPromise = new Promise<{ url: string; httpCode: number }>((resolve) => {
      win.webContents.once('did-navigate', (_e, url, httpCode) => {
        resolve({ url, httpCode });
      });
    });

    // Log all navigations for diagnostics
    win.webContents.on('did-navigate', (_e, url, code) => {
      logger.info('item-detail-browser-nav', { itemId, url: url.slice(0, 120), code });
    });
    win.webContents.on('did-fail-load', (_e, errorCode, errorDesc, validatedURL) => {
      logger.warn('item-detail-browser-fail-load', { itemId, errorCode, errorDesc, url: validatedURL?.slice(0, 120) });
    });

    // Start navigation (don't await loadURL — it waits for ALL resources)
    win.loadURL(pageUrl).catch((err) => {
      logger.warn('item-detail-browser-loadURL-error', { itemId, error: String(err) });
    });

    // Wait for the server to respond and navigation to complete
    const nav = await withTimeout(navPromise, 15_000, 'Navigation');
    logger.info('item-detail-browser-navigated', { itemId, url: nav.url.slice(0, 120), httpCode: nav.httpCode });

    // Verify we're on a Vinted page (not an error/challenge/blank page)
    if (!nav.url.includes('vinted.co.uk')) {
      return { ok: false, code: 'NAVIGATION_FAILED', message: `Navigated to unexpected URL: ${nav.url.slice(0, 200)}` };
    }

    // Inject stealth patches immediately after navigation
    await win.webContents.executeJavaScript(STEALTH_PATCHES, true).catch(() => {});

    // ── Wait for SPA hydration (JS bundle exec + API calls) ──
    await sleep(HYDRATION_WAIT_MS);

    // ── Extract data ──
    const result = await withTimeout(
      win.webContents.executeJavaScript(buildExtractionScript(itemId), true),
      10_000,
      'JS extraction',
    );

    if (result?.csrfToken) {
      logger.info('item-detail-browser-csrf', { csrfToken: result.csrfToken });
      settings.setSetting('csrf_token', result.csrfToken);
      settings.setSetting('user_agent', CHROME_UA);
    } else {
      logger.warn('item-detail-browser-csrf-missing', { itemId });
    }

    // Capture cookies from session and update secureStorage if changed
    try {
      const cookies = await ses.cookies.get({ domain: 'vinted.co.uk' });
      const cookieHeader = cookies
        .map((c) => `${c.name}=${c.value}`)
        .join('; ');
      
      const stored = secureStorage.retrieveCookie();
      if (cookieHeader && cookieHeader !== stored) {
        secureStorage.storeCookie(cookieHeader);
        logger.info('item-detail-browser-cookies-updated', { count: cookies.length });
      }
    } catch (err) {
      logger.warn('item-detail-browser-cookie-sync-failed', { error: String(err) });
    }

    logger.info('item-detail-browser-result', {
      itemId,
      source: result?.source,
      keyCount: result?.data ? Object.keys(result.data).length : 0,
    });

    const debugInfo = {
      source: result?.source,
      globals: result?.globals,
      hasNuxt: result?.hasNuxt,
      hasPinia: result?.hasPinia,
      hasVueApp: result?.hasVueApp,
      nuxtKeys: result?.nuxtKeys,
      docTitle: result?.docTitle,
      bodyLen: result?.bodyLen,
    };

    if (result?.data && typeof result.data === 'object') {
      return {
        ok: true,
        data: { item: result.data, _debug: debugInfo } as Record<string, unknown>,
      };
    }

    return {
      ok: false,
      code: 'EXTRACTION_FAILED',
      message: `Item ${itemId}: ${JSON.stringify(debugInfo)}`,
    };
  } finally {
    try {
      win.webContents.stop();
      win.close();
    } catch { /* already closed */ }
  }
}


// ── Generic Authenticated Browser Fetch ──
// Use the authenticated browser context to make arbitrary API calls.
// Strategy: navigate to a Vinted page, wait for Vinted's own JS to make
// API calls (which carry valid CSRF tokens), capture those tokens via
// network interception, then make our own call with the same token.
export async function fetchViaBrowser(
  urlPath: string,
  options: { method: string; body?: string; referer?: string }
): Promise<{ ok: boolean; status?: number; data?: unknown; error?: string; text?: string }> {
  const ses = session.fromPartition('persist:vinted-scraper');
  // Ensure global passive capture is installed (CSRF, anon_id, UA).
  setupNetworkInterception(ses);
  ses.setUserAgent(CHROME_UA);

  const win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 800,
    webPreferences: {
      session: ses,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  try {
    // 1. Navigate to the edit page so Vinted's own JS loads and makes authenticated API calls
    const targetUrl = options.referer || VINTED_BASE;
    logger.info('browser-fetch-navigating', { url: targetUrl });
    await win.loadURL(targetUrl);
    
    // 2. Inject stealth patches
    await win.webContents.executeJavaScript(STEALTH_PATCHES, true).catch(() => {});

    // 3. Wait briefly for passive interception to capture CSRF + anon_id.
    //    Important: for this endpoint Vinted expects *both* x-csrf-token and x-anon-id.
    //    We prefer captured header values over naive cookie parsing (document.cookie can
    //    contain multiple anon_id values with different paths).
    let capturedCsrf = settings.getSetting('csrf_token') as string | null;
    let capturedAnon = settings.getSetting('anon_id') as string | null;

    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && (!capturedCsrf || !capturedAnon)) {
      capturedCsrf = settings.getSetting('csrf_token') as string | null;
      capturedAnon = settings.getSetting('anon_id') as string | null;

      // Fallback: if anon_id hasn't been seen in headers yet, read from cookies.
      if (!capturedAnon) {
        try {
          const cookies = await ses.cookies.get({ name: 'anon_id' });
          if (cookies.length > 0) {
            // Prefer the cookie that will be sent to most requests.
            const best =
              cookies.find((c) => c.domain.includes('vinted.co.uk') && (c.path === '/' || !c.path)) ??
              cookies[0];
            if (best?.value) {
              capturedAnon = best.value;
              settings.setSetting('anon_id', capturedAnon);
            }
          }
        } catch { /* ignore */ }
      }

      if (capturedCsrf && capturedAnon) break;
      await sleep(250);
    }

    logger.info('browser-fetch-token-status', {
      hasCsrf: !!capturedCsrf,
      csrfPrefix: capturedCsrf ? capturedCsrf.slice(0, 10) : 'NONE',
      hasAnon: !!capturedAnon,
      anonPrefix: capturedAnon ? capturedAnon.slice(0, 8) : 'NONE',
    });

    // 4. Build the fetch script with the CAPTURED token injected directly
    const csrfValue = capturedCsrf ? capturedCsrf.replace(/'/g, "\\'") : '';
    const anonValue = capturedAnon ? capturedAnon.replace(/'/g, "\\'") : '';
    const refValue = options.referer ? options.referer.replace(/'/g, "\\'") : '';
    const script = `
      (async function() {
        const headers = {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/plain, */*',
          'accept-features': 'ALL',
          'locale': 'en-GB',
        };
        ${csrfValue ? `headers['x-csrf-token'] = '${csrfValue}';` : ''}
        ${anonValue ? `headers['x-anon-id'] = '${anonValue}';` : ''}

        try {
          const res = await fetch('${urlPath}', {
            method: '${options.method}',
            headers: headers,
            credentials: 'include',
            ${refValue ? `referrer: '${refValue}', referrerPolicy: 'strict-origin-when-cross-origin',` : ''}
            body: ${options.body ? `'${options.body.replace(/'/g, "\\'")}'` : 'null'}
          });
          
          const text = await res.text();
          let json;
          try { json = JSON.parse(text); } catch(e) { json = null; }
          
          return {
            ok: res.ok,
            status: res.status,
            data: json,
            text: text.slice(0, 1000)
          };
        } catch (err) {
          return { ok: false, error: err.toString() };
        }
      })()
    `;

    // 5. Execute
    const result = await withTimeout(
        win.webContents.executeJavaScript(script, true),
        15000,
        'Browser fetch'
    );
    
    return result;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('browser-fetch-error', { url: urlPath, error: msg });
    return { ok: false, error: msg };
  } finally {
    // Clean up: close the window
    try { win.close(); } catch {}
  }
}

// ── Stealth patches injected into the page before Vinted's JS runs ──
// These make Electron's BrowserWindow indistinguishable from regular Chrome.
const STEALTH_PATCHES = `
  // Hide webdriver flag
  Object.defineProperty(navigator, 'webdriver', { get: () => false });

  // Stub window.chrome (missing in Electron, present in real Chrome)
  if (!window.chrome) {
    window.chrome = {
      runtime: { id: undefined, connect: function(){}, sendMessage: function(){} },
      loadTimes: function() { return {}; },
      csi: function() { return {}; },
    };
  }

  // Fix permissions API (Electron reports "denied" for notifications)
  if (navigator.permissions) {
    var origQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = function(desc) {
      if (desc.name === 'notifications') {
        return Promise.resolve({ state: 'prompt', onchange: null });
      }
      return origQuery(desc);
    };
  }

  // Fix plugins length (real Chrome always has at least 1-2 plugins)
  Object.defineProperty(navigator, 'plugins', {
    get: function() {
      return [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
      ];
    }
  });

  // Fix languages (Electron sometimes returns empty)
  Object.defineProperty(navigator, 'languages', {
    get: function() { return ['en-GB', 'en']; }
  });
`;


function buildExtractionScript(itemId: number): string {
  return `
    (function() {
      var TARGET_ID = ${itemId};
      var _visited = new WeakSet();
      var _searched = 0;
      var MAX_SEARCH = 80000;
      var _csrfToken = null;

      try {
        var meta = document.querySelector('meta[name="csrf-token"]');
        if (meta) _csrfToken = meta.content;
        
        if (!_csrfToken) {
           var nextData = document.getElementById('__NEXT_DATA__');
           if (nextData) {
             var json = JSON.parse(nextData.textContent);
             if (json.runtimeConfig && json.runtimeConfig.csrfToken) _csrfToken = json.runtimeConfig.csrfToken;
             if (json.props && json.props.pageProps && json.props.pageProps.csrfToken) _csrfToken = json.props.pageProps.csrfToken;
           }
        }
      } catch(e) {}

      // Item-detail field names that indicate an object is item detail data.
      // These fields only appear on item detail objects, not on random UI components.
      var DETAIL_FIELDS = ['description', 'status_id', 'color1_id', 'color2_id',
        'package_size_id', 'item_attributes', 'is_unisex', 'size_id',
        'measurement_length', 'measurement_width', 'isbn', 'video_game_rating_id'];

      // Check if an object looks like item detail data (has 2+ detail fields)
      function isItemDetail(obj) {
        var count = 0;
        for (var i = 0; i < DETAIL_FIELDS.length; i++) {
          if (obj[DETAIL_FIELDS[i]] !== undefined) count++;
          if (count >= 2) return true;
        }
        // Also match if it has description (long string) + at least catalog_id or status
        if (typeof obj.description === 'string' && obj.description.length > 30 &&
            (obj.catalog_id !== undefined || obj.status_id !== undefined || obj.status !== undefined)) {
          return true;
        }
        return false;
      }

      // Collect ALL objects matching:
      //   - id === TARGET_ID (with title/description/catalog_id), OR
      //   - looks like item detail data (has 2+ detail-specific fields)
      // Item data is split across multiple React components — we merge them all.
      function collectAllMatches(obj, depth, results) {
        if (depth === undefined) depth = 0;
        if (results === undefined) results = [];
        if (_searched > MAX_SEARCH) return results;
        if (depth > 15 || !obj || typeof obj !== 'object') return results;
        try {
          if (_visited.has(obj)) return results;
          _visited.add(obj);
        } catch(e) { return results; }
        _searched++;
        try {
          // Match 1: object has our target item ID
          if (obj.id === TARGET_ID && (obj.title || obj.description || obj.catalog_id)) {
            results.push(obj);
          }
          // Match 2: object has item-detail fields (description, status_id, colors, etc.)
          else if (isItemDetail(obj)) {
            results.push(obj);
          }
          var vals = Array.isArray(obj) ? obj : Object.values(obj);
          for (var i = 0; i < vals.length; i++) {
            if (_searched > MAX_SEARCH) break;
            if (vals[i] && typeof vals[i] === 'object') {
              collectAllMatches(vals[i], depth + 1, results);
            }
          }
        } catch (e) {}
        return results;
      }

      function resetSearch() { _searched = 0; _visited = new WeakSet(); }

      function safeClone(obj, depth) {
        if (depth === undefined) depth = 0;
        if (depth > 6) return null;
        if (obj === null || obj === undefined) return obj;
        if (typeof obj !== 'object') return obj;
        try { return JSON.parse(JSON.stringify(obj)); }
        catch (e) {
          if (Array.isArray(obj)) {
            var arr = [];
            for (var ai = 0; ai < Math.min(obj.length, 200); ai++) {
              arr.push(safeClone(obj[ai], depth + 1));
            }
            return arr;
          }
          var r = {};
          var ks = Object.keys(obj);
          for (var ki = 0; ki < ks.length; ki++) {
            var k = ks[ki];
            if (typeof obj[k] === 'function') continue;
            r[k] = safeClone(obj[k], depth + 1);
          }
          return r;
        }
      }

      // Merge multiple matching objects: later objects fill in missing fields
      function mergeMatches(matches) {
        var merged = {};
        for (var mi = 0; mi < matches.length; mi++) {
          var m;
          try { m = safeClone(matches[mi]); } catch(e) { continue; }
          var keys = Object.keys(m);
          for (var ki = 0; ki < keys.length; ki++) {
            var k = keys[ki];
            // Keep existing value if it's already set (first match wins for each key)
            // UNLESS the new value is more complete (non-null replaces null)
            if (merged[k] === undefined || merged[k] === null) {
              merged[k] = m[k];
            }
          }
        }
        return merged;
      }

      function makeResult(source, data, matchCount) {
        return {
          source: source,
          data: data,
          csrfToken: _csrfToken,
          matchCount: matchCount || 1,
          globals: [],
          docTitle: document.title,
          bodyLen: document.body ? document.body.innerHTML.length : 0,
        };
      }

      // ══════════════════════════════════════════════════════════════════
      // Vinted uses NEXT.JS + REACT
      // Primary strategy: React fiber tree (most complete data)
      // ══════════════════════════════════════════════════════════════════

      // ── Strategy 1: React fiber tree — collect ALL matching objects ──
      var fiberData = null;
      var allMatches = null;
      var rootEl = document.getElementById('__next') || document.getElementById('app') || document.body;
      var fiberKey = null;
      if (rootEl) {
        var rootKeys = Object.keys(rootEl);
        for (var rk = 0; rk < rootKeys.length; rk++) {
          if (rootKeys[rk].indexOf('__reactFiber$') === 0 || rootKeys[rk].indexOf('__reactInternalInstance$') === 0) {
            fiberKey = rootKeys[rk];
            break;
          }
        }
      }
      if (fiberKey && rootEl[fiberKey]) {
        var fiber = rootEl[fiberKey];
        while (fiber.return) fiber = fiber.return;

        allMatches = [];
        var fiberQueue = [fiber];
        var fiberSearched = 0;

        while (fiberQueue.length > 0 && fiberSearched < 8000) {
          var f = fiberQueue.shift();
          fiberSearched++;
          if (!f) continue;

          // Search memoizedProps for item data
          if (f.memoizedProps && typeof f.memoizedProps === 'object') {
            resetSearch();
            var propsMatches = collectAllMatches(f.memoizedProps, 0, []);
            for (var pm = 0; pm < propsMatches.length; pm++) allMatches.push(propsMatches[pm]);
          }

          // Search memoizedState for item data
          if (f.memoizedState && typeof f.memoizedState === 'object') {
            resetSearch();
            var stateMatches = collectAllMatches(f.memoizedState, 0, []);
            for (var sm = 0; sm < stateMatches.length; sm++) allMatches.push(stateMatches[sm]);
          }

          if (f.child) fiberQueue.push(f.child);
          if (f.sibling) fiberQueue.push(f.sibling);
        }

        if (allMatches.length > 0) {
          allMatches.sort(function(a, b) { return Object.keys(b).length - Object.keys(a).length; });
          fiberData = mergeMatches(allMatches);
        }
      }

      // ════════════════════════════════════════════════════════════════
      // Strategy 2: DOM + JSON-LD scraping for detail fields
      // The React fiber gives us catalog_id, brand_dto, price, photos,
      // but description/condition/colors/size are rendered as DOM text.
      // ════════════════════════════════════════════════════════════════
      var domData = {};

      // 2a: Schema.org JSON-LD (has description, brand, price, condition)
      var ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (var ldi = 0; ldi < ldScripts.length; ldi++) {
        try {
          var ld = JSON.parse(ldScripts[ldi].textContent || '');
          if (ld && ld['@type'] === 'Product') {
            if (ld.description) domData.description = ld.description;
            if (ld.brand && ld.brand.name) domData.brand_title = ld.brand.name;
            if (ld.offers && ld.offers.price) domData.price = Number(ld.offers.price);
            if (ld.itemCondition) {
              var schemaCondMap = {
                'https://schema.org/NewCondition': 6,
                'NewCondition': 6,
                'https://schema.org/UsedCondition': 3,
                'UsedCondition': 3,
              };
              if (schemaCondMap[ld.itemCondition]) domData.status_id = schemaCondMap[ld.itemCondition];
            }
          }
        } catch(e) {}
      }

      // 2b: Scrape item details from DOM label-value pairs.
      // Vinted renders detail rows as elements with a label and an adjacent value.
      // We find elements whose textContent matches known labels, then get the
      // value from the parent or next sibling. This avoids document.body.innerText
      // which is extremely slow on large pages (forces synchronous layout reflow).
      try {
        var labelMap = {
          'Brand': '_dom_brand',
          'Condition': '_dom_condition',
          'Colour': '_dom_colours', 'Colours': '_dom_colours',
          'Color': '_dom_colours', 'Colors': '_dom_colours',
          'Material': '_dom_materials', 'Materials': '_dom_materials',
          'Material (recommended)': '_dom_materials',
          'Size': '_dom_size',
        };
        var labelKeys = Object.keys(labelMap);

        // Scan all elements for ones whose own text (not children) matches a label
        var allElements = document.querySelectorAll('h1,h2,h3,h4,h5,h6,span,div,dt,th,td,p,label');
        for (var ei = 0; ei < allElements.length; ei++) {
          var el = allElements[ei];
          var elText = '';
          // Get direct text content (excluding children)
          for (var ni = 0; ni < el.childNodes.length; ni++) {
            if (el.childNodes[ni].nodeType === 3) { // TEXT_NODE
              elText += el.childNodes[ni].textContent;
            }
          }
          elText = elText.trim();
          if (!elText) continue;

          for (var lk = 0; lk < labelKeys.length; lk++) {
            if (elText === labelKeys[lk]) {
              var domKey = labelMap[labelKeys[lk]];
              if (domData[domKey]) continue; // already found

              // Get value: try parent's full text minus the label, or next sibling
              var valText = '';
              // Strategy A: parent's text minus this label
              if (el.parentElement) {
                var parentText = el.parentElement.textContent || '';
                valText = parentText.replace(elText, '').trim();
              }
              // Strategy B: next element sibling
              if (!valText && el.nextElementSibling) {
                valText = (el.nextElementSibling.textContent || '').trim();
              }
              // Strategy C: parent's next sibling
              if (!valText && el.parentElement && el.parentElement.nextElementSibling) {
                valText = (el.parentElement.nextElementSibling.textContent || '').trim();
              }

              if (valText && valText.length > 0 && valText.length < 200) {
                // Clean up: remove any trailing help text
                var helpIdx = valText.indexOf('Certain brands');
                if (helpIdx > 0) valText = valText.slice(0, helpIdx).trim();
                domData[domKey] = valText;
              }
              break;
            }
          }
        }
      } catch (domErr) { /* DOM scraping failed — continue with what we have */ }

      // Description: try itemprop selector
      if (!domData.description) {
        try {
          var descEl = document.querySelector('[itemprop="description"]');
          if (descEl && descEl.textContent && descEl.textContent.trim().length > 20) {
            domData.description = descEl.textContent.trim();
          }
        } catch(e) {}
      }

      // Condition/Status: map the scraped condition text to a numeric status_id
      var conditionMap = {
        'New with tags': 6, 'new with tags': 6,
        'New without tags': 1, 'new without tags': 1,
        'Very good': 2, 'very good': 2,
        'Good': 3, 'good': 3,
        'Satisfactory': 4, 'satisfactory': 4,
        'Not fully functional': 5,
      };
      if (!domData.status_id && domData._dom_condition) {
        var cond = domData._dom_condition.trim();
        if (conditionMap[cond] !== undefined) {
          domData.status_id = conditionMap[cond];
        }
      }
      // Fallback: scan body textContent (fast, unlike innerText)
      if (!domData.status_id) {
        try {
          var bodyTC = document.body ? document.body.textContent || '' : '';
          var condKeys = Object.keys(conditionMap);
          for (var ck = 0; ck < condKeys.length; ck++) {
            if (bodyTC.indexOf(condKeys[ck]) >= 0) {
              domData.status_id = conditionMap[condKeys[ck]];
              break;
            }
          }
        } catch(e) {}
      }

      // ════════════════════════════════════════════════════════════════
      // Merge everything: fiber data + DOM data
      // Fiber data has priority (more accurate), DOM fills gaps
      // ════════════════════════════════════════════════════════════════
      var finalData = {};
      // DOM data first (lower priority)
      var domKeys = Object.keys(domData);
      for (var dk2 = 0; dk2 < domKeys.length; dk2++) {
        finalData[domKeys[dk2]] = domData[domKeys[dk2]];
      }
      // Fiber data overwrites (higher priority)
      if (fiberData) {
        var fiberKeys = Object.keys(fiberData);
        for (var fk = 0; fk < fiberKeys.length; fk++) {
          if (fiberData[fiberKeys[fk]] !== null && fiberData[fiberKeys[fk]] !== undefined) {
            finalData[fiberKeys[fk]] = fiberData[fiberKeys[fk]];
          }
        }
      }

      if (Object.keys(finalData).length > 4) {
        return makeResult('fiber_plus_dom', finalData, allMatches ? allMatches.length : 0);
      }

      return {
        source: 'NOT_FOUND',
        data: null,
        csrfToken: _csrfToken,
        matchCount: 0,
        globals: [],
        docTitle: document.title,
        bodyLen: document.body ? document.body.innerHTML.length : 0,
      };
    })()
  `;
}
