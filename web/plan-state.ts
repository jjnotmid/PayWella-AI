type State = { id: string; revision: number; status: string };
const final = new Set([
  "SUCCEEDED",
  "PARTIAL",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
]);
export function acceptPlanState<T extends State>(
  current: T | null,
  incoming: T | null,
): T | null {
  if (!current || !incoming || current.id !== incoming.id) return incoming;
  if (incoming.revision < current.revision) return current;
  if (
    incoming.revision === current.revision &&
    ((final.has(current.status) && incoming.status !== current.status) ||
      (["RUNNING", "PENDING"].includes(current.status) &&
        incoming.status === "READY"))
  )
    return current;
  return incoming;
}
