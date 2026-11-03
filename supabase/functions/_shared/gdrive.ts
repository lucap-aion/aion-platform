// Google Drive as a knowledge source.
//
// How a brand connects: it shares a folder (or a Shared Drive) with AION's
// service account as a Viewer and pastes the folder's link. We read what is in
// it, recursively, and nothing else.
//
// Why a service account and not "Sign in with Google": reading arbitrary Drive
// files over OAuth needs the drive.readonly scope, which Google classes as
// restricted — an app using it must pass Google's verification and an annual
// third-party security assessment before it may serve more than a handful of
// users, and until then every consent screen says "unverified app". Sharing a
// folder with a service account needs none of that, never expires, and makes
// the boundary explicit: the brand decides exactly which folder we see, and
// un-sharing it is how they take it back.
//
// The pure parts (link parsing, what to do with each file type) are here so
// they are unit-tested; the calls to Google are thin.

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
};

// ── Parsing what a person pastes ─────────────────────────────────────────────

/**
 * The folder id out of whatever was pasted: a folder link (My Drive or a
 * Shared Drive, with or without /u/0/ and ?usp=sharing), an "open?id=" link, or
 * a bare id. A link to a single FILE is refused — the source is a folder, and
 * accepting a file id here would fail later with a confusing "not a folder".
 */
export function parseFolderId(input: string): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  const folder = raw.match(/\/folders\/([A-Za-z0-9_-]{10,})/);
  if (folder) return folder[1];
  if (/\/(file|document|spreadsheets|presentation)\/d\//.test(raw)) return null;
  const openId = raw.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (openId) return openId[1];
  if (/^[A-Za-z0-9_-]{10,}$/.test(raw)) return raw;
  return null;
}

// ── What to do with each file ────────────────────────────────────────────────

export type FilePlan =
  // Google-native: ask Drive to export it as text.
  | { how: "export"; exportMime: string; asName: string }
  // Stored bytes: download, then read with extract-text by this filename.
  | { how: "download"; asName: string }
  | { how: "skip"; reason: string };

const NATIVE_EXPORT: Record<string, { exportMime: string; ext: string }> = {
  "application/vnd.google-apps.document": { exportMime: "text/plain", ext: "txt" },
  "application/vnd.google-apps.presentation": { exportMime: "text/plain", ext: "txt" },
  // Drive exports only the FIRST sheet of a spreadsheet as CSV. Good enough for
  // a price list or a FAQ table; a multi-tab workbook should be uploaded or
  // imported as cards instead, and the sync says so via the skip count.
  "application/vnd.google-apps.spreadsheet": { exportMime: "text/csv", ext: "csv" },
};

const STORED: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
  "text/tab-separated-values": "tsv",
};

// Drive refuses to export more than 10 MB, and parse-knowledge already draws
// the line for stored files at 25 MB.
export const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

export function planFile(f: Pick<DriveFile, "name" | "mimeType" | "size">): FilePlan {
  const base = (f.name ?? "file").replace(/[\\/]/g, "-");
  const native = NATIVE_EXPORT[f.mimeType];
  if (native) return { how: "export", exportMime: native.exportMime, asName: `${base}.${native.ext}` };
  if (f.mimeType.startsWith("application/vnd.google-apps.")) {
    return { how: "skip", reason: "Google file type with no text export (form, drawing, site…)" };
  }
  const ext = STORED[f.mimeType] ?? (base.match(/\.(pdf|docx|pptx|txt|md|csv|tsv)$/i)?.[1]?.toLowerCase() ?? null);
  if (!ext) return { how: "skip", reason: `unsupported type ${f.mimeType}` };
  if (f.size && Number(f.size) > MAX_DOWNLOAD_BYTES) return { how: "skip", reason: "larger than 25 MB" };
  const asName = base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;
  return { how: "download", asName };
}

/** A document title from a file name: no extension, no underscores. */
export function titleFromFileName(name: string): string {
  const t = (name ?? "").replace(/\.(pdf|docx|pptx|txt|md|csv|tsv)$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return (t || "Document").slice(0, 300);
}

/**
 * A category from the folder path and the name. Brands file their Drive the
 * way they think about it — "Policies/Returns.pdf", "Training/Onboarding" — and
 * that is a better signal than anything we could infer from the text.
 */
export function categoryFromPath(path: string[], name: string): string {
  const hay = [...path, name].join(" / ").toLowerCase();
  if (/\b(polic|policy|policies|terms|condizioni|resi\b|returns?|warrant|garanzi|privacy|legal)/.test(hay)) return "policy";
  if (/\b(training|formazione|onboarding|manual|manuale|playbook|guide|guida|faq|procedur)/.test(hay)) return "training";
  if (/\b(product|prodott|collection|collezion|catalog|lookbook|line ?sheet|scheda)/.test(hay)) return "product";
  if (/\b(story|storia|heritage|brand ?book|about|maison|press|stampa|craft|artigian)/.test(hay)) return "storytelling";
  return "other";
}

// ── Talking to Google ────────────────────────────────────────────────────────

export function parseServiceAccount(json: string | undefined | null): ServiceAccount | null {
  if (!json) return null;
  try {
    const sa = JSON.parse(json) as ServiceAccount;
    return sa.client_email && sa.private_key ? sa : null;
  } catch { return null; }
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (s: string) => b64url(new TextEncoder().encode(s));

/** An access token for the service account: a signed JWT exchanged at Google. */
export async function serviceAccountToken(sa: ServiceAccount, scope = DRIVE_SCOPE): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token";
  const header = b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64urlText(JSON.stringify({ iss: sa.client_email, scope, aud: tokenUri, iat: now, exp: now + 3600 }));
  const pem = sa.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`)));
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${b64url(sig)}`,
    }),
  });
  const body = await res.json().catch(() => null) as { access_token?: string; error_description?: string } | null;
  if (!res.ok || !body?.access_token) {
    throw new Error(`Google sign-in failed (${res.status})${body?.error_description ? `: ${body.error_description}` : ""}`);
  }
  return body.access_token;
}

async function driveGet(token: string, path: string, params: Record<string, string> = {}): Promise<Response> {
  const url = new URL(`${DRIVE_API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
}

export function driveError(status: number, what: string): string {
  if (status === 404) {
    return `${what}: Drive says it doesn't exist — usually the folder hasn't been shared with AION's address yet.`;
  }
  if (status === 403) return `${what}: Drive refused access (403). Check the folder is shared with AION's address.`;
  if (status === 429) return `${what}: Drive rate limit — will retry on the next run.`;
  return `${what}: Drive ${status}`;
}

/** The folder itself — its name, and proof that it is shared with us and is a folder. */
export async function getFolder(token: string, folderId: string): Promise<{ id: string; name: string }> {
  const res = await driveGet(token, `files/${folderId}`, { fields: "id,name,mimeType", supportsAllDrives: "true" });
  if (!res.ok) throw new Error(driveError(res.status, "Folder"));
  const f = await res.json() as DriveFile;
  if (f.mimeType !== FOLDER_MIME) throw new Error("That link is a file, not a folder. Share and paste the folder that holds it.");
  return { id: f.id, name: f.name };
}

export type ListedFile = DriveFile & { path: string[] };

/**
 * Every file under the folder, recursively, with the folder path it sits in.
 * Breadth-first, capped: a brand that shares its whole company Drive by mistake
 * should get a clear "too many files" and not a sync that runs for a week.
 */
export async function listFolderTree(
  token: string, rootId: string, opts: { maxFiles?: number; maxFolders?: number } = {},
): Promise<{ files: ListedFile[]; truncated: boolean }> {
  const maxFiles = opts.maxFiles ?? 2000;
  const maxFolders = opts.maxFolders ?? 300;
  const files: ListedFile[] = [];
  const queue: { id: string; path: string[] }[] = [{ id: rootId, path: [] }];
  const seen = new Set<string>([rootId]);
  let folders = 0;

  while (queue.length) {
    const { id, path } = queue.shift()!;
    if (++folders > maxFolders) return { files, truncated: true };
    let pageToken = "";
    do {
      const res = await driveGet(token, "files", {
        q: `'${id}' in parents and trashed = false`,
        fields: "nextPageToken,files(id,name,mimeType,modifiedTime,size,webViewLink)",
        pageSize: "1000",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
        ...(pageToken ? { pageToken } : {}),
      });
      if (!res.ok) throw new Error(driveError(res.status, "Listing the folder"));
      const body = await res.json() as { nextPageToken?: string; files?: DriveFile[] };
      for (const f of body.files ?? []) {
        if (f.mimeType === FOLDER_MIME) {
          if (!seen.has(f.id)) { seen.add(f.id); queue.push({ id: f.id, path: [...path, f.name] }); }
        } else {
          files.push({ ...f, path });
          if (files.length >= maxFiles) return { files, truncated: true };
        }
      }
      pageToken = body.nextPageToken ?? "";
    } while (pageToken);
  }
  return { files, truncated: false };
}

/** The file's bytes: exported as text for Google-native files, downloaded otherwise. */
export async function fetchFileBytes(token: string, f: DriveFile, plan: FilePlan): Promise<Uint8Array> {
  if (plan.how === "skip") throw new Error(plan.reason);
  const res = plan.how === "export"
    ? await driveGet(token, `files/${f.id}/export`, { mimeType: plan.exportMime })
    : await driveGet(token, `files/${f.id}`, { alt: "media", supportsAllDrives: "true" });
  if (!res.ok) {
    // Drive answers 403 exportSizeLimitExceeded for a Doc over 10 MB.
    const text = await res.text().catch(() => "");
    if (res.status === 403 && /exportSizeLimitExceeded/.test(text)) throw new Error("too large for Drive to export (10 MB)");
    throw new Error(driveError(res.status, f.name));
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_DOWNLOAD_BYTES) throw new Error("larger than 25 MB");
  return bytes;
}
