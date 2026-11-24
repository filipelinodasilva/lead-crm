// ============================================================
// POST /api/auth/cadastro-convite
//
// Cadastro com o cadastro público FECHADO (padrão do Lead CRM).
// O Supabase fica com DISABLE_SIGNUP=true, então ninguém cria
// conta sozinho. Quem recebeu um convite válido da equipe chega
// aqui pela tela /signup?invite=<token>: o servidor confere o
// convite e cria o usuário com a chave de serviço. Depois o
// navegador entra com e-mail e senha e resgata o convite em
// /join/<token>, como no fluxo normal.
//
// Com NEXT_PUBLIC_SIGNUP_OPEN=true esta rota não é usada: o
// cadastro segue direto pelo Supabase.
// ============================================================

import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { hashInviteToken } from '@/lib/auth/invitations';
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { createClient } from '@/lib/supabase/server';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`cadastro-convite:${ip}`, RATE_LIMITS.invitationPeek);
  if (!limit.success) return rateLimitResponse(limit);

  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
    password?: unknown;
    fullName?: unknown;
    invite?: unknown;
  } | null;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const fullName = typeof body?.fullName === 'string' ? body.fullName.trim().slice(0, 120) : '';
  const invite = typeof body?.invite === 'string' ? body.invite : '';

  if (!invite) {
    return NextResponse.json({ error: 'O cadastro está fechado. Peça um convite ao administrador.' }, { status: 403 });
  }
  if (!EMAIL.test(email) || password.length < 6) {
    return NextResponse.json({ error: 'Informe um e-mail válido e uma senha com pelo menos 6 caracteres.' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: peek, error: peekError } = await supabase.rpc('peek_invitation', {
    p_token_hash: hashInviteToken(invite),
  });
  if (peekError) {
    console.error('[cadastro-convite] peek error:', peekError);
    return NextResponse.json({ error: 'Não foi possível conferir o convite. Tente de novo.' }, { status: 500 });
  }
  if (!(peek as { ok?: boolean } | null)?.ok) {
    return NextResponse.json({ error: 'Convite inválido, usado ou vencido. Peça um novo ao administrador.' }, { status: 403 });
  }

  const { error } = await supabaseAdmin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) {
    const jaExiste = /already|registered|exists/i.test(error.message);
    return NextResponse.json(
      { error: jaExiste ? 'Este e-mail já tem conta. Entre pela tela de login.' : 'Não foi possível criar a conta.' },
      { status: jaExiste ? 409 : 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
