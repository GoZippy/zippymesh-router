/** LLM Router plugin - default plugin with routing, providers, combos, etc. */

export const manifest = {
  id: "llm",
  name: "LLM Router",
  version: "0.2.7",
  backend: "llm",
  navItems: [
    { label: "Endpoint", path: "/dashboard/endpoint", icon: "api" },
    { label: "Marketplace", path: "/marketplace", icon: "storefront" },
    { label: "Network", path: "/dashboard/network", icon: "hub" },
    { label: "Monetization", path: "/dashboard/monetization", icon: "payments" },
    { label: "Wallet", path: "/dashboard/wallet", icon: "account_balance_wallet" },
    { label: "Providers", path: "/dashboard/providers", icon: "dns" },
    { label: "Routing", path: "/dashboard/routing", icon: "alt_route" },
    { label: "Pools", path: "/dashboard/pools", icon: "groups" },
    { label: "Combos", path: "/dashboard/combos", icon: "layers" },
    { label: "Analytics", path: "/dashboard/analytics", icon: "monitoring" },
    { label: "Usage", path: "/dashboard/usage", icon: "bar_chart" },
    { label: "CLI Tools", path: "/dashboard/cli-tools", icon: "terminal" },
    { label: "About", path: "/dashboard/about", icon: "info" },
    { label: "Help", path: "/dashboard/help", icon: "help" },
  ],
};
