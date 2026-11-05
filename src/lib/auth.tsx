import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

import type { Role } from "@/lib/access";
export type { Role };
type AuthState = {
  session: Session | null;
  roles: Role[];
  realRoles: Role[];
  isSuperAdmin: boolean;
  viewAs: Role | null;
  setViewAs: (r: Role | null) => void;
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
  const [viewAs, setViewAs] = useState<Role | null>(null);

  const loadRoles = async (uid: string | undefined) => {
    if (!uid) return setRoles([]);
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", uid);
    setRoles((data ?? []).map((r) => r.role as Role));
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setTimeout(() => void loadRoles(s?.user.id), 0);
    });
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadRoles(data.session?.user.id);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider
      value={(() => {
        const isSuperAdmin = roles.includes("admin") && session?.user.email?.toLowerCase() === "macroyetu@gmail.com";
        const eff: Role[] = isSuperAdmin && viewAs ? [viewAs] : roles;
        return {
        session,
        roles: eff,
        realRoles: roles,
        isSuperAdmin,
        viewAs: isSuperAdmin ? viewAs : null,
        setViewAs,
        loading,
        isAdmin: eff.includes("admin"),
        isMember: roles.length > 0,
        isPromoter: eff.includes("promoter"),
        isManager: eff.includes("admin") || eff.includes("promoter"),
        refreshRoles: () => loadRoles(session?.user.id),
        };
      })()}
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
