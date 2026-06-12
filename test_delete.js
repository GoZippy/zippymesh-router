
import { deleteProviderConnection, getProviderConnections } from "./src/lib/localDb.js";

async function test() {
    console.log("Starting deletion test...");
    const initial = await getProviderConnections();
    console.log("Initial count:", initial.length);

    const idToRemove = "46bc2d50-f8e1-4f3e-a364-ca8732f4e979"; // Antigravity
    console.log("Attempting to delete:", idToRemove);

    const result = await deleteProviderConnection(idToRemove);
    console.log("Deletion result:", result);

    const after = await getProviderConnections();
    console.log("Count after deletion:", after.length);

    process.exit(0);
}

test().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
