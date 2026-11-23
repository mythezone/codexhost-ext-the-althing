// Weigh text caches in UTF-16 code units; topic snapshots use the entry limit.
export class Lru<K, V> {
  private entries = new Map<K, { value: V; size: number }>();
  private size = 0;
  constructor(
    private limit: number,
    private budget = Infinity,
  ) {}
  get(key: K) {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.value;
  }
  set(key: K, value: V, size = 1) {
    this.delete(key);
    if (size > this.budget) return;
    this.entries.set(key, { value, size });
    this.size += size;
    while (this.entries.size > this.limit || this.size > this.budget)
      this.delete(this.entries.keys().next().value!);
  }
  delete(key: K) {
    this.size -= this.entries.get(key)?.size ?? 0;
    this.entries.delete(key);
  }
}
