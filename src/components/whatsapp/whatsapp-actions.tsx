"use client";

import { ExternalLink, Loader2, MessageCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { NewConversationDialog } from "@/components/inbox/new-conversation-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { waDigits, waWebUrl } from "@/lib/whatsapp/links";
import { cn } from "@/lib/utils";

/**
 * Abrir a conversa de um telefone no sistema.
 * Se já existe conversa, vai para a caixa de entrada. Se não existe, abre a janela de
 * nova conversa já preenchida; a conversa só nasce quando a primeira mensagem sai, para
 * não deixar conversas vazias na caixa de entrada.
 */
export function useOpenChat(): {
  openChat: (phone: string, name?: string | null) => Promise<void>;
  busy: boolean;
  /** Renderize em algum lugar do componente: é a janela de nova conversa. */
  dialog: ReactNode;
} {
  const t = useTranslations("WhatsAppActions");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [start, setStart] = useState<{ phone: string; name: string } | null>(
    null
  );

  const openChat = useCallback(
    async (phone: string, name?: string | null) => {
      setBusy(true);
      try {
        const res = await fetch(
          `/api/whatsapp/conversation-lookup?phone=${encodeURIComponent(phone)}`
        );
        const data = (await res.json().catch(() => ({}))) as {
          conversation_id?: string | null;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || t("lookupFailed"));
        if (data.conversation_id) {
          router.push(`/inbox?c=${data.conversation_id}`);
        } else {
          setStart({ phone, name: name ?? "" });
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("lookupFailed"));
      } finally {
        setBusy(false);
      }
    },
    [router, t]
  );

  const dialog = start ? (
    <NewConversationDialog
      key={start.phone}
      open
      onOpenChange={(o) => {
        if (!o) setStart(null);
      }}
      defaultPhone={start.phone}
      defaultName={start.name}
    />
  ) : null;

  return { openChat, busy, dialog };
}

/** Evita que o clique nos botões abra a linha, o card ou comece um arrastar. */
const stop = {
  onClick: (e: React.SyntheticEvent) => e.stopPropagation(),
  onPointerDown: (e: React.SyntheticEvent) => e.stopPropagation(),
  onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(),
};

/**
 * Atalhos de WhatsApp para um telefone: "Abrir conversa" (no sistema) e "WhatsApp Web".
 * `icons` é a versão compacta, para linhas de tabela e cards; `buttons` tem texto, para painéis.
 * Aparece para qualquer telefone: muita clínica usa WhatsApp Business em linha fixa, então não
 * dá para adivinhar pelo tipo da linha.
 */
export function WhatsAppActions({
  phone,
  name,
  text,
  variant = "icons",
  className,
}: {
  phone: string | null | undefined;
  name?: string | null;
  /** Texto que vai junto ao abrir o WhatsApp Web. */
  text?: string | null;
  variant?: "icons" | "buttons";
  className?: string;
}) {
  const t = useTranslations("WhatsAppActions");
  const { openChat, busy, dialog } = useOpenChat();

  if (!waDigits(phone)) return null;
  const webUrl = waWebUrl(phone, text);

  if (variant === "buttons") {
    return (
      <span className={cn("inline-flex flex-wrap gap-2", className)} {...stop}>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => openChat(phone as string, name)}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <MessageCircle className="size-4" aria-hidden />
          )}
          {t("chat")}
        </Button>
        <a
          href={webUrl ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ExternalLink className="size-4" aria-hidden />
          {t("web")}
        </a>
        {dialog}
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} {...stop}>
      <button
        type="button"
        title={t("chatTitle")}
        aria-label={t("chatTitle")}
        disabled={busy}
        onClick={() => openChat(phone as string, name)}
        className="text-muted-foreground hover:bg-muted hover:text-primary inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <MessageCircle className="size-4" aria-hidden />
        )}
      </button>
      <a
        href={webUrl ?? undefined}
        target="_blank"
        rel="noopener noreferrer"
        title={t("webTitle")}
        aria-label={t("webTitle")}
        className="text-muted-foreground hover:bg-muted hover:text-primary inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors"
      >
        <ExternalLink className="size-4" aria-hidden />
      </a>
      {dialog}
    </span>
  );
}
