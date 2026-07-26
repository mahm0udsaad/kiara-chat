"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, QrCode } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/inbox", label: "المحادثات", Icon: MessageSquare, adminOnly: false },
  { href: "/connect", label: "ربط واتساب", Icon: QrCode, adminOnly: true },
];

export function AppNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const items = ITEMS.filter((i) => !i.adminOnly || isAdmin);
  if (items.length < 2) return null;

  return (
    <nav className="flex items-center gap-1 px-2 pb-1.5 sm:px-3">
      {items.map(({ href, label, Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors sm:flex-none",
              active
                ? "bg-[var(--brand-soft)] text-[var(--brand)]"
                : "text-[var(--muted)] hover:bg-[var(--brand-soft)]/60 hover:text-[var(--brand)]"
            )}
          >
            <Icon size={16} aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
