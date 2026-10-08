import { redirect } from "next/navigation";

// Alerts became the Review queue: the same flagged and blocked transfers, but
// as cases someone can take, decide and close. Old links and bookmarks land there.
export default function AlertsPage() {
  redirect("/dashboard/review");
}
