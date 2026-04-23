// Helpers to load user attachments (images + PDFs) into a serializable shape
// the chat edge function can consume.

import * as pdfjsLib from "pdfjs-dist";
// Use the bundled worker so we don't depend on a CDN.
// Vite resolves the `?url` import to a static URL.
// @ts-expect-error - vite-specific import
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

(pdfjsLib as any).GlobalWorkerOptions.workerSrc = workerUrl;

export type Attachment =
  | { kind: "image"; name: string; mime: string; dataUrl: string }
  | { kind: "text"; name: string; mime: string; text: string };

export const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15MB

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function extractPdfText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const out: string[] = [];
  const maxPages = Math.min(pdf.numPages, 50);
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const txt = content.items.map((it: any) => it.str).join(" ");
    out.push(`--- Page ${i} ---\n${txt}`);
  }
  return out.join("\n\n");
}

export async function loadAttachment(file: File): Promise<Attachment> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`${file.name} dépasse 15 Mo`);
  }
  if (file.type.startsWith("image/")) {
    const dataUrl = await readAsDataURL(file);
    return { kind: "image", name: file.name, mime: file.type, dataUrl };
  }
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const text = await extractPdfText(file);
    return { kind: "text", name: file.name, mime: "application/pdf", text };
  }
  // Plain-text fallback for common text-y files
  if (
    file.type.startsWith("text/") ||
    /\.(md|txt|json|csv|ya?ml|log|tsx?|jsx?|py|html?|css)$/i.test(file.name)
  ) {
    const text = await file.text();
    return { kind: "text", name: file.name, mime: file.type || "text/plain", text };
  }
  throw new Error(`Format non pris en charge : ${file.name}`);
}
