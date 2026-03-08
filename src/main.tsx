import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { TenantProvider } from "./contexts/TenantContext";
import { LanguageProvider } from "./contexts/LanguageContext";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
    <TenantProvider>
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </TenantProvider>
  </ThemeProvider>
);
