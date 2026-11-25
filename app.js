"use strict";

const byId = (id) => document.getElementById(id);
const storageKey = "warehouse.stock.v1";
const maxQuantity = 999999999;
const emptyState = () => ({ stock: [], boxes: [] });
const numbers = new Intl.NumberFormat("ru-RU");
const labels = { sku: "артикул", color: "цвет", size: "размер", qty: "количество в штуках" };
const stockHeader = ["Артикул", "Цвет", "Размер", "Количество, шт.", "Дата сверки"];
const boxStockHeader = [...stockHeader, "Номер короба", "Материал"];
const allowedDate = /^\d{4}-\d{2}-\d{2}$/;
let state = emptyState();
let editingBox = -1;
let search = "";

function text(value) {
  return String(value ?? "").trim();
}

function folded(value) {
  return text(value).toLocaleLowerCase("ru").replaceAll("ё", "е");
}

function compact(value) {
  return folded(value).replace(/\s+/g, " ");
}

function stockSearchText(value) {
  return folded(value).replace(/(\d)\s*[xх×]\s*(?=\d)/g, "$1×");
}

function productKey(row) {
  if (row.material) return JSON.stringify(["короб", ...[row.box, row.material, row.size].map(compact)]);
  return JSON.stringify([row.sku, row.color, row.size].map(compact));
}

function boxKey(box) {
  return compact(box);
}

function validQty(qty) {
  return Number.isSafeInteger(qty) && qty >= 0 && qty <= maxQuantity;
}

function validDate(date) {
  return allowedDate.test(date) && !Number.isNaN(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date;
}

function today() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("-");
}

function dateLabel(date) {
  return date.split("-").reverse().join(".");
}

function requireLabel(value, title, optional = false) {
  if (typeof value !== "string" || value.trim().length > 100 ||
      (!optional && !value.trim()) || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Проверь поле «" + title + "». Нужно от 1 до 100 символов.");
  }
  return value.trim();
}

function readBox(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("В черновике есть неверная строка.");
  const box = requireLabel(row.box, "Отметка коробки");
  const sku = requireLabel(row.sku ?? "", "Артикул", true);
  const color = requireLabel(row.color ?? "", "Цвет", true);
  const size = requireLabel(row.size ?? "", "Размер", true);
  const qty = row.qty ?? null;
  if (qty !== null && !validQty(qty)) throw new Error("У коробки «" + box + "» укажи целое количество от 0 до 999 999 999.");
  if (row.uncertain !== undefined && typeof row.uncertain !== "boolean") throw new Error("У коробки «" + box + "» неверная отметка об уточнении.");
  return { box, sku, color, size, qty, uncertain: row.uncertain === true };
}

function deduplicate(rows) {
  const boxes = new Map();
  for (const source of rows) {
    const row = readBox(source);
    const key = boxKey(row.box);
    const entry = boxes.get(key);
    if (!entry) {
      boxes.set(key, { row, conflicts: new Set() });
      continue;
    }
    const { row: original, conflicts } = entry;
    for (const field of Object.keys(labels)) {
      if (conflicts.has(field)) continue;
      const a = original[field];
      const b = row[field];
      if (a === "" || a === null) original[field] = b;
      else if (b !== "" && b !== null && compact(a) !== compact(b)) {
        original[field] = field === "qty" ? null : "";
        conflicts.add(field);
        original.uncertain = true;
      }
    }
    original.uncertain ||= row.uncertain;
  }
  return [...boxes.values()].map((entry) => entry.row);
}

function readStock(rows) {
  if (!Array.isArray(rows)) throw new Error("В файле нет списка остатков.");
  const known = new Set();
  return rows.map((row) => {
    if (!row || typeof row !== "object") throw new Error("В файле есть неверная строка остатка.");
    const identity = row.box || row.material
      ? { box: requireLabel(row.box, "Номер короба"), material: requireLabel(row.material, "Материал") }
      : { sku: requireLabel(row.sku, "Артикул"), color: requireLabel(row.color, "Цвет") };
    const stock = {
      ...identity,
      size: requireLabel(row.size, "Размер"),
      qty: row.qty,
      date: row.date,
    };
    if (!validQty(stock.qty) || !validDate(stock.date)) throw new Error("Проверь количество и дату у позиции «" + itemLabel(stock) + "».");
    const key = productKey(stock);
    if (known.has(key)) throw new Error("В файле повторяется позиция «" + itemLabel(stock) + "».");
    known.add(key);
    return stock;
  });
}

function readBackup(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.boxes)) throw new Error("Выбери копию данных, скачанную из этого приложения.");
  return { stock: readStock(data.stock), boxes: deduplicate(data.boxes) };
}

function announce(message, error = false) {
  const notice = byId("notice");
  notice.textContent = message;
  notice.classList.toggle("error", error);
  notice.hidden = false;
}

function save(next) {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ version: 1, ...next }));
  } catch {
    announce("Браузер не сохранил изменения. Проверь, разрешено ли хранение данных, и повтори действие.", true);
    return false;
  }
  state = next;
  render();
  return true;
}

function restoreOnStart() {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) state = readBackup(JSON.parse(saved));
  } catch {
    announce("Не удалось прочитать данные в браузере. Если есть резервная копия, загрузи её.", true);
  }
}

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function action(label, callback, className = "") {
  const node = element("button", className, label);
  node.type = "button";
  node.addEventListener("click", callback);
  return node;
}

function quantityLabel(qty) {
  return numbers.format(qty) + " шт.";
}

function itemLabel(row) {
  if (row.material) return ["Короб № " + row.box, row.material, row.size].join(" · ");
  return [row.sku, row.color, row.size].filter(Boolean).join(" · ");
}

function missing(row) {
  return Object.keys(labels).filter((field) => row[field] === "" || row[field] === null);
}

function isPending(row) {
  return row.uncertain || missing(row).length > 0;
}

function question(row) {
  const prefix = "Коробка № " + row.box + " — ";
  const phrases = { sku: "какой артикул?", color: "какой цвет?", size: "какой размер?", qty: "сколько штук внутри?" };
  const gaps = missing(row);
  if (gaps.length === 1) return prefix + phrases[gaps[0]];
  if (gaps.length) return prefix + "подскажите, пожалуйста: " + gaps.map((field) => labels[field]).join(", ") + ".";
  return prefix + "подтвердите, пожалуйста: " + itemLabel(row) + ", " + quantityLabel(row.qty) + ".";
}

async function copyQuestion(row) {
  const message = question(row);
  try {
    await navigator.clipboard.writeText(message);
    announce("Вопрос скопирован. Его можно вставить в группу Телеграма.");
  } catch {
    const range = document.createRange();
    const node = [...byId("box-list").querySelectorAll(".question")].find((item) => item.textContent === message);
    if (node) {
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    announce("Текст вопроса выделен. Скопируй его через меню браузера.");
  }
}

function reviewTotals() {
  const pending = state.boxes.filter(isPending);
  const unknownProduct = pending.some((row) => !row.sku || !row.color || !row.size);
  const blocked = new Set(pending.map(productKey));
  const totals = new Map();
  if (unknownProduct) return { totals, pending, unknownProduct, overflow: false };
  for (const row of state.boxes) {
    const key = productKey(row);
    if (blocked.has(key)) continue;
    const previous = totals.get(key);
    totals.set(key, { sku: row.sku, color: row.color, size: row.size, qty: (previous?.qty ?? 0) + row.qty });
  }
  const overflow = [...totals.values()].some((row) => !validQty(row.qty));
  return { totals, pending, unknownProduct, overflow };
}

function renderStock() {
  const hasStock = state.stock.length > 0;
  byId("stock-empty").hidden = hasStock;
  byId("stock-content").hidden = !hasStock;
  byId("export-stock").disabled = !hasStock;
  if (!hasStock) return;
  const rows = [...state.stock].sort((a, b) => itemLabel(a).localeCompare(itemLabel(b), "ru", { numeric: true }));
  const query = stockSearchText(search).split(/\s+/).filter(Boolean);
  const filtered = rows.filter((row) => query.every((word) => stockSearchText(itemLabel(row)).includes(word)));
  const latest = rows.reduce((date, row) => row.date > date ? row.date : date, "");
  byId("stock-count").textContent = "Позиций на складе: " + numbers.format(rows.length);
  byId("stock-date").textContent = "Последняя сверка " + dateLabel(latest);
  byId("stock-ledger").hidden = !filtered.length;
  byId("no-results").hidden = filtered.length > 0;
  byId("stock-list").replaceChildren(...filtered.map((row) => {
    const item = element("li", "stock-grid stock-row");
    const info = element("div");
    info.append(element("strong", "product", row.material ? "Короб № " + row.box : row.sku),
      element("span", "variant", (row.material || row.color) + " · " + row.size));
    const date = element("time", "", dateLabel(row.date));
    date.dateTime = row.date;
    date.setAttribute("aria-label", "Дата сверки " + dateLabel(row.date));
    item.append(info, element("strong", "stock-quantity", quantityLabel(row.qty)), date);
    return item;
  }));
}

function renderReview() {
  const hasBoxes = state.boxes.length > 0;
  const { pending, totals, unknownProduct, overflow } = reviewTotals();
  byId("review-empty").hidden = hasBoxes;
  byId("review-content").hidden = !hasBoxes;
  byId("review-badge").textContent = pending.length;
  byId("review-badge").hidden = !pending.length;
  byId("box-count").textContent = "Коробок в сверке: " + state.boxes.length;
  byId("pending-count").textContent = "На уточнении: " + pending.length;
  const message = byId("pending-message");
  message.textContent = unknownProduct
    ? "Сначала уточни товар в спорных строках. Пока неизвестно, какие остатки затронуты."
    : "Спорные товары останутся с прежним остатком до уточнения.";
  message.hidden = !pending.length;
  byId("confirm-review").disabled = !totals.size || overflow;
  byId("preview-empty").hidden = totals.size > 0;
  byId("preview-list").replaceChildren(...[...totals.values()].map((row) =>
    element("li", "", itemLabel(row) + " — " + (validQty(row.qty) ? quantityLabel(row.qty) : "слишком большое количество"))));
  byId("box-list").replaceChildren(...state.boxes.map((row, index) => {
    const pendingRow = isPending(row);
    const item = element("li", "box-row" + (pendingRow ? " pending" : ""));
    const detail = element("div");
    const title = element("div", "box-label");
    title.append(element("strong", "", "Коробка № " + row.box));
    if (pendingRow) title.append(element("span", "", "Требуется уточнение"));
    detail.append(title, element("p", "", [
      itemLabel(row), row.qty === null ? "Количество неизвестно" : quantityLabel(row.qty),
    ].filter(Boolean).join(" · ")));
    if (pendingRow) detail.append(element("p", "question", question(row)));
    const buttons = element("div", "actions");
    buttons.append(action(pendingRow ? "Уточнить строку" : "Изменить", () => openBox(index)));
    if (pendingRow) buttons.append(action("Скопировать вопрос", () => copyQuestion(row)));
    buttons.append(action("Удалить", () => removeBox(index), "remove"));
    item.append(detail, buttons);
    return item;
  }));
}

function render() {
  renderStock();
  renderReview();
}

function switchTab(tab, focus = false) {
  for (const name of ["stock", "review"]) {
    const selected = name === tab;
    byId(name).hidden = !selected;
    const button = byId(name + "-tab");
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  if (focus) byId(tab + "-tab").focus();
}

function ask(title, message, label) {
  const dialog = byId("confirm-dialog");
  byId("confirm-title").textContent = title;
  byId("confirm-message").textContent = message;
  byId("confirm-action").textContent = label;
  dialog.returnValue = "cancel";
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
  });
}

function openBox(index = -1) {
  editingBox = index;
  const form = byId("box-form");
  const row = state.boxes[index];
  form.reset();
  byId("box-title").textContent = !row ? "Добавить коробку" : isPending(row) ? "Уточнить строку" : "Изменить коробку";
  byId("box-error").hidden = true;
  if (row) {
    for (const field of ["box", ...Object.keys(labels)]) form.elements.namedItem(field).value = row[field] ?? "";
    form.elements.uncertain.checked = row.uncertain;
  }
  byId("box-dialog").showModal();
}

byId("box-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  try {
    const row = readBox({
      box: data.get("box"), sku: data.get("sku"), color: data.get("color"), size: data.get("size"),
      qty: data.get("qty") === "" ? null : Number(data.get("qty")), uncertain: data.has("uncertain"),
    });
    if (state.boxes.some((other, index) => index !== editingBox && boxKey(other.box) === boxKey(row.box))) {
      throw new Error("Коробка с такой отметкой уже есть. Измени её в списке.");
    }
    const boxes = [...state.boxes];
    if (editingBox < 0) boxes.push(row);
    else boxes[editingBox] = row;
    if (save({ ...state, boxes })) {
      byId("box-dialog").close();
      announce(isPending(row) ? "Коробка сохранена и отмечена для уточнения." : "Коробка сохранена.");
    } else {
      throw new Error("Браузер не сохранил коробку. Повтори сохранение.");
    }
  } catch (error) {
    const info = byId("box-error");
    info.textContent = error.message;
    info.hidden = false;
  }
});

async function removeBox(index) {
  const row = state.boxes[index];
  if (!await ask("Удалить коробку из черновика?", "Коробка № " + row.box + ". Подтверждённые остатки при этом не изменятся.", "Удалить коробку")) return;
  if (save({ ...state, boxes: state.boxes.filter((_, position) => position !== index) })) announce("Коробка удалена из черновика.");
}

async function confirmReview() {
  const { totals, pending, overflow } = reviewTotals();
  if (!totals.size || overflow) return;
  const date = today();
  const message = "Будет обновлено позиций: " + totals.size + ". Остальные остатки сохранятся." +
    (pending.length ? " Строки на уточнении останутся в черновике." : "") +
    ([...totals.values()].some((row) => row.qty === 0) ? " В сверке есть явно указанный нулевой остаток." : "");
  if (!await ask("Подтвердить фактический остаток?", message, "Подтвердить остатки")) return;
  const stock = new Map(state.stock.map((row) => [productKey(row), row]));
  for (const [key, row] of totals) stock.set(key, { ...row, date });
  const boxes = state.boxes.filter((row) => !totals.has(productKey(row)));
  if (save({ stock: [...stock.values()], boxes })) {
    byId("search").value = "";
    search = "";
    renderStock();
    switchTab("stock", true);
    announce("Сверка от " + dateLabel(date) + " подтверждена. Обновлено позиций: " + totals.size + ".");
  }
}

function wireFile(button, input, handler) {
  byId(button).addEventListener("click", () => byId(input).click());
  byId(input).addEventListener("change", async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error("Файл больше 20 МБ. Выбери файл меньшего размера.");
      await handler(file);
    } catch (error) {
      announce(error instanceof SyntaxError ? "Не удалось прочитать файл. Проверь формат и попробуй снова." : error.message, true);
    }
  });
}

async function loadReview(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("В файле сверки нет коробок.");
  const boxes = deduplicate(rows);
  if (state.boxes.length && !await ask("Заменить черновик сверки?", "Текущие строки черновика заменятся строками из файла.", "Заменить черновик")) return;
  if (save({ ...state, boxes })) announce("Сверка загружена. Коробок: " + boxes.length + ".");
}

function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = element("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const utf8 = new TextEncoder();
const xmlDecoder = new TextDecoder("utf-8", { fatal: true });
const workbookType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const sheetPath = "xl/worksheets/sheet1.xml";
const officeNs = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const packageNs = "http://schemas.openxmlformats.org/package/2006/relationships";
const sheetNs = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const xmlDeclaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const crcTable = Array.from({ length: 256 }, (_, index) => {
  for (let bit = 0; bit < 8; bit++) index = (index >>> 1) ^ ((index & 1) ? 0xedb88320 : 0);
  return index;
});

function checksum(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

function zipHeader(length, signature) {
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, signature, true);
  return {
    bytes,
    short(offset, value) { view.setUint16(offset, value, true); },
    long(offset, value) { view.setUint32(offset, value, true); },
  };
}

// An Excel workbook is a ZIP containing a worksheet and a few XML descriptors.
function workbookZip(files) {
  const entries = [];
  const directory = [];
  let offset = 0;
  let directoryLength = 0;
  for (const [filename, content] of Object.entries(files)) {
    const name = utf8.encode(filename);
    const data = utf8.encode(xmlDeclaration + content);
    const crc = checksum(data);
    const local = zipHeader(30, 0x04034b50);
    local.short(4, 20);
    local.short(12, 33);
    local.long(14, crc);
    local.long(18, data.length);
    local.long(22, data.length);
    local.short(26, name.length);
    const central = zipHeader(46, 0x02014b50);
    central.short(4, 20);
    central.short(6, 20);
    central.short(14, 33);
    central.long(16, crc);
    central.long(20, data.length);
    central.long(24, data.length);
    central.short(28, name.length);
    central.long(42, offset);
    entries.push(local.bytes, name, data);
    directory.push(central.bytes, name);
    offset += local.bytes.length + name.length + data.length;
    directoryLength += central.bytes.length + name.length;
  }
  const end = zipHeader(22, 0x06054b50);
  end.short(8, directory.length / 2);
  end.short(10, directory.length / 2);
  end.long(12, directoryLength);
  end.long(16, offset);
  return new Blob([...entries, ...directory, end.bytes], { type: workbookType });
}

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function stockWorkbook() {
  const withBoxes = state.stock.some((row) => row.material);
  const rows = [withBoxes ? boxStockHeader : stockHeader, ...state.stock.map((row) => {
    const fields = [row.sku ?? "", row.color ?? "", row.size, row.qty, row.date];
    return withBoxes ? [...fields, row.box ?? "", row.material ?? ""] : fields;
  })];
  const sheetRows = rows.map((row, index) => {
    const cells = row.map((value, column) => {
      const ref = String.fromCharCode(65 + column) + (index + 1);
      return typeof value === "number"
        ? '<c r="' + ref + '"><v>' + value + '</v></c>'
        : '<c r="' + ref + '" t="inlineStr"><is><t>' + escapeXml(value) + '</t></is></c>';
    });
    return '<row r="' + (index + 1) + '">' + cells.join("") + '</row>';
  }).join("");
  const type = "application/vnd.openxmlformats-officedocument.spreadsheetml.";
  return workbookZip({
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="' + type + 'sheet.main+xml"/>' +
      '<Override PartName="/' + sheetPath + '" ContentType="' + type + 'worksheet+xml"/></Types>',
    "_rels/.rels": '<Relationships xmlns="' + packageNs + '"><Relationship Id="rId1" Type="' +
      officeNs + '/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": '<workbook xmlns="' + sheetNs + '" xmlns:r="' + officeNs +
      '"><sheets><sheet name="Остатки" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships xmlns="' + packageNs + '"><Relationship Id="rId1" Type="' +
      officeNs + '/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    [sheetPath]: '<worksheet xmlns="' + sheetNs + '"><cols><col min="1" max="' + rows[0].length +
      '" width="23" customWidth="1"/></cols>' +
      '<sheetData>' + sheetRows + '</sheetData></worksheet>',
  });
}

async function workbookStock(file) {
  const data = await file.arrayBuffer();
  const view = new DataView(data);
  const badFile = () => new Error("Выбери исходный файл Эксель, скачанный из «Остатков склада».");
  let worksheet;
  let offset = 0;
  while (offset + 30 <= data.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const crc = view.getUint32(offset + 14, true);
    const length = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const start = offset + 30 + nameLength + extraLength;
    if (start + length > data.byteLength) throw badFile();
    const name = xmlDecoder.decode(new Uint8Array(data, offset + 30, nameLength));
    if (name === sheetPath) {
      if (method !== 0) throw badFile();
      const bytes = new Uint8Array(data, start, length);
      if (checksum(bytes) !== crc) throw badFile();
      worksheet = xmlDecoder.decode(bytes);
      break;
    }
    offset = start + length;
  }
  if (!worksheet) throw badFile();
  const xml = new DOMParser().parseFromString(worksheet, "application/xml");
  if (xml.querySelector("parsererror") || xml.documentElement.namespaceURI !== sheetNs) throw badFile();
  const rows = Array.from(xml.getElementsByTagNameNS(sheetNs, "row"), (row) =>
    Array.from(row.getElementsByTagNameNS(sheetNs, "c"), (cell) => cell.textContent));
  const header = rows.shift();
  const expectedHeader = header?.length === boxStockHeader.length ? boxStockHeader : stockHeader;
  if (!header || header.length !== expectedHeader.length ||
      expectedHeader.some((value, index) => header[index] !== value)) throw badFile();
  return readStock(rows.map(([sku, color, size, qty, date, box, material]) => ({
    sku, color, size, qty: /^\d+$/.test(qty) ? Number(qty) : NaN, date, box, material,
  })));
}

byId("stock-tab").addEventListener("click", () => switchTab("stock"));
byId("review-tab").addEventListener("click", () => switchTab("review"));
byId("start-review").addEventListener("click", () => switchTab("review", true));
byId("add-box").addEventListener("click", () => openBox());
byId("cancel-box").addEventListener("click", () => byId("box-dialog").close());
byId("confirm-review").addEventListener("click", confirmReview);

byId("search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  search = byId("search").value;
  renderStock();
});

byId("search").addEventListener("input", (event) => {
  search = event.target.value;
  renderStock();
});

byId("demo").addEventListener("click", () => loadReview([
  { box: "523", sku: "ПРОБА-01", color: "Дымчатый", size: "140 × 260 см", qty: 20 },
  { box: "523", sku: "ПРОБА-01", color: "Дымчатый", size: "140 × 260 см", qty: 20 },
  { box: "524", sku: "ПРОБА-01", color: "Дымчатый", size: "140 × 260 см", qty: 12 },
  { box: "525", sku: "ПРОБА-01", color: "Дымчатый", size: "", qty: 16 },
  { box: "526", sku: "ПРОБА-02", color: "Молочный", size: "200 × 270 см", qty: 24 },
]).catch((error) => announce(error.message, true)));

wireFile("open-review", "review-file", async (file) => {
  const data = JSON.parse(await file.text());
  await loadReview(data?.boxes);
});

wireFile("open-stock", "stock-file", async (file) => {
  if (/\.json$/i.test(file.name)) {
    const data = JSON.parse(await file.text());
    if (data?.kind !== "warehouse-box-stock") throw new Error("Выбери файл остатков по коробам.");
    const incoming = readStock(data.stock);
    if (!incoming.length || incoming.some((row) => !row.material)) throw new Error("В файле нет остатков по коробам.");
    const byPosition = new Map(state.stock.map((row) => [productKey(row), row]));
    const overlaps = incoming.filter((row) => byPosition.has(productKey(row))).length;
    if (overlaps && !await ask("Обновить остатки по коробам?",
      "В файле есть совпадающие позиции. Обновится позиций: " + overlaps + ".", "Обновить остатки")) return;
    for (const row of incoming) byPosition.set(productKey(row), row);
    if (save({ ...state, stock: [...byPosition.values()] })) {
      search = "";
      byId("search").value = "";
      renderStock();
      announce("Файл коробов загружен. Позиций: " + incoming.length + ".");
    }
    return;
  }
  const stock = await workbookStock(file);
  if (state.stock.length && !await ask("Открыть другой файл остатков?", "Он заменит остатки в этом браузере. Черновик сверки сохранится.", "Открыть файл")) return;
  if (save({ ...state, stock })) {
    search = "";
    byId("search").value = "";
    renderStock();
    announce("Файл остатков открыт. Позиций: " + stock.length + ".");
  }
});

byId("export-stock").addEventListener("click", () => {
  download("Остатки склада.xlsx", stockWorkbook());
});

byId("backup").addEventListener("click", () => {
  const data = JSON.stringify({ version: 1, ...state }, null, 2);
  download("Копия остатков склада.json", new Blob([data], { type: "application/json" }));
});

wireFile("restore", "backup-file", async (file) => {
  const restored = readBackup(JSON.parse(await file.text()));
  if ((state.stock.length || state.boxes.length) &&
      !await ask("Восстановить копию данных?", "Остатки и черновик в этом браузере заменятся данными из копии.", "Восстановить копию")) return;
  if (save(restored)) {
    search = "";
    byId("search").value = "";
    renderStock();
    announce("Остатки и черновик восстановлены из копии.");
  }
});

restoreOnStart();
render();
