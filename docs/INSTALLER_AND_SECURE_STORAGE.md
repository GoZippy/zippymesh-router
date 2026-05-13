# Installer and secure storage — design for public distribution

**Goal:** Consumer installs are **installer-driven**, with onboarding that collects secrets once and stores them in **OS-native secure storage**. No requirement to create or edit `.env` on the user’s machine. Prebuilt installers per OS; public repo for audit so users can trust the compiled build.

---

## Principles

1. **No .env for consumer installs** — Plain `.env` with secrets on disk is fragile and risky. The installer (or first-run wizard) collects minimal onboarding input (e.g. dashboard password), generates internal secrets (e.g. JWT), and writes them only to **secure storage** appropriate for the OS.
2. **One clear path per OS** — Download installer → run → answer a short onboarding (password, optional port) → app runs. Same story on Windows, macOS, Linux; later, iOS/Android if needed.
3. **Public code + prebuilt binary** — Non-proprietary code lives in the public repo (e.g. zippymesh-router) so anyone can audit it and feel comfortable installing a precompiled build. Precompiled installers are offered per OS for easy download and install; power users can build from the same public source.
4. **Modern, OS-appropriate security** — Use each platform’s standard mechanism for app secrets (Credential Manager, Keychain, secret service, KeyStore) so we don’t invent our own and we respect OS constraints.

---

## Secure storage by platform

| Platform | Mechanism | What we store |
|----------|-----------|----------------|
| **Windows** | [Credential Manager](https://learn.microsoft.com/en-us/windows/win32/api/wincred/) (e.g. generic credential for `ZippyMeshRouter`) or a small JSON in `%APPDATA%\zippy-mesh` encrypted with [DPAPI](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/) | `JWT_SECRET`, `INITIAL_PASSWORD` (or hash), optional `PORT` |
| **macOS** | [Keychain](https://developer.apple.com/documentation/security/keychain_services) (e.g. service name `ZippyMeshRouter`) | Same |
| **Linux** | [libsecret](https://wiki.gnome.org/Projects/Libsecret) / Secret Service API, or fallback: file under `~/.config/zippy-mesh/` with mode `0600` (no encryption at rest) | Same |
| **iOS** | Keychain / Keychain Sharing entitlement | Same (if we ship an iOS app) |
| **Android** | [EncryptedSharedPreferences](https://developer.android.com/reference/androidx/security/crypto/EncryptedSharedPreferences) or [Keystore](https://developer.android.com/training/articles/keystore) | Same (if we ship an Android app) |

The **app at runtime** must support two modes:

- **Installer / consumer mode:** Read bootstrap secrets (JWT, password, port) from the chosen secure storage; no `.env` required.
- **Developer / advanced mode:** If `.env` exists (e.g. from source or zip), use it as today, so power users and CI keep working.

---

## Installer flow (target)

1. **User** downloads the installer for their OS (e.g. `ZippyMesh-Router-Setup-1.0.0.exe` on Windows, `.dmg` on Mac, `.AppImage` or `.deb` on Linux).
2. **User** runs the installer. It may optionally bundle Node (or use system Node) and the standalone app files.
3. **First run** (or installer step): simple onboarding UI:
   - “Choose a password for your ZippyMesh dashboard.”
   - Optional: “Port (default 20128)” and “Allow LAN access (0.0.0.0).”
   - Installer generates `JWT_SECRET` (crypto random), never shows it.
   - Installer writes `JWT_SECRET`, password (or hash), port, bind address into **secure storage** for the current user.
   - App data directory (e.g. `%APPDATA%\zippy-mesh` / `~/.config/zippy-mesh`) is created for DB and non-secret config.
   - **Preserve existing wallets and user data:** If upgrading, the installer must never overwrite DATA_DIR or the ZippyCoin wallet path (`~/.zippy`). See [WALLET_BACKUP_AND_INSTALLER_SAFETY.md](WALLET_BACKUP_AND_INSTALLER_SAFETY.md).
4. **Subsequent runs:** App reads bootstrap secrets from secure storage only; no prompts unless re-onboarding or recovery.
5. **Dashboard:** User opens `http://localhost:20128/dashboard` (or chosen port), logs in with the password they set; rest of setup (providers, keys) is in-app as today.

No `.env` is ever created for this path. Uninstall can optionally offer “Remove stored credentials.”

---

## Artifact and repo strategy

- **Public repo (e.g. zippymesh-router):** Source for the app (open-core), installer specs/scripts that don’t contain proprietary logic, and this design doc. Build-from-source and “advanced” zip remain documented for those who want them.
- **Prebuilt installers:** Built in a private or release repo (e.g. zippymesh-dist), published per version (e.g. GitHub Releases): Windows (NSIS or similar), macOS (.dmg), Linux (.AppImage and/or .deb). Each installer includes the onboarding flow and the secure-storage integration for that OS.
- **Zip (current):** Can remain as an “advanced” option with README that says: “For most users we recommend the installer; this zip is for from-source or scripted installs” and points to this doc.

---

## Implementation phases

| Phase | Scope | Notes |
|-------|--------|------|
| **1. App: dual bootstrap** | Router reads bootstrap from (a) secure storage if present, (b) else `.env`. No UI change yet; enables installer to write once, app to read. | Add small Node layer (e.g. `getBootstrapSecrets()`: try Windows Credential Manager / Keychain / libsecret, then fall back to `.env`). |
| **2. Windows installer** | NSIS (or similar) installer: copy standalone, run first-run wizard (password, optional port), generate JWT, write to Credential Manager or DPAPI file; create shortcut/Start Menu. | Delivers “download and install” for Windows; no .env. |
| **3. macOS / Linux installers** | Same flow: .dmg + first-run wizard (Keychain); .AppImage or .deb + first-run wizard (libsecret or 0600 fallback). | Parity across desktop. |
| **4. Optional: Tauri/Electron wrapper** | Optional desktop wrapper that runs the Node server and opens the dashboard; can host the first-run wizard in a window instead of CLI. | Better UX; not required for Phase 2/3. |
| **5. Mobile (if ever)** | iOS/Android apps that use Keychain/Keystore and same bootstrap model. | Out of scope for initial “easy desktop install.” |

---

## Docs and user messaging

- **Installer users:** “Download the installer for your OS → run it → set your dashboard password → open the dashboard.” No mention of .env or secrets files.
- **Zip / from-source users:** README and INSTALLER_MATRIX state that the **recommended** path is the installer; the zip is for advanced or from-source use; if they use the zip, they can still use .env (and we document that clearly) or we later add a small “bootstrap wizard” script that writes to secure storage from CLI.
- **Public repo:** README and this doc explain the security model (no .env for consumer installs; secure storage per OS) so auditors and users see how we handle secrets.
- **Wallet and user data:** Installers and updaters must preserve existing user data (DATA_DIR and ZippyCoin wallet at `~/.zippy`). Backup, upgrade, and migration rules are in [WALLET_BACKUP_AND_INSTALLER_SAFETY.md](WALLET_BACKUP_AND_INSTALLER_SAFETY.md).

---

*This design should be updated as we implement Phase 1 (dual bootstrap) and Phase 2 (Windows installer).*
