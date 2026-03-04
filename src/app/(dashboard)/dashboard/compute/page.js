"use client";

import Card from "@/shared/components/Card";

export default function ComputePage() {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <Card title="Compute" icon="memory">
        <div className="p-6 rounded-lg border border-dashed border-border text-center">
          <p className="text-text-muted mb-2">Compute plugin (stub)</p>
          <p className="text-sm text-text-muted">
            Connects to ZippyCoin layer2/mesh/compute when configured. Enable via ENABLED_PLUGINS=compute.
          </p>
        </div>
      </Card>
    </div>
  );
}
