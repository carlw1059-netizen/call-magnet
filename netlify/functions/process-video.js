const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const authHeader = event.headers['authorization'];
    if (!authHeader) {
      return { statusCode: 401, body: JSON.stringify({ error: 'No auth header' }) };
    }

    const body = JSON.parse(event.body);
    const { client_id, storage_path } = body;

    if (!client_id || !storage_path) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing client_id or storage_path' }) };
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Download the file from Supabase Storage
    const { data: downloadData, error: downloadError } = await supabase.storage
      .from('middle-man-backgrounds')
      .download(storage_path);

    if (downloadError) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Download failed: ' + downloadError.message }) };
    }

    const inputBuffer = Buffer.from(await downloadData.arrayBuffer());

    const tmpDir = os.tmpdir();
    const timestamp = Date.now();
    const inputPath = path.join(tmpDir, `input-${timestamp}.mp4`);
    const outputPath = path.join(tmpDir, `output-${timestamp}.mp4`);

    fs.writeFileSync(inputPath, inputBuffer);

    const ffmpegPath = path.join(__dirname, 'ffmpeg');

    execSync(`"${ffmpegPath}" -i "${inputPath}" -movflags faststart -an -vcodec copy -y "${outputPath}"`, {
      timeout: 30000
    });

    const processedBuffer = fs.readFileSync(outputPath);

    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);

    // Overwrite the same path with the faststart version
    const { error: uploadError } = await supabase.storage
      .from('middle-man-backgrounds')
      .upload(storage_path, processedBuffer, {
        contentType: 'video/mp4',
        upsert: true
      });

    if (uploadError) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Re-upload failed: ' + uploadError.message }) };
    }

    const { data: { publicUrl } } = supabase.storage
      .from('middle-man-backgrounds')
      .getPublicUrl(storage_path);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, urls: { video: publicUrl } })
    };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
