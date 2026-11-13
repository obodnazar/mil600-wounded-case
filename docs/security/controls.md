# Контролі, параметри й докази

**2026-11-13 · локальне синтетичне ядро; не завершений MVP.** Код — [core.ts](../../prototype/security/core.ts), [HTTP adapter](../../prototype/security/server.ts), [машинна схема](../../prototype/security/event.schema.json), [негативні тести](../../prototype/security/security.test.ts), [CI](../../.github/workflows/security.yml). Немає публічного deployment або реальних інтеграцій.

## Каталог контролів

| ID | Реалізовано / доказ | Що ще обов’язково |
|---|---|---|
| K01 Серверний доступ | Trusted session map; роль / case scope / validity / revocation перевіряються кожного разу. 403 клініці командиру / супроводу; 404 чужому й відсутньому case; explicit DTO не повертає клінічний body / ref. HTTP-тести, включно з header / query role injection | У 8а під’єднати до кожного нового handler / команди / документа; SSO / cookie / CSRF — ще не реалізовані |
| K02 Автентичний транспорт | HMAC-SHA256 над точними байтами й метаданими; timingSafeEqual після перевірки довжини / hex; timestamp / nonce; тип + source namespace + subject scope + payload authority | Стійкий nonce-store й ротація / revocation source key до реальних джерел; HMAC не КЕП і не доказ медичної істини |
| K03 Схема й повтор | JSON Schema draft-07, AJV strict / date formats, 17 дозволених типів. additionalProperties=false на всіх object-рівнях; немає клінічного тексту / arbitrary URL / base64 / grants. Канонічний digest, id / revision duplicate vs conflict | У 8а durable inbox / transaction / unique keys / ReviewItem; зараз business_applied=false |
| K04 Обмеження ресурсів | 16 KiB body, timeout / частота / bounded maps; 413 / 429; не довіряємо X-Forwarded-For. Контроль до parse / приймання | NAT / ботнет / reverse proxy / distributed limiter — окремо, не вирішуються IP-лімітом одного процесу |
| K05 Безпечна HTTP-відповідь | CSP default-src / object-src / frame-ancestors / base-uri / form-action none; nosniff, no-referrer, no-store, Permissions-Policy, CORP; немає cross-origin API. Generic errors без stack / input | CSP майбутнього UI потребує окремого self / nonce дизайну; HTTPS / HSTS, cookie flags, browser e2e ще до публічного доступу |
| K06 Аудит / мінімізація | Структурний allowlist JSONL; actor / resource HMAC-теги, UTC, action / outcome / random request ID; FileAudit mode 0600 + fsync. Невдалий аудит → 503, не витік даних. Запити з query / Origin теж аудіюються | Теги — псевдоніми, не анонімність. Захист від локального власника, відокремлений append-only аудит, retention / rotation / alerts ще R09 |
| K07 OPSEC guard | Fixed synthetic snapshot; мінімум 5. Якщо одна мала клітинка — suppressed для всіх і total. Без довільних фільтрів / порога від клієнта / рядків людей | Повні BO / когорта в 8б; реальні пороги / часові віднімання / затримка / OPSEC-допуск [TBD] |
| K08 Секрети / demo mode | Env helper відхиляє відсутні / слабкі / однакові ключі й NODE_ENV=production; у тестах randomBytes. Factory перевіряє довжину / ізоляцію ключів; environment=synthetic-test. Немає секретів у bundle / repo | Обов’язкове використання helper / secret manager при складанні app у 8а. Runtime injection у тесті не є production SSO |
| K09 CI / supply chain | npm ci --ignore-scripts, strict build, ESLint, tests, audit high+, CodeQL, gitleaks. Actions pinned до перевірених commit SHA; contents read за замовчуванням, security-events write тільки CodeQL, без deployment / pull_request_target / PR-comments | Кожний новий head має повторно пройти CI. Lockfile / scans не гарантують відсутності всіх вразливостей |
| K10 Правдива координація | ADR 0006 / TO BE: основна еПМК, адмінрезерв; confirmed / estimated / unknown, без санкцій; довідка про обставини травми (додаток 5 до Наказу №402) складається начальником медслужби, видається командиром | Runtime-календар, підтвердження одержання й D1 — у 8б; security endpoint не застосовує бізнес-рішень |

## Точний транспортний протокол демо

`POST /api/integration/events`, Content-Type **application/json**, без content-encoding, query або Origin. Власний контракт `case-event/1`, не API установ. Підпис hex lowercase SHA256 у `X-Signature`; `X-Key-Id` вибирає серверний source key; `X-Timestamp` — десятизначні Unix seconds; `X-Nonce` — 16–80 ASCII символів `[A-Za-z0-9_-]`, джерело генерує випадковий nonce. Не передавати ключ у запиті.

Байти підпису, `\n` означає один LF:

```text
key_id\nPOST\n/api/integration/events\ntimestamp\nnonce\n<raw UTF-8 body bytes>
```

Метод, шлях і key ID включені: підпис не переноситься на інший endpoint / identity. Перевірка HMAC перед JSON parse, потім сувора схема й дозволи джерела. `demo-mis` не стає фінансовим органом навіть за помилково широкого локального списку типів. Документні kind / recipient_kind перевіряються окремо; квитанція ВЛК не стає отриманням військовослужбовцем.

Повтор того самого nonce в межах вікна → 409 `transport_replay`. Допустимий повтор доставки — нові timestamp / nonce, той самий event_id / семантика. Digest не залежить від порядку ключів JSON, transport metadata чи event_id; однаковий logical revision із новим ID лишається дублікатом, змінений зміст — 409 `event_conflict`. Opaque source_version не сортується як число; визначення старшинства / ручний ReviewItem — доменна інтеграція, ще не реалізована.

Ledger у пам’яті є bounded **тільки для перевірки безпеки одного запуску**. На restart він зникає; це не виконання вимоги durable inbox. Відповідь 200 `validated_only` / `duplicate`, `business_applied=false`; **жодного 202 accepted, задачі, виплати чи зміни статусу**. До доменних ефектів 8а мусить забезпечити транзакцію за ADR 0003.

## Демо-параметри — рішення для затвердження

| Параметр | Значення | Чому / перевірка |
|---|---|---|
| Вікно timestamp | ±300 секунд, включна межа | Інженерний вибір; stale / future / boundary тести, не строк із закону |
| Утримання nonce | 601 секунда від валідації | Покриває майбутній timestamp + включну межу, із запасом; після restart не стійке |
| Ключі | Мінімум 32 bytes, окремі джерельні / audit ключі | Hex64 у env helper; randomBytes у тестах; немає статичного demo-секрету |
| Body | Максимум 16 384 bytes | До JSON parse; понад ліміт 413 |
| Частота | Читання 60 / хв, ingress 30 / хв на socket peer | Default параметри, не реальний capacity / SLA; не довіряємо proxy headers |
| Лімітер / ledger | До 1000 active IP buckets, 1000 event IDs / transport nonces | При заповненні fail closed; немає eviction активного bucket для обходу |
| HTTP timeout | headers 3 s, request 5 s, keep-alive 1 s | Локальний test adapter, не рекомендована конфігурація всіх реальних каналів |
| Аналітика | min_group_size 5, fixed synthetic snapshot | Малі / порожні / доповнювальні групи не розкривають total; не доказ анонімності |
| Тестова сесія | Fixtures із 15-хвилинним строком, перевірка гранта кожного разу | Не production SSO / політика тривалості сесії установи |

Параметри не є новим скороченням F / AC; перед UI / integration повторити їх на реальному способі запуску в 8а. Публічний сервер не запущений, HTTP у тестах лише `127.0.0.1` на випадковому порту. HTTPS / HSTS не оголошені реалізованими через сам заголовок.

## Інвентар журналювання

Єдиний application audit — захищений локальний JSONL шлях, який задає довірений harness; у tests це тимчасова папка, видаляється після закриття сервера. Поля: UTC at, random request_id, action, result, actor_tag, resource_tag. Немає ПІБ, діагнозу, IP, query, raw body, source response, bearer / HMAC key чи довільного Error.message. Код не викликає console з вхідними даними; HTTP-помилки лише фіксовані коди. CI містить назви синтетичних тестів / результати, без runtime-ключів.

Ключі псевдонімізації аудиту й source HMAC різні. Аудит не є нормативним підписом, неспростовним доказом або анонімними даними; локальний власник процесу може змінити файл. Реальні строки / доступ аудитора / retention і відокремлений захищений запис — перед production, не вигадані у студентському PR.

## Перевірки

`npm ci --ignore-scripts`, `npm run lint`, `npm test`, `npm run build`, `npm audit --audit-level=high` з каталогу prototype. Тести піднімають справжній локальний HTTP adapter й перевіряють API, файли аудиту та граничні випадки. Фактичний підсумок і head CI — у [рев’ю](../reviews/phase-7.md); сам YAML не є доказом зеленого CI. В [реєстрі](risk-register.md) статус не підміняє майбутній end-to-end тест чотирьох панелей.

Знайдений у dev-tree minimatch ReDoS усунено override **11.0.1**; lint / тести перевіряють сумісність. Джерело — [GitHub Advisory GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), публ. 2026-10-27, оновлено 2026-11-04; картку відкрито й перевірено через npm audit 2026-11-13. Це не runtime-вразливість пацієнтського endpoint; ігнорувати всі moderate або запускати audit fix --force не обирали.

## Технічні першоджерела

- [Node crypto](https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b): документація без окремої дати публікації, перев. 2026-11-13. timingSafeEqual не робить увесь surrounding code constant-time; такого твердження немає.
- [GitHub CodeQL workflow](https://docs.github.com/en/code-security/reference/code-scanning/workflow-configuration-options) і [gitleaks-action](https://github.com/gitleaks/gitleaks-action): дати публікації на прочитаних сторінках не вказані, перев. 2026-11-13. Для CI обрано Node24-compatible gitleaks-action v3; автоматичні PR-comments / повідомлення / завантаження secret artifacts вимкнені. GitHub_TOKEN — стандартний job token, не секрет у файлі.
- SHA action tag refs / annotated tags звірені через офіційний GitHub API 2026-11-13; повні commit pins у workflow. Офіційний gitleaks 8.30.1 для локальної перевірки завантажено в tmp з перевіркою SHA256 за release checksums; глобального встановлення немає.
