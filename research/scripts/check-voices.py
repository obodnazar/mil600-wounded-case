#!/usr/bin/env python3
"""Локальна перевірка реєстру, частот, цитування та посилань фази 2."""

from collections import Counter, defaultdict
from datetime import date, datetime
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[2]
RESEARCH = ROOT / "research"
CHANGED_MARKDOWN = (
    "README.md", "docs/ai-use.md", "docs/decisions.md",
    "docs/reviews/phase-2.md", "research/voices.md",
    "research/pain-map.md", "research/voices-method.md",
)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def normalized(value):
    return " ".join(value.split())


def cells(line):
    return [part.strip().replace(r"\|", "|")
            for part in re.split(r"(?<!\\)\|", line)[1:-1]]


def anchors(text):
    found = set(re.findall(r'<a name="([^"]+)"', text))
    for heading in re.findall(r"^#{1,6} (.+)$", text, re.M):
        slug = re.sub(r"[^\w\- ]", "", heading.lower()).replace(" ", "-")
        found.add(slug)
    return found


def main():
    coding = json.loads((RESEARCH / "voices-coding.json").read_text())
    records = coding["records"]
    checked = date.fromisoformat(coding["checked_at"])
    cutoff = checked.replace(year=checked.year - 1)
    by_id = {record["id"]: record for record in records}
    require(len(by_id) == len(records) >= 40, "Менше 40 або повторюються ID")
    require(set(by_id) == {f"Q{i:02}" for i in range(1, len(records) + 1)},
            "Непослідовні ID")

    voice_text = (RESEARCH / "voices.md").read_text()
    quotes = {}
    source_words = Counter()
    historical_section = False
    seen = set()
    for line in voice_text.splitlines():
        if line.startswith("## Додаток — історичні"):
            historical_section = True
        match = re.match(r'\| <a name="(q\d+)"></a>(Q\d+) \|', line)
        if not match:
            continue
        row = cells(line)
        require(len(row) == 8, f"Невірна кількість колонок: {match[2]}")
        key = match[2]
        require(key in by_id and key not in seen, f"Зайвий / повторний рядок {key}")
        require(match[1] == key.lower(), f"Помилка якоря {key}")
        seen.add(key)
        record = by_id[key]
        require(row[1].startswith("«") and row[1].endswith("»"), f"Лапки {key}")
        quote = normalized(row[1][1:-1])
        quotes[key] = quote
        require(hashlib.sha256(quote.encode()).hexdigest() == record["quote_sha256"],
                f"Цитата змінилася: {key}")
        require(len(quote.split()) <= 25, f"Завелика цитата: {key}")
        source_words[record["source_group"]] += len(quote.split())
        require(record["url"] in row[3] and row[4].startswith(record["published_at"]),
                f"Джерело / дата не збігається: {key}")
        require(row[5].startswith(record["cluster"] + " ·"), f"Код теми {key}")
        require(record["historical"] == historical_section, f"Часовий розділ {key}")
        pub = date.fromisoformat(record["published_at"])
        require(pub <= checked and record["checked_at"] == checked.isoformat(),
                f"Майбутня дата / інший зріз: {key}")
        expected_old = pub < cutoff or key == "Q33"
        require(record["historical"] == expected_old, f"Вік свідчення {key}")
        require(urlsplit(record["url"]).scheme == "https", f"URL {key}")
        require(not {"quote", "name", "nickname", "author_id"}.intersection(record),
                f"Зайві ідентифікаційні поля / повтор цитати: {key}")
        if "source_timestamp" in record:
            local_date = datetime.fromisoformat(record["source_timestamp"]).astimezone(
                ZoneInfo("Europe/Kyiv")).date()
            require(local_date == pub, f"Часовий пояс RSS {key}")
            require("RSS" in record["date_kind"], f"Тип дати RSS {key}")
    require(seen == set(by_id), "Не всі записи кодування мають рядок")

    pain = (RESEARCH / "pain-map.md").read_text()
    # Короткі повторні уривки також споживають ліміт джерела.
    fragments = re.findall(r"«([^»]+)» — \[(Q\d+)\]\(voices\.md#q\d+\)", pain)
    for fragment, key in fragments:
        require(key in quotes and normalized(fragment) in quotes[key],
                f"Уривок карти не збігається з цитатою {key}")
        source_words[by_id[key]["source_group"]] += len(fragment.split())
    require(len(fragments) == 8, "Змінився склад уривків: перевірте ліміт вручну")
    require(all(count <= 25 for count in source_words.values()),
            f"Сумарний ліміт джерела: {dict(source_words)}")

    strata = {}
    for label, old in (("recent", False), ("historical", True)):
        block = re.search(rf"<!-- counts:{label} -->(.*?)<!-- /counts:{label} -->",
                          pain, re.S)
        require(block is not None, f"Немає таблиці {label}")
        expected = defaultdict(set)
        for record in records:
            if record["historical"] == old:
                expected[record["cluster"]].add(record["id"])
        found = {}
        for line in block[1].splitlines():
            if not re.match(r"\| (?:C[1-6]|P0) \|", line):
                continue
            row = cells(line)
            count_column, ids_column = (2, 3) if label == "recent" else (1, 2)
            ids = set(re.findall(r"Q\d+", row[ids_column]))
            count = int(row[count_column])
            require(row[0] not in found, f"Повтор кластера {label}")
            require(count == len(ids) and ids == expected[row[0]],
                    f"Частоти / ID {label} {row[0]}")
            found[row[0]] = count
        require(set(found) == {"C1", "C2", "C3", "C4", "C5", "C6", "P0"},
                f"Неповний перелік кластерів {label}")
        strata[label] = found

    cohorts = defaultdict(lambda: [0, 0, 0])
    for record in records:
        cohorts[record["cohort"]][int(record["historical"])] += 1
        cohorts[record["cohort"]][2] += 1
    method = (RESEARCH / "voices-method.md").read_text()
    display_names = {
        "Поранення / службова травма": "поранення / службова травма",
        "Інший службовий медичний маршрут": "інший службовий медичний маршрут",
        "Армія+ без згадки поранення": "відгук Армія+ без згадки поранення",
        "Фахівець / практика супроводу": "фахівець / практика супроводу",
    }
    for display, key in display_names.items():
        row = next((cells(line) for line in method.splitlines()
                    if line.startswith(f"| {display} |")), None)
        require(row is not None and list(map(int, row[1:])) == cohorts[key],
                f"Таблиця контекстів: {display}")

    links_checked = 0
    for relative in CHANGED_MARKDOWN:
        path = ROOT / relative
        text = re.sub(r"```.*?```", "", path.read_text(), flags=re.S)
        for target in re.findall(r"\]\(([^\s)]+)\)", text):
            split = urlsplit(target)
            if split.scheme or split.netloc:
                continue
            destination = (path.parent / unquote(split.path)).resolve() if split.path else path
            require(destination.exists(), f"Немає локального посилання {relative}: {target}")
            if split.fragment and destination.is_file():
                require(unquote(split.fragment) in anchors(destination.read_text()),
                        f"Немає якоря {relative}: {target}")
            links_checked += 1

    print(json.dumps({
        "status": "ok", "records": len(records),
        "source_groups": len(source_words), "strata": strata,
        "cohorts_recent_historical_total": dict(cohorts),
        "max_quoted_words_per_source": max(source_words.values()),
        "local_links_checked": links_checked,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
