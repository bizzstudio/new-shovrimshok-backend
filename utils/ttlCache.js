// utils/ttlCache.js
// In-memory TTL cache (can be easily replaced with Redis)

class TTLCache {
  constructor({ defaultTtlMs = 10 * 60 * 1000, maxSize = 500 } = {}) {
    this.defaultTtlMs = defaultTtlMs;
    this.maxSize = maxSize;
    this.map = new Map();
  }

  _now() {
    return Date.now();
  }

  _pruneIfNeeded() {
    if (this.map.size <= this.maxSize) return;

    // Prune oldest (Map preserves insertion order)
    const overflow = this.map.size - this.maxSize;
    let i = 0;
    for (const key of this.map.keys()) {
      this.map.delete(key);
      i += 1;
      if (i >= overflow) break;
    }
  }

  get(key) {
    const item = this.map.get(key);
    if (!item) return null;

    if (item.expiresAt <= this._now()) {
      this.map.delete(key);
      return null;
    }

    return item.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    this._pruneIfNeeded();
    this.map.set(key, { value, expiresAt: this._now() + ttlMs });
    return value;
  }

  del(key) {
    this.map.delete(key);
  }

  // Delete all keys that start with the given prefix
  delByPrefix(prefix) {
    const keysToDelete = [];
    for (const key of this.map.keys()) {
      if (String(key).startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => this.map.delete(key));
    return keysToDelete.length;
  }

  clear() {
    this.map.clear();
  }
}

module.exports = { TTLCache };