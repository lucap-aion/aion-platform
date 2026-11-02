import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

// The page a prospect lands on from a per-recipient link to the demo film (/watch/<token>).
//
// Nobody is signed in here. The token is the whole credential: watch-demo checks it, signs
// a short URL for the brand's film and records the opening; the player then reports the
// furthest second reached, so the admin's Demo panel can say "opened, watched 85%" rather
// than nothing. Quiet, dark, the house's logo and AION's: the film is the point.

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/watch-demo`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

type Opened = {
  ok: true;
  view_id: string | null;
  video_url: string;
  recorded_at: string;
  recipient_name: string;
  brand: { name: string; slug: string; logo: string | null };
};

async function call(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(FUNCTIONS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify(body),
  });
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

export default function WatchDemo() {
  const { token = "" } = useParams();
  const [state, setState] = useState<"loading" | "ready" | "gone" | "nofilm">("loading");
  const [opened, setOpened] = useState<Opened | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSent = useRef(0);

  useEffect(() => {
    let live = true;
    document.title = "AION — demo";
    void (async () => {
      const data = await call({ action: "open", token });
      if (!live) return;
      if (data.ok) { setOpened(data as Opened); setState("ready"); }
      else if (data.error === "no film") setState("nofilm");
      else setState("gone");
    })();
    return () => { live = false; };
  }, [token]);

  // Progress: every ten seconds while playing, on pause and on end, and once more as the
  // page goes away (sendBeacon, text/plain — a JSON blob would need a preflight the
  // unloading page cannot wait for; the function parses the text).
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !opened?.view_id) return;
    const payload = (completed = false) => ({
      action: "progress", token, view_id: opened.view_id,
      position_s: Math.round(v.currentTime * 10) / 10,
      duration_s: Number.isFinite(v.duration) ? Math.round(v.duration * 10) / 10 : null,
      completed,
    });
    const send = (completed = false) => { lastSent.current = Date.now(); void call(payload(completed)); };
    const onTime = () => { if (Date.now() - lastSent.current > 10_000) send(); };
    const onPause = () => send();
    const onEnded = () => send(true);
    const onHide = () => {
      if (document.visibilityState !== "hidden") return;
      try { navigator.sendBeacon(`${FUNCTIONS_URL}?apikey=${encodeURIComponent(ANON_KEY)}`, JSON.stringify(payload())); } catch { /* best effort */ }
    };
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnded);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnded);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [opened, token]);

  return (
    <div className="min-h-screen bg-[#1c1917] text-[#f7f4ee]" style={{ fontFamily: "'DM Sans', ui-sans-serif, system-ui, sans-serif" }}>
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-8 sm:px-8">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {opened?.brand.logo ? (
              <img src={opened.brand.logo} alt={opened.brand.name} className="h-9 max-w-[180px] object-contain brightness-0 invert" />
            ) : opened ? (
              <span className="text-lg tracking-wide">{opened.brand.name}</span>
            ) : null}
            {opened && <span className="text-[#CB9D4D]">×</span>}
            <span className="text-xl font-semibold tracking-[0.18em]" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>AION</span>
          </div>
          {opened && (
            <p className="text-xs text-[#f7f4ee]/60">For {opened.recipient_name}</p>
          )}
        </header>

        <main className="flex flex-1 flex-col justify-center py-8">
          {state === "loading" && <p className="text-center text-sm text-[#f7f4ee]/60">Opening the film…</p>}
          {state === "gone" && (
            <div className="mx-auto max-w-md text-center">
              <p className="text-lg">This link is no longer active.</p>
              <p className="mt-2 text-sm text-[#f7f4ee]/60">Ask the person who sent it for a new one.</p>
            </div>
          )}
          {state === "nofilm" && (
            <div className="mx-auto max-w-md text-center">
              <p className="text-lg">The film is not ready yet.</p>
              <p className="mt-2 text-sm text-[#f7f4ee]/60">Try again in a little while.</p>
            </div>
          )}
          {state === "ready" && opened && (
            <>
              <video
                ref={videoRef}
                src={opened.video_url}
                controls
                playsInline
                preload="metadata"
                className="w-full rounded-xl border border-white/10 bg-black shadow-2xl"
              />
              <p className="mt-4 text-center text-sm text-[#f7f4ee]/70">
                Every answer in this film came from the house's own data.
              </p>
            </>
          )}
        </main>

        <footer className="flex items-center justify-between text-[11px] text-[#f7f4ee]/40">
          <span>aioncover.com</span>
          {opened && <span>Recorded {new Date(opened.recorded_at).toLocaleDateString()}</span>}
        </footer>
      </div>
    </div>
  );
}
