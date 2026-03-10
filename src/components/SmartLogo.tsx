import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { useTheme } from "next-themes";

type Contrast = "dark" | "light" | "unknown";

/** Samples a 32×32 downscale of an image and returns its perceived contrast. */
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
          if (data[i + 3] < 10) continue; // skip transparent
          count++;
          // perceived luminance (sRGB)
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

interface SmartLogoProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src: string;
}

/**
 * Renders a brand logo that automatically adapts to the current theme.
 * - Dark logo + dark mode  → inverted to white
 * - Light logo + light mode → inverted to black
 * - Otherwise              → shown as-is
 */
const SmartLogo = ({ src, alt, className, style, ...props }: SmartLogoProps) => {
  const { resolvedTheme } = useTheme();
  const [contrast, setContrast] = useState<Contrast>("unknown");
  const cachedSrc = useRef<string | null>(null);

  useEffect(() => {
    if (!src || src === cachedSrc.current) return;
    cachedSrc.current = src;
    analyzeContrast(src).then(setContrast);
  }, [src]);

  const isDark = resolvedTheme === "dark";

  let filter: string | undefined;
  if (contrast === "dark" && isDark) {
    // Dark logo on dark background → make it white
    filter = "brightness(0) invert(1)";
  } else if (contrast === "light" && !isDark) {
    // Light logo on light background → make it black
    filter = "brightness(0)";
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={{ filter, ...style }}
      {...props}
    />
  );
};

export default SmartLogo;
