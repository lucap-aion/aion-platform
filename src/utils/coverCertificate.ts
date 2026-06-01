// Cover Certificate PDF — generates a one-page A4 certificate the customer
// can download from /covers/:id. Imported lazily from the Cover Passport
// page so the ~150KB jsPDF bundle only loads when a customer actually clicks
// "Download certificate".
//
// Deliberately uses jsPDF's built-in helvetica + times fonts (no custom
// font subsets) to keep the bundle small. The header type face is set
// to Times for a serif "credential" feel; body stays helvetica.

import { jsPDF } from "jspdf";

type Labels = {
  title: string;
  subtitle: string;
  certId: string;
  issuedTo: string;
  piece: string;
  sku: string;
  composition: string;
  category: string;
  coverPeriod: string;
  protectedValue: string;
  registeredAt: string;
  footer: string;
};

export type CoverCertificateInput = {
  certCode: string;
  customerName: string;
  productName: string;
  brandName: string;
  sku: string | null;
  composition: string | null;
  category: string | null;
  productPicture: string | null;
  brandLogo: string | null;
  startDate: string | null;
  expirationDate: string | null;
  sellingPrice: number | null;
  shopName: string | null;
  shopCity: string | null;
  locale: "en" | "it";
  labels: Labels;
};

const A4_WIDTH = 210;
const A4_HEIGHT = 297;
const MARGIN_X = 18;

// Load an external image into a data URL we can hand to jsPDF.addImage.
// Falls back gracefully if the image 404s or CORS blocks the canvas read.
async function loadImageDataUrl(
  url: string,
): Promise<{ dataUrl: string; width: number; height: number; format: "PNG" | "JPEG" } | null> {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(r.error);
      r.onload = () => resolve(String(r.result ?? ""));
      r.readAsDataURL(blob);
    });
    // Decode so we know the natural dimensions and can preserve aspect
    // ratio when fitting into the certificate frame.
    const dims = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error("image decode failed"));
      img.src = dataUrl;
    });
    const format = /image\/jpe?g/i.test(blob.type) ? "JPEG" : "PNG";
    return { dataUrl, format, ...dims };
  } catch {
    return null;
  }
}

const fmtDate = (iso: string | null, locale: "en" | "it") => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(locale === "it" ? "it-IT" : "en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
};

const fmtEur = (n: number | null, locale: "en" | "it") => {
  if (n == null) return "—";
  return new Intl.NumberFormat(locale === "it" ? "it-IT" : "en-GB", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
};

const slug = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 50);

export async function generateCoverCertificate(input: CoverCertificateInput) {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  // Page background — soft warm off-white
  doc.setFillColor(252, 250, 245);
  doc.rect(0, 0, A4_WIDTH, A4_HEIGHT, "F");

  // Decorative border (single thin line a few mm in from edges)
  doc.setDrawColor(184, 134, 11); // brand gold
  doc.setLineWidth(0.4);
  doc.rect(8, 8, A4_WIDTH - 16, A4_HEIGHT - 16);

  // Inner thin line for the double-border effect
  doc.setLineWidth(0.15);
  doc.rect(11, 11, A4_WIDTH - 22, A4_HEIGHT - 22);

  // Brand logo (top centre)
  const brandLogoSlot = { x: A4_WIDTH / 2 - 22, y: 18, w: 44, h: 18 };
  if (input.brandLogo) {
    const logo = await loadImageDataUrl(input.brandLogo);
    if (logo) {
      const ratio = logo.width / logo.height;
      let w = brandLogoSlot.w;
      let h = w / ratio;
      if (h > brandLogoSlot.h) {
        h = brandLogoSlot.h;
        w = h * ratio;
      }
      const x = brandLogoSlot.x + (brandLogoSlot.w - w) / 2;
      const y = brandLogoSlot.y + (brandLogoSlot.h - h) / 2;
      doc.addImage(logo.dataUrl, logo.format, x, y, w, h);
    }
  } else {
    // Type-set brand name as fallback
    doc.setFont("times", "bold");
    doc.setFontSize(20);
    doc.setTextColor(40, 40, 40);
    doc.text(input.brandName.toUpperCase(), A4_WIDTH / 2, 30, { align: "center" });
  }

  // Title block
  let y = 50;
  doc.setFont("times", "normal");
  doc.setFontSize(10);
  doc.setTextColor(140, 122, 94);
  doc.text(input.labels.subtitle.toUpperCase(), A4_WIDTH / 2, y, { align: "center", charSpace: 1.2 });

  y += 9;
  doc.setFont("times", "bold");
  doc.setFontSize(26);
  doc.setTextColor(28, 28, 28);
  doc.text(input.labels.title, A4_WIDTH / 2, y, { align: "center" });

  // Gold rule under title
  y += 5;
  doc.setDrawColor(184, 134, 11);
  doc.setLineWidth(0.4);
  doc.line(A4_WIDTH / 2 - 30, y, A4_WIDTH / 2 + 30, y);

  // Cert ID
  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(120, 120, 120);
  doc.text(`${input.labels.certId}: ${input.certCode}`, A4_WIDTH / 2, y, { align: "center" });

  // Product photo (centred, large)
  const photoTop = y + 8;
  const photoSlot = { x: A4_WIDTH / 2 - 35, y: photoTop, w: 70, h: 55 };
  if (input.productPicture) {
    const pic = await loadImageDataUrl(input.productPicture);
    if (pic) {
      const ratio = pic.width / pic.height;
      let w = photoSlot.w;
      let h = w / ratio;
      if (h > photoSlot.h) {
        h = photoSlot.h;
        w = h * ratio;
      }
      const x = photoSlot.x + (photoSlot.w - w) / 2;
      const yy = photoSlot.y + (photoSlot.h - h) / 2;
      doc.addImage(pic.dataUrl, pic.format, x, yy, w, h);
    }
  }
  y = photoSlot.y + photoSlot.h;

  // Customer name (issued to)
  y += 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(140, 122, 94);
  doc.text(input.labels.issuedTo.toUpperCase(), A4_WIDTH / 2, y, { align: "center", charSpace: 1.2 });

  y += 6;
  doc.setFont("times", "italic");
  doc.setFontSize(18);
  doc.setTextColor(28, 28, 28);
  doc.text(input.customerName, A4_WIDTH / 2, y, { align: "center" });

  // Piece name
  y += 10;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(140, 122, 94);
  doc.text(input.labels.piece.toUpperCase(), A4_WIDTH / 2, y, { align: "center", charSpace: 1.2 });

  y += 6;
  doc.setFont("times", "bold");
  doc.setFontSize(14);
  doc.setTextColor(28, 28, 28);
  doc.text(input.productName, A4_WIDTH / 2, y, { align: "center" });

  // Details table — two columns
  y += 12;
  const tableLeft = MARGIN_X + 6;
  const tableRight = A4_WIDTH - MARGIN_X - 6;
  const colWidth = (tableRight - tableLeft) / 2;

  const rows: Array<{ left: [string, string]; right: [string, string] }> = [];

  // Build rows pairwise: (cover period | protected value), (sku | category)
  // and (composition spanning full width if present).
  rows.push({
    left: [input.labels.coverPeriod, `${fmtDate(input.startDate, input.locale)} → ${fmtDate(input.expirationDate, input.locale)}`],
    right: [input.labels.protectedValue, fmtEur(input.sellingPrice, input.locale)],
  });
  if (input.sku || input.category) {
    rows.push({
      left: [input.labels.sku, input.sku ?? "—"],
      right: [input.labels.category, input.category ?? "—"],
    });
  }

  const rowHeight = 11;
  for (const row of rows) {
    const renderCell = (x: number, [label, value]: [string, string]) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(140, 122, 94);
      doc.text(label.toUpperCase(), x, y, { charSpace: 1 });
      doc.setFont("times", "normal");
      doc.setFontSize(11);
      doc.setTextColor(40, 40, 40);
      doc.text(value, x, y + 5);
    };
    renderCell(tableLeft, row.left);
    renderCell(tableLeft + colWidth, row.right);
    y += rowHeight;
  }

  if (input.composition) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(140, 122, 94);
    doc.text(input.labels.composition.toUpperCase(), tableLeft, y, { charSpace: 1 });
    doc.setFont("times", "normal");
    doc.setFontSize(11);
    doc.setTextColor(40, 40, 40);
    const lines = doc.splitTextToSize(input.composition, tableRight - tableLeft);
    doc.text(lines, tableLeft, y + 5);
    y += 5 + lines.length * 4 + 4;
  }

  // Registered at
  if (input.shopName) {
    y += 2;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(140, 122, 94);
    doc.text(input.labels.registeredAt.toUpperCase(), tableLeft, y, { charSpace: 1 });
    doc.setFont("times", "normal");
    doc.setFontSize(11);
    doc.setTextColor(40, 40, 40);
    const where = [input.shopName, input.shopCity].filter(Boolean).join(", ");
    doc.text(where, tableLeft, y + 5);
    y += rowHeight;
  }

  // Footer
  doc.setDrawColor(184, 134, 11);
  doc.setLineWidth(0.4);
  doc.line(A4_WIDTH / 2 - 20, A4_HEIGHT - 28, A4_WIDTH / 2 + 20, A4_HEIGHT - 28);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(120, 120, 120);
  doc.text(input.labels.footer, A4_WIDTH / 2, A4_HEIGHT - 22, { align: "center" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(184, 134, 11);
  doc.text("AION", A4_WIDTH / 2, A4_HEIGHT - 17, { align: "center", charSpace: 2 });

  const filename = `${slug(input.brandName || "brand")}-${slug(input.productName || "cover")}-${input.certCode}.pdf`;
  doc.save(filename);
}
