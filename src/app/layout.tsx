import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kiara Chat",
  description: "منصة خدمة عملاء واتساب لكيّارا",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
