import type { Query } from "./db.ts";
import { stamp } from "./security.ts";
import { AppError } from "./contracts.ts";

export const deliveryStatuses = [
  "accepted",
  "sent",
  "delivered",
  "read",
  "failed",
] as const;
type DeliveryStatus = (typeof deliveryStatuses)[number];
const rank = { accepted: 0, sent: 1, failed: 1, delivered: 2, read: 3 };
export async function recordDelivery(
  q: Query,
  owner: string,
  messageId: string,
  status: DeliveryStatus,
  details: { jobId?: string; providerCode?: number } = {},
) {
  const id = "wa-delivery:" + messageId;
  await q.query(
    "INSERT INTO records(id,kind,owner,data) VALUES($1,'whatsapp_delivery',$2,$3) ON CONFLICT(id) DO NOTHING",
    [
      id,
      owner,
      JSON.stringify({ messageId, status: "accepted", updatedAt: stamp() }),
    ],
  );
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = (
      await q.query(
        "SELECT data,version FROM records WHERE id=$1 AND owner=$2 AND kind='whatsapp_delivery'",
        [id, owner],
      )
    ).rows[0];
    if (!row) return;
    const before = JSON.parse(row.data),
      old = before.status as DeliveryStatus;
    const advances =
      rank[status] >= rank[old] &&
      !(old === "failed" && ["accepted", "sent"].includes(status));
    const next = {
      ...before,
      ...(details.jobId ? { jobId: details.jobId } : {}),
      ...(advances && details.providerCode
        ? { providerCode: details.providerCode }
        : {}),
      status: advances ? status : old,
      updatedAt: stamp(),
    };
    const changed = await q.query(
      "UPDATE records SET data=$1,version=version+1 WHERE id=$2 AND owner=$3 AND version=$4",
      [JSON.stringify(next), id, owner, row.version],
    );
    if (changed.count) return;
  }
  throw new AppError("DELIVERY_STATUS_BUSY", 503);
}
