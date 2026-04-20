import { useEffect, useRef, useState } from "react";

type Contrast = "dark" | "light" | "unknown";

function analyzeContrast(src: string): Promise<Contrast> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const SIZE = 32;
        const canvas = document.createElement("canvas");
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve("unknown"); return; }
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
        let luminanceSum = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 10) continue;
          count++;
          luminanceSum += 0.299 * (data[i] / 255) + 0.587 * (data[i + 1] / 255) + 0.114 * (data[i + 2] / 255);
        }
        if (count === 0) { resolve("unknown"); return; }
        resolve(luminanceSum / count < 0.5 ? "dark" : "light");
      } catch {
        resolve("unknown");
      }
    };
    img.onerror = () => resolve("unknown");
    img.src = src;
  });
}

interface AuthPanelProps {
  logoUrl: string;
  bgUrl: string;
  name: string;
}

/**
 * Left panel for auth pages.
 * Analyses the logo contrast and applies a matching overlay:
 *   - Dark logo  → light/white overlay (logo stays dark, readable on pale bg)
 *   - Light logo → dark overlay (logo stays light, readable on dark bg)
 */
const AuthPanel = ({ logoUrl, bgUrl, name }: AuthPanelProps) => {
  const [contrast, setContrast] = useState<Contrast>("unknown");
  const cachedSrc = useRef<string | null>(null);

  useEffect(() => {
    if (!logoUrl || logoUrl === cachedSrc.current) return;
    cachedSrc.current = logoUrl;
    analyzeContrast(logoUrl).then(setContrast);
  }, [logoUrl]);

  // Dark logo needs a light overlay; light logo needs a dark overlay
  const overlayClass =
    contrast === "dark"
      ? "bg-white/40"
      : "bg-black/70";

  return (
    <div className="hidden lg:block lg:w-1/2 relative">
      <img src={bgUrl} alt={name} className="h-full w-full object-cover" />
      <div className={`absolute inset-0 ${overlayClass} transition-colors duration-300`} />
    </div>
  );
};

export default AuthPanel;
