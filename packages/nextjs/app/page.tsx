import Link from "next/link";
import type { NextPage } from "next";
import { QuotePanel } from "~~/components/router/QuotePanel";

/**
 * `/` — quotes from every venue with no wallet and no env configured. The venue table, the
 * winning quote and the split plan all come from GET /api/quote.
 */
const Home: NextPage = () => (
  <div className="flex flex-col items-center grow w-full">
    <div className="hedera-gradient dark:bg-none dark:bg-hedera-charcoal w-full py-10 px-5">
      <div className="max-w-5xl mx-auto text-white">
        <h1 className="text-3xl font-bold m-0">Hedera Smart Order Router</h1>
        <p className="m-0 mt-2 text-white/80 max-w-3xl">
          SaucerSwap&apos;s router lives inside its app and is not a public API. This template quotes SaucerSwap V1, V2,
          the V3 order book and Lambdaplex, splits across V1/V2 pools, executes on the best venue and publishes a
          best-execution receipt to HCS.
        </p>
        <div className="mt-3 flex gap-2 flex-wrap">
          <Link href="/swap" className="btn btn-sm">
            Execute a plan
          </Link>
          <Link href="/orders" className="btn btn-sm btn-ghost text-white">
            Orders
          </Link>
          <Link href="/docs" className="btn btn-sm btn-ghost text-white">
            Docs
          </Link>
        </div>
      </div>
    </div>
    <div className="w-full max-w-5xl mx-auto px-5 -mt-4 pb-16">
      <div className="bg-base-100 rounded-2xl shadow-lg p-6 border border-base-300">
        <QuotePanel />
      </div>
    </div>
  </div>
);

export default Home;
