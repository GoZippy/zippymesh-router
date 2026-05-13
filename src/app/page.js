// Auto-initialize cloud sync when server starts
import "@/lib/initCloudSync";
import { redirect } from "next/navigation";
import { getFirstRun } from "@/lib/localDb";

export default async function InitPage() {
  const firstRun = await getFirstRun();
  if (firstRun) redirect("/setup");
  redirect("/dashboard");
}
