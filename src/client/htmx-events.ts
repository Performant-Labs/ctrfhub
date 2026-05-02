/**
 * HTMX Event Name Constants — Forward-Compatibility Layer
 *
 * All HTMX event listeners in the codebase MUST reference constants from
 * this module — never raw event name strings. This enables a single-file
 * update when upgrading from HTMX 2.x to 4.0, where `htmx:xhr:*` events
 * are renamed to `htmx:fetch:*`.
 *
 * @see skills/htmx-4-forward-compat.md — Rule 2
 * @see docs/planning/project-plan.md §HTMX 4.0 Forward-Compatibility Rules
 */
export const HtmxEvents = {
  /** Fired after an HTMX swap has been settled (morph complete). */
  AFTER_SETTLE:   'htmx:afterSettle',
  /** Fired after new content has been swapped into the DOM. */
  AFTER_SWAP:     'htmx:afterSwap',
  /** Fired before an HTMX request is dispatched. */
  BEFORE_REQUEST: 'htmx:beforeRequest',
  /** Fired when an HTMX response has an error status. */
  RESPONSE_ERROR: 'htmx:responseError',
  /** Fired when an HTMX XHR load starts (renamed to htmx:fetch:loadstart in 4.0). */
  LOAD_START:     'htmx:xhr:loadstart',
  /** Fired when an HTMX XHR load ends (renamed to htmx:fetch:loadend in 4.0). */
  LOAD_END:       'htmx:xhr:loadend',
} as const;

export type HtmxEvent = (typeof HtmxEvents)[keyof typeof HtmxEvents];
