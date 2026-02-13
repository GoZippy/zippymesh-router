import { startDiscoveryLoop } from "@/sse/services/discovery";

// This API route is called automatically to initialize the local orchestrator and health checks
export async function GET() {
  startDiscoveryLoop();
  return new Response("ZippyMesh Services Initialized", { status: 200 });
}
