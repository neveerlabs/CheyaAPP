export interface AiBarcodeReading {
  attachmentId: string;
  format: string;
  text: string;
}

export async function readBarcodeForAi(
  file: File,
): Promise<Omit<AiBarcodeReading, "attachmentId"> | null> {
  if (!file.type.startsWith("image/")) return null;

  const imageUrl = URL.createObjectURL(file);
  try {
    const [{ BrowserMultiFormatReader }, { NotFoundException }] = await Promise.all([
      import("@zxing/browser"),
      import("@zxing/library"),
    ]);
    try {
      const result = await new BrowserMultiFormatReader().decodeFromImageUrl(imageUrl);
      const text = result.getText().slice(0, 4096);
      if (!text) return null;
      return {
        format: String(result.getBarcodeFormat()),
        text,
      };
    } catch (error) {
      if (error instanceof NotFoundException) return null;
      throw error;
    }
  } catch (error) {
    throw new Error(
      `Could not read barcode data from "${file.name}": ${
        error instanceof Error ? error.message : "Unknown image decoding error."
      }`,
    );
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}
