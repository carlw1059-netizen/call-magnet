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
    const { client_id, file_base64 } = body;

    if (!client_id || !file_base64) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing client_id or file' }) };
    }

    const inputBuffer = Buffer.from(file_base64, 'base64');

    if (inputBuffer.length > 15 * 1024 * 1024) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Video must be under 15MB' }) };
    }

    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `input-${Date.now()}.mp4`);
    const outputPath = path.join(tmpDir, `output-${Date.now()}.mp4`);

    fs.writeFileSync(inputPath, inputBuffer);

    let ffmpegPath;
    try {
      ffmpegPath = require('ffmpeg-static');
    } catch(e) {
      ffmpegPath = '/usr/bin/ffmpeg';
    }

    execSync(`"${ffmpegPath}" -i "${inputPath}" -movflags faststart -an -vcodec copy -y "${outputPath}"`, {
      timeout: 20000
    });

    const processedBuffer = fs.readFileSync(outputPath);

    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);

    const timestamp = Date.now();
    const storagePath = `${client_id}/video-${timestamp}.mp4`;

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { error: uploadError } = await supabase.storage
      .from('middle-man-backgrounds')
      .upload(storagePath, processedBuffer, {
        contentType: 'video/mp4',
        upsert: true
      });

    if (uploadError) {
      return { statusCode: 500, body: JSON.stringify({ error: uploadError.message }) };
    }

    const { data: { publicUrl } } = supabase.storage
      .from('middle-man-backgrounds')
      .getPublicUrl(storagePath);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, urls: { video: publicUrl } })
    };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
