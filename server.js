'use strict';
const express = require('express');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const { google } = require('googleapis');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
app.use(express.json({ limit: '50mb' }));
const PORT = process.env.PORT || 3000;
const RAILWAY_SECRET = process.env.RAILWAY_SECRET || 'changeme';

function authMiddleware(req, res, next) {
  const s = req.headers['x-railway-secret'];
    if (s !== RAILWAY_SECRET) return res.status(401).json({ error: 'Unauthorized' });
      next();
      }

      app.get('/', (req, res) => res.json({ status: 'ok', service: 'canal-infantil-railway' }));

      app.post('/render', authMiddleware, async (req, res) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-'));
          try {
              const { escenas, narracion_url, cancion_url, episodio_id } = req.body;
                  if (!escenas || !narracion_url) return res.status(400).json({ error: 'Missing params' });
                      const narrPath = path.join(tmpDir, 'nar.mp3');
                          const nr = await axios.get(narracion_url, { responseType: 'arraybuffer' });
                              fs.writeFileSync(narrPath, Buffer.from(nr.data));
                                  let canPath = null;
                                      if (cancion_url) {
                                            try {
                                                    canPath = path.join(tmpDir, 'can.mp3');
                                                            const cr = await axios.get(cancion_url, { responseType: 'arraybuffer' });
                                                                    fs.writeFileSync(canPath, Buffer.from(cr.data));
                                                                          } catch(e) { canPath = null; }
                                                                              }
                                                                                  const imgs = [];
                                                                                      for (let i = 0; i < escenas.length; i++) {
                                                                                            const ip = path.join(tmpDir, 'e' + i + '.jpg');
                                                                                                  const ir = await axios.get(escenas[i].imagen_url, { responseType: 'arraybuffer' });
                                                                                                        fs.writeFileSync(ip, Buffer.from(ir.data));
                                                                                                              imgs.push({ path: ip, dur: escenas[i].duracion_segundos || 5 });
                                                                                                                  }
                                                                                                                      const slidePath = path.join(tmpDir, 'slide.mp4');
                                                                                                                          const cf = path.join(tmpDir, 'c.txt');
                                                                                                                              let ct = imgs.map(p => "file '" + p.path + "'\nduration " + p.dur).join('\n');
                                                                                                                                  if (imgs.length) ct += "\nfile '" + imgs[imgs.length - 1].path + "'";
                                                                                                                                      fs.writeFileSync(cf, ct);
                                                                                                                                          await new Promise((ok, fail) => ffmpeg().input(cf).inputOptions(['-f', 'concat', '-safe', '0']).videoCodec('libx264').outputOptions(['-pix_fmt', 'yuv420p', '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1', '-r', '24']).noAudio().output(slidePath).on('end', ok).on('error', fail).run());
                                                                                                                                              const mixPath = path.join(tmpDir, 'mix.mp3');
                                                                                                                                                  if (canPath) {
                                                                                                                                                        await new Promise((ok, fail) => ffmpeg().input(narrPath).input(canPath).complexFilter(['[1:a]volume=0.12[m]', '[0:a][m]amix=inputs=2:duration=first[out]']).outputOptions(['-map', '[out]', '-c:a', 'libmp3lame', '-q:a', '4']).output(mixPath).on('end', ok).on('error', fail).run());
                                                                                                                                                            } else { fs.copyFileSync(narrPath, mixPath); }
                                                                                                                                                                const outPath = path.join(tmpDir, (episodio_id || uuidv4()) + '.mp4');
                                                                                                                                                                    await new Promise((ok, fail) => ffmpeg().input(slidePath).input(mixPath).videoCodec('copy').audioCodec('aac').outputOptions(['-shortest', '-movflags', '+faststart']).output(outPath).on('end', ok).on('error', fail).run());
                                                                                                                                                                        const buf = fs.readFileSync(outPath);
                                                                                                                                                                            res.json({ video_base64: buf.toString('base64'), episodio_id: episodio_id || 'unknown' });
                                                                                                                                                                              } catch(e) { res.status(500).json({ error: e.message }); }
                                                                                                                                                                                finally { try { fs.rmSync(tmpDir, { recursive: true }); } catch(e) {} }
                                                                                                                                                                                });
                                                                                                                                                                                
                                                                                                                                                                                app.post('/youtube-upload', authMiddleware, async (req, res) => {
                                                                                                                                                                                  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-'));
                                                                                                                                                                                    try {
                                                                                                                                                                                        const { video_base64, thumbnail_url, titulo, descripcion, tags, episodio_id } = req.body;
                                                                                                                                                                                            if (!video_base64 || !titulo) return res.status(400).json({ error: 'Missing params' });
                                                                                                                                                                                                const oa = new google.auth.OAuth2(process.env.YOUTUBE_CLIENT_ID, process.env.YOUTUBE_CLIENT_SECRET, 'urn:ietf:wg:oauth:2.0:oob');
                                                                                                                                                                                                    oa.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN });
                                                                                                                                                                                                        const yt = google.youtube({ version: 'v3', auth: oa });
                                                                                                                                                                                                            const vp = path.join(tmpDir, (episodio_id || uuidv4()) + '.mp4');
                                                                                                                                                                                                                fs.writeFileSync(vp, Buffer.from(video_base64, 'base64'));
                                                                                                                                                                                                                    const up = await yt.videos.insert({
                                                                                                                                                                                                                          part: ['snippet', 'status'],
                                                                                                                                                                                                                                requestBody: {
                                                                                                                                                                                                                                        snippet: { title: titulo, description: descripcion || '', tags: tags || [], categoryId: '27', defaultLanguage: 'es', defaultAudioLanguage: 'es' },
                                                                                                                                                                                                                                                status: { privacyStatus: 'private', selfDeclaredMadeForKids: true }
                                                                                                                                                                                                                                                      },
                                                                                                                                                                                                                                                            media: { body: fs.createReadStream(vp) }
                                                                                                                                                                                                                                                                });
                                                                                                                                                                                                                                                                    const vid = up.data.id;
                                                                                                                                                                                                                                                                        if (thumbnail_url && vid) {
                                                                                                                                                                                                                                                                              try {
                                                                                                                                                                                                                                                                                      const tr = await axios.get(thumbnail_url, { responseType: 'arraybuffer' });
                                                                                                                                                                                                                                                                                              const tp = path.join(tmpDir, 'thumb.jpg');
                                                                                                                                                                                                                                                                                                      fs.writeFileSync(tp, Buffer.from(tr.data));
                                                                                                                                                                                                                                                                                                              await yt.thumbnails.set({ videoId: vid, media: { mimeType: 'image/jpeg', body: fs.createReadStream(tp) } });
                                                                                                                                                                                                                                                                                                                    } catch(e) { console.warn('thumb fail', e.message); }
                                                                                                                                                                                                                                                                                                                        }
                                                                                                                                                                                                                                                                                                                            res.json({ youtube_id: vid, youtube_url: 'https://youtube.com/watch?v=' + vid, episodio_id: episodio_id || 'unknown' });
                                                                                                                                                                                                                                                                                                                              } catch(e) { res.status(500).json({ error: e.message }); }
                                                                                                                                                                                                                                                                                                                                finally { try { fs.rmSync(tmpDir, { recursive: true }); } catch(e) {} }
                                                                                                                                                                                                                                                                                                                                });
                                                                                                                                                                                                                                                                                                                                
                                                                                                                                                                                                                                                                                                                                app.listen(PORT, () => console.log('Canal Infantil Railway port ' + PORT));
                                                                                                                                                                                                                                                                                                                                module.exports = app;
