import { describe, it, expect, vi, afterEach } from "vitest";
import {
  mirrorImage, mirrorBrandImages, servedByAion, IMAGE_SLOTS,
} from "../../supabase/functions/_shared/brand-images.ts";

// A brand's logo used to be a link to the brand's own CDN. These are the cases that decide
// whether the copy we keep is the real picture or a 403 page saved as a logo.

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 9, 9]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0, 1]);
const WEBP = new Uint8Array([...new TextEncoder().encode("RIFF"), 0, 0, 0, 0, ...new TextEncoder().encode("WEBP"), 0, 0]);
const SVG = new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>');
const HTML = new TextEncoder().encode("<!doctype html><html><body>Access denied</body></html>");

type Upload = { bucket: string; path: string; bytes: Uint8Array; contentType?: string };

function fakeAdmin() {
  const uploads: Upload[] = [];
  const admin = {
    storage: {
      from(bucket: string) {
        return {
          // deno-lint-ignore no-explicit-any
          upload(path: string, bytes: any, opts?: Record<string, unknown>) {
            uploads.push({ bucket, path, bytes, contentType: opts?.contentType as string });
            return Promise.resolve({ error: null });
          },
          getPublicUrl(path: string) {
            return { data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/${bucket}/${path}` } };
          },
        };
      },
    },
  };
  return { admin, uploads };
}

function serve(bytes: Uint8Array, contentType: string, init: Partial<{ status: number }> = {}) {
  return vi.fn(() => Promise.resolve(new Response(bytes as unknown as BodyInit, {
    status: init.status ?? 200,
    headers: { "content-type": contentType },
  })));
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("recognising what we already hold", () => {
  it("knows our own storage from a brand's CDN", () => {
    expect(servedByAion("https://proj.supabase.co/storage/v1/object/public/brand_logos/brands/22-full.png")).toBe(true);
    expect(servedByAion("https://www.buccellati.com/media/logo.svg")).toBe(false);
    expect(servedByAion(null)).toBe(false);
    expect(servedByAion("  ")).toBe(false);
  });

  it("does not download something it already holds", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { admin, uploads } = fakeAdmin();
    const out = await mirrorImage(admin, 22, "logo_big",
      "https://proj.supabase.co/storage/v1/object/public/brand_logos/brands/22-full.png");
    expect(out.status).toBe("already_ours");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(uploads).toHaveLength(0);
  });
});

describe("copying a picture into our storage", () => {
  it("writes it to the same bucket and path the admin form uses", async () => {
    // So an admin who later uploads a better logo REPLACES this object rather than leaving
    // an orphan behind, and the bucket does not grow a copy per onboarding pass.
    vi.stubGlobal("fetch", serve(PNG, "image/png"));
    const { admin, uploads } = fakeAdmin();
    const out = await mirrorImage(admin, 22, "logo_big", "https://www.buccellati.com/logo.png");
    expect(out.status).toBe("mirrored");
    expect(uploads[0]).toMatchObject({ bucket: "brand_logos", path: "brands/22-full.png", contentType: "image/png" });
    if (out.status === "mirrored") expect(out.url).toContain("/storage/v1/object/public/brand_logos/brands/22-full.png");
  });

  it("puts the six section images in the media bucket, each under its own name", async () => {
    vi.stubGlobal("fetch", serve(PNG, "image/png"));
    const { admin, uploads } = fakeAdmin();
    await mirrorBrandImages(admin, 7, Object.fromEntries(
      IMAGE_SLOTS.map((s) => [s, `https://brand.example/${s}.png`]),
    ));
    expect(uploads.map((u) => `${u.bucket}/${u.path}`)).toEqual([
      "brand_logos/brands/7-full.png",
      "brand_logos/brands/7-icon.png",
      "brand_media/brands/7-auth-bg.png",
      "brand_media/brands/7-top-banner.png",
      "brand_media/brands/7-theft.png",
      "brand_media/brands/7-damage.png",
      "brand_media/brands/7-faq.png",
      "brand_media/brands/7-feedback.png",
    ]);
  });

  it("gives the same url for the same bytes, and a new one when the picture changes", async () => {
    // The branding stage re-runs. If the url moved every pass, every pass would write to the
    // brand record and the go-live checklist would flicker for no reason.
    const { admin } = fakeAdmin();
    vi.stubGlobal("fetch", serve(PNG, "image/png"));
    const first = await mirrorImage(admin, 22, "logo_big", "https://b.example/logo.png");
    const again = await mirrorImage(admin, 22, "logo_big", "https://b.example/logo.png");
    expect(first.status === "mirrored" && again.status === "mirrored" && first.url === again.url).toBe(true);

    vi.stubGlobal("fetch", serve(new Uint8Array([...PNG, 9, 9, 9]), "image/png"));
    const redesigned = await mirrorImage(admin, 22, "logo_big", "https://b.example/logo.png");
    expect(redesigned.status === "mirrored" && redesigned.url !== (first as { url: string }).url).toBe(true);
  });

  it("reads the bytes rather than believing the header", async () => {
    // A CDN answering application/octet-stream for a png is ordinary; saving it as .bin is
    // not, because nothing renders it.
    vi.stubGlobal("fetch", serve(JPEG, "application/octet-stream"));
    const { admin, uploads } = fakeAdmin();
    const out = await mirrorImage(admin, 1, "theft_image", "https://b.example/hero");
    expect(out.status).toBe("mirrored");
    expect(uploads[0]).toMatchObject({ path: "brands/1-theft.jpg", contentType: "image/jpeg" });
  });

  it("handles the other formats these sites actually serve", async () => {
    for (const [bytes, ext, type] of [
      [GIF, "gif", "image/gif"], [WEBP, "webp", "image/webp"], [SVG, "svg", "image/svg+xml"],
    ] as [Uint8Array, string, string][]) {
      vi.stubGlobal("fetch", serve(bytes, "application/octet-stream"));
      const { admin, uploads } = fakeAdmin();
      const out = await mirrorImage(admin, 3, "faq_image", "https://b.example/x");
      expect(out.status, `${ext} should be mirrored`).toBe("mirrored");
      expect(uploads[0].path).toBe(`brands/3-faq.${ext}`);
      expect(uploads[0].contentType).toBe(type);
    }
  });
});

describe("refusing what is not a picture", () => {
  it("does not save a hotlink-block page as the brand's logo", async () => {
    // This is the real failure mode: the CDN answers 200 with an HTML "access denied" body
    // and content-type image/jpeg, and the portal shows a broken image forever.
    vi.stubGlobal("fetch", serve(HTML, "image/jpeg"));
    const { admin, uploads } = fakeAdmin();
    const out = await mirrorImage(admin, 22, "logo_big", "https://b.example/logo.jpg");
    expect(out.status).toBe("skipped");
    expect(uploads).toHaveLength(0);
  });

  it("says what the brand's server answered, rather than failing silently", async () => {
    vi.stubGlobal("fetch", serve(PNG, "image/png", { status: 403 }));
    const { admin } = fakeAdmin();
    const out = await mirrorImage(admin, 22, "logo_small", "https://b.example/icon.png");
    expect(out.status === "skipped" && out.reason).toContain("403");
  });

  it("survives a site that never answers", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("connection reset"))));
    const { admin } = fakeAdmin();
    const out = await mirrorImage(admin, 22, "logo_small", "https://b.example/icon.png");
    expect(out.status === "skipped" && out.reason).toContain("connection reset");
  });

  it("leaves a data: or relative url alone instead of mangling it", async () => {
    const { admin } = fakeAdmin();
    for (const url of ["/media/logo.png", "data:image/png;base64,AAAA"]) {
      const out = await mirrorImage(admin, 22, "logo_big", url);
      expect(out.status).toBe("skipped");
    }
  });

  it("refuses a hero image too large to hold", async () => {
    const huge = new Uint8Array(11 * 1024 * 1024);
    huge.set(PNG.subarray(0, 8));
    vi.stubGlobal("fetch", serve(huge, "image/png"));
    const { admin, uploads } = fakeAdmin();
    const out = await mirrorImage(admin, 22, "top_banner_image", "https://b.example/hero.png");
    expect(out.status === "skipped" && out.reason).toContain("too large");
    expect(uploads).toHaveLength(0);
  });
});

describe("what the onboarding run is told", () => {
  it("reports how many are held and names the ones that are not", async () => {
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(() => {
      call += 1;
      return Promise.resolve(call === 1
        ? new Response(PNG as unknown as BodyInit, { status: 200, headers: { "content-type": "image/png" } })
        : new Response(HTML as unknown as BodyInit, { status: 200, headers: { "content-type": "image/jpeg" } }));
    }));
    const { admin } = fakeAdmin();
    const out = await mirrorBrandImages(admin, 22, {
      logo_big: "https://b.example/full.png",
      logo_small: "https://b.example/icon.png",
    });
    expect(out.mirrored).toBe(1);
    expect(out.failed).toBe(1);
    expect(out.urls.logo_big).toContain("/storage/v1/object/public/brand_logos/");
    expect(out.urls.logo_small).toBeUndefined();
    expect(out.notes.join(" ")).toContain("1 image is now held in AION storage");
    expect(out.notes.join(" ")).toContain("logo_small");
  });

  it("does nothing, quietly, when there is nothing to copy", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { admin } = fakeAdmin();
    const out = await mirrorBrandImages(admin, 22, { logo_big: null, logo_small: undefined });
    expect(out).toMatchObject({ mirrored: 0, failed: 0, notes: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
