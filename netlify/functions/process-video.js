const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { Readable } = require('stream');
const https = require('https');
const http = require('http');

ffmpeg.setFfmpegPath(ffmpegPath);

exports.handler = async function(event, context) {
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, message: 'process-video function is alive' })
  };
};
