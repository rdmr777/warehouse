"use strict";

{
  const freshRates = "https://raw.githubusercontent.com/rdmr777/warehouse/main/data.json";
  const ratesStorageKey = "warehouse.exchange-rates.v1";
  const currencies = { CNY: "cny", USD: "usd" };
  const rubles = new Intl.NumberFormat("ru-RU", {
    style: "currency", currency: "RUB", minimumFractionDigits: 4, maximumFractionDigits: 4,
  });
  const moscowTime = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short",
  });
  const ratesStatus = document.getElementById("rates-status");
  let loadingRates = false;

  function validateRates(data) {
    const validAmount = (value) => typeof value === "string" && /^\d+(\.\d+)?$/.test(value) &&
      Number(value) > 0 && Number(value) < 1_100_000;
    if (data?.source !== "Банк России" || data.markup_percent !== 2 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(data.effective_date) ||
        !Number.isFinite(Date.parse(data.updated_at)) ||
        Object.keys(currencies).some((code) =>
          !validAmount(data.rates?.[code]?.official_rub) || !validAmount(data.rates?.[code]?.adjusted_rub))) {
      throw new Error("Неверный файл курсов.");
    }
    return data;
  }

  function showRates(data) {
    for (const [code, id] of Object.entries(currencies)) {
      const rate = data.rates[code];
      document.getElementById("rate-" + id).textContent = rubles.format(Number(rate.adjusted_rub));
      document.getElementById("rate-" + id + "-official").textContent =
        "ЦБ: " + rubles.format(Number(rate.official_rub));
    }
    document.getElementById("rates-brief").textContent =
      "· Юань " + rubles.format(Number(data.rates.CNY.adjusted_rub)) +
      " · Доллар " + rubles.format(Number(data.rates.USD.adjusted_rub));
    const date = data.effective_date.split("-").reverse().join(".");
    const updated = moscowTime.format(new Date(data.updated_at));
    const dates = document.getElementById("rates-dates");
    dates.textContent = "Рабочий курс с надбавкой +" + data.markup_percent + "% · Курс ЦБ на " + date +
      " · Обновлено " + updated + " мск";
    dates.hidden = false;
    document.getElementById("rates-values").hidden = false;
  }

  async function readRates(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, { cache: "no-store", credentials: "omit", signal: controller.signal });
      if (!response.ok) return null;
      return validateRates(await response.json());
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  function savedRates() {
    try {
      return validateRates(JSON.parse(localStorage.getItem(ratesStorageKey)));
    } catch {
      return null;
    }
  }

  async function refreshRates() {
    if (loadingRates) return;
    loadingRates = true;
    try {
      const saved = savedRates();
      if (saved) showRates(saved);
      // Data commits don't rebuild the site. Read the repository's published file for the latest copy.
      const [live, bundled] = await Promise.all([readRates(freshRates), readRates("./data.json")]);
      const latest = [live, bundled, saved].filter(Boolean).sort((a, b) =>
        Date.parse(b.updated_at) - Date.parse(a.updated_at))[0];
      if (!latest) {
        ratesStatus.textContent = "Курсы пока недоступны. Повтори попытку, когда будет интернет.";
        return;
      }
      showRates(latest);
      try {
        localStorage.setItem(ratesStorageKey, JSON.stringify(latest));
      } catch {
        // The bundled copy is still available when the browser has saved the app.
      }
      const isLive = latest === live;
      ratesStatus.hidden = isLive;
      if (!isLive) ratesStatus.textContent = "Показаны последние сохранённые курсы. Свежие данные пока недоступны.";
    } finally {
      loadingRates = false;
    }
  }

  refreshRates();
  window.addEventListener("online", refreshRates);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshRates();
  });
}
