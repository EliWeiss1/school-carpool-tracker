import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { PwaRegister } from "@/components/pwa-register";
import "./globals.css";

/**
 * Three faces, three jobs.
 *
 * Archivo is a road-signage grotesque — it is what the display type wants to be
 * on a board read from across a room. Plex Sans is the reading face: humanist,
 * engineered, and legible at 16px on a phone held at arm's length in daylight.
 * Plex Mono is reserved for things that line up in columns — classes, device
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
  title: "CarpoolCaller",
  description: "Live pickup-line status board for the school carpool queue.",
  // iOS ignores most of the web manifest, so the home screen icon and the
  // full-screen launch are declared here as well.
  icons: {
    icon: { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    apple: { url: "/icons/apple-touch-icon.png", sizes: "180x180" },
  },
  appleWebApp: {
    capable: true,
    title: "CarpoolCaller",
    statusBarStyle: "black",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // Android Chrome (and the installed PWA) otherwise keeps the layout at
  // full height when the keyboard opens and scrolls the whole page up to
  // reveal the input, pushing /announce's header and the top of its
  // suggestions off screen. With this, `dvh` shrinks to the space above the
  // keyboard and the flex layout reflows instead. iOS Safari ignores it;
  // `use-keyboard-box.ts` covers iOS.
  interactiveWidget: "resizes-content",
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
      <body className="min-h-full">
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
