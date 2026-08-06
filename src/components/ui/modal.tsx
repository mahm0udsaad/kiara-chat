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
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  contentClassName?: string;
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
