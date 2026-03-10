import { Resend } from "npm:resend@4";
import { createClient } from "npm:@supabase/supabase-js@2";

const resend = new Resend(Deno.env.get("RESEND_API_KEY")!);
const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const isProd = Deno.env.get("ENV") === "production";
const devPrefix = isProd ? "" : "[DEV] ";

// ─── Assets ──────────────────────────────────────────────────────────────────
const AION_LOGO =
  "https://dvmhwsmunvfdxnvckdom.supabase.co/storage/v1/object/public/brand_logos/aion_logo_dark.png";
const DEFAULT_BRAND_LOGO =
  "https://dvmhwsmunvfdxnvckdom.supabase.co/storage/v1/object/public/brand_logos/default_brand_logo.jpg";

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
  label:   `font-size:12px;font-weight:600;letter-spacing:0.8px;text-transform:uppercase;color:#9C8B7A;margin:0 0 4px`,
  value:   `font-size:15px;color:#1C1208;font-weight:500;margin:0 0 16px`,
  footer:  `text-align:center;padding-top:28px;font-size:12px;color:#B0A090;line-height:1.6`,
  small:   `margin:20px 0 0;font-size:12px;line-height:1.6;color:#B0A090`,
};

// ─── Logo helpers ─────────────────────────────────────────────────────────────
// Table-based layout so logos scale correctly in all email clients regardless
// of the image's natural dimensions.

function soloLogo(src: string, alt: string): string {
  return `
  <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:36px">
    <tr><td align="center">
      <img src="${src}" alt="${alt}"
           width="auto" height="auto"
           style="display:block;max-height:48px;max-width:180px;width:auto;height:auto" />
    </td></tr>
  </table>`;
}

function dualLogo(brandName: string, brandLogoUrl: string | null): string {
  const bSrc = brandLogoUrl || DEFAULT_BRAND_LOGO;
  return `
  <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:36px">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        <tr>
          <td style="padding-right:20px;border-right:1px solid #EDE5D8;vertical-align:middle">
            <img src="${bSrc}" alt="${brandName}"
                 width="auto" height="auto"
                 style="display:block;max-height:44px;max-width:160px;width:auto;height:auto" />
          </td>
          <td style="padding-left:20px;vertical-align:middle">
            <img src="${AION_LOGO}" alt="AION Cover"
                 width="auto" height="auto"
                 style="display:block;max-height:28px;max-width:120px;width:auto;height:auto" />
          </td>
        </tr>
      </table>
    </td></tr>
  </table>`;
}

// ─── Shared footer ────────────────────────────────────────────────────────────
const autoNote = `<p style="${S.small}">This is an automated message — please do not reply directly. For help, contact <a href="mailto:team@aioncover.com" style="color:#7A5F28;text-decoration:none">team@aioncover.com</a>.</p>`;
const copyright = `<p style="${S.footer}">© AION Cover · All rights reserved</p>`;

// ─── Wrapper ──────────────────────────────────────────────────────────────────
function wrap(inner: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${S.body}"><div style="${S.wrap}"><div style="${S.card}">${inner}</div>${copyright}</div></body></html>`;
}

// ─── Templates ────────────────────────────────────────────────────────────────

function customerInviteHtml(firstName: string | null, brandName: string, brandLogoUrl: string | null, url: string): string {
  const greeting = firstName ? `Dear ${firstName},` : "Hello,";
  return wrap(`
    ${dualLogo(brandName, brandLogoUrl)}
    <h1 style="${S.title}">You're invited to AION Cover</h1>
    <p style="${S.text}">${greeting}</p>
    <p style="${S.text}">You've been invited to activate your AION Cover protection for items purchased at <strong>${brandName}</strong>.</p>
    <p style="${S.text}">Click the button below to create your account and access your coverage.</p>
    <div style="${S.btnWrap}"><a href="${url}" target="_blank" style="${S.btn}">Activate Your Cover</a></div>
    <p style="${S.text}">If you have any questions, our team is always happy to help.</p>
    <p style="${S.text}">Best regards,<br><strong>AION Cover Team</strong></p>
    ${autoNote}`);
}

function customerTransferHtml(oldCustomer: any, newCustomer: any, policy: any, url: string): string {
  const greeting = newCustomer.first_name ? `Dear ${newCustomer.first_name},` : "Hello,";
  return wrap(`
    ${soloLogo(AION_LOGO, "AION Cover")}
    <h1 style="${S.title}">Someone wants to transfer a cover to you</h1>
    <p style="${S.text}">${greeting}</p>
    <p style="${S.text}"><strong>${oldCustomer.first_name} ${oldCustomer.last_name}</strong> would like to transfer ownership of the following item to you:</p>
    <hr style="${S.rule}">
    <p style="${S.label}">Item</p>
    <p style="${S.value}">${policy.item.name}</p>
    <p style="${S.label}">Brand</p>
    <p style="${S.value}">${policy.brand.name}</p>
    <hr style="${S.rule}">
    <p style="${S.text}">To accept this transfer, log in to your AION Cover account and the cover will be waiting for you.</p>
    <div style="${S.btnWrap}"><a href="${url}" target="_blank" style="${S.btn}">Accept Transfer</a></div>
    <p style="${S.text}">Best regards,<br><strong>AION Cover Team</strong></p>
    ${autoNote}`);
}

function brandUserInviteHtml(firstName: string | null, brandName: string, url: string): string {
  const greeting = firstName ? `Dear ${firstName},` : "Hello,";
  return wrap(`
    ${soloLogo(AION_LOGO, "AION Cover")}
    <h1 style="${S.title}">You've been invited to ${brandName}</h1>
    <p style="${S.text}">${greeting}</p>
    <p style="${S.text}">You've been invited to join the <strong>${brandName}</strong> team on AION Cover. Click the button below to set up your account.</p>
    <div style="${S.btnWrap}"><a href="${url}" target="_blank" style="${S.btn}">Activate Your Account</a></div>
    <p style="${S.text}">Best regards,<br><strong>AION Cover Team</strong></p>
    ${autoNote}`);
}

function adminInviteHtml(url: string): string {
  return wrap(`
    ${soloLogo(AION_LOGO, "AION Cover")}
    <h1 style="${S.title}">Admin invitation</h1>
    <p style="${S.text}">Hello,</p>
    <p style="${S.text}">You have been invited to join AION Cover as an admin. Click the button below to create your account.</p>
    <div style="${S.btnWrap}"><a href="${url}" target="_blank" style="${S.btn}">Activate Your Account</a></div>
    <p style="${S.text}">Best regards,<br><strong>AION Cover Team</strong></p>
    ${autoNote}`);
}

function claimConfirmationHtml(claim: any): string {
  return wrap(`
    ${soloLogo(AION_LOGO, "AION Cover")}
    <h1 style="${S.title}">Claim received</h1>
    <p style="${S.text}">Dear ${claim.policy.customer.first_name},</p>
    <p style="${S.text}">We've received your claim for your <strong>${claim.policy.item.name}</strong> from <strong>${claim.policy.brand.name}</strong>. Our team is reviewing it and will be in touch shortly.</p>
    <hr style="${S.rule}">
    <p style="${S.label}">Cover</p><p style="${S.value}">${claim.policy.item.name} — ${claim.policy.brand.name}</p>
    <p style="${S.label}">Claim type</p><p style="${S.value}">${(claim.type ?? "").replaceAll("_", " ")}</p>
    <hr style="${S.rule}">
    <p style="${S.text}">Best regards,<br><strong>AION Cover Team</strong></p>
    ${autoNote}`);
}

function claimInternalHtml(claim: any): string {
  const incidentDate = claim.incident_date?.split("T")[0] ?? "—";
  const type = (claim.type ?? "").replaceAll("_", " ");
  return wrap(`
    ${soloLogo(AION_LOGO, "AION Cover")}
    <h1 style="${S.title}">New Claim Submission</h1>
    <hr style="${S.rule}">
    <p style="${S.label}">Customer</p><p style="${S.value}">${claim.policy.customer.first_name} ${claim.policy.customer.last_name} &lt;${claim.policy.customer.email}&gt;</p>
    <p style="${S.label}">Cover ID</p><p style="${S.value}">#${claim.policy.id}</p>
    <p style="${S.label}">Brand</p><p style="${S.value}">${claim.policy.brand.name}</p>
    <p style="${S.label}">Item</p><p style="${S.value}">${claim.policy.item.name}</p>
    <hr style="${S.rule}">
    <p style="${S.label}">Claim type</p><p style="${S.value}">${type}</p>
    <p style="${S.label}">Incident date</p><p style="${S.value}">${incidentDate}</p>
    <p style="${S.label}">Description</p><p style="${S.value}">${claim.description ?? "—"}</p>
    ${autoNote}`);
}

function supportInternalHtml(message: any): string {
  return wrap(`
    ${soloLogo(AION_LOGO, "AION Cover")}
    <h1 style="${S.title}">New Support Request</h1>
    <hr style="${S.rule}">
    <p style="${S.label}">Customer</p><p style="${S.value}">${message.customer.first_name} ${message.customer.last_name} &lt;${message.customer.email}&gt;</p>
    <p style="${S.label}">Brand</p><p style="${S.value}">${message.brand.name}</p>
    <hr style="${S.rule}">
    <p style="${S.label}">Message</p><p style="${S.value}">${message.message}</p>
    ${autoNote}`);
}

function supportConfirmationHtml(user: any): string {
  const greeting = user.firstName ? `Dear ${user.firstName},` : "Hello,";
  return wrap(`
    ${soloLogo(AION_LOGO, "AION Cover")}
    <h1 style="${S.title}">We received your request</h1>
    <p style="${S.text}">${greeting}</p>
    <p style="${S.text}">Thank you for reaching out to us. Our team is reviewing your request and will get back to you shortly.</p>
    <p style="${S.text}">Best regards,<br><strong>AION Cover Team</strong></p>
    ${autoNote}`);
}

function transferRequestHtml(customer: any, recipientEmail: string, cover: any): string {
  return wrap(`
    ${soloLogo(AION_LOGO, "AION Cover")}
    <h1 style="${S.title}">Transfer Request</h1>
    <hr style="${S.rule}">
    <p style="${S.label}">From Customer</p>
    <p style="${S.value}">${customer.first_name} ${customer.last_name} &lt;${customer.email}&gt;</p>
    <p style="${S.label}">Transfer To</p>
    <p style="${S.value}">${recipientEmail}</p>
    <hr style="${S.rule}">
    <p style="${S.label}">Cover #${cover.id}</p>
    <p style="${S.value}">${cover.product} — ${cover.brand}</p>
    ${autoNote}`);
}

function feedbackHtml(feedback: any): string {
  return wrap(`
    ${soloLogo(AION_LOGO, "AION Cover")}
    <h1 style="${S.title}">New Feedback Submission</h1>
    <hr style="${S.rule}">
    <p style="${S.label}">Customer</p><p style="${S.value}">${feedback.customer.first_name} ${feedback.customer.last_name} &lt;${feedback.customer.email}&gt;</p>
    <hr style="${S.rule}">
    <p style="${S.label}">Satisfaction</p><p style="${S.value}">${feedback.satisfaction_rate ?? "—"} / 5</p>
    <p style="${S.label}">Recommendation</p><p style="${S.value}">${feedback.recommendation_rate ?? "—"} / 5</p>
    <p style="${S.label}">Peace of mind</p><p style="${S.value}">${feedback.peace_of_mind_rate ?? "—"} / 5</p>
    <p style="${S.label}">Comment</p><p style="${S.value}">${feedback.comment ?? "—"}</p>
    ${autoNote}`);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const { type, data } = await req.json();
    let result: any;

    switch (type) {
      case "customer_invite": {
        const { customer, brand, url } = data;
        result = await resend.emails.send({
          from: "AION Cover <team@aioncover.com>",
          to: [customer.email],
          subject: `${devPrefix}You're invited to AION Cover`,
          html: customerInviteHtml(customer.first_name, brand.name, brand.logo_small, url),
        });
        break;
      }

      case "customer_transfer_invite": {
        const { oldCustomer, newCustomer, policy, url } = data;
        result = await resend.emails.send({
          from: "AION Cover <team@aioncover.com>",
          to: [newCustomer.email],
          subject: `${devPrefix}Item ownership transferred to you`,
          html: customerTransferHtml(oldCustomer, newCustomer, policy, url),
        });
        break;
      }

      case "brand_user_invite": {
        const { brandUser, url } = data;
        result = await resend.emails.send({
          from: "AION Cover <team@aioncover.com>",
          to: [brandUser.email],
          subject: `${devPrefix}You've been invited to AION Cover`,
          html: brandUserInviteHtml(brandUser.first_name, brandUser.brands?.name ?? brandUser.brand_name, url),
        });
        break;
      }

      case "admin_invite": {
        const { admin, url } = data;
        result = await resend.emails.send({
          from: "AION Cover <team@aioncover.com>",
          to: [admin.email],
          subject: `${devPrefix}You've been invited as an AION admin`,
          html: adminInviteHtml(url),
        });
        break;
      }

      case "claim_submitted": {
        const { claim } = data;
        const internalRecipients = ["team@aioncover.com", "luca@aioncover.com", "giulio@aioncover.com"];
        if (isProd) internalRecipients.unshift(claim.policy.brand.email);
        const [internal, confirmation] = await Promise.all([
          resend.emails.send({
            from: "AION Cover <team@aioncover.com>",
            to: internalRecipients,
            subject: `${devPrefix}New claim — ${claim.policy.brand.name}`,
            html: claimInternalHtml(claim),
          }),
          resend.emails.send({
            from: "AION Cover <team@aioncover.com>",
            to: [claim.policy.customer.email],
            subject: `${devPrefix}Claim received — ${claim.policy.brand.name}`,
            html: claimConfirmationHtml(claim),
          }),
        ]);
        result = { internal, confirmation };
        break;
      }

      case "support_submitted": {
        const { user, message } = data;
        const internalRecipients = ["team@aioncover.com", "luca@aioncover.com", "giulio@aioncover.com"];
        if (isProd) internalRecipients.unshift(message.brand.email);
        const [internal, confirmation] = await Promise.all([
          resend.emails.send({
            from: "AION Cover <team@aioncover.com>",
            to: internalRecipients,
            subject: `${devPrefix}New support request — ${message.brand.name}`,
            html: supportInternalHtml(message),
          }),
          resend.emails.send({
            from: "AION Cover <team@aioncover.com>",
            to: [user.email],
            subject: `${devPrefix}We received your request`,
            html: supportConfirmationHtml(user),
          }),
        ]);
        result = { internal, confirmation };
        break;
      }

      case "transfer_request": {
        const { customer, recipient_email, cover, portal_url } = data;
        // cover.policy_id = the policy being transferred

        // 1. Resolve or create recipient profile
        let { data: recipientProfile } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("email", recipient_email)
          .eq("brand_id", cover.brand_id)
          .maybeSingle();

        const isNewUser = !recipientProfile;

        if (isNewUser) {
          const { data: newProfile } = await supabaseAdmin
            .from("profiles")
            .insert({ email: recipient_email, brand_id: cover.brand_id, status: "pending" })
            .select("id")
            .single();
          recipientProfile = newProfile;
        }

        // 2. Fetch current policy to get old customer_id and former_customer_ids
        const { data: policy } = await supabaseAdmin
          .from("policies")
          .select("customer_id, former_customer_ids")
          .eq("id", cover.policy_id)
          .single();

        // 3. Transfer ownership
        const oldCustomerId = policy?.customer_id;
        const prevFormer: any[] = policy?.former_customer_ids ?? [];
        const updatedFormer = oldCustomerId ? [...prevFormer, oldCustomerId] : prevFormer;

        await supabaseAdmin
          .from("policies")
          .update({
            customer_id: recipientProfile?.id,
            transferred_at: new Date().toISOString(),
            former_customer_ids: updatedFormer,
          })
          .eq("id", cover.policy_id);

        // 4. Send emails
        const recipientHtml = customerTransferHtml(
          customer,
          { first_name: null },
          { item: { name: cover.product }, brand: { name: cover.brand } },
          portal_url,
        );

        const recipientSubject = `${devPrefix}${customer.first_name} wants to transfer a cover to you`;

        const [recipientResult, internalResult] = await Promise.all([
          resend.emails.send({
            from: "AION Cover <team@aioncover.com>",
            to: [recipient_email],
            subject: recipientSubject,
            html: recipientHtml,
          }),
          resend.emails.send({
            from: "AION Cover <team@aioncover.com>",
            to: ["team@aioncover.com"],
            bcc: ["luca@aioncover.com", "giulio@aioncover.com"],
            subject: `${devPrefix}Transfer — Cover #${cover.policy_id} (${cover.brand})`,
            html: transferRequestHtml(customer, recipient_email, cover),
          }),
        ]);

        result = { recipientResult, internalResult, isNewUser };
        break;
      }

      case "feedback_submitted": {
        const { feedback } = data;
        result = await resend.emails.send({
          from: "AION Cover <team@aioncover.com>",
          to: ["team@aioncover.com"],
          bcc: ["luca@aioncover.com", "giulio@aioncover.com"],
          subject: `${devPrefix}New feedback submission`,
          html: feedbackHtml(feedback),
        });
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown type: ${type}` }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
    }

    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err: any) {
    console.error("[send-email]", err);
    return new Response(JSON.stringify({ error: err?.message ?? "Internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
