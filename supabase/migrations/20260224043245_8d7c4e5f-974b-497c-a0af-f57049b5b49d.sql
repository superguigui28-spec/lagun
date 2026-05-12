
-- Create temp bucket for file uploads
INSERT INTO storage.buckets (id, name, public) VALUES ('temp-uploads', 'temp-uploads', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read
CREATE POLICY "Public read temp-uploads" ON storage.objects FOR SELECT USING (bucket_id = 'temp-uploads');

-- Allow authenticated insert
CREATE POLICY "Auth insert temp-uploads" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'temp-uploads');

-- Allow authenticated delete
CREATE POLICY "Auth delete temp-uploads" ON storage.objects FOR DELETE USING (bucket_id = 'temp-uploads');
