// Community Edition Stub — upgrade to Pro for full functionality
import path from "path";
import os from "os";

const PRO_ERROR = { error: "This feature requires ZippyMesh Pro", code: "FEATURE_PRO" };

export const WALLET_DIR = path.join(os.homedir(), ".zippymesh", "wallet");

export async function initializeWallet() { return PRO_ERROR; }
export async function generateNewWallet() { return PRO_ERROR; }
export async function loadWallet() { return PRO_ERROR; }
export async function getCurrentWallet() { return null; }
export async function getWalletBalance(rpcUrl, address) { return PRO_ERROR; }
export async function getWalletNonce(rpcUrl, address) { return PRO_ERROR; }
export function createPaymentCommitment(provider, estimatedTokens, secretHash) {
  throw new Error("ZippyMesh Pro required");
}
export async function exportWalletForBackup() { return PRO_ERROR; }
export async function restoreWalletFromBackup(backup, opts = {}) { return PRO_ERROR; }
export async function getWalletDetails(rpcUrl) { return PRO_ERROR; }
export async function removeWallet(confirmationCode = null) { return PRO_ERROR; }
export function getWalletFilePath() { return path.join(WALLET_DIR, "wallet.json"); }
