import { useEffect, useState } from "react";

function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduce, setReduce] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setReduce(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduce;
}

/**
 * Decorative looping clip rendered with HyperFrames (see /media). Muted, inline, no controls;
 * shows only the poster still when the visitor asked for less motion.
 */
export function LoopVideo({ name, className = "", width, height }: { name: string; className?: string; width: number; height: number }) {
  const reduce = usePrefersReducedMotion();
  const poster = `/media/${name}.jpg`;
  if (reduce) return <img src={poster} alt="" aria-hidden width={width} height={height} className={className} />;
  return (
    <video
      aria-hidden
      tabIndex={-1}
      className={className}
      src={`/media/${name}.mp4`}
      poster={poster}
      width={width}
      height={height}
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      disablePictureInPicture
    />
  );
}
