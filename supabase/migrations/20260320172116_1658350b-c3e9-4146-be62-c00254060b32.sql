
-- Create storage bucket for creative references
INSERT INTO storage.buckets (id, name, public) VALUES ('creative-references', 'creative-references', true);

-- Create table for creative references
CREATE TABLE public.creative_references (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  image_url TEXT NOT NULL,
  observation TEXT,
  events TEXT[] NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.creative_references ENABLE ROW LEVEL SECURITY;

-- Partners/admins can do everything
CREATE POLICY "Partners can view references" ON public.creative_references
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Partners can insert references" ON public.creative_references
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Partners can delete references" ON public.creative_references
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- Storage policies for creative-references bucket
CREATE POLICY "Partners can upload creative references" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'creative-references' AND (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role)));

CREATE POLICY "Anyone can view creative references" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'creative-references');
