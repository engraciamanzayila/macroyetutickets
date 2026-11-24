-- Secure bootstrap for the one maximum platform administrator.
-- The role is granted only after Supabase confirms ownership of macroyetu@gmail.com.

CREATE UNIQUE INDEX IF NOT EXISTS user_roles_single_platform_admin_idx
  ON public.user_roles (role)
  WHERE role = 'admin'::public.app_role;

CREATE OR REPLACE FUNCTION public.is_super_admin(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    JOIN public.user_roles r ON r.user_id = u.id
    WHERE u.id = _uid
      AND lower(coalesce(u.email, '')) = 'macroyetu@gmail.com'
      AND u.email_confirmed_at IS NOT NULL
      AND r.role = 'admin'::public.app_role
  )
$$;

CREATE OR REPLACE FUNCTION public.guard_platform_admin_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE target_user uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'admin'::public.app_role THEN
      RAISE EXCEPTION 'O administrador máximo da plataforma não pode ser removido por esta operação.';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.role = 'admin'::public.app_role
     AND (NEW.role IS DISTINCT FROM OLD.role OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    RAISE EXCEPTION 'O administrador máximo da plataforma não pode ser alterado por esta operação.';
  END IF;

  IF NEW.role = 'admin'::public.app_role THEN
    SELECT id INTO target_user
    FROM auth.users
    WHERE id = NEW.user_id
      AND lower(coalesce(email, '')) = 'macroyetu@gmail.com'
      AND email_confirmed_at IS NOT NULL;

    IF target_user IS NULL THEN
      RAISE EXCEPTION 'Apenas a conta verificada macroyetu@gmail.com pode ser administradora máxima.';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS guard_platform_admin_role ON public.user_roles;
CREATE TRIGGER guard_platform_admin_role
BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.guard_platform_admin_role();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.profiles(id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name')
  )
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

  IF lower(coalesce(NEW.email, '')) = 'macroyetu@gmail.com'
     AND NEW.email_confirmed_at IS NOT NULL THEN
    INSERT INTO public.user_roles(user_id, role)
    VALUES (NEW.id, 'admin'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.handle_verified_platform_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF lower(coalesce(NEW.email, '')) = 'macroyetu@gmail.com'
     AND NEW.email_confirmed_at IS NOT NULL
     AND (
       OLD.email_confirmed_at IS DISTINCT FROM NEW.email_confirmed_at
       OR lower(coalesce(OLD.email, '')) IS DISTINCT FROM lower(coalesce(NEW.email, ''))
     ) THEN
    UPDATE public.profiles SET email = NEW.email WHERE id = NEW.id;
    INSERT INTO public.user_roles(user_id, role)
    VALUES (NEW.id, 'admin'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS on_auth_user_verified_platform_admin ON auth.users;
CREATE TRIGGER on_auth_user_verified_platform_admin
AFTER UPDATE OF email, email_confirmed_at ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_verified_platform_admin();

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_verified_platform_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_platform_admin_role() FROM PUBLIC, anon, authenticated;
