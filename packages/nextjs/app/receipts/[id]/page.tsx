"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import type { NextPage } from "next";

type Verification = {
  id: string | null;
  topic: string | null;
  configured: boolean;
  verified: boolean;
  message?: string;
  receipt?: unknown;
  checks?: { label: string; ok: boolean; detail?: string }[];
};

/** `/receipts/[id]` — independent verification of a best-execution receipt from the mirror node. */
const Receipt: NextPage<{ params: Promise<{ id: string }> }> = ({ params }) => {
  const { id } = use(params);
  const [v, setV] = useState<Verification | null>(null);
  useEffect(() => {
    fetch(`/api/receipt?id=${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then(setV)
      .catch(e => setV({ id, topic: null, configured: false, verified: false, message: String(e) }));
  }, [id]);
  return (
    <div className="w-full max-w-4xl mx-auto px-5 py-8 flex flex-col gap-4">
      <h1 className="text-2xl font-bold m-0">Receipt {id}</h1>
      <div className="bg-base-100 rounded-2xl shadow p-6 border border-base-300 text-sm flex flex-col gap-3">
        {!v ? (
          <span className="loading loading-spinner" />
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className={`badge ${v.verified ? "badge-success" : "badge-ghost"}`}>
                {v.verified ? "verified" : "not verified"}
              </span>
              {v.topic && <span className="text-xs">topic {v.topic}</span>}
            </div>
            {v.message && <p className="m-0">{v.message}</p>}
            {v.checks && (
              <ul className="m-0 pl-4">
                {v.checks.map(c => (
                  <li key={c.label}>
                    {c.ok ? "✅" : "❌"} {c.label}{" "}
                    {c.detail && <span className="text-base-content/60">— {c.detail}</span>}
                  </li>
                ))}
              </ul>
            )}
            {v.receipt !== undefined && (
              <pre className="text-xs overflow-x-auto bg-base-200 p-3 rounded">
                {JSON.stringify(v.receipt, null, 2)}
              </pre>
            )}
          </>
        )}
      </div>
      <Link href="/swap" className="link text-sm">
        ← back to swap
      </Link>
    </div>
  );
};

export default Receipt;
