import PDFDocument from "pdfkit";
import { fileURLToPath } from "node:url";
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
    doc.image(
      fileURLToPath(
        new URL("../web/public/paywella-logo.png", import.meta.url),
      ),
      32,
      25,
      {
        fit: [145, 55],
      },
    );
    doc
      .fillColor("#082F27")
      .fontSize(10)
      .text(
        receipt.kind === "ajo_cash"
          ? "CASH COLLECTION RECORD"
          : "PAYMENT RECEIPT",
        32,
        90,
      );
    doc
      .fillColor("#082F27")
      .fontSize(15)
      .text(
        receipt.kind === "ajo_cash"
          ? "Cash recorded successfully"
          : "Successfully completed",
        32,
        140,
      );
    doc
      .fontSize(29)
      .text(naira(receipt.amountKobo).replace("₦", "NGN "), 32, 175);
    const rows = [
      ["Service", receipt.label],
      ...(receipt.recipient
        ? [
            ["Recipient", receipt.recipient.name],
            ["Bank", receipt.recipient.bankName],
            ["Account number", receipt.recipient.accountNumber],
          ]
        : [["To", receipt.destination || "Your savings"]]),
      ["Status", receipt.status],
      ["Fee", naira(receipt.feeKobo).replace("₦", "NGN ")],
      ["Date", new Date(receipt.createdAt).toUTCString()],
      ["Reference", receipt.reference],
      ...(receipt.allocation
        ? receipt.allocation.periods.map((period: any) => [
            period.date,
            naira(period.amountKobo).replace("₦", "NGN ") +
              (period.remainingKobo
                ? "; still due " +
                  naira(period.remainingKobo).replace("₦", "NGN ")
                : "; day covered"),
          ])
        : []),
      ...(receipt.electricityToken
        ? [["Electricity token", receipt.electricityToken]]
        : []),
    ];
    let y = 225;
    for (const [label, value] of rows) {
      doc.fontSize(10);
      const height = Math.max(
        26,
        doc.heightOfString(String(value), { width: 245 }) + 12,
      );
      if (y + height > 525) {
        doc.addPage();
        doc.rect(0, 0, 420, 595).fill("#FFFAF3");
        y = 40;
      }
      doc.fillColor("#56635A").fontSize(9).text(label, 32, y);
      doc
        .fillColor("#082F27")
        .fontSize(10)
        .text(String(value), 130, y, { width: 245 });
      y += height;
    }
    doc
      .fillColor("#56635A")
      .fontSize(9)
      .text("Test environment. No real bank payment was sent.", 32, 550, {
        width: 350,
      });
    doc.end();
  });
}
