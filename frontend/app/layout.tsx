import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Benji UI Agent",
  description: "AI-powered browser automation interface",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
