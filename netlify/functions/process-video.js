const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { PassThrough, Readable } = require('stream');
const { createClient } = require('@supabase/supabase-js');

ffmpeg.setFfmpegPath(ffmpegPath);

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

    const inputStream = Readable.from(inputBuffer);
    const outputChunks = [];
    const outputStream = new PassThrough();
    outputStream.on('data', chunk => outputChunks.push(chunk));

    await new Promise((resolve, reject) => {
      ffmpeg(inputStream)
        .inputFormat('mp4')
        .videoCodec('copy')
        .noAudio()
        .outputOptions(['-movflags faststart+frag_keyframe+empty_moov'])
        .outputFormat('mp4')
        .on('error', reject)
        .on('end', resolve)
        .pipe(outputStream, { end: true });
    });

    const processedBuffer = Buffer.concat(outputChunks);
    const timestamp = Date.now();
    const path = `${client_id}/video-${timestamp}.mp4`;

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { error: uploadError } = await supabase.storage
      .from('middle-man-backgrounds')
      .upload(path, processedBuffer, {
        contentType: 'video/mp4',
        upsert: true
      });

    if (uploadError) {
      return { statusCode: 500, body: JSON.stringify({ error: uploadError.message }) };
    }

    const { data: { publicUrl } } = supabase.storage
      .from('middle-man-backgrounds')
      .getPublicUrl(path);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, urls: { video: publicUrl } })
    };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
