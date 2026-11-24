import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

import { normalizeRoles, type Role } from "@/lib/access";
export type { Role };
type AuthState = {
  session: Session | null;
  roles: Role[];
  realRoles: Role[];
  isSuperAdmin: boolean;
  loading: boolean;
  isAdmin: boolean;
  isMember: boolean;
  isPromoter: boolean;
  isManager: boolean;
  refreshRoles: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRoles = async (uid: string | undefined) => {
    if (!uid) {
      setRoles([]);
      return;
    }
    const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", uid);
    if (error) {
      setRoles([]);
      return;
    }
    setRoles(normalizeRoles((data ?? []).map((r) => r.role as Role)));
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      void loadRoles(s?.user.id);
    });
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadRoles(data.session?.user.id);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const isSuperAdmin = roles.includes("admin") && session?.user.email?.toLowerCase() === "macroyetu@gmail.com";

  return (
    <AuthContext.Provider
      value={{
        session,
        roles,
        realRoles: roles,
        isSuperAdmin,
        loading,
        isAdmin: roles.includes("admin"),
        isMember: roles.length > 0,
        isPromoter: roles.includes("promoter"),
        isManager: roles.includes("admin") || roles.includes("promoter"),
        refreshRoles: () => loadRoles(session?.user.id),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
