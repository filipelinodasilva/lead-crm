"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import { useSidebarCollapse } from "@/components/layout/sidebar-context";
import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  Building2,
  Crown,
  GitBranch,
  Headset,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  MapPin,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Search,
  Send,
  Settings,
  Shield,
  User,
  UserCog,
  Users,
  UsersRound,
  Workflow,
  X,
  Zap,
  Target,
} from "lucide-react";
import type { AccountRole } from "@/lib/auth/roles";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslations } from "next-intl";

const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; labelKey: string; className: string }
> = {
  owner: {
    icon: Crown,
    labelKey: "roleOwner",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  },
  admin: {
    icon: Shield,
    labelKey: "roleAdmin",
    className: "border-primary/40 bg-primary/10 text-primary",
  },
  agent: {
    icon: UserCog,
    labelKey: "roleAgent",
    className: "border-border bg-muted text-foreground",
  },
  viewer: {
    icon: User,
    labelKey: "roleViewer",
    className: "border-border bg-card text-muted-foreground",
  },
};

interface NavItem {
  href: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  beta?: boolean;
  exact?: boolean;
}

interface NavSection {
  titleKey: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    titleKey: "groupProspecting",
    items: [
      { href: "/prospecting", labelKey: "prospectSearch", icon: Search, exact: true },
      { href: "/pipelines", labelKey: "funnel", icon: GitBranch },
      { href: "/prospecting/campaigns", labelKey: "prospectCampaigns", icon: Send },
      { href: "/prospecting/ranking", labelKey: "prospectRanking", icon: MapPin },
    ],
  },
  {
    titleKey: "groupCrm",
    items: [
      { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
      { href: "/inbox", labelKey: "inbox", icon: MessageSquare },
      { href: "/settings?tab=attendance", labelKey: "queuesTeams", icon: Headset },
      { href: "/atendimento", labelKey: "attendanceReport", icon: BarChart3 },
      { href: "/notifications", labelKey: "notifications", icon: Bell },
      { href: "/contacts", labelKey: "contacts", icon: Users },
      { href: "/broadcasts", labelKey: "broadcasts", icon: Radio },
      { href: "/automations", labelKey: "automations", icon: Zap },
      { href: "/flows", labelKey: "flows", icon: Workflow, beta: true },
      { href: "/agents", labelKey: "aiAgents", icon: Bot },
    ],
  },
];

const bottomNavItems = [
  { href: "/subcontas", labelKey: "subaccounts", icon: Building2 },
  { href: "/docs", labelKey: "docs", icon: BookOpen },
  { href: "/settings", labelKey: "settings", icon: Settings },
];

const adminNavItem = { href: "/admin", labelKey: "admin", icon: Shield };

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const t = useTranslations("Sidebar");
  const pathname = usePathname();
  const { collapsed, toggleCollapsed } = useSidebarCollapse();
  const {
    profile,
    profileLoading,
    account,
    accountRole,
    signOut,
    inSubaccount,
    isPlatformAdmin,
    switchAccount,
  } = useAuth();
  const totalUnread = useTotalUnread();
  const unreadNotifications = useUnreadNotifications();

  const showAccountStrip =
    !profileLoading &&
    !!account?.name &&
    (inSubaccount || account.name !== profile?.full_name);

  useEffect(() => {
    onClose?.();
  }, [pathname, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <TooltipProvider delay={100}>
      {/* Backdrop mobile */}
      <button
        type="button"
        aria-label={t("closeMenu")}
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-background/70 backdrop-blur-sm transition-opacity lg:hidden",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          // Mobile: drawer com slide
          "fixed inset-y-0 left-0 z-40 flex h-full flex-col border-r border-border bg-card",
          "transition-all duration-200 ease-out will-change-transform",
          open ? "translate-x-0 w-64" : "-translate-x-full w-64",
          // Desktop: static, com suporte a modo recolhido (mini-rail)
          "lg:static lg:z-0 lg:translate-x-0",
          collapsed ? "lg:w-16" : "lg:w-60",
        )}
        aria-label={t("primaryNav")}
      >
        {/* Header da Sidebar */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-3">
          {collapsed ? (
            <Link
              href="/dashboard"
              title="Lead CRM"
              className="mx-auto flex items-center justify-center"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
                <Target className="h-4 w-4" />
              </div>
            </Link>
          ) : (
            <>
              <Link href="/dashboard" className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Target className="h-4 w-4" />
                </div>
                <span className="text-sm font-semibold text-foreground">
                  {t("title")}
                </span>
              </Link>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={toggleCollapsed}
                  title={t("collapseSidebar")}
                  aria-label={t("collapseSidebar")}
                  className="hidden h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:flex"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={t("closeMenu")}
                  className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </>
          )}
        </div>

        {/* Navegação Principal */}
        <nav className="flex-1 overflow-y-auto px-2 py-3 lg:px-2">
          {navSections.map((section, si) => (
            <div key={section.titleKey} className={si > 0 ? "mt-4" : undefined}>
              {collapsed ? (
                si > 0 && <div className="mx-1 my-2 border-t border-border/60" />
              ) : (
                <p className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                  {t(section.titleKey as string)}
                </p>
              )}
              <ul className="flex flex-col gap-1">
                {section.items.map((item) => {
                  const isActive = item.exact
                    ? pathname === item.href
                    : pathname === item.href ||
                      (item.href !== "/dashboard" && pathname.startsWith(item.href));

                  const showUnreadDot =
                    item.href === "/inbox" && totalUnread > 0 && !isActive;

                  const showNotificationBadge =
                    item.href === "/notifications" && unreadNotifications > 0;

                  if (collapsed) {
                    return (
                      <li key={item.href} className="flex justify-center">
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Link
                                href={item.href}
                                className={cn(
                                  "relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                                  isActive
                                    ? "bg-primary/10 text-primary"
                                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                )}
                              >
                                <item.icon className="h-4 w-4 shrink-0" />
                                {showUnreadDot && (
                                  <span className="absolute right-2 top-2 flex h-2 w-2">
                                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                                    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                                  </span>
                                )}
                                {showNotificationBadge && (
                                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                                    {unreadNotifications > 9 ? "9+" : unreadNotifications}
                                  </span>
                                )}
                              </Link>
                            }
                          />
                          <TooltipContent side="right" sideOffset={12}>
                            <div className="flex items-center gap-1.5">
                              <span>{t(item.labelKey as string)}</span>
                              {item.beta && (
                                <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1 py-0.2 text-[8px] font-semibold uppercase tracking-wider text-amber-300">
                                  {t("beta")}
                                </span>
                              )}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </li>
                    );
                  }

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2",
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        <item.icon className="h-4 w-4 shrink-0" />
                        <span className="flex-1 truncate">{t(item.labelKey as string)}</span>
                        {item.beta && (
                          <span
                            aria-label={t("beta")}
                            className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300"
                          >
                            {t("beta")}
                          </span>
                        )}
                        {showUnreadDot && (
                          <span
                            aria-label={t("unreadConversations", { count: totalUnread })}
                            className="relative flex h-2 w-2"
                          >
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                          </span>
                        )}
                        {showNotificationBadge && (
                          <span
                            aria-label={t("unreadNotifications", { count: unreadNotifications })}
                            className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
                          >
                            {unreadNotifications > 9 ? "9+" : unreadNotifications}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          <div className="my-3 border-t border-border" />

          <ul className="flex flex-col gap-1">
            {(isPlatformAdmin ? [adminNavItem, ...bottomNavItems] : bottomNavItems).map((item) => {
              const isActive = pathname.startsWith(item.href);

              if (collapsed) {
                return (
                  <li key={item.href} className="flex justify-center">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Link
                            href={item.href}
                            className={cn(
                              "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                              isActive
                                ? "bg-primary/10 text-primary"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}
                          >
                            <item.icon className="h-4 w-4 shrink-0" />
                          </Link>
                        }
                      />
                      <TooltipContent side="right" sideOffset={12}>
                        {t(item.labelKey as string)}
                      </TooltipContent>
                    </Tooltip>
                  </li>
                );
              }

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{t(item.labelKey as string)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Seção inferior / Usuário */}
        <div className="shrink-0 border-t border-border p-2">
          {inSubaccount ? (
            collapsed ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      onClick={() => switchAccount(null)}
                      className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-lg border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                    >
                      <ArrowLeftRight className="size-3.5 shrink-0" />
                    </button>
                  }
                />
                <TooltipContent side="right" sideOffset={12}>
                  {t("backToHome")}
                </TooltipContent>
              </Tooltip>
            ) : (
              <button
                type="button"
                onClick={() => switchAccount(null)}
                className="mb-2 flex w-full items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/20"
              >
                <ArrowLeftRight className="size-3.5 shrink-0" />
                {t("backToHome")}
              </button>
            )
          ) : null}

          {!collapsed && showAccountStrip && account?.name ? (
            <div className="mb-2 flex items-center gap-2 px-3 text-xs text-muted-foreground">
              <UsersRound className="size-3.5 shrink-0" />
              <span className="truncate" title={account.name}>
                {account.name}
              </span>
              {accountRole ? (
                (() => {
                  const meta = ROLE_CHIP[accountRole];
                  const Icon = meta.icon;
                  return (
                    <span
                      className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${meta.className}`}
                    >
                      <Icon className="size-3" />
                      {t(meta.labelKey as string)}
                    </span>
                  );
                })()
              ) : null}
            </div>
          ) : null}

          <DropdownMenu>
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <DropdownMenuTrigger className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-muted/60 focus:bg-muted/60 focus:outline-none">
                      <Avatar className="size-8 shrink-0">
                        {profile?.avatar_url ? (
                          <AvatarImage
                            src={profile.avatar_url}
                            alt={profile.full_name ?? t("defaultAvatar")}
                          />
                        ) : null}
                        <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                          {profile?.full_name?.charAt(0)?.toUpperCase() ??
                            profile?.email?.charAt(0)?.toUpperCase() ??
                            "U"}
                        </AvatarFallback>
                      </Avatar>
                    </DropdownMenuTrigger>
                  }
                />
                <TooltipContent side="right" sideOffset={12}>
                  <p className="font-medium">{profile?.full_name ?? t("defaultUser")}</p>
                  <p className="text-[10px] text-muted-foreground">{profile?.email ?? ""}</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/60 focus:bg-muted/60 focus:outline-none data-popup-open:bg-muted/60">
                <Avatar className="size-8 shrink-0">
                  {profile?.avatar_url ? (
                    <AvatarImage
                      src={profile.avatar_url}
                      alt={profile.full_name ?? t("defaultAvatar")}
                    />
                  ) : null}
                  <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                    {profile?.full_name?.charAt(0)?.toUpperCase() ??
                      profile?.email?.charAt(0)?.toUpperCase() ??
                      "U"}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {profile?.full_name ?? t("defaultUser")}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {profile?.email ?? ""}
                  </p>
                </div>
              </DropdownMenuTrigger>
            )}

            <DropdownMenuContent
              align={collapsed ? "center" : "end"}
              side={collapsed ? "right" : "top"}
              sideOffset={8}
              className="min-w-56 bg-popover text-popover-foreground ring-border"
            >
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=profile"
                    onClick={onClose}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <User className="size-4" />
                {t("menuProfile")}
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=whatsapp"
                    onClick={onClose}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <Settings className="size-4" />
                {t("menuSettings")}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                onClick={signOut}
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              >
                <LogOut className="size-4" />
                {t("menuSignOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Botão de expandir no modo recolhido desktop */}
          {collapsed && (
            <div className="mt-2 hidden justify-center lg:flex">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      onClick={toggleCollapsed}
                      aria-label={t("expandSidebar")}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <PanelLeftOpen className="h-4 w-4" />
                    </button>
                  }
                />
                <TooltipContent side="right" sideOffset={12}>
                  {t("expandSidebar")}
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}
