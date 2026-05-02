/**
 * CTRFHub — Client entry point.
 *
 * Re-initializes Flowbite components after HTMX DOM swaps so that
 * dropdowns, modals, tooltips, and other Flowbite behaviours survive
 * morph-based page updates.
 *
 * `initFlowbite` is a global function exposed by flowbite.min.js,
 * which is loaded as a synchronous `<script>` before this module.
 *
 * @see skills/tailwind-4-flowbite-dark-only.md §Flowbite re-initialization
 * @see skills/htmx-4-forward-compat.md
 */
import { HtmxEvents } from './htmx-events';

declare global {
  function initFlowbite(): void;
}

document.addEventListener(HtmxEvents.AFTER_SETTLE, () => initFlowbite());
