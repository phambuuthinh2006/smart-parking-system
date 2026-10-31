import { useEffect, useRef, useState } from "react";

// Audio is created/resumed only after a user's click. No samples or remote audio files.
export function useAlarmSound(active) {
  const context = useRef(null);
  const mounted = useRef(false);
  const [enabled, setEnabled] = useState(false);
  const [pending, setPending] = useState(false);
  const [running, setRunning] = useState(false);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [error, setError] = useState("");
  const supported = Boolean(window.AudioContext || window.webkitAudioContext);

  useEffect(() => {
    mounted.current = true;
    const onVisibility = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", onVisibility);
      const audio = context.current;
      context.current = null;
      if (audio) {
        audio.onstatechange = null;
        void audio.close().catch(() => {});
      }
    };
  }, []);

  async function toggle() {
    if (pending) return;
    if (enabled) {
      setEnabled(false);
      return;
    }
    if (!supported) return;
    setPending(true);
    setError("");
    try {
      if (!context.current) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const audio = new AudioContext();
        context.current = audio;
        audio.onstatechange = () => {
          if (mounted.current) setRunning(audio.state === "running");
        };
      }
      await context.current.resume();
      if (!mounted.current) return;
      if (context.current.state !== "running") throw new Error("Audio blocked");
      setRunning(true);
      setEnabled(true);
    } catch {
      if (mounted.current)
        setError(
          "Audio could not start. Check browser sound permissions and try again.",
        );
    } finally {
      if (mounted.current) setPending(false);
    }
  }

  const playing = active && enabled && visible && running;
  useEffect(() => {
    const audio = context.current;
    if (!playing || !audio || audio.state !== "running") return;
    const tone = audio.createOscillator();
    const sweep = audio.createOscillator();
    const sweepDepth = audio.createGain();
    const volume = audio.createGain();
    tone.type = "sine";
    tone.frequency.value = 950;
    sweep.frequency.value = 1.5;
    sweepDepth.gain.value = 220;
    volume.gain.value = 0.025;
    sweep.connect(sweepDepth);
    sweepDepth.connect(tone.frequency);
    tone.connect(volume);
    volume.connect(audio.destination);
    tone.start();
    sweep.start();
    return () => {
      // Stop all sound immediately on cooling, mute, hidden tab or unmount.
      volume.gain.value = 0;
      tone.stop();
      sweep.stop();
      tone.disconnect();
      sweep.disconnect();
      sweepDepth.disconnect();
      volume.disconnect();
    };
  }, [playing]);

  return {
    enabled,
    pending,
    playing,
    supported,
    error,
    toggle,
    mute: () => setEnabled(false),
  };
}
