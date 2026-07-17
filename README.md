# 🐻 EOS Support Bot

A modern Discord bot to **schedule and manage automatic events** using slash commands. Perfect for games, communities, and automation.

## ✨ Features

- ✅ **Slash Commands** (`/event create`, `/event list`, etc.)
- ✅ **Database Scheduling** (MongoDB Atlas)
- ✅ **Multiple Repeat Types** (once, daily, every2days, weekly, monthly)
- ✅ **UTC Timezone** (globally compatible)
- ✅ **Modern Discord Embeds**
- ✅ **HTTP Health Check**
- ✅ **Professional Logging**

---

## 🚀 Installation

### 1. **Clone the Repository**
```bash
git clone https://github.com/your-username/eos-support-bot.git
cd eos-support-bot
```

### 2. **Install Dependencies**
```bash
npm install
```

### 3. **Configure Environment Variables**
Create a `.env` file in the project root:
```env
DISCORD_TOKEN=your_discord_token_here
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/eos-support?retryWrites=true&w=majority
PORT=3000
LOG_LEVEL=info
```

**Como criar o MongoDB Atlas (gratuito):**
1. Cria conta em [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Cria um cluster **M0 Free**
3. Em **Database Access**, cria um utilizador com password
4. Em **Network Access**, adiciona `0.0.0.0/0` (permite ligação do Render)
5. Clica **Connect → Drivers** e copia a connection string
6. Substitui `<password>` e define o nome da base de dados (ex: `eos-support`)

**How to get your Discord token:**
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to "Bot" and click "Add Bot"
4. Copy the token

### 4. **Bot Permissions**
In Developer Portal, under "OAuth2 > URL Generator":
- Scopes: `bot`, `applications.commands`
- Permissions: `Send Messages`, `Embed Links`, `Read Message History`

Use the generated URL to add the bot to your server.

### 5. **Start the Bot**
```bash
npm start          # Production
npm run dev        # Development (auto-reload)
```

### 6. **Deploy no Render (Produção)**

O projeto inclui um `render.yaml` pronto para usar.

1. Faz push do repositório para o GitHub
2. No [Render Dashboard](https://dashboard.render.com), clica em **New → Blueprint**
3. Liga o repositório e confirma o blueprint
4. Define as variáveis `DISCORD_TOKEN` e `MONGODB_URI` (obrigatórias)
5. Opcionalmente define `STATS_TOKEN` para proteger `/stats`
6. Aguarda o deploy — o Render usa `npm install` e `npm start`

O serviço expõe `/health` para health checks.

> **Base de dados:** Os eventos são guardados no **MongoDB Atlas** (plano gratuito). Os dados persistem mesmo no plano gratuito do Render — não precisas de disco pago.

> **Nota:** No plano gratuito do Render, o serviço pode adormecer após inatividade. Usa o UptimeRobot (passo seguinte) para o manter acordado.

### 7. **UptimeRobot (Manter online)**

1. Cria conta em [UptimeRobot](https://uptimerobot.com)
2. **Add New Monitor** → tipo **HTTP(s)**
3. URL: `https://<teu-servico>.onrender.com/health`
4. Intervalo: **5 minutos** (recomendado no plano gratuito)
5. Guarda — o monitor faz ping regular e evita que o Render suspenda o bot

---

## 📋 Slash Commands

### `/event create`
Create a new scheduled event.

**Options:**
- `name` (required): Event name
- `message` (required): Message to send
- `hour` (required): GAME hour (0-23)
- `minute` (required): Minute (0-59)
- `repeat` (required): Repeat type
  - `once` - Once only
  - `daily` - Every day
  - `every2days` - Every 2 days
  - `weekly` - Weekly (requires repeat_value: 0-6)
  - `monthly` - Monthly (requires repeat_value: 1-31)
- `repeat_value` (optional): Value for weekly/monthly
- `channel_id` (optional): Channel ID (uses current channel if not specified)

**Example:**
```
/event create 
  name: Bear Hunt 1
  message: @everyone 🐻 Bear Hunt in 10 minutes!
  hour: 1
  minute: 0
  repeat: every2days
  channel_id: 1234567890
```

### `/event list`
List all scheduled events.

### `/event next`
Show the next event to run.

### `/event due`
Debug: View events that are due now.

### `/event enable` / `/event disable`
Enable or disable an event by ID.

### `/event delete`
Delete an event.

### `/event run`
Run an event manually now.

---

## 🌐 HTTP Endpoints

The bot runs a web server on port 3000 with the following endpoints:

- `GET /` - Returns status message
- `GET /health` - Returns `{status: "ok", uptime: 123.45}`
- `GET /stats` - Returns detailed stats:
  ```json
  {
    "status": "ok",
    "uptime": 3600.5,
    "total_events": 15,
    "active_events": 12,
    "due_events": 2,
    "timestamp": "2026-01-21T14:30:45.123Z"
  }
  ```

---

## 📁 Project Structure

```
eos-support-bot/
├── index.js                     # Bot main file
├── scheduler.js                 # Scheduling engine
├── config.js                    # Centralized configuration
├── logger.js                    # Logging system
├── embeds.js                    # Discord embed helpers
├── backup.js                    # Database backup system
├── rateLimit.js                 # Rate limiting
├── commands/
│   └── event.js                 # /event command (create, list, etc.)
├── data/
│   ├── database.js              # MongoDB connection
│   └── events.js                # Event CRUD operations
├── backups/                     # Daily JSON backups (auto-generated)
├── .github/
│   └── workflows/
│       └── ci-cd.yml            # GitHub Actions CI/CD
├── .env                         # Environment variables (don't share!)
├── .env.example                 # .env template
├── render.yaml                  # Render Blueprint (deploy)
├── .node-version                # Node.js version for Render
├── package.json                 # Dependencies
└── README.md                    # This file
```

---

## 🗄️ Database

Os eventos são guardados no **MongoDB Atlas** (coleção `events`):

| Field | Type | Description |
|-------|------|-------------|
| `id` | Number | Unique ID (sequencial) |
| `name` | String | Event name |
| `channel_id` | String | Discord channel ID |
| `message` | String | Message to send |
| `next_run` | String | Next execution (ISO 8601) |
| `repeat_type` | String | Repeat type |
| `repeat_value` | Number | Value for weekly/monthly |
| `enabled` | Boolean | Active/inactive |
| `created_at` | String | Creation timestamp |
| `updated_at` | String | Update timestamp |

---

## ⚙️ Environment Variables

```env
# Required
DISCORD_TOKEN=your_token_here
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/eos-support

# Optional
PORT=3000                           # HTTP server port (default: 3000)
LOG_LEVEL=info                      # Levels: error, warn, info, debug
BACKUP_ENABLED=true                 # Enable daily database backups
BACKUP_INTERVAL_HOURS=24            # Backup frequency (hours)
RATE_LIMIT_COOLDOWN_MS=5000         # Cooldown between commands (ms)
CHECK_INTERVAL_MS=60000             # Scheduler interval (ms)
STATS_TOKEN=                        # Optional token for /stats endpoint
```

---

## 💾 Backups

O bot cria backups diários em JSON:
- **Localização:** pasta `./backups/`
- **Nome:** `events-YYYY-MM-DD.json`
- **Frequência:** Uma vez por dia (configurável via `BACKUP_INTERVAL_HOURS`)

Para restaurar um backup, importa o JSON manualmente na coleção `events` do MongoDB Atlas.

---

## 🐛 Troubleshooting

### "Bot doesn't respond to commands"
1. Check if the bot has the `applications.commands` permission
2. Try reloading Discord (CTRL+R)
3. Check if DISCORD_TOKEN and MONGODB_URI are correct in `.env` or no Render

### "Messages are not being sent"
1. Check if the bot has `Send Messages` permission in the channel
2. Check the bot logs for errors (`LOG_LEVEL=debug`)
3. Test with `/event run <id>` to send manually

### "Rate limit: Please wait"
- The bot has a 5-second cooldown between commands per user
- Wait the specified seconds before using another command

### "Message too long (max 2000 characters)"
- Discord has a hard limit of 2000 characters per message
- Reduce your message content or split into multiple events

### "Events are not being scheduled"
1. Check if the hour/minute are in UTC
2. Check if the channel_id exists and is valid
3. Test with `/event due` to see if there are overdue events

---

## 🔒 Rate Limiting

The bot includes user-level rate limiting to prevent command spam:
- **Cooldown:** 5 seconds between commands per user
- **Scope:** Per Discord user ID
- **Applied to:** All slash commands

---

## 📊 Monitoring

### Check Bot Stats
```bash
curl http://localhost:3000/stats
```

### Check Health
```bash
curl http://localhost:3000/health
```

No Render, usa a URL pública: `https://<teu-servico>.onrender.com/health`

### View Logs (Development)
Set `LOG_LEVEL=debug` to see detailed operation logs

---

## 📝 Logs

Logs are formatted like this:
```
ℹ️ [2026-01-21T14:30:45.123Z] Bot started
✅ [2026-01-21T14:30:46.456Z] Event sent: Bear Hunt 1
❌ [2026-01-21T14:30:50.789Z] [scheduler] Error sending event
```

---

## 🛠️ Development

### Hot Reload
```bash
npm run dev
```

### Check Syntax
```bash
node --check index.js
node --check scheduler.js
node --check commands/event.js
node --check config.js
node --check logger.js
node --check embeds.js
node --check backup.js
node --check rateLimit.js
          node --check data/events.js
```

---

## 📄 License

MIT © 2026

---

## 🤝 Support

Found a bug? Create an issue on GitHub or contact the maintainer.

---

**Built with ❤️ for the EOS community**
