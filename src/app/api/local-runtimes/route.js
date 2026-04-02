import { NextResponse } from "next/server";

const LOCAL_RUNTIMES = [
  { id: "ollama", name: "Ollama", type: "local", description: "Local models via Ollama" },
  { id: "lmstudio", name: "LM Studio", type: "local", description: "Local models via LM Studio" },
  { id: "llamacpp", name: "llama.cpp", type: "local", description: "Local models via llama.cpp" },
  { id: "kilo_local", name: "Kilo (Local)", type: "local", description: "Kilo AI local models" },
  { id: "cursor_local", name: "Cursor (Local)", type: "local", description: "Cursor IDE local inference" },
];

export async function GET() {
  return NextResponse.json({ runtimes: LOCAL_RUNTIMES });
}
