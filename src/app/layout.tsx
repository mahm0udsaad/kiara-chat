import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

// globals.css already referenced these variables but nothing defined them, so
// every screen — Arabic included — was falling back to Arial.
const notoSansArabic = Noto_Sans_Arabic({
  subsets: ["arabic"],
  variable: "--font-noto-sans-arabic",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Kiara Chat",
  description: "منصة خدمة عملاء واتساب لكيّارا",
  // Lets agents add the inbox to their home screen and open it chromeless.
  appleWebApp: { capable: true, title: "Kiara Chat", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Paint under the notch; padding is restored per-edge via
  // env(safe-area-inset-*). Zoom is deliberately left enabled.
  viewportFit: "cover",
  themeColor: "#ffffff",
  // Shrink the layout viewport when the on-screen keyboard opens, so a
  // bottom-anchored composer stays above it instead of being covered.
  // Android honours this; iOS is handled by the visual-viewport hook.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={cn(notoSansArabic.variable, inter.variable, "font-sans")}
    >
      <body>{children}</body>
    </html>
  );
}
