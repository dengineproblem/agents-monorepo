# 🔌 WhatsApp API Endpoints - Quick Reference

## Backend Endpoints (agent-service)

### 1. Connect WhatsApp (получить QR-код)
```
POST /api/whatsapp/connect
Body: { "user_id": "uuid" }
Response: { "success": true, "qrcode": { "base64": "..." }, "instance": {...} }
```

### 2. Get Status (проверить подключение)
```
GET /api/whatsapp/status?user_id=uuid
Response: { "success": true, "instance": { "status": "connected", "phone_number": "+123..." } }
```

### 3. Disconnect (отключить WhatsApp)
```
DELETE /api/whatsapp/disconnect?user_id=uuid
Response: { "success": true }
```

### 4. Send Message (отправить сообщение)
```
POST /api/whatsapp/send
Body: { "user_id": "uuid", "phone": "+123...", "message": "Hello!" }
Response: { "success": true, "message_id": "uuid" }
```

### 5. Get Messages (получить историю)
```
GET /api/whatsapp/messages?user_id=uuid&limit=50&phone=+123...
Response: { "success": true, "messages": [...] }
```

### 6. Webhook (для Evolution API)
```
POST /api/webhooks/evolution
Body: { "event": "messages.upsert", "data": {...} }
Response: { "success": true }
```

---

## Frontend Flow

### Подключение WhatsApp:
```
1. User clicks "Connect WhatsApp" button
   ↓
2. Frontend → POST /api/whatsapp/connect
   ↓
3. Backend → Evolution API (create instance)
   ↓
4. Backend returns QR code
   ↓
5. Frontend shows QR in modal
   ↓
6. User scans QR with WhatsApp
   ↓
7. Evolution API webhook → /api/webhooks/evolution (status update)
   ↓
8. Frontend polls GET /api/whatsapp/status
   ↓
9. Status changes to "connected"
   ↓
10. Modal shows success ✓
```

### Отправка сообщения:
```
1. User enters phone + message
   ↓
2. Frontend → POST /api/whatsapp/send
   ↓
3. Backend checks instance status
   ↓
4. Backend → Evolution API (send message)
   ↓
5. Evolution API → WhatsApp
   ↓
6. Message saved to whatsapp_messages table
   ↓
7. Response to frontend
```

### Получение входящего сообщения:
```
1. WhatsApp → Evolution API (new message)
   ↓
2. Evolution API → POST /api/webhooks/evolution
   ↓
3. Backend saves to whatsapp_messages table
   ↓
4. (Optional) Send Telegram notification
```

---

## Database Tables

### whatsapp_instances
```
id, user_account_id, instance_name, status, phone_number, connected_at
```

### whatsapp_messages
```
id, instance_id, remote_jid, message_text, direction, timestamp
```

---

## Environment Variables

```bash
# .env.agent
EVOLUTION_API_KEY=your-secure-random-key-here
EVOLUTION_DB_PASSWORD=your-secure-db-password
EVOLUTION_API_URL=http://evolution-api:8080
```

---

## Error Handling

### Common errors:

| Error | Status | Reason | Solution |
|-------|--------|--------|----------|
| Instance not found | 404 | User has no instance | Call /connect first |
| Instance not connected | 400 | WhatsApp disconnected | Show QR code again |
| Invalid phone format | 400 | Wrong phone format | Use +1234567890 |
| Rate limit exceeded | 429 | Too many requests | Wait 1 minute |

---

## Testing

### Local test:
```bash
# 1. Create instance and get QR
curl -X POST http://localhost:8082/api/whatsapp/connect \
  -H "Content-Type: application/json" \
  -d '{"user_id":"YOUR_USER_ID"}'

# 2. Check status
curl "http://localhost:8082/api/whatsapp/status?user_id=YOUR_USER_ID"

# 3. Send message (after connected)
curl -X POST http://localhost:8082/api/whatsapp/send \
  -H "Content-Type: application/json" \
  -d '{
    "user_id":"YOUR_USER_ID",
    "phone":"+1234567890",
    "message":"Test message"
  }'
```

---

## Security Checklist

- [ ] EVOLUTION_API_KEY в .env (не в коде)
- [ ] Проверка user_id в каждом endpoint
- [ ] Rate limiting (10 req/min)
- [ ] Webhook IP validation
- [ ] Phone number format validation
- [ ] Message length limit (max 4096 chars)

---

## Monitoring

### Key metrics to track:
- Number of connected instances
- Messages sent/received per day
- Connection success rate
- Average QR scan time
- Failed connection attempts

### Grafana queries:
```
# Connected instances
count(whatsapp_instances where status='connected')

# Messages today
count(whatsapp_messages where created_at > now() - interval '1 day')
```
