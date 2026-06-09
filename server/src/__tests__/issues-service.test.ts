import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  activityLog,
  agents,
  companies,
  createDb,
  issueComments,
  issueInboxArchives,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { issueService } from "../services/issues.ts";
import { createIssueSchema, updateIssueSchema } from "@paperclipai/shared";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres issue service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("issueService.list participantAgentId", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issues-service-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
  }, 20_000);

  afterEach(async () => {
    vi.useRealTimers();
    await db.delete(issueComments);
    await db.delete(issueInboxArchives);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("returns issues an agent participated in across the supported signals", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const otherAgentId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values([
      {
        id: agentId,
        companyId,
        name: "CodexCoder",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: otherAgentId,
        companyId,
        name: "OtherAgent",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);

    const assignedIssueId = randomUUID();
    const createdIssueId = randomUUID();
    const commentedIssueId = randomUUID();
    const activityIssueId = randomUUID();
    const excludedIssueId = randomUUID();

    await db.insert(issues).values([
      {
        id: assignedIssueId,
        companyId,
        title: "Assigned issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId: agentId,
        createdByAgentId: otherAgentId,
      },
      {
        id: createdIssueId,
        companyId,
        title: "Created issue",
        status: "todo",
        priority: "medium",
        createdByAgentId: agentId,
      },
      {
        id: commentedIssueId,
        companyId,
        title: "Commented issue",
        status: "todo",
        priority: "medium",
        createdByAgentId: otherAgentId,
      },
      {
        id: activityIssueId,
        companyId,
        title: "Activity issue",
        status: "todo",
        priority: "medium",
        createdByAgentId: otherAgentId,
      },
      {
        id: excludedIssueId,
        companyId,
        title: "Excluded issue",
        status: "todo",
        priority: "medium",
        createdByAgentId: otherAgentId,
        assigneeAgentId: otherAgentId,
      },
    ]);

    await db.insert(issueComments).values({
      companyId,
      issueId: commentedIssueId,
      authorAgentId: agentId,
      body: "Investigating this issue.",
    });

    await db.insert(activityLog).values({
      companyId,
      actorType: "agent",
      actorId: agentId,
      action: "issue.updated",
      entityType: "issue",
      entityId: activityIssueId,
      agentId,
      details: { changed: true },
    });

    const result = await svc.list(companyId, { participantAgentId: agentId });
    const resultIds = new Set(result.map((issue) => issue.id));

    expect(resultIds).toEqual(new Set([
      assignedIssueId,
      createdIssueId,
      commentedIssueId,
      activityIssueId,
    ]));
    expect(resultIds.has(excludedIssueId)).toBe(false);
  });

  it("combines participation filtering with search", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CodexCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    const matchedIssueId = randomUUID();
    const otherIssueId = randomUUID();

    await db.insert(issues).values([
      {
        id: matchedIssueId,
        companyId,
        title: "Invoice reconciliation",
        status: "todo",
        priority: "medium",
        createdByAgentId: agentId,
      },
      {
        id: otherIssueId,
        companyId,
        title: "Weekly planning",
        status: "todo",
        priority: "medium",
        createdByAgentId: agentId,
      },
    ]);

    const result = await svc.list(companyId, {
      participantAgentId: agentId,
      q: "invoice",
    });

    expect(result.map((issue) => issue.id)).toEqual([matchedIssueId]);
  });

  it("hides archived inbox issues until new external activity arrives", async () => {
    const companyId = randomUUID();
    const userId = "user-1";
    const otherUserId = "user-2";

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    const visibleIssueId = randomUUID();
    const archivedIssueId = randomUUID();
    const resurfacedIssueId = randomUUID();

    await db.insert(issues).values([
      {
        id: visibleIssueId,
        companyId,
        title: "Visible issue",
        status: "todo",
        priority: "medium",
        createdByUserId: userId,
        createdAt: new Date("2026-03-26T10:00:00.000Z"),
        updatedAt: new Date("2026-03-26T10:00:00.000Z"),
      },
      {
        id: archivedIssueId,
        companyId,
        title: "Archived issue",
        status: "todo",
        priority: "medium",
        createdByUserId: userId,
        createdAt: new Date("2026-03-26T11:00:00.000Z"),
        updatedAt: new Date("2026-03-26T11:00:00.000Z"),
      },
      {
        id: resurfacedIssueId,
        companyId,
        title: "Resurfaced issue",
        status: "todo",
        priority: "medium",
        createdByUserId: userId,
        createdAt: new Date("2026-03-26T12:00:00.000Z"),
        updatedAt: new Date("2026-03-26T12:00:00.000Z"),
      },
    ]);

    await svc.archiveInbox(
      companyId,
      archivedIssueId,
      userId,
      new Date("2026-03-26T12:30:00.000Z"),
    );
    await svc.archiveInbox(
      companyId,
      resurfacedIssueId,
      userId,
      new Date("2026-03-26T13:00:00.000Z"),
    );

    await db.insert(issueComments).values({
      companyId,
      issueId: resurfacedIssueId,
      authorUserId: otherUserId,
      body: "This should bring the issue back into Mine.",
      createdAt: new Date("2026-03-26T13:30:00.000Z"),
      updatedAt: new Date("2026-03-26T13:30:00.000Z"),
    });

    const archivedFiltered = await svc.list(companyId, {
      touchedByUserId: userId,
      inboxArchivedByUserId: userId,
    });

    expect(archivedFiltered.map((issue) => issue.id)).toEqual([
      resurfacedIssueId,
      visibleIssueId,
    ]);

    await svc.unarchiveInbox(companyId, archivedIssueId, userId);

    const afterUnarchive = await svc.list(companyId, {
      touchedByUserId: userId,
      inboxArchivedByUserId: userId,
    });

    expect(new Set(afterUnarchive.map((issue) => issue.id))).toEqual(new Set([
      visibleIssueId,
      archivedIssueId,
      resurfacedIssueId,
    ]));
  });

  it("strips system origin metadata from public issue create and update inputs", async () => {
    const companyId = randomUUID();
    const originRunId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    const publicCreateInput = {
      title: "Forged routine execution",
      status: "todo" as const,
      priority: "high" as const,
      originKind: "routine_execution",
      originId: randomUUID(),
      originRunId,
      originFingerprint: "forged",
    };
    expect(createIssueSchema.parse(publicCreateInput)).not.toHaveProperty("originKind");

    const created = await svc.create(companyId, publicCreateInput as any);
    expect(created.originKind).toBe("manual");
    expect(created.originId).toBeNull();
    expect(created.originRunId).toBeNull();
    expect(created.originFingerprint).toBeNull();

    const publicUpdateInput = {
      title: "Forged stale review update",
      originKind: "stale_active_run_evaluation",
      originId: randomUUID(),
      originRunId: randomUUID(),
      originFingerprint: "forged-stale-review",
    };
    expect(updateIssueSchema.parse(publicUpdateInput)).not.toHaveProperty("originKind");

    const updated = await svc.update(created.id, publicUpdateInput as any);
    expect(updated.originKind).toBe("manual");
    expect(updated.originId).toBeNull();
    expect(updated.originRunId).toBeNull();
    expect(updated.originFingerprint).toBeNull();
  });

  it("reuses an open stale active-run review with the same source run and fingerprint", async () => {
    const companyId = randomUUID();
    const sourceIssueId = randomUUID();
    const originRunId = randomUUID();
    const originFingerprint = "silent-output-seq-12";

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(issues).values({
      id: sourceIssueId,
      companyId,
      title: "Daily CEO Self-Improvement",
      status: "in_progress",
      priority: "high",
    });

    const first = await svc.create(companyId, {
      title: "Review stale active run",
      description: "Silent for 12 minutes",
      status: "todo",
      priority: "high",
      parentId: sourceIssueId,
      originKind: "stale_active_run_evaluation",
      originRunId,
      originFingerprint,
    }, { allowSystemOriginMetadata: true });

    const second = await svc.create(companyId, {
      title: "Review stale active run",
      description: "Silent for 16 minutes with latest process metadata",
      status: "todo",
      priority: "critical",
      parentId: sourceIssueId,
      originKind: "stale_active_run_evaluation",
      originRunId,
      originFingerprint,
    }, { allowSystemOriginMetadata: true });

    const reviewRows = await db
      .select()
      .from(issues)
      .where(and(
        eq(issues.companyId, companyId),
        eq(issues.originKind, "stale_active_run_evaluation"),
      ));

    expect(second.id).toBe(first.id);
    expect(reviewRows).toHaveLength(1);
    expect(reviewRows[0].priority).toBe("critical");
    expect(reviewRows[0].description).toContain("latest process metadata");
  });

  it("suppresses recent terminal stale active-run review duplicates without mutating terminal evidence", async () => {
    const companyId = randomUUID();
    const sourceIssueId = randomUUID();
    const terminalReviewId = randomUUID();
    const originRunId = randomUUID();
    const originFingerprint = "silent-output-seq-12";
    const resolvedAt = new Date("2026-06-09T09:00:00.000Z");

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(issues).values([
      {
        id: sourceIssueId,
        companyId,
        title: "Daily CEO Self-Improvement",
        status: "in_progress",
        priority: "high",
      },
      {
        id: terminalReviewId,
        companyId,
        title: "Resolved stale active-run review",
        description: "Terminal evidence must remain stable",
        status: "done",
        priority: "high",
        parentId: sourceIssueId,
        originKind: "stale_active_run_evaluation",
        originRunId,
        originFingerprint,
        createdAt: resolvedAt,
        updatedAt: resolvedAt,
        completedAt: resolvedAt,
      },
    ]);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-09T09:30:00.000Z"));
    const firstDuplicate = await svc.create(companyId, {
      title: "New stale active-run review",
      description: "New duplicate evidence should be suppressed",
      status: "todo",
      priority: "critical",
      parentId: sourceIssueId,
      originKind: "stale_active_run_evaluation",
      originRunId,
      originFingerprint,
    }, { allowSystemOriginMetadata: true });

    vi.setSystemTime(new Date("2026-06-09T09:59:00.000Z"));
    const secondDuplicate = await svc.create(companyId, {
      title: "Another stale active-run review",
      description: "Another duplicate should not slide the terminal window",
      status: "todo",
      priority: "critical",
      parentId: sourceIssueId,
      originKind: "stale_active_run_evaluation",
      originRunId,
      originFingerprint,
    }, { allowSystemOriginMetadata: true });

    const terminalRows = await db.select().from(issues).where(eq(issues.id, terminalReviewId));
    expect(firstDuplicate.id).toBe(terminalReviewId);
    expect(secondDuplicate.id).toBe(terminalReviewId);
    expect(terminalRows[0].title).toBe("Resolved stale active-run review");
    expect(terminalRows[0].description).toBe("Terminal evidence must remain stable");
    expect(terminalRows[0].status).toBe("done");
    expect(terminalRows[0].priority).toBe("high");
    expect(terminalRows[0].updatedAt.toISOString()).toBe(resolvedAt.toISOString());
    expect(terminalRows[0].completedAt?.toISOString()).toBe(resolvedAt.toISOString());

    vi.setSystemTime(new Date("2026-06-09T10:01:00.000Z"));
    const afterWindow = await svc.create(companyId, {
      title: "Fresh stale active-run review",
      description: "Outside the terminal suppression window",
      status: "todo",
      priority: "critical",
      parentId: sourceIssueId,
      originKind: "stale_active_run_evaluation",
      originRunId,
      originFingerprint,
    }, { allowSystemOriginMetadata: true });
    const reviewRows = await db
      .select()
      .from(issues)
      .where(and(
        eq(issues.companyId, companyId),
        eq(issues.originKind, "stale_active_run_evaluation"),
      ));

    expect(afterWindow.id).not.toBe(terminalReviewId);
    expect(reviewRows).toHaveLength(2);
  });

  it("does not collapse stale active-run reviews for different sources companies or fingerprints", async () => {
    const companyId = randomUUID();
    const otherCompanyId = randomUUID();
    const sourceIssueId = randomUUID();
    const otherSourceIssueId = randomUUID();
    const originRunId = randomUUID();

    await db.insert(companies).values([
      {
        id: companyId,
        name: "Paperclip",
        issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireBoardApprovalForNewAgents: false,
      },
      {
        id: otherCompanyId,
        name: "Other Paperclip",
        issuePrefix: `T${otherCompanyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireBoardApprovalForNewAgents: false,
      },
    ]);
    await db.insert(issues).values([
      {
        id: sourceIssueId,
        companyId,
        title: "Source issue",
        status: "in_progress",
        priority: "high",
      },
      {
        id: otherSourceIssueId,
        companyId,
        title: "Other source issue",
        status: "in_progress",
        priority: "high",
      },
    ]);

    const first = await svc.create(companyId, {
      title: "Review stale active run",
      status: "todo",
      priority: "high",
      parentId: sourceIssueId,
      originKind: "stale_active_run_evaluation",
      originRunId,
      originFingerprint: "fingerprint-a",
    }, { allowSystemOriginMetadata: true });
    const otherSource = await svc.create(companyId, {
      title: "Review stale active run",
      status: "todo",
      priority: "high",
      parentId: otherSourceIssueId,
      originKind: "stale_active_run_evaluation",
      originRunId,
      originFingerprint: "fingerprint-a",
    }, { allowSystemOriginMetadata: true });
    const otherFingerprint = await svc.create(companyId, {
      title: "Review stale active run",
      status: "todo",
      priority: "high",
      parentId: sourceIssueId,
      originKind: "stale_active_run_evaluation",
      originRunId,
      originFingerprint: "fingerprint-b",
    }, { allowSystemOriginMetadata: true });
    const otherCompany = await svc.create(otherCompanyId, {
      title: "Review stale active run",
      status: "todo",
      priority: "high",
      parentId: sourceIssueId,
      originKind: "stale_active_run_evaluation",
      originRunId,
      originFingerprint: "fingerprint-a",
    }, { allowSystemOriginMetadata: true });

    expect(new Set([first.id, otherSource.id, otherFingerprint.id, otherCompany.id]).size).toBe(4);
  });
});
