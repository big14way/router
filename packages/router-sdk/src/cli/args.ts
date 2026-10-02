/** Minimal `--key value` / `--flag` parser for the SDK CLIs. */
export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

export const str = (v: string | boolean | undefined, fallback: string): string =>
  typeof v === "string" ? v : fallback;
