-- Social media icon row for Middle Man page
ALTER TABLE clients ADD COLUMN social_enabled boolean DEFAULT false;
ALTER TABLE clients ADD COLUMN social_instagram text;
ALTER TABLE clients ADD COLUMN social_instagram_color text DEFAULT '#ffffff';
ALTER TABLE clients ADD COLUMN social_facebook text;
ALTER TABLE clients ADD COLUMN social_facebook_color text DEFAULT '#ffffff';
ALTER TABLE clients ADD COLUMN social_tiktok text;
ALTER TABLE clients ADD COLUMN social_tiktok_color text DEFAULT '#ffffff';
ALTER TABLE clients ADD COLUMN social_youtube text;
ALTER TABLE clients ADD COLUMN social_youtube_color text DEFAULT '#ffffff';
ALTER TABLE clients ADD COLUMN social_whatsapp text;
ALTER TABLE clients ADD COLUMN social_whatsapp_color text DEFAULT '#ffffff';
ALTER TABLE clients ADD COLUMN social_spotify text;
ALTER TABLE clients ADD COLUMN social_spotify_color text DEFAULT '#ffffff';
ALTER TABLE clients ADD COLUMN social_soundcloud text;
ALTER TABLE clients ADD COLUMN social_soundcloud_color text DEFAULT '#ffffff';
