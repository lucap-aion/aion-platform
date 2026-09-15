// Dictation, for someone holding a phone on a shop floor.
//
// This uses the browser's own speech recognition (Web Speech), not an API key,
// for one reason: it works today, on the device the manager already has, with
// no per-minute cost and no audio leaving the handset in the demo path. The
// trade is that it is a browser feature, so it is absent in Firefox and it has
// habits — chiefly that Safari stops listening after a breath of silence.
//
// Everything below exists to make that behave like a hold-to-talk button:
// we restart recognition whenever the engine ends on its own, and we only
// really stop when the person says so. Finalised phrases accumulate; the
// interim phrase is the one still being said.
//
// When an STT key does arrive, the replacement goes here and nowhere else:
// the recorder component only knows `start`, `stop`, and a growing transcript.

type Listener = {
  onTranscript: (full: string, interim: string) => void;
  onError: (message: string) => void;
  onEnd?: () => void;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
};

const getEngine = (): (new () => SpeechRecognitionLike) | null => {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
    | (new () => SpeechRecognitionLike)
    | null ?? null;
};

export const isDictationSupported = () => getEngine() !== null;

/** BCP-47 tag for the recogniser. The UI locale is the best guess we have. */
export const dictationLang = (locale: string) =>
  locale === "it" ? "it-IT" : "en-GB";

export type Dictation = {
  start: () => void;
  stop: () => void;
  /** Everything finalised so far, without the phrase still in the air. */
  text: () => string;
};

export function createDictation(lang: string, listener: Listener): Dictation {
  const Engine = getEngine();
  if (!Engine) {
    return {
      start: () => listener.onError("unsupported"),
      stop: () => {},
      text: () => "",
    };
  }

  let recognition: SpeechRecognitionLike | null = null;
  let finalText = "";
  // The difference between "the engine stopped" and "the person stopped".
  let wantsToListen = false;

  const attach = () => {
    const r = new Engine();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onresult = (e: unknown) => {
      const ev = e as {
        resultIndex: number;
        results: ArrayLike<
          ArrayLike<{ transcript: string }> & { isFinal: boolean }
        >;
      };
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i];
        const said = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalText = `${finalText} ${said}`.replace(/\s+/g, " ").trim();
        } else {
          interim += said;
        }
      }
      listener.onTranscript(finalText, interim.trim());
    };

    r.onerror = (e: unknown) => {
      const code = (e as { error?: string }).error ?? "unknown";
      // 'no-speech' and 'aborted' are how this engine says "nothing yet" and
      // "you stopped me". Neither is worth showing a person an error for.
      if (code === "no-speech" || code === "aborted") return;
      if (code === "not-allowed" || code === "service-not-allowed") {
        wantsToListen = false;
        listener.onError("denied");
        return;
      }
      listener.onError(code);
    };

    // Safari ends the session on a pause. If the manager is still talking —
    // or just thinking mid-sentence — start it again.
    r.onend = () => {
      if (wantsToListen) {
        try {
          r.start();
          return;
        } catch {
          /* already starting; the next onend will retry */
        }
      }
      listener.onEnd?.();
    };

    return r;
  };

  return {
    start: () => {
      finalText = "";
      wantsToListen = true;
      recognition = attach();
      try {
        recognition.start();
      } catch (e) {
        listener.onError(e instanceof Error ? e.message : "start failed");
      }
    },
    stop: () => {
      wantsToListen = false;
      try {
        recognition?.stop();
      } catch {
        /* nothing to stop */
      }
    },
    text: () => finalText,
  };
}


// ── Recording, for a message that is sent as a voice message ────────────────
//
// The dictation above turns speech into text in the browser. This does not: it
// captures the audio and hands it over, because the transcription belongs in
// the backend — one engine, one quality, the same on every phone in every
// boutique, instead of whatever the handset's browser happens to implement.
//
// It also means the associate sends what they SAID. The words come back as a
// transcript under the message, which is the moment to notice that a client's
// name was misheard.

export type Recording = {
  blob: Blob;
  seconds: number;
  mimeType: string;
};

export type Recorder = {
  stop: () => Promise<Recording | null>;
  cancel: () => void;
};

/** The first container this browser will actually give us. */
function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    // Safari records mp4/aac and nothing else.
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const t of candidates) {
    try {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
    } catch { /* older browsers throw rather than answer */ }
  }
  return "";
}

export const isRecordingSupported = () =>
  typeof MediaRecorder !== "undefined" &&
  typeof navigator !== "undefined" &&
  !!navigator.mediaDevices?.getUserMedia;

/**
 * Start recording. Resolves once the microphone is actually open, so the UI
 * does not show "recording" over a permission prompt the person has not
 * answered yet.
 */
export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const mimeType = pickMimeType();
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: BlobPart[] = [];
  const startedAt = Date.now();

  rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  rec.start();

  // Whatever happens next, the microphone light goes off.
  const release = () => { for (const t of stream.getTracks()) t.stop(); };

  return {
    stop: () =>
      new Promise<Recording | null>((resolve) => {
        if (rec.state === "inactive") { release(); resolve(null); return; }
        rec.onstop = () => {
          release();
          const type = rec.mimeType || mimeType || "audio/webm";
          const blob = new Blob(chunks, { type });
          resolve(blob.size > 0 ? { blob, seconds: Math.round((Date.now() - startedAt) / 1000), mimeType: type } : null);
        };
        rec.stop();
      }),
    cancel: () => {
      try { if (rec.state !== "inactive") rec.stop(); } catch { /* already stopped */ }
      release();
    },
  };
}

/** The file extension a container should be stored under. */
export const extensionFor = (mimeType: string) =>
  mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "webm";
