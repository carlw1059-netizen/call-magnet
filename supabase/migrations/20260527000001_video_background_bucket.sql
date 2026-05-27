-- Add video/mp4 support to the middle-man-backgrounds storage bucket.
-- Raise file_size_limit to 10 MB to accommodate compressed MP4 files.

UPDATE storage.buckets
SET
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'video/mp4'],
  file_size_limit    = 10485760   -- 10 MB
WHERE id = 'middle-man-backgrounds';
