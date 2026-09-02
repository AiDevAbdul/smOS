/**
 * Shared parsing for Meta's pixel/dataset `/stats` endpoint.
 *
 * Meta's /stats returns hourly buckets, each with its own nested `data`
 * array: { start_time, aggregation, data: [{ value, count }] }. Every
 * caller needs this flattened into { time (epoch seconds), name, count }
 * rows before it can sum counts or find a last-fired time.
 *
 * This used to be reimplemented per-caller (skills/capi-setup/capi-setup.js
 * and scripts/lib/guards.js each had their own copy) and the copies drifted:
 * one was fixed for the nested-bucket shape, the other silently assumed flat
 * rows and always reported `firing: false`. Import this instead of
 * re-parsing /stats anywhere new.
 */

export function flattenStatsBuckets(raw) {
  const rows = [];
  for (const bucket of raw?.data || []) {
    const time = Math.floor(new Date(bucket.start_time).getTime() / 1000);
    for (const row of bucket.data || []) {
      rows.push({ time, name: row.value, count: row.count || 0 });
    }
  }
  return rows;
}
