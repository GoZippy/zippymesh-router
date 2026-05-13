"use client";

import Badge from "./Badge";
import {
  MESH_SIGNATURE_STATUS_CONFIG,
  MESH_SIGNATURE_PRIORITY,
  resolveMeshSignatureConfig,
} from "./meshSignatureConfig";

// Re-export the pure helpers so consumers have a single import surface.
export {
  MESH_SIGNATURE_STATUS_CONFIG,
  MESH_SIGNATURE_PRIORITY,
  resolveMeshSignatureConfig,
};

/**
 * Inline badge that surfaces the X-Zippy-Signature-Status verdict for a mesh
 * response. Renders nothing when no status is provided (e.g. local-only
 * providers that never went through the sidecar).
 *
 * @param {object} props
 * @param {"valid"|"invalid"|"missing"|"error"|undefined} props.status
 *   Value of the `X-Zippy-Signature-Status` response header.
 * @param {string} [props.reason]
 *   Value of the `X-Zippy-Signature-Reason` response header. Used as the
 *   tooltip when present; falls back to a sensible default per status.
 * @param {"sm"|"md"|"lg"} [props.size]
 * @param {string} [props.className]
 */
export default function MeshSignatureBadge({
  status,
  reason,
  size = "sm",
  className,
}) {
  const config = resolveMeshSignatureConfig(status);
  if (!config) return null;

  const tooltip = reason && reason.trim().length > 0
    ? `${config.defaultTooltip} (${reason})`
    : config.defaultTooltip;

  // Wrap in a span so we can attach title (native tooltip) and an a11y label.
  // The Badge component only accepts variant/size/icon/className/dot/children,
  // so passing title directly would be silently dropped.
  return (
    <span
      title={tooltip}
      aria-label={`Mesh signature ${config.label.toLowerCase()}: ${tooltip}`}
      className="inline-flex"
    >
      <Badge
        variant={config.variant}
        size={size}
        icon={config.icon}
        className={className}
      >
        {config.label}
      </Badge>
    </span>
  );
}
