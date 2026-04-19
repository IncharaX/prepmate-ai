import * as React from "react";

import { cn } from "@/lib/utils";

function SidebarLayout({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[17rem_1fr]",
        className,
      )}
      {...props}
    />
  );
}

function Sidebar({ className, ...props }: React.ComponentProps<"aside">) {
  return (
    <aside
      className={cn(
        "hidden border-r border-sidebar-border bg-sidebar px-4 py-5 lg:flex lg:flex-col lg:gap-6",
        className,
      )}
      {...props}
    />
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center gap-3 px-2", className)}
      {...props}
    />
  );
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-1 flex-col gap-6", className)} {...props} />;
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("grid gap-2", className)} {...props} />;
}

function SidebarGroupLabel({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "px-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"nav">) {
  return <nav className={cn("grid gap-1", className)} {...props} />;
}

function SidebarMenuButton({ className, ...props }: React.ComponentProps<"a">) {
  return (
    <a
      className={cn(
        "flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
        className,
      )}
      {...props}
    />
  );
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      className={cn("min-w-0 px-4 py-6 sm:px-6 lg:px-8", className)}
      {...props}
    />
  );
}

function MobileSidebarNav({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "sticky top-0 z-20 border-b border-sidebar-border bg-sidebar/90 px-4 py-3 backdrop-blur lg:hidden",
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
