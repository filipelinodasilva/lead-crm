// Guard for the SaaS operator panel (/admin). Only users listed in
// `platform_admins` (migration 067) pass; data is then read/written with
// the service-role client because the panel spans every account.

import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/lib/flows/admin-client";
import { ForbiddenError, getCurrentAccount, isPlatformAdmin } from "./account";

export async function requirePlatformAdmin(): Promise<{
  userId: string;
  admin: SupabaseClient;
}> {
  const ctx = await getCurrentAccount();
  if (!(await isPlatformAdmin(ctx.supabase, ctx.userId))) {
    throw new ForbiddenError();
  }
  return { userId: ctx.userId, admin: supabaseAdmin() };
}
