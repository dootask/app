type Listener = (result: string | null) => void;

const listeners = new Map<string, Listener>();

export function registerScanCallback(scanId: string, listener: Listener): void {
  listeners.set(scanId, listener);
}

export function emitScanResult(scanId: string, result: string | null): void {
  const listener = listeners.get(scanId);
  if (listener) {
    listeners.delete(scanId);
    listener(result);
  }
}
