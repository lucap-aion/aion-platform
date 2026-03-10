import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";
import { useTenant } from "@/contexts/TenantContext";

interface Profile {
  id: string;
  user_id: string | null;
  brand_id: number;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string | null;
  avatar: string | null;
  city: string | null;
  country: string | null;
  postcode: string | null;
  phone_number: string | null;
  address: string | null;
  is_master: boolean | null;
}

interface AdminRecord {
  id: string;
  user_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string | null;
  avatar: string | null;
  phone_number: string | null;
  city: string | null;
  country: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  adminRecord: AdminRecord | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  isCustomer: boolean;
  isBrandUser: boolean;
  isAdmin: boolean;
  /** Brand admin, or brand_user with is_master = true */
  canWrite: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  profile: null,
  adminRecord: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
  isCustomer: false,
  isBrandUser: false,
  isAdmin: false,
  canWrite: false,
});

export const isCustomerRole = (role?: string | null) => !role || role === "customer";
export const isBrandRole = (role?: string | null) =>
  role === "brand" || role === "brand_admin" || role === "brand_user";
export const isAdminRole = (role?: string | null) => role === "admin";

const PROFILE_COLS =
  "id, user_id, brand_id, first_name, last_name, email, role, avatar, city, country, postcode, phone_number, address, is_master";
const ADMIN_COLS =
  "id, user_id, first_name, last_name, email, role, avatar, phone_number, city, country";

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const { id: tenantBrandId } = useTenant();

  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [adminRecord, setAdminRecord] = useState<AdminRecord | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    const userEmail = authUser?.email;

    // ── Admins table (takes priority over profiles) ──────────────────────────
    const { data: adminByUserId } = await supabase
      .from("admins")
      .select(ADMIN_COLS)
      .eq("user_id", userId)
      .maybeSingle();

    if (adminByUserId) {
      setAdminRecord(adminByUserId);
      setProfile(null);
      return;
    }

    // Fallback: find admin by email (first login after invite, user_id still NULL)
    if (userEmail) {
      const { data: adminByEmail } = await supabase
        .from("admins")
        .select(ADMIN_COLS)
        .eq("email", userEmail)
        .maybeSingle();

      if (adminByEmail) {
        // Link the admin record to this auth user (self-claim policy allows this)
        await supabase
          .from("admins")
          .update({ user_id: userId, status: "active" })
          .eq("id", adminByEmail.id);
        setAdminRecord({ ...adminByEmail, user_id: userId });
        setProfile(null);
        return;
      }
    }

    // ── Profiles table ────────────────────────────────────────────────────────
    // Always filter by the current brand when we know it — critical for multi-brand users
    let profileQuery = supabase.from("profiles").select(PROFILE_COLS).eq("user_id", userId);
    if (tenantBrandId) profileQuery = profileQuery.eq("brand_id", tenantBrandId);

    const { data: profileByUserId } = await profileQuery.maybeSingle();
    let profileData = profileByUserId;

    // Fallback: find profile by email (first login, user_id still NULL — trigger may not have run)
    if (!profileData && userEmail) {
      let fallbackQuery = supabase
        .from("profiles")
        .select(PROFILE_COLS)
        .eq("email", userEmail)
        .is("user_id", null);
      if (tenantBrandId) fallbackQuery = fallbackQuery.eq("brand_id", tenantBrandId);

      const { data: profileByEmail } = await fallbackQuery.maybeSingle();
      if (profileByEmail) {
        await supabase.from("profiles").update({ user_id: userId }).eq("id", profileByEmail.id);
        profileData = { ...profileByEmail, user_id: userId };
      }
    }

    setProfile(profileData ?? null);
    setAdminRecord(null);
  };

  const hydrateSession = async (nextSession: Session | null) => {
    setLoading(true);
    setSession(nextSession);
    setUser(nextSession?.user ?? null);
    try {
      if (nextSession?.user) {
        await fetchProfile(nextSession.user.id);
      } else {
        setProfile(null);
        setAdminRecord(null);
      }
    } catch {
      setProfile(null);
      setAdminRecord(null);
    } finally {
      setLoading(false);
    }
  };

  // Initialise on mount and react to auth state changes
  useEffect(() => {
    let initialized = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (initialized) void hydrateSession(nextSession);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      initialized = true;
      void hydrateSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Re-fetch profile when the active brand changes (multi-brand users navigating between portals)
  useEffect(() => {
    if (user && tenantBrandId) void fetchProfile(user.id);
  }, [tenantBrandId]);

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setAdminRecord(null);
    setUser(null);
    setSession(null);
  };

  const isAdmin = adminRecord !== null;
  const canWrite =
    profile?.role === "brand_admin" ||
    (isBrandRole(profile?.role) && profile?.is_master === true);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        adminRecord,
        loading,
        signOut,
        refreshProfile,
        isCustomer: isCustomerRole(profile?.role),
        isBrandUser: isBrandRole(profile?.role),
        isAdmin,
        canWrite,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
