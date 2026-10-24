import { PageSpinner } from "@/components/demo/Spinner";

// Route-level loading UI, for a navigation that still needs a server round trip
// (the main screens are prefetched, so it is rare). It fades in only after
// 400 ms: a quick switch shows nothing at all instead of a flashing spinner.
export default function Loading() {
  return (
    <div className="animate-fade-in-up [animation-delay:400ms]">
      <PageSpinner minh="80vh" />
    </div>
  );
}
