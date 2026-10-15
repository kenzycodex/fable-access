import { redirect } from "next/navigation";

/** The page was renamed to Secrets; old links and emails land there. */
export default function IntegrationsRedirect() {
  redirect("/operator/secrets");
}
