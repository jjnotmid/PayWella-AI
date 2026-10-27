import PDFDocument from "pdfkit";
import { resolve as filePath } from "node:path";
import { naira } from "./contracts.ts";
import type { Row } from "./db.ts";
export function receiptPdf(receipt: Row): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A5", margin: 32 }),
      parts: Buffer[] = [];
    doc.on("data", (p) => parts.push(p));
    doc.on("end", () => resolve(Buffer.concat(parts)));
    doc.on("error", reject);
    doc.rect(0, 0, 420, 595).fill("#FFFAF3");
    doc.image(filePath("web/public/paywella-logo.png"), 32, 25, {
      fit: [145, 55],
    });
    doc.fillColor("#082F27").fontSize(10).text("PAYMENT RECEIPT", 32, 90);
    doc
      .fillColor("#082F27")
      .fontSize(15)
      .text("Successfully completed", 32, 140);
    doc
      .fontSize(29)
      .text(naira(receipt.amountKobo).replace("₦", "NGN "), 32, 175);
    const rows = [
      ["Service", receipt.label],
      ["To", receipt.destination || "Your savings"],
      ["Status", receipt.status],
      ["Fee", naira(receipt.feeKobo).replace("₦", "NGN ")],
      ["Date", new Date(receipt.createdAt).toUTCString()],
      ["Reference", receipt.reference],
    ];
    let y = 235;
    for (const [label, value] of rows) {
      doc.fillColor("#56635A").fontSize(9).text(label, 32, y);
      doc
        .fillColor("#082F27")
        .fontSize(10)
        .text(String(value), 130, y, { width: 245 });
      y += label === "Reference" ? 44 : 34;
    }
    doc
      .fillColor("#56635A")
      .fontSize(9)
      .text("Test environment. No real bank payment was sent.", 32, 520, {
        width: 350,
      });
    doc.end();
  });
}
