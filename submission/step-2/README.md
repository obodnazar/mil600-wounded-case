# Здача кроку II (29.11.2026, 23:59, Moodle)

Що завантажити (один учасник від команди):

| Файл | Що це |
|---|---|
| `MIL600-krok-2-kejs-poranennia.pdf` | Основний документ: TO-BE (4 питання до кроків AS IS і схема), PRD з 13 розділів, UI/UX (екрани прототипу й сценарій), ентерпрайз-архітектура, примітка про ШІ, джерела |
| `to-be-overview.bpmn` | Схема TO-BE у BPMN 2.0 XML (bpmn.io / Camunda Modeler): хто робить кожен крок — людина, система чи уповноважена особа |
| `to-be-detailed.bpmn` | Детальна TO-BE: огляд і сім площин із винятками, повторами й конфліктами |
| `prototype-boyets-komandyr.html` | Клікабельний сценарій «боєць — командир»: відкрити в браузері, без встановлення |
| `to-be-overview.png`, `enterprise-architecture.png` | Схеми зображеннями |

Прототип: папка `prototype/` репозиторію, запуск `npm ci --ignore-scripts && npm run dev`, адреса http://127.0.0.1:4317.

Джерело PDF — `krok-2.html`; перегенерація з кореня репозиторію:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node scripts/render-step-2.mjs
```
