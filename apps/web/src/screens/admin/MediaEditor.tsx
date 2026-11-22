import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { mediaUrl, spotifyTrackId, youTubeId, type Media, type SpotifyTrack } from "@kwistig/shared";
import { api, RequestError } from "../../lib/api";
import { loadYouTubeApi } from "../../components/media/YouTubePlayer";
import { Field, OptionalNumber, setOpt } from "./fields";

type MediaType = Media["type"];

/** Uploads an image file to the media store and returns its quiz reference. */
export async function uploadImage(file: File): Promise<string> {
  const res = await fetch("/api/media/upload", {
    method: "POST",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({}))) as { src?: string; error?: string };
  if (!res.ok || !data.src) throw new RequestError(res.status, data.error ?? "upload_failed");
  return data.src;
}

/** Thumbnail with upload/replace; also accepts a pasted image URL (downloaded on save). */
export function ImageField({
  label,
  value,
  onChange,
  compact = false,
}: {
  label: string;
  value: string | undefined;
  onChange: (src: string) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [value]);

  const pick = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await uploadImage(file));
    } catch (err) {
      setError(t(`editor.mediaErrors.${err instanceof RequestError ? err.code : "upload_failed"}`, { defaultValue: t("errors.generic") }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {label && <p className="label">{label}</p>}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => input.current?.click()}
          className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-ink-600 bg-ink-950 ${compact ? "h-16 w-20" : "h-24 w-32"}`}
          title={t("editor.uploadImage")}
        >
          {value && !broken ? (
            <img src={mediaUrl(value)} alt="" className="h-full w-full object-cover" onError={() => setBroken(true)} />
          ) : (
            <span className="text-2xl text-ink-400">{broken ? "⚠" : "+"}</span>
          )}
        </button>
        <div className="min-w-0 flex-1 space-y-1">
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? t("common.saving") : value ? t("editor.replaceImage") : t("editor.uploadImage")}
          </button>
          {!compact && (
            <input
              className="field py-1 font-mono text-xs"
              placeholder={t("editor.imageUrlPlaceholder")}
              value={value?.startsWith("http") ? value : ""}
              onChange={(e) => e.target.value && onChange(e.target.value.trim())}
            />
          )}
          {broken && value && <p className="text-xs text-red-300">{t("editor.mediaMissing")}</p>}
          {error && <p className="text-xs text-red-300">{error}</p>}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pick(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function defaultMedia(type: MediaType): Media {
  switch (type) {
    case "image":
      return { type, src: "" };
    case "youtube":
      return { type, videoId: "", startSec: 0, endSec: 15 };
    case "spotify":
      return { type, uri: "", startSec: 0, endSec: 20 };
    case "news":
      return { type, url: "https://" };
  }
}

/** Edits one optional media attachment (question media, reveal media, slide media). */
export function MediaEditor({
  label,
  value,
  onChange,
  allowPlayBefore = true,
  slot = "question",
}: {
  label: string;
  value: Media | undefined;
  onChange: (m: Media | undefined) => void;
  allowPlayBefore?: boolean;
  /** "reveal": "before" means after the lock and before the answer is shown. */
  slot?: "question" | "reveal";
}) {
  const { t } = useTranslation();
  const typeId = useId();
  const playId = useId();
  const edit = (fn: (d: Media) => void) => {
    if (!value) return;
    const d = structuredClone(value);
    fn(d);
    onChange(d);
  };

  return (
    <fieldset className="space-y-3 rounded-xl border border-ink-700 p-4">
      <legend className="px-1 text-sm font-semibold text-ink-200">{label}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("editor.mediaType")} htmlFor={typeId}>
          <select
            id={typeId}
            className="field"
            value={value?.type ?? ""}
            onChange={(e) => onChange(e.target.value ? defaultMedia(e.target.value as MediaType) : undefined)}
          >
            <option value="">{t("editor.mediaNone")}</option>
            {(["image", "youtube", "spotify", "news"] as const).map((m) => (
              <option key={m} value={m}>
                {t(`editor.mediaTypes.${m}`)}
              </option>
            ))}
          </select>
        </Field>
        {value && allowPlayBefore && (
          <Field label={t("editor.mediaPlay")} htmlFor={playId}>
            <select
              id={playId}
              className="field"
              value={value.play ?? "with"}
              onChange={(e) => edit((d) => setOpt(d, "play", e.target.value === "before" ? "before" : undefined))}
            >
              <option value="with">{slot === "reveal" ? t("editor.revealWith") : t("editor.playWith")}</option>
              <option value="before">{slot === "reveal" ? t("editor.revealBefore") : t("editor.playBefore")}</option>
            </select>
          </Field>
        )}
      </div>

      {value?.type === "image" && (
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <ImageField label="" value={value.src || undefined} onChange={(src) => edit((d) => d.type === "image" && (d.src = src))} />
          <Field label={t("editor.revealEffect")}>
            <select
              className="field"
              value={value.reveal ?? "none"}
              onChange={(e) =>
                edit((d) => d.type === "image" && setOpt(d, "reveal", e.target.value === "none" ? undefined : (e.target.value as "pixelate")))
              }
            >
              {(["none", "pixelate", "zoom", "blur"] as const).map((r) => (
                <option key={r} value={r}>
                  {t(`editor.reveal.${r}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      {value?.type === "youtube" && <YouTubeFields value={value} edit={edit} />}

      {value?.type === "spotify" && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <Field label={t("editor.spotifyUri")}>
              <input
                className="field font-mono text-sm"
                placeholder="https://open.spotify.com/track/…"
                value={value.uri}
                onChange={(e) => edit((d) => d.type === "spotify" && (d.uri = e.target.value.trim()))}
              />
            </Field>
            <SpotifyTrackCheck uri={value.uri} endSec={value.endSec} />
          </div>
          <StartEnd value={value} edit={edit} />
          <p className="text-xs text-ink-400 sm:col-span-3">{t("editor.spotifyHint")}</p>
        </div>
      )}

      {value?.type === "news" && <NewsFields value={value} edit={edit} />}
    </fieldset>
  );
}

/** Shows which track a pasted Spotify link is, read from Spotify (needs a connected account). */
function SpotifyTrackCheck({ uri, endSec }: { uri: string; endSec: number | undefined }) {
  const { t } = useTranslation();
  const id = spotifyTrackId(uri);
  const [result, setResult] = useState<{ ok: true; track: SpotifyTrack } | { ok: false; code: string } | null>(null);

  useEffect(() => {
    setResult(null);
    if (!id) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api<SpotifyTrack>(`/spotify/tracks/${id}`)
        .then((track) => !cancelled && setResult({ ok: true, track }))
        .catch((err) => !cancelled && setResult({ ok: false, code: err instanceof RequestError ? err.code : "spotify_api_error" }));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id]);

  if (!uri) return null;
  if (!id) return <p className="mt-1 text-sm text-red-300">⚠ {t("editor.spotifyBadLink")}</p>;
  if (!result) return <p className="mt-1 text-sm text-ink-400">{t("editor.youtubeChecking")}</p>;
  if (!result.ok) return <p className="mt-1 text-sm text-gold-300">⚠ {t(`spotify.errors.${result.code}`, { defaultValue: t("errors.generic") })}</p>;
  const dur = Math.round(result.track.durationMs / 1000);
  return (
    <p className="mt-1 text-sm text-emerald-300" data-testid="spotify-check">
      ✓ {result.track.artists.join(", ")} — {result.track.name} ({Math.floor(dur / 60)}:{String(dur % 60).padStart(2, "0")})
      {endSec !== undefined && endSec > dur && <span className="ml-2 text-red-300">{t("editor.endAfterTrack")}</span>}
    </p>
  );
}

function StartEnd({ value, edit }: { value: Extract<Media, { type: "youtube" | "spotify" }>; edit: (fn: (d: Media) => void) => void }) {
  const { t } = useTranslation();
  return (
    <>
      <OptionalNumber
        label={t("editor.startSec")}
        value={value.startSec}
        min={0}
        step="any"
        onChange={(v) => edit((d) => (d.type === "youtube" || d.type === "spotify") && setOpt(d, "startSec", v))}
      />
      <OptionalNumber
        label={t("editor.endSec")}
        value={value.endSec}
        min={0}
        step="any"
        onChange={(v) => edit((d) => (d.type === "youtube" || d.type === "spotify") && setOpt(d, "endSec", v))}
      />
    </>
  );
}

type Check = { state: "idle" | "checking" } | { state: "ok"; title: string } | { state: "error"; error: string };

function YouTubeFields({ value, edit }: { value: Extract<Media, { type: "youtube" }>; edit: (fn: (d: Media) => void) => void }) {
  const { t } = useTranslation();
  const id = youTubeId(value.videoId);
  const [check, setCheck] = useState<Check>({ state: "idle" });

  // Embed check: runs whenever the video changes (and so on every save of this item).
  useEffect(() => {
    if (!id) {
      setCheck({ state: "idle" });
      return;
    }
    let cancelled = false;
    setCheck({ state: "checking" });
    const timer = setTimeout(() => {
      api<{ ok: true; title: string } | { ok: false; error: string }>("/media/youtube/check", { method: "POST", body: { videoId: id } })
        .then((r) => !cancelled && setCheck(r.ok ? { state: "ok", title: r.title } : { state: "error", error: r.error }))
        .catch(() => !cancelled && setCheck({ state: "error", error: "unreachable" }));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id]);

  return (
    <div className="space-y-3">
      <Field label={t("editor.youtubeUrl")}>
        <input
          className="field font-mono text-sm"
          placeholder="https://www.youtube.com/watch?v=…"
          value={value.videoId}
          onChange={(e) => edit((d) => d.type === "youtube" && (d.videoId = e.target.value.trim()))}
        />
      </Field>
      <p className="text-sm" data-testid="youtube-check">
        {check.state === "checking" && <span className="text-ink-400">{t("editor.youtubeChecking")}</span>}
        {check.state === "ok" && <span className="text-emerald-300">✓ {check.title}</span>}
        {check.state === "error" && <span className="text-red-300">⚠ {t(`editor.youtubeErrors.${check.error}`)}</span>}
        {!id && value.videoId && <span className="text-red-300">⚠ {t("editor.youtubeErrors.invalid_id")}</span>}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <StartEnd value={value} edit={edit} />
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input
            type="checkbox"
            className="accent-amber-400"
            checked={value.hideVideo ?? false}
            onChange={(e) => edit((d) => d.type === "youtube" && setOpt(d, "hideVideo", e.target.checked || undefined))}
          />
          {t("editor.hideVideo")}
        </label>
      </div>
      {id && <YouTubePreview videoId={id} startSec={value.startSec ?? 0} endSec={value.endSec} />}
    </div>
  );
}

/** Small player to test the start and end markers in the editor. */
function YouTubePreview({ videoId, startSec, endSec }: { videoId: string; startSec: number; endSec: number | undefined }) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<{ loadVideoById(o: object): void; pauseVideo(): void; getCurrentTime(): number; destroy(): void } | null>(null);
  const [time, setTime] = useState<number | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const el = document.createElement("div");
    host.current.appendChild(el);
    let cancelled = false;
    void loadYouTubeApi().then((YT) => {
      if (cancelled) return;
      player.current = new YT.Player(el, { width: "100%", height: "100%", videoId, playerVars: { start: Math.floor(startSec), rel: 0, playsinline: 1 } });
    });
    return () => {
      cancelled = true;
      player.current?.destroy();
      player.current = null;
      el.remove();
    };
  }, [videoId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show the playhead so start/end can be read off while testing.
  useEffect(() => {
    const timer = setInterval(() => {
      const p = player.current;
      if (!p || typeof p.getCurrentTime !== "function") return;
      const now = p.getCurrentTime();
      setTime(now);
      if (endSec !== undefined && now >= endSec) p.pauseVideo();
    }, 250);
    return () => clearInterval(timer);
  }, [endSec]);

  return (
    <div className="space-y-2">
      <div ref={host} className="aspect-video w-full max-w-md overflow-hidden rounded-lg bg-black" />
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => player.current?.loadVideoById({ videoId, startSeconds: startSec, ...(endSec !== undefined ? { endSeconds: endSec } : {}) })}
        >
          ▶ {t("editor.testClip")}
        </button>
        {time !== null && <span className="font-mono text-sm text-ink-400">{time.toFixed(1)} s</span>}
      </div>
    </div>
  );
}

function NewsFields({ value, edit }: { value: Extract<Media, { type: "news" }>; edit: (fn: (d: Media) => void) => void }) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<{ headline: string | null; image: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchNow = async (refresh: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setPreview(await api("/media/news", { method: "POST", body: { url: value.url, refresh } }));
    } catch (err) {
      setError(t(`editor.mediaErrors.${err instanceof RequestError ? err.code : "fetch_failed"}`, { defaultValue: t("errors.generic") }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Field label={t("editor.newsUrl")}>
        <div className="flex gap-2">
          <input className="field font-mono text-sm" value={value.url} onChange={(e) => edit((d) => d.type === "news" && (d.url = e.target.value.trim()))} />
          <button type="button" className="btn-ghost btn-sm shrink-0" disabled={busy} onClick={() => void fetchNow(!!preview)}>
            {t("editor.fetchNews")}
          </button>
        </div>
      </Field>
      <Field label={t("editor.blankWord")}>
        <input
          className="field"
          value={value.blankWord ?? ""}
          onChange={(e) => edit((d) => d.type === "news" && setOpt(d, "blankWord", e.target.value.trim() || undefined))}
        />
      </Field>
      {error && <p className="text-sm text-red-300">{error}</p>}
      {preview && (
        <div className="flex gap-3 rounded-lg bg-white p-3 text-ink-950">
          {preview.image && <img src={preview.image} alt="" className="h-16 w-24 rounded object-cover" />}
          <p className="font-serif font-bold">{preview.headline ?? t("editor.noHeadline")}</p>
        </div>
      )}
    </div>
  );
}
