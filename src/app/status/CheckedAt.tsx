"use client";

import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/** The time the checks ran, in the reader's own time zone. The server's first render names UTC until the browser takes over. */
export function CheckedAt({ iso }: { iso: string }) {
  const d = new Date(iso);
  const text = useSyncExternalStore(
    noSubscribe,
    () => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }),
    () => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "UTC", timeZoneName: "short" }),
  );
  return <time dateTime={iso}>{text}</time>;
}
