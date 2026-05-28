import assert from "assert";
import {
  createRouterApiKey,
  verifyRouterApiKey,
  revokeRouterApiKey,
  addBlacklistEntry,
  isBlacklisted,
  getSettings,
  updateSettings,
} from "../src/lib/localDb.js";
import { requireApiKey } from "../src/lib/auth/apiKey.js";

async function fakeRequest(authHeader) {
  return {
    headers: new Map([["authorization", authHeader]]),
  };
}

async function run() {
  console.log("Running router key tests...");
  // ensure fresh settings
  await updateSettings({ requireApiKey: true });
  const settings = await getSettings();
  assert(settings.requireApiKey === true);

  const { id, rawKey } = await createRouterApiKey({ name: "test" });
  assert(id, "id should exist");
  assert(rawKey, "raw key should be returned");

  let res = await verifyRouterApiKey(rawKey);
  assert(res.valid, "new key should verify");

  // verify middleware
  try {
    const scopes = await requireApiKey(await fakeRequest(`Bearer ${rawKey}`));
    assert(Array.isArray(scopes), "scopes array expected");
    console.log("middleware accepted valid key");
  } catch (e) {
    console.error("middleware rejected valid key", e);
    process.exit(1);
  }

  // invalid key
  try {
    await requireApiKey(await fakeRequest("Bearer xyz"));
    console.error("middleware should have thrown");
    process.exit(1);
  } catch (e) {
    console.log("middleware correctly rejected invalid key");
  }

  await revokeRouterApiKey(id);
  res = await verifyRouterApiKey(rawKey);
  assert(!res.valid, "revoked key should no longer verify");

  // blacklist
  const entry = await addBlacklistEntry("key", rawKey, "test");
  assert(await isBlacklisted("key", rawKey));
  console.log("blacklist works");

  console.log("All router key tests passed");
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
