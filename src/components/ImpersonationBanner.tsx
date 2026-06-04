import { useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

/**
 * High-contrast bar shown on every customer/brand page while an AION admin is
 * viewing-as a user. Renders nothing otherwise.
 */
export default function ImpersonationBanner() {
  const { isImpersonating, profile, adminRecord, stopImpersonation } = useAuth();
  const navigate = useNavigate();

  if (!isImpersonating || !profile) return null;

  const targetName =
    [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email;
  const adminName = adminRecord
    ? [adminRecord.first_name, adminRecord.last_name].filter(Boolean).join(" ") || adminRecord.email
    : "AION admin";

  const exit = () => {
    stopImpersonation();
    navigate("/admin/customers");
  };

  return (
    <div className="flex items-center justify-between gap-3 bg-amber-500 px-4 py-2 text-sm text-black">
      <span className="min-w-0 truncate">
        Viewing as <strong>{targetName}</strong>
        {profile.email ? <span className="opacity-80"> ({profile.email})</span> : null} — you are{" "}
        {adminName} (AION admin)
      </span>
      <button
        onClick={exit}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-black/85 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-black"
      >
        <LogOut className="h-3.5 w-3.5" /> Exit view-as
      </button>
    </div>
  );
}
