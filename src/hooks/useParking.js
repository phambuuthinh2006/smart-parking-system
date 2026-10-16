import { useEffect, useReducer, useState } from "react";
import {
  initialState,
  parkingReducer,
  randomUpdate,
  statistics,
} from "../services/parking";
export function useParking() {
  const [state, dispatch] = useReducer(parkingReducer, undefined, initialState);
  const [running, setRunning] = useState(false);
  const [interval, setIntervalSeconds] = useState(5);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      dispatch(randomUpdate(state.spaces));
    }, interval * 1000);
    return () => window.clearInterval(timer);
  }, [running, interval, state.spaces]);
  const update = (spaceId, status) =>
    dispatch({ type: "update", spaceId, status });
  const reset = () => {
    setRunning(false);
    dispatch({ type: "reset" });
  };
  return {
    ...state,
    stats: statistics(state.spaces),
    running,
    setRunning,
    interval,
    setIntervalSeconds,
    update,
    reset,
    randomize: () => dispatch(randomUpdate(state.spaces)),
  };
}
