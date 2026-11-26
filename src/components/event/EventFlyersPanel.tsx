import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const FORMATS = [
  { key: "event-cover", label: "Capa principal do evento / loja", size: "1200×630" },
  { key: "story-status", label: "Stories / Status — Instagram, Facebook e WhatsApp", size: "1080×1920" },
  { key: "instagram-square", label: "Publicação quadrada — Instagram / Facebook", size: "1080×1080" },
  { key: "instagram-portrait", label: "Publicação vertical — Instagram", size: "1080×1350" },
  { key: "facebook-cover", label: "Capa — Facebook", size: "1640×624" },
  { key: "facebook-link", label: "Publicação / link — Facebook", size: "1200×630" },
  { key: "x-banner", label: "Capa — X / Twitter", size: "1500×500" },
] as const;

type FlyerFile = { name: string; label: string; path: string; url: string };

function safeFileName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-80) || "flyer";
}

function imageType(file: File) {
  if (["image/jpeg", "image/png", "image/webp"].includes(file.type)) return file.type;
  const extension = file.name.toLowerCase().split(".").pop();
  return extension === "jpg" || extension === "jpeg"
    ? "image/jpeg"
    : extension === "png"
      ? "image/png"
      : extension === "webp"
        ? "image/webp"
        : "";
}

export function EventFlyersPanel({ eventId }: { eventId: string }) {
  const qc = useQueryClient();
  const [files, setFiles] = useState<Record<string, File>>({});
  const [customFile, setCustomFile] = useState<File | null>(null);
  const [customWidth, setCustomWidth] = useState("");
  const [customHeight, setCustomHeight] = useState("");
  const [inputKey, setInputKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [applyingPath, setApplyingPath] = useState<string | null>(null);

  const { data: uploaded = [], isLoading, error: listError } = useQuery({
    queryKey: ["event-flyers", eventId],
    queryFn: async () => {
      const { data, error } = await supabase.storage.from("event-flyers").list(eventId, {
        limit: 100,
        sortBy: { column: "created_at", order: "desc" },
      });
      if (error) throw error;
      return Promise.all(
        (data ?? []).filter((file) => file.id).map(async (file) => {
          const path = `${eventId}/${file.name}`;
          const { data: signed, error: signedError } = await supabase.storage
            .from("event-flyers")
            .createSignedUrl(path, 3600);
          if (signedError) throw signedError;
          const [formatKey, dimensions] = file.name.split("--");
          const format = FORMATS.find((item) => item.key === formatKey);
          const label = format
            ? `${format.label} · ${dimensions?.replace("x", "×") ?? ""}`
            : `Personalizado · ${dimensions?.replace("x", "×") ?? "dimensões não registadas"}`;
          return { name: file.name, label, path, url: signed.signedUrl } satisfies FlyerFile;
        }),
      );
    },
  });

  const uploadFiles = async () => {
    const pending = Object.entries(files).map(([key, file]) => ({ key, file }));
    if (customFile && customWidth && customHeight) {
      const width = Number(customWidth);
      const height = Number(customHeight);
      if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
        return toast.error("Indica largura e altura personalizadas válidas.");
      }
      pending.push({ key: `custom-${width}x${height}`, file: customFile });
    } else if (customFile || customWidth || customHeight) {
      return toast.error("Preenche a largura e a altura para o formato personalizado.");
    }
    if (!pending.length) return toast.error("Escolhe pelo menos um ficheiro para carregar.");

    setBusy(true);
    try {
      let successCount = 0;
      const failures: string[] = [];
      for (const { key, file } of pending) {
        try {
          if (file.size > MAX_FILE_SIZE) throw new Error("o ficheiro excede 20 MB");
          const contentType = imageType(file);
          if (!contentType) throw new Error("usa uma imagem JPG, PNG ou WEBP");
          const bitmap = await createImageBitmap(file);
          const dimensions = `${bitmap.width}x${bitmap.height}`;
          bitmap.close();
          const path = `${eventId}/${key}--${dimensions}--${crypto.randomUUID()}-${safeFileName(file.name)}`;
          const { error } = await supabase.storage.from("event-flyers").upload(path, file, {
            contentType,
            upsert: false,
          });
          if (error) throw error;
          successCount++;
          if (key === "event-cover") {
            const { data: publicUrl } = supabase.storage.from("event-flyers").getPublicUrl(path);
            const { error: coverError } = await supabase
              .from("events")
              .update({ cover_url: publicUrl.publicUrl })
              .eq("id", eventId);
            if (coverError) failures.push(`${file.name}: flyer carregado, mas não foi possível definir a capa (${coverError.message})`);
            else await qc.invalidateQueries({ queryKey: ["event", eventId] });
          }
        } catch (error) {
          failures.push(`${file.name}: ${(error as Error).message}`);
        }
      }

      if (successCount) {
        toast.success(`${successCount} formato(s) de divulgação carregado(s)`);
        setFiles({});
        setCustomFile(null);
        setInputKey((key) => key + 1);
        await qc.invalidateQueries({ queryKey: ["event-flyers", eventId] });
        await qc.invalidateQueries({ queryKey: ["events"] });
      }
      for (const failure of failures) toast.error(failure);
    } finally {
      setBusy(false);
    }
  };

  const applyAsTicketArt = async (file: FlyerFile) => {
    if (!confirm("Aplicar esta arte como fundo dos ingressos de todos os grupos deste evento? A posição e o tamanho do QR continuam editáveis e serão preservados.")) return;
    setApplyingPath(file.path);
    let uploadedPath: string | null = null;
    try {
      const { data: groups, error: groupsError } = await supabase
        .from("ticket_groups")
        .select("id")
        .eq("event_id", eventId);
      if (groupsError) throw groupsError;
      if (!groups?.length) throw new Error("Este evento ainda não tem grupos de ingressos.");

      const { data: blob, error: downloadError } = await supabase.storage
        .from("event-flyers")
        .download(file.path);
      if (downloadError || !blob) throw downloadError ?? new Error("Não foi possível ler a arte.");

      const bitmap = await createImageBitmap(blob);
      const width = bitmap.width;
      const height = bitmap.height;
      bitmap.close();

      const extension = file.name.split(".").pop()?.toLowerCase() || "png";
      const contentType = blob.type || (extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "webp" ? "image/webp" : "image/png");
      uploadedPath = `${eventId}/ticket-art-${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from("arts").upload(uploadedPath, blob, {
        contentType,
        upsert: false,
      });
      if (uploadError) throw uploadError;

      const { error: updateError } = await supabase
        .from("ticket_groups")
        .update({ art_path: uploadedPath, art_width: width, art_height: height })
        .eq("event_id", eventId);
      if (updateError) throw updateError;

      toast.success(`Arte aplicada a ${groups.length} grupo(s) de ingressos. Agora já aparece no Editor.`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["groups", eventId] }),
        qc.invalidateQueries({ queryKey: ["group"] }),
      ]);
    } catch (error) {
      if (uploadedPath) await supabase.storage.from("arts").remove([uploadedPath]);
      toast.error(`Não foi possível aplicar a arte aos ingressos: ${(error as Error).message}`);
    } finally {
      setApplyingPath(null);
    }
  };

  const removeFlyer = async (file: FlyerFile) => {
    const { error } = await supabase.storage.from("event-flyers").remove([file.path]);
    if (error) return toast.error(`Não foi possível remover ${file.name}: ${error.message}`);
    toast.success("Formato removido");
    await qc.invalidateQueries({ queryKey: ["event-flyers", eventId] });
  };

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-5">
      <div>
        <h2 className="text-lg font-bold">Flyers para divulgação e arte dos ingressos</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Carrega a versão preparada para cada rede. As dimensões são recomendações; guardamos também as dimensões reais do ficheiro.
          JPG, PNG ou WEBP, até 20 MB por imagem. Depois de carregar a arte oficial, usa “Usar nos ingressos” para a associar aos grupos e fazê-la aparecer no editor de QR.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {FORMATS.map((format) => (
          <label key={format.key} className="space-y-2 rounded-lg border p-3 text-sm">
            <span className="block font-medium">{format.label}</span>
            <span className="block text-xs text-muted-foreground">Recomendado: {format.size}</span>
            <Input
              key={`${inputKey}-${format.key}`}
              type="file"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) setFiles((current) => ({ ...current, [format.key]: file }));
              }}
            />
            {files[format.key] && <span className="block truncate text-xs text-primary">{files[format.key].name}</span>}
          </label>
        ))}
        <div className="space-y-2 rounded-lg border p-3 text-sm">
          <span className="block font-medium">Formato personalizado</span>
          <div className="grid grid-cols-2 gap-2">
            <Input type="number" min={1} step={1} aria-label="Largura personalizada em pixels" placeholder="Largura px" value={customWidth} onChange={(event) => setCustomWidth(event.target.value)} />
            <Input type="number" min={1} step={1} aria-label="Altura personalizada em pixels" placeholder="Altura px" value={customHeight} onChange={(event) => setCustomHeight(event.target.value)} />
          </div>
          <Input
            key={`${inputKey}-custom`}
            type="file"
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            onChange={(event) => setCustomFile(event.target.files?.[0] ?? null)}
          />
          {customFile && <span className="block truncate text-xs text-primary">{customFile.name}</span>}
        </div>
      </div>
      <Button onClick={() => void uploadFiles()} disabled={busy}>
        <Upload className="h-4 w-4" /> {busy ? "A carregar…" : "Carregar formatos selecionados"}
      </Button>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">A carregar formatos guardados…</p>
      ) : listError ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar os flyers guardados: {(listError as Error).message}
        </p>
      ) : uploaded.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {uploaded.map((file) => (
            <div key={file.path} className="flex items-center gap-3 rounded-lg border p-3">
              <div className="min-w-0 flex-1">
                <a href={file.url} target="_blank" rel="noreferrer">
                <img src={file.url} alt={file.name} className="h-24 w-full rounded object-contain bg-muted" />
                </a>
                <span className="mt-2 block truncate text-xs text-muted-foreground">{file.label}</span>
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <Button size="sm" variant="secondary" disabled={!!applyingPath} onClick={() => void applyAsTicketArt(file)}>
                  {applyingPath === file.path ? "A aplicar…" : "Usar nos ingressos"}
                </Button>
                <Button variant="ghost" size="icon" title="Descarregar flyer" asChild>
                  <a href={file.url} download><Download className="h-4 w-4" /></a>
                </Button>
                <Button variant="ghost" size="icon" title="Remover flyer" onClick={() => void removeFlyer(file)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Ainda não foram carregados flyers de divulgação.</p>
      )}
    </section>
  );
}
