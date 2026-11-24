// GET /api/admin/accounts: every account with owner e-mail, for the
// platform admin panel.

import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/auth/account";
import { requirePlatformAdmin } from "@/lib/auth/platform-admin";

export async function GET() {
  try {
    const { admin } = await requirePlatformAdmin();
    const [{ data: accounts, error }, { data: profiles }] = await Promise.all([
      admin
        .from("accounts")
        .select("id, name, status, trial_ends_at, parent_account_id, owner_user_id, created_at")
        .order("created_at", { ascending: false }),
      admin.from("profiles").select("user_id, email, account_id"),
    ]);
    if (error) throw error;

    const emailByUser = new Map((profiles ?? []).map((p) => [p.user_id, p.email]));
    const membersByAccount = new Map<string, number>();
    for (const p of profiles ?? []) {
      membersByAccount.set(p.account_id, (membersByAccount.get(p.account_id) ?? 0) + 1);
    }
    const nameById = new Map((accounts ?? []).map((a) => [a.id, a.name]));

    return NextResponse.json({
      accounts: (accounts ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status,
        trial_ends_at: a.trial_ends_at,
        created_at: a.created_at,
        parent_name: a.parent_account_id ? (nameById.get(a.parent_account_id) ?? null) : null,
        owner_email: emailByUser.get(a.owner_user_id) ?? null,
        members: membersByAccount.get(a.id) ?? 0,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
