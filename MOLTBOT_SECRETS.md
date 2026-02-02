# Moltbot Secrets Management

## ⚠️ ВАЖНО: Безопасность API ключей

**НИКОГДА не коммить API ключи и токены в git!**

## Безопасное добавление секретов на сервере

### Способ 1: Ручное добавление (рекомендуется)

```bash
# Подключись к серверу
ssh your-server

# Перейди в директорию проекта
cd ~/agents-monorepo

# Добавь секреты в .env.brain (заменив <значения> на реальные)
cat >> .env.brain << 'EOF'
MOLTBOT_TELEGRAM_BOT_TOKEN=<ваш_токен_бота>
OPENAI_API_KEY=<ваш_openai_ключ>
ANTHROPIC_API_KEY=<ваш_anthropic_ключ>
SUPERMEMORY_API_KEY=<ваш_supermemory_ключ>
EOF
```

### Способ 2: Копирование из локального .env.brain

Если у тебя есть локальный `.env.brain` с правильными ключами:

```bash
# На локальной машине
scp .env.brain your-server:~/agents-monorepo/.env.brain
```

### Способ 3: Использование секретного менеджера (production best practice)

Для production окружения рекомендуется использовать:
- **HashiCorp Vault** для управления секретами
- **AWS Secrets Manager** или **Parameter Store**
- **GitHub Secrets** для CI/CD
- **Ansible Vault** для автоматизации деплоя

## Проверка безопасности

После настройки убедись что секреты не попали в git:

```bash
# Проверь что .env.brain в .gitignore
git check-ignore .env.brain

# Проверь историю git на наличие утечек (используй gitleaks)
docker run --rm -v $(pwd):/path zricethezav/gitleaks:latest detect --source="/path" -v
```

## Ротация ключей

Если ключи случайно попали в git:

### 1. Telegram Bot Token
```bash
# Обратись к @BotFather в Telegram
/mybots → выбери бота → Bot Settings → Revoke Token
```

### 2. OpenAI API Key
```bash
# Зайди на https://platform.openai.com/api-keys
# Удали старый ключ и создай новый
```

### 3. Anthropic API Key
```bash
# Зайди на https://console.anthropic.com/settings/keys
# Удали старый ключ и создай новый
```

### 4. Supermemory API Key
```bash
# Зайди на https://console.supermemory.ai
# Создай новый ключ
```

## История git cleanup (если ключи уже в git)

⚠️ **КРИТИЧНО**: Если ключи попали в git историю, нужно почистить:

```bash
# Используй BFG Repo-Cleaner
git clone --mirror https://github.com/your-repo.git
java -jar bfg.jar --replace-text passwords.txt your-repo.git
cd your-repo.git
git reflog expire --expire=now --all
git gc --prune=now --aggressive
git push --force

# Или используй git-filter-repo
git filter-repo --invert-paths --path setup-moltbot-env.sh --force
```

## Что делать после утечки

1. ✅ **Немедленно ротировать** все скомпрометированные ключи
2. ✅ **Почистить git историю** с помощью BFG или git-filter-repo
3. ✅ **Уведомить команду** о произошедшем инциденте
4. ✅ **Проверить логи API** на подозрительную активность
5. ✅ **Обновить документацию** по безопасности

## Текущие секреты в проекте

Следующие файлы должны быть в `.gitignore`:
- `.env`
- `.env.*` (кроме `.env.example`)
- `.env.brain`
- `.env.agent`
- `.env.chatbot`
- `.env.crm`

## Контрольный список

- [ ] Все `.env` файлы в `.gitignore`
- [ ] Секреты добавлены только на сервере
- [ ] История git не содержит ключей (проверено gitleaks)
- [ ] Доступ к серверу защищён SSH ключами
- [ ] `.env.brain` права доступа `600` (только владелец может читать)
- [ ] Регулярная ротация ключей (каждые 90 дней)

## Команды для проверки прав доступа

```bash
# Установить правильные права на .env.brain
chmod 600 .env.brain

# Проверить права
ls -la .env.brain
# Должно быть: -rw------- (600)
```
