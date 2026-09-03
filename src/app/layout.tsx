import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

/**
 * Three faces, three jobs.
 *
 * Archivo is a road-signage grotesque — it is what the display type wants to be
 * on a board read from across a room. Plex Sans is the reading face: humanist,
 * engineered, and legible at 16px on a phone held at arm's length in daylight.
 * Plex Mono is reserved for things that line up in columns — grades, device
 * ids, CSV row numbers, timestamps.
 */
const display = Archivo({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

const body = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Carpool Pickup Board",
  description: "Live pickup-line status board for the school carpool queue.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#10151f",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
