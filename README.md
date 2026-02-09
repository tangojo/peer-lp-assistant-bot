# Peer LP Assistant Bot

Ein Bot zur Automatisierung, Optimierung und Überwachung von Liquidity-Provider-Operationen auf dem [Peer (ZKP2P)](https://peer.xyz) Protokoll.

## Was macht dieser Bot?

Als Peer LP musst du normalerweise manuell:
- On-Chain-Events beobachten (neue Orders, Fills)
- Fiat-Eingänge auf Revolut prüfen
- EUR/USD-Kurse im Auge behalten
- Spreads anpassen
- P&L in einer Tabelle tracken

**Dieser Bot automatisiert das alles.** Er überwacht die Blockchain in Echtzeit, trackt alle Orders, berechnet P&L und sendet Alerts via Telegram.

## Features (Phase 1 — Foundation)

- **On-Chain-Monitoring:** Lauscht auf Base-Events (IntentSignaled, FundsLocked, FundsUnlockedAndTransferred)
- **Order Tracking:** State Machine pro Intent (signaled → locked → fulfilled/expired)
- **Telegram Alerts:** Benachrichtigungen bei neuen Orders, Fills, Fehlern
- **Console Logging:** Strukturiertes JSON-Logging via pino
- **CLI:** `peer-lp status` und `peer-lp orders` für Quick-Checks
- **SQLite Persistenz:** Alle Daten lokal gespeichert, kein externer DB-Server nötig
- **PM2 Ready:** Auto-Restart, Log-Rotation, Memory-Limits

## Geplante Features

| Phase | Feature | Status |
|-------|---------|--------|
| 2 | Forex Poller, Spread Engine, P&L Tracker, REST API, Discord | Geplant |
| 3 | Revolut API Integration, Fiat-Loop Tracking | Geplant |
| 4 | Auto-Spread, Escrow Management, Konkurrenz-Analyse | Geplant |
| 5 | Multi-User, Docker, Open Source | Geplant |

---

## Voraussetzungen

- **Node.js** >= 20.0.0
- **npm** >= 9
- **USDC auf Base** (Startkapital, z.B. $1.000–$2.000)
- **Peer Deposit** (mindestens einen aktiven Deposit auf [peer.xyz](https://peer.xyz))
- **Telegram Bot** (optional, für Alerts)

## Installation

### 1. Repository klonen

```bash
git clone git@github.com:tangojo/peer-lp-assistant-bot.git
cd peer-lp-assistant-bot
```

### 2. Dependencies installieren

```bash
npm install
```

### 3. Konfiguration erstellen

Kopiere und bearbeite die Config-Datei:

```bash
cp config.yaml config.local.yaml
```

Bearbeite `config.yaml` mit deinen Daten:

```yaml
wallet:
  address: "0xDEINE_WALLET_ADRESSE"

peer:
  deposit_ids: [42]  # Deine Deposit-ID(s) von peer.xyz
```

### 4. Environment-Variablen setzen

```bash
cp .env.example .env
```

Für Telegram-Alerts (optional):

```bash
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...   # Von @BotFather
TELEGRAM_CHAT_ID=-100123456789          # Deine Chat-ID
```

### 5. TypeScript kompilieren

```bash
npm run build
```

### 6. Bot starten

**Entwicklung (mit Auto-Reload):**
```bash
npm run dev
```

**Produktion (direkt):**
```bash
npm start
```

**Produktion (mit PM2):**
```bash
pm2 start ecosystem.config.cjs
pm2 save
```

---

## Konfiguration

Die Konfiguration erfolgt über `config.yaml`. Alle Felder mit Defaults sind optional.

### Minimal-Config

```yaml
version: 1

wallet:
  address: "0xDEINE_WALLET_ADRESSE"

peer:
  deposit_ids: [42]

alerts:
  telegram:
    enabled: true
```

### Vollständige Config-Referenz

| Feld | Typ | Default | Beschreibung |
|------|-----|---------|-------------|
| `wallet.address` | string | — | **Pflicht.** Deine EVM-Wallet-Adresse |
| `chain.rpc_url` | string | `https://mainnet.base.org` | Base RPC URL |
| `chain.rpc_ws` | string | — | WebSocket RPC (für Echtzeit-Events) |
| `chain.chain_id` | number | `8453` | Base Chain ID |
| `peer.escrow_address` | string | `0x2f121...888888` | Peer Escrow Contract |
| `peer.orchestrator_address` | string | `0x8888...10D0` | Peer Orchestrator Contract |
| `peer.deposit_ids` | number[] | — | **Pflicht.** Deine Deposit-IDs |
| `peer.payment_method` | string | `revolut` | Zahlungsmethode |
| `peer.currency` | string | `EUR` | Fiat-Währung |
| `spread.mode` | string | `manual` | `manual` oder `auto` |
| `spread.target_margin_percent` | number | `1.0` | Ziel-Marge in % |
| `spread.recycling_cost_percent` | number | `0.4` | Fiat-Recycling-Kosten in % |
| `alerts.telegram.enabled` | boolean | `false` | Telegram-Alerts aktivieren |
| `alerts.console.enabled` | boolean | `true` | Console-Logging aktivieren |
| `alerts.console.log_level` | string | `info` | Log-Level: debug/info/warn/error |
| `database.path` | string | `./data/peer-lp.db` | SQLite-Datenbankpfad |

### Environment-Variablen

| Variable | Beschreibung |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token (von @BotFather) |
| `TELEGRAM_CHAT_ID` | Telegram Chat ID für Alerts |
| `DISCORD_WEBHOOK_URL` | Discord Webhook URL (Phase 2) |
| `PEER_LP_PRIVATE_KEY` | Wallet Private Key (nur für Auto-Spread, Phase 4) |
| `REVOLUT_ACCESS_TOKEN` | Revolut Business API Token (Phase 3) |
| `PEER_LP_API_KEY` | API Key für REST-Endpoints (Phase 2) |
| `BASE_RPC_URL` | Überschreibt `chain.rpc_url` |
| `LOG_LEVEL` | Überschreibt Log-Level global |

---

## CLI Bedienung

### Status anzeigen

```bash
npx tsx src/cli/index.ts status

# oder nach Build:
node dist/cli/index.js status
```

Zeigt:
- Alle Deposits mit Status, verfügbarem Betrag, Spread
- Order-Statistiken (Total, Fulfilled, Fill-Rate, Avg Fill Time)

### Orders anzeigen

```bash
npx tsx src/cli/index.ts orders
npx tsx src/cli/index.ts orders --limit 50
```

Zeigt die letzten N Orders mit Hash, Deposit-ID, USDC-Betrag, Status und Fill-Time.

### Hilfe

```bash
npx tsx src/cli/index.ts --help
npx tsx src/cli/index.ts status --help
```

---

## Telegram Bot einrichten

1. **Bot erstellen:** Schreibe `/newbot` an [@BotFather](https://t.me/BotFather) auf Telegram
2. **Token kopieren:** BotFather gibt dir einen Token wie `123456:ABC-DEF...`
3. **Chat-ID ermitteln:**
   - Schreibe deinem Bot eine Nachricht
   - Öffne `https://api.telegram.org/bot<TOKEN>/getUpdates`
   - Finde `"chat":{"id":<DEINE_CHAT_ID>}`
4. **In `.env` eintragen:**
   ```
   TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
   TELEGRAM_CHAT_ID=123456789
   ```
5. **In `config.yaml` aktivieren:**
   ```yaml
   alerts:
     telegram:
       enabled: true
   ```

### Alert-Typen

| Event | Severity | Beispiel |
|-------|----------|---------|
| Neue Order | INFO | "New Order — Deposit #42 \| $500.00 USDC" |
| Funds Locked | INFO | "Funds Locked — Deposit #42" |
| Order Fulfilled | INFO | "Order Fulfilled — $500.00 USDC, Fill time: 3m 42s" |
| Order Expired | WARN | "Order Expired — Deposit #42" |

---

## PM2 Deployment

### Ersteinrichtung

```bash
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup  # Auto-Start nach Reboot
```

### Nützliche PM2-Befehle

```bash
pm2 status                  # Alle Prozesse anzeigen
pm2 logs peer-lp-bot        # Live-Logs
pm2 logs peer-lp-bot --lines 100  # Letzte 100 Zeilen
pm2 restart peer-lp-bot     # Neustart
pm2 stop peer-lp-bot        # Stoppen
pm2 monit                   # Monitoring-Dashboard
```

### PM2 Konfiguration

Die Datei `ecosystem.config.cjs` enthält:
- **Auto-Restart:** Bei Crash, max 10 Neustarts
- **Memory Limit:** Restart bei >200MB
- **Log-Dateien:** `data/logs/out.log` und `data/logs/error.log`
- **Restart-Delay:** 5 Sekunden zwischen Neustarts

---

## Architektur

Siehe [ARCHITECTURE.md](ARCHITECTURE.md) für die vollständige Architektur-Dokumentation.

### Projektstruktur

```
peer-lp-bot/
├── src/
│   ├── index.ts               # Entry Point — startet alle Services
│   ├── config/
│   │   ├── schema.ts          # Zod-Schema für Config-Validierung
│   │   └── loader.ts          # Config laden + Env-Variablen
│   ├── chain/
│   │   ├── listener.ts        # Base Event Listener (WS + Polling)
│   │   ├── escrow.ts          # Escrow-Contract ABI
│   │   └── orchestrator.ts    # Orchestrator-Contract ABI
│   ├── engine/
│   │   └── order-manager.ts   # Order State Machine
│   ├── alerts/
│   │   ├── telegram.ts        # Telegram Bot (grammy)
│   │   ├── console.ts         # Console-Alerts (pino)
│   │   └── service.ts         # Alert-Router
│   ├── cli/
│   │   └── index.ts           # CLI Commands
│   ├── db/
│   │   ├── connection.ts      # SQLite-Verbindung (sql.js WASM)
│   │   ├── migrations.ts      # Schema-Migrations
│   │   └── queries.ts         # Prepared Statements
│   └── utils/
│       ├── logger.ts          # Pino-Logger
│       ├── formatting.ts      # USD/EUR/Prozent-Formatierung
│       └── retry.ts           # Retry-Logic für RPC-Calls
├── config.yaml                # Konfiguration
├── .env.example               # Environment-Variablen Template
├── ecosystem.config.cjs       # PM2-Konfiguration
├── ARCHITECTURE.md            # Architektur-Dokumentation
└── package.json
```

### Datenfluss

```
Base RPC → Chain Listener → Order Manager → Alert Service → Telegram/Console
                                 ↓
                              SQLite ← CLI (read-only)
```

---

## Entwicklung

```bash
# TypeScript kompilieren
npm run build

# Entwicklung mit Auto-Reload
npm run dev

# Type-Check ohne Build
npm run typecheck

# Tests ausführen
npm test

# CLI direkt ausführen (ohne Build)
npx tsx src/cli/index.ts status
```

---

## Peer Protokoll Referenz

| Komponente | Adresse (Base) |
|------------|---------------|
| Escrow | `0x2f121CDDCA6d652f35e8B3E560f9760898888888` |
| Orchestrator | `0x88888883Ed048FF0a415271B28b2F52d431810D0` |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

### Events die der Bot überwacht

| Event | Contract | Bedeutung |
|-------|----------|----------|
| `IntentSignaled` | Orchestrator | Neue Kauf-Order für deinen Deposit |
| `FundsLocked` | Escrow | Kapital für Intent gesperrt |
| `FundsUnlockedAndTransferred` | Escrow | Fill abgeschlossen, USDC an Buyer |
| `IntentFulfilled` | Orchestrator | Fill-Bestätigung |

---

## Lizenz

Private Repository. Open-Source-Veröffentlichung (MIT) geplant nach Phase 5.
