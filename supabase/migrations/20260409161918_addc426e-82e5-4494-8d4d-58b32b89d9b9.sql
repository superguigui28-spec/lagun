
CREATE TABLE public.team_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'pendente',
  priority text,
  assigned_to uuid,
  created_by uuid,
  attachments text[] DEFAULT '{}'::text[],
  due_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.team_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can view tasks" ON public.team_tasks
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'partner') OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'design') OR has_role(auth.uid(), 'trafego'));

CREATE POLICY "Team can insert tasks" ON public.team_tasks
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'partner') OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'design') OR has_role(auth.uid(), 'trafego'));

CREATE POLICY "Team can update tasks" ON public.team_tasks
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'partner') OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'design') OR has_role(auth.uid(), 'trafego'));

CREATE POLICY "Team can delete tasks" ON public.team_tasks
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'partner') OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'design') OR has_role(auth.uid(), 'trafego'));

CREATE TRIGGER update_team_tasks_updated_at
  BEFORE UPDATE ON public.team_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
