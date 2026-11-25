"""Update the public exchange rates with data from the Bank of Russia."""

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import json
import os
from pathlib import Path
import tempfile
import urllib.request
from xml.etree import ElementTree


SOURCE = "https://www.cbr.ru/scripts/XML_daily.asp"
CURRENCIES = ("CNY", "USD")
MARKUP_PERCENT = 2
OUTPUT = Path(__file__).with_name("data.json")


def snapshot():
    with urllib.request.urlopen(SOURCE, timeout=20) as response:
        xml = response.read(1_000_001)
    if len(xml) > 1_000_000:
        raise ValueError("Ответ Банка России слишком большой.")

    root = ElementTree.fromstring(xml)
    if root.tag != "ValCurs":
        raise ValueError("Ответ Банка России не похож на таблицу курсов.")
    effective_date = datetime.strptime(root.attrib["Date"], "%d.%m.%Y").date()
    rates = {}
    for currency in root.findall("Valute"):
        code = currency.findtext("CharCode")
        if code not in CURRENCIES:
            continue
        rate = Decimal(currency.findtext("VunitRate", "").replace(",", "."))
        if not rate.is_finite() or not 0 < rate < 1_000_000:
            raise ValueError(f"Банк России вернул неверный курс {code}.")
        adjusted = rate * (1 + Decimal(MARKUP_PERCENT) / 100)
        rates[code] = {"official_rub": format(rate, "f"), "adjusted_rub": format(adjusted, "f")}
    if set(rates) != set(CURRENCIES):
        raise ValueError("В ответе Банка России нет курса юаня или доллара.")

    return {
        "source": "Банк России",
        "effective_date": effective_date.isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "markup_percent": MARKUP_PERCENT,
        "rates": {code: rates[code] for code in CURRENCIES},
    }


def save(data):
    # Write next to the destination so replacement is atomic on the same volume.
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=OUTPUT.parent, delete=False
        ) as handle:
            temp_path = Path(handle.name)
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temp_path, OUTPUT)
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        save(snapshot())
    except (OSError, ValueError, KeyError, InvalidOperation, ElementTree.ParseError) as error:
        raise SystemExit(f"Курсы не обновились. Последний файл сохранён. {error}") from error
    print("Курсы Банка России обновлены.")
