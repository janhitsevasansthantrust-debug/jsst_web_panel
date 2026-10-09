/** One selection used by collection previews, bills and payment history. */
export function selectClosings(closings, { batchId, closingId, fromMs, toMs } = {}) {
  return (closings ?? []).filter((c) =>
    (!batchId || c.batchId === batchId) &&
    (!closingId || c.id === closingId) &&
    (fromMs == null || fromMs === '' || c.dateMs >= Number(fromMs)) &&
    (toMs == null || toMs === '' || c.dateMs <= Number(toMs)),
  ).sort((a, b) => a.dateMs - b.dateMs || a.seq - b.seq);
}
