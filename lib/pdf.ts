/**
 * PDF text extraction via pdf-parse v2.
 *
 * pdf-parse v2 replaced the old default-function API with a `PDFParse` class.
 * Constructor takes `{ data: Uint8Array }`; `getText()` returns `{ text, pages, total }`.
 */
import { PDFParse } from "pdf-parse";

export async function extractPdfText(
  buffer: Buffer,
): Promise<{ text: string; pageCount: number }> {
  // IMPORTANT: pdfjs-dist (under pdf-parse) transfers the underlying
  // ArrayBuffer to a worker, which DETACHES the original. If we hand it our
  // caller's buffer, the caller's buffer dies — any downstream use
  // (e.g. an R2 upload in the same request) throws
  // "Cannot perform Construct on a detached ArrayBuffer".
  // So we give pdf-parse an independent copy and leave the original intact.
  const data = Uint8Array.from(buffer);
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    return { text: (result.text ?? "").trim(), pageCount: result.total ?? result.pages?.length ?? 0 };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}
