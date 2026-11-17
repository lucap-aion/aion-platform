// What a brand staff member may ask, resolved on the server.
//
// A role (brand_staff_roles, migration 20261117000002) can limit the assistant to the brand's
// approved questions. The browser then sends a preset id, and the WORDS come from the role's
// row here — never from the request. That is the whole point: a page that hides the free-text
// box is a suggestion; a server that only ever asks what the row says is a restriction.
//
// No role, or a master: unrestricted, which is every user before roles existed.

export type AssistantMode = "full" | "preset" | "off";
export type PresetQuestion = { id: string; label: string; question: string };

export type StaffAccess = {
  mode: AssistantMode;
  roleName: string | null;
  presets: PresetQuestion[];
  /** The asker's own store, for a preset that says {{shop}}. */
  shopName: string | null;
};

export const UNRESTRICTED: StaffAccess = { mode: "full", roleName: null, presets: [], shopName: null };

type Client = {
  from: (t: string) => {
    select: (c: string) => { eq: (k: string, v: unknown) => { maybeSingle: () => Promise<{ data: unknown }> } };
  };
};

/** Reads the profile's role. A role that cannot be read is treated as the strictest reading. */
export async function staffAccess(client: Client, profileId: string): Promise<StaffAccess> {
  const { data: p } = await client.from("profiles")
    .select("is_master, staff_role_id, shop_id").eq("id", profileId).maybeSingle();
  const prof = p as { is_master?: boolean | null; staff_role_id?: number | null; shop_id?: number | null } | null;
  if (!prof || prof.is_master === true || prof.staff_role_id == null) return UNRESTRICTED;

  const { data: r } = await client.from("brand_staff_roles")
    .select("name, assistant_mode, preset_questions").eq("id", prof.staff_role_id).maybeSingle();
  const role = r as { name?: string; assistant_mode?: string; preset_questions?: unknown } | null;
  // Assigned but unreadable: fail closed. Open would hand a restricted user everything.
  if (!role) return { mode: "off", roleName: null, presets: [], shopName: null };

  let shopName: string | null = null;
  if (prof.shop_id != null) {
    const { data: s } = await client.from("shops").select("name").eq("id", prof.shop_id).maybeSingle();
    shopName = ((s as { name?: string } | null)?.name ?? "").trim() || null;
  }
  const mode: AssistantMode = role.assistant_mode === "preset" || role.assistant_mode === "off" ? role.assistant_mode : "full";
  return { mode, roleName: role.name ?? null, presets: parsePresets(role.preset_questions), shopName };
}

export function parsePresets(raw: unknown): PresetQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((q) => {
    const o = (q ?? {}) as Record<string, unknown>;
    const id = String(o.id ?? "").trim();
    const question = String(o.question ?? "").trim();
    if (!id || !question) return [];
    return [{ id, question, label: String(o.label ?? "").trim() || question }];
  });
}

/**
 * The question a restricted user is asking, or why they cannot.
 *
 * Preset mode takes ONLY an id. A question, a history, a photo, a spreadsheet or a voice note
 * in the same request is refused rather than ignored: ignoring it would answer something the
 * user did not see themselves ask.
 */
export function resolveRestrictedQuestion(
  access: StaffAccess,
  body: Record<string, unknown>,
  locale: "it" | "en",
): { question: string } | { error: string; status: number } {
  const it = locale === "it";
  if (access.mode === "off") {
    return { status: 403, error: it ? "Il tuo ruolo non ha accesso all'assistente." : "Your role does not have access to the assistant." };
  }
  const extras = ["question", "audio_path", "image", "spreadsheet"].filter((k) => {
    const v = body[k];
    return v != null && v !== "" && !(typeof v === "object" && Object.keys(v as object).length === 0);
  });
  if (extras.length || (Array.isArray(body.history) && body.history.length)) {
    return { status: 403, error: it ? "Il tuo ruolo può fare solo le domande predefinite." : "Your role can only ask the preset questions." };
  }
  const preset = access.presets.find((p) => p.id === String(body.preset_id ?? ""));
  if (!preset) {
    return { status: 400, error: it ? "Domanda non disponibile per il tuo ruolo." : "That question is not available for your role." };
  }
  if (/\{\{\s*shop\s*\}\}/i.test(preset.question)) {
    if (!access.shopName) {
      return { status: 403, error: it ? "Questa domanda riguarda il tuo negozio, ma non hai un negozio assegnato." : "This question is about your store, and no store is assigned to you." };
    }
    return { question: preset.question.replace(/\{\{\s*shop\s*\}\}/gi, access.shopName) };
  }
  return { question: preset.question };
}

/**
 * A preset asked by somebody unrestricted — an AION admin viewing the portal as a restricted
 * user, whose view shows the preset buttons. Admins are not restricted, so this only turns the
 * button into its words; the role must belong to the brand being asked about.
 */
export async function presetForViewer(
  client: Client, roleId: number, brandId: number | null, presetId: string,
): Promise<string | null> {
  const { data } = await client.from("brand_staff_roles")
    .select("brand_id, preset_questions").eq("id", roleId).maybeSingle();
  const role = data as { brand_id?: number; preset_questions?: unknown } | null;
  if (!role || (brandId != null && role.brand_id !== brandId)) return null;
  const preset = parsePresets(role.preset_questions).find((p) => p.id === presetId);
  // Whose store is unknown here; the question still reads, and the admin knows what they asked.
  return preset ? preset.question.replace(/\{\{\s*shop\s*\}\}/gi, "the store") : null;
}
