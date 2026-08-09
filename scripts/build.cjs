/**
 * Smart build script for Cloudflare Workers + OpenNext.
 *
 * Problem: `opennextjs-cloudflare build` internally calls `npm run build` to
 * build the Next.js app. If the `build` script itself runs
 * `opennextjs-cloudflare build`, it creates infinite recursion.
 *
 * Solution: Use the OPENNEXT_INVOKED env var to detect whether we're being
 * called by OpenNext (inner call) or by Cloudflare directly (outer call).
 *
 * Outer call (Cloudflare):  next build → opennextjs-cloudflare build
 * Inner call (by OpenNext): next build only (no recursion)
 */

const { execSync } = require("child_process");

const isInnerBuild = process.env.OPENNEXT_INVOKED === "1";

if (isInnerBuild) {
  // Called by opennextjs-cloudflare build internally — just build Next.js
  console.log("[build] Inner call detected, running next build only");
  execSync("npx next build", { stdio: "inherit" });
} else {
  // Called by Cloudflare directly — build Next.js then OpenNext
  console.log("[build] Outer call, building Next.js + OpenNext");
  execSync("npx next build", { stdio: "inherit" });
  console.log("[build] Next.js build done, starting OpenNext build");
  execSync("npx opennextjs-cloudflare build", {
    stdio: "inherit",
    env: { ...process.env, OPENNEXT_INVOKED: "1" },
  });
  console.log("[build] OpenNext build complete");
}
