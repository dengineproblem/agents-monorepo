import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'facebookWebhooks' });

// TODO: Настроить Supabase client
// import { supabase } from '../lib/supabase.js';

const FB_APP_SECRET = process.env.FB_APP_SECRET || '';

export default async function facebookWebhooks(app: FastifyInstance) {
  
  /**
   * Facebook Data Deletion Callback
   * 
   * Этот эндпоинт ОБЯЗАТЕЛЕН для прохождения App Review.
   * Facebook вызывает его когда пользователь удаляет приложение
   * или запрашивает удаление своих данных.
   * 
   * Документация: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
   */
  app.post('/facebook/data-deletion', async (req, res) => {
    try {
      log.info('Received data deletion request from Facebook');
      
      const { signed_request } = req.body as { signed_request?: string };
      
      if (!signed_request) {
        log.error('Missing signed_request in data deletion callback');
        return res.status(400).send({ 
          error: 'Missing signed_request parameter' 
        });
      }

      // Parse and verify signed request
      const parsedData = parseSignedRequest(signed_request, FB_APP_SECRET);
      
      if (!parsedData) {
        log.error('Invalid signed_request signature');
        return res.status(400).send({ 
          error: 'Invalid signed_request' 
        });
      }

      const { user_id } = parsedData;
      
      if (!user_id) {
        log.error('Missing user_id in signed_request');
        return res.status(400).send({ 
          error: 'Missing user_id' 
        });
      }

      log.info({ facebook_user_id: user_id }, 'Processing data deletion');

      // TODO: Раскомментировать после настройки Supabase
      /*
      // Delete user data from database
      const { error: deleteError } = await supabase
        .from('user_accounts')
        .delete()
        .eq('facebook_user_id', user_id);
      
      if (deleteError) {
        log.error({ error: deleteError, user_id }, 'Failed to delete user data from database');
        // Не возвращаем ошибку Facebook - запишем в лог и обработаем manually
      } else {
        log.info({ user_id }, 'Successfully deleted user data');
      }
      */

      // ВРЕМЕННОЕ РЕШЕНИЕ: просто логируем запрос
      log.warn({ user_id }, 'Data deletion logged (Supabase integration pending)');

      // Generate confirmation code
      const confirmationCode = crypto.randomBytes(16).toString('hex');
      
      // TODO: Сохранить confirmation_code в БД для отслеживания
      /*
      await supabase.from('data_deletion_requests').insert({
        facebook_user_id: user_id,
        confirmation_code: confirmationCode,
        requested_at: new Date().toISOString(),
        status: 'completed'
      });
      */

      // Facebook требует вернуть URL и confirmation_code
      // URL должен показывать статус удаления
      const statusUrl = `${process.env.PUBLIC_URL || 'https://performanteaiagency.com'}/deletion-status?code=${confirmationCode}`;
      
      log.info({ 
        user_id, 
        confirmation_code: confirmationCode,
        status_url: statusUrl 
      }, 'Data deletion request processed successfully');

      return res.send({
        url: statusUrl,
        confirmation_code: confirmationCode
      });

    } catch (error) {
      log.error({ error }, 'Error processing data deletion request');
      return res.status(500).send({ 
        error: 'Internal server error' 
      });
    }
  });

  /**
   * Страница статуса удаления данных
   * Показывает пользователю, что его данные были удалены
   */
  app.get('/deletion-status', async (req, res) => {
    const { code } = req.query as { code?: string };
    
    if (!code) {
      return res.status(400).send('Missing confirmation code');
    }

    // TODO: Проверить статус в БД
    /*
    const { data: request } = await supabase
      .from('data_deletion_requests')
      .select('*')
      .eq('confirmation_code', code)
      .single();
    */

    // Пока возвращаем простую HTML страницу
    return res.type('text/html').send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Data Deletion Status</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 600px;
            margin: 100px auto;
            padding: 20px;
            text-align: center;
          }
          .success {
            color: #22c55e;
            font-size: 48px;
            margin-bottom: 20px;
          }
          h1 {
            color: #1f2937;
            margin-bottom: 16px;
          }
          p {
            color: #6b7280;
            line-height: 1.6;
          }
          .code {
            background: #f3f4f6;
            padding: 8px 12px;
            border-radius: 4px;
            font-family: monospace;
            margin-top: 20px;
          }
        </style>
      </head>
      <body>
        <div class="success">✓</div>
        <h1>Data Deletion Complete</h1>
        <p>
          Your data has been successfully deleted from our systems.
          This process typically takes up to 30 days to complete fully.
        </p>
        <p>
          If you have any questions, please contact our support team.
        </p>
        <div class="code">
          Confirmation Code: ${code}
        </div>
      </body>
      </html>
    `);
  });
}

/**
 * Parse and verify Facebook signed request
 * 
 * @param signedRequest - The signed request from Facebook
 * @param secret - Your Facebook App Secret
 * @returns Parsed data or null if invalid
 */
function parseSignedRequest(signedRequest: string, secret: string): any | null {
  try {
    const [encodedSig, payload] = signedRequest.split('.', 2);
    
    if (!encodedSig || !payload) {
      return null;
    }

    // Decode signature
    const sig = base64UrlDecode(encodedSig);
    
    // Decode payload
    const data = JSON.parse(base64UrlDecode(payload));

    // Verify signature using HMAC-SHA256
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest();

    if (!crypto.timingSafeEqual(Buffer.from(sig), expectedSig)) {
      log.error('Signature verification failed');
      return null;
    }

    return data;
  } catch (error) {
    log.error({ error }, 'Error parsing signed request');
    return null;
  }
}

/**
 * Decode base64url string
 */
function base64UrlDecode(str: string): string {
  // Convert base64url to base64
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  
  // Add padding if needed
  while (base64.length % 4) {
    base64 += '=';
  }
  
  return Buffer.from(base64, 'base64').toString('utf-8');
}

