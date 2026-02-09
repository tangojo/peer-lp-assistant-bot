# Peer LP Assistant Bot

Ein Bot zur Automatisierung, Optimierung und Überwachung von Liquidity-Provider-Operationen auf dem [Peer (ZKP2P)](https://peer.xyz) Protokoll.

## Was macht dieser Bot?

Als Peer LP musst du normalerweise manuell:
- On-Chain-Events beobachten (neue Orders, Fills)
- Fiat-Eingänge auf Revolut prüfen
- EUR/USD-Kurse im Auge behalten und Spreads anpassen
- Fiat zurück in USDC konvertieren (Recycling Loop)
- P&L in einer Tabelle tracken

**Dieser Bot automatisiert das alles.**

## Features

| Phase | Feature | Status |
|-------|---------|--------|
| 1 Foundation | On-Chain-Monitoring, Order Tracking, Telegram/Console Alerts, CLI, SQLite | Done |
| 2 Intelligence | Forex Poller (ECB), Spread Engine, P&L Tracker, REST API, Discord Alerts | Done |
| 3 Integration | Revolut API/Webhook, Fiat-TX Matching, Recycling State Machine | Done |
| 4 Automation | Auto-Spread (On-Chain TX), Escrow Management, Konkurrenz-Analyse | Done |
| 5 Polish | Multi-User Profiles, Docker, Unit Tests (75%+), Security Review, MIT License | Done |

---

## Voraussetzungen

- **Node.js** >= 20.0.0
- **npm** >= 9
- **USDC auf Base** (Startkapital, z.B. $1.000-$2.000)
- **Peer Deposit** (mindestens einen aktiven Deposit auf [peer.xyz](https://peer.xyz))
- **Telegram Bot** (optional, fur Alerts)

## Schnellstart

```bash
git clone git@github.com:tangojo/peer-lp-assistant-bot.git
cd peer-lp-assistant-bot
npm install
npm run build
cp .env.example .env   # Secrets eintragen
```

Bearbeite `config.yaml`:

```yaml
wallet:
  address: "0xDEINE_WALLET_ADRESSE"

peer:
  deposit_ids: [42]
```

Starten:

```bash
npm start           # Produktion
npm run dev         # Entwicklung (Auto-Reload)
pm2 start ecosystem.config.cjs  # PM2
```

---

## Docker

```bash
# Build & Start
docker compose up -d

# Logs
docker compose logs -f

# Stop
docker compose down
```

Die `docker-compose.yml` mountet `config.yaml` (read-only), `data/` (persistent) und `.env`.

---

## Multi-User Profiles

Der Bot unterstutzt mehrere Wallets/Deposits in einer Config:

```yaml
# Multi-User Config
profiles:
  - name: "main"
    wallet:
      address: "0xWALLET_1"
    peer:
      deposit_ids: [1, 2]
    spread:
      target_margin_percent: 1.0
    private_key_env: "WALLET_1_PRIVATE_KEY"

  - name: "secondary"
    wallet:
      address: "0xWALLET_2"
    peer:
      deposit_ids: [3]
    spread:
      target_margin_percent: 1.5
    private_key_env: "WALLET_2_PRIVATE_KEY"

# Shared settings
chain:
  rpc_url: "https://mainnet.base.org"
alerts:
  telegram:
    enabled: true
```

Profil auswahlen:

```bash
# CLI
node dist/cli/index.js --profile secondary status

# Bot (via Environment)
PEER_LP_PROFILE=secondary npm start
```

Ohne `profiles`-Array funktioniert die Single-User-Config wie bisher (ruckwartskompatibel).

---

## Konfiguration

### Vollstandige Config-Referenz

| Feld | Typ | Default | Beschreibung |
|------|-----|---------|-------------|
| `wallet.address` | string | -- | **Pflicht.** EVM-Wallet-Adresse |
| `chain.rpc_url` | string | `https://mainnet.base.org` | Base RPC URL |
| `chain.rpc_ws` | string | -- | WebSocket RPC (Echtzeit-Events) |
| `peer.deposit_ids` | number[] | -- | **Pflicht.** Deine Deposit-IDs |
| `peer.payment_method` | string | `revolut` | Zahlungsmethode |
| `peer.currency` | string | `EUR` | Fiat-Wahrung |
| `spread.mode` | string | `manual` | `manual` oder `auto` |
| `spread.target_margin_percent` | number | `1.0` | Ziel-Marge in % |
| `spread.recycling_cost_percent` | number | `0.4` | Fiat-Recycling-Kosten in % |
| `spread.gas_buffer_percent` | number | `0.1` | Gas-Buffer in % |
| `spread.min_spread_percent` | number | `0.5` | Minimum Spread |
| `spread.max_spread_percent` | number | `3.0` | Maximum Spread |
| `spread.auto_adjust_interval_minutes` | number | `30` | Auto-Adjust Intervall (min 5) |
| `revolut.enabled` | boolean | `false` | Revolut-Integration aktivieren |
| `revolut.webhook_port` | number | `3100` | Webhook Listening Port |
| `recycling.cex` | string | `kraken` | CEX fur Recycling (kraken/coinbase) |
| `recycling.cex_fee_percent` | number | `0.26` | CEX Trading-Gebuhren |
| `alerts.telegram.enabled` | boolean | `false` | Telegram-Alerts |
| `alerts.discord.enabled` | boolean | `false` | Discord-Alerts |
| `alerts.console.enabled` | boolean | `true` | Console-Logging |
| `api.enabled` | boolean | `false` | REST API aktivieren |
| `api.port` | number | `3200` | API Port |

### Environment-Variablen

| Variable | Beschreibung |
|----------|-------------|
| `PEER_LP_PRIVATE_KEY` | Wallet Private Key (fur Auto-Spread + Escrow) |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token |
| `TELEGRAM_CHAT_ID` | Telegram Chat ID |
| `DISCORD_WEBHOOK_URL` | Discord Webhook URL |
| `REVOLUT_ACCESS_TOKEN` | Revolut Business API Token |
| `REVOLUT_WEBHOOK_SECRET` | Revolut Webhook Signing Secret |
| `REVOLUT_TOKEN_REFRESH_DATE` | Datum des letzten Token-Refreshes |
| `PEER_LP_API_KEY` | API Key fur REST-Endpoints |
| `PEER_LP_PROFILE` | Profil-Name fur Multi-User |

---

## CLI

```bash
# Basis
peer-lp status                    # Deposit-Status + Balances
peer-lp orders [--limit 50]       # Letzte Orders
peer-lp pnl [--period 7d]         # P&L Summary

# Spread
peer-lp spread                    # Aktuelle Empfehlung
peer-lp spread-set 1.5            # Spread lokal setzen

# Fiat Recycling
peer-lp recycle                   # Recycling-Loop Status
peer-lp recycle-advance <cycleId> # Nachsten Schritt auslosen
peer-lp revolut [--hours 48]      # Revolut-Transaktionen

# Escrow Management (braucht PEER_LP_PRIVATE_KEY)
peer-lp deposit-sync              # On-Chain Deposit-Daten synchronisieren
peer-lp deposit-add <id> <amount> # USDC zu Deposit hinzufugen
peer-lp deposit-withdraw <id> <amount>  # USDC abziehen
peer-lp deposit-pause <id>        # Deposit pausieren
peer-lp deposit-resume <id>       # Deposit fortsetzen
peer-lp competition               # Konkurrenz-Deposits analysieren

# Optionen
peer-lp --profile secondary status  # Profil auswahlen
peer-lp --config ./other.yaml status  # Config-Pfad
```

---

## REST API

Wenn `api.enabled: true` in der Config:

| Endpoint | Method | Beschreibung |
|----------|--------|-------------|
| `/api/status` | GET | Deposits, Order-Stats, Spread, Forex |
| `/api/pnl?period=7d` | GET | P&L Summary + Zyklen |
| `/api/orders?limit=20` | GET | Letzte Orders |
| `/api/spread` | GET | Aktuelle Spread-Empfehlung |
| `/api/spread` | POST | Spread manuell setzen |
| `/api/forex` | GET | EUR/USD Kurs |

Wenn `PEER_LP_API_KEY` gesetzt, wird Bearer-Auth erzwungen.

---

## Architektur

Siehe [ARCHITECTURE.md](ARCHITECTURE.md) fur die vollstandige Dokumentation.

```
peer-lp-bot/
├── src/
│   ├── index.ts               # Entry Point
│   ├── config/                # Zod Schema + Multi-Profile Loader
│   ├── chain/                 # Base Event Listener, Escrow Manager, Signer
│   ├── engine/                # Order Manager, Spread Engine, P&L, Recycle, Competition
│   ├── alerts/                # Telegram, Discord, Console
│   ├── api/                   # Fastify REST API
│   ├── forex/                 # EUR/USD Poller (ECB)
│   ├── revolut/               # Revolut API Client, Webhook, Matcher
│   ├── cli/                   # Commander.js CLI
│   ├── db/                    # SQLite (sql.js WASM)
│   └── utils/                 # Logger, Formatting, Retry
├── Dockerfile                 # Multi-Stage Build
├── docker-compose.yml
├── config.yaml
├── ecosystem.config.cjs       # PM2
└── vitest.config.ts           # Test Config
```

### Datenfluss

```
Base RPC ──→ Chain Listener ──→ Order Manager ──→ Alert Service ──→ Telegram/Discord
                  │                   │                                     │
                  ▼                   ▼                                     ▼
            Escrow Manager      SQLite DB ←── CLI / REST API          Console
                  │                   ▲
                  ▼                   │
            Spread Engine ←── Forex Poller (ECB)
                  │
                  ▼
            Competition Analyzer
```

---

## Entwicklung

```bash
npm run build       # TypeScript kompilieren
npm run dev         # Entwicklung mit Auto-Reload
npm run typecheck   # Type-Check ohne Build
npm test            # Unit Tests (vitest)
npm run lint        # ESLint
```

### Tests

83 Unit Tests, 75%+ Statement Coverage auf Core Engine:

```bash
npm test                        # Alle Tests
npx vitest run --coverage       # Mit Coverage Report
```

Getestete Module: config/schema, config/loader, engine/spread-engine, engine/order-manager, engine/pnl-tracker, engine/recycle-manager, utils/formatting, utils/retry.

---

## Peer Protokoll Referenz

| Komponente | Adresse (Base) |
|------------|---------------|
| Escrow | `0x2f121CDDCA6d652f35e8B3E560f9760898888888` |
| Orchestrator | `0x88888883Ed048FF0a415271B28b2F52d431810D0` |
| ProtocolViewer | `0x30B03De22328074Fbe8447C425ae988797146606` |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

### Events

| Event | Contract | Bedeutung |
|-------|----------|----------|
| `IntentSignaled` | Orchestrator | Neue Kauf-Order |
| `FundsLocked` | Escrow | Kapital gesperrt |
| `FundsUnlockedAndTransferred` | Escrow | Fill abgeschlossen |
| `IntentFulfilled` | Orchestrator | Fill-Bestatigung |

---

## Security

- Private Keys werden nie geloggt und nur aus Environment-Variablen gelesen
- API-Auth verwendet timing-safe Vergleiche (kein Timing-Attack)
- Webhook HMAC-Validierung mit `timingSafeEqual`
- Alle SQL-Queries sind parameterisiert (kein SQL-Injection)
- API und Webhook Server binden nur auf `127.0.0.1`
- Keine Secrets in Config-Dateien (nur in `.env`)

---

## Lizenz

MIT License. Siehe [LICENSE](LICENSE).
