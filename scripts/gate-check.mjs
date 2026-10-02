#!/usr/bin/env node
/**
 * Reproduces the Scaffold-HBAR template bounty eligibility gate end to end:
 *   temp dir → `npm create scaffold-hbar@latest` with this template → install → lint → tests → build
 *   → boot the app → every core route answers 200 → manifest/docs/licence present → no tracked .env.
 *
 *   node scripts/gate-check.mjs                 # scaffold from GitHub (owner/repo from package.json "repository")
 *   node scripts/gate-check.mjs --local         # scaffold from this checkout (CREATE_SCAFFOLD_HBAR_TEMPLATE_DIR)
 *   node scripts/gate-check.mjs --template owner/repo#branch [--keep] [--port 3999]
 * Exits non-zero on the first failure.
 */
import { execSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const repoUrl = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url ?? "";
const defaultTemplate = repoUrl.replace(/^.*github\.com[/:]/, "").replace(/\.git$/, "") || "big14way/router";
const template = opt("--template", defaultTemplate);
const local = flag("--local");
const keep = flag("--keep");
const port = Number(opt("--port", "3999"));
const ROUTES = ["/", "/swap", "/orders", "/receipts/gate-check", "/docs", "/api/quote/tokens?net=testnet", "/api/receipt?id=gate-check", "/api/v3/orders", "/api/lambdaplex/status"];

const log = (m) => console.log(`\x1b[36m[gate]\x1b[0m ${m}`);
const fail = (m) => {
  console.error(`\x1b[31m[gate] FAIL:\x1b[0m ${m}`);
  process.exit(1);
};
const run = (cmd, cwd, env = {}) => {
  log(`$ ${cmd}`);
  const r = spawnSync(cmd, { cwd, shell: true, stdio: "inherit", env: { ...process.env, ...env, CI: "1" } });
  if (r.status !== 0) fail(`${cmd} exited ${r.status}`);
};

// 1. Source-repo hygiene (the gate is about what gets published).
const tracked = execSync("git ls-files", { cwd: ROOT }).toString().split("\n");
const badEnv = tracked.filter((f) => /(^|\/)\.env(\..*)?$/.test(f) && !f.endsWith(".env.example"));
if (badEnv.length) fail(`tracked env files: ${badEnv.join(", ")}`);
for (const f of ["template.json", "README.md", "AGENTS.md", "LICENSE"]) if (!tracked.includes(f)) fail(`${f} is not tracked`);
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "template.json"), "utf8"));
if (!manifest.name || !manifest["create-scaffold-hbar"]?.capabilities) fail("template.json lacks name/capabilities");
if (!/MIT License/.test(fs.readFileSync(path.join(ROOT, "LICENSE"), "utf8"))) fail("LICENSE is not MIT");
log("source repo: manifest, README, AGENTS, LICENSE present; no tracked .env");

// 2. Scaffold into a temp dir with the real CLI.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sor-gate-"));
const project = "sor-check";
log(`scaffolding ${local ? "from local checkout" : `from ${template}`} into ${tmp}/${project}`);
run(
  `npx --yes create-scaffold-hbar@latest ${project} --template ${template} --frontend nextjs-app --solidity-framework hardhat --network testnet --package-manager yarn --skip-install --skip-hedera-skills --ci`,
  tmp,
  local ? { CREATE_SCAFFOLD_HBAR_TEMPLATE_DIR: ROOT } : {},
);
const dir = path.join(tmp, project);
// The CLI consumes template.json (envVars → .env.example, outro) and does not copy it into the project.
for (const f of ["README.md", "AGENTS.md", "LICENSE", "packages/router-sdk", "packages/hardhat", "packages/nextjs"]) {
  if (!fs.existsSync(path.join(dir, f))) fail(`scaffolded project is missing ${f}`);
}
if (!fs.existsSync(path.join(dir, ".env.example"))) fail(".env.example was not generated from template.json envVars");

// 3. Install, lint, test, build.
run("corepack enable && yarn install --immutable", dir);
run("yarn lint", dir);
run("yarn sdk:test", dir);
run("yarn hardhat:test", dir);
run("yarn next:build", dir);

// 4. Boot the app with no env and check the routes.
log(`starting next on :${port}`);
const server = spawn("yarn", ["workspace", "@sh/nextjs", "serve", "-p", String(port)], { cwd: dir, env: { ...process.env, PORT: String(port) }, stdio: "pipe" });
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
const status = async (route) => {
  try {
    const r = await fetch(`http://127.0.0.1:${port}${route}`, { redirect: "manual" });
    return r.status;
  } catch {
    return 0;
  }
};
try {
  const deadline = Date.now() + 90_000;
  while ((await status("/")) !== 200) {
    if (Date.now() > deadline) fail(`server did not come up:\n${serverLog.slice(-2000)}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  for (const route of ROUTES) {
    const s = await status(route);
    if (s !== 200) fail(`${route} returned ${s}`);
    log(`${route} → 200`);
  }
} finally {
  server.kill("SIGTERM");
}
if (!keep) fs.rmSync(tmp, { recursive: true, force: true });
log(`PASS (${keep ? `kept ${dir}` : "temp dir removed"})`);
process.exit(0);
