// Polyfill localStorage for jsdom (missing clear() method)
// jsdom's localStorage is a proxy that doesn't allow adding properties,
// so we replace the global localStorage with a plain object.
const win = typeof window !== "undefined" ? window : globalThis;

const store = new Map<string, string>();

// Migrate any existing data
const oldLs = win.localStorage;
if (oldLs) {
  for (let i = 0; i < oldLs.length; i++) {
    const key = oldLs.key(i);
    if (key) {
      store.set(key, oldLs.getItem(key)!);
    }
  }
}

const newLs = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
  removeItem: (key: string) => store.delete(key),
  clear: () => store.clear(),
  key: (index: number) => Array.from(store.keys())[index] ?? null,
  get length() { return store.size; },
};

// Replace global localStorage
Object.defineProperty(win, "localStorage", {
  value: newLs,
  writable: true,
  configurable: true,
});