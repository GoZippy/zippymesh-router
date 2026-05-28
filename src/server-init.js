// Server startup script
import initializeCloudSync from "./shared/services/initializeCloudSync.js";

async function startServer() {
  console.log("Starting server...");

  try {
    await initializeCloudSync();
    console.log("Server initialization complete");
  } catch (error) {
    console.log("Error during server init:", error);
    process.exit(1);
  }
}

startServer().catch(console.log);

export default startServer;
