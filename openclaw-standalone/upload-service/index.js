import express from 'express';
import multer from 'multer';
import FormData from 'form-data';
import pg from 'pg';
import { createReadStream, promises as fs } from 'node:fs';
import { join } from 'node:path';

const app = express();
const PORT = process.env.PORT || 3001;
const MAX_SIZE = (process.env.MAX_FILE_SIZE_MB || 500) * 1024 * 1024;
const FB_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v23.0';

const PG_CONFIG = {
  host: process.env.PG_HOST || 'postgres',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'openclaw_local',
  port: parseInt(process.env.PG_PORT || '5432'),
};

// Multer: temp files only, auto-cleaned after processing
const upload = multer({
  dest: '/tmp/openclaw-uploads',
  limits: { fileSize: MAX_SIZE }
});

// ============================================
// Helper: get pg pool for tenant
// ============================================
const pools = new Map();

function getPool(slug) {
  if (!slug || !/^[a-z0-9_-]+$/i.test(slug)) {
    throw new Error('Invalid slug');
  }
  if (!pools.has(slug)) {
    pools.set(slug, new pg.Pool({
      ...PG_CONFIG,
      database: `openclaw_${slug}`,
      max: 3,
    }));
  }
  return pools.get(slug);
}

// ============================================
// Helper: normalize ad account ID
// ============================================
function normalizeAdAccountId(id) {
  if (!id) return '';
  const s = String(id).trim();
  return s.startsWith('act_') ? s : `act_${s}`;
}

// ============================================
// Facebook API: upload video
// ============================================
async function uploadVideoToFB(adAccountId, token, filePath) {
  const stats = await fs.stat(filePath);
  const fileSize = stats.size;
  const fileSizeMB = Math.round(fileSize / 1024 / 1024);

  console.log(`[FB] Uploading video (${fileSizeMB} MB) to ${adAccountId}`);

  if (fileSize > 50 * 1024 * 1024) {
    return uploadVideoChunked(adAccountId, token, filePath, fileSize);
  }

  // Simple upload for files < 50 MB
  const form = new FormData();
  form.append('source', createReadStream(filePath), {
    filename: 'video.mp4',
    contentType: 'video/mp4'
  });
  form.append('access_token', token);

  const url = `https://graph-video.facebook.com/${FB_API_VERSION}/${adAccountId}/advideos`;
  const res = await fetch(url, {
    method: 'POST',
    body: form,
    headers: form.getHeaders(),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`FB video upload failed: ${data.error?.message || JSON.stringify(data)}`);
  }

  console.log(`[FB] Video uploaded: ${data.id}`);
  return { id: data.id };
}

// ============================================
// Facebook API: chunked upload for large videos
// ============================================
async function uploadVideoChunked(adAccountId, token, filePath, fileSize) {
  const url = `https://graph-video.facebook.com/${FB_API_VERSION}/${adAccountId}/advideos`;

  console.log(`[FB] Starting chunked upload (${Math.round(fileSize / 1024 / 1024)} MB)`);

  // Phase 1: START
  const startForm = new FormData();
  startForm.append('access_token', token);
  startForm.append('upload_phase', 'start');
  startForm.append('file_size', String(fileSize));

  const startRes = await fetch(url, {
    method: 'POST',
    body: startForm,
    headers: startForm.getHeaders(),
  });
  const startData = await startRes.json();
  if (!startRes.ok || startData.error) {
    throw new Error(`FB chunked start failed: ${startData.error?.message || JSON.stringify(startData)}`);
  }

  let { upload_session_id, start_offset, end_offset, video_id } = startData;

  // Phase 2: TRANSFER (loop)
  let chunkNum = 0;
  while (start_offset !== end_offset) {
    chunkNum++;
    const start = parseInt(start_offset, 10);
    const end = parseInt(end_offset, 10);
    const chunkSize = end - start;

    const chunkStream = createReadStream(filePath, { start, end: end - 1 });
    const transferForm = new FormData();
    transferForm.append('access_token', token);
    transferForm.append('upload_phase', 'transfer');
    transferForm.append('upload_session_id', upload_session_id);
    transferForm.append('start_offset', String(start));
    transferForm.append('video_file_chunk', chunkStream, {
      filename: 'video.mp4',
      contentType: 'video/mp4',
      knownLength: chunkSize
    });

    const transferRes = await fetch(url, {
      method: 'POST',
      body: transferForm,
      headers: transferForm.getHeaders(),
    });
    const transferData = await transferRes.json();
    if (!transferRes.ok || transferData.error) {
      throw new Error(`FB chunk ${chunkNum} failed: ${transferData.error?.message || JSON.stringify(transferData)}`);
    }

    start_offset = transferData.start_offset;
    end_offset = transferData.end_offset;

    const progress = Math.round((start / fileSize) * 100);
    console.log(`[FB] Chunk ${chunkNum}: ${progress}%`);
  }

  // Phase 3: FINISH
  const finishForm = new FormData();
  finishForm.append('access_token', token);
  finishForm.append('upload_phase', 'finish');
  finishForm.append('upload_session_id', upload_session_id);

  const finishRes = await fetch(url, {
    method: 'POST',
    body: finishForm,
    headers: finishForm.getHeaders(),
  });
  const finishData = await finishRes.json();

  const finalVideoId = finishData.video_id || video_id;
  console.log(`[FB] Chunked upload complete: ${finalVideoId}`);
  return { id: finalVideoId };
}

// ============================================
// Facebook API: upload image
// ============================================
async function uploadImageToFB(adAccountId, token, filePath) {
  console.log(`[FB] Uploading image to ${adAccountId}`);

  const form = new FormData();
  form.append('filename', createReadStream(filePath));
  form.append('access_token', token);

  const url = `https://graph.facebook.com/${FB_API_VERSION}/${adAccountId}/adimages`;
  const res = await fetch(url, {
    method: 'POST',
    body: form,
    headers: form.getHeaders(),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`FB image upload failed: ${data.error?.message || JSON.stringify(data)}`);
  }

  // Response: { images: { filename: { hash, url } } }
  const imageData = Object.values(data.images || {})[0];
  if (!imageData) {
    throw new Error('FB image upload: no image data in response');
  }

  console.log(`[FB] Image uploaded: hash=${imageData.hash}`);
  return { hash: imageData.hash, url: imageData.url };
}

// ============================================
// Facebook API: post to adcreatives endpoint
// ============================================
async function postCreative(adAccountId, token, payload) {
  const url = `https://graph.facebook.com/${FB_API_VERSION}/${adAccountId}/adcreatives?access_token=${token}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    const err = new Error(`FB creative failed: ${data.error?.message || JSON.stringify(data)}`);
    err.fbError = data.error;
    throw err;
  }
  return data;
}

// ============================================
// Facebook API: create creative (1:1 with main project)
// ============================================
async function createFBCreative(adAccountId, token, params) {
  const { objective, videoId, imageHash, pageId, instagramId, message } = params;

  console.log(`[FB] Creating creative (objective: ${objective})`);

  if (objective === 'whatsapp') {
    return createWhatsAppCreative(adAccountId, token, params);
  } else if (objective === 'instagram_traffic') {
    return createInstagramCreative(adAccountId, token, params);
  } else if (objective === 'site_leads') {
    return createWebsiteLeadsCreative(adAccountId, token, params);
  } else if (objective === 'lead_forms') {
    return createLeadFormCreative(adAccountId, token, params);
  } else if (objective === 'app_installs') {
    return createAppInstallsCreative(adAccountId, token, params);
  }

  throw new Error(`Unsupported objective: ${objective}`);
}

// --- WhatsApp creative (with page_welcome_message + fallbacks) ---
async function createWhatsAppCreative(adAccountId, token, params) {
  const { videoId, imageHash, pageId, instagramId, message, clientQuestion } = params;

  const pageWelcomeMessage = JSON.stringify({
    type: "VISUAL_EDITOR",
    version: 2,
    landing_screen_type: "welcome_message",
    media_type: "text",
    text_format: {
      customer_action_type: "autofill_message",
      message: {
        autofill_message: { content: clientQuestion || 'Здравствуйте! Хочу узнать об этом подробнее.' },
        text: "Здравствуйте! Чем можем помочь?"
      }
    }
  });

  const callToAction = { type: "WHATSAPP_MESSAGE" };

  const buildVideoData = (withWelcome) => {
    const vd = {
      video_id: videoId,
      message: message || '',
      call_to_action: callToAction,
    };
    if (withWelcome) vd.page_welcome_message = pageWelcomeMessage;
    return vd;
  };

  const buildSpec = (videoData, withInstagram) => {
    const spec = { page_id: pageId, video_data: videoData };
    if (withInstagram && instagramId) spec.instagram_user_id = instagramId;
    return spec;
  };

  // Try 1: with page_welcome_message + instagram
  try {
    const result = await postCreative(adAccountId, token, {
      name: "Video CTWA – WhatsApp",
      object_story_spec: buildSpec(buildVideoData(true), true),
    });
    console.log(`[FB] WhatsApp creative created: ${result.id}`);
    return { id: result.id };
  } catch (err) {
    const sub = err.fbError?.error_subcode;
    const code = err.fbError?.code;

    // Fallback: page_welcome_message not supported (1815166 / 1487194)
    if (sub === 1815166 || sub === 1487194) {
      console.log('[FB] page_welcome_message not supported, retrying without it');
      const result = await postCreative(adAccountId, token, {
        name: "Video CTWA – WhatsApp",
        object_story_spec: buildSpec(buildVideoData(false), true),
      });
      console.log(`[FB] WhatsApp creative created (no welcome): ${result.id}`);
      return { id: result.id };
    }

    // Fallback: invalid instagram_user_id (code 100)
    if (code === 100 && err.message?.includes('instagram_user_id') && instagramId) {
      console.log('[FB] invalid instagram_user_id, retrying without it');
      try {
        const result = await postCreative(adAccountId, token, {
          name: "Video CTWA – WhatsApp",
          object_story_spec: buildSpec(buildVideoData(true), false),
        });
        console.log(`[FB] WhatsApp creative created (no IG): ${result.id}`);
        return { id: result.id };
      } catch (retryErr) {
        const retrySub = retryErr.fbError?.error_subcode;
        if (retrySub === 1815166 || retrySub === 1487194) {
          const result = await postCreative(adAccountId, token, {
            name: "Video CTWA – WhatsApp",
            object_story_spec: buildSpec(buildVideoData(false), false),
          });
          return { id: result.id };
        }
        throw retryErr;
      }
    }

    throw err;
  }
}

// --- Instagram Traffic creative ---
async function createInstagramCreative(adAccountId, token, params) {
  const { videoId, pageId, instagramId, instagramUrl, message } = params;

  const videoData = {
    video_id: videoId,
    message: message || '',
    call_to_action: {
      type: "LEARN_MORE",
      value: { link: instagramUrl || `https://www.instagram.com/` }
    }
  };

  const spec = {
    page_id: pageId,
    video_data: videoData,
  };
  if (instagramId) spec.instagram_user_id = instagramId;

  const result = await postCreative(adAccountId, token, {
    name: "Instagram Profile Creative",
    object_story_spec: spec,
  });
  console.log(`[FB] Instagram creative created: ${result.id}`);
  return { id: result.id };
}

// --- Website Leads creative (with url_tags for UTM) ---
async function createWebsiteLeadsCreative(adAccountId, token, params) {
  const { videoId, pageId, instagramId, message, siteUrl, utm, ctaType } = params;

  const videoData = {
    video_id: videoId,
    message: message || '',
    call_to_action: {
      type: ctaType || "SIGN_UP",
      value: { link: siteUrl }
    }
  };

  const spec = { page_id: pageId, video_data: videoData };
  if (instagramId) spec.instagram_user_id = instagramId;

  const result = await postCreative(adAccountId, token, {
    name: "Website Leads Creative",
    url_tags: utm || "utm_source=facebook&utm_campaign={{campaign.name}}&utm_medium={{ad.id}}",
    object_story_spec: spec,
  });
  console.log(`[FB] Website Leads creative created: ${result.id}`);
  return { id: result.id };
}

// --- Lead Form creative ---
async function createLeadFormCreative(adAccountId, token, params) {
  const { videoId, pageId, instagramId, message, leadFormId, ctaType } = params;

  const videoData = {
    video_id: videoId,
    message: message || '',
    call_to_action: {
      type: ctaType || "LEARN_MORE",
      value: { lead_gen_form_id: leadFormId }
    }
  };

  const spec = { page_id: pageId, video_data: videoData };
  if (instagramId) spec.instagram_user_id = instagramId;

  const result = await postCreative(adAccountId, token, {
    name: "Lead Form Video Creative",
    object_story_spec: spec,
  });
  console.log(`[FB] Lead Form creative created: ${result.id}`);
  return { id: result.id };
}

// --- App Installs creative ---
async function createAppInstallsCreative(adAccountId, token, params) {
  const { videoId, pageId, instagramId, message, appStoreUrl } = params;

  const videoData = {
    video_id: videoId,
    message: message || '',
    call_to_action: {
      type: "INSTALL_MOBILE_APP",
      value: { link: appStoreUrl }
    }
  };

  const spec = { page_id: pageId, video_data: videoData };
  if (instagramId) spec.instagram_user_id = instagramId;

  const result = await postCreative(adAccountId, token, {
    name: "App Installs Video Creative",
    object_story_spec: spec,
  });
  console.log(`[FB] App Installs creative created: ${result.id}`);
  return { id: result.id };
}

// ============================================
// GET /health
// ============================================
app.get('/health', (_, res) => res.send('ok'));

// ============================================
// GET /:slug — Upload page with direction selector
// ============================================
app.get('/:slug', async (req, res) => {
  const { slug } = req.params;
  res.send(renderUploadPage(slug));
});

// ============================================
// GET /:slug/directions — JSON API
// ============================================
app.get('/:slug/directions', async (req, res) => {
  const { slug } = req.params;
  try {
    const pool = getPool(slug);
    const { rows } = await pool.query(
      `SELECT id, name, objective FROM directions WHERE is_active = true ORDER BY name`
    );
    res.json(rows);
  } catch (err) {
    console.error(`[directions] Error for slug=${slug}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// POST /:slug/upload — Full processing pipeline
// ============================================
app.post('/:slug/upload', upload.single('file'), async (req, res) => {
  const { slug } = req.params;
  const filePath = req.file?.path;

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'File is required' });
    }

    const directionId = req.body.direction_id;
    const title = req.body.title || req.file.originalname || 'Creative';
    const mediaType = req.file.mimetype?.startsWith('video') ? 'video' : 'image';

    if (!directionId) {
      return res.status(400).json({ success: false, error: 'direction_id is required' });
    }

    console.log(`[upload] slug=${slug}, direction=${directionId}, type=${mediaType}, size=${Math.round(req.file.size / 1024 / 1024)}MB`);

    const pool = getPool(slug);

    // 1. Read config (FB credentials)
    const { rows: configRows } = await pool.query(
      `SELECT fb_access_token, fb_ad_account_id, fb_page_id, fb_instagram_id FROM config WHERE id = 1`
    );
    const config = configRows[0];
    if (!config?.fb_access_token || !config?.fb_ad_account_id || !config?.fb_page_id) {
      return res.status(400).json({
        success: false,
        error: 'Facebook not configured. Run onboarding first.',
      });
    }

    const adAccountId = normalizeAdAccountId(config.fb_ad_account_id);

    // 2. Read direction (objective)
    const { rows: dirRows } = await pool.query(
      `SELECT id, name, objective FROM directions WHERE id = $1`,
      [directionId]
    );
    const direction = dirRows[0];
    if (!direction) {
      return res.status(404).json({ success: false, error: 'Direction not found' });
    }

    const objective = direction.objective || 'whatsapp';

    // 3. Read default_ad_settings for this direction
    const { rows: settingsRows } = await pool.query(
      `SELECT description, client_question, site_url, utm_tag, lead_form_id, app_store_url, instagram_url
       FROM default_ad_settings WHERE direction_id = $1`,
      [directionId]
    );
    const settings = settingsRows[0] || {};
    const message = settings.description || 'Напишите нам, чтобы узнать подробности';

    // 4. Create creative record (status=processing)
    const { rows: creativeRows } = await pool.query(
      `INSERT INTO creatives (title, media_type, status, direction_id)
       VALUES ($1, $2, 'processing', $3) RETURNING id`,
      [title, mediaType, directionId]
    );
    const creativeId = creativeRows[0].id;

    console.log(`[upload] Creative record created: ${creativeId}`);

    // 5. Upload media to Facebook
    let fbVideoId = null;
    let fbImageHash = null;

    if (mediaType === 'video') {
      const result = await uploadVideoToFB(adAccountId, config.fb_access_token, filePath);
      fbVideoId = result.id;
      // Wait for Facebook to process
      await new Promise(r => setTimeout(r, 3000));
    } else {
      const result = await uploadImageToFB(adAccountId, config.fb_access_token, filePath);
      fbImageHash = result.hash;
    }

    // 6. Create FB creative (1:1 with main project)
    const creative = await createFBCreative(adAccountId, config.fb_access_token, {
      objective,
      videoId: fbVideoId,
      imageHash: fbImageHash,
      pageId: config.fb_page_id,
      instagramId: config.fb_instagram_id || null,
      message,
      clientQuestion: settings.client_question || 'Здравствуйте! Хочу узнать об этом подробнее.',
      title,
      siteUrl: settings.site_url,
      utm: settings.utm_tag,
      instagramUrl: settings.instagram_url,
      leadFormId: settings.lead_form_id,
      appStoreUrl: settings.app_store_url,
      ctaType: settings.cta_type,
    });

    // 7. Update creative record in DB
    const objectiveFieldMap = {
      whatsapp: 'fb_creative_id_whatsapp',
      instagram_traffic: 'fb_creative_id_instagram',
      site_leads: 'fb_creative_id_site_leads',
      lead_forms: 'fb_creative_id_lead_forms',
    };
    const legacyField = objectiveFieldMap[objective];

    let updateQuery = `UPDATE creatives SET
      fb_video_id = $1, fb_image_hash = $2, fb_creative_id = $3,
      status = 'ready', updated_at = NOW()`;
    const updateParams = [fbVideoId, fbImageHash, creative.id];

    if (legacyField) {
      updateQuery += `, ${legacyField} = $4 WHERE id = $5`;
      updateParams.push(creative.id, creativeId);
    } else {
      updateQuery += ` WHERE id = $4`;
      updateParams.push(creativeId);
    }

    await pool.query(updateQuery, updateParams);

    console.log(`[upload] Creative ${creativeId} ready: fb_video=${fbVideoId}, fb_creative=${creative.id}`);

    res.json({
      success: true,
      data: {
        creative_id: creativeId,
        fb_video_id: fbVideoId,
        fb_image_hash: fbImageHash,
        fb_creative_id: creative.id,
        objective,
        direction: direction.name,
      }
    });

  } catch (err) {
    console.error(`[upload] Error for slug=${slug}:`, err.message);

    // Try to mark creative as failed if it was created
    try {
      const pool = getPool(slug);
      if (req.body?.direction_id) {
        // We don't have creativeId here if it failed before creation, so just log
      }
    } catch (_) {}

    res.status(500).json({
      success: false,
      error: err.message,
    });

  } finally {
    // Always cleanup temp file
    if (filePath) {
      try {
        await fs.unlink(filePath);
        console.log('[upload] Temp file deleted');
      } catch (_) {}
    }
  }
});

// ============================================
// HTML: Upload page with direction selector
// ============================================
function renderUploadPage(slug) {
  return `<!DOCTYPE html>
<html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Upload - ${slug}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,sans-serif;background:#0f1117;color:#e4e4e7;min-height:100vh;display:flex;align-items:center;justify-content:center}
  .container{max-width:520px;width:100%;padding:24px}
  h2{font-size:20px;font-weight:600;margin-bottom:20px;color:#fff}
  .badge{display:inline-block;background:#1e293b;color:#94a3b8;font-size:12px;padding:2px 8px;border-radius:4px;margin-left:8px;font-weight:400}
  label{display:block;font-size:13px;color:#94a3b8;margin-bottom:6px;font-weight:500}
  select,input[type=text]{width:100%;padding:10px 12px;background:#1e1e2e;border:1px solid #2e2e3e;border-radius:8px;color:#e4e4e7;font-size:14px;outline:none;transition:border-color .2s}
  select:focus,input:focus{border-color:#6366f1}
  .field{margin-bottom:16px}
  .drop{border:2px dashed #2e2e3e;border-radius:12px;padding:48px 20px;text-align:center;cursor:pointer;transition:.2s;margin-bottom:16px}
  .drop.over{border-color:#6366f1;background:rgba(99,102,241,.05)}
  .drop.has-file{border-color:#22c55e;background:rgba(34,197,94,.05)}
  .drop .icon{font-size:32px;margin-bottom:8px;opacity:.5}
  .drop .label{font-size:14px;color:#94a3b8}
  .drop .filename{font-size:13px;color:#22c55e;margin-top:4px;word-break:break-all}
  .btn{width:100%;padding:12px;background:#6366f1;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;transition:.2s}
  .btn:hover{background:#4f46e5}
  .btn:disabled{opacity:.4;cursor:not-allowed}
  .progress{margin-top:16px;display:none}
  .progress-bar{height:6px;background:#1e1e2e;border-radius:3px;overflow:hidden}
  .progress-fill{height:100%;background:#6366f1;border-radius:3px;width:0;transition:width .3s}
  .progress-text{font-size:12px;color:#94a3b8;margin-top:6px;text-align:center}
  .result{margin-top:20px;padding:16px;border-radius:8px;display:none;font-size:13px;line-height:1.6}
  .result.ok{background:rgba(34,197,94,.1);border:1px solid #22c55e;color:#86efac}
  .result.err{background:rgba(239,68,68,.1);border:1px solid #ef4444;color:#fca5a5}
  .result code{background:#1e1e2e;padding:2px 6px;border-radius:4px;font-size:12px}
  .obj-badge{display:inline-block;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600;margin-left:6px}
  .obj-whatsapp{background:#25d366;color:#000}
  .obj-instagram_traffic{background:#e1306c;color:#fff}
  .obj-site_leads{background:#3b82f6;color:#fff}
  .obj-lead_forms{background:#f59e0b;color:#000}
  .obj-app_installs{background:#8b5cf6;color:#fff}
</style>
</head><body>
<div class="container">
  <h2>Upload<span class="badge">${slug}</span></h2>

  <div class="field">
    <label>Направление</label>
    <select id="direction" required>
      <option value="" disabled selected>Загрузка...</option>
    </select>
  </div>

  <div class="field">
    <label>Название (необязательно)</label>
    <input type="text" id="title" placeholder="Будет использовано имя файла">
  </div>

  <div class="drop" id="drop" onclick="document.getElementById('file').click()">
    <div class="icon">&#128206;</div>
    <div class="label">Перетащи видео или изображение сюда</div>
    <div class="filename" id="fname"></div>
  </div>
  <input type="file" id="file" hidden accept="video/*,image/*">

  <button class="btn" id="btn" disabled onclick="doUpload()">Загрузить</button>

  <div class="progress" id="progress">
    <div class="progress-bar"><div class="progress-fill" id="pfill"></div></div>
    <div class="progress-text" id="ptext">Загрузка...</div>
  </div>

  <div class="result" id="result"></div>
</div>

<script>
const slug = '${slug}';
let selectedFile = null;

// Load directions
fetch('directions')
  .then(r => r.json())
  .then(dirs => {
    const sel = document.getElementById('direction');
    if (!dirs.length) {
      sel.innerHTML = '<option value="" disabled selected>Нет направлений. Создайте через агента.</option>';
      return;
    }
    sel.innerHTML = '<option value="" disabled selected>Выбери направление</option>';
    dirs.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.name + ' (' + d.objective + ')';
      sel.appendChild(opt);
    });
    checkReady();
  })
  .catch(e => {
    document.getElementById('direction').innerHTML = '<option value="" disabled>Ошибка: ' + e.message + '</option>';
  });

// Drag & Drop
const drop = document.getElementById('drop');
drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); setFile(e.dataTransfer.files[0]); };
document.getElementById('file').onchange = e => setFile(e.target.files[0]);

function setFile(f) {
  if (!f) return;
  selectedFile = f;
  const sizeMB = (f.size / 1024 / 1024).toFixed(1);
  document.getElementById('fname').textContent = f.name + ' (' + sizeMB + ' MB)';
  drop.classList.add('has-file');
  checkReady();
}

function checkReady() {
  document.getElementById('btn').disabled = !selectedFile || !document.getElementById('direction').value;
}
document.getElementById('direction').onchange = checkReady;

function doUpload() {
  const dirId = document.getElementById('direction').value;
  const title = document.getElementById('title').value || selectedFile.name.replace(/\\.[^.]+$/, '');

  const fd = new FormData();
  fd.append('file', selectedFile);
  fd.append('direction_id', dirId);
  fd.append('title', title);

  const btn = document.getElementById('btn');
  const prog = document.getElementById('progress');
  const pfill = document.getElementById('pfill');
  const ptext = document.getElementById('ptext');
  const result = document.getElementById('result');

  btn.disabled = true;
  btn.textContent = 'Загружаем...';
  prog.style.display = 'block';
  result.style.display = 'none';

  const xhr = new XMLHttpRequest();
  xhr.open('POST', 'upload');

  xhr.upload.onprogress = e => {
    if (e.lengthComputable) {
      const pct = Math.round(e.loaded / e.total * 100);
      pfill.style.width = pct + '%';
      ptext.textContent = pct < 100
        ? 'Загрузка файла: ' + pct + '%'
        : 'Файл загружен. Обработка в Facebook...';
    }
  };

  xhr.onload = () => {
    prog.style.display = 'none';
    btn.disabled = false;
    btn.textContent = 'Загрузить';

    try {
      const data = JSON.parse(xhr.responseText);
      if (data.success) {
        result.className = 'result ok';
        result.innerHTML = '<b>Готово!</b><br>'
          + 'Направление: <b>' + data.data.direction + '</b> (' + data.data.objective + ')<br>'
          + 'Creative ID: <code>' + data.data.creative_id + '</code><br>'
          + (data.data.fb_video_id ? 'FB Video: <code>' + data.data.fb_video_id + '</code><br>' : '')
          + (data.data.fb_image_hash ? 'FB Image: <code>' + data.data.fb_image_hash + '</code><br>' : '')
          + 'FB Creative: <code>' + data.data.fb_creative_id + '</code>';
      } else {
        result.className = 'result err';
        result.innerHTML = '<b>Ошибка:</b> ' + (data.error || 'Unknown error');
      }
    } catch (e) {
      result.className = 'result err';
      result.innerHTML = '<b>Ошибка:</b> ' + xhr.responseText;
    }
    result.style.display = 'block';
  };

  xhr.onerror = () => {
    prog.style.display = 'none';
    btn.disabled = false;
    btn.textContent = 'Загрузить';
    result.className = 'result err';
    result.innerHTML = '<b>Ошибка сети</b>';
    result.style.display = 'block';
  };

  xhr.send(fd);
}
</script>
</body></html>`;
}

// ============================================
// Ensure temp directory exists
// ============================================
await fs.mkdir('/tmp/openclaw-uploads', { recursive: true });

app.listen(PORT, () => console.log(`Upload service v2 listening on :${PORT}`));
