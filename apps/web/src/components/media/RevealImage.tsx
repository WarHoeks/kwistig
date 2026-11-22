import { useEffect, useRef, useState } from "react";

type Effect = "none" | "pixelate" | "zoom" | "blur";

/**
 * An image that becomes clear as `progress` goes from 0 to 1.
 * pixelate: big blocks → sharp; zoom: 5× into the centre → full; blur: 40px → 0.
 */
export function RevealImage({
  src,
  effect,
  progress,
  className = "",
  alt = "",
}: {
  src: string;
  effect: Effect;
  progress: number;
  className?: string;
  alt?: string;
}) {
  const p = effect === "none" ? 1 : Math.min(1, Math.max(0, progress));
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  if (failed) {
    return (
      <div className={`flex items-center justify-center bg-white/5 text-[120px] ${className}`} aria-label={alt}>
        🖼️
      </div>
    );
  }
  if (effect === "pixelate" && p < 1) return <PixelatedImage src={src} progress={p} className={className} onError={() => setFailed(true)} />;

  const style =
    effect === "zoom"
      ? { transform: `scale(${1 + (1 - p) * 4})`, transition: "transform 250ms linear" }
      : effect === "blur"
        ? { filter: `blur(${(1 - p) * 40}px)`, transition: "filter 250ms linear" }
        : undefined;
  return (
    <div className={`overflow-hidden ${className}`}>
      <img src={src} alt={alt} className="h-full w-full object-contain" style={style} onError={() => setFailed(true)} draggable={false} />
    </div>
  );
}

function PixelatedImage({ src, progress, className, onError }: { src: string; progress: number; className: string; onError: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState(0);

  useEffect(() => {
    const el = new Image();
    el.onload = () => setLoaded((n) => n + 1);
    el.onerror = onError;
    el.src = src;
    img.current = el;
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = canvas.current;
    const el = img.current;
    if (!c || !el || !el.naturalWidth) return;
    const w = el.naturalWidth;
    const h = el.naturalHeight;
    c.width = w;
    c.height = h;
    // Block size shrinks from 1/12 of the short side to 1 pixel.
    const block = Math.max(1, Math.round((1 - progress) ** 1.5 * (Math.min(w, h) / 12)));
    const sw = Math.max(1, Math.round(w / block));
    const sh = Math.max(1, Math.round(h / block));
    const small = document.createElement("canvas");
    small.width = sw;
    small.height = sh;
    small.getContext("2d")!.drawImage(el, 0, 0, sw, sh);
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, sw, sh, 0, 0, w, h);
  }, [progress, loaded]);

  return (
    <div className={`flex items-center justify-center overflow-hidden ${className}`}>
      <canvas ref={canvas} className="max-h-full max-w-full object-contain" />
    </div>
  );
}
