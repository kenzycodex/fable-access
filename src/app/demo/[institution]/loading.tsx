import { PageSpinner } from "@/components/demo/Spinner";

// Route-level loading UI. Next shows this the moment a navigation starts and a
// server round-trip is needed, so moving between screens shows a smooth brand
// spinner instead of a frozen page or a wall of "Loading…" text.
export default function Loading() {
  return <PageSpinner minh="80vh" />;
}
