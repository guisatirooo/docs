(() => {
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };
  const OWN_KEY = "carros:owned:v1";
  const CUSTOM_KEY = "carros:custom:v1";
  const IMG_KEY = "carros:imgcache:v1";
  const slug = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

  let owned = LS.get(OWN_KEY, {});
  let custom = LS.get(CUSTOM_KEY, {});
  let imgCache = LS.get(IMG_KEY, {});

  const carId = (film, c) => `${film.id}:${slug(c.name)}`;
  const toCar = a => ({ name: a[0], real: a[1], color: a[2], group: a[3], mattel: !!a[4], wiki: a[5] || a[0], alias: a[6] || "" });
  const carsOf = film => [...film.cars.map(toCar), ...(custom[film.id] || [])];

  /* Silhueta de carro com olhos – usada enquanto a foto não carrega */
  function carSvg(color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient></defs>
<ellipse cx="200" cy="205" rx="150" ry="14" fill="#000" opacity=".35"/>
<path d="M40 170c0-22 6-34 26-40l50-14c14-26 34-42 62-42h56c28 0 46 14 62 40l30 12c20 6 34 14 34 44v14c0 6-4 10-10 10H50c-6 0-10-4-10-10z" fill="${color}"/>
<path d="M40 170c0-22 6-34 26-40l50-14c14-26 34-42 62-42h56c28 0 46 14 62 40l30 12c20 6 34 14 34 44v14c0 6-4 10-10 10H50c-6 0-10-4-10-10z" fill="url(#g)"/>
<path d="M136 112c10-18 24-28 44-28h50c18 0 30 8 42 28z" fill="#cfeaff" opacity=".9"/>
<circle cx="188" cy="104" r="15" fill="#fff"/><circle cx="232" cy="104" r="15" fill="#fff"/><circle cx="191" cy="106" r="7" fill="#1b2a4a"/><circle cx="235" cy="106" r="7" fill="#1b2a4a"/>
<path d="M190 125q20 14 40 0" stroke="#1b2a4a" stroke-width="5" fill="none" stroke-linecap="round"/>
<g fill="#15171c"><circle cx="105" cy="188" r="30"/><circle cx="305" cy="188" r="30"/></g><g fill="#b9c0cc"><circle cx="105" cy="188" r="14"/><circle cx="305" cy="188" r="14"/></g></svg>`;
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  /* Fotos: 1) img/<slug>.jpg local (seu arquivo)  2) wikis de Carros via API MediaWiki  3) silhueta */
  const WIKIS = ["pixarcars.fandom.com", "cars.fandom.com", "carstoys.fandom.com"];
  async function wikiLookup(host, titles) {
    const out = {};
    for (let i = 0; i < titles.length; i += 40) {
      const chunk = titles.slice(i, i + 40);
      const url = `https://${host}/api.php?action=query&format=json&origin=*&redirects=1&prop=pageimages&piprop=thumbnail&pithumbsize=480&titles=${encodeURIComponent(chunk.join("|"))}`;
      try {
        const r = await fetch(url); if (!r.ok) continue;
        const j = await r.json(); const q = j.query || {};
        const alias = {};
        (q.normalized || []).forEach(n => alias[n.from] = n.to);
        (q.redirects || []).forEach(n => alias[n.from] = n.to);
        const byTitle = {};
        Object.values(q.pages || {}).forEach(p => { if (p.thumbnail) byTitle[p.title] = p.thumbnail.source; });
        chunk.forEach(t => { let k = t; for (let n = 0; n < 3 && alias[k]; n++) k = alias[k]; if (byTitle[k]) out[t] = byTitle[k]; });
      } catch {}
    }
    return out;
  }
  async function resolveImages(items) {
    let pending = items.filter(i => !imgCache[i.wiki]);
    for (const host of WIKIS) {
      if (!pending.length) break;
      const found = await wikiLookup(host, [...new Set(pending.map(i => i.wiki))]);
      Object.entries(found).forEach(([t, u]) => imgCache[t] = u);
      pending = pending.filter(i => !imgCache[i.wiki]);
    }
    LS.set(IMG_KEY, imgCache);
  }
  function setPhoto(img, car, id) {
    const fallback = carSvg(car.color);
    img.src = fallback;
    const tryUrl = u => new Promise(res => { const t = new Image(); t.onload = () => res(u); t.onerror = () => res(null); t.src = u; });
    (async () => {
      let u = await tryUrl(`img/${slug(car.name)}.jpg`);
      if (!u && imgCache[car.wiki]) u = await tryUrl(imgCache[car.wiki]);
      if (u) { img.src = u; img.classList.add("real"); }
    })();
  }

  function init() {
    const body = document.body;
    const film = window.FILMS.find(f => f.id === +body.dataset.film);
    if (!film) return initHub();

    const state = { q: "", filter: "all", group: "all" };
    const grid = document.getElementById("grid");
    const stats = { total: document.getElementById("s-total"), mattel: document.getElementById("s-mattel"), bar: document.getElementById("bar"), barTxt: document.getElementById("bar-txt") };

    function render() {
      const cars = carsOf(film);
      grid.replaceChildren();
      const q = slug(state.q);
      const groups = [...film.groups, ...new Set(cars.map(c => c.group).filter(g => !film.groups.includes(g)))];
      let shown = 0;
      groups.forEach(g => {
        if (state.group !== "all" && state.group !== g) return;
        const list = cars.filter(c => c.group === g).filter(c => {
          const id = carId(film, c), has = !!owned[id];
          if (state.filter === "mattel" && !c.mattel) return false;
          if (state.filter === "missing" && has) return false;
          if (state.filter === "have" && !has) return false;
          if (state.filter === "buy" && (!c.mattel || has)) return false;
          if (q && !slug(c.name + " " + c.real + " " + c.alias).includes(q)) return false;
          return true;
        });
        if (!list.length) return;
        const sec = el("section", "group");
        const done = list.filter(c => owned[carId(film, c)]).length;
        const h = el("div", "group-head");
        h.append(el("h2", null, g), el("span", "count", `${done}/${list.length}`));
        sec.append(h);
        const wrap = el("div", "cards");
        list.forEach((c, i) => { wrap.append(card(c)); shown++; wrap.lastChild.style.setProperty("--i", Math.min(i, 12)); });
        sec.append(wrap); grid.append(sec);
      });
      if (!shown) grid.append(el("p", "empty", "Nenhum carro encontrado com esses filtros."));
      updateStats();
    }

    function card(c) {
      const id = carId(film, c), has = !!owned[id];
      const a = el("article", "card" + (has ? " owned" : "") + (c.mattel ? " is-mattel" : ""));
      a.dataset.id = id;
      const ph = el("div", "photo");
      const img = el("img"); img.alt = c.name; img.loading = "lazy"; img.decoding = "async";
      setPhoto(img, c, id);
      ph.append(img, el("span", "stamp", "NA COLEÇÃO"));
      if (c.mattel) ph.append(el("span", "badge", "MATTEL 1:55"));
      const info = el("div", "info");
      info.append(el("h3", null, c.name));
      if (c.alias && c.alias !== c.name) info.append(el("p", "alias", c.alias));
      info.append(el("p", "real", c.real));
      const btn = el("button", "check"); btn.type = "button";
      btn.setAttribute("aria-pressed", has); btn.setAttribute("aria-label", `Marcar ${c.name} como ${has ? "não tenho" : "tenho"}`);
      btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${has ? "Tenho" : "Não tenho"}</span>`;
      btn.addEventListener("click", () => toggle(id, a, btn));
      info.append(btn);
      a.append(ph, info);
      return a;
    }

    function toggle(id, a, btn) {
      if (owned[id]) delete owned[id]; else owned[id] = 1;
      LS.set(OWN_KEY, owned);
      const has = !!owned[id];
      a.classList.toggle("owned", has); btn.setAttribute("aria-pressed", has);
      btn.querySelector("span").textContent = has ? "Tenho" : "Não tenho";
      if (has) { a.classList.remove("pop"); void a.offsetWidth; a.classList.add("pop"); }
      updateStats();
      if (state.filter === "missing" || state.filter === "have" || state.filter === "buy") setTimeout(render, 350);
    }

    function updateStats() {
      const cars = carsOf(film);
      const have = cars.filter(c => owned[carId(film, c)]);
      const m = cars.filter(c => c.mattel), mh = m.filter(c => owned[carId(film, c)]);
      stats.total.textContent = `${have.length}/${cars.length}`;
      stats.mattel.textContent = `${mh.length}/${m.length}`;
      const pct = m.length ? Math.round(mh.length / m.length * 100) : 0;
      stats.bar.style.width = pct + "%"; stats.barTxt.textContent = pct + "% da coleção Mattel";
    }

    /* Controles */
    document.getElementById("q").addEventListener("input", e => { state.q = e.target.value; render(); });
    document.querySelectorAll("[data-filter]").forEach(b => b.addEventListener("click", () => {
      state.filter = b.dataset.filter;
      document.querySelectorAll("[data-filter]").forEach(x => x.classList.toggle("on", x === b)); render();
    }));
    const gsel = document.getElementById("group");
    film.groups.forEach(g => { const o = el("option", null, g); o.value = g; gsel.append(o); });
    gsel.addEventListener("change", () => { state.group = gsel.value; render(); });

    /* Lista de compras */
    const dlgBuy = document.getElementById("dlg-buy");
    document.getElementById("btn-buy").addEventListener("click", () => {
      const list = carsOf(film).filter(c => c.mattel && !owned[carId(film, c)]);
      const ul = document.getElementById("buy-list"); ul.replaceChildren();
      list.forEach(c => ul.append(el("li", null, `${c.name} — ${c.real}`)));
      document.getElementById("buy-count").textContent = list.length ? `${list.length} miniaturas Mattel para comprar` : "Coleção Mattel completa deste filme! 🏁";
      dlgBuy.dataset.text = `Lista de compras — ${film.title} (Mattel 1:55)\n` + list.map(c => "☐ " + c.name).join("\n");
      dlgBuy.showModal();
    });
    document.getElementById("btn-copy").addEventListener("click", async e => {
      try { await navigator.clipboard.writeText(dlgBuy.dataset.text); e.target.textContent = "Copiado ✓"; setTimeout(() => e.target.textContent = "Copiar lista", 1600); } catch { e.target.textContent = "Não foi possível copiar"; }
    });

    /* Adicionar carro */
    const dlgAdd = document.getElementById("dlg-add"), form = document.getElementById("form-add");
    const fg = form.elements.group; film.groups.forEach(g => { const o = el("option", null, g); o.value = g; fg.append(o); });
    document.getElementById("btn-add").addEventListener("click", () => dlgAdd.showModal());
    form.addEventListener("submit", e => {
      const f = form.elements; const name = f.name.value.trim(); if (!name) return;
      (custom[film.id] = custom[film.id] || []).push({ name, real: f.real.value.trim() || "Adicionado por você", color: f.color.value, group: f.group.value, mattel: f.mattel.checked, wiki: name, alias: "" });
      LS.set(CUSTOM_KEY, custom); form.reset(); render(); loadPhotos();
    });
    document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));

    /* Backup */
    document.getElementById("btn-export").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify({ owned, custom }, null, 2)], { type: "application/json" });
      const a = el("a"); a.href = URL.createObjectURL(blob); a.download = "minha-colecao-carros.json"; a.click(); URL.revokeObjectURL(a.href);
    });
    const file = document.getElementById("file-import");
    document.getElementById("btn-import").addEventListener("click", () => file.click());
    file.addEventListener("change", async () => {
      try { const j = JSON.parse(await file.files[0].text()); owned = j.owned || {}; custom = j.custom || {}; LS.set(OWN_KEY, owned); LS.set(CUSTOM_KEY, custom); render(); } catch { alert("Arquivo inválido."); }
      file.value = "";
    });

    async function loadPhotos() {
      await resolveImages(carsOf(film).map(c => ({ wiki: c.wiki })));
      document.querySelectorAll(".card").forEach(card => {
        const img = card.querySelector("img"); if (img.classList.contains("real")) return;
        const c = carsOf(film).find(x => carId(film, x) === card.dataset.id); if (c) setPhoto(img, c);
      });
    }
    render(); loadPhotos();
  }

  function initHub() {
    document.querySelectorAll("[data-film-card]").forEach(card => {
      const film = window.FILMS.find(f => f.id === +card.dataset.filmCard); if (!film) return;
      const cars = carsOf(film), m = cars.filter(c => c.mattel), mh = m.filter(c => owned[carId(film, c)]);
      const have = cars.filter(c => owned[carId(film, c)]);
      card.querySelector("[data-total]").textContent = cars.length;
      card.querySelector("[data-mattel]").textContent = `${mh.length}/${m.length}`;
      card.querySelector("[data-have]").textContent = have.length;
      const pct = m.length ? Math.round(mh.length / m.length * 100) : 0;
      card.querySelector(".bar > i").style.width = pct + "%";
      card.querySelector("[data-pct]").textContent = pct + "%";
    });
  }
  document.addEventListener("DOMContentLoaded", init);
})();
