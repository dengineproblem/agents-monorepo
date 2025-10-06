/**
 * Creative Test Analyzer - LLM Субагент
 * 
 * Анализирует результаты быстрого теста креатива:
 * - Метрики (CPL, CTR, CPM, видео)
 * - Транскрибацию
 * - Дает оценку и рекомендации
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

/**
 * Промпт для анализа креатива
 */
function buildAnalysisPrompt(testData, transcript) {
  return `Ты — эксперт по Facebook рекламе и видеокреативам. Проанализируй результаты быстрого теста креатива.

# ДАННЫЕ ТЕСТА

**Креатив:** ${testData.creative_title || 'Untitled'}

**Метрики:**
- Показы (Impressions): ${testData.impressions}
- Охват (Reach): ${testData.reach}
- Частота (Frequency): ${testData.frequency || 'N/A'}
- Клики: ${testData.clicks}
- Клики по ссылкам: ${testData.link_clicks}
- CTR (общий): ${testData.ctr}%
- CTR по ссылкам: ${testData.link_ctr}%
- Лиды: ${testData.leads}
- Затраты: $${(testData.spend_cents / 100).toFixed(2)}
- CPM: $${(testData.cpm_cents / 100).toFixed(2)}
- CPC: $${(testData.cpc_cents / 100).toFixed(2)}
- CPL: ${testData.cpl_cents ? '$' + (testData.cpl_cents / 100).toFixed(2) : 'N/A'}

**Видео метрики:**
${testData.video_views > 0 ? `
- Просмотры видео: ${testData.video_views}
- Просмотров 25%: ${testData.video_views_25_percent} (${((testData.video_views_25_percent / testData.video_views) * 100).toFixed(1)}%)
- Просмотров 50%: ${testData.video_views_50_percent} (${((testData.video_views_50_percent / testData.video_views) * 100).toFixed(1)}%)
- Просмотров 75%: ${testData.video_views_75_percent} (${((testData.video_views_75_percent / testData.video_views) * 100).toFixed(1)}%)
- Просмотров 95%: ${testData.video_views_95_percent} (${((testData.video_views_95_percent / testData.video_views) * 100).toFixed(1)}%)
- Среднее время просмотра: ${testData.video_avg_watch_time_sec}s
` : 'Нет данных по видео'}

**Транскрибация видео:**
${transcript || 'Транскрибация недоступна'}

---

# ТВОЯ ЗАДАЧА

1. **Оцени креатив** от 0 до 100 на основе всех метрик
2. **Определи вердикт**: 'excellent' (80-100), 'good' (60-79), 'average' (40-59), 'poor' (0-39)
3. **Проанализируй видео**: Какая часть видео удерживает внимание? Где люди уходят?
4. **Сопоставь с транскрибацией**: Что в тексте работает? Что не работает?
5. **Дай рекомендации**: Какие конкретные фразы нужно изменить в видео для улучшения результатов?

# ФОРМАТ ОТВЕТА

Верни ТОЛЬКО JSON в следующем формате (без markdown, без комментариев):

{
  "score": 85,
  "verdict": "excellent",
  "reasoning": "Подробный анализ метрик в 2-3 предложениях",
  "video_analysis": "Анализ просмотров видео: где теряем внимание, что работает",
  "text_recommendations": "Общие рекомендации по тексту видео",
  "transcript_match_quality": "high",
  "transcript_suggestions": [
    {
      "from": "старая фраза из транскрибации",
      "to": "новая улучшенная фраза",
      "reason": "почему нужно изменить",
      "position": "начало|середина|конец"
    }
  ]
}

ВАЖНО:
- Оценка (score) должна учитывать ВСЕ метрики: CTR, CPL, видео просмотры
- Если CPL низкий И видео смотрят до конца → высокая оценка
- Если много кликов но мало лидов → средняя оценка
- Если люди уходят на 25% видео → найди проблемную фразу в транскрибации
- В transcript_suggestions давай КОНКРЕТНЫЕ фразы, не общие советы`;
}

/**
 * Анализирует результаты теста через LLM
 */
async function analyzeCreativeTest(testData, transcript) {
  const prompt = buildAnalysisPrompt(testData, transcript);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content: 'Ты — эксперт по анализу Facebook рекламы и видеокреативов. Всегда отвечаешь только валидным JSON без комментариев.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 2000
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content.trim();

  // Парсим JSON (удаляем markdown если есть)
  let jsonStr = content;
  if (content.startsWith('```json')) {
    jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '');
  } else if (content.startsWith('```')) {
    jsonStr = content.replace(/```\n?/g, '');
  }

  try {
    const analysis = JSON.parse(jsonStr);
    
    // Валидация
    if (typeof analysis.score !== 'number' || analysis.score < 0 || analysis.score > 100) {
      throw new Error('Invalid score');
    }
    
    if (!['excellent', 'good', 'average', 'poor'].includes(analysis.verdict)) {
      // Автоматический вердикт на основе score
      if (analysis.score >= 80) analysis.verdict = 'excellent';
      else if (analysis.score >= 60) analysis.verdict = 'good';
      else if (analysis.score >= 40) analysis.verdict = 'average';
      else analysis.verdict = 'poor';
    }

    return analysis;
    
  } catch (parseError) {
    console.error('Failed to parse LLM response:', jsonStr);
    throw new Error(`Failed to parse LLM response: ${parseError.message}`);
  }
}

export { analyzeCreativeTest };
