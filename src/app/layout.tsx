import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "FieldMark — drawings, markups and commissioning", template: "%s · FieldMark" },
  description:
    "Search every word on every sheet, mark up issues and redlines, and run point-to-point commissioning packages — in the browser, on site or at the desk.",
  appleWebApp: { title: "FieldMark", capable: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-white font-sans text-slate-900 dark:bg-slate-950 dark:text-slate-100">{children}</body>
    </html>
  );
}
