import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TASI Action Cockpit",
  description: "Private, decision-first TASI trading workspace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
