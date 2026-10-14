"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/features/scheduling/shared/components/confirm-dialog";
import { useAction, type RunActionOptions } from "@/features/scheduling/shared/hooks/use-action";
import type { SuccessMessage, ToastableResult } from "@/features/scheduling/shared/lib/action-toast";

export interface ActionConfirm {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
}

/**
 * A button that runs one Server Action: pending state, success / error toast,
 * page refresh — and, with `confirm`, a confirmation dialog first. Covers the
 * approve / lock / delete / remove controls so each one is a few props, not a
 * transition, a message state and a `window.confirm`.
 */
export function ActionButton<R extends ToastableResult>({
  action,
  success,
  confirm,
  refresh,
  onSuccess,
  children,
  disabled,
  ...buttonProps
}: {
  action: () => Promise<R>;
  success: SuccessMessage<R>;
  confirm?: ActionConfirm;
} & RunActionOptions<R> &
  Omit<React.ComponentProps<typeof Button>, "onClick" | "type">) {
  const { run, pending } = useAction();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const fire = () => run(action, success, { refresh, onSuccess });

  return (
    <>
      <Button
        type="button"
        disabled={disabled || pending}
        onClick={confirm ? () => setConfirmOpen(true) : () => void fire()}
        {...buttonProps}
      >
        {pending ? <Spinner /> : null}
        {children}
      </Button>
      {confirm ? (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={confirm.title}
          description={confirm.description}
          confirmLabel={confirm.confirmLabel}
          destructive={confirm.destructive}
          onConfirm={fire}
        />
      ) : null}
    </>
  );
}
