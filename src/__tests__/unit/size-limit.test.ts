/**
 * Unit tests — parseMaxJsonSize() from src/modules/ingest/size-limit.ts
 *
 * Pure function tests: zero I/O, zero DB, zero HTTP.
 *
 * @see skills/vitest-three-layer-testing.md §Layer 1
 * @see src/modules/ingest/size-limit.ts
 */

import { describe, it, expect } from 'vitest';
import { parseMaxJsonSize } from '../../modules/ingest/size-limit.js';

const DEFAULT_10MB = 10 * 1024 * 1024; // 10,485,760

describe('parseMaxJsonSize', () => {
  it('returns default 10MB for undefined', () => {
    expect(parseMaxJsonSize(undefined)).toBe(DEFAULT_10MB);
  });

  it('returns default 10MB for empty string', () => {
    expect(parseMaxJsonSize('')).toBe(DEFAULT_10MB);
  });

  it('parses bare number as bytes', () => {
    expect(parseMaxJsonSize('1024')).toBe(1024);
  });

  it('parses explicit "b" suffix as bytes', () => {
    expect(parseMaxJsonSize('512b')).toBe(512);
  });

  it('parses "kb" suffix as kilobytes', () => {
    expect(parseMaxJsonSize('5kb')).toBe(5 * 1024);
  });

  it('parses "mb" suffix as megabytes', () => {
    expect(parseMaxJsonSize('10mb')).toBe(10 * 1024 * 1024);
  });

  it('parses "gb" suffix as gigabytes', () => {
    expect(parseMaxJsonSize('1gb')).toBe(1 * 1024 * 1024 * 1024);
  });

  it('parses decimal values', () => {
    expect(parseMaxJsonSize('1.5mb')).toBe(Math.floor(1.5 * 1024 * 1024));
  });

  it('is case-insensitive', () => {
    expect(parseMaxJsonSize('10MB')).toBe(10 * 1024 * 1024);
    expect(parseMaxJsonSize('5KB')).toBe(5 * 1024);
    expect(parseMaxJsonSize('2Gb')).toBe(2 * 1024 * 1024 * 1024);
  });

  it('trims whitespace', () => {
    expect(parseMaxJsonSize('  10mb  ')).toBe(10 * 1024 * 1024);
  });

  it('returns default for unparseable string', () => {
    expect(parseMaxJsonSize('abc')).toBe(DEFAULT_10MB);
  });

  it('returns default for negative-looking input', () => {
    // The regex requires digits at the start; "-5mb" won't match
    expect(parseMaxJsonSize('-5mb')).toBe(DEFAULT_10MB);
  });

  it('handles zero correctly', () => {
    expect(parseMaxJsonSize('0mb')).toBe(0);
    expect(parseMaxJsonSize('0')).toBe(0);
  });
});
