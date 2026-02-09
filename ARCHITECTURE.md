# Peer LP Assistant Bot — Architecture Proposal

**Version:** 0.1.0
**Autor:** CTO
**Datum:** 2026-02-09
**Status:** APPROVED — 2026-02-09

---

## 1. Executive Summary

Ein Bot, der Peer (ZKP2P) Liquidity Provider bei der Automatisierung,
Optimierung und Überwachung ihres LP-Betriebs unterstützt. Der Bot
überwacht On-Chain-Events, trackt P&L, optimiert Spreads basierend auf
Marktdaten und alarmiert über Telegram/Discord/CLI.

**Zielgruppe:** Solo-LPs im EUR-Raum mit Revolut (perspektivisch multi-user).
**Startkapital:** $1.000–$2.000 USDC auf Base.

---

## 2. Problem Statement

Als Peer LP muss man heute manuell:

1. Deposits erstellen und Spreads setzen
2. Eingehende Orders im Browser beobachten
3. Fiat-Eingänge auf Revolut prüfen
4. EUR/USD-Kurse im Auge behalten und Spreads anpassen
5. Fiat zurück in USDC konvertieren (Fiat-Recycling-Loop)
6. P&L in einer Tabelle tracken

**Ziel:** Alle 6 Punkte automatisieren oder semi-automatisieren.

---

## 3. Anforderungen

### 3.1 Funktionale Anforderungen

| ID | Anforderung | Priorität |
|----|-------------|-----------|
| F1 | On-Chain-Monitoring: Deposit-Status, Intents, Fills in Echtzeit | P0 |
| F2 | P&L-Tracking: Gewinn pro Zyklus, täglich, wöchentlich, monatlich | P0 |
| F3 | Alerting: Neue Order, Fill abgeschlossen, Kapital niedrig | P0 |
| F4 | Spread-Optimierung: EUR/USD-Kurs, Konkurrenz-Spreads, Auto-Adjust | P1 |
| F5 | Revolut-Integration: Eingehende Zahlungen via Webhook erkennen | P1 |
| F6 | Fiat-Recycling-Tracker: Status des SEPA-Loops tracken | P1 |
| F7 | Escrow-Management: Deposits erstellen, Spreads setzen via CLI/API | P2 |
| F8 | Multi-User: Mehrere Wallets/Configs parallel unterstützen | P2 |
| F9 | Dashboard-API: REST-Endpoints für ein zukünftiges Web-Frontend | P2 |

### 3.2 Nicht-funktionale Anforderungen

| ID | Anforderung |
|----|-------------|
| NF1 | Läuft 24/7 auf einer VPS (bestehende Infrastruktur) |
| NF2 | Crash-tolerant: Auto-Restart, kein Datenverlust bei Neustart |
| NF3 | Minimale Infrastrukturkosten (<$10/Monat zusätzlich) |
| NF4 | Konfigurierbar ohne Code-Änderungen (YAML/JSON-Config) |
| NF5 | Saubere Architektur für spätere Open-Source-Veröffentlichung |
| NF6 | Logging: Strukturiertes Logging (JSON) für Debugging |

---

## 4. Architektur

### 4.1 High-Level Architecture

```
                    ┌─────────────────────┐
                    │   External APIs     │
                    │  ┌───────────────┐  │
                    │  │ Base RPC      │  │
                    │  │ Revolut API   │  │
                    │  │ ECB/Forex API │  │
                    │  │ Dune API      │  │
                    │  └───────┬───────┘  │
                    └──────────┼──────────┘
                               │
                    ┌──────────▼──────────┐
                    │    Event Ingestion  │
                    │  ┌────────────────┐ │
                    │  │ Chain Listener │ │  ← Base WebSocket/Polling
                    │  │ Revolut Webhook│ │  ← HTTP Webhook Server
                    │  │ Forex Poller   │ │  ← Cron (alle 5 Min)
                    │  └───────┬────────┘ │
                    └──────────┼──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Core Engine       │
                    │  ┌────────────────┐ │
                    │  │ Order Manager  │ │  ← Tracking aller Intents
                    │  │ Spread Engine  │ │  ← Optimale Preisberechnung
                    │  │ P&L Tracker    │ │  ← Zyklen-Buchhaltung
                    │  │ Recycle Manager│ │  ← Fiat-Loop-Status
                    │  └───────┬────────┘ │
                    └──────────┼──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
    ┌─────────▼──────┐ ┌──────▼──────┐ ┌───────▼──────┐
    │ Alert Service  │ │ REST API    │ │ CLI          │
    │ ┌────────────┐ │ │ (Express)   │ │ (Commander)  │
    │ │ Telegram   │ │ │             │ │              │
    │ │ Discord    │ │ │ GET /status │ │ bot status   │
    │ │ Console    │ │ │ GET /pnl    │ │ bot spread   │
    │ └────────────┘ │ │ POST /spread│ │ bot deposit  │
    └────────────────┘ └─────────────┘ └──────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Persistence       │
                    │  ┌────────────────┐ │
                    │  │ SQLite         │ │  ← Orders, P&L, Zyklen
                    │  │ Config (YAML)  │ │  ← User-Konfiguration
                    │  └────────────────┘ │
                    └─────────────────────┘
```

### 4.2 Komponentenübersicht

#### A) Chain Listener
- **Aufgabe:** On-Chain-Events auf Base überwachen
- **Input:** Base RPC (WebSocket oder Polling)
- **Events:**
  - `IntentSignaled` → Neue Kauf-Order für unser Deposit
  - `FundsLocked` → Kapital für Intent gesperrt
  - `FundsUnlockedAndTransferred` → Fill abgeschlossen, USDC an Buyer
  - `DepositMinConversionRateUpdated` → Spread-Änderung bestätigt
- **Bibliothek:** `ethers.js` v6 + `@zkp2p/contracts-v2`
- **Resilience:** Auto-Reconnect bei WebSocket-Disconnect, Fallback auf Polling

#### B) Revolut Webhook Server
- **Aufgabe:** Eingehende EUR-Zahlungen auf Revolut Business erkennen
- **Input:** Revolut Business API `TransactionCreated` Webhook
- **Output:** Event an Core Engine: "Fiat-Zahlung eingegangen"
- **Implementierung:** Express.js HTTP-Server auf Port 3100 (hinter VPS-Firewall)
- **Sicherheit:** Webhook-Signatur-Validierung (Revolut HMAC)
- **Fallback:** Polling `GET /transactions` alle 60 Sekunden falls Webhook ausfällt

#### C) Forex Poller
- **Aufgabe:** EUR/USD-Wechselkurs in Echtzeit tracken
- **Quellen (Fallback-Kette):**
  1. ECB Frankfurter API: `api.frankfurter.app/latest?from=EUR&to=USD` (kostenlos)
  2. ExchangeRate-API als Backup
- **Intervall:** Alle 5 Minuten
- **Output:** Aktueller EUR/USD-Kurs an Spread Engine

#### D) Order Manager
- **Aufgabe:** Alle Intents für unsere Deposits tracken
- **State Machine pro Intent:**
  ```
  SIGNALED → LOCKED → FULFILLED
                    → EXPIRED
                    → CANCELLED
  ```
- **Persistenz:** SQLite `orders` Tabelle
- **Berechnet:** Fill-Rate, durchschnittliche Fill-Time, Erfolgsquote

#### E) Spread Engine
- **Aufgabe:** Optimalen Spread berechnen und optional automatisch setzen
- **Inputs:**
  - Aktueller EUR/USD-Kurs (Forex Poller)
  - Fiat-Recycling-Kosten (konfigurierbar, z.B. 0,4% für Kraken)
  - Konkurrenz-Spreads (On-Chain: andere EUR/Revolut Deposits abfragen)
  - Ziel-Netto-Marge (konfigurierbar, z.B. 1,0%)
- **Formel:**
  ```
  optimal_spread = recycling_costs + target_margin + gas_buffer
  Beispiel: 0,4% + 1,0% + 0,1% = 1,5%
  ```
- **Modi:**
  - `manual` — Nur Empfehlung, keine Auto-Änderung
  - `auto` — Spread wird automatisch on-chain angepasst (erfordert Private Key)
- **Sicherheit:** Max-Spread-Limit und Min-Spread-Limit konfigurierbar

#### F) P&L Tracker
- **Aufgabe:** Gewinn/Verlust pro Zyklus und aggregiert berechnen
- **Zyklus-Definition:**
  ```
  1 Zyklus = Deposit USDC → Buyer-Fill → Fiat-Empfang → SEPA → CEX → USDC → Bridge → Deposit
  ```
- **Tracking pro Zyklus:**
  - USDC-Betrag verkauft
  - EUR-Betrag erhalten (aus Revolut-Webhook oder manuell)
  - Recycling-Kosten (CEX-Fee, Bridge-Gas)
  - Netto-Gewinn in EUR und USD
  - Annualisierte Rendite
- **Aggregationen:** Täglich, wöchentlich, monatlich, gesamt
- **Persistenz:** SQLite `cycles` Tabelle

#### G) Recycle Manager
- **Aufgabe:** Status des Fiat-Recycling-Loops tracken
- **State Machine:**
  ```
  FIAT_RECEIVED → SEPA_SENT → CEX_RECEIVED → USDC_BOUGHT → BRIDGED → DEPOSITED
  ```
- **Automatisierung:** Alerting bei jedem Schritt, manueller Trigger für den nächsten
- **Warum nicht voll-automatisch?** SEPA und CEX-Kauf erfordern manuelles Handeln (Sicherheit, Regulierung)

#### H) Alert Service
- **Kanäle:**
  - **Telegram:** Bot via `node-telegram-bot-api` — Primary
  - **Discord:** Webhook via `discord.js` oder einfacher HTTP POST
  - **Console:** Strukturierte Logs via `pino`
- **Alert-Typen:**

  | Event | Severity | Kanäle |
  |-------|----------|--------|
  | Neue Order (IntentSignaled) | INFO | Telegram, Discord |
  | Fill abgeschlossen | INFO | Telegram, Discord, Log |
  | Kapital unter Schwellenwert | WARN | Telegram, Discord |
  | Spread-Empfehlung geändert | INFO | Log |
  | Auto-Spread angepasst | WARN | Telegram, Log |
  | Revolut-Zahlung eingegangen | INFO | Telegram |
  | Recycling-Reminder | WARN | Telegram |
  | Fehler/Disconnect | ERROR | Telegram, Discord, Log |

#### I) REST API
- **Aufgabe:** Daten für externe Consumers bereitstellen (CLI, Web-Frontend, OpenClaw)
- **Framework:** Express.js oder Fastify
- **Endpoints:**

  | Method | Endpoint | Beschreibung |
  |--------|----------|--------------|
  | GET | `/api/status` | Aktuelle Deposit-Status, Balance, aktive Intents |
  | GET | `/api/pnl` | P&L Summary (Tag/Woche/Monat/Gesamt) |
  | GET | `/api/orders` | Letzte N Orders mit Status |
  | GET | `/api/spread` | Aktueller Spread + Empfehlung |
  | POST | `/api/spread` | Spread manuell setzen |
  | GET | `/api/recycle` | Recycling-Status |
  | POST | `/api/recycle/advance` | Recycling-Step manuell vorantreiben |
  | GET | `/api/config` | Aktuelle Konfiguration |

- **Auth:** API Key (einfacher Bearer Token, konfigurierbar)

#### J) CLI
- **Aufgabe:** Lokale Steuerung und Quick-Access
- **Framework:** `commander.js`
- **Commands:**
  ```
  peer-lp status              — Deposit-Status + Balance
  peer-lp pnl [--period 7d]   — P&L der letzten N Tage
  peer-lp spread              — Aktueller Spread + Empfehlung
  peer-lp spread set 1.5      — Spread auf 1.5% setzen
  peer-lp orders              — Letzte Orders
  peer-lp recycle             — Recycling-Status
  peer-lp deposit create      — Neuen Deposit erstellen
  peer-lp config              — Config anzeigen
  ```

---

## 5. Datenmodell

### 5.1 SQLite Schema

```sql
-- Deposits (unsere Escrow-Positionen)
CREATE TABLE deposits (
    id INTEGER PRIMARY KEY,
    deposit_id INTEGER NOT NULL,          -- On-Chain Deposit ID
    wallet_address TEXT NOT NULL,
    chain TEXT DEFAULT 'base',
    token TEXT DEFAULT 'USDC',
    amount_deposited REAL,                -- Gesamtbetrag eingezahlt
    amount_available REAL,                -- Aktuell verfügbar
    spread_percent REAL,                  -- Aktueller Spread in %
    payment_method TEXT,                  -- 'revolut', 'wise', etc.
    currency TEXT DEFAULT 'EUR',
    status TEXT DEFAULT 'active',         -- active, paused, closed
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Orders (Intents die unser Deposit betreffen)
CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    intent_hash TEXT UNIQUE NOT NULL,
    deposit_id INTEGER NOT NULL,
    buyer_address TEXT,
    usdc_amount REAL,                     -- USDC-Betrag
    fiat_amount REAL,                     -- Fiat-Betrag (berechnet)
    fiat_currency TEXT DEFAULT 'EUR',
    conversion_rate REAL,                 -- Rate zum Zeitpunkt
    status TEXT DEFAULT 'signaled',       -- signaled, locked, fulfilled, expired, cancelled
    signaled_at DATETIME,
    locked_at DATETIME,
    fulfilled_at DATETIME,
    fill_time_seconds INTEGER,            -- Dauer Signal → Fulfillment
    tx_hash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Zyklen (ein vollständiger Fiat-Recycling-Loop)
CREATE TABLE cycles (
    id INTEGER PRIMARY KEY,
    deposit_id INTEGER,
    usdc_sold REAL,                       -- USDC verkauft
    fiat_received REAL,                   -- EUR erhalten
    fiat_currency TEXT DEFAULT 'EUR',
    spread_earned_percent REAL,           -- Spread in %
    recycling_cost_percent REAL,          -- Kosten für Fiat → USDC
    net_profit_fiat REAL,                 -- Netto-Gewinn in EUR
    net_profit_usd REAL,                  -- Netto-Gewinn in USD
    eur_usd_rate REAL,                    -- EUR/USD zum Zeitpunkt
    status TEXT DEFAULT 'open',           -- open, fiat_received, sepa_sent, usdc_bought, deposited, closed
    started_at DATETIME,
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Revolut-Transaktionen (eingehende Zahlungen)
CREATE TABLE revolut_transactions (
    id INTEGER PRIMARY KEY,
    revolut_tx_id TEXT UNIQUE,
    amount REAL,
    currency TEXT,
    counterparty TEXT,
    reference TEXT,
    matched_order_id INTEGER,             -- Verknüpfung mit orders.id
    received_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (matched_order_id) REFERENCES orders(id)
);

-- Forex-Snapshots (Wechselkurs-Historie)
CREATE TABLE forex_snapshots (
    id INTEGER PRIMARY KEY,
    eur_usd REAL,
    source TEXT,                          -- 'ecb', 'exchangerate-api'
    captured_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Spread-History (alle Spread-Änderungen)
CREATE TABLE spread_history (
    id INTEGER PRIMARY KEY,
    deposit_id INTEGER,
    old_spread REAL,
    new_spread REAL,
    reason TEXT,                          -- 'manual', 'auto:forex', 'auto:competition'
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 5.2 Konfiguration (YAML)

```yaml
# config.yaml
version: 1

# Wallet & Chain
wallet:
  address: "0x..."
  # Private Key wird NICHT in Config gespeichert
  # Wird via Env-Variable PEER_LP_PRIVATE_KEY übergeben
chain:
  rpc_url: "https://mainnet.base.org"
  rpc_ws: "wss://base-mainnet.g.alchemy.com/v2/YOUR_KEY"  # Optional für WebSocket
  chain_id: 8453

# Peer Protocol
peer:
  escrow_address: "0x2f121CDDCA6d652f35e8B3E560f9760898888888"
  orchestrator_address: "0x88888883Ed048FF0a415271B28b2F52d431810D0"
  deposit_ids: [42]  # Eigene Deposit IDs
  payment_method: "revolut"
  currency: "EUR"

# Spread-Strategie
spread:
  mode: "manual"  # manual | auto
  target_margin_percent: 1.0
  recycling_cost_percent: 0.4
  gas_buffer_percent: 0.1
  min_spread_percent: 0.5
  max_spread_percent: 3.0
  auto_adjust_interval_minutes: 30

# Revolut Business API
revolut:
  enabled: true
  api_url: "https://b2b.revolut.com/api/1.0"
  webhook_port: 3100
  # Access/Refresh Token via Env: REVOLUT_ACCESS_TOKEN, REVOLUT_REFRESH_TOKEN

# Fiat-Recycling
recycling:
  cex: "kraken"  # kraken | coinbase
  cex_fee_percent: 0.26
  bridge_gas_usd: 0.05
  low_balance_threshold_usdc: 200
  reminder_interval_hours: 12

# Alerting
alerts:
  telegram:
    enabled: true
    bot_token_env: "TELEGRAM_BOT_TOKEN"
    chat_id_env: "TELEGRAM_CHAT_ID"
  discord:
    enabled: true
    webhook_url_env: "DISCORD_WEBHOOK_URL"
  console:
    enabled: true
    log_level: "info"  # debug | info | warn | error

# API Server
api:
  enabled: true
  port: 3200
  api_key_env: "PEER_LP_API_KEY"

# Database
database:
  path: "./data/peer-lp.db"
```

---

## 6. Tech Stack

| Komponente | Technologie | Begründung |
|------------|-------------|------------|
| **Runtime** | Node.js 20+ | Konsistent mit ZKP2P-Ökosystem (TypeScript) |
| **Sprache** | TypeScript 5+ | Type Safety, bessere Wartbarkeit |
| **On-Chain** | ethers.js v6 | Standard, gut dokumentiert |
| **Peer-Contracts** | @zkp2p/contracts-v2 | Offizielle ABIs, Adressen, Types |
| **HTTP Server** | Fastify | Schneller als Express, Schema-Validierung |
| **CLI** | commander.js | Standard für Node.js CLIs |
| **Datenbank** | better-sqlite3 | Zero-Config, serverless, schnell |
| **Telegram** | grammy | Moderner als node-telegram-bot-api |
| **Discord** | Einfacher HTTP POST | Kein Bot nötig, nur Webhook |
| **Logging** | pino | Schnell, strukturiert (JSON) |
| **Process Manager** | PM2 | Auto-Restart, Log-Rotation, Monitoring |
| **Scheduler** | node-cron | Für periodische Tasks (Forex, Cleanup) |
| **Config** | cosmiconfig + zod | YAML-Parsing + Schema-Validierung |
| **Testing** | vitest | Schnell, TypeScript-native |

---

## 7. Projektstruktur

```
peer-lp-bot/
├── src/
│   ├── index.ts                    # Entry Point (startet alle Services)
│   ├── config/
│   │   ├── schema.ts               # Zod-Schema für Config-Validierung
│   │   └── loader.ts               # Config laden + Env-Variablen mergen
│   ├── chain/
│   │   ├── listener.ts             # Base Event Listener
│   │   ├── escrow.ts               # Escrow-Contract Wrapper
│   │   └── orchestrator.ts         # Orchestrator-Contract Wrapper
│   ├── revolut/
│   │   ├── webhook.ts              # Webhook-Server für eingehende Zahlungen
│   │   ├── client.ts               # Revolut API Client
│   │   └── matcher.ts              # Revolut TX ↔ Peer Order Matching
│   ├── engine/
│   │   ├── order-manager.ts        # Order State Machine
│   │   ├── spread-engine.ts        # Spread-Berechnung + Auto-Adjust
│   │   ├── pnl-tracker.ts          # P&L pro Zyklus + Aggregation
│   │   └── recycle-manager.ts      # Fiat-Loop State Machine
│   ├── forex/
│   │   └── poller.ts               # EUR/USD Kurs-Poller
│   ├── alerts/
│   │   ├── telegram.ts             # Telegram Bot
│   │   ├── discord.ts              # Discord Webhook
│   │   └── console.ts              # Console/Log Output
│   ├── api/
│   │   ├── server.ts               # Fastify REST API
│   │   └── routes/
│   │       ├── status.ts
│   │       ├── pnl.ts
│   │       ├── orders.ts
│   │       ├── spread.ts
│   │       └── recycle.ts
│   ├── cli/
│   │   └── index.ts                # CLI Commands
│   ├── db/
│   │   ├── connection.ts           # SQLite-Verbindung
│   │   ├── migrations.ts           # Schema-Migrations
│   │   └── queries.ts              # Prepared Statements
│   └── utils/
│       ├── logger.ts               # Pino-Logger Setup
│       ├── formatting.ts           # USD/EUR Formatierung
│       └── retry.ts                # Retry-Logic für RPC-Calls
├── config.yaml                     # User-Konfiguration
├── .env.example                    # Env-Variablen Template
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── Dockerfile                      # Optional: Container-Deployment
├── ecosystem.config.js             # PM2-Konfiguration
└── README.md
```

---

## 8. Sicherheitskonzept

| Risiko | Maßnahme |
|--------|----------|
| **Private Key Exposure** | Wird NUR als Env-Variable geladen, nie in Config/DB/Logs gespeichert |
| **Revolut Token Theft** | Tokens als Env-Variablen, Webhook-Signatur-Validierung |
| **API-Zugang** | Bearer Token Auth, nur localhost oder VPN |
| **SQLite Injection** | Prepared Statements, kein Raw SQL |
| **Spread Manipulation** | Min/Max-Spread-Limits, Rate-Limiting auf Auto-Adjust |
| **RPC-Kosten** | Polling-Intervall konfigurierbar, nicht unter 2 Sekunden |
| **Webhook Replay** | Idempotency via Revolut TX ID Deduplizierung |

---

## 9. Entwicklungsphasen

### Phase 1: Foundation (Woche 1–2)
**Ziel:** Bot läuft, überwacht und alarmiert.

- [ ] Projekt-Setup (TypeScript, ESLint, Vitest)
- [ ] Config-Loader (YAML + Env + Zod-Validierung)
- [ ] SQLite-Schema + Migrations
- [ ] Chain Listener (Escrow + Orchestrator Events)
- [ ] Order Manager (State Machine)
- [ ] Alert Service (Telegram + Console)
- [ ] CLI: `status`, `orders`
- [ ] PM2-Setup für VPS

**Deliverable:** Bot läuft 24/7, trackt alle Orders, sendet Telegram-Alerts bei neuen Fills.

### Phase 2: Intelligence (Woche 3–4)
**Ziel:** Spread-Optimierung und P&L-Tracking.

- [ ] Forex Poller (ECB API)
- [ ] Spread Engine (Berechnung + Manual Mode)
- [ ] P&L Tracker (Zyklen-Buchhaltung)
- [ ] CLI: `pnl`, `spread`, `spread set`
- [ ] REST API (Status, P&L, Orders, Spread)
- [ ] Discord-Alerts

**Deliverable:** Bot empfiehlt optimale Spreads, trackt P&L pro Zyklus.

### Phase 3: Integration (Woche 5–6)
**Ziel:** Revolut-Anbindung und Fiat-Loop-Tracking.

- [ ] Revolut Business API Client
- [ ] Revolut Webhook Server
- [ ] Revolut TX ↔ Peer Order Matching
- [ ] Recycle Manager (State Machine)
- [ ] CLI: `recycle`
- [ ] Alert: Recycling-Reminders

**Deliverable:** Bot erkennt Fiat-Eingänge, trackt den gesamten Recycling-Loop.

### Phase 4: Automation (Woche 7–8)
**Ziel:** Auto-Spread und Escrow-Management.

- [ ] Spread Engine Auto-Mode (On-Chain TX)
- [ ] Escrow Manager (Deposit erstellen, Funds hinzufügen/abziehen)
- [ ] CLI: `deposit create`, `deposit add-funds`
- [ ] Multi-Deposit-Support
- [ ] Konkurrenz-Spread-Analyse (andere EUR-Deposits on-chain lesen)

**Deliverable:** Bot passt Spreads automatisch an und kann Deposits programmatisch verwalten.

### Phase 5: Polish (Woche 9–10)
**Ziel:** Multi-User, Docs, Open-Source-Readiness.

- [ ] Multi-User Config (mehrere Wallets/Deposits)
- [ ] Dockerfile + Docker Compose
- [ ] README.md mit Setup-Guide
- [ ] Unit Tests (>70% Coverage auf Core Engine)
- [ ] Security Review
- [ ] License (MIT)

**Deliverable:** Projekt ist open-source-ready.

---

## 10. Infrastruktur & Kosten

| Komponente | Kosten/Monat |
|------------|-------------|
| **VPS** (bestehend) | $0 (bereits vorhanden) |
| **Base RPC** (Alchemy Free) | $0 (300M Compute Units/Monat) |
| **Revolut Business Freelancer** | €0 |
| **Telegram Bot** | $0 |
| **ECB Frankfurter API** | $0 |
| **Domain** (optional) | $0 |
| **Gesamt** | **$0/Monat** |

---

## 11. Risiken & Mitigations

| Risiko | Wahrscheinlichkeit | Impact | Mitigation |
|--------|---------------------|--------|-----------|
| Peer-Protokoll wird gehackt | Niedrig | Hoch | Nur $1K-$2K einsetzen, Deposit-Limits |
| Revolut sperrt Account (P2P-Verdacht) | Mittel | Hoch | Volumen langsam steigern, Business-Account |
| ZKP2P Contract-Upgrade bricht ABI | Mittel | Mittel | ABI-Version pinnen, Monitoring auf Contract-Changes |
| Base RPC Downtime | Niedrig | Mittel | Fallback-RPC konfigurierbar |
| EUR/USD Kursrisiko | Mittel | Niedrig | Kurze Zyklusdauer (<3 Tage) minimiert Exposure |
| Revolut 90-Tage Token-Refresh | Sicher | Niedrig | Kalender-Reminder, Alert 7 Tage vorher |

---

## 12. Entscheidungen (APPROVED)

| # | Frage | Entscheidung |
|---|-------|-------------|
| 1 | Repo-Struktur | **Monorepo** |
| 2 | OpenClaw Skill Integration | **Ja, später** (nach Phase 5) |
| 3 | Auto-Spread Priorität | **Phase 4** |
| 4 | Repo Sichtbarkeit | **Private** (Open Source nach Phase 5) |
| 5 | Projektname | **Peer LP Assistant Bot** |

---

## 13. Abgrenzung (Out of Scope)

- **Kein Trading-Bot:** Der Bot handelt nicht selbstständig, er optimiert und überwacht
- **Kein CEX-Integration:** SEPA-Überweisungen und CEX-Käufe bleiben manuell
- **Kein eigenes Frontend:** REST API für zukünftiges Frontend, aber kein Web-UI in v1
- **Kein Multi-Chain:** Nur Base in v1 (Peer's Haupt-Chain)
- **Kein Fiat-Automatisierung:** Bot initiiert keine Fiat-Zahlungen, nur Monitoring
