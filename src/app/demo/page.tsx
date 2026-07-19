import { redirect } from "next/navigation";
import { DEFAULT_INSTITUTION } from "@/lib/fable/constants";

/** /demo is the un-scoped entry point. Every demo bank now belongs to an
 * institution, so send visitors to the default tenant. A provisioned
 * institution gets its own link (/demo/{institution}) in its welcome email. */
export default function DemoIndexPage() {
  redirect(`/demo/${DEFAULT_INSTITUTION}`);
}
