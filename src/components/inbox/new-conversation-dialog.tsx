"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, MessageSquarePlus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWhatsAppConnections } from "@/hooks/use-whatsapp-connections";

/**
 * Botão "Nova conversa": começa um papo com qualquer número enviando texto livre, sem modelo.
 * Só aparece quando o WhatsApp está conectado por QR code, porque na API oficial da Meta a
 * primeira mensagem precisa de modelo aprovado.
 */
export function NewConversationButton({ onCreated }: { onCreated?: (conversationId: string) => void }) {
  const t = useTranslations("NewConversation");
  const { connections } = useWhatsAppConnections();
  const [open, setOpen] = useState(false);

  // Só conexões por QR code aceitam a primeira mensagem sem modelo.
  if (!connections.some((c) => c.provider === "evolution")) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 w-full justify-center gap-1.5 text-xs"
        onClick={() => setOpen(true)}
      >
        <MessageSquarePlus className="h-3.5 w-3.5" />
        {t("button")}
      </Button>
      <NewConversationDialog open={open} onOpenChange={setOpen} onCreated={onCreated} />
    </>
  );
}

/**
 * Janela de nova conversa. Controlada por quem a usa e com campos de partida, para abrir
 * já preenchida (por exemplo, a partir de um lead ou de um contato sem conversa ainda).
 * Os campos começam com os valores `default*` quando o componente é montado.
 */
export function NewConversationDialog({
  open,
  onOpenChange,
  defaultPhone = "",
  defaultName = "",
  defaultText = "",
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultPhone?: string;
  defaultName?: string;
  defaultText?: string;
  onCreated?: (conversationId: string) => void;
}) {
  const t = useTranslations("NewConversation");
  const router = useRouter();
  const { connections } = useWhatsAppConnections();
  const qrConnections = connections.filter((c) => c.provider === "evolution");
  const [connectionId, setConnectionId] = useState<string>("");
  const [phone, setPhone] = useState(defaultPhone);
  const [name, setName] = useState(defaultName);
  const [text, setText] = useState(defaultText);
  const [sending, setSending] = useState(false);

  const chosenId =
    connectionId && qrConnections.some((c) => c.id === connectionId)
      ? connectionId
      : (qrConnections.find((c) => c.is_default) ?? qrConnections[0])?.id ?? "";

  const submit = async () => {
    if (sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/whatsapp/new-conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, name, text, connection_id: chosenId || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t("errorGeneric"));
      toast.success(t("sent"));
      onOpenChange(false);
      setPhone("");
      setName("");
      setText("");
      if (onCreated) onCreated(data.conversation_id);
      router.push(`/inbox?c=${data.conversation_id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("errorGeneric"));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !sending && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {qrConnections.length > 1 ? (
            <div className="space-y-1.5">
              <Label htmlFor="nc-connection">{t("connectionLabel")}</Label>
              <select
                id="nc-connection"
                value={chosenId}
                onChange={(e) => setConnectionId(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
              >
                {qrConnections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || t("connectionFallback")}
                    {c.status === "connected" ? "" : ` (${t("disconnected")})`}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="nc-phone">{t("phoneLabel")}</Label>
            <Input
              id="nc-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t("phonePlaceholder")}
              inputMode="tel"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">{t("phoneHint")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nc-name">{t("nameLabel")}</Label>
            <Input id="nc-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nc-text">{t("messageLabel")}</Label>
            <Textarea
              id="nc-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder={t("messagePlaceholder")}
            />
          </div>
          <p className="text-xs text-muted-foreground">{t("riskHint")}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            {t("cancel")}
          </Button>
          <Button onClick={submit} disabled={sending || !phone.trim() || !text.trim()}>
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t("send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
