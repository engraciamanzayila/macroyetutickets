// Converts uploaded artwork (PDF, TIFF, JPG, PNG, WEBP…) to a PNG blob in the browser.
export type ProcessedArt = {
  blob: Blob;
  width: number;
  height: number;
  widthCm: number | null;
  heightCm: number | null;
  previewUrl: string;
};

const MAX_SIDE = 4200;

function canvasToBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/png"));
}

async function fromPdf(file: File): Promise<ProcessedArt> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(300 / 72, MAX_SIDE / Math.max(base.width, base.height));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport: vp } as never).promise;
  const blob = await canvasToBlob(canvas);
  return {
    blob,
    width: canvas.width,
    height: canvas.height,
    widthCm: +((base.width / 72) * 2.54).toFixed(2),
    heightCm: +((base.height / 72) * 2.54).toFixed(2),
    previewUrl: URL.createObjectURL(blob),
  };
}

async function fromTiff(file: File): Promise<ProcessedArt> {
  const UTIF = (await import("utif2")).default as unknown as {
    decode: (b: ArrayBuffer) => Array<{ width: number; height: number }>;
    decodeImage: (b: ArrayBuffer, ifd: unknown) => void;
    toRGBA8: (ifd: unknown) => Uint8Array;
  };
  const buf = await file.arrayBuffer();
  const ifds = UTIF.decode(buf);
  UTIF.decodeImage(buf, ifds[0]);
  const rgba = UTIF.toRGBA8(ifds[0]);
  const { width, height } = ifds[0];
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer), width, height), 0, 0);
  return fromCanvas(canvas);
}

async function fromCanvas(src: HTMLCanvasElement | ImageBitmap): Promise<ProcessedArt> {
  const scale = Math.min(1, MAX_SIDE / Math.max(src.width, src.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(src.width * scale);
  canvas.height = Math.round(src.height * scale);
  canvas.getContext("2d")!.drawImage(src, 0, 0, canvas.width, canvas.height);
  const blob = await canvasToBlob(canvas);
  return {
    blob,
    width: canvas.width,
    height: canvas.height,
    widthCm: null,
    heightCm: null,
    previewUrl: URL.createObjectURL(blob),
  };
}

export async function processArt(file: File): Promise<ProcessedArt> {
  const n = file.name.toLowerCase();
  if (file.type === "application/pdf" || n.endsWith(".pdf")) return fromPdf(file);
  if (file.type === "image/tiff" || /\.tiff?$/.test(n)) return fromTiff(file);
  const bmp = await createImageBitmap(file);
  return fromCanvas(bmp);
}

export const ACCEPTED = ".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.gif,.bmp";
