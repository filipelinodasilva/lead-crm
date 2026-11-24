"use client";

// Documentação em formato wiki: tópicos à esquerda, regras de negócio e
// tutoriais à direita. Conteúdo em src/content/docs/pt.ts.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { BookOpen } from "lucide-react";

import { DOCS } from "@/content/docs/pt";
import { cn } from "@/lib/utils";

export default function DocsPage() {
  const t = useTranslations("Docs");
  const [activeId, setActiveId] = useState(DOCS[0].id);
  const topic = DOCS.find((d) => d.id === activeId) ?? DOCS[0];

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
      <nav aria-label={t("topics")} className="rounded-lg border border-border bg-card p-2">
        <p className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("topics")}
        </p>
        <ul className="flex flex-col gap-0.5">
          {DOCS.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => setActiveId(d.id)}
                className={cn(
                  "w-full rounded-md px-3 py-2 text-left text-sm transition-colors",
                  d.id === activeId
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {d.title}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <article className="min-w-0 rounded-lg border border-border bg-card p-6">
        <div className="mb-6 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-foreground">{topic.title}</h2>
            <p className="text-sm text-muted-foreground">{topic.summary}</p>
          </div>
        </div>
        <div className="space-y-6">
          {topic.sections.map((s) => (
            <section key={s.heading}>
              <h3 className="mb-2 text-base font-semibold text-foreground">{s.heading}</h3>
              {s.body.map((p, i) => (
                <p key={i} className="mb-2 text-sm leading-relaxed text-muted-foreground">
                  {p}
                </p>
              ))}
              {s.steps ? (
                <ol className="ml-5 list-decimal space-y-1 text-sm text-foreground">
                  {s.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              ) : null}
            </section>
          ))}
        </div>
      </article>
    </div>
  );
}
