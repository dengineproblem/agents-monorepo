# Интеграция фронтенда с API обработки видео

## React / Next.js примеры

### Компонент загрузки видео

```tsx
import { useState } from 'react';

interface VideoUploadProps {
  userId: string;
  adAccountId: string;
  pageId: string;
  instagramId: string;
  instagramUsername: string;
  pageAccessToken: string;
}

interface UploadResult {
  creative_id: string;
  fb_video_id: string;
  fb_creative_id_whatsapp: string;
  fb_creative_id_instagram_traffic: string;
  fb_creative_id_site_leads: string | null;
  transcription: {
    text: string;
    language: string;
    source: string;
    duration_sec: number | null;
  };
}

export default function VideoUploadForm({
  userId,
  adAccountId,
  pageId,
  instagramId,
  instagramUsername,
  pageAccessToken,
}: VideoUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [clientQuestion, setClientQuestion] = useState('Здравствуйте! Интересует ваше предложение.');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      
      // Проверка размера (макс 500 MB)
      if (selectedFile.size > 500 * 1024 * 1024) {
        setError('Файл слишком большой. Максимум 500 MB');
        return;
      }
      
      // Проверка формата
      const validTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'];
      if (!validTypes.includes(selectedFile.type)) {
        setError('Неподдерживаемый формат. Используйте MP4, MOV, AVI или MKV');
        return;
      }
      
      setFile(selectedFile);
      setError(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!file) {
      setError('Выберите видео файл');
      return;
    }

    setUploading(true);
    setProgress(0);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('video', file);
      formData.append('user_id', userId);
      formData.append('ad_account_id', adAccountId);
      formData.append('page_id', pageId);
      formData.append('instagram_id', instagramId);
      formData.append('instagram_username', instagramUsername);
      formData.append('page_access_token', pageAccessToken);
      formData.append('title', title || 'Untitled Creative');
      formData.append('description', description);
      formData.append('language', 'ru');
      formData.append('client_question', clientQuestion);
      
      if (siteUrl) {
        formData.append('site_url', siteUrl);
        formData.append('utm', `utm_source=facebook&utm_medium=video&utm_campaign=${encodeURIComponent(title)}`);
      }

      // Симуляция прогресса (в реальности можно использовать XMLHttpRequest для отслеживания прогресса)
      const progressInterval = setInterval(() => {
        setProgress(prev => Math.min(prev + 10, 90));
      }, 1000);

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/process-video`, {
        method: 'POST',
        body: formData,
      });

      clearInterval(progressInterval);
      setProgress(100);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Ошибка при загрузке видео');
      }

      setResult(data.data);
      
    } catch (err: any) {
      setError(err.message || 'Произошла ошибка при обработке видео');
      console.error('Upload error:', err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h2 className="text-2xl font-bold mb-6">Загрузка видео креатива</h2>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Видео файл */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Видео файл *
          </label>
          <input
            type="file"
            accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska"
            onChange={handleFileChange}
            disabled={uploading}
            className="block w-full text-sm text-gray-500
              file:mr-4 file:py-2 file:px-4
              file:rounded-full file:border-0
              file:text-sm file:font-semibold
              file:bg-blue-50 file:text-blue-700
              hover:file:bg-blue-100
              disabled:opacity-50"
          />
          {file && (
            <p className="mt-2 text-sm text-gray-600">
              Выбрано: {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
            </p>
          )}
        </div>

        {/* Название */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Название креатива
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Промо видео Q4 2025"
            disabled={uploading}
            className="w-full px-3 py-2 border border-gray-300 rounded-md
              focus:outline-none focus:ring-2 focus:ring-blue-500
              disabled:opacity-50"
          />
        </div>

        {/* Описание */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Описание/текст для креативов *
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Узнайте больше о нашем новом продукте!"
            required
            disabled={uploading}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-md
              focus:outline-none focus:ring-2 focus:ring-blue-500
              disabled:opacity-50"
          />
        </div>

        {/* URL сайта */}
        <div>
          <label className="block text-sm font-medium mb-2">
            URL сайта (для лид-генерации)
          </label>
          <input
            type="url"
            value={siteUrl}
            onChange={(e) => setSiteUrl(e.target.value)}
            placeholder="https://example.com/landing"
            disabled={uploading}
            className="w-full px-3 py-2 border border-gray-300 rounded-md
              focus:outline-none focus:ring-2 focus:ring-blue-500
              disabled:opacity-50"
          />
        </div>

        {/* Вопрос клиента для WhatsApp */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Вопрос клиента (для WhatsApp)
          </label>
          <input
            type="text"
            value={clientQuestion}
            onChange={(e) => setClientQuestion(e.target.value)}
            disabled={uploading}
            className="w-full px-3 py-2 border border-gray-300 rounded-md
              focus:outline-none focus:ring-2 focus:ring-blue-500
              disabled:opacity-50"
          />
        </div>

        {/* Прогресс бар */}
        {uploading && (
          <div className="space-y-2">
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div
                className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              ></div>
            </div>
            <p className="text-sm text-gray-600 text-center">
              Обработка видео... {progress}%
            </p>
          </div>
        )}

        {/* Ошибка */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {/* Результат */}
        {result && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded space-y-2">
            <p className="font-semibold">✅ Видео успешно обработано!</p>
            <div className="text-sm space-y-1">
              <p>🎬 Video ID: <code>{result.fb_video_id}</code></p>
              <p>💬 WhatsApp Creative: <code>{result.fb_creative_id_whatsapp}</code></p>
              <p>📸 Instagram Creative: <code>{result.fb_creative_id_instagram_traffic}</code></p>
              {result.fb_creative_id_site_leads && (
                <p>🌐 Site Leads Creative: <code>{result.fb_creative_id_site_leads}</code></p>
              )}
              {result.transcription.text && (
                <details className="mt-2">
                  <summary className="cursor-pointer font-medium">Транскрипция</summary>
                  <p className="mt-2 text-gray-600 italic">
                    "{result.transcription.text}"
                  </p>
                </details>
              )}
            </div>
          </div>
        )}

        {/* Кнопка отправки */}
        <button
          type="submit"
          disabled={uploading || !file}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-md
            hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors"
        >
          {uploading ? 'Обработка...' : 'Загрузить и создать креативы'}
        </button>
      </form>
    </div>
  );
}
```

### Использование компонента

```tsx
// pages/upload-video.tsx
import VideoUploadForm from '@/components/VideoUploadForm';
import { useSession } from 'next-auth/react';

export default function UploadVideoPage() {
  const { data: session } = useSession();
  
  // Получите эти данные из вашего контекста/стора
  const userSettings = {
    userId: session?.user?.id || '',
    adAccountId: 'act_123456789',
    pageId: '987654321',
    instagramId: '17841400000000000',
    instagramUsername: 'mycompany',
    pageAccessToken: 'EAAxxxxxxxxxxxxx', // Получайте с бэкенда, не храните в клиенте!
  };

  return (
    <div className="container mx-auto py-8">
      <VideoUploadForm {...userSettings} />
    </div>
  );
}
```

## Vanilla JavaScript пример

```html
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Загрузка видео</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: bold; }
        input, textarea { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
        button { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        .progress { width: 100%; height: 20px; background: #f0f0f0; border-radius: 10px; overflow: hidden; margin: 10px 0; }
        .progress-bar { height: 100%; background: #007bff; transition: width 0.3s; }
        .result { margin-top: 20px; padding: 15px; background: #d4edda; border: 1px solid #c3e6cb; border-radius: 4px; }
        .error { margin-top: 20px; padding: 15px; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; }
    </style>
</head>
<body>
    <h1>Загрузка видео креатива</h1>
    
    <form id="uploadForm">
        <div class="form-group">
            <label for="video">Видео файл:</label>
            <input type="file" id="video" accept="video/*" required>
            <small id="fileInfo"></small>
        </div>
        
        <div class="form-group">
            <label for="title">Название:</label>
            <input type="text" id="title" placeholder="Промо видео">
        </div>
        
        <div class="form-group">
            <label for="description">Описание:</label>
            <textarea id="description" rows="3" required></textarea>
        </div>
        
        <div class="form-group">
            <label for="siteUrl">URL сайта:</label>
            <input type="url" id="siteUrl" placeholder="https://example.com">
        </div>
        
        <div id="progressContainer" style="display: none;">
            <div class="progress">
                <div class="progress-bar" id="progressBar" style="width: 0%"></div>
            </div>
            <p id="progressText">Загрузка...</p>
        </div>
        
        <button type="submit" id="submitBtn">Загрузить</button>
    </form>
    
    <div id="result"></div>

    <script>
        const form = document.getElementById('uploadForm');
        const videoInput = document.getElementById('video');
        const fileInfo = document.getElementById('fileInfo');
        const progressContainer = document.getElementById('progressContainer');
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const submitBtn = document.getElementById('submitBtn');
        const resultDiv = document.getElementById('result');

        // Конфигурация
        const API_URL = 'http://localhost:8080';
        const USER_ID = '123e4567-e89b-12d3-a456-426614174000';
        const AD_ACCOUNT_ID = 'act_123456789';
        const PAGE_ID = '987654321';
        const INSTAGRAM_ID = '17841400000000000';
        const INSTAGRAM_USERNAME = 'mycompany';
        const PAGE_ACCESS_TOKEN = 'EAAxxxxxxxxxxxxx';

        videoInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                const sizeMB = (file.size / 1024 / 1024).toFixed(2);
                fileInfo.textContent = `Выбрано: ${file.name} (${sizeMB} MB)`;
            }
        });

        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const videoFile = videoInput.files[0];
            if (!videoFile) {
                alert('Выберите видео файл');
                return;
            }

            const formData = new FormData();
            formData.append('video', videoFile);
            formData.append('user_id', USER_ID);
            formData.append('ad_account_id', AD_ACCOUNT_ID);
            formData.append('page_id', PAGE_ID);
            formData.append('instagram_id', INSTAGRAM_ID);
            formData.append('instagram_username', INSTAGRAM_USERNAME);
            formData.append('page_access_token', PAGE_ACCESS_TOKEN);
            formData.append('title', document.getElementById('title').value || 'Untitled');
            formData.append('description', document.getElementById('description').value);
            formData.append('language', 'ru');
            
            const siteUrl = document.getElementById('siteUrl').value;
            if (siteUrl) {
                formData.append('site_url', siteUrl);
            }

            try {
                submitBtn.disabled = true;
                progressContainer.style.display = 'block';
                resultDiv.innerHTML = '';

                // Симуляция прогресса
                let progress = 0;
                const progressInterval = setInterval(() => {
                    progress = Math.min(progress + 10, 90);
                    progressBar.style.width = progress + '%';
                    progressText.textContent = `Обработка... ${progress}%`;
                }, 1000);

                const response = await fetch(`${API_URL}/process-video`, {
                    method: 'POST',
                    body: formData
                });

                clearInterval(progressInterval);
                progressBar.style.width = '100%';
                progressText.textContent = 'Завершено!';

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Ошибка загрузки');
                }

                resultDiv.className = 'result';
                resultDiv.innerHTML = `
                    <h3>✅ Видео успешно обработано!</h3>
                    <p><strong>Video ID:</strong> ${data.data.fb_video_id}</p>
                    <p><strong>WhatsApp Creative:</strong> ${data.data.fb_creative_id_whatsapp}</p>
                    <p><strong>Instagram Creative:</strong> ${data.data.fb_creative_id_instagram_traffic}</p>
                    ${data.data.fb_creative_id_site_leads ? `<p><strong>Site Leads Creative:</strong> ${data.data.fb_creative_id_site_leads}</p>` : ''}
                    <p><strong>Транскрипция:</strong> ${data.data.transcription.text}</p>
                `;

                form.reset();
                fileInfo.textContent = '';

            } catch (error) {
                resultDiv.className = 'error';
                resultDiv.innerHTML = `<strong>Ошибка:</strong> ${error.message}`;
            } finally {
                submitBtn.disabled = false;
                setTimeout(() => {
                    progressContainer.style.display = 'none';
                    progressBar.style.width = '0%';
                }, 2000);
            }
        });
    </script>
</body>
</html>
```

## Best Practices

1. **Безопасность токенов**: Никогда не храните `page_access_token` в клиенте. Получайте его с бэкенда.

2. **Обработка больших файлов**: Для файлов > 100 MB используйте chunk upload или сжатие на клиенте.

3. **Прогресс загрузки**: Используйте XMLHttpRequest для реального отслеживания прогресса:

```typescript
function uploadWithProgress(formData: FormData, onProgress: (percent: number) => void) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percent = (e.loaded / e.total) * 100;
        onProgress(percent);
      }
    });
    
    xhr.addEventListener('load', () => {
      if (xhr.status === 200) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error(xhr.statusText));
      }
    });
    
    xhr.addEventListener('error', () => reject(new Error('Upload failed')));
    
    xhr.open('POST', `${API_URL}/process-video`);
    xhr.send(formData);
  });
}
```

4. **Retry механизм**: Добавьте повторные попытки для нестабильных соединений.

5. **Валидация на клиенте**: Проверяйте размер и формат файла перед отправкой.
