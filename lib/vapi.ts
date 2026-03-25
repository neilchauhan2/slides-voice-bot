"use client";

import type Vapi from "@vapi-ai/web";

let vapiInstance: Vapi | null = null;

export async function getVapiClient(): Promise<Vapi> {
  if (vapiInstance) {
    return vapiInstance;
  }

  const publicKey = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
  if (!publicKey) {
    throw new Error("Missing NEXT_PUBLIC_VAPI_PUBLIC_KEY");
  }

  const vapiModule = await import("@vapi-ai/web");
  const VapiClient = vapiModule.default;
  vapiInstance = new VapiClient(publicKey);

  return vapiInstance;
}
