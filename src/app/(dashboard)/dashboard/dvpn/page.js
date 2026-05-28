"use client";

import Card from "@/shared/components/Card";

export default function DvpnPage() {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <Card title="dVPN" icon="vpn_key">
        <div className="p-6 rounded-lg border border-dashed border-border text-center">
          <p className="text-text-muted mb-2">dVPN plugin (stub)</p>
          <p className="text-sm text-text-muted">
            Connects to ZippyCoin layer2/mesh/dvpn when configured. Enable via ENABLED_PLUGINS=dvpn.
          </p>
        </div>
      </Card>
    </div>
  );
}
