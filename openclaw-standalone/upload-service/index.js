import express from 'express';
import multer from 'multer';
import { join, extname } from 'node:path';

const app = express();
const PORT = process.env.PORT || 3001;
const MAX_SIZE = (process.env.MAX_FILE_SIZE_MB || 500) * 1024 * 1024;

const storage = multer.diskStorage({
  destination: './uploads',
  filename: (_, file, cb) => cb(null, `${Date.now()}_${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: MAX_SIZE } });

app.get('/', (_, res) => res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Upload</title>
<style>
  body{font-family:system-ui;max-width:600px;margin:40px auto;padding:0 20px}
  .drop{border:2px dashed #999;border-radius:12px;padding:60px 20px;text-align:center;cursor:pointer;transition:.2s}
  .drop.over{border-color:#4CAF50;background:#f0fff0}
  #result{margin-top:20px;padding:16px;background:#f5f5f5;border-radius:8px;display:none;word-break:break-all}
  .ok{color:#4CAF50;font-weight:bold}
</style></head><body>
<h2>OpenClaw Upload</h2>
<div class="drop" id="drop" onclick="document.getElementById('file').click()">
  Перетащи файл сюда или нажми для выбора<br><small>Видео, изображения — до ${MAX_SIZE/1024/1024} МБ</small>
</div>
<input type="file" id="file" hidden accept="video/*,image/*">
<div id="result"></div>
<script>
const drop=document.getElementById('drop'),file=document.getElementById('file'),result=document.getElementById('result');
drop.ondragover=e=>{e.preventDefault();drop.classList.add('over')};
drop.ondragleave=()=>drop.classList.remove('over');
drop.ondrop=e=>{e.preventDefault();drop.classList.remove('over');upload(e.dataTransfer.files[0])};
file.onchange=()=>upload(file.files[0]);
function upload(f){if(!f)return;drop.textContent='Загрузка... '+f.name;
const fd=new FormData();fd.append('file',f);
fetch('/upload',{method:'POST',body:fd}).then(r=>r.json()).then(d=>{
  result.style.display='block';
  result.innerHTML=d.success?'<span class="ok">Готово!</span><br>Путь: <code>'+d.path+'</code><br>Размер: '+d.size
    :'<span style="color:red">Ошибка: '+d.error+'</span>';
  drop.textContent='Перетащи ещё файл или нажми';
}).catch(e=>{result.style.display='block';result.innerHTML='Ошибка: '+e.message})}
</script></body></html>`));

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No file' });
  const sizeMB = (req.file.size / 1024 / 1024).toFixed(1);
  res.json({ success: true, path: `/app/uploads/${req.file.filename}`, size: `${sizeMB} MB` });
});

app.get('/health', (_, res) => res.send('ok'));

app.listen(PORT, () => console.log(`Upload service listening on :${PORT}`));
