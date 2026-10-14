"use client";

import { ToastContainer } from "react-toastify";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Client providers for every `/schedule/*` page: the shared tooltip delay
 * group and the toast outlet the Server Action helpers post to. Mounted once
 * by the schedule layout. If a toast container is later added to the app
 * shell, remove this one so messages don't show twice.
 */
export function ScheduleProviders({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      {children}
      <ToastContainer
        position="bottom-right"
        autoClose={2500}
        limit={4}
        newestOnTop
        closeOnClick
        pauseOnHover
        draggable={false}
        theme="light"
      />
    </TooltipProvider>
  );
}
