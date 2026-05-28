"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Modal, Button } from "@/shared/components";

/**
 * Cursor Auth Modal
 * Auto-detect and import token from Cursor IDE's local SQLite database.
 * Sensitive fields (access token, machine ID) are masked by default.
 */
export default function CursorAuthModal({ isOpen, onSuccess, onClose }) {
  const [accessToken, setAccessToken] = useState("");
  const [machineId, setMachineId] = useState("");
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetected, setAutoDetected] = useState(false);

  // Reveal/copy state per field
  const [showToken, setShowToken] = useState(false);
  const [showMachineId, setShowMachineId] = useState(false);
  const [copiedField, setCopiedField] = useState(null); // "token" | "machineId" | null

  // Auto-detect tokens when modal opens
  useEffect(() => {
    if (!isOpen) return;

    // Reset state on open
    setAccessToken("");
    setMachineId("");
    setShowToken(false);
    setShowMachineId(false);
    setCopiedField(null);
    setError(null);
    setAutoDetected(false);

    const autoDetect = async () => {
      setAutoDetecting(true);

      try {
        const res = await fetch("/api/oauth/cursor/auto-import");
        const data = await res.json();

        if (data.found) {
          setAccessToken(data.accessToken);
          setMachineId(data.machineId);
          setAutoDetected(true);
        } else {
          setError(data.error || "Could not auto-detect tokens");
        }
      } catch {
        setError("Failed to auto-detect tokens");
      } finally {
        setAutoDetecting(false);
      }
    };

    autoDetect();
  }, [isOpen]);

  const handleCopy = async (value, field) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Ignore clipboard errors
    }
  };

  const handleImportToken = async () => {
    if (!accessToken.trim()) {
      setError("Please enter an access token");
      return;
    }

    if (!machineId.trim()) {
      setError("Please enter a machine ID");
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/cursor/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: accessToken.trim(),
          machineId: machineId.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Import failed");
      }

      // Success - close modal and trigger refresh
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  /** Renders a masked sensitive field with show/hide and copy controls */
  const SensitiveField = ({ id, label, value, onChange, placeholder, showValue, onToggleShow, field }) => (
    <div>
      <label htmlFor={id} className="block text-sm font-medium mb-2">
        {label} <span className="text-red-500">*</span>
      </label>
      <div className="relative flex items-start gap-1">
        <div className="relative flex-1">
          {showValue ? (
            <textarea
              id={id}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              rows={field === "token" ? 3 : 1}
              className="w-full px-3 py-2 text-sm font-mono border border-border rounded-lg bg-background focus:outline-none focus:border-primary resize-none pr-1"
            />
          ) : (
            <div
              className={`w-full px-3 py-2 text-sm font-mono border border-border rounded-lg bg-background text-text-muted select-none ${
                field === "token" ? "min-h-[76px]" : "min-h-[38px]"
              } flex items-center`}
            >
              {value
                ? "•".repeat(Math.min(value.length, 32))
                : <span className="opacity-40 italic text-xs">{placeholder}</span>}
            </div>
          )}
        </div>
        {/* Action buttons */}
        <div className="flex flex-col gap-1 shrink-0 pt-0.5">
          {/* Show/Hide toggle */}
          <button
            type="button"
            onClick={() => onToggleShow(!showValue)}
            className="p-1.5 rounded hover:bg-sidebar border border-border text-text-muted hover:text-primary transition-colors"
            title={showValue ? "Hide value" : "Reveal value"}
          >
            <span className="material-symbols-outlined text-[16px]">
              {showValue ? "visibility_off" : "visibility"}
            </span>
          </button>
          {/* Copy without revealing */}
          {value && (
            <button
              type="button"
              onClick={() => handleCopy(value, field)}
              className="p-1.5 rounded hover:bg-sidebar border border-border text-text-muted hover:text-green-600 transition-colors"
              title="Copy to clipboard"
            >
              <span className="material-symbols-outlined text-[16px]">
                {copiedField === field ? "check" : "content_copy"}
              </span>
            </button>
          )}
        </div>
      </div>
      {/* Manual entry hint when not auto-detected */}
      {!autoDetected && (
        <button
          type="button"
          className="text-xs text-primary mt-1 underline underline-offset-2 hover:no-underline"
          onClick={() => onToggleShow(true)}
        >
          Enter manually
        </button>
      )}
    </div>
  );

  return (
    <Modal isOpen={isOpen} title="Connect Cursor IDE" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {/* Auto-detecting state */}
        {autoDetecting && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-primary animate-spin">
                progress_activity
              </span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Auto-detecting tokens...</h3>
            <p className="text-sm text-text-muted">
              Reading from Cursor IDE database
            </p>
          </div>
        )}

        {/* Form (shown after auto-detect completes) */}
        {!autoDetecting && (
          <>
            {/* Success message if auto-detected */}
            {autoDetected && (
              <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg border border-green-200 dark:border-green-800">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-green-600 dark:text-green-400">check_circle</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-green-800 dark:text-green-200">
                      Tokens detected from Cursor IDE
                    </p>
                    <p className="text-xs text-green-700 dark:text-green-300 mt-0.5">
                      Values are hidden for security. Use the reveal or copy buttons to inspect them.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Info message if not auto-detected */}
            {!autoDetected && !error && (
              <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
                <div className="flex gap-2">
                  <span className="material-symbols-outlined text-blue-600 dark:text-blue-400">info</span>
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    Cursor IDE not detected. Please paste your tokens manually.
                  </p>
                </div>
              </div>
            )}

            {/* Error display */}
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            {/* Access Token — masked by default */}
            <SensitiveField
              id="cursor-access-token"
              label="Access Token"
              value={accessToken}
              onChange={setAccessToken}
              placeholder="Access token will be auto-filled..."
              showValue={showToken}
              onToggleShow={setShowToken}
              field="token"
            />

            {/* Machine ID — masked by default */}
            <SensitiveField
              id="cursor-machine-id"
              label="Machine ID"
              value={machineId}
              onChange={setMachineId}
              placeholder="Machine ID will be auto-filled..."
              showValue={showMachineId}
              onToggleShow={setShowMachineId}
              field="machineId"
            />

            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button
                onClick={handleImportToken}
                fullWidth
                disabled={importing || !accessToken.trim() || !machineId.trim()}
              >
                {importing ? "Importing..." : "Import Token"}
              </Button>
              <Button onClick={onClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

CursorAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
