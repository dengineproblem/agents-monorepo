/**
 * Altegio Authentication Routes
 *
 * Handles Altegio connection flow:
 * - Connect page (HTML form for entering company_id and user_token)
 * - Connect endpoint (saves credentials)
 * - Status endpoint (checks connection status)
 * - Disconnect endpoint
 *
 * Unlike AmoCRM/Bitrix24, Altegio uses manual token entry:
 * 1. User gets Partner Token from Altegio Marketplace
 * 2. User gets User Token from their Altegio account
 * 3. User enters company_id and user_token in our form
 *
 * @module routes/altegioAuth
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  saveAltegioCredentials,
  removeAltegioCredentials,
  getAltegioCredentials,
  validateAltegioConnection,
  isPartnerTokenConfigured,
  getPartnerToken,
} from '../lib/altegioTokens.js';
import { createAltegioClient } from '../adapters/altegio.js';
import { supabase } from '../lib/supabase.js';

// ============================================================================
// Route Registration
// ============================================================================

export async function altegioAuthRoutes(app: FastifyInstance) {
  /**
   * GET /altegio/connect
   * Returns HTML page for connecting Altegio
   */
  app.get('/altegio/connect', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userAccountId } = request.query as { userAccountId?: string };

    if (!userAccountId) {
      return reply.status(400).send({ error: 'userAccountId is required' });
    }

    // Check if partner token is configured
    if (!isPartnerTokenConfigured()) {
      return reply.status(500).send({
        error: 'Altegio integration not configured. Please set ALTEGIO_PARTNER_TOKEN environment variable.',
      });
    }

    // Check if already connected
    const credentials = await getAltegioCredentials(userAccountId);
    const isConnected = credentials !== null;

    // Return HTML form
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Подключение Altegio</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 16px;
      padding: 40px;
      max-width: 480px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .logo {
      text-align: center;
      margin-bottom: 30px;
    }
    .logo img {
      width: 120px;
      height: auto;
    }
    .logo h1 {
      color: #333;
      font-size: 24px;
      margin-top: 15px;
    }
    .status {
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 20px;
      text-align: center;
    }
    .status.connected {
      background: #d4edda;
      color: #155724;
    }
    .status.disconnected {
      background: #fff3cd;
      color: #856404;
    }
    .form-group {
      margin-bottom: 20px;
    }
    label {
      display: block;
      margin-bottom: 8px;
      color: #555;
      font-weight: 500;
    }
    input {
      width: 100%;
      padding: 12px 16px;
      border: 2px solid #e1e5eb;
      border-radius: 8px;
      font-size: 16px;
      transition: border-color 0.2s;
    }
    input:focus {
      outline: none;
      border-color: #667eea;
    }
    .help-text {
      font-size: 13px;
      color: #888;
      margin-top: 6px;
    }
    button {
      width: 100%;
      padding: 14px;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    button.primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    button.danger {
      background: #dc3545;
      color: white;
      margin-top: 10px;
    }
    .message {
      padding: 15px;
      border-radius: 8px;
      margin-top: 20px;
      display: none;
    }
    .message.success {
      background: #d4edda;
      color: #155724;
    }
    .message.error {
      background: #f8d7da;
      color: #721c24;
    }
    .instructions {
      background: #f8f9fa;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 25px;
    }
    .instructions h3 {
      color: #333;
      margin-bottom: 12px;
      font-size: 16px;
    }
    .instructions ol {
      padding-left: 20px;
      color: #555;
      font-size: 14px;
      line-height: 1.8;
    }
    .instructions a {
      color: #667eea;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <h1>Подключение Altegio</h1>
    </div>

    <div class="status ${isConnected ? 'connected' : 'disconnected'}">
      ${isConnected
        ? `✅ Подключено: ${credentials?.companyName || `Компания #${credentials?.companyId}`}`
        : '⚠️ Не подключено'}
    </div>

    ${!isConnected ? `
    <div class="instructions">
      <h3>Как получить токены:</h3>
      <ol>
        <li>Войдите в <a href="https://alteg.io" target="_blank">Altegio</a></li>
        <li>Перейдите в Настройки → Системные настройки → API</li>
        <li>Скопируйте User Token</li>
        <li>ID компании можно найти в URL адресной строки</li>
      </ol>
    </div>
    ` : ''}

    <form id="connectForm">
      <input type="hidden" name="userAccountId" value="${userAccountId}">

      <div class="form-group">
        <label for="companyId">ID компании</label>
        <input
          type="number"
          id="companyId"
          name="companyId"
          placeholder="123456"
          value="${credentials?.companyId || ''}"
          required
        >
        <div class="help-text">Числовой ID вашей компании в Altegio</div>
      </div>

      <div class="form-group">
        <label for="userToken">User Token</label>
        <input
          type="text"
          id="userToken"
          name="userToken"
          placeholder="ваш_user_token"
          value="${credentials ? '••••••••' : ''}"
          ${credentials ? 'placeholder="Введите новый токен или оставьте как есть"' : ''}
          required
        >
        <div class="help-text">Токен из настроек API вашего аккаунта Altegio</div>
      </div>

      <button type="submit" class="primary">
        ${isConnected ? 'Обновить подключение' : 'Подключить Altegio'}
      </button>

      ${isConnected ? `
      <button type="button" class="danger" onclick="disconnect()">
        Отключить Altegio
      </button>
      ` : ''}
    </form>

    <div id="message" class="message"></div>
  </div>

  <script>
    const form = document.getElementById('connectForm');
    const messageDiv = document.getElementById('message');

    function showMessage(text, isError = false) {
      messageDiv.textContent = text;
      messageDiv.className = 'message ' + (isError ? 'error' : 'success');
      messageDiv.style.display = 'block';
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const formData = new FormData(form);
      const data = {
        userAccountId: formData.get('userAccountId'),
        companyId: parseInt(formData.get('companyId')),
        userToken: formData.get('userToken'),
      };

      // Skip if token is placeholder
      if (data.userToken === '••••••••') {
        showMessage('Введите новый токен для обновления', true);
        return;
      }

      try {
        const response = await fetch('/api/altegio/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });

        const result = await response.json();

        if (response.ok) {
          showMessage('Altegio успешно подключен!');
          setTimeout(() => window.close(), 2000);
        } else {
          showMessage(result.error || 'Ошибка подключения', true);
        }
      } catch (error) {
        showMessage('Ошибка сети: ' + error.message, true);
      }
    });

    async function disconnect() {
      if (!confirm('Вы уверены, что хотите отключить Altegio?')) return;

      const userAccountId = document.querySelector('input[name="userAccountId"]').value;

      try {
        const response = await fetch('/api/altegio/disconnect?userAccountId=' + userAccountId, {
          method: 'DELETE',
        });

        if (response.ok) {
          showMessage('Altegio отключен');
          setTimeout(() => location.reload(), 1500);
        } else {
          const result = await response.json();
          showMessage(result.error || 'Ошибка отключения', true);
        }
      } catch (error) {
        showMessage('Ошибка сети: ' + error.message, true);
      }
    }
  </script>
</body>
</html>
    `;

    return reply.type('text/html').send(html);
  });

  /**
   * POST /altegio/connect
   * Connects Altegio with provided credentials
   */
  app.post('/altegio/connect', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userAccountId, companyId, userToken } = request.body as {
      userAccountId: string;
      companyId: number;
      userToken: string;
    };

    if (!userAccountId || !companyId || !userToken) {
      return reply.status(400).send({
        error: 'userAccountId, companyId, and userToken are required',
      });
    }

    // Check if partner token is configured
    if (!isPartnerTokenConfigured()) {
      return reply.status(500).send({
        error: 'Altegio integration not configured',
      });
    }

    try {
      // Validate connection by fetching company info
      const client = createAltegioClient(getPartnerToken(), userToken);
      const company = await client.getCompany(companyId);

      // Save credentials
      const saved = await saveAltegioCredentials(
        userAccountId,
        companyId,
        userToken,
        company.title || company.public_title
      );

      if (!saved) {
        return reply.status(500).send({ error: 'Failed to save credentials' });
      }

      app.log.info({
        msg: 'Altegio connected',
        userAccountId,
        companyId,
        companyName: company.title,
      });

      return reply.send({
        success: true,
        companyId,
        companyName: company.title || company.public_title,
      });
    } catch (error: any) {
      app.log.error({
        msg: 'Failed to connect Altegio',
        error: error.message,
        userAccountId,
        companyId,
      });

      return reply.status(400).send({
        error: `Failed to connect: ${error.message}`,
      });
    }
  });

  /**
   * GET /altegio/status
   * Returns Altegio connection status
   */
  app.get('/altegio/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userAccountId } = request.query as { userAccountId?: string };

    if (!userAccountId) {
      return reply.status(400).send({ error: 'userAccountId is required' });
    }

    const credentials = await getAltegioCredentials(userAccountId);

    if (!credentials) {
      return reply.send({
        connected: false,
      });
    }

    // Optionally validate the connection
    const validation = await validateAltegioConnection(userAccountId);

    // Get connection timestamp
    const { data: account } = await supabase
      .from('user_accounts')
      .select('altegio_connected_at')
      .eq('id', userAccountId)
      .single();

    return reply.send({
      connected: true,
      valid: validation.valid,
      companyId: credentials.companyId,
      companyName: credentials.companyName,
      connectedAt: account?.altegio_connected_at,
      error: validation.error,
    });
  });

  /**
   * DELETE /altegio/disconnect
   * Disconnects Altegio
   */
  app.delete('/altegio/disconnect', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userAccountId } = request.query as { userAccountId?: string };

    if (!userAccountId) {
      return reply.status(400).send({ error: 'userAccountId is required' });
    }

    const removed = await removeAltegioCredentials(userAccountId);

    if (!removed) {
      return reply.status(500).send({ error: 'Failed to disconnect' });
    }

    app.log.info({
      msg: 'Altegio disconnected',
      userAccountId,
    });

    return reply.send({ success: true });
  });
}

export default altegioAuthRoutes;
