const statuses = {
  yolda: "Yolda",
  bekliyor: "Bekliyor",
  bakimda: "Bakımda",
  musait: "Müsait",
};

const list = document.querySelector("#list");
const empty = document.querySelector("#empty");
const error = document.querySelector("#error");
const editor = document.querySelector("#editor");
const form = document.querySelector("#form");
const formTitle = document.querySelector("#form-title");
const formError = document.querySelector("#form-error");
const query = document.querySelector("#query");
const filter = document.querySelector("#filter");

let vehicles = [];
let editingId = null;

function showError(target, message) {
  target.hidden = !message;
  target.textContent = message || "";
}

async function api(path, options) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "İstek başarısız.");
  return data;
}

function matches(vehicle) {
  const wanted = filter.value;
  const text = query.value.trim().toLocaleLowerCase("tr-TR");
  const haystack = [vehicle.plate, vehicle.name, vehicle.driver, vehicle.location, vehicle.note]
    .join(" ")
    .toLocaleLowerCase("tr-TR");
  return (!wanted || vehicle.status === wanted) && (!text || haystack.includes(text));
}

function render() {
  const visible = vehicles.filter(matches);
  for (const key of ["all", ...Object.keys(statuses)]) {
    const count = key === "all" ? vehicles.length : vehicles.filter((item) => item.status === key).length;
    document.querySelector(`#count-${key}`).textContent = String(count);
  }
  empty.hidden = vehicles.length > 0;
  list.replaceChildren();
  if (!visible.length && vehicles.length) {
    const note = document.createElement("p");
    note.className = "empty";
    note.textContent = "Bu filtreye uyan araç yok.";
    list.append(note);
    return;
  }
  for (const vehicle of visible) {
    const card = document.createElement("article");
    card.className = "card";
    const main = document.createElement("div");
    const plate = document.createElement("div");
    plate.className = "plate";
    plate.textContent = `${vehicle.plate} · ${vehicle.name}`;
    const meta = document.createElement("p");
    meta.className = "meta";
    meta.textContent = [vehicle.driver || "Sürücü yok", vehicle.location || "Konum notu yok", vehicle.note]
      .filter(Boolean)
      .join(" · ");
    const badge = document.createElement("span");
    badge.className = `badge ${vehicle.status}`;
    badge.textContent = statuses[vehicle.status] || vehicle.status;
    main.append(plate, meta, badge);

    const actions = document.createElement("div");
    actions.className = "card-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "ghost";
    edit.textContent = "Düzenle";
    edit.addEventListener("click", () => openEditor(vehicle));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "Sil";
    remove.addEventListener("click", () => removeVehicle(vehicle));
    actions.append(edit, remove);
    card.append(main, actions);
    list.append(card);
  }
}

async function refresh() {
  showError(error, "");
  try {
    const data = await api("/api/vehicles");
    vehicles = data.vehicles || [];
    render();
  } catch (err) {
    showError(error, err.message);
  }
}

function openEditor(vehicle) {
  editingId = vehicle?.id || null;
  formTitle.textContent = vehicle ? "Aracı düzenle" : "Araç ekle";
  form.reset();
  if (vehicle) {
    for (const key of ["plate", "name", "driver", "status", "location", "note"]) {
      form.elements[key].value = vehicle[key] || "";
    }
  }
  showError(formError, "");
  editor.showModal();
}

async function removeVehicle(vehicle) {
  if (!confirm(`${vehicle.plate} kaydı silinsin mi?`)) return;
  try {
    await api(`/api/vehicles/${vehicle.id}`, { method: "DELETE" });
    await refresh();
  } catch (err) {
    showError(error, err.message);
  }
}

document.querySelector("#add-open").addEventListener("click", () => openEditor());
document.querySelector("#cancel").addEventListener("click", () => editor.close());
query.addEventListener("input", render);
filter.addEventListener("change", render);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(form));
  try {
    await api(editingId ? `/api/vehicles/${editingId}` : "/api/vehicles", {
      method: editingId ? "PUT" : "POST",
      body: JSON.stringify(body),
    });
    editor.close();
    await refresh();
  } catch (err) {
    showError(formError, err.message);
  }
});

refresh();
