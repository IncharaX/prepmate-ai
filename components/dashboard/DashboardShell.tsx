import Link from "next/link";
import { ClipboardList, FolderOpen, LayoutDashboard, Sparkles } from "lucide-react";

import {
  MobileSidebarNav,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarLayout,
  SidebarMenu,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";

import { UserMenu } from "./UserMenu";

type NavKey = "dashboard" | "library" | "interview";

export function DashboardShell({
  user,
  active = "dashboard",
  children,
}: {
  user: { name?: string | null; email?: string | null };
  active?: NavKey;
  children: React.ReactNode;
}) {
  return (
    <SidebarLayout>
      <Sidebar>
        <SidebarHeader>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">PrepMate AI</p>
            <p className="text-xs text-muted-foreground">Interview coach</p>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuButton href="/dashboard" data-active={active === "dashboard"}>
                <LayoutDashboard className="h-4 w-4" />
                Dashboard
              </SidebarMenuButton>
              <SidebarMenuButton href="/dashboard/library" data-active={active === "library"}>
                <FolderOpen className="h-4 w-4" />
                Library
              </SidebarMenuButton>
              <SidebarMenuButton href="/interview/new" data-active={active === "interview"}>
                <ClipboardList className="h-4 w-4" />
                New interview
              </SidebarMenuButton>
            </SidebarMenu>
          </SidebarGroup>
          <div className="mt-auto grid gap-3 rounded-lg border border-border bg-card p-4">
            <p className="text-sm font-medium text-foreground">Tip</p>
            <p className="text-xs leading-5 text-muted-foreground">
              Paste the actual JD, not a summary. Maya tailors every question to the role, seniority, and
              stack it describes.
            </p>
          </div>
        </SidebarContent>
      </Sidebar>

      <div className="min-w-0">
        <MobileSidebarNav>
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <Link href="/dashboard" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">PrepMate AI</p>
              </div>
            </Link>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <UserMenu user={user} />
            </div>
          </div>
        </MobileSidebarNav>

        <SidebarInset>
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
            <div className="hidden items-center justify-end gap-1 lg:flex">
              <ThemeToggle />
              <UserMenu user={user} />
            </div>
            {children}
          </div>
        </SidebarInset>
      </div>
    </SidebarLayout>
  );
}
