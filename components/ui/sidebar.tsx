import * as React from "react";

import { cn } from "@/lib/utils";

function SidebarLayout({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("min-h-screen bg-[#f7fbfa] text-zinc-950 lg:grid lg:grid-cols-[18rem_1fr]", className)} {...props} />;
}

function Sidebar({ className, ...props }: React.ComponentProps<"aside">) {
  return (
    <aside
      className={cn(
        "hidden border-r border-emerald-100 bg-white/90 px-4 py-5 shadow-[10px_0_45px_rgba(16,185,129,0.08)] backdrop-blur lg:block",
        className,
      )}
      {...props}
    />
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mb-6 flex items-center gap-3 rounded-lg bg-emerald-50 p-3", className)} {...props} />;
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-6", className)} {...props} />;
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("grid gap-2", className)} {...props} />;
}

function SidebarGroupLabel({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("px-2 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500", className)} {...props} />;
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"nav">) {
  return <nav className={cn("grid gap-1", className)} {...props} />;
}

function SidebarMenuButton({ className, ...props }: React.ComponentProps<"a">) {
  return (
    <a
      className={cn(
        "flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-semibold text-zinc-700 transition hover:bg-emerald-50 hover:text-emerald-900 data-[active=true]:bg-emerald-100 data-[active=true]:text-emerald-950",
        className,
      )}
      {...props}
    />
  );
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return <main className={cn("min-w-0 px-4 py-6 sm:px-6 lg:px-8", className)} {...props} />;
}

function MobileSidebarNav({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "sticky top-0 z-20 border-b border-emerald-100 bg-white/90 px-4 py-3 backdrop-blur lg:hidden",
        className,
      )}
      {...props}
    />
  );
}

export {
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
};
