"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, QrCode, Users, BarChart3, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/inbox", label: "المحادثات", Icon: MessageSquare, adminOnly: false },
  { href: "/reports", label: "التقارير", Icon: BarChart3, adminOnly: true },
  { href: "/team", label: "الموظفون", Icon: Users, adminOnly: true },
  { href: "/connect", label: "ربط واتساب", Icon: QrCode, adminOnly: true },
  { href: "/settings", label: "الإعدادات", Icon: Settings, adminOnly: true },
];

export function AppNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const items = ITEMS.filter((i) => !i.adminOnly || isAdmin);
  if (items.length < 2) return null;

  return (
    // Scrolls rather than squeezing — four labels don't fit a 375px row.
    <nav className="scroll-pane flex items-center gap-1 overflow-x-auto px-2 pb-1.5 sm:px-3 [&::-webkit-scrollbar]:hidden">
      {items.map(({ href, label, Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors",
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
