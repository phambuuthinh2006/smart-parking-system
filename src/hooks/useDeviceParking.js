import { useEffect, useState, useRef } from "react";
import { Client } from "@stomp/stompjs";
import {
  emptyDeviceState,
  newerSnapshot,
  parseSnapshot,
  visibleDeviceState,
} from "../services/deviceParking";

const base = (import.meta.env.VITE_BACKEND_URL || "").replace(/\/$/, "");
export function useDeviceParking(enabled) {
  const acceptRef = useRef(null);
  const refreshRef = useRef(null);
  const [snapshot, setSnapshot] = useState(emptyDeviceState);
  const [receivedAt, setReceivedAt] = useState(null);
  const [transport, setTransport] = useState("Connecting");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let pending = false;
    let latestRevision = -1;
    let inFlight = null;
    setSnapshot(emptyDeviceState());
    setReceivedAt(null);
    setTransport("Connecting");
    function accept(data) {
      const next = parseSnapshot(data);
      if (!active || next.revision < latestRevision) return;
      latestRevision = next.revision;
      setSnapshot((current) => newerSnapshot(current, next));
      setReceivedAt(Date.now());
    }
    async function refresh() {
      if (pending) return;
      pending = true;
      const request = new AbortController();
      inFlight = request;
      const timeout = window.setTimeout(() => request.abort(), 6000);
      try {
        const response = await fetch(`${base}/api/parking/status`, {
          signal: request.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Backend unavailable");
        accept(await response.json());
      } catch {
        // Keep last history, but visibleDeviceState masks unconfirmed states after 25s.
      } finally {
        window.clearTimeout(timeout);
        if (inFlight === request) inFlight = null;
        pending = false;
      }
    }
    const endpoint = new URL(`${base}/ws`, window.location.href);
    endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
    const client = new Client({
      brokerURL: endpoint.href,
      reconnectDelay: 3000,
      connectionTimeout: 6000,
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 10000,
      onConnect() {
        if (!active) return;
        setTransport("Live");
        client.subscribe("/topic/parking", (message) => {
          try {
            accept(JSON.parse(message.body));
          } catch {
            refresh();
          }
        });
        refresh();
      },
      onWebSocketClose() {
        if (active) setTransport("Reconnecting");
      },
      onStompError() {
        if (active) setTransport("Reconnecting");
      },
    });
    acceptRef.current = accept;
    refreshRef.current = refresh;
    client.activate();
    refresh();
    const poll = window.setInterval(refresh, 10000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active = false;
      acceptRef.current = null;
      refreshRef.current = null;
      inFlight?.abort();
      clearInterval(poll);
      clearInterval(tick);
      void client.deactivate();
    };
  }, [enabled]);
  async function simulateAccess(path, body) {
    try {
      const response = await fetch(`${base}/api/access/simulation/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.message || `HTTP ${response.status}`);
      acceptRef.current?.(result.snapshot);
      return result;
    } catch (error) {
      void refreshRef.current?.();
      throw error;
    }
  }
  return {
    ...visibleDeviceState(snapshot, receivedAt, now),
    transport,
    simulateAccess,
  };
}
