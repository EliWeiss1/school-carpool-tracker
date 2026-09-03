import type { Metadata } from "next";

import { AdminDashboard } from "@/components/admin/admin-dashboard";

export const metadata: Metadata = {
  title: "Admin — Carpool Pickup Board",
};

/**
 * The office screen: roster CRUD, CSV import, and the morning reset.
 *
 * A server component in name only -- everything here needs the staff PIN
 * session and browser `fetch`, so the actual page is `AdminDashboard`, a
 * client component. Keeping this file itself tiny is what lets it carry
 * page-level metadata without dragging `"use client"` onto the route export.
 */
export default function AdminPage() {
  return <AdminDashboard />;
}
