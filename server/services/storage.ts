import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const KEY_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

/**
 * Soubory na disku pod data/uploads/<org>/<uuid>. Cesta se skládá jen z UUID,
 * jméno souboru od uživatele se do cesty nikdy nedostane (žádný path traversal).
 */
export class FileStorage {
  constructor(private root: string) {
    fs.mkdirSync(root, { recursive: true });
  }

  save(orgId: string, data: Buffer): string {
    const key = `${orgId}/${randomUUID()}`;
    const file = this.resolve(key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data, { mode: 0o600 });
    return key;
  }

  read(key: string): Buffer {
    return fs.readFileSync(this.resolve(key));
  }

  remove(key: string): void {
    try {
      fs.unlinkSync(this.resolve(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  exists(key: string): boolean {
    return fs.existsSync(this.resolve(key));
  }

  private resolve(key: string): string {
    if (!KEY_RE.test(key)) throw new Error('Neplatný klíč souboru');
    const file = path.resolve(this.root, key);
    if (!file.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Neplatná cesta souboru');
    return file;
  }
}
