// ScreenshotOne (https://screenshotone.com): real desktop + mobile screenshots of the customer's homepage.
// The image is stored in the Engine's file storage (R2) when configured; the evidence row keeps the link and the
// capture details so the "page fetch / screenshot" audit tasks have real data to report on.
export interface ShotResult {
  device: 'desktop' | 'mobile';
  ok: boolean;
  url: string;
  imageUrl: string | null;
  bytes: number;
  seconds: number;
  error: string | null;
}

const PRESETS: Array<{ device: 'desktop' | 'mobile'; w: number; h: number }> = [
  { device: 'desktop', w: 1366, h: 768 },
  { device: 'mobile', w: 390, h: 844 },
];

export async function captureHomepage(
  accessKey: string,
  site: string,
  customerId: string,
  store?: (name: string, buf: Buffer, contentType: string) => Promise<string | null>,
): Promise<ShotResult[]> {
  const url = /^https?:\/\//i.test(site) ? site : `https://${site}`;
  const out: ShotResult[] = [];
  for (const p of PRESETS) {
    const started = Date.now();
    const q = new URLSearchParams({
      access_key: accessKey,
      url,
      viewport_width: String(p.w),
      viewport_height: String(p.h),
      format: 'jpg',
      image_quality: '70',
      block_ads: 'true',
      block_cookie_banners: 'true',
      timeout: '60',
    });
    try {
      const res = await fetch(`https://api.screenshotone.com/take?${q}`, { signal: AbortSignal.timeout(80000) });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j: any = await res.json();
          msg = `${j.error_code || res.status}: ${String(j.error_message || j.message || '').slice(0, 160)}`;
        } catch {
          // body was not JSON
        }
        throw new Error(msg);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      let imageUrl: string | null = null;
      if (store) imageUrl = await store(`${p.device}-homepage-${customerId.slice(0, 8)}.jpg`, buf, 'image/jpeg');
      out.push({ device: p.device, ok: true, url, imageUrl, bytes: buf.length, seconds: Math.round((Date.now() - started) / 100) / 10, error: null });
    } catch (e: any) {
      out.push({ device: p.device, ok: false, url, imageUrl: null, bytes: 0, seconds: Math.round((Date.now() - started) / 100) / 10, error: String(e?.message ?? e).slice(0, 200) });
    }
  }
  return out;
}
