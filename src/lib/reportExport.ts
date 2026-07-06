// Shared report/export helpers for the brand assistant. Heavy libraries
// (exceljs, jspdf, html2canvas) are imported dynamically so they only load when
// the user actually downloads something — the chat stays light.

export type SheetColumn = { key: string; header: string; width?: number };
export type Sheet = {
  name: string;
  columns: SheetColumn[];
  rows: Record<string, unknown>[];
};

const sanitizeFilename = (name: string) =>
  name.replace(/[^a-z0-9-_. ]/gi, "").replace(/\s+/g, "_").slice(0, 80) || "report";

export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// Multi-sheet XLSX. Each sheet: humanized headers, sensible widths, numbers and
// ISO dates coerced by ExcelJS.
export const downloadXlsx = async (sheets: Sheet[], filename: string) => {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "AION Assistant";
  wb.created = new Date();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31) || "Sheet");
    ws.columns = sheet.columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width ?? Math.min(40, Math.max(12, c.header.length + 4)),
    }));
    ws.getRow(1).font = { bold: true };
    ws.addRows(sheet.rows);
  }
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${sanitizeFilename(filename)}.xlsx`,
  );
};

// Single-sheet CSV (Excel-friendly UTF-8 BOM, RFC-4180 quoting).
export const downloadCsv = (columns: SheetColumn[], rows: Record<string, unknown>[], filename: string) => {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(",")).join("\n");
  downloadBlob(
    new Blob(["﻿" + head + "\n" + body], { type: "text/csv;charset=utf-8" }),
    `${sanitizeFilename(filename)}.csv`,
  );
};

// Render a DOM node (a laid-out report with charts) to a paginated A4 PDF.
export const downloadPdfFromNode = async (node: HTMLElement, filename: string) => {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);
  // Cap the scale so a very tall report never exceeds the browser canvas height
  // limit (~16k px) — that would silently produce a blank/clipped capture.
  const nodeH = node.scrollHeight || node.offsetHeight || 1200;
  const canvas = await html2canvas(node, {
    scale: Math.min(2, Math.max(1, 15000 / nodeH)),
    backgroundColor: "#ffffff",
    useCORS: true,
    allowTaint: false,
    imageTimeout: 20000,
    logging: false,
    // Cross-origin images (e.g. the legacy x-tra.it feed) don't send CORS
    // headers, so html2canvas would taint the canvas and toDataURL would throw.
    // Route every cross-origin image through our CORS-enabled image-proxy so the
    // photos actually appear in the PDF.
    onclone: (doc) => {
      const base = (import.meta.env.VITE_SUPABASE_URL as string) ?? "";
      doc.querySelectorAll("img").forEach((img) => {
        const el = img as HTMLImageElement;
        try {
          const u = new URL(el.src, location.href);
          if (u.protocol === "data:" || u.protocol === "blob:") return; // inline: fine as-is
          if (u.hostname === location.hostname) return;                 // same-origin: fine
          el.crossOrigin = "anonymous";
          if (base) el.src = `${base}/functions/v1/image-proxy?url=${encodeURIComponent(u.href)}`;
        } catch { el.removeAttribute("src"); }
      });
    },
  });
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const imgW = pageW;
  const imgH = (canvas.height * imgW) / canvas.width;

  if (imgH <= pageH) {
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, imgW, imgH);
  } else {
    // Slice the tall canvas into page-height chunks. Each page canvas is sized to
    // its actual slice height (no distortion on the last partial page) and filled
    // white (no black transparent areas in the JPEG).
    const sliceH = Math.floor((canvas.width * pageH) / pageW);
    const pageCanvas = document.createElement("canvas");
    const ctx = pageCanvas.getContext("2d")!;
    let y = 0;
    let first = true;
    while (y < canvas.height) {
      const srcH = Math.min(sliceH, canvas.height - y);
      pageCanvas.width = canvas.width;
      pageCanvas.height = srcH;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, srcH);
      ctx.drawImage(canvas, 0, y, canvas.width, srcH, 0, 0, canvas.width, srcH);
      if (!first) pdf.addPage();
      pdf.addImage(pageCanvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, imgW, (srcH * imgW) / canvas.width);
      y += srcH;
      first = false;
    }
  }
  pdf.save(`${sanitizeFilename(filename)}.pdf`);
};
