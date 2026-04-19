import * as React from "react";

import { cn } from "@/lib/utils";

function Alert({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800", className)} {...props} />;
}

export { Alert };
