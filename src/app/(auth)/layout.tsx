import { Target } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

// Shared metadata for auth pages (login / signup / forgot-password).
// None of these should be indexed — they'd compete with the marketing
// landing in SERPs and offer nothing to a searcher who hasn't already
// signed up. Each page still gets its own <title> via its own
// metadata.title override below the route group layout.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

// Two columns on large screens: a brand panel on the left, the page's own
// form on the right. On phones only the form shows.
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("AuthBrand");
  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-2">
      <aside
        aria-hidden
        className="relative hidden overflow-hidden border-r border-border lg:flex lg:flex-col lg:justify-between lg:p-12"
        style={{
          background:
            "radial-gradient(120% 80% at 20% 110%, color-mix(in oklch, var(--primary) 55%, transparent), transparent 60%), radial-gradient(60% 40% at 80% 0%, color-mix(in oklch, var(--primary) 18%, transparent), transparent 70%)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Target className="h-7 w-7" />
          </div>
          <span className="text-2xl font-semibold text-foreground">
            {t("name")}
          </span>
        </div>

        <div className="max-w-md space-y-4">
          <h2 className="text-4xl leading-tight font-semibold text-foreground">
            {t("headline")}
          </h2>
          <p className="text-base text-muted-foreground">{t("subtitle")}</p>
          <ul className="space-y-2 pt-2 text-sm text-foreground/90">
            <li>{t("point1")}</li>
            <li>{t("point2")}</li>
            <li>{t("point3")}</li>
          </ul>
        </div>

        <p className="text-xs text-muted-foreground">{t("footer")}</p>
      </aside>
      <main className="flex items-center justify-center">{children}</main>
    </div>
  );
}
