# ARCH — матриця «документ ↔ код ↔ тест» (baseline main@bcead3a)

Статуси: **РТ** реалізовано й протестовано · **РБ** реалізовано без тесту (для app) · **Ч** частково · **НР** не реалізовано · **С** код суперечить документу. Шляхи відносно `prototype/`. Деталі й докази — `claims.json` (ARCH-Cxxx), `findings.json` (ARCH-Fxxx).

## Модель даних (data-model.md ↔ SQL)
| Твердження | Реалізація | Тест | Статус |
|---|---|---|---|
| 22 логічні сутності як таблиці | db/migrations/001-initial.sql | app.test.ts:35 | РТ |
| IdentityLink: один активний verified token → одна особа; перетин відхиляється (insert і update) | 001:9–15 | app.test.ts:114–118 | РТ |
| UnitAssignment: конфліктні перетини не застосовуються | 001:21–26 | app.test.ts:116–118 | РТ |
| AccessGrant: scope або case, або unit; роль із CHECK | 001:33–40 | опосередковано | РБ |
| WoundCase: unique підтверджений incident; різні поранення однієї особи дозволені | 001:32 | app.test.ts:119, 126–130 | РТ |
| InboxEvent: два унікальні ключі; відхилений body не зберігається | 001:46–52; store.ts:106, 118 | app.test.ts:66–84 | РТ |
| InboxEvent: source_order для порядку | лише запис store.ts:118 | — | НР (F010) |
| CaseEvent незмінний; supersedes_id для виправлень | 001:128–129; supersedes_id не заповнюється | app.test.ts:111 (аудит), події — ні | Ч (F010) |
| RuleVersion: версія правила визначає інтервал/чинність | інтервали зашиті domain.ts:45, 83 | — | С (F010) |
| CaseRequirement: незмінний склад ревізії пакета | 001:78–79 | app.test.ts:112 | РТ |
| CaseRequirement.status | seed; далі не оновлюється, views.ts ігнорує | — | НР (F020) |
| RequirementEvidence: M:N, збіг case_id обох сторін | 001:80–85 | app.test.ts:106 | РТ |
| DocumentRef: unique case+source+record+version; supersedes у межах кейсу | 001:71–77; domain.ts:30–35 | workflow.test.ts:85–93 | РТ |
| Delivery: квитанція на версію+адресата; received потребує дати й доказу | 001:86–90; domain.ts:119–131 | workflow.test.ts:85–93, 182 | РТ |
| Deadline: due лише за confirmed+applicable; unique правило/кейс | 001:91–100 | app.test.ts:39, 107–108 | РТ |
| Task: unique trigger+kind+owner; повтор не множить | 001:101–105; domain.ts:13 | workflow.test.ts:46, 141–146 | РТ (але не відкривається повторно — F001/F006) |
| FinancialTrack: вид+період unique; виконання потребує execution_ref | 001:106–112 | app.test.ts:110; workflow.test.ts:107–116 | РТ |
| Фінансові стани accrued/executed | у коді execution_partial/execution_confirmed | — | С (F013) |
| SupportRequest: звернення родини без гранта | domain.ts:205 | workflow.test.ts:58–59 | РТ |
| ReviewItem: рішення уповноваженої особи аудитується | лише missing_incident: domain.ts:209–215 | workflow.test.ts:61–68 | Ч (F002) |
| AuditEntry append-only; без секретів | 001:122–127; store.ts:58–61 | app.test.ts:111, 138 | РТ |
| Outbox атомарно з доменом; unique destination+key | domain.ts:18, 175, 216 | app.test.ts:76, 88–90 | РТ |
| Outbox: обмежені повтори, next_attempt_at | немає шляху помилки | — | НР (F010) |
| StaffCapacity / WorkLog як джерело BO-6 | таблиці не читаються | — | С (F017) |
| Таблиці 002 (source_cursor, incident_link, demo_command, route_packet, analytics_snapshot, demo_setting) | 002-workflow.sql | workflow.test.ts | недокументовано (F013) |

## Контракт подій (event-contract.md ↔ event.schema.json ↔ код)
| Твердження | Реалізація | Тест | Статус |
|---|---|---|---|
| Конверт case-event/1, строгий allowlist на тип | security/event.schema.json (19 типів) | workflow.test.ts:32–36; security.test.ts:113–126 | РТ |
| HMAC над сирими байтами + ts + nonce до parse | security/core.ts:88–110 | security.test.ts:98–106 (harness), app.test.ts:66–78 | РТ |
| Політика джерело→тип/вид/одержувач | core.ts:80–87, 119–128 | security.test.ts:107–112, 147–160; workflow.test.ts:123 | РТ |
| Приймання лише після стійкого запису; 202 ≠ виконання | store.ts:99–136 | app.test.ts:66–78, 85–91 | РТ; виняток F003 (503 і втрата inbox) |
| Ідемпотентність за двома ключами; інший digest → конфлікт | store.ts:105–115 | app.test.ts:66–84 | РТ; повтор конфлікту множить review (F007) |
| Порядок: source_order у межах stream | не використовується; cursor+supersedes_version domain.ts:62–63 | app.test.ts:82 (opaque version → review) | С (F010) |
| Старіша подія не відкочує стан; невідомий порядок → reconciliation | pending_review без повторної обробки | workflow.test.ts:87 (лише факт pending) | Ч (F002) |
| Транзакція inbox→CaseEvent→стан→аудит→outbox | store.ts:100–135; domain.ts:180–218 | app.test.ts:85–91; workflow.test.ts:125–127 | РТ |
| Optimistic revision кейсу | лише інкремент domain.ts:174 | — | НР |
| Виправлення посилається на стару версію; квитанція не переноситься | domain.ts:104–108 | workflow.test.ts:91 | РТ |
| Backoff із лімітом, далі оператор | — | — | НР (F010) |
| Тиша джерела: freshness + задача + звірка | source.sync_gap / команда gap | workflow.test.ts:117–120 | Ч (F009) |
| Команди з ключем і digest; права перед повторною відповіддю | domain.ts:181–186 | workflow.test.ts:102–105 | РТ |
| Перелік API і назв команд | app.ts:58–133 | — | С (F013) |
| Відкликання/передача scope — fixtures з аудитом | немає | — | НР (F018) |

## RBAC (rbac.md ↔ сервер)
| Твердження | Реалізація | Тест | Статус |
|---|---|---|---|
| Контекст із серверної сесії; перевірка на кожний запит і повтор | server/app.ts:27–34; store.ts:62–74; domain.ts:181 | app.test.ts:43–47; workflow.test.ts:100–106 | РТ |
| Боєць: лише свій кейс | store.ts:70; core.ts:29–33 | app.test.ts:45, 130 | РТ |
| Командир: 403 на clinical-document; DTO без клінічних refs | core.ts:30; store.ts:75–94 | app.test.ts:48–55 | РТ |
| Командир/супровід: різні проєкції за матрицею | один DTO; finances/checklist порожні; careDeadline присутній | app.test.ts:51 закріплює порожнечу | С (F011) |
| Супровід не видає/не направляє | domain.ts:182–183 | workflow.test.ts:101 | РТ |
| Командир ≠ супровід за діями | командир має всі дії супроводу | — | Ч (F011) |
| Аналітик: лише агрегати; кейси → 403 | app.ts:131; core.ts:31 | app.test.ts:102–103; workflow.test.ts:136 | РТ |
| Dev: лише симулятор; не читає кейси | app.ts:102, 110, 115, 132 | app.test.ts:63–64, 92–97 | РТ |
| Звернення родини не дає доступу; гайд без сесії | domain.ts:205; app.ts:73 | workflow.test.ts:58–59 | РТ |
| Чужий/відсутній кейс → 404 | core.ts:32 | app.test.ts:45, 53 | РТ |
| Відмови в аудиті | app.ts:137 | лише harness security.test.ts:136–146 | РБ (F012) |
| Source keys не потрапляють у браузер | app.ts:103–106; ui/main.tsx | перевірка бандла (аудит), app.test.ts:138 (аудит) | РТ |
| Dev-режим як умова доступності demo endpoint | прапорця немає | — | НР |

## Сесії, CSRF, ліміти, заголовки, помилки
| Твердження | Реалізація | Тест | Статус |
|---|---|---|---|
| Токен як hash, HttpOnly, SameSite=Strict, TTL 15 хв, ротація | app.ts:39–48 | app.test.ts:56–65 | РТ |
| CSRF + точний Origin на POST | app.ts:80–82 | app.test.ts:58–59 | РТ; plaintext CSRF у БД (F015) |
| Host/loopback; query відхиляється | app.ts:53–54 | app.test.ts:60–61 | РТ |
| Ліміти 60/30 за хв, 1000 bucket | app.ts:23, 72, 80; core.ts:39–51 | лише harness security.test.ts:127–135 | РБ (F012, F014) |
| Body ≤ 16 KiB, лише JSON | security/protocol.ts:12–18 | лише harness security.test.ts:121–126 | РБ |
| Заголовки безпеки на всіх відповідях | core.ts:16–23; app.ts:36, 69 | app.test.ts:137 (лише script-src) | РБ |
| Generic errors без деталей | app.ts:135–138 | app.test.ts:99 (400), 88 (503) | РТ |
| Аудит-збій → 503, без фіналізації | app.ts:137; store.ts:56 | app.test.ts:85–91; workflow.test.ts:125 | РТ |

## Симулятор, аналітика, статуси
| Твердження | Реалізація | Тест | Статус |
|---|---|---|---|
| Лише фіксовані події, той самий шлюз | app.ts:98–107, 114–120; fixtures.ts | app.test.ts:92–97; workflow.test.ts:121–124 | РТ |
| Без прямих змін БД | /api/demo/analytics змінює demo_setting | workflow.test.ts:137 | Ч (F018) |
| Окрема фіксована когорта; D1 не змінює агрегати | metrics.ts:4–10; store.ts:48–49 | workflow.test.ts:135–139 | РТ |
| Формули, знаменники, покриття, невідомі | metrics.ts:15–27 | workflow.test.ts:128–134 | РТ |
| Нульовий знаменник → «Недостатньо даних» | metrics.ts:11, 14 | workflow.test.ts:130 | РТ |
| Малі й доповнювальні групи; покриття приховано | metrics.ts:13–14; core.ts:147–152 | workflow.test.ts:131–133 | РТ; зауваги F017 |
| Складено/видано/надіслано/отримано окремо | domain.ts:98–131; views.ts:25–26 | workflow.test.ts:85–93 | РТ |
| Нова версія не успадковує квитанцію адресата | domain.ts:107; delivery за document_ref | workflow.test.ts:91 | РТ |
| Постанова ≠ виконання; виконання лише за чинною постановою | domain.ts:147–156 | workflow.test.ts:152–155, 164–174 | Ч (F004) |
| Підтверджений строк не змінюється пізнішими подіями | domain.ts:124–130 | workflow.test.ts:182–193 | Ч (F001, F005) |
