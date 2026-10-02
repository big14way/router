import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** GET /api/lambdaplex/status — whether the keyed Lambdaplex adapter is configured. Never exposes the key. */
export async function GET() {
  const keyed = Boolean(process.env.LAMBDAPLEX_API_KEY && process.env.LAMBDAPLEX_ED25519_SEED);
  return NextResponse.json({
    keyed,
    execution: false,
    note: keyed
      ? "keyed: fee-quote enabled; order placement not enabled in this build"
      : "not configured: public market data only",
  });
}
