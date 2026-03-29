# PLAN.md — Vinted HQ Redesign Technical Roadmap

**Version:** 1.0
**Status:** DRAFT — Awaiting Architect Approval
**Reference:** [SPEC.md](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Seller-HQ/electron-app/docs/Design/SPEC.md) is the single source of truth for all values referenced herein.

---

## Overview

This roadmap is organized into **4 sequential phases**. Each phase is assigned to a specific agent role. Phases can be parallelized where dependencies allow (Phases 2–4 depend on Phase 1, but are independent of each other).

---

## Phase 1: Foundation (Builder Agent)

**Goal:** Inject the SVG filter infrastructure and completely rewrite the design token system.

**Files Modified:**
- `src/theme.ts` — Full rewrite
- `src/index.css` — Global resets + pseudo-element classes
- `src/App.tsx` — SVG filter injection into DOM root

### Step 1.1 — Inject SVG Filter into DOM Root

**File:** [App.tsx](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Seller-HQ/electron-app/src/App.tsx)

1. At the **very top** of the root `<div>` returned by `App()` (line 198), insert the SVG filter block defined in SPEC.md §5.
2. The SVG element must be the **first child** of the root flex container `<div>`.
3. Use `dangerouslySetInnerHTML` or a dedicated React component wrapping the raw SVG. A dedicated `<LiquidGlassFilter />` component is preferred for maintainability.
4. Ensure `aria-hidden="true"` and zero-dimension styling (`position: absolute; width: 0; height: 0; overflow: hidden`) are applied so it does not affect layout.

### Step 1.2 — Rewrite `src/theme.ts`

**File:** [theme.ts](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Seller-HQ/electron-app/src/theme.ts)

1. **Replace** the entire `colors` object with the schema from SPEC.md §1.
2. **Keep** the `font` object structure but verify values match SPEC.md §2 (no changes expected).
3. **Replace** the `radius` object with values from SPEC.md §3 (note: `sm` changes from `6` → `8`, `md` from `10` → `12`, etc.).
4. **Replace** the `spacing` object with values from SPEC.md §3 (note: `xl` changes from `20` → `24`, `'4xl'` from `40` → `48`).
5. **Replace** the `shadows` and `blur` objects with values from SPEC.md §4.
6. **Add** two new exports: `liquidGlassPanel` and `liquidGlassCard` per SPEC.md §6.1 and §6.2.
7. **Rename/alias** `glassInput` to use `recessedInput` per SPEC.md §6.3.
8. **Update** all composite style objects (`btnPrimary`, `btnSecondary`, `btnDanger`, `modalOverlay`, `modalContent`, table tokens, etc.) per SPEC.md §7.
9. **Update** `SIDEBAR_WIDTH` from `220` to `240`.

### Step 1.3 — Rewrite `src/index.css`

**File:** [index.css](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Seller-HQ/electron-app/src/index.css)

1. **Replace** the base reset rules with the global reset from SPEC.md §9.
2. Set `background-color: #FAF9F6` on `html, body, #root`.
3. Set `color: #111111` as default text color.
4. **Add** the `.liquid-glass-panel::after` pseudo-element rule from SPEC.md §6.1.
5. **Add** light-mode scrollbar styling per SPEC.md §9.
6. Preserve any existing animation keyframes (`animate-fadeInScale`, `animate-slideUp`, etc.) that are referenced by components.

### Step 1.4 — Verify Foundation

1. Run `npm run dev` (or equivalent Vite dev server) to ensure the application compiles without errors.
2. Visually confirm the application background switches from `#080b12` (dark navy) to `#FAF9F6` (warm off-white).
3. Confirm the SVG filter element is present in the DOM (DevTools → Elements → first child of root `<div>`).
4. Confirm text color defaults to `#111111`.

---

## Phase 2: Macro Layout (Design Lead Agent)

**Goal:** Refactor `App.tsx` to apply Liquid Glass to the sidebar, update the main content area, and adapt all layout-level styling.

**Depends on:** Phase 1 (Foundation must be complete).

**File Modified:**
- `src/App.tsx`

### Step 2.1 — Refactor Sidebar

**Target:** The `<aside>` element (lines 200–314 of current `App.tsx`).

1. **Update width** from `SIDEBAR_WIDTH` (220px) to the new `SIDEBAR_WIDTH` (240px). This is automatic if `SIDEBAR_WIDTH` constant is updated in Phase 1.
2. **Apply** the `liquidGlassPanel` style object to the sidebar (or apply the `className="liquid-glass-panel"` class for the `::after` specular highlight).
3. **Change** sidebar `background` to `rgba(255, 255, 255, 0.60)` (per SPEC.md §6.1, this is handled by `liquidGlassPanel`).
4. **Update** `backdropFilter` to use `url(#liquid-glass-refraction) blur(40px) saturate(150%)` for the sidebar specifically (heavier blur than standard panels).
5. **Update** `borderRight` from `1px solid ${colors.glassBorder}` to `1px solid rgba(255, 255, 255, 0.9)`.
6. **Add** `boxShadow: '1px 0 12px rgba(0, 0, 0, 0.03)'` for subtle depth separation.

### Step 2.2 — Update Navigation Items

**Target:** The `<nav>` section and tab buttons.

1. **Update** active tab styling: `background` should use `colors.primaryMuted` (now `rgba(99, 102, 241, 0.10)`), `color` should use `colors.primary` (now `#6366F1`).
2. **Update** hover state: `background` should use `rgba(0, 0, 0, 0.04)` (subtle dark tint on light background instead of `colors.glassHighlight`), `color` should transition to `colors.textPrimary` (`#111111`).
3. **Update** inactive tab `color` from `colors.textSecondary` (was `#8b95a8`, now `#666666`).
4. **Increase** button `borderRadius` to `radius.md` (12px).

### Step 2.3 — Update Main Content Area

**Target:** The `<main>` element (lines 317–334).

1. **Ensure** `background` is `colors.bgBase` (`#FAF9F6`).
2. Verify `marginLeft` uses the updated `SIDEBAR_WIDTH` (240px).

### Step 2.4 — Update Modal Styles

**Target:** Sniper Countdown Modal (lines 337–392) and Session Expired Modal (lines 395–480).

1. **Apply** updated `modalOverlay` and `modalContent` from SPEC.md §7.5.
2. **Update** icon badge backgrounds (e.g., `colors.primaryMuted`, `colors.errorBg`) to new light-mode semantic values.
3. **Update** all text colors within modals to use the new light-mode palette.

### Step 2.5 — Verify Macro Layout

1. Visually confirm the sidebar renders as a translucent Liquid Glass panel with visible refraction of background content.
2. Confirm the specular highlight (bright rim on top-left edges) is visible on the sidebar.
3. Confirm navigation items highlight correctly on hover and active states.
4. Confirm modals render with updated styling and proper backdrop blur.
5. Test scrolling: items in the main content area should visually distort/refract as they pass behind the sidebar.

---

## Phase 3: High-Density Feed (Design Lead Agent)

**Goal:** Overhaul `Feed.tsx` and the item cards to remove harsh borders, apply optimized glass styling, and implement lift-on-hover.

**Depends on:** Phase 1 (Foundation must be complete).

**File Modified:**
- `src/components/Feed.tsx`

### Step 3.1 — Update FeedItemCard Styling

1. **Replace** any existing card border/background styles with `liquidGlassCard` from SPEC.md §6.2.
2. **Remove** any `border` declarations that use bright/harsh colors or widths > 1px.
3. **Set** card `borderRadius` to `radius.xl` (20px).
4. **Set** default `boxShadow` to `shadows.card` (`0 4px 24px rgba(0,0,0,0.03)`).

### Step 3.2 — Implement Hover States

1. On `mouseEnter`:
   - `background` → `colors.glassBgHover` (`rgba(255,255,255,0.80)`)
   - `transform` → `translateY(-4px)`
   - `boxShadow` → `shadows.cardHover` (`0 12px 40px rgba(0,0,0,0.06)`)
2. On `mouseLeave`:
   - Reset all values to defaults from `liquidGlassCard`.
3. Ensure transitions use `transition.base` (`all 0.2s ease`).

### Step 3.3 — Update Text & Price Styling

1. **Item titles**: `fontWeight: font.weight.medium`, `color: colors.textPrimary`.
2. **Prices**: `fontWeight: font.weight.semibold`, `color: colors.textPrimary`. Apply `text-shadow: 0 1px 0 rgba(255,255,255,0.9)` for accessibility lift.
3. **Metadata** (size, brand, condition): `fontWeight: font.weight.normal`, `color: colors.textSecondary`.
4. **Status badges**: Use new semantic colors (e.g., `success` text on `successBg` background).

### Step 3.4 — Update Image Handling

1. Maintain `aspectRatio: '1'` and `objectFit: 'cover'`.
2. **Add** a subtle inner shadow at the bottom of images for blending: `box-shadow: inset 0 -20px 30px rgba(0,0,0,0.05)`.
3. **Update** image `borderRadius` to match the top of the card: `borderRadius: '20px 20px 0 0'`.

### Step 3.5 — Update Grid Container

1. Verify the responsive grid (`repeat(auto-fill, minmax(220px, 1fr))`) still functions correctly.
2. **Increase** grid `gap` to `spacing.xl` (24px) for more breathing room between cards.

### Step 3.6 — Verify Feed

1. Confirm cards display with subtle glass backgrounds and faint drop shadows.
2. Confirm hover animation: card lifts `4px` with expanded shadow.
3. Confirm no harsh borders are visible on any card.
4. Scroll performance test: confirm smooth 60fps scrolling with dozens of cards rendered.

---

## Phase 4: Forms & Tables (Design Lead Agent)

**Goal:** De-clutter `Settings.tsx` with recessed inputs and fix `Logs.tsx` typography hierarchy.

**Depends on:** Phase 1 (Foundation must be complete).

**Files Modified:**
- `src/components/Settings.tsx`
- `src/components/Logs.tsx`

### Step 4.1 — De-clutter Settings.tsx

1. **Replace** all instances of `glassInput` styling with `recessedInput` from SPEC.md §6.3.
2. **Update** resting input appearance: light grey background (`rgba(0,0,0,0.03)`), subtle inset shadow, **no dark outer borders**.
3. **Implement** focus state transition: background to `#FFFFFF`, `2px solid #6366F1` border, inset shadow removed.
4. **Update** `<select>` elements to match the recessed pattern.
5. **Update** `<textarea>` elements to match the recessed pattern.
6. **Update** section spacing: increase `marginBottom` on Section components to `spacing['2xl']` (32px) or `spacing['3xl']` (40px).
7. **Update** `sectionTitle` styling: verify `fontSize`, `fontWeight`, `color` match SPEC.md §2 hierarchy rules.
8. **Update** button styles: all buttons to use new `btnPrimary`, `btnSecondary`, `btnDanger` from SPEC.md §7.4.

### Step 4.2 — Fix Logs.tsx Typography

1. **Update** table header styling to use `tableHeader` from SPEC.md §7.3:
   - Background: `#F5F5F5` (subtle grey)
   - Font: `Inter SemiBold (600)`, `uppercase`, `letter-spacing: 0.05em`
   - **Remove** vertical border lines between columns.
2. **Update** table row styling:
   - **Remove** alternating zebra striping if present.
   - Set minimum row height to `48px`.
   - Use `1px solid rgba(0,0,0,0.04)` for bottom borders.
3. **Update** hover state: on row hover, apply `rgba(0,0,0,0.02)` background.
4. **Update** status badges to use light-mode semantic colors:
   - Success: `bg: #ECFDF5`, `color: #059669`
   - Error: `bg: #FEF2F2`, `color: #DC2626`
   - Warning: `bg: #FFFBEB`, `color: #D97706`
5. **Update** all text colors within the table to use the new palette.
6. **Update** timestamp/metadata text to use `textSecondary` (`#666666`).

### Step 4.3 — Verify Forms & Tables

1. **Settings page test:**
   - Confirm inputs appear as recessed channels (subtle, not boxed).
   - Click an input: confirm transition to white bg with indigo border.
   - Tab between inputs: confirm focus ring moves correctly.
   - Confirm increased spacing between sections.
2. **Logs page test:**
   - Confirm table headers are visually distinct but unobtrusive (grey bg, uppercase).
   - Confirm no zebra striping.
   - Confirm status badges use pastel backgrounds with saturated text.
   - Scroll through logs: confirm readability and scan-ability.

---

## Phase Dependency Graph

```
Phase 1 (Foundation - Builder Agent)
  ├──> Phase 2 (Macro Layout - Design Lead Agent)
  ├──> Phase 3 (High-Density Feed - Design Lead Agent)
  └──> Phase 4 (Forms & Tables - Design Lead Agent)
```

Phases 2, 3, and 4 are **independent** of each other and may execute in parallel once Phase 1 is complete.

---

## Verification Checklist (Post-Completion)

- [ ] Application compiles and runs without errors (`npm run dev`)
- [ ] Background color: `#FAF9F6` (warm off-white) — NOT `#080b12` (dark navy)
- [ ] Text color defaults to `#111111` — NOT `#e8ecf4`
- [ ] SVG filter `#liquid-glass-refraction` present in DOM
- [ ] Sidebar renders with Liquid Glass refraction effect
- [ ] Specular highlight visible on sidebar (bright rim, top-left edges)
- [ ] Feed cards: no harsh borders, lift-on-hover animation
- [ ] Feed scroll performance: 60fps with 50+ cards
- [ ] Settings inputs: recessed channel pattern at rest, white+indigo on focus
- [ ] Logs table: grey headers, no zebra stripes, pastel status badges
- [ ] All modals: updated to light-mode palette
- [ ] Scrollbar: light-mode thin scrollbar (no dark scrollbar tracks)
- [ ] WCAG AA contrast ratio maintained (≥4.5:1 for normal text)

---

*End of PLAN.md*
