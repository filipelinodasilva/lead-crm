// PATCH /api/admin/accounts/[id]: manual block / unblock / extend trial.
// Body: { action: "activate" | "block" | "extend_trial" }

import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/auth/account";
import { requirePlatformAdmin } from "@/lib/auth/platform-admin";

const ACTIONS = ["activate", "block", "extend_trial"] as const;
type Action = (typeof ACTIONS)[number];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { admin } = await requirePlatformAdmin();
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
    const action = body?.action;
    if (!ACTIONS.includes(action as Action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const patch: Record<string, string> =
      action === "activate"
        ? { status: "active" }
        : action === "block"
          ? { status: "blocked" }
          : {
              status: "trial",
              trial_ends_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
            };

    const { data, error } = await admin
      .from("accounts")
      .update(patch)
      .eq("id", id)
      .select("id, status, trial_ends_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ account: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
