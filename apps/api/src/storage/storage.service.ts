import { Inject, Injectable, Logger } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { APP_CONFIG, AppConfig } from '../config.js';

/**
 * File storage on a volume shared with the workers (one VPS).
 * Layout: <root>/<jobId>/{input.ext, edit.json?, dotdot.pdf, puzzle.png, answer.png, plan.json}.
 * Keep this interface small so an S3 driver (Garage, SeaweedFS, cloud) can replace it later.
 */
@Injectable()
export class StorageService {
  private readonly log = new Logger(StorageService.name);
  readonly root: string;

  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    this.root = path.resolve(cfg.storageDir);
  }

  resolve(rel: string): string {
    const abs = path.resolve(this.root, rel);
    if (!abs.startsWith(this.root + path.sep)) throw new Error(`path escapes storage: ${rel}`);
    return abs;
  }

  async saveInput(jobId: string, ext: string, data: Buffer): Promise<string> {
    const rel = `${jobId}/input.${ext}`;
    const abs = this.resolve(rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(`${abs}.tmp`, data);
    await rename(`${abs}.tmp`, abs);
    return rel;
  }

  async save(jobId: string, name: string, data: Buffer | string): Promise<string> {
    const rel = `${jobId}/${name}`;
    const abs = this.resolve(rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(`${abs}.tmp`, data);
    await rename(`${abs}.tmp`, abs);
    return rel;
  }

  /** Copy a file into another job folder (each folder expires on its own). Returns null if gone. */
  async copy(rel: string, jobId: string, name: string): Promise<string | null> {
    const to = `${jobId}/${name}`;
    try {
      await mkdir(path.dirname(this.resolve(to)), { recursive: true });
      await copyFile(this.resolve(rel), this.resolve(to));
      return to;
    } catch {
      return null;
    }
  }

  async read(rel: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolve(rel));
    } catch {
      return null;
    }
  }

  async size(rel: string): Promise<number | null> {
    try {
      return (await stat(this.resolve(rel))).size;
    } catch {
      return null;
    }
  }

  open(rel: string) {
    return createReadStream(this.resolve(rel));
  }

  async remove(jobId: string) {
    await rm(this.resolve(jobId), { recursive: true, force: true });
  }

  async ping(): Promise<boolean> {
    try {
      await mkdir(this.root, { recursive: true });
      const probe = path.join(this.root, `.probe-${process.pid}`);
      await writeFile(probe, 'ok');
      await rm(probe, { force: true });
      return true;
    } catch {
      return false;
    }
  }

  /** Delete job folders older than maxAgeMs. Returns the number of removed folders. */
  async removeOlderThan(maxAgeMs: number): Promise<number> {
    let removed = 0;
    const limit = Date.now() - maxAgeMs;
    let entries: string[] = [];
    try {
      entries = await readdir(this.root);
    } catch {
      return 0;
    }
    for (const name of entries) {
      if (name.startsWith('.')) continue;
      try {
        const st = await stat(path.join(this.root, name));
        if (st.isDirectory() && st.mtimeMs < limit) {
          await rm(path.join(this.root, name), { recursive: true, force: true });
          removed++;
        }
      } catch (e) {
        this.log.warn(`cleanup skipped ${name}: ${(e as Error).message}`);
      }
    }
    return removed;
  }
}
