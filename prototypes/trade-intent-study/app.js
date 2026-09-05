import { matches, speciesQuery, mergeDeclarations } from "./model.js";
import { normalizeSprites, bounds } from "./sprite-layout.js";

const catalog = await fetch("catalog.json").then((r) => r.json());
const byId = new Map(catalog.map((p) => [p.id, p]));
const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icon = (name) =>
  `<svg class="icon" aria-hidden="true"><use href="vendor/icons.svg#ui-icon-${name}"></use></svg>`;
const button = (action, text, name = "", cls = "", extra = "") =>
  `<button data-action="${action}" class="${cls}" ${extra}>${name ? icon(name) : ""}${text}</button>`;
const ib = (action, label, name, extra = "") =>
  button(
    action,
    "",
    name,
    "icon-button",
    `aria-label="${esc(label)}" title="${esc(label)}" ${extra}`,
  );
const get = (name) =>
  catalog.find((p) => p.name === name && !p.shiny) || catalog[0];
const entry = (p, side, extra = {}) => ({
  ...p,
  id: `${p.id}-${side}`,
  catalogId: p.id,
  want: side === "want",
  offer: side === "offer",
  bg: "",
  gender: "",
  ...extra,
});
const initial = () => mergeDeclarations([
  ...[
    "Pikachu (Saree)",
    "Snom",
    "Jigglypuff (Ribbon)",
    "Mewtwo",
    "Lapras",
    "Rotom",
    "Salandit",
    "Eevee",
    "Pikachu (Worlds 2026)",
    "Snorlax (Cowboy Hat)",
    "Psyduck",
    "Ralts",
  ].map((name, i) =>
    entry(get(name), "want", {
      top: i < 3,
      ...(name === "Mewtwo" ? { bg: "Chicago 2026" } : {}),
      ...(name === "Salandit" ? { gender: "female" } : {}),
    }),
  ),
  ...[
    "base-131-shiny",
    "base-129-shiny",
    "base-133-shiny",
    "base-25-shiny",
  ].map((id) => entry(byId.get(id), "want")),
  ...[
    "Pikachu (Kurta)",
    "Jigglypuff (Ribbon)",
    "Eevee",
    "Gengar",
    "Togepi",
    "Snorlax",
    "Bulbasaur",
    "Charmander",
    "Squirtle",
    "Sableye",
    "Rayquaza",
    "Psyduck",
  ].map((name) => entry(get(name), "offer")),
  entry(byId.get("base-54-shiny"), "offer"),
  entry(get("Mewtwo"), "offer", { bg: "Chicago 2026" }),
  entry(get("Gengar"), "want", { id: "gengar-gmax-want", max: "Gigantamax" }),
]);
let state;
try {
  state = JSON.parse(localStorage.getItem("pogo-intent-study-v1"));
} catch {}
if (!state || !Array.isArray(state.entries))
  state = { entries: initial(), saved: [], locale: "en" };
let concept = new URLSearchParams(location.search).get("concept") || "a";
let filter = "all",
  query = "",
  view = "grid",
  page = 0,
  topOnly = false,
  collection = "all",
  selectMode = false,
  selection = new Set(),
  anonymous = new Set(),
  lastEdit = null;
let scope = "all",
  output = "link",
  editor = null,
  session = [],
  done = new Set();
let peopleScope = "community",
  meeting = "Riverside group meetup",
  peopleQuery = "",
  route = "list",
  personId = "mira";
const sheet = $("#sheet");
const people = [
  {
    id: "mira",
    name: "Mira",
    community: "Riverside group",
    age: "Confirmed today",
    fresh: true,
    initials: "MI",
    entries: [
      ...["Pikachu (Saree)", "Snom", "Jigglypuff (Ribbon)", "Lapras"].map((n) =>
        entry(get(n), "offer"),
      ),
      entry(get("Mewtwo"), "offer", { bg: "Chicago 2026" }),
      ...["Eevee", "Gengar", "Psyduck"].map((n) => entry(get(n), "want")),
    ],
  },
  {
    id: "theo",
    name: "Theo",
    community: "Riverside group",
    age: "Confirmed 3 days ago",
    fresh: true,
    initials: "TH",
    entries: [
      entry(byId.get("base-129-shiny"), "offer"),
      entry(get("Salandit"), "offer", { gender: "female" }),
      entry(get("Rayquaza"), "want"),
      entry(get("Squirtle"), "want"),
    ],
  },
  {
    id: "arden",
    name: "Arden",
    community: "Downtown group",
    age: "Confirmed today",
    fresh: true,
    initials: "AR",
    entries: [
      entry(get("Rotom"), "offer"),
      entry(get("Mewtwo"), "offer", { bg: "any" }),
      entry(get("Togepi"), "want"),
    ],
  },
  {
    id: "lina",
    name: "Lina",
    community: "Riverside group",
    age: "Last confirmed 45 days ago",
    fresh: false,
    initials: "LI",
    entries: [
      entry(get("Pikachu (Saree)"), "offer"),
      entry(get("Gengar"), "want"),
    ],
  },
];
function persist() {
  localStorage.setItem("pogo-intent-study-v1", JSON.stringify(state));
}
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#toast").classList.remove("show"), 3300);
}
function go(next) {
  location.hash = next;
}
function currentEntries() {
  if (route === "empty") return [];
  if (route === "large")
    return catalog
      .filter((p) => p.art)
      .slice(0, 300)
      .map((p, i) =>
        entry(p, i % 3 === 0 ? "offer" : "want", { top: i % 17 === 0 }),
      );
  if (route === "special")
    return state.entries.filter(
      (p) => p.costume || p.bg || p.gender || p.shiny,
    );
  return state.entries;
}
function description(p) {
  return [
    p.shiny ? "Shiny" : "",
    p.name,
    p.max || "",
    p.bg ? `${p.bg === "any" ? "Any background" : p.bg + " · BG"}` : "",
    p.gender ? `${p.gender}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
function art(p) {
  return `<span class="artbox">${p.art ? `<img src="${esc(p.art)}" alt="${esc(p.name)}" loading="lazy">` : `<span class="noart">${esc(p.name)}</span>`}${p.shiny ? `<span class="shiny" aria-label="Shiny"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 1Q15 9 23 9Q15 9 15 17Q15 9 7 9Q15 9 15 1ZM5 13Q5 18 10 18Q5 18 5 23Q5 18 0 18Q5 18 5 13Z" fill="currentColor"/></svg></span>` : ""}${p.gender ? `<span class="gender" aria-label="${esc(p.gender)}">${p.gender === "female" ? "♀" : "♂"}</span>` : ""}</span>`;
}
function tiles(items, { readonly = false, choose = false } = {}) {
  return `<div class="tiles">${items.map((p) => `<button class="tile ${selection.has(p.id) ? "selected" : ""}" data-action="${choose ? "pick" : readonly ? "inspect" : "entry"}" data-id="${esc(p.id)}" title="${esc(description(p))}" aria-label="${esc(description(p))}" ${selectMode ? `aria-pressed="${selection.has(p.id)}"` : ""}>${p.top ? '<span class="topdot" title="Top want"></span>' : ""}${art(p)}${p.max ? `<span class="qualifier">${esc(p.max)}</span>` : ""}${p.bg ? `<span class="qualifier">${esc(p.bg === "any" ? "Any background" : p.bg + " · BG")}</span>` : ""}</button>`).join("")}</div>`;
}
function rows(items) {
  return `<div class="rows">${items.map((p) => `<div class="entryrow">${art(p)}<button class="namebutton" data-action="entry" data-id="${esc(p.id)}"><strong>${esc(p.name)}</strong><small>${esc([p.shiny ? "Shiny" : "", p.bg ? `${p.bg} · BG` : "", p.top ? "Top want" : ""].filter(Boolean).join(" · "))}</small></button><div class="rowchecks"><label><input type="checkbox" data-side="want" data-id="${esc(p.id)}" ${p.want ? "checked" : ""}>Want</label><label><input type="checkbox" data-side="offer" data-id="${esc(p.id)}" ${p.offer ? "checked" : ""}>Offer</label></div></div>`).join("")}</div>`;
}
function section(title, items, type, { readonly = false } = {}) {
  return `<section class="section"><div class="sectionhead ${type}"><h2>${title} <span class="count">${items.length}</span></h2>${readonly ? "" : ib(`search-${type}`, `Copy ${title.toLowerCase()} search`, "copy")}</div>${items.length ? (view === "rows" && !readonly ? rows(items) : tiles(items, { readonly })) : `<p class="muted emptysection">No ${type === "want" ? "wants" : "offers"} in this view.</p>`}</section>`;
}
function navitems() {
  return concept === "b"
    ? [
        ["people", "For You", "users"],
        ["list", "Collection", "list"],
        ["saved", "Saved", "archive"],
      ]
    : concept === "c"
      ? [
          ["session", "Today", "calendar"],
          ["people", "People", "users"],
          ["list", "Collection", "list"],
        ]
      : [
          ["list", "My List", "list"],
          ["people", "People", "users"],
        ];
}
function nav() {
  return navitems()
    .map(([id, label, i]) =>
      button(
        "nav",
        label,
        i,
        route === id ||
          (id === "list" && ["large", "special", "empty"].includes(route))
          ? "active"
          : "",
        `data-route="${id}"`,
      ),
    )
    .join("");
}
function header() {
  return `<div class="studybar"><span>Design study · synthetic data · local only</span><a href="#concepts">Review concepts</a></div><header class="header"><a href="#list" class="brand"><span class="brandmark">${icon("sparkles")}</span>PoGo Trades</a><nav aria-label="Primary">${nav()}</nav>${button("account", "JP", "", "account", 'aria-label="Account menu" title="Account menu"')}</header>`;
}
function footer() {
  return `<footer class="reviewlinks"><a href="#list">Everyday list</a><a href="#large">300-entry list</a><a href="#special">Collectibles</a><a href="#empty">New trainer</a><a href="#public">Recipient</a><a href="#concepts">Three concepts</a></footer>`;
}
function side() {
  return `<aside class="side"><section><h3>Worth a look</h3><p>Mira has several of your wants, and you have offers on their list.</p><div class="miniatures">${people[0].entries
    .filter((p) => p.offer)
    .slice(0, 3)
    .map(art)
    .join(
      "",
    )}</div>${button("person", "See both sides", "chevron-right", "", 'data-id="mira"')}</section><section><h3>Trading context</h3><p>Riverside group</p><p class="muted">Meeting place not shared.</p></section><section><h3>Your list, your choice</h3><p>Private draft on this device.</p>${button("share", "Share list", "upload")}</section></aside>`;
}
function filteredEntries() {
  return currentEntries().filter(
    (p) =>
      (!query ||
        description(p).toLowerCase().includes(query.toLowerCase()) ||
        String(p.no) === query) &&
      (!topOnly || p.top) &&
      (collection === "all" ||
        (collection === "costume"
          ? p.costume
          : collection === "background"
            ? p.bg
            : collection === "shiny"
              ? p.shiny
              : true)) &&
      (filter === "all" || p[filter]),
  );
}
function listPage() {
  const all = currentEntries();
  let items = filteredEntries();
  const count = items.length;
  items = items.slice(page * 60, page * 60 + 60);
  return `<div class="titlebar"><div><h1>${route === "large" ? "My collection" : route === "special" ? "Special collectibles" : "My List"}</h1><p class="muted">${all.filter((p) => p.want).length} wants · ${all.filter((p) => p.offer).length} offers · On this device</p></div><div class="actions">${button("add", "Add Pokemon", "", "primary addmain")}${ib("share", "Share list", "upload")}</div></div>${
    all.length
      ? `<div class="toolbar"><div class="search">${icon("search")}<input type="search" id="list-search" aria-label="Search my list" placeholder="Search Pokemon or variant" value="${esc(query)}"></div><div class="segmented" aria-label="Intent filter">${["all", "want", "offer"].map((x) => button("filter", x === "all" ? "All" : x === "want" ? "Wants" : "Offers", "", filter === x ? "active" : "", `data-value="${x}" aria-pressed="${filter === x}"`)).join("")}</div>${ib("view", view === "grid" ? "Show compact rows" : "Show sprite grid", view === "grid" ? "list" : "grip")}${ib("select", "Select entries", "check", `aria-pressed="${selectMode}"`)}</div><div class="filterrow"><label><input id="top-only" type="checkbox" ${topOnly ? "checked" : ""}>Top wants</label><select id="collection-filter" aria-label="Collectible filter">${[
          ["all", "All collectibles"],
          ["costume", "Costumes"],
          ["background", "Backgrounds"],
          ["shiny", "Shiny"],
        ]
          .map(
            ([id, t]) =>
              `<option value="${id}" ${collection === id ? "selected" : ""}>${t}</option>`,
          )
          .join(
            "",
          )}</select><span class="resultcount">${count} entries</span></div>${
          !count
            ? '<div class="empty"><h2>No matches</h2><p class="muted">Try another Pokemon or clear your filters.</p>' +
              button("clearfilters", "Clear filters") +
              "</div>"
            : view === "rows"
              ? rows(items)
              : `${
                  filter !== "offer"
                    ? section(
                        "Looking For",
                        items.filter((p) => p.want),
                        "want",
                      )
                    : ""
                }${
                  filter !== "want"
                    ? section(
                        "For Trade",
                        items.filter((p) => p.offer),
                        "offer",
                      )
                    : ""
                }`
        }${count > 60 ? `<div class="pager">${ib("previous", "Previous page", "chevron-left", page === 0 ? "disabled" : "")}<span>Page ${page + 1} of ${Math.ceil(count / 60)}</span>${ib("next", "Next page", "chevron-right", (page + 1) * 60 >= count ? "disabled" : "")}</div>` : ""}${selection.size ? `<div class="selectionbar"><span>${selection.size} selected</span><div class="actions">${button("share-selection", "Share", "upload")}${button("copy-selection", "Search", "copy")}${ib("clear-selection", "Clear selection", "trash")}</div></div>` : ""}`
      : `<div class="empty"><div class="miniatures">${["base-25", "base-133", "base-872"].map((id) => art(byId.get(id))).join("")}</div><h2>What are you looking for?</h2><p class="muted">Your first want or offer can start a trade.</p><div class="actions">${button("add", "Add Pokemon", "", "primary")}${button("nav", "See trainers", "users", "", 'data-route="people"')}</div></div>`
  }${footer()}`;
}
function matchFor(person) {
  return matches(state.entries, person.entries);
}
function peoplePage() {
  let shown = people.filter(
    (p) =>
      (peopleScope !== "community" || p.community === "Riverside group") &&
      (peopleScope !== "saved" || state.saved.includes(p.id)) &&
      (!peopleQuery ||
        p.name.toLowerCase().includes(peopleQuery.toLowerCase())),
  );
  shown.sort(
    (a, b) =>
      Number(b.fresh) - Number(a.fresh) ||
      Math.min(matchFor(b).give.length, matchFor(b).receive.length) -
        Math.min(matchFor(a).give.length, matchFor(a).receive.length),
  );
  return `<div class="titlebar"><div><h1>${concept === "b" ? "For You" : "People"}</h1><p class="muted">A reason to start a conversation.</p></div></div><div class="toolbar"><div class="search">${icon("search")}<input id="people-search" type="search" aria-label="Find a trainer" placeholder="Find a trainer" value="${esc(peopleQuery)}"></div></div><div class="segmented">${[
    ["community", "My community"],
    ["all", "All demo groups"],
    ["saved", "Saved"],
  ]
    .map(([v, t]) =>
      button(
        "people-scope",
        t,
        "",
        peopleScope === v ? "active" : "",
        `data-value="${v}"`,
      ),
    )
    .join("")}</div>${
    shown.length
      ? shown
          .map((p) => {
            const m = matchFor(p);
            return `<article class="person"><div class="personhead"><span class="avatar">${p.initials}</span><div class="persontext"><h3>${p.name}</h3><small>${p.community} · ${p.age}</small></div>${ib("save-person", state.saved.includes(p.id) ? "Unsave trainer" : "Save trainer", "archive", `data-id="${p.id}" aria-pressed="${state.saved.includes(p.id)}"`)}</div><div class="pairs"><div><div class="pairlabel">You receive · ${m.receive.length}</div><div class="miniatures">${m.receive.slice(0, 4).map(art).join("") || "<small>No declared match</small>"}</div></div><div><div class="pairlabel">You give · ${m.give.length}</div><div class="miniatures">${m.give.slice(0, 4).map(art).join("") || "<small>No declared match</small>"}</div></div></div><div class="personfooter"><small>${!p.fresh ? "Confirm availability before planning" : m.give.length && m.receive.length ? "Declared matches on both sides" : "One-way interest"}</small>${button("person", "See both sides", "chevron-right", "", 'data-id="' + p.id + '"')}</div>${m.uncertain.length ? '<p class="reason">Background detail needs confirmation; not counted as exact.</p>' : ""}</article>`;
          })
          .join("")
      : '<div class="empty"><h2>No trainers here yet</h2><p class="muted">Try all demo groups or save a trainer from their match view.</p></div>'
  }${footer()}`;
}
function matchPage() {
  const person = people.find((p) => p.id === personId) || people[0],
    m = matchFor(person);
  return `${button("nav", "People", "chevron-left", "back", 'data-route="people"')}<div class="titlebar"><div><h1>You & ${person.name}</h1><p class="muted">${person.community} · ${person.age}</p></div>${ib("save-person", "Save trainer", "archive", `data-id="${person.id}"`)}</div><p class="muted">Possible trades, not an agreed exchange.</p>${!person.fresh ? '<div class="notice">These offers need reconfirmation. Do not rely on old availability.</div>' : ""}<div class="twocol">${section("You receive", m.receive, "want", { readonly: true })}${section("You give", m.give, "offer", { readonly: true })}</div>${m.uncertain.length ? '<div class="notice">An unspecified background could match, but the exact background must be confirmed.</div>' : ""}<div class="actions">${button("prepare", "Prepare a trade", "check", "primary")}${button("match-search", "Copy my search", "copy")}${button("message", "Draft message", "copy")}</div><div class="section"><h3>Before you meet</h3><p class="muted">Confirm availability, exact variants, friendship and trade eligibility in Pokemon GO. Share a meeting place privately.</p></div>${footer()}`;
}
function publicPage() {
  const person = people[0];
  return `<div class="publichead"><small>Shared trade list · confirmed today</small><h1>Mira's trade list</h1><p class="muted">Riverside group · Open to local meetup trades</p><div class="actions">${button("anon-check", "Check what I can offer", "check", "primary")}${button("public-search", "Copy wants search", "copy")}</div></div>${anonymous.size ? `<div class="notice">You selected ${anonymous.size} possible offers. Confirm exact details with Mira. ${button("anon-copy", "Copy my candidates", "copy")}</div>` : ""}${section(
    "Looking For",
    person.entries.filter((p) => p.want),
    "want",
    { readonly: true },
  )}${section(
    "For Trade",
    person.entries.filter((p) => p.offer),
    "offer",
    { readonly: true },
  )}<div class="notice">No contact method is published in this synthetic example. Nothing is sent.</div>${footer()}`;
}
function sessionPage() {
  if (!session.length) {
    const m = matchFor(people[0]);
    session = [
      ...m.receive.map((p) => ({ ...p, sessionSide: "receive" })),
      ...m.give.map((p) => ({ ...p, sessionSide: "give" })),
    ];
  }
  return `<div class="titlebar"><div><h1>Trade with ${people.find((p) => p.id === personId)?.name || "Mira"}</h1><p class="muted">Private preparation · ${done.size} of ${session.length} checked</p></div>${ib("message", "Copy coordination message", "copy")}</div><label class="details"><span>Meeting context</span><input id="meeting" type="text" placeholder="Optional place or event" value="${esc(meeting)}"></label><div class="notice">Check current eligibility in Pokemon GO. A checked item does not remove it from either standing list.</div>${[
    "receive",
    "give",
  ]
    .map(
      (side) =>
        `<section class="section"><div class="sectionhead ${side === "receive" ? "want" : "offer"}"><h2>You ${side}</h2>${ib(`session-search-${side}`, `Copy ${side} search`, "copy")}</div>${session
          .filter((p) => p.sessionSide === side)
          .map(
            (p) =>
              `<div class="sessionitem ${done.has(side + p.id) ? "done" : ""}"><label><input type="checkbox" data-done="${esc(side + p.id)}" ${done.has(side + p.id) ? "checked" : ""}>${art(p)}<span class="itemtext">${esc(p.name)}<small>${esc(p.bg ? `${p.bg} · BG` : p.shiny ? "Shiny" : "")}</small></span></label></div>`,
          )
          .join("")}</section>`,
    )
    .join(
      "",
    )}${button("message", "Copy meetup message", "copy", "primary")}${footer()}`;
}
function conceptPage() {
  return `<div class="reviewpage"><h1>Three ways into a trade</h1><p class="muted">Same synthetic collection. Different starting points.</p><div class="concepts"><article><small>A · COLLECTION FIRST</small><h2>My List / People</h2><p>Start with explicit wants and offers. Share immediately, then discover useful people. Best before a network exists.</p><a href="?concept=a#list">Open collection-first</a></article><article><small>B · OPPORTUNITY FIRST</small><h2>For You / Collection / Saved</h2><p>Start with reciprocal opportunities. Your collection supplies the matching signals. Best for an established community.</p><a href="?concept=b#people">Open opportunity-first</a></article><article><small>C · SESSION FIRST</small><h2>Today / People / Collection</h2><p>Start with the next trade checklist. Choose a partner, then prepare the exchange. Best at recurring meetups.</p><a href="?concept=c#session">Open session-first</a></article></div><hr><h2>Recommended: A, with contextual preparation</h2><p>Keep the collection useful on its own. Bring reciprocal evidence and preparation into the next action, without another permanent board or inbox.</p>${footer()}</div>`;
}
function render() {
  const hash = location.hash.slice(1);
  [route, personId = personId] = hash.split("/");
  route =
    route ||
    (concept === "b" ? "people" : concept === "c" ? "session" : "list");
  if (route === "saved") {
    route = "people";
    peopleScope = "saved";
  }
  document.body.className = `concept-${concept}`;
  $("#app").innerHTML =
    header() +
    (route === "concepts"
      ? conceptPage()
      : `<div class="workspace ${["people", "match", "public", "session"].includes(route) ? "full" : ""}"><main id="main" tabindex="-1">${route === "people" ? peoplePage() : route === "match" ? matchPage() : route === "public" ? publicPage() : route === "session" ? sessionPage() : listPage()}</main>${["list", "large", "special", "empty"].includes(route) ? side() : ""}</div>`) +
    `<nav class="bottomnav" aria-label="Mobile primary">${nav()}${button("add", "<span>+</span>", "", "mobileadd", 'aria-label="Add Pokemon"')}</nav>`;
}
function openSheet(title, body, foot = "") {
  sheet.innerHTML = `<div class="sheethead"><h2 id="sheet-title">${title}</h2>${button("close", "Close")}</div><div class="sheetbody">${body}</div>${foot ? `<div class="sheetfooter">${foot}</div>` : ""}`;
  if (!sheet.open) sheet.showModal();
  sheet.querySelector('input[type="search"], button')?.focus();
}
function openPicker(q = "") {
  const found = catalog
    .filter(
      (p) =>
        description(p).toLowerCase().includes(q.toLowerCase()) ||
        String(p.no) === q,
    )
    .slice(0, 40);
  openSheet(
    "Add Pokemon",
    `<div class="search">${icon("search")}<input id="catalog-search" type="search" placeholder="Name, costume or dex number" aria-label="Search Pokemon catalog" value="${esc(q)}"></div><div id="picker-results">${tiles(found, { choose: true })}</div>`,
  );
}
function findEntry(id) {
  return (
    currentEntries().find((p) => p.id === id) ||
    state.entries.find((p) => p.id === id) ||
    people.flatMap((p) => p.entries).find((p) => p.id === id) ||
    byId.get(id)
  );
}
function openEditor(p) {
  editor = { ...p };
  const readonly = route === "public" || route === "match" || route === "large";
  const isExisting = state.entries.some((e) => e.id === p.id);
  const allowedGender = [25, 39, 133, 757, 280].includes(p.no);
  const formChoices = catalog.filter((e) => e.no === p.no && !e.shiny);
  const selectedVariant = (p.catalogId || p.id).startsWith("base-") ? `base-${p.no}` : (p.catalogId || p.id);
  openSheet(
    readonly
      ? "Pokemon details"
      : isExisting
        ? "Edit intent"
        : "Add to My List",
    `<div class="editorhero">${art(p)}<div><h3>${esc(p.name)}</h3><p class="muted">#${p.no}${p.shiny ? " · Shiny" : ""}</p></div></div>${
      readonly
        ? `<p>${esc(description(p))}</p>${p.art ? "" : '<div class="notice">Exact artwork unavailable. No base-species substitution.</div>'}`
        : `<div class="bigchecks"><label><input id="edit-want" type="checkbox" ${p.want ? "checked" : ""}>Looking For</label><label><input id="edit-offer" type="checkbox" ${p.offer ? "checked" : ""}>For Trade</label></div><div class="details"><label class="field">Variant<select id="edit-variant">${formChoices.map((x) => `<option value="${x.id}" ${selectedVariant === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label><label><input id="edit-shiny" type="checkbox" ${p.shiny ? "checked" : ""}>${icon("sparkles")}Shiny</label><details ${p.bg || p.gender || p.max ? "open" : ""}><summary>Background & details</summary><div class="details"><label class="field">Background<select id="edit-bg">${[
            ["", "No background"],
            ["any", "Any background (want only)"],
            ...(p.no === 150 ? [["Chicago 2026", "Chicago 2026"]] : []),
          ]
            .map(
              ([v, t]) =>
                `<option value="${v}" ${p.bg === v ? "selected" : ""}>${t}</option>`,
            )
            .join(
              "",
            )}</select></label>${allowedGender ? `<label class="field">Gender<select id="edit-gender"><option value="">Unspecified</option><option value="female" ${p.gender === "female" ? "selected" : ""}>Female ♀</option><option value="male" ${p.gender === "male" ? "selected" : ""}>Male ♂</option></select></label>` : ""}<label><input id="edit-top" type="checkbox" ${p.top ? "checked" : ""}>Top want</label></div></details></div><p id="edit-error" role="alert" class="reason"></p>`
    }`,
    readonly
      ? ""
      : `${isExisting ? ib("remove-entry", "Remove entry", "trash") : ""}${button("save-entry", "Save intent", "", "primary")}`,
  );
  if (!readonly && [25, 94, 133, 143].includes(p.no)) {
    const label = document.createElement("label");
    label.className = "field";
    label.innerHTML = `Max capability<select id="edit-max">${["", "Dynamax", "Gigantamax"].map(v => `<option value="${v}" ${p.max === v ? "selected" : ""}>${v || "Unspecified"}</option>`).join("")}</select>`;
    sheet.querySelector("details .details").prepend(label);
  }
}
function searchSheet(items) {
  const result = speciesQuery(items, state.locale);
  openSheet(
    "Pokemon GO search",
    `<label class="field">Game language<select id="game-language">${[
      ["en", "English"],
      ["ja", "Japanese"],
      ["es", "Spanish"],
      ["de", "German"],
    ]
      .map(
        ([v, t]) =>
          `<option value="${v}" ${state.locale === v ? "selected" : ""}>${t}</option>`,
      )
      .join(
        "",
      )}</select></label><h3>Species only</h3><div class="copybox" id="search-value">${esc(result)}</div><p class="muted">Check shiny, costume, form, gender and exact background in game. This search does not verify those details.</p>`,
    button(
      "copy-query",
      "Copy search",
      "copy",
      "primary",
      result ? "" : "disabled",
    ),
  );
  searchSheet.items = items;
}
async function copy(text) {
  if (!text) {
    toast("Nothing to copy");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied");
  } catch {
    openSheet(
      "Copy text",
      `<textarea readonly aria-label="Text to copy">${esc(text)}</textarea>`,
    );
    sheet.querySelector("textarea").select();
  }
}
function shareItems() {
  const all = currentEntries();
  return scope === "selected"
    ? all.filter((p) => selection.has(p.id))
    : scope === "top"
      ? all.filter((p) => p.top && p.want)
      : all;
}
function shareText(items) {
  return [
    "Looking For",
    ...items.filter((p) => p.want).map(description),
    "",
    "For Trade",
    ...items.filter((p) => p.offer).map(description),
  ].join("\n");
}
function shareSheet() {
  const items = shareItems();
  openSheet(
    "Share My List",
    `<label class="field">Include<select id="share-scope"><option value="all" ${scope === "all" ? "selected" : ""}>Whole list</option><option value="top" ${scope === "top" ? "selected" : ""}>Top wants</option><option value="selected" ${scope === "selected" ? "selected" : ""}>Selected entries (${selection.size})</option></select></label><div class="output-tabs segmented">${["link", "image", "text"].map((x) => button("share-output", x[0].toUpperCase() + x.slice(1), "", output === x ? "active" : "", `data-value="${x}"`)).join("")}</div><p class="muted">${items.length} entries · Private notes excluded</p>${output === "link" ? '<div class="notice">Local prototype only. This opens the synthetic recipient example; it does not publish your draft or selected scope.</div>' + button("preview-public", "Open recipient example", "chevron-right") : output === "text" ? `<textarea id="share-text" readonly aria-label="Trade list text">${esc(shareText(items))}</textarea>` : '<div class="sharepreview"><canvas id="export-canvas" aria-label="Trade list image preview"></canvas></div>'}`,
    output === "link"
      ? ""
      : button(
          output === "image" ? "download-image" : "copy-share",
          output === "image" ? "Download image" : "Copy text",
          output === "image" ? "download" : "copy",
          "primary",
          items.length ? "" : "disabled",
        ),
  );
  if (output === "image") awaitDraw(items);
}
async function awaitDraw(items) {
  const canvas = $("#export-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const cols = 6,
    size = 104,
    w = 688;
  const wants = items.filter((p) => p.want),
    offers = items.filter((p) => p.offer);
  canvas.width = w;
  canvas.height =
    150 +
    Math.ceil(wants.length / cols) * size +
    Math.ceil(offers.length / cols) * size;
  ctx.fillStyle = "#f7f9f8";
  ctx.fillRect(0, 0, w, canvas.height);
  ctx.fillStyle = "#203e33";
  ctx.font = "bold 24px sans-serif";
  ctx.fillText("PoGo Trades", 28, 36);
  ctx.font = "12px sans-serif";
  ctx.fillText("Synthetic sample · image snapshot", 28, 57);
  let y = 90;
  for (const [label, list, color] of [
    ["Looking For", wants, "#a2345c"],
    ["For Trade", offers, "#14634f"],
  ]) {
    ctx.fillStyle = color;
    ctx.font = "bold 17px sans-serif";
    ctx.fillText(label, 28, y);
    y += 12;
    for (let i = 0; i < list.length; i++) {
      const p = list[i],
        x = 28 + (i % cols) * size,
        cy = y + Math.floor(i / cols) * size;
      let drawn = false;
      if (p.art) {
        const im = new Image();
        im.src = p.art;
        try {
          await im.decode();
          const b = bounds(im);
          const scale = Math.min(64 / b.w, 64 / b.h);
          ctx.drawImage(
            im,
            b.x, b.y, b.w, b.h,
            x + 10 + (64 - b.w * scale) / 2,
            cy + 13 + (64 - b.h * scale) / 2,
            b.w * scale,
            b.h * scale,
          );
          drawn = true;
        } catch {}
      }
      if (!drawn) {
        ctx.fillStyle = "#35423c";
        ctx.font = "11px sans-serif";
        wrapCanvas(ctx, p.name, x, cy + 26, 94);
      }
      if (p.shiny) {
        ctx.fillStyle = "#276b7b";
        for (const [sx, sy, radius] of [[x + 83, cy + 12, 8], [x + 73, cy + 22, 4]]) {
          ctx.beginPath();
          ctx.moveTo(sx, sy - radius);
          ctx.quadraticCurveTo(sx, sy, sx + radius, sy);
          ctx.quadraticCurveTo(sx, sy, sx, sy + radius);
          ctx.quadraticCurveTo(sx, sy, sx - radius, sy);
          ctx.quadraticCurveTo(sx, sy, sx, sy - radius);
          ctx.fill();
        }
      }
      if (p.gender) {
        ctx.font = "18px sans-serif";
        ctx.fillStyle = "#864361";
        ctx.fillText(p.gender === "female" ? "♀" : "♂", x + 77, cy + 75);
      }
      if (p.bg || p.max) {
        ctx.font = "11px sans-serif";
        ctx.fillStyle = "#39443e";
        wrapCanvas(
          ctx,
          [p.bg ? (p.bg === "any" ? "Any background" : p.bg + " · BG") : "", p.max].filter(Boolean).join(" · "),
          x,
          cy + 86,
          97,
        );
      }
    }
    y += Math.ceil(list.length / cols) * size + 28;
  }
  canvas.dataset.ready = "true";
}
function wrapCanvas(ctx, text, x, y, max) {
  let line = "";
  for (const word of text.split(" ")) {
    if (ctx.measureText(line + word).width > max && line) {
      ctx.fillText(line, x, y);
      y += 13;
      line = "";
    }
    line += word + " ";
  }
  ctx.fillText(line, x, y);
}
function message() {
  const who = people.find((p) => p.id === personId) || people[0],
    m = matchFor(who);
  openSheet(
    "Draft message",
    `<textarea id="message-text" aria-label="Coordination message">${esc(`Hi ${who.name}, I can offer ${m.give.map(description).join(", ") || "a few possibilities"}. I'm interested in ${m.receive.map(description).join(", ") || "your list"}. Are these still available? Let's confirm exact variants, eligibility and a meeting plan.${route === "session" && meeting ? ` Proposed context: ${meeting}.` : ""}`)}</textarea><p class="muted">Nothing is sent. Copy this into your existing conversation.</p>`,
    button("copy-message", "Copy message", "copy", "primary"),
  );
}
document.addEventListener("click", async (event) => {
  const el = event.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action,
    id = el.dataset.id,
    v = el.dataset.value;
  if (a === "nav") go(el.dataset.route);
  else if (a === "close") sheet.close();
  else if (a === "add") openPicker();
  else if (a === "pick") {
    const p = byId.get(id);
    openEditor({
      ...p,
      catalogId: p.id,
      want: true,
      offer: false,
      bg: "",
      gender: "",
    });
  } else if (a === "entry") {
    if (selectMode) {
      selection.has(id) ? selection.delete(id) : selection.add(id);
      render();
    } else openEditor(findEntry(id));
  } else if (a === "inspect") openEditor(findEntry(id));
  else if (a === "view") {
    view = view === "grid" ? "rows" : "grid";
    render();
  } else if (a === "filter") {
    filter = v;
    page = 0;
    render();
  } else if (a === "clearfilters") {
    query = "";
    topOnly = false;
    collection = "all";
    filter = "all";
    page = 0;
    render();
  } else if (a === "select") {
    selectMode = !selectMode;
    if (!selectMode) selection.clear();
    render();
  } else if (a === "clear-selection") {
    selection.clear();
    selectMode = false;
    render();
  } else if (a === "next" || a === "previous") {
    page += a === "next" ? 1 : -1;
    render();
    window.scrollTo(0, 0);
  } else if (a === "share" || a === "share-selection") {
    scope = a === "share-selection" ? "selected" : "all";
    shareSheet();
  } else if (a === "share-output") {
    output = v;
    shareSheet();
  } else if (a === "preview-public") {
    sheet.close();
    go("public");
  } else if (a === "copy-share") copy($("#share-text").value);
  else if (a === "copy-message") copy($("#message-text").value);
  else if (a === "download-image") {
    const canvas = $("#export-canvas");
    if (canvas.dataset.ready !== "true") {
      toast("Image is still preparing");
      return;
    }
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = "pogo-trades-synthetic.png";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    });
  } else if (a === "save-entry") {
    const want = $("#edit-want").checked,
      offer = $("#edit-offer").checked,
      bg = $("#edit-bg").value;
    if (!want && !offer) {
      $("#edit-error").textContent = "Choose Looking For, For Trade, or both.";
      return;
    }
    if (offer && bg === "any") {
      $("#edit-error").textContent =
        "An offer needs an exact background or no background.";
      return;
    }
    lastEdit = structuredClone(state.entries);
    let p =
      byId.get($("#edit-variant").value) ||
      byId.get(editor.catalogId) ||
      editor;
    const shiny = $("#edit-shiny").checked;
    let artPath = p.art;
    if (shiny) {
      const shinyArt = byId.get(`base-${p.no}-shiny`);
      artPath = p.id.startsWith("base-") ? shinyArt?.art : null;
    }
    const fresh = {
      ...p,
      id: editor.id,
      catalogId: p.id,
      want,
      offer,
      bg,
      shiny,
      art: artPath,
      gender: $("#edit-gender")?.value || "",
      max: $("#edit-max")?.value || "",
      top: want && $("#edit-top").checked,
    };
    const index = state.entries.findIndex((p) => p.id === editor.id);
    if (index >= 0) state.entries[index] = fresh;
    else state.entries.push({ ...fresh, id: crypto.randomUUID() });
    state.entries = mergeDeclarations(state.entries);
    persist();
    sheet.close();
    if (route === "empty") go("list");
    render();
    toast("Saved on this device");
  } else if (a === "remove-entry") {
    lastEdit = structuredClone(state.entries);
    state.entries = state.entries.filter((p) => p.id !== editor.id);
    persist();
    sheet.close();
    render();
    toast("Removed from this draft. Undo is in Account.");
  } else if (a === "account")
    openSheet(
      "Account",
      `<h3>Juniper · synthetic trainer</h3><p class="muted">Draft stored only in this browser.</p><hr><div class="details">${button("undo", "Undo last list edit", "chevron-left", "", lastEdit ? "" : "disabled")}${button("nav-close", "Saved trainers", "archive", "", 'data-route="saved"')}${button("nav-close", "Trade preparation", "calendar", "", 'data-route="session"')}${button("reset-demo", "Restore demo collection", "archive")}</div><hr><p class="muted">Account methods, Admin and event management are not connected in this prototype.</p>`,
    );
  else if (a === "nav-close") {
    sheet.close();
    go(el.dataset.route);
  } else if (a === "undo") {
    if (lastEdit) {
      state.entries = lastEdit;
      lastEdit = null;
      persist();
      sheet.close();
      render();
      toast("Last edit undone");
    }
  } else if (a === "reset-demo") {
    state.entries = initial();
    state.saved = [];
    persist();
    selection.clear();
    sheet.close();
    render();
    toast("Synthetic sample restored");
  } else if (a === "people-scope") {
    peopleScope = v;
    render();
  } else if (a === "save-person") {
    state.saved.includes(id)
      ? (state.saved = state.saved.filter((x) => x !== id))
      : state.saved.push(id);
    persist();
    render();
  } else if (a === "person") go(`match/${id}`);
  else if (a === "prepare") {
    const m = matchFor(people.find((p) => p.id === personId) || people[0]);
    session = [
      ...m.receive.map((p) => ({ ...p, sessionSide: "receive" })),
      ...m.give.map((p) => ({ ...p, sessionSide: "give" })),
    ];
    done.clear();
    go("session");
  } else if (a === "message") message();
  else if (a === "match-search")
    searchSheet(
      matchFor(people.find((p) => p.id === personId) || people[0]).give,
    );
  else if (a === "public-search")
    searchSheet(people[0].entries.filter((p) => p.want));
  else if (a === "copy-selection")
    searchSheet(currentEntries().filter((p) => selection.has(p.id)));
  else if (a.startsWith("search-"))
    searchSheet(filteredEntries().filter((p) => p[a.slice(7)]));
  else if (a.startsWith("session-search-"))
    searchSheet(session.filter((p) => p.sessionSide === a.slice(15)));
  else if (a === "copy-query") copy($("#search-value").textContent);
  else if (a === "anon-check")
    openSheet(
      "What can you offer?",
      `<p class="muted">Only this local selection is changed.</p>${people[0].entries
        .filter((p) => p.want)
        .map(
          (p) =>
            `<label class="sessionitem"><input type="checkbox" data-anon="${p.id}" ${anonymous.has(p.id) ? "checked" : ""}>${art(p)}${esc(p.name)}</label>`,
        )
        .join("")}`,
      button("anon-done", "Show my candidates", "check", "primary"),
    );
  else if (a === "anon-done") {
    sheet.close();
    render();
  } else if (a === "anon-copy")
    searchSheet(people[0].entries.filter((p) => anonymous.has(p.id)));
});
document.addEventListener("change", (event) => {
  const el = event.target;
  if (el.id === "top-only") {
    topOnly = el.checked;
    page = 0;
    render();
  } else if (el.id === "collection-filter") {
    collection = el.value;
    page = 0;
    render();
  } else if (el.id === "share-scope") {
    scope = el.value;
    shareSheet();
  } else if (el.id === "game-language") {
    state.locale = el.value;
    persist();
    $("#search-value").textContent = speciesQuery(
      searchSheet.items,
      state.locale,
    );
  } else if (el.dataset.side) {
    const p = state.entries.find((p) => p.id === el.dataset.id);
    if (p) {
      lastEdit = structuredClone(state.entries);
      p[el.dataset.side] = el.checked;
      if (!p.want && !p.offer)
        state.entries = state.entries.filter((x) => x !== p);
      persist();
      render();
      toast("Saved on this device");
    } else {
      toast("Large-list fixture is read-only");
      render();
    }
  } else if (el.dataset.done) {
    el.checked ? done.add(el.dataset.done) : done.delete(el.dataset.done);
    render();
  } else if (el.dataset.anon) {
    el.checked
      ? anonymous.add(el.dataset.anon)
      : anonymous.delete(el.dataset.anon);
  }
});
document.addEventListener("input", (event) => {
  const el = event.target;
  if (el.id === "meeting") meeting = el.value;
  else if (el.id === "catalog-search") {
    $("#picker-results").innerHTML = tiles(
      catalog
        .filter(
          (p) =>
            description(p).toLowerCase().includes(el.value.toLowerCase()) ||
            String(p.no) === el.value,
        )
        .slice(0, 40),
      { choose: true },
    );
  } else if (el.id === "list-search" || el.id === "people-search") {
    const id = el.id,
      pos = el.selectionStart;
    if (id === "list-search") {
      query = el.value;
      page = 0;
    } else peopleQuery = el.value;
    render();
    const fresh = $("#" + id);
    fresh.focus();
    try {
      fresh.setSelectionRange(pos, pos);
    } catch {}
  }
});
window.addEventListener("hashchange", () => {
  sheet.close();
  query = "";
  page = 0;
  selection.clear();
  selectMode = false;
  render();
  window.scrollTo(0, 0);
});
const observer = new MutationObserver(() => normalizeSprites());
observer.observe(document.body, { childList: true, subtree: true });
render();
