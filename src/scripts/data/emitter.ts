/**
 * El patrón «Set de listeners + función para desuscribirse», escrito una vez.
 * Cada store lo usa para sus propios eventos en vez de repetir el Set.
 */
export function createEmitter<T>(): {
  emit(value: T): void;
  on(cb: (value: T) => void): () => void;
} {
  const listeners = new Set<(value: T) => void>();
  return {
    emit(value) {
      for (const listener of listeners) listener(value);
    },
    on(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
