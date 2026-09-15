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
