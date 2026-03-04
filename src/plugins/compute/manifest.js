/** Compute plugin stub - connects to ZippyCoin compute when configured */

export const manifest = {
  id: "compute",
  name: "Compute",
  version: "0.1.0",
  backend: "compute",
  apiPrefix: "/api/compute",
  navItems: [
    { label: "Compute", path: "/dashboard/compute", icon: "memory" },
  ],
};
