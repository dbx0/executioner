/**
 * The page's grid, named once so the loaded page and its skeleton cannot drift
 * apart. Every gap is the shared panel gutter.
 */
export const PAGE_STACK = 'flex min-h-full flex-col gap-panel'
export const CARD_ROW_2 = 'grid shrink-0 gap-panel lg:grid-cols-2'
/** The last row takes whatever height the window has left, as in the mock. */
export const CARD_ROW_3 = 'grid flex-1 gap-panel lg:grid-cols-3'
