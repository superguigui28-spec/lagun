
CREATE TABLE public.chatbot_event_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name text NOT NULL,
  event_date date NULL,
  event_location text NULL,
  attractions text NULL,
  age_rating text NULL,
  observations text NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.chatbot_event_knowledge ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Partners can manage chatbot knowledge"
ON public.chatbot_event_knowledge
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role));
