import { applyDefaultFirewallRules, blacklistIp } from "./src/lib/firewall.js";

async function run() {
  console.log("Testing firewall integration");
  await applyDefaultFirewallRules(["127.0.0.1"]);
  console.log("Default rules applied (if supported)");

  // attempt to blacklist dummy IP (no effect if command fails)
  try {
    await blacklistIp("203.0.113.1");
    console.log("Blacklisted example IP");
  } catch (e) {
    console.error("Failed to blacklist IP", e);
  }
}

run().catch(console.error);
