/** dVPN plugin stub - connects to ZippyCoin dVPN when configured */

export const manifest = {
  id: "dvpn",
  name: "dVPN",
  version: "0.1.0",
  backend: "dvpn",
  apiPrefix: "/api/dvpn",
  navItems: [
    { label: "dVPN", path: "/dashboard/dvpn", icon: "vpn_key" },
  ],
};
