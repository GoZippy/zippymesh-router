import { DashboardLayout } from "@/shared/components";

export default function DashboardRootLayout({ children }) {
  return (
    <DashboardLayout>
      <div className="animate-in fade-in duration-500 fill-mode-both">
        {children}
      </div>
    </DashboardLayout>
  );
}

