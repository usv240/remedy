"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The showcase's looping clip. It plays only while it is on screen, and a visible Pause button stops it for good
 * (WCAG 2.2.2). With reduced motion the CSS hides it and shows the still poster instead.
 */
export function LoopVideo({ src, poster, width, height }: { src: string; poster: string; width: number; height: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  const stopped = useRef(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !stopped.current) v.play().catch(() => {});
        else v.pause();
      },
      { threshold: 0.25 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, []);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) {
      stopped.current = false;
      v.play().catch(() => {});
    } else {
      stopped.current = true;
      v.pause();
    }
  };

  return (
    <div className="loop-wrap">
      <video
        ref={ref}
        className="loop-video"
        muted
        loop
        playsInline
        preload="metadata"
        poster={poster}
        aria-hidden="true"
        width={width}
        height={height}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      >
        <source src={src} type="video/webm" />
      </video>
      <button type="button" className="loop-toggle" onClick={toggle} aria-label={playing ? "Pause the video" : "Play the video"} data-playing={playing ? "" : undefined}>
        <span className="loop-icon" aria-hidden="true" />
        {playing ? "Pause" : "Play"}
      </button>
    </div>
  );
}
