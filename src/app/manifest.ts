import type { MetadataRoute } from "next";

/**
 * What a phone reads when someone adds the app to their home screen.
 *
 * Colours are the Curbside tokens, spelled out because a manifest is JSON the
 * browser reads, not CSS Tailwind can resolve: ink `#10151f` for both the splash
 * ground and the status bar, so the app opens straight into its own header with
 * no white flash. `start_url` is the landing page rather than /announce so
 * nobody is stranded on one lane when they wanted another.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Carpool Pickup Board",
    short_name: "Pickup",
    description: "Live pickup-line status board for the school carpool queue.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#10151f",
    theme_color: "#10151f",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        // The same artwork scaled into the safe zone, so Android's circle or
        // squircle mask never crops the tiles.
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    // Long-press the home screen icon to jump straight to a lane.
    shortcuts: [
      { name: "Announce", url: "/announce" },
      { name: "Display", url: "/display" },
      { name: "Admin", url: "/admin" },
    ],
  };
}
