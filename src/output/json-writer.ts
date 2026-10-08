import { writeFile, mkdir, rename, rm } from 'fs/promises';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import { STORAGE_LIMITS } from '../storage/retention.js';

export async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const content = JSON.stringify(data);
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > STORAGE_LIMITS.fileBytes) {
    throw new Error(`${path}: ${bytes} bytes exceeds the safe JSON file budget`);
  }
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, 'utf-8');
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}
