import { useEffect, useState } from 'react';
import { getLocalServerUrl, startLocalServer } from '../services/localServer';

interface State {
  url: string | null;
  error: Error | null;
}

export function useLocalServerUrl(): State {
  const [state, setState] = useState<State>(() => ({
    url: getLocalServerUrl(),
    error: null,
  }));

  useEffect(() => {
    if (state.url) return;
    let cancelled = false;
    startLocalServer()
      .then((url) => {
        if (!cancelled) setState({ url, error: null });
      })
      .catch((error) => {
        if (!cancelled) setState({ url: null, error: error as Error });
      });
    return () => {
      cancelled = true;
    };
  }, [state.url]);

  return state;
}
