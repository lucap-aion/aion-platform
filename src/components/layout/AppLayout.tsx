import { Outlet } from "react-router-dom";
import AppSidebar from "./AppSidebar";

interface AppLayoutProps {
  mode: "customer" | "brand";
}

const AppLayout = ({ mode }: AppLayoutProps) => {
  return (
    <div className="min-h-screen bg-background">
      <AppSidebar mode={mode} />
      <main className="ml-72 min-h-screen p-8">
        <Outlet />
      </main>
    </div>
  );
};

export default AppLayout;
