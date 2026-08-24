import { useEffect, useRef, useState } from "react";

const NUDGE_MS = 900;
const WHALE_SRC = "/whale-mascot.png";
const MIN_BOOT_MS = 900;

/** Fade out the HTML boot splash once (shared across auth + board load). */
export function dismissBootSplash() {
  const el = document.getElementById("boot-splash");
  if (!el || el.dataset.done === "1") return Promise.resolve();
  el.dataset.done = "1";

  const started = typeof window.__bootSplashAt === "number" ? window.__bootSplashAt : Date.now();
  const wait = Math.max(0, MIN_BOOT_MS - (Date.now() - started));

  return new Promise((resolve) => {
    window.setTimeout(() => {
      el.classList.add("is-done");
      window.setTimeout(() => {
        el.remove();
        resolve();
      }, 360);
    }, wait);
  });
}

/** Tiny corner whale — always visible; swims on clicks and while saving / loading. */
export default function BusyWhale({ busy }) {
  const [moving, setMoving] = useState(!!busy);
  const busyRef = useRef(!!busy);
  const idleTimerRef = useRef(null);

  busyRef.current = !!busy;

  const stayMoving = () => {
    setMoving(true);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      if (!busyRef.current) setMoving(false);
    }, NUDGE_MS);
  };

  useEffect(() => {
    if (busy) {
      setMoving(true);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      return undefined;
    }
    idleTimerRef.current = setTimeout(() => setMoving(false), NUDGE_MS);
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [busy]);

  useEffect(() => {
    const onInteract = () => stayMoving();
    document.addEventListener("pointerdown", onInteract, true);
    document.addEventListener("keydown", onInteract, true);
    return () => {
      document.removeEventListener("pointerdown", onInteract, true);
      document.removeEventListener("keydown", onInteract, true);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, []);

  return (
    <div
      className={`busy-whale${moving ? " is-moving" : ""}`}
      role="status"
      aria-live="polite"
      aria-label={moving ? "Working" : undefined}
    >
      <style>{`
        .busy-whale {
          position: fixed;
          left: 12px;
          bottom: 12px;
          z-index: 10000;
          pointer-events: none;
          width: 52px;
          height: 37px;
          opacity: 1;
        }
        .busy-whale img {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: contain;
          transform-origin: 40% 60%;
          transform: translate3d(0, 0, 0);
          user-select: none;
          -webkit-user-drag: none;
        }
        .busy-whale.is-moving img {
          animation: busy-whale-swim 0.95s ease-in-out infinite;
          will-change: transform;
        }
        @keyframes busy-whale-swim {
          0%   { transform: translate3d(0, 0, 0) rotate(-1.5deg); }
          50%  { transform: translate3d(3px, -3px, 0) rotate(1.5deg); }
          100% { transform: translate3d(0, 0, 0) rotate(-1.5deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .busy-whale.is-moving img { animation: none; }
        }
      `}</style>
      <img src={WHALE_SRC} alt="" width={52} height={37} decoding="async" />
    </div>
  );
}
