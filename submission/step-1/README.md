# Здача кроку I (15.11.2026, 23:59, Moodle)

Що завантажити (один учасник від команди):

| Файл | Що це |
|---|---|
| `MIL600-krok-1-kejs-poranennia.pdf` | Основний документ: склад команди, BRD (шапка, Executive Summary, цілі й метрики, стейкхолдери), AS IS з поясненням і схемою (A3), примітка про ШІ, джерела |
| `as-is.bpmn` | Схема AS IS у BPMN 2.0 XML (відкривається в bpmn.io або Camunda Modeler) |
| `as-is.png` | Та сама схема зображенням |

`as-is.svg` — векторна копія для перегляду в браузері. Джерело PDF — `krok-1.html`; перегенерація з кореня репозиторію:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node scripts/render-step-1.mjs
```

Текст стиснуто з `docs/01-problem.md`, `docs/02-brd.md`, `docs/03-as-is.md` і `docs/ai-use.md`; при розбіжності чинними є ці документи. Схема — копія `docs/bpmn/as-is.*`.
