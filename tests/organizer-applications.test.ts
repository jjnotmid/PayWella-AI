import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/db.ts";
import { Core } from "../src/core.ts";
import { Agent } from "../src/ai/agent.ts";
import {
  submitOrganizerApplication,
  reviewOrganizerApplication,
  inspectOrganizerApplication,
} from "../src/organizer-applications.ts";

const proof = {
  name: "address.pdf",
  mime: "application/pdf",
  base64: Buffer.from("%PDF-1.7\nfictional-address-proof").toString("base64"),
};
const application = {
  applicantType: "individual",
  address: "10 Fictional Road, Lagos",
  addressProof: proof,
  declaration: true,
};
test("organizer documents remain encrypted, individual and CAC paths differ, access changes only after operator review", async () => {
  const db = await openStore({ file: ":memory:" }),
    core = new Core(db);
  try {
    const owner = await core.userForPhone("2348000000001"),
      other = await core.userForPhone("2348000000002");
    await core.setup(owner, "Ada Example", "1234");
    await core.setup(other, "Bisi Example", "4321");
    const agent = new Agent(
      core,
      {
        provider: "offline",
        async complete() {
          throw Error();
        },
      },
      "isolated-application-encryption-secret",
    );
    const result = await submitOrganizerApplication(
      core,
      agent,
      owner,
      application,
    );
    assert.equal(result.status, "PENDING");
    assert.equal((await core.getUser(owner)).organizer, 0);
    const records = await db.query("SELECT data FROM records WHERE owner=$1", [
      owner,
    ]);
    assert.equal(
      JSON.stringify(records.rows).includes("Fictional Road"),
      false,
    );
    assert.equal(JSON.stringify(records.rows).includes(proof.base64), false);
    const publicWorkspace = await core.workspace(owner);
    assert.equal(publicWorkspace.organizerApplications.length, 1);
    assert.equal(JSON.stringify(publicWorkspace).includes("sealed"), false);
    assert.equal((await core.workspace(other)).organizerApplications.length, 0);
    const inspected = await inspectOrganizerApplication(core, agent, result.id);
    assert.equal(inspected.details.address, application.address);
    assert.equal(inspected.evidence.length, 1);
    assert.equal(inspected.evidence[0].base64, proof.base64);
    await assert.rejects(
      () => submitOrganizerApplication(core, agent, owner, application),
      (e: any) => e.code === "APPLICATION_PENDING",
    );
    await reviewOrganizerApplication(
      core,
      result.id,
      "reject",
      "Choose a clearer document.",
    );
    assert.equal((await core.getUser(owner)).organizer, 0);
    const again = await submitOrganizerApplication(
      core,
      agent,
      owner,
      application,
    );
    await reviewOrganizerApplication(
      core,
      again.id,
      "approve",
      "Reviewed for isolated sandbox testing.",
    );
    assert.equal((await core.getUser(owner)).organizer, 1);
    await assert.rejects(
      () => reviewOrganizerApplication(core, again.id, "approve", "repeat"),
      (e: any) => e.code === "APPLICATION_REVIEWED",
    );
    await assert.rejects(() =>
      submitOrganizerApplication(core, agent, other, {
        ...application,
        applicantType: "business",
      }),
    );
    await assert.rejects(() =>
      submitOrganizerApplication(core, agent, other, {
        ...application,
        businessName: "Not needed",
      }),
    );
    const business = await submitOrganizerApplication(core, agent, other, {
      ...application,
      applicantType: "business",
      businessName: "Example Ltd",
      registrationNumber: "RC123456",
      registrationProof: proof,
    });
    assert.equal(business.applicantType, "business");
    assert.equal((await core.getUser(other)).organizer, 0);
  } finally {
    await db.close();
  }
});
test("documents with forged MIME signatures, excessive size or noncanonical encoding are rejected", async () => {
  const db = await openStore({ file: ":memory:" }),
    core = new Core(db);
  try {
    const owner = await core.userForPhone("2348000000001");
    await core.setup(owner, "Ada Example", "1234");
    const agent = new Agent(
      core,
      {
        provider: "offline",
        async complete() {
          throw Error();
        },
      },
      "isolated-application-encryption-secret",
    );
    for (const evidence of [
      { ...proof, mime: "image/png" },
      { ...proof, base64: proof.base64 + "===" },
      { ...proof, base64: Buffer.alloc(1048577).toString("base64") },
    ])
      await assert.rejects(() =>
        submitOrganizerApplication(core, agent, owner, {
          ...application,
          addressProof: evidence,
        }),
      );
    assert.equal(
      (await core.records(owner, "organizer_application")).length,
      0,
    );
  } finally {
    await db.close();
  }
});
