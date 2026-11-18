export type WhatsAppFilePayload = {
  files: File[];
  ticketIds: string[];
  message: string;
  contact?: string | null;
};

function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function canShareFiles(files: File[]) {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.share !== "function" ||
    typeof navigator.canShare !== "function"
  )
    return false;
  try {
    return navigator.canShare({ files });
  } catch {
    return false;
  }
}

export async function shareFilesThroughDevice(payload: WhatsAppFilePayload, title: string) {
  if (!canShareFiles(payload.files))
    throw new Error("Este dispositivo não permite partilhar estes ficheiros diretamente.");
  await navigator.share({ title, text: payload.message, files: payload.files });
}

/** Trigger a separate browser download for each selected ticket file. */
export function downloadFilesIndividually(files: File[]) {
  if (!files.length) throw new Error("Não há ficheiros para descarregar.");
  files.forEach((file, index) => {
    window.setTimeout(() => downloadFile(file), index * 150);
  });
}

/** Fallback for browsers without file sharing: download files separately, then open WhatsApp with text only. */
export function openWhatsAppWithDownloads(payload: WhatsAppFilePayload) {
  if (!payload.files.length) throw new Error("Não há ficheiros para partilhar.");
  const tab = window.open("about:blank", "_blank");
  if (!tab) throw new Error("Permita pop-ups para abrir o WhatsApp.");
  tab.opener = null;
  try {
    downloadFilesIndividually(payload.files);
    const digits = (payload.contact ?? "").replace(/\D/g, "");
    if (digits && digits.length < 9)
      throw new Error(
        "Indique um número de WhatsApp válido ou deixe o campo vazio para escolher o contacto no WhatsApp.",
      );
    const phone = digits.length === 9 ? `244${digits}` : digits;
    const path = phone ? `/${phone}` : "/";
    tab.location.href = `https://wa.me${path}?text=${encodeURIComponent(payload.message)}`;
  } catch (error) {
    tab.close();
    throw error;
  }
}
