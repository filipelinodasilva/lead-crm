// Tarefa por minuto do atendimento automático (migration 070): fila de
// saída, transferência automática e encerramento por inatividade.
// Mesmo segredo das outras rotas de cron (cabeçalho x-cron-secret).

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { runAttendanceCron } from "@/lib/attendance/automation";

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  const supplied = Buffer.from(request.headers.get("x-cron-secret") ?? "");
  const want = Buffer.from(expected);
  if (supplied.length !== want.length || !timingSafeEqual(supplied, want)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runAttendanceCron());
  } catch (err) {
    console.error("[attendance cron] failed:", err);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
