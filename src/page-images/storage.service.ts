import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';

// Image upload RULE (decided 2026-10-07): uploaded page images go to
// Cloudflare R2 (S3-compatible API, public via assets.openinkhub.io) - never
// to the app's local disk, which Hostinger wipes on every deploy.
//
//   Object key : page-images/{customerId}/{timestamp}-{safe-filename}
//   Public URL : {R2_PUBLIC_URL}/{key}
//
// Required environment variables (Hostinger -> Environment Variables):
//   R2_ACCOUNT_ID         Cloudflare account id (or set R2_ENDPOINT instead)
//   R2_ACCESS_KEY_ID      R2 API token (Object Read & Write) access key
//   R2_SECRET_ACCESS_KEY  R2 API token secret
//   R2_BUCKET             bucket name
//   R2_PUBLIC_URL         public base URL, e.g. https://assets.openinkhub.io
// If these are missing, uploads are REFUSED with a clear error. Local disk is
// only used when UPLOAD_BACKEND=local is set explicitly (local development).
export type StorageBackend = 'r2' | 'local' | 'unconfigured';

const LOCAL_DIR =
  process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'page-images');

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private client: S3Client | null = null;

  private r2Configured(): boolean {
    const e = process.env;
    return !!(
      (e.R2_ENDPOINT || e.R2_ACCOUNT_ID) &&
      e.R2_ACCESS_KEY_ID &&
      e.R2_SECRET_ACCESS_KEY &&
      e.R2_BUCKET &&
      e.R2_PUBLIC_URL
    );
  }

  backend(): StorageBackend {
    if (this.r2Configured()) return 'r2';
    if (process.env.UPLOAD_BACKEND === 'local') return 'local';
    return 'unconfigured';
  }

  private getClient(): S3Client {
    if (!this.client) {
      const e = process.env;
      this.client = new S3Client({
        region: 'auto',
        endpoint: e.R2_ENDPOINT || `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: e.R2_ACCESS_KEY_ID as string,
          secretAccessKey: e.R2_SECRET_ACCESS_KEY as string,
        },
      });
    }
    return this.client;
  }

  // Returns the public URL plus the storage key (null for local disk).
  async put(
    customerId: string,
    originalName: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<{ url: string; storageKey: string | null; filename: string }> {
    const backend = this.backend();
    const filename = `${Date.now()}-${originalName.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
    if (backend === 'r2') {
      const key = `page-images/${customerId}/${filename}`;
      await this.getClient().send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET,
          Key: key,
          Body: buffer,
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      const base = (process.env.R2_PUBLIC_URL as string).replace(/\/+$/, '');
      return { url: `${base}/${key}`, storageKey: key, filename };
    }
    if (backend === 'local') {
      const dir = path.join(LOCAL_DIR, customerId);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, filename), buffer);
      return { url: `/uploads/page-images/${customerId}/${filename}`, storageKey: null, filename };
    }
    throw new BadRequestException(
      'Image storage is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, ' +
        'R2_BUCKET and R2_PUBLIC_URL (Cloudflare R2) in the server environment before uploading images.',
    );
  }

  async remove(customerId: string, filename: string, storageKey: string | null): Promise<void> {
    try {
      if (storageKey && this.r2Configured()) {
        await this.getClient().send(
          new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: storageKey }),
        );
      } else if (!storageKey) {
        fs.unlinkSync(path.join(LOCAL_DIR, customerId, filename));
      }
    } catch (err) {
      // Already gone (or a legacy local file wiped by a redeploy) - not fatal.
      this.logger.warn(`Could not delete stored image ${storageKey ?? filename}: ${(err as Error).message}`);
    }
  }
}
