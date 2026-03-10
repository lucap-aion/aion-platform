import { supabase } from "@/integrations/supabase/client";

export async function sendEmail(type: string, data: Record<string, unknown>): Promise<string | null> {
  const { error } = await supabase.functions.invoke("send-email", {
    body: { type, data },
  });
  if (error) {
    console.error("[sendEmail]", type, error);
    return error.message ?? "Email sending failed";
  }
  return null;
}
