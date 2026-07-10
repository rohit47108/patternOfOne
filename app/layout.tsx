import type { Metadata, Viewport } from "next";
import "@fontsource-variable/manrope";
import "@fontsource-variable/newsreader";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pattern of One — A living portrait",
  description: "A portrait of how you move, speak, pause, and change.",
  applicationName: "Pattern of One",
  openGraph: {
    title: "Pattern of One",
    description: "A portrait of how you move, speak, pause, and change.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Pattern of One",
    description: "A portrait of how you move, speak, pause, and change.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#080907",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
