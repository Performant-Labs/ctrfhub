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
 *
 * TODO(INFRA-003+): Populate with actual event constants as HTMX-using
 * stories land (AUTH-002, DASH-001, etc.). Example entries:
 *
 *   export const HtmxEvents = {
 *     AFTER_SETTLE:   'htmx:afterSettle',
 *     AFTER_SWAP:     'htmx:afterSwap',
 *     BEFORE_REQUEST: 'htmx:beforeRequest',
 *     RESPONSE_ERROR: 'htmx:responseError',
 *     LOAD_START:     'htmx:xhr:loadstart',   // renamed htmx:fetch:loadstart in 4.0
 *     LOAD_END:       'htmx:xhr:loadend',       // renamed htmx:fetch:loadend in 4.0
 *   } as const;
 */
export {};
