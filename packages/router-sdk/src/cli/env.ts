import { config } from "dotenv";
import path from "node:path";

/** Load the template's root .env (and a local one) so the CLIs see the same settings as the app and scripts. */
export function loadEnv(): void {
  config({ path: path.resolve(process.cwd(), "../../.env") });
  config({ path: path.resolve(process.cwd(), ".env") });
}
