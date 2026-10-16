/**
 * Generates a PDF from a plain-text chord sheet string and triggers a browser
 * download.  Uses A4 format with a monospace font so chord alignment is preserved.
 * Pages are added automatically when the content overflows.
 *
 * @param text     - Multi-line plain-text chord sheet (as produced by `sheetToText`).
 * @param filename - Desired output file name; `.pdf` extension is appended if absent.
 */
export async function downloadSheetPdf(text: string, filename: string) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 40;
  const lineHeight = 13;
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = margin;

  const lines = text.split("\n");
  doc.setFont("courier", "normal");
  doc.setFontSize(10);

  for (const line of lines) {
    if (y > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
    const wrapped = doc.splitTextToSize(line || " ", 515) as string[];
    for (const w of wrapped) {
      doc.text(w, margin, y);
      y += lineHeight;
    }
  }
  doc.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}

/**
 * Captures a DOM element as a high-DPI PNG image and triggers a browser download.
 * Renders at 2× pixel ratio against the page's background colour for readability.
 *
 * @param node     - The HTML element to capture (e.g. the chord-sheet container).
 * @param filename - Desired output file name; `.png` extension is appended if absent.
 */
export async function downloadSheetImage(node: HTMLElement, filename: string) {
  const { toPng } = await import("html-to-image");
  const dataUrl = await toPng(node, {
    pixelRatio: 2,
    backgroundColor: getComputedStyle(document.body).backgroundColor || "#0d0f14",
    cacheBust: true,
  });
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename.endsWith(".png") ? filename : `${filename}.png`;
  a.click();
}

/**
 * Creates a plain-text Blob from `text` and triggers a browser download.
 * The temporary object URL is revoked after 1 second to free memory.
 *
 * @param text     - String content to save.
 * @param filename - Desired output file name; `.txt` extension is appended if absent.
 */
export function downloadText(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith(".txt") ? filename : `${filename}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
