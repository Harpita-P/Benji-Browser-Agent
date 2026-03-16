import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Benji AI Agent",
  description: "AI teammate for the interface layer",
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
