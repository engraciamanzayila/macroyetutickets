import { useEffect, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { TicketFileFormat } from "@/lib/ticket-files";
import {
  canShareFiles,
  openWhatsAppWithDownloads,
  shareFilesThroughDevice,
  type WhatsAppFilePayload,
} from "@/lib/whatsapp-share";

const FORMATS: { value: TicketFileFormat; label: string }[] = [
  { value: "pdf", label: "PDF" },
  { value: "jpeg", label: "JPEG" },
  { value: "png", label: "PNG" },
  { value: "tiff", label: "TIFF" },
];

type Props = {
  onPrepare: (format: TicketFileFormat) => Promise<WhatsAppFilePayload>;
  onConfirm: (payload: WhatsAppFilePayload) => Promise<void>;
  disabled?: boolean;
  onLockChange?: (locked: boolean) => void;
  title: string;
  format?: TicketFileFormat;
  onFormatChange?: (format: TicketFileFormat) => void;
  prepareLabel?: string;
  formats?: TicketFileFormat[];
};

type Working = "prepare" | "native" | "fallback" | "confirm" | null;

export function WhatsAppShareFlow({
  onPrepare,
  onConfirm,
  disabled = false,
  onLockChange,
  title,
  format,
  onFormatChange,
  prepareLabel = "Preparar ficheiros para WhatsApp",
  formats,
}: Props) {
  const [localFormat, setLocalFormat] = useState<TicketFileFormat>("pdf");
  const currentFormat = format ?? localFormat;
  const [prepared, setPrepared] = useState<WhatsAppFilePayload | null>(null);
  const [pending, setPending] = useState<WhatsAppFilePayload | null>(null);
  const [working, setWorking] = useState<Working>(null);
  const locked = !!prepared || !!pending || !!working;
  const lockChange = useRef(onLockChange);

  useEffect(() => {
    lockChange.current = onLockChange;
  }, [onLockChange]);

  useEffect(() => {
    lockChange.current?.(locked);
  }, [locked]);

  const changeFormat = (next: TicketFileFormat) => {
    if (onFormatChange) onFormatChange(next);
    else setLocalFormat(next);
    setPrepared(null);
  };

  const prepare = async () => {
    if (disabled || working || prepared || pending) return;
    setWorking("prepare");
    try {
      const payload = await onPrepare(currentFormat);
      if (!payload.files.length || !payload.ticketIds.length)
        throw new Error("Não há ingressos disponíveis para preparar.");
      setPrepared(payload);
      toast.success(
        `${payload.files.length} ficheiro(s) ${currentFormat.toUpperCase()} preparado(s).`,
      );
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setWorking(null);
    }
  };

  const shareNative = async () => {
    if (!prepared || working) return;
    setWorking("native");
    try {
      await shareFilesThroughDevice(prepared, title);
      setPending(prepared);
      setPrepared(null);
      toast.info(
        "Escolha WhatsApp e o destinatário no menu do dispositivo. Depois de tocar em Enviar, confirme nesta página.",
      );
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") toast.error((error as Error).message);
    } finally {
      setWorking(null);
    }
  };

  const shareFallback = () => {
    if (!prepared || working) return;
    setWorking("fallback");
    try {
      openWhatsAppWithDownloads(prepared);
      setPending(prepared);
      setPrepared(null);
      toast.info(
        "Os ficheiros foram descarregados separadamente. Anexe-os no WhatsApp e confirme aqui só depois de enviar.",
      );
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setWorking(null);
    }
  };

  const confirmSent = async () => {
    if (!pending || working) return;
    setWorking("confirm");
    try {
      await onConfirm(pending);
      setPending(null);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">Formato</span>
          <select
            value={currentFormat}
            disabled={disabled || locked}
            onChange={(event) => changeFormat(event.target.value as TicketFileFormat)}
            className="h-9 rounded-md border border-input bg-background px-3"
            aria-label="Formato do ficheiro para WhatsApp"
          >
            {FORMATS.filter((item) => !formats || formats.includes(item.value)).map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          disabled={disabled || !!working || !!prepared || !!pending}
          onClick={() => void prepare()}
        >
          <MessageCircle className="h-4 w-4" />
          {working === "prepare" ? "A preparar…" : prepareLabel}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Cada ingresso é criado num ficheiro individual. Em dispositivos compatíveis, pode partilhar
        os anexos diretamente; caso contrário, os ficheiros são descarregados um a um e devem ser
        anexados manualmente. O site não envia a mensagem por si.
      </p>
      {prepared && (
        <div className="space-y-2 rounded-md bg-secondary/60 p-3">
          <p className="text-sm font-medium">
            {prepared.files.length} ficheiro(s) {currentFormat.toUpperCase()} pronto(s)
          </p>
          <p className="text-xs text-muted-foreground">
            Os anexos não incluem códigos ou links no texto da mensagem. Escolha o contacto no
            WhatsApp e toque em Enviar.
          </p>
          <div className="flex flex-wrap gap-2">
            {canShareFiles(prepared.files) && (
              <Button type="button" disabled={!!working} onClick={() => void shareNative()}>
                {working === "native" ? "A abrir partilha…" : "Partilhar ficheiros"}
              </Button>
            )}
            <Button type="button" variant="secondary" disabled={!!working} onClick={shareFallback}>
              {working === "fallback"
                ? "A abrir WhatsApp…"
                : "Descarregar ficheiros e abrir WhatsApp"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={!!working}
              onClick={() => setPrepared(null)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {pending && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 p-3">
          <p className="flex-1 text-sm">
            Confirme apenas depois de enviar os {pending.ticketIds.length} ingresso(s) em anexo. Se
            não enviou, cancele sem alterar o estado dos ingressos.
          </p>
          <Button type="button" disabled={!!working} onClick={() => void confirmSent()}>
            {working === "confirm" ? "A guardar…" : "Confirmar que enviei"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={!!working}
            onClick={() => setPending(null)}
          >
            Ainda não enviei
          </Button>
        </div>
      )}
    </div>
  );
}

export type { WhatsAppFilePayload };
