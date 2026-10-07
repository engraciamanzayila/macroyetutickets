CREATE TYPE public.app_role AS ENUM ('admin','staff');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE(user_id, role)
);
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
GRANT SELECT, INSERT, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
CREATE OR REPLACE FUNCTION public.is_member(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id)
$$;

CREATE POLICY "own or admin read profiles" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "own update profile" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "read roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin insert roles" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin delete roles" ON public.user_roles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin') AND user_id <> auth.uid());

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles(id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'));
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, 'admin');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  event_date date,
  venue text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ticket_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL,
  ticket_type text NOT NULL DEFAULT 'Normal',
  recipient text,
  quantity integer NOT NULL DEFAULT 1,
  source_filename text,
  art_path text,
  art_width integer,
  art_height integer,
  width_cm numeric,
  height_cm numeric,
  layout jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.ticket_groups(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  seq integer NOT NULL,
  status text NOT NULL DEFAULT 'valid',
  used_at timestamptz,
  used_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tickets_event_idx ON public.tickets(event_id);
CREATE INDEX tickets_group_idx ON public.tickets(group_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.events, public.ticket_groups, public.tickets TO authenticated;
GRANT ALL ON public.events, public.ticket_groups, public.tickets TO service_role;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read events" ON public.events FOR SELECT TO authenticated USING (public.is_member(auth.uid()));
CREATE POLICY "admin write events" ON public.events FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "members read groups" ON public.ticket_groups FOR SELECT TO authenticated USING (public.is_member(auth.uid()));
CREATE POLICY "admin write groups" ON public.ticket_groups FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "members read tickets" ON public.tickets FOR SELECT TO authenticated USING (public.is_member(auth.uid()));
CREATE POLICY "admin write tickets" ON public.tickets FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.check_in(p_event uuid, p_code text, p_at timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.tickets; g public.ticket_groups;
BEGIN
  IF NOT public.is_member(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO t FROM public.tickets WHERE event_id = p_event AND code = upper(trim(p_code)) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result','not_found'); END IF;
  SELECT * INTO g FROM public.ticket_groups WHERE id = t.group_id;
  IF t.status = 'void' THEN
    RETURN jsonb_build_object('result','void','code',t.code,'group',g.name,'type',g.ticket_type,'recipient',g.recipient);
  ELSIF t.status = 'used' THEN
    RETURN jsonb_build_object('result','used','code',t.code,'group',g.name,'type',g.ticket_type,'recipient',g.recipient,'used_at',t.used_at);
  END IF;
  UPDATE public.tickets SET status='used', used_at=COALESCE(p_at, now()), used_by=auth.uid() WHERE id=t.id;
  RETURN jsonb_build_object('result','ok','code',t.code,'group',g.name,'type',g.ticket_type,'recipient',g.recipient);
END $$;
REVOKE EXECUTE ON FUNCTION public.check_in(uuid,text,timestamptz) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.check_in(uuid,text,timestamptz) TO authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets;