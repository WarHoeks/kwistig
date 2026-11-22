import { useEffect, useState, type ReactNode } from "react";

const W = 1920;
const H = 1080;

/**
 * A fixed 1920×1080 canvas scaled to fit the window. Everything inside is laid
 * out in real pixels for a 1080p TV; other sizes (or a 4:3 projector) letterbox.
 */
export function Stage({ children, background }: { children: ReactNode; background?: string }) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / W, window.innerHeight / H));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-hidden bg-black">
      <div
        className="relative shrink-0 overflow-hidden text-white"
        style={{
          width: W,
          height: H,
          transform: `scale(${scale})`,
          transformOrigin: "center",
          background:
            background ??
            "radial-gradient(1200px 800px at 15% 10%, #2d2952 0%, transparent 60%), radial-gradient(1000px 700px at 90% 100%, #3b1d4a 0%, transparent 55%), #0d0b1f",
        }}
      >
        {children}
      </div>
    </div>
  );
}
