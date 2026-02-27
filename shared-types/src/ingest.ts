/**
 * Shared Type Definitions between the Extension (React/Vite) and the Python Bridge.
 */

export interface WardrobeSyncPayload {
    /**
     * The source of the sync data.
     * 'extension_wardrobe' means it comes from /member/items.
     * 'extension_item_detail' means it comes from /items/[id]/edit.
     */
    source: 'extension_wardrobe' | 'extension_item_detail';

    /**
     * The timestamp when the payload was captured in milliseconds.
     */
    timestamp: number;

    /**
     * Raw Vinted item objects extracted from the Next.js state.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items: any[];
}
