import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const IMAGE_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export const ALLOWED_IMAGE_TYPES = Object.keys(IMAGE_EXTENSIONS);

export function ensureUploadDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function saveImageFile(file, uploadsPath, subdir) {
  if (!file) throw new Error('No se recibió ninguna imagen.');
  const extension = IMAGE_EXTENSIONS[file.mimetype];
  if (!extension) throw new Error('Formato de imagen no permitido.');
  const dir = ensureUploadDir(path.join(uploadsPath, subdir));
  const filename = `${randomUUID()}${extension}`;
  const target = path.join(dir, filename);
  writeFileSync(target, file.buffer);
  return filename;
}

export function imageFilePath(uploadsPath, subdir, filename) {
  if (!filename || path.basename(filename) !== filename || !/^[a-f0-9-]+\.(jpg|png|webp)$/.test(filename)) {
    return null;
  }
  return path.join(uploadsPath, subdir, filename);
}

export function removeImageFile(uploadsPath, subdir, filename) {
  const target = imageFilePath(uploadsPath, subdir, filename);
  if (!target) return;
  try {
    unlinkSync(target);
  } catch {
    // La imagen pudo haberse borrado ya; no bloquea la operación.
  }
}
