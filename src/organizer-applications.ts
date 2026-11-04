import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Core } from "./core.ts";
import type { Agent } from "./ai/agent.ts";
import { AppError } from "./contracts.ts";
import { stamp } from "./security.ts";
const Evidence = z
  .object({
    name: z.string().trim().min(1).max(100),
    mime: z.enum(["application/pdf", "image/jpeg", "image/png"]),
    base64: z.string().min(8).max(1398104),
  })
  .strict();
export const OrganizerApplication = z
  .object({
    applicantType: z.enum(["individual", "business"]),
    address: z.string().trim().min(10).max(500),
    businessName: z.string().trim().min(2).max(150).optional(),
    registrationNumber: z.string().trim().min(3).max(40).optional(),
    addressProof: Evidence,
    registrationProof: Evidence.optional(),
    declaration: z.literal(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.applicantType === "business" &&
      (!value.businessName ||
        !value.registrationNumber ||
        !value.registrationProof)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Add your registered business name, CAC number and CAC document.",
      });
    if (
      value.applicantType === "individual" &&
      (value.businessName ||
        value.registrationNumber ||
        value.registrationProof)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "An individual application needs home-address evidence, not business documents.",
      });
  });
function checkedEvidence(value: z.infer<typeof Evidence>) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value.base64))
    throw new AppError("APPLICATION_FILE_INVALID");
  const data = Buffer.from(value.base64, "base64");
  if (data.length > 1048576 || data.toString("base64") !== value.base64)
    throw new AppError("APPLICATION_FILE_INVALID");
  const signature =
    value.mime === "application/pdf"
      ? data.subarray(0, 5).toString() === "%PDF-"
      : value.mime === "image/png"
        ? data.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
        : data.subarray(0, 3).toString("hex") === "ffd8ff";
  if (!signature) throw new AppError("APPLICATION_FILE_INVALID");
  return value;
}
export async function submitOrganizerApplication(
  core: Core,
  cipher: Pick<Agent, "seal">,
  owner: string,
  source: unknown,
) {
  const input = OrganizerApplication.parse(source),
    addressProof = checkedEvidence(input.addressProof),
    registrationProof = input.registrationProof
      ? checkedEvidence(input.registrationProof)
      : null;
  const user = await core.getUser(owner);
  if (!user.ready) throw new AppError("SETUP_REQUIRED");
  if (user.organizer) throw new AppError("ORGANIZER_ALREADY_ENABLED");
  const { address, businessName, registrationNumber } = input;
  const id = randomUUID(),
    createdAt = stamp();
  return core.db.transaction(async (q) => {
    if (core.db.postgres)
      await q.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [owner]);
    const applications = (
      await q.query(
        "SELECT data FROM records WHERE owner=$1 AND kind='organizer_application'",
        [owner],
      )
    ).rows.map((row) => JSON.parse(row.data));
    if (applications.some((application) => application.status === "PENDING"))
      throw new AppError("APPLICATION_PENDING", 409);
    if (
      applications.filter(
        (application) =>
          application.createdAt.slice(0, 10) === createdAt.slice(0, 10),
      ).length >= 3
    )
      throw new AppError("APPLICATION_LIMIT", 429);
    await core.put(q, id, owner, "organizer_application", {
      applicantType: input.applicantType,
      status: "PENDING",
      createdAt,
      updatedAt: createdAt,
      sealed: cipher.seal({ address, businessName, registrationNumber }),
    });
    for (const [kind, evidence] of [
      ["address", addressProof],
      ["cac", registrationProof],
    ] as const)
      if (evidence)
        await core.put(q, id + ":" + kind, owner, "organizer_evidence", {
          applicationId: id,
          kind,
          sealed: cipher.seal(evidence),
        });
    return {
      id,
      applicantType: input.applicantType,
      status: "PENDING",
      createdAt,
    };
  });
}
export async function reviewOrganizerApplication(
  core: Core,
  id: string,
  decision: "approve" | "reject",
  reason: string,
) {
  if (!["approve", "reject"].includes(decision))
    throw new AppError("APPLICATION_DECISION_INVALID");
  if (!reason.trim() || reason.length > 300)
    throw new AppError("APPLICATION_REASON_REQUIRED");
  return core.db.transaction(async (q) => {
    if (core.db.postgres)
      await q.query("SELECT id FROM records WHERE id=$1 FOR UPDATE", [id]);
    const row = (
      await q.query(
        "SELECT owner,data FROM records WHERE id=$1 AND kind='organizer_application'",
        [id],
      )
    ).rows[0];
    if (!row) throw new AppError("NOT_FOUND", 404);
    const application = JSON.parse(row.data);
    if (application.status !== "PENDING")
      throw new AppError("APPLICATION_REVIEWED", 409);
    if (decision === "approve")
      await q.query("UPDATE users SET organizer=1 WHERE id=$1", [row.owner]);
    const status = decision === "approve" ? "APPROVED" : "REJECTED";
    await q.query("UPDATE records SET data=$1,version=version+1 WHERE id=$2", [
      JSON.stringify({
        ...application,
        status,
        reason: reason.trim(),
        reviewedAt: stamp(),
        updatedAt: stamp(),
      }),
      id,
    ]);
    await core.put(q, randomUUID(), row.owner, "organizer_review", {
      applicationId: id,
      decision,
      reason: reason.trim(),
      createdAt: stamp(),
    });
    return { id, status };
  });
}

export async function inspectOrganizerApplication(
  core: Core,
  cipher: Pick<Agent, "open">,
  id: string,
) {
  const row = (
    await core.db.query(
      "SELECT owner,data FROM records WHERE id=$1 AND kind='organizer_application'",
      [id],
    )
  ).rows[0];
  if (!row) throw new AppError("NOT_FOUND", 404);
  const application = JSON.parse(row.data);
  const evidenceRows = await core.records(row.owner, "organizer_evidence");
  return {
    id,
    owner: row.owner,
    applicantType: application.applicantType,
    status: application.status,
    createdAt: application.createdAt,
    details: cipher.open(application.sealed),
    evidence: evidenceRows
      .filter((item) => item.applicationId === id)
      .map((item) => ({ kind: item.kind, ...cipher.open(item.sealed) })),
  };
}
