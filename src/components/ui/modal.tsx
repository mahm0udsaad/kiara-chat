"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Compatibility wrapper for older feature panels. Keeping the small API lets
 * every existing caller inherit shadcn/Radix focus trapping, Escape handling,
 * scroll locking, and accessible title semantics without a disruptive rewrite.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  contentClassName,
  mobileBottomSheet = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  contentClassName?: string;
  mobileBottomSheet?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        className={cn(
          "safe-b max-h-[90dvh] overscroll-contain overflow-y-auto sm:max-w-md",
          mobileBottomSheet &&
            "max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:start-0 max-sm:end-0 max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:border-x-0 max-sm:border-b-0 max-sm:data-open:slide-in-from-bottom-10 max-sm:data-closed:slide-out-to-bottom-10 max-sm:rtl:translate-x-0",
          contentClassName
        )}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <div>{children}</div>
      </DialogContent>
    </Dialog>
  );
}
