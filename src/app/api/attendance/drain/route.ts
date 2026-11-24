// POST /api/attendance/drain — chamado pela tela logo depois de assumir,
// transferir ou encerrar, para a mensagem automática sair na hora em vez
// de esperar o cron. Só envia a fila da conta de quem chamou.

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { drainOutbox } from "@/lib/attendance/automation";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export async function POST() {
  try {
    const ctx = await getCurrentAccount();
    const limit = checkRateLimit(`attendance-drain:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);
    return NextResponse.json({ sent: await drainOutbox(ctx.accountId) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
