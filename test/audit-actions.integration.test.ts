import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";

import { createAuth, resolveSessionPrincipal } from "@/auth";
import { createPool, query } from "@/infrastructure/database";
import {
  createManagedUser,
  importAdminAlbumTemplate,
  resetManagedUserPassword,
  setAdminRevisionStatus,
  setManagedUserRole,
  setManagedUserStatus,
} from "@/modules/admin";
import {
  bootstrapAdminEmail,
  bootstrapAdminPassword,
  bootstrapInitialAdmin,
  changeOwnPassword,
} from "@/modules/identity";

import { createTestEnvironment } from "./create-test-environment";

const environment = createTestEnvironment(inject("databaseUrl"));
const pool = createPool(environment);
const auth = createAuth(environment, pool);

function cookieFrom(response: Response): string {
  const cookie = response.headers.get("set-cookie");
  if (!cookie) throw new Error("Expected a session cookie");
  return cookie.split(";", 1)[0]!;
}

async function signIn(email: string, password: string): Promise<Headers> {
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  return new Headers({ cookie: cookieFrom(response) });
}

describe("administrative audit coverage", () => {
  let adminHeaders: Headers;

  beforeAll(async () => {
    await query(`TRUNCATE "user", albums, collector_profiles CASCADE`, [], pool);
    await bootstrapInitialAdmin(pool);
    const initial = await signIn(bootstrapAdminEmail, bootstrapAdminPassword);
    await changeOwnPassword(await resolveSessionPrincipal(initial, auth, pool), bootstrapAdminPassword, "Audit-admin-1!", pool);
    adminHeaders = await signIn(bootstrapAdminEmail, "Audit-admin-1!");
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await pool.end();
  });

  it("emits data-minimized events for every sensitive admin action", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const user = await createManagedUser(await resolveSessionPrincipal(adminHeaders, auth, pool), {
      email: "audit-user@example.test",
      displayName: "Audit user",
      initialPassword: "Never-log-create-1!",
      role: "user",
    }, pool);
    await resetManagedUserPassword(await resolveSessionPrincipal(adminHeaders, auth, pool), user.id, "Never-log-reset-1!", pool);
    await setManagedUserRole(await resolveSessionPrincipal(adminHeaders, auth, pool), user.id, "admin", pool);
    await setManagedUserStatus(await resolveSessionPrincipal(adminHeaders, auth, pool), user.id, "suspended", pool);

    const revisionId = "cf5a84bf-0cb1-5b07-982a-d1b0cc8acf96";
    await importAdminAlbumTemplate(await resolveSessionPrincipal(adminHeaders, auth, pool), {
      formatVersion: 1,
      album: { id: "a3b44fe3-cf5c-5e56-981d-82cd5b728be5", slug: "audit-album", title: "Audit album" },
      revision: { id: revisionId, number: 1, label: "First", status: "published" },
      sections: [{ id: "ac3e543f-c678-5f3e-bee3-7d811faf3ace", code: "A", name: "A", sortOrder: 0 }],
      stickers: [{ stableId: "57b1230f-6cd1-52f3-86e6-ec2d04d82b6f", stableKey: "A1", sectionId: "ac3e543f-c678-5f3e-bee3-7d811faf3ace", code: "A1", label: "A1", sortOrder: 0 }],
    }, pool);
    await setAdminRevisionStatus(await resolveSessionPrincipal(adminHeaders, auth, pool), revisionId, "publish", pool);

    const events = output.mock.calls
      .map((call) => JSON.parse(String(call[0])))
      .filter((event) => event.event === "security.audit");
    expect(events.map((event) => event.audit.action)).toEqual(expect.arrayContaining([
      "account.created",
      "account.password_reset",
      "account.role_changed",
      "account.status_changed",
      "album_revision.published",
    ]));
    for (const event of events) {
      expect(event.audit.actorUserId).toEqual(expect.any(String));
      expect(event.audit.targetId).toEqual(expect.any(String));
    }
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("Never-log-create-1!");
    expect(serialized).not.toContain("Never-log-reset-1!");
    expect(serialized).not.toContain("audit-user@example.test");
  });
});
