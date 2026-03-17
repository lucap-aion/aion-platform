import { Resend } from "npm:resend@4";
import { createClient } from "npm:@supabase/supabase-js@2";

const resend = new Resend(Deno.env.get("RESEND_API_KEY")!);
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

const supabaseAdmin = createClient(
  SUPABASE_URL,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ─── Assets ──────────────────────────────────────────────────────────────────
const AION_LOGO =
  "https://dvmhwsmunvfdxnvckdom.supabase.co/storage/v1/object/public/brand_logos/aion_logo_dark.png";

// ─── Shared styles ────────────────────────────────────────────────────────────
const S = {
  body:    `margin:0;padding:0;background-color:#FAF8F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`,
  wrap:    `max-width:600px;margin:0 auto;padding:48px 16px`,
  card:    `background-color:#ffffff;border-radius:16px;padding:40px 40px 32px;border:1px solid #EDE5D8`,
  title:   `margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:#1C1208;line-height:1.3`,
  text:    `margin:0 0 16px;font-size:15px;line-height:1.7;color:#4A3F35`,
  btnWrap: `text-align:center;margin:32px 0`,
  btn:     `display:inline-block;background-color:#7A5F28;color:#ffffff;padding:14px 36px;border-radius:8px;font-weight:600;font-size:15px;text-decoration:none;letter-spacing:0.2px`,
  rule:    `border:none;border-top:1px solid #EDE5D8;margin:28px 0`,
  footer:  `text-align:center;padding-top:28px;font-size:12px;color:#B0A090;line-height:1.6`,
  small:   `margin:20px 0 0;font-size:12px;line-height:1.6;color:#B0A090`,
};

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function fetchBrandLogo(brandName: string | null): Promise<string | null> {
  if (!brandName || brandName === "AION Cover") return null;
  const { data } = await supabaseAdmin
    .from("brands")
    .select("logo_big, logo_small")
    .eq("name", brandName)
    .maybeSingle();
  return (data as any)?.logo_big || (data as any)?.logo_small || null;
}

// ─── Logo helpers ─────────────────────────────────────────────────────────────
// Table-based layout so logos scale correctly in all email clients regardless
// of the image's natural dimensions.
// Notes:
//  - Outlook (Word engine) needs explicit width/height HTML attributes, not just CSS.
//  - Dark-mode switching via CSS class is unsupported in Outlook → the .aion-light
//    img is wrapped in <!--[if !mso]><!--> so Outlook never renders it.
//  - border="0" prevents blue link borders in legacy clients.

function soloLogo(src: string, alt: string): string {
  return `
  <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:36px">
    <tr><td align="center">
      <img src="${src}" alt="${alt}" width="160" height="40" border="0"
           style="display:block;max-height:48px;max-width:180px;width:auto;height:auto" />
    </td></tr>
  </table>`;
}

function dualLogo(brandName: string, brandLogoUrl: string): string {
  return `
  <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:36px">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        <tr>
          <td style="padding-right:20px;border-right:1px solid #EDE5D8;vertical-align:middle">
            <img src="${brandLogoUrl}" alt="${brandName}" height="44" border="0"
                 style="display:block;max-height:44px;max-width:180px;width:auto;height:auto" />
          </td>
          <td style="padding-left:20px;vertical-align:middle">
            <img src="${AION_LOGO}" alt="AION Cover" width="80" height="20" border="0"
                 style="display:block;max-height:20px;max-width:90px;width:auto;height:auto" />
          </td>
        </tr>
      </table>
    </td></tr>
  </table>`;
}

function logoBlock(brandName: string, brandLogoUrl: string | null): string {
  return brandLogoUrl
    ? dualLogo(brandName, brandLogoUrl)
    : soloLogo(AION_LOGO, "AION Cover");
}

// ─── Shared fragments ─────────────────────────────────────────────────────────
const autoNote = `<p style="${S.small}">This is an automated message — please do not reply. For help, contact <a href="mailto:team@aioncover.com" style="color:#7A5F28;text-decoration:none">team@aioncover.com</a>.</p>`;
const copyright = `<p style="${S.footer}">© AION Cover · All rights reserved</p>`;

function wrap(inner: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${S.body}"><div style="${S.wrap}"><div style="${S.card}">${inner}</div>${copyright}</div></body></html>`;
}

function htmlToText(html: string): string {
  return html
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi, "$2 ( $1 )")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, "  ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/<!--.*?-->/gs, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Templates ────────────────────────────────────────────────────────────────

function adminVerifyHtml(firstName: string | null, verifyUrl: string): string {
  const greeting = firstName ? `Dear ${firstName},` : "Hello,";
  return wrap(`
    ${soloLogo(AION_LOGO, "AION Cover")}
    <h1 style="${S.title}">Verify your admin account</h1>
    <p style="${S.text}">${greeting}</p>
    <p style="${S.text}">You recently registered for an AION Cover admin account. Click the button below to verify your email address and activate your account.</p>
    <div style="${S.btnWrap}"><a href="${verifyUrl}" target="_blank" style="${S.btn}">Verify Email Address</a></div>
    <p style="${S.text}">This link expires in 24 hours. If you did not register, you can safely ignore this email.</p>
    <p style="${S.text}">Best regards,<br><strong>AION Cover Team</strong></p>
    ${autoNote}`);
}

function adminResetHtml(firstName: string | null, resetUrl: string): string {
  const greeting = firstName ? `Dear ${firstName},` : "Hello,";
  return wrap(`
    ${soloLogo(AION_LOGO, "AION Cover")}
    <h1 style="${S.title}">Reset your password</h1>
    <p style="${S.text}">${greeting}</p>
    <p style="${S.text}">We received a request to reset the password for your AION Cover admin account. Click the button below to set a new password.</p>
    <div style="${S.btnWrap}"><a href="${resetUrl}" target="_blank" style="${S.btn}">Reset Password</a></div>
    <p style="${S.text}">This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email.</p>
    <p style="${S.text}">Best regards,<br><strong>AION Cover Team</strong></p>
    ${autoNote}`);
}

function userVerifyHtml(
  firstName: string | null,
  brandName: string,
  brandLogoUrl: string | null,
  verifyUrl: string,
): string {
  const greeting = firstName ? `Dear ${firstName},` : "Hello,";
  return wrap(`
    ${logoBlock(brandName, brandLogoUrl)}
    <h1 style="${S.title}">Verify your email address</h1>
    <p style="${S.text}">${greeting}</p>
    <p style="${S.text}">Thank you for registering with <strong>${brandName}</strong> on AION Cover. Click the button below to verify your email and activate your account.</p>
    <div style="${S.btnWrap}"><a href="${verifyUrl}" target="_blank" style="${S.btn}">Verify Email Address</a></div>
    <p style="${S.text}">This link expires in 24 hours. If you did not register, you can safely ignore this email.</p>
    <p style="${S.text}">Best regards,<br><strong>AION Cover Team</strong></p>
    ${autoNote}`);
}

function userResetHtml(
  firstName: string | null,
  brandName: string,
  brandLogoUrl: string | null,
  resetUrl: string,
): string {
  const greeting = firstName ? `Dear ${firstName},` : "Hello,";
  return wrap(`
    ${logoBlock(brandName, brandLogoUrl)}
    <h1 style="${S.title}">Reset your password</h1>
    <p style="${S.text}">${greeting}</p>
    <p style="${S.text}">We received a request to reset the password for your <strong>${brandName}</strong> account. Click the button below to set a new password.</p>
    <div style="${S.btnWrap}"><a href="${resetUrl}" target="_blank" style="${S.btn}">Reset Password</a></div>
    <p style="${S.text}">This link expires in 1 hour. If you did not request this, you can safely ignore this email.</p>
    <p style="${S.text}">Best regards,<br><strong>AION Cover Team</strong></p>
    ${autoNote}`);
}

// ─── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const { user, email_data } = payload;

    const email: string = user?.email ?? "";
    const meta = user?.user_metadata ?? {};

    const firstName: string | null = meta.first_name ?? null;
    const brandName: string = meta.brand_name ?? "AION Cover";
    const brandLogoUrl: string | null = await fetchBrandLogo(brandName);

    const actionType: string = email_data?.email_action_type ?? "";
    const tokenHash: string = email_data?.token_hash ?? "";
    const redirectTo: string = email_data?.redirect_to ?? SUPABASE_URL;

    const verifyUrl =
      `${SUPABASE_URL}/auth/v1/verify?token=${tokenHash}&type=${actionType}&redirect_to=${encodeURIComponent(redirectTo)}`;

    // Determine user type: admins get AION-branded emails
    const { data: adminRow } = await supabaseAdmin
      .from("admins")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    const isAdmin = adminRow !== null;

    let subject = "";
    let html = "";

    if (actionType === "signup" || actionType === "email_change") {
      if (isAdmin) {
        subject = "Verify your AION Admin account";
        html = adminVerifyHtml(firstName, verifyUrl);
      } else {
        subject = `Verify your email — ${brandName}`;
        html = userVerifyHtml(firstName, brandName, brandLogoUrl, verifyUrl);
      }
    } else if (actionType === "recovery") {
      if (isAdmin) {
        subject = "Reset your AION Admin password";
        html = adminResetHtml(firstName, verifyUrl);
      } else {
        subject = `Reset your password — ${brandName}`;
        html = userResetHtml(firstName, brandName, brandLogoUrl, verifyUrl);
      }
    } else if (actionType === "magiclink") {
      subject = `Your sign-in link — ${brandName}`;
      html = userVerifyHtml(firstName, brandName, brandLogoUrl, verifyUrl);
    } else {
      // Unknown type — return OK so Supabase does not retry
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    await resend.emails.send({
      from: "AION Cover <team@aioncover.com>",
      to: [email],
      subject,
      html,
      text: htmlToText(html),
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[auth-email-hook]", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
