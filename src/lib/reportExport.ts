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

// Rewrite cross-origin images through the CORS image-proxy in a cloned doc, so
// photos (incl. the no-CORS x-tra.it feed) don't taint the canvas / vanish.
const proxyImagesInClone = (doc: Document) => {
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
};

// Render a laid-out report to a paginated A4 PDF. Paginates BLOCK BY BLOCK (each
// [data-block] element — the header and each section) so a table/card never gets
// sliced across a page break; a single block taller than a page is sliced only
// as a last resort. Adds a branded footer (brand + page number) to each page.
export const downloadPdfFromNode = async (
  node: HTMLElement, filename: string, opts?: { footer?: string },
) => {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);
  const blocks = Array.from(node.querySelectorAll<HTMLElement>("[data-block]"));
  const targets = blocks.length ? blocks : [node];

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const M = 12;                       // page margin
  const contentW = pageW - M * 2;
  const bottom = pageH - M;           // usable bottom (footer sits below)
  let y = M;
  let page = 1;

  const footer = () => {
    if (!opts?.footer) return;
    pdf.setFontSize(7);
    pdf.setTextColor(150);
    pdf.text(opts.footer, M, pageH - 6);
    pdf.text(String(page), pageW - M, pageH - 6, { align: "right" });
  };
  const newPage = () => { footer(); pdf.addPage(); page++; y = M; };

  for (const el of targets) {
    const h = el.scrollHeight || el.offsetHeight || 400;
    const canvas = await html2canvas(el, {
      scale: Math.min(2, Math.max(1, 15000 / h)),
      backgroundColor: "#ffffff",
      useCORS: true, allowTaint: false, imageTimeout: 20000, logging: false,
      onclone: proxyImagesInClone,
    });
    const imgH = (canvas.height * contentW) / canvas.width;

    if (imgH <= bottom - M) {
      if (y + imgH > bottom && y > M) newPage();
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", M, y, contentW, imgH);
      y += imgH + 4;
    } else {
      // Block taller than a full page — slice just this one across pages.
      const sliceH = Math.floor((canvas.width * (bottom - M)) / contentW);
      const pc = document.createElement("canvas");
      const ctx = pc.getContext("2d")!;
      let sy = 0;
      while (sy < canvas.height) {
        const srcH = Math.min(sliceH, canvas.height - sy);
        pc.width = canvas.width; pc.height = srcH;
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, srcH);
        ctx.drawImage(canvas, 0, sy, canvas.width, srcH, 0, 0, canvas.width, srcH);
        const chunkH = (srcH * contentW) / canvas.width;
        if (y + chunkH > bottom && y > M) newPage();
        pdf.addImage(pc.toDataURL("image/jpeg", 0.92), "JPEG", M, y, contentW, chunkH);
        y += chunkH + 2;
        sy += srcH;
      }
    }
  }
  footer();
  pdf.save(`${sanitizeFilename(filename)}.pdf`);
};
