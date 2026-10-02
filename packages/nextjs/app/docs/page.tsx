import Link from "next/link";
import fs from "node:fs";
import path from "node:path";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const ROOT = path.join(process.cwd(), "../..");
const DOCS: Record<string, string> = {
  readme: "README.md",
  agents: "AGENTS.md",
  architecture: "docs/ARCHITECTURE.md",
  venues: "docs/VENUES.md",
  gotchas: "docs/HEDERA-GOTCHAS.md",
  testnet: "docs/TESTNET-EVIDENCE.md",
  mainnet: "docs/MAINNET-EVIDENCE.md",
  references: "docs/REFERENCES.md",
  deviations: "docs/DEVIATIONS.md",
};

export const dynamic = "force-dynamic";

/** `/docs` — the repository's markdown rendered in-app. */
export default async function Docs({ searchParams }: { searchParams: Promise<{ doc?: string }> }) {
  const { doc = "readme" } = await searchParams;
  const file = DOCS[doc] ?? DOCS.readme!;
  let md: string;
  try {
    md = fs.readFileSync(path.join(ROOT, file), "utf8");
  } catch {
    md = `_${file} is not written yet._`;
  }
  return (
    <div className="w-full max-w-5xl mx-auto px-5 py-8 flex flex-col md:flex-row gap-6">
      <nav className="menu bg-base-100 rounded-box border border-base-300 md:w-56 shrink-0 self-start">
        {Object.entries(DOCS).map(([k, f]) => (
          <li key={k}>
            <Link href={`/docs?doc=${k}`} className={k === doc ? "active" : ""}>
              {f.replace("docs/", "").replace(".md", "")}
            </Link>
          </li>
        ))}
      </nav>
      <article className="prose prose-sm max-w-none bg-base-100 rounded-2xl shadow p-6 border border-base-300 grow overflow-x-auto">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
      </article>
    </div>
  );
}
