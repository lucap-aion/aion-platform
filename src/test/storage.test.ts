import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { storagePath, isForeignUrl } from "@/lib/storage";

const OURS = "https://tlmdlskiubfdhywmzgzb.supabase.co";

describe("working out what to sign", () => {
  it("takes the path out of one of our own public URLs", () => {
    expect(storagePath("profile_pictures", `${OURS}/storage/v1/object/public/profile_pictures/abc/avatar.jpg`))
      .toBe("abc/avatar.jpg");
  });

  it("accepts a bare path, which is what we store now", () => {
    expect(storagePath("profile_pictures", "abc/avatar.jpg")).toBe("abc/avatar.jpg");
  });

  it("leaves another project's URL alone", () => {
    // Every avatar row on DEV points at PROD's bucket. Signing that path here
    // asks dev for a file that only exists there, and the face disappears.
    const prod = "https://dvmhwsmunvfdxnvckdom.supabase.co/storage/v1/object/public/profile_pictures/default-avatar.png";
    expect(storagePath("profile_pictures", prod)).toBeNull();
    expect(isForeignUrl("profile_pictures", prod)).toBe(true);
  });

  it("leaves a brand's own CDN alone", () => {
    expect(isForeignUrl("profile_pictures", "https://cdn.shopify.com/x.jpg")).toBe(true);
    expect(isForeignUrl("profile_pictures", "blob:http://localhost/abc")).toBe(true);
  });

  it("drops the query string a signed URL carries", () => {
    expect(storagePath("claims_media", `${OURS}/storage/v1/object/sign/claims_media/x/y.png?token=abc`))
      .toBe("x/y.png");
  });

  it("has nothing to say about an empty value", () => {
    expect(storagePath("claims_media", null)).toBeNull();
    expect(storagePath("claims_media", "")).toBeNull();
  });
});
